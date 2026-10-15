/**
 * Phase 35 (spec §5.2): straight-line depreciation, computed on read. Integer centavos and
 * Asia/Manila calendar months throughout; every screen and export calls these functions.
 */
export type MonthIndex = number;

const MANILA = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Manila" });
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function manilaMonth(d: Date): MonthIndex {
  const [y, m] = MANILA.format(d).split("-").map(Number);
  return y * 12 + (m - 1);
}

export function asOfMonth(now: Date): MonthIndex {
  return manilaMonth(now) - 1;
}

export function monthLabel(m: MonthIndex): string {
  return `${MONTH_NAMES[((m % 12) + 12) % 12]} ${Math.floor(m / 12)}`;
}

export function monthEndLabel(m: MonthIndex): string {
  const y = Math.floor(m / 12);
  const mo = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return `${String(last).padStart(2, "0")} ${SHORT[mo]} ${y}`;
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

export function depreciate(cost: number, confirmedAt: Date | null, policy: Policy | null, asOf: MonthIndex): DepResult {
  const flat = (state: DepState, startMonth: MonthIndex | null): DepResult =>
    ({ state, cost, accumulated: 0, bookValue: cost, monthly: null, startMonth, policy });
  if (!confirmedAt) return flat("not-started", null);
  const start = manilaMonth(confirmedAt) + 1;
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

export function yearGrid(cost: number, confirmedAt: Date | null, policy: Policy | null, year: number, asOf: MonthIndex): YearRow | null {
  if (!confirmedAt || !policy || policy.salvage >= cost) return null;
  const start = manilaMonth(confirmedAt) + 1;
  const first = year * 12;
  if (start > first + 11) return null;
  const base = cost - policy.salvage;
  const months = Array.from({ length: 12 }, (_, i) => chargeFor(base, policy.lifeMonths, first + i - start + 1));
  const opening = cost - accumulatedThrough(base, policy.lifeMonths, start, first - 1);
  const total = months.reduce((a, b) => a + b, 0);
  if (total === 0 && opening <= policy.salvage) return null;
  return { opening, months, projected: months.map((_, i) => first + i > asOf), total, closing: opening - total };
}

export function stateNote(r: DepResult, categoryName: string): string | null {
  switch (r.state) {
    case "not-started": return "Not depreciating yet";
    case "no-policy": return `No policy for ${categoryName}`;
    case "bad-salvage": return "Salvage is not below cost — check the override";
    case "fully-depreciated": return "Fully depreciated";
    default: return null;
  }
}
