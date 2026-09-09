import type { AssetStatus, PurchaseRequestState, VendorContractStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { ListState } from "@/lib/url-state";
import { ENTITY_PAGE_SIZE, LOG_PAGE_SIZE, pageOf } from "@/lib/paging";
import { buildSupplierWhere } from "@/lib/supplier-list";
import { VENDOR_CONTRACT_STATUSES, CONTRACT_STATUS_LABEL } from "@/lib/supplier-schema";
import { provenanceOf, type Provenance } from "@/lib/provenance";
import { fmtDate } from "@/lib/format";
import type { FacetOption } from "@/server/modules/inventory/queries";

export interface SupplierRow {
  id: string; name: string; registeredName: string | null; category: string | null; contactPerson: string | null;
  phone: string | null; email: string | null; contractStatus: VendorContractStatus; contractEnd: Date | null;
  archived: boolean; requests: number; assets: number;
}

/** Spec §4.1. Count first (the page clamp needs the total), then the page and the two facet groupBys together. */
export async function listSuppliers(state: ListState) {
  const where = buildSupplierWhere(state);
  const without = (facet: string): ListState => ({ ...state, filters: { ...state.filters, [facet]: [] } });
  const total = await prisma.vendor.count({ where });
  const pg = pageOf(total, state.page, ENTITY_PAGE_SIZE);
  const [rows, categoryG, contractG] = await Promise.all([
    prisma.vendor.findMany({
      where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: pg.skip, take: pg.take,
      select: {
        id: true, name: true, registeredName: true, category: true, contactPerson: true, phone: true, email: true,
        contractStatus: true, contractEnd: true, archivedAt: true,
        _count: { select: { requests: true, assets: true } },
      },
    }),
    prisma.vendor.groupBy({ by: ["category"], where: buildSupplierWhere(without("category")), _count: true }),
    prisma.vendor.groupBy({ by: ["contractStatus"], where: buildSupplierWhere(without("contract")), _count: true }),
  ]);
  const facets: Record<"category" | "contract", FacetOption[]> = {
    category: categoryG
      .flatMap((g) => (g.category ? [{ value: g.category, label: g.category, count: g._count }] : []))
      .sort((a, b) => a.label.localeCompare(b.label)),
    contract: VENDOR_CONTRACT_STATUSES.map((s) => ({
      value: s, label: CONTRACT_STATUS_LABEL[s], count: contractG.find((g) => g.contractStatus === s)?._count ?? 0,
    })),
  };
  return {
    total, page: pg.page, pageCount: pg.pageCount, facets,
    rows: rows.map((v): SupplierRow => ({
      id: v.id, name: v.name, registeredName: v.registeredName, category: v.category, contactPerson: v.contactPerson,
      phone: v.phone, email: v.email, contractStatus: v.contractStatus, contractEnd: v.contractEnd,
      archived: v.archivedAt !== null, requests: v._count.requests, assets: v._count.assets,
    })),
  };
}

export interface SupplierDetail {
  id: string;
  name: string;
  registeredName: string | null;
  category: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  registrationNo: string | null;
  contractStatus: VendorContractStatus;
  contractStart: Date | null;
  contractEnd: Date | null;
  contractTerms: string | null;
  notes: string | null;
  archived: boolean;
  locked: boolean;
  createdAt: Date;
  updatedAt: Date;
  bankAccounts: Array<{ id: string; label: string; bankName: string; accountName: string; accountLast4: string }>;
  documents: Array<{ id: string; kind: string; fileName: string; uploadedBy: string; at: string; downloadHref: string }>;
  requests: {
    rows: Array<{ id: string; refNo: string; state: PurchaseRequestState; department: string | null; requester: string; updatedAt: Date }>;
    page: number; pageCount: number; total: number;
  };
  assets: {
    rows: Array<{ id: string; tag: string; model: string; status: AssetStatus; purchasedAt: Date | null; provenance: Provenance }>;
    page: number; pageCount: number; total: number;
  };
}

/**
 * Spec §4.2/§4.3. `_count` on the header query already IS the total for each
 * paged sub-list (both are `where: { vendorId: id }` with no other filter),
 * so `pageOf` runs off it directly — no second count query per sub-list.
 */
export async function getSupplier(
  id: string,
  pages: { requests: number; assets: number },
): Promise<SupplierDetail | null> {
  const v = await prisma.vendor.findUnique({
    where: { id },
    select: {
      id: true, name: true, registeredName: true, category: true, contactPerson: true, phone: true, email: true,
      address: true, registrationNo: true, contractStatus: true, contractStart: true, contractEnd: true,
      contractTerms: true, notes: true, archivedAt: true, locked: true, createdAt: true, updatedAt: true,
      bankAccounts: {
        orderBy: { label: "asc" },
        select: { id: true, label: true, bankName: true, accountName: true, accountLast4: true },
      },
      documents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, kind: true, fileName: true, createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      },
      _count: { select: { requests: true, assets: true } },
    },
  });
  if (!v) return null;

  const reqPg = pageOf(v._count.requests, pages.requests, LOG_PAGE_SIZE);
  const assetPg = pageOf(v._count.assets, pages.assets, ENTITY_PAGE_SIZE);
  const [requests, assets] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { vendorId: id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: reqPg.skip, take: reqPg.take,
      select: {
        id: true, refNo: true, state: true, updatedAt: true,
        department: { select: { name: true } },
        requestedBy: { select: { name: true } },
      },
    }),
    prisma.asset.findMany({
      where: { vendorId: id },
      orderBy: [{ tag: "asc" }, { id: "asc" }],
      skip: assetPg.skip, take: assetPg.take,
      select: {
        id: true, tag: true, model: true, status: true, purchasedAt: true,
        purchaseRequestId: true, importedAt: true,
      },
    }),
  ]);

  return {
    id: v.id, name: v.name, registeredName: v.registeredName, category: v.category, contactPerson: v.contactPerson,
    phone: v.phone, email: v.email, address: v.address, registrationNo: v.registrationNo,
    contractStatus: v.contractStatus, contractStart: v.contractStart, contractEnd: v.contractEnd,
    contractTerms: v.contractTerms, notes: v.notes, archived: v.archivedAt !== null, locked: v.locked,
    createdAt: v.createdAt, updatedAt: v.updatedAt,
    bankAccounts: v.bankAccounts.map((b) => ({
      id: b.id, label: b.label, bankName: b.bankName, accountName: b.accountName, accountLast4: b.accountLast4,
    })),
    documents: v.documents.map((d) => ({
      id: d.id, kind: d.kind, fileName: d.fileName, uploadedBy: d.uploadedBy?.name ?? "system",
      at: fmtDate(d.createdAt), downloadHref: `/purchases/suppliers/${id}/documents/${d.id}/download`,
    })),
    requests: {
      total: v._count.requests, page: reqPg.page, pageCount: reqPg.pageCount,
      rows: requests.map((r) => ({
        id: r.id, refNo: r.refNo, state: r.state, department: r.department?.name ?? null,
        requester: r.requestedBy.name, updatedAt: r.updatedAt,
      })),
    },
    assets: {
      total: v._count.assets, page: assetPg.page, pageCount: assetPg.pageCount,
      rows: assets.map((a) => ({
        id: a.id, tag: a.tag, model: a.model, status: a.status, purchasedAt: a.purchasedAt,
        provenance: provenanceOf(a),
      })),
    },
  };
}

/** The category picker's existing-value list — same 50-cap pattern as other reference distincts. */
export async function supplierCategories(): Promise<string[]> {
  const rows = await prisma.vendor.findMany({
    where: { category: { not: null } },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
    take: 50,
  });
  return rows.flatMap((r) => (r.category ? [r.category] : []));
}

/**
 * Spec §5.2: a request's supplier picker lists active suppliers, plus the
 * currently-set one even if it has since been archived — so an already-saved
 * value never renders as a blank in the control.
 */
export async function supplierOptions(includeId?: string | null): Promise<Array<{ id: string; name: string; archived: boolean }>> {
  const active = await prisma.vendor.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const rows = active.map((v) => ({ id: v.id, name: v.name, archived: false }));
  if (includeId && !rows.some((r) => r.id === includeId)) {
    const extra = await prisma.vendor.findUnique({ where: { id: includeId }, select: { id: true, name: true, archivedAt: true } });
    if (extra && extra.archivedAt !== null) rows.push({ id: extra.id, name: extra.name, archived: true });
  }
  return rows;
}
