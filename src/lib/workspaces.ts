import type { Role } from "@prisma/client";
import type { IconName } from "@/components/ui/icon";

export type WorkspaceId = "it" | "purchasing" | "finance" | "admin";

// Brief §2 — the role/workspace table, verbatim.
export const ROLE_WORKSPACES: Record<Role, WorkspaceId[]> = {
  admin: ["it", "purchasing", "finance", "admin"],
  it_staff: ["it"],
  purchasing_staff: ["purchasing"],
  finance_staff: ["finance"],
  viewer: ["it"],
};

export const ROLE_LANDING: Record<Role, string> = {
  admin: "/",
  it_staff: "/inventory",
  purchasing_staff: "/purchases",
  finance_staff: "/finance/assets",
  viewer: "/inventory",
};

export const WORKSPACE_META: Record<WorkspaceId, { label: string; landing: string }> = {
  it: { label: "IT", landing: "/inventory" },
  purchasing: { label: "Purchasing", landing: "/purchases" },
  finance: { label: "Finance", landing: "/finance/assets" },
  admin: { label: "Admin", landing: "/admin/users" },
};

/** A count the nav can show (Phase 42 spec §4.3). Task 3 reads them in the layout. */
export type CountKey =
  | "worklist" | "approvals" | "purchaseReviews"
  | "itSpare" | "itDefective" | "itMissing" | "leaving"
  | "prDraft" | "prSubmitted" | "prItReviewed";

/** One view under a link: shown only while that link is the current one (spec §4.2). */
export interface NavView {
  label: string;
  href: string;
  /** restrict the view to these roles, within an already-allowed workspace */
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
  /** restrict the link to these roles, within an already-allowed workspace */
  roles?: Role[];
  /** summed into one badge when the item is not current, or has no views */
  badge?: CountKey[];
  views?: NavView[];
}

/** A group of links. `heading` is an internal name only: groups are separated by spacing, never titled. */
export interface NavSection {
  heading: string;
  items: NavItem[];
}

/** A link as one role sees it: href resolved, views filtered (empty when one or none remain), badge trimmed. */
export interface VisibleItem {
  label: string;
  href: string;
  icon: IconName;
  badge: CountKey[];
  views: NavView[];
}

export interface VisibleSection {
  heading: string;
  items: VisibleItem[];
}

/**
 * A param value equal to the page's own default is treated as absent when matching views (spec §4.2), so the
 * param-less view still wins: `tab=open` on /approvals, `state=ACTIVE` on /reservations, `tab=client` on
 * /equipment-by-client.
 */
export const PAGE_DEFAULTS: Record<string, Record<string, string>> = {
  "/approvals": { tab: "open" },
  "/reservations": { state: "ACTIVE" },
  "/equipment-by-client": { tab: "client" },
};

const HOME: NavItem = { label: "Home", href: "/", icon: "home" };

// IT and Finance share the Phase 38 report and its two tabs (spec §3.3).
const REPORTS: NavItem = {
  label: "Reports",
  href: "/equipment-by-client",
  icon: "reports",
  views: [
    { label: "By client", href: "/equipment-by-client" },
    { label: "Internal teams", href: "/equipment-by-client?tab=internal" },
  ],
};

/**
 * Phase 42 spec §3: each workspace's links and the views under them, verbatim. `roles` on a link or view
 * restricts it exactly as it did before; every href a role can see must pass `pathAllowedForRole` (asserted in
 * workspaces.test.ts for every role and workspace).
 */
export const WORKSPACE_NAV: Record<WorkspaceId, NavSection[]> = {
  it: [
    {
      heading: "work",
      items: [
        HOME,
        {
          label: "Inventory",
          href: "/inventory",
          icon: "inventory",
          views: [
            { label: "All", href: "/inventory" },
            { label: "Spare", href: "/inventory?status=SPARE", count: "itSpare" },
            // The page is in repair mode whenever DEFECTIVE is the only status, whatever the sort.
            {
              label: "Repairs",
              href: "/inventory?status=DEFECTIVE&sort=defectiveSince",
              count: "itDefective",
              match: { status: "DEFECTIVE" },
            },
            { label: "Missing", href: "/inventory?status=MISSING", count: "itMissing" },
            // The one Register flow (Phase 30): the /inventory/register PATH_RULE's roles, minus purchasing,
            // who registers from its own workspace.
            { label: "Register assets", href: "/inventory/register", roles: ["admin", "it_staff"] },
          ],
        },
        {
          label: "Employees",
          href: "/employees",
          icon: "employee",
          views: [
            { label: "Everyone", href: "/employees" },
            { label: "Client staff", href: "/employees?kind=CLIENT" },
            { label: "Leaving", href: "/employees?employment=OFFBOARDING", count: "leaving" },
            { label: "Policy gaps", href: "/employees?gaps=1" },
          ],
        },
        { label: "Worklist", href: "/inventory/work", icon: "worklist", badge: ["worklist"] },
        {
          label: "Approvals",
          href: "/approvals",
          icon: "approval",
          // Spec §4.3: purchase reviews waiting for IT stay visible while Approvals is closed.
          badge: ["approvals", "purchaseReviews"],
          views: [
            { label: "Open", href: "/approvals", count: "approvals" },
            { label: "Mine", href: "/approvals?tab=mine" },
            // The `roles` key is the only thing keeping this out of a viewer's sidebar: every IT-workspace role
            // passes the /purchases path gate.
            {
              label: "Purchase reviews",
              href: "/purchases?state=SUBMITTED",
              count: "purchaseReviews",
              roles: ["admin", "it_staff"],
            },
            { label: "Closed", href: "/approvals?tab=closed" },
          ],
        },
      ],
    },
    {
      heading: "people",
      items: [
        {
          label: "Offboarding",
          href: "/offboarding",
          icon: "offboarding",
          views: [
            { label: "All", href: "/offboarding" },
            { label: "Overdue", href: "/offboarding?due=overdue" },
            { label: "Complete", href: "/offboarding?progress=complete" },
          ],
        },
        {
          label: "Reservations",
          href: "/reservations",
          icon: "reservations",
          views: [
            { label: "Active", href: "/reservations" },
            { label: "Fulfilled", href: "/reservations?state=FULFILLED" },
            { label: "Closed", href: "/reservations?state=CLOSED" },
          ],
        },
        REPORTS,
      ],
    },
    {
      heading: "records",
      items: [
        {
          label: "Activity",
          icon: "activity",
          views: [
            { label: "Inventory activity", href: "/inventory/activity" },
            { label: "Employee activity", href: "/employees/activity" },
            { label: "Audit log", href: "/audit" },
          ],
        },
        {
          // A viewer sees only Equipment policies, so their Setup is a plain link straight to it.
          label: "Setup",
          icon: "setup",
          views: [
            { label: "Asset categories", href: "/admin/asset-categories", roles: ["admin", "it_staff"] },
            { label: "Asset types", href: "/admin/asset-types", roles: ["admin", "it_staff"] },
            { label: "Departments & clients", href: "/admin/departments", roles: ["admin", "it_staff"] },
            { label: "Equipment policies", href: "/admin/equipment-policies" },
          ],
        },
      ],
    },
  ],
  purchasing: [
    {
      heading: "work",
      items: [
        HOME,
        {
          label: "Requests",
          href: "/purchases",
          icon: "requests",
          views: [
            { label: "All", href: "/purchases" },
            { label: "My drafts", href: "/purchases?state=DRAFT", count: "prDraft" },
            // Labels match PURCHASE_TABS (purchases-list.ts), asserted in workspaces.test.ts.
            { label: "Awaiting IT", href: "/purchases?state=SUBMITTED", count: "prSubmitted" },
            { label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED", count: "prItReviewed" },
            { label: "Completed", href: "/purchases?state=COMPLETED" },
            { label: "Register purchase", href: "/purchases/new" },
          ],
        },
        {
          label: "Suppliers",
          href: "/purchases/suppliers",
          icon: "suppliers",
          views: [
            { label: "All suppliers", href: "/purchases/suppliers" },
            { label: "New supplier", href: "/purchases/suppliers/new", roles: ["admin", "purchasing_staff"] },
            { label: "Import suppliers", href: "/purchases/suppliers/import", roles: ["admin", "purchasing_staff"] },
          ],
        },
        {
          // Phase 19/22: the read surfaces (Items, Stocktakes, Reports) carry no `roles`, matching the general
          // /stock PATH_RULE; the write surfaces match the Purchasing-only PATH_RULEs.
          label: "Stock",
          href: "/stock",
          icon: "stock",
          views: [
            { label: "Items", href: "/stock" },
            { label: "Receive stock", href: "/stock/receive", roles: ["admin", "purchasing_staff"] },
            { label: "Issue stock", href: "/stock/issue", roles: ["admin", "purchasing_staff"] },
            { label: "Stocktakes", href: "/stock/stocktakes" },
            { label: "Reports", href: "/stock/reports" },
            { label: "Import items", href: "/stock/import", roles: ["admin", "purchasing_staff"] },
          ],
        },
        {
          // Phase 30 (plan P-7): Purchasing's list opens on its own class, so the IT list names its class.
          label: "Assets",
          href: "/inventory?cls=PURCHASING",
          icon: "inventory",
          views: [
            { label: "Purchasing assets", href: "/inventory?cls=PURCHASING" },
            { label: "IT inventory", href: "/inventory?cls=IT" },
            { label: "Register assets", href: "/inventory/register", roles: ["admin", "purchasing_staff"] },
          ],
        },
        // Phase 14: Purchasing approves lifecycle changes on its own class and reads the directory.
        { label: "Approvals", href: "/approvals", icon: "approval", badge: ["approvals"] },
        { label: "Employees", href: "/employees", icon: "employee" },
      ],
    },
    {
      heading: "records",
      items: [
        { label: "Activity", href: "/purchases/activity", icon: "activity" },
        {
          // Phase 14: categories and types of Purchasing's own class, never departments.
          label: "Setup",
          icon: "setup",
          views: [
            { label: "Asset categories", href: "/admin/asset-categories" },
            { label: "Asset types", href: "/admin/asset-types" },
            { label: "Stock categories", href: "/stock/categories", roles: ["admin", "purchasing_staff"] },
          ],
        },
      ],
    },
  ],
  finance: [
    {
      heading: "work",
      items: [
        HOME,
        { label: "Assets", href: "/finance/assets", icon: "inventory" },
        { label: "Depreciation", href: "/finance/depreciation", icon: "depreciation" },
        { label: "Approvals", href: "/approvals", icon: "approval", badge: ["approvals"] },
        {
          label: "Purchases",
          href: "/purchases",
          icon: "requests",
          badge: ["prItReviewed"],
          views: [
            { label: "All purchases", href: "/purchases" },
            { label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED", count: "prItReviewed" },
            { label: "Approved", href: "/purchases?state=COMPLETED" },
            { label: "Cancelled", href: "/purchases?state=CANCELLED" },
          ],
        },
        { label: "Suppliers", href: "/purchases/suppliers", icon: "suppliers" },
        { label: "Stock", href: "/stock", icon: "stock" },
      ],
    },
    { heading: "reports", items: [REPORTS] },
    { heading: "records", items: [{ label: "Activity", href: "/finance/activity", icon: "activity" }] },
  ],
  admin: [
    { heading: "start", items: [HOME] },
    { heading: "access", items: [{ label: "Users & roles", href: "/admin/users", icon: "users" }] },
    {
      heading: "integrations",
      items: [
        { label: "Webhooks", href: "/admin/webhooks", icon: "webhooks" },
        { label: "Feature flags", href: "/admin/flags", icon: "flags" },
      ],
    },
  ],
};

const visibleTo = (role: Role) => (x: { roles?: Role[] }) => !x.roles || x.roles.includes(role);

/**
 * What one role sees of a workspace's nav (spec §3.5):
 * 1. links and views the role can't see are dropped;
 * 2. a link that had views and has none left is dropped, even with an href of its own;
 * 3. a link with no href of its own points at its first visible view;
 * 4. with one visible view or none, the link has no view list (one view: the link points straight at it);
 * 5. empty groups are dropped.
 * A badge key that some view of the link counts is kept only while a visible view still counts it (ruling R1),
 * so a viewer's IT Approvals badge never sums purchase reviews they cannot open.
 */
export function filterSectionsForRole(sections: NavSection[], role: Role): VisibleSection[] {
  const visible = visibleTo(role);
  return sections
    .map((section) => ({
      heading: section.heading,
      items: section.items.filter(visible).flatMap((item): VisibleItem[] => {
        const views = (item.views ?? []).filter(visible);
        // Spec §3.5: a link with views is visible only while at least one of its views is.
        if (item.views?.length && views.length === 0) return [];
        const href = views.length === 1 ? views[0].href : (item.href ?? views[0]?.href);
        if (!href) return [];
        const countedByAnyView = new Set((item.views ?? []).map((v) => v.count));
        const countedByVisibleView = new Set(views.map((v) => v.count));
        const badge = (item.badge ?? []).filter((k) => !countedByAnyView.has(k) || countedByVisibleView.has(k));
        return [{ label: item.label, href, icon: item.icon, badge, views: views.length > 1 ? views : [] }];
      }),
    }))
    .filter((section) => section.items.length > 0);
}

export function resolveWorkspace(role: Role, cookie: string | undefined): WorkspaceId {
  const allowed = ROLE_WORKSPACES[role];
  if (cookie && (allowed as string[]).includes(cookie)) return cookie as WorkspaceId;
  return allowed[0];
}

/**
 * Which workspaces may visit a path — the middleware's decision table.
 * Shares per brief §7: purchasing references /inventory; finance shares
 * /purchases and /approvals. Reference-data CRUD is additionally
 * role-restricted (viewer is IT-workspace but excluded).
 */
// Paths intentionally NOT workspace-gated — reachable by any authenticated
// user. Everything else MUST match a PATH_RULE or it is denied (default-deny).
const UNGATED: RegExp[] = [/^\/$/, /^\/dev(\/|$)/];

const PATH_RULES: Array<{ test: RegExp; workspaces: WorkspaceId[]; roles?: Role[] }> = [
  { test: /^\/admin\/(users|webhooks|flags)(\/|$)/, workspaces: ["admin"] },
  // Phase 14: each department creates categories and types of its OWN class
  // (reference-actions.ts forces the class from MANAGEABLE_CLASSES). Departments
  // are org structure, not class data, and stay IT.
  {
    test: /^\/admin\/(asset-categories|asset-types)(\/|$)/,
    workspaces: ["it", "purchasing"],
    roles: ["admin", "it_staff", "purchasing_staff"],
  },
  { test: /^\/admin\/departments(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  { test: /^\/admin\/equipment-policies(\/|$)/, workspaces: ["it"] },
  // Backstop: any unlisted /admin/* route is admin-only, never default-allow.
  { test: /^\/admin(\/|$)/, workspaces: ["admin"] },
  // Credential exposure (SECRET_READ-audited GET) — IT workspace only, so a
  // purchasing user who can reference the inventory list can't reach /secrets.
  // MUST precede the general /inventory rule (first-match-wins).
  { test: /^\/inventory\/[^/]+\/secrets(\/|$)/, workspaces: ["it"] },
  // Import writes up to 2,000 assets plus an audit row each — MUST precede
  // the general /inventory rule (first-match-wins), exactly like the
  // /secrets rule above, for the same reason: the general rule below admits
  // viewer, purchasing_staff and finance_staff, none of whom may reach this
  // write surface. `roles` additionally excludes viewer even within the IT
  // workspace it shares with /admin/asset-categories and friends.
  { test: /^\/inventory\/import(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  // Same shape and same reason as /inventory/import's rule directly above:
  // this MUST precede the general /inventory rule (first-match-wins), because
  // that rule admits purchasing and finance, and a label sheet is an IT
  // artifact. The ORDERING is asserted only in workspaces.test.ts — the
  // page at /inventory/labels carries its own requireRole("admin",
  // "it_staff") which redirects finance/purchasing/viewer to that same
  // role's ROLE_LANDING, so an e2e hitting that page still "passes" even if
  // this rule is deleted or moved after the general rule below. The one e2e
  // that actually observes THIS layer is the /inventory/labels/no-such-page
  // probe in e2e/labels.spec.ts, precisely because no page file exists there
  // for requireRole to run from — only middleware can answer for a path like
  // that, so a misordered rule shows up as a 200 with no redirect at all.
  // Phase 14: a label sheet is each class's own artifact; the page prints only
  // the classes the role manages. Still MUST precede the general /inventory rule.
  { test: /^\/inventory\/labels(\/|$)/, workspaces: ["it", "purchasing"], roles: ["admin", "it_staff", "purchasing_staff"] },
  // Phase 13: registering is each department's own — IT registers IT-class
  // categories, Purchasing registers Purchasing-class ones — so BOTH
  // workspaces are admitted here and `registerAssets` refuses the wrong class
  // by name. This MUST still precede the general /inventory rule below,
  // because that rule admits finance and viewer, and neither registers
  // anything. The ORDERING is asserted only in workspaces.test.ts.
  { test: /^\/inventory\/register(\/|$)/, workspaces: ["it", "purchasing"], roles: ["admin", "it_staff", "purchasing_staff"] },
  // Same treatment as /inventory/register (spec §5): a write surface stops
  // finance and viewer at layer 1, not only at the page's requireRole.
  { test: /^\/inventory\/new(\/|$)/, workspaces: ["it", "purchasing"], roles: ["admin", "it_staff", "purchasing_staff"] },
  // Phase 15: the worklist is IT-workspace only — viewer shares that
  // workspace read-only, but purchasing and finance, who both share the
  // general /inventory rule right below, are excluded. MUST precede that
  // general rule (first-match-wins), same shape as /inventory/import,
  // /inventory/labels and /inventory/register above.
  { test: /^\/inventory\/work(\/|$)/, workspaces: ["it"] },
  // Finance joins IT and purchasing here because /finance/assets is a register
  // of these very records — a capitalized-asset row whose tag leads nowhere is
  // a dead end on the page built for that role. The secrets rule above still
  // precedes this one, so finance gains the record, never the credentials.
  { test: /^\/inventory(\/|$)/, workspaces: ["it", "purchasing", "finance"] },
  // Task 12, E-7: the W-1 trap exactly. The general /employees rule below
  // has NO `roles` key at all, so `viewer` — whose workspaces are `["it"]`,
  // same as it_staff — passes it. Import writes up to 2,000 employees plus
  // an audit row each, the identical write-surface hazard `/inventory/
  // import` already guards above; this MUST precede the general rule
  // (first-match-wins), for the same reason.
  { test: /^\/employees\/import(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  // Phase 14: the two other employee WRITE surfaces get the same treatment,
  // because the general /employees rule right after them now admits
  // purchasing (reads only). Both MUST precede it.
  { test: /^\/employees\/new(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  { test: /^\/employees\/[^/]+\/edit(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  // Phase 14: purchasing READS the directory so "held by …" on a car opens.
  // Covers /employees/export too: an export matches its list page's access.
  { test: /^\/employees(\/|$)/, workspaces: ["it", "purchasing"] },
  { test: /^\/(audit|offboarding|reservations)(\/|$)/, workspaces: ["it"] },
  // Phase 38 (spec §3.1): the Equipment by client report and its export — IT and Finance read it; no broader
  // rule matches this prefix. Purchasing is excluded. Money is decided by canSeeMoney on the server, not here.
  { test: /^\/equipment-by-client(\/|$)/, workspaces: ["it", "finance"], roles: ["admin", "it_staff", "finance_staff", "viewer"] },
  // Phase 14: purchasing approves lifecycle changes on its own class.
  { test: /^\/approvals(\/|$)/, workspaces: ["it", "finance", "purchasing"] },
  // Brief §6.1 is a three-party handoff: purchasing drafts, IT specs it,
  // finance approves the money. IT therefore needs the path its own
  // it-review/it-reject actions live on; page-level requireRole keeps
  // it_staff out of /purchases/new, and viewer sees it read-only.
  // Phase 18 spec §3: the supplier write surfaces belong to Purchasing (and the
  // sysadmin role). MUST precede the general /purchases rule — first-match-wins.
  // Phase 19 spec §3: stock write surfaces are Purchasing's (and the sysadmin role's).
  // MUST precede the /stock read rule — first-match-wins.
  { test: /^\/stock\/(items\/new|receive|issue|import|categories|stocktakes\/new)(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/stock\/items\/[^/]+\/(edit|adjust)(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/stock\/stocktakes\/[^/]+\/(count|review)(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/stock(\/|$)/, workspaces: ["it", "purchasing", "finance", "admin"] },
  { test: /^\/purchases\/suppliers\/(new|import)(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/purchases\/suppliers\/[^/]+\/edit(\/|$)/, workspaces: ["purchasing", "admin"], roles: ["admin", "purchasing_staff"] },
  { test: /^\/purchases(\/|$)/, workspaces: ["purchasing", "finance", "it"] },
  { test: /^\/finance(\/|$)/, workspaces: ["finance"] },
  // Phase 41 (spec §2, §9): Settings › Cris is for the two roles that have Cris. `roles` keeps viewer out of the
  // IT workspace it otherwise shares with it_staff; the page's own requireRole says the same.
  { test: /^\/settings\/cris(\/|$)/, workspaces: ["it", "admin"], roles: ["admin", "it_staff"] },
];

export function pathAllowedForRole(pathname: string, role: Role): boolean {
  if (UNGATED.some((re) => re.test(pathname))) return true;
  const rule = PATH_RULES.find((r) => r.test.test(pathname));
  if (!rule) return false; // default-deny: an unenumerated route is forbidden
  if (rule.roles && !rule.roles.includes(role)) return false;
  const mine = ROLE_WORKSPACES[role];
  return rule.workspaces.some((w) => mine.includes(w));
}
