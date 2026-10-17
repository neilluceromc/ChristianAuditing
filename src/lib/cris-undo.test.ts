import { describe, expect, it } from "vitest";
import { UNDO_WINDOW_MS, parseResultRef, undoEligible, undoUntil, type ResultRef } from "./cris-undo";

const usedAt = new Date("2026-10-17T10:00:00.000Z");
const at = (sec: number) => new Date(usedAt.getTime() + sec * 1000);

describe("undoEligible", () => {
  it("is true 59 s after the confirm", () => {
    expect(undoEligible({ usedAt, undoneAt: null }, false, at(59))).toBe(true);
  });
  it("is false 61 s after the confirm", () => {
    expect(undoEligible({ usedAt, undoneAt: null }, false, at(61))).toBe(false);
  });
  it("is false once undone", () => {
    expect(undoEligible({ usedAt, undoneAt: at(10) }, false, at(20))).toBe(false);
  });
  it("is false when either asset was touched since", () => {
    expect(undoEligible({ usedAt, undoneAt: null }, true, at(5))).toBe(false);
  });
  it("is false for an action never confirmed", () => {
    expect(undoEligible({ usedAt: null, undoneAt: null }, false, at(5))).toBe(false);
  });
  it("is false for a clock that reads before the confirm", () => {
    expect(undoEligible({ usedAt, undoneAt: null }, false, at(-1))).toBe(false);
  });
});

describe("undoUntil", () => {
  it("is the confirm plus the 60 s window", () => {
    expect(UNDO_WINDOW_MS).toBe(60_000);
    expect(undoUntil(usedAt).toISOString()).toBe("2026-10-17T10:01:00.000Z");
  });
});

describe("parseResultRef", () => {
  const ref: ResultRef = {
    employeeId: "emp1",
    auditIds: ["au1", "au2"],
    holdId: "res1",
    assets: [
      {
        id: "a1", role: "gets", afterStatus: "DEPLOYED",
        before: { status: "SPARE", assigneeId: null, loanDueAt: null, returnedAt: null, defectiveSince: null, repairEndedAt: null },
      },
      {
        id: "a0", role: "returns", afterStatus: "DEFECTIVE",
        before: { status: "DEPLOYED", assigneeId: "emp1", loanDueAt: null, returnedAt: null, defectiveSince: "2026-01-02T00:00:00.000Z", repairEndedAt: "2026-02-02T00:00:00.000Z" },
      },
    ],
  };
  it("round-trips through the stored string", () => {
    expect(parseResultRef(JSON.stringify(ref))).toEqual(ref);
  });
  it("reads nothing from a missing or malformed value", () => {
    expect(parseResultRef(null)).toBeNull();
    expect(parseResultRef("not json")).toBeNull();
    expect(parseResultRef(JSON.stringify({ employeeId: "emp1" }))).toBeNull();
  });
});
