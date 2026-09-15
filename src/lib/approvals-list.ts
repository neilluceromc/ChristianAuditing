import type { ApprovalType, Prisma } from "@prisma/client";

/** README 1k tab order. `?tab=` is the URL contract; open is the default. */
export const QUEUE_TABS = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "unclaimed", label: "Unclaimed" },
  { id: "failed", label: "Failed" },
  { id: "closed", label: "Closed" },
] as const;

export type QueueTab = (typeof QUEUE_TABS)[number]["id"];

export function parseTab(raw: string | null | undefined): QueueTab {
  return (QUEUE_TABS.some((t) => t.id === raw) ? raw : "open") as QueueTab;
}

/**
 * The five tabs' counts overlap by design (Open ⊇ Mine ∪ Unclaimed — a
 * CLAIMED row you claimed is on both Open and Mine; a PENDING row is on both
 * Open and Unclaimed). Closed is REJECTED ∪ EXECUTED regardless of how the
 * row got there (queued and resolved, or applied directly, Phase 21); `via`
 * (viaWhere below) narrows Closed only — it is not one of these five tabs.
 */
export function tabWhere(tab: QueueTab, userId: string): Prisma.ApprovalWhereInput {
  switch (tab) {
    case "open": return { state: { in: ["PENDING", "CLAIMED"] } };
    case "mine": return { state: "CLAIMED", claimedById: userId };
    case "unclaimed": return { state: "PENDING" };
    case "failed": return { state: "EXECUTION_FAILED" };
    case "closed": return { state: { in: ["REJECTED", "EXECUTED"] } };
  }
}

/** Closed tab's `?via=` narrowing (Phase 21: appliedDirectly). */
export const CLOSED_VIA = ["all", "direct", "queue"] as const;
export type ClosedVia = (typeof CLOSED_VIA)[number];

export function parseVia(raw: string | null | undefined): ClosedVia {
  return (CLOSED_VIA as readonly string[]).includes(raw ?? "") ? (raw as ClosedVia) : "all";
}

export function viaWhere(via: ClosedVia): Prisma.ApprovalWhereInput {
  switch (via) {
    case "all": return {};
    case "direct": return { appliedDirectly: true };
    case "queue": return { appliedDirectly: false };
  }
}

export const CLOSED_VIA_LABEL: Record<ClosedVia, string> = {
  all: "All",
  direct: "Applied directly",
  queue: "Through the queue",
};

/** Home's "Applied directly · last 7 days" section window. */
export const DIRECT_WINDOW_DAYS = 7;

export const DIRECT_KIND_LABEL: Record<ApprovalType, string> = {
  lifecycle_assign: "Assigned",
  lifecycle_return: "Returned",
  lifecycle_change_status: "Status changed",
  lifecycle_replace: "Replaced",
  lifecycle_transfer: "Transferred",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Overdue renders 600-weight in the fault text colour (README 1k). */
export function slaLabel(slaAt: Date, now: Date = new Date()): { text: string; overdue: boolean } {
  const delta = slaAt.getTime() - now.getTime();
  const overdue = delta < 0;
  const abs = Math.abs(delta);
  const amount = abs >= DAY_MS ? `${Math.round(abs / DAY_MS)} d` : `${Math.max(1, Math.round(abs / HOUR_MS))} h`;
  return { text: overdue ? `${amount} overdue` : `in ${amount}`, overdue };
}
