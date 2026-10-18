import { describe, expect, it } from "vitest";
import { filterSectionsForRole, WORKSPACE_NAV, type VisibleItem } from "./workspaces";
import { countBadge, itemBadge, navCountKeys, type NavBadges } from "./nav-badges";

const b: NavBadges = { approvals: { open: 0, overdue: 0 }, counts: {} };

describe("countBadge", () => {
  it("labels each count", () => {
    expect(countBadge("itSpare", 7, b)?.label).toBe("7 spare");
    expect(countBadge("itDefective", 2, b)?.label).toBe("2 in repair");
    expect(countBadge("worklist", 15, b)?.label).toBe("15 waiting on the worklist");
    expect(countBadge("purchaseReviews", 1, b)?.label).toBe("1 waiting for IT");
    expect(countBadge("prDraft", 3, b)?.label).toBe("3 drafts");
    expect(countBadge("itMissing", 0, b)).toBeNull();
  });

  it("labels the rest of spec §4.3 word for word", () => {
    expect(countBadge("itMissing", 4, b)?.label).toBe("4 missing");
    expect(countBadge("leaving", 2, b)?.label).toBe("2 leaving");
    expect(countBadge("prSubmitted", 5, b)?.label).toBe("5 awaiting IT");
    expect(countBadge("prItReviewed", 6, b)?.label).toBe("6 awaiting finance");
  });

  it("keeps today's approvals wording, red only while any approval is overdue", () => {
    expect(countBadge("approvals", 1, b)).toEqual({ n: 1, label: "1 open approvals", fault: false });
    const late: NavBadges = { approvals: { open: 3, overdue: 1 }, counts: { approvals: 3 } };
    expect(countBadge("approvals", 3, late)).toEqual({ n: 3, label: "3 open approvals, some past SLA", fault: true });
    expect(countBadge("worklist", 3, late)?.fault).toBe(false);
  });
});

describe("itemBadge", () => {
  it("IT Approvals sums open approvals and purchase reviews", () => {
    const item = { label: "Approvals", badge: ["approvals", "purchaseReviews"] } as VisibleItem;
    expect(itemBadge(item, { approvals: { open: 3, overdue: 1 }, counts: { approvals: 3, purchaseReviews: 1 } }))
      .toEqual({ n: 4, label: "4 waiting: 3 open approvals, 1 purchase review, some approvals past SLA", fault: true });
    expect(itemBadge(item, { approvals: { open: 1, overdue: 0 }, counts: { approvals: 1, purchaseReviews: 0 } }))
      .toEqual({ n: 1, label: "1 open approvals", fault: false }); // today's wording, unchanged
    expect(itemBadge(item, { approvals: { open: 2, overdue: 1 }, counts: { approvals: 2 } })?.label)
      .toBe("2 open approvals, some past SLA"); // viewer: no purchaseReviews key
  });

  it("singular and plural follow the numbers in the combined label", () => {
    const item = { label: "Approvals", badge: ["approvals", "purchaseReviews"] } as VisibleItem;
    expect(itemBadge(item, { approvals: { open: 1, overdue: 0 }, counts: { approvals: 1, purchaseReviews: 2 } }))
      .toEqual({ n: 3, label: "3 waiting: 1 open approval, 2 purchase reviews", fault: false });
    expect(itemBadge(item, { approvals: { open: 0, overdue: 0 }, counts: { approvals: 0, purchaseReviews: 1 } }))
      .toEqual({ n: 1, label: "1 waiting: 0 open approvals, 1 purchase review", fault: false });
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

  it("adds purchase reviews for IT's reviewers, and nothing twice", () => {
    const keys = navCountKeys(filterSectionsForRole(WORKSPACE_NAV.it, "it_staff"));
    expect([...keys].sort())
      .toEqual(["approvals", "itDefective", "itMissing", "itSpare", "leaving", "purchaseReviews", "worklist"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the other workspaces", () => {
    expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.purchasing, "purchasing_staff")).sort())
      .toEqual(["approvals", "prDraft", "prItReviewed", "prSubmitted"]);
    expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.finance, "finance_staff")).sort())
      .toEqual(["approvals", "prItReviewed"]);
    expect(navCountKeys(filterSectionsForRole(WORKSPACE_NAV.admin, "admin"))).toEqual([]);
  });
});
