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
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: {
      findMany: async (args: { where: unknown }) => { h.wheres.push(args.where); return h.rows; },
      groupBy: async (args: { where: unknown }) => { h.wheres.push(args.where); return h.groups; },
    },
  },
}));

import { groupAssets, reviewGroupCount, reviewGroups, REVIEW_GROUP_WHERE, type GroupAssetRow } from "./groups";

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
