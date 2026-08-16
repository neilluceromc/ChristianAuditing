# Inventory v2 — Phase 4: Approvals + Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The approval pipeline becomes real — the claim-based queue (`/approvals` with keyboard J/K/C/A/R/E), the detail page where Approve only exists after you claim, the background worker that executes APPROVED approvals into actual asset changes (or `EXECUTION_FAILED` with the error verbatim), the append-only `/audit` log, and real activity feeds replacing the two Phase-4 placeholders.

**Architecture:** The state machine (`approvalTransition`) and execution planner (`executionPlan`) are pure TDD'd functions in `src/lib/` — server actions and the worker are their only callers. Queue actions use guarded transitions inside transactions (the claim race resolves via a state-guarded `updateMany`; the `Approval_one_open_per_asset` index never blocks transitions, only creations). Approve enqueues an `EXECUTE_APPROVAL` Job in the same transaction; the worker leases jobs with one atomic `FOR UPDATE SKIP LOCKED` statement, re-validates the world inside the execution transaction (entry criterion #1 — a 48h-old approval trusts nothing from request time), applies the change + audit diff, and marks `EXECUTED` or `EXECUTION_FAILED` with `workerError` stored verbatim.

**Tech Stack:** Existing Phase 3 conventions (ActionResult, actionRole, checkRate, writeAudit, url-state) · tsx worker process (compose `worker` service already points at `src/worker/index.ts`) · Vitest · Playwright + axe.

**Conventions for every task:** branch `phase-4-approvals-audit` (Task 1 creates it); `npx tsc --noEmit && npm run lint` before each commit; NEVER `npm run build` while a dev server runs; NO `prisma migrate reset` (no schema changes this phase). DB via `docker compose up -d db`, seed via `npm run db:seed`. Subagents don't start dev servers — the controller owns the preview; verify with unit tests + tsc + lint.

**Seed facts this phase leans on:** APR-2041 PENDING (assign BR-LT-0181 → EMP-0097) · APR-2040 PENDING URGENT past SLA (badge shows 3, urgent) · APR-2039 CLAIMED by admin@ (change-status on BR-LT-0148) · APR-2035 APPROVED with a **malformed payload** (`{note}`, no assetId) and a queued Job — the worker demo of EXECUTION_FAILED · APR-2025 EXECUTION_FAILED with seeded verbatim workerError · APR-2031/2028 terminal. `approval_ref_seq` at 2041+.

**Entry criteria this plan implements (HANDOVER §6):** worker re-validates employment/asset state inside the execution tx (#1); executes assign/return/change-status per payload with the asset diff audited in the same tx (#2); new approval creation isn't part of this phase, transitions never violate the partial index (#3); queue actions follow the action shape + brief §6.2 state machine, built TDD-first (#4); activity feeds replace the placeholder pages, one renderer, domain pill only on cross-domain feeds (#5); badge decrements via revalidation after the row leaves (#6).

**Recorded scope decisions:**
1. **Queue actions are `actionRole("admin","it_staff")`.** finance_staff shares the `/approvals` path (nav "PR approvals") but sees a read-only queue — affordances absent, keyboard actions inert. Purchase-request approval flows are the PR state machine (Phase 5), not this table.
2. **Ownership rules where the brief is silent:** release = owner or admin; reject from CLAIMED = owner or admin (from PENDING/EXECUTION_FAILED: any admin/it_staff); approve = owner only, verbatim from the brief.
3. **Escalate cycles NORMAL → HIGH → URGENT** and saturates at URGENT; state never changes.
4. **Retry = EXECUTION_FAILED → APPROVED + a fresh Job** in the same transaction (re-enqueue per the spec).
5. **Assign execution fulfills the matching ACTIVE reservation** (same asset + employee → FULFILLED, resolvedAt now) in the execution transaction — reserved stock stops being a hold the moment it deploys.
6. **Unsupported types and malformed payloads become EXECUTION_FAILED** with the exact error text stored (`lifecycle.transfer`/`replace` have no Phase-3 producer; seeded APR-2035's `{note}` payload is the demo). The Job itself completes DONE — job FAILED/DEAD is reserved for infrastructure errors (backoff 2^attempts × 30s, DEAD at 5).
7. **DELIVER_WEBHOOK jobs dead-letter immediately** with "webhook delivery ships in Phase 8" (no producer exists until then).
8. **Stale-lease recovery:** jobs RUNNING with `lockedAt` older than 5 minutes return to PENDING at worker startup and每 poll cycle — a crashed worker never strands a job.
9. **Worker `--once` flag** drains the queue and exits — used by e2e and handy for ops.
10. **Queue motion is minimal-but-real:** claim pulses the row dot (`ring` keyframe exists from Phase 1); approve/reject fade the row via a CSS transition before refresh. The 340ms translate-out choreography is kept simple — no layout-shift promises beyond the design's "badge decrements only after the row is gone" (we refresh after the animation).
11. **/audit filters:** entityType facet + free-text `q` (matches action/entityId/actorLabel contains) + page — URL contract via url-state. Date-range filters can join later without breaking the contract.
12. **Activity feeds** render AuditEntry-derived sentences scoped by entityType (`asset` / `employee`), newest first, page param, take 50. The cross-domain merged feed with the domain pill visible ships with Home (Phase 6) using this same renderer.

---

## File structure created/modified in this phase

```
src/lib/
  approval-flow.ts (+ .test.ts)         (create — approvalTransition, escalatePriority; pure, TDD)
  approval-execution.ts (+ .test.ts)    (create — executionPlan, summarizeApproval; pure, TDD)
  approvals-list.ts (+ .test.ts)        (create — QUEUE_TABS, tabWhere, parseTab, slaLabel; pure, TDD)
  audit-list.ts (+ .test.ts)            (create — audit filter where-builder + config; pure, TDD)
  activity.ts (+ .test.ts)              (create — auditSentence: entry → subject-first sentence; pure, TDD)
src/server/modules/approvals/
  queries.ts                            (create — listApprovals, tabCounts, getApproval + live system checks)
  actions.ts                            (create — claim/release/approve/reject/escalate/retry)
src/server/modules/audit/queries.ts     (create — listAudit + entity-label enrichment)
src/worker/
  index.ts                              (create — poll loop, atomic lease, stale-lease recovery, --once, shutdown)
  execute-approval.ts                   (create — per-type re-validation + apply + audit, EXECUTED/EXECUTION_FAILED)
src/components/approvals/
  queue-table.tsx                       (create — client island: tabs-aware table, J/K/C/A/R/E, reject dialog)
  approval-actions.tsx                  (create — client: detail-page action panel per state)
src/components/patterns/activity-feed.tsx (create — one renderer; domain pill optional)
src/app/(app)/approvals/
  page.tsx + loading.tsx                (create — queue)
  [id]/page.tsx + not-found.tsx         (create — detail)
src/app/(app)/audit/page.tsx + loading.tsx (create)
src/app/(app)/inventory/activity/page.tsx  (replace placeholder body)
src/app/(app)/employees/activity/page.tsx  (replace placeholder body)
e2e/approvals-audit.spec.ts             (create)
```

`approval-flow.ts` is the ONLY place transition legality lives; actions and the worker both consume it. `execute-approval.ts` is the only writer of EXECUTED/EXECUTION_FAILED.

---

### Task 1: Branch + the approval state machine (TDD)

**Files:**
- Create: `src/lib/approval-flow.ts`, `src/lib/approval-flow.test.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-4-approvals-audit
```

- [ ] **Step 2: Write the failing tests** (`src/lib/approval-flow.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { approvalTransition, escalatePriority } from "./approval-flow";

const owner = { isOwner: true, isAdmin: false };
const stranger = { isOwner: false, isAdmin: false };
const admin = { isOwner: false, isAdmin: true };

describe("approvalTransition — brief §6.2, exact", () => {
  it("claim only from PENDING", () => {
    expect(approvalTransition("PENDING", "claim", stranger)).toEqual({ ok: true, next: "CLAIMED" });
    for (const s of ["CLAIMED", "APPROVED", "REJECTED", "EXECUTED", "EXECUTION_FAILED"] as const) {
      expect(approvalTransition(s, "claim", stranger).ok).toBe(false);
    }
  });
  it("release only from CLAIMED, by the owner or an admin", () => {
    expect(approvalTransition("CLAIMED", "release", owner)).toEqual({ ok: true, next: "PENDING" });
    expect(approvalTransition("CLAIMED", "release", admin)).toEqual({ ok: true, next: "PENDING" });
    expect(approvalTransition("CLAIMED", "release", stranger).ok).toBe(false);
    expect(approvalTransition("PENDING", "release", owner).ok).toBe(false);
  });
  it("approve only from CLAIMED and ONLY by the owner — admins can't approve others' claims", () => {
    expect(approvalTransition("CLAIMED", "approve", owner)).toEqual({ ok: true, next: "APPROVED" });
    expect(approvalTransition("CLAIMED", "approve", admin).ok).toBe(false);
    expect(approvalTransition("PENDING", "approve", owner).ok).toBe(false);
  });
  it("reject from PENDING and EXECUTION_FAILED by anyone with the role; from CLAIMED owner/admin only", () => {
    expect(approvalTransition("PENDING", "reject", stranger)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("EXECUTION_FAILED", "reject", stranger)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("CLAIMED", "reject", owner)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("CLAIMED", "reject", admin)).toEqual({ ok: true, next: "REJECTED" });
    expect(approvalTransition("CLAIMED", "reject", stranger).ok).toBe(false);
    expect(approvalTransition("APPROVED", "reject", admin).ok).toBe(false); // queued for execution — too late
  });
  it("escalate keeps state, only from PENDING/CLAIMED", () => {
    expect(approvalTransition("PENDING", "escalate", stranger)).toEqual({ ok: true, next: null });
    expect(approvalTransition("CLAIMED", "escalate", stranger)).toEqual({ ok: true, next: null });
    expect(approvalTransition("EXECUTED", "escalate", admin).ok).toBe(false);
  });
  it("retry re-queues only EXECUTION_FAILED", () => {
    expect(approvalTransition("EXECUTION_FAILED", "retry", stranger)).toEqual({ ok: true, next: "APPROVED" });
    expect(approvalTransition("REJECTED", "retry", admin).ok).toBe(false);
  });
  it("REJECTED and EXECUTED are terminal for every action", () => {
    for (const action of ["claim", "release", "approve", "reject", "escalate", "retry"] as const) {
      expect(approvalTransition("REJECTED", action, admin).ok).toBe(false);
      expect(approvalTransition("EXECUTED", action, admin).ok).toBe(false);
    }
  });
  it("failures carry a human reason", () => {
    const r = approvalTransition("CLAIMED", "approve", stranger);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/own/i);
  });
});

describe("escalatePriority", () => {
  it("cycles NORMAL → HIGH → URGENT and saturates", () => {
    expect(escalatePriority("NORMAL")).toBe("HIGH");
    expect(escalatePriority("HIGH")).toBe("URGENT");
    expect(escalatePriority("URGENT")).toBe("URGENT");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- src/lib/approval-flow.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 4: Implement `src/lib/approval-flow.ts`**

```ts
import type { ApprovalState, Priority } from "@prisma/client";

/**
 * Brief §6.2 verbatim: claim only from PENDING · release only from CLAIMED ·
 * approve only from CLAIMED by the owner · reject from PENDING/CLAIMED/
 * EXECUTION_FAILED (reason required, enforced by the action's schema) ·
 * escalate changes priority, not state · retry re-queues a failed execution ·
 * REJECTED and EXECUTED are terminal. Where the brief is silent on WHO:
 * release/reject on someone else's claim need owner-or-admin (recorded
 * scope decision #2). Server actions and the worker are the only callers.
 */
export type QueueAction = "claim" | "release" | "approve" | "reject" | "escalate" | "retry";

export interface TransitionCtx {
  isOwner: boolean;
  isAdmin: boolean;
}

export type TransitionResult =
  | { ok: true; next: ApprovalState | null } // null = state unchanged (escalate)
  | { ok: false; error: string };

const fail = (error: string): TransitionResult => ({ ok: false, error });

export function approvalTransition(
  state: ApprovalState,
  action: QueueAction,
  ctx: TransitionCtx,
): TransitionResult {
  switch (action) {
    case "claim":
      return state === "PENDING"
        ? { ok: true, next: "CLAIMED" }
        : fail(`Only PENDING items can be claimed (this one is ${state}).`);
    case "release":
      if (state !== "CLAIMED") return fail("Only a claimed item can be released.");
      if (!ctx.isOwner && !ctx.isAdmin) return fail("Only the owner (or an admin) can release this claim.");
      return { ok: true, next: "PENDING" };
    case "approve":
      if (state !== "CLAIMED") return fail("Claim it first — approval requires ownership.");
      if (!ctx.isOwner) return fail("You don't own this claim — you can't approve what you don't own.");
      return { ok: true, next: "APPROVED" };
    case "reject":
      if (state === "PENDING" || state === "EXECUTION_FAILED") return { ok: true, next: "REJECTED" };
      if (state === "CLAIMED") {
        return ctx.isOwner || ctx.isAdmin
          ? { ok: true, next: "REJECTED" }
          : fail("Someone else owns this claim — only they (or an admin) can reject it.");
      }
      return fail(`A ${state} item can't be rejected.`);
    case "escalate":
      return state === "PENDING" || state === "CLAIMED"
        ? { ok: true, next: null }
        : fail(`A ${state} item can't be escalated.`);
    case "retry":
      return state === "EXECUTION_FAILED"
        ? { ok: true, next: "APPROVED" }
        : fail("Only a failed execution can be retried.");
  }
}

export function escalatePriority(priority: Priority): Priority {
  return priority === "NORMAL" ? "HIGH" : "URGENT";
}
```

- [ ] **Step 5: Run tests — green, then verify and commit**

```bash
npm run test -- src/lib/approval-flow.test.ts && npx tsc --noEmit && npm run lint
git add src/lib/approval-flow.ts src/lib/approval-flow.test.ts
git commit -m "feat(lib): approval state machine — brief §6.2 encoded as a pure transition function

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Execution planner + change summaries (TDD)

**Files:**
- Create: `src/lib/approval-execution.ts`, `src/lib/approval-execution.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/approval-execution.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { executionPlan, summarizeApproval } from "./approval-execution";

describe("executionPlan — payload → asset updates (Phase 3 payload shapes)", () => {
  it("assign: sets assignee and the requested status", () => {
    expect(executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DEPLOYED" }, reason: "x" }))
      .toEqual({ ok: true, updates: { assigneeId: "emp1", status: "DEPLOYED" } });
  });
  it("assign: only DEPLOYED/TEMPORARY are valid targets", () => {
    const plan = executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DISPOSE" } });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/DEPLOYED|TEMPORARY/);
  });
  it("return: clears the assignee back to SPARE", () => {
    expect(executionPlan("lifecycle_return", { from: { assigneeId: "emp1" }, to: { assigneeId: null, status: "SPARE" } }))
      .toEqual({ ok: true, updates: { assigneeId: null, status: "SPARE" } });
  });
  it("change-status: applies the target status", () => {
    expect(executionPlan("lifecycle_change_status", { from: { status: "SPARE" }, to: { status: "DISPOSE" }, reason: "x" }))
      .toEqual({ ok: true, updates: { status: "DISPOSE" } });
  });
  it("malformed payloads fail with a verbatim-able error (seeded APR-2035 shape)", () => {
    const plan = executionPlan("lifecycle_assign", { note: "queued for execution" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error.length).toBeGreaterThan(10);
  });
  it("unsupported types fail honestly", () => {
    const plan = executionPlan("lifecycle_transfer", { from: "EMP-0042", to: "EMP-0051" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/transfer/i);
  });
});

describe("summarizeApproval — the queue's two-line change cell", () => {
  it("assign", () => {
    const s = summarizeApproval("lifecycle_assign", { to: { assigneeId: "e", status: "DEPLOYED" }, reason: "slot fill" }, { assetTag: "BR-HS-0502", employeeName: "M. Bautista" });
    expect(s.line1).toBe("lifecycle.assign · BR-HS-0502");
    expect(s.line2).toBe("→ DEPLOYED · M. Bautista — slot fill");
  });
  it("change-status shows from → to", () => {
    const s = summarizeApproval("lifecycle_change_status", { from: { status: "SPARE" }, to: { status: "DISPOSE" }, reason: "EOL" }, { assetTag: "BR-LT-0031" });
    expect(s.line1).toBe("lifecycle.change-status · BR-LT-0031");
    expect(s.line2).toBe("SPARE → DISPOSE — EOL");
  });
  it("return", () => {
    const s = summarizeApproval("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: "SPARE" }, reason: "offboarding" }, { assetTag: "BR-LT-0148", employeeName: "D. Ong" });
    expect(s.line1).toBe("lifecycle.return · BR-LT-0148");
    expect(s.line2).toBe("D. Ong → SPARE — offboarding");
  });
  it("degrades without names and without reason", () => {
    const s = summarizeApproval("lifecycle_assign", { to: { assigneeId: "e", status: "DEPLOYED" } }, {});
    expect(s.line1).toBe("lifecycle.assign");
    expect(s.line2).toBe("→ DEPLOYED");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -- src/lib/approval-execution.test.ts`.

- [ ] **Step 3: Implement `src/lib/approval-execution.ts`**

```ts
import type { ApprovalType, AssetStatus } from "@prisma/client";
import { APPROVAL_TYPE_LABEL } from "./labels";

/**
 * Pure payload → planned asset update. The worker re-validates LIVE state
 * (employment, current holder, current status) inside its transaction —
 * this module only decides what a well-formed payload MEANS. Failures
 * become EXECUTION_FAILED with the error stored verbatim.
 */
export type ExecutionPlan =
  | { ok: true; updates: { assigneeId?: string | null; status: AssetStatus } }
  | { ok: false; error: string };

type Payload = Record<string, unknown>;

const obj = (v: unknown): Payload | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function executionPlan(type: ApprovalType, payload: unknown): ExecutionPlan {
  const p = obj(payload) ?? {};
  switch (type) {
    case "lifecycle_assign": {
      const to = obj(p.to);
      const assigneeId = to ? str(to.assigneeId) : null;
      const status = to ? str(to.status) : null;
      if (!assigneeId || !status) {
        return { ok: false, error: `Malformed lifecycle.assign payload: expected to.assigneeId and to.status, got ${JSON.stringify(payload)}` };
      }
      if (status !== "DEPLOYED" && status !== "TEMPORARY") {
        return { ok: false, error: `lifecycle.assign target status must be DEPLOYED or TEMPORARY, got ${status}` };
      }
      return { ok: true, updates: { assigneeId, status } };
    }
    case "lifecycle_return": {
      const to = obj(p.to);
      if (!to || to.status !== "SPARE") {
        return { ok: false, error: `Malformed lifecycle.return payload: expected to.status SPARE, got ${JSON.stringify(payload)}` };
      }
      return { ok: true, updates: { assigneeId: null, status: "SPARE" } };
    }
    case "lifecycle_change_status": {
      const to = obj(p.to);
      const status = to ? str(to.status) : null;
      if (!status) {
        return { ok: false, error: `Malformed lifecycle.change-status payload: expected to.status, got ${JSON.stringify(payload)}` };
      }
      return { ok: true, updates: { status: status as AssetStatus } };
    }
    default:
      return { ok: false, error: `Execution guard: ${APPROVAL_TYPE_LABEL[type]} has no executor yet (arrives with its producing flow).` };
  }
}

/** The queue's two-line change cell: line1 = type · tag, line2 = the movement — reason. */
export function summarizeApproval(
  type: ApprovalType,
  payload: unknown,
  names: { assetTag?: string | null; employeeName?: string | null },
): { line1: string; line2: string } {
  const p = obj(payload) ?? {};
  const from = obj(p.from);
  const to = obj(p.to);
  const reason = str(p.reason);
  const line1 = names.assetTag ? `${APPROVAL_TYPE_LABEL[type]} · ${names.assetTag}` : APPROVAL_TYPE_LABEL[type];
  const withReason = (core: string) => (reason ? `${core} — ${reason}` : core);

  switch (type) {
    case "lifecycle_assign": {
      const status = to ? str(to.status) ?? "DEPLOYED" : "DEPLOYED";
      const who = names.employeeName ? ` · ${names.employeeName}` : "";
      return { line1, line2: withReason(`→ ${status}${who}`) };
    }
    case "lifecycle_return": {
      const who = names.employeeName ? `${names.employeeName} ` : "";
      return { line1, line2: withReason(`${who}→ SPARE`) };
    }
    case "lifecycle_change_status": {
      const f = from ? str(from.status) : null;
      const t = to ? str(to.status) : null;
      return { line1, line2: withReason(f && t ? `${f} → ${t}` : t ? `→ ${t}` : "status change") };
    }
    default:
      return { line1, line2: withReason(str(p.note) ?? "") };
  }
}
```

- [ ] **Step 4: Run tests — green, verify, commit**

```bash
npm run test -- src/lib/approval-execution.test.ts && npx tsc --noEmit && npm run lint
git add src/lib/approval-execution.ts src/lib/approval-execution.test.ts
git commit -m "feat(lib): execution planner + queue change summaries from approval payloads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Queue tab contract + audit/activity list builders (TDD)

**Files:**
- Create: `src/lib/approvals-list.ts` (+ `.test.ts`), `src/lib/audit-list.ts` (+ `.test.ts`), `src/lib/activity.ts` (+ `.test.ts`)

- [ ] **Step 1: Write the failing tests**

`src/lib/approvals-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTab, QUEUE_TABS, slaLabel, tabWhere } from "./approvals-list";

describe("queue tabs (README 1k: Open / Mine / Unclaimed / Failed / Closed)", () => {
  it("declares the five tabs in order", () => {
    expect(QUEUE_TABS.map((t) => t.id)).toEqual(["open", "mine", "unclaimed", "failed", "closed"]);
  });
  it("parseTab falls back to open", () => {
    expect(parseTab("mine")).toBe("mine");
    expect(parseTab("bogus")).toBe("open");
    expect(parseTab(null)).toBe("open");
  });
  it("tabWhere encodes each tab's Prisma filter", () => {
    expect(tabWhere("open", "u1")).toEqual({ state: { in: ["PENDING", "CLAIMED"] } });
    expect(tabWhere("mine", "u1")).toEqual({ state: "CLAIMED", claimedById: "u1" });
    expect(tabWhere("unclaimed", "u1")).toEqual({ state: "PENDING" });
    expect(tabWhere("failed", "u1")).toEqual({ state: "EXECUTION_FAILED" });
    expect(tabWhere("closed", "u1")).toEqual({ state: { in: ["REJECTED", "EXECUTED"] } });
  });
});

describe("slaLabel", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  it("future SLAs read as runway", () => {
    expect(slaLabel(new Date("2026-08-19T12:00:00Z"), now)).toEqual({ text: "in 2 d", overdue: false });
  });
  it("past SLAs read overdue", () => {
    expect(slaLabel(new Date("2026-08-16T12:00:00Z"), now)).toEqual({ text: "1 d overdue", overdue: true });
  });
  it("same-day reads in hours", () => {
    expect(slaLabel(new Date("2026-08-17T15:00:00Z"), now)).toEqual({ text: "in 3 h", overdue: false });
    expect(slaLabel(new Date("2026-08-17T10:00:00Z"), now)).toEqual({ text: "2 h overdue", overdue: true });
  });
});
```

`src/lib/audit-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUDIT_LIST_CONFIG, buildAuditWhere } from "./audit-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), AUDIT_LIST_CONFIG);

describe("buildAuditWhere", () => {
  it("empty → empty", () => {
    expect(buildAuditWhere(parse(""))).toEqual({});
  });
  it("q searches action, entityId and actorLabel", () => {
    expect(buildAuditWhere(parse("q=SECRET"))).toEqual({
      OR: [
        { action: { contains: "SECRET", mode: "insensitive" } },
        { entityId: { contains: "SECRET", mode: "insensitive" } },
        { actorLabel: { contains: "SECRET", mode: "insensitive" } },
      ],
    });
  });
  it("entity facet filters entityType", () => {
    expect(buildAuditWhere(parse("entity=asset,employee")).entityType).toEqual({ in: ["asset", "employee"] });
  });
});
```

`src/lib/activity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { auditSentence } from "./activity";

const base = { actorLabel: "J. Sarmiento", action: "update", diff: null as unknown, entityLabel: "BR-LT-0148" };

describe("auditSentence — subject-first, one sentence (README 4b)", () => {
  it("update names the fields", () => {
    expect(auditSentence({ ...base, diff: { status: { from: "SPARE", to: "DEPLOYED" }, assignee: { from: null, to: "EMP-0042" } } }))
      .toBe("J. Sarmiento updated status, assignee on BR-LT-0148");
  });
  it("create reads as registration", () => {
    expect(auditSentence({ ...base, action: "create" })).toBe("J. Sarmiento created BR-LT-0148");
  });
  it("SECRET_READ is called out plainly", () => {
    expect(auditSentence({ ...base, action: "SECRET_READ", diff: { label: { from: null, to: "bios" } } }))
      .toBe("J. Sarmiento revealed the secret \"bios\" on BR-LT-0148");
  });
  it("approval.requested names the ref", () => {
    expect(auditSentence({ ...base, action: "approval.requested", diff: { approval: { from: null, to: "APR-2042" } } }))
      .toBe("J. Sarmiento requested APR-2042 on BR-LT-0148");
  });
  it("unknown actions degrade to actor — action — entity", () => {
    expect(auditSentence({ ...base, action: "document.signed" })).toBe("J. Sarmiento document.signed BR-LT-0148");
  });
});
```

- [ ] **Step 2: Run to verify failure** — all three test files.

- [ ] **Step 3: Implement the three modules**

`src/lib/approvals-list.ts`:

```ts
import type { Prisma } from "@prisma/client";

/** README 1k tab order. `?tab=` is the URL contract; open is the default. */
export const QUEUE_TABS = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "unclaimed", label: "Unclaimed" },
  { id: "failed", label: "Failed" },
  { id: "closed", label: "Closed" },
] as const;

export type QueueTab = (typeof QUEUE_TABS)[number]["id"];

export function parseTab(raw: string | null | undefined): QueueTab {
  return (QUEUE_TABS.some((t) => t.id === raw) ? raw : "open") as QueueTab;
}

export function tabWhere(tab: QueueTab, userId: string): Prisma.ApprovalWhereInput {
  switch (tab) {
    case "open": return { state: { in: ["PENDING", "CLAIMED"] } };
    case "mine": return { state: "CLAIMED", claimedById: userId };
    case "unclaimed": return { state: "PENDING" };
    case "failed": return { state: "EXECUTION_FAILED" };
    case "closed": return { state: { in: ["REJECTED", "EXECUTED"] } };
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Overdue renders 600-weight in the fault text colour (README 1k). */
export function slaLabel(slaAt: Date, now: Date = new Date()): { text: string; overdue: boolean } {
  const delta = slaAt.getTime() - now.getTime();
  const overdue = delta < 0;
  const abs = Math.abs(delta);
  const amount = abs >= DAY_MS ? `${Math.round(abs / DAY_MS)} d` : `${Math.max(1, Math.round(abs / HOUR_MS))} h`;
  return { text: overdue ? `${amount} overdue` : `in ${amount}`, overdue };
}
```

`src/lib/audit-list.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";

export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "user", "asset-category", "asset-type", "department",
] as const;

export const AUDIT_LIST_CONFIG: ListConfig = {
  facets: ["entity"],
  sortable: [], // append-only log renders newest-first, always
  defaultSort: [],
};

export function buildAuditWhere(state: ListState): Prisma.AuditEntryWhereInput {
  const where: Prisma.AuditEntryWhereInput = {};
  if (state.q) {
    where.OR = [
      { action: { contains: state.q, mode: "insensitive" } },
      { entityId: { contains: state.q, mode: "insensitive" } },
      { actorLabel: { contains: state.q, mode: "insensitive" } },
    ];
  }
  if (state.filters.entity?.length) where.entityType = { in: state.filters.entity };
  return where;
}
```

`src/lib/activity.ts`:

```ts
/**
 * One row = one subject-first sentence (README 4b). The entityLabel is
 * enriched server-side (asset tag / employee name); the sentence never
 * exposes raw ids.
 */
export interface ActivityEntryLike {
  actorLabel: string;
  action: string;
  diff: unknown;
  entityLabel: string;
}

export function auditSentence(entry: ActivityEntryLike): string {
  const diff = (entry.diff ?? null) as Record<string, { from: unknown; to: unknown }> | null;
  switch (entry.action) {
    case "create":
      return `${entry.actorLabel} created ${entry.entityLabel}`;
    case "update": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return `${entry.actorLabel} updated ${fields} on ${entry.entityLabel}`;
    }
    case "SECRET_READ": {
      const label = diff?.label?.to;
      return `${entry.actorLabel} revealed the secret "${String(label ?? "?")}" on ${entry.entityLabel}`;
    }
    case "approval.requested": {
      const ref = diff?.approval?.to;
      return `${entry.actorLabel} requested ${String(ref ?? "an approval")} on ${entry.entityLabel}`;
    }
    default:
      return `${entry.actorLabel} ${entry.action} ${entry.entityLabel}`;
  }
}
```

- [ ] **Step 4: Run all three — green, verify, commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/approvals-list.ts src/lib/approvals-list.test.ts src/lib/audit-list.ts src/lib/audit-list.test.ts src/lib/activity.ts src/lib/activity.test.ts
git commit -m "feat(lib): queue tab contract, SLA labels, audit where-builder, activity sentences

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Queue queries + detail with live system checks

**Files:**
- Create: `src/server/modules/approvals/queries.ts`

- [ ] **Step 1: Create `src/server/modules/approvals/queries.ts`**

```ts
import { cache } from "react";
import { prisma } from "@/server/db/client";
import { summarizeApproval } from "@/lib/approval-execution";
import { slaLabel, tabWhere, QUEUE_TABS, type QueueTab } from "@/lib/approvals-list";

export const QUEUE_PAGE_SIZE = 50;

/** Serializable queue row — the island gets strings, no Dates/Decimals. */
export interface ApprovalRow {
  id: string;
  refNo: string;
  state: string;
  priority: string;
  line1: string;
  line2: string;
  sla: { text: string; overdue: boolean };
  owner: string | null;
  mine: boolean;
}

export async function listApprovals(tab: QueueTab, userId: string): Promise<ApprovalRow[]> {
  const approvals = await prisma.approval.findMany({
    where: tabWhere(tab, userId),
    include: { asset: true, employee: true, claimedBy: true },
    // Open work orders by what breaks first; closed history reads newest-first.
    orderBy: tab === "closed" ? { updatedAt: "desc" } : { slaAt: "asc" },
    take: QUEUE_PAGE_SIZE,
  });
  return approvals.map((a) => {
    const s = summarizeApproval(a.type, a.payload, {
      assetTag: a.asset?.tag,
      employeeName: a.employee?.name,
    });
    return {
      id: a.id,
      refNo: a.refNo,
      state: a.state,
      priority: a.priority,
      line1: s.line1,
      line2: s.line2,
      sla: slaLabel(a.slaAt),
      owner: a.claimedBy?.name ?? null,
      mine: a.claimedById === userId,
    };
  });
}

export async function tabCounts(userId: string): Promise<Record<QueueTab, number>> {
  const counts = await Promise.all(
    QUEUE_TABS.map((t) => prisma.approval.count({ where: tabWhere(t.id, userId) })),
  );
  return Object.fromEntries(QUEUE_TABS.map((t, i) => [t.id, counts[i]])) as Record<QueueTab, number>;
}

export const getApproval = cache((id: string) =>
  prisma.approval.findUnique({
    where: { id },
    include: { asset: true, employee: true, requestedBy: true, claimedBy: true },
  }),
);

export interface SystemCheck {
  label: string;
  pass: boolean;
  detail: string;
}

type Payload = Record<string, unknown> | null;
const obj = (v: unknown): Payload =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * "What the system checked" (README 1k) — three machine findings evaluated
 * against LIVE rows at render time. Advisory: the worker re-runs the real
 * guards inside its execution transaction.
 */
export async function systemChecks(
  approval: NonNullable<Awaited<ReturnType<typeof getApproval>>>,
): Promise<SystemCheck[]> {
  const payload = obj(approval.payload) ?? {};
  const to = obj(payload.to);
  const from = obj(payload.from);
  const asset = approval.assetId
    ? await prisma.asset.findUnique({ where: { id: approval.assetId }, include: { assignee: true } })
    : null;

  const assetCheck: SystemCheck = approval.assetId
    ? asset
      ? { label: "Asset exists", pass: true, detail: `${asset.tag} · ${asset.status}` }
      : { label: "Asset exists", pass: false, detail: "the referenced asset is gone" }
    : { label: "Asset attached", pass: false, detail: "no asset on this approval — execution will refuse" };

  switch (approval.type) {
    case "lifecycle_assign": {
      const employee = to?.assigneeId
        ? await prisma.employee.findUnique({ where: { id: String(to.assigneeId) } })
        : approval.employeeId
          ? await prisma.employee.findUnique({ where: { id: approval.employeeId } })
          : null;
      return [
        assetCheck,
        asset
          ? { label: "Asset is assignable", pass: asset.status === "SPARE", detail: `reads ${asset.status} right now` }
          : { label: "Asset is assignable", pass: false, detail: "—" },
        employee
          ? { label: "Recipient is active", pass: employee.employment === "ACTIVE", detail: `${employee.employeeNo} · ${employee.employment}` }
          : { label: "Recipient is active", pass: false, detail: "the referenced employee is gone" },
      ];
    }
    case "lifecycle_return": {
      const expected = from?.assigneeId ? String(from.assigneeId) : null;
      return [
        assetCheck,
        asset
          ? {
              label: "Still held by the returner",
              pass: asset.assigneeId === expected,
              detail: asset.assignee ? `held by ${asset.assignee.name}` : "held by nobody",
            }
          : { label: "Still held by the returner", pass: false, detail: "—" },
        { label: "Return target", pass: to?.status === "SPARE", detail: "returns to SPARE" },
      ];
    }
    case "lifecycle_change_status": {
      const expectedFrom = from?.status ? String(from.status) : null;
      return [
        assetCheck,
        asset && expectedFrom
          ? { label: "Status unchanged since request", pass: asset.status === expectedFrom, detail: `payload expected ${expectedFrom}, reads ${asset.status}` }
          : { label: "Status unchanged since request", pass: true, detail: "no from-status recorded" },
        { label: "Target status", pass: typeof to?.status === "string", detail: String(to?.status ?? "missing") },
      ];
    }
    default:
      return [
        assetCheck,
        { label: "Executor available", pass: false, detail: "this type has no executor yet — execution will fail honestly" },
        { label: "Payload well-formed", pass: false, detail: "unsupported type" },
      ];
  }
}
```

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/approvals/queries.ts
git commit -m "feat(approvals): queue queries, tab counts, detail with live system checks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Queue server actions — claim/release/approve/reject/escalate/retry

**Files:**
- Create: `src/server/modules/approvals/actions.ts`

- [ ] **Step 1: Create `src/server/modules/approvals/actions.ts`**

Every action: `actionRole("admin","it_staff")` → `checkRate` → zod → transaction with a **state-guarded `updateMany`** (the read-then-check race resolves to `count === 0` → conflict) + audit in the same tx → `revalidatePath("/approvals")` + detail → typed result. Approve/retry enqueue the `EXECUTE_APPROVAL` Job in the same transaction.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { approvalTransition, escalatePriority, type QueueAction } from "@/lib/approval-flow";

const idSchema = z.object({ id: z.string().min(1) });
const rejectSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

interface Acted {
  refNo: string;
  state: string;
}

/**
 * Shared skeleton: read → pure transition check → state-guarded write.
 * `guardWhere` narrows the updateMany so a concurrent transition makes this
 * one a no-op (count 0 → conflict) instead of a lost update.
 */
async function transition(
  action: QueueAction,
  id: string,
  build: (a: { id: string; refNo: string; state: string; priority: string; claimedById: string | null }, userId: string) => {
    guardWhere: Prisma.ApprovalWhereInput;
    data: Prisma.ApprovalUpdateManyMutationInput & { claimedById?: string | null };
    auditAction: string;
    diff: Record<string, { from: unknown; to: unknown }>;
    enqueue?: boolean;
  },
): Promise<ActionResult<Acted>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  let acted: Acted | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({
      where: { id },
      select: { id: true, refNo: true, state: true, priority: true, claimedById: true },
    });
    if (!approval) return conflict("That approval no longer exists.");
    const ctx = { isOwner: approval.claimedById === user.id, isAdmin: user.role === "admin" };
    const t = approvalTransition(approval.state, action, ctx);
    if (!t.ok) return conflict(t.error);

    const { guardWhere, data, auditAction, diff, enqueue } = build(approval, user.id);
    const updated = await tx.approval.updateMany({ where: { id, ...guardWhere }, data });
    if (updated.count === 0) return conflict("Someone else changed this item first — refresh and retry.");

    if (enqueue) {
      await tx.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: id } } });
    }
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "approval",
      entityId: id,
      action: auditAction,
      diff,
    });
    acted = { refNo: approval.refNo, state: String(data.state ?? approval.state) };
    return null;
  });
  if (failure) return failure;

  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
  return ok(acted!);
}

export async function claimApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("claim", parsed.data.id, (a, userId) => ({
    guardWhere: { state: "PENDING" },
    data: { state: "CLAIMED", claimedById: userId, claimedAt: new Date() },
    auditAction: "claim",
    diff: { state: { from: a.state, to: "CLAIMED" } },
  }));
}

export async function releaseApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("release", parsed.data.id, (a) => ({
    guardWhere: { state: "CLAIMED", claimedById: a.claimedById },
    data: { state: "PENDING", claimedById: null, claimedAt: null },
    auditAction: "release",
    diff: { state: { from: a.state, to: "PENDING" } },
  }));
}

export async function approveApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("approve", parsed.data.id, (a, userId) => ({
    guardWhere: { state: "CLAIMED", claimedById: userId },
    data: { state: "APPROVED" },
    auditAction: "approve",
    diff: { state: { from: a.state, to: "APPROVED" } },
    enqueue: true,
  }));
}

export async function rejectApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, reason } = parsed.data;
  return transition("reject", id, (a) => ({
    guardWhere: { state: a.state as never },
    data: { state: "REJECTED", resolvedAt: new Date(), resolutionReason: reason },
    auditAction: "reject",
    diff: { state: { from: a.state, to: "REJECTED" }, reason: { from: null, to: reason } },
  }));
}

export async function escalateApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("escalate", parsed.data.id, (a) => {
    const next = escalatePriority(a.priority as never);
    return {
      guardWhere: { state: a.state as never },
      data: { priority: next },
      auditAction: "escalate",
      diff: { priority: { from: a.priority, to: next } },
    };
  });
}

export async function retryApproval(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  return transition("retry", parsed.data.id, (a) => ({
    guardWhere: { state: "EXECUTION_FAILED" },
    data: { state: "APPROVED", workerError: null },
    auditAction: "retry",
    diff: { state: { from: a.state, to: "APPROVED" } },
    enqueue: true,
  }));
}
```

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/server/modules/approvals/actions.ts
git commit -m "feat(approvals): claim/release/approve/reject/escalate/retry — guarded transitions, approve enqueues the job

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: `/approvals` — the queue page with J/K/C/A/R/E

**Files:**
- Create: `src/components/approvals/queue-table.tsx`, `src/app/(app)/approvals/page.tsx`, `src/app/(app)/approvals/loading.tsx`

- [ ] **Step 1: Create `src/components/approvals/queue-table.tsx`** (client island)

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  approveApproval, claimApproval, escalateApproval, rejectApproval,
} from "@/server/modules/approvals/actions";
import type { ApprovalRow } from "@/server/modules/approvals/queries";
import type { ActionResult } from "@/server/action-result";

/**
 * Keyboard contract (brief §9: "an approver can clear a queue of 20 items
 * using the keyboard"): J/K (or arrows) move, Enter opens, C claim,
 * A approve (mine only), R reject (reason dialog), E escalate. The listener
 * lives on the focusable table wrapper; keys are inert for read-only roles.
 */
export function QueueTable({ rows, canAct }: { rows: ApprovalRow[]; canAct: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [focused, setFocused] = useState(0);
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [ringing, setRinging] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function handle(res: ActionResult<{ refNo: string; state: string }>, verb: string, rowId: string) {
    if (res.ok) {
      toast(`${res.data.refNo} ${verb}`, "settled");
      if (verb === "claimed") {
        setRinging(rowId);
        setTimeout(() => { setRinging(null); router.refresh(); }, 700);
      } else if (verb === "approved" || verb === "rejected") {
        // the row leaves first; the badge decrements on the refresh AFTER it's gone
        setLeaving(rowId);
        setTimeout(() => { setLeaving(null); router.refresh(); }, 340);
      } else {
        router.refresh();
      }
    } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else setError(res.message);
  }

  function act(action: "claim" | "approve" | "escalate", row: ApprovalRow) {
    setError(null);
    startTransition(async () => {
      if (action === "claim") handle(await claimApproval({ id: row.id }), "claimed", row.id);
      else if (action === "approve") handle(await approveApproval({ id: row.id }), "approved", row.id);
      else handle(await escalateApproval({ id: row.id }), "escalated", row.id);
    });
  }

  function submitReject() {
    if (!rejecting) return;
    setFieldErrors({});
    startTransition(async () => {
      const res = await rejectApproval({ id: rejecting.id, reason });
      if (!res.ok && res.kind === "validation") {
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      setRejecting(null);
      setReason("");
      handle(res, "rejected", rejecting.id);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (rows.length === 0) return;
    const key = e.key.toLowerCase();
    const row = rows[focused];
    if (key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocused((i) => Math.min(i + 1, rows.length - 1)); }
    else if (key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocused((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && row) { e.preventDefault(); router.push(`/approvals/${row.id}`); }
    else if (!canAct || pending || !row) return;
    else if (key === "c") { e.preventDefault(); act("claim", row); }
    else if (key === "a") { e.preventDefault(); act("approve", row); }
    else if (key === "e") { e.preventDefault(); act("escalate", row); }
    else if (key === "r") { e.preventDefault(); setRejecting(row); }
  }

  return (
    <div className="flex flex-col gap-2">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <div
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-label="Approval queue — J/K move, Enter opens, C claim, A approve, R reject, E escalate"
        className="rounded-(--radius-card) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onKeyDown={onKeyDown}
      >
        <Table>
          <THead>
            <Tr>
              <Th width={19}><span className="sr-only">Status colour</span></Th>
              <Th width={82}>ID</Th>
              <Th>Change</Th>
              <Th width={84}>Priority</Th>
              <Th width={106}>SLA</Th>
              <Th width={96}>Owner</Th>
              <Th width={104}>State</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((row, i) => (
              <Tr
                key={row.id}
                selected={i === focused}
                className={cn(
                  "cursor-pointer transition-opacity duration-[340ms]",
                  leaving === row.id && "opacity-0",
                )}
                onClick={() => { setFocused(i); router.push(`/approvals/${row.id}`); }}
              >
                <Td className="pr-0">
                  <span className={cn("inline-flex rounded-full", ringing === row.id && "animate-[ring_700ms_var(--ease-std)]")}>
                    <StatusDot value={row.state} />
                  </span>
                </Td>
                <Td mono>
                  <Link href={`/approvals/${row.id}`} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                    {row.refNo}
                  </Link>
                </Td>
                <Td>
                  <span className="flex flex-col py-1.5 leading-tight">
                    <span className="font-mono text-[11px] text-fg">{row.line1}</span>
                    <span className="text-xs text-fg-muted">{row.line2}</span>
                  </span>
                </Td>
                <Td>
                  {row.priority === "NORMAL"
                    ? <span className="font-mono text-[10.5px] text-fg-muted">NORMAL</span>
                    : <Pill tone={row.priority === "URGENT" ? "accent" : "neutral"}>{row.priority}</Pill>}
                </Td>
                <Td mono className={cn("text-[11px]", row.sla.overdue && "font-semibold text-[color:var(--st-fault-text)]")}>
                  {row.sla.text}
                </Td>
                <Td className="text-xs">{row.owner ?? <span className="text-fg-muted">—</span>}</Td>
                <Td mono className="text-[10.5px]">{row.state}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      <Dialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.refNo}?` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={submitReject}>Reject</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">A rejection is a human decision — the reason is recorded on the approval and in the audit trail.</p>
          <FormField label="Reason" required error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(app)/approvals/page.tsx`**

```tsx
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { parseTab, QUEUE_TABS } from "@/lib/approvals-list";
import { listApprovals, tabCounts } from "@/server/modules/approvals/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { QueueTable } from "@/components/approvals/queue-table";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canAct = user.role === "admin" || user.role === "it_staff";
  const tab = parseTab(toSearchParams(await searchParams).get("tab"));
  const [rows, counts] = await Promise.all([listApprovals(tab, user.id), tabCounts(user.id)]);

  return (
    <>
      <PageHeader
        title="Approvals"
        badge={!canAct ? <Pill>READ-ONLY · {user.role.replace("_", " ").toUpperCase()}</Pill> : undefined}
      />
      <div className="flex flex-col gap-3">
        <nav aria-label="Queue tabs" className="flex gap-1 border-b border-border">
          {QUEUE_TABS.map((t) => (
            <Link
              key={t.id}
              href={t.id === "open" ? "/approvals" : `/approvals?tab=${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className={cn(
                "relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-(--dur-1)",
                t.id === tab ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {t.label}
              <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{counts[t.id]}</span>
              {t.id === tab && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-accent" />}
            </Link>
          ))}
        </nav>
        {rows.length > 0 ? (
          <QueueTable rows={rows} canAct={canAct} />
        ) : (
          <EmptyState
            title={tab === "open" ? "The queue is clear" : `Nothing in ${QUEUE_TABS.find((t) => t.id === tab)?.label}`}
            description={tab === "open" ? "New lifecycle requests land here the moment they're made." : undefined}
          />
        )}
        {canAct && rows.length > 0 && (
          <p className="font-mono text-[10px] text-fg-muted">
            J/K move · Enter opens · C claim · A approve · R reject · E escalate
          </p>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/approvals/loading.tsx`** — header + tab-bar skeletons + 8× `SkeletonRow columns={7}` in a bordered card (mirror the inventory loading page's shape).

```tsx
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function ApprovalsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-32" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-20" />)}
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} columns={7} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/components/approvals/queue-table.tsx "src/app/(app)/approvals/page.tsx" "src/app/(app)/approvals/loading.tsx"
git commit -m "feat(approvals): the queue — five tabs, J/K/C/A/R/E keyboard path, reject dialog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: `?tab=` contract, tab counts, finance@ sees no hint line and inert keys, claim ring + approve fade as it@/admin@.

---

### Task 7: `/approvals/[id]` — detail with per-state action panels

**Files:**
- Create: `src/components/approvals/approval-actions.tsx`, `src/app/(app)/approvals/[id]/page.tsx`, `src/app/(app)/approvals/[id]/not-found.tsx`

- [ ] **Step 1: Create `src/components/approvals/approval-actions.tsx`** (client)

Props: `{ id, refNo, state, mine, ownerName, canAct, isAdmin, workerError }`. Renders per state:
- **PENDING** (canAct): Claim (primary) · Reject (danger, reason dialog) · Escalate (secondary).
- **CLAIMED + mine**: Approve (primary) · Release · Reject (dialog) · Escalate.
- **CLAIMED + not mine**: "Claimed by {ownerName}" note; admin additionally gets Release + Reject.
- **APPROVED**: the background-pending Card — pulsing dot (`animate-[pulse_1.9s_ease-in-out_infinite]`, the app's only looping animation), "Queued for execution — the worker picks this up within seconds. Until it lands, the asset still reads its old status everywhere."
- **EXECUTION_FAILED**: fault-tone Card titled "Execution failed": `workerError` verbatim in a mono block, then Retry (primary — re-queues) and Reject (danger, dialog). A system failure is not a colleague's decision — this card never renders like a rejection.
- **REJECTED / EXECUTED**: nothing (the page shows the resolution line).
All mutations via the Task 5 actions with the standard result handling (toast + `router.refresh()`, RateLimitNotice, fault Banner) and one shared reject dialog. Reuse the exact result-handling shape from `queue-table.tsx`.

- [ ] **Step 2: Create `src/app/(app)/approvals/[id]/page.tsx`** (server)

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { getApproval, systemChecks } from "@/server/modules/approvals/queries";
import { summarizeApproval } from "@/lib/approval-execution";
import { slaLabel } from "@/lib/approvals-list";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Pill } from "@/components/ui/pill";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { ApprovalActions } from "@/components/approvals/approval-actions";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const approval = await getApproval(id);
  if (!approval) notFound();
  const checks = await systemChecks(approval);
  const canAct = user.role === "admin" || user.role === "it_staff";
  const mine = approval.claimedById === user.id;
  const sla = slaLabel(approval.slaAt);
  const s = summarizeApproval(approval.type, approval.payload, {
    assetTag: approval.asset?.tag,
    employeeName: approval.employee?.name,
  });
  const payload = (approval.payload ?? {}) as Record<string, Record<string, unknown>>;

  return (
    <>
      <PageHeader
        title={approval.refNo}
        breadcrumb={[{ label: "Approvals", href: "/approvals" }, { label: approval.refNo }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={approval.state} />
            {approval.priority !== "NORMAL" && <Pill tone="accent">{approval.priority}</Pill>}
          </span>
        }
      />
      <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
        {APPROVAL_TYPE_LABEL[approval.type]} · requested by {approval.requestedBy.name} · {fmtDate(approval.createdAt)} · SLA{" "}
        <span className={sla.overdue ? "font-semibold text-[color:var(--st-fault-text)]" : undefined}>{sla.text}</span>
      </p>

      <div className="grid max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What the system checked" />
          <CardBody className="flex flex-col gap-2.5">
            {checks.map((c) => (
              <div key={c.label} className="flex items-baseline gap-2 text-xs">
                <StatusDot value={c.pass ? "DEPLOYED" : "DEFECTIVE"} />
                <span className="font-medium text-fg">{c.label}</span>
                <span className="ml-auto font-mono text-[10.5px] text-fg-muted">{c.detail}</span>
              </div>
            ))}
            <p className="pt-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-muted">
              checked just now — execution re-checks in its own transaction
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Before → after" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Change", value: s.line2 || s.line1 },
                {
                  label: "Asset",
                  value: approval.asset ? (
                    <Link href={`/inventory/${approval.asset.id}`} className="text-accent hover:underline">
                      {approval.asset.tag} · {approval.asset.model}
                    </Link>
                  ) : ("—"),
                },
                {
                  label: "Employee",
                  value: approval.employee ? (
                    <Link href={`/employees/${approval.employee.id}`} className="text-accent hover:underline">
                      {approval.employee.name} · {approval.employee.employeeNo}
                    </Link>
                  ) : ("—"),
                },
                { label: "From", value: JSON.stringify(payload.from ?? {}), mono: true },
                { label: "To", value: JSON.stringify(payload.to ?? {}), mono: true },
                ...(approval.resolutionReason
                  ? [{ label: "Resolution", value: approval.resolutionReason }]
                  : []),
                ...(approval.resolvedAt
                  ? [{ label: "Resolved", value: fmtDate(approval.resolvedAt), mono: true }]
                  : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="max-w-[900px] pt-4">
        <ApprovalActions
          id={approval.id}
          refNo={approval.refNo}
          state={approval.state}
          mine={mine}
          ownerName={approval.claimedBy?.name ?? null}
          canAct={canAct}
          isAdmin={user.role === "admin"}
          workerError={approval.workerError}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/approvals/[id]/not-found.tsx`** — EmptyState "Approval not found" + back ButtonLink to `/approvals`.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/approvals/approval-actions.tsx "src/app/(app)/approvals/[id]"
git commit -m "feat(approvals): detail — system checks, before/after, per-state actions, failed-execution card

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: APR-2041 (PENDING) shows Claim/Reject/Escalate and NO Approve; claim it → Approve appears; APR-2025 shows the fault card with the seeded verbatim error + Retry; APR-2035 (APPROVED) shows the pulsing background-pending card.

### Task 8: The worker — atomic lease, live re-validation, EXECUTED/EXECUTION_FAILED

**Files:**
- Create: `src/worker/index.ts`, `src/worker/execute-approval.ts`
- Modify: `package.json` (add `"worker:once": "tsx src/worker/index.ts --once"`)

**CRITICAL: worker files use RELATIVE imports only** (`../server/db/client`, `../lib/approval-execution`, `../lib/labels`) — tsx may not resolve the `@/` tsconfig alias outside Next.

- [ ] **Step 1: Create `src/worker/execute-approval.ts`**

```ts
import { prisma } from "../server/db/client";
import { executionPlan } from "../lib/approval-execution";
import { APPROVAL_TYPE_LABEL } from "../lib/labels";

type Diff = Record<string, { from: unknown; to: unknown }>;

/**
 * Entry criterion #1: a 48h-old approval trusts NOTHING from request time.
 * Everything is re-read and re-validated inside this transaction; failures
 * store the error VERBATIM (the retry UI shows exactly this text) and the
 * approval becomes EXECUTION_FAILED. The Job itself still completes — job
 * failure is reserved for infrastructure errors.
 */
export async function executeApproval(approvalId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({
      where: { id: approvalId },
      include: { asset: true },
    });
    if (!approval) return; // gone — nothing to do
    if (approval.state !== "APPROVED") return; // rejected/executed meanwhile — stale job

    const fail = async (error: string) => {
      await tx.approval.update({
        where: { id: approval.id },
        data: { state: "EXECUTION_FAILED", workerError: error },
      });
      await tx.auditEntry.create({
        data: {
          actorLabel: "worker",
          entityType: "approval",
          entityId: approval.id,
          action: "execution.failed",
          diff: { state: { from: "APPROVED", to: "EXECUTION_FAILED" } },
        },
      });
    };

    const plan = executionPlan(approval.type, approval.payload);
    if (!plan.ok) return fail(plan.error);
    if (!approval.assetId || !approval.asset) {
      return fail("Execution guard: approval has no asset attached — nothing to execute against");
    }
    const asset = approval.asset;

    // Per-type live re-validation.
    let assigneeLabelFrom: string | null = null;
    let assigneeLabelTo: string | null = null;
    if (approval.type === "lifecycle_assign") {
      const employee = plan.updates.assigneeId
        ? await tx.employee.findUnique({ where: { id: plan.updates.assigneeId } })
        : null;
      if (!employee) return fail("Execution guard: target employee no longer exists — assignment refused");
      if (employee.employment !== "ACTIVE") {
        return fail(`Execution guard: target employee ${employee.employeeNo} is ${employee.employment} — assignment refused`);
      }
      if (asset.status !== "SPARE") {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, not SPARE — assignment refused`);
      }
      assigneeLabelTo = employee.employeeNo;
    }
    if (approval.type === "lifecycle_return") {
      const payload = approval.payload as { from?: { assigneeId?: unknown } } | null;
      const expected = typeof payload?.from?.assigneeId === "string" ? payload.from.assigneeId : null;
      if (asset.assigneeId !== expected) {
        return fail(`Execution guard: ${asset.tag} is no longer held by the expected employee — return refused`);
      }
      if (asset.assigneeId) {
        const holder = await tx.employee.findUnique({ where: { id: asset.assigneeId } });
        assigneeLabelFrom = holder?.employeeNo ?? asset.assigneeId;
      }
    }
    if (approval.type === "lifecycle_change_status") {
      const payload = approval.payload as { from?: { status?: unknown } } | null;
      const expectedFrom = typeof payload?.from?.status === "string" ? payload.from.status : null;
      if (expectedFrom && asset.status !== expectedFrom) {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, payload expected ${expectedFrom} — refused`);
      }
    }

    // Apply + audit the ASSET diff in the same transaction (entry criterion #2).
    await tx.asset.update({ where: { id: asset.id }, data: plan.updates });
    const diff: Diff = {};
    if (plan.updates.status !== asset.status) diff.status = { from: asset.status, to: plan.updates.status };
    if (plan.updates.assigneeId !== undefined && plan.updates.assigneeId !== asset.assigneeId) {
      diff.assignee = {
        from: assigneeLabelFrom ?? asset.assigneeId,
        to: plan.updates.assigneeId ? (assigneeLabelTo ?? plan.updates.assigneeId) : null,
      };
    }
    await tx.auditEntry.create({
      data: {
        actorLabel: "worker",
        entityType: "asset",
        entityId: asset.id,
        action: `${APPROVAL_TYPE_LABEL[approval.type]} executed`,
        diff: Object.keys(diff).length ? diff : undefined,
      },
    });

    // Deploying a reserved asset settles the hold (recorded decision #5).
    if (approval.type === "lifecycle_assign" && plan.updates.assigneeId) {
      await tx.reservation.updateMany({
        where: { assetId: asset.id, employeeId: plan.updates.assigneeId, state: "ACTIVE" },
        data: { state: "FULFILLED", resolvedAt: new Date() },
      });
    }

    await tx.approval.update({
      where: { id: approval.id },
      data: { state: "EXECUTED", resolvedAt: new Date(), workerError: null },
    });
    await tx.auditEntry.create({
      data: {
        actorLabel: "worker",
        entityType: "approval",
        entityId: approval.id,
        action: "executed",
        diff: { state: { from: "APPROVED", to: "EXECUTED" } },
      },
    });
  });
}
```

- [ ] **Step 2: Create `src/worker/index.ts`**

```ts
import { prisma } from "../server/db/client";
import { executeApproval } from "./execute-approval";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = 3_000;
const STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const ONCE = process.argv.includes("--once");

let draining = false;

interface LeasedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/** One atomic statement: pick, lock, lease. SKIP LOCKED makes concurrent workers safe. */
async function leaseNext(): Promise<LeasedJob | null> {
  const rows = await prisma.$queryRaw<LeasedJob[]>`
    UPDATE "Job"
    SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${WORKER_ID},
        attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts`;
  return rows[0] ?? null;
}

/** A crashed worker never strands a job: stale RUNNING leases return to PENDING. */
async function recoverStale(): Promise<void> {
  const recovered = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
  if (recovered.count > 0) console.log(`[worker] recovered ${recovered.count} stale lease(s)`);
}

async function handle(job: LeasedJob): Promise<void> {
  if (job.type === "EXECUTE_APPROVAL") {
    const approvalId = String((job.payload as { approvalId?: unknown } | null)?.approvalId ?? "");
    if (!approvalId) throw new Error("EXECUTE_APPROVAL job has no approvalId");
    await executeApproval(approvalId);
    return;
  }
  if (job.type === "DELIVER_WEBHOOK") {
    // No producer exists until Phase 8 — dead-letter honestly instead of spinning.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "DEAD", lastError: "webhook delivery ships in Phase 8" },
    });
    return;
  }
  throw new Error(`Unknown job type ${job.type}`);
}

async function tick(): Promise<boolean> {
  const job = await leaseNext();
  if (!job) return false;
  try {
    await handle(job);
    // handle() may have terminal-ized the job itself (DEAD) — only close RUNNING ones.
    await prisma.job.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "DONE" } });
    console.log(`[worker] ${job.type} ${job.id} done`);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const dead = job.attempts >= MAX_ATTEMPTS;
    await prisma.job.update({
      where: { id: job.id },
      data: dead
        ? { status: "DEAD", lastError: message }
        : {
            status: "PENDING",
            lastError: message,
            lockedAt: null,
            lockedBy: null,
            runAt: new Date(Date.now() + 2 ** job.attempts * 30_000),
          },
    });
    console.error(`[worker] ${job.type} ${job.id} ${dead ? "DEAD" : "retrying"}: ${message}`);
  }
  return true;
}

async function main(): Promise<void> {
  console.log(`[worker] ${WORKER_ID} starting${ONCE ? " (--once)" : ""}`);
  await recoverStale();
  let cycles = 0;
  for (;;) {
    if (draining) break;
    const worked = await tick();
    if (!worked) {
      if (ONCE) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (++cycles % 10 === 0) await recoverStale();
    }
  }
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} — finishing the current job`);
    draining = true;
  });
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the script** to `package.json` scripts: `"worker:once": "tsx src/worker/index.ts --once"`.

- [ ] **Step 4: Prove it against the seeded queue** (the seed enqueues one job for APR-2035, whose payload is deliberately malformed):

```bash
npm run db:seed && npm run worker:once
```

Expected output: the job completes (`EXECUTE_APPROVAL … done`) and APR-2035 becomes EXECUTION_FAILED — verify:

```bash
docker exec inventory-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT \"refNo\", state, left(\"workerError\", 60) FROM \"Approval\" WHERE \"refNo\" = '"'"'APR-2035'"'"'"'
```

Expected: `EXECUTION_FAILED` with the malformed-payload message.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/worker/index.ts src/worker/execute-approval.ts package.json
git commit -m "feat(worker): atomic FOR UPDATE SKIP LOCKED lease, live re-validation, verbatim failure storage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `/audit` — the append-only log (no row actions, by design)

**Files:**
- Create: `src/server/modules/audit/queries.ts`, `src/app/(app)/audit/page.tsx`, `src/app/(app)/audit/loading.tsx`
- Modify: `src/lib/format.ts` (+ test) — add `fmtDateTime`

- [ ] **Step 1: Add `fmtDateTime` to `src/lib/format.ts`** (TDD — append test first):

```ts
// test (append to src/lib/format.test.ts):
it("fmtDateTime includes the clock, Asia/Manila", () => {
  expect(fmtDateTime(new Date("2026-08-16T01:41:00Z"))).toBe("16 Aug 2026 09:41");
  expect(fmtDateTime(null)).toBe("—");
});

// implementation (append to src/lib/format.ts):
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila",
});

export function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  // en-GB renders "16 Aug 2026, 09:41" — the comma reads as table noise
  return dateTimeFmt.format(typeof value === "string" ? new Date(value) : value).replace(",", "");
}
```

- [ ] **Step 2: Create `src/server/modules/audit/queries.ts`**

```ts
import { prisma } from "@/server/db/client";
import { buildAuditWhere } from "@/lib/audit-list";
import { fmtDateTime } from "@/lib/format";
import type { ListState } from "@/lib/url-state";

export const AUDIT_PAGE_SIZE = 50;

export interface AuditRow {
  id: string;
  when: string;
  actor: string;
  entityType: string;
  entityLabel: string;
  entityHref: string | null;
  action: string;
  fields: string;
}

/** Batch-resolve entity ids into human labels + links. Unknown types stay as truncated ids. */
export async function entityLabels(
  entries: Array<{ entityType: string; entityId: string }>,
): Promise<Map<string, { label: string; href: string | null }>> {
  const byType = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!byType.has(e.entityType)) byType.set(e.entityType, new Set());
    byType.get(e.entityType)!.add(e.entityId);
  }
  const map = new Map<string, { label: string; href: string | null }>();
  const [assets, employees, approvals] = await Promise.all([
    byType.has("asset")
      ? prisma.asset.findMany({ where: { id: { in: [...byType.get("asset")!] } }, select: { id: true, tag: true } })
      : [],
    byType.has("employee")
      ? prisma.employee.findMany({ where: { id: { in: [...byType.get("employee")!] } }, select: { id: true, name: true } })
      : [],
    byType.has("approval")
      ? prisma.approval.findMany({ where: { id: { in: [...byType.get("approval")!] } }, select: { id: true, refNo: true } })
      : [],
  ]);
  for (const a of assets) map.set(`asset:${a.id}`, { label: a.tag, href: `/inventory/${a.id}` });
  for (const e of employees) map.set(`employee:${e.id}`, { label: e.name, href: `/employees/${e.id}` });
  for (const a of approvals) map.set(`approval:${a.id}`, { label: a.refNo, href: `/approvals/${a.id}` });
  for (const e of entries) {
    const key = `${e.entityType}:${e.entityId}`;
    if (!map.has(key)) map.set(key, { label: e.entityId.slice(0, 10) + "…", href: null });
  }
  return map;
}

export async function listAudit(state: ListState): Promise<{ rows: AuditRow[]; total: number; pageCount: number }> {
  const where = buildAuditWhere(state);
  const [total, entries] = await Promise.all([
    prisma.auditEntry.count({ where }),
    prisma.auditEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (state.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
  ]);
  const labels = await entityLabels(entries);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    rows: entries.map((e) => {
      const l = labels.get(`${e.entityType}:${e.entityId}`)!;
      return {
        id: e.id,
        when: fmtDateTime(e.createdAt),
        actor: e.actorLabel,
        entityType: e.entityType,
        entityLabel: l.label,
        entityHref: l.href,
        action: e.action,
        fields: e.diff ? Object.keys(e.diff as object).join(", ") : "—",
      };
    }),
  };
}
```

- [ ] **Step 3: Create `src/app/(app)/audit/page.tsx`** — server page: `requireUser`; parse state with `AUDIT_LIST_CONFIG`; entityType FacetDropdown (static options from `AUDIT_ENTITY_TYPES`, counts via one `groupBy(["entityType"])` without the entity filter) + a search input (small client toolbar mirroring the employees toolbar pattern, `q` on Enter) + ChipFilterRow + the 5-column table (When mono / Actor / Entity — `Pill` with the type + accent Link when `entityHref` / Action mono / Fields mono muted) + Pagination + the two empty states. **No checkboxes, no row menus, no hover actions, no row onClick — the absence is the design (README 3g).** The only interactive thing in a row is the entity link. Compose from existing pieces; a tiny `audit-toolbar.tsx` client component colocated under `src/components/patterns/` is acceptable if needed — or reuse `FacetDropdown` + a plain search input inline in a small client wrapper.

- [ ] **Step 4: Create `src/app/(app)/audit/loading.tsx`** — header + toolbar skeletons + 10× `SkeletonRow columns={5}`.

- [ ] **Step 5: Verify and commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/format.ts src/lib/format.test.ts src/server/modules/audit/queries.ts "src/app/(app)/audit"
git commit -m "feat(audit): append-only log — filter bar, entity links, deliberately zero row actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: ActivityFeed renderer + the two real activity pages

**Files:**
- Create: `src/components/patterns/activity-feed.tsx`
- Modify: `src/app/(app)/inventory/activity/page.tsx`, `src/app/(app)/employees/activity/page.tsx` (replace placeholder bodies; KEEP the paths)

- [ ] **Step 1: Create `src/components/patterns/activity-feed.tsx`** (server-safe)

```tsx
import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";

export interface ActivityItem {
  id: string;
  sentence: string;
  /** relative or absolute display time, preformatted */
  when: string;
  actor: string;
  /** any status value for the trailing dot */
  dotValue: string;
  /** rendered ONLY on cross-domain feeds (Home, Phase 6) — scoped logs pass undefined */
  domain?: string;
}

/** One renderer for all five activity routes — the domain pill is the only variance (README 4b). */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <ol className="flex flex-col rounded-(--radius-card) border border-border bg-surface shadow-card">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2.5 border-b border-border-faint px-3 py-2.5 last:border-b-0">
          <Avatar name={item.actor} size="sm" />
          {item.domain && <Pill>{item.domain}</Pill>}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-secondary">{item.sentence}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-fg-muted">{item.when}</span>
          <StatusDot value={item.dotValue} />
        </li>
      ))}
    </ol>
  );
}

/** Status-dot family for a feed row, derived from the action. */
export function actionDot(action: string): string {
  if (action === "SECRET_READ") return "TEMPORARY"; // attention
  if (action.includes("failed") || action === "delete") return "DEFECTIVE"; // fault
  if (action === "create" || action.includes("executed")) return "DEPLOYED"; // settled
  if (action.includes("requested") || action === "claim") return "SUBMITTED"; // inflight
  return "SPARE"; // neutral
}
```

- [ ] **Step 2: Replace the two placeholder pages.** Each becomes a server page: `requireUser`; `page` param; `prisma.auditEntry.findMany` scoped by entityType (`asset` for inventory, `employee` for employees), newest first, `take 50 skip (page-1)*50` + count; enrich with `entityLabels` (from Task 9's audit queries module); rows → `ActivityItem` (`sentence: auditSentence({...entry, entityLabel})`, `when: fmtDateTime(...)`, `dotValue: actionDot(entry.action)`, NO domain — these are scoped feeds); PageHeader ("Inventory activity" / "Employee activity") + `ActivityFeed` + Pagination + an empty state ("Nothing has happened yet"). Placeholder imports (`Pill PLANNED`, EmptyState-only body) go away.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/components/patterns/activity-feed.tsx "src/app/(app)/inventory/activity/page.tsx" "src/app/(app)/employees/activity/page.tsx"
git commit -m "feat(activity): one feed renderer; inventory + employee scoped feeds replace placeholders

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

> **Deviations from the Tasks 1–10 opus review (controller applied):**
> 1. **No silent third outcome for executions** (critical): `executeApproval` now catches unexpected throws (tx timeout, driver error) and terminalizes the approval as EXECUTION_FAILED with `Execution error: …` — previously the tx rolled back everything and the approval sat "queued for execution" forever with no recovery surface. The planner also validates change-status targets against `ASSET_STATUSES` instead of casting blindly (an out-of-enum value threw inside the tx).
> 2. **Worker writes are state-guarded** (`updateMany where state=APPROVED`, claimed BEFORE the asset write): a second worker after stale-lease recovery, or an operator racing the execution, makes it a no-op — never a double-apply or duplicate audit rows.
> 3. **Held assets refuse non-holder statuses at execution**: change-status to anything but DEPLOYED/TEMPORARY on an assigned asset fails verbatim ("request a lifecycle.return first") — disposing an asset must not silently strand its holder.
> 4. **`transition()` catches P2002** from `Job_one_live_execute_per_approval` (a **Phase 1** integrity index this plan's architecture note missed — and the note wrongly said `Approval_one_open_per_asset` "never blocks transitions"; that index exists and is creation-only as designed, but the JOB index is the one retry can trip) → typed conflict instead of a 500.
> 5. **Queue a11y**: a polite live region announces the J/K selection (refNo, change, state, owner, position) — the visual highlight said nothing to screen readers; approve pre-checks `mine` client-side; actions are inert while a row is animating out; the orphaned `ringout` keyframe twin was removed.
> 6. Minor batch: escalate's guard includes priority (racing escalates step NORMAL→HIGH→URGENT instead of both writing HIGH); detail page no longer renders raw payload JSON (cuids); queue shows "showing N of M" past the 50-row page; /audit + both activity feeds clamp `?page=` to the real page count; `systemChecks` reuses `getApproval`'s included asset instead of refetching; seed comments APR-2040's deliberately incomplete shape.
> Recorded, deferred: `QUEUE_PAGE_SIZE` pagination (M3 hint shipped instead); the recoverStale wall-clock lease heuristic (mitigated by the state-guarded writes); a Job admin surface (Phase 8's deliveries page is the natural home).

### Task 11: E2E, full battery, docs, finish the branch

**Files:**
- Create: `e2e/approvals-audit.spec.ts`
- Modify: `docs/HANDOVER.md`, this plan

- [ ] **Step 1: Create `e2e/approvals-audit.spec.ts`.** Reuse the `login`/`expectNoSeriousAxe` helpers (via `/logout` first, as in `it-core.spec.ts`). ONE serial describe for the lifecycle thread (state mutations depend on order); reseed assumptions: APR-2041 PENDING NORMAL, APR-2040 PENDING URGENT overdue, APR-2039 CLAIMED by admin, APR-2035 APPROVED w/ queued job + malformed payload, APR-2025 EXECUTION_FAILED. Cover:

1. **Tabs + URL contract**: `?tab=` round-trips; counts render; Open=3, Unclaimed=2, Failed=1 on fresh seed.
2. **Read-only**: finance@ sees the queue, no keyboard hint line, and the detail page for a PENDING item shows no Claim button.
3. **Detail before claim**: APR-2041 as it@ — Claim/Reject/Escalate visible, **Approve absent**.
4. **Escalate**: E on the focused APR-2041 row (or the detail button) → priority pill HIGH.
5. **Keyboard claim + approve**: focus the queue group, `j`/`k` to APR-2041, press `c` → toast + owner cell shows J. Sarmiento; press `a` → toast; row leaves; badge decrements after refresh.
6. **Worker executes**: `execSync("npm run worker:once")` (Node `child_process` in the test; 60s timeout) → APR-2041 detail reads EXECUTED; `/inventory?q=BR-LT-0181` redirects to the record showing DEPLOYED · held by Nina Robles; the record's History tab shows the worker's `lifecycle.assign executed` rows; APR-2035 became EXECUTION_FAILED (Failed tab count 2).
7. **Failed card**: APR-2025 detail shows the seeded verbatim workerError text + Retry + Reject buttons.
8. **Reject with reason**: reject APR-2040 via the queue `r` dialog → appears in Closed as REJECTED.
9. **Audit page**: rows render; entity facet filters; **zero checkboxes/menus/buttons in rows** (assert `getByRole("checkbox")` count 0 within the table and no `⋯`); q search narrows.
10. **Activity feeds**: `/inventory/activity` shows sentences (e.g. the worker's executed entry), `/employees/activity` renders; no domain pills on scoped feeds.
11. **Axe**: `/approvals`, one detail page, `/audit`, `/inventory/activity`.

- [ ] **Step 2: Full battery** (controller runs this — STOP the dev server before `npm run build`):

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
npm run db:seed && npx playwright test --workers=1
```

- [ ] **Step 3: Docs.** Check off this plan + record deviations; update `docs/HANDOVER.md`: Phase 4 → DONE (what shipped + conventions: approvalTransition/executionPlan/worker lease pattern), write Phase 5 entry criteria (purchasing: `purchaseTransition` state machine TDD-first mirroring approval-flow; NoteEntry append-only thread — never an overwritable column; bounce-back banner is the design problem; `?state=` tab contract already in the nav; PR approvals vs lifecycle approvals distinction).

- [ ] **Step 4: Finish the branch** — merge `phase-4-approvals-audit` to main per the handover workflow (tests verified first), delete the branch, push.

---

## Self-review notes

- Brief §6.2 rules land verbatim in `approval-flow.ts` (Task 1 tests are the spec). README 1k: queue columns/order, owner "—", no self-row highlight, overdue 600-weight fault, Approve-only-after-claim, EXECUTION_FAILED as its own card with verbatim error + Retry/Reject, background-pending card — Tasks 6–7. Worker per spec §2 (FOR UPDATE SKIP LOCKED, lease, EXECUTED/EXECUTION_FAILED verbatim) — Task 8. `/audit` README 3g (absence of interaction is the design) — Task 9. Activity feeds README 4b (one renderer, pill only cross-domain) — Task 10.
- Entry criteria #1–#6 all mapped (worker re-validation Task 8; queue actions Task 5; feeds Task 10; badge via revalidatePath in every action).
- Types referenced across tasks: `ApprovalRow` (T4→T6), `QueueTab` (T3→T4/T6), `executionPlan`/`summarizeApproval` (T2→T4/T8), `entityLabels` (T9→T10), `fmtDateTime` (T9→T10). Worker imports are relative-only (T8 note).



