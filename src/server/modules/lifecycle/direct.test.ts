import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, User } from "@prisma/client";

// The writes recordDirect makes besides the asset row: recorded, never run.
const writes = vi.hoisted(() => ({ approvals: [] as unknown[], audits: [] as Array<{ action: string; diff: Record<string, unknown> }>, hooks: [] as unknown[] }));
vi.mock("@/server/modules/approvals/create", () => ({
  openApprovalForAsset: (tx: { approval: { findFirst: () => unknown } }) => tx.approval.findFirst(),
  createApproval: async (_tx: unknown, input: unknown) => { writes.approvals.push(input); return { id: "apr1", refNo: "APR-1", type: "lifecycle_assign" }; },
}));
vi.mock("@/server/audit", () => ({
  writeAudit: async (_tx: unknown, e: { action: string; diff: Record<string, unknown> }) => { writes.audits.push(e); },
}));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async (_tx: unknown, ...a: unknown[]) => { writes.hooks.push(a); } }));

import { assignCore, loadDirect, replaceCore } from "./direct";

type Row = { id: string; tag: string; cls: "IT" | "PURCHASING"; status: string; assigneeId: string | null; defectiveSince: null; repairEndedAt: null; returnedAt: Date | null; loanDueAt: null; model: string };
const asset = (id: string, tag: string, status: string, assigneeId: string | null = null, extra: Partial<Row> = {}): Row => ({
  id, tag, cls: extra.cls ?? "IT", status, assigneeId, defectiveSince: null, repairEndedAt: null, returnedAt: extra.returnedAt ?? null, loanDueAt: null, model: "Latitude",
});

/** A transaction that reads from fixtures and records every row it would write. */
function fakeTx(assets: Row[], opts: { openApproval?: boolean; hold?: { employeeId: string; employeeNo: string } } = {}) {
  const rowWrites: string[] = [];
  /** Task 2 fix round 1: the row lock and the asset reads, in order. */
  const ops: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      ops.push(`lock:${strings.join("$").replace(/\s+/g, " ").trim()}:${values.join(",")}`);
      return [];
    },
    asset: {
      findUnique: async ({ where }: { where: { id: string } }) => { ops.push(`read:${where.id}`); return assets.find((a) => a.id === where.id) ?? null; },
      update: async ({ where }: { where: { id: string } }) => { rowWrites.push(`asset:${where.id}`); },
    },
    employee: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "emp1" ? { id: "emp1", name: "Ana Cruz", employeeNo: "EMP-0101", employment: "ACTIVE" } : null,
    },
    approval: { findFirst: async () => (opts.openApproval ? { refNo: "APR-2050" } : null) },
    reservation: {
      findFirst: async () => (opts.hold ? { employeeId: opts.hold.employeeId, employee: { id: opts.hold.employeeId, employeeNo: opts.hold.employeeNo } } : null),
      updateMany: async () => { rowWrites.push("reservation"); return { count: 0 }; },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, rowWrites, ops };
}

const user = { id: "u1", name: "Neil Lucero", role: "it_staff" } as User;
const spare = asset("a1", "BR-LT-0230", "SPARE");
const held = asset("a0", "BR-LT-0100", "DEPLOYED", "emp1");

beforeEach(() => { writes.approvals.length = 0; writes.audits.length = 0; writes.hooks.length = 0; });

describe("loadDirect (Task 2 fix round 1)", () => {
  it("takes the row lock before it reads the asset", async () => {
    const { tx, ops } = fakeTx([spare]);
    expect(await loadDirect(tx, user, "a1")).toEqual({ asset: spare });
    expect(ops).toEqual(['lock:SELECT "id" FROM "Asset" WHERE "id" = $ FOR UPDATE:a1', "read:a1"]);
  });
  it("a replace locks each item before reading it", async () => {
    const { tx, ops } = fakeTx([held, spare]);
    await replaceCore(tx, user, { employeeId: "emp1", oldAssetId: "a0", newAssetId: "a1", outcome: "DEFECTIVE" }, { dryRun: true });
    expect(ops.filter((o) => o.startsWith("lock:") || o.startsWith("read:")).map((o) => o.replace(/^lock:.*:/, "lock:")))
      .toEqual(["lock:a0", "read:a0", "lock:a1", "read:a1"]);
  });
});

describe("assignCore", () => {
  it("writes the asset, an approval, an audit entry and a webhook", async () => {
    const { tx, rowWrites } = fakeTx([spare]);
    const r = await assignCore(tx, user, { assetId: "a1", employeeId: "emp1" });
    expect(r).toEqual({ ok: true, data: { tag: "BR-LT-0230", employeeName: "Ana Cruz" } });
    expect(rowWrites).toContain("asset:a1");
    expect(writes.approvals).toHaveLength(1);
    expect(writes.hooks).toHaveLength(1);
    expect(writes.audits).toHaveLength(1);
    expect(writes.audits[0].diff).not.toHaveProperty("via");
  });
  it("a dry run returns the same result and writes nothing", async () => {
    const { tx, rowWrites } = fakeTx([spare]);
    const r = await assignCore(tx, user, { assetId: "a1", employeeId: "emp1" }, { dryRun: true });
    expect(r).toEqual({ ok: true, data: { tag: "BR-LT-0230", employeeName: "Ana Cruz" } });
    expect(rowWrites).toEqual([]);
    expect([writes.approvals, writes.audits, writes.hooks]).toEqual([[], [], []]);
  });
  it("a dry run refuses what a real run refuses, in the same words", async () => {
    for (const dryRun of [true, false]) {
      const taken = fakeTx([asset("a1", "BR-LT-0230", "DEPLOYED", "emp9")]);
      expect(await assignCore(taken.tx, user, { assetId: "a1", employeeId: "emp1" }, { dryRun }))
        .toMatchObject({ ok: false, kind: "conflict", message: "BR-LT-0230 reads Deployed, not Spare" });
      const blocked = fakeTx([spare], { openApproval: true });
      expect(await assignCore(blocked.tx, user, { assetId: "a1", employeeId: "emp1" }, { dryRun }))
        .toMatchObject({ ok: false, message: "BR-LT-0230 is held by APR-2050 — resolve it in Approvals first." });
      const reserved = fakeTx([spare], { hold: { employeeId: "emp7", employeeNo: "EMP-0007" } });
      expect(await assignCore(reserved.tx, user, { assetId: "a1", employeeId: "emp1" }, { dryRun }))
        .toMatchObject({ ok: false, message: expect.stringContaining("reserved for EMP-0007") });
      expect(taken.rowWrites.concat(blocked.rowWrites, reserved.rowWrites)).toEqual([]);
    }
    expect(writes.audits).toEqual([]);
  });
  it("via Cris marks the audit entry", async () => {
    const { tx } = fakeTx([spare]);
    await assignCore(tx, user, { assetId: "a1", employeeId: "emp1" }, { via: "Cris" });
    expect(writes.audits[0].diff.via).toEqual({ from: null, to: "Cris" });
  });
  it("via rides the audit diff only when passed, and never the approval payload", async () => {
    await assignCore(fakeTx([spare]).tx, user, { assetId: "a1", employeeId: "emp1" });
    await assignCore(fakeTx([spare]).tx, user, { assetId: "a1", employeeId: "emp1" }, { via: "Cris" });
    expect(writes.audits.map((a) => "via" in a.diff)).toEqual([false, true]);
    expect(JSON.stringify(writes.approvals)).not.toContain("Cris");
    expect(JSON.stringify(writes.approvals)).not.toContain("via");
  });
});

describe("replaceCore", () => {
  const input = { employeeId: "emp1", oldAssetId: "a0", newAssetId: "a1", outcome: "DEFECTIVE" as const };
  it("returns the old and assigns the new, both entries via Cris", async () => {
    const { tx, rowWrites } = fakeTx([held, spare]);
    const r = await replaceCore(tx, user, input, { via: "Cris" });
    expect(r).toEqual({ ok: true, data: { oldTag: "BR-LT-0100", newTag: "BR-LT-0230" } });
    // the assign leg also settles any hold the person had on the new item
    expect(rowWrites).toEqual(["asset:a0", "asset:a1", "reservation"]);
    expect(writes.audits.map((a) => a.action)).toEqual(["lifecycle.replace", "lifecycle.replace"]);
    expect(writes.audits[0].diff).toMatchObject({ replacedBy: { from: null, to: "BR-LT-0230" }, via: { from: null, to: "Cris" } });
    expect(writes.audits[1].diff).toMatchObject({ replaces: { from: null, to: "BR-LT-0100" }, via: { from: null, to: "Cris" } });
  });
  it("a dry run writes nothing", async () => {
    const { tx, rowWrites } = fakeTx([held, spare]);
    expect(await replaceCore(tx, user, input, { dryRun: true, via: "Cris" })).toEqual({ ok: true, data: { oldTag: "BR-LT-0100", newTag: "BR-LT-0230" } });
    expect(rowWrites).toEqual([]);
    expect([writes.approvals, writes.audits, writes.hooks]).toEqual([[], [], []]);
  });
  it("a refused new leg writes neither leg", async () => {
    const { tx, rowWrites } = fakeTx([held, spare], { hold: { employeeId: "emp7", employeeNo: "EMP-0007" } });
    expect(await replaceCore(tx, user, input)).toMatchObject({ ok: false, kind: "conflict", message: expect.stringContaining("reserved for EMP-0007") });
    expect(rowWrites).toEqual([]);
    expect(writes.audits).toEqual([]);
  });
  it("keeps the input refusals", async () => {
    const { tx } = fakeTx([held, spare]);
    expect(await replaceCore(tx, user, { ...input, newAssetId: "a0" }, { dryRun: true }))
      .toMatchObject({ ok: false, kind: "validation", fieldErrors: { newAssetId: "Pick a different device." } });
    expect(await replaceCore(tx, user, { ...input, outcome: "MISSING", reason: "" }, { dryRun: true }))
      .toMatchObject({ ok: false, kind: "validation", fieldErrors: { reason: "Missing needs a reason (at least 3 characters) — it opens an investigation." } });
    expect(await replaceCore(tx, user, { ...input, employeeId: "emp2" }, { dryRun: true }))
      .toMatchObject({ ok: false, message: "BR-LT-0100 isn't held by this person." });
  });
  it("refuses a new item that is not a spare, in a dry run and a real one alike", async () => {
    for (const dryRun of [true, false]) {
      const deployed = fakeTx([held, asset("a1", "BR-LT-0230", "DEPLOYED", "emp9")]);
      expect(await replaceCore(deployed.tx, user, input, { dryRun }))
        .toMatchObject({ ok: false, kind: "conflict", message: "BR-LT-0230 is Deployed, not a spare." });
      const back = fakeTx([held, asset("a1", "BR-LT-0230", "SPARE", null, { returnedAt: new Date("2026-10-01") })]);
      expect(await replaceCore(back.tx, user, input, { dryRun }))
        .toMatchObject({ ok: false, kind: "conflict", message: "BR-LT-0230 is back but not yet triaged — triage it first." });
      expect(deployed.rowWrites.concat(back.rowWrites)).toEqual([]);
    }
    expect(writes.audits).toEqual([]);
  });
  it("refuses a new item of another class before anything is written", async () => {
    // Only IT is direct-lifecycle, so loadDirect refuses the Purchasing item before the one-class check;
    // "Replace within one class only." is the backstop should a second class ever become direct.
    const admin = { ...user, role: "admin" } as User;
    const chair = asset("a1", "BR-CH-0001", "STORED", null, { cls: "PURCHASING" });
    for (const dryRun of [true, false]) {
      const { tx, rowWrites } = fakeTx([held, chair]);
      expect(await replaceCore(tx, admin, input, { dryRun })).toMatchObject({ ok: false, kind: "forbidden" });
      expect(rowWrites).toEqual([]);
    }
    expect(writes.audits).toEqual([]);
  });
});
