/**
 * Brief §8: mutations 60/min per user, imports 10/min. `import_plan` (R-2,
 * round 2) is a DELIBERATE deviation from that literal "imports 10/min":
 * the number now names the WRITE specifically, and the read-only plan
 * (dry-run) stage gets its own, more generous kind. A dry run costs ~15ms of
 * queries and writes nothing (no transaction, no row, no persisted plan —
 * scope decisions 3 and 8), so it doesn't need the budget that bounds a call
 * writing 2,000 assets plus 2,000 audit rows; at 10/min, a realistic messy-
 * file session (bad header, re-upload, a few option flips, one un-tick to
 * compare) can land an operator exactly on the cap with no slack, locking
 * them out for a minute WHILE HOLDING a fully-planned import they can't yet
 * apply. `RateEvent.kind` is a plain `String` column, so adding a kind here
 * needs no migration.
 */
export const RATE_LIMITS = {
  mutation: { limit: 60, windowMs: 60_000 },
  import: { limit: 10, windowMs: 60_000 },
  import_plan: { limit: 60, windowMs: 60_000 },
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
