/**
 * Generates every .xlsx fixture `e2e/import-export.spec.ts` uploads.
 *
 *   npx tsx e2e/fixtures/make.ts
 *
 * BOTH this script and its output are committed, deliberately. The suite must
 * not depend on a generation step (a fixture that has to be built before the
 * tests run is one that can be built WRONG, silently, on someone else's
 * machine) — and §6a rule 51 applies here in the good direction: every sheet
 * below is written by `toXlsxBuffer` through the app's OWN export column
 * specs, so each one is a file this application could genuinely have
 * produced. That matters more than it sounds: the flagship workflow the
 * import feature exists for is re-uploading an unedited export, and a
 * hand-built fixture would test a shape no operator ever holds.
 *
 * Keep this runnable. When an export column is renamed, added or dropped,
 * regenerate rather than hand-editing the binaries — the header row is what
 * `matchHeaders` reads, so a stale fixture fails as a mysterious
 * missing-column refusal rather than as the column change it actually is.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toXlsxBuffer, type XlsxColumn } from "@/server/xlsx/write";
import { ASSET_EXPORT_COLUMNS, EMPLOYEE_EXPORT_COLUMNS } from "@/lib/export-columns";
import { IMPORT_ROW_CAP } from "@/lib/import-vocabulary";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Derived from the column spec rather than retyped: a row shape hand-copied
 * from `ASSET_EXPORT_COLUMNS` would drift from it the first time a column
 * changes, which is the whole class of twin this phase kept removing.
 */
type AssetSheetRow = Parameters<(typeof ASSET_EXPORT_COLUMNS)[number]["cell"]>[0];
type EmployeeSheetRow = Parameters<(typeof EMPLOYEE_EXPORT_COLUMNS)[number]["cell"]>[0];

/**
 * UTC midnight, matching what `readSheet` hands back for a date-formatted
 * cell (`src/server/import/read-sheet.ts`'s measured DATE CONVENTION). A
 * local-midnight Date here would make these fixtures behave differently
 * either side of Greenwich.
 */
const utcDay = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/**
 * Every column blank but the ones a caller names — a create needs only Tag,
 * Model and Category, and leaving the rest empty is what a minimal operator
 * sheet actually looks like.
 */
function asset(
  row: Partial<AssetSheetRow> & Pick<AssetSheetRow, "tag" | "model" | "categoryName">,
): AssetSheetRow {
  return {
    serial: null, typeName: null, status: "", assigneeName: null, assigneeNo: null,
    purchasedAt: null, cost: null, warrantyUntil: null, vendorName: null, rmaRef: null, notes: null,
    ...row,
  };
}

function employee(
  row: Partial<EmployeeSheetRow> &
    Pick<EmployeeSheetRow, "employeeNo" | "name" | "department" | "title" | "joinedAt">,
): EmployeeSheetRow {
  return { employment: "", m365Status: null, itemsHeld: 0, ...row };
}

/**
 * A header no `ASSET_IMPORT_HEADERS` label matches — a plausible typo of
 * "Asset tag", which IS an accepted spelling, so this is genuinely the case
 * the wizard's "check for a typo in the header" line exists for. Appended to
 * the app's own export columns so `assets-mixed.xlsx` carries BOTH an
 * unrecognised column and a known-unimported one ("RMA ref"), which is the
 * only way to assert the two are still worded apart.
 */
const TYPO_COLUMN: XlsxColumn<AssetSheetRow> = {
  label: "Aset tag", width: 12, cell: (r) => ({ value: r.tag }),
};

function write(name: string, buffer: Buffer): void {
  writeFileSync(join(OUT_DIR, name), buffer);
  console.log(`${name}  ${(buffer.byteLength / 1024).toFixed(1)} KiB`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // assets-clean.xlsx — 3 new rows, all valid, nothing to block on.
  write("assets-clean.xlsx", await toXlsxBuffer(ASSET_EXPORT_COLUMNS, [
    asset({ tag: "BR-LT-9001", model: "Dell Latitude 5450", categoryName: "Laptop", typeName: "Dell Latitude",
            purchasedAt: utcDay("2026-02-10"), cost: 62_000, warrantyUntil: utcDay("2029-02-10"),
            vendorName: "TechServe PH", notes: "imported by the e2e fixture" }),
    asset({ tag: "BR-MN-9002", model: "Dell P2425H", categoryName: "Monitor", typeName: "24-inch",
            purchasedAt: utcDay("2026-02-10"), cost: 9_800 }),
    asset({ tag: "BR-HS-9003", model: "Jabra Evolve2 30", categoryName: "Headset", typeName: "Wired" }),
  ]));

  // assets-mixed.xlsx — one of every verdict, and TWO block causes of
  // different sizes so "grouped biggest-first" is actually observable.
  //
  // The update row (BR-LT-0148) restates the seeded record's own Status and
  // holder rather than leaving those cells blank: `ASSET_EXPORT_COLUMNS`
  // carries both columns, and a present-but-disagreeing cell is exactly what
  // `lifecycle-via-import` blocks. Restating them is what a real edited
  // export looks like, and it keeps this row an ordinary update.
  write("assets-mixed.xlsx", await toXlsxBuffer([...ASSET_EXPORT_COLUMNS, TYPO_COLUMN], [
    asset({ tag: "BR-DK-9101", model: "WD22TB4 Dock", categoryName: "Dock", typeName: "USB-C Dock" }),
    asset({ tag: "BR-PH-9102", model: "iPhone 15", categoryName: "Phone", typeName: "iPhone" }),
    asset({ tag: "BR-LT-0148", model: "Dell Latitude 5420 (relabelled)", categoryName: "Laptop",
            typeName: "Dell Latitude", status: "DEPLOYED", assigneeName: "Marites Bautista",
            assigneeNo: "EMP-0042", rmaRef: "RMA-IGNORED" }),
    asset({ tag: "BR-LT-9103", model: "Framework 13", categoryName: "Ultrabook" }),
    asset({ tag: "BR-LT-9104", model: "ThinkPad X1", categoryName: "Laptop", status: "BROKEN" }),
    asset({ tag: "BR-MN-9105", model: "LG 32UN500", categoryName: "Monitor", status: "RETIRED" }),
  ]));

  // The duplicate-serial pair. Task 13's T-1: `count(serial)` is 0 across all
  // 25 seeded assets and the seed never sets one, so a "duplicate serial
  // taken from a seeded asset" cannot be built. The importer builds the state
  // itself instead — apply the first file, then upload the second — which is
  // a better fixture anyway, because the collision is one the running code
  // created. It is also the first time `AssetRefs.bySerial` and
  // `treatDuplicateSerialAsUpdate` are exercised against real data at all.
  const SERIAL = "SN-E2E-000001";
  write("assets-serial-new.xlsx", await toXlsxBuffer(ASSET_EXPORT_COLUMNS, [
    asset({ tag: "BR-LT-9201", model: "MacBook Air M4", serial: SERIAL, categoryName: "Laptop",
            typeName: "Dell Latitude" }),
  ]));
  write("assets-serial-clash.xlsx", await toXlsxBuffer(ASSET_EXPORT_COLUMNS, [
    asset({ tag: "BR-LT-9202", model: "MacBook Air M4 (re-tagged)", serial: SERIAL, categoryName: "Laptop",
            typeName: "Dell Latitude" }),
  ]));

  // assets-divergence.xlsx — two creates. The spec creates the FIRST tag
  // directly in the database between Validate and Import, so the re-plan
  // resolves it as an update and the wizard has a real divergence to render.
  write("assets-divergence.xlsx", await toXlsxBuffer(ASSET_EXPORT_COLUMNS, [
    asset({ tag: "BR-LT-9301", model: "Latitude 7450 (from the sheet)", categoryName: "Laptop" }),
    asset({ tag: "BR-LT-9302", model: "Latitude 7450 (second row)", categoryName: "Laptop" }),
  ]));

  // assets-empty.xlsx — a header row and nothing else, the "Nothing to
  // import" branch. `toXlsxBuffer` writes the header even for zero rows
  // (that is its own `getSheetData` comment's whole point), so this is a
  // legitimate sheet, not a corrupt one.
  write("assets-empty.xlsx", await toXlsxBuffer(ASSET_EXPORT_COLUMNS, []));

  // assets-oversized.xlsx — one row past the cap, refused by `readGrid`
  // before a single row is examined. Generated here rather than in the test:
  // writing 2,001 rows is fine at commit time and has no business happening
  // inside a Playwright run.
  write("assets-oversized.xlsx", await toXlsxBuffer(
    ASSET_EXPORT_COLUMNS,
    Array.from({ length: IMPORT_ROW_CAP + 1 }, (_, i) =>
      asset({
        // Shaped like a real tag so the refusal is the ROW CAP and nothing
        // else: a file that would also fail validation proves less.
        tag: `BR-ZZ-${String(i % 10_000).padStart(4, "0")}`,
        model: `Bulk unit ${i}`,
        categoryName: "Laptop",
      })),
  ));

  // employees-clean.xlsx — 2 new people. Departments must already exist
  // (scope decision 12): "Finance" and "IT" are both seeded.
  write("employees-clean.xlsx", await toXlsxBuffer(EMPLOYEE_EXPORT_COLUMNS, [
    employee({ employeeNo: "EMP-9001", name: "Imelda Navarro", department: "Finance",
               title: "Financial Analyst", joinedAt: utcDay("2026-03-02") }),
    employee({ employeeNo: "EMP-9002", name: "Rafael Ilagan", department: "IT",
               title: "Systems Engineer", joinedAt: utcDay("2026-03-16") }),
  ]));

  // employees-employment-clash.xlsx — scope decision 15, first half: an
  // UPDATE whose Employment cell disagrees with the record. EMP-0042 is
  // seeded ACTIVE, so this row asks a spreadsheet to start an offboarding,
  // which is exactly what must block. The Title differs too, so applying the
  // row with `keepCurrentEmployment` has something visible to write.
  write("employees-employment-clash.xlsx", await toXlsxBuffer(EMPLOYEE_EXPORT_COLUMNS, [
    employee({ employeeNo: "EMP-0042", name: "Marites Bautista", department: "Finance",
               title: "Senior Accountant", employment: "OFFBOARDING", joinedAt: utcDay("2024-03-04") }),
  ]));

  // employees-offboarding-create.xlsx — scope decision 15, second half: a
  // CREATE may set employment straight, and `offboardingAt` is stamped
  // alongside it by `updateEmployee`'s own three-branch rule. Nothing in the
  // UI shows that column, so the spec reads it back through Prisma.
  write("employees-offboarding-create.xlsx", await toXlsxBuffer(EMPLOYEE_EXPORT_COLUMNS, [
    employee({ employeeNo: "EMP-9003", name: "Dolores Panganiban", department: "Operations",
               title: "Warehouse Lead", employment: "OFFBOARDING", joinedAt: utcDay("2023-06-01") }),
  ]));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
