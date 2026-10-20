import { describe, expect, it } from "vitest";
import type { WorkGroup, WorkRow, WorkSectionId } from "./worklist";
import { WORK_SECTIONS, leaverRow, loanRow } from "./worklist";
import {
  adminNeeds, bookValueMakeUp, countDelta, dayBuckets, dayLabels, dayWindowStart, deliveryMakeUp, deltaTone,
  directChangesPerDay, financeNeeds, fleetMakeUp, itMove, kitGapRanked, liveSpark, monthBuckets, monthLabels,
  monthWindowStart, needsFromWork, pctDelta, pesosHistory, plural, purchasingNeeds, quarterStartManila, rankByLabel,
  requestStateMakeUp, roleRanked, sumByLabel, sumHistories, sumWeekBuckets, topWithOther, weekBuckets, weekLabels,
  weekOverWeek, weekWindowStart, type KpiTile,
} from "./overview";
import { monthStartManila } from "./cris-limits";

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
    expect(deltaTone(tile({ kind: "week", value: -3, unit: "count" }, "good"))).toBe("bad");
    expect(deltaTone(tile({ kind: "week", value: 25, unit: "pct" }, "bad"))).toBe("bad");
    expect(deltaTone(tile({ kind: "week", value: 0, unit: "pct" }, "bad"))).toBe("flat");
  });
  it("new (up from zero) is up: good when up is good, bad when up is bad, flat when neutral", () => {
    expect(deltaTone(tile({ kind: "new" }, "good"))).toBe("good");
    expect(deltaTone(tile({ kind: "new" }, "bad"))).toBe("bad");
    expect(deltaTone(tile({ kind: "new" }, "neutral"))).toBe("flat");
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
  it("counts: […, 10, 15] gives { week, 5, count }", () =>
    expect(weekOverWeek([3, 10, 15], "count")).toEqual({ kind: "week", value: 5, unit: "count" }));
  it("money: the percent change, rounded", () => {
    expect(weekOverWeek([0, 200, 250], "pct")).toEqual({ kind: "week", value: 25, unit: "pct" });
    expect(weekOverWeek([0, 300, 100], "pct")).toEqual({ kind: "week", value: -67, unit: "pct" });
  });
  it("from a zero week to a non-zero one is new, in either unit", () => {
    expect(weekOverWeek([5, 0, 950.1], "pct")).toEqual({ kind: "new" });
    expect(weekOverWeek([5, 0, 2], "count")).toEqual({ kind: "new" });
  });
  it("two zero weeks are no change", () => {
    expect(weekOverWeek([5, 0, 0], "pct")).toEqual({ kind: "week", value: 0, unit: "pct" });
    expect(weekOverWeek([5, 0, 0], "count")).toEqual({ kind: "week", value: 0, unit: "count" });
  });
  it("a single week has nothing to compare", () => expect(weekOverWeek([4], "count")).toEqual({ kind: "none" }));
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
  it("an overdue loan is bad; a loan due soon or with no date is a warning", () => {
    const items = needsFromWork([group("loans", [
      row("loans", "loans:1", { severity: 503, overdue: true }), row("loans", "loans:2", { severity: 4 }),
      row("loans", "loans:3", { severity: 1000 }),
    ])], [], true);
    expect(items.map((i) => i.tone)).toEqual(["bad", "warn", "warn"]);
  });
  it("the tone comes from the row's overdue flag, not its severity: 600 days overdue is still bad", () => {
    const loan = loanRow({ id: "a", tag: "LT-1", model: "m", loanDueAt: new Date("2025-02-27T04:00:00Z"), holder: "P" }, NOW);
    expect(loan?.severity).toBeGreaterThanOrEqual(1000);
    const leaver = leaverRow({
      id: "e", name: "L", employeeNo: "E-1", itemsOut: 1, employment: "OFFBOARDING", dueAt: new Date("2025-02-27T04:00:00Z"),
      undecided: 0, failed: null, m365Status: null, itAccess: 0,
    }, "2026-10-20");
    const items = needsFromWork([group("loans", [loan!]), group("queue", [leaver])], [], true);
    expect(items.map((i) => [i.title, i.tone])).toEqual([["LT-1 overdue by 600 d", "bad"], ["L is leaving", "bad"]]);
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

describe("itMove — which IT trend series an audit entry counts in", () => {
  const m = (action: string, statusTo: string | null = null, toPerson: boolean | null = null) => itMove({ action, statusTo, toPerson });
  it("assign and return, direct or executed", () => {
    expect([m("lifecycle.assign"), m("lifecycle.assign executed")]).toEqual(["assigned", "assigned"]);
    expect([m("lifecycle.return"), m("lifecycle.return executed")]).toEqual(["returned", "returned"]);
  });
  it("change-status and triage count as To repair only when they land on DEFECTIVE", () => {
    expect(m("lifecycle.change-status", "DEFECTIVE")).toBe("toRepair");
    expect(m("lifecycle.change-status executed", "DEFECTIVE")).toBe("toRepair");
    expect(m("lifecycle.triage", "DEFECTIVE")).toBe("toRepair");
    expect(m("lifecycle.triage executed", "DEFECTIVE")).toBe("toRepair");
    expect(m("lifecycle.change-status", "SPARE")).toBeNull();
    expect(m("lifecycle.triage", null)).toBeNull(); // kept as spare: no status change
  });
  it("a replace is one Returned (the old device's entry) and one Assigned (the new device's entry)", () => {
    expect(m("lifecycle.replace", "SPARE", false)).toBe("returned");
    expect(m("lifecycle.replace", "DEPLOYED", true)).toBe("assigned");
    expect(m("lifecycle.replace executed", null, true)).toBe("assigned");
    expect(m("lifecycle.replace", null, null)).toBeNull();
  });
  it("transfers and anything else stay out", () => {
    expect(m("lifecycle.transfer", "DEPLOYED", true)).toBeNull();
    expect(m("lifecycle.transfer executed", "DEPLOYED", true)).toBeNull();
    expect(m("update", "DEFECTIVE")).toBeNull();
  });
});

// ── Phase 46 Task 3: Purchasing, Finance and Admin helpers ─────────────────

describe("quarterStartManila — the Manila calendar quarter's first instant", () => {
  it("mid-quarter: Oct 20 → Oct 1 00:00 Manila", () => {
    expect(quarterStartManila(NOW).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });
  it("the quarter turns at Manila midnight, not UTC midnight", () => {
    // Sep 30 23:59 Manila is still Q3; Oct 1 00:00 Manila (Sep 30 16:00Z) is Q4
    expect(quarterStartManila(new Date("2026-09-30T15:59:59.999Z")).toISOString()).toBe("2026-06-30T16:00:00.000Z");
    expect(quarterStartManila(new Date("2026-09-30T16:00:00.000Z")).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });
  it("Q1 starts on Jan 1 Manila, which is Dec 31 16:00Z of the year before", () => {
    expect(quarterStartManila(new Date("2026-03-31T15:00:00Z")).toISOString()).toBe("2025-12-31T16:00:00.000Z");
    expect(quarterStartManila(new Date("2025-12-31T16:30:00Z")).toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });
  it("a quarter's first month starts the quarter (agrees with monthStartManila)", () => {
    for (const iso of ["2026-01-15T00:00:00Z", "2026-05-01T00:00:00Z", "2026-07-31T15:00:00Z", "2026-12-01T03:00:00Z"]) {
      const d = new Date(iso);
      expect(quarterStartManila(d).getTime()).toBeLessThanOrEqual(monthStartManila(d).getTime());
    }
    expect(quarterStartManila(new Date("2026-04-01T00:00:00Z")).getTime())
      .toBe(monthStartManila(new Date("2026-04-01T00:00:00Z")).getTime());
  });
});

describe("sumByLabel / topWithOther — top N plus Other", () => {
  it("groups amounts by label, a null label taking the fallback", () => {
    expect(sumByLabel([
      { label: "Acme", amount: 10 }, { label: null, amount: 3 }, { label: "Acme", amount: 2.5 }, { label: "Bolt", amount: 1 },
    ], "No supplier")).toEqual([
      { label: "Acme", value: 12.5 }, { label: "No supplier", value: 3 }, { label: "Bolt", value: 1 },
    ]);
  });
  it("keeps the top N by value (ties by label) and folds the rest into one Other row", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((label, i) => ({ label, value: 100 - i }));
    rows.push({ label: "aa", value: 100 });
    const r = topWithOther(rows, 7);
    expect(r.map((x) => [x.label, x.value])).toEqual([
      ["a", 100], ["aa", 100], ["b", 99], ["c", 98], ["d", 97], ["e", 96], ["f", 95], ["Other", 94 + 93 + 92],
    ]);
  });
  it("no Other row when everything fits, and zero rows are dropped", () => {
    expect(topWithOther([{ label: "x", value: 2 }, { label: "z", value: 0 }, { label: "y", value: 5 }], 7))
      .toEqual([{ label: "y", value: 5 }, { label: "x", value: 2 }]);
  });
  it("the rows always sum to the input total", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ label: `s${i}`, value: i + 1 }));
    const total = rows.reduce((s, r) => s + r.value, 0);
    expect(topWithOther(rows, 3).reduce((s, r) => s + r.value, 0)).toBe(total);
  });
  it("a custom Other label", () => {
    expect(topWithOther([{ label: "a", value: 1 }, { label: "b", value: 1 }], 1, "Everyone else").at(-1))
      .toEqual({ label: "Everyone else", value: 1 });
  });
});

describe("pctDelta — a money tile's change since 7 days ago, in percent", () => {
  it("null gives none (collecting history)", () => expect(pctDelta(100, null)).toEqual({ kind: "none" }));
  it("rounds to a whole percent", () => {
    expect(pctDelta(112, 100)).toEqual({ kind: "pct", value: 12 });
    expect(pctDelta(50, 150)).toEqual({ kind: "pct", value: -67 });
    expect(pctDelta(100, 100)).toEqual({ kind: "pct", value: 0 });
  });
  it("up from zero is new (never none, never a made-up percent); zero to zero is no change", () => {
    expect(pctDelta(5, 0)).toEqual({ kind: "new" });
    expect(pctDelta(0, 0)).toEqual({ kind: "pct", value: 0 });
  });
});

describe("pesosHistory", () => {
  it("centavos to pesos, nulls kept", () => expect(pesosHistory([12_345, null, 0])).toEqual([123.45, null, 0]));
});

describe("dayBuckets / dayWindowStart / dayLabels — Manila days ending today", () => {
  it("counts each date on its Manila day, oldest first; future and older dates are out", () => {
    const dates = [
      new Date("2026-10-20T15:59:00Z"), // Oct 20 23:59 Manila → today
      new Date("2026-10-19T16:00:00Z"), // Oct 20 00:00 Manila → today
      new Date("2026-10-19T15:59:00Z"), // Oct 19 Manila → yesterday
      new Date("2026-10-17T15:59:00Z"), // Oct 17 Manila → today−3, outside 3 days
      new Date("2026-10-20T16:00:00Z"), // Oct 21 Manila → future
    ];
    expect(dayBuckets(dates, NOW, 3)).toEqual([0, 1, 2]);
  });
  it("starts at Manila midnight of the first day", () => {
    expect(dayWindowStart(NOW, 14).toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(dayWindowStart(NOW, 7).getTime()).toBe(weekWindowStart(NOW, 1).getTime());
  });
  it("labels each day", () => expect(dayLabels(NOW, 3)).toEqual(["18 Oct", "19 Oct", "20 Oct"]));
});

describe("monthBuckets / monthWindowStart / monthLabels — Manila months ending this month", () => {
  it("sums each row into its Manila month, oldest first", () => {
    const rows = [
      { at: new Date("2026-10-01T02:00:00Z"), amount: 5 },
      { at: new Date("2026-09-30T16:30:00Z"), amount: 7 }, // Oct 1 00:30 Manila → October
      { at: new Date("2026-09-30T15:30:00Z"), amount: 11 }, // Sep 30 23:30 Manila → September
      { at: new Date("2026-08-15T02:00:00Z"), amount: 13 },
      { at: new Date("2026-07-15T02:00:00Z"), amount: 99 }, // outside three months
      { at: new Date("2026-11-02T02:00:00Z"), amount: 99 }, // future
    ];
    expect(monthBuckets(rows, NOW, 3)).toEqual([13, 11, 12]);
  });
  it("starts on the 1st of the oldest month, Manila midnight; crosses the year", () => {
    expect(monthWindowStart(NOW, 1).toISOString()).toBe(monthStartManila(NOW).toISOString());
    expect(monthWindowStart(NOW, 12).toISOString()).toBe("2025-10-31T16:00:00.000Z");
  });
  it("labels each month", () => {
    expect(monthLabels(NOW, 3)).toEqual(["Aug 2026", "Sep 2026", "Oct 2026"]);
    expect(monthLabels(new Date("2026-01-10T00:00:00Z"), 2)).toEqual(["Dec 2025", "Jan 2026"]);
  });
});

describe("requestStateMakeUp", () => {
  it("one row per request state in tab order, each linking to its tab; empty states are left out", () => {
    const m = requestStateMakeUp({ ALL: 9, DRAFT: 1, SUBMITTED: 3, IT_REVIEWED: 0, COMPLETED: 4, CANCELLED: 1 });
    expect(m.rows).toEqual([
      { label: "Drafts", value: 1, tone: "neutral", href: "/purchases?state=DRAFT" },
      { label: "Awaiting IT", value: 3, tone: "chart-1", href: "/purchases?state=SUBMITTED" },
      { label: "Completed", value: 4, tone: "chart-3", href: "/purchases?state=COMPLETED" },
      { label: "Cancelled", value: 1, tone: "bad", href: "/purchases?state=CANCELLED" },
    ]);
  });
});

describe("bookValueMakeUp", () => {
  it("the top three categories in the chart colours, then Other; money, in pesos", () => {
    const m = bookValueMakeUp([
      { label: "Laptops", bookC: 50_000 }, { label: "Monitors", bookC: 20_000 }, { label: "Phones", bookC: 5_000 },
      { label: "Docks", bookC: 3_000 }, { label: "Chairs", bookC: 2_000 },
    ]);
    expect(m.money).toBe(true);
    expect(m.rows).toEqual([
      { label: "Laptops", value: 500, tone: "chart-1" },
      { label: "Monitors", value: 200, tone: "chart-2" },
      { label: "Phones", value: 50, tone: "chart-3" },
      { label: "Other", value: 50, tone: "neutral" },
    ]);
  });
  it("folds on whole centavos, so Other carries no float noise", () => {
    const m = bookValueMakeUp([
      { label: "A", bookC: 30_003 }, { label: "B", bookC: 20_002 }, { label: "C", bookC: 10_001 },
      { label: "D", bookC: 10 }, { label: "E", bookC: 20 },
    ]);
    expect(m.rows.at(-1)).toEqual({ label: "Other", value: 0.3, tone: "neutral" });
    expect(m.rows.map((r) => r.value)).toEqual([300.03, 200.02, 100.01, 0.3]);
  });
});

describe("rankByLabel — one read, ranked from a later bound in memory", () => {
  it("keeps rows at or after `since`, groups by label (null → fallback), top N plus Other", () => {
    const since = new Date("2026-09-30T16:00:00Z");
    const rows = [
      { at: new Date("2026-10-19T02:00:00Z"), amount: 10, label: "Acme" },
      { at: new Date("2026-10-01T02:00:00Z"), amount: 5, label: "Acme" },
      { at: new Date("2026-09-30T15:59:00Z"), amount: 999, label: "Acme" }, // before the bound
      { at: new Date("2026-10-05T02:00:00Z"), amount: 7, label: null },
      { at: new Date("2026-10-06T02:00:00Z"), amount: 1, label: "Bolt" },
      { at: new Date("2026-10-07T02:00:00Z"), amount: 2, label: "Cog" },
    ];
    expect(rankByLabel(rows, since, "No supplier", 2)).toEqual([
      { label: "Acme", value: 15 }, { label: "No supplier", value: 7 }, { label: "Other", value: 3 },
    ]);
  });
});

describe("directChangesPerDay", () => {
  it("per Manila day, IT and Purchasing, the days ending today", () => {
    const r = directChangesPerDay([
      { at: new Date("2026-10-19T17:00:00Z"), cls: "IT" }, // Oct 20 01:00 Manila → today
      { at: new Date("2026-10-19T15:00:00Z"), cls: "PURCHASING" }, // Oct 19 Manila
      { at: new Date("2026-09-01T02:00:00Z"), cls: "IT" }, // outside the window
    ], NOW, 3);
    expect(r).toEqual({ labels: ["18 Oct", "19 Oct", "20 Oct"], it: [0, 0, 1], purchasing: [0, 1, 0] });
  });
});

describe("plural", () => {
  it("one and many", () => {
    expect(plural(1, "asset", "assets")).toBe("1 asset");
    expect(plural(0, "asset", "assets")).toBe("0 assets");
  });
});

describe("deliveryMakeUp", () => {
  it("delivered, pending, retrying, dead; status tones carry their word; empty statuses left out", () => {
    const m = deliveryMakeUp({ DELIVERED: 40, PENDING: 2, RETRYING: 0, DEAD: 3 });
    expect(m.rows).toEqual([
      { label: "Delivered", value: 40, tone: "chart-1" },
      { label: "Pending", value: 2, tone: "chart-2" },
      { label: "Dead", value: 3, tone: "bad" },
    ]);
  });
});

describe("roleRanked", () => {
  it("every role by its label, largest first, zeros kept (no admins is worth seeing)", () => {
    const r = roleRanked([
      { role: "admin", count: 0 }, { role: "it_staff", count: 5 }, { role: "viewer", count: 2 },
      { role: "purchasing_staff", count: 5 }, { role: "finance_staff", count: 1 },
    ]);
    expect(r.rows).toEqual([
      { label: "IT staff", value: 5 }, { label: "Purchasing staff", value: 5 }, { label: "Viewer", value: 2 },
      { label: "Finance staff", value: 1 }, { label: "Admin", value: 0 },
    ]);
  });
});

describe("purchasingNeeds", () => {
  const todo = (refNo: string, bounced: boolean) => ({
    refNo, what: bounced ? "came back from Ina" : "still a draft", meta: "₱1,000 · 2 d", href: `/purchases/${refNo}`,
    action: bounced ? "Fix and resubmit" : "Submit", bounced,
  });
  const overdue = [{ id: "s1", refNo: "STK-0003", scope: "Pantry", dueAt: new Date("2026-10-17T00:00:00Z") }];

  it("overdue stocktakes (bad), then low stock and bounced requests (warn), then the rest; at most 6", () => {
    const items = purchasingNeeds([todo("PR-1", false), todo("PR-2", true)], overdue, 4, "/stock?low=1", "2026-10-20");
    expect(items.map((i) => [i.tone, i.title])).toEqual([
      ["bad", "STK-0003 · Pantry"],
      ["warn", "4 items below reorder level"],
      ["warn", "PR-2 · came back from Ina"],
      ["info", "PR-1 · still a draft"],
    ]);
    expect(items[0]).toMatchObject({ meta: "close-by 17 Oct · 3 d overdue", action: "Open", href: "/stock/stocktakes/s1", icon: "stock" });
    expect(items[1]).toMatchObject({ href: "/stock?low=1", action: "Review" });
    expect(items[2]).toMatchObject({ href: "/purchases/PR-2", action: "Fix and resubmit", meta: "₱1,000 · 2 d", icon: "requests" });
    const many = Array.from({ length: 9 }, (_, i) => todo(`PR-${i}`, false));
    expect(purchasingNeeds(many, overdue, 1, "/stock?low=1", "2026-10-20")).toHaveLength(6);
  });
  it("one item below reorder reads singular; none adds nothing", () => {
    expect(purchasingNeeds([], [], 1, "/stock?low=1", "2026-10-20")[0].title).toBe("1 item below reorder level");
    expect(purchasingNeeds([], [], 0, "/stock?low=1", "2026-10-20")).toEqual([]);
  });
});

describe("financeNeeds", () => {
  const q = (refNo: string) => ({ refNo, what: "from Ina", meta: "₱5,000 · waiting 2 d", href: `/purchases/${refNo}`, action: "Review" });
  it("registrations to confirm per class (each its own class's link), then the queue; at most 6", () => {
    const items = financeNeeds([q("PR-1"), q("PR-2")], { it: 3, purchasing: 1 });
    expect(items.map((i) => [i.title, i.href])).toEqual([
      ["3 IT registrations to confirm", "/finance/assets?fin=with-finance"],
      ["1 Purchasing registration to confirm", "/finance/assets?cls=PURCHASING&fin=with-finance"],
      ["PR-1 · from Ina", "/purchases/PR-1"],
      ["PR-2 · from Ina", "/purchases/PR-2"],
    ]);
    expect(items.every((i) => i.tone === "warn")).toBe(true);
    expect(financeNeeds(Array.from({ length: 8 }, (_, i) => q(`PR-${i}`)), { it: 1, purchasing: 1 })).toHaveLength(6);
  });
  it("a class with nothing to confirm adds no item", () => {
    expect(financeNeeds([], { it: 0, purchasing: 2 }).map((i) => i.title)).toEqual(["2 Purchasing registrations to confirm"]);
  });
});

describe("adminNeeds", () => {
  it("dead deliveries and failing endpoints (bad), disabled admins (warn), unavailable flags (info)", () => {
    const items = adminNeeds({
      dead: 4,
      failing: [
        { id: "e1", url: "https://hooks.example/a", dead: 3, active: true },
        { id: "e2", url: "https://hooks.example/b", dead: 1, active: false },
      ],
      disabledAdmins: [{ id: "u1", name: "Ana Cruz", email: "ana@example.com" }],
      unavailableFlags: [{ key: "sso", label: "Microsoft sign-in" }],
    });
    expect(items.map((i) => [i.tone, i.title, i.href])).toEqual([
      ["bad", "4 dead webhook deliveries", "/admin/webhooks/deliveries?state=DEAD"],
      ["bad", "https://hooks.example/a", "/admin/webhooks"],
      ["bad", "https://hooks.example/b", "/admin/webhooks"],
      ["warn", "Ana Cruz is a disabled admin", "/admin/users?disabled=1"],
      ["info", "Microsoft sign-in is unavailable", "/admin/flags"],
    ]);
    expect(items[1].meta).toBe("3 dead deliveries");
    expect(items[2].meta).toBe("1 dead delivery · endpoint switched off");
  });
  it("nothing wrong, nothing listed; one dead delivery reads singular", () => {
    expect(adminNeeds({ dead: 0, failing: [], disabledAdmins: [], unavailableFlags: [] })).toEqual([]);
    expect(adminNeeds({ dead: 1, failing: [], disabledAdmins: [], unavailableFlags: [] })[0].title).toBe("1 dead webhook delivery");
  });
});
