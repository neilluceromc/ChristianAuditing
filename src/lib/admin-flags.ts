import type { RuleResult } from "./admin-users";

export interface FlagSpec {
  key: string;
  label: string;
  description: string;
  /** value flags render a text editor beside the switch (allowed_domain) */
  hasValue: boolean;
  /** non-null → the switch is not usable, and this is the reason to print */
  unavailable: string | null;
}

/**
 * The allowlist. `FeatureFlag` is a key-value table, so without this the flags
 * page is an arbitrary writer into application configuration — a row someone
 * inserted by hand would render with an editable switch and no meaning.
 */
export const FLAG_SPECS: FlagSpec[] = [
  {
    key: "m365_sso",
    label: "Microsoft 365 sign-in",
    description:
      "Offers Continue with Microsoft on the sign-in page, for accounts in the allowed domain.",
    hasValue: false,
    // Scope decision #7. src/server/auth/index.ts registers the Entra provider
    // whenever three env vars are present, but carries TODO(sso-phase): there is
    // no signIn callback resolving an Entra profile to a User row. So on the one
    // deployment that has configured the env vars, flipping this switch produces
    // a button that authenticates and then lands a user carrying no role.
    // Wiring SSO needs real tenant credentials; when they exist, the work is that
    // callback plus deleting this string.
    unavailable:
      "Single sign-on isn't wired up yet — an Entra login would arrive with no role attached, so this switch stays off until that callback exists.",
  },
  {
    key: "allowed_domain",
    label: "Signup domain restriction",
    description:
      "Limits who may create an account. Turn it off and any email address can sign up.",
    hasValue: true,
    unavailable: null,
  },
];

export function specFor(key: string): FlagSpec | null {
  return FLAG_SPECS.find((f) => f.key === key) ?? null;
}

/** One rule for both the page (which greys the row) and the action (which refuses). */
export function flagChange(key: string): RuleResult {
  const spec = specFor(key);
  if (!spec) {
    return {
      allowed: false,
      reason: `This build doesn't recognise the flag "${key}", so it can't be changed here.`,
    };
  }
  return spec.unavailable ? { allowed: false, reason: spec.unavailable } : { allowed: true };
}

export type DomainResult = { ok: true; value: string } | { ok: false; reason: string };

/**
 * `allowed_domain` is compared against the part of an address after the "@"
 * (src/lib/auth-shared.ts), so storing "someone@example.com" or "https://…"
 * silently locks everyone out rather than failing loudly. Normalise and refuse.
 */
export function domainValue(raw: string): DomainResult {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, reason: "Enter a domain, e.g. thebackroomop.com" };
  if (value.includes("@")) {
    return { ok: false, reason: "Just the domain, not a full address — thebackroomop.com" };
  }
  if (value.includes("/") || value.includes(":")) {
    return { ok: false, reason: "Just the domain, with no https:// in front of it" };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return { ok: false, reason: "That doesn't look like a domain — try thebackroomop.com" };
  }
  return { ok: true, value };
}
