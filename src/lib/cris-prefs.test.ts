import { describe, expect, it } from "vitest";
import { CRIS_PREF_DEFAULTS, crisPrefsSchema, parseCrisPrefs } from "./cris-prefs";

describe("crisPrefsSchema (spec §9, Your Cris)", () => {
  it("accepts the defaults", () => {
    expect(crisPrefsSchema.safeParse(CRIS_PREF_DEFAULTS).success).toBe(true);
  });
  it("the defaults: Match theme, Lively, shown, bottom-right at 20, hint not yet seen, not tucked away", () => {
    expect(CRIS_PREF_DEFAULTS).toEqual({
      color: "auto", motion: "lively", show: true, side: "right", bottom: 20, seenHint: false, tucked: false,
    });
  });
  it("tucked is a boolean", () => {
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, tucked: true }).success).toBe(true);
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, tucked: "yes" }).success).toBe(false);
  });
  it("a partial patch can carry tucked alone (saveCrisPrefs merges it)", () => {
    expect(crisPrefsSchema.partial().safeParse({ tucked: true })).toMatchObject({ success: true, data: { tucked: true } });
  });
  it("rejects an unknown colour", () => {
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, color: "pink" }).success).toBe(false);
  });
  it("rejects an unknown motion or side", () => {
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, motion: "frantic" }).success).toBe(false);
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, side: "top" }).success).toBe(false);
  });
  it("bottom is an int in 16–2000", () => {
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, bottom: 16 }).success).toBe(true);
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, bottom: 2000 }).success).toBe(true);
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, bottom: 15 }).success).toBe(false);
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, bottom: 2001 }).success).toBe(false);
    expect(crisPrefsSchema.safeParse({ ...CRIS_PREF_DEFAULTS, bottom: 72.5 }).success).toBe(false);
  });
});

describe("parseCrisPrefs", () => {
  it("garbage falls back to the defaults", () => {
    for (const junk of [null, undefined, "x", 3, [], { color: "pink", bottom: 5 }]) {
      expect(parseCrisPrefs(junk)).toEqual(CRIS_PREF_DEFAULTS);
    }
  });
  it("keeps every valid field and replaces only the bad ones", () => {
    expect(parseCrisPrefs({ color: "sky", motion: "still", show: false, side: "left", bottom: 9999, seenHint: true, tucked: true })).toEqual({
      color: "sky", motion: "still", show: false, side: "left", bottom: 20, seenHint: true, tucked: true,
    });
  });
  it("prefs stored before tucked existed read as not tucked", () => {
    expect(parseCrisPrefs({ color: "gold", motion: "calm", show: true, side: "left", bottom: 72, seenHint: true })).toEqual({
      color: "gold", motion: "calm", show: true, side: "left", bottom: 72, seenHint: true, tucked: false,
    });
  });
});
