import { describe, expect, it } from "vitest";
import { navDestinations, navLabelFor, workspaceCountLabel } from "./shell";
import { filterSectionsForRole, WORKSPACE_NAV, type VisibleSection } from "./workspaces";

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
});

describe("navDestinations (the command palette's Go to list, spec §4.6)", () => {
  it("flattens links and views, de-duplicated by href, links first", () => {
    expect(navDestinations(SECTIONS, "admin")).toEqual([
      { label: "Home", href: "/" },
      { label: "Inventory", href: "/inventory" },
      { label: "Spare", href: "/inventory?status=SPARE" },
      { label: "Register assets", href: "/inventory/register" },
      { label: "Worklist", href: "/inventory/work" },
      { label: "Approvals", href: "/approvals" },
      { label: "Mine", href: "/approvals?tab=mine" },
      { label: "Purchase reviews", href: "/purchases?state=SUBMITTED" },
      { label: "Setup", href: "/admin/asset-categories" },
      { label: "Asset types", href: "/admin/asset-types" },
    ]);
  });
  it("applies the role filter to views too", () => {
    const hrefs = navDestinations(SECTIONS, "viewer").map((d) => d.href);
    expect(hrefs).not.toContain("/inventory/register");
    expect(hrefs).not.toContain("/purchases?state=SUBMITTED");
  });
  it("still finds Asset types and Audit log in the real IT nav", () => {
    const labels = navDestinations(filterSectionsForRole(WORKSPACE_NAV.it, "it_staff"), "it_staff").map((d) => d.label);
    expect(labels).toContain("Asset types");
    expect(labels).toContain("Audit log");
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
