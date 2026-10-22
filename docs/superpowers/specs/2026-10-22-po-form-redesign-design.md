# Purchase order form redesign (A3) and Vendor wording (design)

**Date:** 2026-10-22

**Status:** owner's choices in chat. Calls I made are marked **(my call)**.

**Mockup (binding for layout and behaviour):** the owner picked **A3 · Section rail with progress** on the canvas "New Purchase Order Redesign" (claude.ai artifact `1p5iEzQu1s3rZ3jDXc8n5Y`, board `A3.dc.html`). Boards A, A2 and A4 are context only.

## 1. Intent

The owner said the New purchase order form "feels cheap": plain native dropdowns, a cramped lines table, and no way to handle a category that isn't in the list. Purchasing copies POs from paper sales invoices, so the form should follow the invoice's own fields and order, and catch typos before IT and Finance see them.

**Success:**
- Purchasing can copy a real invoice (the owner's example: PCWORX, SI № 44511, 1 box of Belden Cat6 UTP cable, ₱9,100.00) top to bottom without guessing where anything goes.
- A missing category never blocks them.
- The totals they type are checked against the items before they save.

**Anti-goals:**
- The app calculating VAT for them. The owner was explicit: "we are also the one going to put the VAT or less VAT, discount, etc."
- Blocking a save because the paper invoice itself has an arithmetic quirk.
- Native `<select>` dropdowns on this form.

## 2. Owner decisions

1. **Layout: A3.** Left: a sticky **"On this page" rail** listing Vendor, Invoice & payment, Items, Documents, Totals. Each shows its step number, which becomes a green tick when the section is complete. The rail also has a progress bar ("3 of 5 sections done"), and clicking a section scrolls to it. Middle: the form cards. Right: a sticky **Invoice totals** card with "When you save", "Before you save" and the Save button. At phone width, everything stacks.
2. **"Supplier" becomes "Vendor" everywhere** in the UI: pages, menus, breadcrumbs, filters, exports, toasts and Cris answers. **(My call)** This is wording only: routes (`/purchases/suppliers`), code names and the database stay as they are, to keep the change small.
3. **The vendor's "Registration no." is the VAT REG. TIN.** Relabel the existing field as **"VAT REG. TIN"** everywhere; existing values stay. No new column.
4. **Vendor card on the PO form.** A searchable vendor picker showing initials, name, and registered name with TIN; plus "Add a new vendor". Under it, the vendor's **Owned & operated by** (registered name), **VAT REG. TIN** and **Address**, read-only, with **Edit vendor**. A vendor without a TIN shows an amber "Not on file — add it from the invoice".
5. **Invoice & payment card:**
   - **Purchase order number**, required: the company's own number, which doesn't need to appear on the invoice.
   - **SI number**, required.
   - **Invoice date**, required: the date on the invoice, not today.
   - **OR number**, optional.
   - **Paid by**, required: **Credit card** or **Debit card**, nothing else.
   - **For department**, optional.
6. **Items: one card per invoice line.**
   - **Description** and **specs or size**.
   - **Category:** a searchable list grouped into **IT gear** ("→ IT checks") and **Office & facilities** ("→ ready to register").
   - **Qty** with − and + buttons.
   - **Unit**, from a list: `pc, box, set, pack, roll, m, unit`.
   - **Unit price** with ₱.
   - **Amount**, calculated as qty × unit price.
   - **Duplicate** and **Remove** buttons on each card.
   - The section header shows "N units to IT · N units to register", and the footer shows the **items total**.
7. **Create a category on the spot** when no category matches. The list offers **Create "X" as… IT gear / Office item**:
   - **Office item:** created immediately.
   - **IT gear:** created immediately and usable right away, but marked **New · IT confirms**. IT confirms it, or swaps it for an existing category, when registering the item.
8. **Documents:** four slots.
   - **Sales invoice**, required.
   - **Official receipt**, **Delivery receipt** and **Warranty slip**, each optional.

   Attached files show a thumbnail with **Preview / Replace / Remove**; empty slots are drop zones.
9. **Invoice totals, typed by Purchasing, nothing computed:**
   - Total sales (VAT inclusive)
   - Less: VAT
   - Amount net of VAT
   - Less: discount
   - Amount due
   - Add: VAT
   - **TOTAL AMOUNT DUE**, required

   The form only **checks** these figures. A line that doesn't add up turns amber and says what it expected. Saving is still allowed, and Finance sees that the totals didn't add up.
10. **Before you save checklist:**
    - purchase order number;
    - vendor with a TIN;
    - SI number and date;
    - every item has a category;
    - every item has a quantity and price;
    - sales invoice attached;
    - totals add up.

    These are guidance only. The server enforces only the required fields (§4).
11. **Save button label:** "Save and send to IT" when the order has IT gear, otherwise "Save and register".

## 3. The checks (§2.9), exactly

With `items` = Σ qty × unit price, and a tolerance of ±₱0.01:
- Total sales must equal `items`.
- Net of VAT must equal total sales − less VAT.
- Amount due must equal net of VAT − discount.
- Total amount due must equal amount due + add VAT.

A blank discount counts as 0. These checks run in the browser as you type, and again on the server when you save. The result is stored as `totalsConsistent` (true/false) on the PO, and Finance's group review shows a "Totals didn't add up on the PO" note when it is false.

## 4. Data (migration 39)

**PurchaseOrder:**
- `poNumber String?`: required by the server for new and edited POs; null on legacy POs.
- `paidBy PaidBy?`, with a new enum `PaidBy { CREDIT_CARD DEBIT_CARD }`: required for new and edited POs; null on legacy POs.
- Totals, each `Decimal(12,2)?`: `totalSales`, `lessVat`, `netOfVat`, `discount`, `amountDue`, `addVat`, `totalAmountDue`. `totalAmountDue` is required for new and edited POs.
- `totalsConsistent Boolean?`.
- **Fees:** the existing `fees` column stays, so legacy POs still show their fees, but the form no longer has a fees field **(my call)**.

**PurchaseOrderLine:** `unit String @default("pc")`, any short text up to 12 characters. The form offers the list above.

**AssetCategory:**
- `confirmedAt DateTime?` and `createdById String?`. Every existing category is backfilled as confirmed (`confirmedAt = now()`).
- A Purchasing-created **office** category gets `confirmedAt` at once.
- A Purchasing-created **IT** category stays null until IT confirms it.

**Vendor:** no schema change; `registrationNo` is just shown as VAT REG. TIN.

**Uniqueness:** `poNumber` is unique among non-cancelled POs **(my call)**. A duplicate is refused: "PO 2025-0418 is already used on PO-0212".

## 5. Category creation and confirmation

**Creating from the PO form:**
- Purchasing (and admin) may create a category of **either** class from the PO form only. The Admin categories page keeps its current rules.
- Creation is a new server action, `createCategoryFromPo({ name, cls })`. It is case-insensitive unique against existing names; a match reuses the existing category instead of creating a duplicate.

**Confirming an unconfirmed IT category (the IT register page):** each such line shows "New category 'Network cable' — Confirm or choose another".
- **Confirm** sets `confirmedAt`.
- **Choosing an existing category** moves this line to it. The unconfirmed category is deleted if nothing else uses it **(my call)**.
- **Registering without confirming** confirms the category implicitly.

**Elsewhere:**
- The Admin categories page lists unconfirmed categories with a "New · from a PO" tag.
- Audit codes: `category.create` (existing or new), `category.confirm`, `category.replace`.

## 5b. Settled after the builder check (all my calls)

1. **Documents are saved with the PO in one request.**
   - The save action takes the form's files as multipart data. Files go to storage first, then the PO and its document rows are written in one transaction. If the transaction fails, the stored files are cleaned up.
   - **Before saving**, Replace and Remove only change what is held in the browser.
   - **After saving**, Replace adds a new document of the same kind, and the slot shows the newest one. Remove marks a document `supersededAt` and hides it from its slot. Documents are never deleted, so the append-only rule stays.
   - Replace and Remove after saving are allowed for the same roles as upload.
2. **Fields the server requires on a new PO:**
   - vendor;
   - purchase order number;
   - SI number;
   - invoice date;
   - paid by;
   - at least one line;
   - a category, a quantity of 1 or more and a unit price on every line;
   - total amount due;
   - a sales invoice attached.

   Vendor TIN, the other totals, and the totals adding up remain checklist guidance only.
3. **Legacy POs (created before migration 39) don't need the new fields.** When a legacy PO is edited, `poNumber`, `paidBy`, `totalAmountDue` and the sales invoice stay optional. Any field that is filled in is still validated.
4. **The new fields can be corrected and sent back.**
   - `poNumber`, `paidBy` and the seven totals join the money fields Purchasing owns. That means IT and Finance can fix them with a reason, or send them back, through the existing `MONEY_FIELDS`, `canEditField`, send-back checklist and Fix dialog.
   - `totalsConsistent` is recalculated on every write that changes lines, prices or totals: save, fix, and close-short.
5. **IT confirming a new category at Register:**
   - IT may **confirm** it, or **choose another IT category** only. If the item isn't IT gear at all, IT sends the PO back to Purchasing with "Category" ticked.
   - The prompt appears only while no unit on that line is registered. The first registration confirms it implicitly.
   - Replacing the category notifies Purchasing (CHANGED: "IT changed the category on PO-0215 line 1 to Switch").
6. **Unconfirmed IT categories are usable on purchase orders only**, so other POs reuse them instead of creating near-duplicates. They are hidden from direct Register and the asset forms until confirmed. A replaced category is deleted only if no other PO line uses it.
7. **A name that already exists in the other class is refused**, because category names are unique across both classes. The message reads: "'Network cable' already exists as an Office item — pick it from the list." A name that exists in the same class reuses that category.

## 6. Where it applies

- **New and Edit PO pages:** the same A3 form. Edit covers a PO sent back to Purchasing, with today's sent-back banner and its ringed fields kept.
- **PO detail page:** shows PO number, Paid by, the unit on each line, the typed totals ladder, and a "Totals didn't add up" note when `totalsConsistent` is false.
- **Finance group review:** shows the same totals ladder for PO groups.
- **Every "Supplier" label** in the UI (§2.2).

## 7. Not in this design

- The invoice-photo side panel (A4). It can come later.
- OCR or auto-filling from the photo.
- Computing VAT.
- Changing the IT/Finance flow (Phase "PO intake", deployed 2026-10-22).

## 8. Left to the builder

- Component structure: reuse the app's popover, listbox and dialog patterns. Make a shared `Combobox` for vendor, category, unit and department rather than four copies.
- Keyboard behaviour of the comboboxes, following the WAI-ARIA combobox pattern: type to filter, arrow keys, Enter to pick, Escape to close.
- Rail scroll-spy behaviour.

**Tests must cover:**
- the §3 checks;
- the server's required fields;
- `poNumber` uniqueness;
- category create, reuse, confirm and replace;
- unconfirmed IT categories at register;
- the Vendor wording sweep (a grep test like `po-copy.test.ts`);
- the e2e flow of copying the owner's PCWORX example end to end, including creating "Network cable" as IT gear;
- axe on the new form in light and dark, and at 375 px.
