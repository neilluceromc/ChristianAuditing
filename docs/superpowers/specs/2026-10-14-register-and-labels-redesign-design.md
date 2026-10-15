# Phase 34 — Register and Labels redesign

**Status:** designed 2026-10-14 with the user. The design was locked from the canvas
<https://claude.ai/artifact/7Q5i9JScWpffej9FDTi5sf> (version 4, the "Register" and "Labels" tabs).
It needs **one migration (the 27th)**. Plan `docs/superpowers/plans/2026-10-14-phase-34-register-labels-redesign.md`
(`2904714`, 12 tasks, P-1…P-9, D-1…D-27). **CODE-COMPLETE 2026-10-15 on `phase-34-register-labels` (final code
tree `f7c4f70`), MERGED to `main` via `ffbc0e8` (`--no-ff`, merged tree = tested tip `cf39923`) and PUSHED 2026-10-15; staging NOT yet redeployed; migration 27 `20261014090000_register_labels` — the staging redeploy
APPLIES it (the deploy script runs `prisma migrate deploy`).** Battery A 58 · B 87 (+2 skipped) · C 64 · D 70 · E1 61 · E2 56 · F 66 = 462 passed / 464 listed; the physical
print-and-scan check of the new label on a real A4 sheet is owed. §7.1's prefix order was rewritten by ruling
R23. Record: `docs/HANDOVER.md` (aa).

## 1. What the user asked for, and why

- The IT register page (`/inventory/register?cls=IT`) offers the wrong categories. IT equipment should be
  Laptop, Workstation (PC), Monitor, Headset, Mouse, Type C Hub, Docking Station, Laptop Bag and Other.
- The page "is not a good UI/UX design":
  - it is too long;
  - the category dropdown is clumsy;
  - it is unclear what is required;
  - it looks dated.

  Over four rounds of mockups the user rejected, in turn:
  - a numbered five-section form with a side summary;
  - pill-shaped category buttons;
  - a three-step "Continue" flow ("too many next").

  The user asked for **two screens: one to register, one for labels**.
- Quantity has to be a first-class choice, because one unit and a delivery of ten behave differently.
- The **serial number is required** and must be easy to find.
- **Model and type** overlap for laptops, and some categories will have many types.
- The label printing needs a better design and a better way to show it.
- Purchase details need document uploads, covering: the invoice, the official receipt, the warranty slip
  and the delivery receipt. They also need warranty details, the invoice and OR numbers, and the cost with
  a total, i.e. a purchase summary.

Success means:
- one screen registers anything from a single headset to a delivery of ten laptops without scrolling hunts;
- nothing required can be missed;
- the labels for what was just registered are one click away, on a sheet the user can see before printing.

## 2. Categories (data — the migration)

### 2.1 The IT categories after this phase

Prefixes listed for new categories are the values seeded into the new `AssetCategory.tagPrefix` (§7.1). The
prefixes shown for existing categories are what tags derived from their existing assets already give.

| Category | Change | Types | Tag prefix |
|---|---|---|---|
| Laptop | unchanged | Dell Latitude, ThinkPad (unchanged) | `LT` (existing tags) |
| Workstation (PC) | **new** | Desktop tower, Mini PC, All-in-one | `WS` |
| Monitor | unchanged | 24-inch, 27-inch | existing |
| Headset | unchanged | Wired, Wireless | existing |
| Mouse | **new** | Wired, Wireless | `MS` |
| Type C Hub | **new** | USB-C Hub | `HB` |
| Docking Station | **renamed** from Dock; keeps its assets | USB-C Dock | `DK` (existing) |
| Laptop Bag | **new** | Backpack, Sleeve | `BG` |
| Other | **new** | Phone, Keyboard, Webcam, Speaker, Printer | `OT` |
| Phone | **deleted** — see 2.2 | — | — |
| Peripheral | **deleted** — see 2.2 | — | — |
| Uncategorised | kept (locked; the importer's fallback), **never shown on the register screen** | — | — |

Two other rules:
- Purchasing categories (Vehicle, Furniture, Pantry Equipment, Building) are untouched.
- Types stay editable in Admin › Asset types.

### 2.2 Moving the deleted categories' assets (by name, inside the migration)

- **Phone:**
  - its assets move to **Other** with type **Phone**;
  - the `iPhone` / `Android` types are deleted after their policy slots and slot exceptions are moved.
- **Peripheral:**
  - the keyboard moves to **Other / Keyboard**;
  - Peripheral's `Mouse` type row moves to the new **Mouse** category, renamed `Wired`, with any assets on it.
    The migration creates Mouse with only `Wireless`, so `@@unique([categoryId, name])` holds.
- **Policy slots and slot exceptions** that point at `iPhone` / `Android` are **repointed to Other / Phone**.
  So the Finance standard policy still requires a phone, and no employee's loadout changes.
  - If one policy has slots for both iPhone and Android, they merge into one Phone slot. The merged slot is
    `required` if either was, and `loaner` if either was.
  - Slot exceptions merge the same way.
- Every move keeps the asset's tag, holder, status, loan date and history. Only `categoryId` / `typeId`
  change. The `asset_class_invariants` trigger holds, because everything stays in class IT.
- The migration is **idempotent and name-keyed**. A database that lacks a named row skips that step.
  This covers dev databases reseeded from a new seed. It never deletes a category that still has assets.
- It writes **no `AuditEntry`**: these are reference-data moves, like earlier reference migrations.
  The migration's own name records them.

### 2.3 The seed

`prisma/seed.ts` is updated to create the §2.1 list directly, so a fresh dev database matches a migrated
one. E2E specs that pick "Phone", "Peripheral" or "Dock" by name are updated (§10).

## 3. Page structure

- One page title, **New equipment**, with two tabs:
  - **Register** at `/inventory/register`;
  - **Labels** at `/inventory/labels`.
- The Labels tab carries a count badge: the number of labels waiting to print in the classes the user manages.
- The tabs are real links, so each URL still works on its own. The breadcrumb reads `Inventory › Register` or
  `Inventory › Labels`.
- `?cls=` keeps its meaning on both tabs. The rules of Phase 33's I-1 hold:
  - a Purchasing user's links carry `cls=PURCHASING`;
  - IT URLs stay byte-identical.
- **Register** saves and then lands on **Labels** with the new tags ticked
  (`/inventory/labels?just=<batch id>`), plus a green "N items registered" notice.
- "Register and add another" stays, and keeps today's behaviour: save, clear the units, keep the category and model.

Role access is unchanged: `admin`, `it_staff` and `purchasing_staff` (register), within `REGISTRABLE_CLASSES`.

## 4. The Register tab (one screen, five blocks)

Every block has the same uppercase section title and divider, with 24 px between blocks. Required
fields carry a red `*`.

### 4.1 What

- One card per registrable category in the class, as a grid with `auto-fill`, a minimum width of 196 px, and
  equal heights.
- Each card shows:
  - an icon;
  - the name, on one line with an ellipsis if too long;
  - the stock line: "**N in stock**", or "None yet". Stock means status **SPARE** (IT) or **STORED** (Purchasing).
- Selecting a card sets the category. It is a `<button aria-pressed>`, not a select, with the house focus ring.
- IT order: Laptop, Workstation (PC), Monitor, Headset, Mouse, Type C Hub, Docking Station, Laptop Bag, Other.
  Purchasing categories show in name order.
- Uncategorised never shows. The icon map is keyed by category name; an unknown name gets a generic box icon,
  so a category added in Admin still renders.

### 4.2 Model and quantity

**Model** (`*`) is a combobox, one field that replaces today's separate Type select:

- On focus it lists the **models already registered in this category**: the distinct `Asset.model` with its
  `typeId`. Each row shows the model, its type badge and "N in stock". Typing filters the list
  (case-insensitive substring).
- **Picking a known model sets the type from that model.** The page then shows the line
  "Type: ThinkPad — set by this model", and nothing else to fill in.
- **A model not in the list** shows `+ Add "<text>" as a new model`. Choosing it shows one inline question,
  **"New model — which type?"** (`*`): a native `<select>` of the category's types, so it scales to any number.
  Its hint reads "Next time this model fills it in for you."
- A model that has assets with **different** types takes the type of its most recent asset. The type stays
  changeable through the same select, opened by a "Change type" link.
- A category with **one** type selects it silently.

**How many** (`*`):
- a − / + stepper, from 1 to 200 (today's cap);
- the quick picks **5** and **10**;
- the number can also be typed.

### 4.3 Serial number (required)

- **IT: required for every unit.** Purchasing: optional, as today; the section is titled
  "Serial number (optional)" there and is never flagged.
- The hint line reads: "Required. It's on the box label or the sticker under the device."
- **One unit:** a large scan-or-type box, 54 px tall, with a 16 px monospace serial. The tag it will get shows
  beside it, e.g. `tag BR-LT-0201`. Scanner input ending in Enter is accepted without submitting the form.
- **Several units:** one row per unit, each showing its tag, a serial input and a status. The statuses are:
  - "✓ ready";
  - "missing";
  - "duplicate", in amber, for a serial repeated within the batch;
  - "already registered", with a link to the asset, from today's live `use-identifier-check` lookup.

  Pasting several lines into any row fills downward from that row (today's paste-fill).
- **Press Register with a gap:** nothing is saved.
  - One unit: the box turns red and shows "Enter the serial number before you register."
  - A batch: every empty row turns red and its status reads "required".
  - In both cases focus moves to the first gap.
- The server re-checks presence, in-batch uniqueness and global uniqueness. That check is authoritative;
  `serial` is already `@unique`.

### 4.4 Where does it go (with the live label)

- **One IT unit:** a segmented control, **Spare stock / Give to someone / Lend**. These map to `SPARE`,
  `DEPLOYED` and `TEMPORARY`.
  - **Give** and **Lend** reveal **Who** (`*`, today's `EntityCombobox`).
  - **Lend** also reveals **Back by** (`*`, date).
  - A role that does not apply lifecycle changes directly keeps today's behaviour: Lend is not offered, and
    Give "files a request for approval", with today's note.
- **One Purchasing unit:** the same control with the Purchasing states, **Stored / In use** (`STORED` /
  `OPERATIONAL`). There is no holder, as today.
- **Several units:** a grey note: "All N go to spare stock. To hand one out, register it on its own."
  For Purchasing it reads "stored". This is today's single-unit-only rule, now said in words.
- **Live label preview, beside this block:**
  - the redesigned label (§6) at **actual size**, which updates as the model is typed;
  - for a batch, it shows as a small stack with the caption "First of N labels, actual size".
  - It is a figure with a caption, and adds no interactive elements.

### 4.5 Purchase and warranty (optional, collapsible)

- A header button opens and closes the section. It starts **closed**.
- When closed and filled in, it shows a one-line summary such as
  "Octagon · ₱206,000.00 · warranty to 2027-10-12 · 2 files".
- Inside are four boxes, each a `<fieldset>` with a legend:

| Box | Fields | Stored on |
|---|---|---|
| **Purchase** | Vendor (today's vendor combobox), Purchase date, Purchase request, Invoice no., Official receipt (OR) no. | `PurchaseRecord` (§7.2), and each asset's existing `vendorId` / `purchasedAt` / `purchaseRequestId` / `invoiceRef`, plus the new `receiptRef` |
| **Cost** | Cost per unit (₱; "Cost (₱)" when there is one unit), Delivery and fees (₱). A purchase summary shows: `N × ₱each`, then `Delivery and fees`, then **Total**, computed live. | Each asset's existing `cost` is the per-unit cost. `PurchaseRecord.unitCost` / `fees`; the total is **computed, never stored**. |
| **Warranty** | Length (None, 6 mo, 1 yr, 2 yr, 3 yr), which sets **Warranty until** from the purchase date and stays editable. Covered by (Manufacturer / Vendor / Both). Who to call for repairs. | each asset's existing `warrantyUntil`, plus the new `warrantyCoveredBy` and `warrantyContact` |
| **Documents** | One slot each for **Sales invoice**, **Official receipt**, **Warranty slip** ("A photo of the warranty card is fine") and **Delivery receipt**, plus "+ Another file". PDF or image, up to 10 MB each (today's limit). | `AssetDocument` rows with the kinds `invoice`, `official-receipt`, `warranty-slip`, `delivery-receipt` and `other`. For a batch, each file is saved **on every unit**, as `register-documents` does today. |

- Today's warranty default (purchase date + 12 months) stays as the default length, **1 yr**, once a purchase
  date is entered.
- Money fields accept `68,500`, `68500` and `68500.00`. They are stored as `Decimal(12,2)` and shown with
  `en-PH` formatting.

### 4.6 Footer

- A status line on the left:
  - amber "Still needed: a model, 2 serials, 1 duplicate to fix", or
  - green "Ready to register".
- Then **Register and add another** (secondary) and **Register N laptop(s)** (primary; the noun follows the
  category, and it uses the plural for N > 1).

## 5. The Labels tab

Two columns that wrap on narrow screens.

**Waiting to print** (left):
- A checklist of registrations whose labels have not been printed (§7.1, `labelPrintedAt`), **grouped by
  registration batch** (§7.2). Each group shows "3 × ThinkPad T14 Gen 4", the tag range in monospace, and when
  it was registered ("Just now", "Yesterday", or a date).
- The batch just registered is ticked; the others are not.
- It is limited to the classes the user manages, and capped at the 50 most recent groups, with a
  "Show older" link.
- **Today's Tags box stays** below the list, under the label "Reprint other tags". It is Phase 33's `?tags=`,
  pasted or scanned. Tags entered there are added to the sheet even if they were already printed.

**Start at sticker:**
- a − / + stepper from 1 to 12, or **click a sticker on the sheet**;
- this is Phase 33's `?start=` and `labelSlots`.

**Summary line:** "3 labels on 1 sheet, starting at sticker 4", or
"…, 2 more on a second sheet".

**Print N labels** (primary):
- opens the browser print of the existing A4 sheet, at the same `@page`, mm geometry and calibration bar;
- marks the printed assets' `labelPrintedAt` through a small server action called on `afterprint`, or on click
  when `afterprint` is unavailable;
- printing again is always allowed, and a reprint does not change `labelPrintedAt`.

**Register more** (secondary) returns to the Register tab.

**Sheet preview** (right):
- the A4 sheet at about half size, 3 × 4 stickers;
- stickers before the start are hatched and labelled "used", free ones show their number, and filled ones show
  the real label;
- each sticker is a button labelled "Start at sticker N".

## 6. The label itself (redesign)

The label stays on the same A4 sheet geometry (3 × 4, `label-geometry.ts`). It keeps the existing `Barcode` and
`Qr` components with their fit rules and the sheet's calibration bar. Only the layout inside the cell changes:

1. **Top row:**
   - the black `BR` badge;
   - "Backroom IT";
   - the category name, right-aligned, on one line with an ellipsis.
2. **Middle row:**
   - the QR code on the left, at today's fitted size;
   - beside it, the model (up to 2 lines) and "Scan to open".
3. **The tag**, in large monospace, at today's 4.6 mm or larger if the cell allows.
4. **The barcode**, full usable width along the bottom.

The live preview (§4.4) and the sheet preview (§5) render the same component at different scales, so what is
previewed is what prints. A label whose QR cannot be built (no `APP_BASE_URL`) keeps today's red notice in
place of the QR.

## 7. Data changes (migration 27)

### 7.1 New columns

- `AssetCategory.tagPrefix String?`
  - Register offers `tagPrefix ?? learned prefix ?? ""` (ruling R23, Phase 34 D-23): the category's own
    `tagPrefix` wins when it is set; the prefix `preferredPrefix` learns from the category's existing tags
    only fills a missing `tagPrefix`; with neither, the prefix is empty and Register asks for one. (Other
    inherits phone and keyboard tags and must still offer `OT`.)
  - It is seeded per §2.1.
  - On the Register tab the prefix stays editable in a small **"Tag prefix and notes"** fold-out at the
    bottom of the Purchase and warranty section. That fold-out also holds today's Notes field, and its
    behaviour is unchanged from today.
- `Asset.receiptRef String?`: the official receipt number, beside `invoiceRef`.
- `Asset.warrantyCoveredBy String?`: `"manufacturer" | "vendor" | "both"`, validated by zod rather than as an
  enum, so the list can grow.
- `Asset.warrantyContact String?`.
- `Asset.labelPrintedAt DateTime?`.
  - **Backfill:** every existing asset gets `labelPrintedAt = createdAt`, so the queue starts empty instead of
    listing years of history.
- `Asset.purchaseRecordId String?`, with a foreign key to `PurchaseRecord` (`onDelete: Restrict`) and an
  index.

### 7.2 New table `PurchaseRecord`, one per Register submit

| Column | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `cls` | `AssetClass` | |
| `vendorId` | `String?` | |
| `purchasedAt` | `DateTime?` | |
| `invoiceRef` | `String?` | |
| `receiptRef` | `String?` | |
| `unitCost` | `Decimal?(12,2)` | |
| `fees` | `Decimal?(12,2)` | |
| `quantity` | `Int` | |
| `createdById` | `String` | |
| `createdAt` | `DateTime` | |

- It doubles as the **registration batch** that the Labels queue groups by. Every Register submit creates one,
  even when no purchase field is filled; the batch still needs an identity.
- Assets registered before this phase have `purchaseRecordId = null`. The queue would group them by
  `createdAt` minute and model, but the backfill empties the queue, so in practice only new batches appear.
- It is append-only in spirit: no edit UI in this phase.

### 7.3 Audit

- Register writes the **same per-asset audit entries as today**, plus one `purchase.recorded` entry with the
  record id, quantity and total.
- `auditSentence` gains a case for it: "{actor} recorded a purchase of N items".
- Marking labels printed writes **no** audit row. It is a print convenience, not a custody change.

## 8. Server

- **The register action** keeps its guard order (role → rate → zod) and its transaction. Within the
  transaction it:
  - creates the `PurchaseRecord`;
  - allocates tags;
  - creates the assets with the new fields and attaches the documents.

  The new zod rules are:
  - IT serials are required and unique within the batch;
  - a new model requires a type;
  - the money fields are non-negative and at most 9,999,999,999.99;
  - `warrantyCoveredBy` is one of the three values.
- **`knownModels(categoryId, classes)`** (a query) returns the distinct `(model, typeId)` pairs with their
  in-stock counts, newest type per model, limited to 200.
- **`labelQueue(classes)`** (a query) returns the groups for §5.
- **`markLabelsPrinted(tags)`** (an action) does the following:
  - it accepts up to 200 tags;
  - it only touches assets in the user's manageable classes whose `labelPrintedAt` is null;
  - it is rate-limited like the other actions.
- The register page's two queries, categories and types, gain the in-stock counts.

## 9. Accessibility and copy

- Category cards, the segmented controls and the warranty lengths are buttons with `aria-pressed`.
- The model field is a combobox with a `listbox`.
- Errors are linked by `aria-describedby`, and the serial input carries `aria-invalid` once a submit failed.
- The tabs are links styled as tabs, with `aria-current="page"` on the active one, because they are separate
  pages.
- House rules hold:
  - a product aria-label near a field never contains that field's label word;
  - copy is in sentence case with no "please" and no "successfully".
- The app keeps its current font stack. The Geist font used in the mockups is **not** part of this phase
  (§11).

## 10. Testing

**Unit tests:**
- `knownModels` merge: same model with two types → newest wins;
- the money parser;
- the total;
- warranty length → date;
- the IT serial rule versus the Purchasing serial rule;
- in-batch duplicates;
- `labelQueue` grouping and the class scope;
- `markLabelsPrinted` scoping and idempotence;
- the migration's name-keyed moves, as a test against a seeded copy;
- `tagPrefix` fallback order.

**E2E**, a new `e2e/register-labels.spec.ts` with about 14 cases, in chunk B:
- the cards show and Uncategorised does not;
- a known model fills its type, and a new model asks for one;
- one unit with no serial is refused with the red message and nothing is saved;
- a batch of 3 by paste-fill, with a duplicate flagged;
- Give to someone (direct role) and the approval path (non-direct);
- purchase fields, documents and the total are saved on each unit;
- Register lands on Labels with the batch ticked;
- start at sticker 4 by clicking;
- Print marks the batch printed and the queue empties;
- the Tags box reprints;
- Purchasing: the serial is optional and the states are Stored / In use;
- an axe check on both tabs.

**Adapted pins:** every spec that picks "Phone", "Peripheral" or "Dock", or reads today's register form
structure:
- `registration`, `receiving`, `inventory-ux`, `it-core`, `it-gaps`, `asset-classes`, `department-owned`,
  `direct-lifecycle`, `purchasing-ext`, `admin`, `it-work-ux`, `offboarding-v2`, `custody`;
- `e2e/fixtures/make.ts`.

**Proof:** the full seven-chunk battery on the final tree, with `npm run db:seed` last.

## 11. Out of scope

- Switching the app's font to Geist. It was offered and left for a separate decision.
- A phone-specific layout beyond what the responsive rules above give.
- Editing a `PurchaseRecord` after the fact.
- Changing label sheet sizes other than A4 3 × 4.
- Merging or renaming Purchasing categories.

## 12. Rulings made while locking the design (each with its cost if wrong)

1. **The deleted Phone and Peripheral assets go to "Other"** with types Phone and Keyboard, not to
   Uncategorised. Their policy slots are repointed rather than removed, so no employee's equipment
   requirement changes.
   - The user had first chosen "move, then delete", before "Other" existed.
   - Cost if wrong: one follow-up move.
2. **Serial is required for IT only.** Purchasing stays optional.
   - Cost if wrong: one zod rule and one copy line.
3. **Every Register submit creates a `PurchaseRecord`** and it serves as the label batch.
   - Cost if wrong: a second, smaller table later.
4. **Existing assets are backfilled as already printed.**
   - Cost if wrong: someone has to reprint via the Tags box, which still works.
5. **Category types for the new categories** are the ones in §2.1. Laptop keeps only its two existing types;
   the mockups' HP EliteBook and MacBook were illustrations, and admins add types in Admin.
   - Cost if wrong: an admin edit.
6. **"Tag prefix and notes"** stays a fold-out inside Purchase and warranty rather than a sixth block.
   - Cost if wrong: moving one fold-out.
