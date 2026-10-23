import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRIAGE_ALREADY_UNDONE, TRIAGE_BULK_MAX, TRIAGE_CHANGED_SINCE, TRIAGE_UNDO_FINAL, TRIAGE_UNDO_NOT_YOURS,
} from "@/lib/triage-undo";

/*
 * Worklist split view (H4) Task 2 (Review Focus 1–3): triage's audit id, Undo, and the bulk decisions, on the server,
 * against an in-memory Prisma whose transactions roll back on a throw. The decisions run for real, so each undo is
 * checked against the exact state before the decision, and every refusal against "nothing was written".
 */

type Rec = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  rate: { allowed: true, retryAfterSec: 0 },
  rateCalls: 0,
  assets: new Map<string, Record<string, unknown>>(),
  audits: [] as Array<Record<string, unknown>>,
  approvals: [] as Array<Record<string, unknown>>,
  openApprovals: [] as string[],
  revalidated: [] as string[],
  ops: [] as string[],
  transactions: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => { h.rateCalls += 1; return h.rate; } }));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async () => {} }));
vi.mock("@/server/recent-picks", () => ({ rememberPicks: async () => {} }));
vi.mock("@/server/modules/inventory/queries", () => ({ repairStageIds: async () => null }));
vi.mock("@/server/modules/approvals/create", () => ({
  OPEN_APPROVAL_STATES: ["PENDING", "CLAIMED", "APPROVED"],
  openApprovalForAsset: async (_tx: unknown, assetId: string) => (h.openApprovals.includes(assetId) ? { refNo: "APR-2050" } : null),
  createApproval: async (_tx: unknown, input: Record<string, unknown>) => {
    const row = { id: `apr${h.approvals.length + 1}`, refNo: `APR-${h.approvals.length + 1}`, ...input };
    h.approvals.push(row);
    return row;
  },
}));
vi.mock("@/server/db/client", () => {
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b || (a == null && b == null);
  const matches = (rec: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const op = v as { not?: unknown; in?: unknown[]; gte?: Date };
        if ("not" in op) return !same(rec[k], op.not);
        if (op.in) return op.in.includes(rec[k]);
        if (op.gte) return (rec[k] as Date).getTime() >= op.gte.getTime();
      }
      return same(rec[k], v);
    });
  // Prisma's @updatedAt: stamped on every write that doesn't set it itself
  const stamp = (a: Record<string, unknown>, data: Record<string, unknown>) =>
    Object.assign(a, { updatedAt: new Date() }, data);
  const asset = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      h.ops.push(`read:${where.id}`);
      const a = h.assets.get(where.id);
      return a ? { ...a } : null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...h.assets.get(where.id)! }),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      h.ops.push(`write:${String(where.id)}`);
      const a = h.assets.get(where.id as string);
      if (!a || !matches(a, where)) return { count: 0 };
      stamp(a, data);
      return { count: 1 };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      h.ops.push(`write:${where.id}`);
      const a = h.assets.get(where.id)!;
      stamp(a, data);
      return { ...a };
    },
  };
  const auditEntry = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `aud${String(h.audits.length + 1).padStart(3, "0")}`, createdAt: new Date(), source: null, reason: null, diff: null, ...data };
      h.audits.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = h.audits.find((r) => r.id === where.id);
      return row ? structuredClone(row) : null;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => structuredClone(h.audits.filter((r) => matches(r, where))),
  };
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.ops.push(`lock:${strings.join("$").replace(/\s+/g, " ").trim()}:${values.join(",")}`);
    return [];
  };
  const client = { asset, auditEntry, $queryRaw };
  return {
    prisma: {
      ...client,
      // a throw rolls the transaction back whole, as Postgres does
      $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => {
        h.transactions += 1;
        const snapshot = {
          assets: new Map([...h.assets].map(([k, v]) => [k, structuredClone(v)])),
          audits: structuredClone(h.audits), approvals: structuredClone(h.approvals),
        };
        try {
          return await fn(client);
        } catch (err) {
          h.assets = snapshot.assets; h.audits = snapshot.audits; h.approvals = snapshot.approvals;
          throw err;
        }
      },
    },
  };
});

import { triageAsset, triageMany, undoTriage, undoTriageMany } from "./actions";

const NEIL = { id: "u-neil", name: "Neil Lucero", role: "it_staff" };
const IVY = { id: "u-ivy", name: "Ivy Santos", role: "it_staff" };

const T0 = new Date("2026-10-23T02:42:00Z"); // 10:42 Manila
const at = (min: number) => vi.setSystemTime(new Date(T0.getTime() + min * 60_000));
const BACK = new Date("2026-10-20T01:00:00Z");

function seed(id: string, extra: Rec = {}): Rec {
  const a: Rec = {
    id, tag: `BR-LT-${id}`, model: "ThinkPad T14", cls: "IT", status: "SPARE", assigneeId: null,
    defectiveSince: null, repairEndedAt: null, returnedAt: BACK, loanDueAt: null, notes: null,
    updatedAt: BACK, ...extra,
  };
  h.assets.set(id, a);
  return structuredClone(a);
}
const asset = (id: string) => h.assets.get(id)!;
const auditId = (r: { ok: boolean; data?: unknown }) => (r as { data: { auditId: string } }).data.auditId;

/** A refusal writes nothing: the assets, the audit trail and the approvals are as they were. */
async function expectRefused(run: () => Promise<unknown>, expected: Rec) {
  const assets = structuredClone([...h.assets.values()]);
  const audits = structuredClone(h.audits);
  const approvals = structuredClone(h.approvals);
  expect(await run()).toMatchObject({ ok: false, ...expected });
  expect([...h.assets.values()]).toEqual(assets);
  expect(h.audits).toEqual(audits);
  expect(h.approvals).toEqual(approvals);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  h.user = NEIL;
  h.rate = { allowed: true, retryAfterSec: 0 };
  h.rateCalls = 0;
  h.assets = new Map();
  h.audits = [];
  h.approvals = [];
  h.openApprovals = [];
  h.revalidated = [];
  h.ops = [];
  h.transactions = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("triageAsset's result", () => {
  it("Keep as spare: the audit id the toast needs, the model, and the version the undo checks", async () => {
    seed("0230");
    const r = await triageAsset({ assetId: "0230", outcome: "SPARE" });
    expect(r).toEqual({ ok: true, data: { tag: "BR-LT-0230", status: "SPARE", model: "ThinkPad T14", auditId: "aud001" } });
    expect(asset("0230")).toMatchObject({ returnedAt: null, updatedAt: T0 });
    expect(h.audits[0]).toMatchObject({
      action: "lifecycle.triage",
      diff: { triage: { from: null, to: "Keep as spare" }, returnedAt: { from: BACK, to: null }, version: { from: null, to: T0 } },
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/inventory/0230", "/inventory/work"]));
  });

  it("Send to repair: the note rides the one asset write, which leaves the version", async () => {
    seed("0231", { notes: "bought 2023", repairEndedAt: new Date("2026-09-01T00:00:00Z") });
    const r = await triageAsset({ assetId: "0231", outcome: "DEFECTIVE", note: "fan noise" });
    expect(r).toMatchObject({ ok: true, data: { status: "DEFECTIVE", auditId: "aud001" } });
    expect(asset("0231")).toMatchObject({
      status: "DEFECTIVE", returnedAt: null, defectiveSince: T0, repairEndedAt: null, notes: "bought 2023\nfan noise", updatedAt: T0,
    });
    expect(h.approvals).toHaveLength(1);
    expect(h.audits[0].diff).toMatchObject({ status: { from: "SPARE", to: "DEFECTIVE" }, note: { from: null, to: "fan noise" }, version: { from: null, to: T0 } });
  });
});

describe("undoTriage", () => {
  it("Keep as spare: puts the item back in triage exactly as before, with a new entry naming the decision", async () => {
    const before = seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    const original = structuredClone(h.audits[0]);

    at(3);
    h.ops = [];
    const r = await undoTriage({ auditId: id });
    expect(r).toEqual({ ok: true, data: { id: "0230", tag: "BR-LT-0230", model: "ThinkPad T14", status: "SPARE" } });
    expect({ ...asset("0230"), updatedAt: BACK }).toEqual(before);
    // the row lock comes first: nothing can land between the check and the write
    expect(h.ops[0]).toMatch(/^lock:SELECT "id" FROM "Asset" WHERE "id" = \$ FOR UPDATE:0230$/);
    // append-only: the decision's entry is untouched, the undo is a new one
    expect(h.audits).toHaveLength(2);
    expect(h.audits[0]).toEqual(original);
    expect(h.audits[1]).toMatchObject({
      actorId: NEIL.id, actorLabel: NEIL.name, entityType: "asset", entityId: "0230", action: "lifecycle.triage.undone",
      diff: { triage: { from: "Keep as spare", to: null }, returnedAt: { from: null, to: BACK }, undoes: { from: null, to: id } },
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/inventory/0230", "/inventory/work"]));
  });

  it("Send to repair: status, the repair clock and the note go back; the EXECUTED approval stays", async () => {
    const before = seed("0231", { notes: "bought 2023", repairEndedAt: new Date("2026-09-01T00:00:00Z") });
    const id = auditId(await triageAsset({ assetId: "0231", outcome: "DEFECTIVE", note: "fan noise" }));
    const approvals = structuredClone(h.approvals);

    at(14);
    expect((await undoTriage({ auditId: id })).ok).toBe(true);
    expect({ ...asset("0231"), updatedAt: BACK }).toEqual(before);
    expect(h.approvals).toEqual(approvals);
    expect(h.audits[1].diff).toMatchObject({
      triage: { from: "Send to repair", to: null },
      status: { from: "DEFECTIVE", to: "SPARE" },
      defectiveSince: { from: T0, to: null },
      returnedAt: { from: null, to: BACK },
      note: { from: "fan noise", to: null },
      undoes: { from: null, to: id },
    });
  });

  it("refuses another person's decision", async () => {
    seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    h.user = IVY;
    await expectRefused(() => undoTriage({ auditId: id }), { kind: "conflict", message: TRIAGE_UNDO_NOT_YOURS });
  });

  it("refuses a decision older than 15 minutes", async () => {
    seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    at(15);
    expect((await undoTriage({ auditId: id })).ok).toBe(true);

    seed("0232");
    at(20);
    const late = auditId(await triageAsset({ assetId: "0232", outcome: "SPARE" }));
    vi.setSystemTime(new Date(T0.getTime() + 35 * 60_000 + 1));
    await expectRefused(() => undoTriage({ auditId: late }), { kind: "conflict", message: TRIAGE_UNDO_NOT_YOURS });
  });

  it("refuses when the asset changed since (assigned after Keep as spare)", async () => {
    seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    at(2);
    Object.assign(asset("0230"), { status: "DEPLOYED", assigneeId: "emp1", updatedAt: new Date() });
    h.audits.push({ id: "aud900", createdAt: new Date(), actorId: IVY.id, entityType: "asset", entityId: "0230", action: "lifecycle.assign", diff: {} });
    at(4);
    await expectRefused(() => undoTriage({ auditId: id }), { kind: "conflict", message: TRIAGE_CHANGED_SINCE });
  });

  it("refuses when only the row moved (no entry), and when only an entry landed (a hold)", async () => {
    seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    at(1);
    asset("0230").updatedAt = new Date();
    await expectRefused(() => undoTriage({ auditId: id }), { kind: "conflict", message: TRIAGE_CHANGED_SINCE });

    seed("0232");
    const id2 = auditId(await triageAsset({ assetId: "0232", outcome: "SPARE" }));
    at(2);
    h.audits.push({ id: "aud901", createdAt: new Date(), actorId: IVY.id, entityType: "asset", entityId: "0232", action: "reservation.placed", diff: {} });
    await expectRefused(() => undoTriage({ auditId: id2 }), { kind: "conflict", message: TRIAGE_CHANGED_SINCE });
  });

  it("a later note on the asset doesn't block it", async () => {
    seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    at(1);
    h.audits.push({ id: "aud902", createdAt: new Date(), actorId: IVY.id, entityType: "asset", entityId: "0230", action: "note.posted", diff: {} });
    expect((await undoTriage({ auditId: id })).ok).toBe(true);
  });

  it("refuses when an open request now holds the asset", async () => {
    seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    h.openApprovals = ["0230"];
    await expectRefused(() => undoTriage({ auditId: id }), { kind: "conflict", message: TRIAGE_CHANGED_SINCE });
  });

  it("applied twice: the second is refused and writes nothing", async () => {
    seed("0230");
    const id = auditId(await triageAsset({ assetId: "0230", outcome: "SPARE" }));
    at(1);
    expect((await undoTriage({ auditId: id })).ok).toBe(true);
    at(2);
    await expectRefused(() => undoTriage({ auditId: id }), { kind: "conflict", message: TRIAGE_ALREADY_UNDONE });
  });

  it("Dispose and Donate have no undo", async () => {
    seed("0230");
    seed("0232");
    const disposed = auditId(await triageAsset({ assetId: "0230", outcome: "DISPOSE", note: "cracked board" }));
    const donated = auditId(await triageAsset({ assetId: "0232", outcome: "DONATED", note: "to the school" }));
    await expectRefused(() => undoTriage({ auditId: disposed }), { kind: "conflict", message: TRIAGE_UNDO_FINAL });
    await expectRefused(() => undoTriage({ auditId: donated }), { kind: "conflict", message: TRIAGE_UNDO_FINAL });
  });

  it("an id that is not a triage decision", async () => {
    h.audits.push({ id: "aud777", createdAt: new Date(), actorId: NEIL.id, entityType: "asset", entityId: "0230", action: "lifecycle.assign", diff: {} });
    await expectRefused(() => undoTriage({ auditId: "aud777" }), { kind: "validation" });
    await expectRefused(() => undoTriage({ auditId: "nope" }), { kind: "validation" });
  });
});

describe("triageMany", () => {
  it("mixed results: each item in its own transaction, a refused one left exactly as it was", async () => {
    seed("0001");
    seed("0002", { returnedAt: null }); // decided by someone else meanwhile
    const held = seed("0003", { assigneeId: "emp1" }); // the lifecycle guard refuses it after the claim was written
    seed("0004");
    const r = await triageMany({ assetIds: ["0001", "gone", "0002", "0003", "0004"], outcome: "DEFECTIVE" });
    expect(r).toEqual({
      ok: true,
      data: {
        done: ["0001", "0004"],
        failed: [
          { id: "gone", reason: "That asset no longer exists." },
          { id: "0002", reason: "BR-LT-0002 is not waiting for triage." },
          { id: "0003", reason: expect.stringContaining("BR-LT-0003 is still assigned") },
        ],
        auditIds: ["aud001", "aud002"],
      },
    });
    expect(h.transactions).toBe(5);
    expect(h.rateCalls).toBe(1);
    expect(asset("0003")).toEqual(held); // the claim rolled back with its transaction
    expect(asset("0001").status).toBe("DEFECTIVE");
    expect(asset("0004").status).toBe("DEFECTIVE");
    expect(h.approvals).toHaveLength(2);
  });

  it("the toast's Undo covers only the ones that succeeded", async () => {
    const one = seed("0001");
    seed("0002", { returnedAt: null });
    const four = seed("0004");
    const r = await triageMany({ assetIds: ["0001", "0002", "0004"], outcome: "SPARE" });
    const { auditIds } = (r as { data: { auditIds: string[] } }).data;
    at(1);
    expect(await undoTriageMany({ auditIds })).toEqual({ ok: true, data: { done: ["0001", "0004"], failed: [] } });
    expect({ ...asset("0001"), updatedAt: BACK }).toEqual(one);
    expect({ ...asset("0004"), updatedAt: BACK }).toEqual(four);
    expect(h.audits.filter((a) => a.action === "lifecycle.triage.undone")).toHaveLength(2);
  });

  it("an undo of several reports the ones it couldn't", async () => {
    seed("0001");
    seed("0004");
    const r = await triageMany({ assetIds: ["0001", "0004"], outcome: "SPARE" });
    const { auditIds } = (r as { data: { auditIds: string[] } }).data;
    at(1);
    asset("0004").updatedAt = new Date();
    expect(await undoTriageMany({ auditIds })).toEqual({
      ok: true, data: { done: ["0001"], failed: [{ id: auditIds[1], reason: TRIAGE_CHANGED_SINCE }] },
    });
  });

  it("only Keep as spare and Send to repair, at most 100 items, no repeats", async () => {
    seed("0001");
    expect(await triageMany({ assetIds: ["0001"], outcome: "DISPOSE" })).toMatchObject({ ok: false, kind: "validation" });
    const many = Array.from({ length: TRIAGE_BULK_MAX + 1 }, (_, i) => `a${i}`);
    expect(await triageMany({ assetIds: many, outcome: "SPARE" })).toMatchObject({ ok: false, kind: "validation" });
    expect(await triageMany({ assetIds: [], outcome: "SPARE" })).toMatchObject({ ok: false, kind: "validation" });
    expect(await triageMany({ assetIds: ["0001", "0001"], outcome: "SPARE" })).toMatchObject({ ok: true, data: { done: ["0001"], failed: [] } });
    expect(h.audits).toHaveLength(1);
  });

  it("a viewer's items are each refused, writing nothing; no session is refused outright", async () => {
    seed("0001");
    h.user = { id: "u-vic", name: "Vic Ong", role: "viewer" };
    expect(await triageMany({ assetIds: ["0001"], outcome: "SPARE" }))
      .toEqual({ ok: true, data: { done: [], failed: [{ id: "0001", reason: "You don't have permission to do that." }], auditIds: [] } });
    h.user = null;
    expect(await triageMany({ assetIds: ["0001"], outcome: "SPARE" })).toMatchObject({ ok: false, kind: "forbidden" });
  });
});
