import type { Prisma } from "@prisma/client";
import { addDays } from "./deadlines";
import { localDateISO } from "./format";
import type { ListConfig, ListState } from "./url-state";

export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "purchase-request", "user",
  "asset-category", "asset-type", "department", "equipment-policy",
  "feature-flag", "webhook-endpoint",
  "vendor", "stock-item", "stock-category", "stocktake", // Phase 27 (spec §3.3): rows the page already renders and links
] as const;

export const AUDIT_LIST_CONFIG: ListConfig = {
  facets: ["entity", "when"],
  sortable: [], // append-only log renders newest-first, always
  defaultSort: [],
};

/** Ids of the class-bearing rows a role may NOT see — one list per audit entityType that has a class (spec §3.3). */
export interface HiddenAuditRefs { assetIds: string[]; approvalIds: string[]; categoryIds: string[]; typeIds: string[] }
export const NO_HIDDEN_REFS: HiddenAuditRefs = { assetIds: [], approvalIds: [], categoryIds: [], typeIds: [] };

export const WHEN_VALUES = ["today", "7d", "30d"] as const;
export const WHEN_LABEL: Record<(typeof WHEN_VALUES)[number], string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

const manilaMidnight = (iso: string) => new Date(`${iso}T00:00:00+08:00`);

/** Spec §6.2, on the Manila calendar: today → from today's midnight; 7d → the last 7 days including today; 30d likewise. */
export function whenRange(value: string | undefined, todayISO: string): { gte: Date } | null {
  const back = value === "today" ? 0 : value === "7d" ? 6 : value === "30d" ? 29 : null;
  if (back === null) return null;
  return { gte: manilaMidnight(addDays(todayISO, -back)) };
}

export function buildAuditWhere(
  state: ListState,
  hidden: HiddenAuditRefs = NO_HIDDEN_REFS,
  matchIds: string[] = [],
  todayISO: string = localDateISO(),
): Prisma.AuditEntryWhereInput {
  const where: Prisma.AuditEntryWhereInput = {};
  if (state.q) {
    where.OR = [
      { action: { contains: state.q, mode: "insensitive" } },
      { entityId: { contains: state.q, mode: "insensitive" } },
      { actorLabel: { contains: state.q, mode: "insensitive" } },
      ...(matchIds.length ? [{ entityId: { in: matchIds } }] : []),
    ];
  }
  if (state.filters.entity?.length) where.entityType = { in: state.filters.entity };
  const when = whenRange(state.filters.when?.[0], todayISO);
  if (when) where.createdAt = when;
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
