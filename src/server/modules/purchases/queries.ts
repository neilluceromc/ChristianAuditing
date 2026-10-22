import type { AssetClass, PaidBy, Prisma, PurchaseOrderState, Team } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dwellLine, purchaseWhere } from "@/lib/purchases-list";
import { bounceBack, type ThreadNote } from "@/lib/purchase-thread";
import { derivePoProgress, lineProgress, type poProgress } from "@/lib/po-flow";
import { TOTAL_KEYS, type TotalKey } from "@/lib/po-totals";
import { LOG_PAGE_SIZE } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";

export interface PurchaseListRow {
  id: string;
  refNo: string;
  state: PurchaseOrderState;
  requester: string;
  /** what is actually being bought: the first line, plus a count of the rest */
  summary: string;
  unitCount: number;
  totalQty: number;
  total: string;
  /** README 4d second line — "back from finance", "awaiting IT · 2 d" */
  dwell: string;
  department: string | null;
  supplier: string | null;
}

export interface PurchaseUnitView {
  id: string;
  /** 1-based position — the "unit 04" a bounce-back reason names */
  index: number;
  description: string;
  specs: string | null;
  /** Migration 38: the line's category (and so its class); null on legacy lines. */
  categoryId: string | null;
  categoryName: string | null;
  cls: AssetClass | null;
  qty: number;
  /** Migration 39: the line's unit ("pc" on every line before it). */
  unit: string;
  /** number, never a Prisma.Decimal: this crosses into client components */
  unitPrice: number | null;
  price: string;
  lineTotal: string;
  /** Assets registered from this line (the asset's PO-line link), and units closed short with why. */
  registered: number;
  closedShort: number;
  closedShortReason: string | null;
  /** Units still to register, and the label ("3 of 5 registered · 2 closed short"). */
  remaining: number;
  progressLabel: string;
  itSlotNotes: string | null;
  financeNotes: string | null;
}

export interface PurchaseDetail {
  id: string;
  refNo: string;
  state: PurchaseOrderState;
  requester: string;
  requestedById: string;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  units: PurchaseUnitView[];
  notes: ThreadNote[];
  total: string;
  totalValue: number;
  department: { id: string; name: string } | null;
  supplier: { id: string; name: string; archived: boolean } | null;
  /** The PO's documents still in their slots, newest first: a removed (superseded) one is left out… */
  documents: Array<{ id: string; kind: string; fileName: string; uploadedBy: string; at: string; downloadHref: string }>;
  /** …and counted here: it stays on record (append-only). */
  supersededCount: number;
  /** Migration 38: the PO's money (purchasedAt as YYYY-MM-DD for the date input; fees as a number). */
  invoiceRef: string | null;
  receiptRef: string | null;
  purchasedAt: string | null;
  fees: number | null;
  /** Migration 39 (PO form redesign): the PO number, how it was paid, and the seven totals typed off the sales invoice
   *  (numbers, never Decimals), with whether they added up at the last write (null when none is typed). All null on a
   *  legacy PO; `formV2` is true for a PO from the new form, whose required fields apply on edit. */
  poNumber: string | null;
  paidBy: PaidBy | null;
  totals: Record<TotalKey, number | null>;
  totalsConsistent: boolean | null;
  formV2: boolean;
  /** The open send-back, if any. */
  sentBack: { by: Team | null; byName: string | null; at: Date | null; note: string | null; fields: string[] } | null;
  /** Assets registered from it (all of them, through a line or not): editing and cancelling stop once there are any. */
  assetCount: number;
  /** …and how many of those Finance has approved. */
  approvedCount: number;
  /** derivePoProgress: poProgress over the lines, or off the asset counts for an old completed request; null until something is registered. */
  progress: ReturnType<typeof poProgress>;
  /** Some line is IT gear, or has no class yet (a legacy line): the IT check applies. */
  hasItLines: boolean;
  /** An old request (its lines have no category): the unit link was never set, so the page counts "N assets linked". */
  legacy: boolean;
}

const money = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export async function listPurchases(
  state: PurchaseOrderState | null,
  q: string,
  page: number,
  department: string | null = null,
  supplier: string | null = null,
  /** Task 7: only these POs (Purchasing's To register view, purchasingToRegisterIds); null = no such filter */
  onlyIds: string[] | null = null,
): Promise<{ rows: PurchaseListRow[]; total: number; page: number; pageCount: number }> {
  const base = purchaseWhere(state, q, department, supplier);
  const where: Prisma.PurchaseOrderWhereInput = onlyIds ? { AND: [base, { id: { in: onlyIds } }] } : base;
  const { rows, total, page: pg, pageCount } = await pagedSnapshot(
    LOG_PAGE_SIZE,
    page,
    (tx) => tx.purchaseOrder.count({ where }),
    (tx, pg) =>
      tx.purchaseOrder.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: pg.skip,
        take: pg.take,
        select: {
          id: true, refNo: true, state: true, updatedAt: true, submittedAt: true,
          sentBackAt: true, cancelledAt: true,
          requestedBy: { select: { name: true } },
          department: { select: { name: true } },
          vendor: { select: { name: true } },
          // id is a tiebreaker, not the sort key: units created in the same
          // batch (every seed row, every draft save) share one createdAt
          // millisecond, and createdAt alone is not a stable order across reads.
          lines: { select: { qty: true, unitPrice: true, description: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          // the newest state-carrying note decides "did this come back?" —
          // bounceBack() reads the last non-COMMENT note, so one row is enough
          notes: {
            where: { kind: { not: "COMMENT" } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, kind: true, text: true, createdAt: true, author: { select: { name: true } } },
          },
        },
      }),
  );

  const now = new Date();
  return {
    total,
    page: pg,
    pageCount,
    rows: rows.map((r): PurchaseListRow => {
      const last: ThreadNote[] = r.notes.map((n) => ({
        id: n.id, kind: n.kind, text: n.text, author: n.author.name, at: n.createdAt,
      }));
      const value = r.lines.reduce((sum, u) => sum + u.qty * money(u.unitPrice), 0);
      return {
        id: r.id,
        refNo: r.refNo,
        state: r.state,
        requester: r.requestedBy.name,
        summary:
          r.lines.length === 0
            ? "no lines yet"
            : r.lines.length === 1
              ? r.lines[0].description
              : `${r.lines[0].description} +${r.lines.length - 1} more`,
        unitCount: r.lines.length,
        totalQty: r.lines.reduce((sum, u) => sum + u.qty, 0),
        total: fmtMoney(value),
        department: r.department?.name ?? null,
        supplier: r.vendor?.name ?? null,
        dwell: dwellLine(
          {
            state: r.state, updatedAt: r.updatedAt, submittedAt: r.submittedAt,
            sentBackAt: r.sentBackAt, cancelledAt: r.cancelledAt,
            bounced: bounceBack(r.state, last) !== null,
          },
          now,
        ),
      };
    }),
  };
}

/**
 * Tab counts — one grouped query, plus the All total. Ready to register leaves out the completed POs, as its tab
 * does (purchaseWhere): they stay READY, so they are counted apart and taken off.
 */
export async function stateCounts(): Promise<Record<string, number>> {
  const [groups, completedReady] = await Promise.all([
    prisma.purchaseOrder.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.purchaseOrder.count({ where: { state: "READY", completedAt: { not: null } } }),
  ]);
  const counts: Record<string, number> = {
    ALL: 0, WITH_IT: 0, SENT_BACK: 0, READY: 0, CANCELLED: 0,
  };
  for (const g of groups) {
    counts[g.state] = g._count._all;
    counts.ALL += g._count._all;
  }
  counts.READY = Math.max(0, counts.READY - completedReady);
  return counts;
}

export async function getPurchase(id: string): Promise<PurchaseDetail | null> {
  const [r, perLine, approvedCount] = await Promise.all([
    prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true, refNo: true, state: true, createdAt: true, submittedAt: true, reviewedAt: true,
      completedAt: true, cancelledAt: true, cancelReason: true, requestedById: true,
      invoiceRef: true, receiptRef: true, purchasedAt: true, fees: true,
      poNumber: true, paidBy: true, totalsConsistent: true, formV2: true,
      totalSales: true, lessVat: true, netOfVat: true, discount: true, amountDue: true, addVat: true, totalAmountDue: true,
      sentBackBy: true, sentBackNote: true, sentBackFields: true, sentBackAt: true,
      sentBackByUser: { select: { name: true } },
      _count: { select: { assets: true } },
      requestedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      department: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true, archivedAt: true } },
      documents: {
        include: { uploadedBy: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      // See the identical comment in listPurchases: units created in the
      // same batch tie on createdAt, so `unit.index` (unit-N anchors, the
      // bounce-back's "Jump to unit 02") needs a stable tiebreaker.
      lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { category: { select: { name: true, cls: true } } } },
      notes: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, text: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  }),
    // Registered per line: the asset's own PO-line link (Task 5 sets it on every registration; old units never had it).
    prisma.asset.groupBy({ by: ["purchaseOrderLineId"], where: { purchaseOrderId: id }, _count: { _all: true } }),
    prisma.asset.count({ where: { purchaseOrderId: id, financeConfirmedAt: { not: null } } }),
  ]);
  if (!r) return null;
  const registeredOn = new Map(perLine.filter((g) => g.purchaseOrderLineId).map((g) => [g.purchaseOrderLineId!, g._count._all]));

  const units = r.lines.map((u, i): PurchaseUnitView => {
    const price = money(u.unitPrice);
    const registered = registeredOn.get(u.id) ?? 0;
    const progress = lineProgress({ qty: u.qty, registered, closedShort: u.closedShort });
    return {
      id: u.id,
      index: i + 1,
      description: u.description,
      specs: u.specs,
      categoryId: u.categoryId,
      categoryName: u.category?.name ?? null,
      cls: u.category?.cls ?? null,
      qty: u.qty,
      unit: u.unit,
      unitPrice: u.unitPrice === null ? null : price,
      price: u.unitPrice === null ? "—" : fmtMoney(price),
      lineTotal: u.unitPrice === null ? "—" : fmtMoney(price * u.qty),
      registered,
      closedShort: u.closedShort,
      closedShortReason: u.closedShortReason,
      remaining: progress.remaining,
      progressLabel: progress.label,
      itSlotNotes: u.itSlotNotes,
      financeNotes: u.financeNotes,
    };
  });
  const totalValue = units.reduce((sum, u) => sum + (u.unitPrice ?? 0) * u.qty, 0);

  return {
    id: r.id,
    refNo: r.refNo,
    state: r.state,
    requester: r.requestedBy.name,
    requestedById: r.requestedById,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy?.name ?? null,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    units,
    notes: r.notes.map((n) => ({
      id: n.id, kind: n.kind, text: n.text, author: n.author.name, at: n.createdAt,
    })),
    total: fmtMoney(totalValue),
    totalValue,
    department: r.department ? { id: r.department.id, name: r.department.name } : null,
    supplier: r.vendor ? { id: r.vendor.id, name: r.vendor.name, archived: r.vendor.archivedAt !== null } : null,
    documents: r.documents.filter((d) => d.supersededAt === null).map((d) => ({
      id: d.id, kind: d.kind, fileName: d.fileName, uploadedBy: d.uploadedBy?.name ?? "system",
      at: fmtDate(d.createdAt), downloadHref: `/purchases/${r.id}/documents/${d.id}/download`,
    })),
    supersededCount: r.documents.filter((d) => d.supersededAt !== null).length,
    invoiceRef: r.invoiceRef,
    receiptRef: r.receiptRef,
    purchasedAt: r.purchasedAt ? r.purchasedAt.toISOString().slice(0, 10) : null,
    fees: r.fees === null ? null : Number(r.fees),
    poNumber: r.poNumber,
    paidBy: r.paidBy,
    totals: Object.fromEntries(TOTAL_KEYS.map((k) => [k, r[k] === null ? null : Number(r[k])])) as Record<TotalKey, number | null>,
    totalsConsistent: r.totalsConsistent,
    formV2: r.formV2,
    sentBack: r.state === "SENT_BACK"
      ? { by: r.sentBackBy, byName: r.sentBackByUser?.name ?? null, at: r.sentBackAt, note: r.sentBackNote, fields: r.sentBackFields }
      : null,
    assetCount: r._count.assets,
    approvedCount,
    // An old completed request has linked assets but no line links: derivePoProgress reads it off the asset counts.
    progress: derivePoProgress(units, { assetCount: r._count.assets, approvedCount, completed: r.completedAt !== null }),
    hasItLines: units.some((u) => u.cls !== "PURCHASING"),
    legacy: units.some((u) => u.categoryId === null),
  };
}

export interface PolicyLoadout {
  id: string;
  name: string;
  slots: Array<{ name: string; type: string | null; required: boolean }>;
}

/** "Add from a policy loadout" (README 3f) — the standard kit as draft rows. */
export async function policyLoadouts(): Promise<PolicyLoadout[]> {
  const policies = await prisma.equipmentPolicy.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true,
      slots: {
        orderBy: { name: "asc" },
        select: { name: true, required: true, assetType: { select: { name: true } } },
      },
    },
  });
  return policies.map((p) => ({
    id: p.id,
    name: p.name,
    slots: p.slots.map((s) => ({ name: s.name, type: s.assetType?.name ?? null, required: s.required })),
  }));
}
