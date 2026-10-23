# Worklist split view (H4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/inventory/work` as the owner's chosen mockup H4. It fits on one screen and has these parts:
- **Queue tabs** with counts.
- **A summary line** for the open queue.
- **Filters:** category, over 90 days, and a search box.
- **A table:** sortable, paged, with multi-select.
- **A details panel** for the selected row, holding that queue's actions.
- **Decide → next row**, plus Undo for reversible decisions.

**Owner's request (2026-10-23):**
- "Improve the work list ui".
- After the first round: "all is cluttered and too many distractions… good ux ui design and principles".
- Then: "i dont want infinite or scrolling much".
- "i love the H but make it more better"
- "H3 but make it more UI UX good with more info"
- "okay lets do it" (approving H4)

**Mockup (binding for layout and behaviour):** board `H4 · H3 with more information`, file `Split4.dc.html`, on the claude.ai canvas "Worklist Redesign" (artifact `WsCCYGzni68cjY9Fc1tfsA`). A copy is in the SDD workspace at `design/Split4.dc.html`.

**What the code has, from a 2026-10-23 survey:**
- **`worklist()`** lives in `src/server/modules/home/queries.ts:38` and builds `WorkGroup`s of `WorkRow`s for the 8 sections (`src/lib/worklist.ts`). Caps are small 10 and large 50.
- **The page** is `src/app/(app)/inventory/work/page.tsx`, rendering `components/home/worklist.tsx` and `work-summary.tsx`. Home uses `worklist()` with `limit:6` for its "Needs you" card, but does not render the component.
- **In-place controls:**
  - triage (`TriageDialog` → `triageAsset`, outcomes SPARE / DEFECTIVE / DISPOSE / DONATED; Dispose and Donate need a reason of 2+ characters);
  - it-check (`verifyAssetDetails`);
  - loan-due (`setLoanDue`).
- **Link actions:** the other sections act through links. "Hide until tomorrow" is `dismissShiftRow` / `undismissShiftRow`.
- **No location or shelf field on assets, and no assignment-history model.** The last holder and the hand-back note come from the latest `lifecycle_return` `Approval` (`employeeId`, `payload.reason`).

**Calls I made (the owner said "lets do it"):**
1. **No "Where now" column or field.** Asset location isn't recorded, and adding it would need a migration, so it's dropped. It can be a later change.
2. **Columns.** Every queue has a sortable, paged table. Each queue gets the columns that fit its records:
   - **Triage:** Item (model; category · tag), Last holder (name; department or client), Returned (date), Waiting (days).
   - **Repairs:** Item, Vendor (or "Not sent"), Stage, Down (days).
   - **IT check:** Item, Registered by, From PO, Waiting.
   - **Purchase reviews:** PO, Vendor, SI number, Total, Waiting.
   - **New hires:** Person, Department or client, Started, Missing slots.
   - **Loans:** Item, Borrower (department or client), Due, Status ("8 days late", "due Fri", "no due date"). Late rows are red.
   - **Missing & records:** Item, Problem, Last holder, Since.
   - **Approvals & leavers:** What, Who, Waiting, SLA. Breached rows are red.
3. **Details panel, per queue.** It shows:
   - the identity block;
   - the hand-back or request note, when there is one;
   - a fact list made of real fields only (serial, holder and department, dates, cost via `fmtMoney`, warranty with "until …" or "ended …"; repair vendor, RMA and quote; loan due date; PO vendor, SI and total; and so on);
   - a short history of the last 3 lifecycle events, from the existing audit and approval reads;
   - the queue's actions;
   - "Open the full record →";
   - "Hide until tomorrow", keeping today's dismissal.
4. **Actions.** Existing server actions are reused.
   - **Triage** shows four buttons: **Keep as spare** (primary), **Send to repair**, **Dispose**, **Donate**. Dispose and Donate open a small inline reason field with Confirm (the existing rule is 2 or more characters). There is no separate dialog.
   - **IT check** has an in-panel **Mark checked**, calling `verifyAssetDetails`.
   - **Loans** has **Set due date** in the panel, using the existing loan-due control.
   - **All other queues** keep their link actions as the panel's primary button: Chase, Review, Fill loadout, Investigate, Open, or the leaver's next step.
5. **Decide → next.** After a decision that clears the row (triage, IT check), the next row is selected. A toast confirms the decision.
6. **Undo.** "Keep as spare" and "Send to repair" can be undone from the toast or within 15 minutes. Undo is limited to the same person, and only while the asset hasn't changed since. This follows the Finance undo pattern.
   - It runs through a new `undoTriage(auditId)`. That restores `status`, `returnedAt` and `defectiveSince` as they were, and writes the audit entry `lifecycle.triage.undone`.
   - Approvals stay append-only. A repair decision's EXECUTED approval stays; the undo audit references it.
   - Dispose and Donate have no undo. Their inline reason and Confirm step is the guard.
7. **Bulk.** Ticking rows shows a bar in place of the filter row:
   - **Triage:** Keep as spares, Send to repair.
   - **IT check:** Mark checked.
   - Other queues show no checkboxes.
   - Bulk runs one server call per asset, inside `triageMany` / `verifyMany`, each item in its own transaction. It reports "8 done, 1 couldn't (changed by someone else)", and the toast's Undo covers the ones that succeeded.
8. **"Cleared today"** in the header counts this person's worklist decisions today (Asia/Manila), from the audit log: triage, it-check, loan-due and undo-adjusted.
9. **Layout.**
   - **≥1100 px:** the mockup layout, table plus a 384 px panel, filling the viewport height below the app header. The table shows 10 rows per page; the page body doesn't scroll.
   - **Below 1100 px:** the panel becomes a Drawer (`ui/drawer.tsx`) opened by selecting a row.
   - **Below 640 px:** the table becomes a stacked list, tabs scroll horizontally inside their own row, and the page may scroll. Phones can't fit one screen.
10. **URL state.** `?q=<section>&page=<n>&sel=<key>` sets the tab, page and selected row, so Back and refresh keep your place. Filters and sort are client state.
11. **Counts and caps.** Tab counts are the section totals, with "50+" when capped. Paging works over the rows read. A capped section's last page says "Showing the first 50 — clear some to see more".
12. **Viewer.** The viewer is read-only: no checkboxes and no action buttons, but the panel still shows facts and links.
13. **Summary.** The Triage summary shows four stats: Items, Oldest, Over 90 days, Value at cost. Other queues show their own two to four stats:
    - Repairs: Items, Longest down, With a vendor.
    - Loans: Items, Overdue, Due this week.
    - Approvals: Items, Past SLA.
    - Others: Items, Oldest.
14. **Home is unchanged.** `needsFromWork` keeps working off the same `worklist()` groups.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6, Tailwind v4, vitest (node, `renderToStaticMarkup`), Playwright plus axe.

## Global Constraints
- **Copy, verbatim:**
  - Header: "Worklist", "{n} waiting on IT", "{n} overdue", "Cleared today {n}"
  - Triage buttons: "Keep as spare", "Send to repair", "Dispose", "Donate", "Confirm"
  - Toasts: "{model} · kept as a spare", "{model} · sent to repair", "{n} items · kept as spares", "{n} items · sent to repair", "Undo"
  - Undo errors: "Changed by someone else since — open the record", "Undo is only for your own decision within 15 minutes"
  - Empty states: "All clear" / "Nothing left in {queue}." and "Nothing matches these filters." + "Clear filters"
  - "Over 90 days", "Search tag, model, person"
  - Panel: "Open the full record →", "Hide until tomorrow"
  - Bulk report: "{done} done, {failed} couldn't (changed by someone else)"
- **Look:** the app's existing tokens and components, not the mockup's hex values.
  - Red (`fault` tone) only for overdue loans and breached SLAs.
  - Over 90 days is shown in bold, never in red.
  - One primary button per panel.
- **Accessibility (WCAG 2.1 AA):**
  - tabs are links with `aria-current`;
  - the table uses `Th` sort with `aria-sort`;
  - row selection uses `aria-selected`, with keyboard ↑/↓ moving it inside the table and Enter opening it;
  - checkboxes are labelled "Select {tag}";
  - the toast is `role=status`;
  - targets are 44 px or larger, except checkboxes, which have 32 px or larger hit areas.
- **No schema change and no migration**, except the audit action code `lifecycle.triage.undone`, which must be registered in `AUDIT_ACTIONS`, `ACTION_LABELS` and `auditSentence`.
- **House rules:**
  - never read `.env`;
  - no destructive git;
  - CRLF files stay CRLF;
  - browser tests run only in the last task: dev server on port 3100, `--workers=1`, foreground, at most 4 files per chunk, `--global-timeout=540000`;
  - before seeding, check that no other worktree's server is running.

## Review Focus
1. **A row decided elsewhere meanwhile.** If another IT user triaged the same asset, the action fails cleanly ("Changed by someone else since"). The row leaves the list on refresh and the selection moves on.
2. **Undo after a later change.** For example, the asset was assigned after "Keep as spare". Undo is refused with the exact copy and changes nothing.
3. **Bulk with mixed results.** It reports done and failed counts. Undo covers only the successful ones. No partial row is left half-written.
4. **A capped section (50+).** Paging and counts tell the truth: the tab shows "50+", and the last page shows the cap note.
5. **A viewer, or a narrow window.** The viewer has no controls. Below 1100 px the panel becomes a drawer, and nothing overlaps or clips.

---

### Task 1: Worklist items carry their columns and details (data layer)
**Files:**
- `src/lib/worklist.ts`: add `WorkItem extends WorkRow` with `columns` (a per-section typed record) and `detail` (facts[], note?, history[]). Add pure builders per section, plus the summary stats per section (`sectionStats(group)`).
- `src/server/modules/home/queries.ts`: select the extra fields:
  - asset: serial, cost, purchasedAt, warrantyUntil, category name, vendor, rmaRef, repairQuote, defectiveSince, loanDueAt, assignee and department;
  - the latest `lifecycle_return` approval per triage asset: one batched query giving last holder, department and `payload.reason`;
  - the last 3 lifecycle audit sentences per asset, batched only for the rows read (at most 50 per section; one query with a window, or a grouped `findMany`; no N+1);
  - for PO rows: vendor, SI, total;
  - for hires: department and missing slots;
  - for approvals: requester and SLA.
- Keep `WorkRow`'s existing fields so Home is untouched.
- **Tests:**
  - a builder test for each section (columns and facts from fixtures);
  - stats per section;
  - the triage last holder comes from the latest return approval;
  - the hand-back note is omitted when blank;
  - warranty reads "until …" or "ended …";
  - a query test that the history read is one batched call.
- **Commit:** `feat(worklist): every worklist row carries its table columns and a details panel's facts`

### Task 2: Undo, bulk and "cleared today" (server)
**Files:**
- `src/server/modules/lifecycle/actions.ts` (or a new `triage-undo.ts`):
  - `undoTriage({auditId})`: same actor, within 15 minutes, asset unchanged since (compare `updatedAt` / version under a row lock), restore the prior state, write the `lifecycle.triage.undone` audit entry.
  - `triageMany({assetIds, outcome: SPARE | DEFECTIVE})` returns `{done: string[], failed: {id, reason}[], auditIds}`.
  - `verifyMany({assetIds})`.
- `triageAsset` and `verifyAssetDetails` return the audit id the toast needs. Keep their current return shapes compatible.
- `src/server/modules/home/queries.ts`: `clearedToday(userId)` reads the Asia/Manila day from the audit log.
- Register `lifecycle.triage.undone`.
- **Tests:**
  - undo: happy path; another person; older than 15 minutes; changed since; undo applied twice.
  - bulk: mixed results, each item in its own transaction.
  - cleared today: day boundary in Asia/Manila, and undo subtracts.
- **Commit:** `feat(worklist): undo a triage decision, decide several at once, and count today's cleared work`

### Task 3: The H4 page (UI)
**Files:**
- `src/app/(app)/inventory/work/page.tsx`: read `?q`, `page` and `sel`; pass the groups, stats and the cleared count.
- New `src/components/worklist/`:
  - `worklist-view.tsx` (client shell);
  - `queue-tabs.tsx`;
  - `queue-summary.tsx`;
  - `queue-filters.tsx` (category chips, over 90, search; replaced by the bulk bar when rows are ticked);
  - `queue-table.tsx` (uses `ui/table` `Th` sort and `Tr` selected; keyboard ↑/↓/Enter; paging via `ui/pagination` or a local pager);
  - `details-panel.tsx` (per-section facts, note, history, actions);
  - `triage-actions.tsx` (four buttons plus the inline reason);
  - `use-worklist-undo.ts` (toast with Undo).
- **Retire** `components/home/worklist.tsx` and `work-summary.tsx` if nothing else uses them, and move or keep `WorkRowMenu`'s Hide into the panel.
- **Below 1100 px:** a Drawer. **Below 640 px:** a stacked list.
- **Tests (`renderToStaticMarkup`):**
  - tabs and counts (including 50+);
  - summary per section;
  - filters narrow the rows;
  - sort order;
  - pager labels;
  - the panel per section shows the right facts and actions;
  - the viewer gets no controls;
  - triage inline reason gating;
  - empty states;
  - toast copy.
- **Commit:** `feat(worklist): the Worklist is one screen — queue tabs, a sortable paged table and a details panel`

### Task 4: Browser tests, docs (deploy after the owner's word)
- **Repair the e2e that pin the old page:**
  - `it-work-ux`, `direct-lifecycle:320-346`, `paging:451-535`;
  - `phase-40-work`, `custody:272`, `oversight:270`, `home-finance:342`, `offboarding:88`, `deadlines:217/236`, `department-owned:483`;
  - `axe-sweep:131`, `phase-46-home:484`.
- **New `e2e/worklist.spec.ts`:**
  - **Fits the screen:** at 1440×900 the document doesn't scroll.
  - **Triage flow:**
    - Keep as spare selects the next row, the toast's Undo restores it, and "Cleared today" counts up and back down.
    - Dispose needs a reason.
  - **Bulk:** two rows sent to repair.
  - **Navigation:** filters, sort, paging, and the URL `sel` survives a reload.
  - **Narrow and viewer:**
    - at 1024 px, the drawer;
    - at 375 px, the stacked list;
    - a viewer is read-only.
  - **Concurrent change:** after a triage elsewhere, the action is refused.
  - **axe:** light, dark and 375 px.
- **Docs:** HANDOVER (az) and PICKUP.
