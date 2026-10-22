import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, Role } from "@prisma/client";

/*
 * Phase 46 (spec §3.2, Purchasing / Finance / Admin rows): each builder's wiring — live values, hrefs, the history keys
 * it reads, month-to-date money tiles, needs-you, trend, make-up and breakdown. Prisma and the helpers are mocked; the
 * predicates passed to Prisma are real.
 */

const h = vi.hoisted(() => ({
  historyKeys: [] as string[],
  history: {} as Record<string, (number | null)[]>,
  assetWheres: [] as unknown[],
  spendSince: [] as Date[],
  capitalizedSince: [] as Date[],
  directSince: [] as Date[],
  nav: {} as Record<string, number>,
  navKeys: [] as string[][],
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    approval: {
      count: async (args: { where: { AND: Array<Record<string, unknown>> } }) =>
        args.where.AND.some((w) => "slaAt" in w) ? 2 : 9, // past SLA : open
    },
    asset: {
      count: async ({ where }: { where: Prisma.AssetWhereInput }) => {
        h.assetWheres.push(where);
        return JSON.stringify(where).includes('"cls":"PURCHASING"') ? 6 : 5;
      },
    },
    purchaseOrder: {
      findMany: async ({ where }: { where: Prisma.PurchaseOrderWhereInput }) =>
        "createdAt" in where
          ? [{ createdAt: new Date("2026-10-19T02:00:00Z") }, { createdAt: new Date("2026-10-18T02:00:00Z") }, { createdAt: new Date("2026-10-12T02:00:00Z") }]
          : [{ completedAt: new Date("2026-10-19T02:00:00Z") }],
    },
  },
}));
// Task 7: the team cards and Purchasing's To register read the nav's own counts (from state).
vi.mock("./nav-counts", async (orig) => ({
  ...(await orig<object>()),
  readNavCounts: async (keys: string[]) => {
    h.navKeys.push(keys);
    return Object.fromEntries(keys.map((k) => [k, h.nav[k] ?? 0]));
  },
}));
vi.mock("@/server/modules/metrics/history", () => ({
  metricHistory: async (keys: string[]) => {
    h.historyKeys = keys;
    return Object.fromEntries(keys.map((k) => [k, h.history[k] ?? Array(8).fill(null)]));
  },
}));
vi.mock("@/server/modules/purchases/queries", () => ({
  stateCounts: async () => ({ ALL: 50, WITH_IT: 21, SENT_BACK: 1, READY: 22, CANCELLED: 6 }),
}));
vi.mock("@/server/modules/stock/queries", () => ({
  stockHomeSignals: async () => ({ low: 31, expiringLots: 32, stocktakesOverdue: 33 }),
  overdueStocktakes: async () => [{ id: "s1", refNo: "STK-0003", scope: "Pantry", dueAt: new Date("2026-10-17T00:00:00Z") }],
}));
vi.mock("@/server/modules/finance/depreciation-queries", () => ({
  bookValueByCategory: async () => ({
    bookC: 4_844_200_000,
    rows: [{ label: "Monitors", bookC: 844_200_000 }, { label: "Laptops", bookC: 4_000_000_000 }],
  }),
  capitalizedSince: async (since: Date) => {
    h.capitalizedSince.push(since);
    return [
      { at: new Date("2026-10-19T02:00:00Z"), amount: 55_000 },
      { at: new Date("2026-09-20T02:00:00Z"), amount: 10_000 }, // last month: in the sparkline, not the value
    ];
  },
}));
vi.mock("@/server/modules/admin/queries", () => ({
  adminHome: async () => ({
    users: {
      total: 40, disabled: 4,
      byRole: [
        { role: "admin", count: 2 }, { role: "it_staff", count: 20 }, { role: "purchasing_staff", count: 8 },
        { role: "finance_staff", count: 6 }, { role: "viewer", count: 4 },
      ],
    },
    flags: [
      { key: "a", label: "Alpha", enabled: true, unavailable: false },
      { key: "b", label: "Beta", enabled: false, unavailable: true },
      { key: "c", label: "Gamma", enabled: true, unavailable: false },
    ],
    webhooks: { endpoints: 2, inactive: 0, dead: 7, delivered: 30 },
  }),
  deliveriesByStatus: async () => ({ DELIVERED: 10, PENDING: 0, RETRYING: 1, DEAD: 2 }),
  failingEndpoints: async () => [{ id: "e1", url: "https://hooks.example/a", dead: 7, active: true }],
  disabledAdmins: async () => [{ id: "u9", name: "Ana Cruz", email: "ana@example.com" }],
}));
vi.mock("./queries", async (orig) => ({
  ...(await orig<object>()),
  completedSpend: async (since: Date) => {
    h.spendSince.push(since);
    return [
      { at: new Date("2026-10-19T02:00:00Z"), amount: 1000.1, supplier: "Acme", department: "Ops" },
      { at: new Date("2026-10-12T02:00:00Z"), amount: 50, supplier: "Acme", department: "Ops" },
      { at: new Date("2026-10-01T02:00:00Z"), amount: 500, supplier: null, department: null },
      { at: new Date("2026-09-30T15:30:00Z"), amount: 200, supplier: "Bolt", department: "HR" }, // Sep 30 23:30 Manila
    ];
  },
  purchasingTodo: async () => [
    { id: "p1", refNo: "PR-1", what: "still a draft", meta: "₱100 · 1 d", href: "/purchases/p1", action: "Submit", bounced: false },
    { id: "p2", refNo: "PR-2", what: "came back from Ina", meta: "₱200 · 3 d", href: "/purchases/p2", action: "Fix and resubmit", bounced: true },
  ],
  // Task 6: Finance's review groups (reviewGroups), oldest first
  financeWaitingRows: async () => [
    {
      key: "rec1", recordId: "rec1", assetId: null, refNo: "PO-0010", title: "2 laptops", count: 2, total: "2000.20",
      registeredAt: new Date("2026-10-17T02:00:00Z"), team: "IT",
    },
    {
      key: "asset:a9", recordId: null, assetId: "a9", refNo: null, title: "BR-LT-0009 · Desk", count: 1, total: "0.90",
      registeredAt: new Date("2026-10-19T02:00:00Z"), team: "PURCHASING",
    },
  ],
  directChangeRows: async (since: Date) => {
    h.directSince.push(since);
    return [
      { at: new Date("2026-10-19T02:00:00Z"), cls: "IT" },
      { at: new Date("2026-10-18T02:00:00Z"), cls: "PURCHASING" },
      { at: new Date("2026-10-12T02:00:00Z"), cls: "IT" },
    ];
  },
}));

import { adminOverview, financeOverview, purchasingOverview } from "./overview";

// 03:00Z is 11:00 on Tue 2026-10-20 in Manila
const NOW = new Date("2026-10-20T03:00:00Z");
const user = (role: Role) => ({ id: "u1", role });
/** The month-to-date reads reach back to the sparkline's first week (Manila Aug 26), which is before Oct 1. */
const SPARK_START = "2026-08-25T16:00:00.000Z";
/** The Finance trend's 12 months start on Nov 1 2025, Manila. */
const TREND_START = "2025-10-31T16:00:00.000Z";

beforeEach(() => {
  h.historyKeys = [];
  h.history = {};
  h.assetWheres = [];
  h.spendSince = [];
  h.capitalizedSince = [];
  h.directSince = [];
  h.nav = { poSentBack: 4, assetsSentBackPurchasing: 1, poToRegister: 17 };
  h.navKeys = [];
});

describe("purchasingOverview", () => {
  it("six tiles; the linked ones open the page whose count they are", async () => {
    const o = await purchasingOverview(user("purchasing_staff"), NOW);
    expect(o.kpis.map((k) => [k.label, k.value, k.href])).toEqual([
      ["With IT", 21, "/purchases?state=WITH_IT"],
      ["To register", 17, "/purchases?register=1"],
      ["Spend this month", 1550.1, undefined],
      ["Below reorder", 31, "/stock?low=1"],
      ["Lots expiring", 32, "/stock/reports/expiry?days=30&tab=expiring"],
      ["Stocktakes overdue", 33, undefined],
    ]);
    // Task 7: pr.itReviewed snapshots this same To register count again, so the tile has its history back
    expect(h.historyKeys).toEqual(["pr.submitted", "pr.itReviewed", "stock.low", "stock.expiringLots", "stock.stocktakesOverdue"]);
    expect(h.navKeys).toEqual([["poSentBack", "assetsSentBackPurchasing", "poToRegister"]]);
  });

  it("To register: the spark ends at the live value, with pr.itReviewed's history", async () => {
    h.history["pr.itReviewed"] = [1, 2, 3, 4, 5, 6, 15, 16];
    const o = await purchasingOverview(user("purchasing_staff"), NOW);
    expect(o.kpis[1]).toMatchObject({
      key: "pr.itReviewed", hint: "Lines Purchasing can register", spark: [1, 2, 3, 4, 5, 6, 15, 17], delta: { kind: "count", value: 2 },
    });
  });

  it("Spend this month: Manila month to date, weekly sparkline, this week vs last week in percent", async () => {
    const o = await purchasingOverview(user("purchasing_staff"), NOW);
    expect(h.spendSince.map((d) => d.toISOString())).toEqual([SPARK_START]);
    // Sep 30 23:30 Manila is September: in the sparkline's week (today−20), not in the month's value
    expect(o.kpis[2]).toMatchObject({
      money: true, display: "₱1,550", hint: "3 purchase orders registered",
      spark: [0, 0, 0, 0, 0, 700, 50, 1000.1], delta: { kind: "week", value: 1900, unit: "pct" }, upIs: "neutral",
    });
  });

  it("count tiles: the spark ends at the live value, the delta is live minus 7 days ago", async () => {
    h.history["pr.submitted"] = [1, 2, 3, 4, 5, 6, 18, 20];
    const o = await purchasingOverview(user("purchasing_staff"), NOW);
    expect(o.kpis[0]).toMatchObject({ spark: [1, 2, 3, 4, 5, 6, 18, 21], delta: { kind: "count", value: 3 } });
    expect(o.kpis[3].delta).toEqual({ kind: "none" });
  });

  it("needs-you, trend, make-up and breakdown", async () => {
    const o = await purchasingOverview(user("purchasing_staff"), NOW);
    expect(o.needsYou.map((n) => [n.tone, n.title, n.href])).toEqual([
      // Task 7 (spec §7; fix round 1): the team's two Sent back cards, from state
      ["bad", "4 purchase orders sent back to you", "/purchases?state=SENT_BACK"],
      ["bad", "1 asset sent back to you", "/inventory?reg=needs-correction&to=PURCHASING"],
      ["bad", "STK-0003 · Pantry", "/stock/stocktakes/s1"],
      ["warn", "31 items below reorder level", "/stock?low=1"],
      ["warn", "PR-2 · came back from Ina", "/purchases/p2"],
      ["info", "PR-1 · still a draft", "/purchases/p1"],
    ]);
    expect(o.needsYouHref).toBe("/purchases");
    expect(o.trend.labels).toHaveLength(12);
    expect(o.trend.series.map((s) => [s.name, s.values.slice(-2)])).toEqual([["Created", [1, 2]], ["Registered", [0, 1]]]);
    expect(o.makeUp.rows.map((r) => [r.label, r.value, r.href])).toEqual([
      ["With IT", 21, "/purchases?state=WITH_IT"],
      ["Sent back", 1, "/purchases?state=SENT_BACK"],
      ["Ready to register", 22, "/purchases?state=READY"],
      ["Cancelled", 6, "/purchases?state=CANCELLED"],
    ]);
    // from the one spend read, this Manila month only: Bolt's Sep 30 23:30 (Manila) completion is September's
    expect(o.breakdown).toMatchObject({ money: true, rows: [{ label: "Acme", value: 1050.1 }, { label: "No vendor", value: 500 }] });
    expect(o.breakdown.rows).toHaveLength(2);
    expect(o.breakdown.rows.every((r) => r.href === undefined)).toBe(true); // ruling: vendor rows are not links
  });
});

describe("purchasingOverview: the Sent back cards (Task 7 fix round 1)", () => {
  it("one card per tab, each left out at 0, singular at 1", async () => {
    h.nav = { poSentBack: 0, assetsSentBackPurchasing: 3, poToRegister: 0 };
    let o = await purchasingOverview(user("purchasing_staff"), NOW);
    expect(o.needsYou.filter((n) => n.title.includes("sent back to you")).map((n) => n.title)).toEqual(["3 assets sent back to you"]);
    h.nav = { poSentBack: 1, assetsSentBackPurchasing: 0, poToRegister: 0 };
    o = await purchasingOverview(user("purchasing_staff"), NOW);
    expect(o.needsYou.filter((n) => n.title.includes("sent back to you")).map((n) => n.title)).toEqual(["1 purchase order sent back to you"]);
  });
});

describe("financeOverview", () => {
  it("six tiles; To confirm sums both classes and links to the IT view; Book value is a plain card (rulings)", async () => {
    const o = await financeOverview(user("finance_staff"), NOW);
    expect(o.kpis.map((k) => [k.label, k.value, k.href])).toEqual([
      ["Waiting on you", 2001.1, undefined],
      ["Groups to review", 2, "/finance/review"],
      ["Approved this month", 3, undefined],
      ["Capitalized this month", 55_000, undefined],
      ["Book value", 48_442_000, undefined],
      ["To confirm", 11, "/finance/assets?fin=with-finance"],
    ]);
    expect("href" in o.kpis[4]).toBe(false);
    expect(o.kpis[0]).toMatchObject({ money: true, display: "₱2,001", hint: "oldest 3 days", upIs: "bad" });
    expect(o.kpis[5].hint).toBe("5 IT · 6 Purchasing");
    expect(h.historyKeys).toEqual(["fin.waitingC", "fin.waitingCount", "fin.toConfirm.it", "fin.toConfirm.purchasing", "fin.bookC"]);
  });

  it("To confirm counts with /finance/assets' own predicates, per class", async () => {
    await financeOverview(user("finance_staff"), NOW);
    const [it, purchasing] = h.assetWheres as Array<{ AND: Array<Record<string, unknown>> }>;
    expect(it.AND[0]).toEqual({ cls: "IT" });
    expect(purchasing.AND[0]).toEqual({ cls: "PURCHASING" });
    expect(it.AND[1]).toMatchObject({ financeConfirmedAt: null, financeReturnedAt: null });
  });

  it("money tiles from snapshots: pesos from centavos, the change as a percent", async () => {
    h.history["fin.waitingC"] = [null, null, null, null, null, 50_000, 100_000, 90_000];
    h.history["fin.bookC"] = [null, null, null, null, null, null, 4_844_200_000, 4_844_200_000];
    const o = await financeOverview(user("finance_staff"), NOW);
    expect(o.kpis[0]).toMatchObject({ spark: [null, null, null, null, null, 500, 1000, 2001.1], delta: { kind: "pct", value: 100 } });
    expect(o.kpis[4]).toMatchObject({ display: "₱48,442,000", delta: { kind: "pct", value: 0 } });
  });

  it("one read per source over its widest window: spend back to the sparkline (before the quarter), capitalised back 12 months", async () => {
    await financeOverview(user("finance_staff"), NOW);
    expect(h.spendSince.map((d) => d.toISOString())).toEqual([SPARK_START]);
    expect(h.capitalizedSince.map((d) => d.toISOString())).toEqual([TREND_START]);
  });

  it("Approved this month is a count: requests completed this Manila month, weekly counts, the difference", async () => {
    const o = await financeOverview(user("finance_staff"), NOW);
    expect(o.kpis[2]).toMatchObject({ hint: "₱1,550 completed", spark: [0, 0, 0, 0, 0, 2, 1, 1], delta: { kind: "week", value: 0, unit: "count" } });
    expect(o.kpis[2].money).toBeUndefined();
  });

  it("Capitalized this month: only this month in its value; up from a zero week is new", async () => {
    const o = await financeOverview(user("finance_staff"), NOW);
    expect(o.kpis[3]).toMatchObject({ money: true, hint: "1 asset", spark: [0, 0, 0, 10_000, 0, 0, 0, 55_000], delta: { kind: "new" } });
  });

  it("To confirm history sums both classes; one class missing a point gives no delta", async () => {
    h.history["fin.toConfirm.it"] = [0, 0, 0, 0, 0, 0, 2, 4];
    h.history["fin.toConfirm.purchasing"] = [0, 0, 0, 0, 0, 0, 3, 3];
    let o = await financeOverview(user("finance_staff"), NOW);
    expect(o.kpis[5]).toMatchObject({ spark: [0, 0, 0, 0, 0, 0, 5, 11], delta: { kind: "count", value: 6 } });
    h.history["fin.toConfirm.purchasing"] = [0, 0, 0, 0, 0, 0, null, 3];
    o = await financeOverview(user("finance_staff"), NOW);
    expect(o.kpis[5].delta).toEqual({ kind: "none" });
  });

  it("needs-you, trend, make-up and breakdown", async () => {
    const o = await financeOverview(user("finance_staff"), NOW);
    expect(o.needsYou.map((n) => [n.title, n.href])).toEqual([
      // Task 7 (spec §7): the review queue's own count
      ["2 to check", "/finance/review"],
      ["5 IT registrations to confirm", "/finance/assets?fin=with-finance"],
      ["6 Purchasing registrations to confirm", "/finance/assets?cls=PURCHASING&fin=with-finance"],
      ["PO-0010 · 2 laptops from IT", "/finance/review/rec1"],
      ["No PO · BR-LT-0009 · Desk", "/finance/assets/a9"],
    ]);
    expect(o.needsYouHref).toBe("/finance/review");
    expect(o.trend).toMatchObject({ title: "Capitalized per month", unit: "₱" });
    expect(o.trend.labels).toEqual(expect.arrayContaining(["Nov 2025", "Oct 2026"]));
    expect(o.trend.series).toHaveLength(1);
    expect(o.trend.series[0].values.slice(-2)).toEqual([10_000, 55_000]);
    expect(o.makeUp).toMatchObject({
      money: true,
      rows: [{ label: "Laptops", value: 40_000_000, tone: "chart-1" }, { label: "Monitors", value: 8_442_000, tone: "chart-2" }],
    });
    // this Manila quarter (from Oct 1) from the same spend read: HR's Sep 30 23:30 completion is Q3's
    expect(o.breakdown).toMatchObject({ money: true, rows: [{ label: "Ops", value: 1050.1 }, { label: "No department", value: 500 }] });
    expect(o.breakdown.rows).toHaveLength(2);
  });
});

describe("adminOverview", () => {
  it("six tiles with the ruling's links; Direct changes and Flags on are plain cards", async () => {
    const o = await adminOverview(user("admin"), NOW);
    expect(o.kpis.map((k) => [k.label, k.value, k.href])).toEqual([
      ["Active accounts", 36, "/admin/users?disabled=0"],
      ["Webhook deliveries failed", 7, "/admin/webhooks/deliveries?state=DEAD"],
      ["Direct changes", 2, undefined],
      ["Flags on", 2, undefined],
      ["Approvals open", 9, "/approvals"],
      ["Disabled accounts", 4, "/admin/users?disabled=1"],
    ]);
    expect(o.kpis[4].hint).toBe("2 past SLA");
  });

  it("Approvals open reads every class's history (admin sees all classes)", async () => {
    await adminOverview(user("admin"), NOW);
    expect(h.historyKeys).toEqual([
      "admin.activeUsers", "admin.deadDeliveries", "admin.disabled",
      "approvals.open.it", "approvals.open.purchasing", "approvals.open.none",
    ]);
  });

  it("Direct changes: weekly counts from the dated rows, this week's being the value; Flags on is 'x of y' with no spark", async () => {
    const o = await adminOverview(user("admin"), NOW);
    expect(h.directSince.map((d) => d.toISOString())).toEqual([SPARK_START]);
    expect(o.kpis[2]).toMatchObject({ spark: [0, 0, 0, 0, 0, 0, 1, 2], delta: { kind: "count", value: 1 } });
    expect(o.kpis[3]).toMatchObject({ display: "2 of 3", hint: "1 unavailable in this build", spark: [], delta: { kind: "none" } });
  });

  it("needs-you, trend, make-up and breakdown", async () => {
    const o = await adminOverview(user("admin"), NOW);
    expect(o.needsYou.map((n) => [n.tone, n.title])).toEqual([
      ["bad", "7 dead webhook deliveries"],
      ["bad", "https://hooks.example/a"],
      ["warn", "Ana Cruz is a disabled admin"],
      ["info", "Beta is unavailable"],
    ]);
    expect(o.trend.series.map((s) => s.name)).toEqual(["IT", "Purchasing"]);
    expect(o.trend.labels).toHaveLength(14);
    // from the one direct-change read: Oct 19 and Oct 12 (IT), Oct 18 (Purchasing)
    expect(o.trend.series[0].values).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]);
    expect(o.trend.series[1].values).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    expect(o.makeUp.rows.map((r) => [r.label, r.value])).toEqual([["Delivered", 10], ["Retrying", 1], ["Dead", 2]]);
    expect(o.breakdown.rows[0]).toEqual({ label: "IT staff", value: 20 });
  });
});

describe("a fresh database (no snapshot rows yet)", () => {
  it.each([
    ["purchasing", () => purchasingOverview(user("purchasing_staff"), NOW)],
    ["finance", () => financeOverview(user("finance_staff"), NOW)],
    ["admin", () => adminOverview(user("admin"), NOW)],
  ] as const)("%s: snapshot tiles say collecting history; nothing is NaN", async (_, build) => {
    const o = await build();
    for (const k of o.kpis) {
      expect(Number.isFinite(k.value)).toBe(true);
      expect(k.spark.every((v) => v === null || Number.isFinite(v))).toBe(true);
      if ("value" in k.delta) expect(Number.isFinite(k.delta.value)).toBe(true);
    }
    const snapshotBacked = o.kpis.filter((k) => !/\.(month|week|on)$/.test(k.key));
    expect(snapshotBacked.length).toBeGreaterThan(0);
    expect(snapshotBacked.every((k) => k.delta.kind === "none")).toBe(true);
  });
});
