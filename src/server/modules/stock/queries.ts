import type { Prisma, StockMovementKind, StocktakeState } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { ListState } from "@/lib/url-state";
import { ENTITY_PAGE_SIZE, LOG_PAGE_SIZE, pageOf } from "@/lib/paging";
import { buildStockItemWhere, buildStockOrderBy } from "@/lib/stock-list";
import { isLow } from "@/lib/stock-balance";
import { EXPORT_CAP } from "@/lib/export-columns";
import type { FacetOption } from "@/server/modules/inventory/queries";
import type { ComboOption } from "@/components/patterns/entity-combobox";

export interface StockItemRow {
  id: string; code: string; name: string; category: string; unit: string; packSize: number | null;
  reorderLevel: number; balance: number; low: boolean; archived: boolean; lastMovementAt: Date | null;
}

interface CandidateBalance { id: string; reorderLevel: number; balance: number }
interface CandidateBalanceWithMovement extends CandidateBalance { lastMovementAt: Date | null }

/** One candidate pass + ONE groupBy sum, for the `low` count that ignores the current low toggle. */
async function candidateBalances(where: Prisma.StockItemWhereInput): Promise<CandidateBalance[]> {
  const candidates = await prisma.stockItem.findMany({ where, select: { id: true, reorderLevel: true } });
  if (!candidates.length) return [];
  const sums = await prisma.stockMovement.groupBy({
    by: ["itemId"], where: { itemId: { in: candidates.map((c) => c.id) } }, _sum: { quantity: true },
  });
  const balanceById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  return candidates.map((c) => ({ id: c.id, reorderLevel: c.reorderLevel, balance: balanceById.get(c.id) ?? 0 }));
}

/**
 * Same shape, plus `_max: { occurredAt }` in the SAME groupBy — the low-filter
 * branch's one query. `orderBy` (the employees-gaps pattern — `gapKeptIds` in
 * `src/server/modules/employees/queries.ts`) threads the requested sort
 * through the candidate select itself, so the kept-id order downstream
 * follows it instead of whatever order Postgres happens to return.
 */
async function candidateBalancesWithMovement(
  where: Prisma.StockItemWhereInput,
  orderBy: Prisma.StockItemOrderByWithRelationInput[] = [],
): Promise<CandidateBalanceWithMovement[]> {
  const candidates = await prisma.stockItem.findMany({ where, orderBy, select: { id: true, reorderLevel: true } });
  if (!candidates.length) return [];
  const sums = await prisma.stockMovement.groupBy({
    by: ["itemId"], where: { itemId: { in: candidates.map((c) => c.id) } },
    _sum: { quantity: true }, _max: { occurredAt: true },
  });
  const byId = new Map(sums.map((s) => [s.itemId, s]));
  return candidates.map((c) => {
    const s = byId.get(c.id);
    return { id: c.id, reorderLevel: c.reorderLevel, balance: s?._sum.quantity ?? 0, lastMovementAt: s?._max.occurredAt ?? null };
  });
}

/**
 * Spec §5.1. `low` is derived (balance vs reorderLevel), so it can never be a
 * SQL where — the low branch cuts a narrow candidate pass (id + reorderLevel),
 * computes every candidate's balance in ONE groupBy, keeps the low ones, and
 * pages THAT id list (the employees-gaps pattern). The plain branch counts
 * and pages in SQL first, then resolves balances for exactly the page's ids.
 * `lowCount` always reflects the where minus the low filter itself, so the
 * stat line ("N items · M below reorder level") never depends on whether the
 * toggle is on.
 */
export async function listStockItems(state: ListState): Promise<{
  rows: StockItemRow[]; total: number; page: number; pageCount: number;
  facets: { category: FacetOption[] }; lowCount: number;
}> {
  const where = buildStockItemWhere(state);
  const without = (facet: string): ListState => ({ ...state, filters: { ...state.filters, [facet]: [] } });
  const orderBy = buildStockOrderBy(state.sort);

  type ItemWithCategory = Prisma.StockItemGetPayload<{ include: { category: { select: { name: true } } } }>;
  let pg: ReturnType<typeof pageOf>;
  let itemRows: ItemWithCategory[];
  let balanceById: Map<string, number>;
  let lastMovementById: Map<string, Date | null>;
  // Set only on the low-filter branch: `low` is never part of the SQL where
  // (buildStockItemWhere ignores it), so `without("low")`'s candidate set
  // below is identical to the one already fetched here for paging — reuse it
  // instead of a second groupBy over the same rows.
  let lowFilterCandidates: CandidateBalance[] | null = null;

  if (state.filters.low?.includes("1")) {
    const candidates = await candidateBalancesWithMovement(where, orderBy);
    lowFilterCandidates = candidates;
    const kept = candidates.filter((c) => isLow(c.balance, c.reorderLevel));
    pg = pageOf(kept.length, state.page, ENTITY_PAGE_SIZE);
    const pageIds = kept.slice(pg.skip, pg.skip + pg.take).map((c) => c.id);
    const found = pageIds.length
      ? await prisma.stockItem.findMany({ where: { id: { in: pageIds } }, include: { category: { select: { name: true } } } })
      : [];
    const byId = new Map(found.map((r) => [r.id, r]));
    itemRows = pageIds.flatMap((id) => { const r = byId.get(id); return r ? [r] : []; });
    balanceById = new Map(candidates.map((c) => [c.id, c.balance]));
    lastMovementById = new Map(candidates.map((c) => [c.id, c.lastMovementAt]));
  } else {
    const total = await prisma.stockItem.count({ where });
    pg = pageOf(total, state.page, ENTITY_PAGE_SIZE);
    itemRows = await prisma.stockItem.findMany({
      where, orderBy, skip: pg.skip, take: pg.take, include: { category: { select: { name: true } } },
    });
    const ids = itemRows.map((r) => r.id);
    const sums = ids.length
      ? await prisma.stockMovement.groupBy({
          by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true }, _max: { occurredAt: true },
        })
      : [];
    balanceById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
    lastMovementById = new Map(sums.map((s) => [s.itemId, s._max.occurredAt ?? null]));
  }

  const [categoryG, lowCandidates] = await Promise.all([
    prisma.stockItem.groupBy({ by: ["categoryId"], where: buildStockItemWhere(without("category")), _count: true }),
    lowFilterCandidates ? Promise.resolve(lowFilterCandidates) : candidateBalances(buildStockItemWhere(without("low"))),
  ]);
  const catIds = categoryG.map((g) => g.categoryId);
  const categories = catIds.length
    ? await prisma.stockCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } })
    : [];
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));
  const facets: { category: FacetOption[] } = {
    category: categoryG
      .map((g) => ({ value: g.categoryId, label: catNameById.get(g.categoryId) ?? g.categoryId, count: g._count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
  const lowCount = lowCandidates.filter((c) => isLow(c.balance, c.reorderLevel)).length;

  return {
    total: pg.total, page: pg.page, pageCount: pg.pageCount, facets, lowCount,
    rows: itemRows.map((r): StockItemRow => {
      const balance = balanceById.get(r.id) ?? 0;
      return {
        id: r.id, code: r.code, name: r.name, category: r.category.name, unit: r.unit, packSize: r.packSize,
        reorderLevel: r.reorderLevel, balance, low: isLow(balance, r.reorderLevel),
        archived: r.archivedAt !== null, lastMovementAt: lastMovementById.get(r.id) ?? null,
      };
    }),
  };
}

export interface MovementRow {
  id: string; kind: StockMovementKind; quantity: number; occurredAt: Date;
  lot: { reference: string | null; supplier: string | null } | null;
  department: string | null; employee: string | null; reason: string | null;
  stocktake: { id: string; refNo: string } | null; actor: string;
}

export interface StockItemDetail {
  id: string; code: string; name: string; category: { id: string; name: string }; unit: string;
  packSize: number | null; reorderLevel: number; notes: string | null; archived: boolean; hasMovements: boolean;
  balance: number; low: boolean;
  movements: { rows: MovementRow[]; page: number; pageCount: number; total: number };
}

/** Spec §5.1: balance is one aggregate; movements page with lot/department/employee/actor/stocktake names resolved. */
export async function getStockItem(id: string, page: number): Promise<StockItemDetail | null> {
  const item = await prisma.stockItem.findUnique({
    where: { id },
    include: { category: { select: { id: true, name: true } }, _count: { select: { movements: true } } },
  });
  if (!item) return null;

  const agg = await prisma.stockMovement.aggregate({ where: { itemId: id }, _sum: { quantity: true } });
  const balance = agg._sum.quantity ?? 0;
  const pg = pageOf(item._count.movements, page, LOG_PAGE_SIZE);
  const movements = await prisma.stockMovement.findMany({
    where: { itemId: id },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: pg.skip, take: pg.take,
    include: {
      lot: { select: { reference: true, supplier: { select: { name: true } } } },
      department: { select: { name: true } },
      employee: { select: { name: true } },
      stocktake: { select: { id: true, refNo: true } },
      actor: { select: { name: true } },
    },
  });

  return {
    id: item.id, code: item.code, name: item.name, category: { id: item.category.id, name: item.category.name },
    unit: item.unit, packSize: item.packSize, reorderLevel: item.reorderLevel, notes: item.notes,
    archived: item.archivedAt !== null, hasMovements: item._count.movements > 0,
    balance, low: isLow(balance, item.reorderLevel),
    movements: {
      total: item._count.movements, page: pg.page, pageCount: pg.pageCount,
      rows: movements.map((m): MovementRow => ({
        id: m.id, kind: m.kind, quantity: m.quantity, occurredAt: m.occurredAt,
        lot: m.lot ? { reference: m.lot.reference, supplier: m.lot.supplier?.name ?? null } : null,
        department: m.department?.name ?? null, employee: m.employee?.name ?? null, reason: m.reason,
        stocktake: m.stocktake ? { id: m.stocktake.id, refNo: m.stocktake.refNo } : null,
        actor: m.actor.name,
      })),
    },
  };
}

/** The Receive/Issue item combobox — active items, code as label, name as sub (P-4). */
export async function stockItemOptions(): Promise<ComboOption[]> {
  const rows = await prisma.stockItem.findMany({
    where: { archivedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true },
  });
  return rows.map((r) => ({ value: r.id, label: r.code, sub: r.name }));
}

/** R3: a Map for server use — pages convert to a plain object before handing rows to client components. */
export async function stockItemBalances(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const sums = await prisma.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true } });
  return new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
}

export async function stockUnits(): Promise<string[]> {
  const rows = await prisma.stockItem.findMany({ distinct: ["unit"], select: { unit: true }, orderBy: { unit: "asc" }, take: 50 });
  return rows.map((r) => r.unit);
}

export async function activeStockCategories(): Promise<Array<{ id: string; name: string; prefix: string }>> {
  return prisma.stockCategory.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, prefix: true } });
}

export async function listStockCategories(): Promise<Array<{ id: string; name: string; prefix: string; nextNumber: number; items: number; archived: boolean }>> {
  const rows = await prisma.stockCategory.findMany({
    orderBy: { name: "asc" }, include: { _count: { select: { items: true } } },
  });
  return rows.map((c) => ({
    id: c.id, name: c.name, prefix: c.prefix, nextNumber: c.nextNumber, items: c._count.items, archived: c.archivedAt !== null,
  }));
}

export async function listStocktakes(page: number): Promise<{
  rows: Array<{ id: string; refNo: string; scope: string; state: StocktakeState; openedAt: Date; postedAt: Date | null; counted: number; total: number }>;
  page: number; pageCount: number; total: number;
}> {
  const total = await prisma.stocktake.count();
  const pg = pageOf(total, page, ENTITY_PAGE_SIZE);
  const rows = await prisma.stocktake.findMany({
    orderBy: [{ openedAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take,
    include: { category: { select: { name: true } }, lines: { select: { countedQty: true } } },
  });
  return {
    total, page: pg.page, pageCount: pg.pageCount,
    rows: rows.map((s) => ({
      id: s.id, refNo: s.refNo, scope: s.category?.name ?? "All", state: s.state,
      openedAt: s.openedAt, postedAt: s.postedAt,
      counted: s.lines.filter((l) => l.countedQty !== null).length, total: s.lines.length,
    })),
  };
}

export interface StocktakeDetail {
  id: string; refNo: string; scope: string; categoryId: string | null; state: StocktakeState;
  openedAt: Date; openedBy: string; postedAt: Date | null; postedBy: string | null; note: string | null;
  lines: Array<{ id: string; itemId: string; code: string; name: string; unit: string; bookQty: number; countedQty: number | null; currentQty: number }>;
}

/** `currentQty` comes from one groupBy over the line item ids — the review needs it, the count screen ignores it. */
export async function getStocktake(id: string): Promise<StocktakeDetail | null> {
  const st = await prisma.stocktake.findUnique({
    where: { id },
    include: {
      category: { select: { name: true } },
      openedBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      lines: { orderBy: { item: { code: "asc" } }, include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
    },
  });
  if (!st) return null;

  const ids = st.lines.map((l) => l.itemId);
  const sums = ids.length
    ? await prisma.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true } })
    : [];
  const currentById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));

  return {
    id: st.id, refNo: st.refNo, scope: st.category?.name ?? "All", categoryId: st.categoryId, state: st.state,
    openedAt: st.openedAt, openedBy: st.openedBy.name, postedAt: st.postedAt, postedBy: st.postedBy?.name ?? null,
    note: st.note,
    lines: st.lines.map((l) => ({
      id: l.id, itemId: l.itemId, code: l.item.code, name: l.item.name, unit: l.item.unit,
      bookQty: l.bookQty, countedQty: l.countedQty, currentQty: currentById.get(l.itemId) ?? 0,
    })),
  };
}

export interface StockExportRow {
  code: string; name: string; category: string; unit: string; packSize: number | null;
  reorderLevel: number; balance: number; low: string; lastMovementAt: Date | null;
}

/** The filtered list, unpaged; refuses over EXPORT_CAP before loading rows. Reuses the same low-branch helper listStockItems uses. */
export async function stockExportRows(state: ListState): Promise<{ rows: StockExportRow[] } | { over: number }> {
  const where = buildStockItemWhere(state);

  if (state.filters.low?.includes("1")) {
    const candidates = await candidateBalancesWithMovement(where);
    const kept = candidates.filter((c) => isLow(c.balance, c.reorderLevel));
    if (kept.length > EXPORT_CAP) return { over: kept.length };
    const ids = kept.map((c) => c.id);
    const items = ids.length
      ? await prisma.stockItem.findMany({ where: { id: { in: ids } }, include: { category: { select: { name: true } } } })
      : [];
    const byId = new Map(items.map((r) => [r.id, r]));
    const balanceById = new Map(kept.map((c) => [c.id, c.balance]));
    const lastById = new Map(kept.map((c) => [c.id, c.lastMovementAt]));
    return {
      rows: ids.flatMap((id): StockExportRow[] => {
        const r = byId.get(id);
        if (!r) return [];
        const balance = balanceById.get(id) ?? 0;
        return [{
          code: r.code, name: r.name, category: r.category.name, unit: r.unit, packSize: r.packSize,
          reorderLevel: r.reorderLevel, balance, low: isLow(balance, r.reorderLevel) ? "yes" : "",
          lastMovementAt: lastById.get(id) ?? null,
        }];
      }),
    };
  }

  const total = await prisma.stockItem.count({ where });
  if (total > EXPORT_CAP) return { over: total };
  const items = await prisma.stockItem.findMany({ where, orderBy: [{ code: "asc" }], include: { category: { select: { name: true } } } });
  const ids = items.map((r) => r.id);
  const sums = ids.length
    ? await prisma.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true }, _max: { occurredAt: true } })
    : [];
  const balanceById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  const lastById = new Map(sums.map((s) => [s.itemId, s._max.occurredAt ?? null]));
  return {
    rows: items.map((r): StockExportRow => {
      const balance = balanceById.get(r.id) ?? 0;
      return {
        code: r.code, name: r.name, category: r.category.name, unit: r.unit, packSize: r.packSize,
        reorderLevel: r.reorderLevel, balance, low: isLow(balance, r.reorderLevel) ? "yes" : "",
        lastMovementAt: lastById.get(r.id) ?? null,
      };
    }),
  };
}
