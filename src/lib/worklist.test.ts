import { describe, expect, it } from "vitest";
import { LOAN_DAYS, WORK_SECTIONS, groupWork, type WorkRow } from "./worklist";

const row = (section: WorkRow["section"], key: string, severity = 0, rank?: number): WorkRow =>
  ({ key, section, title: key, meta: "", href: "/x", action: "Do", severity, rank });

describe("WORK_SECTIONS", () => {
  it("is the spec's order", () => {
    expect(WORK_SECTIONS.map((s) => s.id)).toEqual(["triage", "repairs", "check", "hires", "loans", "missing", "queue"]);
  });
  it("loans wait 30 days", () => expect(LOAN_DAYS).toBe(30));
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
