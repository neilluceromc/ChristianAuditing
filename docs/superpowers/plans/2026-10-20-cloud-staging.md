# Cloud Staging (Vercel + Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make the app run on Vercel Hobby with Postgres and files on Supabase, while local dev, e2e and the laptop stack keep working unchanged.

**Architecture:**
- **Worker:** the loop's step functions move into `src/worker/run.ts`. Two secret-guarded API routes run a budgeted tick and the maintenance jobs. Supabase `pg_cron` calls the routes. `kickWorker()` runs a tick via `after()` right after a job is queued.
- **Uploads:** they go through a storage driver: local disk, or the Supabase Storage REST API when its env vars are set.
- **Ops:** SQL and PowerShell scripts for lockdown, scheduling, restore, dump and smoke check, plus the `vercel-build` gate.

**Tech Stack:** Next.js 15 (App Router, `after` from `next/server`), Prisma 6, vitest, Supabase (Postgres, Storage, pg_cron, pg_net, Vault), Vercel Hobby.

**Spec:** `docs/superpowers/specs/2026-10-20-cloud-staging-vercel-supabase-design.md`

## Global Constraints
- **No new npm dependency.** Storage goes over `fetch` to `${SUPABASE_URL}/storage/v1/object/...` with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`.
- **Bucket name:** `documents`, private.
- **Env var names, exactly:**
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CRON_SECRET`
  - `DIRECT_URL`
  - `SIGNUP_REQUIRES_APPROVAL` (value `1`)
- **Platform detection:** `process.env.VERCEL` is truthy and `VERCEL_ENV=production`.
- **Behaviour without these env vars set:** identical to today. That covers local dev, e2e and the laptop.
- **Tick budget:** 45 000 ms. Route `maxDuration = 60`.
- **Upload cap:** `UPLOAD_MAX_BYTES = 4 * 1024 * 1024`.
  - Every user-facing "10 MB" becomes "4 MB".
  - The refusal is "Too big — the cap is 4 MB".
  - `SLOT_REFUSAL` is "PDF, PNG or JPG up to 4 MB".
- **`schema.prisma` is not changed.** No `directUrl`.
- **Secrets:** never read or print `.env`, and no secret value goes in any committed file.
- **Git:**
  - Never run `git stash`, `checkout`, `restore`, `reset`, `switch`, `--amend`, `rebase`, `pull` or `push`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Line endings:** CRLF files keep CRLF (Edit tool, or Python `newline=""`; never `sed -i`).
- **No Playwright and no dev server** during tasks; browser tests run at the end. Never `prisma migrate dev/reset/format` or `db push`.

## Review Focus
1. **A tick that throws mid-job.** The route still returns 200 with counts, the job is retried or DEAD exactly as the loop does it, and the route never 500s on one bad job. Covered in a Task 1 test.
2. **`kickWorker()` called outside a request scope**, for example from inside `executeApproval` when the worker emits a webhook. It must not throw, and must not start a nested tick while one is running. Covered in Task 1 tests.
3. **Storage path traversal or odd names.** `readUpload("../x")` and `readUpload("a/../../b")` return `null` in both drivers. A 404 from Supabase returns `null`, not a throw. Covered in Task 2 tests.
4. **The maintenance route when today's snapshot already exists.** It writes nothing new; the run is idempotent. Covered in a Task 1 test.
5. **Sign-up with approval required.** No session is created, and the new account is `disabled: true` with an audit entry. Signing in with it is refused as for any disabled account. Covered in Task 3 tests.

---

### Task 1: Worker step functions, tick and maintenance routes, `kickWorker`

**Files:**
- Create: `src/worker/run.ts`, `src/worker/run.test.ts`
- Create: `src/app/api/worker/tick/route.ts`, `src/app/api/worker/maintenance/route.ts`, `src/app/api/worker/routes.test.ts`
- Create: `src/server/worker-kick.ts`, `src/server/worker-kick.test.ts`, `src/lib/worker-state.ts`
- Modify: `src/worker/index.ts`, which keeps only the loop, signals and `main()` and imports everything from `./run`
- Modify: `src/middleware.ts:44`. Add `api/worker` to the negative lookahead beside `api/auth`.
- Modify, to call `kickWorker()`:
  - `src/server/modules/approvals/actions.ts`, beside both `revalidatePath("/approvals")` sites (around :94 and :260)
  - `src/server/webhooks/emit.ts`, after the `job.create` in the loop
  - `src/server/modules/admin/webhook-actions.ts`, after the replay's `job.create`

**Interfaces:**
- Produces, in `src/worker/run.ts`. Relative imports as today; `workerId` is passed in, never computed at module load.
  - `recoverStale(): Promise<number>`
  - `tick(workerId: string): Promise<boolean>`
  - `runTicks(opts: { workerId: string; budgetMs: number; now?: () => number }): Promise<{ done: number; budgetHit: boolean }>`. It loops `tick` until it returns false or the budget is spent.
  - `safePrune(): Promise<void>`
  - `safeExpire(): Promise<void>`
  - `safeSnapshot(now: Date): Promise<boolean>`. True on success; it logs and returns false on failure.
  - `snapshotMissing(now: Date): Promise<boolean>`. True when no `MetricSnapshot` row has `day` = `manilaDay(now)` (compare as `new Date(manilaDay(now) + "T00:00:00Z")`).
- Produces, in `src/lib/worker-state.ts`, which has no imports so there are no cycles:
  - `isTicking(): boolean`
  - `setTicking(v: boolean): void`

  `runTicks` sets the flag at its start and clears it in a `finally`.
- Produces, in `src/server/worker-kick.ts`:
  - `kickWorker(): void`. It does nothing unless `process.env.VERCEL`, and nothing while `isTicking()`.
  - Otherwise it calls `after(async () => { const { runTicks } = await import("@/worker/run"); await runTicks({ workerId: "kick-" + random, budgetMs: 45_000 }); })` from `next/server`.
  - That call sits inside a `try/catch` that swallows the out-of-scope error.
  - The dynamic import is required. `emit.ts` is reached from `execute-approval`, which `run.ts` imports, so a static import would be circular.
- Routes:
  - Both `POST`.
  - `export const maxDuration = 60; export const dynamic = "force-dynamic";`.
  - **Auth:** a header other than `Bearer ${CRON_SECRET}`, or an unset or empty `CRON_SECRET`, gets 401 with body `Unauthorized`.
  - **Tick route:** runs `recoverStale` then `runTicks(45_000)`, and returns JSON `{ recovered, done, budgetHit }`.
  - **Maintenance route:** runs `safePrune`, `safeExpire`, then `safeSnapshot` only if `snapshotMissing`, and returns JSON `{ snapshot: "written" | "exists" | "failed" }`.
  - Neither route lets an error escape as a 500.

- [ ] **Step 1: Write the failing tests.** Mock `../server/db/client` as `retention.test.ts` does.
  - `run.test.ts`:
    - "runTicks stops when tick finds no job": `done` 0, `budgetHit` false.
    - "runTicks stops at the budget": a fake `now` advances 30 000 per call, and `budgetHit` is true.
    - "a job whose handler throws is retried with backoff below MAX_JOB_ATTEMPTS and DEAD at it".
    - "snapshotMissing is false when a row exists for today's Manila day".
    - "safeSnapshot returns false and logs on failure".
  - `routes.test.ts`:
    - 401 with no header.
    - 401 with the wrong secret.
    - 401 when `CRON_SECRET` is unset, even with header `Bearer `.
    - 200 with the JSON shape.
    - Maintenance returns `exists` when `snapshotMissing` is false.
  - `worker-kick.test.ts`:
    - With no `VERCEL`, `after` is not called.
    - With `VERCEL=1`, `after` is called once.
    - With `VERCEL=1` and `after` throwing, nothing escapes.
    - With `ticking` set, `after` is not called.
- [ ] **Step 2:** `npx vitest run src/worker src/app/api/worker src/server/worker-kick.test.ts`. The new tests should FAIL.
- [ ] **Step 3: Implement.** Move the bodies out of `index.ts` without changing their logic.
  - `index.ts` keeps `WORKER_ID`, `POLL_MS`, `ONCE`, the `last*` state, `draining`, the loop and the signals.
  - The loop calls `safeSnapshot(new Date())` and sets `lastSnapshotDay` on true, using the same `snapshotAttemptDue` logic as today.
- [ ] **Step 4:** `npx vitest run`, all pass; `npx tsc --noEmit` exits 0.
- [ ] **Step 5:** `npm run worker:once` against the dev DB. It exits 0 and logs the snapshot line, as before.
- [ ] **Step 6:** commit `feat(worker): tick and maintenance routes, kickWorker after enqueue`.

### Task 2: Storage driver and download routes; 4 MB cap

**Files:**
- Create: `src/server/storage.ts`, `src/server/storage.test.ts`
- Modify: `src/server/uploads.ts`
  - `storeUpload` writes through the driver.
  - `UPLOAD_MAX_BYTES` becomes 4 MB, and the refusal copy changes to match.
- Modify the five download routes (`readFile` + path guard → `readUpload`):
  - `src/app/(app)/employees/[id]/acknowledgements/[ackId]/download/route.ts`
  - `src/app/(app)/inventory/[id]/(record)/documents/[docId]/download/route.ts`
  - `src/app/(app)/purchases/[id]/documents/[docId]/download/route.ts`
  - `src/app/(app)/purchases/suppliers/[id]/documents/[docId]/download/route.ts`
  - `src/app/(app)/stock/lots/[id]/documents/[docId]/download/route.ts`
- Modify the copy ("10 MB" → "4 MB"):
  - `src/components/employees/side-card/form-tab.tsx:181`
  - `src/components/inventory/document-slots.tsx:46`
  - `src/components/patterns/file-drop.tsx:26`
  - `src/components/purchases/request-documents-card.tsx:128`
  - `src/components/stock/lot-document-dialog.tsx:78`
  - `src/components/suppliers/supplier-documents-card.tsx:103`
  - plus any test asserting the old copy (`src/server/uploads.test.ts` and others found by `grep -rn "10 MB" src e2e`)

**Interfaces:**
- Produces, in `src/server/storage.ts`:
  - `writeObject(relPath: string, bytes: Buffer, contentType: string): Promise<void>`
  - `readUpload(relPath: string): Promise<Buffer | null>`
  - `storageDriver(): "supabase" | "local"`, which returns `"supabase"` iff both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are non-empty
- **Local driver:** today's `uploads/` under `process.cwd()`, with the traversal guard as in the routes.
- **Supabase driver:**
  - Write: `POST /storage/v1/object/documents/<relPath>` with `x-upsert: false`.
  - Read: `GET /storage/v1/object/authenticated/documents/<relPath>`.
  - 404 → `null`; any other non-2xx → throw.
- **Both drivers:** a `relPath` containing a `..` segment, a leading `/`, or a backslash gives `null` on read and a throw on write.

- [ ] **Step 1: Write the failing tests** in `storage.test.ts`, stubbing global `fetch`:
  - The driver choice for every env combination.
  - The Supabase write hits the right URL, the auth header and the content-type.
  - The Supabase read: 200 → bytes; 404 → `null`; 500 → throws.
  - Traversal paths → `null` in both drivers.
  - A local round-trip in a temp `cwd`.
- [ ] **Step 2:** `npx vitest run src/server` → the new tests FAIL.
- [ ] **Step 3: Implement.** The routes keep their auth and visibility checks unchanged, call `readUpload(row.path)`, and return 404 on `null`.
- [ ] **Step 4:** `npx vitest run` and `npx tsc --noEmit`. Then `grep -rn "10 MB" src`, which must return no matches.
- [ ] **Step 5:** commit `feat(uploads): storage driver (local or Supabase) and a 4 MB cap that matches the request limit`.

### Task 3: Sign-up needs approval on cloud

**Files:**
- Modify: `src/server/auth/actions.ts` (`signUp`, `AuthFormState`)
- Modify: `src/components/login/sign-in-card.tsx` (the `signup-done` view)
- Test: the existing auth action tests and `src/components/login/sign-in-card.test.tsx`

**Interfaces:**
- `AuthFormState` gains `pendingApproval?: boolean`.
- When `process.env.SIGNUP_REQUIRES_APPROVAL === "1"`:
  - The user is created with `disabled: true`.
  - The audit diff also records `disabled: { from: null, to: true }`.
  - `signIn` is not called.
  - The action returns `{ created: true, pendingApproval: true }`.
- When `pendingApproval` is set, the `signup-done` step replaces its "You're in" copy with:
  - heading "Account created"
  - body "An admin needs to approve it before you can sign in."
  - a button back to sign in. Reuse the step's existing link or button pattern.

- [ ] **Step 1: Write the failing tests:**
  - Action with the env set → `create` called with `disabled: true`, `signIn` not called, return value as above.
  - Env unset → today's behaviour.
  - Card with `pendingApproval` → the new copy, and no "You're in".
- [ ] **Step 2:** run the tests → they FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npx vitest run` and `npx tsc --noEmit`.
- [ ] **Step 5:** commit `feat(auth): self sign-up waits for an admin when SIGNUP_REQUIRES_APPROVAL=1`.

### Task 4: Vercel build gate, `vercel.json`, Supabase scripts, docs

**Files:**
- Create: `scripts/vercel-build.mjs`, `scripts/vercel-build.test.ts`
- Modify: `package.json`. Add `"vercel-build": "node scripts/vercel-build.mjs"`.
- Create: `vercel.json`
- Create: `scripts/supabase/lockdown.sql`, `scripts/supabase/schedule.sql`
- Create: `scripts/supabase/restore.ps1`, `scripts/supabase/dump.ps1`, `scripts/supabase/smoke.mjs`
- Create: `docs/CLOUD-STAGING.md`
- Modify: `docs/HANDOVER.md` / `docs/PICKUP.md`. Add a short "cloud staging (code-ready, not cut over)" entry in the existing style. It points to `docs/CLOUD-STAGING.md`, lists the five new env vars, and says Phase 47 numbering is unchanged.
- Modify: `.env.example`. Add the five new names, commented, with no values.

**Interfaces and exact contents:**
- **`vercel-build.mjs`** exports `buildSteps(env): string[][]` for the test, and runs the steps with `spawnSync(..., { stdio: "inherit" })`, exiting non-zero on the first failure.
  - **Always:** `["npx","prisma","generate"]`, then `["npx","next","build"]`.
  - **When `VERCEL_ENV === "production"`:** `["npx","prisma","migrate","deploy"]` goes between them, run with `DATABASE_URL` set to `env.DIRECT_URL`.
  - If `DIRECT_URL` is empty there, it throws `"DIRECT_URL is required for production migrations"`.
- **`vercel.json`:** `{ "regions": ["sin1"], "git": { "deploymentEnabled": { "main": true, "*": false } } }`.
- **`lockdown.sql`** is idempotent:
  - `revoke all on all tables in schema public from anon, authenticated;`
  - the same for sequences and functions;
  - `alter default privileges in schema public revoke all on tables from anon, authenticated;`, plus sequences and functions.
  - A header comment says to run it before and again after the restore.
- **`schedule.sql`:**
  - `create extension if not exists pg_cron; create extension if not exists pg_net;`
  - Reads `app_url` and `cron_secret` from `vault.decrypted_secrets`.
  - `cron.schedule('worker-tick', '* * * * *', $$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='app_url') || '/api/worker/tick', headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds := 60000) $$);`
  - Likewise `worker-maintenance` at `'5 * * * *'` for `/api/worker/maintenance`.
  - It unschedules both names first so it can be re-run.
  - A header comment shows the two `vault.create_secret(...)` calls with placeholder values.
- **`restore.ps1`:**
  - Arguments: a `-Dump <path>` param.
  - Requires `$env:SUPABASE_DB_URL`, which it never echoes.
  - Steps: `docker cp` the dump into `inventory-db-1:/tmp/restore.dump`, then `docker exec -e PGURL inventory-db-1 pg_restore --no-owner --no-privileges --schema=public --exit-on-error -d "$PGURL" /tmp/restore.dump`, passing the URL via `-e PGURL=$env:SUPABASE_DB_URL`.
  - Afterwards it removes `/tmp/restore.dump`.
- **`dump.ps1`:**
  - Arguments: an `-Out <path>` param.
  - Same env var. Runs `pg_dump -Fc` inside the container to `/tmp`, validates it with `pg_restore -l | grep -c "TABLE DATA"`, prints the count, then `docker cp` out.
- **`smoke.mjs`:** run as `node scripts/supabase/smoke.mjs <appUrl>`.
  - Asserts `GET /login` is 200.
  - Asserts `POST /api/worker/tick` with no header is 401.
  - Prints PASS or FAIL per check and exits non-zero on any failure.
  - Row-count comparison is done separately, by the controller, with `psql` in the container.
- **`docs/CLOUD-STAGING.md`:** the spec's §6 owner steps as a numbered runbook.
  - Where each value comes from in the Supabase and Vercel dashboards.
  - The env var table.
  - "never set QUICK_LOGIN_EMAILS".
  - The backup rule: dump before pushing a migration.
  - How to restart the laptop stack: `docker compose start web worker`.
  - No secret values anywhere.

- [ ] **Step 1:** test `vercel-build.test.ts` for `buildSteps`:
  - production adds migrate with `DIRECT_URL`;
  - preview and development do not;
  - production without `DIRECT_URL` throws.
- [ ] **Step 2:** run it → FAIL.
- [ ] **Step 3:** implement all files.
- [ ] **Step 4:** run `npx vitest run` and `npx tsc --noEmit`. Then `node scripts/supabase/smoke.mjs http://localhost:3100`, which must FAIL cleanly with "connection refused" reported as FAIL (no stack trace). No server is running, which proves the error path.
- [ ] **Step 5:** commit `feat(ops): Vercel build gate and Supabase lockdown, schedule, restore, dump and smoke scripts`.
