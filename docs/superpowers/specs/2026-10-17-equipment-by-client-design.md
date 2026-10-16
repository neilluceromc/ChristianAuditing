# Phase 38 — Equipment by client, and depreciation from the purchase month

**Status:** CODE-COMPLETE 2026-10-17 on branch `phase-38-equipment-by-client` (final code tree `649767f`), MERGED to `main` via `1b16921` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17; on staging 2026-10-17 at `a3cb693`. Designed 2026-10-17 with the user on the mockup canvas
(https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz, board "Equipment by client"). The user approved and said
to proceed through development. Merge, push and redeploy stay the user's calls. **No migration.**

## 1. What the user asked for, and why

After Phase 37 the app knows which client each person works for, but nothing reports on it.

**Report.** For an offshoring company the questions per client are:
- what kit their team holds;
- what it is worth;
- who is still missing something.

**Money is Finance's.** The user's words: "money columns can only be seen by finance". Admin already sees the
Finance workspace, so Admin sees them too (ruling 1). IT and viewers see counts and gaps only, on screen and in
the export.

**Depreciation counts the purchase month in full.** The user's words: "we received the item as of October 12,
this is also considered as 1 month already even the month still not finished". The user then chose the
**purchase / received date** to start depreciation (the asset's `purchasedAt`), falling back to the day Finance
approved it when no purchase date exists.

**Success** means:
- One page answers "kit, value, gaps" for 40 clients and 15 departments.
- Only Finance and Admin ever see a peso amount on it.
- Every book value in the app counts from the purchase month, with the current month already taken.

## 2. Depreciation rule change (applies everywhere)

### 2.1 The rule
- **Start month:**
  - the Asia/Manila calendar month of `purchasedAt`;
  - when `purchasedAt` is null, the month of `financeConfirmedAt`.

  That month is month 1, charged in full.
- **Only approved assets depreciate.** While `financeConfirmedAt` is null, the state stays `not-started`
  ("Not depreciating yet"). Once approved, the asset **catches up** from its start month: bought in July,
  approved in October, viewed in October = 4 months taken.
- **As-of month = the current month.** On any day in October 2026, October's charge is already taken.
  `asOfMonth(now)` returns `manilaMonth(now)`; it no longer subtracts one.
- **A purchase date in the future** gives a start after the as-of month, so the state is `not-started`.
- **Unchanged:**
  - the monthly amount (floored to the centavo, the last month takes the remainder);
  - salvage, policies and overrides;
  - the states;
  - the yearly schedule's shape. Months after the as-of month are still shown as projected; the current month
    is now actual, not projected.

### 2.2 One function decides the start
`depStartMonth(asset: { purchasedAt: Date | null; financeConfirmedAt: Date | null }): MonthIndex | null` in
`src/lib/depreciation.ts`.
- It returns null when `financeConfirmedAt` is null.
- Otherwise it returns `manilaMonth(purchasedAt ?? financeConfirmedAt)`.

`depreciate`, `yearGrid` and `lifeYears` take that start month (`start: MonthIndex | null`) instead of
`confirmedAt`; null means not approved. Every caller passes `depStartMonth(asset)`:
- the Finance asset register;
- the asset page;
- the schedule;
- the override dialog;
- Home's Finance card;
- the new report.

### 2.3 Words that change
- **Asset page money summary:** "as of the end of {month}" becomes "as of today ({month} counted)".
- **Home Finance card:** its "as of {month end}" label becomes "as of today".
- **Registration review's Approve text:** "Depreciation starts the following month" becomes "Depreciation runs
  from the purchase month".
- **Schedule:** the help line explains the current month is included.
- **Where the old wording is defined:** wherever the code holds the old sentence (grep `following month`,
  `as of the end`, `monthEndLabel`). `monthEndLabel` stays only if something else still needs it.

## 3. Equipment by client (`/equipment-by-client`)

### 3.1 Access
- **Who can read the page:** admin, it_staff, finance_staff and viewer.
  - `PATH_RULES`: `/^\/equipment-by-client/` → workspaces `["it","finance"]`, with those four roles.
- **Nav:**
  - IT → People lifecycle → **Equipment by client**, after Equipment policies;
  - Finance → **Equipment by client**, after Depreciation.
- **Who sees money** (`canSeeMoney(role)` in `src/lib/equipment-report.ts`): `admin` and `finance_staff` only. For
  anyone else the server does not compute or send any peso amount. The rule is enforced on the server, not only
  hidden in the UI. The same rule applies to the export.

### 3.2 What is counted
- **People:** employees whose employment is not OFFBOARDED, in **active** groups (`archivedAt` null), grouped by
  `departmentId`. The tab follows `Department.kind`.
- **Items:** IT-class assets currently assigned to those people (`assigneeId`). Every IT status that has a holder
  counts. TEMPORARY assets also count as **On loan**.
- **Gaps:** per person, the same `resolvePolicy` → `effectiveSlots` → `computeLoadout` used by the profile.
  - A person is "missing something" when `missingRequired > 0`.
  - The missing items' labels are the numbered slot labels (Phase 37 rule), e.g. "Headset, Monitor 2".
  - A group with no base policy and no rule matching anyone is "no policy". Its gaps are not tracked and show
    "—".
- **Money** (Finance and Admin only):
  - **Cost:** the sum of the assets' `cost`; null cost counts ₱0.
  - **Book value:** the sum of `depreciate(...)` book values under §2.
  - **Per person:** book value ÷ people.
  - Assets without a cost are counted in **"{n} without a cost"**.
  - Not-yet-approved assets count at cost, as on the register.

### 3.3 Layout (as on the board)
- **Header:** "Equipment by client", the line "What each client's team holds, what it is worth, and who is still
  missing something.", and **Export all (.xlsx)**.
- **Tabs:** Clients | Internal departments, each with its count of active groups. `?tab=client|internal`; the
  default is `client`.
- **Stat cards:**
  - Staff ("Client staff" / "Internal staff", with "{n} clients" / "{n} departments" underneath);
  - Items held (with "{x} per person");
  - **Book value today** (with "cost {total}"), Finance and Admin only;
  - People missing something (with "{p}% fully equipped"), red when above 0, green at 0.
- **Toolbar:**
  - a search box ("Find a client…" / "Find a department…"), matching a substring of the name;
  - filter buttons with counts: **All · With gaps · No policy**.
- **Table** (in its own scroll box, max height 470 px, sticky header). Columns:
  - Name, with a sub-line: "Client account" / "Internal department", or "No equipment policy — gaps not tracked"
    in amber;
  - People and Items;
  - **Book value** and **Per person** (Finance and Admin only);
  - **Equipped**: a bar plus "{p}%" and "{n} missing something" / "everyone equipped". Green at 100%, amber at 80%
    or more, red below that, "—" for no policy;
  - On loan (a count, or "—").
  - **Sortable:** Name (natural order), People, Items, Book value (money roles only) and Equipped.
  - **Default sort:** Book value descending for money roles, People descending otherwise.
  - Clicking a name selects the row, with `?group=<id>`.
- **Footer:**
  - "{shown} of {total} {clients|departments}.";
  - for money roles: "Book value is today's: the month an item was purchased counts as month 1 in full. Items
    without a cost count as ₱0 and are listed in the export.";
  - always: ""Equipped" = people with no required gap ÷ people."
- **Detail panel** (right column, 340 px, sticky; stacks under the table below 1024 px). It is shown while a group
  is selected and closes with ×, which clears `?group`.
  - **Header:** the kind label, the name, and "{people} people · {items} items", plus " · {book value}" for money
    roles.
  - **By category:** one row per IT category the group holds, with a bar, a count and (money roles) its book
    value, sorted by count descending.
  - **Missing something ({n}):** each person with a link to their profile, their employee no., and the missing
    labels. The first 20 are shown, then "and {n} more — see their staff". When there are none: "Everyone on
    {name} has their required kit."
  - **On loan:** "{n} items on loan — next due {d MMM}", or "Nothing on loan."
  - **Buttons:** **See their staff →** (`/employees?department=<id>`) and **Export {name} (.xlsx)**.
- **Empty states:**
  - no groups of the tab's kind: "No clients yet — add them on Departments & clients." (with a link);
  - the search or filter matches nothing: "Nothing matches."

### 3.4 Data
- **Server query:** `equipmentByGroup({ kind, withMoney, now })` in `src/server/modules/reports/equipment.ts`.
  - It loads every active group of the kind with its non-offboarded people and their IT assets: id, typeId,
    status, loanDueAt, cost, purchasedAt, financeConfirmedAt, and category name and depreciation policy fields
    when `withMoney`.
  - It also loads the policies (slots ordered by id) and the slot exceptions for those people.
- **Pure reduction:** a pure function in `src/lib/equipment-report.ts` (`summariseGroup`) does the per-group
  totals, so the numbers are unit-testable without a database.
- **Scale:** 600 people and 10,000 assets (Phase 36 measured) is one query set and an in-memory reduction. The
  page loads both tabs' counts but only the selected tab's rows. The detail uses the same reduction, filtered to
  one group.
- **Freshness:** all values are live, computed on request. Nothing is stored.

### 3.5 Export (`/equipment-by-client/export?tab=…[&group=<id>]`)
- **Format:** `.xlsx` via `toXlsxBuffer`, one row per item. The filename is `equipment-by-client-YYYY-MM-DD.xlsx`
  or `equipment-{group-slug}-YYYY-MM-DD.xlsx`.
- **Columns:**
  - Works for, Staff (Internal/Client), Person, Employee no., Category, Type, Tag, Model, Serial, Status;
  - **Purchased** and Held since (the newest assignment audit date, as the side panel computes it; blank when
    unknown);
  - On loan until;
  - **Cost** and **Book value**, for money roles only. These two columns are absent, not blank, for other roles.
- **One sheet only:** people with gaps are on the page, not in this export.
- **Auth:** `requireRole` with the page's four roles. Money columns only via `canSeeMoney`.

## 4. Testing

### 4.1 Unit (vitest)
- **`depStartMonth`:**
  - purchase date beats approval;
  - null purchase date falls back to approval;
  - not approved gives null;
  - Manila month boundary: 2026-09-30T17:00Z is 1 Oct in Manila.
- **`depreciate` / `yearGrid` / `lifeYears` under the new rule:**
  - bought 12 Oct, viewed 17 Oct = 1 month taken, matching the user's example: ₱52,000 over 36 months, no salvage,
    gives book value ₱50,555.56;
  - bought July, approved October = 4 months;
  - a future purchase date gives `not-started`;
  - the current month is not projected in `yearGrid`.

  Update the existing Phase 35 tests to the new rule.
- **`asOfMonth`** returns the current month.
- **`canSeeMoney`:** true for admin and finance_staff only.
- **`summariseGroup`:**
  - people, items, loans, missing people and labels;
  - equipped % (100 when there are no people);
  - no-policy groups;
  - money totals with null costs;
  - **no money fields at all when `withMoney` is false.**

### 4.2 E2E (`e2e/equipment-by-client.spec.ts`; run only in the final battery)
1. **Finance** sees "Book value today", the Book value column, and a client row's book value; selecting
   "Bluepeak Telecom" shows By category with values.
2. **IT** sees no ₱ anywhere on the page (assert no text matching `/₱/`) and no Book value column.
3. **IT's export** has no Cost or Book value header; **Finance's export** has both.
4. **Gaps:** a client hire with one gap appears under "With gaps", and its name and missing label show in the
   detail.
5. **Axe** on the page for IT and Finance.

**Depreciation e2e:** `finance-registration-depreciation.spec.ts` assertions that encode the old start or as-of
rule are updated. An asset purchased this month and approved shows one month taken.

## 5. Rulings taken while writing
1. **Admin counts as Finance for money,** because Admin already sees the Finance workspace and its register.
   *Cost if wrong:* Admin sees amounts the user meant only for Finance.
2. **IT-class assets only** are counted, because equipment policies and gaps are IT-only and Purchasing-class
   items (cars, furniture) would distort "kit per person". *Cost if wrong:* a client's non-IT holdings are
   invisible here (they stay on each profile and record).
3. **Money is never sent to non-money roles** (computed server-side and omitted), not just hidden with CSS.
4. **Unapproved assets depreciate only after approval**, but catch up from the purchase month once approved.
   This keeps Finance's review as the gate while honouring the purchase-month rule. *Cost if wrong:* book values
   jump at approval for items approved late.
5. **"Held since" in the export** reuses the side panel's audit lookup. It is blank when no assignment audit
   exists, e.g. imported holders.
6. **No "as of a past date".** The page and export are live. A dated snapshot would need history rebuilding and
   was not asked for.
