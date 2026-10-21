import { describe, expect, it } from "vitest";
import { filterSectionsForRole, WORKSPACE_NAV, type VisibleItem } from "./workspaces";
import { countBadge, itemBadge, navCountKeys, type NavBadges } from "./nav-badges";
import { RENEWING_DAYS } from "./supplier-list";

const b: NavBadges = { approvals: { open: 0, overdue: 0 }, counts: {} };

describe("countBadge", () => {
  it("labels each count", () => {
    expect(countBadge("itSpare", 7, b)?.label).toBe("7 spare");
    expect(countBadge("itDefective", 2, b)?.label).toBe("2 in repair");
    expect(countBadge("worklist", 15, b)?.label).toBe("15 waiting on the worklist");
    expect(countBadge("poSentBack", 3, b)?.label).toBe("3 sent back");
    expect(countBadge("itMissing", 0, b)).toBeNull();
  });

  it("labels the rest of spec §4.3 word for word", () => {
    expect(countBadge("itMissing", 4, b)?.label).toBe("4 missing");
    expect(countBadge("leaving", 2, b)?.label).toBe("2 leaving");
    expect(countBadge("poWithIt", 5, b)?.label).toBe("5 with IT");
    expect(countBadge("poReady", 6, b)?.label).toBe("6 ready to register");
  });

  it("Task 7 (purchase-orders spec §7): the Sent back counts are red; To register is not", () => {
    expect(countBadge("itSentBack", 2, b)).toEqual({ n: 2, label: "2 sent back", fault: true });
    expect(countBadge("poSentBack", 1, b)).toEqual({ n: 1, label: "1 sent back", fault: true });
    expect(countBadge("poToRegister", 4, b)).toEqual({ n: 4, label: "4 to register", fault: false });
    expect(countBadge("assetsSentBackPurchasing", 1, b)).toEqual({ n: 1, label: "1 asset sent back", fault: true });
  });

  it("labels the Phase 46 counts", () => {
    expect(countBadge("stockLow", 3, b)?.label).toBe("3 below reorder level");
    expect(countBadge("stocktakesOverdue", 1, b)?.label).toBe("1 overdue");
    expect(countBadge("suppliersRenewing", 2, b)?.label).toBe(`2 renewing within ${RENEWING_DAYS} days`);
    expect(countBadge("finToConfirmIt", 5, b)?.label).toBe("5 IT registrations to confirm");
    expect(countBadge("finToConfirmPurchasing", 6, b)?.label).toBe("6 Purchasing registrations to confirm");
    expect(countBadge("usersDisabled", 4, b)?.label).toBe("4 disabled");
    expect(countBadge("flagsUnavailable", 1, b)?.label).toBe("1 unavailable");
  });

  it("draws failed deliveries red with a dot (spec §4.3), and none when there are none", () => {
    expect(countBadge("deadDeliveries", 7, b)).toEqual({ n: 7, label: "7 failed deliveries", fault: true });
    expect(countBadge("deadDeliveries", 0, b)).toBeNull();
    expect(countBadge("usersDisabled", 4, b)?.fault).toBe(false);
  });

  it("keeps today's approvals wording, red only while any approval is overdue", () => {
    expect(countBadge("approvals", 1, b)).toEqual({ n: 1, label: "1 open approvals", fault: false });
    const late: NavBadges = { approvals: { open: 3, overdue: 1 }, counts: { approvals: 3 } };
    expect(countBadge("approvals", 3, late)).toEqual({ n: 3, label: "3 open approvals, some past SLA", fault: true });
    expect(countBadge("worklist", 3, late)?.fault).toBe(false);
  });
});

describe("itemBadge", () => {
  it("migration 38: IT's Approvals is the approvals count alone; purchase orders have their own item", () => {
    const item = { label: "Approvals", badge: ["approvals"] } as VisibleItem;
    expect(itemBadge(item, { approvals: { open: 3, overdue: 1 }, counts: { approvals: 3, poWithIt: 1 } }))
      .toEqual({ n: 3, label: "3 open approvals, some past SLA", fault: true });
    const orders = { label: "Purchase orders", badge: ["poWithIt"] } as VisibleItem;
    expect(itemBadge(orders, { approvals: { open: 0, overdue: 0 }, counts: { poWithIt: 2 } }))
      .toEqual({ n: 2, label: "2 with IT", fault: false });
  });

  it("a link with several keys reads as its parts", () => {
    const item = { label: "X", badge: ["poWithIt", "poReady"] } as VisibleItem;
    expect(itemBadge(item, { approvals: { open: 0, overdue: 0 }, counts: { poWithIt: 1, poReady: 2 } }))
      .toEqual({ n: 3, label: "1 with IT, 2 ready to register", fault: false });
  });

  it("is null with no badge keys or nothing counted, and a single key reads as its count", () => {
    expect(itemBadge({ label: "Home", badge: [] } as unknown as VisibleItem, b)).toBeNull();
    const worklist = { label: "Worklist", badge: ["worklist"] } as VisibleItem;
    expect(itemBadge(worklist, b)).toBeNull();
    expect(itemBadge(worklist, { ...b, counts: { worklist: 15 } }))
      .toEqual({ n: 15, label: "15 waiting on the worklist", fault: false });
    const approvals = { label: "Approvals", badge: ["approvals"] } as VisibleItem;
    expect(itemBadge(approvals, { approvals: { open: 2, overdue: 0 }, counts: { approvals: 2 } }))
      .toEqual({ n: 2, label: "2 open approvals", fault: false });
  });
});

describe("navCountKeys", () => {
  it("navCountKeys asks only for what the visible nav shows", () => {
    expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.it, "viewer")).sort())
      .toEqual(["approvals", "itDefective", "itMissing", "itSpare", "leaving", "worklist"]);
  });

  it("adds the purchase orders with IT for IT's reviewers, and nothing twice", () => {
    const keys = navCountKeys(filterSectionsForRole(WORKSPACE_NAV.it, "it_staff"));
    expect([...keys].sort())
      .toEqual(["approvals", "itDefective", "itMissing", "itSentBack", "itSpare", "leaving", "poWithIt", "worklist"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the other workspaces", () => {
    expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.purchasing, "purchasing_staff")).sort())
      .toEqual(["approvals", "assetsSentBackPurchasing", "poSentBack", "poToRegister", "poWithIt", "stockLow", "stocktakesOverdue", "suppliersRenewing"]);
    expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.finance, "finance_staff")).sort())
      .toEqual(["approvals", "finGroupsToReview", "finToConfirmIt", "finToConfirmPurchasing", "poReady"]);
    expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.admin, "admin")).sort())
      .toEqual(["deadDeliveries", "flagsUnavailable", "usersDisabled"]);
  });
});
