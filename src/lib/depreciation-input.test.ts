import { describe, expect, it } from "vitest";
import { lifeFromYearsMonths, lifeLabel, overrideSchema, policyDirty, policySchema } from "./depreciation-input";

describe("lifeFromYearsMonths", () => {
  it("years + months → months; both empty → no policy", () => {
    expect(lifeFromYearsMonths("3", "")).toBe(36);
    expect(lifeFromYearsMonths("1", "6")).toBe(18);
    expect(lifeFromYearsMonths("", "")).toBeNull();
  });
  it("refuses junk, months ≥ 12, zero and > 50 years", () => {
    for (const [y, m] of [["x", ""], ["1", "12"], ["0", "0"], ["51", "0"], ["-1", ""]]) expect(lifeFromYearsMonths(y, m)).toBe("bad");
  });
});

describe("lifeLabel", () => {
  it("reads naturally", () => {
    expect(lifeLabel(36)).toBe("3 years");
    expect(lifeLabel(18)).toBe("1 year 6 months");
    expect(lifeLabel(5)).toBe("5 months");
    expect(lifeLabel(null)).toBe("—");
  });
});

describe("policySchema", () => {
  it("accepts a policy and a cleared policy", () => {
    expect(policySchema.safeParse({ categoryId: "c", lifeMonths: 36, salvagePercent: 10 }).success).toBe(true);
    expect(policySchema.safeParse({ categoryId: "c", lifeMonths: null, salvagePercent: null }).success).toBe(true);
  });
  it("refuses salvage ≥ 100, > 2 decimals, a % without a life, and life out of range", () => {
    for (const v of [
      { lifeMonths: 36, salvagePercent: 100 }, { lifeMonths: 36, salvagePercent: 10.123 },
      { lifeMonths: null, salvagePercent: 10 }, { lifeMonths: 0, salvagePercent: 0 }, { lifeMonths: 601, salvagePercent: 0 },
    ]) expect(policySchema.safeParse({ categoryId: "c", ...v }).success).toBe(false);
  });
});

describe("overrideSchema", () => {
  it("needs life, salvage and a 3–300 character reason", () => {
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: 5000, note: "refurbished" }).success).toBe(true);
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: 5000, note: "no" }).success).toBe(false);
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: -1, note: "refurbished" }).success).toBe(false);
  });
});

describe("two-decimal tolerance (float error must not reject valid inputs)", () => {
  it("policySchema accepts 8.2, 0.07 and 19.99; rejects 10.005", () => {
    for (const p of [8.2, 0.07, 19.99]) expect(policySchema.safeParse({ categoryId: "c", lifeMonths: 36, salvagePercent: p }).success).toBe(true);
    expect(policySchema.safeParse({ categoryId: "c", lifeMonths: 36, salvagePercent: 10.005 }).success).toBe(false);
  });
  it("overrideSchema accepts 19.99 and 5000.1", () => {
    for (const s of [19.99, 5000.1]) expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: s, note: "refurbished" }).success).toBe(true);
  });
});

describe("policyDirty", () => {
  const saved60 = { lifeMonths: 60, salvagePercent: 0 };
  it("normalised equivalents are not dirty", () => {
    expect(policyDirty({ years: "5", months: "", salvage: "" }, saved60)).toBe(false);
    expect(policyDirty({ years: "5", months: "0", salvage: "0" }, saved60)).toBe(false);
    expect(policyDirty({ years: " 5 ", months: "", salvage: "" }, saved60)).toBe(false);
    expect(policyDirty({ years: "5", months: "", salvage: "7.50" }, { lifeMonths: 60, salvagePercent: 7.5 })).toBe(false);
    expect(policyDirty({ years: "", months: "", salvage: "" }, { lifeMonths: null, salvagePercent: null })).toBe(false);
  });
  it("real changes and bad input are dirty", () => {
    expect(policyDirty({ years: "6", months: "", salvage: "" }, saved60)).toBe(true);
    expect(policyDirty({ years: "5", months: "", salvage: "5" }, saved60)).toBe(true);
    expect(policyDirty({ years: "", months: "", salvage: "" }, saved60)).toBe(true);
    expect(policyDirty({ years: "x", months: "", salvage: "" }, saved60)).toBe(true);
    expect(policyDirty({ years: "5", months: "", salvage: "abc" }, saved60)).toBe(true);
  });
});
