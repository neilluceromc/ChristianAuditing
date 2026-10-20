# Phase 47: Finance Assets and Shell Fixes, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rebuild Finance → Assets and the Finance asset page per the approved mockups; add shared Notes and Attachments; strengthen the financial history; and land five shell fixes.

**Architecture:**
- **Pure logic in `src/lib`:** aggregations, ledger grouping, history building, permissions, URL state. Unit-tested in the node vitest environment.
- **Server reads and actions in `src/server/modules/finance`, `.../assets`, `src/server/auth`.**
- **Pages compose the existing Phase 45/46 patterns:** count tiles, underlined tabs, sticky list, list footer, `useFitsCard`, `Table striped stickyHeader`.
- **Database:** one additive migration (37).

**Tech Stack:** Next.js 15 App Router (RSC + server actions), Prisma 6 / Postgres 16 (dev) and 17 (Supabase), Tailwind v4 tokens, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-21-finance-assets-and-shell-design.md`. Read it; it is binding. The approved mockup canvas is the "Finance Assets Redesign" artifact (boards *Finance · Assets list* and *Option B · Ledger*).

## Global Constraints
- **Depreciation figures:** every one comes from `src/lib/depreciation.ts` (`depreciate`, `lifeYears`, `yearGrid`, `asOfMonth`, `resolvePolicy`). Do not change its maths, and never compute depreciation another way.
- **Money:** in centavos (integers) through every layer, formatted only at render, with `fmtMoneyExact` / existing helpers.
- **Upload cap:** `UPLOAD_MAX_BYTES` (4,000,000) and the storage driver (`src/server/storage.ts`) for every new upload.
- **Audit log is append-only:**
  - No code path updates or deletes an `AuditEntry` or an `AssetNote`.
  - New audit writes set `source` (`web` | `import` | `cris` | `system`) and, where the action has a note/comment/reason, `reason`.
- **Roles and visibility:**
  - Pages keep their existing guards.
  - Notes and Attachments read on `canSeeClass`.
  - Writes go through one `canPostOnAsset(role, cls)` (Task 6). The Inventory page never shows money to roles that `canSeeMoney` refuses.
- **URL state:** everything filterable goes in the URL via `src/lib/url-state.ts` helpers. No new localStorage for state.
- **Accessibility:**
  - Real buttons and links.
  - `aria-current` / `aria-pressed` / `aria-expanded` as in Phase 45/46.
  - Every new page passes axe in light and dark.
  - Motion honours `prefers-reduced-motion`.
- **Copy:** as written in the spec. "Still in development" exactly. App name "CRIS" in the sidebar and tab titles; printed forms and labels unchanged.
- **Git:**
  - Never run `git stash`, `checkout`, `restore`, `reset`, `switch`, `--amend`, `rebase`, `merge`, `pull` or `push`.
  - Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - CRLF files keep CRLF (Edit tool or Python `newline=""`; never `sed -i`).
- **Secrets and Prisma:** never read or print `.env`. Never `prisma migrate dev/reset/format` or `db push`; write the migration SQL by hand, then `npx prisma migrate deploy` against the dev DB and `npx prisma generate`.
- **Browser and dev server:** no Playwright and no dev server in Tasks 1–8. Browser tests run in Task 9, `--workers=1`, port 3100.

## Review Focus
1. **An asset with no cost, not capitalised, or not yet approved.** The list shows the right life text and book value. The asset page's ledger tab shows today's "why there is no schedule" message and never a broken table. Covered by the Task 3 and Task 4 tests.
2. **A long life (120 months, Building) or a start mid-year.** Year tabs number 11, the first and last are part years, and All years has ≤ 11 rows. The `*` rounding month is the last month. Covered by a Task 4 test.
3. **A role that can see the asset but not post** (viewer, or it_staff on a Purchasing asset). Read works; every write action refuses on the server, not only in the UI. Covered by Task 6 tests.
4. **A different person signing in on the same browser.** The settings cookies are rewritten to that person's own (or defaults) on their first page. Covered by the Task 2 unit test and a Task 9 e2e.
5. **Signing out with Cris chats.** They no longer show after signing back in. The daily question limit and the admin's monthly usage are unchanged. Covered by Task 2 tests.

---

### Task 1: Migration 37 and the audit/upload plumbing
**Files:** `prisma/schema.prisma`, `prisma/migrations/20261021090000_finance_notes/migration.sql`, `src/server/audit.ts`, `src/server/uploads.ts`, and every `storeUpload` caller that creates `AssetDocument` rows (set `size`).

**Schema:**
- **`AssetNote`:** `id`, `assetId` → Asset (Restrict), `parentId` → AssetNote? (Restrict), `authorId` → User?, `authorLabel`, `body` Text, `resolvedAt` DateTime?, `resolvedById` String?, `createdAt`. Indexes `(assetId, createdAt)` and `(parentId)`.
- **`AuditEntry`:** `source String?`, `reason String?`.
- **`AssetDocument`:** `size Int?`.
- **`CrisConversation`:** `clearedAt DateTime?`.

**Interfaces:**
- `writeAudit(...)` accepts optional `source` and `reason` and stores them. Existing callers compile unchanged.
- `storeUpload` returns `size` (bytes) as well.

**Tests:** the audit writer stores source and reason when given and null when not; `storeUpload` returns the byte length.

**Steps:** write the migration, `npx prisma migrate deploy` (dev DB), `npx prisma generate`, then tests, `tsc`, vitest. Commit `feat(db): migration 37 — asset notes, audit source/reason, document size, Cris clearedAt`.

### Task 2: Shell fixes
**Files:**
- **Sidebar:** `src/components/shell/sidebar.tsx`, `sidebar-collapse.tsx`, `workspace-switcher.tsx`.
- **Names and links:** `src/lib/page-title.ts`, `src/app/layout.tsx`, `src/lib/workspaces.ts`.
- **New:** `src/app/(app)/finance/disposal/page.tsx`, `src/lib/ui-prefs.ts` (+ test), `src/server/ui-prefs.ts` (server actions), `src/components/shell/ui-prefs-sync.tsx`.
- **Toggles:** `theme-toggle.tsx`, `density-toggle.tsx`, `focus-toggle.tsx`, the sidebar toggle, and `switchWorkspace` in `src/server/auth/actions.ts`.
- **Cris:** `signOutAction`, and the Cris conversation reads in `src/server/cris/*` (filter `clearedAt: null` wherever the box lists or resumes conversations; **not** where usage or limits are counted).

**Interfaces:**
- **`src/lib/ui-prefs.ts`:**
  - `UI_PREFS_KEY = "ui:prefs"`
  - `type UiPrefs = { theme: "light" | "dark"; density: Density; sidebar: SidebarState; focus: boolean; workspace: WorkspaceId | null }`
  - `parseUiPrefs(v: unknown): UiPrefs` (defaults on bad input)
  - `uiPrefCookies(p: UiPrefs, userId: string): Array<{ name: string; value: string }>` covering `br.theme`, `br.density`, `br.sidebar`, `br.focus`, `br.dept` and `br.uid`.
- **`src/server/ui-prefs.ts`:**
  - `saveUiPref(patch: Partial<UiPrefs>)`: requireUser, merge, upsert.
  - `restoreUiPrefs()`: requireUser, set all cookies from the stored prefs or defaults.
- **`<UiPrefsSync userId cookieUid />`:** mounted in `(app)/layout.tsx`. When they differ it calls `restoreUiPrefs()` then `router.refresh()`.

**Behaviour:**
- **Sidebar animation:**
  - Width transition 260 ms `var(--ease-std)` on the panel.
  - Labels: opacity transition, fading before collapse and after expand.
  - None on first paint, and none under reduced motion.
- **Brand:** "CRIS" text, with the BR mark removed from the full brand row. In the rail, the switcher's mark becomes "CRIS" (`text-[11px] font-bold`) and keeps its menu. `APP_NAME = "CRIS"`.
- **Disposal:**
  - In `workspaces.ts` Finance nav, after Assets: label "Disposal", href `/finance/disposal`, a plain link.
  - Page guarded `requireRole("admin","finance_staff")`: PageHeader "Disposal" plus an EmptyState with title "Still in development" and description "Recording disposals and their value will come here."
- **`signOutAction`:** `updateMany CrisConversation {userId, clearedAt: null} → clearedAt: now`, and `deleteMany CrisPendingAction {userId}`. Comment: `TEMPORARY (owner, 2026-10-21): clear Cris chats on sign-out; remove when history should persist.`

**Tests:**
- `parseUiPrefs` defaults and round-trip.
- `uiPrefCookies` names and values.
- `saveUiPref` merges.
- The Cris box query excludes cleared conversations; the usage and limit counts include messages of cleared ones.
- `signOutAction` clears and deletes pending.
- The nav has Disposal for Finance only.
- `pageTitle` reads "· CRIS".

**Commit:** `feat(shell): sidebar animation, CRIS name, Disposal placeholder, per-person settings, Cris cleared on sign-out`.

### Task 3: Finance list data
**Files:** `src/lib/finance-list.ts` (+ test), `src/server/modules/finance/queries.ts`, `src/lib/url-state.ts` if needed.

**Interfaces:**
- **`src/lib/finance-list.ts`:**
  - `type LifeFilter = "soon" | "full" | "notstarted"` and `parseLife`.
  - `type FinanceSort = "book" | "life" | "tag"` and `parseSort`.
  - `lifeStage(r: DepResult | null, reg, notCapitalised, costC): { key: "notstarted" | "mid" | "soon" | "full"; text: string; usedPct: number | null }`, with the spec's texts.
  - `categoryTiles(rows: Array<{ categoryId; categoryName; costC; bookC }>, selected: string | null, columns = 6): Array<{ id: string | "all" | "other"; name; count; bookC; costC; on: boolean }>`. It folds the smallest categories into "other" so the tile count fills whole rows: ≤ 5 tiles total stay as they are; otherwise the count is a multiple of 6.
  - `monthCharge(r: DepResult, asOf): number`, this month's charge or 0.
- **`financeAssets(p)`** gains `category`, `life`, `sort`, `per` and returns:
  - `kpis: { costC, accC, bookC, monthC, count, depreciatingCount }`
  - `categoryTiles`
  - `statusTiles: Array<{ status; count; bookC }>`
  - `finCounts`
  - `shown: { count, bookC }`
  - and per row `lifeStage`.
  - Every aggregate respects class plus the category/status filters as the spec says (tiles scoped by category; KPIs by class, category and status).

**Tests:**
- Fold rule: 11 categories → 12 tiles = All + 11; 13 → All + 10 + Other = 12; 4 → 5.
- `lifeStage` texts for each state.
- `monthCharge` for a depreciating, a fully depreciated and a not-started asset.
- Sort orders.
- Life filters.
- KPIs equal the sum of rows on a small fixture.
- Purchasing has no `awaiting-it` count.

**Commit:** `feat(finance): list aggregations — category and status book values, this month, life stage, sort`.

### Task 4: Finance asset page data
**Files:** `src/lib/finance-ledger.ts` (+ test), `src/lib/finance-history.ts` (+ test), `src/server/modules/finance/asset-detail.ts`, the asset document download route (`?inline=1`).

**Interfaces:**
- **`ledgerYears(years: LifeYear[], asOf): Array<{ year; months: number; totalC; openC; closeC; accC; state: "done" | "now" | "upcoming" }>`.**
- **`ledgerMonths(year: LifeYear, …): Array<{ label; openC; chargeC; accC; closeC; state: "counted" | "now" | "projected"; roundingMark: boolean }>`.**
- **`buildHistory(entries: AuditRow[], depLines: DepLine[], filters): { rows: HistoryRow[]; counts: Record<Kind, number>; actors: string[]; total }`:**
  - `HistoryRow = { id, ref, day, time, actor, role, kind, verb, changes: Array<{ field; from; to }>, reason, source, account, related }`.
  - `ref` = `AUD-yyyymmdd-<last 6 of id upper>`.
  - Kinds: approval | review | cost | settings | docs | notes | dep.
  - Verbs per action live in a table in this file.
- **`depLines(result, start, asOf)`** produces one System line per counted month.
- **`financeAssetDetail`** adds:
  - `cost: { priceC, feesC, feesUnits, salvageC, baseC }` (base = cost − salvage);
  - `purchase` fields per spec;
  - audit rows for the asset **and** its purchase record;
  - `noteCount`, `attachmentCount`, and the docs with `size`.
- **Download route:** `?inline=1` gives `Content-Disposition: inline` for pdf, png and jpg only. Auth unchanged.

**Tests:**
- A 36-month asset from Oct 2026 → 4 years (3, 12, 12, 9 months); totals sum to cost; `*` on the last month.
- A 120-month asset → 11 years.
- Not started → empty.
- History: ref format, day grouping keys, kind counts, actor list, a purchase-record fee entry included, dep lines one per counted month, filter by kind and person, page slicing.
- The inline route sets inline only for allowed types.

**Commit:** `feat(finance): ledger grouping, history builder, cost breakdown, inline previews`.

### Task 5: Finance → Assets list UI
**Files:** `src/app/(app)/finance/assets/page.tsx`, new components in `src/components/finance/`: `money-totals.tsx`, `category-tiles.tsx`, `finance-tabs.tsx`, `finance-toolbar.tsx`, `life-cell.tsx`. Remove `fin-chips.tsx` if unused.

**Behaviour:**
- Per spec §3 and the mockup board *Finance · Assets list*.
- The category grid uses CSS grid with 6, 4 or 2 columns (5 or fewer tiles: that many columns), never a horizontal scroll.
- Status tiles reuse the Phase 45 count-tile component with a book-value line.
- Tabs reuse the Phase 45 underlined tabs with badges: amber for To review, red for Sent back.
- The table keeps the row menu.
- The footer is Phase 45's.

**Tests:** component tests for the tile grid column class, tab badge tones, and the toolbar URL each control builds.

**Commit:** `feat(finance): the Assets list redesign`.

### Task 6: Notes and Attachments (server)
**Files:** `src/lib/asset-notes.ts` (+ test), `src/server/modules/assets/notes.ts` (+ test), `src/server/modules/assets/attachments.ts` (+ test).

**Interfaces:**
- `canPostOnAsset(role: Role, cls: AssetClass): boolean`: admin and finance_staff on any class; it_staff on IT; purchasing_staff on PURCHASING; viewer never.
- `ATTACHMENT_KINDS = ["proof-of-payment", "quotation", "photo", "other"]`.
- **Server actions:**
  - `postNote({ assetId, body, parentId? })`: body 1–2000 trimmed; parent must be a thread on the same asset; one level only.
  - `setNoteResolved({ noteId, resolved })`: threads only.
  - `uploadAttachment(formData { assetId, kind, file })`: validated by `validateUpload`, stored with `storeUpload`, kind `attachment:<kind>`, `size` set.
- **Reads:**
  - `assetNotes(assetId)` → threads with replies.
  - `assetAttachments(assetId)`.
- **Every write:** guard by `canSeeClass` **and** `canPostOnAsset`, write an audit entry (`source: "web"`), and revalidate both pages.

**Tests:**
- The permission matrix.
- A viewer's post is refused.
- it_staff on a Purchasing asset is refused.
- A reply to a reply is refused.
- Body length limits.
- An attachment with a bad kind is refused.
- Audit written with source.

**Commit:** `feat(assets): shared notes and attachments with permissions and audit`.

### Task 7: Finance asset page UI (Option B)
**Files:** `src/app/(app)/finance/assets/[id]/page.tsx`; components in `src/components/finance/asset/`: `asset-panel.tsx`, `doc-preview.tsx`, `asset-tabs.tsx`, `ledger-tab.tsx`, `notes-tab.tsx`, `attachments-tab.tsx`, `history-tab.tsx`. Also a `history export` route `src/app/(app)/finance/assets/[id]/history/export/route.ts` (CSV).

**Behaviour:**
- Per spec §4 and the mockup board *Option B · Ledger*.
- **URL state:** `tab`, `year`, `doc`, `hk` (history kind), `hp` (history page), `hw` (history person), `ak` (attachment kind), `att` (selected attachment).
- **Previews:**
  - **PDF:** `<iframe title=… src=…?inline=1>`.
  - **Image:** `<img alt=…>`.
- **Notes and attachments forms:** client components calling the Task 6 actions, with `useActionState`.

**Tests:** component tests for tab badges, the All-years row button href, the history row rendering (chips, reason, Details toggle), and the empty states.

**Commit:** `feat(finance): the asset page — ledger, notes, attachments, financial history`.

### Task 8: Notes and Attachments on the Inventory record
**Files:** `src/app/(app)/inventory/[id]/(record)/notes/page.tsx`, `.../attachments/page.tsx`, the record tab bar (`layout.tsx`), and the existing Documents list (group `attachment:*` under "Attachments").

**Behaviour:**
- The same notes and attachments components as Task 7, imported, **without money**.
- The tab badges match.

**Tests:** the record tabs include Notes and Attachments; no money text renders for an it_staff user; the Documents list groups attachments.

**Commit:** `feat(inventory): notes and attachments tabs on the asset record`.

### Task 9: Browser tests and docs
**Files:**
- `e2e/phase-47-finance.spec.ts`;
- update e2e specs whose locators break: finance assets, sidebar brand, page titles "· Backroom IT";
- `docs/HANDOVER.md`, `docs/PICKUP.md`.

**e2e cases:**
- **List:** category tile filters totals and table; Purchasing has no Waiting-for-IT tab; life filter; sort.
- **Asset page:** year tabs and All years; post a note and reply as finance; IT posts on the Inventory record and it shows on Finance; upload an attachment and preview it; the history shows the note with source and Details; export CSV downloads.
- **Shell:**
  - the Disposal page shows "Still in development";
  - the sidebar says CRIS and the tab title ends "· CRIS";
  - collapse animates (class or transition present) and does not under reduced motion;
  - person A sets dark, person B signs in on the same context and gets light;
  - Cris conversation gone after sign-out and sign-in.
- **axe:** both Finance pages, the Disposal page and the Inventory Notes tab, in light and dark.

**Runs:** chunked, `--workers=1`, port 3100, reseed first and last.

**Docs:** a HANDOVER entry (as) and PICKUP: migration 37, rulings, numbering (client staff → 48, deeper assets → 49), and the Supabase dump before pushing.

**Commit:** `test(e2e): Phase 47` and `docs(handover): Phase 47`.
