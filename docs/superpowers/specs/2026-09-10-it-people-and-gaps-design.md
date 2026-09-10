# Phase 20 — IT side: department transfers, offboarding attribution and facets, directory quality, and six known gaps

**Status:** design approved in conversation 2026-09-10 (areas, employee items, the transfer flow, the
approach and all seven sections). The Purchasing/stock work is parked in `docs/HANDOVER-PENDING.md`.

**Plan:** `docs/superpowers/plans/2026-09-10-phase-20-it-people-and-gaps.md` (written next).

---

## 0. Decisions made in the brainstorm

| # | Decision | Why |
|---|---|---|
| 1 | The phase covers "close the known IT gaps" and "employees and offboarding"; repair tracking and retirement/disposal stay out. | The user's pick. |
| 2 | A department transfer is recorded by IT directly (admin, it_staff) with an effective date, optional new title and reason; a dedicated `EmployeeTransfer` table keeps the history; no approval step. | Routine HR event; a table is queryable and honest; the audit alone has no effective date. |
| 3 | The edit form loses its department select; a department change always goes through Transfer. | One path for one fact, so every change carries a date and a record. |
| 4 | The farewell report and export name who decided each item and when, read from the executing approval (claimer, resolved time). | Already stored, never shown (HANDOVER §8, Phase 9 Task 5). |
| 5 | The offboarding list gains Department and Progress facets and sorting; progress is derived per row and applied after computing (the low-stock pattern). | The list is paged since Phase 17 but unfiltered. |
| 6 | Same-name-same-department is a warning that needs a deliberate confirm on create and an import option; leavers hide by default behind a toggle; each employee gets a holdings export. | Directory hygiene the user asked for. |
| 7 | Six gap fixes: bulk status skipped list, class-scoped identifier check, loan-covered slots, Replace picker group labels, a "Last change" line for direct IT changes, repair stage in SQL. | Recorded gaps (PICKUP §5, HANDOVER §8). Webhook retention stays out. |

---

## 1. Scope

**In:** everything in §0. **Out:** repair/RMA workflow, retirement and disposal, M365 sync (still deferred by
the user), webhook delivery retention, D2 stock control and the rest of `HANDOVER-PENDING.md`.

**Behaviour that must not change:** the offboarding decision rules (window, grouping, `decisionOf`); the
approval state machine; the label sheet; the Purchasing and stock areas; every existing URL.

---

## 2. Data model — migration 21 `employee_transfers`

```prisma
/// Phase 20 (spec §2). A dated record of a department (and optionally title) change.
/// The employee row is updated in the same transaction; a wrong transfer is
/// corrected by another transfer — nothing is edited or deleted.
model EmployeeTransfer {
  id               String     @id @default(cuid())
  employeeId       String
  employee         Employee   @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  fromDepartmentId String
  fromDepartment   Department @relation("transfersFrom", fields: [fromDepartmentId], references: [id], onDelete: Restrict)
  toDepartmentId   String
  toDepartment     Department @relation("transfersTo", fields: [toDepartmentId], references: [id], onDelete: Restrict)
  fromTitle        String
  toTitle          String
  effectiveAt      DateTime
  reason           String?
  actorId          String
  actor            User       @relation("employeeTransfers", fields: [actorId], references: [id], onDelete: Restrict)
  createdAt        DateTime   @default(now())

  @@index([employeeId, effectiveAt, id])
  @@index([toDepartmentId])
}
```
Back-relations: `Employee.transfers`, `Department.transfersFrom`/`transfersTo`, `User.employeeTransfers`.
No other schema change. Seed: one transfer for `EMP-0099` (HR → Operations, 90 days ago, title unchanged,
reason "Team consolidation", actor `it@`); `EMP-0099` stays in Operations as today.

---

## 3. Department transfer

- **Access:** `canTransferEmployee(role)` → `admin`, `it_staff` (the roles that create/edit employees).
- **Action** `transferEmployee({ employeeId, toDepartmentId, toTitle, effectiveAt, reason })`
  (`src/server/modules/employees/transfer-actions.ts`): zod — `toDepartmentId` required and must differ
  from the current one ("Already in this department"), `toTitle` 2–120 (prefilled with the current title),
  `effectiveAt` `dateStr` not after today ("That date is in the future"), `reason` ≤ 300 optional. Refuses
  an unknown department (field error) and an OFFBOARDED employee (`conflict("A leaver cannot be
  transferred")`). One transaction: create the transfer row, update `Employee.departmentId` and `title`,
  audit `employee.transferred` on `employee` with `diff: { department: { from, to }, title: { from, to },
  effectiveAt: { from: null, to } }`. Revalidate the employee page, timeline, `/employees`, `/offboarding`.
- **UI:** `transfer-dialog.tsx` opened by a **Transfer** button on the employee page header (managers only):
  Department select (`aria-label="New department"`, current one excluded), Title input (`aria-label="New
  title"`), Effective date (`aria-label="Effective date"`, default today, `max` today), Reason
  (`aria-label="Reason"`), confirm button "Record transfer". Success toast "Transferred to Operations".
- **Employee page:** under the department line, "Transferred from HR on 12 Jun 2026" while the newest
  transfer's `effectiveAt` is within the last 90 days; a **Transfers** card lists every transfer (date,
  from → to, title change, reason, by) newest first — no paging (a person moves a handful of times).
- **Timeline:** transfers join `mergeTimeline` as a fourth source: "Transferred to Operations (from HR) ·
  Team consolidation — by IT Staff", `when = effectiveAt`.
- **Edit form:** the Department select is removed; a hint "Department changes are recorded with Transfer"
  links to the dialog. `updateEmployee` ignores `departmentId` (the schema drops it); `createEmployee` keeps
  it (a new person has no history). The loadout re-evaluates automatically because `resolvePolicy` reads
  the current department.

---

## 4. Offboarding

### 4.1 Attribution
`ApprovalLike` gains `claimedBy: { name: string } | null` and `resolvedAt: Date | null`; `Decision` gains
`decidedBy: string | null` and `decidedAt: Date | null` (the approval's claimer and resolved time; both
null for a decision still PENDING). The wizard rows, the printable report and `FAREWELL_EXPORT_COLUMNS`
gain "Decided by" and "Decided on" (`fmtDate`). `listOffboarding`'s approvals select adds the two fields.

### 4.2 Facets and sorting
`OFFBOARDING_LIST_CONFIG: ListConfig = { facets: ["department", "progress"], sortable: ["name",
"started", "undecided"], defaultSort: [{ key: "name", dir: "asc" }] }` in `src/lib/offboarding-list.ts`
with `buildOffboardingWhere(state)` (`employment: OFFBOARDING`, `departmentId IN`) and
`buildOffboardingOrderBy(sort)` (`name`, `offboardingAt` for "started", each ending `{ employeeNo: "asc" }`,
`{ id: "asc" }`). `progress` is derived (`undecided > 0` → `"open"`, else `"complete"`): when set, the
query computes rows over the candidate set, keeps the matching ones, then pages the kept ids; `undecided`
sorting is applied in memory over the candidate set for the same reason (both bounded by the OFFBOARDING
count, a handful of people). Toolbar: Department facet (counts by `groupBy`), Progress facet (two fixed
options with derived counts), sortable headers. `listOffboarding(state: ListState)`.

---

## 5. Directory quality

- **Same-name guard.** `findSameName(name, departmentId, excludeId?)` → the first other employee whose
  `refKey(name)` matches in that department. `createEmployee` gains `confirmSameName: boolean`; when a match
  exists and the flag is false → `validationError({ name: "Another ${name} exists in ${dept} (${employeeNo})
  — tick 'This is a different person' to add them anyway" })`. The form runs the check on blur of the name
  and department fields (`checkSameName` action, read-only) and shows the checkbox `aria-label="This is a
  different person"` only when a match exists. Import: a CREATE row (no `employeeNo` match) whose name +
  department match an existing employee blocks with the new cause `same-name-in-department` (fix: option
  `allowSameName` — "Add same-name rows as new people", appended to `IMPORT_OPTIONS`); the planner receives
  `refs.byNameDept: Map<string, string>` keyed `refKey(name)|refKey(departmentName)`.
- **Leavers hidden by default.** `buildEmployeeWhere`: when `state.filters.employment` is empty, the where
  excludes `OFFBOARDED` unless `state.filters.leavers` includes `"1"`; `EMPLOYEES_LIST_CONFIG.facets` gains
  `"leavers"`. Toolbar toggle "Show leavers" / "Hide leavers". Facet counts for `employment` keep counting
  all three values (the facet itself must still offer OFFBOARDED).
- **Holdings export.** `GET /employees/[id]/holdings` → `.xlsx` with `HOLDINGS_EXPORT_COLUMNS`: Tag, Model,
  Type, Status, Held since (the newest `lifecycle.assign` audit or `updatedAt`), Loan due, plus a second
  block of active reservations (Tag, Model, Reserved on) — one sheet, reservations after a blank row and a
  "Reservations" header row. `requireUser`; the employee page shows **Export holdings** for everyone.

---

## 6. The six gaps

1. **`bulkChangeStatus`** returns `{ changed: number; skipped: Array<{ tag: string; reason: string }> }`
   (reasons: "wrong class", "not a valid transition from X", "held — the holder guard refused", the exact
   strings the code already knows); the bulk drawer renders the skipped list exactly as it does for assign.
2. **`checkIdentifiers({ tags, serials, cls })`** queries `where: { cls }` only; the register and single
   forms pass the class they are registering into. On save, a cross-class collision surfaces as the existing
   P2002 conflict copy ("One of those tags was just taken" / "That serial is already registered") — no
   class information leaks before submit.
3. **Loan-covered slot.** `computeLoadout`: after the greedy fill, a standard slot left empty whose type has
   a remaining TEMPORARY device becomes `{ coveredByLoan: true }` (the device stays in `onLoan`, is not
   consumed); such a slot is excluded from `missingRequired`; the tile reads "on loan" with a neutral pill
   instead of "policy gap"; the work list's "missing" counts and the policies head-count are unchanged
   because they read `missingRequired`.
4. **Replace picker.** `spareOptions` returns `note: "Same type"` / `"Other spare"` per option and the
   `EntityCombobox` shows the note; when no same-type spare exists the list still labels every row "Other
   spare" (that was the headerless case).
5. **Last change line.** The asset record header, when no approval is pending, shows "Last change:
   <sentence> · <date> · by <actor>" from the newest `AuditEntry` for the asset whose action starts with
   `lifecycle.` (or `register`), rendered with the existing audit sentence builder; nothing when none.
6. **Repair stage in SQL.** `repairStageIds` runs one `$queryRaw` over the candidate where (the stage rules
   as SQL: `status <> 'DEFECTIVE' AND "defectiveSince" IS NOT NULL` → returned-ok; `status = 'DEFECTIVE' AND
   "repairQuote" IS NOT NULL AND cost > 0 AND ROUND("repairQuote"*100) >= ROUND(cost*0.6*100)` →
   beyond-repair; `status = 'DEFECTIVE' AND ("vendorId" IS NOT NULL OR "rmaRef" IS NOT NULL)` → at-vendor;
   else to-assess). The raw query is scoped only by class and the repair candidate predicate
   (`"cls" = $1 AND (status = 'DEFECTIVE' OR "defectiveSince" IS NOT NULL)`) and returns `(id, stage)` rows;
   the caller keeps the ids whose stage is requested and, when other filters are active, intersects them
   with the Prisma-side candidate ids from `buildAssetWhere`. The Prisma where is never hand-translated to
   SQL. A unit test asserts `repairStage` on a 12-row fixture covering every rule and the centavo edge; the
   SQL CASE's agreement with it is proven end-to-end (`it-gaps.spec.ts` compares the raw cut against
   `repairStage` over every seeded asset) — vitest has no database (plan P-1).

---

## 7. Error handling
House `ActionResult` throughout; role guard then `checkRate`; zod at every boundary; every refusal names
the fix (§3–§6 copy). The holdings export caps at `EXPORT_CAP`. Transfers, decisions and audits are read
with `pageOf` where paged; the transfers card is unpaged by design.

---

## 8. Testing

**Unit:** `transfer-schema` (same department, future date, title length); `loadout` (covered-by-loan
excluded from `missingRequired`, device stays on loan, ordinary cases unchanged); `offboarding`
(`decisionOf` carries `decidedBy/decidedAt`; PENDING → null); `offboarding-list` (where, order, progress
derivation); `employees-list` (leavers default, toggle, explicit facet wins); `same-name` (`refKey` match,
exclude self, other department ignored); `import-employees` (`same-name-in-department`, the option);
`repairs` SQL parity fixture (12 rows); `bulk` skipped reasons; `checkIdentifiers` class scoping (server
test via a pure where-builder `identifierWhere(cls, tags, serials)`).

**E2E (foreground, `E2E_PORT=3100 --workers=1`):**
- `transfers.spec.ts` (5): transfer EMP-0042 Sales → HR with a reason → header line, Transfers card row,
  timeline entry, audit row, employees list shows HR; policy loadout re-evaluates (an HR policy slot appears
  after moving into a department with a policy); same-department refusal; future date refusal; the edit
  form has no department select and links to Transfer; axe on the dialog.
- `offboarding-v2.spec.ts` (5): the seeded offboarding employee's decided item shows "Decided by" and a
  date on the wizard and the report; the export sheet has the two columns; Department facet narrows;
  Progress "All decided" excludes the person with undecided items; sort by undecided desc; axe.
- `directory.spec.ts` (5): create a same-name employee → warning, checkbox, saved after confirm; import a
  sheet with a same-name row → blocked with the cause, then allowed with the option; leavers hidden by
  default and shown by the toggle; holdings export 200 + headers + a held tag in the sheet; axe.
- `it-gaps.spec.ts` (6): bulk status change with one ineligible tag lists it with the reason; the register
  form as IT does not flag a Purchasing tag live, and saving it gets the neutral conflict; a person whose
  only laptop is on loan shows "on loan" not "policy gap" and the missing count excludes it; the Replace
  picker shows "Same type"/"Other spare" notes; a direct IT return puts a "Last change" line on the record;
  the repair view's chip counts equal a DB-derived count; axe.

**Battery at the close:** `tsc`, `lint`, full vitest, all e2e in ≤ 70-test foreground chunks with the four
new files in the last chunk(s), `--list` total, 21 migrations on `inventory_dev`.

---

## 9. Files

**Create:** `prisma/migrations/<ts>_employee_transfers/`; `src/lib/{transfer-schema,offboarding-list,same-name}.ts` (+ tests); `src/server/modules/employees/transfer-actions.ts`; `src/components/employees/{transfer-dialog,transfers-card,same-name-check}.tsx`; `src/components/offboarding/offboarding-toolbar.tsx`; `src/app/(app)/employees/[id]/holdings/route.ts`; `e2e/{transfers,offboarding-v2,directory,it-gaps}.spec.ts`; an employees import fixture with a same-name row.
**Modify:** `prisma/schema.prisma`, `prisma/seed.ts`; `src/lib/{loadout,repairs,offboarding,employees-list,import-employees,import-vocabulary,export-columns}.ts` (+ tests); `src/server/modules/employees/{actions,queries}.ts`, `src/server/modules/offboarding/queries.ts`, `src/server/modules/lifecycle/actions.ts`, `src/server/modules/inventory/{actions,queries}.ts`, `src/server/modules/import/{employee-actions,resolve}.ts`; `src/components/employees/employee-form.tsx`, `src/components/inventory/{bulk-drawer,register-form,asset-form,replace-control}.tsx`, the loadout slot tile component; `src/app/(app)/employees/[id]/{page,timeline/page}.tsx`, `src/app/(app)/offboarding/{page,[employeeId]/page,[employeeId]/report/*}.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`; `e2e/fixtures/make.ts`; `docs/HANDOVER.md`, `docs/PICKUP.md`.

---

## 10. Global constraints (copied into the plan)
Dev only in a worktree with its own `.env` (`inventory_dev`, port 3100, no `SEED_PASSWORD`); never the
`inventory` database or port 3000; never seed staging; never commit `.env`. Playwright foreground,
`--workers=1`, no server left behind. `pageOf` + id tiebreakers on paged queries; derived facets computed
over candidates then paged. `"use server"` modules export only async functions; zod at boundaries; role
guard then `checkRate`; one audit entry per write. Tests first for pure modules; measured counts in commit
messages; never amend. Reviewer prompts name the forbidden git commands and require foreground verification.
