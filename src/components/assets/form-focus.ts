import type { ActionResult } from "@/server/action-result";

/*
 * Phase 47 (Task 7 review, Important 1): where keyboard focus goes once a note, reply, resolve or upload settles. The
 * submit buttons disable while they work, which drops focus to <body>; these put it back somewhere useful. Plain
 * functions over small handles, so the node-only tests can check them without a DOM.
 */

type PostResult = ActionResult<{ id: string }> | null;

/** Something that can take focus (an element, or a test's stand-in). */
export interface Focusable { focus(): void }

/**
 * A note or reply's result landed. Saved: clear the box. Rate-limited: show the countdown. Either way focus goes back
 * to the box, ready for the next note — or for fixing the refused one, which stays in it.
 */
export function settleNoteResult(
  state: PostResult,
  h: { clear(): void; rateLimited(seconds: number): void; box: Focusable | null },
): void {
  if (!state) return;
  if (state.ok) h.clear();
  else if (state.kind === "rate_limited") h.rateLimited(state.retryAfterSec ?? 60);
  h.box?.focus();
}

/**
 * An upload's result landed. Saved: clear the staged file (its row and Upload button go away), announce
 * "Uploaded <name>" politely, and focus "Choose file" for the next one. Refused: the staged file and its Upload
 * button stay, and focus goes back to Upload.
 */
export function settleUploadResult(
  state: PostResult,
  fileName: string | null,
  h: {
    clear(): void;
    announce(text: string): void;
    rateLimited(seconds: number): void;
    choose: Focusable | null;
    upload: Focusable | null;
  },
): void {
  if (!state) return;
  if (state.ok) {
    h.clear();
    h.announce(fileName ? `Uploaded ${fileName}` : "Uploaded");
    h.choose?.focus();
    return;
  }
  if (state.kind === "rate_limited") h.rateLimited(state.retryAfterSec ?? 60);
  h.upload?.focus();
}

/** The data attribute that marks a thread's Mark resolved / Reopen button, so it can be found again after a refresh. */
export const RESOLVE_TOGGLE_ATTR = "data-resolve-toggle";

/**
 * After Mark resolved / Reopen and the refresh that follows, focus that thread's toggle again — re-found by its note
 * id, in case the refresh rendered it anew.
 */
export function focusResolveToggle(root: { querySelector(selector: string): unknown }, noteId: string): boolean {
  const el = root.querySelector(`[${RESOLVE_TOGGLE_ATTR}="${noteId.replace(/["\\]/g, "\\$&")}"]`) as Focusable | null;
  if (!el || typeof el.focus !== "function") return false;
  el.focus();
  return true;
}
