import type { Prisma } from "@prisma/client";

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

export function tabWhere(tab: QueueTab, userId: string): Prisma.ApprovalWhereInput {
  switch (tab) {
    case "open": return { state: { in: ["PENDING", "CLAIMED"] } };
    case "mine": return { state: "CLAIMED", claimedById: userId };
    case "unclaimed": return { state: "PENDING" };
    case "failed": return { state: "EXECUTION_FAILED" };
    case "closed": return { state: { in: ["REJECTED", "EXECUTED"] } };
  }
}

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
