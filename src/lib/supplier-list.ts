import type { Prisma, VendorContractStatus } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";
import { VENDOR_CONTRACT_STATUSES } from "./supplier-schema";

export const SUPPLIER_LIST_CONFIG: ListConfig = {
  facets: ["category", "contract", "archived"],
  sortable: ["name"],
  defaultSort: [{ key: "name", dir: "asc" }],
};

const isStatus = (s: string): s is VendorContractStatus => (VENDOR_CONTRACT_STATUSES as readonly string[]).includes(s);

/** Spec §4.1. Archived rows are hidden unless the archived facet asks for them alone. */
export function buildSupplierWhere(state: ListState): Prisma.VendorWhereInput {
  const where: Prisma.VendorWhereInput = state.filters.archived?.includes("1") ? { archivedAt: { not: null } } : { archivedAt: null };
  if (state.q) {
    where.OR = [
      { name: { contains: state.q, mode: "insensitive" } },
      { registeredName: { contains: state.q, mode: "insensitive" } },
      { contactPerson: { contains: state.q, mode: "insensitive" } },
      { email: { contains: state.q, mode: "insensitive" } },
    ];
  }
  const f = state.filters;
  if (f.category?.length) where.category = { in: f.category };
  const statuses = (f.contract ?? []).filter(isStatus);
  if (statuses.length) where.contractStatus = { in: statuses };
  return where;
}
