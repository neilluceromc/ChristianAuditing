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
  purchaseFind: vi.fn(),
  poFind: vi.fn(),
  // Task 7: the in-memory rows the state test below writes through a real action
  assetFind: vi.fn(),
  assetUpdate: vi.fn(),
  writes: [] as Array<{ table: string; data: unknown }>,
  sessionUser: null as null | { id: string; name: string; role: string },
}));

vi.mock("@/server/db/client", () => {
  const prisma = {
    asset: { count: h.asset, groupBy: h.assetGroup, findUnique: h.assetFind, updateMany: h.assetUpdate },
    employee: { count: h.employee },
    purchaseOrder: { count: h.purchase, findMany: h.purchaseFind, findUnique: h.poFind },
    approval: { count: h.approval },
    stockItem: { findMany: h.stockItems },
    stockMovement: { groupBy: h.stockSums },
    stocktake: { count: h.stocktake },
    vendor: { count: h.vendor },
    user: { count: h.user },
    webhookDelivery: { count: h.delivery },
    auditEntry: { create: async ({ data }: { data: unknown }) => { h.writes.push({ table: "auditEntry", data }); } },
    notification: { create: async ({ data }: { data: unknown }) => { h.writes.push({ table: "notification", data }); } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma };
});
vi.mock("./queries", () => ({ worklistCount: h.worklist }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.sessionUser,
  actionRole: async (...roles: string[]) => (h.sessionUser && roles.includes(h.sessionUser.role) ? h.sessionUser : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));

import { buildStockItemWhere, STOCK_LIST_CONFIG } from "@/lib/stock-list";
import { buildSupplierWhere, SUPPLIER_LIST_CONFIG } from "@/lib/supplier-list";
import { finWhere } from "@/lib/registration";
import { FLAG_SPECS } from "@/lib/admin-flags";
import { financeListWhere } from "@/server/modules/finance/queries";
import { REVIEW_GROUP_WHERE } from "@/server/modules/finance/groups";
import { stocktakesOverdueWhere } from "@/server/modules/stock/queries";
import { resubmitAssetToFinance } from "@/server/modules/inventory/actions";
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

describe("readNavCounts: the Sent back and To register counts (Task 7, spec §7), from state", () => {
  type Row = Record<string, unknown>;
  /** Enough of Prisma's where for the inventory list's predicates: AND / OR / NOT, in, not, a to-one `is`, values. */
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "AND") return (Array.isArray(v) ? v : [v]).every((w) => matches(row, w as Row));
      if (k === "OR") return (v as Row[]).some((w) => matches(row, w));
      if (k === "NOT") return !(Array.isArray(v) ? v : [v]).some((w) => matches(row, w as Row));
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const op = v as { in?: unknown[]; not?: unknown; is?: Row };
        if (op.is) return row[k] != null && matches(row[k] as Row, op.is);
        if (op.in) return op.in.includes(row[k]);
        if ("not" in op) return op.not === null ? row[k] != null : row[k] !== op.not;
      }
      return v === null ? row[k] == null : row[k] === v;
    });
  let assets: Row[] = [];
  let pos: Row[] = [];
  const reads: Array<{ notificationId: string; userId: string }> = [];
  const returned = new Date("2026-10-20");
  const checked = new Date("2026-10-18");
  /** An asset Finance sent back (unless `financeReturnedAt: null`), carrying its PO as the relation reads it. */
  const asset = (id: string, cls: "IT" | "PURCHASING", extra: Row = {}): Row => {
    const row: Row = {
      id, tag: `BR-${id}`, cls, itVerifiedAt: cls === "IT" ? checked : null, financeConfirmedAt: null,
      financeReturnedAt: returned, financeReturnedTo: null, purchaseOrderId: null, purchaseRecordId: "rec1", ...extra,
    };
    row.purchaseOrder = row.purchaseOrderId ? pos.find((p) => p.id === row.purchaseOrderId) ?? null : null;
    return row;
  };
  const purchasing = { id: "p", role: "purchasing_staff" as const };
  const viewOf = (key: "itSentBack" | "assetsSentBackPurchasing", cls: "IT" | "PURCHASING") =>
    buildAssetWhere(parseListState(new URL(NAV_COUNT_HREF[key], "http://x").searchParams, INVENTORY_LIST_CONFIG), null, cls);
  const listed = (where: Row) => assets.filter((a) => matches(a, where)).map((a) => a.id);

  beforeEach(() => {
    h.writes = [];
    pos = [{ id: "po1", refNo: "PO-0001", state: "SENT_BACK" }, { id: "po2", refNo: "PO-0002", state: "READY" }];
    assets = [
      // IT checked it, Finance sent it back to IT (Review Focus 4)
      asset("a1", "IT", { financeReturnedTo: "IT" }),
      // (b) an IT laptop's money, sent back to Purchasing on a PO that is not itself sent back
      asset("a2", "IT", { financeReturnedTo: "PURCHASING", purchaseOrderId: "po2" }),
      // with Finance: not sent back
      asset("a3", "IT", { financeReturnedAt: null }),
      // (a) a legacy Purchasing batch's chair, returned before teams were recorded: Purchasing's
      asset("a4", "PURCHASING"),
      // (c) a Purchasing chair's "Other", sent back to IT
      asset("a5", "PURCHASING", { financeReturnedTo: "IT" }),
      // on a PO that is itself sent back: counted once, through the PO
      asset("a6", "PURCHASING", { financeReturnedTo: "PURCHASING", purchaseOrderId: "po1" }),
    ];
    h.asset.mockImplementation(async ({ where }: { where: Row }) => listed(where).length);
    h.purchase.mockImplementation(async ({ where }: { where: Row }) => pos.filter((p) => matches(p, where)).length);
    h.poFind.mockImplementation(async ({ where }: { where: { id: string } }) => pos.find((p) => p.id === where.id) ?? null);
    h.assetFind.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const a = assets.find((x) => x.id === where.id);
      return a ? { ...a } : null;
    });
    h.assetUpdate.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
      const a = assets.find((x) => matches(x, where));
      if (!a) return { count: 0 };
      Object.assign(a, data);
      return { count: 1 };
    });
  });

  it("itSentBack counts state, not reads", async () => {
    // The bell rang IT once for a1, and every IT person has opened it: the tab still holds the asset.
    for (const userId of ["u1", "u3", "u4"]) reads.push({ notificationId: "n1", userId });
    expect(NAV_COUNT_HREF.itSentBack).toBe("/inventory?reg=needs-correction&to=IT");
    expect(await readNavCounts(["itSentBack"], itStaff)).toEqual({ itSentBack: 2 }); // a1, and a5 (route c)

    // Someone on IT fixes it and sends it on: it leaves the tab.
    h.sessionUser = { id: "u3", name: "Ivan IT", role: "it_staff" };
    const res = await resubmitAssetToFinance({ id: "a1", reply: "Serial corrected" });
    expect(res.ok).toBe(true);
    expect(await readNavCounts(["itSentBack"], itStaff)).toEqual({ itSentBack: 1 });
    // …and the resubmit rang Finance, not IT
    expect(h.writes.filter((w) => w.table === "notification").map((w) => (w.data as Row).team)).toEqual(["FINANCE"]);
  });

  it("each count is its Sent back view's own where, the same whatever class the page opens on", async () => {
    await readNavCounts(["itSentBack", "assetsSentBackPurchasing"], itStaff);
    expect(h.asset).toHaveBeenCalledWith({ where: viewOf("itSentBack", "IT") });
    expect(h.asset).toHaveBeenCalledWith({ where: viewOf("assetsSentBackPurchasing", "IT") });
    expect(viewOf("assetsSentBackPurchasing", "PURCHASING")).toEqual(viewOf("assetsSentBackPurchasing", "IT"));
  });

  it("(a) a legacy Purchasing batch's asset returned with no team recorded counts for Purchasing, not IT", async () => {
    expect(await readNavCounts(["assetsSentBackPurchasing"], purchasing)).toEqual({ assetsSentBackPurchasing: 2 }); // a2, a4
    expect(listed(viewOf("assetsSentBackPurchasing", "PURCHASING"))).toContain("a4");
    expect(listed(viewOf("itSentBack", "IT"))).not.toContain("a4");
  });

  it("(b) an IT-class asset returned to Purchasing counts for Purchasing and is in Purchasing's view", () => {
    expect(NAV_COUNT_HREF.assetsSentBackPurchasing).toBe("/inventory?reg=needs-correction&to=PURCHASING");
    // the view as purchasing_staff opens it (their default class, Purchasing) still lists the IT laptop
    expect(listed(viewOf("assetsSentBackPurchasing", "PURCHASING"))).toEqual(["a2", "a4"]);
    expect(listed(viewOf("itSentBack", "IT"))).not.toContain("a2");
  });

  it("(c) a Purchasing-class asset returned to IT counts for IT and is in IT's view", () => {
    expect(listed(viewOf("itSentBack", "IT"))).toEqual(["a1", "a5"]);
    expect(listed(viewOf("assetsSentBackPurchasing", "PURCHASING"))).not.toContain("a5");
  });

  it("an asset on a sent-back PO is counted only through the PO", async () => {
    expect(await readNavCounts(["poSentBack", "assetsSentBackPurchasing", "itSentBack"], purchasing)).toEqual({
      poSentBack: 1, assetsSentBackPurchasing: 2, itSentBack: 2,
    });
    expect(listed(viewOf("assetsSentBackPurchasing", "PURCHASING"))).not.toContain("a6");
  });

  it("resubmitting drops each count: IT's chair (c), Purchasing's legacy chair (a) and the IT laptop (b)", async () => {
    const counts = () => readNavCounts(["itSentBack", "assetsSentBackPurchasing"], purchasing);
    expect(await counts()).toEqual({ itSentBack: 2, assetsSentBackPurchasing: 2 });
    h.sessionUser = { id: "u3", name: "Ivan IT", role: "it_staff" };
    expect((await resubmitAssetToFinance({ id: "a5" })).ok).toBe(true);
    expect(await counts()).toEqual({ itSentBack: 1, assetsSentBackPurchasing: 2 });
    h.sessionUser = { id: "p1", name: "Pia Purchasing", role: "purchasing_staff" };
    expect((await resubmitAssetToFinance({ id: "a4" })).ok).toBe(true);
    expect(await counts()).toEqual({ itSentBack: 1, assetsSentBackPurchasing: 1 });
    expect((await resubmitAssetToFinance({ id: "a2" })).ok).toBe(true);
    expect(await counts()).toEqual({ itSentBack: 1, assetsSentBackPurchasing: 0 });
    // the asset on the sent-back PO comes back with the PO, not on its own
    expect((await resubmitAssetToFinance({ id: "a6" })).ok).toBe(false);
  });

  it("poToRegister counts READY or WITH_IT POs, not completed, with a line Purchasing can register and units left", async () => {
    expect(NAV_COUNT_HREF.poToRegister).toBe("/purchases?register=1");
    const line = (cls: string | null, qty: number, registered: number, closedShort = 0) => ({
      qty, closedShort, category: cls ? { cls } : null, _count: { assets: registered },
    });
    h.purchaseFind.mockResolvedValue([
      { id: "p1", lines: [line("PURCHASING", 3, 1)] }, // chairs left
      { id: "p2", lines: [line("IT", 2, 0), line("PURCHASING", 2, 2)] }, // only IT's left
      { id: "p3", lines: [line(null, 1, 0)] }, // an old unit with no category: either team may register it
      { id: "p4", lines: [line("PURCHASING", 4, 1, 3)] }, // the rest closed short
    ]);
    expect(await readNavCounts(["poToRegister"], { id: "p", role: "purchasing_staff" })).toEqual({ poToRegister: 2 });
    const [{ where }] = h.purchaseFind.mock.calls[0] as [{ where: Row }];
    expect(where).toMatchObject({ state: { in: ["READY", "WITH_IT"] }, completedAt: null });
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
    // itSpare, itDefective, itMissing, leaving, poWithIt, poSentBack, poReady; Phase 46: stockLow,
    // suppliersRenewing, finToConfirmIt, finToConfirmPurchasing, usersDisabled, deadDeliveries, flagsUnavailable;
    // Task 6: finGroupsToReview; Task 7: itSentBack, poToRegister, assetsSentBackPurchasing
    expect(checked).toBe(18);
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
