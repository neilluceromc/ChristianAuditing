# Inventory v2 — Phase 7: Offboarding + repairs + policies Implementation Plan

> ## ⚠ DRAFT — INCOMPLETE. DO NOT EXECUTE AS-IS.
>
> **Written so far:** the header, the recorded scope decisions, the file map, and **Tasks 1–3 only**
> (widen `lifecycle.return`; the pure offboarding rules; the seed fixture). Those three are complete,
> verbatim, and ready.
>
> **Still to write — Tasks 4–11:** offboarding queries · offboarding actions (`decideItem`,
> `completeOffboarding`) · the `/offboarding` queue page · the 4-step wizard · the printable farewell
> report · `src/lib/repairs.ts` + the `stage` facet in `buildAssetWhere` (TDD) · the inventory repair
> mode (chips + Down column) · `/reservations` + the inventory hold marker · `/admin/equipment-policies`
> · the e2e spec, full battery and close-out.
>
> The **File structure** section below already lists every file the whole phase touches, and the
> **entry-criteria mapping** already names which task covers each criterion — use both as the outline
> when finishing the plan. Follow `superpowers:writing-plans`: bite-sized steps, full verbatim code in
> every step, no placeholders.
>
> **Before writing Tasks 4–11, re-read** `design_handover/README.md` cards `3e` (the wizard), `5b`,
> `7b` (repairs), `5c` (reservations) and `4a` (policies) — this draft was written from the brief and
> the handover's entry criteria, and the per-screen design notes carry detail the summaries don't.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The people-lifecycle surfaces — `/offboarding` and its **4-step wizard** where every per-item decision (Returned / Defective / Buyout / **Missing**) creates its own `lifecycle.return` approval the moment it is made, the **repairs saved view** over `?status=DEFECTIVE` with derived stage chips and a Down column, `/reservations`, and `/admin/equipment-policies`.

**Architecture:** The wizard is a **producer of approvals, never a direct asset write** — the Phase 4 worker executes them. Because each decision is persisted immediately, a half-finished offboarding is still N correct records, and "which items are decided" is *derived* from the approvals that exist rather than stored in wizard state. Outcome→status mapping, stage derivation, step gating and the report arithmetic are pure TDD'd functions in `src/lib/`. Repairs adds **no enum**: a `stage` URL facet maps onto the vendor/RMA/quote fields already on `Asset`.

**Tech Stack:** Existing Phase 1–6 conventions (`ActionResult`, `actionRole`, `checkRate`, `writeAudit` + `diffOf`, `createApproval`, url-state, `safeSection`) · Prisma 6 · Vitest · Playwright + axe.

**Conventions for every task:** branch `phase-7-offboarding` (Task 1 creates it); `npx tsc --noEmit && npm run lint` before each commit (lint runs `--max-warnings 0`, so an unused import is a build failure); NEVER `npm run build` while a dev server runs; **no schema changes** — every field this phase needs already exists (`Asset.vendorId/rmaRef/repairQuote/defectiveSince`, `Employee.employment/m365Status`, `Reservation`, `EquipmentPolicy`/`PolicySlot`). DB via `docker compose up -d db`, seed via `npm run db:seed`. Subagents don't start dev servers — the controller owns the preview. **Restart the preview before any full-suite confirmation run** (Phase 6 gotcha).

**Seed facts this phase leans on:** **Dennis Ong EMP-0090** is `OFFBOARDING` — the wizard's fixture — though he currently holds **nothing**, so Task 3 adds held items to him (see scope decision #8) · **APR-2040** is a `lifecycle_return` PENDING approval for Dennis · 6 `DEFECTIVE` assets spanning the repair stages: **BR-LT-0122** (no vendor, no RMA → `TO ASSESS`), **BR-LT-0118** + **BR-MN-0731** + **BR-DK-0033** (vendor + RMA → `AT VENDOR`), **BR-LT-0090** (repairQuote ₱18,400 against ₱55,000 cost → `BEYOND REPAIR`), **BR-KB-0402** (no vendor → `TO ASSESS`) · 4 reservations, one per state (ACTIVE on BR-MN-0910 for Nina EMP-0097) · one `EquipmentPolicy` "Finance standard" with 6 slots.

**Entry criteria this plan implements (HANDOVER §6):** #1 each decision creates its own approval immediately (Tasks 4, 6) · #2 `Missing` is first-class, reason required for anything but Returned, Continue blocked while undecided (Tasks 2, 6) · #3 the 4 steps incl. the farewell receipt (Tasks 6, 7) · #4 repairs is a saved view with no new enum (Tasks 8, 9) · #5 `/reservations`, reserved stock still reads SPARE with a hold marker (Task 10) · #6 policies, editing never touches assignments, audit records both slot lists (Task 11) · #7 reuse `computeLoadout`/`resolvePolicy` (Tasks 3, 11) · #8 wizard step lives in `?step=` (Tasks 2, 6).

---

## Recorded scope decisions

1. **`lifecycle.return` must learn three more outcomes — this is the phase's first blocker.** `executionPlan` currently hard-requires `to.status === "SPARE"` (`src/lib/approval-execution.ts`), so a Defective / Buyout / Missing decision would become `EXECUTION_FAILED` with "Malformed lifecycle.return payload". Task 1 widens it to accept `SPARE | DEFECTIVE | BUYOUT | MISSING`, always clearing the assignee. A return is *the item coming back from a person*; what state it comes back **in** is exactly what the wizard is asking.
2. **The assignee is cleared for all four outcomes**, Missing included. The person has left; the item is no longer held by an employee. Who it came from survives in the approval payload (`from.assigneeId`) and in the audit diff — that is the custody trail, and it is a better record than a dangling assignment to someone who no longer works here.
3. **"Decided" is derived, not stored.** An item is decided when a `lifecycle.return` approval exists for that asset in any non-rejected state (`PENDING | CLAIMED | APPROVED | EXECUTED | EXECUTION_FAILED`). No wizard-state table, no draft to lose — which is precisely what makes a half-finished offboarding N correct records. A **REJECTED** return re-opens the item for a new decision.
4. **The wizard's step lives in `?step=`** so a refresh keeps the operator's place; the decisions themselves are already durable as approvals.
5. **Repairs adds a `stage` URL facet, not an enum.** `buildAssetWhere` maps `stage` onto fields that already exist: `TO ASSESS` = DEFECTIVE with no vendor and no RMA · `AT VENDOR` = DEFECTIVE with a vendor or an RMA · `BEYOND REPAIR` = DEFECTIVE with a quote at or above **60%** of the asset's cost · `RETURNED OK` = has a `defectiveSince` but no longer reads DEFECTIVE. The last one deliberately steps outside `status=DEFECTIVE`, which is why it is a URL the chip writes rather than a client-side filter.
6. **The 60% beyond-repair threshold is a stated default, not a discovered truth** — `REPAIR_WRITE_OFF_SHARE` in one place, so a business decision to move it is a one-line change. The warning copy names the share.
7. **Step 3 (Accounts & M365) sets `m365Status` to `inactive` and, on completion, `employment` to `OFFBOARDED`.** Completing the wizard does NOT touch assets — every asset movement went through its own approval.
8. **The seed gains held items for Dennis Ong.** He is the only `OFFBOARDING` employee and currently holds nothing, so the wizard's own fixture cannot exercise it (the same class of gap Phase 6 found twice). Task 3 assigns him three assets spanning the interesting cases, and the pre-existing `LEAVE` shift row on Home changes from "equipment returned" back to "3 items still out" — an intended, asserted change.
9. **The farewell report is a printable page**, mirroring `/employees/[id]/form` (light-theme sheet + `PrintButton`). "Emailable to HR" and a real Excel export are Phase 8's export work — the receipt itself ships here.
10. **`/reservations` is read-only this phase.** Creating and releasing holds already exist on the asset record (Phase 3); this is the cross-asset view the sidebar has been linking to, plus the hold marker the inventory list is missing.
11. **Equipment-policy edits never touch existing assignments** — the audit entry records **both** slot lists (`before.slots` and `after.slots`) so the change to "what counts as complete" is legible after the fact.

---

## File structure created/modified in this phase

```
src/lib/
  approval-execution.ts (+ .test.ts)   (modify — lifecycle_return accepts four outcomes)
  offboarding.ts (+ .test.ts)          (create — OUTCOMES, OUTCOME_STATUS, reasonRequired,
                                        WIZARD_STEPS/parseStep, decisionOf, reportTotals; pure, TDD)
  repairs.ts (+ .test.ts)              (create — REPAIR_STAGES, repairStage, downDays,
                                        quoteWarning, REPAIR_WRITE_OFF_SHARE; pure, TDD)
  inventory-list.ts (+ .test.ts)       (modify — `stage` facet in buildAssetWhere)
src/server/modules/offboarding/
  queries.ts                           (create — listOffboarding, getWizard)
  actions.ts                           (create — decideItem, completeOffboarding)
src/server/modules/reservations/queries.ts (create)
src/server/modules/admin/policy-actions.ts (create — create/rename/delete policy, add/remove slot)
src/components/offboarding/
  item-decision.tsx                    (create — client: the 4-way control + reason)
  wizard-steps.tsx                     (create — server: the 4-stop step bar)
src/components/inventory/repair-chips.tsx  (create — server: stage chips writing the URL)
src/components/admin/policy-editor.tsx     (create — client: slots as chips, inline add)
src/app/(app)/offboarding/page.tsx                    (create — the queue)
src/app/(app)/offboarding/[employeeId]/page.tsx       (create — the wizard)
src/app/(app)/offboarding/[employeeId]/report/page.tsx (create — the printable receipt)
src/app/(app)/reservations/page.tsx                   (create)
src/app/(app)/admin/equipment-policies/page.tsx       (create)
src/app/(app)/inventory/page.tsx                      (modify — repair mode: chips + Down column)
prisma/seed.ts                                        (modify — Dennis holds items)
e2e/offboarding.spec.ts                               (create)
```

`executionPlan` stays the ONLY place a payload becomes an asset update. The wizard writes approvals; the worker moves assets.

---

### Task 1: Branch + teach `lifecycle.return` the four outcomes (TDD)

Without this, three of the wizard's four decisions become `EXECUTION_FAILED` the moment the worker picks them up.

**Files:**
- Modify: `src/lib/approval-execution.ts`, `src/lib/approval-execution.test.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-7-offboarding
```

- [ ] **Step 2: Write the failing tests** (append to the `executionPlan` describe in `src/lib/approval-execution.test.ts`)

```ts
  it("return: accepts every offboarding outcome, always clearing the holder", () => {
    const cases = [
      ["SPARE", "SPARE"],
      ["DEFECTIVE", "DEFECTIVE"],
      ["BUYOUT", "BUYOUT"],
      ["MISSING", "MISSING"],
    ] as const;
    for (const [target, expected] of cases) {
      expect(
        executionPlan("lifecycle_return", { from: { assigneeId: "emp1" }, to: { assigneeId: null, status: target } }),
      ).toEqual({ ok: true, updates: { assigneeId: null, status: expected } });
    }
  });

  it("return: refuses a target that isn't an offboarding outcome", () => {
    for (const bad of ["DEPLOYED", "TEMPORARY", "DONATED", "DISPOSE"]) {
      const plan = executionPlan("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: bad } });
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error).toMatch(new RegExp(bad));
    }
  });

  it("return: still refuses a payload with no target status at all", () => {
    const plan = executionPlan("lifecycle_return", { from: { assigneeId: "e" } });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/lifecycle\.return/);
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- src/lib/approval-execution.test.ts` — Expected: FAIL (DEFECTIVE/BUYOUT/MISSING are refused today).

- [ ] **Step 4: Implement** — replace the `case "lifecycle_return":` block in `src/lib/approval-execution.ts` with:

```ts
    case "lifecycle_return": {
      const to = obj(p.to);
      const status = to ? str(to.status) : null;
      // A return is the item coming back from a person; WHAT STATE it comes
      // back in is exactly what the offboarding wizard asks (README 3e:
      // Returned / Defective / Buyout / Missing, with Missing first-class).
      // The holder is cleared either way — the person has left, and who it
      // came from survives in from.assigneeId and in the audit diff.
      if (!status || !(RETURN_STATUSES as readonly string[]).includes(status)) {
        return {
          ok: false,
          error: `Malformed lifecycle.return payload: to.status must be one of ${RETURN_STATUSES.join(", ")}, got ${JSON.stringify(payload)}`,
        };
      }
      return { ok: true, updates: { assigneeId: null, status: status as AssetStatus } };
    }
```

and add this constant just below the `str` helper near the top of the file:

```ts
/** The four outcomes an item can come back in (README 3e). */
export const RETURN_STATUSES = ["SPARE", "DEFECTIVE", "BUYOUT", "MISSING"] as const satisfies readonly AssetStatus[];
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -- src/lib/approval-execution.test.ts` — Expected: PASS, including the pre-existing SPARE case.

- [ ] **Step 6: Check the worker still guards correctly**

Read `src/worker/execute-approval.ts`'s `lifecycle_return` branch. It re-validates that the asset is still held by the expected employee — which is correct for all four outcomes and needs NO change. Confirm that in your report; do not edit the worker.

- [ ] **Step 7: Full unit suite, typecheck, lint, commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/approval-execution.ts src/lib/approval-execution.test.ts
git commit -m "feat(approvals): a return can come back SPARE, DEFECTIVE, BUYOUT or MISSING"
```

---

### Task 2: The offboarding rules (TDD)

**Files:**
- Create: `src/lib/offboarding.ts`, `src/lib/offboarding.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/offboarding.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, WIZARD_STEPS, canContinue, parseStep,
  reasonRequired, reportTotals, type Outcome,
} from "./offboarding";

describe("outcomes — Missing is first-class", () => {
  it("offers exactly the four the design names, in order", () => {
    expect(OUTCOMES).toEqual(["RETURNED", "DEFECTIVE", "BUYOUT", "MISSING"]);
    expect(OUTCOME_LABEL.MISSING).toBe("Missing");
  });

  it("maps each outcome to the asset status the worker will apply", () => {
    expect(OUTCOME_STATUS).toEqual({
      RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
    });
  });

  it("requires a reason for everything except a clean return", () => {
    expect(reasonRequired("RETURNED")).toBe(false);
    for (const o of ["DEFECTIVE", "BUYOUT", "MISSING"] as Outcome[]) {
      expect(reasonRequired(o)).toBe(true);
    }
  });
});

describe("the four steps", () => {
  it("names them in order", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["review", "collect", "accounts", "report"]);
    expect(WIZARD_STEPS[3].label).toBe("Farewell report");
  });

  it("parses ?step= and falls back to the first step", () => {
    expect(parseStep("collect")).toBe("collect");
    expect(parseStep(null)).toBe("review");
    expect(parseStep("nonsense")).toBe("review");
    expect(parseStep("REVIEW")).toBe("review"); // case-sensitive contract, no silent coercion
  });
});

describe("canContinue — undecided is not the same as returned", () => {
  it("blocks leaving Collect while any item is undecided", () => {
    expect(canContinue("collect", { undecided: 2 })).toBe(false);
    expect(canContinue("collect", { undecided: 0 })).toBe(true);
  });
  it("never blocks the steps that aren't about items", () => {
    for (const step of ["review", "accounts", "report"] as const) {
      expect(canContinue(step, { undecided: 5 })).toBe(true);
    }
  });
});

describe("reportTotals — what the receipt claims", () => {
  const items = [
    { outcome: "RETURNED" as Outcome, cost: 55_000 },
    { outcome: "DEFECTIVE" as Outcome, cost: 12_000 },
    { outcome: "BUYOUT" as Outcome, cost: 30_000 },
    { outcome: "MISSING" as Outcome, cost: 18_000 },
    { outcome: "RETURNED" as Outcome, cost: null },
  ];

  it("counts kit that came back as recovered, and says so separately from money in and value lost", () => {
    const t = reportTotals(items);
    expect(t.recovered).toBe(67_000); // returned + defective — both are back in the fleet
    expect(t.boughtOut).toBe(30_000); // the employee paid for it
    expect(t.lost).toBe(18_000);      // missing is a loss, not a recovery
  });

  it("counts every item even when its cost is unknown", () => {
    const t = reportTotals(items);
    expect(t.counts.RETURNED).toBe(2);
    expect(t.counts.MISSING).toBe(1);
    expect(t.total).toBe(5);
  });

  it("is all zeros for nothing held", () => {
    expect(reportTotals([])).toEqual({
      recovered: 0, boughtOut: 0, lost: 0, total: 0,
      counts: { RETURNED: 0, DEFECTIVE: 0, BUYOUT: 0, MISSING: 0 },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/offboarding.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/offboarding.ts`**

```ts
import type { AssetStatus } from "@prisma/client";

/**
 * README 3e: per item, a 4-way control — Returned / Defective / Buyout /
 * **Missing**. Missing is first-class because "pretending everything comes
 * back is why spreadsheets drift", and a reason is required for anything
 * other than a clean return.
 */
export const OUTCOMES = ["RETURNED", "DEFECTIVE", "BUYOUT", "MISSING"] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  RETURNED: "Returned", DEFECTIVE: "Defective", BUYOUT: "Buyout", MISSING: "Missing",
};

/** What the worker will set the asset to — the payload's `to.status`. */
export const OUTCOME_STATUS: Record<Outcome, AssetStatus> = {
  RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
};

export function reasonRequired(outcome: Outcome): boolean {
  return outcome !== "RETURNED";
}

export const WIZARD_STEPS = [
  { id: "review", label: "Review holdings" },
  { id: "collect", label: "Collect items" },
  { id: "accounts", label: "Accounts & M365" },
  { id: "report", label: "Farewell report" },
] as const;

export type StepId = (typeof WIZARD_STEPS)[number]["id"];

/** `?step=` keeps the operator's place across a refresh (entry criterion #8). */
export function parseStep(raw: string | null | undefined): StepId {
  return (WIZARD_STEPS.some((s) => s.id === raw) ? raw : "review") as StepId;
}

/**
 * Continue is blocked while any item is undecided — undecided is NOT the same
 * as Returned, and defaulting it to one would be the exact drift this screen
 * exists to prevent.
 */
export function canContinue(step: StepId, state: { undecided: number }): boolean {
  return step !== "collect" || state.undecided === 0;
}

export interface ReportItem {
  outcome: Outcome;
  cost: number | null;
}

export interface ReportTotals {
  /** back in the fleet: returned + defective */
  recovered: number;
  /** the employee paid for it */
  boughtOut: number;
  /** custody lost */
  lost: number;
  total: number;
  counts: Record<Outcome, number>;
}

export function reportTotals(items: ReportItem[]): ReportTotals {
  const counts: Record<Outcome, number> = { RETURNED: 0, DEFECTIVE: 0, BUYOUT: 0, MISSING: 0 };
  let recovered = 0;
  let boughtOut = 0;
  let lost = 0;
  for (const item of items) {
    counts[item.outcome] += 1;
    const value = item.cost ?? 0;
    if (item.outcome === "RETURNED" || item.outcome === "DEFECTIVE") recovered += value;
    else if (item.outcome === "BUYOUT") boughtOut += value;
    else lost += value;
  }
  return { recovered, boughtOut, lost, total: items.length, counts };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/offboarding.test.ts` — Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/offboarding.ts src/lib/offboarding.test.ts
git commit -m "feat(offboarding): outcomes, step contract and the receipt's arithmetic"
```

---

### Task 3: Give the wizard something to collect (seed)

Dennis Ong is the only `OFFBOARDING` employee and holds **nothing**, so the screen this phase is built around cannot be exercised against the seed. Phase 6 hit this twice; fix the fixture rather than the assertion.

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Assign Dennis three items spanning the interesting cases**

In the `prisma.asset.createMany` block, add `assigneeId: emp("EMP-0090").id` and set `status` to `DEPLOYED` for three currently-unassigned assets. Replace these three lines:

```ts
      mk("BR-LT-0210", "ThinkPad T14 Gen 4", "Laptop", "TEMPORARY", { assigneeId: emp("EMP-0095").id }),
      mk("BR-PH-0301", "Samsung A54", "Phone", "SPARE", { cost: 18_000 }),
      mk("BR-HS-0502", "Jabra Evolve2 40", "Headset", "SPARE", { cost: 5_500 }),
```

with:

```ts
      mk("BR-LT-0210", "ThinkPad T14 Gen 4", "Laptop", "TEMPORARY", { assigneeId: emp("EMP-0095").id }),
      // Dennis (EMP-0090) is the OFFBOARDING fixture — the wizard needs him to
      // actually hold things, one per interesting outcome: a clean return, a
      // machine that comes back broken, and the phone nobody can find.
      mk("BR-LT-0166", "ThinkPad T14 Gen 2", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 48_000, purchasedAt: day(-1150) }),
      mk("BR-PH-0301", "Samsung A54", "Phone", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 18_000 }),
      mk("BR-HS-0502", "Jabra Evolve2 40", "Headset", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 5_500 }),
```

- [ ] **Step 2: Reseed and verify**

```bash
npm run db:seed
```

Then confirm with a throwaway script (scratchpad, deleted after) that Dennis holds exactly 3 assets and that the fleet still totals 23 (one asset was added).

- [ ] **Step 3: Fix the counts every existing spec asserts**

Adding an asset and moving two out of `SPARE` changes numbers other phases pinned. Run the full e2e suite and fix **only** the count assertions that legitimately changed:

```bash
npx playwright test --workers=1
```

Expect breakage in at least: Home's fleet label (`Fleet of 22 assets by status` → 23), the age histogram aria-label, the fleet coverage line (fewer spares), Home's `LEAVE` row (Dennis now reads "3 items still out · Collect equipment" instead of "equipment returned"), and possibly `/finance/assets` totals. **Each edit must be a number, not a weakened assertion** — if you find yourself deleting an expectation, stop and report.

- [ ] **Step 4: Full unit suite, typecheck, lint, commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add prisma/seed.ts e2e
git commit -m "test(seed): the offboarding fixture actually holds equipment"
```

---
