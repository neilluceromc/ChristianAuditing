import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";

export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "purchase-request", "user",
  "asset-category", "asset-type", "department", "equipment-policy",
  "feature-flag", "webhook-endpoint",
] as const;

export const AUDIT_LIST_CONFIG: ListConfig = {
  facets: ["entity"],
  sortable: [], // append-only log renders newest-first, always
  defaultSort: [],
};

export function buildAuditWhere(state: ListState, hiddenAssetIds: string[] = []): Prisma.AuditEntryWhereInput {
  const where: Prisma.AuditEntryWhereInput = {};
  if (state.q) {
    where.OR = [
      { action: { contains: state.q, mode: "insensitive" } },
      { entityId: { contains: state.q, mode: "insensitive" } },
      { actorLabel: { contains: state.q, mode: "insensitive" } },
    ];
  }
  if (state.filters.entity?.length) where.entityType = { in: state.filters.entity };
  // Phase 14 (spec §3.1): rows about assets this role cannot see are not its
  // audit trail either. Empty for an all-class role — no clause at all.
  if (hiddenAssetIds.length) where.NOT = { entityType: "asset", entityId: { in: hiddenAssetIds } };
  return where;
}
