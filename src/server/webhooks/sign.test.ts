import { describe, expect, it } from "vitest";
import { SIGNATURE_HEADER, signPayload } from "./sign";

describe("signPayload", () => {
  it("is a prefixed hex HMAC-SHA256, so a consumer can tell the scheme apart", () => {
    const sig = signPayload('{"a":1}', "shhh");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is stable for the same body and secret", () => {
    expect(signPayload('{"a":1}', "shhh")).toBe(signPayload('{"a":1}', "shhh"));
  });

  it("changes when the body changes", () => {
    expect(signPayload('{"a":1}', "shhh")).not.toBe(signPayload('{"a":2}', "shhh"));
  });

  // The whole point of a signing secret: a receiver that checks the signature
  // can tell our POST from anyone else's.
  it("changes when the secret changes", () => {
    expect(signPayload('{"a":1}', "shhh")).not.toBe(signPayload('{"a":1}', "other"));
  });

  it("names the header once, so the worker and the docs can't drift", () => {
    expect(SIGNATURE_HEADER).toBe("x-backroom-signature");
  });
});
