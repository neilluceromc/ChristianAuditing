/*
 * Users & access (Task 4 fix round 1, I-1; WCAG 2.4.3): where focus goes in the details panel as its inline steps open
 * and close, and after an action settles. Pure, as the Worklist's focusAfterDecision is, so the targets are pinned by
 * tests without a DOM; the panel focuses the first selector that matches something focusable inside itself.
 *
 * Every target carries `data-focus="<name>"`; the switch's is on its wrapper.
 */

/** An inline step that opens inside the panel. */
export type PanelStep = "turn-off" | "decline" | "edit" | "pick" | "discard";

/** An action whose answer comes back later (the row refreshes, or a refusal shows). */
export type PanelAction = "save" | "turn-off" | "turn-on" | "approve" | "decline";

export const focusSel = (name: string) => `[data-focus="${name}"]`;
const SWITCH = `${focusSel("switch")} [role="switch"]`;
const TITLE = focusSel("title");

/** Opening a step: its first control. The confirms put Cancel first, so a stray Enter never confirms. */
export function focusOnOpen(step: PanelStep): string[] {
  switch (step) {
    case "turn-off": return [focusSel("turn-off-cancel")];
    case "decline": return [focusSel("decline-cancel")];
    case "edit": return [focusSel("name")];
    case "pick": return [focusSel("pick-search")];
    case "discard": return [focusSel("keep-editing")];
  }
}

/** Closing a step without an action (Cancel, Keep editing, a pick, Discard): back to the control that opened it. */
export function focusOnClose(step: PanelStep): string[] {
  switch (step) {
    case "turn-off": return [SWITCH];
    case "decline": return [focusSel("decline"), focusSel("approve")];
    case "edit": return [focusSel("edit"), TITLE];
    case "pick": return [focusSel("pick"), TITLE];
    case "discard": return [focusSel("save"), TITLE];
  }
}

/**
 * After an action's answer: done (the row refreshed) or refused (a notice showed). A refused save goes to the first
 * invalid field; a turned account back to its switch; an approved sign-up, whose panel changes shape, to the heading.
 */
export function focusAfterAction(action: PanelAction, outcome: "done" | "refused"): string[] {
  switch (action) {
    case "save": return outcome === "done" ? [focusSel("edit"), TITLE] : ['[aria-invalid="true"]', focusSel("save"), TITLE];
    case "turn-off":
    case "turn-on": return [SWITCH, TITLE];
    case "approve": return outcome === "done" ? [TITLE] : [focusSel("approve"), TITLE];
    case "decline": return outcome === "done" ? [focusSel("approve"), TITLE] : [focusSel("decline"), focusSel("approve"), TITLE];
  }
}

/**
 * Fix round 2 (N-1): a temporary password just shown (Reset's second step, Add user's created step). The labelled
 * read-only field first, so the label and the password are read out; its Copy button if the field can't take focus.
 */
export function focusOnPasswordShown(): string[] {
  return ["[data-temp-password]", focusSel("temp-copy")];
}

/**
 * May the panel move focus now? Only when focus is lost (on the page body) or already inside the panel: never out of
 * the search box or another row the person has moved on to — unless the move is `invited` (fix round 2, N-2): the
 * discard question raised by that very pick, which has to be answered before the page can move on.
 */
export function panelMayTakeFocus(activeIsBody: boolean, activeInPanel: boolean, invited = false): boolean {
  return invited || activeIsBody || activeInPanel;
}
