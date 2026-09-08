import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  navIsActive,
  pathAllowedForRole,
  resolveWorkspace,
  ROLE_LANDING,
  ROLE_WORKSPACES,
  WORKSPACE_NAV,
  type WorkspaceId,
} from "./workspaces";

/**
 * Flattens one workspace's nav into the items a role actually sees — the
 * same `!i.roles || i.roles.includes(role)` predicate `filterSectionsForRole`
 * (`components/shell/sidebar.tsx`) and the command palette apply at render
 * time. Kept local to the test rather than imported from `sidebar.tsx`: that
 * module pulls in Prisma and the approvals query, which this lib-level suite
 * has no business depending on for a pure nav-shape assertion.
 */
function navFor(role: Role, ws: WorkspaceId = "it") {
  return WORKSPACE_NAV[ws].flatMap((s) => s.items).filter((i) => !i.roles || i.roles.includes(role));
}

describe("role → workspaces (brief §2)", () => {
  it("matches the brief's table", () => {
    expect(ROLE_WORKSPACES.admin).toEqual(["it", "purchasing", "finance", "admin"]);
    expect(ROLE_WORKSPACES.it_staff).toEqual(["it"]);
    expect(ROLE_WORKSPACES.purchasing_staff).toEqual(["purchasing"]);
    expect(ROLE_WORKSPACES.finance_staff).toEqual(["finance"]);
    expect(ROLE_WORKSPACES.viewer).toEqual(["it"]);
  });
  it("matches the brief's default landings", () => {
    expect(ROLE_LANDING.admin).toBe("/");
    expect(ROLE_LANDING.it_staff).toBe("/inventory");
    expect(ROLE_LANDING.purchasing_staff).toBe("/purchases");
    expect(ROLE_LANDING.finance_staff).toBe("/finance/assets");
    expect(ROLE_LANDING.viewer).toBe("/inventory");
  });
});

describe("resolveWorkspace", () => {
  it("honours a valid cookie", () => {
    expect(resolveWorkspace("admin", "finance")).toBe("finance");
  });
  it("falls back to the first allowed workspace on a bad or missing cookie", () => {
    expect(resolveWorkspace("it_staff", "finance")).toBe("it");
    expect(resolveWorkspace("purchasing_staff", undefined)).toBe("purchasing");
    expect(resolveWorkspace("admin", "nonsense")).toBe("it");
  });
});

// NOTE: this is the coarse workspace gate. /secrets, /new, /edit and viewer
// read-only enforcement still need page-level requireRole (Phase 3) — a viewer
// passing the IT-workspace gate for /secrets is intentional; the page restricts
// the actual reveal.
describe("pathAllowedForRole", () => {
  const cases: Array<[string, string, boolean]> = [
    // IT workspace paths
    ["/inventory", "it_staff", true],
    ["/inventory/abc/history", "viewer", true],
    ["/employees", "purchasing_staff", true],
    ["/audit", "finance_staff", false],
    ["/audit", "it_staff", true],
    // export routes match their list page's access exactly (no dedicated
    // rule of their own — same shape as /inventory/export)
    ["/audit/export", "it_staff", true],
    ["/audit/export", "finance_staff", false],
    ["/employees/export", "it_staff", true],
    ["/employees/export", "purchasing_staff", true],
    ["/offboarding/emp1/report/export", "it_staff", true],
    ["/offboarding/emp1/report/export", "purchasing_staff", false],
    // inventory is shared with purchasing (Reference nav)
    ["/inventory", "purchasing_staff", true],
    // finance reads the asset record because /finance/assets is a register of
    // exactly these rows — but NOT the credentials on it (asserted below)
    ["/inventory", "finance_staff", true],
    ["/inventory/abc", "finance_staff", true],
    ["/inventory/abc/secrets", "finance_staff", false],
    // approvals shared IT + finance
    ["/approvals", "finance_staff", true],
    ["/approvals", "purchasing_staff", true],
    ["/approvals/xyz", "viewer", true],
    // purchases: purchasing + finance own it; IT joins because brief §6.1 makes
    // IT the second party (it-review / it-reject). Page-level requireRole still
    // keeps it_staff out of the purchasing-only create form.
    ["/purchases", "finance_staff", true],
    ["/purchases", "it_staff", true],
    ["/purchases/new", "it_staff", true],
    ["/purchases", "viewer", true],
    ["/purchases/abc", "it_staff", true],
    // finance-only
    ["/finance/assets", "finance_staff", true],
    ["/finance/assets", "it_staff", false],
    // reference-data CRUD: admin/it_staff only — viewer is IT-workspace but excluded
    ["/admin/asset-categories", "it_staff", true],
    ["/admin/asset-categories", "viewer", false],
    ["/admin/equipment-policies", "viewer", true],
    // admin workspace
    ["/admin/users", "admin", true],
    ["/admin/users", "it_staff", false],
    ["/admin/webhooks/deliveries", "admin", true],
    ["/admin/flags", "finance_staff", false],
    // ungated
    ["/", "viewer", true],
    ["/dev/kitchen-sink", "viewer", true],
    // secrets: IT-workspace only — purchasing (who references inventory) is excluded
    ["/inventory/abc/secrets", "it_staff", true],
    ["/inventory/abc/secrets", "purchasing_staff", false],
    ["/inventory/abc/secrets", "viewer", true],
    // import: admin/it_staff only, even though viewer, purchasing_staff and
    // finance_staff all share the IT workspace this route sits under. Every
    // role asserted explicitly — not just the two that should pass — because
    // PATH_RULES is first-match-wins and the general /inventory rule right
    // after this one in the array would silently admit all three of the
    // roles this rule exists to exclude if this one were ever removed or
    // shadowed. This is the case a route left ungoverned by MISTAKE would
    // still pass by matching the wrong, more permissive rule instead of
    // failing default-deny.
    ["/inventory/import", "admin", true],
    ["/inventory/import", "it_staff", true],
    ["/inventory/import", "viewer", false],
    ["/inventory/import", "purchasing_staff", false],
    ["/inventory/import", "finance_staff", false],
    // Phase 13: registering is each department's own — IT registers IT-class
    // categories, Purchasing registers Purchasing-class ones — so BOTH
    // workspaces are admitted here and `registerAssets` refuses the wrong
    // class by name. finance and viewer still get nothing: neither registers
    // anything. Every role asserted explicitly, not just the ones that should
    // pass, for the same reason as /inventory/import and /inventory/labels
    // above.
    ["/inventory/register", "admin", true],
    ["/inventory/register", "it_staff", true],
    ["/inventory/register", "viewer", false],
    ["/inventory/register", "purchasing_staff", true],
    ["/inventory/register", "finance_staff", false],
    // /inventory/new: same shape and same reason as /inventory/register above.
    ["/inventory/new", "admin", true],
    ["/inventory/new", "it_staff", true],
    ["/inventory/new", "purchasing_staff", true],
    ["/inventory/new", "finance_staff", false],
    ["/inventory/new", "viewer", false],
    // Task 4 (Phase 10), the identical E-7/W-1 trap one route over: /inventory
    // sits right below this in PATH_RULES with workspaces ["it", "purchasing",
    // "finance"], so without a dedicated rule ahead of it a finance or
    // purchasing user could print asset labels. Every role asserted
    // explicitly, not just the two that should pass, for the same reason as
    // /inventory/import above.
    ["/inventory/labels", "admin", true],
    ["/inventory/labels", "it_staff", true],
    ["/inventory/labels", "viewer", false],
    ["/inventory/labels", "purchasing_staff", true],
    ["/inventory/labels", "finance_staff", false],
    // Phase 15: the worklist is IT-workspace only (viewer shares that
    // workspace read-only) — purchasing and finance, who both share the
    // general /inventory rule right after this one, are excluded. MUST
    // precede that general rule (first-match-wins), same shape as
    // /inventory/import and /inventory/labels above.
    ["/inventory/work", "it_staff", true],
    ["/inventory/work", "viewer", true],
    ["/inventory/work", "admin", true],
    ["/inventory/work", "purchasing_staff", false],
    ["/inventory/work", "finance_staff", false],
    // Task 12, E-7: the identical trap, one route over. /employees/import
    // sits under the general /employees rule (workspaces: ["it"], no
    // `roles` key), which viewer shares with it_staff — every role asserted
    // explicitly, not just the two that should pass, for the same reason.
    ["/employees/import", "admin", true],
    ["/employees/import", "it_staff", true],
    ["/employees/import", "viewer", false],
    ["/employees/import", "purchasing_staff", false],
    ["/employees/import", "finance_staff", false],
    // Phase 14: Purchasing owns its class and reads the directory. Approvals
    // are class-scoped server-side (approval-access.ts), never here.
    ["/approvals", "purchasing_staff", true],
    ["/approvals/xyz", "purchasing_staff", true],
    ["/employees", "purchasing_staff", true],
    ["/employees/abc", "purchasing_staff", true],
    ["/employees/abc/form", "purchasing_staff", true],
    ["/employees/export", "purchasing_staff", true],
    // Every employee WRITE surface stays IT, asserted for every role — the same
    // first-match-wins reason as /employees/import.
    ["/employees/new", "admin", true],
    ["/employees/new", "it_staff", true],
    ["/employees/new", "viewer", false],
    ["/employees/new", "purchasing_staff", false],
    ["/employees/new", "finance_staff", false],
    ["/employees/abc/edit", "admin", true],
    ["/employees/abc/edit", "it_staff", true],
    ["/employees/abc/edit", "viewer", false],
    ["/employees/abc/edit", "purchasing_staff", false],
    ["/employees/abc/edit", "finance_staff", false],
    ["/offboarding", "purchasing_staff", false],
    ["/reservations", "purchasing_staff", false],
    ["/admin/asset-categories", "purchasing_staff", true],
    ["/admin/asset-types", "purchasing_staff", true],
    ["/admin/asset-categories", "finance_staff", false],
    ["/admin/departments", "purchasing_staff", false],
    ["/admin/departments", "it_staff", true],
    ["/inventory/labels", "purchasing_staff", true],
    // default-deny: unenumerated routes are forbidden for everyone, admin included
    ["/export/assets", "viewer", false],
    ["/api/export/audit", "finance_staff", false],
    ["/totally-unknown", "admin", false],
    // unlisted /admin/* hits the backstop, not default-allow
    ["/admin/future-thing", "viewer", false],
    ["/admin/future-thing", "admin", true],
  ];
  it.each(cases)("%s for %s → %s", (path, role, allowed) => {
    expect(pathAllowedForRole(path, role as never)).toBe(allowed);
  });
  it("admin can reach every workspace's paths", () => {
    for (const p of ["/inventory", "/purchases", "/finance/assets", "/admin/users", "/audit"]) {
      expect(pathAllowedForRole(p, "admin")).toBe(true);
    }
  });
});

describe("navIsActive", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("plain link matches its exact path with no state param", () => {
    expect(navIsActive("/inventory", "/inventory", q(""))).toBe(true);
    expect(navIsActive("/inventory", "/inventory/abc", q(""))).toBe(false);
    expect(navIsActive("/", "/", q(""))).toBe(true);
    expect(navIsActive("/", "/inventory", q(""))).toBe(false);
  });
  it("saved-filter link is active only when its params match", () => {
    expect(navIsActive("/purchases?state=DRAFT", "/purchases", q("state=DRAFT"))).toBe(true);
    expect(navIsActive("/purchases?state=DRAFT", "/purchases", q("state=SUBMITTED"))).toBe(false);
    expect(navIsActive("/purchases?state=DRAFT", "/purchases", q(""))).toBe(false);
  });
  it("the bare list link yields to an active saved filter", () => {
    expect(navIsActive("/purchases", "/purchases", q("state=DRAFT"))).toBe(false);
    expect(navIsActive("/purchases", "/purchases", q(""))).toBe(true);
    // Same yield, for the /inventory + ?cls=PURCHASING pair (Task 7 fix).
    expect(navIsActive("/inventory", "/inventory", q("cls=PURCHASING"))).toBe(false);
    expect(navIsActive("/inventory?cls=PURCHASING", "/inventory", q("cls=PURCHASING"))).toBe(true);
  });
  it("the bare list link stays active under a page-owned param no sibling declares", () => {
    // /inventory's only sibling-declared key is `cls` (?cls=PURCHASING) — paging,
    // searching, sorting and status faceting are page-owned and must not
    // de-activate the bare "Inventory" item.
    expect(navIsActive("/inventory", "/inventory", q("page=2"))).toBe(true);
    expect(navIsActive("/inventory", "/inventory", q("q=dell"))).toBe(true);
    expect(navIsActive("/inventory", "/inventory", q("status=DEFECTIVE"))).toBe(true);
    // /purchases's only sibling-declared key is `state` — paging is page-owned.
    expect(navIsActive("/purchases", "/purchases", q("page=3"))).toBe(true);
    // `sort` and `purchaseYear` are page-owned too (the docblock names them).
    expect(navIsActive("/inventory", "/inventory", q("sort=tag:desc"))).toBe(true);
    expect(navIsActive("/inventory", "/inventory", q("purchaseYear=2024"))).toBe(true);
    // The with-query branch is subset-match ON PURPOSE: paging inside the
    // Purchasing view keeps the Purchasing item lit, and only it. Tightening
    // it to an exact match would kill this highlight with a green suite.
    expect(navIsActive("/inventory?cls=PURCHASING", "/inventory", q("cls=PURCHASING&page=2"))).toBe(true);
    expect(navIsActive("/inventory", "/inventory", q("cls=PURCHASING&page=2"))).toBe(false);
  });
  it("a bare item is unaffected by a query on a route with no sibling saved filters at all", () => {
    // No WORKSPACE_NAV item for /reservations carries a query, so `state`
    // here is page-owned, not sibling-owned — the bare item must stay active.
    expect(navIsActive("/reservations", "/reservations", q("state=ACTIVE"))).toBe(true);
  });
});

describe("WORKSPACE_NAV shape", () => {
  it("every workspace has an Overview → Home section first", () => {
    for (const ws of ["it", "purchasing", "finance", "admin"] as const) {
      expect(WORKSPACE_NAV[ws][0].heading).toBe("Overview");
      expect(WORKSPACE_NAV[ws][0].items[0]).toMatchObject({ label: "Home", href: "/" });
    }
  });
  it("the IT Approvals item carries the badge marker", () => {
    const tracking = WORKSPACE_NAV.it.find((s) => s.heading === "Tracking");
    expect(tracking?.items.find((i) => i.label === "Approvals")?.badge).toBe("approvals");
  });
  it("Phase 14: the Purchasing Assets section carries Approvals (with badge) and Employees", () => {
    const assets = WORKSPACE_NAV.purchasing.find((s) => s.heading === "Assets");
    expect(assets?.items.find((i) => i.label === "Approvals")?.badge).toBe("approvals");
    expect(assets?.items.map((i) => i.href)).toContain("/employees");
  });
  it("Phase 14: the Purchasing Records section offers categories and types, never departments", () => {
    const records = WORKSPACE_NAV.purchasing.find((s) => s.heading === "Records");
    expect(records?.items.map((i) => i.href)).toEqual(["/admin/asset-categories", "/admin/asset-types"]);
  });
  it("Records & admin items are role-restricted", () => {
    const records = WORKSPACE_NAV.it.find((s) => s.heading === "Records & admin");
    for (const item of records?.items ?? []) {
      expect(item.roles).toEqual(["admin", "it_staff"]);
    }
  });
});

describe("IT workspace nav", () => {
  it("carries a Purchase reviews entry pointing at the awaiting-IT filter", () => {
    const tracking = WORKSPACE_NAV.it.find((s) => s.heading === "Tracking")!;
    expect(tracking.items.map((i) => i.href)).toContain("/purchases?state=SUBMITTED");
  });

  /**
   * The `roles` key is the ONLY thing keeping this link out of a viewer's
   * sidebar — every IT-workspace role now passes the path gate, so deleting it
   * would hand viewers a working link to a reviewer's surface. Pin it.
   */
  it("restricts Purchase reviews to reviewers, not every IT-workspace role", () => {
    const tracking = WORKSPACE_NAV.it.find((s) => s.heading === "Tracking")!;
    const item = tracking.items.find((i) => i.href === "/purchases?state=SUBMITTED")!;
    expect(item.roles).toEqual(["admin", "it_staff"]);
    expect(item.roles).not.toContain("viewer");
  });
  it("highlights it only when the state param matches", () => {
    expect(navIsActive("/purchases?state=SUBMITTED", "/purchases", new URLSearchParams("state=SUBMITTED"))).toBe(true);
    expect(navIsActive("/purchases?state=SUBMITTED", "/purchases", new URLSearchParams("state=DRAFT"))).toBe(false);
  });

  // Task 13: the batch register page's own nav entry, same shape as Purchase
  // reviews above — reachable for admin/it_staff, not for a viewer sharing
  // the same IT workspace.
  it("IT can reach the batch register page", () => {
    expect(navFor("it_staff").some((i) => i.href === "/inventory/register")).toBe(true);
  });
  it("does not hand a viewer the batch register link", () => {
    expect(navFor("viewer").some((i) => i.href === "/inventory/register")).toBe(false);
  });
});
