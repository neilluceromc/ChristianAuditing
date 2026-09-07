# Phase 15 — Direct IT Lifecycle, Replace, Triage and the Worklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IT's lifecycle changes on IT assets (status, assign, return, replace, bulk, deploy-at-creation, offboarding decisions) apply the moment IT confirms them, recorded as already-EXECUTED approvals plus audit; a returned device waits for triage before it is a spare again; IT's Home becomes an ordered worklist with a full page at `/inventory/work`. Purchasing keeps its queue.

**Architecture:** One map (`DIRECT_LIFECYCLE_CLASSES = ["IT"]`) and one predicate (`isDirectLifecycle`) decide who bypasses the queue. The worker's live guards and asset write move into `src/server/modules/lifecycle/apply.ts` as `prepareLifecycle` (guards → planned updates + diff) and `commitLifecycle` (the write); the worker and the new direct actions both call them, so the rules cannot drift. Direct actions live in `src/server/modules/lifecycle/actions.ts` and record each change as an `EXECUTED` approval row, an asset audit entry, and the `approval.executed` webhook. `Asset.returnedAt` (one additive migration) plus `isAssignable()` keep an untriaged device out of the spare pool everywhere. `src/lib/worklist.ts` groups Home rows into fixed sections.

**Tech Stack:** Next.js 15 App Router · Prisma 6 / PostgreSQL 16 · vitest (node env, pure `src/lib`) · Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-direct-it-lifecycle-design.md` — read §1 (decisions, especially row 3: an EXECUTED approval row is the record), §2 (executor and actions), §4 (`returnedAt`, `isAssignable`), §5 (worklist), §6 (offboarding).

**Baselines on `main` at `a3b7b05`:** 971 unit / 52 files · 203 e2e / 15 files · `tsc` and `lint` clean · 15 migrations, none pending. Verify before Task 1 and correct these numbers if they differ.

> ### AMENDED DURING EXECUTION — D-1 through D-8
>
> **D-1. Task 4 replaceAsset refusal handling:** originally `return`ed a second-leg refusal inside the transaction, which would have committed the first leg — fixed to throw a `DirectRefusal` and convert to `conflict` outside. Lesson: inside `prisma.$transaction`, a refusal after a write must throw, not return.
>
> **D-2. Task 6 create form class prop:** replaced the static `direct` boolean prop with `directClasses` because admin switches category between classes client-side, so the direct-mode disclosure must update live.
>
> **D-3. Task 6 loadout tile DOM:** restructured to avoid an axe `nested-interactive` violation (interactive elements nested inside `<label>` with no `pointer-events: none` on the outer).
>
> **D-4. Task 9 scanner.spec.ts "already decided" verdict:** a direct IT decision clears the holder at once, so a re-scan of that same tag cannot find it in the held array. Adapted the test's scenario to use a Purchasing-class car (same technique as `asset-classes.spec.ts` case 8) — Purchasing returns still QUEUE, so the asset stays held with a PENDING decision, and the "held AND decided" state the verdict needs is genuinely reachable. The "already decided" verdict is now unreachable for IT items post-Phase-15; filed `task_4e151341` for a product decision.
>
> **D-5. Commit fceecbf e2e count error:** the message claimed "264 e2e tests passed"; the correct figure after Task 9 is **213 e2e tests across 16 spec files**. Reason: the 98-test "Step A+B combined" row was a re-run of already-counted tests, not additional ones. The true total is 31 · 67 · 46 · 36 · 33 = 213.
>
> **D-6. Task 9 locator ambiguities resolved at the DOM:** the Replace dialog's combobox is targeted by its label ("Replacement") because an adjacent `<select>` also matched `getByRole("combobox")`, and the offboarding wizard renders "Continue to Accounts" twice (mobile and desktop), so the test takes `.first()`. Lesson: a dialog with two form controls of the same role needs role+name, never role alone.
>
> **D-7. Task 9 spec row compliance — missing assertions:** cases 5, 7 and 8 asserted less than their spec rows specify (no zero-open-approvals check; DB state for one of three offboarding decisions; no section count). Fixed in the same task by adding the DB and count assertions. Lesson: an e2e case proves its spec row only when every clause of the row is an assertion, not a toast.
>
> **D-8. Final whole-branch review — three Important findings, plus polish:** (1) `createAsset`'s catch-all `if (err instanceof Error) return conflict(err.message)` turned every error — Prisma P2028, unknown request errors, genuine bugs — into a user-facing banner; fixed by throwing a module-local `DirectRefusal` at the direct branch and catching only that type, so everything else still falls through to `throw err`. Lesson: a catch that converts every `Error` into user copy masks 500s and can leak driver text. (2) `bulkChangeStatus`'s per-asset `recordDirect` loop ran inside one `$transaction` with no options; at `BULK_MAX` (200) it could exceed Prisma's 5s default. Fixed with `{ timeout: 60_000, maxWait: 10_000 }`. Lesson: a per-row loop inside one interactive transaction needs an explicit timeout once N is in the hundreds. (3) Home's fleet-coverage spare-pool query counted a returned-but-untriaged SPARE as available stock; fixed by adding `returnedAt: null` (spec §4.2 already names this site). Lesson: a hand-written query needs the same untriaged exclusion `isAssignable()` encodes, even where it isn't calling that predicate directly. Also in this pass: direct-dialog guard text now runs through a new `humanizeGuard()` (`src/lib/lifecycle.ts`, unit-tested) that strips the worker's `Execution guard:` framing so IT reads a plain sentence instead of retry-UI copy — the worker's stored `workerError` text is untouched; and worklist queue rows keep their old SLA → EXEC → LEAVE sub-order via a new optional `WorkRow.rank`, sorted before severity.

## Global Constraints

- **Exactly one migration**, `20260907100000_asset_returned_at`, hand-written, additive, no backfill. Never `prisma migrate dev` or `reset`; `npm run db:seed` is the sanctioned reset. Add no seed fixtures (`home-finance.spec.ts` pins the fleet at 25 IT assets).
- **Direct mode is decided by `isDirectLifecycle(role, cls)` and nothing else.** Purchasing-class assets keep every existing request action unchanged. `finance_staff`/`viewer` never reach any direct action.
- **The worker's guard messages do not change** (the retry UI shows them verbatim; `approvals-audit.spec.ts` asserts one).
- **Every direct change writes, in one transaction:** the asset update, an `Approval` in state `EXECUTED` (`requestedById = claimedById = actor`, `claimedAt = resolvedAt = now`, the same `type`/`payload` the request path would have written), an asset `AuditEntry` with `actorId` set and one of the five action strings `lifecycle.assign | lifecycle.return | lifecycle.change-status | lifecycle.replace | lifecycle.triage`, and `emitWebhook(tx, "approval.executed", …)` exactly as the worker does.
- **An open approval blocks direct actions** with *"`${tag}` is held by `${refNo}` — resolve it in Approvals first."*
- **`isAssignable(a)` replaces every bare `status === ASSIGNABLE_FROM[cls]` comparison** on assign paths and spare pickers.
- **Absent, not disabled.** Copy is sentence case and names the mechanism. Never `a ${CLASS_LABEL[cls]}`.
- **e2e:** rows by tag / employeeNo / category name / refNo read back from the DB, never a raw cuid; each spec reseeds in `beforeAll`; run with `E2E_PORT=3100 … --workers=1` in the foreground.
- **Commit after every task** on branch `phase-15-direct-it-lifecycle` from `main`; prefixes `feat(phase-15):`, `test(phase-15):`, `docs(phase-15):`. Never push. No new npm packages.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/asset-class.ts` (+test) | `DIRECT_LIFECYCLE_CLASSES`, `isDirectLifecycle`, `isAssignable` |
| `src/lib/lifecycle.ts` (+test) | `RETURN_OUTCOMES`, `TRIAGE_OUTCOMES`, `replacePlan` — pure |
| `prisma/migrations/20260907100000_asset_returned_at/`, `prisma/schema.prisma` | `Asset.returnedAt` |
| `src/server/modules/lifecycle/apply.ts` | `prepareLifecycle`, `commitLifecycle` — the one executor |
| `src/worker/execute-approval.ts` | calls the executor; messages unchanged |
| `src/server/modules/approvals/create.ts` | `createApproval` gains `executed?: { by, at }` |
| `src/server/modules/lifecycle/actions.ts` | `changeStatus`, `assignAsset`, `returnAsset`, `replaceAsset`, `triageAsset`, `bulkChangeStatus`, `assignReserved` |
| `src/lib/activity.ts` (+test), `src/components/patterns/activity-feed.tsx` | sentences and dots for the five actions |
| `src/server/modules/inventory/actions.ts`, `src/server/modules/employees/actions.ts`, `src/server/modules/offboarding/actions.ts` | request paths refuse direct classes; `createAsset` assigns inline; `decideItem` applies directly for IT |
| `src/components/inventory/{status-control,holder-control,replace-control,triage-control,bulk-drawer,asset-form}.tsx`, `src/app/(app)/inventory/[id]/layout.tsx` | record surfaces in direct mode |
| `src/components/employees/loadout-view.tsx`, `src/app/(app)/employees/[id]/page.tsx` | loadout in direct mode; spares via `isAssignable` |
| `src/components/offboarding/item-decision.tsx` | direct copy |
| `src/lib/worklist.ts` (+test), `src/lib/home.ts` (+test), `src/server/modules/home/queries.ts`, `src/components/home/worklist.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/inventory/work/page.tsx`, `src/lib/workspaces.ts` (+test) | the worklist |
| `e2e/direct-lifecycle.spec.ts` (new), `e2e/{it-core,offboarding,home-finance,axe-sweep}.spec.ts` | proof |
| `docs/PICKUP.md`, `docs/HANDOVER.md`, the spec's Status line | the record |

---

### Task 0: Branch and baseline

- [ ] `git checkout -b phase-15-direct-it-lifecycle main` (the controller creates the worktree and its `.env`).
- [ ] `npm run typecheck && npm run lint && npm test` → clean, `52 files / 971 tests`. Correct the Baselines line if different.

---

### Task 1: Pure rules — the direct map, `isAssignable`, `replacePlan`

**Files:**
- Modify: `src/lib/asset-class.ts` (append) · Test: `src/lib/asset-class.test.ts` (append)
- Create: `src/lib/lifecycle.ts`, `src/lib/lifecycle.test.ts`

**Interfaces — Produces:**
- `DIRECT_LIFECYCLE_CLASSES: readonly AssetClass[]`, `isDirectLifecycle(role, cls): boolean`
- `isAssignable(a: { cls: AssetClass; status: AssetStatus; returnedAt: Date | null }): boolean`
- `RETURN_OUTCOMES`, `ReturnOutcome = "TRIAGE" | "DEFECTIVE" | "MISSING" | "BUYOUT"`, `RETURN_OUTCOME_STATUS`, `RETURN_OUTCOME_LABEL`
- `TRIAGE_OUTCOMES`, `TriageOutcome = "SPARE" | "DEFECTIVE" | "DISPOSE" | "DONATED"`, `TRIAGE_LABEL`
- `replacePlan(old: { status: AssetStatus }, outcome: ReturnOutcome): { oldStatus: AssetStatus; newStatus: AssetStatus }`
- `reasonRequiredFor(outcome: ReturnOutcome): boolean`

- [ ] **Step 1: Tests — append to `asset-class.test.ts`**

```ts
import { DIRECT_LIFECYCLE_CLASSES, isAssignable, isDirectLifecycle } from "./asset-class";

describe("Phase 15 — direct lifecycle", () => {
  it("IT is the only direct class, and it is a real class", () => {
    expect(DIRECT_LIFECYCLE_CLASSES).toEqual(["IT"]);
    for (const c of DIRECT_LIFECYCLE_CLASSES) expect(ASSET_CLASSES).toContain(c);
  });
  it.each([
    ["admin", "IT", true], ["admin", "PURCHASING", false],
    ["it_staff", "IT", true], ["it_staff", "PURCHASING", false],
    ["purchasing_staff", "IT", false], ["purchasing_staff", "PURCHASING", false],
    ["finance_staff", "IT", false], ["viewer", "IT", false],
  ] as Array<[Role, "IT" | "PURCHASING", boolean]>)("isDirectLifecycle(%s, %s) → %s", (role, cls, expected) => {
    expect(isDirectLifecycle(role, cls)).toBe(expected);
  });
  it("direct implies manageable, for every role and class", () => {
    for (const r of ROLES) for (const c of ASSET_CLASSES) {
      if (isDirectLifecycle(r, c)) expect(canManageClass(r, c)).toBe(true);
    }
  });
  it("isAssignable: idle status AND not waiting for triage", () => {
    const d = new Date();
    expect(isAssignable({ cls: "IT", status: "SPARE", returnedAt: null })).toBe(true);
    expect(isAssignable({ cls: "IT", status: "SPARE", returnedAt: d })).toBe(false);
    expect(isAssignable({ cls: "IT", status: "DEPLOYED", returnedAt: null })).toBe(false);
    expect(isAssignable({ cls: "PURCHASING", status: "STORED", returnedAt: null })).toBe(true);
    expect(isAssignable({ cls: "PURCHASING", status: "OPERATIONAL", returnedAt: null })).toBe(false);
  });
});
```

(`ROLES` and `canManageClass` are already imported/defined in that file from Phase 14's tests; reuse them.)

- [ ] **Step 2: Tests — `src/lib/lifecycle.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  RETURN_OUTCOMES, RETURN_OUTCOME_STATUS, TRIAGE_OUTCOMES, reasonRequiredFor, replacePlan,
} from "./lifecycle";
import { RETURN_TARGETS } from "./asset-class";

describe("return outcomes", () => {
  it("map exactly onto RETURN_TARGETS.IT", () => {
    expect([...RETURN_OUTCOMES].map((o) => RETURN_OUTCOME_STATUS[o]).sort()).toEqual([...RETURN_TARGETS.IT].sort());
  });
  it("only MISSING requires a reason", () => {
    expect(RETURN_OUTCOMES.filter(reasonRequiredFor)).toEqual(["MISSING"]);
  });
  it("triage outcomes are the four dispositions", () => {
    expect(TRIAGE_OUTCOMES).toEqual(["SPARE", "DEFECTIVE", "DISPOSE", "DONATED"]);
  });
});

describe("replacePlan", () => {
  it("retires the old device by outcome and gives the new one the old holder status", () => {
    expect(replacePlan({ status: "DEPLOYED" }, "TRIAGE")).toEqual({ oldStatus: "SPARE", newStatus: "DEPLOYED" });
    expect(replacePlan({ status: "TEMPORARY" }, "DEFECTIVE")).toEqual({ oldStatus: "DEFECTIVE", newStatus: "TEMPORARY" });
    expect(replacePlan({ status: "DEPLOYED" }, "MISSING")).toEqual({ oldStatus: "MISSING", newStatus: "DEPLOYED" });
  });
  it("a device that is not held cannot be replaced", () => {
    expect(() => replacePlan({ status: "SPARE" }, "TRIAGE")).toThrow(/not held/);
  });
});
```

- [ ] **Step 3: Run** both files → FAIL (missing exports / module).

- [ ] **Step 4: Implement — append to `asset-class.ts`**

```ts
/**
 * Phase 15 (spec §2.1). Classes whose lifecycle changes APPLY ON CONFIRM for the
 * department that manages them, instead of waiting in the approval queue. IT
 * asked for it ("fast paced"); Purchasing kept its queue.
 */
export const DIRECT_LIFECYCLE_CLASSES = ["IT"] as const satisfies readonly AssetClass[];

export function isDirectLifecycle(role: Role, cls: AssetClass): boolean {
  return canManageClass(role, cls) && (DIRECT_LIFECYCLE_CLASSES as readonly AssetClass[]).includes(cls);
}

/**
 * Spec §4.2. The ONE assignability predicate: idle status for the class, and
 * not waiting for triage. Replaces every bare `status === ASSIGNABLE_FROM[cls]`.
 */
export function isAssignable(a: { cls: AssetClass; status: AssetStatus; returnedAt: Date | null }): boolean {
  return a.status === ASSIGNABLE_FROM[a.cls] && a.returnedAt === null;
}
```

- [ ] **Step 5: Implement — `src/lib/lifecycle.ts`**

```ts
import type { AssetStatus } from "@prisma/client";
import { HOLDER_STATUSES } from "./asset-class";

/**
 * Phase 15 (spec §1 rows 6–7). The words IT picks from when a device comes back
 * or gets triaged. TRIAGE lands on SPARE with `returnedAt` set — "back, not
 * checked" — and is the only outcome that does.
 */
export const RETURN_OUTCOMES = ["TRIAGE", "DEFECTIVE", "MISSING", "BUYOUT"] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

export const RETURN_OUTCOME_STATUS: Record<ReturnOutcome, AssetStatus> = {
  TRIAGE: "SPARE", DEFECTIVE: "DEFECTIVE", MISSING: "MISSING", BUYOUT: "BUYOUT",
};

export const RETURN_OUTCOME_LABEL: Record<ReturnOutcome, string> = {
  TRIAGE: "Back for triage", DEFECTIVE: "Defective", MISSING: "Missing", BUYOUT: "Buyout",
};

/** Custody lost opens an investigation; it needs a sentence. Everything else is routine. */
export function reasonRequiredFor(outcome: ReturnOutcome): boolean {
  return outcome === "MISSING";
}

export const TRIAGE_OUTCOMES = ["SPARE", "DEFECTIVE", "DISPOSE", "DONATED"] as const;
export type TriageOutcome = (typeof TRIAGE_OUTCOMES)[number];

export const TRIAGE_LABEL: Record<TriageOutcome, string> = {
  SPARE: "Keep as spare", DEFECTIVE: "Send to repair", DISPOSE: "Dispose", DONATED: "Donate",
};

/**
 * Spec §3. A replacement retires the old device by the chosen outcome and hands
 * the new one the SAME holder status the old one had (a loaner is replaced by a
 * loaner). Throws on a device nobody holds: there is nothing to replace.
 */
export function replacePlan(old: { status: AssetStatus }, outcome: ReturnOutcome): { oldStatus: AssetStatus; newStatus: AssetStatus } {
  if (!(HOLDER_STATUSES.IT as readonly string[]).includes(old.status)) {
    throw new Error(`replacePlan: ${old.status} is not held — nothing to replace`);
  }
  return { oldStatus: RETURN_OUTCOME_STATUS[outcome], newStatus: old.status };
}
```

- [ ] **Step 6: Run** → PASS. `npm test` green. **Commit** `feat(phase-15): DIRECT_LIFECYCLE_CLASSES, isAssignable, return/triage outcomes, replacePlan`

---

### Task 2: `Asset.returnedAt`

**Files:** `prisma/migrations/20260907100000_asset_returned_at/migration.sql` (new) · `prisma/schema.prisma`

- [ ] **Step 1: SQL**

```sql
-- Phase 15 (spec §4.1): a returned IT device is "back, not checked" until IT
-- triages it. Set when a return lands on SPARE; cleared by any later status
-- write. No backfill: nothing is mid-triage today. Purchasing assets never
-- carry a value (isAssignable/applyLifecycle include the class).
ALTER TABLE "Asset" ADD COLUMN "returnedAt" TIMESTAMP(3);
CREATE INDEX "Asset_returnedAt_idx" ON "Asset"("returnedAt");
```

- [ ] **Step 2: Schema** — after `itVerifiedBy … onDelete: Restrict)` in `Asset` add:

```prisma
  /// Phase 15: set when a return lands an IT device on SPARE; the device is
  /// "back, not checked" and leaves the spare pool until IT triages it, which
  /// clears this. Any other status write clears it too.
  returnedAt           DateTime?
```

and `@@index([returnedAt])` beside the other indexes.

- [ ] **Step 3: Apply** — `npx prisma migrate deploy && npx prisma generate && npm run db:seed` (the worktree `.env` targets `inventory_dev`; never `docker compose` here). `npx prisma migrate status` → none pending. `npm run typecheck` → clean.
- [ ] **Step 4: Commit** `feat(phase-15): Asset.returnedAt -- migration 16`

---

### Task 3: The one executor, and the worker on top of it

**Files:**
- Create: `src/server/modules/lifecycle/apply.ts`
- Modify: `src/worker/execute-approval.ts:62-165`
- Modify: `src/server/modules/approvals/create.ts:17-41`

**Interfaces — Produces:**

```ts
export type LifecycleAsset = { id: string; tag: string; cls: AssetClass; status: AssetStatus; assigneeId: string | null; defectiveSince: Date | null; returnedAt: Date | null };
export type LifecycleChange =
  | { kind: "assign"; employeeId: string; status: AssetStatus }
  | { kind: "return"; status: AssetStatus }
  | { kind: "change-status"; status: AssetStatus };
export type Prepared = { updates: Prisma.AssetUpdateInput; diff: AuditDiff; settleReservationFor: string | null };
export async function prepareLifecycle(tx, asset: LifecycleAsset, change: LifecycleChange, now?: Date): Promise<{ ok: true; prepared: Prepared } | { ok: false; error: string }>
export async function commitLifecycle(tx, assetId: string, prepared: Prepared, now?: Date): Promise<void>
```
`createApproval(tx, input & { executed?: { by: string; at: Date } })`.

- [ ] **Step 1: `apply.ts`**

```ts
import type { AssetClass, AssetStatus, Prisma } from "@prisma/client";
import type { AuditDiff } from "@/lib/audit-diff";
import {
  DEFAULT_STATUS, DIRECT_LIFECYCLE_CLASSES, HOLDER_STATUSES, ASSIGNABLE_FROM, isAssignable,
} from "@/lib/asset-class";

export type LifecycleAsset = {
  id: string; tag: string; cls: AssetClass; status: AssetStatus;
  assigneeId: string | null; defectiveSince: Date | null; returnedAt: Date | null;
};

export type LifecycleChange =
  | { kind: "assign"; employeeId: string; status: AssetStatus }
  | { kind: "return"; status: AssetStatus }
  | { kind: "change-status"; status: AssetStatus };

export interface Prepared {
  updates: Prisma.AssetUpdateInput;
  diff: AuditDiff;
  /** the recipient whose ACTIVE reservation on this asset gets FULFILLED, if any */
  settleReservationFor: string | null;
}

export type PrepareResult = { ok: true; prepared: Prepared } | { ok: false; error: string };

/**
 * Phase 15 (spec §2.2). THE lifecycle executor's guards and planned write, shared
 * by the worker (executing an approval) and the direct actions (IT confirming a
 * change). Guard messages are the worker's, verbatim: the retry UI shows them.
 * Writes nothing — commitLifecycle does — so the worker can claim its approval
 * row between the two and a failed claim never leaves a written asset behind.
 */
export async function prepareLifecycle(
  tx: Prisma.TransactionClient,
  asset: LifecycleAsset,
  change: LifecycleChange,
  now: Date = new Date(),
): Promise<PrepareResult> {
  const updates: Prisma.AssetUpdateInput = { status: change.status };
  const diff: AuditDiff = {};
  let settleReservationFor: string | null = null;
  let assigneeLabelFrom: string | null = null;
  let assigneeLabelTo: string | null = null;

  if (change.kind === "assign") {
    const employee = await tx.employee.findUnique({ where: { id: change.employeeId } });
    if (!employee) return { ok: false, error: "Execution guard: target employee no longer exists — assignment refused" };
    if (employee.employment !== "ACTIVE") {
      return { ok: false, error: `Execution guard: target employee ${employee.employeeNo} is ${employee.employment} — assignment refused` };
    }
    if (!isAssignable(asset)) {
      return {
        ok: false,
        error: asset.returnedAt
          ? `Execution guard: ${asset.tag} is back but not yet triaged — assignment refused`
          : `Execution guard: ${asset.tag} reads ${asset.status}, not ${ASSIGNABLE_FROM[asset.cls]} — assignment refused`,
      };
    }
    const hold = await tx.reservation.findFirst({
      where: { assetId: asset.id, state: "ACTIVE" },
      include: { employee: { select: { id: true, employeeNo: true } } },
    });
    if (hold && hold.employeeId !== change.employeeId) {
      return { ok: false, error: `Execution guard: ${asset.tag} is reserved for ${hold.employee.employeeNo} — release the hold first` };
    }
    updates.assignee = { connect: { id: change.employeeId } };
    assigneeLabelTo = employee.employeeNo;
    settleReservationFor = change.employeeId;
  }

  if (change.kind === "return") {
    if (!asset.assigneeId) return { ok: false, error: `Execution guard: ${asset.tag} is not held by anyone — return refused` };
    const holder = await tx.employee.findUnique({ where: { id: asset.assigneeId }, select: { employeeNo: true } });
    assigneeLabelFrom = holder?.employeeNo ?? asset.assigneeId;
    updates.assignee = { disconnect: true };
  }

  if (change.kind === "change-status") {
    // A held asset can't be status-changed out from under its holder — that
    // would strand the assignment invisibly. Returns go through "return".
    const keepsHolder = (HOLDER_STATUSES[asset.cls] as readonly string[]).includes(change.status);
    if (asset.assigneeId && !keepsHolder) {
      return { ok: false, error: `Execution guard: ${asset.tag} is still assigned — request a lifecycle.return first, then change its status` };
    }
  }

  // The repairs view's Down clock starts when a device ENTERS defective, and
  // is never cleared ("has a defectiveSince but no longer reads DEFECTIVE" is
  // the RETURNED OK stage).
  if (change.status === "DEFECTIVE" && asset.status !== "DEFECTIVE") {
    updates.defectiveSince = now;
    diff.defectiveSince = { from: asset.defectiveSince, to: now };
  }

  // Spec §4.1: a return landing an IT device on its default status is "back,
  // not checked"; any other status write is itself a triage decision.
  const landsForTriage =
    change.kind === "return"
    && change.status === DEFAULT_STATUS[asset.cls]
    && (DIRECT_LIFECYCLE_CLASSES as readonly AssetClass[]).includes(asset.cls);
  if (landsForTriage) {
    updates.returnedAt = now;
    diff.returnedAt = { from: asset.returnedAt, to: now };
  } else if (asset.returnedAt !== null) {
    updates.returnedAt = null;
    diff.returnedAt = { from: asset.returnedAt, to: null };
  }

  if (change.status !== asset.status) diff.status = { from: asset.status, to: change.status };
  if (change.kind === "assign" && change.employeeId !== asset.assigneeId) {
    diff.assignee = { from: assigneeLabelFrom ?? asset.assigneeId, to: assigneeLabelTo ?? change.employeeId };
  }
  if (change.kind === "return") diff.assignee = { from: assigneeLabelFrom, to: null };

  return { ok: true, prepared: { updates, diff, settleReservationFor } };
}

export async function commitLifecycle(
  tx: Prisma.TransactionClient,
  assetId: string,
  prepared: Prepared,
  now: Date = new Date(),
): Promise<void> {
  await tx.asset.update({ where: { id: assetId }, data: prepared.updates });
  if (prepared.settleReservationFor) {
    await tx.reservation.updateMany({
      where: { assetId, employeeId: prepared.settleReservationFor, state: "ACTIVE" },
      data: { state: "FULFILLED", resolvedAt: now },
    });
  }
}
```

- [ ] **Step 2: Worker** — replace lines 71-165 of `execute-approval.ts` (from `// Per-type live re-validation.` through the reservation settle) with:

```ts
    // The payload-shape checks stay here (they are about the approval, not the
    // asset); the live asset guards and the write live in prepare/commitLifecycle,
    // shared with Phase 15's direct actions so the two paths cannot drift.
    if (approval.type === "lifecycle_return") {
      const payload = approval.payload as { from?: { assigneeId?: unknown } } | null;
      const expected = typeof payload?.from?.assigneeId === "string" ? payload.from.assigneeId : null;
      if (asset.assigneeId !== expected) {
        return fail(`Execution guard: ${asset.tag} is no longer held by the expected employee — return refused`);
      }
    }
    if (approval.type === "lifecycle_change_status") {
      const payload = approval.payload as { from?: { status?: unknown } } | null;
      const expectedFrom = typeof payload?.from?.status === "string" ? payload.from.status : null;
      if (expectedFrom && asset.status !== expectedFrom) {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, payload expected ${expectedFrom} — refused`);
      }
    }
    const change: LifecycleChange =
      approval.type === "lifecycle_assign"
        ? { kind: "assign", employeeId: plan.updates.assigneeId as string, status: plan.updates.status }
        : approval.type === "lifecycle_return"
          ? { kind: "return", status: plan.updates.status }
          : { kind: "change-status", status: plan.updates.status };
    const prepared = await prepareLifecycle(tx, asset, change);
    if (!prepared.ok) return fail(prepared.error);

    // Claim the approval row FIRST (state-guarded): if a concurrent transition
    // got there, no asset write happens at all.
    const claimed = await tx.approval.updateMany({
      where: { id: approval.id, state: "APPROVED" },
      data: { state: "EXECUTED", resolvedAt: new Date(), workerError: null },
    });
    if (claimed.count === 0) return;

    await commitLifecycle(tx, asset.id, prepared.prepared);
    const diff = prepared.prepared.diff;
    await tx.auditEntry.create({
      data: {
        actorLabel: "worker",
        entityType: "asset",
        entityId: asset.id,
        action: `${APPROVAL_TYPE_LABEL[approval.type]} executed`,
        diff: Object.keys(diff).length ? (diff as unknown as Prisma.InputJsonObject) : undefined,
      },
    });
```

Imports: `import { commitLifecycle, prepareLifecycle, type LifecycleChange } from "../server/modules/lifecycle/apply";`; drop `ASSIGNABLE_FROM, HOLDER_STATUSES` and the local `Diff` type if unused. The "approval executed" audit and the webhook below stay as they are. Note the assign guard for a reservation held by someone else is new to the worker (it was only in `requestAssign`); that is intended.

- [ ] **Step 3: `createApproval`** — add to the input type `executed?: { by: string; at: Date };` and to `data`:

```ts
      ...(input.executed
        ? { state: "EXECUTED" as const, claimedById: input.executed.by, claimedAt: input.executed.at, resolvedAt: input.executed.at }
        : {}),
```

with a doc line: *Phase 15: a direct change is recorded as an approval that was never open — a decision, not a request.*

- [ ] **Step 4: Verify** `npm run typecheck && npm run lint && npm test` → clean. Then `E2E_PORT=3100 npx playwright test e2e/approvals-audit.spec.ts e2e/asset-classes.spec.ts --workers=1` → all passing (the worker still executes APR-2041 and the Purchasing cases 7/14 with unchanged messages).
- [ ] **Step 5: Commit** `feat(phase-15): prepare/commitLifecycle -- the worker's guards and write become the shared executor`

---

### Task 4: The direct actions, sentences, and closing the request path for IT

**Files:**
- Create: `src/server/modules/lifecycle/actions.ts`
- Modify: `src/lib/activity.ts` (+ `activity.test.ts`), `src/components/patterns/activity-feed.tsx:68-74`
- Modify: `src/server/modules/inventory/actions.ts` (`bulkRequestStatusChange`, `createAsset`, `requestStatusChange`), `src/server/modules/employees/actions.ts` (`requestAssign`, `requestReturn`, `requestAssignReserved`)

**Interfaces — Produces** (all `"use server"`, all return `ActionResult`):
- `changeStatus({ assetId, to, reason? }) → ok({ tag, status })`
- `assignAsset({ assetId, employeeId, status?, reason? }) → ok({ tag, employeeName })`
- `returnAsset({ assetId, outcome: ReturnOutcome, reason? }) → ok({ tag, status })`
- `replaceAsset({ employeeId, oldAssetId, newAssetId, outcome: ReturnOutcome, reason? }) → ok({ oldTag, newTag })`
- `triageAsset({ assetId, outcome: TriageOutcome, note? }) → ok({ tag, status })`
- `bulkChangeStatus({ ids?, filters?, to, reason? }) → ok({ changed, skipped })`
- `assignReserved({ employeeId }) → ok({ assigned })`

- [ ] **Step 1: `activity.test.ts`** — add, beside the `it.verify` case:

```ts
  it("Phase 15 direct actions read as sentences", () => {
    const base = { actorLabel: "J. Sarmiento", entityLabel: "BR-LT-0148" };
    expect(auditSentence({ ...base, action: "lifecycle.assign", diff: { assignee: { from: null, to: "EMP-0097" } } }))
      .toBe("J. Sarmiento assigned BR-LT-0148 to EMP-0097");
    expect(auditSentence({ ...base, action: "lifecycle.return", diff: { status: { from: "DEPLOYED", to: "SPARE" }, returnedAt: { from: null, to: "x" } } }))
      .toBe("J. Sarmiento returned BR-LT-0148 for triage");
    expect(auditSentence({ ...base, action: "lifecycle.return", diff: { status: { from: "DEPLOYED", to: "MISSING" } } }))
      .toBe("J. Sarmiento returned BR-LT-0148 as MISSING");
    expect(auditSentence({ ...base, action: "lifecycle.change-status", diff: { status: { from: "SPARE", to: "DEFECTIVE" } } }))
      .toBe("J. Sarmiento changed BR-LT-0148 to DEFECTIVE");
    expect(auditSentence({ ...base, action: "lifecycle.replace", diff: { replacedBy: { from: null, to: "BR-LT-0201" } } }))
      .toBe("J. Sarmiento replaced BR-LT-0148 with BR-LT-0201");
    expect(auditSentence({ ...base, action: "lifecycle.replace", diff: { replaces: { from: null, to: "BR-LT-0148" }, assignee: { from: null, to: "EMP-0097" } } }))
      .toBe("J. Sarmiento put BR-LT-0148 in place of BR-LT-0148 for EMP-0097".replace("put BR-LT-0148", "put BR-LT-0148"));
    expect(auditSentence({ ...base, action: "lifecycle.triage", diff: { triage: { from: null, to: "Keep as spare" } } }))
      .toBe("J. Sarmiento triaged BR-LT-0148: Keep as spare");
  });
```

(The `replaces` expectation uses `BR-LT-0148` as both labels only because `base.entityLabel` is fixed in this test; the sentence shape is *"put `<entity>` in place of `<replaces.to>` for `<assignee.to>`"*.)

- [ ] **Step 2: `activity.ts`** — insert before `case "comment":`

```ts
    // Phase 15: direct IT lifecycle changes. Subject-first, no refNo — the
    // approval row exists (already EXECUTED) but the sentence is about the asset.
    case "lifecycle.assign":
      return `${entry.actorLabel} assigned ${entry.entityLabel} to ${String(diff?.assignee?.to ?? "someone")}`;
    case "lifecycle.return": {
      const to = diff?.status?.to;
      return diff?.returnedAt?.to
        ? `${entry.actorLabel} returned ${entry.entityLabel} for triage`
        : `${entry.actorLabel} returned ${entry.entityLabel} as ${String(to ?? "?")}`;
    }
    case "lifecycle.change-status":
      return `${entry.actorLabel} changed ${entry.entityLabel} to ${String(diff?.status?.to ?? "?")}`;
    case "lifecycle.replace":
      return diff?.replacedBy
        ? `${entry.actorLabel} replaced ${entry.entityLabel} with ${String(diff.replacedBy.to)}`
        : `${entry.actorLabel} put ${entry.entityLabel} in place of ${String(diff?.replaces?.to ?? "?")} for ${String(diff?.assignee?.to ?? "someone")}`;
    case "lifecycle.triage":
      return `${entry.actorLabel} triaged ${entry.entityLabel}: ${String(diff?.triage?.to ?? "?")}`;
```

`activity-feed.tsx` `actionDot`: in the settled branch add `|| action.startsWith("lifecycle.")` (a direct change settles like an executed approval).

- [ ] **Step 3: `src/server/modules/lifecycle/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { emitWebhook } from "@/server/webhooks/emit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import { repairStageIds } from "@/server/modules/inventory/queries";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import type { AuditDiff } from "@/lib/audit-diff";
import { parseListState, type ListState } from "@/lib/url-state";
import { BULK_MAX, INVENTORY_LIST_CONFIG, buildAssetWhere, parsePurchaseYear } from "@/lib/inventory-list";
import { statusFamily } from "@/lib/status";
import { ASSET_STATUSES } from "@/lib/asset-rules";
import {
  ASSIGN_TARGETS, CLASS_PHRASE, DEFAULT_ASSIGN_STATUS, isAssignable, isDirectLifecycle, isStatusOf, parseCls,
} from "@/lib/asset-class";
import {
  RETURN_OUTCOMES, RETURN_OUTCOME_STATUS, TRIAGE_LABEL, TRIAGE_OUTCOMES, reasonRequiredFor, replacePlan,
  type ReturnOutcome,
} from "@/lib/lifecycle";
import { commitLifecycle, prepareLifecycle, type LifecycleAsset, type LifecycleChange } from "./apply";

const DIRECT_REFUSAL = "IT changes apply directly — use Change status, Assign or Return.";
export { DIRECT_REFUSAL as _DIRECT_REFUSAL };

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string };

const assetSelect = {
  id: true, tag: true, cls: true, status: true, assigneeId: true, defectiveSince: true, returnedAt: true, model: true,
} as const;

/** Load + the three refusals every direct action shares: exists, direct for this role, no open approval. */
async function loadDirect(tx: Tx, actor: { role: Parameters<typeof isDirectLifecycle>[0] }, assetId: string) {
  const asset = await tx.asset.findUnique({ where: { id: assetId }, select: assetSelect });
  if (!asset) return { failure: conflict("That asset no longer exists.") } as const;
  if (!isDirectLifecycle(actor.role, asset.cls)) return { failure: forbidden() } as const;
  const open = await openApprovalForAsset(tx, asset.id);
  if (open) return { failure: conflict(`${asset.tag} is held by ${open.refNo} — resolve it in Approvals first.`) } as const;
  return { asset } as const;
}

/**
 * Spec §2.3: one direct change = the asset write + an EXECUTED approval row (the
 * record of the decision) + the asset audit entry + the same webhook the worker
 * emits. All in the caller's transaction.
 */
async function recordDirect(tx: Tx, input: {
  actor: Actor; asset: LifecycleAsset; change: LifecycleChange;
  type: "lifecycle_assign" | "lifecycle_return" | "lifecycle_change_status";
  payload: Prisma.InputJsonObject; employeeId?: string; action: string; extraDiff?: AuditDiff; now: Date;
}): Promise<{ ok: true; diff: AuditDiff } | { ok: false; error: string }> {
  const prepared = await prepareLifecycle(tx, input.asset, input.change, input.now);
  if (!prepared.ok) return prepared;
  await commitLifecycle(tx, input.asset.id, prepared.prepared, input.now);
  const approval = await createApproval(tx, {
    type: input.type, payload: input.payload, requestedById: input.actor.id,
    assetId: input.asset.id, employeeId: input.employeeId,
    executed: { by: input.actor.id, at: input.now },
  });
  const diff: AuditDiff = { ...prepared.prepared.diff, ...(input.extraDiff ?? {}) };
  await writeAudit(tx, {
    actorId: input.actor.id, actorLabel: input.actor.name,
    entityType: "asset", entityId: input.asset.id, action: input.action, diff,
  });
  await emitWebhook(tx, "approval.executed", {
    approvalId: approval.id, refNo: approval.refNo, type: approval.type, assetId: input.asset.id, assetTag: input.asset.tag,
  });
  return { ok: true, diff };
}

function revalidateAsset(assetId: string, employeeIds: Array<string | null | undefined>) {
  revalidatePath(`/inventory/${assetId}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  for (const e of employeeIds) if (e) revalidatePath(`/employees/${e}`);
}

const reasonOpt = z.string().trim().max(500).optional();

// ── changeStatus ────────────────────────────────────────────────────────────
const changeStatusSchema = z.object({ assetId: z.string().min(1), to: z.enum(ASSET_STATUSES), reason: reasonOpt });

export async function changeStatus(input: unknown): Promise<ActionResult<{ tag: string; status: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = changeStatusSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { tag: string; status: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    if (!isStatusOf(asset.cls, d.to)) return validationError({ to: `${d.to} is not ${CLASS_PHRASE[asset.cls]} status.` });
    if (asset.status === d.to) return conflict(`Already ${d.to}.`);
    const r = await recordDirect(tx, {
      actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.change-status",
      change: { kind: "change-status", status: d.to },
      payload: { from: { status: asset.status }, to: { status: d.to }, reason: d.reason ?? "" },
    });
    if (!r.ok) return conflict(r.error);
    out = { tag: asset.tag, status: d.to };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, []);
  return ok(out!);
}

// ── assignAsset ─────────────────────────────────────────────────────────────
const assignSchema = z.object({
  assetId: z.string().min(1), employeeId: z.string().min(1),
  status: z.enum(ASSET_STATUSES).optional(), reason: reasonOpt,
});

export async function assignAsset(input: unknown): Promise<ActionResult<{ tag: string; employeeName: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { tag: string; employeeName: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    const status: AssetStatus = d.status ?? DEFAULT_ASSIGN_STATUS[asset.cls];
    if (!(ASSIGN_TARGETS[asset.cls] as readonly string[]).includes(status)) {
      return validationError({ status: `${status} is not an assign target for ${CLASS_PHRASE[asset.cls]} asset.` });
    }
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { name: true } });
    if (!employee) return validationError({ employeeId: "Unknown employee" });
    const r = await recordDirect(tx, {
      actor: user, asset, now, type: "lifecycle_assign", action: "lifecycle.assign", employeeId: d.employeeId,
      change: { kind: "assign", employeeId: d.employeeId, status },
      payload: { to: { assigneeId: d.employeeId, status }, reason: d.reason || "assigned" },
    });
    if (!r.ok) return conflict(r.error);
    out = { tag: asset.tag, employeeName: employee.name };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, [d.employeeId]);
  return ok(out!);
}

// ── returnAsset ─────────────────────────────────────────────────────────────
const returnSchema = z.object({ assetId: z.string().min(1), outcome: z.enum(RETURN_OUTCOMES), reason: reasonOpt });

export async function returnAsset(input: unknown): Promise<ActionResult<{ tag: string; status: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  if (reasonRequiredFor(d.outcome) && (d.reason ?? "").length < 3) {
    return validationError({ reason: "Missing needs a reason (at least 3 characters) — it opens an investigation." });
  }
  const now = new Date();
  let out: { tag: string; status: string } | null = null;
  const holderId: { v: string | null } = { v: null };
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    if (!asset.assigneeId) return conflict(`${asset.tag} is not held by anyone.`);
    holderId.v = asset.assigneeId;
    const status = RETURN_OUTCOME_STATUS[d.outcome];
    const r = await recordDirect(tx, {
      actor: user, asset, now, type: "lifecycle_return", action: "lifecycle.return", employeeId: asset.assigneeId,
      change: { kind: "return", status },
      payload: { from: { assigneeId: asset.assigneeId }, to: { assigneeId: null, status }, reason: d.reason ?? "" },
    });
    if (!r.ok) return conflict(r.error);
    out = { tag: asset.tag, status };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, [holderId.v]);
  return ok(out!);
}

// ── replaceAsset ────────────────────────────────────────────────────────────
const replaceSchema = z.object({
  employeeId: z.string().min(1), oldAssetId: z.string().min(1), newAssetId: z.string().min(1),
  outcome: z.enum(RETURN_OUTCOMES), reason: reasonOpt,
});

export async function replaceAsset(input: unknown): Promise<ActionResult<{ oldTag: string; newTag: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  if (d.oldAssetId === d.newAssetId) return validationError({ newAssetId: "Pick a different device." });
  if (reasonRequiredFor(d.outcome) && (d.reason ?? "").length < 3) {
    return validationError({ reason: "Missing needs a reason (at least 3 characters) — it opens an investigation." });
  }
  const now = new Date();
  let out: { oldTag: string; newTag: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const oldL = await loadDirect(tx, user, d.oldAssetId);
    if ("failure" in oldL) return oldL.failure;
    const newL = await loadDirect(tx, user, d.newAssetId);
    if ("failure" in newL) return newL.failure;
    const oldAsset = oldL.asset, newAsset = newL.asset;
    if (oldAsset.assigneeId !== d.employeeId) return conflict(`${oldAsset.tag} isn't held by this person.`);
    if (oldAsset.cls !== newAsset.cls) return conflict("Replace within one class only.");
    if (!isAssignable(newAsset)) {
      return conflict(newAsset.returnedAt
        ? `${newAsset.tag} is back but not yet triaged — triage it first.`
        : `${newAsset.tag} is ${newAsset.status}, not a spare.`);
    }
    let plan: ReturnType<typeof replacePlan>;
    try { plan = replacePlan({ status: oldAsset.status }, d.outcome); }
    catch { return conflict(`${oldAsset.tag} is ${oldAsset.status} — nothing to replace.`); }

    const ret = await recordDirect(tx, {
      actor: user, asset: oldAsset, now, type: "lifecycle_return", action: "lifecycle.replace", employeeId: d.employeeId,
      change: { kind: "return", status: plan.oldStatus },
      payload: { from: { assigneeId: d.employeeId }, to: { assigneeId: null, status: plan.oldStatus }, reason: d.reason || `replaced by ${newAsset.tag}` },
      extraDiff: { replacedBy: { from: null, to: newAsset.tag } },
    });
    if (!ret.ok) return conflict(ret.error);
    const asg = await recordDirect(tx, {
      actor: user, asset: newAsset, now, type: "lifecycle_assign", action: "lifecycle.replace", employeeId: d.employeeId,
      change: { kind: "assign", employeeId: d.employeeId, status: plan.newStatus },
      payload: { to: { assigneeId: d.employeeId, status: plan.newStatus }, reason: `replaces ${oldAsset.tag}` },
      extraDiff: { replaces: { from: null, to: oldAsset.tag } },
    });
    if (!asg.ok) return conflict(asg.error);
    out = { oldTag: oldAsset.tag, newTag: newAsset.tag };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.oldAssetId, [d.employeeId]);
  revalidatePath(`/inventory/${d.newAssetId}`);
  return ok(out!);
}

// ── triageAsset ─────────────────────────────────────────────────────────────
const triageSchema = z.object({ assetId: z.string().min(1), outcome: z.enum(TRIAGE_OUTCOMES), note: z.string().trim().max(500).optional() });

export async function triageAsset(input: unknown): Promise<ActionResult<{ tag: string; status: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = triageSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { tag: string; status: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    if (asset.returnedAt === null) return conflict(`${asset.tag} is not waiting for triage.`);
    const full = await tx.asset.findUniqueOrThrow({ where: { id: asset.id }, select: { notes: true } });
    const notes = d.note ? (full.notes ? `${full.notes}\n${d.note}` : d.note) : undefined;
    const triageDiff: AuditDiff = { triage: { from: null, to: TRIAGE_LABEL[d.outcome] } };
    if (d.outcome === asset.status) {
      // Keep as spare: only the flag moves. No approval row — nothing about the
      // asset's lifecycle changed, so there is no decision to record as one.
      await tx.asset.update({ where: { id: asset.id }, data: { returnedAt: null, ...(notes !== undefined ? { notes } : {}) } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
        action: "lifecycle.triage", diff: { ...triageDiff, returnedAt: { from: asset.returnedAt, to: null } },
      });
    } else {
      const r = await recordDirect(tx, {
        actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.triage",
        change: { kind: "change-status", status: d.outcome },
        payload: { from: { status: asset.status }, to: { status: d.outcome }, reason: d.note ?? "triage" },
        extraDiff: triageDiff,
      });
      if (!r.ok) return conflict(r.error);
      if (notes !== undefined) await tx.asset.update({ where: { id: asset.id }, data: { notes } });
    }
    out = { tag: asset.tag, status: d.outcome };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, []);
  return ok(out!);
}

// ── bulkChangeStatus ────────────────────────────────────────────────────────
const bulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    filters: z.string().max(2000).optional(),
    to: z.enum(ASSET_STATUSES),
    reason: reasonOpt,
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filters !== undefined, { message: "Nothing is selected", path: ["ids"] });

export async function bulkChangeStatus(input: unknown): Promise<ActionResult<{ changed: number; skipped: number }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { ids, filters, to, reason } = parsed.data;

  let where: Prisma.AssetWhereInput;
  if (ids?.length) where = { id: { in: ids } };
  else {
    const fp = new URLSearchParams(filters);
    const state: ListState = parseListState(fp, INVENTORY_LIST_CONFIG);
    const purchaseYear = parsePurchaseYear(fp.get("purchaseYear"));
    const cls = parseCls(fp.get("cls")) ?? "IT";
    const cutIds = await repairStageIds(state, purchaseYear, cls);
    where = cutIds !== null ? { id: { in: cutIds } } : buildAssetWhere(state, purchaseYear, cls);
  }

  const now = new Date();
  let changed = 0, skipped = 0;
  const failure = await prisma.$transaction(async (tx) => {
    const assets = await tx.asset.findMany({ where, take: BULK_MAX + 1, select: assetSelect });
    if (assets.length === 0) return conflict("Nothing matched the selection.");
    if (assets.length > BULK_MAX) return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
    const classes = new Set(assets.map((a) => a.cls));
    if (classes.size > 1) return conflict("Select assets of one class — IT and Purchasing assets cannot share a status change.");
    const cls = assets[0].cls;
    if (!isDirectLifecycle(user.role, cls)) return forbidden();
    if (!isStatusOf(cls, to)) return validationError({ to: `${to} is not ${CLASS_PHRASE[cls]} status.` });
    const open = await tx.approval.findMany({
      where: { assetId: { in: assets.map((a) => a.id) }, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
      select: { assetId: true },
    });
    const blocked = new Set(open.map((o) => o.assetId));
    const targets = assets.filter((a) => a.status !== to && !blocked.has(a.id) && statusFamily(a.status) !== "closed");
    skipped = assets.length - targets.length;
    for (const asset of targets) {
      const r = await recordDirect(tx, {
        actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.change-status",
        change: { kind: "change-status", status: to },
        payload: { from: { status: asset.status }, to: { status: to }, reason: reason ?? "" },
      });
      if (!r.ok) { skipped += 1; continue; } // a held asset refused by the holder guard is skipped, not fatal
      changed += 1;
    }
    return null;
  });
  if (failure) return failure;
  revalidatePath("/inventory");
  revalidatePath("/");
  return ok({ changed, skipped });
}

// ── assignReserved ──────────────────────────────────────────────────────────
const reservedSchema = z.object({ employeeId: z.string().min(1) });

export async function assignReserved(input: unknown): Promise<ActionResult<{ assigned: number }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reservedSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;
  const now = new Date();
  let assigned = 0;
  const failure = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment !== "ACTIVE") return conflict("Slots are frozen for a leaver.");
    const holds = await tx.reservation.findMany({ where: { employeeId, state: "ACTIVE" }, include: { asset: { select: assetSelect } } });
    for (const hold of holds) {
      if (!isDirectLifecycle(user.role, hold.asset.cls) || !isAssignable(hold.asset)) continue;
      if (await openApprovalForAsset(tx, hold.assetId)) continue;
      const r = await recordDirect(tx, {
        actor: user, asset: hold.asset, now, type: "lifecycle_assign", action: "lifecycle.assign", employeeId,
        change: { kind: "assign", employeeId, status: DEFAULT_ASSIGN_STATUS[hold.asset.cls] },
        payload: { to: { assigneeId: employeeId, status: DEFAULT_ASSIGN_STATUS[hold.asset.cls] }, reason: "reserved — day-one setup" },
      });
      if (r.ok) assigned += 1;
    }
    return null;
  });
  if (failure) return failure;
  if (assigned === 0) return conflict("No reserved spares were available to assign.");
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/inventory");
  return ok({ assigned });
}
```

Check each import exists (`ASSET_STATUSES` is what `statusChangeSchema` uses in `inventory/actions.ts` — import it from the same place; `statusFamily` from `@/lib/status`; `repairStageIds` from `inventory/queries`). Adjust import paths to what the repo actually exports; do not change behaviour.

- [ ] **Step 4: Close the request path for direct classes**

In `inventory/actions.ts` `requestStatusChange`, after `if (!canManageClass(...)) return forbidden();` add
`if (isDirectLifecycle(user.role, asset.cls)) return conflict(DIRECT_REFUSAL);`. Same line in `bulkRequestStatusChange` after its `canManageClass` check (on `cls`), and in `employees/actions.ts` `requestAssign` and `requestReturn` after their `canManageClass` checks, and at the top of `requestAssignReserved`'s loop body (`if (isDirectLifecycle(user.role, hold.asset.cls)) continue;` — reservations for IT are handled by `assignReserved`). Define `const DIRECT_REFUSAL = "IT changes apply directly — use Change status, Assign or Return.";` locally in each file (a `"use server"` module may not export a const).

In `createAsset`: when `plan.approval && isDirectLifecycle(user.role, category.cls)`, inside the transaction after the create + its audit, replace the `createApproval` + `approval.requested` audit with:

```ts
        const asset: LifecycleAsset = { ...created, returnedAt: created.returnedAt };
        const prepared = await prepareLifecycle(tx, asset, { kind: "assign", employeeId: plan.approval.assigneeId, status: plan.approval.toStatus });
        if (!prepared.ok) throw new Error(prepared.error);
        await commitLifecycle(tx, created.id, prepared.prepared);
        const approval = await createApproval(tx, {
          type: "lifecycle_assign",
          payload: { to: { assigneeId: plan.approval.assigneeId, status: plan.approval.toStatus }, reason: d.assignReason || "assigned at registration" },
          requestedById: user.id, assetId: created.id, employeeId: plan.approval.assigneeId,
          executed: { by: user.id, at: new Date() },
        });
        await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: created.id, action: "lifecycle.assign", diff: prepared.prepared.diff });
        await emitWebhook(tx, "approval.executed", { approvalId: approval.id, refNo: approval.refNo, type: approval.type, assetId: created.id, assetTag: created.tag });
```

keeping the existing PENDING path in an `else` for non-direct classes. Catch the thrown guard error outside the transaction and return `conflict(message)`.

- [ ] **Step 5: Verify** `npm run typecheck && npm run lint && npm test` → clean.
- [ ] **Step 6: Commit** `feat(phase-15): direct lifecycle actions record EXECUTED approvals; request path closes for IT`

---

### Task 5: Record surfaces in direct mode

**Files:**
- Rename/rewrite: `src/components/inventory/request-status-change.tsx` → `src/components/inventory/status-control.tsx` (export `StatusControl`)
- Rewrite: `src/components/inventory/holder-control.tsx`
- Create: `src/components/inventory/replace-control.tsx`, `src/components/inventory/triage-control.tsx`
- Modify: `src/app/(app)/inventory/[id]/layout.tsx`

**Interfaces — Produces:**
- `<StatusControl assetId currentStatus cls direct />` — `direct` calls `changeStatus`, else `requestStatusChange`.
- `<HolderControl … direct />` — assign/return; in direct mode the return dialog offers `RETURN_OUTCOMES`.
- `<ReplaceControl assetId tag employeeId employeeName spares: ComboOption[] />` (direct only).
- `<TriageControl assetId tag />` (direct only).

- [ ] **Step 1: `status-control.tsx`** — copy `request-status-change.tsx`, rename the export, add prop `direct: boolean`, and:

```tsx
  const res = direct
    ? await changeStatus({ assetId, to, reason })
    : await requestStatusChange({ assetId, to, reason });
  if (res.ok) {
    toast(direct ? `${assetId ? "" : ""}${(res.data as { tag?: string }).tag ?? "Asset"} is now ${to}` : `${(res.data as { refNo: string }).refNo} created — waiting in the approval queue`, "settled");
```

Button label `direct ? "Change status" : "Request status change"`; dialog title `direct ? "Change status" : "Request a status change"`; submit `direct ? "Confirm" : "Request"`; the explanatory paragraph `direct ? <>Applies now and is recorded in the audit trail under your name.</> : <existing copy>`; the Reason field is `required={!direct}`. Update the one import site (`layout.tsx`) and delete the old file. Import `changeStatus` from `@/server/modules/lifecycle/actions`.

- [ ] **Step 2: `holder-control.tsx`** — add `direct: boolean` to both union members; in return mode add state `const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE")` and, when `direct`, a `Select` labelled **What happens to it** over `RETURN_OUTCOMES` with `RETURN_OUTCOME_LABEL`; submit:

```ts
      const res = props.mode === "assign"
        ? (props.direct ? await assignAsset({ assetId: props.assetId, employeeId: employeeId ?? "", reason }) : await requestAssign({ employeeId: employeeId ?? "", assetId: props.assetId, reason }))
        : (props.direct ? await returnAsset({ assetId: props.assetId, outcome, reason }) : await requestReturn({ employeeId: props.holder.id, assetId: props.assetId, reason }));
      if (res.ok) {
        toast(props.direct
          ? (props.mode === "assign" ? `${props.tag} assigned to ${(res.data as { employeeName: string }).employeeName}` : `${props.tag} returned · now ${(res.data as { status: string }).status}`)
          : `${(res.data as { refNo: string }).refNo} created — waiting in the approval queue`, "settled");
```

Labels in direct mode: button **Assign** / **Return**; titles **Assign {tag}** / **Return {tag}**; submits **Confirm**; blurb *"Applies now and is recorded in the audit trail under your name."*; Reason `required={!props.direct && !isAssign}` plus, when direct and `outcome === "MISSING"`, `required`.

- [ ] **Step 3: `replace-control.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, reasonRequiredFor, type ReturnOutcome } from "@/lib/lifecycle";
import { replaceAsset } from "@/server/modules/lifecycle/actions";

/** Phase 15 (spec §3): one confirm swaps a held device for a spare. */
export function ReplaceControl({ assetId, tag, employeeId, employeeName, spares }: {
  assetId: string; tag: string; employeeId: string; employeeName: string;
  /** same-type spares first, then any IT spare — the page orders them */
  spares: ComboOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newAssetId, setNewAssetId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function close() { setOpen(false); setNewAssetId(null); setOutcome("TRIAGE"); setReason(""); setError(null); setFieldErrors({}); setRetryAfter(null); }

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = await replaceAsset({ employeeId, oldAssetId: assetId, newAssetId: newAssetId ?? "", outcome, reason });
      if (res.ok) {
        toast(`${res.data.oldTag} replaced by ${res.data.newTag} for ${employeeName}`, "settled");
        close();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") { const fe = res.fieldErrors ?? {}; setFieldErrors(fe); if (fe._form) setError(fe._form); }
      else setError(res.message);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Replace</Button>
      <Dialog open={open} onClose={close} title={`Replace ${tag}`}
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!newAssetId}>Confirm</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            {employeeName} keeps working: the new device takes over now, and {tag} comes off their loadout with the outcome you pick. Both changes are recorded in the audit trail under your name.
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <FormField label="Replacement" required error={fieldErrors.newAssetId}>
            {(p) => <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              options={spares} value={newAssetId} onChange={setNewAssetId} placeholder="Type a tag or model…" />}
          </FormField>
          <FormField label={`What happens to ${tag}`} required error={fieldErrors.outcome}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
                {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Reason" required={reasonRequiredFor(outcome)} error={fieldErrors.reason}>
            {(p) => <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: `triage-control.tsx`** — same skeleton: button **Triage**, dialog `Triage ${tag}`, a `Select` labelled **Decision** over `TRIAGE_OUTCOMES` with `TRIAGE_LABEL`, an optional **Note** textarea, submit **Confirm** → `triageAsset({ assetId, outcome, note })`, toast `${tag} triaged · ${TRIAGE_LABEL[outcome]}`.

- [ ] **Step 5: Layout** — after `const pending = asset.approvals[0];`:

```ts
  const direct = isDirectLifecycle(user.role, asset.cls);
  const canAssign = canMutate && !pending && !asset.assignee && isAssignable(asset);
  const canReturn = canMutate && !pending && asset.assignee !== null;
  const canReplace = direct && canReturn;
  const canTriage = direct && !pending && asset.returnedAt !== null;
  const employees = canAssign ? await activeEmployeeOptions() : [];
  const spares = canReplace ? await spareOptions(asset.typeId) : [];
```

Add to `src/server/modules/inventory/queries.ts`:

```ts
/** Phase 15: the Replace picker — same-type spares first, then any assignable IT spare. */
export async function spareOptions(preferTypeId: string | null): Promise<ComboOption[]> {
  const rows = await prisma.asset.findMany({
    where: { cls: "IT", status: ASSIGNABLE_FROM.IT, returnedAt: null, reservations: { none: { state: "ACTIVE" } } },
    select: { id: true, tag: true, model: true, typeId: true },
    orderBy: { tag: "asc" },
  });
  const rank = (t: string | null) => (preferTypeId && t === preferTypeId ? 0 : 1);
  return rows.sort((a, b) => rank(a.typeId) - rank(b.typeId) || a.tag.localeCompare(b.tag))
    .map((a) => ({ value: a.id, label: a.tag, sub: a.model }));
}
```

Pills: after the AWAITING FINANCE chain add `{asset.returnedAt && <Pill tone="accent">BACK · NOT CHECKED</Pill>}`. Actions: `{canTriage && <TriageControl assetId={asset.id} tag={asset.tag} />}`, `{canReplace && asset.assignee && <ReplaceControl assetId={asset.id} tag={asset.tag} employeeId={asset.assignee.id} employeeName={asset.assignee.name} spares={spares} />}`, pass `direct={direct}` to `HolderControl` (both) and `StatusControl`; widen the outer condition with `canReplace || canTriage`. Imports: `isAssignable, isDirectLifecycle` replace `ASSIGNABLE_FROM`; `StatusControl` replaces `RequestStatusChange`.

- [ ] **Step 6: Verify** `npm run typecheck && npm run lint && npm test` → clean. Dev server `npm run dev -- -p 3100`: as `it@`, `BR-MN-0910` (SPARE) → **Change status** → DEFECTIVE applies at once; `BR-LT-0148` (held) → **Return** with outcomes, **Replace** with a picker; as `purchasing@`, `BR-VH-0002` still says **Request status change**.
- [ ] **Step 7: Commit** `feat(phase-15): record header in direct mode -- Change status, Assign, Return with outcomes, Replace, Triage`

---

### Task 6: Loadout, employee page, bulk drawer, create form

**Files:** `src/components/employees/loadout-view.tsx` · `src/app/(app)/employees/[id]/page.tsx` · `src/components/inventory/bulk-drawer.tsx` · `src/components/inventory/asset-form.tsx` · `src/app/(app)/inventory/page.tsx` (passes `direct` to the table/drawer — read how `InventoryTable` mounts `BulkDrawer` and thread a `direct` prop through)

- [ ] **Step 1: Employee page** — spare picker query becomes `where: { cls: "IT", status: ASSIGNABLE_FROM.IT, returnedAt: null }`; compute `const direct = isDirectLifecycle(user.role, "IT");` and pass `direct={direct}` and `spares` to `LoadoutView`; pass `held` rows' `typeId` (already in the model) so the Replace dialog can rank spares client-side. `canMutate` stays.

- [ ] **Step 2: `loadout-view.tsx`** — prop `direct: boolean`. Add state `const [replacing, setReplacing] = useState<SlotTile["asset"] | null>(null)`, `const [replacementId, setReplacementId] = useState<string | null>(null)`, `const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE")`. Submits:

```ts
  function submitFill() {
    if (!pickedSpare) { setFieldErrors({ spare: "Pick a spare first" }); return; }
    setError(null); setFieldErrors({});
    startTransition(async () => {
      if (direct) {
        handle(await assignAsset({ assetId: pickedSpare, employeeId, reason }), ({ tag, employeeName }) => {
          toast(`${tag} assigned to ${employeeName}`, "settled"); setFillSlot(null); setPickedSpare(null); setReason(""); router.refresh();
        });
      } else {
        handle(await requestAssign({ employeeId, assetId: pickedSpare, reason }), ({ refNo }) => {
          toast(`${refNo} created — tile shows pending until it executes`, "settled"); setFillSlot(null); setPickedSpare(null); setReason(""); router.refresh();
        });
      }
    });
  }
  function submitReturn() {
    if (!returning) return;
    setError(null); setFieldErrors({});
    startTransition(async () => {
      if (direct) {
        handle(await returnAsset({ assetId: returning.id, outcome, reason: returnReason }), ({ tag, status }) => {
          toast(`${tag} returned · now ${status}`, "settled"); setReturning(null); setReturnReason(""); setOutcome("TRIAGE"); router.refresh();
        });
      } else {
        handle(await requestReturn({ employeeId, assetId: returning.id, reason: returnReason }), ({ refNo }) => {
          toast(`${refNo} created — return is queued`, "settled"); setReturning(null); setReturnReason(""); router.refresh();
        });
      }
    });
  }
  function submitReplace() {
    if (!replacing || !replacementId) { setFieldErrors({ replacement: "Pick the replacement" }); return; }
    setError(null); setFieldErrors({});
    startTransition(async () => {
      handle(await replaceAsset({ employeeId, oldAssetId: replacing.id, newAssetId: replacementId, outcome, reason: returnReason }), ({ oldTag, newTag }) => {
        toast(`${oldTag} replaced by ${newTag}`, "settled"); setReplacing(null); setReplacementId(null); setReturnReason(""); setOutcome("TRIAGE"); router.refresh();
      });
    });
  }
  function submitReservedBatch() {
    setError(null);
    startTransition(async () => {
      if (direct) handle(await assignReserved({ employeeId }), ({ assigned }) => { toast(`${assigned} reserved spare${assigned === 1 ? "" : "s"} assigned`, "settled"); router.refresh(); });
      else handle(await requestAssignReserved({ employeeId }), ({ created }) => { toast(`${created} assign request${created === 1 ? "" : "s"} created from reservations`, "settled"); router.refresh(); });
    });
  }
```

Copy by mode: day-one button `direct ? "Assign all N reserved" : "Request assign for all N reserved"`; fill dialog submit `direct ? "Confirm" : "Request assign"`; reason hint `direct ? "Optional — recorded in the audit trail." : "Optional — lands in the approval payload."`; return dialog title unchanged, submit `direct ? "Confirm" : "Request return"`, blurb `direct ? "Comes off this loadout now; pick what happens to it." : <existing>`, and in direct mode a `Select` labelled **What happens to it** over `RETURN_OUTCOMES` above the Reason field (Reason `required={!direct || reasonRequiredFor(outcome)}`). A filled tile gains a second hover affordance `⇄ replace` when `direct && mayAct && !a.pendingRef`; clicking the tile still opens Return; add a small **Replace** ghost `Button` inside the tile's footer row (`onClick={(e) => { e.stopPropagation(); setReplacing(a); }}`). New **Replace** dialog: title `Replace ${replacing.tag}`, radiogroup **Pick the replacement** over `spares.filter(s => s.typeId === slotTypeOf(replacing))` first then the rest (label the second group *other spares*), the outcome `Select`, Reason, submit **Confirm**. The `pendingRef` logic is untouched (IT devices simply never carry one now).

- [ ] **Step 3: Bulk drawer** — prop `direct: boolean`; `direct ? bulkChangeStatus(...) : bulkRequestStatusChange(...)`; toast `direct ? `${changed} asset${…} now ${effectiveTo}` + skipped note : existing`; intro copy `direct ? <>Changes the status of <b>{scope}</b> now. Held devices and off-the-books stock are skipped — return or handle those one at a time.</> : existing`; Reason `required={!direct}`; submit `direct ? "Confirm" : "Request status change"`. Thread `direct` from `inventory/page.tsx` (`isDirectLifecycle(user.role, cls)`) through `InventoryTable` to the drawer.

- [ ] **Step 4: Create form** — the paragraph under the initial-state control: accept prop `direct: boolean` from `new/page.tsx` (`isDirectLifecycle(user.role, cls)` for the page's scoped class; when the role is direct for IT and the chosen category is IT) and render `direct ? "Deployed to the chosen person at registration — recorded in the audit trail." : <existing copy>`.

- [ ] **Step 5: Verify** typecheck/lint/test clean. Dev: as `it@` fill Marites's empty headset slot → tile shows the headset immediately, no PENDING; Replace her laptop → new tag on the tile, old device at **BACK · NOT CHECKED**.
- [ ] **Step 6: Commit** `feat(phase-15): loadout, bulk drawer and create form apply IT changes on confirm; Replace from the tile`

---

### Task 7: Offboarding decisions apply directly for IT

**Files:** `src/server/modules/offboarding/actions.ts` (`decideItem`) · `src/components/offboarding/item-decision.tsx`

- [ ] **Step 1: `decideItem`** — after the reason check and the open-approval check, branch:

```ts
      if (isDirectLifecycle(user.role, asset.cls)) {
        const prepared = await prepareLifecycle(tx, asset, { kind: "return", status: targetStatus }, now);
        if (!prepared.ok) return conflict(prepared.error);
        await commitLifecycle(tx, asset.id, prepared.prepared, now);
        const approval = await createApproval(tx, {
          type: "lifecycle_return",
          payload: { from: { assigneeId: d.employeeId }, to: { assigneeId: null, status: targetStatus }, reason: d.outcome === "RETURNED" ? reason || "offboarding · returned" : reason },
          requestedById: user.id, assetId: asset.id, employeeId: d.employeeId,
          priority: d.outcome === "MISSING" ? "HIGH" : "NORMAL",
          executed: { by: user.id, at: now },
        });
        await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: "lifecycle.return", diff: prepared.prepared.diff });
        await emitWebhook(tx, "approval.executed", { approvalId: approval.id, refNo: approval.refNo, type: approval.type, assetId: asset.id, assetTag: asset.tag });
        refNo = approval.refNo;
        applied = targetStatus;
        return null;
      }
```

(`const now = new Date()` above the transaction; `let applied: string | null = null`; the asset select must include `defectiveSince, returnedAt`.) Return `ok({ refNo, applied })`; the Purchasing branch keeps `applied: null`.

- [ ] **Step 2: `item-decision.tsx`** — toast `res.data.applied ? `${tag} → ${res.data.applied}` : `${res.data.refNo} created — ${tag} → ${outcomeStatus(cls, picked)}``; the caption under the control: for an IT asset `picked ? `applies now → ${outcomeStatus(cls, picked)}` : "applies the moment you confirm"`, for Purchasing the existing strings (pass `direct` as a prop from the wizard page: `isDirectLifecycle(user.role, item.cls)`). The reason hint's "it lands in the approval and on the farewell report" → "it lands on the farewell report" when direct.

- [ ] **Step 3: Verify** typecheck/lint/test clean; `E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts --workers=1` will FAIL on the "APR created" toasts — expected; Task 9 rewrites them. Confirm the failures are only those assertions.
- [ ] **Step 4: Commit** `feat(phase-15): offboarding decisions on IT devices apply on confirm`

---

### Task 8: The worklist

**Files:**
- Create: `src/lib/worklist.ts`, `src/lib/worklist.test.ts`, `src/components/home/worklist.tsx`, `src/app/(app)/inventory/work/page.tsx`
- Modify: `src/lib/home.ts` (+test: remove `shiftOrder`/`KIND_RANK`/`SHIFT_LIMIT` tests), `src/server/modules/home/queries.ts` (`yourShift` → `worklist`), `src/app/(app)/page.tsx`, `src/lib/workspaces.ts` (+test), delete `src/components/home/your-shift.tsx`

- [ ] **Step 1: `worklist.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { LOAN_DAYS, WORK_SECTIONS, groupWork, type WorkRow } from "./worklist";

const row = (section: WorkRow["section"], key: string, severity = 0): WorkRow =>
  ({ key, section, title: key, meta: "", href: "/x", action: "Do", severity });

describe("WORK_SECTIONS", () => {
  it("is the spec's order", () => {
    expect(WORK_SECTIONS.map((s) => s.id)).toEqual(["triage", "repairs", "check", "hires", "loans", "missing", "queue"]);
  });
  it("loans wait 30 days", () => expect(LOAN_DAYS).toBe(30));
});

describe("groupWork", () => {
  const rows = [row("queue", "q1"), row("triage", "t1", 2), row("triage", "t2", 9), row("triage", "t3", 5), row("repairs", "r1")];
  it("groups in section order, sorts by severity desc, caps for Home, reports totals", () => {
    const g = groupWork(rows, new Set(), { limit: 2 });
    expect(g.map((x) => x.section.id)).toEqual(["triage", "repairs", "queue"]);
    expect(g[0].rows.map((r) => r.key)).toEqual(["t2", "t3"]);
    expect(g[0].total).toBe(3);
  });
  it("uncapped for the page", () => {
    expect(groupWork(rows, new Set(), {})[0].rows).toHaveLength(3);
  });
  it("drops dismissed rows and empty sections", () => {
    const g = groupWork(rows, new Set(["r1"]), {});
    expect(g.map((x) => x.section.id)).toEqual(["triage", "queue"]);
  });
});
```

- [ ] **Step 2: `worklist.ts`**

```ts
/**
 * Phase 15 (spec §5). IT's Home is a worklist: fixed sections in the order the
 * user chose, each row with the one action that clears it. Pure; the queries
 * live in home/queries.ts.
 */
export type WorkSectionId = "triage" | "repairs" | "check" | "hires" | "loans" | "missing" | "queue";

export interface WorkSection { id: WorkSectionId; title: string; blurb: string }

export const WORK_SECTIONS: readonly WorkSection[] = [
  { id: "triage", title: "Triage", blurb: "Back from a person, not yet checked — decide before it is a spare again." },
  { id: "repairs", title: "Repairs to chase", blurb: "Defective devices, longest down first." },
  { id: "check", title: "Awaiting IT check", blurb: "Registered by Purchasing; Finance sees them after you." },
  { id: "hires", title: "New hires", blurb: "Started within 30 days with required slots still empty." },
  { id: "loans", title: "Loans", blurb: `Temporary devices out longer than ${30} days.` },
  { id: "missing", title: "Missing & records", blurb: "Custody lost, or a record that does not add up." },
  { id: "queue", title: "Approvals & leavers", blurb: "What still goes through the queue, and who is leaving." },
];

export const LOAN_DAYS = 30;

export interface WorkRow {
  /** stable identity for dismissal: "<section>:<entityId>" */
  key: string;
  section: WorkSectionId;
  title: string;
  meta: string;
  href: string;
  action: string;
  /** higher = worse, compared within a section */
  severity: number;
}

export interface WorkGroup { section: WorkSection; rows: WorkRow[]; total: number }

export function groupWork(rows: WorkRow[], dismissed: Set<string>, opts: { limit?: number }): WorkGroup[] {
  const live = rows.filter((r) => !dismissed.has(r.key));
  return WORK_SECTIONS.flatMap((section) => {
    const mine = live.filter((r) => r.section === section.id).sort((a, b) => b.severity - a.severity);
    if (mine.length === 0) return [];
    return [{ section, rows: opts.limit ? mine.slice(0, opts.limit) : mine, total: mine.length }];
  });
}
```

- [ ] **Step 3: `home.ts`** — delete `ShiftKind`, `ShiftRow`, `KIND_RANK`, `SHIFT_LIMIT`, `shiftOrder` and their tests in `home.test.ts` (dismissal helpers, `coverageLine`, `ageBucket`, warranty stay).

- [ ] **Step 4: `home/queries.ts`** — rename `yourShift` → `worklist(userId, role, opts: { limit?: number }, now?)` returning `WorkGroup[]`. Keep the existing eight queries and add: triage `prisma.asset.findMany({ where: { cls: "IT", returnedAt: { not: null } }, orderBy: { returnedAt: "asc" }, take: 50, select: { id, tag, model, returnedAt } })`; repairs `prisma.asset.findMany({ where: { cls: "IT", status: "DEFECTIVE" }, orderBy: { defectiveSince: "asc" }, take: 50, select: { id, tag, model, status, vendorId, rmaRef, repairQuote, cost, defectiveSince, vendor: { select: { name } } } })`; loans `prisma.asset.findMany({ where: { cls: "IT", status: "TEMPORARY" }, select: { id, tag, model, updatedAt, assignee: { select: { name } } } })` plus `prisma.auditEntry.findMany({ where: { entityType: "asset", entityId: { in: loanIds }, diff: { path: ["status", "to"], equals: "TEMPORARY" } }, orderBy: { createdAt: "desc" }, select: { entityId, createdAt } })` (first per asset = when it became a loan; fall back to `updatedAt`). Map rows to `WorkRow`s with sections: SLA/EXEC/LEAVE → `queue`; HIRE → `hires`; missing + orphaned → `missing`; CHECK → `check`; triage → `triage` (title `${tag} · ${model}`, meta `back ${n} d · triage it`, action "Triage", severity days); repairs → `repairs` (meta `${REPAIR_STAGE_LABEL[stage]} · ${vendor ?? "no vendor"}${rmaRef ? ` · ${rmaRef}` : ""} · down ${downDays} d${beyond ? " · beyond repair" : ""}` using `repairStage`, `downDays`, `beyondRepair` from `@/lib/repairs`; action "Chase"); loans → `loans` (meta `${assignee} · out ${n} d${n > LOAN_DAYS ? " · overdue" : ""}`, action "Review", severity n; include ALL loans, ordered by n). Return `groupWork(rows, activeDismissals(pref?.value, todayStamp(now)), opts)`. Update `page.tsx` to call `worklist(user.id, user.role, { limit: 2 })`.

- [ ] **Step 5: `components/home/worklist.tsx`**

```tsx
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import type { WorkGroup } from "@/lib/worklist";
import { DismissButton } from "./dismiss-button";

export function Worklist({ groups, canAct, seeAllBase }: { groups: WorkGroup[]; canAct: boolean; seeAllBase?: string }) {
  if (groups.length === 0) {
    return <EmptyState title="Nothing is waiting on you" description="No devices to triage, no repairs to chase, no new starter without kit, nothing missing." />;
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.section.id} id={g.section.id} aria-labelledby={`work-${g.section.id}`}>
          <div className="flex items-baseline justify-between">
            <h3 id={`work-${g.section.id}`} className="text-[13px] font-semibold text-fg">
              {g.section.title} <span className="font-mono text-[10.5px] text-fg-muted">{g.total}</span>
            </h3>
            {seeAllBase && g.total > g.rows.length && (
              <Link href={`${seeAllBase}#${g.section.id}`} className="text-[12px] text-accent hover:underline">See all {g.total}</Link>
            )}
          </div>
          <p className="text-[11px] text-fg-muted">{g.section.blurb}</p>
          <ol className="flex flex-col">
            {g.rows.map((row) => (
              <li key={row.key} className="flex items-center gap-3 border-b border-border-faint py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-fg">{row.title}</span>
                  <span className="block truncate font-mono text-[10.5px] text-fg-muted">{row.meta}</span>
                </span>
                <Link href={row.href} className="shrink-0 text-[12px] font-medium text-accent hover:underline">{row.action}</Link>
                {canAct && <DismissButton shiftKey={row.key} title={row.title} />}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
```

Home's IT branch: `<SectionCard title="Your shift" …>` → `<SectionCard title="Worklist" …>{(groups) => <Worklist groups={groups} canAct seeAllBase="/inventory/work" />}</SectionCard>`. Delete `your-shift.tsx`.

- [ ] **Step 6: `/inventory/work/page.tsx`** — `requireUser`; `if (!canManageClass(user.role, "IT") && user.role !== "viewer") redirect(ROLE_LANDING[user.role])`; `const groups = await worklist(user.id, user.role, {})`; `<PageHeader title="Worklist" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Worklist" }]} />` then `<Worklist groups={groups} canAct={user.role !== "viewer"} />`. `PATH_RULES`: `{ test: /^\/inventory\/work(\/|$)/, workspaces: ["it"] }` before the general `/inventory` rule; nav: IT Tracking gains `{ label: "Worklist", href: "/inventory/work" }` above Approvals; `workspaces.test.ts` cases: it_staff true, viewer true, purchasing_staff false, finance_staff false.

- [ ] **Step 7: Verify** typecheck/lint/test clean; dev: Home shows sections; `/inventory/work` lists all.
- [ ] **Step 8: Commit** `feat(phase-15): the worklist -- grouped Home sections and /inventory/work`

---

### Task 9: End-to-end

**Files:** Create `e2e/direct-lifecycle.spec.ts` · Modify `e2e/it-core.spec.ts`, `e2e/offboarding.spec.ts`, `e2e/home-finance.spec.ts`, `e2e/axe-sweep.spec.ts`

- [ ] **Step 1: New spec** — helpers copied from `asset-classes.spec.ts` (`login`, `idOf`, `highestNumber`, `tagOf`), `IT = "it@thebackroomop.com"`, `P = "purchasing@thebackroomop.com"`. Cases per spec §8.2, in serial describes where state carries:

```ts
test.describe.serial("direct changes", () => {
  test("1. Change status applies on confirm and is audited under IT's name", async ({ page }) => {
    const id = await idOf("BR-MN-0910"); // SPARE
    await login(page, IT);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Change status" }).click();
    await page.getByLabel("New status").selectOption("DEFECTIVE");
    await page.getByRole("dialog", { name: "Change status" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-MN-0910 is now DEFECTIVE")).toBeVisible();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("DEFECTIVE");
    expect(await db.approval.count({ where: { assetId: id, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } })).toBe(0);
    const rec = await db.approval.findFirstOrThrow({ where: { assetId: id, type: "lifecycle_change_status" } });
    expect(rec.state).toBe("EXECUTED");
    const audit = await db.auditEntry.findFirst({ where: { entityId: id, action: "lifecycle.change-status" }, orderBy: { createdAt: "desc" } });
    expect(audit?.actorLabel).toBe("J. Sarmiento");
  });
  test("2. Assign from the record; the tile shows it without PENDING", …);   // BR-PH-0301 → EMP-0097
  test("3. Return for triage → BACK · NOT CHECKED, out of the picker; triage keep-as-spare clears it", …);
  test("4. Replace: old device back for triage, new one DEPLOYED, Histories cross-reference", …);
  test("5. Bulk change status applies at once", …);  // BR-HS-0502 + BR-MN-0911 → DISPOSE, toast "2 assets now DISPOSE"
  test("6. Deploy at creation lands DEPLOYED with a holder and no pending approval", …);
});
test.describe.serial("offboarding", () => { test("7. three decisions apply; Continue unblocks; the laptop is in Triage; the report lists all three", …) });
test.describe("worklist", () => { test("8. Home sections and /inventory/work; clearing a row hides it", …) });
test.describe("boundaries", () => {
  test("9. A Purchasing car still goes through the queue and IT's direct controls are absent", …);
  test("10. A legacy PENDING approval blocks direct actions with its refNo", …); // hand-create a PENDING lifecycle_change_status on BR-HS-0501 like scanner.spec does, then expect "is held by APR-…"
});
```

Write every body fully, using the selectors named in Tasks 5–8 (buttons **Change status**, **Assign**, **Return**, **Replace**, **Triage**, **Confirm**; selects **New status**, **What happens to it**, **Decision**, **Replacement**; pill text `BACK · NOT CHECKED`; Home section headings `Triage`, `Repairs to chase`, `Loans`).

- [ ] **Step 2: Rewrites** — `it-core.spec.ts` "bulk selection creates one approval per asset" → asserts `/2 assets now DISPOSE/` and DB statuses; "filling a slot creates an assign approval and a pending tile" → click **Confirm**, expect `BR-HS-0502 assigned to Marites Bautista`, tile shows the tag with no PENDING pill. `offboarding.spec.ts` "each decision becomes its own approval" → `decide` expects `` new RegExp(`${tag} → `) `` and afterwards `db.asset` statuses (MISSING / DEFECTIVE / SPARE with `returnedAt` set); "a MISSING return now executes" → remove the worker step, assert status directly; "a return filed BEFORE the offboarding began blocks the item" → run it against a hand-created PENDING `lifecycle_return` on the laptop (legacy row), keeping its assertions. `home-finance.spec.ts` lines 70-107 (Home ordering on APR-2040/APR-2039) → assert those rows inside the **Approvals & leavers** section; the "clearing a shift row" test → click the clear on a row in any section. `axe-sweep.spec.ts`: add `/inventory/work` to `IT_STAFF_ROUTES`.

- [ ] **Step 3: Run** `E2E_PORT=3100 npx playwright test e2e/direct-lifecycle.spec.ts e2e/it-core.spec.ts e2e/offboarding.spec.ts e2e/home-finance.spec.ts --workers=1` (foreground, 600000 ms timeout) until green; then the rest of the suite in 3–4-file chunks; then `npm run typecheck && npm run lint && npm test`. Record counts. Fix selectors in the TEST, never the app; list each under `## D- amendments` in the report.
- [ ] **Step 4: Commit** `test(phase-15): direct-lifecycle e2e; it-core, offboarding and home cases follow the new flow`

---

### Task 10: The record

- [ ] PICKUP §1 (16 migrations, battery numbers, "Last two phases" → 14 and 15), §3 (add: "IT lifecycle changes apply on confirm and are recorded as EXECUTED approvals; Purchasing keeps its queue; a returned IT device waits for triage"), §4 (Phase 15b depreciation next; `loanDueAt` candidate), §5 (residuals from the review). HANDOVER §0 item (h) for Phase 15, header line, §7 migration count. Spec Status → implemented. Plan D- block at the top from Task 9's report.
- [ ] Commit `docs(phase-15): PICKUP, HANDOVER, spec status and plan amendments`

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §2.1 map + predicate | 1 |
| §2.2 executor shared with the worker | 3 |
| §2.3 seven direct actions, EXECUTED rows, audit, webhook | 4 |
| §2.4 request path closes; deploy-at-creation inline | 4 |
| §2.5 surfaces | 5, 6 |
| §3 Replace | 1 (plan), 4 (action), 5, 6 (controls) |
| §4.1 `returnedAt` + rule · §4.2 `isAssignable` · §4.3 triage | 2 · 1, 3, 5, 6, 8 · 4, 5 |
| §5 worklist, page, nav | 8 |
| §6 offboarding | 7 |
| §8.1 unit · §8.2 e2e | 1, 4, 8 · 9 |
| §10 docs | 10 |

Type consistency: `LifecycleAsset`, `LifecycleChange`, `Prepared`, `prepareLifecycle`, `commitLifecycle` (Task 3) are what Tasks 4 and 7 import; `createApproval`'s `executed` option (Task 3) is used by Tasks 4 and 7; `RETURN_OUTCOMES`/`ReturnOutcome`/`TRIAGE_OUTCOMES`/`replacePlan` (Task 1) by Tasks 4, 5, 6; `isDirectLifecycle`/`isAssignable` (Task 1) by 3–8; `WorkRow`/`WorkGroup`/`groupWork` (Task 8) by the Home page and the work page; `spareOptions` (Task 5) by the layout only.
