import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Finance follow-up, Task 2 (spec §3; Review Focus 1, 2 and 5): Undo and the admin's Reopen review, on the server,
 * against an in-memory Prisma. The original actions run for real (approve, send back, resubmit, override set and
 * cleared), so each undo is checked against the exact state before the action, and every refusal against "nothing
 * was written".
 */

type Rec = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  rate: { allowed: true, retryAfterSec: 0 },
  assets: new Map<string, Record<string, unknown>>(),
  audits: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
  /** Runs once just before the next asset write lands: another person's change slipping in between read and write. */
  interfere: null as null | (() => void),
  /** The order of the row lock and the reads/writes inside a transaction. */
  ops: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => h.rate }));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async () => {} }));
vi.mock("@/server/modules/finance/queries", () => ({ nextToReview: async () => null }));
vi.mock("@/server/modules/finance/review-queue", () => ({ toReviewCount: async () => 0 }));
vi.mock("@/server/db/client", () => {
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b || (a == null && b == null);
  const matches = (rec: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => matches(rec, w));
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const op = v as { not?: unknown; in?: unknown[]; startsWith?: string };
        if ("not" in op) return !same(rec[k], op.not);
        if (op.in) return op.in.includes(rec[k]);
        if (op.startsWith !== undefined) return typeof rec[k] === "string" && (rec[k] as string).startsWith(op.startsWith);
      }
      return same(rec[k], v);
    });
  const asset = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      h.ops.push("read");
      const a = h.assets.get(where.id);
      return a ? { ...a } : null;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      h.ops.push("write");
      const meddle = h.interfere;
      h.interfere = null;
      meddle?.();
      const a = h.assets.get(where.id as string);
      if (!a || !matches(a, where)) return { count: 0 };
      Object.assign(a, data);
      return { count: 1 };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      h.ops.push("write");
      const a = h.assets.get(where.id)!;
      Object.assign(a, data);
      return { ...a };
    },
  };
  const auditEntry = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `aud${String(h.audits.length + 1).padStart(3, "0")}`, createdAt: new Date(), source: null, reason: null, diff: null, ...data };
      h.audits.push(row);
      return row;
    },
    findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
      const rows = h.audits.filter((r) => matches(r, where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || String(b.id).localeCompare(String(a.id)));
      return structuredClone(rows.slice(0, take ?? rows.length));
    },
  };
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.ops.push(`raw:${strings.join("$").replace(/\s+/g, " ").trim()}:${values.join(",")}`);
    return [];
  };
  const client = { asset, auditEntry, $queryRaw };
  return { prisma: { ...client, $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => fn(client) } };
});

import { confirmAssetDetails, resubmitAssetToFinance, returnAssetToIt } from "@/server/modules/inventory/actions";
import { clearAssetOverride, setAssetOverride } from "./depreciation-actions";
import { reopenFinanceReview, undoFinanceAction } from "./undo-actions";

const ANA = { id: "u-ana", name: "Ana Cruz", role: "finance_staff" };
const BEN = { id: "u-ben", name: "Ben Reyes", role: "finance_staff" };
const IVAN = { id: "u-ivan", name: "Ivan Tan", role: "it_staff" };
const ADA = { id: "u-ada", name: "Ada Admin", role: "admin" };
const VIC = { id: "u-vic", name: "Vic Ong", role: "viewer" };

const T0 = new Date("2026-10-21T02:42:00Z"); // 10:42 Manila
const at = (min: number) => vi.setSystemTime(new Date(T0.getTime() + min * 60_000));

function seed(id: string, extra: Rec = {}): Rec {
  const a: Rec = {
    id, tag: `BR-LT-${id}`, cls: "IT", itVerifiedAt: new Date("2026-10-01T00:00:00Z"), cost: 50000, purchaseRecordId: null,
    financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false,
    financeReturnedAt: null, financeReturnedById: null, financeReturnReason: null, financeReturnFields: [], financeResubmitNote: null,
    depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null,
    ...extra,
  };
  h.assets.set(id, a);
  return structuredClone(a);
}
const asset = (id: string) => h.assets.get(id)!;
const as = (u: typeof ANA) => { h.user = u; };

/** The undo puts back every column the action touched; nothing else differs. */
function expectRestored(id: string, before: Rec) {
  expect(asset(id)).toEqual(before);
}

/** A refusal writes nothing: the asset and the audit trail are as they were. */
async function expectRefused(run: () => Promise<{ ok: boolean; message?: string }>, message: string) {
  const assets = structuredClone([...h.assets.values()]);
  const audits = structuredClone(h.audits);
  const r = await run();
  expect(r).toMatchObject({ ok: false, kind: "conflict", message });
  expect([...h.assets.values()]).toEqual(assets);
  expect(h.audits).toEqual(audits);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  h.user = ANA;
  h.rate = { allowed: true, retryAfterSec: 0 };
  h.assets = new Map();
  h.audits = [];
  h.revalidated = [];
  h.interfere = null;
  h.ops = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("undo approve", () => {
  it("returns the asset to To review exactly as before, IT's reply included", async () => {
    const before = seed("0201", { financeResubmitNote: "Uploaded the OR" });
    expect((await confirmAssetDetails({ id: "0201" })).ok).toBe(true);
    expect(h.audits[0]).toMatchObject({
      action: "finance.confirm",
      diff: { financeConfirmed: { from: null, to: "Ana Cruz" }, resubmitNote: { from: "Uploaded the OR", to: null } },
    });
    const original = structuredClone(h.audits[0]);

    at(3);
    const r = await undoFinanceAction({ assetId: "0201", kind: "approve" });
    expect(r).toEqual({ ok: true, data: { tag: "BR-LT-0201", id: "0201" } });
    expectRestored("0201", before);
    // append-only: the approval's entry is untouched, and the undo is a new one
    expect(h.audits).toHaveLength(2);
    expect(h.audits[0]).toEqual(original);
    expect(h.audits[1]).toMatchObject({
      actorId: ANA.id, actorLabel: ANA.name, entityType: "asset", entityId: "0201", action: "finance.confirm.undone", source: "web",
      diff: { financeConfirmed: { from: "Ana Cruz", to: null }, review: { from: "Approved", to: "To review" } },
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/finance/assets", "/finance/assets/0201", "/inventory/0201"]));
  });

  it("approve as not capitalised: the flag goes back to what it was", async () => {
    const before = seed("0202", { cost: null });
    expect((await confirmAssetDetails({ id: "0202", notCapitalised: true })).ok).toBe(true);
    expect(asset("0202").financeNotCapitalised).toBe(true);
    expect(h.audits[0].diff).toMatchObject({ notCapitalised: { from: false, to: true } });

    expect((await undoFinanceAction({ assetId: "0202", kind: "approve" })).ok).toBe(true);
    expectRestored("0202", before);
    expect(h.audits[1].diff).toMatchObject({ notCapitalised: { from: true, to: false } });
  });

  it("an approval that leaves the flag false records no flag change (no 'No → No' chip)", async () => {
    seed("0203");
    await confirmAssetDetails({ id: "0203" });
    expect(h.audits[0].diff).not.toHaveProperty("notCapitalised");
  });
});

describe("undo send back", () => {
  it("clears the send-back, its checklist and note, and puts IT's reply back", async () => {
    const before = seed("0210", { financeResubmitNote: "Fixed the serial" });
    expect((await returnAssetToIt({ id: "0210", fields: ["cost", "doc:official-receipt"], note: "Check the OR" })).ok).toBe(true);
    expect(h.audits[0].diff).toMatchObject({
      financeReturn: { from: null, to: { fields: ["Cost", "Official receipt"], note: "Check the OR" } },
      resubmitNote: { from: "Fixed the serial", to: null },
    });
    const original = structuredClone(h.audits[0]);

    at(5);
    expect(await undoFinanceAction({ assetId: "0210", kind: "send-back" })).toEqual({ ok: true, data: { tag: "BR-LT-0210", id: "0210" } });
    expectRestored("0210", before);
    expect(h.audits[0]).toEqual(original);
    expect(h.audits[1]).toMatchObject({
      action: "asset.return.undone", source: "web",
      diff: { review: { from: "Sent back", to: "To review" }, flagged: { from: ["Cost", "Official receipt"], to: null } },
    });
  });

  it("a send-back over an earlier one records it, and is final", async () => {
    seed("0211");
    await returnAssetToIt({ id: "0211", fields: ["cost"] });
    at(1);
    await returnAssetToIt({ id: "0211", fields: ["serial"] });
    expect(h.audits[1].diff).toMatchObject({ financeReturn: { from: "returned" } });
    await expectRefused(() => undoFinanceAction({ assetId: "0211", kind: "send-back" }), "Can't undo: this send-back replaced an earlier one.");
  });
});

describe("undo depreciation settings", () => {
  it("with no earlier override, goes back to the category policy, not zeros (Review Focus 5)", async () => {
    const before = seed("0220", { financeConfirmedAt: T0, financeConfirmedById: ANA.id });
    expect((await setAssetOverride({ assetId: "0220", lifeMonths: 24, salvage: 1000, note: "Heavy field use" })).ok).toBe(true);
    expect(await undoFinanceAction({ assetId: "0220", kind: "settings" })).toMatchObject({ ok: true });
    expectRestored("0220", before);
    expect(asset("0220")).toMatchObject({ depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null });
    expect(h.audits[1]).toMatchObject({
      action: "depreciation.override.undone", source: "web",
      diff: { lifeMonths: { from: 24, to: null }, salvage: { from: 1000, to: null }, depreciationNote: { from: "Heavy field use", to: null } },
    });
    expect(h.revalidated).toContain("/finance/depreciation");
  });

  it("restores the earlier override exactly", async () => {
    const before = seed("0221", { depreciationLifeMonths: 36, depreciationSalvage: 500, depreciationNote: "Older model" });
    await setAssetOverride({ assetId: "0221", lifeMonths: 24, salvage: 1000, note: "Heavy field use" });
    expect((await undoFinanceAction({ assetId: "0221", kind: "settings" })).ok).toBe(true);
    expectRestored("0221", before);
  });

  it("an override removed: the removal records what it removed, and the undo puts it back", async () => {
    const before = seed("0222", { depreciationLifeMonths: 36, depreciationSalvage: 500, depreciationNote: "Older model" });
    expect((await clearAssetOverride({ assetId: "0222" })).ok).toBe(true);
    expect(h.audits[0]).toMatchObject({
      action: "depreciation.override.cleared",
      diff: { lifeMonths: { from: 36, to: null }, salvage: { from: 500, to: null }, note: { from: "Older model", to: null } },
    });
    expect((await undoFinanceAction({ assetId: "0222", kind: "settings" })).ok).toBe(true);
    expectRestored("0222", before);
  });
});

describe("undo refusals, on the server", () => {
  it("someone else cannot undo it (Review Focus 2)", async () => {
    seed("0230");
    await confirmAssetDetails({ id: "0230" });
    as(BEN);
    await expectRefused(() => undoFinanceAction({ assetId: "0230", kind: "approve" }), "Can't undo: only Ana Cruz can undo this.");
    as(ADA);
    await expectRefused(() => undoFinanceAction({ assetId: "0230", kind: "approve" }), "Can't undo: only Ana Cruz can undo this.");
  });

  it("not after 15 minutes by the server's clock (Review Focus 2)", async () => {
    seed("0231");
    await confirmAssetDetails({ id: "0231" });
    at(15);
    await expectRefused(() => undoFinanceAction({ assetId: "0231", kind: "approve" }), "Can't undo: the 15 minutes to undo it ended at 10:57.");
  });

  it("not after IT resubmitted it (Review Focus 1)", async () => {
    seed("0232");
    await returnAssetToIt({ id: "0232", fields: ["cost"] });
    at(2);
    as(IVAN);
    expect((await resubmitAssetToFinance({ id: "0232", reply: "Cost fixed" })).ok).toBe(true);
    as(ANA);
    at(3);
    await expectRefused(
      () => undoFinanceAction({ assetId: "0232", kind: "send-back" }),
      "Can't undo: Ivan Tan resubmitted the asset to Finance at 10:44.",
    );
  });

  it("not after another finance change since (Review Focus 1)", async () => {
    seed("0233");
    await confirmAssetDetails({ id: "0233" });
    at(1);
    as(BEN);
    await setAssetOverride({ assetId: "0233", lifeMonths: 24, salvage: 0, note: "Shorter life" });
    as(ANA);
    await expectRefused(
      () => undoFinanceAction({ assetId: "0233", kind: "approve" }),
      "Can't undo: Ben Reyes set a custom depreciation at 10:43.",
    );
  });

  it("an undo cannot be undone again", async () => {
    seed("0234");
    await confirmAssetDetails({ id: "0234" });
    await undoFinanceAction({ assetId: "0234", kind: "approve" });
    await expectRefused(() => undoFinanceAction({ assetId: "0234", kind: "approve" }), "Can't undo: you undid the approval at 10:42.");
  });

  it("only Finance and admins; rate-limited; a bad kind is a validation error", async () => {
    seed("0235");
    await confirmAssetDetails({ id: "0235" });
    for (const u of [IVAN, VIC]) {
      as(u);
      expect(await undoFinanceAction({ assetId: "0235", kind: "approve" })).toMatchObject({ ok: false, kind: "forbidden" });
    }
    as(ANA);
    h.rate = { allowed: false, retryAfterSec: 9 };
    expect(await undoFinanceAction({ assetId: "0235", kind: "approve" })).toMatchObject({ ok: false, kind: "rate_limited" });
    h.rate = { allowed: true, retryAfterSec: 0 };
    expect(await undoFinanceAction({ assetId: "0235", kind: "reject" })).toMatchObject({ ok: false, kind: "validation" });
    expect(await undoFinanceAction({ assetId: "nope", kind: "approve" })).toMatchObject({ ok: false, kind: "validation" });
    expect(h.audits).toHaveLength(1);
  });
});

describe("admin reopen", () => {
  it("returns an approved asset to To review, with the reason, at any time", async () => {
    seed("0240", { cost: null });
    await confirmAssetDetails({ id: "0240", notCapitalised: true });
    const original = structuredClone(h.audits[0]);
    at(60 * 24);
    as(ADA);
    expect(await reopenFinanceReview({ assetId: "0240", reason: "  Wrong category  " })).toEqual({ ok: true, data: { tag: "BR-LT-0240", id: "0240" } });
    expect(asset("0240")).toMatchObject({ financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false });
    expect(h.audits[0]).toEqual(original);
    expect(h.audits[1]).toMatchObject({
      actorId: ADA.id, action: "finance.confirm.reopened", source: "web", reason: "Wrong category",
      diff: { review: { from: "Approved", to: "To review" }, notCapitalised: { from: true, to: false } },
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/finance/assets", "/finance/assets/0240"]));
  });

  it("is admin only", async () => {
    seed("0241", { financeConfirmedAt: T0, financeConfirmedById: ANA.id });
    for (const u of [ANA, IVAN, VIC]) {
      as(u);
      expect(await reopenFinanceReview({ assetId: "0241", reason: "Wrong category" })).toMatchObject({ ok: false, kind: "forbidden" });
    }
    expect(asset("0241").financeConfirmedAt).toEqual(T0);
    expect(h.audits).toHaveLength(0);
  });

  it("needs a reason of 5 to 300 characters", async () => {
    seed("0242", { financeConfirmedAt: T0, financeConfirmedById: ANA.id });
    as(ADA);
    for (const reason of ["", "abcd", "   abcd   ", "x".repeat(301)]) {
      expect(await reopenFinanceReview({ assetId: "0242", reason })).toMatchObject({
        ok: false, kind: "validation", fieldErrors: { reason: "Give a reason of 5 to 300 characters" },
      });
    }
    expect(h.audits).toHaveLength(0);
    expect((await reopenFinanceReview({ assetId: "0242", reason: "x".repeat(300) })).ok).toBe(true);
  });

  it("only an approved asset", async () => {
    seed("0243");
    as(ADA);
    await expectRefused(
      () => reopenFinanceReview({ assetId: "0243", reason: "Wrong category" }),
      "BR-LT-0243 isn't approved, so there is no review to reopen.",
    );
  });
});

describe("fix round 1: races", () => {
  const LOCK = (id: string) => `raw:SELECT "id" FROM "Asset" WHERE "id" = $ FOR UPDATE:${id}`;

  it("undo and reopen lock the asset row before they read it", async () => {
    seed("0250");
    await confirmAssetDetails({ id: "0250" });
    h.ops = [];
    expect((await undoFinanceAction({ assetId: "0250", kind: "approve" })).ok).toBe(true);
    expect(h.ops.slice(0, 2)).toEqual([LOCK("0250"), "read"]);

    seed("0251", { financeConfirmedAt: T0, financeConfirmedById: ANA.id });
    as(ADA);
    h.ops = [];
    expect((await reopenFinanceReview({ assetId: "0251", reason: "Wrong category" })).ok).toBe(true);
    expect(h.ops.slice(0, 2)).toEqual([LOCK("0251"), "read"]);
  });

  it("an undo whose guarded write misses says so and writes no audit entry", async () => {
    seed("0252");
    await confirmAssetDetails({ id: "0252" });
    h.interfere = () => { asset("0252").financeConfirmedById = BEN.id; };
    const r = await undoFinanceAction({ assetId: "0252", kind: "approve" });
    expect(r).toMatchObject({ ok: false, kind: "conflict", message: "BR-LT-0252 was changed by someone else just now. Reload and try again." });
    expect(h.audits).toHaveLength(1);
    expect(asset("0252").financeConfirmedAt).toEqual(T0);
  });

  it("an override set reads inside the transaction and refuses when the override changed under it, so its before is never stale", async () => {
    seed("0253", { depreciationLifeMonths: 36, depreciationSalvage: 500, depreciationNote: "Older model" });
    h.interfere = () => { Object.assign(asset("0253"), { depreciationLifeMonths: 48 }); };
    const r = await setAssetOverride({ assetId: "0253", lifeMonths: 24, salvage: 1000, note: "Heavy field use" });
    expect(r).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.audits).toHaveLength(0);
    expect(asset("0253").depreciationLifeMonths).toBe(48);
    expect(h.ops[0]).toBe("read");
  });

  it("an override removal does the same", async () => {
    seed("0254", { depreciationLifeMonths: 36, depreciationSalvage: 500, depreciationNote: "Older model" });
    h.interfere = () => { Object.assign(asset("0254"), { depreciationNote: "Changed meanwhile" }); };
    const r = await clearAssetOverride({ assetId: "0254" });
    expect(r).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.audits).toHaveLength(0);
    expect(asset("0254").depreciationLifeMonths).toBe(36);
  });
});
