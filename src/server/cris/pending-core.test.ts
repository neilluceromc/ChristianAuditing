import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";

/*
 * Confirm and Undo against an in-memory transaction: a thrown refusal restores every row, as Postgres would.
 * The lifecycle cores are stubbed (direct.test.ts covers them) but write the asset audit entries commitDirect
 * would, so the "own entries" lookup and the "touched since" count run against real rows and real filters.
 * loadDirect and prepareLifecycle run for real.
 *
 * Limits of the fake: `$transaction` restores a global snapshot on a throw but does not isolate concurrent
 * transactions, and every fake write is synchronous. So the double-press test pins "the guarded claim comes
 * before the core"; that two real transactions can't both claim rests on Postgres row locking (Task 9 e2e).
 */

type Asset = {
  id: string; tag: string; cls: "IT"; status: string; assigneeId: string | null; typeId: string | null;
  defectiveSince: Date | null; repairEndedAt: Date | null; returnedAt: Date | null; loanDueAt: Date | null; model: string;
};
type Pending = {
  id: string; userId: string; conversationId: string; kind: string; input: unknown; card: unknown;
  createdAt: Date; expiresAt: Date; usedAt: Date | null; undoneAt: Date | null; resultRef: string | null;
};
type Audit = { id: string; entityType: string; entityId: string; actorId: string | null; action: string; diff: Record<string, unknown>; createdAt: Date };
type State = {
  pending: Pending[]; assets: Asset[]; holds: Array<{ id: string; assetId: string; employeeId: string; state: string }>;
  audits: Audit[]; messages: Array<{ id: string; role: string; content: unknown; createdAt: Date }>;
  employment: string; openApprovals: string[];
};

const h = vi.hoisted(() => ({
  state: null as unknown as State,
  clock: new Date(0),
  coreCalls: [] as Array<{ kind: string; opts: unknown }>,
  coreRefusal: null as null | { message: string; fieldErrors?: Record<string, string> },
  written: [] as Array<{ action: string; entityId: string; diff: Record<string, { from: unknown; to: unknown }> }>,
  approvals: [] as Array<{ type: string; payload: { reason?: string } }>,
  spares: [] as Array<{ employeeId: string; typeId: string | null }>,
  locks: [] as unknown[][],
  /** Thrown by the real (not dry-run) core, or by Undo's FOR UPDATE: a Postgres failure mid-transaction. */
  coreThrow: null as unknown,
  lockThrow: null as unknown,
}));

const clone = (s: State): State => ({
  ...s,
  pending: s.pending.map((p) => ({ ...p })), assets: s.assets.map((a) => ({ ...a })), holds: s.holds.map((x) => ({ ...x })),
  audits: [...s.audits], messages: [...s.messages],
});

const at = (obj: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Prisma's `where`, as far as these queries use it: equality, in, notIn, gte, and a JSON path's equals. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v instanceof Date) return (row[k] as Date | null)?.getTime() === v.getTime();
    if (v && typeof v === "object") {
      const op = v as { in?: unknown[]; notIn?: unknown[]; gte?: Date; path?: string[]; equals?: unknown };
      if (op.in) return op.in.includes(row[k]);
      if (op.notIn) return !op.notIn.includes(row[k]);
      if (op.gte) return (row[k] as Date).getTime() >= op.gte.getTime();
      if (op.path) return at(row[k], op.path) === op.equals;
      throw new Error(`fake: unsupported where on ${k}`);
    }
    return row[k] === v;
  });
}

function makeTx() {
  const s = () => h.state;
  const newest = <T extends { createdAt: Date; id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  return {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: Array<{ values?: unknown[] }>) => {
      if (h.lockThrow) throw h.lockThrow;
      h.locks.push(values[0]?.values ?? []);
      return [];
    },
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
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = s().assets.filter((a) => matches(a, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    employee: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "emp1" ? { id: "emp1", name: "Ana Reyes", employeeNo: "EMP-0101", employment: s().employment } : null,
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
      findFirst: async ({ where }: { where: Record<string, unknown> }) => newest(s().audits.filter((x) => matches(x, where)))[0] ?? null,
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

/** An asset audit entry, as commitDirect / writeAudit would write it. */
function audit(e: Omit<Audit, "id" | "entityType" | "createdAt"> & { createdAt?: Date }): void {
  h.state.audits.push({ entityType: "asset", createdAt: h.clock, ...e, id: `au${h.state.audits.length + 1}` });
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
  const refusal = () => ({ ...conflict(h.coreRefusal!.message), ...(h.coreRefusal!.fieldErrors ? { kind: "validation" as const, fieldErrors: h.coreRefusal!.fieldErrors } : {}) });
  const via = (opts: { via?: string }) => (opts.via ? { via: { from: null, to: opts.via } } : {});
  return {
    ...actual,
    assignCore: async (_tx: unknown, user: { id: string }, d: { assetId: string; employeeId: string }, opts: { dryRun?: boolean; via?: string }) => {
      h.coreCalls.push({ kind: "assign", opts });
      if (h.coreThrow && !opts.dryRun) throw h.coreThrow;
      if (h.coreRefusal) return refusal();
      if (!opts.dryRun) {
        Object.assign(h.state.assets.find((a) => a.id === d.assetId)!, { status: "DEPLOYED", assigneeId: d.employeeId });
        for (const x of h.state.holds) if (x.assetId === d.assetId && x.employeeId === d.employeeId) x.state = "FULFILLED";
        audit({ entityId: d.assetId, actorId: user.id, action: "lifecycle.assign", diff: { status: { from: "SPARE", to: "DEPLOYED" }, ...via(opts) } });
      }
      return ok({ tag: "BR-LT-0230", employeeName: "Ana Reyes" });
    },
    replaceCore: async (_tx: unknown, user: { id: string }, d: { oldAssetId: string; newAssetId: string; employeeId: string }, opts: { dryRun?: boolean; via?: string }) => {
      h.coreCalls.push({ kind: "replace", opts });
      if (h.coreRefusal) return refusal();
      if (!opts.dryRun) {
        Object.assign(h.state.assets.find((a) => a.id === d.oldAssetId)!, { status: "DEFECTIVE", assigneeId: null, defectiveSince: h.clock });
        Object.assign(h.state.assets.find((a) => a.id === d.newAssetId)!, { status: "DEPLOYED", assigneeId: d.employeeId });
        audit({ entityId: d.oldAssetId, actorId: user.id, action: "lifecycle.replace", diff: { replacedBy: { from: null, to: "BR-LT-0230" }, ...via(opts) } });
        audit({ entityId: d.newAssetId, actorId: user.id, action: "lifecycle.replace", diff: { replaces: { from: null, to: "BR-LT-0148" }, ...via(opts) } });
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
  writeAudit: async (_tx: unknown, e: { action: string; entityId: string; actorId: string; diff: Record<string, { from: unknown; to: unknown }> }) => {
    h.written.push(e);
    audit({ entityId: e.entityId, actorId: e.actorId, action: e.action, diff: e.diff });
  },
}));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async () => {} }));
vi.mock("@/server/modules/approvals/create", () => ({
  openApprovalForAsset: async (_tx: unknown, assetId: string) => (h.state.openApprovals.includes(assetId) ? { refNo: "APR-2050" } : null),
  createApproval: async (_tx: unknown, input: { type: string; payload: { reason?: string } }) => { h.approvals.push(input); return { id: "apr", refNo: "APR-1", type: input.type }; },
}));

import { confirmPending, createPending, undoPending } from "./pending-core";
import { CRIS_ALREADY_DONE, CRIS_CHANGED_SINCE, CRIS_EXPIRED, CRIS_SAME_MOMENT, parseResultRef } from "@/lib/cris-undo";
import { prisma } from "@/server/db/client";
import { Prisma } from "@prisma/client";

/** Postgres's deadlock_detected on a raw statement, as Prisma reports it. */
const deadlock = () =>
  new Prisma.PrismaClientKnownRequestError("deadlock detected", { code: "P2010", clientVersion: "6", meta: { code: "40P01", message: "deadlock detected" } });

const user = { id: "u1", name: "Neil Lucero", role: "it_staff" } as User;
const now = new Date("2026-10-17T10:00:00.000Z");
const later = (sec: number) => new Date(now.getTime() + sec * 1000);
const tx = () => prisma as unknown as Prisma.TransactionClient;
const asset = (id: string, tag: string, status: string, assigneeId: string | null = null): Asset => ({
  id, tag, cls: "IT", status, assigneeId, typeId: "t1", defectiveSince: null, repairEndedAt: null, returnedAt: null, loanDueAt: null, model: "Latitude",
});
const replaceInput = { employeeId: "emp1", oldAssetId: "a0", newAssetId: "a1", outcome: "DEFECTIVE" };
const pendingRow = (over: Partial<Pending> = {}): Pending => ({
  id: "p1", userId: "u1", conversationId: "c1", kind: "assign", input: { assetId: "a1", employeeId: "emp1" }, card: {},
  createdAt: now, expiresAt: later(600), usedAt: null, undoneAt: null, resultRef: null, ...over,
});

beforeEach(() => {
  h.clock = now;
  h.state = {
    pending: [pendingRow()],
    assets: [asset("a1", "BR-LT-0230", "SPARE"), asset("a0", "BR-LT-0148", "DEPLOYED", "emp1")],
    holds: [{ id: "r1", assetId: "a1", employeeId: "emp1", state: "ACTIVE" }],
    // older history on both assets by the same person, not via Cris: never mistaken for the Confirm's own
    audits: [
      { id: "old1", entityType: "asset", entityId: "a1", actorId: "u1", action: "lifecycle.triage", diff: {}, createdAt: new Date("2026-10-01T00:00:00.000Z") },
      { id: "old0", entityType: "asset", entityId: "a0", actorId: "u1", action: "lifecycle.assign", diff: {}, createdAt: new Date("2026-10-01T00:00:00.000Z") },
    ],
    messages: [], employment: "ACTIVE", openApprovals: [],
  };
  h.coreThrow = null; h.lockThrow = null;
  h.coreCalls.length = 0; h.coreRefusal = null; h.written.length = 0; h.approvals.length = 0; h.spares.length = 0; h.locks.length = 0;
});

describe("createPending", () => {
  it("dry-runs the real action, stores the pending action and returns the card from DB reads", async () => {
    h.state.pending = [];
    const r = await createPending(tx(), user, "c1", "assign", { assetId: "a1", employeeId: "emp1" }, { scanned: true });
    expect(h.coreCalls).toEqual([{ kind: "assign", opts: { dryRun: true } }]);
    expect(h.state.assets[0].status).toBe("SPARE");
    expect(r.ok && r.data.card).toMatchObject({
      type: "confirm", pendingId: "p1", kind: "assign",
      person: { name: "Ana Reyes", employeeNo: "EMP-0101", worksFor: "Acme Health", initials: "AR" },
      gets: { assetId: "a1", tag: "BR-LT-0230", scanned: true },
    });
    expect(r.ok && r.data.card).not.toHaveProperty("reason");
    expect(h.state.pending[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(h.state.pending[0].card).toEqual(r.ok && r.data.card);
  });

  it("shows an assign's reason on the card when one is given", async () => {
    h.state.pending = [];
    const r = await createPending(tx(), user, "c1", "assign", { assetId: "a1", employeeId: "emp1", reason: "new joiner" });
    expect(r.ok && r.data.card.reason).toBe("new joiner");
    expect(h.state.pending[0].input).toEqual({ assetId: "a1", employeeId: "emp1", reason: "new joiner" });
  });

  it("I-1: refuses an assign that carries a status or a loan date — nothing the card leaves out is stored", async () => {
    h.state.pending = [];
    for (const extra of [{ status: "TEMPORARY" }, { loanDueAt: "2026-11-01" }, { status: "DEPLOYED" }]) {
      const r = await createPending(tx(), user, "c1", "assign", { assetId: "a1", employeeId: "emp1", ...extra });
      expect(r.ok).toBe(false);
    }
    expect(h.coreCalls).toHaveLength(0);
    expect(h.state.pending).toHaveLength(0);
  });

  it("refuses an input the action's schema refuses, and a Buyout", async () => {
    expect((await createPending(tx(), user, "c1", "assign", { assetId: "" })).ok).toBe(false);
    expect((await createPending(tx(), user, "c1", "replace", { ...replaceInput, outcome: "BUYOUT" })).ok).toBe(false);
    expect(h.coreCalls).toHaveLength(0);
  });

  it("M-5: a replace card shows the reason that will be recorded — the given one, or 'replaced by {tag}'", async () => {
    h.state.pending = [];
    const plain = await createPending(tx(), user, "c1", "replace", replaceInput);
    expect(plain.ok && plain.data.card.returns).toEqual({ assetId: "a0", tag: "BR-LT-0148", outcome: "DEFECTIVE", reason: "replaced by BR-LT-0230" });
    const given = await createPending(tx(), user, "c1", "replace", { ...replaceInput, reason: "screen cracked" });
    expect(given.ok && given.data.card.returns?.reason).toBe("screen cracked");
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
    const own = h.state.audits.filter((a) => a.diff.via).map((a) => a.id);
    expect(own).toHaveLength(1);
    expect(parseResultRef(h.state.pending[0].resultRef)).toMatchObject({
      employeeId: "emp1", auditIds: own, holdId: "r1", assets: [{ id: "a1", role: "gets", afterStatus: "DEPLOYED", before: { status: "SPARE" } }],
    });
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

  it("says a used action that has also expired is already done (used is checked first)", async () => {
    h.state.pending = [pendingRow({ usedAt: later(5) })];
    expect((await confirmPending(user, "p1", later(601))).result).toMatchObject({ kind: "conflict", message: CRIS_ALREADY_DONE });
  });

  it("I-1: a stored assign carrying a status is refused at Confirm too, before any claim", async () => {
    h.state.pending = [pendingRow({ input: { assetId: "a1", employeeId: "emp1", status: "TEMPORARY", loanDueAt: "2026-11-01" } })];
    const r = await confirmPending(user, "p1", now);
    expect(r.result.ok).toBe(false);
    expect(h.coreCalls).toHaveLength(0);
    expect(h.state.pending[0].usedAt).toBeNull();
  });

  it("Review Focus #3: a spare taken meanwhile — the claim rolls back; Cris posts the action's words and the spares left", async () => {
    h.coreRefusal = { message: "BR-LT-0230 reads Deployed, not Spare." };
    const r = await confirmPending(user, "p1", now);
    expect(h.state.pending[0].usedAt).toBeNull();
    expect(r.affected).toBeNull();
    expect(h.spares).toEqual([{ employeeId: "emp1", typeId: "t1" }]);
    expect(r.result.ok && r.result.data.refused).toBe(true);
    const [msg] = r.result.ok ? r.result.data.messages : [];
    expect(msg.text).toBe("BR-LT-0230 reads Deployed, not Spare.");
    expect(msg.cards).toMatchObject([{ type: "spares", employeeId: "emp1", options: [{ tag: "BR-LT-0231" }] }]);
  });

  it("M-4: offers spares for a field error on the spare, but not when the refusal is about the person or the old item", async () => {
    h.state.pending = [pendingRow({ kind: "replace", input: replaceInput })];
    h.coreRefusal = { message: "Fix the highlighted fields.", fieldErrors: { newAssetId: "Pick a different device." } };
    const spare = await confirmPending(user, "p1", now);
    expect(spare.result.ok && spare.result.data.messages[0]).toMatchObject({ text: "Pick a different device.", cards: [{ type: "spares" }] });

    for (const message of ["Target employee EMP-0101 is OFFBOARDING — assignment refused", "BR-LT-0148 isn't held by this person."]) {
      h.coreRefusal = { message };
      const r = await confirmPending(user, "p1", now);
      expect(r.result.ok && r.result.data.refused).toBe(true);
      expect(r.result.ok && r.result.data.messages[0]).toMatchObject({ text: message, cards: [] });
    }
    expect(h.spares).toHaveLength(1);
  });
});

describe("undoPending", () => {
  async function confirmed(kind: "assign" | "replace") {
    if (kind === "replace") h.state.pending = [pendingRow({ kind, input: { ...replaceInput, reason: "screen" } })];
    const r = await confirmPending(user, "p1", now);
    expect(r.result.ok).toBe(true);
    h.written.length = 0; h.approvals.length = 0;
  }

  it("puts an assigned spare back on the shelf (no triage) and restores the hold it fulfilled", async () => {
    await confirmed("assign");
    h.clock = later(59);
    const r = await undoPending(user, "p1", later(59));
    expect(r.result.ok && r.result.data.messages[0].text).toBe("Undone — BR-LT-0230 is back in spares.");
    expect(h.locks).toEqual([["a1"]]);
    expect(h.state.assets[0]).toMatchObject({ status: "SPARE", assigneeId: null, returnedAt: null });
    expect(h.state.holds[0].state).toBe("ACTIVE");
    expect(h.written).toMatchObject([{ action: "lifecycle.return", entityId: "a1", diff: { reason: { to: "Undone" }, via: { to: "Cris" }, status: { from: "DEPLOYED", to: "SPARE" } } }]);
    expect(h.written[0].diff).not.toHaveProperty("returnedAt");
    expect(h.approvals).toMatchObject([{ type: "lifecycle_return", payload: { reason: "Undone" } }]);
    expect(h.state.pending[0].undoneAt).toEqual(later(59));
    expect((await undoPending(user, "p1", later(59))).result).toMatchObject({ message: CRIS_ALREADY_DONE });
  });

  it("replace → Confirm → Undo: the old item goes back with its old status, the new one back to spares", async () => {
    await confirmed("replace");
    h.clock = later(30);
    const r = await undoPending(user, "p1", later(30));
    expect(r.result.ok).toBe(true);
    expect(h.locks).toEqual([["a0", "a1"]]);
    expect(h.state.assets.find((a) => a.id === "a0")).toMatchObject({ status: "DEPLOYED", assigneeId: "emp1", defectiveSince: null });
    expect(h.state.assets.find((a) => a.id === "a1")).toMatchObject({ status: "SPARE", assigneeId: null });
    expect(h.written.map((w) => [w.action, w.entityId])).toEqual([["lifecycle.return", "a1"], ["lifecycle.assign", "a0"]]);
    expect(h.written[1].diff).toMatchObject({ assignee: { from: null, to: "EMP-0101" }, status: { from: "DEFECTIVE", to: "DEPLOYED" }, reason: { to: "Undone" } });
    expect(r.affected).toEqual({ assetIds: ["a1", "a0"], employeeId: "emp1" });
  });

  it("refuses when either asset was touched since — its own entries aside — and rolls the claim back", async () => {
    await confirmed("replace");
    h.clock = later(20);
    audit({ entityId: "a0", actorId: "u9", action: "asset.update", diff: {} });
    const r = await undoPending(user, "p1", later(30));
    expect(r.result).toMatchObject({ kind: "conflict", message: CRIS_CHANGED_SINCE });
    expect(h.state.pending[0].undoneAt).toBeNull();
    expect(h.state.assets.find((a) => a.id === "a1")?.status).toBe("DEPLOYED");
  });

  it("refuses a replace's Undo when the person is no longer active, writing nothing", async () => {
    await confirmed("replace");
    h.state.employment = "OFFBOARDING";
    const before = h.state.assets.map((a) => ({ ...a }));
    const audits = h.state.audits.length;
    const r = await undoPending(user, "p1", later(30));
    expect(r.result).toMatchObject({ kind: "conflict", message: CRIS_CHANGED_SINCE });
    // putBack ran first (its entry was written), then giveBack refused: all of it rolled back
    expect(h.written.map((w) => w.entityId)).toEqual(["a1"]);
    expect(h.state.assets).toEqual(before);
    expect(h.state.audits).toHaveLength(audits);
    expect(h.state.pending[0].undoneAt).toBeNull();
  });

  it("refuses while an open approval holds either asset", async () => {
    await confirmed("assign");
    h.state.openApprovals = ["a1"];
    const r = await undoPending(user, "p1", later(10));
    expect(r.result).toMatchObject({ kind: "conflict", message: CRIS_CHANGED_SINCE });
    expect(h.state.assets[0]).toMatchObject({ status: "DEPLOYED", assigneeId: "emp1" });
    expect(h.state.pending[0].undoneAt).toBeNull();
  });

  it("refuses after the 60 s window, and for someone else", async () => {
    await confirmed("assign");
    expect((await undoPending(user, "p1", later(61))).result).toMatchObject({ message: CRIS_CHANGED_SINCE });
    expect((await undoPending({ ...user, id: "u2" } as User, "p1", later(5))).result).toMatchObject({ kind: "forbidden" });
  });

  it("M7: a deadlock at the FOR UPDATE is a conflict to try again, not a 500 — nothing written, Undo still possible", async () => {
    await confirmed("assign");
    h.lockThrow = deadlock();
    const r = await undoPending(user, "p1", later(5));
    expect(r).toEqual({ result: { ok: false, kind: "conflict", message: CRIS_SAME_MOMENT }, affected: null });
    expect(h.state.pending[0].undoneAt).toBeNull();
    expect(h.state.assets[0]).toMatchObject({ status: "DEPLOYED", assigneeId: "emp1" });
    h.lockThrow = null;
    expect((await undoPending(user, "p1", later(6))).result.ok).toBe(true);
  });

  it("rethrows any other database failure", async () => {
    await confirmed("assign");
    h.lockThrow = new Prisma.PrismaClientKnownRequestError("boom", { code: "P2010", clientVersion: "6", meta: { code: "57014" } });
    await expect(undoPending(user, "p1", later(5))).rejects.toThrow("boom");
  });
});

describe("M7: a deadlock at Confirm", () => {
  it("is a conflict to try again — the claim rolls back, so the same Confirm can run", async () => {
    h.coreThrow = new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "6" });
    const r = await confirmPending(user, "p1", now);
    expect(r).toEqual({ result: { ok: false, kind: "conflict", message: CRIS_SAME_MOMENT }, affected: null });
    expect(h.state.pending[0].usedAt).toBeNull();
    expect(h.state.assets[0].status).toBe("SPARE");
    h.coreThrow = null;
    expect((await confirmPending(user, "p1", now)).result.ok).toBe(true);
  });

  it("recognises a raw statement's 40P01 too", async () => {
    h.coreThrow = deadlock();
    expect((await confirmPending(user, "p1", now)).result).toMatchObject({ kind: "conflict", message: CRIS_SAME_MOMENT });
  });
});
