import { describe, expect, it } from "vitest";
import {
  FLAG_SPECS, domainValue, flagChange, flagChangeWarning, flagEnabled, specFor,
  type FlagSpec, type FlagState,
} from "./admin-flags";

const ssoOff: FlagState = { key: "m365_sso", enabled: false, value: null };
const ssoOn: FlagState = { key: "m365_sso", enabled: true, value: null };
const domainOff: FlagState = { key: "allowed_domain", enabled: false, value: null };
const domainOn: FlagState = { key: "allowed_domain", enabled: true, value: "thebackroomop.com" };
const domainOnNoValue: FlagState = { key: "allowed_domain", enabled: true, value: null };
const unknown: FlagState = { key: "arbitrary_key", enabled: false, value: null };

describe("FLAG_SPECS", () => {
  it("covers both seeded keys", () => {
    expect(FLAG_SPECS.map((f) => f.key).sort()).toEqual(["allowed_domain", "m365_sso"]);
  });

  it("gives every spec a label and a description, so no row renders a bare key", () => {
    for (const spec of FLAG_SPECS) {
      expect(spec.label).toBeTruthy();
      expect(spec.description).toBeTruthy();
    }
  });

  // The description is what an admin reads while deciding whether to want
  // this feature. isAllowedDomain is only ever called from the credentials
  // signUp path — there is no signIn callback anywhere, so an Entra login
  // isn't filtered by domain at all. Claiming otherwise would be read as a
  // fence that isn't there.
  it("does not claim m365_sso is domain-restricted, which isn't true", () => {
    const spec = specFor("m365_sso");
    expect(spec?.description).not.toMatch(/allowed domain/i);
  });
});

describe("specFor", () => {
  it("finds a known key", () => {
    expect(specFor("allowed_domain")?.hasValue).toBe(true);
  });

  it("returns null for a key this build doesn't know", () => {
    expect(specFor("something_someone_inserted")).toBeNull();
  });
});

describe("flagEnabled", () => {
  const domainSpec = specFor("allowed_domain")!;
  const ssoSpec = specFor("m365_sso")!;

  // The exact state flagDomain's own doc comment calls out: the resting state
  // of a deployment that bootstrapped without a domain. Reading raw
  // `row.enabled` here (rather than calling this function) is precisely the
  // regression HANDOVER §6a rule 15 exists to catch.
  it("hasValue flag: (enabled: true, value: null) reads as OFF", () => {
    expect(flagEnabled(domainSpec, { enabled: true, value: null })).toBe(false);
  });

  it("hasValue flag: an empty-string value reads as OFF", () => {
    expect(flagEnabled(domainSpec, { enabled: true, value: "" })).toBe(false);
  });

  it("hasValue flag: a whitespace-only value reads as OFF", () => {
    expect(flagEnabled(domainSpec, { enabled: true, value: "   " })).toBe(false);
  });

  it("hasValue flag: enabled with a real domain reads as ON", () => {
    expect(flagEnabled(domainSpec, { enabled: true, value: "example.com" })).toBe(true);
  });

  it("hasValue flag: a real value with enabled: false still reads as OFF", () => {
    expect(flagEnabled(domainSpec, { enabled: false, value: "example.com" })).toBe(false);
  });

  it("non-hasValue flag follows row.enabled directly", () => {
    expect(flagEnabled(ssoSpec, { enabled: true, value: null })).toBe(true);
    expect(flagEnabled(ssoSpec, { enabled: false, value: null })).toBe(false);
  });

  it("a missing or null row reads as OFF for both flag shapes", () => {
    expect(flagEnabled(domainSpec, undefined)).toBe(false);
    expect(flagEnabled(domainSpec, null)).toBe(false);
    expect(flagEnabled(ssoSpec, undefined)).toBe(false);
    expect(flagEnabled(ssoSpec, null)).toBe(false);
  });
});

describe("flagChange", () => {
  it("allows turning the domain restriction on when a value is already set", () => {
    expect(flagChange(domainOn, true)).toEqual({ allowed: true });
  });

  it("allows turning the domain restriction off, regardless of its value", () => {
    expect(flagChange(domainOn, false)).toEqual({ allowed: true });
    expect(flagChange(domainOnNoValue, false)).toEqual({ allowed: true });
  });

  // FeatureFlag.value is Json? with no default: (enabled: true, value: null)
  // is the resting state of a deployment that bootstrapped without a domain.
  // Enabling from there would render the switch ON beside "limits who may
  // create an account" while signup stays open to any address — the switch
  // would be lying. Only the "turn ON" direction is guarded; turning off
  // never needs a value.
  it("refuses turning the domain restriction on with no value set", () => {
    const res = flagChange(domainOnNoValue, true);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/set a domain/i);
    expect(res.allowed === false && res.reason).not.toMatch(/doesn't recognise/i);
    expect(res.allowed === false && res.reason).not.toMatch(/not wired|isn't wired/i);
  });

  it("refuses turning the domain restriction on with a whitespace-only value", () => {
    const res = flagChange({ key: "allowed_domain", enabled: true, value: "   " }, true);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/set a domain/i);
  });

  // Scope decision #7: auth/index.ts still carries TODO(sso-phase) — there is no
  // signIn callback mapping an Entra profile to a User row, so enabling this on a
  // deployment that HAS the env vars surfaces a button that authenticates and
  // lands a user with no role.
  it("refuses turning m365_sso on and explains that SSO isn't wired yet", () => {
    const res = flagChange(ssoOff, true);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/not wired|isn't wired|no role/i);
    expect(res.allowed === false && res.reason).not.toMatch(/set a domain/i);
    expect(res.allowed === false && res.reason).not.toMatch(/doesn't recognise/i);
  });

  // The Critical this fix addresses: a key-only refusal would also block
  // turning OFF an m365_sso row that got enabled out of band (hand-inserted,
  // a restored backup, an operator experimenting) — exactly the repair scope
  // decision #7 needs to stay reachable. Turning a dangerous thing off is
  // never the dangerous direction.
  it("allows turning m365_sso off even though it can't be turned on", () => {
    expect(flagChange(ssoOn, false)).toEqual({ allowed: true });
  });

  // The table is key-value: without this, /admin/flags writes arbitrary config.
  // Refused in both directions — unlike m365_sso, there is no legitimate row
  // behind an unrecognised key for an "off" transition to repair.
  it("refuses a key with no spec, in either direction", () => {
    const on = flagChange(unknown, true);
    const off = flagChange(unknown, false);
    expect(on.allowed).toBe(false);
    expect(on.allowed === false && on.reason).toMatch(/doesn't recognise|not a flag/i);
    expect(off.allowed).toBe(false);
    expect(off.allowed === false && off.reason).toMatch(/doesn't recognise|not a flag/i);
  });
});

describe("flagChangeWarning", () => {
  // The consequence of THIS direction: opens signup to any address on the
  // public internet. Stated pre-click so the page and the action can't
  // disagree about when it applies — selfRoleChangeWarning's sibling.
  it("warns when turning the domain restriction off", () => {
    expect(flagChangeWarning(domainOn, false)).toMatch(/any email address/i);
  });

  it("is null when turning the domain restriction on", () => {
    expect(flagChangeWarning(domainOff, true)).toBeNull();
  });

  it("is null for a flag other than allowed_domain, in either direction", () => {
    expect(flagChangeWarning(ssoOn, false)).toBeNull();
    expect(flagChangeWarning(ssoOff, true)).toBeNull();
  });

  it("is null for a key this build doesn't know", () => {
    expect(flagChangeWarning(unknown, false)).toBeNull();
  });

  it("returns each spec's own offWarning", () => {
    for (const spec of FLAG_SPECS) {
      const state: FlagState = { key: spec.key, enabled: true, value: "thebackroomop.com" };
      expect(flagChangeWarning(state, false)).toBe(spec.offWarning);
    }
  });

  // The one above only catches DRIFT between the spec and the function. This
  // one catches the structure: it registers a flag the function has never heard
  // of and requires the warning to follow, which a `key === "allowed_domain"`
  // branch cannot do however carefully its string is copied. That branch is
  // what this module started with, and reintroducing it is the regression —
  // the point of `offWarning` is that a new consequential flag is a line in
  // FLAG_SPECS and not an edit here.
  it("follows spec data for a flag added at runtime, not a hardcoded key", () => {
    const probe: FlagSpec = {
      key: "probe_flag",
      label: "Probe",
      description: "Registered by a test.",
      hasValue: false,
      unavailable: null,
      offWarning: "Probe consequence.",
    };
    FLAG_SPECS.push(probe);
    try {
      const state: FlagState = { key: "probe_flag", enabled: true, value: null };
      expect(flagChangeWarning(state, false)).toBe("Probe consequence.");
      expect(flagChangeWarning(state, true)).toBeNull();
    } finally {
      FLAG_SPECS.splice(FLAG_SPECS.indexOf(probe), 1);
    }
    expect(FLAG_SPECS.map((f) => f.key)).not.toContain("probe_flag");
  });
});

describe("domainValue", () => {
  it("accepts a plain domain and lowercases it", () => {
    expect(domainValue("  TheBackroomOp.com ")).toEqual({ ok: true, value: "thebackroomop.com" });
  });

  it("accepts a subdomain", () => {
    expect(domainValue("mail.thebackroomop.com")).toEqual({ ok: true, value: "mail.thebackroomop.com" });
  });

  // Asserted on the reason, not just `.ok`: the trailing domain-format check
  // would ALSO reject "someone@thebackroomop.com" (the "@" isn't a valid
  // domain character), so a mere `.ok === false` can't tell the dedicated
  // "@" check apart from that fallback catching the same input by accident.
  it("rejects an address rather than silently keeping the local part", () => {
    const res = domainValue("someone@thebackroomop.com");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/full address/i);
  });

  it("rejects a bare word with no dot", () => {
    expect(domainValue("localhost").ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(domainValue("   ").ok).toBe(false);
  });

  // Same trap as the address test above: the trailing domain-format check
  // would ALSO reject "https://thebackroomop.com" (":" and "/" aren't valid
  // domain characters either), so `.ok === false` alone can't tell the
  // dedicated scheme check apart from that fallback firing by coincidence.
  it("rejects a scheme", () => {
    const res = domainValue("https://thebackroomop.com");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/https:\/\//i);
  });

  it("rejects a domain longer than DNS's 253-character cap", () => {
    const res = domainValue(`${"a".repeat(250)}.com`); // 254 chars, otherwise well-formed
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/253|too long/i);
  });

  // The property that makes the final check safe is that it's an ASCII
  // WHITELIST, not "has a dot" or some other shape test — so a refactor that
  // "obviously" covers the address/scheme/bare-word cases with one looser
  // pattern (e.g. /^[^\s@:/]+\.[^\s@:/]+$/) would start accepting these three
  // and pass every other test in this file unchanged. The immunity is the
  // whitelist, not trim() — trim() only strips real whitespace (Zs/line
  // terminators), not the format characters (Cf) used below.
  it("rejects a domain containing a Cyrillic homoglyph, not just a Latin lookalike", () => {
    // "thebackrоomop.com" reads as thebackroomop.com but the 'о' after
    // "backr" is CYRILLIC SMALL LETTER O (U+043E), not Latin 'o'.
    expect(domainValue("thebackrоomop.com").ok).toBe(false);
  });

  it("rejects a domain carrying a zero-width space", () => {
    expect(domainValue("thebackroomop​.com").ok).toBe(false);
  });

  it("rejects a domain carrying a trailing word joiner", () => {
    expect(domainValue("thebackroomop.com⁠").ok).toBe(false);
  });

  it("rejects a trailing dot, which exact comparison would otherwise silently lock everyone out", () => {
    expect(domainValue("thebackroomop.com.").ok).toBe(false);
  });
});
