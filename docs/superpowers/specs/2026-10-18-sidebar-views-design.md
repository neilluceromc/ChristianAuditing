# Phase 42 — A sidebar that stays put, with fewer links and views under the page you're on

**Status:** CODE-COMPLETE 2026-10-18 on branch `phase-42-sidebar` (final code tree a21e289), awaiting the owner's merge/redeploy decision. APPROVED 2026-10-18 on the mockup canvas
(https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz, section "Sidebar that stays put", board **Sidebar · 12**,
with the Today card removed at the user's request; look from **Sidebar · 9**). The user chose a fixed set of views,
then said "write the spec and proceed until development". Merge, push and redeploy stay the user's calls.
**No migration.** Client staff moves to Phase 43 and deeper assets to Phase 44.

## 1. What the user asked for, and why

- **The problem** (a screenshot of `/inventory`, scrolled down): "when scrolling down I still need to scroll up to
  see the other buttons or functions". The sidebar is as tall as the page, so it scrolls away with the table.
- **"Too cluttered."** The IT sidebar has 17 links under 5 headings ("Overview", "Tracking", "People lifecycle",
  "Records & admin", "Activity logs"), and Purchasing has 25.
- **What the user chose,** after seeing 13 boards:
  - **Board 12:** ten links with icons and no headings. The page you're on opens a short list of **views** under
    it, joined by a thin guide line. Every other link stays one line.
  - **The look of board 9:** "modern but still sleek and not cluttered".
  - **A fixed set of views,** chosen by us per page. People cannot add their own.
- **What the user rejected:**
  - the Today card with a progress ring ("remove the today or progress ring");
  - new Setup and Activity hub pages (board 6, "I don't like the sidebar 6").

  So Setup and Activity are links whose views are the existing pages (§3).

## 2. Goals, non-goals, anti-goals

**Goals**
1. The sidebar never scrolls away. At any depth of any page, every link is one click away.
2. Fewer things on screen. IT goes from 17 visible links to 10, and the other workspaces follow the same rule (§3).
3. Every page reachable today is still reachable in at most two clicks from the sidebar, at the same URL.
   Bookmarks and QR labels are untouched.
4. Pages you visit often (Inventory, Employees, Purchases) get one-click views with live counts.

**Non-goals** (seen on the canvas, not chosen):
- shrink-to-icons;
- hover-peek;
- type-to-jump in the sidebar;
- pinned or user views;
- the "follows you into a record" sidebar;
- the phone bottom bar;
- a sticky top bar;
- a "+ New" button;
- the gliding highlight;
- Setup and Activity hub pages.

**Anti-goals** (failure even if it "works"):
- A link that a role could open today disappears for that role.
- A view whose count disagrees with the row count the page shows for that same view.
- A count that hides waiting work. Approvals must still say when purchase reviews are waiting (§4.3).
- The page scrolls differently: the window must keep scrolling, not an inner box. `e2e/no-long-scrolls.spec.ts`
  measures `document.documentElement.scrollHeight`.

## 3. What each workspace shows

Notation: **Link** `href` *(icon)* → views. A view list appears only while that link is the current one (§4.2).
`[count]` names a count from §4.3. `roles:` restricts a link or view exactly as `NavItem.roles` does today.
Groups are separated by spacing only and have no visible headings.

### 3.1 IT (admin, it_staff, viewer)

Group 1:
- **Home** `/` *(home)*
- **Inventory** `/inventory` *(inventory)* →
  - All `/inventory`
  - Spare `/inventory?status=SPARE` [itSpare]
  - Repairs `/inventory?status=DEFECTIVE&sort=defectiveSince` [itDefective]. For matching it counts as
    `status=DEFECTIVE` alone (§4.2), because the page is in repair mode whenever that is the only status.
  - Missing `/inventory?status=MISSING` [itMissing]
  - Register assets `/inventory/register` (roles: admin, it_staff)
- **Employees** `/employees` *(employee)* →
  - Everyone `/employees`
  - Client staff `/employees?kind=CLIENT`
  - Leaving `/employees?employment=OFFBOARDING` [leaving]
  - Policy gaps `/employees?gaps=1`
- **Worklist** `/inventory/work` *(worklist)*, badge [worklist]
- **Approvals** `/approvals` *(approval)*, badge [approvals + purchaseReviews] →
  - Open `/approvals` [approvals]
  - Mine `/approvals?tab=mine`
  - Purchase reviews `/purchases?state=SUBMITTED` [purchaseReviews] (roles: admin, it_staff)
  - Closed `/approvals?tab=closed`

Group 2:
- **Offboarding** `/offboarding` *(offboarding)* →
  - All `/offboarding`
  - Overdue `/offboarding?due=overdue`
  - Complete `/offboarding?progress=complete`
- **Reservations** `/reservations` *(reservations)* →
  - Active `/reservations`
  - Fulfilled `/reservations?state=FULFILLED`
  - Closed `/reservations?state=CLOSED`
- **Reports** `/equipment-by-client` *(reports)* →
  - By client `/equipment-by-client` (the page's default tab)
  - Internal teams `/equipment-by-client?tab=internal`

Group 3:
- **Activity** *(activity)* →
  - Inventory activity `/inventory/activity`
  - Employee activity `/employees/activity`
  - Audit log `/audit`
- **Setup** *(setup)* →
  - Asset categories `/admin/asset-categories` (roles: admin, it_staff)
  - Asset types `/admin/asset-types` (roles: admin, it_staff)
  - Departments & clients `/admin/departments` (roles: admin, it_staff)
  - Equipment policies `/admin/equipment-policies`

**Where the old links went:**
- Register assets → an Inventory view.
- Purchase reviews → an Approvals view.
- Equipment policies, Asset categories, Asset types, Departments & clients → Setup.
- Inventory activity, Employee activity, Audit log → Activity.
- Equipment by client → Reports.

### 3.2 Purchasing (admin, purchasing_staff)

Group 1:
- **Home** `/`
- **Requests** `/purchases` *(requests)* →
  - All `/purchases`
  - My drafts `/purchases?state=DRAFT` [prDraft]
  - Awaiting IT `/purchases?state=SUBMITTED` [prSubmitted]
  - Awaiting finance `/purchases?state=IT_REVIEWED` [prItReviewed]
  - Completed `/purchases?state=COMPLETED`
  - Register purchase `/purchases/new`
- **Suppliers** `/purchases/suppliers` *(suppliers)* →
  - All suppliers `/purchases/suppliers`
  - New supplier `/purchases/suppliers/new` (roles: admin, purchasing_staff)
  - Import suppliers `/purchases/suppliers/import` (roles: admin, purchasing_staff)
- **Stock** `/stock` *(stock)* →
  - Items `/stock`
  - Receive stock `/stock/receive` (roles: admin, purchasing_staff)
  - Issue stock `/stock/issue` (roles: admin, purchasing_staff)
  - Stocktakes `/stock/stocktakes`
  - Reports `/stock/reports`
  - Import items `/stock/import` (roles: admin, purchasing_staff)
- **Assets** `/inventory?cls=PURCHASING` *(inventory)* →
  - Purchasing assets `/inventory?cls=PURCHASING`
  - IT inventory `/inventory?cls=IT`
  - Register assets `/inventory/register` (roles: admin, purchasing_staff)
- **Approvals** `/approvals`, badge [approvals]
- **Employees** `/employees`

Group 2:
- **Activity** `/purchases/activity` *(activity)*
- **Setup** *(setup)* →
  - Asset categories `/admin/asset-categories`
  - Asset types `/admin/asset-types`
  - Stock categories `/stock/categories` (roles: admin, purchasing_staff)

### 3.3 Finance (admin, finance_staff)

Group 1:
- **Home** `/`
- **Assets** `/finance/assets` *(inventory)*
- **Depreciation** `/finance/depreciation` *(depreciation)*
- **Approvals** `/approvals`, badge [approvals]. The label was "PR approvals".
- **Purchases** `/purchases` *(requests)*, badge [prItReviewed] →
  - All purchases `/purchases`
  - Awaiting finance `/purchases?state=IT_REVIEWED` [prItReviewed]
  - Approved `/purchases?state=COMPLETED`
  - Cancelled `/purchases?state=CANCELLED`
- **Suppliers** `/purchases/suppliers`
- **Stock** `/stock`

Group 2:
- **Reports** `/equipment-by-client`, with the same two views as IT.

Group 3:
- **Activity** `/finance/activity`

### 3.4 Admin

- Group 1: **Home** `/`
- Group 2: **Users & roles** `/admin/users` *(users)*
- Group 3: **Webhooks** `/admin/webhooks` *(webhooks)* and **Feature flags** `/admin/flags` *(flags)*

### 3.5 Rules every workspace follows

- **Visibility:** a link with views is visible when at least one of its views is visible to the role.
- **Where a link points:** a link with no `href` of its own points at its first visible view.
- **One visible view:** when only one view is visible, the link shows no view list and points straight at that
  view. For example, a viewer's Setup is Equipment policies.
- **Allowed paths:** every href a role can see in a workspace passes `pathAllowedForRole` for that role. A unit
  test asserts this for every role × workspace × visible link and view.

## 4. Behaviour

### 4.1 The sidebar stays put

- **Desktop layout (`lg` and up):** the sidebar column is `position: sticky; top: 0; height: 100dvh` with
  `align-self: flex-start`. The window keeps scrolling, and the page's own `lg:sticky lg:top-4` cards are
  unaffected.
- **Inside the column,** top to bottom:
  1. the brand row: logo, "Backroom IT" and the workspace tag (§4.4);
  2. the nav, which takes the remaining height and scrolls by itself only when it doesn't fit;
  3. the account row: avatar, name, role and the account menu. It is always visible.
- **When the nav overflows,** a soft shadow at its top and bottom edges shows there is more. It uses pure CSS with
  local-attachment backgrounds and only shows while content is hidden on that side.
- **On load,** if the current link is outside the visible part of the nav, it is scrolled into view
  (`block: "nearest"`, no animation).
- **Below `lg`,** the sidebar stays hidden and the existing menu drawer shows the same nav, with the same
  structure and views.

### 4.2 The current link and its views

- **Choosing the current link:** the current link is the one whose own `href` or one of whose views matches the
  URL most specifically. "Matching" is defined like this:
  - A link's own path matches the URL path exactly or as a prefix at a `/` boundary. Home matches only `/`.
    Choosing the current link looks at paths only; params on the link's own href never disqualify it. So
    Purchasing's Assets (`/inventory?cls=PURCHASING`) is current on any `/inventory…` page, including records.
    *(Builder-check ruling: otherwise any sort or "Clear filters" click drops `cls` and empties the sidebar.)*
  - A view's path matches by prefix too, except when it equals its link's path; then it must match exactly. So
    `/inventory/abc` makes Inventory current but highlights no view, while `/stock/stocktakes/xyz` highlights
    Stocktakes.
  - A view whose href carries query params counts only if every one of them matches the URL.
  - Longer matched paths win. On a tie, more matched params win.
  - **Implicit `cls`:** on `/inventory` paths, a URL without `cls` is matched as if it carried the viewer's
    default class (`defaultClassFor(role)`), because the page drops `cls` from its own links when it is the
    default. The matcher therefore takes the role (or its default class) as an input. So purchasing_staff on
    bare `/inventory?sort=tag` is on Purchasing assets, and an admin in Purchasing on bare `/inventory` is on IT
    inventory.
  - **Examples:** `/inventory/work` → Worklist. `/inventory/activity` → Activity, view Inventory activity.
    `/admin/asset-types` → Setup, view Asset types. `/inventory?cls=IT` in Purchasing → Assets, view IT inventory.
- **Choosing the current view:**
  - Among the current link's views whose path matches, those whose params all match compete. The one with the
    most matching params wins.
  - **Match params:** a view's match params are its href's params, unless it declares its own. Repairs declares
    `status=DEFECTIVE` only, so a re-sorted Repairs page stays on Repairs.
  - **Owned params:** a param is *owned* on a path when some sibling view on that path matches on it (today
    `status` on `/inventory`, `tab` on `/approvals` and `/equipment-by-client`, `state` on `/purchases` and
    `/reservations`, `kind`, `employment` and `gaps` on `/employees`, `due` and `progress` on `/offboarding`,
    `cls` in Purchasing's Assets).
  - **Param-less views** (All, Open, Active, By client…) win when no other view matches, unless the URL sets an
    owned param to a value no sibling covers. Then no view is highlighted. This keeps today's "the bare list
    link yields" rule (`workspaces.test.ts`), now per view.
  - **Page defaults:** a value equal to the page's default is treated as absent, so the param-less view still
    wins: `tab=open` on `/approvals`, `state=ACTIVE` on `/reservations`, `tab=client` on `/equipment-by-client`.
  - **Examples:**
    - `/reservations?state=ACTIVE` → Active
    - `/inventory?status=SPARE&sort=tag` → Spare
    - `/inventory?status=DEFECTIVE&sort=tag` → Repairs
    - `/inventory?category=x` → All
    - `/inventory?status=SPARE,MISSING` → none
    - `/approvals?tab=failed` → none
    - `/purchases?state=CANCELLED` in Purchasing → none
    - bare `/equipment-by-client` → By client
- **What the current link shows:**
  - Its icon turns accent, and its text is `text-fg` and medium weight.
  - If it has views, they appear under it. Its badge is hidden (the views carry the counts) and its chevron
    points down.
  - If it has no views, it gets the chip highlight (below) and `aria-current="page"`.
- **What the current view shows:** the chip highlight, a 2 px accent mark on the guide line, and
  `aria-current="page"`.
- **Every other link** stays one line: its badge if it has one, and a right-pointing chevron if it has views.
- **Clicking:**
  - Clicking a link navigates to its `href`. There is no separate expand or collapse control: the views follow
    the route.
  - The chevron is decorative (`aria-hidden`).
  - Views render only for the current link, so Tab order never passes through hidden views.

### 4.3 Counts

- **What we count** (computed in `(app)/layout.tsx`):
  - **Existing:** `worklist`, `approvals` (`{open, overdue}`) and `purchaseReviews`.
  - **New:**
    - `itSpare`, `itDefective`, `itMissing`: IT-class assets with that status, using the same `where` the
      `/inventory` list builds for that view (`buildAssetWhere` with only `status` and `cls=IT`). The count must
      equal the page's row count for the same URL.
    - `leaving`: employees with `employment = OFFBOARDING`.
    - `prDraft`, `prSubmitted`, `prItReviewed`: purchase requests in that state, using the page's own
      `purchaseWhere`.
- **When we count:**
  - Only the keys that the current workspace's visible links and views use are computed, in parallel with the
    existing badges.
  - Each count fails to 0 with a `console.error`, like today's badges.
  - Counts refresh when the layout renders, as today's badges do. That timing is not changed.
- **How counts show:**
  - Mono, 11 px, `text-fg-muted`, right-aligned. A zero count is not shown.
  - **Red** (`--st-fault-text`, with a 6 px dot before the number) only for urgent counts: `approvals` when any is
    overdue.
- **The Approvals badge in IT** is the sum of `approvals.open` and `purchaseReviews`, so purchase reviews waiting
  for IT stay visible when Approvals is closed. *(Builder-check ruling on the wording:)*
  - When `purchaseReviews` is 0, or the role cannot see the Purchase reviews view (viewer), the badge is exactly
    today's: the number is `approvals.open` and the label is "{n} open approvals" plus ", some past SLA".
  - Otherwise the number is the sum, and the label is "{sum} waiting: {a} open approval(s), {b} purchase
    review(s)", plus ", some approvals past SLA" when any is overdue. Singular and plural follow the numbers,
    and the label keeps the words "open approval" so the existing `/open approval/` locators still find it.
  - It is red when any approval is overdue.
  - In Purchasing and Finance the Approvals badge stays `approvals.open`, with the existing
    "N open approvals" wording.
- **Accessibility:** every count has an `aria-label` that says what it counts. The existing labels stay word for
  word: "{n} waiting on the worklist", "{n} open approvals" (plus ", some past SLA"), "{n} waiting for IT".
  New views use "{n} spare", "{n} in repair", "{n} missing", "{n} leaving", "{n} drafts", "{n} awaiting IT" and
  "{n} awaiting finance".

### 4.4 The workspace tag

- **Placement:** the "IT · 1 workspace" box goes away. The workspace's name becomes a small tag at the right end
  of the brand row, with a 6 px accent dot and the label.
- **One workspace:** plain text, not a control.
- **More than one workspace:** a button that opens the existing `Menu`, listing the workspaces with a ✓ on the
  current one, exactly as today.
  - Its accessible name keeps "{n} workspaces", e.g. "Switch workspace — IT, 4 workspaces". `auth-shell.spec`
    clicks `/4 workspaces/`.
- **The menu drawer** keeps its own "Switch workspace" group unchanged (`phase-40.spec` asserts it).

### 4.5 Look

This follows board 9, using the app's existing tokens so light and dark both work.

- **Panel:**
  - Inset 8 px from the window's left, top and bottom.
  - 236 px wide, 14 px radius, `bg-surface`, a 1 px `border-border`, no shadow.
  - The page background (`bg-canvas`) shows around it.
- **Links:**
  - 36 px tall, 9 px radius, 10 px horizontal padding, 11 px between icon and label.
  - Icon 17 px in `text-fg-muted`; label 13 px in `text-fg-secondary`.
  - Hover: `bg-surface-subtle` and `text-fg`.
  - 2 px between links and 12 px between groups.
- **Chip highlight:** `bg-surface-subtle` plus a 1 px inset `border-border-strong` ring.
- **Views:**
  - Indented under the link: 19 px left margin, a 1 px `border-border-strong` guide line, 12 px padding.
  - 30 px tall, 12.5 px text, 8 px radius.
  - They fade in over 180 ms. There is no motion under `prefers-reduced-motion`.
- **Chevron:** 10 px, `text-fg-muted`, rotating 90° over 200 ms, also off under reduced motion.
- **Icons:** stroke icons added to `src/components/ui/icon.tsx` in its existing style (18×18 viewBox, 1.4 stroke):
  home, worklist, offboarding, reservations, reports, activity, setup, requests, suppliers, stock, depreciation,
  users, webhooks, flags and chevron. Inventory, employee and approval reuse the existing icons.
- **Density:** the Compact toggle does not change the sidebar.

### 4.6 Everything else that reads the nav

- **Command palette "Go to":** searches links and views by label, de-duplicated by href, so typing "Asset types"
  or "Audit log" still finds them. The role filter applies to views too.
- **Home "Jump to" card:** shows the top-level links except Home, up to 10, as today.
- **Phone top bar page name (`navLabelFor`):** considers views as well as links, and the longest prefix wins.
  `/admin/asset-types` reads "Asset types" and `/inventory/abc` reads "Inventory".
- **Active-link logic:** `navIsActive` and its "owned params" cache are replaced by the matching rules in §4.2.
  Existing behaviour that must survive:
  - `/inventory` stays current under `page`, `q`, `sort` and `purchaseYear`.
  - `/reservations` stays current under `state=ACTIVE`.
  - Purchasing's IT inventory and Purchasing assets views follow `cls`, with the implicit-`cls` rule.
  - A bare list link yields to a sibling's owned param (now per view, as in §4.2).

## 5. Testing

- **Unit tests:**
  - The nav definition for every role × workspace: the visible links and views in order, the
    `pathAllowedForRole` check from §3.5, and the one-visible-view rule.
  - The matching rules, with every example in §4.2 plus the surviving behaviour in §4.6.
  - `navLabelFor` with views; the command-palette flattening; the count keys each workspace asks for.
  - The Approvals sum label.
- **Existing tests:** update them where they assert the old structure: headings, "1 workspace", "Procurement",
  the Finance "Assets & depreciation" labels, the Stock and Records shapes in `workspaces.test.ts`, and the
  Approvals badge text when purchase reviews are seeded. Each update should keep the behaviour the test was
  protecting, not delete it.
- **New e2e** (`e2e/phase-42-sidebar.spec.ts`):
  1. On `/inventory`, scroll to the bottom; the "Primary" sidebar is still in the viewport and "Employees" can be
     clicked.
  2. On `/inventory`, Inventory's views show; Spare's count equals the row count `/inventory?status=SPARE` shows,
     and clicking it marks it `aria-current="page"`.
  3. On `/employees`, Inventory's views are gone and Employees' views show.
  4. `/admin/asset-types` shows Setup open, with Asset types current.
  5. A viewer sees Setup pointing at Equipment policies and no view list.
  6. Purchasing (admin, switched): Requests' views, with "Awaiting finance" current after a click. Assets → IT
     inventory works.
  7. At a short window (1280×600) the nav scrolls inside the sidebar, and the account row stays visible.
  8. axe passes on `/inventory` and `/purchases` in light and dark.
- **Battery:** the full chunked run at the end, as usual.

## 6. Left to the builder

- The exact SVG paths for the new icons.
- How the nav data is typed: groups as arrays, or keeping `NavSection` with an unused heading. Pick whichever
  keeps the call sites simplest.
- Whether counts live in one `navCounts(keys, role)` helper or alongside the existing badge reads.
- The CSS technique for the scroll shadows, within the rule in §4.1.
