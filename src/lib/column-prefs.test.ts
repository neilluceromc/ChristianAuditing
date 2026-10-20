import { describe, expect, it } from "vitest";
import {
  COLUMN_LABELS, COLUMN_PREF_KEYS, DEFAULT_INVENTORY_COLUMNS, resolveInventoryColumns, seenKeyOf, type ColumnPrefKey,
} from "./column-prefs";

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

describe("serial column (Phase 45 §2.3)", () => {
  it("is hideable and labelled Serial number", () => {
    expect(COLUMN_PREF_KEYS["columns:inventory"]).toContain("serial");
    expect(COLUMN_LABELS["columns:inventory"].serial).toBe("Serial number");
  });
});

describe("seenKeyOf", () => {
  it("derives the marker key from the saved key", () => {
    expect(seenKeyOf("columns:inventory")).toBe("columns:inventory:seen");
  });
});

describe("resolveInventoryColumns", () => {
  const allowed = COLUMN_PREF_KEYS["columns:inventory"] as readonly string[];
  it("defaults to serial, category and assigned", () => {
    expect(DEFAULT_INVENTORY_COLUMNS).toEqual(["serial", "category", "assigned"]);
    expect(resolveInventoryColumns(null, null, allowed)).toEqual(["serial", "category", "assigned"]);
  });
  it("adds serial once for a saved set that never saw it", () => {
    expect(resolveInventoryColumns(["category", "assigned", "registration"], null, allowed))
      .toEqual(["category", "assigned", "registration", "serial"]);
  });
  it("keeps a saved set that already saw serial", () => {
    expect(resolveInventoryColumns(
      ["category"], ["category", "assigned", "serial", "registration", "purchased", "warranty"], allowed,
    )).toEqual(["category"]);
  });
  it("keeps serial when it is already saved, and drops keys that are not allowed", () => {
    expect(resolveInventoryColumns(["serial", "bogus", "category"], null, allowed)).toEqual(["serial", "category"]);
  });
});
