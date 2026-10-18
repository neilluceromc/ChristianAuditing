# Phase 43 — Performance at real size: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load staging with a realistic 1,000-asset / 600-employee data set, measure 15 concurrent people, and fix
what's slow until the spec's targets hold.

**Architecture:**
- **Data:** a layered, deterministic scale seed on top of the normal seed.
- **Load harness:** a dependency-free Node harness (HTTP page GETs per role) plus a small Playwright writer for
  real server actions, writing Markdown reports.
- **Measurement and fixes:** a switchable Prisma slow-query log. Fixes are measurement-driven, limited to indexes,
  SQL aggregation, narrower selects, de-duplicated reads and per-request `cache()`.

**Tech Stack:** Next.js 15, Prisma 6 / Postgres 16, Node 20 (built-in `fetch`), Playwright, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-performance-at-scale-design.md`

## Global Constraints

- **Results stay identical:** every count, total, list order and label is unchanged. The existing vitest suite and
  the full Playwright battery stay green.
- **Changes show on the next page view:** no cross-request cache without tag invalidation in
  `src/server/modules/lifecycle/revalidate.ts`.
- **Migration:** one migration, `CREATE INDEX` statements only. Hand-write the SQL under `prisma/migrations/`.
  Apply on dev with `npx prisma migrate deploy`. Never `migrate dev`, `migrate reset` or `prisma format`.
- **The fixed seed's records** (BR-LT-0027, PR-0198, APR-2025, EMP-0042…) are untouched. Scale data uses its own
  ranges: tags `BR-xx-1000+`, `EMP-1000+`, `PR-1000+`, `APR-5000+`. Test accounts are
  `perf01…perf15@thebackroomop.com`: perf01–10 it_staff, perf11–12 purchasing_staff, perf13–14 finance_staff,
  perf15 admin.
- **Files are CRLF + UTF-8:**
  - edit with the Edit tool or Python (`encoding="utf-8", newline=""`);
  - never `sed -i`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Git:** commit by path. Never amend, stash, checkout, restore, reset or switch.
- **Secrets and environment:**
  - never read `.env`, never print a password, never put a password in a file;
  - scripts read the seed password from `SEED_PASSWORD`, falling back to the fixture constant;
  - implementers never touch the `inventory` database or port 3000 (the controller runs staging steps);
  - implementers run no Playwright and no dev server (the controller runs the battery at the end).
- **Commands:**
  - `npx vitest run <files>` / `npx vitest run`
  - `npx tsc --noEmit`
  - `npm run lint`

## Review Focus

1. **The scale seed vs the database triggers:**
   - AuditEntry is append-only;
   - Asset status must match its class;
   - one open approval per asset (partial unique index);
   - one active hold per asset.

   A violated constraint aborts the seed halfway. The seed must be correct on the first run.
2. **The harness must not hammer the laptop:** 15 virtual people with think time, not a tight loop. A hard stop at
   `--minutes`; it never spawns more than one browser.
3. **SQL replacing a JS loop must give identical results**, including null and empty cases (no purchase date,
   zero assets, a class with no rows). Unit tests compare against the old function on fixtures.
4. **Per-request `cache()` must not leak across users:** only React `cache()` (request-scoped), never module-level
   memoisation of user data.
5. **Index migration naming and ordering:** it must apply cleanly after migration 34 on both dev and staging.

---

### Task 1: The scale seed

**Files:**
- Create: `prisma/seed-scale.ts` (entry), `prisma/scale/generators.ts` (pure, deterministic generators)
- Modify: `package.json` (`"db:seed:scale": "tsx prisma/seed-scale.ts"`)
- Test: `prisma/scale/generators.test.ts` (check vitest's include pattern covers it; if not, put the test under
  `src/` or adjust the include)

**Interfaces:**
- Produces: `npm run db:seed:scale`, which prints a one-line summary of the counts it created.
- It refuses, with a message and exit 1, when any `EMP-1000+` employee already exists.

- [ ] **Step 1: Write generator tests.**
  - The same seed gives identical output.
  - Exactly 590 new employees, so the total is 600 with the 10 fixed ones.
  - Exactly 967 new assets, so the total is 1,000 with the 33 fixed ones.
  - The IT/Purchasing split and status mix are within ±2 % of spec §3.
  - Every DEPLOYED or TEMPORARY asset has a holder who is not OFFBOARDED.
  - Tags, `employeeNo` and `refNo` values are unique and in their ranges.
  - Every status belongs to its class's set (`STATUSES_BY_CLASS`).
  - Audit rows ≈ 40,000 (±5 %), with `createdAt` inside the last 6 months.
  - At most one PENDING/CLAIMED approval per asset, and at most one ACTIVE reservation per asset.
- [ ] **Step 2: Run** them and see them fail.
- [ ] **Step 3: Implement** the generators (seeded PRNG, e.g. mulberry32) and the entry:
  - It reads the existing fixed rows it needs (categories, types, vendors, departments, users), then inserts in
    batches of ≤ 1,000 with `createMany`, in foreign-key order.
  - The 15 users get the seed password hash (bcrypt like `prisma/seed.ts`).
  - Advance the sequences the app uses for refNos and tags (see `seed.ts:590-592`) past the new ranges.
- [ ] **Step 4: Run on dev:** `npm run db:seed && npm run db:seed:scale`. It must succeed and print the counts.
  Then `npm run db:seed` again to restore the small dev seed for the battery. Run the full vitest suite, tsc and
  lint.
- [ ] **Step 5: Commit.**

---

### Task 2: The load harness and the slow-query log

**Files:**
- Create:
  - `scripts/loadtest/run.mjs` (HTTP readers)
  - `scripts/loadtest/writers.mjs` (Playwright writers)
  - `scripts/loadtest/report.mjs` (Markdown report)
  - `scripts/loadtest/scenarios.mjs` (role → weighted URL list)
  - `scripts/loadtest/README.md` (how to run it, and the laptop-safety rule)
- Modify: `src/server/db/client.ts` (slow-query log extension)
- Test:
  - `src/server/db/slow-query.test.ts` (the logger formats model/op/duration, is silent when unset, and never logs
    args);
  - `scripts/loadtest/report.test.mjs` or a vitest test for the percentile maths (p50/p95 on known arrays).

**Interfaces:**
- `node scripts/loadtest/run.mjs --base http://host:port --minutes 6 --out <file.json>`
  - logs 15 users in (credentials callback, cookies kept per user);
  - each runs its role scenario with 2–6 s think time;
  - records `{route, ms, status}` per request into the JSON file;
  - a `route` is the URL with ids normalised (`/inventory/:id`).
- `node scripts/loadtest/writers.mjs --base … --minutes 6 --out <file.json>`
  - one headless Chromium, 3 contexts: perf01, perf02 (IT) and perf15 (admin approver);
  - loops: assign a spare to someone from an employee profile or the asset page, return it, approve or reject a
    pending approval;
  - records `{action, ms, ok}`.
- `node scripts/loadtest/report.mjs --in a.json --in b.json --label baseline --out docs/perf/2026-10-19-baseline.md`
  - per route/action: count, p50, p95, max, errors;
  - routes sorted by p95, descending;
  - a header with targets met or missed.
- **Slow-query log:** `SLOW_QUERY_MS` (unset = off) logs
  `[slow-query] <Model>.<operation> <ms>ms` via `console.warn`.

- [ ] **Step 1:** write the tests (percentiles; logger formatting and silence).
- [ ] **Step 2:** run them and see them fail.
- [ ] **Step 3: Implement.**
  - Scenario URLs come from the spec §1 role mix:
    - **IT:** inventory lists with filters/search/sort/page 2, asset records, employees lists (incl. Policy gaps),
      profiles, worklist, approvals, home, offboarding, reservations, equipment-by-client, activity feeds, audit.
    - **Purchasing:** purchases lists, a request record, suppliers, stock, home.
    - **Finance:** finance assets, depreciation (with a category drill-down), approvals, purchases, home.
    - **Admin:** home, users, approvals, IT pages with the `br.dept=it` cookie.
  - Record ids are discovered by fetching a list page and parsing hrefs; ids are never hard-coded.
- [ ] **Step 4:** run the unit tests, tsc and lint. Do NOT run the harness against anything; the controller does.
- [ ] **Step 5: Commit.**

---

### Task 3 onward: Fixes, chosen from the baseline report

The controller runs the baseline on staging and writes `docs/perf/2026-10-19-baseline.md` plus a slow-query
excerpt. It then cuts the fix work into tasks of one coherent area each (for example "layout fan-out", "inventory
list", "finance book value", "audit feeds", "employees gaps and leavers", "indexes"), worst p95 first, and records
each task's scope in the ledger as a ruling.

Each fix task:
- [ ] **Step 1:** tests pinning current results for every changed query helper. Fixture-level unit tests with
  mocked Prisma where the repo does that, or pure-function tests where logic moves to SQL-shaped data.
- [ ] **Step 2:** the change, using the spec §5 allowed techniques only.
- [ ] **Step 3:** run the full vitest suite, tsc and lint.
- [ ] **Step 4:** commit.

The index migration is its own task. Name it `prisma/migrations/20261019090000_perf_indexes/migration.sql`,
with `CREATE INDEX IF NOT EXISTS` statements only, and apply it on dev with `npx prisma migrate deploy`.

---

### Finish (controller)

1. Run the full Playwright battery on dev, with the normal seed (chunked, axe alone, reseed first and last).
2. Final whole-branch review, then one fix wave.
3. Docs.
4. Merge, push, CI image, redeploy (the migration applies).
5. Re-run the load test on staging and commit `docs/perf/2026-10-19-after.md`.
6. If a target is missed, one more fix round. Report the numbers.
