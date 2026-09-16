import { localDateISO } from "./format";

/**
 * Spec §4.1. A lot's live state as the caller (server, or the seed's own
 * `issue()` helper) has already reduced it: `remaining` is `quantity − Σ
 * allocations`, computed by the caller under the item's row lock (P-2) — this
 * module never touches a database and never mutates a `LotState` it is
 * handed. `lotDate` and `expiresAt` are calendar dates stored as UTC
 * midnight `Date` objects (how `receiveStock` writes them); `expiresAt` is
 * `null` for a lot with no expiry (every D1 lot, and most D2 ones).
 */
export interface LotState {
  id: string;
  remaining: number;
  unitCost: number | null;
  lotDate: Date;
  expiresAt: Date | null;
}

/**
 * "skip" — an ordinary issue: expired lots are left alone entirely (the
 * caller refuses instead, spec §5.2's issueStock). "first" — a write-off or
 * an adjustment consuming stock: expired lots are consumed before any
 * unexpired one, so the oldest waste is what a correction clears first.
 */
export type ExpiredPolicy = "skip" | "first";

export interface Allocation {
  lotId: string;
  quantity: number;
  unitCost: number | null;
}

export type AllocationResult =
  | { ok: true; allocations: Allocation[]; cost: number | null; costedUnits: number; uncostedUnits: number }
  | { ok: false; short: number; expiredRemaining: number };

/** Spec §2.5: `expired(lot, today) = expiresAt !== null && expiresAt < today` on the Asia/Manila calendar. */
export function isExpired(expiresAt: Date | null, today: string): boolean {
  return expiresAt !== null && localDateISO(expiresAt) < today;
}

/**
 * Ascending by expiry, undated last, then lot date, then id — the one
 * comparator both policies share. A lot that is expired always sorts before
 * one that is not: `today` is fixed for the whole call, so every expired
 * lot's `expiresAt` is strictly less than every non-expired lot's (an
 * unexpired lot's `expiresAt` is `null` or `>= today`) — which is exactly
 * "expired lots (soonest-expired first) come before the rest" (spec §4.1)
 * for free, with no separate partition step.
 */
function compareLots(a: LotState, b: LotState): number {
  const at = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
  const bt = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  const ad = a.lotDate.getTime();
  const bd = b.lotDate.getTime();
  if (ad !== bd) return ad - bd;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function consumptionOrder(lots: LotState[], today: string, policy: ExpiredPolicy): LotState[] {
  if (policy === "skip") {
    return lots.filter((l) => !isExpired(l.expiresAt, today)).sort(compareLots);
  }
  return [...lots].sort(compareLots);
}

/**
 * Refuses `quantity <= 0` — a programming error (every caller validates the
 * user's own input first via `issueSchema`/`adjustSchema`/`writeOffSchema`,
 * all of which require at least one unit), not a user-facing refusal. Walks
 * `consumptionOrder`, taking `min(remaining, left)` from each lot with
 * remaining stock, and reports a shortfall — with the expired remaining the
 * caller needs to choose its refusal wording (spec §5.2) — when the lots run
 * out before the quantity does.
 */
export function allocate(lots: LotState[], quantity: number, today: string, policy: ExpiredPolicy): AllocationResult {
  if (quantity <= 0) throw new Error("allocate: quantity must be positive");

  const order = consumptionOrder(lots, today, policy).filter((l) => l.remaining > 0);
  const allocations: Allocation[] = [];
  let left = quantity;
  let cost = 0;
  let costedUnits = 0;
  let uncostedUnits = 0;

  for (const lot of order) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    if (take <= 0) continue;
    allocations.push({ lotId: lot.id, quantity: take, unitCost: lot.unitCost });
    if (lot.unitCost !== null) {
      cost += take * lot.unitCost;
      costedUnits += take;
    } else {
      uncostedUnits += take;
    }
    left -= take;
  }

  if (left > 0) {
    const expiredRemaining = lots
      .filter((l) => isExpired(l.expiresAt, today))
      .reduce((sum, l) => sum + l.remaining, 0);
    return { ok: false, short: left, expiredRemaining };
  }

  return { ok: true, allocations, cost: costedUnits === 0 ? null : cost, costedUnits, uncostedUnits };
}

export function lotRemaining(quantity: number, allocated: number): number {
  return quantity - allocated;
}

/** Spec §2.5: onHandValue and uncostedUnits, plus the plain unit total, over OPEN lots (remaining > 0). */
export function onHand(lots: LotState[]): { units: number; costedUnits: number; uncostedUnits: number; value: number } {
  let units = 0;
  let costedUnits = 0;
  let uncostedUnits = 0;
  let value = 0;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    units += lot.remaining;
    if (lot.unitCost !== null) {
      costedUnits += lot.remaining;
      value += lot.remaining * lot.unitCost;
    } else {
      uncostedUnits += lot.remaining;
    }
  }
  return { units, costedUnits, uncostedUnits, value };
}

const DAY_MS = 86_400_000;

/** "expired N days ago" / "expires today" / "expires in N days" — both sides on the Asia/Manila calendar day. */
export function expiryLabel(expiresAt: Date, today: string): string {
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const days = Math.round((expiresAt.getTime() - todayMs) / DAY_MS);
  if (days === 0) return "expires today";
  const n = Math.abs(days);
  const word = n === 1 ? "day" : "days";
  return days > 0 ? `expires in ${n} ${word}` : `expired ${n} ${word} ago`;
}

export const EXPIRY_WINDOWS = [7, 30, 90] as const;
export const DEFAULT_EXPIRY_WINDOW = 30;
