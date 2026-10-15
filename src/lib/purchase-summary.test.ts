import { describe, expect, it } from "vitest";
import {
  centavosToDecimalString, formatPeso, moneyToCentavos, purchaseTotal, warrantyOnDate, warrantyOnLength, warrantyOnTyped,
  warrantyUntilFrom, type WarrantyState,
} from "./purchase-summary";

describe("moneyToCentavos", () => {
  it("accepts 68,500 / 68500 / 68500.00 / ₱68,500.5", () => {
    expect(moneyToCentavos("68,500")).toBe(6_850_000);
    expect(moneyToCentavos("68500")).toBe(6_850_000);
    expect(moneyToCentavos("68500.00")).toBe(6_850_000);
    expect(moneyToCentavos("₱68,500.5")).toBe(6_850_050);
  });
  it("blank is null; junk and negatives are bad", () => {
    expect(moneyToCentavos("  ")).toBeNull();
    expect(moneyToCentavos("12abc")).toBe("bad");
    expect(moneyToCentavos("-5")).toBe("bad");
    expect(moneyToCentavos("1.234")).toBe("bad");
  });
});

describe("purchaseTotal and formatPeso", () => {
  it("3 × ₱68,500 + ₱500 = ₱206,000.00", () => {
    expect(formatPeso(purchaseTotal(6_850_000, 3, 50_000))).toBe("₱206,000.00");
  });
  it("missing parts count as zero", () => {
    expect(purchaseTotal(null, 3, null)).toBe(0);
  });
  it("decimal string for Prisma", () => {
    expect(centavosToDecimalString(6_850_050)).toBe("68500.50");
  });
});

describe("warrantyUntilFrom (Review Focus 4)", () => {
  it("adds months to the purchase date", () => {
    expect(warrantyUntilFrom("2026-10-12", 12)).toBe("2027-10-12");
  });
  it("clamps to the month's last day", () => {
    expect(warrantyUntilFrom("2026-01-31", 1 * 6)).toBe("2026-07-31");
    expect(warrantyUntilFrom("2026-08-31", 6)).toBe("2027-02-28");
  });
  it("none or no date gives an empty string", () => {
    expect(warrantyUntilFrom("2026-10-12", 0)).toBe("");
    expect(warrantyUntilFrom("", 12)).toBe("");
  });
});

describe("warranty state on Register (Review Focus 4)", () => {
  const empty: WarrantyState = { months: null, until: "", manual: false };

  it("the first purchase date with no length chosen picks 1 yr", () => {
    expect(warrantyOnDate(empty, "2026-10-12")).toEqual({ months: 12, until: "2027-10-12", manual: false });
  });
  it("date, then length, then a new date: the until follows the length from the new date", () => {
    let s = warrantyOnDate(empty, "2026-10-12");
    s = warrantyOnLength(s, "2026-10-12", 24);
    expect(s.until).toBe("2028-10-12");
    s = warrantyOnDate(s, "2026-11-05");
    expect(s).toEqual({ months: 24, until: "2028-11-05", manual: false });
  });
  it("None keeps None when a date arrives later, and clears the until", () => {
    const s = warrantyOnLength(empty, "", 0);
    expect(warrantyOnDate(s, "2026-10-12")).toEqual({ months: 0, until: "", manual: false });
  });
  it("a date typed by hand survives a later purchase-date change", () => {
    let s = warrantyOnDate(empty, "2026-10-12");
    s = warrantyOnTyped(s, "2029-01-15");
    s = warrantyOnDate(s, "2026-11-05");
    expect(s).toEqual({ months: 12, until: "2029-01-15", manual: true });
  });
  it("picking a length after typing re-derives the date and clears the flag (ruling R12)", () => {
    let s = warrantyOnTyped(warrantyOnDate(empty, "2026-10-12"), "2029-01-15");
    s = warrantyOnLength(s, "2026-10-12", 36);
    expect(s).toEqual({ months: 36, until: "2029-10-12", manual: false });
    expect(warrantyOnLength(warrantyOnTyped(s, "2030-01-01"), "", 24)).toEqual({ months: 24, until: "", manual: false });
    expect(warrantyOnLength(warrantyOnTyped(s, "2030-01-01"), "2026-10-12", 0)).toEqual({ months: 0, until: "", manual: false });
  });
  it("clearing the typed date hands it back to the length", () => {
    let s = warrantyOnTyped(warrantyOnDate(empty, "2026-10-12"), "2029-01-15");
    s = warrantyOnTyped(s, "");
    expect(s.manual).toBe(false);
    expect(warrantyOnLength(s, "2026-10-12", 6).until).toBe("2027-04-12");
  });
});
