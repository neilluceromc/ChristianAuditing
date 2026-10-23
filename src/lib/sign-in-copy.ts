/**
 * Users & access (spec §4.6): the sign-in form's refusals, verbatim. PENDING and DECLINED are shown only after the
 * right password, so neither tells a stranger that an account exists; the pause is shown for any email.
 */
export const SIGN_IN_COPY = {
  wrong: "Wrong email or password — or the account is disabled.",
  paused: "Too many tries — wait 15 minutes or ask an admin to reset your password.",
  pending: "Your account is waiting for an admin to approve it.",
  declined: "Your sign-up wasn't approved. Ask an admin if you think this is a mistake.",
} as const;
