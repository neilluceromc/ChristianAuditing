# Phase 42 — Sidebar that stays put, with views: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the desktop sidebar to the viewport and replace the 5-heading link lists with about 10 icon links per
workspace. The current link reveals a fixed set of views with live counts.

**Architecture:**
- **Data and rules:** the nav stays data in `src/lib/workspaces.ts`, reshaped so links carry an icon and optional
  views. A new pure matcher (`src/lib/nav-match.ts`) decides the current link and view from the path, the query
  and the role's default class.
- **Counts:** a server helper reads only the counts the visible nav needs. Pure helpers format the badge numbers
  and labels.
- **Rendering:** a presentational `NavTree` (renderable in tests) is wrapped by the client `NavList`, which reads
  the route. The desktop `Sidebar` becomes a sticky, full-height, inset panel.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6, Tailwind v4, vitest (node env, `renderToStaticMarkup`),
Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-18-sidebar-views-design.md` (read §3 and §4 before any task).

## Global Constraints

- **Links and roles:** every page reachable today stays reachable at the same URL. Every href a role can see in a
  workspace passes `pathAllowedForRole(href path, role)`.
- **Scrolling:** the window keeps scrolling. Never move page scrolling into an inner container
  (`e2e/no-long-scrolls.spec.ts` measures `document.documentElement.scrollHeight`).
- **Count labels** stay word for word: "{n} waiting on the worklist", "{n} open approvals" (+ ", some past SLA"),
  "{n} waiting for IT". New ones: "{n} spare", "{n} in repair", "{n} missing", "{n} leaving", "{n} drafts",
  "{n} awaiting IT", "{n} awaiting finance".
- **Count accuracy:** a view's count equals the row count of its own URL. Use `buildAssetWhere` and
  `purchaseWhere` exactly as the pages do.
- **Product aria-labels** never contain a nearby field's label word.
- **They/them** for people in copy.
- **Motion:** none under `prefers-reduced-motion`.
- **Files are CRLF + UTF-8:**
  - edit with the Edit tool, or with Python using `encoding="utf-8", newline=""`;
  - never `sed -i`;
  - never `prisma format`;
  - no migration in this phase.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Git:** never amend, stash, checkout, restore, reset or switch. Commit by path.
- **Tooling:**
  - never read `.env`;
  - the dev server, if ever needed, is `npm run dev -- -p 3100` (never 3000);
  - no Playwright runs per task. Browser tests run once at the end (the battery).
- **Unit test command:** `npx vitest run <files>`. The whole suite is `npx vitest run`. Types: `npx tsc --noEmit`.
  Lint: `npm run lint`.

## Review Focus

1. **A record page under a list** (`/inventory/<id>`, `/employees/<id>`, `/purchases/<id>`, `/stock/items/<id>`)
   must make its link current, with views shown and no view highlighted (or the right sub-page, for Stocktakes).
   Covered in Task 2's tests.
2. **An admin in Purchasing on bare `/inventory`** (default class IT) must land on "IT inventory", not on nothing.
   A purchasing_staff user on bare `/inventory?sort=tag` must land on "Purchasing assets". Task 2.
3. **A viewer** must never see Register assets, Purchase reviews, Asset categories, Asset types or
   Departments & clients. Their Setup goes straight to Equipment policies, and their Approvals badge keeps the old
   wording. Tasks 1 and 3.
4. **A short window, or a zoomed-in browser,** must scroll the nav inside the panel with the account row still
   visible. The current link must be scrolled into view on load. Task 4 (and e2e case 7).
5. **Seeded purchase reviews** change IT's Approvals badge number. Existing e2e that read it must be updated to
   the new rule, not deleted. Task 5.

---

### Task 1: The nav model, role visibility, and the non-visual consumers

**Files:**
- Modify: `src/lib/workspaces.ts` (the types, `WORKSPACE_NAV`, and `filterSectionsForRole` moved in; delete
  `navIsActive` and `ownedParamsFor`)
- Modify: `src/components/shell/sidebar.tsx` (remove `filterSectionsForRole` from it)
- Modify: `src/app/(app)/layout.tsx` and `src/app/(app)/page.tsx` (import `filterSectionsForRole` from
  `@/lib/workspaces`)
- Modify: `src/lib/shell.ts` (`navLabelFor` considers views)
- Modify: `src/components/home/jump-to.tsx` and `src/components/shell/command-palette.tsx` (the new shape)
- Modify: `src/components/ui/icon.tsx` (new icon names, so the nav data type-checks)
- Test: `src/lib/workspaces.test.ts` (rewrite the shape tests) and `src/lib/shell.test.ts`

**Interfaces:**
- Produces, in `src/lib/workspaces.ts`:

```ts
export type CountKey =
  | "worklist" | "approvals" | "purchaseReviews"
  | "itSpare" | "itDefective" | "itMissing" | "leaving"
  | "prDraft" | "prSubmitted" | "prItReviewed";

export interface NavView {
  label: string;
  href: string;
  roles?: Role[];
  count?: CountKey;
  /** match on these params instead of the href's (Repairs: { status: "DEFECTIVE" }) */
  match?: Record<string, string>;
}
export interface NavItem {
  label: string;
  /** omitted → the first visible view's href */
  href?: string;
  icon: IconName;
  roles?: Role[];
  /** summed into one badge when the item is not current, or has no views */
  badge?: CountKey[];
  views?: NavView[];
}
export interface NavSection { heading: string; items: NavItem[] } // heading: internal name, never rendered

export interface VisibleItem { label: string; href: string; icon: IconName; badge: CountKey[]; views: NavView[] }
export interface VisibleSection { heading: string; items: VisibleItem[] }

export function filterSectionsForRole(sections: NavSection[], role: Role): VisibleSection[];
export const PAGE_DEFAULTS: Record<string, Record<string, string>>;
// { "/approvals": { tab: "open" }, "/reservations": { state: "ACTIVE" }, "/equipment-by-client": { tab: "client" } }
```

- Produces, in `src/components/ui/icon.tsx`, these new `IconName`s: `home`, `worklist`, `offboarding`,
  `reservations`, `reports`, `activity`, `setup`, `requests`, `suppliers`, `stock`, `depreciation`, `users`,
  `webhooks`, `flags`, `chevron`. Draw them in the file's existing style (18×18 viewBox, stroke).
- Produces `navLabelFor(pathname: string, sections: VisibleSection[]): string | null`. Its signature changes from
  `NavSection[]` to `VisibleSection[]`.

- [ ] **Step 1: Write the failing tests** in `src/lib/workspaces.test.ts`. Replace the old shape blocks
  (`:297-425`) and the `navIsActive` block (`:252-293`). Keep the `pathAllowedForRole` tests untouched.

```ts
const labels = (ws: WorkspaceId, role: Role) =>
  filterSectionsForRole(WORKSPACE_NAV[ws], role).map((s) => s.items.map((i) => i.label));
const item = (ws: WorkspaceId, role: Role, label: string) =>
  filterSectionsForRole(WORKSPACE_NAV[ws], role).flatMap((s) => s.items).find((i) => i.label === label)!;

it("IT shows ten links in three groups", () => {
  expect(labels("it", "it_staff")).toEqual([
    ["Home", "Inventory", "Employees", "Worklist", "Approvals"],
    ["Offboarding", "Reservations", "Reports"],
    ["Activity", "Setup"],
  ]);
});
it("Purchasing, Finance and Admin groups", () => {
  expect(labels("purchasing", "purchasing_staff")).toEqual([
    ["Home", "Requests", "Suppliers", "Stock", "Assets", "Approvals", "Employees"],
    ["Activity", "Setup"],
  ]);
  expect(labels("finance", "finance_staff")).toEqual([
    ["Home", "Assets", "Depreciation", "Approvals", "Purchases", "Suppliers", "Stock"],
    ["Reports"],
    ["Activity"],
  ]);
  expect(labels("admin", "admin")).toEqual([["Home"], ["Users & roles"], ["Webhooks", "Feature flags"]]);
});
it("views are the spec §3 sets, in order", () => {
  expect(item("it", "it_staff", "Inventory").views.map((v) => v.label)).toEqual(["All", "Spare", "Repairs", "Missing", "Register assets"]);
  expect(item("it", "it_staff", "Approvals").views.map((v) => v.href)).toEqual(["/approvals", "/approvals?tab=mine", "/purchases?state=SUBMITTED", "/approvals?tab=closed"]);
  expect(item("it", "it_staff", "Setup").href).toBe("/admin/asset-categories");
  expect(item("purchasing", "purchasing_staff", "Requests").views.map((v) => v.label)).toEqual(["All", "My drafts", "Awaiting IT", "Awaiting finance", "Completed", "Register purchase"]);
  expect(item("purchasing", "purchasing_staff", "Stock").views.map((v) => v.href)).toEqual(["/stock", "/stock/receive", "/stock/issue", "/stock/stocktakes", "/stock/reports", "/stock/import"]);
});
it("a viewer: no write views, Setup goes straight to Equipment policies", () => {
  expect(item("it", "viewer", "Inventory").views.map((v) => v.label)).toEqual(["All", "Spare", "Repairs", "Missing"]);
  expect(item("it", "viewer", "Approvals").views.map((v) => v.label)).toEqual(["Open", "Mine", "Closed"]);
  const setup = item("it", "viewer", "Setup");
  expect(setup.href).toBe("/admin/equipment-policies");
  expect(setup.views).toEqual([]);
});
it("single-view links collapse: Purchasing Activity is a plain link", () => {
  expect(item("purchasing", "purchasing_staff", "Activity")).toMatchObject({ href: "/purchases/activity", views: [] });
});
it("every href a role can see passes pathAllowedForRole", () => {
  for (const role of ROLES) for (const ws of ROLE_WORKSPACES[role])
    for (const s of filterSectionsForRole(WORKSPACE_NAV[ws], role)) for (const i of s.items)
      for (const href of [i.href, ...i.views.map((v) => v.href)])
        expect(pathAllowedForRole(href.split("?")[0], role), `${role} ${ws} ${href}`).toBe(true);
});
it("PURCHASE_TABS still match the Requests views", () => {
  const views = item("purchasing", "purchasing_staff", "Requests").views;
  for (const id of ["SUBMITTED", "IT_REVIEWED"] as const) {
    const tab = PURCHASE_TABS.find((t) => t.id === id)!;
    expect(views.find((v) => v.href === tab.href)?.label).toBe(tab.label);
  }
});
```

  In `src/lib/shell.test.ts`, rewrite the fixture to `VisibleSection[]` with views, and assert:
  - `navLabelFor("/admin/asset-types", it)` is `"Asset types"`;
  - `navLabelFor("/inventory/abc123/history", it)` is `"Inventory"`;
  - `navLabelFor("/inventory/work", it)` is `"Worklist"`;
  - `navLabelFor("/inventoryx", it)` is `null`.

- [ ] **Step 2: Run** `npx vitest run src/lib/workspaces.test.ts src/lib/shell.test.ts`. Expect FAIL (the new
  exports are missing).

- [ ] **Step 3: Implement** spec §3 exactly in `WORKSPACE_NAV`.
  - **Icons:** IT Inventory and Purchasing/Finance Assets use `inventory`, Employees uses `employee`, Approvals uses
    `approval`, and the rest use the new names. Give Home `home`.
  - **Repairs:** `match: { status: "DEFECTIVE" }`.
  - **IT Approvals:** `badge: ["approvals", "purchaseReviews"]`. Worklist: `badge: ["worklist"]`. Finance Purchases:
    `badge: ["prItReviewed"]`. Purchasing and Finance Approvals: `badge: ["approvals"]`.
  - **`filterSectionsForRole`:**
    1. drop items and views the role can't see;
    2. drop items left with no href and no views;
    3. set `href` to the first visible view when the item has none;
    4. set `views` to `[]` when one or fewer remain (that single view's href becomes the item's href);
    5. drop empty sections.
  - **`navLabelFor`:** keeps its longest-prefix rule over items' and views' paths.
  - **`JumpTo`:** top-level items minus `/`, first 10.
  - **Command palette:** flatten items and views, role-filtered (views carry `roles`), de-duplicated by href.

- [ ] **Step 4: Run** `npx vitest run src/lib && npx tsc --noEmit`. Expect PASS. `nav-list.tsx` will still
  reference `navIsActive`: stub it to compile by temporarily rendering items flat with no active state. Task 4
  replaces it.

- [ ] **Step 5: Commit**:

```bash
git commit -m "feat(nav): Phase 42 nav model — icon links with views, role visibility, one-view collapse" -- <files>
```

---

### Task 2: The matcher — current link and current view

**Files:**
- Create: `src/lib/nav-match.ts`
- Test: `src/lib/nav-match.test.ts`

**Interfaces:**
- Consumes: `VisibleSection`, `PAGE_DEFAULTS` (Task 1); `AssetClass` from `@prisma/client`.
- Produces:

```ts
export interface NavCurrent { item: string | null; view: string | null } // labels; unique within a workspace
export function currentNav(sections: VisibleSection[], pathname: string, search: URLSearchParams, defaultCls: AssetClass): NavCurrent;
```

- [ ] **Step 1: Write the failing tests.** Build the sections with
  `filterSectionsForRole(WORKSPACE_NAV[ws], role)`. Each case is `[ws, role, url] → {item, view}`:

| ws | role | url | item | view |
|---|---|---|---|---|
| it | it_staff | `/inventory` | Inventory | All |
| it | it_staff | `/inventory?page=2&q=dell&sort=tag&purchaseYear=2024` | Inventory | All |
| it | it_staff | `/inventory?status=SPARE&sort=tag` | Inventory | Spare |
| it | it_staff | `/inventory?status=DEFECTIVE&sort=tag,defectiveSince` | Inventory | Repairs |
| it | it_staff | `/inventory?status=SPARE,MISSING` | Inventory | null |
| it | it_staff | `/inventory?category=x` | Inventory | All |
| it | it_staff | `/inventory/abc` | Inventory | null |
| it | it_staff | `/inventory/register` | Inventory | Register assets |
| it | it_staff | `/inventory/work` | Worklist | null |
| it | it_staff | `/inventory/activity` | Activity | Inventory activity |
| it | it_staff | `/admin/asset-types` | Setup | Asset types |
| it | viewer | `/admin/equipment-policies` | Setup | null |
| it | it_staff | `/approvals?tab=open` | Approvals | Open |
| it | it_staff | `/approvals?tab=failed` | Approvals | null |
| it | it_staff | `/purchases?state=SUBMITTED` | Approvals | Purchase reviews |
| it | it_staff | `/reservations?state=ACTIVE` | Reservations | Active |
| it | it_staff | `/equipment-by-client` | Reports | By client |
| it | it_staff | `/equipment-by-client?tab=internal` | Reports | Internal teams |
| it | it_staff | `/employees/abc` | Employees | null |
| it | it_staff | `/` | Home | null |
| it | it_staff | `/settings/cris` | null | null |
| purchasing | purchasing_staff | `/inventory?sort=tag` | Assets | Purchasing assets |
| purchasing | admin | `/inventory` | Assets | IT inventory |
| purchasing | purchasing_staff | `/inventory/xyz` | Assets | null |
| purchasing | purchasing_staff | `/purchases?state=CANCELLED` | Requests | null |
| purchasing | purchasing_staff | `/purchases?state=IT_REVIEWED` | Requests | Awaiting finance |
| purchasing | purchasing_staff | `/stock/stocktakes/xyz` | Stock | Stocktakes |
| purchasing | purchasing_staff | `/stock/categories` | Setup | Stock categories |

  Use `defaultClassFor(role)` from `@/lib/asset-class` for `defaultCls`.

- [ ] **Step 2: Run** `npx vitest run src/lib/nav-match.test.ts`. Expect FAIL.

- [ ] **Step 3: Implement `currentNav`** to spec §4.2.
  - **Current item:** the item with the longest path matched by its own href (path only) or any view, under these
    rules:
    - a view's path matches by prefix unless it equals the item's path, in which case it must match exactly;
    - `/` matches only `/`;
    - on a tie, the item with more matched view params wins.
  - **Current view:** among the views whose path matches and whose match params (`match ?? href params`) all equal
    the URL's, the one with the most params wins.
    - A param-less view wins only when none of these matched, and only if no *owned* param (any key in a sibling
      view's match params on the same path) is set to a non-default value. Use `PAGE_DEFAULTS[path]` to treat
      default values as absent.
  - **Implicit `cls`:** on `/inventory…` paths, when `search` has no `cls`, match as if it had
    `cls=defaultCls`.

- [ ] **Step 4: Run** the test again. Expect PASS.

- [ ] **Step 5: Commit**:

```bash
git commit -m "feat(nav): currentNav — the most specific link wins, views by match params, implicit cls" -- src/lib/nav-match.ts src/lib/nav-match.test.ts
```

---

### Task 3: Counts and badge labels

**Files:**
- Create: `src/lib/nav-badges.ts` (pure) and `src/server/modules/home/nav-counts.ts` (server)
- Modify: `src/app/(app)/layout.tsx` (compute the keys, read the counts, pass the new `NavBadges`)
- Modify: `src/components/shell/sidebar.tsx` (export `getApprovalsBadge` unchanged)
- Test: `src/lib/nav-badges.test.ts` and `src/server/modules/home/nav-counts.test.ts` (mock prisma, following
  `src/server/cris/pending.test.ts`)

**Interfaces:**
- Produces, in `src/lib/nav-badges.ts`:

```ts
export interface ApprovalsBadge { open: number; overdue: number } // moved here from nav-list.tsx
export interface NavBadges { approvals: ApprovalsBadge; counts: Partial<Record<CountKey, number>> }
export interface BadgeView { n: number; label: string; fault: boolean }
export function navCountKeys(sections: VisibleSection[]): CountKey[];          // unique; from item.badge and view.count
export function countBadge(key: CountKey, n: number, badges: NavBadges): BadgeView | null; // null when n === 0
export function itemBadge(item: VisibleItem, badges: NavBadges): BadgeView | null;   // sums item.badge
```

- Produces, in `src/server/modules/home/nav-counts.ts`:

```ts
export async function readNavCounts(keys: CountKey[], user: { id: string; role: Role }): Promise<Partial<Record<CountKey, number>>>;
```

  For each key:
  - `worklist`: `worklistCount`;
  - `purchaseReviews`: `purchaseReviewCount`;
  - `itSpare`, `itDefective`, `itMissing`: one `asset.groupBy` by status with
    `buildAssetWhere(stateWith({status}), null, "IT")`, or three counts. They must equal the page.
  - `leaving`: `employee.count` with `buildEmployeeWhere` for `employment=OFFBOARDING`;
  - `prDraft`, `prSubmitted`, `prItReviewed`: `purchaseRequest.groupBy` by state over
    `purchaseWhere(state, "")`.

  Every read catches its error, logs `console.error("[nav counts] <key> failed:", err)` and yields 0. The
  `approvals` key is fed from `getApprovalsBadge` (unchanged).

- [ ] **Step 1: Write the failing tests.**

```ts
it("labels each count", () => {
  expect(countBadge("itSpare", 7, b)?.label).toBe("7 spare");
  expect(countBadge("itDefective", 2, b)?.label).toBe("2 in repair");
  expect(countBadge("worklist", 15, b)?.label).toBe("15 waiting on the worklist");
  expect(countBadge("purchaseReviews", 1, b)?.label).toBe("1 waiting for IT");
  expect(countBadge("prDraft", 3, b)?.label).toBe("3 drafts");
  expect(countBadge("itMissing", 0, b)).toBeNull();
});
it("IT Approvals sums open approvals and purchase reviews", () => {
  const it = { label: "Approvals", badge: ["approvals", "purchaseReviews"] } as VisibleItem;
  expect(itemBadge(it, { approvals: { open: 3, overdue: 1 }, counts: { approvals: 3, purchaseReviews: 1 } }))
    .toEqual({ n: 4, label: "4 waiting: 3 open approvals, 1 purchase review, some approvals past SLA", fault: true });
  expect(itemBadge(it, { approvals: { open: 1, overdue: 0 }, counts: { approvals: 1, purchaseReviews: 0 } }))
    .toEqual({ n: 1, label: "1 open approvals", fault: false }); // today's wording, unchanged
  expect(itemBadge(it, { approvals: { open: 2, overdue: 1 }, counts: { approvals: 2 } })?.label)
    .toBe("2 open approvals, some past SLA"); // viewer: no purchaseReviews key
});
it("navCountKeys asks only for what the visible nav shows", () => {
  expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.it, "viewer")).sort())
    .toEqual(["approvals", "itDefective", "itMissing", "itSpare", "leaving", "worklist"]);
});
```

  - Keep "{n} open approvals" plural exactly as today (`nav-list.tsx:72`).
  - In `nav-counts.test.ts`, assert:
    - only the requested keys are queried;
    - a throwing query yields 0 for that key and the others still return;
    - the asset `where` passed is `buildAssetWhere(...)` with `cls: "IT"` and the status.

- [ ] **Step 2: Run** `npx vitest run src/lib/nav-badges.test.ts src/server/modules/home/nav-counts.test.ts`.
  Expect FAIL.

- [ ] **Step 3: Implement both files, then wire the layout.**
  1. `const keys = navCountKeys(sections)`.
  2. Fetch `getApprovalsBadge` only if `keys` includes `"approvals"`, else `{open: 0, overdue: 0}`.
  3. `readNavCounts(keys.filter((k) => k !== "approvals"), user)`.
  4. `badges = { approvals, counts: { ...counts, approvals: approvals.open } }`.
  5. Remove the old `worklist`/`purchaseReviews` fields and the reviewer-only branches. Role gating now comes from
     which keys the visible nav carries. Check: worklist and purchase reviews must stay admin/it_staff-only. The
     viewer can see Worklist (no roles on it), so `readNavCounts` must return `worklist: 0` for roles other than
     admin and it_staff, as today.

- [ ] **Step 4: Run** `npx vitest run src/lib src/server/modules/home && npx tsc --noEmit`. Expect PASS.

- [ ] **Step 5: Commit**:

```bash
git commit -m "feat(nav): view counts and the combined IT Approvals badge" -- <files>
```

---

### Task 4: The sticky inset sidebar and the nav tree

**Files:**
- Create: `src/components/shell/nav-tree.tsx` (presentational; no hooks)
- Modify: `src/components/shell/nav-list.tsx` (client wrapper: `usePathname`, `useSearchParams`, `currentNav`,
  scroll-into-view)
- Modify: `src/components/shell/sidebar.tsx` (sticky column, inset panel, brand row with the workspace tag,
  account row)
- Modify: `src/components/shell/workspace-switcher.tsx` (add `WorkspaceTag`; keep `WorkspaceOptions` unchanged for
  the drawer)
- Modify: `src/components/shell/mobile-nav.tsx` and `topbar.tsx` (pass `role`/`defaultCls` through for the
  matcher)
- Modify: `src/app/globals.css` (the scroll-shadow utility and the view fade-in keyframe, if not done in Tailwind)
- Test: `src/components/shell/nav-tree.test.tsx`

**Interfaces:**
- Consumes: `currentNav` (Task 2), `itemBadge` / `countBadge` / `NavBadges` (Task 3), `VisibleSection`, and the
  icons (Task 1).
- Produces:

```tsx
export function NavTree(props: { sections: VisibleSection[]; current: NavCurrent; badges: NavBadges; onNavigate?: () => void }): JSX.Element;
export function NavList(props: { sections: VisibleSection[]; badges: NavBadges; defaultCls: AssetClass; onNavigate?: () => void }): JSX.Element;
export function WorkspaceTag(props: { current: WorkspaceId; allowed: WorkspaceId[]; meta: WorkspaceMeta }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests** with `renderToStaticMarkup(<NavTree … />)`, using the IT sections for
  it_staff and `badges = { approvals: {open: 2, overdue: 1}, counts: { approvals: 2, purchaseReviews: 1, itSpare: 7, worklist: 15 } }`:
  - **`current = {item: "Inventory", view: "Spare"}`:**
    - the HTML contains Inventory's five view links;
    - the Spare link has `aria-current="page"` and the text `7` with `aria-label="7 spare"`;
    - the Inventory link has no `aria-current`;
    - no Employees view hrefs (`/employees?kind=CLIENT`) appear;
    - the Approvals link shows `3` with a label starting "3 waiting:";
    - there is no `<h3`;
    - the nav is `aria-label="Workspace"`.
  - **`current = {item: "Worklist", view: null}`:** the Worklist link has `aria-current="page"` and Inventory shows
    no views.
  - **`current = {item: "Approvals", view: "Purchase reviews"}`:** the Approvals item shows no badge; its views
    carry their own counts (`2`, `1`).
  - Every chevron svg is `aria-hidden="true"`.
  - **`WorkspaceTag`:** with one workspace it renders text `IT` and no `<button`. With four, a button whose
    accessible name contains `4 workspaces`.

- [ ] **Step 2: Run** `npx vitest run src/components/shell/nav-tree.test.tsx`. Expect FAIL.

- [ ] **Step 3: Implement to spec §4.1, §4.2 (rendering), §4.4 and §4.5.**
  - **Sidebar:**
    - `aside aria-label="Primary"`: `hidden lg:flex sticky top-0 h-dvh self-start shrink-0 p-2 pr-0`, wrapping the
      panel `flex w-[236px] flex-col rounded-[14px] border border-border bg-surface`;
    - the nav region is `min-h-0 flex-1 overflow-y-auto`, with the scroll-shadow background;
    - the account row stays as today.
  - **Root flex:** the layout's root flex is unchanged (`flex min-h-screen`); the window scrolls.
  - **Views:** a nested `<ul>` under the current item's `<li>` with the guide line, 30 px rows and the fade-in
    (`motion-safe:` only).
  - **NavList:**
    - computes `current` with `currentNav(sections, pathname, searchParams, defaultCls)`;
    - after mount, and whenever `current` changes, calls
      `el.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" })` on the nav element only;
    - the layout passes `defaultCls = defaultClassFor(user.role)` down through `Sidebar` and `Topbar` → `MobileNav`.
  - **Brand row:** logo, "Backroom IT", then `WorkspaceTag`. Delete the old boxed `WorkspaceSwitcher` usage from
    the sidebar, but keep `WorkspaceOptions` for the drawer.

- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run lint`. Expect PASS.

- [ ] **Step 5: Commit**:

```bash
git commit -m "feat(shell): sticky inset sidebar, icon links, views under the current link, workspace tag" -- <files>
```

---

### Task 5: Browser tests — update the old ones, write the new spec (not run here)

**Files:**
- Modify:
  - `e2e/auth-shell.spec.ts:85-102`
  - `e2e/it-core.spec.ts:235-254`
  - `e2e/purchases.spec.ts:48-63`
  - `e2e/phase-40-work.spec.ts:63-66`
  - `e2e/approvals-audit.spec.ts:149-161`
  - `e2e/home-finance.spec.ts:54-65,248-251`
  - `e2e/phase-40.spec.ts:289-315` (only if the drawer markup changed)
- Create: `e2e/phase-42-sidebar.spec.ts`

**Interfaces:** none produced. It consumes the rendered nav from Task 4.

- [ ] **Step 1: Update each old assertion so it keeps protecting the same behaviour.**
  - **`auth-shell`:**
    - the viewer has no "Asset categories" link;
    - the 4-workspace button (`/4 workspaces/`) → "Purchasing" → the nav has a "Requests" link (instead of the
      "Procurement" heading), including after reload;
    - the one-workspace tag reads "IT" and there is no `/workspaces?$/` button.
  - **`it-core`:**
    - a viewer on `/inventory` still sees no "Register assets" link;
    - for it_staff, the "Workspace" nav on `/inventory` has a "Register assets" view with href
      `/inventory/register`;
    - Purchasing's "IT inventory" is reached by visiting `/inventory?cls=PURCHASING` first, so the Assets views show.
  - **`purchases`:** visit `/purchases` so the Requests views show, then "Awaiting finance" (`aria-current="page"`
    after the click).
  - **`phase-40-work`:** visit `/approvals` first, so the `a[href="/purchases?state=SUBMITTED"]` view and its
    "{n} waiting for IT" badge are rendered.
  - **`approvals-audit`:** the IT Approvals badge is the open count plus the seeded purchase reviews, or the test
    runs where purchase reviews are 0. Assert the number with the Task 3 rule, and keep the "drops by one after an
    approval" step.
  - **`home-finance`:** the sidebar has no `h3` any more, but keep the `<main>` scoping. The "Primary" landmark
    still contains `/^\d+ waiting on the worklist$/`.

- [ ] **Step 2: Write `e2e/phase-42-sidebar.spec.ts`** with the eight cases in spec §5, using the existing helpers
  (`loginAs`, the seeded roles) as in `e2e/phase-41-cris.spec.ts`.
  - **Case 2:** read the Spare view's count, open its href, and compare with the page's own row count text.
  - **Case 7:** use `page.setViewportSize({ width: 1280, height: 600 })`. Assert that the nav's
    `scrollHeight > clientHeight` and that the account row's bounding box is inside the viewport.
  - **Case 8:** use the same axe helper as `e2e/axe-sweep.spec.ts`, at "moderate".

- [ ] **Step 3: Type-check the specs:** `npx tsc --noEmit -p tsconfig.json`. Do NOT run Playwright; the battery
  runs it at the end.

- [ ] **Step 4: Commit**:

```bash
git commit -m "test(e2e): Phase 42 sidebar — updated shell assertions and the new sidebar spec" -- <files>
```
