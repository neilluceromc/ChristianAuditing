import { Prisma, type AssetClass, type AssetStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtMoneyExact } from "@/lib/format";
import { isStatusOf } from "@/lib/asset-class";
import { monthLabel } from "@/lib/depreciation";
import { ENTITY_PAGE_SIZE, pageOf } from "@/lib/paging";
import { FIN_FILTERS, finWhere, pageAcross, regWhere, type FinFilter } from "@/lib/registration";
import { CAPITALISED, bookValueTotals, depRows, type DepAssetRow } from "./depreciation-queries";

export function parseAssetStatus(raw: string | null | undefined, cls: AssetClass): AssetStatus | null {
  return raw != null && isStatusOf(cls, raw) ? raw : null;
}

export interface FinanceListParams { cls: AssetClass; status: AssetStatus | null; fin: FinFilter | null; q: string; page: number }

/** Phase 35 (spec 4.1): every asset of the class — no cost filter and no IT gate. */
export function financeListWhere(p: Omit<FinanceListParams, "page" | "fin">): Prisma.AssetWhereInput {
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
 * registration-chip count for that filter (financeAssets counts `AND [financeListWhere, finWhere(f)]`). The Finance
 * overview's To confirm tile, its snapshot and the sidebar's To confirm views all count this where.
 */
export function financeViewWhere(cls: AssetClass, fin: FinFilter): Prisma.AssetWhereInput {
  return { AND: [financeListWhere({ cls, status: null, q: "" }), finWhere(fin)] };
}

const BY_COST: Prisma.AssetOrderByWithRelationInput[] = [{ cost: { sort: "desc", nulls: "last" } }, { tag: "asc" }, { id: "asc" }];
const BY_AGE: Prisma.AssetOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];

/**
 * Phase 35 (spec 4.1): Finance's register of every asset of a class, with the registration chips, a page of
 * rows (To review first on All, plan P-10) and totals over EVERY matching capitalised row (plan P-4).
 * Status is shown on every row, and can also be filtered (the optional status filter); Finance cares that a P55,000 laptop currently reads DEFECTIVE.
 */
export async function financeAssets(p: FinanceListParams, now: Date = new Date()): Promise<{
  rows: DepAssetRow[]; total: number; page: number; pageCount: number;
  chips: Record<FinFilter | "all", number>;
  totals: { count: number; costed: number; cost: string; depreciation: string; book: string; asOfLabel: string };
}> {
  const where = financeListWhere(p);
  const scoped: Prisma.AssetWhereInput = p.fin ? { AND: [where, finWhere(p.fin)] } : where;
  const [all, ...counts] = await Promise.all([
    prisma.asset.count({ where }),
    ...FIN_FILTERS.map((f) => prisma.asset.count({ where: { AND: [where, finWhere(f)] } })),
  ]);
  const chips = { all } as Record<FinFilter | "all", number>;
  FIN_FILTERS.forEach((f, i) => { chips[f] = counts[i]; });

  const total = p.fin ? chips[p.fin] : all;
  const pg = pageOf(total, p.page, ENTITY_PAGE_SIZE);
  let rows: DepAssetRow[];
  if (p.fin) {
    rows = await depRows(scoped, now, { orderBy: BY_COST, skip: pg.skip, take: pg.take });
  } else {
    const w = pageAcross(chips["with-finance"], pg.skip, pg.take);
    const review = finWhere("with-finance");
    const [first, rest] = await Promise.all([
      w.first.take ? depRows({ AND: [where, review] }, now, { orderBy: BY_AGE, ...w.first }) : Promise.resolve([]),
      w.rest.take ? depRows({ AND: [where, { NOT: review }] }, now, { orderBy: BY_COST, ...w.rest }) : Promise.resolve([]),
    ]);
    rows = [...first, ...rest];
  }

  const [sums, costed] = await Promise.all([
    bookValueTotals(scoped, now),
    prisma.asset.count({ where: { AND: [scoped, CAPITALISED] } }),
  ]);
  return {
    rows, total: pg.total, page: pg.page, pageCount: pg.pageCount, chips,
    totals: {
      count: total, costed,
      cost: fmtMoneyExact(sums.costC / 100),
      depreciation: fmtMoneyExact(sums.accumulatedC / 100),
      book: fmtMoneyExact(sums.bookC / 100),
      asOfLabel: monthLabel(sums.asOf),
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
