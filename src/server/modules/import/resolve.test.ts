import { describe, expect, it } from "vitest";
import { refKey } from "@/lib/import-assets";
import { buildAssetRefs } from "./resolve";

/** A minimal AssetRecordRef-shaped row, overridable per test. */
const record = (over: Partial<{
  id: string;
  tag: string;
  status: "SPARE" | "DEPLOYED";
  assigneeId: string | null;
  categoryId: string;
  typeId: string | null;
  serial: string | null;
}> = {}) => ({
  id: "a-1",
  tag: "BR-LT-0148",
  status: "SPARE" as const,
  assigneeId: null,
  categoryId: "cat-1",
  typeId: null,
  serial: null,
  ...over,
});

describe("buildAssetRefs", () => {
  // R-3 (producing side): import-assets.test.ts's `cat-1:standard` /
  // `cat-2:standard` trap has pinned the CONSUMING side of the composite key
  // since T7 — that `planAssetRows` reads it correctly. This is the
  // producing side: that `buildAssetRefs` itself EMITS keys in that exact
  // `${categoryId}:${refKey(name)}` shape, which had no test and could drift.
  it("keys types by the composite categoryId:name, so one type name under two categories resolves to two different ids", () => {
    const refs = buildAssetRefs(
      [],
      [
        { id: "typ-3", name: "Standard", categoryId: "cat-1" },
        { id: "typ-4", name: "Standard", categoryId: "cat-2" },
      ],
      [],
      [],
      [],
      [],
    );
    expect(refs.types.get("cat-1:standard")).toBe("typ-3");
    expect(refs.types.get("cat-2:standard")).toBe("typ-4");
  });

  it("marks a name matching more than one employee ambiguous, and a unique name not", () => {
    const refs = buildAssetRefs(
      [],
      [],
      [
        { id: "e-1", name: "Juan Dela Cruz", employeeNo: "EMP-0001", employment: "ACTIVE" },
        { id: "e-2", name: "Juan Dela Cruz", employeeNo: "EMP-0002", employment: "ACTIVE" },
        { id: "e-3", name: "Marites Bautista", employeeNo: "EMP-0042", employment: "ACTIVE" },
      ],
      [],
      [],
      [],
    );
    expect(refs.employees.get("juan dela cruz")?.ambiguous).toBe(true);
    expect(refs.employees.get("marites bautista")).toMatchObject({ ambiguous: false });
  });

  // Ambiguity is counted across ALL employment statuses, deliberately — an
  // OFFBOARDED record sharing a name with an ACTIVE one is still a real
  // ambiguity, not something narrowing to ACTIVE-only could safely resolve.
  it("still counts a name collision even when one of the two employees is OFFBOARDED", () => {
    const refs = buildAssetRefs(
      [],
      [],
      [
        { id: "e-1", name: "Ida Santos", employeeNo: "EMP-0010", employment: "ACTIVE" },
        { id: "e-2", name: "Ida Santos", employeeNo: "EMP-0011", employment: "OFFBOARDED" },
      ],
      [],
      [],
      [],
    );
    expect(refs.employees.get("ida santos")?.ambiguous).toBe(true);
  });

  it("lets an employeeNo key win over a name key it collides with, and keeps that key non-ambiguous", () => {
    // e-2's employeeNo happens to equal e-1's own (lower-cased) name.
    const refs = buildAssetRefs(
      [],
      [],
      [
        { id: "e-1", name: "EMP-0099", employeeNo: "EMP-0001", employment: "ACTIVE" },
        { id: "e-2", name: "Someone Else", employeeNo: "emp-0099", employment: "OFFBOARDED" },
      ],
      [],
      [],
      [],
    );
    expect(refs.employees.get("emp-0099")).toMatchObject({ id: "e-2", ambiguous: false });
  });

  it("does not lower-case the byTag key, unlike every name map — tags match EXACTLY", () => {
    const refs = buildAssetRefs([], [], [], [], [record({ tag: "BR-LT-0148" })], []);
    expect(refs.byTag.has("BR-LT-0148")).toBe(true);
    expect(refs.byTag.has("br-lt-0148")).toBe(false);
  });

  it("carries serial as the map key, not tag, on the bySerial side", () => {
    const refs = buildAssetRefs([], [], [], [], [], [record({ tag: "BR-LT-0148", serial: "SN-1" })]);
    expect(refs.bySerial.get("SN-1")).toMatchObject({ id: "a-1", tag: "BR-LT-0148" });
    expect(refs.bySerial.has("BR-LT-0148")).toBe(false);
  });

  it("drops a null-serial row from bySerial rather than keying it on null", () => {
    const refs = buildAssetRefs([], [], [], [], [], [record({ serial: null })]);
    expect(refs.bySerial.size).toBe(0);
  });

  it("resolves a category name to its id when there is exactly one match", () => {
    const refs = buildAssetRefs([{ id: "cat-1", name: "Laptops" }], [], [], [], [], []);
    expect(refs.categories.get(refKey("Laptops"))).toBe("cat-1");
  });

  // R-1: Postgres's unique constraint on AssetCategory.name is
  // case-SENSITIVE, and nothing else in the app checks case-insensitively —
  // so two rows named "Laptop" and "laptop" both exist happily. Without a
  // guard, whichever row an unordered query returned last would win
  // silently; the fix surfaces that as `null` instead of an id.
  it("resolves a case-colliding category name to null (ambiguous), not silently to one of the two ids", () => {
    const refs = buildAssetRefs(
      [{ id: "cat-1", name: "Laptop" }, { id: "cat-2", name: "laptop" }],
      [],
      [],
      [],
      [],
      [],
    );
    expect(refs.categories.get(refKey("Laptop"))).toBeNull();
  });

  it("resolves a case-colliding type name to null, scoped to the type's own category", () => {
    const refs = buildAssetRefs(
      [],
      [
        { id: "typ-1", name: "Standard", categoryId: "cat-1" },
        { id: "typ-2", name: "standard", categoryId: "cat-1" },
        { id: "typ-3", name: "Standard", categoryId: "cat-2" }, // different category: not a collision
      ],
      [],
      [],
      [],
      [],
    );
    expect(refs.types.get("cat-1:standard")).toBeNull();
    expect(refs.types.get("cat-2:standard")).toBe("typ-3");
  });

  it("resolves a case-colliding vendor name to null", () => {
    const refs = buildAssetRefs(
      [],
      [],
      [],
      [{ id: "v-1", name: "Acme" }, { id: "v-2", name: "ACME" }],
      [],
      [],
    );
    expect(refs.vendors.get(refKey("Acme"))).toBeNull();
  });

  // R-4: refKey collapses an internal whitespace run (including a
  // non-breaking space) so a category/vendor/employee name pasted with one
  // still matches the plain-space spelling stored in the database.
  it("resolves a category name carrying an internal non-breaking space via refKey", () => {
    const refs = buildAssetRefs([{ id: "cat-1", name: "Spare Parts" }], [], [], [], [], []);
    expect(refs.categories.get(refKey("Spare Parts"))).toBe("cat-1");
  });
});
