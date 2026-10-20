# Phase 47 follow-up: Finance sorting, Undo and clearer notifications (design)

**Date:** 2026-10-21

**Status:** owner's answers in chat

**Numbering:** a follow-up to Phase 47 with no new number, so client staff stays **Phase 48**.

## 1. Intent
Finance asked for three things:
- to sort the asset list by the dates they work by;
- to take back a review action they did by mistake;
- to see clearly what just happened after each action.

**Today's behaviour:**
- **Sorting:** the list sorts only by book value, life used and tag.
- **Approving:** jumps straight to the next asset to review, with a 4-second "BR-LT-0201 approved" toast and no way back.
- **Send back and depreciation settings:** the same, with no way back.

**Owner's answers (2026-10-21):**
- **Undo window:** an Undo button in the toast, plus **15 minutes** on the asset page, for **the person who did the action only**. After that the action is final; an **admin can still reopen** an approved review at any time.
- **Which actions:** **all review actions**: Approve, Approve as not capitalised, Send back, and depreciation settings changes (override set or cleared).
- **Sorts:** date approved, date added, purchase date and cost, alongside today's book value, life used and tag.

## 2. Sorting (Finance → Assets)
- **The Sort select's options, in order:**
  - Book value, high first (default)
  - Book value, low first
  - Cost, high first
  - Cost, low first
  - Date approved, newest first
  - Date approved, oldest first
  - Date added, newest first
  - Date added, oldest first
  - Purchase date, newest first
  - Purchase date, oldest first
  - Life used, most first
  - Tag
- **URL `sort` values:** `book`, `book-asc`, `cost`, `cost-asc`, `approved`, `approved-asc`, `added`, `added-asc`, `purchased`, `purchased-asc`, `life`, `tag`. Unknown values fall back to `book`.
- **Rows with no value** for the sort key (not approved, no cost, no purchase date) **always go last**, in tag order.
- **Field definitions:**
  - **Date approved** = `financeConfirmedAt`.
  - **Date added** = the asset's creation time (`createdAt`).
  - **Purchase date** = the date shown in the asset's Purchase card today.
- **Date line in the Finance cell:** under the Finance pill, a small date shows the date that matters for the current sort.
  - Sorting by date added or purchase date: "Added 16 Oct 2026" or "Bought 16 Oct 2026".
  - Otherwise, and when approved: "Approved 17 Oct 2026".
  - Dates use the Manila zone.
- **Export:** follows the same sort, as today.

## 3. Undo
- **Undoable actions:**
  - **Approve** and **Approve as not capitalised** (`finance.confirm`): undo returns the asset to *To review* exactly as before. That means `financeConfirmedAt` and its approver cleared, and the not-capitalised flag back to its earlier value. The derived depreciation lines disappear because they come from the approval.
  - **Send back to IT/Purchasing:** undo returns the asset to *To review*, with the send-back and its checklist and note cleared.
  - **Depreciation settings change**, override set or override cleared: undo restores the earlier override values (useful life, salvage, note), or the category policy if there was no override.
- **Who and when:**
  - Only the **same person** who did the action.
  - Only within **15 minutes**, by server time.
  - Only if **nothing has changed on the asset since**. The action must still be the latest finance-relevant change on that asset. For example, IT has not resubmitted, and no other cost, review or settings change has happened.
  - Otherwise the Undo refuses with a clear reason, for example "Can't undo: IT resubmitted it at 10:41".
- **Server checks:** every check runs on the server. The client's timer is only a hint.
- **Audit:**
  - Undo writes an entry, `finance.confirm.undone`, `asset.return.undone` or `depreciation.override.undone`, with `source: "web"` and a change chip showing the reversal.
  - The original entry stays. Audit is append-only.
  - The Financial history shows both lines; the undo line reads "<name> (Finance) undid the approval".
- **Admin reopen:**
  - On an **approved** asset, an admin gets **"Reopen review"** on the asset page at any time.
  - It needs a reason of 5–300 characters and returns the asset to *To review*, clearing the approval.
  - Audit: `finance.confirm.reopened`, with the reason.
  - It is not an undo, so it is not time-limited, and it is admin only.

## 4. Clearer notifications
- **Every review action shows a toast** that names the action and the asset, and adds the useful detail:
  - **Approve:** "Approved BR-LT-0201", detail "Depreciation starts Oct 2026 · ₱2,131.11 a month".
  - **Approve as not capitalised:** "Approved BR-LT-0201 as not capitalised".
  - **Send back:** "Sent BR-LT-0201 back to IT", detail "Flagged: Official receipt".
  - **Settings:** "Saved BR-LT-0201's depreciation settings", detail "48 months, ₱0.00 salvage".
- **Toast buttons:**
  - **Undo** on every review action.
  - When approving moved you to the next asset: **"Open BR-LT-0201"**, to go back, and a detail line "Next: BR-LT-0204 · 3 left to review". When none are left: "Nothing left to review".
- **Undo outcomes:**
  - A successful Undo shows "Undid the approval of BR-LT-0201" and takes you back to that asset.
  - A refused Undo shows an error toast with the reason; it stays until dismissed.
- **Timing:** toasts with a button stay **10 s** (today it's 8 s for action toasts), and they pause while hovered or focused, as today.
- **The toast system needs one change:** support a detail line and a second button (Open), extending `ToastAction` to a list of up to 2 actions plus `detail`. Other callers stay unchanged.
- **Undo banner on the asset page:**
  - For 15 minutes after the action, the person who did it sees, at the top of that asset's page: "You approved this at 10:42 · Undo (12 min left)", with the minutes counting down.
  - The same banner appears for send-back and settings changes.
  - It disappears when the window ends or someone else changes the asset.
- **Accessibility:** toasts are announced, as today. The banner's button is a real button. The countdown text is not live-announced every minute.

## 5. Left to the builder
- How the undo state is found: from the latest audit entry for the action, or a small read.
- Whether the toast extension also helps the list's row menu.
- Test shapes:
  - unit tests for the sort comparators (nulls last), the undo rules (same person, window, nothing changed since, each action's reversal), admin reopen (reason, admin only), and the toast model;
  - e2e for sorting by date approved, approve then undo from the toast, undo from the banner after a navigation, a refused undo after IT resubmits, and admin reopen.

## 6. Data
- **No schema change.** Undo reads the latest audit entries and the asset's current fields.
- **New audit action codes** go into `AUDIT_ACTIONS` and `ACTION_LABELS`, and the history's verb table.

## 7. Added 2026-10-21 (owner, same follow-up)

### 7.1 Sign-in lands on Home
After any sign-in, the app goes to **Home** (`/`), not the role's old landing page. This covers credentials, quick login, sign-up, bootstrap and Microsoft.

**Exception (my call):** a `next` link the person was sent from still wins. Scanning a label QR while signed out then still opens that asset after sign-in.

A signed-in person who visits `/login` also goes to Home. `ROLE_LANDING` stays only where a page guard bounces someone from a page they can't see.

### 7.2 Search as you type
Every list search box filters **as you type**. This covers Inventory, Finance → Assets, Employees, and every other list that uses the house search box.

**How it behaves:**
- **When it fires:** about **300 ms after the last keystroke or a paste**. Enter still fires at once.
- **History:** the URL updates with `router.replace`, so typing never floods the browser history.
- **Focus:** focus and the caret stay in the box while results update.
- **Clearing:** an empty box clears the search.
- **Length:** a single letter is enough.

**Starts-with first:** while searching, matches that **start with** the text come first, then matches that only contain it. Each group keeps the list's chosen sort.

| List | Fields checked for starts-with |
|---|---|
| Inventory | tag, model, serial, holder name |
| Finance → Assets | tag, model, serial, holder name |
| Employees | name, employee no., email |

**Exact tag no longer opens on its own (barcode-scanner exception):**
- Typing or pasting a full tag ("MAC-51") **only filters the list**. It never opens the record.
- The Inventory exact-tag redirect, which exists for USB barcode scanners that type the tag and then press **Enter**, now happens **only when Enter is pressed**. The search box sends `go=1` on Enter, and the page drops it after use.
- So a scanner still opens the record, and pasting or typing never does.

### 7.3 Employees: sort by joined
The Employees toolbar gets a **Sort** select:
- Name A–Z (default)
- Name Z–A
- Recently joined
- Earliest joined
- Employee no.

It uses the list's existing sort keys (`name`, `employeeNo`, `joinedAt`) and URL `sort` values. The "joined" sorts show the join date under the name ("Joined 3 Mar 2025", in Manila time).
