import { describe, expect, it } from "vitest";
import type { NoteKind } from "@prisma/client";
import {
  NOTE_CHIP, THREAD_PAGE, THREAD_PREVIEW, bounceBack, stepperModel, submittedVisits, threadCountLine, unitAnchor,
  type ThreadNote,
} from "./purchase-thread";

let seq = 0;
const note = (kind: NoteKind, author: string, text = "…", dayOffset = 0): ThreadNote => ({
  id: `n${seq++}`, kind, author, text, at: new Date(2026, 7, 10 + dayOffset),
});

// The seeded PO-0198 thread (an old request, now WITH_IT), verbatim in shape.
const BOUNCED = [
  note("SUBMIT", "P. Reyes", "Batch for the July hires.", 0),
  note("IT_REVIEW", "J. Sarmiento", "Specs confirmed, docks need wattage check.", 2),
  note("REQUEST_INFO", "M. Cruz", "Unit 02: quote exceeds standing rate — attach vendor quote.", 3),
];

describe("NOTE_CHIP", () => {
  it("names every kind, and both bounce kinds read as SENT BACK", () => {
    expect(NOTE_CHIP.SUBMIT).toBe("SUBMITTED");
    expect(NOTE_CHIP.IT_REVIEW).toBe("IT REVIEW");
    expect(NOTE_CHIP.IT_REJECT).toBe("SENT BACK");
    expect(NOTE_CHIP.REQUEST_INFO).toBe("SENT BACK");
    expect(NOTE_CHIP.CANCEL).toBe("CANCELLED");
    expect(NOTE_CHIP.COMPLETE).toBe("COMPLETED");
    expect(NOTE_CHIP.COMMENT).toBe("COMMENT");
  });
  it("names the purchase-order kinds (migration 38)", () => {
    expect(NOTE_CHIP.PO_SAVED).toBe("SAVED");
    expect(NOTE_CHIP.PO_SENT_BACK).toBe("SENT BACK");
    expect(NOTE_CHIP.PO_RESUBMITTED).toBe("RESUBMITTED");
    expect(NOTE_CHIP.PO_FIXED).toBe("FIXED");
    expect(NOTE_CHIP.PO_REGISTERED).toBe("REGISTERED");
    expect(NOTE_CHIP.PO_LINE_CLOSED).toBe("CLOSED SHORT");
    expect(NOTE_CHIP.PO_CANCELLED).toBe("CANCELLED");
  });
});

describe("bounceBack", () => {
  it("detects finance's legacy bounce: WITH_IT with REQUEST_INFO newest", () => {
    const b = bounceBack("WITH_IT", BOUNCED);
    expect(b).not.toBeNull();
    expect(b!.by).toBe("M. Cruz");
    expect(b!.from).toBe("finance");
    expect(b!.reason).toBe("Unit 02: quote exceeds standing rate — attach vendor quote.");
    expect(b!.transition).toBe("Back with IT · nothing was cleared");
  });

  it("detects IT's legacy rejection: SENT_BACK with IT_REJECT newest", () => {
    const b = bounceBack("SENT_BACK", [
      note("SUBMIT", "P. Reyes", "First pass", 0),
      note("IT_REJECT", "J. Sarmiento", "Specs are too vague to price.", 1),
    ]);
    expect(b!.from).toBe("it");
    expect(b!.transition).toBe("Sent back to Purchasing · nothing was cleared");
  });

  it("ignores COMMENT notes posted after the bounce", () => {
    const b = bounceBack("WITH_IT", [...BOUNCED, note("COMMENT", "P. Reyes", "On it.", 4)]);
    expect(b!.by).toBe("M. Cruz");
  });

  it("is null for a forward WITH_IT, an untouched legacy draft, and the other states", () => {
    expect(bounceBack("WITH_IT", [note("SUBMIT", "P. Reyes", "Batch", 0)])).toBeNull();
    expect(bounceBack("SENT_BACK", [])).toBeNull();
    expect(bounceBack("READY", BOUNCED)).toBeNull();
    expect(bounceBack("CANCELLED", BOUNCED)).toBeNull();
  });

  it("is null once the request moved on from the bounce", () => {
    expect(bounceBack("WITH_IT", [...BOUNCED, note("SUBMIT", "P. Reyes", "Quote attached.", 5)])).toBeNull();
  });
});

describe("unitAnchor — 'Jump to unit 04' is derived, never faked", () => {
  it("finds a unit number in the reason and zero-pads the label", () => {
    expect(unitAnchor("Unit 02: quote exceeds standing rate")).toEqual({ anchor: "#unit-2", label: "Jump to unit 02" });
    expect(unitAnchor("unit 4 is wrong")).toEqual({ anchor: "#unit-4", label: "Jump to unit 04" });
  });
  it("falls back to the units section when no number is named", () => {
    expect(unitAnchor("Please attach the vendor quote")).toEqual({ anchor: "#units", label: "Jump to units" });
  });
});

describe("submittedVisits", () => {
  it("counts arrivals at SUBMITTED — forwards and backwards", () => {
    expect(submittedVisits([])).toBe(0);
    expect(submittedVisits([note("SUBMIT", "P", "x", 0)])).toBe(1);
    expect(submittedVisits(BOUNCED)).toBe(2); // one SUBMIT + one REQUEST_INFO
  });
  it("counts a resubmission after an IT rejection", () => {
    expect(submittedVisits([
      note("SUBMIT", "P", "x", 0), note("IT_REJECT", "J", "y", 1), note("SUBMIT", "P", "z", 2),
    ])).toBe(2);
  });
});

describe("stepperModel", () => {
  it("walks the three stops with the current one marked NOW", () => {
    const m = stepperModel("WITH_IT", [note("SUBMIT", "P", "x", 0)]);
    expect(m.stops.map((s) => s.state)).toEqual(["SENT_BACK", "WITH_IT", "READY"]);
    expect(m.stops.map((s) => s.label)).toEqual(["With Purchasing", "With IT", "Ready to register"]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "current", "upcoming"]);
    expect(m.stops[1].note).toBe("NOW");
    expect(m.sentBack).toBeNull();
    expect(m.cancelled).toBe(false);
  });

  it("marks the bounced stop NOW · 2nd time and flags the return connector", () => {
    const m = stepperModel("WITH_IT", BOUNCED);
    expect(m.stops[1].status).toBe("current");
    expect(m.stops[1].note).toBe("NOW · 2nd time");
    expect(m.sentBack).toBe("finance");
  });

  // The ordinal suffix table is only reachable through this note, so drive it
  // past the 2nd-time case the happy path covers — 3rd, 11th and 21st are
  // where a naive `n % 10` table goes wrong.
  it.each([
    [3, "NOW · 3rd time"],
    [4, "NOW · 4th time"],
    [11, "NOW · 11th time"],
    [12, "NOW · 12th time"],
    [13, "NOW · 13th time"],
    [21, "NOW · 21st time"],
  ])("marks visit %i as %s", (visits, expected) => {
    // alternate SUBMIT / REQUEST_INFO so the last note is a genuine arrival
    const thread = Array.from({ length: visits }, (_, i) =>
      note(i % 2 === 0 ? "SUBMIT" : "REQUEST_INFO", "P", "x", i));
    expect(stepperModel("WITH_IT", thread).stops[1].note).toBe(expected);
  });

  it("labels an IT rejection's return path", () => {
    const m = stepperModel("SENT_BACK", [note("SUBMIT", "P", "x", 0), note("IT_REJECT", "J", "y", 1)]);
    expect(m.sentBack).toBe("it");
    expect(m.stops[0].status).toBe("current");
  });

  it("marks READY current with the earlier stops done", () => {
    const m = stepperModel("READY", [note("PO_SAVED", "P", "x", 0)]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "done", "current"]);
  });

  it("freezes a cancelled request at how far it actually got", () => {
    const m = stepperModel("CANCELLED", [note("SUBMIT", "P", "x", 0), note("CANCEL", "P", "duplicate", 1)]);
    expect(m.cancelled).toBe(true);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "done", "upcoming"]);
  });

  it("keeps With Purchasing reached for a cancel straight from a legacy draft", () => {
    const m = stepperModel("CANCELLED", [note("CANCEL", "P", "duplicate", 0)]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "upcoming", "upcoming"]);
  });

  it("freezes a legacy completed-then-cancelled thread at Ready, and reads the new kinds too", () => {
    expect(stepperModel("CANCELLED", [note("SUBMIT", "P", "x", 0), note("COMPLETE", "F", "y", 1)]).stops.map((s) => s.status))
      .toEqual(["done", "done", "done"]);
    expect(stepperModel("CANCELLED", [note("PO_SAVED", "P", "x", 0), note("PO_CANCELLED", "P", "dup", 1)]).stops.map((s) => s.status))
      .toEqual(["done", "done", "upcoming"]);
  });
});

describe("the conversation panel (Phase 39)", () => {
  it("shows 5 inline and pages 30 at a time", () => {
    expect(THREAD_PREVIEW).toBe(5);
    expect(THREAD_PAGE).toBe(30);
  });

  it("counts the whole thread, or the matches while filtering", () => {
    expect(threadCountLine({ total: 12, matching: 12, shown: 12, filtering: false })).toBe("12 messages · oldest first · showing 12");
    expect(threadCountLine({ total: 1, matching: 1, shown: 1, filtering: false })).toBe("1 message · oldest first · showing 1");
    expect(threadCountLine({ total: 12, matching: 3, shown: 3, filtering: true })).toBe("3 of 12 messages match");
    expect(threadCountLine({ total: 12, matching: 0, shown: 0, filtering: true })).toBe("0 of 12 messages match");
  });
});
