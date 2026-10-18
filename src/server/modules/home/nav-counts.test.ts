import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseListState } from "@/lib/url-state";
import { buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { buildEmployeeWhere, EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { purchaseWhere } from "@/lib/purchases-list";
import { defaultClassFor } from "@/lib/asset-class";
import { WORKSPACE_NAV, type CountKey } from "@/lib/workspaces";

/*
 * Phase 42 spec §4.3: each view count must equal the page's row count for the view's own URL, so every where is
 * built the way the page builds it. Prisma and the two home queries are stubbed; only the wiring is under test.
 */

const h = vi.hoisted(() => ({
  asset: vi.fn(),
  employee: vi.fn(),
  purchase: vi.fn(),
  worklist: vi.fn(),
  reviews: vi.fn(),
  approval: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: { count: h.asset },
    employee: { count: h.employee },
    purchaseRequest: { count: h.purchase },
    approval: { count: h.approval },
  },
}));
vi.mock("./queries", () => ({ worklistCount: h.worklist, purchaseReviewCount: h.reviews }));

import { getApprovalsBadge, NAV_COUNT_HREF, readNavCounts } from "./nav-counts";

const itStaff = { id: "u1", role: "it_staff" as const };
const viewer = { id: "u2", role: "viewer" as const };

const statusOf = (where: { status?: { in: string[] } }) => where.status?.in[0];

beforeEach(() => {
  h.asset.mockImplementation(async ({ where }: { where: { status?: { in: string[] } } }) =>
    ({ SPARE: 7, DEFECTIVE: 2, MISSING: 1 })[statusOf(where) ?? ""] ?? 0);
  h.employee.mockResolvedValue(4);
  h.purchase.mockImplementation(async ({ where }: { where: { state?: string } }) =>
    ({ DRAFT: 3, SUBMITTED: 5, IT_REVIEWED: 6 })[where.state ?? ""] ?? 0);
  h.worklist.mockResolvedValue(15);
  h.reviews.mockResolvedValue(1);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("readNavCounts", () => {
  it("queries only the requested keys", async () => {
    expect(await readNavCounts(["itSpare"], itStaff)).toEqual({ itSpare: 7 });
    expect(h.asset).toHaveBeenCalledTimes(1);
    expect(h.employee).not.toHaveBeenCalled();
    expect(h.purchase).not.toHaveBeenCalled();
    expect(h.worklist).not.toHaveBeenCalled();
    expect(h.reviews).not.toHaveBeenCalled();
  });

  it("reads every key it is given", async () => {
    const keys: CountKey[] = [
      "worklist", "purchaseReviews", "itSpare", "itDefective", "itMissing", "leaving",
      "prDraft", "prSubmitted", "prItReviewed",
    ];
    expect(await readNavCounts(keys, itStaff)).toEqual({
      worklist: 15, purchaseReviews: 1, itSpare: 7, itDefective: 2, itMissing: 1, leaving: 4,
      prDraft: 3, prSubmitted: 5, prItReviewed: 6,
    });
    expect(h.worklist).toHaveBeenCalledWith("u1", "it_staff");
  });

  it("leaves approvals to getApprovalsBadge", async () => {
    expect(await readNavCounts(["approvals"], itStaff)).toEqual({});
  });

  it("a throwing query yields 0 for that key and the others still return", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("db down");
    h.asset.mockImplementation(async ({ where }: { where: { status?: { in: string[] } } }) => {
      if (statusOf(where) === "MISSING") throw boom;
      return 7;
    });
    h.worklist.mockRejectedValue(boom);
    expect(await readNavCounts(["itSpare", "itMissing", "worklist", "leaving"], itStaff))
      .toEqual({ itSpare: 7, itMissing: 0, worklist: 0, leaving: 4 });
    expect(error).toHaveBeenCalledWith("[nav counts] itMissing failed:", boom);
    expect(error).toHaveBeenCalledWith("[nav counts] worklist failed:", boom);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("keeps the worklist and purchase reviews admin's and IT's only, as today", async () => {
    expect(await readNavCounts(["worklist", "purchaseReviews"], viewer)).toEqual({ worklist: 0, purchaseReviews: 0 });
    expect(h.worklist).not.toHaveBeenCalled();
    expect(h.reviews).not.toHaveBeenCalled();
    expect(await readNavCounts(["worklist"], { id: "a", role: "admin" })).toEqual({ worklist: 15 });
  });

  it("builds the asset where the way /inventory does: buildAssetWhere with cls IT and the status", async () => {
    await readNavCounts(["itSpare", "itDefective", "itMissing"], viewer);
    const wheres = h.asset.mock.calls.map(([arg]) => arg.where);
    for (const [status, qs] of [
      ["SPARE", "status=SPARE"],
      ["DEFECTIVE", "status=DEFECTIVE&sort=defectiveSince"],
      ["MISSING", "status=MISSING"],
    ] as const) {
      const expected = buildAssetWhere(parseListState(new URLSearchParams(qs), INVENTORY_LIST_CONFIG), null, "IT");
      expect(expected).toEqual({ cls: "IT", status: { in: [status] } });
      expect(wheres).toContainEqual(expected);
    }
  });

  it("builds the leaving where the way /employees does", async () => {
    await readNavCounts(["leaving"], viewer);
    const expected = buildEmployeeWhere(parseListState(new URLSearchParams("employment=OFFBOARDING"), EMPLOYEES_LIST_CONFIG));
    expect(expected).toEqual({ employment: { in: ["OFFBOARDING"] } });
    expect(h.employee).toHaveBeenCalledWith({ where: expected });
  });

  it("builds the purchase wheres the way /purchases does", async () => {
    await readNavCounts(["prDraft", "prSubmitted", "prItReviewed"], { id: "p", role: "purchasing_staff" });
    for (const state of ["DRAFT", "SUBMITTED", "IT_REVIEWED"] as const) {
      expect(h.purchase).toHaveBeenCalledWith({ where: purchaseWhere(state, "") });
    }
  });
});

describe("getApprovalsBadge", () => {
  it("counts the open approvals and the overdue ones", async () => {
    h.approval.mockImplementation(async ({ where }: { where: { AND: Array<{ slaAt?: unknown }> } }) =>
      (where.AND.some((w) => w.slaAt) ? 2 : 9));
    expect(await getApprovalsBadge("it_staff")).toEqual({ open: 9, overdue: 2 });
    expect(h.approval).toHaveBeenCalledTimes(2);
  });

  it("fails to 0 with a console.error rather than failing every page's shell (spec §4.3)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("db down");
    h.approval.mockRejectedValue(boom);
    expect(await getApprovalsBadge("it_staff")).toEqual({ open: 0, overdue: 0 });
    expect(error).toHaveBeenCalledWith("[nav counts] approvals failed:", boom);
  });
});

describe("NAV_COUNT_HREF", () => {
  it("is the href of every view that carries the count", () => {
    let checked = 0;
    for (const sections of Object.values(WORKSPACE_NAV)) {
      for (const item of sections.flatMap((s) => s.items)) {
        for (const view of item.views ?? []) {
          if (view.count && view.count in NAV_COUNT_HREF) {
            expect(view.href).toBe(NAV_COUNT_HREF[view.count as keyof typeof NAV_COUNT_HREF]);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(8); // itSpare, itDefective, itMissing, leaving, prDraft, prSubmitted, prItReviewed ×2
  });

  it("names no class because every role that sees IT's Inventory views defaults to IT, as the page does", () => {
    for (const role of ["admin", "it_staff", "viewer"] as const) expect(defaultClassFor(role)).toBe("IT");
  });
});
