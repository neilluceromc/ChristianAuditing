import { describe, expect, it } from "vitest";
import { centavosToDecimalString, formatPeso, moneyToCentavos, purchaseTotal, warrantyUntilFrom } from "./purchase-summary";

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
