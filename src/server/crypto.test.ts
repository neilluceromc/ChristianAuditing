import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const AAD = "asset-1:bios";

describe("secret crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips plaintext and never stores it verbatim", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const ct = encryptSecret("wifi: hunter2", AAD);
    expect(ct).not.toContain("hunter2");
    expect(decryptSecret(ct, AAD)).toBe("wifi: hunter2");
  });

  it("pins the wire format: base64(version || 12-byte iv || 16-byte tag || data)", async () => {
    const { encryptSecret } = await import("./crypto");
    const raw = Buffer.from(encryptSecret("abc", AAD), "base64");
    expect(raw.length).toBe(1 + 12 + 16 + 3);
    expect(raw[0]).toBe(1); // version byte
  });

  it("produces a fresh IV every call", async () => {
    const { encryptSecret } = await import("./crypto");
    expect(encryptSecret("x", AAD)).not.toBe(encryptSecret("x", AAD));
  });

  it("rejects tampered ciphertext (GCM auth tag)", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const raw = Buffer.from(encryptSecret("x", AAD), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSecret(raw.toString("base64"), AAD)).toThrow();
  });

  it("binds ciphertext to its row: decrypting under another row's AAD fails", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const ct = encryptSecret("hunter2", "asset-1:bios");
    expect(() => decryptSecret(ct, "asset-2:bios")).toThrow();
  });

  it("rejects unknown versions and truncated input", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const raw = Buffer.from(encryptSecret("x", AAD), "base64");
    raw[0] = 9;
    expect(() => decryptSecret(raw.toString("base64"), AAD)).toThrow(/Unsupported/);
    expect(() => decryptSecret(Buffer.from([1, 2, 3]).toString("base64"), AAD)).toThrow(/Unsupported/);
  });

  it("refuses to run without a 32-byte key", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "dG9vLXNob3J0");
    const { encryptSecret } = await import("./crypto");
    expect(() => encryptSecret("x", AAD)).toThrow(/32 bytes/);
  });
});
