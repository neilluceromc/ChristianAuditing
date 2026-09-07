# Phase 14 — Department-Owned Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IT sees and manages IT assets only; Purchasing sees everything, registers both classes, manages the Purchasing class end to end; a Purchasing-registered IT asset waits for IT's check before Finance sees it; plus a `/employees/new` form.

**Architecture:** Three role→class maps in `src/lib/asset-class.ts` — `VISIBLE_CLASSES`, `REGISTRABLE_CLASSES`, `MANAGEABLE_CLASSES` — and every guard asks one of them. Visibility is enforced at the read seams (`getVisibleAsset`, the list, export, palette, scan, activity/audit) not by hiding links alone. The IT check is two nullable columns on `Asset` (one additive migration), a predicate `cls = IT AND itVerifiedAt IS NULL`, one action, and a gate in Finance's register and confirm. Approvals scope through a new pure `approval-access.ts`. Purchasing's assign/return surface is a `<HolderControl>` on the asset record calling the existing actions.

**Tech Stack:** Next.js 15 App Router · Prisma 6 / PostgreSQL 16 · vitest (node env, pure `src/lib`) · Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-department-owned-classes-design.md` — read §0 (naming), §1 (who decided what), §2 (the three maps) and §5 (the IT check) before touching anything. "Admin" in stakeholder notes means the **Purchasing** department; the codebase's `admin` is the sysadmin role.

**Baselines on `main` at `600949c`:** 908 unit / 51 files · 187 e2e / 14 files · `tsc` and `lint` clean · 14 migrations, none pending. Verify before Task 1 and correct these numbers if they differ.

## Global Constraints

- **Exactly one migration**, `20260907090000_asset_it_verified`, hand-written SQL (HANDOVER §7). Never `prisma migrate reset`; `npm run db:seed` is the sanctioned reset, and a reseed TRUNCATEs, so anything a migration backfills the seed must also set.
- **`finance_staff` maps to `[]` in `MANAGEABLE_CLASSES` on purpose.** Finance's confirm / send-back never consult `canManageClass`.
- **Every guard asks a map.** No new `role === "it_staff"` literal outside `asset-class.ts`, `approval-access.ts` and the department / employee-write surfaces the spec names as role-literal.
- **Absent, not disabled.** An affordance the server would refuse is not rendered.
- **Never `a ${CLASS_LABEL[cls]}`** in copy — use `CLASS_PHRASE[cls]`.
- **e2e references rows by tag / employeeNo / category name / refNo, never a raw cuid.** Every spec file reseeds in `beforeAll`.
- **Seed fixture count is pinned** by `home-finance.spec.ts` (25 IT assets, 32 with cost, ₱48,442,000). Add no seed assets.
- **Commit after every task** on branch `phase-14-department-owned-classes` from `main`, messages prefixed `feat(phase-14):`, `test(phase-14):` or `docs(phase-14):`. Never push; merging and pushing are the user's decisions (PICKUP §3).
- **Windows dev machines:** never `npm install` a new package. This plan adds none.
- Run `npx prisma generate` after Task 2 and after any branch switch that crosses it (HANDOVER).

---

## File map

| File | Responsibility after this phase |
|---|---|
| `src/lib/asset-class.ts` + test | The three maps; `canSeeClass`, `canRegisterClass`, `visibleClassWhere`, `isAwaitingItCheck`, `canEditAsset` |
| `src/lib/approval-access.ts` + test | Who acts on an approval; the queue scope fragment |
| `prisma/migrations/20260907090000_asset_it_verified/`, `prisma/schema.prisma`, `prisma/seed.ts` | The IT-check columns and their backfill |
| `src/lib/workspaces.ts` + test | Path rules and nav for the Purchasing surfaces; employee write surfaces |
| `src/server/modules/inventory/queries.ts` | `getVisibleAsset`, `invisibleAssetIds` |
| `src/app/(app)/inventory/**` | Visibility on list, record tabs, export, scan, activity, labels; register/new offer registrable classes |
| `src/components/inventory/{inventory-toolbar,tag-ref,it-check,holder-control,bulk-drawer}.tsx` | Class switch by visibility; tag-as-text; Mark checked; Assign/Return; labels link |
| `src/lib/audit-list.ts` + test, `src/server/modules/audit/queries.ts`, `src/app/(app)/audit/page.tsx`, `src/app/(app)/audit/export/route.ts` | Audit rows exclude invisible assets |
| `src/server/palette.ts` | Palette assets scoped |
| `src/server/modules/purchases/receiving.ts`, `src/server/modules/inventory/actions.ts`, `src/server/modules/import/asset-actions.ts` | Register/create gate on registrable; stamp the IT check; `verifyAssetDetails`; `updateAsset` via `canEditAsset`; Finance confirm refuses awaiting |
| `src/server/modules/finance/queries.ts` | IT tab requires the check |
| `src/lib/home.ts`, `src/server/modules/home/queries.ts`, `src/components/home/your-shift.tsx`, `src/app/(app)/page.tsx` | CHECK rows; class-scoped approval rows; Purchasing stats |
| `src/lib/activity.ts` + test | Sentence for `it.verify` |
| `src/server/modules/approvals/{actions,queries}.ts`, `src/app/(app)/approvals/**`, `src/components/shell/sidebar.tsx`, `src/app/(app)/layout.tsx` | Approvals by class |
| `src/server/modules/employees/{actions,queries}.ts`, `src/components/employees/{employee-form,loadout-view}.tsx`, `src/app/(app)/employees/**` | Assign/return guards; `createEmployee`; new form; tag-as-text in the loadout |
| `src/app/(app)/offboarding/[employeeId]/page.tsx` | Tag-as-text |
| `src/server/modules/inventory/document-actions.ts`, `src/app/(app)/inventory/[id]/documents/page.tsx` | Documents by class |
| `src/server/modules/admin/reference-actions.ts`, `src/components/admin/ref-table.tsx`, `src/app/(app)/admin/{asset-categories,asset-types}/page.tsx` | Reference data by class |
| `e2e/department-owned.spec.ts` (new), `e2e/{asset-classes,axe-sweep,labels}.spec.ts` | Proof |
| `docs/PICKUP.md`, `docs/HANDOVER.md`, the spec's Status line | The record |

---

### Task 0: Branch and baseline

- [ ] **Step 1:** `git checkout -b phase-14-department-owned-classes main`
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test` → clean, clean, `51 files / 908 tests`. If different, correct the **Baselines** line and commit `docs(plan): Phase 14 baseline`.

---

### Task 1: The maps and pure rules

**Files:**
- Modify: `src/lib/asset-class.ts` (append after `canManageClass`, line 116)
- Test: `src/lib/asset-class.test.ts` (append)
- Create: `src/lib/approval-access.ts`, `src/lib/approval-access.test.ts`

**Interfaces — Produces:**
- `VISIBLE_CLASSES`, `REGISTRABLE_CLASSES: Record<Role, readonly AssetClass[]>`
- `canSeeClass(role, cls)`, `canRegisterClass(role, cls): boolean`
- `visibleClassWhere(role): Prisma.AssetWhereInput`
- `isAwaitingItCheck(a: { cls: AssetClass; itVerifiedAt: Date | null }): boolean`
- `canEditAsset(role, a: { cls; itVerifiedAt }): boolean`
- `isApprover(role)`, `canActOnApproval(role, cls | null)`, `approvalClassWhere(role): Prisma.ApprovalWhereInput`

Every later task imports these exact names.

- [ ] **Step 1: Failing tests — `asset-class.test.ts`** (append)

```ts
import type { Role } from "@prisma/client";
import {
  ASSET_CLASSES, MANAGEABLE_CLASSES, REGISTRABLE_CLASSES, VISIBLE_CLASSES,
  canEditAsset, canRegisterClass, canSeeClass, isAwaitingItCheck, visibleClassWhere,
} from "./asset-class";

const ROLES: Role[] = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"];

describe("Phase 14 — the three maps", () => {
  it("VISIBLE: IT and the viewer see IT only; everyone else sees everything", () => {
    expect(VISIBLE_CLASSES.it_staff).toEqual(["IT"]);
    expect(VISIBLE_CLASSES.viewer).toEqual(["IT"]);
    for (const r of ["admin", "purchasing_staff", "finance_staff"] as Role[]) {
      expect(VISIBLE_CLASSES[r]).toEqual([...ASSET_CLASSES]);
    }
  });
  it("REGISTRABLE: Purchasing registers both, IT its own, Finance and viewer nothing", () => {
    expect(REGISTRABLE_CLASSES.purchasing_staff).toEqual(["IT", "PURCHASING"]);
    expect(REGISTRABLE_CLASSES.it_staff).toEqual(["IT"]);
    expect(REGISTRABLE_CLASSES.finance_staff).toEqual([]);
    expect(REGISTRABLE_CLASSES.viewer).toEqual([]);
  });
  it("MANAGEABLE ⊆ REGISTRABLE ⊆ VISIBLE for every role", () => {
    for (const r of ROLES) {
      for (const c of MANAGEABLE_CLASSES[r]) expect(REGISTRABLE_CLASSES[r]).toContain(c);
      for (const c of REGISTRABLE_CLASSES[r]) expect(VISIBLE_CLASSES[r]).toContain(c);
    }
  });
  it("canSeeClass / canRegisterClass read the maps", () => {
    expect(canSeeClass("it_staff", "PURCHASING")).toBe(false);
    expect(canSeeClass("purchasing_staff", "IT")).toBe(true);
    expect(canRegisterClass("purchasing_staff", "IT")).toBe(true);
    expect(canRegisterClass("it_staff", "PURCHASING")).toBe(false);
    expect(canRegisterClass("finance_staff", "IT")).toBe(false);
  });
  it("visibleClassWhere is empty for an all-class role and an `in` list otherwise", () => {
    expect(visibleClassWhere("admin")).toEqual({});
    expect(visibleClassWhere("purchasing_staff")).toEqual({});
    expect(visibleClassWhere("finance_staff")).toEqual({});
    expect(visibleClassWhere("it_staff")).toEqual({ cls: { in: ["IT"] } });
    expect(visibleClassWhere("viewer")).toEqual({ cls: { in: ["IT"] } });
  });
});

describe("Phase 14 — the IT check", () => {
  const d = new Date();
  it("only an IT asset with no stamp is awaiting", () => {
    expect(isAwaitingItCheck({ cls: "IT", itVerifiedAt: null })).toBe(true);
    expect(isAwaitingItCheck({ cls: "IT", itVerifiedAt: d })).toBe(false);
    expect(isAwaitingItCheck({ cls: "PURCHASING", itVerifiedAt: null })).toBe(false);
    expect(isAwaitingItCheck({ cls: "PURCHASING", itVerifiedAt: d })).toBe(false);
  });
  const awaiting = { cls: "IT" as const, itVerifiedAt: null };
  const checked = { cls: "IT" as const, itVerifiedAt: d };
  const car = { cls: "PURCHASING" as const, itVerifiedAt: null };
  it.each([
    ["admin", true, true, true],
    ["it_staff", true, true, false],
    ["purchasing_staff", true, false, true],
    ["finance_staff", false, false, false],
    ["viewer", false, false, false],
  ] as Array<[Role, boolean, boolean, boolean]>)(
    "canEditAsset %s: awaiting IT %s · checked IT %s · car %s",
    (role, a, c, p) => {
      expect(canEditAsset(role, awaiting)).toBe(a);
      expect(canEditAsset(role, checked)).toBe(c);
      expect(canEditAsset(role, car)).toBe(p);
    },
  );
});
```

- [ ] **Step 2: Failing tests — `approval-access.test.ts`**

```ts
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
  it("is unfiltered for admin, finance and viewer", () => {
    expect(approvalClassWhere("admin")).toEqual({});
    expect(approvalClassWhere("finance_staff")).toEqual({});
    expect(approvalClassWhere("viewer")).toEqual({});
  });
  it("scopes a single-class role to its class OR to approvals with no asset", () => {
    expect(approvalClassWhere("it_staff")).toEqual({ OR: [{ assetId: null }, { asset: { cls: { in: ["IT"] } } }] });
    expect(approvalClassWhere("purchasing_staff")).toEqual({ OR: [{ assetId: null }, { asset: { cls: { in: ["PURCHASING"] } } }] });
  });
  it("derives the class list from MANAGEABLE_CLASSES, not a literal", () => {
    const where = approvalClassWhere("purchasing_staff") as { OR: Array<{ asset?: { cls: { in: string[] } } }> };
    expect(where.OR[1].asset?.cls.in).toEqual(["PURCHASING"]);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/lib/asset-class.test.ts src/lib/approval-access.test.ts` → FAIL (missing exports / module).

- [ ] **Step 4: Implement — append to `asset-class.ts`** (and widen the import to `import type { AssetClass, AssetStatus, Prisma, Role } from "@prisma/client";`)

```ts
/**
 * Phase 14 (spec §2). Which classes a role SEES on the register — list, record,
 * export, search, scan, activity. IT's department sees IT only; Purchasing,
 * Finance and admin see everything; the viewer is IT's read-only seat.
 * Person-centric pages (an employee's holdings, offboarding) are NOT scoped by
 * this map — they render an invisible tag as text (spec §3.3).
 */
export const VISIBLE_CLASSES: Record<Role, readonly AssetClass[]> = {
  admin: ["IT", "PURCHASING"],
  it_staff: ["IT"],
  purchasing_staff: ["IT", "PURCHASING"],
  finance_staff: ["IT", "PURCHASING"],
  viewer: ["IT"],
};

/**
 * Which classes a role may REGISTER or CREATE into. Purchasing buys for the
 * whole company, so it registers both; IT registers its own. Registering is
 * not managing: a laptop Purchasing registers is IT's from that moment.
 */
export const REGISTRABLE_CLASSES: Record<Role, readonly AssetClass[]> = {
  admin: ["IT", "PURCHASING"],
  it_staff: ["IT"],
  purchasing_staff: ["IT", "PURCHASING"],
  finance_staff: [],
  viewer: [],
};

export function canSeeClass(role: Role, cls: AssetClass): boolean {
  return VISIBLE_CLASSES[role].includes(cls);
}

export function canRegisterClass(role: Role, cls: AssetClass): boolean {
  return REGISTRABLE_CLASSES[role].includes(cls);
}

/** AND this into any asset read a single-class role may reach. `{}` for an all-class role. */
export function visibleClassWhere(role: Role): Prisma.AssetWhereInput {
  const mine = VISIBLE_CLASSES[role];
  return mine.length === ASSET_CLASSES.length ? {} : { cls: { in: [...mine] } };
}

/**
 * Spec §5.1. An IT asset registered by a department that does not manage IT
 * waits for IT's check. The class is part of the predicate on purpose: a
 * Purchasing asset never carries a stamp and is never "awaiting".
 */
export function isAwaitingItCheck(a: { cls: AssetClass; itVerifiedAt: Date | null }): boolean {
  return a.cls === "IT" && a.itVerifiedAt === null;
}

/**
 * Spec §5.4. Who may EDIT: the managing department always; the registering
 * department only while IT has not yet checked it (so Purchasing can fix its
 * own typo). Status, assign and return follow canManageClass alone.
 */
export function canEditAsset(role: Role, a: { cls: AssetClass; itVerifiedAt: Date | null }): boolean {
  return canManageClass(role, a.cls) || (isAwaitingItCheck(a) && canRegisterClass(role, a.cls));
}
```

- [ ] **Step 5: Implement — `src/lib/approval-access.ts`**

```ts
import type { AssetClass, Prisma, Role } from "@prisma/client";
import { ASSET_CLASSES, MANAGEABLE_CLASSES, canManageClass } from "./asset-class";

/**
 * Phase 14 (spec §6). Who may act on an approval, and which approvals a role's
 * queue shows. Both derive from MANAGEABLE_CLASSES: the approver of a lifecycle
 * change is whoever manages the asset's class.
 */

/** A role that manages at least one class may act on SOME approval. */
export function isApprover(role: Role): boolean {
  return MANAGEABLE_CLASSES[role].length > 0;
}

/**
 * An approval with no asset has no class (the seed carries two; systemChecks
 * already reports them unexecutable). Any approver may reject one; none may
 * execute it. Spec §6.3.
 */
export function canActOnApproval(role: Role, assetCls: AssetClass | null): boolean {
  if (assetCls === null) return isApprover(role);
  return canManageClass(role, assetCls);
}

/**
 * The where-fragment that scopes a queue, badge or count. A role that manages
 * every class or no class is unfiltered — admin acts on all, finance and viewer
 * read all. A single-class role sees its class plus the class-less rows.
 */
export function approvalClassWhere(role: Role): Prisma.ApprovalWhereInput {
  const mine = MANAGEABLE_CLASSES[role];
  if (mine.length === 0 || mine.length === ASSET_CLASSES.length) return {};
  return { OR: [{ assetId: null }, { asset: { cls: { in: [...mine] } } }] };
}
```

- [ ] **Step 6: Run** the two test files → PASS. `npm test` → the rest still green.
- [ ] **Step 7: Commit** `feat(phase-14): VISIBLE / REGISTRABLE maps, IT-check predicate, approval-access`

---

### Task 2: Migration, schema, seed

**Files:**
- Create: `prisma/migrations/20260907090000_asset_it_verified/migration.sql`
- Modify: `prisma/schema.prisma:273` (Asset), `:150-151` (User back-relations)
- Modify: `prisma/seed.ts:12, 20, 118-127` (comment; `mk`)

- [ ] **Step 1: Migration SQL**

```sql
-- Phase 14 (spec §5): an IT-class asset that Purchasing registers waits for
-- IT's check before Finance sees it. NULL on an IT asset means awaiting.
-- Purchasing assets never carry a value -- the predicate in asset-class.ts is
-- cls = IT AND itVerifiedAt IS NULL, so a null on a car means nothing.
ALTER TABLE "Asset" ADD COLUMN "itVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "itVerifiedById" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_itVerifiedById_fkey"
  FOREIGN KEY ("itVerifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Asset_itVerifiedAt_idx" ON "Asset"("itVerifiedAt");

-- Every IT asset that exists today was registered by IT: Phase 13 allowed
-- nothing else. None is awaiting a check. A reseed TRUNCATEs, so prisma/seed.ts
-- sets the same value itself (HANDOVER: a migration's backfill does not survive
-- a reseed).
UPDATE "Asset" SET "itVerifiedAt" = "createdAt" WHERE "cls" = 'IT';
```

- [ ] **Step 2: Schema** — after `financeReturnReason  String?` (line 279) add:

```prisma
  /// Phase 14: set when IT checked a Purchasing-registered IT asset, or at
  /// creation when IT registered it. NULL on an IT asset = awaiting IT's check.
  /// Always NULL on a Purchasing asset (isAwaitingItCheck includes the class).
  itVerifiedAt         DateTime?
  itVerifiedById       String?
  itVerifiedBy         User?     @relation("itVerifiedBy", fields: [itVerifiedById], references: [id], onDelete: Restrict)
```

add `@@index([itVerifiedAt])` beside the finance indexes, and on `User` beside the two existing back-relations (lines 150-151) add `itVerifiedAssets Asset[] @relation("itVerifiedBy")`.

- [ ] **Step 3: Seed** — line 12 "twelve accounts" → "five accounts"; line 20 the same in the error string. In `mk` (line ~121) add after `cls: cats[cat].cls,`:

```ts
    // Phase 14: IT-registered rows are born checked; a car never carries a stamp.
    itVerifiedAt: cats[cat].cls === "IT" ? day(-720) : null,
```

- [ ] **Step 4: Apply**

```bash
docker compose up -d db
npx prisma migrate deploy && npx prisma generate
npm run db:seed
```

Expected: `1 migration applied`; seed completes; `npx prisma migrate status` → no pending. Then `npm run typecheck` → clean (the generated client now has the fields).

- [ ] **Step 5: Commit** `feat(phase-14): Asset.itVerifiedAt/By -- migration 15, backfilled; seed stamps IT fixtures`

---

### Task 3: Path rules and nav

**Files:** `src/lib/workspaces.ts:80-107, 157-225` · `src/lib/workspaces.test.ts:44-156, 212-229`

- [ ] **Step 1: Failing cases** — insert into the `cases` array after the `/employees/import` block (line 148):

```ts
    // Phase 14: Purchasing owns its class and reads the directory. Approvals
    // are class-scoped server-side (approval-access.ts), never here.
    ["/approvals", "purchasing_staff", true],
    ["/approvals/xyz", "purchasing_staff", true],
    ["/employees", "purchasing_staff", true],
    ["/employees/abc", "purchasing_staff", true],
    ["/employees/abc/form", "purchasing_staff", true],
    ["/employees/export", "purchasing_staff", true],
    // Every employee WRITE surface stays IT, asserted for every role — the same
    // first-match-wins reason as /employees/import.
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
    ["/offboarding", "purchasing_staff", false],
    ["/reservations", "purchasing_staff", false],
    ["/admin/asset-categories", "purchasing_staff", true],
    ["/admin/asset-types", "purchasing_staff", true],
    ["/admin/asset-categories", "finance_staff", false],
    ["/admin/departments", "purchasing_staff", false],
    ["/admin/departments", "it_staff", true],
    ["/inventory/labels", "purchasing_staff", true],
```

Flip four existing cases to `true`: line 48 `/employees` purchasing; line 56 `/employees/export` purchasing; line 68 `/approvals` purchasing; line 138 `/inventory/labels` purchasing.

Add to `describe("WORKSPACE_NAV shape")`:

```ts
  it("Phase 14: the Purchasing Assets section carries Approvals (with badge) and Employees", () => {
    const assets = WORKSPACE_NAV.purchasing.find((s) => s.heading === "Assets");
    expect(assets?.items.find((i) => i.label === "Approvals")?.badge).toBe("approvals");
    expect(assets?.items.map((i) => i.href)).toContain("/employees");
  });
  it("Phase 14: the Purchasing Records section offers categories and types, never departments", () => {
    const records = WORKSPACE_NAV.purchasing.find((s) => s.heading === "Records");
    expect(records?.items.map((i) => i.href)).toEqual(["/admin/asset-categories", "/admin/asset-types"]);
  });
```

- [ ] **Step 2: Run** → FAIL on the new cases.

- [ ] **Step 3: `PATH_RULES`** — replace lines 159-163 with:

```ts
  // Phase 14: each department creates categories and types of its OWN class
  // (reference-actions.ts forces the class from MANAGEABLE_CLASSES). Departments
  // are org structure, not class data, and stay IT.
  {
    test: /^\/admin\/(asset-categories|asset-types)(\/|$)/,
    workspaces: ["it", "purchasing"],
    roles: ["admin", "it_staff", "purchasing_staff"],
  },
  { test: /^\/admin\/departments(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
```

Replace line 190 with:

```ts
  // Phase 14: a label sheet is each class's own artifact; the page prints only
  // the classes the role manages. Still MUST precede the general /inventory rule.
  { test: /^\/inventory\/labels(\/|$)/, workspaces: ["it", "purchasing"], roles: ["admin", "it_staff", "purchasing_staff"] },
```

Replace lines 212-218 with:

```ts
  { test: /^\/employees\/import(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  // Phase 14: the two other employee WRITE surfaces get the same treatment,
  // because the general /employees rule right after them now admits
  // purchasing (reads only). Both MUST precede it.
  { test: /^\/employees\/new(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  { test: /^\/employees\/[^/]+\/edit(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
  // Phase 14: purchasing READS the directory so "held by …" on a car opens.
  // Covers /employees/export too: an export matches its list page's access.
  { test: /^\/employees(\/|$)/, workspaces: ["it", "purchasing"] },
  { test: /^\/(audit|offboarding|reservations)(\/|$)/, workspaces: ["it"] },
  // Phase 14: purchasing approves lifecycle changes on its own class.
  { test: /^\/approvals(\/|$)/, workspaces: ["it", "finance", "purchasing"] },
```

(Keep the existing long comment above the import rule.)

- [ ] **Step 4: Nav** — replace lines 99-106 with:

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

- [ ] **Step 5: Run** `npm test` → PASS.
- [ ] **Step 6: Commit** `feat(phase-14): purchasing workspace reaches approvals, employees (read), categories, types, labels`

---

### Task 4: Visibility on the register

**Files:**
- Modify: `src/server/modules/inventory/queries.ts` (append after `getAsset`, line 325)
- Create: `src/components/inventory/tag-ref.tsx`
- Modify: `src/app/(app)/inventory/page.tsx:32-37, 133-135, 139-146, 171`
- Modify: `src/components/inventory/inventory-toolbar.tsx` (props + lines 81-96)
- Modify: `src/app/(app)/inventory/[id]/{layout,page,documents/page,history/page,timeline/page,reservations/page,secrets/page}.tsx` (the `getAsset(id)` call in each)
- Modify: `src/app/(app)/inventory/[id]/edit/page.tsx:12-19`
- Modify: `src/app/(app)/inventory/export/route.ts:14, 37-41`
- Modify: `src/server/palette.ts:53-57`
- Modify: `src/app/(app)/inventory/scan/[tag]/page.tsx:31-72`
- Modify: `src/app/(app)/inventory/activity/page.tsx:19-30`
- Modify: `src/lib/audit-list.ts:16-27` (+ test), `src/server/modules/audit/queries.ts` (`listAudit`), `src/app/(app)/audit/page.tsx:26-35`, `src/app/(app)/audit/export/route.ts`

**Interfaces — Produces:** `getVisibleAsset(id, role)`, `invisibleAssetIds(role): Promise<string[]>`, `<TagRef id tag visible />`, `InventoryToolbar.classes: readonly AssetClass[]`, `buildAuditWhere(state, hiddenAssetIds = [])`.

- [ ] **Step 1: Queries**

```ts
import type { Role } from "@prisma/client";
import { ASSET_CLASSES, canSeeClass } from "@/lib/asset-class";

/** getAsset, but a class the role cannot see reads as absent (spec §3.1). */
export async function getVisibleAsset(id: string, role: Role) {
  const asset = await getAsset(id);
  return asset && canSeeClass(role, asset.cls) ? asset : null;
}

/**
 * Ids of the assets a role may NOT see — for excluding their audit rows. Empty
 * for an all-class role; for IT it is the Purchasing fleet, which is small.
 */
export async function invisibleAssetIds(role: Role): Promise<string[]> {
  const hidden = ASSET_CLASSES.filter((c) => !canSeeClass(role, c));
  if (hidden.length === 0) return [];
  const rows = await prisma.asset.findMany({ where: { cls: { in: hidden } }, select: { id: true } });
  return rows.map((r) => r.id);
}
```

- [ ] **Step 2: `TagRef`**

```tsx
// src/components/inventory/tag-ref.tsx
import Link from "next/link";

/**
 * Phase 14 (spec §3.3): person-centric pages list every asset a person holds,
 * but a tag the viewer cannot open is text, not a link that lands on not-found.
 */
export function TagRef({ id, tag, visible, className }: { id: string; tag: string; visible: boolean; className?: string }) {
  if (!visible) {
    return <span className="font-mono text-fg-secondary" title="Outside your register">{tag}</span>;
  }
  return <Link href={`/inventory/${id}`} className={className ?? "font-mono text-accent hover:underline"}>{tag}</Link>;
}
```

- [ ] **Step 3: The list page** — replace lines 36-37 with:

```ts
  const visible = VISIBLE_CLASSES[user.role];
  const requested = parseCls(sp.get("cls"));
  // Phase 14 (spec §3.1): a class this role cannot see is not a view it can
  // ask for. Redirect to the bare list rather than render an empty table under
  // a heading that names the other department's assets.
  if (requested && !canSeeClass(user.role, requested)) redirect("/inventory");
  const cls: AssetClass = requested ?? visible[0];
  const canMutate = canManageClass(user.role, cls);
  const canRegister = canRegisterClass(user.role, cls);
```

Import `VISIBLE_CLASSES, canRegisterClass, canSeeClass` from `@/lib/asset-class`. Line 134-135: the Import link keeps `canMutate && cls === "IT"`; the **New asset** link becomes `{canRegister && <ButtonLink … >New asset</ButtonLink>}` and the same in the empty state (line 199). Pass `classes={visible}` to `<InventoryToolbar>`.

- [ ] **Step 4: Toolbar** — add prop `classes: readonly AssetClass[]` and replace the class-switch block (lines 81-96) so it renders only when `classes.length > 1` and maps over `classes` instead of `ASSET_CLASSES`:

```tsx
      {classes.length > 1 && (
        <div className="flex items-center gap-1.5" role="navigation" aria-label="Asset class">
          {classes.map((c) => { /* body unchanged */ })}
        </div>
      )}
```

Remove the now-unused `ASSET_CLASSES` import if nothing else uses it.

- [ ] **Step 5: The record and its tabs** — in `layout.tsx`, `page.tsx`, `documents/page.tsx`, `history/page.tsx`, `timeline/page.tsx`, `reservations/page.tsx`, `secrets/page.tsx` replace `const asset = await getAsset(id);` with `const asset = await getVisibleAsset(id, user.role);` and import it. `page.tsx` (Overview) has no `user`: add `const user = await requireUser();` (import from `@/server/auth/guards`). `secrets/page.tsx` keeps its extra `cls === "PURCHASING"` guard.

`edit/page.tsx` line 12-19:

```ts
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset || !canSeeClass(user.role, asset.cls)) notFound();
  // Spec §5.4: the managing department, or the registrant while IT has not
  // checked it. The Edit button is hidden by the same predicate (layout.tsx).
  if (!canEditAsset(user.role, asset)) redirect(`/inventory/${id}`);
```

(imports: `canEditAsset, canSeeClass`). The layout's own `canMutate` split is done in Task 6.

- [ ] **Step 6: Export route** — `const user = await requireUser();` and

```ts
  const scope = visibleClassWhere(user.role);
  const where: Prisma.AssetWhereInput = ids
    ? { AND: [{ id: { in: ids } }, scope] }
    : cutIds !== null
      ? { AND: [{ id: { in: cutIds } }, scope] }
      : { AND: [buildAssetWhere(state, purchaseYear, cls), scope] };
```

(import `visibleClassWhere`, `type Prisma` from `@prisma/client`).

- [ ] **Step 7: Palette** — the asset query's `where` becomes `{ AND: [{ OR: [ …the two contains… ] }, visibleClassWhere(user.role)] }`.

- [ ] **Step 8: Scan page** — `const user = await requireUser();`, add `cls: true` to the `select`, and after the `!asset` branch:

```tsx
  // Phase 14 (spec §3.1): the sticker is real, so not "unknown" — but the
  // record is another department's. Name the tag, show nothing else.
  if (!canSeeClass(user.role, asset.cls)) {
    return (
      <>
        <PageHeader title={asset.tag} breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]} />
        <Banner tone="attention" title={`${asset.tag} is not in your register.`}>
          It belongs to {CLASS_PHRASE[asset.cls]} register. Ask that department if you need its details.
        </Banner>
        <div className="pt-3"><ButtonLink href="/inventory">Back to inventory</ButtonLink></div>
      </>
    );
  }
```

- [ ] **Step 9: Activity page** — `const user = await requireUser();` then

```ts
  const hidden = await invisibleAssetIds(user.role);
  const where = { entityType: "asset", ...(hidden.length ? { entityId: { notIn: hidden } } : {}) };
```

and use `where` in both the `count` and the `findMany`.

- [ ] **Step 10: Audit** — `buildAuditWhere(state, hiddenAssetIds: string[] = [])`: after the entity filter add

```ts
  // Phase 14 (spec §3.1): rows about assets this role cannot see are not its
  // audit trail either. Empty for an all-class role — no clause at all.
  if (hiddenAssetIds.length) where.NOT = { entityType: "asset", entityId: { in: hiddenAssetIds } };
```

Add to `src/lib/audit-list.test.ts` (create the file if absent, mirroring `inventory-list.test.ts`'s imports):

```ts
  it("excludes hidden asset rows only when given ids", () => {
    const state = parseListState(new URLSearchParams(""), AUDIT_LIST_CONFIG);
    expect(buildAuditWhere(state)).not.toHaveProperty("NOT");
    expect(buildAuditWhere(state, ["a1"])).toMatchObject({ NOT: { entityType: "asset", entityId: { in: ["a1"] } } });
  });
```

`listAudit(state, hidden)` threads the second argument to `buildAuditWhere`; `audit/page.tsx` computes `const hidden = await invisibleAssetIds(user.role)` (it needs `const user = await requireUser()`) and passes it to both `listAudit` and the `groupBy` where; `audit/export/route.ts` does the same (grep `buildAuditWhere` for every caller).

- [ ] **Step 11: Verify** `npm run typecheck && npm run lint && npm test` → clean. In the dev server as `it@`: `/inventory?cls=PURCHASING` → lands on `/inventory`; no class switch; a car's record → not found; `/inventory/scan/BR-VH-0001` → "not in your register". As `purchasing@`: the switch shows, the car opens.

- [ ] **Step 12: Commit** `feat(phase-14): IT sees IT -- list, record, export, palette, scan, activity and audit scoped by VISIBLE_CLASSES`

---

### Task 5: Registration by Purchasing, the IT stamp

**Files:**
- Modify: `src/server/modules/purchases/receiving.ts:81-90, 117-139`
- Modify: `src/server/modules/inventory/actions.ts:196-200, 224-238` (createAsset), `:306-316` (updateAsset)
- Modify: `src/server/modules/import/asset-actions.ts` (the asset create)
- Modify: `src/app/(app)/inventory/register/page.tsx:16-25`, `src/app/(app)/inventory/new/page.tsx:22-31`

- [ ] **Step 1: `registerAssets`** — the gate (line 86-90) becomes:

```ts
  // Spec §4: Purchasing registers both classes, IT its own. Registering is not
  // managing — an IT asset Purchasing registers is IT's from this moment.
  if (!canRegisterClass(user.role, category.cls)) {
    return validationError({
      categoryId: `${category.name} is ${CLASS_PHRASE[category.cls]} category — your department does not register ${CLASS_LABEL[category.cls]} assets.`,
    });
  }
  // Spec §4 stamping: born checked when the registrant manages the class.
  const selfChecked = category.cls === "IT" && canManageClass(user.role, "IT");
```

and in the `tx.asset.create` data add:

```ts
            itVerifiedAt: selfChecked ? new Date() : null,
            itVerifiedById: selfChecked ? user.id : null,
```

Import `canRegisterClass` beside `canManageClass`.

- [ ] **Step 2: `createAsset`** — identical gate wording with "create", identical `selfChecked` and the two data fields.

- [ ] **Step 3: Import wizard** — `grep -n "asset.create\|createMany" src/server/modules/import/asset-actions.ts`; at each create of a NEW asset add `itVerifiedAt: new Date(), itVerifiedById: user.id` (the wizard is admin/it_staff only and IT-class only, so every row is self-checked). Updates of existing rows are untouched.

- [ ] **Step 4: `updateAsset`** — line 316: `if (!canEditAsset(user.role, asset)) return forbidden();` (import `canEditAsset`). The cross-class category guard below it stays.

- [ ] **Step 5: Pages** — `register/page.tsx` lines 17 and 22: `MANAGEABLE_CLASSES` → `REGISTRABLE_CLASSES` (and the import; update the comment to say registering, not managing). `new/page.tsx` line 22: `canManageClass(user.role, cls)` → `canRegisterClass(user.role, cls)`; lines 25 and 29: `MANAGEABLE_CLASSES` → `REGISTRABLE_CLASSES`.

- [ ] **Step 6: Verify** `npm run typecheck && npm run lint` → clean. `npx playwright test e2e/receiving.spec.ts` → PASS (IT registers → stamped → Finance confirms; Task 6 adds the gate but stamped rows pass it).

- [ ] **Step 7: Commit** `feat(phase-14): Purchasing registers both classes; IT-registered assets are born checked`

---

### Task 6: The IT check — action, record, Finance gate, Home rows

**Files:**
- Modify: `src/server/modules/inventory/actions.ts` (append `verifyAssetDetails`; edit `confirmAssetDetails` lines 460-471)
- Create: `src/components/inventory/it-check.tsx`
- Modify: `src/app/(app)/inventory/[id]/layout.tsx:27-33, 44-53, 58-65`
- Modify: `src/server/modules/finance/queries.ts:38`
- Modify: `src/lib/home.ts` (`ShiftKind`), `src/components/home/your-shift.tsx:8-14`, `src/server/modules/home/queries.ts` (`yourShift`)
- Modify: `src/lib/activity.ts` (+ test)

- [ ] **Step 1: Action**

```ts
const verifySchema = z.object({ id: z.string().min(1) });

/**
 * Phase 14 (spec §5.2): IT marks a Purchasing-registered IT asset checked.
 * Finance's register and confirm wait for this. Same shape as confirmAssetDetails:
 * refuse-not-silence, null check IN the where.
 */
export async function verifyAssetDetails(input: unknown): Promise<ActionResult<{ tag: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const asset = await prisma.asset.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, tag: true, cls: true, itVerifiedAt: true },
  });
  if (!asset) return conflict("That asset no longer exists.");
  if (asset.cls !== "IT") return conflict(`${asset.tag} is ${CLASS_PHRASE[asset.cls]} asset — Purchasing assets are not IT-checked.`);
  if (asset.itVerifiedAt) return conflict(`${asset.tag} was already checked.`);

  const hit = await prisma.$transaction(async (tx) => {
    const r = await tx.asset.updateMany({
      where: { id: asset.id, itVerifiedAt: null },
      data: { itVerifiedAt: new Date(), itVerifiedById: user.id },
    });
    if (r.count === 0) return false;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: asset.id,
      action: "it.verify",
      diff: { itVerified: { from: null, to: user.name } },
    });
    return true;
  });
  if (!hit) return conflict(`${asset.tag} was checked by someone else just now.`);
  revalidatePath(`/inventory/${asset.id}`);
  revalidatePath("/inventory");
  revalidatePath("/finance/assets");
  return ok({ tag: asset.tag });
}
```

`confirmAssetDetails`: add `cls: true, itVerifiedAt: true` to its `select` (line 463) and after the "already confirmed" refusal:

```ts
    if (isAwaitingItCheck(asset)) {
      failure = conflict(`${asset.tag} is waiting for IT's check — Finance confirms after IT.`);
      return;
    }
```

- [ ] **Step 2: Activity sentence** — `grep -n "finance.confirm" src/lib/activity.ts src/lib/activity.test.ts`; beside the `finance.confirm` entry add `"it.verify"` with the verb `checked` (so the feed reads "J. Sarmiento checked BR-LT-0300"), and a test case mirroring the `finance.confirm` one.

- [ ] **Step 3: `ItCheck` component**

```tsx
// src/components/inventory/it-check.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { verifyAssetDetails } from "@/server/modules/inventory/actions";

/** Phase 14 (spec §5.5): IT's one-click check on a Purchasing-registered IT asset. */
export function ItCheck({ assetId, tag }: { assetId: string; tag: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await verifyAssetDetails({ id: assetId });
      if (res.ok) {
        toast(`${res.data.tag} checked — Finance can see it now`, "settled");
        setOpen(false);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Mark checked</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Mark ${tag} checked?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Mark checked</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            Confirms the details Purchasing registered are right for IT. Finance sees this record only after.
            Edit first if something is wrong.
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Layout** — replace lines 27-33 with:

```ts
  const awaitingIt = isAwaitingItCheck(asset);
  const canMutate = canManageClass(user.role, asset.cls);          // status, holder
  const canEdit = canEditAsset(user.role, asset);                  // spec §5.4
  const canCheck = awaitingIt && (user.role === "admin" || user.role === "it_staff");
  const returned = asset.financeReturnedAt !== null;
  // Finance confirms after IT (spec §5.3) — absent while awaiting, not disabled.
  const canConfirm = (user.role === "admin" || user.role === "finance_staff") && !asset.financeConfirmedAt && !awaitingIt;
  const canResubmit = canManageClass(user.role, asset.cls) && returned;
  const pending = asset.approvals[0];
```

Pill block (lines 44-53): insert the awaiting state between RETURNED and AWAITING FINANCE:

```tsx
            ) : awaitingIt ? (
              <Pill tone="accent">AWAITING IT CHECK</Pill>
            ) : (
              <Pill tone="accent">AWAITING FINANCE</Pill>
            )}
```

Actions (lines 58-65): the outer condition becomes `canMutate || canEdit || canCheck || canConfirm || canResubmit`; inside:

```tsx
              {canCheck && <ItCheck assetId={asset.id} tag={asset.tag} />}
              {canMutate && <RequestStatusChange assetId={asset.id} currentStatus={asset.status} cls={asset.cls} />}
              {canEdit && <ButtonLink href={`/inventory/${asset.id}/edit`}>Edit</ButtonLink>}
```

Imports: `ASSIGNABLE_FROM` (Task 9 uses it), `canEditAsset`, `isAwaitingItCheck`, `ItCheck`.

- [ ] **Step 5: Finance register** — `finance/queries.ts:38`:

```ts
  // Spec §5.3: Finance sees an IT asset only once IT has checked it. Purchasing
  // rows never carry a stamp and are not gated.
  const where: Prisma.AssetWhereInput = {
    cls, cost: { not: null },
    ...(cls === "IT" ? { itVerifiedAt: { not: null } } : {}),
    ...(status ? { status } : {}),
  };
```

- [ ] **Step 6: Home CHECK rows** — `src/lib/home.ts`: add `"CHECK"` to the `ShiftKind` union. `your-shift.tsx` `KIND_DOT`: `CHECK: "PENDING"`. In `yourShift` add to the `Promise.all` (after `orphaned`):

```ts
    // Phase 14 (spec §5.5): IT assets Purchasing registered, waiting for IT.
    prisma.asset.findMany({
      where: { cls: "IT", itVerifiedAt: null },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, createdAt: true },
    }),
```

destructure it as `awaiting`, and push rows after the `orphaned` loop:

```ts
  for (const a of awaiting) {
    rows.push({
      key: `CHECK:${a.id}`,
      kind: "CHECK",
      title: `${a.tag} · ${a.model}`,
      meta: `registered by Purchasing · ${daysSince(a.createdAt, now)} d waiting`,
      href: `/inventory/${a.id}`,
      action: "Check",
      severity: daysSince(a.createdAt, now),
    });
  }
```

If a test in `src/lib/home.test.ts` enumerates `ShiftKind` values, extend it.

- [ ] **Step 7: Verify** `npm run typecheck && npm run lint && npm test` → clean. Dev server: as `purchasing@` register a Laptop on `/inventory/register`; open it → AWAITING IT CHECK, Edit present, no Confirm for `finance@`, absent from Finance's IT tab; `it@` Home shows a CHECK row; Mark checked → AWAITING FINANCE; `finance@` lists and confirms.

- [ ] **Step 8: Commit** `feat(phase-14): the IT check -- verifyAssetDetails, record pill and button, Finance waits for it, Home CHECK rows`

---

### Task 7: Approvals by class

**Files:** `src/server/modules/approvals/queries.ts:22-55` · `src/server/modules/approvals/actions.ts:31-58` · `src/app/(app)/approvals/page.tsx:17-20` · `src/app/(app)/approvals/[id]/page.tsx:22, 74` · `src/components/shell/sidebar.tsx:14-22` · `src/app/(app)/layout.tsx:18` · `src/server/modules/home/queries.ts` (`yourShift` breached/failed, `claimedByYou`) · `src/app/(app)/page.tsx` (their callers)

- [ ] **Step 1: Queries** — `listApprovals(tab, userId, role)` and `tabCounts(userId, role)` AND `approvalClassWhere(role)`:

```ts
    where: { AND: [tabWhere(tab, userId), approvalClassWhere(role)] },
```

- [ ] **Step 2: Actions** — `transition()` head:

```ts
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
```

and inside the transaction load `asset: { select: { cls: true } }` in the `select`, then before the pure transition:

```ts
    // Phase 14: the approver is whoever manages the asset's class; a class-less
    // approval (no asset) is any approver's to reject.
    if (!canActOnApproval(user.role, approval.asset?.cls ?? null)) return forbidden();
```

- [ ] **Step 3: Pages** — list: `const canAct = isApprover(user.role);` and pass `user.role` to both queries. Detail: `const canAct = canActOnApproval(user.role, approval.asset?.cls ?? null);` and replace the asset `<Link>` (line 73-76) with `<TagRef id={approval.asset.id} tag={`${approval.asset.tag} · ${approval.asset.model}`} visible={canSeeClass(user.role, approval.asset.cls)} className="text-accent hover:underline" />`.

- [ ] **Step 4: Badge** — `getApprovalsBadge(role: Role)` ANDs `approvalClassWhere(role)` into both counts; `layout.tsx:18` passes `user.role`.

- [ ] **Step 5: Home** — `yourShift(userId, role, now?)` ANDs the scope into the `breached` and `failed` queries; `claimedByYou(userId, role)` likewise; `page.tsx` passes `user.role` to both.

- [ ] **Step 6: Verify** `npm run typecheck && npm run lint` → clean; `npx playwright test e2e/approvals-audit.spec.ts` → PASS with unchanged counts (`APR-2041`, `APR-2039` match by class; `APR-2040` by having no asset).

- [ ] **Step 7: Commit** `feat(phase-14): approvals queue, badge, Home rows and actions scoped to the classes a role manages`

---

### Task 8: `requestAssign` / `requestReturn` by class

**Files:** `src/server/modules/employees/actions.ts:24-31, 96-103`

- [ ] **Step 1:** Both actions: `const user = await actionUser(); if (!user || !isApprover(user.role)) return forbidden();` and after each `if (!asset) return conflict(…)`: `if (!canManageClass(user.role, asset.cls)) return forbidden();`. Add `revalidatePath(`/inventory/${d.assetId}`)` to both. Imports: `actionUser`, `canManageClass`, `isApprover`. `requestAssignReserved` and `updateEmployee` keep `actionRole("admin","it_staff")`.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → clean.
- [ ] **Step 3: Commit** `feat(phase-14): assign and return refuse by the asset's class`

---

### Task 9: `<HolderControl>` and tag-as-text on person pages

**Files:**
- Create: `src/components/inventory/holder-control.tsx`
- Modify: `src/server/modules/employees/queries.ts` (append `activeEmployeeOptions`)
- Modify: `src/app/(app)/inventory/[id]/layout.tsx` (actions)
- Modify: `src/app/(app)/employees/[id]/page.tsx:48-56, 70-90`, `src/components/employees/loadout-view.tsx` (types + lines 265, 283, 299)
- Modify: `src/app/(app)/offboarding/[employeeId]/page.tsx:200, 418`

- [ ] **Step 1: Query**

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

- [ ] **Step 2: Component**

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
 * Phase 14 (spec §7): assign / return from the asset itself, so a department
 * without IT's loadout view can hand a car to a driver and take it back. Same
 * two actions the loadout calls; the same approvals result.
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
  const isAssign = props.mode === "assign";

  function close() {
    setOpen(false); setReason(""); setEmployeeId(null); setError(null); setFieldErrors({});
  }

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = props.mode === "assign"
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
            {isAssign
              ? <>Creates a <span className="font-mono">lifecycle.assign</span> approval; {props.tag} stays where it is until it executes.</>
              : <>Creates a <span className="font-mono">lifecycle.return</span> approval; {props.tag} stays with {props.holder.name} until it executes.</>}
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          {isAssign && (
            <FormField label="Assign to" required error={fieldErrors.employeeId}>
              {(p) => (
                <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  options={props.employees} value={employeeId} onChange={setEmployeeId} placeholder="Type a name or EMP number…" />
              )}
            </FormField>
          )}
          <FormField label="Reason" required={!isAssign} error={fieldErrors.reason}>
            {(p) => <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Layout wiring** — after `const pending = asset.approvals[0];`:

```ts
  // Spec §7.1: offered only when the action would be legal; a pending approval
  // freezes both (the server would answer "already has an open request").
  const canAssign = canMutate && !pending && !asset.assignee && asset.status === ASSIGNABLE_FROM[asset.cls];
  const canReturn = canMutate && !pending && asset.assignee !== null;
  const employees = canAssign ? await activeEmployeeOptions() : [];
```

and in the actions, before `RequestStatusChange`:

```tsx
              {canAssign && <HolderControl mode="assign" assetId={asset.id} tag={asset.tag} employees={employees} />}
              {canReturn && asset.assignee && (
                <HolderControl mode="return" assetId={asset.id} tag={asset.tag} holder={{ id: asset.assignee.id, name: asset.assignee.name }} />
              )}
```

- [ ] **Step 4: Loadout tag-as-text** — `loadout-view.tsx`: add `visible: boolean` to the tile asset type and to `HoldingItem`; replace the three `<Link href={`/inventory/…`}>` at lines 265, 283 and 299 with `<TagRef id={…} tag={…} visible={….visible} className={…the existing className…} />`. In `employees/[id]/page.tsx`: `toTileAsset` adds `visible: canSeeClass(user.role, a.cls)`; the `reservations` holding adds `visible: canSeeClass(user.role, r.asset.cls)`; the `queued` holding adds `visible: canSeeClass(user.role, a.asset!.cls)`; the `held` table rows likewise (`held` rows carry `cls`).

- [ ] **Step 5: Offboarding tag-as-text** — `offboarding/[employeeId]/page.tsx:200` and `:418`: replace the `<Link>` with `<TagRef id={i.assetId} tag={i.tag} visible={canSeeClass(user.role, i.cls)} className="text-accent hover:underline" />`. The wizard's items carry `cls` (offboarding/queries.ts selects it at lines 228, 277, 285); if a mapped item type lacks it, add `cls` to that mapping from the already-selected asset.

- [ ] **Step 6: Verify** `npm run typecheck && npm run lint` → clean. Dev: `purchasing@` on `BR-VH-0002` → **Assign holder**; on `BR-VH-0001` → **Return**; `it@` on Dennis's page (`EMP-0090`) still sees his three IT items as links.

- [ ] **Step 7: Commit** `feat(phase-14): Assign holder / Return on the record; invisible tags render as text on person pages`

---

### Task 10: Documents by class

**Files:** `src/server/modules/inventory/document-actions.ts:30-33, 49-50, 81-88` · `src/app/(app)/inventory/[id]/documents/page.tsx:33`

- [ ] **Step 1:** Both actions: `const user = await actionUser(); if (!user || !isApprover(user.role)) return forbidden();`. `uploadDocument`: after the asset load, `if (!canManageClass(user.role, asset.cls)) return forbidden();`. `markDocumentSigned`: load with `include: { asset: { select: { cls: true } } }` and `if (!canManageClass(user.role, doc.asset.cls)) return forbidden();` before the idempotent return. Page: `canMutate={canManageClass(user.role, asset.cls)}`.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → clean.
- [ ] **Step 3: Commit** `feat(phase-14): documents upload and sign follow the asset's class`

---

### Task 11: Categories and types by class

**Files:** `src/server/modules/admin/reference-actions.ts` · `src/components/admin/ref-table.tsx:28-48, 103-110` · `src/app/(app)/admin/{asset-categories,asset-types}/page.tsx`

- [ ] **Step 1: Actions** — imports `Prisma, type AssetClass, type Role`, `actionRole, actionUser`, `MANAGEABLE_CLASSES, canManageClass`; helpers:

```ts
/** Spec §9: the class a role creates a category in — its own for a single-class role, a pick for admin, nothing for the rest. */
function classFor(role: Role, requested: AssetClass | undefined): AssetClass | null {
  const mine = MANAGEABLE_CLASSES[role];
  if (mine.length === 0) return null;
  if (mine.length === 1) return mine[0];
  return requested ?? mine[0];
}

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

`createRefRow` head:

```ts
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, name, categoryId } = parsed.data;

  if (entity === "department" && user.role !== "admin" && user.role !== "it_staff") return forbidden();
  const cls = entity === "category" ? classFor(user.role, parsed.data.cls) : null;
  if (entity === "category" && cls === null) return forbidden();
  if (entity === "type") {
    if (!categoryId) return validationError({ categoryId: "Pick a category" });
    const category = await prisma.assetCategory.findUnique({ where: { id: categoryId }, select: { cls: true } });
    if (!category) return validationError({ categoryId: "That category no longer exists" });
    if (!canManageClass(user.role, category.cls)) return forbidden();
  }
```

then the create writes `cls: cls!` for categories and the audit diff uses `cls`. `renameRefRow` and `deleteRefRow`: `actionUser` head; `const row = await loadRow(entity, id); if (!row) return conflict("That row no longer exists."); if (!mayTouch(user.role, entity, row.cls)) return forbidden();` before the locked check (rename) and before the in-use checks (delete).

- [ ] **Step 2: `RefTable`** — prop `fixedCls?: AssetClass`; `useState<AssetClass>(fixedCls ?? ASSET_CLASSES[0])`; the class cell renders text when fixed:

```tsx
                {fixedCls ? (
                  <span className="font-mono text-[10.5px] text-fg-muted" aria-label="Class for the new category">{CLASS_LABEL[fixedCls].toUpperCase()}</span>
                ) : ( /* existing Select */ )}
```

- [ ] **Step 3: Pages** — categories: `requireRole("admin","it_staff","purchasing_staff")`, `const mine = MANAGEABLE_CLASSES[user.role]`, `where: { cls: { in: [...mine] } }`, `fixedCls={mine.length === 1 ? mine[0] : undefined}`. Types: same role set; rows `where: { category: { cls: { in: mine } } }`; categories `where: { locked: false, cls: { in: mine } }`.

- [ ] **Step 4:** `npm run typecheck && npm run lint` → clean; `npx playwright test e2e/asset-classes.spec.ts -g "12\."` → PASS (admin keeps the picker).
- [ ] **Step 5: Commit** `feat(phase-14): each department creates, renames and deletes categories and types of its own class`

---

### Task 12: Labels

**Files:** `src/app/(app)/inventory/labels/page.tsx:16-21, 33-35, 72` · `src/components/inventory/bulk-drawer.tsx:36-46` · `e2e/labels.spec.ts:156`

- [ ] **Step 1:** `const user = await requireRole("admin","it_staff","purchasing_staff");` query `where: { id: { in: ids }, cls: { in: [...MANAGEABLE_CLASSES[user.role]] } }`; banner copy → `${missing} selected asset${…} could not be printed and ${…} skipped.`; update its comment. Bulk drawer: drop `&& cls === "IT"` and rewrite the comment (the page admits both departments and prints what the role manages). `labels.spec.ts:156` → `"1 selected asset could not be printed and was skipped."`.
- [ ] **Step 2:** `npx playwright test e2e/labels.spec.ts` → PASS.
- [ ] **Step 3: Commit** `feat(phase-14): label sheets for whichever classes the role manages`

---

### Task 13: `/employees/new`

**Files:** `src/server/modules/employees/actions.ts` (append) · `src/components/employees/employee-form.tsx` · `src/app/(app)/employees/new/page.tsx` (new) · `src/app/(app)/employees/[id]/edit/page.tsx:26` · `src/app/(app)/employees/page.tsx:56, 131-135`

- [ ] **Step 1: Action**

```ts
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");

const createEmployeeSchema = employeeSchema.omit({ id: true }).extend({
  // No format rule: Employee.employeeNo has none anywhere and the importer
  // (import-employees.ts, E-2) refuses to invent one. Uniqueness is
  // case-insensitive, matching the importer's refKey.
  employeeNo: z.string().trim().min(1, "Give an employee number").max(60),
  joinedAt: dateStr,
});

/** Phase 14 (spec §11): the first manual create path — before this, employees arrived only by import or seed. */
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return validationError({ employeeNo: "That employee number is already in use" });
    }
    throw err;
  }
  revalidatePath("/employees");
  return ok({ id });
}
```

- [ ] **Step 2: Form** — props become a union on `mode`:

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
  const initial: Initial = props.mode === "edit"
    ? props.initial
    : { name: "", title: "", departmentId: departments[0]?.id ?? "", employment: "ACTIVE", m365Status: null };
  // … existing hooks; add `employeeNo: ""` and `joinedAt: today()` to the form state
```

`submit`:

```ts
      const common = { name: form.name, title: form.title, departmentId: form.departmentId, employment: form.employment, m365Status };
      const res = props.mode === "edit"
        ? await updateEmployee({ id: props.employeeId, ...common })
        : await createEmployee({ ...common, employeeNo: form.employeeNo, joinedAt: form.joinedAt });
      if (res.ok) {
        if (props.mode === "new") { router.push(`/employees/${res.data.id}`); return; }
        setSaved(true); setTimeout(() => setSaved(false), 3000); router.refresh();
      }
```

In the "Person" card, before Name, only in `new` mode:

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

Submit label: `{props.mode === "new" ? "Create employee" : saved ? "✓ Saved" : "Save changes"}`.

- [ ] **Step 3: Pages** — edit page passes `mode="edit"`. New page:

```tsx
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

List page: after Import, `{canMutate && <ButtonLink variant="primary" href="/employees/new">New employee</ButtonLink>}`; empty state description `"Add one with New employee, or import a sheet."` with action `href="/employees/new"`.

- [ ] **Step 4:** `npm run typecheck && npm run lint` → clean; dev: create `EMP-9001`, then `emp-9001` → field error.
- [ ] **Step 5: Commit** `feat(phase-14): /employees/new -- employeeNo unique case-insensitively`

---

### Task 14: Purchasing Home stats

**Files:** `src/server/modules/home/queries.ts` (`PurchasingHome`, `purchasingHome`) · `src/app/(app)/page.tsx` (purchasing grid)

- [ ] **Step 1:** Interface adds `approvalsWaiting: number; awaitingItCheck: number;`. `purchasingHome(userId, role, now?)` adds two counts to its `Promise.all`:

```ts
    prisma.approval.count({ where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] } }, approvalClassWhere(role)] } }),
    prisma.asset.count({ where: { cls: "IT", itVerifiedAt: null } }),
```

and returns them. Caller: `purchasingHome(user.id, user.role)`.

- [ ] **Step 2:** Grid `grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6` with two more stats:

```tsx
                  <Stat label="Approvals waiting" value={<Link href="/approvals" className="hover:underline">{d.approvalsWaiting}</Link>} hint="lifecycle changes on your assets" />
                  <Stat label="Awaiting IT check" value={d.awaitingItCheck} hint="IT assets you registered" />
```

- [ ] **Step 3:** `npm run typecheck && npm run lint` → clean. **Commit** `feat(phase-14): Purchasing Home counts approvals waiting and IT checks pending`

---

### Task 15: End-to-end

**Files:** `e2e/asset-classes.spec.ts` (cases 2, 10, 17, 18) · `e2e/axe-sweep.spec.ts:97-118` · Create `e2e/department-owned.spec.ts`

- [ ] **Step 1: Flip the Phase 13 cases**

Case 2 (line 94-102): title → `"2. Purchasing is offered both classes' categories; IT only its own (Phase 14)"`; line 100 → `expect(options).toContain("Laptop");`.

Case 10 (line 271-302): the first half runs as **`purchasing@`** (line 272 email), asserting the car and the Filters panel exactly as written; then append, before the class-switch clicks:

```ts
    // Phase 14: IT cannot ask for the Purchasing view at all.
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?cls=PURCHASING");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Asset class" })).toHaveCount(0);
    await login(page, "purchasing@thebackroomop.com");
```

and keep the `?status=SPARE` → switch → `cls=PURCHASING` tail as `purchasing@`.

Case 17 (line 369-385): the `it@` half (lines 370-373) becomes: `await page.goto(`/inventory/${carId}/edit`)` then the same not-found assertion case 5 uses at line 142. The `purchasing@` half is unchanged (`BR-LT-0148` is seeded checked, so Edit redirects to the record).

Case 18 (line 391-392): `expect(options).toContain("Laptop");`.

- [ ] **Step 2: axe** — `IT_STAFF_ROUTES` + `"/employees/new"`; `PURCHASING_STAFF_ROUTES` + `"/approvals", "/employees", "/admin/asset-categories", "/admin/asset-types", "/inventory?cls=PURCHASING"`; remove `"/inventory?cls=PURCHASING"` from `VIEWER_STATIC_ROUTES`.

- [ ] **Step 3: The new spec** — write `e2e/department-owned.spec.ts` with the header, `login`, `idOf` and `runWorkerOnce` helpers exactly as in `asset-classes.spec.ts`, and these cases. Selectors verified against the components in this plan: buttons **Assign holder** / **Return** / **Mark checked** / **Confirm details** / **Edit**; dialogs **Assign a holder** / **Request a return**; `Document kind` select, `input[type="file"]`, **Mark signed**; `New category name`, `New type name`, `Class for the new category`, `Category for the new type`; the queue `getByRole("group", { name: /Approval queue/ })`.

```ts
test.describe.serial("Purchasing owns its approvals", () => {
  test("1. request → Purchasing's queue, not IT's → claim → approve → worker executes", async ({ page }) => {
    const id = await idOf("BR-VH-0002");
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("REPAIRING");
    await page.getByLabel("Reason").fill("e2e — brake pads");
    await page.getByRole("dialog", { name: "Request a status change" }).getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const refNo = (await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } })).refNo;
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: new RegExp(refNo) })).toBeVisible();
    await login(page, IT);
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: new RegExp(refNo) })).toHaveCount(0);
    await login(page, P);
    await page.goto("/approvals");
    await page.getByRole("link", { name: refNo }).click();
    await expect(page.getByRole("heading", { name: refNo })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText(`${refNo} claimed`)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${refNo} approved`)).toBeVisible();
    runWorkerOnce();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("REPAIRING");
    expect((await db.approval.findUniqueOrThrow({ where: { refNo } })).state).toBe("EXECUTED");
  });
  test("2. IT cannot act on a Purchasing approval, even by URL", …)   // as drafted in the previous plan version
  test("3. admin's queue shows both classes", …)
});
test.describe.serial("Assign holder / Return", () => { test("4. …") ; test("5. …") });
test.describe("documents by class", () => { test("6. …") });
test.describe.serial("categories and types by class", () => { test("7. …") });
test.describe("labels", () => { test("8. …") });
test.describe.serial("new employee", () => { test("9. …"); test("10. …") });
test.describe("Purchasing Home", () => { test("11. Approvals waiting and Awaiting IT check", …) });

test.describe("visibility", () => {
  test("12. IT is redirected off the Purchasing view, cannot open a car, and the scan card says so", async ({ page }) => {
    const car = await idOf("BR-VH-0001");
    await login(page, IT);
    await page.goto("/inventory?cls=PURCHASING");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole("navigation", { name: "Asset class" })).toHaveCount(0);
    await page.goto(`/inventory/${car}`);
    await expect(page.getByText(/not found/i)).toBeVisible();
    await page.goto("/inventory/scan/BR-VH-0001");
    await expect(page.getByText("BR-VH-0001 is not in your register.")).toBeVisible();
    await login(page, P);
    await page.goto(`/inventory/${car}`);
    await expect(page.getByRole("heading", { name: "BR-VH-0001" })).toBeVisible();
    await page.goto("/inventory/scan/BR-VH-0001");
    await expect(page.getByRole("button", { name: "Open full record" }).or(page.getByRole("link", { name: "Open full record" }))).toBeVisible();
  });
});

test.describe.serial("the register flow: Purchasing → IT → Finance", () => {
  let tag = "";
  let id = "";
  test("13a. Purchasing registers a laptop; it awaits IT; Purchasing can still edit", async ({ page }) => {
    tag = tagOf("LT", (await highestNumber("LT")) + 1);
    await login(page, P);
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("ThinkPad T14 Gen 5 (e2e)");
    await page.getByLabel("Quantity").fill("1");
    await expect(page.getByLabel("Tag 1")).toHaveValue(tag);
    await page.getByRole("button", { name: "Register asset" }).click();
    await page.waitForURL((url) => url.pathname === "/inventory");
    const a = await db.asset.findUniqueOrThrow({ where: { tag } });
    id = a.id;
    expect(a.cls).toBe("IT");
    expect(a.itVerifiedAt).toBeNull();
    await page.goto(`/inventory/${id}`);
    await expect(page.getByText("AWAITING IT CHECK")).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Model").fill("ThinkPad T14 Gen 5 (e2e, corrected)");
    await page.getByRole("button", { name: /Save/ }).click();
    await expect(page.getByText(/Saved|saved/)).toBeVisible();
  });
  test("13b. Finance cannot see or confirm it yet", async ({ page }) => {
    await login(page, FIN);
    await page.goto("/finance/assets");
    await expect(page.getByRole("link", { name: tag })).toHaveCount(0);
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("button", { name: "Confirm details" })).toHaveCount(0);
  });
  test("13c. IT's Home lists it under CHECK; IT marks it checked; Purchasing's Edit is gone", async ({ page }) => {
    await login(page, IT);
    await page.goto("/");
    await expect(page.getByText(new RegExp(tag))).toBeVisible();
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Mark checked" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark checked" }).click();
    await expect(page.getByText(/checked — Finance can see it now/)).toBeVisible();
    await expect(page.getByText("AWAITING FINANCE")).toBeVisible();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).itVerifiedAt).not.toBeNull();
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });
  test("13d. Finance now lists and confirms it", async ({ page }) => {
    await login(page, FIN);
    await page.goto("/finance/assets");
    await expect(page.getByRole("link", { name: tag })).toBeVisible();
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Confirm details" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText(/FINANCE CONFIRMED/)).toBeVisible();
  });
});
```

Where a case says "as drafted in the previous plan version", the full bodies are in git at `600949c:docs/superpowers/plans/2026-09-07-phase-14-department-owned-classes.md` Task 11 — copy them verbatim, then apply one change to case 5: the laptop `BR-LT-0148` is seeded checked, so Purchasing has **no** Edit link (assert `toHaveCount(0)`). Constants: `P`, `IT`, `ADMIN`, `FIN` = the four seed emails; `tagOf`/`highestNumber` copied from `asset-classes.spec.ts:43-48`.

- [ ] **Step 4: Run** `npx playwright test e2e/department-owned.spec.ts e2e/asset-classes.spec.ts` → PASS. Fix selectors against the rendered DOM in the **test**, recording each as a `D-` amendment at the top of this plan.

- [ ] **Step 5: The whole battery** — `npm run typecheck && npm run lint && npm test && npx playwright test`. Record exact counts in the commit body.

- [ ] **Step 6: Commit** `test(phase-14): department-owned e2e; Phase 13 cases 2/10/17/18 flipped for asymmetric visibility`

---

### Task 16: The record

**Files:** `docs/PICKUP.md` §1, §3, §4, §5 · `docs/HANDOVER.md` §8 Phase 13 block (≈2476) and §7 migration count · the spec's **Status** line

- [ ] **Step 1: PICKUP** — §1: migrations 14 → 15; battery numbers from Task 15; "Last two phases" → Phase 13 and Phase 14 summaries. §3: replace the "Each class is registered…" bullet with: "**IT sees and manages IT assets only. Purchasing sees everything, registers both classes and manages Purchasing assets. A Purchasing-registered IT asset is IT's and waits for IT's check before Finance sees it. Finance confirms everything.** Offboarding stays IT-run and shared; the class owner approves the return. Person-centric pages show every class, with invisible tags as text. (Phase 14.)" §4: item 3 → Phase 15 candidates: the depreciation module (user's choice, own brainstorm), Purchasing bulk import, an unassigned-holder detector for Purchasing, the year-chip empty state, one markup for the class switches. §5: drop the D-19 bullet; add "`/audit` and `/inventory/activity` exclude invisible assets by id list — fine while the Purchasing fleet is small; revisit if it grows past a few thousand rows."
- [ ] **Step 2: HANDOVER** — §8: strike the closed items (Purchasing-owned approvals, assign/return surface, class-aware documents, Purchasing label sheet, D-19 real-approve gap); add "**Phase 14** closed the above on YYYY-MM-DD; spec `2026-09-07-department-owned-classes-design.md`." §7: migration count 15.
- [ ] **Step 3: Spec Status** → "implemented on branch `phase-14-department-owned-classes`, YYYY-MM-DD; amendments, if any, are `D-` entries at the top of the plan."
- [ ] **Step 4: Commit** `docs(phase-14): PICKUP, HANDOVER and spec status reflect department-owned classes`

Then stop. Merging and pushing are the user's decisions.

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §2 three maps, invariant, helpers | 1 |
| §3.1 list, record, export, palette, scan, activity, audit | 4 |
| §3.3 person pages, `<TagRef>` | 9 (loadout, offboarding), 7 (approval detail) |
| §4 registration, stamping, import wizard | 5 |
| §5.2 action · §5.3 Finance gate · §5.4 `canEditAsset` · §5.5 surfaces | 6 (action, pill, button, Finance query/confirm, CHECK rows), 4 & 5 (edit page / `updateAsset`), 14 (Purchasing stat) |
| §6 approvals, badge, Home rows, no-asset rule | 1, 7 |
| §7 HolderControl, guards, directory reads | 8, 9, 3 |
| §8 documents | 10 |
| §9 reference data | 11 |
| §10 labels | 12 |
| §11 employee form | 13, 3 (path) |
| §12 paths and nav, class switch | 3, 4 |
| §13 migration and seed | 2 |
| §14.1 unit · §14.2 flips · §14.3 e2e · axe | 1, 3, 4 (audit-list), 6 (activity), 15 |
| §16 docs | 16 |

Type consistency: `canSeeClass`, `canRegisterClass`, `canEditAsset`, `isAwaitingItCheck`, `visibleClassWhere` (Task 1) are the names used in Tasks 4–7, 9, 14; `getVisibleAsset(id, role)` and `invisibleAssetIds(role)` (Task 4) are the only new query names; `TagRef` props `{ id, tag, visible, className? }` everywhere; `listApprovals(tab, userId, role)`, `tabCounts(userId, role)`, `getApprovalsBadge(role)`, `yourShift(userId, role, now?)`, `claimedByYou(userId, role)`, `purchasingHome(userId, role, now?)` each have exactly one caller updated in their task; `buildAuditWhere(state, hiddenAssetIds = [])` keeps every existing single-argument caller valid.
