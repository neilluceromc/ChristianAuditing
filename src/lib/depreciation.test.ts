import { describe, expect, it } from "vitest";
import {
  affectedByPolicy, lifeYears, asOfMonth, depStartMonth, depreciate, manilaMonth, monthLabel, resolvePolicy, stateNote, sumYearRows, toCentavos, yearGrid,
} from "./depreciation";

const M = (y: number, m: number) => y * 12 + (m - 1);
const cat = (life: number | null, pct: number | null) => ({ lifeMonths: life, salvagePercent: pct });

describe("months in Asia/Manila", () => {
  it("a late-evening confirmation on the last day stays in that month (Review Focus 1)", () => {
    expect(manilaMonth(new Date("2026-01-31T22:00:00+08:00"))).toBe(M(2026, 1));
  });
  // Phase 38: recomputed. As-of is now the CURRENT Manila month (was the last completed month), so Oct 1 07:30
  // and Oct 31 23:59 Manila are both October, not September.
  it("as-of is the current month, also before 08:00 on the 1st (Review Focus 2)", () => {
    expect(asOfMonth(new Date("2026-10-01T07:30:00+08:00"))).toBe(M(2026, 10));
    expect(asOfMonth(new Date("2026-10-31T23:59:00+08:00"))).toBe(M(2026, 10));
  });
  it("labels", () => {
    expect(monthLabel(M(2026, 9))).toBe("September 2026");
  });
});

describe("toCentavos", () => {
  it("converts decimals and strings, keeps null", () => {
    expect(toCentavos("68500.5")).toBe(6_850_050);
    expect(toCentavos(10_000)).toBe(1_000_000);
    expect(toCentavos(null)).toBeNull();
  });
});

describe("resolvePolicy", () => {
  it("override wins over category", () => {
    expect(resolvePolicy({ cost: 1_000_000, lifeMonths: 24, salvage: 50_000 }, cat(36, 10)))
      .toEqual({ lifeMonths: 24, salvage: 50_000, basis: "custom" });
  });
  it("category % → centavos, rounded", () => {
    expect(resolvePolicy({ cost: 1_000_001, lifeMonths: null, salvage: null }, cat(36, 10)))
      .toEqual({ lifeMonths: 36, salvage: 100_000, basis: "category" });
  });
  it("category with life but no % means zero salvage", () => {
    expect(resolvePolicy({ cost: 500_000, lifeMonths: null, salvage: null }, cat(12, null))?.salvage).toBe(0);
  });
  it("no life anywhere → no policy", () => {
    expect(resolvePolicy({ cost: 500_000, lifeMonths: null, salvage: null }, cat(null, 10))).toBeNull();
  });
});

describe("depreciate", () => {
  const p = (life: number, salvage = 0) => ({ lifeMonths: life, salvage, basis: "category" as const });
  // Phase 38: `start` is now the month the asset starts (month 1, charged in full). The old tests passed an approval
  // date in January 2026 whose month-after rule started Feb 2026, so the same start month is passed directly.
  const start = M(2026, 2);

  it("₱10,000 over 3 months: 3,333.33 + 3,333.33 + 3,333.34", () => {
    const r1 = depreciate(1_000_000, start, p(3), M(2026, 2));
    expect([r1.state, r1.monthly, r1.accumulated, r1.bookValue]).toEqual(["depreciating", 333_333, 333_333, 666_667]);
    const r3 = depreciate(1_000_000, start, p(3), M(2026, 4));
    expect([r3.state, r3.accumulated, r3.bookValue]).toEqual(["fully-depreciated", 1_000_000, 0]);
  });
  it("never below salvage, and stays there after the life", () => {
    const r = depreciate(1_000_000, start, p(10, 100_000), M(2030, 1));
    expect([r.state, r.bookValue]).toEqual(["fully-depreciated", 100_000]);
  });
  it("a tiny base over a long life never goes negative in the last month", () => {
    const g = yearGrid(7, M(2026, 1), p(10), 2026, M(2026, 12));
    expect(g!.months.every((c) => c >= 0)).toBe(true);
    expect(g!.months.reduce((a, b) => a + b, 0)).toBe(7);
  });
  // Phase 38: recomputed. The start month itself is month 1 (charged in full, so as-of = start is "depreciating");
  // only an as-of BEFORE the start month has not started.
  it("the start month is charged in full; an as-of before it has not started", () => {
    expect(depreciate(1_000_000, start, p(3), M(2026, 1)).state).toBe("not-started");
    const r = depreciate(1_000_000, start, p(3), M(2026, 2));
    expect([r.state, r.accumulated, r.startMonth]).toEqual(["depreciating", 333_333, start]);
  });
  it("unconfirmed and no-policy show book value = cost", () => {
    expect(depreciate(1_000_000, null, p(3), M(2026, 9))).toMatchObject({ state: "not-started", bookValue: 1_000_000 });
    expect(depreciate(1_000_000, start, null, M(2026, 9))).toMatchObject({ state: "no-policy", bookValue: 1_000_000 });
  });
  it("salvage at or above cost (cost lowered after an override) is refused, not negative (Review Focus 3)", () => {
    expect(depreciate(100_000, start, { lifeMonths: 12, salvage: 150_000, basis: "custom" }, M(2026, 9)))
      .toMatchObject({ state: "bad-salvage", bookValue: 100_000, accumulated: 0 });
  });
});

describe("yearGrid", () => {
  const p = (life: number, salvage = 0) => ({ lifeMonths: life, salvage, basis: "category" as const });
  it("a mid-year start: zeros before, charges after, opening = cost", () => {
    // Phase 38: the old input (confirmed 5 Mar 2026, month-after rule) started April; the start month is passed directly.
    const g = yearGrid(1_200_000, M(2026, 4), p(12), 2026, M(2026, 9))!;
    expect(g.opening).toBe(1_200_000);
    expect(g.months).toEqual([0, 0, 0, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000]);
    expect(g.projected).toEqual([false, false, false, false, false, false, false, false, false, true, true, true]);
    expect([g.total, g.closing]).toEqual([900_000, 300_000]);
  });
  it("a life ending mid-year", () => {
    const g = yearGrid(1_200_000, M(2025, 9), p(12), 2026, M(2026, 12))!;
    expect(g.opening).toBe(800_000);
    expect(g.months.slice(0, 9)).toEqual([100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 0]);
    expect(g.closing).toBe(0);
  });
  it("fully depreciated before the year, not started yet, unconfirmed, no policy → no row (Review Focus 5)", () => {
    expect(yearGrid(1_200_000, M(2023, 2), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, M(2027, 1), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, null, p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, M(2026, 4), null, 2026, M(2026, 9))).toBeNull();
  });
});

describe("stateNote", () => {
  it("one plain sentence per non-depreciating state", () => {
    const base = { cost: 1, accumulated: 0, bookValue: 1, monthly: null, startMonth: null, policy: null };
    expect(stateNote({ ...base, state: "not-started" }, "Laptop")).toBe("Not depreciating yet");
    expect(stateNote({ ...base, state: "no-policy" }, "Laptop")).toBe("No policy for Laptop");
    expect(stateNote({ ...base, state: "bad-salvage" }, "Laptop")).toBe("Salvage is not below cost");
    expect(stateNote({ ...base, state: "bad-salvage", policy: { lifeMonths: 12, salvage: 5, basis: "category" } }, "Laptop")).toBe("Salvage is not below cost");
    expect(stateNote({ ...base, state: "bad-salvage", policy: { lifeMonths: 12, salvage: 5, basis: "custom" } }, "Laptop")).toBe("Salvage is not below cost — check the override");
    expect(stateNote({ ...base, state: "fully-depreciated" }, "Laptop")).toBe("Fully depreciated");
    expect(stateNote({ ...base, state: "depreciating" }, "Laptop")).toBeNull();
  });
});

describe("affectedByPolicy", () => {
  it("counts costed rows without a custom override", () => {
    expect(affectedByPolicy([{ costC: 100, custom: false }, { costC: 200, custom: true }, { costC: null, custom: false }])).toBe(1);
  });
});

describe("lifeYears", () => {
  const p = { lifeMonths: 36, salvage: 550_000, basis: "category" as const };
  it("BR-LT-0148: P55,000 starting Apr 2025, 3 years, 10% salvage, as of Sep 2026", () => {
    // Phase 38: the start month is passed directly (the old input was confirmed 10 Mar 2025 → month after = Apr 2025).
    const ys = lifeYears(5_500_000, M(2025, 4), p, 2026 * 12 + 8);
    expect(ys.map((y) => y.year)).toEqual([2025, 2026, 2027, 2028]);
    expect(ys[0]).toMatchObject({ opening: 5_500_000, total: 9 * 137_500, done: 9, projected: 0 });
    expect(ys[1]).toMatchObject({ done: 9, projected: 3 });
    expect(ys[3].closing).toBe(550_000);
    expect(ys[1].months[0]).toMatchObject({ charge: 137_500, projected: false });
  });
  it("unconfirmed or no policy gives no years", () => {
    expect(lifeYears(5_500_000, null, p, 2026 * 12 + 8)).toEqual([]);
    expect(lifeYears(5_500_000, M(2025, 4), null, 2026 * 12 + 8)).toEqual([]);
  });
});

describe("sumYearRows", () => {
  it("adds element-wise and keeps the year's projected flags", () => {
    const a = { opening: 100, months: Array(12).fill(1), projected: Array(12).fill(false), total: 12, closing: 88 };
    const b = { opening: 50, months: Array(12).fill(2), projected: Array(12).fill(false), total: 24, closing: 26 };
    const s = sumYearRows([a, b], 2026, 2026 * 12 + 8);
    expect([s.opening, s.total, s.closing, s.months[0]]).toEqual([150, 36, 114, 3]);
    expect(s.projected).toEqual([...Array(9).fill(false), true, true, true]);
  });
});

const at = (iso: string) => new Date(iso);
const policy36 = { lifeMonths: 36, salvage: 0, basis: "category" as const };

describe("Phase 38 — depreciation from the purchase month", () => {
  it("asOfMonth is the current Manila month", () => {
    expect(asOfMonth(at("2026-10-17T04:00:00Z"))).toBe(manilaMonth(at("2026-10-17T04:00:00Z")));
  });
  it("depStartMonth: purchase beats approval, approval is the fallback, unapproved is null", () => {
    expect(depStartMonth({ purchasedAt: at("2026-07-05T00:00:00Z"), financeConfirmedAt: at("2026-10-14T00:00:00Z") })).toBe(2026 * 12 + 6);
    expect(depStartMonth({ purchasedAt: null, financeConfirmedAt: at("2026-10-14T00:00:00Z") })).toBe(2026 * 12 + 9);
    expect(depStartMonth({ purchasedAt: at("2026-07-05T00:00:00Z"), financeConfirmedAt: null })).toBeNull();
  });
  it("uses the Manila calendar month", () => {
    expect(depStartMonth({ purchasedAt: at("2026-09-30T17:00:00Z"), financeConfirmedAt: at("2026-10-01T00:00:00Z") })).toBe(2026 * 12 + 9);
  });
  it("the user's example: bought 12 Oct, viewed 17 Oct → one month taken", () => {
    const start = depStartMonth({ purchasedAt: at("2026-10-12T02:00:00Z"), financeConfirmedAt: at("2026-10-14T02:00:00Z") });
    const r = depreciate(5_200_000, start, policy36, asOfMonth(at("2026-10-17T04:00:00Z")));
    expect(r.state).toBe("depreciating");
    expect(r.monthly).toBe(144_444);
    expect(r.accumulated).toBe(144_444);
    expect(r.bookValue).toBe(5_055_556);
  });
  it("catches up from the purchase month once approved (July → October = 4 months)", () => {
    const start = depStartMonth({ purchasedAt: at("2026-07-10T02:00:00Z"), financeConfirmedAt: at("2026-10-14T02:00:00Z") });
    expect(depreciate(3_600_000, start, policy36, asOfMonth(at("2026-10-17T04:00:00Z"))).accumulated).toBe(400_000);
  });
  it("a future purchase date has not started; unapproved has not started", () => {
    const future = depStartMonth({ purchasedAt: at("2026-12-01T02:00:00Z"), financeConfirmedAt: at("2026-10-14T02:00:00Z") });
    expect(depreciate(100_000, future, policy36, asOfMonth(at("2026-10-17T04:00:00Z"))).state).toBe("not-started");
    expect(depreciate(100_000, null, policy36, asOfMonth(at("2026-10-17T04:00:00Z"))).state).toBe("not-started");
  });
  it("the current month is actual, not projected", () => {
    const start = 2026 * 12 + 9; // October 2026
    const row = yearGrid(3_600_000, start, policy36, 2026, asOfMonth(at("2026-10-17T04:00:00Z")))!;
    expect(row.projected[9]).toBe(false);
    expect(row.projected[10]).toBe(true);
    expect(lifeYears(3_600_000, start, policy36, asOfMonth(at("2026-10-17T04:00:00Z")))[0].months[0].projected).toBe(false);
  });
});
