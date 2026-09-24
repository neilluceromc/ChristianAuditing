# Phase 33 — Laws of UX applied to the IT queues and records

**Status:** designed 2026-09-24; not yet planned or implemented. No migration.

**Predecessor:** the same read-only audit of the IT-side screens that Phase 32 took its half from (`main` at `e33c5ff`, 73 findings). Phase 33 takes the other half (spec `2026-09-24-it-work-ux-design.md` §2): 11 findings on `/approvals` and its detail page, 6 on `/inventory/labels`, 5 on `/audit` and the activity feeds, the 4 `/reservations` findings Phase 32 left, and the old-toolbar sweep (F-OFF-4, F-RES-5, F-APR-6, F-MISC-2, F-MISC-3). The audit read the code; it did not walk a signed-in session. Finding ids are cited below as `F-…`.

The house standard is Phases 29, 30 and 32 (`2026-09-22-employee-ux-design.md`, `2026-09-23-inventory-ux-design.md`, `2026-09-24-it-work-ux-design.md`): these screens are brought into line with them, reusing their rules and controls.

---

## 0. Decisions made during the brainstorm

1. **One-step approve.** On a PENDING request, **Approve** claims and approves in one transaction, writing both audit rows exactly as the two steps do today; **Claim** stays in the ⋯ More menu for "I'm on it".
2. **Labels gain a Tags box** for pasted or scanned tags (every label printed before 2026-09-23 encodes the old address and needs reprinting).
3. **Labels gain `Start at label N`** for partly used A4 sheets.
4. **`/audit` goes the whole way:** search by what the Entity column shows (tag, person, ref no) on `/audit` and the four activity feeds, rows read as sentences, and a **When** facet.
5. **Screen verification runs through Playwright and unit tests.** Agents do not sign in through the Browser pane.
6. **The new e2e file joins battery chunk D** (56 tests, the most headroom).
7. **No migration.** Nothing new is stored.

---

## 1. Goal

Make the screens where IT clears queues and reads records obey the same laws as the rest of the app: one loudest thing and it is the decision (Von Restorff), fewer steps to the common decision (Tesler), the next item offered after each one (goal gradient, Peak-End), search that finds what the screen shows (Postel, Jakob), and every list shaped like every other list (Jakob).

## 2. Non-goals (recorded, each with its home)

- **Placing a hold from `/reservations`** (F-RES-8) — declined in Phase 32 (decision 11); holds start on the record and the profile.
- **Still parked from Phase 30:** the History/Timeline merge, the Repair card's RMA/quote dialogs, the list's record-shaped skeleton, Serial and Loan due as optional columns (`HANDOVER-PENDING.md` §5.3).
- **Not changed:** the approvals keyboard contract (C / A / R / E stay, spec'd in Phase 21) and its screen-reader announcements; the per-state action set's rule of never showing a disabled stand-in; the label calibration guidance and refuse-never-slice; the audit log's append-only nature and its class scoping (`invisibleAuditRefs`).

---

## 3. Shared rules

- **Everything in Phase 30 §3 and Phase 32 §3 applies:** copy pinned in §9; dates through `fmtDate` (Asia/Manila); friendly words; headers with one primary, visible secondaries only where a decision says so, then `IconButton` ⋯ `aria-label="More actions"` opening `Menu`; dialogs name the subject and confirm with a verb; row menus named `Actions for {refNo}` / `Actions for {tag}`; no interactive element inside another; product `aria-label`s never contain a nearby field's label word.
- **The house list shape** (Phase 30 §3), applied here to every list that predates it: search with `key={state.q}`, a Clear × (`aria-label="Clear search"`) and `· Enter` in the placeholder; value-only chips; list navigations run in a transition and mark the table `data-pending` / `aria-busy` until the new rows arrive; `page n of m` renders only when `pageCount > 1`. The pieces already exist in the inventory and employee toolbars; they are shared, not copied (§8).
- **New pure rules, in `src/lib`, unit-tested before any UI:**
  - `approvalHeader(state, ctx) → { primary: ApprovalVerb | null; reject: boolean; more: ApprovalVerb[] }` — the detail page's and the row menu's actions by state (§4.1).
  - `labelSlots(count, startAt, perPage) → (string | null)[][]` — the sheet's pages with the first `startAt − 1` slots of page 1 left blank (§5.1).
  - `parseTagPaste(text) → string[]` — trimmed, upper-cased, de-duplicated tags, reusing `parseSerialPaste`'s splitting (§5.1).
  - `whenRange(value, todayISO) → { gte: Date } | null` — `today`, `7d`, `30d` on the Manila calendar (§6.2).
  - `expiringSoon(rows, todayISO, days = 2) → number` — ACTIVE holds whose expiry falls within the next two Manila days (§5.2).
- **Role discipline unchanged:** only approvers act on approvals (`isApprover`, `canActOnApproval`); viewers read; the server guards stay the real ones.

---

## 4. Approvals

### 4.1 The detail page `/approvals/[id]` (F-APR-1, 2, 3, 8, 9, 11)

- **The house header** replaces the action panel under the cards. `approvalHeader` decides:

  | State | Primary | Visible secondary | More |
  |---|---|---|---|
  | PENDING, can act | **Approve** (one step, decision 1) | **Reject…** | Claim, Escalate |
  | CLAIMED by me | **Approve** | **Reject…** | Release, Escalate |
  | CLAIMED by someone else, admin | **Approve** (admin override, as today) | **Reject…** | Release, Escalate |
  | CLAIMED by someone else, not admin | none | none | none — the header says `Claimed by {name}` |
  | EXECUTION_FAILED | **Retry** | **Reject…** | — |
  | APPROVED / EXECUTED / REJECTED | none | none | none |
  | cannot act (viewer, other class) | none | none | none |

  Whatever the rule returns must be a transition `approvalTransition` would allow for that user — never a button that would be refused. **Reject…** keeps its danger colour only on its dialog's confirm button.
- **One-step approve:** a new server action `approveNow` (§7).
- **After a decision:** the page shows `Next in queue →` linking the next open request this user can act on, in the Open tab's SLA order (`nextInQueue`, §7), or `Queue clear` linking `/approvals`. It replaces the plain refresh-in-place; the toast stays.
- **Card order:** "Before → after" first, "What the system checked" second.
- **Execution failures:** a plain sentence first — `The change could not be applied.` plus, where the worker error names a known cause (a status or holder mismatch, an OFFBOARDED target), one sentence naming it — with the raw worker error in a `details` disclosure (`Worker error`).
- **A return filed from an offboarding** (type `lifecycle_return`, employee OFFBOARDING) links `Open the offboarding wizard →` to `/offboarding/{id}?step=collect`.

### 4.2 The queue `/approvals` (F-APR-4, 5, 6, 7, 10)

- **Row menu** `Actions for {refNo}` on every row the user can act on, built from `approvalHeader` (Approve, Reject…, Claim, Release, Escalate as the state allows) plus `Open`. It calls the same code paths the keyboard shortcuts call; the shortcuts stay.
- **Keyboard selection:** the selected-row styling on row 1 shows only while the queue's keyboard wrapper has focus.
- **Search and filter:** the house search (`Search ref no, tag, person · Enter`, matching refNo, asset tag, employee name / employeeNo) and a **Type** facet (the approval types, friendly labels), with value-only chips. Both narrow every tab and the count.
- **Tabs:** the shared `Tabs` component replaces the hand-rolled tab bar (keep the same tab labels and query parameter).
- **Friendly words:** priority (`Normal`, `High`, `Urgent`) and state words replace the raw enums; enums stay only as mono labels where the house prints them.
- **Paging:** `{total} in this tab — ordered by SLA`; `page n of m` only when there is more than one page.

---

## 5. Labels and reservations

### 5.1 Labels `/inventory/labels` (F-LAB-1…6)

- **Tags box** (decision 2): when the page is opened without `?ids=`, it shows a labelled `Tags` textarea (`One per line, or separated by commas — paste or scan`) and a `Make sheet` button. `parseTagPaste` splits the input; the server resolves the tags to assets **within the classes the role may see** and builds the sheet; tags it cannot place are named in a line `Not found or not your class: {tags}`. Up to the existing label cap; beyond it, the existing refuse-never-slice copy.
- **Start at label N** (decision 3): a number field `Start at label` (1 to the sheet's slots per page, default 1) on the sheet view; `labelSlots` leaves the first N−1 slots of page 1 blank. It survives in the URL (`?start=N`) so a reload keeps it.
- **Summary:** `{n} labels · {k} skipped` names the skipped tags (`{tags} — not found or not your class`) and lists the tags on the sheet under the count — the first 10, then `and {k} more`.
- **Empty state:** `Select assets on the list, then choose Print labels in the selection bar — or Print label from a record's More menu.` (the Tags box sits under it).
- **Breadcrumb:** class-aware (`withClsQS`): `Inventory` or `Purchasing assets` › `Print labels`; the H1 reads `Print labels`; Back falls back to the class's list.
- **No-QR warning:** `No QR on these labels — the app's address is set to this computer only. Ask the administrator to set the network address.`; admin also sees the precise cause in a `details` disclosure.

### 5.2 Reservations `/reservations` (F-RES-3, 4, 5, 6)

- **The banner** becomes one muted hint under the tabs: `Held spares still read SPARE · place holds from a record or a profile`.
- **Columns per tab:** Active — Asset, Model, For, Reason, Expires, menu; Fulfilled — Asset, Model, For, Reason, Fulfilled on, menu; Closed — Asset, Model, For, Reason, State (`Released` / `Expired`), Closed, menu.
- **Count line:** `{n} holds · {k} expire within 2 days` (the second part only when `k > 0`), linking the Active tab sorted by Expires.
- **Toolbar:** the house list shape (§3).

---

## 6. `/audit` and the activity feeds

### 6.1 Search (F-MISC-1, 5)

- A shared server resolver `resolveEntitySearch(q, role) → { assetIds, employeeIds, approvalIds }` matches asset tag, employee name / employeeNo and approval refNo (case-insensitive contains, each capped) within what the role may see. `/audit` and the four activity feeds (`/inventory/activity`, `/employees/activity`, `/finance/activity`, `/purchases/activity` — one shared `activity-list-page`) OR `entityId in […]` with their existing action / actor matching.
- Placeholder on `/audit`: `Search tag, person, ref no, action · Enter`; on the feeds: `Search tag, person, ref no · Enter`.
- The audit export honours the same search.

### 6.2 Rows and the When facet (F-MISC-4)

- `/audit` rows read as the feeds' sentences (`auditSentence` from `src/lib/activity.ts`), with the action slug kept beside each in mono and the entity pill in friendly words.
- A **When** facet — `Today`, `Last 7 days`, `Last 30 days` — narrows by `createdAt` via `whenRange`; `/audit`'s export honours it.

### 6.3 The toolbars (F-MISC-2, 3)

The house list shape (§3) on `/audit` and the feeds: value-only chips (`Supplier`, not `entity: vendor`), Clear ×, the busy transition, `page n of m` only when needed.

---

## 7. Server

- **`approveNow(input)`** in `src/server/modules/approvals/actions.ts`: input `{ id }`. Guard order role → rate → zod; `isApprover` and `canActOnApproval`. In one transaction: the approval must still be PENDING; claim it for the user and approve it through the same state guards and `updateMany` checks `claimApproval` and `approveApproval` use, writing the same two audit rows (`approval.claimed`, then the approve row) and enqueuing the same execution job. Anything else — someone else claimed it, it moved on — returns the house conflict copy. `claimApproval` and `approveApproval` are unchanged.
- **`nextInQueue(userId, role, afterId)`** in `src/server/modules/approvals/queries.ts`: the first open request (PENDING, or CLAIMED by this user) in the Open tab's SLA order, excluding `afterId`, that this user can act on; `{ id, refNo } | null`.
- **The approvals list query** gains the search and the Type facet (and its facet counts).
- **`resolveEntitySearch`** (new, `src/server/audit/search.ts` or beside the audit queries) — shared by `/audit`, its export and the four feeds.
- **Labels:** the page's query accepts resolved tags as well as `?ids=`, within the role's classes.
- **Reservations:** the expiring-soon count over the Active tab's filtered set.
- **No new tables, columns or preferences.**

---

## 8. The shared toolbar pieces

The inventory and employee toolbars already render the house search (key, Clear ×, `· Enter`), value-only chips and the busy transition (`list-navigation.tsx`'s `useListNavigation`). The plan extracts what those two toolbars share into `src/components/patterns/` (a search box, a chip row, the list-navigation hook) and moves `/offboarding`, `/reservations`, `/approvals`, `/audit` and the feeds onto them — without changing the inventory or employee toolbars' behaviour or pins.

---

## 9. Pinned copy

`Approve` · `Reject…` · `Claim` · `Release` · `Escalate` · `Retry` · `Open` · `Claimed by {name}` · `Next in queue →` · `Queue clear` · `The change could not be applied.` · `Worker error` · `Open the offboarding wizard →` · `Actions for {refNo}` · `Search ref no, tag, person · Enter` · `Type` · `{total} in this tab — ordered by SLA` · `Normal` / `High` / `Urgent` · `Tags` · `One per line, or separated by commas — paste or scan` · `Make sheet` · `Not found or not your class: {tags}` · `Start at label` · `{n} labels · {k} skipped` · `{tags} — not found or not your class` · `and {k} more` · `Select assets on the list, then choose Print labels in the selection bar — or Print label from a record's More menu.` · `Print labels` · `No QR on these labels — the app's address is set to this computer only. Ask the administrator to set the network address.` · `Held spares still read SPARE · place holds from a record or a profile` · `Fulfilled on` · `Released` / `Expired` · `Closed` · `{n} holds · {k} expire within 2 days` · `Search tag, person, ref no, action · Enter` · `Search tag, person, ref no · Enter` · `When` · `Today` / `Last 7 days` / `Last 30 days` · `Clear search` · `More actions`.

## 10. Edge cases

- **Approve now on a request someone else claimed a moment ago:** refused with the house conflict copy; the page refreshes to the new state (and its header then follows `approvalHeader`).
- **Next in queue when the only other open request is claimed by someone else:** it is skipped (not actionable for this user); `Queue clear` if none remain.
- **Admin override** on another person's claim keeps working exactly as today.
- **A Tags box with more tags than the cap:** the existing refusal copy, nothing sliced.
- **A tag of another class:** named as not found or not your class — the page never reveals that it exists.
- **Start at label beyond the slots per page:** clamped to the valid range with the field's own validation message.
- **Search that matches nothing on `/audit`:** the existing empty state; a search term that is a cuid still matches `entityId` directly.
- **When + search + entity facets combine** (AND), in the list, the counts and the export.
- **The feeds' search** respects each feed's own class scoping.

## 11. Tests

- **Unit (vitest):** `approvalHeader` (every row of §4.1's table, and parity with `approvalTransition` — never a verb the transition refuses), `labelSlots` (start 1, start N, start beyond one page's worth, multi-page), `parseTagPaste` (separators, spaces, case, duplicates), `whenRange` (each value on the Manila day), `expiringSoon`.
- **New e2e `e2e/queues-records-ux.spec.ts` (about 12 cases, chunk D):** the detail header per state (PENDING → Approve + Reject…, More holds Claim); one-step Approve on a PENDING request with both audit rows and `Next in queue →`; Reject… from the header; the execution-failure sentence with the raw error in a disclosure; the queue row menu's Approve; queue search by tag and the Type facet; the Tags box resolving two tags and naming an unknown one; `Start at label 5` leaving four blank slots; the class-aware labels crumb; the reservations count line and per-tab columns; `/audit` search by a tag and by a person's name, the sentence rows and the When facet; a feed's search; axe on each screen.
- **Adapted e2e:** `/approvals` is pinned by 8 specs and `/audit` by 10; the plan scouts every hit into a facts file before the first task, and each is adapted in the task that changes it, never deleted.
- **Verification (decision 5):** screen tasks prove themselves with focused Playwright runs, one agent at a time on port 3100, in the foreground; the full seven-chunk battery runs on the final tree.

## 12. Files

- **Rules:** `src/lib/approval-header.ts` (new), `src/lib/label-geometry.ts` (`labelSlots`), `src/lib/register-input.ts` or a new `src/lib/tag-paste.ts` (`parseTagPaste`), `src/lib/audit-list.ts` (`whenRange`, the When facet, the search), `src/lib/holds.ts` (`expiringSoon`) — each with tests.
- **Server:** `src/server/modules/approvals/actions.ts` (`approveNow`), `approvals/queries.ts` (`nextInQueue`, search, Type facet), the entity-search resolver, the audit and feed queries and the audit export route, the labels page query, the reservations count.
- **Approvals UI:** `src/app/(app)/approvals/page.tsx`, `[id]/page.tsx`, `src/components/approvals/approval-actions.tsx`, `queue-table.tsx`, a new approvals toolbar.
- **Labels:** `src/app/(app)/inventory/labels/page.tsx`, `src/components/…/label-sheet.tsx`, a new tags-box client component.
- **Reservations:** `src/app/(app)/reservations/page.tsx`, `src/components/reservations/holds-table.tsx`, `holds-toolbar.tsx`.
- **Audit and feeds:** `src/app/(app)/audit/page.tsx`, `src/components/audit/audit-toolbar.tsx`, `src/components/patterns/activity-list-page.tsx`, `activity-toolbar.tsx`.
- **Shared toolbar pieces:** `src/components/patterns/` (§8), `src/components/offboarding/offboarding-toolbar.tsx`.
- **e2e:** `e2e/queues-records-ux.spec.ts` (new) and the adapted files.
- **Docs:** `HANDOVER.md` (a (z) block, §0 item 9's D line), `PICKUP.md`, `HANDOVER-PENDING.md`, this spec's Status, the plan's D-block.

## 13. Constraints

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write in its transaction; `AuditEntry` is append-only — tests never delete audit rows.
- Dev only in the phase worktree (its `.env`: `inventory_dev`, `APP_BASE_URL` on port 3100, no `SEED_PASSWORD`); never read or print `.env`; never touch `inventory` or port 3000; never seed staging.
- One agent at a time runs Playwright or a dev server on 3100, in the foreground; the port is free before and after.
- No migration.
