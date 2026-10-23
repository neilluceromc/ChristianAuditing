import { describe, expect, it } from "vitest";
import {
  focusAfterAction, focusOnClose, focusOnOpen, focusOnPasswordShown, focusSel, panelMayTakeFocus,
} from "./users-panel-focus";

/* Users & access (Task 4 fix round 1, I-1): focus follows every inline step in the details panel. */

const SWITCH = '[data-focus="switch"] [role="switch"]';

describe("opening a step focuses its first control", () => {
  it("the confirms land on Cancel; Edit on Full name; Change on the search; the discard prompt on Keep editing", () => {
    expect(focusOnOpen("turn-off")).toEqual(['[data-focus="turn-off-cancel"]']);
    expect(focusOnOpen("decline")).toEqual(['[data-focus="decline-cancel"]']);
    expect(focusOnOpen("edit")).toEqual(['[data-focus="name"]']);
    expect(focusOnOpen("pick")).toEqual(['[data-focus="pick-search"]']);
    expect(focusOnOpen("discard")).toEqual(['[data-focus="keep-editing"]']);
  });
});

describe("closing a step returns focus to what opened it", () => {
  it("Cancel on the turn-off confirm goes back to the switch", () => {
    expect(focusOnClose("turn-off")).toEqual([SWITCH]);
  });
  it("Cancel on the decline confirm goes back to Decline (Approve if it's gone)", () => {
    expect(focusOnClose("decline")).toEqual(['[data-focus="decline"]', '[data-focus="approve"]']);
  });
  it("closing the name fields goes back to Edit; a pick back to Change or Link…; Keep editing to Save", () => {
    expect(focusOnClose("edit")[0]).toBe('[data-focus="edit"]');
    expect(focusOnClose("pick")[0]).toBe('[data-focus="pick"]');
    expect(focusOnClose("discard")[0]).toBe('[data-focus="save"]');
  });
  it("every list ends somewhere that always exists, or is a single always-present control", () => {
    for (const step of ["edit", "pick", "discard"] as const) expect(focusOnClose(step).at(-1)).toBe(focusSel("title"));
  });
});

describe("after an action's answer", () => {
  it("the switch keeps focus whichever way it went", () => {
    for (const a of ["turn-off", "turn-on"] as const) {
      expect(focusAfterAction(a, "done")[0]).toBe(SWITCH);
      expect(focusAfterAction(a, "refused")[0]).toBe(SWITCH);
    }
  });
  it("a refused save goes to the first invalid field, then Save", () => {
    expect(focusAfterAction("save", "refused").slice(0, 2)).toEqual(['[aria-invalid="true"]', '[data-focus="save"]']);
    expect(focusAfterAction("save", "done")[0]).toBe('[data-focus="edit"]');
  });
  it("an approved sign-up's panel changes shape: the heading; a declined one keeps Approve", () => {
    expect(focusAfterAction("approve", "done")).toEqual(['[data-focus="title"]']);
    expect(focusAfterAction("approve", "refused")[0]).toBe('[data-focus="approve"]');
    expect(focusAfterAction("decline", "done")[0]).toBe('[data-focus="approve"]');
    expect(focusAfterAction("decline", "refused")[0]).toBe('[data-focus="decline"]');
  });
});

describe("panelMayTakeFocus", () => {
  it("only from the body or from inside the panel, never from elsewhere on the page", () => {
    expect(panelMayTakeFocus(true, false)).toBe(true);
    expect(panelMayTakeFocus(false, true)).toBe(true);
    expect(panelMayTakeFocus(false, false)).toBe(false);
  });
});

// Fix round 2 (N-1): a temporary password that appears is focused, so its label and value are read out.
describe("focusOnPasswordShown", () => {
  it("the password field first (labelled, read with its value), then its Copy button", () => {
    expect(focusOnPasswordShown()).toEqual(["[data-temp-password]", '[data-focus="temp-copy"]']);
  });
});

// Fix round 2 (N-2): the discard question is invited to take focus from wherever the move away started.
describe("panelMayTakeFocus, invited", () => {
  it("an invited move (the discard question) may take focus from outside the panel, e.g. the row just picked", () => {
    expect(panelMayTakeFocus(false, false, true)).toBe(true);
    expect(panelMayTakeFocus(false, false, false)).toBe(false);
  });
});
