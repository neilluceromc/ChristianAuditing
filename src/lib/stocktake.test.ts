import { describe, expect, it } from "vitest";
import { planStocktakePost, varianceRows, type StocktakeLineInput } from "./stocktake";

const lines: StocktakeLineInput[] = [
  { itemId: "A", bookQty: 36, countedQty: 34 },
  { itemId: "B", bookQty: 22, countedQty: 22 },
  { itemId: "C", bookQty: 12, countedQty: null },
  { itemId: "D", bookQty: 5, countedQty: 9 },
];
const current = new Map<string, number>([["A", 36], ["B", 20], ["C", 12], ["D", 5]]);

describe("planStocktakePost", () => {
  it("adjusts against CURRENT balance (not book), skips uncounted lines, and flags drift", () => {
    const plan = planStocktakePost(lines, current);
    expect(plan.adjustments).toEqual([
      { itemId: "A", quantity: -2 },
      { itemId: "B", quantity: 2 },
      { itemId: "D", quantity: 4 },
    ]);
    expect(plan.skipped).toEqual(["C"]);
    expect(plan.drifted).toEqual(["B"]);
  });
});

describe("varianceRows", () => {
  it("reports variance against current (null when uncounted) and drift against book", () => {
    expect(varianceRows(lines, current)).toEqual([
      { itemId: "A", bookQty: 36, currentQty: 36, countedQty: 34, variance: -2, drift: 0 },
      { itemId: "B", bookQty: 22, currentQty: 20, countedQty: 22, variance: 2, drift: -2 },
      { itemId: "C", bookQty: 12, currentQty: 12, countedQty: null, variance: null, drift: 0 },
      { itemId: "D", bookQty: 5, currentQty: 5, countedQty: 9, variance: 4, drift: 0 },
    ]);
  });
});
