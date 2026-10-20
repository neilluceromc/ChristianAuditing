# Phase 46 — Overview home for every workspace, and one sidebar: design

**Date:** 2026-10-20 · **Status:** approved by the owner in chat ("lets do the overview … make the left side bar collapsable for every workspace and this left side bar should have similar style applied to purchasing finance and admin"; History → "Nightly snapshot"; Sidebar → "Yes, as shown") · **Branch:** `phase-46-home` · **Mockup:** artifact "Home Dashboards" (Overview + sidebar)

## 1. Why

Each workspace's Home is a few cards today, and they don't share a layout. The owner looked at five dashboard designs and picked **Overview** for every workspace:
- headline numbers with a trend line and the change since last week;
- what needs you, beside the main trend;
- the make-up and the biggest breakdown.

The owner also wants:
- **the sidebar collapsible** in every workspace;
- **Purchasing, Finance and Admin to use the IT sidebar's style**: links that open into views with counts.

### Goals
- **One Home layout:** every workspace uses the same Overview, filled with that workspace's numbers.
- **History behind the numbers:** each headline number has an 8-week trend and a "vs last week" change.
- **Collapsible sidebar:** an icon rail that is remembered, in every workspace.
- **One sidebar style:** every workspace's sidebar works the same way (views and counts).

### Non-goals
- No custom or draggable dashboards and no per-user widget choice.
- No phone redesign. The Overview stacks to one column below 1100 px.
- No new reports.

### Anti-goals
- A number on Home that disagrees with the page it links to.
- A sparkline or "vs last week" that is made up. While there is no history, say "collecting history".
- The sidebar changing look in IT. IT keeps its current structure; it only gains collapse and click-to-open.

## 2. Nightly snapshot (new)

### 2.1 Storage
- **Migration** `20261020090000_metric_snapshot` (migration 36) adds `MetricSnapshot`:
  - `id`, `day` (date, the Manila calendar day), `key` (string), `value` (BigInt; counts, or centavos for money), `createdAt`;
  - unique `(day, key)`, and an index on `key, day`.

### 2.2 Keys
| Key | Value |
|---|---|
| `it.spare` | IT spare assets |
| `it.deployed` | IT deployed assets |
| `it.defective` | IT defective assets (in repair) |
| `it.missing` | IT missing assets |
| `it.attention` | IT assets that need attention |
| `approvals.open.it` / `.purchasing` / `.none` | open approvals per class (`.none` = no asset) |
| `approvals.pastSla.it` / `.purchasing` / `.none` | approvals past their SLA, per class |
| `pr.submitted` | purchase requests awaiting IT |
| `pr.itReviewed` | purchase requests awaiting finance |
| `stock.low` | stock items below reorder |
| `stock.expiringLots` | stock lots expiring soon |
| `stock.stocktakesOverdue` | stocktakes past their close-by date |
| `fin.waitingC` | ₱ waiting on finance, in centavos |
| `fin.waitingCount` | requests waiting on finance |
| `fin.toConfirm.it` / `.purchasing` | registrations to confirm, per class |
| `fin.bookC` | book value, in centavos |
| `admin.activeUsers` | active accounts |
| `admin.disabled` | disabled accounts |
| `admin.deadDeliveries` | dead webhook deliveries |

Each key uses the existing query or count helper the live number comes from, so a snapshot and the live tile can never disagree. *Builder-check ruling:* approvals are stored per class, and the reader sums exactly the classes `approvalClassWhere` lets the viewer see, so the tile matches the Approvals page for every role.

### 2.3 Taking snapshots
- **Gate:** the worker gains `snapshotDue(lastDay, now)`, which is true when the Manila day of `now` differs from `lastDay`.
- **When it runs:** on worker start, and in the loop when the gate is true.
- **What it does:** upsert today's row for every key. It is idempotent: a second run on the same day overwrites.
- **Failures:** a failure is logged and retried on the next loop. It never crashes the worker.
- **Retention:** rows older than 400 days are pruned with the existing hourly prune.

### 2.4 Reading history
`metricHistory(keys, today)` returns, per key, the values at today-7·k days for k = 0…7.
- **No exact day:** if a day has no row, use the nearest earlier row within 3 days, otherwise null.
- **Delta:** the live value minus the value 7 days ago. When that is null the tile shows "collecting history".
- **Sparkline:** needs at least 2 non-null points. Until then it shows a flat dotted placeholder with "collecting history" as its label.

## 3. The Overview (all four workspaces)

### 3.1 Layout
The page keeps the "Hello, {first name}" header, the viewer pill and `FocusToggle`. Below it:

1. **KPI row: six tiles.** Each tile shows:
   - an 11 px uppercase label;
   - a 26 px value (₱ formatted for money);
   - an 84×28 sparkline of the 8 weekly points;
   - the delta ("▲ 8 vs last week", or "▲ 12%" for money). It is green, red or neutral depending on whether up is good for that tile, and always uses the arrow and words, never colour alone;
   - a one-line hint.

   The whole tile is a link to the page it counts.
2. **Row A:**
   - **"Needs you"**: up to 6 items, each with an icon, a title, a meta line and one action link. It uses each workspace's existing queue (see §3.2), with a "See all →" link.
   - **The workspace trend chart**: 12 points, up to 3 series. It has hover crosshair and tooltip, direct labels at the line ends, a legend, and a "Show table" toggle.
3. **Row B:**
   - **The make-up**: a stacked bar with a legend grid; each segment links to its filter.
   - **The ranked breakdown**: horizontal bars with values; each row links where a filter exists.

**Focus mode** (the existing `br.focus` cookie) shows only the KPI row and "Needs you".

**Below 1100 px** the rows stack. The KPI row is 3 columns from 560 px, and 2 below that.

### 3.2 Per workspace
Every number must equal its link target's count.

| Workspace | KPI tiles (link) | Needs you | Trend (dated, no snapshot needed) | Make-up | Breakdown |
|---|---|---|---|---|---|
| IT | Spare (`/inventory?status=SPARE`), Deployed, In repair (DEFECTIVE), Missing, Need attention (`?attention=1`), Approvals open (hint "N past SLA") | existing `worklist()` groups flattened by urgency + `claimedByYou` | Assigned / Returned / To repair per week from `AuditEntry` actions `lifecycle.assign`, `lifecycle.return`, `lifecycle.change-status` to DEFECTIVE | `fleet()` slices | people missing required kit by client (top 7 + "Internal teams") — new `kitGapsByGroup()` |
| Purchasing | Awaiting IT, Awaiting finance, Spend this month (₱; spark = weekly completed spend), Below reorder (`/stock?low=1`), Lots expiring, Stocktakes overdue | existing `purchasingHome().todo` + low stock + overdue stocktakes | Requests created / completed per week (`createdAt`, `completedAt`) | requests by state (`stateCounts`) | spend this month by supplier (top 7 + Other; rows are not links) — new `spendBySupplier()` |
| Finance | Waiting on you (₱), Requests waiting, Approved this month (spark = weekly approvals), Capitalized this month (₱; spark = weekly `financeConfirmedAt`), Book value (₱), To confirm (`/finance/assets?fin=with-finance`) | existing `financeHome().queue` + registrations to review | Capitalized ₱ per month (one series; `financeConfirmedAt` × cost, 12 months) | book value by category — new `bookValueByCategory()` | approved spend this quarter by department — new `spendByDepartment()` |
| Admin | Active accounts (`/admin/users?disabled=0`), Webhook deliveries failed (`/admin/webhooks/deliveries?state=DEAD`), Direct changes (7 days; no link), Flags on (x of y, no spark), Approvals open (`/approvals`, all classes), Disabled accounts (`/admin/users?disabled=1`) | failing endpoints, unavailable flags, disabled admins, dead deliveries | Direct changes per day by class (IT / Purchasing), 14 days (`Approval.appliedDirectly`, `resolvedAt`) | webhook deliveries in 7 days by status | accounts by role (`adminHome().users.byRole`) |

Where a tile's history has no snapshot key (because it is a dated number such as spend or approvals), its sparkline and delta come from the dated rows directly.

**Builder-check rulings (my calls):**
- **Month-to-date money tiles** (Spend, Approved, Capitalized this month):
  - The value is month-to-date in the **Manila** month. Use `monthStartManila`, and switch the existing month start to it too.
  - The sparkline is the last 8 **weekly totals**.
  - The delta compares **this week's total with last week's**, labelled "this week vs last week".
- **Finance "To confirm"** is split by class to match the one-class `/finance/assets` page. The tile sums IT and Purchasing, with the hint "N IT · N Purchasing", and links to the IT view. The sidebar has one view per class (§4.3).
- **Admin tile links:**
  - "Active accounts" links to `/admin/users?disabled=0`, a new filter alongside `?disabled=1`.
  - "Jobs waiting" is replaced by **Approvals open**; admin sees all classes.
  - "Direct changes" has no page that lists them, so it is not a link; noted as a follow-up.
- **Tiles without a link** render as a plain card, not a button.
- **Finance "Book value"** links to `/finance/depreciation`.

### 3.3 Charts
- Hand-made SVG; no chart library (the app has none).
- **Series colours** are new tokens `--chart-1/2/3`: light `#2563a8`, `#eb6834`, `#1baf7a` on white; dark `#3987e5`, `#d95926`, `#199e70` on `#171a20`. Both sets pass the palette validator; the light aqua is below 3:1, so direct labels and the table view are required, and both are provided.
- Thin 2 px lines, a 4 px end dot, and gridlines that recede.
- Text uses text tokens, never series colours.
- Status colours (ok/warn/bad) are reserved for status.

## 4. Sidebar

### 4.1 Collapse (every workspace)
- **Control:** a "Collapse sidebar" button at the bottom of the sidebar, above the account row. The `[` key does the same unless focus is in a field. The shortcut is added to the keyboard shortcuts dialog.
- **Remembered:** the state is kept in the cookie `br.sidebar=rail|full`, read in `(app)/layout.tsx` so the first paint is right.
- **The rail:** 72 px wide, icons only, with the workspace logo.
  - Badge counts become a small pill on the icon corner, red for `dot` badges.
  - Hover or keyboard focus on an icon opens a flyout with the link name and its views (with counts), as links.
  - Each icon has an accessible name.
- **Width:** the content area grows to the extra width, and the list pages' fits-the-card logic re-measures.
- **Mobile:** the drawer is unchanged.

### 4.2 Click to open
- The current link still opens its views automatically.
- The chevron becomes a separate toggle button (`aria-expanded`) that opens or closes any link's views without navigating.
- Opened state lasts for the session (sessionStorage) and is per workspace.
- An open link still hides its own badge, as today.

### 4.3 The same style everywhere: new views and counts

**Purchasing**

| Link | Views |
|---|---|
| Suppliers | add "Renewing soon" (new filter `?renewing=30`: `contractEnd` within 30 days; count `suppliersRenewing`) |
| Stock | add "Below reorder" (`/stock?low=1`; count `stockLow`); Stocktakes view shows the count `stocktakesOverdue` |
| Approvals | Open / Mine / Closed (existing URLs) |
| Employees | Everyone / Client staff (`?kind=CLIENT`) / Internal staff (`?kind=INTERNAL`) |

**Finance**

| Link | Views |
|---|---|
| Assets | All assets / To confirm · IT (`?fin=with-finance`; count `finToConfirmIt`) / To confirm · Purchasing (`?cls=PURCHASING&fin=with-finance`; count `finToConfirmPurchasing`) / Capitalized (`?fin=approved`) |
| Depreciation | Schedule / Policies (the existing tabs) |
| Approvals | Open / Mine / Closed |
| Suppliers | All suppliers / Active contracts (`?contract=ACTIVE`) / Expired contracts (`?contract=EXPIRED`) |
| Stock | Items / Stocktakes / Reports |

*My calls:* "Disposals to record" is dropped: Asset has no disposal value or date, and the page filters one status in one class at a time. "Bank details to verify" became contract views, because there is no verified field. "Book value / Monthly runs" became the existing Schedule/Policies tabs.

**Admin**

| Link | Views |
|---|---|
| Users & roles | All users / Disabled (new filter `?disabled=1`; count `usersDisabled`) |
| Webhooks | Endpoints / Failed deliveries (`/admin/webhooks/deliveries?state=DEAD`; count `deadDeliveries`, red dot) / All deliveries |
| Feature flags | All flags / Unavailable (new filter `?state=unavailable`; count `flagsUnavailable`) |
| New link "Audit log" | `/audit`, under a "records" group |

*My call:* "Invited, not signed in" is dropped, because there is no last sign-in field. A follow-up could add one.

**Count keys and rules**
- New `CountKey`s: `stockLow`, `stocktakesOverdue`, `suppliersRenewing`, `finToConfirmIt`, `finToConfirmPurchasing`, `usersDisabled`, `deadDeliveries`, `flagsUnavailable`.
- Each count reuses the page's own filter logic.
- `nav-counts.test.ts`'s rule (each count's href equals a view) covers the new keys.
- Role visibility follows `pathAllowedForRole` as today.

## 5. Tests
- **Unit:**
  - `snapshotDue` (Manila day boundary);
  - the snapshot key list (one per §2.2 key);
  - `metricHistory` (nearest-earlier within 3 days, nulls, delta);
  - the KPI delta tone (up-good vs up-bad, money percent);
  - the sparkline null placeholder;
  - each new filter's `where` (renewing, disabled, unavailable);
  - the new nav views and count keys in `workspaces.test.ts` and `nav-counts.test.ts`;
  - the `br.sidebar` cookie parse.
- **E2E** (new `e2e/phase-46-home.spec.ts`), for each workspace user (it@, purchasing@, finance@, admin@):
  - six KPI tiles render and each tile's value equals its target page's count;
  - "Needs you" items link correctly;
  - chart hover shows a tooltip, and "Show table" shows the table;
  - "collecting history" appears on a fresh database and disappears after seeding two snapshots;
  - collapse: the button and `[` toggle the rail, it survives a reload, the flyout lists views, and the badges show;
  - click-to-open a non-current link's views;
  - the new Finance and Admin views navigate to filtered pages whose row count equals the view count;
  - axe on each Home in light and dark, and on the rail.
- **Updated:** `home-finance.spec.ts` (card headings and order change to the Overview), `phase-42-sidebar.spec.ts` (structure plus collapse), `admin.spec.ts:331`, `it-nav.spec.ts:404` (the fleet legend link keeps its href).
- **Battery:** the usual rules (foreground, `--workers=1`, chunks of ≤ 4 files, axe alone, reseed first and last, port 3100).

## 6. Left to the builder
- Component split, suggested as `src/components/home/overview/` with `kpi-tile.tsx`, `sparkline.tsx`, `line-chart.tsx`, `make-up-bar.tsx`, `ranked-bars.tsx`, `needs-you.tsx`.
- Exact icon choices for the new admin link.
- Placeholder wording for an empty chart ("Nothing in this period").

## 7. Numbering
This is **Phase 46**. Client staff and people flows move to **Phase 47**, and deeper asset management to **Phase 48**.
