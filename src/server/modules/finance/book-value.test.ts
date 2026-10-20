import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 46 Task 3: bookValueByCategory is the same fold as bookValueTotals({}) split by category, so the Finance
 * make-up and the Book value tile (and the snapshot's fin.bookC) can never disagree; capitalizedSince reads what
 * Finance approved as capitalised, dated by financeConfirmedAt.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({ assets: [] as Record<string, unknown>[], wheres: [] as unknown[] }));

/** Enough of Prisma's where for these reads: AND, NOT, equals, `{ not: null }` and `{ gte }`. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Row[]).every((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Row);
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("not" in c) return row[key] !== c.not;
      if ("gte" in c) return row[key] instanceof Date && (row[key] as Date) >= (c.gte as Date);
    }
    return row[key] === cond;
  });
}

vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: {
      findMany: async ({ where }: { where: Row }) => {
        h.wheres.push(where);
        return h.assets.filter((a) => matches(a, where));
      },
    },
  },
}));

import { bookValueByCategory, bookValueTotals, capitalizedSince } from "./depreciation-queries";

const NOW = new Date("2026-10-20T03:00:00Z");

function asset(i: number, category: string, extra: Row = {}): Row {
  return {
    id: `a${i}`, tag: `T-${i}`, model: "M", categoryId: category, cls: "IT", status: "DEPLOYED", cost: String(10_000 + i * 1_000),
    itVerifiedAt: new Date("2024-01-01T00:00:00Z"), financeConfirmedAt: new Date("2024-02-01T00:00:00Z"), financeReturnedAt: null,
    financeNotCapitalised: false, purchasedAt: new Date("2024-01-15T00:00:00Z"),
    depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null, assignee: null,
    category: { name: category, depreciationLifeMonths: 60, depreciationSalvagePercent: null },
    ...extra,
  };
}

beforeEach(() => {
  h.wheres = [];
  h.assets = [
    asset(1, "Laptops"), asset(2, "Laptops"), asset(3, "Monitors"),
    asset(4, "Chairs", { cls: "PURCHASING" }),
    asset(5, "Laptops", { financeNotCapitalised: true }), // not capitalised: no book value
    asset(6, "Docks", { cost: null }), // no cost: no book value
    asset(7, "Phones", { category: { name: "Phones", depreciationLifeMonths: null, depreciationSalvagePercent: null } }), // no policy
  ];
});

describe("bookValueByCategory", () => {
  it("its total is bookValueTotals({}).bookC, and its categories sum to that total", async () => {
    const [byCategory, totals] = await Promise.all([bookValueByCategory(NOW), bookValueTotals({}, NOW)]);
    expect(byCategory.bookC).toBe(totals.bookC);
    expect(byCategory.bookC).toBeGreaterThan(0);
    expect(byCategory.rows.reduce((s, r) => s + r.bookC, 0)).toBe(byCategory.bookC);
    expect(byCategory.rows.map((r) => r.label).sort()).toEqual(expect.arrayContaining(["Chairs", "Laptops", "Monitors"]));
    expect(byCategory.rows.map((r) => r.label)).not.toContain("Docks");
  });
});

describe("capitalizedSince", () => {
  beforeEach(() => {
    h.assets = [
      asset(1, "Laptops", { financeConfirmedAt: new Date("2026-10-19T02:00:00Z") }),
      asset(2, "Laptops", { financeConfirmedAt: new Date("2026-09-30T15:00:00Z") }), // Sep 30 23:00 Manila
      asset(3, "Laptops", { financeConfirmedAt: new Date("2026-10-05T02:00:00Z"), financeNotCapitalised: true }),
      asset(4, "Laptops", { financeConfirmedAt: new Date("2026-10-06T02:00:00Z"), cost: null }),
      asset(5, "Laptops", { financeConfirmedAt: new Date("2026-10-07T02:00:00Z"), cls: "IT", itVerifiedAt: null }), // awaiting IT
      asset(6, "Laptops", { financeConfirmedAt: new Date("2025-01-01T02:00:00Z") }),
    ];
  });

  it("only assets Finance approved as capitalised, with a cost, confirmed since the bound", async () => {
    const rows = await capitalizedSince(new Date("2026-09-01T00:00:00Z"));
    expect(rows).toEqual([
      { at: new Date("2026-10-19T02:00:00Z"), amount: 11_000 },
      { at: new Date("2026-09-30T15:00:00Z"), amount: 12_000 },
    ]);
  });
});
