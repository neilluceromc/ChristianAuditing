import type { Prisma, VendorContractStatus } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";
import { VENDOR_CONTRACT_STATUSES } from "./supplier-schema";
import { addDays, dayFromISO } from "./deadlines";
import { localDateISO } from "./format";

/** Phase 46 spec §4.3: "Renewing soon" is a contract ending within this many days (`?renewing=30`). */
export const RENEWING_DAYS = 30;
export const RENEWING_LABEL = `Renewing within ${RENEWING_DAYS} days`;

export const SUPPLIER_LIST_CONFIG: ListConfig = {
  facets: ["category", "contract", "archived", "renewing"],
  facetValues: { renewing: [String(RENEWING_DAYS)] },
  sortable: ["name"],
  defaultSort: [{ key: "name", dir: "asc" }],
};

const isStatus = (s: string): s is VendorContractStatus => (VENDOR_CONTRACT_STATUSES as readonly string[]).includes(s);

/**
 * Spec §4.1. Archived rows are hidden unless the archived facet asks for them alone. Phase 46: `renewing=30` keeps
 * contracts ending from `today` to `today` + 30, both inclusive, on the Manila calendar (`today` is the Manila day;
 * contractEnd is stored as that day's UTC midnight, as the supplier form writes it).
 */
export function buildSupplierWhere(state: ListState, today: string = localDateISO()): Prisma.VendorWhereInput {
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
  if (f.renewing?.includes(String(RENEWING_DAYS))) {
    where.contractEnd = { gte: dayFromISO(today), lte: dayFromISO(addDays(today, RENEWING_DAYS)) };
  }
  return where;
}
