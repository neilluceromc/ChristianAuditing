import { describe, expect, it } from "vitest";
import { chipsForOutcome, REASON_CHIPS } from "./reason-chips";

describe("REASON_CHIPS", () => {
  for (const [context, chips] of Object.entries(REASON_CHIPS)) {
    describe(context, () => {
      it("has 1 to 5 chips", () => {
        expect(chips.length).toBeGreaterThanOrEqual(1);
        expect(chips.length).toBeLessThanOrEqual(5);
      });
      it("has no duplicates", () => {
        expect(new Set(chips).size).toBe(chips.length);
      });
      it("every chip is 5 to 40 characters", () => {
        for (const chip of chips) {
          expect(chip.length).toBeGreaterThanOrEqual(5);
          expect(chip.length).toBeLessThanOrEqual(40);
        }
      });
    });
  }
});

describe("chipsForOutcome", () => {
  it("MISSING maps to asset.missing", () => {
    expect(chipsForOutcome("MISSING")).toEqual(REASON_CHIPS["asset.missing"]);
  });
  it("DEFECTIVE maps to asset.defective", () => {
    expect(chipsForOutcome("DEFECTIVE")).toEqual(REASON_CHIPS["asset.defective"]);
  });
  it("BUYOUT maps to asset.buyout", () => {
    expect(chipsForOutcome("BUYOUT")).toEqual(REASON_CHIPS["asset.buyout"]);
  });
  it("TRIAGE has no chips", () => {
    expect(chipsForOutcome("TRIAGE")).toEqual([]);
  });
  it("RETURNED has no chips", () => {
    expect(chipsForOutcome("RETURNED")).toEqual([]);
  });
});
