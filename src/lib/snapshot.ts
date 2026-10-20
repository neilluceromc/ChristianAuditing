import { localDateISO } from "./format";
import { addDays } from "./deadlines";

/**
 * Phase 46 (spec §2): the nightly MetricSnapshot. One row per key per Manila calendar day; the Overview's sparklines
 * and "vs last week" read them back. Counts are plain numbers; keys ending in `C` are money in centavos.
 */
export const SNAPSHOT_KEYS = [
  "it.spare", "it.deployed", "it.defective", "it.missing", "it.attention",
  "approvals.open.it", "approvals.open.purchasing", "approvals.open.none",
  "approvals.pastSla.it", "approvals.pastSla.purchasing", "approvals.pastSla.none",
  "pr.submitted", "pr.itReviewed",
  "stock.low", "stock.expiringLots", "stock.stocktakesOverdue",
  "fin.waitingC", "fin.waitingCount", "fin.toConfirm.it", "fin.toConfirm.purchasing", "fin.bookC",
  "admin.activeUsers", "admin.disabled", "admin.deadDeliveries",
] as const;
export type SnapshotKey = (typeof SNAPSHOT_KEYS)[number];

/** Points per history: today and the seven weeks before it (spec §2.4). */
export const HISTORY_POINTS = 8;
/** A sample day with no row borrows the nearest earlier row at most this many days back (spec §2.4). */
export const HISTORY_FILL_DAYS = 3;
/** The oldest day a history can read: the first sample day, minus the fill window. */
export const HISTORY_SPAN_DAYS = 7 * (HISTORY_POINTS - 1) + HISTORY_FILL_DAYS;

/** The Manila calendar day of `now`, `YYYY-MM-DD` — the snapshot's `day`. */
export function manilaDay(now: Date): string {
  return localDateISO(now);
}

/** Spec §2.3: due when today's Manila day has no snapshot yet (never taken, or taken on an earlier day). */
export function snapshotDue(lastDay: string | null, now: Date): boolean {
  return lastDay !== manilaDay(now);
}

/** Review ruling (overrides spec §2.3's "next loop"): a failing snapshot is retried at most this often. */
export const SNAPSHOT_RETRY_MS = 10 * 60_000;

/**
 * The worker loop's gate: today has no snapshot yet, and the last attempt (success or failure) was at least
 * SNAPSHOT_RETRY_MS ago, so a persistent failure costs one try per 10 minutes, not one per loop pass.
 */
export function snapshotAttemptDue(lastDay: string | null, lastAttemptAt: Date | null, now: Date): boolean {
  if (!snapshotDue(lastDay, now)) return false;
  return lastAttemptAt === null || now.getTime() - lastAttemptAt.getTime() >= SNAPSHOT_RETRY_MS;
}

/**
 * Spec §2.4: the values at today-7·k for k = 7…0, oldest first. A sample day with no row takes the nearest earlier
 * row within HISTORY_FILL_DAYS; otherwise it is null (never a made-up 0). `day`s are `YYYY-MM-DD`, so they compare
 * as strings.
 */
export function historyFromRows(rows: { day: string; value: bigint }[], today: string): (number | null)[] {
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  const points: (number | null)[] = [];
  for (let k = HISTORY_POINTS - 1; k >= 0; k--) {
    const target = addDays(today, -7 * k);
    let value: bigint | undefined;
    for (let back = 0; back <= HISTORY_FILL_DAYS && value === undefined; back++) value = byDay.get(addDays(target, -back));
    points.push(value === undefined ? null : Number(value));
  }
  return points;
}
