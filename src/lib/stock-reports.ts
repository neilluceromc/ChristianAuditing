import { DEFAULT_EXPIRY_WINDOW, EXPIRY_WINDOWS, isExpired } from "./stock-allocation";
import type { ListConfig } from "./url-state";

/**
 * `YYYY-MM` on the Asia/Manila calendar — the house pattern (`format.ts`'s
 * `localDateISO`/`isoDateFmt`), narrowed to year and month only, and cached
 * the same way every other `Intl.DateTimeFormat` in this app is (built once
 * at module load, not per call).
 */
const monthKeyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Manila" });

export function monthKey(date: Date): string {
  return monthKeyFmt.format(date);
}

/** Every `YYYY-MM` from `from`'s month through `to`'s month, inclusive. Both are `YYYY-MM-DD` strings. */
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  const keys: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/** The first day of the month five months back through today — the consumption report's default range. */
export function defaultConsumptionRange(today: string): { from: string; to: string } {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  let year = y;
  let month = m - 5;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: today };
}

export interface ConsumptionRowInput {
  department: string;
  monthKey: string;
  units: number;
  cost: number | null;
  uncostedUnits: number;
}

export interface ConsumptionCell {
  units: number;
  cost: number | null;
  uncostedUnits: number;
}

export interface ConsumptionGridRow {
  department: string;
  /** Keyed by `monthKey`; every month in `grid.months` has an entry, empty cells included. */
  cells: Record<string, ConsumptionCell>;
  total: ConsumptionCell;
}

export interface ConsumptionGrid {
  months: string[];
  rows: ConsumptionGridRow[];
  columnTotals: Record<string, ConsumptionCell>;
  grandTotal: ConsumptionCell;
}

const EMPTY_CELL: ConsumptionCell = { units: 0, cost: null, uncostedUnits: 0 };

/**
 * Spec §2.5: a cell's cost is null only when NOTHING in it is costed — the
 * same "null when costedUnits === 0" rule `allocate` uses for one movement,
 * extended to merging several rows into one cell (more than one item can
 * land in the same department/month). Treating `null` as "contributes zero
 * cost" rather than "resets the sum to null" is what makes `EMPTY_CELL` an
 * identity element: merging it into any cell returns that cell unchanged.
 */
function mergeCell(a: ConsumptionCell, b: ConsumptionCell): ConsumptionCell {
  const cost = a.cost === null && b.cost === null ? null : (a.cost ?? 0) + (b.cost ?? 0);
  return { units: a.units + b.units, cost, uncostedUnits: a.uncostedUnits + b.uncostedUnits };
}

/**
 * Spec §4.2. `rows` need not already be one row per department × month — an
 * item-level query result naming the same department/month more than once
 * is summed into one cell, so this stays correct whether the caller
 * pre-aggregates or not. `months` and `rows` (departments) are both derived
 * from what is actually present, sorted for a stable render; a caller that
 * wants to show a month with zero activity for every department (spec
 * §6.2's "columns are the months in the range") reconciles this grid's
 * `months` against its own `monthsBetween(from, to)` — this function has no
 * date-range parameter of its own to do that reconciliation itself.
 */
export function consumptionGrid(rows: ConsumptionRowInput[]): ConsumptionGrid {
  const months = [...new Set(rows.map((r) => r.monthKey))].sort();
  const departments = [...new Set(rows.map((r) => r.department))].sort();

  const gridRows: ConsumptionGridRow[] = departments.map((department) => {
    const cells: Record<string, ConsumptionCell> = {};
    for (const m of months) cells[m] = EMPTY_CELL;
    for (const r of rows) {
      if (r.department !== department) continue;
      cells[r.monthKey] = mergeCell(cells[r.monthKey] ?? EMPTY_CELL, { units: r.units, cost: r.cost, uncostedUnits: r.uncostedUnits });
    }
    const total = months.reduce((acc, m) => mergeCell(acc, cells[m]), EMPTY_CELL);
    return { department, cells, total };
  });

  const columnTotals: Record<string, ConsumptionCell> = {};
  for (const m of months) {
    columnTotals[m] = gridRows.reduce((acc, r) => mergeCell(acc, r.cells[m]), EMPTY_CELL);
  }
  const grandTotal = gridRows.reduce((acc, r) => mergeCell(acc, r.total), EMPTY_CELL);

  return { months, rows: gridRows, columnTotals, grandTotal };
}

/**
 * Spec §4.2. Generic over whatever lot shape the caller has (`queries.ts`'s
 * real rows carry far more than `expiresAt`) — the caller is trusted to hand
 * in only open lots (remaining > 0); "fully consumed lots never appear"
 * (spec §6.3) is the caller's own filter, not re-checked here. The window
 * boundary is inclusive: a lot expiring in exactly `windowDays` days is
 * "expiring within" that window.
 */
export function expiryBuckets<T extends { expiresAt: Date | null }>(
  lots: T[],
  today: string,
  windowDays: number,
): { expired: T[]; expiring: T[] } {
  const windowEndMs = Date.parse(`${today}T00:00:00.000Z`) + windowDays * 86_400_000;
  const expired: T[] = [];
  const expiring: T[] = [];
  for (const lot of lots) {
    if (!lot.expiresAt) continue;
    if (isExpired(lot.expiresAt, today)) expired.push(lot);
    else if (lot.expiresAt.getTime() <= windowEndMs) expiring.push(lot);
  }
  const byExpiry = (a: T, b: T) => a.expiresAt!.getTime() - b.expiresAt!.getTime();
  return { expired: expired.sort(byExpiry), expiring: expiring.sort(byExpiry) };
}

/**
 * P-4: report pages read `ListState` for the Category facet via the
 * existing `parseListState`, so `withFilter` and the toolbar pattern work
 * unchanged — a small config, no sort, distinct from `STOCK_LIST_CONFIG`
 * (`stock-list.ts`), which drives the item list's own facets and sorting.
 */
export const STOCK_REPORT_LIST_CONFIG: ListConfig = {
  // `uncosted` is the on-hand report's toggle (`?uncosted=1`); parseListState
  // copies a query param into `state.filters` only for a listed facet (Task 5
  // review), so it must be named here or the toggle is dead.
  facets: ["category", "uncosted"],
  sortable: [],
  defaultSort: [],
};

/**
 * The instants that bound a range of Asia/Manila calendar days: `start` is
 * `from` at local midnight, `endExclusive` is the day AFTER `to` at local
 * midnight, so `occurredAt >= start && occurredAt < endExclusive` takes every
 * movement stamped on those days. Issues, adjustments and write-offs carry
 * the real transaction time (only receipts are dated to UTC midnight), so a
 * `[from 00:00Z, to 00:00Z]` window would drop everything after 08:00 Manila
 * on the last day — the Task 5 review's Critical.
 */
export function manilaDayBounds(from: string, to: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${from}T00:00:00+08:00`);
  const toStart = new Date(`${to}T00:00:00+08:00`);
  const endExclusive = new Date(toStart.getTime() + 86_400_000);
  return { start, endExclusive };
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * P-4: `from`/`to` are plain query params, not part of `ListState` — parsed
 * here rather than by `parseListState` (which only knows facets/sort/page).
 * A missing or malformed side falls back to `defaultConsumptionRange`'s
 * corresponding side; a `to` before `from` is clamped up to `from` rather
 * than refused outright — there is no user-facing form to reject on, only a
 * URL a person can hand-edit, and an empty range reads more like a mistake
 * than a report worth erroring on.
 */
export function parseReportRange(sp: URLSearchParams, today: string): { from: string; to: string } {
  const fallback = defaultConsumptionRange(today);
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  const from = fromRaw && DATE_SHAPE.test(fromRaw) ? fromRaw : fallback.from;
  const to = toRaw && DATE_SHAPE.test(toRaw) ? toRaw : fallback.to;
  return { from, to: to < from ? from : to };
}

/** P-4: `?days=` — one of `EXPIRY_WINDOWS`, else `DEFAULT_EXPIRY_WINDOW`. */
export function parseExpiryWindow(sp: URLSearchParams): number {
  const n = Number(sp.get("days"));
  return (EXPIRY_WINDOWS as readonly number[]).includes(n) ? n : DEFAULT_EXPIRY_WINDOW;
}
