import { describe, expect, it } from "vitest";
import {
  consumptionGrid, defaultConsumptionRange, expiryBuckets, manilaDayBounds, monthKey, monthsBetween,
  parseExpiryWindow, parseReportRange, STOCK_REPORT_LIST_CONFIG,
} from "./stock-reports";

describe("monthKey", () => {
  it("stays in August at 15:59Z on the last day of August (23:59 Manila)", () => {
    expect(monthKey(new Date("2026-08-31T15:59:00Z"))).toBe("2026-08");
  });
  it("rolls to September at 16:00Z (00:00 Manila, Sep 1)", () => {
    expect(monthKey(new Date("2026-08-31T16:00:00Z"))).toBe("2026-09");
  });
});

describe("monthsBetween", () => {
  it("returns the six month keys from April through September inclusive", () => {
    expect(monthsBetween("2026-04-01", "2026-09-16")).toEqual([
      "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
  });
  it("returns a single key when from and to share a month", () => {
    expect(monthsBetween("2026-09-01", "2026-09-16")).toEqual(["2026-09"]);
  });
  it("crosses a year boundary", () => {
    expect(monthsBetween("2025-11-01", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("defaultConsumptionRange", () => {
  it("is the first of the month five months back through today", () => {
    expect(defaultConsumptionRange("2026-09-16")).toEqual({ from: "2026-04-01", to: "2026-09-16" });
  });
  it("crosses a year boundary", () => {
    expect(defaultConsumptionRange("2026-02-10")).toEqual({ from: "2025-09-01", to: "2026-02-10" });
  });
});

describe("consumptionGrid", () => {
  it("builds cells per department x month with row and column totals", () => {
    const grid = consumptionGrid([
      { department: "HR", monthKey: "2026-08", units: 10, cost: 100, uncostedUnits: 0 },
      { department: "HR", monthKey: "2026-09", units: 5, cost: 50, uncostedUnits: 0 },
      { department: "IT", monthKey: "2026-08", units: 2, cost: 20, uncostedUnits: 0 },
    ]);
    expect(grid.months).toEqual(["2026-08", "2026-09"]);
    expect(grid.rows.map((r) => r.department)).toEqual(["HR", "IT"]);

    const hr = grid.rows.find((r) => r.department === "HR")!;
    expect(hr.cells["2026-08"]).toEqual({ units: 10, cost: 100, uncostedUnits: 0 });
    expect(hr.cells["2026-09"]).toEqual({ units: 5, cost: 50, uncostedUnits: 0 });
    expect(hr.total).toEqual({ units: 15, cost: 150, uncostedUnits: 0 });

    const it_ = grid.rows.find((r) => r.department === "IT")!;
    // IT has no September activity — the cell still exists, empty.
    expect(it_.cells["2026-09"]).toEqual({ units: 0, cost: null, uncostedUnits: 0 });

    expect(grid.columnTotals["2026-08"]).toEqual({ units: 12, cost: 120, uncostedUnits: 0 });
    expect(grid.grandTotal).toEqual({ units: 17, cost: 170, uncostedUnits: 0 });
  });

  it("flags a cell as carrying uncosted units and keeps cost null when nothing in it is costed", () => {
    const grid = consumptionGrid([
      { department: "HR", monthKey: "2026-08", units: 6, cost: null, uncostedUnits: 6 },
    ]);
    const cell = grid.rows[0].cells["2026-08"];
    expect(cell.cost).toBeNull();
    expect(cell.uncostedUnits).toBe(6);
  });

  it("sums a mixed cell's cost from its costed rows and leaves the uncosted count visible", () => {
    const grid = consumptionGrid([
      { department: "HR", monthKey: "2026-08", units: 5, cost: 40, uncostedUnits: 0 },
      { department: "HR", monthKey: "2026-08", units: 3, cost: null, uncostedUnits: 3 },
    ]);
    const cell = grid.rows[0].cells["2026-08"];
    expect(cell).toEqual({ units: 8, cost: 40, uncostedUnits: 3 });
  });

  it("returns an empty grid for no rows", () => {
    const grid = consumptionGrid([]);
    expect(grid.months).toEqual([]);
    expect(grid.rows).toEqual([]);
    expect(grid.grandTotal).toEqual({ units: 0, cost: null, uncostedUnits: 0 });
  });
});

describe("manilaDayBounds (Task 5 review)", () => {
  it("bounds a range of Asia/Manila calendar days, to inclusive", () => {
    const { start, endExclusive } = manilaDayBounds("2026-09-01", "2026-09-16");
    // 1 Sep 00:00 Manila is 31 Aug 16:00Z; the day after 16 Sep starts at 16 Sep 16:00Z.
    expect(start.toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-09-16T16:00:00.000Z");
  });
  it("keeps an issue stamped late on the last day inside the window", () => {
    const { start, endExclusive } = manilaDayBounds("2026-09-16", "2026-09-16");
    const lateOnThe16th = new Date("2026-09-16T15:59:59Z"); // 23:59:59 Manila
    const firstOfThe17th = new Date("2026-09-16T16:00:00Z"); // 00:00 Manila next day
    expect(lateOnThe16th >= start && lateOnThe16th < endExclusive).toBe(true);
    expect(firstOfThe17th < endExclusive).toBe(false);
  });
  it("lists the uncosted toggle as a report facet so ?uncosted=1 reaches the state", () => {
    expect(STOCK_REPORT_LIST_CONFIG.facets).toContain("uncosted");
  });
});

describe("expiryBuckets", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const TODAY = "2026-09-16";
  const lots = [
    { id: "expired-old", expiresAt: d("2026-08-01") },
    { id: "expired-recent", expiresAt: d("2026-09-10") },
    { id: "expiring-soon", expiresAt: d("2026-09-20") },
    { id: "expiring-later", expiresAt: d("2026-10-10") },
    { id: "far-future", expiresAt: d("2027-01-01") },
    { id: "undated", expiresAt: null },
  ];

  it("splits into expired and expiring-within-window, each sorted by expiresAt ascending", () => {
    const buckets = expiryBuckets(lots, TODAY, 30);
    expect(buckets.expired.map((l) => l.id)).toEqual(["expired-old", "expired-recent"]);
    expect(buckets.expiring.map((l) => l.id)).toEqual(["expiring-soon", "expiring-later"]);
  });

  it("a narrower window excludes lots expiring beyond it", () => {
    const buckets = expiryBuckets(lots, TODAY, 7);
    expect(buckets.expiring.map((l) => l.id)).toEqual(["expiring-soon"]);
  });

  it("never places an undated lot in either bucket", () => {
    const buckets = expiryBuckets(lots, TODAY, 90);
    expect(buckets.expired.some((l) => l.id === "undated")).toBe(false);
    expect(buckets.expiring.some((l) => l.id === "undated")).toBe(false);
  });
});

describe("STOCK_REPORT_LIST_CONFIG", () => {
  it("carries the category facet and the on-hand uncosted toggle, and no sort", () => {
    expect(STOCK_REPORT_LIST_CONFIG.facets).toEqual(["category", "uncosted"]);
    expect(STOCK_REPORT_LIST_CONFIG.sortable).toEqual([]);
  });
});

describe("parseReportRange", () => {
  it("falls back to defaultConsumptionRange when from/to are absent", () => {
    expect(parseReportRange(new URLSearchParams(""), "2026-09-16")).toEqual({ from: "2026-04-01", to: "2026-09-16" });
  });
  it("reads well-formed from/to params", () => {
    expect(parseReportRange(new URLSearchParams("from=2026-01-01&to=2026-03-01"), "2026-09-16"))
      .toEqual({ from: "2026-01-01", to: "2026-03-01" });
  });
  it("ignores a malformed date and falls back to the default for that side", () => {
    expect(parseReportRange(new URLSearchParams("from=not-a-date"), "2026-09-16"))
      .toEqual({ from: "2026-04-01", to: "2026-09-16" });
  });
});

describe("parseExpiryWindow", () => {
  it("defaults to 30 when absent", () => {
    expect(parseExpiryWindow(new URLSearchParams(""))).toBe(30);
  });
  it("accepts 7 and 90", () => {
    expect(parseExpiryWindow(new URLSearchParams("days=7"))).toBe(7);
    expect(parseExpiryWindow(new URLSearchParams("days=90"))).toBe(90);
  });
  it("falls back to the default for a value outside the fixed set", () => {
    expect(parseExpiryWindow(new URLSearchParams("days=45"))).toBe(30);
  });
});
