# Phase 45 — Inventory and Employees lists: design

**Date:** 2026-10-20 · **Status:** approved by the owner in chat ("yes write the spec and proceed until development") · **Branch:** `phase-45-lists`

## 1. Why

The owner reviewed the Inventory and Employees lists across many mockups and a throwaway spike inside the real app
(`spike-inventory-lab`, never merged). Their complaints about today's lists:

- Inventory shows too many columns (Registration, Purchased, Warranty) and reads as "not a good table".
- Employees shows things nobody needs in the list (avatar initials although no photos are uploaded, the M365 column,
  the EMP number on every row, a ragged "Client" tag), and its filters repeat each other.
- Long lists mean scrolling "20 times" to reach the page controls, and the rows take too much height.

What they approved, screen by screen, in the spike and the interactive artifact:

- Inventory **option H**: count tiles that filter, six columns, a floating bulk bar.
- Employees as a **plain table** (rows and columns) with **underlined tabs with counts** above it instead of tiles.
- **Zebra rows** on both lists.
- A **sticky** toolbar, column header and footer, with **Rows per page**.
- **Three row sizes**: Comfortable, Compact, and a one-line **Dense**.

### Goals
- Both lists answer "what is this, who has it, is anything wrong" at a glance, in fewer, calmer columns.
- No scrolling to reach filters, column headings or page controls.
- Same look and habits on both lists (spacing, type, zebra, sticky parts, row sizes, bulk bar).
- Employees gets bulk actions: **Transfer…**, **Export** and **Print IT forms**.

### Non-goals
- No change to what any filter or query *means*; counts and results stay identical for the same URL.
- No phone card layout. Below 768 px the tables keep scrolling sideways as today. *(My call; the owner never saw a
  phone version. Listed as a follow-up.)*
- No item-by-item kit popover on Employees. The lab tried one in the artifact; the owner's last approved screens show
  plain counts. *(My call.)*
- No other list in the app changes look, except that the new Dense row size makes them use their compact height.

### Anti-goals (a failure even if it "works")
- The sidebar or top bar changes look. (The owner rejected mockups for exactly that.)
- A list that needs hovering to understand a cell.
- Any regression in the existing Inventory bulk actions, row menu, column chooser, label printing or export.

## 2. Inventory list (`/inventory`)

### 2.1 Count tiles (new)
Six tiles in one row above the toolbar, taken from the spike's `CountTiles` (`h-parts.tsx` in the spike):

| Tile | Filter it applies | Dot family |
|---|---|---|
| In stock | status = SPARE | neutral |
| Deployed | status = DEPLOYED | settled |
| On loan | status = TEMPORARY (labelled "Loan") | inflight |
| In repair | status = DEFECTIVE | fault |
| Missing | status = MISSING | fault |
| Need attention | the attention predicate (`attentionWhere`) | attention |

- **Label and caption:** each tile shows an 11 px uppercase label, a 26 px number and a 12 px caption. The captions
  are "Spare, ready to assign", "With staff", "Due back", "Defective, out of service", "Custody lost" and
  "Someone owes an action".
- **Counts:** each count is what clicking that tile shows. The scope is the current class, search and every facet
  except status and attention.
- **One pressed at a time:** clicking a tile clears the other tiles' filters. Clicking the pressed tile clears it.
- **Pressed state:** an accent border, ring and accent number.
- **Accessibility:** tiles are links with `aria-current="true"` when pressed, inside a `nav` named "Filter by status".
- **Status values (IT):** In stock = SPARE, Deployed = DEPLOYED, On loan = TEMPORARY, In repair = DEFECTIVE, Missing =
  MISSING.
- **Purchasing class** gets its own five tiles from its statuses *(my call; the owner only ever saw IT)*:

  | Tile | Status | Caption |
  |---|---|---|
  | In use | OPERATIONAL | Working where it is |
  | Stored | STORED | Kept, ready to use |
  | Repairing | REPAIRING | Out for repair |
  | Lost | LOST | Custody lost |
  | Need attention | the attention predicate | Someone owes an action |

  Retired and Sold are closed states and get no tile.
- **Repairs view:** in the Repairs saved view (any `stage` set), the tiles are hidden. The stage chips already do that
  job, and combining a stage with a status can return nothing. *(My call.)*
- **New filter:** "Need attention" needs a real filter, not a sort. Add facet `attention` (value `"1"`) to
  `INVENTORY_LIST_CONFIG`, and make `buildAssetWhere` AND it with `attentionWhere(now)`. The count line's existing
  "N need attention" link keeps its current behaviour (`sort=attention`).

### 2.2 Toolbar (one row, sticky — see §4)
The class pills and the Repairs saved-view pill keep their current row above the tiles, unchanged. The filter row
becomes:

- **Search:** 300 px, with the current placeholder and behaviour.
- **Category:** the existing facet.
- **More filters:** a popover holding the remaining facets: Status, Type, Assigned to, Provenance, Registration and
  Purchased.
  - Every facet keeps its existing component and URL param; they just move into the popover.
  - The button shows a count badge when any of them is set.
- **Columns:** the existing chooser.
- **On the right:** the existing count line ("900 assets · 64 need attention").

Removable filter chips stay where they are today (`ChipFilterRow`).

### 2.3 Columns
- **Default columns:** checkbox, **Tag**, **Serial number**, **Model**, **Category**, **Assigned**, **Status**, ⋯ (row
  menu, unchanged).
- **Serial number is new:** add `serial: string | null` to `AssetRow` / `LIST_INCLUDE`. It is shown mono 12.5 px, and
  "—" when empty.
- **Optional columns:** Registration, Purchased and Warranty move to the Columns chooser and are **off by default**.
  - In `COLUMN_PREF_KEYS["columns:inventory"]`, the default set becomes category, assigned and serial.
  - Saved preferences keep working. A user who already saved a set keeps exactly their set, plus Serial number if
    they have never seen it. *(My call: one-time migration in `getInventoryColumns`: when the saved array lacks
    `serial` and has no `serial:seen` marker, add `serial`.)*
- **Repair-only columns:** Stage and Down still appear when the repair stage filter is on.
- **Assigned:** the holder's name 13.5 px medium over the EMP number in mono 12 px, with no avatar. A hold shows the
  HOLD pill and "for {name}"; nobody shows "—".
- **Status:** the dot plus a sentence-case label 13 px medium. The attention reason sits on a 12 px muted second line,
  as today.
- **Tag:** an accent link, mono 12.5 px. Model is 13.5 px medium.

### 2.4 Bulk bar
The existing bulk bar keeps every action and rule. That covers selected-on-this-page versus all-matching, the
"Select all N matching" link (≤ `BULK_MAX`), Clear, Print labels, Export, Change status…, and Assign… (IT direct only).

- **Look:** it becomes a **floating bar** fixed at the bottom centre, raised 64 px so it clears the sticky footer.
- **Content:** "N selected" in mono, then the primary action and the rest as small buttons.
- **Behaviour:** it only appears when something is ticked.

## 3. Employees list (`/employees`)

### 3.1 Tabs (new, replace nothing on the server)
Underlined tabs above the toolbar, each with a count badge:

| Tab | Filter |
|---|---|
| All | none of the below |
| Client staff | kind = CLIENT |
| Internal staff | kind = INTERNAL |
| Leaving | employment = OFFBOARDING |
| Missing kit | the existing `gaps=1` |
| New this month | the new facet `joined=month` (joined on or after the 1st of this month, Manila time — the spike's `buildEmployeeWhere` addition) |

- **Counts:** each count is what that tab shows within the current search, Works for and leavers scope. Use the
  spike's count queries: `employeeFacetOptions(base)`, `listEmployees(base, true).total`, and a `count` for joined.
- **One tab at a time:** a tab clears the other tabs' filters.
- **Badges:** the Missing kit badge uses the attention colours and the Leaving badge the inflight colours. A selected
  tab's badge uses the accent colours.
- **Accessibility:** a `nav` named "Filter employees". Tabs are links with `aria-current="page"` on the selected one.
  (Links, not ARIA tabs, because each one is a URL.)

### 3.2 Toolbar (sticky — see §4)
- **Search:** flexible width up to 420 px, placeholder "Search name, EMP number, title or client".
- **Works for:** the existing facet.
- **On the right:**
  - **Clear filters**, only when a search, Works for or tab is set;
  - **"570 people"** with the number in bold;
  - **"· 30 leavers hidden"** as a link that shows leavers, which becomes "· leavers shown · Hide" once they are
    shown.
- **Removed from the toolbar:** the Staff and Employment facets and the Show leavers / Policy gaps only pills. The
  tabs and the leavers link replace them. Their URL params keep working, so old links still filter.

### 3.3 Columns
Checkbox, **Employee**, **Works for**, **Loadout**, **Items**, **Employment**, **Joined**, ›.

| Column | Shows | Sort |
|---|---|---|
| Employee | name 13.5 px medium over job title 12 px muted; no avatar, no EMP number | name |
| Works for | client or department name over "Client account" / "Internal department" 12 px muted | — |
| Loadout | "complete" (settled), "N missing" (attention, medium) or "no policy" (faint), 13 px | loadout |
| Items | count, right-aligned, tabular | — |
| Employment | dot plus "Active" / "Leaving" / "Offboarded" (labels from `EMPLOYMENT_LABEL`) 13 px medium | — |
| Joined | date, tabular | joinedAt |

- **M365 is removed.** It stays on the person's page.
- **Search** still matches EMP numbers.

### 3.4 Selection and bulk bar (new)
- **Selection:** a checkbox column with select-all-on-page (indeterminate when only some are ticked). Selection resets
  when the URL changes, by keying the table on the query string, as Inventory does.
- **Bulk bar:** the same floating bar as Inventory, with **Transfer…** (primary), **Export**, **Print IT forms** and
  **Clear**. Only admin and it_staff see the checkboxes and the bar, matching `canMutate`.
- **Transfer…** opens a dialog that reuses `transfer-dialog.tsx`'s fields (destination Works for, effective date,
  note).
  - It calls a new server action `bulkTransferEmployees(ids, input)`.
  - The action runs the same validation and writes as `transferEmployee`, for each person, in one transaction, capped
    at `BULK_MAX`.
  - **Titles:** each person keeps their own current title; the dialog has no title field. *(My call.)*
  - **All or nothing:** the action first checks every person. If anyone can't move (already in that group, offboarded,
    or the destination is archived), nothing is written. The dialog lists up to five blocked people with their reasons
    and says "Untick them and try again". *(My call.)*
  - **Offboarded people** shown via the leavers link have a disabled checkbox. They are never selectable for bulk
    actions.
  - Audit entries are one per person, exactly as for a single transfer.
- **Export** downloads the existing export with an `ids=` filter. Add `ids` support to `/employees/export`; when
  `ids` is present it overrides the list filters.
- **Print IT forms** opens a new page `/employees/forms?ids=…`.
  - It renders the existing Equipment accountability form (`employees/[id]/form`) once per person, with a page break
    between them and one Print button.
  - It is capped at `BULK_MAX` and refuses anything over the cap, the same way the label page does.
  - Factor the form body out of `employees/[id]/form/page.tsx` into a component both pages use.

### 3.5 Navigation
Wrap the page in `ListNavigationProvider` and `ListPendingRegion`, and switch pagination and the toolbar links to
`NavLink`, as on Inventory. The table then dims while the next page loads.

## 4. Shared list behaviour (both lists)

### 4.1 Type and spacing (from the spike's `h-parts.tsx`)
- **Cells:** 16 px horizontal padding, 20 px on the first and last cell.
- **Text:** primary text is 13.5 px. Second lines are 12 px muted sans. Mono is only for real codes: tag and serial
  at 12.5 px, EMP number at 12 px.
- **Headers:** 11 px uppercase with letter-spacing, in muted text.
- **Toolbar controls:** 36 px tall with 8 px gaps. There is 16 px between tiles or tabs, toolbar and table.

### 4.2 Zebra rows
- **New tokens:** add `--zebra` and `--row-hover` for light and dark: light `#f7f8fa` / `#f2f4f7`, dark
  `#1b1f26` / `#232831`. Expose them as `--color-zebra` and `--color-row-hover`.
  - The light hover is lighter than the spike's `#eef1f5`, which left muted text (`#667085`) at 4.39:1 on a
    hovered row; `#f2f4f7` gives 4.51:1 (final review, 2026-10-20).
- **Table prop:** add `striped` to `Table`. A striped table has no row dividers, every even body row on `bg-zebra`,
  and hover on `bg-row-hover`. A ticked row keeps `bg-accent-tint`.
  - A hovered row also shows a 2 px accent edge on its first cell (an inset shadow), because in light the hover
    tint barely differs from the zebra.
- **Scope:** only these two lists pass `striped`.

### 4.3 Sticky toolbar, header and footer
The window is the scroller, since the sidebar is `sticky top-0 h-dvh`. Use page-level sticky, not a nested scroll
box.

- **Toolbar:** the filter row is `sticky top-0` on `bg-canvas`. It gets a 1 px bottom border only while stuck
  (IntersectionObserver on a sentinel).
- **Column header:** `thead` sticks directly under the toolbar. The toolbar's height is measured with a
  ResizeObserver into `--list-sticky-top`, because the toolbar can wrap.
  - This needs the table wrapper to be `overflow-visible` at ≥ 1280 px and keep `overflow-x-auto` below.
  - Below 1280 px the header scrolls with the rows. This is accepted.
- **Footer:** the pagination row becomes a bar pinned to the bottom of the viewport while the list is on screen. It
  is `sticky bottom-0` on canvas at 95% with a backdrop blur and a top border, about 48 px tall. From left to right:
  - "Rows 1–25 of 900";
  - **Row size** (see §4.5);
  - **Rows per page** (25 / 50 / 100);
  - the existing `Pagination`.

  With one page it shows the rows line and the Row size control only.
- **Tiles and tabs:** they scroll away normally. Only the filter row sticks.

### 4.4 Rows per page
- **URL:** a new `per` param, allowed values 25, 50 and 100; default 25 (`ENTITY_PAGE_SIZE`), omitted from the URL
  when 25.
- **Inventory:** `listAssets` takes it.
- **Employees:** `listEmployees` takes it too. Thread a `pageSize` argument through `pageEmployees` and its callers.
- **Exports:** export ignores it.
- **Changing the value** resets to page 1.

### 4.5 Row sizes: Comfortable, Compact, Dense
The app's density setting gains a third value. The `br.density` cookie and the `data-density` attribute on `<html>`
can now be `comfortable`, `compact` or `dense`.

- **These two lists:**

  | Size | Body rows | Header |
  |---|---|---|
  | Comfortable | 56 px | 40 px |
  | Compact | 48 px | 32 px |
  | Dense | 36 px, one line | 32 px |

  Express the heights from the tokens: comfortable/compact use `calc(var(--row-h) + 15px)`, and Dense sets its own
  `--list-row-h: 36px`.
- **Every other table** in the app treats `dense` like `compact` (`--row-h: 33px`).
- **Controls:**
  - The footer's Row size segmented control sets all three values.
  - The top-bar button keeps toggling Comfortable ↔ Compact. When Dense is on, it reads "Comfortable" and switches to
    Comfortable.
  - Both go through the existing `setDensity` setter, exported from `density-toggle.tsx` as in the spike.
- **Dense collapses every two-line cell to one line:**
  - Assigned: name, then the EMP number muted on the same line. A hold is the HOLD pill plus "for {name}".
  - Status: the dot plus the label. When there is an attention reason, a 6 px attention-coloured dot follows the
    label, and the reason goes into the row's `title` and a visually hidden description.
  - Employee: name, then the job title muted on the same line; the title truncates first.
  - Works for: the name only, with the kind in `title`.
  - Text is 13 px with 12 px cell padding (16 px at the edges), and truncates with `title`.

## 5. Tests

- **Unit (vitest):**
  - url-state `per` parsing (bounds, default omitted);
  - the inventory `attention` facet in `buildAssetWhere`;
  - `joined=month` in `buildEmployeeWhere`;
  - the tab and tile href builders, including that one is pressed at a time;
  - `getInventoryColumns` default and the serial one-time add;
  - density cookie parsing of `dense`;
  - `bulkTransferEmployees` validation (cap, empty, all-or-nothing) against the test DB, the way other action tests do.
- **E2E updates** (existing specs that assert old columns or text, listed in the code map). Specs that find cells by
  position move to header-name lookups:
  - `employee-ux.spec.ts` (td positions, count text);
  - `leftovers.spec.ts:78` (EMP in the first cell; becomes the search-by-EMP path);
  - `it-nav.spec.ts:490`;
  - `paging.spec.ts:321`;
  - `inventory-ux.spec.ts` (count line, cells, menus);
  - `phase-40-assets.spec.ts` (Columns);
  - `finance-registration-depreciation.spec.ts` (Registration header, now off by default: the spec turns it on via
    Columns first);
  - `directory.spec.ts`, `import-export.spec.ts` and `it-core.spec.ts` (Show leavers / Policy gaps links, which become
    the leavers link and the Missing kit tab).
- **New e2e** (`e2e/phase-45-lists.spec.ts`):
  - tiles and tabs filter and count;
  - the sticky header and footer stay in view after scrolling (bounding boxes);
  - Rows per page;
  - Row size including Dense one-line;
  - Employees bulk Export / Print IT forms / Transfer of two people;
  - zebra on even rows (computed background differs);
  - axe on both lists in light and dark.
- **Batteries** follow the usual rules: foreground, `--workers=1`, chunks of ≤ 7 files, axe alone, reseed first and
  last, port 3100.

## 6. What's left to the builder
- **Exact component split:** keep the spike's `CountTiles`, `BulkBar`, `HTh`, `H_*` constants and `hRowClass` ideas,
  but move them to `src/components/patterns/` (`count-tiles.tsx`, `floating-bulk-bar.tsx`, `list-tabs.tsx`,
  `sticky-list.tsx`) rather than copying spike files.
- **Popover component** for More filters: reuse the existing menu/popover pattern (`FacetDropdown`'s shell) if it
  fits.
- **Cap message wording** for Print IT forms, which follows the label page's.

## 7. Numbering
This becomes **Phase 45**. The client-staff and people-flows phase moves to **Phase 46**, and deeper asset
management to **Phase 47** (HANDOVER notes the change).
