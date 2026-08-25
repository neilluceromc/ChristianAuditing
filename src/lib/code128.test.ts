import { describe, expect, it } from "vitest";
import {
  CODE128_FIXED_MODULES, CODE128_MODULES_PER_CHAR, canEncode128, code128Modules, code128ModuleCount,
} from "./code128";

describe("code128Modules", () => {
  // Hand-verified against the symbology: START B (211214) + 'A' (111323)
  // + checksum 34 (131123) + STOP (2331112).
  it("encodes a single character exactly", () => {
    expect(code128Modules("A")).toEqual([
      2, 1, 1, 2, 1, 4, 1, 1, 1, 3, 2, 3, 1, 3, 1, 1, 2, 3, 2, 3, 3, 1, 1, 1, 2,
    ]);
  });

  // A strict subset of the whole-array assertion above: it kills no mutant
  // that test doesn't already kill. Kept only for a localised failure
  // message when the checksum window specifically breaks — not for coverage.
  it("puts the checksum before STOP, and it is modulo 103", () => {
    // checksum for "A" = (104 + 33*1) % 103 = 34 -> pattern "131123"
    expect(code128Modules("A").slice(12, 18)).toEqual([1, 3, 1, 1, 2, 3]);
  });

  it("encodes a real asset tag, checksum included", () => {
    const mods = code128Modules("BR-LT-0148");
    expect(mods).toHaveLength(6 * 10 + 19);
    expect(mods.reduce((a, b) => a + b, 0)).toBe(145);
    // Hand-computed from the symbology, independent of the implementation:
    // values (code-32) are B=34 R=50 -=13 L=44 T=52 -=13 0=16 1=17 4=20 8=24.
    // checksum = (104 + 34*1 + 50*2 + 13*3 + 44*4 + 52*5 + 13*6 + 16*7 + 17*8
    //   + 20*9 + 24*10) % 103 = 1459 % 103 = 17 -> pattern "123221".
    // Every pattern sums to 11 modules regardless of which one it is, so the
    // length/sum assertions above are invariant under checksum value and
    // can't catch a wrong-direction weighting; this can.
    expect(mods.slice(-13, -7)).toEqual([1, 2, 3, 2, 2, 1]);
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

  it("refuses a character count code128Modules could not have produced a symbol for", () => {
    expect(() => code128ModuleCount(0)).toThrow();
    expect(() => code128ModuleCount(-1)).toThrow();
    expect(() => code128ModuleCount(1.5)).toThrow();
    expect(() => code128ModuleCount(1)).not.toThrow();
  });

  // Every single-character symbol is START(6) + char(6) + checksum(6) + STOP(7)
  // = 25 runs summing to 11+11+11+13 = 46 modules, whichever of the 96
  // characters and whichever of the 96 checksum rows is involved. Looping the
  // whole range turns the one-time hand verification of PATTERNS into a
  // property a future typo in the table can't survive.
  it("accepts the whole printable ASCII range Code 128-B covers", () => {
    for (let code = 32; code <= 126; code++) {
      const ch = String.fromCharCode(code);
      const mods = code128Modules(ch);
      expect(mods).toHaveLength(25);
      expect(mods.reduce((a, b) => a + b, 0)).toBe(46);
    }
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

describe("canEncode128", () => {
  // The 32..126 sweep and the café/tab cases above never sit AT the edge.
  // `code < 32` mutated to `code < 31` leaves every other test in this file
  // green, and then barcodeFit would report encodable:true for a tag
  // code128Modules refuses to encode — the exact 500-the-whole-sheet failure
  // this module exists to prevent. Pin both boundaries directly.
  it("pins the charset floor and ceiling exactly", () => {
    expect(canEncode128(String.fromCharCode(31))).toBe(false); // one below the floor
    expect(canEncode128(" ")).toBe(true); // 32, the floor itself
    expect(canEncode128("~")).toBe(true); // 126, the ceiling
    expect(canEncode128(String.fromCharCode(127))).toBe(false); // one above (DEL)
  });
});
