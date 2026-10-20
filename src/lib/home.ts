/**
 * Home's arithmetic, kept pure so the dashboard's judgement calls are testable:
 * whether the spare pool covers the people starting next week, and what "cleared for the rest of the day" means.
 */
export interface Coverage {
  covered: number;
  needed: number;
  text: string;
}

/**
 * The line under the Fleet bar. Per asset type, one spare covers one unfilled
 * required slot — greedy, and never counting more spares than slots.
 */
export function coverageLine(
  spareByType: Record<string, number>,
  neededByType: Record<string, number>,
): Coverage {
  let covered = 0;
  let needed = 0;
  for (const [type, count] of Object.entries(neededByType)) {
    needed += count;
    covered += Math.min(count, spareByType[type] ?? 0);
  }
  const text = needed === 0
    ? "no incoming hires need equipment right now"
    : `spare pool covers ${covered} of the ${needed} slot${needed === 1 ? "" : "s"} the incoming hires need`;
  return { covered, needed, text };
}

/** UserPreference key holding today's cleared rows. */
export const DISMISS_PREF_KEY = "home:dismissed";

export interface DismissPref {
  date: string;
  keys: string[];
}

function asPref(value: unknown): DismissPref | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<DismissPref>;
  return typeof v.date === "string" && Array.isArray(v.keys) ? { date: v.date, keys: v.keys.filter((k) => typeof k === "string") } : null;
}

/** Cleared items leave for the rest of the day — a new date forgets them. */
export function activeDismissals(value: unknown, today: string): Set<string> {
  const pref = asPref(value);
  return new Set(pref && pref.date === today ? pref.keys : []);
}

export function withDismissal(value: unknown, today: string, key: string): DismissPref {
  const pref = asPref(value);
  if (!pref || pref.date !== today) return { date: today, keys: [key] };
  return pref.keys.includes(key) ? pref : { date: today, keys: [...pref.keys, key] };
}

/** Undo for one hidden row (spec §5.2): today's set without that key. */
export function withoutDismissal(value: unknown, today: string, key: string): DismissPref {
  const pref = asPref(value);
  if (!pref || pref.date !== today) return { date: today, keys: [] };
  return { date: today, keys: pref.keys.filter((k) => k !== key) };
}

/** Asia/Manila day stamp — the business's day, so "the rest of the day" means theirs. */
export function todayStamp(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}
