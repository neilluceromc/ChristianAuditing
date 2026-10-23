/**
 * Users & access (spec §4.3): the rules for any new password, one function for the server and the live checklist.
 * - at least 10 characters;
 * - letters and at least one number;
 * - not the same as the current password, or the temporary one.
 * Pure and client-safe. The server also compares against the stored hash where the plain text isn't known (the
 * temporary password at first sign-in), because the browser never sees it.
 */

export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordChecks {
  /** at least 10 characters */
  long: boolean;
  /** at least one letter and at least one number */
  mixed: boolean;
  /** not the current password, nor the temporary one (false while empty, so an empty field ticks nothing) */
  fresh: boolean;
}

export interface PasswordContext {
  current?: string;
  temporary?: string;
}

export const PASSWORD_COPY = {
  long: "Password must be at least 10 characters.",
  mixed: "Password must use letters and at least one number.",
  sameAsCurrent: "Choose a new password, not your current one.",
  sameAsTemporary: "Choose your own password, not the temporary one.",
  mismatch: "The two passwords don't match.",
  /** Account settings (spec §4.5), verbatim */
  wrongCurrent: "That isn't your current password",
} as const;

/** Account settings, after saving (spec §4.5), verbatim. */
export const PASSWORD_CHANGED_COPY = "Password changed. You stay signed in here; your other devices are signed out.";

/** The checklist's labels, in the order the rules are checked. */
export const PASSWORD_RULE_LABELS = {
  long: "At least 10 characters",
  mixed: "Letters and at least one number",
} as const;

export function passwordChecks(pw: string, { current, temporary }: PasswordContext): PasswordChecks {
  return {
    long: pw.length >= PASSWORD_MIN_LENGTH,
    mixed: /\p{L}/u.test(pw) && /\p{Nd}/u.test(pw),
    fresh: pw.length > 0 && pw !== current && pw !== temporary,
  };
}

/** The first rule the password breaks, as a sentence for the field; null when it meets them all. */
export function passwordProblem(pw: string, context: PasswordContext): string | null {
  const c = passwordChecks(pw, context);
  if (!c.long) return PASSWORD_COPY.long;
  if (!c.mixed) return PASSWORD_COPY.mixed;
  if (!c.fresh) return pw === context.current ? PASSWORD_COPY.sameAsCurrent : PASSWORD_COPY.sameAsTemporary;
  return null;
}
