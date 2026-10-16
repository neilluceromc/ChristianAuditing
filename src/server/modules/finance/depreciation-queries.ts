import type { AssetClass, AssetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  asOfMonth, depStartMonth, depreciate, manilaMonth, resolvePolicy, stateNote, sumYearRows, toCentavos, yearGrid,
  type DepResult, type MonthIndex, type YearRow,
} from "@/lib/depreciation";
import { ENTITY_PAGE_SIZE, pageOf } from "@/lib/paging";
import { registrationState, type RegState } from "@/lib/registration";

/** Phase 35 (spec 5.1): depreciation covers capitalised assets only. */
export const CAPITALISED: Prisma.AssetWhereInput = { cost: { not: null }, financeNotCapitalised: false };

export interface DepAssetRow {
  id: string; tag: string; model: string; categoryId: string; category: string; cls: AssetClass; status: AssetStatus;
  holder: string | null; reg: RegState; notCapitalised: boolean;
  costC: number | null; confirmedAt: Date | null; startMonth: MonthIndex | null; result: DepResult | null; note: string | null; custom: boolean; overrideNote: string | null;
  lifeMonths: number | null; salvageC: number | null; categoryLife: number | null; categorySalvagePercent: number | null;
}

export async function depRows(
  where: Prisma.AssetWhereInput,
  now: Date = new Date(),
  opts: { orderBy?: Prisma.AssetOrderByWithRelationInput[]; skip?: number; take?: number } = {},
): Promise<DepAssetRow[]> {
  const asOf = asOfMonth(now);
  const rows = await prisma.asset.findMany({
    where,
    ...(opts.orderBy ? { orderBy: opts.orderBy } : {}),
    ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
    ...(opts.take !== undefined ? { take: opts.take } : {}),
    select: {
      id: true, tag: true, model: true, categoryId: true, cls: true, status: true, cost: true,
      itVerifiedAt: true, financeConfirmedAt: true, financeReturnedAt: true, financeNotCapitalised: true, purchasedAt: true,
      depreciationLifeMonths: true, depreciationSalvage: true, depreciationNote: true,
      assignee: { select: { name: true } },
      category: { select: { name: true, depreciationLifeMonths: true, depreciationSalvagePercent: true } },
    },
  });
  return rows.map((r): DepAssetRow => {
    const costC = toCentavos(r.cost);
    const salvageC = toCentavos(r.depreciationSalvage);
    const startMonth = depStartMonth({ purchasedAt: r.purchasedAt, financeConfirmedAt: r.financeConfirmedAt });
    const categorySalvagePercent = r.category.depreciationSalvagePercent === null ? null : Number(r.category.depreciationSalvagePercent);
    let result: DepResult | null = null;
    let note: string | null;
    let custom = false;
    if (costC !== null && !r.financeNotCapitalised) {
      const policy = resolvePolicy(
        { cost: costC, lifeMonths: r.depreciationLifeMonths, salvage: salvageC },
        { lifeMonths: r.category.depreciationLifeMonths, salvagePercent: categorySalvagePercent },
      );
      result = depreciate(costC, startMonth, policy, asOf);
      note = stateNote(result, r.category.name);
      custom = policy?.basis === "custom";
    } else {
      note = r.financeNotCapitalised ? "Not capitalised" : "No cost recorded";
    }
    return {
      id: r.id, tag: r.tag, model: r.model, categoryId: r.categoryId, category: r.category.name, cls: r.cls, status: r.status,
      holder: r.assignee?.name ?? null, reg: registrationState(r), notCapitalised: r.financeNotCapitalised,
      costC, confirmedAt: r.financeConfirmedAt, startMonth, result, note, custom, overrideNote: r.depreciationNote,
      lifeMonths: r.depreciationLifeMonths, salvageC, categoryLife: r.category.depreciationLifeMonths, categorySalvagePercent,
    };
  });
}

export async function bookValueTotals(
  where: Prisma.AssetWhereInput,
  now: Date = new Date(),
): Promise<{ costC: number; accumulatedC: number; bookC: number; asOf: MonthIndex }> {
  const rows = await depRows({ AND: [where, CAPITALISED] }, now);
  let costC = 0, accumulatedC = 0, bookC = 0;
  for (const r of rows) {
    if (!r.result) continue;
    costC += r.result.cost;
    accumulatedC += r.result.accumulated;
    bookC += r.result.bookValue;
  }
  return { costC, accumulatedC, bookC, asOf: asOfMonth(now) };
}

export interface PolicyRow {
  id: string; name: string; cls: AssetClass; costed: number; affected: number;
  lifeMonths: number | null; salvagePercent: number | null; changedBy: string | null; changedAt: Date | null;
}

export async function policyRows(): Promise<PolicyRow[]> {
  const [categories, costed, plain, audits] = await Promise.all([
    prisma.assetCategory.findMany({
      select: { id: true, name: true, cls: true, depreciationLifeMonths: true, depreciationSalvagePercent: true },
    }),
    prisma.asset.groupBy({ by: ["categoryId"], where: CAPITALISED, _count: { _all: true } }),
    // costed rows without a custom override: the same rule affectedByPolicy states, as one grouped read
    prisma.asset.groupBy({ by: ["categoryId"], where: { ...CAPITALISED, depreciationLifeMonths: null }, _count: { _all: true } }),
    prisma.auditEntry.findMany({
      where: { entityType: "asset-category", action: "depreciation.policy" },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, actorLabel: true, createdAt: true },
    }),
  ]);
  const costedBy = new Map(costed.map((g) => [g.categoryId, g._count._all]));
  const plainBy = new Map(plain.map((g) => [g.categoryId, g._count._all]));
  const last = new Map<string, { actorLabel: string; createdAt: Date }>();
  for (const a of audits) if (!last.has(a.entityId)) last.set(a.entityId, a);
  const rows = categories.map((c): PolicyRow => {
    const ch = last.get(c.id);
    return {
      id: c.id, name: c.name, cls: c.cls, costed: costedBy.get(c.id) ?? 0, affected: plainBy.get(c.id) ?? 0,
      lifeMonths: c.depreciationLifeMonths,
      salvagePercent: c.depreciationSalvagePercent === null ? null : Number(c.depreciationSalvagePercent),
      changedBy: ch?.actorLabel ?? null, changedAt: ch?.createdAt ?? null,
    };
  });
  return rows.sort((a, b) =>
    Number(a.lifeMonths !== null) - Number(b.lifeMonths !== null) || a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
}

export interface ScheduleGroup {
  category: string;
  rows: Array<{ id: string; tag: string; model: string; costC: number; custom: boolean; grid: YearRow }>;
  subtotal: YearRow;
}

type GridEntry = { categoryId: string; category: string; row: ScheduleGroup["rows"][number] };

/** The one pass behind the export, the category summary and the drill-down: capitalised assets of a class, each with its year grid. */
async function gridPass(cls: AssetClass, year: number, now: Date, categoryId?: string) {
  const asOf = asOfMonth(now);
  const rows = await depRows({ AND: [{ cls }, CAPITALISED, ...(categoryId ? [{ categoryId }] : [])] }, now);
  const entries: GridEntry[] = [];
  let notStarted = 0, noPolicy = 0;
  const thisYear = Math.floor(manilaMonth(now) / 12);
  let earliest = thisYear;
  for (const r of rows) {
    if (!r.result) continue;
    if (r.result.state === "not-started") notStarted++;
    if (r.result.state === "no-policy") noPolicy++;
    if (r.startMonth !== null) earliest = Math.min(earliest, Math.floor(r.startMonth / 12));
    const grid = yearGrid(r.result.cost, r.startMonth, r.result.policy, year, asOf);
    if (!grid) continue;
    entries.push({ categoryId: r.categoryId, category: r.category, row: { id: r.id, tag: r.tag, model: r.model, costC: r.result.cost, custom: r.custom, grid } });
  }
  const years: number[] = [];
  for (let y = earliest; y <= thisYear + 1; y++) years.push(y);
  return { entries, notStarted, noPolicy, asOf, years };
}

export async function scheduleYear(cls: AssetClass, year: number, now: Date = new Date()): Promise<{
  groups: ScheduleGroup[]; total: YearRow | null; notStarted: number; noPolicy: number; asOf: MonthIndex; years: number[];
}> {
  const { entries, notStarted, noPolicy, asOf, years } = await gridPass(cls, year, now);
  const byCat = new Map<string, ScheduleGroup["rows"]>();
  for (const e of entries) {
    const list = byCat.get(e.category);
    if (list) list.push(e.row);
    else byCat.set(e.category, [e.row]);
  }
  const groups = [...byCat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]): ScheduleGroup => {
      list.sort((a, b) => a.tag.localeCompare(b.tag));
      return { category, rows: list, subtotal: sumYearRows(list.map((x) => x.grid), year, asOf) };
    });
  return { groups, total: groups.length ? sumYearRows(groups.map((g) => g.subtotal), year, asOf) : null, notStarted, noPolicy, asOf, years };
}

/** Phase 36 (spec 5): category totals only, no asset rows — the Schedule's default view. */
export async function scheduleSummary(cls: AssetClass, year: number, now: Date = new Date()): Promise<{
  categories: Array<{ categoryId: string; category: string; assets: number; costC: number; row: YearRow }>;
  total: YearRow | null; totalCostC: number; notStarted: number; noPolicy: number; asOf: MonthIndex; years: number[];
}> {
  const { entries, notStarted, noPolicy, asOf, years } = await gridPass(cls, year, now);
  const byCat = new Map<string, { category: string; grids: YearRow[]; costC: number }>();
  for (const e of entries) {
    const c = byCat.get(e.categoryId) ?? { category: e.category, grids: [], costC: 0 };
    c.grids.push(e.row.grid);
    c.costC += e.row.costC;
    byCat.set(e.categoryId, c);
  }
  const categories = [...byCat.entries()]
    .map(([categoryId, c]) => ({ categoryId, category: c.category, assets: c.grids.length, costC: c.costC, row: sumYearRows(c.grids, year, asOf) }))
    .sort((a, b) => a.category.localeCompare(b.category));
  return { categories, total: categories.length ? sumYearRows(categories.map((c) => c.row), year, asOf) : null, totalCostC: categories.reduce((a, c) => a + c.costC, 0), notStarted, noPolicy, asOf, years };
}

/** One category's asset rows for the year, paged by tag; the subtotal covers every row of the category, not just the page. */
export async function scheduleCategory(cls: AssetClass, year: number, categoryId: string, page: number, now: Date = new Date()): Promise<{
  category: string; rows: ScheduleGroup["rows"]; subtotal: YearRow; subtotalCostC: number; total: number; page: number; pageCount: number;
} | null> {
  const cat = await prisma.assetCategory.findFirst({ where: { id: categoryId, cls }, select: { name: true } });
  if (!cat) return null;
  const { entries, asOf } = await gridPass(cls, year, now, categoryId);
  const all = entries.map((e) => e.row).sort((a, b) => a.tag.localeCompare(b.tag));
  const p = pageOf(all.length, page, ENTITY_PAGE_SIZE);
  return {
    category: cat.name, rows: all.slice(p.skip, p.skip + p.take), subtotal: sumYearRows(all.map((x) => x.grid), year, asOf), subtotalCostC: all.reduce((a, x) => a + x.costC, 0),
    total: all.length, page: p.page, pageCount: p.pageCount,
  };
}
