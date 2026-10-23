import { describe, expect, it } from "vitest";
import {
  TRIAGE_UNDO_WINDOW_MS, blocksTriageUndo, bulkReport, clearedCount, notesBefore, triageOutcomeOf, triageRestore, triageVersion,
  undoWindowOpen, undoneTarget,
} from "./triage-undo";

/* Worklist split view (H4) Task 2: the pure rules behind undoing a triage decision and "Cleared today". */

describe("triage undo rules", () => {
  it("reads the decision back from its audit entry's words", () => {
    expect(triageOutcomeOf({ triage: { from: null, to: "Keep as spare" } })).toBe("SPARE");
    expect(triageOutcomeOf({ triage: { from: null, to: "Send to repair" } })).toBe("DEFECTIVE");
    expect(triageOutcomeOf({ triage: { from: null, to: "Dispose" } })).toBe("DISPOSE");
    expect(triageOutcomeOf({ triage: { from: null, to: "Donate" } })).toBe("DONATED");
    expect(triageOutcomeOf({ triage: { from: null, to: "Something" } })).toBeNull();
    expect(triageOutcomeOf(null)).toBeNull();
  });

  it("reads the version the decision left, stored as a Date or as JSON's ISO string", () => {
    const at = new Date("2026-10-23T02:00:00.123Z");
    expect(triageVersion({ version: { from: null, to: at } })).toEqual(at);
    expect(triageVersion({ version: { from: null, to: at.toISOString() } })).toEqual(at);
    expect(triageVersion({ triage: { from: null, to: "Keep as spare" } })).toBeNull();
    expect(triageVersion({ version: { from: null, to: "not a date" } })).toBeNull();
  });

  it("puts back each field the decision changed, from its `from`", () => {
    const diff = {
      triage: { from: null, to: "Send to repair" },
      status: { from: "SPARE", to: "DEFECTIVE" },
      returnedAt: { from: "2026-10-20T01:00:00.000Z", to: null },
      defectiveSince: { from: null, to: "2026-10-23T02:00:00.000Z" },
      repairEndedAt: { from: "2026-09-01T00:00:00.000Z", to: null },
      note: { from: null, to: "fan noise" },
      version: { from: null, to: "2026-10-23T02:00:00.000Z" },
    };
    expect(triageRestore(diff)).toEqual({
      status: "SPARE",
      returnedAt: new Date("2026-10-20T01:00:00.000Z"),
      defectiveSince: null,
      repairEndedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    // Keep as spare moves only the flag
    expect(triageRestore({ triage: { from: null, to: "Keep as spare" }, returnedAt: { from: new Date("2026-10-20T01:00:00Z"), to: null } }))
      .toEqual({ returnedAt: new Date("2026-10-20T01:00:00Z") });
  });

  it("takes the decision's note back off the asset's notes", () => {
    expect(notesBefore("fan noise", "fan noise")).toBeNull();
    expect(notesBefore("bought 2023\nfan noise", "fan noise")).toBe("bought 2023");
    expect(notesBefore("someone else's words", "fan noise")).toBeUndefined();
    expect(notesBefore(null, "fan noise")).toBeUndefined();
  });

  it("the window is 15 minutes, inclusive, never in the future", () => {
    const at = new Date("2026-10-23T02:00:00Z");
    expect(undoWindowOpen(at, at)).toBe(true);
    expect(undoWindowOpen(at, new Date(at.getTime() + TRIAGE_UNDO_WINDOW_MS))).toBe(true);
    expect(undoWindowOpen(at, new Date(at.getTime() + TRIAGE_UNDO_WINDOW_MS + 1))).toBe(false);
    expect(undoWindowOpen(at, new Date(at.getTime() - 1))).toBe(false);
  });

  it("a later note, attachment or document never blocks an undo; any other change does", () => {
    for (const a of ["note.posted", "note.replied", "attachment.uploaded", "document.uploaded", "SECRET_READ", "comment"]) {
      expect(blocksTriageUndo(a)).toBe(false);
    }
    for (const a of ["lifecycle.assign", "reservation.placed", "update", "lifecycle.triage", "loan.due-changed"]) {
      expect(blocksTriageUndo(a)).toBe(true);
    }
  });

  it("an undone entry names the decision it undid", () => {
    expect(undoneTarget({ undoes: { from: null, to: "aud001" } })).toBe("aud001");
    expect(undoneTarget({ triage: { from: "Keep as spare", to: null } })).toBeNull();
  });

  it("the bulk report's words", () => {
    expect(bulkReport(8, 1)).toBe("8 done, 1 couldn't (changed by someone else)");
  });
});

describe("clearedCount", () => {
  it("counts triage, IT checks and loan due dates, less the decisions undone", () => {
    expect(clearedCount([
      { id: "a1", action: "lifecycle.triage", diff: {} },
      { id: "a2", action: "lifecycle.triage", diff: {} },
      { id: "a3", action: "it.verify", diff: {} },
      { id: "a4", action: "loan.due-changed", diff: {} },
      { id: "a5", action: "lifecycle.triage.undone", diff: { undoes: { from: null, to: "a2" } } },
      { id: "a6", action: "lifecycle.assign", diff: {} },
    ])).toBe(3);
  });

  it("an undo of yesterday's decision takes nothing off today's count", () => {
    expect(clearedCount([
      { id: "a1", action: "it.verify", diff: {} },
      { id: "a9", action: "lifecycle.triage.undone", diff: { undoes: { from: null, to: "a0-yesterday" } } },
    ])).toBe(1);
  });
});
