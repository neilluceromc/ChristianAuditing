import type { PurchaseRequestState, PurchaseUnitState } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtMoney } from "@/lib/format";
import { PURCHASE_PAGE_SIZE, dwellLine, purchaseWhere } from "@/lib/purchases-list";
import { bounceBack, type ThreadNote } from "@/lib/purchase-thread";

export interface PurchaseListRow {
  id: string;
  refNo: string;
  state: PurchaseRequestState;
  requester: string;
  /** what is actually being bought: the first line, plus a count of the rest */
  summary: string;
  unitCount: number;
  totalQty: number;
  total: string;
  /** README 4d second line — "back from finance", "awaiting IT · 2 d" */
  dwell: string;
}

export interface PurchaseUnitView {
  id: string;
  /** 1-based position — the "unit 04" a bounce-back reason names */
  index: number;
  description: string;
  specs: string | null;
  qty: number;
  /** number, never a Prisma.Decimal: this crosses into client components */
  unitPrice: number | null;
  price: string;
  lineTotal: string;
  state: PurchaseUnitState;
  itSlotNotes: string | null;
  financeNotes: string | null;
}

export interface PurchaseDetail {
  id: string;
  refNo: string;
  state: PurchaseRequestState;
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
}

const money = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export async function listPurchases(
  state: PurchaseRequestState | null,
  q: string,
  page: number,
): Promise<{ rows: PurchaseListRow[]; total: number; page: number; pageCount: number }> {
  const where = purchaseWhere(state, q);
  const total = await prisma.purchaseRequest.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PURCHASE_PAGE_SIZE));
  // an unbounded ?page= must not become a huge OFFSET
  const safePage = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.purchaseRequest.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (safePage - 1) * PURCHASE_PAGE_SIZE,
    take: PURCHASE_PAGE_SIZE,
    select: {
      id: true, refNo: true, state: true, updatedAt: true, submittedAt: true,
      reviewedAt: true, completedAt: true, cancelledAt: true,
      requestedBy: { select: { name: true } },
      // id is a tiebreaker, not the sort key: units created in the same
      // batch (every seed row, every draft save) share one createdAt
      // millisecond, and createdAt alone is not a stable order across reads.
      units: { select: { qty: true, unitPrice: true, description: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      // the newest state-carrying note decides "did this come back?" —
      // bounceBack() reads the last non-COMMENT note, so one row is enough
      notes: {
        where: { kind: { not: "COMMENT" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, kind: true, text: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  });

  const now = new Date();
  return {
    total,
    page: safePage,
    pageCount,
    rows: rows.map((r): PurchaseListRow => {
      const last: ThreadNote[] = r.notes.map((n) => ({
        id: n.id, kind: n.kind, text: n.text, author: n.author.name, at: n.createdAt,
      }));
      const value = r.units.reduce((sum, u) => sum + u.qty * money(u.unitPrice), 0);
      return {
        id: r.id,
        refNo: r.refNo,
        state: r.state,
        requester: r.requestedBy.name,
        summary:
          r.units.length === 0
            ? "no lines yet"
            : r.units.length === 1
              ? r.units[0].description
              : `${r.units[0].description} +${r.units.length - 1} more`,
        unitCount: r.units.length,
        totalQty: r.units.reduce((sum, u) => sum + u.qty, 0),
        total: fmtMoney(value),
        dwell: dwellLine(
          {
            state: r.state, updatedAt: r.updatedAt, submittedAt: r.submittedAt,
            reviewedAt: r.reviewedAt, completedAt: r.completedAt, cancelledAt: r.cancelledAt,
            bounced: bounceBack(r.state, last) !== null,
          },
          now,
        ),
      };
    }),
  };
}

/** Tab counts — one grouped query, plus the All total. */
export async function stateCounts(): Promise<Record<string, number>> {
  const groups = await prisma.purchaseRequest.groupBy({ by: ["state"], _count: { _all: true } });
  const counts: Record<string, number> = {
    ALL: 0, DRAFT: 0, SUBMITTED: 0, IT_REVIEWED: 0, COMPLETED: 0, CANCELLED: 0,
  };
  for (const g of groups) {
    counts[g.state] = g._count._all;
    counts.ALL += g._count._all;
  }
  return counts;
}

export async function getPurchase(id: string): Promise<PurchaseDetail | null> {
  const r = await prisma.purchaseRequest.findUnique({
    where: { id },
    select: {
      id: true, refNo: true, state: true, createdAt: true, submittedAt: true, reviewedAt: true,
      completedAt: true, cancelledAt: true, cancelReason: true, requestedById: true,
      requestedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      // See the identical comment in listPurchases: units created in the
      // same batch tie on createdAt, so `unit.index` (unit-N anchors, the
      // bounce-back's "Jump to unit 02") needs a stable tiebreaker.
      units: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      notes: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, text: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  });
  if (!r) return null;

  const units = r.units.map((u, i): PurchaseUnitView => {
    const price = money(u.unitPrice);
    return {
      id: u.id,
      index: i + 1,
      description: u.description,
      specs: u.specs,
      qty: u.qty,
      unitPrice: u.unitPrice === null ? null : price,
      price: u.unitPrice === null ? "—" : fmtMoney(price),
      lineTotal: u.unitPrice === null ? "—" : fmtMoney(price * u.qty),
      state: u.state,
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
