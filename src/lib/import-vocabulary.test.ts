import { describe, expect, it } from "vitest";
import {
  BLOCK_CAUSES, IMPORT_ROW_CAP, blockSpec, groupByCause, rowCapRefusal, type ImportOption,
} from "./import-vocabulary";

const IMPORT_OPTIONS: readonly ImportOption[] = [
  "treatDuplicateSerialAsUpdate", "dropUnknownAssignee", "dropUnknownVendor", "keepCurrentLifecycle",
];

// Routes this application actually serves, as of this task — cross-checked
// against src/app/(app)/**. `/admin/vendors` and `/inventory/import` are
// deliberately absent: the former does not exist and never will (no surface
// creates a Vendor), the latter is T11's own page (the wizard doesn't link to
// itself; a "reupload" fix renders as its own restart instead).
const REAL_ROUTES = ["/admin/asset-categories", "/admin/asset-types", "/inventory"];

describe("BLOCK_CAUSES", () => {
  it("gives every cause a distinct label and a real explanation", () => {
    const labels = BLOCK_CAUSES.map((c) => blockSpec(c).label);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
    for (const c of BLOCK_CAUSES) expect(blockSpec(c).explain.length).toBeGreaterThan(20);
  });

  // The brief's whole argument: 18 identical lines is a wall, one line with a
  // button is a decision. A cause with no fix is one the operator can only
  // stare at.
  it("offers a fix for every cause", () => {
    for (const c of BLOCK_CAUSES) expect(blockSpec(c).fix).not.toBeNull();
  });

  // D-B (2026-08-22, Important #14): the vocabulary always asserted this, and
  // Task 7 shipped violating it — `unknown-vendor` linked to `/admin/vendors`,
  // which does not exist, and the test that "proved" the promise only ever
  // checked one cause's href. This checks every `link` fix against the real
  // route table, and every `option` fix against the real option enum, over
  // ALL of BLOCK_CAUSES rather than one example.
  it("gives every link fix a route that exists, and every option fix a real ImportOption", () => {
    for (const c of BLOCK_CAUSES) {
      const fix = blockSpec(c).fix!;
      if (fix.kind === "link") {
        expect(REAL_ROUTES).toContain(fix.href);
      } else if (fix.kind === "option") {
        expect(IMPORT_OPTIONS).toContain(fix.option);
      } else {
        expect(fix.kind).toBe("reupload");
        expect(fix.href).toBeUndefined();
      }
    }
  });

  it("sends unknown-category to the page that creates one, not to a dead end", () => {
    const fix = blockSpec("unknown-category").fix!;
    expect(fix.kind).toBe("link");
    expect(fix.href).toBe("/admin/asset-categories");
  });

  it("offers duplicate-serial as a re-plan, not a link — the operator already has the row", () => {
    const fix = blockSpec("duplicate-serial").fix!;
    expect(fix.kind).toBe("option");
    expect(fix.option).toBe("treatDuplicateSerialAsUpdate");
  });

  // D-B: unknown-vendor's asymmetry was backwards — the decorative field
  // hard-blocked while the semantically loaded assignee got a drop option.
  // Fixed by making Vendor droppable too, since Asset.vendorId is nullable
  // and purely informational.
  it("offers unknown-vendor as a drop, not a link to a page that doesn't exist", () => {
    const spec = blockSpec("unknown-vendor");
    const fix = spec.fix!;
    expect(fix.kind).toBe("option");
    expect(fix.option).toBe("dropUnknownVendor");
    expect(spec.explain).not.toMatch(/create it first/i);
  });

  // Rules 26/37/38: derive the list from ASSET_STATUSES, never retype it — a
  // hand-typed list silently drifts the day a ninth status is added.
  it("names all eight statuses inline in bad-status's explanation, derived not retyped", () => {
    const explain = blockSpec("bad-status").explain;
    for (const s of ["DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING"]) {
      expect(explain).toContain(s);
    }
  });

  it("offers lifecycle-via-import a way to keep applying the row's other columns", () => {
    const fix = blockSpec("lifecycle-via-import").fix!;
    expect(fix.kind).toBe("option");
    expect(fix.option).toBe("keepCurrentLifecycle");
  });
});

describe("groupByCause", () => {
  it("collapses many rows of one cause into one group carrying its row numbers", () => {
    const groups = groupByCause([
      { row: 2, cause: "duplicate-serial", detail: "SN-1" },
      { row: 5, cause: "duplicate-serial", detail: "SN-2" },
      { row: 9, cause: "unknown-category", detail: "Chairs" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ cause: "duplicate-serial", count: 2, rows: [2, 5] });
    expect(groups[1]).toMatchObject({ cause: "unknown-category", count: 1, rows: [9] });
  });

  it("orders the biggest group first, because that is the one worth fixing", () => {
    const groups = groupByCause([
      { row: 2, cause: "unknown-category", detail: "a" },
      { row: 3, cause: "duplicate-serial", detail: "b" },
      { row: 4, cause: "duplicate-serial", detail: "c" },
    ]);
    expect(groups[0].cause).toBe("duplicate-serial");
  });

  // The mutation the plan's own Step 9 missed: its fixture never produced a
  // real tie (2 vs 1 only), so reversing this tiebreak stayed green. Here
  // both groups carry exactly one row, so only BLOCK_CAUSES order can decide,
  // and unknown-category (index 2) must sort before unknown-type (index 3).
  it("breaks a genuine tie by BLOCK_CAUSES order, not by input order", () => {
    const groups = groupByCause([
      { row: 4, cause: "unknown-type", detail: "x" },
      { row: 2, cause: "unknown-category", detail: "y" },
    ]);
    expect(groups.map((g) => g.cause)).toEqual(["unknown-category", "unknown-type"]);
  });

  it("names up to three distinct example values per group, de-duplicated", () => {
    const groups = groupByCause([
      { row: 2, cause: "unknown-category", detail: "Chairs" },
      { row: 3, cause: "unknown-category", detail: "Chairs" },
      { row: 4, cause: "unknown-category", detail: "Desks" },
    ]);
    expect(groups[0].examples).toEqual(["Chairs", "Desks"]);
  });

  // The other mutation Step 9 missed: deleting `.filter(Boolean)` before the
  // `.slice(0, 3)` still passed every existing test because none supplied a
  // falsy detail alongside three-or-more real ones. A blank detail (e.g. from
  // missing-tag, whose detail is always "") must never occupy one of the three
  // example slots and push out a real value.
  it("drops falsy details before capping at three, not after", () => {
    const groups = groupByCause([
      { row: 1, cause: "missing-tag", detail: "" },
      { row: 2, cause: "missing-tag", detail: "A" },
      { row: 3, cause: "missing-tag", detail: "B" },
      { row: 4, cause: "missing-tag", detail: "C" },
      { row: 5, cause: "missing-tag", detail: "D" },
    ]);
    expect(groups[0].examples).toEqual(["A", "B", "C"]);
  });

  it("is empty for a clean file rather than one empty group", () => {
    expect(groupByCause([])).toEqual([]);
  });
});

describe("rowCapRefusal", () => {
  it("names the count and the cap, and says nothing was written", () => {
    const text = rowCapRefusal(4_100);
    expect(text).toContain("4100");
    expect(text).toContain(String(IMPORT_ROW_CAP));
    expect(text).toContain("Nothing was imported");
  });
});
