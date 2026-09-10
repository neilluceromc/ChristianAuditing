import { describe, expect, it } from "vitest";
import { balanceOf, isLow, packToUnits, unitsLabel } from "./stock-balance";

describe("balanceOf (spec §2.4 — balance is SUM(quantity), never stored)", () => {
  it("sums signed movement quantities", () => {
    expect(balanceOf([])).toBe(0);
    expect(balanceOf([{ quantity: 60 }, { quantity: -20 }, { quantity: 5 }, { quantity: -3 }])).toBe(42);
  });
});

describe("isLow", () => {
  it("is at or below the reorder level, but a reorder level of 0 never trips", () => {
    expect(isLow(40, 60)).toBe(true);
    expect(isLow(60, 60)).toBe(true);
    expect(isLow(61, 60)).toBe(false);
    expect(isLow(0, 0)).toBe(false);
  });
});

describe("packToUnits", () => {
  it("multiplies packs by pack size", () => {
    expect(packToUnits(5, 12)).toBe(60);
  });
});

describe("unitsLabel", () => {
  it("pluralizes the unit unless the quantity is one", () => {
    expect(unitsLabel(60, "piece")).toBe("60 pieces");
    expect(unitsLabel(1, "piece")).toBe("1 piece");
    expect(unitsLabel(3, "kg")).toBe("3 kg");
    expect(unitsLabel(2, "box")).toBe("2 boxes");
    expect(unitsLabel(4, "pieces")).toBe("4 pieces");
  });
});
