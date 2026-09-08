# Phase 17 — The Scale Sweep — Design

**Status:** implemented on branch `phase-17-scale-sweep`, 2026-09-08; the user waived the spec-review and
execution-choice gates ("no need for approval proceed to subagent development"); amendments are `D-`
entries at the top of the plan.

**Goal:** every list that can grow pages properly at 1000 assets and 600 employees, with no list that
reads the whole table into memory to show one page, no ordering that can repeat or skip a row between
pages, and no "showing 50 of N" cap standing in for pagination.

**Source requirement:** the user's words of 2026-09-07 — *"also pagination of every thing that needs
pagination, we might have 1000 assets and 600 employees"* — deferred to this phase by the Phase 16 spec
(§1 row 1, §10). Approach chosen 2026-09-08: page numbers everywhere, an "Older" cursor for the merged
timelines, one shared paging rule.

---

## 0. Naming — read this first

`admin` is the sysadmin role. "Entity list" means a list of things (assets, employees, people leaving,
reservations, users) — 25 per page. "Log list" means a list of events (approvals, audit, activity,
purchases, deliveries) — 50 per page. Both sizes already exist in the code; this phase names them once.
"Tiebreaker" means a trailing `id` in an `orderBy`, so two rows equal on the primary key still have one
order.

---

## 1. Decisions, with who made them and what was rejected

| # | Question | Decision | By | Rejected |
|---|---|---|---|---|
| 1 | Paging style | **Page numbers via the house `Pagination` component for every single-table list; an "Older" cursor for the two merged timelines.** | user | "Load more" client islands everywhere; caps with a "showing N of M" line. |
| 2 | Page sizes | **25 for entity lists, 50 for log lists**, named once in `src/lib/paging.ts`. | assistant | One size for everything. |
| 3 | Out-of-range pages | **Clamped to the last page on the server** by the shared `pageOf` helper; the URL is left alone. | assistant | A 404; an empty page. |
| 4 | The employees list | **Plain list pages in SQL and resolves loadouts for the page only; the "policy gaps only" filter keeps its in-memory cut over a narrow select.** | user (approach) / assistant (shape) | Storing `missingRequired` on the employee (derived state stored — §6a of HANDOVER forbids it). |
| 5 | Merged timelines | **"Older" link with a cursor `before=<ISO>&skip=<n>` that survives identical timestamps**; History (single source) pages by number over audit entries. | assistant | Cursor on `(when, id)` pairs across three tables; a client island. |
| 6 | Worklist totals | **Keep the per-source caps; say "See all 50+" when a source hit its cap.** | assistant | Counting every source (seven more `count` queries per Home load). |
| 7 | Policies page head-count | **A grouped count by (title, department) resolved per group.** | assistant | The 600-row employee read. |
| 8 | Indexes | **One additive migration** adding the indexes the new orderings need. Migration count 17 → 18. | assistant | No indexes (the sort is over an index prefix today; fine at 600, not at 6000). |
| 9 | Repair-stage filter | **Unchanged** — it only ever covers the DEFECTIVE subset (scope decision 5b stands). | assistant | Moving the stage into SQL. |
| 10 | Facet counts under the gaps filter | **Unchanged** (documented drift; the counts are display-only). | assistant | A SQL expression for the loadout cut (impossible). |
| 11 | Webhook delivery retention | **Out of scope**, recorded. | assistant | A pruning job. |

---

## 2. One paging rule

`src/lib/paging.ts` (pure, tested):

```ts
export const ENTITY_PAGE_SIZE = 25;
export const LOG_PAGE_SIZE = 50;

export interface Page { page: number; pageCount: number; skip: number; take: number; total: number }

/** Clamp a requested page into [1, pageCount] and derive skip/take. total 0 → one empty page. */
export function pageOf(total: number, requested: number, size: number): Page
```

Rules: `pageCount = Math.max(1, Math.ceil(total / size))`; `page = Math.min(Math.max(1, requested), pageCount)`;
`skip = (page - 1) * size`; `take = size`. Every list in §3–§5 calls `pageOf` after its `count`, and the
eleven hand-written `Math.max(1, Math.ceil(total / X))` sites (inventory ×2, employees, finance, audit ×2,
purchases, four activity pages) are replaced by it. The constants above replace `PAGE_SIZE` (inventory,
employees), `FINANCE_PAGE_SIZE`, `QUEUE_PAGE_SIZE`, `AUDIT_PAGE_SIZE`, `PURCHASE_PAGE_SIZE`,
`DELIVERY_PAGE` and the four local `PAGE_SIZE = 50` — each becomes an import, with the same values.

`parseListState` keeps its lower clamp; the upper clamp lives in `pageOf` so lists without `ListState`
(approvals tabs, deliveries tabs, offboarding, users, reservations) get the same behaviour. The
`Pagination` component is unchanged. Pages that parse `?page=` by hand use one small helper,
`parsePage(params: URLSearchParams): number` in `src/lib/paging.ts` (same rule as `parseListState`).

---

## 3. Lists that gain pages

Every list below: a `count` for the total, `skip`/`take` from `pageOf`, an id tiebreaker in `orderBy`, a
`page X of Y` line and `<Pagination>` under the table (rendered only when `pageCount > 1`, as the
component already does), and `hrefFor(page)` that preserves the tab or filters in the URL.

| List | Query | Size | Order | Notes |
|---|---|---|---|---|
| `/approvals` per tab | `listApprovals(tab, userId, role, page)` → `{ rows, total, page, pageCount }` | 50 | open tabs `[{ slaAt: "asc" }, { id: "asc" }]`; closed `[{ updatedAt: "desc" }, { id: "desc" }]` | `tabCounts` unchanged (the tab badges); the "showing N of M" line becomes *"page X of Y · M in this tab"*. `QueueTable`'s focus index is per page (a page change is a navigation). |
| `/offboarding` | `listOffboarding(page)` → `{ rows, total, page, pageCount }` | 25 | `[{ name: "asc" }, { employeeNo: "asc" }]` (employeeNo is unique — already a tiebreaker) | header reads *"N people leaving"* from `total`. The per-row decided-count math runs on the page's rows only. |
| `/reservations` per tab | `listReservations(tab, page)` → `{ rows, counts, total, page, pageCount }` | 25 | `[{ createdAt: "desc" }, { id: "desc" }]` (exists) | `counts` from the existing `groupBy`; `total = counts[tab]`. |
| `/admin/users` | `listUsers(page)` → `{ rows, total, page, pageCount }` | 25 | `[{ isPermanentAdmin: "desc" }, { name: "asc" }, { id: "asc" }]` | the page gets `?page=` like the others. |
| `/admin/webhooks/deliveries` per tab | `listDeliveries(tab, page)` → `{ rows, total, deadReplayable, page, pageCount }` | 50 | `[{ createdAt: "desc" }, { id: "desc" }]` (exists) | the line *"Showing N of M. Older attempts aren't paged through yet."* is deleted; `<Pagination>` replaces it. Scope decision #12 is closed by this phase. |

**Tiebreakers added where paging already exists:** `listAudit` (`createdAt desc, id desc`), the four
activity pages (`createdAt desc, id desc`), `listPurchases` (`updatedAt desc, id desc`), `listAssets`
(`buildAssetOrderBy` gains a trailing `{ id: "asc" }`), `financeAssets` (trailing id), and `listEmployees`
(§4). A pure test asserts each order array ends with an `id` entry where the module exposes its builder.

---

## 4. The employees list in SQL

`src/server/modules/employees/queries.ts`:

- **Plain list** (`gapsOnly === false`): `count(where)` → `pageOf(total, state.page, ENTITY_PAGE_SIZE)` →
  `findMany({ where, orderBy: [...both sort keys, { id: "asc" }], skip, take, include: { department, assets: { select: { id, tag, model, typeId, status } } } })`
  → policies once → exceptions for the page's ids only (`employeeId: { in: pageIds }`) → `computeLoadout(effectiveSlots(...))`
  per row. No employee outside the page is read.
- **Gaps filter** (`gapsOnly === true`): a candidate pass `findMany({ where, select: { id: true, title: true, departmentId: true, assets: { select: { typeId: true, status: true } } }, orderBy })`
  plus exceptions for those ids (narrow select), resolve loadouts, keep `missingRequired > 0`, then
  `pageOf(kept.length, page, 25)` and a second `findMany` for the page's ids with the full include. The
  candidate pass reads three scalar columns per employee and two per asset — at 600 employees that is a
  few thousand small rows, not the full table with departments.
- **Export** (`employeeExportRows`): when `gapsOnly` is false, `count(where)` first and refuse over
  `EXPORT_CAP` before materialising (mirroring the assets export); when true, the existing post-hoc
  check stands (the cut needs the rows).
- **Facets**: unchanged (decision 10).
- `activeEmployeeOptions()` (combobox source, ~600 rows of id/name/employeeNo) is unchanged — a select
  of three columns with no relations is the right shape for a combobox.

`missingRequired` semantics (null only when neither a policy nor an ADD exception) are unchanged; the
existing unit tests for `effectiveSlots`/`computeLoadout` cover the rule.

---

## 5. Timelines

### 5.1 Asset History — page numbers

`src/app/(app)/inventory/[id]/history/page.tsx`: `count` + `pageOf(total, parsePage(sp), LOG_PAGE_SIZE)` +
`findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take })`, then `historyRows`
over the page's entries. The page line reads *"page X of Y · N entries"* (entries, not rows — `historyRows`
fans one entry into one row per changed field).

### 5.2 Asset Timeline and Employee Timeline — an "Older" cursor

`src/lib/timeline.ts` (pure, tested):

```ts
export interface TimelinePoint { id: string; when: Date }
export interface TimelineCursor { before: Date; skip: number }
export const TIMELINE_PAGE_SIZE = 50;

/** Merge newest-first sources already cut to `limit` each, apply the cursor, return one page and the next cursor. */
export function mergeTimeline<T extends TimelinePoint>(
  sources: T[][], limit: number, cursor: TimelineCursor | null,
): { items: T[]; next: TimelineCursor | null }

export function parseTimelineCursor(params: URLSearchParams): TimelineCursor | null   // ?before=<ISO>&skip=<n>
export function timelineCursorQS(c: TimelineCursor): string                            // "before=...&skip=n"
```

Rules: each source is fetched `orderBy: [{ <when column>: "desc" }, { id: "desc" }]`, `take: limit + 1`,
and when a cursor is present `where: { <when column>: { lte: cursor.before } }`. `mergeTimeline` sorts
the union by `when desc, id desc`, drops the first `cursor.skip` items whose `when` equals
`cursor.before` (the ones the previous page already showed at that instant), takes `limit`, and returns
`next = { before: last.when, skip: countOf(items, when === last.when) }` when any source returned more
than `limit` rows or the union held more than `limit` after the drop, else `null`. Identical timestamps
across the boundary are therefore never skipped or repeated — a direct change writes its approval row
and audit entry at the same `now`, so this case is real, and a unit test pins it.

Pages: `src/app/(app)/inventory/[id]/timeline/page.tsx` (audit entries by `createdAt`, approvals by
`updatedAt` — today's `when` for each source is kept) and `src/app/(app)/employees/[id]/timeline/page.tsx`
(audit, approvals, reservations). Each renders the page's items through the existing `TimelineList` and,
when `next` is non-null, an *"Older"* `ButtonLink` to `?${timelineCursorQS(next)}`; a *"Newest"* link back
to the bare URL appears whenever a cursor is active. No client island: titles stay server-rendered JSX.

---

## 6. Worklist totals and the policies page

**Worklist.** `worklist()` already caps each source (`take` 10 or 50). It now passes the set of sections
whose source returned exactly its cap into `groupWork(rows, dismissed, opts, saturated: Set<WorkSectionId>)`;
`WorkGroup` gains `capped: boolean`. `src/components/home/worklist.tsx` renders *"See all 50+"* when
`capped`, else *"See all N"* as today. `/inventory/work` (no `limit`) shows every row the caps allow and a
one-line note under a capped section: *"Showing the first 50 — the oldest first."*

**Policies page.** `src/app/(app)/admin/equipment-policies/page.tsx` replaces
`employee.findMany({ select: { title, departmentId } })` with
`employee.groupBy({ by: ["title", "departmentId"], where: { employment: { not: "OFFBOARDED" } }, _count: { _all: true } })`
and a pure `headcountByPolicy(groups, policies): Map<policyId, number>` in `src/lib/loadout.ts` that
resolves each `(title, departmentId)` group with `resolvePolicy` and sums `_count`. Same numbers, bounded
by distinct title/department pairs.

---

## 7. Indexes — migration 18

`prisma/migrations/20260908100000_scale_indexes/migration.sql`, additive, no data change:

```sql
CREATE INDEX "Approval_state_updatedAt_idx"          ON "Approval"("state", "updatedAt");
CREATE INDEX "Reservation_state_createdAt_idx"       ON "Reservation"("state", "createdAt");
CREATE INDEX "AuditEntry_entityType_entityId_createdAt_idx" ON "AuditEntry"("entityType", "entityId", "createdAt");
CREATE INDEX "Employee_departmentId_idx"             ON "Employee"("departmentId");
CREATE INDEX "Employee_name_idx"                     ON "Employee"("name");
CREATE INDEX "Employee_joinedAt_idx"                 ON "Employee"("joinedAt");
CREATE INDEX "WebhookDelivery_status_createdAt_idx"  ON "WebhookDelivery"("status", "createdAt");
```

`schema.prisma` mirrors them with `@@index` lines. Migration count 17 → 18. Seed unchanged.

---

## 8. What does not change

The `Pagination` component; `parseListState`'s parsing (only the constants move); every list's filters,
facets, sorting keys and copy other than the lines named above; the repair-stage in-memory path; the
facet-count drift under `gaps=1`; `activeEmployeeOptions()`; Home's `limit: 2` per section; the worker;
every server action.

---

## 9. Testing

Baselines on `main` at `6d046da`: 1040 unit / 56 files · 227 e2e / 18 files · `tsc` and `lint` clean ·
17 migrations.

### 9.1 Unit (pure, `src/lib`)

- `paging.test.ts`: `pageOf` — total 0 → page 1 of 1, skip 0; requested 0 and 99 clamp; exact multiples;
  `parsePage` mirrors `parseListState`'s lower clamp.
- `timeline.test.ts`: `mergeTimeline` — interleaves three sources newest-first; a tie at the boundary
  (two items with the same `when` split across pages) is neither skipped nor repeated across two calls;
  `next` is null when every source is exhausted; `parseTimelineCursor`/`timelineCursorQS` round-trip.
- `worklist.test.ts`: `groupWork` sets `capped` for a saturated section and not otherwise.
- `loadout.test.ts`: `headcountByPolicy` — title policy beats department policy per group; groups with
  no policy are not counted; sums `_count`.
- `url-state.test.ts`: unchanged behaviour asserted (lower clamp stays in `parseListState`).
- Order builders: a test that `buildAssetOrderBy(...)` and the employees order builder end with an `id`
  entry.

### 9.2 End-to-end — new `e2e/paging.spec.ts`

Rows are created through Prisma in the file's own `beforeAll` after the seed, with `createMany` where the
model allows it; every tag/employeeNo/refNo is generated with a distinctive prefix (`ZZ`, `EMP-9xxx`,
`APR-PAGE-…`) so nothing collides with seeded fixtures or other specs. Never a raw cuid.

1. **Approvals** — 120 extra PENDING approvals on distinct spare assets: the Open tab shows *page 1 of 3*,
   page 2 exists, the refNos across pages 1–3 are disjoint and total the tab count; the Closed tab pages
   too; `?page=99` lands on the last page.
2. **Offboarding** — 30 extra OFFBOARDING employees: *"N people leaving"* equals the DB count; page 2 has
   the remainder; names do not repeat across pages.
3. **Reservations** — 30 extra ACTIVE reservations: page 2 on the Active tab; tab counts unchanged in
   meaning.
4. **Users** — 30 extra users: `/admin/users?page=2`; the permanent admin stays first on page 1.
5. **Deliveries** — 120 extra deliveries on one endpoint: page 3 exists, the old *"Older attempts aren't
   paged through yet"* text is absent.
6. **Employees in SQL** — 40 extra ACTIVE Finance employees with no assets: `/employees` page 2, `total`
   equals the DB count, sorting by `joinedAt` keeps pages disjoint; `?gaps=1` still cuts to people with
   gaps and pages that cut.
7. **Timeline cursor** — an asset given 120 audit entries, six of which share one exact `createdAt` at
   what will be the page boundary: page 1 shows 50, *Older* shows the next 50 with no repeated and no
   missing entry id (the DB set of 120 ids equals the union of three pages), *Newest* returns to page 1.
8. **History pages** — the same asset's History reads *page 1 of 3 · 120 entries*.
9. **Worklist cap** — 60 DEFECTIVE IT assets: Home's Repairs section says *"See all 50+"*; `/inventory/work`
   shows 50 rows and the "first 50" note.
10. **Policies head-count** — after case 6's 40 Finance employees, the *Finance standard* card's count
    rose by 40.
11. **Scale smoke** — 1000 IT assets (`ZZ` prefix, SPARE) and 600 employees created with `createMany`:
    `/inventory` reads *page 1 of 41+* and page 41 renders; `/employees` reads *page 1 of 25+* and its last
    page renders; `/approvals`, `/` and `/inventory/work` render without error; each of the four pages
    answers within Playwright's default navigation timeout (no explicit timing assertion).

Existing specs to touch: `e2e/approvals-audit.spec.ts` if it asserts the old "showing N of M" line
(the fact sheet says it does not); `e2e/admin.spec.ts` deliveries cases (the old "Older attempts" line);
`e2e/axe-sweep.spec.ts` gains `?page=2` variants for `/approvals`, `/employees` and
`/admin/webhooks/deliveries` (they render only when a page 2 exists — the sweep runs after `paging.spec`
in chunk order, or manufactures its own rows; the plan decides). Expected: 227 → about 238 e2e / 19 files.

---

## 10. Out of scope, on the record

- Repair-stage filter in SQL; webhook delivery retention; facet counts under the gaps filter.
- "Load more" islands; infinite scroll.
- Search indexes (trigram) — search is fine at this size.
- Home caching.
- Bulk import of employees at 600 rows is already capped by `IMPORT_ROW_CAP = 2000`.

---

## 11. Files

New: `prisma/migrations/20260908100000_scale_indexes/migration.sql` · `src/lib/paging.ts` (+test) ·
`src/lib/timeline.ts` (+test) · `e2e/paging.spec.ts`.

Changed: `prisma/schema.prisma` · `src/lib/worklist.ts` (+test) · `src/lib/loadout.ts` (+test) ·
`src/lib/inventory-list.ts` (order builder) · `src/lib/employees-list.ts` (order builder) ·
`src/server/modules/{approvals,offboarding,reservations,admin,employees,inventory,finance,audit,purchases,home}/queries.ts` ·
`src/app/(app)/approvals/page.tsx` · `src/app/(app)/offboarding/page.tsx` · `src/app/(app)/reservations/page.tsx` ·
`src/app/(app)/admin/users/page.tsx` · `src/app/(app)/admin/webhooks/deliveries/page.tsx` ·
`src/components/admin/delivery-table.tsx` · `src/components/home/worklist.tsx` · `src/app/(app)/inventory/work/page.tsx` ·
`src/app/(app)/admin/equipment-policies/page.tsx` · `src/app/(app)/employees/page.tsx` · `src/app/(app)/employees/export/route.ts` ·
`src/app/(app)/inventory/[id]/{history,timeline}/page.tsx` · `src/app/(app)/employees/[id]/timeline/page.tsx` ·
the four `*/activity/page.tsx` · `src/app/(app)/audit/page.tsx` · `src/app/(app)/purchases/page.tsx` ·
`src/app/(app)/finance/assets/page.tsx` · `src/app/(app)/inventory/page.tsx` · `e2e/{admin,axe-sweep}.spec.ts` ·
`docs/PICKUP.md` · `docs/HANDOVER.md`.
