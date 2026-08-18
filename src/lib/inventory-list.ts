import type { AssetStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";
import { isRepairStage } from "./repairs";

export const ASSET_STATUSES = [
  "DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING",
] as const satisfies readonly AssetStatus[];

/** Bulk actions cap — shared by the server action and the selection bar UI. */
export const BULK_MAX = 200;

export const INVENTORY_LIST_CONFIG: ListConfig = {
  facets: ["status", "category", "type", "assignee", "stage"],
  sortable: [
    "tag", "model", "category", "status", "purchasedAt", "warrantyUntil",
    // the repairs view's Down column
    "defectiveSince",
  ],
  defaultSort: [{ key: "tag", dir: "asc" }],
};

export function buildAssetWhere(state: ListState): Prisma.AssetWhereInput {
  const where: Prisma.AssetWhereInput = {};
  if (state.q) {
    // contains-search with insensitive mode is the sanctioned use; the
    // ILIKE-wildcard hazard applies to identity/equals lookups only.
    where.OR = [
      { tag: { contains: state.q, mode: "insensitive" } },
      { model: { contains: state.q, mode: "insensitive" } },
      { serial: { contains: state.q, mode: "insensitive" } },
    ];
  }
  const f = state.filters;
  const statuses = (f.status ?? []).filter((s): s is AssetStatus =>
    (ASSET_STATUSES as readonly string[]).includes(s));
  if (statuses.length) where.status = { in: statuses };
  if (f.category?.length) where.categoryId = { in: f.category };
  if (f.type?.length) where.typeId = { in: f.type };
  if (f.assignee?.length) where.assigneeId = { in: f.assignee };
  // `stage` is DERIVED, and one of its four values (beyond-repair) compares
  // repairQuote against cost — something no Prisma filter can express. So the
  // facet narrows to the repair CANDIDATE set here and repairStage() makes the
  // final cut in listAssets: one source of truth, correct counts.
  // AND coexists with the q-driven OR above; Prisma ands them together.
  if ((f.stage ?? []).some(isRepairStage)) {
    where.AND = [{ OR: [{ status: "DEFECTIVE" }, { defectiveSince: { not: null } }] }];
  }
  return where;
}

export function buildAssetOrderBy(sort: SortKey[]): Prisma.AssetOrderByWithRelationInput[] {
  const order = sort.length ? sort : INVENTORY_LIST_CONFIG.defaultSort;
  return order.map(({ key, dir }): Prisma.AssetOrderByWithRelationInput =>
    key === "category" ? { category: { name: dir } } : { [key]: dir });
}
