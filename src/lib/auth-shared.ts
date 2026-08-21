export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * allowedDomain comes from the allowed_domain feature flag's value when the
 * flag is enabled; null/undefined/"" means unrestricted. Matching is exact
 * on the text after the LAST @ — subdomains are different domains.
 */
export function isAllowedDomain(
  email: string,
  allowedDomain: string | null | undefined,
): boolean {
  if (!allowedDomain) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === allowedDomain.toLowerCase();
}

/**
 * The one expression for "is allowed_domain actually enforced right now" —
 * every reader of the flag (login page, signup page, the signUp gate itself)
 * must compute the SAME thing, or the admin page can describe a stricter
 * reality than the gate enforces. `enabled` alone isn't the answer:
 * `FeatureFlag.value` is `Json?` with no default, so `(enabled: true, value:
 * null)` is the resting state of any deployment that bootstrapped without a
 * domain, and would otherwise read as "restricted" while isAllowedDomain
 * treats it as wide open. The trim defends the same read against `(enabled:
 * true, value: "")` or `(… value: "   ")` — not reachable through this
 * build's own write path once admin-flags.ts's flagChange guards it, but a
 * value can still arrive here from psql or a future migration.
 */
export function flagDomain(
  flag: { enabled: boolean; value: unknown } | null | undefined,
): string | null {
  if (!flag?.enabled || typeof flag.value !== "string") return null;
  const trimmed = flag.value.trim();
  return trimmed ? trimmed : null;
}
