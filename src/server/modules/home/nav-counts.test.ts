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
  assetGroup: vi.fn(),
  employee: vi.fn(),
  purchase: vi.fn(),
  worklist: vi.fn(),
  approval: vi.fn(),
  stockItems: vi.fn(),
  stockSums: vi.fn(),
  stocktake: vi.fn(),
  vendor: vi.fn(),
  user: vi.fn(),
  delivery: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: { count: h.asset, groupBy: h.assetGroup },
    employee: { count: h.employee },
    purchaseOrder: { count: h.purchase },
    approval: { count: h.approval },
    stockItem: { findMany: h.stockItems },
    stockMovement: { groupBy: h.stockSums },
    stocktake: { count: h.stocktake },
    vendor: { count: h.vendor },
    user: { count: h.user },
    webhookDelivery: { count: h.delivery },
  },
}));
vi.mock("./queries", () => ({ worklistCount: h.worklist }));

import { buildStockItemWhere, STOCK_LIST_CONFIG } from "@/lib/stock-list";
import { buildSupplierWhere, SUPPLIER_LIST_CONFIG } from "@/lib/supplier-list";
import { finWhere } from "@/lib/registration";
import { FLAG_SPECS } from "@/lib/admin-flags";
import { financeListWhere } from "@/server/modules/finance/queries";
import { REVIEW_GROUP_WHERE } from "@/server/modules/finance/groups";
import { stocktakesOverdueWhere } from "@/server/modules/stock/queries";
import { getApprovalsBadge, NAV_COUNT_HREF, NAV_COUNT_UNFILTERED, readNavCounts } from "./nav-counts";

const itStaff = { id: "u1", role: "it_staff" as const };
const viewer = { id: "u2", role: "viewer" as const };

const statusOf = (where: { status?: { in: string[] } }) => where.status?.in[0];

type GroupArgs = { by: string[]; where: { status: { in: string[] } }; _count: { _all: true } };
const FLEET: Record<string, number> = { SPARE: 7, DEFECTIVE: 2, MISSING: 1 };
/** What Postgres would answer: one row per status that has assets, none for a status with none. */
const grouped = (counts: Record<string, number>) => async ({ where }: GroupArgs) =>
  where.status.in.filter((s) => counts[s]).map((status) => ({ status, _count: { _all: counts[status] } }));

beforeEach(() => {
  h.asset.mockImplementation(async ({ where }: { where: { status?: { in: string[] } } }) =>
    FLEET[statusOf(where) ?? ""] ?? 0);
  h.assetGroup.mockImplementation(grouped(FLEET));
  h.employee.mockResolvedValue(4);
  h.purchase.mockImplementation(async ({ where }: { where: { state?: string } }) =>
    ({ SENT_BACK: 3, WITH_IT: 5, READY: 6 })[where.state ?? ""] ?? 0);
  h.worklist.mockResolvedValue(15);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("readNavCounts", () => {
  it("queries only the requested keys", async () => {
    expect(await readNavCounts(["itSpare"], itStaff)).toEqual({ itSpare: 7 });
    expect(h.assetGroup).toHaveBeenCalledTimes(1);
    expect(h.asset).not.toHaveBeenCalled();
    expect(h.employee).not.toHaveBeenCalled();
    expect(h.purchase).not.toHaveBeenCalled();
    expect(h.worklist).not.toHaveBeenCalled();
  });

  it("reads every key it is given", async () => {
    const keys: CountKey[] = [
      "worklist", "itSpare", "itDefective", "itMissing", "leaving",
      "poSentBack", "poWithIt", "poReady",
    ];
    expect(await readNavCounts(keys, itStaff)).toEqual({
      worklist: 15, itSpare: 7, itDefective: 2, itMissing: 1, leaving: 4,
      poSentBack: 3, poWithIt: 5, poReady: 6,
    });
    expect(h.worklist).toHaveBeenCalledWith("u1", "it_staff");
  });

  it("leaves approvals to getApprovalsBadge", async () => {
    expect(await readNavCounts(["approvals"], itStaff)).toEqual({});
  });

  it("a throwing query yields 0 for that key and the others still return", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("db down");
    h.worklist.mockRejectedValue(boom);
    expect(await readNavCounts(["itSpare", "itMissing", "worklist", "leaving"], itStaff))
      .toEqual({ itSpare: 7, itMissing: 1, worklist: 0, leaving: 4 });
    expect(error).toHaveBeenCalledWith("[nav counts] worklist failed:", boom);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("the IT status counts share one query, so its failure zeroes every one asked for and logs each (Phase 43)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("db down");
    h.assetGroup.mockRejectedValue(boom);
    expect(await readNavCounts(["itSpare", "itMissing", "leaving"], itStaff))
      .toEqual({ itSpare: 0, itMissing: 0, leaving: 4 });
    expect(error).toHaveBeenCalledWith("[nav counts] itSpare failed:", boom);
    expect(error).toHaveBeenCalledWith("[nav counts] itMissing failed:", boom);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("keeps the worklist admin's and IT's only, as today", async () => {
    expect(await readNavCounts(["worklist"], viewer)).toEqual({ worklist: 0 });
    expect(h.worklist).not.toHaveBeenCalled();
    expect(await readNavCounts(["worklist"], { id: "a", role: "admin" })).toEqual({ worklist: 15 });
  });

  it("builds the asset where the way /inventory does: buildAssetWhere with cls IT and the status", async () => {
    await readNavCounts(["itSpare", "itDefective", "itMissing"], viewer);
    expect(h.assetGroup).toHaveBeenCalledTimes(1);
    const [{ by, where, _count }] = h.assetGroup.mock.calls[0] as [GroupArgs];
    expect(by).toEqual(["status"]);
    expect(_count).toEqual({ _all: true });
    expect(where.status).toEqual({ in: ["SPARE", "DEFECTIVE", "MISSING"] });
    // Equivalence (Phase 43): each status's group is the rows of the shared where with that one status, and that where
    // is exactly the per-view where the old per-key asset.count used, the page's own row count for the view's URL.
    for (const [status, qs] of [
      ["SPARE", "status=SPARE"],
      ["DEFECTIVE", "status=DEFECTIVE&sort=defectiveSince"],
      ["MISSING", "status=MISSING"],
    ] as const) {
      const expected = buildAssetWhere(parseListState(new URLSearchParams(qs), INVENTORY_LIST_CONFIG), null, "IT");
      expect(expected).toEqual({ cls: "IT", status: { in: [status] } });
      expect({ ...where, status: { in: [status] } }).toEqual(expected);
    }
  });

  it("asks only for the statuses whose counts are wanted, and reads a missing group as 0", async () => {
    h.assetGroup.mockImplementation(grouped({ SPARE: 3 }));
    expect(await readNavCounts(["itMissing", "itSpare"], viewer)).toEqual({ itSpare: 3, itMissing: 0 });
    const [{ where }] = h.assetGroup.mock.calls[0] as [GroupArgs];
    expect([...where.status.in].sort()).toEqual(["MISSING", "SPARE"]);
  });

  it("does not query assets when no IT status count is wanted", async () => {
    await readNavCounts(["leaving", "poSentBack", "worklist"], itStaff);
    expect(h.assetGroup).not.toHaveBeenCalled();
    expect(h.asset).not.toHaveBeenCalled();
  });

  it("gives the same numbers the three per-status counts gave", async () => {
    const keys: CountKey[] = ["itSpare", "itDefective", "itMissing"];
    const viaGroup = await readNavCounts(keys, viewer);
    const old = Object.fromEntries(
      await Promise.all(keys.map(async (k) => [k, await h.asset({ where: buildAssetWhere(
        parseListState(new URL(NAV_COUNT_HREF[k as keyof typeof NAV_COUNT_HREF], "http://x").searchParams, INVENTORY_LIST_CONFIG),
        null, "IT") })])),
    );
    expect(viaGroup).toEqual(old);
  });

  it("builds the leaving where the way /employees does", async () => {
    await readNavCounts(["leaving"], viewer);
    const expected = buildEmployeeWhere(parseListState(new URLSearchParams("employment=OFFBOARDING"), EMPLOYEES_LIST_CONFIG));
    expect(expected).toEqual({ employment: { in: ["OFFBOARDING"] } });
    expect(h.employee).toHaveBeenCalledWith({ where: expected });
  });

  it("builds the purchase wheres the way /purchases does", async () => {
    await readNavCounts(["poSentBack", "poWithIt", "poReady"], { id: "p", role: "purchasing_staff" });
    expect(NAV_COUNT_HREF).toMatchObject({
      poSentBack: "/purchases?state=SENT_BACK", poWithIt: "/purchases?state=WITH_IT", poReady: "/purchases?state=READY",
    });
    for (const state of ["SENT_BACK", "WITH_IT", "READY"] as const) {
      expect(h.purchase).toHaveBeenCalledWith({ where: purchaseWhere(state, "") });
    }
  });
});

describe("readNavCounts: the Phase 46 counts (spec §4.3), each the page's own predicate", () => {
  const purchasing = { id: "p", role: "purchasing_staff" as const };
  const admin = { id: "a", role: "admin" as const };
  const params = (key: keyof typeof NAV_COUNT_HREF) => new URL(NAV_COUNT_HREF[key], "http://x").searchParams;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T23:30:00Z")); // 20 Oct in Manila
  });
  afterEach(() => vi.useRealTimers());

  it("stockLow is /stock?low=1's row count: active items at or below a positive reorder level", async () => {
    h.stockItems.mockResolvedValue([
      { id: "a", reorderLevel: 5 }, { id: "b", reorderLevel: 5 }, { id: "c", reorderLevel: 0 }, { id: "d", reorderLevel: 2 },
    ]);
    h.stockSums.mockResolvedValue([
      { itemId: "a", _sum: { quantity: 5 } }, { itemId: "b", _sum: { quantity: 9 } }, { itemId: "c", _sum: { quantity: 0 } },
    ]); // d has no movements: balance 0
    expect(await readNavCounts(["stockLow"], purchasing)).toEqual({ stockLow: 2 });
    const state = parseListState(params("stockLow"), STOCK_LIST_CONFIG);
    expect(state.filters).toEqual({ low: ["1"] });
    // The low filter is derived, so the candidates are the page's where without it.
    expect(h.stockItems.mock.calls[0][0].where).toEqual(buildStockItemWhere({ ...state, filters: {} }));
  });

  it("stocktakesOverdue is the Overview's own overdue predicate on the Manila day", async () => {
    h.stocktake.mockResolvedValue(3);
    expect(await readNavCounts(["stocktakesOverdue"], purchasing)).toEqual({ stocktakesOverdue: 3 });
    expect(h.stocktake).toHaveBeenCalledWith({ where: stocktakesOverdueWhere("2026-10-20") });
  });

  it("suppliersRenewing is /purchases/suppliers?renewing=30's where, today in Manila", async () => {
    h.vendor.mockResolvedValue(2);
    expect(await readNavCounts(["suppliersRenewing"], purchasing)).toEqual({ suppliersRenewing: 2 });
    const where = buildSupplierWhere(parseListState(params("suppliersRenewing"), SUPPLIER_LIST_CONFIG), "2026-10-20");
    expect(where.contractEnd).toEqual({ gte: new Date("2026-10-20T00:00:00.000Z"), lte: new Date("2026-11-19T00:00:00.000Z") });
    expect(h.vendor).toHaveBeenCalledWith({ where });
  });

  it("the To confirm counts are /finance/assets' With-finance chip, per class", async () => {
    h.asset.mockImplementation(async ({ where }) => (JSON.stringify(where).includes("PURCHASING") ? 6 : 5));
    expect(await readNavCounts(["finToConfirmIt", "finToConfirmPurchasing"], { id: "f", role: "finance_staff" }))
      .toEqual({ finToConfirmIt: 5, finToConfirmPurchasing: 6 });
    for (const cls of ["IT", "PURCHASING"] as const) {
      expect(h.asset).toHaveBeenCalledWith({
        where: { AND: [financeListWhere({ cls, status: null, q: "" }), finWhere("with-finance")] },
      });
    }
  });

  it("finGroupsToReview is /finance/review's group count: one per registration, one per asset with none (Task 6)", async () => {
    h.assetGroup.mockResolvedValue([
      { purchaseRecordId: "rec1", _count: { _all: 3 } },
      { purchaseRecordId: null, _count: { _all: 2 } },
    ]);
    expect(await readNavCounts(["finGroupsToReview"], { id: "f", role: "finance_staff" })).toEqual({ finGroupsToReview: 3 });
    expect(h.assetGroup).toHaveBeenCalledWith({ by: ["purchaseRecordId"], where: REVIEW_GROUP_WHERE, _count: { _all: true } });
  });

  it("usersDisabled, deadDeliveries and flagsUnavailable read their pages' filters", async () => {
    h.user.mockResolvedValue(4);
    h.delivery.mockResolvedValue(7);
    expect(await readNavCounts(["usersDisabled", "deadDeliveries", "flagsUnavailable"], admin)).toEqual({
      usersDisabled: 4, deadDeliveries: 7, flagsUnavailable: FLAG_SPECS.filter((f) => f.unavailable).length,
    });
    expect(h.user).toHaveBeenCalledWith({ where: { disabled: true } });
    expect(h.delivery).toHaveBeenCalledWith({ where: { status: { in: ["DEAD"] } } });
  });

  it("each fails to 0 on its own", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    h.vendor.mockRejectedValue(new Error("db down"));
    h.user.mockResolvedValue(1);
    expect(await readNavCounts(["suppliersRenewing", "usersDisabled"], admin)).toEqual({ suppliersRenewing: 0, usersDisabled: 1 });
    expect(error).toHaveBeenCalledTimes(1);
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
    // itSpare, itDefective, itMissing, leaving, poWithIt, poSentBack, poReady ×2; Phase 46: stockLow,
    // suppliersRenewing, finToConfirmIt, finToConfirmPurchasing, usersDisabled, deadDeliveries, flagsUnavailable;
    // Task 6: finGroupsToReview
    expect(checked).toBe(16);
  });

  it("accounts for every counted view: a list count (equal to its page), an exempt one, or a work count", () => {
    // Work counts are not a list page's row count: the Approvals badge (getApprovalsBadge) and the worklist.
    // Exempt counts (NAV_COUNT_UNFILTERED) sit on a view whose page has no
    // filter for them, so they are never asserted equal to that page's rows: only that they sit on that view.
    const WORK: CountKey[] = ["approvals", "worklist"];
    const seen = new Set<CountKey>();
    for (const sections of Object.values(WORKSPACE_NAV)) {
      for (const view of sections.flatMap((s) => s.items).flatMap((i) => i.views ?? [])) {
        if (!view.count) continue;
        seen.add(view.count);
        if (view.count in NAV_COUNT_HREF) continue;
        if (view.count in NAV_COUNT_UNFILTERED) {
          expect(view.href, view.count).toBe(NAV_COUNT_UNFILTERED[view.count as keyof typeof NAV_COUNT_UNFILTERED]);
          continue;
        }
        expect(WORK, `${view.label}: ${view.count}`).toContain(view.count);
      }
    }
    for (const key of [...Object.keys(NAV_COUNT_HREF), ...Object.keys(NAV_COUNT_UNFILTERED)]) {
      expect(seen.has(key as CountKey), `${key} sits on a view`).toBe(true);
    }
    expect(Object.keys(NAV_COUNT_HREF).filter((k) => k in NAV_COUNT_UNFILTERED)).toEqual([]);
  });

  it("exempts only Stocktakes overdue: /stock/stocktakes has no overdue filter (Phase 46 spec §4.3)", () => {
    expect(NAV_COUNT_UNFILTERED).toEqual({ stocktakesOverdue: "/stock/stocktakes" });
  });

  it("names no class because every role that sees IT's Inventory views defaults to IT, as the page does", () => {
    for (const role of ["admin", "it_staff", "viewer"] as const) expect(defaultClassFor(role)).toBe("IT");
  });
});
