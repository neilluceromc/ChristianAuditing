# Phase 40 — Fix what's broken, and make the IT basics trustworthy

**Status:** DESIGNED 2026-10-17.
- **Origin:** a read-only UX audit of the IT side (three auditors: assets; people lifecycle; shell, Home and approvals) produced about 70 findings. The user chose "All three, in order": Phase 40 (this), then 41 (client staff and people flows), then 42 (deeper asset management), with mockups where screens change and pausing only for merge, push and redeploy.
- **Mockup:** the "Phase 40 — phone shell" board on https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz.
- **Migration:** one (the 33rd). It adds a single enum value.

## 1. Why

Each item below is a defect or a broken basic that IT staff hit today. They are grouped by where they live. Every item names the behaviour after the fix. File references are the auditors', for orientation only.

## 2. Bugs

### 2.1 The accountability form's "Issued" column (`employees/[id]/form/page.tsx:55,65`)
- **Today:** it prints the purchase date, on the paper the employee signs.
- **After:** it prints the date the item was **assigned to this person**. That is the newest assignment audit, found with the batched `heldSinceByAsset` helper (Phase 38). When no assignment is recorded, it prints "—".

### 2.2 The Edit form can mark someone as left without collecting anything (`employee-form.tsx:154`, `actions.ts:276-300`)
- **Edit page, ACTIVE person:** Employment shows as read-only text ("Active"). Below it sits a link "Start offboarding…", which opens the existing Start offboarding dialog.
- **Edit page, OFFBOARDING person:** the field offers only **Offboarding** (current) and **Active (cancel offboarding)**. "Complete by" stays editable.
- **Edit page, OFFBOARDED person:** read-only.
- **Server (`updateEmployee`):** it refuses any employment change other than OFFBOARDING → ACTIVE with "Use Start offboarding — leavers go through the offboarding wizard". Completing goes only through the wizard's existing `completeOffboarding`.
- **New employees** are always created ACTIVE. The Add employee wizard's "More" fold loses its Employment select, and the server ignores or refuses any other value. Account status (M365) stays.

### 2.3 The Help button opens a 404 (`topbar.tsx:97-103`)
- The button is replaced by a **Keyboard shortcuts** button: a keyboard icon with the label "Keyboard shortcuts". It opens a small dialog listing the real shortcuts:
  - **Search:** Ctrl K, or ⌘K on Mac, detected from the platform;
  - **/** focuses the page's search box;
  - **J / K** and **A** on Approvals;
  - **Esc** closes panels.
- **New shortcut:** "/" focuses the page's search box. It does nothing while typing in a field.

### 2.4 Asset History and Timeline show raw data (`history-entry-rows.tsx`, `lib/history.ts:22`, `timeline/page.tsx`)
- **Field names** use the shared `FIELD_LABELS` ("Category", not `categoryId`).
- **Ids become names:** category, type, vendor and holder ids are shown by name. The page resolves them in one batched query per kind. Ids that no longer exist show "(removed)".
- **Dates and times** show in Asia/Manila (`d MMM yyyy`, plus `HH:mm` for timestamps).
- **Booleans** show "Yes" / "No". Empty values show "—".
- **Objects** never print `[object Object]`. The Finance send-back value renders as its checklist labels joined by ", ", plus its note. Any other object renders as a short `key: value` list.
- **Action codes:** the action column uses the shared action labels (`ACTION_LABELS`, e.g. "Assigned", "Status changed"), and Timeline rows use `auditSentence`.
- **Approval states** use friendly labels (Pending, Claimed, Approved, Rejected, Executed, Failed).

### 2.5 The Columns chooser has an unlabelled checkbox (`column-chooser.tsx:12-14`)
Add the missing `registration: "Registration"` label. A unit test checks every hideable column has a label.

### 2.6 Labels are marked printed even when printing was cancelled (`print-labels-button.tsx:19-29`)
After the print dialog closes, a small dialog asks **"Did the labels print correctly?"** with **Yes, mark printed** and **No, keep them in the queue**. Only Yes marks them.

## 3. Phone layout (mockup board 1–2)
Below `lg` (1024 px), when the sidebar is hidden:
- **Top bar,** left to right:
  - a **menu** button (a three-line icon, label "Open menu"; it replaces the filter icon);
  - the BR mark and the page name;
  - a **Search** button (label "Search"), which opens the palette;
  - a **Scan a tag** button (label "Scan a tag"), which opens the palette with the hint "Type or scan a tag".
- **The menu drawer** gains:
  - the **workspace switch** at the top (the same switcher as the sidebar, shown as a row of options);
  - the **account block** at the bottom (initials, name, role, **Sign out**).
- The search trigger shows at every width; the `md:flex` hiding goes.
- The workspace switcher no longer shows the cookie name ("br.dept · 1 available"). It reads "{n} workspaces".

## 4. Search (palette) (mockup board 3)
- **Assets match** tag, model, **serial** and **holder name**. Each result shows the matched serial or holder as a hint ("serial 5CG7…", "held by Marites Bautista").
- **Exact tag:** when the query equals an asset's tag (case-insensitive, trimmed), that asset is the first result and Enter opens its record.
- **People match** name and employee no. A person's hint is the first held tag ("holds BR-LT-0148").
- **Rate limit:** the palette shows "Too many searches just now — try again in {n} s." instead of "No matches.".
- **Stale responses:** a response for an older query is ignored (sequence check).
- **Accessibility:** the input is `role="combobox"` with `aria-expanded`, `aria-controls` (the listbox) and `aria-activedescendant` (the highlighted option). Options are `role="option"` elements, not buttons. Hover moves the highlight. People's names render in the normal font.
- **Shortcut label:** "Ctrl K" on Windows and Linux, "⌘K" on Mac.

## 5. Page titles and toasts
- **Page titles:** every page sets a title "{Page} · Backroom IT", e.g. "Inventory · Backroom IT", "BR-LT-0148 · Backroom IT" and "Marites Bautista · Backroom IT". Use the route's `metadata` / `generateMetadata`. The root fallback stays "Backroom IT".
- **Toasts:**
  - every toast has a close button ("Dismiss");
  - success toasts auto-dismiss after 4 s and pause while hovered or focused;
  - **error toasts stay** until dismissed.

## 6. Work and approvals
- **Purchase reviews on the worklist.** Requests in state `SUBMITTED` (waiting for IT's review) appear on the worklist as a "Purchase reviews" group, newest first. The source caps them at 50, the same as the other sources. The group links to `/purchases?state=SUBMITTED`. The IT nav's "Purchase reviews" item gets a count badge, the same as the other badges.
- **Approval checks** (`approvals/[id]/page.tsx:168-174`): each check shows visible text **Passed** or **Failed** next to the dot. The dot is no longer the only signal.
- **The A key in the queue** (`queue-table.tsx:72-75`) runs the same primary action as the row menu and the detail page (`approvalHeader().primary`). On a PENDING row it approves rather than refusing with "Claim it first".
- **Status names:** asset statuses use `STATUS_LABEL` everywhere: list cells, filter options, header pills, the scan card, and every toast and dialog that names a status. So "Loan", not `TEMPORARY`. Internal codes (`lifecycle.assign` …) never appear in user-facing copy.

## 7. Offboarding removes IT access (migration 33)
- **New value:** `SetupState` gains **REMOVED** ("Removed"). Migration `20261017120000_setup_removed` runs `ALTER TYPE "SetupState" ADD VALUE 'REMOVED'`. The VPN field also accepts the value "Removed".
- **Live access:** a person's IT access counts as **live** when any of these hold:
  - Entra / Intune, Autopilot or Argus is **Done**; or
  - the VPN names a VPN, i.e. a value other than none, "None" or "Removed".

  "Not recorded", "Not yet", "Not needed" and "Removed" are not live. This rule is a pure `itAccessLive(e)` in `src/lib/it-setup.ts`.
- **The Accounts step** (`accounts-panel.tsx`): under Microsoft 365, an **IT access** section lists the four. Each row shows its current value. A live one has a **Mark removed** button, which sets REMOVED (or VPN "Removed") through `setItSetup`, extended to accept these values.
- **Readiness:** a new line "IT access · {n} still active", or "IT access · removed", is not ok while access is live. Its link points to the Accounts step. `completeOffboarding` refuses with "Remove their IT access first" while access is live. The next-action label becomes "Remove access" after M365 and before "Complete".
- **The profile's IT setup tab** shows "Removed" as a value with the grey dot.
- **Audit sentence:** the existing "{actor} set {name}'s Argus to Removed".

## 8. Asset record and triage
- **The Overview's "Procurement & warranty" card** also shows **OR no.**, **Covered by** and **Who to call for repairs** when set.
- **Triage** (`triage-control.tsx:28`):
  - it preselects nothing;
  - **Dispose** and **Donate** require a reason, using the reason chips "Beyond repair", "Obsolete", "Donated to staff/charity" and free text, with at least 2 characters.

## 9. Loading, empty and small visual fixes
- **Skeletons:**
  - add an `(app)/loading.tsx` generic shell skeleton (header bar plus card blocks);
  - give approval detail its own skeleton (header, then a two-column body);
  - the audit skeleton draws 4 columns, matching the table.
- **Empty results:** the Approvals filtered-empty state gets a **Clear filters** button, like Audit and Activity. One shared `FilteredEmpty` component, used by all three.
- **Labels badge contrast:** the badge uses `text-accent-fg` on `bg-accent`.

## 10. Testing
- **Unit:**
  - the history value formatter (ids, dates, booleans, objects including the send-back shape, unknown keys);
  - `itAccessLive`;
  - the readiness line;
  - the palette ranking (exact tag first, serial and holder matches) and stale-sequence helper;
  - the platform shortcut label;
  - the column labels completeness;
  - the toast timing rule (pure);
  - the employment-change rule (`employmentChangeAllowed(from, to)`).
- **E2E** (written per task, run in the final battery):
  - History shows names, not ids, and never "[object Object]";
  - the accountability form shows the assignment date;
  - Edit offers no Offboarded;
  - the phone shell at 375 px (menu icon, search button, drawer workspace switch and Sign out);
  - the palette finds an asset by serial and opens an exact tag on Enter;
  - a purchase review on the worklist;
  - approval checks show Passed and Failed text;
  - offboarding blocks on live IT access until Mark removed;
  - the labels print confirm;
  - triage requires a reason for Dispose;
  - error toast persistence;
  - axe on the new dialog, the phone shell and the drawer.

  Existing specs that assert old wording (raw statuses, the Help link, Employment options) are updated.

## 11. Rulings taken while writing
1. **Cancel offboarding stays in Edit** (OFFBOARDING → ACTIVE) until Phase 41 moves it into the wizard; everything else about employment changes goes through the wizard. *Cost if wrong:* a leaver can be un-offboarded from Edit.
2. **IT access blocks completion only when it is actually live** (Done, or a named VPN). "Not recorded" never blocks, so people from before Phase 37 can still be offboarded. *Cost if wrong:* access never recorded is not chased.
3. **REMOVED is a new enum value** rather than reusing "Not needed", so the record says what happened. *Cost if wrong:* one more value in the IT setup selects.
4. **Help becomes a shortcuts dialog** rather than a link to documentation that doesn't exist.
5. **Purchase reviews** count requests in `SUBMITTED` only. `IT_REVIEWED` is already Purchasing's.
