import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

describe("secret crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips plaintext and never stores it verbatim", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const ct = encryptSecret("wifi: hunter2");
    expect(ct).not.toContain("hunter2");
    expect(decryptSecret(ct)).toBe("wifi: hunter2");
  });
  it("produces a fresh IV every call", async () => {
    const { encryptSecret } = await import("./crypto");
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("rejects tampered ciphertext (GCM auth tag)", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const raw = Buffer.from(encryptSecret("x"), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });
  it("refuses to run without a 32-byte key", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "dG9vLXNob3J0");
    const { encryptSecret } = await import("./crypto");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
