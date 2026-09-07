# Phase 14 — Department-Owned Classes — Design

**Status:** implemented on branch `phase-14-department-owned-classes`, 2026-09-07; amendments, if any, are
`D-` entries at the top of the plan. The first draft was written under *"think about it and proceed with
what is best"*; the user then set the register workflow and answered two design questions. §1 marks
which decisions are the user's and which the assistant took to fill the gaps.

**Goal:** IT sees and manages IT assets only. Purchasing sees every asset, registers assets of both
classes, and manages the Purchasing class end to end. An IT asset that Purchasing registers is handed to
IT, who checks it before Finance sees it. Finance confirms everything, and its record is what the
depreciation module (Phase 15) will read. The system also gains its first manual create form for
employees.

**Source requirement:** the user's words of 2026-09-07:

> *"plan the changes for adding of new assets and new employees, also the purchasing assets should be
> separate since IT will only manage the IT and purchasing will manage purchasing/pantry/office supplies."*

> *"IT can only see their assets, so we should have them separate, and when registering assets:
> Purchasing — can register IT assets then it will be transferred to IT. IT — can also register IT Assets.
> So when purchasing registers an asset, IT can also edit it if there is a correction. Purchasing can see
> everything that was registered and purchased, while IT can just see the IT assets. So the workflow will
> be: Purchasing (Registers Assets) → IT (Registers Assets / Check the Purchasing Asset if its correct) →
> Finance check everything and will have a record for the depreciation."*

Two design questions were then answered: **full depreciation module** (scoped to Phase 15, §15) and **IT
verifies, then Finance sees it** (§5).

---

## 0. Naming — read this first

In this codebase `admin` is the sysadmin role and `/admin/*` the sysadmin routes. The business's "Admin
department" is the **Purchasing** department: the `purchasing` workspace and the `purchasing_staff` role
(Phase 13 §0). Nothing in this phase changes that.

---

## 1. Decisions, with who made them and what was rejected

| # | Question | Decision | By | Rejected |
|---|---|---|---|---|
| 1 | Who sees which assets? | **IT sees IT only. Purchasing, Finance and admin see everything.** `VISIBLE_CLASSES`, §2–3. | user | Shared reads for all (first draft). |
| 2 | Who registers which class? | **Purchasing registers both classes. IT registers IT.** `REGISTRABLE_CLASSES`, §4. | user | Each class registered by its own department (Phase 13). |
| 3 | Who owns a Purchasing-registered IT asset? | **IT, from the moment it is registered.** Purchasing may still edit it until IT has checked it. §5.4. | user (ownership) / assistant (edit-until-checked) | Purchasing keeps editing IT assets it registered forever; Purchasing loses edit at once (typos would need IT). |
| 4 | Is IT's check formal? | **Yes. An IT asset waits for IT's check; Finance's register shows it and Finance can confirm it only after.** The asset is live throughout. §5. | user | No gate, IT just edits; verification blocks assignment and status changes. |
| 5 | What does Finance record for depreciation? | **A full depreciation module — Phase 15, its own spec.** Phase 14 guarantees the inputs it will read. §15. | user | Cost and dates only; straight-line fields. |
| 6 | Does the viewer role see both classes? | **No, IT only.** The viewer is the IT workspace's read-only seat. | assistant | Viewer sees everything (it is not Purchasing or Finance). |
| 7 | Do person-centric pages hide the other class? | **No.** An employee's holdings, the offboarding wizard and an approval's detail show every asset the person holds, because they are about the person. A tag the viewer cannot open renders as text, not a link. §3.3 | assistant | Hiding a leaver's car from IT's offboarding wizard (nobody would return it). |
| 8 | Who approves a lifecycle change? | **Whoever manages the asset's class.** A class-less approval (no asset) is any approver's to reject. §6 | assistant | Approvers stay `admin`/`it_staff` (Phase 13 default). |
| 9 | Where does Purchasing assign and return a car? | **From the asset record**, a new header control. §7 | assistant | Opening IT's loadout picker to Purchasing. |
| 10 | May Purchasing create categories and types? | **Of its own class only.** IT likewise. Admin both. §9 | assistant | Asking IT for an "Office Supplies" row. |
| 11 | How is a new employee created? | **A form at `/employees/new`**, `admin`/`it_staff`, `employeeNo` typed and unique case-insensitively. §11 | assistant | An `EMP-` number generator. |
| 12 | Purchasing bulk CSV import? | **Phase 15.** §15 | assistant | Fold into this phase. |
| 13 | Consumable office supplies? | **Not assets. Out.** PICKUP §4 item 4. | assistant | Quantity fields on `Asset`. |
| 14 | Schema change? | **One additive migration** for the IT check (`itVerifiedAt`, `itVerifiedById`). §13 | — | — |

---

## 2. Three maps, one module

`src/lib/asset-class.ts` gains two maps beside `MANAGEABLE_CLASSES` and every guard in the codebase asks
one of the three. Nothing else may hard-code which role sees, registers or manages a class.

| Role | `VISIBLE_CLASSES` — sees | `REGISTRABLE_CLASSES` — registers / creates | `MANAGEABLE_CLASSES` — edits, requests, approves, assigns, documents, categorises, labels |
|---|---|---|---|
| `admin` | IT, PURCHASING | IT, PURCHASING | IT, PURCHASING |
| `it_staff` | IT | IT | IT |
| `purchasing_staff` | IT, PURCHASING | IT, PURCHASING | PURCHASING |
| `finance_staff` | IT, PURCHASING | — | — (Finance confirms both, through its own guard) |
| `viewer` | IT | — | — |

Invariant, pinned by a test: for every role, `MANAGEABLE ⊆ REGISTRABLE ⊆ VISIBLE`.

Pure helpers: `canSeeClass`, `canRegisterClass`, `canManageClass` (exists), `visibleClassWhere(role)` (a
Prisma where-fragment, `{}` for an all-class role), `isAwaitingItCheck(asset)` and `canEditAsset(role,
asset)` (§5.4). The Finance exception stands: `finance_staff` is `[]` in `MANAGEABLE_CLASSES` on purpose
and Finance's confirm / send-back never consult it.

---

## 3. Visibility

### 3.1 The register surfaces

For a role that does not see every class, these surfaces are scoped to `VISIBLE_CLASSES[role]`:

- **`/inventory`.** A `?cls=` the role cannot see redirects to bare `/inventory`. The default class is the
  role's first visible class. The class switch renders only when the role sees more than one class; IT and
  the viewer see no switch at all.
- **The asset record** and every tab under `/inventory/[id]`. A new `getVisibleAsset(id, role)` wraps
  `getAsset` and returns null for an invisible class, so the existing `notFound()` fires. The edit page
  does the same before its own redirect logic.
- **`/inventory/export`**, both the filter branch and the `?ids=` branch, AND `visibleClassWhere(role)`.
- **The command palette** asset search.
- **The scan page** `/inventory/scan/[tag]`: a tag of an invisible class renders a banner naming the tag
  as outside the viewer's register, with no details. Not the "unknown tag" copy — the sticker is real.
- **`/inventory/activity`** and **`/audit`**: audit rows whose entity is an asset of an invisible class are
  excluded (`NOT (entityType = asset AND entityId IN invisible ids)`). The invisible set for IT is the
  Purchasing fleet, which is small; for an all-class role the exclusion is empty and costs nothing.
- **`/inventory/labels`** filters `?ids=` to `MANAGEABLE_CLASSES` (you print what you manage), which is
  narrower than visibility for every role.

`exactTagMatch` (the USB-scanner contract on the list's search box) stays unscoped: it resolves a tag to an
id and redirects to the record, and the record then answers with not-found for an invisible class. The
list's non-exact search is scoped by the class filter as today.

### 3.2 What Finance and Purchasing see

Everything, including IT's records, exactly as today. `/finance/assets` keeps its IT and Purchasing tabs.

### 3.3 Person-centric pages

An employee's page, the offboarding wizard and an approval's detail list every asset the person holds,
whatever its class, because the question they answer is about the person. A tag the viewer cannot open
renders as plain text with a title "Outside your register" instead of a link. One small component,
`<TagRef>`, does this everywhere.

### 3.4 What does not change

`/finance/*`, `/purchases/*`, `/employees/*` reads, `/offboarding`, `/reservations` (IT assets only by
construction). Home's IT queries are already pinned to IT; its approval rows take the class scope of §6.

---

## 4. Registration

- `/inventory/register` and `/inventory/new` offer the categories and types of `REGISTRABLE_CLASSES[role]`.
  Purchasing therefore sees Laptop beside Vehicle; IT sees IT categories only.
- `registerAssets` and `createAsset` gate on `canRegisterClass(role, category.cls)`. The class is still
  derived from the category, never chosen per item (Phase 13 §2.3).
- **Stamping.** When the registrant manages the class being registered (`admin` or `it_staff` registering
  IT), the asset is created already checked: `itVerifiedAt = now`, `itVerifiedById = registrant`. When
  Purchasing registers an IT asset both stay null: the asset is awaiting IT's check. Purchasing-class assets
  never carry a value (§5.1). The IT import wizard (admin/IT only) stamps every row it creates.
- `/inventory`'s **New asset** button follows `canRegisterClass`; bulk actions and Edit follow the
  management rules.

---

## 5. The IT check

### 5.1 Definition

An asset is **awaiting IT's check** when `cls = IT` and `itVerifiedAt IS NULL`. Purchasing-class assets
never carry a value and are never awaiting; the predicate includes the class on purpose so a stray null
on a car means nothing.

### 5.2 The action

`verifyAssetDetails({ id })`, `admin`/`it_staff`. Refuses a Purchasing asset by name, refuses an already
checked asset, writes `itVerifiedAt`/`itVerifiedById` under a state-guarded `updateMany` (the null check in
the where, like Finance's confirm), audits `it.verify`. Idempotent by refusal, not by silence.

### 5.3 Where Finance's gate bites

- `/finance/assets`, IT tab: rows require `itVerifiedAt IS NOT NULL`. The Purchasing tab is unchanged.
- `confirmAssetDetails` refuses an awaiting IT asset: *"BR-LT-0300 is waiting for IT's check — Finance
  confirms after IT."* The record's Confirm button is absent while awaiting.
- The record's pill reads, in order of precedence: **FINANCE CONFIRMED · date** → **RETURNED BY FINANCE**
  → **AWAITING IT CHECK** → **AWAITING FINANCE**.
- Finance's Home "Capitalized" aggregate stays the whole fleet at cost, unchanged; it is a fleet value, not a
  review queue, and `home-finance.spec.ts` pins it.

### 5.4 Who may edit while it waits

`canEditAsset(role, asset) = canManageClass(role, asset.cls) OR (isAwaitingItCheck(asset) AND
canRegisterClass(role, asset.cls))`. So Purchasing can fix its own registration until IT checks it; after
the check, IT only. IT can edit at any time. Status changes, assign and return follow `canManageClass`
alone: an awaiting laptop is IT's to deploy, not Purchasing's.

### 5.5 Surfaces

- **Record header:** a **Mark checked** button for `admin`/`it_staff` while awaiting, with a one-line dialog.
- **IT Home, "Your shift":** a new row kind `CHECK` — each awaiting IT asset, oldest first, action *Check*,
  linking to the record.
- **Purchasing Home:** a stat **Awaiting IT check** (count of awaiting IT assets), beside **Approvals
  waiting** (§6.4).
- Finance's send-back on an IT asset goes to IT, whose **Mark corrected** clears it (Phase 12, class =
  IT). Send-back does not clear the IT check.

---

## 6. Approvals by class

### 6.1 Who may act

Every approval action goes through the single `transition()` helper in
`src/server/modules/approvals/actions.ts`. Its `actionRole("admin","it_staff")` becomes: load the approval
with its asset, require `canActOnApproval(role, cls)` from a new pure module `src/lib/approval-access.ts`:

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

Finance and the viewer already read `/approvals` (`approvals-audit.spec.ts` asserts Finance's read-only
queue), so a role that manages no class reads everything and acts on nothing, as before. The pure state
machine `approvalTransition` is unchanged; `isAdmin` still means the `admin` role.

### 6.2 Queue, badge, Home

`listApprovals`, `tabCounts`, the sidebar badge, Home's "Your shift" approval rows and "Claimed by you"
all AND `approvalClassWhere(role)`. IT sees IT approvals; Purchasing sees Purchasing approvals; admin,
Finance and the viewer see all. The detail page computes `canAct` from `canActOnApproval`.

### 6.3 Approvals with no asset

The seed carries two (`APR-2040`, `APR-2035`) and `approvals-audit.spec.ts` counts them in IT's queue. A
class-less row is visible to and rejectable by every approver; `systemChecks` already reports it as
unexecutable. Counts in that spec do not change.

### 6.4 Surfaces

`PATH_RULES`: `/approvals` admits the `purchasing` workspace. `WORKSPACE_NAV.purchasing` gains
**Approvals** with the badge marker. Purchasing Home gains **Approvals waiting**.

### 6.5 Offboarding a leaver who holds a car

IT runs the wizard and decides "Returned" for the car; that creates a `lifecycle.return` approval on a
Purchasing asset, which **Purchasing** claims and approves. IT initiates, the class owner approves. The
wizard shows the car's tag as text (§3.3).

---

## 7. Assign and return from the asset record

### 7.1 The control

`/inventory/[id]`'s header gains `<HolderControl>`, rendered when `canManageClass(role, asset.cls)` and no
approval is open on the asset:

- **Unheld and `status === ASSIGNABLE_FROM[cls]`** → **Assign holder** → dialog with the same employee
  combobox the create form uses, a reason, **Request assign**.
- **Held** → **Return** → dialog with a reason, **Request return**.
- Otherwise nothing; neither action is legal.

Both call the existing `requestAssign` / `requestReturn`. No new action, no new approval type.

### 7.2 Guards

`requestAssign` and `requestReturn` replace their role literal with: load the asset,
`canManageClass(role, asset.cls)`, else `forbidden()`. `requestAssignReserved` stays IT: reservations are.

### 7.3 Purchasing reads the directory

`/employees` and its read pages admit the `purchasing` workspace so "held by …" on a car opens. Edit,
import and create stay `admin`/`it_staff`. The loadout's spare picker stays pinned to IT (it fills IT policy
slots) and is read-only for Purchasing.

---

## 8. Documents

`uploadDocument` and `markDocumentSigned` load the asset and require `canManageClass(role, asset.cls)`.
The Documents tab's `canMutate` uses the same call. Kinds, size cap, extensions, audit: unchanged.

---

## 9. Reference data by class

- `createRefRow` **category**: the class is decided server-side from the role — a single-class role gets
  its class whatever the client sent; admin may pick; a no-class role is refused.
- `createRefRow` **type**: the category's class must be manageable by the role.
- `renameRefRow` / `deleteRefRow`: category by its class, type by its category's class, department
  `admin`/`it_staff` as today.
- `/admin/asset-categories` and `/admin/asset-types` list only manageable classes; admin sees all with the
  Class column. The types page's category picker offers manageable classes only (today it mixes both).
- `PATH_RULES` and `WORKSPACE_NAV.purchasing` gain both pages under a **Records** heading. Departments
  stay IT.

Purchasing registers IT assets into **existing** IT categories; it does not create IT categories.

---

## 10. Labels

`/inventory/labels` admits `purchasing_staff`; the page prints the ids whose class the role manages and
counts the rest in the existing skipped banner (copy becomes cause-neutral: *could not be printed*). The
bulk drawer's **Print labels** link appears for any explicit selection.

---

## 11. The new-employee form

- `/employees/new`, `requireRole("admin","it_staff")`, an IT write surface at layer 1 like `/employees/import`.
  Entry: **New employee** on `/employees` for those roles.
- `employee-form.tsx` gains `mode: "new" | "edit"`. New mode adds **Employee number** (required, trimmed,
  1–60 characters, no format rule — the importer's E-2 decision) and **Joined** (date, default today).
- `createEmployee`: department must exist; `employeeNo` unique case-insensitively (matching the importer's
  `refKey`) with field error *"That employee number is already in use"*; P2002 backstop; audit `create`;
  redirect to the record. `updateEmployee` still never accepts `employeeNo`.
- The empty-state copy "there is no create form by design" is replaced.

---

## 12. Navigation and path rules

| Path | Workspaces today | After | Roles after |
|---|---|---|---|
| `/approvals`, `/approvals/[id]` | it, finance | it, finance, **purchasing** | + `purchasing_staff` |
| `/employees` reads — list, `[id]`, `history`, `form`, `activity`, `export` | it | it, **purchasing** | + `purchasing_staff` |
| `/employees/new` | — | it | admin, it_staff |
| `/employees/[id]/edit` | it (general rule) | it, own rule | admin, it_staff |
| `/admin/asset-categories`, `/admin/asset-types` | it | it, **purchasing** | admin, it_staff, **purchasing_staff** |
| `/admin/departments` | it | unchanged | unchanged |
| `/inventory/labels` | it | it, **purchasing** | admin, it_staff, **purchasing_staff** |

`WORKSPACE_NAV.purchasing`: **Assets** gains *Approvals* (badge) and *Employees*; a new **Records** section
holds *Asset categories* and *Asset types*; **Reference → IT inventory** stays (Purchasing sees everything).
IT's nav is unchanged. `/inventory`'s class switch renders only for roles that see more than one class.

---

## 13. Migration and seed

**Migration `20260907090000_asset_it_verified`** (hand-written, additive, HANDOVER §7 rule): two columns,
one FK to `User` (`ON DELETE RESTRICT`, like Finance's), one index, and a backfill
`UPDATE "Asset" SET "itVerifiedAt" = "createdAt" WHERE "cls" = 'IT'` — every IT asset that exists today
was registered by IT, because Phase 13 allowed nothing else. Migration count 14 → 15.

**Seed:** a reseed TRUNCATEs, so `prisma/seed.ts` sets `itVerifiedAt` on every IT-class fixture itself.
No new fixture rows: `home-finance.spec.ts` pins the fleet at 25 IT assets and ₱48,442,000 across 32. The
e2e for the register flow creates its own laptop. One housekeeping fix rides along: the seed's comment
says twelve accounts; it creates five.

---

## 14. Testing

### 14.1 Unit (pure, `src/lib`, vitest)

- `asset-class.test.ts`: the three maps per role; the `MANAGEABLE ⊆ REGISTRABLE ⊆ VISIBLE` invariant;
  `visibleClassWhere` is `{}` for all-class roles and `{ cls: { in: ["IT"] } }` for IT and viewer;
  `isAwaitingItCheck` on the four (cls × verified) combinations; `canEditAsset` table-driven over roles ×
  {IT verified, IT awaiting, PURCHASING}.
- `approval-access.test.ts`: `isApprover`, `canActOnApproval` over roles × {IT, PURCHASING, null},
  `approvalClassWhere` shapes, and a mutation check against a literal `["IT"]`.
- `workspaces.test.ts`: every row of §12 per role, plus the negatives that stay negative.
- `audit-list.test.ts`: `buildAuditWhere` adds the `NOT` clause only when given hidden ids.

### 14.2 Phase 13 cases this phase flips (`e2e/asset-classes.spec.ts`)

| Case | Today | After |
|---|---|---|
| 2 | Purchasing is *not* offered Laptop on `/inventory/register` | Purchasing **is** offered Laptop and Vehicle; IT still only Laptop |
| 10 | `it@` on `/inventory?cls=PURCHASING` sees `BR-VH-0001` and a class switch | `it@` is redirected to `/inventory`, sees no `BR-VH` tag and no class switch; the Purchasing half of the case runs as `purchasing@` |
| 17 | `it@` on a car's edit URL lands on the car's record | `it@` gets the not-found page (case 5's assertion) |
| 18 | Purchasing is *not* offered Laptop on `/inventory/new` | Purchasing is offered both |

Unchanged by construction: `receiving.spec.ts` (IT registers → stamped → Finance confirms),
`approvals-audit.spec.ts` (§6.3), `home-finance.spec.ts` (§5.3, §13).

### 14.3 End-to-end, `e2e/department-owned.spec.ts`

| # | Case |
|---|---|
| 1 | Purchasing requests a status change on a car; the approval appears in Purchasing's queue, not IT's; Purchasing claims and approves through the real buttons; the worker executes. Closes the D-19 gap. |
| 2 | IT cannot act on a Purchasing approval, even by URL. |
| 3 | Admin's queue shows both classes. |
| 4 | Purchasing assigns a stored car from the record, approves, the car is held; then requests its return. |
| 5 | On a verified laptop, Purchasing has no Edit and no holder control; the holder link opens the employee read-only. |
| 6 | Purchasing files a car's papers and signs them; a laptop's panel is read-only for Purchasing. |
| 7 | Purchasing creates **Office Supplies** (class forced) and **Shredder** under it; IT's categories page lacks the row; admin's shows it with the class. |
| 8 | Purchasing prints two cars; a smuggled laptop id is skipped and counted. |
| 9 | IT creates an employee; a case-variant duplicate number is refused. |
| 10 | Purchasing cannot open `/employees/new` or an edit form. |
| 11 | Purchasing Home shows **Approvals waiting** and **Awaiting IT check** with the right counts. |
| 12 | **Visibility.** `it@`: `/inventory?cls=PURCHASING` → `/inventory`; a car's record is not found; the scan page for a car says it is outside IT's register. `purchasing@` sees the car on both. |
| 13 | **The register flow.** `purchasing@` registers a Laptop (prefix LT) → class IT, awaiting; the record shows **AWAITING IT CHECK** and Purchasing has **Edit**; Purchasing corrects the model. `finance@`'s IT tab does not list it and the record shows no **Confirm details**. `it@`'s Home lists it under **CHECK**; IT opens it, **Mark checked**; pill becomes **AWAITING FINANCE**; Purchasing's Edit is gone. `finance@` now lists it and confirms; pill **FINANCE CONFIRMED**. |

`e2e/axe-sweep.spec.ts`: `/employees/new` for IT; `/approvals`, `/employees`, `/admin/asset-categories`,
`/admin/asset-types`, `/inventory?cls=PURCHASING` for Purchasing (the last moved from the viewer list,
which is redirected now).

---

## 15. Out of scope, on the record

- **Depreciation module — Phase 15, own brainstorm and spec.** Phase 14 guarantees its inputs on every
  Finance-confirmed asset: `cost`, `purchasedAt`, `financeConfirmedAt`/`By`, `itVerifiedAt`/`By` for IT
  assets, `cls`, `category`. It does not add useful life, salvage, method or postings.
- **Purchasing bulk import** — Phase 15. The wrong-class refusal in `import-assets.ts` stays.
- **Consumables** — a second domain, never an `Asset`.
- **Purchasing-owned offboarding or reservations** — offboarding stays IT-run and shared (§6.5).
- **An `employeeNo` generator or format.**
- **Vendor master data, locations.**
- **Notifying a department that a check or approval waits** — no notification model; the Home rows and
  stats are the signal.

---

## 16. Files

New: `prisma/migrations/20260907090000_asset_it_verified/migration.sql` · `src/lib/approval-access.ts` +
test · `src/components/inventory/holder-control.tsx` · `src/components/inventory/it-check.tsx` ·
`src/components/inventory/tag-ref.tsx` · `src/app/(app)/employees/new/page.tsx` ·
`e2e/department-owned.spec.ts`.

Changed: `prisma/schema.prisma` · `prisma/seed.ts` · `src/lib/asset-class.ts` (+test) ·
`src/lib/workspaces.ts` (+test) · `src/lib/audit-list.ts` (+test) · `src/lib/home.ts` · `src/lib/activity.ts` (+test) ·
`src/server/modules/inventory/{queries,actions,document-actions}.ts` ·
`src/server/modules/purchases/receiving.ts` · `src/server/modules/import/asset-actions.ts` ·
`src/server/modules/approvals/{actions,queries}.ts` · `src/server/modules/employees/{actions,queries}.ts` ·
`src/server/modules/admin/reference-actions.ts` · `src/server/modules/finance/queries.ts` ·
`src/server/modules/home/queries.ts` · `src/server/modules/audit/queries.ts` · `src/server/palette.ts` ·
`src/app/(app)/inventory/{page,export/route,activity/page,scan/[tag]/page,labels/page,register/page,new/page}.tsx` ·
`src/app/(app)/inventory/[id]/{layout,page,edit/page,documents/page,history/page,timeline/page,reservations/page,secrets/page}.tsx` ·
`src/app/(app)/approvals/{page,[id]/page}.tsx` · `src/app/(app)/audit/page.tsx` ·
`src/app/(app)/employees/{page,[id]/page,[id]/edit/page}.tsx` · `src/app/(app)/offboarding/[employeeId]/page.tsx` ·
`src/app/(app)/admin/{asset-categories,asset-types}/page.tsx` · `src/app/(app)/page.tsx` · `src/app/(app)/layout.tsx` ·
`src/components/shell/sidebar.tsx` · `src/components/home/your-shift.tsx` ·
`src/components/inventory/{inventory-toolbar,bulk-drawer}.tsx` · `src/components/admin/ref-table.tsx` ·
`src/components/employees/{employee-form,loadout-view}.tsx` ·
`e2e/{asset-classes,axe-sweep,labels}.spec.ts` · `docs/PICKUP.md` · `docs/HANDOVER.md`.
