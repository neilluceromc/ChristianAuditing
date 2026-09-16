import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { ListState } from "@/lib/url-state";
import { localDateISO } from "@/lib/format";
import { DEFAULT_EXPIRY_WINDOW, expiryLabel, isExpired, lotRemaining, onHand, type LotState } from "@/lib/stock-allocation";
import {
  consumptionGrid, expiryBuckets, monthKey, monthsBetween,
  type ConsumptionCell, type ConsumptionGrid,
} from "@/lib/stock-reports";
import { EXPORT_CAP } from "@/lib/export-columns";
import type { ConsumptionExportRow, ExpiryExportRow, OnHandExportRow } from "@/lib/export-columns";
import type { FacetOption } from "@/server/modules/inventory/queries";
import type { ExpiringStatus } from "@/server/modules/stock/queries";

/** P-4: a report page's Category facet with no other filter active — the same shape `parseListState(sp, STOCK_REPORT_LIST_CONFIG)` produces, usable as a default for a standalone call (the smoke test, or a report route with no query string yet). */
const EMPTY_LIST_STATE: ListState = { q: "", page: 1, sort: [], filters: {} };

const DAY_MS = 86_400_000;

/** The three reports share one Category facet shape, always over ACTIVE items regardless of any filter already chosen — the same "without this facet itself" rule `listStockItems` uses for its own category counts. */
async function categoryFacets(): Promise<FacetOption[]> {
  const categoryG = await prisma.stockItem.groupBy({ by: ["categoryId"], where: { archivedAt: null }, _count: true });
  const catIds = categoryG.map((g) => g.categoryId);
  const categories = catIds.length
    ? await prisma.stockCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } })
    : [];
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));
  return categoryG
    .map((g) => ({ value: g.categoryId, label: catNameById.get(g.categoryId) ?? g.categoryId, count: g._count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// On hand and value (spec §6.1)
// ---------------------------------------------------------------------------

export interface OnHandItemRow {
  id: string; code: string; name: string; unit: string; balance: number; openLots: number;
  costedUnits: number; uncostedUnits: number; valueOnHand: number | null;
  oldestLot: Date | null; nearestExpiry: Date | null; expiring: ExpiringStatus;
}

interface OnHandRow extends OnHandItemRow { categoryId: string; categoryName: string }

export interface OnHandCategoryGroup {
  categoryId: string; categoryName: string; items: OnHandItemRow[];
  subtotal: { units: number; uncostedUnits: number; value: number };
}

export interface OnHandReport {
  groups: OnHandCategoryGroup[];
  grandTotal: { units: number; uncostedUnits: number; value: number };
  facets: { category: FacetOption[] };
}

/**
 * One item pass (active items, optionally narrowed by category), one lot
 * pass for all of them, one allocations groupBy for remaining — three
 * queries regardless of how many items or lots exist. `valueOnHand`/
 * `oldestLot`/`nearestExpiry` are null for an item with no open lots at all
 * (export-columns.ts's `OnHandExportRow` comment).
 */
async function computeOnHandRows(state: ListState, today: string): Promise<OnHandRow[]> {
  const where: Prisma.StockItemWhereInput = { archivedAt: null };
  if (state.filters.category?.length) where.categoryId = { in: state.filters.category };

  const items = await prisma.stockItem.findMany({
    where, orderBy: [{ code: "asc" }],
    select: { id: true, code: true, name: true, unit: true, category: { select: { id: true, name: true } } },
  });
  if (!items.length) return [];

  const itemIds = items.map((i) => i.id);
  const lots = await prisma.stockLot.findMany({
    where: { itemId: { in: itemIds } },
    select: { id: true, itemId: true, unitCost: true, quantity: true, lotDate: true, expiresAt: true },
  });
  const sums = lots.length
    ? await prisma.stockAllocation.groupBy({ by: ["lotId"], where: { lotId: { in: lots.map((l) => l.id) } }, _sum: { quantity: true } })
    : [];
  const allocatedById = new Map(sums.map((s) => [s.lotId, s._sum.quantity ?? 0]));

  const openByItem = new Map<string, LotState[]>();
  for (const l of lots) {
    const remaining = lotRemaining(l.quantity, allocatedById.get(l.id) ?? 0);
    if (remaining <= 0) continue;
    const arr = openByItem.get(l.itemId) ?? [];
    arr.push({ id: l.id, remaining, unitCost: l.unitCost === null ? null : Number(l.unitCost), lotDate: l.lotDate, expiresAt: l.expiresAt });
    openByItem.set(l.itemId, arr);
  }

  const windowEndMs = Date.parse(`${today}T00:00:00.000Z`) + DEFAULT_EXPIRY_WINDOW * DAY_MS;
  return items.map((item): OnHandRow => {
    const open = openByItem.get(item.id) ?? [];
    const { units, costedUnits, uncostedUnits, value } = onHand(open);
    let oldestLot: Date | null = null;
    let nearestExpiry: Date | null = null;
    let expiring: ExpiringStatus = null;
    for (const l of open) {
      if (oldestLot === null || l.lotDate.getTime() < oldestLot.getTime()) oldestLot = l.lotDate;
      if (!l.expiresAt) continue;
      if (nearestExpiry === null || l.expiresAt.getTime() < nearestExpiry.getTime()) nearestExpiry = l.expiresAt;
      if (isExpired(l.expiresAt, today)) expiring = "expired";
      else if (expiring !== "expired" && l.expiresAt.getTime() <= windowEndMs) expiring = "expiring";
    }
    return {
      id: item.id, code: item.code, name: item.name, unit: item.unit,
      categoryId: item.category.id, categoryName: item.category.name,
      balance: units, openLots: open.length, costedUnits, uncostedUnits,
      valueOnHand: open.length === 0 ? null : value, oldestLot, nearestExpiry, expiring,
    };
  });
}

/** Spec §5.1/§6.1: category groups with subtotals and a grand total; `state.filters.uncosted` (`["1"]`) narrows to items still carrying uncosted stock. Two round trips: `computeOnHandRows` (3 queries) and `categoryFacets` (2 queries), run together. */
export async function onHandReport(state: ListState = EMPTY_LIST_STATE): Promise<OnHandReport> {
  const today = localDateISO();
  const uncostedOnly = state.filters.uncosted?.includes("1") ?? false;
  const [rows, facetOptions] = await Promise.all([computeOnHandRows(state, today), categoryFacets()]);
  const filtered = uncostedOnly ? rows.filter((r) => r.uncostedUnits > 0) : rows;

  const byCategory = new Map<string, OnHandRow[]>();
  for (const r of filtered) {
    const arr = byCategory.get(r.categoryId) ?? [];
    arr.push(r);
    byCategory.set(r.categoryId, arr);
  }
  const groups: OnHandCategoryGroup[] = [...byCategory.values()]
    .map((items): OnHandCategoryGroup => ({
      categoryId: items[0].categoryId, categoryName: items[0].categoryName, items,
      subtotal: {
        units: items.reduce((s, r) => s + r.balance, 0),
        uncostedUnits: items.reduce((s, r) => s + r.uncostedUnits, 0),
        value: items.reduce((s, r) => s + (r.valueOnHand ?? 0), 0),
      },
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));

  const grandTotal = {
    units: filtered.reduce((s, r) => s + r.balance, 0),
    uncostedUnits: filtered.reduce((s, r) => s + r.uncostedUnits, 0),
    value: filtered.reduce((s, r) => s + (r.valueOnHand ?? 0), 0),
  };

  return { groups, grandTotal, facets: { category: facetOptions } };
}

/** The flat twin of `onHandReport` — one row per item, `EXPORT_CAP`-checked on the same (possibly uncosted-only) filtered set the screen shows. */
export async function onHandExportRows(state: ListState = EMPTY_LIST_STATE): Promise<{ rows: OnHandExportRow[] } | { over: number }> {
  const today = localDateISO();
  const uncostedOnly = state.filters.uncosted?.includes("1") ?? false;
  const rows = await computeOnHandRows(state, today);
  const filtered = uncostedOnly ? rows.filter((r) => r.uncostedUnits > 0) : rows;
  if (filtered.length > EXPORT_CAP) return { over: filtered.length };
  return {
    rows: filtered.map((r): OnHandExportRow => ({
      code: r.code, name: r.name, category: r.categoryName, unit: r.unit, balance: r.balance,
      openLots: r.openLots, costedUnits: r.costedUnits, uncostedUnits: r.uncostedUnits,
      valueOnHand: r.valueOnHand, oldestLot: r.oldestLot, nearestExpiry: r.nearestExpiry,
    })),
  };
}

// ---------------------------------------------------------------------------
// Consumption by department and month (spec §6.2)
// ---------------------------------------------------------------------------

interface ConsumptionAggRow {
  department: string; monthKey: string; categoryName: string; code: string; item: string;
  units: number; cost: number | null; uncostedUnits: number;
}

/**
 * ISSUE movements only (a write-off or a stocktake correction is not
 * "consumption" by a department) in `[from, to]` inclusive, joined to
 * department/item/category, pre-aggregated to one row per department ×
 * month × item — the same grain the export sheet wants, and exactly what
 * `consumptionGrid` needs once flattened to department × month (its own
 * `mergeCell` folds several items into one cell). Two queries regardless of
 * range length: the movements themselves, then one allocations findMany
 * (joined to lot cost) for just those movement ids.
 */
async function computeConsumptionRows(range: { from: string; to: string }, state: ListState): Promise<ConsumptionAggRow[]> {
  const fromDate = new Date(`${range.from}T00:00:00Z`);
  const toDate = new Date(`${range.to}T00:00:00Z`);
  const where: Prisma.StockMovementWhereInput = { kind: "ISSUE", occurredAt: { gte: fromDate, lte: toDate } };
  if (state.filters.category?.length) where.item = { categoryId: { in: state.filters.category } };

  const movements = await prisma.stockMovement.findMany({
    where,
    select: {
      id: true, quantity: true, occurredAt: true,
      department: { select: { name: true } },
      item: { select: { id: true, code: true, name: true, category: { select: { name: true } } } },
    },
  });
  if (!movements.length) return [];

  const allocs = await prisma.stockAllocation.findMany({
    where: { movementId: { in: movements.map((m) => m.id) } },
    select: { movementId: true, quantity: true, lot: { select: { unitCost: true } } },
  });
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

  const grouped = new Map<string, ConsumptionAggRow>();
  for (const m of movements) {
    const department = m.department?.name ?? "Unassigned";
    const mk = monthKey(m.occurredAt);
    const key = `${department}|${mk}|${m.item.id}`;
    const info = costByMovement.get(m.id);
    const cost = info && info.costedUnits > 0 ? info.cost : null;
    const uncostedUnits = info?.uncostedUnits ?? 0;
    const units = Math.abs(m.quantity);
    const existing = grouped.get(key);
    if (existing) {
      existing.units += units;
      existing.cost = existing.cost === null && cost === null ? null : (existing.cost ?? 0) + (cost ?? 0);
      existing.uncostedUnits += uncostedUnits;
    } else {
      grouped.set(key, {
        department, monthKey: mk, categoryName: m.item.category.name, code: m.item.code, item: m.item.name,
        units, cost, uncostedUnits,
      });
    }
  }
  return [...grouped.values()];
}

const EMPTY_CONSUMPTION_CELL: ConsumptionCell = { units: 0, cost: null, uncostedUnits: 0 };

/** Spec §6.2: "columns are the months in the range" — `consumptionGrid` only knows the months rows actually mention, so a month with zero activity anywhere is added here as an all-zero column (its own doc comment asks the caller to do exactly this). */
function reconcileMonths(grid: ConsumptionGrid, fullMonths: string[]): ConsumptionGrid {
  const rows = grid.rows.map((r) => ({
    ...r,
    cells: Object.fromEntries(fullMonths.map((m) => [m, r.cells[m] ?? EMPTY_CONSUMPTION_CELL])),
  }));
  const columnTotals = Object.fromEntries(fullMonths.map((m) => [m, grid.columnTotals[m] ?? EMPTY_CONSUMPTION_CELL]));
  return { months: fullMonths, rows, columnTotals, grandTotal: grid.grandTotal };
}

export interface ConsumptionReport {
  grid: ConsumptionGrid;
  facets: { category: FacetOption[] };
}

export async function consumptionReport(range: { from: string; to: string }, state: ListState = EMPTY_LIST_STATE): Promise<ConsumptionReport> {
  const [rows, facetOptions] = await Promise.all([computeConsumptionRows(range, state), categoryFacets()]);
  const grid = consumptionGrid(rows.map((r) => ({ department: r.department, monthKey: r.monthKey, units: r.units, cost: r.cost, uncostedUnits: r.uncostedUnits })));
  return { grid: reconcileMonths(grid, monthsBetween(range.from, range.to)), facets: { category: facetOptions } };
}

/** The flat twin — one row per department × month × item, `EXPORT_CAP`-checked before the sheet is built. */
export async function consumptionExportRows(range: { from: string; to: string }, state: ListState = EMPTY_LIST_STATE): Promise<{ rows: ConsumptionExportRow[] } | { over: number }> {
  const rows = await computeConsumptionRows(range, state);
  if (rows.length > EXPORT_CAP) return { over: rows.length };
  return {
    rows: rows
      .slice()
      .sort((a, b) => a.department.localeCompare(b.department) || a.monthKey.localeCompare(b.monthKey) || a.code.localeCompare(b.code))
      .map((r): ConsumptionExportRow => ({
        department: r.department, month: r.monthKey, category: r.categoryName, code: r.code, item: r.item,
        units: r.units, cost: r.cost, uncostedUnits: r.uncostedUnits,
      })),
  };
}

// ---------------------------------------------------------------------------
// Expiring and expired lots (spec §6.3)
// ---------------------------------------------------------------------------

export interface ExpiryLotRow {
  id: string; itemId: string; code: string; item: string; lotDate: Date; expiresAt: Date;
  reference: string | null; supplier: string | null; remaining: number;
  unitCost: number | null; valueAtRisk: number | null;
}

/** Lots with an expiry set and units still remaining, across every item (optionally narrowed by category) — one lot findMany plus one allocations groupBy, never a query per lot. */
async function computeExpiryLots(state: ListState): Promise<ExpiryLotRow[]> {
  const where: Prisma.StockLotWhereInput = { expiresAt: { not: null } };
  if (state.filters.category?.length) where.item = { categoryId: { in: state.filters.category } };

  const lots = await prisma.stockLot.findMany({
    where,
    select: {
      id: true, itemId: true, lotDate: true, expiresAt: true, reference: true, unitCost: true, quantity: true,
      supplier: { select: { name: true } },
      item: { select: { code: true, name: true } },
    },
  });
  if (!lots.length) return [];

  const sums = await prisma.stockAllocation.groupBy({
    by: ["lotId"], where: { lotId: { in: lots.map((l) => l.id) } }, _sum: { quantity: true },
  });
  const allocatedById = new Map(sums.map((s) => [s.lotId, s._sum.quantity ?? 0]));

  return lots.flatMap((l): ExpiryLotRow[] => {
    const remaining = lotRemaining(l.quantity, allocatedById.get(l.id) ?? 0);
    if (remaining <= 0) return [];
    const unitCost = l.unitCost === null ? null : Number(l.unitCost);
    return [{
      id: l.id, itemId: l.itemId, code: l.item.code, item: l.item.name, lotDate: l.lotDate, expiresAt: l.expiresAt!,
      reference: l.reference, supplier: l.supplier?.name ?? null, remaining, unitCost,
      valueAtRisk: unitCost === null ? null : unitCost * remaining,
    }];
  });
}

export interface ExpiryReport {
  expired: ExpiryLotRow[];
  expiring: ExpiryLotRow[];
  facets: { category: FacetOption[] };
}

/** Spec §5.1/§6.3: `expiryBuckets` splits the window's open, dated lots into Expired / Expiring within N days. Two round trips: `computeExpiryLots` (2 queries) and `categoryFacets` (2 queries), run together. */
export async function expiryReport(windowDays: number, state: ListState = EMPTY_LIST_STATE): Promise<ExpiryReport> {
  const today = localDateISO();
  const [lots, facetOptions] = await Promise.all([computeExpiryLots(state), categoryFacets()]);
  const { expired, expiring } = expiryBuckets(lots, today, windowDays);
  return { expired, expiring, facets: { category: facetOptions } };
}

/** The flat twin of both blocks, told apart by `status`; `EXPORT_CAP`-checked on their combined count. */
export async function expiryExportRows(windowDays: number, state: ListState = EMPTY_LIST_STATE): Promise<{ rows: ExpiryExportRow[] } | { over: number }> {
  const today = localDateISO();
  const lots = await computeExpiryLots(state);
  const { expired, expiring } = expiryBuckets(lots, today, windowDays);
  const all = [
    ...expired.map((l) => ({ l, status: "Expired" as const })),
    ...expiring.map((l) => ({ l, status: "Expiring" as const })),
  ];
  if (all.length > EXPORT_CAP) return { over: all.length };
  return {
    rows: all.map(({ l, status }): ExpiryExportRow => ({
      status, code: l.code, item: l.item, lotDate: l.lotDate, reference: l.reference, supplier: l.supplier,
      expires: l.expiresAt, days: expiryLabel(l.expiresAt, today), remaining: l.remaining, unitCost: l.unitCost, valueAtRisk: l.valueAtRisk,
    })),
  };
}
