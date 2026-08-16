import { describe, expect, it } from "vitest";
import { historyRows } from "./history";

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
