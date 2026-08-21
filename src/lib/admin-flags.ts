import type { RuleResult } from "./admin-users";
import { flagDomain } from "./auth-shared";

export interface FlagSpec {
  key: string;
  label: string;
  description: string;
  /** value flags render a text editor beside the switch (allowed_domain) */
  hasValue: boolean;
  /** non-null → turning this ON is refused, and this is the reason to print */
  unavailable: string | null;
  /**
   * non-null → turning this OFF is allowed but consequential, and this is the
   * sentence to state before the click. Spec data rather than a branch in
   * `flagChangeWarning`, for the same reason `unavailable` is: the consequence
   * belongs to the individual flag, and it is NOT derivable from `hasValue` —
   * a future value flag could be a numeric threshold whose off state widens
   * nothing, and attaching this sentence to it would be a new lie.
   */
  offWarning: string | null;
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
    // Nothing to warn about: it cannot be on in the first place, and if a row
    // arrived enabled out of band then turning it off is the repair, not a risk.
    offWarning: null,
  },
  {
    key: "allowed_domain",
    label: "Signup domain restriction",
    description:
      "Limits who may create an account. Turn it off and any email address can sign up.",
    hasValue: true,
    unavailable: null,
    offWarning: "Turning this off lets anyone with any email address create an account.",
  },
];

export function specFor(key: string): FlagSpec | null {
  return FLAG_SPECS.find((f) => f.key === key) ?? null;
}

/**
 * The one expression for "does this flag's switch show as ON" — every reader
 * that summarizes a flag's on/off state (listFlags, adminHome, and any future
 * one) must call this rather than re-deriving it from `row.enabled` and
 * `spec.hasValue` separately. For a `hasValue` flag (allowed_domain today),
 * ON means flagDomain resolves a real, enforced value — NOT the raw `enabled`
 * column: `(enabled: true, value: null)` is the resting state of a deployment
 * that bootstrapped without a domain (see flagDomain's own comment), and
 * `row.enabled` alone would read that as restricted while /signup enforces
 * nothing. HANDOVER §6a rule 15: a switch must not be able to claim a
 * restriction that isn't enforced — this was already hand-rolled by three
 * readers before it existed; adding a fourth divergent copy is the mistake
 * this function exists to prevent.
 */
export function flagEnabled(
  spec: FlagSpec,
  row: { enabled: boolean; value: unknown } | null | undefined,
): boolean {
  return spec.hasValue ? flagDomain(row) !== null : row?.enabled ?? false;
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
 * selfRoleChangeWarning's sibling: a consequence that's true before the click,
 * returned as one string so the page states it pre-click and the action cannot
 * compute a different answer. Reads `spec.offWarning` rather than testing the
 * key, so adding a flag with a consequential off state is a line in FLAG_SPECS
 * and not a branch here.
 *
 * Only the OFF direction has warnings today. Turning something ON is either
 * refused outright (`unavailable`, or `allowed_domain` with no value) or
 * unremarkable, and a refusal is not a warning — flagChange owns that.
 */
export function flagChangeWarning(state: FlagState, next: boolean): string | null {
  if (next) return null;
  return specFor(state.key)?.offWarning ?? null;
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
