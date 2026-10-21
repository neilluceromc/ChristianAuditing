import { describe, expect, it } from "vitest";
import { TAG_RULE, TAG_SHAPE, exactTagKey, tagKey } from "./tag-key";

describe("TAG_SHAPE (Phase 36 spec §2.1)", () => {
  it("accepts any 1-20 letters, digits, - _ . starting alphanumeric", () => {
    for (const t of ["BR-LT-0148", "ACC-LAP-001", "2026-0042", "A", "LT_1.2", "X".repeat(20)]) expect(TAG_SHAPE.test(t)).toBe(true);
  });
  it("refuses empty, a leading - or ., spaces, slashes, 21 chars and non-ASCII", () => {
    for (const t of ["", "-LT", ".X", "A B", "A/B", "X".repeat(21), "Ñ"]) expect(TAG_SHAPE.test(t)).toBe(false);
  });
  it("tagKey trims and upper-cases before the test (Review Focus 1)", () => {
    expect(tagKey("  acc-1 ")).toBe("ACC-1");
    expect(TAG_SHAPE.test(tagKey(" acc-1 "))).toBe(true);
  });
  it("names the rule", () => {
    expect(TAG_RULE).toBe("Tags are 1–20 letters, digits, - _ or ., no spaces");
  });
});

describe("exactTagKey (the search jump's tag, spec §7.2)", () => {
  it("is the tag key when the text fits TAG_SHAPE", () => {
    expect(exactTagKey("  br-lt-0148 ")).toBe("BR-LT-0148");
    expect(exactTagKey("mac")).toBe("MAC");
  });
  it("is null for text that can't be a tag", () => {
    for (const t of ["", "  ", "Carlo Reyes", "A/B", "-LT", "X".repeat(21)]) expect(exactTagKey(t)).toBeNull();
  });
});
