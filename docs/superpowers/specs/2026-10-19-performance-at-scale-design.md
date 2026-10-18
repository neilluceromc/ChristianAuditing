# Phase 43 — Performance at real size: 1,000 assets, 600 employees, 15 people at once

**Status:** APPROVED 2026-10-19 in chat; CODE-COMPLETE on branch `phase-43-performance`; the owner pre-approved merge, push and redeploy ("no need for approval for these tasks"); the after-run numbers will be added after the redeploy. One migration (35, `20261019090000_perf_indexes`).
- The owner chose to replace staging's demo data with a realistic large data set ("Replace staging data").
- The owner put this phase before client staff, which becomes Phase 44 (deeper assets becomes Phase 45).
- The owner confirmed the usage guess ("yes that's close"), then: "I'm going to sleep, test it then fix the problems and gaps we might encounter. No need for approval for these tasks." So the whole loop runs without stopping: seed, measure, fix, battery, merge, push, redeploy, re-measure.

## 1. What the owner asked for

"Improve the performance of the webapp, for example 15 people using it, doing tasks and changes, with 1,000 assets and 600 employees. Remove all seeded data and replace it with my requirement so we can test it."

**The people** (confirmed): 15 at once.
- 10 IT staff, mostly in Inventory, Employees, the Worklist and Approvals, each doing a few assignments and returns an hour;
- 2 Purchasing;
- 2 Finance;
- 1 admin.

## 2. Goals, non-goals, anti-goals

**Goals**
1. **A realistic large data set on staging** that anyone can sign in to and click around in:
   - 600 employees and 1,000 assets;
   - about 40 clients plus the internal departments;
   - several months of history;
   - 15 named test accounts.
2. **A repeatable load test** of 15 people working at once, with a written before/after report of page and action times.
3. **Every page and action people use daily feels quick under that load.** Targets, measured on staging, server time under the 15-person load:
   - p95 ≤ 1.0 s for list, record and action requests;
   - p95 ≤ 1.5 s for Home and the reports;
   - no request over 5 s;
   - no errors;
   - no database connection timeouts.
4. **Slow database work becomes visible from now on:** a switchable slow-query log.

**Non-goals**
- New features or UI changes beyond what a fix needs.
- Load-testing Cris against a live AI model (staging has no key; preview mode is fine).
- Horizontal scaling or a second web container.
- Changing the deploy pipeline.

**Anti-goals** (failure even if pages get faster):
- A count, total or list that shows a different answer than before. Every fix keeps results identical; the existing unit and browser tests stay green.
- Stale data people can notice. A change must show up on the next page view, as today.
- Losing the staging snapshot. A `pg_dump -Fc` backup is taken before the wipe.
- Crashing the laptop. Staging, the load test and the browser battery never run at the same time.
- The fixed seed records the browser tests rely on (BR-LT-0027, PR-0198, APR-2025, EMP-0042, the five role accounts…) changing on the dev database. The large data set is layered on top of the normal seed, so the dev battery still runs on the small seed alone.

## 3. The large data set (`npm run db:seed:scale`)

- **Layering:** runs after the normal seed (`npm run db:seed`) and adds to it. It is deterministic: a fixed random seed gives the same data every run.
- **The fixed seed records stay untouched.** New records use their own number ranges: tags `BR-xx-1000+`, employees `EMP-1000+`, requests `PR-1000+`, approvals `APR-5000+`.
- **Refusals:** it refuses to run when the database already holds the scale data. It writes in batches (`createMany`).

**Volumes**

| What | Total after the scale seed | Notes |
|---|---|---|
| Departments | about 8 internal teams + 40 clients | client names are fictional |
| Employees | 600 | about 70 % client staff; 5 % OFFBOARDING (some overdue); 5 % OFFBOARDED; 10 joined in the last 30 days |
| Assets | 1,000 | about 900 IT, 100 Purchasing |
| IT asset status mix | about 70 % DEPLOYED, 18 % SPARE, 4 % DEFECTIVE, 2 % MISSING, rest spread | every DEPLOYED or TEMPORARY asset has a holder |
| Asset details | category, type, vendor, purchase date over 5 years, warranty, cost | capitalised IT assets have cost and finance confirmation, so book value has data |
| Equipment policies | one per client, plus a few departments | gaps appear naturally |
| Purchase requests | about 150 over 6 months | every state represented, each with 1–5 units |
| Approvals | about 3,000 EXECUTED direct changes | plus about 40 PENDING or CLAIMED, a few overdue |
| Reservations | about 200 | mostly closed or fulfilled, about 20 active |
| Audit history | about 40,000 rows over 6 months | assignment, return, status, edit and offboarding entries |
| Notes on employees | about 1,500 | |
| Test accounts | 15 | `perf01…perf15@thebackroomop.com`, same role mix as §1, the seed password |

- **Triggers:** AuditEntry is append-only, so the scale seed only inserts. Asset status must stay within its class, as the database trigger enforces.
- **On staging,** the normal seed runs first. It truncates every table, so staging gets the five role accounts back plus the 15 test accounts, all with staging's seed password. Before the wipe, the controller records the email of any staging account that is not from the seed, so the owner knows what to recreate.

## 4. The load test (`scripts/loadtest/`)

- **The script:** a Node script, `node scripts/loadtest/run.mjs --base <url> --minutes <n>`, with no new heavy dependencies.
  - **Sign-in:** each of the 15 virtual people signs in as its own test account through `/api/auth/csrf` and `/api/auth/callback/credentials`, so per-user rate limits are not shared.
  - **Requests:** each person follows a weighted scenario for their role, with a 2–6 s think time: full page GETs of realistic URLs (lists with filters, search, sort, page 2, records, Home, Worklist, Approvals, reports, activity).
- **Writers:** real changes go through a real browser.
  - A small Playwright script (`scripts/loadtest/writers.mjs`) opens one headless browser with 3 contexts (2 IT, 1 approver).
  - Over the same minutes, those contexts loop through assigning a spare, returning it, and approving or rejecting a pending approval.
  - So server actions and their page refreshes are part of the load.
- **The report:** `scripts/loadtest/report.mjs` writes a Markdown table to `docs/perf/<date>-<label>.md`: per route and per action, count, p50, p95, max and errors. Before/after reports are committed.
- **Slow-query log:** a Prisma client extension logs any query slower than `SLOW_QUERY_MS` (env; off when unset) with its model, operation and duration, never its arguments.
- **Laptop safety:**
  - The load test runs alone against staging (the Docker stack). The dev server and the browser battery are stopped.
  - A full run is 8 minutes at most.

## 5. What gets fixed

Fixes are chosen from the measured baseline, worst p95 first, until the §2 targets are met. Each fix keeps results identical and has a unit test where logic changes.

The audit (2026-10-19) predicts these hot spots, in rough order:
1. **The `(app)` layout:**
   - about 25–30 uncached queries per page for IT and admin: nav counts, `worklistCount` with `hireWorkRows`, Cris reads with the flag read twice;
   - `requireUser()` repeated up to 3× per request (fix with React `cache()`);
   - three IT status counts that could be one `groupBy`.
2. **`/inventory`:**
   - about 20 queries per view;
   - the full-class `purchasedAt` scan for year chips (do it in SQL);
   - facet counts redoing the search;
   - the Attention sort loading the whole class with includes.
3. **Finance book value** depreciated in JS over every capitalised asset on every view, twice on the depreciation drill-down.
4. **`/audit` and the activity feeds:** `count(*)` + `OFFSET` + `groupBy` on 40k+ rows; unindexed search.
5. **`/employees` Policy gaps and Loadout sort:** all 600 people with assets loaded and computed in JS.
6. **`leaverStates()`** on every IT Home and Worklist load; `/offboarding` loading every leaver twice.
7. **The Prisma pool and the RepeatableRead paging transactions** holding connections.
8. **Missing indexes:**
   - `PurchaseUnit.requestId`, `AssetDocument.assetId`;
   - Asset `warrantyUntil`, `purchasedAt`, `defectiveSince`, `updatedAt`, `(cls, status)`;
   - `Approval.type`;
   - `PurchaseRequest.updatedAt`;
   - `AuditEntry (entityType, action, createdAt)`.
9. **`/equipment-by-client`** loading everyone's equipment.
10. **Unbounded history:** Approvals Closed, reservation facets.

**Allowed techniques:** indexes (one migration, `CREATE INDEX` only), SQL aggregation instead of JS loops, selecting only the needed columns, removing duplicate reads, React `cache()` within a request, and smaller `include`s.

**Cross-request caching** (`unstable_cache`) is allowed only with tag invalidation wired into the shared mutation revalidate helper, and only where the e2e "count changes after an action" tests stay green.

## 6. Testing and the finish

- **Unit tests** for every changed query helper (same results on fixtures).
- **The scale seed** has a unit-level check of its generators (counts, ranges, uniqueness) and a dev-database run.
- **The full browser battery** runs on the dev database with the normal small seed, as usual. It must stay green.
- **The order of the finish:**
  1. merge, push and redeploy (the migration applies);
  2. re-run the load test on staging and commit the "after" report;
  3. if a target is still missed, one more fix round, then report honestly what remains.
- **Docs:** HANDOVER, PICKUP and PENDING record the data set, the accounts (not the password), the reports and the numbers.

## 7. Left to the builder

- Fictional names and generators for people, clients and models.
- The scenario weights inside each role, within §1.
- The order and grouping of fixes after the baseline.
