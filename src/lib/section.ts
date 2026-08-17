/**
 * Brief §7: "Every section degrades independently — if one query fails the rest
 * of the page still renders. Design the degraded state, not just the happy one."
 *
 * The loader is wrapped here rather than behind a React error boundary because
 * this is the failure the design is about — a query that didn't come back —
 * and because a typed result is testable without a browser.
 */
export type SectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; label: string; message: string };

export async function safeSection<T>(
  label: string,
  run: () => Promise<T> | T,
): Promise<SectionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    // the real error stays server-side; the card shows a sentence a person can act on
    console.error(`[home] section "${label}" failed:`, err);
    return { ok: false, label, message: "This section couldn't load." };
  }
}
