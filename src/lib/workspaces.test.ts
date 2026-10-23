import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { PURCHASE_TABS } from "./purchases-list";
import { REPAIR_STAGES } from "./repairs";
import {
  filterSectionsForRole,
  PAGE_DEFAULTS,
  PASSWORD_PAGE,
  pathAllowedForRole,
  resolveWorkspace,
  ROLE_LANDING,
  ROLE_WORKSPACES,
  WORKSPACE_NAV,
  type NavSection,
  type WorkspaceId,
} from "./workspaces";

const ROLES = Object.keys(ROLE_WORKSPACES) as Role[];

/** The labels a role sees in one workspace, group by group (spec §3). */
const labels = (ws: WorkspaceId, role: Role) =>
  filterSectionsForRole(WORKSPACE_NAV[ws], role).map((s) => s.items.map((i) => i.label));
/** One visible link, by label. */
const item = (ws: WorkspaceId, role: Role, label: string) =>
  filterSectionsForRole(WORKSPACE_NAV[ws], role).flatMap((s) => s.items).find((i) => i.label === label)!;
/** Every href (links and views) a role can see in a workspace. */
const hrefs = (ws: WorkspaceId, role: Role) =>
  filterSectionsForRole(WORKSPACE_NAV[ws], role)
    .flatMap((s) => s.items)
    .flatMap((i) => [i.href, ...i.views.map((v) => v.href)]);

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
    // Spec §4 way 3 (Task 5): the direct Register is IT's and an admin's —
    // Purchasing registers only from a purchase order (/purchases/[id]/register).
    // finance and viewer still get nothing: neither registers anything. Every
    // role asserted explicitly, not just the ones that should pass, for the
    // same reason as /inventory/import and /inventory/labels above.
    ["/inventory/register", "admin", true],
    ["/inventory/register", "it_staff", true],
    ["/inventory/register", "viewer", false],
    ["/inventory/register", "purchasing_staff", false],
    ["/inventory/register", "finance_staff", false],
    // /inventory/new: same shape and same reason as /inventory/register above.
    ["/inventory/new", "admin", true],
    ["/inventory/new", "it_staff", true],
    ["/inventory/new", "purchasing_staff", false],
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
  it("supplier write routes are Purchasing-only and precede the general purchases rule", () => {
    expect(pathAllowedForRole("/purchases/suppliers/new", "purchasing_staff")).toBe(true);
    expect(pathAllowedForRole("/purchases/suppliers/new", "finance_staff")).toBe(false);
    expect(pathAllowedForRole("/purchases/suppliers/import", "it_staff")).toBe(false);
    expect(pathAllowedForRole("/purchases/suppliers/abc/edit", "admin")).toBe(true);
    expect(pathAllowedForRole("/purchases/suppliers/abc/edit", "viewer")).toBe(false);
    // reads follow whatever the general purchases rule allows today
    expect(pathAllowedForRole("/purchases/suppliers", "finance_staff")).toBe(pathAllowedForRole("/purchases", "finance_staff"));
  });
  it("admin can reach every workspace's paths", () => {
    for (const p of ["/inventory", "/purchases", "/finance/assets", "/admin/users", "/audit"]) {
      expect(pathAllowedForRole(p, "admin")).toBe(true);
    }
  });
  // Phase 19 spec §3: stock write surfaces are Purchasing's (and the sysadmin
  // role's); reads are open to every workspace. These write-surface rules
  // MUST precede the general /stock read rule (first-match-wins) — if they
  // didn't, finance_staff and viewer would fall through to the general rule
  // (which has no `roles` key) and pass.
  it("stock reads are open to every workspace", () => {
    for (const role of ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"] as const) {
      expect(pathAllowedForRole("/stock", role)).toBe(true);
      expect(pathAllowedForRole("/stock/items/abc", role)).toBe(true);
    }
  });
  it("stock write routes are Purchasing-only and precede the general stock rule", () => {
    expect(pathAllowedForRole("/stock/items/new", "purchasing_staff")).toBe(true);
    expect(pathAllowedForRole("/stock/items/new", "admin")).toBe(true);
    expect(pathAllowedForRole("/stock/items/new", "finance_staff")).toBe(false);
    expect(pathAllowedForRole("/stock/items/new", "viewer")).toBe(false);
    expect(pathAllowedForRole("/stock/items/abc/edit", "purchasing_staff")).toBe(true);
    expect(pathAllowedForRole("/stock/items/abc/adjust", "finance_staff")).toBe(false);
    expect(pathAllowedForRole("/stock/stocktakes/abc/review", "it_staff")).toBe(false);
    expect(pathAllowedForRole("/stock/stocktakes/abc/review", "purchasing_staff")).toBe(true);
    expect(pathAllowedForRole("/stock/stocktakes/abc/count", "finance_staff")).toBe(false);
    expect(pathAllowedForRole("/stock/receive", "it_staff")).toBe(false);
    expect(pathAllowedForRole("/stock/issue", "it_staff")).toBe(false);
  });
});

describe("WORKSPACE_NAV (Phase 42 spec §3: icon links, views under the current one)", () => {
  it("IT shows eleven links in three groups (migration 38: Purchase orders)", () => {
    expect(labels("it", "it_staff")).toEqual([
      ["Home", "Inventory", "Employees", "Worklist", "Approvals", "Purchase orders"],
      ["Offboarding", "Reservations", "Reports"],
      ["Activity", "Setup"],
    ]);
  });
  it("Purchasing, Finance and Admin groups", () => {
    expect(labels("purchasing", "purchasing_staff")).toEqual([
      ["Home", "Purchase orders", "Vendors", "Stock", "Assets", "Approvals", "Employees"],
      ["Activity", "Setup"],
    ]);
    expect(labels("finance", "finance_staff")).toEqual([
      ["Home", "To review", "Assets", "Disposal", "Depreciation", "Approvals", "Purchases", "Vendors", "Stock"],
      ["Reports"],
      ["Activity"],
    ]);
    expect(labels("admin", "admin")).toEqual([["Home"], ["Users & access"], ["Webhooks", "Feature flags"], ["Audit log"]]);
  });
  it("an admin sees the same links as each workspace's own staff", () => {
    expect(labels("it", "admin")).toEqual(labels("it", "it_staff"));
    expect(labels("purchasing", "admin")).toEqual(labels("purchasing", "purchasing_staff"));
    expect(labels("finance", "admin")).toEqual(labels("finance", "finance_staff"));
  });
  it("every workspace starts with Home at /", () => {
    for (const ws of ["it", "purchasing", "finance", "admin"] as const) {
      expect(filterSectionsForRole(WORKSPACE_NAV[ws], "admin")[0].items[0]).toMatchObject({
        label: "Home", href: "/", icon: "home", views: [],
      });
    }
  });
  it("views are the spec §3 sets, in order", () => {
    expect(item("it", "it_staff", "Inventory").views.map((v) => v.label)).toEqual(["All", "Spare", "Repairs", "Missing", "Sent back", "Register assets"]);
    expect(item("it", "it_staff", "Approvals").views.map((v) => v.href)).toEqual(["/approvals", "/approvals?tab=mine", "/approvals?tab=closed"]);
    expect(item("it", "it_staff", "Purchase orders")).toMatchObject({ href: "/purchases?state=WITH_IT", badge: ["poWithIt"], views: [] });
    expect(item("it", "it_staff", "Setup").href).toBe("/admin/asset-categories");
    expect(item("purchasing", "purchasing_staff", "Purchase orders").views.map((v) => v.label)).toEqual(["All", "With IT", "Sent back", "To register", "Cancelled", "New purchase order"]);
    expect(item("purchasing", "purchasing_staff", "Stock").views.map((v) => v.href)).toEqual(["/stock", "/stock?low=1", "/stock/receive", "/stock/issue", "/stock/stocktakes", "/stock/reports", "/stock/import"]);
  });
  it("the rest of the IT views, hrefs verbatim", () => {
    expect(item("it", "it_staff", "Inventory").views.map((v) => v.href)).toEqual([
      "/inventory", "/inventory?status=SPARE", "/inventory?status=DEFECTIVE&sort=defectiveSince",
      "/inventory?status=MISSING", "/inventory?reg=needs-correction&to=IT", "/inventory/register",
    ]);
    expect(item("it", "it_staff", "Employees").views.map((v) => [v.label, v.href])).toEqual([
      ["Everyone", "/employees"], ["Client staff", "/employees?kind=CLIENT"],
      ["Leaving", "/employees?employment=OFFBOARDING"], ["Policy gaps", "/employees?gaps=1"],
    ]);
    expect(item("it", "it_staff", "Offboarding").views.map((v) => v.href)).toEqual(["/offboarding", "/offboarding?due=overdue", "/offboarding?progress=complete"]);
    expect(item("it", "it_staff", "Reservations").views.map((v) => [v.label, v.href])).toEqual([
      ["Active", "/reservations"], ["Fulfilled", "/reservations?state=FULFILLED"], ["Closed", "/reservations?state=CLOSED"],
    ]);
    expect(item("it", "it_staff", "Reports")).toMatchObject({ href: "/equipment-by-client", icon: "reports" });
    expect(item("it", "it_staff", "Reports").views.map((v) => [v.label, v.href])).toEqual([
      ["By client", "/equipment-by-client"], ["Internal teams", "/equipment-by-client?tab=internal"],
    ]);
    expect(item("it", "it_staff", "Activity")).toMatchObject({ href: "/inventory/activity", icon: "activity" });
    expect(item("it", "it_staff", "Activity").views.map((v) => [v.label, v.href])).toEqual([
      ["Inventory activity", "/inventory/activity"], ["Employee activity", "/employees/activity"], ["Audit log", "/audit"],
    ]);
    expect(item("it", "it_staff", "Setup").views.map((v) => [v.label, v.href])).toEqual([
      ["Asset categories", "/admin/asset-categories"], ["Asset types", "/admin/asset-types"],
      ["Departments & clients", "/admin/departments"], ["Equipment policies", "/admin/equipment-policies"],
    ]);
    expect(item("it", "it_staff", "Worklist")).toMatchObject({ href: "/inventory/work", icon: "worklist", views: [] });
  });
  it("Repairs matches on status alone, so a re-sorted Repairs page stays Repairs (spec §4.2), or on any repair stage", () => {
    const repairs = item("it", "it_staff", "Inventory").views.find((v) => v.label === "Repairs")!;
    // …and so does a stage chip's URL, which clears status: the page is in repair mode either way (isRepairView).
    expect(repairs.match).toEqual([{ status: "DEFECTIVE" }, { stage: REPAIR_STAGES }]);
  });
  it("counts sit on the spec §3 views", () => {
    const counts = (ws: WorkspaceId, label: string) =>
      Object.fromEntries(item(ws, "admin", label).views.filter((v) => v.count).map((v) => [v.label, v.count]));
    expect(counts("it", "Inventory")).toEqual({ Spare: "itSpare", Repairs: "itDefective", Missing: "itMissing", "Sent back": "itSentBack" });
    expect(counts("it", "Employees")).toEqual({ Leaving: "leaving" });
    expect(counts("it", "Approvals")).toEqual({ Open: "approvals" });
    expect(counts("purchasing", "Purchase orders")).toEqual({ "With IT": "poWithIt", "Sent back": "poSentBack", "To register": "poToRegister" });
    expect(counts("purchasing", "Assets")).toEqual({ "Sent back": "assetsSentBackPurchasing" });
    expect(counts("finance", "Purchases")).toEqual({ "Ready to register": "poReady" });
    // Phase 46 spec §4.3
    expect(counts("purchasing", "Vendors")).toEqual({ "Renewing soon": "suppliersRenewing" });
    expect(counts("purchasing", "Stock")).toEqual({ "Below reorder": "stockLow", Stocktakes: "stocktakesOverdue" });
    expect(counts("purchasing", "Approvals")).toEqual({ Open: "approvals" });
    expect(counts("finance", "Assets")).toEqual({ "To confirm · IT": "finToConfirmIt", "To confirm · Purchasing": "finToConfirmPurchasing" });
    expect(counts("finance", "Approvals")).toEqual({ Open: "approvals" });
    expect(counts("admin", "Users & access")).toEqual({ "Waiting for approval": "pendingSignups", Disabled: "usersDisabled" });
    expect(counts("admin", "Webhooks")).toEqual({ "Failed deliveries": "deadDeliveries" });
    expect(counts("admin", "Feature flags")).toEqual({ Unavailable: "flagsUnavailable" });
  });
  it("badges sit on the spec §3 links", () => {
    expect(item("it", "it_staff", "Worklist").badge).toEqual(["worklist"]);
    expect(item("it", "it_staff", "Approvals").badge).toEqual(["approvals"]);
    expect(item("it", "it_staff", "Purchase orders").badge).toEqual(["poWithIt"]);
    expect(item("purchasing", "purchasing_staff", "Approvals").badge).toEqual(["approvals"]);
    expect(item("finance", "finance_staff", "Approvals").badge).toEqual(["approvals"]);
    // Final review I3: Finance works from To review; its Purchases link carries no badge.
    expect(item("finance", "finance_staff", "Purchases").badge).toEqual([]);
    // Task 6 (spec §5): Finance's group queue, one link with its badge
    expect(item("finance", "finance_staff", "To review")).toMatchObject({ href: "/finance/review", badge: ["finGroupsToReview"], views: [] });
    // Task 7 (spec §7): the Sent back counts stay on the closed links (red); a viewer, who can fix nothing, has neither.
    expect(item("it", "it_staff", "Inventory").badge).toEqual(["itSentBack"]);
    expect(item("it", "viewer", "Inventory").badge).toEqual([]);
    expect(item("it", "viewer", "Inventory").views.map((v) => v.label)).not.toContain("Sent back");
    expect(item("purchasing", "purchasing_staff", "Purchase orders").badge).toEqual(["poSentBack"]);
    expect(item("purchasing", "purchasing_staff", "Assets").badge).toEqual(["assetsSentBackPurchasing"]);
    // Phase 46: failed deliveries are waiting work (a replay), so the closed Webhooks link keeps their red count.
    expect(item("admin", "admin", "Webhooks").badge).toEqual(["deadDeliveries"]);
    // Users & access (spec §4.4): the closed link keeps the waiting sign-ups' count.
    expect(item("admin", "admin", "Users & access").badge).toEqual(["pendingSignups"]);
  });
  it("icons: Inventory and the Assets links reuse inventory, Employees employee, Approvals approval", () => {
    expect(item("it", "it_staff", "Inventory").icon).toBe("inventory");
    expect(item("purchasing", "purchasing_staff", "Assets").icon).toBe("inventory");
    expect(item("finance", "finance_staff", "Assets").icon).toBe("inventory");
    expect(item("it", "it_staff", "Employees").icon).toBe("employee");
    expect(item("purchasing", "purchasing_staff", "Employees").icon).toBe("employee");
    for (const ws of ["it", "purchasing", "finance"] as const) expect(item(ws, "admin", "Approvals").icon).toBe("approval");
    expect(item("finance", "finance_staff", "Purchases").icon).toBe("requests");
    expect(item("admin", "admin", "Feature flags").icon).toBe("flags");
  });
  it("Purchasing Assets points at its own class, with IT inventory one view away", () => {
    expect(item("purchasing", "purchasing_staff", "Assets").href).toBe("/inventory?cls=PURCHASING");
    expect(item("purchasing", "purchasing_staff", "Assets").views.map((v) => [v.label, v.href])).toEqual([
      ["Purchasing assets", "/inventory?cls=PURCHASING"],
      // Task 7 (spec §7, fix round 1): the assets Finance sent back to Purchasing, both classes
      ["Sent back", "/inventory?reg=needs-correction&to=PURCHASING"],
      ["IT inventory", "/inventory?cls=IT"],
    ]);
    // Spec §4: Purchasing registers from a purchase order; an admin in the Purchasing workspace keeps Register.
    expect(item("purchasing", "admin", "Assets").views.map((v) => v.href)).toContain("/inventory/register");
  });
  it("Phase 47 spec §5.2: Disposal is Finance's only, a plain link after Assets, at /finance/disposal", () => {
    const finance = filterSectionsForRole(WORKSPACE_NAV.finance, "finance_staff").flatMap((s) => s.items).map((i) => i.label);
    expect(finance.indexOf("Disposal")).toBe(finance.indexOf("Assets") + 1);
    expect(item("finance", "finance_staff", "Disposal")).toMatchObject({ href: "/finance/disposal", views: [], badge: [] });
    expect(item("finance", "finance_staff", "Disposal").icon).toBe("disposal");
    expect(item("finance", "admin", "Disposal")).toMatchObject({ href: "/finance/disposal" });
    for (const ws of ["it", "purchasing", "admin"] as const) {
      for (const role of ROLES) expect(hrefs(ws, role), `${role} ${ws}`).not.toContain("/finance/disposal");
    }
    expect(pathAllowedForRole("/finance/disposal", "finance_staff")).toBe(true);
    expect(pathAllowedForRole("/finance/disposal", "admin")).toBe(true);
    for (const role of ["it_staff", "purchasing_staff", "viewer"] as const) expect(pathAllowedForRole("/finance/disposal", role)).toBe(false);
  });
  it("Purchasing Vendors and Setup; Finance Purchases and its plain links", () => {
    expect(item("purchasing", "purchasing_staff", "Vendors").views.map((v) => v.href)).toEqual([
      "/purchases/suppliers", "/purchases/suppliers?renewing=30", "/purchases/suppliers/new", "/purchases/suppliers/import",
    ]);
    expect(item("purchasing", "purchasing_staff", "Setup")).toMatchObject({ href: "/admin/asset-categories" });
    expect(item("purchasing", "purchasing_staff", "Setup").views.map((v) => v.href)).toEqual([
      "/admin/asset-categories", "/admin/asset-types", "/stock/categories",
    ]);
    expect(item("finance", "finance_staff", "Purchases").views.map((v) => [v.label, v.href])).toEqual([
      ["All purchases", "/purchases"], ["Ready to register", "/purchases?state=READY"],
      ["Cancelled", "/purchases?state=CANCELLED"],
    ]);
    expect(item("finance", "finance_staff", "Reports").views).toEqual(item("it", "it_staff", "Reports").views);
    expect(item("finance", "finance_staff", "Activity")).toMatchObject({ href: "/finance/activity", views: [] });
  });
  it("a viewer: no write views, Setup goes straight to Equipment policies", () => {
    expect(item("it", "viewer", "Inventory").views.map((v) => v.label)).toEqual(["All", "Spare", "Repairs", "Missing"]);
    expect(item("it", "viewer", "Approvals").views.map((v) => v.label)).toEqual(["Open", "Mine", "Closed"]);
    const setup = item("it", "viewer", "Setup");
    expect(setup.href).toBe("/admin/equipment-policies");
    expect(setup.views).toEqual([]);
  });
  it("a viewer keeps every IT link but Purchase orders, Worklist and Reports included", () => {
    const withoutOrders = labels("it", "it_staff").map((g) => g.filter((l) => l !== "Purchase orders"));
    expect(labels("it", "viewer")).toEqual(withoutOrders);
  });
  it("Purchase orders and Register assets stay reviewers' and registrars' only", () => {
    for (const role of ["admin", "it_staff"] as const) {
      expect(hrefs("it", role)).toContain("/purchases?state=WITH_IT");
      expect(hrefs("it", role)).toContain("/inventory/register");
    }
    expect(hrefs("it", "viewer")).not.toContain("/purchases?state=WITH_IT");
    expect(hrefs("it", "viewer")).not.toContain("/inventory/register");
  });
  it("every IT-workspace role and Finance can open Equipment by client (Phase 38)", () => {
    for (const r of ["admin", "it_staff", "viewer"] as const) expect(hrefs("it", r)).toContain("/equipment-by-client");
    expect(hrefs("finance", "finance_staff")).toContain("/equipment-by-client");
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
  it("labels are unique within a workspace, and view labels within their link", () => {
    for (const role of ROLES) for (const ws of ROLE_WORKSPACES[role]) {
      const items = filterSectionsForRole(WORKSPACE_NAV[ws], role).flatMap((s) => s.items);
      expect(new Set(items.map((i) => i.label)).size, `${role} ${ws}`).toBe(items.length);
      for (const i of items) expect(new Set(i.views.map((v) => v.label)).size, `${ws} ${i.label}`).toBe(i.views.length);
    }
  });
  it("PURCHASE_TABS still match the Purchase orders views", () => {
    const views = item("purchasing", "purchasing_staff", "Purchase orders").views;
    // Task 7: READY's view became To register (/purchases?register=1); the READY tab stays on the page.
    for (const id of ["WITH_IT", "SENT_BACK", "CANCELLED"] as const) {
      const tab = PURCHASE_TABS.find((t) => t.id === id)!;
      expect(views.find((v) => v.href === tab.href)?.label).toBe(tab.label);
    }
  });
  it("PAGE_DEFAULTS names each page's default value (spec §4.2)", () => {
    expect(PAGE_DEFAULTS).toEqual({
      "/approvals": { tab: "open" },
      "/reservations": { state: "ACTIVE" },
      "/equipment-by-client": { tab: "client" },
      "/finance/assets": { cls: "IT" },
      "/finance/depreciation": { tab: "schedule" },
      "/admin/webhooks/deliveries": { state: "ALL" },
    });
  });
});

describe("Phase 46 spec §4.3: the same style everywhere", () => {
  const views = (ws: WorkspaceId, role: Role, label: string) => item(ws, role, label).views.map((v) => [v.label, v.href]);

  it("Purchasing: Renewing soon, Below reorder, Approvals and Employees views", () => {
    expect(views("purchasing", "purchasing_staff", "Vendors")).toEqual([
      ["All vendors", "/purchases/suppliers"], ["Renewing soon", "/purchases/suppliers?renewing=30"],
      ["New vendor", "/purchases/suppliers/new"], ["Import vendors", "/purchases/suppliers/import"],
    ]);
    expect(views("purchasing", "purchasing_staff", "Stock")).toEqual([
      ["Items", "/stock"], ["Below reorder", "/stock?low=1"], ["Receive stock", "/stock/receive"],
      ["Issue stock", "/stock/issue"], ["Stocktakes", "/stock/stocktakes"], ["Reports", "/stock/reports"],
      ["Import items", "/stock/import"],
    ]);
    expect(views("purchasing", "purchasing_staff", "Approvals")).toEqual([
      ["Open", "/approvals"], ["Mine", "/approvals?tab=mine"], ["Closed", "/approvals?tab=closed"],
    ]);
    expect(item("purchasing", "purchasing_staff", "Approvals").badge).toEqual(["approvals"]);
    expect(views("purchasing", "purchasing_staff", "Employees")).toEqual([
      ["Everyone", "/employees"], ["Client staff", "/employees?kind=CLIENT"], ["Internal staff", "/employees?kind=INTERNAL"],
    ]);
  });

  it("Finance: Assets, Depreciation, Approvals, Vendors and Stock views", () => {
    expect(views("finance", "finance_staff", "Assets")).toEqual([
      ["All assets", "/finance/assets"],
      ["To confirm · IT", "/finance/assets?fin=with-finance"],
      ["To confirm · Purchasing", "/finance/assets?cls=PURCHASING&fin=with-finance"],
      ["Capitalized", "/finance/assets?fin=approved"],
    ]);
    expect(views("finance", "finance_staff", "Depreciation")).toEqual([
      ["Schedule", "/finance/depreciation"], ["Policies", "/finance/depreciation?tab=policies"],
    ]);
    expect(views("finance", "finance_staff", "Approvals")).toEqual([
      ["Open", "/approvals"], ["Mine", "/approvals?tab=mine"], ["Closed", "/approvals?tab=closed"],
    ]);
    expect(views("finance", "finance_staff", "Vendors")).toEqual([
      ["All vendors", "/purchases/suppliers"], ["Active contracts", "/purchases/suppliers?contract=ACTIVE"],
      ["Expired contracts", "/purchases/suppliers?contract=EXPIRED"],
    ]);
    expect(views("finance", "finance_staff", "Stock")).toEqual([
      ["Items", "/stock"], ["Stocktakes", "/stock/stocktakes"], ["Reports", "/stock/reports"],
    ]);
  });

  it("the IT-class finance views name their class through the page default, so a Purchasing URL never lights them", () => {
    const assets = item("finance", "finance_staff", "Assets").views;
    expect(Object.fromEntries(assets.filter((v) => v.match).map((v) => [v.label, v.match]))).toEqual({
      // its own href, or the whole Purchasing class with no fin (fix round 1 ruling)
      "All assets": [{}, { cls: "PURCHASING", fin: null }],
      "To confirm · IT": { cls: "IT", fin: "with-finance" },
      Capitalized: { cls: "IT", fin: "approved" },
    });
  });

  it("Admin: Users & access, Webhooks and Feature flags views, and Audit log under records", () => {
    expect(views("admin", "admin", "Users & access")).toEqual([
      ["All users", "/admin/users"], ["Waiting for approval", "/admin/users?status=PENDING"],
      ["Disabled", "/admin/users?disabled=1"],
    ]);
    expect(views("admin", "admin", "Webhooks")).toEqual([
      ["Endpoints", "/admin/webhooks"], ["Failed deliveries", "/admin/webhooks/deliveries?state=DEAD"],
      ["All deliveries", "/admin/webhooks/deliveries"],
    ]);
    expect(views("admin", "admin", "Feature flags")).toEqual([
      ["All flags", "/admin/flags"], ["Unavailable", "/admin/flags?state=unavailable"],
    ]);
    const records = filterSectionsForRole(WORKSPACE_NAV.admin, "admin").find((s) => s.heading === "records")!;
    expect(records.items).toEqual([{ label: "Audit log", href: "/audit", icon: "audit", badge: [], views: [] }]);
    expect(pathAllowedForRole("/audit", "admin")).toBe(true);
  });

  it("the new views pass pathAllowedForRole for the roles that see them; the admin pages stay admin's", () => {
    for (const ws of ["purchasing", "finance", "admin"] as const) {
      for (const role of ROLES.filter((r) => ROLE_WORKSPACES[r].includes(ws))) {
        for (const href of hrefs(ws, role)) expect(pathAllowedForRole(href.split("?")[0], role), `${role} ${href}`).toBe(true);
      }
    }
    for (const role of ROLES.filter((r) => r !== "admin")) {
      for (const path of ["/admin/users", "/admin/webhooks/deliveries", "/admin/flags"]) {
        expect(pathAllowedForRole(path, role), `${role} ${path}`).toBe(false);
      }
    }
  });
});

describe("filterSectionsForRole (spec §3.5)", () => {
  const NAV: NavSection[] = [
    {
      heading: "one",
      items: [
        { label: "Plain", href: "/a", icon: "home" },
        { label: "Admins only", href: "/b", icon: "home", roles: ["admin"] },
        {
          label: "Hub", icon: "setup",
          views: [
            { label: "First", href: "/c/1", roles: ["admin"] },
            { label: "Second", href: "/c/2" },
            { label: "Third", href: "/c/3" },
          ],
        },
        { label: "Empty hub", icon: "setup", views: [{ label: "Only", href: "/d", roles: ["admin"] }] },
        {
          label: "Own href, hidden views", href: "/f", icon: "home",
          views: [{ label: "F1", href: "/f", roles: ["admin"] }, { label: "F2", href: "/f?x=1", roles: ["admin"] }],
        },
      ],
    },
    { heading: "two", items: [{ label: "Hidden", href: "/e", icon: "home", roles: ["admin"] }] },
  ];
  it("drops links and views the role can't see, then empty links and groups", () => {
    const out = filterSectionsForRole(NAV, "viewer");
    expect(out.map((s) => s.heading)).toEqual(["one"]);
    expect(out[0].items.map((i) => i.label)).toEqual(["Plain", "Hub"]);
  });
  it("a link with views is visible only while one of its views is, even with an href of its own", () => {
    expect(filterSectionsForRole(NAV, "viewer")[0].items.map((i) => i.label)).not.toContain("Own href, hidden views");
    expect(filterSectionsForRole(NAV, "admin")[0].items[4]).toMatchObject({ label: "Own href, hidden views", href: "/f" });
  });
  it("a link with no href points at its first visible view", () => {
    expect(filterSectionsForRole(NAV, "admin")[0].items[2].href).toBe("/c/1");
    expect(filterSectionsForRole(NAV, "viewer")[0].items[1].href).toBe("/c/2");
  });
  it("one visible view collapses into a plain link to that view, which keeps the view's name", () => {
    expect(filterSectionsForRole(NAV, "admin")[0].items[3]).toEqual({
      label: "Empty hub", href: "/d", icon: "setup", badge: [], views: [], viewLabel: "Only",
    });
    // A link that keeps its views carries no viewLabel.
    expect(filterSectionsForRole(NAV, "admin")[0].items.every((i) => i.views.length === 0 || !("viewLabel" in i))).toBe(true);
  });
  it("never mutates the nav it is given", () => {
    const before = JSON.stringify(NAV);
    filterSectionsForRole(NAV, "viewer");
    expect(JSON.stringify(NAV)).toBe(before);
  });
  it("trims a badge key that only a hidden view counts (ruling R1)", () => {
    expect(item("it", "viewer", "Approvals").badge).toEqual(["approvals"]);
    expect(item("it", "it_staff", "Approvals").badge).toEqual(["approvals"]);
    expect(item("it", "admin", "Approvals").badge).toEqual(["approvals"]);
  });
  it("keeps a badge key no view counts (Worklist has no views)", () => {
    expect(item("it", "viewer", "Worklist").badge).toEqual(["worklist"]);
  });
});

describe("Phase 35 Finance paths", () => {
  it("/finance/depreciation and /finance/assets/<id> are Finance-only", () => {
    for (const p of ["/finance/depreciation", "/finance/assets/abc"]) {
      expect(pathAllowedForRole(p, "finance_staff")).toBe(true);
      expect(pathAllowedForRole(p, "it_staff")).toBe(false);
      expect(pathAllowedForRole(p, "purchasing_staff")).toBe(false);
    }
  });
});

describe("Phase 38 Equipment by client", () => {
  it("the page and its export are readable by admin, IT, Finance and viewer, not Purchasing", () => {
    expect(pathAllowedForRole("/equipment-by-clients", "it_staff")).toBe(false);
    for (const p of ["/equipment-by-client", "/equipment-by-client/export"]) {
      for (const r of ["admin", "it_staff", "finance_staff", "viewer"] as const) expect(pathAllowedForRole(p, r)).toBe(true);
      expect(pathAllowedForRole(p, "purchasing_staff")).toBe(false);
    }
  });
});

describe("Phase 41 Settings › Cris (spec §2, §9: admin and it_staff only)", () => {
  it("admin and it_staff reach /settings/cris", () => {
    for (const r of ["admin", "it_staff"] as const) expect(pathAllowedForRole("/settings/cris", r)).toBe(true);
  });
  it("viewer shares the IT workspace but not Cris; Purchasing and Finance never reach it", () => {
    for (const r of ["viewer", "purchasing_staff", "finance_staff"] as const) {
      expect(pathAllowedForRole("/settings/cris", r)).toBe(false);
    }
  });
  it("matches the path exactly, not a lookalike prefix", () => {
    expect(pathAllowedForRole("/settings/crisp", "it_staff")).toBe(false);
    expect(pathAllowedForRole("/settings", "it_staff")).toBe(false);
  });
});

describe("Users & access: Account settings and the first-sign-in page (spec §4.3, §4.5: every role)", () => {
  const ROLES = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"] as const;
  it("every role reaches /settings/account", () => {
    for (const r of ROLES) expect(pathAllowedForRole("/settings/account", r)).toBe(true);
  });
  it("every signed-in role reaches /welcome/password", () => {
    for (const r of ROLES) expect(pathAllowedForRole("/welcome/password", r)).toBe(true);
  });
  it("the shared PASSWORD_PAGE constant is the ungated path (fix round 1, M6)", () => {
    expect(PASSWORD_PAGE).toBe("/welcome/password");
    expect(pathAllowedForRole(PASSWORD_PAGE, "viewer")).toBe(true);
  });
  it("matches the paths exactly, not a lookalike or a wider prefix", () => {
    expect(pathAllowedForRole("/settings/accounts", "viewer")).toBe(false);
    expect(pathAllowedForRole("/welcome", "viewer")).toBe(false);
    expect(pathAllowedForRole("/welcome/passwordx", "viewer")).toBe(false);
    expect(pathAllowedForRole("/welcome/other", "viewer")).toBe(false);
  });
  it("Settings › Cris keeps its own narrower rule", () => {
    expect(pathAllowedForRole("/settings/cris", "viewer")).toBe(false);
  });
});
