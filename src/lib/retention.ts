/** Phase 24 (spec §4.2, decision 2): one retention rule for the worker's two tables. */
export const RETENTION_DAYS = 90;
export const PRUNE_BATCH = 1_000;
export const PRUNE_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}
export function pruneDue(lastPruneAt: Date | null, now: Date): boolean {
  return lastPruneAt === null || now.getTime() - lastPruneAt.getTime() >= PRUNE_INTERVAL_MS;
}
/** The deliveries page's sentence, built from the constant so the copy cannot drift from the rule. */
export const RETENTION_NOTE = `Attempts older than ${RETENTION_DAYS} days are removed automatically.`;
