import { describe, expect, it } from "vitest";
import { COLUMN_LABELS, COLUMN_PREF_KEYS, type ColumnPrefKey } from "./column-prefs";

describe("COLUMN_LABELS (Phase 40 §2.5)", () => {
  for (const key of Object.keys(COLUMN_PREF_KEYS) as ColumnPrefKey[]) {
    it(`${key}: every hideable column has a label`, () => {
      for (const col of COLUMN_PREF_KEYS[key]) {
        const label = (COLUMN_LABELS[key] as Record<string, string | undefined>)[col];
        expect(label, col).toBeTypeOf("string");
        expect(label!.trim().length, col).toBeGreaterThan(0);
      }
    });
    it(`${key}: no label for a column that is not hideable`, () => {
      expect(Object.keys(COLUMN_LABELS[key]).sort()).toEqual([...COLUMN_PREF_KEYS[key]].sort());
    });
  }

  it("the registration column reads Registration", () => {
    expect(COLUMN_LABELS["columns:inventory"].registration).toBe("Registration");
  });
});
