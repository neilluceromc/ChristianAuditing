import { describe, expect, it } from "vitest";
import { FLAG_SPECS, domainValue, flagChange, specFor } from "./admin-flags";

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
});

describe("specFor", () => {
  it("finds a known key", () => {
    expect(specFor("allowed_domain")?.hasValue).toBe(true);
  });

  it("returns null for a key this build doesn't know", () => {
    expect(specFor("something_someone_inserted")).toBeNull();
  });
});

describe("flagChange", () => {
  it("allows the domain restriction", () => {
    expect(flagChange("allowed_domain")).toEqual({ allowed: true });
  });

  // Scope decision #7: auth/index.ts still carries TODO(sso-phase) — there is no
  // signIn callback mapping an Entra profile to a User row, so enabling this on a
  // deployment that HAS the env vars surfaces a button that authenticates and
  // lands a user with no role.
  it("refuses m365_sso and explains that SSO isn't wired yet", () => {
    const res = flagChange("m365_sso");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/not wired|isn't wired|no role/i);
  });

  // The table is key-value: without this, /admin/flags writes arbitrary config.
  it("refuses a key with no spec", () => {
    const res = flagChange("arbitrary_key");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/doesn't recognise|not a flag/i);
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

  it("rejects a scheme", () => {
    expect(domainValue("https://thebackroomop.com").ok).toBe(false);
  });
});
