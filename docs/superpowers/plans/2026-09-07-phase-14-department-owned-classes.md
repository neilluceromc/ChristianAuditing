# Phase 14 — Each Department Owns Its Class Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the five management verbs Phase 13 left with IT — approving, assigning/returning, attaching documents, creating categories/types, printing labels — to the department that manages the asset's class, and add a `/employees/new` form.

**Architecture:** No schema change. `MANAGEABLE_CLASSES` in `src/lib/asset-class.ts` already says which role manages which class; this phase makes every remaining role-literal guard consult it, through one new pure module `src/lib/approval-access.ts` for the approvals queue and `canManageClass` everywhere else. Path rules and nav open the Purchasing workspace to `/approvals`, `/employees` (read), `/admin/asset-categories|asset-types` and `/inventory/labels`. A new `<HolderControl>` on the asset record is the Purchasing assign/return surface; it calls the existing `requestAssign`/`requestReturn`.

**Tech Stack:** Next.js 15 App Router · Prisma 6 / PostgreSQL 16 · vitest (node env, pure `src/lib`) · Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-department-owned-classes-design.md` — read §0 (what "separate" does not mean), §1 (the nine decisions and what each rejected) and §2 (the one rule) before touching anything. "Admin" in stakeholder notes means the **Purchasing** department; the codebase's `admin` is the sysadmin role.

**Baselines on `main` at `5b2192c`:** 908 unit / 51 files · 187 e2e / 14 files · `tsc` and `lint` clean · 14 migrations, none pending. Verify with `npm test`, `npm run typecheck`, `npm run lint` before Task 1 and record the numbers here if they differ.

## Global Constraints

- **No migration.** If a task appears to need one, stop and report; the spec (§1 row 9) says none.
- **`finance_staff` maps to `[]` in `MANAGEABLE_CLASSES` on purpose.** Finance confirm / send-back must never consult `canManageClass`. Do not touch `finance-review` code.
- **Reads stay shared.** Nothing in this plan removes a path, page or row from any role. `workspaces.test.ts` must keep every existing `true` case `true`.
- **Never `a ${CLASS_LABEL[cls]}`** in copy — use `CLASS_PHRASE[cls]` ("an IT", "a Purchasing").
- **Absent, not disabled:** an affordance the server would refuse is not rendered (house rule, every component in this plan follows it).
- **e2e references rows by tag / employeeNo / category name, never a raw cuid.** Every spec file reseeds in `beforeAll` (`execSync("npm run db:seed")`).
- **Commit after every task**, message prefixed `feat(phase-14):`, `test(phase-14):` or `docs(phase-14):`. Work on branch `phase-14-department-owned-classes`, created from `main`. Never push; merging and pushing are the user's decisions.
- **Windows dev machines:** never `npm install` a new package (PICKUP §2). This plan adds none.
- Copy in this codebase is sentence case, terse, and names the mechanism ("Creates a `lifecycle.assign` approval…").

---

## File map

| File | Responsibility after this phase |
|---|---|
| `src/lib/approval-access.ts` (new) + `.test.ts` | Pure: who may act on an approval of a given class; the Prisma where-fragment that scopes a role's queue |
| `src/lib/workspaces.ts` + `.test.ts` | Path rules and nav for the four new Purchasing surfaces; `/employees/new` and `/employees/[id]/edit` as IT write surfaces |
| `src/server/modules/approvals/{actions,queries}.ts`, `src/app/(app)/approvals/{page,[id]/page}.tsx`, `src/components/shell/sidebar.tsx`, `src/app/(app)/layout.tsx` | Class-scoped queue, badge and actions |
| `src/server/modules/employees/actions.ts` | `requestAssign`/`requestReturn` class-guarded; new `createEmployee` |
| `src/server/modules/employees/queries.ts` | `activeEmployeeOptions()` for the holder picker |
| `src/components/inventory/holder-control.tsx` (new), `src/app/(app)/inventory/[id]/layout.tsx` | Assign / Return from the asset record |
| `src/server/modules/inventory/document-actions.ts`, `src/app/(app)/inventory/[id]/documents/page.tsx` | Documents class-owned |
| `src/server/modules/admin/reference-actions.ts`, `src/components/admin/ref-table.tsx`, `src/app/(app)/admin/{asset-categories,asset-types}/page.tsx` | Categories and types by class |
| `src/app/(app)/inventory/labels/page.tsx`, `src/components/inventory/bulk-drawer.tsx` | Labels for the classes a role manages |
| `src/components/employees/employee-form.tsx`, `src/app/(app)/employees/new/page.tsx` (new), `src/app/(app)/employees/page.tsx`, `src/app/(app)/employees/[id]/edit/page.tsx` | New-employee form |
| `src/server/modules/home/queries.ts`, `src/app/(app)/page.tsx` | Purchasing Home "Approvals waiting" |
| `e2e/department-owned.spec.ts` (new), `e2e/axe-sweep.spec.ts` | End-to-end proof |
| `prisma/seed.ts`, `docs/PICKUP.md`, `docs/HANDOVER.md` | Housekeeping and the record |

---

### Task 0: Branch and baseline

**Files:** none changed.

- [ ] **Step 1: Branch**

```bash
git checkout -b phase-14-department-owned-classes main
```

- [ ] **Step 2: Record the baseline**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean, clean, `Test Files 51 passed · Tests 908 passed`. If the numbers differ, edit the **Baselines** line above and commit that edit as `docs(plan): Phase 14 baseline is N unit / M files`.

---

### Task 1: `approval-access.ts` — the pure rule

**Files:**
- Create: `src/lib/approval-access.ts`
- Test: `src/lib/approval-access.test.ts`

**Interfaces:**
- Consumes: `MANAGEABLE_CLASSES`, `ASSET_CLASSES`, `canManageClass` from `src/lib/asset-class.ts`.
- Produces: `isApprover(role): boolean` · `canActOnApproval(role, assetCls: AssetClass | null): boolean` · `approvalClassWhere(role): Prisma.ApprovalWhereInput`. Tasks 3, 4 and 10 import these exact names.

Rules (spec §3.1–3.3 as amended): a role is an **approver** when it manages at least one class. An approval **with an asset** is actionable by whoever manages that asset's class. An approval **with no asset** has no class, so it is visible to and actionable by every approver (the seed carries two such rows, `APR-2040` and `APR-2035`, and `approvals-audit.spec.ts` counts them in IT's queue). A role that manages **no** class (finance, viewer) reads everything and acts on nothing, exactly as today. A role that manages **every** class (admin) is unfiltered.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/approval-access.test.ts
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { approvalClassWhere, canActOnApproval, isApprover } from "./approval-access";

const ROLES: Role[] = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"];

describe("isApprover", () => {
  it.each([
    ["admin", true], ["it_staff", true], ["purchasing_staff", true], ["finance_staff", false], ["viewer", false],
  ] as Array<[Role, boolean]>)("%s → %s", (role, expected) => {
    expect(isApprover(role)).toBe(expected);
  });
});

describe("canActOnApproval — the approver is whoever manages the asset's class", () => {
  const cases: Array<[Role, "IT" | "PURCHASING" | null, boolean]> = [
    ["admin", "IT", true], ["admin", "PURCHASING", true], ["admin", null, true],
    ["it_staff", "IT", true], ["it_staff", "PURCHASING", false], ["it_staff", null, true],
    ["purchasing_staff", "IT", false], ["purchasing_staff", "PURCHASING", true], ["purchasing_staff", null, true],
    ["finance_staff", "IT", false], ["finance_staff", "PURCHASING", false], ["finance_staff", null, false],
    ["viewer", "IT", false], ["viewer", "PURCHASING", false], ["viewer", null, false],
  ];
  it.each(cases)("%s on a %s asset → %s", (role, cls, expected) => {
    expect(canActOnApproval(role, cls)).toBe(expected);
  });
  it("covers every role × class pair exactly once", () => {
    expect(cases.length).toBe(ROLES.length * 3);
  });
});

describe("approvalClassWhere — a role's queue", () => {
  it("is unfiltered for admin, finance and viewer (all-or-nothing managers read everything)", () => {
    expect(approvalClassWhere("admin")).toEqual({});
    expect(approvalClassWhere("finance_staff")).toEqual({});
    expect(approvalClassWhere("viewer")).toEqual({});
  });
  it("scopes a single-class role to its class OR to approvals with no asset", () => {
    expect(approvalClassWhere("it_staff")).toEqual({
      OR: [{ assetId: null }, { asset: { cls: { in: ["IT"] } } }],
    });
    expect(approvalClassWhere("purchasing_staff")).toEqual({
      OR: [{ assetId: null }, { asset: { cls: { in: ["PURCHASING"] } } }],
    });
  });
  // Mutation check: this fails if someone hard-codes ["IT"] instead of reading the map.
  it("derives the class list from MANAGEABLE_CLASSES, not a literal", () => {
    const where = approvalClassWhere("purchasing_staff") as { OR: Array<{ asset?: { cls: { in: string[] } } }> };
    expect(where.OR[1].asset?.cls.in).toEqual(["PURCHASING"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/approval-access.test.ts`
Expected: FAIL — `Cannot find module './approval-access'`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/approval-access.ts
import type { AssetClass, Prisma, Role } from "@prisma/client";
import { ASSET_CLASSES, MANAGEABLE_CLASSES, canManageClass } from "./asset-class";

/**
 * Phase 14. Who may act on an approval, and which approvals a role's queue
 * shows. Both derive from MANAGEABLE_CLASSES — the approver of a lifecycle
 * change is whoever manages the asset's class (spec §3.1). `admin` and
 * `it_staff`/`purchasing_staff` are the approvers; finance and viewer read.
 */

/** A role that manages at least one class may act on SOME approval. */
export function isApprover(role: Role): boolean {
  return MANAGEABLE_CLASSES[role].length > 0;
}

/**
 * An approval with no asset has no class (the seed carries two such rows, and
 * `systemChecks` already reports them as unexecutable). Any approver may reject
 * one; none may execute it. Spec §3.3.
 */
export function canActOnApproval(role: Role, assetCls: AssetClass | null): boolean {
  if (assetCls === null) return isApprover(role);
  return canManageClass(role, assetCls);
}

/**
 * The where-fragment that scopes a queue, badge or count to what a role may
 * see. A role that manages every class or no class is unfiltered: admin acts
 * on all, finance and viewer read all (spec §0 — reads stay shared). A
 * single-class role sees its class plus the class-less rows.
 */
export function approvalClassWhere(role: Role): Prisma.ApprovalWhereInput {
  const mine = MANAGEABLE_CLASSES[role];
  if (mine.length === 0 || mine.length === ASSET_CLASSES.length) return {};
  return { OR: [{ assetId: null }, { asset: { cls: { in: [...mine] } } }] };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/approval-access.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/approval-access.ts src/lib/approval-access.test.ts
git commit -m "feat(phase-14): approval-access -- the approver is whoever manages the asset's class"
```

---

### Task 2: Path rules and nav

**Files:**
- Modify: `src/lib/workspaces.ts:80-107` (purchasing nav), `:157-225` (PATH_RULES)
- Test: `src/lib/workspaces.test.ts:44-156`

**Interfaces:**
- Produces: the purchasing workspace can reach `/approvals`, `/employees/*` (reads), `/admin/asset-categories`, `/admin/asset-types`, `/inventory/labels`. `/employees/new` and `/employees/[id]/edit` are IT write surfaces at layer 1. Departments admin unchanged.

- [ ] **Step 1: Add the failing cases to `workspaces.test.ts`**

Insert into the `cases` array, directly after the `/employees/import` block (line 148):

```ts
    // Phase 14: Purchasing owns its class. /approvals opens to the purchasing
    // workspace; the queue is class-scoped server-side (approval-access.ts).
    ["/approvals", "purchasing_staff", true],
    ["/approvals/xyz", "purchasing_staff", true],
    // /employees reads open to purchasing so "held by …" on a car is a link
    // that opens. Every WRITE surface under it stays IT and is asserted for
    // every role, the same first-match-wins reason as /employees/import.
    ["/employees", "purchasing_staff", true],
    ["/employees/abc", "purchasing_staff", true],
    ["/employees/abc/form", "purchasing_staff", true],
    ["/employees/export", "purchasing_staff", true],
    ["/employees/new", "admin", true],
    ["/employees/new", "it_staff", true],
    ["/employees/new", "viewer", false],
    ["/employees/new", "purchasing_staff", false],
    ["/employees/new", "finance_staff", false],
    ["/employees/abc/edit", "admin", true],
    ["/employees/abc/edit", "it_staff", true],
    ["/employees/abc/edit", "viewer", false],
    ["/employees/abc/edit", "purchasing_staff", false],
    ["/employees/abc/edit", "finance_staff", false],
    // audit / offboarding / reservations stay IT even though they used to
    // share one rule with /employees.
    ["/offboarding", "purchasing_staff", false],
    ["/reservations", "purchasing_staff", false],
    // Reference data: each department creates categories and types of its own
    // class (the action forces the class); departments stay IT.
    ["/admin/asset-categories", "purchasing_staff", true],
    ["/admin/asset-types", "purchasing_staff", true],
    ["/admin/asset-categories", "finance_staff", false],
    ["/admin/departments", "purchasing_staff", false],
    ["/admin/departments", "it_staff", true],
    // Labels: a Purchasing sheet is a Purchasing artifact now.
    ["/inventory/labels", "purchasing_staff", true],
```

Then **change** two existing cases that this phase flips: line 48 `["/employees", "purchasing_staff", false]` → `true`; line 56 `["/employees/export", "purchasing_staff", false]` → `true`; line 68 `["/approvals", "purchasing_staff", false]` → `true`; line 138 `["/inventory/labels", "purchasing_staff", false]` → `true`. (The duplicates you just added then agree with them; leave both — the explicit block documents the phase.)

Add to the `WORKSPACE_NAV shape` describe:

```ts
  it("the Purchasing Approvals item carries the badge marker too (Phase 14)", () => {
    const assets = WORKSPACE_NAV.purchasing.find((s) => s.heading === "Assets");
    expect(assets?.items.find((i) => i.label === "Approvals")?.badge).toBe("approvals");
    expect(assets?.items.map((i) => i.href)).toContain("/employees");
  });
  it("the Purchasing Records section offers categories and types, never departments", () => {
    const records = WORKSPACE_NAV.purchasing.find((s) => s.heading === "Records");
    expect(records?.items.map((i) => i.href)).toEqual(["/admin/asset-categories", "/admin/asset-types"]);
  });
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run src/lib/workspaces.test.ts`
Expected: FAIL on the purchasing `/approvals`, `/employees*`, `/admin/asset-*`, `/inventory/labels` cases and the two nav tests.

- [ ] **Step 3: Edit `PATH_RULES`**

Replace the rule at lines 159-163 with two rules:

```ts
  // Phase 14: each department creates categories and types of its OWN class
  // (reference-actions.ts forces the class from MANAGEABLE_CLASSES), so both
  // workspaces are admitted. Departments are org structure, not class data,
  // and stay IT.
  {
    test: /^\/admin\/(asset-categories|asset-types)(\/|$)/,
    workspaces: ["it", "purchasing"],
    roles: ["admin", "it_staff", "purchasing_staff"],
  },
  { test: /^\/admin\/departments(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
```

Replace the `/inventory/labels` rule at line 190 with:

```ts
  // Phase 14: a label sheet is each class's own artifact; the page filters
  // ?ids= to the classes the role manages. Still MUST precede the general
  // /inventory rule below, which admits finance and viewer.
  { test: /^\/inventory\/labels(\/|$)/, workspaces: ["it", "purchasing"], roles: ["admin", "it_staff", "purchasing_staff"] },
```

Replace lines 206-218 (the `/employees/import` rule, the shared employees/audit/offboarding/reservations rule, and the `/approvals` rule) with:

```ts
  // Task 12, E-7: the W-1 trap exactly. The general /employees rule below
  // has NO `roles` key at all, so `viewer` — whose workspaces are `["it"]`,
  // same as it_staff — passes it. Import writes up to 2,000 employees plus
  // an audit row each, the identical write-surface hazard `/inventory/
  // import` already guards above; this MUST precede the general rule
  // (first-match-wins), for the same reason.
  { test: /^\/employees\/import(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  // Phase 14: the two remaining employee WRITE surfaces get the same
  // treatment, because the general /employees rule right after them now
  // admits purchasing (reads only). Both MUST precede it.
  { test: /^\/employees\/new(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  { test: /^\/employees\/[^/]+\/edit(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  // Phase 14: purchasing READS the directory so "held by …" on a car opens.
  // Covers /employees/export too (prefix + "(\/|$)"): an export route
  // intentionally has no separate rule — it matches its list page's access
  // exactly because it IS that page's data, downloaded instead of rendered.
  { test: /^\/employees(\/|$)/, workspaces: ["it", "purchasing"] },
  // Covers /audit/export and /offboarding/*/report/export by the same rule.
  { test: /^\/(audit|offboarding|reservations)(\/|$)/, workspaces: ["it"] },
  // Phase 14: purchasing approves lifecycle changes on its own class; the
  // queue is scoped server-side (approval-access.ts), never here.
  { test: /^\/approvals(\/|$)/, workspaces: ["it", "finance", "purchasing"] },
```

- [ ] **Step 4: Edit the purchasing nav**

Replace lines 99-106 (the "Assets" section and the "Reference" section) with:

```ts
    {
      heading: "Assets",
      items: [
        { label: "Purchasing assets", href: "/inventory?cls=PURCHASING" },
        { label: "Register assets", href: "/inventory/register", roles: ["admin", "purchasing_staff"] },
        { label: "Approvals", href: "/approvals", badge: "approvals" },
        { label: "Employees", href: "/employees" },
      ],
    },
    {
      heading: "Records",
      items: [
        { label: "Asset categories", href: "/admin/asset-categories" },
        { label: "Asset types", href: "/admin/asset-types" },
      ],
    },
    { heading: "Reference", items: [{ label: "IT inventory", href: "/inventory" }] },
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/workspaces.test.ts`
Expected: PASS. Then `npm test` — everything else still green (`ownedParamsFor` derives from the nav, so no other test moves).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspaces.ts src/lib/workspaces.test.ts
git commit -m "feat(phase-14): purchasing workspace reaches approvals, employees (read), categories, types, labels"
```

---

### Task 3: Approvals by class

**Files:**
- Modify: `src/server/modules/approvals/queries.ts:22-55`
- Modify: `src/server/modules/approvals/actions.ts:31-58`
- Modify: `src/app/(app)/approvals/page.tsx:17-20`
- Modify: `src/app/(app)/approvals/[id]/page.tsx:22`
- Modify: `src/components/shell/sidebar.tsx:14-22`, `src/app/(app)/layout.tsx:18`

**Interfaces:**
- Consumes: `approvalClassWhere`, `canActOnApproval`, `isApprover` (Task 1).
- Produces: `listApprovals(tab, userId, role)`, `tabCounts(userId, role)`, `getApprovalsBadge(role)`. Task 10 reuses `approvalClassWhere` directly.

- [ ] **Step 1: Scope the queries**

In `queries.ts`:

```ts
import type { Role } from "@prisma/client";
import { approvalClassWhere } from "@/lib/approval-access";
// ...
export async function listApprovals(tab: QueueTab, userId: string, role: Role): Promise<ApprovalRow[]> {
  const approvals = await prisma.approval.findMany({
    where: { AND: [tabWhere(tab, userId), approvalClassWhere(role)] },
    // ... rest unchanged
```

```ts
export async function tabCounts(userId: string, role: Role): Promise<Record<QueueTab, number>> {
  const counts = await Promise.all(
    QUEUE_TABS.map((t) => prisma.approval.count({ where: { AND: [tabWhere(t.id, userId), approvalClassWhere(role)] } })),
  );
  return Object.fromEntries(QUEUE_TABS.map((t, i) => [t.id, counts[i]])) as Record<QueueTab, number>;
}
```

- [ ] **Step 2: Guard the transition by class**

In `actions.ts`, change the imports and the head of `transition()`:

```ts
import { actionUser } from "@/server/auth/guards";
import { canActOnApproval, isApprover } from "@/lib/approval-access";
// ...
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
```

and inside the transaction, load the asset's class and check it before the pure transition:

```ts
    const approval = await tx.approval.findUnique({
      where: { id },
      select: { id: true, refNo: true, state: true, priority: true, claimedById: true, asset: { select: { cls: true } } },
    });
    if (!approval) return conflict("That approval no longer exists.");
    // Phase 14: the approver is whoever manages the asset's class. A
    // class-less approval (no asset) is any approver's to reject.
    if (!canActOnApproval(user.role, approval.asset?.cls ?? null)) return forbidden();
    const ctx = { isOwner: approval.claimedById === user.id, isAdmin: user.role === "admin" };
```

`build(approval, user.id)` receives the same five scalar fields it did; the extra `asset` key is ignored by every builder. Remove the now-unused `actionRole` import.

- [ ] **Step 3: Pages**

`approvals/page.tsx`:

```ts
import { isApprover } from "@/lib/approval-access";
// ...
  const canAct = isApprover(user.role);
  const tab = parseTab(toSearchParams(await searchParams).get("tab"));
  const [rows, counts] = await Promise.all([listApprovals(tab, user.id, user.role), tabCounts(user.id, user.role)]);
```

`approvals/[id]/page.tsx`:

```ts
import { canActOnApproval } from "@/lib/approval-access";
// ...
  const canAct = canActOnApproval(user.role, approval.asset?.cls ?? null);
```

- [ ] **Step 4: Badge**

`sidebar.tsx`:

```ts
import type { Role, User } from "@prisma/client";
import { approvalClassWhere } from "@/lib/approval-access";

export async function getApprovalsBadge(role: Role): Promise<ApprovalsBadge> {
  const scope = approvalClassWhere(role);
  const [open, overdue] = await Promise.all([
    prisma.approval.count({ where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] } }, scope] } }),
    prisma.approval.count({
      where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: new Date() } }, scope] },
    }),
  ]);
  return { open, overdue };
}
```

`layout.tsx:18`: `const badge = await getApprovalsBadge(user.role);`

- [ ] **Step 5: Typecheck and reason about the existing e2e**

Run: `npm run typecheck && npm run lint`
Expected: clean.

`e2e/approvals-audit.spec.ts` asserts `it@` sees Open 3 · Unclaimed 2 · badge 3. The seed's open rows are `APR-2041` (IT asset), `APR-2040` (no asset) and `APR-2039` (IT asset). Under `approvalClassWhere("it_staff")` all three still match (two by class, one by `assetId: null`). No expectation changes. Write that sentence into the commit body.

- [ ] **Step 6: Run the approvals e2e**

Run: `npx playwright test e2e/approvals-audit.spec.ts`
Expected: PASS, unchanged counts.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/approvals src/app/\(app\)/approvals src/components/shell/sidebar.tsx src/app/\(app\)/layout.tsx
git commit -m "feat(phase-14): approvals queue, badge and actions scoped to the classes a role manages

Seeded IT counts are unchanged: APR-2041 and APR-2039 match by class, APR-2040 by having no asset."
```

---

### Task 4: `requestAssign` / `requestReturn` class-guarded

**Files:**
- Modify: `src/server/modules/employees/actions.ts:24-31, 96-103`

**Interfaces:**
- Produces: the two actions accept any approver and refuse by class after loading the asset. Signatures unchanged; Task 5's component calls them as-is.

- [ ] **Step 1: Edit the guards**

Imports:

```ts
import { actionRole, actionUser } from "@/server/auth/guards";
import { ASSIGNABLE_FROM, DEFAULT_ASSIGN_STATUS, DEFAULT_STATUS, canManageClass } from "@/lib/asset-class";
import { isApprover } from "@/lib/approval-access";
```

`requestAssign` head (replacing lines 25-26):

```ts
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
```

and after `if (!asset) return conflict("That asset no longer exists.");` (line 45):

```ts
      // Phase 14: each department assigns its own class. Checked here, after
      // the load, because the class lives on the asset.
      if (!canManageClass(user.role, asset.cls)) return forbidden();
```

`requestReturn` head (replacing lines 97-98): the same two lines as above; and after `if (!asset) return conflict("That asset no longer exists.");` (line 109) the same `canManageClass` check.

Both actions: add `revalidatePath(`/inventory/${d.assetId}`);` beside the existing two revalidates, so the asset record's banner refreshes when Task 5's control fires from there.

`requestAssignReserved` and `updateEmployee` keep `actionRole("admin", "it_staff")`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/employees/actions.ts
git commit -m "feat(phase-14): assign and return refuse by the asset's class, not by role literal"
```

---

### Task 5: `<HolderControl>` on the asset record

**Files:**
- Create: `src/components/inventory/holder-control.tsx`
- Modify: `src/server/modules/employees/queries.ts` (append `activeEmployeeOptions`)
- Modify: `src/app/(app)/inventory/[id]/layout.tsx:1-78`

**Interfaces:**
- Consumes: `requestAssign`, `requestReturn` (Task 4); `EntityCombobox`, `ComboOption` from `@/components/patterns/entity-combobox`.
- Produces: `HolderControl` props `{ assetId: string; tag: string; mode: "assign"; employees: ComboOption[] } | { assetId: string; tag: string; mode: "return"; holder: { id: string; name: string } }`. `activeEmployeeOptions(): Promise<ComboOption[]>`.

- [ ] **Step 1: The query**

Append to `src/server/modules/employees/queries.ts`:

```ts
import type { ComboOption } from "@/components/patterns/entity-combobox";

/** The holder picker's options — the same shape /inventory/new builds inline. */
export async function activeEmployeeOptions(): Promise<ComboOption[]> {
  const rows = await prisma.employee.findMany({
    where: { employment: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, employeeNo: true },
  });
  return rows.map((e) => ({ value: e.id, label: e.name, sub: e.employeeNo }));
}
```

(If `queries.ts` does not already import `prisma`, add `import { prisma } from "@/server/db/client";`.)

- [ ] **Step 2: The component**

```tsx
// src/components/inventory/holder-control.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { requestAssign, requestReturn } from "@/server/modules/employees/actions";

type Props =
  | { assetId: string; tag: string; mode: "assign"; employees: ComboOption[] }
  | { assetId: string; tag: string; mode: "return"; holder: { id: string; name: string } };

/**
 * Phase 14: the assign / return surface that lives on the asset itself, so a
 * department without the IT loadout view (Purchasing) can still hand a car
 * to a driver and take it back. Same two actions the loadout calls; the
 * result is the same lifecycle.assign / lifecycle.return approval.
 */
export function HolderControl(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function close() {
    setOpen(false);
    setReason("");
    setEmployeeId(null);
    setError(null);
    setFieldErrors({});
  }

  function submit() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res =
        props.mode === "assign"
          ? await requestAssign({ employeeId: employeeId ?? "", assetId: props.assetId, reason })
          : await requestReturn({ employeeId: props.holder.id, assetId: props.assetId, reason });
      if (res.ok) {
        toast(`${res.data.refNo} created — waiting in the approval queue`, "settled");
        close();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors(fe);
        const unclaimed = fe.assetId ?? fe._form;
        if (unclaimed) setError(unclaimed);
      } else setError(res.message);
    });
  }

  const isAssign = props.mode === "assign";

  return (
    <>
      <Button onClick={() => setOpen(true)}>{isAssign ? "Assign holder" : "Return"}</Button>
      <Dialog
        open={open}
        onClose={close}
        title={isAssign ? "Assign a holder" : "Request a return"}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit} disabled={isAssign && !employeeId}>
              {isAssign ? "Request assign" : "Request return"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            {isAssign ? (
              <>Creates a <span className="font-mono">lifecycle.assign</span> approval; {props.tag} stays where it is until it executes.</>
            ) : (
              <>Creates a <span className="font-mono">lifecycle.return</span> approval; {props.tag} stays with {props.holder.name} until it executes.</>
            )}
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          {isAssign && (
            <FormField label="Assign to" required error={fieldErrors.employeeId}>
              {(p) => (
                <EntityCombobox
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  invalid={p.invalid}
                  options={props.employees}
                  value={employeeId}
                  onChange={setEmployeeId}
                  placeholder="Type a name or EMP number…"
                />
              )}
            </FormField>
          )}
          <FormField label="Reason" required={!isAssign} error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
```

Note `requestReturn`'s reason is `min(3)` on the server and `requestAssign`'s is optional — the `required` flag mirrors that.

- [ ] **Step 3: Wire the layout**

In `src/app/(app)/inventory/[id]/layout.tsx`:

```ts
import { ASSIGNABLE_FROM, CLASS_LABEL, canManageClass } from "@/lib/asset-class";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";
import { HolderControl } from "@/components/inventory/holder-control";
// ...
  const pending = asset.approvals[0];
  // Phase 14: the holder control is offered only when the action it fires
  // would be legal — unheld and idle → assign; held → return. A pending
  // approval freezes both (the server would answer "already has an open
  // request"). Absent, not disabled.
  const canAssign = canMutate && !pending && !asset.assignee && asset.status === ASSIGNABLE_FROM[asset.cls];
  const canReturn = canMutate && !pending && asset.assignee !== null;
  const employees = canAssign ? await activeEmployeeOptions() : [];
```

and inside the `canMutate && (...)` fragment, before `<RequestStatusChange …>`:

```tsx
                  {canAssign && <HolderControl mode="assign" assetId={asset.id} tag={asset.tag} employees={employees} />}
                  {canReturn && asset.assignee && (
                    <HolderControl mode="return" assetId={asset.id} tag={asset.tag} holder={{ id: asset.assignee.id, name: asset.assignee.name }} />
                  )}
```

- [ ] **Step 4: Typecheck, lint, look at it**

Run: `npm run typecheck && npm run lint`
Expected: clean. Then `npm run dev`, sign in as `purchasing@thebackroomop.com`, open `BR-VH-0002` (STORED, unheld): **Assign holder** shows. Open `BR-VH-0001` (OPERATIONAL, held): **Return** shows. Open `BR-LT-0148` as `purchasing@`: neither, and no Edit.

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/holder-control.tsx src/server/modules/employees/queries.ts "src/app/(app)/inventory/[id]/layout.tsx"
git commit -m "feat(phase-14): Assign holder / Return on the asset record for whoever manages its class"
```

---

### Task 6: Documents class-owned

**Files:**
- Modify: `src/server/modules/inventory/document-actions.ts:30-33, 49-50, 81-88`
- Modify: `src/app/(app)/inventory/[id]/documents/page.tsx:33`

- [ ] **Step 1: Actions**

Imports: replace `actionRole` with `actionUser`; add `import { canManageClass } from "@/lib/asset-class";` and `import { isApprover } from "@/lib/approval-access";`.

`uploadDocument`:

```ts
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  // ... (rate limit, field checks unchanged)
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return conflict("That asset no longer exists.");
  // Phase 14: each department files its own class's papers.
  if (!canManageClass(user.role, asset.cls)) return forbidden();
```

`markDocumentSigned`:

```ts
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const doc = await prisma.assetDocument.findUnique({
    where: { id: String(input.docId ?? "") },
    include: { asset: { select: { cls: true } } },
  });
  if (!doc) return conflict("That document no longer exists.");
  if (!canManageClass(user.role, doc.asset.cls)) return forbidden();
  if (doc.signed) return ok(null);
```

- [ ] **Step 2: Page**

`documents/page.tsx`: `import { canManageClass } from "@/lib/asset-class";` and `canMutate={canManageClass(user.role, asset.cls)}`.

- [ ] **Step 3: Typecheck, commit**

Run: `npm run typecheck && npm run lint` → clean.

```bash
git add src/server/modules/inventory/document-actions.ts "src/app/(app)/inventory/[id]/documents/page.tsx"
git commit -m "feat(phase-14): documents upload and sign follow the asset's class"
```

---

### Task 7: Categories and types by class

**Files:**
- Modify: `src/server/modules/admin/reference-actions.ts` (all three actions)
- Modify: `src/components/admin/ref-table.tsx:28-48, 96, 103-110, 122`
- Modify: `src/app/(app)/admin/asset-categories/page.tsx`, `src/app/(app)/admin/asset-types/page.tsx`

**Interfaces:**
- Produces: `RefTable` gains `fixedCls?: AssetClass`. `createRefRow` still accepts `cls?` but the server decides the class from the role (spec §6.1).

- [ ] **Step 1: Actions**

Replace the imports and add the helper at the top of `reference-actions.ts`:

```ts
import { Prisma, type AssetClass, type Role } from "@prisma/client";
import { actionRole, actionUser } from "@/server/auth/guards";
import { MANAGEABLE_CLASSES, canManageClass } from "@/lib/asset-class";

/**
 * Phase 14 (spec §6.1): the class a role creates a category in. A single-class
 * role gets its class regardless of what the client sent; admin may pick and
 * defaults to the first; a role with no class creates nothing.
 */
function classFor(role: Role, requested: AssetClass | undefined): AssetClass | null {
  const mine = MANAGEABLE_CLASSES[role];
  if (mine.length === 0) return null;
  if (mine.length === 1) return mine[0];
  return requested ?? mine[0];
}
```

`createRefRow` — replace lines 42-56 with:

```ts
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, name, categoryId } = parsed.data;

  // Departments are org structure, not class data — IT's, as before.
  if (entity === "department" && user.role !== "admin" && user.role !== "it_staff") return forbidden();
  const cls = entity === "category" ? classFor(user.role, parsed.data.cls) : null;
  if (entity === "category" && cls === null) return forbidden();
  if (entity === "type") {
    if (!categoryId) return validationError({ categoryId: "Pick a category" });
    const category = await prisma.assetCategory.findUnique({ where: { id: categoryId }, select: { cls: true } });
    if (!category) return validationError({ categoryId: "That category no longer exists" });
    if (!canManageClass(user.role, category.cls)) return forbidden();
  }

  try {
    let id = "";
    await prisma.$transaction(async (tx) => {
      if (entity === "category") id = (await tx.assetCategory.create({ data: { name, cls: cls! } })).id;
      else if (entity === "department") id = (await tx.department.create({ data: { name } })).id;
      else id = (await tx.assetType.create({ data: { name, categoryId: categoryId! } })).id;
```

and in the audit diff replace both `cls ?? "IT"` with `cls`.

`renameRefRow` — replace lines 75-88 with:

```ts
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, id, name } = parsed.data;

  const row = await loadRow(entity, id);
  if (!row) return conflict("That row no longer exists.");
  if (!mayTouch(user.role, entity, row.cls)) return forbidden();
  if (row.locked) return conflict(`"${row.name}" is locked and can't be renamed.`);
  if (row.name === name) return ok(null);
```

Add these two helpers after `classFor`:

```ts
/** One shape for the three tables: the class is the category's own, a type's category's, and null for a department. */
async function loadRow(entity: RefEntity, id: string): Promise<{ name: string; locked: boolean; cls: AssetClass | null } | null> {
  if (entity === "category") {
    const r = await prisma.assetCategory.findUnique({ where: { id }, select: { name: true, locked: true, cls: true } });
    return r && { name: r.name, locked: r.locked, cls: r.cls };
  }
  if (entity === "department") {
    const r = await prisma.department.findUnique({ where: { id }, select: { name: true, locked: true } });
    return r && { name: r.name, locked: r.locked, cls: null };
  }
  const r = await prisma.assetType.findUnique({ where: { id }, select: { name: true, locked: true, category: { select: { cls: true } } } });
  return r && { name: r.name, locked: r.locked, cls: r.category.cls };
}

function mayTouch(role: Role, entity: RefEntity, cls: AssetClass | null): boolean {
  if (entity === "department") return role === "admin" || role === "it_staff";
  return cls !== null && canManageClass(role, cls);
}
```

`deleteRefRow` — replace lines 114-120 with the same `actionUser` head, then insert **before** the per-entity in-use checks:

```ts
  const touch = await loadRow(entity, id);
  if (!touch) return conflict("That row no longer exists.");
  if (!mayTouch(user.role, entity, touch.cls)) return forbidden();
```

(The existing in-use checks that follow reload the row with counts; keep them as they are.)

Remove the now-unused `actionRole` import if nothing else uses it.

- [ ] **Step 2: `RefTable`**

Props:

```ts
export function RefTable({
  entity,
  rows,
  categories,
  fixedCls,
}: {
  entity: "category" | "type" | "department";
  rows: RefRow[];
  categories?: Array<{ id: string; name: string }>;
  /** Phase 14: a single-class role creates categories in ITS class; no picker. */
  fixedCls?: AssetClass;
}) {
  // ...
  const [newCls, setNewCls] = useState<AssetClass>(fixedCls ?? ASSET_CLASSES[0]);
```

Replace the class cell in the add row (lines 103-110) with:

```tsx
            {isCategory && (
              <Td>
                {fixedCls ? (
                  <span className="font-mono text-[10.5px] text-fg-muted" aria-label="Class for the new category">
                    {CLASS_LABEL[fixedCls].toUpperCase()}
                  </span>
                ) : (
                  <Select aria-label="Class for the new category" value={newCls} className="py-1.5 text-xs"
                    onChange={(e) => setNewCls(e.target.value as AssetClass)}>
                    {ASSET_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
                  </Select>
                )}
              </Td>
            )}
```

Both `createRefRow(...)` calls (lines 96 and 122) already send `cls: isCategory ? newCls : undefined`; `newCls` is `fixedCls` when fixed, and the server overrides anyway.

- [ ] **Step 3: Pages**

`asset-categories/page.tsx`:

```tsx
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { MANAGEABLE_CLASSES } from "@/lib/asset-class";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";

export default async function AssetCategoriesPage() {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const mine = MANAGEABLE_CLASSES[user.role];
  const rows = await prisma.assetCategory.findMany({
    where: { cls: { in: [...mine] } },
    include: { _count: { select: { types: true, assets: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <PageHeader title="Asset categories" />
      <RefTable
        entity="category"
        fixedCls={mine.length === 1 ? mine[0] : undefined}
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked, cls: r.cls,
          usage: `${r._count.types} types · ${r._count.assets} assets`,
        }))}
      />
    </>
  );
}
```

`asset-types/page.tsx`:

```tsx
export default async function AssetTypesPage() {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const mine = [...MANAGEABLE_CLASSES[user.role]];
  const [rows, categories] = await Promise.all([
    prisma.assetType.findMany({
      where: { category: { cls: { in: mine } } },
      include: { category: true, _count: { select: { assets: true, policySlots: true } } },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    // Phase 14: a type is filed under a category of the creator's class only —
    // the picker used to mix both classes.
    prisma.assetCategory.findMany({ where: { locked: false, cls: { in: mine } }, orderBy: { name: "asc" } }),
  ]);
```

(add the `MANAGEABLE_CLASSES` import; the JSX is unchanged).

- [ ] **Step 4: Typecheck, run the existing e2e that touches this**

Run: `npm run typecheck && npm run lint` → clean.
Run: `npx playwright test e2e/asset-classes.spec.ts -g "12\."` (category created with a class) and `e2e/admin.spec.ts`.
Expected: PASS. Case 12 signs in as admin, who still sees the picker.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/admin/reference-actions.ts src/components/admin/ref-table.tsx "src/app/(app)/admin/asset-categories/page.tsx" "src/app/(app)/admin/asset-types/page.tsx"
git commit -m "feat(phase-14): each department creates, renames and deletes categories and types of its own class"
```

---

### Task 8: Labels for the classes a role manages

**Files:**
- Modify: `src/app/(app)/inventory/labels/page.tsx:16-21, 33-35, 66-73`
- Modify: `src/components/inventory/bulk-drawer.tsx:36-46`
- Test: `e2e/labels.spec.ts:156` (copy change)

- [ ] **Step 1: Page**

```ts
import { MANAGEABLE_CLASSES } from "@/lib/asset-class";
// ...
  // A SET, not a floor — admin must pass. Phase 14 admits purchasing; the
  // query below prints only the classes the role manages.
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  // ...
  const assets = ids.length
    ? await prisma.asset.findMany({
        where: { id: { in: ids }, cls: { in: [...MANAGEABLE_CLASSES[user.role]] } },
        select: { tag: true, model: true },
        orderBy: { tag: "asc" },
      })
    : [];
```

Replace the `missing` banner's copy (line 72) — it is no longer only "not found", it may be "not yours to print" — with a cause-neutral sentence:

```tsx
            <Banner tone="attention" title={`${missing} selected asset${missing === 1 ? "" : "s"} could not be printed and ${missing === 1 ? "was" : "were"} skipped.`} />
```

and update the comment above it to say the count now also covers ids of a class the role does not manage.

- [ ] **Step 2: Bulk drawer**

Replace lines 36-46 with:

```tsx
        {/* Phase 14: /inventory/labels admits both departments and prints the
            classes the role manages, so the link is offered for any explicit
            selection; the drawer's `cls` is already the user's own view. */}
        {!allMatching && selectedIds.length > 0 && (
          <a
            href={`/inventory/labels?ids=${selectedIds.join(",")}`}
            className="text-xs text-accent hover:underline"
          >
            Print labels for {selectedIds.length} selected
          </a>
        )}
```

- [ ] **Step 3: Update the copy assertion**

`e2e/labels.spec.ts:156`: `"1 selected asset was not found and skipped."` → `"1 selected asset could not be printed and was skipped."`

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm run lint && npx playwright test e2e/labels.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/inventory/labels/page.tsx" src/components/inventory/bulk-drawer.tsx e2e/labels.spec.ts
git commit -m "feat(phase-14): label sheets for whichever classes the role manages"
```

---

### Task 9: `/employees/new`

**Files:**
- Modify: `src/server/modules/employees/actions.ts` (append `createEmployee` after `updateEmployee`)
- Modify: `src/components/employees/employee-form.tsx`
- Create: `src/app/(app)/employees/new/page.tsx`
- Modify: `src/app/(app)/employees/[id]/edit/page.tsx:26-36`
- Modify: `src/app/(app)/employees/page.tsx:56, 131-135`

**Interfaces:**
- Produces: `createEmployee(input): ActionResult<{ id: string }>`; `EmployeeForm` props become a discriminated union on `mode`.

- [ ] **Step 1: Action**

Append to `employees/actions.ts`:

```ts
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");

const createEmployeeSchema = employeeSchema.omit({ id: true }).extend({
  // No format rule: Employee.employeeNo has none anywhere, and the importer
  // (import-employees.ts, E-2) refuses to invent one. Uniqueness is
  // case-insensitive, matching the importer's refKey.
  employeeNo: z.string().trim().min(1, "Give an employee number").max(60),
  joinedAt: dateStr,
});

/** Phase 14: the first manual create path — before this, employees arrived only by import or seed. */
export async function createEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createEmployeeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  if (!(await prisma.department.findUnique({ where: { id: d.departmentId } }))) {
    return validationError({ departmentId: "Unknown department" });
  }
  const taken = await prisma.employee.findFirst({
    where: { employeeNo: { equals: d.employeeNo, mode: "insensitive" } },
    select: { id: true },
  });
  if (taken) return validationError({ employeeNo: "That employee number is already in use" });

  const data = {
    employeeNo: d.employeeNo,
    name: d.name,
    title: d.title,
    departmentId: d.departmentId,
    employment: d.employment,
    m365Status: d.m365Status === "" ? null : d.m365Status,
    joinedAt: new Date(`${d.joinedAt}T00:00:00Z`),
    offboardingAt: d.employment === "OFFBOARDING" ? new Date() : null,
  };

  let id = "";
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({ data });
      id = created.id;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "employee", entityId: created.id,
        action: "create",
        diff: { employeeNo: { from: null, to: d.employeeNo }, name: { from: null, to: d.name } },
      });
    });
  } catch (err) {
    // The unique index is the backstop for two creates racing the check above.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return validationError({ employeeNo: "That employee number is already in use" });
    }
    throw err;
  }
  revalidatePath("/employees");
  return ok({ id });
}
```

- [ ] **Step 2: Form**

Rewrite the props and state of `employee-form.tsx`:

```tsx
import { createEmployee, updateEmployee } from "@/server/modules/employees/actions";

const CUSTOM = "__custom";
const today = () => new Date().toISOString().slice(0, 10);

type Initial = { name: string; title: string; departmentId: string; employment: string; m365Status: string | null };

type Props = { departments: Array<{ id: string; name: string }> } & (
  | { mode: "edit"; employeeId: string; initial: Initial }
  | { mode: "new" }
);

export function EmployeeForm(props: Props) {
  const { departments } = props;
  const initial: Initial =
    props.mode === "edit"
      ? props.initial
      : { name: "", title: "", departmentId: departments[0]?.id ?? "", employment: "ACTIVE", m365Status: null };
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isCustom = initial.m365Status !== null && !(M365_CANONICAL as readonly string[]).includes(initial.m365Status);
  const [form, setForm] = useState({
    employeeNo: "",
    joinedAt: today(),
    name: initial.name,
    title: initial.title,
    departmentId: initial.departmentId,
    employment: initial.employment,
    m365Select: initial.m365Status === null ? "" : isCustom ? CUSTOM : initial.m365Status,
    m365Custom: isCustom ? initial.m365Status! : "",
  });
```

In `submit`, replace the `updateEmployee` call with:

```ts
      const common = { name: form.name, title: form.title, departmentId: form.departmentId, employment: form.employment, m365Status };
      const res =
        props.mode === "edit"
          ? await updateEmployee({ id: props.employeeId, ...common })
          : await createEmployee({ ...common, employeeNo: form.employeeNo, joinedAt: form.joinedAt });
      if (res.ok) {
        if (props.mode === "new") {
          router.push(`/employees/${res.data.id}`);
          return;
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      }
```

and add `fe.employeeNo`-aware unclaimed handling: `const unclaimed = fe._form ?? fe.id;` stays; `employeeNo` and `joinedAt` are claimed by the two new fields below.

In the "Person" card, insert before the Name field, rendered only in `new` mode:

```tsx
          {props.mode === "new" && (
            <>
              <FormField label="Employee number" required error={errors.employeeNo} hint="Any text up to 60 characters; must be unique.">
                {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.employeeNo} onChange={(e) => setForm((f) => ({ ...f, employeeNo: e.target.value }))} />}
              </FormField>
              <FormField label="Joined" required error={errors.joinedAt}>
                {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.joinedAt} onChange={(e) => setForm((f) => ({ ...f, joinedAt: e.target.value }))} />}
              </FormField>
            </>
          )}
```

Submit button label: `{props.mode === "new" ? "Create employee" : saved ? "✓ Saved" : "Save changes"}`.

- [ ] **Step 3: Edit page**

`employees/[id]/edit/page.tsx:26`: `<EmployeeForm mode="edit" employeeId={id} departments={…} initial={…} />` — add `mode="edit"`, nothing else changes.

- [ ] **Step 4: New page**

```tsx
// src/app/(app)/employees/new/page.tsx
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { EmployeeForm } from "@/components/employees/employee-form";

export default async function NewEmployeePage() {
  await requireRole("admin", "it_staff");
  const departments = await prisma.department.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="New employee" breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "New" }]} />
      <EmployeeForm mode="new" departments={departments.map((d) => ({ id: d.id, name: d.name }))} />
    </>
  );
}
```

- [ ] **Step 5: List page**

`employees/page.tsx:56`: after the Import link add `{canMutate && <ButtonLink variant="primary" href="/employees/new">New employee</ButtonLink>}`.
Lines 131-135 (the no-employees empty state):

```tsx
          <EmptyState
            title="No employees yet"
            description="Add one with New employee, or import a sheet."
            actions={canMutate ? <ButtonLink href="/employees/new">New employee</ButtonLink> : undefined}
          />
```

- [ ] **Step 6: Typecheck, try it**

Run: `npm run typecheck && npm run lint` → clean. In the dev server as `it@`, create `EMP-9001 / Test Person / Analyst / IT`; you land on the record. Try `emp-9001` again → the field error.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/employees/actions.ts src/components/employees/employee-form.tsx "src/app/(app)/employees/new/page.tsx" "src/app/(app)/employees/[id]/edit/page.tsx" "src/app/(app)/employees/page.tsx"
git commit -m "feat(phase-14): /employees/new -- the first manual create path, employeeNo unique case-insensitively"
```

---

### Task 10: Purchasing Home — "Approvals waiting"

**Files:**
- Modify: `src/server/modules/home/queries.ts:325-333, 341-344, 82-88` (relative to the excerpt: the `PurchasingHome` interface, the `Promise.all`, the return)
- Modify: `src/app/(app)/page.tsx` purchasing branch (the `Stat` grid)

- [ ] **Step 1: Query**

```ts
import type { Role } from "@prisma/client";
import { approvalClassWhere } from "@/lib/approval-access";

export interface PurchasingHome {
  todo: TodoRow[];
  draftCount: number;
  awaitingIT: number;
  awaitingFinance: number;
  /** completed this calendar month, preformatted */
  spendThisMonth: string;
  /** Phase 14: open lifecycle approvals on the classes this role manages */
  approvalsWaiting: number;
}

export async function purchasingHome(userId: string, role: Role, now: Date = new Date()): Promise<PurchasingHome> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [mine, counts, completed, approvalsWaiting] = await Promise.all([
    // ... the three existing queries unchanged ...
    prisma.approval.count({ where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] } }, approvalClassWhere(role)] } }),
  ]);
  // ...
  return { todo, draftCount: count("DRAFT"), awaitingIT: count("SUBMITTED"), awaitingFinance: count("IT_REVIEWED"),
    spendThisMonth: fmtMoney(completed.reduce((sum, r) => sum + unitsValue(r.units), 0)), approvalsWaiting };
}
```

Search for other callers: `grep -rn "purchasingHome(" src` — only `page.tsx`. Update it: `purchasingHome(user.id, user.role)`.

- [ ] **Step 2: Page**

In the purchasing branch, the grid becomes five stats:

```tsx
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <Stat label="Drafts" value={d.draftCount} />
                  <Stat label="Awaiting IT" value={d.awaitingIT} />
                  <Stat label="Awaiting finance" value={d.awaitingFinance} />
                  <Stat label="Spend this month" value={d.spendThisMonth} />
                  <Stat label="Approvals waiting" value={<Link href="/approvals" className="hover:underline">{d.approvalsWaiting}</Link>} hint="lifecycle changes on your assets" />
                </div>
```

(`Link` is already imported in `page.tsx`.)

- [ ] **Step 3: Typecheck, commit**

Run: `npm run typecheck && npm run lint` → clean.

```bash
git add src/server/modules/home/queries.ts "src/app/(app)/page.tsx"
git commit -m "feat(phase-14): Purchasing Home counts the approvals waiting on its class"
```

---

### Task 11: End-to-end — `e2e/department-owned.spec.ts`

**Files:**
- Create: `e2e/department-owned.spec.ts`
- Modify: `e2e/axe-sweep.spec.ts:97-104`

Selectors verified against the components in this plan and the existing ones: `Assign holder` / `Return` buttons; dialogs named `Assign a holder` / `Request a return`; the combobox is `getByRole("combobox")` inside the dialog; documents use `Select aria-label="Document kind"`, a hidden `input[type="file"]` and a `Mark signed` button; ref-table's add input is `New category name` / `New type name`, the class picker `Class for the new category`, the type's category picker `Category for the new type`; the queue is `getByRole("group", { name: /Approval queue/ })`; the sidebar badge is `span[aria-label*="open approval"]`.

- [ ] **Step 1: Write the spec**

```ts
// e2e/department-owned.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 14 — each department owns its class. Eleven cases: Purchasing approves
 * its own lifecycle changes through the real actions (closing PICKUP §5's
 * D-19 gap), IT cannot touch them, admin sees both; Assign holder / Return on
 * the asset record; documents by class; categories and types by class; labels;
 * the new-employee form; the Home stat.
 *
 * Never reference a raw cuid. Assets by tag, employees by employeeNo,
 * categories by name, approvals by refNo read back from the DB.
 */
const db = new PrismaClient();
const P = "purchasing@thebackroomop.com";
const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const idOf = async (tag: string) => (await db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true } })).id;

/** Drives the worker exactly like asset-classes.spec.ts — the job was enqueued by the REAL approve action this time. */
function runWorkerOnce() {
  execSync("npm run worker:once", { timeout: 60_000, stdio: "inherit" });
}

test.describe.serial("Purchasing owns its approvals", () => {
  let refNo = "";

  test("1. Purchasing requests, sees, claims, approves; the worker executes; IT never saw it", async ({ page }) => {
    const id = await idOf("BR-VH-0002"); // STORED, unheld
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("REPAIRING");
    await page.getByLabel("Reason").fill("e2e — brake pads");
    await page.getByRole("dialog", { name: "Request a status change" }).getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    refNo = (await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } })).refNo;

    // Purchasing's queue shows it; IT's does not.
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: new RegExp(refNo) })).toBeVisible();
    await expect(page.getByText("J/K move")).toBeVisible(); // canAct copy
    await login(page, IT);
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: new RegExp(refNo) })).toHaveCount(0);

    // Back as Purchasing: claim and approve through the real buttons.
    await login(page, P);
    await page.goto("/approvals");
    await page.getByRole("link", { name: refNo }).click();
    await expect(page.getByRole("heading", { name: refNo })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText(`${refNo} claimed`)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${refNo} approved`)).toBeVisible();

    // The real action enqueued the job — nothing is created by hand here.
    expect(await db.job.count({ where: { type: "EXECUTE_APPROVAL", payload: { path: ["approvalId"], equals: (await db.approval.findUniqueOrThrow({ where: { refNo } })).id } } })).toBe(1);
    runWorkerOnce();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("REPAIRING");
    expect((await db.approval.findUniqueOrThrow({ where: { refNo } })).state).toBe("EXECUTED");
  });

  test("2. IT cannot act on a Purchasing approval, even by URL", async ({ page }) => {
    const id = await idOf("BR-FN-0003"); // STORED furniture
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("RETIRED");
    await page.getByLabel("Reason").fill("e2e — broken leg");
    await page.getByRole("dialog", { name: "Request a status change" }).getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const approval = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } });

    await login(page, IT);
    await page.goto(`/approvals/${approval.id}`);
    await expect(page.getByRole("heading", { name: approval.refNo })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).state).toBe("PENDING");
  });

  test("3. admin's queue shows both classes", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: /APR-2041/ })).toBeVisible(); // seeded IT
    const fn = await db.approval.findFirstOrThrow({ where: { asset: { tag: "BR-FN-0003" }, state: "PENDING" } });
    await expect(page.getByRole("row", { name: new RegExp(fn.refNo) })).toBeVisible();
  });
});

test.describe.serial("Assign holder / Return from the asset record", () => {
  test("4. Purchasing assigns a stored car, approves, the car is held; then returns it", async ({ page }) => {
    // BR-VH-0002 was executed to REPAIRING in case 1 — put it back to STORED via Prisma, which the trigger allows.
    await db.asset.update({ where: { tag: "BR-VH-0002" }, data: { status: "STORED" } });
    const id = await idOf("BR-VH-0002");
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Assign holder" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign a holder" });
    await dialog.getByRole("combobox").fill("EMP-0097");
    await dialog.getByRole("option", { name: /EMP-0097/ }).click();
    await dialog.getByLabel("Reason").fill("e2e — pool car to Nina");
    await dialog.getByRole("button", { name: "Request assign" }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const assign = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING", type: "lifecycle_assign" } });
    // The control is absent while the approval is open.
    await page.reload();
    await expect(page.getByRole("button", { name: "Assign holder" })).toHaveCount(0);

    await page.goto(`/approvals/${assign.id}`);
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText(`${assign.refNo} claimed`)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${assign.refNo} approved`)).toBeVisible();
    runWorkerOnce();
    const held = await db.asset.findUniqueOrThrow({ where: { id }, include: { assignee: true } });
    expect(held.status).toBe("OPERATIONAL");
    expect(held.assignee?.employeeNo).toBe("EMP-0097");

    await page.goto(`/inventory/${id}`);
    await expect(page.getByText(/held by/)).toBeVisible();
    await page.getByRole("button", { name: "Return" }).click();
    const ret = page.getByRole("dialog", { name: "Request a return" });
    await ret.getByLabel("Reason").fill("e2e — back to the pool");
    await ret.getByRole("button", { name: "Request return" }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const returned = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING", type: "lifecycle_return" } });
    expect((returned.payload as { to: { status: string } }).to.status).toBe("STORED");
  });

  test("5. on a laptop, Purchasing has no holder control and the holder link opens read-only", async ({ page }) => {
    const id = await idOf("BR-LT-0148"); // DEPLOYED, held
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("button", { name: "Return" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assign holder" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await page.getByRole("link", { name: /held by/ }).or(page.locator('a[href^="/employees/"]').first()).click();
    await expect(page).toHaveURL(/\/employees\/[^/]+$/);
    await expect(page.getByRole("region", { name: "Loadout view" }).or(page.getByLabel("Loadout view"))).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });
});

test.describe("documents by class", () => {
  const pdf = { name: "orcr.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e\n") };

  test("6. Purchasing files a car's papers and signs them; a laptop's panel is read-only for Purchasing", async ({ page }) => {
    const car = await idOf("BR-VH-0001");
    await login(page, P);
    await page.goto(`/inventory/${car}/documents`);
    await page.getByLabel("Document kind").selectOption("other");
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await expect(page.getByText("orcr.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Mark signed" }).click();
    await expect(page.getByText("SIGNED")).toBeVisible();
    expect(await db.assetDocument.count({ where: { assetId: car, signed: true } })).toBe(1);

    const laptop = await idOf("BR-LT-0148");
    await page.goto(`/inventory/${laptop}/documents`);
    await expect(page.getByRole("button", { name: "Choose file" })).toHaveCount(0);
    await expect(page.getByLabel("Document kind")).toHaveCount(0);
  });
});

test.describe.serial("categories and types by class", () => {
  test("7. Purchasing creates Office Supplies (class forced) and a Shredder under it; IT never sees the row", async ({ page }) => {
    await login(page, P);
    await page.goto("/admin/asset-categories");
    await expect(page.getByRole("combobox", { name: "Class for the new category" })).toHaveCount(0);
    await expect(page.getByLabel("Class for the new category")).toHaveText("PURCHASING");
    await page.getByLabel("New category name").fill("Office Supplies");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("row", { name: /Office Supplies/ })).toBeVisible();
    const cat = await db.assetCategory.findUniqueOrThrow({ where: { name: "Office Supplies" } });
    expect(cat.cls).toBe("PURCHASING");
    await expect(page.getByRole("row", { name: /Laptop/ })).toHaveCount(0);

    await page.goto("/admin/asset-types");
    const picker = page.getByLabel("Category for the new type");
    const offered = await picker.locator("option").allTextContents();
    expect(offered).toContain("Office Supplies");
    expect(offered).not.toContain("Laptop");
    await picker.selectOption({ label: "Office Supplies" });
    await page.getByLabel("New type name").fill("Shredder");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("row", { name: /Shredder/ })).toBeVisible();

    await login(page, IT);
    await page.goto("/admin/asset-categories");
    await expect(page.getByRole("row", { name: /Office Supplies/ })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Laptop/ })).toBeVisible();

    await login(page, ADMIN);
    await page.goto("/admin/asset-categories");
    await expect(page.getByRole("row", { name: /Office Supplies/ })).toContainText("PURCHASING");
    await expect(page.getByRole("combobox", { name: "Class for the new category" })).toBeVisible();
  });
});

test.describe("labels", () => {
  test("8. Purchasing prints two cars; a smuggled laptop id is skipped and counted", async ({ page }) => {
    const [a, b, lt] = await Promise.all([idOf("BR-VH-0001"), idOf("BR-VH-0002"), idOf("BR-LT-0148")]);
    await login(page, P);
    await page.goto(`/inventory/labels?ids=${a},${b}`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("img", { name: "Barcode BR-VH-0001" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Barcode BR-VH-0002" })).toBeVisible();
    await expect(page.getByText("2 labels · 1 sheet")).toBeVisible();

    await page.goto(`/inventory/labels?ids=${a},${lt}`);
    await expect(page.getByText("1 selected asset could not be printed and was skipped.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Barcode BR-LT-0148" })).toHaveCount(0);
  });
});

test.describe.serial("new employee", () => {
  test("9. IT creates an employee and a case-variant duplicate is refused", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    await page.getByRole("link", { name: "New employee" }).click();
    await expect(page).toHaveURL(/\/employees\/new$/);
    await page.getByLabel("Employee number").fill("EMP-9001");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Title").fill("Analyst");
    await page.getByLabel("Department").selectOption({ label: "IT" });
    await page.getByRole("button", { name: "Create employee" }).click();
    await expect(page).toHaveURL(/\/employees\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Test Person" })).toBeVisible();
    const row = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9001" } });
    expect(row.employment).toBe("ACTIVE");
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: row.id, action: "create" } })).toBe(1);

    await page.goto("/employees/new");
    await page.getByLabel("Employee number").fill("emp-9001");
    await page.getByLabel("Name").fill("Someone Else");
    await page.getByLabel("Title").fill("Clerk");
    await page.getByRole("button", { name: "Create employee" }).click();
    await expect(page.getByText("That employee number is already in use")).toBeVisible();
    expect(await db.employee.count({ where: { employeeNo: { equals: "emp-9001", mode: "insensitive" } } })).toBe(1);
  });

  test("10. Purchasing cannot open the create or edit forms", async ({ page }) => {
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    await login(page, P);
    await page.goto("/employees/new");
    await expect(page).not.toHaveURL(/\/employees\/new/);
    await page.goto(`/employees/${emp.id}/edit`);
    await expect(page).not.toHaveURL(/\/edit$/);
    await page.goto(`/employees/${emp.id}`);
    await expect(page.getByRole("heading", { name: emp.name })).toBeVisible();
  });
});

test.describe("Purchasing Home", () => {
  test("11. Approvals waiting counts the open Purchasing approvals", async ({ page }) => {
    const expected = await db.approval.count({
      where: { state: { in: ["PENDING", "CLAIMED"] }, OR: [{ assetId: null }, { asset: { cls: "PURCHASING" } }] },
    });
    await login(page, P);
    await page.goto("/");
    await expect(page.getByText("Approvals waiting")).toBeVisible();
    await expect(page.getByRole("link", { name: String(expected), exact: true })).toBeVisible();
  });
});
```

- [ ] **Step 2: axe sweep**

In `e2e/axe-sweep.spec.ts`, extend `IT_STAFF_ROUTES` with `"/employees/new"` and `PURCHASING_STAFF_ROUTES` with `"/approvals", "/employees", "/admin/asset-categories", "/admin/asset-types"`.

- [ ] **Step 3: Run the new file alone, then fix selectors against reality**

Run: `npx playwright test e2e/department-owned.spec.ts`
Expected: PASS, 11 tests. If a selector in this plan does not match the rendered DOM, fix the **test**, and record the fix as a `D-` amendment at the top of this plan (the Phase 13 plan shows the form). Case 5's holder-link and loadout selectors are the most likely to need it; the component's `aria-label="Loadout view"` is on a `section`-like element, so `getByLabel("Loadout view")` is the fallback already written in.

- [ ] **Step 4: Run the whole battery**

Run: `npm run typecheck && npm run lint && npm test && npx playwright test`
Expected: unit `51 + 1 files`, `908 + 22 + N` tests (N = the workspaces cases added in Task 2); e2e `187 + 11`. Record the exact numbers in the commit body.

- [ ] **Step 5: Commit**

```bash
git add e2e/department-owned.spec.ts e2e/axe-sweep.spec.ts
git commit -m "test(phase-14): department-owned e2e -- Purchasing approves through the real actions (closes D-19)"
```

---

### Task 12: The record — PICKUP, HANDOVER, seed comment, spec status

**Files:**
- Modify: `prisma/seed.ts:12, 20`
- Modify: `docs/PICKUP.md` §1 table (Last two phases, Battery), §3 third bullet, §4 item 3, §5
- Modify: `docs/HANDOVER.md` §8 Phase 13 block (line ≈2476)
- Modify: `docs/superpowers/specs/2026-09-07-department-owned-classes-design.md` Status line

- [ ] **Step 1: Seed comment**

Line 12: "twelve accounts" → "five accounts". Line 20: `"…so all twelve accounts "` → `"…so all five accounts "`. Nothing else in the seed changes.

- [ ] **Step 2: PICKUP**

- §3 third bullet becomes: "**Each class is registered, created, edited, requested, approved, assigned, returned, documented, categorised and labelled by its own department; everything else is shared.** Offboarding and Finance review are deliberately not class-gated. Reads are shared: Purchasing can open `/employees` and IT can open a car. (Phase 14; the Phase 13 asymmetry on approvers is closed.)"
- §4 item 3 is replaced by the Phase 14 leftovers: Purchasing bulk import (Phase 15), the unassigned-holder detector for Purchasing, the year-chip empty state, one markup for the two class switches.
- §5: remove the D-19 bullet ("no test drives a Purchasing approval through the real approve action") — case 1 now does.
- §1 "Last two phases": Phase 13 → Phase 14 summary; update the battery numbers from Task 11 Step 4.

- [ ] **Step 3: HANDOVER §8**

In the Phase 13 deferred block, strike the four items this phase closed (Purchasing-owned approvals, assign/return surface, class-aware documents, Purchasing label sheet) and the D-19 real-approve gap; leave the rest. Add one line: "**Phase 14** closed the above on 2026-09-XX; spec `2026-09-07-department-owned-classes-design.md`."

- [ ] **Step 4: Spec status**

Change the spec's **Status** line to: "implemented on branch `phase-14-department-owned-classes`, YYYY-MM-DD; amendments, if any, are `D-` entries at the top of the plan."

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts docs/PICKUP.md docs/HANDOVER.md docs/superpowers/specs/2026-09-07-department-owned-classes-design.md
git commit -m "docs(phase-14): PICKUP, HANDOVER and seed comment reflect department-owned classes"
```

Then stop. Merging `phase-14-department-owned-classes` into `main` and pushing are the user's decisions (PICKUP §3).

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §2 table, every verb | 3 (approvals), 4 (assign/return), 6 (documents), 7 (categories/types), 8 (labels) |
| §3.1–3.3 approvals, no-asset rule | 1, 3 |
| §3.4 surfaces: path, nav, Home stat | 2, 10 |
| §4.1–4.2 HolderControl and guards | 4, 5 |
| §4.3 Purchasing reads `/employees` | 2 (+ e2e 5, 10) |
| §5 documents | 6 |
| §6.1–6.4 reference data | 2, 7 |
| §7 labels | 2, 8 |
| §8 new-employee form | 2 (path), 9 |
| §9 path table | 2 |
| §10 seed comment | 12 |
| §11.1 unit tests | 1, 2 |
| §11.2 e2e 1–11, axe routes | 11 |
| §13 docs | 12 |

Type consistency checked: `isApprover`, `canActOnApproval`, `approvalClassWhere` (Task 1) are the names used in Tasks 3, 4, 6, 10; `activeEmployeeOptions` (Task 5) returns `ComboOption[]`, the type `HolderControl` and `EntityCombobox` consume; `RefTable.fixedCls` (Task 7) is passed by the categories page only; `listApprovals(tab, userId, role)` / `tabCounts(userId, role)` / `getApprovalsBadge(role)` / `purchasingHome(userId, role)` are the only signature changes and each has exactly one caller updated in its task.
