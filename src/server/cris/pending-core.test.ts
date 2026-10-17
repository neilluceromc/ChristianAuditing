import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";

/*
 * Confirm and Undo against an in-memory transaction: a thrown refusal restores every row, as Postgres would.
 * The lifecycle cores are stubbed (direct.test.ts covers them); prepareLifecycle/commitLifecycle run for real.
 */

type Asset = {
  id: string; tag: string; cls: "IT"; status: string; assigneeId: string | null; typeId: string | null;
  defectiveSince: Date | null; repairEndedAt: Date | null; returnedAt: Date | null; loanDueAt: Date | null; model: string;
};
type Pending = {
  id: string; userId: string; conversationId: string; kind: string; input: unknown; card: unknown;
  createdAt: Date; expiresAt: Date; usedAt: Date | null; undoneAt: Date | null; resultRef: string | null;
};
type State = {
  pending: Pending[]; assets: Asset[]; holds: Array<{ id: string; assetId: string; employeeId: string; state: string }>;
  audits: Array<{ id: string; entityType: string; entityId: string; createdAt: Date }>; messages: Array<{ id: string; role: string; content: unknown; createdAt: Date }>;
};

const h = vi.hoisted(() => ({
  state: null as unknown as State,
  coreCalls: [] as Array<{ kind: string; opts: unknown }>,
  coreRefusal: null as null | string,
  written: [] as Array<{ action: string; entityId: string; diff: Record<string, { from: unknown; to: unknown }> }>,
  approvals: [] as Array<{ type: string; payload: { reason?: string } }>,
  spares: [] as Array<{ employeeId: string; typeId: string | null }>,
}));

const clone = (s: State): State => ({
  pending: s.pending.map((p) => ({ ...p })), assets: s.assets.map((a) => ({ ...a })), holds: s.holds.map((x) => ({ ...x })),
  audits: [...s.audits], messages: [...s.messages],
});

function matches<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const op = v as { in?: unknown[]; notIn?: unknown[]; gte?: Date; not?: unknown };
      if (op.in) return op.in.includes(row[k]);
      if (op.notIn) return !op.notIn.includes(row[k]);
      if (op.gte) return (row[k] as Date).getTime() >= op.gte.getTime();
      return true;
    }
    if (v instanceof Date) return (row[k] as Date | null)?.getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTx() {
  const s = () => h.state;
  return {
    crisPendingAction: {
      findUnique: async ({ where }: { where: { id: string } }) => s().pending.find((p) => p.id === where.id) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Pending> }) => {
        const rows = s().pending.filter((p) => matches(p, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Pending> }) => {
        Object.assign(s().pending.find((p) => p.id === where.id)!, data);
      },
      create: async ({ data }: { data: Omit<Pending, "id" | "createdAt" | "usedAt" | "undoneAt" | "resultRef"> }) => {
        const row: Pending = { ...data, id: `p${s().pending.length + 1}`, createdAt: new Date(), usedAt: null, undoneAt: null, resultRef: null };
        s().pending.push(row);
        return { id: row.id };
      },
    },
    asset: {
      findUnique: async ({ where }: { where: { id: string } }) => s().assets.find((a) => a.id === where.id) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => s().assets.filter((a) => matches(a, where)),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const a = s().assets.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (k === "assignee") a.assigneeId = (v as { disconnect?: boolean; connect?: { id: string } }).connect?.id ?? null;
          else (a as Record<string, unknown>)[k] = v;
        }
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = s().assets.filter((a) => matches(a, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    employee: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "emp1" ? { id: "emp1", name: "Ana Reyes", employeeNo: "EMP-0101", employment: "ACTIVE" } : null,
    },
    reservation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => s().holds.find((x) => matches(x, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => s().holds.find((x) => x.id === where.id) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = s().holds.filter((x) => matches(x, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    auditEntry: {
      findFirst: async ({ where }: { where: { entityId: string } }) => ({ id: `own-${where.entityId}` }),
      count: async ({ where }: { where: Record<string, unknown> }) => s().audits.filter((x) => matches(x, where)).length,
    },
    crisConversation: {
      count: async ({ where }: { where: { id: string } }) => (where.id === "c1" ? 1 : 0),
      update: async () => ({}),
    },
    crisMessage: {
      create: async ({ data }: { data: { role: string; content: unknown } }) => {
        const row = { id: `m${s().messages.length + 1}`, conversationId: "c1", ...data, createdAt: new Date("2026-10-17T10:00:01.000Z") };
        s().messages.push(row);
        return row;
      },
    },
  };
}

vi.mock("@/server/db/client", () => {
  const tx = makeTx();
  return {
    prisma: {
      ...tx,
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => {
        const saved = clone(h.state);
        try { return await fn(tx); } catch (err) { h.state = saved; throw err; }
      },
    },
  };
});

vi.mock("@/server/modules/lifecycle/direct", async (importActual) => {
  const actual = await importActual<typeof import("@/server/modules/lifecycle/direct")>();
  const { conflict, ok } = await import("@/server/action-result");
  return {
    ...actual,
    loadDirect: async (tx: { asset: { findUnique: (a: unknown) => Promise<unknown> } }, _u: unknown, id: string) => {
      const asset = await tx.asset.findUnique({ where: { id } });
      return asset ? { asset } : { failure: conflict("That asset no longer exists.") };
    },
    assignCore: async (_tx: unknown, _u: unknown, d: { assetId: string; employeeId: string }, opts: { dryRun?: boolean }) => {
      h.coreCalls.push({ kind: "assign", opts });
      if (h.coreRefusal) return conflict(h.coreRefusal);
      if (!opts.dryRun) {
        Object.assign(h.state.assets.find((a) => a.id === d.assetId)!, { status: "DEPLOYED", assigneeId: d.employeeId });
        for (const x of h.state.holds) if (x.assetId === d.assetId && x.employeeId === d.employeeId) x.state = "FULFILLED";
      }
      return ok({ tag: "BR-LT-0230", employeeName: "Ana Reyes" });
    },
    replaceCore: async (_tx: unknown, _u: unknown, d: { oldAssetId: string; newAssetId: string; employeeId: string }, opts: { dryRun?: boolean }) => {
      h.coreCalls.push({ kind: "replace", opts });
      if (h.coreRefusal) return conflict(h.coreRefusal);
      if (!opts.dryRun) {
        Object.assign(h.state.assets.find((a) => a.id === d.oldAssetId)!, { status: "DEFECTIVE", assigneeId: null, defectiveSince: new Date("2026-10-17T10:00:00.000Z") });
        Object.assign(h.state.assets.find((a) => a.id === d.newAssetId)!, { status: "DEPLOYED", assigneeId: d.employeeId });
      }
      return ok({ oldTag: "BR-LT-0148", newTag: "BR-LT-0230" });
    },
  };
});

vi.mock("./cards", () => ({
  readPerson: async (_tx: unknown, id: string) => (id === "emp1" ? { id, name: "Ana Reyes", employeeNo: "EMP-0101", worksFor: "Acme Health" } : null),
  readAsset: async (_tx: unknown, id: string) => ({ id, tag: id === "a0" ? "BR-LT-0148" : "BR-LT-0230", model: "Latitude", serial: null, typeId: "t1", typeName: "Laptop", warrantyUntil: null, backOn: null }),
  sparesCard: async (_tx: unknown, employeeId: string, opts: { typeId: string | null }) => {
    h.spares.push({ employeeId, typeId: opts.typeId });
    return { type: "spares", employeeId, offset: 0, more: false, options: [{ assetId: "a2", tag: "BR-LT-0231", model: "Latitude", typeName: "Laptop", warrantyEnd: null, backOn: null }] };
  },
}));
vi.mock("@/server/audit", () => ({
  writeAudit: async (_tx: unknown, e: { action: string; entityId: string; diff: Record<string, { from: unknown; to: unknown }> }) => { h.written.push(e); },
}));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async () => {} }));
vi.mock("@/server/modules/approvals/create", () => ({
  createApproval: async (_tx: unknown, input: { type: string; payload: { reason?: string } }) => { h.approvals.push(input); return { id: "apr", refNo: "APR-1", type: input.type }; },
}));

import { confirmPending, createPending, undoPending } from "./pending-core";
import { CRIS_ALREADY_DONE, CRIS_CHANGED_SINCE, CRIS_EXPIRED, parseResultRef } from "@/lib/cris-undo";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@prisma/client";

const user = { id: "u1", name: "Neil Lucero", role: "it_staff" } as User;
const now = new Date("2026-10-17T10:00:00.000Z");
const later = (sec: number) => new Date(now.getTime() + sec * 1000);
const asset = (id: string, tag: string, status: string, assigneeId: string | null = null): Asset => ({
  id, tag, cls: "IT", status, assigneeId, typeId: "t1", defectiveSince: null, repairEndedAt: null, returnedAt: null, loanDueAt: null, model: "Latitude",
});
const pendingRow = (over: Partial<Pending> = {}): Pending => ({
  id: "p1", userId: "u1", conversationId: "c1", kind: "assign", input: { assetId: "a1", employeeId: "emp1" }, card: {},
  createdAt: now, expiresAt: later(600), usedAt: null, undoneAt: null, resultRef: null, ...over,
});

beforeEach(() => {
  h.state = {
    pending: [pendingRow()],
    assets: [asset("a1", "BR-LT-0230", "SPARE"), asset("a0", "BR-LT-0148", "DEPLOYED", "emp1")],
    holds: [{ id: "r1", assetId: "a1", employeeId: "emp1", state: "ACTIVE" }],
    audits: [], messages: [],
  };
  h.coreCalls.length = 0; h.coreRefusal = null; h.written.length = 0; h.approvals.length = 0; h.spares.length = 0;
});

describe("createPending", () => {
  it("dry-runs the real action, stores the pending action and returns the card from DB reads", async () => {
    h.state.pending = [];
    const r = await createPending(prisma as unknown as Prisma.TransactionClient, user, "c1", "assign", { assetId: "a1", employeeId: "emp1" }, { scanned: true });
    expect(h.coreCalls).toEqual([{ kind: "assign", opts: { dryRun: true } }]);
    expect(h.state.assets[0].status).toBe("SPARE");
    expect(r.ok && r.data.card).toMatchObject({
      type: "confirm", pendingId: "p1", kind: "assign",
      person: { name: "Ana Reyes", employeeNo: "EMP-0101", worksFor: "Acme Health", initials: "AR" },
      gets: { assetId: "a1", tag: "BR-LT-0230", scanned: true },
    });
    expect(h.state.pending[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(h.state.pending[0].card).toEqual(r.ok && r.data.card);
  });

  it("refuses an input the action's schema refuses, and a Buyout", async () => {
    const tx = prisma as unknown as Prisma.TransactionClient;
    expect((await createPending(tx, user, "c1", "assign", { assetId: "" })).ok).toBe(false);
    const buyout = await createPending(tx, user, "c1", "replace", { employeeId: "emp1", oldAssetId: "a0", newAssetId: "a1", outcome: "BUYOUT" });
    expect(buyout.ok).toBe(false);
    expect(h.coreCalls).toHaveLength(0);
  });
});

describe("confirmPending", () => {
  it("runs the action via Cris, records what Undo needs and posts the result card", async () => {
    const r = await confirmPending(user, "p1", now);
    expect(h.coreCalls).toEqual([{ kind: "assign", opts: { via: "Cris" } }]);
    expect(r.affected).toEqual({ assetIds: ["a1"], employeeId: "emp1" });
    expect(r.result).toEqual({
      ok: true,
      data: {
        messages: [{
          id: "m1", role: "cris", text: null, at: "2026-10-17T10:00:01.000Z",
          cards: [{ type: "result", pendingId: "p1", employeeId: "emp1", head: "Assigned.", text: "BR-LT-0230 is with Ana Reyes now.", undoUntil: "2026-10-17T10:01:00.000Z" }],
        }],
      },
    });
    const ref = parseResultRef(h.state.pending[0].resultRef);
    expect(ref).toMatchObject({ employeeId: "emp1", auditIds: ["own-a1"], holdId: "r1", assets: [{ id: "a1", role: "gets", afterStatus: "DEPLOYED", before: { status: "SPARE" } }] });
  });

  it("Review Focus #2: two presses at once run the action once; the second is told it's already done", async () => {
    const [a, b] = await Promise.all([confirmPending(user, "p1", now), confirmPending(user, "p1", now)]);
    expect(h.coreCalls).toHaveLength(1);
    expect([a.result.ok, b.result.ok].sort()).toEqual([false, true]);
    const refused = [a, b].find((x) => !x.result.ok)!;
    expect(refused.result).toMatchObject({ kind: "conflict", message: CRIS_ALREADY_DONE });
    expect(refused.affected).toBeNull();
    // a later press (another tab) reads it as used before claiming
    expect((await confirmPending(user, "p1", now)).result).toMatchObject({ message: CRIS_ALREADY_DONE });
  });

  it("refuses someone else's action, and an expired one", async () => {
    expect((await confirmPending({ ...user, id: "u2" } as User, "p1", now)).result).toMatchObject({ kind: "forbidden" });
    expect((await confirmPending(user, "nope", now)).result).toMatchObject({ kind: "forbidden" });
    expect((await confirmPending(user, "p1", later(601))).result).toMatchObject({ kind: "conflict", message: CRIS_EXPIRED });
    expect(h.coreCalls).toHaveLength(0);
  });

  it("Review Focus #3: a spare taken meanwhile — the claim rolls back; Cris posts the action's words and the spares left", async () => {
    h.coreRefusal = "BR-LT-0230 reads Deployed, not Spare.";
    const r = await confirmPending(user, "p1", now);
    expect(h.state.pending[0].usedAt).toBeNull();
    expect(r.affected).toBeNull();
    expect(h.spares).toEqual([{ employeeId: "emp1", typeId: "t1" }]);
    expect(r.result.ok && r.result.data.refused).toBe(true);
    const [msg] = r.result.ok ? r.result.data.messages : [];
    expect(msg.text).toBe("BR-LT-0230 reads Deployed, not Spare.");
    expect(msg.cards).toMatchObject([{ type: "spares", employeeId: "emp1", options: [{ tag: "BR-LT-0231" }] }]);
  });
});

describe("undoPending", () => {
  async function confirmed(kind: "assign" | "replace") {
    if (kind === "replace") {
      h.state.pending = [pendingRow({ kind, input: { employeeId: "emp1", oldAssetId: "a0", newAssetId: "a1", outcome: "DEFECTIVE", reason: "screen" } })];
    }
    const r = await confirmPending(user, "p1", now);
    expect(r.result.ok).toBe(true);
    h.written.length = 0; h.approvals.length = 0;
  }

  it("puts an assigned spare back on the shelf (no triage) and restores the hold it fulfilled", async () => {
    await confirmed("assign");
    const r = await undoPending(user, "p1", later(59));
    expect(r.result.ok && r.result.data.messages[0].text).toBe("Undone — BR-LT-0230 is back in spares.");
    expect(h.state.assets[0]).toMatchObject({ status: "SPARE", assigneeId: null, returnedAt: null });
    expect(h.state.holds[0].state).toBe("ACTIVE");
    expect(h.written).toMatchObject([{ action: "lifecycle.return", entityId: "a1", diff: { reason: { to: "Undone" }, via: { to: "Cris" }, status: { from: "DEPLOYED", to: "SPARE" } } }]);
    expect(h.written[0].diff).not.toHaveProperty("returnedAt");
    expect(h.approvals).toMatchObject([{ type: "lifecycle_return", payload: { reason: "Undone" } }]);
    expect(h.state.pending[0].undoneAt).toEqual(later(59));
    expect((await undoPending(user, "p1", later(59))).result).toMatchObject({ message: CRIS_ALREADY_DONE });
  });

  it("gives a replaced item back with its old status and puts the new one back", async () => {
    await confirmed("replace");
    // the Confirm's own entries never count as "touched since"
    h.state.audits.push({ id: "own-a0", entityType: "asset", entityId: "a0", createdAt: later(0) });
    h.state.audits.push({ id: "own-a1", entityType: "asset", entityId: "a1", createdAt: later(0) });
    const r = await undoPending(user, "p1", later(30));
    expect(r.result.ok).toBe(true);
    expect(h.state.assets.find((a) => a.id === "a0")).toMatchObject({ status: "DEPLOYED", assigneeId: "emp1", defectiveSince: null });
    expect(h.state.assets.find((a) => a.id === "a1")).toMatchObject({ status: "SPARE", assigneeId: null });
    expect(h.written.map((w) => [w.action, w.entityId])).toEqual([["lifecycle.return", "a1"], ["lifecycle.assign", "a0"]]);
    expect(h.written[1].diff).toMatchObject({ assignee: { from: null, to: "EMP-0101" }, status: { from: "DEFECTIVE", to: "DEPLOYED" }, reason: { to: "Undone" } });
    expect(r.affected).toEqual({ assetIds: ["a1", "a0"], employeeId: "emp1" });
  });

  it("refuses when either asset was touched since — its own entries aside — and rolls the claim back", async () => {
    await confirmed("replace");
    h.state.audits.push({ id: "own-a0", entityType: "asset", entityId: "a0", createdAt: later(1) });
    h.state.audits.push({ id: "other", entityType: "asset", entityId: "a0", createdAt: later(20) });
    const r = await undoPending(user, "p1", later(30));
    expect(r.result).toMatchObject({ kind: "conflict", message: CRIS_CHANGED_SINCE });
    expect(h.state.pending[0].undoneAt).toBeNull();
    expect(h.state.assets.find((a) => a.id === "a1")?.status).toBe("DEPLOYED");
  });

  it("refuses after the 60 s window, and for someone else", async () => {
    await confirmed("assign");
    expect((await undoPending(user, "p1", later(61))).result).toMatchObject({ message: CRIS_CHANGED_SINCE });
    expect((await undoPending({ ...user, id: "u2" } as User, "p1", later(5))).result).toMatchObject({ kind: "forbidden" });
  });
});
