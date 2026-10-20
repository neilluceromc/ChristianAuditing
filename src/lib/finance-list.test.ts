import { describe, expect, it } from "vitest";
import { depreciate, type DepResult, type Policy } from "./depreciation";
import {
  categoryTiles, clearFinanceFilters, financeClassHref, financeExportHref, financeListHref, finTabs, inFin, lifeStage,
  matchesLife, monthCharge, parseFinanceListState, parseLife, parseSort, sortFinanceRows, withFinance,
  type FinanceListState, type LifeStage,
} from "./finance-list";

const AS_OF = 2026 * 12 + 9; // October 2026
const P36: Policy = { lifeMonths: 36, salvage: 0, basis: "category" };
const COST = 360_000_00; // ₱360,000 → ₱10,000 a month over 36 months

/** An approved asset that started `ago` months before this month (this month counted). */
const started = (ago: number, cost = COST, policy: Policy | null = P36): DepResult => depreciate(cost, AS_OF - ago, policy, AS_OF);

describe("parseLife / parseSort", () => {
  it("reads the three life filters and nothing else", () => {
    expect(parseLife("soon")).toBe("soon");
    expect(parseLife("full")).toBe("full");
    expect(parseLife("notstarted")).toBe("notstarted");
    expect(parseLife("mid")).toBeNull();
    expect(parseLife("")).toBeNull();
    expect(parseLife(null)).toBeNull();
  });
  it("defaults the sort to book value", () => {
    expect(parseSort("life")).toBe("life");
    expect(parseSort("tag")).toBe("tag");
    expect(parseSort("book")).toBe("book");
    expect(parseSort("-cost")).toBe("book");
    expect(parseSort(undefined)).toBe("book");
  });
});

describe("lifeStage (spec §3 item 6: Life used)", () => {
  it("mid-life reads used / life and months left", () => {
    expect(lifeStage(started(13), "registered", false, COST)).toEqual({ key: "mid", text: "14 / 36 mo · 22 left", usedPct: 39, usedRatio: 14 / 36 });
  });
  it("6 months or less left is 'soon'; 7 left is still mid", () => {
    expect(lifeStage(started(29), "registered", false, COST)).toMatchObject({ key: "soon", text: "30 / 36 mo · 6 left" });
    expect(lifeStage(started(34), "registered", false, COST)).toMatchObject({ key: "soon", text: "35 / 36 mo · 1 left" });
    expect(lifeStage(started(28), "registered", false, COST)).toMatchObject({ key: "mid", text: "29 / 36 mo · 7 left" });
  });
  it("fully depreciated, including the month the last charge lands", () => {
    expect(lifeStage(started(40), "registered", false, COST)).toEqual({ key: "full", text: "Fully depreciated", usedPct: 100, usedRatio: 1 });
    expect(lifeStage(started(35), "registered", false, COST)).toEqual({ key: "full", text: "Fully depreciated", usedPct: 100, usedRatio: 1 });
  });
  it("Review Focus 1: not yet approved (with a cost) starts when approved", () => {
    for (const reg of ["with-finance", "needs-correction", "awaiting-it"] as const) {
      expect(lifeStage(depreciate(COST, null, P36, AS_OF), reg, false, COST)).toEqual({ key: "notstarted", text: "Starts when approved", usedPct: null, usedRatio: null });
    }
  });
  it("approved with a purchase date still ahead starts that month", () => {
    expect(lifeStage(depreciate(COST, AS_OF + 2, P36, AS_OF), "registered", false, COST))
      .toEqual({ key: "notstarted", text: "Starts December 2026", usedPct: null, usedRatio: null });
  });
  it("Review Focus 1: not capitalised is expensed, not depreciated", () => {
    expect(lifeStage(null, "registered", true, COST)).toEqual({ key: "notstarted", text: "Expensed, not depreciated", usedPct: null, usedRatio: null });
    expect(lifeStage(null, "registered", true, null)).toEqual({ key: "notstarted", text: "Expensed, not depreciated", usedPct: null, usedRatio: null });
  });
  it("Review Focus 1: no cost reads 'No cost yet'", () => {
    expect(lifeStage(null, "with-finance", false, null)).toEqual({ key: "notstarted", text: "No cost yet", usedPct: null, usedRatio: null });
    expect(lifeStage(null, "registered", false, null)).toEqual({ key: "notstarted", text: "No cost yet", usedPct: null, usedRatio: null });
  });
  it("no policy and salvage at or above cost are not depreciating", () => {
    expect(lifeStage(started(5, COST, null), "registered", false, COST)).toEqual({ key: "notstarted", text: "No depreciation policy", usedPct: null, usedRatio: null });
    expect(lifeStage(started(5, COST, { lifeMonths: 36, salvage: COST, basis: "category" }), "registered", false, COST))
      .toEqual({ key: "notstarted", text: "Salvage is not below cost", usedPct: null, usedRatio: null });
  });
  it("keeps the old hints: the category with no policy, and a custom override whose salvage is not below cost", () => {
    expect(lifeStage(started(5, COST, null), "registered", false, COST, "Docks").text).toBe("No policy for Docks");
    expect(lifeStage(started(5, COST, { lifeMonths: 36, salvage: COST, basis: "custom" }), "registered", false, COST, "Laptops").text)
      .toBe("Salvage is not below cost — check the override");
    expect(lifeStage(started(5, COST, { lifeMonths: 36, salvage: COST, basis: "category" }), "registered", false, COST, "Laptops").text)
      .toBe("Salvage is not below cost");
  });
});

describe("monthCharge", () => {
  it("a depreciating asset is charged its monthly amount", () => {
    expect(monthCharge(started(13), AS_OF)).toBe(10_000_00);
  });
  it("an odd base takes the remainder in its last month, then nothing", () => {
    const cost = 100_000_00; // base 10,000,000 / 36 = 277,777 a month; last month 277,805
    expect(monthCharge(started(3, cost), AS_OF)).toBe(277_777);
    const last = started(35, cost);
    expect(last.state).toBe("fully-depreciated");
    expect(monthCharge(last, AS_OF)).toBe(cost - 277_777 * 35);
  });
  it("a fully depreciated asset is charged nothing", () => {
    expect(monthCharge(started(40), AS_OF)).toBe(0);
  });
  it("a not-started asset is charged nothing", () => {
    expect(monthCharge(depreciate(COST, null, P36, AS_OF), AS_OF)).toBe(0);
    expect(monthCharge(depreciate(COST, AS_OF + 1, P36, AS_OF), AS_OF)).toBe(0);
    expect(monthCharge(started(5, COST, null), AS_OF)).toBe(0);
  });
  it("this month's charges sum to the month's growth in accumulated depreciation", () => {
    const rs = [started(0), started(13), started(35, 100_000_00), started(40)];
    const before = rs.map((r) => depreciate(r.cost, r.startMonth, r.policy, AS_OF - 1).accumulated);
    const sum = rs.reduce((a, r) => a + monthCharge(r, AS_OF), 0);
    expect(sum).toBe(rs.reduce((a, r) => a + r.accumulated, 0) - before.reduce((a, b) => a + b, 0));
  });
});

/** `n` categories, category i holding `sizes[i]` assets of ₱1,000 cost and ₱(i+1)00 book value each. */
function catRows(sizes: number[]) {
  return sizes.flatMap((size, i) => Array.from({ length: size }, () => ({
    categoryId: `c${i}`, categoryName: `Cat ${String(i).padStart(2, "0")}`, costC: 1_000_00, bookC: (i + 1) * 100_00,
  })));
}

describe("categoryTiles (spec §3 item 3: fold the smallest into Other so rows stay full)", () => {
  it("11 categories → 12 tiles: All + 11", () => {
    const tiles = categoryTiles(catRows([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), null);
    expect(tiles).toHaveLength(12);
    expect(tiles[0]).toMatchObject({ id: "all", name: "All categories", count: 66, on: true });
    expect(tiles.some((t) => t.id === "other")).toBe(false);
  });
  it("13 categories → All + 10 + Other = 12; Other holds the three smallest", () => {
    const tiles = categoryTiles(catRows([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), null);
    expect(tiles).toHaveLength(12);
    expect(tiles.map((t) => t.id)).toEqual(["all", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "other"]);
    const other = tiles[11];
    expect(other).toMatchObject({ name: "Other", count: 3 + 2 + 1, costC: 6 * 1_000_00, bookC: 3 * 1100_00 + 2 * 1200_00 + 1 * 1300_00 });
    expect(tiles[0]).toMatchObject({ count: 91, costC: 91 * 1_000_00 });
  });
  it("4 categories → 5 tiles, nothing folded", () => {
    const tiles = categoryTiles(catRows([4, 3, 2, 1]), null);
    expect(tiles.map((t) => t.id)).toEqual(["all", "c0", "c1", "c2", "c3"]);
  });
  it("every non-small count is a multiple of the columns, and Other always folds at least two", () => {
    for (let n = 5; n <= 30; n++) {
      const tiles = categoryTiles(catRows(Array.from({ length: n }, (_, i) => n - i)), null);
      expect(tiles.length % 6).toBe(0);
      const kept = tiles.filter((t) => t.id !== "all" && t.id !== "other").length;
      if (tiles.some((t) => t.id === "other")) expect(n - kept).toBeGreaterThanOrEqual(2);
      else expect(kept).toBe(n);
    }
  });
  it("only categories with assets get a tile, so an empty one never pushes a real one into Other", () => {
    // 5 used categories (and, in the class, 2 empty ones that are never passed in): All + 5 = 6, nothing folds
    const tiles = categoryTiles(catRows([5, 4, 3, 2, 1, 0, 0]), null);
    expect(tiles.map((t) => t.id)).toEqual(["all", "c0", "c1", "c2", "c3", "c4"]);
    expect(tiles.every((t) => t.count > 0)).toBe(true);
  });
  it("marks the selected tile; Other is on for 'other' and for a folded category", () => {
    const rows = catRows([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(categoryTiles(rows, "c2").filter((t) => t.on).map((t) => t.id)).toEqual(["c2"]);
    expect(categoryTiles(rows, "other").filter((t) => t.on).map((t) => t.id)).toEqual(["other"]);
    expect(categoryTiles(rows, "c12").filter((t) => t.on).map((t) => t.id)).toEqual(["other"]);
  });
  it("an unknown id, or 'other' when nothing folds, lights All", () => {
    expect(categoryTiles(catRows([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), "nope").filter((t) => t.on).map((t) => t.id)).toEqual(["all"]);
    expect(categoryTiles(catRows([4, 3, 2, 1]), "other").filter((t) => t.on).map((t) => t.id)).toEqual(["all"]);
  });
  it("null cost and book read as zero", () => {
    const tiles = categoryTiles([{ categoryId: "a", categoryName: "A", costC: null, bookC: null }], null);
    expect(tiles[1]).toMatchObject({ id: "a", count: 1, costC: 0, bookC: 0 });
  });
});

const stage = (key: LifeStage["key"], usedPct: number | null): LifeStage =>
  ({ key, text: "", usedPct, usedRatio: usedPct === null ? null : usedPct / 100 });

describe("life filter", () => {
  const row = (key: LifeStage["key"], notCapitalised = false) => ({ lifeStage: stage(key, null), notCapitalised });
  it("each filter keeps its stage; none keeps all", () => {
    const keys = ["notstarted", "mid", "soon", "full"] as const;
    expect(keys.filter((k) => matchesLife(row(k), "soon"))).toEqual(["soon"]);
    expect(keys.filter((k) => matchesLife(row(k), "full"))).toEqual(["full"]);
    expect(keys.filter((k) => matchesLife(row(k), "notstarted"))).toEqual(["notstarted"]);
    expect(keys.filter((k) => matchesLife(row(k), null))).toEqual([...keys]);
  });
  it("Not depreciating yet leaves out expensed assets; Any keeps them", () => {
    const expensed = { lifeStage: lifeStage(null, "registered", true, COST), notCapitalised: true };
    expect(expensed.lifeStage.text).toBe("Expensed, not depreciated");
    expect(matchesLife(expensed, "notstarted")).toBe(false);
    expect(matchesLife(expensed, null)).toBe(true);
    const noCost = { lifeStage: lifeStage(null, "with-finance", false, null), notCapitalised: false };
    expect(matchesLife(noCost, "notstarted")).toBe(true);
  });
});

describe("sortFinanceRows", () => {
  const rows = [
    { tag: "IT-003", result: { bookValue: 500 }, lifeStage: stage("mid", 40) },
    { tag: "IT-001", result: null, lifeStage: stage("notstarted", null) },
    { tag: "IT-004", result: { bookValue: 900 }, lifeStage: stage("full", 100) },
    { tag: "IT-002", result: { bookValue: 500 }, lifeStage: stage("soon", 90) },
    { tag: "IT-005", result: { bookValue: 0 }, lifeStage: stage("mid", 40) },
  ];
  it("book: book value high first, ties by tag, no book value last", () => {
    expect(sortFinanceRows(rows, "book").map((r) => r.tag)).toEqual(["IT-004", "IT-002", "IT-003", "IT-005", "IT-001"]);
  });
  it("life: most used first, ties by tag, not started last", () => {
    expect(sortFinanceRows(rows, "life").map((r) => r.tag)).toEqual(["IT-004", "IT-002", "IT-003", "IT-005", "IT-001"]);
  });
  it("life: two assets within the same whole percent order by the exact ratio, not by tag", () => {
    const P120: Policy = { lifeMonths: 120, salvage: 0, basis: "category" };
    const a = { tag: "IT-001", result: { bookValue: 1 }, lifeStage: lifeStage(started(13), "registered", false, COST) }; // 14/36 = 38.9%
    const b = { tag: "IT-002", result: { bookValue: 1 }, lifeStage: lifeStage(started(46, COST, P120), "registered", false, COST) }; // 47/120 = 39.2%
    expect(a.lifeStage.usedPct).toBe(39);
    expect(b.lifeStage.usedPct).toBe(39);
    expect(sortFinanceRows([a, b], "life").map((r) => r.tag)).toEqual(["IT-002", "IT-001"]);
  });
  it("tag: ascending", () => {
    expect(sortFinanceRows(rows, "tag").map((r) => r.tag)).toEqual(["IT-001", "IT-002", "IT-003", "IT-004", "IT-005"]);
  });
  it("does not mutate its input", () => {
    const before = rows.map((r) => r.tag);
    sortFinanceRows(rows, "tag");
    expect(rows.map((r) => r.tag)).toEqual(before);
  });
});

describe("finance-state tabs", () => {
  it("Purchasing has no Waiting for IT tab", () => {
    expect(finTabs("IT")).toEqual(["with-finance", "needs-correction", "awaiting-it", "approved", "not-capitalised", "no-cost"]);
    expect(finTabs("PURCHASING")).toEqual(["with-finance", "needs-correction", "approved", "not-capitalised", "no-cost"]);
  });
  it("inFin mirrors finWhere", () => {
    const a = { reg: "registered" as const, notCapitalised: false, costC: 100 };
    expect(inFin(a, "approved")).toBe(true);
    expect(inFin(a, "not-capitalised")).toBe(false);
    expect(inFin({ ...a, notCapitalised: true }, "not-capitalised")).toBe(true);
    expect(inFin({ ...a, notCapitalised: true }, "approved")).toBe(false);
    expect(inFin({ ...a, costC: null }, "no-cost")).toBe(true);
    expect(inFin({ ...a, reg: "with-finance" }, "with-finance")).toBe(true);
    expect(inFin({ ...a, reg: "awaiting-it" }, "awaiting-it")).toBe(true);
    expect(inFin({ ...a, reg: "needs-correction" }, "needs-correction")).toBe(true);
    expect(inFin({ ...a, reg: "needs-correction" }, "approved")).toBe(false);
  });
});

describe("Finance list URL state (spec §3: cls, category, status, fin, q, life, sort, page, per)", () => {
  const sp = (qs: string) => new URLSearchParams(qs);
  const DEFAULT: FinanceListState = {
    cls: "IT", category: null, status: null, fin: null, q: "", life: null, sort: "book", page: 1, per: 25,
  };
  it("parses every param, and an empty URL is IT with nothing filtered", () => {
    expect(parseFinanceListState(sp(""))).toEqual(DEFAULT);
    expect(parseFinanceListState(sp("cls=PURCHASING&category=c1&status=STORED&fin=no-cost&q=%20desk%20&life=full&sort=tag&page=3&per=50")))
      .toEqual({ cls: "PURCHASING", category: "c1", status: "STORED", fin: "no-cost", q: "desk", life: "full", sort: "tag", page: 3, per: 50 });
  });
  it("drops what does not belong: another class's status, Waiting for IT on Purchasing, odd sizes and sorts", () => {
    expect(parseFinanceListState(sp("cls=PURCHASING&status=DEPLOYED&fin=awaiting-it"))).toMatchObject({ status: null, fin: null });
    expect(parseFinanceListState(sp("fin=awaiting-it&status=DEPLOYED"))).toMatchObject({ status: "DEPLOYED", fin: "awaiting-it" });
    expect(parseFinanceListState(sp("per=7&sort=odd&life=mid&page=-2&category="))).toMatchObject({ per: 25, sort: "book", life: null, page: 1, category: null });
    expect(parseFinanceListState(sp(`q=${"x".repeat(150)}`)).q).toHaveLength(100);
  });
  it("writes only what differs from the defaults, in a fixed order", () => {
    expect(financeListHref(DEFAULT)).toBe("/finance/assets");
    expect(financeListHref({ ...DEFAULT, cls: "PURCHASING", category: "other", status: "STORED", fin: "approved", q: "a b", life: "soon", sort: "life", page: 2, per: 100 }))
      .toBe("/finance/assets?cls=PURCHASING&category=other&status=STORED&fin=approved&q=a+b&life=soon&sort=life&page=2&per=100");
  });
  it("round-trips", () => {
    const s: FinanceListState = { ...DEFAULT, category: "c9", fin: "with-finance", q: "IT-1", life: "notstarted", sort: "tag", page: 4, per: 50 };
    expect(parseFinanceListState(new URL(financeListHref(s), "http://x").searchParams)).toEqual(s);
  });
  it("withFinance changes the given params and goes back to page 1", () => {
    const s = { ...DEFAULT, page: 5, q: "dell" };
    expect(withFinance(s, { category: "c2" })).toEqual({ ...s, category: "c2", page: 1 });
    expect(withFinance(s, { life: null })).toEqual({ ...s, page: 1 });
  });
  it("switching class clears every filter but keeps the sort and the page size", () => {
    const s: FinanceListState = { ...DEFAULT, category: "c1", status: "SPARE", fin: "approved", q: "x", life: "full", sort: "tag", page: 3, per: 50 };
    expect(financeClassHref(s, "PURCHASING")).toBe("/finance/assets?cls=PURCHASING&sort=tag&per=50");
    expect(clearFinanceFilters(s)).toEqual({ ...DEFAULT, sort: "tag", per: 50 });
  });
  it("the export carries every filter and the sort, never the page", () => {
    const s: FinanceListState = { ...DEFAULT, category: "other", status: "SPARE", fin: "approved", q: "x", life: "full", sort: "tag", page: 3, per: 50 };
    expect(financeExportHref(s)).toBe("/finance/assets/export?category=other&status=SPARE&fin=approved&q=x&life=full&sort=tag");
    expect(financeExportHref(DEFAULT)).toBe("/finance/assets/export");
  });
});
