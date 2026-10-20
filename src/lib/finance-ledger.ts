import { monthLabel, type LifeYear, type MonthIndex } from "./depreciation";

/*
 * Phase 47 (Task 4, spec §4.2): the Depreciation ledger tab. Pure grouping over `lifeYears` (src/lib/depreciation.ts):
 * every figure here is read from its rows, never recomputed — the engine stays the one place depreciation is worked out.
 * Money is integer centavos throughout.
 */

export type LedgerYearState = "done" | "now" | "upcoming";

/** One year tab, and one row of the All-years summary (one row per year, never all months). */
export interface LedgerYear {
  year: number;
  /** Months of the life inside this calendar year (a part year at the start and end of most lives). */
  months: number;
  /** Charged in the year. */
  totalC: number;
  openC: number;
  closeC: number;
  /** Accumulated depreciation at the year's close. */
  accC: number;
  state: LedgerYearState;
}

export type LedgerMonthState = "counted" | "now" | "projected";

export interface LedgerMonth {
  month: MonthIndex;
  label: string;
  openC: number;
  chargeC: number;
  /** Accumulated depreciation after this month's charge. */
  accC: number;
  closeC: number;
  state: LedgerMonthState;
  /** The month that absorbs the rounding (the life's last month, when its charge differs from the regular one): `*`. */
  roundingMark: boolean;
}

function yearState(y: LifeYear, asOf: MonthIndex): LedgerYearState {
  const first = y.months[0]?.month ?? y.year * 12;
  const last = y.months[y.months.length - 1]?.month ?? y.year * 12 + 11;
  if (last < asOf) return "done";
  if (first > asOf) return "upcoming";
  return "now";
}

export function ledgerYears(years: LifeYear[], asOf: MonthIndex): LedgerYear[] {
  if (!years.length) return [];
  const costC = years[0].opening;
  return years.map((y) => ({
    year: y.year,
    months: y.months.length,
    totalC: y.total,
    openC: y.opening,
    closeC: y.closing,
    accC: costC - y.closing,
    state: yearState(y, asOf),
  }));
}

/**
 * One year's month rows. `all` is the whole `lifeYears` result, which gives the cost (the first opening), the life's
 * last month and the regular monthly charge (the first month's) — so the `*` mark needs no maths of its own.
 */
export function ledgerMonths(year: LifeYear, all: LifeYear[], asOf: MonthIndex): LedgerMonth[] {
  if (!all.length) return [];
  const costC = all[0].opening;
  const lastYear = all[all.length - 1];
  const endMonth = lastYear.months[lastYear.months.length - 1]?.month;
  const regularC = all[0].months[0]?.charge;
  return year.months.map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    openC: m.opening,
    chargeC: m.charge,
    accC: costC - m.closing,
    closeC: m.closing,
    state: m.month < asOf ? "counted" : m.month === asOf ? "now" : "projected",
    roundingMark: m.month === endMonth && m.charge !== regularC,
  }));
}

/** The default year tab (spec §4.2): the year holding this month; the first year before the life starts; the last after it ends. */
export function defaultLedgerYear(years: LifeYear[], asOf: MonthIndex): number | null {
  if (!years.length) return null;
  const thisYear = Math.floor(asOf / 12);
  if (years.some((y) => y.year === thisYear)) return thisYear;
  return thisYear < years[0].year ? years[0].year : years[years.length - 1].year;
}
