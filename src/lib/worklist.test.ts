import { describe, expect, it } from "vitest";
import { DEFAULT_LOAN_DAYS, LOAN_DUE_SOON_DAYS, WORK_SECTIONS, groupWork, loanRow, type WorkRow } from "./worklist";

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
  it("drops dismissed rows and empty sections", () => {
    const g = groupWork(rows, new Set(["r1"]), {});
    expect(g.map((x) => x.section.id)).toEqual(["triage", "queue"]);
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
});

describe("loanRow (Phase 16 §4.3)", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const loan = (loanDueAt: Date | null) => ({ id: "a1", tag: "BR-LT-0210", model: "T14", loanDueAt, holder: "Ana Cruz" });
  it("no due date sits on top and asks for one", () => {
    const r = loanRow(loan(null), now)!;
    expect(r.title).toBe("BR-LT-0210 on loan with no due date");
    expect(r.meta).toBe("Ana Cruz · set a due date");
    expect(r.severity).toBe(1000);
    expect(r.action).toBe("Set date");
    expect(r.href).toBe("/inventory/a1");
  });
  it("overdue by N days", () => {
    const r = loanRow(loan(new Date("2026-09-04T00:00:00Z")), now)!;
    expect(r.title).toBe("BR-LT-0210 overdue by 3 d");
    expect(r.severity).toBe(503);
    expect(r.action).toBe("Review");
  });
  it("due within the week", () => {
    const r = loanRow(loan(new Date("2026-09-10T00:00:00Z")), now)!;
    expect(r.title).toBe("BR-LT-0210 due in 3 d");
    expect(r.severity).toBe(LOAN_DUE_SOON_DAYS - 3);
  });
  it("due later is not on the list", () => {
    expect(loanRow(loan(new Date("2026-10-30T00:00:00Z")), now)).toBeNull();
  });
  it("section blurb names the three cases", () => {
    expect(WORK_SECTIONS.find((s) => s.id === "loans")?.blurb).toBe("Loans overdue, due this week, or with no due date.");
  });
});
