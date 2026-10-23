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
  assetSelects: [] as Array<Record<string, unknown>>,
  poArgs: [] as Prisma.PurchaseOrderFindManyArgs[],
  approvalArgs: [] as Prisma.ApprovalFindManyArgs[],
  pos: [] as unknown[],
  /** the people a return's history line names (polish), and the reads that asked for them */
  holders: [] as unknown[],
  holderReads: [] as Prisma.EmployeeFindManyArgs[],
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    approval: {
      findMany: async (args: Prisma.ApprovalFindManyArgs) => {
        if ((args.where as { type?: string }).type === "lifecycle_return") {
          h.returnReads.push(args);
          return h.returns;
        }
        h.approvalArgs.push(args);
        return [];
      },
    },
    asset: {
      findMany: async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        h.assetSelects.push(select);
        if ("returnedAt" in where) return h.triage;
        if (where.status === "DEFECTIVE") return h.repairs;
        if (where.status === "MISSING") return h.missing;
        return [];
      },
    },
    userPreference: { findUnique: async () => null },
    purchaseOrder: {
      findMany: async (args: Prisma.PurchaseOrderFindManyArgs) => {
        h.poArgs.push(args);
        return h.pos;
      },
    },
    employee: {
      findMany: async (args: Prisma.EmployeeFindManyArgs) => {
        if (!args.where?.OR) return [];
        h.holderReads.push(args);
        return h.holders;
      },
    },
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
  h.assetSelects = [];
  h.poArgs = [];
  h.approvalArgs = [];
  h.pos = [];
  h.holders = [];
  h.holderReads = [];
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
    expect(sql.sql).toMatch(/ORDER BY h\."entityId", h\.rn\s*$/);

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
      { entityId: "t1", action: "lifecycle.return", diff: { returnedAt: { from: null, to: "2026-06-03" }, assignee: { from: "EMP-0077", to: null } }, actorLabel: "Neil Lucero", createdAt: day("2026-06-03") },
    ];
    h.holders = [{ id: "e77", employeeNo: "EMP-0077", name: "Ana Lim" }];

    const [t] = items(await worklist("u1", "admin", {}, NOW), "triage");
    const c = t.columns as ColumnsOf<"triage">;
    expect(c.lastHolder).toEqual({ name: "Ana Lim", group: { name: "Northwind", kind: "CLIENT" } });
    expect(c.cost).toBe(78500);
    expect(t.detail.note).toEqual({ label: "Note when returned", text: "Battery drains fast.", by: "Neil Lucero" });
    // polish: the history names who handed it back (the diff's employee number, read in one more query) and who recorded it
    expect(t.detail.history).toEqual([{ at: day("2026-06-03"), text: "Ana Lim returned it · recorded by Neil Lucero" }]);
    expect(h.holderReads).toHaveLength(1);
    expect(h.holderReads[0].where).toEqual({ OR: [{ employeeNo: { in: ["EMP-0077"] } }, { id: { in: ["EMP-0077"] } }] });
    expect(t.detail.facts).toContainEqual({ label: "Warranty", value: "until 10 Aug 2027", tone: "good" });
    // Home's fields are unchanged
    expect(t).toMatchObject({ key: "triage:t1", meta: "back 142 d · triage it", control: { kind: "triage" } });
  });

  it("no asset rows: neither extra read runs", async () => {
    await worklist("u1", "admin", {}, NOW);
    expect(h.queryRaw).not.toHaveBeenCalled();
    expect(h.returnReads).toHaveLength(0);
  });

  it("the typed amount due reaches the PO panel only when Purchasing typed one (fix round 1, I3)", async () => {
    const po = (id: string, totalAmountDue: unknown) => ({
      id, refNo: `PO-${id}`, submittedAt: day("2026-10-19"), updatedAt: day("2026-10-19"), invoiceRef: "SI-1", totalAmountDue,
      requestedBy: { name: "Pia Santos" }, department: { name: "HR" }, vendor: { name: "PC Express" },
      lines: [{ description: "Monitor", qty: 2, unitPrice: { toString: () => "11900" } }], _count: { lines: 1 },
    });
    h.pos = [po("1", { toString: () => "23520" }), po("2", null)];
    const [a, b] = items(await worklist("u1", "admin", {}, NOW), "purchases");
    expect((h.poArgs[0].select as Record<string, unknown>).totalAmountDue).toBe(true);
    expect(a.detail.facts).toContainEqual({ label: "Amount due", value: "₱23,520" });
    expect(a.detail.facts).toContainEqual({ label: "Total", value: "₱23,800" });
    expect(b.detail.facts.map((f) => f.label)).not.toContain("Amount due");
  });

  it("details: false (Home) — no detail reads, the narrow selects, and plain rows (fix round 1, M5)", async () => {
    h.triage = [{ id: "t1", tag: "BR-LT-t1", model: "ThinkPad T14", returnedAt: day("2026-06-03") }];
    h.missing = [{ id: "m1", tag: "BR-LT-m1", model: "ThinkPad T14", updatedAt: day("2026-10-13") }];
    const groups = await worklist("u1", "admin", { limit: 6, details: false }, NOW);

    expect(h.queryRaw).not.toHaveBeenCalled();
    expect(h.returnReads).toHaveLength(0);
    // the narrow selects: no panel facts, no party joins, no PO lines beyond the first
    for (const sel of h.assetSelects) {
      for (const k of ["serial", "purchasedAt", "warrantyUntil", "category", "purchaseOrder", "purchaseRecord"]) expect(sel).not.toHaveProperty(k);
    }
    const poSelect = h.poArgs[0].select as Record<string, { take?: number }>;
    expect(poSelect.lines.take).toBe(1);
    expect(poSelect).not.toHaveProperty("totalAmountDue");
    for (const a of h.approvalArgs) expect(a.include).not.toHaveProperty("requestedBy");

    const triage = groups.find((g) => g.section.id === "triage")!.rows[0];
    expect(triage).toEqual({
      key: "triage:t1", section: "triage", title: "BR-LT-t1 · ThinkPad T14", meta: "back 142 d · triage it",
      href: "/inventory/t1", action: "Triage", severity: 142, ageDays: 142,
      control: { kind: "triage", asset: { id: "t1", tag: "BR-LT-t1", model: "ThinkPad T14" } },
      entity: { kind: "asset", id: "t1", label: "BR-LT-t1" },
    });
    expect(groups.find((g) => g.section.id === "missing")!.rows[0]).not.toHaveProperty("detail");
  });
});
