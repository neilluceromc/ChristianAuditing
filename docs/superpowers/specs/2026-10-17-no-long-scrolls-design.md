# Phase 39 — No long scrolls: a tabbed profile side card, previews with side panels, paged big tables

**Status:** CODE-COMPLETE 2026-10-17 on branch `phase-39-no-long-scrolls` (final code tree `4e79632`), MERGED to `main` via `8faf91b` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17. DESIGNED 2026-10-17 with the user on the mockup canvas
(https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz, boards "No long scrolls" and "Profile right column"). The user
approved ("Sure let's do it") and asked to take it through the plan and the build. Merge, push and redeploy stay
the user's calls. **No migration.**

## 1. What the user asked for, and why

- **Notes.** "What if we comment 50 comments, it will be a long scroll. I would like to avoid long scrolls that
  destroy the user experience — or any kind of interaction that makes the webapp have super long scrolls."
- **The right column.** From a screenshot of the profile's right column: "the image should have a proper place or
  UX/UI — it hurts the experience". The problems in it:
  1. two large Edit/Delete buttons on every note;
  2. "Entra / Intune connected" wraps, and the IT-setup selects differ in width and don't line up;
  3. two full-width buttons on the accountability form;
  4. "No transfers" as bare text outside any card;
  5. the column grows with every note.
- **The audit.** A code audit (2026-10-17) found where pages really grow with data:
  - **Likely:**
    - the stocktake count and review sheet (300–2,000 rows);
    - the stock On hand report;
    - the Expiry report;
    - a purchase request's conversation (30–150);
    - employee notes;
    - equipment-policy title rules (every rule's editor open).
  - **Possible:**
    - an asset's Holds tab (every hold ever);
    - an asset's History (one row per changed field, ~750 rows on one page);
    - the import's failure list (up to 2,000 lines);
    - the asset types and categories admin tables.

  Dialogs, drawers, comboboxes and the main list pages are already bounded or paged.

**The rule (applies to everything new from now on):** *a page never grows with the data.* Anything that can keep
growing shows a short preview where it lives, and the rest opens in its own space:
- **Logs** (notes, conversations, holds, transfers): the newest few in place, and "View all" opens a side panel
  with search, 20 at a time.
- **Big tables:** 50 rows per page, with search and filters.
- **Lists inside a form:** one open at a time. Long field lists show a few, then "+N more".

There is no scroll box inside the page. The side panel is the only extra scroll.

**Success** means:
- A profile with 50 notes, a request with 150 messages and a stocktake of 2,000 items are each about one screen
  tall.
- The profile's right column is one tidy card.

## 2. The profile side card (one card, four tabs)

It replaces the stacked Notes, IT setup, Accountability form and Transfers cards in the profile's right column. The
identity band, the equipment card and their behaviour are unchanged.

### 2.1 Tabs
- **The tabs:** **Notes · IT setup · Form · Transfers.** The tab row has `role="tablist"`, is labelled "About this
  person", and has roving focus (arrow keys move between tabs; Home and End jump to the ends).
- **Badges:**

  | Tab | Badge |
  |---|---|
  | Notes | the note count |
  | IT setup | "{n} not yet" (warning tone) when n > 0, else none |
  | Form | "Not signed" (warning) when no signed form is on file; when there is one, "Signed" (neutral) |
  | Transfers | the count |

- **Memory:**
  - The last tab used is remembered per browser in `localStorage` key `br.profile-side-tab`. Every read and write
    is wrapped in try/catch.
  - The default is **Notes**.
  - `?side=notes|setup|form|transfers` overrides the memory, so links can open a tab.
- **Height:** the card has no fixed height. Each tab's content is bounded by design (§2.2–§2.5), so the column stays
  short.

### 2.2 Notes tab
- **The composer:** a one-row textarea ("Add a note…", label visually hidden "New note") that grows to at most 4
  rows as you type, with an **Add** button beside it (admin and it_staff only). Errors show below it
  (`role="alert"`).
- **The 3 newest notes,** each with:
  - author · date and time;
  - the text, cut to 3 lines (`line-clamp`);
  - a small **⋯** button ("Note actions") that opens a menu with **Edit** (inline, in the card) and **Delete**
    (confirm). The rights are the existing `canEditNote` / `canDeleteNote`; the menu is hidden when neither applies.
- **Footer:** "3 newest of {n}" and **View all {n} →**. The footer is hidden when n ≤ 3. With no notes: "No notes
  yet."
- **The notes side panel** (right-side drawer, the same component and behaviour as the held-item panel: focus trap,
  Esc, backdrop, focus return; `?notes=1` keeps it open across a refresh):
  - **Title:** "Notes — {name}".
  - **Search box** (label "Search the notes"): a case-insensitive substring of the text.
  - **"Written by" select:** Anyone, plus each author who wrote a note on this person.
  - **Count line:** "{n} notes · newest first · showing {k}", or "{m} of {n} notes match" while filtering.
  - **Month headings** (Asia/Manila, "October 2026").
  - **Each note:** the full text (`whitespace-pre-wrap`), "· edited", and Edit/Delete as small links when allowed.
  - **Paging:** 20 at a time, with **Load 20 older** at the end while more exist. "No note matches." when the
    filters find nothing.
- **Data:**
  - The profile query loads only the 3 newest notes plus the total count, not every note.
  - The panel uses a read-only server action `listEmployeeNotes({ employeeId, q?, authorId?, before? })`:
    - `requireUser`-equivalent auth and the "check" rate kind;
    - 20 rows newest first, with keyset paging on (createdAt, id) via `before`;
    - it returns `{ notes, hasMore, authors }`, where `authors` (id and name) comes only on the first page.
  - Editing or deleting refreshes the card and the open panel.

### 2.3 IT setup tab
- **Rows:** a two-column grid, label `1fr` and control `150px`. Each row is:
  - a status dot (Done green, Not yet amber, Not needed / None grey, Not recorded a hollow grey ring);
  - the label, which never wraps;
  - a select. Every select is the same width and lines up.
- **Labels:**
  - The visible labels are "Entra / Intune", "Autopilot", "Argus" and "VPN".
  - The selects keep their existing accessible names ("Entra / Intune connected", "Autopilot", "Argus", "VPN in
    use"), so assistive tech and the tests are unchanged.
- **VPN "Other…"** shows the name input and Save on their own row under VPN.
- **Saving and viewers:**
  - Values save on change, as today, with the toast "Saved".
  - A muted line under the rows reads "Saves as you change it."
  - Viewers see plain values in the same grid.
- **Rate-limit refusal:** the select snaps back to the stored value (the Phase 37 deferred minor, fixed here).

### 2.4 Form tab
- **Status line,** with a dot:
  - "No signed form on file" (amber); or
  - "Signed {d MMM yyyy} · covers {n} items" (green), plus "{k} issued since" in amber when items were issued
    after the signature (the existing logic).
- **Helper line:** "Print it, have them sign, then record it here."
- **Buttons side by side:** **Print form** and **Record a signed form…**. The second is primary when nothing is
  signed.
- **History:** the existing "History" `<details>` (at most 20, already capped) stays under the buttons.

### 2.5 Transfers tab
- **The 3 latest transfers,** each "{date} · {from} → {to}[ · {fromTitle} → {toTitle}]", with the reason and "by
  {actor}" muted.
- **"See all in Timeline →"** (to `/employees/<id>/timeline`, which is already paged) when there are more than 3.
- **Empty state:** "No transfers yet", "Moves between departments or clients show here.", and a **Transfer…**
  button. The button opens the existing transfer dialog, and shows only when the user may transfer and the person
  is ACTIVE.

## 3. Purchase request conversation
- **On the request page:** the thread shows the **5 newest** messages, in time order (oldest of the five first,
  composer at the bottom, as today).
- **"Earlier messages ({n}) →"** sits above them when there are more than 5. It opens a side panel titled
  "Conversation — {refNo}" with the full thread:
  - a search box;
  - a "Kind" filter: All, Comments, Status changes;
  - month headings;
  - 30 at a time, oldest first, with **Load 30 more**.
- **Data:** the page already loads the whole thread, because the stepper and bounce-back logic need it. The panel
  filters that data in the browser, so there is no new server action.

## 4. Stock: paged big tables
All three use the house list pattern (`parseListState`, `ENTITY_PAGE_SIZE` = 50, and `Pagination`). The state lives
in the URL.

### 4.1 Stocktake count and review (`/stock/stocktakes/<id>`)
- **Paging:** 50 lines per page.
- **Search:** item name or code.
- **Category filter:** shown when the stocktake spans more than one category.
- **On the count sheet,** an **Only uncounted** toggle, with a count "{n} still to count" in the header.
- **Rows** still save themselves on blur or Enter (one line per action). Paging never loses a typed value: changing
  page while a row is mid-save waits for it.
- **The review step** pages the same way, with a **Only differences** toggle. The posting totals in the header stay
  computed over all lines.

### 4.2 On hand (`/stock/reports/on-hand`)
- **Paging:** 50 items per page, with a category heading where the category changes on the page.
- **Search** and a **Category** filter.
- **Totals:** the totals card (value, uncosted units) stays computed over everything matching the filters. The
  category subtotals move into that card as a compact list, top 8 by value, then "+{n} more".
- **Export** is unchanged.

### 4.3 Expiry (`/stock/reports/expiry`)
- **Tabs:** **Expired ({n})** and **Expiring ({n})**, `?tab=`.
- **Paging:** 50 per page, with search.
- The export is unchanged.

## 5. Other bounded lists
- **Equipment policy title rules** (`/admin/equipment-policies`): the fold lists each rule as a row with:
  - the title, "{k} lines", and Edit.
  - **One editor is open at a time.** Opening another while the open one has unsaved changes asks "Leave without
    saving?".
  - "+ Add a title rule" opens its editor the same way.
- **Asset Holds tab** (`/inventory/<id>/reservations`):
  - **Active holds** show as today.
  - **Resolved holds** are behind "Show past holds ({n})" (`?past=1`) and paged 20 per page.
- **Asset History** (`/inventory/<id>/history`): each audit entry shows at most 3 changed fields, then a "+{n} more
  fields" button that expands that entry only. The 50-entry paging is unchanged.
- **Import failures** (import wizard result): show the first 20 failure lines, then "and {n} more", plus **Download
  all failures (.csv)**. The CSV is built in the browser from the data already present (row and reason columns).
- **Asset types and categories** (`RefTable` on the two admin pages):
  - a search box ("Find a type…" / "Find a category…");
  - the table in a box `max-h-[520px] overflow-auto` with a sticky header, matching the Departments & clients
    page;
  - "Showing {k} of {n}."

## 6. The profile stops downloading every spare
- **Today:** the profile loads every assignable IT asset (`spareAssets`) and sends it to the browser, only to feed
  the Fill, Replace and Reserve pickers.
- **Change:**
  - The profile sends no spares.
  - The pickers ask the server when they open, through a read-only action `spareCandidates({ employeeId,
    assetTypeId?, q? })`:
    - the "check" rate kind;
    - the same assignability where-clause as today;
    - at most 50, ordered as today (same type first);
    - type-to-search by tag or model.
  - Behaviour in the dialogs is otherwise unchanged.
- **Out of scope (recorded as follow-ups):**
  - the asset record header's spare list;
  - Register's purchase-request select.

## 7. Testing

### 7.1 Unit
- **Pure helpers:**
  - the tab memory read and write (bad stored value → Notes; `?side=` overrides);
  - the badge rules;
  - the notes month grouping (Manila);
  - the notes filter (search and author);
  - the thread filter (kind and search);
  - the failure-CSV builder (quotes, commas, newlines);
  - "+{n} more fields" slicing;
  - RefTable filtering.
- **Status dot mapping** for IT setup, including Not recorded.

### 7.2 E2E (run only in the final battery)
1. **The profile right column** is one card with four tabs.
   - Tab badges are correct for EMP-0042.
   - Switching tabs works with the keyboard.
   - The remembered tab survives a reload; `?side=setup` opens IT setup.
2. **Notes:**
   - create 25 notes for a person (via prisma);
   - the card shows 3 and "View all 25 →";
   - the panel shows 20, then Load 20 older gives 25;
   - search narrows, and "Written by" narrows;
   - Edit from the ⋯ menu works;
   - **the page height with 25 notes is within 40 px of the height with 1 note** (assert
     `document.documentElement.scrollHeight`).
3. **IT setup:** all four selects have the same x position and width. Changing Argus saves.
4. **Purchase conversation:**
   - seed 12 notes on a request;
   - the page shows 5 and "Earlier messages (7) →";
   - the panel shows all 12, and the kind filter works.
5. **Stocktake:**
   - open an all-categories stocktake over a seed with more than 50 items (create extra items via prisma);
   - page 2 exists;
   - Only uncounted narrows after counting a line;
   - a typed count on page 1 is saved before navigating.
6. **On hand and Expiry:** paged; search narrows; the Expiry tabs switch.
7. **Policy title rules:** with two rules, opening one closes the other, and an unsaved change prompts.
8. **Holds:** past holds are hidden until "Show past holds".
9. **History:** an entry with more than 3 fields shows "+N more fields" and expands.
10. **Import failure CSV:** this is unit-level; the e2e only checks that the link exists when there are failures (if
    a fixture can produce failures cheaply; otherwise unit only).
11. **Axe** on the profile (each tab), the notes panel, the request page with its panel, the stocktake sheet and the
    two reports.

**Existing specs** that assert the old stacked cards (Notes "Show all", the IT setup card heading, the
Accountability form card, "No transfers") are updated.

## 8. Rulings taken while writing
1. **Tabs over a tidier stack:** the user's goal is a column that never grows; tabs give that, and badges keep the
   important states visible. *Cost if wrong:* one extra click to reach a tab's content.
2. **Employee notes are server-paged; the purchase thread is browser-paged,** because the request page already
   needs the whole thread for its stepper and bounce-back logic. *Cost if wrong:* a request with thousands of
   messages would still ship them all (unrealistic: comments are hand-typed).
3. **On hand subtotals become a compact top-8 list,** because a full subtotal per category would recreate the long
   page. *Cost if wrong:* Finance looks for a small category's subtotal behind "+N more".
4. **Spare loading on demand covers the profile only;** the record header and Register's purchase-request select are
   follow-ups. *Cost if wrong:* those two pages stay heavy at 10,000 assets.
5. **No fixed card height on the profile;** each tab is bounded by design instead. A fixed height would add an inner
   scroll, which the rule forbids.
