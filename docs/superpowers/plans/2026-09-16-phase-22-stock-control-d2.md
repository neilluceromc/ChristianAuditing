# Phase 22 — Stock control D2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the D1 stock ledger FIFO lot consumption and costing with an allocation table, optional lot expiry with earliest-expiry-first issues and write-offs, three report pages with exports, receipt documents on lots, two Purchasing Home tiles, and close the six D1 leftovers — with D1's history backfilled inside the migration.

**Architecture:** Migration 23 adds `StockLot.expiresAt`/`origin`, the append-only `StockAllocation` table, `StockLotDocument`, and a plpgsql backfill that gives every D1 inflow a lot and every outflow its allocations, asserting the result. One pure module (`src/lib/stock-allocation.ts`) owns the consumption order; one server helper pair (`recordOutflow` / `recordInflowLot` in `movement-actions.ts`) is the only writer of allocations and non-receipt lots, used by issue, adjust, write-off and stocktake posting. Reports are read-only queries over lots and allocations with xlsx twins. UI adds a Lots card and three dialogs to the item page, an Expires field, list pills, three report pages and two Home tiles.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, Auth.js v5, zod 4, vitest, Playwright + axe; existing `pagedSnapshot`, `pageOf`, `ListState`/`withFilter`, `EntityCombobox`, `Tabs` (labelled), `toXlsxBuffer`, `storeUpload`/`validateUpload`, `ActionFailure`, `localDateISO`/`fmtDate`/`fmtMoney`.

**Spec:** `docs/superpowers/specs/2026-09-16-stock-control-d2-design.md` — the binding authority.

## Global Constraints

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`. Never the `inventory` database, never port 3000. Never read or print `.env` (check a key's presence with `grep -c "^NAME=" .env`, never its value).
- Dev server for a manual walk: `npm run dev -- -p 3100` (plain `npm run dev` binds the staging stack's 3000); only ONE implementer walks a dev server at a time (the Browser pane is shared); a parallel implementer verifies with tsc/eslint/vitest/curl only.
- Playwright: foreground only, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a time, port free before, no server left behind.
- `"use server"` modules export only async functions; zod at every boundary; `ActionResult` union; role guard (`actionUser` + `canManageStock`) THEN `checkRate`; one `writeAudit` per write; refusals found after the item row lock are THROWN as `ActionFailure` inside the transaction and mapped outside (D1 R2/I-1).
- Additive migration plus its asserted backfill; the seed's TRUNCATE gains the two new tables.
- Every D1 rule unchanged (§1 of the spec); every existing URL unchanged; dates on the Asia/Manila calendar (`localDateISO`, `fmtDate`).
- Tests first for pure modules; measured counts in commit messages; never amend; commit after every task by explicit file list.
- Reviewer subagents: read-only — never `git stash`, `git checkout`, `git restore`, `git reset`, `git switch`; verification in the foreground; report written before the reply.

## Decisions the plan makes beyond the spec

- **P-1** `recordOutflow` and `recordInflowLot` live in `movement-actions.ts` and are exported for `stocktake-actions.ts` to import — a plain TypeScript export from a `"use server"` module is not allowed, so they live in a new non-server module `src/server/modules/stock/ledger.ts` that both action modules import. (Spec §5.2 names them; this fixes where.)
- **P-2** `allocate()` receives lots already reduced to `LotState` by the caller; the server builds `remaining` from one `groupBy` over allocations for the item's lots, inside the transaction, under the item's `FOR UPDATE` lock.
- **P-3** The backfill walks lots by `lotDate, id` with the "lotDate <= occurredAt, else all lots" rule as two passes per movement (constrained, then unconstrained for any remainder), so a D1 backdated receipt never leaves an outflow unallocated.
- **P-4** Report pages read `ListState` for the Category facet via the existing `parseListState` with a small `STOCK_REPORT_LIST_CONFIG` (`facets: ["category"]`, no sort) so `withFilter` and the toolbar pattern work unchanged; the date range and the expiry window are plain query params (`from`, `to`, `days`) parsed by `stock-reports.ts`.
- **P-5** Execution order: Task 1 ‖ Task 2 (schema vs pure rules, disjoint, no DB for Task 2); then Task 3 ‖ Task 4 ‖ Task 5 (seed vs actions vs queries — disjoint files; only Task 3 touches the database); then Task 6 ‖ Task 7 (item/list/Home UI vs report UI — Task 6 walks the dev server, Task 7 verifies with curl on `-p 3101`); then Task 8, Task 9, Task 10 in sequence (each runs Playwright).
- **P-6** The e2e document case uploads a tiny PDF fixture `e2e/fixtures/delivery-receipt.pdf` (a few hundred bytes, committed) rather than generating one at run time.

## Amendments made during execution (`D-1`…`D-15`, from the SDD ledger, 2026-09-16 — `D-16`+ reserved for the final whole-branch review and its fix wave)

Pre-flight and early rulings:

- **D-1** (ruling R1) — measured counts govern every number in the plan and the docs.
- **D-2** (R2) — the command palette's Stock group is a search over items, not a static page list; the three reports reach the palette through the new `Reports` entry in `WORKSPACE_NAV`, so `palette.ts` is untouched (spec §3/§5.4 read accordingly).
- **D-3** (R3) — write-off, set-cost and document audits stay on `entityType: "stock-item"` with the lot named in the diff, like every D1 stock audit; no `stock-lot` entity type and no audit-resolver change (spec §5.4 superseded).
- **D-4** (R4, spec §2.8 amended twice) — the seeded expiring lot with units remaining is `PN-0002`'s receipt (100 @3.10, expires +20 d): `PN-0001`'s expiring lot is fully consumed by the seeded 110-issue (FEFO takes it first) and `PN-0004`'s would be consumed by its seeded 50-issue; without a surviving expiring lot the Expiring block and the Home tile would read empty on a fresh database.
- **D-5** (R5, Task 2 → controller) — widening `StockRefs.categoriesByKey` with `archived` broke `resolve.ts`'s `buildStockRefs`, which no task owned; the controller fixed it in its own commit (`ea4a06e`), and the import apply path's archived re-check (spec §4.5) was assigned to Task 4.

Task rulings:

- **D-6** (Task 1) — migration 23's plpgsql backfill applied on the D1 seed data with all three assertions passing; independent check 0 failures over 25 movements / 19 lots; PN-0001's D1 history replays as plain FIFO by lot date (opening 90 consumed, receipt 40 remaining). Review clean (0 findings). `migration_lock.toml`'s line-ending touch left out of the commit.
- **D-7** (Task 2) — the pure rules landed tests-first (1401 unit / 79, +84); review spec ✅, test and code quality Approved. Its one Important was the plan gap D-5 already closed; three Minors parked: the `stock.written-off` diff stores `quantity.to` as the formatted `unitsLabel` string (Task 4 writes exactly that shape); the import's unit-cost cell has no `.multipleOf(0.01)` check (the column is `Decimal(12,2)`, so it can only round); `expiryBuckets`' exact-boundary day has no dedicated test.
- **D-8** (Task 3) — the seed writes every inflow as a lot and every outflow through `allocate()` itself, so a fresh database and a migrated one obey one rule; all three invariants hold across the twelve items. One expectation in the controller's facts file was wrong and the rule was right: under both policies a dated lot sorts before an undated one, so CM-0001's stocktake −2 draws from its receipt lot expiring in 200 days (12 → 10), not the uncosted opening lot — tests derive their numbers from the database, never from that file. Review clean (0 findings; two lot pictures recomputed by hand).
- **D-9** (Task 4) — the ledger helper pair lives in `ledger.ts` (P-1) and is the only writer of allocations and non-receipt lots: issue, adjust, write-off and stocktake posting all route through it, and — beyond the brief — so does the importer's opening stock (`applyStockImport` was the one other `OPENING` writer; without it a fresh import would break the Σ remaining = balance invariant). The import apply path re-checks an archived category (R5). `writeOffLot` reads the open lots twice under one lock (once for the default quantity, once inside the helper) — redundant, accepted. Review: two Importants, both fixed by the controller (R6) — the movement actions and the stocktake posting now revalidate the three report pages (spec §7 named "the reports"; no task's file list had them), and a posting computes one instant and one Asia/Manila day before its per-line loop instead of per line, so a posting that straddles midnight treats every line alike.
- **D-10** (Task 5) — the report queries landed in their own module (`report-queries.ts`) so Tasks 3–5 never shared a file; a live smoke against the seeded database matched every expected number (low 1, expiring 1, the expiring block PN-0002 ₱310.00, the expired block PN-0003 ₱90.00, consumption 204 units / ₱555 / 144 uncosted). Beyond the brief: `today`/`state` parameters default (`localDateISO(new Date())`, an empty list state) so earlier callers compile; `expiringCount` and a per-row `expiring` flag on the export rows for the list's stat line; `fmtMoneyExact` (two decimals) in `format.ts` for lot unit costs. Review: one Critical and one Important, both fixed by the controller (R7) — the consumption report bounded its range as UTC-midnight instants (`[from 00:00Z, to 00:00Z]`) although issues, adjustments and write-offs carry the real transaction time, so everything after 08:00 Manila on the last day was dropped; `manilaDayBounds(from, to)` now yields local-midnight instants with `to` inclusive (`gte start, lt endExclusive`), unit-tested at the 15:59:59Z / 16:00Z boundary; and `STOCK_REPORT_LIST_CONFIG.facets` lacked `uncosted`, so `?uncosted=1` never reached the state and the on-hand toggle was dead — added, with a test. Two Minors parked (`getStockItem`'s extra bounded round trips per page; the undocumented harmless additions).
- **D-11** (Task 6) — the Lots card, the three dialogs, the History cost cell, the Expires field, the list pill and toggle, the two Home tiles, the Reports nav entry and D1 leftovers 3–5 landed together; the manual walk confirmed every check on the seeded data (EXPIRED pill, "Available 300 (100 expired)", a write-off closing the lot with a ₱90.00 history row, set-cost once, an Expires lot, the toggle, tiles 1/1). `workspaces.test.ts`'s exact nav assertion was updated for the Reports entry. Review clean (0 findings; no D1 `stock.spec.ts` locator at risk).
- **D-12** (Task 7, ruling R8) — the three report pages and their exports landed while Task 6's write-off dialog was still uncommitted, so the expiry report's Write off button shipped as a disabled placeholder and the expiry rows carried no `unit` for the dialog's toast; a fix round after Task 6 adds `unit` to the expiry rows and wires the real dialog. Review: spec ✅, quality Approved; one Important — the reports' Category facet was a native single `<select>` in a GET form while the Stock list uses the multi-select `FacetDropdown` for the same facet one page away; **ruling R9:** the reports adopt the list's `FacetDropdown` (same component, same `category` key, hrefs keep `from`/`to`/`days`), and the `EXPIRED`/`EXPIRING` pills share one component with the item page and the list (the Minor). All three landed in fix round 1 (`83254be`).
- **D-13** (Task 8, ruling R10) — `stock-lots.spec.ts` (8 cases) landed green twice with a committed minimal PDF fixture; the fixture has no NUL byte, so git's text heuristic plus `core.autocrlf=true` could have CRLF-mangled it on a later checkout — a `.gitattributes` now marks `*.pdf`, `*.xlsx` and image files `binary` (controller commit). Case 3 asserts the expired-units refusal sentence byte-for-byte against `ledger.ts`. Review clean (0 findings).
- **D-14** (Task 9) — `stock-reports.spec.ts` (6 cases, no `.serial` needed — every case is read-only) landed green twice, foreground: **Run 1 6 passed (54.5s)** — 1: 8.3s, 2: 2.2s, 3: 2.4s, 4: 2.1s, 5: 4.3s, 6: 8.9s; **Run 2 6 passed (54.8s)** — 1: 8.0s, 2: 2.2s, 3: 3.2s, 4: 2.4s, 5: 4.2s, 6: 9.1s; `--list` confirmed **319 tests in 31 files** (313 + 6, 30 + 1). Every expected number is derived from the database or imported from source (`monthKey`, `ON_HAND_EXPORT_COLUMNS`, `CONSUMPTION_EXPORT_COLUMNS`) rather than reimplemented, so the on-hand/consumption/expiry/list/Home assertions cannot drift from the app's own rules by construction. Review: spec ✅ (all six cases), test quality Approved, 0 Critical, 0 Important, 1 Minor — the axe-settle `waitForTimeout(700)` is a verbatim reuse of D1's `stock.spec.ts` helper (a documented, already-shipped exception to the no-`waitForTimeout` rule, not a new sleep-based wait), accepted as-is, no fix needed.
- **D-15** — Measured at close, branch tip `dfb1a0f` (2026-09-16, before the docs commit): `tsc` clean · `lint` clean · **23 migrations**, schema up to date · **1404 unit / 79 files** · **319 e2e / 31 files** by `--list` — seven foreground chunks with explicit file paths (chunk E split into E1/E2 per spec §9.3, since the combined chunk would have carried 67 tests), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.7m) · E1 36 passed (5.6m) · E2 31 passed (3.0m) · F 30 passed (3.2m) = 319**, zero failed, zero did-not-run, all first pass, no re-run needed anywhere in the battery. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last (only stale `TIME_WAIT` entries, confirmed via `netstat -ano | findstr :3100 | findstr LISTENING` returning nothing).
- **D-16+** — reserved for the final whole-branch review and its fix wave.

---

## File structure

See spec §10. New pure modules and their tests sit in `src/lib`; the ledger helper pair in `src/server/modules/stock/ledger.ts`; report queries in `src/server/modules/stock/report-queries.ts` (new, so Task 5 and Task 4 never edit the same file as Task 3's seed); UI in `src/components/stock/` and `src/app/(app)/stock/`.

---

### Task 1: Schema, migration 23 with the backfill

**Files:** `prisma/schema.prisma` (`StockLot`, `StockMovement`, `User` back-relation, new models/enum), `prisma/migrations/<ts>_stock_lots_and_allocations/migration.sql`.

**Interfaces — Produces:** the Prisma models of spec §2.1–§2.3 exactly; `Prisma.TransactionIsolationLevel` unchanged; the migration's guards and backfill of §2.6–§2.7.

- [ ] **Step 1: Schema** — `StockLot` + `expiresAt DateTime?`, `origin StockLotOrigin @default(RECEIPT)`, `allocations StockAllocation[]`, `documents StockLotDocument[]`, `@@index([itemId, expiresAt])`; `enum StockLotOrigin { RECEIPT OPENING ADJUSTMENT }`; `model StockAllocation` and `model StockLotDocument` per §2.2–§2.3 (`User` gains `stockLotDocuments StockLotDocument[] @relation("stockLotDocuments")`; `StockMovement` gains `allocations StockAllocation[]`).
- [ ] **Step 2: Migration** — `npx prisma migrate dev --name stock_lots_and_allocations --create-only`; append §2.6's trigger and CHECK, then §2.7's `DO $$ … $$` block. Write the replay as a `FOR item IN SELECT DISTINCT "itemId" …` loop; inside, cursor over negative movements ordered `"occurredAt", "id"`; per movement, first pass over lots `WHERE "lotDate" <= mv."occurredAt"` ordered `"lotDate", "id"`, second pass over all lots for any remainder (P-3); compute a lot's remaining as `quantity - COALESCE((SELECT SUM(quantity) FROM "StockAllocation" WHERE "lotId" = lot.id), 0)`; insert allocations with `gen_random_uuid()::text`-style ids only if the project's other SQL backfills do — otherwise use `md5(random()::text || clock_timestamp()::text)` for a cuid-length text id, matching whatever Prisma's `@id @default(cuid())` column type accepts (text). End with the three `RAISE EXCEPTION` assertions of §2.7 step 5.
- [ ] **Step 3: Apply and prove on `inventory_dev`** (which holds the D1 seed at 22 migrations): `npx prisma migrate deploy` → 23; `npx prisma generate`; then prove with `psql`-free Prisma one-liners through `npx tsx -e` (no `.env` printing): every negative movement's allocations sum to `-quantity`; every positive movement has a `lotId`; per item Σ remaining = balance; `PN-0001`'s allocations read as expected for the D1 history (opening lot 90 uncosted, receipt lot 60 at 9.25: the 110-issue took 90 from the opening lot and 20 from the receipt — plain FIFO, no expiry pre-D2). Record the outputs in the report.
- [ ] **Step 4: Re-run the seed** (`npm run db:seed` — the D1 seed still works because the new columns default) and re-run `npx prisma migrate deploy` is a no-op; `npx tsc --noEmit`; `npx vitest run` (baseline).
```bash
git commit -m "feat(schema): Phase 22 -- StockLot.expiresAt/origin, StockAllocation (append-only), StockLotDocument; migration 23 backfills D1 lots and allocations and asserts them" -- prisma/schema.prisma prisma/migrations
```

---

### Task 2: Pure rules — allocation, reports, schemas, export columns, import fixes

**Files:** create `src/lib/stock-allocation.ts` (+ `.test.ts`), `src/lib/stock-reports.ts` (+ `.test.ts`); modify `src/lib/stock-schema.ts` (+ test), `src/lib/stock-list.ts` (+ test), `src/lib/export-columns.ts` (+ test), `src/lib/import-stock.ts` (+ test), `src/lib/import-vocabulary.ts` (+ test), `src/lib/activity.ts` (+ test).

**Interfaces — Produces:** spec §4.1's exports verbatim; §4.2's functions; `receiptSchema.expiresAt`, `writeOffSchema`, `setLotCostSchema`, `LOT_DOCUMENT_KINDS = ["delivery-receipt", "invoice", "other"] as const`; `STOCK_LIST_CONFIG.facets` gains `"expiring"` and `buildStockItemWhere` ignores it (the server applies it over candidates, like `low`); `ON_HAND_EXPORT_COLUMNS`, `CONSUMPTION_EXPORT_COLUMNS`, `EXPIRY_EXPORT_COLUMNS` with row types `OnHandExportRow`, `ConsumptionExportRow`, `ExpiryExportRow`; `StockRefs.categories[].archived`, cause `archived-stock-category`, the two-key duplicate; `auditSentence` cases `stock.written-off`, `stock.lot-cost-set`, `stock.document-added`; `STOCK_REPORT_LIST_CONFIG` (P-4) and `parseReportRange(sp, today)`, `parseExpiryWindow(sp)`.

- [ ] **Step 1: Tests first** — write every case spec §9.1 lists for the seven test files (allocation: a 4-lot fixture with expiry `+3d`, `null`, `-2d`, `+10d`; "skip" order = `+3d, +10d, null`; "first" order = `-2d, +3d, +10d, null`; allocate 70 across remaining `[30, 50, 20]` → `[30, 40]`; exact fit; shortfall `{ short: 5, expiredRemaining: 20 }`; cost null when only uncosted; mixed cost; `expiryLabel` "expired 2 days ago" / "expires today" / "expires in 3 days" with `today = "2026-09-16"`; `onHand` sums; `allocate(lots, 0, …)` throws. Reports: `monthKey(new Date("2026-08-31T15:59:00Z")) === "2026-08"`, `"2026-08-31T16:00:00Z" → "2026-09"`; `monthsBetween("2026-04-01","2026-09-16")` → 6 keys; grid totals and the uncosted flag; `expiryBuckets`; `defaultConsumptionRange("2026-09-16")` → `{ from: "2026-04-01", to: "2026-09-16" }`). Run red.
- [ ] **Step 2: Implement** `stock-allocation.ts` and `stock-reports.ts`; run green.
- [ ] **Step 3: Schemas, list config, export columns** — `expiresAt` refinement message `Expires cannot be before the lot date`; the two new schemas; the facet; the three column sets (money via the existing money cell shape; dates as `Date` cells with `yyyy-mm-dd`).
- [ ] **Step 4: Import** — `StockRefs.categories` gain `archived`; planner blocks `archived-stock-category`; a code row registers the matched item's `new:` key too (spec §4.5); unit cost carried on CREATE rows (`StockCreateData.unitCost: number | null`); remove the "Unit cost is ignored" notice and its test; vocabulary entry appended with the spec's label/explain, no fix option; totality test.
- [ ] **Step 5: Audit sentences** — the three cases in `activity.ts` (e.g. `wrote off 12 sachets of PN-0003 — Expired`, `priced a lot of OS-0003 at ₱9.00`, `attached a delivery receipt to OS-0001`), with tests.
- [ ] **Step 6: Verify** — `npx tsc --noEmit`; `npx eslint src/lib`; `npx vitest run` (record).
```bash
git commit -m "feat(stock): pure rules for lot allocation (FEFO, expired skip/first), report grids and buckets, expires/write-off/set-cost schemas, three export column sets, import unit cost honoured, archived-category and two-key duplicate blocks, audit sentences" -- src/lib
```

---

### Task 3: Seed

**Files:** `prisma/seed.ts` (the Phase 19 block ~531–607 and the TRUNCATE list ~27–32).

**Interfaces — Consumes:** Task 1's models, Task 2's `allocate`, `LotState`.

- [ ] **Step 1** — TRUNCATE gains `"StockLotDocument", "StockAllocation"` before `"StockLot"`.
- [ ] **Step 2** — Opening movements create an `OPENING` lot (`lotDate = day(-30)`, `unitCost null`, `receivedById: purchasing.id`) and set `lotId`. The `receipt()` helper takes `expiresAt?: Date | null` and an optional `unitCost: number | null`; add the two new receipts and the three expiries of spec §2.8.
- [ ] **Step 3** — `issue()` reads the item's lots and allocations written so far, builds `LotState[]`, calls `allocate(lots, qty, localDateISO(day(-daysAgo)), "skip")`, writes the movement and its allocations (throw if `!ok` — the seed must be internally consistent). The stocktake's −2 on `CM-0001` allocates via the same path with `"first"`; the +1 on `CM-0003` creates an `ADJUSTMENT` lot.
- [ ] **Step 4: Verify** — `npm run db:seed` twice; a `npx tsx -e` check that Σ remaining = balance for every item and that `PN-0001`'s receipt lot has remaining 0 and its opening lot 40; `PN-0003`'s expired lot has remaining 100; `npx tsc --noEmit`.
```bash
git commit -m "feat(seed): Phase 22 -- opening/adjustment lots, allocations through allocate(), two new receipt lots (uncosted OS-0003, expired PN-0003), expiries on PN-0001 and CM-0001" -- prisma/seed.ts
```

---

### Task 4: Server actions — the ledger helper pair, write-off, set cost, documents

**Files:** create `src/server/modules/stock/ledger.ts` (P-1), `src/server/modules/stock/document-actions.ts`, `src/app/(app)/stock/lots/[id]/documents/[docId]/route.ts`; modify `movement-actions.ts`, `stocktake-actions.ts`, `src/server/modules/audit/queries.ts` (the `stock-lot` label resolver if the audit resolver maps entity types), `src/server/palette.ts`.

**Interfaces — Produces:**
```ts
// ledger.ts (not "use server")
export async function openLots(tx, itemId): Promise<LotState[]>;                    // remaining > 0, via one groupBy over allocations
export async function recordOutflow(tx, args: { item: { id; code; unit }; kind: "ISSUE" | "ADJUSTMENT"; quantity: number; policy: ExpiredPolicy; today: string; onlyLotId?: string; fields: { departmentId?; employeeId?; reason?; stocktakeId?; occurredAt?; actorId } }): Promise<{ movementId: string; cost: number | null; uncostedUnits: number }>; // throws ActionFailure on shortfall
export async function recordInflowLot(tx, args: { item: { id }; origin: "OPENING" | "ADJUSTMENT"; quantity: number; unitCost: number | null; fields: { reason?; stocktakeId?; occurredAt?; actorId } }): Promise<{ movementId: string; lotId: string }>;
// movement-actions.ts additions
export async function writeOffLot(input: unknown): Promise<ActionResult<{ balance: number }>>;
export async function setLotCost(input: unknown): Promise<ActionResult<null>>;
// document-actions.ts
export async function uploadLotDocument(formData: FormData): Promise<ActionResult<{ id: string }>>;
```

- [ ] **Step 1** — `ledger.ts` per spec §5.2 with the refusal copy of §7 (`Only {available} unexpired {unit} of {code} — write off the expired lot first` when `expiredRemaining > 0`, else D1's message; `Only N left on this lot` for the write-off).
- [ ] **Step 2** — `receiveStock` stores `expiresAt`; `issueStock`, `adjustStock` route through the helpers; `writeOffLot` and `setLotCost` added (both under the item lock; `setLotCost` refused when set: `This lot already has a cost`); `postStocktake` routes its adjustments through the helpers; audits per spec §5.4.
- [ ] **Step 3** — `document-actions.ts` and the download route mirroring the request-document pair (read them first: `src/server/modules/purchases/document-actions.ts` and its route).
- [ ] **Step 4** — palette: the three reports in the Stock group.
- [ ] **Step 5: Verify** — `npx tsc --noEmit`; `npx eslint src/server src/app`; `npx vitest run`; no dev server (the UI does not exist yet); a `npx tsx -e` smoke that calls `allocate` is not needed — the e2e proves the actions.
```bash
git commit -m "feat(stock): ledger helpers record every outflow with FEFO allocations and every non-receipt inflow as a lot; issue/adjust/stocktake route through them; write-off, set-cost and lot-document actions; download route; palette" -- src/server/modules/stock src/server/palette.ts "src/app/(app)/stock/lots" src/server/modules/audit
```

---

### Task 5: Server queries — lots, item detail, list facet, reports, Home signals

**Files:** create `src/server/modules/stock/report-queries.ts`; modify `src/server/modules/stock/queries.ts`, `src/server/modules/home/queries.ts` (`purchasingHome`).

**Interfaces — Produces:** spec §5.1's functions: `itemLots(itemId, today)`, `getStockItem` additions (`available`, `onHandValue`, `uncostedUnits`, `expiring`, per-row `cost`/`uncostedUnits`), `listStockItems`/`stockExportRows` `expiring` facet and per-row flag; `onHandReport(state)`, `onHandExportRows(state)`, `consumptionReport(range, state)`, `consumptionExportRows(range, state)`, `expiryReport(days, state)`, `expiryExportRows(days, state)`; `stockHomeSignals(today)`; `PurchasingHome` gains `lowStock: number` and `expiringLots: number`.

- [ ] **Step 1** — `itemLots` and the `getStockItem` additions (one `groupBy` over allocations by `lotId` for the item's lots; one over allocations by `movementId` joined to lot cost for the page's rows — two queries, not N).
- [ ] **Step 2** — the `expiring` facet over the candidate set (the `low` path's pattern), per-row `expiring: "expired" | "expiring" | null`.
- [ ] **Step 3** — `report-queries.ts`: on-hand (per item: lots with remaining → `onHand`; grouped by category with subtotals; `uncostedOnly` toggle = `state.filters.uncosted` includes `"1"`), consumption (ISSUE movements in range joined to department, item, allocations and lot costs; bucketed with `monthKey`; grid via `consumptionGrid`), expiry (lots with `expiresAt` not null and remaining > 0 within the window or past; `expiryBuckets`); the three export twins under `EXPORT_CAP`.
- [ ] **Step 4** — `stockHomeSignals` and the two `PurchasingHome` fields (read inside `purchasingHome`'s `Promise.all`).
- [ ] **Step 5: Verify** — `npx tsc --noEmit`; `npx eslint src/server`; `npx vitest run`; a `npx tsx -e` call of `onHandReport` against the seeded `inventory_dev` printing totals (no `.env` echo) — compare to a hand computation from the seed in the report.
```bash
git commit -m "feat(stock): lot and cost reads -- item lots, history costs, expiring facet, on-hand/consumption/expiry report queries with export twins, Purchasing Home signals" -- src/server/modules/stock/queries.ts src/server/modules/stock/report-queries.ts src/server/modules/home/queries.ts
```

---

### Task 6: UI — item page, receive form, list, Home, nav

**Files:** create `src/components/stock/lots-card.tsx`, `write-off-dialog.tsx`, `set-cost-dialog.tsx`, `lot-document-dialog.tsx`; modify `src/app/(app)/stock/items/[id]/page.tsx`, `src/components/stock/movement-history.tsx` (Cost cell), `receive-form.tsx` (Expires; drop `SupplierOption.archived`), `stock-items-table.tsx` (pill), `stock-toolbar.tsx` (expiring toggle, stat line), `stocktake-review.tsx`, `stocktake-count.tsx` (leftovers 4–5 and their callers), `src/app/(app)/stock/page.tsx`, `src/app/(app)/page.tsx` (two tiles), `src/lib/workspaces.ts` (Reports nav entry).

**Interfaces — Consumes:** Task 4's actions, Task 5's `itemLots`/`getStockItem` shape and `PurchasingHome` fields. The accessible-name CONTRACT the e2e uses: dialogs `getByRole("dialog", { name: "Write off lot" | "Set unit cost" | "Attach document" })`; inputs `aria-label` "Quantity", "Reason", "Unit cost", "Kind", "File"; buttons "Write off", "Set unit cost", "Attach document", "Confirm", "Save", "Upload"; Lots card heading "Lots"; pills `EXPIRING`/`EXPIRED`; toggle link "Show expiring only"/"Show all"; receive field `aria-label="Expires"`; Home tiles labelled "Below reorder level" and "Expiring within 30 days"; toasts per spec §6.4 (read with `{ exact: true }` including the sr-only "Success: " prefix).

- [ ] **Step 1** — Lots card and the three dialogs (each a client island using `useStockRunner` like `adjust-dialog.tsx`; `RateLimitNotice` on `rate_limited`).
- [ ] **Step 2** — item page: header pill, Balance lines, card order Balance → Lots → History; History Cost cell.
- [ ] **Step 3** — receive form Expires (+ remove the unused prop); list pill and toggle and stat line; the two Home tiles; nav entry; leftovers 4 and 5.
- [ ] **Step 4: Verify** — `npx tsc --noEmit`; `npx eslint src/components src/app src/lib/workspaces.ts`; `npx vitest run`; dev server `npm run dev -- -p 3100` FOREGROUND and walk as `purchasing@`: `PN-0003`'s page shows `EXPIRED`, Lots card with the expired lot, "Available 300 (100 expired)"; write off 100 → toast, lot gone, history row with cost `₱90.00`; `OS-0003` Set unit cost 9.00 once then refused; receive with Expires; `/stock?expiring=1`; Home tiles; stop the server, port free.
```bash
git commit -m "feat(stock): Lots card with write-off, set-cost and attach dialogs; history costs; Expires on receive; EXPIRING/EXPIRED pill and toggle; two Purchasing Home tiles; Reports nav; D1 leftovers 3-5" -- src/components/stock "src/app/(app)/stock/items" "src/app/(app)/stock/page.tsx" "src/app/(app)/page.tsx" src/lib/workspaces.ts
```

---

### Task 7: UI — the three report pages and their exports

**Files:** create `src/app/(app)/stock/reports/page.tsx` (redirect), `on-hand/page.tsx`, `on-hand/export/route.ts`, `consumption/page.tsx`, `consumption/export/route.ts`, `expiry/page.tsx`, `expiry/export/route.ts`, `src/components/stock/report-tabs.tsx` (the labelled `Tabs`, `label="Stock reports"`), `expiry-window-chips.tsx`, `consumption-grid.tsx`, `on-hand-table.tsx`, `expiry-table.tsx`.

**Interfaces — Consumes:** Task 5's report queries and export rows; Task 2's `parseReportRange`, `parseExpiryWindow`, `STOCK_REPORT_LIST_CONFIG`; Task 6's write-off dialog (imported, not duplicated). Contract: report `h1`s "On hand and value", "Consumption by department", "Expiring and expired lots"; the rule line of §6.1 verbatim; chips group `aria-label="Expiry window"`; range inputs `aria-label` "From"/"To"; toggle "Uncosted only"/"Show all"; block headings "Expired" and "Expiring within N days"; export links named "Export"; export filenames `stock-on-hand-…`, `stock-consumption-…`, `stock-expiry-…` via `exportFilename`.

- [ ] **Step 1** — the pages and components per spec §6.1–§6.3; the export routes per the D1 `/stock/export/route.ts` pattern (`requireUser`, cap refusal, `xlsxResponse`).
- [ ] **Step 2: Verify** — `npx tsc --noEmit`; `npx eslint "src/app/(app)/stock/reports" src/components/stock`; dev server `npm run dev -- -p 3101` FOREGROUND (Task 6 may be walking on 3100) and verify with `curl` only: sign-in redirects (307) when signed out for the three pages and 200 for `/stock/reports` → redirect target; then stop it. Visual checks are Task 9's e2e.
```bash
git commit -m "feat(stock): report pages -- on hand and value (category subtotals, uncosted toggle), consumption by department and month (grid, range), expiring and expired lots (window chips, write-off) -- each with an xlsx export" -- "src/app/(app)/stock/reports" src/components/stock/report-tabs.tsx src/components/stock/expiry-window-chips.tsx src/components/stock/consumption-grid.tsx src/components/stock/on-hand-table.tsx src/components/stock/expiry-table.tsx
```

---

### Task 8: E2E — `stock-lots.spec.ts`, updates to `stock.spec.ts`

**Files:** create `e2e/stock-lots.spec.ts` (8), `e2e/fixtures/delivery-receipt.pdf` (P-6); modify `e2e/stock.spec.ts` where the unit-cost notice or the item page's card order changed.

House rules as every Phase 20/21 spec: reseed in `beforeAll`/`afterAll`; helpers copied from `e2e/stock.spec.ts`; state-based waits; dialog-scoped clicks; toasts `{ exact: true }` with the "Success: " prefix; DB facts via `PrismaClient`; dates via `localDateISO`/`fmtDate`.

- [ ] Cases per spec §9.2 (the eight named); run foreground until green, once more; then `e2e/stock.spec.ts`; `--list`; reseed. Commit: `test(e2e): stock lots -- expiry on receipt, FEFO issue with cost, expired-units refusal, write-off from the report, set cost once, adjustment lot, lot document upload/download, the remaining=balance invariant (8 cases; --list N / M files)`.

---

### Task 9: E2E — `stock-reports.spec.ts`

**Files:** create `e2e/stock-reports.spec.ts` (6).

- [ ] Cases per spec §9.2; DB-derived expectations for totals; run foreground until green, once more; `--list`; reseed. Commit: `test(e2e): stock reports -- on-hand FIFO value and uncosted toggle, consumption grid and flat export, expiry blocks and window chips, list pill, Home tiles, axe (6 cases; --list N / M files)`.

---

### Task 10: Battery, documentation, amendment block

- [ ] **Battery** — `npx tsc --noEmit`; `npx eslint .`; `npx vitest run`; `npx prisma migrate status` (23); `--list`; the six chunks with explicit paths (chunk E gains `e2e/stock-lots.spec.ts e2e/stock-reports.spec.ts`; split into E1/E2 per spec §9.3 if E exceeds ~70 tests), `E2E_PORT=3100 --workers=1 --global-timeout=540000`, zero failed, zero did-not-run.
- [ ] **Documents** — HANDOVER line 3 parenthetical (CODE-COMPLETE, UNMERGED, UNPUSHED; 23 migrations; `D-1`…`D-n`; battery); a new **(o)** block after (n); §0 item 9; PICKUP rows (Branch, Database 23 on the branch / main and staging at 22, a Battery row, Last two phases 22 then 21, §4 item 1); `HANDOVER-PENDING.md` §5.1 marked shipped with "requisitions: decided no (2026-09-16)"; the plan's D-block above "## File structure"; the spec's Status line.
- [ ] Commit: `docs(handover,pickup,plan): Phase 22 code-complete -- battery N e2e / 31 files, M unit, 23 migrations; (o) block; D-1..D-n`.

---

## Self-review (writing-plans checklist, run 2026-09-16)

1. **Spec coverage.** §2 → Tasks 1, 3; §3 → Tasks 4 (route), 6 (nav), 7 (pages); §4 → Task 2; §5 → Tasks 4, 5; §6 → Tasks 6, 7; §7 → Tasks 4, 2; §8 → Tasks 2 (1, 2, 6), 6 (3–5); §9 → Tasks 2, 8, 9, 10; §10–§11 → this plan. No gap.
2. **Placeholders.** None: every step names the file, the function and the copy, or points at the spec section that does.
3. **Type consistency.** `LotState`/`allocate`/`ExpiredPolicy` (Task 2) ↔ `ledger.ts` (Task 4) ↔ the seed (Task 3); `recordOutflow`/`recordInflowLot` (Task 4) ↔ `stocktake-actions.ts` (Task 4); `itemLots`/`getStockItem` (Task 5) ↔ `lots-card.tsx`/the item page (Task 6); the report queries (Task 5) ↔ the pages (Task 7); `PurchasingHome.lowStock/expiringLots` (Task 5) ↔ `page.tsx` tiles (Task 6); the three export row types (Task 2) ↔ the export twins (Task 5) ↔ the routes (Task 7).
