import { describe, expect, it } from "vitest";
import type { NoteKind } from "@prisma/client";
import {
  NOTE_CHIP, bounceBack, stepperModel, submittedVisits, unitAnchor, type ThreadNote,
} from "./purchase-thread";

let seq = 0;
const note = (kind: NoteKind, author: string, text = "…", dayOffset = 0): ThreadNote => ({
  id: `n${seq++}`, kind, author, text, at: new Date(2026, 7, 10 + dayOffset),
});

// The seeded PR-0198 thread, verbatim in shape.
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
});

describe("bounceBack", () => {
  it("detects finance's bounce: SUBMITTED with REQUEST_INFO newest", () => {
    const b = bounceBack("SUBMITTED", BOUNCED);
    expect(b).not.toBeNull();
    expect(b!.by).toBe("M. Cruz");
    expect(b!.from).toBe("finance");
    expect(b!.reason).toBe("Unit 02: quote exceeds standing rate — attach vendor quote.");
    expect(b!.transition).toBe("IT_REVIEWED → SUBMITTED · nothing was cleared");
  });

  it("detects IT's rejection: DRAFT with IT_REJECT newest", () => {
    const b = bounceBack("DRAFT", [
      note("SUBMIT", "P. Reyes", "First pass", 0),
      note("IT_REJECT", "J. Sarmiento", "Specs are too vague to price.", 1),
    ]);
    expect(b!.from).toBe("it");
    expect(b!.transition).toBe("SUBMITTED → DRAFT · nothing was cleared");
  });

  it("ignores COMMENT notes posted after the bounce", () => {
    const b = bounceBack("SUBMITTED", [...BOUNCED, note("COMMENT", "P. Reyes", "On it.", 4)]);
    expect(b!.by).toBe("M. Cruz");
  });

  it("is null for a forward SUBMITTED, a fresh draft, and terminal states", () => {
    expect(bounceBack("SUBMITTED", [note("SUBMIT", "P. Reyes", "Batch", 0)])).toBeNull();
    expect(bounceBack("DRAFT", [])).toBeNull();
    expect(bounceBack("IT_REVIEWED", BOUNCED)).toBeNull();
    expect(bounceBack("COMPLETED", BOUNCED)).toBeNull();
    expect(bounceBack("CANCELLED", BOUNCED)).toBeNull();
  });

  it("is null once the request moved on from the bounce", () => {
    expect(bounceBack("SUBMITTED", [...BOUNCED, note("SUBMIT", "P. Reyes", "Quote attached.", 5)])).toBeNull();
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
  it("walks the four stops with the current one marked NOW", () => {
    const m = stepperModel("SUBMITTED", [note("SUBMIT", "P", "x", 0)]);
    expect(m.stops.map((s) => s.state)).toEqual(["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED"]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(m.stops[1].note).toBe("NOW");
    expect(m.sentBack).toBeNull();
    expect(m.cancelled).toBe(false);
  });

  it("marks the bounced stop NOW · 2nd time and flags the return connector", () => {
    const m = stepperModel("SUBMITTED", BOUNCED);
    expect(m.stops[1].status).toBe("current");
    expect(m.stops[1].note).toBe("NOW · 2nd time");
    expect(m.sentBack).toBe("finance");
  });

  it("labels an IT rejection's return path", () => {
    const m = stepperModel("DRAFT", [note("SUBMIT", "P", "x", 0), note("IT_REJECT", "J", "y", 1)]);
    expect(m.sentBack).toBe("it");
    expect(m.stops[0].status).toBe("current");
  });

  it("completes every stop for COMPLETED", () => {
    const m = stepperModel("COMPLETED", [note("SUBMIT", "P", "x", 0), note("IT_REVIEW", "J", "y", 1)]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "done", "done", "current"]);
  });

  it("freezes a cancelled request at how far it actually got", () => {
    const m = stepperModel("CANCELLED", [note("SUBMIT", "P", "x", 0), note("CANCEL", "P", "duplicate", 1)]);
    expect(m.cancelled).toBe(true);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "done", "upcoming", "upcoming"]);
  });

  it("keeps DRAFT reached for a cancel straight from draft", () => {
    const m = stepperModel("CANCELLED", [note("CANCEL", "P", "duplicate", 0)]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "upcoming", "upcoming", "upcoming"]);
  });

  it("marks IT_REVIEWED current with the earlier stops done", () => {
    const m = stepperModel("IT_REVIEWED", [note("SUBMIT", "P", "x", 0), note("IT_REVIEW", "J", "y", 1)]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "done", "current", "upcoming"]);
  });
});
