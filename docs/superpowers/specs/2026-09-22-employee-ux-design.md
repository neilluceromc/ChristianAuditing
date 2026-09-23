# Phase 29 — Laws of UX applied to the employee area

**Status:** implemented on `phase-29-employee-uiux` (plan `docs/superpowers/plans/2026-09-22-phase-29-employee-ux.md`, final tree `9660e6e`, 2026-09-22); merged to `main` via `--no-ff` `d76903b` and pushed 2026-09-23 (the merged tree is byte-identical to the tested tip `e01923a`); deployed to staging by the 2026-09-23 `-Force` redeploy (`ccb0432`); no migration. Amendments made during execution are marked *Amended (R-n)* below and listed in the plan's D-block.

**Predecessor:** a read-only audit of the three screens as they render and as their code reads (worktree `phase-29-employee-uiux` at `67f4e9e`, walked as IT and as a viewer): 43 findings — 11 on `/employees`, 12 on `/employees/new`, 20 on `/employees/[id]` — each tied to the law it breaks, with the code line, the cost to the operator and a fix. This design takes about 35 of them; §2 records the rest. Nothing here needs a migration.

---

## 0. Decisions made during the brainstorm

1. **The top task is daily maintenance on the profile** — editing a person's details, assigning new assets, replacing and removing them. So **Edit stays a visible header button**, never a menu item; the slot tiles are where assign, replace and return happen, and their affordances get the most weight.
2. **A filled slot tile opens an action menu on click** (Replace, Return, Open record, plus Waive / Remove exception where they apply) — not the Return dialog (today) and not the asset record (the auditor's first proposal). No accidental returns, every action one click away, the same on touch; the tag inside the tile becomes a real link.
3. **All three screens in one phase**, about 35 findings: every one-liner and small item an operator can see, plus the mediums that serve decision 1 (the tile menu, the state-aware header, agreeing numbers, reservations on the tile they fill, a searchable Replace picker, queued spares marked, a policy preview under Title, filter chips).
4. **The New form stays one card.** It is short enough; the policy preview under Title (§5.3) is what a second step would have earned, without the step.
5. **Employment stays on the create form**, with its conditional "Complete offboarding by" — a real capability today (the importer and the profile own the other transitions, but day-one creates of a leaver exist).
6. **Leavers stay hidden by default**, and the count says so: "9 people · 1 leaver hidden", the number linking to the existing toggle.
7. **No bulk actions on the employees list** — a scope decision, not a defect; recorded in §2.
8. **The Loadout sort key means completeness ascending**: one click on the header puts the least complete people first (most required gaps), the second click reverses; people with no policy sort last either way. The ordering is computed over the candidate set in memory (`missingRequired` is derived, not stored) — team scale, like `holdFacets`.
9. **The new e2e file joins battery chunk E1** (37 tests; E2 has grown twice).
10. **No migration.** The remembered Slots/Table view uses the existing `UserPreference` store through a `saveLoadoutView` action beside `saveColumns`.

---

## 1. Goal

Make the employee area obey the laws its operators feel every day: one loudest thing per screen (Von Restorff), fewer and clearer choices at each decision point (Hick), targets you can see and hit (Fitts), behaviour that matches the rest of the app and common software (Jakob), feedback within the moment (Doherty), complexity absorbed by the system rather than the operator (Tesler), tolerant input (Postel), and an ending worth the task (Peak-End).

## 2. Non-goals (recorded, each with its home)

- Splitting the New form into steps (decision 4); a leavers-visible default (decision 6); bulk actions on the employees list (decision 7); the same-name check on fields other than Name; a stored onboarding checklist or an explicit "gap acknowledged" state (the first thing here that would need a migration).
- Audit findings not taken (cosmetic, or superseded): F-LIST-9's "page 1 of 1" is taken as a one-liner but nothing else about pagination; F-PROFILE-18's tile stripe is shrunk, not redesigned; the Table view keeps its columns; the header's "Export holdings" stays (in the menu); the ⋯ menu's exact icon and the toast's position are unchanged.
- Bulk "print five accountability forms" / "export holdings for a department" — see decision 7.

---

## 3. Shared rules

- **Copy is pinned in §8.** New sentences follow the house voice: subject first, no phase numbers in operator-facing text, dates through `fmtDate` (Asia/Manila).
- **Menus** use the existing `Menu` (`src/components/ui/menu.tsx`: `MenuItem { label; onSelect; danger? }`); navigation items call `router.push`. Buttons keep the house `Button` variants; the state-chosen primary is `variant="primary"`, Edit is `secondary`, the More trigger is the `IconButton` ghost.
- **Live checks** are read-only server actions on the same 400 ms debounce and staleness guard as `checkSameName` (`same-name-check.tsx`); they never block typing and never write.
- **Feedback**: every mutation keeps the toast; the changed tile also carries a 2 s accent ring after the refresh, and a pending marker while the action runs.
- **Accessibility**: tiles keep their accessible names ("laptop slot, empty, required"); a non-interactive viewer tile keeps the name on a `div`; menus are the existing roving-focus `Menu`; product `aria-label`s never contain a nearby field's label word.
- **Role discipline** unchanged: viewers see no Import/New/Edit/menus; frozen leavers keep their frozen slots.

*Amended (R15): the four read-only live checks meter against their own `check` rate kind at 240/min, so a bulk-add burst cannot starve the 60/min mutation budget; `RateEvent.kind` is a plain `String`, so still no migration.*

---

## 4. `/employees/[id]` — the profile

### 4.1 Header (F-PROFILE-1, 2, 20)

`[id]/page.tsx` renders `PageHeader` with the breadcrumb (so the Phase 28 Back control appears), the H1 name, and badges: the employment `Pill` (existing) plus, when `employment === "OFFBOARDING"` and `offboardingDueAt` is set, a `DuePill` (`withDate`) — accent when overdue. Actions, left to right:

| state | primary (variant primary) | Edit | More menu (IconButton ⋯, `aria-label="More actions"`) |
|---|---|---|---|
| ACTIVE, every slot empty, ≥1 slot | **Assign kit** → opens the first required slot's Fill dialog | shown | Timeline · Export holdings · Transfer… · Start offboarding… |
| ACTIVE, N required gaps (N ≥ 1, not all empty) | **Fill N gap(s)** → focuses the first empty required tile (`#loadout` scroll + focus) | shown | same |
| ACTIVE, complete or no policy | none | shown | same |
| OFFBOARDING | **Open the offboarding wizard** → `/offboarding/[id]` | shown | Timeline · Export holdings (no Transfer, no Start offboarding) |
| OFFBOARDED | none | shown | Timeline · Export holdings |
| viewer (any state) | none | none | none — the READ-ONLY pill stays |

"Accountability form" leaves the header; the acknowledgement card's "Print form" and the created notice keep the link. The pure rule `profilePrimary(state): { label; action } | null` lives in `src/lib/loadout.ts` and is unit-tested.

*Amended (R6): an ACTIVE person under an all-optional policy with nothing assigned gets NO primary — `missingRequired` is 0 and §4.4 calls optional slots “not a gap”, so “Assign kit” would demand what the policy does not.*

### 4.2 One truth for the numbers (F-PROFILE-3, 15)

The left panel drops the duplicate name. The progress line reads **"1 required gap"** (or "No required gaps") as the headline — `loadout.missingRequired`, the number the list prints — with **"3 of 6 slots filled"** as the secondary line; the `ProgressBar` keeps `filled / totalSlots` for its geometry and gets `label="Slots filled"`. It sits directly above the slot grid. The four `Stat`s render only when they have data: on a person with no items, one muted line "No items yet" replaces Book value and Oldest item.

*Amended (R14/R11): this section is binding against the plan's “replaces the four Stats” — “No items yet” replaces Book value and Oldest item only, Items held is implied by the line, and the Open requests Stat stays whenever `openApprovals.length > 0`.*

### 4.3 Empty cards (F-PROFILE-19)

`TransfersCard` renders a single muted line "No transfers" (no card chrome) when empty. The "No equipment policy applies…" banner links "Equipment policies" to `/admin/equipment-policies` for admin and IT, and is not rendered when the person is frozen (OFFBOARDING/OFFBOARDED).

### 4.4 Tiles (F-PROFILE-4, 5, 10, 14, 18)

- **Filled tile**: click, Enter, Space and Backspace open the **tile menu** anchored to the tile. Items in order: `Replace…`, `Return…` (danger), `Open record` (→ `/inventory/[assetId]`), then `Waive this slot…` when the slot is required and not waived, `Remove exception` when the slot is an exception. The asset tag inside the tile is a real `Link` to the record (`stopPropagation`). The tile's role stays `button` with its accessible name.
- **Empty tile**: click/Enter/Space open the **Fill dialog** (unchanged); its ⋯ menu holds `Reserve a spare…` and `Waive this slot…` (existing).
- **The ⋯ trigger** is always rendered at reduced contrast (`text-fg-faint`, hover `text-fg`), 28 × 28 px hit area, and opens the same menu as the tile.
- **Order and labels**: within the grid, required-and-empty tiles come first, then filled, then optional-and-empty; an optional empty tile reads **"optional — not a gap"** in muted text where a required one reads "policy gap".
- **The decorative block** shrinks to a 6 px status strip carrying the `StatusDot` tone; the age reads once, in the tile's meta line.
- **Viewers**: `!mayAct` renders the tile as a `div` with the same accessible name via `aria-label`, no `+` glyph, no tab stop, no menu; the tag stays a link.

*Amended (P-7): the filled tile's own `<button>` IS the `Menu` trigger and the always-visible ⋯ is a second `Menu` with the same items, rather than one menu shared by two anchors. (P-8): the tag inside a tile stays TEXT, not a link — a link nested in the tile button fails axe `nested-interactive`; it is a link only on the inert viewer tile. (R13): “Waive this slot…” is offered on any policy slot without an exception, optional ones included (pre-phase behaviour), and the dead `required` parameter left `tileMenuItems`. (R2): the inert branch is `!canMutate`, so a viewer's tiles stay inert on a frozen profile too.*

### 4.5 Dialogs (F-PROFILE-6, 7, 16, 17)

- **Fill**: a sole eligible spare is preselected. A spare with an open assign approval renders "assignment queued · APR-2041" and is disabled, like a held spare (`pendingRef` computed for every candidate from the `openApprovals` the page already loads, not only for held ones). The no-spares message reads "No spare {type} in stock — **register one** or **route a purchase**", both links (`/inventory/register`, `/purchases/new`).
- **Replace**: the flat radiogroup becomes the Reserve dialog's `EntityCombobox` (`autoFocus`, groups "Same type" then "Other spares", held and queued spares disabled with their note); the reason chips and outcome copy unchanged.
- **Return**: title **"Return {tag} · {model} from {employee name}?"**.

*Amended (P-9): `EntityCombobox` has no disabled options, so Replace EXCLUDES held and queued spares instead of disabling them, with a muted count line saying so, and a three-way empty state tells “no spares in stock” apart from “every spare is held or queued”. (R7): `pendingRef` is computed from every open approval on the asset, not only this employee's, so Fill, Replace and the Reserve picker all skip a spare another person's approval is waiting on.*

### 4.6 Reservations on the tile (F-PROFILE-8, 9)

An empty tile whose type has a hold reserved for this person shows a meta line **"reserved · {tag}"** and an **Assign reserved** button (calls the existing `requestAssignReserved` for that one asset). "Assign all N reserved" renders whenever `reservedCount > 0` and the person is not frozen.

*Amended (R8): “the tile” is read strictly — one consuming pass over the ordered tiles attaches each reserved spare to at most the FIRST empty matching tile, so one reservation never lights several same-type tiles.*

### 4.7 Feedback (F-PROFILE-11)

`LoadoutView` keeps `pendingSlot` state: the tile whose action is running gets `data-pending` (opacity 60 %, `aria-busy`); after the successful refresh the tile carries `data-changed` for 2 s (accent ring via CSS). The toast is unchanged.

### 4.8 Table view (F-PROFILE-12, 13)

The Table view lists every slot: filled rows as today, empty required slots as rows reading "policy gap", optional ones "optional"; the On-loan and Also-holding cards stay visible in Table view. The Slots/Table choice is saved per user through `saveLoadoutView(view)` (`src/server/preferences.ts`, `UserPreference` key `view:loadout`) and read on the page.

---

## 5. `/employees/new` — the New employee form

### 5.1 Order, focus, one card (F-NEW-1, 8, 9)

The Person card runs **Name, Title, Department, Employee number, Joined, Employment** (+ "Complete offboarding by" when OFFBOARDING), **Account status** last. `autoFocus` on Name. The Microsoft 365 card is removed; its hint moves under Account status without the phase number: "Set when the M365 account exists; the directory sync fills it in later." The Employment hint reads "Offboarding is started from the person's page."

### 5.2 Live employee-number check and the next free number (F-NEW-2)

`checkEmployeeNo(no)` → `{ taken: boolean; existing?: { id; name } }` (case-insensitive, trimmed). Under the field, after the debounce: **"EMP-0099 is already Carlo Dizon's"** (the name linking to the profile) in the error tone, or nothing. When the field is empty, `nextEmployeeNo()` → the smallest unused number above the highest `EMP-####` in the table (`"EMP-0100"`), shown as **"Next free: EMP-0100"** with a **Use it** button that fills the field; nothing is prefilled silently. If no employee number follows the `EMP-####` pattern, no suggestion renders.

*Amended (R9): the taken-number line shows the number AS TYPED, not uppercased — the operator sees what they entered.*

### 5.3 The policy preview (F-NEW-7)

`previewPolicy(title, departmentId)` → `{ name; slots } | null` through `resolvePolicy` (title beats department, as the profile resolves it). Under Title, after the debounce: **"matches {policy} · {slots} slots"** or **"no policy matches this title yet"**; the line re-evaluates when Department changes.

### 5.4 One refusal, all errors, focus (F-NEW-3, 4, 5, 6)

- The same-name refusal is stated once: the banner names the existing person with the employee number as a link to their profile (`checkSameName` returns the id) and holds the "This is a different person" checkbox; the field error under Name is removed.
- `createEmployee` validates every rule and returns all field errors in one `validationError`; after a refusal the form focuses the first invalid control and scrolls it into view.
- Department stays blank on create (the Phase 23 rule; pinned by `deadlines.spec.ts`).

*Amended (P-3/R3): the refusal arrives under the `_sameName` key and renders as the banner's BODY line, “Not added — tick ‘This is a different person’ to add them anyway”, while the title keeps “Another {name} exists in {department} ({no})” with the number linked — the full sentence in both places would have repeated the title word for word.*

### 5.5 The action bar (F-NEW-10, 11, 12)

Pinned to the bottom of the form column (`sticky bottom-0`, surface background, top border): **Cancel** (ghost; `router.back()`), **Create employee** (primary), **Create and add another** (secondary). "Add another" saves, toasts "Added {name}", and resets the form keeping Department, focusing Name. Text fields trim on blur so the stored value is the shown value; Joined carries the hint "defaults to today".

*Amended (R10): which button submitted is read from the DOM at submit time (`(e.nativeEvent as SubmitEvent).submitter`, with `name`/`value` on the two buttons), not from React state, which the same task could read stale.*

---

## 6. `/employees` — the list

### 6.1 Columns and sort (F-LIST-1, 2, 7, 8)

Columns: Employee · Department · **Loadout** · Items · Employment · M365 · Joined. `EMPLOYEES_LIST_CONFIG.sortable` gains `"loadout"` (decision 8); `listEmployees` fetches the candidate set when sorting by it, computes `missingRequired`, orders in memory (asc: most gaps first, `null` last), then pages. Loadout cells: `null` → **"no policy"** (`text-fg-faint`), `0` → **"complete"** (settled tone), `N` → **"N missing"** (attention tone, as today). M365 loses its `StatusDot` and renders plain `text-fg-muted` mono. Rows gain a trailing chevron cell (`aria-hidden`) and a visible `:focus-visible` outline.

### 6.2 Toolbar (F-LIST-3, 4, 5, 6)

- Count line: **"9 people"**, plus **" · 1 leaver hidden"** (the number a link to the Show-leavers href) when the default cut hides anyone — `listEmployees` returns `hiddenLeavers`.
- Search: placeholder **"Search name, number, title, department · Enter"**; a clear **×** button (`aria-label="Clear search"`) when `q` is set; `buildEmployeeWhere` adds `{ department: { name: { contains, mode: "insensitive" } } }` to the OR.
- The two toggles (**Show leavers**, **Policy gaps only**) render as pill switches with a leading check when on (`role="switch"`, `aria-checked`), still plain links; the Department and Employment facets keep the `FacetDropdown`.

*Amended (P-2): the toggles stay LINKS reached by `getByRole("link")` — pill-styled with a leading check and `aria-current` rather than `role="switch"`/`aria-checked`, which three existing specs pin. (R16, parked): `key={state.q}` on the search input also remounts it on Enter, so the box loses focus after a search; the fix belongs with the five sibling toolbars that share the shape.*

### 6.3 Header and empty states (F-LIST-9, 10, 11)

`PageHeader` actions: **New employee** (primary) and a **More** `IconButton` menu with `Import…` and `Export`. "page 1 of 1" renders only when `pageCount > 1`. The filtered-empty state shows a `ChipFilterRow` of the active filters (search text, each facet value, "Leavers shown", "Policy gaps only") above "Clear filters".

---

## 7. Errors and edge cases

- A tile menu on a frozen person's tile shows only `Open record` (the frozen banner explains).
- "Assign reserved" on a tile whose hold was just released: the action returns its conflict and the tile refreshes without the line.
- `nextEmployeeNo` with a gap in the sequence still suggests highest + 1 (gaps stay gaps).
- `checkEmployeeNo` for the person's own number on the edit form is not called (the check is create-only).
- The policy preview with an empty Title shows nothing; with Department set and Title unmatched, it shows the department policy if one applies ("matches Finance standard · 6 slots (department)").
- A viewer's Loadout sort works (read-only); the toggles and facets behave as today.
- "Create and add another" after a same-name refusal keeps the banner behaviour: the refusal must be resolved before either create button succeeds.
- Keyboard: the tile menu closes on Escape returning focus to the tile; Backspace no longer returns an asset directly.
- The saved view preference failing to persist never blocks the toggle (the view still switches; the preference save is fire-and-forget with a console warning).

---

## 8. Copy (pinned)

Header primaries: "Assign kit", "Fill 1 gap" / "Fill N gaps", "Open the offboarding wizard"; menu: "More actions" (aria), "Timeline", "Export holdings", "Transfer…", "Start offboarding…". Progress: "1 required gap" / "N required gaps" / "No required gaps", "3 of 6 slots filled", "No items yet", "No transfers". Tile menu: "Replace…", "Return…", "Open record", "Waive this slot…", "Remove exception". Tile meta: "policy gap", "optional — not a gap", "reserved · {tag}", "Assign reserved", "assignment queued · {refNo}". Return title: "Return {tag} · {model} from {name}?". No spares: "No spare {type} in stock — register one or route a purchase." Form: "Next free: {no}", "Use it", "{no} is already {name}'s", "matches {policy} · {slots} slots", "matches {policy} · {slots} slots (department)", "no policy matches this title yet", "defaults to today", "Cancel", "Create employee", "Create and add another", "Added {name}", "Set when the M365 account exists; the directory sync fills it in later.", "Offboarding is started from the person's page." List: "no policy", "complete", "N missing", "{n} people · {k} leaver(s) hidden", "Search name, number, title, department · Enter", "Clear search", "Show leavers", "Policy gaps only", "More" (menu), "Import…", "Export", "Leavers shown".

---

## 9. Tests

**Unit** (`vitest`): `loadout.ts` — `profilePrimary` for each state row in §4.1, the tile ordering, `tileMenuItems(tile, ctx)` per state and role; `employees-list.ts` — `buildEmployeeWhere` with the department term, the `loadout` sort ordering rule (`orderByLoadout(rows, dir)`: gaps desc/asc, nulls last); `nextEmployeeNo` from a list of numbers (gaps, non-pattern numbers, empty); `previewPolicy` resolution order (title, department, none).

**e2e** — pinned assertions that adapt (named by the audit): `custody.spec.ts` (the headset slot's ⋯ name unchanged; the Return dialog title now "Return BR-LT-0148 · … from …?"; a filled tile click now opens the menu, so the case picks "Return…" from it), `it-nav.spec.ts` and `directory.spec.ts` (the Create button inside the sticky bar; Import/Export reached by URL), `deadlines.spec.ts` (department blank on create — unchanged). New `e2e/employee-ux.spec.ts` (joins chunk **E1**): 1 filled tile click opens the menu, Return… still confirms with the new title, Escape closes and refocuses; 2 the tag inside a tile opens the record; 3 a leaver's header shows the due pill and "Open the offboarding wizard" as the only primary, Edit still present; 4 Nina Robles: "Assign kit" on day one, "Fill N gaps" after one assignment focuses the first empty required tile; 5 "reserved · BR-MN-0910" on her monitor tile and Assign reserved fulfils the hold; 6 the list sorted by Loadout puts gaps first and "no policy" last, and the count states the hidden leaver; 7 search clear and a department term; 8 the New form: Name focused first, the live number check names the owner, "Next free" fills the field, the policy preview reads the Finance policy for a Finance title, the same-name refusal appears once with a profile link, "Create and add another" returns a blank form keeping the department; 9 a viewer's tiles are inert and the tag still links. Each case restores what it creates (employees created by case 8 are deleted; audit rows stay).

**Battery**: the seven chunks; `--list` expected 380 + 9 = 389 tests / 38 files.

---

## 10. Files

- **New:** `src/components/employees/tile-menu.tsx`, `src/components/employees/policy-preview.tsx`, `src/components/employees/employee-no-check.tsx`, `src/components/employees/profile-actions.tsx`; `e2e/employee-ux.spec.ts`.
- **Modified:** `src/lib/loadout.ts` (+test), `src/lib/employees-list.ts` (+test), `src/server/modules/employees/queries.ts` (loadout sort, `hiddenLeavers`, department search), `src/server/modules/employees/actions.ts` (`checkEmployeeNo`, `nextEmployeeNo`, `previewPolicy`, `checkSameName` returning the id, all-errors validation), `src/server/preferences.ts` (`saveLoadoutView`); `src/app/(app)/employees/page.tsx`, `employees/new/page.tsx`, `employees/[id]/page.tsx`; `src/components/employees/employees-table.tsx`, `employees-toolbar.tsx`, `employee-form.tsx`, `same-name-check.tsx`, `loadout-view.tsx`, `transfers-card.tsx`; the e2e files named in §9.
- **Docs (closing task):** `docs/HANDOVER.md` (line 3, a (v) block, §0 item 9 with `e2e/employee-ux.spec.ts` in E1, §8), `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, this spec's Status, the plan's D-block.

## 11. Constraints (binding on every task)

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write; `AuditEntry` append-only.
- Copy pinned verbatim (§8); no phase numbers in operator-facing text; product `aria-label`s never contain a nearby field's label word.
- Department stays blank on create; the reason chips, remembered picks, first-field focus, the created notice and the role discipline listed in the audit's "what is good" section are kept.
- Dev only in the worktree with its own `.env` (`inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`); Playwright foreground, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a time, port free before and after; only one implementer walks a dev server at a time.
- Docs are CRLF; HANDOVER's lettered blocks are not in one order — anchor edits on block headers.
