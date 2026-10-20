import type { AssetClass } from "@prisma/client";
import { depreciate, monthLabel, type DepResult, type MonthIndex } from "./depreciation";
import { FIN_FILTERS, type FinFilter, type RegState } from "./registration";

/**
 * Phase 47 (spec §3): the pure half of Finance → Assets — life stage per row, the Life filter, the sort, the category
 * tiles' fold and this month's charge. Every figure comes from `depreciate` (Global Constraints); nothing here does its
 * own depreciation maths.
 */

/** The Life select: 6 months or less left; Fully depreciated; Not depreciating yet. Absent = Any. */
export type LifeFilter = "soon" | "full" | "notstarted";
export const LIFE_FILTERS: readonly LifeFilter[] = ["soon", "full", "notstarted"];

export function parseLife(raw: string | null | undefined): LifeFilter | null {
  return raw && (LIFE_FILTERS as readonly string[]).includes(raw) ? (raw as LifeFilter) : null;
}

/** The Sort select: book value high first (default); life used, most first; tag. */
export type FinanceSort = "book" | "life" | "tag";
export const FINANCE_SORTS: readonly FinanceSort[] = ["book", "life", "tag"];
export const DEFAULT_FINANCE_SORT: FinanceSort = "book";

export function parseSort(raw: string | null | undefined): FinanceSort {
  return raw && (FINANCE_SORTS as readonly string[]).includes(raw) ? (raw as FinanceSort) : DEFAULT_FINANCE_SORT;
}

/** Months left at or below which a depreciating asset reads "soon" (the Life filter's "6 months or less left"). */
export const SOON_MONTHS = 6;

export interface LifeStage {
  key: "notstarted" | "mid" | "soon" | "full";
  text: string;
  /** 0–100, rounded, for display; null when the asset is not depreciating */
  usedPct: number | null;
  /** months used ÷ life, unrounded (0–1): what the Life sort orders by; null when the asset is not depreciating */
  usedRatio: number | null;
}

/**
 * The table's Life used cell. `r` is the row's depreciation result: null when it has no cost or is not capitalised.
 * Months used are read back from the engine's own result (accumulated ÷ monthly), which is exactly the months counted
 * as of the result's month while the asset is still depreciating.
 */
export function lifeStage(r: DepResult | null, reg: RegState, notCapitalised: boolean, costC: number | null): LifeStage {
  const off = (text: string): LifeStage => ({ key: "notstarted", text, usedPct: null, usedRatio: null });
  if (notCapitalised) return off("Expensed, not depreciated");
  if (costC === null || r === null) return off("No cost yet");
  switch (r.state) {
    case "not-started":
      return off(reg !== "registered" || r.startMonth === null ? "Starts when approved" : `Starts ${monthLabel(r.startMonth)}`);
    case "no-policy": return off("No depreciation policy");
    case "bad-salvage": return off("Salvage is not below cost");
    case "fully-depreciated": return { key: "full", text: "Fully depreciated", usedPct: 100, usedRatio: 1 };
    case "depreciating": {
      const life = r.policy!.lifeMonths;
      const used = r.monthly ? Math.min(life, Math.round(r.accumulated / r.monthly)) : 0;
      const left = life - used;
      return {
        key: left <= SOON_MONTHS ? "soon" : "mid",
        text: `${used} / ${life} mo · ${left} left`,
        usedPct: Math.round((used / life) * 100),
        usedRatio: used / life,
      };
    }
  }
}

/**
 * The Life select. "Not depreciating yet" leaves out expensed (not-capitalised) assets: they never will, and they have
 * their own Not capitalised tab. Their life text stays "Expensed, not depreciated".
 */
export function matchesLife(row: { lifeStage: LifeStage; notCapitalised: boolean }, life: LifeFilter | null): boolean {
  if (life === null) return true;
  if (life === "notstarted" && row.notCapitalised) return false;
  return row.lifeStage.key === life;
}

/**
 * This month's charge: the engine's accumulated depreciation through `asOf` less that through the month before. Zero
 * for an asset that has not started, has no policy, or finished before this month; the remainder month of an asset
 * that finishes this month counts.
 */
export function monthCharge(r: DepResult, asOf: MonthIndex): number {
  if ((r.state !== "depreciating" && r.state !== "fully-depreciated") || r.startMonth === null || !r.policy) return 0;
  return depreciate(r.cost, r.startMonth, r.policy, asOf).accumulated - depreciate(r.cost, r.startMonth, r.policy, asOf - 1).accumulated;
}

interface Sortable { tag: string; result: { bookValue: number } | null; lifeStage: LifeStage }

const byTag = (a: Sortable, b: Sortable) => a.tag.localeCompare(b.tag);
/** Descending on a nullable number, nulls last. */
const descNullsLast = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);

/** A sorted copy. Ties fall back to tag, so a page never depends on the database's row order. */
export function sortFinanceRows<T extends Sortable>(rows: readonly T[], sort: FinanceSort): T[] {
  const cmp: (a: T, b: T) => number =
    sort === "tag" ? byTag
    : sort === "life" ? (a, b) => descNullsLast(a.lifeStage.usedRatio, b.lifeStage.usedRatio) || byTag(a, b)
    : (a, b) => descNullsLast(a.result?.bookValue ?? null, b.result?.bookValue ?? null) || byTag(a, b);
  return [...rows].sort(cmp);
}

export interface CategoryTile {
  id: string | "all" | "other";
  name: string;
  count: number;
  bookC: number;
  costC: number;
  on: boolean;
}

/**
 * Spec §3 item 3: "All categories" plus one tile per category that holds assets (an empty category gets none, so it can
 * never push a real one into Other). A class with fewer tiles than `columns` keeps them all; otherwise the tile count
 * is floored to a multiple of `columns` and the smallest categories (fewest assets, then least book value, then name)
 * fold into one "Other" tile, which therefore always holds at least two. Tiles are in that same order, largest first.
 * `rows` is one per asset. `selected` is `?category=`: an id, "other", or null for All. A folded id lights Other; an
 * id with no assets here, or "other" with nothing folded, lights All (the caller reads the selection back from `on`).
 */
export function categoryTiles(
  rows: ReadonlyArray<{ categoryId: string; categoryName: string; costC: number | null; bookC: number | null }>,
  selected: string | null,
  columns = 6,
): CategoryTile[] {
  const groups = new Map<string, { id: string; name: string; count: number; costC: number; bookC: number }>();
  const all = { count: 0, costC: 0, bookC: 0 };
  for (const r of rows) {
    const g = groups.get(r.categoryId) ?? { id: r.categoryId, name: r.categoryName, count: 0, costC: 0, bookC: 0 };
    g.count++; g.costC += r.costC ?? 0; g.bookC += r.bookC ?? 0;
    groups.set(r.categoryId, g);
    all.count++; all.costC += r.costC ?? 0; all.bookC += r.bookC ?? 0;
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || b.bookC - a.bookC || a.name.localeCompare(b.name));
  const tilesWanted = 1 + ranked.length;
  const fold = tilesWanted >= columns && tilesWanted % columns !== 0;
  const kept = fold ? ranked.slice(0, Math.floor(tilesWanted / columns) * columns - 2) : ranked;
  const folded = fold ? ranked.slice(kept.length) : [];
  const foldedIds = new Set(folded.map((g) => g.id));
  const sel = selected === "other" ? (folded.length ? selected : null) : selected !== null && groups.has(selected) ? selected : null;
  const tiles: CategoryTile[] = [
    { id: "all", name: "All categories", ...all, on: sel === null },
    ...kept.map((g) => ({ ...g, on: sel === g.id })),
  ];
  if (folded.length) {
    tiles.push({
      id: "other", name: "Other",
      count: folded.reduce((a, g) => a + g.count, 0),
      costC: folded.reduce((a, g) => a + g.costC, 0),
      bookC: folded.reduce((a, g) => a + g.bookC, 0),
      on: sel === "other" || (sel !== null && foldedIds.has(sel)),
    });
  }
  return tiles;
}

/** The finance-state tabs after All, in order; Waiting for IT is IT-only (spec §3 item 5). */
export function finTabs(cls: AssetClass): FinFilter[] {
  return FIN_FILTERS.filter((f) => cls === "IT" || f !== "awaiting-it");
}

/** In memory, the same test `finWhere(f)` makes in SQL. */
export function inFin(a: { reg: RegState; notCapitalised: boolean; costC: number | null }, f: FinFilter): boolean {
  switch (f) {
    case "approved": return a.reg === "registered" && !a.notCapitalised;
    case "not-capitalised": return a.reg === "registered" && a.notCapitalised;
    case "no-cost": return a.costC === null;
    default: return a.reg === f;
  }
}
