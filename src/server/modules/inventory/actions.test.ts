import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Task 6 (spec §2, §5): Finance sends an asset back to the team that owns what's wrong (returnAsset), the department
 * resubmits only what came back to it, and updateAsset holds every field to its owner (canEditField) — Finance fixes
 * money with a reason and never touches IT's fields; an asset from a PO is fixed on its PO. In-memory Prisma.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  webhooks: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/recent-picks", () => ({ rememberPicks: async () => {} }));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async (_tx: unknown, event: string) => { h.webhooks.push(event); } }));
vi.mock("@/server/modules/finance/queries", () => ({ nextToReview: async () => null, financeViewWhere: () => ({}) }));
vi.mock("@/server/modules/finance/review-queue", () => ({ toReviewCount: async () => 0 }));
vi.mock("@/server/modules/inventory/queries", () => ({ repairStageIds: async () => null }));
vi.mock("@/server/modules/inventory/register-queries", () => ({ typeRequired: async () => false }));
vi.mock("@/server/db/client", () => {
  type R = Record<string, unknown>;
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b || (a == null && b == null);
  const matches = (rec: R, where: R | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === "OR") return (v as R[]).some((w) => matches(rec, w));
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
    create: async ({ data }: { data: R }) => {
      const row: R = { id: `${name}-${++n}`, createdAt: new Date(), ...data };
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
      const hit = rows(name).filter((x) => matches(x, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  });
  const client = Object.fromEntries(
    ["asset", "purchaseRecord", "purchaseOrder", "purchaseOrderLine", "auditEntry", "notification", "user", "assetCategory", "vendor"]
      .map((t) => [t, table(t)]),
  ) as Record<string, ReturnType<typeof table>>;
  const full = { ...client, $queryRaw: async () => [] };
  return { prisma: { ...full, $transaction: async (fn: (tx: typeof full) => Promise<unknown>) => fn(full) } };
});

import { confirmAssetDetails, resubmitAssetToFinance, returnAsset, updateAsset } from "./actions";

const ANA = { id: "u-ana", name: "Ana Cruz", role: "finance_staff" };
const IVAN = { id: "u-ivan", name: "Ivan Tan", role: "it_staff" };
const PAT = { id: "u-pat", name: "Pat Lim", role: "purchasing_staff" };
const ADA = { id: "u-ada", name: "Ada Admin", role: "admin" };

const CHECKED = new Date("2026-10-20T00:00:00Z");
const t = (name: string) => h.tables[name];
const asset = (id: string) => t("asset").find((a) => a.id === id)!;

function seedAsset(id: string, extra: Row = {}) {
  t("asset").push({
    id, tag: `BR-LT-${id}`, cls: "IT", model: "Latitude 5440", serial: `SN${id}`, brand: "Dell", categoryId: "cat-lt", typeId: null,
    cost: 50000, purchasedAt: CHECKED, vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, notes: null,
    warrantyUntil: null, warrantyCoveredBy: null, warrantyContact: null, rmaRef: null, repairQuote: null,
    purchaseRecordId: "rec-it", purchaseOrderId: null, itVerifiedAt: CHECKED,
    financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false,
    financeReturnedAt: null, financeReturnedById: null, financeReturnedTo: null, financeReturnReason: null,
    financeReturnFields: [], financeResubmitNote: null,
    ...extra,
  });
}

/** A refusal writes nothing at all. */
async function expectRefused(run: () => Promise<{ ok: boolean }>, expected: Row) {
  const before = structuredClone(h.tables);
  const r = await run();
  expect(r).toMatchObject({ ok: false, ...expected });
  expect(h.tables).toEqual(before);
}

beforeEach(() => {
  h.user = ANA;
  h.webhooks = [];
  h.tables = {
    user: [ANA, IVAN, PAT, ADA].map((u) => ({ ...u })),
    purchaseRecord: [
      { id: "rec-it", cls: "IT", purchaseOrderId: null, createdById: IVAN.id },
      { id: "rec-pat", cls: "IT", purchaseOrderId: null, createdById: PAT.id },
      { id: "rec-po", cls: "IT", purchaseOrderId: "po1", createdById: IVAN.id },
    ],
    purchaseOrder: [{ id: "po1", refNo: "PO-0214", state: "READY", invoiceRef: "SI-0012", completedAt: null }],
    purchaseOrderLine: [{ id: "ln1", orderId: "po1", qty: 1, closedShort: 0 }],
    assetCategory: [{ id: "cat-lt", name: "Laptops", cls: "IT" }],
    vendor: [{ id: "v1", name: "Octagon" }],
    asset: [], auditEntry: [], notification: [],
  };
});

describe("returnAsset", () => {
  it("a way-3 asset registered by IT: its SI number goes back to IT, never to Purchasing", async () => {
    seedAsset("0301");
    await expectRefused(
      () => returnAsset({ id: "0301", team: "PURCHASING", fields: ["invoiceRef"] }),
      { kind: "validation", fieldErrors: { team: "Invoice no. goes back to IT" } },
    );
    const r = await returnAsset({ id: "0301", team: "IT", fields: ["invoiceRef"], note: "SI number is off by one" });
    expect(r).toEqual({ ok: true, data: { tag: "BR-LT-0301" } });
    expect(asset("0301")).toMatchObject({
      financeReturnedTo: "IT", financeReturnedById: ANA.id, financeReturnFields: ["invoiceRef"], financeReturnReason: "SI number is off by one",
    });
    const audit = t("auditEntry").find((a) => a.action === "finance.return")!;
    expect(audit).toMatchObject({ entityId: "0301", source: "web" });
    expect(audit.diff).toMatchObject({ financeReturn: { from: null, to: { fields: ["Invoice no."], note: "SI number is off by one", team: "IT" } } });
    expect(t("notification")).toEqual([
      expect.objectContaining({ team: "IT", kind: "SENT_BACK", href: "/inventory/0301", entityType: "asset", entityId: "0301" }),
    ]);
  });

  it("a legacy batch Purchasing registered: its money goes back to Purchasing", async () => {
    seedAsset("0302", { purchaseRecordId: "rec-pat" });
    expect((await returnAsset({ id: "0302", team: "PURCHASING", fields: ["cost"] })).ok).toBe(true);
    expect(asset("0302").financeReturnedTo).toBe("PURCHASING");
  });

  it("money field on a PO asset refused: send the PO back instead", async () => {
    seedAsset("0303", { purchaseRecordId: "rec-po", purchaseOrderId: "po1" });
    await expectRefused(
      () => returnAsset({ id: "0303", team: "PURCHASING", fields: ["cost", "serial"] }),
      { kind: "validation", fieldErrors: { fields: "Send PO-0214 back instead" } },
    );
  });

  it("fieldOwner mismatch refused: an IT asset's serial is IT's", async () => {
    seedAsset("0304", { purchaseRecordId: "rec-po", purchaseOrderId: "po1" });
    await expectRefused(
      () => returnAsset({ id: "0304", team: "PURCHASING", fields: ["serial"] }),
      { kind: "validation", fieldErrors: { team: "Serial number goes back to IT" } },
    );
    expect((await returnAsset({ id: "0304", team: "IT", fields: ["serial"] })).ok).toBe(true);
  });

  it("Other goes to whichever team Finance picks, with a note", async () => {
    seedAsset("0305");
    expect((await returnAsset({ id: "0305", team: "PURCHASING", fields: ["other"], note: "Wrong department on the slip" })).ok).toBe(true);
    expect(asset("0305").financeReturnedTo).toBe("PURCHASING");
  });
});

describe("resubmitAssetToFinance", () => {
  it("only the team it went back to (an admin too)", async () => {
    seedAsset("0310", { financeReturnedAt: CHECKED, financeReturnedTo: "PURCHASING", financeReturnFields: ["other"] });
    h.user = IVAN;
    await expectRefused(() => resubmitAssetToFinance({ id: "0310" }), { kind: "forbidden" });
    h.user = PAT;
    expect((await resubmitAssetToFinance({ id: "0310", reply: "Fixed the slip" })).ok).toBe(true);
    expect(asset("0310")).toMatchObject({ financeReturnedAt: null, financeReturnedTo: null, financeResubmitNote: "Fixed the slip" });

    seedAsset("0311", { financeReturnedAt: CHECKED, financeReturnedTo: "IT" });
    h.user = ADA;
    expect((await resubmitAssetToFinance({ id: "0311" })).ok).toBe(true);
  });

  it("a return from before teams were recorded belongs to the class's team", async () => {
    seedAsset("0312", { financeReturnedAt: CHECKED, financeReturnedTo: null });
    h.user = PAT;
    await expectRefused(() => resubmitAssetToFinance({ id: "0312" }), { kind: "forbidden" });
    h.user = IVAN;
    expect((await resubmitAssetToFinance({ id: "0312" })).ok).toBe(true);
  });
});

describe("updateAsset", () => {
  it("Finance updateAsset on serial refused with 'Send it back to IT'", async () => {
    seedAsset("0320");
    await expectRefused(() => updateAsset({ id: "0320", serial: "SN-NEW" }), { kind: "conflict", message: "Send it back to IT" });
  });

  it("Finance fixes money on an asset with no PO, with a reason, and only money", async () => {
    seedAsset("0321");
    await expectRefused(() => updateAsset({ id: "0321", invoiceRef: "SI-0021" }), { kind: "validation", fieldErrors: { reason: "Give a reason of at least 5 characters" } });
    await expectRefused(() => updateAsset({ id: "0321", notes: "hello", reason: "typo on receipt" }), { kind: "conflict", message: "Finance changes money details only — send the rest back." });
    const r = await updateAsset({ id: "0321", invoiceRef: "SI-0021", reason: "typo on receipt" });
    expect(r).toEqual({ ok: true, data: { id: "0321" } });
    expect(asset("0321")).toMatchObject({ invoiceRef: "SI-0021", model: "Latitude 5440", serial: "SN0321" });
    const audit = t("auditEntry").find((a) => a.action === "update")!;
    expect(audit).toMatchObject({ reason: "typo on receipt", source: "web", diff: { invoiceRef: { from: "SI-0012", to: "SI-0021" } } });
    // the team that registered it hears that Finance changed its numbers
    expect(t("notification")).toEqual([expect.objectContaining({ team: "IT", kind: "CHANGED", href: "/inventory/0321" })]);
  });

  it("money on an asset from a PO is fixed on the PO", async () => {
    seedAsset("0322", { purchaseRecordId: "rec-po", purchaseOrderId: "po1" });
    await expectRefused(() => updateAsset({ id: "0322", cost: 49000, reason: "price on the SI" }), { kind: "conflict", message: "Fix it on PO-0214" });
  });

  it("IT's own fields stay IT's; money with Finance is Finance's", async () => {
    seedAsset("0323");
    h.user = IVAN;
    expect((await updateAsset({ id: "0323", serial: "SN-FIXED" })).ok).toBe(true);
    await expectRefused(() => updateAsset({ id: "0323", cost: 1, reason: "wrong price" }), { kind: "conflict", message: "It's with Finance; ask Finance to fix or send it back" });
  });

  it("IT fixing money Finance returned to it gives a reason", async () => {
    seedAsset("0324", { financeReturnedAt: CHECKED, financeReturnedTo: "IT", financeReturnFields: ["cost"] });
    h.user = IVAN;
    await expectRefused(() => updateAsset({ id: "0324", cost: 49000 }), { kind: "validation" });
    expect((await updateAsset({ id: "0324", cost: 49000, reason: "price on the SI" })).ok).toBe(true);
    expect(asset("0324").cost).toBe(49000);
  });
});

describe("confirmAssetDetails on an asset from a PO", () => {
  const fromPo = { purchaseRecordId: "rec-po", purchaseOrderId: "po1", purchaseOrderLineId: "ln1" };

  it("refused while the PO is with Purchasing for corrections, or has no SI number", async () => {
    seedAsset("0330", fromPo);
    t("purchaseOrder")[0].state = "SENT_BACK";
    await expectRefused(() => confirmAssetDetails({ id: "0330" }), { kind: "conflict", message: "PO-0214 is with Purchasing for corrections." });
    Object.assign(t("purchaseOrder")[0], { state: "READY", invoiceRef: null });
    await expectRefused(() => confirmAssetDetails({ id: "0330" }), { kind: "conflict", message: "No SI number yet. Add it before approving." });
  });

  it("approving the PO's last asset fires its approval webhooks once", async () => {
    seedAsset("0331", fromPo);
    expect((await confirmAssetDetails({ id: "0331" })).ok).toBe(true);
    expect(h.webhooks).toEqual(["purchase_order.approved", "purchase_request.completed"]);
    expect(t("purchaseOrder")[0].completedAt).toBeInstanceOf(Date);
    // 2026-10-23: and Purchasing hears it, on the PO
    expect(t("notification")).toEqual([expect.objectContaining({
      team: "PURCHASING", kind: "CHANGED", title: "PO-0214: Finance approved all its assets", href: "/purchases/po1",
      actorId: ANA.id, entityType: "purchase-order", entityId: "po1",
    })]);
  });
});

describe("confirmAssetDetails tells the team that corrected it (2026-10-23)", () => {
  const T0 = new Date("2026-10-23T02:00:00Z");
  let min = 0;
  const tick = () => vi.setSystemTime(new Date(T0.getTime() + ++min * 60_000));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    min = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const changed = () => t("notification").filter((n) => n.kind === "CHANGED");

  it("sent back to IT, corrected by IT, approved: IT hears '{tag}: Finance accepted the correction', linked to it", async () => {
    seedAsset("0340");
    expect((await returnAsset({ id: "0340", team: "IT", fields: ["serial"] })).ok).toBe(true);
    tick();
    h.user = IVAN;
    expect((await resubmitAssetToFinance({ id: "0340" })).ok).toBe(true); // no reply: still a correction
    tick();
    h.user = ANA;
    expect((await confirmAssetDetails({ id: "0340" })).ok).toBe(true);
    expect(changed()).toEqual([expect.objectContaining({
      team: "IT", title: "BR-LT-0340: Finance accepted the correction", href: "/inventory/0340",
      actorId: ANA.id, entityType: "asset", entityId: "0340",
    })]);
  });

  it("Purchasing's correction rings Purchasing; an admin's rings the team it had gone back to", async () => {
    seedAsset("0341");
    seedAsset("0342");
    await returnAsset({ id: "0341", team: "PURCHASING", fields: ["other"], note: "slip" });
    await returnAsset({ id: "0342", team: "PURCHASING", fields: ["other"], note: "slip" });
    tick();
    h.user = PAT;
    await resubmitAssetToFinance({ id: "0341" });
    h.user = ADA;
    await resubmitAssetToFinance({ id: "0342" });
    tick();
    h.user = ANA;
    await confirmAssetDetails({ id: "0341" });
    await confirmAssetDetails({ id: "0342" });
    expect(changed().map((n) => [n.team, n.title])).toEqual([
      ["PURCHASING", "BR-LT-0341: Finance accepted the correction"],
      ["PURCHASING", "BR-LT-0342: Finance accepted the correction"],
    ]);
  });

  it("an asset that was never sent back rings nobody; a refused approval writes nothing", async () => {
    seedAsset("0343");
    expect((await confirmAssetDetails({ id: "0343" })).ok).toBe(true);
    expect(t("notification")).toEqual([]);

    seedAsset("0344", { cost: null });
    await returnAsset({ id: "0344", team: "IT", fields: ["serial"] });
    tick();
    h.user = IVAN;
    await resubmitAssetToFinance({ id: "0344" });
    tick();
    h.user = ANA;
    const before = t("notification").length;
    await expectRefused(() => confirmAssetDetails({ id: "0344" }), { kind: "conflict" }); // no cost: approve refused
    expect(t("notification")).toHaveLength(before);
  });

  it("the actor's own team is never rung by a CHANGED (notify's rule holds)", async () => {
    // an IT person can't approve, so the rule is notify's own: Purchasing closing a PO short is no news to Purchasing
    const { notify } = await import("@/server/notifications/notify");
    const { prisma } = await import("@/server/db/client");
    await notify(prisma as never, {
      team: "PURCHASING", kind: "CHANGED", title: "x", href: "/x", actorId: PAT.id, entityType: "asset", entityId: "a",
    });
    await notify(prisma as never, {
      team: "IT", kind: "CHANGED", title: "y", href: "/y", actorId: PAT.id, actorRole: "purchasing_staff", entityType: "asset", entityId: "a",
    });
    expect(t("notification").map((n) => n.title)).toEqual(["y"]);
  });
});
