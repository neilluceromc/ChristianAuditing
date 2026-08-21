import { describe, expect, it } from "vitest";
import { flagDomain, isAllowedDomain, normalizeEmail } from "./auth-shared";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Neil@TheBackroomOp.com ")).toBe("neil@thebackroomop.com");
  });
  it("passes through already-normal input", () => {
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });
});

describe("isAllowedDomain", () => {
  it("accepts an exact domain match, case-insensitively", () => {
    expect(isAllowedDomain("neil@thebackroomop.com", "TheBackroomOp.com")).toBe(true);
  });
  it("rejects other domains", () => {
    expect(isAllowedDomain("neil@gmail.com", "thebackroomop.com")).toBe(false);
  });
  it("rejects subdomain lookalikes", () => {
    expect(isAllowedDomain("x@evil.thebackroomop.com", "thebackroomop.com")).toBe(false);
  });
  it("rejects strings without an @", () => {
    expect(isAllowedDomain("not-an-email", "thebackroomop.com")).toBe(false);
  });
  it("uses the LAST @ (quoted-local-part trick)", () => {
    expect(isAllowedDomain('"a@thebackroomop.com"@evil.com', "thebackroomop.com")).toBe(false);
  });
  it("allows everything when no domain is configured", () => {
    expect(isAllowedDomain("x@anywhere.io", null)).toBe(true);
    expect(isAllowedDomain("x@anywhere.io", undefined)).toBe(true);
    expect(isAllowedDomain("x@anywhere.io", "")).toBe(true);
  });
});

describe("flagDomain", () => {
  it("is null when there's no flag row", () => {
    expect(flagDomain(null)).toBeNull();
    expect(flagDomain(undefined)).toBeNull();
  });

  it("is null when the flag is disabled, even with a value already stored", () => {
    expect(flagDomain({ enabled: false, value: "thebackroomop.com" })).toBeNull();
  });

  // FeatureFlag.value is Json? with no default: (enabled: true, value: null)
  // is the resting state of a deployment that bootstrapped with no domain.
  // Without this check, every reader of the flag would treat that state as
  // "restricted" while isAllowedDomain treats it as wide open — the Critical
  // this function exists to close at every call site, not just one.
  it("is null for an enabled flag with no value, the state an un-configured bootstrap leaves behind", () => {
    expect(flagDomain({ enabled: true, value: null })).toBeNull();
  });

  it("is null when the stored value isn't a string", () => {
    expect(flagDomain({ enabled: true, value: 123 })).toBeNull();
    expect(flagDomain({ enabled: true, value: {} })).toBeNull();
    expect(flagDomain({ enabled: true, value: true })).toBeNull();
  });

  it("trims a stored value", () => {
    expect(flagDomain({ enabled: true, value: "  thebackroomop.com  " })).toBe("thebackroomop.com");
  });

  it("is null for an enabled flag whose value is blank after trimming", () => {
    expect(flagDomain({ enabled: true, value: "   " })).toBeNull();
  });

  it("returns the domain for a normal enabled flag", () => {
    expect(flagDomain({ enabled: true, value: "thebackroomop.com" })).toBe("thebackroomop.com");
  });
});
