/**
 * Phase 40 (spec §5): how long a toast stays. Pure, so the rule and the pause-aware timer are tested without a DOM.
 *  - an error stays until the person dismisses it (null: no timer at all);
 *  - a success or neutral toast leaves after 4 s, 8 s when it carries a button (Undo) so the button can be reached;
 *  - the countdown pauses while the toast is hovered or holds focus, and resumes with the time that was left.
 */
export type ToastTone = "settled" | "fault" | "neutral";

export const TOAST_MS = 4000;
export const ACTION_TOAST_MS = 8000;

/** Milliseconds a toast stays on screen, or null when it stays until dismissed. */
export function toastLifetime(tone: ToastTone, hasAction = false): number | null {
  if (tone === "fault") return null;
  return hasAction ? ACTION_TOAST_MS : TOAST_MS;
}

export interface PausableTimer {
  pause(): void;
  resume(): void;
  cancel(): void;
  /** milliseconds left (the full lifetime until it first runs down, 0 once finished) */
  remaining(): number;
}

/** A one-shot timer that can be paused and resumed; `onDone` fires once, when the time left runs out while running. */
export function createPausableTimer(ms: number, onDone: () => void): PausableTimer {
  let left = ms;
  let startedAt = 0;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const run = () => {
    if (finished || handle !== null) return;
    startedAt = Date.now();
    handle = setTimeout(() => {
      handle = null;
      finished = true;
      left = 0;
      onDone();
    }, left);
  };
  const stop = () => {
    if (handle === null) return;
    clearTimeout(handle);
    handle = null;
    left = Math.max(0, left - (Date.now() - startedAt));
  };
  run();

  return {
    pause: stop,
    resume: run,
    cancel() {
      stop();
      finished = true;
    },
    remaining: () => (handle === null ? left : Math.max(0, left - (Date.now() - startedAt))),
  };
}

/**
 * Where focus goes when the toast that holds it is removed (house rule: focus is never lost to the body): the first
 * candidate that is still usable, in the order given — the next toast's Dismiss, the element that had focus before it
 * entered the toasts, then the page's main region. Null only when none is usable.
 */
export function firstUsable<T>(candidates: ReadonlyArray<T | null | undefined>, usable: (candidate: T) => boolean): T | null {
  for (const c of candidates) if (c != null && usable(c)) return c;
  return null;
}
