import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineProgress } from "@/lib/po-flow";

/*
 * Register from a purchase order, Task 5 (spec §4 ways 1–2, "Partial deliveries"; Review Focus 1 and 5), against an
 * in-memory Prisma. Unlike po-actions.test.ts this fake emulates the PO row lock: `SELECT … FOR UPDATE` inside a
 * transaction waits while another transaction holds the same row, and the lock is released when its transaction
 * ends — so two submits racing for the last units of a line really do serialise, and the test shows the second one
 * re-reads what is left after it gets the lock. The fake has no rollback, so a refusal must also write nothing.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** Row locks, reads and counts, in order. */
  ops: [] as string[],
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
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
      h.ops.push(`read:${name}`);
      const r = rows(name).find((x) => matches(x, where));
      return r ? structuredClone(r) : null;
    },
    findMany: async ({ where }: { where?: R } = {}) => {
      h.ops.push(`read:${name}`);
      return structuredClone(rows(name).filter((x) => matches(x, where)));
    },
    count: async ({ where }: { where?: R } = {}) => {
      h.ops.push(`count:${name}`);
      return rows(name).filter((x) => matches(x, where)).length;
    },
    groupBy: async ({ by, where }: { by: string[]; where?: R }) => {
      h.ops.push(`count:${name}`);
      const groups = new Map<string, number>();
      for (const r of rows(name).filter((x) => matches(x, where))) {
        const k = String(r[by[0]] ?? "");
        groups.set(k, (groups.get(k) ?? 0) + 1);
      }
      return [...groups].map(([k, c]) => ({ [by[0]]: k === "" ? null : k, _count: { _all: c } }));
    },
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
    ["purchaseOrder", "purchaseOrderLine", "asset", "purchaseRecord", "noteEntry", "auditEntry", "notification",
      "user", "assetCategory", "assetType"].map((t) => [t, table(t)]),
  ) as Record<string, ReturnType<typeof table>>;

  /** Row locks held by open transactions: a second FOR UPDATE on the same id waits for the first to end. */
  const locks = new Map<string, Promise<void>>();
  const $transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const held: Array<() => void> = [];
    const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (!strings.join("$").includes("FOR UPDATE")) throw new Error("unexpected raw query");
      const id = String(values[0]);
      h.ops.push(`lock:${id}`);
      while (locks.has(id)) await locks.get(id);
      let release!: () => void;
      locks.set(id, new Promise<void>((resolve) => { release = () => { locks.delete(id); resolve(); }; }));
      held.push(release);
      return [];
    };
    try {
      return await fn({ ...client, $queryRaw });
    } finally {
      for (const r of held) r();
    }
  };
  return { prisma: { ...client, $transaction } };
});

import { registerFromPurchaseOrder } from "./po-register";

const PAT = { id: "u-pat", name: "Pat Lim", role: "purchasing_staff" };
const IVAN = { id: "u-ivan", name: "Ivan Tan", role: "it_staff" };
const ANA = { id: "u-ana", name: "Ana Cruz", role: "finance_staff" };
const ADA = { id: "u-ada", name: "Ada Admin", role: "admin" };

const BOUGHT = new Date("2026-10-15T00:00:00Z");

const t = (name: string) => h.tables[name];
const po = () => t("purchaseOrder").find((p) => p.id === "po1")!;
const audits = (action: string) => t("auditEntry").filter((a) => a.action === action);
const onLine = (lineId: string) => t("asset").filter((a) => a.purchaseOrderLineId === lineId).length;

function seedPo(extra: Row = {}) {
  t("purchaseOrder").push({
    id: "po1", refNo: "PO-0214", state: "WITH_IT", requestedById: PAT.id, departmentId: null,
    vendorId: "v1", invoiceRef: "SI-0012", receiptRef: "OR-77", purchasedAt: BOUGHT, fees: 1500,
    sentBackAt: null, sentBackById: null, sentBackBy: null, sentBackFields: [], sentBackNote: null,
    completedAt: null, cancelledAt: null, cancelReason: null,
    ...extra,
  });
}
function seedLine(id: string, extra: Row = {}) {
  t("purchaseOrderLine").push({
    id, orderId: "po1", description: "laptops", specs: null, categoryId: "cat-lt", qty: 5, unitPrice: 50000,
    closedShort: 0, closedShortReason: null, ...extra,
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

const units = (tags: string[], serial = true) => tags.map((tag) => ({ tag, ...(serial ? { serial: `SN-${tag}` } : {}) }));
const laptops = (tags: string[], extra: Row = {}) => ({ lineId: "ln1", model: "ThinkPad T14", units: units(tags), ...extra });

beforeEach(() => {
  h.user = IVAN;
  h.ops = [];
  h.revalidated = [];
  h.tables = {
    user: [PAT, IVAN, ANA, ADA].map((u) => ({ ...u })),
    assetCategory: [
      { id: "cat-lt", name: "Laptops", cls: "IT" },
      { id: "cat-ch", name: "Chairs", cls: "PURCHASING" },
      { id: "cat-mon", name: "Monitors", cls: "IT" },
    ],
    // Monitors has types: a monitor needs one picked (spec §8, Phase 36).
    assetType: [{ id: "type-24", name: "24-inch", categoryId: "cat-mon" }],
    purchaseOrder: [], purchaseOrderLine: [], asset: [], purchaseRecord: [], noteEntry: [], auditEntry: [], notification: [],
  };
});

describe("registerFromPurchaseOrder", () => {
  it("registers 3 of 5: the PO's money and line link on each asset, 2 left, one Finance TO_CHECK", async () => {
    seedPo();
    seedLine("ln1");
    const r = await registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201", "BR-LT-0202", "BR-LT-0203"])] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.created).toBe(3);
    expect(r.data.ids).toHaveLength(3);

    const record = t("purchaseRecord").find((x) => x.id === r.data.purchaseRecordId)!;
    expect(record).toMatchObject({
      purchaseOrderId: "po1", cls: "IT", quantity: 3, vendorId: "v1", invoiceRef: "SI-0012", receiptRef: "OR-77",
      purchasedAt: BOUGHT, fees: null, createdById: IVAN.id,
    });

    const made = t("asset");
    expect(made).toHaveLength(3);
    for (const a of made) {
      expect(a).toMatchObject({
        cost: 50000, vendorId: "v1", invoiceRef: "SI-0012", receiptRef: "OR-77", purchasedAt: BOUGHT,
        purchaseOrderId: "po1", purchaseOrderLineId: "ln1", purchaseRecordId: record.id,
        categoryId: "cat-lt", cls: "IT", status: "SPARE", model: "ThinkPad T14", itVerifiedById: IVAN.id,
      });
      expect(a.itVerifiedAt).toBeInstanceOf(Date);
      expect(a.financeConfirmedAt ?? null).toBeNull();
    }
    expect(made.map((a) => [a.tag, a.serial])).toEqual([
      ["BR-LT-0201", "SN-BR-LT-0201"], ["BR-LT-0202", "SN-BR-LT-0202"], ["BR-LT-0203", "SN-BR-LT-0203"],
    ]);

    expect(lineProgress({ qty: 5, registered: onLine("ln1"), closedShort: 0 })).toEqual({ remaining: 2, label: "3 of 5 registered" });
    // A WITH_IT PO is READY once IT registers from it.
    expect(po().state).toBe("READY");

    expect(t("notification")).toHaveLength(1);
    expect(t("notification")[0]).toMatchObject({
      team: "FINANCE", kind: "TO_CHECK", title: "PO-0214 · 3 laptops registered, ready to check",
      href: `/finance/review/${record.id}`, actorId: IVAN.id, entityType: "purchase-order", entityId: "po1",
    });

    expect(audits("register")).toHaveLength(3);
    expect(audits("register").map((a) => a.entityId).sort()).toEqual([...r.data.ids].sort());
    expect(audits("po.register")).toHaveLength(1);
    expect(audits("po.register")[0]).toMatchObject({ entityType: "purchase-order", entityId: "po1" });
    expect(t("auditEntry").every((a) => a.source === "web")).toBe(true);
    expect(t("noteEntry").map((n) => [n.kind, n.orderId])).toEqual([["PO_REGISTERED", "po1"]]);

    // The PO row is locked before the PO, its lines or its registered counts are read.
    const lock = h.ops.indexOf("lock:po1");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(h.ops.indexOf("read:purchaseOrder"));
    expect(lock).toBeLessThan(h.ops.indexOf("read:purchaseOrderLine"));
    expect(lock).toBeLessThan(h.ops.findIndex((o) => o === "count:asset"));
  });

  it("the rest of the line registers later as its own group, and then nothing is left", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 5 });
    const first = await registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201", "BR-LT-0202", "BR-LT-0203"])] });
    const second = await registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0204", "BR-LT-0205"])] });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.purchaseRecordId).not.toBe(first.data.purchaseRecordId);
    expect(t("purchaseRecord")).toHaveLength(2);
    expect(t("notification").map((n) => n.title)).toEqual([
      "PO-0214 · 3 laptops registered, ready to check", "PO-0214 · 2 laptops registered, ready to check",
    ]);
    expect(lineProgress({ qty: 5, registered: onLine("ln1"), closedShort: 0 }).remaining).toBe(0);

    const more = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0206"])] }));
    expect(more).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.units": "Only 0 left to register on this line" } });
  });

  it("units closed short count against what is left", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 5, closedShort: 2 });
    const r = await expectNothingWritten(() =>
      registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201", "BR-LT-0202", "BR-LT-0203", "BR-LT-0204"])] }));
    expect(r).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.units": "Only 3 left to register on this line" } });
  });

  it("second submit beyond remaining refused: two submits for the last 2 units — the lock makes the second re-read 0", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1", { qty: 2 });
    const [a, b] = await Promise.all([
      registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0301", "BR-LT-0302"])] }),
      registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0303", "BR-LT-0304"])] }),
    ]);
    const results = [a, b];
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const refused = results.find((x) => !x.ok)!;
    expect(refused).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { "lines.0.units": "Only 0 left to register on this line" },
    });
    // Never over-registered: two assets, one group, one bell.
    expect(onLine("ln1")).toBe(2);
    expect(t("purchaseRecord")).toHaveLength(1);
    expect(t("notification")).toHaveLength(1);
    // Both asked for the lock before either counted; the second count came after the first submit's writes.
    const locks = h.ops.flatMap((o, i) => (o === "lock:po1" ? [i] : []));
    expect(locks).toHaveLength(2);
    const counts = h.ops.flatMap((o, i) => (o === "count:asset" ? [i] : []));
    expect(counts).toHaveLength(2);
    expect(locks[1]).toBeLessThan(counts[0]);
  });

  it("mixed PO class guard (Review Focus 5): Purchasing can't register the IT line, IT can't register the other", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1");
    seedLine("ln2", { description: "office chairs", categoryId: "cat-ch", qty: 4, unitPrice: 4500 });

    h.user = PAT;
    const it = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"])] }));
    expect(it).toMatchObject({ kind: "validation", fieldErrors: { "lines.0": "IT registers IT gear" } });

    h.user = IVAN;
    const chairs = { lineId: "ln2", model: "Ergo mesh", units: [{ tag: "BR-CH-0001" }] };
    const other = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [chairs] }));
    expect(other).toMatchObject({ kind: "validation", fieldErrors: { "lines.0": "Purchasing registers these items" } });

    // Each team's own line goes through; a non-IT item needs no serial and is not IT-checked.
    h.user = PAT;
    const ok = await registerFromPurchaseOrder({ poId: "po1", lines: [chairs] });
    expect(ok.ok).toBe(true);
    expect(t("asset")[0]).toMatchObject({
      tag: "BR-CH-0001", serial: null, cls: "PURCHASING", status: "STORED", cost: 4500, itVerifiedAt: null,
      purchaseOrderLineId: "ln2",
    });
    expect(t("notification")[0]).toMatchObject({ team: "FINANCE", title: "PO-0214 · 1 office chairs registered, ready to check" });
  });

  it("only an admin may mix classes in one submit", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1");
    seedLine("ln2", { description: "office chairs", categoryId: "cat-ch", qty: 4, unitPrice: 4500 });
    const both = { poId: "po1", lines: [laptops(["BR-LT-0201"]), { lineId: "ln2", model: "Ergo mesh", units: [{ tag: "BR-CH-0001" }] }] };

    h.user = IVAN;
    expect(await expectNothingWritten(() => registerFromPurchaseOrder(both)))
      .toMatchObject({ kind: "validation", fieldErrors: { "lines.1": "Purchasing registers these items" } });

    h.user = ADA;
    const r = await registerFromPurchaseOrder(both);
    expect(r).toMatchObject({ ok: true, data: { created: 2 } });
    expect(t("asset").map((a) => [a.tag, a.cls, a.purchaseOrderLineId])).toEqual([
      ["BR-LT-0201", "IT", "ln1"], ["BR-CH-0001", "PURCHASING", "ln2"],
    ]);
    expect(t("notification")).toHaveLength(1);
    expect(t("notification")[0].title).toBe("PO-0214 · 2 items registered, ready to check");
  });

  it("IT serial required", async () => {
    seedPo();
    seedLine("ln1");
    const r = await expectNothingWritten(() => registerFromPurchaseOrder({
      poId: "po1",
      lines: [{ lineId: "ln1", model: "ThinkPad T14", units: [{ tag: "BR-LT-0201", serial: "SN-1" }, { tag: "BR-LT-0202", serial: "  " }] }],
    }));
    expect(r).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.units.1.serial": "Row 2 · BR-LT-0202 needs a serial" } });
  });

  it("tags are unique: within the submit and against the register", async () => {
    seedPo();
    seedLine("ln1");
    t("asset").push({ id: "old", tag: "BR-LT-0100", serial: "SN-OLD", cls: "IT", purchaseOrderId: null, purchaseOrderLineId: null });

    const twice = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201", "br-lt-0201"])] }));
    expect(twice).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.units.1.tag": "Row 2 · BR-LT-0201 appears twice in this batch" } });

    const taken = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0100"])] }));
    expect(taken).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.units.0.tag": "Row 1 · BR-LT-0100 is already registered" } });

    const serial = await expectNothingWritten(() => registerFromPurchaseOrder({
      poId: "po1", lines: [{ lineId: "ln1", model: "ThinkPad T14", units: [{ tag: "BR-LT-0201", serial: "SN-OLD" }] }],
    }));
    expect(serial).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.units.0.serial": "Serial SN-OLD is already on BR-LT-0100" } });
  });

  it("legacy line needs a category; the picked category gives the asset its class", async () => {
    // An old request's unit: no category, so the class is picked at Register (spec §3 legacy lines).
    seedPo({ state: "READY", invoiceRef: null, completedAt: new Date("2026-09-01T00:00:00Z") });
    seedLine("ln1", { categoryId: null, qty: 2, unitPrice: 48000 });

    const missing = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"])] }));
    expect(missing).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.categoryId": "Pick a category" } });

    // The class follows the picked category: IT can't pick a non-IT one.
    const wrong = await expectNothingWritten(() =>
      registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"], { categoryId: "cat-ch" })] }));
    expect(wrong).toMatchObject({ kind: "validation", fieldErrors: { "lines.0": "Purchasing registers these items" } });

    const r = await registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"], { categoryId: "cat-lt" })] });
    expect(r.ok).toBe(true);
    expect(t("asset")[0]).toMatchObject({ categoryId: "cat-lt", cls: "IT", cost: 48000, invoiceRef: null, purchaseOrderLineId: "ln1" });
    // The line keeps no category: each later asset picks its own.
    expect(t("purchaseOrderLine")[0].categoryId).toBeNull();
  });

  it("a line with a category can't take another one, and a category with types needs one", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1");
    seedLine("ln2", { description: "monitors", categoryId: "cat-mon", qty: 2, unitPrice: 9000 });
    const other = await expectNothingWritten(() =>
      registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"], { categoryId: "cat-mon" })] }));
    expect(other).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.categoryId": "This line is Laptops" } });

    const monitors = { lineId: "ln2", model: "Dell P2425", units: units(["BR-MN-0001"]) };
    const noType = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [monitors] }));
    expect(noType).toMatchObject({ kind: "validation", fieldErrors: { "lines.0.typeId": "Pick the type" } });

    const r = await registerFromPurchaseOrder({ poId: "po1", lines: [{ ...monitors, typeId: "type-24" }] });
    expect(r.ok).toBe(true);
    expect(t("asset")[0]).toMatchObject({ typeId: "type-24", categoryId: "cat-mon" });
  });

  it("SENT_BACK PO refused — whoever sent it back — and so is a CANCELLED one", async () => {
    seedPo({ state: "SENT_BACK", sentBackBy: "FINANCE", sentBackById: ANA.id });
    seedLine("ln1");
    const r = await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"])] }));
    expect(r).toMatchObject({ kind: "conflict", message: "It's been sent back to Purchasing" });

    po().sentBackBy = "IT";
    expect(await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"])] })))
      .toMatchObject({ kind: "conflict", message: "It's been sent back to Purchasing" });

    Object.assign(po(), { state: "CANCELLED", sentBackBy: null });
    expect(await expectNothingWritten(() => registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"])] })))
      .toMatchObject({ kind: "conflict", message: "This purchase order is cancelled" });
  });

  it("Finance and viewers can't register; a line from another PO is refused", async () => {
    seedPo({ state: "READY" });
    seedLine("ln1");
    t("purchaseOrderLine").push({ id: "lnX", orderId: "po2", description: "x", categoryId: "cat-lt", qty: 1, unitPrice: 1, closedShort: 0 });
    h.user = ANA;
    expect(await registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"])] })).toMatchObject({ kind: "forbidden" });

    h.user = IVAN;
    const r = await expectNothingWritten(() =>
      registerFromPurchaseOrder({ poId: "po1", lines: [laptops(["BR-LT-0201"], { lineId: "lnX" })] }));
    expect(r).toMatchObject({ kind: "conflict", message: "This purchase order changed elsewhere — reload and try again." });
  });
});
