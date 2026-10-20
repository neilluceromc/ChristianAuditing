import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 45 (spec §3.4, §6): the bulk transfer action and the single transfer it shares its write with, against a
 * mocked Prisma (the flag-actions.test.ts pattern). Every read, transaction and write is recorded, so "nothing was
 * read" and "nothing was written" are assertions, not hopes.
 */

type Emp = { id: string; name: string; title: string; departmentId: string; employment: string; department: { name: string } };
type Dept = { id: string; name: string; archivedAt: Date | null };

const h = vi.hoisted(() => ({
  user: { id: "u1", name: "Ivy Admin", role: "admin" } as { id: string; name: string; role: string } | null,
  rate: { allowed: true, retryAfterSec: 0 },
  employees: [] as Emp[],
  departments: [] as Dept[],
  reads: 0,
  transactions: 0,
  txOptions: [] as unknown[],
  updates: [] as unknown[],
  transfers: [] as unknown[],
  audits: [] as unknown[],
  updateCount: 1,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({ actionRole: async () => h.user }));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => h.rate }));
vi.mock("@/server/audit", () => ({ writeAudit: async (_tx: unknown, entry: unknown) => { h.audits.push(entry); } }));
vi.mock("@/server/db/client", () => {
  const tx = {
    employee: {
      updateMany: async (args: unknown) => { h.updates.push(args); return { count: h.updateCount }; },
    },
    employeeTransfer: { create: async (args: unknown) => { h.transfers.push(args); return {}; } },
  };
  return {
    prisma: {
      employee: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          h.reads += 1;
          return h.employees.filter((e) => where.id.in.includes(e.id));
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
          h.reads += 1;
          return h.employees.find((e) => e.id === where.id) ?? null;
        },
      },
      department: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          h.reads += 1;
          return h.departments.find((d) => d.id === where.id) ?? null;
        },
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>, opts?: unknown) => {
        h.transactions += 1;
        h.txOptions.push(opts);
        return fn(tx);
      },
    },
  };
});

import { bulkTransferEmployees, transferEmployee } from "./transfer-actions";

const FINANCE = { id: "d-fin", name: "Finance", archivedAt: null };
const SALES = { id: "d-sales", name: "Sales", archivedAt: null };
const emp = (id: string, name: string, title: string, over: Partial<Emp> = {}): Emp => ({
  id, name, title, departmentId: FINANCE.id, employment: "ACTIVE", department: { name: FINANCE.name }, ...over,
});

const bulk = (over: Record<string, unknown> = {}) =>
  bulkTransferEmployees({ ids: ["e2", "e1"], toDepartmentId: SALES.id, effectiveAt: "2026-10-01", note: "Reorganisation", ...over });

beforeEach(() => {
  h.user = { id: "u1", name: "Ivy Admin", role: "admin" };
  h.rate = { allowed: true, retryAfterSec: 0 };
  h.employees = [emp("e1", "Ana Cruz", "Support Lead"), emp("e2", "Ben Reyes", "Analyst")];
  h.departments = [FINANCE, SALES];
  h.reads = 0;
  h.transactions = 0;
  h.txOptions = [];
  h.updates = [];
  h.transfers = [];
  h.audits = [];
  h.updateCount = 1;
});

const nothingWritten = () => {
  expect(h.transactions).toBe(0);
  expect(h.updates).toHaveLength(0);
  expect(h.transfers).toHaveLength(0);
  expect(h.audits).toHaveLength(0);
};

describe("bulkTransferEmployees", () => {
  it("refuses a user without the role before any read", async () => {
    h.user = null;
    expect(await bulk()).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses a rate-limited user before any read", async () => {
    h.rate = { allowed: false, retryAfterSec: 42 };
    expect(await bulk()).toMatchObject({ ok: false, kind: "rate_limited", retryAfterSec: 42 });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses an empty selection with the ids message and no reads", async () => {
    expect(await bulk({ ids: [] })).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { ids: "Pick at least one person" },
    });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses 201 people with the ids message and no reads", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `e${i}`);
    expect(await bulk({ ids })).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { ids: "Pick no more than 200 people" },
    });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("returns the blocked people, in page order, and runs no transaction", async () => {
    h.employees = [
      emp("e1", "Ana Cruz", "Support Lead"),
      emp("e2", "Ben Reyes", "Analyst", { departmentId: SALES.id, department: { name: SALES.name } }),
      emp("e3", "Cora Lim", "Agent", { employment: "OFFBOARDED" }),
    ];
    const r = await bulk({ ids: ["e3", "e1", "e2"] });
    expect(r).toMatchObject({ ok: false, kind: "conflict", message: "2 people can't be transferred" });
    expect(!r.ok && r.blocked).toEqual([
      { id: "e3", name: "Cora Lim", reason: "Has left" },
      { id: "e2", name: "Ben Reyes", reason: "Already works for this group" },
    ]);
    nothingWritten();
  });

  it("blocks everyone for an archived destination", async () => {
    h.departments = [FINANCE, { ...SALES, archivedAt: new Date("2026-09-01T00:00:00Z") }];
    const r = await bulk();
    expect(!r.ok && r.blocked?.map((b) => b.reason)).toEqual(["That group is archived", "That group is archived"]);
    nothingWritten();
  });

  it("refuses a selection with a missing person", async () => {
    expect(await bulk({ ids: ["e1", "gone"] })).toMatchObject({
      ok: false, kind: "conflict", message: "Someone in this selection no longer exists — reload and try again.",
    });
    nothingWritten();
  });

  it("transfers two people in ONE transaction, each keeping their own title, written in id order", async () => {
    const r = await bulk();
    expect(r).toEqual({ ok: true, data: { count: 2 } });
    expect(h.transactions).toBe(1);
    expect(h.txOptions[0]).toEqual({ timeout: 60_000, maxWait: 10_000 });

    const effectiveAt = new Date("2026-10-01T00:00:00Z");
    // ids were sent as e2, e1; the writes go e1 then e2
    expect(h.updates).toEqual([
      { where: { id: "e1", departmentId: FINANCE.id }, data: { departmentId: SALES.id, title: "Support Lead" } },
      { where: { id: "e2", departmentId: FINANCE.id }, data: { departmentId: SALES.id, title: "Analyst" } },
    ]);
    expect(h.transfers).toEqual([
      {
        data: {
          employeeId: "e1", fromDepartmentId: FINANCE.id, toDepartmentId: SALES.id,
          fromTitle: "Support Lead", toTitle: "Support Lead", effectiveAt, reason: "Reorganisation", actorId: "u1",
        },
      },
      {
        data: {
          employeeId: "e2", fromDepartmentId: FINANCE.id, toDepartmentId: SALES.id,
          fromTitle: "Analyst", toTitle: "Analyst", effectiveAt, reason: "Reorganisation", actorId: "u1",
        },
      },
    ]);
    expect(h.audits).toEqual([
      {
        actorId: "u1", actorLabel: "Ivy Admin", entityType: "employee", entityId: "e1", action: "employee.transferred",
        diff: {
          department: { from: "Finance", to: "Sales" },
          title: { from: "Support Lead", to: "Support Lead" },
          effectiveAt: { from: null, to: effectiveAt },
        },
      },
      {
        actorId: "u1", actorLabel: "Ivy Admin", entityType: "employee", entityId: "e2", action: "employee.transferred",
        diff: {
          department: { from: "Finance", to: "Sales" },
          title: { from: "Analyst", to: "Analyst" },
          effectiveAt: { from: null, to: effectiveAt },
        },
      },
    ]);
  });

  it("stores an empty note as no reason", async () => {
    await bulk({ note: undefined });
    expect(h.transfers.map((t) => (t as { data: { reason: unknown } }).data.reason)).toEqual([null, null]);
  });

  it("turns a race on anyone into the conflict naming them (the transaction throws, so it rolls back)", async () => {
    h.updateCount = 0;
    expect(await bulk()).toMatchObject({
      ok: false, kind: "conflict", message: "Someone else just transferred Ana Cruz — reload and try again.",
    });
    expect(h.transfers).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });
});

describe("transferEmployee (the single path through the shared write)", () => {
  const single = (over: Record<string, unknown> = {}) =>
    transferEmployee({
      employeeId: "e1", toDepartmentId: SALES.id, toTitle: "Team Lead", effectiveAt: "2026-10-01", reason: "Promotion", ...over,
    });

  it("writes the employee, the transfer row and the audit diff exactly as before", async () => {
    const r = await single();
    expect(r).toEqual({ ok: true, data: { id: "e1" } });
    expect(h.transactions).toBe(1);
    expect(h.txOptions[0]).toBeUndefined();
    const effectiveAt = new Date("2026-10-01T00:00:00Z");
    expect(h.updates).toEqual([
      { where: { id: "e1", departmentId: FINANCE.id }, data: { departmentId: SALES.id, title: "Team Lead" } },
    ]);
    expect(h.transfers).toEqual([
      {
        data: {
          employeeId: "e1", fromDepartmentId: FINANCE.id, toDepartmentId: SALES.id,
          fromTitle: "Support Lead", toTitle: "Team Lead", effectiveAt, reason: "Promotion", actorId: "u1",
        },
      },
    ]);
    expect(h.audits).toEqual([
      {
        actorId: "u1", actorLabel: "Ivy Admin", entityType: "employee", entityId: "e1", action: "employee.transferred",
        diff: {
          department: { from: "Finance", to: "Sales" },
          title: { from: "Support Lead", to: "Team Lead" },
          effectiveAt: { from: null, to: effectiveAt },
        },
      },
    ]);
  });

  it("keeps its own refusals and race message", async () => {
    expect(await single({ toDepartmentId: FINANCE.id })).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { toDepartmentId: "Already in this department" },
    });
    nothingWritten();
    h.updateCount = 0;
    expect(await single()).toMatchObject({
      ok: false, kind: "conflict", message: "Someone else just transferred this person — reload and try again.",
    });
    expect(h.transfers).toHaveLength(0);
  });
});
