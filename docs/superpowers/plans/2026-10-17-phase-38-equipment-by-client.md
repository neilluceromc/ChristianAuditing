# Phase 38 — Equipment by client, and depreciation from the purchase month — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One page reports each client's (and department's) kit, value and gaps, and only Finance and Admin see
money. Every book value in the app counts from the purchase month, with the current month taken.

**Architecture:**
- **Depreciation:** one new pure function, `depStartMonth`, decides the start month. `depreciate`, `yearGrid` and
  `lifeYears` take that start month, and `asOfMonth` becomes the current month.
- **The report:** pure reductions in `src/lib/equipment-report.ts` (unit-tested), one server query module
  `src/server/modules/reports/equipment.ts`, a server page at `/equipment-by-client` with a client table and a
  detail panel, and an `.xlsx` export route.
- **Money:** computed only when `canSeeMoney(role)`.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / Postgres 16, zod 4, vitest, Playwright + axe (run only in the
final battery).

**Spec:** `docs/superpowers/specs/2026-10-17-equipment-by-client-design.md` (`8391e22`) is the authority. The
mockup is the "Equipment by client" board on https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz. Implementers
cannot open it; the values they need are here.

## Global Constraints

**Where the work happens**
- Work in the worktree `.claude/worktrees/phase-38-equipment-by-client`, on branch `phase-38-equipment-by-client`.
- `.env` there points at `inventory_dev` with `APP_BASE_URL=http://192.168.1.193:3100`, and has no `SEED_PASSWORD`
  or `QUICK_LOGIN_EMAILS`.
- Never read or print `.env`. Never touch the `inventory` database or port 3000.

**Browser tests (user instruction since the 2026-10-17 crash)**
- Implementers never run Playwright or a dev server. They write and update e2e specs, make them type-check
  (`npx tsc --noEmit` covers `e2e/`), and list the cases they did not run.
- The controller runs the whole suite once, in Task 6, in foreground chunks:
  `E2E_PORT=3100 npx playwright test <≤7 files> --workers=1 --global-timeout=540000`, with port 3100 checked
  before and after each chunk.

**Database**
- No migration in this phase.
- Never run `prisma migrate dev` or `migrate reset`.
- `npm run db:seed` runs only on `inventory_dev`, and only in the battery.

**Git**
- Never amend. Never run `git stash`, `checkout`, `restore`, `reset` or `switch`.
- The commit trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files are CRLF and UTF-8 (`core.autocrlf=true`). Use the Edit tool, never `sed -i`; new files are CRLF.

**House rules**
- Server actions follow `actionRole` → `checkRate` → zod. Pages and routes use `requireRole` / `requireUser`.
- Product aria-labels near a field never contain that field's label word.
- UI copy uses they/them.
- An exact `getByLabel` never matches a required field (the aria-hidden "*"); e2e uses `getByRole` with an exact
  name.

**Spec values (verbatim)**
- **Start month:** `depStartMonth({ purchasedAt, financeConfirmedAt })` returns null when `financeConfirmedAt` is
  null, otherwise `manilaMonth(purchasedAt ?? financeConfirmedAt)`. That month is month 1, charged in full.
- **`asOfMonth(now)`** = `manilaMonth(now)`, the current month (the current month is actual, not projected).
- **The user's example:** ₱52,000, 36 months, no salvage, bought 12 Oct 2026, approved, viewed 17 Oct 2026 → 1
  month taken, monthly ₱1,444.44, book value ₱50,555.56.
- **Wording:**
  - asset page: "as of today ({Month YYYY} counted)";
  - Home Finance card: "as of today";
  - Approve text: "Depreciation runs from the purchase month";
  - override dialog: "It depreciates from {Month YYYY}, the purchase month." when there is a start, or "It starts
    depreciating once Finance approves it, from the purchase month." when there is none.
- **Page:** `/equipment-by-client`.
  - Readable by admin, it_staff, finance_staff and viewer.
  - Workspaces it and finance.
  - Nav: IT → People lifecycle → "Equipment by client" after "Equipment policies"; Finance → "Equipment by
    client" after "Depreciation".
- **Money:** `canSeeMoney(role)` is true for `admin` and `finance_staff` only. Otherwise no peso amount is
  computed, sent or exported.
- **Counted:**
  - people whose employment is not OFFBOARDED, in active groups (`archivedAt` null);
  - IT-class assets assigned to them;
  - On loan = status TEMPORARY;
  - "missing something" = `missingRequired > 0`, with the profile's numbered labels.
- **Copy:**
  - title "Equipment by client";
  - subtitle "What each client's team holds, what it is worth, and who is still missing something.";
  - "Export all (.xlsx)";
  - stats "Client staff" / "Internal staff", "Items held", "Book value today", "People missing something";
  - filters "All", "With gaps", "No policy";
  - the no-policy sub-line "No equipment policy — gaps not tracked";
  - "everyone equipped" / "{n} missing something";
  - the footer money line "Book value is today's: the month an item was purchased counts as month 1 in full. Items
    without a cost count as ₱0 and are listed in the export.";
  - "\"Equipped\" = people with no required gap ÷ people.";
  - detail: "Everyone on {name} has their required kit.", "{n} items on loan — next due {d MMM}", "Nothing on
    loan.", "See their staff →", "Export {name} (.xlsx)", "and {n} more — see their staff";
  - empty: "No clients yet — add them on Departments & clients." and "Nothing matches.".
- **Equipped colours:** 100% green, ≥80% amber, <80% red, "—" for no policy.
- **Export columns:**
  - Works for, Staff, Person, Employee no., Category, Type, Tag, Model, Serial, Status, Purchased, Held since,
    On loan until;
  - plus Cost and Book value for money roles only (absent otherwise);
  - filenames `equipment-by-client-YYYY-MM-DD.xlsx` and `equipment-{slug}-YYYY-MM-DD.xlsx`.

## Review Focus

1. **A viewer or IT user calling the export or reading the page source.** No peso amount or cost field appears
   anywhere: not in the RSC payload, not in the export. *(Task 2 unit: `summariseGroup` omits money when
   `withMoney` is false. Task 5 e2e: no `₱` on the page and no Cost header for IT.)*
2. **An asset with a purchase date in the future, or no purchase date.** The first is `not-started`; the second
   starts from the approval month. *(Task 1 units.)*
3. **A group whose people hold nothing, or a group with no people.** Equipped reads 100% (or "—" for no policy)
   with no NaN or division by zero, and Per person is ₱0. *(Task 2 units.)*
4. **A client ended (archived) while it still has staff.** It disappears from the report, and its staff are not
   counted under another group. *(Task 2/3: the active-group filter; Task 5 e2e.)*
5. **Over 10,000 items in "Export all".** The export honours the app's `EXPORT_CAP` with the usual `capRefusal`
   instead of building a huge sheet. *(Task 4.)*

---

### Task 1: Depreciation from the purchase month

**Files:**
- Modify: `src/lib/depreciation.ts`, `src/lib/depreciation.test.ts`
- Modify: `src/server/modules/finance/asset-detail.ts`, `src/server/modules/finance/depreciation-queries.ts`,
  `src/components/finance/override-dialog.tsx`, `src/server/modules/home/queries.ts`,
  `src/app/(app)/page.tsx`, `src/app/(app)/finance/assets/[id]/page.tsx`, `src/components/finance/review-box.tsx`,
  and any other caller of `depreciate` / `yearGrid` / `lifeYears` / `asOfMonth` / `monthEndLabel` (grep)
- Modify: `e2e/finance-registration-depreciation.spec.ts` (and any e2e asserting the old wording or numbers; grep
  for "following month", "as of the end", "next month", "Not depreciating yet") — not run

**Interfaces:**
- Produces:
  - `depStartMonth(asset: { purchasedAt: Date | null; financeConfirmedAt: Date | null }): MonthIndex | null`
  - `depreciate(cost, start: MonthIndex | null, policy, asOf)`
  - `yearGrid(cost, start, policy, year, asOf)`
  - `lifeYears(cost, start, policy, asOf)`
  - `asOfMonth(now) = manilaMonth(now)`

- [ ] **Step 1: Write the failing tests** (add to `src/lib/depreciation.test.ts`; Manila is UTC+8)

```ts
import { asOfMonth, depStartMonth, depreciate, lifeYears, manilaMonth, yearGrid } from "./depreciation";

const at = (iso: string) => new Date(iso);
const policy36 = { lifeMonths: 36, salvage: 0, basis: "category" as const };

describe("Phase 38 — depreciation from the purchase month", () => {
  it("asOfMonth is the current Manila month", () => {
    expect(asOfMonth(at("2026-10-17T04:00:00Z"))).toBe(manilaMonth(at("2026-10-17T04:00:00Z")));
  });
  it("depStartMonth: purchase beats approval, approval is the fallback, unapproved is null", () => {
    expect(depStartMonth({ purchasedAt: at("2026-07-05T00:00:00Z"), financeConfirmedAt: at("2026-10-14T00:00:00Z") })).toBe(2026 * 12 + 6);
    expect(depStartMonth({ purchasedAt: null, financeConfirmedAt: at("2026-10-14T00:00:00Z") })).toBe(2026 * 12 + 9);
    expect(depStartMonth({ purchasedAt: at("2026-07-05T00:00:00Z"), financeConfirmedAt: null })).toBeNull();
  });
  it("uses the Manila calendar month", () => {
    expect(depStartMonth({ purchasedAt: at("2026-09-30T17:00:00Z"), financeConfirmedAt: at("2026-10-01T00:00:00Z") })).toBe(2026 * 12 + 9);
  });
  it("the user's example: bought 12 Oct, viewed 17 Oct → one month taken", () => {
    const start = depStartMonth({ purchasedAt: at("2026-10-12T02:00:00Z"), financeConfirmedAt: at("2026-10-14T02:00:00Z") });
    const r = depreciate(5_200_000, start, policy36, asOfMonth(at("2026-10-17T04:00:00Z")));
    expect(r.state).toBe("depreciating");
    expect(r.monthly).toBe(144_444);
    expect(r.accumulated).toBe(144_444);
    expect(r.bookValue).toBe(5_055_556);
  });
  it("catches up from the purchase month once approved (July → October = 4 months)", () => {
    const start = depStartMonth({ purchasedAt: at("2026-07-10T02:00:00Z"), financeConfirmedAt: at("2026-10-14T02:00:00Z") });
    expect(depreciate(3_600_000, start, policy36, asOfMonth(at("2026-10-17T04:00:00Z"))).accumulated).toBe(400_000);
  });
  it("a future purchase date has not started; unapproved has not started", () => {
    const future = depStartMonth({ purchasedAt: at("2026-12-01T02:00:00Z"), financeConfirmedAt: at("2026-10-14T02:00:00Z") });
    expect(depreciate(100_000, future, policy36, asOfMonth(at("2026-10-17T04:00:00Z"))).state).toBe("not-started");
    expect(depreciate(100_000, null, policy36, asOfMonth(at("2026-10-17T04:00:00Z"))).state).toBe("not-started");
  });
  it("the current month is actual, not projected", () => {
    const start = 2026 * 12 + 9; // October 2026
    const row = yearGrid(3_600_000, start, policy36, 2026, asOfMonth(at("2026-10-17T04:00:00Z")))!;
    expect(row.projected[9]).toBe(false);
    expect(row.projected[10]).toBe(true);
    expect(lifeYears(3_600_000, start, policy36, asOfMonth(at("2026-10-17T04:00:00Z")))[0].months[0].projected).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/depreciation.test.ts`. Expected: FAIL. `depStartMonth` is missing, and the
signatures take dates.

- [ ] **Step 3: Implement it in `src/lib/depreciation.ts`**
  - `asOfMonth(now)` returns `manilaMonth(now)`. Update its doc comment.
  - Add `depStartMonth` exactly as specified.
  - `depreciate`, `yearGrid` and `lifeYears` take `start: MonthIndex | null` in place of `confirmedAt`, with null
    meaning not approved (`not-started`, `null` and `[]` respectively). Remove the internal
    `manilaMonth(confirmedAt) + 1`.
  - Update the Phase 35 tests in the same file to the new rule. Where a test encoded "the month after approval"
    or "the last completed month", recompute its expectations and say so in a comment. Never delete a test to
    make it pass.

- [ ] **Step 4: Update the callers and the wording**
  - **Asset loads:** every call site passes `depStartMonth({ purchasedAt, financeConfirmedAt })`. Add
    `purchasedAt` to each query's `select` if it is missing.
  - **Asset page:** reads "as of today ({monthLabel(asOf)} counted)".
  - **Home Finance stat hint:** reads "as of today". Remove `asOfEnd` from the home queries if nothing else uses it,
    and drop `monthEndLabel` if it becomes unused.
  - **Approve copy** (`review-box.tsx`): "Approve to start depreciation next month" becomes "Approve to start
    depreciation from the purchase month". The plain sentence elsewhere is "Depreciation runs from the purchase
    month".
  - **Override dialog:** uses the two sentences from Global Constraints.
  - **`e2e/finance-registration-depreciation.spec.ts`** and any other spec with the old wording or numbers:
    update the expectations, unrun. Note in the report every expectation you recomputed and how.

- [ ] **Step 5: Run unit, tsc and lint**

Run: `npx vitest run`, `npx tsc --noEmit` and `npm run lint`. Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add -A src e2e
git commit -m "feat(depreciation): start from the purchase month (approval month as fallback), counted in full, and the current month is taken; wording follows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Run `git status --short` before `-A`.)

---

### Task 2: The report's pure rules

**Files:**
- Create: `src/lib/equipment-report.ts`, `src/lib/equipment-report.test.ts`

**Interfaces:**
- Consumes:
  - `resolvePolicy`, `effectiveSlots`, `computeLoadout`, `numberSlotLabels` (`src/lib/loadout.ts`);
  - `depreciate`, `depStartMonth`, and the depreciation `resolvePolicy` (`src/lib/depreciation.ts`; import it with
    an alias, because both files export a `resolvePolicy`).
- Produces:

```ts
export type MoneyRole = "admin" | "it_staff" | "purchasing_staff" | "finance_staff" | "viewer";
export function canSeeMoney(role: string): boolean; // admin | finance_staff
export interface ReportAsset { id: string; tag: string; typeId: string | null; categoryName: string; status: string; loanDueAt: Date | null;
  costC: number | null; purchasedAt: Date | null; financeConfirmedAt: Date | null; dep: { lifeMonths: number | null; salvage: number | null; catLifeMonths: number | null; catSalvagePercent: number | null } }
export interface ReportPerson { id: string; name: string; employeeNo: string; title: string; slots: Array<{ id: string; name: string; assetTypeId: string | null; required: boolean; loaner: boolean; exceptionId?: string }>; hasPolicy: boolean; assets: ReportAsset[] }
export interface GroupSummary {
  id: string; name: string; kind: "INTERNAL" | "CLIENT"; people: number; items: number; loans: number; nextLoanDue: Date | null;
  noPolicy: boolean; missing: Array<{ id: string; name: string; employeeNo: string; labels: string[] }>; equippedPct: number | null;
  byCategory: Array<{ name: string; count: number; bookC?: number }>;
  money?: { costC: number; bookC: number; perPersonC: number; withoutCost: number };
}
export function summariseGroup(group: { id: string; name: string; kind: "INTERNAL" | "CLIENT" }, people: ReportPerson[], opts: { withMoney: boolean; asOf: number }): GroupSummary;
```

Rules (spec §3.2):
- **items:** all assets.
- **loans:** status `TEMPORARY`. `nextLoanDue` is the earliest `loanDueAt` among them.
- **missing:** people whose `computeLoadout(slots, assets).missingRequired > 0`. Their labels are the numbered
  labels of the empty required slots that are not covered by a loan.
- **equippedPct:**
  - null when `noPolicy`;
  - 100 when people = 0;
  - otherwise round(100 × (people − missing) ÷ people).
- **noPolicy:** true when no person in the group `hasPolicy`.
- **byCategory:** sorted by count descending, then name.
- **money (only when `withMoney`):**
  - the book value of each asset uses `depreciate(costC ?? 0, depStartMonth(asset), depPolicy, asOf).bookValue`;
  - `costC` null counts as 0 and adds to `withoutCost`;
  - `perPersonC` = round(bookC ÷ max(people, 1)).
- **When `withMoney` is false,** the returned object has **no** `money` key and no `bookC` on `byCategory`. The
  test checks this with `toEqual` and `"money" in result === false`.

- [ ] **Step 1: Write failing tests.** Cover each rule above plus Review Focus 3:
  - a group with no people;
  - a group whose people hold nothing.

  Build `ReportPerson` fixtures inline. Use the same slot and asset shapes as `src/lib/loadout.test.ts`.

- [ ] **Step 2: Run the tests and watch them fail.** Then implement, then get them passing.

- [ ] **Step 3: Run unit, tsc and lint, then commit**

```bash
git add src/lib/equipment-report.ts src/lib/equipment-report.test.ts
git commit -m "feat(report): equipment-by-group rules — counts, loans, gaps with numbered labels, equipped %, money only for Finance/Admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The page, its query and the nav

**Files:**
- Create: `src/server/modules/reports/equipment.ts`
- Create: `src/app/(app)/equipment-by-client/page.tsx`
- Create: `src/components/reports/equipment-table.tsx` (client: tabs, search, filters, sort)
- Create: `src/components/reports/group-detail.tsx`
- Modify: `src/lib/workspaces.ts` (+ its test): the nav items and the `PATH_RULES` entry

**Interfaces:**
- Consumes: `summariseGroup`, `canSeeMoney` (Task 2); `depStartMonth`, `asOfMonth` (Task 1).
- Produces: `equipmentByGroup({ kind, withMoney, now }): Promise<{ groups: GroupSummary[]; counts: { client: number; internal: number }; totals: {...} }>`
  - It loads every active group of `kind`, its non-OFFBOARDED people, and their IT-class assets.
  - The policies come with slots `orderBy: { id: "asc" }`, plus the people's slot exceptions.
  - It builds `ReportPerson` with `effectiveSlots(resolvePolicy(person, policies)?.slots ?? [], exceptions)`.
  - It reduces each group with `summariseGroup`.
  - Money fields (`cost`, `purchasedAt`, depreciation fields) are selected only when `withMoney`.

- [ ] **Step 1: Query module.** Select only the fields `summariseGroup` needs, and keep the queries count
  constant (no per-group loops of queries). Totals are the sums across groups:
  - people, items, missing;
  - `fullyPct` = round(100 × (people − missing) ÷ max(people, 1));
  - money totals only when `withMoney`.

- [ ] **Step 2: Page** (server).
  - **Auth:** `requireRole("admin","it_staff","finance_staff","viewer")`; `withMoney = canSeeMoney(user.role)`.
  - **Params:** `?tab=client|internal` (default `client`), `?group=<id>`. A missing or unknown group shows no
    panel.
  - **Layout** is spec §3.3: the header and the "Export all (.xlsx)" link to `/equipment-by-client/export?tab=…`;
    the tabs, with counts from both kinds (cheap counts); the stat cards (the "Book value today" card only when
    `withMoney`); then a grid of `minmax(0,1fr) 340px` that stacks below `lg`, holding `EquipmentTable` and
    `GroupDetail`.
  - The page never passes money props when `withMoney` is false.

- [ ] **Step 3: `equipment-table.tsx`** (client).
  - Search, the three filters with counts, and sortable headers with `aria-sort`.
  - Sort defaults: Book value descending when money is present, else People descending.
  - Rows with the Equipped bar, colours as in Global Constraints.
  - The selected row is highlighted. Clicking a name sets `?group=` with `router.replace` and keeps `tab`.
  - The scroll box is `max-h-[470px] overflow-auto` with a sticky header.
  - The footer lines as in Global Constraints.
  - The two empty states.

- [ ] **Step 4: `group-detail.tsx`** (server or client).
  - Spec §3.3's detail. The By category rows have bars; the value column appears only with money.
  - **Missing:** the first 20 people, each linking to `/employees/<id>`, then "and {n} more — see their staff".
  - **Loans line.**
  - **Buttons:** "See their staff →" (`/employees?department=<id>`) and "Export {name} (.xlsx)"
    (`/equipment-by-client/export?tab=…&group=<id>`).
  - **× close:** aria-label "Close details"; it removes `?group`.

- [ ] **Step 5: Nav and path rule.**
  - The IT People lifecycle gets "Equipment by client" → `/equipment-by-client` after "Equipment policies".
  - The Finance nav gets the same link after "Depreciation".
  - `PATH_RULES` gets `/^\/equipment-by-client/`, with workspaces `["it","finance"]` and roles
    `["admin","it_staff","finance_staff","viewer"]`. Place it before any broader rule that would match first.
  - Update `src/lib/workspaces.test.ts` if it enumerates the nav.

- [ ] **Step 6: Run unit, tsc and lint, then commit**

```bash
git add -A src
git commit -m "feat(report): Equipment by client page — tabs, search, filters, sortable table, equipped bars, detail panel; money columns only for Finance and Admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The export

**Files:**
- Create: `src/app/(app)/equipment-by-client/export/route.ts`
- Modify: `src/lib/export-columns.ts` (+test): `EQUIPMENT_EXPORT_COLUMNS` and `EQUIPMENT_MONEY_COLUMNS`
- Modify: `src/server/modules/reports/equipment.ts`: `equipmentExportRows({ kind, groupId?, withMoney, now })`

- [ ] **Step 1: Failing test.**
  - `equipmentExportColumns(withMoney)` returns the headers in the Global Constraints order.
  - With `withMoney` it appends "Cost" then "Book value".
  - Without it, neither header exists.

- [ ] **Step 2: Implement.**
  - **Rows:** one per IT-class asset of the counted people, sorted by group name, then person name, then tag.
  - **Held since:** the newest assignment audit per asset. Reuse the matching rule in
    `src/server/modules/employees/panel-actions.ts`: lift it into a shared helper in the reports module or
    `src/server/modules/employees/held-since.ts` and use it from both places. Batch it in one query for all asset
    ids, never per asset.
  - **Purchased:** `yyyy-mm-dd`.
  - **Cost and Book value:** pesos as numbers, computed only when `withMoney`.
  - **Cap:** refuse with the house `capRefusal` when the row count exceeds `EXPORT_CAP`, checked before loading
    rows (`count` first).
- [ ] **Step 3: Route.**
  - `requireRole` with the four page roles; `withMoney = canSeeMoney(role)`.
  - `?tab`; optional `?group` (unknown → 404).
  - The filename comes from `exportFilename`-style helpers: `equipment-by-client` or `equipment-{slug}` plus the
    date.
- [ ] **Step 4: Run unit, tsc and lint, then commit** with the message
  `feat(report): Equipment by client export — per item, money columns only for Finance and Admin, capped` and the
  standard trailer.

---

### Task 5: E2E (written, not run)

**Files:**
- Create: `e2e/equipment-by-client.spec.ts`
- Modify: `e2e/axe-sweep.spec.ts` (add `/equipment-by-client` for IT and Finance)

Cases (spec §4.2):
1. **Finance** sees "Book value today", the Book value column and a ₱ amount on the "Bluepeak Telecom" row.
   Selecting it shows "By category" with values.
2. **IT** sees no `₱` anywhere (`await expect(page.locator("main")).not.toContainText("₱")` after the table has
   rendered) and no "Book value" column header.
3. **Exports.** Download both and read the headers with `read-excel-file` (as `e2e/import-export.spec.ts` does).
   IT's has no "Cost" or "Book value"; Finance's has both.
4. **Gaps.** Create a Bluepeak Telecom hire straight in the DB with nothing assigned (as `e2e/clients-profile.spec.ts`
   `makeClientHire` does). "With gaps" lists Bluepeak, and the detail lists the hire with its missing labels.
5. **Ending a client** (Review Focus 4). End a test client created in the spec; it leaves the report. Restore it in
   `finally`.

- [ ] **Step 1:** Write the cases with `getByRole` locators and exact names. Make them type-check.
- [ ] **Step 2:** Commit with the message
  `test(e2e): equipment by client — money only for Finance, exports, gaps, ended clients; axe` and the standard
  trailer.

---

### Task 6: Battery (controller)

- [ ] Reseed `inventory_dev`.
- [ ] Run `tsc`, lint and `vitest`.
- [ ] Run every `e2e/*.spec.ts` in foreground chunks of ≤7 files, each under 540 s, with the long `axe-sweep` in a
  chunk of its own.
- [ ] Fix rounds go to implementers.
- [ ] Reseed last. Record the counts.

### Task 7: Docs

Update:
- `docs/HANDOVER.md`: line 3, and a new lettered block after the latest one, found by its header;
- `docs/PICKUP.md`: the Branch, Database and Battery rows, and §4 item 1;
- `docs/HANDOVER-PENDING.md`: the preamble;
- the spec's Status line.

Record:
- the state (code-complete, unmerged), the branch, the final tree and the battery;
- the rulings;
- **what the redeploy does:** every approved asset's book value drops, because depreciation now starts at the
  purchase month and takes the current month. There is no migration and nothing stored changes.

Commit with the message `docs(handover,pickup): Phase 38 code-complete on phase-38-equipment-by-client, unmerged`
and the standard trailer.
