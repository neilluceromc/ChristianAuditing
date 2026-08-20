import { describe, expect, it } from "vitest";
import { SIGNATURE_HEADER, signPayload } from "./sign";

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
