/**
 * Phase 35 (spec §5.2): straight-line depreciation, computed on read. Integer centavos and
 * Asia/Manila calendar months throughout; every screen and export calls these functions.
 * Phase 38 (spec §2): an asset depreciates from its purchase month (approval month when it has no purchase date),
 * that month counted in full, and the current month is taken (not projected).
 */
export type MonthIndex = number;

const MANILA = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Manila" });
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function manilaMonth(d: Date): MonthIndex {
  const [y, m] = MANILA.format(d).split("-").map(Number);
  return y * 12 + (m - 1);
}

/** Phase 38: the current Manila month — it is counted as actual, not projected. */
export function asOfMonth(now: Date): MonthIndex {
  return manilaMonth(now);
}

/**
 * Phase 38 (spec §2): the month an asset starts depreciating (month 1, charged in full): the purchase month, or the
 * approval month when there is no purchase date. Null while Finance has not approved it.
 */
export function depStartMonth(asset: { purchasedAt: Date | null; financeConfirmedAt: Date | null }): MonthIndex | null {
  if (!asset.financeConfirmedAt) return null;
  return manilaMonth(asset.purchasedAt ?? asset.financeConfirmedAt);
}

export function monthLabel(m: MonthIndex): string {
  return `${MONTH_NAMES[((m % 12) + 12) % 12]} ${Math.floor(m / 12)}`;
}

export function toCentavos(v: number | string | { toString(): string } | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(Number(typeof v === "object" ? v.toString() : v) * 100);
}

export interface Policy { lifeMonths: number; salvage: number; basis: "category" | "custom" }

export function resolvePolicy(
  asset: { cost: number; lifeMonths: number | null; salvage: number | null },
  category: { lifeMonths: number | null; salvagePercent: number | null },
): Policy | null {
  if (asset.lifeMonths !== null && asset.salvage !== null) {
    return { lifeMonths: asset.lifeMonths, salvage: asset.salvage, basis: "custom" };
  }
  if (category.lifeMonths === null) return null;
  const salvage = Math.round((asset.cost * (category.salvagePercent ?? 0)) / 100);
  return { lifeMonths: category.lifeMonths, salvage, basis: "category" };
}

export type DepState = "depreciating" | "fully-depreciated" | "not-started" | "no-policy" | "bad-salvage";
export interface DepResult {
  state: DepState; cost: number; accumulated: number; bookValue: number;
  monthly: number | null; startMonth: MonthIndex | null; policy: Policy | null;
}

function chargeFor(base: number, life: number, k: number): number {
  if (k < 1 || k > life) return 0;
  const monthly = Math.floor(base / life);
  return k < life ? monthly : base - monthly * (life - 1);
}

function accumulatedThrough(base: number, life: number, start: MonthIndex, through: MonthIndex): number {
  const months = Math.min(Math.max(through - start + 1, 0), life);
  if (months === life) return base;
  return Math.floor(base / life) * months;
}

/** `start` is `depStartMonth(...)`: null means Finance has not approved the asset. */
export function depreciate(cost: number, start: MonthIndex | null, policy: Policy | null, asOf: MonthIndex): DepResult {
  const flat = (state: DepState, startMonth: MonthIndex | null): DepResult =>
    ({ state, cost, accumulated: 0, bookValue: cost, monthly: null, startMonth, policy });
  if (start === null) return flat("not-started", null);
  if (!policy) return flat("no-policy", start);
  if (policy.salvage >= cost) return flat("bad-salvage", start);
  if (start > asOf) return flat("not-started", start);
  const base = cost - policy.salvage;
  const accumulated = accumulatedThrough(base, policy.lifeMonths, start, asOf);
  return {
    state: accumulated === base ? "fully-depreciated" : "depreciating",
    cost, accumulated, bookValue: cost - accumulated,
    monthly: Math.floor(base / policy.lifeMonths), startMonth: start, policy,
  };
}

export interface YearRow { opening: number; months: number[]; projected: boolean[]; total: number; closing: number }

export function yearGrid(cost: number, start: MonthIndex | null, policy: Policy | null, year: number, asOf: MonthIndex): YearRow | null {
  if (start === null || !policy || policy.salvage >= cost) return null;
  const first = year * 12;
  if (start > first + 11) return null;
  const base = cost - policy.salvage;
  const months = Array.from({ length: 12 }, (_, i) => chargeFor(base, policy.lifeMonths, first + i - start + 1));
  const opening = cost - accumulatedThrough(base, policy.lifeMonths, start, first - 1);
  const total = months.reduce((a, b) => a + b, 0);
  if (total === 0 && opening <= policy.salvage) return null;
  return { opening, months, projected: months.map((_, i) => first + i > asOf), total, closing: opening - total };
}

/** The one summing rule: element-wise sum of year rows; `projected` is the year's own flags (the same for every row of a year). */
export function sumYearRows(rows: readonly YearRow[], year: number, asOf: MonthIndex): YearRow {
  const first = year * 12;
  return {
    opening: rows.reduce((a, r) => a + r.opening, 0),
    months: Array.from({ length: 12 }, (_, i) => rows.reduce((a, r) => a + r.months[i], 0)),
    projected: Array.from({ length: 12 }, (_, i) => first + i > asOf),
    total: rows.reduce((a, r) => a + r.total, 0),
    closing: rows.reduce((a, r) => a + r.closing, 0),
  };
}

export function stateNote(r: DepResult, categoryName: string): string | null {
  switch (r.state) {
    case "not-started": return "Not depreciating yet";
    case "no-policy": return `No policy for ${categoryName}`;
    case "bad-salvage": return r.policy?.basis === "custom" ? "Salvage is not below cost — check the override" : "Salvage is not below cost";
    case "fully-depreciated": return "Fully depreciated";
    default: return null;
  }
}

export function affectedByPolicy(rows: Array<{ costC: number | null; custom: boolean }>): number {
  return rows.filter((r) => r.costC !== null && !r.custom).length;
}

export interface LifeYear {
  year: number; opening: number; total: number; closing: number; done: number; projected: number;
  months: Array<{ month: MonthIndex; opening: number; charge: number; closing: number; projected: boolean }>;
}

/** Phase 35 (spec 4.2 item 5): the asset page's year-by-year schedule over the whole life. */
export function lifeYears(cost: number, start: MonthIndex | null, policy: Policy | null, asOf: MonthIndex): LifeYear[] {
  if (start === null || !policy || policy.salvage >= cost) return [];
  const end = start + policy.lifeMonths - 1;
  const base = cost - policy.salvage;
  const out: LifeYear[] = [];
  let book = cost;
  for (let y = Math.floor(start / 12); y <= Math.floor(end / 12); y++) {
    const months: LifeYear["months"] = [];
    const opening = book;
    for (let m = Math.max(y * 12, start); m <= Math.min(y * 12 + 11, end); m++) {
      const charge = chargeFor(base, policy.lifeMonths, m - start + 1);
      months.push({ month: m, opening: book, charge, closing: book - charge, projected: m > asOf });
      book -= charge;
    }
    const projected = months.filter((x) => x.projected).length;
    out.push({ year: y, opening, total: opening - book, closing: book, done: months.length - projected, projected, months });
  }
  return out;
}
