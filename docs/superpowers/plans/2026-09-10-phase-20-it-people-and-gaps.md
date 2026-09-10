# Phase 20 — IT side: transfers, offboarding, directory, six gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give IT a dated department-transfer record, name who decided each offboarding item and when, add facets and sorting to the offboarding list, tighten the employee directory (same-name guard, leavers hidden, holdings export), and close six recorded IT gaps.

**Architecture:** One new table (`EmployeeTransfer`, migration 21) and otherwise changes to existing modules: pure rules in `src/lib`, server actions/queries in `employees`, `offboarding`, `lifecycle`, `inventory` and `import`, UI on the employee page, offboarding list/wizard/report, the bulk drawer, the register/asset forms, the loadout tile and the asset record header. Every derived facet (offboarding progress) is computed over candidates then paged.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, Auth.js v5, zod, vitest, Playwright; existing `pageOf`, `ListState`, `mergeTimeline`, `ImportWizard`, `toXlsxBuffer`, `auditSentence`.

**Spec:** `docs/superpowers/specs/2026-09-10-it-people-and-gaps-design.md` — the binding authority.

## Global Constraints

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`. Never the `inventory` database or port 3000. Never seed staging. Never commit `.env`; never print it.
- Playwright: foreground, `E2E_PORT=3100 --workers=1 --global-timeout`, port free before, no server left behind.
- Paged queries use `pageOf` with `ENTITY_PAGE_SIZE`/`LOG_PAGE_SIZE` and an id tiebreaker; a derived facet is computed over the candidate set, then the kept ids are paged.
- `"use server"` modules export only async functions; zod at every boundary; `ActionResult` union; role guard THEN `checkRate`; one `writeAudit` per write with the action names in the spec.
- The offboarding decision rules (window, grouping, `decisionOf`) do not change in meaning; only attribution fields are added.
- Tests first for pure modules; measured counts in commit messages; never amend; commit after every task.
- Reviewer subagents: read-only — never `git stash`, `git checkout`, `git restore`, `git reset`, `git switch`; verification in the foreground; report written before the reply.

## Decisions the plan makes beyond the spec

- **P-1** The repair-stage SQL parity cannot be a vitest test (vitest has no database). The unit test asserts `repairStage` on a 12-row fixture (the JS rule); the SQL CASE's agreement with it is proven in e2e `it-gaps.spec.ts` by comparing the raw cut against `repairStage` over every seeded asset. The spec §6.6 sentence is corrected in the same commit as this plan.
- **P-2** The Transfers card and the employee-page transfer line read `getTransfers(employeeId)` (all rows, `effectiveAt desc, id desc`); the timeline adds transfers as a fourth `mergeTimeline` source with `when = effectiveAt`.
- **P-3** The holdings export lives at `GET /employees/[id]/holdings` and returns one sheet: asset rows, a blank row, a `Reservations` header row, reservation rows — via one `HOLDINGS_EXPORT_COLUMNS` spec whose row type has a `section` discriminator.
- **P-4** `checkIdentifiers` gains `cls` in its zod input; the forms pass the class they render for. The neutral post-submit copy is the existing P2002 conflict text; nothing new is written for that path.
- **P-5** Offboarding sorting by `undecided` and the `progress` facet are applied in memory over the OFFBOARDING candidate set (bounded by the number of leavers), then paged; name/started sorts go to SQL.

## Amendments made during execution (`D-1`…`D-22`, from the SDD ledger, 2026-09-10)

Pre-flight (before Task 1):

- **D-1** (ruling R1) — `DecisionCandidate.decidedBy/decidedAt` are OPTIONAL (default null in `decisionOf`), `Decision`'s stay required, and Task 2 itself updated the two mapping lines in `report/export/route.ts`, so `tsc` stayed green between Tasks 2 and 5.
- **D-2** (R2) — Task 3 updated the offboarding page's call site minimally (`parseListState(sp, OFFBOARDING_LIST_CONFIG)`); the toolbar and sortable headers stayed in Task 5.
- **D-3** (R3) — the two `checkIdentifiers({ …, cls })` call-site edits moved from Task 6 to Task 3 (`register-form` already derived `cls`; `asset-form` derives it from its chosen category and skips the live check while none is chosen).
- **D-4** (R4) — measured counts govern every number in the plan and the docs.

Task rulings:

- **D-5** (R5, Task 3 → 4) — the missing `auditSentence` case for `employee.transferred` (plus its unit test) rode with Task 4.
- **D-6** (Task 3, accepted) — the "wrong class" bulk skip reason is unreachable behind the whole-selection class refusal (kept as a guard); `lastLifecycleChange` uses the spec's prefix rule (`lifecycle.*` or `register`) because the brief named a nonexistent `lifecycle.transfer` and missed `lifecycle.triage`.
- **D-7** (Task 4 review, Important) — the edit page no longer queries departments or passes a dead prop; `EmployeeForm`'s edit branch takes no `departments`.
- **D-8** (Task 4 review, Minor, accepted) — a same-name submit rejected server-side shows both the live banner and the field refusal; the two agree, so both stay.
- **D-9** (Task 5 review, two Importants, fix round 1 `5e19abe`) — the wizard's step-4 "What happened to the kit" table carries "Decided by"/"Decided on" like the Review-step table; `/offboarding` keeps the toolbar and count line when a facet filters to zero rows, with a "No one matches these filters" empty state and a "Clear filters" link; the sortable column header reads "Undecided".
- **D-10** (Task 5, accepted) — the Progress facet relabels the server values `open`/`complete` client-side as "Has undecided items"/"All decided"; the URL values and counts are untouched.
- **D-11** (Task 6, accepted) — `employees/[id]/page.tsx` plumbs `coveredByLoan` into the slot tile (one extra file beyond the brief).
- **D-12** (Task 6 review, R7, controller fix `b3fb44b`) — the bulk status toast reads `N asset(s) now STATUS · k skipped` (count first, destination named — the file's house style, over the brief's `Changed N`); `handleResult`'s comment now describes its single remaining caller; a loan-covered empty slot tile's accessible name says "on loan". The duplicated success block between `bulkAssign` and `bulkChangeStatus` is parked for the final review (the brief mandated mirroring exactly).
- **D-13** (R6, Task 7 brief defect) — the seed puts EMP-0042 in Finance, not Sales; transfers case 1 moves Finance → HR and asserts `Transferred from Finance on <today>`.
- **D-14** (R8, Task 7) — the Transfer dialog's picker already excludes the current department, so "Already in this department" is proven through the stale-dialog race (open the dialog, move the employee via Prisma, submit the now-current department) and the picker is asserted never to list the current department.
- **D-15** (Task 7 adaptations) — the import fix control for `same-name-in-department` is a Button (every `kind: "option"` fix renders that way), not a checkbox; the "Equipment slots" group renders empty before a policy applies, so case 2 asserts zero tiles then the specific `laptop slot, on loan, required` tile; no pre-existing spec changed an employee's department through the edit form (verified by grep), so none needed editing.
- **D-16** (R9, Task 8) — the "Last change" actor is the audit entry's `actorLabel`, i.e. the seeded IT user's name "J. Sarmiento", not "IT Staff".
- **D-17** (R10, Task 8) — the seed has no executed offboarding decision; a direct decision writes its approval row EXECUTED with `claimedById`/`resolvedAt` = the actor and time (`approvals/create.ts`), so offboarding-v2 case 1 decides one of Dennis Ong's items as IT and asserts "Decided by J. Sarmiento" with today's date; cases 2–3 reuse that state.
- **D-18** (R11, Task 8) — the "Contractor kit" policy fixture is created via Prisma (`appliesToTitle: "Contractor"`, one required laptop slot), as `asset-classes.spec.ts` builds its fixtures.

To complete at Task 9 / final review:

- **D-19** (Task 8 adaptations, accepted) — `/inventory/register` submits through `registerAssets`, whose duplicate-tag catch returns the generic conflict "One of those tags was just taken. Reload and try again." (the field-scoped "That tag is already registered" belongs to `createAsset` on `/inventory/new`), so it-gaps case 2 asserts that banner; BR-LT-0148 carries the seeded CLAIMED approval and so offers no Replace control — case 4 uses BR-LT-0201; the repair-stage chips carry no numeric badges, so case 6 compares each stage's DB-computed count with the toolbar's "N assets" total under `?stage=`; the loadout "missing" count renders only on the employees list row, so case 3 asserts it there; bulk-drawer case 1 hydrates on the first checkbox before checking (a lost `toggleRow` click otherwise); toasts carry the "Success: " tone prefix.
- **D-20** (R12, Task 8 concern 5, fix round 1) — axe `link-in-text-block` on `/offboarding` with two or more rows: the Name cell wrapped only the name in the Link with the "EMP-#### · Title" meta in a sibling span. Fixed in this phase by mirroring the employees list (one Link wrapping name + meta); offboarding-v2 case 5 scans the full rule set again. The structure dates from `3359430` (2026-08-18, Phase 7) and never fired because the seed has one leaver; Task 8's second leaver exposed it. Fix commit `519d804`.
- **D-21** (R13, Task 8 fix round 2) — `e2e/offboarding.spec.ts`'s "printable farewell report" case searched `/employees?q=Dennis` after completing his offboarding; Phase 20 hides OFFBOARDED people from the directory by default (spec §5), so the case now searches with `leavers=1` (the smallest edit; the product behaviour is the spec's). This is the one pre-existing e2e file Phase 20 changed. Fix commit `2641af5`.
- Task 8's review: spec ✅ 11/11, quality Approved, one Minor (dates asserted via `fmtDate(new Date())` at assertion time rather than the stored `decidedAt`; negligible, pre-existing pattern) accepted.
- **D-22** — Measured at close (Task 9, 2026-09-10, branch tip `f6ec5e1`): `tsc` clean · `lint` clean ·
  **21 migrations** · **1291 unit / 75 files** · **296 e2e / 27 files** by `--list`, across six foreground
  chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 (3.3m) · B 67 (3.9m) · C 68 (4.4m) ·
  D 38 (2.6m) · E 53 (7.3m) · F 21 (2.0m)** (chunks C and F both run `offboarding-v2.spec.ts`'s 5 cases by
  the brief's own chunk lists, so the six sum to 301 against 296 unique), zero failed, zero did-not-run on
  the runs recorded below; `npm run db:seed` run last, port 3100 clear before/after every chunk. Four
  test-only fixes, found re-running a chunk whose first pass failed on a case this phase's own behaviour
  changed underneath it — each its own commit, none a regression, D-21's "one pre-existing e2e file" count
  now stands at four:
  - Chunk A first pass **53/54**: `it-core.spec.ts` "list shows loadout gaps" expected 2 missing; gap 3's
    `coveredByLoan` now excuses Marites Bautista's loan-covered phone slot, true count 1. Reproduced on an
    immediate re-run; fixed (`fe4295c`); chunk re-ran **54/54**.
  - Chunk C first pass **61/68, 6 did not run** (`paging.spec.ts` is `test.describe.serial`): case 6's
    `db.employee.count()` counted the base-seed OFFBOARDED employee (EMP-0093) that spec §5's
    leavers-hidden default now excludes from the `/employees` toolbar. Reproduced; fixed by scoping the
    count to `employment: { not: "OFFBOARDED" }` (`63df64a`); chunk re-ran **68/68**.
  - Chunk D first pass **33/38, 4 did not run** (`registration.spec.ts` is also `test.describe.serial`):
    case 3's live-serial check ran with no category chosen; gap 2's class-scoped `checkIdentifiers` now
    skips the check entirely until a category names the class. Reproduced; fixed by choosing Laptop first
    (`0b463b1`). The full-chunk re-run then surfaced a second, previously-masked failure in the same
    serial block: case 5 stamped its collision serial onto a Laptop (IT class) while registering a
    Vehicle (Purchasing class) batch as Purchasing — the very cross-class leak gap 2 closed, so it stopped
    colliding. Fixed by stamping onto a Vehicle asset instead (`f6ec5e1`); chunk re-ran **38/38**.
  - Chunks B, E and F passed clean on the first try — **67/67**, **53/53**, **21/21**.
- **D-23+** — reserved for the final whole-branch review and its fix wave.

## File structure

**Create**
- `prisma/migrations/<ts>_employee_transfers/migration.sql`.
- `src/lib/transfer-schema.ts`, `same-name.ts`, `offboarding-list.ts` (+ tests); `src/lib/repairs.test.ts` additions.
- `src/server/modules/employees/transfer-actions.ts`.
- `src/components/employees/transfer-dialog.tsx`, `transfers-card.tsx`, `same-name-check.tsx`; `src/components/offboarding/offboarding-toolbar.tsx`.
- `src/app/(app)/employees/[id]/holdings/route.ts`.
- `e2e/transfers.spec.ts`, `directory.spec.ts`, `offboarding-v2.spec.ts`, `it-gaps.spec.ts`; `e2e/fixtures/employees-same-name.xlsx`.

**Modify**
- `prisma/schema.prisma`, `prisma/seed.ts`.
- `src/lib/{loadout,offboarding,employees-list,import-employees,import-vocabulary,export-columns,repairs}.ts` (+ tests).
- `src/server/modules/employees/{actions,queries}.ts`, `offboarding/queries.ts`, `lifecycle/actions.ts`, `inventory/{actions,queries}.ts`, `import/{employee-actions,resolve}.ts`.
- `src/components/employees/{employee-form,employees-toolbar,loadout-view}.tsx`, `src/components/inventory/{bulk-drawer,register-form,asset-form}.tsx`, `src/components/offboarding/item-decision.tsx` (if the wizard row renders there).
- `src/app/(app)/employees/{[id]/page,[id]/timeline/page,[id]/edit/page}.tsx`, `src/app/(app)/offboarding/{page,[employeeId]/page,[employeeId]/report/page,[employeeId]/report/export/route}.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`, `e2e/fixtures/make.ts`, `docs/HANDOVER.md`, `docs/PICKUP.md`.

---

### Task 1: Schema, migration 21 and seed

**Files:** `prisma/schema.prisma` (Employee ~305, Department ~182, User ~131), `prisma/migrations/<ts>_employee_transfers/`, `prisma/seed.ts` (after the employees are created ~line 123; `itStaff`, `depts`, `emp`, `day` exist).

**Interfaces — Produces:** Prisma model `EmployeeTransfer` exactly as spec §2; back-relations `Employee.transfers`, `Department.transfersFrom` / `transfersTo`, `User.employeeTransfers`.

- [ ] **Step 1: Schema** — paste spec §2's model; add the back-relations: `Employee` `transfers EmployeeTransfer[]`; `Department` `transfersFrom EmployeeTransfer[] @relation("transfersFrom")`, `transfersTo EmployeeTransfer[] @relation("transfersTo")`; `User` `employeeTransfers EmployeeTransfer[] @relation("employeeTransfers")`. `npx prisma format`.
- [ ] **Step 2: Migration** — `npx prisma migrate dev --name employee_transfers --create-only` (no hand-written tail), `npx prisma migrate deploy`, `npx prisma generate`, `npx prisma migrate status` → 21, up to date.
- [ ] **Step 3: Seed** — after the employees exist:
```ts
  // Phase 20: one transfer on record so the timeline and the Transfers card have data.
  await prisma.employeeTransfer.create({
    data: {
      employeeId: emp("EMP-0099").id, fromDepartmentId: depts["HR"].id, toDepartmentId: depts["Operations"].id,
      fromTitle: "Team Lead", toTitle: "Team Lead", effectiveAt: day(-90), reason: "Team consolidation", actorId: itStaff.id,
    },
  });
```
  Also add `"EmployeeTransfer"` to the seed's TRUNCATE list (before `"Employee"`).
- [ ] **Step 4: Verify and commit** — `npm run db:seed` twice (the second proves the truncate), `npx tsc --noEmit`, `npx vitest run` (baseline unchanged).
```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts
git commit -m "feat(schema): Phase 20 -- EmployeeTransfer (migration 21); seed one transfer for EMP-0099"
```

---

### Task 2: Pure rules and tests

**Files:** create `src/lib/transfer-schema.ts`, `same-name.ts`, `offboarding-list.ts` (+ `.test.ts`); modify `src/lib/loadout.ts`, `offboarding.ts`, `employees-list.ts`, `import-employees.ts`, `import-vocabulary.ts`, `export-columns.ts`, `repairs.ts`, `inventory-list.ts` (+ tests).

**Interfaces — Produces:**
```ts
// transfer-schema.ts
export const transferSchema: z.ZodType<{ employeeId: string; toDepartmentId: string; toTitle: string; effectiveAt: string; reason: string }>; // effectiveAt dateStr, not after today (UTC); reason ≤ 300, default ""
export const TRANSFER_RECENT_DAYS = 90;
export function isRecentTransfer(effectiveAt: Date, now?: Date): boolean;
// same-name.ts
export function sameNameKey(name: string): string;               // refKey(name)
export function nameDeptKey(name: string, departmentName: string): string; // `${refKey(name)}|${refKey(departmentName)}`
// offboarding-list.ts
export const OFFBOARDING_LIST_CONFIG: ListConfig; // facets ["department","progress"], sortable ["name","started","undecided"], defaultSort name asc
export type Progress = "open" | "complete";
export function progressOf(undecided: number): Progress;
export function buildOffboardingWhere(state: ListState): Prisma.EmployeeWhereInput;         // employment OFFBOARDING + department IN
export function buildOffboardingOrderBy(sort: SortKey[]): Prisma.EmployeeOrderByWithRelationInput[] | null; // null when sort is "undecided" (in-memory)
export function sortByUndecided<T extends { undecided: number; name: string; employeeNo: string }>(rows: T[], dir: "asc" | "desc"): T[];
// loadout.ts (extended)
export interface Loadout<A> { slots: Array<{ slot: SlotLike; asset: A | null; coveredByLoan: boolean }>; …unchanged…; coveredByLoan: number }
// offboarding.ts (extended)
export interface DecisionCandidate { …; decidedBy: string | null; decidedAt: Date | null }
export interface Decision { …; decidedBy: string | null; decidedAt: Date | null }
// employees-list.ts (extended)
EMPLOYEES_LIST_CONFIG.facets: ["department", "employment", "leavers"]; buildEmployeeWhere hides OFFBOARDED unless employment set or leavers=["1"]
// import-employees.ts (extended)
export interface EmployeeRefs { …; byNameDept: Map<string, string> } // nameDeptKey → employeeNo
export interface EmployeeImportOptions { keepCurrentEmployment: boolean; allowSameName: boolean }
// import-vocabulary.ts: BLOCK_CAUSES += "same-name-in-department"; IMPORT_OPTIONS += "allowSameName"
// export-columns.ts: FAREWELL_EXPORT_COLUMNS row gains decidedBy: string | null, decidedAt: Date | null (+ two columns); HOLDINGS_EXPORT_COLUMNS
// repairs.ts: export const REPAIR_STAGE_CASE_SQL (the CASE expression text) and repairStageFixture (12 RepairLike rows with expected stages) for tests
// inventory-list.ts: export function identifierWhere(cls: AssetClass, tags: string[], serials: string[]): { tags: Prisma.AssetWhereInput; serials: Prisma.AssetWhereInput }
```

- [ ] **Step 1: transfer-schema + same-name (tests first)** — tests: same department is NOT checked here (the action compares with the record) but `toDepartmentId` required; `toTitle` 2–120; `effectiveAt` future refused with "That date is in the future", today accepted; `reason` ≤ 300; `isRecentTransfer` true at 89 days, false at 91. `nameDeptKey("Maria  Santos", "finance")` equals `nameDeptKey("maria santos", "Finance")`.
- [ ] **Step 2: offboarding-list (tests first)** — where has `employment: "OFFBOARDING"` and department IN; `buildOffboardingOrderBy([{key:"started",dir:"desc"}])` → `[{ offboardingAt: "desc" }, { employeeNo: "asc" }, { id: "asc" }]`; `undecided` → `null`; `sortByUndecided` stable by name then employeeNo; `progressOf(0)` complete, `progressOf(2)` open.
- [ ] **Step 3: loadout covered-by-loan (tests first)** — after the greedy fill, for each standard slot left empty whose `assetTypeId` matches a remaining TEMPORARY asset: `coveredByLoan = true`; the asset stays in `onLoan`; `missingRequired` excludes such slots; `coveredByLoan` count returned. Test: one laptop on loan + a required standard laptop slot → `missingRequired 0`, `coveredByLoan 1`, `onLoan` has the device; two standard laptop slots and one loan → one covered, one missing; a loaner slot still consumes the TEMPORARY device first.
- [ ] **Step 4: offboarding attribution (tests first)** — `DecisionCandidate`/`Decision` gain `decidedBy`/`decidedAt`; `decisionOf` copies them from the winner; test: EXECUTED winner with claimer "A. Reyes" and resolvedAt → carried; PENDING winner → both null.
- [ ] **Step 5: employees-list leavers (tests first)** — with no `employment` and no `leavers` → `where.employment = { not: "OFFBOARDED" }`; `leavers=["1"]` → no employment clause; explicit `employment` wins; facets include `"leavers"`.
- [ ] **Step 6: import same-name (tests first)** — append `"same-name-in-department"` to `BLOCK_CAUSES` with a SPEC (label "Same name already in that department", explain: an existing person with this name is already in this department and the row has no employee number match — it may be a duplicate; fix option `allowSameName` "Add same-name rows as new people"); append `"allowSameName"` to `IMPORT_OPTIONS` (extend `optionsFromForm`/labels and the vocabulary test's totality maps); `EmployeeRefs.byNameDept`; in `planEmployeeRows`'s CREATE branch, when `refs.byNameDept.get(nameDeptKey(name, departmentName))` exists and `!options.allowSameName` → block with the cause (detail: the existing employeeNo). Tests for both branches.
- [ ] **Step 7: export columns + repairs fixture + identifierWhere (tests first)** — `FAREWELL_EXPORT_COLUMNS` gains `{ label: "Decided by" }` and `{ label: "Decided on", Date }` after "Status"; `HOLDINGS_EXPORT_COLUMNS<{ section: "asset" | "reservation" | "blank" | "header"; tag: string; model: string; type: string; status: string; since: Date | null; loanDue: Date | null }>` with cells that render `""` for blank/header rows except the first column carrying "Reservations" for the header. `REPAIR_STAGE_CASE_SQL` (a string constant with the CASE from spec §6.6) and `repairStageFixture` (12 rows: DEFECTIVE plain, DEFECTIVE with vendor, DEFECTIVE with rmaRef, DEFECTIVE quote ≥ 60% incl. the centavo edge 6000.57 / 10000.95, quote < 60%, non-DEFECTIVE with defectiveSince, non-DEFECTIVE without, cost 0, quote null, …) with a test that `repairStage` returns each expected stage. `identifierWhere(cls, tags, serials)` → `{ tags: { cls, tag: { in } }, serials: { cls, serial: { in } } }` with a test.
- [ ] **Step 8: Verify and commit** — `npx tsc --noEmit && npx vitest run && npx eslint src/lib`.
```bash
git add src/lib
git commit -m "feat(lib): Phase 20 pure rules -- transfer schema, same-name keys, offboarding list config/order/progress, loan-covered slots, decision attribution, leavers default, same-name import cause/option, export columns, repair-stage fixture, identifierWhere (N unit / M files)"
```

---

### Task 3: Server — transfers, directory, offboarding queries, the six gap backends

**Files:** create `src/server/modules/employees/transfer-actions.ts`, `src/app/(app)/employees/[id]/holdings/route.ts`; modify `src/server/modules/employees/{actions,queries}.ts`, `offboarding/queries.ts`, `lifecycle/actions.ts`, `inventory/{actions,queries}.ts`, `import/{employee-actions,resolve}.ts`.

**Interfaces — Produces:**
```ts
// transfer-actions.ts
export async function transferEmployee(input: unknown): Promise<ActionResult<{ id: string }>>;
// employees/queries.ts
export async function getTransfers(employeeId: string): Promise<Array<{ id: string; from: string; to: string; fromTitle: string; toTitle: string; effectiveAt: Date; reason: string | null; actor: string }>>;
export async function findSameName(name: string, departmentId: string, excludeId?: string): Promise<{ id: string; employeeNo: string; department: string } | null>;
export async function holdingsRows(employeeId: string): Promise<HoldingsRow[]>;
// employees/actions.ts
export async function checkSameName(input: unknown): Promise<ActionResult<{ match: { employeeNo: string; department: string } | null }>>; // read-only
// createEmployee input gains confirmSameName: boolean (default false); updateEmployee's schema drops departmentId
// offboarding/queries.ts
export async function listOffboarding(state: ListState): Promise<{ rows: OffboardingRow[]; total: number; page: number; pageCount: number; facets: { department: FacetOption[]; progress: FacetOption[] } }>; // OffboardingRow gains started: Date | null, departmentId
// ApprovalLike gains claimedBy: { name: string } | null; resolvedAt: Date | null (every select that builds it adds claimedBy { select: { name } }, resolvedAt)
// lifecycle/actions.ts: bulkChangeStatus → ok({ changed, skipped: Array<{ tag: string; reason: string }> })
// inventory/actions.ts: checkIdentifiers input gains cls: AssetClass (required)
// inventory/queries.ts: repairStageIds uses one $queryRaw with REPAIR_STAGE_CASE_SQL; spareOptions returns note "Same type" | "Other spare"; export async function lastLifecycleChange(assetId): Promise<{ sentence: string; at: Date; actor: string } | null>
```

- [ ] **Step 1: transferEmployee** — `actionRole("admin", "it_staff")`; `checkRate`; `transferSchema`; load the employee with department (`conflict("That employee no longer exists.")`; `employment === "OFFBOARDED"` → `conflict("A leaver cannot be transferred")`); `toDepartmentId === employee.departmentId` → `validationError({ toDepartmentId: "Already in this department" })`; the department must exist (`validationError({ toDepartmentId: "Unknown department" })`); transaction: create the transfer (`fromTitle: employee.title`), `update` the employee (`departmentId`, `title`), audit `employee.transferred` with `diff: { department: { from: oldName, to: newName }, title: { from, to }, effectiveAt: { from: null, to: date } }`; revalidate `/employees`, `/employees/${id}`, `/employees/${id}/timeline`, `/offboarding`.
- [ ] **Step 2: Directory** — `findSameName` via `prisma.employee.findMany({ where: { departmentId, id: { not: excludeId } }, select: { id, name, employeeNo, department: { select: { name } } } })` filtered by `sameNameKey` (bounded by department size); `checkSameName` (`actionRole("admin","it_staff")`, zod `{ name, departmentId, excludeId? }`, no rate cost beyond `checkRate`); `createEmployee` schema `+ confirmSameName: z.boolean().default(false)` and the refusal copy from spec §5; `updateEmployee` schema drops `departmentId` and the update data omits it. `holdingsRows`: held assets (`assigneeId`) with type name, status, `since` = the newest audit entry `entityId = asset.id AND action = "lifecycle.assign"`'s `createdAt` (one `findMany` over the held ids, grouped in memory) or `asset.updatedAt`, `loanDueAt`; then ACTIVE reservations. Route `holdings/route.ts`: `requireUser`, the employee must exist (404), `HOLDINGS_EXPORT_COLUMNS`, `exportFilename(`holdings-${employeeNo}`)`, cap at `EXPORT_CAP`.
- [ ] **Step 3: Offboarding** — `ApprovalLike` attribution fields threaded from every select (`listOffboarding`, `getWizard`, the report/export loaders); `candidatesFor`/`groupCandidates` copy `decidedBy: a.claimedBy?.name ?? null`, `decidedAt: a.resolvedAt`. `listOffboarding(state)`: where/order from `offboarding-list.ts`; when `progress` is set or sort is `undecided`, fetch all OFFBOARDING candidates (narrow include as today), compute rows, filter/sort in memory, `pageOf(kept.length, page, ENTITY_PAGE_SIZE)`, slice; else SQL page. Facets: `department` groupBy over OFFBOARDING employees; `progress` counts from the computed rows (both computed over the where minus their own key).
- [ ] **Step 4: Gaps** — `bulkChangeStatus`: collect `skipped: { tag, reason }[]` with reasons `"already ${to}"`, `"held by an open request"`, `"closed status ${status} — cannot change"`, `"wrong class"` (when class filtering drops it — keep the one-class refusal as is), and the holder-guard `r.error`; drawer already renders the list shape. `checkIdentifiers`: `cls: z.enum(ASSET_CLASSES)` required, `identifierWhere`. `repairStageIds`: `const rows = await prisma.$queryRaw<Array<{ id: string; stage: string }>>(Prisma.sql`SELECT "id", ${Prisma.raw(REPAIR_STAGE_CASE_SQL)} AS stage FROM "Asset" WHERE "cls" = ${cls}::"AssetClass" AND ("status" = 'DEFECTIVE' OR "defectiveSince" IS NOT NULL)`)`, keep requested stages, and when `state.q` or any other filter is active intersect with `prisma.asset.findMany({ where: buildAssetWhere(...), select: { id } })`. `spareOptions(preferTypeId)` adds `note`. `lastLifecycleChange(assetId)`: newest `auditEntry` with `entityType "asset"`, `entityId`, `action` in (`lifecycle.assign`, `lifecycle.return`, `lifecycle.replace`, `lifecycle.change-status`, `lifecycle.transfer`, `register`) → `{ sentence: auditSentence({ actorLabel, action, diff, entityLabel: tag }), at: createdAt, actor: actorLabel }`.
- [ ] **Step 5: Import** — `resolveEmployeeRefs` also selects `name`, `departmentId` and builds `byNameDept` (department names from the departments list); `employee-actions.ts` reads `allowSameName` from `optionsFromForm(form)`.
- [ ] **Step 6: Verify and commit** — `npx tsc --noEmit && npx eslint src && npx vitest run`.
```bash
git add src/server "src/app/(app)/employees/[id]/holdings"
git commit -m "feat(server): Phase 20 -- transferEmployee; same-name check and confirm; holdings export; offboarding attribution, facets and sorting; bulkChangeStatus skipped list; class-scoped checkIdentifiers; repair stage in SQL; spare notes; lastLifecycleChange"
```

---

### Task 4: Employees UI — transfer dialog and card, timeline source, edit form, same-name check, leavers toggle, holdings link

**Files:** create `src/components/employees/transfer-dialog.tsx`, `transfers-card.tsx`, `same-name-check.tsx`; modify `src/components/employees/{employee-form,employees-toolbar}.tsx`, `src/app/(app)/employees/[id]/{page,timeline/page}.tsx`, `src/app/(app)/employees/[id]/edit/page.tsx`, `src/app/(app)/employees/new/page.tsx` (if it passes departments).

**Contract (accessible names the e2e files use verbatim):** header button "Transfer"; dialog title "Transfer <name>"; `aria-label`s "New department", "New title", "Effective date", "Reason"; confirm "Record transfer"; toast `Transferred to <Department>`; the header line `Transferred from <Dept> on <date>`; Transfers card title "Transfers" with rows `<date> · <from> → <to>` and the reason; timeline entry text starts `Transferred to <Dept> (from <Dept>)`; edit form hint text "Department changes are recorded with Transfer" (a link to the employee page); create form checkbox `aria-label="This is a different person"` and the warning text `Another <name> exists in <Dept> (<EMP-no>)`; employees toolbar toggle "Show leavers" / "Hide leavers"; employee page link "Export holdings".

- [ ] **Step 1: Transfer dialog + card + page** — `TransferDialog` (client; `Dialog`; departments prop excludes the current one; fields per the contract; `useTransition` + the house result handling; on ok toast and `router.refresh()`); `TransfersCard` (server; rows from `getTransfers`; empty text "No transfers on record."). Employee page: the "Transfer" button in `PageHeader actions` for `admin`/`it_staff`; under the title/department line, when the newest transfer `isRecentTransfer` → the header line; the card after the loadout section; "Export holdings" `ButtonLink` to `/employees/${id}/holdings` for every role.
- [ ] **Step 2: Timeline** — add a fourth source: `prisma.employeeTransfer.findMany({ where: { employeeId: id, ...(cursor ? { effectiveAt: { lte: cursor.before } } : {}) }, include: { fromDepartment: true, toDepartment: true, actor: true }, orderBy: [{ effectiveAt: "desc" }, { id: "desc" }], take })` → points `{ id: `transfer-${t.id}`, when: t.effectiveAt, item: { … title: <>Transferred to <b>{to}</b> (from {from}){reason ? ` · ${reason}` : ""} — by {actor}</> } }`; pass as the fourth array to `mergeTimeline`.
- [ ] **Step 3: Edit form** — remove the Department `FormField` when `mode === "edit"` and render the hint with a link; keep it on `mode === "new"`; `updateEmployee` no longer receives `departmentId`.
- [ ] **Step 4: Same-name check** — `SameNameCheck` (client) receives `name`, `departmentId`, `excludeId?`; on change (debounced 400 ms) calls `checkSameName`; renders the warning text and the checkbox, lifting `confirmSameName` to the form via a callback; the form sends `confirmSameName` on create. Server refusal (flag false) lands under the Name field.
- [ ] **Step 5: Leavers toggle** — `employees-toolbar.tsx`: a `Link` "Show leavers" (`withFilter(state, "leavers", ["1"])`) / "Hide leavers" (`withFilter(state, "leavers", [])`) beside the facets.
- [ ] **Step 6: Verify** — `npx tsc --noEmit && npx eslint src/components src/app`; manual walk on a FOREGROUND dev server on 3100 as `it@`: transfer EMP-0042 to HR → header line, card, timeline; edit form shows the hint; create "Carlo Dizon" in Operations → warning + checkbox; "Show leavers"; Export holdings downloads. Stop the server; port free; `npm run db:seed`.
```bash
git add src/components/employees "src/app/(app)/employees"
git commit -m "feat(employees): transfer dialog, transfers card and header line, timeline source; edit form points at Transfer; same-name warning with confirm; leavers toggle; holdings export link"
```

---

### Task 5: Offboarding UI — attribution on wizard, report and export; list toolbar with facets and sorting

**Files:** create `src/components/offboarding/offboarding-toolbar.tsx`; modify `src/app/(app)/offboarding/page.tsx`, `[employeeId]/page.tsx`, `[employeeId]/report/page.tsx`, `[employeeId]/report/export/route.ts`, `src/components/offboarding/item-decision.tsx` (if it renders the decision cell).

**Contract:** wizard and report columns "Decided by" and "Decided on" (cells `—` when null); export sheet headers "Decided by", "Decided on"; list toolbar facet dropdowns "Department" and "Progress" (options "Has undecided items" / "All decided"); sortable column headers "Name", "Started", "Undecided" as links that toggle `sort=` (`toggleSort` from `url-state`); the count line keeps `N people leaving`.

- [ ] **Step 1: Attribution** — wizard table: two `Th`s after "Decision" and the cells from `i.decision.decidedBy ?? "—"` / `fmtDate(i.decision.decidedAt)`; report table the same; export route maps `decidedBy`, `decidedAt` into the rows.
- [ ] **Step 2: List** — `page.tsx`: `parseListState(sp, OFFBOARDING_LIST_CONFIG)` → `listOffboarding(state)`; `<OffboardingToolbar state facets />` (client: two `FacetDropdown`s wired with `withFilter` + `serializeListState(state, OFFBOARDING_LIST_CONFIG)`); sortable `Th` links via `toggleSort(state, key)`; `Pagination` hrefs keep the state.
- [ ] **Step 3: Verify** — `npx tsc --noEmit && npx eslint src/components src/app`; manual: `/offboarding` facets and sort work; the wizard for the seeded leaver shows the decided-by cells; the report and export carry them. Stop the server; port free.
```bash
git add src/components/offboarding "src/app/(app)/offboarding"
git commit -m "feat(offboarding): who decided and when on the wizard, report and export; list facets (department, progress) and sortable columns"
```

---

### Task 6: IT gaps UI — bulk skipped list, class-scoped live check, loan-covered tile, Replace notes, Last change line

**Files:** modify `src/components/inventory/{bulk-drawer,register-form,asset-form}.tsx`, `src/components/employees/loadout-view.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`.

**Contract:** the drawer's skipped banner title `N skipped` with rows `TAG — reason` (already exists for assign; reuse for status); the loadout tile text "on loan" (mono, neutral) where "policy gap" would have read, plus a `LOAN` pill; the Replace combobox option notes "Same type" / "Other spare"; the record header line `Last change: <sentence> · <date> · by <actor>` in the meta paragraph when no approval is pending.

- [ ] **Step 1: Bulk drawer** — the status path handles `{ changed, skipped }` like the assign path: toast `Changed N` and `setSkippedList(skipped)`; the explanatory copy at ~173–176 updated to say the skipped tags are listed.
- [ ] **Step 2: Live check class** — `register-form.tsx` passes `cls` (already derived from the chosen category) into `checkIdentifiers({ tags, serials, cls })`; `asset-form.tsx` passes the form's class (derive from its category the same way; if the form has no category yet, skip the live check until one is chosen).
- [ ] **Step 3: Loan-covered tile** — `loadout-view.tsx` reads `coveredByLoan` per slot: render "on loan" (mono, `text-fg-muted`) instead of "policy gap" and a `LOAN` pill; the progress line's missing count already uses `missingRequired`.
- [ ] **Step 4: Replace notes** — nothing in `replace-control.tsx` changes; the combobox shows `option.note` already — verify visually that both labels appear.
- [ ] **Step 5: Last change line** — `layout.tsx`: `const last = pending ? null : await lastLifecycleChange(asset.id)`; append ` · Last change: ${last.sentence} · ${fmtDate(last.at)} · by ${last.actor}` to the meta `<p>` (or a second `<p>` beneath it) when present.
- [ ] **Step 6: Verify** — tsc/eslint; manual on 3100 as `it@`: bulk status change with one closed-status tag → skipped list names it; register page as IT typing a Purchasing tag gets no live hint (find one in the seed) and saving it gets the conflict; EMP-0095's page shows "on loan" not "policy gap"; Replace picker shows the notes; a direct return puts the Last change line. Stop the server; reseed.
```bash
git add src/components/inventory src/components/employees/loadout-view.tsx "src/app/(app)/inventory/[id]/layout.tsx"
git commit -m "feat(inventory): bulk status skipped list; class-scoped live identifier check; loan-covered slot reads on loan; Replace picker group notes; Last change line on the record"
```

---

### Task 7: E2E — `transfers.spec.ts` and `directory.spec.ts`

**Files:** create `e2e/transfers.spec.ts` (5), `e2e/directory.spec.ts` (5), `e2e/fixtures/employees-same-name.xlsx` (via `make.ts`: one row "Carlo Dizon", Team Lead, Operations, joined 2026-01-05, employee no `EMP-0150`; one ordinary new row).

House rules: reseed in `beforeAll`; copy `login`, `waitForHydration`, `expectNoSeriousAxe` from `e2e/stock.spec.ts`; state-based waits; dialog-scoped clicks; `FormField` asterisk → aria-labels; DB facts via `PrismaClient`; reseed at the end; existing specs that changed a department through the edit form (grep `Department` selects in `e2e/*.spec.ts`) switch to the Transfer dialog with the smallest edit, listed in the report.

- [ ] **transfers.spec.ts** — 1 transfer EMP-0042 (Sales → HR, reason "Reorg") → header line `Transferred from Sales on <today>`, Transfers card row, timeline entry, audit `employee.transferred`, `/employees?department=<HR id>` lists EMP-0042; 2 loadout re-evaluates: move EMP-0095 (Operations, no policy) into Finance (has "Finance standard") → the slot tiles appear; 3 same-department refusal text "Already in this department"; 4 future date refusal "That date is in the future"; 5 the edit form has no "Department" select and shows the hint; axe on the dialog.
- [ ] **directory.spec.ts** — 1 create "Carlo Dizon" in Operations → warning `Another Carlo Dizon exists in Operations (EMP-0099)`, saving without the tick refuses under Name, tick → created; 2 import `employees-same-name.xlsx` → the same-name row blocked with the cause label; tick "Add same-name rows as new people" → 2 created; 3 `/employees` hides an OFFBOARDED seed employee by default, "Show leavers" shows them, `?employment=OFFBOARDED` shows them regardless; 4 holdings export for EMP-0042: 200, `content-disposition` has `holdings-EMP-0042`, the sheet has header "Tag" and the held tag row and a "Reservations" row; 5 axe on the employee page with the Transfers card.
- [ ] Run each file FOREGROUND until green, once more for stability; then any existing specs you edited; `--list`; reseed. Commit: `test(e2e): transfers and directory -- transfer record, timeline, loadout re-evaluation, refusals, edit form; same-name guard on create and import, leavers toggle, holdings export (10 cases; --list N / M files)`.

---

### Task 8: E2E — `offboarding-v2.spec.ts` and `it-gaps.spec.ts`

**Files:** create `e2e/offboarding-v2.spec.ts` (5), `e2e/it-gaps.spec.ts` (6).

- [ ] **offboarding-v2.spec.ts** — 1 the seeded leaver's wizard shows "Decided by" with the seed's approver name and a date on the executed item (read the seed for who claimed it); 2 the report page shows the same; 3 the export sheet has "Decided by"/"Decided on" headers and the value; 4 facets: `?department=<id>` narrows; Progress "All decided" excludes the person with undecided items (derive from the DB); 5 sort by Undecided desc puts the largest first; axe on the list and report.
- [ ] **it-gaps.spec.ts** — 1 bulk status change on two tags where one is in a closed status → the skipped banner lists that tag with its reason; 2 register form as `it@`: type a Purchasing-class seeded tag → no live "already registered" hint within 3 s (a NEGATIVE assertion: use the sanctioned settle, sized to the form's debounce constant read from `register-form.tsx`, with a comment); submit → the neutral conflict; 3 EMP-0095 (holds BR-LT-0210 on loan, Contractor kit created in the test with a standard laptop slot) → the tile reads "on loan", no "policy gap", and the progress line's missing count is 0 for that slot; 4 the Replace picker on a held laptop shows an option with note "Same type" and one with "Other spare" (create a same-type spare first if the seed lacks one); 5 a direct return on a held IT asset → the record shows `Last change: … by IT Staff`; 6 repair parity: read every asset via the DB, compute `repairStage` in the test (import from `src/lib/repairs`), and compare with the chip counts on `/inventory?stage=…` for each stage; axe on the bulk drawer open and the record.
- [ ] Run each file FOREGROUND until green, once more; `--list`; reseed. Commit: `test(e2e): offboarding v2 and IT gaps -- attribution on wizard/report/export, facets and sort; bulk skipped list, class-scoped live check, loan-covered slot, Replace notes, Last change line, repair-stage parity (11 cases; --list N / M files)`.

---

### Task 9: Battery, documentation, amendment block

- [ ] **Battery** — `npx tsc --noEmit`; `npx eslint .`; `npx vitest run` (record); `npx prisma migrate status` (21); `npx playwright test --list | tail -1`; e2e in SIX foreground chunks ≤ 70 tests, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: A `it-core import-export purchases`; B `asset-classes department-owned auth-shell labels`; C `offboarding receiving paging home-finance approvals-audit`; D `admin direct-lifecycle scanner registration`; E `custody axe-sweep kitchen-sink suppliers purchasing-ext stock stocktake`; F `transfers directory offboarding-v2 it-gaps`. Zero failed, zero did-not-run; failures diagnosed, fixed, re-run and recorded.
- [ ] **Documents** — HANDOVER line 3 leading parenthetical for Phase 20 (CODE-COMPLETE, UNMERGED and UNPUSHED; spec, plan, `D-1`…`D-n`; battery with chunk sizes/times; 21 migrations; `--list`); a new **(m)** block after (l) (what shipped per spec §3–§6, why, battery, "What remains: merge/push and staging redeploy are the user's decisions (not pre-authorised); `HANDOVER-PENDING.md` holds the parked work"); §0 item 9 chunk list + correction history (`→ N / 27 files`; name any pre-existing e2e files changed); §5/§8 entries for the six gaps marked closed. PICKUP: Branch, Database (21 on the branch; main/staging at 20/19), Battery row, Last two phases (20 then 19), item 1, §5 known gaps updated. Plan D-block above "## File structure" with every ledger ruling and P-1…P-5; spec Status line.
- [ ] Commit: `docs(handover,pickup,plan): Phase 20 code-complete -- battery N e2e / 27 files, M unit, 21 migrations; (m) block; D-1..D-n`.

---

## Self-review (writing-plans checklist, run 2026-09-10)

1. **Spec coverage.** §2 → Task 1; §3 → Tasks 2 (schema), 3 (action, queries), 4 (UI, timeline, edit form); §4.1 → Tasks 2, 3, 5; §4.2 → Tasks 2, 3, 5; §5 → Tasks 2, 3, 4, 7; §6.1–6.6 → Tasks 2 (identifierWhere, loadout, repairs fixture), 3 (backends), 6 (UI); §7 → refusal copy in Tasks 3–4; §8 → Tasks 2, 7, 8, 9. Gap closed: the spec's "unit test proves the SQL CASE" is impossible without a database — P-1 moves the parity proof to e2e and the spec line is corrected.
2. **Placeholders.** None; UI tasks carry the accessible-name contracts and the exact copy, mirroring named existing components.
3. **Type consistency.** `Loadout.slots[].coveredByLoan` (Task 2) ↔ `loadout-view.tsx` (Task 6); `Decision.decidedBy/decidedAt` (Task 2) ↔ wizard/report/export (Task 5) ↔ `FAREWELL_EXPORT_COLUMNS` (Task 2); `listOffboarding(state)` + facets (Task 3) ↔ toolbar (Task 5); `checkIdentifiers({ cls })` (Task 3) ↔ forms (Task 6); `bulkChangeStatus` skipped shape (Task 3) ↔ drawer (Task 6); `getTransfers` row shape (Task 3) ↔ `TransfersCard` (Task 4); `EmployeeImportOptions.allowSameName` (Task 2) ↔ `optionsFromForm` (Task 3).
