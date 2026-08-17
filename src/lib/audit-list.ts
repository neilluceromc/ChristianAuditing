import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";

export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "purchase-request", "user",
  "asset-category", "asset-type", "department",
] as const;

export const AUDIT_LIST_CONFIG: ListConfig = {
  facets: ["entity"],
  sortable: [], // append-only log renders newest-first, always
  defaultSort: [],
};

export function buildAuditWhere(state: ListState): Prisma.AuditEntryWhereInput {
  const where: Prisma.AuditEntryWhereInput = {};
  if (state.q) {
    where.OR = [
      { action: { contains: state.q, mode: "insensitive" } },
      { entityId: { contains: state.q, mode: "insensitive" } },
      { actorLabel: { contains: state.q, mode: "insensitive" } },
    ];
  }
  if (state.filters.entity?.length) where.entityType = { in: state.filters.entity };
  return where;
}
