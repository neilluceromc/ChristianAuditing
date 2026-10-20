import { describe, expect, it } from "vitest";
import type { WorkGroup, WorkRow, WorkSectionId } from "./worklist";
import { WORK_SECTIONS } from "./worklist";
import {
  countDelta, deltaTone, fleetMakeUp, kitGapRanked, liveSpark, needsFromWork, sumHistories, sumWeekBuckets,
  weekBuckets, weekLabels, weekOverWeek, weekWindowStart, type KpiTile,
} from "./overview";

// 03:00Z is 11:00 on Tue 2026-10-20 in Manila
const NOW = new Date("2026-10-20T03:00:00Z");

const tile = (delta: KpiTile["delta"], upIs: KpiTile["upIs"]): KpiTile => ({
  key: "k", label: "K", value: 1, hint: "", spark: [], delta, upIs,
});

describe("deltaTone", () => {
  it("up-good with +1 is good", () => expect(deltaTone(tile({ kind: "count", value: 1 }, "good"))).toBe("good"));
  it("up-good with −1 is bad", () => expect(deltaTone(tile({ kind: "count", value: -1 }, "good"))).toBe("bad"));
  it("up-bad with +1 is bad", () => expect(deltaTone(tile({ kind: "count", value: 1 }, "bad"))).toBe("bad"));
  it("up-bad with −1 is good", () => expect(deltaTone(tile({ kind: "count", value: -1 }, "bad"))).toBe("good"));
  it("neutral is flat", () => expect(deltaTone(tile({ kind: "count", value: 5 }, "neutral"))).toBe("flat"));
  it("zero is flat", () => expect(deltaTone(tile({ kind: "count", value: 0 }, "good"))).toBe("flat"));
  it("no comparison is flat", () => expect(deltaTone(tile({ kind: "none" }, "bad"))).toBe("flat"));
  it("money percent and week deltas follow the same sign rule", () => {
    expect(deltaTone(tile({ kind: "pct", value: 12 }, "good"))).toBe("good");
    expect(deltaTone(tile({ kind: "week", value: -3 }, "good"))).toBe("bad");
  });
});

describe("countDelta", () => {
  it("null gives none (collecting history)", () => expect(countDelta(5, null)).toEqual({ kind: "none" }));
  it("is live minus the value 7 days ago", () => {
    expect(countDelta(12, 4)).toEqual({ kind: "count", value: 8 });
    expect(countDelta(3, 7)).toEqual({ kind: "count", value: -4 });
    expect(countDelta(3, 3)).toEqual({ kind: "count", value: 0 });
  });
});

describe("weekBuckets — Manila weeks ending today, oldest first", () => {
  it("an empty input gives zeros", () => expect(weekBuckets([], NOW, 12)).toEqual(Array(12).fill(0)));
  it("splits on the Manila day, not the UTC day", () => {
    const dates = [
      new Date("2026-10-20T15:59:00Z"), // Oct 20 23:59 Manila → this week
      new Date("2026-10-13T16:00:00Z"), // Oct 14 00:00 Manila → this week (today−6)
      new Date("2026-10-13T15:59:00Z"), // Oct 13 23:59 Manila → last week (today−7)
      new Date("2026-10-06T16:00:00Z"), // Oct 7 00:00 Manila → last week (today−13)
      new Date("2026-10-06T15:59:00Z"), // Oct 6 Manila → today−14, outside two weeks
      new Date("2026-10-20T16:00:00Z"), // Oct 21 Manila → the future, never counted
    ];
    expect(weekBuckets(dates, NOW, 2)).toEqual([2, 2]);
  });
  it("puts each date in its own week", () => {
    expect(weekBuckets([new Date("2026-10-01T04:00:00Z")], NOW, 4)).toEqual([0, 1, 0, 0]); // Oct 1 = today−19
  });
});

describe("sumWeekBuckets", () => {
  it("sums each row's amount into its Manila week", () => {
    const rows = [
      { at: new Date("2026-10-19T02:00:00Z"), amount: 100 },
      { at: new Date("2026-10-15T02:00:00Z"), amount: 50.5 },
      { at: new Date("2026-10-10T02:00:00Z"), amount: 7 },
      { at: new Date("2026-01-01T02:00:00Z"), amount: 999 },
    ];
    expect(sumWeekBuckets(rows, NOW, 3)).toEqual([0, 7, 150.5]);
  });
  it("an empty input gives zeros", () => expect(sumWeekBuckets([], NOW, 2)).toEqual([0, 0]));
});

describe("weekOverWeek", () => {
  it("[…, 10, 15] gives { week, 5 }", () => expect(weekOverWeek([3, 10, 15])).toEqual({ kind: "week", value: 5 }));
  it("a single week has nothing to compare", () => expect(weekOverWeek([4])).toEqual({ kind: "none" }));
});

describe("weekWindowStart / weekLabels", () => {
  it("starts at Manila midnight of the first bucket's first day", () => {
    // two weeks ending Oct 20 start on Oct 7, 00:00 Manila = Oct 6 16:00Z
    expect(weekWindowStart(NOW, 2).toISOString()).toBe("2026-10-06T16:00:00.000Z");
  });
  it("labels each week by its last day", () => expect(weekLabels(NOW, 3)).toEqual(["6 Oct", "13 Oct", "20 Oct"]));
});

describe("liveSpark / sumHistories", () => {
  it("ends the line at the live value", () => {
    expect(liveSpark([1, 2, null, 4, 5, 6, 7, 8], 9)).toEqual([1, 2, null, 4, 5, 6, 7, 9]);
    expect(liveSpark(Array(8).fill(null), 3)).toEqual([...Array(7).fill(null), 3]);
  });
  it("sums per point; a point missing in any class is null, never a partial sum", () => {
    expect(sumHistories([[1, 2, null], [10, 20, 30], [0, null, 1]])).toEqual([11, null, null]);
    expect(sumHistories([[1, 2], [3, 4]])).toEqual([4, 6]);
  });
});

const row = (section: WorkSectionId, key: string, extra: Partial<WorkRow> = {}): WorkRow => ({
  key, section, title: key, meta: "m", href: `/x/${key}`, action: "Go", severity: 0, ...extra,
});
const group = (section: WorkSectionId, rows: WorkRow[]): WorkGroup => ({
  section: WORK_SECTIONS.find((s) => s.id === section)!, rows, total: rows.length, capped: false, hidden: [], pastSla: 0, oldestDays: 0,
});

describe("needsFromWork — worklist plus claims, by urgency", () => {
  const groups = [
    group("triage", [row("triage", "triage:1")]),
    group("repairs", [row("repairs", "repairs:1")]),
    group("missing", [row("missing", "missing:1")]),
    group("queue", [
      row("queue", "queue:a", { rank: 0 }),
      row("queue", "queue:lv", { rank: 2, entity: { kind: "employee", id: "lv", label: "L" }, href: "/employees/lv/edit" }),
    ]),
  ];
  const claims = [
    { id: "c1", refNo: "APR-1", line1: "Assign", sla: { text: "2 d overdue", overdue: true } },
    { id: "c2", refNo: "APR-2", line1: "Return", sla: { text: "due in 3 h", overdue: false } },
  ];

  it("bad first (overdue claims, then sections in order), then warn, then info; at most 6", () => {
    const items = needsFromWork(groups, claims, true);
    expect(items.map((i) => [i.tone, i.title])).toEqual([
      ["bad", "APR-1 · Assign"],
      ["bad", "missing:1"],
      ["bad", "queue:a"],
      ["warn", "APR-2 · Return"],
      ["warn", "repairs:1"],
      ["warn", "queue:lv"],
    ]);
  });
  it("respects the max", () => expect(needsFromWork(groups, claims, true, 2)).toHaveLength(2));
  it("a claim opens its approval; rows keep their own verb and href", () => {
    const items = needsFromWork(groups, claims, true, 10);
    expect(items[0]).toMatchObject({ icon: "sla", action: "Open", href: "/approvals/c1", meta: "claimed by you · 2 d overdue" });
    expect(items.find((i) => i.title === "triage:1")).toMatchObject({ tone: "info", action: "Go", href: "/x/triage:1" });
  });
  it("a viewer reads Open everywhere and a leaver opens the wizard page", () => {
    const items = needsFromWork(groups, [], false, 10);
    expect(items.every((i) => i.action === "Open")).toBe(true);
    expect(items.find((i) => i.title === "queue:lv")?.href).toBe("/offboarding/lv");
  });
  it("an overdue loan is bad; a loan due soon is a warning", () => {
    const items = needsFromWork([group("loans", [row("loans", "loans:1", { severity: 503 }), row("loans", "loans:2", { severity: 4 })])], [], true);
    expect(items.map((i) => i.tone)).toEqual(["bad", "warn"]);
  });
});

describe("kitGapRanked — people missing kit, top clients plus internal teams", () => {
  const g = (id: string, kind: "CLIENT" | "INTERNAL", count: number) => ({ id, name: `N-${id}`, kind, count });
  it("top 7 clients by count (ties by name), then one Internal teams row summing every internal group", () => {
    const groups = [
      ...["a", "b", "c", "d", "e", "f", "g", "h"].map((id, i) => g(id, "CLIENT", 10 - i)),
      g("z", "CLIENT", 10), g("i1", "INTERNAL", 2), g("i2", "INTERNAL", 3), g("c0", "CLIENT", 0),
    ];
    const r = kitGapRanked(groups);
    expect(r.rows.map((x) => [x.label, x.value])).toEqual([
      ["N-a", 10], ["N-z", 10], ["N-b", 9], ["N-c", 8], ["N-d", 7], ["N-e", 6], ["N-f", 5], ["Internal teams", 5],
    ]);
    expect(r.rows[0].href).toBe("/employees?department=a&gaps=1");
    expect(r.rows.at(-1)?.href).toBe("/employees?kind=INTERNAL&gaps=1");
  });
  it("no Internal teams row when no internal person is missing kit", () => {
    expect(kitGapRanked([g("a", "CLIENT", 1)]).rows.map((x) => x.label)).toEqual(["N-a"]);
  });
});

describe("fleetMakeUp", () => {
  it("one row per slice with the slice's filter link; status tones carry a word (the label)", () => {
    const m = fleetMakeUp({
      slices: [
        { status: "DEPLOYED", count: 3, href: "/inventory?status=DEPLOYED" },
        { status: "MISSING", count: 1, href: "/inventory?status=MISSING" },
        { status: "DEFECTIVE", count: 1, href: "/inventory?status=DEFECTIVE" },
        { status: "DISPOSE", count: 1, href: "/inventory?status=DISPOSE" },
      ],
    });
    expect(m.rows).toEqual([
      { label: "Deployed", value: 3, tone: "chart-1", href: "/inventory?status=DEPLOYED" },
      { label: "Missing", value: 1, tone: "bad", href: "/inventory?status=MISSING" },
      { label: "Defective", value: 1, tone: "warn", href: "/inventory?status=DEFECTIVE" },
      { label: "Dispose", value: 1, tone: "neutral", href: "/inventory?status=DISPOSE" },
    ]);
  });
});
