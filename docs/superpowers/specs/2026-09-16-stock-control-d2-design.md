# Phase 22 — Stock control D2: FIFO lots and costing, expiry, reports, receipt documents

**Status:** design approved in conversation 2026-09-16 (no requisitions; uncosted stock is real but valueless;
expiry optional on any lot with earliest-expiry-first consumption; three reports; allocation rows written at
issue time with D1 history backfilled in the migration), spec written the same day. The user said "proceed to
dev": the method runs through to the finishing menu without further check-ins; merging, pushing and
redeploying stay the user's decisions.

**Plan:** `docs/superpowers/plans/2026-09-16-phase-22-stock-control-d2.md` (written next).

**Builds on:** Phase 19's spec `2026-09-09-stock-control-design.md` (D1: categories, items, the append-only
movement ledger, derived balances, stocktakes, import, export). Nothing D1 shipped changes meaning; D2 adds
the layer D1 deliberately left out.

---

## 0. Decisions made in the brainstorm

| # | Decision | Why |
|---|---|---|
| 1 | No requisition flow. Purchasing keeps recording issues directly; departments ask outside the app. | D1 decision 2 stands; nobody has used the ledger on staging yet, so there is no evidence for a request lifecycle. Recorded as decided, not deferred. |
| 2 | FIFO by lot. Every inflow is a lot; every outflow is split across lots by an allocation table; a lot's remaining quantity and every value are derived. | The D1 spec's own note ("D2 will consume lots oldest-first … an allocation table so a lot's remaining quantity is derived, never stored"). |
| 3 | Uncosted stock is real but valueless. Opening stock and positive adjustments become uncosted lots; an issue drawing from one shows its cost as "—"; reports count uncosted units beside the value; a null lot cost can be set once, later. | D1 imported opening stock without a cost and receipts' cost is optional; refusing to value them is honest, refusing to move them would be absurd. |
| 4 | Expiry is optional on any lot; issues consume the earliest-expiring lot first, undated lots last; expired lots are skipped by issues and taken first by adjustments; a write-off aims an adjustment at one lot. | Pantry is the obvious case, but a cleaning chemical expires too; a rule per category is a second rule for no gain. |
| 5 | Three reports, each a page with an xlsx export: on hand and value; consumption by department and month; expiring and expired lots. | The value on hand is what Finance asked for in the stakeholder meeting; consumption by department is what Purchasing manages by; expiry is what the pantry loses money to. |
| 6 | Receipt documents attach to a lot through a `StockLotDocument` table mirroring `RequestDocument`. | D1 decision 8 reserved "a fourth document table" for D2. |
| 7 | Purchasing's Home gains two tiles, below reorder level and expiring within 30 days. | The D1 spec parked "a Home worklist low-stock signal"; a tile on the card Purchasing already reads is the smallest form of it. |
| 8 | The six D1 leftovers close here (§8). | They are all in files this phase touches. |
| 9 | The migration backfills D1's history — lots for lot-less inflows, allocations for every outflow — and asserts the result before it commits. | Staging already holds real D1 movements; the reports must be right on day one, and a wrong replay must fail the deploy rather than ship. |

---

## 1. Scope

**In:** everything in §0; migration 23 with its backfill; the pure allocation and report rules; the changed
and new actions; the Lots card, the write-off and set-cost dialogs, lot documents; the Expires field; the
`EXPIRING`/`EXPIRED` pill and toggle on `/stock`; the three report pages and their exports; the Reports nav
entry; the two Home tiles; the import's unit cost honoured and its two fixes; seed; tests; documents.

**Out (recorded so nobody infers them):** requisitions (decided no); locations and transfers; weighted-average
costing; editing a lot's cost once set; barcode labels for stock items; consumption by employee; any change to
the asset register, purchasing or supplier areas beyond the one Home card.

**Behaviour that must not change:** every D1 rule — code series, one base unit, the append-only ledger, the
balance as `SUM(quantity)`, the stocktake flow and its variance/drift maths, the over-issue guard's shape,
import verdicts other than the two named fixes; every existing URL (new routes and query parameters only).

---

## 2. Data model — migration 23 `stock_lots_and_allocations`

### 2.1 `StockLot` (changed)

Gains `expiresAt DateTime?` (a calendar date stored as UTC midnight, like `lotDate`), `origin StockLotOrigin
@default(RECEIPT)` with `enum StockLotOrigin { RECEIPT, OPENING, ADJUSTMENT }`, and `allocations
StockAllocation[]`, `documents StockLotDocument[]`. New index `@@index([itemId, expiresAt])`. `unitCost` keeps
its type; §5 makes it settable exactly once when null.

### 2.2 `StockAllocation` (new, append-only)

`id`, `movementId` → StockMovement (Restrict), `lotId` → StockLot (Restrict), `quantity Int` (> 0, base units),
`createdAt`. `@@unique([movementId, lotId])`, `@@index([lotId])`, `@@index([movementId])`. Back-relations
`StockMovement.allocations`, `StockLot.allocations`.

### 2.3 `StockLotDocument` (new)

Mirrors `RequestDocument` field for field: `id`, `lotId` → StockLot (Restrict), `kind String`
(`delivery-receipt` | `invoice` | `other`), `fileName`, `path`, `checksum`, `uploadedById String?` → User
(Restrict, relation `"stockLotDocuments"`), `createdAt`; `@@index([lotId])`.

### 2.4 Ledger invariants (application-enforced, test-proven)

- Every positive movement (`OPENING`, `RECEIPT`, positive `ADJUSTMENT`) has a `lotId` whose lot's `quantity`
  equals the movement's quantity.
- Every negative movement (`ISSUE`, negative `ADJUSTMENT`) has allocations whose quantities sum to
  `-quantity`.
- Σ remaining over an item's lots = the item's balance. (`remaining(lot) = lot.quantity − Σ allocations`.)

### 2.5 Derived values (never columns)

- **remaining(lot)** = `quantity − SUM(allocation.quantity)`; a lot with remaining 0 is *closed*.
- **expired(lot, today)** = `expiresAt !== null && expiresAt < today` on the Asia/Manila calendar
  (`localDateISO`).
- **available(item)** = balance − Σ remaining of expired lots.
- **onHandValue(item)** = Σ remaining × unitCost over costed lots; **uncostedUnits(item)** = Σ remaining
  over lots with `unitCost = null`.
- **cost(movement)** = Σ allocation.quantity × lot.unitCost over costed lots; null when every unit came
  from uncosted lots; when mixed, the costed part plus an uncosted-units count.
- **consumption(department, month)** = Σ over `ISSUE` movements with `occurredAt` in that Asia/Manila
  calendar month: units and cost as above.

### 2.6 Database guards (hand-written after the generated DDL)

- `CREATE TRIGGER stock_allocation_append_only BEFORE UPDATE OR DELETE ON "StockAllocation" FOR EACH ROW
  EXECUTE FUNCTION forbid_mutation();` (the function migration 14 created and migration 20 reused).
- `ALTER TABLE "StockAllocation" ADD CONSTRAINT stock_allocation_quantity_positive CHECK ("quantity" > 0);`

### 2.7 Backfill (inside the migration, after the guards)

A single `DO $$ … $$` block:

1. `ALTER TABLE "StockMovement" DISABLE TRIGGER stock_movement_append_only;` — the one and only time a
   movement row is updated, to give lot-less inflows their `lotId`; re-enabled at the end of the block.
2. For every `OPENING` movement and every `ADJUSTMENT` with `quantity > 0` whose `lotId IS NULL`: insert a
   `StockLot` (`itemId`, `origin` `OPENING`/`ADJUSTMENT`, `lotDate = occurredAt`, `quantity = movement
   quantity`, `unitCost NULL`, `receivedById = actorId`, `createdAt = movement createdAt`) and set the
   movement's `lotId`.
3. For every item, iterate its negative movements (`ISSUE`, `ADJUSTMENT` with `quantity < 0`) in
   `occurredAt, id` order and allocate `-quantity` across that item's lots with `lotDate <= movement
   occurredAt` (or all lots if that leaves a shortfall — a D1 backdated receipt), ordered `lotDate, id`, each
   lot's remaining being its quantity minus allocations already written in this replay. No lot has an expiry
   before D2, so the order is plain FIFO.
4. `ALTER TABLE "StockMovement" ENABLE TRIGGER stock_movement_append_only;`
5. Assert: `RAISE EXCEPTION` if any negative movement's allocations do not sum to `-quantity`, or any positive
   movement still has `lotId IS NULL`, or any lot's remaining is negative. A failed assertion fails the
   migration and therefore the deploy.

The seed does not rely on the backfill: it writes lots and allocations directly through the same pure rule
(§4) so a fresh database and a migrated one agree.

### 2.8 Seed additions

- The six seeded receipt lots already carry unit costs and keep them; every opening lot is uncosted. Two new
  receipt lots: `OS-0003` 24 pads, 9 days ago, reference `DR-1105`, **no unit cost** (the "Set unit cost"
  case); `PN-0003` 100 sachets, 20 days ago, `DR-1103`, unit cost 0.90, `expiresAt` **5 days ago** with
  nothing issued from it — the seeded expired lot with units remaining.
- Expiry: `PN-0001`'s receipt lot (60 sachets, 14 days ago) gets `expiresAt` 10 days ahead — the seeded
  issue of 110 then consumes that lot first (earliest expiry) and 50 of the uncosted opening lot, leaving
  40 on the opening lot; `CM-0001`'s lot gets `expiresAt` 200 days ahead; the other lots stay undated.
- The seed's `issue()` helper allocates through `allocate()` in `"skip"` mode as it writes each issue, so
  seeded allocations follow the same rule the actions apply; the two stocktake adjustments become an
  allocation (−2 on `CM-0001`, taken from the opening lot as the oldest) and an adjustment lot (+1 on
  `CM-0003`). Opening movements get their `OPENING` lots at creation.
- No seeded document (the seed writes no files today); the e2e attaches one.
- The TRUNCATE list gains `"StockLotDocument", "StockAllocation"` before `"StockLot"`.

---

## 3. Access and routes

Unchanged roles: `canManageStock` (`purchasing_staff`, `admin`) for every write — receive, issue, adjust,
write off, set cost, attach; every signed-in role reads items, lots, reports and downloads documents.

New routes, all under the Purchasing workspace's Stock section:

| Route | Who | What |
|---|---|---|
| `/stock/reports` | all | redirects to `/stock/reports/on-hand` |
| `/stock/reports/on-hand` (+ `/export`) | all | §6.1 |
| `/stock/reports/consumption` (+ `/export`) | all | §6.2 |
| `/stock/reports/expiry` (+ `/export`) | all | §6.3 |
| `/stock/lots/[id]/documents/[docId]` | all signed-in | the guarded file download, same shape as the request-document route |

`WORKSPACE_NAV`'s Stock section gains `{ label: "Reports", href: "/stock/reports" }` after "Stocktakes".
`PATH_RULES`: the existing `/stock` read rule already admits every role to `/stock/reports/**`; the write rule
regex is unchanged (write-off, set-cost and upload are actions, not pages). The command palette's Stock group
gains the three reports.

---

## 4. Pure rules (`src/lib`)

### 4.1 `stock-allocation.ts` (+ test)

```ts
export interface LotState { id: string; remaining: number; unitCost: number | null; lotDate: Date; expiresAt: Date | null }
export type ExpiredPolicy = "skip" | "first";
export interface Allocation { lotId: string; quantity: number; unitCost: number | null }
export type AllocationResult =
  | { ok: true; allocations: Allocation[]; cost: number | null; costedUnits: number; uncostedUnits: number }
  | { ok: false; short: number; expiredRemaining: number };

export function isExpired(expiresAt: Date | null, today: string /* YYYY-MM-DD, Asia/Manila */): boolean;
export function consumptionOrder(lots: LotState[], today: string, policy: ExpiredPolicy): LotState[];
export function allocate(lots: LotState[], quantity: number, today: string, policy: ExpiredPolicy): AllocationResult;
export function lotRemaining(quantity: number, allocated: number): number;
export function onHand(lots: LotState[]): { units: number; costedUnits: number; uncostedUnits: number; value: number };
export function expiryLabel(expiresAt: Date, today: string): string; // "expires today" | "expires in N days" | "expired N days ago"
export const EXPIRY_WINDOWS = [7, 30, 90] as const; export const DEFAULT_EXPIRY_WINDOW = 30;
```

`consumptionOrder`: with `"skip"`, expired lots are removed and the rest sort by `expiresAt` ascending with
`null` last, then `lotDate` ascending, then `id`; with `"first"`, expired lots (soonest-expired first) come
before the same ordering of the rest. `allocate` refuses `quantity <= 0` (throws — a programming error, not a
user input; callers validate first), walks the order taking `min(remaining, left)` from each lot with
remaining > 0, and returns the shortfall when the lots run out. `cost` is null when `costedUnits === 0`.

### 4.2 `stock-reports.ts` (+ test)

`monthKey(date): string` (`YYYY-MM` on the Asia/Manila calendar via a cached `Intl.DateTimeFormat`);
`monthsBetween(from, to): string[]`; `consumptionGrid(rows: { department; monthKey; units; cost; uncostedUnits }[])`
→ departments × months with per-cell `{ units, cost, uncostedUnits }`, row and column totals;
`expiryBuckets(lots, today, windowDays)` → `{ expired: Lot[]; expiring: Lot[] }` each sorted by `expiresAt`;
`defaultConsumptionRange(today)` → the first day of the month five months back through today.

### 4.3 Schemas (`stock-schema.ts`)

`receiptSchema` gains `expiresAt: dateStr.optional().default("")` with a refinement "Expires cannot be before
the lot date" when both are set. New: `writeOffSchema { lotId, quantity: int ≥ 1 optional (default: the lot's
remaining, resolved server-side), reason: reasonRequired({ min: 3, max: 200, message: "Say why" }) }`,
`setLotCostSchema { lotId, unitCost: number ≥ 0, two decimals }`, `lotDocumentKinds = ["delivery-receipt",
"invoice", "other"]`. The stock list config gains the facet `expiring`.

### 4.4 Export columns (`export-columns.ts`)

`ON_HAND_EXPORT_COLUMNS` (Code, Name, Category, Unit, Balance, Open lots, Costed units, Uncosted units, Value
on hand, Oldest lot, Nearest expiry), `CONSUMPTION_EXPORT_COLUMNS` (Department, Month, Category, Code, Item,
Units, Cost, Uncosted units), `EXPIRY_EXPORT_COLUMNS` (Status, Code, Item, Lot date, Reference, Supplier,
Expires, Days, Remaining, Unit cost, Value at risk). Money cells use the existing money column shape.

### 4.5 Import (`import-stock.ts`, `import-vocabulary.ts`)

- A `unitCost` cell on a CREATE row with opening stock prices the opening lot; the "Unit cost is ignored"
  notice and its test go.
- `StockRefs.categories` entries gain `archived: boolean`; a row naming an archived category blocks with the
  new appended cause `archived-stock-category` — label "Category is archived", explain "That category is
  archived. Restore it under Stock categories, or name an active one.", no option fix. `applyStockImport`
  re-reads the category before writing and refuses the same way.
- Duplicate detection: a code row also registers `new:<refKey(category)>|<refKey(name)>` from the matched
  existing item, so the same item named once by code and once by name blocks as `duplicate-in-file`.

---

## 5. Server module `src/server/modules/stock/`

### 5.1 `queries.ts`

- `itemLots(itemId, today)` → open lots first (remaining > 0, `consumptionOrder` order, expired flagged), then
  closed lots collapsed to a count; each with `remaining`, `unitCost`, `value`, `expiresAt`, `expiryLabel`,
  `reference`, `supplier`, `receivedBy`, `origin`, `documents[]`.
- `getStockItem` gains `available`, `onHandValue`, `uncostedUnits`, `expiring: "expired" | "expiring" | null`,
  and each history row's `cost` and `uncostedUnits` (one `groupBy` over allocations joined to lots for the
  page's movement ids).
- `listStockItems` and `stockExportRows` gain the `expiring` facet (items with any open lot expired or
  expiring within `DEFAULT_EXPIRY_WINDOW`) and per-row `expiring`, computed over the candidate set the low-stock
  path already uses.
- `onHandReport(state)`, `consumptionReport({ from, to }, state)`, `expiryReport(windowDays, state)` and their
  `…ExportRows` twins; `stockHomeSignals(today)` → `{ low: number; expiringLots: number }`.
- Every list keeps D1's paging through `pagedSnapshot`.

### 5.2 `movement-actions.ts`

One internal helper owns all outflows and inflow lots:

```ts
async function recordOutflow(tx, item, kind: "ISSUE" | "ADJUSTMENT", quantity /* > 0 */, policy: ExpiredPolicy, fields, opts?: { onlyLotId?: string })
async function recordInflowLot(tx, item, origin: "OPENING" | "ADJUSTMENT", quantity, unitCost, fields)
```

`recordOutflow` reads the item's open lots under the existing `FOR UPDATE` item lock, runs `allocate`, throws
`ActionFailure(conflict(...))` on a shortfall, writes the movement and its allocations, and returns the cost.
`onlyLotId` restricts the lots to one (the write-off). Callers:

- **receiveStock** — `expiresAt` stored on the lot; unchanged otherwise.
- **issueStock** — `recordOutflow(..., "skip")`; refusal when short: `Only {available} unexpired {unit} of
  {code} — write off the expired lot first` when expired units exist, else D1's `Only N {unit} left of
  {code} — issue at most that many`. The audit diff gains `cost`.
- **adjustStock** — a positive result → `recordInflowLot("ADJUSTMENT", …)`; a negative result →
  `recordOutflow(..., "ADJUSTMENT", "first")`.
- **writeOffLot** (new) — `recordOutflow(..., "ADJUSTMENT", "first", { onlyLotId })`, quantity defaulting to
  the lot's remaining, refused when it exceeds it (`Only N left on this lot`); reason required; audit
  `stock.written-off` with `{ lot, quantity, reason }`.
- **setLotCost** (new) — under the item lock, refused when `unitCost` is already set (`This lot already has a
  cost`), else writes it; audit `stock.lot-cost-set`.
- **postStocktake** (`stocktake-actions.ts`) — its per-line adjustments call `recordInflowLot` /
  `recordOutflow("first")` instead of writing bare movements.

### 5.3 `document-actions.ts` (new)

`uploadLotDocument(formData)` — `canManageStock`, `checkRate`, kind validated against `lotDocumentKinds`,
`validateUpload`, `storeUpload("stock-lots/<lotId>", file)`, the row, audit `stock.document-added`. The download
route checks `requireUser` and streams the file like the request-document route.

### 5.4 Audit and palette

`auditSentence` gains `stock.written-off` ("wrote off 12 pieces of PN-0003 — Expired"), `stock.lot-cost-set`,
`stock.document-added`; the audit resolver labels `stock-lot` entities by item code and reference. The palette's
Stock group gains "On hand and value", "Consumption", "Expiring lots".

---

## 6. Screens

### 6.1 `/stock/reports/on-hand`

Toolbar: Category facet, toggle "Uncosted only" / "Show all", Export. A one-line rule under the header: "Value is
FIFO over costed lots; uncosted units are counted, not valued." Table grouped by category with a subtotal row
per category (units, value, uncosted units) and a grand total: Code (link), Name, Unit, Balance, Open lots,
Costed units, Uncosted units, Value on hand (money, mono), Oldest lot, Nearest expiry (with the
`EXPIRING`/`EXPIRED` pill). Empty: "No stock items yet."

### 6.2 `/stock/reports/consumption`

Toolbar: From / To date inputs (`aria-label`s "From" and "To"; default `defaultConsumptionRange`), Category
facet, Export. Grid: rows are departments that issued anything in the range, columns are the months in the
range, each cell `units` on one line and `₱cost` beneath (mono), with an asterisk and a footnote "* includes N
uncosted units" when the cell drew from unpriced lots; a Total column and a Total row. Empty: "No issues in
this range." The export is the flat sheet of §4.4 (one row per department × month × item).

### 6.3 `/stock/reports/expiry`

Toolbar: window chips `7 days · 30 days · 90 days` (`role="group" aria-label="Expiry window"`, active chip
`aria-current="true"`; URL `?days=`), Category facet, Export. Two blocks with headings **Expired** and
**Expiring within N days**; each a table: Code (link), Item, Lot date, Reference, Supplier, Expires, Days
(`expiryLabel`, red when expired), Remaining, Unit cost, Value at risk, and for managers a **Write off**
button opening the write-off dialog. Empty block copy: "Nothing has expired." / "Nothing expires within N
days." Fully consumed lots never appear.

### 6.4 The item page `/stock/items/[id]`

Header gains an `EXPIRING` or `EXPIRED` pill after `LOW`. Balance card gains lines "Available N (M expired)"
when expired units exist, "Value on hand ₱X" and "N uncosted units" when any. New **Lots** card between
Balance and History: open lots in consumption order — Lot date, Expires (`expiryLabel`), Reference, Supplier,
Remaining of received (`12 of 60`), Unit cost ("—" when null), Value; per-row manager actions **Set unit
cost** (only when null), **Write off**, **Attach document**; each lot's documents listed under its row as
download links with kind pills; a footer "N closed lots" when any. History's rows gain a **Cost** cell:
issues and negative adjustments show `₱X` (or "—", or `₱X + N uncosted`); positive rows show the lot's unit
cost when priced.

Dialogs (all `getByRole("dialog")`-scoped, `aria-label`s as named): **Write off** — Quantity (default the
remaining, max the remaining), Reason (prefilled "Expired" when the lot is expired), Confirm; toast "Wrote off
12 sachets of PN-0003". **Set unit cost** — Unit cost, Save; toast "Lot priced at ₱12.50". **Attach document**
— Kind select, File, Upload; toast "Document attached".

### 6.5 `/stock/receive`, `/stock`, Home

Receive form: **Expires** date input after Lot date (`aria-label="Expires"`), optional, refused before the
lot date. The `/stock` list: pill `EXPIRING`/`EXPIRED` beside `LOW`; toggle link "Show expiring only" / "Show
all" writing `expiring=1`; the stat line gains "· K with expiring lots". Purchasing Home's "Your requests"
card: two more `Stat` tiles — "Below reorder level" (value links to `/stock?low=1`) and "Expiring within 30
days" (value links to `/stock/reports/expiry`).

---

## 7. Error handling

Every action keeps D1's shape: role guard, `checkRate`, zod, `ActionResult`, refusals thrown inside the
transaction as `ActionFailure` and mapped outside, `revalidatePath` on the item, the list and the reports.
Copy: `Expires cannot be before the lot date`; `Only 12 unexpired sachets of PN-0001 — write off the expired
lot first`; `Only N left on this lot`; `This lot already has a cost`; `Say why`; `That category is archived —
restore it or pick another` (import); D1's messages unchanged. The append-only trigger on allocations turns
any accidental edit into a loud database error. The backfill's assertion fails the migration, never the data.

---

## 8. The D1 leftovers closed here

1. Importer refuses an archived category in the planner (`archived-stock-category`) and in the apply path.
2. Importer's two-key duplicate check (§4.5).
3. `receive-form.tsx`'s unused `SupplierOption.archived` prop removed (and the caller's population of it).
4. `stocktake-review.tsx`'s redundant `state === "OPEN"` re-check removed.
5. `stocktake-count.tsx`'s always-true `canCount` prop removed.
6. The import's unit cost honoured (§4.5); the "ignored" notice removed.

---

## 9. Testing

### 9.1 Unit (vitest)

- `stock-allocation.test.ts` — order with mixed expiry/undated lots; expired skipped for "skip" and first for
  "first"; a lot exactly consumed then the next; shortfall with `expiredRemaining`; cost null / mixed /
  full; `expiryLabel` at −2, 0, +3 days on Asia/Manila; `onHand` totals; `quantity <= 0` throws.
- `stock-reports.test.ts` — `monthKey` at 15:59Z vs 16:00Z on the last day of a month; `monthsBetween`;
  `consumptionGrid` totals and the uncosted footnote flag; `expiryBuckets`; `defaultConsumptionRange`.
- `stock-schema.test.ts` — `expiresAt` before lot date refused; write-off and set-cost schemas.
- `import-stock.test.ts` — unit cost now carried; archived category blocked; the two-key duplicate.
- `import-vocabulary.test.ts` — totality with the new cause.
- `export-columns.test.ts` — the three column sets render a row.
- `activity.test.ts` — the three new sentences.

### 9.2 E2E (foreground, `E2E_PORT=3100 --workers=1`)

- `e2e/stock-lots.spec.ts` (8): 1 receive with Expires → the Lots card row and label; 2 issue consumes the
  earliest-expiring lot first (DB: allocations on that lot) and History shows the cost; 3 an issue of
  `PN-0003` (only an expired lot has units) is refused with the expired-units message; 4 write off from the
  expiry report empties the lot, posts a negative adjustment, the report row disappears; 5 Set unit cost on
  `OS-0003`'s lot once, refused the second time; 6 a positive adjustment creates an adjustment lot in the
  Lots card; 7 attach a document to a lot, download it as `viewer@` (200, content-disposition); 8 invariant:
  for every item Σ remaining = balance (Prisma).
- `e2e/stock-reports.spec.ts` (6): 1 on-hand totals equal a Prisma-computed FIFO value and uncosted count; the
  "Uncosted only" toggle; the export's header row; 2 consumption grid cell for a seeded department/month
  equals the DB sum, the flat export; 3 expiry report's two blocks with the seeded lots, the 7/30/90 chips;
  4 `/stock` pill and `expiring=1` toggle; 5 Purchasing Home's two tiles equal the DB counts; 6 axe on the
  three reports and the item page.
- Updated: `stock.spec.ts` (the import's unit-cost notice; the item page's card order if a locator depended
  on it).

### 9.3 Battery at the close

The six chunks of Phase 21 with the two new files in chunk E; if E passes ~70 tests, split it into E1
(`custody axe-sweep kitchen-sink suppliers purchasing-ext`) and E2 (`stock stocktake stock-lots
stock-reports`). `tsc`, `eslint`, `vitest`, `prisma migrate status` (23), `--list`.

---

## 10. Files

Create: `src/lib/stock-allocation.ts` (+ test), `src/lib/stock-reports.ts` (+ test),
`src/server/modules/stock/document-actions.ts`, `src/components/stock/lots-card.tsx`, `write-off-dialog.tsx`,
`set-cost-dialog.tsx`, `lot-document-dialog.tsx`, `expiry-window-chips.tsx`, `consumption-grid.tsx`,
`src/app/(app)/stock/reports/{page,on-hand/page,on-hand/export/route,consumption/page,consumption/export/route,expiry/page,expiry/export/route}.tsx|ts`,
`src/app/(app)/stock/lots/[id]/documents/[docId]/route.ts`, `e2e/stock-lots.spec.ts`,
`e2e/stock-reports.spec.ts`, the migration.
Modify: `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/stock-schema.ts`, `stock-list.ts`,
`import-stock.ts`, `import-vocabulary.ts`, `export-columns.ts`, `activity.ts`, `workspaces.ts`,
`src/server/modules/stock/{queries,movement-actions,stocktake-actions}.ts`, `src/server/modules/home/queries.ts`,
`src/server/palette.ts`, `src/app/(app)/stock/page.tsx`, `items/[id]/page.tsx`, `src/app/(app)/page.tsx`,
`src/components/stock/{receive-form,stock-toolbar,stocktake-review,stocktake-count}.tsx`, `e2e/stock.spec.ts`.

---

## 11. Global constraints (copied into the plan)

Dev only in a worktree with its own `.env` (`inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no
`SEED_PASSWORD`); never the `inventory` database or port 3000; never read or print `.env`. Playwright
foreground, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a time. `"use server"`
modules export only async functions; role guard then `checkRate`; one `writeAudit` per write; refusals thrown
inside transactions. Additive migration (plus its backfill) only. Dates on the Asia/Manila calendar
(`localDateISO`, `fmtDate`). Reviewer subagents read-only. Measured counts govern.
