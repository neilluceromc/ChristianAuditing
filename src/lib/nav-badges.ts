import type { CountKey, VisibleItem, VisibleSection } from "./workspaces";

export interface ApprovalsBadge {
  open: number;
  overdue: number;
}

/**
 * Every nav count the shell carries (Phase 42 spec §4.3). `counts` holds only the keys the visible nav asked for;
 * `counts.approvals` is `approvals.open`, and `approvals.overdue` decides the red.
 */
export interface NavBadges {
  approvals: ApprovalsBadge;
  counts: Partial<Record<CountKey, number>>;
}

/** One badge as drawn: the number, its aria-label, and whether it is red. */
export interface BadgeView {
  n: number;
  label: string;
  fault: boolean;
}

/** Spec §4.3's accessible labels, word for word. The approvals label stays plural ("1 open approvals") as today. */
const LABEL: Record<CountKey, (n: number) => string> = {
  worklist: (n) => `${n} waiting on the worklist`,
  approvals: (n) => `${n} open approvals`,
  itSpare: (n) => `${n} spare`,
  itDefective: (n) => `${n} in repair`,
  itMissing: (n) => `${n} missing`,
  leaving: (n) => `${n} leaving`,
  poSentBack: (n) => `${n} sent back`,
  poWithIt: (n) => `${n} with IT`,
  poReady: (n) => `${n} ready to register`,
  // Phase 46 spec §4.3
  stockLow: (n) => `${n} below reorder level`,
  stocktakesOverdue: (n) => `${n} overdue`,
  // RENEWING_DAYS (supplier-list.ts), spelled out: importing it would pull the supplier schema into the shell bundle.
  suppliersRenewing: (n) => `${n} renewing within 30 days`,
  finToConfirmIt: (n) => `${n} IT registration${n === 1 ? "" : "s"} to confirm`,
  finToConfirmPurchasing: (n) => `${n} Purchasing registration${n === 1 ? "" : "s"} to confirm`,
  // Task 6 (spec §5)
  finGroupsToReview: (n) => `${n} group${n === 1 ? "" : "s"} to review`,
  usersDisabled: (n) => `${n} disabled`,
  deadDeliveries: (n) => `${n} failed deliver${n === 1 ? "y" : "ies"}`,
  flagsUnavailable: (n) => `${n} unavailable`,
};

/** Counts drawn red with a dot whenever they show (spec §4.3): failed webhook deliveries wait on a replay. */
const ALWAYS_URGENT: ReadonlySet<CountKey> = new Set<CountKey>(["deadDeliveries"]);

/** The count keys the visible links and views use, each once: only these are read (spec §4.3). */
export function navCountKeys(sections: VisibleSection[]): CountKey[] {
  const keys = new Set<CountKey>();
  for (const item of sections.flatMap((s) => s.items)) {
    for (const key of item.badge) keys.add(key);
    for (const view of item.views) if (view.count) keys.add(view.count);
  }
  return [...keys];
}

/** One count as a badge; null when there is nothing to show. Red for approvals with any overdue, and failed deliveries. */
export function countBadge(key: CountKey, n: number, badges: NavBadges): BadgeView | null {
  if (n <= 0) return null;
  const overdue = key === "approvals" && badges.approvals.overdue > 0;
  return { n, label: LABEL[key](n) + (overdue ? ", some past SLA" : ""), fault: overdue || ALWAYS_URGENT.has(key) };
}

/**
 * A link's own badge: the sum of its badge keys. Migration 38 moved IT's purchase reviews off Approvals onto their
 * own "Purchase orders" item (poWithIt), so no link sums keys today; a future one reads as its parts.
 */
export function itemBadge(item: VisibleItem, badges: NavBadges): BadgeView | null {
  const count = (key: CountKey) => badges.counts[key] ?? 0;
  const keys = item.badge;
  if (keys.length === 0) return null;
  if (keys.length === 1) return countBadge(keys[0], count(keys[0]), badges);
  const parts = keys.map((k) => countBadge(k, count(k), badges)).filter((p): p is BadgeView => p !== null);
  if (parts.length === 0) return null;
  return {
    n: parts.reduce((sum, p) => sum + p.n, 0),
    label: parts.map((p) => p.label).join(", "),
    fault: parts.some((p) => p.fault),
  };
}
