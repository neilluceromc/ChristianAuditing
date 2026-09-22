import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";

export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "purchase-request", "user",
  "asset-category", "asset-type", "department", "equipment-policy",
  "feature-flag", "webhook-endpoint",
  "vendor", "stock-item", "stock-category", "stocktake", // Phase 27 (spec §3.3): rows the page already renders and links
] as const;

export const AUDIT_LIST_CONFIG: ListConfig = {
  facets: ["entity"],
  sortable: [], // append-only log renders newest-first, always
  defaultSort: [],
};

/** Ids of the class-bearing rows a role may NOT see — one list per audit entityType that has a class (spec §3.3). */
export interface HiddenAuditRefs { assetIds: string[]; approvalIds: string[]; categoryIds: string[]; typeIds: string[] }
export const NO_HIDDEN_REFS: HiddenAuditRefs = { assetIds: [], approvalIds: [], categoryIds: [], typeIds: [] };

export function buildAuditWhere(state: ListState, hidden: HiddenAuditRefs = NO_HIDDEN_REFS): Prisma.AuditEntryWhereInput {
  const where: Prisma.AuditEntryWhereInput = {};
  if (state.q) {
    where.OR = [
      { action: { contains: state.q, mode: "insensitive" } },
      { entityId: { contains: state.q, mode: "insensitive" } },
      { actorLabel: { contains: state.q, mode: "insensitive" } },
    ];
  }
  if (state.filters.entity?.length) where.entityType = { in: state.filters.entity };
  // Phase 14 (spec §3.1), generalised in Phase 27 (spec §3.3): rows about class-bearing things this
  // role cannot see are not its audit trail either. No clause at all for an all-class role.
  const branches = ([
    ["asset", hidden.assetIds], ["approval", hidden.approvalIds],
    ["asset-category", hidden.categoryIds], ["asset-type", hidden.typeIds],
  ] as const)
    .filter(([, ids]) => ids.length > 0)
    .map(([entityType, ids]) => ({ entityType, entityId: { in: [...ids] } }));
  if (branches.length) where.NOT = { OR: branches };
  return where;
}
