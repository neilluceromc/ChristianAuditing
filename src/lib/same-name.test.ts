import { describe, expect, it } from "vitest";
import { nameDeptKey, sameNameKey } from "./same-name";

describe("sameNameKey", () => {
  it("trims, lower-cases and collapses internal whitespace (refKey's own rule)", () => {
    expect(sameNameKey("  Maria   Santos ")).toBe("maria santos");
    expect(sameNameKey("Maria Santos")).toBe(sameNameKey("MARIA SANTOS"));
  });
});

describe("nameDeptKey", () => {
  it("matches regardless of case, spacing or department casing", () => {
    expect(nameDeptKey("Maria  Santos", "finance")).toBe(nameDeptKey("maria santos", "Finance"));
  });

  it("keys on both name AND department — the same name in a different department does not collide", () => {
    expect(nameDeptKey("Maria Santos", "Finance")).not.toBe(nameDeptKey("Maria Santos", "IT"));
  });
});
