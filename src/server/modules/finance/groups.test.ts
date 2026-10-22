import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/*
 * Task 6 (spec §5): Finance's To review queue lists groups — a registration (PurchaseRecord) with at least one asset
 * with Finance — and an asset registered before groups existed as a group of its own. The grouping is pure
 * (groupAssets); reviewGroups and reviewGroupCount read with one where, checked here against a mocked client.
 */

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  wheres: [] as unknown[],
  groups: [] as Array<{ purchaseRecordId: string | null; _count: { _all: number } }>,
  record: null as unknown,
  recordArgs: null as null | { select: { assets: { select: Record<string, unknown> } } },
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: {
      findMany: async (args: { where: unknown }) => { h.wheres.push(args.where); return h.rows; },
      groupBy: async (args: { where: unknown }) => { h.wheres.push(args.where); return h.groups; },
      count: async () => 0,
    },
    purchaseRecord: {
      findUnique: async (args: { select: { assets: { select: Record<string, unknown> } } }) => { h.recordArgs = args; return h.record; },
    },
  },
}));

import { groupAssets, groupDetail, reviewGroupCount, reviewGroups, REVIEW_GROUP_WHERE, type GroupAssetRow } from "./groups";

const D = (n: number) => new Prisma.Decimal(n);
const REG = new Date("2026-10-20T01:00:00Z");
const EARLY = new Date("2026-10-18T01:00:00Z");

function row(id: string, extra: Partial<GroupAssetRow> = {}): GroupAssetRow {
  return {
    id, tag: `BR-LT-${id}`, model: "Latitude 5440", cls: "IT", cost: D(50000), createdAt: EARLY,
    purchaseOrder: null, purchaseOrderLine: null, purchaseRecord: null,
    ...extra,
  };
}
const record = (id: string, role: "it_staff" | "purchasing_staff" | "admin", refNo: string | null, at = REG) => ({
  id, createdAt: at, cls: "IT" as const, createdBy: { role }, purchaseOrder: refNo ? { refNo } : null,
});

beforeEach(() => {
  h.rows = [];
  h.wheres = [];
  h.groups = [];
});

describe("groupAssets", () => {
  it("one group per registration: the PO's number, the line, the count and the total of what waits", () => {
    const rec = record("rec1", "it_staff", "PO-0214");
    const groups = groupAssets([
      row("0201", { purchaseRecord: rec, purchaseOrder: { refNo: "PO-0214" }, purchaseOrderLine: { description: "laptops" } }),
      row("0202", { purchaseRecord: rec, purchaseOrder: { refNo: "PO-0214" }, purchaseOrderLine: { description: "laptops" }, cost: D(51000.5) }),
      row("0203", { purchaseRecord: rec, purchaseOrder: { refNo: "PO-0214" }, purchaseOrderLine: { description: "laptops" }, cost: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "rec1", recordId: "rec1", assetId: null, refNo: "PO-0214", title: "3 laptops", count: 3,
      registeredAt: REG, team: "IT",
    });
    expect(groups[0].total.toString()).toBe("101000.5");
  });

  it("a direct registration (no PO) is its own group, from the team that registered it", () => {
    const groups = groupAssets([
      row("0301", { cls: "PURCHASING", model: "Ergo chair", purchaseRecord: { ...record("rec2", "purchasing_staff", null), cls: "PURCHASING" } }),
      row("0302", { cls: "PURCHASING", model: "Ergo chair", purchaseRecord: { ...record("rec2", "purchasing_staff", null), cls: "PURCHASING" } }),
      row("0303", { purchaseRecord: record("rec3", "it_staff", null) }),
    ]);
    expect(groups.map((g) => [g.key, g.refNo, g.title, g.count, g.team])).toEqual([
      ["rec2", null, "2 × Ergo chair", 2, "PURCHASING"],
      ["rec3", null, "Latitude 5440", 1, "IT"],
    ]);
  });

  it("an asset with no registration record is a single-asset group linking to its own page", () => {
    const groups = groupAssets([
      row("0150", { purchaseOrder: { refNo: "PO-0188" } }),
      row("0151", { cls: "PURCHASING", model: "Desk" }),
    ]);
    expect(groups.map((g) => ({ key: g.key, recordId: g.recordId, assetId: g.assetId, refNo: g.refNo, title: g.title, count: g.count, team: g.team }))).toEqual([
      { key: "asset:0150", recordId: null, assetId: "0150", refNo: "PO-0188", title: "BR-LT-0150 · Latitude 5440", count: 1, team: "IT" },
      { key: "asset:0151", recordId: null, assetId: "0151", refNo: null, title: "BR-LT-0151 · Desk", count: 1, team: "PURCHASING" },
    ]);
  });

  it("several lines in one registration read as items; an admin's registration files under its class; oldest first", () => {
    const rec = record("rec4", "admin", "PO-0220", new Date("2026-10-21T00:00:00Z"));
    const groups = groupAssets([
      row("0401", { purchaseRecord: rec, purchaseOrder: { refNo: "PO-0220" }, purchaseOrderLine: { description: "laptops" } }),
      row("0402", { purchaseRecord: rec, purchaseOrder: { refNo: "PO-0220" }, purchaseOrderLine: { description: "monitors" } }),
      row("0100"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["asset:0100", "rec4"]);
    expect(groups[1]).toMatchObject({ title: "2 items", team: "IT" });
  });
});

describe("reviewGroups / reviewGroupCount", () => {
  it("read the assets with Finance, leaving out a PO that is with Purchasing for corrections", async () => {
    h.rows = [row("0201", { purchaseRecord: record("rec1", "it_staff", null) })];
    const groups = await reviewGroups();
    expect(groups.map((g) => g.key)).toEqual(["rec1"]);
    expect(h.wheres[0]).toEqual(REVIEW_GROUP_WHERE);
    expect(JSON.stringify(REVIEW_GROUP_WHERE)).toContain("SENT_BACK");
    expect(JSON.stringify(REVIEW_GROUP_WHERE)).toContain("financeReturnedAt");
  });

  it("the count is one per registration plus one per asset with no registration", async () => {
    h.groups = [
      { purchaseRecordId: "rec1", _count: { _all: 3 } },
      { purchaseRecordId: "rec2", _count: { _all: 1 } },
      { purchaseRecordId: null, _count: { _all: 4 } },
    ];
    expect(await reviewGroupCount()).toBe(6);
    expect(h.wheres[0]).toEqual(REVIEW_GROUP_WHERE);
  });
});

describe("fix round 1", () => {
  it("REVIEW_GROUP_WHERE keeps assets with no PO: the sent-back exclusion has an explicit null branch", () => {
    // A NOT on the nullable relation can render as NOT (fk IN subselect), which drops every row whose fk is NULL — all
    // direct and legacy groups would vanish whenever any PO is sent back.
    const and = REVIEW_GROUP_WHERE.AND as Prisma.AssetWhereInput[];
    expect(and).toContainEqual({ OR: [{ purchaseOrderId: null }, { purchaseOrder: { is: { state: { not: "SENT_BACK" } } } }] });
    expect(JSON.stringify(REVIEW_GROUP_WHERE)).not.toMatch(/"NOT":\{"purchaseOrder"/);
  });

  it("groupDetail gives each asset its own money, and says when a direct group's assets differ from what was registered", async () => {
    const asset = (id: string, extra: Record<string, unknown> = {}) => ({
      id, tag: `BR-LT-${id}`, serial: null, brand: null, model: "Latitude", cls: "IT", cost: D(50000), itVerifiedAt: REG,
      financeConfirmedAt: null, financeReturnedAt: null, financeReturnedTo: null, financeNotCapitalised: false,
      financeReturnFields: [], financeReturnReason: null, financeResubmitNote: null, documents: [],
      vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: REG,
      ...extra,
    });
    h.record = {
      id: "rec9", cls: "IT", createdAt: REG, fees: null, vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: REG,
      vendor: { name: "Octagon" }, createdBy: { name: "Ivan Tan", role: "it_staff" }, purchaseOrder: null,
      assets: [asset("0501"), asset("0502", { invoiceRef: "SI-0021", vendorId: "v2", purchasedAt: EARLY })],
    };
    const g = await groupDetail("rec9");
    expect(h.recordArgs!.select.assets.select).toMatchObject({ vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true });
    expect(g!.assets.map((a) => a.money)).toEqual([
      { vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: REG },
      { vendorId: "v2", invoiceRef: "SI-0021", receiptRef: null, purchasedAt: EARLY },
    ]);
    expect(g!.moneyVaries).toBe(true);

    h.record = { ...(h.record as object), assets: [asset("0501")] };
    expect((await groupDetail("rec9"))!.moneyVaries).toBe(false);
  });
});

describe("PO form redesign (task 7): the PO's own money on the group review", () => {
  const po = (extra: Record<string, unknown> = {}) => ({
    id: "po7", refNo: "PO-0215", state: "READY", fees: null, vendorId: "v1", invoiceRef: "44511", receiptRef: null, purchasedAt: REG,
    vendor: { name: "PCWORX" }, poNumber: "2025-0418", paidBy: "CREDIT_CARD", formV2: true, totalsConsistent: false,
    totalSales: D(9100), lessVat: D(975), netOfVat: D(8125), discount: null, amountDue: D(8125), addVat: D(975), totalAmountDue: D(9200),
    lines: [{ id: "l1", description: "Belden Cat6 UTP cable", qty: 1, unitPrice: D(9100) }],
    documents: [],
    ...extra,
  });
  const record = (p: unknown) => ({
    id: "rec7", cls: "IT", createdAt: REG, fees: null, vendorId: "v1", invoiceRef: "44511", receiptRef: null, purchasedAt: REG,
    vendor: { name: "PCWORX" }, createdBy: { name: "Ivan Tan", role: "it_staff" }, purchaseOrder: p, assets: [],
  });
  type Args = { select: { purchaseOrder: { select: Record<string, unknown> & { documents: { where: unknown } } } } };

  it("money carries the PO number, paid by, the seven typed totals and whether they added up; po carries formV2", async () => {
    h.record = record(po());
    const g = await groupDetail("rec7");
    const sel = (h.recordArgs as unknown as Args).select.purchaseOrder.select;
    expect(sel).toMatchObject({
      poNumber: true, paidBy: true, formV2: true, totalsConsistent: true,
      totalSales: true, lessVat: true, netOfVat: true, discount: true, amountDue: true, addVat: true, totalAmountDue: true,
    });
    expect(g!.money).toMatchObject({
      poNumber: "2025-0418", paidBy: "CREDIT_CARD", totalsConsistent: false,
      totals: { totalSales: 9100, lessVat: 975, netOfVat: 8125, discount: null, amountDue: 8125, addVat: 975, totalAmountDue: 9200 },
    });
    expect(g!.po!.formV2).toBe(true);
  });

  it("a legacy PO's totals are all null, and a direct registration has none of the PO's fields", async () => {
    h.record = record(po({
      poNumber: null, paidBy: null, formV2: false, totalsConsistent: null,
      totalSales: null, lessVat: null, netOfVat: null, discount: null, amountDue: null, addVat: null, totalAmountDue: null,
    }));
    const legacy = await groupDetail("rec7");
    expect(legacy!.money).toMatchObject({ poNumber: null, paidBy: null, totalsConsistent: null });
    expect(Object.values(legacy!.money.totals).every((v) => v === null)).toBe(true);
    expect(legacy!.po!.formV2).toBe(false);

    h.record = record(null);
    const direct = await groupDetail("rec7");
    expect(direct!.money).toMatchObject({ poNumber: null, paidBy: null, totalsConsistent: null });
    expect(Object.values(direct!.money.totals).every((v) => v === null)).toBe(true);
  });
});
