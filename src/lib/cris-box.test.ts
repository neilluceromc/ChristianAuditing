import { describe, expect, it } from "vitest";
import type { CrisCard, CrisViewMessage, SparesCard } from "./cris-cards";
import {
  contextLine, gapLine, isSaved, liveMessageId, nextTyped, oldestSavedId, outcomeOfFailure, outcomeOfMood,
  personFirstFor, pressSettled, quickStarts, scannedSpare, spareMeta, undoSecondsLeft, waitingIn,
} from "./cris-box";
import { CRIS_ALREADY_DONE, CRIS_SAME_MOMENT } from "./cris-undo";

const person = { id: "e1", name: "Ana Reyes", employeeNo: "EMP-0101", worksFor: "Bluepeak Telecom", initials: "AR" };
const spare = (tag: string, assetId = tag) => ({
  assetId, tag, model: "Latitude 5440", typeName: "Standard", warrantyEnd: "2029-02-10T00:00:00.000Z", backOn: "2026-10-12T02:00:00.000Z",
});
const sparesCard: SparesCard = { type: "spares", employeeId: "e1", options: [spare("BR-LT-0230", "a230"), spare("BR-LT-0219", "a219")], offset: 0, more: true };
const msg = (id: string, role: "user" | "cris", cards: CrisCard[] = [], text: string | null = "x"): CrisViewMessage => ({
  id, role, text, cards, at: "2026-10-17T02:00:00.000Z",
});

describe("typing out (about 3 characters every 18 ms)", () => {
  it("shows 3 more characters a tick, and stops at the end", () => {
    expect(nextTyped(0, 10)).toBe(3);
    expect(nextTyped(9, 10)).toBe(10);
    expect(nextTyped(10, 10)).toBe(10);
  });
});

describe("outcomes for the mood (the Task 6 rules)", () => {
  it("forbidden is refused; a conflict, a rate limit or a bad input is an error", () => {
    expect(outcomeOfFailure("forbidden")).toBe("refused");
    expect(outcomeOfFailure("conflict")).toBe("error");
    expect(outcomeOfFailure("rate_limited")).toBe("error");
    expect(outcomeOfFailure("validation")).toBe("error");
  });
  it("the turn's own mood: sad is nothing found, cross is an error, the rest set no outcome", () => {
    expect(outcomeOfMood("sad")).toBe("empty");
    expect(outcomeOfMood("cross")).toBe("error");
    expect(outcomeOfMood("talk")).toBeNull();
    expect(outcomeOfMood("look")).toBeNull();
  });
});

describe("saved and unsaved messages", () => {
  it("transient- ids are unsaved", () => {
    expect(isSaved("transient-1760000000000")).toBe(false);
    expect(isSaved("cm123")).toBe(true);
  });
  it("Earlier messages loads before the oldest saved one", () => {
    expect(oldestSavedId([msg("transient-1", "cris"), msg("m2", "user"), msg("m3", "cris")])).toBe("m2");
    expect(oldestSavedId([msg("transient-1", "cris")])).toBeNull();
  });
});

describe("which cards are live", () => {
  it("only the last message's cards take a pick", () => {
    expect(liveMessageId([msg("m1", "cris", [sparesCard]), msg("m2", "user")])).toBe("m2");
    expect(liveMessageId([])).toBeNull();
  });
  it("waits while the last Cris message has a which, spares or open Confirm card", () => {
    expect(waitingIn([msg("m1", "cris", [sparesCard])], new Set())).toBe(true);
    expect(waitingIn([msg("m1", "cris", [{ type: "which", choices: [person] }])], new Set())).toBe(true);
    expect(waitingIn([msg("m1", "cris", [sparesCard]), msg("m2", "user")], new Set())).toBe(false);
    expect(waitingIn([msg("m1", "cris", [{ type: "chips", items: ["a"] }])], new Set())).toBe(false);
  });
  it("unsaved messages after a card (a failed send's echo, a refusal) leave it live", () => {
    const echo = msg("transient-local-1-1", "user");
    const refusal = msg("transient-local-1-2", "cris");
    const confirm: CrisCard = {
      type: "confirm", pendingId: "p1", kind: "assign", person,
      gets: { ...spare("BR-LT-0230"), serial: null, scanned: false },
    };
    expect(liveMessageId([msg("m1", "cris", [confirm]), refusal])).toBe("m1");
    expect(liveMessageId([msg("m1", "cris", [sparesCard]), echo, refusal])).toBe("m1");
    expect(liveMessageId([msg("transient-1", "cris")])).toBeNull();
    expect(waitingIn([msg("m1", "cris", [confirm]), refusal], new Set())).toBe(true);
    expect(waitingIn([msg("m1", "cris", [sparesCard]), echo, refusal], new Set())).toBe(true);
    expect(scannedSpare("BR-LT-0230", [msg("m1", "cris", [sparesCard]), echo, refusal])).toBe("a230");
  });
  it("a saved message after the card still ends it", () => {
    expect(liveMessageId([msg("m1", "cris", [sparesCard]), msg("m2", "user"), msg("transient-local-1-2", "cris")])).toBe("m2");
    expect(waitingIn([msg("m1", "cris", [sparesCard]), msg("m2", "user"), msg("transient-2", "cris")], new Set())).toBe(false);
  });
  it("a Confirm card stops waiting once it is confirmed", () => {
    const confirm: CrisCard = {
      type: "confirm", pendingId: "p1", kind: "assign", person,
      gets: { ...spare("BR-LT-0230"), serial: "5CG4812", scanned: false },
    };
    expect(waitingIn([msg("m1", "cris", [confirm])], new Set())).toBe(true);
    expect(waitingIn([msg("m1", "cris", [confirm])], new Set(["p1"]))).toBe(false);
  });
});

describe("a scanned tag", () => {
  it("is a scanned pick when it is one of the open spares (any case, spaces trimmed)", () => {
    expect(scannedSpare(" br-lt-0219 ", [msg("m1", "cris", [sparesCard])])).toBe("a219");
  });
  it("is plain text otherwise", () => {
    expect(scannedSpare("BR-LT-0999", [msg("m1", "cris", [sparesCard])])).toBeNull();
    expect(scannedSpare("BR-LT-0219", [msg("m1", "cris", [sparesCard]), msg("m2", "user")])).toBeNull();
  });
});

describe("card wording", () => {
  it("a spare's line: type, warranty end and the date it came back", () => {
    expect(spareMeta(spare("BR-LT-0230"))).toBe("Standard · warranty to Feb 2029 · back 12 Oct");
    expect(spareMeta({ ...spare("BR-LT-0230"), typeName: null, warrantyEnd: null, backOn: null })).toBe("no warranty date");
    expect(spareMeta({ ...spare("BR-LT-0230"), backOn: null })).toBe("Standard · warranty to Feb 2029");
  });
  it("policy gaps", () => {
    expect(gapLine([])).toBeNull();
    expect(gapLine(["Phone"])).toBe("Their policy also expects a Phone — none yet.");
    expect(gapLine(["Phone", "Monitor (optional)"])).toBe("Their policy also expects: Phone, Monitor (optional) — none yet.");
  });
  it("the result card's next step names the person from the Confirm card it answers", () => {
    const confirm: CrisCard = {
      type: "confirm", pendingId: "p1", kind: "assign", person,
      gets: { ...spare("BR-LT-0230"), serial: null, scanned: false },
    };
    expect(personFirstFor("p1", [msg("m1", "cris", [confirm])])).toBe("Ana");
    expect(personFirstFor("p2", [msg("m1", "cris", [confirm])])).toBeNull();
  });
  it("Undo counts down whole seconds, never below zero", () => {
    const now = Date.parse("2026-10-17T02:00:00.000Z");
    expect(undoSecondsLeft("2026-10-17T02:01:00.000Z", now)).toBe(60);
    expect(undoSecondsLeft("2026-10-17T02:00:00.400Z", now)).toBe(1);
    expect(undoSecondsLeft("2026-10-17T01:59:00.000Z", now)).toBe(0);
  });
});

describe("the opening state (spec §4)", () => {
  it("names the person on a profile first, and says where you are", () => {
    const ctx = { kind: "person" as const, id: "e1", name: "Ana Reyes" };
    expect(contextLine(ctx)).toEqual({ before: "You're on ", name: "Ana Reyes", after: "'s profile" });
    const starts = quickStarts(ctx);
    expect(starts.slice(0, 2).map((s) => s.label)).toEqual(["Check Ana's items", "Replace Ana's laptop"]);
    expect(starts[0]).toMatchObject({ text: "Check Ana Reyes's items", send: true });
    // A replace needs a reason, so it is started in the box rather than sent.
    expect(starts[1]).toMatchObject({ text: "Replace Ana Reyes's laptop, ", send: false });
  });
  it("names the asset on a record first", () => {
    const ctx = { kind: "asset" as const, id: "a1", tag: "BR-LT-0148" };
    expect(contextLine(ctx)).toEqual({ before: "You're on ", name: "BR-LT-0148", after: "'s record" });
    expect(quickStarts(ctx)[0]).toMatchObject({ label: "Who has BR-LT-0148?", text: "Who has BR-LT-0148?", send: true });
  });
  it("is general elsewhere", () => {
    expect(contextLine(null)).toBeNull();
    const labels = quickStarts(null).map((s) => s.label);
    expect(labels).toContain("Spares in stock");
    expect(labels).toContain("Who has a tag?");
  });
});

describe("pressSettled: whether a Confirm or Undo answer ends its button", () => {
  it("ends it when done, or refused for good", () => {
    expect(pressSettled({ ok: true })).toBe(true);
    expect(pressSettled({ ok: false, kind: "conflict", message: CRIS_ALREADY_DONE })).toBe(true);
  });
  it("keeps it after a clash at the same moment (nothing was written), a throw, a rate limit or a refusal of the person", () => {
    expect(pressSettled({ ok: false, kind: "conflict", message: CRIS_SAME_MOMENT })).toBe(false);
    expect(pressSettled(null)).toBe(false);
    expect(pressSettled({ ok: false, kind: "rate_limited", message: "Slow down" })).toBe(false);
    expect(pressSettled({ ok: false, kind: "forbidden", message: "No" })).toBe(false);
  });
});
