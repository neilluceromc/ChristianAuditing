# Cloud staging on Vercel + Supabase: design

**Date:** 2026-10-20

**Status:** draft for the owner's approval

**Track:** infrastructure. It has no phase number, so client staff stays Phase 47.

## 1. Intent

Staging moves off the office laptop (http://192.168.1.193:3000, Docker compose) to Vercel for the app and Supabase for Postgres and files. The current staging data comes along.

**Why:**
- The laptop is fragile: it crashed under build load on 2026-10-15.
- The laptop is only reachable on the office network.
- The owner has connected Vercel and Supabase accounts.

**Owner's answers (2026-10-20):**
- **Purpose:** replace the laptop staging.
- **Data:** copy the current staging data over.
- **Vercel plan:** Hobby (free).
- **Labels:** none printed yet, so the address simply changes.
- **Exposure:** public internet, behind the app's sign-in.

## 2. Goals, non-goals, anti-goals

**Goals:**
- The same app and the same data, served from `https://<project>.vercel.app`, with the database in Supabase.
- Everything the worker does today keeps happening:
  - executing approvals;
  - webhook deliveries;
  - hold expiry;
  - retention prune;
  - the nightly MetricSnapshot.
- Uploaded documents are stored in Supabase Storage. The uploads folder is empty today, so no files need moving.
- Local development and the Playwright battery keep working unchanged, with local disk, a local worker and the local DB.

**Non-goals:**
- Production hardening for real company use: a custom domain, paid plans, point-in-time recovery.
- Changing any feature.
- Deleting the laptop stack. It stays runnable as a fallback until the owner retires it.

**Anti-goals** (a failure even if it "works"):
- **Encrypted fields stop decrypting.** Using any `SECRET_ENCRYPTION_KEY` other than the laptop's makes every encrypted value in the copied data unreadable.
- **The database is open through Supabase's auto-generated Data API.** Tables in `public` are reachable with the public anon key unless that is closed.
- **A branch preview migrates the shared staging database.**
- **Secrets are committed, logged or typed by Claude.** The owner pastes every secret into the dashboards.

## 3. Constraints

**Vercel Hobby limits:**
- No long-running process.
- Cron jobs run at most once a day.
- One function region.
- 4.5 MB request body limit.
- Hobby is for non-commercial use under Vercel's terms. The owner chose it for staging and knows company use needs Pro.

**Supabase:**
- Postgres 15 or 17. Our dump comes from Postgres 16.
- The pooler is pgBouncer-style:
  - transaction mode on port 6543 for the app;
  - session mode on port 5432 for migrations and restore.
- `pg_cron` and `pg_net` extensions are available on every plan.

**Regions:**
- Supabase: Southeast Asia (Singapore).
- Vercel functions: `sin1`, so the app and the database sit in the same city.

**Existing rules:**
- Never seed staging.
- Back up before every change to staging data.
- Merge, push and deploy only on the owner's word.

## 4. Design

### 4.1 Database (Prisma ↔ Supabase)
- `schema.prisma` is unchanged; there is no `directUrl`. Adding one would break `prisma migrate` wherever `DIRECT_URL` is unset, including the compose `migrate` service and every local `.env`.
- **On Vercel:**
  - `DATABASE_URL` = the transaction pooler (port 6543) with `?pgbouncer=true&connection_limit=1`.
  - `DIRECT_URL` = the session pooler (port 5432). Only the build uses it, for migrations.
- **Locally:** nothing changes.
- `SKIP LOCKED` leasing and interactive transactions already work in transaction mode. The `pgbouncer=true` flag turns off prepared statements.
- **Migrations:** a `vercel-build` script (`scripts/vercel-build.mjs`) runs these steps in order:
  1. `prisma generate`.
  2. **Only when `VERCEL_ENV=production`:** `prisma migrate deploy` with `DATABASE_URL` overridden to `DIRECT_URL` for that one command. When `DIRECT_URL` is missing, the build fails loudly.
  3. `next build`.
- **Previews are off** (`vercel.json` `git.deploymentEnabled`: `main` only), so a branch never builds against the staging database. *(Builder-check ruling.)*

### 4.2 Closing the Data API
The app reaches Postgres only through Prisma, as the `postgres` role. A one-time Supabase SQL file (`scripts/supabase/lockdown.sql`, run by the owner in the SQL editor) does two things:
- **Revokes access** to `public` tables, sequences and functions from `anon` and `authenticated`.
- **Locks down future tables** by setting default privileges so they inherit the same revocation.

The owner also turns the Data API off in project settings. The SQL is the belt to that pair of braces.

`lockdown.sql` is run **twice**: once on the empty project, and again **after the restore**, so the revoke also covers the restored tables.

### 4.3 The worker without a long-running process
**Shared tick module.** `src/worker/index.ts` today loops forever. Its step functions move into `src/worker/run.ts`:
- `recoverStale`
- `tick`
- `safePrune`
- `safeExpire`
- `safeSnapshot`

Two callers use them:
- **The existing loop** (`npm run worker`), unchanged in behaviour, for dev, e2e and the laptop.
- **A new route** `POST /api/worker/tick`:
  - Checks `Authorization: Bearer ${CRON_SECRET}`; a wrong or missing header gets 401.
  - Runs `recoverStale`.
  - Works jobs until none are left or a 45-second budget is spent.
  - Sets `maxDuration = 60`.

**Maintenance route.** `POST /api/worker/maintenance` (same secret) runs prune, hold expiry and the snapshot if today's is missing. Missing means no `MetricSnapshot` row for today's Manila day, checked in the DB rather than in memory.

**Middleware.** It already skips `api/auth`. Its matcher also skips `api/worker`, and the routes do their own secret check.

**Schedule** (Supabase `pg_cron` + `pg_net`, set up by `scripts/supabase/schedule.sql`):
- **`worker-tick`:** every minute.
- **`worker-maintenance`:** hourly at :05.

The secret lives in Supabase Vault, never in the SQL file.

**Effect:** an approved change now executes within about a minute, instead of the laptop's 3 seconds.
- *My call:* acceptable for staging.
- *Follow-up:* kick a tick with `after()` right after an approval enqueues a job.

### 4.4 Files in Supabase Storage
`src/server/uploads.ts` gains a storage driver chosen by environment:
- **Supabase driver:** used when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. It reads and writes a private bucket `documents`, using the service-role key on the server only and the Storage REST API through `fetch`, with no new dependency.
- **Local disk:** used otherwise. This is today's code.

**The interface:**
- `storeUpload(relDir, file)`, unchanged.
- New `readUpload(relPath)`, which returns bytes or `null`.

All five download routes switch from `readFile` to `readUpload`. The traversal guard moves inside the local driver; the Supabase driver rejects any path containing `..`.

**Upload cap, my call.** The 10 MB wording also appears in six components (document-slots, file-drop, form-tab, request-documents-card, lot-document-dialog, supplier-documents-card); all of them change. Server actions already cap request bodies at 4 MB (`next.config.ts`), and Vercel at 4.5 MB. So today's "10 MB" cap is wrong: a 5 MB file fails with an opaque error. The stated cap becomes **4 MB**, the same number in the refusal copy. Direct-to-storage uploads that would allow larger files are a follow-up.

### 4.5 Configuration and secrets
These are set by the owner in Vercel → Project → Settings → Environment Variables, Production scope.

| Variable | Value |
|---|---|
| `DATABASE_URL` | from Supabase → Connect → transaction pooler |
| `DIRECT_URL` | from Supabase → Connect → session pooler |
| `AUTH_SECRET` | a new value, or the laptop's; either works |
| `SECRET_ENCRYPTION_KEY` | **exactly the laptop `.env` value** |
| `APP_BASE_URL` | `https://<project>.vercel.app` |
| `SUPABASE_URL` | from Supabase API settings |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase API settings |
| `CRON_SECRET` | a new random value, also stored in Supabase Vault |
| `SIGNUP_REQUIRES_APPROVAL` | `1` (see §4.7) |
| `QUICK_LOGIN_EMAILS` | **never set on Vercel.** It is one-click sign-in with no password, and the laptop uses it. On the public internet anyone could use it. |
| `ANTHROPIC_API_KEY` | only if Cris should work on cloud staging |
| `AUTH_MICROSOFT_ENTRA_ID_*` | only if Entra sign-in is used; its redirect URI must then add the Vercel address |

`vercel.json`:
- `"regions": ["sin1"]`
- no Vercel cron (Supabase drives it)

`next.config.ts`:
- `output: "standalone"` stays; Vercel ignores it.

### 4.7 Sign-up on the public internet (owner's answer: closed)
Sign-up today accepts any `allowed_domain` address without an email check. With `SIGNUP_REQUIRES_APPROVAL=1` (cloud only):
- `signUp` creates the account **disabled**, and the page says an admin must approve it.
- An admin enables the account from Admin → Users (the existing enable/disable control; the `?disabled=1` view lists the waiting accounts).

With the variable unset (local dev, the laptop), nothing changes.

*Ruling:* there is no admin "create user" screen today, so approval of self sign-ups replaces it. Cost if wrong: a small "Add user" form later.

### 4.8 Backups (owner's answer: Supabase Free; Claude takes dumps)
- Free has no Supabase backups, so the rule is: **before any push to `main` that adds a migration, take a `pg_dump -Fc` of Supabase and validate it.**
  - `scripts/supabase/dump.ps1` runs it through the `postgres:16-alpine` container, reading the session-pooler URL from an environment variable the owner sets in their terminal.
  - Pushes without a migration need no dump.
- The every-minute worker call keeps a Free project from pausing for inactivity.

### 4.6 Data copy and cutover
1. **Prepare Supabase.** Create the project in Singapore, run `lockdown.sql`, create the private `documents` bucket.
2. **Stop the laptop app and take a fresh dump.**
   - Stop the laptop's `web` and `worker` services (`docker compose stop web worker`; reversible, and `db` keeps running).
   - Then take a new `pg_dump -Fc` and validate it.
   - Stopping the worker first means no job runs in both places, and no webhook goes out twice.
3. **Restore.** Run `pg_restore --no-owner --no-privileges --schema=public` into Supabase with `scripts/supabase/restore.ps1`.
   - The script reads the target from an environment variable the owner sets in their own terminal. Claude never sees the URL.
   - It restores to Supabase's session pooler, through `pg_restore` 16 in the existing `postgres:16-alpine` container.
   - `_prisma_migrations` comes along, so the first `migrate deploy` has nothing to apply.
4. **Check the copy.** Compare row counts per table between the laptop and Supabase with a read-only script that prints counts only.
5. **Deploy.** Run the first Vercel production deploy, then `schedule.sql`.
6. **Verify.**
   - **Claude runs** `scripts/supabase/smoke.mjs`, which is read-only and needs no browser and no credentials. It checks:
     - `/login` returns 200;
     - `/api/worker/tick` returns 401 without the secret;
     - Supabase row counts match.
   - **The owner signs in once** and does one approval and one document upload and download. That proves the cron and Storage, and Claude never types a password.
   - The Playwright battery stays local-only, because it seeds.
7. **The laptop stays stopped** (web and worker) from step 2 onwards. Restarting it is one command; deleting the stack is the owner's separate decision.

**Auto-deploys:** after cutover, every push to `main` deploys to Vercel automatically. That replaces `deploy-staging.ps1`. "Deploy only on the owner's word" becomes "push to `main` only on the owner's word".

## 5. Left to the builder
- How the tick loop budgets time.
- The Storage REST call details.
- Test shapes. Unit tests come first:
  - the driver choice and the path guard;
  - the tick route's 401 and budget;
  - the snapshot-missing check;
  - the `vercel-build` gate on `VERCEL_ENV`.
- The worker refactor must keep `npm run worker` behaviour the same. No unit test covers the loop today, because `index.ts` runs `main()` on import. So the refactor **adds** unit tests for `run.ts`, covering tick, the budget, and the snapshot-missing check, with a mocked client. *(Builder-check ruling.)*

## 6. What only the owner can do (dashboards and secrets), in this order
1. **Create the Supabase project** (Free plan, Singapore region) and keep the database password.
2. **Turn the Data API off**, then run `lockdown.sql` and create the private `documents` bucket.
3. **Run the restore.** Set the session-pooler URL in your own terminal, then run `scripts/supabase/restore.ps1`. Claude stops the laptop app and takes the dump first.
4. **Run `lockdown.sql` again.**
5. **In Vercel:**
   - Import the GitHub repo **only now**: a production build migrates, and it must find the restored schema.
   - Paste the environment variables.
6. **Schedule the worker.** Put `CRON_SECRET` and the app URL in Supabase Vault, then run `schedule.sql`.
7. **Sign in once** and do the approval and upload check.
