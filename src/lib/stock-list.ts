import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";

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

/**
 * `buildAssetOrderBy` (`src/lib/inventory-list.ts`) / `buildEmployeeOrderBy`
 * (`src/lib/employees-list.ts`) precedent: a named, testable order builder
 * instead of inlining `{[s.key]: s.dir}` at the call site. Unlike those two
 * (which trust `state.sort` was already filtered to `sortable` upstream by
 * `parseListState`), this one filters to `STOCK_LIST_CONFIG.sortable` itself
 * so it stays safe to call directly on an in-memory candidate list too — the
 * low-filter candidate pass in `queries.ts` needs that same order applied
 * before it filters and pages, not just a SQL `orderBy`.
 */
export function buildStockOrderBy(sort: SortKey[]): Prisma.StockItemOrderByWithRelationInput[] {
  const order = (sort.length ? sort : STOCK_LIST_CONFIG.defaultSort)
    .filter((s) => STOCK_LIST_CONFIG.sortable.includes(s.key));
  return [
    ...order.map((s): Prisma.StockItemOrderByWithRelationInput => ({ [s.key]: s.dir })),
    { id: "asc" },
  ];
}
