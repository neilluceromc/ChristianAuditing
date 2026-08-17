import { describe, expect, it } from "vitest";
import {
  navIsActive,
  pathAllowedForRole,
  resolveWorkspace,
  ROLE_LANDING,
  ROLE_WORKSPACES,
  WORKSPACE_NAV,
} from "./workspaces";

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
    ["/employees", "purchasing_staff", false],
    ["/audit", "finance_staff", false],
    ["/audit", "it_staff", true],
    // inventory is shared with purchasing (Reference nav)
    ["/inventory", "purchasing_staff", true],
    // finance reads the asset record because /finance/assets is a register of
    // exactly these rows — but NOT the credentials on it (asserted below)
    ["/inventory", "finance_staff", true],
    ["/inventory/abc", "finance_staff", true],
    ["/inventory/abc/secrets", "finance_staff", false],
    // approvals shared IT + finance
    ["/approvals", "finance_staff", true],
    ["/approvals", "purchasing_staff", false],
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
});
