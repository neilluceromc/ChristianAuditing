import { cache } from "react";
import { Prisma, type AssetClass, type AssetStatus, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";
import {
  buildAssetOrderBy, buildAssetWhere, type PurchaseYearValue,
} from "@/lib/inventory-list";
import { ASSET_CLASSES, ASSIGNABLE_FROM, canSeeClass, statusesFor } from "@/lib/asset-class";
import type { ListState } from "@/lib/url-state";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";
import {
  REPAIR_STAGE_CASE_SQL, REPAIR_STAGE_LABEL, downDays, isRepairStage, repairStage, type RepairStage,
} from "@/lib/repairs";
import { TAG_SHAPE } from "@/lib/tag-key";
import { ENTITY_PAGE_SIZE, pageOf } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { PROVENANCES, PROVENANCE_LABEL, provenanceWhere } from "@/lib/provenance";
import { auditPhrase, auditSentence } from "@/lib/activity";
import { attentionOf, attentionWhere, orderByAttention, type Attention } from "@/lib/inventory-attention";

/** Serializable DTO for the client table island — strings only, preformatted. */
export interface AssetRow {
  id: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  assignee: string | null;
  /** ACTIVE-reservation holder. The asset still reads SPARE — the hold is a marker, not a status. */
  hold: { id: string; name: string; expiresAt: Date | null } | null;
  purchased: string;
  warranty: string;
  /** derived repair stage id; null if the asset was never defective */
  stage: RepairStage | null;
  stageLabel: string | null;
  /** days out of service: to now while DEFECTIVE, closed on repairEndedAt otherwise; null when never defective or the end was never recorded (Phase 26) */
  down: number | null;
  /** Phase 30 (spec §6.3): the holder's ids, for the row's holder link and the holder search. */
  assigneeId: string | null;
  assigneeNo: string | null;
  cls: AssetClass;
  /** the raw enum — `status` above stays the display string */
  statusValue: AssetStatus;
  /** back, not checked (returnedAt set) */
  returned: boolean;
  /** the open approval's ref (PENDING / CLAIMED / APPROVED), newest first */
  pendingRef: string | null;
  /** YYYY-MM-DD */
  loanDueAt: string | null;
  awaitingItCheck: boolean;
  financeConfirmed: boolean;
  financeReturned: boolean;
  /** the one reason this row still owes someone something, worst first (attentionOf) */
  attention: Attention | null;
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
  repairEndedAt: Date | null;
}): RepairStage | null {
  return repairStage({
    status: a.status,
    vendorId: a.vendorId,
    rmaRef: a.rmaRef,
    repairQuote: a.repairQuote === null ? null : Number(a.repairQuote),
    cost: a.cost === null ? null : Number(a.cost),
    defectiveSince: a.defectiveSince,
    repairEndedAt: a.repairEndedAt,
  });
}

const LIST_INCLUDE = {
  category: true,
  // the whole Employee row — id and employeeNo ride along with the name (Phase 30)
  assignee: true,
  reservations: { where: { state: "ACTIVE" }, include: { employee: true } },
  // the open approval that queues this row (Phase 30, spec §6.3) — the same states as OPEN_APPROVAL_STATES
  approvals: {
    where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
    select: { refNo: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} satisfies Prisma.AssetInclude;

function toRow(a: {
  id: string;
  tag: string;
  model: string;
  cls: AssetClass;
  status: AssetStatus;
  returnedAt: Date | null;
  loanDueAt: Date | null;
  itVerifiedAt: Date | null;
  financeConfirmedAt: Date | null;
  financeReturnedAt: Date | null;
  purchasedAt: Date | null;
  warrantyUntil: Date | null;
  defectiveSince: Date | null;
  repairEndedAt: Date | null;
  vendorId: string | null;
  rmaRef: string | null;
  cost: Prisma.Decimal | null;
  repairQuote: Prisma.Decimal | null;
  category: { name: string };
  assignee: { id: string; name: string; employeeNo: string } | null;
  reservations: Array<{ expiresAt: Date | null; employee: { id: string; name: string } }>;
  approvals: Array<{ refNo: string }>;
}, now: Date): AssetRow {
  const stage = stageOf(a);
  const pendingRef = a.approvals[0]?.refNo ?? null;
  return {
    id: a.id,
    tag: a.tag,
    model: a.model,
    category: a.category.name,
    status: a.status,
    assignee: a.assignee?.name ?? null,
    hold: a.reservations[0] ? { id: a.reservations[0].employee.id, name: a.reservations[0].employee.name, expiresAt: a.reservations[0].expiresAt } : null,
    purchased: fmtDate(a.purchasedAt),
    warranty: fmtDate(a.warrantyUntil),
    stage,
    stageLabel: stage ? REPAIR_STAGE_LABEL[stage] : null,
    down: downDays(a),
    assigneeId: a.assignee?.id ?? null,
    assigneeNo: a.assignee?.employeeNo ?? null,
    cls: a.cls,
    statusValue: a.status,
    returned: a.returnedAt !== null,
    pendingRef,
    loanDueAt: a.loanDueAt ? a.loanDueAt.toISOString().slice(0, 10) : null,
    awaitingItCheck: a.cls === "IT" && a.itVerifiedAt === null,
    financeConfirmed: a.financeConfirmedAt !== null,
    financeReturned: a.financeReturnedAt !== null,
    attention: attentionOf({
      cls: a.cls, status: a.status, returnedAt: a.returnedAt, loanDueAt: a.loanDueAt,
      pendingRef, itVerifiedAt: a.itVerifiedAt,
    }, now),
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
 *
 * Phase 20 (spec §6.6, plan P-1): the cut itself is now computed by the
 * database instead of read-then-filter in JS — `REPAIR_STAGE_CASE_SQL`
 * mirrors `repairStage` rule for rule (their agreement is proven end-to-end
 * in `it-gaps.spec.ts`, since vitest has no database). The raw query is
 * scoped ONLY by class and the repair candidate predicate — the same
 * candidate set `buildAssetWhere`'s own stage-facet branch narrows to — so
 * when q/status/category/etc. are ALSO active this intersects the raw cut
 * with the Prisma-side candidate ids from `buildAssetWhere`. The Prisma
 * where is never hand-translated to SQL; it is only ever used to compute an
 * id set to intersect against.
 */
export async function repairStageIds(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
  cls: AssetClass,
): Promise<string[] | null> {
  const stages = (state.filters.stage ?? []).filter(isRepairStage);
  if (stages.length === 0) return null;

  const rows = await prisma.$queryRaw<Array<{ id: string; stage: string }>>(Prisma.sql`
    SELECT "id", ${Prisma.raw(REPAIR_STAGE_CASE_SQL)} AS stage
    FROM "Asset"
    WHERE "cls" = ${cls}::"AssetClass" AND ("status" = 'DEFECTIVE' OR "defectiveSince" IS NOT NULL)
  `);
  const kept = rows.filter((r) => (stages as readonly string[]).includes(r.stage)).map((r) => r.id);

  // Every filter besides `stage` itself (q, status, category, type,
  // assignee, provenance) and purchaseYear still has to narrow the result —
  // the raw query above knows nothing about any of them.
  const hasOtherFilters =
    Boolean(state.q) ||
    purchaseYear !== null ||
    Object.entries(state.filters).some(([key, values]) => key !== "stage" && (values?.length ?? 0) > 0);
  if (!hasOtherFilters) return kept;

  const where = buildAssetWhere(state, purchaseYear, cls);
  const candidates = await prisma.asset.findMany({ where, select: { id: true } });
  const candidateIds = new Set(candidates.map((c) => c.id));
  return kept.filter((id) => candidateIds.has(id));
}

export async function listAssets(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
  cls: AssetClass,
  now: Date = new Date(),
): Promise<{
  rows: AssetRow[];
  total: number;
  page: number;
  pageCount: number;
  /** rows in this view (every filter applied, every page) that carry an attention reason — the count line */
  attentionCount: number;
}> {
  const orderBy = buildAssetOrderBy(state.sort);
  const stages = (state.filters.stage ?? []).filter(isRepairStage);

  // Repair mode (Phase 24, spec §5.1): the stage cut runs in SQL — repairStageIds already applies
  // REPAIR_STAGE_CASE_SQL and intersects every other active filter and purchaseYear — so the list
  // pages that id set through the same count/skip/take snapshot as every other view. Until this
  // phase it loaded every candidate row with its includes and paged the array in memory.
  const where: Prisma.AssetWhereInput = stages.length > 0
    ? { id: { in: (await repairStageIds(state, purchaseYear, cls)) ?? [] } }
    : buildAssetWhere(state, purchaseYear, cls);

  // Phase 30 (plan P-10): attentionWhere agrees with attentionOf boundary for boundary, so this
  // count and the markers on the rows cannot disagree.
  const attentionCount = await prisma.asset.count({ where: { AND: [where, attentionWhere(now)] } });

  // Attention is derived, not a column: the candidate pass runs in memory (like the Loadout sort on
  // the people list) — the whole view in the default order, ranked by attentionOf, then paged.
  const attentionSort = state.sort.find((s) => s.key === "attention");
  if (attentionSort) {
    const all = await prisma.asset.findMany({ where, orderBy, include: LIST_INCLUDE });
    const ordered = orderByAttention(all.map((a) => toRow(a, now)), attentionSort.dir);
    const pg = pageOf(ordered.length, state.page, ENTITY_PAGE_SIZE);
    return {
      rows: ordered.slice(pg.skip, pg.skip + pg.take),
      total: pg.total,
      page: pg.page,
      pageCount: pg.pageCount,
      attentionCount,
    };
  }

  const { rows: assets, total, page, pageCount } = await pagedSnapshot(
    ENTITY_PAGE_SIZE,
    state.page,
    (tx) => tx.asset.count({ where }),
    (tx, pg) =>
      tx.asset.findMany({
        where,
        orderBy,
        skip: pg.skip,
        take: pg.take,
        include: LIST_INCLUDE,
      }),
  );
  return {
    total,
    page,
    pageCount,
    attentionCount,
    rows: assets.map((a) => toRow(a, now)),
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
 *
 * Every list and every count in here is scoped by `cls` — the four groupBys
 * through buildAssetWhere, the three reference lists directly. An eighth
 * query must be too; two-of-three was the shape that shipped (D-12).
 */
export async function facetOptions(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
  cls: AssetClass,
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
  const [statusG, categoryG, typeG, assigneeG, categories, types, assignees, provenanceCounts] = await Promise.all([
    prisma.asset.groupBy({ by: ["status"], where: buildAssetWhere(without("status"), purchaseYear, cls), _count: true }),
    prisma.asset.groupBy({ by: ["categoryId"], where: buildAssetWhere(without("category"), purchaseYear, cls), _count: true }),
    prisma.asset.groupBy({ by: ["typeId"], where: buildAssetWhere(without("type"), purchaseYear, cls), _count: true }),
    prisma.asset.groupBy({ by: ["assigneeId"], where: buildAssetWhere(without("assignee"), purchaseYear, cls), _count: true }),
    prisma.assetCategory.findMany({ where: { cls }, orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ where: { category: { cls } }, orderBy: { name: "asc" }, include: { category: true } }),
    prisma.employee.findMany({ where: { assets: { some: { cls } } }, orderBy: { name: "asc" } }),
    // a derived facet cannot groupBy — three counts over the same where minus its own key (spec §6)
    Promise.all(
      PROVENANCES.map((p) =>
        prisma.asset.count({ where: { AND: [buildAssetWhere(without("provenance"), purchaseYear, cls), provenanceWhere(p)] } }),
      ),
    ),
  ]);

  return {
    status: statusesFor(cls).map((s) => ({
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
    provenance: PROVENANCES.map((p, i) => ({ value: p, label: PROVENANCE_LABEL[p], count: provenanceCounts[i] })),
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
 * move this module already makes wherever SQL can't express the grouping —
 * team-scale fleet, so this is cheap.
 *
 * Matches the `without(facet)` rule in `facetOptions`: called with no
 * `purchaseYear` of its own, so a bucket's count is "every OTHER active
 * filter applied, not this one" — the same thing every other facet count in
 * this module already means, and the reason clicking a chip shows exactly
 * the count printed on it.
 */
export async function purchaseYearBuckets(
  state: ListState,
  cls: AssetClass,
): Promise<Array<{ year: number | null; count: number }>> {
  const where = buildAssetWhere(state, null, cls);
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
 *
 * Deliberately not scoped by class. Tags are globally unique, and this is the
 * scanner contract: a label read off the object opens the object, whichever
 * list view the search box happened to be on. The non-exact path
 * (`listAssets`) IS class-scoped — `q=BR-VH-0001` from the IT view jumps to
 * the car, `q=BR-VH` from the IT view finds nothing. That asymmetry is
 * intended; do not "fix" it by adding `cls` here.
 */
export function exactTagMatch(q: string) {
  const tag = q.trim().toUpperCase();
  if (!TAG_SHAPE.test(tag)) return null;
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
      purchaseRequest: { select: { id: true, refNo: true } },
      approvals: {
        where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
      },
    },
  }),
);

/** getAsset, but a class the role cannot see reads as absent (spec §3.1). */
export async function getVisibleAsset(id: string, role: Role) {
  const asset = await getAsset(id);
  return asset && canSeeClass(role, asset.cls) ? asset : null;
}

/**
 * Ids of the assets a role may NOT see — for excluding their audit rows. Empty
 * for an all-class role; for IT it is the Purchasing fleet, which is small.
 */
export async function invisibleAssetIds(role: Role): Promise<string[]> {
  const hidden = ASSET_CLASSES.filter((c) => !canSeeClass(role, c));
  if (hidden.length === 0) return [];
  const rows = await prisma.asset.findMany({ where: { cls: { in: hidden } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Phase 15/20/24 (spec §6.4, gap 4): the Replace picker — same-type spares
 * first, then any assignable IT spare. `group` names WHICH group each row is
 * in — the two groups render as combobox headings (Phase 24) instead of the
 * per-row note Phase 15/20 shipped with — true for every row whether or not
 * `preferTypeId` ever matches anything.
 *
 * Phase 30 (spec §4.4): a spare an open approval already queues is excluded
 * beside a reserved one — picking it would only be refused at submit — and
 * `hidden` counts both, so the dialog can say how many spares are spoken for
 * instead of silently offering fewer.
 */
export async function spareOptions(preferTypeId: string | null): Promise<{ options: ComboOption[]; hidden: number }> {
  const pool = { cls: "IT" as const, status: ASSIGNABLE_FROM.IT, returnedAt: null };
  const [rows, all] = await Promise.all([
    prisma.asset.findMany({
      where: {
        ...pool,
        reservations: { none: { state: "ACTIVE" } },
        approvals: { none: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } },
      },
      select: { id: true, tag: true, model: true, typeId: true },
      orderBy: { tag: "asc" },
    }),
    prisma.asset.count({ where: pool }),
  ]);
  const isSameType = (t: string | null) => preferTypeId !== null && t === preferTypeId;
  const rank = (t: string | null) => (isSameType(t) ? 0 : 1);
  const options = rows.sort((a, b) => rank(a.typeId) - rank(b.typeId) || a.tag.localeCompare(b.tag))
    .map((a) => ({ value: a.id, label: a.tag, sub: a.model, group: isSameType(a.typeId) ? "Same type" : "Other spares" }));
  return { options, hidden: all - rows.length };
}

/**
 * Phase 20 (spec §6.5, gap 5): the asset record header's "Last change" line
 * — the newest `AuditEntry` for this asset whose action is a direct IT
 * lifecycle change or a registration, rendered through the SAME
 * `auditSentence` builder every other activity feed in this app already
 * uses (never a bespoke sentence here). Matched by PREFIX (`lifecycle.*`) or
 * the literal `"register"`, exactly spec §6.6's own wording — not a hand
 * enumeration of today's five lifecycle actions, so a future
 * `lifecycle.*` action is picked up automatically rather than silently
 * falling out of this line the day it ships. `null` when there is no such
 * entry (a fresh registration with no lifecycle event yet, or an asset whose
 * only history predates this feature) — the header shows nothing, per spec.
 */
export async function lastLifecycleChange(
  assetId: string,
): Promise<{ sentence: string; phrase: string; at: Date; actor: string } | null> {
  const entry = await prisma.auditEntry.findFirst({
    where: {
      entityType: "asset",
      entityId: assetId,
      // Phase 30 (review R10): Register at quantity 1 goes through createAsset, which audits `create`.
      OR: [{ action: { startsWith: "lifecycle." } }, { action: "register" }, { action: "create" }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!entry) return null;
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { tag: true } });
  return {
    sentence: auditSentence({
      actorLabel: entry.actorLabel, action: entry.action, diff: entry.diff, entityLabel: asset?.tag ?? assetId,
    }),
    // Phase 30 (spec §4.4): the header's line without the tag or the actor — `assigned to Carlo Dizon`.
    phrase: auditPhrase({ action: entry.action, diff: entry.diff }),
    at: entry.createdAt,
    actor: entry.actorLabel,
  };
}
