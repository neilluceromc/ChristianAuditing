import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

/*
 * Phase 46 Task 3: the new aggregates' reads (windows, predicates). Prisma is mocked; every where passed to it is
 * recorded.
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

import { completedSpend } from "./queries";
import { deliveriesByStatus } from "@/server/modules/admin/queries";

const NOW = new Date("2026-10-20T03:00:00Z");

const units = (pesos: number) => [{ qty: 1, unitPrice: String(pesos) }];

beforeEach(() => {
  h.prWheres = [];
  h.approvalWheres = [];
  h.deliveryArgs = [];
  h.completed = [];
  h.directRows = [];
});

describe("completedSpend", () => {
  it("completedSpend reads COMPLETED requests since the bound and values each one", async () => {
    h.completed = [{ completedAt: new Date("2026-10-19T02:00:00Z"), units: units(10.5), vendor: { name: "Acme" }, department: { name: "Ops" } }];
    const since = new Date("2026-10-01T00:00:00Z");
    expect(await completedSpend(since)).toEqual([
      { at: new Date("2026-10-19T02:00:00Z"), amount: 10.5, supplier: "Acme", department: "Ops" },
    ]);
    expect(h.prWheres).toEqual([{ state: "COMPLETED", completedAt: { gte: since } }]);
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
