import { describe, expect, it } from "vitest";
import { cleanReason, REASON_MESSAGE, reasonOptional, reasonRequired } from "./reason";

describe("cleanReason (spec §6)", () => {
  it("strips zero-width characters to nothing", () => {
    expect(cleanReason("​​​")).toBe("");
  });
  it("strips invisible characters from the middle and trims the rest", () => {
    expect(cleanReason(" ​ok⁠ ")).toBe("ok");
  });
  it("leaves ordinary text untouched", () => {
    expect(cleanReason("ab")).toBe("ab");
  });
});

describe("reasonRequired (spec §6)", () => {
  it("refuses a reason that is only invisible characters, with REASON_MESSAGE", () => {
    const result = reasonRequired().safeParse("​​​​");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(REASON_MESSAGE);
    }
  });
  it("cleans invisible characters before accepting", () => {
    expect(reasonRequired().parse("​fix​")).toBe("fix");
  });
  it("honors a custom min and message", () => {
    const result = reasonRequired({
      min: 5,
      message: "Say what is wrong — at least 5 characters.",
    }).safeParse("okay");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Say what is wrong — at least 5 characters.");
    }
  });
  it("still enforces the max after cleaning", () => {
    expect(reasonRequired().safeParse("x".repeat(501)).success).toBe(false);
  });
});

describe("reasonOptional (spec §6)", () => {
  it("passes undefined through unchanged", () => {
    expect(reasonOptional().parse(undefined)).toBeUndefined();
  });
  it("cleans an invisible-only reason down to an empty string", () => {
    expect(reasonOptional({ max: 200 }).parse("​")).toBe("");
  });
});
