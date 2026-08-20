import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { SIGNATURE_HEADER, newSecret, secretAad, signPayload } from "./sign";

const AT = new Date("2026-08-19T02:00:00Z"); // t = 1787104800

describe("signPayload", () => {
  it("is t=<seconds>,v1=<64-hex>, so a receiver can find the timestamp without parsing hex", () => {
    const sig = signPayload('{"a":1}', "shhh", AT);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  // Golden vectors: computed from this exact implementation and pasted as
  // literals, so a refactor that changes the signed-string construction (key
  // encoding, body encoding, separator, field order) is caught even though it
  // would still pass every property-style assertion below.
  it("matches a pinned vector for a fixed body, secret and instant", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).toBe(
      "t=1787104800,v1=92d5a4bc4967ee6f3cd0906c63e8ab7aea6590005270d3642812deade4d29504",
    );
  });

  it("matches a pinned vector for a non-ASCII body, pinning the UTF-8 encoding", () => {
    expect(signPayload('{"msg":"café"}', "shhh", AT)).toBe(
      "t=1787104800,v1=eb0b7a92544e2a68a322bc1b42f0815ecbc8fa8bb99b061646304d28b90cf09a",
    );
  });

  it("is stable for the same body, secret and instant", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).toBe(signPayload('{"a":1}', "shhh", AT));
  });

  it("changes when the body changes", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).not.toBe(signPayload('{"a":2}', "shhh", AT));
  });

  // The whole point of a signing secret: a receiver that checks the signature
  // can tell our POST from anyone else's.
  it("changes when the secret changes", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).not.toBe(signPayload('{"a":1}', "other", AT));
  });

  // The whole point of THIS change: a replayed request — same body, same
  // secret — must sign differently once time has moved on, or a captured
  // request stays valid forever. Comparing the DIGEST alone (not the whole
  // header) matters: the header's visible `t=` field always differs between
  // two instants regardless of what got hashed, so a version that hashed
  // only the body — dropping `t` from the signed string — would still pass
  // a whole-string comparison. Only the digest tells you `t` was actually
  // part of what got signed.
  it("changes the v1 digest when the signing instant changes, even with the same body and secret", () => {
    const later = new Date(AT.getTime() + 5 * 60_000);
    const digest = (sig: string) => sig.split(",v1=")[1];
    expect(digest(signPayload('{"a":1}', "shhh", AT)))
      .not.toBe(digest(signPayload('{"a":1}', "shhh", later)));
  });

  it("names the header once, so the worker and the docs can't drift", () => {
    expect(SIGNATURE_HEADER).toBe("x-backroom-signature");
  });
});

describe("secretAad", () => {
  // The pin that matters: `secretAad` is a one-line function with no other
  // caller in this test file to catch a drift, and a rename of its prefix —
  // or a Task 10 implementer independently reconstructing the AAD as
  // `decryptSecret(endpoint.secret, endpoint.id)` instead of importing this
  // function — typechecks, lints, and would pass every other test in this
  // suite while making every PRE-EXISTING endpoint's secret permanently
  // undecryptable (new rows would still round-trip, since createEndpoint and
  // its own decrypt-caller would agree on whatever the new prefix is).
  it("is exactly webhook:<id> — not webhook-endpoint:<id> or the bare id", () => {
    expect(secretAad("abc")).toBe("webhook:abc");
  });

  describe("bound to encryptSecret/decryptSecret", () => {
    beforeEach(() => {
      vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    });
    afterEach(() => vi.unstubAllEnvs());

    it("round-trips a secret encrypted under its own endpoint's AAD", () => {
      const ct = encryptSecret("s3cr3t", secretAad("endpoint-1"));
      expect(decryptSecret(ct, secretAad("endpoint-1"))).toBe("s3cr3t");
    });

    it("refuses to decrypt under a different endpoint's AAD — the whole point of binding it", () => {
      const ct = encryptSecret("s3cr3t", secretAad("endpoint-1"));
      expect(() => decryptSecret(ct, secretAad("endpoint-2"))).toThrow();
    });
  });
});

describe("newSecret", () => {
  // 32 bytes (256 bits) of node:crypto randomBytes, base64url-encoded without
  // padding: 43 characters from the base64url alphabet. A slip to, say,
  // `randomBytes(8)` still returns a string and passes every other test in
  // this file and every test in webhook-actions.ts's callers — this shape
  // assertion is the only thing that catches it.
  it("returns 256 bits as 43 base64url characters", () => {
    expect(newSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns a fresh value every call", () => {
    expect(newSecret()).not.toBe(newSecret());
  });
});
