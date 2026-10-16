import { describe, expect, it } from "vitest";
import {
  isDifference, pageSheet, parseCount, parseSheetState, planStocktakePost, postedReviewRows, sheetHref, sheetLineMatches, varianceRows,
  type StocktakeLineInput,
} from "./stocktake";

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

describe("postedReviewRows — I-4: a frozen record, never a live recomputation", () => {
  it("reads the adjustment from the stocktake's own movements, ignoring bookQty/current entirely", () => {
    const adjustments = new Map<string, number>([["A", -2], ["B", 2]]);
    expect(postedReviewRows(lines, adjustments)).toEqual([
      { itemId: "A", bookQty: 36, countedQty: 34, adjustment: -2 },
      { itemId: "B", bookQty: 22, countedQty: 22, adjustment: 2 },
      { itemId: "C", bookQty: 12, countedQty: null, adjustment: null },
      { itemId: "D", bookQty: 5, countedQty: 9, adjustment: null },
    ]);
  });

  it("a line with no recorded adjustment renders null whether it was never counted (C) or matched exactly (D)", () => {
    // Same fixture, empty adjustments map — every line falls back to null;
    // the caller (the component) tells the two cases apart via countedQty.
    const rows = postedReviewRows(lines, new Map());
    expect(rows.every((r) => r.adjustment === null)).toBe(true);
    expect(rows.find((r) => r.itemId === "C")!.countedQty).toBeNull();
    expect(rows.find((r) => r.itemId === "D")!.countedQty).not.toBeNull();
  });
});

describe("the paged sheet (Phase 39, spec §4.1)", () => {
  const sp = (qs: string) => new URLSearchParams(qs);

  it("parses q, cat, page and the mode's own toggle, ignoring the other mode's", () => {
    expect(parseSheetState(sp("q=%20tape%20&cat=a,b&uncounted=1&diff=1&page=3"), "count")).toEqual({
      q: "tape", cats: ["a", "b"], only: true, page: 3,
    });
    expect(parseSheetState(sp("uncounted=1"), "review")).toEqual({ q: "", cats: [], only: false, page: 1 });
    expect(parseSheetState(sp("diff=1&page=0"), "review")).toEqual({ q: "", cats: [], only: true, page: 1 });
    expect(parseSheetState(sp("page=junk"), "count").page).toBe(1);
  });

  it("builds the href: view=review first on the review, defaults left out, the toggle named per mode", () => {
    const none = { q: "", cats: [], only: false, page: 1 };
    expect(sheetHref("st1", "count", none)).toBe("/stock/stocktakes/st1");
    expect(sheetHref("st1", "review", none)).toBe("/stock/stocktakes/st1?view=review");
    expect(sheetHref("st1", "count", { q: "a b", cats: ["x", "y"], only: true, page: 2 })).toBe(
      "/stock/stocktakes/st1?q=a+b&cat=x,y&uncounted=1&page=2",
    );
    expect(sheetHref("st1", "review", { q: "", cats: [], only: true, page: 4 })).toBe(
      "/stock/stocktakes/st1?view=review&diff=1&page=4",
    );
  });

  it("an href round-trips through parseSheetState", () => {
    const s = { q: "Tape & glue", cats: ["c1"], only: true, page: 2 };
    for (const mode of ["count", "review"] as const) {
      const href = sheetHref("st1", mode, s);
      expect(parseSheetState(new URLSearchParams(href.split("?")[1]), mode)).toEqual(s);
    }
  });

  it("matches the search on code or name, case-insensitively, and the category list", () => {
    const line = { code: "PN-0003", name: "Instant Coffee", categoryId: "pn" };
    const s = (q: string, cats: string[] = []) => ({ q, cats, only: false, page: 1 });
    expect(sheetLineMatches(line, s(""))).toBe(true);
    expect(sheetLineMatches(line, s("pn-00"))).toBe(true);
    expect(sheetLineMatches(line, s("COFFEE"))).toBe(true);
    expect(sheetLineMatches(line, s("tea"))).toBe(false);
    expect(sheetLineMatches(line, s("", ["pn", "cm"]))).toBe(true);
    expect(sheetLineMatches(line, s("", ["cm"]))).toBe(false);
    expect(sheetLineMatches(line, s("coffee", ["cm"]))).toBe(false);
  });

  it("a difference is a counted line off the current balance (open) or a posted adjustment", () => {
    expect(isDifference({ kind: "open", variance: -2 })).toBe(true);
    expect(isDifference({ kind: "open", variance: 0 })).toBe(false);
    expect(isDifference({ kind: "open", variance: null })).toBe(false);
    expect(isDifference({ kind: "posted", adjustment: 3 })).toBe(true);
    expect(isDifference({ kind: "posted", adjustment: null })).toBe(false);
  });

  it("pages the kept rows 50 at a time and clamps an out-of-range page to the last", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    const even = (n: number) => n % 2 === 0;
    const p1 = pageSheet(rows, even, 1);
    expect(p1).toMatchObject({ page: 1, pageCount: 2, matching: 60, total: 60 });
    expect(p1.rows).toHaveLength(50);
    expect(p1.rows[0]).toBe(0);
    const last = pageSheet(rows, even, 9);
    expect(last.page).toBe(2);
    expect(last.rows).toEqual([100, 102, 104, 106, 108, 110, 112, 114, 116, 118]);
    expect(pageSheet(rows, () => false, 1)).toMatchObject({ rows: [], page: 1, pageCount: 1, matching: 0 });
  });
});

describe("parseCount — what a count box holds", () => {
  it("a whole number of zero or more is a count; blank is blank; anything else is invalid", () => {
    expect(parseCount("12")).toBe(12);
    expect(parseCount(" 0 ")).toBe(0);
    expect(parseCount("")).toBe("blank");
    expect(parseCount("   ")).toBe("blank");
    expect(parseCount(undefined)).toBe("blank");
    expect(parseCount("1.5")).toBe("invalid");
    expect(parseCount("-2")).toBe("invalid");
    expect(parseCount("abc")).toBe("invalid");
  });
});
