# Phase 39 — No long scrolls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No page grows with its data.
- The profile's right column becomes one tabbed card.
- Notes and a purchase request's conversation show a preview, and "View all" opens a side panel.
- The stocktake sheet and the On hand and Expiry reports are paged.
- Title rules, past holds, history fields, import failures and the asset types and categories tables are bounded.
- The profile no longer ships every spare asset.

**Architecture:** pure view rules live in `src/lib/` with vitest. UI reuses the existing primitives:
- `Drawer` (`src/components/ui/drawer.tsx`);
- `Menu` (`src/components/ui/menu.tsx`);
- `Pagination`;
- `parseListState` / `pageOf` (`src/lib/paging.ts`).

Two new read-only server actions (`listEmployeeNotes`, `spareCandidates`) use the "check" rate kind. There is no
migration.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / Postgres 16, zod 4, vitest, Playwright + axe. Playwright runs only
in the final battery.

**Spec:** `docs/superpowers/specs/2026-10-17-no-long-scrolls-design.md` (`3d033f4`). Read it; it is the authority,
and every piece of UI copy in it is binding verbatim. The mockups are the "No long scrolls" and "Profile right
column" boards on https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz. Implementers can't open them, so the spec
carries their content.

## Global Constraints

**Where the work happens**
- Work in the worktree `.claude/worktrees/phase-39-no-long-scrolls`, on branch `phase-39-no-long-scrolls`.
- `.env` points at `inventory_dev` with `APP_BASE_URL=http://192.168.1.193:3100`, and has no `SEED_PASSWORD` or
  `QUICK_LOGIN_EMAILS`.
- Never read or print `.env`. Never touch the `inventory` database or port 3000.

**Browser tests (user instruction since the 2026-10-17 crash)**
- Implementers never run Playwright or a dev server. They write and update e2e specs, make them type-check, and list
  the unrun cases.
- The controller runs everything in Task 10, in foreground chunks of at most 7 files with
  `E2E_PORT=3100 … --workers=1 --global-timeout=540000`, checking port 3100 before and after.

**Database**
- No migration.
- Never run `prisma migrate dev` or `migrate reset`.
- Seed only in the battery.

**Git**
- Never amend. Never run `git stash`, `checkout`, `restore`, `reset` or `switch`.
- The trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files are CRLF and UTF-8 (`core.autocrlf=true`). Use the Edit tool and never `sed -i`.

**House rules**
- `actionRole` / `actionUser` → `checkRate(user.id, "check")` for reads → zod.
- Product aria-labels near a field never contain that field's label word.
- UI copy uses they/them.
- e2e uses `getByRole` with exact names for required fields.
- `localStorage` access is always wrapped in try/catch.

**Spec values (verbatim, see the spec for the full copy)**
- **Profile side card:**
  - tabs **Notes · IT setup · Form · Transfers** (tablist "About this person", roving focus);
  - memory key `br.profile-side-tab`, default Notes; `?side=notes|setup|form|transfers` overrides;
  - badges as in spec §2.1.
- **Notes:**
  - card: 3 newest, line-clamp 3, ⋯ "Note actions" (Edit / Delete), "3 newest of {n}", "View all {n} →" (hidden at
    n ≤ 3), "No notes yet.";
  - composer: "Add a note…" (visually hidden "New note"), grows to 4 rows, "Add";
  - panel title "Notes — {name}", "Search the notes", "Written by", "{n} notes · newest first · showing {k}" /
    "{m} of {n} notes match", Manila month headings, 20 per page, "Load 20 older", "No note matches.", `?notes=1`.
- **IT setup:**
  - grid `1fr 150px`;
  - visible labels "Entra / Intune", "Autopilot", "Argus", "VPN";
  - accessible names unchanged ("Entra / Intune connected", "Autopilot", "Argus", "VPN in use");
  - dots: Done green, Not yet amber, Not needed / None grey, Not recorded a hollow grey ring;
  - "Saves as you change it."; snaps back on refusal.
- **Form:**
  - "No signed form on file", or "Signed {d MMM yyyy} · covers {n} items";
  - "Print it, have them sign, then record it here.";
  - buttons side by side.
- **Transfers:** latest 3, "See all in Timeline →", "No transfers yet" / "Moves between departments or clients show
  here." / "Transfer…".
- **Purchase thread:** 5 newest in time order; "Earlier messages ({n}) →"; panel "Conversation — {refNo}", search,
  Kind (All / Comments / Status changes), 30 per page, "Load 30 more".
- **Stock tables:**
  - **50 rows per page, using `LOG_PAGE_SIZE` (50).** `ENTITY_PAGE_SIZE` is 25 (see plan decision P-1).
  - Stocktake: search; category filter when more than one category; "Only uncounted" with "{n} still to count";
    review "Only differences".
  - On hand: category headings on each page, a totals card with the top 8 subtotals and "+{n} more".
  - Expiry: tabs "Expired ({n})" / "Expiring ({n})".
- **Bounded lists:**
  - **Title rules:** one editor at a time; "Leave without saving?".
  - **Holds:** "Show past holds ({n})", `?past=1`, 20 per page.
  - **History:** 3 fields, then "+{n} more fields".
  - **Import:** first 20 failures, then "and {n} more", plus "Download all failures (.csv)".
  - **RefTable:** "Find a type…" / "Find a category…", `max-h-[520px]` with a sticky header, "Showing {k} of {n}."
- **Spares:** `spareCandidates({ employeeId, assetTypeId?, q? })`, at most 50, the existing where-clause and order.

## Decisions taken in this plan
- **P-1.** The spec says "`ENTITY_PAGE_SIZE` = 50", but the constant is 25. The stock tables use `LOG_PAGE_SIZE`
  (50), which matches the spec's 50 rows.
- **P-2.** The side card replaces `NotesCard`, `ItSetupCard`, `AcknowledgementCard` and `TransfersCard` in the
  profile's right column. Their inner pieces are reused or moved into tab components under
  `src/components/employees/side-card/`, so nothing is duplicated.

## Review Focus
1. **A stored tab value that no longer exists, or `localStorage` that throws** (private mode). It falls back to
   Notes, with no crash. *(Task 1 unit.)*
2. **Editing a note from the panel while the card shows the same note.** Both update, and the count is unchanged.
   *(Task 3 e2e.)*
3. **Typing a count on stocktake page 1, then clicking page 2 before the save finishes.** The value is saved.
   *(Task 5: navigation waits for in-flight saves; e2e.)*
4. **Filters that match nothing** in the notes panel, the thread panel, On hand, Expiry and RefTable. Each shows its
   empty text, not a blank area. *(Each task's tests.)*
5. **A note or comment containing commas, quotes and newlines in the failures CSV.** It is quoted correctly.
   *(Task 7 unit.)*

---

### Task 1: Pure view rules

**Files:**
- Create: `src/lib/side-card.ts` (+test)
- Create: `src/lib/long-lists.ts` (+test)

**Produces:**

```ts
// side-card.ts
export type SideTab = "notes" | "setup" | "form" | "transfers";
export const SIDE_TABS: readonly SideTab[];
export const SIDE_TAB_KEY = "br.profile-side-tab";
export function pickSideTab(param: string | null, stored: string | null): SideTab; // param wins, then stored, else "notes"; unknown values ignored
export function readStoredTab(storage: Pick<Storage, "getItem"> | null): string | null; // try/catch → null
export function writeStoredTab(storage: Pick<Storage, "setItem"> | null, tab: SideTab): void; // try/catch, silent
export function sideBadges(i: { notes: number; notYet: number; signed: boolean; transfers: number }): Record<SideTab, { text: string; tone: "neutral" | "warning" } | null>;
export type SetupDot = "done" | "notyet" | "off" | "unrecorded";
export function setupDot(value: string | null): SetupDot; // DONE→done, NOT_YET→notyet, NOT_NEEDED/"None"→off, null→unrecorded, any VPN name→done
// long-lists.ts
export function monthGroups<T>(items: T[], at: (t: T) => Date): Array<{ month: string; items: T[] }>; // Asia/Manila "October 2026", order kept
export function filterNotes<T extends { text: string; authorId: string }>(notes: T[], q: string, authorId: string | null): T[];
export type ThreadKind = "all" | "comments" | "status";
export function filterThread<T extends { kind: string; text: string }>(notes: T[], q: string, kind: ThreadKind): T[]; // comments = kind "COMMENT"; status = everything else
export function failuresCsv(rows: Array<{ row: number; reason: string }>): string; // header "Row,Reason", RFC 4180 quoting, CRLF line ends
export function sliceFields<T>(fields: T[], max = 3): { shown: T[]; more: number };
export function filterRef<T extends { name: string }>(rows: T[], q: string): T[];
```

Badges follow spec §2.1:
- Notes: the count as text.
- IT setup: "{n} not yet" (warning) when n > 0, else null.
- Form: "Not signed" (warning) when not signed, else "Signed" (neutral).
- Transfers: the count.

- [ ] **Step 1: Write the tests.**
  - `pickSideTab`: precedence, plus an unknown `param` or stored value giving "notes".
  - `readStoredTab`: with a storage whose `getItem` throws, it returns null.
  - `sideBadges`: every branch.
  - `setupDot`: DONE, NOT_YET, NOT_NEEDED, "None", null, "Zscaler".
  - `monthGroups`: crossing a Manila month boundary at 2026-09-30T17:00Z.
  - `filterNotes` and `filterThread`: case-insensitive, trimmed, and an empty query passes everything.
  - `failuresCsv`: a reason with a comma, a quote and a newline.
  - `sliceFields`: 2, 3 and 10 items.
  - `filterRef`.
- [ ] **Step 2:** Run the tests and watch them fail. Implement. Run them again and watch them pass.
- [ ] **Step 3:** Run vitest, tsc and lint. Commit `feat(ui): long-list and side-card view rules`.

---

### Task 2: The profile side card (tabs, IT setup, Form, Transfers)

**Files:**
- Create: `src/components/employees/side-card/side-card.tsx` (client: tablist, memory, `?side=`)
- Create: `src/components/employees/side-card/setup-tab.tsx`
- Create: `src/components/employees/side-card/form-tab.tsx`
- Create: `src/components/employees/side-card/transfers-tab.tsx`
- Modify: `src/app/(app)/employees/[id]/page.tsx`:
  - render the card instead of the four stacked cards;
  - load notes `take: 3` plus `count`;
  - load transfers latest 3 plus count;
  - pass the badge inputs.
- Retire or fold: `it-setup-card.tsx`, `acknowledgement-card.tsx`, `transfers-card.tsx` → move their logic into the
  tab components (P-2); delete files that become unused.
- Modify: the e2e specs that assert the old cards (grep `e2e/` for "IT setup", "Accountability form", "No transfers",
  "Show all").

**Consumes:**
- Task 1's rules.
- The existing `setItSetup`, `recordAcknowledgement`, the transfer dialog, and `canEditNote` / `canDeleteNote`.

Notes tab content comes in Task 3. In this task the Notes tab renders the existing `NotesCard` body unchanged, so the
page keeps working.

- [ ] **Steps:**
  1. Build the tablist: buttons with `role="tab"`, `aria-selected`, `aria-controls` and `tabIndex`; ←/→/Home/End
     move focus and select; panels have `role="tabpanel"` and `aria-labelledby`.
  2. Read the tab from `?side` and stored memory on mount, with the server default "notes" to avoid a hydration
     mismatch: render "notes" first, then switch after mount. Write memory on change.
  3. **IT setup:** the grid, the dots, the visible labels and the hidden accessible names as specified. On any
     non-ok result, the select snaps back to the stored value.
  4. **Form:** status line, helper line, side-by-side buttons, and the history `<details>` (existing, capped at
     20).
  5. **Transfers:** the latest 3, the Timeline link, and the empty state with "Transfer…". It opens the existing
     transfer dialog when the user may act and the person is ACTIVE.
  6. Update the e2e selectors (unrun). Run vitest, tsc and lint. Commit `feat(profile): one side card with Notes ·
     IT setup · Form · Transfers tabs`.

---

### Task 3: Notes — card preview, ⋯ menu, side panel, paged server read

**Files:**
- Create: `src/components/employees/side-card/notes-tab.tsx` and `notes-panel.tsx`
- Modify: `src/server/modules/employees/note-actions.ts`: add `listEmployeeNotes`
- Delete or fold: `src/components/employees/notes-card.tsx`

**`listEmployeeNotes({ employeeId, q?: string (≤100), authorId?: string, before?: { at: string; id: string } })`:**
- Auth: any signed-in user who can open the profile (`actionUser`), with the "check" rate kind.
- Returns `{ notes: Array<{ id, text, createdAt, editedAt, authorId, authorName }>, hasMore, authors?: Array<{ id, name }>, total, matching }`.
- 20 per page, newest first, keyset on `(createdAt desc, id desc)`.
- `q` is a case-insensitive `contains` on text.
- `authors` comes back only when `before` is absent.

- [ ] **Steps:**
  1. **The action,** with zod.
  2. **The card:** the composer (auto-grows to 4 rows) and the 3 newest notes, each with line-clamp 3 and the ⋯
     `Menu` (Edit inline, Delete with confirm). Show the footer only when the total is more than 3.
  3. **The panel:** a `Drawer` with search (debounced 300 ms), "Written by", the count line, Manila month headings
     (`monthGroups`), "Load 20 older", the empty text and `?notes=1`. Edit and Delete in the panel use the existing
     actions, then refresh both the card (`router.refresh`) and the panel list.
  4. **e2e** (unrun), in `e2e/no-long-scrolls.spec.ts` cases 1–2 of spec §7.2. Include the page-height assertion.
  5. Run vitest, tsc and lint. Commit `feat(profile): notes preview with a side panel — search, author, 20 at a
     time`.

---

### Task 4: Purchase request conversation — preview and side panel

**Files:**
- Modify: `src/components/purchases/note-thread.tsx`
- Create: `src/components/purchases/thread-panel.tsx`
- Modify: e2e that asserts the full thread (grep `e2e/` for the thread's markup)

- [ ] **Steps:**
  1. **The inline thread** shows the 5 newest messages in time order. When the total is more than 5, "Earlier
     messages ({n}) →" opens the panel. The composer is unchanged.
  2. **The panel:** "Conversation — {refNo}", search, Kind filter (`filterThread`), month headings, oldest first,
     30 at a time with "Load 30 more", and the empty text. The data is the `notes` prop the page already passes.
  3. **e2e case 4** (unrun). Run vitest, tsc and lint. Commit `feat(purchases): conversation shows the newest five;
     earlier messages open in a side panel`.

---

### Task 5: Stocktake sheet — paged

**Files:**
- Modify: `src/app/(app)/stock/stocktakes/[id]/page.tsx`
- Modify: `src/server/modules/stock/queries.ts` (~500): the stocktake lines query, paged and filtered, plus counts
- Modify: `src/components/stock/stocktake-count.tsx` and `stocktake-review.tsx`
- Modify: the stocktake e2e specs

- [ ] **Steps:**
  1. **List state in the URL:** `page`, `q`, `cat` and `uncounted=1` (count) or `diff=1` (review).
     - The query returns the page (`LOG_PAGE_SIZE`) plus `total`, `matching`, `stillToCount` and the category list.
     - Header totals stay over all lines.
  2. **The count sheet:** before any page or filter navigation, wait for in-flight row saves. Hold a pending-saves
     promise set in the component and await it in the `Pagination`'s `onNavigate`; if `Pagination` is link-based,
     intercept the click. Add a unit test of the pure "wait for all" helper.
  3. **The review step** gets the same paging plus "Only differences".
  4. **e2e case 5** (unrun; it creates more than 50 items via prisma and cleans up). Run vitest, tsc and lint.
     Commit `feat(stock): stocktake sheet paged 50 at a time with search, category and only-uncounted`.

---

### Task 6: On hand and Expiry — paged

**Files:**
- Modify: `src/app/(app)/stock/reports/on-hand/page.tsx`, `on-hand-table.tsx`, and the report queries (subtotals over
  everything; rows paged)
- Modify: `src/app/(app)/stock/reports/expiry/page.tsx`, `expiry-table.tsx`, and `report-queries.ts` (~300; add
  `take` and `skip` and counts per tab)
- Modify: the stock-reports e2e

- [ ] **Steps:** follow spec §4.2–§4.3 exactly. Totals and subtotals are computed over every row matching the
  filters, never just the page. Exports are unchanged. e2e case 6 (unrun). Run vitest, tsc and lint. Commit
  `feat(stock): On hand and Expiry paged, with search; expiry split into Expired and Expiring tabs`.

---

### Task 7: Bounded lists — title rules, past holds, history fields, import failures, RefTable

**Files:**
- `src/components/admin/policies/policy-detail.tsx` (title rules as an accordion, one open; reuse the existing
  dirty-flag context for "Leave without saving?")
- `src/app/(app)/inventory/[id]/(record)/reservations/page.tsx` (active holds plus "Show past holds ({n})",
  `?past=1`, 20 per page)
- `src/app/(app)/inventory/[id]/(record)/history/page.tsx` (per entry: `sliceFields` plus a "+{n} more fields"
  toggle; client island)
- `src/components/import/import-wizard.tsx` (~562: first 20, "and {n} more", plus "Download all failures (.csv)" via
  `failuresCsv` and a Blob)
- `src/components/admin/ref-table.tsx` (search, the bounded box with a sticky header, "Showing {k} of {n}.")
- The matching e2e specs (unrun)

- [ ] **Steps:** one sub-commit per area is fine. Run vitest, tsc and lint. The final commit message is
  `feat(ui): bounded title rules, past holds, history fields, import failures and reference tables`.

---

### Task 8: Spares on demand (profile)

**Files:**
- Modify: `src/app/(app)/employees/[id]/page.tsx` (drop the `spareAssets` query and the `spares` prop)
- Create: `src/server/modules/employees/spare-actions.ts` → `spareCandidates`
- Modify: `src/components/employees/loadout-view.tsx` (the Fill, Replace and Reserve pickers load on open; the
  existing combobox gets an async source and a loading state)

**`spareCandidates({ employeeId, assetTypeId?, q? })`:**
- Auth: `actionUser` plus `canSeeClass(IT)`, with the "check" rate kind.
- Where-clause: exactly the profile's current spares where-clause. Copy it from the page into one shared function
  and use it only here.
- `q`: a case-insensitive `contains` on tag or model.
- Order: same-type first, then as today. At most 50.
- Returns the same `SpareOption` shape the dialogs use.

- [ ] **Steps:**
  1. Write the action and its unit-testable pieces: the pure ordering and the option mapping, with tests.
  2. Wire the pickers: on open, fetch with the slot's type; typing searches (debounced 250 ms); show a loading row
     and an error row.
  3. Check every existing behaviour of those dialogs still holds: Assign, Replace, Reserve, the loaner Fill, and the
     reserved assign.
  4. Update the e2e specs that depended on spares being present at first paint (unrun).
  5. Run vitest, tsc and lint. Commit `perf(profile): spare assets load when a picker opens, not with the page`.

---

### Task 9: E2E for the phase (written)

- Complete `e2e/no-long-scrolls.spec.ts` with spec §7.2 cases 3, 7, 8 and 9, plus the axe scans (case 11) added to
  `e2e/axe-sweep.spec.ts`.
- Make it type-check. Commit `test(e2e): no long scrolls — tabs, panels, paging, bounded lists; axe`.

### Task 10: Battery (controller)

- Reseed. Run tsc, lint and vitest.
- Run every `e2e/*.spec.ts` in chunks of at most 7 files, with `axe-sweep` alone.
- Fix rounds go to implementers. Reseed last.

### Task 11: Docs

- Update `HANDOVER.md` (line 3 and a new lettered block after (ae)), `PICKUP.md` (rows and §4 item 1),
  `HANDOVER-PENDING.md` (the preamble, plus the follow-ups: the record header's spares and Register's purchase-request
  select) and the spec's Status line.
- Record the rule "a page never grows with the data" in the HANDOVER block as a standing design rule.
- Commit `docs(handover,pickup): Phase 39 code-complete on phase-39-no-long-scrolls, unmerged`.
