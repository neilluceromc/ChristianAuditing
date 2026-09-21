# Phase 25 — IT navigation sweep: start offboarding from the profile, every reference a link, new-hire finish line, employees list parity, safety nets

**Status:** design approved in conversation 2026-09-21 (audit-first; ranked by clicks saved on the four daily IT paths — new hire, swap/repair, move/reassign, leaver; scope cut into two phases: this sweep, then Phase 26 = reservations that work + repair end-date). **Implemented on branch `phase-25-it-navigation-sweep` (8 tasks, `D-1`…`D-12` — the final whole-branch review added `D-10`, the fix wave `D-11`, the final battery `D-12`), code-complete 2026-09-21 at final tree `fab0780`, final-review fix wave included; unmerged and unpushed.** Battery on that tree: `tsc` clean · `lint` clean · **24 migrations**, schema up to date (this phase adds none) · **1493 unit / 84 files** · **353 e2e / 34 files** across the seven foreground chunks, zero failed. Where a ruling or the final review changed this design, the section carries an *Amended (D-n)* note; plan `docs/superpowers/plans/2026-09-21-phase-25-it-navigation-sweep.md` holds the full D-block.

**Companion facts file (scratch, git-ignored):** `.superpowers/sdd/phase-25-facts.md` — the route map, link matrix, per-screen affordance inventory and parked-items extract this design was ranked from. Every claim below was verified against `main` @ `a9970ad`.

---

## 0. Decisions made during the brainstorm

1. **Audit first, then pick.** The whole IT surface (47 routes) was mapped for dead ends, unwired affordances and missing links before anything was chosen. Ranking weight: **fewer clicks for daily IT work**; all four daily paths matter.
2. **Two phases.** Phase 25 (this spec) is the sweep: no migration, ~20 small edits plus one new server action, one battery. **Phase 26** takes the two real features the audit surfaced — reservations that can actually be created, released and expired (today only the seed creates holds and the `/reservations` copy promises a control that does not exist) and recording when a repair ended (the `RETURNED OK` row's Down column shows `—`). Phase 26 gets its own brainstorm; its facts are already in the companion file (§3 there).
3. **Start offboarding is a button with a confirm dialog**, not a one-click: the Complete-by date is prefilled to the Phase 23 default (`defaultOffboardingDue`: five working days from today) and editable, mirroring Phase 23's "defaults, editable at start" ruling. Starting an offboarding stays a **direct** employee edit (no approval), as it is today through the Edit form.
4. **Every reference becomes a link — eight sites**; the Home **age histogram stays unlinked** because its buckets are ages, not the calendar years the inventory filters by, so no honest link target exists.
5. **Activity feeds get a trailing link chip** carrying the entity's label, rather than linking a substring inside the generated sentence (fragile) or rewriting `auditSentence`.
6. **Profile "Open requests"** lists the open requests as reference links under the count (capped at five, "+N more" → timeline) instead of adding an employee filter to the approvals list — no new list state, and the profile already loads those rows.
7. **Employees list parity** = the three sort keys the backend already honours wired into clickable headers, plus whole-row click with keyboard support via a small client table component mirroring `inventory-table.tsx`. No bulk selection, no new columns.
8. **Safety nets** = one app-shell `error.tsx`, four `loading.tsx` files, one `not-found.tsx` for the wizard. No per-route error pages, no keyboard shortcuts on lists, no `/reservations` toolbar (that page changes in Phase 26).
9. **Deferred items closed in passing:** wizard header due pill after completion, offboarding `progress`/`due` facet counts narrowing each other, `department` in the audit entity-label resolver, an offboarding list export.

---

## 1. Goal

Remove the detours the audit found on the four daily IT paths without changing any domain rule: start an offboarding from where the person is, reach any request, asset or person from wherever it is named, land a new hire on a page that says what to do next, sort and open employees the way assets already work, and never show a raw Next.js error or a blank screen while a record loads.

## 2. Non-goals

- Reservations (create / release / expire), the `/reservations` toolbar, expiry on the HOLD pill — **Phase 26**.
- Repair end-date, Down-column semantics — **Phase 26**.
- Age-histogram links, list keyboard shortcuts, employee bulk actions, department/category detail pages, an employee filter on `/approvals`, any schema change, any change to approval rules or `isDirectLifecycle`.
- Purchasing-class screens: every change below is on shared components or IT pages; where a shared component is touched (activity feed, error page, skeletons) the Purchasing routes simply inherit it.

---

## 3. Start offboarding from the profile

### 3.1 Server action — `startOffboarding` (`src/server/modules/employees/actions.ts`)

```ts
const startOffboardingSchema = z.object({
  employeeId: z.string().min(1),
  offboardingDueAt: dateStr, // "YYYY-MM-DD", required — the dialog always posts one
});
export async function startOffboarding(input: unknown): Promise<ActionResult<{ id: string }>>
```

Order, exactly as `updateEmployee`: `actionRole("admin", "it_staff")` → `forbidden()`; `checkRate(user.id)` → `rateLimited(...)`; `safeParse` → `validationError(zodFieldErrors(...))`; load the employee → `conflict("That employee no longer exists.")`; `employee.employment !== "ACTIVE"` → `conflict("${name} is already ${employment.toLowerCase()}.")`; `offboardingDueAt < minOffboardingDue(today)` → `validationError({ offboardingDueAt: "Pick today or later" })` (same helper and message as the Edit form; `today = localDateISO(new Date())`).

Write, in one transaction: `employee.update({ employment: "OFFBOARDING", offboardingAt: now, offboardingDueAt: dayFromISO(d.offboardingDueAt) })` and one `writeAudit(tx, { entityType: "employee", entityId, action: "update", diff: { employment: { from: "ACTIVE", to: "OFFBOARDING" }, offboardingAt: { from: null, to: now }, offboardingDueAt: { from: null, to: due } } })` — `action: "update"` so the activity sentence, the timeline and `/audit` render it exactly like the Edit-form path does today (no new audit vocabulary). Then exactly the `revalidatePath` calls `updateEmployee` makes (profile, `/employees`, `/offboarding`, `/offboarding/[employeeId]` page, its report page, `/inventory/work`, `/`). Return `ok({ id })`.

### 3.2 Profile UI (`src/app/(app)/employees/[id]/page.tsx`, new `src/components/employees/start-offboarding-dialog.tsx`)

In the header `actions`, between `TransferDialog` and `Edit`, when `canMutate && employee.employment === "ACTIVE"`: `<StartOffboardingDialog employeeId employeeName defaultDue={defaultOffboardingDue(today)} minDue={minOffboardingDue(today)} />` — a client component with a `Button` labelled **Start offboarding** that opens the app's dialog primitive (the one `TransferDialog` uses; `useFocusTrap`, Escape closes) containing: one sentence ("Freezes {name}'s equipment slots and opens the collection wizard."), a date input labelled **Complete by** (`min={minDue}`, value prefilled `defaultDue`, `autoFocus`), Cancel, and a primary **Start** button. Submit calls `startOffboarding`; `ok` → the shared `useEmployeeRunner` toast ("Offboarding started", its standard settled tone) and `router.push(`/offboarding/${employeeId}`)`; `validation` → field message under the date; `conflict` / `rate_limited` → the dialog's error line (the same `ok / rate_limited / validation / conflict` handling the transfer dialog does). The date input's `min` is a browser courtesy; the server floor is the rule (Phase 23 D-block precedent), and the e2e strips `min` via `evaluate` to reach the server message.

When `employment !== "ACTIVE"` the button is absent; the existing frozen banner in `LoadoutView` (already linking to the wizard) gains a `DuePill` reading `employee.offboardingDueAt` (`withDate`) so the profile shows the date without opening the wizard — `LoadoutView` receives `dueAt: Date | null` as a new prop.

*Amended (D-10, final-review M-7):* the banner is shown whenever `employment !== "ACTIVE"`, but the due date is passed **only for `OFFBOARDING`**. An unoverridden `DuePill` on a closed case would read "overdue" — the exact thing §3.4 exists to prevent — so the OFFBOARDED state carries no pill here and the wizard header's `closed` pill (§3.4) is where a completed case shows its date. Recorded as a deliberate deviation from this paragraph, not fixed.

### 3.3 Wizard request links (`src/app/(app)/offboarding/[employeeId]/page.tsx`, `src/server/modules/offboarding/queries.ts`)

`WizardItem.blockedBy` gains `id: string` (`{ id, refNo, type }`): the `blockers` query inside `getWizard` (`offboarding/queries.ts:385-390`) adds `id: true` to its select and `openByAsset` carries it. `Decision` (`src/lib/offboarding.ts`) gains `id: string`, copied from the winning `DecisionCandidate` in `decisionOf` (the candidate already carries it). The three `<Link href="/approvals">` at the collect step (decided ref and blocked ref) and the summary become `href={`/approvals/${id}`}`. The `items` prop passed to the scan pool is unchanged (it carries `blockedBy: refNo | null` for the verdict text only).

### 3.4 Wizard header due pill after completion

`page.tsx` header: `employee.dueAt ? <DuePill dueAt={employee.dueAt} today={today} withDate override={employee.employment === "OFFBOARDED" ? { tone: "neutral", text: "closed" } : undefined} /> : …`. `DuePill` gains an optional `override?: { tone: "neutral" | "accent"; text: string }` that replaces both the derived tone and text (a completed case is neither overdue nor on track, and `Pill` has only the neutral and accent tones). The report page already prints the date; nothing else changes.

---

## 4. Every reference becomes a link

| # | Site | Data change | Markup change |
|---|---|---|---|
| 1 | Asset record pending banner (`inventory/[id]/layout.tsx:158-167`) | none — `asset.approvals[0]` already selects `id` (verify; add if not) | Banner body gains `<Link href={`/approvals/${pending.id}`}>Open request</Link>` after the sentence |
| 2 | Asset timeline (`inventory/[id]/timeline/page.tsx:64`) | none (`a.id` present) | `refNo` span → `<Link href={`/approvals/${a.id}`} className="font-mono text-xs text-accent hover:underline">{a.refNo}</Link>` |
| 3 | Employee timeline (`employees/[id]/timeline/page.tsx:67-89`) | none — its approvals and reservations queries already `include: { asset: true }`, so `a.id`, `a.asset.id` and `r.asset.id` are present | `refNo` → link to the request; approval-row `a.asset.tag` and hold-row `r.asset.tag` → `<Link href={`/inventory/${asset.id}`}>` |
| 4 | Activity feeds (`components/patterns/activity-feed.tsx`; the two IT callers `inventory/activity` and `employees/activity` — there is no Home feed; the Purchasing callers inherit the component unchanged and pass no `entity`) | `ActivityItem` gains `entity?: { label: string; href: string | null }`; the pages fill it from the `entityLabels` map they already build | after the sentence, when `entity?.href`: `<Link href className="shrink-0 font-mono text-[10.5px] text-accent hover:underline">{entity.label}</Link>`; when `href === null` (deleted entity) nothing extra renders |
| 5 | HOLD pill (`components/inventory/inventory-table.tsx:221-227`; `inventory/queries.ts:30, 97`) | `AssetRow.hold: { id: string; name: string } | null` from `a.reservations[0]?.employee` (`select` adds `id`) | `for <Link href={`/employees/${row.hold.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.hold.name}</Link>` — `stopPropagation` because the row itself navigates on click |
| 6 | Profile "Open requests" (`employees/[id]/page.tsx:210`) | none — `openApprovals` rows carry `id`, `refNo`, `createdAt` | the `Stat` keeps the count; below the grid, when `openApprovals.length > 0`, a `<ul>` of up to five `<Link href={`/approvals/${a.id}`} className="font-mono text-xs text-accent">{a.refNo}</Link>` newest first, then `+N more` → `/employees/${id}/timeline` when more than five |
| 7 | Home fleet bar (`components/home/fleet-bar.tsx`) | `FleetSlice` gains `href: string` built in `home/queries.ts` `fleet()` as `/inventory` + `serializeListState(withFilter(parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG), "status", [status]), INVENTORY_LIST_CONFIG)` — `url-state.ts` has no empty-state constructor, so the empty state is parsed from empty params | each bar segment becomes `<Link href aria-label={`${status}: ${count} assets`}>` (the segment has no visible text, so an aria-label is required and contains no field word); each legend entry's status text becomes the same link |
| 8 | Audit entity labels (`audit/queries.ts` `entityLabels`) | add `department` to the resolved types: `prisma.department.findMany({ select: { id, name } })` → `{ label: name, href: null }` | none (the audit page already renders label-without-link when `href` is null) |

Rule (Phase 23, D-block): none of these links carries an `aria-label` containing a nearby field's label word; visible reference text is the link text. The fleet-bar segment label reads `"DEFECTIVE: 3 assets"` — no form field sits near it.

*Amended (D-3/D-6, global constraints):* row 7's segments carry that name as `sr-only` text rather than an `aria-label`, which satisfies the same accessible name while keeping the phase-wide no-`aria-label` rule literal; the wrapper's `role="img"` was dropped, because real links inside an image role contradict ARIA (ruling **R2** — `e2e/home-finance.spec.ts`'s assertion was rewritten in its own test-only commit rather than the markup weakened).

*Amended (D-11, final-review I-3):* two corrections to row 7. The segment link draws its focus ring **inside** itself (`focus-visible:[outline-offset:-2px]`), because the global outline is clipped by the bar's `overflow-hidden` wrapper and a keyboard user would otherwise see nothing; and segments with `share === 0` are **skipped**, since a zero-width focusable link is a tab stop nobody can see or click. The legend still maps every status, so each one keeps a reachable link.

---

## 5. New-hire finish line and employees list parity

### 5.1 Employee created (`components/employees/employee-form.tsx:95`, `employees/[id]/page.tsx`, new `components/employees/employee-created-notice.tsx`)

`router.push(`/employees/${id}?created=1`)` on the create path only. The profile page reads `searchParams.created === "1"` and renders, above the header card, `<EmployeeCreatedNotice name employeeNo id />`: a settled `Banner` titled `"{name} added · {employeeNo}"` with two links — **Assign devices** (`href="#loadout"`; the loadout section gets `id="loadout"` and `tabIndex={-1}` so the anchor focuses it) and **Accountability form** (`/employees/${id}/form`). The Name input in `employee-form.tsx` gets `autoFocus` (both modes; the asset form does the same). Edit-save behaviour is unchanged.

### 5.2 Employees list (`employees/page.tsx`, new `components/employees/employees-table.tsx`)

The **Employee** header sorts by `name` and the **Joined** header by `joinedAt`, wired exactly as `inventory/page.tsx:105` builds `sortHrefs` from the list config: the header shows the arrow for the active key and links to the toggled direction; the URL is the only state. `employeeNo` stays a URL-only sort key (it shares the Employee column and has no header of its own). The table body moves into `EmployeesTable` (client): each `<Tr>` gets `tabIndex={0}`, `role="link"`-free semantics (a plain focusable row), `onClick={() => router.push(href)}`, `onKeyDown` Enter → same, `aria-label` omitted (the row's text is its name), the existing name `<Link>` retained for middle-click and screen readers, and inner links stop propagation. Visual: the same hover/focus ring classes `inventory-table.tsx` uses. Toolbar, facets, toggles, export and import are untouched.

---

## 6. Safety nets and the remaining deferred items

### 6.1 `src/app/(app)/error.tsx`

```tsx
"use client";
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      description={error.digest ? `Reference ${error.digest}` : "The page hit an unexpected error."}
      actions={<><Button onClick={reset}>Try again</Button><ButtonLink href="/">Home</ButtonLink></>}
    />
  );
}
```
No message text from `error.message` is shown (it may carry internals); the digest is enough for the log. Server logs are untouched.

### 6.2 `loading.tsx` ×4 — `offboarding/loading.tsx`, `reservations/loading.tsx` (list shape: title + toolbar + ten `SkeletonRow`s, copied from `employees/loading.tsx` with the right column count), `inventory/[id]/loading.tsx` and `employees/[id]/loading.tsx` (record shape: a header line, a 5-tab strip, one card block of six `Skeleton` lines). The record-level file covers the record page and every tab route beneath it.

*Amended (D-11, final-review I-1, I-2 and M-1):* the record-shaped skeletons keep **only the body**. A record-level `loading.tsx` renders *inside* its own layout, so the header line and the 5-tab strip this paragraph asked for were drawn a second time under the real ones — `inventory/[id]/loading.tsx` is now the card block alone, and `employees/[id]/loading.tsx` keeps its header line but loses the tab strip entirely (the employee record has no layout and no tabs, so the strip promised a control that never arrives). A **fifth** file was added that this section did not list: `offboarding/[employeeId]/loading.tsx`, record-shaped — without it the list-shaped `offboarding/loading.tsx` also covered the wizard and the farewell report, so both flashed a ten-row list skeleton.

### 6.3 `offboarding/[employeeId]/not-found.tsx` — `EmptyState` "Not in the offboarding queue" / "They may be active again, or the link is stale." / `ButtonLink` → `/offboarding`; the page's existing `notFound()` call now lands here.

### 6.4 Offboarding facets narrow each other (`offboarding/queries.ts:185-215`, `lib/offboarding-list.ts`)

Today `derivedCandidates` is loaded with `withoutFilter(state, "progress")` and both `progressCounts` and `dueCounts` are tallied over the same array, so an active `due` filter does not narrow the `progress` counts and vice versa. Fix in memory, no new query: compute `rows = derivedCandidates.map(toOffboardingRow)`; `progressCounts` over `rows.filter(r => dueFilter.length === 0 || dueFilter.includes(dueOf(r.dueAt, today)))`; `dueCounts` over `rows.filter(r => progressFilter.length === 0 || progressFilter.includes(progressOf(r.undecided)))`. Pure helper `narrowedFacetCounts(rows, progressFilter, dueFilter, today)` in `lib/offboarding-list.ts` with unit tests. `department` counts keep today's behaviour (documented as such in Phase 23; unchanged).

### 6.5 Offboarding export — `src/app/(app)/offboarding/export/route.ts`, `OFFBOARDING_EXPORT_COLUMNS` in `lib/export-columns.ts`, `offboardingExportRows(state)` in `offboarding/queries.ts`

Route shape = `employees/export/route.ts`: `requireUser()`, `parseListState(url.searchParams, OFFBOARDING_LIST_CONFIG)`, rows from `offboardingExportRows(state)` (reuses `listOffboarding`'s cut without paging; cap check first, same `capRefusal`), `toXlsxBuffer(OFFBOARDING_EXPORT_COLUMNS, rows)`, `xlsxResponse(exportFilename("offboarding", new Date()), buffer)`. Columns: Employee no · Name · Department · Started (date) · Complete by (date, nullable) · Undecided (number) · Progress (`Open`/`Complete`). The page header gets the same **Export** `ButtonLink` `/employees` carries in its `PageHeader actions`, with the current query string.

---

## 7. Errors and edge cases

- `startOffboarding` on a non-ACTIVE employee → conflict, dialog shows it; the button is hidden in that state anyway (race: two tabs).
- Due date before today → server `validationError` under the field, even with `min` stripped.
- Deleted entity in an activity row → label resolves to the truncated-id fallback with `href: null` → no chip, sentence unchanged (today's behaviour).
- Fleet bar with a zero-count status → no segment (unchanged); legend entries with zero count still link (the filtered list shows its empty state).
- Employee created banner with a stale `?created=1` (reload) → still renders; harmless, same as the asset banner.
- Row click on the employees table must not fire when the click started on an inner link or on text selection (`window.getSelection()?.toString()` non-empty → ignore), mirroring `inventory-table.tsx`.
- `error.tsx` is a client component and cannot use server helpers; it imports only UI primitives.
- Offboarding export over the cap → `capRefusal` (same 413-style response as the employees export).

## 8. Tests

**Unit (vitest):** `lib/offboarding-list.test.ts` — `narrowedFacetCounts` (no filters; due=overdue narrows progress; progress=open narrows due; both). `lib/activity-links.test.ts` (or inline in the feed's mapping helper) — entity map → chip or none. `components/employees/employee-created-notice.test.tsx` if component tests exist for banners; otherwise covered by e2e. `startOffboarding` date rule reuses tested helpers; its guard order is exercised end to end.

**E2E — new `e2e/it-nav.spec.ts`** (reseed in `beforeAll` like `it-gaps.spec.ts`; every mutating case restores in `finally`), cases:
1. Start offboarding: as IT on a seeded ACTIVE employee the button is present; as viewer it is absent; dialog shows Complete-by prefilled to `defaultOffboardingDue(today)` (five working days); submit lands on `/offboarding/{id}`; the employee reads OFFBOARDING with `offboardingDueAt` = that date; one `update` audit row with the three fields; back on the profile the button is gone and the frozen banner shows the due pill. `finally`: restore `ACTIVE`, null dates, delete the audit row.
2. Start offboarding validation: with `min` stripped, a past date → "Pick today or later" under the field; employment unchanged.
3. Wizard: the seed has no decided item, so the case inserts one `lifecycle_return` approval (PENDING, `payload.to.status = "SPARE"`, created now) for one of Dennis Ong's held assets, asserts the collect step renders it as decided with a ref linking to `/approvals/{id}` (href asserted, then followed), and deletes the row in `finally`.
4. Asset record: seeded pending approval → banner "Open request" link → approval detail; asset timeline ref link.
5. Employee timeline: ref and tag links resolve (hrefs asserted).
6. Activity feeds: `/inventory/activity` and `/employees/activity` rows carry a chip whose href points at the named entity; a row about a deleted entity has none (use a seeded delete entry if one exists; else assert only the positive).
7. HOLD pill: the seeded reserved spare's row links the holder's name to their profile; clicking it does not also open the asset.
8. Profile open requests: an employee with seeded open approvals lists them as links; count matches.
9. Home fleet bar: clicking the DEFECTIVE segment opens `/inventory` with the status facet active and every row DEFECTIVE.
10. New hire: create an employee → profile shows the created banner with both links; Name had focus on the form; `finally` deletes the employee (and its audit rows).
11. Employees list: clicking "Joined" sorts by `joinedAt` (URL and first row change); Enter on a focused row opens that profile; the department cell click also opens it.
12. Offboarding: facet counts narrow each other (`due=overdue` changes the progress counts); Export downloads an `.xlsx` whose row count equals the queue total; the completed leaver's wizard header shows the due pill reading "closed" (the seeded OFFBOARDED employee has no due date, so the case sets one directly and restores `null` in `finally`).
13. Audit: none is seeded, so the case renames a seeded department through `/admin/departments` (which writes a `department` / `rename` entry), asserts `/audit` shows the department's name as the entity label, and in `finally` renames it back and deletes both audit rows.

*Amended (D-2):* cases 3, 12 and 13 **build their own fixtures** — the seed carries no decided offboarding item, no due date on its OFFBOARDED employee and no department audit entry — and each restores what it changed. *Amended (D-8, ruling R3):* `AuditEntry` is append-only at the database (a trigger refuses deletes), so **no case deletes an audit row**; the `finally` blocks restore mutable fields only and rely on the file's `beforeAll` reseed, and case 6 has no `finally` at all because its only write is such a row. *Amended (D-11, final-review I-4):* case 1 asserts the audit row's `action` and its three diff keys with ISO `to` values (not just the row count), and case 9 asserts the segment's href equals the legend's, clicks the **segment**, and checks the Status facet's DEPLOYED count against the filtered row count.

`--list` expected: 340 + 13 = **353 tests / 34 files**; the new file joins chunk F. **Measured at close: `Total: 353 tests in 34 files`, chunk F 55 passed (5.6m), battery 353 / 353 (D-12).** Specs that assert on touched markup and run in the battery anyway: `directory`, `offboarding`, `offboarding-v2`, `custody`, `approvals-audit`, `axe-sweep` (new links: `link-name` satisfied by visible text or the fleet-bar aria-label), `deadlines`.

**Walk (foreground, 3100):** `error.tsx` via the dev kitchen-sink's throw control if one exists, else a temporary `?throw=1` guard in the kitchen-sink page removed before commit; the four skeletons by throttling in the Browser pane.

## 9. Files

New: `src/components/employees/start-offboarding-dialog.tsx`, `src/components/employees/employee-created-notice.tsx`, `src/components/employees/employees-table.tsx`, `src/app/(app)/error.tsx`, `src/app/(app)/offboarding/loading.tsx`, `src/app/(app)/reservations/loading.tsx`, `src/app/(app)/inventory/[id]/loading.tsx`, `src/app/(app)/employees/[id]/loading.tsx`, `src/app/(app)/offboarding/[employeeId]/not-found.tsx`, `src/app/(app)/offboarding/export/route.ts`, `e2e/it-nav.spec.ts`, `src/lib/offboarding-list.test.ts` (extend if present).

Modified: `src/server/modules/employees/actions.ts` (+`startOffboarding`), `src/lib/offboarding.ts` (`Decision.id`), `src/server/modules/offboarding/queries.ts` (`blockedBy.id`, `Decision.id`, facet narrowing, `offboardingExportRows`), `src/lib/offboarding-list.ts` (`narrowedFacetCounts`), `src/lib/export-columns.ts`, `src/server/modules/inventory/queries.ts` (`hold` shape), `src/server/modules/home/queries.ts` (`FleetSlice.href`), `src/server/modules/audit/queries.ts` (`department`), `src/components/patterns/activity-feed.tsx`, `src/components/inventory/inventory-table.tsx`, `src/components/home/fleet-bar.tsx`, `src/components/employees/employee-form.tsx`, `src/components/employees/loadout-view.tsx` (`dueAt` prop, pill in the frozen banner), `src/components/ui/due-pill.tsx` (optional `tone`), `src/app/(app)/employees/[id]/page.tsx`, `src/app/(app)/employees/[id]/timeline/page.tsx`, `src/app/(app)/employees/page.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`, `src/app/(app)/inventory/[id]/timeline/page.tsx`, `src/app/(app)/inventory/activity/page.tsx`, `src/app/(app)/employees/activity/page.tsx`, `src/app/(app)/offboarding/[employeeId]/page.tsx`, `src/app/(app)/offboarding/page.tsx` + its toolbar (Export), `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`.

No `prisma/` change.

## 10. Constraints (binding on every task)

- No migration; `prisma/` untouched.
- Guard order in every action: role, then `checkRate`; one `writeAudit` per domain write inside the same transaction; `ActionResult` union returns.
- `aria-label`s near a field never contain that field's label word; the only new `aria-label` is on the fleet-bar segments (no field nearby). Heading rows in comboboxes stay `role="presentation"` (untouched here).
- Links carry visible reference text; `stopPropagation` wherever a link sits inside a clickable row.
- Dev only in a worktree with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`, no `SEED_PASSWORD`; dev server `npm run dev -- -p 3100`; Playwright foreground `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a time; only one walker at a time; **nobody seeds while another agent walks or tests**; `netstat`/`taskkill` port hygiene after every server.
- Never read or print `.env`; never touch the `inventory` database or port 3000; never seed staging.
- Docs are CRLF in the working tree; edits preserve line endings.
- Commit messages: new commit for a wrong message, never amend; `git add` new files before a pathspec commit; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
