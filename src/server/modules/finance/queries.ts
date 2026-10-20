import { Prisma, type AssetClass, type AssetStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtMoneyExact } from "@/lib/format";
import { isStatusOf } from "@/lib/asset-class";
import { asOfMonth, monthLabel } from "@/lib/depreciation";
import { ENTITY_PAGE_SIZE, PER_PAGE_OPTIONS, pageOf } from "@/lib/paging";
import { FIN_FILTERS, finWhere, regWhere, type FinFilter } from "@/lib/registration";
import { TILE_SPECS } from "@/lib/inventory-tiles";
import {
  categoryTiles, finTabs, inFin, lifeStage, matchesLife, monthCharge, sortFinanceRows,
  type CategoryTile, type FinanceSort, type LifeFilter, type LifeStage,
} from "@/lib/finance-list";
import { depRows, type DepAssetRow } from "./depreciation-queries";

export function parseAssetStatus(raw: string | null | undefined, cls: AssetClass): AssetStatus | null {
  return raw != null && isStatusOf(cls, raw) ? raw : null;
}

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

/** Spec §3 item 2: the four money cards. Cost, accumulated and book value follow the totals footer's rule (capitalised rows). */
export interface FinanceKpis { costC: number; accC: number; bookC: number; monthC: number; count: number; depreciatingCount: number }

export interface FinanceAssetsResult {
  rows: FinanceRow[]; total: number; page: number; pageCount: number; per: number;
  /** the category filter in force: a category id of the class, "other", or null (an unknown id reads as null) */
  category: string | null;
  kpis: FinanceKpis;
  categoryTiles: CategoryTile[];
  statusTiles: Array<{ status: AssetStatus; count: number; bookC: number }>;
  /** All, then the class's finance-state tabs in order (no awaiting-it on Purchasing) */
  finCounts: Array<{ key: FinFilter | "all"; count: number }>;
  shown: { count: number; bookC: number };
  /** Phase 35 shape, kept for the pre-Phase-47 page: every chip (awaiting-it is 0 on Purchasing) */
  chips: Record<FinFilter | "all", number>;
  /** Phase 35 footer over the shown rows */
  totals: { count: number; costed: number; cost: string; depreciation: string; book: string; asOfLabel: string };
}

/**
 * Phase 47 (spec §3): Finance's register of one class. ONE read of the class's assets (depRows) — plus, with a search,
 * one id-only read so the search stays SQL's — and every aggregate in one in-memory pass over it:
 * - category tiles: the class (folded to whole rows; "other" means every category not on its own tile);
 * - status tiles: the class and category;
 * - money totals: the class, category and status (the totals footer's rule: capitalised rows' depreciation results);
 * - finance-state counts: those plus search and life (not the finance state itself);
 * - the rows, `shown` and the footer totals: every filter. Sorted (spec ruling: book value high first replaces
 *   To review first) and paged by `per`.
 */
export async function financeAssets(p: FinanceListParams, now: Date = new Date()): Promise<FinanceAssetsResult> {
  const asOf = asOfMonth(now);
  const q = p.q.trim();
  const [classRows, categories, hits] = await Promise.all([
    depRows({ cls: p.cls }, now),
    prisma.assetCategory.findMany({ where: { cls: p.cls }, select: { id: true, name: true } }),
    q ? prisma.asset.findMany({ where: financeListWhere({ cls: p.cls, status: null, q }), select: { id: true } }) : null,
  ]);
  const rows: FinanceRow[] = classRows.map((r) => ({ ...r, lifeStage: lifeStage(r.result, r.reg, r.notCapitalised, r.costC) }));
  const found = hits ? new Set(hits.map((h) => h.id)) : null;

  const tileInput = rows.map((r) => ({ categoryId: r.categoryId, categoryName: r.category, costC: r.result?.cost ?? null, bookC: r.result?.bookValue ?? null }));
  const unselected = categoryTiles(tileInput, null, 6, categories);
  const kept = new Set(unselected.filter((t) => t.id !== "all" && t.id !== "other").map((t) => t.id));
  const category = p.category === "other"
    ? (unselected.some((t) => t.id === "other") ? "other" : null)
    : p.category && categories.some((c) => c.id === p.category) ? p.category : null;
  const tiles = category ? categoryTiles(tileInput, category, 6, categories) : unselected;
  const inCategory = (r: FinanceRow) => category === null || (category === "other" ? !kept.has(r.categoryId) : r.categoryId === category);

  const tabs = finTabs(p.cls);
  const fin = p.fin && tabs.includes(p.fin) ? p.fin : null;
  const life = p.life ?? null;
  const kpis: FinanceKpis = { costC: 0, accC: 0, bookC: 0, monthC: 0, count: 0, depreciatingCount: 0 };
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
      kpis.costC += r.result.cost;
      kpis.accC += r.result.accumulated;
      kpis.bookC += bookC;
      const charge = monthCharge(r.result, asOf);
      if (charge > 0) { kpis.monthC += charge; kpis.depreciatingCount++; }
    }
    if ((found && !found.has(r.id)) || !matchesLife(r.lifeStage, life)) continue;
    counts.set("all", counts.get("all")! + 1);
    for (const f of tabs) if (inFin(r, f)) counts.set(f, counts.get(f)! + 1);
    if (fin && !inFin(r, fin)) continue;
    matching.push(r);
  }

  const per = p.per !== undefined && (PER_PAGE_OPTIONS as readonly number[]).includes(p.per) ? p.per : ENTITY_PAGE_SIZE;
  const pg = pageOf(matching.length, p.page, per);
  const sorted = sortFinanceRows(matching, p.sort ?? "book");
  let costC = 0, accC = 0, shownBookC = 0, costed = 0;
  for (const r of matching) {
    if (!r.result) continue;
    costed++; costC += r.result.cost; accC += r.result.accumulated; shownBookC += r.result.bookValue;
  }
  const chips = Object.fromEntries([["all", 0], ...FIN_FILTERS.map((f) => [f, 0])]) as Record<FinFilter | "all", number>;
  for (const [k, n] of counts) chips[k] = n;
  return {
    rows: sorted.slice(pg.skip, pg.skip + pg.take), total: pg.total, page: pg.page, pageCount: pg.pageCount, per,
    category, kpis, categoryTiles: tiles, statusTiles,
    finCounts: [...counts].map(([key, count]) => ({ key, count })),
    shown: { count: matching.length, bookC: shownBookC },
    chips,
    totals: {
      count: matching.length, costed,
      cost: fmtMoneyExact(costC / 100),
      depreciation: fmtMoneyExact(accC / 100),
      book: fmtMoneyExact(shownBookC / 100),
      asOfLabel: monthLabel(asOf),
    },
  };
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
