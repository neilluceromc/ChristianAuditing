import { describe, expect, it } from "vitest";
import {
  AGE_BUCKETS, activeDismissals, ageBucket, coverageLine,
  warrantyClusters, warrantyDaysLeft, withDismissal,
} from "./home";

const NOW = new Date("2026-08-17T09:00:00+08:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("ageBucket", () => {
  it("names the five buckets in order", () => {
    expect(AGE_BUCKETS).toEqual(["<1y", "1–2y", "2–3y", "3–4y", "4y+"]);
  });
  it("buckets by completed years since purchase", () => {
    expect(ageBucket(daysAgo(30), NOW)).toBe("<1y");
    expect(ageBucket(daysAgo(400), NOW)).toBe("1–2y");
    expect(ageBucket(daysAgo(800), NOW)).toBe("2–3y");
    expect(ageBucket(daysAgo(1200), NOW)).toBe("3–4y");
    expect(ageBucket(daysAgo(2000), NOW)).toBe("4y+");
  });
  it("treats an unknown purchase date as unbucketable rather than new", () => {
    expect(ageBucket(null, NOW)).toBeNull();
  });
  it("puts the exact boundary in the older bucket", () => {
    expect(ageBucket(daysAgo(365), NOW)).toBe("1–2y");
  });
});

describe("coverageLine — the line that matters under the Fleet bar", () => {
  it("counts spares against the slots incoming hires actually need", () => {
    const line = coverageLine({ laptop: 2, monitor: 1 }, { laptop: 2, monitor: 2, dock: 1 });
    expect(line.needed).toBe(5);
    expect(line.covered).toBe(3); // 2 laptops + 1 monitor; the 2nd monitor and the dock are uncovered
    expect(line.text).toBe("spare pool covers 3 of the 5 slots the incoming hires need");
  });
  it("never counts more spares than slots needed", () => {
    expect(coverageLine({ laptop: 9 }, { laptop: 2 }).covered).toBe(2);
  });
  it("says so plainly when nothing is needed", () => {
    expect(coverageLine({ laptop: 3 }, {}).text).toBe("no incoming hires need equipment right now");
  });
  it("singularises one slot", () => {
    expect(coverageLine({}, { laptop: 1 }).text).toBe("spare pool covers 0 of the 1 slot the incoming hires need");
  });
});

describe("warrantyDaysLeft", () => {
  it("counts forward, and negative once expired", () => {
    expect(warrantyDaysLeft(daysAhead(30), NOW)).toBe(30);
    expect(warrantyDaysLeft(daysAgo(5), NOW)).toBe(-5);
  });
});

describe("dismissals — cleared items leave for the rest of the day", () => {
  it("reads an empty set from nothing", () => {
    expect(activeDismissals(null, "2026-08-17").size).toBe(0);
    expect(activeDismissals({ nonsense: true }, "2026-08-17").size).toBe(0);
  });
  it("keeps today's keys", () => {
    const set = activeDismissals({ date: "2026-08-17", keys: ["SLA:a", "DATA:b"] }, "2026-08-17");
    expect([...set].sort()).toEqual(["DATA:b", "SLA:a"]);
  });
  it("forgets yesterday's — the promise was for the day, not forever", () => {
    expect(activeDismissals({ date: "2026-08-16", keys: ["SLA:a"] }, "2026-08-17").size).toBe(0);
  });
  it("appends without duplicating, and resets on a new day", () => {
    expect(withDismissal({ date: "2026-08-17", keys: ["SLA:a"] }, "2026-08-17", "DATA:b"))
      .toEqual({ date: "2026-08-17", keys: ["SLA:a", "DATA:b"] });
    expect(withDismissal({ date: "2026-08-17", keys: ["SLA:a"] }, "2026-08-17", "SLA:a"))
      .toEqual({ date: "2026-08-17", keys: ["SLA:a"] });
    expect(withDismissal({ date: "2026-08-16", keys: ["SLA:a"] }, "2026-08-17", "DATA:b"))
      .toEqual({ date: "2026-08-17", keys: ["DATA:b"] });
  });
});

describe("warrantyClusters — two identical laptops expiring the same week is the point", () => {
  it("marks rows that share a model and an expiry week", () => {
    const rows = [
      { id: "a", model: "ThinkPad T14", days: 12 },
      { id: "b", model: "ThinkPad T14", days: 14 },
      { id: "c", model: "Dell P2419H", days: 40 },
    ];
    const marked = warrantyClusters(rows);
    expect(marked.find((r) => r.id === "a")!.clustered).toBe(true);
    expect(marked.find((r) => r.id === "b")!.clustered).toBe(true);
    expect(marked.find((r) => r.id === "c")!.clustered).toBe(false);
  });
  it("does not cluster the same model in different weeks", () => {
    const marked = warrantyClusters([
      { id: "a", model: "ThinkPad T14", days: 3 },
      { id: "b", model: "ThinkPad T14", days: 60 },
    ]);
    expect(marked.every((r) => !r.clustered)).toBe(true);
  });
  it("clusters an already-expired pair too (negative days)", () => {
    const marked = warrantyClusters([
      { id: "a", model: "X", days: -2 },
      { id: "b", model: "X", days: -4 },
    ]);
    expect(marked.every((r) => r.clustered)).toBe(true);
  });
});
