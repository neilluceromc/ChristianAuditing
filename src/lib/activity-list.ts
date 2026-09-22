import { Prisma } from "@prisma/client";
import type { HiddenAuditRefs } from "./audit-list";
import type { ListConfig, ListState } from "./url-state";

/** Phase 27 (spec §3.4): the four activity feeds, one list config, one where-builder. */
export const ACTIVITY_FEEDS = ["inventory", "employees", "finance", "purchases"] as const;
export type ActivityFeed = (typeof ACTIVITY_FEEDS)[number];

export const ACTIVITY_LIST_CONFIG: ListConfig = { facets: ["action"], sortable: [], defaultSort: [] };

/**
 * Each feed's base predicate, moved verbatim from its page. Asset rows a role cannot see (spec §3.3's
 * hidden refs) leave the inventory feed and finance's asset branch alike; the finance predicate was
 * `financeActivityWhere` in finance/queries.ts until Phase 27.
 */
export function feedWhere(feed: ActivityFeed, hidden: HiddenAuditRefs): Prisma.AuditEntryWhereInput {
  const assetRows = (extra: Prisma.AuditEntryWhereInput = {}): Prisma.AuditEntryWhereInput => ({
    entityType: "asset",
    ...extra,
    ...(hidden.assetIds.length ? { entityId: { notIn: hidden.assetIds } } : {}),
  });
  switch (feed) {
    case "inventory": return assetRows();
    case "employees": return { entityType: "employee" };
    case "finance": return { OR: [{ entityType: "purchase-request" }, assetRows({ diff: { path: ["cost"], not: Prisma.DbNull } })] };
    case "purchases": return { entityType: "purchase-request" };
  }
}

export function buildActivityWhere(feed: ActivityFeed, state: ListState, hidden: HiddenAuditRefs): Prisma.AuditEntryWhereInput {
  const base = feedWhere(feed, hidden);
  const actions = state.filters.action;
  return actions?.length ? { AND: [base, { action: { in: actions } }] } : base;
}
