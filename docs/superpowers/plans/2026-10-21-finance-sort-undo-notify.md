# Finance Sorting, Undo and Notifications: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** add more sort options and date lines on Finance → Assets; add Undo (in the toast and for 15 minutes on the asset page, same person, nothing changed since) for approve, send back and depreciation settings; add an admin "Reopen review"; and give Finance clearer toasts.

**Architecture:** pure rules in `src/lib` (sort comparators, undo eligibility, toast model) with tests; server actions in `src/server/modules/finance/undo-actions.ts`; UI changes in the existing review box, send-back dialog, settings dialog, toast system and asset page.

**Tech Stack:** Next.js 15, React 19, Prisma, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-finance-sort-undo-notify-design.md` (binding).

## Global Constraints
- **Depreciation:** no maths changes. Figures still come from `src/lib/depreciation.ts`.
- **Audit:**
  - Append-only; undo never edits or deletes an audit entry.
  - New codes: `finance.confirm.undone`, `asset.return.undone`, `depreciation.override.undone`, `finance.confirm.reopened`. Add them to `AUDIT_ACTIONS` and `ACTION_LABELS`, the history verb table (`src/lib/finance-history.ts`), and `auditSentence` (`src/lib/activity.ts`).
  - `source: "web"` on every new write.
- **Undo rules are enforced on the server:** same actor, `UNDO_WINDOW_MS = 15 * 60 * 1000`, and the action must still be the latest finance-relevant change on the asset.
- **Admin reopen:** admin only, reason 5–300 chars, approved assets only.
- **Toasts:**
  - an action toast lives `ACTION_TOAST_MS = 10000`;
  - errors stay until dismissed;
  - at most 2 actions per toast plus an optional `detail` line;
  - existing toast callers are unchanged.
- **Git:**
  - Never run `git stash`, `checkout`, `restore`, `reset`, `switch`, `--amend`, `rebase`, `merge`, `pull` or `push`.
  - Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - CRLF files keep CRLF.
- **Other:**
  - Never read `.env`. Never `prisma migrate dev/reset/format` or `db push` (no migration is needed).
  - No `next build` locally.
  - Browser tests only in Task 4: port 3100, `--workers=1`, foreground, reseed first and last.

## Review Focus
1. **Undo after something changed:** an undo after IT resubmitted, or after another person changed the asset, is refused with a reason, never applied. Covered by a Task 2 test.
2. **Undo by a different user, or after 15 minutes:** refused on the server. Covered by a Task 2 test.
3. **Approve → navigate to the next asset → Undo from the toast:** the original asset goes back to To review, and the user lands on it. Covered by a Task 3 test and the Task 4 e2e.
4. **Sorting with missing values:** rows with no approval date, no cost or no purchase date sit at the end in tag order, in both directions. Covered by a Task 1 test.
5. **Settings undo with no previous override:** restores "category policy", not zeros. Covered by a Task 2 test.

---

### Task 1: Sorting and date lines
**Files:** `src/lib/finance-list.ts` (+ test), `src/server/modules/finance/queries.ts` (+ test), `src/components/finance/finance-toolbar.tsx`, `finance-table.tsx` (+ tests); export already shares the list query.

**Interfaces:**
- `FinanceSort = "book" | "book-asc" | "cost" | "cost-asc" | "approved" | "approved-asc" | "added" | "added-asc" | "purchased" | "purchased-asc" | "life" | "tag"`. `parseSort` falls back to `"book"`.
- `SORT_OPTIONS` holds the labels in the spec's order.
- `sortRows(rows, sort)` puts nulls last in both directions and breaks ties by tag.
- Rows gain `approvedAt`, `addedAt` and `purchasedAt` (Date | null).
- `financeDateLine(row, sort): { label: "Approved" | "Added" | "Bought"; date: string } | null`, using Manila dates.

**Tests:**
- Each sort in both directions, nulls last.
- An unknown sort falls back to book.
- The date line follows the sort.
- The export order equals the list order for a date sort.

**Commit:** `feat(finance): sort by date approved, added, purchase date and cost; date line under the finance state`.

### Task 2: Undo and admin reopen (server)
**Files:** `src/lib/finance-undo.ts` (+ test), `src/server/modules/finance/undo-actions.ts` (+ test), plus the audit registries, `finance-history.ts` and `activity.ts`.

**Interfaces:**
- `type UndoKind = "approve" | "send-back" | "settings"`.
- `undoState(asset, latestEntries, userId, now): { kind: UndoKind; at: Date; minutesLeft: number; label: string } | null`. Null when the user can't undo, and the result carries the reason. This is pure, and the asset page and the server both use it.
- Server actions:
  - `undoFinanceAction({ assetId, kind }): ActionResult<{ tag: string; id: string }>`. It re-reads inside a transaction and re-checks `undoState`. It applies the reversal per spec §3:
    - **approve:** clear `financeConfirmedAt` and the approver; restore `financeNotCapitalised` to its earlier value from the original entry's diff.
    - **send-back:** clear the return fields.
    - **settings:** restore the previous override from the original entry's diff, or clear it when there was none.

    Then it writes the undone audit entry and revalidates the Finance list and the asset page.
  - `reopenFinanceReview({ assetId, reason })` (admin): checks the reason length and that the asset is approved, then writes `finance.confirm.reopened` with the reason.
- **Store the earlier values in the original actions' audit diffs where they aren't stored today,** so undo can restore exactly:
  - `confirmAssetDetails` records the `financeNotCapitalised` before and after;
  - the override actions record the before and after values.

  Update those writers. Their history chips must still read well; keep any new keys hidden if needed.

**Tests:**
- **Refusals:** a different user; past 15 minutes; IT resubmitted since; another finance change since.
- **Each reversal:** the exact field restore.
- **Settings with no prior override:** goes back to the category policy.
- **Admin reopen:** admin only, the reason rules, approved assets only.
- **Audit:** written; the original entry untouched.
- **History:** the verbs read "undid the approval" and similar.

**Commit:** `feat(finance): undo review actions for 15 minutes and admin reopen`.

### Task 3: Toasts, the Undo banner and the Reopen dialog (UI)
**Files:** `src/components/ui/toast.tsx` (+ test), `src/lib/toast-timing.ts`, `src/components/finance/review-box.tsx`, `send-back-dialog.tsx`, the settings dialog, `use-finance-runner.ts`, a new `src/components/finance/undo-banner.tsx` and `reopen-review.tsx`, and `src/app/(app)/finance/assets/[id]/page.tsx`.

**Behaviour:**
- **Toast:**
  - `detail?: string` and `actions?: ToastAction[]` (at most 2); the old single `action` still works.
  - `ACTION_TOAST_MS = 10000`.
  - Copy per spec §4.
  - Undo calls `undoFinanceAction`. On success it shows a toast and goes to the asset; on refusal it shows a fault toast with the reason.
  - "Open <tag>" goes back to the asset.
  - Approve's detail adds the next asset and the count left (the action already returns `next`; add `remaining` if needed).
- **Undo banner:** on the asset page, from `undoState` (server-computed), it shows "You <did X> at HH:MM · Undo (N min left)". The minutes are computed on render and refreshed every 30 s client-side; no live announcement.
- **Reopen review:** for admin on approved assets, a button opens a dialog with a reason textarea (5–300 characters) and confirms.

**Tests:**
- The toast renders the detail line and two buttons; the old single `action` is unchanged; the 10 s timing.
- The banner shows only for the actor within the window.
- Reopen is hidden for non-admins.
- The review box's toast content per action.

**Commit:** `feat(finance): clearer review toasts with Undo, an Undo banner for 15 minutes, admin Reopen review`.

### Task 4: Browser tests and docs
**Files:** `e2e/finance-undo.spec.ts`, plus any existing spec whose old toast copy or sort select it breaks, and `docs/HANDOVER.md` / `docs/PICKUP.md`.

**e2e cases:**
- Sort by date approved and see the date lines.
- Approve, then Undo from the toast, then back on the asset in To review.
- Approve, navigate away, return, then Undo from the banner.
- A refused undo after IT resubmits.
- Send back, then Undo.
- Settings change, then Undo.
- Admin Reopen with a reason.
- axe on the asset page with the banner, in light and dark.

**Runs:** first the new spec and any touched specs; then the Finance-related specs (`finance-*`, `home-finance`, `phase-47-finance`, `department-owned`, `asset-classes`).

**Docs:** a HANDOVER entry (at) and PICKUP: no migration, the rulings, follow-ups.

**Commits:** `test(e2e): finance sort and undo` and `docs(handover): Finance sorting, undo and notifications`.
