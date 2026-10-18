import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 43 (Task 4, item 5): the depreciation drill-down computed the class's year grid twice — once for the summary,
 * again for the one category. scheduleView computes it once and derives both; this pins that its summary and its
 * drill-down equal what scheduleSummary and scheduleCategory return on their own, over fixtures that page (31 assets
 * in one category), mix classes, and include not-capitalised, uncosted, not-started and no-policy assets.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  assets: [] as Record<string, unknown>[],
  categories: [] as Record<string, unknown>[],
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

/** Enough of Prisma's where for depRows' reads: AND, equals, and `{ not: null }`. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Row[]).every((w) => matches(row, w));
    if (cond !== null && typeof cond === "object" && "not" in (cond as Row)) return row[key] !== (cond as Row).not;
    return row[key] === cond;
  });
}

vi.mock("@/server/db/client", () => ({
  prisma: { asset: { findMany: h.findMany }, assetCategory: { findFirst: h.findFirst } },
}));

import { scheduleCategory, scheduleSummary, scheduleView } from "./depreciation-queries";

const NOW = new Date("2026-10-19T04:00:00.000Z");

function asset(i: number, categoryId: string, extra: Row = {}): Row {
  const cat = h.categories.find((c) => c.id === categoryId)!;
  return {
    id: `as${i}`, tag: `IT-${String(1000 - i * 7).padStart(5, "0")}`, model: `Model ${i}`, categoryId, cls: cat.cls,
    status: "DEPLOYED", cost: String(20_000 + i * 1_337.5), itVerifiedAt: new Date("2023-01-01T00:00:00Z"),
    financeConfirmedAt: new Date("2023-02-01T00:00:00Z"), financeReturnedAt: null, financeNotCapitalised: false,
    purchasedAt: new Date(Date.UTC(2021 + (i % 5), i % 12, 1 + (i % 27))),
    depreciationLifeMonths: i % 9 === 0 ? 24 : null, depreciationSalvage: i % 9 === 0 ? "500" : null,
    depreciationNote: null, assignee: i % 2 ? { name: `Person ${i}` } : null,
    category: { name: cat.name, depreciationLifeMonths: cat.life, depreciationSalvagePercent: cat.salvage },
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.categories = [
    { id: "c1", name: "Laptops", cls: "IT", life: 120, salvage: "10" },
    { id: "c2", name: "Monitors", cls: "IT", life: 60, salvage: null },
    { id: "c3", name: "Docks", cls: "IT", life: null, salvage: null },
    { id: "p1", name: "Chairs", cls: "PURCHASING", life: 84, salvage: "5" },
  ];
  h.assets = [
    ...Array.from({ length: 31 }, (_, i) => asset(i, "c1")),
    asset(40, "c2"), asset(41, "c2"), asset(42, "c2", { purchasedAt: null }),
    asset(43, "c3"), // no policy
    asset(44, "c1", { financeConfirmedAt: null }), // not depreciating yet
    asset(45, "c1", { financeNotCapitalised: true }), // not capitalised: outside the schedule
    asset(46, "c2", { cost: null }), // no cost: outside the schedule
    asset(47, "p1"), asset(48, "p1"),
  ].reverse(); // the database's order is not the tag order
  h.findMany.mockImplementation(async ({ where }: { where: Row }) => h.assets.filter((a) => matches(a, where)));
  h.findFirst.mockImplementation(async ({ where }: { where: { id: string; cls: string } }) => {
    const c = h.categories.find((x) => x.id === where.id && x.cls === where.cls);
    return c ? { name: c.name } : null;
  });
});

async function before(cls: "IT" | "PURCHASING", year: number, categoryId: string, page: number) {
  const summary = await scheduleSummary(cls, year, NOW);
  const drill = categoryId ? await scheduleCategory(cls, year, categoryId, page, NOW) : null;
  return { summary, drill };
}

describe("scheduleView (Phase 43: one grid pass for the summary and the drill-down)", () => {
  it.each([
    ["IT", 2026, "c1", 1], ["IT", 2026, "c1", 2], ["IT", 2026, "c1", 9], ["IT", 2024, "c1", 1], ["IT", 2023, "c2", 1],
    ["IT", 2027, "c2", 1], ["IT", 2026, "c3", 1], ["IT", 2026, "", 1], ["IT", 2026, "nope", 1], ["IT", 2026, "p1", 1],
    ["PURCHASING", 2026, "p1", 1], ["PURCHASING", 2030, "p1", 1], ["IT", 2040, "c1", 1],
  ] as const)("%s %i, category %j, page %i: identical to the two separate reads", async (cls, year, cat, page) => {
    const expected = await before(cls, year, cat, page);
    expect(await scheduleView(cls, year, cat, page, NOW)).toEqual(expected);
  });

  it("reads the assets once, not twice", async () => {
    await before("IT", 2026, "c1", 1);
    expect(h.findMany).toHaveBeenCalledTimes(2);
    h.findMany.mockClear();
    const view = await scheduleView("IT", 2026, "c1", 2, NOW);
    expect(h.findMany).toHaveBeenCalledTimes(1);
    // more than one page of laptops depreciate in 2026, so page 2 is a real second page
    expect(view.drill).toMatchObject({ category: "Laptops", page: 2, pageCount: 2 });
    expect(view.drill!.total).toBeGreaterThan(25);
    expect(view.drill!.rows).toHaveLength(view.drill!.total - 25);
  });

  it("does not look the category up without a drill-down", async () => {
    expect((await scheduleView("IT", 2026, "", 1, NOW)).drill).toBeNull();
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it("the drill-down's subtotal is its share of the summary's category row", async () => {
    const { summary, drill } = await scheduleView("IT", 2026, "c1", 1, NOW);
    const row = summary.categories.find((c) => c.categoryId === "c1")!;
    expect(drill!.subtotal).toEqual(row.row);
    expect(drill!.subtotalCostC).toBe(row.costC);
    expect(drill!.total).toBe(row.assets);
  });
});
