# Phase 19 — Stock Control D1 (the ledger core) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Purchasing a trustworthy consumables ledger: categories with automatic code series, items with a base unit, an append-only movement ledger (opening, receipt with lot, issue, adjustment) whose balance is always computed, stocktakes with a blind count and variance review, a spreadsheet import of items and opening stock, and a balances export.

**Architecture:** A new `stock` domain beside the asset register — six Prisma models, one migration with an append-only trigger and sign checks, pure rules in `src/lib/stock-*.ts`, a server module `src/server/modules/stock/`, a Stock area under `/stock` in the Purchasing workspace, and two e2e files. Balances are `SUM(quantity)` per item via one grouped query; every write that could race (code counter, issue, adjust, post) runs under a row lock.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, Auth.js v5, zod, vitest, Playwright; existing `pageOf`, `ListState`, `ImportWizard`, `EntityCombobox`, `toXlsxBuffer`, `writeAudit`, `checkRate`.

**Spec:** `docs/superpowers/specs/2026-09-09-stock-control-design.md` — the binding authority.

## Global Constraints

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`. Never the `inventory` database or port 3000. Never seed staging. Never commit `.env`; never print it.
- Playwright: foreground, `E2E_PORT=3100`, `--workers=1`, `--global-timeout`, port free before, no server left behind.
- Every paged query: `pageOf(total, page, ENTITY_PAGE_SIZE | LOG_PAGE_SIZE)`, `orderBy` ending in `id`. Balances are computed (`SUM(quantity)`), never stored.
- `"use server"` modules export only async functions; zod at every boundary; `ActionResult` union; role guard (`actionUser` + `canManageStock`) THEN `checkRate`; one `writeAudit` per write with the action names in the spec (§5); row locks (`SELECT … FOR UPDATE` / the counter `UPDATE … RETURNING`) wherever two users could race.
- `StockMovement` is append-only (trigger). Corrections are new ADJUSTMENT movements. Nothing is deleted; items and categories archive.
- Tests first for every pure module; measured counts in commit messages; never amend; commit after every task.
- Reviewer subagents: read-only — never `git stash`, `git checkout`, `git restore`, `git reset`, `git switch`; verification commands run in the foreground.

## Decisions the plan makes beyond the spec

- **P-1** Import audit actions are `import-create` / `import-update` on entityType `stock-item` (the app's importer convention).
- **P-2** Two column specs in `export-columns.ts`: `STOCK_EXPORT_COLUMNS` (the balances export) and `STOCK_IMPORT_TEMPLATE_COLUMNS` (what `make.ts` writes the import fixtures with; the import template). Fixtures are `.xlsx` via `make.ts`.
- **P-3** The stocktake count screen saves one line per action (`countStocktakeLine`) on blur or Enter; no batch endpoint.
- **P-4** The item combobox options for Receive/Issue are server-loaded once per page (`stockItemOptions()`, active items, `code · name`) and filtered client-side by `EntityCombobox` — the same shape as `spareOptions`.
- **P-5** `Pill` has only `neutral`/`accent` tones; movement kinds render as `Pill` text (Opening / Receipt / Issue / Adjustment) with `accent` for Receipt and Adjustment, `neutral` otherwise; `LOW` and `MOVED` are `accent`.

## File structure

**Create**
- `prisma/migrations/<ts>_stock_control/migration.sql` — generated DDL + trigger, two checks, one sequence.
- `src/lib/stock-code.ts`, `stock-balance.ts`, `stock-list.ts`, `stock-movement-rules.ts`, `stocktake.ts`, `stock-schema.ts`, `stock-access.ts`, `import-stock.ts` (+ `.test.ts` each).
- `src/server/modules/stock/queries.ts`, `item-actions.ts`, `movement-actions.ts`, `stocktake-actions.ts`.
- `src/server/modules/import/stock-actions.ts`.
- `src/components/stock/use-stock-runner.ts`, `stock-toolbar.tsx`, `stock-items-table.tsx`, `stock-item-form.tsx`, `adjust-dialog.tsx`, `movement-history.tsx`, `receive-form.tsx`, `issue-form.tsx`, `stocktake-count.tsx`, `stocktake-review.tsx`, `category-table.tsx`, `item-archive-controls.tsx`.
- `src/app/(app)/stock/page.tsx`, `export/route.ts`, `items/new/page.tsx`, `items/[id]/page.tsx`, `items/[id]/edit/page.tsx`, `receive/page.tsx`, `issue/page.tsx`, `stocktakes/page.tsx`, `stocktakes/new/page.tsx`, `stocktakes/[id]/page.tsx`, `categories/page.tsx`, `import/page.tsx`.
- `e2e/stock.spec.ts`, `e2e/stocktake.spec.ts`, `e2e/fixtures/stock-clean.xlsx`, `stock-mixed.xlsx`.

**Modify**
- `prisma/schema.prisma`, `prisma/seed.ts`; `src/lib/{workspaces,import-vocabulary,export-columns,import-columns}.ts` (+ tests); `src/server/palette.ts`, `src/server/modules/audit/queries.ts`, `src/server/modules/import/resolve.ts`; `src/components/shell/command-palette.tsx`; `e2e/fixtures/make.ts`; `docs/HANDOVER.md`, `docs/PICKUP.md`.

---

### Task 1: Schema, migration 20 and seed

**Files:**
- Modify: `prisma/schema.prisma` (new enums and six models; back-relations on `User` ~131, `Vendor` ~223, `Department` ~182, `Employee` ~305)
- Create: `prisma/migrations/<ts>_stock_control/migration.sql` (generated, then the hand-written tail)
- Modify: `prisma/seed.ts` (before `console.log("Seed complete.")` ~line 493; uses `depts`, `emp`, `purchasing`, `admin`, and the Phase 18 vendors array)

**Interfaces:**
- Produces Prisma models `StockCategory`, `StockItem`, `StockLot`, `StockMovement`, `Stocktake`, `StocktakeLine`; enums `StockMovementKind`, `StocktakeState`; sequence `stocktake_ref_seq`.

- [ ] **Step 1: Schema**

```prisma
enum StockMovementKind {
  OPENING
  RECEIPT
  ISSUE
  ADJUSTMENT
}

enum StocktakeState {
  OPEN
  POSTED
  CANCELLED
}

/// Phase 19 (spec §2.1). `prefix` numbers the category's items (OS-0001);
/// `nextNumber` is the series counter, advanced inside the create transaction.
model StockCategory {
  id         String      @id @default(cuid())
  name       String      @unique
  prefix     String      @unique
  nextNumber Int         @default(1)
  archivedAt DateTime?
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @default(now()) @updatedAt
  items      StockItem[]
  stocktakes Stocktake[]
}

/// Spec §2.2. The balance is NEVER a column here — it is SUM(StockMovement.quantity).
model StockItem {
  id             String          @id @default(cuid())
  code           String          @unique
  name           String
  categoryId     String
  category       StockCategory   @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  unit           String
  packSize       Int?
  reorderLevel   Int             @default(0)
  notes          String?
  archivedAt     DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @default(now()) @updatedAt
  movements      StockMovement[]
  lots           StockLot[]
  stocktakeLines StocktakeLine[]

  @@index([categoryId])
  @@index([archivedAt])
  @@index([name])
}

/// Spec §2.3 — one per receipt; D2 consumes lots oldest-first, D1 only records them.
model StockLot {
  id           String          @id @default(cuid())
  itemId       String
  item         StockItem       @relation(fields: [itemId], references: [id], onDelete: Restrict)
  supplierId   String?
  supplier     Vendor?         @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  lotDate      DateTime
  unitCost     Decimal?        @db.Decimal(12, 2)
  quantity     Int
  reference    String?
  receivedById String
  receivedBy   User            @relation("stockLotsReceived", fields: [receivedById], references: [id], onDelete: Restrict)
  createdAt    DateTime        @default(now())
  movements    StockMovement[]

  @@index([itemId])
  @@index([supplierId])
}

/// Spec §2.4 — APPEND-ONLY (trigger stock_movement_append_only). quantity is
/// SIGNED in base units; the sign check lives in the database too.
model StockMovement {
  id           String            @id @default(cuid())
  itemId       String
  item         StockItem         @relation(fields: [itemId], references: [id], onDelete: Restrict)
  kind         StockMovementKind
  quantity     Int
  lotId        String?
  lot          StockLot?         @relation(fields: [lotId], references: [id], onDelete: Restrict)
  departmentId String?
  department   Department?       @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  employeeId   String?
  employee     Employee?         @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  reason       String?
  stocktakeId  String?
  stocktake    Stocktake?        @relation(fields: [stocktakeId], references: [id], onDelete: Restrict)
  actorId      String
  actor        User              @relation("stockMovements", fields: [actorId], references: [id], onDelete: Restrict)
  occurredAt   DateTime          @default(now())
  createdAt    DateTime          @default(now())

  @@index([itemId, occurredAt, id])
  @@index([kind])
  @@index([stocktakeId])
  @@index([departmentId])
}

/// Spec §2.5.
model Stocktake {
  id         String          @id @default(cuid())
  refNo      String          @unique
  categoryId String?
  category   StockCategory?  @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  state      StocktakeState  @default(OPEN)
  openedAt   DateTime        @default(now())
  openedById String
  openedBy   User            @relation("stocktakesOpened", fields: [openedById], references: [id], onDelete: Restrict)
  postedAt   DateTime?
  postedById String?
  postedBy   User?           @relation("stocktakesPosted", fields: [postedById], references: [id], onDelete: Restrict)
  note       String?
  lines      StocktakeLine[]
  movements  StockMovement[]

  @@index([state])
  @@index([categoryId])
}

model StocktakeLine {
  id          String    @id @default(cuid())
  stocktakeId String
  stocktake   Stocktake @relation(fields: [stocktakeId], references: [id], onDelete: Cascade)
  itemId      String
  item        StockItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  bookQty     Int
  countedQty  Int?
  countedAt   DateTime?
  countedById String?
  countedBy   User?     @relation("stocktakeLinesCounted", fields: [countedById], references: [id], onDelete: Restrict)

  @@unique([stocktakeId, itemId])
}
```
Back-relations: `User` gains `stockLotsReceived StockLot[] @relation("stockLotsReceived")`, `stockMovements StockMovement[] @relation("stockMovements")`, `stocktakesOpened Stocktake[] @relation("stocktakesOpened")`, `stocktakesPosted Stocktake[] @relation("stocktakesPosted")`, `stocktakeLinesCounted StocktakeLine[] @relation("stocktakeLinesCounted")`; `Vendor` gains `stockLots StockLot[]`; `Department` and `Employee` gain `stockIssues StockMovement[]`. Run `npx prisma format`.

- [ ] **Step 2: Migration**

Run: `npx prisma migrate dev --name stock_control --create-only`. Append to the generated `migration.sql`, using the identifiers Prisma emitted in the same file:

```sql
-- Phase 19 spec §2.7. forbid_mutation() exists since 20260814084417_append_only_triggers.
CREATE TRIGGER stock_movement_append_only
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE "StockMovement" ADD CONSTRAINT stock_movement_quantity_sign CHECK (
  ("kind" IN ('OPENING', 'RECEIPT') AND "quantity" > 0)
  OR ("kind" = 'ISSUE' AND "quantity" < 0)
  OR ("kind" = 'ADJUSTMENT' AND "quantity" <> 0)
);

ALTER TABLE "StockLot" ADD CONSTRAINT stock_lot_quantity_positive CHECK ("quantity" > 0);

CREATE SEQUENCE stocktake_ref_seq START 1;
```
Run: `npx prisma migrate deploy && npx prisma generate && npx prisma migrate status` → `20 migrations found`, up to date.

- [ ] **Step 3: Seed (spec §2.8)**

Before `console.log("Seed complete.")`:

```ts
  // ── Phase 19: stock control ───────────────────────────────────────────
  const stockCats = Object.fromEntries(
    (await Promise.all([
      prisma.stockCategory.create({ data: { name: "Office supplies", prefix: "OS", nextNumber: 6 } }),
      prisma.stockCategory.create({ data: { name: "Cleaning materials", prefix: "CM", nextNumber: 4 } }),
      prisma.stockCategory.create({ data: { name: "Pantry", prefix: "PN", nextNumber: 5 } }),
    ])).map((c) => [c.prefix, c]),
  );
  const stockRows: Array<[string, string, string, string, number | null, number, number]> = [
    // code, category, name, unit, packSize, reorderLevel, openingQty
    ["OS-0001", "OS", "Bond paper A4", "ream", 5, 10, 40],
    ["OS-0002", "OS", "Ballpen black", "piece", 12, 24, 120],
    ["OS-0003", "OS", "Sticky notes 3x3", "pad", 12, 12, 36],
    ["OS-0004", "OS", "Stapler wire no. 35", "box", null, 5, 18],
    ["OS-0005", "OS", "Folder long brown", "piece", 50, 50, 200],
    ["CM-0001", "CM", "Dishwashing liquid 1L", "bottle", 12, 6, 24],
    ["CM-0002", "CM", "Trash bag XL", "roll", null, 10, 30],
    ["CM-0003", "CM", "Hand soap refill 500ml", "bottle", 12, 6, 12],
    ["PN-0001", "PN", "3-in-1 coffee sachet", "sachet", 30, 60, 90],
    ["PN-0002", "PN", "Creamer sachet", "sachet", 50, 50, 150],
    ["PN-0003", "PN", "Sugar sachet", "sachet", 100, 100, 300],
    ["PN-0004", "PN", "Bottled water 500ml", "bottle", 24, 24, 96],
  ];
  const stockItems: Record<string, { id: string }> = {};
  for (const [code, cat, name, unit, packSize, reorderLevel, opening] of stockRows) {
    const item = await prisma.stockItem.create({
      data: { code, name, unit, packSize, reorderLevel, categoryId: stockCats[cat].id },
    });
    stockItems[code] = item;
    await prisma.stockMovement.create({
      data: { itemId: item.id, kind: "OPENING", quantity: opening, actorId: purchasing.id, occurredAt: day(-30), reason: "Opening stock" },
    });
  }
  const receipt = async (code: string, qty: number, daysAgo: number, unitCost: number, reference: string) => {
    const lot = await prisma.stockLot.create({
      data: { itemId: stockItems[code].id, supplierId: vendors[2].id, lotDate: day(-daysAgo), unitCost, quantity: qty, reference, receivedById: purchasing.id },
    });
    await prisma.stockMovement.create({ data: { itemId: stockItems[code].id, kind: "RECEIPT", quantity: qty, lotId: lot.id, actorId: purchasing.id, occurredAt: day(-daysAgo) } });
  };
  await receipt("OS-0001", 20, 21, 245, "DR-1101");
  await receipt("OS-0002", 60, 21, 8.5, "DR-1101");
  await receipt("CM-0001", 12, 18, 95, "DR-1102");
  await receipt("PN-0001", 60, 14, 9.25, "DR-1103");
  await receipt("PN-0002", 100, 14, 3.1, "DR-1103");
  await receipt("PN-0004", 48, 7, 12, "DR-1104");
  const issue = async (code: string, qty: number, daysAgo: number, dept: string, empNo: string | null, reason: string) => {
    await prisma.stockMovement.create({
      data: {
        itemId: stockItems[code].id, kind: "ISSUE", quantity: -qty, actorId: purchasing.id, occurredAt: day(-daysAgo),
        departmentId: depts[dept].id, employeeId: empNo ? emp(empNo).id : null, reason,
      },
    });
  };
  await issue("OS-0001", 12, 15, "Finance", null, "Monthly paper");
  await issue("OS-0002", 24, 12, "Sales", "EMP-0042", "New hires");
  await issue("PN-0001", 110, 6, "Operations", null, "Pantry restock");   // leaves PN-0001 at 40 < 60 → LOW
  await issue("PN-0004", 50, 3, "HR", null, "Town hall");
  await issue("CM-0002", 8, 9, "Operations", null, "Weekly cleaning");
  // One POSTED stocktake on Cleaning materials, ten days ago, with two adjustments.
  const st = await prisma.stocktake.create({
    data: {
      refNo: "ST-0001", categoryId: stockCats.CM.id, state: "POSTED", openedAt: day(-10), openedById: purchasing.id,
      postedAt: day(-10), postedById: purchasing.id, note: "Monthly pantry-side count",
      lines: { create: [
        { itemId: stockItems["CM-0001"].id, bookQty: 36, countedQty: 34, countedAt: day(-10), countedById: purchasing.id },
        { itemId: stockItems["CM-0002"].id, bookQty: 22, countedQty: 22, countedAt: day(-10), countedById: purchasing.id },
        { itemId: stockItems["CM-0003"].id, bookQty: 12, countedQty: 13, countedAt: day(-10), countedById: purchasing.id },
      ] },
    },
  });
  await prisma.stockMovement.createMany({
    data: [
      { itemId: stockItems["CM-0001"].id, kind: "ADJUSTMENT", quantity: -2, reason: "Stocktake ST-0001", stocktakeId: st.id, actorId: purchasing.id, occurredAt: day(-10) },
      { itemId: stockItems["CM-0003"].id, kind: "ADJUSTMENT", quantity: 1, reason: "Stocktake ST-0001", stocktakeId: st.id, actorId: purchasing.id, occurredAt: day(-10) },
    ],
  });
  await prisma.$executeRaw`SELECT setval('stocktake_ref_seq', 1)`;
```
`vendors[2]` is "Metro Office Supply" from the Phase 18 seed (check the array order in the file and use the right index). `day(n)` is the seed's existing helper.

- [ ] **Step 4: Verify and commit**

`npm run db:seed` completes; `npx tsc --noEmit` clean; `npx vitest run` unchanged (baseline: read the count first).
```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts
git commit -m "feat(schema): Phase 19 -- stock categories, items, lots, append-only movements with sign checks, stocktakes (migration 20); seed with twelve items and a posted stocktake"
```

---

### Task 2: Pure rules, schemas, access, path rules and nav

**Files:**
- Create: `src/lib/stock-code.ts`, `stock-balance.ts`, `stock-list.ts`, `stock-movement-rules.ts`, `stocktake.ts`, `stock-schema.ts`, `stock-access.ts` — each with a `.test.ts`
- Modify: `src/lib/workspaces.ts` (PATH_RULES ~line 265; nav purchasing ~86, finance ~140) + `workspaces.test.ts`

**Interfaces (Produces):**
```ts
// stock-code.ts
export const PREFIX_SHAPE = /^[A-Z]{2,3}$/;
export const STOCK_CODE_SHAPE = /^[A-Z]{2,3}-\d{4}$/;
export function formatStockCode(prefix: string, n: number): string;            // "OS-0007"
export function parseStockCode(code: string): { prefix: string; n: number } | null;
// stock-balance.ts
export function balanceOf(movements: ReadonlyArray<{ quantity: number }>): number;
export function isLow(balance: number, reorderLevel: number): boolean;       // reorderLevel 0 → false
export function packToUnits(packs: number, packSize: number): number;
export function unitsLabel(qty: number, unit: string): string;               // "60 pieces", "1 piece", "3 kg"
// stock-list.ts
export const STOCK_LIST_CONFIG: ListConfig; // facets ["category","low","archived"], sortable ["code","name"], defaultSort code asc
export function buildStockItemWhere(state: ListState): Prisma.StockItemWhereInput;
// stock-movement-rules.ts
export function signedQuantity(kind: StockMovementKind, entered: number): number; // OPENING/RECEIPT +, ISSUE −, ADJUSTMENT as given
export function canIssue(balance: number, qty: number): { ok: true } | { ok: false; left: number };
export const MOVEMENT_KIND_LABEL: Record<StockMovementKind, string>;
// stocktake.ts
export interface StocktakeLineInput { itemId: string; bookQty: number; countedQty: number | null }
export interface StocktakePostPlan { adjustments: Array<{ itemId: string; quantity: number }>; skipped: string[]; drifted: string[] }
export function planStocktakePost(lines: StocktakeLineInput[], current: Map<string, number>): StocktakePostPlan;
export interface VarianceRow { itemId: string; bookQty: number; currentQty: number; countedQty: number | null; variance: number | null; drift: number }
export function varianceRows(lines: StocktakeLineInput[], current: Map<string, number>): VarianceRow[];
// stock-schema.ts
export const categorySchema, itemSchema, receiptSchema, issueSchema, adjustSchema, stocktakeOpenSchema, countSchema; // zod, shapes in spec §4
// stock-access.ts
export function canManageStock(role: Role): boolean; // admin | purchasing_staff
```

- [ ] **Step 1: `stock-code` — test then code**

```ts
// stock-code.test.ts
import { describe, expect, it } from "vitest";
import { formatStockCode, parseStockCode, PREFIX_SHAPE, STOCK_CODE_SHAPE } from "./stock-code";
describe("stock codes (spec §2.1)", () => {
  it("formats with four digits and parses back", () => {
    expect(formatStockCode("OS", 7)).toBe("OS-0007");
    expect(formatStockCode("PN", 12345)).toBe("PN-12345");
    expect(parseStockCode("OS-0007")).toEqual({ prefix: "OS", n: 7 });
    expect(parseStockCode("os-0007")).toBeNull();
    expect(parseStockCode("OS-7")).toBeNull();
  });
  it("prefix shape is two or three capitals", () => {
    for (const ok of ["OS", "PN", "CMX"]) expect(PREFIX_SHAPE.test(ok)).toBe(true);
    for (const bad of ["O", "OSXX", "os", "O1"]) expect(PREFIX_SHAPE.test(bad)).toBe(false);
    expect(STOCK_CODE_SHAPE.test("CM-0001")).toBe(true);
  });
});
```
```ts
// stock-code.ts
export const PREFIX_SHAPE = /^[A-Z]{2,3}$/;
export const STOCK_CODE_SHAPE = /^[A-Z]{2,3}-\d{4,}$/;
export function formatStockCode(prefix: string, n: number): string { return `${prefix}-${String(n).padStart(4, "0")}`; }
export function parseStockCode(code: string): { prefix: string; n: number } | null {
  const m = /^([A-Z]{2,3})-(\d{4,})$/.exec(code);
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}
```
(Four OR MORE digits: the 10,000th item still parses. The spec's "4 digits" is the padding, not a cap — record as a plan note.)

- [ ] **Step 2: `stock-balance` — test then code**

Tests: `balanceOf([])` → 0; `[+60, -20, +5, -3]` → 42; `isLow(40, 60)` true, `isLow(60, 60)` true, `isLow(61, 60)` false, `isLow(0, 0)` false; `packToUnits(5, 12)` → 60; `unitsLabel(60, "piece")` → "60 pieces", `unitsLabel(1, "piece")` → "1 piece", `unitsLabel(3, "kg")` → "3 kg", `unitsLabel(2, "box")` → "2 boxes", `unitsLabel(4, "pieces")` → "4 pieces".
```ts
export function balanceOf(movements: ReadonlyArray<{ quantity: number }>): number { return movements.reduce((s, m) => s + m.quantity, 0); }
export function isLow(balance: number, reorderLevel: number): boolean { return reorderLevel > 0 && balance <= reorderLevel; }
export function packToUnits(packs: number, packSize: number): number { return packs * packSize; }
const NO_PLURAL = new Set(["kg", "g", "l", "ml", "litre", "liter"]);
export function unitsLabel(qty: number, unit: string): string {
  const u = unit.trim();
  if (qty === 1 || NO_PLURAL.has(u.toLowerCase()) || /s$/i.test(u)) return `${qty} ${u}`;
  if (/(x|ch|sh)$/i.test(u)) return `${qty} ${u}es`;
  return `${qty} ${u}s`;
}
```

- [ ] **Step 3: `stock-list` — test then code**

Tests: default where `{ archivedAt: null }`; `archived=["1"]` → `{ archivedAt: { not: null } }`; `q: "ball"` → `OR` of code/name insensitive contains; `category: ["c1"]` → `categoryId: { in: ["c1"] }`; the `low` facet leaves the where untouched (it is applied after balances — assert `buildStockItemWhere({...low:["1"]})` has no `low` key).
```ts
export const STOCK_LIST_CONFIG: ListConfig = { facets: ["category", "low", "archived"], sortable: ["code", "name"], defaultSort: [{ key: "code", dir: "asc" }] };
export function buildStockItemWhere(state: ListState): Prisma.StockItemWhereInput {
  const where: Prisma.StockItemWhereInput = state.filters.archived?.includes("1") ? { archivedAt: { not: null } } : { archivedAt: null };
  if (state.q) where.OR = [{ code: { contains: state.q, mode: "insensitive" } }, { name: { contains: state.q, mode: "insensitive" } }];
  if (state.filters.category?.length) where.categoryId = { in: state.filters.category };
  // `low` is DERIVED (balance vs reorderLevel) — applied by the query after the groupBy, never here.
  return where;
}
```

- [ ] **Step 4: `stock-movement-rules` and `stocktake` — tests then code**

Tests (movement rules): `signedQuantity("RECEIPT", 5)` → 5; `("ISSUE", 5)` → −5; `("ADJUSTMENT", -3)` → −3; `canIssue(10, 10)` ok; `canIssue(10, 11)` → `{ ok: false, left: 10 }`; labels total over the four kinds.
Tests (stocktake): lines `[A book 36 counted 34, B book 22 counted 22, C book 12 counted null, D book 5 counted 9]`, current `A 36, B 20, C 12, D 5` → adjustments `[A −2, B +2, D +4]` (B adjusts against CURRENT 20, not book 22), skipped `[C]`, drifted `[B]`; `varianceRows` returns `variance = counted − current` (null when uncounted) and `drift = current − book`.
```ts
// stock-movement-rules.ts
import type { StockMovementKind } from "@prisma/client";
export function signedQuantity(kind: StockMovementKind, entered: number): number {
  if (kind === "ISSUE") return -Math.abs(entered);
  if (kind === "ADJUSTMENT") return entered;
  return Math.abs(entered);
}
export function canIssue(balance: number, qty: number): { ok: true } | { ok: false; left: number } {
  return qty <= balance ? { ok: true } : { ok: false, left: Math.max(0, balance) };
}
export const MOVEMENT_KIND_LABEL: Record<StockMovementKind, string> = { OPENING: "Opening", RECEIPT: "Receipt", ISSUE: "Issue", ADJUSTMENT: "Adjustment" };
```
```ts
// stocktake.ts
export function planStocktakePost(lines: StocktakeLineInput[], current: Map<string, number>): StocktakePostPlan {
  const adjustments: Array<{ itemId: string; quantity: number }> = [];
  const skipped: string[] = []; const drifted: string[] = [];
  for (const l of lines) {
    const now = current.get(l.itemId) ?? 0;
    if (now !== l.bookQty) drifted.push(l.itemId);
    if (l.countedQty === null) { skipped.push(l.itemId); continue; }
    const q = l.countedQty - now;
    if (q !== 0) adjustments.push({ itemId: l.itemId, quantity: q });
  }
  return { adjustments, skipped, drifted };
}
export function varianceRows(lines: StocktakeLineInput[], current: Map<string, number>): VarianceRow[] {
  return lines.map((l) => { const now = current.get(l.itemId) ?? 0; return {
    itemId: l.itemId, bookQty: l.bookQty, currentQty: now, countedQty: l.countedQty,
    variance: l.countedQty === null ? null : l.countedQty - now, drift: now - l.bookQty }; });
}
```

- [ ] **Step 5: `stock-schema` and `stock-access` — tests then code**

`stock-access`: truth table (`admin`, `purchasing_staff` true; others false).
`stock-schema` (zod; `dateStr` as in `supplier-schema.ts`; `notFuture(s)` refinement compares `s <= today's yyyy-mm-dd`):
```ts
export const categorySchema = z.object({ name: z.string().trim().min(1, "Name the category").max(60), prefix: z.string().trim().toUpperCase().regex(PREFIX_SHAPE, "Two or three letters, e.g. OS") });
export const itemSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"), name: z.string().trim().min(1, "Name the item").max(120),
  unit: z.string().trim().min(1, "Give the base unit").max(20),
  packSize: z.number().int().min(2, "A pack holds at least 2").nullable(),
  reorderLevel: z.number().int().min(0), notes: z.string().trim().max(2000).optional().default(""),
});
export const receiptSchema = z.object({
  itemId: z.string().min(1, "Pick an item"), quantity: z.number().int().min(1, "At least one"), packs: z.number().int().min(1).nullable().optional(),
  supplierId: z.string().optional().default(""), lotDate: dateStr, reference: z.string().trim().max(60).optional().default(""),
  unitCost: z.number().min(0).max(99_999_999.99).multipleOf(0.01, "Two decimals at most").nullable(), occurredAt: dateStr,
}).superRefine((d, ctx) => { if (d.occurredAt && d.occurredAt > todayStr()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["occurredAt"], message: "That date is in the future" }); });
export const issueSchema = z.object({ itemId: z.string().min(1, "Pick an item"), quantity: z.number().int().min(1, "At least one"), departmentId: z.string().min(1, "Pick the department"), employeeId: z.string().optional().default(""), reason: z.string().trim().max(200).optional().default("") });
export const adjustSchema = z.object({ itemId: z.string().min(1), mode: z.enum(["delta", "set"]), quantity: z.number().int(), reason: z.string().trim().min(3, "Say why").max(200) })
  .superRefine((d, ctx) => { if (d.mode === "delta" && d.quantity === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "A change of zero changes nothing" }); if (d.mode === "set" && d.quantity < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "A balance cannot be negative" }); });
export const stocktakeOpenSchema = z.object({ categoryId: z.string().min(1), note: z.string().trim().max(500).optional().default("") }); // "all" is the literal for every category
export const countSchema = z.object({ lineId: z.string().min(1), countedQty: z.number().int().min(0, "Counts are zero or more") });
```
Tests: receipt future date refused; `packs` allowed null; adjust delta 0 refused, set −1 refused, set 0 allowed; issue requires department; prefix lower-case is upper-cased then accepted; count −1 refused.

- [ ] **Step 6: Path rules and nav — test then code**

Tests in `workspaces.test.ts`: `/stock/items/new` allowed for `purchasing_staff`, refused for `finance_staff`/`viewer`; `/stock/stocktakes/abc/review` refused for `it_staff`; `/stock` and `/stock/items/abc` allowed for all five roles; the rules precede any generic rule.
Insert BEFORE the `/purchases` rule block (line ~265):
```ts
  // Phase 19 spec §3: stock write surfaces are Purchasing's (and the sysadmin role's).
  // MUST precede the /stock read rule — first-match-wins.
  { test: /^\/stock\/(items\/new|receive|issue|import|categories|stocktakes\/new)(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/stock\/items\/[^/]+\/(edit|adjust)(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/stock\/stocktakes\/[^/]+\/(count|review)(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/stock(\/|$)/, workspaces: ["it", "purchasing", "finance", "admin"] },
```
Nav: `WORKSPACE_NAV.purchasing` after the "Suppliers" section:
```ts
    {
      heading: "Stock",
      items: [
        { label: "Items", href: "/stock" },
        { label: "Receive stock", href: "/stock/receive", roles: ["admin", "purchasing_staff"] },
        { label: "Issue stock", href: "/stock/issue", roles: ["admin", "purchasing_staff"] },
        { label: "Stocktakes", href: "/stock/stocktakes" },
        { label: "Stock categories", href: "/stock/categories", roles: ["admin", "purchasing_staff"] },
        { label: "Import items", href: "/stock/import", roles: ["admin", "purchasing_staff"] },
      ],
    },
```
Finance "By status" section appends `{ label: "Stock", href: "/stock" }`.

- [ ] **Step 7: Verify and commit**

`npx tsc --noEmit && npx vitest run && npx eslint src/lib` — record counts.
```bash
git add src/lib
git commit -m "feat(lib): Phase 19 pure rules -- stock codes, balances and low flag, list where, movement signs and issue guard, stocktake post plan, zod schemas, access, path rules and nav (N unit / M files)"
```

---

### Task 3: Stock server module, palette, audit resolver, export route

**Files:**
- Create: `src/server/modules/stock/queries.ts`, `item-actions.ts`, `movement-actions.ts`, `stocktake-actions.ts`
- Create: `src/app/(app)/stock/export/route.ts`
- Modify: `src/lib/export-columns.ts` (add `STOCK_EXPORT_COLUMNS`), `src/server/palette.ts`, `src/server/modules/audit/queries.ts`

**Interfaces (Produces):**
```ts
// queries.ts
export interface StockItemRow { id: string; code: string; name: string; category: string; unit: string; packSize: number | null; reorderLevel: number; balance: number; low: boolean; archived: boolean; lastMovementAt: Date | null }
export async function listStockItems(state: ListState): Promise<{ rows: StockItemRow[]; total: number; page: number; pageCount: number; facets: { category: FacetOption[] }; lowCount: number }>
export interface MovementRow { id: string; kind: StockMovementKind; quantity: number; occurredAt: Date; lot: { reference: string | null; supplier: string | null } | null; department: string | null; employee: string | null; reason: string | null; stocktake: { id: string; refNo: string } | null; actor: string }
export interface StockItemDetail { id: string; code: string; name: string; category: { id: string; name: string }; unit: string; packSize: number | null; reorderLevel: number; notes: string | null; archived: boolean; hasMovements: boolean; balance: number; low: boolean; movements: { rows: MovementRow[]; page: number; pageCount: number; total: number } }
export async function getStockItem(id: string, page: number): Promise<StockItemDetail | null>
export async function stockItemOptions(): Promise<ComboOption[]>        // active items, value id, label code, sub name
export async function stockItemBalances(ids: string[]): Promise<Map<string, number>>
export async function stockUnits(): Promise<string[]>
export async function activeStockCategories(): Promise<Array<{ id: string; name: string; prefix: string }>>
export async function listStockCategories(): Promise<Array<{ id: string; name: string; prefix: string; nextNumber: number; items: number; archived: boolean }>>
export async function listStocktakes(page: number): Promise<{ rows: Array<{ id: string; refNo: string; scope: string; state: StocktakeState; openedAt: Date; postedAt: Date | null; counted: number; total: number }>; page: number; pageCount: number; total: number }>
export interface StocktakeDetail { id: string; refNo: string; scope: string; categoryId: string | null; state: StocktakeState; openedAt: Date; openedBy: string; postedAt: Date | null; postedBy: string | null; note: string | null; lines: Array<{ id: string; itemId: string; code: string; name: string; unit: string; bookQty: number; countedQty: number | null; currentQty: number }> }
export async function getStocktake(id: string): Promise<StocktakeDetail | null>
export async function stockExportRows(state: ListState): Promise<{ rows: StockExportRow[] } | { over: number }>
// item-actions.ts: createStockCategory, updateStockCategory, archiveStockCategory, restoreStockCategory, createStockItem → ok({ id, code }), updateStockItem, archiveStockItem, restoreStockItem
// movement-actions.ts: receiveStock → ok({ movementId, balance }), issueStock → ok({ balance }), adjustStock → ok({ balance })
// stocktake-actions.ts: openStocktake → ok({ id, refNo }), countStocktakeLine → ok(null), postStocktake → ok({ adjusted: number; skipped: number }), cancelStocktake → ok(null)
```

- [ ] **Step 1: queries.ts**

`listStockItems`: `where = buildStockItemWhere(state)`; if `state.filters.low?.includes("1")`: candidate ids (`select id, reorderLevel`), balances via ONE `groupBy` over those ids, keep `isLow`, `pageOf(kept.length, page, ENTITY_PAGE_SIZE)`, slice ids, fetch rows `where: { id: { in } }` and re-order by the kept order; else `count` → `pageOf` → `findMany` (`orderBy` from `state.sort` mapped to `code`/`name` then `{ id: "asc" }`) → one `groupBy` over the page ids. `lastMovementAt` via `_max: { occurredAt }` in the same groupBy. `facets.category` = `groupBy(["categoryId"])` over the where minus its own key, joined to category names. `lowCount` = over the where minus `low`: candidate ids + one groupBy + count of `isLow`.

`getStockItem`: item with category and `_count.movements`; balance via `aggregate({ where: { itemId }, _sum: { quantity: true } })`; movements page with `pageOf(count, page, LOG_PAGE_SIZE)`, `orderBy [{ occurredAt: "desc" }, { id: "desc" }]`, including `lot { reference, supplier { name } }`, `department { name }`, `employee { name }`, `stocktake { id, refNo }`, `actor { name }`.

`getStocktake`: header + lines (order by item code) and, for every line, `currentQty` from one groupBy over the line item ids (the review needs it; the count screen ignores it).

`stockExportRows`: the filtered list without paging; `count > EXPORT_CAP` → `{ over }`; rows carry `low` as "yes"/"" and `lastMovementAt`.

- [ ] **Step 2: item-actions.ts**

Categories: `createStockCategory` (P2002 on name → `validationError({ name: "A category with this name already exists" })`, on prefix → `{ prefix: "That prefix is already in use" }`; audit `stock.category.created` on `stock-category`), `updateStockCategory` (prefix change refused when `_count.items > 0` with the spec's sentence; audit `stock.category.updated`), archive/restore.

`createStockItem`:
```ts
const created = await prisma.$transaction(async (tx) => {
  const cat = await tx.stockCategory.findUnique({ where: { id: d.categoryId }, select: { prefix: true, archivedAt: true } });
  if (!cat) throw new ActionFailure(validationError({ categoryId: "Unknown category" }));
  if (cat.archivedAt) throw new ActionFailure(conflict("That category is archived — restore it first."));
  const [{ nextNumber }] = await tx.$queryRaw<[{ nextNumber: number }]>`UPDATE "StockCategory" SET "nextNumber" = "nextNumber" + 1 WHERE "id" = ${d.categoryId} RETURNING "nextNumber"`;
  const code = formatStockCode(cat.prefix, nextNumber - 1);
  const item = await tx.stockItem.create({ data: { code, name: d.name, unit: d.unit, packSize: d.packSize, reorderLevel: d.reorderLevel, notes: d.notes || null, categoryId: d.categoryId } });
  await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id, action: "stock.item.created", diff: { code: { from: null, to: code }, name: { from: null, to: d.name } } });
  return item;
});
```
(`ActionFailure` is a tiny local class wrapping an `ActionResult` so a refusal inside the transaction rolls back and is returned — the same shape `receiving.ts` achieves with its `failure` variable; either pattern is fine, but one pattern per module.) `updateStockItem` refuses a category change when the item has movements (`conflict("This code belongs to its category — the item already has movements")`), audits `stock.item.updated` with `diffOf`.

- [ ] **Step 3: movement-actions.ts**

```ts
export async function receiveStock(input: unknown): Promise<ActionResult<{ movementId: string; balance: number }>> {
  const user = await actionUser(); if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id); if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = receiptSchema.safeParse(input); if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const item = await prisma.stockItem.findUnique({ where: { id: d.itemId }, select: { id: true, code: true, unit: true, packSize: true, archivedAt: true } });
  if (!item) return conflict("That item no longer exists.");
  if (item.archivedAt) return conflict(`${item.code} is archived — restore it first.`);
  if (d.packs != null && item.packSize && d.packs * item.packSize !== d.quantity) return validationError({ quantity: `${d.packs} packs × ${item.packSize} is ${d.packs * item.packSize}, not ${d.quantity}` });
  if (d.supplierId) { const v = await prisma.vendor.findUnique({ where: { id: d.supplierId }, select: { archivedAt: true } }); if (!v || v.archivedAt) return conflict("That supplier is archived — restore it first."); }
  const occurredAt = new Date(`${d.occurredAt || todayStr()}T00:00:00Z`);
  const result = await prisma.$transaction(async (tx) => {
    const lot = await tx.stockLot.create({ data: { itemId: item.id, supplierId: d.supplierId || null, lotDate: new Date(`${d.lotDate || d.occurredAt || todayStr()}T00:00:00Z`), unitCost: d.unitCost ?? null, quantity: d.quantity, reference: d.reference || null, receivedById: user.id } });
    const mv = await tx.stockMovement.create({ data: { itemId: item.id, kind: "RECEIPT", quantity: d.quantity, lotId: lot.id, actorId: user.id, occurredAt } });
    const sum = await tx.stockMovement.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } });
    await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id, action: "stock.received",
      diff: { quantity: { from: null, to: d.quantity }, lot: { from: null, to: d.reference || d.lotDate || "lot" } } });
    return { movementId: mv.id, balance: sum._sum.quantity ?? 0 };
  });
  revalidatePath("/stock"); revalidatePath(`/stock/items/${item.id}`);
  return ok(result);
}
```
`issueStock`: same guards; inside the transaction FIRST `await tx.$queryRaw\`SELECT "id" FROM "StockItem" WHERE "id" = ${item.id} FOR UPDATE\``, then the aggregate, `canIssue(balance, d.quantity)` → on refusal return `conflict(`Only ${unitsLabel(left, item.unit)} left of ${item.code} — issue at most that many`)` (via the failure pattern), department must exist (`validationError({ departmentId: "Unknown department" })`), employee optional must exist; create `ISSUE` with `quantity: -d.quantity`, `departmentId`, `employeeId || null`, `reason || null`; audit `stock.issued` `diff: { quantity: { from: balance, to: balance - d.quantity }, department: { from: null, to: dept.name } }`.
`adjustStock`: lock, balance; `delta` → `q = d.quantity`; `set` → `q = d.quantity - balance`; `q === 0` → `ok({ balance })` without writing; create `ADJUSTMENT` with `reason`; audit `stock.adjusted` `diff: { balance: { from: balance, to: balance + q }, reason: { from: null, to: d.reason } }`.

- [ ] **Step 4: stocktake-actions.ts**

`openStocktake`: scope `categoryId === "all"` → null; refuse when `prisma.stocktake.count({ where: { state: "OPEN", OR: [{ categoryId: null }, ...(scope ? [{ categoryId: scope }] : [])] } })` > 0 — but if the new scope is `all`, ANY OPEN one blocks; message `conflict(`${open.refNo} is still open for ${open.category?.name ?? "all categories"} — post or cancel it first`)`; in a transaction: `nextval('stocktake_ref_seq')` → `ST-${pad4}`, the active items of the scope, one groupBy for balances, `createMany` lines with `bookQty`; audit `stocktake.opened` on `stocktake` with `diff: { scope: { from: null, to: name }, lines: { from: null, to: n } }`.
`countStocktakeLine`: line's stocktake must be OPEN (`conflict("This stocktake is no longer open.")`); update `countedQty/countedAt/countedById`; revalidate the stocktake page only.
`postStocktake`: OPEN check; transaction: lock every line's item (`SELECT "id" FROM "StockItem" WHERE "id" IN (...) FOR UPDATE` via `Prisma.join`), balances groupBy, `planStocktakePost`, `createMany` ADJUSTMENTs (`reason: `Stocktake ${refNo}``, `stocktakeId`), `update` state POSTED with `postedAt/postedById` using `updateMany({ where: { id, state: "OPEN" } })` and `count === 0` → `conflict("This stocktake was already posted")`; audits: `stocktake.posted` (adjusted/skipped counts) and one `stock.adjusted` per adjustment. `cancelStocktake` → CANCELLED, audit `stocktake.cancelled`.

- [ ] **Step 5: Export, palette, resolver**

`export-columns.ts`:
```ts
export const STOCK_EXPORT_COLUMNS: XlsxColumn<{ code: string; name: string; category: string; unit: string; packSize: number | null; reorderLevel: number; balance: number; low: string; lastMovementAt: Date | null }>[] = [
  { label: "Code", width: 12, cell: (r) => ({ value: r.code }) }, { label: "Name", width: 30, cell: (r) => ({ value: r.name }) },
  { label: "Category", width: 20, cell: (r) => ({ value: r.category }) }, { label: "Unit", width: 10, cell: (r) => ({ value: r.unit }) },
  { label: "Pack size", width: 10, cell: (r) => ({ value: r.packSize, type: Number }) }, { label: "Reorder level", width: 12, cell: (r) => ({ value: r.reorderLevel, type: Number }) },
  { label: "Balance", width: 10, cell: (r) => ({ value: r.balance, type: Number }) }, { label: "Low", width: 6, cell: (r) => ({ value: r.low }) },
  { label: "Last movement", width: 14, cell: (r) => ({ value: r.lastMovementAt, type: Date, format: "yyyy-mm-dd" }) },
];
```
`stock/export/route.ts`: copy the asset export route's shape (`requireUser`, `parseListState(sp, STOCK_LIST_CONFIG)`, `stockExportRows`, `capRefusal` on `over`, `toXlsxBuffer`, `contentDisposition("stock-items.xlsx")`).
`palette.ts`: group `stock` (active items, `code`/`name` contains, take 5, `{ label: code, sub: name, href: /stock/items/<id> }`), gated by `pathAllowedForRole("/stock", role)`; `command-palette.tsx` renders the group with heading "Stock" (Task 4 verifies).
`audit/queries.ts` `entityLabels`: `stock-item` → `${code} · ${name}` / `/stock/items/<id>`; `stocktake` → refNo / `/stock/stocktakes/<id>`; `stock-category` → name / `/stock/categories`.

- [ ] **Step 6: Verify and commit**

`npx tsc --noEmit && npx eslint src/server src/app && npx vitest run` — unchanged unit count.
```bash
git add src/server/modules/stock "src/app/(app)/stock/export" src/lib/export-columns.ts src/server/palette.ts src/server/modules/audit/queries.ts src/components/shell/command-palette.tsx
git commit -m "feat(stock): server module -- paged items with derived balances and low filter, item detail with history, categories and items with series codes, receive/issue/adjust under row locks, stocktakes open/count/post/cancel; export route; palette and audit resolver"
```

---

### Task 4: Stock area UI, part 1 — items list, item page, item form, adjust dialog, categories

**Files:**
- Create: `src/components/stock/use-stock-runner.ts` (a copy of `src/components/suppliers/use-supplier-runner.ts` renamed — one runner per area, per that file's own note), `stock-toolbar.tsx`, `stock-items-table.tsx`, `stock-item-form.tsx`, `adjust-dialog.tsx`, `movement-history.tsx`, `item-archive-controls.tsx`, `category-table.tsx`
- Create: `src/app/(app)/stock/page.tsx`, `items/new/page.tsx`, `items/[id]/page.tsx`, `items/[id]/edit/page.tsx`, `categories/page.tsx`
- Verify: `src/components/shell/command-palette.tsx` renders the `stock` group with heading "Stock" (Task 3 added the data; add the rendering here if it is missing)

**Interfaces:**
- Consumes Task 3's queries/actions and Task 2's `STOCK_LIST_CONFIG`, `canManageStock`, `MOVEMENT_KIND_LABEL`, `unitsLabel`, `isLow`.
- Produces the accessible-name CONTRACT the e2e files use: search `aria-label="Search stock items"`; facet dropdown "Category"; toggle links "Show low stock only" / "Show all", "Show archived" / "Show active"; buttons "New item", "Receive stock", "Issue stock", "Export", "Edit item", "Archive item", "Restore item", "Adjust", "Create item", "Save changes"; adjust dialog controls `aria-label="Adjustment mode"` (select: "Set balance to" / "Change by"), `aria-label="Quantity"`, `aria-label="Reason"`, confirm button "Post adjustment"; the item page `h1` is `<code> · <name>`; pills `LOW`, `ARCHIVED`; the stat line text `N items · M below reorder level`; history table column headers "Date", "Kind", "Quantity", "Detail", "By"; categories page inputs `aria-label="New category name"`, `aria-label="New category prefix"`, button "Create category", per-row "Rename", "Archive category", "Restore category".

- [ ] **Step 1: List page** — `requireUser`; `parseListState(sp, STOCK_LIST_CONFIG)`; `listStockItems`; header title "Stock items", breadcrumb `[{ label: "Stock items" }]`, badge READ-ONLY pill for viewer, actions for managers: `New item` (primary), `Receive stock`, `Issue stock`; a stat line `<p className="font-mono text-[11px] text-fg-muted">{total} items · {lowCount} below reorder level</p>`; `<StockToolbar state facets lowCount />` (search on Enter; Category `FacetDropdown`; low toggle link via `withFilter(state, "low", ["1"] | [])`; archived toggle; an `Export` `ButtonLink` to `/stock/export${serializeListState(state, STOCK_LIST_CONFIG)}`); `<StockItemsTable rows />` (Code link → `/stock/items/${id}`, Name, Category, Unit, Balance mono + `LOW` `Pill tone="accent"` when `low`, Reorder level, Last movement `fmtDate`); `Pagination`; `EmptyState` "No stock items yet" / "No items match" with the New/Import links for managers.

- [ ] **Step 2: Item page** — `requireUser`; `page` from `parsePage`; `getStockItem(id, page)` → `notFound()`. Header: title `${code} · ${name}`, breadcrumb Stock items → code, badge: category `Pill`, `LOW` when low, `ARCHIVED` when archived; actions (managers): `ButtonLink` Receive → `/stock/receive?item=<id>`, Issue → `/stock/issue?item=<id>`, `<AdjustDialog itemId code unit balance />` (button "Adjust"), `Edit item` → edit page, `<ItemArchiveControls id archived />`. Cards: **Balance** — `Stat`-style big number `unitsLabel(balance, unit)`; lines "Reorder level: N" ("none" when 0), "Pack size: N per pack" when set, notes; when low a `Banner tone="attention" title="Below the reorder level — N on hand, N wanted."`. **History** — `<MovementHistory rows />` table: Date (`fmtDate(occurredAt)`), Kind (`Pill` per P-5 with `MOVEMENT_KIND_LABEL`), Quantity (mono, `+60` / `−12` using a real minus sign U+2212 for display), Detail (receipt: `reference · supplier`; issue: `department · employee`; adjustment: reason and a link to `ST-000N` when `stocktake`), By; `Pagination` with `?page=`; empty text "No movements yet."

- [ ] **Step 3: Adjust dialog** — `"use client"`; `Dialog` titled `Adjust ${code}`; body: the current balance line, `Select aria-label="Adjustment mode"` (`set` "Set balance to" default / `delta` "Change by"), `Input type="number" aria-label="Quantity"`, `Textarea aria-label="Reason"`; footer "Post adjustment" → `run(() => adjustStock({ itemId, mode, quantity, reason }), "Adjustment posted", { onOk: close })` via `useStockRunner(["quantity", "reason"])`; field errors under the inputs; `RateLimitNotice` and fault banner from the runner; opening the dialog calls the runner's `reset()`.

- [ ] **Step 4: Item form and pages** — `stock-item-form.tsx` (`mode: "new" | "edit"`, `categories`, `units`, `initial`, `hasMovements`): Category `Select` (`aria-label="Category"`, disabled on edit when `hasMovements` with hint "This code belongs to its category"), Name, Unit (`Input list="stock-units"` + `<datalist>`), Pack size (number, blank = none), Reorder level (number, default 0), Notes; buttons "Create item" / "Save changes"; new → `run(() => createStockItem(...), ..., { onOk: (d) => router.push(`/stock/items/${d.id}`), refresh: false })` with toast text `Item ${d.code} created` (build the message after the result: call `toast` in `onOk` and pass an empty okMsg — or extend the runner with `okMsg: string | ((data) => string)`; do the latter, it is two lines); edit → toast "Saved" + refresh. Pages: `items/new/page.tsx` (`requireRole("admin", "purchasing_staff")`, loads `activeStockCategories()` and `stockUnits()`), `items/[id]/edit/page.tsx` (same guard; loads the item + `_count.movements`).

- [ ] **Step 5: Categories page** — `/stock/categories`: `requireRole("admin", "purchasing_staff")`; `listStockCategories()`; `<CategoryTable rows />` (client): a create row (name input, prefix input upper-casing on change, "Create category"), then Name, Prefix (mono), Next code (`formatStockCode(prefix, nextNumber)`), Items, and per row: Rename (inline input + Save), Archive/Restore; prefix edit input shown only when `items === 0`. Uses `useStockRunner(["name", "prefix"])`.

- [ ] **Step 6: Verify** — `npx tsc --noEmit && npx eslint src/components src/app`; manual walk on a FOREGROUND dev server (`npm run dev -- -p 3100`) as `purchasing@thebackroomop.com`: list → New item in a new category → code assigned → item page → Adjust set to 10 → history row → Archive → "Show archived" → Restore; as `viewer@` no buttons. Stop the server; port 3100 free.

- [ ] **Step 7: Commit**
```bash
git add src/components/stock "src/app/(app)/stock" src/components/shell/command-palette.tsx
git commit -m "feat(stock): items list with balances, low filter and export link; item page with history and adjust dialog; item form; categories page; palette group rendered"
```

---

### Task 5: Stock area UI, part 2 — receive, issue, stocktakes

**Files:**
- Create: `src/components/stock/receive-form.tsx`, `issue-form.tsx`, `stocktake-count.tsx`, `stocktake-review.tsx`
- Create: `src/app/(app)/stock/receive/page.tsx`, `issue/page.tsx`, `stocktakes/page.tsx`, `stocktakes/new/page.tsx`, `stocktakes/[id]/page.tsx`

**Interfaces:**
- Consumes Task 3 (`stockItemOptions`, `stockItemBalances`, `receiveStock`, `issueStock`, `openStocktake`, `countStocktakeLine`, `postStocktake`, `cancelStocktake`, `listStocktakes`, `getStocktake`, `activeStockCategories`), `supplierOptions` (Phase 18), departments and employees lists, Task 2's `varianceRows`, `packToUnits`, `unitsLabel`.
- Produces the CONTRACT: receive form `aria-label`s "Item", "Quantity", "Packs", "Supplier", "Lot date", "Reference", "Unit cost", "Received on"; helper text exactly `${packs} packs × ${packSize} = ${units} ${unit}` (e.g. `5 packs × 12 = 60 pieces`); button "Record receipt"; success toast `Received ${unitsLabel(q, unit)} of ${code}` and a "View item" link. Issue form: "Item", "Quantity", "Department", "Employee", "Purpose", button "Record issue", on-hand text `${unitsLabel(balance, unit)} on hand`. Stocktakes: new page `aria-label="Scope"` select (value `all` "All categories" + categories), `aria-label="Note"`, button "Open stocktake"; count screen inputs `aria-label="Counted <code>"`, button "Review variance"; review table headers "Code", "Name", "Book", "Now", "Counted", "Variance", pill `MOVED`, text "not counted", summary `N items counted · M with a difference · K not counted · J moved since opening`, buttons "Post stocktake" (confirm dialog button "Post") and "Cancel stocktake" (confirm "Cancel stocktake"); state pills via `Pill` text OPEN / POSTED / CANCELLED.

- [ ] **Step 1: Receive form and page** — page (`requireRole`): loads `stockItemOptions()`, `supplierOptions()` (Phase 18; active), reads `?item=` to preselect. Form (`"use client"`): `EntityCombobox` for Item (options carry `sub` name; the selected item's `unit`/`packSize` come from a `meta` map passed alongside: `Record<id, { unit, packSize, code }>`); Quantity number; when the item has `packSize`, a Packs number input whose change sets Quantity to `packToUnits(packs, packSize)` and shows the helper text; Supplier select (none + active); Lot date (defaults today); Reference; Unit cost (step 0.01); Received on (defaults today, `max` today). Submit → `run(() => receiveStock({...}), okMsg(data))` — on ok clear item/quantity/packs/reference/cost, keep the date and supplier, show a "View item" link to `/stock/items/${itemId}`. Field errors from the schema land under their inputs (`claimedFieldKeys` = every field name).

- [ ] **Step 2: Issue form and page** — page loads `stockItemOptions()`, departments (`prisma.department.findMany`), active employees (`employment: "ACTIVE"`, name + employeeNo), and `stockItemBalances(optionIds)` so the on-hand line renders client-side without a round trip. Form: Item combobox; on-hand text beside Quantity; Quantity; Department `Select` (required); Employee `Select` (optional, "— none —"); Purpose input. Submit → `issueStock`; conflict (over-issue) → fault `Banner` with the server sentence; ok → toast `Issued ${unitsLabel(q, unit)} of ${code} to ${departmentName}`, clear quantity/purpose, refresh the on-hand map by `router.refresh()`.

- [ ] **Step 3: Stocktakes list and new** — list page (`requireUser`): `listStocktakes(page)`; table Ref (link), Scope, State pill, Opened, Posted, Counted (`counted / total`); managers see "New stocktake". New page (`requireRole`): scope select + note → `openStocktake` → `router.push(`/stock/stocktakes/${id}`)`; a conflict (another OPEN) shows the sentence in a banner.

- [ ] **Step 4: Stocktake detail** — page (`requireUser`): `getStocktake(id)`; `?view=review` switches OPEN stocktakes from count to review (managers only can count/post/cancel; others always see the review read-only). `<StocktakeCount lines canCount />`: rows Code, Name, Unit, Counted input (`aria-label="Counted <code>"`, `type=number min=0`, saving on blur and Enter via `countStocktakeLine({ lineId, countedQty })`, a per-row saved tick); the book quantity is NOT rendered; footer: `${counted}/${total} counted` and a `ButtonLink` "Review variance" → `?view=review`. `<StocktakeReview rows summary state canPost />`: `varianceRows(lines, current)` computed server-side in the page and passed as props; table Code, Name, Book (`bookQty`), Now (`currentQty`), Counted (`countedQty ?? "not counted"`), Variance (`variance` mono, `+2`/`−2`, blank when null), `MOVED` pill when `drift !== 0`; the summary line per the contract; POSTED shows the same table read-only with a link "Back to stocktakes"; OPEN + managers: "Post stocktake" (confirm dialog: `Post ${adjustments} adjustments? ${skipped} uncounted items are left as they are.` → `postStocktake({ id })` → toast `Posted — ${adjusted} adjustments`), "Cancel stocktake" (confirm) → `cancelStocktake`; a "Back to counting" link.

- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx eslint src/components src/app`; manual walk on 3100 as `purchasing@`: receive 5 packs of OS-0002 (helper reads `5 packs × 12 = 60 pieces`), issue 20 to HR, over-issue refused, open a Pantry stocktake, count two lines, review (MOVED after an issue), post, item history shows the adjustment; stop the server; port free; `npm run db:seed`.

- [ ] **Step 6: Commit**
```bash
git add src/components/stock "src/app/(app)/stock"
git commit -m "feat(stock): receive with pack helper and lots, issue with on-hand guard, stocktakes -- open, blind count, variance review with drift flags, post and cancel"
```

---

### Task 6: Stock import

**Files:**
- Modify: `src/lib/import-vocabulary.ts` (`BLOCK_CAUSES` append after `"duplicate-supplier-name"`; `SPECS`), `src/lib/export-columns.ts` (add `STOCK_IMPORT_TEMPLATE_COLUMNS`), `src/lib/import-columns.ts` (`STOCK_KNOWN_UNIMPORTED_COLUMNS = ["Unit cost"]` — accepted but ignored, spec §6), `src/server/modules/import/resolve.ts` (`buildStockRefs`, `resolveStockRefs`)
- Create: `src/lib/import-stock.ts` (+ `.test.ts`), `src/server/modules/import/stock-actions.ts`, `src/app/(app)/stock/import/page.tsx`
- Modify: `e2e/fixtures/make.ts` → `e2e/fixtures/stock-clean.xlsx`, `stock-mixed.xlsx`

**Interfaces (Produces):**
```ts
export const STOCK_IMPORT_HEADERS; export type StockField = "code" | "name" | "category" | "unit" | "packSize" | "reorderLevel" | "openingQty" | "unitCost" | "notes";
export interface StockRefs { categoriesByKey: Map<string, { id: string; prefix: string } | null>; /* refKey(name) AND refKey(prefix) both map to the category */ itemsByCode: Map<string, string>; /* code → id */ }
export interface StockCreateData { code: string | null; categoryId: string; prefix: string; name: string; unit: string; packSize: number | null; reorderLevel: number; notes: string | null; openingQty: number }
export type StockUpdatePatch = Partial<Pick<StockCreateData, "name" | "unit" | "packSize" | "reorderLevel" | "notes">>;
export type StockRowVerdict = { kind: "create"; row: number; data: StockCreateData } | { kind: "update"; row: number; itemId: string; data: StockUpdatePatch } | ({ kind: "blocked" } & BlockedRow);
export interface StockPlan { rows: StockRowVerdict[]; counts: { create: number; update: number; blocked: number } }
export function planStockRows(headers: HeaderMatch<StockField>, cells: unknown[][], refs: StockRefs): StockPlan;
// stock-actions.ts: planStockImport(form) → { plan, groups, unknownColumns }, applyStockImport(form) → WizardApplyOutcome
```

- [ ] **Step 1: Vocabulary** — append causes `"unknown-stock-category"`, `"bad-stock-code"`, `"bad-unit"`, `"opening-on-existing"` with `SPECS`: labels "Stock category doesn't exist" (fix link `/stock/categories`), "Item code doesn't fit its category" (explain: the code must read PREFIX-0000 with the category's own prefix, or be left blank to be assigned; reupload), "Unit missing or too long" (reupload), "Opening stock on an existing item" (explain: this item already has a ledger — record a receipt or an adjustment on its page instead; fix link `/stock`). Run `import-vocabulary.test.ts` (totality) — extend its fix-kind map.

- [ ] **Step 2: Columns** — `STOCK_IMPORT_TEMPLATE_COLUMNS` (Code, Name, Category, Unit, Pack size, Reorder level, Opening quantity, Unit cost, Notes) in `export-columns.ts`; `STOCK_KNOWN_UNIMPORTED_COLUMNS: readonly string[] = ["Unit cost"]` in `import-columns.ts` with the spec's notice text exported as `STOCK_UNIT_COST_NOTICE`.

- [ ] **Step 3: Planner — tests first**
Cases: header aliases ("item code", "opening", "on hand", "per pack", "minimum"); a row without code → create with `code: null`; a row with `OS-0009` for category OS → create with that code; `PN-0009` under category OS → `bad-stock-code`; `OS-9` → `bad-stock-code`; an existing code → update with only present columns; existing code + `openingQty` 5 → `opening-on-existing`; unknown category → `unknown-stock-category`; category matched by prefix "os" as well as by name; blank unit → `bad-unit`; `packSize` "abc" → `bad-number`; two rows with the same code, or the same name+category, → both `duplicate-in-file`; `openingQty` blank → 0; counts.
- [ ] **Step 4: Planner** — two passes (duplicate keys: `refKey(code)` when present, else `refKey(category)+"|"+refKey(name)`); resolve category via `categoriesByKey.get(refKey(cell))` (null → `duplicate-in-file`? no — a null means two categories collide on the key: block `unknown-stock-category` with detail "ambiguous"); numbers via `Number(cellText)` with `Number.isInteger` checks → `bad-number`; unit 1–20 chars else `bad-unit`.
- [ ] **Step 5: Refs and actions** — `buildStockRefs(categories, items)` / `resolveStockRefs()` in `resolve.ts` (both maps; `categoriesByKey` built from name AND prefix keys with the collision rule). `stock-actions.ts` copies `supplier-actions.ts`: `actionRole("admin", "purchasing_staff")`; plan writes nothing; apply per row in a transaction: create → if `code` given, `UPDATE "StockCategory" SET "nextNumber" = GREATEST("nextNumber", ${n + 1}) WHERE id = …` then create with that code; else the Task 3 counter path (`UPDATE … RETURNING`) and `formatStockCode`; then, when `openingQty > 0`, one `OPENING` movement (`actorId` = the actor, `reason: "Opening stock (import)"`); audit `import-create` on `stock-item` with the code; update → `updateMany` guarded by `updatedAt`, audit `import-update`. Row subject `{ unique: "an item code already on file", fk: "a category that no longer exists" }`. Revalidate `/stock`, `/stock/items/[id]`.
- [ ] **Step 6: Page and fixtures** — `import/page.tsx` copies the supplier import page (`requireRole("admin", "purchasing_staff")`, title "Import stock items", the two-things banner plus "Opening quantities are recorded once, on new items only — existing items take receipts and adjustments.", `ImportWizard` with `knownUnimportedColumns={STOCK_KNOWN_UNIMPORTED_COLUMNS}` and `activityHref="/stock"`). `make.ts`: `stock-clean.xlsx` (three new items in OS/CM/PN with opening quantities, no codes), `stock-mixed.xlsx` (update `OS-0001` reorder 12; new `OS-0009` with code; `PN-0009` under OS → bad code; category "Garden" → unknown; `OS-0002` with opening 5 → opening-on-existing). Regenerate; commit only the two new sheets (restore any byte-only changes to others).
- [ ] **Step 7: Verify and commit** — `npx tsc --noEmit && npx vitest run && npx eslint src/lib src/server src/app e2e/fixtures`; manual: dev server on 3100, import `stock-mixed.xlsx` → preview 2 create · 1 update · 3 blocked, apply, `OS-0009` exists and `OS` next code moves past 9; stop the server; `npm run db:seed`.
```bash
git add src/lib/import-vocabulary.ts src/lib/import-vocabulary.test.ts src/lib/export-columns.ts src/lib/import-columns.ts src/lib/import-stock.ts src/lib/import-stock.test.ts src/server/modules/import "src/app/(app)/stock/import" e2e/fixtures
git commit -m "feat(stock): spreadsheet import -- planner with code/category/unit/opening rules and four new causes; plan/apply actions with series counters; wizard page; fixtures (N unit / M files)"
```

---

### Task 7: E2E — `e2e/stock.spec.ts`

**Files:** Create `e2e/stock.spec.ts`. Consumes the seed (Task 1), the accessible names (Tasks 4–5), fixtures (Task 6).

House rules (copy into the header): reseed in `beforeAll`; copy `login`, `waitForHydration` and `expectNoSeriousAxe` from `e2e/suppliers.spec.ts` (never import across spec files); wait on STATE (a row, a pill, the stat line, a DB fact), never on a toast an earlier step may still show; dialog buttons scoped to `page.getByRole("dialog")`; `FormField` labels carry a required asterisk — use `aria-label`s or anchored regexes; the serial describe.

- [ ] **Step 1: Eleven cases (spec §9.2)**
1. Purchasing creates category "Test supplies" prefix `TS` on `/stock/categories`; New item "Marker blue", unit piece, pack 10, reorder 5 → redirected to the item page with `h1` `TS-0001 · Marker blue`; a second item → `TS-0002`; the categories page shows Next code `TS-0003`.
2. Receive: `/stock/receive?item=<TS-0001 id>`, Packs 5 → helper text `5 packs × 10 = 50 pieces`, Quantity 50, supplier "TechServe PH", reference "DR-9001" → "Record receipt"; item page balance `50 pieces`, history row Receipt `+50` with `DR-9001 · TechServe PH`.
3. Issue 20 to HR for employee EMP-0042 with purpose "Test" → balance `30 pieces`, history row Issue `−20` with `HR · <employee name>`.
4. Over-issue 31 → banner text `Only 30 pieces left of TS-0001 — issue at most that many`; balance still 30 (DB aggregate).
5. Adjust: mode "Set balance to" 35, reason "Found a box" → history Adjustment `+5`, balance 35.
6. Low stock: edit reorder level to 40 → `LOW` pill on the item page; `/stock?low=1` lists TS-0001 and not OS-0001; the stat line reads `… below reorder level` with the seed's `PN-0001` counted too (assert the number equals the DB-derived count: compute via `db.stockMovement.groupBy` + `db.stockItem.findMany` in the test).
7. Archive item → not in `/stock` default list, present under `?archived=1`, absent from the receive combobox options (`page.getByRole("option")`/the listbox after typing "TS-0001"); restore.
8. Import `stock-mixed.xlsx` → wizard shows 2 create · 1 update · 3 blocked with the three cause labels; apply → `db.stockItem.findUnique({ where: { code: "OS-0009" } })` exists with balance 0 or its opening; `OS-0001` reorder level 12 and balance unchanged (aggregate before/after); the Unit cost notice text visible in the preview.
9. Export: `page.request.get("/stock/export")` → 200, `content-disposition` includes `stock-items.xlsx`; parse the sheet (the xlsx reader `import-export.spec.ts` uses) → header includes "Balance" and a row with `TS-0001`.
10. Roles: `viewer@` sees `/stock` and TS-0001's history, no "New item"/"Receive stock"/"Issue stock"/"Adjust"/"Edit item"; `finance@` the same; `it@` the same.
11. axe on `/stock`, the item page, `/stock/receive`, `/stock/issue`, `/stock/categories`.

- [ ] **Step 2: Run foreground** — `E2E_PORT=3100 npx playwright test e2e/stock.spec.ts --workers=1 --global-timeout=540000` until 11/11, once more for stability, `--list` total recorded, `npm run db:seed` after. Product defect → fix the product and explain; wrong locator → fix the test.
- [ ] **Step 3: Commit** — `test(e2e): stock -- code series, receipt with pack helper, issue and over-issue guard, adjust, low stock, archive, import, export, roles, axe (11 cases; --list N / M files)`.

---

### Task 8: E2E — `e2e/stocktake.spec.ts`

**Files:** Create `e2e/stocktake.spec.ts`. Same house rules.

- [ ] **Step 1: Six cases (spec §9.2)**
1. `/stock/stocktakes/new`, scope Pantry, note "Test count" → "Open stocktake" → redirected to the count screen; four `Counted PN-000N` inputs (the seed's Pantry items); the page does NOT contain the text of any book quantity (assert `getByText("90")`/book values absent — read the seed's balances via the DB and assert none appears in the count table).
2. A second Pantry stocktake → banner `ST-000N is still open for Pantry — post or cancel it first`; `db.stocktake.count({ where: { state: "OPEN" } })` is 1.
3. Count `PN-0001` = 38 and `PN-0002` = 250 (blur saves; assert the saved tick or re-read the DB line), leave `PN-0003` uncounted; then issue 2 of `PN-0001` via `/stock/issue`; back on the stocktake `?view=review`: row `PN-0001` shows Now = book − 2, `MOVED` pill, Variance = 38 − now; `PN-0003` shows "not counted"; the summary line matches `2 items counted · … · 2 not counted · 1 moved since opening` (compute the expected differences count from the DB).
4. Post → confirm dialog names the adjustment count → state pill POSTED; `db.stockMovement` has ADJUSTMENT rows for the differing items with `stocktakeId` and reason `Stocktake ST-000N`; the uncounted item has none; `PN-0001`'s item page history shows `Stocktake ST-000N` linking to the stocktake; its balance equals 38.
5. Open a Cleaning materials stocktake, cancel from the review → CANCELLED, no adjustments written.
6. axe on the count screen and the review.

- [ ] **Step 2: Run foreground** — `E2E_PORT=3100 npx playwright test e2e/stocktake.spec.ts --workers=1 --global-timeout=540000` until 6/6, once more; `--list`; reseed.
- [ ] **Step 3: Commit** — `test(e2e): stocktake -- blind count, one open per scope, drift flag after a movement, post writes adjustments against the current balance and skips uncounted, cancel, axe (6 cases; --list N / M files)`.

---

### Task 9: Battery, documentation, amendment block

**Files:** `docs/HANDOVER.md` (header line 3; §0 item 9 chunk list and correction history; a new **(l)** block after (k); §9 item D status), `docs/PICKUP.md` (Branch, Database, Battery, Last two phases, item 1, the §9 item), this plan's D-block (above "## File structure"), the spec's Status line.

- [ ] **Step 1: Battery** — `npx tsc --noEmit`; `npx eslint .`; `npx vitest run` (record); `npx prisma migrate status` (20); `npx playwright test --list | tail -1`; e2e in FIVE foreground chunks of ≤ 70 tests, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: A `it-core import-export purchases`; B `asset-classes department-owned auth-shell labels`; C `offboarding receiving paging home-finance approvals-audit`; D `admin direct-lifecycle scanner registration`; E `custody axe-sweep kitchen-sink suppliers purchasing-ext stock stocktake`. Zero failed, zero did-not-run; a failure is diagnosed (product → fix product; race → fix test), re-run, and both runs recorded. Never run vitest while a chunk runs.
- [ ] **Step 2: Documents** — HANDOVER line 3: a new LEADING parenthetical for Phase 19 in the style of the Phase 18 one (CODE-COMPLETE on `phase-19-stock-control`, UNMERGED and UNPUSHED; spec, plan, `D-1`…`D-n`; measured battery with chunk sizes and times; 20 migrations; `--list` total). HANDOVER **(l)**: what shipped per spec §2–7, why (§9 item D, first half), the battery, "What remains: the merge/push and staging redeploy are the user's decisions (not pre-authorised); D2 (FIFO costing, expiry, reports) is next; Purchasing's opening stock goes in through `/stock/import`." HANDOVER §0 item 9: the two new files in the last chunk; correction history "→ **N / 23 files** at Phase 19's close (two new files; no existing e2e file changed — or name the ones that did)". HANDOVER §9: item D → "first half shipped in Phase 19 (see (l)); D2 not yet planned". PICKUP: Branch (level with origin; `phase-19-stock-control` local, UNMERGED, worktree present), Database (20 on the branch; main/staging at 19), Battery row, Last two phases (19 then 18), item 1 (Phase 19 code-complete; what remains), the §9 item (only D2 remains). Plan D-block: one entry per ledger ruling and per P-1…P-5, each what/why/cost/lesson; spec Status → implemented on the branch, see the D-block.
- [ ] **Step 3: Commit** — `docs(handover,pickup,plan): Phase 19 code-complete -- battery N e2e / 23 files, M unit, 20 migrations; (l) block; D-1..D-n`.

---

## Self-review (writing-plans checklist, run 2026-09-09)

1. **Spec coverage.** §2 → Task 1; §3 → Task 2 step 6; §4 → Task 2; §5.1–5.3 → Task 3; §5.4 → Task 3 step 5; §6 → Task 6; §7.1–7.3, 7.6 → Task 4; §7.4–7.5 → Task 5; §7.7 → Task 3 (data) + Task 4 (rendering); §8 → refusal copy spelled in Tasks 3 and 6; §9.1 → Tasks 2 and 6; §9.2 → Tasks 7–8; §9.3 → Task 9. Gap closed: `STOCK_CODE_SHAPE` allows four OR MORE digits so the series never caps (plan note in Task 2 step 1); the spec says "4 digits" meaning the padding — record as a D-entry at close.
2. **Placeholders.** None. UI steps state structure, the exact copy and the accessible-name contract rather than full JSX, since the components mirror named files (`suppliers-toolbar.tsx`, `supplier-form.tsx`, `archive-controls.tsx`, `documents-panel.tsx`).
3. **Type consistency.** `StockItemRow`/`StockItemDetail`/`MovementRow`/`StocktakeDetail` (Task 3) match what Tasks 4–5 render; `planStocktakePost`/`varianceRows` (Task 2) match `postStocktake` and the review (Tasks 3, 5); `StockRefs`/`planStockRows` (Task 6) match `resolveStockRefs`; `receiptSchema.packs` optional-nullable matches the form; `openStocktake` takes `"all"` as the literal scope everywhere.
