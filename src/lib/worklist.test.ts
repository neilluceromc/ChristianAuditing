import { describe, expect, it } from "vitest";
import { dayFromISO } from "./deadlines";
import { fmtDate } from "./format";
import {
  DEFAULT_LOAN_DAYS, LOAN_DUE_SOON_DAYS, SEE_ALL_HREF, WORK_SECTIONS, capLine, groupWork, leaverRow, loanRow,
  loanSoonEdge, pastSlaCount, summaryChips, workActionLabel, workHeadline, type LeaverLike, type WorkGroup, type WorkRow,
} from "./worklist";

const row = (section: WorkRow["section"], key: string, severity = 0, rank?: number): WorkRow =>
  ({ key, section, title: key, meta: "", href: "/x", action: "Do", severity, rank });

describe("WORK_SECTIONS", () => {
  it("is the spec's order", () => {
    expect(WORK_SECTIONS.map((s) => s.id)).toEqual(["triage", "repairs", "check", "hires", "loans", "missing", "queue"]);
  });
  it("the default loan is 30 days", () => expect(DEFAULT_LOAN_DAYS).toBe(30));
});

describe("groupWork", () => {
  const rows = [row("queue", "q1"), row("triage", "t1", 2), row("triage", "t2", 9), row("triage", "t3", 5), row("repairs", "r1")];
  it("groups in section order, sorts by severity desc, caps for Home, reports totals", () => {
    const g = groupWork(rows, new Set(), { limit: 2 });
    expect(g.map((x) => x.section.id)).toEqual(["triage", "repairs", "queue"]);
    expect(g[0].rows.map((r) => r.key)).toEqual(["t2", "t3"]);
    expect(g[0].total).toBe(3);
  });
  it("uncapped for the page", () => {
    expect(groupWork(rows, new Set(), {})[0].rows).toHaveLength(3);
  });
  it("keeps a dismissed-only section, with its row moved to hidden", () => {
    const g = groupWork(rows, new Set(["r1"]), {});
    expect(g.map((x) => x.section.id)).toEqual(["triage", "repairs", "queue"]);
    const repairs = g.find((x) => x.section.id === "repairs")!;
    expect(repairs.rows).toEqual([]);
    expect(repairs.hidden.map((r) => r.key)).toEqual(["r1"]);
    expect(repairs.total).toBe(0);
  });
  it("within queue, sorts by rank (SLA, then EXEC, then LEAVE) before severity", () => {
    // ranks 2/0/1 and severities 9/1/5 — rank must win even though severity
    // order would put q-leave first.
    const queueRows = [
      row("queue", "q-leave", 9, 2),
      row("queue", "q-sla", 1, 0),
      row("queue", "q-exec", 5, 1),
    ];
    const g = groupWork(queueRows, new Set(), {});
    expect(g[0].rows.map((r) => r.key)).toEqual(["q-sla", "q-exec", "q-leave"]);
  });
  it("marks a group capped when its section is in the saturated set", () => {
    const g = groupWork(rows, new Set(), {}, new Set(["triage"]));
    expect(g.find((x) => x.section.id === "triage")?.capped).toBe(true);
    expect(g.find((x) => x.section.id === "repairs")?.capped).toBe(false);
  });
});

describe("loanRow — Manila-day words, a Set loan date… control on every loan row", () => {
  const NOW = new Date("2026-09-24T10:00:00+08:00");
  const base = { id: "a1", tag: "BR-LT-0210", model: "ThinkPad", holder: "Leo Tan" };
  it("no due date sits on top and asks for one", () => {
    const r = loanRow({ ...base, loanDueAt: null }, NOW)!;
    expect(r.title).toBe("BR-LT-0210 on loan with no due date");
    expect(r.meta).toBe("Leo Tan · set a due date");
    expect(r.control).toEqual({ kind: "loan-due", asset: { id: "a1", tag: "BR-LT-0210" }, loanDueAt: null });
    expect(r.severity).toBe(1000);
  });
  it("overdue by N days on the Manila calendar, date in the house form", () => {
    const r = loanRow({ ...base, loanDueAt: new Date("2026-09-23T00:00:00+08:00") }, NOW)!;
    expect(r.title).toBe("BR-LT-0210 overdue by 1 d");
    expect(r.meta).toBe(`Leo Tan · due ${fmtDate(new Date("2026-09-23T00:00:00+08:00"))}`);
    expect(r.severity).toBe(501);
  });
  it("due today, tomorrow and within the week", () => {
    expect(loanRow({ ...base, loanDueAt: new Date("2026-09-24T18:00:00+08:00") }, NOW)!.title).toBe("BR-LT-0210 due today");
    expect(loanRow({ ...base, loanDueAt: new Date("2026-09-25T00:00:00+08:00") }, NOW)!.title).toBe("BR-LT-0210 due tomorrow");
    expect(loanRow({ ...base, loanDueAt: new Date("2026-09-28T00:00:00+08:00") }, NOW)!.title).toBe("BR-LT-0210 due in 4 d");
  });
  it("due later is not on the list", () => {
    expect(loanRow({ ...base, loanDueAt: new Date("2026-10-10T00:00:00+08:00") }, NOW)).toBeNull();
  });
  it("section blurb names the three cases", () => {
    expect(WORK_SECTIONS.find((s) => s.id === "loans")?.blurb).toBe("Loans overdue, due this week, or with no due date.");
  });
});

describe("loanSoonEdge — the badge's loan count agrees with loanRow", () => {
  const base = { id: "a1", tag: "BR-LT-0210", model: "ThinkPad", holder: null };
  it("a loan due 7 Manila days out is counted, one due 8 days out is not", () => {
    const NOW = new Date("2026-09-24T10:00:00+08:00");
    const edge = loanSoonEdge(NOW);
    expect(edge.toISOString()).toBe("2026-10-01T16:00:00.000Z"); // 2026-10-02 00:00 Manila
    const day7 = new Date("2026-10-01T23:59:00+08:00");
    const day8 = new Date("2026-10-02T00:00:00+08:00");
    expect(loanRow({ ...base, loanDueAt: day7 }, NOW)).not.toBeNull();
    expect(day7 < edge).toBe(true);
    expect(loanRow({ ...base, loanDueAt: day8 }, NOW)).toBeNull();
    expect(day8 < edge).toBe(false);
  });
  it("matches loanRow at every hour around the edge, from either end of the Manila day, UTC-midnight dates included", () => {
    for (const nowText of ["2026-09-24T00:30:00+08:00", "2026-09-24T23:30:00+08:00"]) {
      const now = new Date(nowText);
      const edge = loanSoonEdge(now);
      for (let h = -48; h <= 48; h++) {
        const due = new Date(edge.getTime() + h * 3_600_000);
        expect(due < edge).toBe(loanRow({ ...base, loanDueAt: due }, now) !== null);
      }
      for (const iso of ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]) {
        const due = dayFromISO(iso);
        expect(due < edge).toBe(loanRow({ ...base, loanDueAt: due }, now) !== null);
      }
    }
  });
});

describe("workHeadline", () => {
  const row = (over: Partial<WorkRow>): WorkRow => ({ key: "k", section: "triage", title: "", meta: "", href: "/", action: "Open", severity: 0, ...over });
  it("counts, the oldest age and past-SLA rows, dropping zero parts", () => {
    const groups = groupWork([
      row({ key: "triage:1", ageDays: 4 }),
      row({ key: "queue:2", section: "queue", rank: 0, ageDays: 9 }),
    ], new Set(), {});
    expect(workHeadline(groups)).toBe("2 waiting · oldest 9 d · 1 past SLA");
    expect(workHeadline(groupWork([row({ key: "triage:1" })], new Set(), {}))).toBe("1 waiting");
    expect(workHeadline([])).toBe("");
  });
});

describe("leaverRow — label and href from offboardingNext", () => {
  const TODAY = "2026-09-24";
  const e = (over: Partial<LeaverLike> = {}): LeaverLike => ({
    id: "e1", name: "Dennis Ong", employeeNo: "EMP-0090", itemsOut: 3,
    employment: "OFFBOARDING", dueAt: new Date("2026-09-22T00:00:00+08:00"),
    undecided: 3, failed: null, m365Status: "offboarding", ...over,
  });
  it("undecided items: Collect N items into the Collect step", () => {
    const r = leaverRow(e(), TODAY);
    expect(r.title).toBe("Dennis Ong is leaving");
    expect(r.meta).toBe("EMP-0090 · 3 items still out · 2 d overdue");
    expect(r.action).toBe("Collect 3 items");
    expect(r.href).toBe("/offboarding/e1?step=collect");
    expect(r.key).toBe("queue:e1");
  });
  it("no date asks for one", () => {
    const r = leaverRow(e({ dueAt: null }), TODAY);
    expect(r.title).toBe("Dennis Ong is leaving — no completion date");
    expect(r.action).toBe("Set a date");
    expect(r.href).toBe("/employees/e1/edit");
    expect(r.severity).toBe(1000);
  });
  it("equipment returned reads as closing the account", () => {
    const r = leaverRow(e({ itemsOut: 0, undecided: 0 }), TODAY);
    expect(r.meta).toBe("EMP-0090 · equipment returned · accounts still to close · 2 d overdue");
    expect(r.action).toBe("Close account");
    expect(r.href).toBe("/offboarding/e1?step=accounts");
  });
});

describe("workActionLabel", () => {
  const row = (over: Partial<WorkRow>): WorkRow =>
    ({ key: "k", section: "triage", title: "", meta: "", href: "/x", action: "Chase", severity: 0, ...over });
  it("controls read their verb; links keep their action; viewers read Open", () => {
    expect(workActionLabel(row({ control: { kind: "triage", asset: { id: "a", tag: "T", model: "M" } } }), true)).toBe("Triage…");
    expect(workActionLabel(row({ control: { kind: "it-check", asset: { id: "a", tag: "T" } } }), true)).toBe("Mark checked");
    expect(workActionLabel(row({ control: { kind: "loan-due", asset: { id: "a", tag: "T" }, loanDueAt: null } }), true)).toBe("Set loan date…");
    expect(workActionLabel(row({ control: { kind: "assign", asset: { id: "a", tag: "T", model: "M" } } }), true)).toBe("Assign…");
    expect(workActionLabel(row({}), true)).toBe("Chase");
    expect(workActionLabel(row({ control: { kind: "it-check", asset: { id: "a", tag: "T" } } }), false)).toBe("Open");
  });
});

describe("groupWork — hidden rows are kept, not dropped", () => {
  const r = (key: string, section: WorkRow["section"], severity = 0): WorkRow =>
    ({ key, section, title: key, meta: "", href: "/", action: "Open", severity });
  it("partitions today's hidden rows per section and keeps a section with only hidden rows", () => {
    const groups = groupWork([r("triage:1", "triage"), r("triage:2", "triage"), r("loans:3", "loans")], new Set(["triage:2", "loans:3"]), {});
    expect(groups.map((g) => [g.section.id, g.rows.map((x) => x.key), g.hidden.map((x) => x.key), g.total])).toEqual([
      ["triage", ["triage:1"], ["triage:2"], 1],
      ["loans", [], ["loans:3"], 0],
    ]);
  });
});

describe("capLine / SEE_ALL_HREF / summaryChips / pastSlaCount", () => {
  const section = WORK_SECTIONS.find((s) => s.id === "repairs")!;
  it("a capped section says how many of how many", () => {
    expect(capLine({ section, rows: new Array(50).fill(null) as WorkRow[], total: 50, capped: true, hidden: [], pastSla: 0 }))
      .toBe("Showing 50 of 50+ · See all");
    expect(capLine({ section, rows: [], total: 0, capped: false, hidden: [], pastSla: 0 })).toBeNull();
  });
  it("every section has a list that holds the rest", () => {
    expect(SEE_ALL_HREF).toEqual({
      triage: "/inventory?sort=attention", check: "/inventory?sort=attention",
      repairs: "/inventory?status=DEFECTIVE", loans: "/inventory?status=TEMPORARY&sort=attention",
      missing: "/inventory?status=MISSING", hires: "/employees?gaps=1", queue: "/approvals",
    });
  });
  it("chips count each non-empty section; past SLA counts rank-0 queue rows", () => {
    const rows: WorkRow[] = [
      { key: "queue:a", section: "queue", title: "", meta: "", href: "/", action: "Open", severity: 3, rank: 0 },
      { key: "queue:b", section: "queue", title: "", meta: "", href: "/", action: "Open", severity: 1, rank: 1 },
      { key: "loans:c", section: "loans", title: "", meta: "", href: "/", action: "Open", severity: 1 },
    ];
    const groups = groupWork(rows, new Set(), {});
    expect(summaryChips(groups)).toEqual([
      { id: "loans", label: "Loans 1", href: "#loans" },
      { id: "queue", label: "Approvals & leavers 2", href: "#queue" },
    ]);
    expect(pastSlaCount(groups)).toBe(1);
    expect(groups.map((g) => g.pastSla)).toEqual([0, 1]);
  });
  it("past SLA counts every live breach, not only the rows a limit keeps; hidden breaches do not count", () => {
    const breach = (id: string, severity: number): WorkRow =>
      ({ key: `queue:${id}`, section: "queue", title: "", meta: "", href: "/", action: "Open", severity, rank: 0 });
    const rows = [breach("a", 3), breach("b", 2), breach("c", 1), breach("d", 0)];
    const groups = groupWork(rows, new Set(["queue:d"]), { limit: 2 });
    expect(groups[0].rows).toHaveLength(2);
    expect(pastSlaCount(groups)).toBe(3);
    expect(workHeadline(groups)).toBe("3 waiting · 3 past SLA");
  });
});
