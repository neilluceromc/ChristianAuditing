/**
 * Every mutation returns this union (spec §5). The UI maps kinds onto the
 * designed states: rate_limited → amber countdown card, validation → inline
 * field errors, conflict → banner, forbidden → toast (the affordance should
 * not have rendered — this is the server refusing anyway).
 */
export type ActionErrorKind = "forbidden" | "rate_limited" | "validation" | "conflict";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: ActionErrorKind;
      message: string;
      /** kind === "validation": first message per field */
      fieldErrors?: Record<string, string>;
      /** kind === "rate_limited": seconds until the window frees up */
      retryAfterSec?: number;
    };

export const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });

export const forbidden = (): ActionResult<never> => ({
  ok: false,
  kind: "forbidden",
  message: "You don't have permission to do that.",
});

/**
 * `message` is an optional override (R-2, round 2): the default sentence
 * hardcodes "60 changes" and "this form still holds your input", both false
 * on a path whose cap isn't 60 or whose input isn't a form a browser
 * repopulates (a `<input type="file">` never re-shows a chosen file) — every
 * OTHER caller keeps the default unchanged.
 */
export const rateLimited = (retryAfterSec: number, message?: string): ActionResult<never> => ({
  ok: false,
  kind: "rate_limited",
  retryAfterSec,
  message:
    message ?? "You've made 60 changes this minute — the cap. Nothing was lost: this form still holds your input.",
});

export const validationError = (fieldErrors: Record<string, string>): ActionResult<never> => ({
  ok: false,
  kind: "validation",
  message: "Fix the highlighted fields.",
  fieldErrors,
});

export const conflict = (message: string): ActionResult<never> => ({
  ok: false,
  kind: "conflict",
  message,
});

/** zod → first message per field, for validationError(). */
export function zodFieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
