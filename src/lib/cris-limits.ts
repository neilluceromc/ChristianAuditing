/** Asia/Manila is UTC+8 all year (no daylight saving), so its midnight is a fixed offset from UTC. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Spec §9: the daily limit counts user messages since Manila midnight — the instant that day began. */
export function manilaDayStart(now: Date): Date {
  const local = now.getTime() + MANILA_OFFSET_MS;
  return new Date(local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - MANILA_OFFSET_MS);
}

/** Questions left today; never below zero (a limit lowered mid-day leaves 0, not a negative). */
export function dailyLeft(used: number, limit: number): number {
  return Math.max(0, limit - used);
}

/**
 * Review Focus #5: with `used` questions already asked today, is the next one refused? The 100th question (99
 * used) is answered; the 101st (100 used) is refused with the daily-limit copy before any model call.
 */
export function limitReached(used: number, limit: number): boolean {
  return used >= limit;
}

/** Spec §9, verbatim: what the box says when the daily limit is reached (the mascot plays Sad). */
export const CRIS_DAILY_LIMIT_TEXT = "That's all my questions for today — the limit resets at midnight";
