import { describe, expect, it } from "vitest";
import { historyEntries, historyRows } from "./history";

const at = new Date("2026-08-16T09:41:00Z");

describe("historyRows — one row per FIELD, not per save (README 7c)", () => {
  it("expands a multi-field diff into rows sharing the entry timestamp", () => {
    const rows = historyRows([{
      id: "e1", actorLabel: "J. Sarmiento", action: "update", createdAt: at,
      diff: { status: { from: "SPARE", to: "DEPLOYED" }, assignee: { from: null, to: "EMP-0042" } },
    }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ field: "status", from: "SPARE", to: "DEPLOYED", first: true });
    expect(rows[1]).toMatchObject({ field: "assignee", from: "—", to: "EMP-0042", first: false });
    expect(rows[0].at).toEqual(at);
  });
  it("renders diff-less entries (SECRET_READ) as a single action row", () => {
    const rows = historyRows([{ id: "e2", actorLabel: "System Admin", action: "SECRET_READ", createdAt: at, diff: null }]);
    expect(rows).toEqual([
      { key: "e2", at, actor: "System Admin", action: "SECRET_READ", field: "—", from: "—", to: "—", first: true },
    ]);
  });
  it("stringifies values and blanks nullish to —", () => {
    const rows = historyRows([{ id: "e3", actorLabel: "x", action: "update", createdAt: at, diff: { cost: { from: 55000, to: null } } }]);
    expect(rows[0]).toMatchObject({ from: "55000", to: "—" });
  });
});

describe("historyEntries — one group per audit entry, newest first as given", () => {
  it("keeps each entry's field rows together and in order", () => {
    const groups = historyEntries([
      { id: "e1", actorLabel: "A", action: "update", createdAt: at, diff: { a: { from: 1, to: 2 }, b: { from: 1, to: 2 }, c: { from: 1, to: 2 }, d: { from: 1, to: 2 } } },
      { id: "e2", actorLabel: "B", action: "SECRET_READ", createdAt: at, diff: null },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["e1", "e2"]);
    expect(groups[0].fields.map((f) => f.field)).toEqual(["a", "b", "c", "d"]);
    expect(groups[1].fields).toHaveLength(1);
    expect(groups[1]).toMatchObject({ actor: "B", action: "SECRET_READ", at });
  });
});
