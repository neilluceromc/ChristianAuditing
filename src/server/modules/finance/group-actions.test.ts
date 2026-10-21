import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Task 6 (spec §5): Finance reviews a registration group in one go — approve all, hold some back to the right team,
 * undo the whole action, an admin reopens the group — against an in-memory Prisma. The fake has no rollback, so every
 * refusal is also checked against "nothing was written": the actions decide before they write.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  ops: [] as string[],
  webhooks: [] as Array<{ event: string; data: Record<string, unknown> }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/webhooks/emit", () => ({
  emitWebhook: async (_tx: unknown, event: string, data: Record<string, unknown>) => { h.webhooks.push({ event, data }); },
}));
vi.mock("@/server/db/client", () => {
  type R = Record<string, unknown>;
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b || (a == null && b == null);
  const matches = (rec: R, where: R | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === "OR") return (v as R[]).some((w) => matches(rec, w));
      if (k === "AND") return (v as R[]).every((w) => matches(rec, w));
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
        const op = v as { not?: unknown; in?: unknown[] };
        if ("not" in op) return !same(rec[k], op.not);
        if (op.in) return op.in.includes(rec[k]);
      }
      return same(rec[k], v);
    });
  let n = 0;
  const rows = (name: string) => (h.tables[name] ??= []);
  const table = (name: string) => ({
    findUnique: async ({ where }: { where: R }) => {
      const r = rows(name).find((x) => matches(x, where));
      return r ? structuredClone(r) : null;
    },
    findFirst: async ({ where }: { where?: R } = {}) => {
      const r = rows(name).find((x) => matches(x, where));
      return r ? structuredClone(r) : null;
    },
    findMany: async ({ where }: { where?: R } = {}) => structuredClone(rows(name).filter((x) => matches(x, where))),
    count: async ({ where }: { where?: R } = {}) => rows(name).filter((x) => matches(x, where)).length,
    create: async ({ data }: { data: R }) => {
      const row: R = { id: `${name}-${String(++n).padStart(4, "0")}`, createdAt: new Date(), ...data };
      rows(name).push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }: { where: R; data: R }) => {
      const r = rows(name).find((x) => matches(x, where));
      if (!r) throw new Error(`no ${name} row`);
      Object.assign(r, data);
      return structuredClone(r);
    },
    updateMany: async ({ where, data }: { where: R; data: R }) => {
      h.ops.push(`write:${name}`);
      const hit = rows(name).filter((x) => matches(x, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  });
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.ops.push(`lock:${strings.join("$").includes("PurchaseRequest") ? "po" : "assets"}:${values.join(",")}`);
    return [];
  };
  const client = Object.fromEntries(
    ["purchaseOrder", "purchaseOrderLine", "asset", "purchaseRecord", "auditEntry", "notification", "user", "noteEntry"]
      .map((t) => [t, table(t)]),
  ) as Record<string, ReturnType<typeof table>>;
  const full = { ...client, $queryRaw };
  return { prisma: { ...full, $transaction: async (fn: (tx: typeof full) => Promise<unknown>) => fn(full) } };
});

import { approveGroup } from "./group-actions";
import { reopenGroup, undoGroupAction } from "./undo-actions";

const ANA = { id: "u-ana", name: "Ana Cruz", role: "finance_staff" };
const BEN = { id: "u-ben", name: "Ben Reyes", role: "finance_staff" };
const IVAN = { id: "u-ivan", name: "Ivan Tan", role: "it_staff" };
const ADA = { id: "u-ada", name: "Ada Admin", role: "admin" };

const T0 = new Date("2026-10-21T02:42:00Z"); // 10:42 Manila
const at = (min: number) => vi.setSystemTime(new Date(T0.getTime() + min * 60_000));
const CHECKED = new Date("2026-10-20T00:00:00Z");

const t = (name: string) => h.tables[name];
const asset = (id: string) => t("asset").find((a) => a.id === id)!;
const po = () => t("purchaseOrder").find((p) => p.id === "po1")!;
const audits = (action: string) => t("auditEntry").filter((a) => a.action === action);

function seedAsset(id: string, extra: Row = {}) {
  t("asset").push({
    id, tag: `BR-LT-${id}`, cls: "IT", model: "Latitude 5440", serial: `SN${id}`, cost: 50000,
    purchaseRecordId: "rec1", purchaseOrderId: "po1", purchaseOrderLineId: "ln1", itVerifiedAt: CHECKED,
    financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false,
    financeReturnedAt: null, financeReturnedById: null, financeReturnedTo: null, financeReturnReason: null,
    financeReturnFields: [], financeResubmitNote: null,
    ...extra,
  });
}

/** PO-0214 with one line of `qty` laptops; registration rec1 (by IT) holds BR-LT-0205..0207. */
function seed(qty = 3, poExtra: Row = {}) {
  t("purchaseOrder").push({
    id: "po1", refNo: "PO-0214", state: "READY", invoiceRef: "SI-0012", completedAt: null, ...poExtra,
  });
  t("purchaseOrderLine").push({ id: "ln1", orderId: "po1", description: "laptops", qty, closedShort: 0, unitPrice: 50000 });
  t("purchaseRecord").push({ id: "rec1", cls: "IT", purchaseOrderId: "po1", createdById: IVAN.id, createdAt: CHECKED, fees: null });
  for (const id of ["0205", "0206", "0207"]) seedAsset(id);
}
const ALL = ["0205", "0206", "0207"];

/** A refusal writes nothing at all. */
async function expectRefused(run: () => Promise<{ ok: boolean }>, message: string) {
  const before = structuredClone(h.tables);
  const fired = h.webhooks.length;
  const r = await run();
  expect(r).toMatchObject({ ok: false, message });
  expect(h.tables).toEqual(before);
  expect(h.webhooks).toHaveLength(fired);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  h.user = ANA;
  h.ops = [];
  h.webhooks = [];
  h.tables = {
    user: [ANA, BEN, IVAN, ADA].map((u) => ({ ...u })),
    purchaseOrder: [], purchaseOrderLine: [], asset: [], purchaseRecord: [], auditEntry: [], notification: [], noteEntry: [],
  };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("approveGroup", () => {
  it("approve all: every asset approved by the person, one finance.confirm each with the group in its diff", async () => {
    seed();
    const r = await approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL });
    expect(r).toEqual({ ok: true, data: { approved: 3, heldBack: 0, refNo: "PO-0214" } });
    for (const id of ALL) {
      expect(asset(id)).toMatchObject({ financeConfirmedById: ANA.id, financeNotCapitalised: false });
      expect(asset(id).financeConfirmedAt).toEqual(T0);
    }
    expect(audits("finance.confirm").map((a) => a.entityId)).toEqual(ALL);
    for (const a of audits("finance.confirm")) {
      expect(a).toMatchObject({ entityType: "asset", actorId: ANA.id, source: "web" });
      expect(a.diff).toMatchObject({ financeConfirmed: { from: null, to: "Ana Cruz" }, group: { from: null, to: "rec1" } });
    }
    expect(t("notification")).toEqual([]);
    // the PO row first, then the group's assets, before anything is read or written
    expect(h.ops.slice(0, 2)).toEqual(["lock:po:po1", "lock:assets:rec1"]);
  });

  it("hold back one: two approved, one returned to IT with its fields; one IT SENT_BACK notification", async () => {
    seed();
    const r = await approveGroup({
      recordId: "rec1", notCapitalised: false, assetIds: ALL,
      holdBack: [{ assetId: "0207", team: "IT", fields: ["serial"], note: "Serial doesn't match the photo" }],
    });
    expect(r).toEqual({ ok: true, data: { approved: 2, heldBack: 1, refNo: "PO-0214" } });
    expect(asset("0205").financeConfirmedAt).toEqual(T0);
    expect(asset("0206").financeConfirmedAt).toEqual(T0);
    expect(asset("0207")).toMatchObject({
      financeConfirmedAt: null, financeReturnedTo: "IT", financeReturnedById: ANA.id,
      financeReturnFields: ["serial"], financeReturnReason: "Serial doesn't match the photo",
    });
    expect(asset("0207").financeReturnedAt).toEqual(T0);
    const ret = audits("finance.return");
    expect(ret).toHaveLength(1);
    expect(ret[0]).toMatchObject({ entityId: "0207", source: "web" });
    expect(ret[0].diff).toMatchObject({
      financeReturn: { from: null, to: { fields: ["Serial number"], note: "Serial doesn't match the photo", team: "IT" } },
      group: { from: null, to: "rec1" },
    });
    expect(t("notification")).toHaveLength(1);
    expect(t("notification")[0]).toMatchObject({ team: "IT", kind: "SENT_BACK", actorId: ANA.id, href: "/inventory/0207" });
  });

  it("the group's Not capitalised applies to each asset unless overridden; a mismatch with the cost is refused", async () => {
    seed();
    asset("0205").cost = null;
    asset("0206").cost = null;
    const ok = await approveGroup({
      recordId: "rec1", notCapitalised: true, assetIds: ALL, overrides: [{ assetId: "0207", notCapitalised: false }],
    });
    expect(ok.ok).toBe(true);
    expect([asset("0205").financeNotCapitalised, asset("0206").financeNotCapitalised, asset("0207").financeNotCapitalised])
      .toEqual([true, true, false]);
  });

  it("no SI refused", async () => {
    seed(3, { invoiceRef: null });
    await expectRefused(
      () => approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL }),
      "No SI number yet. Add it before approving.",
    );
  });

  it("stale asset refused: one sent back since the page was opened", async () => {
    seed();
    Object.assign(asset("0207"), { financeReturnedAt: CHECKED, financeReturnedTo: "IT" });
    await expectRefused(
      () => approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL }),
      "BR-LT-0207 changed since you opened this. Reload.",
    );
  });

  it("refuses while the PO is with Purchasing for corrections", async () => {
    seed(3, { state: "SENT_BACK" });
    await expectRefused(
      () => approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL }),
      "PO-0214 is with Purchasing for corrections.",
    );
  });

  it("a held-back money field on a PO asset is refused: send the PO back instead", async () => {
    seed();
    await expectRefused(
      () => approveGroup({
        recordId: "rec1", notCapitalised: false, assetIds: ALL,
        holdBack: [{ assetId: "0207", team: "PURCHASING", fields: ["invoiceRef"], note: "" }],
      }),
      "BR-LT-0207: Send PO-0214 back instead.",
    );
  });

  it("Finance and admins only", async () => {
    seed();
    h.user = IVAN;
    expect(await approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL })).toMatchObject({ ok: false, kind: "forbidden" });
  });
});

describe("webhooks fire once on full approval", () => {
  it("both events when every line is registered and every asset approved; once only", async () => {
    seed(3);
    expect((await approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL })).ok).toBe(true);
    expect(h.webhooks).toEqual([
      { event: "purchase_order.approved", data: { purchaseOrderId: "po1", refNo: "PO-0214" } },
      { event: "purchase_request.completed", data: { purchaseRequestId: "po1", refNo: "PO-0214" } },
    ]);
    expect(po().completedAt).toEqual(T0);

    // undo and approve again: the PO already fired, so nothing fires twice
    at(2);
    expect((await undoGroupAction({ recordId: "rec1" })).ok).toBe(true);
    at(3);
    expect((await approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL })).ok).toBe(true);
    expect(h.webhooks).toHaveLength(2);
  });

  it("not on a partial group: units of the line still to register", async () => {
    seed(5);
    expect((await approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL })).ok).toBe(true);
    expect(h.webhooks).toEqual([]);
    expect(po().completedAt).toBeNull();
  });

  it("not while one asset is held back", async () => {
    seed(3);
    await approveGroup({
      recordId: "rec1", notCapitalised: false, assetIds: ALL,
      holdBack: [{ assetId: "0207", team: "IT", fields: ["serial"], note: "Wrong serial" }],
    });
    expect(h.webhooks).toEqual([]);
  });
});

describe("undoGroupAction", () => {
  it("reverses the whole action, approvals and hold-backs, with one undone entry per asset", async () => {
    seed();
    const before = structuredClone(t("asset"));
    await approveGroup({
      recordId: "rec1", notCapitalised: false, assetIds: ALL,
      holdBack: [{ assetId: "0207", team: "IT", fields: ["serial"], note: "Wrong serial" }],
    });
    at(5);
    expect(await undoGroupAction({ recordId: "rec1" })).toEqual({ ok: true, data: { undone: 3, refNo: "PO-0214" } });
    expect(t("asset")).toEqual(before);
    expect(audits("finance.confirm.undone").map((a) => a.entityId)).toEqual(["0205", "0206"]);
    expect(audits("asset.return.undone").map((a) => a.entityId)).toEqual(["0207"]);
    expect([...audits("finance.confirm.undone"), ...audits("asset.return.undone")].every((a) => a.source === "web")).toBe(true);
  });

  it("when one asset changed since, the whole undo is refused with that asset's reason", async () => {
    seed();
    await approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL });
    at(2);
    // an admin reopened one of them in between
    h.user = ADA;
    expect((await reopenGroup({ recordId: "rec1", reason: "Recheck the serials" })).ok).toBe(true);
    h.user = ANA;
    at(3);
    const r = await undoGroupAction({ recordId: "rec1" });
    expect(r).toMatchObject({ ok: false, kind: "conflict" });
    expect((r as { message: string }).message).toMatch(/^Can't undo: BR-LT-0205 — Ada Admin reopened the review at 10:44\.$/);
  });

  it("only the person who did it, within 15 minutes", async () => {
    seed();
    await approveGroup({ recordId: "rec1", notCapitalised: false, assetIds: ALL });
    h.user = BEN;
    await expectRefused(() => undoGroupAction({ recordId: "rec1" }), "Can't undo: there is no recent group action of yours to undo.");
    h.user = ANA;
    at(16);
    await expectRefused(
      () => undoGroupAction({ recordId: "rec1" }),
      "Can't undo: BR-LT-0205 — the 15 minutes to undo it ended at 10:57.",
    );
  });
});

describe("reopenGroup", () => {
  it("reopenGroup admin only: every approved asset back to To review, with the reason", async () => {
    seed();
    await approveGroup({
      recordId: "rec1", notCapitalised: false, assetIds: ALL,
      holdBack: [{ assetId: "0207", team: "IT", fields: ["serial"], note: "Wrong serial" }],
    });
    expect(await reopenGroup({ recordId: "rec1", reason: "Recheck the costs" })).toMatchObject({ ok: false, kind: "forbidden" });
    h.user = ADA;
    expect(await reopenGroup({ recordId: "rec1", reason: "x" })).toMatchObject({ ok: false, kind: "validation" });
    expect(await reopenGroup({ recordId: "rec1", reason: "Recheck the costs" })).toEqual({ ok: true, data: { reopened: 2, refNo: "PO-0214" } });
    expect(asset("0205").financeConfirmedAt).toBeNull();
    expect(asset("0206").financeConfirmedAt).toBeNull();
    const reopened = audits("finance.confirm.reopened");
    expect(reopened.map((a) => a.entityId)).toEqual(["0205", "0206"]);
    expect(reopened.every((a) => a.reason === "Recheck the costs" && a.source === "web")).toBe(true);
  });

  it("refuses a group with nothing approved", async () => {
    seed();
    h.user = ADA;
    await expectRefused(() => reopenGroup({ recordId: "rec1", reason: "Recheck the costs" }), "Nothing in this group is approved, so there is no review to reopen.");
  });
});
