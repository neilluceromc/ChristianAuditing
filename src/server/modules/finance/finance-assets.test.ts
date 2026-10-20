import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 3, spec §3): financeAssets' aggregates — money totals, category and status tiles, finance-state
 * counts, the shown total — and its rows' life stage, life filter, sort and paging, over a small fixture with every
 * awkward case: no cost, not capitalised, not yet approved, awaiting IT, sent back, no policy, fully depreciated.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  assets: [] as Record<string, unknown>[],
  categories: [] as Record<string, unknown>[],
  findMany: vi.fn(),
  catFindMany: vi.fn(),
  count: vi.fn(),
}));

/** Enough of Prisma's where for these reads: AND, OR, NOT, equality, `{ not }`, `{ contains, mode }` and to-one relations. */
function matches(row: Row | null | undefined, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Row[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Row);
    const v = row?.[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("contains" in c) return typeof v === "string" && v.toLowerCase().includes(String(c.contains).toLowerCase());
      if ("not" in c) return v !== c.not;
      return v !== null && typeof v === "object" && matches(v as Row, c);
    }
    return v === cond;
  });
}

vi.mock("@/server/db/client", () => ({
  prisma: { asset: { findMany: h.findMany, count: h.count }, assetCategory: { findMany: h.catFindMany } },
}));

import { financeAssets, financeClassCount, financeExportRows, type FinanceListParams } from "./queries";
import { bookValueTotals } from "./depreciation-queries";
import { asOfMonth } from "@/lib/depreciation";
import { monthCharge } from "@/lib/finance-list";

const NOW = new Date("2026-10-19T04:00:00.000Z"); // October 2026, Manila
const APPROVED = new Date("2023-02-01T00:00:00Z");
const VERIFIED = new Date("2023-01-01T00:00:00Z");

let seq = 0;
function asset(categoryId: string, extra: Row = {}): Row {
  const cat = h.categories.find((c) => c.id === categoryId)!;
  seq++;
  return {
    id: `as${seq}`, tag: `${cat.cls === "IT" ? "IT" : "PU"}-${String(seq).padStart(4, "0")}`, model: `Model ${seq}`, serial: `SN${seq}`,
    categoryId, cls: cat.cls, status: cat.cls === "IT" ? "DEPLOYED" : "OPERATIONAL", cost: "36000.00",
    itVerifiedAt: VERIFIED, financeConfirmedAt: APPROVED, financeReturnedAt: null, financeNotCapitalised: false,
    purchasedAt: new Date("2025-12-15T00:00:00Z"), // Dec 2025 → 11 of 36 months used in Oct 2026
    depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null,
    assignee: seq % 2 ? { name: `Person ${seq}` } : null,
    category: { name: cat.name, depreciationLifeMonths: cat.life, depreciationSalvagePercent: cat.salvage },
    createdAt: new Date(Date.UTC(2024, 0, seq)),
    ...extra,
  };
}

const base = (p: Partial<FinanceListParams> = {}): FinanceListParams =>
  ({ cls: "IT", status: null, fin: null, q: "", page: 1, per: 100, ...p });

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  h.categories = [
    { id: "lap", name: "Laptops", cls: "IT", life: 36, salvage: null },
    { id: "mon", name: "Monitors", cls: "IT", life: 60, salvage: "10" },
    { id: "dock", name: "Docks", cls: "IT", life: null, salvage: null },
    { id: "chair", name: "Chairs", cls: "PURCHASING", life: 84, salvage: "5" },
    { id: "desk", name: "Desks", cls: "PURCHASING", life: 120, salvage: null },
  ];
  h.assets = [
    asset("lap"), // depreciating, 11/36
    asset("lap", { status: "SPARE", purchasedAt: new Date("2021-01-10T00:00:00Z") }), // fully depreciated
    asset("lap", { status: "SPARE", purchasedAt: new Date("2023-11-10T00:00:00Z") }), // Nov 2023 → 36th month is Oct 2026: last charge lands now
    asset("lap", { purchasedAt: new Date("2024-01-05T00:00:00Z") }), // 34/36 → 2 left: soon
    asset("lap", { status: "DEFECTIVE", financeConfirmedAt: null }), // with Finance: starts when approved
    asset("lap", { status: "DEFECTIVE", itVerifiedAt: null, financeConfirmedAt: null }), // awaiting IT
    asset("lap", { financeConfirmedAt: null, financeReturnedAt: new Date("2024-05-01T00:00:00Z") }), // sent back
    asset("lap", { cost: null, financeConfirmedAt: null }), // no cost, to review
    asset("mon", { financeNotCapitalised: true }), // not capitalised
    asset("mon", { cost: "12345.67", status: "MISSING" }), // depreciating, odd base
    asset("mon", { status: "TEMPORARY", depreciationLifeMonths: 24, depreciationSalvage: "100" }), // custom policy
    asset("dock", { cost: "2500.00" }), // no policy
    asset("dock", { status: "RETIRED" }), // no policy, no status tile
    asset("chair"), asset("chair", { status: "STORED" }), asset("chair", { financeConfirmedAt: null }),
    asset("desk", { cost: null, status: "LOST" }),
  ].reverse(); // the database's order is not the tag order
  h.findMany.mockImplementation(async ({ where }: { where: Row }) => h.assets.filter((a) => matches(a, where)));
  h.catFindMany.mockImplementation(async ({ where }: { where: Row }) => h.categories.filter((c) => matches(c, where)));
});

type Result = Awaited<ReturnType<typeof financeAssets>>;
const sumRows = (rows: Result["rows"]) => rows.reduce((a, r) => ({
  costC: a.costC + (r.result?.cost ?? 0),
  accC: a.accC + (r.result?.accumulated ?? 0),
  bookC: a.bookC + (r.result?.bookValue ?? 0),
  monthC: a.monthC + (r.result ? monthCharge(r.result, asOfMonth(NOW)) : 0),
  count: a.count + 1,
  costedCount: a.costedCount + (r.result ? 1 : 0),
  depreciatingCount: a.depreciatingCount + (r.result && monthCharge(r.result, asOfMonth(NOW)) > 0 ? 1 : 0),
}), { costC: 0, accC: 0, bookC: 0, monthC: 0, count: 0, costedCount: 0, depreciatingCount: 0 });

describe("financeAssets — money totals", () => {
  it("KPIs equal the sum of the class's rows, and the footer's rule (bookValueTotals)", async () => {
    const r = await financeAssets(base(), NOW);
    expect(r.rows).toHaveLength(13);
    expect(r.kpis).toEqual(sumRows(r.rows));
    const footer = await bookValueTotals({ cls: "IT" }, NOW);
    expect(r.kpis).toMatchObject({ costC: footer.costC, accC: footer.accumulatedC, bookC: footer.bookC });
    // depreciating this month: the 11/36 and 34/36 laptops, the one finishing this month, the two depreciating monitors
    expect(r.kpis.depreciatingCount).toBe(5);
    // 13 assets, 11 of them in costC: IT-0008 has no cost and IT-0009 is expensed
    expect(r.kpis).toMatchObject({ count: 13, costedCount: 11 });
    expect(r.kpis.monthC).toBeGreaterThan(0);
  });
  it("KPIs follow category and status, but not search, finance state or life", async () => {
    const all = await financeAssets(base({ category: "lap" }), NOW);
    expect(all.kpis).toEqual(sumRows(all.rows));
    expect(all.kpis.count).toBe(8);
    const deployed = await financeAssets(base({ category: "lap", status: "DEPLOYED" }), NOW);
    expect(deployed.kpis).toEqual(sumRows(deployed.rows));
    expect(deployed.kpis.count).toBe(4);
    expect(deployed.kpis.costedCount).toBe(3); // IT-0008 (no cost) is deployed too
    const narrowed = await financeAssets(base({ category: "lap", fin: "approved", life: "soon", q: "IT-0004" }), NOW);
    expect(narrowed.kpis).toEqual(all.kpis);
    expect(narrowed.rows.map((x) => x.tag)).toEqual(["IT-0004"]);
  });
  it("shown is the count and the cost, depreciation and book value of every matching row, across pages", async () => {
    const r = await financeAssets(base({ per: 25, fin: "approved" }), NOW);
    const sum = sumRows(r.rows);
    expect(r.shown).toEqual({ count: r.rows.length, costedCount: sum.costedCount, costC: sum.costC, accC: sum.accC, bookC: sum.bookC });
    const paged = await financeAssets(base({ per: 25, page: 1 }), NOW);
    expect(paged.shown.count).toBe(13);
  });
});

describe("financeAssets — tiles", () => {
  it("category tiles cover the class only, scoped by neither status nor category", async () => {
    const r = await financeAssets(base({ category: "mon", status: "DEPLOYED" }), NOW);
    expect(r.categoryTiles.map((t) => [t.id, t.count, t.on])).toEqual([
      ["all", 13, false], ["lap", 8, false], ["mon", 3, true], ["dock", 2, false],
    ]);
    const all = await financeAssets(base(), NOW);
    expect(r.categoryTiles.map((t) => t.bookC)).toEqual(all.categoryTiles.map((t) => t.bookC));
    expect(all.categoryTiles[0]).toMatchObject({ bookC: all.kpis.bookC, costC: all.kpis.costC, on: true });
  });
  it("status tiles are the class's Phase 45 status tiles, scoped by category and not by status", async () => {
    const r = await financeAssets(base({ category: "lap", status: "SPARE" }), NOW);
    expect(r.statusTiles.map((t) => t.status)).toEqual(["SPARE", "DEPLOYED", "TEMPORARY", "DEFECTIVE", "MISSING"]);
    const lap = (await financeAssets(base({ category: "lap", per: 100 }), NOW)).rows;
    for (const t of r.statusTiles) {
      const these = lap.filter((x) => x.status === t.status);
      expect(t).toEqual({ status: t.status, count: these.length, bookC: these.reduce((a, x) => a + (x.result?.bookValue ?? 0), 0) });
    }
    expect(r.statusTiles.find((t) => t.status === "DEFECTIVE")!.count).toBe(2);
    const p = await financeAssets(base({ cls: "PURCHASING" }), NOW);
    expect(p.statusTiles.map((t) => t.status)).toEqual(["OPERATIONAL", "STORED", "REPAIRING", "LOST"]);
  });
  it("category=other filters to every folded category; empty categories get no tile", async () => {
    h.categories.push(...["a", "b", "c", "d", "e", "f"].map((x) => ({ id: x, name: `Extra ${x}`, cls: "IT", life: 36, salvage: null })));
    h.assets.push(asset("a"), asset("a"), asset("b"), asset("c"), asset("d")); // e and f stay empty
    // 7 IT categories with assets → 8 tiles → All + 4 + Other: the three smallest (b, c, d, one each) fold
    const r = await financeAssets(base({ category: "other", sort: "tag" }), NOW);
    expect(r.categoryTiles.map((t) => t.id)).toEqual(["all", "lap", "mon", "a", "dock", "other"]);
    expect(r.categoryTiles.at(-1)).toMatchObject({ count: 3, on: true });
    expect(r.category).toBe("other");
    expect(r.rows.map((x) => x.categoryId)).toEqual(["b", "c", "d"]);
    expect(r.kpis.count).toBe(3);
    const empty = await financeAssets(base({ category: "e" }), NOW);
    expect(empty.category).toBeNull();
    expect(empty.categoryTiles[0].on).toBe(true);
  });
  it("category=other with nothing folded is ignored", async () => {
    const r = await financeAssets(base({ category: "other" }), NOW);
    expect(r.category).toBeNull();
    expect(r.categoryTiles[0].on).toBe(true);
    expect(r.rows).toHaveLength(13);
  });
  it("an unknown or other-class category is ignored", async () => {
    const r = await financeAssets(base({ category: "chair" }), NOW);
    expect(r.category).toBeNull();
    expect(r.rows).toHaveLength(13);
    expect(r.categoryTiles[0].on).toBe(true);
  });
});

describe("financeAssets — finance-state counts", () => {
  it("IT counts every tab; the counts ignore the finance filter itself", async () => {
    const r = await financeAssets(base({ fin: "approved" }), NOW);
    expect(Object.fromEntries(r.finCounts.map((c) => [c.key, c.count]))).toEqual({
      all: 13, "with-finance": 2, "needs-correction": 1, "awaiting-it": 1, approved: 8, "not-capitalised": 1, "no-cost": 1,
    });
    expect(r.rows).toHaveLength(8);
  });
  it("Purchasing has no awaiting-it count", async () => {
    const r = await financeAssets(base({ cls: "PURCHASING" }), NOW);
    expect(r.finCounts.map((c) => c.key)).toEqual(["all", "with-finance", "needs-correction", "approved", "not-capitalised", "no-cost"]);
    expect(r.finCounts.find((c) => c.key === "all")!.count).toBe(4);
  });
  it("counts follow search and life", async () => {
    const r = await financeAssets(base({ life: "notstarted" }), NOW);
    const all = r.finCounts.find((c) => c.key === "all")!.count;
    expect(all).toBe(r.rows.length);
    expect(r.rows.every((x) => x.lifeStage.key === "notstarted")).toBe(true);
    const q = await financeAssets(base({ q: "person 1" }), NOW); // Person 1, 11, 13 (holders)
    expect(q.finCounts.find((c) => c.key === "all")!.count).toBe(3);
  });
});

describe("financeAssets — rows", () => {
  it("Review Focus 1: no cost, not capitalised, not yet approved read the right life text and book value", async () => {
    const r = await financeAssets(base({ per: 100 }), NOW);
    const by = (pred: (x: Result["rows"][number]) => boolean) => r.rows.find(pred)!;
    const noCost = by((x) => x.costC === null);
    expect(noCost.lifeStage.text).toBe("No cost yet");
    expect(noCost.result).toBeNull();
    const expensed = by((x) => x.notCapitalised);
    expect(expensed.lifeStage.text).toBe("Expensed, not depreciated");
    expect(expensed.result).toBeNull();
    const pending = by((x) => x.reg === "with-finance" && x.costC !== null);
    expect(pending.lifeStage).toEqual({ key: "notstarted", text: "Starts when approved", usedPct: null, usedRatio: null });
    expect(pending.result!.bookValue).toBe(36_000_00);
    expect(by((x) => x.reg === "awaiting-it").lifeStage.text).toBe("Starts when approved");
    expect(by((x) => x.tag === "IT-0001").lifeStage).toEqual({ key: "mid", text: "11 / 36 mo · 25 left", usedPct: 31, usedRatio: 11 / 36 });
    expect(by((x) => x.tag === "IT-0004").lifeStage.key).toBe("soon");
    expect(by((x) => x.tag === "IT-0002").lifeStage.key).toBe("full");
    expect(by((x) => x.tag === "IT-0012").lifeStage.text).toBe("No policy for Docks");
  });
  it("life filters", async () => {
    expect((await financeAssets(base({ life: "soon" }), NOW)).rows.map((x) => x.tag)).toEqual(["IT-0004"]);
    expect((await financeAssets(base({ life: "full", sort: "tag" }), NOW)).rows.map((x) => x.tag)).toEqual(["IT-0002", "IT-0003"]);
    expect((await financeAssets(base({ life: "notstarted", sort: "tag" }), NOW)).rows.map((x) => x.tag))
      .toEqual(["IT-0005", "IT-0006", "IT-0007", "IT-0008", "IT-0012", "IT-0013"]); // not IT-0009: expensed, not "yet"
  });
  it("sorts: book value high first by default, life used, tag", async () => {
    const book = (await financeAssets(base(), NOW)).rows;
    const bv = book.map((x) => x.result?.bookValue ?? -1);
    expect(bv).toEqual([...bv].sort((a, b) => b - a));
    expect(book.slice(-2).every((x) => x.result === null)).toBe(true);
    const life = (await financeAssets(base({ sort: "life" }), NOW)).rows;
    expect(life.slice(0, 2).map((x) => x.lifeStage.key)).toEqual(["full", "full"]);
    const pct = life.map((x) => x.lifeStage.usedPct ?? -1);
    expect(pct).toEqual([...pct].sort((a, b) => b - a));
    const tag = (await financeAssets(base({ sort: "tag" }), NOW)).rows.map((x) => x.tag);
    expect(tag).toEqual([...tag].sort());
  });
  it("sorts by cost, date approved, date added and purchase date: the row model carries the dates, nulls last in tag order", async () => {
    h.assets = [
      asset("lap", { tag: "T-1", cost: "100.00", financeConfirmedAt: new Date("2026-10-03T02:00:00Z"), purchasedAt: new Date("2026-03-01T00:00:00Z"), createdAt: new Date("2026-01-03T02:00:00Z") }),
      asset("lap", { tag: "T-2", cost: null, financeConfirmedAt: null, itVerifiedAt: null, purchasedAt: null, createdAt: new Date("2026-01-01T02:00:00Z") }),
      asset("lap", { tag: "T-3", cost: "300.00", financeConfirmedAt: new Date("2026-10-05T02:00:00Z"), purchasedAt: new Date("2026-05-01T00:00:00Z"), createdAt: new Date("2026-01-05T02:00:00Z") }),
      asset("lap", { tag: "T-4", cost: "200.00", financeConfirmedAt: null, itVerifiedAt: null, purchasedAt: null, createdAt: new Date("2026-01-02T02:00:00Z") }),
    ];
    const tags = async (sort: FinanceListParams["sort"]) => (await financeAssets(base({ sort }), NOW)).rows.map((x) => x.tag.slice(-1));
    expect(await tags("cost")).toEqual(["3", "4", "1", "2"]);
    expect(await tags("cost-asc")).toEqual(["1", "4", "3", "2"]);
    expect(await tags("approved")).toEqual(["3", "1", "2", "4"]);
    expect(await tags("approved-asc")).toEqual(["1", "3", "2", "4"]);
    expect(await tags("added")).toEqual(["3", "1", "4", "2"]);
    expect(await tags("added-asc")).toEqual(["2", "4", "1", "3"]);
    expect(await tags("purchased")).toEqual(["3", "1", "2", "4"]);
    expect(await tags("purchased-asc")).toEqual(["1", "3", "2", "4"]);
    const first = (await financeAssets(base({ sort: "approved" }), NOW)).rows[0];
    expect(first.approvedAt).toEqual(new Date("2026-10-05T02:00:00Z"));
    expect(first.addedAt).toEqual(new Date("2026-01-05T02:00:00Z"));
    expect(first.purchasedAt).toEqual(new Date("2026-05-01T00:00:00Z"));
  });
  it("pages by per over the sorted rows", async () => {
    const all = (await financeAssets(base({ sort: "tag" }), NOW)).rows;
    const p2 = await financeAssets(base({ sort: "tag", per: 25, page: 1 }), NOW);
    expect(p2.rows).toHaveLength(13);
    expect(p2).toMatchObject({ page: 1, pageCount: 1, total: 13, per: 25 });
    h.assets.push(...Array.from({ length: 20 }, () => asset("lap")));
    const big = await financeAssets(base({ sort: "tag", per: 25, page: 2 }), NOW);
    expect(big).toMatchObject({ page: 2, pageCount: 2, total: 33 });
    expect(big.rows).toHaveLength(8);
    expect(all.map((x) => x.tag)).toEqual(all.map((x) => x.tag).sort());
    const odd = await financeAssets(base({ per: 7 }), NOW);
    expect(odd.per).toBe(25);
  });
  it("reads the class once and searches in SQL (ids only)", async () => {
    await financeAssets(base({ q: "model 3" }), NOW);
    expect(h.findMany).toHaveBeenCalledTimes(2);
    expect(h.count).not.toHaveBeenCalled();
    expect(h.catFindMany).not.toHaveBeenCalled();
    await financeAssets(base(), NOW);
    expect(h.findMany).toHaveBeenCalledTimes(3);
  });
});

describe("financeExportRows (Task 3 review: the export is exactly the list's rows, every page)", () => {
  it("honours category (incl. other), status, fin, q, life and sort, unpaged", async () => {
    for (const p of [
      base({ sort: "tag" }),
      base({ category: "lap", status: "SPARE", sort: "life" }),
      base({ fin: "approved", life: "full" }),
      base({ q: "person 1", sort: "tag" }),
      base({ cls: "PURCHASING", fin: "with-finance" }),
    ]) {
      const list = await financeAssets({ ...p, per: 100 }, NOW);
      const out = await financeExportRows({ ...p, page: 7, per: 25 }, NOW);
      expect(out.map((x) => x.id)).toEqual(list.rows.map((x) => x.id));
    }
    h.categories.push(...["a", "b", "c", "d"].map((x) => ({ id: x, name: `Extra ${x}`, cls: "IT", life: 36, salvage: null })));
    h.assets.push(asset("a"), asset("a"), asset("b"), asset("c"), asset("d"));
    h.assets.push(...Array.from({ length: 30 }, () => asset("lap")));
    const other = await financeExportRows(base({ category: "other", sort: "tag" }), NOW);
    expect(other.map((x) => x.categoryId)).toEqual(["b", "c", "d"]);
    const all = await financeExportRows(base({ per: 25 }), NOW);
    expect(all).toHaveLength(48);
  });
  it("the export order equals the list order for every date sort", async () => {
    h.assets.forEach((a, i) => {
      a.financeConfirmedAt = i % 3 === 0 ? null : new Date(Date.UTC(2026, 5, 1 + (i * 7) % 20));
      a.purchasedAt = i % 4 === 0 ? null : new Date(Date.UTC(2026, 1, 1 + (i * 5) % 25));
      a.createdAt = new Date(Date.UTC(2026, 0, 1 + (i * 3) % 28));
    });
    for (const sort of ["approved", "approved-asc", "added", "added-asc", "purchased", "purchased-asc", "cost", "cost-asc", "book-asc"] as const) {
      const list = await financeAssets(base({ sort, per: 100 }), NOW);
      const out = await financeExportRows(base({ sort, page: 3, per: 25 }), NOW);
      expect(out.map((x) => x.id)).toEqual(list.rows.map((x) => x.id));
      expect(out.length).toBeGreaterThan(1);
    }
  });
});

describe("financeClassCount (spec §3 item 1: a class tab's asset count)", () => {
  it("counts every asset of the class, as the shown class's All categories tile does", async () => {
    h.count.mockImplementation(async ({ where }: { where: Row }) => h.assets.filter((a) => matches(a, where)).length);
    expect(await financeClassCount("IT")).toBe(13);
    expect(await financeClassCount("PURCHASING")).toBe(4);
    expect(h.count).toHaveBeenCalledTimes(2);
    expect((await financeAssets(base({ category: "lap", status: "SPARE", fin: "approved" }), NOW)).categoryTiles[0].count).toBe(13);
    expect((await financeAssets(base({ cls: "PURCHASING", q: "x" }), NOW)).categoryTiles[0].count).toBe(4);
  });
});
