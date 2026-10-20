import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

/*
 * Phase 46 Task 3: the new aggregates' reads (windows, predicates) and the "this month" switch to the Manila month in
 * purchasingHome / financeHome. Prisma is mocked; every where passed to it is recorded.
 */

const h = vi.hoisted(() => ({
  prWheres: [] as Prisma.PurchaseRequestWhereInput[],
  approvalWheres: [] as Prisma.ApprovalWhereInput[],
  deliveryArgs: [] as unknown[],
  completed: [] as unknown[],
  directRows: [] as unknown[],
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    purchaseRequest: {
      findMany: async ({ where }: { where: Prisma.PurchaseRequestWhereInput }) => {
        h.prWheres.push(where);
        return where.state === "COMPLETED" ? h.completed : [];
      },
      groupBy: async () => [],
    },
    approval: {
      count: async () => 0,
      findMany: async ({ where }: { where: Prisma.ApprovalWhereInput }) => {
        h.approvalWheres.push(where);
        return h.directRows;
      },
    },
    asset: { count: async () => 0, aggregate: async () => ({ _sum: { cost: null }, _count: { _all: 0 } }) },
    webhookDelivery: {
      groupBy: async (args: unknown) => {
        h.deliveryArgs.push(args);
        return [{ status: "DELIVERED", _count: { _all: 9 } }, { status: "DEAD", _count: { _all: 2 } }];
      },
    },
  },
}));
vi.mock("@/server/modules/stock/queries", () => ({
  stockHomeSignals: async () => ({ low: 0, expiringLots: 0, stocktakesOverdue: 0 }),
}));
vi.mock("@/server/modules/finance/depreciation-queries", () => ({
  bookValueTotals: async () => ({ costC: 0, accumulatedC: 0, bookC: 0, asOf: 0 }),
}));

import {
  completedSpend, directChangesByDay, financeHome, purchasingHome, spendByDepartment, spendBySupplier,
} from "./queries";
import { deliveriesByStatus } from "@/server/modules/admin/queries";

// 2026-10-31T17:00Z is 01:00 on Sun 2026-11-01 in Manila: the UTC month is still October, the Manila month November.
const MONTH_EDGE = new Date("2026-10-31T17:00:00Z");
const MANILA_NOV_1 = "2026-10-31T16:00:00.000Z";
const NOW = new Date("2026-10-20T03:00:00Z");

const units = (pesos: number) => [{ qty: 1, unitPrice: String(pesos) }];

beforeEach(() => {
  h.prWheres = [];
  h.approvalWheres = [];
  h.deliveryArgs = [];
  h.completed = [];
  h.directRows = [];
});

const completedGte = () =>
  h.prWheres.filter((w) => w.state === "COMPLETED").map((w) => (w.completedAt as { gte: Date }).gte.toISOString());

describe("this month is the Manila month (builder-check ruling)", () => {
  it("purchasingHome's Spend this month starts at Manila midnight on the 1st", async () => {
    await purchasingHome("u1", "purchasing_staff", MONTH_EDGE);
    expect(completedGte()).toEqual([MANILA_NOV_1]);
  });
  it("financeHome's Approved this month starts at Manila midnight on the 1st", async () => {
    await financeHome(MONTH_EDGE);
    expect(completedGte()).toEqual([MANILA_NOV_1]);
  });
  it("Spend this month sums the completed requests' values", async () => {
    h.completed = [
      { completedAt: new Date("2026-11-01T00:00:00Z"), units: units(1200.4), vendor: null, department: null },
      { completedAt: new Date("2026-11-01T01:00:00Z"), units: [{ qty: 2, unitPrice: "100" }, { qty: 1, unitPrice: null }], vendor: null, department: null },
    ];
    expect((await purchasingHome("u1", "purchasing_staff", MONTH_EDGE)).spendThisMonth).toBe("₱1,400");
  });
});

describe("completedSpend / spendBySupplier / spendByDepartment", () => {
  it("completedSpend reads COMPLETED requests since the bound and values each one", async () => {
    h.completed = [{ completedAt: new Date("2026-10-19T02:00:00Z"), units: units(10.5), vendor: { name: "Acme" }, department: { name: "Ops" } }];
    const since = new Date("2026-10-01T00:00:00Z");
    expect(await completedSpend(since)).toEqual([
      { at: new Date("2026-10-19T02:00:00Z"), amount: 10.5, supplier: "Acme", department: "Ops" },
    ]);
    expect(h.prWheres).toEqual([{ state: "COMPLETED", completedAt: { gte: since } }]);
  });

  it("spendBySupplier: this Manila month, the top 7 suppliers and Other, no supplier named as such", async () => {
    h.completed = [
      ...Array.from({ length: 9 }, (_, i) => ({
        completedAt: NOW, units: units(100 - i), vendor: { name: `S${i}` }, department: null,
      })),
      { completedAt: NOW, units: units(500), vendor: null, department: null },
    ];
    const rows = await spendBySupplier(NOW);
    expect(completedGte()).toEqual(["2026-09-30T16:00:00.000Z"]);
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["No supplier", 500], ["S0", 100], ["S1", 99], ["S2", 98], ["S3", 97], ["S4", 96], ["S5", 95], ["Other", 94 + 93 + 92],
    ]);
  });

  it("spendByDepartment: this Manila quarter (Oct 1 for an October date)", async () => {
    h.completed = [{ completedAt: NOW, units: units(42), vendor: null, department: null }];
    expect(await spendByDepartment(new Date("2026-11-15T03:00:00Z"))).toEqual([{ label: "No department", value: 42 }]);
    expect(completedGte()).toEqual(["2026-09-30T16:00:00.000Z"]);
  });
});

describe("directChangesByDay", () => {
  it("reads direct changes resolved in the 14 Manila days ending today, split by the asset's class", async () => {
    h.directRows = [
      { resolvedAt: new Date("2026-10-19T17:00:00Z"), asset: { cls: "IT" } }, // Oct 20 01:00 Manila → today
      { resolvedAt: new Date("2026-10-19T15:00:00Z"), asset: { cls: "PURCHASING" } }, // Oct 19 Manila
      { resolvedAt: new Date("2026-10-07T02:00:00Z"), asset: { cls: "IT" } }, // first day
    ];
    const r = await directChangesByDay(NOW, 14);
    expect(h.approvalWheres).toEqual([{ appliedDirectly: true, resolvedAt: { gte: new Date("2026-10-06T16:00:00.000Z") } }]);
    expect(r.labels).toHaveLength(14);
    expect(r.labels.at(-1)).toBe("20 Oct");
    expect(r.it).toEqual([1, ...Array(12).fill(0), 1]);
    expect(r.purchasing).toEqual([...Array(12).fill(0), 1, 0]);
  });
});

describe("deliveriesByStatus", () => {
  it("groups the last 7 Manila days' deliveries by status, every status present", async () => {
    expect(await deliveriesByStatus(NOW, 7)).toEqual({ PENDING: 0, RETRYING: 0, DELIVERED: 9, DEAD: 2 });
    expect(h.deliveryArgs).toEqual([
      { by: ["status"], where: { createdAt: { gte: new Date("2026-10-13T16:00:00.000Z") } }, _count: { _all: true } },
    ]);
  });
});
