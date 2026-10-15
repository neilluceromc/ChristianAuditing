import { describe, expect, it } from "vitest";
import { TYPE_REQUIRED, typeAfterCategoryChange, typeChoice } from "./register-type";

describe("typeChoice (Phase 36 spec §3.1)", () => {
  it("0 types: nothing asked, no type", () => expect(typeChoice([])).toEqual({ show: false, required: false, auto: null }));
  it("1 type: set silently", () => expect(typeChoice([{ id: "t1" }])).toEqual({ show: false, required: false, auto: "t1" }));
  it("2+ types: asked and required, never pre-filled", () =>
    expect(typeChoice([{ id: "a" }, { id: "b" }])).toEqual({ show: true, required: true, auto: null }));
  it("a category change asks again (Review Focus 4)", () => expect(typeAfterCategoryChange()).toBe(""));
  it("message", () => expect(TYPE_REQUIRED).toBe("Pick the type"));
});
