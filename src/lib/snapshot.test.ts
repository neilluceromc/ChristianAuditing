import { describe, expect, it } from "vitest";
import { SNAPSHOT_KEYS, historyFromRows, manilaDay, snapshotDue } from "./snapshot";

describe("manilaDay (spec §2.1: the Manila calendar day)", () => {
  it("15:59Z is still the same Manila day; 16:00Z is the next one", () => {
    expect(manilaDay(new Date("2026-10-20T15:59:59.999Z"))).toBe("2026-10-20");
    expect(manilaDay(new Date("2026-10-20T16:00:00.000Z"))).toBe("2026-10-21");
  });
  it("early UTC morning is already later the same Manila day", () => {
    expect(manilaDay(new Date("2026-10-20T00:30:00Z"))).toBe("2026-10-20");
  });
  it("crosses a month and a year end", () => {
    expect(manilaDay(new Date("2026-10-31T16:00:00Z"))).toBe("2026-11-01");
    expect(manilaDay(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
});

describe("snapshotDue (spec §2.3)", () => {
  const now = new Date("2026-10-20T03:00:00Z"); // 11:00 Manila, 2026-10-20
  it("never taken → due", () => {
    expect(snapshotDue(null, now)).toBe(true);
  });
  it("already taken today → not due", () => {
    expect(snapshotDue("2026-10-20", now)).toBe(false);
  });
  it("taken yesterday → due", () => {
    expect(snapshotDue("2026-10-19", now)).toBe(true);
  });
  it("the gate opens exactly at Manila midnight", () => {
    expect(snapshotDue("2026-10-20", new Date("2026-10-20T15:59:59Z"))).toBe(false);
    expect(snapshotDue("2026-10-20", new Date("2026-10-20T16:00:00Z"))).toBe(true);
  });
});

describe("historyFromRows (spec §2.4)", () => {
  const today = "2026-10-20";
  // the 8 sample days, oldest first: today-49 … today
  const days = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20"];

  it("returns 8 points, oldest first, at today-7·k", () => {
    const rows = days.map((day, i) => ({ day, value: BigInt(i * 10) }));
    expect(historyFromRows(rows, today)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
  });

  it("an exact day wins over an earlier row", () => {
    const rows = [{ day: "2026-10-12", value: 1n }, { day: "2026-10-13", value: 2n }];
    expect(historyFromRows(rows, today)[6]).toBe(2);
  });

  it("a missing day takes the nearest earlier row within 3 days (2 days earlier)", () => {
    const rows = [{ day: "2026-10-10", value: 7n }, { day: "2026-10-11", value: 9n }];
    const h = historyFromRows(rows, today);
    expect(h[6]).toBe(9); // 2026-10-13 ← 2026-10-11
    expect(h[7]).toBeNull();
  });

  it("3 days earlier still fills; 4 days earlier is null", () => {
    expect(historyFromRows([{ day: "2026-10-10", value: 5n }], today)[6]).toBe(5);
    expect(historyFromRows([{ day: "2026-10-09", value: 5n }], today)[6]).toBeNull();
  });

  it("a later row never fills an earlier day", () => {
    expect(historyFromRows([{ day: "2026-10-14", value: 5n }], today)[6]).toBeNull();
  });

  it("no rows gives 8 nulls", () => {
    expect(historyFromRows([], today)).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("rows in any order; money values come back as numbers", () => {
    const rows = [{ day: "2026-10-20", value: 12_345_678n }, { day: "2026-09-01", value: 3n }];
    expect(historyFromRows(rows, today)).toEqual([3, null, null, null, null, null, null, 12_345_678]);
  });

  it("crosses a month end", () => {
    // today-49 from 2026-11-03 is 2026-09-15
    const h = historyFromRows([{ day: "2026-09-14", value: 4n }, { day: "2026-10-31", value: 8n }], "2026-11-03");
    expect(h[0]).toBe(4);
    expect(h[7]).toBe(8);
  });
});

describe("SNAPSHOT_KEYS (spec §2.2)", () => {
  it("is the spec's list, verbatim and in order", () => {
    expect([...SNAPSHOT_KEYS]).toEqual([
      "it.spare", "it.deployed", "it.defective", "it.missing", "it.attention",
      "approvals.open.it", "approvals.open.purchasing", "approvals.open.none",
      "approvals.pastSla.it", "approvals.pastSla.purchasing", "approvals.pastSla.none",
      "pr.submitted", "pr.itReviewed",
      "stock.low", "stock.expiringLots", "stock.stocktakesOverdue",
      "fin.waitingC", "fin.waitingCount", "fin.toConfirm.it", "fin.toConfirm.purchasing", "fin.bookC",
      "admin.activeUsers", "admin.disabled", "admin.deadDeliveries",
    ]);
  });
  it("has no duplicates", () => {
    expect(new Set(SNAPSHOT_KEYS).size).toBe(SNAPSHOT_KEYS.length);
  });
});
