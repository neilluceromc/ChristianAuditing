# Phase 14 — Each Department Owns Its Class — Design

**Status:** designed 2026-09-07. The user asked for a plan and said *"think about it and proceed
with what is best"*, so the decisions in §1 were taken by the assistant rather than through the usual
one-question-at-a-time interview. Every one of them is reversible until the plan is executed; §1 records
the alternative each one rejected so the user can flip any of them by name.

**Goal:** finish what Phase 13 started. Phase 13 put IT and Purchasing assets in one register with two
classes and let each department *register, create, edit and request* its own class, but left five
management verbs in IT's hands for both classes: approving, assigning and returning, attaching documents,
creating categories and types, and printing labels. This phase moves each of those to the department that
owns the class, and adds the one create form the system never had — a new employee.

**Source requirement:** the user's instruction of 2026-09-07: *"plan the changes for adding of new assets
and new employees, also the purchasing assets should be separate since IT will only manage the IT and
purchasing will manage purchasing/pantry/office supplies."* Plus `docs/PICKUP.md` §4 item 3, which lists
Purchasing-owned approvals, a Purchasing assign/return surface, class-aware document permissions and a
label-sheet path for Purchasing as the Phase 13 follow-ups, in that value order.

---

## 0. What "separate" means here, and what it does not

Phase 13 decided **one register, two classes** and rejected two registers with nothing shared. This
phase keeps that. "Separate" means **every management verb on an asset is performed by the department
that owns the asset's class**. It does not mean the departments cannot see each other's assets.

Reads stay shared, on purpose:

- Offboarding a leaver who holds a laptop and a car needs both rows on one screen.
- Finance confirms both classes from one queue.
- The audit trail and the Home leaver card cross classes.
- `/inventory` already offers a class switch; a Purchasing user who wants only cars clicks it.

The naming rule from Phase 13 §0 still holds: in this codebase `admin` is the sysadmin role, and the
business's "Admin department" is the **Purchasing** workspace and the `purchasing_staff` role.

---

## 1. Decisions taken, with the alternatives rejected

| # | Question | Decision | Rejected |
|---|---|---|---|
| 1 | Does "separate" mean hiding each class from the other department? | **No. Management is class-owned; reading stays shared.** §0 | A `VISIBLE_CLASSES` map hiding IT rows from Purchasing and vice versa. It breaks offboarding, Finance and audit, all of which are shared by Phase 13's decision, and it would need an exception list longer than the rule. |
| 2 | Who approves a lifecycle change on a Purchasing asset? | **`admin` or `purchasing_staff`.** Who approves on an IT asset: `admin` or `it_staff`. One rule: the approver is whoever can manage the asset's class. §3 | Keep approvers `admin`/`it_staff` (Phase 13's default, recorded there as the first follow-up). A separate `approver` flag on `User` (a second permission system for one distinction). |
| 3 | Where does Purchasing assign and return a car? | **From the asset record.** A new header control on `/inventory/[id]`, offered to whoever can manage the asset's class, for both classes. §4 | Open `/employees`' loadout picker to Purchasing (the loadout is IT's policy-slot view; a car has no slot). A Purchasing-only holder page (a second surface for one action). |
| 4 | May Purchasing see the employee directory? | **Yes, read-only**, so "held by A. Reyes" on a car is a link that opens. Editing, importing and creating employees stay `admin`/`it_staff`. §4.3, §8 | Keep `/employees` IT-only and render the holder as plain text for Purchasing. |
| 5 | May Purchasing create categories and types? | **Yes, of its own class only.** `it_staff` likewise becomes IT-only; `admin` keeps both. §6 | Keep category creation `admin`/`it_staff` and have Purchasing ask IT for an "Office Supplies" row. The user's words were that Purchasing manages office supplies; asking IT for the category contradicts that. |
| 6 | How does a new employee get created? | **A form at `/employees/new`**, `admin`/`it_staff`, with `employeeNo` typed by hand and checked unique case-insensitively, exactly as the importer does. §8 | An auto-generated `EMP-` number (the importer records that `employeeNo` has no format and refuses to invent one; a generator would invent one). Letting Purchasing create employees (they are IT/HR data). |
| 7 | Does Purchasing get bulk CSV import in this phase? | **No. Phase 15.** The import planner is 2,000-row IT vocabulary; opening it to a second class is its own design. Purchasing adds assets one at a time on `/inventory/new` or by batch on `/inventory/register`, both of which already exist. §12 | Fold import into this phase. |
| 8 | Are consumable office supplies (pens, paper) assets? | **No.** Only durable, tagged items are. PICKUP §4 item 4 already records that consumables are a second domain that must not be modelled as an `Asset`. §12 | Quantity fields on `Asset`. |
| 9 | Any schema or migration change? | **None.** Every rule in this phase is application-layer over Phase 13's model; the two triggers remain the guarantee. | — |

---

## 2. The rule: one map decides every management verb

`MANAGEABLE_CLASSES` in `src/lib/asset-class.ts` already answers *"may this role register, create, edit
or request a status change on this class?"* This phase makes it answer every management verb:

| Verb | Today | After this phase |
|---|---|---|
| register / create / edit / request status | `canManageClass` | unchanged |
| claim / release / approve / reject / escalate / retry an approval | `admin`, `it_staff` literal | `canManageClass(role, approval.asset.cls)`; no asset → `admin` only |
| request assign / request return | `admin`, `it_staff` literal | `canManageClass(role, asset.cls)` |
| upload document / mark signed | `admin`, `it_staff` literal | `canManageClass(role, asset.cls)` |
| create / rename / delete category | `admin`, `it_staff` literal | `canManageClass(role, category.cls)` |
| create / rename / delete type | `admin`, `it_staff` literal | `canManageClass(role, type.category.cls)` |
| print labels | `admin`, `it_staff` literal | `canManageClass(role, asset.cls)` per asset |

The Finance exception stands and must be repeated in every review: `finance_staff` maps to `[]` and
Finance's confirm / send-back actions **must not** consult this map (asset-class.ts:92-97 already warns).

What stays a literal role list, on purpose, because it is not a verb on an asset of a class:

- Departments CRUD, employee edit/import/create, `/inventory/import`, secrets, reservations,
  day-one `requestAssignReserved`, offboarding outcomes, `/admin/users|webhooks|flags`.

---

## 3. Approvals by class

### 3.1 Who may act

Every approval action routes through the single `transition()` helper in
`src/server/modules/approvals/actions.ts`, guarded today at line 42 by `actionRole("admin","it_staff")`.
That guard becomes: load the approval **with its asset**, then require `canActOnApproval(role, cls)`.

A new pure module `src/lib/approval-access.ts`:

```ts
export function isApprover(role: Role): boolean
// manages at least one class → admin, it_staff, purchasing_staff

export function canActOnApproval(role: Role, assetCls: AssetClass | null): boolean
// null cls (no asset on the approval) → any approver
// otherwise → canManageClass(role, assetCls)

export function approvalClassWhere(role: Role): Prisma.ApprovalWhereInput
// manages every class (admin) or no class (finance_staff, viewer) → {} — unfiltered
// otherwise → { OR: [{ assetId: null }, { asset: { cls: { in: MANAGEABLE_CLASSES[role] } } }] }
```

Finance and the viewer already read `/approvals` today (`approvals-audit.spec.ts` asserts Finance's read-only
queue), so a role that manages no class reads everything and acts on nothing, exactly as before.

The pure state machine `approvalTransition` in `approval-flow.ts` is unchanged; `isAdmin` still means
the `admin` role. `it_staff` and `purchasing_staff` are peers: each is an ordinary approver inside its
own class.

### 3.2 Queue scope

`listApprovals` and `tabCounts` in `queries.ts` take the role and AND `approvalClassWhere(role)` into
every tab's where-clause; the sidebar badge (`getApprovalsBadge`) takes the same scope. `it_staff` sees
IT approvals; `purchasing_staff` sees Purchasing approvals; `admin`, Finance and the viewer see all. The
detail page computes `canAct` from `canActOnApproval`, so a Purchasing user who follows a link to an IT
approval sees it read-only with the existing "you cannot act on this" state.

### 3.3 Approvals with no asset

`Approval.assetId` is nullable and `systemChecks` already treats a missing asset as a failing check.
Such a row has no class, so no class filter can exclude it: it is visible to and actionable (rejectable)
by every approver. The seed carries two (`APR-2040`, `APR-2035`) and `approvals-audit.spec.ts` counts
them in IT's queue; this rule keeps those counts unchanged. No new UI.

### 3.4 Surfaces

- `PATH_RULES`: `/approvals` gains the `purchasing` workspace and the `purchasing_staff` role.
- `WORKSPACE_NAV.purchasing`: an **Approvals** item, placed after "Purchasing assets".
- Purchasing Home: one more `Stat`, **Approvals waiting**, counting `PENDING`+`CLAIMED` approvals under
  `approvalClassWhere("purchasing_staff")`, linking to `/approvals`.
- IT Home is unchanged: "Your shift" and "Claimed by you" query by `claimedById`, and after this phase
  an `it_staff` user can only have claimed IT approvals.

### 3.5 What does not change

SLA, `refNo`, priority, the worker, `approval.executed` webhook, `escalate`/`retry` semantics,
one-open-approval-per-asset.

---

## 4. Assign and return from the asset record

### 4.1 The control

`/inventory/[id]`'s header (`[id]/layout.tsx`) gains one component, `<HolderControl>`, beside
`RequestStatusChange`, rendered when `canManageClass(user.role, asset.cls)` and the asset is not frozen
by a pending approval (the existing `pendingRef` banner logic):

- **Unheld and `status === ASSIGNABLE_FROM[cls]`** → button **Assign holder** → dialog with the same
  `EntityCombobox` of ACTIVE employees the create form uses, a reason field, **Request assign**.
- **Held** → button **Return** → dialog with a reason, **Request return**.
- Otherwise no control, because neither action is legal (the same rule the loadout view follows).

Both call the existing `requestAssign` / `requestReturn` in `src/server/modules/employees/actions.ts`.
No new action, no new approval type. The result is the same `lifecycle.assign` / `lifecycle.return`
approval the loadout view creates, now claimable by the class's own department (§3).

### 4.2 Guards

`requestAssign` and `requestReturn` replace `actionRole("admin","it_staff")` with: load the asset,
`canManageClass(role, asset.cls)`, else `forbidden()`. `requestAssignReserved` keeps its IT-only guard;
reservations are IT.

### 4.3 Purchasing reads the directory

`PATH_RULES`: `/employees` and `/employees/[id]` (and its `history`, `form` read pages) gain the
`purchasing` workspace, role `purchasing_staff`. `/employees/[id]/edit`, `/employees/import`,
`/employees/new` stay IT. `WORKSPACE_NAV.purchasing` gains an **Employees** item. On the loadout page
`canMutate` is already `admin || it_staff`, so Purchasing sees the loadout read-only with the spare picker
hidden; the spare picker stays pinned to IT because it fills IT policy slots.

### 4.4 What stays IT

The loadout's spare picker, day-one reserved assignment, offboarding (shared, per Phase 13 §8), the
Home leaver card.

---

## 5. Documents

`uploadDocument` and `markDocumentSigned` in `document-actions.ts` load the asset and require
`canManageClass(role, asset.cls)`. `documents/page.tsx` passes `canMutate` from the same call. Kinds,
size cap, extensions, paths and audit entries are unchanged. There is still no delete.

---

## 6. Reference data by class

### 6.1 Who creates what

`reference-actions.ts`:

- `createRefRow` **category**: `cls` is required from the client but overridden server-side to the
  single manageable class when the role has exactly one (`it_staff` → IT, `purchasing_staff` → PURCHASING);
  `admin` may pick. A role with no manageable class is `forbidden()`.
- `createRefRow` **type**: load the category; `canManageClass(role, category.cls)`.
- `renameRefRow` / `deleteRefRow` category: `canManageClass(role, row.cls)`. Type: via `row.category.cls`.
- **department**: unchanged, `admin`/`it_staff`.

The `category_class_frozen` trigger continues to refuse a class flip once assets exist; no action changes
`cls` after create.

### 6.2 What each role sees

`/admin/asset-categories` and `/admin/asset-types` list rows whose class is in
`MANAGEABLE_CLASSES[role]`; `admin` sees all with the Class column. `it_staff` therefore stops seeing
Vehicle and Furniture. `ref-table.tsx`'s Class picker on create is shown to `admin` only; for the two
staff roles the class is fixed and shown as text.

### 6.3 The types page picker

`asset-types/page.tsx` loads categories `where: { locked: false, cls: { in: MANAGEABLE_CLASSES[role] } }`,
so a type can only be filed under a category of the creator's class. Today the picker mixes both classes.

### 6.4 Nav and paths

`PATH_RULES`: `/admin/asset-categories` and `/admin/asset-types` gain workspace `purchasing`, role
`purchasing_staff`. `/admin/departments` unchanged. `WORKSPACE_NAV.purchasing` gains a **Reference data**
section with **Categories** and **Types**.

---

## 7. Labels

- `/inventory/labels`: `requireRole("admin","it_staff","purchasing_staff")`; `PATH_RULES` gains the
  `purchasing` workspace.
- The page filters the requested ids to `cls in MANAGEABLE_CLASSES[role]`; rows dropped this way count
  toward the existing `missing` banner. `admin` prints anything.
- `bulk-drawer.tsx`: the "Print labels for N selected" affordance drops its `cls === "IT"` condition
  and shows whenever the selection is explicit; the drawer's `cls` is already the user's manageable
  class on that view.
- `APP_BASE_URL`, `labelPages`, the 100 mm bar: unchanged.

---

## 8. The new-employee form

- **Route** `/employees/new`, `requireRole("admin","it_staff")`, `PATH_RULES` under the `it` workspace.
  Entry: a **New employee** button on `/employees` beside Import, shown when `canMutate`.
- **Form:** `employee-form.tsx` gains `mode: "new" | "edit"`. In `new` mode it shows **Employee number**
  (required, trimmed, 1–60 characters, no format rule — the importer's E-2 decision) and **Joined**
  (date, default today) above the existing Name, Title, Department, Employment and M365 fields.
  Employment defaults to `ACTIVE`.
- **Action** `createEmployee` in `employees/actions.ts`: schema = `employeeSchema` minus `id` plus
  `employeeNo` and `joinedAt`; department must exist; `employeeNo` unique **case-insensitively**
  (`findFirst` with `mode: "insensitive"`, matching `import-employees.ts`'s `refKey` rule) → field error
  "That employee number is already in use"; P2002 backstop; audit `employee.created`; redirect to
  `/employees/[id]`.
- The empty-state copy on `/employees` ("there is no create form by design") is replaced with "Add one
  with New employee, or import a sheet."
- `updateEmployee` still never accepts `employeeNo`; identity is not editable.

---

## 9. Navigation and path rules, in one table

| Path | Workspaces today | Workspaces after | Roles after |
|---|---|---|---|
| `/approvals`, `/approvals/[id]` | it, finance | it, finance, **purchasing** | admin, it_staff, finance_staff (read), **purchasing_staff** |
| `/employees` reads — list, `[id]`, `history`, `form`, `activity`, `export` | it | it, **purchasing** | today's roles plus **purchasing_staff**; nav item added for purchasing |
| `/employees/[id]/edit` | it (general rule) | it, own rule | admin, it_staff — a write surface stopped at layer 1, like `/employees/import` |
| `/employees/new` | — | it | admin, it_staff |
| `/employees/[id]/edit`, `/employees/import` | it | unchanged | unchanged |
| `/admin/asset-categories`, `/admin/asset-types` | it | it, **purchasing** | admin, it_staff, **purchasing_staff** |
| `/admin/departments` | it | unchanged | unchanged |
| `/inventory/labels` | it | it, **purchasing** | admin, it_staff, **purchasing_staff** |

`workspaces.test.ts` asserts every row of this table per role. Nothing is removed from any role.

---

## 10. Seed

No new rows. Purchasing creating an "Office Supplies" category through the new form *is* the e2e test
for §6, and staging is never re-seeded (`PICKUP.md` §3). One housekeeping fix rides along: the comment
in `prisma/seed.ts:12` says twelve accounts; the seed creates five. Correct the comment and the message
at line 20.

---

## 11. Testing

### 11.1 Unit (pure, `src/lib`, vitest)

- `approval-access.test.ts`: `isApprover` per role; `canActOnApproval` table-driven over all five roles ×
  {IT, PURCHASING, null}; `approvalClassWhere` returns `{}` for admin, finance and viewer and the
  `OR [assetId null, cls in …]` fragment for the two staff roles. Mutation check: a literal `["IT"]` in
  place of the map fails the purchasing row.
- `workspaces.test.ts`: every row of §9 per role, including the negatives that stay negative
  (purchasing on `/employees/import`, `/employees/new`, `/admin/departments`, `/inventory/import`).
- `asset-class.test.ts`: unchanged; the map is not touched.

### 11.2 End-to-end, `e2e/department-owned.spec.ts`

Same conventions as `asset-classes.spec.ts`: the local `login(page, email)` helper, references by tag /
employeeNo / category name, never a raw id.

| # | Case |
|---|---|
| 1 | Purchasing requests a status change on `BR-VH-0002`; the approval appears in Purchasing's `/approvals`, **not** in IT's; Purchasing claims and approves it through the real actions; the worker executes it. **Closes PICKUP §5's D-19 gap.** |
| 2 | IT signed in cannot claim that Purchasing approval (detail page read-only; direct action call → forbidden). |
| 3 | Admin's queue shows both classes. |
| 4 | Purchasing opens `BR-VH-0002` (STORED), **Assign holder** → picks an employee → approval created; approves it; the car is OPERATIONAL and held. Then **Return** → approval → executes to STORED. |
| 5 | On a laptop record signed in as Purchasing, no Assign/Return control; the URL of the employee holder opens read-only. |
| 6 | Purchasing uploads a PDF to a car's Documents and marks it signed; on a laptop the panel is read-only and a direct upload is refused. |
| 7 | Purchasing creates category **Office Supplies**; it is PURCHASING with no class picker offered; creates type **Shredder** under it; the types picker never offered an IT category. On IT's categories page Office Supplies is absent; on admin's it is present with class Purchasing. |
| 8 | Purchasing selects two cars on `/inventory?cls=PURCHASING` → **Print labels** → a sheet renders with two labels; a hand-crafted `?ids=` containing a laptop id drops it and shows the skipped-count banner. |
| 9 | IT creates an employee at `/employees/new`; the record opens; the list shows them; a second create with the same number in different case is refused with the field error. |
| 10 | Purchasing cannot open `/employees/new` or `/employees/[id]/edit` (redirected). |
| 11 | Purchasing Home shows **Approvals waiting** with the right count. |

`e2e/axe-sweep.spec.ts` gains `/employees/new` and `/approvals` as `purchasing@`.

---

## 12. Out of scope, on the record

- **Purchasing bulk import** — Phase 15. The wrong-class refusal in `import-assets.ts` stays.
- **Consumables** (pens, paper, pantry stock with quantities) — a second domain, own brainstorm, never an
  `Asset` (PICKUP §4 item 4).
- **Hiding one class from the other department** — rejected, §1 row 1.
- **Purchasing-owned offboarding or reservations** — offboarding stays shared per Phase 13 §8;
  reservations are IT policy.
- **An `employeeNo` generator or format** — the importer's E-2 rule stands.
- **Vendor master data, depreciation, locations** — Phase 13 §12, unchanged.
- **Notifying a department that an approval is waiting** — there is no notification model; the Home
  stat is the signal.

---

## 13. Files

New: `src/lib/approval-access.ts` + test · `src/components/inventory/holder-control.tsx` ·
`src/app/(app)/employees/new/page.tsx` · `e2e/department-owned.spec.ts`.

Changed: `src/lib/workspaces.ts` (+test) · `src/server/modules/approvals/{actions,queries}.ts` ·
`src/app/(app)/approvals/{page,[id]/page}.tsx` · `src/components/shell/sidebar.tsx` · `src/app/(app)/layout.tsx` ·
`src/server/modules/employees/{actions,queries}.ts` · `e2e/labels.spec.ts` (one copy assertion) ·
`src/app/(app)/inventory/[id]/layout.tsx` · `src/server/modules/inventory/document-actions.ts` ·
`src/app/(app)/inventory/[id]/documents/page.tsx` · `src/server/modules/admin/reference-actions.ts` ·
`src/components/admin/ref-table.tsx` · `src/app/(app)/admin/{asset-categories,asset-types}/page.tsx` ·
`src/app/(app)/inventory/labels/page.tsx` · `src/components/inventory/bulk-drawer.tsx` ·
`src/components/employees/employee-form.tsx` · `src/app/(app)/employees/page.tsx` ·
`src/app/(app)/page.tsx` (+ the purchasing home query) · `prisma/seed.ts` (comment) ·
`e2e/axe-sweep.spec.ts` · `docs/PICKUP.md` §3–§5 · `docs/HANDOVER.md` §8.

No migration.
