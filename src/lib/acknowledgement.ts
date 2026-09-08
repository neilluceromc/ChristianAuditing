export interface AckItem { assetId: string; tag: string; model: string; serial: string | null }

/** Held items the last signed form does not cover. With no form on file, all of them. */
export function uncoveredItems<A extends { assetId: string; tag: string }>(held: A[], last: Array<{ assetId: string }> | null): A[] {
  if (!last) return held;
  const covered = new Set(last.map((i) => i.assetId));
  return held.filter((h) => !covered.has(h.assetId));
}

/**
 * Ruling R10: a signing date is a calendar date, not an instant. Someone
 * signing shortly after local midnight in a timezone ahead of UTC (e.g.
 * Manila, UTC+8) must still be able to pick "today" even though `now` in
 * UTC still reads as yesterday. So the refusal line is one full day out:
 * the UTC calendar date of `now + 1 day`.
 */
export function latestSigningDate(now: Date): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}
