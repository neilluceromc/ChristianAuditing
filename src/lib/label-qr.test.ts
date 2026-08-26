import { describe, expect, it } from "vitest";
import { qrBase, qrUrlFor } from "./label-qr";

describe("qrBase", () => {
  it("accepts a hostname base and keeps its port", () => {
    expect(qrBase("http://inventory.backroom.local:3000")).toEqual({
      ok: true,
      prefix: "http://inventory.backroom.local:3000",
    });
  });

  it("accepts https", () => {
    expect(qrBase("https://inventory.example.com")).toEqual({
      ok: true,
      prefix: "https://inventory.example.com",
    });
  });

  // A trailing slash is normalised, not refused: it is the single most likely
  // way a human writes this value, and refusing it would print no QR at all.
  it("normalises a trailing slash", () => {
    expect(qrBase("http://host:3000/")).toEqual({ ok: true, prefix: "http://host:3000" });
    expect(qrBase("http://host:3000///")).toEqual({ ok: true, prefix: "http://host:3000" });
  });

  // A sub-path deployment must survive: dropping the path would 404 every scan.
  it("preserves a base path", () => {
    expect(qrBase("http://host:3000/inv/")).toEqual({ ok: true, prefix: "http://host:3000/inv" });
  });

  it("refuses an unset or blank value", () => {
    expect(qrBase(undefined)).toEqual({ ok: false, reason: "unset" });
    expect(qrBase("")).toEqual({ ok: false, reason: "unset" });
    expect(qrBase("   ")).toEqual({ ok: false, reason: "unset" });
  });

  // "inventory.local:3000" parses as scheme "inventory.local:" with path
  // "3000" — it is not a bare host, and a QR built from it would be dead.
  it("refuses a value with no http(s) scheme", () => {
    expect(qrBase("inventory.local:3000")).toEqual({ ok: false, reason: "not-absolute" });
    expect(qrBase("ftp://host")).toEqual({ ok: false, reason: "not-absolute" });
  });

  it("refuses something that is not a URL at all", () => {
    expect(qrBase("http://")).toEqual({ ok: false, reason: "bad-url" });
  });

  // THE defect this module exists to prevent: a QR that works on the dev
  // machine and is dead on every phone.
  it("refuses loopback in all its spellings", () => {
    for (const base of [
      "http://localhost:3000",
      "http://LOCALHOST:3000",
      "http://127.0.0.1:3000",
      "http://127.1.2.3:3000",
      "http://[::1]:3000",
      "http://0.0.0.0:3000",
      "http://[::]:3000",
      "http://dev.localhost:3000",
      // Trailing DNS root dot. `new URL` canonicalises it away for an IPv4
      // literal but keeps it on a domain name, so these two slipped past the
      // guard while `http://0.0.0.0.:3000` never did.
      "http://localhost.:3000",
      "http://dev.localhost.:3000",
      "http://0.0.0.0.:3000",
      "http://127.0.0.1.:3000",
    ]) {
      expect(qrBase(base), base).toEqual({ ok: false, reason: "loopback" });
    }
  });

  // The prefix-matching bug: all three are ordinary domain names that merely
  // begin with "127." — 127.co is a real purchasable domain.
  it("does not mistake a domain that starts with 127. for loopback", () => {
    for (const base of ["http://127.co", "http://127.evil.com", "http://127.0.0.1.evil.com"]) {
      expect(qrBase(base), base).toEqual({ ok: true, prefix: base });
    }
  });

  // A host that merely CONTAINS "localhost" is a different machine entirely.
  it("accepts a real host whose name contains localhost", () => {
    expect(qrBase("http://localhost.evil.com")).toEqual({
      ok: true,
      prefix: "http://localhost.evil.com",
    });
  });
});

describe("qrUrlFor", () => {
  it("builds the exact-tag search URL the redirect already handles", () => {
    expect(qrUrlFor("BR-LT-0166", { prefix: "http://host:3000" })).toBe(
      "http://host:3000/inventory?q=BR-LT-0166",
    );
  });

  it("percent-encodes a tag that would otherwise break the query", () => {
    expect(qrUrlFor("BR LT/0166", { prefix: "http://host:3000" })).toBe(
      "http://host:3000/inventory?q=BR%20LT%2F0166",
    );
  });
});
