/**
 * Spec §7.2 (2026-10-21): the house search box filters as you type. This is its timing and bookkeeping, kept free of
 * React and the DOM so it can be tested on its own (`SearchBox` wires it up):
 * - a keystroke or a paste fires `submit` once, `debounceMs` after the last change; Enter fires at once (marked
 *   `enter`, which Inventory's scanner contract needs) and drops the pending one; Clear × fires "" at once;
 * - a pause that leaves the search as it already stands (back to it, or only spaces added) fires nothing;
 * - `onValue` tells the box whether a new URL `q` should replace what is typed: NOT when it is the URL catching up
 *   with a search the box itself sent (the person may have typed on since, and replacing the text would move the
 *   caret), YES when the search changed from elsewhere (Clear filters, Back, a link), which also drops a pending one.
 */

export const SEARCH_DEBOUNCE_MS = 300;

export interface LiveSearch {
  /** The text changed (a keystroke, a paste, the field's own clear). */
  input(text: string): void;
  /** Enter: submit now. */
  enter(text: string): void;
  /** Clear ×: submit "" now. */
  clear(): void;
  /** Drop a pending search (the box unmounted). */
  cancel(): void;
  /** The URL's q is now `value`: true when the box should show it instead of what is typed. */
  onValue(value: string): boolean;
}

export function createLiveSearch(opts: {
  initial: string;
  debounceMs: number;
  submit: (q: string, how: { enter: boolean }) => void;
  /**
   * Every keystroke (before the debounce), Enter and Clear ×. SearchBox passes `cancelStuckNavWatch` (Task 6 review
   * I2, final review M1): an earlier live search's stuck-navigation fallback must not reload the page over newer
   * typing or an Enter; the next search starts its own.
   */
  onInput?: () => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}): LiveSearch {
  const set = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clear = opts.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  /** the URL's q as last seen */
  let known = opts.initial.trim();
  /** searches sent and not yet seen come back in the URL, oldest first */
  let inFlight: string[] = [];
  let timer: unknown = null;

  const cancel = () => {
    if (timer !== null) clear(timer);
    timer = null;
  };
  /** the search that will be in force once everything sent has landed */
  const latest = () => inFlight[inFlight.length - 1] ?? known;
  const send = (q: string, enter: boolean) => {
    // Final review M2: back to the search the URL already shows (typed "a", then deleted it before "a" landed). The
    // URL won't change, so nothing sent before can be "seen come back" any more: dropping them keeps a later Back to
    // one of them (say ?q=a) from passing for this box's own echo, which would leave the box's text out of step.
    if (q === known) inFlight = [];
    else if (q !== latest()) inFlight.push(q);
    opts.submit(q, { enter });
  };

  return {
    input(text) {
      opts.onInput?.();
      cancel();
      timer = set(() => {
        timer = null;
        const q = text.trim();
        if (q !== latest()) send(q, false);
      }, opts.debounceMs);
    },
    enter(text) {
      // Final review M1: Enter supersedes a pending stuck-navigation watch too (Inventory's exact-tag lookup can take
      // longer than the watch has left); the navigation it starts gets its own.
      opts.onInput?.();
      cancel();
      send(text.trim(), true);
    },
    clear() {
      opts.onInput?.();
      cancel();
      if (latest() !== "") send("", false);
    },
    cancel,
    onValue(value) {
      const v = value.trim();
      if (v === known) return false;
      known = v;
      const i = inFlight.indexOf(v);
      if (i >= 0) {
        // our own search landing: it and everything sent before it are settled
        inFlight = inFlight.slice(i + 1);
        return false;
      }
      inFlight = [];
      cancel();
      return true;
    },
  };
}
