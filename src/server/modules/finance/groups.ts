import { Prisma, type AssetClass, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { teamOfRole } from "@/lib/intake-rules";
import { regWhere, registrationState, REG_LABEL_FINANCE, type RegState } from "@/lib/registration";
import { DOCUMENT_KIND_LABEL, REQUEST_DOCUMENT_LABEL } from "@/lib/documents";
import { fmtDate } from "@/lib/format";
import { assetDocHref } from "@/lib/finance-asset-page";
import type { PoState } from "@/lib/po-flow";

/*
 * Task 6 (spec §5): Finance's To review queue lists GROUPS — a registration (one PurchaseRecord per Register submit,
 * from a PO or direct) with at least one asset with Finance — instead of one row per asset. An asset registered before
 * registrations were recorded is a group of its own and opens its own Finance page. A PO that is with Purchasing for
 * corrections is left out: nothing on it can be approved until Purchasing sends it on (approveGroup refuses it).
 */

export type ReviewTeam = "IT" | "PURCHASING";

export interface ReviewGroup {
  /** The record's id, or `asset:<id>` for an asset with no registration record. */
  key: string;
  recordId: string | null;
  assetId: string | null;
  refNo: string | null;
  title: string;
  /** Assets of the group with Finance now. */
  count: number;
  /** Their cost. */
  total: Prisma.Decimal;
  registeredAt: Date;
  /** The team that registered it. */
  team: ReviewTeam;
}

/** The assets waiting for Finance — the same set as /finance/assets' To review (regWhere) — minus a sent-back PO's. */
export const REVIEW_GROUP_WHERE: Prisma.AssetWhereInput = {
  AND: [regWhere("with-finance"), { NOT: { purchaseOrder: { is: { state: "SENT_BACK" } } } }],
};

const GROUP_ROW_SELECT = {
  id: true, tag: true, model: true, cls: true, cost: true, createdAt: true,
  purchaseOrder: { select: { refNo: true } },
  purchaseOrderLine: { select: { description: true } },
  purchaseRecord: {
    select: { id: true, createdAt: true, cls: true, createdBy: { select: { role: true } }, purchaseOrder: { select: { refNo: true } } },
  },
} as const;

export interface GroupAssetRow {
  id: string;
  tag: string;
  model: string;
  cls: AssetClass;
  cost: Prisma.Decimal | number | null;
  createdAt: Date;
  purchaseOrder: { refNo: string } | null;
  purchaseOrderLine: { description: string } | null;
  purchaseRecord: {
    id: string; createdAt: Date; cls: AssetClass; createdBy: { role: Role }; purchaseOrder: { refNo: string } | null;
  } | null;
}

const classTeam = (cls: AssetClass): ReviewTeam => (cls === "IT" ? "IT" : "PURCHASING");

/** The team behind a registration: whoever registered it, or (an admin, every party) its class's team. */
export function registeringTeam(role: Role | null, cls: AssetClass): ReviewTeam {
  const t = role ? teamOfRole(role) : null;
  return t === "IT" || t === "PURCHASING" ? t : classTeam(cls);
}

/** "3 laptops" (one PO line), "2 × Ergo chair" (one model, no PO), "Latitude 5440" (one), "5 items" (mixed). */
function groupTitle(rows: GroupAssetRow[]): string {
  const lines = [...new Set(rows.map((r) => r.purchaseOrderLine?.description ?? null))];
  if (lines.length === 1 && lines[0] !== null) return `${rows.length} ${lines[0]}`;
  const models = [...new Set(rows.map((r) => r.model))];
  if (lines.every((l) => l === null) && models.length === 1) return rows.length === 1 ? models[0] : `${rows.length} × ${models[0]}`;
  return `${rows.length} items`;
}

const sum = (rows: GroupAssetRow[]) =>
  rows.reduce((s, r) => (r.cost === null ? s : s.plus(r.cost)), new Prisma.Decimal(0));

/** The queue, oldest registration first: one group per registration, one per asset with none. */
export function groupAssets(rows: GroupAssetRow[]): ReviewGroup[] {
  const byRecord = new Map<string, GroupAssetRow[]>();
  const groups: ReviewGroup[] = [];
  for (const r of rows) {
    if (!r.purchaseRecord) {
      groups.push({
        key: `asset:${r.id}`, recordId: null, assetId: r.id, refNo: r.purchaseOrder?.refNo ?? null,
        title: `${r.tag} · ${r.model}`, count: 1, total: sum([r]), registeredAt: r.createdAt, team: classTeam(r.cls),
      });
      continue;
    }
    const list = byRecord.get(r.purchaseRecord.id) ?? [];
    list.push(r);
    byRecord.set(r.purchaseRecord.id, list);
  }
  for (const [id, list] of byRecord) {
    const rec = list[0].purchaseRecord!;
    groups.push({
      key: id, recordId: id, assetId: null, refNo: rec.purchaseOrder?.refNo ?? list[0].purchaseOrder?.refNo ?? null,
      title: groupTitle(list), count: list.length, total: sum(list), registeredAt: rec.createdAt,
      team: registeringTeam(rec.createdBy.role, rec.cls),
    });
  }
  return groups.sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime() || a.key.localeCompare(b.key));
}

export async function reviewGroups(): Promise<ReviewGroup[]> {
  const rows = await prisma.asset.findMany({ where: REVIEW_GROUP_WHERE, select: GROUP_ROW_SELECT });
  return groupAssets(rows as GroupAssetRow[]);
}

/** How many groups wait: one per registration with an asset with Finance, plus one per such asset with none. */
export async function reviewGroupCount(): Promise<number> {
  const groups = await prisma.asset.groupBy({ by: ["purchaseRecordId"], where: REVIEW_GROUP_WHERE, _count: { _all: true } });
  return groups.reduce((n, g) => n + (g.purchaseRecordId === null ? g._count._all : 1), 0);
}

// ---- one group -----------------------------------------------------------------------------------------------------

export interface GroupAsset {
  id: string;
  tag: string;
  serial: string | null;
  brand: string | null;
  model: string;
  cls: AssetClass;
  /** Pesos, or null with no cost. */
  cost: number | null;
  reg: RegState;
  regLabel: string;
  notCapitalised: boolean;
  returnedTo: ReviewTeam | null;
  returnFields: string[];
  returnNote: string | null;
  resubmitNote: string | null;
}

export interface GroupDoc {
  id: string;
  kind: string;
  label: string;
  fileName: string;
  uploadedBy: string;
  at: string;
  downloadHref: string;
  /** For PDFs and images: the same route with `inline=1`. */
  previewHref: string | null;
}

export interface GroupDetail {
  recordId: string;
  refNo: string | null;
  po: { id: string; state: PoState; fees: number | null; lines: Array<{ id: string; description: string; qty: number; unitPrice: number | null }> } | null;
  registeredAt: Date;
  registeredBy: string;
  registeredByRole: Role;
  team: ReviewTeam;
  cls: AssetClass;
  money: {
    supplier: string | null; vendorId: string | null; invoiceRef: string | null; receiptRef: string | null;
    purchasedAt: Date | null; fees: number | null;
  };
  docs: GroupDoc[];
  assets: GroupAsset[];
  totals: { count: number; withFinance: number; approved: number; cost: number; fees: number; total: number };
}

const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));
const PREVIEWABLE = /\.(pdf|png|jpe?g)$/i;

/**
 * Everything the group's review page shows: the money (the PO's for a PO group — money lives on the PO, spec §5 —
 * else the registration's), the documents (the PO's, or the assets' own for a direct registration), every asset of
 * the registration with its review state, and the totals.
 */
export async function groupDetail(recordId: string): Promise<GroupDetail | null> {
  const record = await prisma.purchaseRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true, cls: true, createdAt: true, fees: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true,
      vendor: { select: { name: true } },
      createdBy: { select: { name: true, role: true } },
      purchaseOrder: {
        select: {
          id: true, refNo: true, state: true, fees: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true,
          vendor: { select: { name: true } },
          lines: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, qty: true, unitPrice: true } },
          documents: {
            orderBy: { createdAt: "desc" },
            select: { id: true, kind: true, fileName: true, createdAt: true, uploadedBy: { select: { name: true } } },
          },
        },
      },
      assets: {
        orderBy: { tag: "asc" },
        select: {
          id: true, tag: true, serial: true, brand: true, model: true, cls: true, cost: true, itVerifiedAt: true,
          financeConfirmedAt: true, financeReturnedAt: true, financeReturnedTo: true, financeNotCapitalised: true,
          financeReturnFields: true, financeReturnReason: true, financeResubmitNote: true,
          documents: {
            orderBy: { createdAt: "desc" },
            select: { id: true, kind: true, fileName: true, checksum: true, createdAt: true, uploadedBy: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!record) return null;
  const po = record.purchaseOrder;

  const assets: GroupAsset[] = record.assets.map((a) => {
    const reg = registrationState(a);
    return {
      id: a.id, tag: a.tag, serial: a.serial, brand: a.brand, model: a.model, cls: a.cls, cost: num(a.cost), reg,
      regLabel: reg === "registered" && a.financeNotCapitalised ? "Approved · not capitalised" : REG_LABEL_FINANCE[reg],
      notCapitalised: a.financeNotCapitalised,
      returnedTo: a.financeReturnedAt ? (a.financeReturnedTo === "IT" || a.financeReturnedTo === "PURCHASING" ? a.financeReturnedTo : classTeam(a.cls)) : null,
      returnFields: a.financeReturnFields, returnNote: a.financeReturnReason, resubmitNote: a.financeResubmitNote,
    };
  });

  let docs: GroupDoc[];
  if (po) {
    docs = po.documents.map((d) => {
      const href = `/purchases/${po.id}/documents/${d.id}/download`;
      return {
        id: d.id, kind: d.kind, label: REQUEST_DOCUMENT_LABEL[d.kind as keyof typeof REQUEST_DOCUMENT_LABEL] ?? d.kind,
        fileName: d.fileName, uploadedBy: d.uploadedBy?.name ?? "Unknown", at: fmtDate(d.createdAt),
        downloadHref: href, previewHref: PREVIEWABLE.test(d.fileName) ? `${href}?inline=1` : null,
      };
    });
  } else {
    // A direct registration's documents sit on its assets — one batch upload is one row per unit, so show each file once.
    const seen = new Set<string>();
    docs = [];
    for (const a of record.assets) {
      for (const d of a.documents) {
        if (seen.has(d.checksum)) continue;
        seen.add(d.checksum);
        docs.push({
          id: d.id, kind: d.kind, label: DOCUMENT_KIND_LABEL[d.kind as keyof typeof DOCUMENT_KIND_LABEL] ?? d.kind, fileName: d.fileName, uploadedBy: d.uploadedBy?.name ?? "Unknown",
          at: fmtDate(d.createdAt), downloadHref: assetDocHref(a.id, d.id),
          previewHref: PREVIEWABLE.test(d.fileName) ? assetDocHref(a.id, d.id, true) : null,
        });
      }
    }
  }

  const cost = assets.reduce((s, a) => s + (a.cost ?? 0), 0);
  const fees = num(po ? po.fees : record.fees) ?? 0;
  return {
    recordId: record.id,
    refNo: po?.refNo ?? null,
    po: po
      ? { id: po.id, state: po.state, fees: num(po.fees), lines: po.lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, unitPrice: num(l.unitPrice) })) }
      : null,
    registeredAt: record.createdAt,
    registeredBy: record.createdBy.name,
    registeredByRole: record.createdBy.role,
    team: registeringTeam(record.createdBy.role, record.cls),
    cls: record.cls,
    money: po
      ? { supplier: po.vendor?.name ?? null, vendorId: po.vendorId, invoiceRef: po.invoiceRef, receiptRef: po.receiptRef, purchasedAt: po.purchasedAt, fees: num(po.fees) }
      : { supplier: record.vendor?.name ?? null, vendorId: record.vendorId, invoiceRef: record.invoiceRef, receiptRef: record.receiptRef, purchasedAt: record.purchasedAt, fees: num(record.fees) },
    docs,
    assets,
    totals: {
      count: assets.length,
      withFinance: assets.filter((a) => a.reg === "with-finance").length,
      approved: assets.filter((a) => a.reg === "registered").length,
      cost, fees, total: cost + fees,
    },
  };
}
