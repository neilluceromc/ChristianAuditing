import { describe, expect, it } from "vitest";
import { lifeYears, type Policy } from "./depreciation";
import { defaultLedgerYear, ledgerMonths, ledgerYears } from "./finance-ledger";

/*
 * Phase 47 (Task 4, spec §4.2): the Depreciation ledger tab's year tabs, the All-years summary (one row per year,
 * never all months) and one year's month rows. Every figure is read from lifeYears; nothing is recomputed.
 */

const M = (y: number, m: number) => y * 12 + (m - 1); // m is 1-based
const policy = (lifeMonths: number, salvage = 0): Policy => ({ lifeMonths, salvage, basis: "category" });

describe("ledgerYears", () => {
  // ₱10,000.00 over 36 months: 27,777 a month, the last month absorbs the rounding (28,805)
  const cost = 1_000_000;
  const start = M(2026, 10);
  const asOf = M(2026, 10);
  const years = lifeYears(cost, start, policy(36), asOf);

  it("a 36-month asset from Oct 2026 spans 4 calendar years of 3, 12, 12 and 9 months", () => {
    const rows = ledgerYears(years, asOf);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029]);
    expect(rows.map((r) => r.months)).toEqual([3, 12, 12, 9]);
  });

  it("the year totals sum to the depreciable base, and the years chain opening → closing", () => {
    const rows = ledgerYears(years, asOf);
    expect(rows.reduce((a, r) => a + r.totalC, 0)).toBe(cost);
    expect(rows[0].openC).toBe(cost);
    for (let i = 1; i < rows.length; i++) expect(rows[i].openC).toBe(rows[i - 1].closeC);
    expect(rows[rows.length - 1].closeC).toBe(0);
    expect(rows[rows.length - 1].accC).toBe(cost);
    for (const r of rows) expect(r.accC).toBe(cost - r.closeC);
  });

  it("with salvage, the totals sum to cost − salvage and the life closes on the salvage", () => {
    const rows = ledgerYears(lifeYears(cost, start, policy(36, 100_000), asOf), asOf);
    expect(rows.reduce((a, r) => a + r.totalC, 0)).toBe(cost - 100_000);
    expect(rows[rows.length - 1].closeC).toBe(100_000);
    expect(rows[rows.length - 1].accC).toBe(cost - 100_000);
  });

  it("states: the year holding this month is now, later years upcoming, earlier years done", () => {
    expect(ledgerYears(years, asOf).map((r) => r.state)).toEqual(["now", "upcoming", "upcoming", "upcoming"]);
    const later = M(2028, 3);
    expect(ledgerYears(lifeYears(cost, start, policy(36), later), later).map((r) => r.state))
      .toEqual(["done", "done", "now", "upcoming"]);
    const after = M(2031, 1);
    expect(ledgerYears(lifeYears(cost, start, policy(36), after), after).map((r) => r.state))
      .toEqual(["done", "done", "done", "done"]);
  });

  it("an asset whose life starts later (approved, purchase month ahead) is all upcoming", () => {
    const before = M(2026, 8);
    expect(ledgerYears(lifeYears(cost, start, policy(36), before), before).map((r) => r.state))
      .toEqual(["upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("a 120-month (Building) life starting mid-year is 11 years, part years first and last", () => {
    const s = M(2026, 6);
    const rows = ledgerYears(lifeYears(5_000_000, s, policy(120), s), s);
    expect(rows).toHaveLength(11);
    expect(rows[0].months).toBe(7);
    expect(rows[10].months).toBe(5);
    expect(rows.reduce((a, r) => a + r.months, 0)).toBe(120);
    expect(rows.reduce((a, r) => a + r.totalC, 0)).toBe(5_000_000);
  });

  it("not started (not approved), no cost or not capitalised → no schedule, no rows", () => {
    expect(ledgerYears(lifeYears(cost, null, policy(36), asOf), asOf)).toEqual([]);
    expect(ledgerYears(lifeYears(cost, start, null, asOf), asOf)).toEqual([]);
    expect(ledgerYears([], asOf)).toEqual([]);
  });
});

describe("ledgerMonths", () => {
  const cost = 1_000_000;
  const start = M(2026, 10);

  it("one row per month with opening, charge, accumulated and closing", () => {
    const asOf = M(2026, 10);
    const years = lifeYears(cost, start, policy(36), asOf);
    const rows = ledgerMonths(years[0], years, asOf);
    expect(rows.map((r) => r.label)).toEqual(["October 2026", "November 2026", "December 2026"]);
    expect(rows[0]).toMatchObject({ month: start, openC: cost, chargeC: 27_777, accC: 27_777, closeC: cost - 27_777 });
    expect(rows[2]).toMatchObject({ accC: 3 * 27_777, closeC: cost - 3 * 27_777 });
  });

  it("states: before this month counted, this month now, after projected", () => {
    const asOf = M(2026, 11);
    const years = lifeYears(cost, start, policy(36), asOf);
    expect(ledgerMonths(years[0], years, asOf).map((r) => r.state)).toEqual(["counted", "now", "projected"]);
  });

  it("the * rounding mark is on the life's last month only (36 months)", () => {
    const asOf = M(2026, 10);
    const years = lifeYears(cost, start, policy(36), asOf);
    const all = years.flatMap((y) => ledgerMonths(y, years, asOf));
    expect(all).toHaveLength(36);
    expect(all.filter((r) => r.roundingMark).map((r) => r.label)).toEqual(["September 2029"]);
    expect(all[35].chargeC).toBe(cost - 27_777 * 35);
    expect(all[35].closeC).toBe(0);
  });

  it("the * rounding mark is the last month of a 120-month life", () => {
    const s = M(2026, 6);
    const years = lifeYears(5_000_000, s, policy(120), s);
    const all = years.flatMap((y) => ledgerMonths(y, years, s));
    expect(all.filter((r) => r.roundingMark).map((r) => r.label)).toEqual(["May 2036"]);
  });

  it("no rounding (base divides evenly) → no month is marked", () => {
    const years = lifeYears(3_600_000, start, policy(36), start);
    expect(years.flatMap((y) => ledgerMonths(y, years, start)).some((r) => r.roundingMark)).toBe(false);
  });
});

describe("defaultLedgerYear", () => {
  const cost = 1_000_000;
  const start = M(2026, 10);
  it("the year holding this month", () => {
    const asOf = M(2028, 2);
    expect(defaultLedgerYear(lifeYears(cost, start, policy(36), asOf), asOf)).toBe(2028);
  });
  it("the first year when the life hasn't started; the last when it has ended", () => {
    const before = M(2025, 1);
    expect(defaultLedgerYear(lifeYears(cost, start, policy(36), before), before)).toBe(2026);
    const after = M(2033, 1);
    expect(defaultLedgerYear(lifeYears(cost, start, policy(36), after), after)).toBe(2029);
  });
  it("no schedule → null", () => {
    expect(defaultLedgerYear([], M(2026, 10))).toBeNull();
  });
});
