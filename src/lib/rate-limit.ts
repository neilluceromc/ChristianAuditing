/** Brief §8: mutations 60/min per user, imports 10/min. */
export const RATE_LIMITS = {
  mutation: { limit: 60, windowMs: 60_000 },
  import: { limit: 10, windowMs: 60_000 },
} as const;

export type RateKind = keyof typeof RATE_LIMITS;

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

/**
 * Pure decision. `recent` = this user's event timestamps inside the window,
 * NEWEST FIRST, at most `limit` of them. Blocked until the limit-th newest
 * event leaves the window.
 */
export function rateDecision(recent: Date[], kind: RateKind, now: Date): RateDecision {
  const { limit, windowMs } = RATE_LIMITS[kind];
  if (recent.length < limit) return { allowed: true };
  const nthNewest = recent[limit - 1];
  const freesAt = nthNewest.getTime() + windowMs;
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)) };
}
