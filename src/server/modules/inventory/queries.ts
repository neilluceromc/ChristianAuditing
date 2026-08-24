import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";
import {
  ASSET_STATUSES, buildAssetOrderBy, buildAssetWhere, type PurchaseYearValue,
} from "@/lib/inventory-list";
import type { ListState } from "@/lib/url-state";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";
import { REPAIR_STAGE_LABEL, downDays, isRepairStage, repairStage, type RepairStage } from "@/lib/repairs";

export const PAGE_SIZE = 25;

/** Serializable DTO for the client table island — strings only, preformatted. */
export interface AssetRow {
  id: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  assignee: string | null;
  /** ACTIVE-reservation holder. The asset still reads SPARE — the hold is a marker, not a status. */
  hold: string | null;
  purchased: string;
  warranty: string;
  /** derived repair stage id; null if the asset was never defective */
  stage: RepairStage | null;
  stageLabel: string | null;
  /** days out of service; null unless it currently reads DEFECTIVE */
  down: number | null;
}

/**
 * The one place a Prisma Asset row becomes a repair stage. The list row, the
 * bulk/export cut and the record page all derive the same answer from it —
 * three hand-written copies of this marshalling is how the list and the thing
 * you act on come to disagree. Typed with real `Prisma.Decimal | null` rather
 * than `unknown`: a `select` that later drops `cost` would otherwise make
 * `Number(undefined)` NaN, which silently reads as "not beyond repair" with no
 * type error and no failing test.
 */
export function stageOf(a: {
  status: string;
  vendorId: string | null;
  rmaRef: string | null;
  cost: Prisma.Decimal | null;
  repairQuote: Prisma.Decimal | null;
  defectiveSince: Date | null;
}): RepairStage | null {
  return repairStage({
    status: a.status,
    vendorId: a.vendorId,
    rmaRef: a.rmaRef,
    repairQuote: a.repairQuote === null ? null : Number(a.repairQuote),
    cost: a.cost === null ? null : Number(a.cost),
    defectiveSince: a.defectiveSince,
  });
}

const LIST_INCLUDE = {
  category: true,
  assignee: true,
  reservations: { where: { state: "ACTIVE" }, include: { employee: true } },
} satisfies Prisma.AssetInclude;

function toRow(a: {
  id: string;
  tag: string;
  model: string;
  status: string;
  purchasedAt: Date | null;
  warrantyUntil: Date | null;
  defectiveSince: Date | null;
  vendorId: string | null;
  rmaRef: string | null;
  cost: Prisma.Decimal | null;
  repairQuote: Prisma.Decimal | null;
  category: { name: string };
  assignee: { name: string } | null;
  reservations: Array<{ employee: { name: string } }>;
}): AssetRow {
  const stage = stageOf(a);
  return {
    id: a.id,
    tag: a.tag,
    model: a.model,
    category: a.category.name,
    status: a.status,
    assignee: a.assignee?.name ?? null,
    hold: a.reservations[0]?.employee.name ?? null,
    purchased: fmtDate(a.purchasedAt),
    warranty: fmtDate(a.warrantyUntil),
    stage,
    stageLabel: stage ? REPAIR_STAGE_LABEL[stage] : null,
    down: downDays(a),
  };
}

/**
 * The exact id set a repair-stage cut resolves to, or null when no valid
 * `stage` facet is present — used by every consumer of `buildAssetWhere` that
 * ACTS on the result (bulk status changes, CSV export), not just displays it.
 * `buildAssetWhere` only narrows to the repair CANDIDATE set in SQL (one of
 * the four stages, beyond-repair, compares repairQuote against cost, which no
 * Prisma filter can express) — so acting on that candidate set directly would
 * mean "the screen shows 1 row" and "the action touches 7" can both be true at
 * once. This resolves the candidate set down to the same ids listAssets shows.
 */
export async function repairStageIds(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
): Promise<string[] | null> {
  const stages = (state.filters.stage ?? []).filter(isRepairStage);
  if (stages.length === 0) return null;
  const where = buildAssetWhere(state, purchaseYear);
  const candidates = await prisma.asset.findMany({
    where,
    select: {
      id: true, status: true, vendorId: true, rmaRef: true, cost: true,
      repairQuote: true, defectiveSince: true,
    },
  });
  return candidates
    .filter((a) => {
      const stage = stageOf(a);
      return stage !== null && stages.includes(stage);
    })
    .map((a) => a.id);
}

export async function listAssets(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
): Promise<{
  rows: AssetRow[];
  total: number;
  pageCount: number;
}> {
  const where = buildAssetWhere(state, purchaseYear);
  const orderBy = buildAssetOrderBy(state.sort);
  const stages = (state.filters.stage ?? []).filter(isRepairStage);

  // Repair mode pages in memory: beyond-repair compares repairQuote against
  // cost, which no Prisma filter can express, so repairStage() has to make the
  // cut after the read — and then the count has to come from the cut set, not
  // from the candidate set, or "12 assets" would be a lie. buildAssetWhere has
  // already narrowed this to the defective corner of a team-scale fleet (the
  // same reasoning the employees list uses for its loadout filter).
  if (stages.length > 0) {
    const matched = (await prisma.asset.findMany({ where, orderBy, include: LIST_INCLUDE }))
      .map(toRow)
      .filter((r) => r.stage !== null && stages.includes(r.stage));
    const total = matched.length;
    return {
      total,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      rows: matched.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE),
    };
  }

  const [total, assets] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy,
      skip: (state.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: LIST_INCLUDE,
    }),
  ]);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: assets.map(toRow),
  };
}

/** Visible hideable columns for this user; default = all. */
export async function getInventoryColumns(userId: string): Promise<string[]> {
  const allowed = COLUMN_PREF_KEYS["columns:inventory"] as readonly string[];
  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "columns:inventory" } },
  });
  if (!pref || !Array.isArray(pref.value)) return [...allowed];
  return (pref.value as string[]).filter((c) => allowed.includes(c));
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Standard faceting: each facet's counts apply every OTHER facet (and q) but
 * not its own selection — options stay visible (dimmed at zero) instead of
 * vanishing once a sibling is picked. URL updates only on Apply, so these
 * recompute per navigation, not per click.
 */
export async function facetOptions(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
): Promise<Record<string, FacetOption[]>> {
  const without = (facet: string): ListState => ({
    ...state,
    filters: { ...state.filters, [facet]: [] },
  });

  // NOTE on repair mode: when `state.filters.stage` is set, buildAssetWhere
  // narrows these groupBy queries to the repair CANDIDATE set (status
  // DEFECTIVE or ever-defective) — it cannot also apply the in-memory
  // repairStage() cut that listAssets/repairStageIds use, since a SQL groupBy
  // can't compare repairQuote against cost. So these counts are candidate-set
  // counts, not cut-set counts, and may run slightly high in repair mode
  // (e.g. a "beyond-repair"-only view showing a category count that includes
  // a to-assess asset in the same category). They are read-only display
  // counts, not something acted on — bulkRequestStatusChange and the CSV
  // export resolve the exact cut set themselves via repairStageIds().
  // purchaseYear behaves like every OTHER active filter from these facets'
  // point of view (it narrows the candidate set they count over) — it is
  // simply never "its own" facet here, because it isn't one of the four
  // being computed. Matches the without(facet) rule above: apply everything
  // else, never the facet's own selection.
  const [statusG, categoryG, typeG, assigneeG, categories, types, assignees] = await Promise.all([
    prisma.asset.groupBy({ by: ["status"], where: buildAssetWhere(without("status"), purchaseYear), _count: true }),
    prisma.asset.groupBy({ by: ["categoryId"], where: buildAssetWhere(without("category"), purchaseYear), _count: true }),
    prisma.asset.groupBy({ by: ["typeId"], where: buildAssetWhere(without("type"), purchaseYear), _count: true }),
    prisma.asset.groupBy({ by: ["assigneeId"], where: buildAssetWhere(without("assignee"), purchaseYear), _count: true }),
    prisma.assetCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ orderBy: { name: "asc" }, include: { category: true } }),
    prisma.employee.findMany({ where: { assets: { some: {} } }, orderBy: { name: "asc" } }),
  ]);

  return {
    status: ASSET_STATUSES.map((s) => ({
      value: s, label: s, count: statusG.find((g) => g.status === s)?._count ?? 0,
    })),
    category: categories.map((c) => ({
      value: c.id, label: c.name, count: categoryG.find((g) => g.categoryId === c.id)?._count ?? 0,
    })),
    type: types.map((t) => ({
      value: t.id, label: `${t.category.name} · ${t.name}`,
      count: typeG.find((g) => g.typeId === t.id)?._count ?? 0,
    })),
    assignee: assignees.map((e) => ({
      value: e.id, label: e.name, count: assigneeG.find((g) => g.assigneeId === e.id)?._count ?? 0,
    })),
  };
}

/**
 * Year buckets for the split-by-year chips (`purchaseYearChips`), sized to
 * their counts. Grouped in memory over `purchasedAt` rather than a SQL
 * `groupBy`: Prisma's typed `groupBy` only groups real columns, there is no
 * portable "group by extracted year" through it, and re-implementing
 * `buildAssetWhere`'s filters a second time in raw SQL just to get a
 * date_part groupBy would be a second, driftable copy of the same rule
 * (the CSV-duplication mistake this project has already made once). Fetching
 * a thin `purchasedAt`-only projection and reducing it in memory is the same
 * move this module already makes wherever SQL can't express the grouping
 * (see the repair-mode branch of `listAssets` above) — team-scale fleet, so
 * this is cheap.
 *
 * Matches the `without(facet)` rule in `facetOptions`: called with no
 * `purchaseYear` of its own, so a bucket's count is "every OTHER active
 * filter applied, not this one" — the same thing every other facet count in
 * this module already means, and the reason clicking a chip shows exactly
 * the count printed on it.
 */
export async function purchaseYearBuckets(
  state: ListState,
): Promise<Array<{ year: number | null; count: number }>> {
  const where = buildAssetWhere(state);
  const rows = await prisma.asset.findMany({ where, select: { purchasedAt: true } });
  const counts = new Map<number | null, number>();
  for (const { purchasedAt } of rows) {
    const year = purchasedAt ? purchasedAt.getUTCFullYear() : null;
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()].map(([year, count]) => ({ year, count }));
}

/**
 * A USB scanner is just a keyboard: an exact tag match opens the record
 * instead of listing it. findUnique on the uppercased tag — NEVER an
 * insensitive equals (ILIKE wildcard hazard).
 */
export function exactTagMatch(q: string) {
  const tag = q.trim().toUpperCase();
  if (!/^BR-[A-Z]{2}-\d{4}$/.test(tag)) return null;
  return prisma.asset.findUnique({ where: { tag }, select: { id: true } });
}

export const getAsset = cache((id: string) =>
  prisma.asset.findUnique({
    where: { id },
    include: {
      category: true,
      type: true,
      assignee: true,
      vendor: true,
      approvals: {
        where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
      },
    },
  }),
);
