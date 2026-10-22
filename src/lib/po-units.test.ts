import { describe, expect, it } from "vitest";
import { PO_UNITS, unitSchema } from "./po-units";

describe("PO_UNITS", () => {
  it("offers the seven units, pc first", () => {
    expect(PO_UNITS).toEqual(["pc", "box", "set", "pack", "roll", "m", "unit"]);
  });
});

describe("unitSchema", () => {
  it("defaults to pc", () => {
    expect(unitSchema.parse(undefined)).toBe("pc");
  });

  it("trims, and keeps free text up to 12 characters", () => {
    expect(unitSchema.parse("  box ")).toBe("box");
    expect(unitSchema.parse("abcdefghijkl")).toBe("abcdefghijkl");
  });

  it("refuses 13 characters and a blank", () => {
    expect(unitSchema.safeParse("abcdefghijklm").success).toBe(false);
    expect(unitSchema.safeParse("   ").success).toBe(false);
  });
});
