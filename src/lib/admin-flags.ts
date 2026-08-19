import type { RuleResult } from "./admin-users";

export interface FlagSpec {
  key: string;
  label: string;
  description: string;
  /** value flags render a text editor beside the switch (allowed_domain) */
  hasValue: boolean;
  /** non-null → turning this ON is refused, and this is the reason to print */
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
    // No domain-restriction claim here: isAllowedDomain is only ever called
    // from the credentials signUp path (src/server/auth/actions.ts). There is
    // no signIn callback anywhere in src/server/auth, so an Entra login is
    // filtered by nothing — not domain, not an existing User, not role. This
    // description is what an admin reads while deciding whether to want this
    // feature; claiming a fence that doesn't exist would be the lie, not the
    // fix, the moment someone wires the callback and forgets the domain check.
    description: "Offers Continue with Microsoft on the sign-in page. Domain restriction is not applied to this path.",
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

/**
 * The row as flagChange/flagChangeWarning need to see it, mirroring
 * TargetUser / roleChange(target, next, actorId) — the rule reads the row
 * plus the requested direction, not just the key, because "turn on" and
 * "turn off" are different questions for both flags this build knows about.
 * `value` is the flag's stored value already narrowed to a plain string (or
 * null); callers read it off `FeatureFlag.value`, which is `Json?`.
 */
export interface FlagState {
  key: string;
  enabled: boolean;
  value: string | null;
}

/**
 * One rule for both the page (which greys the row / disables the switch) and
 * the action (which refuses). Takes the direction because turning a
 * dangerous thing OFF is never the dangerous direction — this phase has hit
 * the same defect shape twice already (HANDOVER §8: the permanent-admin lock
 * refuses re-enabling that account exactly as it refuses disabling it, so the
 * one transition that repairs an out-of-band lockout is the one the rule
 * forbids; Task 3's self-disable Critical was the mirror image). A key-only
 * refusal here would make this a third: it would refuse turning OFF an
 * `m365_sso` row that got enabled out of band — hand-inserted, a restored
 * backup, an operator experimenting — which is exactly the repair scope
 * decision #7 needs to stay reachable.
 */
export function flagChange(state: FlagState, next: boolean): RuleResult {
  const spec = specFor(state.key);
  if (!spec) {
    return {
      allowed: false,
      reason: `This build doesn't recognise the flag "${state.key}", so it can't be changed here.`,
    };
  }
  if (spec.unavailable && next) {
    return { allowed: false, reason: spec.unavailable };
  }
  // allowed_domain, turned ON with nothing to enforce: FeatureFlag.value is
  // Json? with no default, so (enabled: true, value: null) is the resting
  // state of any deployment that bootstrapped without a domain — and
  // flagDomain (src/lib/auth-shared.ts) reads that as unrestricted. Enabling
  // with no value would make the switch claim a restriction signup doesn't
  // enforce, so this is refused on the way in rather than left to render a
  // lie once it's saved.
  if (spec.hasValue && next && !state.value?.trim()) {
    return {
      allowed: false,
      reason: "Set a domain first — an empty restriction lets any address sign up.",
    };
  }
  return { allowed: true };
}

/**
 * selfRoleChangeWarning's sibling: a consequence that's true before the
 * click, returned as one string so the page can state it pre-click and the
 * action can't compute a different answer. Only `allowed_domain` going OFF
 * has one — that's the direction that opens signup to any address on the
 * public internet; nothing else this module knows about needs a pre-click
 * warning (turning `allowed_domain` ON needs a value, which flagChange
 * already refuses without, and m365_sso carries its own `unavailable`
 * explanation rather than a warning).
 */
export function flagChangeWarning(state: FlagState, next: boolean): string | null {
  if (next || state.key !== "allowed_domain") return null;
  return "Turning this off lets anyone with any email address create an account.";
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
  // DNS caps a full name at 253 characters. This value is interpolated into
  // /signup and /login copy and stored in an uncapped Json column, so an
  // absurd length is a storage/rendering honesty concern, not a performance
  // one — the regex below has no catastrophic-backtracking exposure to guard
  // against.
  if (value.length > 253) {
    return { ok: false, reason: "That's too long for a domain — 253 characters max" };
  }
  // An ASCII whitelist, not merely "has a dot": this is what rejects a
  // Cyrillic-о homoglyph and the invisible Unicode format characters (Cf,
  // not Zs — trim() above only strips real whitespace, not these) that could
  // otherwise ride along in a pasted domain. The immunity comes from this
  // whitelist, not from the trim() call.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return { ok: false, reason: "That doesn't look like a domain — try thebackroomop.com" };
  }
  return { ok: true, value };
}
