# Phase 17 — The Scale Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every list that can grow pages in the database with a stable order, the employees list stops reading the whole table, the merged timelines get an "Older" cursor, the Worklist stops printing a false total, the policies page stops reading every employee, and the orderings get their indexes — for 1000 assets and 600 employees.

**Architecture:** One pure paging rule (`src/lib/paging.ts`) that every list calls after its `count`; five lists gain `skip/take` + `<Pagination>`; the employees list splits into a SQL-paged plain path and a narrow-select gaps path; a pure `mergeTimeline` with a `(before, skip)` cursor drives the two merged timelines; `groupWork` learns which sections hit their cap; `headcountByPolicy` replaces the policies page's employee read; one additive migration adds seven indexes. No new server actions, no client islands.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, vitest, Playwright. Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-09-08-scale-sweep-design.md` — read §1 (decisions), §2 (paging rule), §3 (lists), §4 (employees), §5 (timelines), §6 (worklist, policies), §7 (indexes), §9 (testing).

**Baselines on `main` at `94a396b`:** 1040 unit / 56 files · 227 e2e / 18 files · `tsc` and `lint` clean · 17 migrations, none pending. Verify before Task 1 and correct these numbers if they differ.

> ### AMENDED DURING EXECUTION — D-1 through D-9
>
> *(Task 1 — `prisma format` realigned the whole `schema.prisma` file when the new `@@index` blocks were
> added: a cosmetically noisy diff with no semantic change, which is also why the implementer's own report
> line-count looked off. No plan change resulted, so it carries no `D-` number.)*
>
> **D-1. Task 5 `employeeExportRows` return shape (Ruling P1):** the plan's Interfaces block carried a stray
> comment — "throws ExportCapExceeded? NO" — alongside the return-type sketch, which read as ambiguous
> against Task 5's own Step 3 prose. Ruled that the return type is `{ rows: EmployeeExportRow[] } | { over:
> number }`, with the route checking `"over" in result`; the stray comment is plan noise and the Step 3 text
> is binding. — Cost if wrong: a compile error. Lesson: a stray inline comment inside an Interfaces block is
> not itself a requirement — when it conflicts with a step's prose, the prose wins.
>
> **D-2. Task 5 gaps candidate select scope (Ruling P2):** the brief's "no relations" wording for the gaps
> candidate select was read narrowly, as "no `department` join" rather than "no nested select at all" — the
> select keeps `assets: { select: { id, tag, model, typeId, status } }` (the `HeldAssetLike` shape
> `computeLoadout` requires) alongside the plain scalars. — Cost if wrong: none. Lesson: "no relations" in a
> brief can mean "no unnecessary joins," not "nothing nested" — check what the consuming function actually
> needs before trimming a select.
>
> **D-3. Task 6 `TimelineList` gains `data-id` (Ruling P3):** rows render an additive, invisible
> `data-id={item.id}` attribute so Task 8's e2e can assert row identity across cursor pages — nothing else in
> the rendered list was stable enough to grep. — Cost if wrong: one attribute. Lesson: when an e2e assertion
> needs identity and the DOM offers nothing stable, a single additive test-hook attribute is cheaper than
> reverse-engineering visible text into a de facto identifier.
>
> **D-4. Plan unit/e2e counts are estimates (Ruling P4):** every commit message and doc update in this phase
> states measured counts, never the plan's estimated ones. — Cost if wrong: a stale number. Lesson: numeric
> estimates written into a plan before the work starts are scaffolding, not a spec; docs and commits report
> what was actually measured.
>
> **D-5. Task 2 clamped-page rendering extended to inventory and audit:** the Global Constraints' "out-of-
> range pages clamp to the last page on the server" rule was applied to the inventory and audit pages too,
> beyond whatever narrower set Task 2's own steps named by name. Accepted as an extension, not a deviation.
> Lesson: a global constraint declared once at the top of the plan binds every task that touches a paged
> list, even a page a task's step-by-step instructions never called out individually.
>
> **D-6. Task 4 `DeliveryTable` takes `tab`, not an `hrefFor` function prop (Ruling P5):** `DeliveryTable` is
> a client component, so it receives the `tab` value as a prop and builds its own pagination hrefs, rather
> than the plan's `hrefFor` function-prop shape — a function cannot cross the server→client boundary. Plan
> defect, accepted; the resulting URLs are identical either way. — Cost if wrong: none. Lesson: a plan's
> proposed component interface can silently assume a server-component call site — check whether the actual
> component is client or server before accepting a function-prop shape.
>
> **D-7. Task 5 pre-existing `employees-list.test.ts` preserved:** the first implementation pass overwrote
> the pre-existing `src/lib/employees-list.test.ts`; caught before commit and restored, so the file carries
> both the prior coverage and the new SQL-paging tests. Lesson: when a task's new tests target a file that
> already has tests, confirm the new content is additive, not a wholesale replacement, before treating a
> green run as proof nothing was lost.
>
> **D-8. Task 6 fix round 1 — the timeline cursor survives a tie longer than a page (Ruling P6):** Task 8's
> e2e battery found that `mergeTimeline` truncated a tie group longer than one page — a `createMany` or bulk
> assign stamping one `createdAt` across many rows on a single employee's timeline was silently dropped by
> the old page-local `skip` and a fixed per-source `take`. Fixed so the cursor's `skip` accumulates across
> pages at the same boundary instant and each source fetches `take = limit + 1 + cursor.skip`
> (`timelineTake`); two new unit tests cover a 120-row single-source tie and a 60+3 two-source tie. — Cost if
> wrong: a wrong cursor, caught by the new tests. Lesson: a cursor's "skip past what I've already shown at
> this instant" state has to survive across pages, not just within one page's fetch — scale testing is
> exactly what surfaces the difference.
>
> **D-9. Task 8 fix round 1 — case 7 made size-agnostic, two-source fixture restored:** review caught that
> case 7 hardcoded page sizes (`[50, 48, 22]`) computed against the pre-fix `mergeTimeline`, which D-8's fix
> (5930cce) had already changed to `[50, 50, 20]` — the suite would have failed on its very next run.
> Rewritten to be size-agnostic, with the two-source timeline fixture (audit + approval entries on
> BR-ZZ-0001) restored now that D-8 makes it safe to exercise at e2e scale again, and the assertion
> strengthened to full DB id-set equality. Lesson: a test pinned to a specific numeric shape has to be
> re-derived, not just left in place, once the code it pins changes underneath it — and a workaround fixture
> used to unblock one task should be revisited once the thing it worked around is fixed.
>
> **D-10. e2e file list — `admin.spec.ts` and `axe-sweep.spec.ts` unchanged:** the plan's Task 8 file list
> and the spec's §9.2/§11 both named `e2e/{admin,axe-sweep}.spec.ts` as files this phase would touch.
> Neither changed: `admin.spec.ts` never asserted the "Older attempts aren't paged through yet" text the
> deliveries page used to show, so removing that text needed no test edit; and the paged-route axe checks
> (`?page=2` on `/approvals`, `/employees`, `/admin/webhooks/deliveries`, plus a timeline page with an
> active cursor) were written as case 12 of the new `paging.spec.ts` instead, because the rows those checks
> need to find a page 2 exist only in `paging.spec.ts`'s own fixtures — `axe-sweep.spec.ts` would have had
> to manufacture them itself for no benefit. — Cost if wrong: none; both files are correctly absent from
> the spec's Changed list now (§11). Lesson: name test files by what they must prove, not by guess — a
> spec section written before implementation can commit to a file list that the actual dependency (where
> the rows already live) later overrides.
>
> **D-11. Final-review fix wave — the timeline cursor's `skip` is clamped:** `parseTimelineCursor` accepted
> whatever `skip` a hand-edited URL supplied, and `mergeTimeline` fetched `take = limit + 1 + skip` per
> source (flagged as unclamped in PICKUP §5 at Phase 17's close) — a large hand-crafted `skip` could 500
> the timeline page or, at worst, pull an entity's entire history into one query. Fixed: `TIMELINE_MAX_SKIP
> = 1_000` (named beside `TIMELINE_PAGE_SIZE`), clamped inside `parseTimelineCursor` on the way in — not
> inside `timelineTake`, so `timelineCursorQS` round-trips stay exact — sized off the largest same-instant
> writer to one entity's timeline (a 200-row bulk assign), so a tie longer than the bound degrades to
> repeated rows on a later page, never a crash; three unit tests (`skip=1e12 → 1000`, `skip=-5 → 0`,
> `skip=7 → 7`), written first and seen red before the clamp landed. — Cost if wrong: an oversized fetch,
> now impossible. Lesson: a value that crosses a URL boundary needs its own clamp at the parse boundary,
> independent of whatever downstream function consumes it — clamping inside `timelineTake` instead would
> have broken the cursor's own round-trip test.
>
> The same fix wave also landed Minors 6, 7 and 15 of the final review (no `!` on a possibly-missing
> employee row in `employees/queries.ts`; the gaps candidate-pass + `resolveMissing` + keep sequence
> deduplicated into one `gapKeptIds` helper shared by the list and the export; the Home worklist's loans
> comment references `CAP.large` instead of a literal `50`) and strengthened Minor 14's `headcountByPolicy`
> test to sum two Finance-department groups into one policy. Minors 8–13 of the final review are deferred,
> undecided by this wave: a parallel `count`/`findMany` pair that can refetch a page whose total shifted
> between the two calls; a possible approvals double-count; the work-page capped-section note's wording
> once dismissals are in play; a fully-dismissed capped section vanishing from the note entirely;
> `TIMELINE_PAGE_SIZE` living as a third page-size constant alongside `ENTITY_PAGE_SIZE`/`LOG_PAGE_SIZE`
> plus `parsePage` duplication; and a missing collation comment on `byWhenDesc`'s id comparator.
>
> Measured after the fix wave: **1056 unit / 58 files** (was 1055 / 58 at Task 9's close — the three new
> `parseTimelineCursor` clamp cases, less the loadout test's unchanged `it` count); `tsc` and `lint` clean;
> `e2e/paging.spec.ts` and `e2e/it-core.spec.ts` (33 cases, the surfaces this wave touched) reran green,
> foreground, `E2E_PORT=3100 --workers=1`; `npx playwright test --list` still reports 239 / 19 files.
>
> The scoped re-review of the wave (9 addressed, 0 open) raised one new Minor, deferred with 8–13:
> `gapKeptIds` makes the gaps LIST path call `resolveMissing` twice — once over every candidate inside
> the helper, once over the 25-row page — where the list previously reused the whole-candidate map. The
> output is equivalent and the extra read is bounded by the page; the helper could return
> `{ keptIds, missing }` instead. Cost if wrong: one extra query per gaps page.

> **D-12. Final battery — custody case 7 raced its own toast:** with the fix wave in, the whole e2e
> battery was re-run on the final tree in four foreground chunks. Chunk D (`admin`, `direct-lifecycle`,
> `scanner`, `registration`, `custody`, `axe-sweep`, `kitchen-sink`) failed custody case 7 twice at the
> same line — the loaner slot never appeared on Leo Tan's page — while `custody.spec.ts` alone passed
> 6/6. Cause: the test waited on the "Slot added" toast with `.first()`, which the FIRST add's toast still
> satisfied, so `page.goto` could outrun the second slot's insert; with `admin` and `axe-sweep` warming
> the same server first, the timing tipped every time. Fixed in the test only (`2c1436c`): both waits now
> target the new slot's Remove button inside the Contractor kit card, which renders only after the action
> commits and `router.refresh()` returns the slot. Not a product defect — an operator clicking Add slot
> twice gets both slots. Chunk D then passed 55/55; the full battery on the final tree is **239/239 e2e /
> 19 files** (54 + 67 + 63 + 55) and **1056 unit / 58**, `tsc` and `lint` clean. — Cost if wrong: a
> stricter wait. Lesson: assert on the state a step produces, never on a toast an earlier step may still
> be showing — a `.first()` on a repeated success message is a race by construction.

**Dev environment on the staging laptop (PICKUP §2, memory):** a git worktree under `.claude/worktrees/` with its own `.env` (`DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`), dev server on port 3100, Playwright with `E2E_PORT=3100`, always foreground, `--workers=1`. Never touch the `inventory` database or port 3000. `npm ci` in the worktree first.

## Global Constraints

- **Exactly one migration**, `20260908100000_scale_indexes`, hand-written, additive (indexes only). Never `prisma migrate dev` or `reset`; `npm run db:seed` is the sanctioned reset. **Add no seed fixtures.**
- **Page sizes:** entity lists 25 (`ENTITY_PAGE_SIZE`), log lists 50 (`LOG_PAGE_SIZE`) — the existing values, named once in `src/lib/paging.ts`. No other page-size constant survives.
- **Every paged `findMany` orders by its primary key(s) then `id`** (`asc` for ascending lists, `desc` for descending) so pages never repeat or skip a row.
- **Out-of-range pages clamp to the last page on the server** via `pageOf`; the URL is not rewritten.
- **The employees list never reads a full employee row outside the current page** (plain path); the gaps path reads only `id, title, departmentId` and `assets.{typeId,status}` for candidates.
- **Merged timelines:** a cursor is `?before=<ISO>&skip=<n>`; identical timestamps at the boundary are neither skipped nor repeated (the direct-action case: approval row and audit entry share one `now`).
- **Copy, verbatim:** *"page X of Y · N in this tab"* (approvals) · *"N people leaving"* (offboarding) · *"page X of Y · N entries"* (history) · *"Older"* / *"Newest"* (timelines) · *"See all 50+"* (capped worklist section) · *"Showing the first 50 — the oldest first."* (work page note).
- **Behaviour that must not change:** filters, facets, sort keys, tab semantics, `Pagination`'s markup, `parseListState`'s parsing, Home's `limit: 2`, `activeEmployeeOptions()`, the repair-stage in-memory path, facet counts under `gaps=1`.
- Commit after every task; never amend; commit messages state measured counts.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/paging.ts` (+test), `prisma/migrations/20260908100000_scale_indexes/migration.sql`, `prisma/schema.prisma` | the paging rule and the indexes (Task 1) |
| the eight already-paged lists and their pages | adopt `pageOf`, the two constants, and id tiebreakers (Task 2) |
| `src/server/modules/approvals/queries.ts`, `src/app/(app)/approvals/page.tsx` | approvals per-tab pages (Task 3) |
| `src/server/modules/{offboarding,reservations,admin}/queries.ts` and their pages, `src/components/admin/delivery-table.tsx` | offboarding, reservations, users, deliveries pages (Task 4) |
| `src/server/modules/employees/queries.ts`, `src/lib/employees-list.ts` (+test), `src/app/(app)/employees/export/route.ts` | employees in SQL (Task 5) |
| `src/lib/timeline.ts` (+test), the history page, the two timeline pages | history pages and the Older cursor (Task 6) |
| `src/lib/worklist.ts` (+test), `src/server/modules/home/queries.ts`, `src/components/home/worklist.tsx`, `src/app/(app)/inventory/work/page.tsx`, `src/lib/loadout.ts` (+test), `src/app/(app)/admin/equipment-policies/page.tsx` | worklist caps and policy head-counts (Task 7) |
| `e2e/paging.spec.ts`, `e2e/{admin,axe-sweep}.spec.ts` | end-to-end (Task 8) |
| `docs/HANDOVER.md`, `docs/PICKUP.md`, the spec's Status line | battery and close-out (Task 9) |

---

### Task 1: The paging rule and the indexes

**Files:**
- Create: `src/lib/paging.ts`, `src/lib/paging.test.ts`, `prisma/migrations/20260908100000_scale_indexes/migration.sql`
- Modify: `prisma/schema.prisma` (`Approval`, `Reservation`, `AuditEntry`, `Employee`, `WebhookDelivery` `@@index` blocks)

**Interfaces:**
- Produces:
  ```ts
  export const ENTITY_PAGE_SIZE = 25;
  export const LOG_PAGE_SIZE = 50;
  export interface Page { page: number; pageCount: number; skip: number; take: number; total: number }
  export function pageOf(total: number, requested: number, size: number): Page
  export function parsePage(params: URLSearchParams): number   // same rule as parseListState: max(1, parseInt || 1)
  ```

- [ ] **Step 1: Failing tests** (`src/lib/paging.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { ENTITY_PAGE_SIZE, LOG_PAGE_SIZE, pageOf, parsePage } from "./paging";

describe("pageOf", () => {
  it("names the two sizes the app already uses", () => {
    expect(ENTITY_PAGE_SIZE).toBe(25);
    expect(LOG_PAGE_SIZE).toBe(50);
  });
  it("an empty list is one empty page", () => {
    expect(pageOf(0, 1, 25)).toEqual({ page: 1, pageCount: 1, skip: 0, take: 25, total: 0 });
  });
  it("clamps below 1 and above the last page", () => {
    expect(pageOf(60, 0, 25).page).toBe(1);
    expect(pageOf(60, 99, 25)).toEqual({ page: 3, pageCount: 3, skip: 50, take: 25, total: 60 });
  });
  it("an exact multiple has no empty trailing page", () => {
    expect(pageOf(50, 2, 25)).toEqual({ page: 2, pageCount: 2, skip: 25, take: 25, total: 50 });
    expect(pageOf(50, 3, 25).page).toBe(2);
  });
});

describe("parsePage", () => {
  it("mirrors parseListState's lower clamp", () => {
    expect(parsePage(new URLSearchParams(""))).toBe(1);
    expect(parsePage(new URLSearchParams("page=4"))).toBe(4);
    expect(parsePage(new URLSearchParams("page=0"))).toBe(1);
    expect(parsePage(new URLSearchParams("page=abc"))).toBe(1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/paging.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`src/lib/paging.ts`)

```ts
/**
 * Phase 17 (spec §2): the one paging rule. Every list calls pageOf() after its
 * count, so an out-of-range ?page= lands on the last page instead of an empty
 * one, and no list hand-writes Math.ceil(total / size) any more.
 */
export const ENTITY_PAGE_SIZE = 25;
export const LOG_PAGE_SIZE = 50;

export interface Page { page: number; pageCount: number; skip: number; take: number; total: number }

export function pageOf(total: number, requested: number, size: number): Page {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, skip: (page - 1) * size, take: size, total };
}

/** For pages without a ListState — the same lower clamp parseListState applies. */
export function parsePage(params: URLSearchParams): number {
  return Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
}
```

- [ ] **Step 4: Migration** (`prisma/migrations/20260908100000_scale_indexes/migration.sql`)

```sql
-- Phase 17 (spec §7): indexes for the paged orderings. Additive, no data change.
CREATE INDEX "Approval_state_updatedAt_idx" ON "Approval"("state", "updatedAt");
CREATE INDEX "Reservation_state_createdAt_idx" ON "Reservation"("state", "createdAt");
CREATE INDEX "AuditEntry_entityType_entityId_createdAt_idx" ON "AuditEntry"("entityType", "entityId", "createdAt");
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");
CREATE INDEX "Employee_name_idx" ON "Employee"("name");
CREATE INDEX "Employee_joinedAt_idx" ON "Employee"("joinedAt");
CREATE INDEX "WebhookDelivery_status_createdAt_idx" ON "WebhookDelivery"("status", "createdAt");
```

`schema.prisma`: add `@@index([state, updatedAt])` to `Approval`; `@@index([state, createdAt])` to `Reservation`; `@@index([entityType, entityId, createdAt])` to `AuditEntry`; `@@index([departmentId])`, `@@index([name])`, `@@index([joinedAt])` to `Employee`; `@@index([status, createdAt])` to `WebhookDelivery`. Prisma's default index names match the SQL above; run `npx prisma migrate status` after `migrate deploy` to confirm nothing is pending and `npx prisma format` to confirm the schema parses.

- [ ] **Step 5: Verify** — `npx prisma migrate deploy` (18 applied), `npx prisma generate`, `npx vitest run` (1040 + 6), `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/paging.ts src/lib/paging.test.ts prisma/schema.prisma prisma/migrations/20260908100000_scale_indexes/migration.sql
git commit -m "feat(paging): one paging rule (pageOf, parsePage, the two sizes); migration 18 adds the seven indexes the paged orderings need"
```

---

### Task 2: The eight paged lists adopt the rule and get tiebreakers

**Files:**
- Modify: `src/server/modules/inventory/queries.ts:15,152-179`, `src/lib/inventory-list.ts:154-158` (+ `src/lib/inventory-list.test.ts` if present, else a new test), `src/server/modules/finance/queries.ts:7,32-62`, `src/server/modules/audit/queries.ts:6,91-108`, `src/server/modules/purchases/queries.ts:58-75` + `src/lib/purchases-list.ts:24`, the four `src/app/(app)/*/activity/page.tsx`, `src/app/(app)/finance/assets/page.tsx:23`, `src/app/(app)/purchases/page.tsx` (its page parse), `src/app/(app)/audit/page.tsx` (only if it references `AUDIT_PAGE_SIZE`)

**Interfaces:**
- Consumes: `pageOf`, `parsePage`, `ENTITY_PAGE_SIZE`, `LOG_PAGE_SIZE` (Task 1).
- Produces: every existing paged query returns `page` (clamped) alongside `total`/`pageCount`; `buildAssetOrderBy` ends with `{ id: "asc" }`; the employees list is Task 5's.

This is one batched dispatch: the same mechanical change in eight places.

- [ ] **Step 1: Order-builder test** — in `src/lib/inventory-list.test.ts` (create if absent, in the style of `url-state.test.ts`):
```ts
it("buildAssetOrderBy ends with the id tiebreaker", () => {
  const order = buildAssetOrderBy([{ key: "tag", dir: "asc" }]);
  expect(order[order.length - 1]).toEqual({ id: "asc" });
  expect(buildAssetOrderBy([])[buildAssetOrderBy([]).length - 1]).toEqual({ id: "asc" });
});
```
Implement: `return [...order.map(...), { id: "asc" }];`.

- [ ] **Step 2: Each list** — replace the constant with the import, the `Math.max(1, Math.ceil(...))`/`Math.min` pair with `const pg = pageOf(total, requestedPage, SIZE)` and use `pg.skip`, `pg.take`, `pg.page`, `pg.pageCount`; add the trailing id to `orderBy`:
  - `listAssets` (`inventory/queries.ts`): `ENTITY_PAGE_SIZE`; SQL branch uses `pg`; the repair-stage in-memory branch slices with `pg.skip`/`pg.take` (unchanged semantics). Export `PAGE_SIZE` is deleted — grep its importers (`inventory/page.tsx`, tests) and switch them.
  - `financeAssets`: `ENTITY_PAGE_SIZE`; `orderBy: [{ cost: "desc" }, { tag: "asc" }, { id: "asc" }]`; return `pg.page`.
  - `listAudit`: `LOG_PAGE_SIZE`; `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`.
  - `listPurchases`: `LOG_PAGE_SIZE` (delete `PURCHASE_PAGE_SIZE` from `purchases-list.ts` and fix importers); `orderBy: [{ updatedAt: "desc" }, { id: "desc" }]`.
  - Four activity pages: `import { LOG_PAGE_SIZE, pageOf, parsePage } from "@/lib/paging"`; `const pg = pageOf(total, parsePage(sp), LOG_PAGE_SIZE)`; `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`; the page line and `<Pagination page={pg.page} …>`.
  - `finance/assets/page.tsx` and `purchases/page.tsx`: `parsePage` instead of the inline parse.

- [ ] **Step 3: Verify** — `npx vitest run`, `npx tsc --noEmit`, `npx eslint src/server src/lib "src/app/(app)"`; grep confirms no `Math.ceil(total /` remains under `src/` except `src/lib/paging.ts` and `src/lib/rate-limit.ts`, and no `PAGE_SIZE`/`_PAGE_SIZE`/`DELIVERY_PAGE` constant remains outside `paging.ts` (Tasks 3–5 remove the last three: `QUEUE_PAGE_SIZE`, `DELIVERY_PAGE`, employees `PAGE_SIZE`).

- [ ] **Step 4: Commit** — `git commit -m "refactor(paging): the eight paged lists use pageOf and the two named sizes; every paged order ends with an id tiebreaker"`

---

### Task 3: Approvals pages

**Files:**
- Modify: `src/server/modules/approvals/queries.ts:9,24-49`, `src/app/(app)/approvals/page.tsx:20-24,50-62`

**Interfaces:**
- Produces: `listApprovals(tab: QueueTab, userId: string, role: Role, requestedPage: number): Promise<{ rows: ApprovalRow[]; total: number; page: number; pageCount: number }>`; `QUEUE_PAGE_SIZE` deleted (`LOG_PAGE_SIZE`).

- [ ] **Step 1: Query**

```ts
export async function listApprovals(tab: QueueTab, userId: string, role: Role, requestedPage: number): Promise<{
  rows: ApprovalRow[]; total: number; page: number; pageCount: number;
}> {
  const where = { AND: [tabWhere(tab, userId), approvalClassWhere(role)] };
  const total = await prisma.approval.count({ where });
  const pg = pageOf(total, requestedPage, LOG_PAGE_SIZE);
  const approvals = await prisma.approval.findMany({
    where,
    include: { asset: true, employee: true, claimedBy: true },
    // Open work orders by what breaks first; closed history reads newest-first.
    // The id tiebreaker keeps two rows with one slaAt in one order across pages.
    orderBy: tab === "closed" ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ slaAt: "asc" }, { id: "asc" }],
    skip: pg.skip, take: pg.take,
  });
  return { rows: approvals.map(/* unchanged mapping */), total, page: pg.page, pageCount: pg.pageCount };
}
```

- [ ] **Step 2: Page** — parse `page` with `parsePage(sp)`; `const [{ rows, total, page, pageCount }, counts] = await Promise.all([listApprovals(tab, user.id, user.role, requestedPage), tabCounts(...)])`; replace the "showing N of M" paragraph with
```tsx
{rows.length > 0 && (
  <div className="flex items-center justify-between pt-1">
    <span className="font-mono text-[10px] text-fg-muted">page {page} of {pageCount} · {total} in this tab — ordered by SLA, what breaks first</span>
    <Pagination page={page} pageCount={pageCount} hrefFor={(p) => hrefFor(tab, p)} />
  </div>
)}
```
with `const hrefFor = (t: QueueTab, p: number) => { const qs = new URLSearchParams(); if (t !== "open") qs.set("tab", t); if (p > 1) qs.set("page", String(p)); const s = qs.toString(); return s ? `/approvals?${s}` : "/approvals"; }`. The tab links keep their existing hrefs (page resets to 1 by omission). Keep the *"— ordered by SLA…"* suffix only on open tabs (`tab !== "closed"`).

- [ ] **Step 3: Verify** — `npx tsc --noEmit`, `npx eslint`, dev server on 3100: `/approvals?page=99` shows the last page; the keyboard hints still render.

- [ ] **Step 4: Commit** — `git commit -m "feat(approvals): real pages per tab with a stable order; the showing-N-of-M cap is gone"`

---

### Task 4: Offboarding, reservations, users and deliveries pages

**Files:**
- Modify: `src/server/modules/offboarding/queries.ts:89-133` + `src/app/(app)/offboarding/page.tsx`; `src/server/modules/reservations/queries.ts:38-83` + `src/app/(app)/reservations/page.tsx`; `src/server/modules/admin/queries.ts:32-40,240,266-300` + `src/app/(app)/admin/users/page.tsx` + `src/app/(app)/admin/webhooks/deliveries/page.tsx` + `src/components/admin/delivery-table.tsx:72-80,208-212`

**Interfaces:**
- Produces:
  ```ts
  listOffboarding(requestedPage: number): Promise<{ rows: OffboardingRow[]; total: number; page: number; pageCount: number }>
  listReservations(tab: ReservationTab, requestedPage: number): Promise<{ rows; counts; total: number; page: number; pageCount: number }>
  listUsers(requestedPage: number): Promise<{ rows: UserRow[]; total: number; page: number; pageCount: number }>
  listDeliveries(tab: DeliveryTab, requestedPage: number): Promise<{ rows; total; deadReplayable; page: number; pageCount: number }>
  ```
  `DeliveryTable` gains `page`, `pageCount`, `hrefFor` props and renders `<Pagination>` where the "Showing N of M" line was (that line is deleted).

One batched dispatch: four lists, the same shape each.

- [ ] **Step 1: Offboarding** — `const where = { employment: "OFFBOARDING" as const }; const total = await prisma.employee.count({ where }); const pg = pageOf(total, requestedPage, ENTITY_PAGE_SIZE);` then the existing `findMany` with `where`, `skip: pg.skip, take: pg.take` (order already `[{ name: "asc" }, { employeeNo: "asc" }]`). The page: `const { rows, total, page, pageCount } = await listOffboarding(parsePage(sp))`; the header line reads `{total} {total === 1 ? "person" : "people"} leaving · every item is collected as its own request`; `<Pagination page pageCount hrefFor={(p) => p > 1 ? `/offboarding?page=${p}` : "/offboarding"} />` under the table. The page signature gains `searchParams`.

- [ ] **Step 2: Reservations** — counts from the existing `groupBy`; `total = counts[tab]`; `pg = pageOf(total, requestedPage, ENTITY_PAGE_SIZE)`; `findMany` gains `skip`/`take`. Page: `parsePage(sp)`; `hrefFor = (p) => { const qs = new URLSearchParams({ state: tab }); if (p > 1) qs.set("page", String(p)); return `/reservations?${qs}`; }`; `<Pagination>` under the table. Tab hrefs unchanged.

- [ ] **Step 3: Users** — `total = await prisma.user.count()`; `pg = pageOf(total, requestedPage, ENTITY_PAGE_SIZE)`; `orderBy: [{ isPermanentAdmin: "desc" }, { name: "asc" }, { id: "asc" }]`, `skip`, `take`. Page gains `searchParams`, `parsePage`, `<Pagination hrefFor={(p) => p > 1 ? `/admin/users?page=${p}` : "/admin/users"}>` under `<UserTable>`.

- [ ] **Step 4: Deliveries** — delete `DELIVERY_PAGE`; `pg = pageOf(total, requestedPage, LOG_PAGE_SIZE)` needs `total` first: run `count` before the `Promise.all`, then `findMany` with `skip`/`take` inside it. Return `page`, `pageCount`. Page: `parsePage`, `hrefFor = (p) => { const qs = new URLSearchParams(); if (tab !== "ALL") qs.set("state", tab); if (p > 1) qs.set("page", String(p)); const s = qs.toString(); return s ? `/admin/webhooks/deliveries?${s}` : "/admin/webhooks/deliveries"; }`. `DeliveryTable`: props `page: number; pageCount: number; hrefFor: (p: number) => string`; replace the *"Showing N of M. Older attempts aren't paged through yet."* block with `<div className="flex items-center justify-between pt-1"><span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount} · {total} attempts</span><Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} /></div>` (rendered whenever `rows.length > 0`). Update the scope-decision-#12 comment in `admin/queries.ts` to say the decision is closed by Phase 17.

- [ ] **Step 5: Verify** — `npx tsc --noEmit`, `npx eslint`, `npx vitest run` unchanged; grep: no `DELIVERY_PAGE`, no "Older attempts" text remains.

- [ ] **Step 6: Commit** — `git commit -m "feat(lists): offboarding, reservations, users and webhook deliveries page in the database with stable orders"`

---

### Task 5: The employees list in SQL

**Files:**
- Modify: `src/server/modules/employees/queries.ts:8,34-140`, `src/lib/employees-list.ts` (+ `src/lib/employees-list.test.ts`), `src/app/(app)/employees/export/route.ts:22-23`, `src/app/(app)/employees/page.tsx:122-123` (use the returned clamped page)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/employees-list.ts
  export function buildEmployeeOrderBy(sort: SortKey[]): Prisma.EmployeeOrderByWithRelationInput[]  // both keys, then { id: "asc" }
  // employees/queries.ts
  listEmployees(state, gapsOnly): Promise<{ rows; total; page: number; pageCount: number }>
  employeeExportRows(state, gapsOnly): Promise<EmployeeExportRow[]>   // throws ExportCapExceeded? NO — returns { rows } | { over: number }; see Step 4
  ```

- [ ] **Step 1: Failing test** (`src/lib/employees-list.test.ts`, new)
```ts
import { describe, expect, it } from "vitest";
import { buildEmployeeOrderBy, EMPLOYEES_LIST_CONFIG } from "./employees-list";

describe("buildEmployeeOrderBy", () => {
  it("applies both sort keys then the id tiebreaker", () => {
    expect(buildEmployeeOrderBy([{ key: "joinedAt", dir: "desc" }, { key: "name", dir: "asc" }]))
      .toEqual([{ joinedAt: "desc" }, { name: "asc" }, { id: "asc" }]);
  });
  it("falls back to the default sort", () => {
    expect(buildEmployeeOrderBy([])).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(EMPLOYEES_LIST_CONFIG.defaultSort).toEqual([{ key: "name", dir: "asc" }]);
  });
});
```
Implement in `employees-list.ts`: `const order = sort.length ? sort : EMPLOYEES_LIST_CONFIG.defaultSort; return [...order.map(({ key, dir }) => ({ [key]: dir })), { id: "asc" }];`.

- [ ] **Step 2: Rewrite the list** (`employees/queries.ts`) — delete `PAGE_SIZE`, `fetchCandidates`, `filteredEmployees`; add:

```ts
const rowInclude = { department: true, assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } } } as const;

/** Loadout resolution for exactly these employees — one exceptions read, bounded by the page. */
async function resolveMissing(employees: Array<{ id: string; title: string; departmentId: string; assets: Array<{ typeId: string | null; status: string; id: string; tag: string; model: string }> }>) {
  const [policies, exceptions] = await Promise.all([
    prisma.equipmentPolicy.findMany({ include: { slots: true }, orderBy: [{ name: "asc" }] }),
    employees.length
      ? prisma.employeeSlotException.findMany({ where: { employeeId: { in: employees.map((e) => e.id) } }, orderBy: [{ employeeId: "asc" }, { id: "asc" }] })
      : Promise.resolve([]),
  ]);
  const byEmployee = groupExceptionsByEmployee(exceptions);
  return new Map(employees.map((e) => {
    const policy = resolvePolicy(e, policies);
    const ex = byEmployee.get(e.id) ?? [];
    if (!policy && !ex.some((x) => x.kind === "ADD")) return [e.id, null] as const;
    return [e.id, computeLoadout(effectiveSlots(policy?.slots ?? [], ex), e.assets).missingRequired] as const;
  }));
}

/** Spec §4: the plain list pages in SQL; the gaps filter cuts a NARROW candidate pass, then fetches the page's rows. */
async function pageEmployees(state: ListState, gapsOnly: boolean) {
  const where = buildEmployeeWhere(state);
  const orderBy = buildEmployeeOrderBy(state.sort);
  if (!gapsOnly) {
    const total = await prisma.employee.count({ where });
    const pg = pageOf(total, state.page, ENTITY_PAGE_SIZE);
    const employees = await prisma.employee.findMany({ where, orderBy, skip: pg.skip, take: pg.take, include: rowInclude });
    const missing = await resolveMissing(employees);
    return { pg, employees, missing };
  }
  const candidates = await prisma.employee.findMany({
    where, orderBy,
    select: { id: true, title: true, departmentId: true, assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } } },
  });
  const missingAll = await resolveMissing(candidates);
  const kept = candidates.filter((c) => (missingAll.get(c.id) ?? 0) > 0);
  const pg = pageOf(kept.length, state.page, ENTITY_PAGE_SIZE);
  const pageIds = kept.slice(pg.skip, pg.skip + pg.take).map((c) => c.id);
  const rows = await prisma.employee.findMany({ where: { id: { in: pageIds } }, include: rowInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { pg, employees: pageIds.map((id) => byId.get(id)!), missing: missingAll };
}
```
`listEmployees` maps `employees` to rows with `missingRequired: missing.get(e.id) ?? null` and returns `{ rows, total: pg.total, page: pg.page, pageCount: pg.pageCount }`. The `select`/`include` shapes above are what `HeldAssetLike` and `resolvePolicy` need; the narrow candidate select still carries `id/tag/model` on assets because `computeLoadout` is generic over `HeldAssetLike` — keep the five asset scalars, nothing else (no `department`, no relations).

- [ ] **Step 3: Export** — `employeeExportRows(state, gapsOnly)`: when `!gapsOnly`, `const total = await prisma.employee.count({ where }); if (total > EXPORT_CAP) return { over: total };` then `findMany({ where, orderBy, include: rowInclude })` → `{ rows }`; when `gapsOnly`, reuse the candidate pass + cut, then the post-hoc cap check → `{ over }` or `{ rows }`. The route: `const result = await employeeExportRows(state, gapsOnly); if ("over" in result) return capRefusal(result.over);`. Update the route's doc comment.

- [ ] **Step 4: Page** — destructure `page` from `listEmployees` and use it in the `page X of Y` line and `<Pagination page={page} …>` (the URL may have asked for 99).

- [ ] **Step 5: Verify** — `npx vitest run` (+2), `npx tsc --noEmit`, `npx eslint`; dev server: `/employees?sort=joinedAt&page=2` and `/employees?gaps=1` render; export downloads.

- [ ] **Step 6: Commit** — `git commit -m "feat(employees): the list pages in SQL and resolves loadouts for the page only; the gaps filter cuts a narrow candidate pass; export refuses over the cap before loading"`

---

### Task 6: History pages and the timelines' Older cursor

**Files:**
- Create: `src/lib/timeline.ts`, `src/lib/timeline.test.ts`
- Modify: `src/app/(app)/inventory/[id]/history/page.tsx:15-19`, `src/app/(app)/inventory/[id]/timeline/page.tsx:16-55`, `src/app/(app)/employees/[id]/timeline/page.tsx:16-68`

**Interfaces:**
- Produces:
  ```ts
  export const TIMELINE_PAGE_SIZE = 50;
  export interface TimelinePoint { id: string; when: Date }
  export interface TimelineCursor { before: Date; skip: number }
  export function mergeTimeline<T extends TimelinePoint>(sources: T[][], limit: number, cursor: TimelineCursor | null): { items: T[]; next: TimelineCursor | null }
  export function parseTimelineCursor(params: URLSearchParams): TimelineCursor | null
  export function timelineCursorQS(c: TimelineCursor): string
  ```

- [ ] **Step 1: Failing tests** (`src/lib/timeline.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { mergeTimeline, parseTimelineCursor, timelineCursorQS, type TimelinePoint } from "./timeline";

const at = (id: string, iso: string): TimelinePoint => ({ id, when: new Date(iso) });

describe("mergeTimeline", () => {
  it("interleaves sources newest-first and reports no next when exhausted", () => {
    const a = [at("a2", "2026-09-03T00:00:00Z"), at("a1", "2026-09-01T00:00:00Z")];
    const b = [at("b1", "2026-09-02T00:00:00Z")];
    const r = mergeTimeline([a, b], 50, null);
    expect(r.items.map((i) => i.id)).toEqual(["a2", "b1", "a1"]);
    expect(r.next).toBeNull();
  });
  it("cuts to the limit and hands back a cursor at the last shown instant", () => {
    const rows = Array.from({ length: 5 }, (_, i) => at(`r${i}`, `2026-09-0${5 - i}T00:00:00Z`));
    const r = mergeTimeline([rows.slice(0, 3)], 2, null); // source cut to limit+1
    expect(r.items.map((i) => i.id)).toEqual(["r0", "r1"]);
    expect(r.next).toEqual({ before: new Date("2026-09-04T00:00:00Z"), skip: 1 });
  });
  it("a tie at the boundary is neither skipped nor repeated across two pages", () => {
    const T = "2026-09-07T10:00:00.000Z";
    const audit = [at("x3", "2026-09-08T00:00:00Z"), at("x2", T), at("x1", "2026-09-01T00:00:00Z")];
    const approvals = [at("y2", T), at("y1", "2026-09-02T00:00:00Z")];
    const page1 = mergeTimeline([audit.slice(0, 3), approvals.slice(0, 3)], 2, null);
    expect(page1.items.map((i) => i.id)).toEqual(["x3", "y2"]); // y2 > x2 by id desc within the tie
    expect(page1.next).toEqual({ before: new Date(T), skip: 1 });
    // the page-2 fetch is `when <= before` per source, cut to limit + 1
    const auditP2 = audit.filter((r) => r.when <= page1.next!.before).slice(0, 3);
    const approvalsP2 = approvals.filter((r) => r.when <= page1.next!.before).slice(0, 3);
    const page2 = mergeTimeline([auditP2, approvalsP2], 2, page1.next);
    expect(page2.items.map((i) => i.id)).toEqual(["x2", "y1"]);
    expect(page2.next).toEqual({ before: new Date("2026-09-02T00:00:00Z"), skip: 1 });
    const page3 = mergeTimeline([audit.filter((r) => r.when <= page2.next!.before), approvals.filter((r) => r.when <= page2.next!.before)], 2, page2.next);
    expect(page3.items.map((i) => i.id)).toEqual(["x1"]);
    expect(page3.next).toBeNull();
  });
});

describe("cursor round-trip", () => {
  it("parses and serialises", () => {
    const c = { before: new Date("2026-09-07T10:00:00.000Z"), skip: 2 };
    expect(parseTimelineCursor(new URLSearchParams(timelineCursorQS(c)))).toEqual(c);
    expect(parseTimelineCursor(new URLSearchParams(""))).toBeNull();
    expect(parseTimelineCursor(new URLSearchParams("before=garbage&skip=1"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`src/lib/timeline.ts`)

```ts
/**
 * Phase 17 (spec §5.2). The two merged timelines read two or three tables
 * newest-first; no single SQL page exists across them, so paging is a cursor:
 * `before` is the instant of the last item shown and `skip` how many items AT
 * that instant were already shown. A direct action writes its approval row and
 * audit entry with one `now`, so ties across the boundary are the normal case.
 */
export const TIMELINE_PAGE_SIZE = 50;
export interface TimelinePoint { id: string; when: Date }
export interface TimelineCursor { before: Date; skip: number }

const byWhenDesc = <T extends TimelinePoint>(a: T, b: T) => b.when.getTime() - a.when.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * `sources` are each already `where when <= cursor.before` (when a cursor is
 * given), ordered when desc, id desc, and cut to `limit + 1` rows.
 */
export function mergeTimeline<T extends TimelinePoint>(sources: T[][], limit: number, cursor: TimelineCursor | null): { items: T[]; next: TimelineCursor | null } {
  const union = sources.flat().sort(byWhenDesc);
  let start = 0;
  if (cursor) {
    let seen = 0;
    while (start < union.length && seen < cursor.skip && union[start].when.getTime() === cursor.before.getTime()) { start++; seen++; }
  }
  const items = union.slice(start, start + limit);
  const anySourceOverflowed = sources.some((s) => s.length > limit);
  const more = anySourceOverflowed || union.length - start > limit;
  if (!more || items.length === 0) return { items, next: null };
  const last = items[items.length - 1];
  const skip = items.filter((i) => i.when.getTime() === last.when.getTime()).length;
  return { items, next: { before: last.when, skip } };
}

export function parseTimelineCursor(params: URLSearchParams): TimelineCursor | null {
  const raw = params.get("before");
  if (!raw) return null;
  const before = new Date(raw);
  if (Number.isNaN(before.getTime())) return null;
  const skip = Math.max(0, Number.parseInt(params.get("skip") ?? "0", 10) || 0);
  return { before, skip };
}

export function timelineCursorQS(c: TimelineCursor): string {
  return `before=${encodeURIComponent(c.before.toISOString())}&skip=${c.skip}`;
}
```
Hand-check the tie test with this code before running: page 1 union = x3, y2, x2, x1(no — x1 is 09-01), y1 …: sorted desc by when then id desc → x3 (09-08), y2 (T), x2 (T), y1 (09-02), x1 (09-01); items = [x3, y2]; last = y2; skip = 1 (only y2 at T among items); more = union.length − 0 > 2 → next {T, 1} ✓. Page 2 sources filtered `<= T`: audit [x2, x1], approvals [y2, y1]; union sorted: y2 (T), x2 (T), y1, x1; cursor skip 1 at T → skip y2 → items [x2, y1]; last y1 at 09-02, skip 1; more = 4 − 1 > 2 ✓ → next {09-02, 1}. Page 3: audit `<= 09-02` → [x1]; approvals → [y1]; union y1, x1; skip y1 → items [x1]; more = 2 − 1 > 2? no; overflow? no → next null ✓. (The `skip` counted in the test as "items whose when equals last.when" — note `skip` counts within the current page only; a tie spanning more than one full page is not a realistic case here and is documented in the comment.)

- [ ] **Step 4: History page** — `count` + `pageOf(total, parsePage(sp), LOG_PAGE_SIZE)` + `findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take })`; page gains `searchParams`; under the table a line `page {pg.page} of {pg.pageCount} · {pg.total} entries` and `<Pagination hrefFor={(p) => p > 1 ? `?page=${p}` : "?"} />`.

- [ ] **Step 5: Timeline pages** — each source query gains `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`, `take: TIMELINE_PAGE_SIZE + 1`, and `where: { ..., ...(cursor ? { createdAt: { lte: cursor.before } } : {}) }`; map each row to `{ id, when: createdAt, item }` (the existing `when`/`item` construction), call `mergeTimeline([auditPts, approvalPts(, reservationPts)], TIMELINE_PAGE_SIZE, cursor)`, render `items.map((x) => x.item)`. Below the list: `{next && <ButtonLink href={`?${timelineCursorQS(next)}`}>Older</ButtonLink>}` and `{cursor && <ButtonLink href="?">Newest</ButtonLink>}` in a flex row. Both pages gain `searchParams`.

- [ ] **Step 6: Verify** — `npx vitest run` (+5), `npx tsc --noEmit`, `npx eslint`; dev server: an asset timeline renders; with `?before=<now>&skip=0` it still renders.

- [ ] **Step 7: Commit** — `git commit -m "feat(timelines): history pages by number; the two merged timelines page with an Older cursor that survives identical timestamps"`

---

### Task 7: Worklist caps and the policies head-count

**Files:**
- Modify: `src/lib/worklist.ts:43,65-74` (+test), `src/server/modules/home/queries.ts:27-108,265`, `src/components/home/worklist.tsx:6-22`, `src/app/(app)/inventory/work/page.tsx`, `src/lib/loadout.ts` (+test), `src/app/(app)/admin/equipment-policies/page.tsx:25-44`

**Interfaces:**
- Produces:
  ```ts
  // worklist.ts
  export interface WorkGroup { section: WorkSection; rows: WorkRow[]; total: number; capped: boolean }
  export function groupWork(rows: WorkRow[], dismissed: Set<string>, opts: { limit?: number }, saturated: ReadonlySet<WorkSectionId> = new Set()): WorkGroup[]
  // loadout.ts
  export function headcountByPolicy<P extends PolicyLike>(groups: Array<{ title: string; departmentId: string; count: number }>, policies: P[]): Map<string, number>
  ```

- [ ] **Step 1: Failing tests** — `worklist.test.ts`: `groupWork(rows, new Set(), {}, new Set(["triage"]))` → the triage group has `capped: true`, repairs `capped: false`; `loadout.test.ts`: `headcountByPolicy([{ title: "Team Lead", departmentId: "dept-fin", count: 3 }, { title: "Accountant", departmentId: "dept-fin", count: 5 }, { title: "Driver", departmentId: "dept-ops", count: 2 }], policies)` → `p-title: 3`, `p-dept: 5`, nobody for ops (Map has no key or 0).

- [ ] **Step 2: Implement** — `groupWork` adds `capped: saturated.has(section.id)`; `headcountByPolicy` = `for each group: const p = resolvePolicy({ title, departmentId }, policies); if (p) map.set(p.id, (map.get(p.id) ?? 0) + count)`.

- [ ] **Step 3: `worklist()`** — name the per-source caps once (`const CAP = { small: 10, large: 50 }`), use them in the `take`s, and after the reads build `const saturated = new Set<WorkSectionId>(); if (triage.length === CAP.large) saturated.add("triage"); if (repairs.length === CAP.large) saturated.add("repairs"); if (loans.length === CAP.large) saturated.add("loans"); if (missing.length === CAP.small || orphaned.length === CAP.small) saturated.add("missing"); if (awaiting.length === CAP.small) saturated.add("check"); if (hires.length === CAP.small) saturated.add("hires"); if (breached.length === CAP.small || failed.length === CAP.small || leavers.length === CAP.small) saturated.add("queue");` and pass it to `groupWork`.

- [ ] **Step 4: UI** — `worklist.tsx`: the heading count shows `{g.capped ? `${g.total}+` : g.total}`; the link reads `See all {g.capped ? `${g.total}+` : g.total}` (condition `g.total > g.rows.length || g.capped`); under a capped section when `!seeAllBase` (the work page) render `<p className="text-[11px] text-fg-muted">Showing the first {g.total} — the oldest first.</p>`.

- [ ] **Step 5: Policies page** — replace the `employee.findMany` with `prisma.employee.groupBy({ by: ["title", "departmentId"], where: { employment: { not: "OFFBOARDED" } }, _count: { _all: true } })`, map to `{ title, departmentId, count: g._count._all }`, `const heads = headcountByPolicy(groups, policies)`, `employees: heads.get(p.id) ?? 0`.

- [ ] **Step 6: Verify** — `npx vitest run` (+2), `npx tsc --noEmit`, `npx eslint`. **Step 7: Commit** — `git commit -m "feat(worklist,policies): capped sections say 50+; the policies page counts heads from a grouped query"`

---

### Task 8: End-to-end

**Files:**
- Create: `e2e/paging.spec.ts`
- Modify: `e2e/admin.spec.ts` (deliveries cases that may reference the old line), `e2e/axe-sweep.spec.ts` (add `/approvals?page=2`, `/employees?page=2`, `/admin/webhooks/deliveries?page=2` — these render only when a page 2 exists; the sweep must manufacture 60 approvals, 30 employees and 60 deliveries in its own `beforeAll`, or the routes are added to `paging.spec.ts`'s own axe calls instead — the implementer picks the second: axe on `?page=2` inside `paging.spec.ts` with a copied `expectNoSeriousAxe`, leaving the sweep's list alone)

**Protocol (mandatory):** foreground Playwright only, `E2E_PORT=3100`, `--workers=1`, one or two files per command, port 3100 free before each run, no server left behind. A case that cannot reach its spec row is a report item, never a weakened assertion.

- [ ] **Step 1: Fixtures in `beforeAll`** (after `npm run db:seed`), all through one `PrismaClient`, ids looked up by tag/employeeNo/refNo, generated identifiers with the `ZZ` tag prefix, `EMP-9xxx` numbers and `APR-PAGE-nnnn` refNos:
  - 120 SPARE IT laptops `BR-ZZ-0001…0120` (`createMany` on `asset`; category *Laptop*, `itVerifiedAt: now`), then 120 PENDING `lifecycle_change_status` approvals on them (`createMany`, `slaAt` staggered by minute so the order is deterministic, `requestedById` = it@'s user id).
  - 30 OFFBOARDING employees `EMP-9001…9030` in Finance; 40 ACTIVE Finance employees `EMP-9101…9140` with no assets and distinct `joinedAt`; (for the scale smoke) 560 more ACTIVE employees `EMP-9201…9760` and 880 more assets `BR-ZZ-0121…1000` — i.e. **1000 `ZZ` assets and 630 new employees in total** (created in one `createMany` each).
  - 30 ACTIVE reservations on 30 of the `ZZ` spares for 30 of the new employees.
  - 30 users `page-user-01…30@thebackroomop.com`, role viewer, `passwordHash: null`.
  - One webhook endpoint (`active: true`) and 120 deliveries on it (`createMany`, mixed statuses, `createdAt` staggered by second).
  - One asset (`BR-ZZ-0001`) with 120 audit entries whose `createdAt` decrease by minute, except entries 48–53 which share one exact `createdAt` (the boundary tie), `entityType: "asset"`, `action: "page.test"`.
  - 60 DEFECTIVE IT assets (`BR-ZZ-0900…0959` status DEFECTIVE, `defectiveSince` staggered).

- [ ] **Step 2: Cases** (`test.describe.serial`, sign in as `it@` unless stated; helpers copied from `direct-lifecycle.spec.ts`):
  1. **Approvals**: `/approvals` shows `page 1 of` and `in this tab`; collect the refNos on pages 1–3 (`/approvals?page=N`), assert disjoint and their count equals the Open tab badge; `/approvals?page=99` renders the same rows as the last page; `/approvals?tab=closed` renders.
  2. **Offboarding**: header `N people leaving` where N = DB count of OFFBOARDING employees; page 2 exists; the names on pages 1 and 2 are disjoint.
  3. **Reservations**: `/reservations?state=ACTIVE&page=2` exists; the Active tab badge equals the DB count.
  4. **Users** (admin@): `/admin/users?page=2` exists; page 1's first row is the permanent admin.
  5. **Deliveries** (admin@): `/admin/webhooks/deliveries?page=3` exists; `page.getByText(/Older attempts/)` has count 0.
  6. **Employees**: `/employees?sort=joinedAt&page=2` exists; the toolbar count equals the DB employee count; the employeeNos on pages 1 and 2 are disjoint; `/employees?gaps=1` shows only rows with a missing count and still pages.
  7. **Timeline cursor**: `/inventory/<id of BR-ZZ-0001>/timeline` lists 50 items and an *Older* link; following *Older* twice collects three pages; the union of audit ids (read the `audit-<id>` element ids or the rendered rows' keys — use `data-id` if `TimelineList` exposes one, else count rows and check `Newest` returns to page 1) equals 120 with no repeats — assert at minimum: page sizes 50/50/20, no *Older* on the last page, and the tie group's six entries all appear exactly once across the pages (grep the rendered `page.test` rows' timestamps).
  8. **History**: `/inventory/<id>/history` shows `page 1 of 3 · 120 entries`.
  9. **Worklist cap**: `/` Repairs heading shows `50+` and *See all 50+*; `/inventory/work` shows 50 repair rows and the "first 50" note.
  10. **Policies head-count** (admin@): the *Finance standard* card's count equals the DB count of non-OFFBOARDED Finance employees whose title matches no title policy.
  11. **Scale smoke**: `/inventory` shows `page 1 of` with a count ≥ 41 and `/inventory?page=41` renders rows; `/employees` shows ≥ 26 pages and its last page renders; `/`, `/approvals`, `/inventory/work` return 200 (use `page.goto` + a heading assertion).
  12. **Axe**: `expectNoSeriousAxe` (copied) on `/approvals?page=2`, `/employees?page=2`, `/admin/webhooks/deliveries?page=2`, `/inventory/<id>/timeline?<cursor>`.

- [ ] **Step 3: Run** — `E2E_PORT=3100 npx playwright test e2e/paging.spec.ts --workers=1 --global-timeout=600000`; then `e2e/admin.spec.ts e2e/approvals-audit.spec.ts` (one command); then `e2e/home-finance.spec.ts e2e/it-core.spec.ts` (the Home count/worklist copy changes); fix locators this phase changed, never assertions.

- [ ] **Step 4: Commit** — `git commit -m "test(e2e): paging.spec -- pages on every list, the timeline cursor, worklist caps, policy head-count, a 1000-asset / 600-employee smoke"` with the measured `--list` total.

---

### Task 9: Full battery, docs, close-out

**Files:**
- Modify: `docs/HANDOVER.md` (header line, new §0 item **(j)**, the battery commands in item 9), `docs/PICKUP.md` (Battery row, Last two phases, §4, §5), the spec's Status line, this plan's `D-` block if amendments accrued

- [ ] **Step 1: Battery**, five foreground chunks (`E2E_PORT=3100 … --workers=1`):
```bash
npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts e2e/department-owned.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/receiving.spec.ts e2e/asset-classes.spec.ts e2e/direct-lifecycle.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/scanner.spec.ts e2e/labels.spec.ts e2e/registration.spec.ts e2e/custody.spec.ts e2e/paging.spec.ts --workers=1 --global-timeout=900000
npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```
then `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx playwright test --list | tail -1`.

- [ ] **Step 2: Docs** — HANDOVER header: Phase 17 code-complete on its branch with measured counts (18 migrations); item **(j)**: the core shape (`pageOf`; five lists paged; employees in SQL; `mergeTimeline`; capped worklist; `headcountByPolicy`; seven indexes), why (spec §1), what remains (merge/push; the §9 stakeholder subsystems; Phase 15b depreciation). PICKUP: Battery row; Last two phases (17 then 16); §4 next steps; §5: repair-stage in-memory path and facet drift remain by decision; webhook retention. Spec Status: `implemented on branch \`phase-17-scale-sweep\`, <date>`.

- [ ] **Step 3: Commit** — `git commit -m "docs(phase-17): HANDOVER (j), PICKUP battery and next steps, spec status; battery <unit> unit / <files> · <e2e> e2e / 19 files"`

---

## Self-review (run by the plan author before Task 1)

**Spec coverage.** §2 → T1, T2; §3 approvals → T3; §3 offboarding/reservations/users/deliveries → T4; §3 tiebreakers → T2 (+T5 for employees); §4 → T5; §5.1 → T6 S4; §5.2 → T6; §6 → T7; §7 → T1; §9.1 → T1, T2, T5, T6, T7; §9.2 → T8; docs → T9.

**Type consistency.** `pageOf`'s `Page` shape is consumed identically in T2–T6 (`pg.page/pageCount/skip/take/total`). `buildEmployeeOrderBy` (T5) mirrors `buildAssetOrderBy` (T2). `mergeTimeline`'s sources are `TimelinePoint`s carrying an `item` field via generics — the pages extend `T` with `{ item: TimelineItem }`. `groupWork`'s fourth parameter defaults to an empty set so Home's existing call compiles until T7 wires `saturated`.

**Known judgement calls.** The tie cursor counts `skip` within the current page only (a tie longer than a full page is not a realistic case and is documented). The scale smoke asserts rendering and page counts, not timings. Axe on paged routes lives in `paging.spec.ts`, not the sweep, because the rows exist only in that file's fixtures.
