import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { reasonError } from "@/lib/intake-rules";

/*
 * Purchase orders, Task 3 (spec §2–§7; Review Focus 2 and 3): save, send back, fix, close short and cancel on a PO,
 * against an in-memory Prisma. The fake has no rollback, so every refusal is also checked against "nothing was
 * written" — the actions must decide before they write.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  seq: 214,
  /** Row locks and reads, in order. */
  ops: [] as string[],
  revalidated: [] as string[],
  webhooks: [] as Array<{ event: string; data: Record<string, unknown> }>,
  /** Stored files (the storage driver, faked), and every path deleted from it. */
  objects: {} as Record<string, string>,
  deleted: [] as string[],
  /** The next requestDocument.create throws this (a failure inside the save's transaction). */
  failDoc: null as Error | null,
  /** Skip the PO-number pre-check this many times: another save took the number in between (a race). */
  racePoCheck: 0,
  /** The next revalidatePath throws this (a failure after the save's transaction committed). */
  failRevalidate: null as Error | null,
  /** Runs once after a transaction rolls back: another session's write that the rollback must not undo. */
  afterRollback: null as (() => void) | null,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    if (h.failRevalidate) {
      const err = h.failRevalidate;
      h.failRevalidate = null;
      throw err;
    }
    h.revalidated.push(p);
  },
}));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/storage", () => ({
  writeObject: async (relPath: string, bytes: Buffer) => { h.objects[relPath] = bytes.toString(); },
  deleteObject: async (relPath: string) => { h.deleted.push(relPath); delete h.objects[relPath]; },
}));
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
      h.ops.push(`read:${name}`);
      const r = rows(name).find((x) => matches(x, where));
      return r ? structuredClone(r) : null;
    },
    findFirst: async ({ where }: { where?: R } = {}) => {
      const r = rows(name).find((x) => matches(x, where));
      return r ? structuredClone(r) : null;
    },
    findMany: async ({ where }: { where?: R } = {}) => {
      h.ops.push(`read:${name}`);
      return structuredClone(rows(name).filter((x) => matches(x, where)));
    },
    count: async ({ where }: { where?: R } = {}) => {
      h.ops.push(`read:${name}`);
      return rows(name).filter((x) => matches(x, where)).length;
    },
    create: async ({ data }: { data: R }) => {
      if (name === "requestDocument" && h.failDoc) {
        const err = h.failDoc;
        h.failDoc = null;
        throw err;
      }
      const { lines, ...rest } = data as R & { lines?: { create: R[] } };
      const row: R = { id: `${name}-${++n}`, createdAt: new Date(), ...rest };
      rows(name).push(row);
      for (const l of lines?.create ?? []) rows("purchaseOrderLine").push({ id: `line-${++n}`, orderId: row.id, closedShort: 0, ...l });
      return structuredClone(row);
    },
    createMany: async ({ data }: { data: R[] }) => {
      for (const d of data) rows(name).push({ id: `${name}-${++n}`, closedShort: 0, ...d });
      return { count: data.length };
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
    deleteMany: async ({ where }: { where: R }) => {
      const before = rows(name).length;
      h.tables[name] = rows(name).filter((x) => !matches(x, where));
      return { count: before - h.tables[name].length };
    },
  });
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("$");
    if (sql.includes("nextval")) return [{ nextval: BigInt(h.seq++) }];
    if (sql.includes('"poNumber"')) {
      // lower(btrim("poNumber")) = lower(btrim($1)) among POs that aren't CANCELLED, other than $2
      if (h.racePoCheck > 0) { h.racePoCheck--; return []; }
      const [num, except] = values as [string, string];
      const key = (v: unknown) => String(v).trim().toLowerCase();
      return rows("purchaseOrder")
        .filter((p) => p.poNumber != null && p.state !== "CANCELLED" && p.id !== except && key(p.poNumber) === key(num))
        .slice(0, 1).map((p) => ({ id: p.id, refNo: p.refNo }));
    }
    h.ops.push(`lock:${values.join(",")}`);
    return [];
  };
  const client = Object.fromEntries(
    ["purchaseOrder", "purchaseOrderLine", "asset", "purchaseRecord", "noteEntry", "auditEntry", "notification",
      "user", "vendor", "department", "assetCategory", "requestDocument"].map((t) => [t, table(t)]),
  ) as Record<string, ReturnType<typeof table>>;
  const full = { ...client, $queryRaw };
  // A throw rolls the transaction back, as Postgres would.
  const $transaction = async (fn: (tx: typeof full) => Promise<unknown>) => {
    const before = structuredClone(h.tables);
    try {
      return await fn(full);
    } catch (err) {
      h.tables = before;
      const then = h.afterRollback;
      h.afterRollback = null;
      then?.();
      throw err;
    }
  };
  return { prisma: { ...full, $transaction } };
});

import {
  addComment, cancelPurchaseOrder, closeLineShort, fixPurchaseOrder, savePurchaseOrder, sendBackPurchaseOrder, undoPoSendBack,
} from "./po-actions";

const PAT = { id: "u-pat", name: "Pat Lim", role: "purchasing_staff" };
const IVAN = { id: "u-ivan", name: "Ivan Tan", role: "it_staff" };
const ANA = { id: "u-ana", name: "Ana Cruz", role: "finance_staff" };
const ADA = { id: "u-ada", name: "Ada Admin", role: "admin" };

const BOUGHT = new Date("2026-10-15T00:00:00Z");

const t = (name: string) => h.tables[name];
const po = () => t("purchaseOrder").find((p) => p.id === "po1")!;
const asset = (id: string) => t("asset").find((a) => a.id === id)!;
const audits = (action: string) => t("auditEntry").filter((a) => a.action === action);

function seedPo(extra: Row = {}) {
  t("purchaseOrder").push({
    id: "po1", refNo: "PO-0214", state: "WITH_IT", requestedById: PAT.id, departmentId: null,
    vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: BOUGHT, fees: null,
    sentBackAt: null, sentBackById: null, sentBackBy: null, sentBackFields: [], sentBackNote: null,
    cancelledAt: null, cancelReason: null,
    ...extra,
  });
}
function seedLine(id: string, extra: Row = {}) {
  t("purchaseOrderLine").push({
    id, orderId: "po1", description: "laptops", specs: null, categoryId: "cat-lt", qty: 5, unitPrice: 50000,
    closedShort: 0, closedShortReason: null, ...extra,
  });
}
function seedAsset(id: string, extra: Row = {}) {
  t("asset").push({
    id, tag: `BR-LT-${id}`, purchaseOrderId: "po1", purchaseOrderLineId: "ln1", cost: 50000,
    vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: BOUGHT,
    financeConfirmedAt: null, financeConfirmedById: null,
    financeReturnedAt: null, financeReturnedById: null, financeReturnedTo: null, financeReturnFields: [],
    financeReturnReason: null, financeResubmitNote: null,
    ...extra,
  });
}

/** A refusal writes nothing at all. */
async function expectNothingWritten<T extends { ok: boolean }>(run: () => Promise<T>): Promise<T> {
  const before = structuredClone(h.tables);
  const r = await run();
  expect(r.ok).toBe(false);
  expect(h.tables).toEqual(before);
  return r;
}

const line = (extra: Row = {}) => ({ description: "laptops", categoryId: "cat-lt", qty: 5, unitPrice: 50000, ...extra });
const order = (extra: Row = {}) => ({
  vendorId: "v1", invoiceRef: "SI-0012", purchasedAt: "2026-10-15", lines: [line()], ...extra,
});

/** The owner's sales invoice (Review Focus 3): one laptop at ₱9,100.00, VAT inclusive. */
const OWNER_TOTALS = {
  totalSales: "9,100.00", lessVat: "975.00", netOfVat: "8,125.00", discount: "", amountDue: "8,125.00", addVat: "975.00",
  totalAmountDue: "9,100.00",
};
/** A save from the new form: every required field filled in. */
const v2Order = (extra: Row = {}) => order({
  poNumber: "2025-0418", paidBy: "CREDIT_CARD", totals: OWNER_TOTALS,
  lines: [line({ description: "Laptop", qty: 1, unit: "pc", unitPrice: 9100 })], ...extra,
});
const pdf = (name = "si.pdf") => new File(["%PDF-1.4 test"], name, { type: "application/pdf" });
/** The new form's multipart save: the JSON payload plus its document slots. */
function form(payload: unknown, files: Record<string, File | string> = { "doc:invoice": pdf() }) {
  const fd = new FormData();
  fd.set("payload", JSON.stringify(payload));
  for (const [k, v] of Object.entries(files)) fd.set(k, v);
  return fd;
}
const stored = () => Object.keys(h.objects);

beforeEach(() => {
  h.user = PAT;
  h.seq = 214;
  h.ops = [];
  h.revalidated = [];
  h.webhooks = [];
  h.objects = {};
  h.deleted = [];
  h.failDoc = null;
  h.racePoCheck = 0;
  h.failRevalidate = null;
  h.afterRollback = null;
  h.tables = {
    user: [PAT, IVAN, ANA, ADA].map((u) => ({ ...u })),
    vendor: [{ id: "v1", name: "Octagon", archivedAt: null }, { id: "v2", name: "PC Express", archivedAt: null }],
    department: [{ id: "d1", name: "Operations", archivedAt: null }],
    assetCategory: [{ id: "cat-lt", name: "Laptops", cls: "IT" }, { id: "cat-ch", name: "Chairs", cls: "PURCHASING" }],
    purchaseOrder: [], purchaseOrderLine: [], asset: [], purchaseRecord: [], noteEntry: [], auditEntry: [], notification: [],
    requestDocument: [],
  };
});

describe("savePurchaseOrder", () => {
  it("save routes by class: non-IT is READY with no bell, mixed is WITH_IT with one IT TO_CHECK", async () => {
    const chairs = await savePurchaseOrder(form(v2Order({
      poNumber: "2025-0417", lines: [line({ description: "office chairs", categoryId: "cat-ch", qty: 4 })],
    })));
    expect(chairs).toMatchObject({ ok: true, data: { refNo: "PO-0214", state: "READY" } });
    expect(t("notification")).toHaveLength(0);

    const mixed = await savePurchaseOrder(form(v2Order({
      lines: [line(), line({ description: "office chairs", categoryId: "cat-ch", qty: 4, unitPrice: 4500 })],
    })));
    expect(mixed).toMatchObject({ ok: true, data: { refNo: "PO-0215", state: "WITH_IT" } });
    expect(t("notification")).toHaveLength(1);
    expect(t("notification")[0]).toMatchObject({
      team: "IT", kind: "TO_CHECK", title: "PO-0215 · 5 laptops from Purchasing to check", actorId: PAT.id,
      entityType: "purchase-order",
    });
    const id = mixed.ok ? mixed.data.id : "";
    expect(t("notification")[0].href).toBe(`/purchases/${id}`);
    expect(t("noteEntry").filter((n) => n.orderId === id).map((n) => n.kind)).toEqual(["PO_SAVED"]);
    expect(audits("po.save").map((a) => a.entityId)).toContain(id);
    expect(audits("po.save").every((a) => a.source === "web")).toBe(true);
  });

  it("save on SENT_BACK needs a reply; Finance's send-back resubmits to READY and un-returns the assets", async () => {
    const returned = new Date("2026-10-20T00:00:00Z");
    seedPo({ state: "SENT_BACK", sentBackBy: "FINANCE", sentBackById: ANA.id, sentBackAt: returned, sentBackFields: ["cost"] });
    seedLine("ln1", { qty: 2, unitPrice: 500000 });
    for (const id of ["a1", "a2"]) {
      seedAsset(id, {
        cost: 500000, financeReturnedAt: returned, financeReturnedById: ANA.id, financeReturnedTo: "PURCHASING",
        financeReturnFields: ["cost"], financeReturnReason: "that's per box",
      });
    }
    const fixed = order({ id: "po1", lines: [line({ id: "ln1", qty: 2, unitPrice: 50000 })] });

    const refused = await expectNothingWritten(() => savePurchaseOrder(fixed));
    expect(refused).toMatchObject({ kind: "validation", fieldErrors: { reply: reasonError(undefined) } });

    const r = await savePurchaseOrder({ ...fixed, reply: "price per unit now" });
    expect(r).toMatchObject({ ok: true, data: { refNo: "PO-0214", state: "READY" } });
    expect(po()).toMatchObject({ state: "READY", sentBackBy: null, sentBackAt: null, sentBackFields: [], sentBackNote: null });
    for (const id of ["a1", "a2"]) {
      expect(asset(id)).toMatchObject({
        financeReturnedAt: null, financeReturnedTo: null, financeReturnFields: [], cost: 50000,
        financeResubmitNote: "price per unit now",
      });
    }
    expect(t("notification")).toEqual([expect.objectContaining({ team: "FINANCE", kind: "TO_CHECK", body: "price per unit now" })]);
    expect(audits("po.resubmit")).toHaveLength(1);
    expect(audits("po.resubmit")[0].reason).toBe("price per unit now");
    expect(t("noteEntry").map((n) => n.kind)).toEqual(["PO_RESUBMITTED"]);
  });

  it("an IT send-back resubmits to WITH_IT and rings IT", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "IT", sentBackById: IVAN.id, sentBackFields: ["invoiceRef"] });
    seedLine("ln1");
    const r = await savePurchaseOrder(order({ id: "po1", invoiceRef: "SI-0021", lines: [line({ id: "ln1" })], reply: "SI number corrected" }));
    expect(r).toMatchObject({ ok: true, data: { state: "WITH_IT" } });
    expect(po().invoiceRef).toBe("SI-0021");
    expect(t("notification")).toEqual([expect.objectContaining({ team: "IT", kind: "TO_CHECK" })]);
  });

  it("refuses to edit once the PO is with Finance", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1");
    seedAsset("a1");
    const r = await expectNothingWritten(() => savePurchaseOrder(order({ id: "po1", lines: [line({ id: "ln1" })] })));
    expect(r).toMatchObject({ kind: "conflict", message: "It's with Finance; ask Finance to fix or send it back" });
  });

  it("a line with registered assets can't be removed", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "FINANCE" });
    seedLine("ln1");
    seedLine("ln2", { description: "chairs", categoryId: "cat-ch" });
    seedAsset("a1");
    const r = await expectNothingWritten(() =>
      savePurchaseOrder(order({ id: "po1", lines: [line({ id: "ln2", description: "chairs", categoryId: "cat-ch" })], reply: "dropped the laptops" })));
    expect(r).toMatchObject({ kind: "conflict" });
  });

  it("IT and Finance can't save a PO", async () => {
    h.user = IVAN;
    expect(await savePurchaseOrder(order())).toMatchObject({ ok: false, kind: "forbidden" });
  });
});

describe("sendBackPurchaseOrder", () => {
  it("IT send-back: WITH_IT becomes SENT_BACK by IT, and Purchasing's bell rings once", async () => {
    seedPo();
    seedLine("ln1");
    h.user = IVAN;
    const r = await sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"], note: "SI number doesn't match the invoice" });
    expect(r).toEqual({ ok: true, data: { refNo: "PO-0214" } });
    expect(po()).toMatchObject({
      state: "SENT_BACK", sentBackBy: "IT", sentBackById: IVAN.id, sentBackFields: ["invoiceRef"],
      sentBackNote: "SI number doesn't match the invoice",
    });
    expect(t("notification")).toHaveLength(1);
    expect(t("notification")[0]).toMatchObject({ team: "PURCHASING", kind: "SENT_BACK", href: "/purchases/po1" });
    expect(audits("po.send-back")).toHaveLength(1);
    expect(t("noteEntry").map((n) => n.kind)).toEqual(["PO_SENT_BACK"]);
    expect(h.ops[0]).toBe("lock:po1");
  });

  it("IT can't send back once the PO has left IT", async () => {
    seedPo({ state: "READY" });
    h.user = IVAN;
    await expectNothingWritten(() => sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"] }));
  });

  it("Finance send-back refused once anything is approved (Review Focus 3)", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 3 });
    seedAsset("a1", { financeConfirmedAt: new Date("2026-10-20T00:00:00Z"), financeConfirmedById: ANA.id });
    seedAsset("a2");
    seedAsset("a3");
    h.user = ANA;
    const r = await expectNothingWritten(() => sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"], note: "wrong SI number" }));
    expect(r).toMatchObject({ kind: "conflict", message: "Some assets from PO-0214 are approved. Fix it yourself with a reason." });
  });

  it("Finance send-back returns every asset to Purchasing", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 2 });
    seedAsset("a1");
    seedAsset("a2");
    h.user = ANA;
    const r = await sendBackPurchaseOrder({ id: "po1", fields: ["cost", "doc:invoice"], note: "price is per box" });
    expect(r.ok).toBe(true);
    expect(po()).toMatchObject({ state: "SENT_BACK", sentBackBy: "FINANCE" });
    for (const id of ["a1", "a2"]) {
      expect(asset(id)).toMatchObject({
        financeReturnedTo: "PURCHASING", financeReturnedById: ANA.id, financeReturnFields: ["cost", "doc:invoice"],
        financeReturnReason: "price is per box",
      });
      expect(asset(id).financeReturnedAt).toBeInstanceOf(Date);
    }
    expect(t("notification")).toEqual([expect.objectContaining({ team: "PURCHASING", kind: "SENT_BACK" })]);
    // Task 6: each returned asset's own history shows the return, to Purchasing, as the PO's
    const returns = audits("finance.return");
    expect(returns.map((a) => a.entityId)).toEqual(["a1", "a2"]);
    for (const a of returns) {
      expect(a).toMatchObject({ entityType: "asset", actorId: ANA.id, source: "web", reason: "price is per box" });
      expect(a.diff).toMatchObject({
        financeReturn: { from: null, to: { fields: ["Cost", "Sales invoice"], note: "price is per box", team: "PURCHASING" } },
        po: { from: null, to: "PO-0214" },
      });
    }
  });

  it("Finance can't send back a PO with nothing registered", async () => {
    seedPo({ state: "READY" });
    h.user = ANA;
    await expectNothingWritten(() => sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"] }));
  });

  it("an admin sends back as the stage's owner", async () => {
    seedPo({ state: "WITH_IT" });
    h.user = ADA;
    expect((await sendBackPurchaseOrder({ id: "po1", fields: ["fees"] })).ok).toBe(true);
    expect(po().sentBackBy).toBe("IT");
  });

  it("'other' needs a note, and a note needs 5 characters", async () => {
    seedPo();
    h.user = IVAN;
    const noNote = await expectNothingWritten(() => sendBackPurchaseOrder({ id: "po1", fields: ["other"] }));
    expect(noNote).toMatchObject({ kind: "validation" });
    const short = await expectNothingWritten(() => sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"], note: "bad" }));
    expect(short).toMatchObject({ kind: "validation", fieldErrors: { note: reasonError("bad") } });
  });
});

describe("fixPurchaseOrder", () => {
  function partlyApproved() {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 3 });
    seedAsset("a1", { financeConfirmedAt: new Date("2026-10-20T00:00:00Z"), financeConfirmedById: ANA.id });
    seedAsset("a2");
    seedAsset("a3");
  }

  it("fix after partial approval (Review Focus 2): every asset gets the new SI number, none is un-approved", async () => {
    partlyApproved();
    const approvedAt = asset("a1").financeConfirmedAt;
    h.user = ANA;
    const r = await fixPurchaseOrder({ id: "po1", patch: { invoiceRef: "SI-0021" }, reason: "typo on receipt" });
    expect(r).toEqual({ ok: true, data: { refNo: "PO-0214", changed: ["invoiceRef"] } });
    expect(po().invoiceRef).toBe("SI-0021");
    for (const id of ["a1", "a2", "a3"]) expect(asset(id).invoiceRef).toBe("SI-0021");
    expect(asset("a1").financeConfirmedAt).toEqual(approvedAt);
    expect(asset("a1").financeConfirmedById).toBe(ANA.id);

    const fixed = audits("asset.money.fixed");
    expect(fixed).toHaveLength(3);
    expect(fixed.map((a) => a.entityId).sort()).toEqual(["a1", "a2", "a3"]);
    for (const a of fixed) {
      expect(a).toMatchObject({ entityType: "asset", reason: "typo on receipt", source: "web", diff: { invoiceRef: { from: "SI-0012", to: "SI-0021" } } });
    }
    expect(audits("po.fix")).toHaveLength(1);
    expect(t("noteEntry").map((n) => n.kind)).toEqual(["PO_FIXED"]);
    expect(t("notification")).toHaveLength(1);
    expect(t("notification")[0]).toMatchObject({
      team: "PURCHASING", kind: "CHANGED", title: "Finance changed the SI number on PO-0214", body: "typo on receipt",
    });
    // the PO row is locked before anything about it is read
    expect(h.ops.indexOf("lock:po1")).toBeGreaterThanOrEqual(0);
    expect(h.ops.indexOf("lock:po1")).toBeLessThan(h.ops.indexOf("read:purchaseOrder"));
    expect(h.ops.indexOf("lock:po1")).toBeLessThan(h.ops.indexOf("read:asset"));
  });

  it("a fix's notification names the vendor and the invoice date in the words the send-back checklist uses (Task 8)", async () => {
    partlyApproved();
    h.user = ANA;
    const r = await fixPurchaseOrder({ id: "po1", patch: { vendorId: "v2", purchasedAt: "2026-10-01" }, reason: "wrong invoice" });
    expect(r.ok).toBe(true);
    expect(t("notification")[0]).toMatchObject({ title: "Finance changed the vendor and invoice date on PO-0214" });
  });

  it("a line price fix flows to that line's assets as their cost", async () => {
    partlyApproved();
    h.user = ANA;
    const r = await fixPurchaseOrder({ id: "po1", patch: { lines: [{ id: "ln1", unitPrice: 48000 }] }, reason: "discount on the invoice" });
    expect(r).toMatchObject({ ok: true, data: { changed: ["cost"] } });
    expect(t("purchaseOrderLine")[0].unitPrice).toBe(48000);
    for (const id of ["a1", "a2", "a3"]) expect(asset(id).cost).toBe(48000);
  });

  it("fix without reason refused", async () => {
    partlyApproved();
    h.user = ANA;
    const r = await expectNothingWritten(() => fixPurchaseOrder({ id: "po1", patch: { invoiceRef: "SI-0021" } }));
    expect(r).toMatchObject({ kind: "validation", fieldErrors: { reason: reasonError(undefined) } });
  });

  it("Purchasing fix while with Finance refused", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 3 });
    seedAsset("a1");
    const r = await expectNothingWritten(() => fixPurchaseOrder({ id: "po1", patch: { invoiceRef: "SI-0021" }, reason: "typo on receipt" }));
    expect(r).toMatchObject({ kind: "conflict", message: "It's with Finance; ask Finance to fix or send it back" });
  });

  it("IT cannot fix device fields via fixPurchaseOrder: the patch takes money fields only", async () => {
    seedPo();
    h.user = IVAN;
    const r = await expectNothingWritten(() => fixPurchaseOrder({ id: "po1", patch: { serial: "PF3X9K2" }, reason: "serial on the box" }));
    expect(r).toMatchObject({ kind: "validation" });
    expect(Object.keys(r.ok ? {} : r.fieldErrors ?? {})).toContain("patch");
  });

  it("IT fixes Purchasing's money with a reason while the PO is with IT", async () => {
    seedPo();
    h.user = IVAN;
    const r = await fixPurchaseOrder({ id: "po1", patch: { receiptRef: "OR-77" }, reason: "OR was on the box" });
    expect(r.ok).toBe(true);
    expect(t("notification")[0]).toMatchObject({ team: "PURCHASING", kind: "CHANGED", title: "IT changed the OR number on PO-0214" });
  });

  it("Purchasing's own fix needs no reason and rings no bell", async () => {
    seedPo({ state: "READY" });
    const r = await fixPurchaseOrder({ id: "po1", patch: { invoiceRef: "SI-0099" } });
    expect(r.ok).toBe(true);
    expect(t("notification")).toHaveLength(0);
  });

  it("an admin's fix rings Purchasing", async () => {
    partlyApproved();
    h.user = ADA;
    expect((await fixPurchaseOrder({ id: "po1", patch: { invoiceRef: "SI-0021" }, reason: "typo on receipt" })).ok).toBe(true);
    expect(t("notification")).toEqual([expect.objectContaining({ team: "PURCHASING", kind: "CHANGED" })]);
  });
});

describe("fix round 1", () => {
  const RETURNED = new Date("2026-10-19T00:00:00Z");

  it("Finance's PO send-back keeps an asset's existing return to IT, and Purchasing's resubmit leaves it with IT", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 2 });
    seedAsset("a1");
    seedAsset("a2", {
      financeReturnedAt: RETURNED, financeReturnedById: ANA.id, financeReturnedTo: "IT",
      financeReturnFields: ["serial"], financeReturnReason: "serial doesn't match the photo",
    });
    const itReturn = {
      financeReturnedAt: RETURNED, financeReturnedById: ANA.id, financeReturnedTo: "IT",
      financeReturnFields: ["serial"], financeReturnReason: "serial doesn't match the photo",
    };
    h.user = ANA;
    expect((await sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"], note: "wrong SI number" })).ok).toBe(true);
    expect(asset("a1")).toMatchObject({ financeReturnedTo: "PURCHASING", financeReturnFields: ["invoiceRef"] });
    expect(asset("a2")).toMatchObject(itReturn);
    expect(audits("finance.return").map((a) => a.entityId)).toEqual(["a1"]);

    h.user = PAT;
    const r = await savePurchaseOrder(order({ id: "po1", invoiceRef: "SI-0021", lines: [line({ id: "ln1", qty: 2 })], reply: "SI number corrected" }));
    expect(r).toMatchObject({ ok: true, data: { state: "READY" } });
    expect(asset("a1")).toMatchObject({ financeReturnedAt: null, financeReturnedTo: null, invoiceRef: "SI-0021" });
    expect(asset("a2")).toMatchObject({ ...itReturn, invoiceRef: "SI-0021" });
  });

  it("IT send-back refused once any asset from the PO is registered", async () => {
    seedPo({ state: "WITH_IT" });
    seedLine("ln1", { description: "chairs", categoryId: "cat-ch" });
    seedAsset("a1");
    h.user = IVAN;
    const r = await expectNothingWritten(() => sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"], note: "SI number is wrong" }));
    expect(r).toMatchObject({ kind: "conflict" });
    expect(r.ok ? "" : r.message).toMatch(/registered/);
  });

  it("a resubmit after Finance's send-back updates the PO's PurchaseRecord too", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "FINANCE", sentBackById: ANA.id, sentBackAt: RETURNED });
    seedLine("ln1", { qty: 2, unitPrice: 50000 });
    t("purchaseRecord").push({
      id: "rec1", purchaseOrderId: "po1", vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: BOUGHT, unitCost: 50000,
    });
    for (const id of ["a1", "a2"]) {
      seedAsset(id, { purchaseRecordId: "rec1", financeReturnedAt: RETURNED, financeReturnedById: ANA.id, financeReturnedTo: "PURCHASING" });
    }
    const r = await savePurchaseOrder(order({
      id: "po1", invoiceRef: "SI-0021", lines: [line({ id: "ln1", qty: 2, unitPrice: 48000 })], reply: "SI number and price corrected",
    }));
    expect(r.ok).toBe(true);
    expect(t("purchaseRecord")[0]).toMatchObject({ invoiceRef: "SI-0021", unitCost: 48000, vendorId: "v1" });
    for (const id of ["a1", "a2"]) expect(asset(id)).toMatchObject({ invoiceRef: "SI-0021", cost: 48000 });
  });

  it("the fix updates a record's unitCost only when its assets all come from one line", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 1 });
    seedLine("ln2", { qty: 1, description: "docks", unitPrice: 9000 });
    t("purchaseRecord").push(
      { id: "rec1", purchaseOrderId: "po1", vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: BOUGHT, unitCost: 50000 },
      { id: "rec2", purchaseOrderId: "po1", vendorId: "v1", invoiceRef: "SI-0012", receiptRef: null, purchasedAt: BOUGHT, unitCost: null },
    );
    seedAsset("a1", { purchaseRecordId: "rec1" });
    seedAsset("a2", { purchaseRecordId: "rec2" });
    seedAsset("a3", { purchaseRecordId: "rec2", purchaseOrderLineId: "ln2", cost: 9000 });
    h.user = ANA;
    const r = await fixPurchaseOrder({ id: "po1", patch: { lines: [{ id: "ln1", unitPrice: 48000 }] }, reason: "discount on the invoice" });
    expect(r.ok).toBe(true);
    expect(t("purchaseRecord").find((x) => x.id === "rec1")!.unitCost).toBe(48000);
    expect(t("purchaseRecord").find((x) => x.id === "rec2")!.unitCost).toBeNull();
  });

  it("a line price fix reopens only the approved asset that had no cost (spec §5)", async () => {
    const APPROVED = new Date("2026-10-20T00:00:00Z");
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 2, unitPrice: null });
    seedAsset("a1", { cost: null, financeConfirmedAt: APPROVED, financeConfirmedById: ANA.id, financeNotCapitalised: true });
    seedAsset("a2", { cost: 50000, financeConfirmedAt: APPROVED, financeConfirmedById: ANA.id, financeNotCapitalised: false });
    h.user = ANA;
    const r = await fixPurchaseOrder({ id: "po1", patch: { lines: [{ id: "ln1", unitPrice: 48000 }] }, reason: "price from the invoice" });
    expect(r.ok).toBe(true);
    expect(asset("a1")).toMatchObject({ cost: 48000, financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false });
    expect(asset("a2")).toMatchObject({ cost: 48000, financeConfirmedAt: APPROVED, financeConfirmedById: ANA.id });
    expect(audits("asset.money.fixed").map((a) => a.entityId).sort()).toEqual(["a1", "a2"]);
    expect(audits("finance.reopened")).toEqual([
      expect.objectContaining({ entityId: "a1", diff: { cost: { from: null, to: 48000 } } }),
    ]);
  });
});

describe("closeLineShort", () => {
  it("closeLineShort over remaining refused", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 5 });
    for (const id of ["a1", "a2", "a3"]) seedAsset(id);
    const r = await expectNothingWritten(() => closeLineShort({ lineId: "ln1", qty: 3, reason: "supplier cancelled 3 units" }));
    expect(r).toMatchObject({ kind: "conflict" });

    const done = await closeLineShort({ lineId: "ln1", qty: 2, reason: "supplier cancelled 2 units" });
    expect(done.ok).toBe(true);
    expect(t("purchaseOrderLine")[0]).toMatchObject({ closedShort: 2, closedShortReason: "supplier cancelled 2 units" });
    expect(audits("po.line-closed")).toHaveLength(1);
    expect(t("noteEntry").map((n) => n.kind)).toEqual(["PO_LINE_CLOSED"]);
    expect(h.webhooks).toEqual([]); // nothing from it is approved
  });

  it("closing the last units short on an otherwise fully approved PO fires both approval webhooks, once", async () => {
    const APPROVED = new Date("2026-10-20T00:00:00Z");
    seedPo({ state: "READY", completedAt: null });
    seedLine("ln1", { qty: 5 });
    for (const id of ["a1", "a2", "a3"]) seedAsset(id, { financeConfirmedAt: APPROVED, financeConfirmedById: ANA.id });
    expect((await closeLineShort({ lineId: "ln1", qty: 1, reason: "supplier cancelled 1 unit" })).ok).toBe(true);
    expect(h.webhooks).toEqual([]); // one unit still to come
    expect((await closeLineShort({ lineId: "ln1", qty: 1, reason: "supplier cancelled 1 unit" })).ok).toBe(true);
    expect(h.webhooks).toEqual([
      { event: "purchase_order.approved", data: { purchaseOrderId: "po1", refNo: "PO-0214" } },
      { event: "purchase_request.completed", data: { purchaseRequestId: "po1", refNo: "PO-0214" } },
    ]);
    expect(po().completedAt).toBeInstanceOf(Date);
  });
});

describe("final review I2: the PO's state follows the IT work left (poStateFor)", () => {
  const chairsLine = (extra: Row = {}) => line({ description: "office chairs", categoryId: "cat-ch", qty: 4, unitPrice: 4500, ...extra });

  it("closing the last IT units short on a mixed WITH_IT PO moves it to READY, with the state in the audit", async () => {
    seedPo({ state: "WITH_IT" });
    seedLine("ln1", { qty: 2 }); // laptops (IT), nothing registered
    seedLine("ln2", { description: "office chairs", categoryId: "cat-ch", qty: 4 });
    seedAsset("c1", { cls: "PURCHASING", purchaseOrderLineId: "ln2", tag: "BR-CH-1" }); // Purchasing registered a chair
    expect((await closeLineShort({ lineId: "ln1", qty: 1, reason: "supplier cancelled 1 unit" })).ok).toBe(true);
    expect(po().state).toBe("WITH_IT"); // one laptop still for IT
    expect(audits("po.line-closed")[0].diff).not.toHaveProperty("state");

    expect((await closeLineShort({ lineId: "ln1", qty: 1, reason: "supplier cancelled the last one" })).ok).toBe(true);
    expect(po().state).toBe("READY");
    expect(audits("po.line-closed")[1].diff).toMatchObject({ state: { from: "WITH_IT", to: "READY" } });
  });

  it("closing a chair line short leaves a WITH_IT PO with IT", async () => {
    seedPo({ state: "WITH_IT" });
    seedLine("ln1", { qty: 2 });
    seedLine("ln2", { description: "office chairs", categoryId: "cat-ch", qty: 4 });
    expect((await closeLineShort({ lineId: "ln2", qty: 4, reason: "chairs cancelled" })).ok).toBe(true);
    expect(po().state).toBe("WITH_IT");
  });

  it("Finance's resubmit of a mixed PO whose IT lines are unregistered goes back to IT, and IT's bell rings", async () => {
    const returned = new Date("2026-10-20T00:00:00Z");
    seedPo({ state: "SENT_BACK", sentBackBy: "FINANCE", sentBackById: ANA.id, sentBackAt: returned, sentBackFields: ["invoiceRef"] });
    seedLine("ln1", { qty: 2 });
    seedLine("ln2", { description: "office chairs", categoryId: "cat-ch", qty: 4, unitPrice: 4500 });
    seedAsset("c1", {
      cls: "PURCHASING", purchaseOrderLineId: "ln2", tag: "BR-CH-1", cost: 4500,
      financeReturnedAt: returned, financeReturnedById: ANA.id, financeReturnedTo: "PURCHASING", financeReturnFields: ["invoiceRef"],
    });
    const r = await savePurchaseOrder(order({
      id: "po1", invoiceRef: "SI-0099", lines: [line({ id: "ln1", qty: 2 }), chairsLine({ id: "ln2" })], reply: "SI number corrected",
    }));
    expect(r).toMatchObject({ ok: true, data: { state: "WITH_IT" } });
    expect(po().state).toBe("WITH_IT");
    expect(audits("po.resubmit")[0].diff).toMatchObject({ state: { from: "SENT_BACK", to: "WITH_IT" } });
    expect(t("notification")).toEqual([
      expect.objectContaining({ team: "FINANCE", kind: "TO_CHECK" }),
      expect.objectContaining({ team: "IT", kind: "TO_CHECK", title: "PO-0214 · 2 laptops from Purchasing to check" }),
    ]);
  });

  it("Finance's resubmit stays READY once IT has registered one of its units", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "FINANCE", sentBackById: ANA.id, sentBackFields: ["invoiceRef"] });
    seedLine("ln1", { qty: 2 });
    seedAsset("a1", { cls: "IT" }); // 1 of 2 laptops: IT's check is done
    const r = await savePurchaseOrder(order({ id: "po1", invoiceRef: "SI-0099", lines: [line({ id: "ln1", qty: 2 })], reply: "SI number corrected" }));
    expect(r).toMatchObject({ ok: true, data: { state: "READY" } });
    expect(t("notification").map((n) => n.team)).toEqual(["FINANCE"]);
  });

  it("a resubmit to Finance that adds an IT line goes to IT", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "FINANCE", sentBackById: ANA.id, sentBackFields: ["other"] });
    seedLine("ln2", { description: "office chairs", categoryId: "cat-ch", qty: 4, unitPrice: 4500 });
    seedAsset("c1", { cls: "PURCHASING", purchaseOrderLineId: "ln2", tag: "BR-CH-1", cost: 4500 });
    const r = await savePurchaseOrder(order({
      id: "po1", lines: [chairsLine({ id: "ln2" }), line({ description: "docking stations", qty: 3, unitPrice: 9000 })],
      reply: "added the docks we forgot",
    }));
    expect(r).toMatchObject({ ok: true, data: { state: "WITH_IT" } });
    expect(t("notification")).toEqual([
      expect.objectContaining({ team: "FINANCE", kind: "TO_CHECK" }),
      expect.objectContaining({ team: "IT", kind: "TO_CHECK", title: "PO-0214 · 3 docking stations from Purchasing to check" }),
    ]);
  });

  it("an IT send-back corrected by dropping every IT line goes READY; IT hears there is nothing left to check", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "IT", sentBackById: IVAN.id, sentBackFields: ["other"] });
    seedLine("ln1");
    seedLine("ln2", { description: "office chairs", categoryId: "cat-ch", qty: 4, unitPrice: 4500 });
    const r = await savePurchaseOrder(order({ id: "po1", lines: [chairsLine({ id: "ln2" })], reply: "laptops dropped from this order" }));
    expect(r).toMatchObject({ ok: true, data: { state: "READY" } });
    expect(t("notification")).toEqual([
      expect.objectContaining({ team: "IT", kind: "CHANGED", title: "PO-0214 · corrected by Purchasing, nothing left for IT to check" }),
    ]);
  });
});

describe("cancelPurchaseOrder", () => {
  it("cancels when nothing is registered, under the PO's row lock", async () => {
    seedPo();
    const r = await cancelPurchaseOrder({ id: "po1", reason: "supplier out of stock" });
    expect(r).toMatchObject({ ok: true, data: { refNo: "PO-0214" } });
    expect(po()).toMatchObject({ state: "CANCELLED", cancelReason: "supplier out of stock" });
    expect(audits("po.cancel")).toHaveLength(1);
    expect(t("noteEntry").map((n) => n.kind)).toEqual(["PO_CANCELLED"]);
    expect(h.ops[0]).toBe("lock:po1");
  });

  it("refuses once something is registered", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1");
    seedAsset("a1");
    await expectNothingWritten(() => cancelPurchaseOrder({ id: "po1", reason: "supplier out of stock" }));
  });
});

describe("undoPoSendBack (Task 6 fix round 1: the send-back, undone as one action)", () => {
  const T0 = new Date("2026-10-21T02:42:00Z"); // 10:42 Manila
  const at = (min: number) => vi.setSystemTime(new Date(T0.getTime() + min * 60_000));
  const PO_KEYS = ["state", "sentBackAt", "sentBackById", "sentBackBy", "sentBackFields", "sentBackNote"] as const;
  const poState = () => Object.fromEntries(PO_KEYS.map((k) => [k, po()[k]]));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** PO-0214, READY, with a1 and a2 registered (a2 carries IT's earlier reply); Ana (Finance) sends it back. */
  async function sentBackByFinance() {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 2 });
    seedAsset("a1");
    seedAsset("a2", { financeResubmitNote: "serial fixed" });
    const before = { po: poState(), assets: structuredClone(t("asset")) };
    h.user = ANA;
    expect((await sendBackPurchaseOrder({ id: "po1", fields: ["cost"], note: "price is per box" })).ok).toBe(true);
    return before;
  }

  it("within 15 minutes: the PO's state and every asset it returned come back, each with its undone entry", async () => {
    const before = await sentBackByFinance();
    // the PO's entry and each asset's carry one id, so the undo finds exactly what this send-back returned
    const batch = (audits("po.send-back")[0].diff as { batch: { to: string } }).batch.to;
    expect(audits("finance.return").every((a) => (a.diff as { batch: { to: string } }).batch.to === batch)).toBe(true);
    at(5);
    expect(await undoPoSendBack({ id: "po1" })).toEqual({ ok: true, data: { refNo: "PO-0214", undone: 2 } });
    expect(poState()).toEqual(before.po);
    expect(t("asset")).toEqual(before.assets);
    expect(audits("asset.return.undone").map((a) => a.entityId)).toEqual(["a1", "a2"]);
    expect(audits("po.send-back.undone")).toEqual([expect.objectContaining({
      entityType: "purchase-order", entityId: "po1", actorId: ANA.id, source: "web",
      diff: { state: { from: "SENT_BACK", to: "READY" }, sentBack: { from: { team: "FINANCE", fields: ["unit price"], note: "price is per box" }, to: null } },
    })]);
    expect(t("noteEntry").map((n) => n.kind)).toEqual(["PO_SENT_BACK", "COMMENT"]);
  });

  it("IT's send-back goes back to With IT; a comment since doesn't block it", async () => {
    seedPo({ state: "WITH_IT" });
    seedLine("ln1");
    h.user = IVAN;
    await sendBackPurchaseOrder({ id: "po1", fields: ["invoiceRef"], note: "SI is unreadable" });
    h.user = PAT;
    await addComment({ id: "po1", text: "Looking into it" });
    h.user = IVAN;
    at(3);
    expect(await undoPoSendBack({ id: "po1" })).toEqual({ ok: true, data: { refNo: "PO-0214", undone: 0 } });
    expect(po()).toMatchObject({ state: "WITH_IT", sentBackBy: null, sentBackFields: [], sentBackNote: null });
  });

  it("refused for someone else", async () => {
    await sentBackByFinance();
    h.user = ADA;
    const r = await expectNothingWritten(() => undoPoSendBack({ id: "po1" }));
    expect(r).toMatchObject({ kind: "conflict", message: "Can't undo: only Ana Cruz can undo this." });
  });

  it("refused after 15 minutes", async () => {
    await sentBackByFinance();
    at(15);
    const r = await expectNothingWritten(() => undoPoSendBack({ id: "po1" }));
    expect(r).toMatchObject({ message: "Can't undo: the 15 minutes to undo it ended at 10:57." });
  });

  it("refused after Purchasing resubmitted it", async () => {
    await sentBackByFinance();
    at(1);
    h.user = PAT;
    expect((await savePurchaseOrder(order({ id: "po1", lines: [line({ id: "ln1", qty: 2, unitPrice: 25000 })], reply: "price per unit now" }))).ok).toBe(true);
    h.user = ANA;
    const r = await expectNothingWritten(() => undoPoSendBack({ id: "po1" }));
    expect(r).toMatchObject({ message: "Can't undo: PO-0214 is no longer with Purchasing." });
  });

  it("refused after Purchasing edited it while it was sent back", async () => {
    await sentBackByFinance();
    at(1);
    h.user = PAT;
    expect((await fixPurchaseOrder({ id: "po1", patch: { receiptRef: "OR-0099" } })).ok).toBe(true);
    h.user = ANA;
    const r = await expectNothingWritten(() => undoPoSendBack({ id: "po1" }));
    expect(r).toMatchObject({ message: "Can't undo: Pat Lim changed PO-0214 since, at 10:43." });
  });

  it("all or nothing: one returned asset changed since refuses the whole undo", async () => {
    await sentBackByFinance();
    at(2);
    t("auditEntry").push({
      id: "aud-later", actorId: ADA.id, actorLabel: ADA.name, entityType: "asset", entityId: "a2",
      action: "asset.money.fixed", diff: { cost: { from: 50000, to: 49000 } }, createdAt: new Date(),
    });
    const r = await expectNothingWritten(() => undoPoSendBack({ id: "po1" }));
    expect(r).toMatchObject({ message: "Can't undo: BR-LT-a2's review has changed since." });
  });
});

describe("PO form redesign (A3): save with documents, PO number, totals, legacy rules", () => {
  const errorsOf = (r: { ok: boolean; fieldErrors?: Record<string, string> }) => (r.ok ? {} : r.fieldErrors ?? {});
  const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002", clientVersion: "6", meta: { target: "PurchaseRequest_poNumber_live_key" },
  });
  /** PO-0214 from the new form: 5 laptops at ₱50,000, its typed totals adding up, and its sales invoice on file. */
  function seedV2(extra: Row = {}) {
    seedPo({
      formV2: true, poNumber: "2025-0300", paidBy: "DEBIT_CARD",
      totalSales: 250000, lessVat: 26785.71, netOfVat: 223214.29, discount: null, amountDue: 223214.29, addVat: 26785.71,
      totalAmountDue: 250000, totalsConsistent: true, ...extra,
    });
    seedLine("ln1", { unit: "pc" });
    t("requestDocument").push({ id: "doc-si", orderId: "po1", kind: "invoice", fileName: "si.pdf", path: "requests/po1/si.pdf", supersededAt: null });
  }

  it("a new PO needs every required field", async () => {
    const r = await expectNothingWritten(() =>
      savePurchaseOrder(form({ lines: [{ description: "Laptop", categoryId: "", qty: 0 }], totals: { totalAmountDue: "" } }, {})));
    expect(r).toMatchObject({ kind: "validation" });
    const errs = errorsOf(r);
    for (const k of [
      "vendorId", "poNumber", "invoiceRef", "purchasedAt", "paidBy", "totals.totalAmountDue", "doc:invoice",
      "lines.0.categoryId", "lines.0.qty", "lines.0.unitPrice",
    ]) {
      expect(errs, k).toHaveProperty([k]);
    }
    expect(errs).toMatchObject({
      poNumber: "Enter the purchase order number", paidBy: "Pick how it was paid",
      "totals.totalAmountDue": "Enter the total amount due", "doc:invoice": "Attach the sales invoice",
    });
    expect(errorsOf(await savePurchaseOrder(form(v2Order({ lines: [] }))))).toHaveProperty(["lines"]);

    // Everything filled in but no sales invoice: a plain object (no files) or a form without the invoice slot.
    expect(await savePurchaseOrder(v2Order())).toMatchObject({ kind: "validation", fieldErrors: { "doc:invoice": "Attach the sales invoice" } });
    const noSi = await savePurchaseOrder(form(v2Order(), { "doc:official-receipt": pdf("or.pdf") }));
    expect(errorsOf(noSi)).toEqual({ "doc:invoice": "Attach the sales invoice" });
    // A file that breaks the upload rules is refused on its slot, before anything is stored.
    const bad = await savePurchaseOrder(form(v2Order(), { "doc:invoice": new File(["x"], "si.exe", { type: "application/x-msdownload" }) }));
    expect(errorsOf(bad)).toHaveProperty(["doc:invoice"]);
    expect(stored()).toEqual([]);
    expect(t("purchaseOrder")).toEqual([]);
  });

  it("the owner's invoice saves READY→WITH_IT with totalsConsistent true", async () => {
    const r = await savePurchaseOrder(form(v2Order({ poNumber: "  2025-0418 " }), { "doc:invoice": pdf(), "doc:warranty-slip": pdf("ws.pdf") }));
    expect(r).toMatchObject({ ok: true, data: { refNo: "PO-0214", state: "WITH_IT" } });
    const id = r.ok ? r.data.id : "";
    const saved = t("purchaseOrder").find((p) => p.id === id)!;
    expect(saved).toMatchObject({
      formV2: true, poNumber: "2025-0418", paidBy: "CREDIT_CARD", invoiceRef: "SI-0012",
      totalSales: 9100, lessVat: 975, netOfVat: 8125, discount: null, amountDue: 8125, addVat: 975, totalAmountDue: 9100,
      totalsConsistent: true,
    });
    expect(saved.fees ?? null).toBeNull();
    expect(t("purchaseOrderLine")).toEqual([expect.objectContaining({ orderId: id, unit: "pc", qty: 1, unitPrice: 9100 })]);
    // the documents are written with the PO, each one stored
    const docs = t("requestDocument");
    expect(docs.map((d) => [d.orderId, d.kind, d.fileName, d.uploadedById])).toEqual([
      [id, "invoice", "si.pdf", PAT.id], [id, "warranty-slip", "ws.pdf", PAT.id],
    ]);
    expect(docs.map((d) => d.path).sort()).toEqual(stored().sort());
    // final review M3: the PO's id is minted before its files are stored, so a new PO's documents live under
    // requests/<poId>/ like every other PO document
    expect(id).not.toBe("");
    expect(stored().every((p) => p.startsWith(`requests/${id}/`))).toBe(true);
    expect(audits("document.uploaded")).toHaveLength(2);
    expect(audits("document.uploaded").every((a) => a.entityId === id && a.source === "web")).toBe(true);
    expect(t("notification")).toEqual([expect.objectContaining({ team: "IT", kind: "TO_CHECK", title: "PO-0214 · 1 Laptop from Purchasing to check" })]);

    // An office-only order from the new form is ready to register; a unit other than pc is kept as typed.
    const chairs = await savePurchaseOrder(form(v2Order({
      poNumber: "2025-0419", lines: [line({ description: "office chairs", categoryId: "cat-ch", qty: 1, unit: " set ", unitPrice: 9100 })],
    })));
    expect(chairs).toMatchObject({ ok: true, data: { state: "READY" } });
    expect(t("purchaseOrderLine")[1].unit).toBe("set");

    // Editing a saved PO from the new form keeps its sales invoice: nothing to re-attach.
    const lineId = t("purchaseOrderLine")[0].id;
    const again = await savePurchaseOrder(v2Order({ id, lines: [line({ id: lineId, description: "Laptop", qty: 1, unitPrice: 9100 })], receiptRef: "OR-1" }));
    expect(again).toMatchObject({ ok: true });
    expect(t("purchaseOrder").find((p) => p.id === id)).toMatchObject({ receiptRef: "OR-1", totalsConsistent: true });
  });

  it("totals that don't add up still save, with totalsConsistent false", async () => {
    const r = await savePurchaseOrder(form(v2Order({ totals: { ...OWNER_TOTALS, totalSales: "9,000.00" } })));
    expect(r.ok).toBe(true);
    expect(t("purchaseOrder")[0]).toMatchObject({ totalSales: 9000, totalsConsistent: false });

    // An amount that isn't one is refused on its own key.
    const bad = await savePurchaseOrder(form(v2Order({ poNumber: "2025-0420", totals: { ...OWNER_TOTALS, lessVat: "nine" } })));
    expect(errorsOf(bad)).toHaveProperty(["totals.lessVat"]);
    const neg = await savePurchaseOrder(form(v2Order({ poNumber: "2025-0420", totals: { ...OWNER_TOTALS, discount: "-5" } })));
    expect(errorsOf(neg)).toHaveProperty(["totals.discount"]);
  });

  it("PO number duplicates are refused case- and space-insensitively", async () => {
    expect((await savePurchaseOrder(form(v2Order({ poNumber: " ab-2025-0418" })))).ok).toBe(true);
    expect(t("purchaseOrder")[0].poNumber).toBe("ab-2025-0418");

    for (const typed of ["AB-2025-0418 ", "ab-2025-0418", "  Ab-2025-0418  "]) {
      const r = await expectNothingWritten(() => savePurchaseOrder(form(v2Order({ poNumber: typed }))));
      expect(r).toMatchObject({ kind: "validation", fieldErrors: { poNumber: `PO ${typed.trim()} is already used on PO-0214` } });
    }
    expect(stored()).toHaveLength(1); // the refused saves stored nothing

    // Two saves at once: the pre-check passes for both, the partial unique index refuses the second.
    h.racePoCheck = 1;
    h.failDoc = p2002();
    const raced = await savePurchaseOrder(form(v2Order({ poNumber: "AB-2025-0418" })));
    expect(raced).toMatchObject({ kind: "validation", fieldErrors: { poNumber: "PO AB-2025-0418 is already used on PO-0214" } });
    expect(t("purchaseOrder")).toHaveLength(1);
    expect(stored()).toHaveLength(1);

    // A cancelled PO frees its number.
    expect((await cancelPurchaseOrder({ id: t("purchaseOrder")[0].id, reason: "ordered twice by mistake" })).ok).toBe(true);
    expect((await savePurchaseOrder(form(v2Order({ poNumber: "AB-2025-0418" })))).ok).toBe(true);
  });

  it("a failure after storing files leaves nothing behind", async () => {
    h.failDoc = new Error("connection reset");
    const files = { "doc:invoice": pdf(), "doc:delivery-receipt": new File(["png"], "dr.png", { type: "image/png" }) };
    await expect(savePurchaseOrder(form(v2Order(), files))).rejects.toThrow("connection reset");
    // cleanup ran: both stored files were deleted, and the transaction left no PO, line, document or audit
    expect(h.deleted).toHaveLength(2);
    expect(stored()).toEqual([]);
    for (const name of ["purchaseOrder", "purchaseOrderLine", "requestDocument", "auditEntry", "noteEntry", "notification"]) {
      expect(t(name), name).toEqual([]);
    }

    const retry = await savePurchaseOrder(form(v2Order(), files));
    expect(retry).toMatchObject({ ok: true });
    expect(t("purchaseOrder")).toHaveLength(1);
    expect(t("requestDocument")).toHaveLength(2);
    expect(stored()).toHaveLength(2);
  });

  it("a legacy PO edits without the new fields", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "IT", sentBackById: IVAN.id, sentBackFields: ["invoiceRef"] });
    seedLine("ln1");
    t("purchaseOrder").push({ id: "po9", refNo: "PO-0209", state: "READY", poNumber: "2025-0500", formV2: true });
    const edit = (extra: Row = {}) => order({ id: "po1", invoiceRef: "SI-0021", lines: [line({ id: "ln1" })], reply: "SI number corrected", ...extra });

    // Filled in, a new field is still checked.
    const taken = await expectNothingWritten(() => savePurchaseOrder(edit({ poNumber: " 2025-0500" })));
    expect(taken).toMatchObject({ fieldErrors: { poNumber: "PO 2025-0500 is already used on PO-0209" } });
    const cash = await expectNothingWritten(() => savePurchaseOrder(edit({ paidBy: "CASH" })));
    expect(errorsOf(cash)).toHaveProperty(["paidBy"]);
    const long = await expectNothingWritten(() => savePurchaseOrder(edit({ poNumber: "x".repeat(41) })));
    expect(errorsOf(long)).toHaveProperty(["poNumber"]);

    // Left out (or blank), they stay optional: no PO number, paid by, totals or sales invoice.
    const r = await savePurchaseOrder(edit({ poNumber: "", paidBy: "", totals: { totalAmountDue: "" } }));
    expect(r).toMatchObject({ ok: true, data: { state: "WITH_IT" } });
    expect(po()).toMatchObject({ invoiceRef: "SI-0021", poNumber: null, paidBy: null, totalAmountDue: null, totalsConsistent: null });
    expect(po().formV2 ?? false).toBe(false);
    expect(po().fees).toBeNull(); // fees are left as they were

    const typed = await savePurchaseOrder(order({ id: "po1", invoiceRef: "SI-0021", lines: [line({ id: "ln1" })], poNumber: " 2025-0501 " }));
    expect(typed.ok).toBe(true);
    expect(po().poNumber).toBe("2025-0501");
  });

  it("a PO from the new form keeps its required fields on edit", async () => {
    seedV2();
    const r = await expectNothingWritten(() =>
      savePurchaseOrder(order({ id: "po1", lines: [line({ id: "ln1" })], poNumber: "", paidBy: "", totals: { totalAmountDue: "" } })));
    expect(errorsOf(r)).toMatchObject({
      poNumber: "Enter the purchase order number", paidBy: "Pick how it was paid", "totals.totalAmountDue": "Enter the total amount due",
    });
    // Its only sales invoice removed: the next save needs one attached.
    t("requestDocument")[0].supersededAt = new Date();
    const noSi = await savePurchaseOrder(order({
      id: "po1", lines: [line({ id: "ln1" })], poNumber: "2025-0300", paidBy: "DEBIT_CARD", totals: { totalAmountDue: "250000" },
    }));
    expect(errorsOf(noSi)).toEqual({ "doc:invoice": "Attach the sales invoice" });
  });

  it("fix can change totalAmountDue and recomputes totalsConsistent", async () => {
    seedV2();
    h.user = IVAN;
    const r = await fixPurchaseOrder({ id: "po1", patch: { totalAmountDue: "250,100.00" }, reason: "invoice says 250,100" });
    expect(r).toEqual({ ok: true, data: { refNo: "PO-0214", changed: ["totalAmountDue"] } });
    expect(po()).toMatchObject({ totalAmountDue: 250100, totalsConsistent: false });
    expect(audits("po.fix")[0].diff).toEqual({
      totalAmountDue: { from: 250000, to: 250100 }, totalsConsistent: { from: true, to: false },
    });
    expect(t("notification")[0]).toMatchObject({ title: "IT changed the total amount due on PO-0214" });

    // Back to the invoice's figure: consistent again; a price fix that moves the items off the totals: not.
    h.user = PAT;
    expect((await fixPurchaseOrder({ id: "po1", patch: { totalAmountDue: "250000" } })).ok).toBe(true);
    expect(po().totalsConsistent).toBe(true);
    expect((await fixPurchaseOrder({ id: "po1", patch: { lines: [{ id: "ln1", unitPrice: 48000 }] } })).ok).toBe(true);
    expect(po().totalsConsistent).toBe(false);

    // PO number and paid by are fixable money fields; the number is checked for clashes; required ones can't be cleared.
    t("purchaseOrder").push({ id: "po9", refNo: "PO-0209", state: "READY", poNumber: "2025-0500" });
    const clash = await expectNothingWritten(() => fixPurchaseOrder({ id: "po1", patch: { poNumber: "2025-0500 " } }));
    expect(clash).toMatchObject({ fieldErrors: { "patch.poNumber": "PO 2025-0500 is already used on PO-0209" } });
    const cleared = await expectNothingWritten(() => fixPurchaseOrder({ id: "po1", patch: { totalAmountDue: "" } }));
    expect(errorsOf(cleared)).toEqual({ "patch.totalAmountDue": "Enter the total amount due" });
    const fixed = await fixPurchaseOrder({ id: "po1", patch: { poNumber: " 2025-0301 ", paidBy: "CREDIT_CARD" } });
    expect(fixed).toMatchObject({ ok: true, data: { changed: ["poNumber", "paidBy"] } });
    expect(po()).toMatchObject({ poNumber: "2025-0301", paidBy: "CREDIT_CARD" });
  });

  it("IT and Finance can send back the PO number, paid by and the invoice totals", async () => {
    seedV2();
    h.user = IVAN;
    const r = await sendBackPurchaseOrder({ id: "po1", fields: ["poNumber", "paidBy", "totals"], note: "totals don't match the invoice" });
    expect(r.ok).toBe(true);
    expect(po().sentBackFields).toEqual(["poNumber", "paidBy", "totals"]);
    expect(t("notification")[0].title).toBe("PO-0214 sent back by IT: PO number, paid by and invoice totals");
  });

  it("closeLineShort leaves totalsConsistent as it is: the items are Σ qty × unit price, as on the paper invoice", async () => {
    seedV2({ state: "READY" });
    expect((await closeLineShort({ lineId: "ln1", qty: 2, reason: "vendor cancelled 2 units" })).ok).toBe(true);
    expect(po().totalsConsistent).toBe(true);
    expect(audits("po.line-closed")[0].diff).not.toHaveProperty("totalsConsistent");
    // and a save after it still checks qty × unit price: 5 × ₱50,000 matches the invoice's ₱250,000
    const seeded = {
      totalSales: "250,000.00", lessVat: "26,785.71", netOfVat: "223,214.29", discount: "", amountDue: "223,214.29",
      addVat: "26,785.71", totalAmountDue: "250,000.00",
    };
    const saved = await savePurchaseOrder(order({
      id: "po1", lines: [line({ id: "ln1" })], receiptRef: "OR-9", poNumber: "2025-0300", paidBy: "DEBIT_CARD", totals: seeded,
    }));
    expect(saved.ok).toBe(true);
    expect(po().totalsConsistent).toBe(true);
  });

  it("a throw after the transaction committed never cleans up the stored files", async () => {
    h.failRevalidate = new Error("revalidation failed");
    await expect(savePurchaseOrder(form(v2Order()))).rejects.toThrow("revalidation failed");
    // the PO and its sales invoice committed, and the file they point at is still stored
    expect(t("purchaseOrder")).toHaveLength(1);
    expect(t("requestDocument")).toHaveLength(1);
    expect(h.deleted).toEqual([]);
    expect(stored()).toEqual([t("requestDocument")[0].path]);

    // the same on an edit that attaches a document
    const id = t("purchaseOrder")[0].id as string;
    const lineId = t("purchaseOrderLine")[0].id;
    h.failRevalidate = new Error("revalidation failed");
    await expect(savePurchaseOrder(form(v2Order({ id, lines: [line({ id: lineId, description: "Laptop", qty: 1, unitPrice: 9100 })] }), {
      "doc:official-receipt": pdf("or.pdf"),
    }))).rejects.toThrow("revalidation failed");
    expect(t("requestDocument")).toHaveLength(2);
    expect(h.deleted).toEqual([]);
    expect(stored()).toHaveLength(2);
  });

  it("an empty document slot is no file: sent as \"\" or as an empty file input", async () => {
    const r = await savePurchaseOrder(form(v2Order(), {
      "doc:invoice": pdf(), "doc:official-receipt": "", "doc:delivery-receipt": new File([], "", { type: "application/octet-stream" }),
      "doc:warranty-slip": "",
    }));
    expect(r).toMatchObject({ ok: true });
    expect(t("requestDocument").map((d) => d.kind)).toEqual(["invoice"]);
    // an empty sales invoice slot on a new PO is "attach it", not "pick a file"
    const none = await savePurchaseOrder(form(v2Order({ poNumber: "2025-0420" }), { "doc:invoice": "" }));
    expect(errorsOf(none)).toEqual({ "doc:invoice": "Attach the sales invoice" });
  });
});

describe("a category deleted while the form was open (Task 3 carried: IT replaced it at Register)", () => {
  const GONE = "That category no longer exists — pick another";
  const errorsOf = (r: { ok: boolean; fieldErrors?: Record<string, string> }) => (r.ok ? {} : r.fieldErrors ?? {});
  const p2003 = (field: string) => new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated", {
    code: "P2003", clientVersion: "6", meta: { field_name: field },
  });
  const v2 = (extra: Row = {}) => order({
    poNumber: "2025-0418", paidBy: "CREDIT_CARD", totals: { totalAmountDue: "9,100.00" },
    lines: [line({ description: "Laptop", qty: 1, unitPrice: 9100 }), line({ description: "Network cable", categoryId: "cat-gone", qty: 1, unitPrice: 100 })],
    ...extra,
  });

  it("is refused on that line's category, before anything is stored", async () => {
    const r = await expectNothingWritten(() => savePurchaseOrder(form(v2())));
    expect(r).toMatchObject({ kind: "validation" });
    expect(errorsOf(r)).toEqual({ "lines.1.categoryId": GONE });
    expect(stored()).toEqual([]);
  });

  it("deleted between the check and the write: the foreign key's refusal says the same, and the files are cleaned up", async () => {
    h.failDoc = p2003("PurchaseUnit_categoryId_fkey (index)");
    const r = await savePurchaseOrder(form(v2({ lines: [line({ description: "Laptop", qty: 1, unitPrice: 9100 })] })));
    expect(r).toMatchObject({ kind: "validation", fieldErrors: { lines: GONE } });
    expect(t("purchaseOrder")).toEqual([]);
    expect(stored()).toEqual([]);

    // final review M4: the category really went in between — the refusal names each line that used it
    h.failDoc = p2003("PurchaseUnit_categoryId_fkey (index)");
    h.afterRollback = () => { h.tables.assetCategory = t("assetCategory").filter((c) => c.id !== "cat-lt"); };
    const named = await savePurchaseOrder(form(v2({
      lines: [
        line({ description: "Laptop", qty: 1, unitPrice: 9100 }),
        line({ description: "office chairs", categoryId: "cat-ch", qty: 1, unitPrice: 100 }),
        line({ description: "Spare laptop", qty: 1, unitPrice: 100 }),
      ],
    })));
    expect(named).toMatchObject({ kind: "validation" });
    expect(errorsOf(named)).toEqual({ "lines.0.categoryId": GONE, "lines.2.categoryId": GONE });
    expect(t("purchaseOrder")).toEqual([]);
    expect(stored()).toEqual([]);
    t("assetCategory").push({ id: "cat-lt", name: "Laptops", cls: "IT" }); // back for the next case

    // any other foreign-key refusal is not laundered into a category message
    h.failDoc = p2003("RequestDocument_uploadedById_fkey (index)");
    await expect(savePurchaseOrder(form(v2({ lines: [line({ description: "Laptop", qty: 1, unitPrice: 9100 })] }))))
      .rejects.toThrow("Foreign key constraint violated");
    expect(stored()).toEqual([]);
  });
});
