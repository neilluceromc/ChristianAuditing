# Phase 47: Finance assets redesign, and shell fixes (design)

**Date:** 2026-10-21

**Status:** written from the owner's approved mockups

**Mockup:** the "Finance Assets Redesign" canvas. The boards are *Finance · Assets list* and *Option B · Ledger*; Options A, C and D were not chosen.

**Numbering:** this phase is 47. Client staff and people flows moves to **Phase 48**, and deeper asset management to **Phase 49**.

## 1. Intent

Finance works from two screens:
- the Assets register, to find and total assets;
- one asset's page, to see how its value is being written off.

Today both are long, flat pages. The owner wants:
- the list to work like Inventory and Employees, with tiles and tabs that filter, focused on book value and depreciation;
- the asset page to be a ledger they can read year by year, with room for notes, extra proof and an accountable history.

Alongside these, the owner asked for five shell changes: sidebar animation, a Disposal placeholder, the "CRIS" name, settings that follow the person, and clearing Cris chats on sign-out.

**Owner's answers (2026-10-21):**
- **Notes and attachments:** Finance **and IT** can post, reply and upload. Viewers can read only.
- **Disposal:** a link in the **Finance** sidebar only.
- **Settings that follow the person:** **all** of them: theme, density, sidebar, Home focus and last workspace.

## 2. Goals, non-goals, anti-goals

**Goals:** everything in §3 and §4, working for both classes, IT and Purchasing.

**Non-goals:**
- The real Disposal feature. The page is a placeholder.
- Any change to how depreciation is calculated. The schedule numbers stay exactly as they are today.
- The mockup's Options A, C and D.

**Anti-goals** (a failure even if it works):
- Any figure on the new screens disagrees with today's depreciation engine (`src/lib/depreciation.ts`) or with the existing Finance totals.
- An audit entry can be edited or deleted from the app.
- One person's theme or layout shows up for another person on a shared computer.
- A long history, or a long useful life, makes the asset page scroll for screens.

## 3. Finance → Assets list (`/finance/assets`)

**Top to bottom:**
1. **Class tabs:** IT | Purchasing, each with its asset count. Switching class clears every filter.
2. **Money totals,** four cards scoped to the class, category and status filters in force:
   - **At cost:** asset count.
   - **Accumulated depreciation:** % of cost written off.
   - **Book value.**
   - **Depreciation this month:** the sum of this month's charge across depreciating assets, and their count.
   - All figures come from the existing depreciation results, "as of today", using the same rule as today's totals footer.
3. **Category tiles,** placed below the totals:
   - **Contents:** "All categories" plus one small tile per category of the class, each showing name, asset count and book value. Hovering shows the cost.
   - **Grid:** 6 columns on desktop (rows always full), 4 on screens up to 1000 px, 2 on phone width. Never a horizontal scroll.
   - **Class with ≤ 5 tiles:** one row with as many columns as tiles.
   - **More categories than fill whole rows:** the smallest fold into one "Other" tile, so rows stay full.
   - **Selection:** one category at a time; pressing the selected tile again clears it. URL param `?category=<id>`. The folded tile uses `?category=other`, meaning every category not shown on its own tile.
4. **Status tiles:** the Phase 45 inventory tiles for the class, each showing count, caption and book value, all scoped to the selected category.
   - **IT:** In stock, Deployed, Loan, In repair, Missing.
   - **Purchasing:** In use, Stored, Repairing, Lost.
5. **One table card** holding three parts:
   - **Finance-state tabs** (underlined, with count badges), replacing today's chips: All, To review, Sent back, Waiting for IT (**IT only**), Approved, Not capitalised, No cost. The "To review" badge is amber and the "Sent back" badge red when the count is above 0.
   - **Toolbar:**
     - search (tag, model, serial, holder);
     - **Category** select (mirrors the tiles);
     - **Life** select: Any; 6 months or less left; Fully depreciated; Not depreciating yet;
     - **Sort** select: book value high first (default); life used, most first; tag. *Ruling:* this replaces today's "To review first" order on All; the To review tab covers that need;
     - right-aligned: "N assets shown" and their combined book value.
   - **Active-filter chips** with "Clear all".
6. **Table:**
   - **Asset:** tag link, plus model · holder ("not assigned" when there is no holder). *Ruling:* Asset has no location field, so Purchasing shows the holder too.
   - **Category, Status pill, Finance pill.**
   - **Cost, Accum. dep., Book value.**
   - **Life used:** a bar with "14 / 36 mo · 22 left", or a text state such as "Starts when approved", "Expensed, not depreciated" or "No cost yet".
   - Zebra rows, sticky header, the Phase 45 footer with rows per page and pagination, and a totals row for the rows shown. The row menu (override and settings) stays.

Today's separate status chip row and the finance chips are replaced by the tiles and the tabs.

**URL state** (`src/lib/url-state.ts` patterns, Phase 45): `cls`, `category`, `status`, `fin`, `q`, `life`, `sort`, `page`, `per`.

## 4. Finance → one asset (`/finance/assets/[id]`), mockup Option B

### 4.1 Layout
- **Left panel** (about 320 px; on a phone it stacks above the main column):
  - **Identity:** tag (h1), model · category, status and finance pills.
  - **Life:** a life-used ring (%), book value today, "N of M months left · ends Mon YYYY", a cost-versus-depreciated bar, and Cost / Depreciated / Book value / Per month.
  - **Asset card:** serial, category, status, held by, works for. The tag is the h1, so there is no separate asset-number row. "Held by" links to the employee only for roles that can open `/employees`; finance_staff see plain text.
  - **Documents card:** the four existing slots (Sales invoice, Official receipt, Delivery receipt, Warranty slip), each with a file icon and name.
    - Clicking an uploaded one opens the **preview** at the top of the main column, with Open full size, Download and Close.
    - A missing slot shows dashed and "not uploaded".
- **Main column:** four underlined tabs with badges. The tab is in the URL: `?tab=ledger|notes|files|history`, default `ledger`.
  - **Depreciation ledger** (badge "36 mo")
  - **Notes** (count; the badge is amber while any thread is unresolved)
  - **Attachments** (count)
  - **Financial history** (count)
- **Header actions:** **Depreciation settings** (the existing dialog) and **Export**, on every tab.

### 4.2 Depreciation ledger tab
- **Year tabs,** one per calendar year of the asset's life plus **All years**. Each shows the year, its months, the total charged, and Done, In progress or Upcoming. The year is in the URL (`?year=2027|all`). The default is the year holding this month, or the first year if the asset hasn't started.
- **One year selected:**
  - a strip with opening book value, charged this year and closing book value;
  - a table with one row per month: Month, Opening, Charge, Accumulated, Closing, State (Counted, This month, Projected);
  - this month highlighted and projected rows muted;
  - the month that absorbs rounding marked `*`, with its note.
- **All years:** **one summary row per year** (never all months): Year (a button that opens that year), Opening, Charged in year, Accumulated, Closing, State. A 5-year asset is 6 rows at most.
- **Under the ledger,** three cards:
  - **Purchase:** purchase request (linked), requested by, supplier, invoice no., OR no., purchase date, warranty until, covered by.
  - **Cost breakdown:** **No taxes/duties line.** *Ruling*, so it agrees with the engine (`Asset.cost − salvage`; fees never depreciate):
    - **Purchase price:** `Asset.cost`.
    - **Delivery and fees:** from the `PurchaseRecord`. When it covered several units it reads "for the whole delivery of N".
    - **Salvage value.**
    - **Depreciable base:** cost − salvage.
    - There is no "total acquisition cost" row, because fees are not part of the depreciable base today.
  - **Depreciation:** method, policy, useful life, starts, ends, per month, override, approved by and date.
- **Not capitalised, no cost or not yet approved:** the tab shows today's "why there is no schedule" message instead of the ledger.

### 4.2a Where Notes and Attachments live (owner, 2026-10-21)
- One shared set of notes and attachments per asset, shown in two places:
  - the Finance asset page (this section);
  - **the same two tabs on the Inventory asset record** (`/inventory/[id]`), which IT, Purchasing and viewers can open.
- The Inventory version shows **no money figures**. Its notes and attachments are the same rows.
- **Read:** anyone who can see the asset (class visibility, `canSeeClass`).
- **Post, reply, resolve and upload:**
  - admin and finance_staff on any asset;
  - it_staff on IT-class assets;
  - purchasing_staff on Purchasing-class assets.
- **Viewers** read only.
- **Attachments are shared with everyone who can see the asset** (owner). They also appear in the Inventory record's existing Documents list, grouped under "Attachments".

### 4.3 Notes tab (new)
- **Compose box:** "Add a note"; Post is disabled while the box is empty; at most 2,000 characters.
- **Threads, newest first:** author initials, name, role (Finance, IT, Admin), time, text.
- **One level of replies,** oldest first, each with a Reply box.
- **Mark resolved / Reopen** on a thread. A resolved thread is dimmed and labelled "Resolved".
- **Who:** as in §4.2a. **No one** can edit or delete a note, the same rule as audit.
- **Audit:** every post, reply, resolve and reopen writes an audit entry, so it shows in Financial history.
- **New table `AssetNote`:**
  - **Fields:** `id`, `assetId`, `parentId` (null = thread; one level only), `authorId`, `authorLabel`, `body`, `resolvedAt`, `resolvedById`, `createdAt`.
  - **Indexes:** `(assetId, createdAt)` and `(parentId)`.

### 4.4 Attachments tab (new)
- **Upload area:**
  - pick the kind (Proof of payment, Quotation, Photo, Other), then choose or drop a file;
  - PDF, PNG or JPG, **4 MB** cap, using the same validation and storage driver as other uploads (local disk, or Supabase on Vercel).
- **Filter buttons** by kind, with counts.
- **List:** file name, kind, uploader, date, size (a new nullable `AssetDocument.size`, set on every upload from now on; older rows show no size). Selecting one previews it beside the list:
  - **PDF:** inline in the browser.
  - **Image:** `<img>`.
- **Who:** as in §4.2a. No one can delete from this tab; replacing a file uploads a new one.
- **Storage:** existing `AssetDocument` rows with new `kind` values `attachment:proof-of-payment`, `attachment:quotation`, `attachment:photo`, `attachment:other`, plus the new `size` column.
- **Audit:** each upload writes an audit entry.
- **Inline preview:** the existing asset document download route gains `?inline=1`, which sends `Content-Disposition: inline` for PDF and images. The route's auth and visibility checks are unchanged.

### 4.5 Financial history tab (improved)
- **Sources:**
  - the asset's audit entries for finance-relevant actions: cost, registration, IT check, send back, resubmit, approve, not-capitalised, override set or removed, documents and attachments, notes;
  - **plus** the audit entries of the asset's `PurchaseRecord` (`entityType: "purchase-record"`), where fee changes are recorded today;
  - **plus one line per depreciation month counted**, derived from the schedule, not stored. That line shows actor "System", "counted <Month> depreciation", and the accumulated and book-value changes.
- **Entry layout:**
  - initials and avatar, **actor name (role)**, a verb sentence, a kind pill, and the time;
  - **change chips**, one per changed field: field, old value (struck through) → new value;
  - the **reason** in quotes when the action carried one;
  - the **source** pill: Web app, Import, Cris assistant or Nightly job;
  - a **Details** toggle showing the reference, exact time with time zone (Asia/Manila), the signed-in account (email), and what it relates to.
- **Grouping:** by day, with a date header row.
- **Filters:** kind (All, Approvals, Reviews, Cost, Settings, Documents, Notes, Depreciation, each with a count) and person (Everyone, each actor, System).
- **Paging:** 10 per page, newest first, Previous / Next with "x–y of N"; the filters and page are in the URL.
- **Export log:** CSV of the filtered entries.
- **Lock note:** "Entries are written automatically and can't be edited or deleted."
- **Schema:** `AuditEntry` gains two nullable columns:
  - **`source`:** `web` | `import` | `cris` | `system`;
  - **`reason`:** text.
- **Writers in this phase:**
  - Every finance and asset action this phase touches sets them: `source` from the calling path, and `reason` from the note or comment field the action already has (send-back note, override note, import, Cris tools).
  - Existing rows have both null. They show "Web app" and no reason.
- **Reference:** `AUD-<yyyymmdd>-<last 6 chars of id, upper case>`. It is derived, not stored.

## 5. Shell fixes
1. **Sidebar collapse animation:**
   - The sidebar's width animates between full (236 px) and rail (72 px) over `--dur-4` (260 ms) with `--ease-std`. Labels and counts fade out before the width shrinks and fade in after it grows.
   - Under `prefers-reduced-motion` the change is instant.
   - The first paint from the cookie never animates.
2. **Disposal placeholder:**
   - The Finance sidebar gets **Disposal**, a plain link with an icon, after Assets, at `/finance/disposal`.
   - The page shows its title, "Disposal", and an empty state: **"Still in development"** with one line, "Recording disposals and their value will come here."
   - Same roles as the other Finance pages.
3. **"CRIS" name, no logo** (owner, 2026-10-21):
   - **Sidebar brand:** "Backroom IT" becomes **"CRIS"**, and the square "BR" logo mark in front of it is **removed**.
   - **Icon rail:** the BR mark doubles as the workspace switcher there (`workspace-switcher.tsx`, `variant="logo"`). It becomes a compact **"CRIS"** text mark that keeps the switcher behaviour.
   - **Browser tab titles:** `APP_NAME` in `src/lib/page-title.ts` becomes "CRIS", so tabs read "{Page} · CRIS". The root layout's fallback title follows.
   - *Ruling:* printed company documents keep "Backroom IT" and the BR mark: the equipment accountability form, the farewell report and the asset labels. The owner named the sidebar and the tab titles. It's noted for the owner.
4. **Settings follow the person:**
   - **Storage:** `UserPreference` key `ui:prefs` holds `{ theme, density, sidebar, focus, workspace }`.
   - **Toggles:** each toggle (theme, density, sidebar collapse, Home focus, workspace switch) saves the person's preference through a server action **and** sets the existing cookie for the next paint.
   - **Sign-in:** the cookies (`br.theme`, `br.density`, `br.sidebar`, `br.focus`, `br.dept`) are **rewritten from the person's saved preferences**, or cleared to defaults if none. A shared browser therefore never carries one person's settings into another person's session.
   - *Ruling (builder check):* sign-in has five paths: credentials, quick login, sign-up, bootstrap and Microsoft Entra, which finishes in the Auth.js callback. So the rewrite is **one mechanism for all of them**:
     - A `br.uid` cookie records whose settings the browser holds.
     - The app layout passes the user id to a small client component.
     - When `br.uid` differs from the signed-in user, that component calls the server action `restoreUiPrefs()`. It rewrites all six cookies from `ui:prefs` and refreshes the page.
     - Cost: one refresh on the first page after a different person signs in on that browser.
   - **Layouts:** they keep reading the cookies, so there is no extra database read per page.
   - **Cris:** its "Match theme" colour follows the person's theme automatically, because the cookie now does.
5. **Cris chat cleared on sign-out (temporary):**
   - `signOutAction` **soft-clears** the signed-in person's Cris chats before signing out:
     - It sets the new nullable `CrisConversation.clearedAt` on all their conversations; the Cris box then shows only uncleared ones.
     - It deletes their `CrisPendingAction` rows by `userId` explicitly, because there is no foreign key.
   - *Ruling (builder check):* rows are not deleted. The daily question limit and the admin's monthly usage and cost are both counted from `CrisMessage`, and a delete would reset them on every sign-out.
   - It is marked in code as **TEMPORARY (owner, 2026-10-21)**, so it can be removed when history should persist.
   - The stale-session `/logout` route is unchanged; it has no live user.

## 6. Data and migration
- **Migration 37:**
  - create `AssetNote`;
  - add `AuditEntry.source` and `AuditEntry.reason`;
  - add `AssetDocument.size`;
  - add `CrisConversation.clearedAt`.
- All new columns are nullable.
- It is additive only. No data is rewritten.
- The staging deploy (Vercel) runs it through `vercel-build`. Before pushing, take a Supabase dump (`scripts/supabase/dump.ps1 -Image postgres:17-alpine`), per the cloud-staging backup rule.

## 7. Left to the builder
- Component structure, reusing the Phase 45 and 46 patterns: tiles, tabs, sticky list, footer, `useFitsCard`.
- The exact verb sentences per audit action.
- Icons.
- Test shapes:
  - unit tests for the new aggregations (category and status book values, this-month total), year grouping, the All-years summary, history building (including the derived depreciation lines), and permissions;
  - e2e for the list filters, the asset tabs, notes and attachments, sign-in rewriting the cookies, and sign-out clearing Cris.
