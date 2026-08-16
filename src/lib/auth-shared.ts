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
