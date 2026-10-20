import { Prisma, type AssetClass, type AssetStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { asOfMonth, monthLabel } from "@/lib/depreciation";
import { ENTITY_PAGE_SIZE, PER_PAGE_OPTIONS, pageOf } from "@/lib/paging";
import { finWhere, regWhere, type FinFilter } from "@/lib/registration";
import { TILE_SPECS } from "@/lib/inventory-tiles";
import {
  categoryTiles, finTabs, inFin, lifeStage, matchesLife, monthCharge, sortRows,
  type CategoryTile, type FinanceSort, type LifeFilter, type LifeStage,
} from "@/lib/finance-list";
import { depRows, type DepAssetRow } from "./depreciation-queries";

export interface FinanceListParams {
  cls: AssetClass; status: AssetStatus | null; fin: FinFilter | null; q: string; page: number;
  /** Phase 47 (spec §3): `?category=` — a category id of the class, or "other" (every category not on its own tile) */
  category?: string | null;
  life?: LifeFilter | null;
  sort?: FinanceSort;
  /** rows per page, one of PER_PAGE_OPTIONS; anything else is the default */
  per?: number;
}

/** Phase 35 (spec 4.1): every asset of the class — no cost filter and no IT gate. */
export function financeListWhere(p: Pick<FinanceListParams, "cls" | "status" | "q">): Prisma.AssetWhereInput {
  const q = p.q.trim();
  return {
    cls: p.cls,
    ...(p.status ? { status: p.status } : {}),
    ...(q ? {
      OR: [
        { tag: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
        { serial: { contains: q, mode: "insensitive" } },
        { assignee: { name: { contains: q, mode: "insensitive" } } },
      ],
    } : {}),
  };
}

/**
 * Phase 46: `/finance/assets?fin=<f>` (with `cls=PURCHASING` for that class) and nothing else filtered — the page's own
 * registration-chip count for that filter (financeAssets counts the same rows in memory with `inFin`, which mirrors finWhere). The Finance
 * overview's To confirm tile, its snapshot and the sidebar's To confirm views all count this where.
 */
export function financeViewWhere(cls: AssetClass, fin: FinFilter): Prisma.AssetWhereInput {
  return { AND: [financeListWhere({ cls, status: null, q: "" }), finWhere(fin)] };
}

export type FinanceRow = DepAssetRow & { lifeStage: LifeStage };

/**
 * Spec §3 item 2: the four money cards. Cost, accumulated and book value follow the totals footer's rule (capitalised
 * rows); `costedCount` is how many assets those cover ("N assets with a cost"), `count` every asset in scope.
 */
export interface FinanceKpis {
  costC: number; accC: number; bookC: number; monthC: number;
  count: number; costedCount: number; depreciatingCount: number;
}

export interface FinanceAssetsResult {
  rows: FinanceRow[]; total: number; page: number; pageCount: number; per: number;
  /** the category filter in force: a category id with assets in the class, "other", or null (anything else reads as null) */
  category: string | null;
  /** that category's name ("Other" for the folded tile), for the Category select and the filter chip; null for All */
  categoryLabel: string | null;
  kpis: FinanceKpis;
  categoryTiles: CategoryTile[];
  statusTiles: Array<{ status: AssetStatus; count: number; bookC: number }>;
  /** All, then the class's finance-state tabs in order (no awaiting-it on Purchasing) */
  finCounts: Array<{ key: FinFilter | "all"; count: number }>;
  /** every matching row, across pages: the toolbar's "N assets shown" and the table's totals row (capitalised rows' figures) */
  shown: { count: number; costedCount: number; costC: number; accC: number; bookC: number };
  /** the month "as of today" counts through, e.g. "Oct 2026" */
  asOfLabel: string;
}

type Computed = Omit<FinanceAssetsResult, "rows" | "total" | "page" | "pageCount" | "per"> & { sorted: FinanceRow[] };

/**
 * Phase 47 (spec §3): Finance's register of one class. ONE read of the class's assets (depRows) — plus, with a search,
 * one id-only read so the search stays SQL's — the category tiles computed once, and every other aggregate in one
 * in-memory pass:
 * - category tiles: the class (folded to whole rows; "other" means every category not on its own tile);
 * - status tiles: the class and category;
 * - money totals: the class, category and status (the totals footer's rule: capitalised rows' depreciation results);
 * - finance-state counts: those plus search and life (not the finance state itself);
 * - the rows and `shown`: every filter. Sorted (spec ruling: book value high first replaces To review first);
 *   `financeAssets` pages them by `per`, `financeExportRows` returns them all.
 */
async function computeFinance(p: FinanceListParams, now: Date): Promise<Computed> {
  const asOf = asOfMonth(now);
  const q = p.q.trim();
  const [classRows, hits] = await Promise.all([
    depRows({ cls: p.cls }, now),
    q ? prisma.asset.findMany({ where: financeListWhere({ cls: p.cls, status: null, q }), select: { id: true } }) : null,
  ]);
  const rows: FinanceRow[] = classRows.map((r) => ({ ...r, lifeStage: lifeStage(r.result, r.reg, r.notCapitalised, r.costC, r.category) }));
  const found = hits ? new Set(hits.map((h) => h.id)) : null;

  const tileInput = rows.map((r) => ({ categoryId: r.categoryId, categoryName: r.category, costC: r.result?.cost ?? null, bookC: r.result?.bookValue ?? null }));
  // categoryTiles validates the selection: All is lit for an unknown id, or for "other" when nothing folds.
  const tiles = categoryTiles(tileInput, p.category ?? null, 6);
  const kept = new Set(tiles.filter((t) => t.id !== "all" && t.id !== "other").map((t) => t.id));
  const category = tiles[0].on ? null : (p.category ?? null);
  // a folded category keeps its own name (Task 3 review: the Category select shows it by name, Other's tile is lit)
  const categoryLabel = category === null ? null
    : category === "other" ? "Other"
    : (rows.find((r) => r.categoryId === category)?.category ?? null);
  const inCategory = (r: FinanceRow) => category === null || (category === "other" ? !kept.has(r.categoryId) : r.categoryId === category);

  const tabs = finTabs(p.cls);
  const fin = p.fin && tabs.includes(p.fin) ? p.fin : null;
  const life = p.life ?? null;
  const kpis: FinanceKpis = { costC: 0, accC: 0, bookC: 0, monthC: 0, count: 0, costedCount: 0, depreciatingCount: 0 };
  const statusTiles = TILE_SPECS[p.cls].flatMap((s) => (s.status ? [{ status: s.status as AssetStatus, count: 0, bookC: 0 }] : []));
  const byStatus = new Map(statusTiles.map((t) => [t.status, t]));
  const counts = new Map<FinFilter | "all", number>([["all", 0], ...tabs.map((f): [FinFilter, number] => [f, 0])]);
  const matching: FinanceRow[] = [];
  for (const r of rows) {
    if (!inCategory(r)) continue;
    const bookC = r.result?.bookValue ?? 0;
    const tile = byStatus.get(r.status);
    if (tile) { tile.count++; tile.bookC += bookC; }
    if (p.status && r.status !== p.status) continue;
    kpis.count++;
    if (r.result) {
      kpis.costedCount++;
      kpis.costC += r.result.cost;
      kpis.accC += r.result.accumulated;
      kpis.bookC += bookC;
      const charge = monthCharge(r.result, asOf);
      if (charge > 0) { kpis.monthC += charge; kpis.depreciatingCount++; }
    }
    if ((found && !found.has(r.id)) || !matchesLife(r, life)) continue;
    counts.set("all", counts.get("all")! + 1);
    for (const f of tabs) if (inFin(r, f)) counts.set(f, counts.get(f)! + 1);
    if (fin && !inFin(r, fin)) continue;
    matching.push(r);
  }

  const shown = { count: matching.length, costedCount: 0, costC: 0, accC: 0, bookC: 0 };
  for (const r of matching) {
    if (!r.result) continue;
    shown.costedCount++; shown.costC += r.result.cost; shown.accC += r.result.accumulated; shown.bookC += r.result.bookValue;
  }
  return {
    sorted: sortRows(matching, p.sort ?? "book"),
    category, categoryLabel, kpis, categoryTiles: tiles, statusTiles,
    finCounts: [...counts].map(([key, count]) => ({ key, count })),
    shown,
    asOfLabel: monthLabel(asOf),
  };
}

/** Phase 47 (spec §3): one page of the list, with every aggregate the page shows. */
export async function financeAssets(p: FinanceListParams, now: Date = new Date()): Promise<FinanceAssetsResult> {
  const { sorted, ...rest } = await computeFinance(p, now);
  const per = p.per !== undefined && (PER_PAGE_OPTIONS as readonly number[]).includes(p.per) ? p.per : ENTITY_PAGE_SIZE;
  const pg = pageOf(sorted.length, p.page, per);
  return { rows: sorted.slice(pg.skip, pg.skip + pg.take), total: pg.total, page: pg.page, pageCount: pg.pageCount, per, ...rest };
}

/** Phase 47 (Task 3 review): the Export's rows — exactly the list's matching rows, in its order, every page. */
export async function financeExportRows(p: FinanceListParams, now: Date = new Date()): Promise<FinanceRow[]> {
  return (await computeFinance(p, now)).sorted;
}

/**
 * Spec §3 item 1: one class tab's asset count (every asset of the class, as the list's All shows with no filter). The
 * page counts only the class it is not showing: the shown class's count is its All categories tile.
 */
export async function financeClassCount(cls: AssetClass): Promise<number> {
  return prisma.asset.count({ where: financeListWhere({ cls, status: null, q: "" }) });
}

/**
 * Phase 35 (spec §4.1): the next record waiting on Finance — every `with-finance` asset of the class
 * (an asset with no cost is reviewable too), oldest registration first, never the record just decided.
 */
export async function nextToReview(currentId: string, cls: AssetClass): Promise<{ id: string; tag: string } | null> {
  return prisma.asset.findFirst({
    where: { cls, ...regWhere("with-finance"), id: { not: currentId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, tag: true },
  });
}
