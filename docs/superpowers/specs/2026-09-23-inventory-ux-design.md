# Phase 30 — Laws of UX applied to the inventory area

**Status:** implemented on `phase-30-inventory-uiux` (plan `docs/superpowers/plans/2026-09-23-phase-30-inventory-ux.md`, final tree `4e6fc7f`, 2026-09-23); code-complete, UNMERGED and UNPUSHED; no migration. Amendments made during execution are marked *Amended (P-n / R-n)* below and listed in the plan's D-block.

**Predecessor:** a read-only audit of the inventory screens (worktree `phase-30-inventory-uiux` at `c563600`): 57 findings — 19 on `/inventory`, 19 on the create flows, 19 on `/inventory/[id]`. The audit read every in-scope file whole and measured target sizes and seed facts; it could not walk a signed-in session (an agent may not type a password into the login form), so four findings were marked "needs walk" — F-LIST-16, F-CREATE-8 (timing), F-CREATE-17, F-RECORD-9. The design fixes each of them regardless and the e2e proves the result. The audit's finding ids are cited below as `F-…`.

The house standard is Phase 29's employee area (`2026-09-22-employee-ux-design.md`): the inventory screens are brought into line with it (Jakob's law within the app).

---

## 0. Decisions made during the brainstorm

1. **The record's header has one state-chosen primary; on a held device it is Return.** Replace, Change status, Reserve, Set loan date and Print label go into a ⋯ More menu. **Edit stays a visible button**, as on the employee profile.
2. **One create flow.** `/inventory/register` becomes the only way to register assets, named "Register assets" everywhere; Quantity defaults to 1 and at quantity 1 the form also offers the initial state, the assignee, a loan date and documents with kinds. `/inventory/new` redirects to it.
3. **List rows gain a ⋯ row menu** with the record's actions (Assign…, Return…, Change status…, Print label, Open record), reusing the record's dialogs.
4. **An exact tag typed or scanned into the list search still jumps to the record** (today's scanner contract).
5. **Unfinished business shows on the list:** a marker line in each row's Status cell and a derived **Attention** sort key, computed in memory like Phase 29's Loadout key. The Worklist page is unchanged.
6. **`/inventory` opens on the first class the role manages** (Purchasing staff → Purchasing, admin → IT, Finance, which manages none → the first visible class, IT). Deterministic, nothing stored.
7. **Scope:** all three screens in one phase — 55 findings taken (two of them in part), 2 parked with a home (§2).
8. **Screen verification runs through Playwright and unit tests.** Agents do not sign in through the Browser pane; a task that needs to see a screen proves it with a focused Playwright case. A manual walk happens only if the user signs in once in the pane.
9. **The new e2e file joins battery chunk E2** (42 tests, the most headroom).
10. **No migration.** The default class derives from the role; the Attention sort is computed in memory; the loan date at creation rides the existing lifecycle path; no new preference is stored.

---

## 1. Goal

Make the inventory area obey the laws its operators feel daily: one loudest thing per screen (Von Restorff), fewer and clearer choices at each decision point (Hick), targets you can see and hit (Fitts), behaviour that matches the rest of the app (Jakob), unfinished business made visible (Zeigarnik), tolerant input (Postel), complexity absorbed by the app (Tesler), feedback in the moment (Doherty), and an ending worth the task (Peak-End).

## 2. Non-goals (recorded, each with its home)

- **Parked in full:** merging the History and Timeline tabs into one (F-RECORD-5 — one audit-and-approvals stream with expandable field diffs; its own phase, it touches `mergeTimeline` and two e2e files); "Record RMA…" / "Record quote…" dialogs on the Repair card (F-RECORD-13 — needs its own server action and repair-stage tests). Both go into `HANDOVER-PENDING.md`.
- **Parked in part:** a record-shaped loading skeleton (the second half of F-LIST-16; the list-navigation pending state is taken); extra optional columns such as Serial and Loan due in the chooser (the second half of F-LIST-17; the caption is taken).
- The Worklist page, the scan landing (`/inventory/scan/[tag]`), `/inventory/labels`, `/inventory/import`, `/inventory/activity` and the export route are not redesigned; they change only where a fix below must touch them.
- Bulk registration with holders: at quantity > 1 every unit is created as the class's default status, as today.

---

## 3. Shared rules

- **Copy is pinned in §8.** Subject first, no phase numbers, no roadmap talk ("yet"), dates through `fmtDate` (Asia/Manila) — including every toast.
- **Status words are friendly everywhere an operator chooses one:** Spare, Deployed, Loan, Defective, Repairing, Stored, Missing, Operational (the list's Status column keeps the enum in mono, as a label, with the dot beside it).
- **Headers:** one primary (`variant="primary"`), then visible secondaries only where a decision says so (Edit on the record), then an `IconButton` ⋯ with `aria-label="More actions"` opening the existing `Menu`. Navigation items call `router.push`; items whose target is a route handler (downloads, exports) call `window.location.assign`.
- **Dialogs** name the device and, where there is one, the person in the title, and confirm with a verb (Assign, Return, Replace, Save decision, Reserve, Change status) — never a bare "Confirm".
- **Forms:** one field order, one control per field, trim on blur, live checks while typing on the house 400 ms debounce with the staleness guard, metered on the `check` rate kind; the submit is always enabled, client checks set every error at once, the server returns every post-schema refusal in one `validationError`, and the first invalid field is focused and scrolled into view; a sticky action bar Cancel · primary · "… and add another".
- **Lists:** search with `key={state.q}`, a Clear × (`aria-label="Clear search"`) and "· Enter" in the placeholder; view switches are pill toggles (links, ✓ and `aria-current` when on, at least 28 px tall); chips show the value alone; "page 1 of 1" is hidden; list navigations run in a transition and mark the table `data-pending` / `aria-busy` (60 % opacity) until the new rows arrive.
- **Accessibility:** no interactive element inside another; every icon button named; row menus are named `Actions for {tag}`; product `aria-label`s never contain a nearby field's label word.
- **Role discipline unchanged:** viewers and Finance see no create or lifecycle controls; an action area with nothing in it says why.
- **Pure rules live in `src/lib` and are unit-tested:** `recordPrimary`, `statusTargets`, `attentionOf`, `orderByAttention`, `defaultClassFor`, `parseSerialPaste`, `normaliseCost`, the holder terms of `buildAssetWhere`.

---

## 4. `/inventory/[id]` — the asset record

### 4.1 Header (F-RECORD-1, 3, 7, 15, 18)

- **Breadcrumb** is class-aware: its href is `"/inventory" + withClsQS("", cls)` and its label is that class's list title — "Inventory" for IT, "Purchasing assets" for Purchasing — so it is the Back control's fallback too.
- **Badges:** the status pill; at most one pill that asks something of this viewer — `AWAITING IT CHECK` (IT roles, Purchasing-registered and unchecked), `AWAITING FINANCE` (Finance and admin only), `BACK · NOT CHECKED`; and `READ-ONLY · VIEWER` for viewers. The class pill, the provenance pill and the finance-state pill move into a **Record** row at the top of the Procurement card on the Overview.
- **Actions** become a client `RecordActions`, the twin of `ProfileActions`. The primary comes from the pure rule `recordPrimary(asset, role)`, evaluated in this order (first match wins):

| # | state | primary | More menu (in order, each only where the role may) |
|---|---|---|---|
| 1 | an approval is pending on this asset | none — the pending banner explains | Print label |
| 2 | back, not checked (`returnedAt` set) | **Triage** | Change status…, Reserve…, Print label |
| 3 | Purchasing-registered, awaiting IT check (IT roles) | **Mark checked** | Print label |
| 4 | sent back by Finance (roles that may resubmit) | **Mark corrected** | the state's other items (rows 6–7) |
| 5 | Finance or admin on an unconfirmed record | **Confirm details** | Send back to IT…, then the state's other items |
| 6 | held (DEPLOYED / TEMPORARY) | **Return** | Replace…, Change status…, Set loan date… (loans), Print label |
| 7 | assignable spare | **Assign** | Reserve…, Change status…, Print label |
| 8 | anything else the role can act on | none | Change status…, Print label |

- **Edit** stays a visible secondary button beside the primary wherever `canEditAsset(role, asset)`.
- **Admin sees exactly one primary**: when two rows apply (e.g. a Finance-returned IT spare), the lower-numbered one is primary and the other's action is the first More item.
- **Print label** → `/inventory/labels?ids={id}`, for roles that may print labels.
- **An empty action area** (Purchasing staff on a checked IT record, Finance on a confirmed record) shows a muted line: `Managed by {CLASS_LABEL} — view only`.
- Finance's errors render inside the Confirm / Send back dialogs (kept open on failure), never inside the header's action row (F-RECORD-14). *Amended (P-4 / R6): a pending approval suppresses only the lifecycle actions — Finance's Confirm / Send back and IT's Mark checked / Mark corrected stay available — and Change status offers only `statusTargets` on the approval path too.*

### 4.2 Change status (F-RECORD-2, F-LIST-14)

`statusTargets(asset)` in `src/lib/asset-class.ts` returns the statuses a direct change may pick: never the current one; no holder status (`HOLDER_STATUSES[cls]`) without a holder — Assign does that; no non-holder status while held — Return does that; while held, only the other holder statuses. The dialog opens on the placeholder "Pick a status…" (no preselection), lists friendly labels, and is not offered while an approval is pending (row 1 above). The bulk drawer's status picker uses the same rule for unheld devices.

### 4.3 Dialogs (F-RECORD-8, 9, 10, 11)

- **Titles:** `Assign {tag} · {model}`, `Return {tag} · {model} from {name}?`, `Replace {tag} · {model} for {name}`, `Reserve {tag} · {model}`, `Triage {tag} · {model}`, `Change status of {tag} · {model}`, `Set the loan date for {tag}`.
- **Buttons:** Assign, Return, Replace, Reserve, Save decision (Triage), Change status, Save date.
- **Assign** puts "Assign to" first with `autoFocus`, then Deployed / Loan, then "Loan until".
- **Replace** is autofocused and excludes spares held for someone else or queued by an open approval, with the muted line `{n} more spare(s) is/are held or queued for someone else` (the Phase 29 wording).
- **Loans:** the header's loan line becomes a `DuePill` with the date (accent when overdue); both loan toasts print `fmtDate`.
- The dialogs used by the record become shared controls (`src/components/inventory/*-control.tsx` taking an asset summary), so the list's row menu opens the same ones (§6.3). *Amended (P-5 / R15): the non-direct (approval-path) dialogs keep today's titles and labels and add `This files a request for approval.`; Finance confirms with `Confirm details` (title `Confirm details of {tag}?`), never a bare Confirm.*

### 4.4 Overview and tabs (F-RECORD-4, 6, 16, 17, 19)

- **Identity** card: Brand, Serial, Category, Type, and — when on loan — "Loan until" with the `DuePill`. Tag, status, model and holder stay in the header only.
- **Last change** line: `{verb phrase} · {date} · {actor}` without repeating the tag or the actor (e.g. `assigned to Carlo Dizon · 12 Sep 2026 · Ana Reyes`).
- **Tabs:** Overview · History · Timeline · Documents · Secrets (no pill in the label) · Reservations — Reservations only for IT records.
- **Documents:** rows show the kind's label (`KIND_LABELS`), not the slug; a dropped or chosen file first shows its name, a kind select (images default to Photo) and an **Upload** button — nothing is stored until Upload.
- **Secrets:** pending is tracked per secret (only the clicked Reveal spins); a revealed value gains a **Copy** button that reads "Copied" for 2 s.

### 4.5 Edit (F-RECORD-12)

`/inventory/[id]/edit` leaves the record layout (a sibling route group), so the live action header and the tabs no longer sit above the form. It keeps the record's breadcrumb (so Back returns to the record), gains a sticky bar **Cancel** · **Save changes**, and on success toasts `{tag} saved` and returns to the record. `asset-form.tsx` becomes edit-only (§5.1).

### 4.6 Finance's next step (F-RECORD-14)

After **Confirm details** succeeds, the toast is followed by a `Next to review →` link to the next unconfirmed asset in the Finance queue's order (`cost desc, tag asc, id asc`, same class); when there is none, `Queue clear` with a link back to `/finance/assets`.

---

## 5. `/inventory/register` — one Register flow

### 5.1 One page, one name (F-CREATE-1, 18)

- "Register assets": both nav entries (`src/lib/workspaces.ts`), the list's primary, the H1, the breadcrumb (`Inventory › Register assets`, class-aware).
- `/inventory/new` becomes a redirect to `/inventory/register` keeping `?cls=`. The create branch of `asset-form.tsx` is removed; the component serves Edit only.
- Hints: Type — `Leave blank only if no loadout slot should match it.`; Tag — `The label is printed after you register.`

### 5.2 Field order (F-CREATE-5, 6, 7, 11, 12, 13)

Card **Asset**:
1. **Category** (focused) — an `optgroup` per class when the role registers more than one class.
2. **Type** (optional, hint above).
3. **Model**, then **Brand**.
4. **Quantity** — a text field holding what was typed; on blur it clamps to 1–200 and says so inline (`Between 1 and 200`).
5. **Tags:** at quantity 1, one **Tag** field suggested from the category prefix and editable, re-checked when the category changes; at quantity > 1, the prefix and start number as today.
6. **Rows** (quantity > 1): numbered, with "Tag" and "Serial" column headers, and `{k} of {n} serials entered` above the sticky bar. At quantity 1 a single **Serial** field. *Amended (P-12): at quantity 1 the form keeps its one-row table (`Tag 1` / `Serial 1`, the tag suggested and editable) as this list's one Tag and Serial field, with the quantity-1 extras below it.*

Card **Procurement (optional)**: Purchase request (options `{refNo} · {vendor} · {date}`; choosing one fills an empty Vendor) → Vendor (`EntityCombobox` with recents) → Purchased → Warranty until → Cost → Invoice no. → Documents (§5.4).

### 5.3 Quantity 1 only (F-CREATE-14)

**Initial state** — a segmented control **Spare · Deployed · Loan** (Purchasing class: its own default and holder statuses, same labels rule). Deployed and Loan reveal **Assign to** (`EntityCombobox` with recents); Loan also reveals **Loan until** (default today + `DEFAULT_LOAN_DAYS`, min tomorrow), passed to `createAsset` and on to `prepareLifecycle`, so no loan is created without a due date. The explanatory line is state-specific: Spare `Registered as a spare, ready to assign.`, Deployed `Deployed to the chosen person.`, Loan `Lent to the chosen person until the date below.` *Amended (R4 / R10): Loan is offered only on the direct path (`isDirectLifecycle(role, cls)`), because the approval executor never applies a loan date; a single registration audits `create`, and the record's Last change line reads it (`created · {date} · {actor}`).*

### 5.4 Input tolerance (F-CREATE-2, 3, 17, 19)

- **Enter** in a tag or serial row never submits: it moves focus to the next row's serial; in the last row it focuses the submit button. The form submits only from its buttons.
- **Paste a column:** pasting multi-line or tab-separated text into a serial cell splits it with `parseSerialPaste` (trim, drop empty lines) and fills that row and the ones below, growing Quantity if needed (up to 200); a line under the rows says `Pasted {n} serials`.
- **Cost** is a text field with `inputMode="decimal"`; on blur `normaliseCost` strips ₱, commas and spaces and shows the normalised value; an unparseable value is a field error `Enter an amount like 12500 or 12,500.50`, not a silent blank.
- **Documents** use one styled `FileDrop` (extracted from the Documents tab into `src/components/patterns/file-drop.tsx`): at quantity > 1 one invoice file applied to every unit (as today); at quantity 1 several files each with a kind. *Amended (R11): staged files carry across the quantity switch — 1 → N the first becomes the batch invoice and the rest stay listed with a warning; N → 1 the invoice returns as kind Invoice.*

### 5.5 Checks and errors (F-CREATE-4, 8, 16)

- Tag and serial duplicates are checked **while typing** (400 ms debounce, staleness guard, blur still triggers), on the `check` rate kind. `checkIdentifiers` returns the matching records: `{ tags: Array<{ tag, id }>, serials: Array<{ serial, id, tag }> }`.
- Messages name and link the record: `{tag} is already registered` (tag linked to its record); `Serial {serial} is already on {tag}`; row errors render under the rows naming the row: `Row 3 · BR-LT-0201 is already registered`.
- The submit is always enabled; a refused submit shows every error at once and focuses the first invalid field; `createAsset` / `registerBatch` collect every post-schema refusal (category, type, assignee, tags, serials, loan date) into one `validationError`.

### 5.6 Sticky bar and endings (F-CREATE-9, 10, 15)

- **Bar:** `Cancel` (ghost, `router.back()`) · **Register 1 asset** / **Register {n} assets** (primary) · `Register and add another` (secondary; the submit intent is read from the DOM submitter, as Phase 29's R10).
- **Add another** keeps Category, Type, Vendor, Purchase request, Purchased, Warranty until and Invoice no.; clears Model, Brand, Quantity, tags, serials, cost, files and the state fields; toasts `Registered {n} asset(s)`; focuses Model.
- **One asset:** the record opens with the created notice: `{tag} registered` with a **Print label** button and a `Register another` link.
- **A batch:** the success card lists every tag as a `TagRef` link (the first 10, then `and {k} more`), keeps **Print labels** as the primary, with `Open the list` and `Register another batch` beside it; the invoice-failure banner links the first unit's Documents tab.

---

## 6. `/inventory` — the list

### 6.1 Header and default class (F-LIST-1, 15)

- One primary **Register assets** (roles that can register the viewed class), then `IconButton` ⋯ `More actions` with `Import…` (IT view, roles that can mutate IT) and `Export` (the current filters, `window.location.assign`). *Amended (R12): the Register assets link carries the viewed class explicitly (`/inventory/register?cls={cls}`), since the Register page narrows categories only when `?cls=` is present.*
- `defaultClassFor(role)` = the first class in `MANAGEABLE_CLASSES[role]` that the role can see, else the first visible class; used when `?cls=` is absent.

### 6.2 Toolbar (F-LIST-2, 3, 4, 5, 10, 11, 17)

One row, in this order:
1. **View switches:** the class switch (roles that see both classes) and **Repairs**, as pill toggles; Repairs reads as on while its stage chips show.
2. **Search:** placeholder `Search tag, model, serial, holder · Enter`; `key={state.q}`; the Clear ×; the where gains `assignee.name` and `assignee.employeeNo` (insensitive `contains`).
3. **Facets:** the existing five, plus the year chips folded into a single-select **Purchased** facet (values = the years present, plus `No date`); the export cap's refusal text links to it.
4. **Columns** chooser at the right, captioned `Saved for you`.
5. **Count line:** `{n} asset(s)` plus ` · {k} need(s) attention` when k > 0, the second part a link that sorts by Attention.

Chips show the value alone, including `Search: {q}` and `Purchased: {year}`, so the filtered-empty count is right. The no-assets empty state speaks to roles that can register (`Register the first asset, or import a spreadsheet.`) and otherwise reads `No assets in this view.`

### 6.3 Rows (F-LIST-6, 7, 8, 9, 18, 19)

- **Status cell:** the dot beside the status word (the separate dot column goes), plus a second muted line from `attentionOf(row, today)`, one reason, worst first: `back, not checked` · `overdue by {d} d` · `no due date` · `due in {d} d` (within the worklist's `LOAN_DUE_SOON_DAYS`) · `queued {refNo}` · `awaiting IT check`.
- **Attention sort key** (`?sort=attention`): rows with a reason first, ordered by the reason's severity (the worklist's) then tag; rows without a reason after them by tag. Computed in memory over the class-visible filtered set, like the Loadout sort; `buildAssetOrderBy` never sees the key.
- **Tag** is a `Link` (no hard reload); **holder** is a `Link` to `/employees/{id}` with the employee number; both stop propagation.
- The **checkbox cell** is the whole hit target; the **whole header cell** sorts (a shared `Th` change the employees table inherits).
- Each row ends with a ⋯ `Actions for {tag}` menu: the items `recordPrimary`'s table allows for that row's state (Assign…, Return…, Change status…, Print label), then `Open record`. They open the shared controls of §4.3. *Amended (P-11 / R13→R14): the row menu renders only when it has an action beyond Open record; the shared Menu renders its popup in a portal, fixed-positioned and flipping against the viewport, so a short or scrolling table never clips it.*
- An exact tag match in the search still jumps to the record (decision 4).

### 6.4 Selection bar (F-LIST-13, 14)

Direct actions replace "Bulk actions…": **Print labels** · Export · Change status… · Assign… — the last two open the drawer already in that mode. The drawer lists the selected tags under its scope line (the first 5, then `and {k} more`), its status picker is `statusTargets` for unheld devices with friendly labels, and "off-the-books stock" becomes `stock that is not assigned to anyone`.

### 6.5 Paging and feedback (F-LIST-12, 16)

`page {n} of {m}` renders only when `pageCount > 1`. Search, facet, sort and page navigations run in `useTransition` and mark the table `data-pending` + `aria-busy` until the new rows arrive. *Amended (R15): pagination links go through the same transition (`NavLink`), so they mark the list busy too.*

---

## 7. Edge cases

- **Pending approval on a held device:** `recordPrimary` row 1 wins — no Return, no Change status; the banner links the approval; the row menu offers Print label and Open record only.
- **Purchasing-class records** keep the approval path: Assign and Return in the header or the row menu file requests (the dialogs say `This files a request for approval.`), exactly as today's controls do.
- **Admin on a Finance-returned IT spare:** Mark corrected is primary; Assign, Reserve, Change status, Confirm details and Send back to IT are More items; Edit stays visible.
- **The Attention sort at scale:** the candidate pass reads every asset the filters admit; recorded in `PICKUP.md` §5 as a known gap to revisit past a few thousand assets.
- **`/inventory/new` bookmarks** redirect; `?cls=PURCHASING` survives.
- **Quantity 1 with a Loan and no date** cannot be submitted (`Pick the date the loan ends`); quantity > 1 never creates holders.
- **Paste beyond 200 lines** fills 200 rows and says `Pasted 200 of {n} serials — the rest were not added.`
- **The duplicate check's new payload** is used by both the Register rows and the single Tag/Serial fields; `/inventory/import` keeps its own checks.

## 8. Pinned copy

`Register assets` · `Register 1 asset` / `Register {n} assets` · `Register and add another` · `Cancel` · `Register another` · `Register another batch` · `Print label` / `Print labels` · `Open the list` · `Open record` · `More actions` · `Actions for {tag}` · `Clear search` · `Search tag, model, serial, holder · Enter` · `Purchased` · `No date` · `Saved for you` · `{n} asset(s) · {k} need(s) attention` · `Search: {q}` · `Purchased: {year}` · `No assets in this view.` · `Register the first asset, or import a spreadsheet.` · `Pick a status…` · `Managed by {CLASS_LABEL} — view only` · `Next to review →` · `Queue clear` · `{tag} saved` · `{tag} registered` · `{tag} is already registered` · `Serial {serial} is already on {tag}` · `Row {i} · {tag} is already registered` · `Pasted {n} serials` · `{k} of {n} serials entered` · `Between 1 and 200` · `Enter an amount like 12500 or 12,500.50` · `Pick the date the loan ends` · `Leave blank only if no loadout slot should match it.` · `The label is printed after you register.` · `Registered as a spare, ready to assign.` · `Deployed to the chosen person.` · `Lent to the chosen person until the date below.` · `This files a request for approval.` · attention reasons `back, not checked` / `overdue by {d} d` / `no due date` / `due in {d} d` / `queued {refNo}` / `awaiting IT check` · dialog titles and verbs as §4.3 · `Copied` · `Upload`.

## 9. Tests

- **Unit (vitest):** `recordPrimary` (every row of §4.1's table, admin precedence), `statusTargets` (held, unheld, pending, per class), `attentionOf` + `orderByAttention`, `defaultClassFor` (every role), `parseSerialPaste`, `normaliseCost`, `buildAssetWhere`'s holder terms, the `attention` key never reaching `buildAssetOrderBy`.
- **New e2e `e2e/inventory-ux.spec.ts` (about ten cases, chunk E2):** the record header per state (spare → Assign, held → Return with Replace in More, back → Triage, pending → none); Change status offers only legal targets with no preselection; a row-menu Return from the list; the Attention sort and a marker; holder search and Clear; Register at quantity 1 as a Loan with a date, ending on the record with Print label; a batch with pasted serials and Enter moving rows; one-pass errors with focus; Purchasing staff open on Purchasing; a viewer's read-only record; axe on each screen.
- **Adapted e2e:** every pinned selector this phase changes — header buttons moving into More (Reserve, Replace, Change status, Import, Export), dialog titles and verbs, `/inventory/new` → Register, the year chips → the Purchased facet, "Bulk actions…" → the direct buttons, the success card. The plan scouts every hit before the first task.
- **Verification (decision 8):** screen tasks prove themselves with focused Playwright runs, one agent at a time on port 3100; the full seven-chunk battery runs on the final tree.

## 10. Files

- **Rules:** `src/lib/asset-class.ts` (`statusTargets`, `defaultClassFor`), `src/lib/record-actions.ts` (new, `recordPrimary`), `src/lib/inventory-attention.ts` (new, `attentionOf`, `orderByAttention`), `src/lib/register-input.ts` (new, `parseSerialPaste`, `normaliseCost`), `src/lib/inventory-list.ts` (holder terms, the `attention` and `purchased` keys) — each with tests.
- **Server:** `src/server/modules/inventory/actions.ts` (`checkIdentifiers` payload and rate kind, `createAsset` / batch one-pass errors and the loan date), `queries.ts` (the row's attention inputs and `assigneeId`, the Attention candidate pass, the Replace exclusions and hidden count, next-to-review), `src/server/modules/finance/queries.ts` (the next unconfirmed asset).
- **Record:** `[id]/layout.tsx`, `[id]/page.tsx`, `src/components/inventory/record-actions.tsx` (new), the controls (`holder-control`, `replace-control`, `status-control`, `triage-control`, `loan-due-control`, `finance-review`), `record-tabs.tsx`, `documents-panel.tsx`, `secrets-panel.tsx`, the edit route moved to its own group.
- **Register:** `register/page.tsx`, `register-form.tsx`, `register-success.tsx`, `created-notice.tsx`, `new/page.tsx` (redirect), `asset-form.tsx` (edit-only), `src/components/patterns/file-drop.tsx` (new), `src/lib/workspaces.ts` (nav names).
- **List:** `inventory/page.tsx`, `inventory-toolbar.tsx`, `inventory-table.tsx`, `bulk-drawer.tsx`, `column-chooser.tsx`, `src/components/ui/table.tsx` (`Th` hit area), an `inventory-more-menu.tsx` (new).
- **e2e:** `e2e/inventory-ux.spec.ts` (new) and the adapted files.
- **Docs:** `HANDOVER.md` (a (w) block, §0 item 9's E2 line), `PICKUP.md`, `HANDOVER-PENDING.md` (the parked items), this spec's Status, the plan's D-block.

## 11. Constraints

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write in its transaction; `AuditEntry` is append-only — tests never delete audit rows.
- Dev only in the worktree `phase-30-inventory-uiux` (its `.env`: `inventory_dev`, `APP_BASE_URL` on port 3100, no `SEED_PASSWORD`); never read or print `.env`; never touch `inventory` or port 3000; never seed staging.
- One agent at a time runs Playwright or a dev server on 3100; the port is free before and after.
- No migration.
