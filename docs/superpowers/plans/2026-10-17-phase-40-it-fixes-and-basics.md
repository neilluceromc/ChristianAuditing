# Phase 40 — Fix what's broken, and the IT basics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audit's broken items and basics on the IT side. These include:
- accountability form dates;
- employment changes only through offboarding;
- readable history;
- the phone shell and search;
- toasts, titles and skeletons;
- the worklist's purchase reviews;
- approval checks and the A key;
- consistent status names;
- offboarding that removes IT access;
- Overview fields, triage and the label print confirmation.

**Architecture:**
- Pure rules go in `src/lib/` with vitest: the history formatter, `itAccessLive`, `employmentChangeAllowed`, palette ranking and sequencing, the shortcut label, column labels, toast timing.
- The UI reuses the existing primitives: Dialog, Drawer, Menu, SearchBox and Pagination.
- One migration adds the `REMOVED` value to `SetupState`.

**Tech Stack:** Next.js 15, Prisma 6 / Postgres 16, zod 4, vitest. Playwright and axe run only in the final battery.

**Spec:** `docs/superpowers/specs/2026-10-17-it-fixes-and-basics-design.md` (`e3c9890`). It is the authority, and its UI copy is binding verbatim.

## Global Constraints

**Worktree and environment**
- Work in the worktree `.claude/worktrees/phase-40-it-fixes`, on branch `phase-40-it-fixes`.
- `.env` points at `inventory_dev`, with `APP_BASE_URL=http://192.168.1.193:3100`. It has no `SEED_PASSWORD` and no `QUICK_LOGIN_EMAILS`.
- Never read or print `.env`. Never touch the `inventory` database or port 3000.

**Browser tests (standing rule)**
- Implementers never run Playwright or a dev server. They write and update e2e specs, make them type-check, and list the cases they did not run.
- The controller runs the battery in foreground chunks of at most 7 files, with `axe-sweep` in a chunk of its own.

**Database**
- There is one migration: `20261017120000_setup_removed`, which adds `REMOVED` to `SetupState`.
- Apply it with `npx prisma migrate deploy` only, then run `npx prisma generate`.
- Never run `prisma migrate dev` or `prisma migrate reset`.

**Git**
- Never amend. Never run `stash`, `checkout`, `restore`, `reset` or `switch`.
- The trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files use CRLF and UTF-8 (`core.autocrlf=true`). Edit them with the Edit tool, never `sed -i`.

**House rules**
- Server actions follow `actionRole` / `actionUser` → `checkRate` → zod → a transaction plus `writeAudit`.
- Product aria-labels never contain a nearby field's label word.
- UI copy uses they/them.
- `localStorage` access is wrapped in try/catch.
- E2E specs use `getByRole` with exact names for required fields.

**Spec values (verbatim; see the spec for the rest)**
- Edit refusal: "Use Start offboarding — leavers go through the offboarding wizard"; Edit link "Start offboarding…"; OFFBOARDING options "Offboarding" and "Active (cancel offboarding)".
- Keyboard shortcuts: button label "Keyboard shortcuts"; "/" focuses search.
- Phone labels: "Open menu", "Search", "Scan a tag"; scan hint "Type or scan a tag"; switcher reads "{n} workspaces".
- Palette: rate-limit text "Too many searches just now — try again in {n} s."; hints "serial …", "held by {name}", "holds {tag}"; shortcut label "Ctrl K" / "⌘K".
- Page title format "{Page} · Backroom IT".
- Toast "Dismiss" button; errors persist; success 4 s with pause on hover or focus.
- Worklist group "Purchase reviews" (requests in `SUBMITTED`, cap 50) → `/purchases?state=SUBMITTED`; the nav item gets a badge.
- Approval checks read "Passed" / "Failed".
- IT access:
  - live = any of Entra, Autopilot or Argus is DONE, or a VPN name other than none / "None" / "Removed";
  - "Mark removed";
  - readiness "IT access · {n} still active" / "IT access · removed";
  - refusal "Remove their IT access first";
  - next action "Remove access".
- Triage: no default; Dispose and Donate need a reason; chips "Beyond repair", "Obsolete", "Donated to staff/charity".
- Print confirmation: "Did the labels print correctly?", "Yes, mark printed", "No, keep them in the queue".

## Review Focus
1. **A history value that is an id of a deleted record, or an object of an unknown shape.** It shows "(removed)" or a `key: value` list, never a crash or `[object Object]`. *(Task 3 unit.)*
2. **An old employee with no IT setup recorded.** Offboarding them still completes, because "Not recorded" never blocks. *(Task 1 unit + e2e.)*
3. **Changing employment through an old client sending OFFBOARDED to `updateEmployee`.** The server refuses it. *(Task 2 unit on the rule + action.)*
4. **Fast typing in the palette.** An older response never replaces a newer one. *(Task 5 unit on the sequencer.)*
5. **The phone drawer at 375 px.** The switcher, Sign out and nav all fit, and focus is trapped. *(Task 4 e2e + axe.)*

---

### Task 1: Offboarding removes IT access (migration 33)
**Files:**
- Schema and migration.
- `src/lib/it-setup.ts` (+test): `itAccessLive`, the REMOVED label, VPN "Removed".
- `src/lib/offboarding.ts` (+test): the readiness line and the next action.
- `src/server/modules/offboarding/*`: the `completeOffboarding` gate.
- `src/components/offboarding/accounts-panel.tsx`: the IT access section with "Mark removed".
- `setup-actions.ts`: accept REMOVED and "Removed".
- The profile `setup-tab.tsx`: show "Removed".

**Steps:**
- [ ] Write the failing tests: `itAccessLive` (every value, plus null), the readiness line, and the next-action order (collect → M365 → access → complete).
- [ ] Write the migration. Run `migrate deploy` and `generate`.
- [ ] Implement it, including the server gate.
- [ ] Update the offboarding e2e: add a case where a person with Argus DONE is blocked until Mark removed. It stays unrun.
- [ ] Run vitest, tsc and lint, then commit.

### Task 2: Employment only through offboarding; the accountability form's Issued date
**Files:**
- `src/lib/employees.ts` (or a new `employment-rules.ts`) (+test): `employmentChangeAllowed(from, to)`.
- `employee-form.tsx`: the Edit page's read-only field, the Start offboarding link, and the OFFBOARDING options.
- `actions.ts` `updateEmployee`: the server refusal.
- The new-employee wizard: drop Employment, and make the server force ACTIVE.
- `employees/[id]/form/page.tsx`: Issued uses `heldSinceByAsset`.
- Update the e2e that select Employment.

**Steps:** test-first, then implement, then commit.

### Task 3: Readable asset History and Timeline
**Files:**
- `src/lib/history.ts` (+test): a value formatter that takes resolved name maps, plus the object rules (the send-back shape and generic).
- `inventory/[id]/(record)/history/page.tsx` and `timeline/page.tsx`: batch-resolve the category, type, vendor and employee ids appearing on the page.
- `history-entry-rows.tsx`: field labels and action labels.
- Approval state labels.
- E2E: add or update a case asserting names (not ids) and no "[object Object]".

### Task 4: Phone shell, shortcuts, titles
**Files:**
- `topbar.tsx`: the menu icon, Search and Scan buttons below `lg`, and the shortcuts button instead of Help.
- `mobile-nav.tsx`: the drawer gets the workspace switch and the account block.
- `workspace-switcher.tsx`: "{n} workspaces".
- New `keyboard-shortcuts-dialog.tsx`.
- A global "/" handler that focuses the page's search box. It ignores keys while an input is focused.
- Per-route `metadata` / `generateMetadata`, with a small `pageTitle()` helper (+test).
- E2E at 375 px.

### Task 5: Palette search
**Files:**
- `src/server/palette.ts`: serial and holder matching, exact tag first, and a rate-limited flag in the result.
- `command-palette.tsx`: hints, combobox ARIA, hover highlight, stale-sequence guard, rate-limit message, and the shortcut label.
- Pure helpers in `src/lib/palette.ts` (+test).
- E2E: search by serial; Enter on an exact tag.

### Task 6: Toasts, skeletons, empty states, badge contrast
**Files:**
- `ui/toast.tsx`: Dismiss, persistent errors, pause on hover or focus, plus a pure timing rule with a test.
- `(app)/loading.tsx` and an approval detail `loading.tsx`.
- Fix the audit skeleton's column count.
- A shared `FilteredEmpty`, used by approvals, audit and activity.
- `new-equipment-tabs.tsx` uses `text-accent-fg`.
- E2E: an error toast persists until dismissed.

### Task 7: Worklist purchase reviews, approvals, status names
**Files:**
- `home/queries.ts`: a `worklist` source for `SUBMITTED` requests, plus a nav badge count. The nav badge mechanism lives in `workspaces.ts`.
- `approvals/[id]/page.tsx`: check text.
- `queue-table.tsx`: the A key uses `approvalHeader().primary`.
- `STATUS_LABEL` across the inventory list, filters, pills, the scan card, toasts and dialogs. Grep for raw status rendering and for `lifecycle.` strings in user-facing copy.
- E2E updates for the changed wording, plus a worklist case.

### Task 8: Asset record Overview, Columns label, triage, print confirmation
**Files:**
- `(record)/page.tsx`: OR no., Covered by, Who to call for repairs.
- `column-chooser.tsx`: the label, plus a completeness test.
- `triage-control.tsx`: no default, and a required reason with chips for Dispose and Donate, enforced by the server action.
- `print-labels-button.tsx`: the confirmation dialog.
- E2E updates.

### Task 9: Remaining e2e and axe (written)
Add the spec §10 cases not covered by Tasks 1–8, plus axe scans of the shortcuts dialog, the phone shell (drawer open) and the palette open.

### Task 10: Battery (controller)
1. Reseed.
2. Run tsc, lint and vitest.
3. Run every e2e file in chunks. Fix rounds go to the implementers.
4. Reseed last.

### Task 11: Docs
- `HANDOVER.md`: line 3, and a new lettered block (ag) after (af).
- `PICKUP.md`: the rows and §4 item 1.
- `HANDOVER-PENDING.md`.
- The spec's Status line.
- Record that staging's next redeploy applies migration 33.
