import { describe, expect, it } from "vitest";
import { isAllowedDomain, normalizeEmail } from "./auth-shared";

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
