# Cloud staging on Vercel + Supabase: the owner's runbook

Staging moves off the office laptop (http://192.168.1.193:3000) to **Vercel** for the app and
**Supabase** for Postgres and uploaded files, and the current staging data comes along.
Design: `docs/superpowers/specs/2026-10-20-cloud-staging-vercel-supabase-design.md`.

**Status:** the code is ready on branch `cloud-staging`. It is not merged and nothing is cut over;
staging is still the laptop. Merging, pushing and every step below happen only on your word.

**The ground rules:**
- **You paste every secret** into the Supabase and Vercel dashboards, or into your own terminal.
  Never into a file, never into chat. Claude never sees, types or prints one. This file holds
  placeholders only (`<like-this>`).
- **Never set `QUICK_LOGIN_EMAILS` on Vercel.** It is one-click sign-in with no password. The laptop
  uses it on the office network; on the public internet anyone could use it.
- **`SECRET_ENCRYPTION_KEY` must be exactly the laptop's value.** Any other value makes every
  encrypted field in the copied data unreadable.
- **Never seed staging.** The seed empties every table.

---

## Before you start

- A Supabase account and a Vercel account (Hobby) that can see the GitHub repository.
- The laptop with Docker Desktop running and the `inventory-db-1` container up. The restore and
  dump scripts run `pg_restore` and `pg_dump` inside that container, so nothing new is installed.
- A PowerShell terminal at the repository root on the laptop.
- `cloud-staging` merged to `main` and pushed (your word) **before step 5**, because Vercel builds
  `main`.

## The steps, in order

Claude's parts are marked **(Claude)**. Everything else is yours.

### 1. Create the Supabase project

1. Supabase → **New project**. Plan **Free**, region **Southeast Asia (Singapore)**.
2. Choose a strong **database password of letters and digits only** (Supabase's Generate button
   makes one) and keep it in your password manager. You need it for the two connection strings
   below. A password with `@`, `/`, `#` or `?` breaks the connection URL, and then Postgres's own
   error message can print the whole URL, password included. (Lost it? Project Settings → Database
   → Reset database password.)
3. Note the Postgres version the project runs (Project Settings → Infrastructure). Our data comes
   from Postgres 16. The restore is meant for **Postgres 17**, the current Supabase default;
   Postgres 15 is untested. On 17, backups need `-Image postgres:17-alpine` (see
   [Backups](#backups-the-dump-rule)).

### 2. Turn the Data API off, run `lockdown.sql`, create the `documents` bucket

1. **Data API off:** Project Settings → **Data API** → turn **Enable Data API** off and save.
   (The app never uses it; it reaches Postgres only through Prisma. Dashboard labels move from
   time to time: search the settings for "Data API".)
2. **Lockdown:** SQL Editor → New query → paste all of `scripts/supabase/lockdown.sql` → **Run**.
   It removes every right the public `anon` and `authenticated` roles have in the `public` schema,
   now and for tables created later. It is safe to run any number of times.
3. **Bucket:** Storage → **New bucket** → name exactly `documents`, **Public bucket off** (private).
   No other settings are needed. The app caps each upload at **4 MB**.

### 3. Run the restore

**(Claude) first:** stops the laptop app and takes a fresh dump.
- `docker compose stop web worker` from the repository root (`db` keeps running; reversible).
  If Compose answers that there is no such service, add the profile: `docker compose --profile prod stop web worker`.
  Stopping the worker first means no job runs in both places and no webhook goes out twice.
- Then a `pg_dump -Fc` of the laptop database through `inventory-db-1`, validated with
  `pg_restore -l` (the count of `TABLE DATA` entries is printed), saved under `backups\`.
  Claude tells you the file name.

**Then you,** in your own PowerShell terminal at the repository root:

```powershell
# Supabase -> Connect (top of the project page) -> Connection string -> "Session pooler" (port 5432).
# Copy the URI and replace [YOUR-PASSWORD] with the database password from step 1.
$env:SUPABASE_DB_URL = '<session pooler URI, port 5432>'

.\scripts\supabase\restore.ps1 -Dump .\backups\<the dump Claude named>

Remove-Item Env:SUPABASE_DB_URL
```

- The script never prints the URL and refuses the transaction pooler (port 6543).
- It copies the dump into `inventory-db-1`, runs `pg_restore --no-owner --no-privileges
  --schema=public --exit-on-error --single-transaction` into Supabase, and deletes the copy.
- **All or nothing:** if anything fails, nothing is kept. Read the error, fix it, run it again.
  **Before you paste an error anywhere** (chat included), check it does not contain your password.
- `_prisma_migrations` comes along, so the first Vercel build has no migration to apply.
- If PowerShell refuses to run scripts, run it as
  `powershell -ExecutionPolicy Bypass -File .\scripts\supabase\restore.ps1 -Dump <path>`.

### 4. Run `lockdown.sql` again

SQL Editor → paste `scripts/supabase/lockdown.sql` → **Run**. This time the revoke also covers the
restored tables. Optional check (expect no rows):

```sql
select table_name, grantee from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
```

**Then check the copy.** `scripts/supabase/counts.ps1` is read-only: it prints one
`table<TAB>count` line per table in `public`, sorted by name, with exact counts and never row data.

You run the Supabase side, in the terminal where `SUPABASE_DB_URL` is set (as in step 3):

```powershell
.\scripts\supabase\counts.ps1 -Target supabase
```

and paste the lines it prints into chat (table names and numbers only; no secret is in them).
**(Claude)** runs `.\scripts\supabase\counts.ps1 -Target laptop` against the laptop database and
compares the two lists table by table. Any difference stops the cutover here.

**Uploaded files do not travel with the database.** The five document tables are `AssetDocument`,
`RequestDocument` (purchase documents), `VendorDocument` (supplier documents), `StockLotDocument`
(stock lot documents) and `Acknowledgement` (employee acknowledgements). Their files stay on the
laptop's `./uploads` volume, and every download on Vercel would then answer "File missing from the
uploads volume". So **every one of the five must be 0 on the laptop. If any is not 0, stop and ask
Claude before continuing**: the files have to be copied into the `documents` bucket first.

### 5. In Vercel: import the repository, paste the environment variables

**Import only now.** A production build runs `prisma migrate deploy`, and it must find the restored
schema.

1. Vercel → **Add New… → Project** → import the GitHub repository.
2. **Project name:** it becomes the address, `https://<project>.vercel.app`.
3. Framework preset **Next.js** (detected). Leave the build command as it is: Vercel runs
   `npm run vercel-build` by itself because `package.json` has that script. It runs
   `prisma generate`, then (production only) `prisma migrate deploy` through `DIRECT_URL`, then
   `next build`.
4. Expand **Environment Variables** and paste the values from the table below. They are needed for
   **Production**; previews are switched off (`vercel.json` deploys `main` only), so Preview and
   Development need nothing.
5. **Deploy.** The build log should say `VERCEL_ENV=production: prisma generate -> prisma migrate deploy -> next build`
   and `No pending migrations to apply`.
6. Check Project → Settings → **Domains**. If the production address differs from the
   `APP_BASE_URL` you pasted, correct the variable and **Redeploy**.
7. Check Project → Settings → **Git**: the **Production Branch** must be `main`. The first deploy
   above was started by the import; the real test is the **first push to `main` after it**. When
   that push happens, check Vercel → Deployments shows a new production deployment for it. If it
   does not, set Settings → Git → Production Branch to `main` and push again (or Redeploy).

8. Check Project → Settings → **Functions**: **Fluid compute** must be **ON** (the default for new
   projects). The instant worker kick runs after the response is sent, and without Fluid compute the
   function is cut off after about 10 seconds, killing a job half way.

Functions run in Singapore (`sin1`, set in `vercel.json`), next to the database.

#### The environment variables (Vercel → Project → Settings → Environment Variables, Production)

| Variable | Value | Where it comes from |
|---|---|---|
| `DATABASE_URL` | the transaction pooler | Supabase → **Connect** → Connection string → **Transaction pooler** (port **6543**). Replace `[YOUR-PASSWORD]`, then add `?pgbouncer=true&connection_limit=1` to the end. |
| `DIRECT_URL` | the session pooler | Supabase → **Connect** → Connection string → **Session pooler** (port **5432**), password filled in. Only the build uses it, for migrations. |
| `AUTH_SECRET` | a new value, or the laptop's; either works | A new one: `npx auth secret` in your terminal. A new value only signs everyone out once. |
| `SECRET_ENCRYPTION_KEY` | **exactly the laptop `.env` value** | Open the laptop's `.env` yourself and copy the value. Never a new one. |
| `APP_BASE_URL` | `https://<project>.vercel.app` | The project name from step 5 (no trailing slash). |
| `SUPABASE_URL` | the project URL, `https://<ref>.supabase.co` | Supabase → Project Settings → **Data API** (Project URL), or **Connect** → App frameworks. |
| `SUPABASE_SERVICE_ROLE_KEY` | the **secret key** (`sb_secret_…`), recommended; or the legacy `service_role` key | Supabase → Project Settings → **API Keys** → **Secret keys** → Reveal and copy (create one if none is listed). The legacy `service_role` key (the **Legacy API keys** tab, a long `eyJ…` value) also works. Server-only: never in a `NEXT_PUBLIC_` variable. |
| `CRON_SECRET` | a new random value, also stored in Supabase Vault | Make one in your terminal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The same value goes into Vault in step 6. |
| `SIGNUP_REQUIRES_APPROVAL` | `1` | Fixed value; see [Sign-up](#sign-up-on-the-public-internet). |
| `QUICK_LOGIN_EMAILS` | **never set on Vercel** | One-click sign-in with no password. The laptop uses it; on the public internet anyone could use it. |
| `ANTHROPIC_API_KEY` | only if Cris should work on cloud staging | Your Anthropic console. Without it Cris runs in preview mode. |
| `AUTH_MICROSOFT_ENTRA_ID_*` | only if Entra sign-in is used | The Entra app registration. Its redirect URIs must then also list `https://<project>.vercel.app/api/auth/callback/microsoft-entra-id`. |

The five names new for cloud staging are `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET` and `SIGNUP_REQUIRES_APPROVAL`. Locally and on the laptop all five stay unset, and the
app behaves exactly as before.

### 6. Schedule the worker

Vercel Hobby has no long-running process, so Supabase calls the worker:
`POST /api/worker/tick` every minute and `POST /api/worker/maintenance` hourly at :05, each with the
header `Authorization: Bearer <CRON_SECRET>`. A missing or wrong header gets `401`.

1. Store the two values in the Vault **through its page**, not through SQL: Supabase → your project →
   **Integrations → Vault → Add new secret**, twice. The names must be exactly:

   | Name | Secret |
   |---|---|
   | `app_url` | `https://<project>.vercel.app` (no trailing slash) |
   | `cron_secret` | the same value as Vercel's `CRON_SECRET` |

   Why not SQL: the SQL editor keeps its query history on Supabase's side, so a real secret typed
   into `vault.create_secret(...)` stays there even after you clear the tab.

   Fallback, only if the Vault page is unavailable: in SQL Editor run
   `select vault.create_secret('<value>', 'cron_secret');` and the same for `app_url`. **Warning:** the
   editor's history keeps that query, secret included. Delete it from the history afterwards and, if
   you doubt it was purged, rotate `CRON_SECRET` (new value in Vercel, redeploy, update Vault).
2. New query → paste all of `scripts/supabase/schedule.sql` → **Run**. It enables `pg_cron` and
   `pg_net` and (re)creates the jobs `worker-tick` and `worker-maintenance`. Safe to run again.
3. After two minutes, check:

   ```sql
   select status_code, created from net._http_response order by created desc limit 5;
   ```

   `200` means it works. `401` means Vault's `cron_secret` and Vercel's `CRON_SECRET` differ.
   `503` means the app could not reach the database (check `DATABASE_URL`).

Besides the schedule, a change that queues a job (an approval, a webhook) starts a worker run right
after the response, so an approved change applies within seconds; the minute schedule is the
safety net. The calls also keep the Free project from pausing for inactivity.

**(Claude) then** runs the smoke check, which is read-only and needs no credentials:

```powershell
node scripts/supabase/smoke.mjs https://<project>.vercel.app
```

It prints `PASS` or `FAIL` for: `/login` answers `200`; `/api/worker/tick` without the secret
answers `401`. Any `FAIL` makes it exit non-zero.

### 7. Sign in once and do the approval and upload check

1. Sign in at `https://<project>.vercel.app` with your usual account (the copied data has it).
2. Do **one approval** and watch it apply within a few seconds. That proves the worker.
3. **Upload one document** (PDF, PNG or JPG, at most 4 MB) and **download it** again. That proves
   Storage. It should then show in Supabase → Storage → `documents`.

Cut over. From now on **every push to `main` deploys to Vercel**, which replaces
`scripts/deploy-staging.ps1`: "deploy only on the owner's word" becomes "push to `main` only on the
owner's word". After the **first** push to `main`, check that Vercel deployed it (step 5, item 7);
if not, set Vercel → Settings → Git → Production Branch to `main`. The Playwright battery stays
local, because it seeds.

---

## Troubleshooting

- **Vercel logs show Prisma "Timed out fetching a new connection from the connection pool".** Change
  `connection_limit=1` to `connection_limit=3` in the Vercel `DATABASE_URL` (Settings → Environment
  Variables) and Redeploy. One connection can be too few when a function serves several requests at once.

## Sign-up on the public internet

With `SIGNUP_REQUIRES_APPROVAL=1`, a self sign-up creates a **disabled** account and the page says an
admin must approve it. To approve: **Admin → Users**, the **Disabled** view
(`/admin/users?disabled=1`) lists the waiting accounts; enable the account with the usual control.
Signing in with a disabled account is refused. Locally and on the laptop the variable is unset and
sign-up works as before.

## Backups: the dump rule

Supabase Free keeps no backups. The rule: **before any push to `main` that adds a migration, take a
dump of Supabase and check it.** Pushes without a migration need no dump.

```powershell
$env:SUPABASE_DB_URL = '<session pooler URI, port 5432>'
.\scripts\supabase\dump.ps1 -Out .\backups\supabase-<date>-before-<migration>.dump
Remove-Item Env:SUPABASE_DB_URL
```

- It runs `pg_dump -Fc --schema=public`, validates the result with `pg_restore -l` (it prints the
  number of `TABLE DATA` entries and fails on zero), and only then moves it to `-Out`; temporary
  files are always deleted. It never prints the URL, refuses the transaction pooler (port 6543), and
  never overwrites an existing file unless you add `-Force`.
- **On a Postgres 17 project (the Supabase default) add `-Image postgres:17-alpine`.** `pg_dump`
  refuses a server newer than itself ("server version mismatch"), and the laptop container's is 16.
  With `-Image`, the dump runs in a throwaway container of that image (Docker downloads it the first
  time) instead of `inventory-db-1`, with the same checks:

  ```powershell
  .\scripts\supabase\dump.ps1 -Out .\backups\supabase-<date>-before-<migration>.dump -Image postgres:17-alpine
  ```

- If it fails, check the error for your password before pasting it anywhere.
- To put a dump back, use `restore.ps1` against an **empty** project (it refuses tables that already
  exist), then run `lockdown.sql` again.

## The laptop stack (fallback)

The laptop's `web` and `worker` stay stopped from step 3 on; `db` keeps running and holds the data
as it was at the cutover. Deleting the stack is your separate decision.

To bring the laptop back, from the repository root on the laptop:

```powershell
docker compose start web worker
```

(If Compose answers that there is no such service: `docker compose --profile prod start web worker`.)
Stop the Supabase schedule first if both should not run jobs at once:
`select cron.unschedule('worker-tick'); select cron.unschedule('worker-maintenance');`
(`schedule.sql` puts them back).

## Files

| File | What it is |
|---|---|
| `scripts/vercel-build.mjs` | Vercel's build: `prisma generate`, then `prisma migrate deploy` through `DIRECT_URL` on production builds only, then `next build`. |
| `vercel.json` | Region `sin1`; deploys `main` only (no branch previews). |
| `scripts/supabase/lockdown.sql` | Closes the Data API roles' access to `public`. Run before and again after the restore. |
| `scripts/supabase/schedule.sql` | `pg_cron` + `pg_net` jobs `worker-tick` and `worker-maintenance`, reading `app_url` and `cron_secret` from Vault. |
| `scripts/supabase/restore.ps1` | Laptop dump into Supabase, through `inventory-db-1`. |
| `scripts/supabase/dump.ps1` | Validated `pg_dump -Fc` of Supabase, through `inventory-db-1` or, with `-Image`, a throwaway container. |
| `scripts/supabase/counts.ps1` | Read-only exact row count per table in `public` (`-Target laptop` or `supabase`). |
| `scripts/supabase/smoke.mjs` | Read-only check: `/login` 200, `/api/worker/tick` 401 without the secret. |
