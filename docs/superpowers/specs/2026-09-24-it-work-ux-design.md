# Phase 32 — Laws of UX applied to the IT screens where the work gets done

**Status:** designed 2026-09-24; not yet planned or implemented. No migration.

**Predecessor:** a read-only audit of the IT-side screens not yet covered by Phases 29–30 (`main` at `e33c5ff`): 73 findings — 23 on offboarding (queue, wizard, farewell report), 8 on `/reservations`, 9 on the worklist `/inventory/work`, 5 on Home, 6 on the scan landing, 6 on `/inventory/labels`, 11 on `/approvals`, 5 on `/audit` and the activity feeds. The audit read the code; it could not walk a signed-in session (an agent may not type a password into the login form), so one finding (F-SCAN-6, phone target sizes) is marked "needs walk" — the design fixes it regardless and the e2e proves the result. Finding ids are cited below as `F-…`.

The house standard is Phase 29's employee area (`2026-09-22-employee-ux-design.md`) and Phase 30's inventory area (`2026-09-23-inventory-ux-design.md`): these screens are brought into line with them (Jakob's law within the app), reusing their rules and controls rather than inventing new ones.

---

## 0. Decisions made during the brainstorm

1. **Two phases.** Phase 32, "doing the work": offboarding end to end, the worklist, Home, the scan card, plus the reservations hand-over (F-RES-1, so all four High findings land together). Phase 33, "queues and records": approvals, the rest of reservations, labels, `/audit` and the activity feeds, and the old-toolbar sweep — its own brainstorm answers later (§2).
2. **Collect step:** a **Mark the rest as Returned…** dialog lists every undecided item with Returned preselected, each changeable; one confirm files one decision per item.
3. **Accounts & M365 is reachable before every item is decided;** only Complete stays gated.
4. **The M365 "no sync yet" option** is renamed **Never had an account** and sits behind a confirmation.
5. **The farewell report's striped placeholder is removed** (not replaced by a QR).
6. **The Worklist nav item gets a count badge;** IT staff keep landing on `/inventory`.
7. **The worklist keeps the section order the user chose** and gains count chips at the top.
8. **The worklist's ✓ "Clear for today" becomes a row-menu Hide until tomorrow,** with Undo and a hidden count.
9. **A viewer's Home shows the worklist read-only,** as `/inventory/work` already does.
10. **The scan card gives IT roles the record state's main action** (Return, Assign, Triage, Mark checked) through the shared controls; other roles stay read-only.
11. **Holds are still placed from the asset record and the profile only;** `/reservations` gains the hand-over and keeps Release.
12. **Screen verification runs through Playwright and unit tests.** Agents do not sign in through the Browser pane.
13. **The new e2e file joins battery chunk E1** (46 tests, the most headroom).
14. **No migration.** Attention and next-step orders are computed; hide/undo lives in the existing `UserPreference` dismissal value; the badge is a count query.

---

## 1. Goal

Make the screens where IT does its daily work obey the laws its operators feel: one loudest thing per screen and it is the next step (Von Restorff, goal gradient), unfinished business visible and ordered worst first (Zeigarnik, serial position), the work done where it is listed rather than a trip away (Fitts, Tesler, Doherty), gates shown before they refuse (Tesler, Postel), and an ending worth the task (Peak-End).

## 2. Non-goals (recorded, each with its home)

- **Phase 33 ("queues and records")** takes: the old-toolbar sweep on every list that predates the house search shape — `/offboarding` (F-OFF-4), `/reservations` (F-RES-5), `/approvals` (F-APR-6), `/audit` (F-MISC-2, 3); the rest of `/reservations` (F-RES-3 banner, F-RES-4 per-tab columns, F-RES-6 expiry count, F-RES-8 Reserve dialog — declined by decision 11); `/inventory/labels` (F-LAB-1…6); `/approvals` and its detail (F-APR-1…11, including one-step approve); `/audit` and the feeds' search by label (F-MISC-1, 4, 5). The audit file's findings and product questions Q4, Q8, Q8b carry over to that brainstorm.
- **Still parked from Phase 30:** the History/Timeline merge, the Repair card's RMA/quote dialogs, the list's record-shaped skeleton, Serial and Loan due as optional columns (`HANDOVER-PENDING.md` §5.3).
- **Not changed:** the wizard's decision discipline (Missing is first-class; undecided is never defaulted; the scanner's Enter-hazard handling), the completion gates on the server, the scan page's disclosure rule (no cost or vendor behind a sticker), the worklist's per-section blurbs, Home's fleet, age and warranty cards.

---

## 3. Shared rules

- **Everything in Phase 30 §3 applies:** copy pinned in §9, subject first, no roadmap talk, dates through `fmtDate` (Asia/Manila) including toasts; friendly status words; headers with one primary, visible secondaries only where a decision says so, then `IconButton` ⋯ `aria-label="More actions"` opening `Menu`; dialogs name the device and the person and confirm with a verb; row menus named `Actions for {tag}` (or `Actions for {name}` on a person row); no interactive element inside another; product `aria-label`s never contain a nearby field's label word.
- **New pure rules, in `src/lib`, unit-tested before any UI:**
  - `offboardingNext(state) → { step: StepId; label: string; href: string } | null` in `src/lib/offboarding.ts` — the next step for one leaver: `Resolve {refNo}` (a return in EXECUTION_FAILED) → `Set a date` (no completion date) → `Collect {n} items` (undecided items, `?step=collect`) → `Close account` (M365 live, `?step=accounts`) → `Complete` (`?step=report`) → `null` when OFFBOARDED. `leaverRow` in `src/lib/worklist.ts` takes its label and href from it, so the queue, the wizard header, the worklist and Home say the same thing.
  - `completionBlockers(data) → Blocker[]` in `src/lib/offboarding.ts` — mirrors `completeOffboarding`'s three server refusals exactly: undecided items, any decision in EXECUTION_FAILED, M365 not inactive. Each blocker carries its label and the href that fixes it. Empty means Complete may be offered.
  - `offboardingAttention(row) → { kind; label; severity } | null` and `orderByOffboardingAttention(rows, dir)` — worst first: return failed · overdue by {d} d · no completion date · {n} to decide · account still {status} · ready to complete; ties by name then id (the Phase 30 `orderByAttention` shape).
  - `defaultStep(state) → StepId` — without `?step=`, the wizard opens on `collect` while any item is undecided, `accounts` while M365 is live, else `report` (the Finish step); an OFFBOARDED employee opens on `review`.
  - In `src/lib/worklist.ts`: the hidden-today count per section, the `Showing {n} of {total}+` cap line, the loan date words through `fmtDate` and the Manila-day `daysUntil` (so "overdue by N d" matches the record's `DuePill`), and the viewer label `Open`.
- **Reuse:** Phase 30's shared record controls (`triage-control`, `loan-due-control`, `holder-control`, `it-check`), `recordPrimary` / `recordActions`, `attentionOf`, the portal `Menu`, controlled dialogs, `HoldPill`, `DuePill`, `ProgressBar`, `data-changed` for 2 s after a change (Phase 29 §4.7).
- **Role discipline unchanged:** viewers see no action controls and every verb reads `Open`/`View`; Finance and Purchasing see IT records read-only; the server guards stay the real ones.

---

## 4. Offboarding

### 4.1 The queue `/offboarding` (F-OFF-1, 2, 3, 5, 6)

- **Default order is Attention** (`orderByOffboardingAttention`, desc = worst first), a derived sort key computed in memory over the candidate set (already small, per `offboarding-list.ts`'s P-5 note) and only as the **primary** key (`primarySortOf`, Phase 31). Name, Due and the other headers stay one click away; a header click demotes Attention and the clicked column orders.
- **One state-labelled action per row** from `offboardingNext` — a secondary button, not ten primaries. Viewers see `View`. The name stays the row's link to the wizard.
- **Columns:** Name (with its marker line — the one worst reason from `offboardingAttention`), Department, Started, Due, **Progress** (`{k} of {n} decided` over a thin bar, replacing Items out and Undecided), action. **Joined** is dropped; **M365** shows only through the marker line.
- **Count line:** `{n} people leaving · {k} overdue`, the second part a link to the Due = Overdue facet; when none are overdue, `{n} people leaving`.
- **Empty state:** `No one is leaving. Start offboarding from a person's profile — More › Start offboarding…`.
- **Export** moves into the header's ⋯ More menu (`window.location.assign`); the queue header has no primary.

### 4.2 Wizard header and entry (F-OFF-7, 8, 18, 20)

- **Header primary** from `offboardingNext` — `Collect {n} items`, `Close account`, `Complete offboarding`, or none once OFFBOARDED. **More:** Employee record, Farewell report, Export sheet. Viewers get no primary and keep the READ-ONLY pill.
- **Entry step:** no `?step=` → `defaultStep`. The queue's row action, the worklist and Home carry the step explicitly.
- **Step names:** Review holdings · Collect items · Accounts & M365 · **Finish** (was "Farewell report"; the step id stays `report`, so every existing `?step=report` link keeps working). The printable page is **Farewell report** everywhere (its H1 included).
- **Friendly words** for employment, asset status and decision state; enums stay only as mono labels where the house already prints them.

### 4.3 Collect step (F-OFF-9, 10, 11, 12, 13)

- **One muted hint line** under the step bar replaces the stacked banners: `Each confirm is saved at once · scan a tag to jump to it`, plus `Some items file a request for approval.` only when the item paths mix. The scan verdict stays the only banner-tone element. Viewers see one read-only line, not one per card.
- **Progress at the top:** `ProgressBar` + `{k} of {n} decided`.
- **Order:** undecided first, then blocked, then decided-and-awaiting-approval as compact one-line rows (`Decided · {refNo} · awaiting approval`).
- **After a confirm:** the card is marked `data-changed` for 2 s and focus moves to the next undecided card's group (the same non-activatable `tabIndex=-1` group the scanner uses, keeping the Enter-hazard rule).
- **Reason check on the client too:** Confirm stays enabled; a Defective / Buyout / Missing without a reason sets the error in the same pass and focuses the reason field. The server refusal stays the real rule.
- **Mark the rest as Returned…** (decision 2) — a secondary button above the list, shown while two or more items are undecided and unblocked. The dialog `Mark the rest as Returned · {name}` lists each such item (`{tag} · {model}`) with an outcome select preselected to Returned; switching an item to Defective / Buyout / Missing reveals its required reason field. Confirm reads `File {n} decisions`. It calls a new server action `decideRemaining` (§8) and reports per item: all filed → toast `{n} decisions filed` and the dialog closes; some refused → the dialog stays open, the filed items are removed from it, and each refused item shows its refusal inline.

### 4.4 Accounts & M365 and Finish (F-OFF-14, 15, 16, 17, 19)

- **Accounts & M365 is reachable from the step bar at any time** (decision 3). Finish is always reachable too; the readiness checklist is the gate.
- **The null M365 option** reads **Never had an account**. Choosing it while a live status is stored asks `Clear {name}'s Microsoft 365 status? Only do this if they never had an account.` with the verb `Clear status`. `Inactive` is the suggested choice when the current value is live. The custom-value hint reads `Stored exactly as typed.`
- **Finish step: readiness checklist** from `completionBlockers`, above the button — `Equipment · {k} of {n} decided` (✓ / ✗ with a link to Collect), `Requests · {refNo} failed to execute` (✗, links the approval), `Microsoft 365 · {status}` (✗, links Accounts). **Complete offboarding** is the primary only when the checklist is clear — never a disabled button standing in for a transition that would fail. The server gate stays as the backstop and its refusal still renders if the state changed underneath.
- **The ending:** after Complete, a success card `{name} offboarded · {n} decisions · {date}` with **Print farewell report** (primary) and `Next leaver →` (the next person in Attention order), or `Queue clear` linking `/offboarding` when none remain. It replaces the "already offboarded" banner for the operator who just finished; someone arriving later at a closed record still sees that banner.
- **Review's Holdings table:** Decision, Decided by and Decided on collapse into one `Decision` cell (`Returned · {actor} · {date}`), shown only when any item is decided.

### 4.5 Farewell report (F-OFF-21, 22, 23)

- **A print-hidden `PageHeader`** with the breadcrumb `Offboarding › {employeeNo} › Farewell report`, so the Phase 28 Back control appears.
- **Removed:** the roadmap clause (the line keeps `{employeeNo} · {n} decision(s)`) and the striped placeholder (decision 5).
- **Printed mid-way:** while any item is undecided the report is headed `DRAFT — {n} items undecided` and lists them under `Still to decide`; the export sheet carries the same rows with an empty decision.

---

## 5. The worklist `/inventory/work` and Home

### 5.1 Rows act in place (F-WORK-1, 2, 7, 8)

- **Each row's action is a button opening the shared control** the record uses: `Triage…`, `Set loan date…`, `Mark checked`, `Return…`, `Assign…`. On success the row leaves (or updates) and a toast confirms, the same toasts the record gives. The queries already select tag, model and holder; each row gains the fields its control needs.
- **Rows whose work lives elsewhere keep a link with a precise target:** `Fill loadout` → the profile's `#loadout`; `Collect equipment` / `Close account` / `Complete` → the wizard step from `offboardingNext`; approval rows → `/approvals/{id}`.
- **Honest labels:** the approval rows' "Claim" and "Retry" read `Open` (the link claims and retries nothing; one-click claim is a Phase 33 question). Viewers see `Open` on every row.
- **Dates** through `fmtDate`; "overdue by N d" and "due in N d" counted on the Manila day, matching `DuePill`.

### 5.2 Row menu, hiding and reach (F-WORK-3, 4, 5, 6, 9)

- **Row menu** `Actions for {tag}` (or `{name}`): Open record / Open profile (as applicable) / **Hide until tomorrow** — replacing the ✓ IconButton.
- **Hiding:** toast `Hidden until tomorrow · Undo`; Undo removes the key from the same `UserPreference` dismissal value. Each section heading reads `{n}` or `{n} · {k} hidden today` with a `Show` link that lists the hidden rows (with `Unhide`) for today. `dismissShiftRow` gains its twin `undismissShiftRow`; both run the house guard order role → rate → zod (fixing today's zod-first order) and the client handles refusals (toast, `RateLimitNotice`).
- **Summary chips** at the top of the page: one per non-empty section, `{Section} {n}`, each jumping to its `#section` anchor; a `{k} past SLA` chip in the accent tone when any row breaches. The section order is unchanged (decision 7).
- **Capped sections:** `Showing {n} of {total}+ · See all`, linking the list that holds the rest — `/inventory?sort=attention` with the matching facet, `/approvals?tab=failed`, `/offboarding`.

### 5.3 The Worklist badge (F-HOME-2)

`NavItem.badge` gains `"worklist"`; the Worklist item shows the count of visible (not hidden-today) worklist rows for admin and IT, from one cheap count query run alongside the approvals badge's. Landing pages are unchanged (decision 6).

### 5.4 Home (F-HOME-1, 3, 4, 5)

- **The Worklist card's headline:** `{n} waiting · oldest {d} d · {k} past SLA` (parts omitted when zero), and `Open worklist` as the card's header action.
- **Viewers see the worklist read-only** with `Open` links (decision 9).
- **Claimed by you** renders only for roles that can approve; when empty it is one muted line under the Worklist card (`You hold no claims.`).
- **Jump to** is removed.

---

## 6. The scan card `/inventory/scan/[tag]` (F-SCAN-1…6)

- **IT roles get the state's main action** (decision 10): `recordPrimary(asset, role)` from `src/lib/record-actions.ts`, rendered as a full-width button at least 44 px tall opening the same shared control (Return…, Assign…, Triage…, Mark checked). **Open full record** sits beneath it as a full-width secondary. When `recordPrimary` returns none (a pending approval, a role that may not act, another class's record) there is no action button; a pending approval shows its banner linking the request.
- **A leaver's device:** when the holder is OFFBOARDING, an accent line `{name} is leaving · collect it in the offboarding wizard →` links `/offboarding/{id}?step=collect`.
- **One attention line** from `attentionOf` (`back, not checked`, `overdue by {d} d`, `queued {refNo}`, `awaiting IT check`), plus `HoldPill` when a hold is placed and `DuePill` on a loan. The query selects the fields these need.
- **Friendly status words;** the holder links `/employees/{id}` for roles that can see employees.
- **Unknown tag:** besides the banner, a tag input (autofocus) to re-type a misread code and `Search inventory for "{tag}"`.
- **Disclosure unchanged:** no cost, vendor or purchase data on this page.

---

## 7. The reservations hand-over (F-RES-1, 2, 7)

- **Each ACTIVE hold row gets a row menu** `Actions for {tag}`, for roles that may act: **Assign to {name}…** (the shared Assign control with the assignee preset; on the approval path its copy `This files a request for approval.` applies), **Release…**, Open record, Open {name}'s profile. FULFILLED / RELEASED / EXPIRED rows get Open record and Open profile only; viewers get the same two.
- **Release moves into the menu;** the inline button goes.
- **The Release dialog** reads `Release the hold on {tag} · {model} for {name}?` with the verb `Release`.
- Placing a hold stays on the record and the profile (decision 11).

---

## 8. Server

- **New action `decideRemaining(input)`** in `src/server/modules/offboarding/actions.ts`: input `{ employeeId, decisions: { assetId, outcome, reason? }[] }` (1–50 entries). Guard order role → rate (one `mutation` event for the batch) → zod. It re-reads the wizard state, refuses items that are no longer undecided or are blocked, and files each remaining decision through the same internal path `decideItem` uses — one transaction and one audit row per item, direct or queued exactly as `decideItem` would be. Returns `{ filed: { assetId, refNo }[], refused: { assetId, message }[] }`; the revalidations are `decideItem`'s.
- **`undismissShiftRow`** in `src/server/modules/home/actions.ts`, the twin of `dismissShiftRow`; both on role → rate → zod.
- **Queries:** `listOffboarding` gains the per-person inputs `offboardingAttention` needs (the EXECUTION_FAILED flag `getWizard` already derives through `decisionOf`, undecided and total counts, M365, due) and the Attention candidate pass; the wizard gains the next leaver in Attention order; the worklist rows gain their controls' fields and the hidden-today counts; a `worklistCount(user)` for the badge; the scan query gains `loanDueAt`, `returnedAt`, the active hold, the open approval, the holder's id and employment.
- **No new tables, columns or preferences.**

---

## 9. Pinned copy

`{n} people leaving · {k} overdue` · `No one is leaving. Start offboarding from a person's profile — More › Start offboarding…` · `{k} of {n} decided` · `Resolve {refNo}` · `Set a date` · `Collect {n} items` · `Close account` · `Complete` · `Complete offboarding` · `View` · attention reasons `return failed · {refNo}` / `overdue by {d} d` / `no completion date` / `{n} to decide` / `account still {status}` / `ready to complete` · `Review holdings` · `Collect items` · `Accounts & M365` · `Finish` · `Farewell report` · `Employee record` · `Export sheet` · `Each confirm is saved at once · scan a tag to jump to it` · `Some items file a request for approval.` · `Decided · {refNo} · awaiting approval` · `Mark the rest as Returned…` · `Mark the rest as Returned · {name}` · `File {n} decisions` · `{n} decisions filed` · `Never had an account` · `Clear {name}'s Microsoft 365 status? Only do this if they never had an account.` · `Clear status` · `Stored exactly as typed.` · `Equipment · {k} of {n} decided` · `Requests · {refNo} failed to execute` · `Microsoft 365 · {status}` · `{name} offboarded · {n} decisions · {date}` · `Print farewell report` · `Next leaver →` · `Queue clear` · `DRAFT — {n} items undecided` · `Still to decide` · `Triage…` · `Set loan date…` · `Mark checked` · `Return…` · `Assign…` · `Open` · `Open record` · `Open profile` · `Fill loadout` · `Hide until tomorrow` · `Hidden until tomorrow · Undo` · `{n} · {k} hidden today` · `Show` · `Unhide` · `{k} past SLA` · `Showing {n} of {total}+ · See all` · `{n} waiting · oldest {d} d · {k} past SLA` · `Open worklist` · `You hold no claims.` · `Open full record` · `{name} is leaving · collect it in the offboarding wizard →` · `Search inventory for "{tag}"` · `Assign to {name}…` · `Release…` · `Open {name}'s profile` · `Release the hold on {tag} · {model} for {name}?` · `Release` · `Actions for {tag}` · `Actions for {name}` · `More actions`.

## 10. Edge cases

- **A return filed from the wizard that fails to execute** blocks completion: it leads the queue's Attention order, its row action is `Resolve {refNo}`, and the checklist links the approval.
- **Mark the rest with a straggler blocked** (a pending approval on one item): the blocked item is not listed in the dialog; the button counts only listable items and hides below two.
- **Concurrent change during Mark the rest:** items decided by someone else in the meantime come back in `refused` with the house conflict copy; nothing is filed twice.
- **Never had an account on a live status** needs the confirmation; on an empty status it is a plain choice.
- **Next leaver** skips the person just completed and anyone the viewer cannot act on; with no one left the card says `Queue clear`.
- **A worklist row whose state changed underneath** (someone else triaged it): the control's server refusal renders in the dialog as on the record, and the row refreshes.
- **Hidden rows reappear the next Manila day**, as today's dismissals do; the badge excludes today's hidden rows.
- **Scan card on a Purchasing-class record for an IT user:** no primary (another class), read-only card as today; on a pending approval: the banner, no primary.
- **Assign to {name}… on a hold whose spare has since been assigned elsewhere:** the shared control's refusal renders; the hold row refreshes.

## 11. Tests

- **Unit (vitest):** `offboardingNext` (each state, precedence), `completionBlockers` (each blocker alone and combined; parity with the three server refusals), `offboardingAttention` + `orderByOffboardingAttention` (every kind, ties), `defaultStep`, the worklist helpers (hidden count, cap line, Manila-day loan words, viewer label), `decideRemaining`'s pure input check where it has one.
- **New e2e `e2e/it-work-ux.spec.ts` (about 15 cases, chunk E1):** the queue opens in Attention order with the state-labelled action and the overdue link; the wizard opens on Collect mid-way with the header primary; Mark the rest as Returned files N decisions with one item switched to Missing with a reason; the client reason error; Accounts reachable before collection; Never had an account behind the confirm; the Finish checklist blocks, then Complete appears and the success card offers Next leaver; the farewell report's Back and DRAFT section; a worklist Triage… in place; Hide until tomorrow with Undo and the hidden count; the Worklist badge count; a viewer's Home worklist read-only; the scan card's primary for IT (Return on a held device) and the leaver line; a viewer's scan card with no action; Assign to {name}… from `/reservations`; axe on each screen.
- **Adapted e2e:** every pinned selector these screens carry — `/offboarding` is pinned by 10 specs, the worklist and Home by several more, `/reservations` by `holds.spec.ts`. The plan scouts every hit into a facts file before the first task, and each is adapted in the task that changes it, never deleted.
- **Verification (decision 12):** screen tasks prove themselves with focused Playwright runs, one agent at a time on port 3100; the full seven-chunk battery runs on the final tree.

## 12. Files

- **Rules:** `src/lib/offboarding.ts` (`offboardingNext`, `completionBlockers`, `offboardingAttention`, `orderByOffboardingAttention`, `defaultStep`), `src/lib/offboarding-list.ts` (the `attention` key, default sort), `src/lib/worklist.ts` (`leaverRow` via `offboardingNext`, the helpers), `src/lib/workspaces.ts` (the `worklist` badge) — each with tests.
- **Server:** `src/server/modules/offboarding/actions.ts` (`decideRemaining`), `queries.ts` (queue inputs, Attention pass, next leaver), `src/server/modules/home/actions.ts` (`undismissShiftRow`, guard order), `src/server/modules/home/queries.ts` (row fields, hidden counts, `worklistCount`), the scan page's query, the reservations query (assignee id for the preset).
- **Offboarding UI:** `src/app/(app)/offboarding/page.tsx`, `[employeeId]/page.tsx`, `[employeeId]/report/page.tsx`, `src/components/offboarding/*` (wizard steps, item decision, scan provider hint, accounts panel, complete button, a new `mark-rest-dialog.tsx`, a new readiness checklist and success card).
- **Worklist and Home:** `src/app/(app)/inventory/work/page.tsx`, `src/app/(app)/page.tsx`, `src/components/home/*` (worklist rows, row menu, summary chips, the dismiss button replaced), the nav badge rendering.
- **Scan:** `src/app/(app)/inventory/scan/[tag]/page.tsx` (+ a small client wrapper for the shared control).
- **Reservations:** `src/components/reservations/holds-table.tsx`, `release-hold-button.tsx`.
- **e2e:** `e2e/it-work-ux.spec.ts` (new) and the adapted files.
- **Docs:** `HANDOVER.md` (a (y) block, §0 item 9's E1 line), `PICKUP.md`, `HANDOVER-PENDING.md` (Phase 33's scope), this spec's Status, the plan's D-block.

## 13. Constraints

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write in its transaction; `AuditEntry` is append-only — tests never delete audit rows.
- Dev only in the phase worktree (its `.env`: `inventory_dev`, `APP_BASE_URL` on port 3100, no `SEED_PASSWORD`); never read or print `.env`; never touch `inventory` or port 3000; never seed staging.
- One agent at a time runs Playwright or a dev server on 3100; the port is free before and after.
- No migration.
