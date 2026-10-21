import { describe, expect, it } from "vitest";
import type { NoteKind } from "@prisma/client";
import {
  NOTE_CHIP, THREAD_PAGE, THREAD_PREVIEW, bounceBack, stepperModel, submittedVisits, threadCountLine, unitAnchor,
  type StepperContext, type ThreadNote,
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

describe("stepperModel (purchase orders: PO saved → With IT → Registered → Approved)", () => {
  const ctx = (over: Partial<StepperContext> = {}): StepperContext => ({
    hasItLines: true, progress: null, sentBackBy: null, ...over,
  });
  const keys = (m: ReturnType<typeof stepperModel>) => m.stops.map((s) => s.key);
  const statuses = (m: ReturnType<typeof stepperModel>) => m.stops.map((s) => s.status);

  it("an order with IT lines: saved is done, With IT is current and marked NOW", () => {
    const m = stepperModel("WITH_IT", [note("PO_SAVED", "P", "x", 0)], ctx());
    expect(keys(m)).toEqual(["saved", "with-it", "registered", "approved"]);
    expect(m.stops.map((s) => s.label)).toEqual(["PO saved", "With IT", "Registered", "Approved"]);
    expect(statuses(m)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(m.stops[1].note).toBe("NOW");
    expect(m.sentBack).toBeNull();
    expect(m.returnAt).toBe(-1);
    expect(m.cancelled).toBe(false);
  });

  it("a non-IT order skips With IT and is waiting to be registered when READY", () => {
    const m = stepperModel("READY", [note("PO_SAVED", "P", "x", 0)], ctx({ hasItLines: false }));
    expect(keys(m)).toEqual(["saved", "registered", "approved"]);
    expect(statuses(m)).toEqual(["done", "current", "upcoming"]);
    expect(m.stops[1].note).toBe("NOW");
  });

  it("READY on an order with IT lines shows With IT as done only because it has moved on", () => {
    const m = stepperModel("READY", [note("PO_SAVED", "P", "x", 0), note("PO_RESUBMITTED", "P", "fixed", 1)], ctx());
    expect(statuses(m)).toEqual(["done", "done", "current", "upcoming"]);
    expect(m.stops[2].label).toBe("Registered");
  });

  it("partly registered: With IT is done, Registered is current and says so", () => {
    const m = stepperModel("WITH_IT", [note("PO_SAVED", "P", "x", 0)], ctx({ progress: "Partly registered" }));
    expect(statuses(m)).toEqual(["done", "done", "current", "upcoming"]);
    expect(m.stops[2].note).toBe("PARTLY");
  });

  it("registered: Approved is the current stop, with Finance", () => {
    const m = stepperModel("READY", [note("PO_SAVED", "P", "x", 0)], ctx({ progress: "Registered" }));
    expect(statuses(m)).toEqual(["done", "done", "done", "current"]);
    expect(m.stops[3].note).toBe("WITH FINANCE");
  });

  it("approved: every stop is done", () => {
    const m = stepperModel("READY", [note("PO_SAVED", "P", "x", 0)], ctx({ progress: "Approved" }));
    expect(statuses(m)).toEqual(["done", "done", "done", "done"]);
    expect(m.stops.every((s) => s.note === undefined)).toBe(true);
  });

  it("a legacy finance bounce marks With IT NOW · 2nd time and draws the return after it", () => {
    const m = stepperModel("WITH_IT", BOUNCED, ctx());
    expect(m.stops[1].status).toBe("current");
    expect(m.stops[1].note).toBe("NOW · 2nd time");
    expect(m.sentBack).toBe("finance");
    expect(m.returnAt).toBe(1);
  });

  // The ordinal suffix table is only reachable through this note, so drive it past the 2nd-time case — 3rd, 11th
  // and 21st are where a naive `n % 10` table goes wrong.
  it.each([
    [3, "NOW · 3rd time"],
    [4, "NOW · 4th time"],
    [11, "NOW · 11th time"],
    [12, "NOW · 12th time"],
    [13, "NOW · 13th time"],
    [21, "NOW · 21st time"],
  ])("marks legacy visit %i as %s", (visits, expected) => {
    const thread = Array.from({ length: visits }, (_, i) =>
      note(i % 2 === 0 ? "SUBMIT" : "REQUEST_INFO", "P", "x", i));
    expect(stepperModel("WITH_IT", thread, ctx()).stops[1].note).toBe(expected);
  });

  it("sent back by IT: PO saved is current (SENT BACK) and the return is drawn after it", () => {
    const m = stepperModel("SENT_BACK", [note("PO_SAVED", "P", "x", 0), note("PO_SENT_BACK", "J", "wrong SI", 1)], ctx({ sentBackBy: "IT" }));
    expect(statuses(m)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    expect(m.stops[0].note).toBe("SENT BACK");
    expect(m.sentBack).toBe("it");
    expect(m.returnAt).toBe(0);
  });

  it("sent back by Finance after registering: Registered stays done, the return is drawn", () => {
    const m = stepperModel("SENT_BACK", [note("PO_SAVED", "P", "x", 0)], ctx({ sentBackBy: "FINANCE", progress: "Registered" }));
    expect(statuses(m)).toEqual(["current", "done", "done", "upcoming"]);
    expect(m.sentBack).toBe("finance");
    expect(m.returnAt).toBe(0);
  });

  it("a legacy draft (sent back, never sent) is with Purchasing and has no return path", () => {
    const m = stepperModel("SENT_BACK", [], ctx({ sentBackBy: null }));
    expect(statuses(m)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    expect(m.sentBack).toBeNull();
    expect(m.returnAt).toBe(-1);
  });

  it("a legacy IT rejection still draws its return path", () => {
    const m = stepperModel("SENT_BACK", [note("SUBMIT", "P", "x", 0), note("IT_REJECT", "J", "y", 1)], ctx());
    expect(m.sentBack).toBe("it");
    expect(m.returnAt).toBe(0);
  });

  it("freezes a cancelled order at how far it actually got", () => {
    const thread = [note("PO_SAVED", "P", "x", 0), note("PO_CANCELLED", "P", "dup", 1)];
    const sent = stepperModel("CANCELLED", thread, ctx());
    expect(sent.cancelled).toBe(true);
    expect(statuses(sent)).toEqual(["done", "done", "upcoming", "upcoming"]);
    expect(statuses(stepperModel("CANCELLED", thread, ctx({ hasItLines: false })))).toEqual(["done", "upcoming", "upcoming"]);
  });

  it("keeps PO saved reached for a cancel straight from a legacy draft", () => {
    const m = stepperModel("CANCELLED", [note("CANCEL", "P", "duplicate", 0)], ctx());
    expect(statuses(m)).toEqual(["done", "upcoming", "upcoming", "upcoming"]);
  });

  it("reads a legacy completed-then-cancelled thread as having been through IT", () => {
    const m = stepperModel("CANCELLED", [note("SUBMIT", "P", "x", 0), note("COMPLETE", "F", "y", 1)], ctx());
    expect(statuses(m)).toEqual(["done", "done", "upcoming", "upcoming"]);
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
