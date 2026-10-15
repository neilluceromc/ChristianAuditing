import type { AssetClass, AssetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  asOfMonth, depreciate, manilaMonth, resolvePolicy, stateNote, toCentavos, yearGrid,
  type DepResult, type MonthIndex, type YearRow,
} from "@/lib/depreciation";
import { registrationState, type RegState } from "@/lib/registration";

/** Phase 35 (spec 5.1): depreciation covers capitalised assets only. */
export const CAPITALISED: Prisma.AssetWhereInput = { cost: { not: null }, financeNotCapitalised: false };

export interface DepAssetRow {
  id: string; tag: string; model: string; category: string; cls: AssetClass; status: AssetStatus;
  holder: string | null; reg: RegState; notCapitalised: boolean;
  costC: number | null; confirmedAt: Date | null; result: DepResult | null; note: string | null; custom: boolean; overrideNote: string | null;
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
      id: true, tag: true, model: true, cls: true, status: true, cost: true,
      itVerifiedAt: true, financeConfirmedAt: true, financeReturnedAt: true, financeNotCapitalised: true,
      depreciationLifeMonths: true, depreciationSalvage: true, depreciationNote: true,
      assignee: { select: { name: true } },
      category: { select: { name: true, depreciationLifeMonths: true, depreciationSalvagePercent: true } },
    },
  });
  return rows.map((r): DepAssetRow => {
    const costC = toCentavos(r.cost);
    const salvageC = toCentavos(r.depreciationSalvage);
    const categorySalvagePercent = r.category.depreciationSalvagePercent === null ? null : Number(r.category.depreciationSalvagePercent);
    let result: DepResult | null = null;
    let note: string | null;
    let custom = false;
    if (costC !== null && !r.financeNotCapitalised) {
      const policy = resolvePolicy(
        { cost: costC, lifeMonths: r.depreciationLifeMonths, salvage: salvageC },
        { lifeMonths: r.category.depreciationLifeMonths, salvagePercent: categorySalvagePercent },
      );
      result = depreciate(costC, r.financeConfirmedAt, policy, asOf);
      note = stateNote(result, r.category.name);
      custom = policy?.basis === "custom";
    } else {
      note = r.financeNotCapitalised ? "Not capitalised" : "No cost recorded";
    }
    return {
      id: r.id, tag: r.tag, model: r.model, category: r.category.name, cls: r.cls, status: r.status,
      holder: r.assignee?.name ?? null, reg: registrationState(r), notCapitalised: r.financeNotCapitalised,
      costC, confirmedAt: r.financeConfirmedAt, result, note, custom, overrideNote: r.depreciationNote,
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

function sumRows(rows: YearRow[]): YearRow {
  return {
    opening: rows.reduce((a, r) => a + r.opening, 0),
    months: Array.from({ length: 12 }, (_, i) => rows.reduce((a, r) => a + r.months[i], 0)),
    projected: rows[0].projected,
    total: rows.reduce((a, r) => a + r.total, 0),
    closing: rows.reduce((a, r) => a + r.closing, 0),
  };
}

export async function scheduleYear(cls: AssetClass, year: number, now: Date = new Date()): Promise<{
  groups: ScheduleGroup[]; total: YearRow | null; notStarted: number; noPolicy: number; asOf: MonthIndex; years: number[];
}> {
  const asOf = asOfMonth(now);
  const rows = await depRows({ AND: [{ cls }, CAPITALISED] }, now);
  const byCat = new Map<string, ScheduleGroup["rows"]>();
  let notStarted = 0, noPolicy = 0;
  const thisYear = Math.floor(manilaMonth(now) / 12);
  let earliest = thisYear;
  for (const r of rows) {
    if (!r.result) continue;
    if (r.result.state === "not-started") notStarted++;
    if (r.result.state === "no-policy") noPolicy++;
    if (r.confirmedAt) earliest = Math.min(earliest, Math.floor(manilaMonth(r.confirmedAt) / 12));
    const grid = yearGrid(r.result.cost, r.confirmedAt, r.result.policy, year, asOf);
    if (!grid) continue;
    const list = byCat.get(r.category) ?? [];
    list.push({ id: r.id, tag: r.tag, model: r.model, costC: r.result.cost, custom: r.custom, grid });
    byCat.set(r.category, list);
  }
  const groups = [...byCat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]): ScheduleGroup => {
      list.sort((a, b) => a.tag.localeCompare(b.tag));
      return { category, rows: list, subtotal: sumRows(list.map((x) => x.grid)) };
    });
  const years: number[] = [];
  for (let y = earliest; y <= thisYear + 1; y++) years.push(y);
  return { groups, total: groups.length ? sumRows(groups.map((g) => g.subtotal)) : null, notStarted, noPolicy, asOf, years };
}
