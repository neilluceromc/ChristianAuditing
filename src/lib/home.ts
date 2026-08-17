/**
 * Home's arithmetic, kept pure so the dashboard's judgement calls are testable:
 * what breaks first, how old the fleet is, whether the spare pool covers the
 * people starting next week, and what "cleared for the rest of the day" means.
 */
export type ShiftKind = "SLA" | "EXEC" | "HIRE" | "LEAVE" | "DATA";

export interface ShiftRow {
  /** stable identity for dismissal: "<kind>:<entityId>" */
  key: string;
  kind: ShiftKind;
  title: string;
  /** the mono metadata line */
  meta: string;
  href: string;
  /** the one action that clears it */
  action: string;
  /** higher = worse, compared only within a kind (days overdue, days stuck, …) */
  severity: number;
}

/**
 * README: the rows are ordered by *what breaks first*, not recency. A breached
 * SLA outranks a failed execution outranks a leaver mid-offboarding outranks a
 * hire without kit outranks a data finding.
 */
export const KIND_RANK: Record<ShiftKind, number> = {
  SLA: 0, EXEC: 1, LEAVE: 2, HIRE: 3, DATA: 4,
};

export const SHIFT_LIMIT = 5;

export function shiftOrder(rows: ShiftRow[], dismissed: Set<string> = new Set()): ShiftRow[] {
  return [...rows]
    .filter((r) => !dismissed.has(r.key))
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.severity - a.severity)
    .slice(0, SHIFT_LIMIT);
}

export const AGE_BUCKETS = ["<1y", "1–2y", "2–3y", "3–4y", "4y+"] as const;

export type AgeBucket = (typeof AGE_BUCKETS)[number];

const YEAR_MS = 365 * 86_400_000;

/** null = no purchase date recorded; an unknown age must not read as "new". */
export function ageBucket(purchasedAt: Date | null | undefined, now: Date = new Date()): AgeBucket | null {
  if (!purchasedAt) return null;
  const years = Math.floor((now.getTime() - purchasedAt.getTime()) / YEAR_MS);
  if (years <= 0) return "<1y";
  if (years >= 4) return "4y+";
  return AGE_BUCKETS[years];
}

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

export function warrantyDaysLeft(until: Date, now: Date = new Date()): number {
  return Math.round((until.getTime() - now.getTime()) / 86_400_000);
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

/** Asia/Manila day stamp — the business's day, so "the rest of the day" means theirs. */
export function todayStamp(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export interface WarrantyLike {
  id: string;
  model: string;
  days: number;
}

/**
 * README: the runway's job is to surface that *two identical laptops expire the
 * same week* — one row is a diary note, two is a purchase order. "Same week"
 * is relative, not aligned to a fixed calendar boundary: two same-model rows
 * cluster when they're within 7 days of each other, so a pair 2 days apart
 * clusters and a pair 2 months apart doesn't, regardless of where the 7-day
 * window would land if it were pinned to day zero.
 */
export function warrantyClusters<T extends WarrantyLike>(rows: T[]): Array<T & { clustered: boolean }> {
  const clustered = new Set<number>();
  const byModel = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const indices = byModel.get(r.model) ?? [];
    indices.push(i);
    byModel.set(r.model, indices);
  });
  for (const indices of byModel.values()) {
    const sorted = [...indices].sort((a, b) => rows[a].days - rows[b].days);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (Math.abs(rows[sorted[i + 1]].days - rows[sorted[i]].days) < 7) {
        clustered.add(sorted[i]);
        clustered.add(sorted[i + 1]);
      }
    }
  }
  return rows.map((r, i) => ({ ...r, clustered: clustered.has(i) }));
}
