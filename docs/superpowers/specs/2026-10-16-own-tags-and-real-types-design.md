# Phase 36 — You choose the tag; types that mean something; people search; a schedule that scales

**Status:** designed 2026-10-16 with the user (§4–§5 added the same day after a scale measurement); awaiting the
user's review of the added sections. **One migration (the 29th), data only.**

## 1. What the user asked for, and why

**Tags.** "We should be the ones who assign the label for the assets." Today Register works out the next tag itself
(`BR-LT-0219` …) from the category's prefix. For a single unit it shows only as a read-only chip next to the serial.
The user's choices:
- **We pick the number.** Staff type the tag, and the app prints the label from what they typed.
- **Any text we choose.** There is no fixed `BR-XX-0000` shape, and the box starts empty: no suggestion.

**Types.** "I selected Asus Vivobook as a laptop model, but the type is nonsense." On staging the Laptop category's
types are **"Dell Latitude"** and **"ThinkPad"**, which are model names, not kinds. Every laptop is typed "Dell
Latitude", including the HP ProBook, Acer Aspire and MacBook Air. Register then offers those two for a new model like
the Asus Vivobook. The cause is twofold:
- the bad type list;
- Register copying the type from the newest asset of the same model (Phase 34, spec §4.2), which spread the bad value.

Types still matter: a role's standard kit (an equipment policy's slots) matches devices **by type**. For example,
the Finance standard kit's "laptop" slot is the "Dell Latitude" type.

The user's choices:
- **Type is a real kind within the category.** Register **always asks** for it and **never copies** it from an older
  asset.
- **Laptop types:** **Standard**, **High-performance** and **MacBook**. Admin can add more later under Asset types.
- **The data fix also moves BR-LT-0201 (MacBook Air M3) to MacBook.**

**Success** means:
- Every new asset carries exactly the tag staff typed, its label and QR use it, and it is unique.
- Register never shows a model name as a type.
- The Finance standard kit keeps matching the same laptops it matches today.

## 2. Tags

### 2.1 The rule (one definition)
- **Normalisation:** the tag is trimmed and stored in **upper case**.
- **Shape:** 1–30 characters of letters, digits, `-`, `_` and `.`, starting with a letter or digit:
  `^[A-Z0-9][A-Z0-9._-]{0,29}$`.
  - There are no spaces and no `/`, because the tag is one segment of the scan URL `/inventory/scan/<tag>`.
  - It cannot start with `.`, which rules out the `.` and `..` path segments.
- **Uniqueness:** it must be unique across all assets. Tags are stored upper-case, so uniqueness ignores case.
- **The constant:** `TAG_SHAPE` in `src/lib/tag-key.ts` becomes this pattern, and every user of it follows:
  - the Register action;
  - Purchasing's receive-and-register action (`src/server/modules/purchases/receiving.ts`);
  - the CSV asset import;
  - `exactTagMatch`, the search box's jump straight to an exact tag.

  Their refusal text "Format: BR-XX-0000" becomes "Tags are 1–30 letters, digits, - _ or ., no spaces".
- **Existing tags** (`BR-LT-0148` …) already fit the new shape. Nothing is renamed.

### 2.2 Register
- **Empty tag boxes:** every unit's **Tag** box starts empty, whether one unit or a batch.
  - **One unit:** the read-only "tag BR-…" chip becomes an editable **Tag** box beside the serial box.
  - **A batch:** each row's tag box is editable.
  - **Paste:** pasting a column of tags into any row fills that row and the rows below, the same as serials today.
- **Tag required:** an empty tag refuses with "Enter a tag for every unit". A repeat within the batch, or a tag that
  already exists, shows today's messages; an existing tag is linked to its record.
- **Order:** the box order per row is **Tag, then Serial**, so a scanner or keyboard flow types the tag first.
- **The suggestion is gone.** `nextTags` and `prefixFor` are no longer used by Register.
  - Category `tagPrefix` stays in the data and in Admin, but drives nothing in Register.
  - "Register and add another" clears the tag box rather than filling the next number.
- **Labels:** the label and its QR print the tag as typed (upper-cased). The Labels queue is unchanged.

### 2.3 Not changed
- Existing assets keep their tags.
- There is no re-tagging of an existing asset (tags stay permanent once registered, as today).
- Purchasing's receiving screen keeps its current tag inputs; only the shape rule changes there.

## 3. Types

### 3.1 Register always asks
- **No copying:** the Model box no longer sets the type. Picking a known model or typing a new one never copies a type
  from an older asset.
  - The Phase 34 model-to-type behaviour and its ruling R9 are retired.
  - The model list still shows each known model, without its old type.
- **The Type select:**
  - shown whenever the category has **two or more** types;
  - **required** (refusal: "Pick the type");
  - starts empty.
- **One type:** a category with exactly one type takes it silently, as today.
- **No types:** a category with no types (e.g. Uncategorised) registers with no type.
- **Server rule:** the Register action refuses a missing type when the category has types. It also refuses a type
  that does not belong to the chosen category; that check exists today.
- **Batches:** in a batch, the one Type applies to every unit, as today.

### 3.2 The Laptop data fix (migration 29, `20261016090000_laptop_types`)
This is data only, with no schema change. It runs on the IT class's **Laptop** category, found by name and class.

1. Rename the type **"Dell Latitude" → "Standard"**. Every laptop that has it, and the Finance standard kit's
   "laptop" slot, keep pointing at the same row, so the kit still matches the same 13 laptops.
2. Rename the type **"ThinkPad" → "High-performance"**. No asset uses it.
3. Insert a type **"MacBook"** in Laptop, unless one already exists, ignoring case.
4. Set **BR-LT-0201**'s type to MacBook, only if that asset exists and is in the Laptop category.

Each step is guarded so it does nothing when its source is missing:
- the dev database and a fresh seed may differ from staging;
- a rename skips when the target name already exists in the category.

The migration writes no audit rows (migrations never have). The spec and handover record it.

**The seed** (`prisma/seed.ts`) gets the same three Laptop types, and its laptops use **Standard** (the MacBook Air
fixture uses MacBook). A fresh seed and staging then agree.

### 3.3 Not changed
- **Other categories:** Monitor (24/27-inch), Workstation (All-in-one, Desktop tower, Mini PC), Headset, Mouse,
  Docking Station, Laptop Bag, Type C Hub and Other already hold kinds, not models, and stay as they are.
- **Edit and Admin:** the Edit page's Type select and Admin → Asset types (add, rename) stay as they are. IT retypes
  any other laptop (e.g. a high-end ThinkPad) from Edit.

## 4. People search instead of 600-item lists

**Why.** The user: "I don't want the categories like Assigned to list down 600 items." A measurement on
`inventory_dev` with 610 employees and 10,032 assets (2026-10-16) showed that every inventory page ships every
assignee for the **Assigned** filter, and every active employee for the holder pickers, up front. The page still
loads in time, but it carries about 90 KB more, and a 600-row dropdown is unusable. The user chose **both** the
filter and the pickers.

### 4.1 One server search
- **The action:** `searchPeople({ q, scope })` returns at most **10** people.
  - **Input:** `q` is 1–60 characters, trimmed. It matches the name or the employee no., ignoring case, as a
    substring.
  - **`scope: "active"`:** ACTIVE employees, for the pickers.
  - **`scope: "assignees"`:** anyone who currently holds an asset of the given class, for the filter.
  - **Order:** name, then employee no.
- **Guard:** the same roles that can open the screens using it (`admin`, `it_staff`, `purchasing_staff`;
  `finance_staff` too for the filter). `actionRole` → `checkRate` → zod, as every action. No audit row: it is a read.
- **Rate limit:** it uses `checkRate` like every action. Typing is debounced on the client (250 ms), so normal typing
  stays well under the limit.

### 4.2 The pickers (Assign, Reserve, Replace, bulk assign, Register's holder, Stock issue)
- **One component.** `PeopleCombobox` wraps the house `EntityCombobox`.
  - **Before typing:** it shows the user's **Recent** picks (the existing remembered picks, at most 5, active only),
    resolved on the server into names.
  - **While typing:** it searches the server (`scope: "active"`), up to 10 results, with "No match — check the
    spelling or the employee no." when there are none.
  - **The chosen person** stays shown by name. The component receives the current value's label from the page.
- **Pages stop loading the full list.** `activeEmployeeOptions()` is no longer called by the inventory list, the
  record layout, Register or Stock issue. It is deleted if nothing else uses it.
- **Behaviour otherwise unchanged:** the same validation, the same remembered picks, the same keyboard behaviour as
  `EntityCombobox` today.

### 4.3 The Assigned filter
- **Opening it shows:**
  - a search box ("Type a name or employee no.");
  - the people already selected, each with a remove ×;
  - **Unassigned**, a new value `none` meaning `assigneeId IS NULL`.
- **Typing** searches (`scope: "assignees"`, the current class). Each result shows its asset count under the current
  filters, except the Assigned filter itself, matching today's counting rule. Ticking a result adds it, and **Apply**
  applies, as the other filters do.
- **The button** reads "Assigned" or "Assigned: {n}".
- **Page load:** `facetOptions` no longer loads every assignee. It returns only the selected people (names and
  counts) and the Unassigned count.
- **The other filters** (Status, Category, Type, Provenance, Registration) stay plain lists, because each has at
  most a few dozen options.

## 5. The depreciation Schedule scales

**Why.** In the same measurement, `/finance/depreciation` (the Schedule) took **7.5 s** and produced a **10 MB**
page. It draws every depreciating asset as a row of 12 months, unpaged. Every other page grew by 0–200 ms.

- **The default view is by category.** One row per category with the same columns as today (Cost, Book value 1 Jan,
  Jan … Dec, Year total, Book value 31 Dec), with projected months greyed, plus the **Total** row. The "{n} assets
  aren't depreciating yet · {m} have no policy" line stays.
- **Drill-down.** Each category name links to `?cat=<categoryId>`, which shows that category's assets as today's
  rows. It is **paged** (the house page size) and keeps the category subtotal row. A "← All categories" link returns
  to the summary.
- **The export is unchanged.** It still lists every asset row with subtotals and the total; a spreadsheet handles
  10,000 rows.
- **Arithmetic:** subtotals are computed the same way as today (`yearGrid` per asset, summed), so the summary equals
  the sum of its drill-downs.

## 6. Testing
- **Unit:** `TAG_SHAPE` accepts `BR-LT-0148`, `ACC-LAP-001`, `2026-0042`, `A`, `LT_1.2`, and refuses:
  - the empty string;
  - `-LT`, `.X`;
  - `A B`, `A/B`;
  - a 31-character string;
  - `ñ`.

  The register-rows helpers accept typed tags and flag empty tags, repeats and pasted columns.
- **Register type rule:** a pure helper decides when the Type select shows and is required (0 / 1 / 2+ types), and a
  known model never yields a type.
- **e2e** (one new spec, plus adapted pins):
  - Register one laptop with the tag `ACC-LAP-001` typed by hand and the type "High-performance" picked. The record
    shows that tag and type, and the label preview prints it.
  - A batch of 3 with pasted tags; a duplicate tag refused with the record link; an empty tag refused.
  - Picking the known model "Dell Latitude 5420" leaves Type empty and required.
  - Laptop's types read Standard / High-performance / MacBook, BR-LT-0201 is MacBook, and the Finance standard
    kit's laptop slot shows "Standard".
  - The scan URL `/inventory/scan/ACC-LAP-001` opens the asset.
  - Existing register specs that relied on suggested tags type their tags instead.
  - **People search:**
    - The Assign dialog finds a person by part of the name and by employee no. Recent picks show before typing.
    - The page HTML no longer contains every active employee's name (assert a far-down seeded name is absent until
      searched).
  - **Assigned filter:**
    - search, tick, Apply; the chip count;
    - Unassigned filters to assets with no holder.
  - **Schedule:**
    - the default shows category rows plus Total, and no asset rows;
    - a category drill-down shows its assets paged, with the subtotal;
    - the export still lists asset rows.
- **Unit:** the search input schema (1–60 characters, scope); `assigneeWhere` with `none`; the schedule summary
  equals the sum of its category rows (pure).

## 7. Rulings taken while writing
1. **Upper-case storage.** Typed tags are stored upper-case, so scanning and uniqueness never depend on case. *Cost if
   wrong: one `toUpperCase`.*
2. **The character set** excludes `/` and spaces and requires a letter or digit first, so a tag is always a safe URL
   segment. *Cost if wrong: one regex.*
3. **One shape everywhere.** Receiving, the CSV import and the search jump use the same new rule rather than keeping
   `BR-XX-0000` there. *Cost if wrong: a second constant.*
4. **Rename, don't replace.** "Dell Latitude" is renamed to Standard rather than deleted, so assets and kit slots keep
   their links with no remapping. *Cost if wrong: none; a rename is reversible in Admin.*
5. **`tagPrefix` stays.** It is kept in the data and Admin, though unused by Register, so nothing else that reads it
   breaks. *Cost if wrong: a dead column to drop later.*
6. **10 results, 250 ms debounce, 5 recents.** These are small fixed numbers, chosen so a picker never lists more
   than fits on screen. *Cost if wrong: constants.*
7. **Unassigned is a filter value** (`none`) on the Assigned filter rather than a separate filter. *Cost if wrong:
   one value.*
8. **The Schedule summary is the default view**, with the asset rows one click away (paged); the export stays
   complete. *Cost if wrong: the default `cat` value.*
