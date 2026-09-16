import type { Prisma, StockLotOrigin, StockMovementKind, StocktakeState } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { ListState } from "@/lib/url-state";
import { ENTITY_PAGE_SIZE, LOG_PAGE_SIZE, pageOf } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";
import { buildStockItemWhere, buildStockOrderBy } from "@/lib/stock-list";
import { isLow } from "@/lib/stock-balance";
import { EXPORT_CAP } from "@/lib/export-columns";
import { fmtDate, localDateISO } from "@/lib/format";
import {
  DEFAULT_EXPIRY_WINDOW, consumptionOrder, expiryLabel, isExpired, lotRemaining, onHand, type LotState,
} from "@/lib/stock-allocation";
import type { FacetOption } from "@/server/modules/inventory/queries";
import type { ComboOption } from "@/components/patterns/entity-combobox";

/** Spec §5.1/§6.4-6.5: the EXPIRING/EXPIRED pill's tri-state, shared by the item list, the item detail and the reports. */
export type ExpiringStatus = "expired" | "expiring" | null;

export interface StockItemRow {
  id: string; code: string; name: string; category: string; unit: string; packSize: number | null;
  reorderLevel: number; balance: number; low: boolean; archived: boolean; lastMovementAt: Date | null;
  expiring: ExpiringStatus;
}

interface CandidateBalance { id: string; reorderLevel: number; balance: number }
interface CandidateBalanceWithMovement extends CandidateBalance { lastMovementAt: Date | null }
interface CandidateExpiring extends CandidateBalance { expiring: ExpiringStatus }

const DAY_MS = 86_400_000;

/**
 * Spec §5.1 Step 2: "any open lot expired or expiring within
 * `DEFAULT_EXPIRY_WINDOW`" — the low path's pattern applied to expiry: one
 * narrow lot pass (only lots that even HAVE an expiry) plus one groupBy over
 * their allocations for `remaining`, never a query per item. Lots with no
 * expiry, or fully consumed, never affect the result.
 */
async function expiringStatusByItem(itemIds: string[], today: string): Promise<Map<string, ExpiringStatus>> {
  const result = new Map<string, ExpiringStatus>();
  if (!itemIds.length) return result;
  const lots = await prisma.stockLot.findMany({
    where: { itemId: { in: itemIds }, expiresAt: { not: null } },
    select: { id: true, itemId: true, expiresAt: true, quantity: true },
  });
  if (!lots.length) return result;
  const sums = await prisma.stockAllocation.groupBy({
    by: ["lotId"], where: { lotId: { in: lots.map((l) => l.id) } }, _sum: { quantity: true },
  });
  const allocatedById = new Map(sums.map((s) => [s.lotId, s._sum.quantity ?? 0]));
  const windowEndMs = Date.parse(`${today}T00:00:00.000Z`) + DEFAULT_EXPIRY_WINDOW * DAY_MS;
  for (const l of lots) {
    const remaining = lotRemaining(l.quantity, allocatedById.get(l.id) ?? 0);
    if (remaining <= 0) continue;
    const expired = isExpired(l.expiresAt, today);
    if (!expired && l.expiresAt!.getTime() > windowEndMs) continue;
    if (expired) result.set(l.itemId, "expired");
    else if (result.get(l.itemId) !== "expired") result.set(l.itemId, "expiring");
  }
  return result;
}

/** `candidateBalances` (ids + reorderLevel + balance) plus the same expiring status the paged branch computes, for `lowCount`/`expiringCount`'s "regardless of the toggle" pass. */
async function candidatesWithExpiring(where: Prisma.StockItemWhereInput, today: string): Promise<CandidateExpiring[]> {
  const candidates = await candidateBalances(where);
  if (!candidates.length) return [];
  const statusById = await expiringStatusByItem(candidates.map((c) => c.id), today);
  return candidates.map((c) => ({ ...c, expiring: statusById.get(c.id) ?? null }));
}

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
export async function listStockItems(state: ListState, today: string = localDateISO()): Promise<{
  rows: StockItemRow[]; total: number; page: number; pageCount: number;
  facets: { category: FacetOption[] }; lowCount: number; expiringCount: number;
}> {
  const where = buildStockItemWhere(state);
  const without = (facet: string): ListState => ({ ...state, filters: { ...state.filters, [facet]: [] } });
  const orderBy = buildStockOrderBy(state.sort);
  const lowOn = state.filters.low?.includes("1") ?? false;
  const expiringOn = state.filters.expiring?.includes("1") ?? false;

  type ItemWithCategory = Prisma.StockItemGetPayload<{ include: { category: { select: { name: true } } } }>;
  let pg: ReturnType<typeof pageOf>;
  let itemRows: ItemWithCategory[];
  let balanceById: Map<string, number>;
  let lastMovementById: Map<string, Date | null>;
  let expiringById: Map<string, ExpiringStatus>;
  // Set only when `low` or `expiring` narrows the candidate set below — both
  // are DERIVED (never part of the SQL where), so the balances and expiring
  // statuses this pass already resolved are exactly what lowCount/
  // expiringCount need too; reused instead of a second pass over the same
  // rows (extends the pre-existing `low`-only precedent).
  let derivedCandidates: Array<CandidateBalanceWithMovement & { expiring: ExpiringStatus }> | null = null;

  if (lowOn || expiringOn) {
    const candidates = await candidateBalancesWithMovement(where, orderBy);
    const statusById = await expiringStatusByItem(candidates.map((c) => c.id), today);
    const withExpiring = candidates.map((c) => ({ ...c, expiring: statusById.get(c.id) ?? null }));
    derivedCandidates = withExpiring;
    const kept = withExpiring.filter(
      (c) => (!lowOn || isLow(c.balance, c.reorderLevel)) && (!expiringOn || c.expiring !== null),
    );
    pg = pageOf(kept.length, state.page, ENTITY_PAGE_SIZE);
    const pageIds = kept.slice(pg.skip, pg.skip + pg.take).map((c) => c.id);
    const found = pageIds.length
      ? await prisma.stockItem.findMany({ where: { id: { in: pageIds } }, include: { category: { select: { name: true } } } })
      : [];
    const byId = new Map(found.map((r) => [r.id, r]));
    itemRows = pageIds.flatMap((id) => { const r = byId.get(id); return r ? [r] : []; });
    balanceById = new Map(withExpiring.map((c) => [c.id, c.balance]));
    lastMovementById = new Map(withExpiring.map((c) => [c.id, c.lastMovementAt]));
    expiringById = new Map(withExpiring.map((c) => [c.id, c.expiring]));
  } else {
    const { rows: snapshotRows, ...snapshotPg } = await pagedSnapshot(
      ENTITY_PAGE_SIZE,
      state.page,
      (tx) => tx.stockItem.count({ where }),
      (tx, pg) =>
        tx.stockItem.findMany({
          where, orderBy, skip: pg.skip, take: pg.take, include: { category: { select: { name: true } } },
        }),
    );
    pg = snapshotPg;
    itemRows = snapshotRows;
    const ids = itemRows.map((r) => r.id);
    const [sums, statusById] = await Promise.all([
      ids.length
        ? prisma.stockMovement.groupBy({
            by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true }, _max: { occurredAt: true },
          })
        : Promise.resolve([]),
      expiringStatusByItem(ids, today),
    ]);
    balanceById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
    lastMovementById = new Map(sums.map((s) => [s.itemId, s._max.occurredAt ?? null]));
    expiringById = statusById;
  }

  const [categoryG, derivedForCounts] = await Promise.all([
    prisma.stockItem.groupBy({ by: ["categoryId"], where: buildStockItemWhere(without("category")), _count: true }),
    derivedCandidates ? Promise.resolve(derivedCandidates) : candidatesWithExpiring(buildStockItemWhere(without("low")), today),
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
  const lowCount = derivedForCounts.filter((c) => isLow(c.balance, c.reorderLevel)).length;
  const expiringCount = derivedForCounts.filter((c) => c.expiring !== null).length;

  return {
    total: pg.total, page: pg.page, pageCount: pg.pageCount, facets, lowCount, expiringCount,
    rows: itemRows.map((r): StockItemRow => {
      const balance = balanceById.get(r.id) ?? 0;
      return {
        id: r.id, code: r.code, name: r.name, category: r.category.name, unit: r.unit, packSize: r.packSize,
        reorderLevel: r.reorderLevel, balance, low: isLow(balance, r.reorderLevel),
        archived: r.archivedAt !== null, lastMovementAt: lastMovementById.get(r.id) ?? null,
        expiring: expiringById.get(r.id) ?? null,
      };
    }),
  };
}

export interface MovementRow {
  id: string; kind: StockMovementKind; quantity: number; occurredAt: Date;
  lot: { reference: string | null; supplier: string | null } | null;
  department: string | null; employee: string | null; reason: string | null;
  stocktake: { id: string; refNo: string } | null; actor: string;
  /** Spec §6.4's Cost cell: outflows (ISSUE, negative ADJUSTMENT) sum allocations; inflows show the lot's own unit cost. Null when uncosted (all-uncosted outflow, or an uncosted lot's inflow). */
  cost: number | null;
  /** Only ever nonzero for an outflow drawing partly from uncosted lots — an inflow writes exactly one lot, so it can't be mixed. */
  uncostedUnits: number;
}

export interface StockItemDetail {
  id: string; code: string; name: string; category: { id: string; name: string }; unit: string;
  packSize: number | null; reorderLevel: number; notes: string | null; archived: boolean; hasMovements: boolean;
  balance: number; low: boolean;
  /** Spec §2.5/§6.4: balance minus expired remaining; FIFO value over costed open lots; open-lot units with no cost yet; EXPIRING/EXPIRED pill state. */
  available: number; onHandValue: number; uncostedUnits: number; expiring: ExpiringStatus;
  movements: { rows: MovementRow[]; page: number; pageCount: number; total: number };
}

/**
 * Spec §5.1: balance is one aggregate; movements page with lot/department/
 * employee/actor/stocktake names resolved. D2 adds: the item's open lots
 * (one findMany + one allocations groupBy) for `available`/`onHandValue`/
 * `uncostedUnits`/`expiring`, and the page's own outflow costs (one more
 * findMany over allocations for just the page's movement ids, joined to
 * their lots' `unitCost`) — never a query per row.
 */
export async function getStockItem(id: string, page: number, today: string = localDateISO()): Promise<StockItemDetail | null> {
  const item = await prisma.stockItem.findUnique({
    where: { id },
    include: { category: { select: { id: true, name: true } }, _count: { select: { movements: true } } },
  });
  if (!item) return null;

  const [agg, lots] = await Promise.all([
    prisma.stockMovement.aggregate({ where: { itemId: id }, _sum: { quantity: true } }),
    prisma.stockLot.findMany({
      where: { itemId: id },
      select: { id: true, quantity: true, unitCost: true, lotDate: true, expiresAt: true },
    }),
  ]);
  const balance = agg._sum.quantity ?? 0;

  const lotSums = lots.length
    ? await prisma.stockAllocation.groupBy({ by: ["lotId"], where: { lotId: { in: lots.map((l) => l.id) } }, _sum: { quantity: true } })
    : [];
  const allocatedByLot = new Map(lotSums.map((s) => [s.lotId, s._sum.quantity ?? 0]));
  const openLots: LotState[] = lots.flatMap((l): LotState[] => {
    const remaining = lotRemaining(l.quantity, allocatedByLot.get(l.id) ?? 0);
    if (remaining <= 0) return [];
    return [{ id: l.id, remaining, unitCost: l.unitCost === null ? null : Number(l.unitCost), lotDate: l.lotDate, expiresAt: l.expiresAt }];
  });
  const { uncostedUnits, value: onHandValue } = onHand(openLots);
  const expiredRemaining = openLots.filter((l) => isExpired(l.expiresAt, today)).reduce((sum, l) => sum + l.remaining, 0);
  const available = balance - expiredRemaining;
  const windowEndMs = Date.parse(`${today}T00:00:00.000Z`) + DEFAULT_EXPIRY_WINDOW * DAY_MS;
  let expiring: ExpiringStatus = null;
  for (const l of openLots) {
    if (!l.expiresAt) continue;
    if (isExpired(l.expiresAt, today)) { expiring = "expired"; break; }
    // Reaching here means the loop never hit the `break` above (in this or
    // any earlier iteration), so `expiring` can only be `null` or
    // "expiring" — never "expired" — at this point.
    if (l.expiresAt.getTime() <= windowEndMs) expiring = "expiring";
  }

  const pg = pageOf(item._count.movements, page, LOG_PAGE_SIZE);
  const movements = await prisma.stockMovement.findMany({
    where: { itemId: id },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: pg.skip, take: pg.take,
    include: {
      lot: { select: { reference: true, unitCost: true, supplier: { select: { name: true } } } },
      department: { select: { name: true } },
      employee: { select: { name: true } },
      stocktake: { select: { id: true, refNo: true } },
      actor: { select: { name: true } },
    },
  });

  // Only outflows (ISSUE, negative ADJUSTMENT) have allocations to sum; an
  // inflow's cost comes straight from the lot it created, already on `m.lot`.
  const outflowIds = movements.filter((m) => m.quantity < 0).map((m) => m.id);
  const allocs = outflowIds.length
    ? await prisma.stockAllocation.findMany({
        where: { movementId: { in: outflowIds } },
        select: { movementId: true, quantity: true, lot: { select: { unitCost: true } } },
      })
    : [];
  const costByMovement = new Map<string, { costedUnits: number; cost: number; uncostedUnits: number }>();
  for (const a of allocs) {
    const cur = costByMovement.get(a.movementId) ?? { costedUnits: 0, cost: 0, uncostedUnits: 0 };
    if (a.lot.unitCost !== null) {
      cur.cost += a.quantity * Number(a.lot.unitCost);
      cur.costedUnits += a.quantity;
    } else {
      cur.uncostedUnits += a.quantity;
    }
    costByMovement.set(a.movementId, cur);
  }

  return {
    id: item.id, code: item.code, name: item.name, category: { id: item.category.id, name: item.category.name },
    unit: item.unit, packSize: item.packSize, reorderLevel: item.reorderLevel, notes: item.notes,
    archived: item.archivedAt !== null, hasMovements: item._count.movements > 0,
    balance, low: isLow(balance, item.reorderLevel),
    available, onHandValue, uncostedUnits, expiring,
    movements: {
      total: item._count.movements, page: pg.page, pageCount: pg.pageCount,
      rows: movements.map((m): MovementRow => {
        const info = costByMovement.get(m.id);
        const cost = m.quantity < 0
          ? (info && info.costedUnits > 0 ? info.cost : null)
          : (m.lot && m.lot.unitCost !== null ? Number(m.lot.unitCost) : null);
        return {
          id: m.id, kind: m.kind, quantity: m.quantity, occurredAt: m.occurredAt,
          lot: m.lot ? { reference: m.lot.reference, supplier: m.lot.supplier?.name ?? null } : null,
          department: m.department?.name ?? null, employee: m.employee?.name ?? null, reason: m.reason,
          stocktake: m.stocktake ? { id: m.stocktake.id, refNo: m.stocktake.refNo } : null,
          actor: m.actor.name, cost, uncostedUnits: m.quantity < 0 ? (info?.uncostedUnits ?? 0) : 0,
        };
      }),
    },
  };
}

export interface StockLotDocumentRow {
  id: string; kind: string; fileName: string; uploadedBy: string; at: string; downloadHref: string;
}

export interface StockLotRow {
  id: string; origin: StockLotOrigin; lotDate: Date; expiresAt: Date | null;
  expiryLabel: string | null; expired: boolean; unitCost: number | null;
  quantity: number; remaining: number; value: number | null;
  reference: string | null; supplier: string | null; receivedBy: string;
  documents: StockLotDocumentRow[];
}

export interface ItemLots {
  open: StockLotRow[];
  closedCount: number;
}

/**
 * Spec §5.1/§6.4: open lots (remaining > 0) in `consumptionOrder(..., "first")`
 * order — expired lots (soonest-expired first) before the rest, same as a
 * write-off would draw them — each flagged `expired`; closed lots collapsed
 * to a count. One lot findMany (with its documents) plus one allocations
 * groupBy for the item's own lots — never a query per lot.
 */
export async function itemLots(itemId: string, today: string = localDateISO()): Promise<ItemLots> {
  const lots = await prisma.stockLot.findMany({
    where: { itemId },
    select: {
      id: true, origin: true, lotDate: true, expiresAt: true, unitCost: true, quantity: true, reference: true,
      supplier: { select: { name: true } },
      receivedBy: { select: { name: true } },
      documents: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { uploadedBy: { select: { name: true } } },
      },
    },
  });
  if (!lots.length) return { open: [], closedCount: 0 };

  const sums = await prisma.stockAllocation.groupBy({
    by: ["lotId"], where: { lotId: { in: lots.map((l) => l.id) } }, _sum: { quantity: true },
  });
  const allocatedById = new Map(sums.map((s) => [s.lotId, s._sum.quantity ?? 0]));

  const withRemaining = lots.map((l) => ({ ...l, remaining: lotRemaining(l.quantity, allocatedById.get(l.id) ?? 0) }));
  const open = withRemaining.filter((l) => l.remaining > 0);
  const closedCount = withRemaining.length - open.length;

  const order = consumptionOrder(
    open.map((l): LotState => ({
      id: l.id, remaining: l.remaining, unitCost: l.unitCost === null ? null : Number(l.unitCost),
      lotDate: l.lotDate, expiresAt: l.expiresAt,
    })),
    today, "first",
  );
  const byId = new Map(open.map((l) => [l.id, l]));

  return {
    closedCount,
    open: order.map((o): StockLotRow => {
      const l = byId.get(o.id)!;
      const unitCost = l.unitCost === null ? null : Number(l.unitCost);
      return {
        id: l.id, origin: l.origin, lotDate: l.lotDate, expiresAt: l.expiresAt,
        expiryLabel: l.expiresAt ? expiryLabel(l.expiresAt, today) : null,
        expired: isExpired(l.expiresAt, today),
        unitCost, quantity: l.quantity, remaining: o.remaining,
        value: unitCost === null ? null : unitCost * o.remaining,
        reference: l.reference, supplier: l.supplier?.name ?? null, receivedBy: l.receivedBy.name,
        documents: l.documents.map((d) => ({
          id: d.id, kind: d.kind, fileName: d.fileName, uploadedBy: d.uploadedBy?.name ?? "system",
          at: fmtDate(d.createdAt), downloadHref: `/stock/lots/${l.id}/documents/${d.id}/download`,
        })),
      };
    }),
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
  const { rows, total, page: pg, pageCount } = await pagedSnapshot(
    ENTITY_PAGE_SIZE,
    page,
    (tx) => tx.stocktake.count(),
    (tx, pg) =>
      tx.stocktake.findMany({
        orderBy: [{ openedAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take,
        include: { category: { select: { name: true } }, lines: { select: { countedQty: true } } },
      }),
  );
  return {
    total, page: pg, pageCount,
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
  /** I-4: the stocktake's OWN posted ADJUSTMENT movements, item id -> signed quantity. Always empty for OPEN (nothing posted yet) and for CANCELLED (nothing was ever written). A Map is fine here — this is server-only; the page converts it before any client boundary (R3/D-4). */
  adjustments: Map<string, number>;
}

/**
 * `currentQty` is a live balance — spec §5.1 says it matters "for OPEN ones"
 * only, since a POSTED/CANCELLED review is a frozen record, not today's
 * ledger (I-4); the groupBy that computes it is skipped entirely once the
 * stocktake has left OPEN, and `currentQty` is 0 (never read by the page in
 * that branch). `adjustments` instead reads the stocktake's own `movements`
 * relation — what it actually posted — for the non-OPEN review's
 * "Adjustment" column.
 */
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

  let currentById = new Map<string, number>();
  let adjustments = new Map<string, number>();
  if (st.state === "OPEN") {
    const ids = st.lines.map((l) => l.itemId);
    const sums = ids.length
      ? await prisma.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true } })
      : [];
    currentById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  } else {
    const posted = await prisma.stockMovement.findMany({
      where: { stocktakeId: st.id, kind: "ADJUSTMENT" }, select: { itemId: true, quantity: true },
    });
    adjustments = new Map(posted.map((m) => [m.itemId, m.quantity]));
  }

  return {
    id: st.id, refNo: st.refNo, scope: st.category?.name ?? "All", categoryId: st.categoryId, state: st.state,
    openedAt: st.openedAt, openedBy: st.openedBy.name, postedAt: st.postedAt, postedBy: st.postedBy?.name ?? null,
    note: st.note,
    lines: st.lines.map((l) => ({
      id: l.id, itemId: l.itemId, code: l.item.code, name: l.item.name, unit: l.item.unit,
      bookQty: l.bookQty, countedQty: l.countedQty, currentQty: currentById.get(l.itemId) ?? 0,
    })),
    adjustments,
  };
}

export interface StockExportRow {
  code: string; name: string; category: string; unit: string; packSize: number | null;
  reorderLevel: number; balance: number; low: string; lastMovementAt: Date | null;
  expiring: ExpiringStatus;
}

/**
 * The filtered list, unpaged; refuses over EXPORT_CAP before loading rows.
 * Reuses the same low/expiring candidate helpers `listStockItems` uses — the
 * `expiring` facet narrows the exported set exactly like `low` does.
 */
export async function stockExportRows(state: ListState, today: string = localDateISO()): Promise<{ rows: StockExportRow[] } | { over: number }> {
  const where = buildStockItemWhere(state);
  const lowOn = state.filters.low?.includes("1") ?? false;
  const expiringOn = state.filters.expiring?.includes("1") ?? false;

  if (lowOn || expiringOn) {
    const candidates = await candidateBalancesWithMovement(where, buildStockOrderBy(state.sort));
    const statusById = await expiringStatusByItem(candidates.map((c) => c.id), today);
    const kept = candidates.filter((c) => {
      const expiring = statusById.get(c.id) ?? null;
      return (!lowOn || isLow(c.balance, c.reorderLevel)) && (!expiringOn || expiring !== null);
    });
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
          lastMovementAt: lastById.get(id) ?? null, expiring: statusById.get(id) ?? null,
        }];
      }),
    };
  }

  const total = await prisma.stockItem.count({ where });
  if (total > EXPORT_CAP) return { over: total };
  const items = await prisma.stockItem.findMany({ where, orderBy: buildStockOrderBy(state.sort), include: { category: { select: { name: true } } } });
  const ids = items.map((r) => r.id);
  const [sums, statusById] = await Promise.all([
    ids.length
      ? prisma.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true }, _max: { occurredAt: true } })
      : Promise.resolve([]),
    expiringStatusByItem(ids, today),
  ]);
  const balanceById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  const lastById = new Map(sums.map((s) => [s.itemId, s._max.occurredAt ?? null]));
  return {
    rows: items.map((r): StockExportRow => {
      const balance = balanceById.get(r.id) ?? 0;
      return {
        code: r.code, name: r.name, category: r.category.name, unit: r.unit, packSize: r.packSize,
        reorderLevel: r.reorderLevel, balance, low: isLow(balance, r.reorderLevel) ? "yes" : "",
        lastMovementAt: lastById.get(r.id) ?? null, expiring: statusById.get(r.id) ?? null,
      };
    }),
  };
}

/**
 * Spec §0 decision 7 / §6.5: Purchasing Home's two tiles. `low` mirrors
 * `listStockItems`'s own `lowCount` over every active item (one candidate
 * pass, one balances groupBy); `expiringLots` counts LOTS (not items) still
 * open and expiring within `DEFAULT_EXPIRY_WINDOW` — the same population
 * `expiryReport(DEFAULT_EXPIRY_WINDOW)`'s "Expiring" block would show,
 * excluding already-expired lots (those are a different block, and a
 * different worry). Four queries total, as two independent parallel pairs.
 */
export async function stockHomeSignals(today: string): Promise<{ low: number; expiringLots: number }> {
  const [candidates, expiryLots] = await Promise.all([
    prisma.stockItem.findMany({ where: { archivedAt: null }, select: { id: true, reorderLevel: true } }),
    prisma.stockLot.findMany({
      where: { expiresAt: { not: null }, item: { archivedAt: null } },
      select: { id: true, expiresAt: true, quantity: true },
    }),
  ]);

  const [balanceSums, allocSums] = await Promise.all([
    candidates.length
      ? prisma.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: candidates.map((c) => c.id) } }, _sum: { quantity: true } })
      : Promise.resolve([]),
    expiryLots.length
      ? prisma.stockAllocation.groupBy({ by: ["lotId"], where: { lotId: { in: expiryLots.map((l) => l.id) } }, _sum: { quantity: true } })
      : Promise.resolve([]),
  ]);

  const balanceById = new Map(balanceSums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  const low = candidates.filter((c) => isLow(balanceById.get(c.id) ?? 0, c.reorderLevel)).length;

  const allocatedById = new Map(allocSums.map((s) => [s.lotId, s._sum.quantity ?? 0]));
  const windowEndMs = Date.parse(`${today}T00:00:00.000Z`) + DEFAULT_EXPIRY_WINDOW * DAY_MS;
  const expiringLots = expiryLots.filter((l) => {
    const remaining = lotRemaining(l.quantity, allocatedById.get(l.id) ?? 0);
    return remaining > 0 && !isExpired(l.expiresAt, today) && l.expiresAt!.getTime() <= windowEndMs;
  }).length;

  return { low, expiringLots };
}
