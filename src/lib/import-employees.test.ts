import { describe, expect, it } from "vitest";
import { matchHeaders } from "./import-assets";
import {
  EMPLOYEE_IMPORT_HEADERS, planEmployeeRows, type EmployeeImportOptions, type EmployeeRefs,
} from "./import-employees";

// The real 8-column export header (`EMPLOYEE_EXPORT_COLUMNS`, export-columns.ts)
// — not a subset. Task 7 shipped once with a fixture missing several real
// columns and it stayed green; using the real header exercises the round
// trip (export, edit, re-import) this feature exists for.
const HEADER = ["Employee no", "Name", "Department", "Title", "Employment", "M365", "Joined", "Items held"];

const COL = {
  employeeNo: 0, name: 1, department: 2, title: 3, employment: 4, m365: 5, joined: 6, itemsHeld: 7,
};

/** An 8-cell row, blank by default, with the given columns filled in. */
function cells(over: Partial<Record<keyof typeof COL, unknown>>): unknown[] {
  const row: unknown[] = Array(HEADER.length).fill("");
  for (const [key, value] of Object.entries(over)) row[COL[key as keyof typeof COL]] = value;
  return row;
}

const REFS: EmployeeRefs = {
  departments: new Map([["finance", "dept-1"], ["it", "dept-2"]]),
  byEmployeeNo: new Map([
    ["emp-0042", { id: "e-1", employment: "ACTIVE" }],
    ["emp-0099", { id: "e-2", employment: "OFFBOARDED" }],
  ]),
};

const OPTS: EmployeeImportOptions = { keepCurrentEmployment: false };

describe("matchHeaders(EMPLOYEE_IMPORT_HEADERS)", () => {
  it("matches case- and space-insensitively", () => {
    const m = matchHeaders(["  employee no ", "NAME"], EMPLOYEE_IMPORT_HEADERS);
    expect(m.map.get("employeeNo")).toBe(0);
    expect(m.map.get("name")).toBe(1);
  });

  it("names every missing required header at once", () => {
    const m = matchHeaders(["Employee no"], EMPLOYEE_IMPORT_HEADERS);
    expect(m.missing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Name"),
        expect.stringContaining("Title"),
        expect.stringContaining("Department"),
        expect.stringContaining("Joined"),
      ]),
    );
    expect(m.missing).toHaveLength(4);
  });

  it("ignores unrecognised columns and reports them in unknown", () => {
    const m = matchHeaders(["Employee no", "Name", "Title", "Department", "Joined", "Cost centre"], EMPLOYEE_IMPORT_HEADERS);
    expect(m.unknown).toEqual(["Cost centre"]);
  });

  it("matches the real export header with no missing and no unknown other than M365/Items held", () => {
    const m = matchHeaders(HEADER, EMPLOYEE_IMPORT_HEADERS);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["M365", "Items held"]);
  });
});

describe("planEmployeeRows", () => {
  const headers = matchHeaders(HEADER, EMPLOYEE_IMPORT_HEADERS);

  // 4. A clean row creates, and its row is 2 (the header is row 1).
  it("a clean new employeeNo creates, at sheet row 2", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: new Date("2026-01-05T00:00:00Z") })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ kind: "create", row: 2 });
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 0 });
  });

  // 5. A known employeeNo is an UPDATE carrying the existing employee id —
  // employeeNo is the identity here exactly as tag is for assets.
  it("a known employeeNo is an update carrying the existing employee id", () => {
    const row = [cells({ employeeNo: "EMP-0042", name: "Marites Bautista", department: "Finance", title: "Accountant", joined: "2020-01-01" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "update", employeeId: "e-1" });
    expect(plan.counts).toEqual({ create: 0, update: 1, blocked: 0 });
  });

  // E-2: matching is case-insensitive, but the stored value keeps the
  // sheet's own casing because nothing normalises employeeNo on the way in.
  it("matches employeeNo case-insensitively but writes the sheet's own casing on create", () => {
    const row = [cells({ employeeNo: "emp-0200", name: "New Hire", department: "it", title: "Support", joined: "2026-01-01" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
    expect((plan.rows[0] as { data: { employeeNo: string } }).data.employeeNo).toBe("emp-0200");
  });

  it("matches an existing employeeNo case-insensitively as an update, not a second create", () => {
    const row = [cells({ employeeNo: "emp-0042", name: "Marites Bautista", department: "Finance", title: "Accountant", joined: "2020-01-01" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "update", employeeId: "e-1" });
  });

  // 6. An unknown department is blocked unknown-department, detail = the raw value.
  it("blocks an unknown department, detail = the raw value", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "Marketing", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-department", detail: "Marketing" });
  });

  // 7. A blank name, title or joinedAt is blocked missing-required.
  it.each(["name", "title", "joined"] as const)("blocks a blank %s as missing-required", (field) => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05", [field]: "" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required" });
  });

  // 8. A blank employeeNo is blocked missing-required too — no missing-tag
  // equivalent, and reusing an asset-shaped cause name would read wrong here.
  it("blocks a blank employeeNo as missing-required, not a distinct cause", () => {
    const row = [cells({ name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required" });
  });

  // 9. employment blank reads as ACTIVE; an unrecognised value is blocked
  // bad-employment (E-4 — NOT bad-status).
  it("employment blank reads as ACTIVE", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
    expect((plan.rows[0] as { data: { employment: string } }).data.employment).toBe("ACTIVE");
  });

  it("blocks an unrecognised employment value as bad-employment, not bad-status", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05", employment: "RETIRED" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-employment", detail: "RETIRED" });
  });

  it("accepts employment case-insensitively on create", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05", employment: "offboarding" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect((plan.rows[0] as { data: { employment: string } }).data.employment).toBe("OFFBOARDING");
  });

  // 10. joinedAt accepts a Date and YYYY-MM-DD, and blocks anything else as bad-date.
  it("accepts a real Date cell for joinedAt", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: new Date("2026-01-05T00:00:00Z") })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
  });

  it("accepts YYYY-MM-DD text for joinedAt", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
  });

  it("blocks an unreadable joinedAt as bad-date", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-02-30" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-date" });
  });

  // 11. A wholly blank row is skipped, counted nowhere.
  it("skips a wholly blank row, counted nowhere", () => {
    const row = [cells({}), cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].row).toBe(3); // the blank row still occupies sheet row 2
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 0 });
  });

  // 12. A file with good and bad rows keeps the good ones.
  it("keeps good rows even when other rows in the same file block", () => {
    const rows = [
      cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" }),
      cells({ employeeNo: "EMP-0101", name: "", department: "IT", title: "Analyst", joined: "2026-01-05" }),
    ];
    const plan = planEmployeeRows(headers, rows, REFS, OPTS);
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 1 });
  });

  // 13. One cause per row: missing BOTH name and department reports only missing-required.
  it("reports exactly one cause when both name and department are blank", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "", department: "", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required" });
  });

  // E-1: name/title ceilings from employeeSchema (2–120), NOT value-out-of-range.
  it("blocks a one-character name as name-or-title-length", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "A", department: "IT", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "name-or-title-length" });
  });

  it("blocks a 121-character title as name-or-title-length", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "x".repeat(121), joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "name-or-title-length" });
  });

  it("accepts a name and title at exactly the 2 and 120 character boundaries", () => {
    const row = [cells({ employeeNo: "EMP-0100", name: "Al", department: "IT", title: "x".repeat(120), joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
  });

  // E-6: department name collision — a case-insensitive duplicate is
  // genuinely undecidable, not "never seen".
  it("blocks a case-colliding department name as duplicate-department-name", () => {
    const refs: EmployeeRefs = { ...REFS, departments: new Map([["finance", null]]) };
    const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "Finance", title: "Analyst", joined: "2026-01-05" })];
    const plan = planEmployeeRows(headers, row, refs, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-department-name", detail: "Finance" });
  });

  // Same-file employeeNo collision — the C-2 lesson from the asset importer:
  // an earlier row of THIS file, not just what the database already knows.
  it("blocks a second row of this file claiming an employeeNo an earlier row already claimed", () => {
    const rows = [
      cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" }),
      cells({ employeeNo: "emp-0100", name: "Someone Else", department: "IT", title: "Analyst", joined: "2026-01-05" }),
    ];
    const plan = planEmployeeRows(headers, rows, REFS, OPTS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
    expect(plan.rows[1]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file", detail: "emp-0100" });
  });

  // E-3 / scope decision 15: an update whose Employment cell disagrees with
  // the record blocks; the option applies the row's other columns anyway.
  describe("employment on update (scope decision 15)", () => {
    it("blocks when the sheet's Employment disagrees with the record's current value", () => {
      const row = [cells({ employeeNo: "EMP-0042", name: "Marites Bautista", department: "Finance", title: "Accountant", joined: "2020-01-01", employment: "OFFBOARDING" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "employment-via-import" });
    });

    it("does not block when the sheet's Employment already agrees with the record", () => {
      const row = [cells({ employeeNo: "EMP-0042", name: "Marites Bautista", department: "Finance", title: "Accountant", joined: "2020-01-01", employment: "ACTIVE" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      expect(plan.rows[0]).toMatchObject({ kind: "update" });
    });

    it("does not block when the sheet's Employment cell is blank", () => {
      const row = [cells({ employeeNo: "EMP-0042", name: "Marites Bautista", department: "Finance", title: "Accountant", joined: "2020-01-01" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      expect(plan.rows[0]).toMatchObject({ kind: "update" });
    });

    it("keepCurrentEmployment applies the row's other columns instead of blocking", () => {
      const row = [cells({ employeeNo: "EMP-0042", name: "Marites B. Cruz", department: "Finance", title: "Accountant", joined: "2020-01-01", employment: "OFFBOARDING" })];
      const plan = planEmployeeRows(headers, row, REFS, { keepCurrentEmployment: true });
      expect(plan.rows[0]).toMatchObject({ kind: "update", employeeId: "e-1" });
      const patch = (plan.rows[0] as { data: { name: string } }).data;
      expect(patch.name).toBe("Marites B. Cruz");
      expect(patch).not.toHaveProperty("employment");
    });

    it("an update's patch never carries employment or offboardingAt, even when the sheet cell agrees", () => {
      const row = [cells({ employeeNo: "EMP-0042", name: "Marites Bautista", department: "Finance", title: "Accountant", joined: "2020-01-01", employment: "ACTIVE" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      const patch = plan.rows[0] as unknown as { data: Record<string, unknown> };
      expect(patch.data).not.toHaveProperty("employment");
      expect(patch.data).not.toHaveProperty("offboardingAt");
    });
  });

  // Scope decision 15: create MAY set employment, stamping offboardingAt by
  // updateEmployee's own three-branch rule (with no existing record to fall
  // back to, so OFFBOARDING always stamps `new Date()`).
  describe("employment and offboardingAt on create (scope decision 15)", () => {
    it("a create with employment OFFBOARDING stamps offboardingAt", () => {
      const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05", employment: "OFFBOARDING" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      const data = (plan.rows[0] as { data: { employment: string; offboardingAt: Date | null } }).data;
      expect(data.employment).toBe("OFFBOARDING");
      expect(data.offboardingAt).toBeInstanceOf(Date);
    });

    it("a create with no Employment cell (ACTIVE default) leaves offboardingAt null", () => {
      const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      const data = (plan.rows[0] as { data: { offboardingAt: Date | null } }).data;
      expect(data.offboardingAt).toBeNull();
    });
  });

  // Mutation tests (Task 7 Step 9's discipline, applied here): each of these
  // must FAIL if the named fix is reverted — checked by literally reverting
  // during implementation, not assumed.
  describe("mutation coverage", () => {
    // The draft's own Step 3: swap the known-employeeNo check to AFTER the
    // required-field check — must fail if the update-identity resolution
    // moves after a check that would otherwise block first for an unrelated
    // reason on the SAME row (a row that's a valid update but would also,
    // say, fail a department check the update path doesn't need to re-run
    // department validation for... this test instead pins the case that
    // actually distinguishes the two orderings on this schema: employeeNo
    // resolution must happen even though nothing else about ordering
    // matters, since it doesn't gate any other check.
    it("resolves a known employeeNo as an update even when other columns would be blank on a lesser row", () => {
      // A minimal but complete row — this exists mainly so a reviewer
      // reverting rule order sees update vs create flip, not to test one
      // specific ordering interaction (there isn't one on this schema).
      const row = [cells({ employeeNo: "EMP-0042", name: "Marites Bautista", department: "Finance", title: "Accountant", joined: "2020-01-01" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      expect(plan.rows[0]).toMatchObject({ kind: "update", employeeId: "e-1" });
    });

    // The draft's own Step 3: employment defaulting to OFFBOARDED instead of
    // ACTIVE must fail this test.
    it("employment defaults to ACTIVE, never OFFBOARDED, when the cell is blank", () => {
      const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      const data = (plan.rows[0] as { data: { employment: string } }).data;
      expect(data.employment).toBe("ACTIVE");
      expect(data.employment).not.toBe("OFFBOARDED");
    });

    // A mutation dropping the `.filter(Boolean)`-equivalent blank-required
    // check for employeeNo specifically (as opposed to the other four)
    // would let a blank employeeNo through to department resolution instead
    // of blocking — this pins that employeeNo is checked, not skipped.
    it("still blocks a blank employeeNo even when every other required column is filled in", () => {
      const row = [cells({ name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required" });
    });

    // Pins the ORDER the draft's Step 3 names: the same-file duplicate check
    // (which claims `refKey(employeeNoRaw)`, i.e. `""` for a blank cell)
    // must run AFTER the required-field check, not before it. Reversed, a
    // SECOND row with a blank employeeNo would find `""` already claimed by
    // the first blank row and misreport `duplicate-in-file` instead of the
    // true, identical defect on both rows: `missing-required`.
    it("a second row with a blank employeeNo still reports missing-required, not duplicate-in-file", () => {
      const rows = [
        cells({ name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05" }),
        cells({ name: "Someone Else", department: "IT", title: "Analyst", joined: "2026-01-05" }),
      ];
      const plan = planEmployeeRows(headers, rows, REFS, OPTS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required" });
      expect(plan.rows[1]).toMatchObject({ kind: "blocked", cause: "missing-required" });
    });

    // A mutation comparing employment case-SENSITIVELY (so "offboarding"
    // never matches "OFFBOARDING") would misclassify a lower-case sheet
    // value as bad-employment — pinned above already ("accepts employment
    // case-insensitively on create"), and this is the inverse: an
    // upper-cased sheet value the enum itself already uses.
    it("accepts an already-upper-case employment value unchanged", () => {
      const row = [cells({ employeeNo: "EMP-0100", name: "Nina Robles", department: "IT", title: "Analyst", joined: "2026-01-05", employment: "OFFBOARDED" })];
      const plan = planEmployeeRows(headers, row, REFS, OPTS);
      const data = (plan.rows[0] as { data: { employment: string } }).data;
      expect(data.employment).toBe("OFFBOARDED");
    });
  });
});
