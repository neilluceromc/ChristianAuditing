import { describe, expect, it } from "vitest";
import {
  AGE_BUCKETS, activeDismissals, ageBucket, ageBucketBounds, coverageLine, type AgeBucket,
  warrantyClusters, warrantyDaysLeft, withDismissal, withoutDismissal,
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

describe("ageBucketBounds (Phase 43: ageHistogram counts in SQL)", () => {
  const YEAR = 365 * 86_400_000;
  /** The SQL's predicates, word for word: p > b0 · b1 < p ≤ b0 · b2 < p ≤ b1 · b3 < p ≤ b2 · p ≤ b3. */
  const bySql = (p: Date, [b0, b1, b2, b3]: Date[]): AgeBucket => {
    const t = p.getTime();
    if (t > b0.getTime()) return "<1y";
    if (t > b1.getTime()) return "1–2y";
    if (t > b2.getTime()) return "2–3y";
    if (t > b3.getTime()) return "3–4y";
    return "4y+";
  };

  it("are now minus one to four 365-day years, to the millisecond", () => {
    expect(ageBucketBounds(NOW).map((d) => NOW.getTime() - d.getTime())).toEqual([YEAR, 2 * YEAR, 3 * YEAR, 4 * YEAR]);
  });

  it("split exactly where ageBucket does, at and around every boundary", () => {
    for (const now of [NOW, new Date("2026-01-01T00:00:00.000Z"), new Date("2028-02-29T23:59:59.999Z"), new Date(0)]) {
      const bounds = ageBucketBounds(now);
      for (let k = -1; k <= 6; k++) {
        for (const d of [-86_400_000, -1, 0, 1, 86_400_000]) {
          const p = new Date(now.getTime() - k * YEAR + d);
          expect([k, d, bySql(p, bounds)]).toEqual([k, d, ageBucket(p, now)]);
        }
      }
    }
  });

  it("agree with ageBucket on thousands of dates, the future included", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const bounds = ageBucketBounds(NOW);
    for (let i = 0; i < 5000; i++) {
      const p = new Date(NOW.getTime() + Math.round((rand() * 10 - 8) * YEAR));
      expect(bySql(p, bounds)).toBe(ageBucket(p, NOW));
    }
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

describe("withoutDismissal — Undo", () => {
  it("removes one key from today's set and leaves the others", () => {
    const pref = withDismissal(withDismissal(null, "2026-09-24", "triage:1"), "2026-09-24", "loans:2");
    expect(withoutDismissal(pref, "2026-09-24", "triage:1")).toEqual({ date: "2026-09-24", keys: ["loans:2"] });
  });
  it("a stale or empty value yields an empty set for today", () => {
    expect(withoutDismissal({ date: "2026-09-23", keys: ["triage:1"] }, "2026-09-24", "triage:1")).toEqual({ date: "2026-09-24", keys: [] });
    expect(withoutDismissal(null, "2026-09-24", "x:1")).toEqual({ date: "2026-09-24", keys: [] });
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
