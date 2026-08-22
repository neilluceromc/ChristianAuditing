# Inventory v2 — Phase 9: Import / export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spreadsheet in, spreadsheet out — two importers (`assets`, `employees`) with a dry run that writes nothing and a partial commit that groups its refusals by cause, and four Excel export routes (`assets`, `audit`, `employees`, `farewell-report`) that refuse at 10,000 rows instead of truncating.

**Architecture:** The `.xlsx` boundary is two thin server modules (`src/server/xlsx/write.ts`, `src/server/import/read-sheet.ts`) wrapping one library each; everything interesting lives in pure, unit-tested rule modules under `src/lib/` that never touch a file, a request or the database. The import is three stages over the same pure rules: **read** the grid → **plan** it (per-row verdicts, zero writes) → **apply** the rows the plan says are applicable. Reference data (category, type, assignee, vendor) is resolved by name to id in the planning stage, so the apply stage has no lookups left to fail on.

**Tech Stack:** Next.js App Router (route handlers for downloads, server actions for uploads) · Prisma/Postgres · zod · `write-excel-file` + `read-excel-file` · vitest · Playwright.

**Read before starting:** `docs/HANDOVER.md` §0 (the checklist), §6 (this phase's entry criteria), §6a (63 rules — rules 8, 10, 16, 20, 26, 51 all bite in this phase), §7 and §8. And `design_handover/README.md` card `[5a, 1m, 7g]` plus the brief's §7 line on exports and imports.

---

## Recorded scope decisions

These are settled. A task that needs to break one must say so and amend this list.

1. **`write-excel-file` + `read-excel-file`, not `exceljs` and not `xlsx`.** The pair costs 5 transitive
   packages, all pure JS, sharing `fflate`; `exceljs` costs 9 including `archiver` and `unzipper@0.10`.
   The npm `xlsx` package is the stale 0.18.5 mirror — SheetJS moved distribution off npm — and carries
   known advisories. Fewer transitive packages matters more than usual here because of the
   package-lock hazard in §7 (see Task 1).
2. **The import reads the RAW GRID and validates with our own rules — `read-excel-file`'s schema mode
   is deliberately unused.** `readSheet(file, { schema })` returns *either* `objects` *or* `errors`,
   never both, so it cannot express partial success. Partial import is the brief's DEFAULT, so the
   library's schema mode is structurally wrong for this feature. Reading `unknown[][]` and validating
   in `src/lib/` also means every rule is unit-testable with plain arrays — no file, no database.
3. **Three stages, and the middle one writes NOTHING.** `readSheet` → `planImport` → `applyImport`.
   The dry run is not a preview of the commit, it *is* the commit's input: `applyImport` takes the plan
   and writes only rows the plan marked applicable, so the operator's verdict and the write cannot
   disagree. This is the whole safety model — the first feature in this project that writes rows
   nobody typed.
4. **Partial import is the default and is not optional.** There is no all-or-nothing switch. A file
   with 3 bad rows out of 200 imports 197 and reports 3, grouped by cause.
5. **Import row cap: 2,000 rows per file.** `BULK_MAX` is 200 for bulk actions and the export cap is
   10,000; 2,000 sits between them deliberately — an import writes one `AuditEntry` per row (decision
   7), so 10,000 would put 10,000 rows into an append-only table from one click. Refused with a count
   and the same "narrow it and repeat" shape `bulkRequestStatusChange` uses.
6. **Rate limiting uses the `import` kind that already exists.** `src/lib/rate-limit.ts` has held
   `import: { limit: 10, windowMs: 60_000 }` since Phase 1. Pass `checkRate(actor.id, "import")`.
   Do not write `10` anywhere (§6a rules 26, 37, 38).
7. **One `AuditEntry` per imported row**, matching `bulkRequestStatusChange`'s precedent: `entityType`
   `"asset"`/`"employee"`, action `"import-create"` or `"import-update"`, and a diff that is a real
   from-null (create) or a real `diffOf` (update). **Never a from-equals-to key** (§6a rules 8, 19).
   The action names are namespaced rather than bare `"create"`/`"update"` for the reason
   `setEndpointActive` namespaced its own (§6a rule 22).
8. **The dry run is per-request and is never persisted.** No `ImportJob` table, no migration in this
   phase. The uploaded file round-trips through the client between Validate and Results: the plan is
   returned to the browser, and Apply posts it back. That bounds the feature to one migration-free
   phase, and it is safe because `applyImport` re-validates every row it is handed (decision 3's
   guard) — a tampered plan cannot make it write something `planImport` would have refused.
9. **Exports become `.xlsx` and `src/lib/csv.ts` is deleted.** Its only consumer is the assets export
   route. `csvCell`'s formula-injection guard has no `.xlsx` equivalent to write, because
   `write-excel-file` emits typed cells and a string cell is not evaluated as a formula — the guard was
   a CSV-specific defence and does not carry over. Delete the module and its 4 tests with the route
   conversion, in the same commit, so the suite never references a deleted file.
10. **`?ids=` refuses over 500 instead of slicing.** Today `route.ts:21` does
    `.slice(0, 500)`, so a 900-asset selection silently exports 500. That is §8's recorded gap and the
    exact behaviour the 10,000-row cap exists to prevent, one layer down. It becomes a 413 with a
    count, like the row cap.
11. **The four export routes share one column-spec module and one cap guard.** `assets`, `audit`,
    `employees`, `farewell-report` differ only in their query and their columns. A second copy of the
    cap check is how one route starts truncating again.
12. **No import for reference data.** A row naming a category or type that does not exist is BLOCKED
    with a "create it first" cause and a link, not silently creating taxonomy as a side effect of an
    asset upload. The brief's "Create category" fix button links to `/admin/asset-categories`; it does
    not create anything inline.
13. **Import may set `status`/`assignee` on CREATE; on UPDATE it never moves them.** Added
    2026-08-22, at Task 7's quality review, because the plan never asked the question and the shipped
    draft answered it wrongly by default. Everywhere else in this app those two fields move only
    through the approval queue: `updateSchema` (`src/server/modules/inventory/actions.ts:279`) excludes
    both — *"tag is immutable; status/assignee move via approvals"* — and `creationPlan`
    (`src/lib/asset-rules.ts:14`) always creates SPARE, turning a requested DEPLOYED into a
    `lifecycle.assign` approval. A spreadsheet that wrote them directly would be the only surface in
    the system able to flip 500 assets' status with no approval, no SLA and no `approval.requested`
    trail. **Create honours the sheet** — an import's job is entering a fleet that is already deployed,
    and all eight statuses are legitimate there; `CREATABLE_STATUSES` is an affordance of the New Asset
    form, not a database invariant. **Update refuses the move**, blocking with `lifecycle-via-import`
    and offering `keepCurrentLifecycle` to apply the row's other columns and leave the lifecycle alone.
14. **Every block cause offers a fix the operator can act on inside the wizard.** The vocabulary always
    asserted this; Task 7 shipped violating it, because `unknown-vendor` linked to `/admin/vendors`,
    which does not exist — and `src/server/modules/admin/reference-actions.ts:15` is
    `z.enum(["category","type","department"])`, so **no surface in this application can create a
    `Vendor`**. So: a cause whose remedy is a screen we have links to it; a cause whose remedy is a
    decision becomes an `ImportOption`; a cause whose only remedy is the sheet itself gets the
    `reupload` fix kind, which T11 renders as the wizard's own restart rather than an anchor to the
    page the operator is standing on. Nothing is left with a button that cannot work, and the test
    asserts every href against the routes that exist.

---

## File structure created/modified in this phase

**Created — pure, unit-tested, no I/O:**
- `src/lib/import-vocabulary.ts` — the `BlockCause` union, its human labels and fix actions, the row-cap
  constant, and `groupByCause`. The one owner of every sentence the Results step prints.
- `src/lib/import-vocabulary.test.ts`
- `src/lib/import-assets.ts` — the asset column spec, header matching, per-row coercion and validation,
  new-vs-update determination. Takes plain arrays, returns verdicts.
- `src/lib/import-assets.test.ts`
- `src/lib/import-employees.ts` — the same for employees, reusing `import-vocabulary`.
- `src/lib/import-employees.test.ts`
- `src/lib/export-columns.ts` — the four column specs (label, width, type, accessor key) shared by the
  route handlers. Pure data.
- `src/lib/export-columns.test.ts`

**Created — thin I/O boundaries:**
- `src/server/xlsx/write.ts` — `toXlsxBuffer(columns, rows)`; the only `write-excel-file` import.
- `src/server/xlsx/write.test.ts` — writes a buffer and reads it back with `read-excel-file`.
- `src/server/import/read-sheet.ts` — `readGrid(file)`; the only `read-excel-file` import.
- `src/server/export/respond.ts` — `xlsxResponse(name, buffer)` and `capRefusal(count, cap)`; the one
  owner of the cap message and the download headers (decision 11).

**Created — server modules:**
- `src/server/modules/import/asset-actions.ts` — `planAssetImport`, `applyAssetImport`.
- `src/server/modules/import/employee-actions.ts` — `planEmployeeImport`, `applyEmployeeImport`.
- `src/server/modules/import/resolve.ts` — name→id resolution for category/type/assignee/vendor,
  shared by both planners.

**Created — routes and UI:**
- `src/app/(app)/audit/export/route.ts`
- `src/app/(app)/employees/export/route.ts`
- `src/app/(app)/offboarding/[employeeId]/report/export/route.ts`
- `src/app/(app)/inventory/import/page.tsx`
- `src/app/(app)/employees/import/page.tsx`
- `src/components/import/import-wizard.tsx` — the 3-step stepper, used by both import pages.
- `src/components/import/blocked-causes.tsx` — grouped causes with fix actions.
- `e2e/import-export.spec.ts`

**Modified:**
- `src/app/(app)/inventory/export/route.ts` — xlsx, shared cap guard, `?ids=` refusal.
- `src/components/inventory/inventory-toolbar.tsx` — split-by-year chips.
- `src/lib/inventory-list.ts` — year facet helper.
- `src/lib/workspaces.ts` — nav entries + path rules for the two import pages and three export routes.
- `package.json`, `package-lock.json` — the two dependencies.
- **Deleted:** `src/lib/csv.ts`, `src/lib/csv.test.ts`.

---

### Task 1: The two dependencies, installed so the Alpine image still builds

> ### AMENDED — as SHIPPED (`adaecca`). The procedure was right; its stated reason did not apply.
> All five steps ran clean: the Alpine `docker compose --profile prod build` completed for both the
> `web` and `migrate` targets, and the gates held at 474 tests.
>
> **But `git diff package-lock.json` contains no `os`/`cpu` entries at all** — not for either package
> nor for any of their five transitive deps (`fflate`, `saxen`, `unzipper-esm`, `node-int64`,
> `worker-f`). So there was nothing win32-only to drop, and the §7 hazard this task was built around
> could not have fired for THESE packages. That is a consequence of scope decision 1 rather than luck:
> choosing the pure-JS pair over `exceljs` (which pulls `archiver` and `unzipper`) is what made the
> lockfile platform-neutral. **Keep Step 2 anyway** — it is cheap, it is the only way to know, and the
> next dependency this project adds may not be pure JS.
>
> One side effect worth knowing: **`graceful-fs` lost its `"dev": true` flag**, because
> `unzipper-esm` is a production dependency of `read-excel-file` and pulls it into the production tree.
> Harmless, and the reason the prod image grew.

This is a real task in this repo, not boilerplate. HANDOVER §7: installing any npm package **on
Windows** drops the Linux optional-dependency trees from `package-lock.json`, which breaks the Alpine
production image — and the failure appears at `docker compose --profile prod build`, not at
`npm install`. Both new packages are pure JS with no native bindings, which makes this recoverable, but
the lockfile still has to be regenerated in Linux.

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install both, and pin them**

```bash
npm install write-excel-file@^4.1.1 read-excel-file@^9.3.10
```

- [ ] **Step 2: Regenerate the lockfile inside Linux**

This is the §7 procedure, verbatim. In Git Bash, `MSYS_NO_PATHCONV=1` stops the path being mangled.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w //app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only"
```

- [ ] **Step 3: Prove the production image still builds**

Run: `docker compose --profile prod build`
Expected: completes. If it fails on a missing optional dependency, Step 2 did not take — rerun it and
check `git diff package-lock.json` shows `os`/`cpu` entries for linux, not only win32.

- [ ] **Step 4: Confirm the dev gates are unmoved**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: clean, **474 tests** — no source changed yet, so a change here means the install broke
something.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add write-excel-file and read-excel-file"
```

---

### Task 2: The workbook writer (TDD)

> ### AMENDED — as SHIPPED (`b9d0f76`). The public shape is as planned; the internals are not.
> **Both API details this task flagged as uncertain were right as written** — `read-excel-file/node`
> does export `readSheet` as a NAMED export, and `write-excel-file/node`'s default export does take
> `{ columns }` with per-column `cell` functions and does have `.toBuffer()`. (`{ schema }` was removed
> from the library and now throws.) So the README-derived guesses held.
>
> **What the plan did NOT anticipate is a real bug: a zero-row export silently loses its header.**
> `write-excel-file`'s own dispatcher cannot tell an empty *objects* array from a pre-built empty
> *SheetData* — `node_modules/write-excel-file/commonjs/xlsx/generateXlsxFileContents.js:207` reads
> `if (arg1.length === 0 || Array.isArray(arg1[0]))` and takes the raw-SheetData branch, so line 231
> (the branch that calls `getSheetData` to build the header) never runs. With `rows: []` the emitted
> sheet contains `<sheetData/>` — no header, not even the labels. **The plan's Step 3 code, run as
> written, fails its own Step 1 test.** Verified independently by reading the dispatcher and by
> unzipping a generated file.
>
> The fix is to build the grid ourselves with the library's own **public** `getSheetData(rows, columns)`
> — declared in `node_modules/write-excel-file/node/index.d.ts:47`, so this is supported API and not an
> internal — and hand the resulting grid to `writeExcelFile`'s raw-SheetData overload. The grid always
> contains the header row, so it is never length-0 and the ambiguity cannot arise.
>
> **A comment in the plan also claimed something false about the library**, and it is corrected in the
> shipped code rather than repeated: the plan said write-excel-file "writes an empty cell for undefined
> and the literal for null". It does not. Its `row.js`'s `isEmpty()` treats `undefined`, `null` and `""`
> identically, so both already produce an empty cell. The `value ?? undefined` coercion is still
> required, but purely to satisfy the library's published TYPE (`CellObject.value` excludes `null`) —
> it is a type-checker requirement, not a runtime fix. Rule 16's shape, caught before it shipped.
>
> The `XlsxColumn` type also now imports the library's real `Value` and `CellObject["type"]` rather
> than the plan's `unknown` placeholders, adding only `| null` for this app's nullable columns — so the
> boundary is provably compatible with the library's contract instead of opaque.
>
> **On the deliberate-breakage check**, which produced a finding of its own: removing `?? undefined` is
> caught by `tsc`, NOT by the round-trip test — because null and undefined really are identical at
> runtime. Stringifying null to `"null"` IS caught by the test. So the test guards the failure mode it
> is named for, but the type system is what guards the coercion. Worth knowing before anyone
> "simplifies" either one away.

One module owns `write-excel-file`. Its test writes a real buffer and reads it back with
`read-excel-file`, which is both a round-trip assertion and the cheapest possible proof that the two
libraries agree — a test that only asserted "a Buffer came back" would pass on a corrupt file.

**NOTE FOR THE IMPLEMENTER — read this before you debug anything.** The `write-excel-file` and
`read-excel-file` call shapes in this plan are written from their published READMEs and have **not been
executed**. Two specific things to confirm against the installed versions, because they are where a
README most often lags: whether `read-excel-file/node` exports `readSheet` as a **named** export (this
plan assumes named: `import { readSheet } from "read-excel-file/node"`) or as a default, and whether
`writeExcelFile` takes `{ columns }` with per-column `cell` functions (assumed here) or `{ schema }`.
If either differs, the failing test in Step 2 is the discovery and **the plan is what is wrong** — fix
the code, then amend this task. Do not contort the code to match the plan.

**Files:**
- Create: `src/server/xlsx/write.ts`, `src/server/xlsx/write.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { toXlsxBuffer, type XlsxColumn } from "./write";

interface Row { tag: string; cost: number | null; purchasedAt: Date | null }

const COLUMNS: XlsxColumn<Row>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Cost", width: 12, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Purchased", width: 14, cell: (r) => ({ value: r.purchasedAt, type: Date, format: "yyyy-mm-dd" }) },
];

describe("toXlsxBuffer", () => {
  it("round-trips a header row and typed cells", async () => {
    const buffer = await toXlsxBuffer(COLUMNS, [
      { tag: "BR-LT-0148", cost: 51234.56, purchasedAt: new Date("2024-03-01T00:00:00Z") },
    ]);
    const grid = await readSheet(buffer);
    expect(grid[0]).toEqual(["Tag", "Cost", "Purchased"]);
    expect(grid[1][0]).toBe("BR-LT-0148");
    expect(grid[1][1]).toBe(51234.56);
    expect(grid[1][2]).toBeInstanceOf(Date);
  });

  // A null cell must be an EMPTY cell, not the string "null" — every nullable
  // column in this app (cost, serial, assignee) hits this on the first export.
  it("writes a null as an empty cell, never as text", async () => {
    const buffer = await toXlsxBuffer(COLUMNS, [{ tag: "BR-LT-0001", cost: null, purchasedAt: null }]);
    const grid = await readSheet(buffer);
    expect(grid[1][1] ?? null).toBeNull();
    expect(grid[1][2] ?? null).toBeNull();
  });

  it("writes a header even when there are no rows, so an empty export is still a valid sheet", async () => {
    const buffer = await toXlsxBuffer(COLUMNS, []);
    const grid = await readSheet(buffer);
    expect(grid[0]).toEqual(["Tag", "Cost", "Purchased"]);
    expect(grid).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/server/xlsx/write.test.ts`
Expected: FAIL — `Cannot find module './write'`.

- [ ] **Step 3: Write the module**

As shipped:

```ts
import writeExcelFile, { getSheetData } from "write-excel-file/node";
import type { CellObject, Column, Value } from "write-excel-file/node";

/**
 * One column of an export sheet. `cell` returns almost write-excel-file's own
 * cell shape (`Value`/`CellObject["type"]` come straight from the library, so
 * a caller can set a real `type`/`format` without this module knowing
 * anything about the domain) — except `value` may be `null`, because every
 * nullable column in this app (cost, serial, assignee) needs to say "no
 * value" and the library's own type only allows `undefined` for that. The
 * translation happens once, below, rather than in every caller.
 *
 * The header is always bold: these files are opened in Excel by people, and a
 * sheet whose first row looks like data is one AutoFilter away from being
 * sorted into nonsense.
 */
export interface XlsxColumn<T> {
  label: string;
  width?: number;
  cell: (row: T) => { value: Value | null; type?: CellObject["type"]; format?: string };
}

/**
 * The ONLY `write-excel-file` import in the app. Everything else passes
 * columns and rows. Returns a Buffer rather than writing a file: these are
 * HTTP downloads and nothing should touch the filesystem to serve one.
 */
export async function toXlsxBuffer<T>(columns: XlsxColumn<T>[], rows: T[]): Promise<Buffer> {
  const libColumns: Column<T>[] = columns.map((c) => ({
    header: { value: c.label, fontWeight: "bold" as const },
    width: c.width,
    // `value ?? undefined`: at runtime write-excel-file treats `null` and
    // `undefined` identically (both become an empty cell — see its
    // `row.js`'s `isEmpty()`), but its published type only allows
    // `undefined` in `CellObject.value`. This coercion exists to satisfy
    // that type, not to work around a real behavioural difference — do not
    // read it as one.
    cell: (row: T): CellObject => {
      const out = c.cell(row);
      return { value: out.value ?? undefined, type: out.type, format: out.format };
    },
  }));

  // `writeExcelFile(rows, { columns })` cannot tell an empty *objects* array
  // apart from an already-empty *sheet*: its own dispatcher treats a
  // zero-length first argument as pre-built SheetData and never calls
  // `columns[].cell`/`header` at all, so a zero-row export would silently
  // come out with no header row either. Building the grid ourselves with
  // `getSheetData` sidesteps that ambiguity — the header row is always
  // present, so the grid this hands to `writeExcelFile` is never actually
  // empty, even when `rows` is.
  const sheetData = getSheetData(rows, libColumns);
  return writeExcelFile(sheetData, {
    columns: libColumns.map((c) => ({ width: c.width })),
  }).toBuffer();
}
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run src/server/xlsx/write.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/xlsx/write.ts src/server/xlsx/write.test.ts
git commit -m "feat(export): one xlsx writer, round-tripped by its own test"
```

---

### Task 3: The shared response helpers, and the assets export becomes xlsx

> ### AMENDED — as SHIPPED (`f558c53`). **The plan's column spec silently dropped two columns.**
> The CSV export this task converts emitted **fourteen** columns; the plan's `ASSET_EXPORT_COLUMNS`
> listed twelve. Missing: **`Employee no`** (`assignee.employeeNo`) and **`RMA ref`** (`asset.rmaRef`) —
> both real columns of the shipped CSV (see `git show f558c53~1:"src/app/(app)/inventory/export/route.ts"`,
> the `toCsv` header). Nothing in the scope decisions authorised dropping data: decision 9 covers
> deleting the CSV module and its formula-injection guard, not narrowing the sheet. Shipped with all
> fourteen, in their original positions.
>
> **This is worth more than the fix.** A task framed as "convert the format" is one where a column list
> retyped by hand looks complete and is not, and the plan's own tests could not catch it — they assert
> unique non-empty labels and that Tag comes first, all of which a twelve-column spec satisfies. When
> a task rewrites an existing output, **diff the old output's fields against the new spec** rather than
> reviewing the new spec on its own merits. Same family as §6a rule 39 (copying a pattern but not all
> of it), one layer up: this copied a route and not all of its columns.
>
> Everything else in the plan matched reality — the `toXlsxBuffer` signature, the `capRefusalText` /
> `idsRefusalText` shapes, and the route's existing `repairStageIds` logic, which survives untouched.
>
> Verified without a browser, and the reason is worth recording: the implementer declined to type the
> seeded fixture password into a login form (entering any password into a field is on its prohibited
> list) and instead used §7's recommended route — a throwaway `tsx` script under the gitignored
> `backups/`, calling the route's exact `buildAssetWhere` / `buildAssetOrderBy` / `toXlsxBuffer` path
> against the live seeded database, then deleted. It confirmed 25 assets, a 5,091-byte buffer, the
> fourteen-column header in order, 25 data rows, and a `Cost` cell round-tripping as a JS `number`
> matching its source `Decimal` — which is the `.toNumber()` boundary working. **Unverified by eye:**
> whether the header renders bold and Cost right-aligns in real Excel. Task 13's e2e covers the route;
> the visual pass does not exist yet.
>
> **Two review fixes landed on top (`1cd405c`), both worth carrying into Tasks 4 and 5.**
> `exportFilename` now enforces its own guarantee instead of asserting a caller-side convention: it
> strips anything outside `[A-Za-z0-9_-]` from the prefix. The comment had claimed the filename is
> "never from user input" — true of `"assets"`, and about to be false, because **Task 5 passes
> `farewell-${report.employeeNo}` and `employeeNo` is `String @unique` with no format constraint
> anywhere** (not in `prisma/schema.prisma:196`, not in any zod schema in `src/`). Reproduced before
> fixing: a `"` yields `attachment; filename="farewell-EMP"0042.xlsx"`, breaking out of the quoted
> attribute. CRLF is NOT exploitable — Node's `Headers` throws on it — so this was a malformed header,
> not header splitting. Fixed in the one function that writes download headers, with 4 tests.
> And `export-columns.test.ts` now pins the **full ordered 14-label list**, because the twelve-column
> spec passed every assertion the file previously had. The regression that actually happened was caught
> by diffing a deleted file; now the suite catches it.

Scope decisions 9, 10 and 11. The cap message and the `?ids=` refusal get exactly one owner each,
because four routes are about to want them.

**Files:**
- Create: `src/server/export/respond.ts`, `src/lib/export-columns.ts`, `src/lib/export-columns.test.ts`
- Modify: `src/app/(app)/inventory/export/route.ts`
- Delete: `src/lib/csv.ts`, `src/lib/csv.test.ts`

- [ ] **Step 1: Write the failing test for the column spec and the cap message**

```ts
import { describe, expect, it } from "vitest";
import { ASSET_EXPORT_COLUMNS, EXPORT_CAP, IDS_CAP, capRefusalText, idsRefusalText } from "./export-columns";

describe("export column specs", () => {
  it("gives every column a label and no duplicates — a repeated header breaks Excel's AutoFilter", () => {
    const labels = ASSET_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("names the tag first, because that is the column a human scans for", () => {
    expect(ASSET_EXPORT_COLUMNS[0].label).toBe("Tag");
  });
});

describe("capRefusalText", () => {
  // The number is the ONE thing the operator needs and the one thing a
  // truncating export would never tell them (§6a rule 26 — one owner).
  it("states the actual count, the cap, and that nothing was exported", () => {
    const text = capRefusalText(12_403);
    expect(text).toContain("12403");
    expect(text).toContain(String(EXPORT_CAP));
    expect(text).toContain("Nothing was exported");
  });

  it("suggests the split that the UI actually offers", () => {
    expect(capRefusalText(20_000)).toContain("year");
  });
});

describe("idsRefusalText", () => {
  // Was a silent .slice(0, 500). A refusal has to read as a refusal.
  it("states the selection size and the cap, and does not read as the row-cap message", () => {
    const text = idsRefusalText(900);
    expect(text).toContain("900");
    expect(text).toContain(String(IDS_CAP));
    expect(text).not.toContain(String(EXPORT_CAP));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/export-columns.test.ts`
Expected: FAIL — `Cannot find module './export-columns'`.

- [ ] **Step 3: Write the column spec module**

```ts
import type { XlsxColumn } from "@/server/xlsx/write";

export const EXPORT_CAP = 10_000;

/**
 * A `?ids=` selection is a bulk selection from the list screen, so it is bounded
 * by what that screen can select. It used to be silently sliced here, which is
 * the same defect the row cap exists to prevent, one layer down (§8).
 */
export const IDS_CAP = 500;

export function capRefusalText(count: number): string {
  return (
    `Export refused: ${count} rows exceeds the ${EXPORT_CAP}-row cap. ` +
    "Narrow the filters — splitting by purchase year works well, and the year chips above the list do " +
    "exactly that — then try again. Nothing was exported."
  );
}

export function idsRefusalText(count: number): string {
  return (
    `Export refused: ${count} selected rows exceeds the ${IDS_CAP}-row selection cap. ` +
    "Export the filtered list instead of a selection, or select fewer. Nothing was exported."
  );
}

/** The asset sheet. Order is the order a human reads, not the schema's order. */
export const ASSET_EXPORT_COLUMNS: XlsxColumn<{
  tag: string; model: string; serial: string | null; categoryName: string; typeName: string | null;
  status: string; assigneeName: string | null; purchasedAt: Date | null; cost: number | null;
  warrantyUntil: Date | null; vendorName: string | null; notes: string | null;
}>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Serial", width: 20, cell: (r) => ({ value: r.serial }) },
  { label: "Category", width: 18, cell: (r) => ({ value: r.categoryName }) },
  { label: "Type", width: 18, cell: (r) => ({ value: r.typeName }) },
  { label: "Status", width: 14, cell: (r) => ({ value: r.status }) },
  { label: "Assigned to", width: 24, cell: (r) => ({ value: r.assigneeName }) },
  // Employee no and RMA ref are NOT optional extras — the CSV this replaces
  // emitted both, and leaving them out is a silent data loss dressed as a
  // format change. See this task's AMENDED banner.
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.assigneeNo }) },
  { label: "Purchased", width: 13, cell: (r) => ({ value: r.purchasedAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Cost", width: 13, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Warranty until", width: 14, cell: (r) => ({ value: r.warrantyUntil, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Vendor", width: 20, cell: (r) => ({ value: r.vendorName }) },
  { label: "RMA ref", width: 18, cell: (r) => ({ value: r.rmaRef }) },
  { label: "Notes", width: 40, cell: (r) => ({ value: r.notes }) },
];
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run src/lib/export-columns.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the response helper**

Create `src/server/export/respond.ts`:

```ts
import { capRefusalText, idsRefusalText } from "@/lib/export-columns";

/** text/plain, because these are read by a human in a browser tab, not parsed. */
function refusal(text: string): Response {
  return new Response(text, {
    status: 413,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const capRefusal = (count: number) => refusal(capRefusalText(count));
export const idsRefusal = (count: number) => refusal(idsRefusalText(count));

/**
 * The one place download headers are written. `filename` is quoted and the
 * name is built by the caller from a fixed prefix plus a date — never from
 * user input, which is what keeps this free of a header-injection question.
 */
export function xlsxResponse(filename: string, body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * `assets-2026-08-21.xlsx` — sortable, and unambiguous in a downloads folder.
 *
 * The prefix is stripped to `[A-Za-z0-9_-]` HERE rather than trusted from the
 * caller, because this is the one place a `content-disposition` is built and
 * one caller already passes a value derived from the database:
 * `farewell-${employeeNo}`, where `employeeNo` has no format constraint in the
 * schema or in any zod validator. An unstripped `"` breaks out of the quoted
 * filename attribute. (CRLF cannot: Node's `Headers` rejects it outright.) The
 * safe set covers every prefix this app passes.
 */
export function exportFilename(prefix: string, now: Date): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, "");
  return `${safePrefix}-${now.toISOString().slice(0, 10)}.xlsx`;
}
```

- [ ] **Step 6: Convert the assets route**

Replace the body of `src/app/(app)/inventory/export/route.ts` from the `idsParam` line through the
response with this. The `repairStageIds` cut and `buildAssetWhere` logic above it is unchanged and
must stay — §8 records that a derived facet's cut has to apply to every consumer of that `where`.

```ts
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : null;
  // Refuse rather than slice (scope decision 10). This check precedes the
  // query, so an over-large selection costs one comparison, not a fetch.
  if (ids && ids.length > IDS_CAP) return idsRefusal(ids.length);

  const state = parseListState(url.searchParams, INVENTORY_LIST_CONFIG);
  const cutIds = ids ? null : await repairStageIds(state);
  const where = ids
    ? { id: { in: ids } }
    : cutIds !== null
      ? { id: { in: cutIds } }
      : buildAssetWhere(state);

  const count = await prisma.asset.count({ where });
  if (count > EXPORT_CAP) return capRefusal(count);

  const assets = await prisma.asset.findMany({
    where,
    orderBy: ids ? { tag: "asc" } : buildAssetOrderBy(state.sort),
    include: { category: true, type: true, assignee: true, vendor: true },
  });

  const buffer = await toXlsxBuffer(
    ASSET_EXPORT_COLUMNS,
    assets.map((a) => ({
      tag: a.tag,
      model: a.model,
      serial: a.serial,
      categoryName: a.category.name,
      typeName: a.type?.name ?? null,
      status: a.status,
      assigneeName: a.assignee?.name ?? null,
      purchasedAt: a.purchasedAt,
      // Prisma.Decimal -> number at the boundary, once. `toNumber()` is exact
      // for Decimal(12,2) values in this range, and the sheet needs a number
      // or Excel right-aligns nothing and SUM() returns 0.
      cost: a.cost ? a.cost.toNumber() : null,
      warrantyUntil: a.warrantyUntil,
      vendorName: a.vendor?.name ?? null,
      notes: a.notes,
    })),
  );
  return xlsxResponse(exportFilename("assets", new Date()), buffer);
```

Imports for the top of the file:

```ts
import { toXlsxBuffer } from "@/server/xlsx/write";
import { ASSET_EXPORT_COLUMNS, EXPORT_CAP, IDS_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, idsRefusal, xlsxResponse } from "@/server/export/respond";
```

- [ ] **Step 7: Delete the CSV module**

```bash
git rm src/lib/csv.ts src/lib/csv.test.ts
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: clean. **475 tests** — 474 minus csv's 4, plus 5 from `export-columns.test.ts`.

Then in the preview, signed in: `/inventory/export` downloads `assets-<date>.xlsx` and Excel opens it
with a bold header row and right-aligned Cost. `/inventory/export?ids=<one id>` downloads one row.
Building a 501-id URL is impractical by hand — Task 12's e2e covers the refusal.

- [ ] **Step 9: Commit**

```bash
git add -A src/lib src/server/export src/server/xlsx "src/app/(app)/inventory/export/route.ts"
git commit -m "feat(export): assets export is xlsx, and an oversized selection is refused"
```

---

### Task 4: The audit and employees export routes

> ### AMENDED — as SHIPPED (`6c2083d` + `15490e5`). Two plan errors, one of them a correctness bug.
>
> **1. There is no `/inventory/export` PATH_RULES entry to copy.** Step 5 said to add rules "beside the
> existing `/inventory/export` rule". That rule has never existed — export routes ride the general
> prefix rules (`/^\/inventory(\/|$)/`, and `/^\/(employees|audit|offboarding|reservations)(\/|$)/`
> for these two), and `middleware.ts`'s matcher covers route handlers, so both new routes were already
> governed. Shipped with **four pinning tests** in `workspaces.test.ts` instead of a redundant rule:
> `/audit/export` passes for `it_staff` and is refused for `finance_staff`, `/employees/export`
> likewise against `purchasing_staff`. Access matches each route's own page, which is the rule.
>
> **2. THE EMPLOYEES EXPORT IGNORED THE PAGE'S FILTERS.** The plan's route took no `req` and exported
> the whole roster, while the audit route honoured its filter. `/employees` parses a full list state
> (search, facets, sort) **plus** a separate `gaps=1` flag. So filtering to "Policy gaps only" and
> clicking Export produced ten rows instead of three — a sheet contradicting the screen it was launched
> from.
>
> This is **§8's candidate-set rule**, which the assets export already obeys and which the plan
> silently broke for employees. The gaps cut cannot be expressed in SQL: `listEmployees` applies it in
> memory, after `resolvePolicy`/`computeLoadout` run per employee, so `buildEmployeeWhere(state)` alone
> yields the CANDIDATE set. §8: *"every consumer of that `where` needs the cut — not just the one that
> renders the list."* And `listEmployees` paginates, so the export cannot simply call it.
>
> Fixed by mirroring `repairStageIds`: a shared `filteredEmployees(state, gapsOnly)` in
> `src/server/modules/employees/queries.ts` owns the SQL fetch AND the in-memory cut;
> `listEmployees` paginates it, `employeeExportRows` takes it whole. **The `missingRequired > 0`
> expression now exists exactly once** (`queries.ts:67`, two callers at 81 and 117 — verified by grep,
> not by assertion). The page's Export link carries the current list state through.
>
> **`/audit` genuinely has no in-memory cut** — `buildAuditWhere` is pure SQL (a `contains` OR plus an
> `entityType` facet) and `AUDIT_LIST_CONFIG` declares no derived facets. So the asymmetry between the
> two routes is real, not a second oversight.
>
> **This invariant has no unit test and cannot easily get one** — `filteredEmployees` hits Prisma, like
> `listEmployees`, which has never had one either. Task 13's e2e is its only possible guard; the
> assertion is written into that task.

Scope decision 11 — these are a query and a column spec each.

**Files:**
- Create: `src/app/(app)/audit/export/route.ts`, `src/app/(app)/employees/export/route.ts`
- Modify: `src/lib/export-columns.ts`, `src/lib/export-columns.test.ts`, `src/lib/workspaces.ts`

- [ ] **Step 1: Add the two column specs, test-first**

Append to `src/lib/export-columns.test.ts`:

```ts
import { AUDIT_EXPORT_COLUMNS, EMPLOYEE_EXPORT_COLUMNS } from "./export-columns";

describe("audit and employee column specs", () => {
  it("gives each sheet unique labels", () => {
    for (const spec of [AUDIT_EXPORT_COLUMNS, EMPLOYEE_EXPORT_COLUMNS]) {
      const labels = spec.map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  // The audit sheet must carry the resolved entity LABEL, not the raw id —
  // /audit renders labels and an export that regressed to cuids would be
  // useless for the thing exports are for (§6a rule 20's spirit).
  it("the audit sheet names an entity label column, not an id", () => {
    const labels = AUDIT_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels).toContain("Entity");
    expect(labels.some((l) => /id/i.test(l))).toBe(false);
  });
});
```

Append to `src/lib/export-columns.ts`:

```ts
export const AUDIT_EXPORT_COLUMNS: XlsxColumn<{
  when: Date; actor: string; entityType: string; entityLabel: string; action: string; fields: string;
}>[] = [
  { label: "When", width: 18, cell: (r) => ({ value: r.when, type: Date, format: "yyyy-mm-dd hh:mm" }) },
  { label: "Actor", width: 26, cell: (r) => ({ value: r.actor }) },
  { label: "Entity type", width: 18, cell: (r) => ({ value: r.entityType }) },
  { label: "Entity", width: 32, cell: (r) => ({ value: r.entityLabel }) },
  { label: "Action", width: 20, cell: (r) => ({ value: r.action }) },
  { label: "Fields changed", width: 30, cell: (r) => ({ value: r.fields }) },
];

/**
 * Checked against `prisma/schema.prisma`'s `Employee`, which is narrower than
 * you might assume: there is **no email column**, the date is `joinedAt` not
 * `startedAt`, and `title` and `departmentId` are both REQUIRED. Do not add an
 * Email column here — nothing would fill it.
 */
export const EMPLOYEE_EXPORT_COLUMNS: XlsxColumn<{
  employeeNo: string; name: string; department: string; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; itemsHeld: number;
}>[] = [
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.employeeNo }) },
  { label: "Name", width: 26, cell: (r) => ({ value: r.name }) },
  { label: "Department", width: 20, cell: (r) => ({ value: r.department }) },
  { label: "Title", width: 24, cell: (r) => ({ value: r.title }) },
  { label: "Employment", width: 16, cell: (r) => ({ value: r.employment }) },
  // Nullable and deliberately last of the text columns: null means "never
  // synced", which is a real and common state, not a gap to be filled in.
  { label: "M365", width: 14, cell: (r) => ({ value: r.m365Status }) },
  { label: "Joined", width: 13, cell: (r) => ({ value: r.joinedAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Items held", width: 12, cell: (r) => ({ value: r.itemsHeld, type: Number }) },
];
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/export-columns.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3: Write the audit route**

`src/app/(app)/audit/export/route.ts`. It reuses `buildAuditWhere` and `entityLabels` so the sheet and
the page cannot disagree about either the filter or the label.

```ts
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { buildAuditWhere } from "@/lib/audit-list";
import { entityLabels } from "@/server/modules/audit/queries";
import { parseListState } from "@/lib/url-state";
import { AUDIT_LIST_CONFIG } from "@/lib/audit-list";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { AUDIT_EXPORT_COLUMNS, EXPORT_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, AUDIT_LIST_CONFIG);
  const where = buildAuditWhere(state);

  const count = await prisma.auditEntry.count({ where });
  if (count > EXPORT_CAP) return capRefusal(count);

  const entries = await prisma.auditEntry.findMany({ where, orderBy: { createdAt: "desc" } });
  // Batch-resolved, the same call /audit makes — N+1 here would be one query
  // per row on a 10,000-row export.
  const labels = await entityLabels(entries);

  const buffer = await toXlsxBuffer(
    AUDIT_EXPORT_COLUMNS,
    entries.map((e) => ({
      when: e.createdAt,
      actor: e.actorLabel,
      entityType: e.entityType,
      entityLabel: labels.get(`${e.entityType}:${e.entityId}`)!.label,
      action: e.action,
      fields: e.diff ? Object.keys(e.diff as object).join(", ") : "—",
    })),
  );
  return xlsxResponse(exportFilename("audit", new Date()), buffer);
}
```

- [ ] **Step 4: Write the employees route**

`src/app/(app)/employees/export/route.ts`:

```ts
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EMPLOYEE_EXPORT_COLUMNS, EXPORT_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";

export async function GET() {
  await requireUser();

  const count = await prisma.employee.count();
  if (count > EXPORT_CAP) return capRefusal(count);

  const employees = await prisma.employee.findMany({
    orderBy: { employeeNo: "asc" },
    include: {
      department: true,
      // The count the /employees list shows, from the same relation, so the
      // two cannot disagree.
      _count: { select: { assets: true } },
    },
  });

  const buffer = await toXlsxBuffer(
    EMPLOYEE_EXPORT_COLUMNS,
    employees.map((e) => ({
      employeeNo: e.employeeNo,
      name: e.name,
      // `department` is a required relation, so this is never null.
      department: e.department.name,
      title: e.title,
      employment: e.employment,
      m365Status: e.m365Status,
      joinedAt: e.joinedAt,
      itemsHeld: e._count.assets,
    })),
  );
  return xlsxResponse(exportFilename("employees", new Date()), buffer);
}
```

The field names above were checked against `prisma/schema.prisma` while this plan was written. Confirm
the back-relation name for `_count` (`assets`) still matches, and remember the general rule: **if the
schema and this plan disagree, the schema wins.**

- [ ] **Step 5: Gate both routes**

Add to `PATH_RULES` in `src/lib/workspaces.ts`, beside the existing `/inventory/export` rule, and add
an "Export" link to the audit and employees toolbars matching how `/inventory` offers its own. Confirm
the existing rule's shape first and copy it — `src/lib/workspaces.test.ts` asserts route access and
will fail loudly if a new route is ungoverned (§6a: default-deny).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Then download both in the preview and open them.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib src/app "src/app/(app)/audit/export" "src/app/(app)/employees/export"
git commit -m "feat(export): audit and employee sheets, on the shared cap guard"
```

---

### Task 5: The farewell-report export route

> ### AMENDED — as SHIPPED (`7df3388`). **The plan invented two fields for the third time.**
> `FAREWELL_EXPORT_COLUMNS` specified `decidedBy` and `decidedAt`. Neither exists: `Decision`
> (`src/lib/offboarding.ts:113`) carries `refNo`, `outcome`, `state`, `reason` and nothing else, and
> `grep -rn "decidedBy\|decidedAt" src/` returns nothing at all. Same mistake as Task 4's invented
> `email` column and Task 3's two dropped columns — **three column specs, three defects, and the
> pattern is always the same: a spec written from what the sheet ought to say rather than from what the
> source actually holds.** Shipped instead with the real fields the report page's own columns already
> show: `refNo` and `state` as **Request** and **Status**, and the plan's "Note" renamed **Reason** to
> match the page's header. Final order: Tag, Model, Outcome, Reason, Value, Request, Status.
>
> **Widening `Decision` to carry an approver and a timestamp was considered and declined** — see §8.
> Short version: "decided" is DERIVED from the approvals that exist (Phase 7 scope decision #3, no
> wizard-state table), so those fields are a feature against `AuditEntry`, not two properties to add,
> and adding them to a domain type for an export's benefit inverts the dependency.
>
> **The query is `getWizard(employeeId)`, not the plan's invented `getFarewellReport`** — already
> extracted in Phase 7, so no extraction was needed. Better than asked for: the implementer noticed the
> page and the route were both about to filter `WizardData.items` down to decided ones independently,
> and extracted `decidedItems(items)` (`queries.ts:180`) so both call one expression. That is rule 47
> pre-empted one layer down, and the page now calls the helper too.
>
> It also corrected a **stale promissory claim in the report's printed footer**, which said a real Excel
> export would "land with Phase 8's export work". That became false the moment this task shipped, and it
> is the exact §6a rule 52 shape — a promise is a defect from the moment it ships until the task it
> names lands.
>
> **Verification was honest but thin, and that matters.** The live seeded database has **zero**
> `lifecycle_return` approvals, so Dennis (EMP-0090) has three held items and no decided ones — the
> page's count and the sheet's row count both came back 0 and "matched" at zero, which proves almost
> nothing. A synthetic non-DB round trip confirmed the mapping, null-cost cells and outcome labels. **A
> non-zero case is asserted in Task 13 instead**, where Phase 7's e2e already drives a full offboarding
> and can create the state.

The brief's fourth export. Phase 7 shipped the farewell report as a printable page
(`src/app/(app)/offboarding/[employeeId]/report/page.tsx`); this is the same data as a sheet.

**Files:**
- Create: `src/app/(app)/offboarding/[employeeId]/report/export/route.ts`
- Modify: `src/lib/export-columns.ts`, `src/lib/workspaces.ts`, the report page (an Export button)

- [ ] **Step 1: Read the existing report page first**

Read `src/app/(app)/offboarding/[employeeId]/report/page.tsx` and whatever query feeds it. **Reuse that
query.** The sheet must not re-derive the report — §6a rule 47 is exactly this shape, and the report
already computes decisions, outcomes and value-recovered that a second derivation would get subtly
wrong.

- [ ] **Step 2: Add the column spec**

Append to `src/lib/export-columns.ts` — adjust the row type to the report query's actual shape once
Step 1 has told you what that is:

```ts
export const FAREWELL_EXPORT_COLUMNS: XlsxColumn<{
  tag: string; model: string; outcome: string; decidedBy: string | null;
  decidedAt: Date | null; cost: number | null; note: string | null;
}>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Outcome", width: 18, cell: (r) => ({ value: r.outcome }) },
  { label: "Decided by", width: 24, cell: (r) => ({ value: r.decidedBy }) },
  { label: "Decided", width: 18, cell: (r) => ({ value: r.decidedAt, type: Date, format: "yyyy-mm-dd hh:mm" }) },
  { label: "Value", width: 13, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Note", width: 40, cell: (r) => ({ value: r.note }) },
];
```

- [ ] **Step 3: Write the route**

```ts
import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { FAREWELL_EXPORT_COLUMNS } from "@/lib/export-columns";
import { exportFilename, xlsxResponse } from "@/server/export/respond";
// The report's own query, from Step 1 — do not write a second one.
import { getFarewellReport } from "@/server/modules/offboarding/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  await requireUser();
  const { employeeId } = await params;
  const report = await getFarewellReport(employeeId);
  // No cap check: this is one employee's loadout, bounded by what one person
  // can hold. The cap guard exists for list exports; adding it here would be
  // a check that can never fire.
  const buffer = await toXlsxBuffer(FAREWELL_EXPORT_COLUMNS, report.items);
  return xlsxResponse(exportFilename(`farewell-${report.employeeNo}`, new Date()), buffer);
}
```

**If `getFarewellReport` does not exist under that name**, use whatever the page calls and correct this
code. If the page inlines its query, extract it into
`src/server/modules/offboarding/queries.ts` first, in its own commit, and have the page call it — that
extraction is the point, not a detour.

- [ ] **Step 4: Add the Export button to the report page and gate the route**

Match the report page's existing print affordance in placement and wording ("Export sheet"). Add the
`PATH_RULES` entry.

- [ ] **Step 5: Verify and commit**

Run the gates, then download the sheet for the seeded offboarded employee and check the row count
matches the printable page.

```bash
git add -A src/lib src/app src/server
git commit -m "feat(export): the farewell report as a sheet, from the report's own query"
```

---

### Task 6: Split-by-year chips

> ### AMENDED — as SHIPPED (`cd2aff2`). Wider than planned, for a good reason.
> **The plan said "add it to `buildAssetWhere` itself, not the page" and did not say HOW.** That matters:
> `buildAssetWhere` takes a `ListState`, and `ListState` only round-trips `config.facets` through
> `serializeListState`/`parseListState`. `purchaseYear` is deliberately **not** a facet (it is a
> nav-destination single value, per the `?state=` precedent). So threading it inside `ListState` would
> have seen it **silently dropped** across the export href, the bulk drawer's "act on all matching", and
> the toolbar's own navigation — which is Task 4's employees `gaps=1` bug exactly.
>
> Shipped as an explicit second parameter, `buildAssetWhere(state, purchaseYear)`, threaded the way
> `gapsOnly` is threaded through `listEmployees`/`employeeExportRows`, plus one owner
> (`withPurchaseYearQS`) for splicing it back onto a serialized query string wherever one is rebuilt.
> That touched six files rather than three — `actions.ts` and `page.tsx` included — and the extra
> surface is the point: **all six consumers of that `where` now inherit the filter.** Verified caller by
> caller: `listAssets`, `repairStageIds`, the four `facetOptions` groupBys (each via `without(facet)`),
> the export route, and `bulkRequestStatusChange`, which parses `purchaseYear` off the same serialized
> string it already reconstructs `state` from. `purchaseYearBuckets` deliberately passes NO
> `purchaseYear` — it is the year facet's own count, so by the `without(facet)` rule it must not apply
> its own filter, and clicking a chip therefore shows exactly the count printed on it.
>
> **`purchaseYear` needs no in-memory cut** — unlike the repair `stage` facet it is fully expressible in
> SQL — so it is simpler than `repairStageIds`, not another instance of it. Said in a comment so nobody
> later assumes otherwise.
>
> **Grouping is in memory** over a `purchasedAt`-only projection, because Prisma's `groupBy` cannot
> extract a year and doing it in raw SQL would mean a second, driftable copy of `buildAssetWhere`.
>
> **The acceptance test passed on real data:** buckets `{2020:1, 2021:1, 2022:2, 2023:3, 2024:15,
> 2026:3}` summing to 25/25; `?purchaseYear=2026` exporting exactly 3 rows, all 2026; `SPARE` 5 overall
> and 2 within 2026, so it composes with other facets. `purchaseYear=none` produces `{purchasedAt: null}`
> and runs clean but returns 0 — **the seed has no undated assets, so that case is carried by unit tests
> only** (rule 65: an equality at zero is not evidence). `e2e/it-core.spec.ts` 20/20, including the
> export test.
>
> **A review fix landed on top (`0c37a98`), and it is the finding worth keeping from this task.**
> Two hrefs hand-rolled `serializeListState` and so **dropped the year**: `inventory-table.tsx`'s sort
> handler (clicking ANY column header from a year-filtered list cleared the chip — zero preconditions,
> the most routine interaction with the table) and `repair-chips.tsx`'s stage chips (two clicks away).
> Not a data-integrity bug — the export and `bulkRequestStatusChange` both derive from the current URL,
> so nothing ever acted on a set the screen was not showing — but it defeated the feature's stated
> purpose, since `capRefusalText` promises these chips are the escape from a cap refusal and the escape
> vanished on the next sort.
>
> **Fixed structurally rather than by patching two call sites**: the page's `href` builder is passed
> down, so neither component knows the year exists and neither imports `serializeListState` — the
> mistake became unavailable rather than merely corrected. Five places built an `/inventory` URL; three
> were right, two were wrong, and nothing had prevented a sixth from being wrong too.
>
> **The controller's suggested one-liner did not survive contact, and the reason is worth recording:**
> `InventoryTable` is a `"use client"` component, so it **cannot** take a raw function prop from a
> Server Component page. It receives a precomputed `sortHrefs: Record<string, string>` instead;
> `RepairChips`, a Server Component, does take the builder. **That failure mode is invisible to `tsc`,
> `lint` AND `build`** — it only surfaces when the page renders, i.e. under Playwright. Worth knowing
> before passing a callback across that boundary again.
>
> Guarded by a new e2e assertion (`e2e/it-core.spec.ts`: from `?purchaseYear=2024`, click Model, assert
> BOTH `sort=model` and `purchaseYear=2024` survive) — the only kind of test that can see a client
> navigation. 21/21. **`clearFilters` deliberately DOES drop the year**: it is the same start-over
> gesture as clearing any other facet, matching the `gaps=1` precedent.
>
> Recorded, not fixed: **there is no "All years" chip**, so clearing just the year needs "Clear filters".
> Matches the plan as written; a minor UX gap for Phase 10's polish pass.

Brief `[5a]`: "offer split-by-year chips **sized to their counts**". They are the concrete escape from
the cap refusal, which is why `capRefusalText` points at them.

**Files:**
- Modify: `src/lib/inventory-list.ts`, `src/lib/inventory-list.test.ts`,
  `src/components/inventory/inventory-toolbar.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/inventory-list.test.ts`:

```ts
import { purchaseYearChips } from "./inventory-list";

describe("purchaseYearChips", () => {
  it("is newest-first, because a recent year is the likelier filter", () => {
    const chips = purchaseYearChips([{ year: 2024, count: 9 }, { year: 2026, count: 4 }]);
    expect(chips.map((c) => c.year)).toEqual([2026, 2024]);
  });

  it("carries the count, so a chip can be sized to it", () => {
    expect(purchaseYearChips([{ year: 2026, count: 4 }])[0].count).toBe(4);
  });

  // A NULL purchasedAt is a real state in this schema and those assets are
  // exactly the ones a year filter would hide forever.
  it("keeps a bucket for assets with no purchase date, and puts it last", () => {
    const chips = purchaseYearChips([{ year: 2026, count: 4 }, { year: null, count: 2 }]);
    expect(chips[chips.length - 1]).toEqual({ year: null, count: 2, label: "No date", href: "/inventory?purchaseYear=none" });
  });

  it("returns nothing for an empty fleet rather than a single empty chip", () => {
    expect(purchaseYearChips([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/inventory-list.test.ts`
Expected: FAIL — `purchaseYearChips is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/inventory-list.ts`:

```ts
export interface YearChip { year: number | null; count: number; label: string; href: string }

/**
 * Newest year first, `null` (no purchase date) last. The count rides on the
 * chip so the toolbar can size it — a chip that does not say how many rows it
 * would leave is not an answer to a cap refusal.
 */
export function purchaseYearChips(buckets: Array<{ year: number | null; count: number }>): YearChip[] {
  const dated = buckets.filter((b) => b.year !== null).sort((a, b) => b.year! - a.year!);
  const undated = buckets.filter((b) => b.year === null);
  return [...dated, ...undated].map((b) => ({
    year: b.year,
    count: b.count,
    label: b.year === null ? "No date" : String(b.year),
    href: `/inventory?purchaseYear=${b.year === null ? "none" : b.year}`,
  }));
}
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run src/lib/inventory-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the buckets and the filter**

`buildAssetWhere` must honour `purchaseYear`: a year narrows to
`purchasedAt: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) }`, and `none`
narrows to `purchasedAt: null`. **Add it to `buildAssetWhere` itself, not to the page** — §8 records
that every consumer of that `where` (list, facet counts, export, bulk) needs the same cut, and the
export is precisely the consumer this feature exists for.

Group the buckets in the inventory query with a raw `date_part` grouping or by grouping in memory over
`purchasedAt` — whichever the module already does for its other facet counts; match it.

- [ ] **Step 6: Render the chips**

In `inventory-toolbar.tsx`, beside the existing facet controls, using the `Pill`/chip primitive the
toolbar already uses for filters. Each chip's count renders in the same mono style
`endpoint-editor.tsx` uses for counts. The active chip reflects `?purchaseYear=`.

- [ ] **Step 7: Verify and commit**

Gates, then in the preview confirm the chips appear, the counts sum to the fleet total, clicking one
writes `?purchaseYear=`, the list narrows, and **`/inventory/export?purchaseYear=2026` exports only
that year** — that last one is the whole point.

```bash
git add src/lib src/components/inventory/inventory-toolbar.tsx
git commit -m "feat(inventory): split-by-year chips, and an export that honours them"
```

---

### Task 7: The import vocabulary and the asset row rules (TDD)

> ### AMENDED — BEFORE IT SHIPS. **The plan below is wrong in seven ways, and `8c4e8c0` implemented it faithfully.**
> `8c4e8c0` is this task verbatim, and a spec-compliance review passed it byte-for-byte. That is the
> point: the code was never the problem. An opus review asked *"is the rule right?"* instead and found
> **seven Critical defects, all of them in the plan text**, every one invisible to a green 542-test
> suite. Same pattern as Tasks 1–5 — the plan's author reasoned outward from the vocabulary and never
> opened `prisma/schema.prisma`, `src/lib/asset-rules.ts` or `src/server/modules/inventory/actions.ts`
> to find what the rest of the application already guarantees. **This section is now the spec; the code
> blocks further down are the superseded draft, kept because the diff against them is the lesson.**
>
> **The two defects that matter most, because they are this module's whole reason for existing.** The
> dry run must issue a verdict the commit cannot contradict, and as written it does not:
> - **C-1. A tag match skips the serial check** (`import-assets.ts:182`, `if (!updateAssetId && serial)`).
>   A row whose tag is asset A's and whose serial is asset B's is reported as a clean update to A
>   carrying B's serial. `Asset.serial` is `@unique`, so T10's write raises P2002 **on a row the
>   operator was shown as fine**. The plan's own mutation #1 was a dud precisely because no fixture
>   pairs a matching tag with a taken serial.
> - **C-2. Intra-file duplicates are structurally invisible.** Both maps are built from the database and
>   nothing accumulates what earlier rows in *this file* claimed, so two rows sharing a tag both plan as
>   creates. That is the single likeliest real-world file shape: a copy-paste while editing an export.
>
> **Two settled decisions (user, 2026-08-22), which the plan never asked and which set the shapes
> T8–T11 build against:**
>
> **D-A. Import may set `status`/`assignee` on CREATE; on UPDATE it never moves them.** Everywhere else
> in this app those two fields move only through the approval queue — `updateSchema`
> (`actions.ts:279`) excludes both, with the comment *"tag is immutable; status/assignee move via
> approvals"*, and `creationPlan` (`asset-rules.ts:14`) always creates SPARE, turning a requested
> DEPLOYED into a `lifecycle.assign` approval. Left as planned, a spreadsheet would be the only surface
> in the system that can flip 500 assets' status with no approval, no SLA and no `approval.requested`
> trail. **Create honours the sheet** because an import's job is entering a fleet that is *already*
> deployed, and all eight statuses are legitimate there (`CREATABLE_STATUSES` is an affordance of the
> New Asset form, not a database invariant — say so in a comment, since a later reader will otherwise
> "fix" this to match). **Update refuses the move**: a Status or Assigned-to cell that disagrees with
> the record is blocked, with an option to update the row's other fields and leave the lifecycle alone.
>
> **D-B. Every block cause keeps a fix the operator can act on right now.** The vocabulary asserts this
> (`"offers a fix for every cause"`) and shipped violating it: **`unknown-vendor` links to
> `/admin/vendors`, which does not exist** — `src/app/(app)/admin/` has no such directory, so the href
> falls through to the `[...pending]` catch-all and renders a `PLANNED` empty state, and
> `reference-actions.ts:15` is `z.enum(["category","type","department"])`, so **no surface in this
> application can create a `Vendor` at all**. The test passed because it asserts non-null and checks
> only the category's href. §6a rule 10's exact shape, now the sixth instance. Three further causes
> link to `/inventory/import` — the page the operator is standing on, which does not exist until T11.
>
> **The amended vocabulary** (`src/lib/import-vocabulary.ts`):
> - `ImportOption` becomes `"treatDuplicateSerialAsUpdate" | "dropUnknownAssignee" | "dropUnknownVendor" | "keepCurrentLifecycle"`.
> - `BlockFix["kind"]` gains `"reupload"` — a fix with no href that T11 renders as the wizard's own
>   restart. It is what `missing-tag`, `bad-tag`, `missing-model`, `bad-date`, `bad-number`,
>   `duplicate-in-file`, `ambiguous-assignee` and `value-too-long` all honestly offer.
> - `unknown-vendor`'s fix becomes `{ kind: "option", option: "dropUnknownVendor" }`, "Import without
>   the vendor". `Asset.vendorId` is nullable and purely informational, and the edit form already has a
>   vendor picker — so dropping it loses nothing unrecoverable. The current design has the asymmetry
>   backwards: the semantically loaded `assignee` gets a drop option while the decorative field hard-
>   blocks. **Its `explain` must also stop saying "create it first and re-upload", which is an
>   instruction the operator cannot follow.**
> - `bad-status`'s `explain` names all eight statuses inline from `ASSET_STATUSES`
>   (`src/lib/inventory-list.ts:5`) rather than linking to `/inventory`, whose facet chips only show
>   statuses currently in use — an operator cannot learn `DONATED` is legal from a list containing none.
>   Rules 26/37/38: derive the list, never retype it.
> - **New causes**, appended in this order (the order is the `groupByCause` tiebreak, so it is API):
>   `bad-tag`, `missing-model`, `duplicate-in-file`, `ambiguous-assignee`, `inactive-assignee`,
>   `deployed-without-holder`, `lifecycle-via-import`, `value-too-long`.
> - The test's promise becomes real: **every `link` fix's href must be a route that exists**, and every
>   `option` must be a member of `ImportOption`. Assert it over all of `BLOCK_CAUSES`, not one example.
>
> **The amended shapes** (`src/lib/import-assets.ts`) — these are the T9 contract, and the reason this
> rework happens before T8 rather than after T11:
> - `types: Map<string, { id: string; categoryId: string }>`. `AssetType` is
>   **`@@unique([categoryId, name])`, not globally unique**, so a flat name→id map is lossy by
>   construction, and both write paths already enforce `type.categoryId !== d.categoryId` →
>   *"That type doesn't belong to the chosen category"* (`actions.ts:189` and `:296`). As planned, the
>   import can pair `Laptops` with a `Furniture` type and produce **an asset its own edit form cannot
>   save**. Resolve the type *after* the category and check the pair.
> - `employees: Map<string, { id: string; employment: EmploymentStatus; ambiguous: boolean }>`.
>   `Employee.name` is **not** unique (only `employeeNo` is), so a name matching two employees currently
>   resolves to whichever T9 inserted last — a silent wrong assignment. A name key that matches more
>   than one employee is `ambiguous` and blocks; an `employeeNo` key never is. `createAsset` also
>   refuses a non-ACTIVE assignee (*"assignments are frozen"*, `actions.ts:196`) — so does this.
> - `byTag: Map<string, { id: string; serial: string | null; status: AssetStatus; assigneeId: string | null }>`.
>   The update branch cannot detect a lifecycle move (D-A) without the record's current values.
> - **`AssetImportData` splits into `AssetCreateData` and `AssetUpdatePatch`.** One flat shape used for
>   both branches is C-7: on an update row it emits `null` for every column the operator did not fill,
>   which is a **destructive write**. Concretely — export 200 assets, delete the columns you don't care
>   about (which `matchHeaders` actively encourages, since only Tag/Model/Category are required),
>   re-upload, and wipe cost, purchase date, warranty, vendor and notes on 200 records. `updateAsset`
>   goes to real trouble to avoid exactly this. The patch must distinguish **absent** (`undefined` — the
>   sheet has no such column, leave it alone) from **explicitly blank** (`null` — a present column with
>   an empty cell, an intentional clear). Per D-A the patch carries neither `status` nor `assigneeId`,
>   and it never carries `tag`: the update-by-serial path as planned would **rename** the matched asset
>   (`{kind:"update", assetId:"a-9", data:{tag:"BR-NEW-0001"}}`), against `updateAsset`'s explicit
>   immutability rule.
>
> **The amended per-row rules, in application order.** First failing check still wins, one cause per row:
> 1. Every cell blank → **skip**, counted nowhere.
> 2. `tag`: trim **and upper-case** before anything (`createSchema` does; every tag in the DB is
>    upper-case). Blank → `missing-tag`. Not `/^BR-[A-Z]{2}-\d{4}$/` → `bad-tag`. **Matching was
>    case-sensitive**, so `br-lt-0148` planned as a *create* — and Postgres unique is case-sensitive
>    too, so it would not even error: you get a second record for one physical machine.
> 3. A tag already claimed by an **earlier row of this file** → `duplicate-in-file` (detail = the tag).
> 4. `model` blank → `missing-model`. `required: true` on a header spec governs the **column**, not the
>    cell; a blank Model planned as a create with `model: ""`, which `createSchema`'s `min(2)` forbids.
> 5. `serial` (non-blank): claimed by an earlier row of this file → `duplicate-in-file`. Then, **whether
>    or not the tag matched**, if it belongs to a *different* asset → `duplicate-serial`.
>    `treatDuplicateSerialAsUpdate` rescues only the no-tag-match case; when tag→A and serial→B the two
>    matches disagree about which asset the row *is*, and no option can resolve that (C-1).
> 6. Tag in `byTag` → this row is an **update** of that id.
> 7. `category` resolves, else `unknown-category`. `type` (non-blank) resolves **within that category**,
>    else `unknown-type`. `vendor` (non-blank) resolves, else `unknown-vendor` — unless
>    `dropUnknownVendor`, then `vendorId: null`.
> 8. `assignee` (non-blank): `employeeNo` is authoritative, then name. Ambiguous name →
>    `ambiguous-assignee`. Unresolved → `unknown-assignee`. Resolved but not ACTIVE →
>    `inactive-assignee`. `dropUnknownAssignee` drops the last two to unassigned.
> 9. `status`: blank → `SPARE` on create. Otherwise must be one of `ASSET_STATUSES` upper-cased, else
>    `bad-status`.
> 10. **Create only:** `DEPLOYED`/`TEMPORARY` with no assignee → `deployed-without-holder`. And when
>     `dropUnknownAssignee` drops a holder, the status **downgrades to `SPARE`** — the option's label
>     promises "leave as spare" and as planned it produced `{status:"DEPLOYED", assigneeId:null}`, a
>     deployed-to-nobody asset from a button that said the opposite.
> 11. **Update only (D-A):** a *present* Status column disagreeing with the record's status, or a
>     *present* Assigned-to column resolving to someone other than the record's `assigneeId` →
>     `lifecycle-via-import`, unless `keepCurrentLifecycle`, in which case both fields are simply
>     omitted from the patch and the row's other columns still apply.
> 12. Dates: a `Date` instance must be valid; `YYYY-MM-DD` text must **round-trip**
>     (`d.toISOString().slice(0,10) === text`). The shape regex alone let `"2026-13-45"` through as an
>     Invalid Date, and — worse, because nothing will ever flag it — `"2026-02-30"` through as **March 2**.
>     UTC midnight is correct and matches `toDate()` (`actions.ts:172`); note in a comment that a
>     UTC-midnight date renders as the same day at UTC+8, so Manila is safe *by arithmetic*, not by luck.
> 13. Cost: **the numeric branch must obey the same contract as the string branch.** `typeof raw ===
>     "number"` returned `String(raw)` unchecked, and Excel hands back `number` for every
>     currency-formatted cell — so the guard covered the *rare* path. As planned: `-500` → accepted
>     (`createSchema` is `.nonnegative()`), `51000.555` → silently rounded by `Decimal(12,2)`,
>     `0.1+0.2` → `"0.30000000000000004"` (a float touching money, contradicting the file's own comment),
>     `1e21` → a Prisma parse error. Require finite, `>= 0`, `<= 10_000_000`, at most two decimals
>     (`Math.round(v * 100) / 100 === v`), then `v.toFixed(2)`. The string branch keeps `COST_SHAPE` and
>     gains the same ceiling. The same value must not be accepted as a number and rejected as text.
> 14. Ceilings the app already enforces and this module did not: `model` 2–120, `serial` ≤ 120,
>     `notes` ≤ 2000 (`createSchema`, `actions.ts:145`). Over → `value-too-long`, detail naming the
>     column. Individually minor; as a set, the difference between an import and a record the edit form
>     refuses to save.
>
> **The test fixture is itself a defect.** `HEADER` in the draft below is **9 of the 12 supported
> columns** — Vendor, Warranty until and Notes have no column, so those branches are dead in the entire
> suite. Deleting the whole vendor block, never parsing `warrantyUntil`, and nulling `notes`/`model`
> each leave **19/19 green**; `unknown-vendor` is produced by no test at all, which is most of why its
> dead href survived. Three more pass on a wrong implementation: `examples.slice(0, 99)` (the "up to
> three" test supplies only **two** distinct details), reversing the `BLOCK_CAUSES` tiebreak (the
> "biggest first" test uses 2 vs 1, never a tie), and deleting `.filter(Boolean)` from `examples`.
> **Use the real 14-column export header as the fixture** — `Tag, Model, Serial, Category, Type, Status,
> Assigned to, Employee no, Purchased, Cost, Warranty until, Vendor, RMA ref, Notes` — which also
> exercises the round trip the feature exists for, and add a distinguishing assertion for each of those
> six.
>
> **And the gate that let all of this through:** the plan's Step 9 mutation pass is only a test of the
> suite if the fixture exercises the mutated branch. Two of its four edits were duds — `parseFloat("PHP
> 51,000")` is `NaN` under both branches, and the literal "swap rules 3 and 4" leaves the suite fully
> green because the known-tag fixture's serial appears in no map. **Check that the branch is covered
> before believing a mutation proved anything** (added to §6a).
>
> **Carried, not fixed:** `rmaRef` stays unimportable. The export emits an `RMA ref` column, so a round
> trip drops it — but only from the *sheet*: an update writes only the patch's own fields, so the stored
> value survives untouched. Making it writable is a new field, not an alias, and belongs in its own task
> (§8). The `"employee no"` alias added in `8c4e8c0` stays and is correct, though it never fires on our
> own export, where `Assigned to` is consumed first and `Employee no` falls out as an ignored unknown
> column — T11 should not render "unrecognised column" warnings for columns this app itself wrote.
>
> ---
>
> ### ROUND TWO — `7c60762` reworked against the above, and the re-review found three more contract-shaped defects.
> The rework is real: **23 of 29 mutations caught**, against a suite that previously let four whole
> fields be deleted without noticing, and all fourteen round-one findings are dead *under mutation*
> rather than under a reassuring test name. D-A's create/update asymmetry has structural teeth —
> `AssetUpdatePatch` cannot carry `status`, `assigneeId` or `tag`, and the test asserts their **absence**,
> which survives a refactor that changes what the values would have been. What follows is the rest.
>
> **The three that block T8, all of them contract-shaped — which is the entire reason this rework
> happens before T8 rather than after T11:**
>
> **NC-1. `dropUnknownVendor` on an UPDATE erases the stored vendor.** `import-assets.ts:391,536`.
> The patch's own doc says `null` means "the column exists and this row's cell was empty — an
> intentional clear". A dropped vendor is not an empty cell: it holds a name we could not resolve, and
> the operator ticked a box labelled *"Import without the vendor"*. Both produce `null`, and they mean
> opposite things. Re-upload 200 rows after one vendor is renamed in the database, tick the option to
> clear the block, and **every row naming it wipes that asset's vendor** — `update: 200, blocked: 0`.
> Track the drop the way `assigneeDropped` already is, and on the update branch **omit `vendorId`
> entirely** when the null came from a drop rather than a blank cell. Rule 7's "then `vendorId: null`"
> is the defective sentence — it was written without a create/update split, one rung below where the
> plan was wrong last time.
>
> **NC-2. The ACTIVE check fires on updates that move nothing**, blocking the export round trip for any
> asset held by a non-ACTIVE employee. `import-assets.ts:425-431`. An asset DEPLOYED to an OFFBOARDING
> holder, re-uploaded from our own export with only Notes changed, blocks `inactive-assignee` — then,
> with the drop ticked, blocks `lifecycle-via-import` — and needs **two** file-wide options set to
> change a note. `createAsset`'s freeze (`actions.ts:196`) guards *making* an assignment; this row makes
> none, because the sheet's holder is byte-for-byte the record's holder. **Rule 8 was written without
> knowing rule 11 existed.** On the update branch, skip `inactive-assignee` when the resolved id equals
> `record.assigneeId` — any *different* holder is already `lifecycle-via-import`, so nothing is lost.
> This bites hardest exactly where the feature earns its keep: Phase 7's offboarding flow exists to move
> assets held by people mid-departure, and those are the rows an operator most wants to bulk-edit.
>
> **NC-3. A category change with no Type column strands a `typeId` outside its category — C-5 again,
> through the door this rework opened.** `import-assets.ts:530`. Headers `[Tag, Model, Category]`, a row
> moving `BR-LT-0148` to a new category: the patch carries no `typeId` key, so Prisma leaves the stored
> one — a type belonging to the *old* category. That is exactly the state `actions.ts:294` refuses with
> *"That type doesn't belong to the chosen category"*, i.e. **an asset its own edit form cannot save**.
> Rule 7 validates only the pairing the row *states*; nothing compares the record's stored type against
> the newly written category. It is **the only finding that survives T10's re-validation** — a
> re-validating commit re-runs the rules against the plan, and the plan is internally consistent; the
> inconsistency lives between the patch and the record, which no rule looks at. It arises only on the
> trimmed sheet, which `matchHeaders` actively encourages by requiring three columns. Fix belongs
> **here**, not in T9/T10, or a row rule ends up outside the pure module scope decision 2 exists to
> create, with the dry run's verdict split across two files: `AssetRecordRef` gains `categoryId`,
> `typeId` and `tag`, and rule 7 gains a new cause **`type-outside-category`** (the type is known, it
> just no longer fits — do not reuse `unknown-type`) with a `reupload` fix naming both real remedies.
>
> **And the shape those three converge on.** `byTag` and `bySerial` are now near-identical records whose
> only difference is a field nothing reads — `byTag.serial` has no reader anywhere in the module, and had
> none in `8c4e8c0` either. Unify both on one exported `AssetRecordRef` carrying
> `{ id, tag, status, assigneeId, categoryId, typeId }`, drop `serial`, and **export `AssetRecordRef` and
> `EmployeeRef`** — T9 builds `AssetRefs` and currently cannot name its own member types in a helper
> signature. `tag` also closes a legibility gap: a serial-rescued row returns `{kind:"update",
> assetId:"a-9"}` for a sheet row tagged `BR-LT-0999`, so T11 cannot say which asset it will edit,
> naming it only by a cuid the operator has never seen.
>
> **The Importants, which do not constrain T8 but ship with it:**
> - **NI-1. `ambiguous-assignee` instructs the operator to do something that cannot work on our own
>   export.** Its explain says "Add an Employee no column (or fill it in)" — but on the unmodified export
>   that column **is already there and already filled**, and `matchHeaders` consumes `Assigned to` first,
>   so the alias never fires. The only thing that works is *deleting* a column this app generated, and
>   the fix is `reupload`, so there is no option to fall back on. **D-B's own failure mode, reintroduced
>   by a cause added to satisfy D-B.** Make `assignee` genuinely two-column: rule 8 already declares
>   employeeNo authoritative, so make that true at the *column* level — when an `employee no` column
>   exists and its cell is non-blank, resolve from it and fall back to `assigned to`. That is exactly
>   what the export writes, it makes the round trip work, and it demotes `ambiguous-assignee` from a wall
>   to a rarity.
> - **NI-2. No test pins any cause's fix *kind*** — reverting `bad-status` to a `/inventory` link leaves
>   the vocabulary suite 15/15 green, because the generic test only checks internal consistency and
>   `/inventory` is a real route. That is how an undisclosed deviation shipped unnoticed. Add an explicit
>   `Record<BlockCause, BlockFix["kind"]>` table and assert it across all seventeen: a table you have to
>   edit deliberately is the point. (**The deviation itself was correct** — once the eight statuses are
>   named inline, the link adds nothing and costs a context switch out of the wizard mid-fix, the same
>   argument that killed the `/inventory/import` links. Correct, undisclosed, now pinned.)
> - **NI-3. The cost ceiling is implemented, works, and is untested in both branches.** Deleting either
>   ceiling check leaves 65/65 green: the test named *"blocks a numeric cost over the 10,000,000
>   ceiling"* uses `1e21`, which the **two-decimal** check catches first — a second copy of the 2-dp test
>   wearing the ceiling's name. **The §6a dud shape, inside a test written to close a §6a dud.** Use
>   `20000000` and `"20000000.00"`. If it regressed, `Decimal(12,2)` tolerates up to 9,999,999,999.99, so
>   the write succeeds and only the edit form later refuses. Rule 13's worked example was `1e21` and it
>   propagated straight into the test — the plan's fault, not the implementer's.
> - **NI-4. Rule 11's serial-rescue branch is correct but has zero coverage.** Deleting
>   `matchedRecord = existingBySerial` leaves 65/65 green, and with it gone `const record = matchedRecord!`
>   dereferences null — a TypeError in T9's dry run, behind a load-bearing unguarded assertion. Test it,
>   and collapse the two parallel variables into one `matched: AssetRecordRef | null` with
>   `updateAssetId` derived from it, so the pairing is structural instead of hand-maintained.
> - **NI-5. A blank Category cell reports `unknown-category` with an empty detail.** Blank Tag and blank
>   Model each got their own cause precisely because `required: true` governs the column, not the cell;
>   Category is the third required column and did not. The operator gets a group headed "Category doesn't
>   exist", an explain telling them to create it, and — because `groupByCause` filters blank details —
>   **no examples at all**. Add `missing-category` alongside its two siblings.
> - **NI-6. `value-too-long` fires on a model that is too *short*.** A one-character model routes to a
>   cause whose label states the opposite of the problem, and the group header is the one string the
>   brief's entire argument rests on. Rename to `value-out-of-range`, or route a short model to
>   `missing-model`, whose explain nearly covers it already.
> - **A fifth option, `importUnheldAsSpare`, and it is worth taking.** When `dropUnknownAssignee` removes
>   the only holder, rule 10 downgrades to SPARE instead of blocking — so the identical end state
>   (DEPLOYED requested, no holder available) is auto-resolved on one path and hard-blocked on the other,
>   differing only in *why* there is no holder. An operator entering a legacy fleet with a half-filled
>   Assigned-to column hits a wall on rows the system would cheerfully have made SPARE one branch
>   earlier. Give `deployed-without-holder` the option and the two paths agree.
>
> **Minors, all worth doing in the same commit:** `resolvedType.categoryId !== categoryId`
> (`import-assets.ts:379`) is unreachable, because the map key already embeds `categoryId` — delete it or
> say in a comment that it guards a T9 bug, and test it with a malformed entry. The vocabulary test
> **retypes the eight statuses it asserts are derived**, directly under a comment saying never to retype
> them, so it will drift on the day it warns about — iterate `ASSET_STATUSES`. `seenTags` and
> `seenSerials` are claimed at different points in the rule order (`:321` vs `:349`), so whether a
> blocked row still claims its identifier depends on which rule killed it — claim both at one point and
> state the semantics. `parseCostCell`'s string branch routes money through a float, which the function's
> own comment says never happens: safe by arithmetic (10⁷ at 2dp is far inside 2⁵³) and it usefully
> normalises `"00051000.5"` → `"51000.50"`, so amend the comment to "a float is used only to range-check
> and normalise, never to represent". And `parseDateCell`'s `Date` branch does not normalise to UTC
> midnight: `new Date(2026,0,5)` — local midnight, which several xlsx readers produce — is
> `2026-01-04T16:00:00Z`, **a day earlier** than the sheet said to anything rendering in UTC, including
> this app's own export. Whether it fires depends on T8's reader config, which does not exist yet, which
> is the argument for closing it here rather than depending on it. (`updateAsset` compares dates at day
> precision specifically because time-bearing values generate phantom audit diffs.)

**The heart of the phase.** Everything the operator reads, and every decision about a row, lives here —
one pure module, no `src/server` imports, no database. Scope decision 2 exists so this can be tested
with plain arrays.

**Files:**
- Create: `src/lib/import-vocabulary.ts`, `src/lib/import-vocabulary.test.ts`,
  `src/lib/import-assets.ts`, `src/lib/import-assets.test.ts`

- [ ] **Step 1: Write the failing vocabulary test**

```ts
import { describe, expect, it } from "vitest";
import { BLOCK_CAUSES, IMPORT_ROW_CAP, blockSpec, groupByCause, rowCapRefusal } from "./import-vocabulary";

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

  it("names up to three distinct example values per group, de-duplicated", () => {
    const groups = groupByCause([
      { row: 2, cause: "unknown-category", detail: "Chairs" },
      { row: 3, cause: "unknown-category", detail: "Chairs" },
      { row: 4, cause: "unknown-category", detail: "Desks" },
    ]);
    expect(groups[0].examples).toEqual(["Chairs", "Desks"]);
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/import-vocabulary.test.ts`
Expected: FAIL — `Cannot find module './import-vocabulary'`.

- [ ] **Step 3: Write the vocabulary**

```ts
/**
 * Scope decision 5. An import writes one AuditEntry per row, so this cap bounds
 * an append-only table from a single click. Between BULK_MAX (200) and the
 * 10,000-row export cap, deliberately.
 */
export const IMPORT_ROW_CAP = 2_000;

export function rowCapRefusal(count: number): string {
  return (
    `That file has ${count} rows, over the ${IMPORT_ROW_CAP}-row import cap. ` +
    "Split it and upload the parts. Nothing was imported."
  );
}

export const BLOCK_CAUSES = [
  "missing-tag",
  "duplicate-serial",
  "unknown-category",
  "unknown-type",
  "unknown-assignee",
  "unknown-vendor",
  "bad-status",
  "bad-date",
  "bad-number",
] as const;

export type BlockCause = (typeof BLOCK_CAUSES)[number];

/**
 * A fix is either a LINK out of the wizard (the operator has to create
 * something that does not exist — scope decision 12 refuses to create taxonomy
 * as a side effect of an upload) or an OPTION that re-plans the same file with
 * one decision changed. Nothing here mutates: an option flips a boolean and the
 * dry run happens again, so the operator sees the new verdict before anything
 * is written.
 */
export type ImportOption = "treatDuplicateSerialAsUpdate" | "dropUnknownAssignee";

export interface BlockFix {
  kind: "link" | "option";
  label: string;
  href?: string;
  option?: ImportOption;
}

export interface BlockSpec {
  label: string;
  explain: string;
  fix: BlockFix | null;
}

const SPECS: Record<BlockCause, BlockSpec> = {
  "missing-tag": {
    label: "No asset tag",
    explain:
      "The Tag column is empty on these rows. A tag is how every other screen in this app names an " +
      "asset, so a row without one can be neither created nor matched to an existing record.",
    fix: { kind: "link", label: "Fix the file", href: "/inventory/import" },
  },
  "duplicate-serial": {
    label: "Duplicate serial",
    explain:
      "The serial on these rows already belongs to a different asset. Serials are unique here, so this " +
      "is either a re-upload of assets you already have or a typo.",
    fix: { kind: "option", label: "Update those assets instead", option: "treatDuplicateSerialAsUpdate" },
  },
  "unknown-category": {
    label: "Category doesn't exist",
    explain:
      "These rows name a category this system has never seen. Categories are created deliberately, " +
      "not as a side effect of an upload, so create it first and re-upload.",
    fix: { kind: "link", label: "Create category", href: "/admin/asset-categories" },
  },
  "unknown-type": {
    label: "Type doesn't exist",
    explain:
      "These rows name an asset type this system has never seen. Same rule as categories: create it " +
      "first, then re-upload.",
    fix: { kind: "link", label: "Create type", href: "/admin/asset-types" },
  },
  "unknown-assignee": {
    label: "Assignee not found",
    explain:
      "These rows name someone who is not an employee record here, by employee number or by name. You " +
      "can import them unassigned and hand them out later.",
    fix: { kind: "option", label: "Leave as spare", option: "dropUnknownAssignee" },
  },
  "unknown-vendor": {
    label: "Vendor not found",
    explain:
      "These rows name a vendor this system has never seen. Vendors are reference data, so create it " +
      "first and re-upload.",
    fix: { kind: "link", label: "Create vendor", href: "/admin/vendors" },
  },
  "bad-status": {
    label: "Status not recognised",
    explain:
      "These rows carry a status that is not one of this system's eight. Leave the column blank to get " +
      "SPARE, or correct it to a listed value.",
    fix: { kind: "link", label: "See the statuses", href: "/inventory" },
  },
  "bad-date": {
    label: "Date not readable",
    explain:
      "A date cell on these rows is neither a real spreadsheet date nor YYYY-MM-DD text. Format the " +
      "column as a date in the spreadsheet and re-upload.",
    fix: { kind: "link", label: "Fix the file", href: "/inventory/import" },
  },
  "bad-number": {
    label: "Amount not readable",
    explain:
      "A cost cell on these rows is not a number. Remove currency symbols and thousands separators — " +
      "the cell should hold a plain amount.",
    fix: { kind: "link", label: "Fix the file", href: "/inventory/import" },
  },
};

export function blockSpec(cause: BlockCause): BlockSpec {
  return SPECS[cause];
}

export interface BlockedRow { row: number; cause: BlockCause; detail: string }

export interface CauseGroup {
  cause: BlockCause;
  count: number;
  rows: number[];
  /** distinct offending values, capped at three, so a group can name examples */
  examples: string[];
}

/**
 * The brief's rule made mechanical: one group per cause, biggest first, each
 * carrying its row numbers so the operator can find them in the file. Ties keep
 * BLOCK_CAUSES order, so two runs over one file group identically.
 */
export function groupByCause(blocked: BlockedRow[]): CauseGroup[] {
  const byCause = new Map<BlockCause, BlockedRow[]>();
  for (const b of blocked) {
    const list = byCause.get(b.cause) ?? [];
    list.push(b);
    byCause.set(b.cause, list);
  }
  return [...byCause.entries()]
    .map(([cause, rows]) => ({
      cause,
      count: rows.length,
      rows: rows.map((r) => r.row),
      examples: [...new Set(rows.map((r) => r.detail))].filter(Boolean).slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count || BLOCK_CAUSES.indexOf(a.cause) - BLOCK_CAUSES.indexOf(b.cause));
}
```

- [ ] **Step 4: Run it again**

Run: `npx vitest run src/lib/import-vocabulary.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing asset-rules test**

```ts
import { describe, expect, it } from "vitest";
import { matchHeaders, planAssetRows, type AssetRefs, type ImportOptions } from "./import-assets";

const HEADER = ["Tag", "Model", "Serial", "Category", "Type", "Status", "Assigned to", "Purchased", "Cost"];

const REFS: AssetRefs = {
  categories: new Map([["laptops", "cat-1"]]),
  types: new Map([["macbook pro", "typ-1"]]),
  employees: new Map([["emp-0042", "e-1"], ["marites bautista", "e-1"]]),
  vendors: new Map([["acme", "v-1"]]),
  byTag: new Map([["BR-LT-0148", { id: "a-1", serial: "SN-OLD" }]]),
  bySerial: new Map([["SN-TAKEN", "a-9"]]),
};

const OPTS: ImportOptions = { treatDuplicateSerialAsUpdate: false, dropUnknownAssignee: false };

describe("matchHeaders", () => {
  it("matches case- and space-insensitively, so '  asset tag ' still maps", () => {
    const m = matchHeaders(["  asset tag ", "MODEL"]);
    expect(m.map.get("tag")).toBe(0);
    expect(m.map.get("model")).toBe(1);
  });

  it("names every missing required header at once, not just the first", () => {
    const m = matchHeaders(["Tag"]);
    expect(m.missing).toContain("Model");
    expect(m.missing).toContain("Category");
  });

  // An unrecognised column is NOT an error: a client's own export carries
  // columns we don't want, and refusing the file over them is useless pedantry.
  it("ignores columns it does not recognise, and reports them separately", () => {
    const m = matchHeaders([...HEADER, "Their internal ref"]);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["Their internal ref"]);
  });
});

describe("planAssetRows", () => {
  const plan = (cells: unknown[][], opts: ImportOptions = OPTS) =>
    planAssetRows(matchHeaders(HEADER), cells, REFS, opts);

  it("creates a clean new row", () => {
    const p = plan([["BR-LT-0900", "Dell XPS", "SN-1", "Laptops", "MacBook Pro", "SPARE", "", "2026-01-05", "51000.50"]]);
    expect(p.counts).toEqual({ create: 1, update: 0, blocked: 0 });
    expect(p.rows[0]).toMatchObject({ kind: "create", row: 2 });
  });

  // A known tag is an UPDATE, not a duplicate error — that is what makes
  // re-uploading a corrected sheet the obvious workflow.
  it("treats a known tag as an update, carrying the existing asset id", () => {
    const p = plan([["BR-LT-0148", "Dell XPS", "SN-OLD", "Laptops", "", "", "", "", ""]]);
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-1" });
    expect(p.counts.update).toBe(1);
  });

  it("blocks a row whose serial belongs to a different asset", () => {
    const p = plan([["BR-LT-0901", "Dell", "SN-TAKEN", "Laptops", "", "", "", "", ""]]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-serial", detail: "SN-TAKEN" });
  });

  it("turns that block into an update when the operator picks that fix", () => {
    const p = plan([["BR-LT-0901", "Dell", "SN-TAKEN", "Laptops", "", "", "", "", ""]], {
      ...OPTS,
      treatDuplicateSerialAsUpdate: true,
    });
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-9" });
  });

  it("blocks a missing tag, an unknown category and an unknown type separately", () => {
    const p = plan([
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
      ["BR-LT-0902", "Dell", "", "Chairs", "", "", "", "", ""],
      ["BR-LT-0903", "Dell", "", "Laptops", "Ergo Chair", "", "", "", ""],
    ]);
    expect(p.rows.map((r) => (r.kind === "blocked" ? r.cause : r.kind))).toEqual([
      "missing-tag",
      "unknown-category",
      "unknown-type",
    ]);
  });

  it("resolves an assignee by employee number OR by name, case-insensitively", () => {
    for (const who of ["EMP-0042", "marites bautista"]) {
      expect(plan([["BR-LT-0904", "Dell", "", "Laptops", "", "", who, "", ""]]).rows[0]).toMatchObject({
        kind: "create",
      });
    }
  });

  it("blocks an unknown assignee, and drops it instead when that fix is picked", () => {
    const row = [["BR-LT-0905", "Dell", "", "Laptops", "", "", "Nobody Here", "", ""]];
    expect(plan(row).rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-assignee" });
    const dropped = plan(row, { ...OPTS, dropUnknownAssignee: true });
    expect(dropped.rows[0]).toMatchObject({ kind: "create" });
    expect(dropped.rows[0].kind === "create" && dropped.rows[0].data.assigneeId).toBeNull();
  });

  it("accepts a real Date cell and a YYYY-MM-DD string, and blocks anything else", () => {
    const withDate = (v: unknown) => plan([["BR-LT-0906", "Dell", "", "Laptops", "", "", "", v, ""]]).rows[0];
    expect(withDate(new Date("2026-01-05T00:00:00Z"))).toMatchObject({ kind: "create" });
    expect(withDate("2026-01-05")).toMatchObject({ kind: "create" });
    expect(withDate("5 Jan 26")).toMatchObject({ kind: "blocked", cause: "bad-date" });
  });

  it("blocks a cost that is not a plain number, naming the offending text", () => {
    const p = plan([["BR-LT-0907", "Dell", "", "Laptops", "", "", "", "", "PHP 51,000"]]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number", detail: "PHP 51,000" });
  });

  // Money stays a STRING all the way to Prisma, which builds the Decimal.
  // §8's floating-point lesson: no float ever touches a peso amount.
  it("keeps a valid cost as a string, never a number", () => {
    const p = plan([["BR-LT-0913", "Dell", "", "Laptops", "", "", "", "", "51000.50"]]);
    expect(p.rows[0].kind === "create" && p.rows[0].data.cost).toBe("51000.50");
  });

  it("blocks an unrecognised status but reads a blank one as SPARE", () => {
    expect(plan([["BR-LT-0908", "Dell", "", "Laptops", "", "BROKEN", "", "", ""]]).rows[0]).toMatchObject({
      kind: "blocked",
      cause: "bad-status",
    });
    const blank = plan([["BR-LT-0909", "Dell", "", "Laptops", "", "", "", "", ""]]).rows[0];
    expect(blank).toMatchObject({ kind: "create" });
    expect(blank.kind === "create" && blank.data.status).toBe("SPARE");
  });

  // Partial import is the DEFAULT (scope decision 4): a bad row must not cost
  // the good rows around it.
  it("keeps the good rows in a file that also has bad ones", () => {
    const p = plan([
      ["BR-LT-0910", "Dell", "", "Laptops", "", "", "", "", ""],
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
      ["BR-LT-0911", "Dell", "", "Laptops", "", "", "", "", ""],
    ]);
    expect(p.counts).toEqual({ create: 2, update: 0, blocked: 1 });
  });

  // Row numbers are what the operator uses to find the row in Excel, where the
  // header is row 1 — so a data row reports its SHEET row, not its index.
  it("reports sheet row numbers, counting the header", () => {
    const p = plan([
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
    ]);
    expect(p.rows.map((r) => r.row)).toEqual([2, 3]);
  });

  it("skips a wholly blank row rather than blocking it — trailing blanks are normal", () => {
    const p = plan([
      ["BR-LT-0912", "Dell", "", "Laptops", "", "", "", "", ""],
      [null, null, null, null, null, null, null, null, null],
      ["", "", "", "", "", "", "", "", ""],
    ]);
    expect(p.counts).toEqual({ create: 1, update: 0, blocked: 0 });
    expect(p.rows).toHaveLength(1);
  });

  it("reports one cause per row, so groupByCause counts each row once", () => {
    // Missing tag AND unknown category on the same row: the first check wins.
    const p = plan([["", "Dell", "", "Chairs", "", "", "", "", ""]]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ cause: "missing-tag" });
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/lib/import-assets.test.ts`
Expected: FAIL — `Cannot find module './import-assets'`.

- [ ] **Step 7: Implement `src/lib/import-assets.ts`**

The exported shape:

```ts
import type { AssetStatus } from "@prisma/client";
import type { BlockedRow, ImportOption } from "./import-vocabulary";

/** Sheet header label → canonical field key. Extra sheet columns are ignored. */
export const ASSET_IMPORT_HEADERS = [
  { key: "tag", labels: ["tag", "asset tag"], required: true, title: "Tag" },
  { key: "model", labels: ["model"], required: true, title: "Model" },
  { key: "serial", labels: ["serial", "serial no", "serial number"], required: false, title: "Serial" },
  { key: "category", labels: ["category"], required: true, title: "Category" },
  { key: "type", labels: ["type", "asset type"], required: false, title: "Type" },
  { key: "status", labels: ["status"], required: false, title: "Status" },
  { key: "assignee", labels: ["assigned to", "assignee", "holder"], required: false, title: "Assigned to" },
  { key: "purchasedAt", labels: ["purchased", "purchased at", "purchase date"], required: false, title: "Purchased" },
  { key: "cost", labels: ["cost", "price"], required: false, title: "Cost" },
  { key: "warrantyUntil", labels: ["warranty until", "warranty"], required: false, title: "Warranty until" },
  { key: "vendor", labels: ["vendor", "supplier"], required: false, title: "Vendor" },
  { key: "notes", labels: ["notes", "note"], required: false, title: "Notes" },
] as const;

export type AssetField = (typeof ASSET_IMPORT_HEADERS)[number]["key"];

export interface HeaderMatch {
  map: Map<AssetField, number>;
  /** `title`s of required headers with no column — reported all at once */
  missing: string[];
  unknown: string[];
}

export function matchHeaders(header: unknown[]): HeaderMatch;

/** Reference data, pre-resolved by the server. Name keys are lower-cased. */
export interface AssetRefs {
  categories: Map<string, string>;
  types: Map<string, string>;
  /** employeeNo AND name, both lower-cased, both → employee id */
  employees: Map<string, string>;
  vendors: Map<string, string>;
  /** existing assets by EXACT tag — the update path */
  byTag: Map<string, { id: string; serial: string | null }>;
  /** existing assets by EXACT serial — the duplicate path */
  bySerial: Map<string, string>;
}

export interface AssetImportData {
  tag: string;
  model: string;
  serial: string | null;
  categoryId: string;
  typeId: string | null;
  status: AssetStatus;
  assigneeId: string | null;
  purchasedAt: Date | null;
  /** a decimal STRING — Prisma builds the Decimal, no float touches money */
  cost: string | null;
  warrantyUntil: Date | null;
  vendorId: string | null;
  notes: string | null;
}

export type RowVerdict =
  | { kind: "create"; row: number; data: AssetImportData }
  | { kind: "update"; row: number; assetId: string; data: AssetImportData }
  | ({ kind: "blocked" } & BlockedRow);

export interface AssetPlan {
  rows: RowVerdict[];
  counts: { create: number; update: number; blocked: number };
}

export type ImportOptions = Record<ImportOption, boolean>;

export function planAssetRows(
  headers: HeaderMatch,
  cells: unknown[][],
  refs: AssetRefs,
  options: ImportOptions,
): AssetPlan;
```

The per-row rules, in the order they must be applied — the tests pin all of them:

1. Every cell blank/null → **skip entirely**, counted nowhere and absent from `rows`.
2. `tag` blank → blocked `missing-tag`.
3. `tag` in `refs.byTag` → **update** that id.
4. Else `serial` non-blank and in `refs.bySerial` → blocked `duplicate-serial` (detail = the serial),
   unless `treatDuplicateSerialAsUpdate`, then **update** that id.
5. `category` must resolve → else `unknown-category` (detail = the raw value). `type` and `vendor`
   likewise, but only when non-blank.
6. `assignee` non-blank must resolve → else `unknown-assignee`, unless `dropUnknownAssignee`, then
   `assigneeId: null`.
7. `status` blank → `"SPARE"`; else must be an `AssetStatus` when upper-cased → else `bad-status`.
8. Dates: a `Date` instance passes; `/^\d{4}-\d{2}-\d{2}$/` is parsed as UTC midnight; anything else
   non-blank → `bad-date`.
9. `cost`: a `number` is stringified; a string must match `/^\d+(\.\d{1,2})?$/` → else `bad-number`.
10. **First failing check wins** — exactly one cause per row.

- [ ] **Step 8: Run the test again**

Run: `npx vitest run src/lib/import-assets.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 9: Mutation-test the rules before trusting them**

§6a: reversing a comparator and weakening a filter both left a 21-test suite green in Phase 7. Make
each edit, confirm a named test fails, revert:

1. Swap rules 3 and 4 (serial checked before tag) → the known-tag update test must fail.
2. Ignore `dropUnknownAssignee` → its test must fail.
3. Accept `parseFloat` for cost → the `"PHP 51,000"` test must fail.
4. Report row `i` instead of `i + 2` → the sheet-row test must fail.

If any edit leaves the suite green, that assertion is satisfied by both branches (§6a rule 4) and needs
a distinguishing check.

- [ ] **Step 10: Commit**

```bash
git add src/lib/import-vocabulary.ts src/lib/import-vocabulary.test.ts src/lib/import-assets.ts src/lib/import-assets.test.ts
git commit -m "feat(import): the cause vocabulary and the asset row rules, mutation-tested"
```

---

### Task 8: The sheet reader boundary

> ### ANSWERED — the reader returns **UTC midnight**, and T7 was reading local fields.
> Measured, not inferred: a date written through our own `ASSET_EXPORT_COLUMNS`
> (`{ type: Date, format: "yyyy-mm-dd" }`) and read back with `readSheet` comes out as a real `Date`
> whose instant is `2026-01-05T00:00:00.000Z` — **byte-identical under `Asia/Manila`,
> `America/New_York` and `UTC`**. Only the *local* calendar day read off it moves: `getDate()` is 5 at
> UTC+8 and **4** at UTC−5. `parseDateCell` was reading local fields on the theory that xlsx readers
> emit local midnight, so against the reader we actually have it was **one day early at every negative
> offset** — right at the deployment by arithmetic, wrong for a developer running the dev server in the
> US. Fixed by reading `getUTC*`, which for conforming input is a **no-op**: the rule is now provably
> timezone-independent instead of accidentally correct at ours. The suite asserts it under all three
> zones, and the old local-getter rule fails the New York case. A plain number cell still returns a
> `number` and a text cell a `string`, both as the rules already assume. **If a second reader is ever
> added it normalises at the boundary — this branch does not get taught to guess.**
>
> **ORIGINAL TASK-7-CLOSE BANNER, kept because it is why the probe happened:**
> **pin the date convention this reader hands over, and say so out loud.**
> `parseDateCell` (`src/lib/import-assets.ts`) normalises a `Date` cell by reading its **local**
> year/month/day and rebuilding it as UTC midnight. That is right for a **local-midnight** `Date`, which
> is what several xlsx readers produce, and it is right for a **UTC-midnight** `Date` only at a
> **non-negative** UTC offset — at UTC−5 the local calendar day of a UTC-midnight instant is the day
> before, and the import would silently store the wrong day. Manila (UTC+8) is safe by arithmetic, so
> the deployment cannot be bitten; a developer running the dev server in the US can be. **A bare `Date`
> cannot say which convention produced it**, so T7 cannot fix this and deliberately does not try — the
> first version of its comment claimed timezone-independence it did not have, and the test that was
> supposed to prove the claim forced `America/New_York`, the one offset where both readings agree.
> **T8's job: establish what `read-excel-file` actually returns for a date-formatted cell** — run it,
> don't infer it — and either hand over a UTC-midnight `Date` (documented, at which point T7's rule
> becomes provably offset-independent) or hand over `YYYY-MM-DD` text, which is unambiguous and already
> the better-tested path. Whichever it is, write it down here; T7's suite now forces **both**
> `Asia/Manila` and `America/New_York` and will hold whichever convention you pin.

One module owns `read-excel-file`, schema-less by scope decision 2.

**Files:**
- Create: `src/server/import/read-sheet.ts`

- [ ] **Step 1: Write it**

```ts
import { readSheet } from "read-excel-file/node";
import { IMPORT_ROW_CAP, rowCapRefusal } from "@/lib/import-vocabulary";

export type ReadResult =
  | { ok: true; header: unknown[]; rows: unknown[][] }
  | { ok: false; reason: string };

/**
 * The ONLY `read-excel-file` import in the app, and deliberately schema-less:
 * `readSheet(file, { schema })` returns EITHER objects OR errors, never both, so
 * it cannot express the partial success this feature is built around (scope
 * decision 2). We take the grid and validate it ourselves.
 *
 * The row cap is enforced HERE, before any row is examined, so an oversized
 * file costs one length check rather than 4,000 validations.
 */
export async function readGrid(file: File): Promise<ReadResult> {
  let grid: unknown[][];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    grid = (await readSheet(buffer)) as unknown[][];
  } catch {
    // A corrupt or non-xlsx upload. The library's own error is a stack-shaped
    // string that tells an operator nothing, so it is never quoted.
    return {
      ok: false,
      reason: "That file could not be read as a spreadsheet. Save it as .xlsx and try again.",
    };
  }
  if (grid.length === 0) return { ok: false, reason: "That spreadsheet is empty." };

  const [header, ...rows] = grid;
  if (rows.length > IMPORT_ROW_CAP) return { ok: false, reason: rowCapRefusal(rows.length) };
  return { ok: true, header, rows };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. **No unit test here, deliberately** — the module is three branches over a library
call, the library round trip is already proven by `src/server/xlsx/write.test.ts`, and Task 13's e2e
uploads real files. A test that mocked `readSheet` would assert the mock.

- [ ] **Step 3: Commit**

```bash
git add src/server/import/read-sheet.ts
git commit -m "feat(import): the sheet reader, schema-less by design"
```

---

### Task 9: The asset dry run

> ### AMENDED BEFORE EXECUTION — the code below predates Task 7's three review rounds and builds the WRONG `AssetRefs`.
> Task 7 shipped, was reviewed three times, and its contract moved substantially in the process. The
> block below is the version written against T7's **first draft**; it would compile against none of the
> current types and, where it would, it would be wrong. **This banner is the spec.** Read the exported
> shapes in `src/lib/import-assets.ts` — they are commented with the reason for each, and the reasons are
> the findings that produced them.
>
> **One defect that has nothing to do with T7, and would have shipped on its own: the role floor locks
> out admins.** `actionRole(...roles)` (`src/server/auth/guards.ts:45`) returns the user **only if their
> role is in the list** — it is not a floor, it is a set. So `actionRole("it_staff")` refuses `admin`,
> the role that runs this app. Every sibling inventory action writes `actionRole("admin", "it_staff")`
> (`createAsset`, `updateAsset`, the bulk actions). Use that. `viewer`, `finance_staff` and
> `purchasing_staff` are refused, which is the intent.
>
> **The four `AssetRefs` members that changed shape, and why — do not "simplify" any of them back:**
>
> 1. **`types` is keyed `${categoryId}:${lowercased name}` and its value is `{ id, categoryId }`**, not
>    `name → id`. `AssetType` is `@@unique([categoryId, name])`, **not globally unique**, so a flat name
>    key can hold only one of two same-named types and silently resolves to whichever was inserted last.
>    The query therefore needs `select: { id: true, name: true, categoryId: true }`.
> 2. **`employees` is `Map<string, EmployeeRef>`** — `{ id, employment, ambiguous }`. `Employee.name` is
>    **not unique** (only `employeeNo` is), so a name matching two people must arrive marked
>    `ambiguous: true` and block, rather than resolving to whichever row the map kept. Build it in two
>    passes: count lowercased names first, then set each name key with `ambiguous` set from that count.
>    **`employeeNo` keys are never ambiguous** and must win over a name key that collides with one. The
>    query needs `employment` selected — T7 blocks a non-ACTIVE assignee the way `createAsset` does
>    (`actions.ts:196`, *"assignments are frozen"*).
> 3. **`byTag` and `bySerial` both carry one `AssetRecordRef`** — `{ id, tag, status, assigneeId,
>    categoryId, typeId }`. Not `{id, serial}`, and `bySerial` is **not** a bare id string. Rule 11's
>    lifecycle check (scope decision 13) needs the record's current `status`/`assigneeId` no matter which
>    map matched the row, including the `treatDuplicateSerialAsUpdate` rescue path; rule 7's
>    `type-outside-category` check needs `categoryId`/`typeId`; and `assetTag` on an update verdict needs
>    `tag`, so the wizard can say which asset a serial-rescued row will edit instead of naming a cuid.
>    `serial` is **not** on the ref — nothing reads it.
> 4. **`optionsFrom` must read all FIVE options**, not two: `treatDuplicateSerialAsUpdate`,
>    `dropUnknownAssignee`, `dropUnknownVendor`, `keepCurrentLifecycle`, `importUnheldAsSpare`. A missing
>    key silently reads `false`, so an option the wizard offers would simply never take effect — and the
>    failure is invisible, because the row just stays blocked and the operator assumes their file is
>    still wrong.
>
>    **So do not hand-write the five keys here.** `ImportOption` is a bare union today, and the only
>    enumeration of its members is a **hand-typed copy inside `import-vocabulary.test.ts:8`** — a list
>    that will drift from the union the day a sixth option is added, in a test whose job is to assert
>    every option is real. Promote it: export `IMPORT_OPTIONS` as an `as const` array from
>    `src/lib/import-vocabulary.ts`, derive `export type ImportOption = (typeof IMPORT_OPTIONS)[number]`
>    from it, have the test import it instead of retyping it, and build `optionsFrom` by folding over it.
>    Then a sixth option is impossible to forget in any of the three places. This is the same defect
>    §6a rules 26/37/38 describe, caught before it cost anything — and the same one the vocabulary test
>    already fixed once for `ASSET_STATUSES`.
>
> **And a fifth thing the plan gets wrong, which is subtler and would have produced silent duplicate
> assets: the tag lookup must be UPPERCASED.** T7's rule 2 trims and upper-cases a tag before consulting
> `byTag`, because `createSchema`'s tag is `.toUpperCase().regex(/^BR-[A-Z]{2}-\d{4}$/)` and every tag in
> the database is upper-case. If this resolver queries with the sheet's raw text, a row reading
> `br-lt-0148` fetches nothing, `byTag` has no entry, T7 plans a **create**, and Postgres — whose unique
> index is case-sensitive — happily accepts a **second** record for the same physical machine. Uppercase
> the tags before the `in` query. Serials are matched exactly as written (trimmed, not case-folded), the
> same way T7 compares them.
>
> **What the plan gets RIGHT and should be kept:** six queries rather than six per row; scoping the tag
> and serial lookups to what the file mentions rather than loading the whole fleet; fetching the small
> reference tables whole; refusing on `headers.missing` **before** planning, with all missing columns
> named at once (without it a sheet with no Category column produces one identical block per row instead
> of one refusal); spending the `import` rate-limit kind on the dry run as well as the apply; and
> **writing nothing at all** — no transaction, no row, no persisted plan (scope decisions 3 and 8).
>
> **Verification, since this is the first import task with a database.** The unit suite cannot see any of
> this: the module is Prisma plus a pure call. Prove it against the real seeded data — a throwaway
> `npx tsx` script under the gitignored `backups/` that calls `resolveAssetRefs` and prints the map sizes
> and a couple of entries is the cheapest check, and §7 records it as the house pattern. Confirm
> specifically: a known seeded tag resolves to a record carrying its real `status` and `categoryId`; the
> two categories that share a type name resolve to **different** type ids under their own composite keys;
> and an OFFBOARDED employee arrives with `employment` set so rule 8 can see it. Delete the script after.
>
> ---
>
> ### ROUND TWO — `bd38c5c` is a sound input for T10, and five things should land before T11 is built around it.
> The review confirmed the parts that matter against the **live database** rather than by reading: a
> lower-cased sheet tag resolves to the right existing asset (so the duplicate-create hole is genuinely
> closed), a lower-cased `emp-0042` in the Employee-no column resolves to a real `assigneeId`, and every
> one of the six map keys matches what `planAssetRows` looks up with. Cost at the cap is **~15 ms** of
> queries; a 2,000-element `IN` is nowhere near Postgres's 65,535 bind-parameter ceiling. Nothing below
> blocks T10.
>
> **R-1. Three reference maps lower-case their keys with no ambiguity guard, and this one writes WRONG
> DATA rather than refusing.** The banner reasoned about `employees` (not unique → needs `ambiguous`) and
> `types` (per-category unique → needs a composite key) and stopped one step short. `AssetCategory.name`
> and `Vendor.name` are `@unique` — **but Postgres unique is case-sensitive, and
> `src/server/modules/admin/reference-actions.ts` has no case-insensitive check anywhere**, relying
> purely on the constraint. So the admin UI accepts "Laptop" and "laptop" as two categories. Then: 1,800
> rows reading "Laptop" all resolve to whichever row the **unordered** `findMany` returned last, and
> every one is filed under the wrong category — no block, no P2002, no signal, verdict reads "1,800
> creates". Worse than the tag case the banner fixed, which at least surfaced as a write-time error.
> **And without `orderBy` the winner is non-deterministic across calls** (Postgres heap order changes
> after any `UPDATE`), so the dry run can resolve "Laptop" to one id and T10's re-validation to another —
> which **falsifies scope decision 3's guarantee that the verdict and the write cannot disagree.**
> Latent today (zero collisions in the database, verified), and latent is where it should be fixed.
> Add `orderBy: { name: "asc" }` to all four reference queries for determinism, **and** a collision guard
> on the same two-pass model already built for employees. The root fix — a case-insensitive uniqueness
> check in `reference-actions.ts` — is a separate task, tracked in §8.
>
> **R-2. The 10/min limit can strand an operator holding a finished plan, and its refusal text is false
> three ways.** `checkRate` runs before the file is read, so every refusal spends a token doing zero
> work. Counted against a realistic messy-file session — a bad header, a re-upload, five option flips,
> one un-tick to compare, then apply — the operator lands **exactly on 10 with no slack**, and one extra
> toggle locks them out for a minute *while holding a fully-planned import they cannot apply*. Separately,
> `rateLimited()` (`src/server/action-result.ts:29`) hardcodes *"You've made 60 changes this minute — the
> cap. Nothing was lost: this form still holds your input."* On this path the cap is **10** not 60, the
> dry run made **zero** changes (it writes nothing, by design), and a **file input is not repopulated by
> any browser** — three false claims in one sentence, §6a rules 16 and 35 exactly. **Fix: a separate
> `RateKind` for the read-only stage** — not a longer window and not a bigger number. The dry run costs
> ~15 ms and writes nothing; it does not need the budget that bounds a call writing 2,000 assets plus
> 2,000 audit rows. `RateEvent.kind` is a plain `String`, so no migration. `rateLimited` takes an
> optional message override and both import call sites pass something true.
>
> **R-3. The banner's claim that "the unit suite cannot see any of this" is wrong, and it is why the
> composite key has no permanent test.** `resolveAssetRefs` is two things welded together: six Prisma
> calls, and ~40 lines of pure map-building where **every defect in this review actually lives** — the
> uppercase, the two-pass ambiguity, the composite key, the lower-casing, the employeeNo overwrite.
> Extract `buildAssetRefs(categories, types, employees, vendors, byTagRows, bySerialRows): AssetRefs`,
> leaving `resolveAssetRefs` as six queries and one call. ~10 lines of movement, and it gives permanent
> homes to all of the above plus R-1's guard. **Note what is already covered and what is not:**
> `import-assets.test.ts` hand-builds `cat-1:standard` and `cat-2:standard` as a same-name trap, so the
> **consuming** side of the composite key has been pinned since T7 — it is the **producing** side, that
> `resolveAssetRefs` emits keys in that exact shape, that has no test and can drift.
>
> **R-4. An internal non-breaking space turns a valid assignee into a silent DROP.** `lower()` trims and
> lower-cases but does not collapse internal whitespace. `trim()` does strip a surrounding U+00A0, so
> padding is fine; `"Ramon Cruz"` — a name pasted from Outlook or a web page into Excel, a routine
> artifact — is not: it blocks as `unknown-assignee` with detail `"Ramon Cruz"`, a name that is
> letter-for-letter an employee in the system, with no visible difference. **And the offered fix is a
> button reading "Leave as spare", so the natural response silently discards a valid assignment.**
> Categories, types and vendors share the gap but block with `reupload`, so they merely frustrate. Fix
> with a shared `refKey()` exported from `import-assets.ts` and used on **both** sides — doing it on one
> side only creates a new key-shape mismatch.
>
> **R-5. A legal 2,000-row file is rejected by Next before this action ever runs.** You asked what an
> `it_staff` user can do with a 500 MB xlsx: nothing. Next 15 defaults `serverActions.bodySizeLimit` to
> **1 MB** and `next.config.ts` sets no override, so the buffer is already bounded and `readGrid` needs no
> size guard — **do not add one.** The defect is the inverse, measured with our own `toXlsxBuffer`: 2,000
> rows with Notes at this module's own 2,000-character ceiling is **2.63 MB**, so a file legal by every
> rule this module states dies at the framework boundary with an opaque error — never `rowCapRefusal`,
> never a `conflict` banner, and `rowCapRefusal` meanwhile promises "Split it and upload the parts" for a
> ceiling that is not the one they hit. Set the limit explicitly (4 MB covers the worst legal file and
> still bounds the buffer). Surfacing the byte ceiling to the operator is T11's.
>
> **Minors:** `AssetRefs.types`'s value carries a `categoryId` **nothing reads** — the composite key
> already embeds it, as rule 7's own comment says. That is the same dead-field defect round 2 removed
> from `byTag`'s `serial`, the lesson applied to one map and not the other; drop it to
> `Map<string, string>`. The missing-columns message names canonical titles when `matchHeaders` accepts
> aliases ("Asset tag" for Tag, three spellings of Serial), so a sheet with a variant header gets a true
> but unhelpful refusal. And ambiguity is counted across **all** employees regardless of employment —
> which is **correct** (narrowing to ACTIVE would silently guess, and two records with one name may be
> one person), but the comment does not say so, and the next reader will read it as an oversight and
> "fix" it. **For T11, not now:** re-uploading our own export always reports `RMA ref` in
> `unknownColumns`, so the happy path carries a permanent false alarm — word it "ignored columns", or
> keep a known-but-not-imported list so genuinely unrecognised columns still stand out.
>
> **And one contract note for T10, which is the better decision made early:** the dry run's plan does not
> need to round-trip through the browser. T10 **re-validates every row anyway** (scope decision 8), so it
> gains nothing from receiving the plan and avoids needing a schema to un-mangle it. **Re-post the file
> and the five option booleans instead** — `AssetUpdatePatch`'s absent-key-vs-`null` distinction survives
> React Flight as a server-action argument, but stringified into `FormData` a `Date` silently becomes an
> ISO string that Prisma happens to coerce, which is the kind of accidental correctness this phase has
> spent three tasks removing.

**Files:**
- Create: `src/server/modules/import/resolve.ts`, `src/server/modules/import/asset-actions.ts`

- [ ] **Step 1: Write the reference resolver**

```ts
import { prisma } from "@/server/db/client";
import type { AssetRefs } from "@/lib/import-assets";

const lower = (s: string) => s.trim().toLowerCase();

/**
 * Every lookup the row rules need, in six queries rather than six per row.
 *
 * The tag and serial lookups are scoped to what the FILE mentions: importing 50
 * rows must not pull 20,000 assets into memory to discover none of them collide.
 * Reference tables are small and fetched whole.
 */
export async function resolveAssetRefs(tags: string[], serials: string[]): Promise<AssetRefs> {
  const [categories, types, employees, vendors, byTag, bySerial] = await Promise.all([
    prisma.assetCategory.findMany({ select: { id: true, name: true } }),
    prisma.assetType.findMany({ select: { id: true, name: true } }),
    prisma.employee.findMany({ select: { id: true, name: true, employeeNo: true } }),
    prisma.vendor.findMany({ select: { id: true, name: true } }),
    tags.length
      ? prisma.asset.findMany({ where: { tag: { in: tags } }, select: { id: true, tag: true, serial: true } })
      : Promise.resolve([]),
    serials.length
      ? prisma.asset.findMany({ where: { serial: { in: serials } }, select: { id: true, serial: true } })
      : Promise.resolve([]),
  ]);

  const employeeMap = new Map<string, string>();
  for (const e of employees) {
    employeeMap.set(lower(e.employeeNo), e.id);
    // Number first, name second: if a name ever collided with someone else's
    // employee number, the number is the identity that should win.
    if (!employeeMap.has(lower(e.name))) employeeMap.set(lower(e.name), e.id);
  }

  return {
    categories: new Map(categories.map((c) => [lower(c.name), c.id])),
    types: new Map(types.map((t) => [lower(t.name), t.id])),
    employees: employeeMap,
    vendors: new Map(vendors.map((v) => [lower(v.name), v.id])),
    // Tags and serials match EXACTLY. They are identities, and a
    // case-insensitive match would let two distinct tags resolve to one asset.
    byTag: new Map(byTag.map((a) => [a.tag, { id: a.id, serial: a.serial }])),
    bySerial: new Map(bySerial.flatMap((a) => (a.serial ? [[a.serial, a.id] as const] : []))),
  };
}
```

- [ ] **Step 2: Write `planAssetImport`**

`src/server/modules/import/asset-actions.ts`:

```ts
"use server";

import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { readGrid } from "@/server/import/read-sheet";
import { matchHeaders, planAssetRows, type AssetPlan, type ImportOptions } from "@/lib/import-assets";
import { groupByCause, type CauseGroup } from "@/lib/import-vocabulary";
import { resolveAssetRefs } from "./resolve";
import { conflict, forbidden, ok, rateLimited, type ActionResult } from "@/server/action-result";

export interface PlanResult {
  plan: AssetPlan;
  groups: CauseGroup[];
  unknownColumns: string[];
}

function optionsFrom(form: FormData): ImportOptions {
  return {
    treatDuplicateSerialAsUpdate: form.get("treatDuplicateSerialAsUpdate") === "1",
    dropUnknownAssignee: form.get("dropUnknownAssignee") === "1",
  };
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/**
 * Stage two of three, and it WRITES NOTHING (scope decision 3). No transaction
 * is opened and no row is inserted; the whole verdict is computed and returned.
 *
 * `checkRate(actor.id, "import")` uses the 10/min kind that has existed since
 * Phase 1 (scope decision 6). It is spent on the dry run as well as the apply,
 * deliberately: a dry run reads every reference table, so it is not free.
 */
export async function planAssetImport(form: FormData): Promise<ActionResult<PlanResult>> {
  const actor = await actionRole("it_staff");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id, "import");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const file = form.get("file");
  if (!(file instanceof File)) return conflict("No file was uploaded.");

  const read = await readGrid(file);
  if (!read.ok) return conflict(read.reason);

  const headers = matchHeaders(read.header);
  if (headers.missing.length) {
    return conflict(
      `That sheet is missing ${headers.missing.length === 1 ? "a column" : "columns"}: ` +
        `${headers.missing.join(", ")}. Nothing was imported.`,
    );
  }

  const tagAt = headers.map.get("tag")!;
  const serialAt = headers.map.get("serial");
  const tags = read.rows.map((r) => text(r[tagAt])).filter(Boolean);
  const serials = serialAt === undefined ? [] : read.rows.map((r) => text(r[serialAt])).filter(Boolean);

  const refs = await resolveAssetRefs(tags, serials);
  const plan = planAssetRows(headers, read.rows, refs, optionsFrom(form));
  const blocked = plan.rows.flatMap((r) => (r.kind === "blocked" ? [r] : []));
  return ok({ plan, groups: groupByCause(blocked), unknownColumns: headers.unknown });
}
```

**Confirm the role floor** against `src/server/auth/guards.ts` and `src/lib/workspaces.ts`: importing
assets is IT work, so `it_staff` is the floor and `viewer` must be refused.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npm run test`

```bash
git add src/server/modules/import
git commit -m "feat(import): the asset dry run, which writes nothing"
```

---

### Task 10: The asset commit

> ### AMENDED BEFORE EXECUTION — the shape is right; six things in it are not, and one is a hole this phase opened itself.
> **Keep the architecture.** Taking the FILE again and re-planning before writing is correct and is scope
> decision 8's guard: the browser's plan is what the operator *saw*, this is what gets written, and the
> two agree because the same pure function produced both. Per-row transactions are correct too — partial
> import is the default (scope decision 4), so one bad row must not roll back the other 196, and each
> row's write and its audit entry must land together or not at all. Both survive review. What follows
> are the details.
>
> **A-1. THE RATE LIMIT IS NOW UNENFORCED ON THE WRITE PATH, and this phase did it to itself.** The code
> comment says *"planAssetImport already gated the role and spent a rate token"* — true when it was
> written, false since Task 9's round two. The dry run now spends **`import_plan` (60/min)**, and the
> brief's **`import` (10/min)** kind is spent by **nothing at all**. So the stage that writes up to 2,000
> assets plus 2,000 audit rows would be bounded at sixty calls a minute, and the one number the brief
> actually states about importing would be enforced nowhere. **Call `checkRate(actor.id, "import")` in
> the apply**, after the re-plan succeeds and before the first write, and pass a true message. This is
> the second-order cost of a fix landing in a task whose caller did not exist yet — the R-2 note said "T10
> should pass its own true message too" and this is the sharper half of that.
>
> **A-2. `actionRole("it_staff")` locks out admins** — the identical defect Task 9 carried, from the same
> stale draft. `actionRole(...roles)` is a **set membership test, not a floor**. Use
> `actionRole("admin", "it_staff")`, as `createAsset` and `updateAsset` do.
>
> **A-3. Every unchanged row still writes, bumping `updatedAt` on assets nothing touched — and the
> HAPPY PATH is made entirely of those rows.** Task 9 proved the round trip this feature exists for:
> export five assets, re-upload the file unedited, get **five clean updates**. Under the code below each
> one runs an `updateMany` whose `data` changes nothing — and `@updatedAt` moves on every update
> statement regardless — so five assets get a fresh `updatedAt`, no audit entry (correctly skipped, the
> diff is empty), and therefore **a modification with no trail**. `updatedAt` drives "recently changed"
> reads, and a re-upload would silently float every asset in the file to the top. **Compute the diff
> FIRST; if it is empty, write nothing at all and count the row separately** — return `unchanged`
> alongside `created`/`updated`, because "nothing needed doing" is a real and common verdict that the
> operator should see rather than have counted as work.
>
> **A-4. The `cost` diff is a phantom on every update row.** `diffOf` normalises a `Prisma.Decimal` via
> `toNumber()` but leaves a **string** alone (`src/lib/audit-diff.ts:7-12`), and `AssetUpdatePatch.cost`
> is a decimal **string** by deliberate design — so `before.cost` normalises to `51000.5` and the patch
> holds `"51000.50"`, `same()` says they differ, and **every** update row claims cost changed when it did
> not. That is the exact defect an earlier phase's review caught as *"phantom audit entries on every
> first edit of a seeded asset"*, arriving by a new road, and it compounds A-3: the phantom makes the
> diff non-empty, so the no-op rule never fires and every one of those five round-trip rows writes an
> audit entry announcing a change that did not happen, into an **append-only** table. Normalise the cost
> for the COMPARISON only — the string exists to keep floats out of the **write**, and `diffOf` already
> reduces the stored Decimal to a number, so comparing `Number(patch.cost)` is consistent and not a
> reintroduction of float money. Say so in a comment or someone will "fix" it back.
>
> **A-5. The create's audit diff cannot show what the import actually did.** It records `tag` and `model`
> as from-null. `createAsset` (`actions.ts:217`) records `tag`, `model` **and `status`** — and it can
> afford to hardcode `"SPARE"` because `creationPlan` guarantees it. **Import cannot**: scope decision 13
> is precisely that an import may create an asset **already DEPLOYED to a holder**, which no other
> surface in this application can do. An audit trail that omits it cannot answer "how did this asset get
> to DEPLOYED without an approval?" — the one question this decision guarantees someone will ask. Record
> `status`, and `assigneeId` when it is set.
>
> **A-6. A failed row is counted and its reason is thrown away.** `catch { failed += 1 }` gives the
> operator a number that does not add up and nothing to act on. §6a rule 59: a batch action must return
> what it DID. **Collect the sheet row numbers that failed** (they are on the verdict) and enough of a
> reason to be actionable, so T11 can say *"rows 14 and 92 failed"* rather than *"2 failed"*. Do not
> quote a raw Prisma error at an operator; classify it.
>
> **Two smaller ones.** `revalidatePath("/inventory")` does **not** revalidate `/inventory/activity`,
> which is a separate route and is exactly where these new entries are meant to appear — add it. And the
> plan is right that `/inventory/activity` scopes to `entityType: "asset"`, so unlike Phase 7's four dead
> cases these sentences **will** render: confirm `entityLabels` in `src/server/modules/audit/queries.ts`
> and `AUDIT_ENTITY_TYPES` in `src/lib/audit-list.ts` already name `asset` (they do — no new entity type,
> so rule 20 is satisfied without a change, which is worth stating rather than leaving implied).
> `actionDot` needs explicit branches: `import-create` misses `action === "create"` because that is an
> equality test, and neither name matches any `includes` branch, so both currently fall through to the
> neutral `"SPARE"` default.
>
> **An accepted divergence, recorded rather than fixed.** Re-planning at apply time means the world can
> move between Validate and Apply — an admin creates the missing category, someone edits an asset — so
> the write can legitimately differ from the verdict the operator approved. That is the correct trade
> (the alternative is writing a stale plan), but scope decision 3 promises the verdict and the write
> cannot disagree, so **the result must carry the re-plan's own counts** and T11 must show actuals rather
> than echoing what the browser was holding. A silent divergence is the thing to avoid; a reported one is
> honest.
>
> **Verification, and measure the thing nobody has measured.** No unit test can see any of this. Verify
> against the real database with a throwaway script under gitignored `backups/`, deleted after — and
> because this is the first task that **writes**, restore what you touch or reseed and say which. At
> minimum: the round trip writes **zero** audit entries and leaves `updatedAt` untouched (A-3 plus A-4
> together — this is the single most important assertion in the task); a genuinely edited row writes
> exactly one entry naming exactly the changed fields; a create records status; a blocked row writes
> nothing; and the `updatedAt` guard actually fires when a row is edited underneath the import. **Time a
> full-cap run** — 2,000 sequential transactions is 2,000 round trips, and if that takes minutes rather
> than seconds T11 needs to know before it builds a button that waits on it.
>
> ---
>
> ### ROUND TWO — one write must not ship behind a button, and two of the banner's own instructions were wrong.
> The shape survives: per-row transactions, re-planning from the file, diff-before-write, `unchanged` as
> a first-class verdict, classified failures carrying sheet row numbers. **Sequential re-apply turns out
> to be genuinely idempotent** — a retried file re-plans to updates, diffs empty, counts `unchanged` —
> and that property fell out of doing A-3 properly rather than being designed in.
>
> **C-1. The date fix copied half of `updateAsset` and the missing half writes two columns with no audit
> entry.** `updateAsset`'s comment has two clauses (`actions.ts:317-321`): compare at day precision,
> *"**and write ONLY the changed fields, so untouched columns keep their stored timestamps instead of
> being silently truncated to midnight**"* — and it implements the second at `actions.ts:326`
> (`Object.fromEntries(Object.entries(data).filter(([key]) => key in diff))`). The import took the first
> clause and writes `data: row.data`, the whole patch. So: export an asset whose `purchasedAt` is
> `2024-09-01T07:59:47.133Z`, change its Model, re-upload. `toDay` correctly keeps `purchasedAt` out of
> the diff; the audit entry says `{model}`; and `updateMany` writes `purchasedAt` and `warrantyUntil` to
> **midnight anyway**. Two columns change with no record, in the one task whose job is the trail, into a
> table a DB trigger makes append-only so the missing entry can never be added later. **Every one of the
> 25 assets in the database carries a time-of-day `purchasedAt`** — verified — so this fires on the first
> edited re-import of any of them, and it **self-conceals**: after run one the values are already
> midnight and nothing ever disagrees again. One line, and it is the line the sibling already uses. Safe
> against the absent-key contract, because `Object.entries` enumerates only present keys.
>
> **I-1. The counters are incremented INSIDE the transaction callback** (`asset-actions.ts:242, 286,
> 309`), but the COMMIT happens after the callback resolves. A commit that fails — P2028 timeout, pool
> hiccup, connection reset — rejects, the `catch` records a failure, and the row is counted **both**
> created and failed. `created + updated + unchanged + skipped + failed` then exceeds the row count and
> the operator is told 197 assets exist when 196 do: the exact "number that does not add up" A-6 exists to
> prevent, through a narrower door. `createAsset` shows the pattern (`actions.ts:202`) — return the
> outcome out of the transaction and switch on it after it resolves.
>
> **I-2. Nothing revalidates the asset detail or history pages.** `/inventory`, `/inventory/activity` and
> `/audit` are revalidated; `/inventory/[id]` and `/inventory/[id]/history` are not — though both
> `updateAsset` (`actions.ts:341`) and `completeOffboarding` do it per asset. The first thing anyone does
> after an import is open one row to check it landed, and that is precisely the page that would show the
> old model and an empty history. Per-asset calls are wrong at 2,000 rows; Next 15 takes
> `revalidatePath("/inventory/[id]", "page")` for exactly this.
>
> **I-3. The divergence is reported as a bare number, and THE BANNER ASKED FOR THAT — wrongly.** Round
> one said to return the re-plan's own counts. Counts cannot discharge the promise: if an admin renames a
> category between Validate and Apply, all 200 rows block and the operator sees "200 skipped, nothing
> written" with no way to learn why. The `CauseGroup[]` that answers it was computed one line earlier and
> discarded (`asset-actions.ts:209` destructures only `plan`). **Return `groups` too** — T11 cannot render
> an explanation it is never given, and adding the field after its only caller exists means changing the
> contract twice.
>
> **I-5. `actionDot("import-update") === "COMPLETED"` is another wrong banner instruction, faithfully
> executed.** `statusFamily` (`src/lib/status.ts:17,21`) maps **both** `DEPLOYED` and `COMPLETED` to
> `"settled"`, so the two new branches render an identical dot and the second has no visible effect at
> all. Worse: plain `"update"` falls through to `SPARE`/neutral, so **the same edit gets a grey dot by
> hand and a green settled one by import** — and the green one is the path that produces fifty at a time.
> The banner's premise ("silently reading as nothing happened") was false: `SPARE` is documented as
> neutral and is what this app already uses for every ordinary update. `import-create → DEPLOYED` is
> right (it matches `create`); **`import-update` should be explicitly neutral**, with a comment saying so,
> or a future reviewer re-raises the same point. And the test locking it in is
> `expect(actionDot("import-update")).not.toBe("SPARE")` (`activity.test.ts:71-76`) — a **negative**
> assertion that passes on any value at all, encodes the wrong rule, and would block the correction.
> Assert exact values.
>
> **I-6. A-5 is half-satisfied: the fact is recorded and never shown where A-5 said it mattered.** A-5's
> purpose was that the trail can answer *"how did this asset reach DEPLOYED without an approval?"* The
> diff records `status`, but `/inventory/activity` renders only `auditSentence`, and that sentence is
> `"J. Sarmiento imported BR-LT-0148"` — on that feed an asset imported already DEPLOYED to a holder is
> indistinguishable from one imported SPARE. `/audit`'s fields column does list it, but only for someone
> who already knew to look, which is the opposite of the ask. One line: read `diff?.status?.to` and say
> `imported ${label} as ${status}` when it is not SPARE. Round one treated the diff (A-5) and the
> sentences (step 2) as independent items; they are one item.
>
> **I-4, split between here and T11.** Sequential re-apply is idempotent, so a retry is safe. A
> **concurrent** double-click is not: both calls re-plan before either writes, both plan CREATE for the
> same tags, and the loser gets P2002 → *"would duplicate a tag or serial already on file"*, which is a
> **misattribution** — it sends the operator hunting for a problem in their spreadsheet that does not
> exist, when the duplicate is their own second click. T11 owns disabling the button; a disabled button is
> a courtesy, not a guarantee (a re-POST, a refresh, a second tab all bypass it). **Here: make the
> create-side P2002 reason name the possibility** rather than asserting the wrong cause. A server-side
> advisory lock was considered and is deliberately NOT being added — this is an authenticated,
> role-gated, rate-limited action on a single-machine deployment the owner runs, and the honest reason
> plus the disabled button is proportionate. Recorded so nobody has to re-derive that.
>
> **M-4.** An operator who exhausts `import_plan` while clicking **Apply** gets the dry run's refusal
> verbatim — *"checking a file only reads it"* — on the write path. Accidentally true, confusing.
>
> **The refactor that makes all of this testable, and it is the highest-value change in the round.**
> `asset-actions.ts` is `"use server"`, which permits only async exports — so `patchForDiff`,
> `classifyRowError` and `toDay` are **structurally unreachable by any unit test**. That is the same
> discovery Task 9 made about `resolveAssetRefs`, whose extraction into `buildAssetRefs` is the precedent
> and whose comment says so. There are now **three** normalisation layers around one comparison —
> `diffOf`'s own `normalize`, `patchForDiff` on the after side, and `toDay` on the before side, the last
> being a verbatim copy of `actions.ts:322`. Two half-normalisers in two shapes, one duplicated across
> modules: the drift shape, already drifting. **Extract a pure `src/lib/asset-diff.ts` exporting
> `assetDiff(before, patch)` that owns both normalisations AND returns the changed subset** — which fixes
> C-1 inside the same function — and **have `updateAsset` call it too**, so the two paths cannot diverge
> again. `updateAsset` is heavily e2e-covered, so run the full battery including Playwright after.
>
> Then unit-test it, because this one function is where C-1, A-3, A-4 and the seventh defect all live:
> a round-trip row (`purchasedAt` at `07:59:47.133`, `cost "11000.00"`) yields `{}`; a genuine day change
> yields `purchasedAt` **only**; a present-null cost yields `{cost: {from: 11000, to: null}}`; and an
> **absent** key never appears in the diff **nor in the write set** — the destructive-write regression
> caught twice already with, today, zero tests standing between it and a third time. Add
> `classifyRowError`'s four cases while it is reachable.
>
> **Recorded, not fixed:** one import puts 2,000 entries at the top of `/inventory/activity` (PAGE_SIZE
> 50) and `buildAuditWhere` has no action facet, so nothing can filter them out — §8. A cleared date
> reports a `from` that was never stored, pre-existing in `updateAsset`, worth a sentence not a fix. The
> `updatedAt` guard's comment overstates it: the version is read inside the row's own transaction
> microseconds before the write, so it is **last-writer-wins with the diff computed at write time**, not
> the optimistic-concurrency contract §6a rules 21/29/30 describe — the trade is right, the comment
> should say what it is. And an `unchanged` row still opens BEGIN/SELECT/COMMIT, which on the flagship
> clean round trip is the entire cost; reading `before` outside the transaction would cut it by roughly
> two thirds if the 15 s ever matters.
>
> **On that 15 s: it is a floor, not the wall clock.** The harness re-implemented the loop; the real
> action also parses up to 4 MB of multipart, decodes the XLSX, resolves refs and plans 2,000 rows — and
> `applyAssetImport` does all of that **a second time**, since it calls `planAssetImport` internally.
> Nobody has timed that half. **T11 must not put a bare submit in front of it**: pending state, button
> disabled from the first click, copy that sets the expectation before the wait. And if the deployment
> cannot hold a 20–40 s request open, this becomes a job with a poll — a plan-level decision, not
> something to discover mid-build.

**Files:**
- Modify: `src/server/modules/import/asset-actions.ts`, `src/lib/activity.ts`,
  `src/components/patterns/activity-feed.tsx`

- [ ] **Step 1: Write `applyAssetImport`**

```ts
/**
 * Stage three. Takes the FILE again — not the plan the browser is holding — and
 * re-plans before writing (scope decision 8's guard). The browser's plan is what
 * the operator SAW; this is what gets written, and the two agree because the same
 * pure function produced both. Nothing from the payload except the two boolean
 * options reaches the database, so a tampered plan cannot widen what this writes.
 *
 * Partial by construction (scope decision 4): blocked rows are skipped, and each
 * applied row is its OWN transaction, so its write and its audit entry land
 * together or not at all, and one bad row does not roll back the other 196.
 */
export async function applyAssetImport(
  form: FormData,
): Promise<ActionResult<{ created: number; updated: number; skipped: number; failed: number }>> {
  const planned = await planAssetImport(form);
  if (!planned.ok) return planned;
  // planAssetImport already gated the role and spent a rate token; re-reading
  // the actor here rather than re-checking keeps this to one budget per click.
  const actor = await actionRole("it_staff");
  if (!actor) return forbidden();

  const { plan } = planned.data;
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const row of plan.rows) {
    if (row.kind === "blocked") continue;
    try {
      await prisma.$transaction(async (tx) => {
        if (row.kind === "create") {
          const asset = await tx.asset.create({ data: row.data });
          await writeAudit(tx, {
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "asset",
            entityId: asset.id,
            action: "import-create",
            // A real from-null: this asset did not exist. Never a
            // from-equals-to (§6a rules 8, 19).
            diff: { tag: { from: null, to: asset.tag }, model: { from: null, to: asset.model } },
          });
          created += 1;
          return;
        }
        const before = await tx.asset.findUnique({ where: { id: row.assetId } });
        if (!before) throw new Error("row vanished");
        // Guarded on `updatedAt`, which @updatedAt always moves — so a
        // concurrent edit loses rather than being silently overwritten
        // (§6a rules 21, 29, 30).
        const written = await tx.asset.updateMany({
          where: { id: row.assetId, updatedAt: before.updatedAt },
          data: row.data,
        });
        if (written.count === 0) throw new Error("raced");
        const diff = diffOf(
          before as unknown as Record<string, unknown>,
          row.data as unknown as Record<string, unknown>,
        );
        // A row that changed nothing writes NO audit entry — the no-op rule this
        // project enforces everywhere else (§6a rule 6's phantom-entry shape).
        if (Object.keys(diff).length) {
          await writeAudit(tx, {
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "asset",
            entityId: row.assetId,
            action: "import-update",
            diff,
          });
        }
        updated += 1;
      });
    } catch {
      // One row's problem, counted and reported — never swallowed into a
      // cheerful total (§6a rule 59). The operator gets a number that does not
      // add up and a reason to look.
      failed += 1;
    }
  }

  revalidatePath("/inventory");
  revalidatePath("/audit");
  return ok({ created, updated, skipped: plan.counts.blocked, failed });
}
```

Add imports: `prisma`, `writeAudit`, `diffOf`, `revalidatePath`.

- [ ] **Step 2: Teach the activity feed the two new actions**

This is the case §7's audit-reader gotcha says to check FIRST rather than after: `/inventory/activity`
scopes to `entityType: "asset"`, so these entries **will** reach `auditSentence` and `actionDot` — unlike
Phase 7's four cases, which were dead code. Add to `src/lib/activity.ts`:

```ts
    case "import-create":
      return `${entry.actorLabel} imported ${entry.entityLabel}`;
    case "import-update": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return `${entry.actorLabel} updated ${fields} on ${entry.entityLabel} by import`;
    }
```

And check `actionDot`: `action === "create"` will NOT catch `import-create` (it is an equality test),
but `action.includes("failed")` and similar `includes` branches must be re-read to be sure neither new
name falls into a wrong family. Add explicit branches so both get a deliberate colour rather than the
neutral default.

- [ ] **Step 3: Add the two tests this deserves**

`src/lib/activity.test.ts` already exists. Add one case per new action asserting the sentence, and one
asserting `actionDot` gives each a non-neutral family — these are cheap and they are the only guard
against the Phase 7 mistake recurring in reverse.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npm run test`

```bash
git add src/server/modules/import src/lib/activity.ts src/lib/activity.test.ts src/components/patterns/activity-feed.tsx
git commit -m "feat(import): the asset commit, partial by construction and audited per row"
```

---

### Task 11: `/inventory/import` — the three-step wizard

> ### AMENDED BEFORE EXECUTION — the layout is right; the gating is open, the fix vocabulary is two-thirds rendered, and two component signatures are wrong.
> Upload → Validate → Results, a proportional bar rather than a climbing counter, blocked rows grouped
> by cause with one fix each, a fix that RE-PLANS instead of writing, and a new file clearing the old
> verdict — all correct, all kept. What follows is everything the draft assumes about code that has since
> changed or that it never checked.
>
> **W-1. `/inventory/import` IS ALREADY REACHABLE by viewer, purchasing_staff and finance_staff — and
> the step that was supposed to catch that cannot.** `PATH_RULES` is **first-match-wins**
> (`src/lib/workspaces.ts:185`, `PATH_RULES.find`), and `{ test: /^\/inventory(\/|$)/, workspaces: ["it",
> "purchasing", "finance"] }` already matches `/inventory/import`. `ROLE_WORKSPACES` gives **viewer**
> `["it"]`, so every one of those roles passes. And `pathAllowedForRole` is what **`src/middleware.ts:35`
> gates on** — this is the real boundary, not nav decoration. **The draft's claim that
> "`workspaces.test.ts` will fail if the route is left ungoverned (default-deny)" is false**: the route is
> not ungoverned, it is governed by the *wrong rule*, so default-deny never fires and the suite stays
> green with the page open to three roles that must never reach it. Add the rule **BEFORE** the general
> `/inventory` one — exactly as the `/inventory/[id]/secrets` rule does, which carries a comment saying
> "MUST precede the general /inventory rule (first-match-wins)" for this precise reason — with
> `workspaces: ["it"]` and `roles: ["admin", "it_staff"]`. Then **write the test that would have caught
> it**: assert all five roles explicitly against this path, not just the two that should pass.
>
> **W-2. `requireRole("it_staff")` locks out admins, for the third surface running.** `requireRole(...roles)`
> (`guards.ts:26`) is a **set membership test**, not a floor, and it `redirect`s. `admin` is the role that
> runs this app. Use `requireRole("admin", "it_staff")`. Same defect as Task 9's and Task 10's
> `actionRole`; the shape has now cost three tasks, which is why the checklist item is "read the guard,
> don't infer it from its name".
>
> **W-3. `BlockedCauses` renders an action for two of the three fix kinds, so MOST groups get no
> affordance at all.** It handles `link` and `option`. `BlockFix["kind"]` is now **`"link" | "option" |
> "reupload"`**, and `reupload` is what the majority of the 22 causes carry — `missing-tag`, `bad-tag`,
> `missing-model`, `missing-category`, `bad-date`, `bad-number`, `value-out-of-range`,
> `duplicate-in-file`, `ambiguous-assignee`, `type-outside-category`. Under this draft each of those
> renders a group with an explanation and **nothing to do**, which is precisely the wall the brief's whole
> argument is against — *eighteen identical lines is a wall, one line with a button is a decision.*
>
> **This is §6a rule 10, the single most-repeated defect in this codebase — six instances, every task
> that has ever paired a rule module with a page, including the one warned about in advance.** It is the
> first item on the checklist for exactly this reason. Render all three kinds: `reupload` is the wizard's
> own restart — the operator fixes the sheet and uploads again — so it is a button that clears the
> current file and verdict and returns to step 1, not an anchor and not a dead label. **And do not write
> a `default:` that silently renders nothing: switch exhaustively on the union so a fourth kind is a
> TYPE ERROR here rather than an invisible hole in the page.**
>
> **W-4. The options state holds two of five.** `ImportOption` is now
> `treatDuplicateSerialAsUpdate | dropUnknownAssignee | dropUnknownVendor | keepCurrentLifecycle |
> importUnheldAsSpare`, and the draft initialises — and resets, in the file-picker's `onChange` — a
> two-key literal. A missing key reads `false`, so three of the five fix buttons would set an option the
> server then never sees, the row would stay blocked, and the operator would conclude the button is
> broken. **Build the state from `IMPORT_OPTIONS`** (exported from `import-vocabulary.ts` in Task 9's
> round two, precisely so no third site can hand-list them) in both places. Task 9's `optionsFrom` had
> this same defect and was fixed the same way.
>
> **W-5. `WizardSteps` cannot be reused, and the draft's own hedge is the right instinct.** Its real
> signature is `{ employeeId: string; current: StepId; unlocked: boolean }` — it renders `WIZARD_STEPS`
> from `src/lib/offboarding.ts` as **navigable `<Link>`s** built from an employee id, with a lock rule
> about undecided items. None of that exists here: import's three steps are progress indication, not
> navigation, and there is no employee. Do not contort it and do not generalise it (that edits a shipped
> offboarding surface for an unrelated feature). Build a small presentational stepper local to the import
> component **and say in a comment why it is not the offboarding one**, so the next reader does not
> "de-duplicate" two things that only look alike. `ProgressBar`'s props ARE as the draft assumes —
> `{ value, max?, label? }`, verified.
>
> **W-6. `applyAssetImport`'s return type is not what the draft destructures.** It ships (`5fbc538`) as
> `{ created, updated, unchanged, skipped, failed, failures: { row, reason }[], groups: CauseGroup[] }`.
> `groups` is the **re-plan's own** grouping and it exists specifically for you: the world can move
> between Validate and Apply (an admin renames a category and all 200 rows block), and counts alone
> cannot tell the operator why. **Render the returned groups when the apply's outcome differs from the
> verdict they approved** — the same `BlockedCauses` component, fed from the result rather than the
> plan. That divergence is accepted and recorded; reporting it is what makes it honest. The draft reads
> `{ created, updated, failed }` — so it drops `unchanged` entirely and throws away the per-row
> reasons that exist precisely so the Results step can name which rows failed instead of printing a
> bare count. `failures` carries a **classified** reason, never a raw Prisma error; render it. **The `unchanged` count is not a detail, it is the happy path's
> headline**: re-uploading an unedited export is the workflow this feature exists for, and every one of
> its rows is an update that changes nothing. A toast reading *"Imported 0 new and 0 updated"* would tell
> the operator their import failed when it did exactly the right thing. Say *"5 rows already matched —
> nothing needed changing"*. And when the apply's counts differ from the verdict the operator approved
> (the world can move between Validate and Apply — that divergence is accepted and recorded in Task 10),
> **show the actuals**; a silent divergence is the thing scope decision 3 forbids, a reported one is
> honest.
>
> **W-7. "Ignored 1 column: RMA ref" appears on EVERY round trip of our own export.**
> `ASSET_EXPORT_COLUMNS` writes an `RMA ref` column and `ASSET_IMPORT_HEADERS` deliberately has no field
> for it, so `unknownColumns` is never empty on the happy path. A permanent warning about a column this
> app itself wrote trains the operator to ignore the line that exists to warn them about a genuinely
> misspelled header. Keep a known-but-not-imported list, or word the two cases differently.
>
> **Smaller, but each one real.** `setFile(null)` does **not** clear an `<input type="file">` — the
> filename stays visible after a successful import; reset it with a `key` or a ref. The rate-limit
> refusal message promises nothing about the file being retained, deliberately, because it is **this**
> component's job to retain it — confirm a refusal leaves `file` in state so the operator can retry
> without re-picking. `file!` inside the Import handler is a non-null assertion that the JSX does not
> actually guarantee; narrow it. And viewer must not see the **Import link** either — affordance absent,
> not disabled, per the house rule.
>
> **W-8. Apply is a ~15-second operation at the cap, and it is measured, not guessed.** 2,000 rows is
> 2,000 sequential transactions — ~15 s for the write loop alone, and that is a **floor**: the real
> action also parses up to 4 MB of multipart, decodes the XLSX, resolves refs and plans 2,000 rows,
> **twice**, because `applyAssetImport` calls `planAssetImport` internally to re-validate. So: a
> `useTransition` pending state, **the button disabled from the first click**, and copy that sets the
> expectation BEFORE the wait rather than explaining it after. The disabled button is also half of a
> correctness fix — a concurrent double-click makes both calls plan CREATE for the same tags, and the
> loser gets a P2002 whose reason now names that possibility (the server half, already shipped). A
> disabled button is a courtesy, not a guarantee, so do not let it be the only thing standing there.
> **And if anything between the browser and Node imposes a timeout shorter than the run, STOP and say
> so** — turning this into a queued job with a poll is a plan-level decision, not something to
> improvise mid-build.
>
> **Verification.** Step 5's by-hand check is right and should be done, but note the two things that
> bite: an agent will not type a password into a login form, so a signed-in browser needs either the
> user or a throwaway `zz-*` Playwright spec (§7 records the pattern, and Task 13 will make it
> permanent); and `/inventory/activity` scopes to `entityType: "asset"`, so the new sentences **do**
> render — confirm they read as sentences and not as raw `import-create` strings. Check the page at
> **375px and in dark mode**, and run the axe helper: this is a new route with a form control, and the
> e2e specs assert no serious/critical violations.

**Files:**
- Create: `src/app/(app)/inventory/import/page.tsx`, `src/components/import/import-wizard.tsx`,
  `src/components/import/blocked-causes.tsx`
- Modify: `src/lib/workspaces.ts`

- [ ] **Step 1: Build `blocked-causes.tsx`**

One group per cause, biggest first, with its count, up to three example values, its row numbers and its
fix. **Every sentence comes from `blockSpec`** — none is written here (§6a rules 5, 11).

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { blockSpec, type CauseGroup, type ImportOption } from "@/lib/import-vocabulary";

export function BlockedCauses({
  groups,
  busy,
  onApplyOption,
}: {
  groups: CauseGroup[];
  busy: boolean;
  onApplyOption: (option: ImportOption) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const spec = blockSpec(g.cause);
        return (
          <div key={g.cause} className="rounded-(--radius-card) border border-border bg-surface px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{spec.label}</span>
                  <span className="font-mono text-[10.5px] text-fg-muted">
                    {g.count} {g.count === 1 ? "row" : "rows"}
                  </span>
                </span>
                <span className="text-[11.5px] leading-snug text-fg-secondary">{spec.explain}</span>
                {g.examples.length > 0 && (
                  <span className="truncate font-mono text-[10.5px] text-fg-muted">
                    e.g. {g.examples.join(", ")}
                  </span>
                )}
                {/* The row numbers are how an operator finds them in Excel.
                    Capped, so 400 blocked rows do not print 400 numbers. */}
                <span className="font-mono text-[10.5px] text-fg-muted">
                  {g.rows.length <= 12
                    ? `rows ${g.rows.join(", ")}`
                    : `rows ${g.rows.slice(0, 12).join(", ")} and ${g.rows.length - 12} more`}
                </span>
              </div>
              {spec.fix?.kind === "link" && (
                <Link href={spec.fix.href!} className="shrink-0 text-[12px] font-medium text-accent hover:underline">
                  {spec.fix.label} →
                </Link>
              )}
              {spec.fix?.kind === "option" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  className="shrink-0"
                  onClick={() => onApplyOption(spec.fix!.option!)}
                >
                  {spec.fix.label}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build `import-wizard.tsx`**

Upload → Validate → Results. **Read `src/components/offboarding/wizard-steps.tsx` first** and reuse its
stepper rather than drawing a second one; the import below assumes it exports `WizardSteps({ steps,
current })` — correct the call if its real signature differs.

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { WizardSteps } from "@/components/offboarding/wizard-steps";
import { BlockedCauses } from "./blocked-causes";
import type { ImportOption } from "@/lib/import-vocabulary";
import type { ActionResult } from "@/server/action-result";
import { applyAssetImport, planAssetImport, type PlanResult } from "@/server/modules/import/asset-actions";

const STEPS = ["Upload", "Validate", "Results"] as const;

/**
 * The same ActionResult ladder as every other screen, with the two details
 * `endpoint-editor.tsx` documents: a per-CONTROL `acting` key (a shared
 * `pending` would spin every fix button at once) and the rate limit stored as a
 * DEADLINE, so a second refusal restarts the countdown even when it computes
 * the same number of seconds.
 */
function useRunner() {
  const [, startTransition] = useTransition();
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  function run<T>(key: string, fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void) {
    setError(null);
    setActing(key);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) onOk(res.data);
        else if (res.kind === "rate_limited") setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        // Every other refusal is a conflict carrying a whole sentence — the
        // missing-column list, the row-cap message, the unreadable-file line.
        else setError(res.message);
      } finally {
        setActing(null);
      }
    });
  }

  return { acting, error, retryAfterSec, clearRetry: () => setRetryDeadline(null), run };
}

export function ImportWizard() {
  const router = useRouter();
  const toast = useToast();
  const { acting, error, retryAfterSec, clearRetry, run } = useRunner();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  // Held here so a fix can re-plan the SAME file without a second upload.
  const [options, setOptions] = useState<Record<ImportOption, boolean>>({
    treatDuplicateSerialAsUpdate: false,
    dropUnknownAssignee: false,
  });

  const busy = acting !== null;
  const step = result ? 2 : file ? 1 : 0;

  function body(f: File, opts: Record<ImportOption, boolean>): FormData {
    const form = new FormData();
    form.set("file", f);
    for (const [k, v] of Object.entries(opts)) if (v) form.set(k, "1");
    return form;
  }

  function validate(f: File, opts: Record<ImportOption, boolean>) {
    run("validate", () => planAssetImport(body(f, opts)), setResult);
  }

  return (
    <div className="flex flex-col gap-4">
      <WizardSteps steps={[...STEPS]} current={step} />

      {retryAfterSec !== null && <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />}
      {error && <Banner tone="fault" title={error} />}

      <Banner tone="neutral" title="Validating writes nothing">
        Validate is a dry run: it reads the whole file, tells you exactly what would happen, and touches
        no records. Nothing is written until you choose Import — and then only the rows that passed.
      </Banner>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="import-file" className="text-[12px] font-medium text-fg-secondary">
          Spreadsheet (.xlsx)
        </label>
        <input
          id="import-file"
          type="file"
          accept=".xlsx"
          disabled={busy}
          className="text-[12px] text-fg-secondary"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            // A new file invalidates the old verdict and every fix chosen for
            // it — carrying either forward would show one file's counts over
            // another file's rows.
            setResult(null);
            setOptions({ treatDuplicateSerialAsUpdate: false, dropUnknownAssignee: false });
            setFile(picked);
          }}
        />
      </div>

      {file && (
        <span>
          <Button variant="primary" loading={acting === "validate"} disabled={busy} onClick={() => validate(file, options)}>
            {result ? "Validate again" : "Validate"}
          </Button>
        </span>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          {/* The whole verdict at once — a proportional bar, not a climbing
              counter. The brief is explicit about that. */}
          <div className="flex flex-col gap-1.5">
            <ProgressBar
              value={result.plan.counts.create + result.plan.counts.update}
              max={result.plan.counts.create + result.plan.counts.update + result.plan.counts.blocked}
              label="Rows that would import"
            />
            <span className="font-mono text-[11px] text-fg-muted">
              {result.plan.counts.create} new · {result.plan.counts.update} updates ·{" "}
              {result.plan.counts.blocked} blocked
            </span>
          </div>

          {result.unknownColumns.length > 0 && (
            // A note, never an error: a client's own export carries columns we
            // do not want, and refusing the file over them would be pedantry.
            <p className="text-[11.5px] text-fg-muted">
              Ignored {result.unknownColumns.length}{" "}
              {result.unknownColumns.length === 1 ? "column" : "columns"}:{" "}
              <span className="font-mono">{result.unknownColumns.join(", ")}</span>
            </p>
          )}

          <BlockedCauses
            groups={result.groups}
            busy={busy}
            onApplyOption={(option) => {
              // A fix RE-PLANS. It never writes, so the operator sees the new
              // verdict before committing to it.
              const next = { ...options, [option]: true };
              setOptions(next);
              if (file) validate(file, next);
            }}
          />

          {/* Absent, not disabled, when there is nothing to do — the same rule
              the read-only surfaces follow. */}
          {result.plan.counts.create + result.plan.counts.update > 0 && (
            <span>
              <Button
                variant="primary"
                loading={acting === "apply"}
                disabled={busy}
                onClick={() =>
                  run("apply", () => applyAssetImport(body(file!, options)), (data) => {
                    toast(
                      `Imported ${data.created} new and ${data.updated} updated` +
                        (data.failed ? ` — ${data.failed} failed, refresh and re-check` : ""),
                      data.failed ? "fault" : "settled",
                    );
                    setResult(null);
                    setFile(null);
                    router.refresh();
                  })
                }
              >
                Import {result.plan.counts.create + result.plan.counts.update} rows
              </Button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

Two things to confirm while wiring this up, because both are assumptions about existing components:
`ProgressBar`'s props (`value`/`max`/`label` — copied from `RateLimitNotice`'s usage) and
`WizardSteps`' signature. If either differs, the component is right and this code is wrong.

**A note on `kind`.** Task 12 adds an employee importer that needs this same wizard. Do NOT parameterise
this component until that task, and when you do, pass the two server actions in as props rather than
branching on a `kind` string inside it — the branch would put both importers' knowledge in one file for
no gain, and a props-based split keeps each page's actions statically obvious.

- [ ] **Step 3: Build the page**

`await requireRole("it_staff")`, a `PageHeader` with a breadcrumb back to `/inventory`, a `Banner`
stating the two things that surprise people (partial import is the default; the dry run writes
nothing), then `<ImportWizard kind="asset" />`.

- [ ] **Step 4: Nav and gating**

Add `/inventory/import` to `PATH_RULES` — IT workspace, `it_staff` and above, **viewer excluded**: a
read-only role must not reach an import page at all, and §6a's rule is that affordances are absent
rather than disabled. Add an "Import" link beside `/inventory`'s Export. `src/lib/workspaces.test.ts`
will fail if the route is left ungoverned (default-deny).

- [ ] **Step 5: Verify by hand, with a real file**

Download `/inventory/export`, open it, change two tags to unused ones, break one row's Category, and
re-upload. Confirm: the dry run reports 2 create / N update / 1 blocked, "Create category" links out,
Apply imports the good rows, `/inventory` shows the new tags, `/audit` shows `import-create` naming
them, and `/inventory/activity` renders the new sentence rather than a raw action string.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/import "src/app/(app)/inventory/import" src/lib/workspaces.ts
git commit -m "feat(import): the three-step asset import, partial and grouped by cause"
```

---

### Task 12: The employee import

The brief's second importer. It reuses `import-vocabulary` and the wizard; only the column spec, the
refs and the write differ.

**Files:**
- Create: `src/lib/import-employees.ts`, `src/lib/import-employees.test.ts`,
  `src/server/modules/import/employee-actions.ts`, `src/app/(app)/employees/import/page.tsx`
- Modify: `src/components/import/import-wizard.tsx` (a second `kind`), `src/lib/workspaces.ts`

- [ ] **Step 1: Add the two new causes to the vocabulary, test-first**

`Employee` has no email column, `title` and `departmentId` are both REQUIRED, and the date is
`joinedAt`. So this importer needs two causes the asset one did not. Add to `BLOCK_CAUSES` and `SPECS`
in `src/lib/import-vocabulary.ts`:

```ts
  "unknown-department": {
    label: "Department doesn't exist",
    explain:
      "These rows name a department this system has never seen. Departments are reference data, so " +
      "create it first and re-upload — an import will not invent one.",
    fix: { kind: "link", label: "Create department", href: "/admin/departments" },
  },
  "missing-required": {
    label: "A required column is empty",
    explain:
      "Employee number, name, title, department and joined date are all required on every row. These " +
      "rows leave at least one of them blank.",
    fix: { kind: "link", label: "Fix the file", href: "/employees/import" },
  },
```

The existing vocabulary tests cover these automatically — "every cause has a fix" and "every label is
distinct" both iterate `BLOCK_CAUSES`. Add one test naming the department link, mirroring the
`unknown-category` one.

- [ ] **Step 2: Write the failing rules test**

`src/lib/import-employees.test.ts`. The header spec:

```ts
export const EMPLOYEE_IMPORT_HEADERS = [
  { key: "employeeNo", labels: ["employee no", "employee number", "emp no"], required: true, title: "Employee no" },
  { key: "name", labels: ["name", "full name"], required: true, title: "Name" },
  { key: "title", labels: ["title", "job title", "role"], required: true, title: "Title" },
  { key: "department", labels: ["department", "dept"], required: true, title: "Department" },
  { key: "employment", labels: ["employment", "employment status", "status"], required: false, title: "Employment" },
  { key: "joinedAt", labels: ["joined", "joined at", "start date", "started"], required: true, title: "Joined" },
] as const;
```

Assert, mirroring `import-assets.test.ts` case for case — write these out, do not cross-reference them:

1. `matchHeaders` matches case- and space-insensitively.
2. It names every missing required header at once.
3. It ignores unrecognised columns and reports them in `unknown`.
4. A clean row creates, and its `row` is `2` (the header is row 1).
5. A known `employeeNo` is an **update** carrying the existing employee id — `employeeNo` is the
   identity here exactly as `tag` is for assets.
6. An unknown department is blocked `unknown-department`, detail = the raw value.
7. A blank `name`, `title` or `joinedAt` is blocked `missing-required`.
8. A blank `employeeNo` is blocked `missing-required` too — there is no `missing-tag` equivalent, and
   reusing an asset-shaped cause name here would read wrong in the UI.
9. `employment` blank reads as `ACTIVE`; an unrecognised value is blocked `bad-status`.
10. `joinedAt` accepts a `Date` and `YYYY-MM-DD`, and blocks anything else as `bad-date`.
11. A wholly blank row is skipped, counted nowhere.
12. A file with good and bad rows keeps the good ones (partial is the default).
13. One cause per row: a row missing BOTH name and department reports only `missing-required`.

**`m365Status` and `offboardingAt` are deliberately NOT importable.** `offboardingAt` is stamped by the
offboarding transition and means "this offboarding" — letting a spreadsheet set it would corrupt every
farewell report's window (§6a's spirit, and Phase 7's own comment on that column says so). `m365Status`
is written by the M365 sync path. Record both in the module's doc comment so the omission reads as a
decision.

- [ ] **Step 3: Implement, then mutation-test as in Task 7 Step 9**

At minimum: swap the known-`employeeNo` check after the required-field check (test 5 must fail), and
let `employment` default to `OFFBOARDED` instead of `ACTIVE` (test 9 must fail).

- [ ] **Step 4: Write the actions**

`planEmployeeImport` / `applyEmployeeImport` in `employee-actions.ts`, same three-stage shape,
`entityType: "employee"`, actions `import-create` / `import-update`, role floor `it_staff`.

**Check `/employees/activity`'s scope** the way Task 10 Step 2 did for assets — it scopes to
`entityType: "employee"`, so `auditSentence` needs to handle these too, and the two cases added in
Task 10 are entity-agnostic so they should already serve. Verify rather than assume.

- [ ] **Step 5: The page, the nav entry, the path rule**

- [ ] **Step 6: Verify and commit**

```bash
git add -A src/lib src/server/modules/import "src/app/(app)/employees/import" src/components/import
git commit -m "feat(import): the employee importer, on the shared vocabulary"
```

---

### Task 13: E2E

**Files:**
- Create: `e2e/import-export.spec.ts`, `e2e/fixtures/make.ts`, and the generated fixtures

- [ ] **Step 1: Generate the fixtures with the app's own writer**

Write `e2e/fixtures/make.ts` — a `tsx` script that uses `toXlsxBuffer` to emit three files into
`e2e/fixtures/`:

- `assets-clean.xlsx` — 3 new rows, all valid.
- `assets-mixed.xlsx` — 2 new, 1 update of a seeded tag (`BR-LT-0148`), 1 unknown category, 1 duplicate
  serial taken from a seeded asset.
- `assets-oversized.xlsx` — `IMPORT_ROW_CAP + 1` rows.

**Commit the script AND the generated files.** The suite must not depend on a generation step, and §6a
rule 51 applies in the good direction: a fixture built by the app's own writer is one the running code
could have produced.

- [ ] **Step 2: Write the spec**

Copy the `login` and `expectNoSeriousAxe` helpers from `e2e/admin.spec.ts`. Assert:

1. `/inventory/import` renders, passes axe, and says on screen that the dry run writes nothing.
2. Uploading `assets-clean.xlsx` reports 3 creates and 0 blocked, and **writes nothing** — capture
   `/inventory`'s total before Validate and after, and assert it is unchanged.
3. Applying it creates 3 assets and 3 `import-create` rows on `/audit`.
4. `assets-mixed.xlsx` reports the four verdicts and groups the blocked ones biggest-first, and
   "Create category" links to `/admin/asset-categories`.
5. Picking "Update those assets instead" re-plans, moving the duplicate-serial row from blocked to
   update, **without writing** — the counts change and the asset total does not.
6. `assets-oversized.xlsx` is refused with the row-cap message and imports nothing.
7. A `viewer` cannot reach `/inventory/import` at all.
8. `/inventory/export` downloads a file named `assets-*.xlsx` — use
   `page.waitForEvent("download")` and `suggestedFilename()`.
9. `/inventory/export?ids=` with 501 ids returns **413**. Build the URL from `Array(501)`; the refusal
   precedes the query, so the ids need not exist.
10. The year chips render with counts, and `?purchaseYear=` narrows both the list and the export.
11. **The farewell sheet matches the printed report, with rows in it.** Drive an offboarding far
    enough to decide at least two items (Phase 7's `e2e/offboarding.spec.ts` already does this — reuse
    its steps), then assert the printable report shows N decided items and
    `/offboarding/<id>/report/export` downloads a sheet with N data rows. **Task 5 could only verify
    this at zero**, because the seeded database has no `lifecycle_return` approvals, and an equality
    that holds at zero is not evidence. This is the assertion that makes reusing `decidedItems` mean
    something.
12. **A filtered export matches its screen.** `/employees?gaps=1` and `/employees/export?gaps=1` must
    agree on their row count, and that count must be strictly smaller than the unfiltered one. This is
    the ONLY possible guard on the bug Task 4 shipped and fixed: the gaps cut happens in memory after
    the SQL `where`, so an export that used the `where` alone returned the candidate set — ten rows
    against a screen showing three. `filteredEmployees` is not unit-testable (it hits Prisma, as
    `listEmployees` does), so if this spec does not assert it, nothing does. Assert the same way for
    `/inventory?stage=…` against `/inventory/export?stage=…`, which is the identical pattern via
    `repairStageIds` and equally untested.

**Wrap the upload chain in `test.describe.serial`** — steps 2→5 share database state, and both
`e2e/admin.spec.ts:24` and `offboarding.spec.ts:75` establish that idiom for this shape. Without it one
real failure cascades into misleading ones.

**Uploading a file in Playwright:** `page.getByLabel(/Spreadsheet/).setInputFiles("e2e/fixtures/assets-clean.xlsx")`.
Give the file input a real accessible label so this locator is a rule and not a CSS guess.

- [ ] **Step 3: Get it green**

```bash
npm run db:seed && npx playwright test e2e/import-export.spec.ts --workers=1
```

Foreground, long timeout. Never background a Playwright run (§7). If a test needs typing into a
controlled input right after a navigation, apply §6a rule 61's headroom pattern.

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test(e2e): import and export, including every refusal"
```

---

### Task 14: Full battery and close-out

- [ ] **Step 1: The battery**

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
npm run db:seed && npx playwright test --workers=1
```

Expect e2e to rise from **102** by however many Task 13 added, and unit from **474** by Tasks 2, 3, 6,
7, 10 and 12 **minus the 4** deleted with `src/lib/csv.ts`. Write the real numbers down; do not carry
these forward.

- [ ] **Step 2: Prove the production image still builds**

```bash
docker compose --profile prod build
```

The second half of Task 1's guarantee, re-checked now that source has changed.

- [ ] **Step 3: Amend this plan to the shipped code**

Every task whose code deviated gets an `AMENDED` banner saying what and why — the discipline Phase 8
kept for all fourteen of its tasks. Expect several: twelve of Phase 8's fourteen deviated, and the
`write-excel-file` call in Task 2 was written from a README rather than from a run.

- [ ] **Step 4: Update `docs/HANDOVER.md` for Phase 10**

Header (phases done, the real battery numbers, push state as it actually is). §0 pointing at Phase 10's
planning. §4 gaining a Phase 9 paragraph. §5 leaving Phase 10 only. §6 replaced with **Phase 10's**
entry criteria: the printable 3×4 A4 label sheet with scan codes, USB-scanner polish so a scan ticks
the matching offboarding wizard row, the deployment README, and the full axe pass — **including the
decision about whether "full" means clearing moderates**, since the e2e helper only fails on
serious/critical and the app-wide `heading-order` violation sits below that bar. §6a gaining this
phase's rules. §7 and §8 gaining its gotchas and leftovers.

Leftovers to record whatever else the reviews find: no `ImportJob` persistence (scope decision 8), no
reference-data import (12), the 2,000-row cap (5), the dry-run rate-token cost (9), and the fact that
`applyAssetImport` re-reads the file rather than trusting the client's plan.

- [ ] **Step 5: Finish the branch**

`superpowers:finishing-a-development-branch`. **Merging and pushing are the user's decisions** —
present the options and wait rather than doing either. This repo is public, and `main` may still be
ahead of `origin/main` from earlier phases.

---
