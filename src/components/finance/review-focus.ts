/**
 * Finance follow-up (Task 3 fix round 1): where focus goes after an admin reopens a review. The Reopen button goes
 * away with the refresh (the asset is no longer approved), so the dialog's focus-return target is gone; the review box
 * that replaces it takes focus instead. If it never mounts, focus falls back to the page's main region rather than
 * being left on the body.
 */
let wanted = false;

/** Ask the next review box that mounts to take focus; after `fallbackMs` with no taker, focus #main if focus was lost. */
export function requestReviewFocus(fallbackMs = 3000): void {
  wanted = true;
  setTimeout(() => {
    if (!wanted) return;
    wanted = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) document.getElementById("main")?.focus();
  }, fallbackMs);
}

/** The review box, on mount: true (once) when it should take focus. */
export function takeReviewFocus(): boolean {
  const w = wanted;
  wanted = false;
  return w;
}
