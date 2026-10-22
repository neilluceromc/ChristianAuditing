# Purchase Order Form Redesign (A3) and Vendor Wording: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rebuild the New and Edit purchase order form as the owner's mockup A3, and rename "Supplier" to "Vendor" across the UI. A3 has:
- a section rail with progress;
- vendor, invoice and payment cards;
- item cards with units;
- creating a category on the spot;
- four document slots saved with the PO;
- typed invoice totals with checks.

**Architecture:**
- **Pure rules** in `src/lib`: totals check, units, paid-by, and the PO-only money fields.
- **Migration 39:** new PO columns, line unit, category confirmation, document supersede, and a partial unique index on the PO number.
- **Server actions** in `src/server/modules/purchases/`:
  - a multipart save that stores files, then writes the PO and its documents in one transaction;
  - category create and confirm actions.
- **UI** under `src/components/purchases/po-form/`, built on the existing `EntityCombobox` (extended) and the house cards.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6, Tailwind v4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-22-po-form-redesign-design.md` (binding). **Mockup:** claude.ai artifact `1p5iEzQu1s3rZ3jDXc8n5Y`, board `A3.dc.html`. Its layout, copy and behaviour are the visual reference. Read it with the Artifact tool's read action, `path: "project/A3.dc.html"`.

## Global Constraints

**Copy**
- "Supplier" becomes "Vendor" in UI copy only. Routes (`/purchases/suppliers`), identifiers and database names stay.
- The vendor's `registrationNo` is shown as **"VAT REG. TIN"**.
- Paid by: `CREDIT_CARD` → "Credit card", `DEBIT_CARD` → "Debit card". Nothing else.
- Units offered: `pc, box, set, pack, roll, m, unit`. Stored as free text, 1–12 characters; the default is `pc`.

**Totals**
- The totals are typed, never computed. The seven keys, in order: `totalSales`, `lessVat`, `netOfVat`, `discount`, `amountDue`, `addVat`, `totalAmountDue`.
- The checks use ±₱0.01, with a blank discount counting as 0:
  - total sales = Σ qty × unit price;
  - net of VAT = total sales − less VAT;
  - amount due = net of VAT − discount;
  - total amount due = amount due + add VAT.
- The result is stored as `totalsConsistent`. It never blocks a save.

**Required fields**
- **New POs** (`formV2 = true`): vendor, `poNumber`, SI number (`invoiceRef`), invoice date (`purchasedAt`), `paidBy`, at least one line, and on every line a category, qty ≥ 1 and a unit price; `totalAmountDue`; and a sales invoice (`kind "invoice"`) attached.
- **Legacy POs** (`formV2 = false`): the new fields stay optional, but are validated when filled in.

**PO number**
- Trimmed, 1–40 characters.
- Unique case-insensitively among POs that aren't CANCELLED.
- Refusal: `PO 2025-0418 is already used on PO-0212`.

**Documents**
- Append-only. Replace adds a new row; Remove sets `supersededAt`. Nothing is deleted.
- Limits stay as in `src/lib/upload-meta.ts`: 4 MB; pdf, png, jpg.

**Categories**
- New IT categories from a PO get `confirmedAt = null`; office ones are confirmed immediately.
- Unconfirmed categories are usable on PO forms and PO register only.
- A same-class name match, case-insensitive, reuses the existing category.
- An other-class match is refused: `'Network cable' already exists as an Office item — pick it from the list.`

**Audit and notifications**
- New audit codes, each registered in `AUDIT_ACTIONS`, `ACTION_LABELS` and `auditSentence`: `category.create`, `category.confirm`, `category.replace`, `document.superseded`.
- `source: "web"` on every write.

**Process (unchanged house rules)**
- Hand-written migration `prisma/migrations/20261023090000_po_form_fields/migration.sql`.
- Never `prisma migrate dev`, `reset`, `format` or `db push`; never `next build`.
- Never read `.env`.
- Git: never `stash`, `checkout`, `restore`, `reset`, `switch`, `amend`, `rebase`, `merge`, `pull` or `push`.
- CRLF files keep CRLF.
- Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Browser tests run only in Task 9: dev server on :3100, `--workers=1`, foreground chunks of 4 files or fewer, reseed first and last.

## Review Focus

1. **The same PO number typed with different spacing or case**, e.g. `" 2025-0418"` vs `"2025-0418 "` vs `"2025-0418"`. It is refused as already used, not saved twice. *Test in Task 2.*
2. **Save fails after the files were stored**, e.g. a validation or unique-index error inside the transaction. No PO and no document rows remain, the stored files are removed, and saving again works. *Test in Task 2.*
3. **Totals typed with thousands separators**, e.g. `"9,100.00"`. They parse to 9100, and the check passes against a line of 1 × `"9,100.00"`. *Test in Task 1.*
4. **Creating "network cable" when "Network Cable" already exists:** in the same class it reuses the existing category with no duplicate; in the other class it is refused with the exact message. *Test in Task 3.*
5. **A legacy PO sent back and edited without the new fields** (no PO number, paid by or invoice document) saves. Once a PO number is typed, it is validated and checked for uniqueness. *Test in Task 2.*

---

### Task 1: Migration 39 and pure rules

**Files:**
- Modify: `prisma/schema.prisma`
- Create:
  - `prisma/migrations/20261023090000_po_form_fields/migration.sql`
  - `src/lib/po-totals.ts` + test
  - `src/lib/po-units.ts` + test
- Modify: `src/lib/intake-rules.ts` + test, `src/lib/po-flow.ts` (labels), `prisma/purchase-orders-migration.test.ts` (or a new `prisma/po-form-migration.test.ts`)

**Interfaces (Produces):**
- **Schema:**
  - `enum PaidBy { CREDIT_CARD DEBIT_CARD }`.
  - `PurchaseOrder` gains:
    - `poNumber String?`, `paidBy PaidBy?`;
    - `totalSales`, `lessVat`, `netOfVat`, `discount`, `amountDue`, `addVat`, `totalAmountDue`, all `Decimal? @db.Decimal(12,2)`;
    - `totalsConsistent Boolean?`, `formV2 Boolean @default(false)`.
  - `PurchaseOrderLine` gains `unit String @default("pc") @db.VarChar(12)`.
  - `AssetCategory` gains `confirmedAt DateTime?` and `createdById String?` (FK `User`, `SetNull`).
  - `RequestDocument` gains `supersededAt DateTime?` and `supersededById String?`.
- **Migration SQL:**
  1. Create the enum and add the columns.
  2. `UPDATE "AssetCategory" SET "confirmedAt" = now()`.
  3. `CREATE UNIQUE INDEX "PurchaseRequest_poNumber_live_key" ON "PurchaseRequest"(lower(btrim("poNumber"))) WHERE "poNumber" IS NOT NULL AND "state" <> 'CANCELLED'`.
- **`src/lib/po-totals.ts`:**
  - `TOTAL_KEYS` (the seven keys, in order), `type TotalKey`, `TOTAL_LABEL: Record<TotalKey,string>`. The labels: "Total sales (VAT inclusive)", "Less: VAT", "Amount net of VAT", "Less: discount", "Amount due", "Add: VAT", "Total amount due".
  - `parseMoney(v: string | number | null | undefined): number | null` strips `,`, `₱` and spaces. Blank gives null; a non-number gives NaN.
  - `itemsTotal(lines: { qty: number|string; unitPrice: number|string|null }[]): number`.
  - `checkTotals(items: number, t: Partial<Record<TotalKey, number|null>>): { ok: boolean; problems: Partial<Record<TotalKey, string>> }`:
    - A problem attaches to the checked key (`totalSales`, `netOfVat`, `amountDue` or `totalAmountDue`).
    - Its text is "Items add up to ₱9,100.00.", "Total sales − VAT = ₱X.", "Net − discount = ₱X." or "Amount due + VAT = ₱X.".
    - A check whose inputs are blank is skipped.
    - `ok` requires `totalAmountDue` to be present.
- **`src/lib/po-units.ts`:** `PO_UNITS` and `unitSchema` (a zod string, trimmed, 1–12 characters, default `"pc"`).
- **`src/lib/intake-rules.ts`:**
  - `PO_MONEY_FIELDS = [...MONEY_FIELDS, "poNumber", "paidBy", ...TOTAL_KEYS] as const` and `type PoMoneyField`.
  - `canEditField` treats every `PoMoneyField` as a money field owned by PURCHASING.
  - `MONEY_FIELDS` itself is unchanged, so asset-level code is untouched.
- **`src/lib/po-flow.ts`:** `PAID_BY_LABEL: Record<"CREDIT_CARD"|"DEBIT_CARD", string>`.

- [ ] **Step 1: Write the failing tests.**
  - `po-totals.test.ts`:
    - **`the owner's invoice adds up`:** `itemsTotal([{qty:1,unitPrice:"9,100.00"}]) === 9100`, and `checkTotals(9100,{totalSales:9100,lessVat:975,netOfVat:8125,amountDue:8125,addVat:975,totalAmountDue:9100}).ok === true` (Review Focus 3).
    - `parseMoney("₱9,100.00") === 9100`.
    - Each of the four problems appears with its exact text when off by ₱1.
    - A blank discount counts as 0.
    - A missing `totalAmountDue` gives `ok === false`.
  - `po-units.test.ts`: the default is `pc`; 13 characters are refused.
  - `intake-rules.test.ts`: `canEditField("finance_staff","totalAmountDue","PURCHASING","with-finance")` is ok with a reason, and Purchasing at `"approved"` is refused for `"poNumber"`.
  - The migration text test asserts the partial unique index, the `confirmedAt` backfill and the `PaidBy` enum.
- [ ] **Step 2:** `npx vitest run src/lib/po-totals.test.ts src/lib/po-units.test.ts src/lib/intake-rules.test.ts prisma/` FAILS.
- [ ] **Step 3:** Implement. Run `npx prisma generate`, then `npx prisma migrate deploy` against the local dev DB. Expected: it applies `20261023090000_po_form_fields`, and `migrate status` reports up to date.
- [ ] **Step 4:** The same tests PASS. `npx tsc --noEmit` is clean.
- [ ] **Step 5: Commit** `feat(po): migration 39 — PO number, paid by, typed totals, line units, category confirmation, document supersede; totals check`.

### Task 2: Save with documents, PO number, totals and legacy rules (server)

**Files:**
- Modify: `src/server/modules/purchases/po-actions.ts` (`saveSchema`, `saveImpl`, `createPo`, `editPo`, `fixSchema`, `SEND_BACK_KEYS`, `closeLineShort`) + `po-actions.test.ts`
- Modify: `src/server/modules/purchases/document-actions.ts` (add `replacePoDocument`, `removePoDocument`) + test
- Modify: `src/server/modules/purchases/queries.ts` (`PurchaseDetail` gains the new fields)
- Modify: `src/lib/po-send-back.ts` (new keys)
- Create: `src/server/modules/purchases/po-files.ts` (store, then clean up)

**Interfaces:**
- **Consumes** Task 1: `TOTAL_KEYS`, `parseMoney`, `itemsTotal`, `checkTotals`, `unitSchema`, `PO_MONEY_FIELDS`, `canEditField`.
- **Produces:**
  - `savePurchaseOrder(input: FormData | unknown): Promise<ActionResult<{ id; refNo; state }>>`.
    - `FormData` carries a JSON field `payload`, the save object below, and files `doc:invoice`, `doc:official-receipt`, `doc:delivery-receipt` and `doc:warranty-slip`. Keep accepting a plain object (no files) for existing callers and tests.
    - **Save object:** `{ id?, vendorId, poNumber?, invoiceRef, receiptRef?, purchasedAt, paidBy?, departmentId?, lines: { id?, description, specs?, categoryId, qty, unit, unitPrice }[], totals: Partial<Record<TotalKey, string>>, reply? }`. `fees` is no longer accepted from the new form; leave it untouched on update.
    - **New POs** set `formV2 = true` and enforce the required fields in Global Constraints. A missing invoice is refused as `{ "doc:invoice": "Attach the sales invoice" }`.
    - `totalsConsistent` is set to `checkTotals(itemsTotal(lines), totals).ok`.
    - **Files:**
      - they are validated with `validateUpload` before anything is stored;
      - `po-files.ts` `storePoFiles(poIdHint, files): Promise<{ stored: StoredFile[]; cleanup(): Promise<void> }>` writes them;
      - the PO and its `requestDocument` rows are then written in one `$transaction`;
      - on any throw, `cleanup()` runs and the action returns the error.
    - **PO number uniqueness:** a P2002 on `PurchaseRequest_poNumber_live_key`, plus a pre-check, returns `{ poNumber: "PO 2025-0418 is already used on PO-0212" }`.
  - `replacePoDocument(formData {orderId, kind, file})` and `removePoDocument({ documentId })`. Replace adds a new row; Remove sets `supersededAt`/`supersededById` and audits `document.superseded`. Both use the same role and state rules as `uploadPoDocument`.
  - **Fix and send-back:**
    - `fixSchema` accepts the new `PO_MONEY_FIELDS` keys (`poNumber`, `paidBy`, the totals).
    - `SEND_BACK_KEYS` and `PO_SEND_BACK_FIELDS` gain `poNumber`, `paidBy` and `totals`, labelled "PO number", "Paid by" and "Invoice totals".
    - `fixPurchaseOrder` and `closeLineShort` recompute `totalsConsistent`.
  - **`PurchaseDetail`** gains `poNumber`, `paidBy`, `totals: Record<TotalKey, number|null>`, `totalsConsistent`, `formV2`, `units[].unit`, and `documents[]` showing only rows that aren't superseded, plus `supersededCount`.

- [ ] **Step 1: Write the failing tests** in `po-actions.test.ts` (in-memory fake, existing pattern):
  - **`a new PO needs every required field`:** each missing field gives its field error, and `"doc:invoice"` is required.
  - **`the owner's invoice saves READY→WITH_IT with totalsConsistent true`.**
  - **`totals that don't add up still save, with totalsConsistent false`.**
  - **`PO number duplicates are refused case- and space-insensitively`** (Review Focus 1).
  - **`a failure after storing files leaves nothing behind`** (Review Focus 2): force the transaction to throw, assert `cleanup` was called, no PO and no document rows, then a retry succeeds.
  - **`a legacy PO edits without the new fields`** (Review Focus 5).
  - **`fix can change totalAmountDue and recomputes totalsConsistent`.**
  - **`closeLineShort recomputes totalsConsistent`.**
  - **`remove supersedes, never deletes`.**
- [ ] **Step 2:** `npx vitest run src/server/modules/purchases` FAILS.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx vitest run` and `npx tsc --noEmit` are green.
- [ ] **Step 5: Commit** `feat(po): save with documents in one go; PO number, paid by and typed totals with a consistency check; legacy POs unchanged`.

### Task 3: Create a category from the PO form; IT confirms at Register

**Files:**
- Create: `src/server/modules/purchases/category-actions.ts` + test
- Modify:
  - `src/server/modules/purchases/po-register.ts` + test
  - `src/server/modules/inventory/register-queries.ts` (`registerCatalog`)
  - `src/app/(app)/inventory/[id]/edit/page.tsx`
  - `src/app/(app)/admin/asset-categories/page.tsx` and its row model
  - the audit registries
- Create: `src/server/modules/purchases/po-categories.ts` (the PO picker query)

**Interfaces:**
- **Produces:**
  - `createCategoryFromPo(input: { name: string; cls: "IT" | "PURCHASING" }): Promise<ActionResult<{ id; name; cls; confirmed: boolean; reused: boolean }>>`.
    - Roles: `purchasing_staff` and `admin`. The name is trimmed, 2–60 characters, with the first letter uppercased.
    - A same-class match, case-insensitive, gives `reused: true`. An other-class match is refused with the Global Constraints message.
    - IT categories get `confirmedAt: null`; PURCHASING ones get `confirmedAt: now`. `createdById` is set and `category.create` is audited.
  - `poCategories(): Promise<{ id; name; cls; confirmed: boolean }[]>` returns all categories, confirmed or not, sorted by class then name.
  - `registerCatalog` and the asset edit page exclude `confirmedAt: null`.
  - **`registerFromPurchaseOrder`'s line input gains `categoryAction?: "confirm" | { replaceWith: string }`.** It applies only when the line's category is unconfirmed and the line has nothing registered yet.
    - **confirm** sets `confirmedAt` and audits `category.confirm`.
    - **replace** must name a confirmed IT category. It moves the line, audits `category.replace`, deletes the old category if no other PO line uses it, and notifies PURCHASING with CHANGED: "IT changed the category on PO-0215 line 1 to Switch".
    - **With no action**, the first registration confirms the category implicitly.
  - The admin categories rows gain `unconfirmed: boolean`, rendered as a "New · from a PO" tag.

- [ ] **Step 1: Write the failing tests:**
  - **`create IT → unconfirmed, office → confirmed`.**
  - **`reuse same class, refuse other class`** (Review Focus 4, both cases, with the exact message).
  - **`viewer and IT can't create`.**
  - **`register confirms explicitly and implicitly`.**
  - **`replace moves the line, deletes the orphan, notifies Purchasing`.**
  - **`replace with an office category is refused`.**
  - **`registerCatalog hides unconfirmed`.**
- [ ] **Step 2:** `npx vitest run src/server/modules/purchases src/server/modules/inventory` FAILS.
- [ ] **Step 3:** Implement. Register the audit codes and labels.
- [ ] **Step 4:** Green, and `tsc` is clean.
- [ ] **Step 5: Commit** `feat(po): create a category from the PO form; IT confirms or replaces new IT categories at Register`.

### Task 4: Combobox extension

**Files:**
- Modify: `src/components/patterns/entity-combobox.tsx` + its test (create `entity-combobox.test.tsx` if missing)

**Interfaces (Produces):**
- `ComboOption` gains `icon?: ReactNode` (a leading badge, such as initials or a category mark) and `tag?: string` (a small trailing chip, such as "New").
- Grouped rendering: options with `group` render under a group heading. An optional `groupHint?: Record<string,string>` shows "→ IT checks" or "→ ready to register" on the right of the heading.
- `footer?: (query: string, close: () => void) => ReactNode`, rendered under the list. The category picker uses it for "Create 'X' as… IT gear / Office item".
- Existing callers are unchanged.
- Keyboard: type to filter, ↑/↓, Enter picks, Escape closes and returns focus. The footer is reachable by Tab.

- [ ] **Step 1: Write the failing tests:**
  - group headings and hints render;
  - the icon and tag render;
  - the footer receives the current query and `close`;
  - an existing caller's markup is unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, `tsc` and eslint clean.
- [ ] **Step 5: Commit** `feat(ui): combobox groups, icons, tags and a footer slot`.

### Task 5: The A3 form (without documents)

**Files:**
- Create in `src/components/purchases/po-form/`:
  - `po-form.tsx` (the shell, replacing `src/components/purchases/po-form.tsx`)
  - `section-rail.tsx`, `vendor-card.tsx`, `invoice-card.tsx`, `item-card.tsx`, `totals-card.tsx`
  - `po-form-model.ts` (pure: draft types, `sectionsDone`, `checklist`, `saveLabel`) + test
- Modify: `src/app/(app)/purchases/new/page.tsx` and `[id]/edit/page.tsx`. Load vendors with `registeredName`, `registrationNo` and `address`; `poCategories()`; departments with kind; loadouts.
- Delete: the old `src/components/purchases/po-form.tsx` once everything imports the new one.

**Behaviour:** follow A3 exactly.
- **Rail:** "On this page" with Vendor, Invoice & payment, Items, Documents and Totals. Each has a number, or a green tick when its `sectionsDone` key is true. The progress bar reads "N of 5 sections done". Links go to `#po-vendor`, `#po-invoice`, `#po-items`, `#po-docs` and `#po-totals`. At widths under 900px the rail sits above the form.
- **Vendor card:**
  - A combobox with the initials icon, the name, and a sub line "Infoworx Inc. · TIN 004-845-988-00004" (or "· no TIN on file"); plus "Add a new vendor" linking to `/purchases/suppliers/new`.
  - A read-only block with OWNED & OPERATED BY, VAT REG. TIN and ADDRESS. A missing TIN shows the amber "Not on file — add it from the invoice". An **Edit vendor** link.
- **Invoice & payment card:**
  - Purchase order number (required; `PO` prefix; hint "Your own number. It doesn't need to be on the invoice.");
  - SI number (`№` prefix);
  - Invoice date (hint "The date written on it, not today.");
  - OR number (optional);
  - Paid by: two radio cards, Credit card and Debit card;
  - For department: a combobox with a kind tag.
- **Item cards:**
  - Description (larger text) and specs.
  - A category combobox, grouped IT gear / Office & facilities with hints. Its footer creates the category through `createCategoryFromPo` and selects it. A new IT category shows the tag "New".
  - Qty with − and + buttons; a unit combobox over `PO_UNITS`; unit price with ₱; the amount; Duplicate and Remove.
  - The header chips read "N units to IT · N units to register". The footer shows "Add another item", "Add a policy loadout" (existing behaviour) and the items total.
  - Locked lines keep today's rules: a category can't change and qty can't go below registered plus closed short.
- **Totals card:**
  - The seven inputs plus TOTAL AMOUNT DUE (required).
  - Amber lines show the `checkTotals` problems.
  - A status box: "Type the total amount due from the invoice." / "The figures add up, and the items match total sales." / the amber "Some figures don't add up — check the highlighted lines against the invoice. You can still save if the invoice itself is off; Finance will see the note."
  - **When you save:** "N units of IT gear go to IT to check and register." and "N units are ready for you to register."
  - **Before you save:** purchase order number; vendor with a TIN; SI number and date; every item has a category; every item has a quantity and price; sales invoice attached (it reads false until Task 6); totals add up.
  - The Save button reads "Save and send to IT" or "Save and register". Cancel goes back.
- **The sent-back banner, ringed fields and reply textarea** keep today's behaviour, using the existing `ring` and `flagHint` keys plus the new ones.
- **Width:** works at 375px with no sideways page scroll.

- [ ] **Step 1: Write the failing tests:**
  - `po-form-model.test.ts`: `sectionsDone` is true or false per section from a draft; the `checklist` labels are in order; `saveLabel` is correct for IT and non-IT orders.
  - A render test of the shell: the rail lists 5 sections with links; the paid-by radios are present; no native `<select>` remains in the form.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run`, `tsc` and eslint are green.
- [ ] **Step 5: Commit** `feat(po): the A3 purchase order form — section rail, vendor and invoice cards, item cards with units and on-the-spot categories, typed totals`.

### Task 6: Documents in the form and on the PO page

**Files:**
- Create: `src/components/purchases/po-form/documents-card.tsx`
- Modify: `po-form.tsx` (submits `FormData` with the files) and `src/components/purchases/request-documents-card.tsx` (the PO detail page uses the same four slots plus "Other documents")

**Behaviour:**
- **Four slots:** Sales invoice ("Required", hint "The page with № {SI}."), Official receipt ("Add it when it arrives."), Delivery receipt ("If the supplier gave one." becomes "If the vendor gave one.") and Warranty slip ("Helps IT with repairs later.").
- **Empty slot:** a drop zone, also a real `<input type="file">` behind a label, accepting `.pdf,.png,.jpg,.jpeg`.
- **Filled slot:** a thumbnail (an image preview from an object URL for images, a PDF icon otherwise), the file name and size, and Preview / Replace / Remove.
- **In the form,** files are held in the browser and submitted with Save. "Sales invoice attached" in the checklist turns green when that slot is filled.
- **On the PO detail page,** the same slots use `replacePoDocument` and `removePoDocument`. "Other documents", the kinds quotation, purchase-order and other, keep today's upload table.

- [ ] **Step 1: Write the failing tests:**
  - slot rendering: required and optional tags, the accept attribute;
  - the model: the checklist's invoice item follows the slot;
  - the payload builder: `FormData` holds `payload` plus a file per filled slot.
- [ ] **Step 2–4:** FAIL, implement, PASS. `tsc` and eslint clean.
- [ ] **Step 5: Commit** `feat(po): document slots in the form and on the PO page; files save with the PO`.

### Task 7: Show the new fields: PO page, Finance review, Fix and Send-back dialogs

**Files:**
- Modify: `src/app/(app)/purchases/[id]/page.tsx`, `src/app/(app)/finance/review/[recordId]/page.tsx`, `src/server/modules/finance/groups.ts` (`money` gains `poNumber`, `paidBy`, `totals`, `totalsConsistent`)
- Modify: `src/components/purchases/fix-po-dialog.tsx`, `src/components/finance/fix-money-dialog.tsx`, `src/components/purchases/send-back-po-dialog.tsx`
- Create: `src/components/purchases/totals-ladder.tsx` (read-only ladder, shared) + test

**Behaviour:**
- **PO page "Purchase" card:** PO number, Vendor, SI number, OR number, Invoice date and Paid by. The lines table gains a Unit column.
- **The `TotalsLadder`** shows the seven figures in invoice order, with TOTAL AMOUNT DUE bold. When `totalsConsistent === false`, a "Totals didn't add up on the PO" note shows the `checkTotals` problems. Legacy POs with no totals show today's Fees and Total.
- **Finance group review:** the money card shows the same ladder and note for PO groups.
- **The Fix dialogs** can change PO number, Paid by and each total, using the same reason rule. Send-back offers "PO number", "Paid by" and "Invoice totals".

- [ ] **Step 1: Write the failing tests:**
  - `TotalsLadder`: order, bold total, and the note when inconsistent;
  - `groupDetail` returns the new money fields;
  - the fix dialog's CLAIMED keys include the new ones.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(po): PO page and Finance review show PO number, paid by, units and the typed totals; fix and send back the new fields`.

### Task 8: "Supplier" → "Vendor" and "VAT REG. TIN"

**Files:**
- Every UI-copy occurrence under `src/` listed in the file map: the `purchases/suppliers/**` pages, `src/components/suppliers/*`, `src/lib/workspaces.ts` nav labels, `page-titles.ts`, `palette.ts` and the command palette heading, `export-columns.ts` labels, `activity.ts` labels, `po-send-back.ts`, the `po-actions.ts` messages and `FIELD_WORDS`, `reason-chips.ts`, the stock and receive pages, `purchases-table.tsx`, and the home overview copy.
- Also `src/components/suppliers/supplier-form.tsx` and `purchases/suppliers/[id]/page.tsx`, where the "Registration no." label becomes "VAT REG. TIN".
- Keep import aliases. Add "vat reg tin" to `import-suppliers.ts`, which keeps accepting the old header names.
- Tests: update `workspaces.test.ts` and the others that pin the old copy. Create `src/lib/vendor-copy.test.ts`.

- [ ] **Step 1: Write the failing test.** `vendor-copy.test.ts` greps `src/app` and `src/components`, excluding tests, for `/\bsuppliers?\b/i` inside JSX text and string literals that are user-visible: labels, titles, placeholders, aria-labels, toast and error messages. It expects 0 matches; route paths like `/purchases/suppliers` and identifiers are excluded by pattern. It also asserts the nav has "Vendors", "All vendors", "New vendor" and "Import vendors", and that the vendor form has the "VAT REG. TIN" label.
- [ ] **Step 2:** FAIL. **Step 3:** Sweep. **Step 4:** `npx vitest run`, `tsc` and eslint are green.
- [ ] **Step 5: Commit** `feat(copy): Supplier is now Vendor across the app; Registration no. is VAT REG. TIN`.

### Task 9: Browser tests and docs (runs last)

**Files:**
- Create: `e2e/po-form.spec.ts`
- Repair: every spec using `getByLabel("Supplier")`, `Line N category`, "Add line", the fees field or the old form, plus "supplier" copy assertions (`suppliers.spec.ts`, `purchasing-ext`, `quick-forms`, `activity`, `stock`, `phase-46-home`, `stock-lots`, `phase-47-finance`, `po-intake`, `purchases`, `stocktake`, `axe-sweep`, `phase-42-sidebar`).
- Docs: `docs/HANDOVER.md` entry (aw) and the `docs/PICKUP.md` status lines.

**e2e cases** (Purchasing via the shared `login` helper):
1. Copy the owner's PCWORX invoice end to end:
   - vendor PCWORX, with the TIN shown;
   - PO number `2025-0418`, SI `44511`, date `2025-11-22`, Credit card;
   - 1 box "Belden Cat6 UTP cable, blue", specs "305 m";
   - category: type "Network cable", then create it as IT gear (the "New" tag shows);
   - ₱9,100.00;
   - totals 9,100.00 / 975.00 / 8,125.00 / – / 8,125.00 / 975.00 / 9,100.00 (the status box goes green);
   - attach a fixture PNG as the sales invoice;
   - Save: it lands on the PO page in With IT, with the ladder shown and IT's bell rung.
2. A duplicate PO number is refused with the exact message.
3. Totals off by ₱1 show the amber line and still save; the PO page shows "Totals didn't add up".
4. IT registers the line and confirms "Network cable"; the admin categories page no longer tags it "New".
5. Creating "network cable" again reuses the existing category; creating it as an Office item is refused.
6. The rail ticks sections and the progress text updates; clicking "Totals" scrolls to the totals card.
7. axe on the new form in light and dark, plus 375px with no sideways scroll.
8. The nav shows "Vendors"; the vendor page shows "VAT REG. TIN".

- [ ] **Step 1:** Reseed. Start the dev server on :3100 in the background with `CRIS_MODEL=fake`.
- [ ] **Step 2:** Run in chunks: the new spec first, then the repaired specs, then the full battery, in foreground chunks of 4 files or fewer with `--workers=1`.
- [ ] **Step 3:** Reseed again, stop the server, and confirm :3100 is free.
- [ ] **Step 4: Commits** `test(e2e): the A3 purchase order form, categories on the spot, Vendor wording` and `docs(handover): PO form redesign and Vendor wording (migration 39), code-complete`.
