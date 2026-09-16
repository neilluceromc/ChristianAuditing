import { Pill } from "@/components/ui/pill";
import type { ExpiringStatus } from "@/server/modules/stock/queries";

/**
 * Task 7 review (Minor): the on-hand report used to render EXPIRED in a
 * bespoke danger-colored pill, distinct from the plain `tone="accent"`
 * EXPIRING/EXPIRED pills Task 6 renders on the item page and the stock list.
 * One component now, reused in all three places, so the same status reads
 * the same way everywhere. EXPIRED outranks EXPIRING (never both).
 */
export function ExpiryPill({ expiring }: { expiring: ExpiringStatus }) {
  if (expiring === "expired") return <Pill tone="accent">EXPIRED</Pill>;
  if (expiring === "expiring") return <Pill tone="accent">EXPIRING</Pill>;
  return null;
}
