import { describe, expect, it } from "vitest";
import { ASSET_STATUSES } from "./inventory-list";
import { EMPLOYMENT_STATUSES } from "./employees-list";
import {
  BLOCK_CAUSES, IMPORT_MAX_UPLOAD_BYTES, IMPORT_OPTIONS, IMPORT_ROW_CAP, blockSpec, groupByCause,
  optionLabel, optionsFromForm, rowCapRefusal, uploadTooLargeRefusal,
  type BlockCause, type BlockFix,
} from "./import-vocabulary";

// Routes this application actually serves, as of this task — cross-checked
// against src/app/(app)/**. `/admin/vendors` and `/inventory/import` are
// deliberately absent: the former does not exist and never will (no surface
// creates a Vendor), the latter is T11's own page (the wizard doesn't link to
// itself; a "reupload" fix renders as its own restart instead). `/admin/
// departments` was added in Task 12 — it exists, and unlike `/admin/vendors`
// a rename there is genuinely possible (E-6).
const REAL_ROUTES = [
  "/admin/asset-categories", "/admin/asset-types", "/admin/departments", "/inventory",
];

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
  //
  // Minor (round 2): this test itself used to RETYPE the eight statuses it
  // asserts are derived, directly under a comment saying never to — so it
  // would not have caught the exact drift it warns about. Iterating
  // ASSET_STATUSES closes that.
  it("names all eight statuses inline in bad-status's explanation, derived not retyped", () => {
    const explain = blockSpec("bad-status").explain;
    for (const s of ASSET_STATUSES) expect(explain).toContain(s);
  });

  it("offers lifecycle-via-import a way to keep applying the row's other columns", () => {
    const fix = blockSpec("lifecycle-via-import").fix!;
    expect(fix.kind).toBe("option");
    expect(fix.option).toBe("keepCurrentLifecycle");
  });

  // NI-6 (round 2): renamed from `value-too-long`, which fired on a Model
  // that was too SHORT — a label stating the opposite of the problem, and
  // the exact group header the brief's argument rests on.
  it("names value-out-of-range without implying a value can only be too long", () => {
    const spec = blockSpec("value-out-of-range");
    expect(spec.label.toLowerCase()).not.toContain("too long");
  });

  // A fifth option (round 2): the identical end state — Deployed/Temporary
  // requested with no holder available — must not be auto-resolved to SPARE
  // on one path (dropUnknownAssignee) and hard-blocked on the other, when
  // both differ only in WHY there's no holder.
  it("offers deployed-without-holder a way to import as spare instead", () => {
    const fix = blockSpec("deployed-without-holder").fix!;
    expect(fix.kind).toBe("option");
    expect(fix.option).toBe("importUnheldAsSpare");
  });

  // NI-5 (round 2): Category is the third required column (with Tag and
  // Model), and a blank cell must get its own cause with a real detail —
  // not `unknown-category` with an empty one that `groupByCause` then
  // filters, leaving the operator a group header and no examples at all.
  it("gives missing-category its own cause, distinct from unknown-category", () => {
    const spec = blockSpec("missing-category");
    expect(spec.label.toLowerCase()).not.toBe(blockSpec("unknown-category").label.toLowerCase());
    expect(spec.fix?.kind).toBe("reupload");
  });

  // NC-3 (round 2): the type is KNOWN — it just no longer fits the row's new
  // category. Must not reuse `unknown-type`, whose explain is about a type
  // this system has never seen at all, a different problem.
  it("gives type-outside-category its own cause, distinct from unknown-type", () => {
    const spec = blockSpec("type-outside-category");
    expect(spec.explain).not.toMatch(/never seen/i);
    expect(spec.fix?.kind).toBe("reupload");
  });

  // R-1 (round 2): a category/vendor/type name colliding case-insensitively
  // is a DIFFERENT problem than "never seen" (unknown-*) — the name IS
  // known, twice, and the id is genuinely undecidable. Distinct causes so
  // the fix (rename one of the pair) is not confused with "create it first".
  it("sends duplicate-category-name to the categories page, distinct from unknown-category", () => {
    const spec = blockSpec("duplicate-category-name");
    expect(spec.fix).toMatchObject({ kind: "link", href: "/admin/asset-categories" });
    expect(spec.label.toLowerCase()).not.toBe(blockSpec("unknown-category").label.toLowerCase());
  });

  it("sends duplicate-type-name to the types page, distinct from unknown-type", () => {
    const spec = blockSpec("duplicate-type-name");
    expect(spec.fix).toMatchObject({ kind: "link", href: "/admin/asset-types" });
    expect(spec.label.toLowerCase()).not.toBe(blockSpec("unknown-type").label.toLowerCase());
  });

  // Unlike the category/type pair, no admin surface can rename or create a
  // Vendor at all (scope decision 14) — a link would be exactly the dead end
  // D-B already forbade for unknown-vendor, so this reuses the same drop.
  it("offers duplicate-vendor-name as a drop, not a link to a page that doesn't exist", () => {
    const spec = blockSpec("duplicate-vendor-name");
    expect(spec.fix).toMatchObject({ kind: "option", option: "dropUnknownVendor" });
    expect(spec.explain).not.toMatch(/create it first/i);
  });

  // NI-2 (round 2): reverting `bad-status` to a `/inventory` link left the
  // suite green under round 1, because no test pinned any cause's fix KIND
  // — only its internal consistency (a `link` fix must point somewhere
  // real, an `option` fix must name a real option), which a wrong-but-valid
  // kind still satisfies. This table has to be edited deliberately for any
  // cause's fix kind to change, which is the point.
  it("pins every cause's fix kind explicitly, so a silent kind change is caught", () => {
    const expected: Record<BlockCause, BlockFix["kind"]> = {
      "missing-tag": "reupload",
      "duplicate-serial": "option",
      "unknown-category": "link",
      "unknown-type": "link",
      "unknown-assignee": "option",
      "unknown-vendor": "option",
      "bad-status": "reupload",
      "bad-date": "reupload",
      "bad-number": "reupload",
      "bad-tag": "reupload",
      "missing-model": "reupload",
      "duplicate-in-file": "reupload",
      "ambiguous-assignee": "reupload",
      "inactive-assignee": "option",
      "deployed-without-holder": "option",
      "lifecycle-via-import": "option",
      "value-out-of-range": "reupload",
      "missing-category": "reupload",
      "type-outside-category": "reupload",
      "duplicate-category-name": "link",
      "duplicate-type-name": "link",
      "duplicate-vendor-name": "option",
      "unknown-department": "link",
      "duplicate-department-name": "link",
      "bad-employment": "reupload",
      "missing-required": "reupload",
      "employment-via-import": "option",
      "name-or-title-length": "reupload",
    };
    for (const c of BLOCK_CAUSES) {
      expect(blockSpec(c).fix?.kind).toBe(expected[c]);
    }
  });

  // Task 12, E-6: the department name collision guard, on the SAME link the
  // category one uses — a real page where a rename is genuinely possible.
  it("sends unknown-department to the page that creates one, not to a dead end", () => {
    const fix = blockSpec("unknown-department").fix!;
    expect(fix.kind).toBe("link");
    expect(fix.href).toBe("/admin/departments");
  });

  it("sends duplicate-department-name to the departments page, distinct from unknown-department", () => {
    const spec = blockSpec("duplicate-department-name");
    expect(spec.fix).toMatchObject({ kind: "link", href: "/admin/departments" });
    expect(spec.label.toLowerCase()).not.toBe(blockSpec("unknown-department").label.toLowerCase());
  });

  // Task 12, E-4: must NOT reuse bad-status's explain, which names all eight
  // ASSET statuses — actively wrong information on an employee row. Derived
  // from EMPLOYMENT_STATUSES, never retyped, the same discipline bad-status
  // itself is held to.
  it("names all three employment statuses inline in bad-employment's explanation, derived not retyped", () => {
    const explain = blockSpec("bad-employment").explain;
    for (const s of EMPLOYMENT_STATUSES) expect(explain).toContain(s);
    // And not the asset vocabulary's own statuses — the exact defect this
    // cause exists to avoid, the other way round.
    for (const s of ASSET_STATUSES) {
      if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(s)) expect(explain).not.toContain(s);
    }
  });

  // Task 12, E-5: one lumped cause for five required columns, and a
  // "reupload" fix — NOT a link to /employees/import, the page the operator
  // is already standing on.
  it("gives missing-required a reupload fix, not a link to the page it's rendered on", () => {
    const spec = blockSpec("missing-required");
    expect(spec.fix?.kind).toBe("reupload");
    expect(spec.explain).toMatch(/employee number/i);
  });

  // Task 12, E-3 (scope decision 15): the employee analogue of
  // lifecycle-via-import — same shape (an option to keep applying the row's
  // other columns), a different reason named in its own words.
  it("offers employment-via-import a way to keep applying the row's other columns", () => {
    const fix = blockSpec("employment-via-import").fix!;
    expect(fix.kind).toBe("option");
    expect(fix.option).toBe("keepCurrentEmployment");
    expect(blockSpec("employment-via-import").explain).not.toMatch(/approval queue/i);
  });

  // Task 12, E-1: ceilings from employeeSchema (2–120), not a reuse of
  // value-out-of-range — that cause names Model/Serial/Notes, asset-only
  // nouns that would be wrong on an employee row.
  it("gives name-or-title-length its own cause, not a reuse of value-out-of-range's asset wording", () => {
    const spec = blockSpec("name-or-title-length");
    expect(spec.fix?.kind).toBe("reupload");
    expect(spec.explain).not.toMatch(/model|serial|notes/i);
  });

  // Task 12: softened to be entity-neutral — the employee importer's own
  // employeeNo-in-file check reuses this exact cause, and "one physical
  // asset" would be false on an employee row.
  it("keeps duplicate-in-file entity-neutral, since the employee importer reuses it", () => {
    expect(blockSpec("duplicate-in-file").explain).not.toMatch(/asset/i);
  });
});

describe("optionsFromForm", () => {
  it("reads only the options present and set to \"1\", folding over every member of IMPORT_OPTIONS", () => {
    const form = new FormData();
    form.set("dropUnknownVendor", "1");
    form.set("importUnheldAsSpare", "0");
    const opts = optionsFromForm(form);
    for (const o of IMPORT_OPTIONS) {
      expect(opts[o]).toBe(o === "dropUnknownVendor");
    }
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

describe("uploadTooLargeRefusal", () => {
  // Both figures are DERIVED from the constant, not retyped. The first
  // version hardcoded "5.0 MB" and "4.0 MB", so moving the ceiling by the
  // multipart-overhead margin (R-4) failed this test for the wrong reason —
  // the message was still correct, the expectation was just a stale copy of a
  // number that has an owner. Same shape as the retyped status list and the
  // hand-written IMPORT_OPTIONS, both fixed this phase.
  it("names the file's size and the limit in MB, and says nothing was written", () => {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    const oversize = IMPORT_MAX_UPLOAD_BYTES + 1024 * 1024;
    const text = uploadTooLargeRefusal(oversize);
    expect(text).toContain(`${mb(oversize)} MB`);
    expect(text).toContain(`${mb(IMPORT_MAX_UPLOAD_BYTES)} MB`);
    expect(text).toContain("Nothing was imported");
  });
});

describe("optionLabel", () => {
  // Every option must have a real, human label — not the raw camelCase key —
  // and that label must be the SAME wording as the fix button that turns it
  // on (derived from BLOCK_CAUSES, not a second hand-typed map).
  it("gives every option the same label as the fix button that sets it", () => {
    for (const option of IMPORT_OPTIONS) {
      const owningCause = BLOCK_CAUSES.find((c) => {
        const fix = blockSpec(c).fix;
        return fix?.kind === "option" && fix.option === option;
      })!;
      expect(optionLabel(option)).toBe(blockSpec(owningCause).fix!.label);
      expect(optionLabel(option)).not.toBe(option);
    }
  });
});
