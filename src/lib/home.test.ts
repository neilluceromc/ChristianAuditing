import { describe, expect, it } from "vitest";
import { activeDismissals, coverageLine, withDismissal, withoutDismissal } from "./home";

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
