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
    { heading: "Reference", items: [{ label: "Inventory", href: "/inventory" }] },
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
  {
    test: /^\/admin\/(asset-categories|asset-types|departments)(\/|$)/,
    workspaces: ["it"],
    roles: ["admin", "it_staff"],
  },
  { test: /^\/admin\/equipment-policies(\/|$)/, workspaces: ["it"] },
  // Backstop: any unlisted /admin/* route is admin-only, never default-allow.
  { test: /^\/admin(\/|$)/, workspaces: ["admin"] },
  // Credential exposure (SECRET_READ-audited GET) — IT workspace only, so a
  // purchasing user who can reference the inventory list can't reach /secrets.
  // MUST precede the general /inventory rule (first-match-wins).
  { test: /^\/inventory\/[^/]+\/secrets(\/|$)/, workspaces: ["it"] },
  // Finance joins IT and purchasing here because /finance/assets is a register
  // of these very records — a capitalized-asset row whose tag leads nowhere is
  // a dead end on the page built for that role. The secrets rule above still
  // precedes this one, so finance gains the record, never the credentials.
  { test: /^\/inventory(\/|$)/, workspaces: ["it", "purchasing", "finance"] },
  // Covers /employees/export and /audit/export too (prefix + "(\/|$)"): an
  // export route intentionally has no separate rule of its own — like
  // /inventory/export above, it matches its list page's access exactly
  // because it IS that page's data, just downloaded instead of rendered.
  { test: /^\/(employees|audit|offboarding|reservations)(\/|$)/, workspaces: ["it"] },
  { test: /^\/approvals(\/|$)/, workspaces: ["it", "finance"] },
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

/**
 * Saved-filter links (href carries a query) are active only when every one
 * of their params matches the URL. A bare list link yields to an active
 * sibling saved filter (state param present ⇒ the filter owns the highlight).
 */
export function navIsActive(href: string, pathname: string, search: URLSearchParams): boolean {
  const [hrefPath, hrefQuery] = href.split("?");
  if (pathname !== hrefPath) return false;
  if (hrefQuery) {
    const wanted = new URLSearchParams(hrefQuery);
    for (const [k, v] of wanted) if (search.get(k) !== v) return false;
    return true;
  }
  return !search.has("state");
}
