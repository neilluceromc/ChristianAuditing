# Phase 35 — Depreciation (book value for Finance)

**Status:** designed 2026-10-15 with the user; awaiting the user's review before the plan. **One migration (the 28th).**

## 1. What the user asked for, and why

Finance wants to **know what each asset is worth now**: its book value, meaning cost less depreciation. This is not
about posting journal entries; the app is the source of the numbers, not a ledger.

The user's choices:
- **Method and start:** straight-line, starting from **Finance's confirmation** of the asset (`financeConfirmedAt`).
- **Settings:** useful life and salvage are set **per category by Finance**, and Finance can **override them on a
  single asset**.
- **Disposals are ignored for now.** Every costed asset keeps depreciating until it is fully depreciated, whatever its
  status.
- **Where book value shows:** Finance's **Approved assets** list (with totals and an export) and the **Finance home**.
  The record page and the employee and offboarding "book value" totals are not part of this phase.
- **A full-year schedule:** a 12-month grid per asset for a chosen year, exportable to Excel.
- **How it is built:** calculated on the fly (approach A). Only the settings are stored. There is no monthly ledger
  and no background job.

Success means that Finance sees a correct current book value for every costed asset and a year schedule that adds
up. Assets that cannot be calculated say why instead of showing a made-up number.

## 2. The calculation (one pure function, unit-tested)

All dates are Asia/Manila calendar months.

**Inputs per asset**
- `cost`: the asset's `cost`.
- `start`: the month **after** the month of `financeConfirmedAt`.
- `lifeMonths`: the asset override if set, else the category's.
- `salvage`: the asset override (pesos) if set, else `cost × category salvage % ÷ 100`, rounded to the centavo.

**Monthly amount**
- `base = cost − salvage`, and `monthly = floor2(base ÷ lifeMonths)`, rounded **down** to the centavo.
- Month `k` of the life (1…`lifeMonths`) charges `monthly`.
- The **last** month charges `base − monthly × (lifeMonths − 1)`, so the total is exactly `base`. Because `monthly`
  is rounded down, that last charge is never below `monthly` and never negative, even for tiny bases over long lives
  (rounding half-up could make it negative, e.g. ₱0.07 over 10 months). The test pins this.

**Current values ("as of")**
- **As-of month:** the last completed month. On any day in October 2026 it is September 2026; a month's depreciation
  lands when that month ends.
- **Accumulated:** the sum of the charges for months `start … as-of month`, capped at `base`.
- **Book value:** `cost − accumulated`, never below `salvage`.
- **Fully depreciated:** when accumulated equals `base`.

**States** (the function returns one of these with its numbers or reason)

| State | When | Shown as |
|---|---|---|
| `depreciating` | confirmed, has a policy, months remain | the numbers |
| `fully-depreciated` | as above, life used up | the numbers + "Fully depreciated" |
| `not-started` | not yet confirmed by Finance, or the start month is after the as-of month | book value = cost, "Not depreciating yet" |
| `no-policy` | confirmed, but no life on the asset or its category | book value = cost, "No policy for {category}" |
| excluded | `cost` is null | left out of every total (as today's Approved assets list already does) |

**Schedule grid:** for year `Y`, the function also returns each month's charge (Jan–Dec), the book value on 1 Jan
(the accumulation through December of `Y − 1`) and the book value on 31 Dec. Months after the as-of month are
**projected**: the same rule, flagged so the UI can grey them.

**Cost changed after confirmation:** the numbers follow the current cost, and past months change. This is the
accepted trade-off of approach A.

## 3. Settings

### 3.1 Data (migration 28, all fields optional, nothing backfilled)
- `AssetCategory.depreciationLifeMonths Int?`
- `AssetCategory.depreciationSalvagePercent Decimal(5,2)?`
- `Asset.depreciationLifeMonths Int?`
- `Asset.depreciationSalvage Decimal(12,2)?`
- `Asset.depreciationNote String?`: the override's reason.

An asset override is **both** fields or **neither**. A partial override is refused.

### 3.2 Depreciation policies page (`/finance/depreciation`, tab **Policies**)
- **Access:** the Finance workspace (`admin`, `finance_staff`), under the existing `/finance` path rule. A new sidebar
  entry, **Depreciation**.
- **Rows:** every category of both classes, including Uncategorised. The columns are Category · Class · Costed assets
  · Useful life · Salvage % · Last changed (who, when; read from the audit log).
- **Ordering:** categories without a policy sort first, under a notice: "{n} categories have no useful life yet —
  their assets show at full cost."
- **Editing:** each row edits inline. Life is entered as years plus months (0–50 and 0–11), salvage as a % with up to
  2 decimals; then **Save**.
  - Before saving a change that affects existing assets, the row shows "This updates the book value of {n} assets,
    including past months on the schedule."
  - Clearing both fields removes the policy.
- **Validation (server, zod):** life 1–600 months; salvage % ≥ 0 and < 100.
- **Audit:** `entityType "asset-category"`, `action "depreciation.policy"`, diff `{ lifeMonths, salvagePercent }`
  from → to. `auditSentence` gains: "{actor} set depreciation on {category}: {life}, {salvage}% salvage", or "…cleared
  depreciation on {category}".

### 3.3 Per-asset override
- **Where:** a row-menu item on Finance's Approved assets list, **Depreciation for this asset…**, opens a dialog. It
  shows:
  - the category's values, greyed;
  - Life (years + months) and Salvage (₱);
  - a required **Reason**;
  - **Save**, plus **Clear override** when one exists.
- **Validation:** life 1–600 months; salvage ≥ 0 and < the asset's cost; reason 3–300 characters.
- **Audit:** `entityType "asset"`, `action "depreciation.override"` (diff of life, salvage and note) or
  `"depreciation.override.cleared"`. Both get sentences.
- **Marking:** overridden rows show a small "custom" pill.

## 4. Where book value shows

### 4.1 Approved assets (`/finance/assets`)
- **New columns:** **Depreciation to date** and **Book value**. Under the book value, rows in the `not-started`,
  `no-policy` or `fully-depreciated` state show their reason in small muted text.
- **Footer:** the cost total, plus **Depreciation total** and **Book value total** over every row matching the
  current tab and filter, not just the page. Then the line "As of the end of {Month YYYY}".
- **Export:** **Export** (`/finance/assets/export`) writes the current tab and filter to Excel (the house
  `toXlsxBuffer` / `xlsxResponse`, capped at `EXPORT_CAP`).
  - Columns: Tag, Model, Category, Class, Status, Cost, Confirmed on, Starts, Life (months), Salvage, Monthly amount,
    Depreciation to date, Book value, Basis (Category | Custom), Note (the state reason or the override reason).
  - File name: `finance-book-value-YYYY-MM-DD.xlsx`.

### 4.2 Finance home
A **Book value** stat beside **Capitalized**: the total book value of all costed assets (both classes), with the
sub-line "after {₱ depreciation} depreciation · as of {last day of the as-of month}". It links to the Approved assets
list.

### 4.3 Year schedule (`/finance/depreciation`, tab **Schedule**, the default tab)
- **Controls:** year picker (from the earliest confirmation year to next year; default this year) and class tabs
  (IT · Purchasing), as URL parameters `year` and `cls`.
- **Rows:** one per asset that charges depreciation in that year, or carries book value above salvage into it. Grouped
  by category, ordered by category then tag, with a **subtotal row per category** and a **grand total**.
- **Columns:** Tag, Model, Category, Cost, Book value 1 Jan, Jan … Dec, Year total, Book value 31 Dec.
  - Months after the as-of month are styled as projected (muted, with a "projected" note in the header).
- **Not on the grid:** above it, a line counts the assets left out: "{n} assets aren't depreciating yet · {m} have no
  policy", linking to the Policies tab.
- **Wide table:** scrolls horizontally inside its own box, with the first two columns sticky.
- **Export:** `/finance/depreciation/export?year=&cls=` gives the same grid in one sheet, subtotal and total rows
  included (numbers as Excel numbers `#,##0.00`). File name: `depreciation-{cls}-{year}.xlsx`. Capped at
  `EXPORT_CAP`.

## 5. Not in this phase
- **Disposals:** no stop on disposal, no proceeds, no gain or loss.
- **Book value elsewhere:** not on the asset record page, nor in the employee or offboarding totals; those keep
  today's cost sums.
- **Posting:** no journal or posting export, and no locked months or ledger.
- **Other methods:** declining-balance or any method other than straight-line.

## 6. Testing
- **Unit tests** (the pure function and its helpers):
  - the start month (confirmed 31 Jan → starts February);
  - the as-of month on the 1st and on the last day of a month (Manila);
  - the last-month rounding absorption (e.g. ₱10,000 over 3 months = 3,333.33 + 3,333.33 + 3,333.34);
  - the salvage floor, the % → pesos rounding, override precedence;
  - each state;
  - the year grid across a start in mid-year, a life ending mid-year, and fully depreciated before the year;
  - the opening and closing book values;
  - category subtotals equal the sum of their rows.
- **Zod schemas:** the life/salvage bounds, a partial override refused, salvage ≥ cost refused.
- **e2e (one new spec):**
  - Finance sets a Laptop policy and the Approved assets list shows depreciation and book value with correct
    totals;
  - an override changes one row and shows "custom"; clearing it reverts;
  - the home Book value stat;
  - the schedule for the current year (projected months marked, subtotals);
  - both exports download with the expected header row;
  - IT and Purchasing are refused at `/finance/depreciation`;
  - axe passes on both tabs.

## 7. Rulings taken while writing
1. **Start month.** Depreciation starts the month **after** confirmation, and whole months only, which keeps it
   simple and conservative. *Cost if wrong: one off-by-one in the start rule.*
2. **"Current" means completed months.** The current month is not counted until it ends. *Cost if wrong: a one-line
   change of the as-of month.*
3. **Salvage units.** Salvage is a **percentage** on categories and a **peso amount** on overrides. *Cost if wrong:
   one field's unit.*
4. **Uncategorised.** It is listed on Policies like any category. *Cost if wrong: none.*
5. **Unconfirmed assets.** An unconfirmed asset shows book value = cost and counts in totals at full cost. *Cost if
   wrong: totals slightly higher than "confirmed only".*
