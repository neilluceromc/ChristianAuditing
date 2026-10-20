import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { SNAPSHOT_KEYS } from "@/lib/snapshot";

/*
 * Phase 46 (spec §2.2, §2.3): each key comes from its live helper, and writeSnapshot upserts one row per key on
 * (Manila day, key) in one transaction. The helpers and Prisma are mocked; the predicates passed to Prisma are real.
 */

const h = vi.hoisted(() => ({
  upserts: [] as Array<{ where: unknown; create: unknown; update: unknown }>,
  transactions: 0,
  approvalWheres: [] as unknown[],
  assetWheres: [] as unknown[],
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    approval: {
      count: async ({ where }: { where: Prisma.ApprovalWhereInput }) => {
        h.approvalWheres.push(where);
        const [, cls, sla] = where.AND as Prisma.ApprovalWhereInput[];
        const base = "assetId" in cls ? 3 : JSON.stringify(cls).includes("PURCHASING") ? 2 : 1;
        return "slaAt" in sla ? base * 10 : base * 100;
      },
    },
    asset: {
      count: async ({ where }: { where: Prisma.AssetWhereInput }) => {
        h.assetWheres.push(where);
        return JSON.stringify(where).includes('"cls":"PURCHASING"') ? 6 : 5;
      },
    },
    metricSnapshot: {
      upsert: (args: { where: unknown; create: unknown; update: unknown }) => {
        h.upserts.push(args);
        return args;
      },
    },
    $transaction: async (ops: unknown[]) => {
      h.transactions += 1;
      return ops;
    },
  },
}));
vi.mock("@/server/modules/inventory/queries", () => ({
  inventoryTileCounts: async () => ({ "in-stock": 11, deployed: 12, "on-loan": 99, "in-repair": 13, missing: 14, attention: 15 }),
}));
vi.mock("@/server/modules/purchases/queries", () => ({
  stateCounts: async () => ({ ALL: 50, DRAFT: 1, SUBMITTED: 21, IT_REVIEWED: 22, COMPLETED: 3, CANCELLED: 3 }),
}));
vi.mock("@/server/modules/stock/queries", () => ({
  stockHomeSignals: async (today: string) => (today === "2026-10-21" ? { low: 31, expiringLots: 32, stocktakesOverdue: 33 } : null),
}));
vi.mock("@/server/modules/finance/depreciation-queries", async (orig) => ({
  ...(await orig<object>()),
  bookValueTotals: async () => ({ costC: 0, accumulatedC: 0, bookC: 123_456_789, asOf: 0 }),
}));
vi.mock("@/server/modules/admin/queries", () => ({
  adminHome: async () => ({ users: { total: 40, disabled: 4, byRole: [] }, flags: [], webhooks: { endpoints: 0, inactive: 0, dead: 7, delivered: 0 } }),
}));
vi.mock("@/server/modules/home/queries", async (orig) => ({
  ...(await orig<object>()),
  financeWaitingRows: async () => [
    { units: [{ qty: 2, unitPrice: "1000.10" }, { qty: 1, unitPrice: null }] },
    { units: [{ qty: 3, unitPrice: "0.30" }] },
  ],
}));

import { collectSnapshot, writeSnapshot } from "./snapshot";

// 2026-10-20T16:30Z is 00:30 on 2026-10-21 in Manila
const NOW = new Date("2026-10-20T16:30:00Z");

beforeEach(() => {
  h.upserts = [];
  h.transactions = 0;
  h.approvalWheres = [];
  h.assetWheres = [];
});

describe("collectSnapshot", () => {
  it("maps every key from its live helper, as BigInt", async () => {
    const v = await collectSnapshot(NOW);
    expect(Object.keys(v)).toEqual([...SNAPSHOT_KEYS]);
    expect(Object.values(v).every((x) => typeof x === "bigint")).toBe(true);
    expect(v).toEqual({
      "it.spare": 11n, "it.deployed": 12n, "it.defective": 13n, "it.missing": 14n, "it.attention": 15n,
      "approvals.open.it": 100n, "approvals.open.purchasing": 200n, "approvals.open.none": 300n,
      "approvals.pastSla.it": 10n, "approvals.pastSla.purchasing": 20n, "approvals.pastSla.none": 30n,
      "pr.submitted": 21n, "pr.itReviewed": 22n,
      "stock.low": 31n, "stock.expiringLots": 32n, "stock.stocktakesOverdue": 33n,
      // 2 × 1000.10 + 3 × 0.30 = ₱2,001.10
      "fin.waitingC": 200_110n, "fin.waitingCount": 2n,
      "fin.toConfirm.it": 5n, "fin.toConfirm.purchasing": 6n, "fin.bookC": 123_456_789n,
      "admin.activeUsers": 36n, "admin.disabled": 4n, "admin.deadDeliveries": 7n,
    });
  });

  it("counts approvals on the Open tab per class, past SLA as slaAt < now", async () => {
    await collectSnapshot(NOW);
    expect(h.approvalWheres).toHaveLength(6);
    for (const w of h.approvalWheres as Array<{ AND: unknown[] }>) {
      expect(w.AND[0]).toEqual({ state: { in: ["PENDING", "CLAIMED"] } });
    }
    const classes = (h.approvalWheres as Array<{ AND: unknown[] }>).map((w) => w.AND[1]);
    expect(classes).toEqual([
      { asset: { cls: "IT" } }, { asset: { cls: "PURCHASING" } }, { assetId: null },
      { asset: { cls: "IT" } }, { asset: { cls: "PURCHASING" } }, { assetId: null },
    ]);
    const sla = (h.approvalWheres as Array<{ AND: unknown[] }>).map((w) => w.AND[2]);
    expect(sla.slice(0, 3)).toEqual([{}, {}, {}]);
    expect(sla.slice(3)).toEqual([{ slaAt: { lt: NOW } }, { slaAt: { lt: NOW } }, { slaAt: { lt: NOW } }]);
  });

  it("counts To confirm with /finance/assets' own with-finance predicate, per class", async () => {
    await collectSnapshot(NOW);
    expect(h.assetWheres).toHaveLength(2);
    const [it, purchasing] = h.assetWheres as Array<{ AND: Array<Record<string, unknown>> }>;
    expect(it.AND[0]).toEqual({ cls: "IT" });
    expect(purchasing.AND[0]).toEqual({ cls: "PURCHASING" });
    expect(it.AND[1]).toMatchObject({ financeConfirmedAt: null, financeReturnedAt: null });
  });

  it("a failed read throws (no made-up 0)", async () => {
    await expect(collectSnapshot(new Date("2026-10-20T03:00:00Z"))).rejects.toThrow();
  });
});

describe("writeSnapshot", () => {
  it("upserts every key on (Manila day, key) in one transaction", async () => {
    await writeSnapshot(NOW);
    expect(h.transactions).toBe(1);
    expect(h.upserts).toHaveLength(SNAPSHOT_KEYS.length);
    const day = new Date("2026-10-21T00:00:00.000Z");
    expect(h.upserts.map((u) => u.where)).toEqual(SNAPSHOT_KEYS.map((key) => ({ day_key: { day, key } })));
    expect(h.upserts[0]).toEqual({
      where: { day_key: { day, key: "it.spare" } },
      create: { day, key: "it.spare", value: 11n },
      update: { value: 11n },
    });
  });
});
