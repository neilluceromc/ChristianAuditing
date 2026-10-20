import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { matchDestinations, navDestinations, navLabelFor, workspaceCountLabel } from "./shell";
import { filterSectionsForRole, WORKSPACE_NAV, type NavSection, type VisibleSection } from "./workspaces";

const SECTIONS: VisibleSection[] = [
  { heading: "start", items: [{ label: "Home", href: "/", icon: "home", badge: [], views: [] }] },
  {
    heading: "work",
    items: [
      {
        label: "Inventory", href: "/inventory", icon: "inventory", badge: [],
        views: [
          { label: "All", href: "/inventory" },
          { label: "Spare", href: "/inventory?status=SPARE", count: "itSpare" },
          { label: "Register assets", href: "/inventory/register", roles: ["admin", "it_staff"] },
        ],
      },
      { label: "Worklist", href: "/inventory/work", icon: "worklist", badge: ["worklist"], views: [] },
      {
        label: "Approvals", href: "/approvals", icon: "approval", badge: ["approvals"],
        views: [
          { label: "Open", href: "/approvals" },
          { label: "Mine", href: "/approvals?tab=mine" },
          { label: "Purchase reviews", href: "/purchases?state=SUBMITTED", roles: ["admin", "it_staff"] },
        ],
      },
    ],
  },
  {
    heading: "records",
    items: [
      {
        label: "Setup", href: "/admin/asset-categories", icon: "setup", badge: [],
        views: [
          { label: "Asset categories", href: "/admin/asset-categories" },
          { label: "Asset types", href: "/admin/asset-types" },
        ],
      },
    ],
  },
];
const it_ = SECTIONS;

describe("navLabelFor (the phone top bar's page name)", () => {
  it("names an exact nav path", () => {
    expect(navLabelFor("/inventory", it_)).toBe("Inventory");
    expect(navLabelFor("/inventory/work", it_)).toBe("Worklist");
  });

  it("names a record by its link — the longest matching prefix wins", () => {
    expect(navLabelFor("/inventory/abc123/history", it_)).toBe("Inventory");
  });

  it("considers views: a view's own page reads as the view", () => {
    expect(navLabelFor("/admin/asset-types", it_)).toBe("Asset types");
    expect(navLabelFor("/inventory/register/x", it_)).toBe("Register assets");
    expect(navLabelFor("/purchases", it_)).toBe("Purchase reviews");
  });

  it("a link's first view, alone on its path, still reads as the view", () => {
    // Setup has no page of its own: it points at Asset categories.
    expect(navLabelFor("/admin/asset-categories", it_)).toBe("Asset categories");
  });

  it("a list page shared by several views reads as its link, never as a filter view", () => {
    expect(navLabelFor("/inventory", it_)).toBe("Inventory");
    expect(navLabelFor("/approvals", it_)).toBe("Approvals");
  });

  it("matches Home only on the root itself", () => {
    expect(navLabelFor("/", it_)).toBe("Home");
    expect(navLabelFor("/reports", it_)).toBeNull();
  });

  it("never matches a sibling path that merely shares a prefix", () => {
    expect(navLabelFor("/inventoryx", it_)).toBeNull();
  });

  it("reads the real IT nav the same way", () => {
    const it = filterSectionsForRole(WORKSPACE_NAV.it, "it_staff");
    expect(navLabelFor("/admin/asset-types", it)).toBe("Asset types");
    expect(navLabelFor("/inventory/abc123/history", it)).toBe("Inventory");
    expect(navLabelFor("/inventory/work", it)).toBe("Worklist");
    expect(navLabelFor("/inventory/activity", it)).toBe("Inventory activity");
    expect(navLabelFor("/audit", it)).toBe("Audit log");
    expect(navLabelFor("/employees?kind=CLIENT", it)).toBeNull(); // a pathname never carries a query
    expect(navLabelFor("/employees", it)).toBe("Employees");
    expect(navLabelFor("/inventoryx", it)).toBeNull();
  });

  it("a link collapsed onto its one view reads as that view, as it does for every other role", () => {
    const viewer = filterSectionsForRole(WORKSPACE_NAV.it, "viewer");
    expect(navLabelFor("/admin/equipment-policies", viewer)).toBe("Equipment policies");
    expect(navLabelFor("/admin/equipment-policies", filterSectionsForRole(WORKSPACE_NAV.it, "it_staff")))
      .toBe("Equipment policies");
    // A link that keeps its views still reads as its own label on its own page.
    expect(navLabelFor("/inventory", viewer)).toBe("Inventory");
  });
});

describe("navDestinations and matchDestinations (the command palette's Go to list, spec §4.6)", () => {
  const RAW: NavSection[] = [
    {
      heading: "one",
      items: [
        { label: "Home", href: "/", icon: "home" },
        {
          label: "Inventory", href: "/inventory", icon: "inventory",
          views: [
            { label: "All", href: "/inventory" },
            { label: "Spare", href: "/inventory?status=SPARE" },
            { label: "Register assets", href: "/inventory/register", roles: ["admin", "it_staff"] },
          ],
        },
        {
          label: "Setup", icon: "setup",
          views: [
            { label: "Asset categories", href: "/admin/asset-categories", roles: ["admin", "it_staff"] },
            { label: "Asset types", href: "/admin/asset-types", roles: ["admin", "it_staff"] },
            { label: "Equipment policies", href: "/admin/equipment-policies" },
          ],
        },
      ],
    },
  ];
  const find = (role: Role, query: string, nav: NavSection[] = WORKSPACE_NAV.it) =>
    matchDestinations(navDestinations(nav, role), query);

  it("one destination per href, the link's label first and every other name kept", () => {
    expect(navDestinations(RAW, "admin")).toEqual([
      { label: "Home", href: "/", also: [] },
      { label: "Inventory", href: "/inventory", also: ["All"] },
      { label: "Spare", href: "/inventory?status=SPARE", also: [] },
      { label: "Register assets", href: "/inventory/register", also: [] },
      { label: "Setup", href: "/admin/asset-categories", also: ["Asset categories"] },
      { label: "Asset types", href: "/admin/asset-types", also: [] },
      { label: "Equipment policies", href: "/admin/equipment-policies", also: [] },
    ]);
  });
  it("applies the role filter to links and views, and keeps a collapsed link's view name", () => {
    expect(navDestinations(RAW, "viewer")).toEqual([
      { label: "Home", href: "/", also: [] },
      { label: "Inventory", href: "/inventory", also: ["All"] },
      { label: "Spare", href: "/inventory?status=SPARE", also: [] },
      { label: "Setup", href: "/admin/equipment-policies", also: ["Equipment policies"] },
    ]);
    const hrefs = navDestinations(WORKSPACE_NAV.it, "viewer").map((d) => d.href);
    expect(hrefs).not.toContain("/inventory/register");
    expect(hrefs).not.toContain("/purchases?state=SUBMITTED");
  });
  it("lists every destination under its link's label when there is no query", () => {
    expect(matchDestinations(navDestinations(RAW, "admin"), "").map((d) => d.label)).toEqual([
      "Home", "Inventory", "Spare", "Register assets", "Setup", "Asset types", "Equipment policies",
    ]);
  });
  it("finds a page by its view name and shows that name (case-insensitive)", () => {
    expect(find("it_staff", "categories")).toEqual([{ label: "Asset categories", href: "/admin/asset-categories" }]);
    expect(find("it_staff", "Asset categories")).toEqual([{ label: "Asset categories", href: "/admin/asset-categories" }]);
    expect(find("it_staff", "inventory activity")).toEqual([{ label: "Inventory activity", href: "/inventory/activity" }]);
    expect(find("viewer", "policies")).toEqual([{ label: "Equipment policies", href: "/admin/equipment-policies" }]);
    expect(find("it_staff", "Asset types")).toEqual([{ label: "Asset types", href: "/admin/asset-types" }]);
    expect(find("it_staff", "audit")).toEqual([{ label: "Audit log", href: "/audit" }]);
  });
  it("prefers the link's own label when it matches", () => {
    expect(find("it_staff", "setup")).toEqual([{ label: "Setup", href: "/admin/asset-categories" }]);
    expect(find("purchasing_staff", "categories", WORKSPACE_NAV.purchasing).map((d) => d.label)).toEqual([
      "Asset categories", "Stock categories",
    ]);
  });
  it("a view whose label repeats across the workspace's views is named under its link", () => {
    expect(find("it_staff", "closed")).toEqual([
      { label: "Approvals › Closed", href: "/approvals?tab=closed" },
      { label: "Reservations › Closed", href: "/reservations?state=CLOSED" },
    ]);
    expect(find("it_staff", "all")).toEqual([
      { label: "Inventory › All", href: "/inventory" },
      { label: "Offboarding › All", href: "/offboarding" },
    ]);
    // Unique view names keep their own name; the bare list still lists under its link's label.
    expect(find("it_staff", "mine")).toEqual([{ label: "Mine", href: "/approvals?tab=mine" }]);
    expect(find("it_staff", "").filter((d) => d.href === "/approvals?tab=closed")).toEqual([
      { label: "Approvals › Closed", href: "/approvals?tab=closed" },
    ]);
    // Within a workspace whose views never repeat a name, nothing changes.
    expect(navDestinations(RAW, "admin").find((d) => d.href === "/inventory")!.also).toEqual(["All"]);
    // A view named like another link is named under its own link (Phase 46: Finance's Stock › Reports).
    expect(matchDestinations(navDestinations(WORKSPACE_NAV.finance, "finance_staff"), "reports")).toEqual([
      { label: "Stock › Reports", href: "/stock/reports" },
      { label: "Reports", href: "/equipment-by-client" },
    ]);
    // No two rows of any workspace's full list read the same.
    for (const ws of ["it", "purchasing", "finance", "admin"] as const) {
      const labels = matchDestinations(navDestinations(WORKSPACE_NAV[ws], "admin"), "").map((d) => d.label);
      expect(new Set(labels).size, ws).toBe(labels.length);
    }
  });
  it("finds the report by its page title, Equipment by client", () => {
    expect(find("it_staff", "equipment by client")).toEqual([
      { label: "Equipment by client", href: "/equipment-by-client" },
    ]);
    expect(find("finance_staff", "equipment", WORKSPACE_NAV.finance)).toEqual([
      { label: "Equipment by client", href: "/equipment-by-client" },
    ]);
    expect(find("viewer", "equipment").map((d) => d.label)).toEqual(["Equipment by client", "Equipment policies"]);
    // The view's own name still finds it first.
    expect(find("it_staff", "by client")).toEqual([{ label: "By client", href: "/equipment-by-client" }]);
  });
  it("a viewer never finds what they cannot open", () => {
    expect(find("viewer", "register")).toEqual([]);
    expect(find("viewer", "purchase reviews")).toEqual([]);
    expect(find("viewer", "asset types")).toEqual([]);
  });
});

describe("workspaceCountLabel (spec §3: the switcher reads \"{n} workspaces\", never the cookie name)", () => {
  it("counts the workspaces", () => {
    expect(workspaceCountLabel(4)).toBe("4 workspaces");
    expect(workspaceCountLabel(2)).toBe("2 workspaces");
  });
  it("reads singular for one", () => {
    expect(workspaceCountLabel(1)).toBe("1 workspace");
  });
});
