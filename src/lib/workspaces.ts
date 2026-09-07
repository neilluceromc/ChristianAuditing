import type { Role } from "@prisma/client";

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

export interface NavItem {
  label: string;
  href: string;
  badge?: "approvals";
  /** restrict the item to these roles, within an already-allowed workspace */
  roles?: Role[];
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

// Brief §2 — the four workspace IAs, verbatim.
export const WORKSPACE_NAV: Record<WorkspaceId, NavSection[]> = {
  it: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    {
      heading: "Tracking",
      items: [
        { label: "Inventory", href: "/inventory" },
        { label: "Employees", href: "/employees" },
        { label: "Approvals", href: "/approvals", badge: "approvals" },
        { label: "Purchase reviews", href: "/purchases?state=SUBMITTED", roles: ["admin", "it_staff"] },
        { label: "Audit log", href: "/audit" },
      ],
    },
    {
      heading: "People lifecycle",
      items: [
        { label: "Offboarding", href: "/offboarding" },
        { label: "Equipment policies", href: "/admin/equipment-policies" },
        { label: "Reservations", href: "/reservations" },
      ],
    },
    {
      heading: "Records & admin",
      items: [
        { label: "Asset categories", href: "/admin/asset-categories", roles: ["admin", "it_staff"] },
        { label: "Asset types", href: "/admin/asset-types", roles: ["admin", "it_staff"] },
        { label: "Departments", href: "/admin/departments", roles: ["admin", "it_staff"] },
      ],
    },
    {
      heading: "Activity logs",
      items: [
        { label: "Inventory activity", href: "/inventory/activity" },
        { label: "Employee activity", href: "/employees/activity" },
      ],
    },
  ],
  purchasing: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    {
      heading: "Procurement",
      items: [
        { label: "All requests", href: "/purchases" },
        { label: "Register purchase", href: "/purchases/new" },
        { label: "Activity log", href: "/purchases/activity" },
      ],
    },
    {
      heading: "By status",
      items: [
        { label: "My drafts", href: "/purchases?state=DRAFT" },
        { label: "Awaiting IT", href: "/purchases?state=SUBMITTED" },
        { label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED" },
        { label: "Completed", href: "/purchases?state=COMPLETED" },
      ],
    },
    {
      heading: "Assets",
      items: [
        { label: "Purchasing assets", href: "/inventory?cls=PURCHASING" },
        { label: "Register assets", href: "/inventory/register", roles: ["admin", "purchasing_staff"] },
        { label: "Approvals", href: "/approvals", badge: "approvals" },
        { label: "Employees", href: "/employees" },
      ],
    },
    {
      heading: "Records",
      items: [
        { label: "Asset categories", href: "/admin/asset-categories" },
        { label: "Asset types", href: "/admin/asset-types" },
      ],
    },
    { heading: "Reference", items: [{ label: "IT inventory", href: "/inventory" }] },
  ],
  finance: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    {
      heading: "Capitalized assets",
      items: [
        { label: "Approved assets", href: "/finance/assets" },
        { label: "Activity log", href: "/finance/activity" },
      ],
    },
    { heading: "Approvals & spend", items: [{ label: "PR approvals", href: "/approvals" }] },
    {
      heading: "By status",
      items: [
        { label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED" },
        { label: "Approved", href: "/purchases?state=COMPLETED" },
        { label: "Cancelled", href: "/purchases?state=CANCELLED" },
        { label: "All purchases", href: "/purchases" },
      ],
    },
  ],
  admin: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    { heading: "Identity & access", items: [{ label: "Users & roles", href: "/admin/users" }] },
    {
      heading: "Integrations & flags",
      items: [
        { label: "Webhooks", href: "/admin/webhooks" },
        { label: "Feature flags", href: "/admin/flags" },
      ],
    },
  ],
};

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
  // Phase 14: purchasing approves lifecycle changes on its own class.
  { test: /^\/approvals(\/|$)/, workspaces: ["it", "finance", "purchasing"] },
  // Brief §6.1 is a three-party handoff: purchasing drafts, IT specs it,
  // finance approves the money. IT therefore needs the path its own
  // it-review/it-reject actions live on; page-level requireRole keeps
  // it_staff out of /purchases/new, and viewer sees it read-only.
  { test: /^\/purchases(\/|$)/, workspaces: ["purchasing", "finance", "it"] },
  { test: /^\/finance(\/|$)/, workspaces: ["finance"] },
];

export function pathAllowedForRole(pathname: string, role: Role): boolean {
  if (UNGATED.some((re) => re.test(pathname))) return true;
  const rule = PATH_RULES.find((r) => r.test.test(pathname));
  if (!rule) return false; // default-deny: an unenumerated route is forbidden
  if (rule.roles && !rule.roles.includes(role)) return false;
  const mine = ROLE_WORKSPACES[role];
  return rule.workspaces.some((w) => mine.includes(w));
}

// Per-pathname cache of the query-param keys some sibling WORKSPACE_NAV item
// on that same path declares (e.g. /inventory -> {"cls"}, /purchases ->
// {"state"}). Built lazily and memoized — navIsActive runs once per nav item
// per render, and the nav definition never changes at runtime.
const ownedParamsByPath = new Map<string, ReadonlySet<string>>();

function ownedParamsFor(pathname: string): ReadonlySet<string> {
  const cached = ownedParamsByPath.get(pathname);
  if (cached) return cached;
  const owned = new Set<string>();
  for (const sections of Object.values(WORKSPACE_NAV)) {
    for (const section of sections) {
      for (const item of section.items) {
        const [itemPath, itemQuery] = item.href.split("?");
        if (itemPath !== pathname || !itemQuery) continue;
        for (const key of new URLSearchParams(itemQuery).keys()) owned.add(key);
      }
    }
  }
  ownedParamsByPath.set(pathname, owned);
  return owned;
}

/**
 * Saved-filter links (href carries a query) are active only when every one
 * of their params matches the URL. A bare list link (no query of its own)
 * yields only to a sibling's own params — never to a page-owned param (page,
 * q, sort, a status facet, ...) that no sibling nav item on this path
 * declares. The owned set is derived from WORKSPACE_NAV itself (today:
 * {state} for /purchases, {cls} for /inventory) so it cannot drift from the
 * nav out from under this rule.
 */
export function navIsActive(href: string, pathname: string, search: URLSearchParams): boolean {
  const [hrefPath, hrefQuery] = href.split("?");
  if (pathname !== hrefPath) return false;
  if (hrefQuery) {
    const wanted = new URLSearchParams(hrefQuery);
    for (const [k, v] of wanted) if (search.get(k) !== v) return false;
    return true;
  }
  for (const key of ownedParamsFor(pathname)) if (search.has(key)) return false;
  return true;
}
