import { describe, expect, it } from "vitest";
import { LOAN_DAYS, WORK_SECTIONS, groupWork, type WorkRow } from "./worklist";

const row = (section: WorkRow["section"], key: string, severity = 0): WorkRow =>
  ({ key, section, title: key, meta: "", href: "/x", action: "Do", severity });

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
});
