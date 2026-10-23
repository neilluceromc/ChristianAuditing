# Sent-back chip and the missing notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the red "need correction" banner from Inventory and put a quiet chip in its place. Let an Admin's bell show every team's notifications. Notify the people affected by the steps that are silent today.

**Owner's request (2026-10-23):**
- On the banner: "fix these, why this is here? looks awful, also this is not showing in my notifications or whenever we sent or return back or sucessfully changes correction".
- Chosen fix: "A 'Sent back' chip (Recommended)".
- They later confirmed that Finance does see the corrected-asset notification.

**What we found (Supabase, 2026-10-23):**
- The one sent-back asset, BR-LT-1175, was returned on 21 Oct, before the bell shipped on 22 Oct, so no SENT_BACK notification was ever written for it.
- An Admin's bell shows no count and no items, by design.
- These steps write no notification:
  - Finance approving an asset after it was corrected (`confirmAssetDetails`, `inventory/actions.ts:722`; the approve part of `approveGroup`, `finance/group-actions.ts`);
  - a PO whose assets are all approved by Finance (`emitIfPoFullyApproved`);
  - `undoFinanceAction` / `reopenFinanceReview` (`finance/undo-actions.ts`);
  - `undoPoSendBack` (`purchases/po-actions.ts:972`).

**Calls I made:**
1. **Inventory:**
   - Delete the hand-rolled red banner (`src/app/(app)/inventory/page.tsx:219-238`) and its count query (`:120`).
   - In its place, a **"Sent back · N" chip** sits in the same chip row as IT / Purchasing / Repairs. It shows only when N > 0 for the viewer's own team.
   - N counts assets in `needs-correction` whose `financeReturnedTo` is the viewer's team. Admin sees all teams. Finance and the viewer never see the chip.
   - The chip links to the existing team-scoped view `/inventory?reg=needs-correction&to=<TEAM>`, the same target as the sidebar's "Sent back" link. When that view is active, the chip shows as selected, and clicking it again clears the view.
   - Its look is the chip row's neutral style, plus the app's small attention dot. Nothing in it is red.
2. **The Admin bell** behaves like a team member's bell, but across all teams:
   - the unread count sums every team;
   - the tabs are the same (Sent back · To check · Changed · All);
   - each item carries a small team label (IT / Purchasing / Finance);
   - "Mark all read" marks all teams read for that admin;
   - `/notifications` lets the admin read all teams, or filter to one.
   - Per-person read state already exists (`NotificationRead`), so there is no schema change.
3. **New notifications.** All are kind `CHANGED`, written through `notify(tx, …)` inside the same transaction:
   - **Finance accepts a correction.** When Finance approves an asset that was corrected (the asset carries a resubmit), notify the team that corrected it. That team is the actor's team on the latest `finance.resubmit` audit entry, falling back to the team the asset was last returned to. Title: `{tag}: Finance accepted the correction`. href: the asset.
     - Group approve does the same for each corrected asset in the group. When more than 3 corrected assets go to the same team, collapse them into one notification: `{n} corrections accepted by Finance` → `/inventory`.
   - **Finance approves a whole PO.** When every asset of a PO is approved (`emitIfPoFullyApproved`), notify PURCHASING: `{ref}: Finance approved all its assets` → the PO.
   - **Finance undoes a send-back, or reopens an approved review.** Notify the team affected: `{tag}: Finance took back the send-back` or `{tag}: Finance reopened its review`.
   - **`undoPoSendBack`.** Notify PURCHASING: `{ref}: the send-back was taken back` → the PO.
   - The `notify()` rule that skips a CHANGED notification for the actor's own team stays as it is.
4. **No new `NotificationKind`.** `CHANGED` covers all of these, so there is no migration.

**Tech Stack:** Next.js 15, Prisma 6, vitest (node, `renderToStaticMarkup`), Playwright.

## Global Constraints
- Copy, verbatim:
  - "Sent back · {n}"
  - "{tag}: Finance accepted the correction"
  - "{n} corrections accepted by Finance"
  - "{ref}: Finance approved all its assets"
  - "{tag}: Finance took back the send-back"
  - "{tag}: Finance reopened its review"
  - "{ref}: the send-back was taken back"
- No schema change and no migration.
- House rules:
  - never read `.env`;
  - no destructive git;
  - CRLF files stay CRLF;
  - browser tests only in Task 2, on port 3100, `--workers=1`, in chunks of 4 or fewer.
- **A second worktree may share the local database:** `.claude/worktrees/epic-hypatia-1ff104`, belonging to the owner's other session. Before seeding or running Playwright, check that nothing is listening on :3100 and that no other `next dev` is running from that worktree. If one is, stop and report rather than seed.

## Review Focus
1. **An Admin reading notifications across teams.** "Mark all read" must not mark anything read for other people. Read state stays per person.
2. **The chip and the team behind it.** Purchasing must never count IT's sent-backs. Before, the banner counted by class, not by team; check that this is fixed.
3. **Group approve with many corrected assets.** No more than one notification per team once over 3; never one per asset.
4. **Notifications inside the transaction.** A notification must never be written when the approval itself fails (rollback).
5. **The approval undo window (15 minutes).** An undo of an approval that sent a "Finance accepted" notification. Decide whether to leave the earlier one or add a "reopened" notification. Call: add "reopened", and never delete a notification.

---

### Task 1: Chip, admin bell and notifications (server + UI, unit-tested)

**Files:**
- **Inventory:** `src/app/(app)/inventory/page.tsx` (remove the banner, add the chip), plus the chip row component it uses (find it).
- **Bell:**
  - server: `src/server/notifications/queries.ts`, `actions.ts`;
  - UI: `src/components/shell/notification-bell.tsx`;
  - page: `src/app/(app)/notifications/page.tsx`;
  - start count: `src/app/(app)/layout.tsx` (`bellStart`).
- **Notifications:**
  - `src/server/modules/inventory/actions.ts` (`confirmAssetDetails`);
  - `src/server/modules/finance/review-writes.ts` and `group-actions.ts`;
  - `finance/undo-actions.ts`;
  - `purchases/po-actions.ts` (`undoPoSendBack`);
  - the PO-fully-approved emitter.
- **Tests:**
  - chip count by team for IT, Purchasing, Admin, Finance and viewer;
  - chip hidden at 0;
  - admin `unreadCount` sums all teams;
  - admin `listNotifications` returns items with their team;
  - admin mark-all touches only that admin's reads;
  - each new notification: its title, team and href;
  - none written when its action fails;
  - group collapse above 3;
  - actor's-own-team skip still holds.
- **Commit:** `feat(notify): a quiet Sent back chip replaces the Inventory banner; Admin's bell reads every team; Finance's approvals and undos notify the team affected`

### Task 2: Browser tests, docs, deploy (deploy after the owner's word)
- **Repair** e2e that asserted the old banner (grep for "need correction" and "sent them back").
- **Add `e2e/sent-back-notify.spec.ts`:**
  - Finance sends back an IT asset. IT's bell shows it, and the Inventory chip "Sent back · 1" opens the team view.
  - IT marks it corrected, and Finance's bell shows "to check again".
  - Finance approves, and IT's bell shows "{tag}: Finance accepted the correction".
  - Admin's bell shows all three, each with its team label.
  - The admin marks all read, and IT's unread count does not change.
  - Finance approving a PO's last asset notifies Purchasing.
- **Run** the affected specs (bell, notifications, inventory, finance review, po-intake) and axe-sweep, in chunks.
- **Docs:** add HANDOVER (ay) and update the PICKUP status lines.
