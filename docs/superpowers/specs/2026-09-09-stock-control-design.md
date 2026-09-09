# Phase 19 — Stock control, part D1: the ledger core

**Status:** implemented on branch `phase-19-stock-control` (9 tasks, `D-1`…`D-20`) — CODE-COMPLETE,
UNMERGED and UNPUSHED; see the plan's D-block for every ruling and deviation, and `docs/HANDOVER.md` (l)
for what shipped and the measured battery. Implements the first half of HANDOVER §9 item **D**
(consumables and stock control). Part **D2** — FIFO costing, expiry warnings, report views and exports by
department and month — is a separate phase with its own spec and consumes the lots this phase records.

**Plan:** `docs/superpowers/plans/2026-09-09-phase-19-stock-control.md`.

---

## 0. Decisions made in the brainstorm

| # | Decision | Why |
|---|---|---|
| 1 | D splits into D1 (this spec: items, ledger, derived balances, stocktake, import) and D2 (FIFO costing, expiry, reports). | §9 calls D the largest piece so far; the stocktake must come first, costing can wait. |
| 2 | Purchasing (`purchasing_staff`) and the sysadmin role record every movement; every signed-in role reads. No requisition flow. | §9's Admin = Purchasing owns supplies; departments ask outside the app today. |
| 3 | One store per item class: one balance per item, no locations, no transfers. | A single office; the category already says pantry or stockroom. |
| 4 | One base unit per item with an optional pack size; the receipt form converts packs; the ledger stores base units only. | Suppliers deliver boxes, people take pieces; one conversion at one form. |
| 5 | Item codes are `<PREFIX>-<4 digits>` per category; categories carry a unique 2–3 letter prefix and are maintained by Purchasing; codes are never edited or reused. | §9: "automatic item-code series by category … searchable". |
| 6 | A stocktake is a count session per category (or all) with a blind count, a variance review, and posting that writes one adjustment per differing item. Movements posted while a count is open are flagged. | §9: "reconcile receipts, movements and physical counts"; the untrusted "566 available". |
| 7 | One append-only movement ledger; the balance is `SUM(quantity)` per item, computed, never stored. Lots are recorded at receipt but not yet consumed. | HANDOVER §6a: derived state beats stored state; §9's own warning. |
| 8 | An issue names a department (required) and optionally an employee. Receipts carry a supplier (Phase 18 `Vendor`) and a reference number; no file upload in D1. | Mirrors purchase requests; a fourth document table waits for D2. |
| 9 | Nothing is deleted: items and categories archive; movements are append-only by trigger; corrections are new adjustments. | Same posture as the rest of the app. |

---

## 1. Scope

**In:** stock categories with code series; stock items with unit, pack size, reorder level and derived
balance; receipts (lot + movement), issues, adjustments; item movement history; low-stock flag and facet;
stocktakes with blind count, variance review and posting; a spreadsheet import of items and opening
stock; a balances export; a Stock area under the Purchasing workspace with read access for every role;
palette group; audit entries; migration 20 with an append-only trigger and quantity checks; seed; tests.

**Out (D2 or later, recorded so nobody infers them):** FIFO lot consumption, cost of issue and on-hand
value; expiry dates and warnings; reports by department/month and their exports; receipt documents;
requisitions; locations and transfers; a Home worklist signal for low stock (the list's facet and count
serve D1); barcode labels for stock items.

**Behaviour that must not change:** everything in the asset register, purchasing and supplier areas;
`Vendor` gains one back-relation only.

---

## 2. Data model — migration 20 `stock_control`

All new tables; two foreign keys into existing tables (`Vendor`, `Department`, `Employee`, `User`). Prisma
generates the DDL; the migration additionally carries the trigger and check constraints in §2.7.

### 2.1 `StockCategory`

`id`, `name String @unique`, `prefix String @unique` (2–3 uppercase letters, validated `^[A-Z]{2,3}$`),
`nextNumber Int @default(1)` (the series counter, advanced inside the item-create transaction),
`archivedAt DateTime?`, `createdAt`, `updatedAt`, `items StockItem[]`, `stocktakes Stocktake[]`.
A prefix cannot change once the category has an item (the codes already carry it). Archiving a category
hides it from the new-item form; its items keep working.

### 2.2 `StockItem`

`id`, `code String @unique` (`OS-0001`), `name String`, `categoryId` → StockCategory (Restrict),
`unit String` (base unit, free text ≤ 20, e.g. piece, bottle, ream, kg, litre; the form autocompletes from
existing values), `packSize Int?` (base units per pack, ≥ 2 when set), `reorderLevel Int @default(0)`
(0 = no alert), `notes String?`, `archivedAt DateTime?`, `createdAt`, `updatedAt`, relations
`movements`, `lots`, `stocktakeLines`. Indexes: `categoryId`, `archivedAt`, `name`.

### 2.3 `StockLot`

One per receipt. `id`, `itemId` → StockItem (Restrict), `supplierId String?` → Vendor (Restrict),
`lotDate DateTime` (the delivery or production date Purchasing enters; defaults to today), `unitCost
Decimal(12,2)?`, `quantity Int` (received, > 0), `reference String?` (invoice / delivery-receipt number),
`receivedById` → User (Restrict), `createdAt`, `movements StockMovement[]`. Index `itemId`, `supplierId`.
D2 will consume lots oldest-first; D1 only records them.

### 2.4 `StockMovement` (append-only)

`id`, `itemId` → StockItem (Restrict), `kind` enum `StockMovementKind { OPENING, RECEIPT, ISSUE,
ADJUSTMENT }`, `quantity Int` (SIGNED, base units: OPENING/RECEIPT > 0, ISSUE < 0, ADJUSTMENT ≠ 0),
`lotId String?` → StockLot (Restrict; set on RECEIPT), `departmentId String?` → Department (Restrict; set
on ISSUE), `employeeId String?` → Employee (Restrict; optional on ISSUE), `reason String?` (required on
ADJUSTMENT; the issue's purpose on ISSUE), `stocktakeId String?` → Stocktake (Restrict; set when an
ADJUSTMENT comes from posting), `actorId` → User (Restrict), `occurredAt DateTime` (the business date,
defaults to now; a receipt may be dated back to the delivery day, never into the future), `createdAt`.
Indexes: `(itemId, occurredAt, id)`, `kind`, `stocktakeId`, `departmentId`. (An `(itemId, createdAt)`
index was listed here originally and dropped at Task 1's review — ruling R6: nothing orders or filters by
`createdAt`; the `(itemId, occurredAt, id)` index serves history and balance.)

### 2.5 `Stocktake` and `StocktakeLine`

`Stocktake`: `id`, `refNo String @unique` (`ST-0001`, from a new sequence `stocktake_ref_seq`, the
purchase-request pattern), `categoryId String?` → StockCategory (null = every category), `state` enum
`StocktakeState { OPEN, POSTED, CANCELLED }`, `openedAt`, `openedById` → User, `postedAt?`,
`postedById?` → User, `note String?`, `lines`, `movements` (the adjustments it posted). Index `state`,
`categoryId`.
`StocktakeLine`: `id`, `stocktakeId` (Cascade — a stocktake is never deleted, Cascade keeps the schema
honest), `itemId` → StockItem (Restrict), `bookQty Int` (the derived balance when the stocktake opened),
`countedQty Int?`, `countedAt DateTime?`, `countedById String?`; `@@unique([stocktakeId, itemId])`.

### 2.6 Derived values (never columns)

- **balance(item)** = `SUM(movement.quantity)`; computed by `prisma.stockMovement.groupBy({ by: ["itemId"], _sum: { quantity: true } })` over the page's item ids (list) or one item (detail).
- **low(item)** = `reorderLevel > 0 && balance <= reorderLevel`.
- **variance(line)** = `countedQty - currentBalance` at review time; **drift(line)** = `currentBalance - bookQty` (movements since the stocktake opened; non-zero rows are flagged on the variance screen).

### 2.7 Database guards (hand-written in the migration after the generated DDL)

- `CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON "StockMovement" … EXECUTE FUNCTION <the existing append-only function>` (reuse the function `20260814084417_append_only_triggers` created; read its name there).
- `ALTER TABLE "StockMovement" ADD CONSTRAINT stock_movement_quantity_sign CHECK ((kind IN ('OPENING','RECEIPT') AND quantity > 0) OR (kind = 'ISSUE' AND quantity < 0) OR (kind = 'ADJUSTMENT' AND quantity <> 0))`.
- `ALTER TABLE "StockLot" ADD CONSTRAINT stock_lot_quantity_positive CHECK (quantity > 0)`.
- `CREATE SEQUENCE stocktake_ref_seq START 1;`
Use the identifiers exactly as Prisma emitted them in the same file.

### 2.8 Seed

Three categories: `OS` Office supplies, `CM` Cleaning materials, `PN` Pantry. Twelve items across them
(e.g. `OS-0001` Bond paper A4 ream, pack 5; `OS-0002` Ballpen black piece, pack 12, reorder 24; `CM-0001`
Dishwashing liquid bottle; `PN-0001` 3-in-1 coffee sachet, pack 30, reorder 60; …), each with an OPENING
movement dated 30 days ago, a receipt lot from "Metro Office Supply" on six of them, issues to three
departments over the last month, and one item left below its reorder level (`PN-0001` at 40 against 60).
One POSTED stocktake `ST-0001` on `CM` from 10 days ago with two adjustments; no OPEN stocktake. The
`stocktake_ref_seq` is left at 2.

---

## 3. Access and routes

`src/lib/stock-access.ts`: `canManageStock(role)` → `admin`, `purchasing_staff`. Reading any stock page
needs only a signed-in user (`requireUser`).

`PATH_RULES` (before any generic rule that could match `/stock`): write routes
`^/stock/(items/new|receive|issue|import|categories|stocktakes/new)(/|$)`,
`^/stock/items/[^/]+/(edit|adjust)(/|$)`, `^/stock/stocktakes/[^/]+/(count|review)(/|$)` → workspaces
`purchasing`, `admin`; roles `admin`, `purchasing_staff`. Read routes `^/stock(/|$)` → workspaces `it`,
`purchasing`, `finance`, `admin` (every role). Pages carry `requireRole("admin", "purchasing_staff")` /
`requireUser` as the backstop. `workspaces.test.ts` asserts the ordering.

Navigation: Purchasing workspace gains a **Stock** section — "Items" `/stock`, "Receive stock"
`/stock/receive`, "Issue stock" `/stock/issue`, "Stocktakes" `/stock/stocktakes`, "Stock categories"
`/stock/categories`, "Import items" `/stock/import` (write links `roles: ["admin", "purchasing_staff"]`).
Finance gains one read link "Stock" `/stock`; IT's nav is unchanged (palette reaches items).

---

## 4. Pure rules (`src/lib`)

- `stock-code.ts`: `PREFIX_SHAPE = /^[A-Z]{2,3}$/`; `formatStockCode(prefix, n)` → `${prefix}-${String(n).padStart(4, "0")}`; `parseStockCode(code)` → `{ prefix, n } | null`; `STOCK_CODE_SHAPE = /^[A-Z]{2,3}-\d{4}$/`.
- `stock-balance.ts`: `balanceOf(movements: { quantity: number }[])`; `isLow(balance, reorderLevel)`; `packToUnits(packs, packSize)`; `unitsLabel(qty, unit)` ("60 pieces" / "1 piece" — naive plural, or the unit as typed when it already ends in s).
- `stock-list.ts`: `STOCK_LIST_CONFIG: ListConfig = { facets: ["category", "low", "archived"], sortable: ["code", "name"], defaultSort: [{ key: "code", dir: "asc" }] }`; `buildStockItemWhere(state)` (archived hidden unless `archived=1`; `q` on code/name insensitive; category IN). `low` cannot be a SQL where (derived) — the query applies it after computing balances for the candidate set (§5.1).
- `stock-movement-rules.ts`: `movementQuantity(kind, entered)` → signed; `canIssue(balance, qty)` → `{ ok } | { ok: false; left }`; `ISSUE_REASON_MAX`, `ADJUST_REASON_MIN`.
- `stocktake.ts`: `planStocktakePost(lines: { itemId, bookQty, countedQty }[], current: Map<itemId, balance>)` → `{ adjustments: { itemId, quantity }[]; skipped: itemId[]; drifted: itemId[] }` (adjust `counted - current`; skip uncounted; drift = current ≠ book); `varianceRows(...)` for the review screen.
- `import-stock.ts`: header spec and planner (§6).
- Schemas: `stock-schema.ts` — `categorySchema` (name 1–60, prefix shape), `itemSchema` (categoryId, name 1–120, unit 1–20, packSize int ≥ 2 optional, reorderLevel int ≥ 0, notes ≤ 2000), `receiptSchema` (itemId, quantity int ≥ 1 in base units after conversion, packs optional, supplierId optional, lotDate `dateStr`, unitCost decimal ≥ 0 optional two decimals, reference ≤ 60, occurredAt `dateStr` not after today), `issueSchema` (itemId, quantity ≥ 1, departmentId required, employeeId optional, reason ≤ 200), `adjustSchema` (itemId, mode `"delta" | "set"`, quantity int (delta ≠ 0 / set ≥ 0), reason 3–200), `stocktakeOpenSchema` (categoryId or "all", note), `countSchema` (lineId, countedQty int ≥ 0).

---

## 5. Server module `src/server/modules/stock/`

### 5.1 `queries.ts`
- `listStockItems(state)` → `{ rows, total, page, pageCount, facets, lowCount }`. Count and page with `pageOf(total, page, ENTITY_PAGE_SIZE)` over `buildStockItemWhere`; then ONE `groupBy` sum over the page's ids; rows carry `balance`, `low`, `lastMovementAt`. When `state.filters.low` includes `"1"`: fetch the candidate ids for the where (narrow select), compute balances for all candidates in one groupBy, keep the low ones, page THAT id list (the employees-gaps pattern from Phase 17), then fetch the page rows. `facets.category` = groupBy over the where minus its own key; `lowCount` = the low count over the where minus `low`.
- `getStockItem(id, page)` → item, category, `balance`, `low`, movements page (`LOG_PAGE_SIZE`, `orderBy [{ occurredAt: "desc" }, { id: "desc" }]`, with lot ref/supplier, department, employee, actor names, stocktake refNo).
- `stockUnits()` → distinct units (≤ 50). `stockItemOptions(q?)` for the comboboxes (active items, code + name). `activeCategories()`.
- `listStocktakes(state)`; `getStocktake(id)` → header, lines with `bookQty`, `countedQty`, and for OPEN ones the current balances (one groupBy) so the review computes variance and drift.
- `stockExportRows(state)` → every row of the filtered list with balance (cap `EXPORT_CAP`).

### 5.2 `item-actions.ts`
- `createStockCategory`, `updateStockCategory` (prefix immutable once `items` exist → `validationError({ prefix: "This prefix already numbers items and cannot change" })`), `archiveStockCategory`/`restoreStockCategory`.
- `createStockItem(input)`: in one transaction, `UPDATE "StockCategory" SET "nextNumber" = "nextNumber" + 1 WHERE id = $1 RETURNING "nextNumber"` (raw, the row lock serialises concurrent creates), code = `formatStockCode(prefix, returned - 1)`, create the item; audit `stock.item.created` (`diff: { code: { from: null, to } , name }`) on entityType `stock-item`. Duplicate name inside a category is allowed (different sizes exist), duplicate code impossible by construction.
- `updateStockItem` (name, unit, packSize, reorderLevel, notes, category ONLY while the item has no movements — a code carries its prefix; moving a used item would lie), `archiveStockItem`/`restoreStockItem` (audit `stock.item.archived/restored`).

### 5.3 `movement-actions.ts`
- `receiveStock(input)`: item must be active; quantity = base units (the form converts packs; the server re-validates `packs * packSize === quantity` when `packs` is sent); creates `StockLot` and a `RECEIPT` movement `+quantity` with `lotId`, `occurredAt` = the entered date; audit `stock.received` on `stock-item` with `diff: { quantity: { from: null, to }, lot: { from: null, to: reference ?? lotDate } }`. Revalidate `/stock`, `/stock/items/[id]`.
- `issueStock(input)`: inside the transaction, lock the item row (`SELECT id FROM "StockItem" WHERE id = $1 FOR UPDATE`), compute the balance, refuse when `quantity > balance` with `conflict(`Only ${left} ${unit} left of ${code} — issue at most that many`)`; write `ISSUE` `-quantity` with department, employee, reason; audit `stock.issued` (`diff: { quantity: { from: balance, to: balance - quantity }, department: { from: null, to: name } }`).
- `adjustStock(input)`: mode `delta` writes the signed delta (≠ 0); mode `set` computes `target - balance` under the same row lock (0 → `ok(null)` with no write); reason required; audit `stock.adjusted` with `from`/`to` balance and the reason.
- `openStocktake(input)`: refuse when an OPEN stocktake already covers the category (or any OPEN one exists when opening "all", or an "all" is OPEN): `conflict("ST-0007 is still open for Pantry — post or cancel it first")`; `nextval('stocktake_ref_seq')`; create lines for every active item of the scope with `bookQty` = current balance (one groupBy); audit `stocktake.opened` on entityType `stocktake`.
- `countStocktakeLine(input)`: OPEN only; set `countedQty`, `countedAt`, `countedById` (re-count allowed); no audit per line (the post records the outcome); revalidate the stocktake page.
- `postStocktake(input)`: OPEN only; re-read current balances under item row locks; `planStocktakePost`; write one `ADJUSTMENT` per non-zero adjustment with `stocktakeId` and reason `Stocktake ${refNo}`; set POSTED; audit `stocktake.posted` with `diff: { adjusted: { from: null, to: n }, skipped: { from: null, to: m } }` — and one `stock.adjusted` audit per item as above. `cancelStocktake` → CANCELLED, audit `stocktake.cancelled`.

### 5.4 Palette, audit resolver, export
- `paletteSearch` gains `stock: PaletteHit[]` (code or name contains, active items, take 5, href `/stock/items/<id>`); gate `pathAllowedForRole("/stock", role)`.
- `entityLabels` learns `stock-item` (label `code · name`, href `/stock/items/<id>`), `stocktake` (refNo, `/stock/stocktakes/<id>`), `stock-category` (name, `/stock/categories`).
- `GET /stock/export` → `.xlsx` via `toXlsxBuffer(STOCK_EXPORT_COLUMNS, rows)` with columns Code, Name, Category, Unit, Pack size, Reorder level, Balance, Low, Last movement; same `EXPORT_CAP` refusal as the asset export.

---

## 6. Import — `/stock/import`

`ImportWizard` with `planStockImport` / `applyStockImport` (`src/server/modules/import/stock-actions.ts`),
pure planner `src/lib/import-stock.ts` through the shared `matchHeaders`.

Headers (`STOCK_IMPORT_HEADERS`): `code` (optional; labels "code", "item code", "stock code"), `name`
(required), `category` (required; matched by name OR prefix, case-insensitive), `unit` (required), `packSize`
("pack size", "per pack"), `reorderLevel` ("reorder level", "reorder", "minimum"), `openingQty` ("opening
quantity", "opening", "quantity", "on hand", "available"), `unitCost` ("unit cost", "cost"), `notes`.

Row rules: a row with a `code` matching an existing item → UPDATE of name/unit/packSize/reorderLevel/notes
(present columns only); a row with a code that does NOT exist → CREATE with that code if it matches the
category's prefix and `STOCK_CODE_SHAPE` (and the category's `nextNumber` is raised above it on apply),
else blocked `bad-stock-code`; a row without a code → CREATE with the next series code. `openingQty > 0`
on a CREATE → one `OPENING` movement dated the apply time. Opening stock is lot-less in D1, so a `unitCost`
column is accepted but IGNORED: the preview lists it under ignored columns with the notice "Unit cost is
recorded on receipts, not opening stock".
`openingQty` on an UPDATE row → blocked `opening-on-existing` ("this item already has a ledger — record a
receipt or an adjustment instead"). Causes appended to `BLOCK_CAUSES`: `unknown-stock-category`,
`bad-stock-code`, `bad-unit`, `opening-on-existing`, `duplicate-in-file` (existing) for a repeated code or
a repeated name+category pair, `bad-number` (existing) for non-integers. Row cap `IMPORT_ROW_CAP`. Apply
is one transaction per row with `import-create` / `import-update` audit rows on `stock-item`.

Fixtures (P-4 pattern): `stock-clean.xlsx` (3 new items with opening quantities), `stock-mixed.xlsx` (one
update by code, one new with a hand-written valid code, one bad code, one unknown category, one opening on
an existing item).

---

## 7. Screens — the Stock area

### 7.1 `/stock` — items
Toolbar: search (`aria-label="Search stock items"`), Category facet, a **Low stock** toggle link ("Show low
stock only" / "Show all"), archived toggle, an **Export** link. A stat line "N items · M below reorder
level". Table: Code (link), Name, Category, Unit, Balance (mono; `LOW` pill when low), Reorder level, Last
movement (date). Managers see "New item", "Receive stock", "Issue stock" buttons. Empty state: "No stock
items yet — add one or import your list."

### 7.2 `/stock/items/[id]`
Header: `code · name` as the title, category pill, `LOW` pill when low, `ARCHIVED` when archived; actions
(managers): Receive, Issue, Adjust (dialog), Edit, Archive/Restore. Cards: **Balance** (big number with unit;
reorder level; pack size; "N below reorder level" hint when low), **History** — paged movements: Date,
Kind pill (Opening / Receipt / Issue / Adjustment), Quantity (`+60` / `−12`, mono), Detail (lot reference
and supplier; department · employee; reason; stocktake ref link), By. The adjust dialog: mode Set to /
Change by, quantity, reason (required) — `aria-label`s "Adjustment mode", "Quantity", "Reason".

### 7.3 `/stock/items/new`, `/stock/items/[id]/edit`
`stock-item-form.tsx`: Category (select, active categories; disabled on edit once the item has movements,
with the hint "This code belongs to its category"), Name, Unit (input + datalist), Pack size, Reorder level,
Notes. New → redirect to the item with toast "Item OS-0007 created" (the code in the toast); edit → toast +
refresh.

### 7.4 `/stock/receive`, `/stock/issue`
Receipt form: Item (`EntityCombobox` over active items, `aria-label="Item"`), Quantity in base units
(`aria-label="Quantity"`), an optional Packs field that appears when the item has a pack size and fills
Quantity (`"5 boxes × 12 = 60 pieces"` live helper text), Supplier (active suppliers + none), Lot date,
Reference, Unit cost, Received on (date, defaults today). Success: toast "Received 60 pieces of OS-0002",
form clears, a "View item" link.
Issue form: Item, Quantity, Department (required, `aria-label="Department"`), Employee (optional, all
active), Purpose. The balance of the chosen item is shown beside Quantity ("120 pieces on hand"); an
over-issue is refused server-side with the spec's sentence and shown as a banner.

### 7.5 `/stock/stocktakes`, `/stock/stocktakes/new`, `/stock/stocktakes/[id]`
List: Ref, Scope (category or All), State pill, Opened, Posted, Lines counted / total. New: scope select +
note → creates and redirects to the count screen. Detail (OPEN): the **count screen** lists every line
with Code, Name, Unit and a Counted input (`aria-label="Counted <code>"`), saving on blur/Enter (one action
per line, debounced); the book quantity is HIDDEN here (blind count). A "Review variance" button (managers)
switches to the **review**: Code, Name, Book at open, Now (current), Counted, Variance (counted − now, mono,
coloured), a `MOVED` pill when drift ≠ 0, and "not counted" for empty lines; a summary line "N items
counted · M with a difference · K not counted · J moved since opening"; **Post** (confirm dialog naming the
adjustments count) and **Cancel**. POSTED: the review is read-only with a link to each adjustment's item.
Only managers count, review, post or cancel; others see the review read-only.

### 7.6 `/stock/categories`
Table Name, Prefix, Next code (`OS-0013`), Items, Archived; inline create (name + prefix) and rename;
prefix editable only while the category has no items; archive/restore.

### 7.7 Palette and Home
Palette group **Stock** ("OS-0002 · Ballpen black"). Home is unchanged in D1.

---

## 8. Error handling

Every action: role guard (`actionUser` + `canManageStock`) then `checkRate`, zod at the boundary, the
`ActionResult` union; `revalidatePath` on the item, the list and (for stocktakes) the stocktake pages.
Refusals name the fix: over-issue (`Only 12 pieces left of OS-0002 — issue at most that many`), archived
item on receipt/issue (`OS-0002 is archived — restore it first`), an open stocktake blocking another
(`ST-0007 is still open for Pantry — post or cancel it first`), a category prefix change with items (`This
prefix already numbers items and cannot change`), posting an OPEN stocktake that someone else posted
meanwhile (`This stocktake was already posted`), a future business date (`That date is in the future`).
The append-only trigger turns any accidental update/delete of a movement into a loud database error, never
a silent fix. The item-create counter and the issue/adjust balance checks run under row locks, so two
Purchasing users cannot double-issue the last box or mint the same code.

---

## 9. Testing

### 9.1 Unit (vitest)
- `stock-code.test.ts` — format/parse/round-trip, prefix shape.
- `stock-balance.test.ts` — sum incl. negatives, `isLow` (0 = never), `packToUnits`, `unitsLabel`.
- `stock-list.test.ts` — where: archived default, q on code/name, category IN.
- `stock-movement-rules.test.ts` — signed quantities per kind, `canIssue` boundary (equal allowed, one more refused).
- `stocktake.test.ts` — `planStocktakePost`: adjusts against CURRENT not book, skips uncounted, flags drift, zero-variance lines produce nothing.
- `stock-schema.test.ts` — packs×packSize consistency, future date refused, reason required on adjust, prefix rules.
- `import-stock.test.ts` — header aliases, code accepted/blocked, category by name or prefix, opening-on-existing blocked, duplicate in file, unit-cost-ignored notice.
- `stock-access.test.ts`, `workspaces.test.ts` (new PATH_RULES ordering).

### 9.2 E2E (foreground, `E2E_PORT=3100 --workers=1`)
**`e2e/stock.spec.ts`** (~11): 1 create a category `TS` and an item → code `TS-0001`, a second → `TS-0002`; 2 receive 5 packs of an item with pack 12 → helper says 60, balance +60, history row with lot reference and supplier; 3 issue 20 to HR with an employee → balance −20, row shows department · employee; 4 over-issue refused with the exact sentence, balance unchanged; 5 adjust "set to 35" with reason → history adjustment, balance 35; 6 low-stock: set reorder 50 → `LOW` pill, appears under "Show low stock only", stat line counts it; 7 archive item → gone from the default list and the receive combobox, restore; 8 import `stock-mixed.xlsx` → preview counts and causes, apply, codes as expected, the update kept its balance; 9 export → sheet header has Balance and the item's row; 10 roles: viewer sees items and history but no Receive/Issue/Adjust/New; finance sees the same; 11 axe on list, item, receive, issue, categories.
**`e2e/stocktake.spec.ts`** (~6): 1 open a stocktake for Pantry → lines for its active items, book hidden; 2 a second open for Pantry refused with the sentence; 3 count two lines, leave one uncounted; issue 2 of a counted item meanwhile → review shows `MOVED` on it, variance computed against Now; 4 post → adjustments equal counted − now, uncounted skipped, state POSTED, item history shows "Stocktake ST-000N"; 5 cancel path on a new stocktake; 6 axe on count and review.

### 9.3 Battery at the close
`tsc`, `lint`, full vitest, all e2e in foreground chunks with the two new files in the last chunk,
`--list` total recorded, 20 migrations on `inventory_dev`.

---

## 10. Files

**Create:** `prisma/migrations/<ts>_stock_control/migration.sql`; `src/lib/{stock-code,stock-balance,stock-list,stock-movement-rules,stocktake,stock-schema,stock-access,import-stock}.ts` (+ tests); `src/server/modules/stock/{queries,item-actions,movement-actions,stocktake-actions}.ts`; `src/server/modules/import/stock-actions.ts`; `src/components/stock/{stock-toolbar,stock-items-table,stock-item-form,receive-form,issue-form,adjust-dialog,movement-history,stocktake-count,stocktake-review,category-table}.tsx`; `src/app/(app)/stock/{page,export/route,items/new/page,items/[id]/page,items/[id]/edit/page,receive/page,issue/page,stocktakes/page,stocktakes/new/page,stocktakes/[id]/page,categories/page,import/page}.tsx`; `e2e/stock.spec.ts`, `e2e/stocktake.spec.ts`, `e2e/fixtures/stock-{clean,mixed}.xlsx`.

**Modify:** `prisma/schema.prisma`, `prisma/seed.ts`; `src/lib/{workspaces,import-vocabulary,export-columns,import-columns}.ts`; `src/server/palette.ts`, `src/server/modules/audit/queries.ts`, `src/server/modules/import/resolve.ts`; `src/components/shell/command-palette.tsx`; `e2e/fixtures/make.ts`; `docs/HANDOVER.md`, `docs/PICKUP.md`.

---

## 11. Global constraints (copied into the plan)

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env` (`inventory_dev`, port 3100, no `SEED_PASSWORD`); never the `inventory` database or port 3000; never seed staging; never commit `.env`.
- Playwright foreground, `E2E_PORT=3100 --workers=1 --global-timeout`, no server left behind.
- `pageOf` with the two page sizes and id tiebreakers on every paged query; balances computed, never stored.
- `"use server"` modules export only async functions; zod at every boundary; role guard then `checkRate`; one audit entry per write with the action names above; row locks where two users could race (code counter, issue, adjust, post).
- Movements are append-only (trigger); corrections are adjustments.
- Tests first for pure modules; measured counts in commit messages; never amend.

---

## 12. Open items carried into D2

FIFO lot consumption and costing; expiry dates; reports by department and month with exports; receipt
documents; a Home worklist low-stock signal; whether Purchasing wants requisitions after using the ledger.
