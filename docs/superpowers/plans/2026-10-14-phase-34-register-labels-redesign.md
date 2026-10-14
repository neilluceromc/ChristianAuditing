# Phase 34 — Register and Labels Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the IT/Purchasing register form and the label page with two tabs under **New equipment**:

- **Register**: one screen holding category cards, a model combobox that sets the type, quantity, a required IT serial, where the equipment goes with a live label, and purchase and warranty details with documents and a live total.
- **Labels**: a waiting-to-print queue, a clickable sheet, a start sticker, and Print, which marks the labels printed.

The phase also reshapes the IT categories and adds migration 27.

**Architecture:**

- **Pure rules** are added in `src/lib/*` and unit-tested: category catalogue, known models, purchase summary, serial rules, and label-queue grouping.
- **Server work extends the two existing register actions:** `createAsset` (quantity 1) and `registerAssets` (a batch). Both gain:
  - a `PurchaseRecord`, which is both the registration batch and the purchase record;
  - the new asset fields;
  - the IT serial rule.

  A new `markLabelsPrinted` action and two server queries feed the pages.
- **The Register form** is rebuilt from focused client components.
- **The Labels page** stays a Server Component built on GET forms. Only Print is a client island.
- **The label cell** is extracted from `label-sheet.tsx` into one component. The sheet and the live preview both render it.

**Tech Stack:** Next.js 15 App Router (RSC + client islands), Prisma 6 / Postgres 16, zod, vitest (pure, node env), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-14-register-and-labels-redesign-design.md` (committed `908fe14`). Read it first; this plan argues from it.

## Global Constraints

**Where the work happens**
- Do all work in the worktree `.claude/worktrees/phase-34-register-labels`, on branch `phase-34-register-labels`.
- The worktree's `.env` points at `inventory_dev` with `APP_BASE_URL=http://192.168.1.193:3100` and no `SEED_PASSWORD`.
- Never touch the `inventory` database or port 3000. Never read or print `.env`.
- Run the dev server only as `npm run dev -- -p 3100`.

**Running Playwright**
- Foreground only: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`.
- Use a Bash timeout of 600000 and never `run_in_background`.
- Check port 3100 is free before and after each run (`netstat -ano | findstr :3100 | findstr LISTENING`).
- One Playwright process at a time.

**Git**
- Never amend. Never `git stash`, `checkout`, `restore`, `reset` or `switch`.
- `git add` new files before a pathspec commit.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Repo files are CRLF. Never `sed -i` a CRLF file: use the Edit tool, or a Python byte-level rewrite that keeps CRLF. New files are written CRLF too, matching the repo.

**Database and seed**
- After `npm ci`, run `npx prisma generate`.
- Never reset a database: apply migrations with `npx prisma migrate deploy` against `inventory_dev`.
- `AuditEntry` is append-only. Tests never delete audit rows.
- `npm run db:seed` truncates every table. It runs on `inventory_dev` only, and runs last after any e2e work.

**Code conventions**
- Product `aria-label`s near a field never contain that field's label word.
- Copy is sentence case. No "please" and no "successfully".
- Every server action keeps the guard order role → rate (`checkRate(user.id)`) → zod.
- Server actions return the house `ActionResult` (`ok`, `forbidden`, `rateLimited`, `validationError`, `conflict` from `@/server/action-result`).
- Every domain write in a transaction writes its audit row through `writeAudit(tx, …)` (`@/server/audit`).

**Spec facts**
- The IT category list and order: Laptop, Workstation (PC), Monitor, Headset, Mouse, Type C Hub, Docking Station, Laptop Bag, Other.
- "In stock" means status `SPARE` (IT) or `STORED` (Purchasing).
- The serial is required for IT only. Purchasing stays optional.
- Money is entered as `68,500` / `68500` / `68500.00`, stored as `Decimal(12,2)`, and shown with `en-PH` formatting and `₱`. The total is never stored.
- Warranty lengths are 0, 6, 12, 24 and 36 months. The default is 12 once a purchase date is entered.
- `warrantyCoveredBy` ∈ `manufacturer` | `vendor` | `both`.
- The sheet stays A4 3 × 4 (`src/lib/label-geometry.ts`). Today's `Barcode` / `Qr` fit rules and the 100 mm calibration bar are unchanged.

## Review Focus

These are the inputs most likely to bite a real user that no task's tests exercise by default. Each has a test added in the task named.

1. **Model typed with different case or spaces from an existing one** (e.g. `thinkpad t14 gen 4 `). It must match the known model and take its type, not offer "Add as new". Test owner: Task 2, `resolveModelType`.
2. **A scanner that sends the serial followed by Enter** in the one-unit serial box. It must not submit the form or register a half-filled asset. Test owner: Task 9, e2e case 3.
3. **A batch serial pasted with Windows line endings or a trailing blank line.** It must fill exactly N rows with no empty "required" row caused by the trailing newline. Test owner: Task 2, `serialProblems` plus the existing `parseSerialPaste`.
4. **Purchase date set, then warranty length changed, then purchase date changed again.** "Warranty until" must follow the length from the new date unless the user typed a date by hand. Test owner: Task 2, `warrantyUntilFrom`, plus the Task 6 rule "manual date wins".
5. **Print pressed on the Labels tab, then the print dialog cancelled.** Today's labels must still be marked printed only when printing was attempted, and a reprint must never move `labelPrintedAt`. Test owner: Task 4 `markLabelsPrinted` (idempotent); Task 9 case 10.

## Decisions taken in this plan (the P-block)

- **P-1:** The spec's "register action" is the two existing actions. `createAsset` handles quantity 1, `registerAssets` handles a batch. Both create the `PurchaseRecord` in their own transaction and return its id. There is no new third action.
- **P-2:** Documents keep today's upload-after-create flow (`uploadDocument` / `uploadBatchDocument`, FormData). They gain the kinds `official-receipt`, `warranty-slip` and `delivery-receipt`; `invoice` and `other` already exist. A failed upload keeps today's behaviour: the asset's Documents tab with `?failed=`.
- **P-3:** Known models are read by the Register **page** for every registrable category and passed as a prop. There is no extra action round-trip.
- **P-4:** The "Where does it go" choice reuses `SegmentedControl` (radiogroup semantics). That satisfies spec §9's "pressed" requirement with a better role. Category cards and warranty lengths are buttons with `aria-pressed`.
- **P-5:** Register always lands on `/inventory/labels?just=<purchaseRecordId>`, plus `&cls=PURCHASING` for Purchasing. This applies to a single unit too; it replaces `/inventory/{id}?created=1` and the in-place `RegisterSuccess`. "Register and add another" keeps today's `startAnother` and the toast. `register-success.tsx` is deleted.
- **P-6:** The Labels queue's selection travels as `?pick=<recordId>` (repeatable) through a GET form with a "Make sheet" button. `?just=` pre-ticks one record. The existing `?ids=`, `?tags=` and `?start=` keep working, and the sheet is the union in this order: picked records, then `ids`, then `tags`.
- **P-7:** The on-screen sheet **is** the printable `LabelSheet`, scaled on screen only. Slot links and "used" hatching are screen-only; print output is unchanged. This keeps one source of truth for the e2e `getByLabel("Barcode …")` pins.
- **P-8:** The `purchase.recorded` audit row uses `entityType: "purchase-record"`.
  - `entityLabels` labels it with the tag range.
  - `invisibleAuditRefs` hides it from roles that cannot see its class, through a new `purchaseRecordIds` list on `HiddenAuditRefs`.
- **P-9:** Page title: both tabs use `PageHeader title="New equipment"`. The nav link keeps its name "Register assets". The breadcrumb is `Inventory` (or `Purchasing assets`) › `Register` or `Labels`.

---

## File structure

**Create**
- `prisma/migrations/20261014090000_register_labels/migration.sql`: DDL plus the name-keyed data moves and backfill.
- `src/lib/register-catalog.ts`: category order, icon, noun, and stock status.
- `src/lib/known-models.ts`: merging, matching and resolving models.
- `src/lib/purchase-summary.ts`: money, total, warranty date, covered-by values.
- `src/lib/serial-rules.ts`: serial required and per-row problems.
- `src/lib/label-queue.ts`: queue grouping and "when" wording.
- `src/lib/*.test.ts`: one test file for each of the above.
- `src/server/modules/inventory/register-queries.ts`: `registerCatalog(classes)`, returning categories with stock, `tagPrefix`, and known models.
- `src/server/modules/inventory/label-queue.ts`: `labelQueue(classes)` and `queueCount(classes)` (server only, not "use server").
- `src/server/modules/inventory/label-actions.ts` ("use server"): `markLabelsPrinted`.
- `src/components/inventory/new-equipment-tabs.tsx`
- `src/components/inventory/category-cards.tsx`
- `src/components/inventory/model-combobox.tsx`
- `src/components/inventory/serial-section.tsx`
- `src/components/inventory/purchase-section.tsx`
- `src/components/inventory/document-slots.tsx`
- `src/components/inventory/label-cell.tsx`: the single label used by the sheet and the preview.
- `src/components/inventory/label-queue-form.tsx`: a server component holding the GET form.
- `src/components/inventory/print-labels-button.tsx` (client).
- `e2e/register-labels.spec.ts`

**Modify**
- `prisma/schema.prisma` and `prisma/seed.ts`
- `src/lib/documents.ts`: new kinds.
- `src/components/ui/icon.tsx`: new icon names.
- `src/server/modules/inventory/actions.ts` (`createAsset`) and `src/server/modules/purchases/receiving.ts` (`registerAssets`).
- `src/server/modules/audit/queries.ts`: `entityLabels`, `invisibleAuditRefs`.
- `src/lib/audit-list.ts` (or wherever `HiddenAuditRefs` / `NO_HIDDEN_REFS` and `buildAuditWhere` live): the `purchaseRecordIds` list.
- `src/lib/activity.ts`: the `purchase.recorded` sentence.
- `src/app/(app)/inventory/register/page.tsx`
- `src/components/inventory/register-form.tsx` (rewritten)
- `src/components/inventory/register-initial-state.tsx`: kept, its labels changed.
- `src/components/inventory/label-sheet.tsx`: uses `LabelCell`; screen-only slot links.
- `src/app/(app)/inventory/labels/page.tsx`
- `src/components/inventory/tags-box.tsx`: the "Reprint other tags" heading.
- `src/app/globals.css`: screen-only sheet scale and the used-slot hatch.
- The e2e specs listed in Tasks 10 and 11, and `e2e/fixtures/make.ts`.

**Delete**
- `src/components/inventory/register-success.tsx`, and its use in `register-form.tsx`.

---

### Task 1: Schema, migration 27 and seed

**Files:**
- Modify: `prisma/schema.prisma`, `prisma/seed.ts`
- Create: `prisma/migrations/20261014090000_register_labels/migration.sql`

**Interfaces:**
- Produces:
  - `AssetCategory.tagPrefix: string | null`
  - `Asset.receiptRef / warrantyCoveredBy / warrantyContact: string | null`
  - `Asset.labelPrintedAt: Date | null`
  - `Asset.purchaseRecordId: string | null`
  - the model `PurchaseRecord`, with the fields below.

  The seed creates the §2.1 IT categories with these exact names and types.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In `model AssetCategory`, add after `cls`:

```prisma
  /// Phase 34 (spec §7.1): used when the category has no tags yet; tags that exist win (preferredPrefix).
  tagPrefix String?
```

In `model Asset`, add after `invoiceRef`:

```prisma
  /// Phase 34 (spec §4.5): official receipt (OR) number, beside invoiceRef.
  receiptRef           String?
  /// "manufacturer" | "vendor" | "both" — validated by zod, not an enum (spec §7.1).
  warrantyCoveredBy    String?
  warrantyContact      String?
  /// Phase 34 (spec §5): set when its label was printed from the Labels tab; NULL = waiting.
  labelPrintedAt       DateTime?
  purchaseRecordId     String?
  purchaseRecord       PurchaseRecord?  @relation(fields: [purchaseRecordId], references: [id], onDelete: Restrict)
```

Add `@@index([purchaseRecordId])` and `@@index([labelPrintedAt])` to `Asset`'s index list.

Add the new model after `AssetDocument`:

```prisma
/// Phase 34 (spec §7.2): one per Register submit — the registration batch the Labels queue groups
/// by, and the purchase (fees live here; the total is computed, never stored).
model PurchaseRecord {
  id          String     @id @default(cuid())
  cls         AssetClass
  vendorId    String?
  vendor      Vendor?    @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  purchasedAt DateTime?
  invoiceRef  String?
  receiptRef  String?
  unitCost    Decimal?   @db.Decimal(12, 2)
  fees        Decimal?   @db.Decimal(12, 2)
  quantity    Int
  createdById String
  createdBy   User       @relation("purchaseRecordsCreated", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt   DateTime   @default(now())
  assets      Asset[]

  @@index([createdAt])
  @@index([cls, createdAt])
}
```

Add the back-relations:
- `purchaseRecords PurchaseRecord[]` on `Vendor`;
- `purchaseRecordsCreated PurchaseRecord[] @relation("purchaseRecordsCreated")` on `User`.

- [ ] **Step 2: Generate the DDL, then hand-append the data section**

Run (worktree, `inventory_dev`):
`npx prisma migrate dev --create-only --name register_labels`

Expected: a new folder `prisma/migrations/<timestamp>_register_labels/`. Rename it to `20261014090000_register_labels` with `git mv`, or create it under that name. Keep the generated `ALTER TABLE` / `CREATE TABLE` / FK / index statements, then append this block verbatim:

```sql
-- Phase 34 (spec §2, §7): backfill + IT category reshape. Idempotent and name-keyed: a step whose
-- source row is missing does nothing. Category-level moves only change categoryId/typeId; tags,
-- holders, statuses, loan dates and history are untouched. No AuditEntry (reference-data move).

UPDATE "Asset" SET "labelPrintedAt" = "createdAt" WHERE "labelPrintedAt" IS NULL;

DO $$
DECLARE
  c_other TEXT; c_mouse TEXT; c_phone TEXT; c_periph TEXT;
  t_phone TEXT; t_keyboard TEXT; t_wired TEXT;
BEGIN
  -- 1. Dock -> Docking Station
  UPDATE "AssetCategory" SET "name" = 'Docking Station'
   WHERE "name" = 'Dock' AND NOT EXISTS (SELECT 1 FROM "AssetCategory" WHERE lower("name") = 'docking station');

  -- 2. New categories (deterministic ids so a re-run finds them)
  INSERT INTO "AssetCategory" ("id","name","locked","cls","tagPrefix")
  SELECT v.id, v.name, false, 'IT', v.prefix
    FROM (VALUES ('p34cat_ws','Workstation (PC)','WS'), ('p34cat_mouse','Mouse','MS'),
                 ('p34cat_hub','Type C Hub','HB'), ('p34cat_bag','Laptop Bag','BG'), ('p34cat_other','Other','OT')) AS v(id,name,prefix)
   WHERE NOT EXISTS (SELECT 1 FROM "AssetCategory" c WHERE lower(c."name") = lower(v.name));

  -- 3. tagPrefix for the categories that keep their tags (only where unset)
  UPDATE "AssetCategory" SET "tagPrefix" = v.prefix
    FROM (VALUES ('Laptop','LT'), ('Monitor','MN'), ('Headset','HS'), ('Docking Station','DK')) AS v(name,prefix)
   WHERE "AssetCategory"."name" = v.name AND "AssetCategory"."tagPrefix" IS NULL;

  SELECT "id" INTO c_other  FROM "AssetCategory" WHERE "name" = 'Other';
  SELECT "id" INTO c_mouse  FROM "AssetCategory" WHERE "name" = 'Mouse';
  SELECT "id" INTO c_phone  FROM "AssetCategory" WHERE "name" = 'Phone';
  SELECT "id" INTO c_periph FROM "AssetCategory" WHERE "name" = 'Peripheral';

  -- 4. Types for the new categories (never duplicating a name inside a category)
  INSERT INTO "AssetType" ("id","name","categoryId","locked")
  SELECT 'p34type_' || md5(cat.name || '/' || v.name), v.name, cat.id, false
    FROM (VALUES ('Workstation (PC)','Desktop tower'), ('Workstation (PC)','Mini PC'), ('Workstation (PC)','All-in-one'),
                 ('Mouse','Wireless'), ('Type C Hub','USB-C Hub'), ('Laptop Bag','Backpack'), ('Laptop Bag','Sleeve'),
                 ('Other','Phone'), ('Other','Keyboard'), ('Other','Webcam'), ('Other','Speaker'), ('Other','Printer')) AS v(cat,name)
    JOIN "AssetCategory" cat ON cat."name" = v.cat
   WHERE NOT EXISTS (SELECT 1 FROM "AssetType" t WHERE t."categoryId" = cat.id AND lower(t."name") = lower(v.name));

  SELECT "id" INTO t_phone    FROM "AssetType" WHERE "categoryId" = c_other AND "name" = 'Phone';
  SELECT "id" INTO t_keyboard FROM "AssetType" WHERE "categoryId" = c_other AND "name" = 'Keyboard';

  -- 5. Peripheral's Mouse type becomes Mouse/Wired, assets and all
  IF c_periph IS NOT NULL AND c_mouse IS NOT NULL THEN
    UPDATE "AssetType" SET "categoryId" = c_mouse, "name" = 'Wired'
     WHERE "categoryId" = c_periph AND "name" = 'Mouse'
       AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_mouse AND "name" = 'Wired');
    UPDATE "Asset" SET "categoryId" = c_mouse
     WHERE "typeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_mouse);
  END IF;
  IF c_mouse IS NOT NULL THEN
    INSERT INTO "AssetType" ("id","name","categoryId","locked")
    SELECT 'p34type_mouse_wired', 'Wired', c_mouse, false
     WHERE NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = c_mouse AND "name" = 'Wired');
  END IF;

  -- 6. Phone -> Other/Phone; Peripheral (the rest) -> Other/Keyboard
  IF c_phone IS NOT NULL THEN
    UPDATE "Asset" SET "categoryId" = c_other, "typeId" = t_phone WHERE "categoryId" = c_phone;
    UPDATE "PolicySlot" SET "assetTypeId" = t_phone
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_phone);
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_phone
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_phone);
  END IF;
  IF c_periph IS NOT NULL THEN
    UPDATE "Asset" SET "categoryId" = c_other, "typeId" = t_keyboard WHERE "categoryId" = c_periph;
    UPDATE "PolicySlot" SET "assetTypeId" = t_keyboard
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_periph);
    UPDATE "EmployeeSlotException" SET "assetTypeId" = t_keyboard
     WHERE "assetTypeId" IN (SELECT "id" FROM "AssetType" WHERE "categoryId" = c_periph);
  END IF;

  -- 7. Merge duplicate slots a policy now holds on one type (iPhone + Android -> one Phone slot):
  --    keep the oldest id, OR the flags, move waivers to it, drop the rest.
  WITH dup AS (
    SELECT "policyId", "assetTypeId", min("id") AS keep, bool_or("required") AS req, bool_or("loaner") AS loan
      FROM "PolicySlot" WHERE "assetTypeId" IN (t_phone, t_keyboard)
     GROUP BY "policyId", "assetTypeId" HAVING count(*) > 1
  )
  UPDATE "PolicySlot" s SET "required" = d.req, "loaner" = d.loan FROM dup d WHERE s."id" = d.keep;
  UPDATE "EmployeeSlotException" e SET "slotId" = k.keep
    FROM (SELECT s."id" AS sid, min(s2."id") AS keep
            FROM "PolicySlot" s JOIN "PolicySlot" s2 ON s2."policyId" = s."policyId" AND s2."assetTypeId" = s."assetTypeId"
           WHERE s."assetTypeId" IN (t_phone, t_keyboard) GROUP BY s."id") k
   WHERE e."slotId" = k.sid AND k.sid <> k.keep;
  DELETE FROM "PolicySlot" s
   USING (SELECT "policyId", "assetTypeId", min("id") AS keep FROM "PolicySlot"
           WHERE "assetTypeId" IN (t_phone, t_keyboard) GROUP BY "policyId", "assetTypeId") d
   WHERE s."policyId" = d."policyId" AND s."assetTypeId" = d."assetTypeId" AND s."id" <> d.keep;
  --    Same-employee duplicate exceptions on one type and slot: keep the oldest.
  DELETE FROM "EmployeeSlotException" e
   USING "EmployeeSlotException" e2
   WHERE e."assetTypeId" IN (t_phone, t_keyboard)
     AND e."employeeId" = e2."employeeId" AND e."kind" = e2."kind" AND e."assetTypeId" = e2."assetTypeId"
     AND e."slotId" IS NOT DISTINCT FROM e2."slotId"
     AND (e."createdAt", e."id") > (e2."createdAt", e2."id");

  -- 8. Drop the emptied categories (never one that still has an asset)
  DELETE FROM "AssetType" WHERE "categoryId" IN (c_phone, c_periph)
     AND NOT EXISTS (SELECT 1 FROM "Asset" a WHERE a."typeId" = "AssetType"."id");
  DELETE FROM "AssetCategory" c WHERE c."id" IN (c_phone, c_periph)
     AND NOT EXISTS (SELECT 1 FROM "Asset" a WHERE a."categoryId" = c."id")
     AND NOT EXISTS (SELECT 1 FROM "AssetType" t WHERE t."categoryId" = c."id");
END $$;
```

- [ ] **Step 3: Apply it to `inventory_dev` and check the moves**

`inventory_dev` currently holds the old seed: Phone, Peripheral, Dock and the Finance standard policy.

Run: `npx prisma migrate deploy`
Expected: `1 migration found … applied`, 27 migrations in total.

Write a throwaway `check-34.ts` in the SDD workspace (not committed). Using `PrismaClient`, it asserts:
- categories named `Phone`, `Peripheral` and `Dock` → count 0;
- the `Docking Station` assets include `BR-DK-0071`;
- `BR-PH-0287` / `BR-PH-0301` / `BR-PH-0312` sit in `Other` with type `Phone`;
- `BR-KB-0402` sits in `Other / Keyboard`;
- the Finance standard policy has exactly one slot whose type is `Other / Phone`;
- every asset has `labelPrintedAt` not null.

Run it with `npx tsx <path>/check-34.ts`. Expected: all assertions pass.

- [ ] **Step 4: Update `prisma/seed.ts`**

- Add `"PurchaseRecord"` to the TRUNCATE list (lines 45-52), before `"Asset"`.
- Replace `catData` (lines 80-91) with:

```ts
  const catData: Record<string, { cls: AssetClass; types: string[]; prefix?: string }> = {
    Laptop: { cls: "IT", types: ["Dell Latitude", "ThinkPad"], prefix: "LT" },
    "Workstation (PC)": { cls: "IT", types: ["Desktop tower", "Mini PC", "All-in-one"], prefix: "WS" },
    Monitor: { cls: "IT", types: ["24-inch", "27-inch"], prefix: "MN" },
    Headset: { cls: "IT", types: ["Wired", "Wireless"], prefix: "HS" },
    Mouse: { cls: "IT", types: ["Wired", "Wireless"], prefix: "MS" },
    "Type C Hub": { cls: "IT", types: ["USB-C Hub"], prefix: "HB" },
    "Docking Station": { cls: "IT", types: ["USB-C Dock"], prefix: "DK" },
    "Laptop Bag": { cls: "IT", types: ["Backpack", "Sleeve"], prefix: "BG" },
    Other: { cls: "IT", types: ["Phone", "Keyboard", "Webcam", "Speaker", "Printer"], prefix: "OT" },
    Vehicle: { cls: "PURCHASING", types: ["Sedan", "Van"] },
    Furniture: { cls: "PURCHASING", types: ["Desk", "Chair"] },
    "Pantry Equipment": { cls: "PURCHASING", types: ["Microwave", "Air purifier"] },
    Building: { cls: "PURCHASING", types: ["Floor", "Warehouse"] },
  };
```

- In the creation loop, pass `tagPrefix: prefix ?? null` to `assetCategory.create`.
- The phone rows (`BR-PH-0312`, `BR-PH-0287`, `BR-PH-0301`) change `"Phone"` → `"Other"`. `mk` uses `typeIds[0]`, which is now `Phone`, so it keeps working.
- The two dock rows change `"Dock"` → `"Docking Station"`.
- `BR-KB-0402` changes `"Peripheral"` → `"Other"` with `{ typeId: cats["Other"].typeIds[1] }` (Keyboard).
- Finance standard slots:
  - `dock` → `cats["Docking Station"].typeIds[0]`;
  - `phone` → `cats["Other"].typeIds[0]`.
- Every seeded asset gets `labelPrintedAt: day(-700)`: add it to `mk`'s defaults, so the queue starts empty as on a migrated database.

- [ ] **Step 5: Re-seed and type-check**

Run: `npx prisma generate && npm run db:seed && npx tsc --noEmit`
Expected: the seed completes and `tsc` reports no errors. Code does not use the new fields yet, so nothing breaks.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts prisma/migrations/20261014090000_register_labels/migration.sql
git commit -m "feat(db): migration 27 -- PurchaseRecord, asset purchase/warranty/label fields, category tagPrefix; IT categories reshaped (Docking Station, Workstation (PC), Mouse, Type C Hub, Laptop Bag, Other; Phone and Peripheral folded into Other with their policy slots)"
```

---

### Task 2: Pure rules (catalogue, known models, purchase summary, serials, queue)

**Files:**
- Create: `src/lib/register-catalog.ts`, `src/lib/known-models.ts`, `src/lib/purchase-summary.ts`, `src/lib/serial-rules.ts`, `src/lib/label-queue.ts`, and one `*.test.ts` for each.
- Modify: `src/lib/documents.ts`

**Interfaces — Produces (exact):**

```ts
// register-catalog.ts
import type { AssetClass, AssetStatus } from "@prisma/client";
export type CategoryIconName = "laptop" | "workstation" | "monitor" | "headset" | "mouse" | "hub" | "dock" | "bag" | "other" | "inventory";
export const IT_CATEGORY_ORDER: readonly string[];               // the spec's 9 names, in order
export function orderCategories<T extends { name: string; cls: AssetClass }>(cats: T[]): T[]; // IT by order then unknown by name; Purchasing by name; drops "Uncategorised"
export function categoryIcon(name: string): CategoryIconName;
export function categoryNoun(name: string, n: number): string; // "laptop"/"laptops", "mouse"/"mice", …
export const STOCK_STATUS: Record<AssetClass, AssetStatus>;    // { IT: "SPARE", PURCHASING: "STORED" }

// known-models.ts
export interface KnownModel { model: string; typeId: string | null; inStock: number }
export function mergeKnownModels(rows: Array<{ model: string; typeId: string | null; createdAt: Date; inStock: boolean }>): KnownModel[];
export function matchModels(list: KnownModel[], query: string, limit?: number): KnownModel[];
export function resolveModelType(list: KnownModel[], model: string): { known: true; typeId: string | null } | { known: false };

// purchase-summary.ts
export function moneyToCentavos(text: string): number | null | "bad"; // "" -> null
export function purchaseTotal(unitCentavos: number | null, qty: number, feeCentavos: number | null): number; // centavos
export function formatPeso(centavos: number): string;               // "₱206,000.00"
export function centavosToDecimalString(c: number): string;         // 6850000 -> "68500.00"
export const WARRANTY_LENGTHS: readonly [0, 6, 12, 24, 36];
export function warrantyUntilFrom(purchasedISO: string, months: number): string; // "" when either missing/0
export const WARRANTY_COVERED_BY: readonly ["manufacturer", "vendor", "both"];
export const WARRANTY_COVERED_BY_LABEL: Record<(typeof WARRANTY_COVERED_BY)[number], string>;

// serial-rules.ts
import type { AssetClass } from "@prisma/client";
export function serialRequired(cls: AssetClass): boolean;
export type SerialProblem = "required" | "duplicate" | null;
export function serialProblems(serials: readonly string[], cls: AssetClass): SerialProblem[];

// label-queue.ts
export interface QueueAsset { id: string; tag: string; model: string; purchaseRecordId: string | null; createdAt: Date }
export interface QueueGroup { key: string; recordId: string | null; title: string; range: string; tags: string[]; assetIds: string[]; createdAt: Date }
export function groupLabelQueue(rows: QueueAsset[]): QueueGroup[];   // newest first
export function whenLabel(at: Date, now: Date): string;              // "Just now" | "Today" | "Yesterday" | fmtDate
```

- [ ] **Step 1: Write the failing tests**

`src/lib/known-models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchModels, mergeKnownModels, resolveModelType } from "./known-models";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("mergeKnownModels", () => {
  it("one row per model ignoring case and spaces; newest type wins; counts in-stock units", () => {
    const list = mergeKnownModels([
      { model: "ThinkPad T14 Gen 4", typeId: "tp", createdAt: d("2026-01-01"), inStock: true },
      { model: "thinkpad t14 gen 4 ", typeId: "dl", createdAt: d("2026-06-01"), inStock: false },
      { model: "Latitude 5440", typeId: "dl", createdAt: d("2026-02-01"), inStock: true },
    ]);
    expect(list).toEqual([
      { model: "thinkpad t14 gen 4", typeId: "dl", inStock: 1 },
      { model: "Latitude 5440", typeId: "dl", inStock: 1 },
    ]);
  });
});

describe("matchModels", () => {
  const list = [{ model: "ThinkPad T14 Gen 4", typeId: "tp", inStock: 5 }, { model: "Latitude 5440", typeId: "dl", inStock: 0 }];
  it("empty query lists everything up to the limit", () => {
    expect(matchModels(list, "")).toHaveLength(2);
    expect(matchModels(list, "", 1)).toHaveLength(1);
  });
  it("case-insensitive substring", () => {
    expect(matchModels(list, "t14").map((m) => m.model)).toEqual(["ThinkPad T14 Gen 4"]);
  });
});

describe("resolveModelType (Review Focus 1)", () => {
  const list = [{ model: "ThinkPad T14 Gen 4", typeId: "tp", inStock: 5 }];
  it("matches a known model typed with other case and stray spaces", () => {
    expect(resolveModelType(list, "  thinkpad  t14 gen 4 ")).toEqual({ known: true, typeId: "tp" });
  });
  it("a new model is not known", () => {
    expect(resolveModelType(list, "ThinkPad X1 Carbon")).toEqual({ known: false });
  });
});
```

`src/lib/purchase-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { centavosToDecimalString, formatPeso, moneyToCentavos, purchaseTotal, warrantyUntilFrom } from "./purchase-summary";

describe("moneyToCentavos", () => {
  it("accepts 68,500 / 68500 / 68500.00 / ₱68,500.5", () => {
    expect(moneyToCentavos("68,500")).toBe(6_850_000);
    expect(moneyToCentavos("68500")).toBe(6_850_000);
    expect(moneyToCentavos("68500.00")).toBe(6_850_000);
    expect(moneyToCentavos("₱68,500.5")).toBe(6_850_050);
  });
  it("blank is null; junk and negatives are bad", () => {
    expect(moneyToCentavos("  ")).toBeNull();
    expect(moneyToCentavos("12abc")).toBe("bad");
    expect(moneyToCentavos("-5")).toBe("bad");
    expect(moneyToCentavos("1.234")).toBe("bad");
  });
});

describe("purchaseTotal and formatPeso", () => {
  it("3 × ₱68,500 + ₱500 = ₱206,000.00", () => {
    expect(formatPeso(purchaseTotal(6_850_000, 3, 50_000))).toBe("₱206,000.00");
  });
  it("missing parts count as zero", () => {
    expect(purchaseTotal(null, 3, null)).toBe(0);
  });
  it("decimal string for Prisma", () => {
    expect(centavosToDecimalString(6_850_050)).toBe("68500.50");
  });
});

describe("warrantyUntilFrom (Review Focus 4)", () => {
  it("adds months to the purchase date", () => {
    expect(warrantyUntilFrom("2026-10-12", 12)).toBe("2027-10-12");
  });
  it("clamps to the month's last day", () => {
    expect(warrantyUntilFrom("2026-01-31", 1 * 6)).toBe("2026-07-31");
    expect(warrantyUntilFrom("2026-08-31", 6)).toBe("2027-02-28");
  });
  it("none or no date gives an empty string", () => {
    expect(warrantyUntilFrom("2026-10-12", 0)).toBe("");
    expect(warrantyUntilFrom("", 12)).toBe("");
  });
});
```

`src/lib/serial-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serialProblems, serialRequired } from "./serial-rules";
import { parseSerialPaste } from "./register-input";

describe("serialRequired", () => {
  it("IT yes, Purchasing no", () => {
    expect(serialRequired("IT")).toBe(true);
    expect(serialRequired("PURCHASING")).toBe(false);
  });
});

describe("serialProblems", () => {
  it("IT: blanks are required, repeats (case-insensitive) are duplicates", () => {
    expect(serialProblems(["A1", "", "a1", "B2"], "IT")).toEqual([null, "required", "duplicate", null]);
  });
  it("Purchasing: blanks are fine, repeats still flagged", () => {
    expect(serialProblems(["", "X", "x"], "PURCHASING")).toEqual([null, null, "duplicate"]);
  });
  it("a CRLF paste with a trailing blank line fills exactly its values (Review Focus 3)", () => {
    const values = parseSerialPaste("PF1\r\nPF2\r\nPF3\r\n\r\n");
    expect(values).toEqual(["PF1", "PF2", "PF3"]);
    expect(serialProblems(values, "IT")).toEqual([null, null, null]);
  });
});
```

`src/lib/register-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryIcon, categoryNoun, orderCategories } from "./register-catalog";

describe("orderCategories", () => {
  it("IT in the spec order, unknown IT names after by name, Uncategorised dropped", () => {
    const names = orderCategories([
      { name: "Other", cls: "IT" as const }, { name: "Zebra printer", cls: "IT" as const }, { name: "Laptop", cls: "IT" as const },
      { name: "Uncategorised", cls: "IT" as const }, { name: "Mouse", cls: "IT" as const }, { name: "Workstation (PC)", cls: "IT" as const },
    ]).map((c) => c.name);
    expect(names).toEqual(["Laptop", "Workstation (PC)", "Mouse", "Other", "Zebra printer"]);
  });
  it("Purchasing by name", () => {
    expect(orderCategories([{ name: "Vehicle", cls: "PURCHASING" as const }, { name: "Building", cls: "PURCHASING" as const }]).map((c) => c.name))
      .toEqual(["Building", "Vehicle"]);
  });
});

describe("categoryNoun", () => {
  it.each([
    ["Laptop", 1, "laptop"], ["Laptop", 3, "laptops"], ["Mouse", 2, "mice"], ["Docking Station", 2, "docking stations"],
    ["Workstation (PC)", 1, "workstation"], ["Other", 4, "items"], ["Type C Hub", 2, "Type C hubs"], ["Furniture", 2, "pieces of furniture"],
    ["Zebra printer", 2, "zebra printers"],
  ])("%s × %i → %s", (name, n, noun) => {
    expect(categoryNoun(name as string, n as number)).toBe(noun);
  });
});

describe("categoryIcon", () => {
  it("known names map; unknown falls back to the generic box", () => {
    expect(categoryIcon("Laptop Bag")).toBe("bag");
    expect(categoryIcon("Zebra printer")).toBe("inventory");
  });
});
```

`src/lib/label-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupLabelQueue, whenLabel } from "./label-queue";

const at = (iso: string) => new Date(iso);

describe("groupLabelQueue", () => {
  it("groups by purchase record, newest first, tags in order, title and range", () => {
    const groups = groupLabelQueue([
      { id: "a1", tag: "BR-LT-0202", model: "ThinkPad T14", purchaseRecordId: "r1", createdAt: at("2026-10-14T02:00:00Z") },
      { id: "a2", tag: "BR-LT-0201", model: "ThinkPad T14", purchaseRecordId: "r1", createdAt: at("2026-10-14T02:00:00Z") },
      { id: "b1", tag: "BR-MN-0039", model: "Dell P2422H", purchaseRecordId: "r0", createdAt: at("2026-10-13T02:00:00Z") },
    ]);
    expect(groups.map((g) => [g.recordId, g.title, g.range, g.tags])).toEqual([
      ["r1", "2 × ThinkPad T14", "BR-LT-0201 → BR-LT-0202", ["BR-LT-0201", "BR-LT-0202"]],
      ["r0", "1 × Dell P2422H", "BR-MN-0039", ["BR-MN-0039"]],
    ]);
  });
  it("assets without a record group by model and minute", () => {
    const g = groupLabelQueue([
      { id: "x", tag: "BR-HS-0001", model: "Jabra", purchaseRecordId: null, createdAt: at("2026-10-14T02:00:10Z") },
      { id: "y", tag: "BR-HS-0002", model: "Jabra", purchaseRecordId: null, createdAt: at("2026-10-14T02:00:50Z") },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].recordId).toBeNull();
  });
});

describe("whenLabel", () => {
  const now = at("2026-10-14T10:00:00+08:00");
  it("Just now / Today / Yesterday / date", () => {
    expect(whenLabel(at("2026-10-14T09:55:00+08:00"), now)).toBe("Just now");
    expect(whenLabel(at("2026-10-14T08:00:00+08:00"), now)).toBe("Today");
    expect(whenLabel(at("2026-10-13T08:00:00+08:00"), now)).toBe("Yesterday");
    expect(whenLabel(at("2026-10-01T08:00:00+08:00"), now)).toMatch(/1 Oct 2026|Oct/);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/known-models.test.ts src/lib/purchase-summary.test.ts src/lib/serial-rules.test.ts src/lib/register-catalog.test.ts src/lib/label-queue.test.ts`
Expected: FAIL, "Failed to resolve import".

- [ ] **Step 3: Implement**

`src/lib/known-models.ts`:

```ts
/** Phase 34 (spec §4.2): the models already registered in a category, each with the type it sets. */
export interface KnownModel { model: string; typeId: string | null; inStock: number }

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function mergeKnownModels(
  rows: Array<{ model: string; typeId: string | null; createdAt: Date; inStock: boolean }>,
): KnownModel[] {
  const byKey = new Map<string, { model: string; typeId: string | null; at: number; inStock: number; first: number }>();
  rows.forEach((r, i) => {
    const k = key(r.model);
    if (!k) return;
    const cur = byKey.get(k);
    const at = r.createdAt.getTime();
    if (!cur) {
      byKey.set(k, { model: r.model.trim().replace(/\s+/g, " "), typeId: r.typeId, at, inStock: r.inStock ? 1 : 0, first: i });
      return;
    }
    if (at > cur.at) { cur.at = at; cur.typeId = r.typeId; cur.model = r.model.trim().replace(/\s+/g, " "); }
    if (r.inStock) cur.inStock += 1;
  });
  return [...byKey.values()].sort((a, b) => a.first - b.first).map(({ model, typeId, inStock }) => ({ model, typeId, inStock }));
}

export function matchModels(list: KnownModel[], query: string, limit = 50): KnownModel[] {
  const q = key(query);
  return (q ? list.filter((m) => key(m.model).includes(q)) : list).slice(0, limit);
}

export function resolveModelType(list: KnownModel[], model: string): { known: true; typeId: string | null } | { known: false } {
  const k = key(model);
  const hit = k ? list.find((m) => key(m.model) === k) : undefined;
  return hit ? { known: true, typeId: hit.typeId } : { known: false };
}
```

`src/lib/purchase-summary.ts`:

```ts
/** Phase 34 (spec §4.5): money, the live total, and the warranty date. The total is never stored. */
export function moneyToCentavos(text: string): number | null | "bad" {
  const cleaned = text.replace(/₱|PHP|,|\s/gi, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return "bad";
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function purchaseTotal(unitCentavos: number | null, qty: number, feeCentavos: number | null): number {
  return (unitCentavos ?? 0) * qty + (feeCentavos ?? 0);
}

export function formatPeso(centavos: number): string {
  return "₱" + (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function centavosToDecimalString(c: number): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

export const WARRANTY_LENGTHS = [0, 6, 12, 24, 36] as const;

export function warrantyUntilFrom(purchasedISO: string, months: number): string {
  if (!purchasedISO || !months) return "";
  const [y, m, d] = purchasedISO.split("-").map(Number);
  const targetMonth = m - 1 + months;
  const ty = y + Math.floor(targetMonth / 12);
  const tm = ((targetMonth % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const WARRANTY_COVERED_BY = ["manufacturer", "vendor", "both"] as const;
export const WARRANTY_COVERED_BY_LABEL: Record<(typeof WARRANTY_COVERED_BY)[number], string> = {
  manufacturer: "Manufacturer", vendor: "Vendor", both: "Both",
};
```

`src/lib/serial-rules.ts`:

```ts
import type { AssetClass } from "@prisma/client";

/** Phase 34 (spec §4.3): IT needs a serial on every unit; Purchasing stays optional. */
export function serialRequired(cls: AssetClass): boolean {
  return cls === "IT";
}

export type SerialProblem = "required" | "duplicate" | null;

export function serialProblems(serials: readonly string[], cls: AssetClass): SerialProblem[] {
  const seen = new Set<string>();
  return serials.map((raw) => {
    const s = raw.trim().toUpperCase();
    if (!s) return serialRequired(cls) ? "required" : null;
    if (seen.has(s)) return "duplicate";
    seen.add(s);
    return null;
  });
}
```

`src/lib/register-catalog.ts`:

```ts
import type { AssetClass, AssetStatus } from "@prisma/client";

/** Phase 34 (spec §2.1, §4.1). */
export type CategoryIconName = "laptop" | "workstation" | "monitor" | "headset" | "mouse" | "hub" | "dock" | "bag" | "other" | "inventory";

export const IT_CATEGORY_ORDER = [
  "Laptop", "Workstation (PC)", "Monitor", "Headset", "Mouse", "Type C Hub", "Docking Station", "Laptop Bag", "Other",
] as const;

const HIDDEN = new Set(["uncategorised"]);

export function orderCategories<T extends { name: string; cls: AssetClass }>(cats: T[]): T[] {
  const visible = cats.filter((c) => !HIDDEN.has(c.name.toLowerCase()));
  const rank = (c: T) => {
    if (c.cls !== "IT") return 1000;
    const i = (IT_CATEGORY_ORDER as readonly string[]).indexOf(c.name);
    return i === -1 ? 500 : i;
  };
  return [...visible].sort((a, b) => (a.cls === b.cls ? 0 : a.cls === "IT" ? -1 : 1) || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

const ICONS: Record<string, CategoryIconName> = {
  laptop: "laptop", "workstation (pc)": "workstation", monitor: "monitor", headset: "headset", mouse: "mouse",
  "type c hub": "hub", "docking station": "dock", "laptop bag": "bag", other: "other",
};
export function categoryIcon(name: string): CategoryIconName {
  return ICONS[name.toLowerCase()] ?? "inventory";
}

const NOUNS: Record<string, [string, string]> = {
  "workstation (pc)": ["workstation", "workstations"], mouse: ["mouse", "mice"], "type c hub": ["Type C hub", "Type C hubs"],
  other: ["item", "items"], furniture: ["piece of furniture", "pieces of furniture"], "pantry equipment": ["pantry item", "pantry items"],
};
export function categoryNoun(name: string, n: number): string {
  const pair = NOUNS[name.toLowerCase()];
  if (pair) return n === 1 ? pair[0] : pair[1];
  const lower = name.toLowerCase();
  return n === 1 ? lower : `${lower}s`;
}

export const STOCK_STATUS: Record<AssetClass, AssetStatus> = { IT: "SPARE", PURCHASING: "STORED" };
```

`src/lib/label-queue.ts`:

```ts
import { fmtDate } from "@/lib/format";

/** Phase 34 (spec §5): labels waiting to print, grouped by registration batch. */
export interface QueueAsset { id: string; tag: string; model: string; purchaseRecordId: string | null; createdAt: Date }
export interface QueueGroup { key: string; recordId: string | null; title: string; range: string; tags: string[]; assetIds: string[]; createdAt: Date }

export function groupLabelQueue(rows: QueueAsset[]): QueueGroup[] {
  const groups = new Map<string, { recordId: string | null; model: string; items: QueueAsset[]; createdAt: Date }>();
  for (const r of rows) {
    const key = r.purchaseRecordId ?? `m:${r.model}:${Math.floor(r.createdAt.getTime() / 60_000)}`;
    const g = groups.get(key) ?? { recordId: r.purchaseRecordId, model: r.model, items: [], createdAt: r.createdAt };
    g.items.push(r);
    if (r.createdAt > g.createdAt) g.createdAt = r.createdAt;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const items = [...g.items].sort((a, b) => a.tag.localeCompare(b.tag));
      const tags = items.map((i) => i.tag);
      return {
        key, recordId: g.recordId, title: `${items.length} × ${g.model}`,
        range: tags.length === 1 ? tags[0] : `${tags[0]} → ${tags[tags.length - 1]}`,
        tags, assetIds: items.map((i) => i.id), createdAt: g.createdAt,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

const MANILA = "Asia/Manila";
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: MANILA });

export function whenLabel(at: Date, now: Date): string {
  if (now.getTime() - at.getTime() < 10 * 60_000) return "Just now";
  const today = dayOf(now);
  if (dayOf(at) === today) return "Today";
  const y = new Date(now.getTime() - 86_400_000);
  if (dayOf(at) === dayOf(y)) return "Yesterday";
  return fmtDate(at);
}
```

Modify `src/lib/documents.ts`: extend the kinds and labels.

```ts
export const DOCUMENT_KINDS = ["receipt", "accountability-form", "photo", "other", "invoice", "official-receipt", "warranty-slip", "delivery-receipt"] as const;
…
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  receipt: "Receipt", "accountability-form": "Accountability form", photo: "Photo", other: "Other", invoice: "Invoice",
  "official-receipt": "Official receipt", "warranty-slip": "Warranty slip", "delivery-receipt": "Delivery receipt",
};
```

- [ ] **Step 4: Run the new tests and the whole unit suite**

Run: `npx vitest run`
Expected: all pass, including the new files and the existing `documents` users.

- [ ] **Step 5: Commit**

```bash
git add src/lib/register-catalog.ts src/lib/register-catalog.test.ts src/lib/known-models.ts src/lib/known-models.test.ts src/lib/purchase-summary.ts src/lib/purchase-summary.test.ts src/lib/serial-rules.ts src/lib/serial-rules.test.ts src/lib/label-queue.ts src/lib/label-queue.test.ts src/lib/documents.ts
git commit -m "feat(lib): Phase 34 pure rules -- category catalogue, known models, purchase summary, serial rules, label queue; three new document kinds"
```

---

### Task 3: Register actions carry the purchase record, new fields and the IT serial rule

**Files:**
- Modify: `src/server/modules/inventory/actions.ts` (`createAsset`, lines 179-386), `src/server/modules/purchases/receiving.ts` (`registerAssets`, lines 25-210), `src/lib/activity.ts`, `src/lib/activity.test.ts`, `src/server/modules/audit/queries.ts`, and the file that defines `HiddenAuditRefs` / `NO_HIDDEN_REFS` / `buildAuditWhere` (find it with `grep -rn "NO_HIDDEN_REFS" src/lib`).

**Interfaces:**
- Consumes: `serialRequired` and `serialProblems` (Task 2), `WARRANTY_COVERED_BY` (Task 2), and the Task 1 schema.
- Produces:
  - `createAsset(input)` → `ActionResult<{ id: string; purchaseRecordId: string }>`.
  - `registerAssets(input)` → `ActionResult<{ created: number; ids: string[]; purchaseRecordId: string }>`.
  - New optional input keys on both: `receiptRef`, `warrantyCoveredBy`, `warrantyContact`, `fees` (decimal string like `"500.00"` or `""`).
  - `registerAssets` also accepts `requestedStatus`. It is ignored; batches stay in the default status. This only lets the client send one shape.
  - The audit action `"purchase.recorded"` on `entityType: "purchase-record"`, with diff `{ quantity: { from: null, to: n }, total: { from: null, to: "<decimal string>" } }`.
  - `HiddenAuditRefs.purchaseRecordIds: string[]`.

- [ ] **Step 1: Write the failing sentence test**

Append to `src/lib/activity.test.ts`:

```ts
describe("purchase.recorded (Phase 34)", () => {
  it("reads as a purchase of N items", () => {
    expect(auditSentence({ actorLabel: "J. Sarmiento", action: "purchase.recorded", diff: { quantity: { from: null, to: 3 } }, entityLabel: "BR-LT-0201 → BR-LT-0203" }))
      .toBe("J. Sarmiento recorded a purchase of 3 items (BR-LT-0201 → BR-LT-0203)");
    expect(auditSentence({ actorLabel: "J. Sarmiento", action: "purchase.recorded", diff: { quantity: { from: null, to: 1 } }, entityLabel: "BR-LT-0201" }, { omitEntity: true }))
      .toBe("J. Sarmiento recorded a purchase of 1 item");
  });
});
```

Run `npx vitest run src/lib/activity.test.ts`. Expected: FAIL; the default case returns another sentence.

- [ ] **Step 2: Add the case in `src/lib/activity.ts`**

Add it before `default`, using the file's existing `actor` / `diff` locals as the other cases do:

```ts
    case "purchase.recorded": {
      const n = typeof diff?.quantity?.to === "number" ? diff.quantity.to : 0;
      const what = `a purchase of ${n} item${n === 1 ? "" : "s"}`;
      return omitEntity ? `${actor}recorded ${what}` : `${actor}recorded ${what} (${entry.entityLabel})`;
    }
```

Run the test again. Expected: PASS.

- [ ] **Step 3: `createAsset`: schema, rules, record**

In `createSchema` add:

```ts
  receiptRef: z.string().trim().max(60).optional(),
  warrantyCoveredBy: z.union([z.literal(""), z.enum(WARRANTY_COVERED_BY)]).optional(),
  warrantyContact: z.string().trim().max(160).optional(),
  fees: z.union([z.literal(""), z.coerce.number().nonnegative().max(9_999_999_999.99).multipleOf(0.01, "Whole centavos only")]).optional(),
```

Also change `cost`'s `.max(10_000_000)` to `.max(9_999_999_999.99)`.

In the one-pass `errors` block, after the category lookup, add:

```ts
  if (category && serialRequired(category.cls) && !(d.serial ?? "").trim()) {
    errors.serial = "Enter the serial number before you register.";
  }
```

In the transaction, create the record first and link the asset:

```ts
    const record = await tx.purchaseRecord.create({
      data: {
        cls: category.cls, vendorId: d.vendorId || null, purchasedAt: toDate(d.purchasedAt),
        invoiceRef: d.invoiceRef || null, receiptRef: d.receiptRef || null,
        unitCost: toCost(d.cost), fees: toCost(d.fees), quantity: 1, createdById: user.id,
      },
    });
```

Add these to `tx.asset.create` `data`:
`receiptRef: d.receiptRef || null, warrantyCoveredBy: d.warrantyCoveredBy || null, warrantyContact: d.warrantyContact || null, purchaseRecordId: record.id`.

After the asset's `create` audit, add:

```ts
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "purchase-record", entityId: record.id, action: "purchase.recorded",
      diff: { quantity: { from: null, to: 1 }, total: { from: null, to: String((Number(toCost(d.cost) ?? 0) + Number(toCost(d.fees) ?? 0)).toFixed(2)) } },
    });
```

Return `{ created, recordId: record.id }` from the transaction, and finish with `return ok({ id: asset.created.id, purchaseRecordId: asset.recordId });`. Rename the local variable as needed; keep the existing `revalidatePath` and `rememberPicks`.

Imports: `serialRequired` from `@/lib/serial-rules` and `WARRANTY_COVERED_BY` from `@/lib/purchase-summary`.

- [ ] **Step 4: `registerAssets`: the same, batch-shaped**

In `registerSchema`:
- add `receiptRef`, `warrantyCoveredBy` and `warrantyContact` exactly as in Step 3;
- add `fees: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 12500 or 12,500.50").optional().or(z.literal(""))`;
- change `cost` to `z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 12500 or 12,500.50").optional().or(z.literal(""))`. Today it is unvalidated.
- add `requestedStatus: z.string().optional()` (ignored).

After the existing in-batch duplicate-serial check, add the IT rule:

```ts
  if (category && serialRequired(category.cls)) {
    d.tags.forEach((tag, i) => {
      if (!(d.serials?.[i] ?? "").trim()) errors[`serials.${i}`] = `Row ${i + 1} · ${tag} needs a serial`;
    });
  }
```

In the transaction, before the loop, create `record`: as Step 3, with `quantity: d.tags.length`, `unitCost: d.cost || null`, `fees: d.fees || null`.

In the loop, add `receiptRef`, `warrantyCoveredBy`, `warrantyContact` and `purchaseRecordId: record.id` to each `asset.create`.

After the loop, write the `purchase.recorded` audit. Its `total` is computed with the same arithmetic as Step 3:
`(Number(d.cost || 0) * d.tags.length + Number(d.fees || 0)).toFixed(2)`.

Set `done = { created, ids, purchaseRecordId: record.id }`, and widen the `Registered` interface to match.

- [ ] **Step 5: Audit visibility and label for `purchase-record`**

- In the `HiddenAuditRefs` type, add `purchaseRecordIds: string[]`, and `purchaseRecordIds: []` in `NO_HIDDEN_REFS`.
- In `buildAuditWhere`, extend the `NOT` / `OR` list with `{ entityType: "purchase-record", entityId: { in: hidden.purchaseRecordIds } }`, mirroring how `categoryIds` is handled.
- In `invisibleAuditRefs`, add a fifth query, `prisma.purchaseRecord.findMany({ where: { cls }, select: { id: true } })`, and return `purchaseRecordIds: ids(records)`.
- In `entityLabels`, add a branch for `byType.has("purchase-record")`. It loads `prisma.purchaseRecord.findMany({ where: { id: { in: [...] } }, select: { id: true, assets: { select: { tag: true }, orderBy: { tag: "asc" } } } })` and sets the label to the first tag, or `first → last` when there is more than one, with href `null`.
- Run `npx vitest run src/lib/audit-list.test.ts`, or whichever test pins `NO_HIDDEN_REFS`, and update its expected object to include `purchaseRecordIds: []`.

- [ ] **Step 6: Type-check and run the unit tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors and all tests pass. If `register-form.tsx` reads `res.data.id`, it still compiles, because the result only gained a field.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/inventory/actions.ts src/server/modules/purchases/receiving.ts src/lib/activity.ts src/lib/activity.test.ts src/server/modules/audit/queries.ts src/lib/audit-list.ts src/lib/audit-list.test.ts
git commit -m "feat(register): createAsset and registerAssets write a PurchaseRecord (purchase.recorded audit), OR no., warranty covered-by and contact, fees; IT serial required server-side; purchase-record rows class-scoped in /audit"
```

(Adjust the `git add` list to the files actually touched; `git status --short` shows them.)

---

### Task 4: Register catalogue query, label queue query and `markLabelsPrinted`

**Files:**
- Create: `src/server/modules/inventory/register-queries.ts`, `src/server/modules/inventory/label-queue.ts`, `src/server/modules/inventory/label-actions.ts`

**Interfaces:**
- Consumes: `mergeKnownModels`, `orderCategories`, `STOCK_STATUS`, `groupLabelQueue` (Task 2), and the schema (Task 1).
- Produces:

```ts
// register-queries.ts (server-only module, no "use server")
export interface CatalogCategory {
  id: string; name: string; cls: AssetClass; tagPrefix: string | null; inStock: number;
  types: Array<{ id: string; name: string }>;
  models: KnownModel[];
}
export async function registerCatalog(classes: AssetClass[]): Promise<CatalogCategory[]>;

// label-queue.ts (server-only)
export async function labelQueue(classes: AssetClass[], limitGroups?: number): Promise<{ groups: QueueGroup[]; more: boolean }>;
export async function queueCount(classes: AssetClass[]): Promise<number>; // assets waiting

// label-actions.ts ("use server")
export async function markLabelsPrinted(input: unknown): Promise<ActionResult<{ marked: number }>>;
// input: { assetIds: string[] } (1..200)
```

- [ ] **Step 1: Implement `registerCatalog`**

```ts
import type { AssetClass } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { mergeKnownModels, type KnownModel } from "@/lib/known-models";
import { orderCategories, STOCK_STATUS } from "@/lib/register-catalog";

export interface CatalogCategory {
  id: string; name: string; cls: AssetClass; tagPrefix: string | null; inStock: number;
  types: Array<{ id: string; name: string }>; models: KnownModel[];
}

/** Phase 34 (spec §4.1-4.2): the Register tab's cards, each with its stock count, types and known models. */
export async function registerCatalog(classes: AssetClass[]): Promise<CatalogCategory[]> {
  const cats = await prisma.assetCategory.findMany({
    where: { cls: { in: classes } },
    select: { id: true, name: true, cls: true, tagPrefix: true, types: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
  const ids = cats.map((c) => c.id);
  const [stock, assets] = await Promise.all([
    prisma.asset.groupBy({ by: ["categoryId", "status"], where: { categoryId: { in: ids } }, _count: { _all: true } }),
    prisma.asset.findMany({
      where: { categoryId: { in: ids } },
      select: { categoryId: true, model: true, typeId: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" }, take: 5000,
    }),
  ]);
  return orderCategories(cats).map((c) => ({
    id: c.id, name: c.name, cls: c.cls, tagPrefix: c.tagPrefix, types: c.types,
    inStock: stock.filter((s) => s.categoryId === c.id && s.status === STOCK_STATUS[c.cls]).reduce((n, s) => n + s._count._all, 0),
    models: mergeKnownModels(
      assets.filter((a) => a.categoryId === c.id)
        .map((a) => ({ model: a.model, typeId: a.typeId, createdAt: a.createdAt, inStock: a.status === STOCK_STATUS[c.cls] })),
    ).slice(0, 200),
  }));
}
```

- [ ] **Step 2: Implement `labelQueue` / `queueCount`**

```ts
import type { AssetClass } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { groupLabelQueue, type QueueGroup } from "@/lib/label-queue";

const WAITING = (classes: AssetClass[]) => ({ cls: { in: classes }, labelPrintedAt: null });

/** Phase 34 (spec §5): the newest `limitGroups` batches with labels not yet printed, in the given classes. */
export async function labelQueue(classes: AssetClass[], limitGroups = 50): Promise<{ groups: QueueGroup[]; more: boolean }> {
  if (classes.length === 0) return { groups: [], more: false };
  const rows = await prisma.asset.findMany({
    where: WAITING(classes),
    select: { id: true, tag: true, model: true, purchaseRecordId: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 2000,
  });
  const groups = groupLabelQueue(rows);
  return { groups: groups.slice(0, limitGroups), more: groups.length > limitGroups };
}

export async function queueCount(classes: AssetClass[]): Promise<number> {
  if (classes.length === 0) return 0;
  return prisma.asset.count({ where: WAITING(classes) });
}
```

- [ ] **Step 3: Implement `markLabelsPrinted`**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { MANAGEABLE_CLASSES } from "@/lib/asset-class";

const schema = z.object({ assetIds: z.array(z.string().min(1)).min(1).max(200) });

/**
 * Phase 34 (spec §5): a print convenience, not a custody change — no audit row. Idempotent:
 * only rows still waiting are stamped, so a reprint never moves labelPrintedAt (Review Focus 5).
 */
export async function markLabelsPrinted(input: unknown): Promise<ActionResult<{ marked: number }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { count } = await prisma.asset.updateMany({
    where: { id: { in: parsed.data.assetIds }, cls: { in: [...MANAGEABLE_CLASSES[user.role]] }, labelPrintedAt: null },
    data: { labelPrintedAt: new Date() },
  });
  revalidatePath("/inventory/labels");
  return ok({ marked: count });
}
```

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit`. Expected: no errors.

```bash
git add src/server/modules/inventory/register-queries.ts src/server/modules/inventory/label-queue.ts src/server/modules/inventory/label-actions.ts
git commit -m "feat(register,labels): registerCatalog (cards, stock, types, known models), labelQueue/queueCount, markLabelsPrinted (class-scoped, idempotent, no audit)"
```

(These modules are exercised end to end in Task 9. They have no unit tests because they are thin Prisma reads over the tested pure functions, as the house pattern does for queries.)

---

### Task 5: The label cell, icons and the New equipment tabs

**Files:**
- Create: `src/components/inventory/label-cell.tsx`, `src/components/inventory/new-equipment-tabs.tsx`
- Modify: `src/components/inventory/label-sheet.tsx`, `src/components/ui/icon.tsx`, `src/lib/label-geometry.ts`, `src/lib/label-geometry.test.ts`

**Interfaces:**
- Produces:
  - `LabelCell({ tag, model, category, base }: { tag: string; model: string; category: string; base: QrBase })`. It is a pure render, usable by server and client, sized in mm to `LABEL_CELL_MM`. `Barcode` and `Qr` move into this file and are exported.
  - `LabelRow` gains `category: string`.
  - `IconName` gains `"workstation" | "mouse" | "hub" | "bag" | "other" | "scan"`.
  - `NewEquipmentTabs({ active, cls, waiting }: { active: "register" | "labels"; cls: AssetClass; waiting: number })`.
  - `LABEL_LAYOUT_MM` in `label-geometry.ts`.

- [ ] **Step 1: Failing geometry test for the new layout budget**

Append to `src/lib/label-geometry.test.ts`:

```ts
import { LABEL_LAYOUT_MM, LABEL_PADDING_MM as PAD } from "./label-geometry";

describe("Phase 34 label layout (spec §6)", () => {
  it("top row + QR row + tag + barcode + gaps fit inside the cell height", () => {
    const L = LABEL_LAYOUT_MM;
    const total = 2 * PAD + L.topRow + L.gap + QR_MAX_DARK_MM + 2 * QR_QUIET_MODULES * QR_PREFERRED_MODULE_MM + L.gap + L.tag + L.gap + L.barcode;
    expect(total).toBeLessThanOrEqual(LABEL_CELL_MM.height);
  });
  it("keeps today's 4.6mm tag size as the floor", () => {
    expect(LABEL_LAYOUT_MM.tag).toBeGreaterThanOrEqual(4.6);
  });
});
```

Run: `npx vitest run src/lib/label-geometry.test.ts`. Expected: FAIL, `LABEL_LAYOUT_MM` is undefined.

- [ ] **Step 2: Add the constant to `label-geometry.ts`**

```ts
/** Phase 34 (spec §6): the redesigned cell's row heights in mm, checked against the cell in the test. */
export const LABEL_LAYOUT_MM = { topRow: 4, gap: 2, tag: 5.2, barcode: 9 } as const;
```

Run the test. Expected: PASS. The total is 5+5 + 4 + 2 + 24 + 4 + 2 + 5.2 + 2 + 9 = 62.2 ≤ 69.25.

- [ ] **Step 3: Create `label-cell.tsx`**

- Move `Barcode`, `Qr` and `QR_NOTE` from `label-sheet.tsx` into it, unchanged, and export all three. `label-sheet.tsx` re-exports `QR_NOTE`, so the labels page import keeps working.
- Add `LabelCell`. It renders inside the existing cell box (padding `LABEL_PADDING_MM`, `outline` dashed as today, column flex, `space-between`, `overflow: hidden`) in this order:

```tsx
export function LabelCell({ tag, model, category, base }: { tag: string; model: string; category: string; base: QrBase }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "1.5mm", minWidth: 0, height: `${LABEL_LAYOUT_MM.topRow}mm` }}>
        <span style={{ background: "#101828", color: "#fff", fontFamily: "monospace", fontSize: "2.6mm", padding: "0.6mm 1mm", flex: "none" }}>BR</span>
        <span style={{ fontSize: "2.6mm", fontWeight: 600, flex: "none" }}>Backroom IT</span>
        <span style={{ marginLeft: "auto", fontSize: "2.4mm", color: "#475467", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{category}</span>
      </div>
      <div style={{ display: "flex", gap: "3mm", alignItems: "center", minWidth: 0, flexShrink: 0 }}>
        {base.ok ? <div style={{ flexShrink: 0, lineHeight: 0 }}><Qr url={qrUrlFor(tag, base)} /></div> : null}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "1.2mm" }}>
          <span style={{ fontSize: "2.6mm", color: "#344054", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{model}</span>
          {base.ok && <span style={{ fontSize: "2.2mm", color: "#667085" }}>Scan to open</span>}
        </div>
      </div>
      <div style={{ fontFamily: "monospace", fontSize: `${LABEL_LAYOUT_MM.tag}mm`, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>{tag}</div>
      <div style={{ width: `${LABEL_USABLE_MM}mm`, flexShrink: 0 }}><Barcode tag={tag} /></div>
    </>
  );
}
```

- [ ] **Step 4: Use it in `label-sheet.tsx`**

- Replace the filled cell's children (lines 193-216) with `<LabelCell tag={tag} model={row.model} category={row.category} base={base} />`.
- `LabelRow` becomes `{ tag: string; model: string; category: string }`.
- Add an optional prop `startHref?: (slot: number) => string`. When it is given:
  - the first page is padded with trailing free cells up to `LABELS_PER_PAGE`, each `<div data-free-slot="" />`;
  - every blank (`data-blank-label`) and free cell gets a screen-only `<a className="label-slot-link" href={startHref(i + 1)} aria-label={`Start at sticker ${i + 1}`}>` that fills the cell. A blank cell shows the word "used" in it; a free cell shows its number.
  - Both links and words carry the class `print:hidden`. Printed output is identical to today's.
- Add to `src/app/globals.css`:

```css
/* Phase 34 (plan P-7): the printable sheet doubles as the on-screen preview — half size on screen only. */
@media screen {
  .label-preview .label-sheets { transform: scale(0.5); transform-origin: top left; width: 210mm; }
  .label-preview { width: 105mm; height: calc(148.5mm * var(--sheets, 1)); overflow: hidden; }
  .label-preview [data-blank-label] { background: repeating-linear-gradient(135deg, #f2f4f7 0 2mm, #fff 2mm 4mm); }
  .label-slot-link { position: absolute; inset: 0; display: grid; place-items: center; font-size: 5mm; color: #98a2b3; text-decoration: none; }
  .label-slot-link:focus-visible { outline: 1mm solid var(--accent); outline-offset: -1mm; }
}
```

  Blank and free cells need `position: relative` so the link can fill them.
- Callers that build `LabelRow` (the labels page) now pass `category` (Task 8).

- [ ] **Step 5: Icons and tabs**

- In `icon.tsx`, add the `PATHS` entries on the same 18-unit grid:
  - `workstation`: a screen rect, a stand, and a tower rect;
  - `mouse`: a rounded rect and a wheel line;
  - `hub`: a plug rect and a box;
  - `bag`: a body rect, a handle path and a strap line;
  - `other`: three squares and a plus;
  - `scan`: four corner brackets and a midline.

  Extend `IconName` to include them. `register-catalog.ts`'s `CategoryIconName` maps 1:1 onto `IconName` (`dock`, `laptop`, `monitor`, `headset` and `inventory` already exist).
- Create `new-equipment-tabs.tsx`:

```tsx
import type { AssetClass } from "@prisma/client";
import { Tabs } from "@/components/ui/tabs";
import { withClsQS } from "@/lib/asset-class";

/** Phase 34 (spec §3, plan P-9): two real pages under one heading; the Labels tab counts what waits. */
export function NewEquipmentTabs({ active, cls, waiting }: { active: "register" | "labels"; cls: AssetClass; waiting: number }) {
  return (
    <Tabs
      label="New equipment"
      className="mb-4"
      items={[
        { label: "Register", href: "/inventory/register" + withClsQS("", cls), active: active === "register" },
        {
          label: (
            <span className="inline-flex items-center gap-1.5">
              Labels
              {waiting > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-white" aria-label={`${waiting} waiting`}>{waiting}</span>
              )}
            </span>
          ),
          href: "/inventory/labels" + withClsQS("", cls),
          active: active === "labels",
        },
      ]}
    />
  );
}
```

- [ ] **Step 6: Run the checks and commit**

Run: `npx tsc --noEmit && npx vitest run`. Expected: both green. `tsc` flags the labels page's `LabelRow` missing `category`; pass `category: ""` there for now, and Task 8 replaces it.

```bash
git add src/components/inventory/label-cell.tsx src/components/inventory/label-sheet.tsx src/components/inventory/new-equipment-tabs.tsx src/components/ui/icon.tsx src/lib/label-geometry.ts src/lib/label-geometry.test.ts src/app/globals.css "src/app/(app)/inventory/labels/page.tsx"
git commit -m "feat(labels): one LabelCell (BR · Backroom IT · category, QR beside the model, big tag, full-width barcode) shared by sheet and preview; screen-only slot links; New equipment tabs; category icons"
```

---

### Task 6: Register tab, part 1: page, cards, model, quantity, serials, where-it-goes and submit

**Files:**
- Modify: `src/app/(app)/inventory/register/page.tsx`, `src/components/inventory/register-form.tsx` (rewrite), `src/components/inventory/register-initial-state.tsx`
- Create: `src/components/inventory/category-cards.tsx`, `src/components/inventory/model-combobox.tsx`, `src/components/inventory/serial-section.tsx`
- Delete: `src/components/inventory/register-success.tsx`

**Interfaces:**
- Consumes:
  - `registerCatalog` (Task 4), `queueCount` (Task 4);
  - `matchModels`, `resolveModelType`, `categoryIcon`, `categoryNoun`, `serialProblems`, `serialRequired`, `warrantyUntilFrom` (Task 2);
  - `LabelCell` (Task 5), `NewEquipmentTabs` (Task 5);
  - action results with `purchaseRecordId` (Task 3).
- Produces:
  - `RegisterForm` props replace `categories` + `types` with `catalog: CatalogCategory[]`. Everything else is kept: `vendors`, `recentVendors`, `employees`, `recentEmployees`, `requests`, `prefixCountsByCategory`, `highestByPrefix`, `directClasses`, `defaultCls`, `listHref`. `baseUrl` is added for the live label.
  - DOM contract for e2e, which these exact names are relied on:
    - category cards are `<button aria-pressed>` whose accessible name starts with the category name (e.g. "Laptop 12 in stock");
    - the model input is labelled **Model**, with `role="combobox"`, and its listbox options are named by the model;
    - the new-model type select is labelled **New model — which type?**;
    - the type line reads "Type: {name} — set by this model";
    - the quantity input is labelled **How many** and the stepper buttons "One fewer" / "One more";
    - one-unit serial input labelled **Serial number**; batch rows keep `Tag {i}` / `Serial {i}` aria-labels;
    - the segmented control is labelled **Where does it go**, with options "Spare stock", "Give to someone", "Lend" (IT) or "Stored", "In use" (Purchasing);
    - holder field labelled **Who**, loan date labelled **Back by**;
    - the primary button reads `Register {n} {categoryNoun}` (e.g. "Register 1 laptop", "Register 3 laptops");
    - the secondary button reads "Register and add another".

- [ ] **Step 1: Page**

In `register/page.tsx`:
- Replace the `categories` / `types` queries with `const catalog = await registerCatalog(classes);`.
- Compute `waiting = await queueCount([...MANAGEABLE_CLASSES[user.role]])`.
- Render:
  - `PageHeader title="New equipment"` with breadcrumb `[{ label: listCls === "PURCHASING" ? "Purchasing assets" : "Inventory", href: listHref }, { label: "Register" }]`;
  - then `<NewEquipmentTabs active="register" cls={listCls} waiting={waiting} />`;
  - then `<RegisterForm catalog={catalog} … baseUrl={process.env.APP_BASE_URL} />`.
- Prefix suggestion: keep `tagSuggestions(catalog.map((c) => c.id))`. In the form, the prefix for a category is `preferredPrefix(prefixCountsByCategory[id] ?? []) ?? catalog.find(c => c.id === id)?.tagPrefix ?? ""` (spec §7.1).

- [ ] **Step 2: `category-cards.tsx`**

The props are `{ catalog: CatalogCategory[]; value: string; onChange(id: string): void; invalid?: boolean }`.
- Render a `<fieldset>` with `<legend className="sec">What</legend>` and a grid `grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5`.
- Each card is a `<button type="button" aria-pressed={on}>`, `min-h-[62px]`, with:
  - `<Icon name={categoryIcon(c.name)} />` in a 34px square, accent-filled when on;
  - the name on one line with an ellipsis (`truncate`);
  - "N in stock" or "None yet".
- Arrow keys are not needed: these are buttons in a grid, and Tab order is enough.

- [ ] **Step 3: `model-combobox.tsx`**

The props are `{ id: string; models: KnownModel[]; types: Array<{id,name}>; value: string; onValue(v: string): void; typeId: string; onType(id: string): void; placeholder: string; invalid?: boolean; describedBy?: string }`.

It behaves like the house `EntityCombobox`, but a free-text value is allowed:
- input `role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list"`;
- the list opens on focus and on typing, with `matchModels(models, value)`;
- each option shows the model, a type badge, and "N in stock" or "none in stock";
- ArrowUp/Down move the active option and Enter picks it. Escape closes the list; a click outside closes it (`useOverlayLayer`, as `EntityCombobox` does);
- picking a known model sets `value` and calls `onType(typeId)`;
- when the typed value is not a known model and is non-empty, the last option reads `+ Add "{value}" as a new model` and closes the list.

Below the input:
- If `resolveModelType(models, value).known`: `<p>Type: <b>{type name}</b> — set by this model</p>` and a "Change type" link button. The link reveals the select used for a new model.
- Else, if `value.trim()` and `types.length > 1`: the select labelled **New model — which type?**, required, with the hint "Next time this model fills it in for you."
- If `types.length === 1`: `onType(types[0].id)` silently, via an effect when the category changes.

- [ ] **Step 4: `serial-section.tsx`**

The props are `{ cls: AssetClass; rows: RegisterRow[]; problems: SerialProblem[]; attempted: boolean; hits: IdentifierHits; onSerial(i, v); onPasteSerials(i, values); onTag(i, v); onLastEnter(); invalidTags: Set<number> }`.
- Section title "Serial number" (IT) or "Serial number (optional)" (Purchasing). For IT the red `*` and the hint "Required. It's on the box label or the sticker under the device." are shown.
- **Quantity 1:**
  - one 54px-tall input labelled **Serial number**, monospace at 16px, with the tag chip `tag {rows[0].tag}` beside it;
  - `onKeyDown`: Enter calls `e.preventDefault()` and moves focus to the "Where does it go" control. It never submits (Review Focus 2);
  - when `attempted && problems[0] === "required"`, the box gets the error style and `aria-invalid`, and `<p id=…>Enter the serial number before you register.</p>` is linked by `aria-describedby`.
- **Batches:** reuse today's `RegisterRows` table (aria-labels `Tag {i}` / `Serial {i}`) and pass a status column per row:
  - "✓ ready";
  - "missing", or "required" in red once `attempted`;
  - "duplicate" in amber;
  - "already registered", using today's `registeredRows(rows, hits)`.

  Paste-fill stays as today.

- [ ] **Step 5: Rewrite `register-form.tsx`**

Keep today's machinery unchanged:
- `rows` / `resize` / `retag` / `startAnother` / `written` / `highestOf`;
- `useIdentifierCheck`;
- `refuse` (focus the first error);
- the rate-limit notice and the banner;
- the `CLAIMED` keys, extended with `receiptRef`, `warrantyCoveredBy`, `warrantyContact` and `fees`.

Layout, top to bottom, inside `rounded-[14px] border bg-surface p-[26px_28px] flex flex-col gap-6`, with each section after the first carrying `border-t pt-6` and an uppercase `sec` title:

1. `<CategoryCards>`.
2. Section **Model and quantity**, as a grid `repeat(auto-fit,minmax(280px,1fr))`:
   - `<ModelCombobox>`;
   - **How many**: a stepper with "One fewer" / "One more" around a text input (today's `quantityText` / `clampQuantity` / `commitQuantity`), plus quick picks 5 and 10 (`aria-pressed`).
3. `<SerialSection>`.
4. Section **Where does it go?**, a flex-wrap row:
   - left: the reworked `RegisterInitialState` when `single`, else the grey note "All N go to spare stock. To hand one out, register it on its own." (Purchasing: "…go to storage…");
   - right: `<figure>` with the live label `<div style={{ zoom: 0.9 }}><LabelCell tag={rows[0].tag || exampleTag} model={model || category.name} category={category.name} base={qrBase(baseUrl)} /></div>` inside a 63.33mm × 69.25mm box with border and radius. For a batch, two offset outline boxes sit behind it.
   - The caption is "Your label, actual size" or "First of N labels, actual size".
5. `<PurchaseSection>` is Task 7. For this task, render the existing procurement fields unchanged in a temporary block so nothing is lost.
6. Footer: the status line, then `Register and add another` (secondary, `name="intent" value="register-add"`), then primary `Register {n} {categoryNoun(category.name, n)}`.

   The status line (spec §4.6) is computed live:
   - the list of what is still missing, joined with ", ": "a category", "a model", "the type for this new model", "N serial(s)" (count of `"required"`), "N duplicate(s) to fix", "who gets it" (a holder status with no Who), "the loan end date";
   - it reads `Still needed: …` in amber (`text-[var(--st-attention-text)]`), or `Ready to register` in green (`text-[var(--st-settled-text)]`), inside `aria-live="polite"`.

`RegisterInitialState` changes:
- the SegmentedControl `aria-label` becomes "Where does it go";
- IT labels: SPARE "Spare stock", DEPLOYED "Give to someone", TEMPORARY "Lend";
- Purchasing labels: STORED "Stored", OPERATIONAL "In use";
- the field labels become **Who** and **Back by**.

Submit changes, applied to today's `submit`:
- Client validation adds `serialProblems(rows.map(r => r.serial), cls)`. Any `"required"` or `"duplicate"` → refuse, with the field key `serials` or `serials.{i}` and the copy from Task 3.
- A new model with no type, when `types.length > 1` → `found.typeId = "Pick the type for this new model"`.
- Success:
  - `const recordId = res.data.purchaseRecordId;`
  - Upload documents as today. If an upload fails, route to the asset's Documents tab exactly as today.
  - Otherwise: `intent === "register-add"` → toast and `startAnother(sentTags)` (unchanged).
  - Else `router.push("/inventory/labels" + withClsQS(`?just=${recordId}`, cls))` (P-5).
- Delete the `RegisterSuccess` branch and its import, and delete `register-success.tsx`.

- [ ] **Step 6: Typecheck, lint, unit, then a smoke run with Playwright**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected:
- `tsc` is clean;
- `lint` shows only the 2 pre-existing warnings in `src/lib/worklist.test.ts` (unused imports since Phase 32), which you may remove in this commit: delete the unused `LOAN_DUE_SOON_DAYS` and `WorkGroup` imports;
- the unit tests pass.

The full Register e2e lands in Task 9. Here run only `E2E_PORT=3100 npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` (foreground, port check first). It scans `/inventory/register`. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A src/components/inventory src/app/(app)/inventory/register src/lib/worklist.test.ts
git commit -m "feat(register): one-screen Register tab -- category cards, model combobox that sets the type, quantity stepper, required IT serial (Enter never submits), Where does it go with the live actual-size label; lands on Labels (?just=)"
```

---

### Task 7: Register tab, part 2: purchase and warranty with documents and the live total

**Files:**
- Create: `src/components/inventory/purchase-section.tsx`, `src/components/inventory/document-slots.tsx`
- Modify: `src/components/inventory/register-form.tsx`, replacing the temporary procurement block.
- Delete: nothing. `register-documents.tsx` stays for the asset Documents tab if anything else imports it; `grep -rn "register-documents\"" src` decides, and an unused file is deleted.

**Interfaces:**
- Consumes: `moneyToCentavos`, `purchaseTotal`, `formatPeso`, `centavosToDecimalString`, `WARRANTY_LENGTHS`, `warrantyUntilFrom`, `WARRANTY_COVERED_BY(_LABEL)` (Task 2); `DOCUMENT_KINDS` (Task 2).
- Produces:
  - `PurchaseSection` props:

```ts
{
  open: boolean; onOpen(v: boolean): void; single: boolean; quantity: number;
  requests: Array<{ id: string; label: string; vendorId: string | null }>; requestId: string; onRequest(id: string): void;
  vendors: ComboOption[]; recentVendors: string[]; vendorId: string; onVendor(id: string | null): void;
  purchasedAt: string; onPurchased(v: string): void; invoiceRef: string; onInvoice(v: string): void; receiptRef: string; onReceipt(v: string): void;
  cost: string; onCost(v: string): void; fees: string; onFees(v: string): void;
  warrantyMonths: number; onWarrantyMonths(m: number): void; warrantyUntil: string; onWarrantyUntil(v: string): void;
  coveredBy: string; onCoveredBy(v: string): void; contact: string; onContact(v: string): void;
  prefix: string; onPrefix(v: string): void; prefixHint: string; prefixError?: string; notes: string; onNotes(v: string): void;
  slots: SlotFiles; onSlots(next: SlotFiles): void; errors: Record<string, string>;
}
```

  - `export type SlotKind = "invoice" | "official-receipt" | "warranty-slip" | "delivery-receipt"`.
  - `export interface SlotFiles { invoice: File | null; "official-receipt": File | null; "warranty-slip": File | null; "delivery-receipt": File | null; other: File[] }`.
  - The Register form's DOM contract (e2e):
    - the header button is named "Purchase and warranty", with `aria-expanded`;
    - the fields are labelled Vendor, Purchase date, Purchase request, Invoice no., Official receipt (OR) no., Cost per unit (₱) (or "Cost (₱)" when single), Delivery and fees (₱), Warranty until, Covered by, Who to call for repairs, Tag prefix, Notes;
    - the warranty length buttons are named "None", "6 mo", "1 yr", "2 yr", "3 yr";
    - the summary total sits in an element with `data-testid="purchase-total"`;
    - each document slot has a file input labelled "Sales invoice", "Official receipt", "Warranty slip", "Delivery receipt", or "Another file".

- [ ] **Step 1: `purchase-section.tsx`**

- A header `<button aria-expanded>` with:
  - the `sec` title "Purchase and warranty";
  - "optional";
  - when closed, a summary line joining vendor name, total (if > 0), `warranty to {date}` (if set), and `N files` (if any) with " · ";
  - a chevron.
- When open, a grid `repeat(auto-fit,minmax(300px,1fr)) gap-[18px]` of four `<fieldset>` boxes with `<legend>`:
  - **Purchase**: Vendor (`EntityCombobox`, today's), Purchase date (date), Purchase request (today's select), Invoice no., Official receipt (OR) no.
  - **Cost**: two ₱ inputs (`inputMode="decimal"`), normalised on blur with `moneyToCentavos`. `"bad"` shows `MONEY_ERROR` from `@/lib/register-input`. Below them, the summary box:
    - `{n} × {formatPeso(unit)}` and its subtotal;
    - `Delivery and fees` and its amount;
    - **Total** at 20px bold, `data-testid="purchase-total"`.
  - **Warranty**: five length buttons (`aria-pressed`); Warranty until (date); Covered by (select over `WARRANTY_COVERED_BY`, with a blank "—"); Who to call for repairs.
  - **Documents**: `<DocumentSlots>`.
- Under the grid, a `<details>` titled "Tag prefix and notes" holds today's Prefix input (2 letters) and the Notes textarea.

Rules (Review Focus 4):
- Picking a length when a purchase date exists sets `warrantyUntil = warrantyUntilFrom(purchasedAt, m)` and clears a "manual" flag.
- Typing in Warranty until sets the flag. While it is set, a later change of date or length does not overwrite the typed value.
- Changing the purchase date when the flag is unset re-derives the date.
- The first purchase date entered with no length chosen selects **1 yr**, which is today's 12-month default.

- [ ] **Step 2: `document-slots.tsx`**

- Four rows, one per slot. Each row has an icon, a title, a hint, and either "Upload" (a `FileDrop` or a hidden `<input type="file" accept="application/pdf,image/png,image/jpeg">` with the slot's label) or, when a file is chosen, the file name in green with a "Remove" button (`aria-label="Remove {title}"`).
- The hints are:
  - "Not uploaded yet" for the invoice and official receipt;
  - "A photo of the warranty card is fine";
  - "The signed delivery receipt".
- Then "+ Another file", which appends to `other`.
- A file over 10 MB, or of another type, is refused on choose with "PDF, PNG or JPG up to 10 MB", the same limits as `src/server/uploads.ts`.
- The caption reads "Saved on every unit in this batch." when not single.

- [ ] **Step 3: Wire it into `register-form.tsx`**

- Replace the temporary block with `<PurchaseSection …>`.
- New state: `receiptRef`, `fees`, `warrantyMonths`, `warrantyManual`, `coveredBy`, `contact`, `slots: SlotFiles`, and `purchaseOpen` (default `false`).
- Submit:
  - money: `moneyToCentavos(cost)` and `moneyToCentavos(fees)`; `"bad"` → refuse `{ cost | fees: MONEY_ERROR }`;
  - send `cost: unit === null ? "" : centavosToDecimalString(unit)`, the same for `fees`, plus `receiptRef`, `warrantyCoveredBy: coveredBy`, `warrantyContact: contact`.
- Uploads after create:
  - for single, one `uploadDocument` per present slot with `kind` = the slot kind, and each `other` file with kind `"other"`;
  - for a batch, one `uploadBatchDocument` per present slot.
  - Failures keep today's routing: single → `/inventory/{id}/documents?failed=`; batch → `/inventory/labels?just=…&docsFailed=N`, which the Labels page shows as an attention banner "N documents did not attach — add them from each item's Documents tab."
- `startAnother` also clears `fees`, `slots`, `receiptRef` and `contact`. It keeps vendor, dates, invoice, warranty, covered-by and request, as today keeps vendor and dates.

- [ ] **Step 4: Checks and commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.

```bash
git add -A src/components/inventory
git commit -m "feat(register): Purchase and warranty -- vendor, dates, request, invoice and OR nos., cost per unit and fees with a live total, warranty length/until/covered by/contact, four document slots plus extras; prefix and notes fold-out"
```

---

### Task 8: The Labels tab

**Files:**
- Modify: `src/app/(app)/inventory/labels/page.tsx` (rewrite), `src/components/inventory/tags-box.tsx`
- Create: `src/components/inventory/label-queue-form.tsx`, `src/components/inventory/print-labels-button.tsx`

**Interfaces:**
- Consumes: `labelQueue`, `queueCount`, `markLabelsPrinted` (Task 4); `whenLabel` (Task 2); `LabelSheet` with `startHref` and the `category` rows (Task 5); `NewEquipmentTabs` (Task 5).
- Produces:
  - Query params: `pick` (repeatable record ids), `just` (one record id, pre-ticked), plus today's `ids`, `tags`, `start`, `cls` and `docsFailed`.
  - DOM contract (e2e):
    - heading "New equipment" and the tab link "Labels" with `aria-current="page"`;
    - section heading "Waiting to print";
    - each queue row is a checkbox labelled by its title plus range (e.g. "3 × ThinkPad T14 Gen 4 BR-LT-0201 → BR-LT-0203");
    - the submit button "Make sheet";
    - stepper buttons "Earlier sticker" / "Later sticker" around the current start;
    - sheet slot links named `Start at sticker N`;
    - the summary line, e.g. "3 labels on 1 sheet, starting at sticker 4";
    - the primary button `Print N labels`, plus `Register more`;
    - "Reprint other tags" above today's Tags box (the textarea keeps the label **Tags**).

- [ ] **Step 1: `print-labels-button.tsx` (client)**

```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markLabelsPrinted } from "@/server/modules/inventory/label-actions";

/**
 * Phase 34 (spec §5): opens the browser print, then stamps the queue's labels as printed. Tags from
 * the Reprint box are not sent (they were printed before); a reprint never moves labelPrintedAt.
 */
export function PrintLabelsButton({ count, queuedAssetIds }: { count: number; queuedAssetIds: string[] }) {
  const [pending, start] = useTransition();
  function print() {
    const mark = () => {
      window.removeEventListener("afterprint", mark);
      if (queuedAssetIds.length) start(async () => { await markLabelsPrinted({ assetIds: queuedAssetIds.slice(0, 200) }); });
    };
    window.addEventListener("afterprint", mark);
    window.print();
    // Browsers without afterprint (or a headless test) still mark: print() is synchronous where afterprint is missing.
    if (!("onafterprint" in window)) mark();
  }
  return (
    <Button variant="primary" className="print:hidden" onClick={print} loading={pending} disabled={count === 0}>
      {`Print ${count} label${count === 1 ? "" : "s"}`}
    </Button>
  );
}
```

- [ ] **Step 2: `label-queue-form.tsx` (server component)**

- A `<form method="get" action="/inventory/labels">` holding:
  - the hidden `cls` (Purchasing only) and `start`, plus today's `ids` and `tags` passed through as hidden inputs;
  - `<h2>Waiting to print</h2>` and "Tick what goes on this sheet.";
  - a bordered list with one `<label>` per group: a checkbox `name="pick" value={recordId ?? key}` with `defaultChecked` when the id is in `picked` or equals `just`, the title (bold), the range (mono), and `whenLabel(createdAt, now)`;
  - "Show older" (a link adding `&older=1`) when `more`;
  - the button "Make sheet".
- With an empty queue it shows "Nothing waiting. Everything registered has had its label printed." and still renders the button for the reprint path.

- [ ] **Step 3: Rewrite `labels/page.tsx`**

- Keep: guards, `manageable`, the crumb inference (now ending in `{ label: "Labels" }`), the `BULK_MAX` refusal, the `tags` / `ids` resolution and the skipped line, the QR banner, and the "Before you print" banner.
- Add:
  1. `const queue = await labelQueue(manageable, sp.older ? 500 : 50)` and `waiting = await queueCount(manageable)`.
  2. `picked`: the `pick` params, plus `just` when present. Queue rows map by `recordId ?? key`. `queuedRows` are the assets of the picked groups, in group order then tag order.
  3. The sheet rows are `[...queuedRows, ...idsRows, ...tagRows]`, de-duplicated by tag. `LabelRow` carries `category`: extend both selects with `category: { select: { name: true } }`, and select it for queued assets too.
  4. Layout:
     - `PageHeader title="New equipment"` (breadcrumb `… › Labels`), then `<NewEquipmentTabs active="labels" cls={cls} waiting={waiting} />`;
     - a `docsFailed` attention banner when present;
     - a `just` success banner "{N} {noun} registered — their labels are ticked below." (`N` = the just group's size; the noun via `categoryNoun` of the first asset's category);
     - then a two-column flex-wrap:
       - **left**: `<LabelQueueForm …/>`, the start stepper (two links `Earlier sticker` / `Later sticker` changing `start` while keeping every other param), the summary line, `<PrintLabelsButton count={rows.length} queuedAssetIds={queuedRows.map(r => r.id)} />`, `<ButtonLink href="/inventory/register…">Register more</ButtonLink>`, then `<h2>Reprint other tags</h2>` and `<TagsBox mode="tags" …>`;
       - **right**: `<div className="label-preview" style={{ "--sheets": sheetCount }}><LabelSheet rows={rows} baseUrl={…} startAt={start} startHref={(n) => hrefWith({ start: n })} /></div>` with the caption "A4 · 3 × 4 stickers · about half size".
     - `hrefWith(patch)` rebuilds the current query string with `URLSearchParams` (repeating `pick`).
  5. When there are no rows at all (nothing picked, no ids, no tags), keep the left column with the queue and the Tags box. The right column shows the empty sheet (12 free numbered slots), and Print is disabled.
- `tags-box.tsx`: no API change. Its button stays "Make sheet" and its start field "Start at label". The page passes the same `start`.

- [ ] **Step 4: Checks**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.

Then (foreground, port check first):
`E2E_PORT=3100 npx playwright test e2e/labels.spec.ts --workers=1 --global-timeout=540000`

Expected: all pass, except these pins, which change in Task 11:
- the old "Print labels" heading and `Print` button names;
- tests that expect "Nothing to print".

Note each failure and its line in the task report. Do not fix specs here.

- [ ] **Step 5: Commit**

```bash
git add -A "src/app/(app)/inventory/labels" src/components/inventory/label-queue-form.tsx src/components/inventory/print-labels-button.tsx src/components/inventory/tags-box.tsx
git commit -m "feat(labels): Labels tab -- Waiting to print queue (by batch, ?pick=/?just=), start sticker stepper and clickable sheet slots, half-size preview of the real sheet, Print N labels marks the queue printed, Reprint other tags"
```

---

### Task 9: New e2e spec `e2e/register-labels.spec.ts`

**Files:**
- Create: `e2e/register-labels.spec.ts`

**Interfaces:** consumes the DOM contracts from Tasks 6, 7 and 8 verbatim.

- [ ] **Step 1: Write the spec**

House shape:
- copy `login`, `expectNoSeriousAxe` and `waitForHydration` from `e2e/queues-records-ux.spec.ts:62-85`, since specs never import across files;
- `test.beforeAll(() => execSync("npm run db:seed", { timeout: 120_000 }))`;
- `const db = new PrismaClient()`, with `afterAll` disconnect;
- each case `test.setTimeout(120_000)`;
- tags created by a case are new BR tags. Assets created through the UI stay (the seed in `beforeAll` resets).

Helper, local to the file:

```ts
async function openRegister(page: Page, cls?: "PURCHASING") {
  await page.goto("/inventory/register" + (cls ? "?cls=PURCHASING" : ""));
  await expect(page.getByRole("heading", { name: "New equipment", level: 1 })).toBeVisible({ timeout: 20_000 });
  await waitForHydration(page.getByRole("button", { name: /^Laptop\b|^Vehicle\b/ }).first());
}
async function pickCategory(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}\\b`) }).click();
}
```

Cases (each `test("N. …")`):
1. **Cards.**
   - IT sees exactly 9 cards in order: Laptop, Workstation (PC), Monitor, Headset, Mouse, Type C Hub, Docking Station, Laptop Bag, Other.
   - No "Uncategorised" button, and no "Phone" or "Peripheral".
   - The Laptop card shows "in stock".
   - Axe passes on the bare page.
2. **Known model sets its type.**
   - Laptop, then type "thinkpad t14 gen 4" (lower case).
   - The listbox option "ThinkPad T14 Gen 4" is visible; pick it.
   - Then "Type: ThinkPad — set by this model" shows, and the "New model — which type?" select has count 0.
3. **The one-unit serial is required; a scanner's Enter does not submit** (Review Focus 2).
   - Laptop, model "ThinkPad T14 Gen 4", focus Serial number, press Enter.
   - Expect still on `/inventory/register`, and no asset whose model is "ThinkPad T14 Gen 4" was created after the case started (`db.asset.count({ where: { createdAt: { gte: t0 } } })` is 0).
   - Click "Register 1 laptop".
   - Expect "Enter the serial number before you register." visible, the URL unchanged, and the asset count still 0.
4. **A new model asks for its type.**
   - Mouse, type "Logitech M720 Triathlon", pick `+ Add "Logitech M720 Triathlon" as a new model`.
   - The select "New model — which type?" appears; choose "Wireless".
   - Serial "E2E-M720-1", Spare stock, Register 1 mouse.
   - Lands on `/inventory/labels?just=`. The DB asset's `typeId` is Mouse/Wireless, with `purchaseRecordId` not null and `labelPrintedAt` null.
5. **A batch of 3 by paste-fill, with a duplicate flagged, then fixed.**
   - Monitor, model "Dell P2422H", How many 3.
   - Paste "CN1\r\nCN2\r\nCN2\r\n" into Serial 1.
   - Expect row 3 to read "duplicate", and "Register 3 monitors" to be refused.
   - Fix Serial 3 to "CN3" and register.
   - 3 assets exist, all with the same `purchaseRecordId`. One `purchase.recorded` audit row exists on that record with `quantity.to === 3`.
6. **Give to someone (IT direct).**
   - Laptop, known model, serial, "Give to someone", Who → pick EMP-0042's name.
   - Register; the asset is DEPLOYED to that employee.
7. **Approval path.**
   - As purchasing@ on `?cls=PURCHASING`: Vehicle, model "Toyota Vios 1.3 E", "In use", Who → an employee, no serial.
   - Register succeeds, because the serial is optional for Purchasing.
   - The asset is STORED, and an open `lifecycle_assign` approval exists for it.
   - In `finally`, close the approval by state (P-18 pattern).
8. **Purchase details, documents and the total.**
   - Laptop, 2 units, serials; open "Purchase and warranty".
   - Vendor (the first seeded vendor), Purchase date 2026-10-12, Invoice "SI-E2E-1", OR "OR-E2E-1", Cost per unit "68,500", Delivery and fees "500".
   - Expect `purchase-total` "₱137,500.00".
   - Click "2 yr"; Warranty until reads 2028-10-12. Covered by "Manufacturer", Who to call "Lenovo PH".
   - Upload a PDF to "Sales invoice" and a PNG to "Warranty slip".
   - Register. Both assets have:
     - `cost` 68500, `invoiceRef`, `receiptRef`, `warrantyUntil` 2028-10-12, `warrantyCoveredBy` "manufacturer";
     - two `AssetDocument` rows each, kinds `invoice` and `warranty-slip`.
   - The record has `fees` 500 and `quantity` 2.
9. **Register lands on Labels with the batch ticked; start at sticker 4 by clicking.**
   - After a 2-unit register: the heading "New equipment", the tab "Labels" with `aria-current="page"`, and the batch checkbox checked.
   - The summary reads "2 labels on 1 sheet, starting at sticker 1".
   - Click the link "Start at sticker 4". The URL has `start=4`, `.label-page` holds 3 `[data-blank-label]`, and the summary says "starting at sticker 4".
   - Axe passes.
10. **Print marks the batch printed; a reprint does not move the stamp** (Review Focus 5).
    - On the case 9 sheet: `page.evaluate(() => { window.print = () => {}; })`, then click "Print 2 labels". Expect the two assets' `labelPrintedAt` not null (poll with `toPass`).
    - Reload `/inventory/labels`: the queue no longer lists the batch.
    - Read the stamp, then `goto /inventory/labels?tags=<one tag>`, print again, and assert `labelPrintedAt` is unchanged.
11. **Reprint other tags.** Fill **Tags** with "BR-LT-0148", "Make sheet", and expect `getByLabel("Barcode BR-LT-0148")` count 1.
12. **Register and add another** keeps the category and model; serials clear; the toast reads "Registered 1 asset".
13. **The live label preview** shows the typed model and the next tag (`BR-LT-…`) beside the serial, inside the figure captioned "Your label, actual size".
14. **Purchasing card set.** As purchasing@ on `?cls=PURCHASING`, the cards are Building, Furniture, Pantry Equipment, Vehicle, in name order. The serial section is titled "Serial number (optional)".

- [ ] **Step 2: Run it**

Foreground, port check first:
`E2E_PORT=3100 npx playwright test e2e/register-labels.spec.ts --workers=1 --global-timeout=540000`
Expected: 14 passed. Fix product defects in the owning component; never weaken an assertion to pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/register-labels.spec.ts
git commit -m "test(e2e): Phase 34 register-labels -- cards, known/new model types, required serial and scanner Enter, paste-fill duplicates, assign and approval paths, purchase/warranty/documents/total, Labels queue, start sticker, print stamps once, reprint, axe"
```

---

### Task 10: Adapt existing e2e, group A (register-form flows)

**Files (modify):**
- `e2e/registration.spec.ts`
- `e2e/receiving.spec.ts`
- `e2e/inventory-ux.spec.ts`
- `e2e/it-core.spec.ts`
- `e2e/it-gaps.spec.ts`
- `e2e/asset-classes.spec.ts`
- `e2e/department-owned.spec.ts`
- `e2e/direct-lifecycle.spec.ts`
- `e2e/purchasing-ext.spec.ts`

**The mechanical mapping.** Apply it in every file and keep each test's intent. Each file copies two local helpers, never imported:

```ts
async function pickCategory(page: Page, name: string) {
  const card = page.getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}\\b`) });
  await waitForHydration(card);
  await card.click();
}
async function pickModel(page: Page, model: string) {
  const input = page.getByRole("combobox", { name: "Model" });
  await input.fill(model);
  const known = page.getByRole("option", { name: new RegExp(`^${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) });
  if (await known.count()) await known.first().click();
  else await page.getByRole("option", { name: `+ Add "${model}" as a new model` }).click();
}
```

| Old | New |
|---|---|
| `getByLabel("Category").selectOption({ label: X })` | `pickCategory(page, X)` |
| `getByLabel("Type").selectOption({ label: T })` | after `pickModel` of a new model: `getByLabel("New model — which type?").selectOption({ label: T })`; for a known model, assert the "Type: T — set by this model" line instead |
| `getByLabel("Model").fill(M)` | `pickModel(page, M)` |
| `getByLabel("Quantity").fill(n)` | `getByLabel("How many").fill(n)` |
| `getByLabel("Category").locator("option").allTextContents()` | `page.getByRole("group", { name: "What" }).getByRole("button").allTextContents()`, compared with `toContain` / `not.toContain` on the names |
| `optgroup` count checks (asset-classes 490, 497) | the admin view shows both classes' cards: assert that "Laptop" and "Vehicle" buttons both exist (490), and only Vehicle-class cards on `?cls=PURCHASING` (497) |
| `"Register 1 asset"` / `"Register N assets"` buttons | `"Register 1 laptop"` / `"Register N laptops"` (the noun of the category used) |
| heading `"Register assets"` level 1 | `"New equipment"`; the nav and list link "Register assets" keep their name |
| an IT single register with no serial | add `getByLabel("Serial number").fill("E2E-<spec>-<n>")`, with a unique value per case |
| batch IT registers without serials | fill each `Serial {i}` (`getByLabel("Serial 1")` …) |
| expectations of the in-place RegisterSuccess (`receiving.spec` ~138, `registration.spec` 196 "Print labels" link with `ids=`) | `await page.waitForURL(/\/inventory\/labels\?just=/)`, then assert the batch checkbox is checked and `Print N labels` is visible. Where the old test asserted `&cls=PURCHASING` on the link, assert it on the URL. |
| inventory-ux 9 ("lands on the record with Print label and Register another") | lands on Labels: the tab "Labels" is `aria-current="page"`, then follow the queue row's tag link — or assert `just=` in the URL plus the asset's status TEMPORARY in the DB |
| inventory-ux 11 ("focuses Category") | "focuses the first card": `expect(page.getByRole("group", { name: "What" }).getByRole("button").first()).toBeFocused()` after a refused submit with no category. Task 6's `refuse` must focus the first card when `categoryId` is the first error; check that it does, and fix in the component if not. |
| registration.spec documents (`"Documents"` FileDrop, per-file kind select) | single: `getByLabel("Sales invoice").setInputFiles(...)`, and assert the DB kind `invoice`; batch: `getByLabel("Sales invoice")` (was "Invoice document"), still attached to every unit |
| purchasing-ext "Purchase request" select | unchanged label, but it sits inside "Purchase and warranty": click `getByRole("button", { name: /^Purchase and warranty/ })` first |
| `"Cost (₱)"` | single: "Cost (₱)"; batch: "Cost per unit (₱)" (inside the Purchase section) |

- [ ] **Step 1: Apply the mapping file by file.** After each file, run it on its own (foreground, port check first):
`E2E_PORT=3100 npx playwright test e2e/<file> --workers=1 --global-timeout=540000`
Expected: green before moving on. A failure that is a product defect is fixed in the product and named in the report.

- [ ] **Step 2: Commit**

```bash
git add e2e/registration.spec.ts e2e/receiving.spec.ts e2e/inventory-ux.spec.ts e2e/it-core.spec.ts e2e/it-gaps.spec.ts e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/direct-lifecycle.spec.ts e2e/purchasing-ext.spec.ts
git commit -m "test(e2e): adapt the register flows to Phase 34 -- category cards, model combobox, How many, required IT serials, Register N {noun}, landing on Labels"
```

---

### Task 11: Adapt existing e2e, group B (labels, seed names, fixtures)

**Files (modify):**
- `e2e/labels.spec.ts`
- `e2e/queues-records-ux.spec.ts` (cases 8-10)
- `e2e/axe-sweep.spec.ts` (if it pins labels-page text)
- `e2e/fixtures/make.ts` (lines 134-135)
- `e2e/import-export.spec.ts` (comment lines 31-32, plus any category-name assertion)
- `e2e/holds.spec.ts`, `e2e/it-gaps.spec.ts`, `e2e/employee-ux.spec.ts`: only where they name the Phone or Dock **category**. Slot names like "phone slot", tags and models are unchanged by the seed.

**Mapping:**
- Labels page:
  - the heading "Print labels" → "New equipment" with the "Labels" tab;
  - the `PageHeader` "Print" button → `Print N labels`;
  - "Nothing to print" → the queue's empty line "Nothing waiting. Everything registered has had its label printed." (only when the queue is empty, which it is after the seed backfill);
  - the crumb's last item "Print labels" → "Labels".
- `queues-records-ux` case 9: "Start at label" (TagsBox) still exists and still works. Keep it, and add nothing.
- `fixtures/make.ts`:
  - `categoryName: "Dock"` → `"Docking Station"`;
  - `categoryName: "Phone", typeName: "iPhone"` → `categoryName: "Other", typeName: "Phone"`.
- `import-export` comment: the category list becomes "Laptop, Workstation (PC), Monitor, Headset, Mouse, Type C Hub, Docking Station, Laptop Bag, Other, Uncategorised". Update any count assertion that depends on the number of categories.

- [ ] **Step 1: Apply and run each file** (foreground, as in Task 10). Expected: green.
- [ ] **Step 2: Commit**

```bash
git add e2e/labels.spec.ts e2e/queues-records-ux.spec.ts e2e/axe-sweep.spec.ts e2e/fixtures/make.ts e2e/import-export.spec.ts e2e/holds.spec.ts e2e/it-gaps.spec.ts e2e/employee-ux.spec.ts
git commit -m "test(e2e): adapt labels pins to the Labels tab and the fixtures to the Phase 34 category names"
```

(Add only the files actually changed.)

---

### Task 12: Battery and docs (after the final review's fix wave)

**Files:**
- Modify: `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, the spec's Status line, and this plan's D-block.

- [ ] **Step 1: The seven-chunk battery on the final tree**

Use the current seven from `docs/HANDOVER.md` §0 item 9. `e2e/register-labels.spec.ts` joins **chunk B**. Chunks D, E1 and F run as two foreground halves when the machine is slow (Phase 33's R6/R7). Then:

- `npx playwright test --list | tail -1` → expected `459 tests in 44 files` (445 + 14 new). If the count differs, explain the difference in the report.
- `npx vitest run`, `npx tsc --noEmit`, `npm run lint` → green.
- `npx prisma migrate status` → 27 migrations, up to date.
- `npm run db:seed` runs **last**. Port 3100 is free before, between and after every run.

- [ ] **Step 2: Docs addendum**

Use the CRLF-safe Python helper, with each anchor asserted to occur exactly once:
- **HANDOVER:** status prefix on line 3; a new **(aa)** block before (z); chunk B gains `e2e/register-labels.spec.ts`.
- **PICKUP:** the branch row; a new battery row; §4 item 1.
- **HANDOVER-PENDING:** a Phase 34 paragraph.
- **The spec's Status line.**
- **This plan's D-block.**

Each record says: code-complete, unmerged and unpushed, **migration 27**, and that the staging redeploy applies a migration. The staging redeploy is a separate decision.

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOVER.md docs/PICKUP.md docs/HANDOVER-PENDING.md docs/superpowers/specs/2026-10-14-register-and-labels-redesign-design.md docs/superpowers/plans/2026-10-14-phase-34-register-labels-redesign.md
git commit -m "docs(handover,pickup,pending,plan,spec): Phase 34 code-complete -- battery, migration 27, (aa) block, D-block"
```

---

## D-block (decisions made during execution)

(Filled in during execution: each ruling as `D-n — what — why — cost if wrong`.)
