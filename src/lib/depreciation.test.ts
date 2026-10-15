import { describe, expect, it } from "vitest";
import {
  affectedByPolicy, lifeYears, asOfMonth, depreciate, manilaMonth, monthEndLabel, monthLabel, resolvePolicy, stateNote, sumYearRows, toCentavos, yearGrid,
} from "./depreciation";

const M = (y: number, m: number) => y * 12 + (m - 1);
const cat = (life: number | null, pct: number | null) => ({ lifeMonths: life, salvagePercent: pct });

describe("months in Asia/Manila", () => {
  it("a late-evening confirmation on the last day stays in that month (Review Focus 1)", () => {
    expect(manilaMonth(new Date("2026-01-31T22:00:00+08:00"))).toBe(M(2026, 1));
  });
  it("as-of is the last completed month, also before 08:00 on the 1st (Review Focus 2)", () => {
    expect(asOfMonth(new Date("2026-10-01T07:30:00+08:00"))).toBe(M(2026, 9));
    expect(asOfMonth(new Date("2026-10-31T23:59:00+08:00"))).toBe(M(2026, 9));
  });
  it("labels", () => {
    expect(monthLabel(M(2026, 9))).toBe("September 2026");
    expect(monthEndLabel(M(2026, 2))).toBe("28 Feb 2026");
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
  const conf = new Date("2026-01-14T10:00:00+08:00"); // starts Feb 2026

  it("₱10,000 over 3 months: 3,333.33 + 3,333.33 + 3,333.34", () => {
    const r1 = depreciate(1_000_000, conf, p(3), M(2026, 2));
    expect([r1.state, r1.monthly, r1.accumulated, r1.bookValue]).toEqual(["depreciating", 333_333, 333_333, 666_667]);
    const r3 = depreciate(1_000_000, conf, p(3), M(2026, 4));
    expect([r3.state, r3.accumulated, r3.bookValue]).toEqual(["fully-depreciated", 1_000_000, 0]);
  });
  it("never below salvage, and stays there after the life", () => {
    const r = depreciate(1_000_000, conf, p(10, 100_000), M(2030, 1));
    expect([r.state, r.bookValue]).toEqual(["fully-depreciated", 100_000]);
  });
  it("a tiny base over a long life never goes negative in the last month", () => {
    const g = yearGrid(7, new Date("2025-12-10T10:00:00+08:00"), p(10), 2026, M(2026, 12));
    expect(g!.months.every((c) => c >= 0)).toBe(true);
    expect(g!.months.reduce((a, b) => a + b, 0)).toBe(7);
  });
  it("starts the month after confirmation; the confirmation month itself charges nothing", () => {
    expect(depreciate(1_000_000, conf, p(3), M(2026, 1)).state).toBe("not-started");
  });
  it("unconfirmed and no-policy show book value = cost", () => {
    expect(depreciate(1_000_000, null, p(3), M(2026, 9))).toMatchObject({ state: "not-started", bookValue: 1_000_000 });
    expect(depreciate(1_000_000, conf, null, M(2026, 9))).toMatchObject({ state: "no-policy", bookValue: 1_000_000 });
  });
  it("salvage at or above cost (cost lowered after an override) is refused, not negative (Review Focus 3)", () => {
    expect(depreciate(100_000, conf, { lifeMonths: 12, salvage: 150_000, basis: "custom" }, M(2026, 9)))
      .toMatchObject({ state: "bad-salvage", bookValue: 100_000, accumulated: 0 });
  });
});

describe("yearGrid", () => {
  const p = (life: number, salvage = 0) => ({ lifeMonths: life, salvage, basis: "category" as const });
  it("a mid-year start: zeros before, charges after, opening = cost", () => {
    const g = yearGrid(1_200_000, new Date("2026-03-05T09:00:00+08:00"), p(12), 2026, M(2026, 9))!;
    expect(g.opening).toBe(1_200_000);
    expect(g.months).toEqual([0, 0, 0, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000]);
    expect(g.projected).toEqual([false, false, false, false, false, false, false, false, false, true, true, true]);
    expect([g.total, g.closing]).toEqual([900_000, 300_000]);
  });
  it("a life ending mid-year", () => {
    const g = yearGrid(1_200_000, new Date("2025-08-20T09:00:00+08:00"), p(12), 2026, M(2026, 12))!;
    expect(g.opening).toBe(800_000);
    expect(g.months.slice(0, 9)).toEqual([100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 0]);
    expect(g.closing).toBe(0);
  });
  it("fully depreciated before the year, not started yet, unconfirmed, no policy → no row (Review Focus 5)", () => {
    expect(yearGrid(1_200_000, new Date("2023-01-05T09:00:00+08:00"), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, new Date("2026-12-20T09:00:00+08:00"), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, null, p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, new Date("2026-03-05T09:00:00+08:00"), null, 2026, M(2026, 9))).toBeNull();
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
  it("BR-LT-0148: P55,000 confirmed 10 Mar 2025, 3 years, 10% salvage, as of Sep 2026", () => {
    const ys = lifeYears(5_500_000, new Date("2025-03-10T10:00:00+08:00"), p, 2026 * 12 + 8);
    expect(ys.map((y) => y.year)).toEqual([2025, 2026, 2027, 2028]);
    expect(ys[0]).toMatchObject({ opening: 5_500_000, total: 9 * 137_500, done: 9, projected: 0 });
    expect(ys[1]).toMatchObject({ done: 9, projected: 3 });
    expect(ys[3].closing).toBe(550_000);
    expect(ys[1].months[0]).toMatchObject({ charge: 137_500, projected: false });
  });
  it("unconfirmed or no policy gives no years", () => {
    expect(lifeYears(5_500_000, null, p, 2026 * 12 + 8)).toEqual([]);
    expect(lifeYears(5_500_000, new Date("2025-03-10T10:00:00+08:00"), null, 2026 * 12 + 8)).toEqual([]);
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
