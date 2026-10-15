# Phase 35 — Registration review, Finance's asset register, and depreciation

**Status:** designed 2026-10-15 with the user (mockups: the "Depreciation mockups" canvas artifact); awaiting the
user's review before the plan. **One migration (the 28th).**

This phase has three parts that share one list and one page:

- **A. Registration review.** Every registered asset goes to Finance. Finance approves it or sends it back with a
  checklist of the wrong fields and a note. IT or Purchasing fixes the record and replies. Everyone sees a
  **Registration** status.
- **B. Finance's asset register.** Finance gets a full inventory list (**Assets**) and its own asset page, which shows
  everything about the asset's money side.
- **C. Depreciation.** Straight-line book value from Finance's approval, with per-category policies, per-asset
  overrides and a full-year schedule.

## 1. What the user asked for, and why

**Registration review (A).** "Whenever IT inserts or registers an asset, the asset should have a status like it is
being checked by Finance, if the cost and other documents are correct." The user's choices:
- **Finance never edits.** IT or Purchasing has the power to edit; Finance only approves. When something is wrong,
  Finance sends the asset back with a **checklist of what is wrong** and a **note**.
- The checklist offers **every field IT or Purchasing can edit**.
- **IT can reply** when it sends the fixed asset back to Finance.
- The asset **stays in the inventory and keeps working** whatever its registration status.
- **An asset with no cost** still goes to Finance. Finance either sends it back for the cost, or approves it as **Not
  capitalised**.
- **Existing assets:** every asset Finance has not confirmed, with or without a cost, lands in Finance's **To review**
  queue on day one.

**Finance's asset register (B).** "There should be an inventory list also in Finance, and when I click it, we can see
everything about the financial info of that asset." The list is a **full inventory: all assets, even without cost**.

**Depreciation (C).** Finance wants to **know what each asset is worth now**: its book value, meaning cost less
depreciation. This is not about posting journal entries; the app is the source of the numbers, not a ledger. The
user's choices:
- **Method and start:** straight-line, starting from **Finance's approval** of the asset (`financeConfirmedAt`).
- **Settings:** useful life and salvage are set **per category by Finance**, and Finance can **override them on a
  single asset**. These are Finance's accounting settings, not asset data, so Finance edits them.
- **Disposals are ignored for now.** Every costed, capitalised asset keeps depreciating until it is fully
  depreciated, whatever its status.
- **Where book value shows:** Finance's **Assets** list (with totals and an export), the **Finance asset page** and
  the **Finance home**.
- **A full-year schedule:** a 12-month grid per asset for a chosen year, exportable to Excel.
- **How it is built:** calculated on the fly (approach A). Only the settings are stored. There is no monthly ledger
  and no background job.

**Success** means four things:
- IT and Purchasing always know which of their assets Finance has accepted, and exactly what to fix when it has not.
- Finance reviews from one queue, without editing anyone's data.
- Finance sees a correct current book value for every capitalised asset, and a year schedule that adds up.
- Assets that cannot be calculated say why instead of showing a made-up number.

## 2. What exists today (Phase 14 / Phase 30) and what changes

**Today:**
- `Asset.financeConfirmedAt/ById` record Finance's confirmation.
- `financeReturnedAt/ById` and `financeReturnReason` record a send-back with a free-text reason.
- `itVerifiedAt` marks IT's check of an IT asset that Purchasing registered. Finance waits for that check.
- The actions are `confirmAssetDetails`, `returnAssetToIt` (a reason of at least 5 characters) and
  `resubmitAssetToFinance` (the registering department's "Mark corrected").
- Finance acts from IT's record page (`/inventory/[id]`), which shows a one-line finance state.
- Finance's list (`/finance/assets`) shows **costed** assets only, and IT assets only once IT has checked them.

**This phase:**
- **Keeps those columns and actions.** The actions gain the checklist and the reply.
- **Adds a not-capitalised outcome.**
- **Moves Finance's review onto the new Finance asset page.**
- **Shows the Registration status** on IT's and Purchasing's inventory lists, and on the record page.

## 3. Part A — Registration review

### 3.1 The Registration status (one pure function)

`registrationState(asset)` returns one of four states. Nothing new is stored for it.

| State | When (checked in this order) | IT / Purchasing sees | Finance sees |
|---|---|---|---|
| `awaiting-it` | `isAwaitingItCheck(asset)` (an IT asset registered by Purchasing, not yet checked) | **Waiting for IT check** | **Waiting for IT** |
| `registered` | `financeConfirmedAt` is set | **✓ Fully registered** (plus "· not capitalised" when flagged) | **Approved** / **Not capitalised** |
| `needs-correction` | `financeReturnedAt` is set | **Needs correction** | **Sent back** |
| `with-finance` | otherwise | **With Finance** | **To review** |

**Existing data maps with no backfill:**
- confirmed assets read as Fully registered;
- assets sent back read as Needs correction;
- every other asset, including every asset with no cost, reads as With Finance.

This is the user's day-one choice.

### 3.2 Finance reviews (on the Finance asset page, §4.2)

When the state is `with-finance`, the page shows a **"Waiting for your review"** box. It holds:
- a hint line;
- **IT's reply**, if the asset came back with one (§3.4);
- the buttons below.

| Button | Shown when | Effect |
|---|---|---|
| **Approve** | the asset has a cost | Today's `confirmAssetDetails`. Sets `financeConfirmedAt/ById` and clears the send-back. Depreciation starts the following month. |
| **Approve as not capitalised** | the asset has **no** cost | The same, plus `financeNotCapitalised = true`. Registered, with no book value and no depreciation. |
| **Send back to {IT \| Purchasing}…** | always | Opens the checklist dialog (§3.3). |

- **Every field is read-only for Finance.** It sees the purchase and cost fields, the asset details and the documents,
  with missing values marked.
- **After an approval**, the page offers the next asset in the queue (today's `nextToReview`, now covering assets
  without a cost too).
- **The review buttons are gone from IT's record page.** For a Finance user, that page shows the Registration status
  with a link, **Review in Finance →**.
- **Finance can review only `with-finance` assets.** It cannot act on `awaiting-it`. Sending back or approving an
  asset that is already registered is refused, as today.

### 3.3 The send-back checklist

- **The dialog** has one tickbox per field that IT or Purchasing can edit on the record, grouped as on the form. The
  list lives in one constant, `REGISTRATION_FIELDS` (`src/lib/registration-fields.ts`); each entry has a key, a label
  and a group.

  | Group | Items |
  |---|---|
  | Purchase | Cost · Delivery and fees · Vendor · Invoice no. · Official receipt (OR) no. · Purchase date · Purchase request |
  | Warranty | Warranty until · Covered by · Who to call for repairs |
  | Asset details | Brand · Model · Category · Serial number |
  | Documents | Sales invoice · Official receipt · Warranty slip · Delivery receipt |
  | Anything else | Other (explain in the note) |

- **Note for {IT | Purchasing}:** optional, up to 500 characters. It is **required when "Other" is ticked**.
- **Validation (zod, on the server):**
  - at least one item ticked;
  - every key is in `REGISTRATION_FIELDS`, with no duplicates;
  - the note is 3–500 characters when present, and present when `other` is ticked.
- **For an asset with no cost**, the dialog opens with **Cost** already ticked.
- **Stored on the asset:**
  - `financeReturnFields String[]` holds the ticked keys.
  - `financeReturnReason` holds the note. This is today's column, now optional and **NULL when no note is given**.
  - `financeReturnedAt/ById` stay as today.
  - A second send-back replaces the list and the note; the audit log keeps every one.
- **Older send-backs** have a reason and an empty list. They show the reason as the note, with no items.
- **Audit:** `finance.return` with diff `{ financeReturn: { from: null, to: { fields: [...labels], note } } }`.
  `auditSentence` reads "{actor} sent {tag} back: Cost, Sales invoice — "{note}"".

### 3.4 IT or Purchasing corrects

- **On the inventory list**, the new **Registration** column (§3.5) shows **Needs correction**, then:
  - "Finance flagged:" and the ticked labels as a list;
  - the note in quotes;
  - who sent it back and when;
  - **Edit** and **Mark corrected…**.
- **The record page** shows the same block at the top.
- **On the Edit page**, the flagged fields carry an attention style and a small "Finance flagged this" line under the
  field (and under the document slot for documents). "Other" flags nothing on the form and shows the note at the top.
  Editing does **not** clear the send-back, as today.
- **Mark corrected…** opens a small box with **Reply to Finance**, which is optional (3–500 characters when given),
  then **Send to Finance**. This is today's `resubmitAssetToFinance`, plus the reply:
  - It clears `financeReturnedAt/ById`, `financeReturnReason` and `financeReturnFields`.
  - It stores `financeResubmitNote`.
  - The asset reads **With Finance** again.
  - The audit is `finance.resubmit` with the reply in the diff. The sentence is "{actor} marked {tag} corrected —
    "{reply}"".
- **When the reply is cleared:** `financeResubmitNote` is shown on Finance's review box. It is cleared by the next
  approval or send-back.
- **Who may do it:** the department that manages the class, as today (`canManageClass`). Who may edit is
  `canEditAsset`, as today.

### 3.5 The Registration column and filter (IT and Purchasing inventory)

- **The column:** a **Registration** column in `INVENTORY_COLUMNS`, hideable through the column chooser and shown by
  default.
- **The filter:** a facet called **Registration** in the list's filters. Its values are Needs correction · With
  Finance · Waiting for IT check · Fully registered, with counts. It is a URL parameter, `reg`.
- **The notice:** when any visible asset needs correction, a red notice above the list reads "{n} need correction —
  Finance sent them back. **Show them**", which applies `reg=needs-correction`.
- **On the record page:** the existing one-line finance state becomes the Registration status with the same labels.

### 3.6 A cost added later

**Cost added to a not-capitalised asset.** When IT or Purchasing saves a cost on an asset that was approved as not
capitalised, the same edit:
- clears `financeConfirmedAt/ById` and `financeNotCapitalised`, so the asset reads **With Finance** again;
- writes the audit `finance.reopened` ("{tag} went back to Finance: a cost was added").

Finance never reviewed that cost, and depreciation must start from an approval of it.

**Cost changed on an approved, capitalised asset.** This does not reopen the review. The numbers follow the current
cost (approach A's accepted trade-off, §5.2). The edit is already audited.

## 4. Part B — Finance's asset register

### 4.1 Assets list (`/finance/assets`)

- **Renamed.** The page title and the sidebar entry change from "Capitalized assets" to **Assets**. The sidebar
  section becomes **Assets & depreciation**, holding Assets · Depreciation · Activity log.
- **Rows:** **every asset** of the class (the IT · Purchasing tabs as today). Rows include assets with no cost and IT
  assets IT has not checked yet; neither filter exists any more.
- **Search:** tag, model, serial number or holder's name, as URL parameter `q`.
- **Filter chips by Finance state,** with counts. The parameter is `fin`:

  | Chip | Value |
  |---|---|
  | All | (no filter) |
  | To review | `with-finance` |
  | Sent back | `needs-correction` |
  | Waiting for IT | `awaiting-it` |
  | Approved | `registered` and capitalised |
  | Not capitalised | `registered` and not capitalised |
  | No cost | `cost` is null, in any state |

  The existing asset-status filter stays.
- **Order:** To review first (oldest registration first), then the rest by cost descending, tag, id. This keeps
  today's order for the rest.
- **Columns:** Tag (links to the Finance asset page) · Model (holder underneath) · Category · Status · **Finance** (the
  state pill) · Cost · **Depreciation to date** · **Book value** · row menu.
  - No cost shows "—" with "No cost recorded" under the book value.
  - Not capitalised shows the cost with "Not capitalised".
- **Row menu:** **Depreciation for this asset…** (§5.4), on capitalised assets only.
- **Footer:**
  - "{n} assets · {m} with a cost";
  - the cost, depreciation and book value totals over the capitalised rows that match the current tab, search and
    filters, not just the page;
  - "As of the end of {Month YYYY}".
- **Export** (`/finance/assets/export`) writes the current tab, search and filters, capped at `EXPORT_CAP`. File:
  `finance-assets-YYYY-MM-DD.xlsx`. The columns are:
  - Tag, Model, Category, Class, Status, Holder;
  - Registration, Cost, Confirmed on, Starts;
  - Life (months), Salvage, Monthly amount, Depreciation to date, Book value;
  - Basis (Category | Custom | —), Note (the state reason or the override reason).

  Money cells are empty when there is no cost.

### 4.2 Finance asset page (`/finance/assets/[id]`)

- **Access:** the Finance workspace (`admin`, `finance_staff`), under the existing `/finance` path rule.
- **Header:**
  - tag, model, category, class, serial number and the current holder;
  - the Status pill and the Finance pill;
  - the buttons **Depreciation settings…** (capitalised assets only) and **Export** (this asset's money summary and
    its full schedule, `asset-{tag}-YYYY-MM-DD.xlsx`).
- **Review box** (§3.2): only in `with-finance`.
- **Sections, top to bottom:**
  1. **Money summary.** Cost · Depreciation to date · Book value · Monthly amount · Salvage, plus a bar for the months
     used ("18 of 36 months · Apr 2025 → Mar 2028 · as of the end of September 2026"). The state reasons replace the
     numbers where §5.2 says so: No cost recorded · Not capitalised · Not depreciating yet · No policy for
     {category}.
  2. **Purchase.** Purchase request (link, approver, approved amount) · Requested by · Vendor · Invoice no. · OR no.
     · Purchase date · Delivery and fees · Warranty until · Covered by. Missing values read "Not recorded".
  3. **Capitalization & depreciation.** Approved by and on · Starts · Ends · Method (Straight-line) · Basis
     (category policy or custom override with its reason) · Override (None, or the values).
  4. **Documents.** The asset's documents by slot (Sales invoice, Official receipt, Warranty slip, Delivery receipt,
     others). Each opens through the existing document route; missing slots read "Not uploaded".
  5. **Depreciation schedule.**
     - One row per year of the asset's life: Year · Book value at start · Depreciation · Book value at end · "{n}
       done · {m} projected".
     - A year expands to its months. Months after the as-of month are greyed as projected.
     - The section is shown only for capitalised assets with a policy.
  6. **Financial history.** Audit entries for this asset with a money or registration action: registration with its
     cost, cost changes, Finance approve, send-back (items and note), resubmit (reply), reopen, depreciation
     override, and the category's policy changes. Each uses its existing `auditSentence`.
- **IT's record page stays as it is** for IT and Purchasing. Finance users can still open it read-only.

## 5. Part C — Depreciation

### 5.1 Who depreciates

**Included:** only assets that are **capitalised**:
- `cost` is not null;
- `financeNotCapitalised` is false.

**How the other assets show:**
- An asset with no cost reads "No cost recorded".
- A not-capitalised asset reads "Not capitalised".
- Neither counts in the book-value totals.

### 5.2 The calculation (one pure function, unit-tested)

All dates are Asia/Manila calendar months.

**Inputs per asset**
- `cost`: the asset's `cost`.
- `start`: the month **after** the month of `financeConfirmedAt`.
- `lifeMonths`: the asset override if set, else the category's.
- `salvage`: the asset override (pesos) if set, else `cost × category salvage % ÷ 100`, rounded to the centavo.

**Monthly amount**
- `base = cost − salvage`.
- `monthly = floor2(base ÷ lifeMonths)`, rounded **down** to the centavo.
- Months 1 to `lifeMonths − 1` of the life each charge `monthly`.
- The **last** month charges `base − monthly × (lifeMonths − 1)`, so the total is exactly `base`.
- Because `monthly` is rounded down, that last charge is never below `monthly` and never negative, even for tiny
  bases over long lives. (Rounding half-up could make it negative, e.g. ₱0.07 over 10 months.) The test pins this.

**Current values ("as of")**
- **As-of month:** the last completed month. On any day in October 2026 it is September 2026; a month's depreciation
  lands when that month ends.
- **Accumulated:** the sum of the charges for months `start … as-of month`, capped at `base`.
- **Book value:** `cost − accumulated`, never below `salvage`.
- **Fully depreciated:** when accumulated equals `base`.

**States** (the function returns one of these with its numbers or reason)

| State | When | Shown as |
|---|---|---|
| `depreciating` | approved, has a policy, months remain | the numbers |
| `fully-depreciated` | as above, life used up | the numbers + "Fully depreciated" |
| `not-started` | not yet approved by Finance, or the start month is after the as-of month | book value = cost, "Not depreciating yet" |
| `no-policy` | approved, but no life on the asset or its category | book value = cost, "No policy for {category}" |
| `bad-salvage` | the salvage is not below the cost (e.g. after a cost cut) | book value = cost, "Salvage is not below cost — check the override" |
| excluded | `cost` is null, or not capitalised | left out of every total ("No cost recorded" / "Not capitalised") |

**Schedule grid:** for year `Y`, the function also returns:
- each month's charge, January to December;
- the book value on 1 Jan (the accumulation through December of `Y − 1`);
- the book value on 31 Dec.

Months after the as-of month are **projected**: the same rule, flagged so the UI can grey them.

**Cost changed after approval:** the numbers follow the current cost, and past months change. This is the accepted
trade-off of approach A.

### 5.3 Settings data (migration 28; all fields optional, nothing backfilled)
- `AssetCategory.depreciationLifeMonths Int?`
- `AssetCategory.depreciationSalvagePercent Decimal(5,2)?`
- `Asset.depreciationLifeMonths Int?`
- `Asset.depreciationSalvage Decimal(12,2)?`
- `Asset.depreciationNote String?`: the override's reason.

An asset override is **both** fields or **neither**; a partial override is refused, and the CHECK
`Asset_depreciation_override_pair` enforces it.

### 5.4 Depreciation policies (`/finance/depreciation`, tab **Policies**)
- **Access:** the Finance workspace (`admin`, `finance_staff`), under the existing `/finance` path rule. A new sidebar
  entry, **Depreciation**.
- **Rows:** every category of both classes, including Uncategorised. The columns are Category · Class · Costed assets
  · Useful life · Salvage % · Last changed (who and when, read from the audit log).
- **Ordering:** categories without a policy sort first, under a notice: "{n} categories have no useful life yet —
  their assets show at full cost."
- **Editing:** each row edits inline. Life is entered as years plus months (0–50 and 0–11), and salvage as a % with
  up to 2 decimals; then **Save**.
  - Before saving a change that affects existing assets, the row shows "This updates the book value of {n} assets,
    including past months on the schedule."
  - Clearing both fields removes the policy.
- **Validation (server, zod):** life 1–600 months; salvage % ≥ 0 and < 100.
- **Audit:** `entityType "asset-category"`, `action "depreciation.policy"`, diff `{ lifeMonths, salvagePercent }`
  from → to.
- **`auditSentence` gains two sentences:**
  - "{actor} set depreciation on {category}: {life}, {salvage}% salvage";
  - "…cleared depreciation on {category}".

### 5.5 Per-asset override
- **Where:** the Assets list row menu (**Depreciation for this asset…**) and the asset page's **Depreciation
  settings…** open the same dialog. It shows:
  - the category's values, greyed;
  - Life (years + months) and Salvage (₱);
  - a required **Reason**;
  - a live preview of the monthly amount and the current book value;
  - **Save**, plus **Clear override** when one exists.
- **Validation:** life 1–600 months; salvage ≥ 0 and < the asset's cost; reason 3–300 characters. The asset must be
  capitalised.
- **Audit:** `entityType "asset"`. The action is `"depreciation.override"` (with a diff of life, salvage and note) or
  `"depreciation.override.cleared"`. Both get sentences.
- **Marking:** overridden rows show a small "custom" pill.

### 5.6 Finance home
A **Book value** stat beside **Capitalized**:
- the total book value of all capitalised assets, both classes;
- the sub-line "after {₱ depreciation} depreciation · as of {last day of the as-of month}";
- a link to the Assets list.

The home's waiting count gains **"{n} registrations to review"**, linking to `/finance/assets?fin=with-finance`.

### 5.7 Year schedule (`/finance/depreciation`, tab **Schedule**, the default tab)
- **Controls:** a year picker (from the earliest approval year to next year; default this year) and class tabs (IT ·
  Purchasing), as URL parameters `year` and `cls`.
- **Rows:** one per capitalised asset that charges depreciation in that year, or carries book value above salvage
  into it. Rows are grouped by category and ordered by category then tag, with a **subtotal row per category** and a
  **grand total**.
- **Columns:** Tag, Model, Category, Cost, Book value 1 Jan, Jan … Dec, Year total, Book value 31 Dec.
  - Months after the as-of month are styled as projected (muted, with a "projected" note in the header).
- **Not on the grid:** above it, a line counts the assets left out: "{n} assets aren't depreciating yet · {m} have no
  policy", linking to the Policies tab.
- **Wide table:** scrolls horizontally inside its own box, with the first two columns sticky.
- **Export:** `/finance/depreciation/export?year=&cls=` gives the same grid in one sheet, subtotal and total rows
  included (numbers as Excel numbers `#,##0.00`). File name: `depreciation-{cls}-{year}.xlsx`. Capped at
  `EXPORT_CAP`.

## 6. Data (migration 28, `20261015090000_registration_depreciation`)

| Table.column | Type | Purpose |
|---|---|---|
| `Asset.financeNotCapitalised` | `Boolean @default(false)` | Approved as not capitalised (§3.2) |
| `Asset.financeReturnFields` | `String[] @default([])` | The send-back checklist keys (§3.3) |
| `Asset.financeResubmitNote` | `String?` | IT's or Purchasing's reply (§3.4) |
| `Asset.depreciationLifeMonths` | `Int?` | Override life (§5.3) |
| `Asset.depreciationSalvage` | `Decimal(12,2)?` | Override salvage, in pesos |
| `Asset.depreciationNote` | `String?` | Override reason |
| `AssetCategory.depreciationLifeMonths` | `Int?` | Category life |
| `AssetCategory.depreciationSalvagePercent` | `Decimal(5,2)?` | Category salvage % |

**CHECK constraints:**
- `Asset_depreciation_override_pair` (both override fields or neither);
- `Asset_not_capitalised_needs_confirm` (`financeNotCapitalised` implies `financeConfirmedAt IS NOT NULL`);
- `Asset_not_capitalised_no_cost` (`financeNotCapitalised` implies `cost IS NULL`).

The cost-added rule (§3.6) clears the flag in the same write that sets the cost, so the last CHECK holds.

## 7. Not in this phase
- **Disposals:** no stop on disposal, no proceeds, no gain or loss.
- **Book value elsewhere:** not on IT's record page, nor in the employee or offboarding totals. Those keep today's
  cost sums.
- **Posting:** no journal or posting export, and no locked months or ledger.
- **Other methods:** declining-balance or any method other than straight-line.
- **Finance editing asset data.** Finance never edits a registration field.
- **Notifications.** Statuses and counts show in the lists and on home; nothing is emailed.

## 8. Testing
- **Unit tests (pure):**
  - `registrationState`: each state, the check order, and existing-data shapes (a returned asset with an empty
    field list).
  - `REGISTRATION_FIELDS`: unique keys, `other` present.
  - The depreciation function:
    - the start month (confirmed 31 Jan → starts February);
    - the as-of month on the 1st and on the last day of a month (Manila);
    - the last-month rounding absorption (e.g. ₱10,000 over 3 months = 3,333.33 + 3,333.33 + 3,333.34);
    - the salvage floor, the % → pesos rounding, override precedence;
    - each state, including excluded and not capitalised;
    - the year grid across a start in mid-year, a life ending mid-year, and fully depreciated before the year;
    - the opening and closing book values;
    - category subtotals equal the sum of their rows.
- **Zod schemas:**
  - The send-back: none ticked refused, an unknown key refused, "other" without a note refused.
  - The reply's bounds.
  - Life and salvage bounds; a partial override refused; salvage ≥ cost refused.
- **e2e (one new spec, `finance-registration-depreciation.spec.ts`):**
  - **Registration:**
    - IT registers an asset, which reads With Finance on IT's list.
    - Finance sends it back with two ticked items and a note; IT's list shows Needs correction with those items, and
      the Edit page flags those fields.
    - IT marks it corrected with a reply; Finance's review box shows the reply.
    - Finance approves; IT sees Fully registered.
    - An asset with no cost is approved as not capitalised, then IT adds a cost and it reads With Finance again.
  - **Register:**
    - Finance's Assets list includes assets with no cost and unchecked assets, and the `fin` chips filter it.
    - The asset page shows the money summary, documents, the schedule and history.
  - **Depreciation:**
    - Finance sets a Laptop policy, and the list shows depreciation and book value with correct totals.
    - An override changes one row and shows "custom"; clearing it reverts.
    - The home Book value stat appears.
    - The schedule for the current year marks projected months and has subtotals.
    - All three exports download with the expected header row.
  - **Access:** IT and Purchasing are refused at `/finance/assets/[id]` and `/finance/depreciation`.
  - **axe** passes on the Assets list, the asset page in review, both depreciation tabs, and IT's list with the
    Registration column.

## 9. Rulings taken while writing
1. **Review moves to Finance.** The confirm and send-back controls leave IT's record page, and Finance reviews only
   on its asset page, so there is one place with one checklist. *Cost if wrong: put a "Review" link or buttons back
   on the record page.*
2. **No backfill.** The four Registration states derive from today's columns, so day one puts every unconfirmed asset
   in To review, as the user chose. *Cost if wrong: a one-off migration UPDATE.*
3. **A cost added to a not-capitalised asset reopens the review**; a cost change on a capitalised asset does not.
   *Cost if wrong: one condition in the edit action.*
4. **The checklist is a code constant** that mirrors the edit form's fields, not an admin-editable list. *Cost if
   wrong: a small table plus an admin page.*
5. **The note becomes optional** (it is required for "Other"). Older send-backs keep their reasons as notes. *Cost if
   wrong: one zod rule.*
6. **Start month.** Depreciation starts the month **after** approval, in whole months only, which keeps it simple and
   conservative. *Cost if wrong: one off-by-one in the start rule.*
7. **"Current" means completed months.** The current month is not counted until it ends. *Cost if wrong: a one-line
   change of the as-of month.*
8. **Salvage units.** Salvage is a **percentage** on categories and a **peso amount** on overrides. *Cost if wrong:
   one field's unit.*
9. **Uncategorised** is listed on Policies like any category. *Cost if wrong: none.*
10. **Unapproved costed assets** show book value = cost and count in totals at full cost. *Cost if wrong: totals
    slightly higher than "approved only".*
