import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";

export const STOCK_LIST_CONFIG: ListConfig = {
  facets: ["category", "low", "archived"],
  sortable: ["code", "name"],
  defaultSort: [{ key: "code", dir: "asc" }],
};

/** Phase 19 spec §4-style list rules, mirroring buildSupplierWhere's shape. */
export function buildStockItemWhere(state: ListState): Prisma.StockItemWhereInput {
  const where: Prisma.StockItemWhereInput = state.filters.archived?.includes("1") ? { archivedAt: { not: null } } : { archivedAt: null };
  if (state.q) {
    where.OR = [
      { code: { contains: state.q, mode: "insensitive" } },
      { name: { contains: state.q, mode: "insensitive" } },
    ];
  }
  if (state.filters.category?.length) where.categoryId = { in: state.filters.category };
  // `low` is DERIVED (balance vs reorderLevel) — applied by the query after
  // the balances are computed, never here.
  return where;
}
