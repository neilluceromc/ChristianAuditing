import { describe, expect, it } from "vitest";
import { CODE128_FIXED_MODULES, CODE128_MODULES_PER_CHAR, code128Modules, code128ModuleCount } from "./code128";

describe("code128Modules", () => {
  // Hand-verified against the symbology: START B (211214) + 'A' (111323)
  // + checksum 34 (131123) + STOP (2331112).
  it("encodes a single character exactly", () => {
    expect(code128Modules("A")).toEqual([
      2, 1, 1, 2, 1, 4, 1, 1, 1, 3, 2, 3, 1, 3, 1, 1, 2, 3, 2, 3, 3, 1, 1, 1, 2,
    ]);
  });

  it("puts the checksum before STOP, and it is modulo 103", () => {
    // checksum for "A" = (104 + 33*1) % 103 = 34 -> pattern "131123"
    expect(code128Modules("A").slice(12, 18)).toEqual([1, 3, 1, 1, 2, 3]);
  });

  it("encodes a real asset tag to the measured width", () => {
    const mods = code128Modules("BR-LT-0148");
    expect(mods).toHaveLength(6 * 10 + 19);
    expect(mods.reduce((a, b) => a + b, 0)).toBe(145);
  });

  it("always ends with STOP", () => {
    expect(code128Modules("BR-LT-0148").slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
    expect(code128Modules("A").slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  // The identity the label geometry depends on. If this drifts, labels overflow.
  it("costs 11n + 35 modules", () => {
    for (const n of [1, 5, 10, 20]) {
      const s = "A".repeat(n);
      expect(code128Modules(s).reduce((a, b) => a + b, 0)).toBe(
        CODE128_MODULES_PER_CHAR * n + CODE128_FIXED_MODULES,
      );
      expect(code128ModuleCount(n)).toBe(CODE128_MODULES_PER_CHAR * n + CODE128_FIXED_MODULES);
    }
  });

  it("accepts the whole printable ASCII range Code 128-B covers", () => {
    expect(() => code128Modules(" ")).not.toThrow();   // 32, the first
    expect(() => code128Modules("~")).not.toThrow();   // 126, the last
  });

  // Refuse rather than silently mis-encode: an out-of-charset character would
  // index past the pattern table and emit a symbol no scanner can read.
  it("refuses characters outside Code 128-B", () => {
    expect(() => code128Modules("café")).toThrow(/cannot be encoded/i);
    expect(() => code128Modules("tab\there")).toThrow(/cannot be encoded/i);
  });

  it("refuses an empty string rather than emitting a bodyless symbol", () => {
    expect(() => code128Modules("")).toThrow(/empty/i);
  });
});
