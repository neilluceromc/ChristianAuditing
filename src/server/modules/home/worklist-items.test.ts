import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { ColumnsOf, WorkItem } from "@/lib/worklist";

/*
 * Worklist split view (H4) Task 1: worklist() reads each row's columns and panel facts with a fixed number of extra
 * queries — one batched audit read for every asset row's history, one batched read of the latest returns — never
 * one per row.
 */

const day = (iso: string) => new Date(`${iso}T10:00:00+08:00`);
const NOW = day("2026-10-23");

const asset = (id: string, over: Record<string, unknown> = {}) => ({
  id, tag: `BR-LT-${id}`, model: "ThinkPad T14", serial: `SN-${id}`, purchasedAt: day("2023-08-10"), cost: { toString: () => "78500" },
  warrantyUntil: day("2027-08-10"), category: { name: "Laptop" }, ...over,
});

const h = vi.hoisted(() => ({
  triage: [] as unknown[],
  repairs: [] as unknown[],
  missing: [] as unknown[],
  returns: [] as unknown[],
  audit: [] as unknown[],
  queryRaw: vi.fn(),
  returnReads: [] as Prisma.ApprovalFindManyArgs[],
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    approval: {
      findMany: async (args: Prisma.ApprovalFindManyArgs) => {
        if ((args.where as { type?: string }).type === "lifecycle_return") {
          h.returnReads.push(args);
          return h.returns;
        }
        return [];
      },
    },
    asset: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if ("returnedAt" in where) return h.triage;
        if (where.status === "DEFECTIVE") return h.repairs;
        if (where.status === "MISSING") return h.missing;
        return [];
      },
    },
    userPreference: { findUnique: async () => null },
    purchaseOrder: { findMany: async () => [] },
    employee: { findMany: async () => [] },
    $queryRaw: (...args: unknown[]) => h.queryRaw(...args),
  },
}));
vi.mock("@/server/modules/offboarding/queries", () => ({ leaverStates: async () => [] }));
vi.mock("@/server/modules/finance/groups", () => ({ reviewGroups: async () => [] }));

import { worklist } from "./queries";

const items = (groups: Awaited<ReturnType<typeof worklist>>, id: string) =>
  (groups.find((g) => g.section.id === id)?.rows ?? []) as WorkItem[];

beforeEach(() => {
  h.triage = [];
  h.repairs = [];
  h.missing = [];
  h.returns = [];
  h.audit = [];
  h.returnReads = [];
  h.queryRaw.mockReset().mockImplementation(async () => h.audit);
});

describe("worklist() details reads", () => {
  it("reads every asset row's history in ONE batched audit query, and the returns in one more", async () => {
    h.triage = ["t1", "t2", "t3"].map((id) => asset(id, { returnedAt: day("2026-06-03") }));
    h.repairs = ["r1", "r2"].map((id) => asset(id, {
      status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: null, defectiveSince: day("2026-10-01"), repairEndedAt: null, vendor: null,
    }));
    h.missing = [asset("m1", { updatedAt: day("2026-10-13"), assignee: null })];

    await worklist("u1", "admin", {}, NOW);

    expect(h.queryRaw).toHaveBeenCalledTimes(1);
    const sql = h.queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain("ROW_NUMBER() OVER (PARTITION BY");
    expect(sql.values).toContainEqual(["t1", "t2", "t3", "r1", "r2", "m1"]);
    expect(sql.values).toContain(3);

    expect(h.returnReads).toHaveLength(1);
    expect(h.returnReads[0].where).toEqual({ type: "lifecycle_return", state: "EXECUTED", assetId: { in: ["t1", "t2", "t3", "m1"] } });
  });

  it("the triage last holder, department and hand-back note come from the latest return approval", async () => {
    h.triage = [asset("t1", { returnedAt: day("2026-06-03") })];
    h.returns = [
      { assetId: "t1", createdAt: day("2026-01-05"), payload: { reason: "older" }, requestedBy: { name: "Neil Lucero" },
        employee: { name: "Old Holder", department: { name: "Sales", kind: "INTERNAL" } } },
      { assetId: "t1", createdAt: day("2026-06-03"), payload: { reason: "Battery drains fast." }, requestedBy: { name: "Neil Lucero" },
        employee: { name: "Ana Lim", department: { name: "Northwind", kind: "CLIENT" } } },
    ];
    h.audit = [
      { entityId: "t1", action: "lifecycle.return", diff: { returnedAt: { from: null, to: "2026-06-03" } }, actorLabel: "Neil Lucero", createdAt: day("2026-06-03") },
    ];

    const [t] = items(await worklist("u1", "admin", {}, NOW), "triage");
    const c = t.columns as ColumnsOf<"triage">;
    expect(c.lastHolder).toEqual({ name: "Ana Lim", group: { name: "Northwind", kind: "CLIENT" } });
    expect(c.cost).toBe(78500);
    expect(t.detail.note).toEqual({ label: "Hand-back note", text: "Battery drains fast.", by: "Neil Lucero" });
    expect(t.detail.history).toEqual([{ at: day("2026-06-03"), text: "Neil Lucero returned for triage" }]);
    expect(t.detail.facts).toContainEqual({ label: "Warranty", value: "until 10 Aug 2027", tone: "good" });
    // Home's fields are unchanged
    expect(t).toMatchObject({ key: "triage:t1", meta: "back 142 d · triage it", control: { kind: "triage" } });
  });

  it("no asset rows: neither extra read runs", async () => {
    await worklist("u1", "admin", {}, NOW);
    expect(h.queryRaw).not.toHaveBeenCalled();
    expect(h.returnReads).toHaveLength(0);
  });
});
