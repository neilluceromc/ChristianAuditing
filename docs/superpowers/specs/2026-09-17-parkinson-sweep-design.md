# Phase 23 — Parkinson sweep: quick forms and complete-by dates

**Status:** implemented on branch `phase-23-parkinson-sweep` (10 tasks, `D-1`…`D-20` — the final-review
fix wave added `D-16`…`D-19`, the final battery `D-20`), code-complete 2026-09-17 at final tree
`09bf0a5`, final-review fix wave included; unmerged and unpushed. Design approved in conversation
2026-09-17 (both readings of the law; defaults editable at start; one phase, two sweeps; five sections
approved one by one). The sections below carry an *Amended (D-n)* note wherever execution proved the
design wrong or unreachable; the plan's amendment block is the full record.

**Why:** Parkinson's Law — *any task inflates until all of the available time is spent* — has two
readings for a UI, and the survey of 2026-09-17 found both failing here. (1) Tasks take longer than
they need: every required "why" is typed free-text, nothing remembers a last-used vendor, employee or
item, no operational form focuses its first field, the stock issue form picks a person from a
full-roster dropdown, and the new-employee form silently defaults the department to whatever sorts
first. (2) Some work has no clock at all: approvals carry a 48-hour SLA and loans a due date, but an
offboarding or an open stocktake can sit forever with nothing on Home saying so.

**What this phase does:** a *shrink* sweep — reason chips, remembered picks, typeahead where a
dropdown was, focus and Enter handling, and eight per-form fixes — and a *clock* sweep — a stored,
editable-at-start complete-by date on offboarding and on stocktakes, surfaced wherever approvals and
loans already show due state. Nothing changes in how work is recorded: every write still audits,
every date change is in the history.

Predecessors: Phase 15 (direct lifecycle, the `loanDueAt` default-and-edit pattern this copies),
Phase 17 (the worklist's severity ordering), Phase 20 (the offboarding list, `SameNameCheck`),
Phase 22 (`ExpiryPill`, the Purchasing Home stock tiles, `stockHomeSignals`).

---

## 0. Decisions made in the brainstorm

1. **Both readings.** Shrink task time *and* time-box the two open-ended pieces of work. Rejected:
   shrink-only (leaves offboardings and stocktakes without an end) and deadlines-only (the form
   friction is what people feel daily).
2. **Defaults, editable at start.** Offboarding: 5 working days from the day employment flips to
   OFFBOARDING; stocktake: 3 days from opening. IT or Purchasing may change the date when starting,
   the way a loan's due date is prefilled and editable. Rejected: fixed like the approvals SLA (nobody
   can move it) and "pick a date every time" (a required field on every start).
3. **One phase, two sweeps.** Rejected: two phases (the shrink items are many small same-shape edits
   that batch well; splitting delays the ones people notice), and derived-not-stored deadlines (a
   derived date cannot be edited, contradicting decision 2).
4. **Stored dates, additive migration 24, plain-SQL backfill.** Employees already OFFBOARDING get
   start + 7 calendar days (exactly 5 working days for any weekday start); the one seeded stocktake
   gets a date so the column can be NOT NULL. Backfilled dates may already be in the past; showing
   them overdue is the truthful reading.
5. **Offboarding due lives in the employee form**, in the Employment field group: the same form that
   flips employment sets and edits the date, so the change lands in the existing `update` audit with
   old and new values. The wizard only reads it.
6. **Stocktake due is set at open only.** No edit control while OPEN (decision 2's "at start").
7. **Remembered picks live in `UserPreference`** (`recent:<kind>`, up to 5 ids, newest first),
   written best-effort after the action's transaction, never audited (scope decision #9: user
   preference, not domain data), never shown for an id that is not among the offered options.
8. **Chips fill, never submit.** A reason chip only writes text into the box; validation is unchanged.
9. **Two-tone pill.** `DuePill` uses the existing `Pill` tones (`neutral` until the due day, `accent`
   on the due day and once overdue) with the distinction carried by the text ("due in 3 d", "due
   today", "2 d overdue") — the same palette discipline as `ExpiryPill`, no new colour token.

---

## 1. Scope

**In**

- `Employee.offboardingDueAt` and `Stocktake.dueAt` (§2), defaults and floors (§4.1, §5), display on
  the offboarding list, wizard header and farewell report, the stocktake list and page, the IT Home
  worklist and a Purchasing Home tile (§6).
- Shared components: `ReasonField` (chips), `EntityCombobox` `recent` group, `DuePill`, first-field
  focus in dialogs (§6.1).
- Per-form fixes (§8): stock issue employee typeahead; receive "Same item again"; adjust quantity
  prefilled; purchase draft Enter-to-add-line; new-employee department starts blank; supplier same-name
  warning; asset vendor combobox with Recent and parallel document uploads; blind-count first-cell
  focus.
- Seed: the OFFBOARDING fixture gets a past due date; ST-0001 gets a `dueAt`.

**Out** (recorded, not built): email or chat reminders; a public-holiday calendar (working days are
Monday–Friday only); deadlines on purchase requests (they show age) or approvals (they have the SLA);
editing a stocktake's date while OPEN; a "recent" group for spare assets (a spare, once assigned, is
no longer offered, so the group would be empty most of the time); making any required field optional.

---

## 2. Data model — migration 24 `parkinson_deadlines`

### 2.1 `Employee` (changed)

```prisma
/// Phase 23 (spec §2.1). Complete-by date for the current offboarding, day-precision UTC like
/// loanDueAt. Set when employment enters OFFBOARDING (default addWorkingDays(today, 5), editable in
/// the employee form), cleared when it returns to ACTIVE, kept once OFFBOARDED so the farewell
/// report can say whether it finished on time.
offboardingDueAt DateTime?
```

No new index: the only filter that reads it (`worklist` leavers) is already narrowed by the indexed
`employment` column and capped at 10 rows.

### 2.2 `Stocktake` (changed)

```prisma
/// Phase 23 (spec §2.2). Close-by date, set once at open (default openedAt + 3 days, editable on the
/// open form, never afterwards). Day-precision UTC.
dueAt DateTime
```

### 2.3 `UserPreference` keys (no schema change)

| key | value | written by |
|---|---|---|
| `recent:employee` | `string[]` of `Employee.id`, newest first, ≤ 5 | `issueStock`, `assignAsset`, `bulkAssign`, `replaceAsset` |
| `recent:stock-item` | `string[]` of `StockItem.id` | `issueStock`, `receiveStock` |
| `recent:vendor` | `string[]` of `Vendor.id` | `receiveStock` (supplier), `createAsset`, `updateAsset` (when a vendor is set) |

### 2.4 Migration SQL (hand-finished after `prisma migrate dev --create-only --name parkinson_deadlines`)

```sql
ALTER TABLE "Employee"  ADD COLUMN "offboardingDueAt" TIMESTAMP(3);
ALTER TABLE "Stocktake" ADD COLUMN "dueAt" TIMESTAMP(3);

-- Backfill (spec §0 decision 4). 7 calendar days = 5 working days for any weekday start; a
-- weekend start gets a day or two of grace rather than a Saturday deadline.
UPDATE "Employee"
   SET "offboardingDueAt" = date_trunc('day', COALESCE("offboardingAt", "updatedAt")) + interval '7 days'
 WHERE "employment" = 'OFFBOARDING' AND "offboardingDueAt" IS NULL;

UPDATE "Stocktake"
   SET "dueAt" = date_trunc('day', "openedAt") + interval '3 days'
 WHERE "dueAt" IS NULL;

ALTER TABLE "Stocktake" ALTER COLUMN "dueAt" SET NOT NULL;
```

Idempotent (both `UPDATE`s are guarded by `IS NULL`), no trigger changes, no data deleted. Applies on
staging at the next `scripts/deploy-staging.ps1 -Force` after the merge.

### 2.5 Seed additions (`prisma/seed.ts`)

- Dennis Ong `EMP-0090` (the OFFBOARDING fixture, `offboardingAt` = day(−1100)) gets
  `offboardingDueAt: day(-2)` — two days overdue, so the list column, the wizard pill, the Home row
  and the "Overdue" filter all have something to show.
- `ST-0001` (posted) gets `dueAt: day(-8)` (opened day(−10) + 3 days, then posted a day early).
- **No OPEN stocktake is seeded.** `openStocktake` refuses while any OPEN stocktake overlaps the
  scope, so a seeded open one would block `stocktake.spec.ts` and every other test that opens one.
  The deadlines e2e opens its own (§9.2).

---

## 3. Access and routes

No new routes, no role changes.

| Surface | Who | Change |
|---|---|---|
| `/employees/[id]/edit`, `/employees/new` | admin, it_staff | "Complete offboarding by" date, shown only while Employment = OFFBOARDING |
| `/stock/stocktakes/new` | admin, purchasing_staff | "Close by" date, prefilled, min tomorrow |
| `/offboarding` | as today | Due column, `due` facet (`overdue` / `on-track`), `due` sort |
| `/offboarding/[employeeId]` | as today | `DuePill` in the page header; report line on `/report` |
| `/stock/stocktakes`, `/stock/stocktakes/[id]` | as today | Close-by column and header pill |
| `/` (IT Home) | IT | leaver rows carry the due label and severity |
| `/` (Purchasing Home) | Purchasing | third stock tile "Stocktakes past close-by" → `/stock/stocktakes` |

Recent picks are read for the signed-in user on the pages that render the comboboxes (server
components pass `recent` arrays down); any role may accumulate them, viewer included, as with column
preferences.

---

## 4. Pure rules (`src/lib`)

### 4.1 `deadlines.ts` (+ `deadlines.test.ts`)

```ts
export const OFFBOARDING_DUE_WORKING_DAYS = 5;
export const STOCKTAKE_DUE_DAYS = 3;

/** YYYY-MM-DD → Date at UTC midnight (the app's day-precision convention, asset-diff.ts toDay). */
export function dayFromISO(iso: string): Date;
/** n calendar days after an ISO day. */
export function addDays(iso: string, n: number): string;
/**
 * n working days (Mon–Fri) after an ISO day: step one calendar day at a time, count the step only
 * when it lands on Mon–Fri. From Sat 2026-09-19, +5 → Fri 2026-09-25; from Wed 2026-09-16, +5 → Wed
 * 2026-09-23. No holiday list (spec §1 Out).
 */
export function addWorkingDays(iso: string, n: number): string;
export function defaultOffboardingDue(todayISO: string): string; // addWorkingDays(todayISO, 5)
export function defaultStocktakeDue(todayISO: string): string;   // addDays(todayISO, 3)
/** Earliest allowed: offboarding = today; stocktake = tomorrow. */
export function minOffboardingDue(todayISO: string): string;     // todayISO
export function minStocktakeDue(todayISO: string): string;       // addDays(todayISO, 1)

export interface DueStatus { days: number; text: string; tone: "neutral" | "accent"; overdue: boolean }
/**
 * Calendar days from `todayISO` (Asia/Manila, via localDateISO) to `dueAt`. text: days < 0 →
 * "N d overdue"; 0 → "due today"; 1 → "due tomorrow"; else "due in N d". tone "accent" when days ≤ 0.
 */
export function dueStatus(dueAt: Date, todayISO: string): DueStatus;
export function isPastDue(dueAt: Date, todayISO: string): boolean; // localDateISO(dueAt) < todayISO
```

### 4.2 `reason-chips.ts` (+ test)

One list, reviewable in one file. Every chip is ≥ 5 characters so no chip can produce a refused
reason under any `reasonRequired` minimum in the codebase (3, or 5 for `returnAssetToIt`).

*Amended (D-2):* the ≥ 5 rule was over-strict and is now ≥ 4. Every chip site's minimum is 3
(`reasonRequired()` defaults to 3; the stock adjust and write-off schemas use `min: 3`), and the only
min-5 field, `returnAssetToIt`, has no chips at all — so the approved wording "Lost" stays in
`stock.write-off` and `asset.missing`, and `asset.assign`'s third chip reads "On loan". The unit test
asserts a floor of 4.

```ts
export const REASON_CHIPS = {
  "stock.adjust":      ["Count correction", "Damaged", "Spoiled", "Found extra"],
  "stock.write-off":   ["Expired", "Damaged", "Spoiled", "Lost"],
  "stock.issue":       ["Regular supply", "Replacement", "Event or meeting"],
  "asset.missing":     ["Not returned", "Lost", "Stolen"],
  "asset.defective":   ["Will not power on", "Screen damaged", "Water damage"],
  "asset.buyout":      ["Bought by employee"],
  "asset.status":      ["For repair", "End of life", "Sold or donated", "Back in service"],
  "asset.assign":      ["New hire kit", "Replacement", "Loan"],
  "employee.transfer": ["Promotion", "Reorganisation", "Requested by department"],
  "policy.exception":  ["Role needs it", "Remote work setup", "Uses own device", "Not needed for this role"],
  "approval.reject":   ["Not needed", "Duplicate request", "Wrong item"],
  "purchase.reason":   ["Over budget", "Need specifications", "Duplicate request"],
} as const satisfies Record<string, readonly string[]>;
export type ReasonContext = keyof typeof REASON_CHIPS;
/** Outcome-aware: return/replace/offboarding dialogs pick the context from the chosen outcome. */
export function chipsForOutcome(outcome: "MISSING" | "DEFECTIVE" | "BUYOUT" | "TRIAGE" | "RETURNED"): readonly string[]; // TRIAGE/RETURNED → []
```

Test: every context has 1–5 chips, no duplicates within a context, every chip ≥ 5 chars and ≤ 40,
`chipsForOutcome("TRIAGE")` and `("RETURNED")` are empty.

### 4.3 `recent-picks.ts` (+ test)

```ts
export const RECENT_KINDS = ["employee", "stock-item", "vendor"] as const;
export type RecentKind = (typeof RECENT_KINDS)[number];
export const RECENT_MAX = 5;
export const recentKey = (kind: RecentKind) => `recent:${kind}`;
/** Prepend, dedupe, cap. pushRecent(["a","b"], "b") → ["b","a"]. */
export function pushRecent(existing: readonly string[], id: string): string[];
/** Options whose value is in `recent`, in recent order; ids not offered are dropped. */
export function recentOptions<T extends { value: string }>(options: readonly T[], recent: readonly string[]): T[];
/** Parse a stored preference value defensively: non-array or non-string entries → []. */
export function parseRecent(value: unknown): string[];
```

### 4.4 Schemas

- `employees/actions.ts` `employeeSchema` gains `offboardingDueAt: z.union([z.literal(""), dateStr])
  .optional()` (the same `dateStr` regex the file already has, message "Use the date picker").
  Resolution happens in the action (§5.1), not the schema, because it depends on the stored row.
- `stock-schema.ts` `stocktakeOpenSchema` gains `dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use
  the date picker")`. Floor enforced in the action (§5.2).
- `employees/actions.ts` `createEmployeeSchema` unchanged: `departmentId: z.string().min(1, "Pick a
  department")` already refuses the blank the form now starts with.

### 4.5 `worklist.ts`

```ts
export interface LeaverLike { id: string; name: string; employeeNo: string; itemsOut: number; offboardingDueAt: Date | null }
/**
 * Mirrors loanRow. No date → title "<name> is leaving — no completion date", action "Set date",
 * href /employees/<id>/edit, severity 1000. Otherwise title/meta as today plus " · <dueStatus.text>",
 * action as today, severity 500 + overdue days when overdue, else 0..2 by nearness (due today 2,
 * tomorrow 1, later 0). rank 2, section "queue".
 */
export function leaverRow(e: LeaverLike, todayISO: string): WorkRow;
```

`home/queries.ts` selects `offboardingDueAt` for leavers and calls `leaverRow` instead of building the
row inline.

### 4.6 `offboarding-list.ts`

`OFFBOARDING_LIST_CONFIG.facets` → `["department", "progress", "due"]`; `sortable` →
`["name", "started", "undecided", "due"]`. `due` facet values `overdue` | `on-track`, narrowed in
memory beside `progress` (plan P-5's pattern) using `isPastDue(row.dueAt, today)`; a row with no date
counts as `on-track`. `buildOffboardingOrderBy` maps `due` → `{ offboardingDueAt: { sort, nulls:
"last" } }`. Facet option labels: "Overdue", "On track".

### 4.7 `stock-reports.ts` / `stock/queries.ts`

`stockHomeSignals(today)` returns `{ low, expiringLots, stocktakesOverdue }` where
`stocktakesOverdue = count(Stocktake where state = OPEN and dueAt < manilaDayBounds(today).start)`.

---

## 5. Server

### 5.1 `employees/actions.ts`, `import/employee-actions.ts`

`updateEmployee` resolves the date after parsing, before the transaction:

```ts
const today = localDateISO(new Date());
let offboardingDueAt: Date | null;
if (d.employment === "OFFBOARDING") {
  if (d.offboardingDueAt) {
    if (d.offboardingDueAt < minOffboardingDue(today)) return validationError({ offboardingDueAt: "Pick today or later" });
    offboardingDueAt = dayFromISO(d.offboardingDueAt);
  } else {
    offboardingDueAt = employee.offboardingDueAt ?? dayFromISO(defaultOffboardingDue(today));
  }
} else if (d.employment === "ACTIVE") offboardingDueAt = null;
else offboardingDueAt = employee.offboardingDueAt; // OFFBOARDED keeps the record
```

`offboardingDueAt` joins `data`, so `diffOf` puts it in the audit diff whenever it changes.
`createEmployee` applies the same rule with no stored row (`OFFBOARDING` → provided or default).
The importer's create path (`import/employee-actions.ts`, where it writes `offboardingAt`) sets
`offboardingDueAt: employment === "OFFBOARDING" ? dayFromISO(defaultOffboardingDue(today)) : null` and
adds it to the create diff when set. The importer's update path never moves employment today, so it
never touches the date.

### 5.2 `stock/stocktake-actions.ts` `openStocktake`

After parsing: `if (d.dueAt < minStocktakeDue(today)) return validationError({ dueAt: "Pick tomorrow
or later" })`. Creates with `dueAt: dayFromISO(d.dueAt)`; the existing open audit entry's diff gains
`dueAt: { from: null, to: <ISO day> }`.

### 5.3 `src/server/recent-picks.ts` (new)

```ts
/** Best effort, after the caller's transaction has committed: read-modify-write one preference row per kind; any error is logged and swallowed. */
export async function rememberPicks(userId: string, picks: Partial<Record<RecentKind, string | null | undefined>>): Promise<void>;
/** For page renders: the stored list, parsed defensively. */
export async function recentPicks(userId: string, kind: RecentKind): Promise<string[]>;
```

Call sites (each right after its `$transaction` resolves ok): `issueStock` (employee, stock-item),
`receiveStock` (stock-item, vendor = supplierId), `assignAsset` / `bulkAssign` / `replaceAsset`
(employee), `createAsset` / `updateAsset` (vendor). No audit, no rate-limit event, no revalidate.

### 5.4 Queries

- `offboarding/queries.ts` `listOffboarding` selects `offboardingDueAt` → row field `dueAt: Date |
  null`; `due` facet counts computed in memory like `progress`.
- Wizard data (`WizardData`) gains `dueAt`; the report query gains `dueAt` and `completedAt` = the
  `createdAt` of the newest `AuditEntry` `{ entityType: "employee", entityId, action:
  "offboarding.completed" }` (null while still open).
- `stock/queries.ts` stocktake list rows gain `dueAt`; `stockHomeSignals` gains `stocktakesOverdue`.
- `home/queries.ts` `purchasingHome` returns `stocktakesOverdue`.
- Pages that render a combobox with Recent call `recentPicks(user.id, kind)` alongside their existing
  option queries: `/stock/issue`, `/stock/receive`, `/inventory/[id]` (holder control), the employee
  loadout view's assign dialog, `/inventory/new`, `/inventory/[id]/edit`, `/inventory/register`.

### 5.5 Audit

No new action names. Changes to the two dates ride the existing `update` (employee) and the stocktake
open entry. Preference writes stay out of the trail (decision 7).

---

## 6. Screens

### 6.1 Shared components

- **`src/components/patterns/reason-field.tsx` `ReasonField`** — props `{ label?: string ("Reason"),
  required?, error?, hint?, value, onChange, chips: readonly string[], id?, rows?, "aria-label"? }`.
  Renders `FormField` → `Textarea` plus, when `chips.length > 0`, a row of small `Button
  variant="ghost"` chips above the box, each `type="button"` with `aria-label="Use reason: <text>"`.
  Clicking a chip sets the value to the chip text and focuses the textarea. Chips never submit. The
  two stock dialogs that use a bare `aria-label="Reason"` textarea keep that label through the
  `aria-label` prop.
- **`EntityCombobox`** gains `recent?: string[]`. When `query === ""` and `recentOptions(options,
  recent)` is non-empty, the list shows a non-interactive heading row "Recent" (`role="presentation"`),
  those options, then a heading "All" and the full list; arrow keys skip headings. Typing filters the
  full list exactly as today. Option ids stay `${listId}-${value}`; a value that appears in both
  groups renders once in Recent only.
- **`src/components/ui/due-pill.tsx` `DuePill`** — `{ dueAt: Date; today: string; withDate?: boolean }`
  → `<Pill tone={status.tone}>{status.text}</Pill>`, preceded by `fmtDate(dueAt)` when `withDate`.
- **Dialog focus** — the focus trap (`src/components/ui/use-focus-trap.ts`) focuses the first form
  control (`input, select, textarea, [role=combobox]`) inside the dialog body on open, falling back to
  today's target when none exists. Single-form pages put `autoFocus` on their first field.
- **`enterKeyHint`** — text inputs in the operational forms get `enterKeyHint="next"`, the last text
  input of a dialog `"done"`. Textareas unchanged.

*Amended (D-8):* `ReasonField` ships without the optional `id` and `"aria-label"` props. P-10 turned the
two stock dialogs' bare `aria-label="Reason"` textareas into `FormField`-based `ReasonField`s that take
their accessible name from the visible label, so nothing needs to override it.

*Amended (D-18, ruling R6):* the chip group's `aria-label` is **"Quick picks"**, and the chips carry no
`aria-label` at all — their visible text is their accessible name. `getByLabel(text)` matches
`aria-label` by case-insensitive *substring*, so a group named "Quick reasons" and chips named
"Use reason: …" made `getByLabel("Reason")` / `("Purpose")` resolve to a textarea plus a group plus N
chips at 21 pre-existing call sites across 13 spec files. Nothing chip-side may contain a field's own
label word.

*Amended (D-16, ruling R7):* `enterKeyHint` is one default in the shared `Input` component — typeable
types (`text`, `search`, `email`, `tel`, `url`, `number`, and an unset `type`) render
`enterKeyHint="next"` unless the caller passes its own, rendered after the `{...rest}` spread so a
caller always wins. There are no per-site edits, and the "done on a dialog's last field" nuance is
dropped.

### 6.2 Employee form (`components/employees/employee-form.tsx`)

- New mode: `departmentId` starts `""`; the select's first option is `<option value="">Choose a
  department</option>`; the server's "Pick a department" is the refusal.
- Employment group: when the select reads OFFBOARDING, a `FormField label="Complete offboarding by"
  required` date input appears (`min = today`, prefilled `defaultOffboardingDue(today)` when the
  employment was just switched, or the stored date on edit). Hint: "5 working days by default." When
  the select leaves OFFBOARDING the field hides; on ACTIVE the server clears the date.

### 6.3 Offboarding

- List (`app/(app)/offboarding/page.tsx`): "Due" column after Started — `DuePill withDate` for rows
  with a date, "—" otherwise; sortable; facet dropdown "Due" (Overdue / On track) beside Progress.
- Wizard (`app/(app)/offboarding/[employeeId]/page.tsx`): `DuePill withDate` in the `PageHeader`
  beside the employment pill; when `dueAt` is null (legacy rows) a text link "Set a completion date"
  to `/employees/[id]/edit`.
- Report (`/report`): one line under the header — "Completed on time (due D)", "Completed N d late
  (due D)", or, while open, "Still open · N d overdue (due D)" / "Due in N d (due D)".

*Amended (D-13, ruling R4):* there is no `/employees/<id>/history` route and none is owed by this
phase. An employee record has a Timeline (actor + action) and only `/audit` renders diff field names,
so field-level employee history — including a changed `offboardingDueAt` — is read on
`/audit?entity=employee`. The e2e asserts the newest row for the employee shows `offboardingDueAt` and
`update`; the diff's old → new values are not rendered for employees and are not asserted. Same
amendment applies to §9.2 case 3.

### 6.4 Stocktakes

- Open form (`components/stock/stocktake-open-form.tsx`): `FormField label="Close by" required` date,
  `min = tomorrow`, prefilled `defaultStocktakeDue(today)`, hint "3 days by default."
- List (`app/(app)/stock/stocktakes/page.tsx`): column "Close by" between Opened and Posted —
  `DuePill withDate` for OPEN rows, plain `fmtDate` otherwise.
- Page (`app/(app)/stock/stocktakes/[id]/page.tsx`): `DuePill withDate` in the header while OPEN.

### 6.5 Home

- IT worklist: `leaverRow` (§4.5). Nothing else moves.
- Purchasing Home: third stock tile "Stocktakes past close-by" with `stocktakesOverdue`, tone accent
  when > 0, `href="/stock/stocktakes"`.

### 6.6 Forms in the shrink list — see §8 for the exact change per file.

---

## 7. Error handling

| Situation | Response |
|---|---|
| Offboarding date before today | field error "Pick today or later" (server), `min` on the input |
| Stocktake date before tomorrow | field error "Pick tomorrow or later" (server), `min` on the input |
| Malformed date | "Use the date picker" (schema) |
| New employee with blank department | "Pick a department" (existing schema message) |
| Preference write fails | `console.error` with kind and user id; the domain action's `ok` result is already returned |
| Recent id no longer offered | silently omitted (`recentOptions`) |
| Chip clicked on a disabled/pending form | chips are disabled while `pending`, like the submit button |
| Enter in a draft line with empty description | no new line; nothing else happens |
| Supplier same-name match | inline warning under Name with a link to the existing supplier; save is not blocked by the warning (`Vendor.name` is `@unique`, so an exact duplicate is still refused on save, as today) |

*Amended (D-4, ruling R3):* the two date rows above describe two layers, and only one of them is
reachable from the UI. Because the input carries `min` and the form has no `noValidate`, the browser's
own constraint validation refuses a past date and the form never submits — so "Pick today or later" and
"Pick tomorrow or later" are server guards that a user cannot normally see. Both layers stay; the e2e
strips `min` with `evaluate` before submitting and asserts the server text, which is the guard the spec
cares about.

*Amended (D-17, ruling R8):* "Offboarding date before today" applies only to a **changed** date. A
leaver backfilled or seeded with a past due date could not be saved at all: `min={today}` blocked the
stored value natively and `updateEmployee`'s floor was unconditional, so editing anything else on that
employee's form was impossible. The input's `min` is now the earlier of today and the stored value, and
the server floor fires only when the submitted date differs from the stored one. `createEmployee`'s
floor is unconditional still — nothing is stored yet there.

---

## 8. The shrink list — one row per file

| File | Change |
|---|---|
| `components/stock/issue-form.tsx` | Employee `<Select>` → `EntityCombobox` (`options` = active employees as `ComboOption`, `recent` = `recent:employee`); item combobox gets `recent:stock-item`; Purpose → `ReasonField chips=REASON_CHIPS["stock.issue"]`; first field autoFocus |
| `components/stock/receive-form.tsx` | item combobox gets `recent:stock-item`; supplier `<Select>` → `EntityCombobox` with `recent:vendor` and a "No supplier" clear; after a successful line, keep `lastItemId` and show a `Button variant="ghost"` "Same item again" that restores the item and focuses Quantity |
| `components/stock/adjust-dialog.tsx` | Set mode starts with quantity = current balance (already passed to the dialog); Reason → `ReasonField chips=["stock.adjust"]` |
| `components/stock/write-off-dialog.tsx` | Reason → `ReasonField chips=["stock.write-off"]` (the "Expired" default stays) |
| `components/stock/stocktake-count.tsx` | `autoFocus` on the first count cell |
| `components/purchases/draft-form.tsx` | Enter in the last line's last cell adds a line when that line has a description; `preventDefault` so the form never submits |
| `components/employees/employee-form.tsx` | §6.2 |
| `components/employees/transfer-dialog.tsx` | Reason → `ReasonField chips=["employee.transfer"]` |
| `components/employees/slot-exception-controls.tsx` | both Reason fields → `ReasonField chips=["policy.exception"]` |
| `components/employees/loadout-view.tsx` | the two return dialogs → `ReasonField chips=chipsForOutcome(outcome)`; the assign dialog's employee/spare combobox gets `recent:employee` where it offers employees |
| `components/inventory/holder-control.tsx` | assign combobox gets `recent:employee`; return Reason → `ReasonField chips=chipsForOutcome(outcome)` |
| `components/inventory/replace-control.tsx` | Reason → `ReasonField chips=chipsForOutcome(outcome)` |
| `components/inventory/status-control.tsx`, `components/inventory/bulk-drawer.tsx` | Reason → `ReasonField chips=["asset.status"]` (status change) / `chipsForOutcome(outcome)` (bulk return) |
| `components/inventory/asset-form.tsx` | Vendor `<Select>` → `EntityCombobox` with `recent:vendor`; assign Reason → `ReasonField chips=["asset.assign"]`; document uploads after create run with `Promise.all`, results reported per file; first field autoFocus |
| `components/inventory/register-form.tsx` | first field autoFocus (vendor already prefilled from the PR) |
| `components/suppliers/supplier-form.tsx` | a warning under Name in the shape of `components/employees/same-name-check.tsx`, fed by a new `checkSameSupplierName` action (`suppliers/actions.ts`, admin/purchasing_staff, rate-limited like `checkSameName`, case-insensitive contains, excludes the row being edited); first field autoFocus |
| `components/offboarding/item-decision.tsx` | Reason → `ReasonField chips=chipsForOutcome(picked)` |
| `components/approvals/approval-actions.tsx`, `components/approvals/queue-table.tsx` | Reason → `ReasonField chips=["approval.reject"]` |
| `components/purchases/request-actions.tsx` | Reason → `ReasonField chips=["purchase.reason"]` |
| every dialog above | first-field focus via the trap (§6.1); text inputs `enterKeyHint` |

No field changes its required-ness; no default is applied without being visible in the field.

*Amended (P-2):* `loadout-view.tsx` has no `EntityCombobox` — its assign dialog picks a spare from a
list, not a typeahead — so the "assign dialog combobox gets Recent" half of that row is void and the
file gets chips only. Recent applies to `holder-control.tsx`, `bulk-drawer.tsx`, `issue-form.tsx`,
`receive-form.tsx` and `asset-form.tsx`.

*Amended (D-16, ruling R7):* "text inputs `enterKeyHint`" landed as one default inside the shared
`Input` component rather than per site — see §6.1.

---

## 9. Testing

### 9.1 Unit (vitest)

- `deadlines.test.ts`: `addWorkingDays` from each weekday and from Sat/Sun for +5 (seven cases),
  across a month end and a year end; `addDays`; `dueStatus` for −10, −1, 0, 1, 3 days (text, tone,
  overdue); `isPastDue` on the boundary day; the two defaults and floors.
- `reason-chips.test.ts`: §4.2's invariants; `chipsForOutcome` for all five outcomes.
- `recent-picks.test.ts`: `pushRecent` dedupe/cap/order; `recentOptions` drops unknown ids and keeps
  recent order; `parseRecent` on `null`, a string, an array with a number.
- `worklist.test.ts`: `leaverRow` no-date / overdue / due-today / later — title, action, severity,
  rank, ordering within "queue".
- `offboarding-list.test.ts`: the new facet and sort key; `due` narrowing keeps dateless rows under
  `on-track`.
- `stock-schema.test.ts`: `stocktakeOpenSchema` accepts a date and refuses a malformed one.
- `employees` action schema: `offboardingDueAt` optional, blank allowed, malformed refused (a small
  schema-only test next to the existing employee tests).

*Amended (D-1, ruling R1):* the employee-schema unit test was dropped. `employeeSchema` is
module-private in a `"use server"` file, which may export only async server actions, so it cannot be
reached from a unit test without moving it. The date floor and the blank-department refusal are covered
end to end instead, by `e2e/deadlines.spec.ts` cases 2 and 7. Measured unit total at close: **1476
tests / 82 files**.

### 9.2 E2E (foreground, `E2E_PORT=3100 --workers=1 --global-timeout=540000`)

`e2e/deadlines.spec.ts` (8 cases, signed in as IT unless stated):
1. Offboarding list shows Dennis with a Due column reading "2 d overdue"; the Due facet "Overdue"
   keeps him, "On track" drops him.
2. The wizard header shows the same pill.
3. Edit Dennis: the "Complete offboarding by" field shows his stored date; set it to yesterday →
   "Pick today or later"; set it to today + 3 → saved, History tab shows `offboardingDueAt` old → new.
4. IT Home: the leaver row's meta carries the due text and sits above a fresher leaver (the test
   flips one seeded ACTIVE employee to OFFBOARDING through the form, checks, then flips back).
5. Purchasing: open a stocktake with the default date → list shows "Close by" with the pill and the
   page header shows it; a date of today → "Pick tomorrow or later".
6. With the stocktake open, the test backdates its `dueAt` through the e2e Prisma client to
   yesterday → Purchasing Home tile reads 1 and the list pill reads "1 d overdue"; then the test cancels
   the stocktake (restoring the seed's "no OPEN stocktake" invariant).
7. Report: Dennis's farewell report (open) shows "Still open · 2 d overdue".
8. axe (`PROMOTED_RULES`) on `/offboarding`, `/stock/stocktakes`, `/stock/stocktakes/new`, and
   `/employees/<dennis>/edit`.

`e2e/quick-forms.spec.ts` (9 cases):
1. Stock issue: the Employee field is a combobox; typing "Den" narrows; a chip "Regular supply" fills
   Purpose; the issue succeeds (then the test re-receives the same quantity to restore balances).
2. Reopening `/stock/issue`: the just-picked employee and item appear under "Recent".
3. Receive: record a line, click "Same item again", the item is back and Quantity is focused.
4. Adjust dialog opens with the current balance in Set mode; chip "Count correction" fills Reason.
5. Purchase draft: Enter in the last cell adds a line; Enter on an empty description does not.
6. New employee: Department starts on "Choose a department"; submitting refuses with "Pick a
   department".
7. Supplier form: typing the name of a seeded supplier shows the same-name warning with a link.
8. Write-off dialog chips; holder return with outcome Missing shows the three missing chips, Back for
   triage shows none.
9. axe on `/stock/issue`, `/stock/receive`, `/employees/new`, `/purchases/suppliers/new`.

*Amended (D-13, ruling R4):* case 3's "History tab shows `offboardingDueAt` old → new" is read on
`/audit?entity=employee` instead — there is no `/employees/<id>/history` route, an employee's Timeline
carries actor + action only, and only `/audit` renders diff field names. The case asserts the newest
row for Dennis Ong shows `offboardingDueAt` and `update`, plus a DB poll; old → new values are not
rendered for employees and are not asserted.

*Amended (D-17, ruling R8):* `deadlines.spec.ts` ships **9** cases, not 8. The fix wave added case 9 —
an overdue leaver's form saved with a Title change only, `min` deliberately left in place, asserting
`validity.rangeUnderflow === false`, `✓ Saved`, `offboardingDueAt` unchanged to the millisecond, and an
audit diff of exactly `["title"]`.

*Measured at close (D-20):* 9 + 9 cases, and `--list` **337 tests in 33 files** overall.

### 9.3 Battery at the close

`tsc` · `lint` · unit · `npx prisma migrate status` (24) · `npx playwright test --list` (count and
file total recorded) · the seven chunks of Phase 22 with two additions: `e2e/deadlines.spec.ts` joins
chunk F (30 → 38), `e2e/quick-forms.spec.ts` joins chunk D (38 → 47). Every chunk stays under the
ten-minute foreground cap. `npm run db:seed` last; port 3100 free before, between and after.

*Measured (D-20):* chunk F is **39**, not 38 — `deadlines.spec.ts` ships 9 cases after the fix wave's
regression case. Measured at close: `tsc` clean · `lint` clean · **1476 unit / 82 files** · **24
migrations**, up to date · `--list` **337 / 33** · **A 54 (3.4m) · B 67 (5.8m) · C 63 (5.9m) · D 47
(4.7m) · E1 36 (8.9m) · E2 31 (4.1m) · F 39 (4.8m) = 337**, zero failed, zero did-not-run, after one
test-only fix (`09bf0a5`); seed last, clean; port free throughout.

---

## 10. Files

**New**

- `prisma/migrations/<stamp>_parkinson_deadlines/migration.sql`
- `src/lib/deadlines.ts`, `src/lib/deadlines.test.ts`
- `src/lib/reason-chips.ts`, `src/lib/reason-chips.test.ts`
- `src/lib/recent-picks.ts`, `src/lib/recent-picks.test.ts`
- `src/server/recent-picks.ts`
- `src/components/ui/due-pill.tsx`
- `src/components/patterns/reason-field.tsx`
- `e2e/deadlines.spec.ts`, `e2e/quick-forms.spec.ts`

**Modified**

- `prisma/schema.prisma`, `prisma/seed.ts`
- `src/lib/worklist.ts` (+test), `src/lib/offboarding-list.ts` (+test), `src/lib/stock-schema.ts` (+test)
- `src/components/patterns/entity-combobox.tsx`, `src/components/ui/use-focus-trap.ts`
- `src/server/modules/employees/actions.ts`, `src/server/modules/import/employee-actions.ts`
- `src/server/modules/stock/stocktake-actions.ts`, `src/server/modules/stock/movement-actions.ts`,
  `src/server/modules/stock/queries.ts`
- `src/server/modules/lifecycle/actions.ts`, `src/server/modules/inventory/actions.ts`,
  `src/server/modules/suppliers/actions.ts` (+ `queries.ts` for the same-name lookup)
- `src/server/modules/home/queries.ts`, `src/server/modules/offboarding/queries.ts`
- the 19 components in §8, plus `src/app/(app)/offboarding/page.tsx`,
  `src/app/(app)/offboarding/[employeeId]/page.tsx`, `.../report/page.tsx`,
  `src/app/(app)/stock/stocktakes/page.tsx`, `.../[id]/page.tsx`, `.../new/page.tsx`,
  `src/app/(app)/stock/issue/page.tsx`, `src/app/(app)/stock/receive/page.tsx`,
  `src/app/(app)/inventory/[id]/page.tsx`, `.../new/page.tsx`, `.../[id]/edit/page.tsx`,
  `.../register/page.tsx`, `src/app/(app)/page.tsx` (the Purchasing tiles are rendered there directly)
- `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md` (close-out)

---

## 11. Global constraints (copied into the plan)

- Work only in a git worktree under `.claude/worktrees/` with its own `.env` (`DATABASE_URL` →
  `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`). Never touch the
  `inventory` database or port 3000. Never read or print `.env`; check key presence with
  `grep -c "^NAME=" .env`.
- Dev server for a walk: `npm run dev -- -p 3100`; ONE walker at a time; after stopping, `netstat -ano
  | findstr :3100` and `taskkill /PID <pid> /T`.
- Playwright: foreground only, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a
  time, explicit file lists per chunk, no server left behind. Never seed while another agent walks or
  tests against the database.
- Server actions: role guard THEN `checkRate`; `writeAudit` per domain write; `ActionResult` union;
  `ActionFailure` thrown inside `$transaction` and mapped outside. Preference writes: no audit, no rate
  event, best effort after commit.
- Dates: day-precision UTC midnight in storage; "today" is `localDateISO(new Date())` (Asia/Manila);
  parse form dates with `dayFromISO`; never `toISOString().slice(0,10)` of `new Date()` for "today".
- zod 4; existing message style ("Pick today or later", "Use the date picker"); no new colour tokens
  (`Pill` tones `neutral`/`accent` only); axe `PROMOTED_RULES` on every new or changed route.
- Never amend commits; commit only when asked by the controller's task brief; never commit `.env` or
  secrets; scan the push range before any push (counts only).
- Reviewer subagents are read-only: no `git stash`/`checkout`/`restore`/`reset`/`switch`; verify in the
  foreground; write the report before replying.
