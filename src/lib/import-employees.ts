import type { EmploymentStatus } from "@prisma/client";
import { EMPLOYMENT_STATUSES } from "./employees-list";
import { cellText, parseDateCell, refKey, type HeaderMatch } from "./import-assets";
import type { BlockCause, BlockedRow } from "./import-vocabulary";

/**
 * The employee importer's own header spec (Task 12). `Employee` has no email
 * column, `title` and `departmentId` are both REQUIRED, and the date is
 * `joinedAt` — none of `ASSET_IMPORT_HEADERS`'s shape transfers, but the
 * MATCHING machinery does: this is handed to the same generic `matchHeaders`
 * (`import-assets.ts`) the asset importer uses, not a second copy of it.
 *
 * `m365Status` and `offboardingAt` are DELIBERATELY not columns here:
 * - `m365Status` is a synced status whose authority lives outside a
 *   spreadsheet (the M365 sync path AND the edit form both write it —
 *   `employeeSchema`, `employees/actions.ts:206` — so it is not merely a
 *   read-only sync artefact; it is simply not this importer's to set).
 * - `offboardingAt` is DERIVED, not typed: it is stamped by the employment
 *   transition itself (see `planEmployeeRows`'s own comment on scope
 *   decision 15, below), so there is no sheet cell for an operator to fill
 *   in — writing it directly would let a spreadsheet silently redefine
 *   "this offboarding"'s window.
 */
export const EMPLOYEE_IMPORT_HEADERS = [
  { key: "employeeNo", labels: ["employee no", "employee number", "emp no"], required: true, title: "Employee no" },
  { key: "name", labels: ["name", "full name"], required: true, title: "Name" },
  { key: "title", labels: ["title", "job title", "role"], required: true, title: "Title" },
  { key: "department", labels: ["department", "dept"], required: true, title: "Department" },
  { key: "employment", labels: ["employment", "employment status", "status"], required: false, title: "Employment" },
  { key: "joinedAt", labels: ["joined", "joined at", "start date", "started"], required: true, title: "Joined" },
] as const;

export type EmployeeField = (typeof EMPLOYEE_IMPORT_HEADERS)[number]["key"];

/** The matched employee's current record, as far as the row rules need it. */
export interface EmployeeRecordRef {
  id: string;
  employment: EmploymentStatus;
}

/**
 * Reference data, pre-resolved by the server (`resolveEmployeeRefs`,
 * `server/modules/import/resolve.ts`).
 *
 * `departments`: name-keyed via `refKey`, `null` meaning the key matched MORE
 * THAN ONE row — the exact R-1 guard categories/types/vendors already have
 * (E-6): `Department.name` is `@unique`, but Postgres's unique index is
 * case-sensitive and `reference-actions.ts`'s `createRefRow` never checks
 * case, so "Finance" and "finance" can coexist.
 *
 * `byEmployeeNo`: keyed by `refKey(employeeNo)` — case-insensitively, unlike
 * `AssetRefs.byTag` (E-2: `Employee.employeeNo` has no format constraint, so
 * the tag rules don't transfer, but the SAME case-sensitive-unique-index
 * hazard does: matching exactly would let a sheet reading "emp-0042" miss an
 * existing "EMP-0042" and create a second person). Deliberately carries NO
 * case-collision guard analogous to `departments`' `null` — see
 * `buildEmployeeRefs` (`resolve.ts`) for why one is unnecessary here: unlike
 * a Department name, there is no live path in this app that can create a
 * SECOND employeeNo differing from an existing one only by case (this
 * importer's own case-insensitive match is what prevents it, going
 * forward).
 */
export interface EmployeeRefs {
  departments: Map<string, string | null>;
  byEmployeeNo: Map<string, EmployeeRecordRef>;
}

/**
 * Scope decision 15's write shape for CREATE: `employment` may be set
 * straight (an import is entering people already mid-offboarding, e.g. a
 * bulk backfill), and `offboardingAt` is stamped alongside it by the same
 * rule `updateEmployee` maintains — never left for a caller to forget.
 */
export interface EmployeeCreateData {
  /** the sheet's OWN casing — nothing normalises it on the way in (E-2) */
  employeeNo: string;
  name: string;
  title: string;
  departmentId: string;
  employment: EmploymentStatus;
  offboardingAt: Date | null;
  joinedAt: Date;
}

/**
 * Scope decision 15's write shape for UPDATE: no `employeeNo` (identity,
 * never editable — E-1, mirroring `updateEmployee`'s own schema, which
 * deliberately excludes it) and no `employment`/`offboardingAt` (an update
 * never moves employment, even when the sheet's own value already agrees
 * with the record — the same "even when it already agrees" rule
 * `AssetUpdatePatch` states for `status`/`assigneeId`, for the identical
 * reason: opening the door for the agreeing case is still opening it).
 *
 * Every field here is REQUIRED on every accepted row (name/title/department/
 * joinedAt are all `required: true` columns), so unlike `AssetUpdatePatch`
 * there is no absent-vs-null distinction to make on this shape itself — a
 * blank required cell blocks before a patch is ever built. The absent/null
 * CONTRACT still matters one layer down, in `employeeDiff`
 * (`src/lib/employee-diff.ts`), which is what actually decides what gets
 * written to the database from this patch.
 */
export interface EmployeeUpdatePatch {
  name: string;
  title: string;
  departmentId: string;
  joinedAt: Date;
}

export type EmployeeRowVerdict =
  | { kind: "create"; row: number; data: EmployeeCreateData }
  | { kind: "update"; row: number; employeeId: string; data: EmployeeUpdatePatch }
  | ({ kind: "blocked" } & BlockedRow);

export interface EmployeePlan {
  rows: EmployeeRowVerdict[];
  counts: { create: number; update: number; blocked: number };
}

/** Just the one option this row rule reads — see `import-vocabulary.ts`'s
 * `IMPORT_OPTIONS` for why this is a narrow slice rather than the full
 * `Record<ImportOption, boolean>`: this module never needs to know about the
 * asset importer's five options, and its own tests stay simple. */
export interface EmployeeImportOptions {
  keepCurrentEmployment: boolean;
}

const LENGTH_LIMITS = { name: [2, 120], title: [2, 120] } as const;

function cellAt(headers: HeaderMatch<EmployeeField>, cells: unknown[], field: EmployeeField): unknown {
  const index = headers.map.get(field);
  return index === undefined ? undefined : cells[index];
}

function textAt(headers: HeaderMatch<EmployeeField>, cells: unknown[], field: EmployeeField): string {
  return cellText(cellAt(headers, cells, field));
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * Scope decision 15's three-branch `offboardingAt` rule, restated for a row
 * that has no existing record to fall back to (a CREATE — `updateEmployee`,
 * `employees/actions.ts:228`, always has one). Entering OFFBOARDING with no
 * prior anchor stamps `new Date()` directly (there is nothing to fall back
 * to via `??`, so this collapses to the same outcome `employee.offboardingAt
 * ?? new Date()` would if `employee.offboardingAt` were null); ACTIVE clears
 * it; OFFBOARDED — reachable only by creating someone ALREADY offboarded,
 * with no anchor this importer could honestly invent — is left `null` rather
 * than stamped with an arbitrary "now" that would misrepresent when their
 * offboarding actually happened. This IS `updateEmployee`'s own rule, not a
 * parallel one: calling it with `current = null` (there is no employee yet)
 * produces exactly its OFFBOARDING and ACTIVE branches; only its OFFBOARDED
 * branch ("keep whatever is there") has no "there" on a create, and null is
 * the honest answer to that.
 */
function offboardingAtForCreate(employment: EmploymentStatus): Date | null {
  if (employment === "OFFBOARDING") return new Date();
  if (employment === "ACTIVE") return null;
  return null; // OFFBOARDED with no anchor to keep
}

/**
 * The per-row rules (Task 12). First failing check wins: exactly one cause
 * per row, the same discipline `planAssetRows` follows.
 */
export function planEmployeeRows(
  headers: HeaderMatch<EmployeeField>,
  cells: unknown[][],
  refs: EmployeeRefs,
  options: EmployeeImportOptions,
): EmployeePlan {
  const rows: EmployeeRowVerdict[] = [];
  const counts = { create: 0, update: 0, blocked: 0 };
  // C-2 (the asset importer's own lesson): earlier rows of THIS file, not
  // just what the database already knows — otherwise a copy-pasted
  // duplicate inside one upload is structurally invisible.
  const seenEmployeeNos = new Set<string>();

  cells.forEach((raw, i) => {
    const sheetRow = i + 2; // header is row 1

    // Rule 1: a wholly blank row is skipped entirely, not blocked.
    if (raw.every(isBlank)) return;

    const block = (cause: BlockCause, detail: string) => {
      rows.push({ kind: "blocked", row: sheetRow, cause, detail });
      counts.blocked += 1;
    };

    const employeeNoRaw = textAt(headers, raw, "employeeNo");
    const nameRaw = textAt(headers, raw, "name");
    const titleRaw = textAt(headers, raw, "title");
    const departmentRaw = textAt(headers, raw, "department");
    const joinedAtCell = cellAt(headers, raw, "joinedAt");
    const joinedAtBlank = isBlank(joinedAtCell);

    // Rule 2 (E-5): every required column checked at once, one lumped cause
    // naming which of them is blank — all five share the identical fix
    // (fill in the file and re-upload), so five separate causes would be
    // five copies of one idea.
    const missingFields: string[] = [];
    if (employeeNoRaw === "") missingFields.push("Employee no");
    if (nameRaw === "") missingFields.push("Name");
    if (titleRaw === "") missingFields.push("Title");
    if (departmentRaw === "") missingFields.push("Department");
    if (joinedAtBlank) missingFields.push("Joined");
    if (missingFields.length > 0) {
      block("missing-required", missingFields.join(", "));
      return;
    }

    // Rule 3 (E-2): employeeNo matches case-insensitively via refKey — the
    // same identity hazard the asset importer's tag rule guards, one layer
    // over. A row already claimed by an earlier row of THIS file blocks
    // before any other check gets a chance to run (C-2).
    const employeeNoKey = refKey(employeeNoRaw);
    if (seenEmployeeNos.has(employeeNoKey)) {
      block("duplicate-in-file", employeeNoRaw);
      return;
    }
    seenEmployeeNos.add(employeeNoKey);
    const matched = refs.byEmployeeNo.get(employeeNoKey) ?? null;

    // Rule 4: department must resolve to reference data — never created as
    // a side effect of an upload (scope decision 12, the same rule
    // categories/types/vendors follow).
    const departmentId = refs.departments.get(refKey(departmentRaw));
    if (departmentId === undefined) {
      block("unknown-department", departmentRaw);
      return;
    }
    // E-6: two departments sharing this name case-insensitively — genuinely
    // undecidable, so this blocks rather than picking one.
    if (departmentId === null) {
      block("duplicate-department-name", departmentRaw);
      return;
    }

    // Rule 5: employment format — blank reads as ACTIVE (create-only
    // default; see below), non-blank must be one of the three, upper-cased.
    const employmentRaw = textAt(headers, raw, "employment");
    let parsedEmployment: EmploymentStatus | null = null;
    if (employmentRaw !== "") {
      const upper = employmentRaw.toUpperCase();
      const match = (EMPLOYMENT_STATUSES as readonly string[]).find((s) => s === upper);
      if (!match) {
        block("bad-employment", employmentRaw);
        return;
      }
      parsedEmployment = match as EmploymentStatus;
    }

    // Rule 6 (E-3 / scope decision 15): an UPDATE never moves employment —
    // a PRESENT (non-blank) Employment cell that disagrees with the
    // record's current value blocks, unless the operator explicitly chose
    // to keep the current employment and apply just the rest of the row.
    // The same shape as the asset importer's `lifecycle-via-import`, for
    // the analogous reason: employment is maintained by the offboarding
    // flow everywhere else in this app, and a spreadsheet must not be the
    // surface that starts or unwinds one.
    if (matched) {
      const conflict = parsedEmployment !== null && parsedEmployment !== matched.employment;
      if (conflict && !options.keepCurrentEmployment) {
        block("employment-via-import", employmentRaw);
        return;
      }
    }

    // Rule 7 (E-1): ceilings from `employeeSchema`
    // (`employees/actions.ts:199`) — there is no createEmployee schema to
    // copy from, since this importer's validation IS the creation contract.
    if (nameRaw.length < LENGTH_LIMITS.name[0] || nameRaw.length > LENGTH_LIMITS.name[1]) {
      block("name-or-title-length", nameRaw);
      return;
    }
    if (titleRaw.length < LENGTH_LIMITS.title[0] || titleRaw.length > LENGTH_LIMITS.title[1]) {
      block("name-or-title-length", titleRaw);
      return;
    }

    // Rule 8: joinedAt, the one date column here — shares `parseDateCell`
    // with the asset importer's `purchasedAt`/`warrantyUntil` (E-9): the
    // UTC-midnight convention was MEASURED against `readSheet`, and a second,
    // independently-reasoned date rule for this column is exactly the twin
    // this phase keeps finding and removing.
    const joinedAtResult = parseDateCell(joinedAtCell);
    if (!joinedAtResult.ok) {
      block("bad-date", joinedAtResult.raw);
      return;
    }
    // Not blank (checked in Rule 2 above), so a real Date is guaranteed here.
    const joinedAt = joinedAtResult.value!;

    if (matched) {
      const patch: EmployeeUpdatePatch = {
        name: nameRaw,
        title: titleRaw,
        departmentId,
        joinedAt,
      };
      rows.push({ kind: "update", row: sheetRow, employeeId: matched.id, data: patch });
      counts.update += 1;
    } else {
      // Rule 9 (scope decision 15, create-only): blank Employment → ACTIVE.
      const employment: EmploymentStatus = parsedEmployment ?? "ACTIVE";
      const data: EmployeeCreateData = {
        employeeNo: employeeNoRaw,
        name: nameRaw,
        title: titleRaw,
        departmentId,
        employment,
        offboardingAt: offboardingAtForCreate(employment),
        joinedAt,
      };
      rows.push({ kind: "create", row: sheetRow, data });
      counts.create += 1;
    }
  });

  return { rows, counts };
}
