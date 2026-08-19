# Inventory v2 — Phase 7: Offboarding + repairs + policies Implementation Plan

> ## Complete — 15 tasks, ready to execute.
>
> Finished 2026-08-18 from `design_handover/README.md` cards `3e` / `5b` / `7b` / `5c` / `4a`. Three
> things the earlier draft had wrong were corrected while finishing it, and each is worth knowing
> before you start:
>
> - **Task 1 grew two steps.** Widening `lifecycle.return` also has to fix the two places that read a
>   return payload with `SPARE` hard-coded: the queue's change-cell summary (`summarizeApproval`) and
>   the "Return target" system check on the approval detail. Left alone, both would have lied about
>   three of the four outcomes.
> - **Task 3 gives Dennis three NEW assets** instead of repurposing two seeded spares. The draft's
>   version would have taken `BR-HS-0502` — the only spare headset, which `it-core.spec.ts` picks to
>   fill Marites' policy gap — and changed Home's coverage line. Adding assets keeps the spare pool
>   intact, so only the fleet total and the age histogram move.
> - **The 60% write-off line means the seed had no `BEYOND REPAIR` row** (`BR-LT-0090`'s ₱18,400 quote
>   is 33% of its cost) and no `RETURNED OK` row at all. Task 11 fixes both fixtures.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The people-lifecycle surfaces — `/offboarding` and its **4-step wizard** where every per-item decision (Returned / Defective / Buyout / **Missing**) creates its own `lifecycle.return` approval the moment it is made, the **repairs saved view** over `?status=DEFECTIVE` with derived stage chips and a Down column, `/reservations`, and `/admin/equipment-policies`.

**Architecture:** The wizard is a **producer of approvals, never a direct asset write** — the Phase 4 worker executes them. Because each decision is persisted immediately, a half-finished offboarding is still N correct records, and "which items are decided" is *derived* from the approvals that exist rather than stored in wizard state. Outcome→status mapping, stage derivation, step gating and the report arithmetic are pure TDD'd functions in `src/lib/`. Repairs adds **no enum**: a `stage` URL facet maps onto the vendor/RMA/quote fields already on `Asset`.

**Tech Stack:** Existing Phase 1–6 conventions (`ActionResult`, `actionRole`, `checkRate`, `writeAudit` + `diffOf`, `createApproval`, url-state, `safeSection`) · Prisma 6 · Vitest · Playwright + axe.

**Conventions for every task:** branch `phase-7-offboarding` (Task 1 creates it); `npx tsc --noEmit && npm run lint` before each commit (lint runs `--max-warnings 0`, so an unused import is a build failure); NEVER `npm run build` while a dev server runs; **one schema change only** — `Employee.offboardingAt` (Task 5, added after a review found the wizard billing years-old returns to a farewell report); everything else this phase needs already exists (`Asset.vendorId/rmaRef/repairQuote/defectiveSince`, `Employee.employment/m365Status`, `Reservation`, `EquipmentPolicy`/`PolicySlot`). DB via `docker compose up -d db`, seed via `npm run db:seed`. Subagents don't start dev servers — the controller owns the preview. **Restart the preview before any full-suite confirmation run** (Phase 6 gotcha).

**Seed facts this phase leans on:** **Dennis Ong EMP-0090** is `OFFBOARDING` — the wizard's fixture — though he currently holds **nothing**, so Task 3 gives him three new assets (see scope decision #8) · **APR-2040** is a `lifecycle_return` PENDING approval for Dennis with **no asset and no target status**, so it decides nothing and every reader must ignore it · 6 `DEFECTIVE` assets: **BR-LT-0122** and **BR-KB-0402** (no vendor, no RMA → `to-assess`), **BR-LT-0118** + **BR-MN-0731** + **BR-DK-0033** (vendor + RMA → `at-vendor`), **BR-LT-0090** (₱18,400 quote against a ₱55,000 cost = 33%, so it reads `to-assess` today — **Task 11 raises the quote to ₱34,000 so a `beyond-repair` row exists at all**) · nothing reaches `returned-ok` until Task 11 gives **BR-MN-0911** a `defectiveSince` · 4 reservations, one per state (ACTIVE on BR-MN-0910 for Nina EMP-0097) · one `EquipmentPolicy` "Finance standard" with 6 slots, 5 required.

**Entry criteria this plan implements (HANDOVER §6):** #1 each decision creates its own approval immediately (Tasks 6, 9) · #2 `Missing` is first-class, reason required for anything but Returned, Continue blocked while undecided (Tasks 2, 6, 8, 9) · #3 the 4 steps incl. the farewell receipt (Tasks 9, 10) · #4 repairs is a saved view with no new enum (Tasks 11, 12) · #5 `/reservations`, reserved stock still reads SPARE with a hold marker (Tasks 12, 13) · #6 policies, editing never touches assignments, audit records both slot lists (Task 14) · #7 reuse `computeLoadout`/`resolvePolicy` (Tasks 5, 14) · #8 wizard step lives in `?step=` (Tasks 2, 9).

**Task map:** 1 widen `lifecycle.return` (+ its two readers) · 2 the offboarding rules · 3 the seed fixture · 4 derive a decision from approvals · 5 offboarding queries · 6 offboarding actions · 7 the `/offboarding` queue · 8 the wizard's four components · 9 the 4-step wizard page · 10 the printable farewell report · 11 the repairs brain (+ two seed fixtures + the worker's down-clock stamp) · 12 repair mode on the inventory list (+ the hold marker) · 13 `/reservations` · 14 `/admin/equipment-policies` · 15 e2e, cleanup, battery, close-out.

---

## Recorded scope decisions

1. **`lifecycle.return` must learn three more outcomes — this is the phase's first blocker.** `executionPlan` currently hard-requires `to.status === "SPARE"` (`src/lib/approval-execution.ts`), so a Defective / Buyout / Missing decision would become `EXECUTION_FAILED` with "Malformed lifecycle.return payload". Task 1 widens it to accept `SPARE | DEFECTIVE | BUYOUT | MISSING`, always clearing the assignee. A return is *the item coming back from a person*; what state it comes back **in** is exactly what the wizard is asking.
2. **The assignee is cleared for all four outcomes**, Missing included. The person has left; the item is no longer held by an employee. Who it came from survives in the approval payload (`from.assigneeId`) and in the audit diff — that is the custody trail, and it is a better record than a dangling assignment to someone who no longer works here.
3. **"Decided" is derived, not stored.** An item is decided when a `lifecycle.return` approval exists for that asset in any non-rejected state (`PENDING | CLAIMED | APPROVED | EXECUTED | EXECUTION_FAILED`). No wizard-state table, no draft to lose — which is precisely what makes a half-finished offboarding N correct records. A **REJECTED** return re-opens the item for a new decision.
4. **The wizard's step lives in `?step=`** so a refresh keeps the operator's place; the decisions themselves are already durable as approvals.
5. **Repairs adds a `stage` URL facet, not an enum.** The four stages map onto fields that already exist: `TO ASSESS` = DEFECTIVE with no vendor and no RMA · `AT VENDOR` = DEFECTIVE with a vendor or an RMA · `BEYOND REPAIR` = DEFECTIVE with a quote at or above **60%** of the asset's cost · `RETURNED OK` = has a `defectiveSince` but no longer reads DEFECTIVE. The last one deliberately steps outside `status=DEFECTIVE`, which is why it is a URL the chip writes rather than a client-side filter. URL values are slugs (`beyond-repair`), not the display words, so no stage ever depends on how a space survives a round trip through the query string.
5b. **`BEYOND REPAIR` compares two columns, which no Prisma filter can express.** So `buildAssetWhere` narrows a `stage` selection to the repair *candidate* set (`status=DEFECTIVE OR defectiveSince IS NOT NULL`) and `repairStage()` — the same pure function that renders the Stage column — makes the final cut inside `listAssets`, which then counts and paginates the cut set. One source of truth, honest counts, in-memory paging justified by the same team-scale reasoning as the employees list.
6. **The 60% beyond-repair threshold is a stated default, not a discovered truth** — `REPAIR_WRITE_OFF_SHARE` in one place, so a business decision to move it is a one-line change. The warning copy names the share.
7. **Step 3 (Accounts & M365) sets `m365Status` to `inactive` and, on completion, `employment` to `OFFBOARDED`.** Completing the wizard does NOT touch assets — every asset movement went through its own approval.
8. **The seed gains held items for Dennis Ong — three NEW assets, not repurposed spares.** He is the only `OFFBOARDING` employee and currently holds nothing, so the wizard's own fixture cannot exercise it (the same class of gap Phase 6 found twice). Task 3 registers three new assets against him, one per interesting outcome. Consuming existing spares instead would have taken `BR-HS-0502` — the only spare headset, which `it-core.spec.ts` picks to fill Marites' policy gap — and moved Home's "spare pool covers 4 of the 10 slots" line. This way the only assertions that legitimately change are the fleet total (22 → 25), the age histogram, and Home's `LEAVE` row, which goes from "equipment returned" back to "3 items still out".
9. **The farewell report is a printable page**, mirroring `/employees/[id]/form` (light-theme sheet + `PrintButton`). "Emailable to HR" and a real Excel export are Phase 8's export work — the receipt itself ships here.
10. **`/reservations` is read-only this phase.** Creating and releasing holds already exist on the asset record (Phase 3); this is the cross-asset view the sidebar has been linking to, plus the hold marker the inventory list is missing.
11. **Equipment-policy edits never touch existing assignments** — the audit entry records **both** slot lists (`before.slots` and `after.slots`) so the change to "what counts as complete" is legible after the fact. A slot must name an asset type: `computeLoadout` matches on type, so a typeless slot could never be filled and would be a permanent policy gap. A policy must target exactly one of a role title or a department, because role beats department and a policy targeting both would hide which rule won.
12. **An offboarding cannot be completed while the M365 account is still live.** `completeOffboarding` refuses unless `m365Status` reads `inactive` or `null` (never synced — there was no account to close). This is not in the brief; it is what makes step 3 load-bearing rather than decorative, and the refusal names the current value so the operator knows where to go. A client-defined custom status therefore has to be set to `inactive` before completion. **Amended after the Task 8 review: `null` passes only as the ABSENCE of a status, never as the erasure of one.** `closeAccounts` maps `""` → `null`, so the panel's own "no sync yet" option — and, silently, a "custom…" selection left empty — could turn a live `active` into a gate-passing `null` and complete the offboarding on an open mailbox, stamping `m365Status: { from: null, to: null }` on the immutable completion audit. `closeAccounts` now refuses `next === null` when the stored value is non-null (correcting a genuinely wrong value back to unknown stays available on the employee record), and the panel refuses an empty custom value before it is ever sent.
13. **Repairs is reached by a named URL, not a new nav item.** Brief §2's IT sidebar is verbatim and has no Repairs entry, and the README calls saved views named URLs — so a **Repairs** button sits in the inventory toolbar pointing at `?status=DEFECTIVE&sort=defectiveSince`. The sort deviates from the README's `-updatedAt`: `updatedAt` is not in the list's sortable contract, and the design's own point is that **Down** is the column that changes behaviour, so the saved view sorts by `defectiveSince` (longest down first) and the Down header is sortable.
14. **The wizard's step-2 control needs an "undecided" state.** `SegmentedControl` parks its sliding indicator under option 1 when nothing matches, which would make undecided read as Returned — the exact drift entry criterion #2 forbids. Task 8 teaches the primitive to draw no indicator when the value matches no option; every existing caller passes a real value, so nothing else changes.

---

## File structure created/modified in this phase

```
src/lib/
  approval-execution.ts (+ .test.ts)   (modify — lifecycle_return accepts four outcomes; the
                                        queue summary names the real one)
  offboarding.ts (+ .test.ts)          (create — OUTCOMES, OUTCOME_STATUS, reasonRequired,
                                        WIZARD_STEPS/parseStep, canContinue, reportTotals, then
                                        outcomeOfStatus/returnTargetStatus/decisionOf; pure, TDD)
  repairs.ts (+ .test.ts)              (create — REPAIR_STAGES, repairStage, downDays, quoteWarning,
                                        isRepairView, REPAIR_WRITE_OFF_SHARE, REPAIRS_SAVED_VIEW; TDD)
  inventory-list.ts (+ .test.ts)       (modify — `stage` facet + defectiveSince sortable)
src/server/
  modules/offboarding/queries.ts       (create — listOffboarding, getWizard)
  modules/offboarding/actions.ts       (create — decideItem, closeAccounts, completeOffboarding)
  modules/reservations/queries.ts      (create — RESERVATION_TABS, listReservations)
  modules/admin/policy-actions.ts      (create — create/delete policy, add/remove slot, toggle required)
  modules/inventory/queries.ts         (modify — AssetRow gains stage/down/hold; stage paging)
  modules/approvals/queries.ts         (modify — the "Return target" check accepts all four)
  modules/employees/queries.ts         (modify — stable policy order)
  modules/home/queries.ts              (modify — stable policy order; LEAVE row opens the wizard)
src/worker/execute-approval.ts         (modify — start defectiveSince when an item becomes DEFECTIVE)
prisma/migrations/20260818090000_employee_offboarding_anchor/  (create — Employee.offboardingAt + backfill)
src/components/
  ui/segmented-control.tsx             (modify — no indicator when nothing is chosen)
  offboarding/wizard-steps.tsx         (create — server: the 4-stop step bar)
  offboarding/item-decision.tsx        (create — client: the 4-way control + reason)
  offboarding/accounts-panel.tsx       (create — client: the M365 select, step 3)
  offboarding/complete-button.tsx      (create — client: the completion dialog, step 4)
  inventory/repair-chips.tsx           (create — server: stage chips writing the URL)
  inventory/inventory-table.tsx        (modify — Stage + Down columns, the HOLD marker)
  admin/policy-editor.tsx              (create — client: slot chips, inline add, new-policy card)
src/app/(app)/offboarding/page.tsx                    (create — the queue)
src/app/(app)/offboarding/[employeeId]/page.tsx       (create — the wizard)
src/app/(app)/offboarding/[employeeId]/report/page.tsx (create — the printable receipt)
src/app/(app)/reservations/page.tsx                   (create)
src/app/(app)/admin/equipment-policies/page.tsx       (create)
src/app/(app)/inventory/page.tsx                      (modify — repair mode: chips + saved-view link)
src/app/(app)/inventory/[id]/page.tsx                 (modify — the Repair card + quote warning)
src/app/(app)/employees/[id]/page.tsx                 (modify — stable policy order)
src/app/(app)/[...pending]/page.tsx                   (modify — drop the Phase 7 placeholder)
prisma/seed.ts                                        (modify — Dennis holds three items; the
                                                       beyond-repair and returned-ok fixtures)
e2e/offboarding.spec.ts                               (create)
e2e/home-finance.spec.ts                              (modify — fleet 22 → 25, age buckets)
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

  it("return: refuses a target that isn't an offboarding outcome, naming it", () => {
    for (const bad of ["DEPLOYED", "TEMPORARY", "DONATED", "DISPOSE"]) {
      const plan = executionPlan("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: bad } });
      expect(plan.ok).toBe(false);
      // the offending value must END the message, not merely appear inside a
      // JSON dump of the whole payload — this is copy an operator reads verbatim
      if (!plan.ok) expect(plan.error).toMatch(new RegExp(`got ${bad}$`));
    }
  });

  it("return: still refuses a payload with no target status at all", () => {
    const plan = executionPlan("lifecycle_return", { from: { assigneeId: "e" } });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/lifecycle\.return/);
  });
```

Then append this to the **`summarizeApproval`** describe further down the same file — the queue's change
cell reads the same payload, and it currently hard-codes SPARE:

```ts
  it("return: the summary names the outcome the payload actually asks for", () => {
    const s = summarizeApproval(
      "lifecycle_return",
      { from: { assigneeId: "e" }, to: { assigneeId: null, status: "MISSING" }, reason: "not returned at offboarding" },
      { assetTag: "BR-PH-0301", employeeName: "D. Ong" },
    );
    expect(s.line1).toBe("lifecycle.return · BR-PH-0301");
    expect(s.line2).toBe("D. Ong → MISSING — not returned at offboarding");
  });
  it("return: a payload with no target renders '?', not an invented SPARE (seeded APR-2040 shape)", () => {
    // The detail page shows this line beside a system check reading "no target
    // status in the payload" — the two panes must not contradict each other.
    const s = summarizeApproval("lifecycle_return", { reason: "offboarding" }, { employeeName: "D. Ong" });
    expect(s.line2).toBe("D. Ong → ? — offboarding");
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
      if (!status) {
        return { ok: false, error: `Malformed lifecycle.return payload: expected to.status, got ${JSON.stringify(payload)}` };
      }
      // A disallowed target is not a malformed payload, and the operator reading
      // this in the retry UI needs the offending value, not a JSON blob.
      if (!(RETURN_STATUSES as readonly string[]).includes(status)) {
        return {
          ok: false,
          error: `lifecycle.return target status must be one of ${RETURN_STATUSES.join(", ")}, got ${status}`,
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

- [ ] **Step 5: Stop the queue's summary claiming every return goes to SPARE**

Widening one end of the pipeline means auditing its readers. In the same file, replace the
`case "lifecycle_return":` arm of **`summarizeApproval`**:

```ts
    case "lifecycle_return": {
      const who = names.employeeName ? `${names.employeeName} ` : "";
      return { line1, line2: withReason(`${who}→ SPARE`) };
    }
```

with:

```ts
    case "lifecycle_return": {
      const who = names.employeeName ? `${names.employeeName} ` : "";
      // Four outcomes now, so a hard-coded "→ SPARE" would make the queue's
      // change cell lie about three of them. And a return with no target at all
      // (seeded APR-2040) gets "?", not an invented SPARE: the detail page shows
      // this line beside a system check that says the target is missing, and the
      // two panes must not contradict each other.
      const status = (to ? str(to.status) : null) ?? "?";
      return { line1, line2: withReason(`${who}→ ${status}`) };
    }
```

- [ ] **Step 6: Fix the "Return target" system check the same way**

`src/server/modules/approvals/queries.ts` shows three live findings on an approval's detail page, and
its return check is pinned to SPARE — so a Missing return the worker is about to execute perfectly well
would render as a red cross. Replace:

```ts
        { label: "Return target", pass: to?.status === "SPARE", detail: "returns to SPARE" },
```

with:

```ts
        {
          label: "Return target",
          pass: target !== null && (RETURN_STATUSES as readonly string[]).includes(target),
          detail: target ? `returns as ${target}` : "no target status in the payload",
        },
```

hoisting `target` beside the `expected` const at the top of that same `case` block:

```ts
      const expected = from?.assigneeId ? String(from.assigneeId) : null;
      // Four outcomes (README 3e), so this can't be pinned to SPARE either.
      const target = to && typeof to.status === "string" ? to.status : null;
```

and extend that file's `@/lib/approval-execution` import to:

```ts
import { RETURN_STATUSES, summarizeApproval } from "@/lib/approval-execution";
```

- [ ] **Step 7: Run the tests**

Run: `npm run test -- src/lib/approval-execution.test.ts` — Expected: PASS, including the pre-existing
SPARE cases for both `executionPlan` and `summarizeApproval`.

- [ ] **Step 8: Check the worker still guards correctly**

Read `src/worker/execute-approval.ts`'s `lifecycle_return` branch. It re-validates that the asset is still held by the expected employee — which is correct for all four outcomes and needs NO change. Confirm that in your report; do not edit the worker. (Task 11 adds one unrelated line to that file — the `defectiveSince` stamp — so leave it alone here.)

- [ ] **Step 9: Full unit suite, typecheck, lint, commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/approval-execution.ts src/lib/approval-execution.test.ts src/server/modules/approvals/queries.ts
git commit -m "feat(approvals): a return can come back SPARE, DEFECTIVE, BUYOUT or MISSING"
```

---

### Task 2: The offboarding rules (TDD)

**Files:**
- Create: `src/lib/offboarding.ts`, `src/lib/offboarding.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/offboarding.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { RETURN_STATUSES } from "./approval-execution";
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

  it("agrees with the executor about what a return may become", () => {
    // Two copies of one truth: this map is what the wizard WRITES, RETURN_STATUSES
    // is what executionPlan will ACCEPT. If they ever drift, every decision of the
    // orphaned outcome becomes EXECUTION_FAILED — which is the exact bug Task 1
    // existed to fix. (Raised by the Task 1 code review.)
    expect(new Set(Object.values(OUTCOME_STATUS))).toEqual(new Set(RETURN_STATUSES));
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

/**
 * Which total each outcome feeds. A table rather than an if/else chain because
 * `Record<Outcome, …>` is exhaustive by construction: a fifth outcome is a
 * compile error here, instead of silently landing in `lost` and reporting a
 * financial loss on somebody's farewell receipt.
 */
const OUTCOME_BUCKET: Record<Outcome, "recovered" | "boughtOut" | "lost"> = {
  RETURNED: "recovered",
  DEFECTIVE: "recovered",
  BUYOUT: "boughtOut",
  MISSING: "lost",
};

export function reportTotals(items: ReportItem[]): ReportTotals {
  const counts: Record<Outcome, number> = { RETURNED: 0, DEFECTIVE: 0, BUYOUT: 0, MISSING: 0 };
  const money = { recovered: 0, boughtOut: 0, lost: 0 };
  for (const item of items) {
    // an unknown cost still counts as an item — it just adds no money
    counts[item.outcome] += 1;
    money[OUTCOME_BUCKET[item.outcome]] += item.cost ?? 0;
  }
  return { ...money, total: items.length, counts };
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

- [ ] **Step 1: Register three new assets against Dennis, one per interesting outcome**

**Do not repurpose existing spares.** `BR-HS-0502` is the only spare headset and `it-core.spec.ts`
picks it to fill Marites' policy gap; the spare pool is also what Home's "spare pool covers 4 of the 10
slots" line counts. Adding assets keeps both intact.

In the `prisma.asset.createMany` block, insert these three lines directly after the `BR-LT-0210` line:

```ts
      mk("BR-LT-0210", "ThinkPad T14 Gen 4", "Laptop", "TEMPORARY", { assigneeId: emp("EMP-0095").id }),
      // Dennis (EMP-0090) is the OFFBOARDING fixture — the wizard needs him to
      // actually hold things, one per interesting outcome: a clean return, a
      // machine that comes back broken, and the phone nobody can find. New
      // assets rather than reassigned spares, so the spare pool (and the two
      // specs that lean on it) stay exactly as they were.
      mk("BR-LT-0166", "ThinkPad T14 Gen 2", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 48_000, purchasedAt: day(-1150), warrantyUntil: day(-60) }),
      mk("BR-PH-0312", "Samsung A54", "Phone", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 18_000 }),
      mk("BR-HS-0510", "Jabra Evolve2 40", "Headset", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 5_500 }),
```

- [ ] **Step 2: Reseed and verify the fixture**

```bash
npm run db:seed
```

Then confirm with a throwaway script (write it in the scratchpad, delete it after) that Dennis holds
exactly **3** assets, that the fleet totals **25**, and that `BR-HS-0502` and `BR-PH-0301` are still
`SPARE` and unassigned.

- [ ] **Step 3: Fix the counts the new assets legitimately moved**

Three added assets change three numbers other phases pinned. `BR-LT-0166` lands in the 3–4y age bucket
(`day(-1150)`); the phone and headset take `mk`'s default `day(-720)`, so they land in 1–2y.

In `e2e/home-finance.spec.ts`, update the header comment's "22 assets total" to 25 and replace:

```ts
    await expect(page.getByRole("img", { name: "Fleet of 22 assets by status" })).toBeVisible();
```

with:

```ts
    await expect(page.getByRole("img", { name: "Fleet of 25 assets by status" })).toBeVisible();
```

and:

```ts
    await expect(
      page.getByRole("img", { name: "<1y: 3, 1–2y: 12, 2–3y: 1, 3–4y: 2, 4y+: 4" }),
    ).toBeVisible();
```

with:

```ts
    await expect(
      page.getByRole("img", { name: "<1y: 3, 1–2y: 14, 2–3y: 1, 3–4y: 3, 4y+: 4" }),
    ).toBeVisible();
```

Then run the suite and check nothing else moved:

```bash
npx playwright test --workers=1
```

Home's `LEAVE` row now reads "3 items still out · Collect equipment" instead of "equipment returned" —
intended, and no spec pins that text today. The coverage line must **not** change: if it did, something
consumed a spare, so fix that rather than the assertion. **Every edit here is a number, never a weakened
expectation** — if you find yourself deleting an expectation, stop and report.

- [ ] **Step 4: Full unit suite, typecheck, lint, commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add prisma/seed.ts e2e
git commit -m "test(seed): the offboarding fixture actually holds equipment"
```

---

### Task 4: Reading a decision back out of the approvals (TDD)

Task 2 gave the wizard its vocabulary. This adds the other direction: given the `lifecycle.return`
approvals that exist for an asset, *what did we decide?* Scope decision #3 makes this the only
definition of "decided" — there is no wizard-state table.

**Files:**
- Modify: `src/lib/offboarding.ts`, `src/lib/offboarding.test.ts`

- [ ] **Step 1: Widen the test file's import** — replace the import block at the top of `src/lib/offboarding.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, WIZARD_STEPS, canContinue, decisionOf, outcomeOfStatus,
  parseStep, reasonRequired, reportTotals, returnTargetStatus,
  type DecisionCandidate, type Outcome,
} from "./offboarding";
```

- [ ] **Step 2: Write the failing tests** (append to `src/lib/offboarding.test.ts`)

```ts
describe("reading a decision back out of a payload", () => {
  it("maps a payload's target status back to its outcome", () => {
    expect(outcomeOfStatus("SPARE")).toBe("RETURNED");
    expect(outcomeOfStatus("DEFECTIVE")).toBe("DEFECTIVE");
    expect(outcomeOfStatus("BUYOUT")).toBe("BUYOUT");
    expect(outcomeOfStatus("MISSING")).toBe("MISSING");
  });

  it("refuses statuses that aren't offboarding outcomes", () => {
    expect(outcomeOfStatus("DEPLOYED")).toBeNull();
    expect(outcomeOfStatus("")).toBeNull();
    expect(outcomeOfStatus(null)).toBeNull();
  });

  it("digs to.status out of a payload without trusting its shape", () => {
    expect(returnTargetStatus({ to: { status: "MISSING" } })).toBe("MISSING");
    expect(returnTargetStatus({ to: { status: 7 } })).toBeNull();
    // the seeded APR-2040 shape: a return with no target at all
    expect(returnTargetStatus({ reason: "offboarding" })).toBeNull();
    expect(returnTargetStatus({ to: null })).toBeNull();
    expect(returnTargetStatus(null)).toBeNull();
    expect(returnTargetStatus("nope")).toBeNull();
  });
});

describe("decisionOf — decided is derived, and REJECTED re-opens the item", () => {
  const at = (ms: number) => new Date(1_760_000_000_000 + ms);
  const cand = (over: Partial<DecisionCandidate> = {}): DecisionCandidate => ({
    id: "a1", refNo: "APR-2100", state: "PENDING", toStatus: "SPARE",
    reason: null, createdAt: at(0), ...over,
  });

  it("is null when nothing has been decided", () => {
    expect(decisionOf([], { held: true })).toBeNull();
  });

  it("reports the outcome, ref, state and reason of a live decision", () => {
    expect(decisionOf([cand({ toStatus: "MISSING", state: "CLAIMED", reason: "never handed back" })], { held: true })).toEqual({
      refNo: "APR-2100", outcome: "MISSING", state: "CLAIMED", reason: "never handed back",
    });
  });

  it("counts every non-rejected state as decided once the item has left their name", () => {
    for (const state of ["PENDING", "CLAIMED", "APPROVED", "EXECUTED", "EXECUTION_FAILED"]) {
      expect(decisionOf([cand({ state })], { held: false })?.state).toBe(state);
    }
  });

  it("ignores an EXECUTED return on an item they hold again — that one decided an earlier holding", () => {
    // executionPlan always clears the holder, so an EXECUTED return means the
    // asset left their name; holding it now means it came back afterwards. Left
    // in, a laptop returned once and later reassigned would read "decided"
    // forever and the wizard would complete with it still assigned.
    expect(decisionOf([cand({ state: "EXECUTED" })], { held: true })).toBeNull();
    // EXECUTION_FAILED never moved the asset, so while held it still decides
    for (const state of ["PENDING", "CLAIMED", "APPROVED", "EXECUTION_FAILED"]) {
      expect(decisionOf([cand({ state })], { held: true })?.state).toBe(state);
    }
  });

  it("a stale EXECUTION_FAILED from a previous holding does not decide this one", () => {
    // R1 failed transiently and nobody retried or rejected it; R2 was requested
    // later and executed, ending that holding; the asset came back afterwards.
    // Only what was created after the newest EXECUTED return belongs here.
    expect(decisionOf([
      cand({ id: "r1", refNo: "APR-2100", state: "EXECUTION_FAILED", createdAt: at(1_000) }),
      cand({ id: "r2", refNo: "APR-2101", state: "EXECUTED", createdAt: at(2_000) }),
    ], { held: true })).toBeNull();
  });

  it("a decision made after the last EXECUTED return is this holding's", () => {
    // the boundary must not eat the decision the operator just made
    expect(decisionOf([
      cand({ id: "r2", refNo: "APR-2101", state: "EXECUTED", createdAt: at(2_000) }),
      cand({ id: "r3", refNo: "APR-2102", state: "PENDING", toStatus: "MISSING", createdAt: at(3_000) }),
    ], { held: true })).toMatchObject({ refNo: "APR-2102", outcome: "MISSING" });
  });

  it("ignores a REJECTED return — that item is open for a new decision", () => {
    expect(decisionOf([cand({ state: "REJECTED" })], { held: true })).toBeNull();
  });

  it("ignores a live return whose target is a real asset status but not an outcome", () => {
    expect(decisionOf([cand({ toStatus: "DEPLOYED" })], { held: true })).toBeNull();
  });

  it("after a rejection, the newer decision wins", () => {
    expect(decisionOf([
      cand({ id: "old", refNo: "APR-2100", state: "REJECTED", createdAt: at(0) }),
      cand({ id: "new", refNo: "APR-2101", state: "PENDING", toStatus: "BUYOUT", createdAt: at(5_000) }),
    ], { held: true })).toEqual({ refNo: "APR-2101", outcome: "BUYOUT", state: "PENDING", reason: null });
  });

  it("the newest decision wins even when the older one is also live", () => {
    // the rejection case above cannot pin the sort direction — its older row is
    // filtered out either way. This one has two survivors to order.
    expect(decisionOf([
      cand({ id: "old", refNo: "APR-2100", state: "EXECUTION_FAILED", toStatus: "SPARE", createdAt: at(0) }),
      cand({ id: "new", refNo: "APR-2101", state: "PENDING", toStatus: "MISSING", createdAt: at(5_000) }),
    ], { held: true })).toMatchObject({ refNo: "APR-2101", outcome: "MISSING" });
  });

  it("a newer REJECTED row does not re-open an item whose older decision is still live", () => {
    // Deliberate: a rejection re-opens the item, EXCEPT where an earlier
    // retryable decision survives — that one can still be retried into effect.
    expect(decisionOf([
      cand({ id: "old", refNo: "APR-2100", state: "EXECUTION_FAILED", createdAt: at(0) }),
      cand({ id: "new", refNo: "APR-2101", state: "REJECTED", createdAt: at(5_000) }),
    ], { held: true })?.refNo).toBe("APR-2100");
  });

  it("ignores an approval whose payload names no outcome (the seeded APR-2040 shape)", () => {
    expect(decisionOf([cand({ toStatus: null })], { held: true })).toBeNull();
  });

  it("a REJECTED row with no target trips both filters and still decides nothing", () => {
    expect(decisionOf([cand({ state: "REJECTED", toStatus: null })], { held: true })).toBeNull();
  });

  it("breaks a same-millisecond tie by id, so two reads never disagree", () => {
    const rows = [
      cand({ id: "aaa", refNo: "APR-2100", toStatus: "SPARE", createdAt: at(0) }),
      cand({ id: "zzz", refNo: "APR-2101", toStatus: "MISSING", createdAt: at(0) }),
    ];
    expect(decisionOf(rows, { held: true })?.refNo).toBe("APR-2101");
    expect(decisionOf([...rows].reverse(), { held: true })?.refNo).toBe("APR-2101");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- src/lib/offboarding.test.ts` — Expected: FAIL (`outcomeOfStatus`, `returnTargetStatus`, `decisionOf` don't exist).

- [ ] **Step 4: Implement** — append to `src/lib/offboarding.ts`:

```ts
/** Reverse of OUTCOME_STATUS: what a stored payload's target status meant. */
export function outcomeOfStatus(status: string | null | undefined): Outcome | null {
  return OUTCOMES.find((o) => OUTCOME_STATUS[o] === status) ?? null;
}

/** `to.status` out of an approval payload, trusting nothing about its shape. */
export function returnTargetStatus(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const to = (payload as { to?: unknown }).to;
  if (!to || typeof to !== "object" || Array.isArray(to)) return null;
  const status = (to as { status?: unknown }).status;
  return typeof status === "string" && status.length > 0 ? status : null;
}

export interface DecisionCandidate {
  id: string;
  refNo: string;
  state: string;
  /** payload.to.status, already extracted by returnTargetStatus */
  toStatus: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface Decision {
  refNo: string;
  outcome: Outcome;
  state: string;
  reason: string | null;
}

/**
 * "Decided" is DERIVED from the approvals that exist (scope decision #3) —
 * no wizard-state table, which is exactly what makes a half-finished
 * offboarding N correct records instead of a lost session. Every non-rejected
 * state counts, EXECUTION_FAILED included: the decision WAS made, and the
 * operator must not be asked for it twice. A REJECTED return re-opens the item.
 *
 * `held` says whether the employee holds that asset RIGHT NOW, and it is what
 * stops one offboarding inheriting an older one's answer. An EXECUTED return
 * cleared the holder by construction — `executionPlan` hard-codes
 * `assigneeId: null` — so if they hold the thing now, the asset came back to
 * them AFTER that return, and everything up to and including it decided the
 * holding that ended there. Hence the boundary below rather than a bare "skip
 * EXECUTED": a stale EXECUTION_FAILED left behind by an abandoned earlier
 * return would otherwise still answer for this holding. Without any of this, a
 * laptop returned once and later reassigned to the same person reads "decided"
 * forever, and the wizard completes leaving it assigned to someone who no
 * longer works here — the dangling assignment scope decision #2 exists to
 * prevent. An EXECUTION_FAILED *after* the boundary is deliberately kept: that
 * return never moved the asset, so it is still this holding's live, retryable
 * decision.
 */
export function decisionOf(
  candidates: DecisionCandidate[],
  { held }: { held: boolean },
): Decision | null {
  const boundary = held
    ? candidates.reduce(
        (t, c) => (c.state === "EXECUTED" ? Math.max(t, c.createdAt.getTime()) : t),
        -Infinity,
      )
    : -Infinity;
  const live = candidates
    .flatMap((c) => {
      if (c.state === "REJECTED") return [];
      if (c.createdAt.getTime() <= boundary) return [];
      const outcome = outcomeOfStatus(c.toStatus);
      // carrying the outcome on the surviving row makes the winner's
      // non-null-ness structural, instead of an assertion sitting several
      // lines away from the filter that proves it
      return outcome ? [{ ...c, outcome }] : [];
    })
    // Two reads of the same rows must agree. createdAt alone is not a stable
    // order — a worker commit and an operator's decision can land in the same
    // millisecond — so id breaks the tie. Plain comparison rather than
    // localeCompare: this needs to be deterministic, not locale-aware.
    .sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const winner = live[0];
  if (!winner) return null;
  return {
    refNo: winner.refNo,
    outcome: winner.outcome,
    state: winner.state,
    reason: winner.reason,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -- src/lib/offboarding.test.ts` — Expected: PASS (all describes, including Task 2's).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/offboarding.ts src/lib/offboarding.test.ts
git commit -m "feat(offboarding): derive a decision from the return approvals that exist"
```

---

### Task 5: Offboarding queries

Two reads: the queue, and everything one wizard needs. Both lean on `decisionOf`, so "which items are
decided" has exactly one definition. Query modules carry no unit tests in this codebase (the pure libs
they call do) — `tsc` plus the Task 15 e2e spec are their verification.

**Files:**
- Create: `prisma/migrations/20260818090000_employee_offboarding_anchor/migration.sql`,
  `src/server/modules/offboarding/queries.ts`
- Modify: `prisma/schema.prisma`, `prisma/seed.ts`, `src/server/modules/employees/actions.ts`

- [ ] **Step 0: The offboarding anchor**

"This offboarding" has to be a real window. The `−` button on the employee record creates a
`lifecycle.return` on every routine laptop swap, so a read scoped only by `employeeId` bills equipment
handed back years ago to this farewell report — and folds its cost into the value recovered on a signed
document. One nullable column fixes it.

`prisma/migrations/20260818090000_employee_offboarding_anchor/migration.sql`:

```sql
-- "This offboarding" has to be a real, queryable window rather than "all of
-- this person's history". The − button on the employee record creates a
-- lifecycle.return on every routine laptop swap, so without an anchor the
-- offboarding wizard bills equipment somebody handed back years ago to their
-- farewell report — a signed financial document — and folds its cost into the
-- value-recovered total.
ALTER TABLE "Employee" ADD COLUMN "offboardingAt" TIMESTAMP(3);

-- Backfill anyone already past the ACTIVE stage. updatedAt is the closest
-- record we have of when they were marked, and it is strictly better than
-- NULL: a NULL anchor means "no window", so their report would show only
-- what they still hold.
UPDATE "Employee"
   SET "offboardingAt" = "updatedAt"
 WHERE employment IN ('OFFBOARDING', 'OFFBOARDED');
```

In `prisma/schema.prisma`, add to `model Employee` directly after `employment`:

```prisma
  /// stamped when employment becomes OFFBOARDING; bounds "this offboarding" so a
  /// routine return from years ago can't land on a farewell report. Cleared if
  /// they go back to ACTIVE; kept once OFFBOARDED so the report stays readable.
  offboardingAt DateTime?
```

Apply it and regenerate: `npx prisma migrate deploy && npx prisma generate`.

A reseed TRUNCATEs, so the backfill will not run again — the seed has to set the anchor itself. In
`prisma/seed.ts`, inside the `prisma.employee.create` data, after `joinedAt`:

```ts
          // bounds "this offboarding": decisions made now fall inside the window,
          // and without it a reseed leaves the anchor null, so an executed
          // return would vanish from the farewell report
          offboardingAt: employment === "ACTIVE" ? null : day(-3),
```

And the transition has to stamp it. In `src/server/modules/employees/actions.ts`'s `updateEmployee`,
extend the `data` object with:

```ts
    // The offboarding wizard reads "this offboarding" as everything decided
    // since this moment, so entering OFFBOARDING is what starts the window —
    // otherwise a routine return from years ago lands on a farewell report.
    // Re-entering ACTIVE clears it; OFFBOARDED keeps it, so the report of what
    // happened stays readable afterwards.
    offboardingAt:
      d.employment === "OFFBOARDING"
        ? employee.offboardingAt ?? new Date()
        : d.employment === "ACTIVE"
          ? null
          : employee.offboardingAt,
```

`diffOf` picks the change up automatically, so the audit trail records when an offboarding started.

- [ ] **Step 1: Write the module**

```ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { OPEN_APPROVAL_STATES } from "@/server/modules/approvals/create";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  decisionOf, reportTotals, returnTargetStatus,
  type Decision, type DecisionCandidate, type ReportTotals,
} from "@/lib/offboarding";

/** One row of the /offboarding queue. */
export interface OffboardingRow {
  id: string;
  name: string;
  employeeNo: string;
  title: string;
  department: string;
  m365: string | null;
  /** still physically held by them */
  itemsOut: number;
  /** decided items, INCLUDING ones whose return already executed and left */
  decided: number;
  /** items of this offboarding: still-out plus already-returned */
  total: number;
  undecided: number;
  joined: string;
}

export interface ApprovalLike {
  id: string;
  refNo: string;
  state: string;
  payload: unknown;
  createdAt: Date;
  assetId: string | null;
}

/** The decision's own reason lives in the payload; resolutionReason is the approver's. */
function payloadReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const reason = (payload as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

/**
 * The candidates of THIS offboarding: the window, then the grouping.
 *
 * "Decided" has three parts — the window, the grouping, and `decisionOf` — and
 * every reader must apply all three. Sharing only the last two is what let the
 * completion gate disagree with the wizard: it saw a `lifecycle.return` created
 * BEFORE the person was marked offboarding (a routine `−` on the employee
 * record) and called the item decided, while the wizard, which windows, showed
 * it as still needing a decision. A null anchor means no window, so nothing
 * historical is decided — the safe direction, and the same answer both give.
 */
export function candidatesFor(
  employee: { offboardingAt: Date | null },
  approvals: ApprovalLike[],
): Map<string, DecisionCandidate[]> {
  const since = employee.offboardingAt;
  return groupCandidates(since ? approvals.filter((a) => a.createdAt >= since) : []);
}

/** Bucket return approvals by the asset they move. Prefer `candidatesFor`. */
function groupCandidates(approvals: ApprovalLike[]): Map<string, DecisionCandidate[]> {
  const byAsset = new Map<string, DecisionCandidate[]>();
  for (const a of approvals) {
    if (!a.assetId) continue; // the seeded APR-2040 has no asset — it decides nothing
    const list = byAsset.get(a.assetId) ?? [];
    list.push({
      id: a.id,
      refNo: a.refNo,
      state: a.state,
      toStatus: returnTargetStatus(a.payload),
      reason: payloadReason(a.payload),
      createdAt: a.createdAt,
    });
    byAsset.set(a.assetId, list);
  }
  return byAsset;
}

/** ids of what this person holds right now — the only assets a decision can name */
async function heldIds(employeeId: string): Promise<string[]> {
  const rows = await prisma.asset.findMany({ where: { assigneeId: employeeId }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function listOffboarding(): Promise<OffboardingRow[]> {
  const employees = await prisma.employee.findMany({
    where: { employment: "OFFBOARDING" },
    include: {
      department: true,
      assets: { select: { id: true } },
      approvals: {
        where: { type: "lifecycle_return", assetId: { not: null } },
        select: { id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true },
      },
    },
    // name is not unique — two people sharing one must not swap rows between reads
    orderBy: [{ name: "asc" }, { employeeNo: "asc" }],
  });

  return employees.map((e) => {
    const byAsset = candidatesFor(e, e.approvals);
    const heldIdSet = new Set(e.assets.map((a) => a.id));
    // every asset in e.assets is held by them right now, hence held: true —
    // which is what makes an EXECUTED return from an EARLIER holding not count
    const decidedHeld = e.assets.filter(
      (a) => decisionOf(byAsset.get(a.id) ?? [], { held: true }) !== null,
    ).length;
    // Items whose return already executed have LEFT e.assets. Counting only the
    // held ones made this numerator run backwards as work progressed ("1 of 3"
    // becoming "0 of 2" when the worker ran) and disagree with the wizard's own
    // fraction. Both now count the same union.
    const decidedGone = [...byAsset].filter(
      ([assetId, candidates]) =>
        !heldIdSet.has(assetId) && decisionOf(candidates, { held: false }) !== null,
    ).length;
    return {
      id: e.id,
      name: e.name,
      employeeNo: e.employeeNo,
      title: e.title,
      department: e.department.name,
      m365: e.m365Status,
      itemsOut: heldIdSet.size,
      decided: decidedHeld + decidedGone,
      total: heldIdSet.size + decidedGone,
      undecided: heldIdSet.size - decidedHeld,
      joined: fmtDate(e.joinedAt),
    };
  });
}

export interface WizardItem {
  assetId: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  cost: number | null;
  costLabel: string;
  /** false once the return EXECUTED and the asset left their name */
  held: boolean;
  decision: Decision | null;
  /**
   * An OPEN approval of some OTHER type on this asset. The one-open-per-asset
   * index is per asset, not per type, so a pending lifecycle.change-status
   * makes this item undecidable until it clears — and without naming it, the
   * operator gets a refusal that points nowhere.
   */
  blockedBy: { refNo: string; type: string } | null;
}

export interface WizardSlot {
  name: string;
  required: boolean;
  typeName: string;
  tag: string | null;
  model: string | null;
  status: string | null;
}

export interface WizardData {
  employee: {
    id: string;
    name: string;
    employeeNo: string;
    title: string;
    department: string;
    employment: string;
    m365Status: string | null;
    joined: string;
  };
  policyName: string | null;
  slots: WizardSlot[];
  items: WizardItem[];
  /** held items with no live decision — Continue is blocked while this is > 0 */
  undecided: number;
  totals: ReportTotals;
}

/**
 * Step 1 reads the loadout the other way round (entry criterion #7): the same
 * computeLoadout/resolvePolicy that drive the employee record and Home's HIRE
 * rows, asked "what is still out" instead of "what is missing".
 */
export async function getWizard(employeeId: string): Promise<WizardData | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { department: true },
  });
  if (!employee) return null;

  const [held, allReturns, blockers, policies] = await Promise.all([
    prisma.asset.findMany({
      where: { assigneeId: employeeId },
      include: { category: true },
      orderBy: [{ tag: "asc" }],
    }),
    prisma.approval.findMany({
      where: { employeeId, type: "lifecycle_return", assetId: { not: null } },
      select: {
        id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true,
        asset: {
          select: {
            id: true, tag: true, model: true, status: true, cost: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
    // ANY open approval holds the one-per-asset slot, so decideItem would refuse
    // for a reason the operator can't see. Returns are included deliberately: a
    // return created BEFORE this offboarding began is outside the window, so it
    // is not this item's decision, yet it still owns the slot — and telling the
    // operator "that decision is already recorded" while showing the item as
    // undecided would deadlock them.
    prisma.approval.findMany({
      where: {
        assetId: { in: await heldIds(employeeId) },
        state: { in: [...OPEN_APPROVAL_STATES] },
      },
      select: { refNo: true, type: true, assetId: true },
    }),
    prisma.equipmentPolicy.findMany({
      include: { slots: { include: { assetType: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  // The window lives in candidatesFor — see its comment. Applied to the row list
  // too, because the item set is built from these same rows.
  const since = employee.offboardingAt;
  const returns = since ? allReturns.filter((r) => r.createdAt >= since) : [];
  const byAsset = candidatesFor(employee, allReturns);
  const openByAsset = new Map(
    blockers.filter((b) => b.assetId).map((b) => [b.assetId!, { refNo: b.refNo, type: b.type as string }]),
  );

  /**
   * An open approval only BLOCKS this item if it isn't the item's own decision.
   * Comparing refNos is what separates "your decision is pending" from "someone
   * else's request owns this asset" — including a pre-window return, which is a
   * real request the operator has to clear even though it decides nothing here.
   */
  const blockerFor = (assetId: string, decision: Decision | null) => {
    const open = openByAsset.get(assetId);
    return open && open.refNo !== decision?.refNo ? open : null;
  };

  const money = (cost: Prisma.Decimal | null) => (cost === null ? null : Number(cost));

  const toItem = (
    a: {
      id: string; tag: string; model: string; status: string;
      cost: Prisma.Decimal | null; category: { name: string };
    },
    held: boolean,
    decision: Decision | null,
  ): WizardItem => ({
    assetId: a.id,
    tag: a.tag,
    model: a.model,
    category: a.category.name,
    status: a.status,
    cost: money(a.cost),
    costLabel: fmtMoney(money(a.cost)),
    held,
    decision,
    blockedBy: blockerFor(a.id, decision),
  });

  // The item set is what they hold UNION what a return already moved out of
  // their name: an EXECUTED return clears assigneeId, and a decided item must
  // not vanish from the wizard the moment the worker runs.
  const items = new Map<string, WizardItem>();
  for (const a of held) {
    items.set(a.id, toItem(a, true, decisionOf(byAsset.get(a.id) ?? [], { held: true })));
  }
  for (const r of returns) {
    const a = r.asset;
    if (!a || items.has(a.id)) continue;
    // held: false — the asset already left their name, which is precisely why
    // an EXECUTED return counts here and is skipped in the loop above
    const decision = decisionOf(byAsset.get(a.id) ?? [], { held: false });
    if (!decision) continue; // a rejected-only history is not an item of this offboarding
    items.set(a.id, toItem(a, false, decision));
  }

  // plain comparison, not localeCompare: deterministic beats locale-aware, and
  // src/lib/offboarding.ts's tiebreaker makes the same choice for the same reason
  const rows = [...items.values()].sort((x, y) => (x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0));
  const policy = resolvePolicy(employee, policies);
  const loadout = computeLoadout(policy?.slots ?? [], held);
  // computeLoadout is generic over assets, not slots, so the slot it hands back
  // is typed SlotLike and has lost its assetType include — look the name back up.
  const typeName = new Map((policy?.slots ?? []).map((s) => [s.id, s.assetType?.name ?? "any"]));

  return {
    employee: {
      id: employee.id,
      name: employee.name,
      employeeNo: employee.employeeNo,
      title: employee.title,
      department: employee.department.name,
      employment: employee.employment,
      m365Status: employee.m365Status,
      joined: fmtDate(employee.joinedAt),
    },
    policyName: policy?.name ?? null,
    slots: loadout.slots.map(({ slot, asset }) => ({
      name: slot.name,
      required: slot.required,
      typeName: typeName.get(slot.id) ?? "any",
      tag: asset?.tag ?? null,
      model: asset?.model ?? null,
      status: asset?.status ?? null,
    })),
    items: rows,
    undecided: rows.filter((i) => i.held && !i.decision).length,
    totals: reportTotals(
      rows.filter((i) => i.decision).map((i) => ({ outcome: i.decision!.outcome, cost: i.cost })),
    ),
  };
}
```

**A known, accepted window.** `getWizard` reads the held assets and the return approvals as two
queries in one `Promise.all`, which is not a consistent snapshot: if the worker commits a return
between them, the page sees `held: true` alongside an `EXECUTED` return and — under the Task 4 rule —
renders that item as undecided for one render. Clicking an outcome then hits `decideItem`'s
"isn't held by … any more — refresh the wizard" conflict, which is the designed path, and a refresh
clears it. Closing it needs `RepeatableRead` specifically — Prisma's array-form `$transaction` runs at the
database default, and under Postgres READ COMMITTED each statement takes its own snapshot, so batching
the two reads buys nothing. `$transaction([...], { isolationLevel: "RepeatableRead" })` would do it, at
the cost of a transaction per page render plus handling serialization failures on a read-only screen.
The failure mode is transient, self-correcting and clearly messaged, so it is accepted rather than
engineered around. Do NOT "fix" it by reverting the Task 4 rule — the bug
that rule prevents is permanent, and this one lasts one render. `listOffboarding` has the same skew for
the same reason and is even more benign: it is read-only with no action attached.

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean. Nothing imports this module yet — that is fine, an unreferenced module is not an
unused import.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/offboarding/queries.ts
git commit -m "feat(offboarding): the queue read and everything one wizard needs"
```

---

### Task 6: Offboarding actions — one approval per decision

Entry criterion #1: each per-item decision creates its own `lifecycle.return` approval **the moment it
is made**. This module never writes an asset — the Phase 4 worker does that.

**Files:**
- Create: `src/server/modules/offboarding/actions.ts`
- Modify: `src/lib/activity.ts`, `src/lib/activity.test.ts`, `src/components/patterns/activity-feed.tsx`

- [ ] **Step 1: Write the module**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import { OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, decisionOf, reasonRequired } from "@/lib/offboarding";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { candidatesFor } from "@/server/modules/offboarding/queries";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

// Module-local, deliberately NOT exported: every runtime export of a
// "use server" module must be an async function.
function revalidate(employeeId: string, assetId?: string) {
  revalidatePath("/offboarding");
  revalidatePath(`/offboarding/${employeeId}`);
  revalidatePath(`/offboarding/${employeeId}/report`);
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/approvals");
  revalidatePath("/audit");
  revalidatePath("/employees/activity");
  revalidatePath("/");
  if (assetId) {
    // requestReturn writes the identical approval + asset audit entry and
    // revalidates these; without them the inventory list keeps serving stale
    // open-request state for an asset that was just decided.
    revalidatePath("/inventory");
    revalidatePath("/inventory/activity");
    revalidatePath(`/inventory/${assetId}`);
    revalidatePath(`/inventory/${assetId}/history`);
  }
}

/**
 * Prisma throws rather than returning, and a transaction that can't get a
 * connection inside maxWait raises P2028 — reachable with two concurrent
 * transactions, and the one code where "nothing was written" is guaranteed
 * true. Everything else rethrows: an unexpected error must not be laundered
 * into a designed banner.
 *
 * NOTE for anyone editing the callbacks below: RETURNING a failure from a
 * $transaction callback COMMITS the transaction — only a throw rolls it back.
 * That is safe here because every `return conflict(...)` precedes every write.
 * Add a write before one of them and it will commit silently.
 */
async function asActionResult<T>(run: () => Promise<T>): Promise<T | ActionResult<never>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
}

const decideSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  outcome: z.enum(OUTCOMES),
  reason: z.string().trim().max(500).optional(),
});

/**
 * One decision → one approval, immediately (entry criterion #1). The payload's
 * to.status is what the worker will apply, and Task 1 taught executionPlan all
 * four outcomes — before that, three of them died as EXECUTION_FAILED.
 */
export async function decideItem(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const reason = (d.reason ?? "").trim();
  // README 3e: a reason is required for anything other than a clean return.
  if (reasonRequired(d.outcome) && reason.length < 3) {
    return validationError({
      reason: `${OUTCOME_LABEL[d.outcome]} needs a reason (at least 3 characters) — it lands in the approval and on the farewell report.`,
    });
  }

  let refNo = "";
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: d.employeeId } });
      if (!employee) return conflict("That employee no longer exists.");
      if (employee.employment !== "OFFBOARDING") {
        return conflict(
          `${employee.name} reads ${employee.employment}, not OFFBOARDING — set their employment on the employee record before collecting equipment.`,
        );
      }
      const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
      if (!asset) return conflict("That asset no longer exists.");
      if (asset.assigneeId !== d.employeeId) {
        return conflict(`${asset.tag} isn't held by ${employee.name} any more — refresh the wizard.`);
      }
      // The one-open-per-asset index is per ASSET, not per approval type: a
      // pending lifecycle.change-status refuses this decision too, and
      // "that decision is already recorded" would be a lie pointing nowhere.
      const open = await openApprovalForAsset(tx, asset.id);
      if (open) {
        // A return created BEFORE this offboarding began owns the asset's one
        // open slot but decides nothing here, so claiming "already recorded"
        // would point the operator at a decision the wizard doesn't show —
        // and leave the item permanently undecidable.
        const inWindow =
          employee.offboardingAt !== null && open.createdAt >= employee.offboardingAt;
        return conflict(
          open.type === "lifecycle_return" && inWindow
            ? `${asset.tag} already has an open request — that decision is already recorded.`
            : `${asset.tag} is held by ${open.refNo} (${APPROVAL_TYPE_LABEL[open.type]}) — resolve that in Approvals first, then decide this item.`,
        );
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_return",
        payload: {
          from: { assigneeId: d.employeeId },
          to: { assigneeId: null, status: OUTCOME_STATUS[d.outcome] },
          // keyed on the outcome rather than on emptiness: reasonRequired
          // guarantees a reason for the other three, and this sentinel would be
          // a lie stamped on a MISSING item if that ever changed
          reason: d.outcome === "RETURNED" ? reason || "offboarding · returned" : reason,
        },
        requestedById: user.id,
        assetId: asset.id,
        employeeId: d.employeeId,
        // Custody lost is not a "fine for now" problem.
        priority: d.outcome === "MISSING" ? "HIGH" : "NORMAL",
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      refNo = approval.refNo;
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // double-click — or a colleague on the same wizard — into a constraint
    // violation rather than two returns for one item.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Another request just took this asset's open slot — refresh the wizard.");
    }
    // Prisma throws rather than returning: without this a P2028 (no connection
    // inside maxWait, reachable with two concurrent transactions) escapes as a
    // 500 instead of the designed conflict banner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
  revalidate(d.employeeId, d.assetId);
  return ok({ refNo });
}

const accountsSchema = z.object({
  employeeId: z.string().min(1),
  /** canonical four plus client-defined values stored as-is (README 4f); "" = never synced */
  m365Status: z.string().trim().max(60),
});

/**
 * Step 3. A partial update: only m365Status is written, and its before-value is
 * the updateMany guard — filling untouched fields from the row we just read is
 * how two people editing one employee silently clobber each other.
 */
export async function closeAccounts(
  input: unknown,
): Promise<ActionResult<{ m365Status: string | null; changed: boolean }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = accountsSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;
  const next = parsed.data.m365Status === "" ? null : parsed.data.m365Status;

  let noop = false;
  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    // Same gate as its siblings: step 3 of a wizard should not double as a
    // general-purpose "set anyone's account status to anything" mutation.
    if (employee.employment !== "OFFBOARDING") {
      return conflict(
        employee.employment === "OFFBOARDED"
          ? `${employee.name} is already offboarded — accounts are closed.`
          : `${employee.name} reads ${employee.employment}, not OFFBOARDING — account changes belong on the employee record.`,
      );
    }
    // Scope decision #12 lets `null` PASS the completion gate, because null
    // means "never synced — there was no account to close". That reading only
    // holds while null is the absence of a status, never the erasure of one:
    // blanking a live `active` here would complete the offboarding on an open
    // mailbox, and would leave the immutable completion audit stamping
    // `m365Status: { from: null, to: null }` over a status that did exist.
    // Correcting a genuinely wrong value back to unknown stays available on
    // the employee record, which is not the surface that closes accounts.
    if (next === null && employee.m365Status !== null) {
      return conflict(
        `"No sync yet" describes someone who never had an account — it can't be used to clear the ${employee.m365Status} already recorded against ${employee.name}.`,
      );
    }
    if (employee.m365Status === next) {
      noop = true;
      return null;
    }
    const written = await tx.employee.updateMany({
      where: { id: employeeId, m365Status: employee.m365Status },
      data: { m365Status: next },
    });
    if (written.count === 0) {
      return conflict("Someone else changed this account status while you were looking — refresh.");
    }
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employeeId,
      action: "update",
      diff: { m365Status: { from: employee.m365Status, to: next } },
    });
    return null;
  }));
  if (failure) return failure;
  // nothing was written, so nothing is stale — updateEmployee skips the same way
  if (!noop) revalidate(employeeId);
  // `changed` so the panel can stop claiming "audit entry written" on a save
  // that wrote nothing — the noop path skips writeAudit, and AuditEntry is the
  // one immutable artifact here, so asserting an entry that doesn't exist is
  // the wrong thing to be wrong about.
  return ok({ m365Status: next, changed: !noop });
}

const completeSchema = z.object({ employeeId: z.string().min(1) });

/**
 * Step 4. Completing touches the PERSON only — every asset movement went
 * through its own approval (scope decision #7), so there is nothing to sweep up
 * here and no bulk write to time out.
 */
export async function completeOffboarding(input: unknown): Promise<ActionResult<{ employment: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;

  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      include: {
        assets: { select: { id: true } },
        approvals: {
          where: { type: "lifecycle_return", assetId: { not: null } },
          // the full ApprovalLike shape — groupCandidates needs id/refNo/createdAt
          // too, and createdAt is not a formality: without it every candidate
          // sorts on undefined and the comparator falls through to the id term
          select: { id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true },
        },
      },
    });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment !== "OFFBOARDING") {
      return conflict(`${employee.name} reads ${employee.employment} — only an OFFBOARDING person can be completed.`);
    }

    // Undecided is not the same as returned (entry criterion #2) — the server
    // says so too, not only the disabled Continue button. This goes through the
    // SAME groupCandidates + decisionOf the wizard reads with, because a second
    // definition of "decided" here would be a second answer: the Task 4 review
    // found the looser version counting an item the wizard still showed as open.
    const byAsset = candidatesFor(employee, employee.approvals);
    const decisions = employee.assets.map((a) => decisionOf(byAsset.get(a.id) ?? [], { held: true }));
    const undecided = decisions.filter((d) => d === null).length;
    if (undecided > 0) {
      return conflict(
        `${undecided} item${undecided === 1 ? "" : "s"} still ${undecided === 1 ? "has" : "have"} no decision — go back to Collect items.`,
      );
    }
    // `decisionOf` answers "must the operator be asked again?" — for which
    // EXECUTION_FAILED is correctly a yes-it-was-decided. Completion asks a
    // different question, "is this finished?", and a failed return never moved
    // the asset: the item is still assigned, and the person is about to drop out
    // of the /offboarding queue where anyone would notice.
    const failed = decisions.filter((d) => d?.state === "EXECUTION_FAILED");
    if (failed.length > 0) {
      return conflict(
        `${failed.map((d) => d!.refNo).join(", ")} failed to execute, so ${failed.length === 1 ? "that item is" : "those items are"} still assigned — retry or reject ${failed.length === 1 ? "it" : "them"} in Approvals first.`,
      );
    }
    // Scope decision #12: an offboarding cannot finish with a live account.
    // Case-folded: README 4f stores client-defined values as-is, so a tenant
    // using "Inactive" must not be refused forever. This is a display status,
    // not an identity field — the ILIKE hazard doesn't apply.
    const m365 = employee.m365Status?.trim().toLowerCase() ?? null;
    if (m365 !== null && m365 !== "inactive") {
      return conflict(`The M365 account still reads ${employee.m365Status} — close it on Accounts & M365 first.`);
    }

    const written = await tx.employee.updateMany({
      where: { id: employeeId, employment: "OFFBOARDING" },
      data: { employment: "OFFBOARDED" },
    });
    if (written.count === 0) return conflict("Someone else just completed this offboarding.");
    // AuditEntry is the only immutable artifact in the system, so the moment
    // worth snapshotting is this one. Everything else about a completed
    // offboarding is derived from mutable rows: reject one of these returns
    // afterwards and decisionOf re-opens that item, silently dropping it — and
    // its value — from a farewell report already treated as a signed record.
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employeeId,
      action: "offboarding.completed",
      diff: {
        employment: { from: "OFFBOARDING", to: "OFFBOARDED" },
        m365Status: { from: employee.m365Status, to: employee.m365Status },
        decisions: {
          from: null,
          to: decisions
            .filter((d) => d !== null)
            .map((d) => `${d!.refNo} · ${d!.outcome} · ${d!.state}`),
        },
      },
    });
    return null;
  }));
  if (failure) return failure;
  revalidate(employeeId);
  return ok({ employment: "OFFBOARDED" });
}
```

- [ ] **Step 2: Teach the activity feed the new audit action**

`offboarding.completed` is a new action name, and the feed renderer falls through to a raw default for
anything it doesn't know — `/employees/activity` would print "J. Sarmiento offboarding.completed Dennis
Ong". In `src/lib/activity.ts`, add this case to `auditSentence` just before `case "comment":`

```ts
    case "offboarding.completed": {
      const items = diff?.decisions?.to;
      const n = Array.isArray(items) ? items.length : 0;
      return `${entry.actorLabel} completed offboarding for ${entry.entityLabel}${n ? ` · ${n} item${n === 1 ? "" : "s"} settled` : ""}`;
    }
```

and in `src/components/patterns/activity-feed.tsx`, extend the settled case so the row gets a settled
dot rather than the neutral fallback:

```tsx
  if (action === "complete" || action === "offboarding.completed") return "COMPLETED"; // settled
```

Then pin it — append to `src/lib/activity.test.ts`:

```ts
describe("offboarding.completed", () => {
  it("reads as a sentence and counts what was settled, not as a raw action name", () => {
    expect(auditSentence({
      actorLabel: "J. Sarmiento",
      action: "offboarding.completed",
      diff: { decisions: { from: null, to: ["APR-2043 · RETURNED · EXECUTED", "APR-2044 · MISSING · PENDING"] } },
      entityLabel: "Dennis Ong",
    })).toBe("J. Sarmiento completed offboarding for Dennis Ong · 2 items settled");
  });

  it("degrades without a decision list", () => {
    expect(auditSentence({
      actorLabel: "J. Sarmiento", action: "offboarding.completed", diff: null, entityLabel: "Dennis Ong",
    })).toBe("J. Sarmiento completed offboarding for Dennis Ong");
  });
});
```

- [ ] **Step 3: Typecheck, lint and test**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

Expected: clean, and 2 more unit tests than you started with. If lint reports that a `"use server"`
module may only export async functions, check that `revalidate` and `asActionResult` were left
unexported.

- [ ] **Step 4: Commit**

```bash
git add src/server/modules/offboarding/actions.ts src/lib/activity.ts src/lib/activity.test.ts src/components/patterns/activity-feed.tsx
git commit -m "feat(offboarding): one approval per decision, guarded account close and completion"
```

---

### Task 7: `/offboarding` — the queue

**Files:**
- Create: `src/app/(app)/offboarding/page.tsx`
- Modify: `src/server/modules/home/queries.ts`

- [ ] **Step 1: Write the page**

Create `src/app/(app)/offboarding/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { listOffboarding } from "@/server/modules/offboarding/queries";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";

export default async function OffboardingPage() {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const rows = await listOffboarding();

  return (
    <>
      <PageHeader
        title="Offboarding"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Nobody is offboarding"
          description="Set someone's employment to OFFBOARDING on their employee record and they appear here with whatever they still hold."
          actions={<ButtonLink href="/employees">Open employees</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] text-fg-muted">
            {rows.length} {rows.length === 1 ? "person" : "people"} leaving · every item is collected as its own request
          </p>
          <Table>
            <THead>
              <Tr>
                <Th width={19}><span className="sr-only">Employment colour</span></Th>
                <Th>Person</Th>
                <Th width={132}>Department</Th>
                <Th width={84}>Items out</Th>
                <Th width={150}>Decided</Th>
                <Th width={104}>M365</Th>
                <Th width={112}>Joined</Th>
                <Th width={124} aria-label="Row actions" />
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="pr-0"><StatusDot value="OFFBOARDING" ns="employment" /></Td>
                  <Td>
                    <Link href={`/offboarding/${r.id}`} className="text-accent hover:underline">{r.name}</Link>
                    <span className="pl-1.5 font-mono text-[10.5px] text-fg-muted">{r.employeeNo} · {r.title}</span>
                  </Td>
                  <Td>{r.department}</Td>
                  <Td mono>{r.itemsOut}</Td>
                  <Td mono className="text-[10.5px]">
                    {r.total === 0 ? (
                      "nothing to collect"
                    ) : (
                      <>
                        {/* of the WHOLE offboarding, including items whose return
                            already executed — counting only what is still out made
                            this numerator run backwards as work progressed */}
                        {r.decided} of {r.total}
                        {r.undecided > 0 && (
                          <span className="pl-1 font-medium" style={{ color: "var(--st-attention-text)" }}>
                            · {r.undecided} to go
                          </span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td mono className="text-[10.5px]">{r.m365 ?? "no sync yet"}</Td>
                  <Td mono>{r.joined}</Td>
                  <Td>
                    <ButtonLink size="sm" variant={canMutate ? "primary" : "secondary"} href={`/offboarding/${r.id}`}>
                      {canMutate ? "Open wizard" : "View"}
                    </ButtonLink>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Point Home's LEAVE row at the wizard**

In `src/server/modules/home/queries.ts`, inside the `for (const e of leavers)` loop, replace:

```ts
      href: `/employees/${e.id}`,
      action: e._count.assets > 0 ? "Collect equipment" : "Close accounts",
```

with:

```ts
      // Phase 7: both halves of offboarding (kit and accounts) live in the
      // wizard now, so the one action that clears this row opens it.
      href: `/offboarding/${e.id}`,
      action: e._count.assets > 0 ? "Collect equipment" : "Close accounts",
```

The HIRE loop below it uses the same `href: \`/employees/${e.id}\`` line — make sure you edit the one
inside the **leavers** loop (the block whose `meta` mentions "items still out").

- [ ] **Step 3: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

Then open `/offboarding` in the preview as `it@thebackroomop.com`. Expected: one row — Dennis Ong,
EMP-0090, Operations, **3** items out, "0 of 3 · 3 to go", M365 `offboarding`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/offboarding/page.tsx" src/server/modules/home/queries.ts
git commit -m "feat(offboarding): the queue, and Home's LEAVE row opens the wizard"
```

---

### Task 8: The wizard's four components

All four pieces the wizard page imports, built before the page so it typechecks the moment it exists.
The 4-way control is the design's centre of gravity: **undecided must not look like Returned**, which
is why Step 1 teaches `SegmentedControl` to draw no indicator when nothing is chosen.

**Files:**
- Modify: `src/components/ui/segmented-control.tsx`
- Create: `src/components/offboarding/wizard-steps.tsx`, `src/components/offboarding/item-decision.tsx`,
  `src/components/offboarding/accounts-panel.tsx`, `src/components/offboarding/complete-button.tsx`

- [ ] **Step 1: Let a segmented control hold no value**

In `src/components/ui/segmented-control.tsx`, replace:

```ts
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
```

with:

```ts
  // -1 = nothing chosen. The sliding indicator is then NOT rendered: parking it
  // under option 1 would make "undecided" read as "Returned", which is exactly
  // the drift the offboarding wizard exists to prevent.
  const idx = options.findIndex((o) => o.value === value);
```

and wrap the indicator span in that condition — replace:

```tsx
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 rounded-[5px] bg-surface shadow-card"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          left: `calc(2px + (100% - 4px) / ${options.length} * ${idx})`,
          transition: "left 220ms var(--ease-seg)",
        }}
      />
```

with:

```tsx
      {idx >= 0 && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-[5px] bg-surface shadow-card"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            left: `calc(2px + (100% - 4px) / ${options.length} * ${idx})`,
            transition: "left 220ms var(--ease-seg)",
          }}
        />
      )}
```

Every existing caller passes a value that matches an option, so nothing else changes.

- [ ] **Step 2: The step bar**

Create `src/components/offboarding/wizard-steps.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@/lib/cn";
import { WIZARD_STEPS, type StepId } from "@/lib/offboarding";

/**
 * The 4-stop bar (README 3e). Steps 3 and 4 are NOT links while any item is
 * undecided — Continue is blocked, so the bar must not offer a way around it.
 */
export function WizardSteps({
  employeeId,
  current,
  unlocked,
}: {
  employeeId: string;
  current: StepId;
  unlocked: boolean;
}) {
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.id === current);
  const shared = "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2.5 py-1 text-[12px]";

  return (
    <ol aria-label="Offboarding steps" className="flex flex-wrap items-center gap-1.5 pb-4">
      {WIZARD_STEPS.map((step, i) => {
        const reachable = i <= 1 || unlocked;
        const isCurrent = i === currentIdx;
        // A step can be BEHIND the operator and locked again at the same time:
        // reject one return in Approvals while they stand on Accounts and the
        // item re-opens, `unlocked` flips false, and step 3 becomes an
        // unreachable current step. Painting it "done" would claim they had
        // finished a step they can no longer enter.
        const done = i < currentIdx && reachable;
        const inner = (
          <>
            <span
              aria-hidden
              className={cn(
                "grid size-[18px] place-items-center rounded-full border font-mono text-[9.5px]",
                isCurrent
                  ? "border-accent bg-accent text-accent-fg"
                  : done
                    ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                    : "border-border-strong text-fg-faint",
              )}
            >
              {i + 1}
            </span>
            {step.label}
          </>
        );
        return (
          <li key={step.id} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-4 bg-border-strong" />}
            {reachable ? (
              <Link
                href={`/offboarding/${employeeId}?step=${step.id}`}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  shared,
                  isCurrent
                    ? "border-accent-soft-border bg-accent-tint font-medium text-fg"
                    : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
                )}
              >
                {inner}
              </Link>
            ) : (
              <span
                // the current step can be locked (see `done` above), so
                // aria-current belongs on this branch too — otherwise the bar
                // tells a screen reader the operator is nowhere at all
                aria-current={isCurrent ? "step" : undefined}
                className={cn(shared, "border-dashed border-border-strong text-fg-faint")}
              >
                {inner}
                {/* `title` on a non-focusable span never reaches a keyboard
                    user and is exposed inconsistently, so the reason the step
                    is locked is real text instead */}
                <span className="sr-only">
                  — locked until every item is decided; undecided is not the same as returned.
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 3: The per-item decision control**

Create `src/components/offboarding/item-decision.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, reasonRequired, type Outcome } from "@/lib/offboarding";
import { decideItem } from "@/server/modules/offboarding/actions";

/**
 * The 4-way control (README 3e). Missing is first-class and sits in the same
 * row as the other three — not behind a "more" menu — because pretending
 * everything comes back is why spreadsheets drift.
 *
 * Confirm is enabled as soon as an outcome is picked, even with the reason
 * empty: the SERVER refuses a reasonless Defective/Buyout/Missing, and letting
 * the operator see that refusal is how the rule stays real rather than being a
 * client-side courtesy.
 */
export function ItemDecision({
  employeeId,
  assetId,
  tag,
}: {
  employeeId: string;
  assetId: string;
  tag: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const picked = (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as Outcome) : null;

  function submit() {
    if (!picked) {
      setFieldErrors({ outcome: "Pick an outcome — undecided is not the same as returned." });
      return;
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await decideItem({ employeeId, assetId, outcome: picked, reason });
      if (res.ok) {
        toast(`${res.data.refNo} created — ${tag} → ${OUTCOME_STATUS[picked]}`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors(fe);
        // only `outcome` and `reason` are rendered below; an employeeId/assetId
        // failure would otherwise stop the spinner and say nothing at all
        const unclaimed = Object.entries(fe).filter(([k]) => k !== "outcome" && k !== "reason");
        if (unclaimed.length > 0) setError(unclaimed.map(([, v]) => v).join(" "));
      } else setError(res.message);
    });
  }

  return (
    // named group: one row's controls are addressable on their own, by a
    // screen reader and by the e2e spec alike
    <div role="group" aria-label={`Decide ${tag}`} className="flex flex-col gap-2">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label={`Outcome for ${tag}`}
          options={OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}
          value={outcome}
          onChange={setOutcome}
        />
        <Button size="sm" variant="primary" loading={pending} onClick={submit}>
          Confirm decision
        </Button>
        <span className="font-mono text-[10px] text-fg-muted">
          {picked ? `creates a lifecycle.return → ${OUTCOME_STATUS[picked]}` : "creates its own request the moment you confirm"}
        </span>
      </div>
      <FormError>{fieldErrors.outcome}</FormError>
      <FormField
        label="Reason"
        required={picked ? reasonRequired(picked) : false}
        hint={
          picked && reasonRequired(picked)
            ? `${OUTCOME_LABEL[picked]} needs a reason — it lands in the approval and on the farewell report.`
            : "Optional for a clean return."
        }
        error={fieldErrors.reason}
      >
        {(p) => (
          <Textarea
            id={p.id}
            aria-describedby={p["aria-describedby"]}
            invalid={p.invalid}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </FormField>
    </div>
  );
}
```

- [ ] **Step 4: The accounts panel (step 3)**

Create `src/components/offboarding/accounts-panel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { M365_CANONICAL } from "@/lib/labels";
import { closeAccounts } from "@/server/modules/offboarding/actions";

const CUSTOM = "__custom";

/** the server bound (accountsSchema), mirrored so the field stops you first */
const MAX_STATUS = 60;

/**
 * Step 3 is where the M365 status actually moves (README 4f): the canonical
 * four plus a custom value stored as-is. A never-synced account keeps reading
 * "no sync yet" rather than a false "inactive".
 */
export function AccountsPanel({
  employeeId,
  m365Status,
}: {
  employeeId: string;
  m365Status: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const isCustom = m365Status !== null && !(M365_CANONICAL as readonly string[]).includes(m365Status);
  const [select, setSelect] = useState(m365Status === null ? "" : isCustom ? CUSTOM : m365Status);
  const [custom, setCustom] = useState(isCustom ? m365Status : "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState<"written" | "unchanged" | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = select === CUSTOM ? custom.trim() : select;
    // An empty custom value trims to "", which the action reads as null — i.e.
    // "this person never had an account". Picking "custom…" and typing nothing
    // would therefore erase a real status by accident, with a toast that reads
    // like a success. Refuse it here, where the operator's intent actually is.
    if (select === CUSTOM && next === "") {
      setFieldErrors({ custom: "Type the status, or pick one from the list above." });
      return;
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await closeAccounts({ employeeId, m365Status: next });
      if (res.ok) {
        setSaved(res.data.changed ? "written" : "unchanged");
        setTimeout(() => setSaved(null), 3000);
        toast(`Account status is now ${res.data.m365Status ?? "no sync yet"}`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      // a too-long custom value is a real refusal: without this branch the
      // operator gets "Fix the highlighted fields." with no field highlighted
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors({ custom: fe.m365Status ?? fe.custom ?? "" });
        // keys no field on this form claims must not dead-end silently
        const unclaimed = Object.entries(fe).filter(([k]) => k !== "m365Status" && k !== "custom");
        if (unclaimed.length > 0) setError(unclaimed.map(([, v]) => v).join(" "));
        else if (!fe.m365Status && !fe.custom) setError(res.message);
      } else setError(res.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-[420px] flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <FormField
        label="Microsoft 365 account status"
        hint="An offboarding can only be completed once this reads inactive (or the person never had an account)."
      >
        {(p) => (
          <Select
            id={p.id}
            aria-describedby={p["aria-describedby"]}
            value={select}
            onChange={(e) => setSelect(e.target.value)}
          >
            <option value="">no sync yet</option>
            {M365_CANONICAL.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value={CUSTOM}>custom…</option>
          </Select>
        )}
      </FormField>
      {select === CUSTOM && (
        <FormField
          label="Custom value"
          required
          hint="Stored verbatim; unknown values render in the Neutral family."
          error={fieldErrors.custom}
        >
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p["aria-describedby"]}
              invalid={p.invalid}
              maxLength={MAX_STATUS}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          )}
        </FormField>
      )}
      <div className="flex items-center gap-2">
        {/* the button holds its width across idle → spinner → ✓ Saved */}
        <Button type="submit" variant="primary" loading={pending}>
          {saved ? "✓ Saved" : "Save account status"}
        </Button>
        {saved && (
          <span className="font-mono text-[10.5px]" style={{ color: "var(--st-settled-text)" }}>
            {saved === "written" ? "audit entry written" : "already set — nothing to change"}
          </span>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 5: The complete button (step 4)**

Create `src/components/offboarding/complete-button.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { completeOffboarding } from "@/server/modules/offboarding/actions";

/**
 * A Dialog, not an inline button: completing an offboarding flips the person to
 * OFFBOARDED, and the README reserves dialogs for decisions like that.
 */
export function CompleteButton({
  employeeId,
  name,
  itemCount,
}: {
  employeeId: string;
  name: string;
  itemCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await completeOffboarding({ employeeId });
      if (res.ok) {
        setOpen(false);
        toast(`${name} is now OFFBOARDED`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Complete offboarding</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Complete ${name}'s offboarding?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Complete</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {/*
            Refusal is the DESIGNED outcome of all three completion gates
            (undecided items, a return sitting EXECUTION_FAILED, a live M365
            account), so the message has to land somewhere the operator is
            looking. It must also live INSIDE the dialog: Dialog portals to
            document.body and the focus trap marks every other body child
            `inert`, which drops an outside banner out of the accessibility
            tree entirely and parks it behind the veil. The operator would see
            the spinner stop and nothing else, then click Complete again.
          */}
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p>
            {name} flips to <span className="font-mono">OFFBOARDED</span>. The{" "}
            {itemCount} equipment decision{itemCount === 1 ? "" : "s"} already exist as their own
            requests — completing changes nothing about the kit.
          </p>
          <p className="text-xs text-fg-muted">
            The farewell report stays available afterwards.
          </p>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean (these components are unused until Task 9 — that is not an unused import).

```bash
git add src/components/ui/segmented-control.tsx src/components/offboarding
git commit -m "feat(offboarding): step bar, the 4-way decision control, accounts panel, complete dialog"
```

---

### Task 9: `/offboarding/[employeeId]` — the 4-step wizard

**Files:**
- Create: `src/app/(app)/offboarding/[employeeId]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { getWizard } from "@/server/modules/offboarding/queries";
import { canContinue, OUTCOME_LABEL, OUTCOME_STATUS, parseStep } from "@/lib/offboarding";
import { fmtMoney } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountsPanel } from "@/components/offboarding/accounts-panel";
import { CompleteButton } from "@/components/offboarding/complete-button";
import { ItemDecision } from "@/components/offboarding/item-decision";
import { WizardSteps } from "@/components/offboarding/wizard-steps";

export default async function OffboardingWizardPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { employeeId } = await params;
  const step = parseStep(toSearchParams(await searchParams).get("step"));
  const data = await getWizard(employeeId);
  if (!data) notFound();

  const { employee, items, totals, undecided } = data;
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const active = employee.employment === "OFFBOARDING";
  const canDecide = canMutate && active;
  const unlocked = canContinue("collect", { undecided });
  const href = (s: string) => `/offboarding/${employeeId}?step=${s}`;
  // flatMap rather than filter so `decision` is structurally non-null on the
  // rows the report renders — the same reason decisionOf carries the outcome on
  // the surviving row instead of asserting it later
  const decided = items.flatMap((i) => (i.decision ? [{ ...i, decision: i.decision }] : []));
  const heldItems = items.filter((i) => i.held);

  return (
    <>
      <PageHeader
        title={employee.name}
        breadcrumb={[{ label: "Offboarding", href: "/offboarding" }, { label: employee.employeeNo }]}
        badge={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot value={employee.employment} ns="employment" />
            <span className="font-mono text-[10.5px] text-fg-muted">{employee.employment}</span>
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/employees/${employeeId}`}>Employee record</ButtonLink>
            <ButtonLink href={`/offboarding/${employeeId}/report`}>Farewell report</ButtonLink>
          </>
        }
      />

      <WizardSteps employeeId={employeeId} current={step} unlocked={unlocked} />

      {!active && (
        <div className="pb-4">
          <Banner
            tone={employee.employment === "OFFBOARDED" ? "closed" : "attention"}
            title={
              employee.employment === "OFFBOARDED"
                ? `${employee.name} is already offboarded — this is the record of what happened`
                : `${employee.name} reads ${employee.employment}, not OFFBOARDING`
            }
          >
            {employee.employment === "OFFBOARDED" ? (
              <>Every decision below stays readable, and so does the{" "}
                <Link href={`/offboarding/${employeeId}/report`} className="text-accent hover:underline">
                  farewell report
                </Link>.
              </>
            ) : (
              <>Set their employment to <span className="font-mono">OFFBOARDING</span> on the{" "}
                <Link href={`/employees/${employeeId}/edit`} className="text-accent hover:underline">
                  employee record
                </Link>{" "}
                before collecting equipment.
              </>
            )}
          </Banner>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Items out" value={String(heldItems.length)} />
            <Stat label="Decided" value={`${decided.length} / ${items.length}`} />
            {/* the same set as "Items out" beside it: `items` is held UNION
                already-returned, so reducing over all of it bills equipment the
                worker has already put back to the money still in their hands */}
            <Stat label="Book value out" value={fmtMoney(heldItems.reduce((s, i) => s + (i.cost ?? 0), 0))} />
            <Stat label="M365" value={employee.m365Status ?? "no sync yet"} />
          </div>
          {/* keyed on the POLICY, not the slot count: resolvePolicy matches on
              title/department regardless of how many slots the policy defines,
              so a policy with none would otherwise report itself as absent */}
          {data.policyName !== null && data.slots.length > 0 ? (
            <Card>
              <CardHeader
                title="Against their policy"
                actions={<span className="font-mono text-[10.5px] text-fg-muted">{data.policyName}</span>}
              />
              <CardBody className="grid grid-cols-2 gap-[11px] lg:grid-cols-4">
                {data.slots.map((s) => (
                  <div
                    key={s.name}
                    className={
                      s.tag
                        ? "flex flex-col gap-1 rounded-(--radius-card) border border-border bg-surface p-3"
                        : "flex flex-col gap-1 rounded-(--radius-card) border border-dashed border-border-strong p-3"
                    }
                  >
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">{s.name}</span>
                    {s.tag ? (
                      <>
                        <span className="text-[11.5px] font-medium text-fg">{s.model}</span>
                        <span className="font-mono text-[11px] text-accent">{s.tag}</span>
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-fg-muted">
                          <StatusDot value={s.status ?? "SPARE"} />
                          {s.status}
                        </span>
                      </>
                    ) : (
                      // "not held" rather than "nothing to collect": an item that
                      // left their name without a return (a manual reassignment, a
                      // transfer) is the drift this screen exists to catch, and it
                      // must not read as reassurance
                      <span className="font-mono text-[10px] text-fg-muted">
                        not held · {s.typeName} · {s.required ? "required" : "optional"}
                      </span>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : (
            <Banner
              tone="neutral"
              title={
                data.policyName === null
                  ? "No equipment policy applies to this person"
                  : `${data.policyName} defines no slots`
              }
            >
              {employee.title} · {employee.department}{" "}
              {data.policyName === null
                ? "has no policy, so there are no slots to check against"
                : "matches a policy that lists no equipment, so there is nothing to check against"}{" "}
              — the holdings below are the whole picture.
            </Banner>
          )}

          <Card>
            <CardHeader title="Holdings" />
            {items.length === 0 ? (
              <CardBody>
                <p className="text-xs text-fg-muted">
                  {/* "in this offboarding", not "ever": the item set is windowed by
                      offboardingAt, so a return from a previous holding is
                      correctly absent here and was not nothing */}
                  They hold nothing, and no return has been recorded in this offboarding — go
                  straight to Accounts &amp; M365.
                </p>
              </CardBody>
            ) : (
              <Table className="rounded-t-none border-0 shadow-none">
                <THead>
                  <Tr>
                    <Th width={19}><span className="sr-only">Status colour</span></Th>
                    <Th width={112}>Tag</Th>
                    <Th>Model</Th>
                    <Th width={96}>Category</Th>
                    <Th width={96}>Status</Th>
                    <Th width={112} align="right">Cost</Th>
                    <Th width={124}>Decision</Th>
                  </Tr>
                </THead>
                <TBody>
                  {items.map((i) => (
                    <Tr key={i.assetId}>
                      <Td className="pr-0"><StatusDot value={i.status} /></Td>
                      <Td mono>
                        <Link href={`/inventory/${i.assetId}`} className="text-accent hover:underline">{i.tag}</Link>
                      </Td>
                      <Td>{i.model}</Td>
                      <Td mono className="text-[10.5px]">{i.category}</Td>
                      <Td mono className="text-[10.5px]">{i.status}</Td>
                      <Td align="right" mono>{i.costLabel}</Td>
                      <Td mono className="text-[10.5px]">
                        {i.decision ? OUTCOME_LABEL[i.decision.outcome] : "—"}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <div className="flex justify-end">
            <ButtonLink variant="primary" href={href("collect")}>Continue to Collect items</ButtonLink>
          </div>
        </div>
      )}

      {step === "collect" && (
        <div className="flex flex-col gap-4">
          <Banner tone="neutral" title="Each decision is recorded the moment you confirm it">
            Every item becomes its own <span className="font-mono">lifecycle.return</span> request, so a
            half-finished offboarding is still N correct records. Nothing moves until the approval
            executes — the asset keeps reading its current status meanwhile.
          </Banner>

          {items.filter((i) => i.held).length === 0 ? (
            <EmptyState
              title="Nothing left to collect"
              description="No equipment is still in their name."
              actions={<ButtonLink variant="primary" href={href("accounts")}>Continue to Accounts &amp; M365</ButtonLink>}
            />
          ) : (
            items
              .filter((i) => i.held)
              .map((i) => (
                <Card key={i.assetId}>
                  <CardHeader
                    title={
                      <span className="inline-flex items-baseline gap-2">
                        <span className="font-mono text-[13px] text-accent">{i.tag}</span>
                        <span>{i.model}</span>
                        <span className="font-mono text-[10.5px] text-fg-muted">{i.category} · {i.costLabel}</span>
                      </span>
                    }
                    actions={
                      i.decision ? (
                        <span className="inline-flex items-center gap-2">
                          <StatusPill
                            value={OUTCOME_STATUS[i.decision.outcome]}
                            label={OUTCOME_LABEL[i.decision.outcome]}
                          />
                          <StatusPill value={i.decision.state} />
                        </span>
                      ) : (
                        <Pill>UNDECIDED</Pill>
                      )
                    }
                  />
                  <CardBody>
                    {i.decision ? (
                      <div className="flex flex-col gap-1 text-xs text-fg-secondary">
                        <span className="font-mono text-[11px]">
                          <Link href="/approvals" className="text-accent hover:underline">{i.decision.refNo}</Link>
                          {" · "}
                          {i.status} → {OUTCOME_STATUS[i.decision.outcome]}
                        </span>
                        {i.decision.reason && <span>{i.decision.reason}</span>}
                        {i.decision.state === "EXECUTION_FAILED" && (
                          <span className="font-mono text-[10.5px]" style={{ color: "var(--st-fault-text)" }}>
                            execution failed — open the request to retry; the decision itself stands
                          </span>
                        )}
                      </div>
                    ) : i.blockedBy ? (
                      // one asset, one open request: a pending change-status would
                      // otherwise refuse the decision with no way to see why
                      <p className="text-xs" style={{ color: "var(--st-attention-text)" }}>
                        {i.tag} is held by{" "}
                        <Link href="/approvals" className="font-mono text-accent hover:underline">
                          {i.blockedBy.refNo}
                        </Link>{" "}
                        {/* the same label decideItem's refusal uses — one block
                            explained two different ways is two bugs waiting */}
                        ({APPROVAL_TYPE_LABEL[i.blockedBy.type]}) — resolve that request
                        first, then decide this item.
                      </p>
                    ) : canDecide ? (
                      <ItemDecision employeeId={employeeId} assetId={i.assetId} tag={i.tag} />
                    ) : (
                      <p className="text-xs text-fg-muted">
                        {/* `active` is OFFBOARDING only, so its else covers
                            ACTIVE too — and telling someone the offboarding is
                            "closed" for a person who never started one points
                            the opposite way from the banner at the top of this
                            same page, which tells them to set the employment */}
                        {active
                          ? "Read-only — collecting equipment is an IT action."
                          : employee.employment === "OFFBOARDED"
                            ? "This offboarding is closed."
                            : "Not offboarding yet — set their employment first, then decisions can be recorded."}
                      </p>
                    )}
                  </CardBody>
                </Card>
              ))
          )}

          <div className="flex items-center justify-end gap-3">
            {unlocked ? (
              <ButtonLink variant="primary" href={href("accounts")}>Continue to Accounts &amp; M365</ButtonLink>
            ) : (
              <>
                <span className="font-mono text-[11px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                  {undecided} item{undecided === 1 ? "" : "s"} undecided — undecided is not the same as returned
                </span>
                <Button variant="primary" disabled>Continue to Accounts &amp; M365</Button>
              </>
            )}
          </div>
        </div>
      )}

      {step === "accounts" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Accounts & M365" />
            <CardBody className="flex flex-col gap-3">
              <p className="text-xs text-fg-secondary">
                {/* not unconditional: rejecting one return in Approvals while the
                    operator stands here re-opens that item and WizardSteps
                    re-locks this step — this sentence must not go on saying the
                    kit is settled while the bar beside it says otherwise */}
                {unlocked ? (
                  <>
                    Equipment is settled: {decided.length} decision{decided.length === 1 ? "" : "s"} recorded.
                    What is left is the account itself.
                  </>
                ) : (
                  <>
                    {/* "still undecided", not "went back to": this step is reachable
                        both by a rejection re-opening a decided item AND by the
                        ?step= URL before anything was decided at all */}
                    {undecided} item{undecided === 1 ? "" : "s"} still undecided — go back to{" "}
                    <Link href={href("collect")} className="text-accent hover:underline">Collect items</Link>{" "}
                    before finishing. You can still close the account here.
                  </>
                )}
              </p>
              {canDecide ? (
                <AccountsPanel employeeId={employeeId} m365Status={employee.m365Status} />
              ) : (
                <p className="font-mono text-[11px] text-fg-muted">
                  current status: {employee.m365Status ?? "no sync yet"}
                </p>
              )}
            </CardBody>
          </Card>
          <div className="flex justify-end">
            <ButtonLink variant="primary" href={href("report")}>Continue to Farewell report</ButtonLink>
          </div>
        </div>
      )}

      {step === "report" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* these total DECISIONS, not movements: decisionOf counts PENDING
                and EXECUTION_FAILED alongside EXECUTED, and the collect step's
                own banner promises "nothing moves until the approval executes".
                The hints say decided so the tiles stop claiming a recovery the
                completion gate would refuse to believe. */}
            <Stat label="Recovered" value={fmtMoney(totals.recovered)} hint="decided returned + defective — back in the fleet as each executes" />
            <Stat label="Bought out" value={fmtMoney(totals.boughtOut)} hint="decided buyout — the employee pays for it" />
            <Stat label="Value lost" value={fmtMoney(totals.lost)} hint="decided missing — custody lost" />
            <Stat label="Items" value={`${decided.length} / ${items.length}`} hint="decided of this offboarding" />
          </div>

          <Card>
            <CardHeader
              title="What happened to the kit"
              actions={<ButtonLink size="sm" href={`/offboarding/${employeeId}/report`}>Printable report</ButtonLink>}
            />
            {decided.length === 0 ? (
              <CardBody>
                <p className="text-xs text-fg-muted">Nothing has been decided yet.</p>
              </CardBody>
            ) : (
              <Table className="rounded-t-none border-0 shadow-none">
                <THead>
                  <Tr>
                    <Th width={112}>Tag</Th>
                    <Th>Model</Th>
                    <Th width={112}>Outcome</Th>
                    <Th width={104}>Lands as</Th>
                    <Th>Reason</Th>
                    <Th width={112} align="right">Value</Th>
                    <Th width={132}>Request</Th>
                  </Tr>
                </THead>
                <TBody>
                  {decided.map((i) => (
                    <Tr key={i.assetId}>
                      <Td mono>
                        <Link href={`/inventory/${i.assetId}`} className="text-accent hover:underline">{i.tag}</Link>
                      </Td>
                      <Td>{i.model}</Td>
                      <Td>
                        <StatusPill
                          value={OUTCOME_STATUS[i.decision.outcome]}
                          label={OUTCOME_LABEL[i.decision.outcome]}
                        />
                      </Td>
                      <Td mono className="text-[10.5px]">{OUTCOME_STATUS[i.decision.outcome]}</Td>
                      <Td>{i.decision.reason ?? "—"}</Td>
                      <Td align="right" mono>{i.costLabel}</Td>
                      {/* linked like the collect step's copy of the same refNo —
                          the report is where you most want the jump */}
                      <Td mono className="text-[10.5px]">
                        <Link href="/approvals" className="text-accent hover:underline">{i.decision.refNo}</Link>
                        {" · "}
                        {i.decision.state}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {active && canMutate && (
            <div className="flex items-center justify-end gap-3">
              <span className="font-mono text-[10.5px] text-fg-muted">
                completing flips {employee.name} to OFFBOARDED — it does not touch equipment
              </span>
              <CompleteButton employeeId={employeeId} name={employee.name} itemCount={decided.length} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
```

**On `requireUser` rather than `requireRole`.** A `viewer` is in the IT workspace and the Offboarding nav
item carries no role restriction, so a viewer reaches this page — deliberately. The design's read-only
rule (README, "Every screen's states") is that mutating affordances are **absent, not disabled**, with
one `READ-ONLY · VIEWER` badge explaining why; redirecting them away instead would be a dead end on a
screen they are allowed to read. `canDecide` gates every control, and all three server actions refuse
them independently, so there is no write path. Do NOT "harden" this into `requireRole`.

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean. `CardHeader`'s `title` is typed `React.ReactNode`, so the composed titles are fine.

- [ ] **Step 3: Walk it in the preview**

As `it@thebackroomop.com`, open `/offboarding` → Dennis Ong → and check, in order:

1. Step 1 shows the three holdings and the "No equipment policy applies" banner (Operations has no policy).
2. Steps 3 and 4 in the bar are **dashed and not links** while three items are undecided.
3. Step 2: pick **Missing** on the phone, leave the reason empty, Confirm → the server's inline
   "Missing needs a reason" error appears under the textarea.
4. Fill a reason, Confirm → a toast names the new `APR-####`, the card collapses to the recorded
   decision with `MISSING` + `PENDING` pills.
5. Decide the other two (Returned on the headset, Defective with a reason on the laptop) → the
   Continue button enables and steps 3/4 become links.
6. Step 3: set the account to `inactive`, Save → "✓ Saved".
7. Step 4: totals read recovered / bought out / lost, and **Complete offboarding** opens the dialog.

Browser-pane note: synthetic clicks often don't reach React handlers — dispatch a real bubbling
`MouseEvent` from `javascript_tool` if a click seems to do nothing.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/offboarding/[employeeId]/page.tsx"
git commit -m "feat(offboarding): the 4-step wizard, each decision its own approval"
```

---

### Task 10: The printable farewell report

Scope decision #9: a printable sheet mirroring `/employees/[id]/form`. "Emailable to HR" and a real
Excel export are Phase 8's export work; the receipt itself ships here.

**Files:**
- Create: `src/app/(app)/offboarding/[employeeId]/report/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getWizard } from "@/server/modules/offboarding/queries";
import { OUTCOME_LABEL, OUTCOME_STATUS } from "@/lib/offboarding";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PrintButton } from "@/components/employees/print-button";

const STRIPES = "repeating-linear-gradient(135deg, #EEF1F5 0 6px, #F7F9FB 6px 12px)";

export default async function FarewellReportPage({ params }: { params: Promise<{ employeeId: string }> }) {
  await requireUser();
  const { employeeId } = await params;
  const data = await getWizard(employeeId);
  if (!data) notFound();
  const { employee, totals } = data;
  // flatMap rather than filter so `decision` is structurally non-null on the
  // rows this sheet prints, instead of six assertions sitting far from the
  // filter that proves them
  const decided = data.items.flatMap((i) => (i.decision ? [{ ...i, decision: i.decision }] : []));

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="flex justify-end pb-3 print:hidden">
        <PrintButton />
      </div>
      {/* Light-theme-only on purpose: this is a printed artifact. */}
      <div className="flex flex-col gap-6 rounded-(--radius-card) border border-border bg-white p-8 text-[#101828] shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-center justify-between border-b-2 border-[#101828] pb-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-6 place-items-center bg-[#101828] font-mono text-[11px] font-bold text-white">BR</span>
            <div>
              <p className="text-[15px] font-semibold">Backroom IT — Offboarding farewell report</p>
              <p className="font-mono text-[10px] text-[#667085]">
                generated {fmtDate(new Date())} · from live records · {employee.employment}
              </p>
            </div>
          </div>
          <span aria-label="scan code placeholder" className="h-10 w-24" style={{ background: STRIPES }} />
        </header>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-[13px]">
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Employee</dt><dd className="font-medium">{employee.name}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Number</dt><dd className="font-mono">{employee.employeeNo}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Title</dt><dd>{employee.title}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Department</dt><dd>{employee.department}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Joined</dt><dd className="font-mono">{employee.joined}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">M365</dt><dd className="font-mono">{employee.m365Status ?? "no sync yet"}</dd></div>
        </dl>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[#D0D5DD] text-left font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#667085]">
              <th className="py-1.5 pr-3">#</th>
              <th className="py-1.5 pr-3">Asset tag</th>
              <th className="py-1.5 pr-3">Model</th>
              <th className="py-1.5 pr-3">Outcome</th>
              <th className="py-1.5 pr-3">Reason</th>
              <th className="py-1.5 pr-3 text-right">Value</th>
              <th className="py-1.5">Request</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((i, n) => (
              <tr key={i.assetId} className="border-b border-[#F2F4F7]">
                <td className="py-1.5 pr-3 font-mono">{String(n + 1).padStart(2, "0")}</td>
                <td className="py-1.5 pr-3 font-mono">{i.tag}</td>
                <td className="py-1.5 pr-3">{i.model}</td>
                <td className="py-1.5 pr-3">
                  {OUTCOME_LABEL[i.decision.outcome]}
                  <span className="pl-1 font-mono text-[9.5px] text-[#667085]">{OUTCOME_STATUS[i.decision.outcome]}</span>
                </td>
                <td className="py-1.5 pr-3">{i.decision.reason ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{i.costLabel}</td>
                <td className="py-1.5 font-mono text-[10px]">
                  {i.decision.refNo} ·{" "}
                  {/* EXECUTED and PENDING/EXECUTION_FAILED share this column's
                      one muted weight otherwise, and a state this small must not
                      rely on the reader parsing the word under it — the sheet
                      must not read as "returned" when the return has not moved */}
                  <span className={i.decision.state === "EXECUTED" ? undefined : "font-semibold"}>
                    {i.decision.state}
                  </span>
                </td>
              </tr>
            ))}
            {decided.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-center text-[#667085]">No equipment decisions were recorded.</td></tr>
            )}
          </tbody>
        </table>

        {/* These three totals count DECIDED items, not completed movements —
            a PENDING or EXECUTION_FAILED return is already in `recovered`
            because the decision was made, not because equipment moved. The
            Request column's state is what discloses whether one has actually
            executed; do not read these figures as a settled ledger. */}
        <dl className="grid grid-cols-3 gap-6 border-t border-[#D0D5DD] pt-4 text-[12px]">
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[#667085]">Recovered</dt>
            <dd className="font-mono text-[15px] font-semibold">{fmtMoney(totals.recovered)}</dd>
            <dd className="text-[10.5px] text-[#667085]">
              {totals.counts.RETURNED} returned · {totals.counts.DEFECTIVE} defective — back in the fleet as each request executes
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[#667085]">Bought out</dt>
            <dd className="font-mono text-[15px] font-semibold">{fmtMoney(totals.boughtOut)}</dd>
            <dd className="text-[10.5px] text-[#667085]">{totals.counts.BUYOUT} item(s) the employee pays for</dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[#667085]">Value lost</dt>
            <dd className="font-mono text-[15px] font-semibold">{fmtMoney(totals.lost)}</dd>
            <dd className="text-[10.5px] text-[#667085]">{totals.counts.MISSING} item(s) missing — custody lost</dd>
            {/* "₱0 · 1 item missing" would invite the reading that the loss was
                zero; an item with no cost on record has an unknown loss, not none */}
            {decided.some((i) => i.decision.outcome === "MISSING" && i.cost === null) && (
              <dd className="text-[10.5px] text-[#667085]">
                {decided.filter((i) => i.decision.outcome === "MISSING" && i.cost === null).length} of them
                {" "}have no cost on record — that loss is unknown, not zero
              </dd>
            )}
          </div>
        </dl>

        {/* Acknowledgement copy is placeholder-final: flagged for HR review (handover open item). */}
        <p className="text-[12px] leading-relaxed text-[#475467]">
          This report records the equipment outcomes for the separation above, generated from the
          approval trail rather than typed. Items marked returned or defective are back in company
          custody; items marked buyout were purchased by the employee; items marked missing remain
          unaccounted for and stay open for investigation. Replacement cost for unreturned or
          negligently damaged items may be recovered as permitted by law and company policy.
        </p>

        {/* The sentence above speaks in the present tense about custody, but a
            decision and a movement are not the same event — the totals count
            the former. Rather than rewrite copy that is pending HR review, the
            distinction is disclosed here, next to the column that carries it. */}
        <p className="text-[11px] leading-relaxed text-[#667085]">
          Each row&apos;s <span className="font-mono">Request</span> column carries the approval that
          records the decision and its state. A request that has not reached{" "}
          <span className="font-mono">EXECUTED</span> has been decided but has not yet moved the
          asset, and its state is shown in bold above.
        </p>

        <div className="grid grid-cols-2 gap-10 pt-6">
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">{employee.name}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">employee signature · date</p>
          </div>
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">Backroom IT</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">released by · date</p>
          </div>
        </div>

        <p className="font-mono text-[8.5px] text-[#98A2B3]">
          {employee.employeeNo} · {decided.length} decision(s) · a real Excel export and the HR email land with Phase 8&apos;s export work
        </p>
      </div>
    </div>
  );
}
```

**One honesty check while you are in this file.** Every decided item contributes to the totals,
including decisions that have not executed yet — which is correct, since an offboarding may legitimately
complete with returns still queued. But an `EXECUTION_FAILED` decision is one the system KNOWS did not
apply, and the row already prints its state, so the totals must not silently imply otherwise. The
`Request` column carries `refNo · state`; that is the honest signal, and it is enough. Do NOT change
`reportTotals` — just confirm a failed row is visibly distinguishable from an executed one on the sheet,
and if it is not, make the state text stand out rather than touching the arithmetic. (Raised by the
Task 4 review: on the not-held path an item whose only decision is `EXECUTION_FAILED` can appear here.)

- [ ] **Step 2: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

Open `/offboarding/<Dennis id>/report` — expected: the sheet renders light-on-white in dark mode too,
lists the decisions made in Task 9's walkthrough, and the three totals add up to the item costs.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/offboarding/[employeeId]/report/page.tsx"
git commit -m "feat(offboarding): the printable farewell report"
```

---

### Task 11: The repairs brain — stages, the down clock, and the fixtures that prove them (TDD)

Repairs adds **no enum** (README 7b): the four stages are derived from `vendorId` / `rmaRef` /
`repairQuote` / `defectiveSince`, all of which already exist on `Asset`. Two seed corrections and one
worker line ride along, because a derivation nothing can produce is a derivation nobody can see.

**Files:**
- Create: `src/lib/repairs.ts`, `src/lib/repairs.test.ts`
- Modify: `src/lib/inventory-list.ts`, `src/lib/inventory-list.test.ts`, `prisma/seed.ts`,
  `src/worker/execute-approval.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/repairs.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import type { ListState } from "./url-state";
import {
  REPAIRS_SAVED_VIEW, REPAIR_STAGES, REPAIR_STAGE_LABEL, REPAIR_WRITE_OFF_SHARE,
  beyondRepair, downDays, isRepairStage, isRepairView, quoteWarning, repairStage,
  type RepairLike,
} from "./repairs";

const asset = (over: Partial<RepairLike> = {}): RepairLike => ({
  status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: null,
  cost: 55_000, defectiveSince: new Date("2026-08-01T00:00:00Z"), ...over,
});

describe("the four stages are derived, not stored", () => {
  it("names them in the order the chips render, as URL-safe ids", () => {
    expect(REPAIR_STAGES).toEqual(["to-assess", "at-vendor", "returned-ok", "beyond-repair"]);
    expect(REPAIR_STAGE_LABEL["beyond-repair"]).toBe("BEYOND REPAIR");
    expect(isRepairStage("at-vendor")).toBe(true);
    expect(isRepairStage("AT VENDOR")).toBe(false);
  });

  it("DEFECTIVE with no vendor and no RMA is still to assess (seeded BR-LT-0122, BR-KB-0402)", () => {
    expect(repairStage(asset())).toBe("to-assess");
  });

  it("a vendor OR an RMA is enough to be at the vendor (seeded BR-LT-0118, BR-MN-0731, BR-DK-0033)", () => {
    expect(repairStage(asset({ vendorId: "v1" }))).toBe("at-vendor");
    expect(repairStage(asset({ rmaRef: "RMA-8802" }))).toBe("at-vendor");
  });

  it("a quote at or above the write-off share outranks being at a vendor (seeded BR-LT-0090)", () => {
    expect(repairStage(asset({ vendorId: "v1", repairQuote: 34_000, cost: 55_000 }))).toBe("beyond-repair");
    expect(repairStage(asset({ repairQuote: 33_000, cost: 55_000 }))).toBe("beyond-repair"); // exactly 60%
    expect(repairStage(asset({ repairQuote: 18_400, cost: 55_000 }))).toBe("to-assess"); // 33% — repair it
  });

  it("an item that came back reads RETURNED OK — the one stage outside status=DEFECTIVE", () => {
    expect(repairStage(asset({ status: "SPARE" }))).toBe("returned-ok");
    expect(repairStage(asset({ status: "DEPLOYED" }))).toBe("returned-ok");
  });

  it("an asset that was never defective has no stage at all", () => {
    expect(repairStage(asset({ status: "SPARE", defectiveSince: null }))).toBeNull();
  });

  it("beyondRepair needs both numbers and refuses to divide by a zero cost", () => {
    expect(beyondRepair(34_000, 55_000)).toBe(true);
    expect(beyondRepair(null, 55_000)).toBe(false);
    expect(beyondRepair(34_000, null)).toBe(false);
    expect(beyondRepair(34_000, 0)).toBe(false);
    expect(REPAIR_WRITE_OFF_SHARE).toBe(0.6);
  });
});

describe("the Down column — the number that changes behaviour", () => {
  const now = new Date("2026-08-18T00:00:00Z");

  it("counts whole days out of service", () => {
    expect(downDays({ status: "DEFECTIVE", defectiveSince: new Date("2026-08-01T00:00:00Z") }, now)).toBe(17);
  });

  it("is null once the item no longer reads DEFECTIVE — the clock stopped and we don't record when", () => {
    expect(downDays({ status: "SPARE", defectiveSince: new Date("2026-08-01T00:00:00Z") }, now)).toBeNull();
  });

  it("is null without a defectiveSince, never 0 — unknown is not 'today'", () => {
    expect(downDays({ status: "DEFECTIVE", defectiveSince: null }, now)).toBeNull();
  });

  it("never goes negative on a clock-skewed row", () => {
    expect(downDays({ status: "DEFECTIVE", defectiveSince: new Date("2026-08-19T00:00:00Z") }, now)).toBe(0);
  });
});

describe("quoteWarning names the share, so moving the line is visible", () => {
  it("warns with both amounts and the percentage", () => {
    const warning = quoteWarning(34_000, 55_000);
    expect(warning).toContain("₱34,000");
    expect(warning).toContain("₱55,000");
    expect(warning).toContain("62%");
    expect(warning).toContain("60%");
  });

  it("says nothing about a repair worth doing", () => {
    expect(quoteWarning(18_400, 55_000)).toBeNull();
    expect(quoteWarning(null, 55_000)).toBeNull();
  });
});

describe("repairs is a saved view, so the URL decides", () => {
  // built directly rather than parsed: this is the predicate's contract, and the
  // parser's own contract (that `stage` IS a facet) is tested in inventory-list.
  const state = (filters: Record<string, string[]>): ListState => ({ q: "", page: 1, sort: [], filters });

  it("the named URL pins DEFECTIVE and sorts by the down clock", () => {
    expect(REPAIRS_SAVED_VIEW).toBe("/inventory?status=DEFECTIVE&sort=defectiveSince");
  });

  it("status pinned to exactly DEFECTIVE is repair mode", () => {
    expect(isRepairView(state({ status: ["DEFECTIVE"] }))).toBe(true);
    expect(isRepairView(state({ status: ["DEFECTIVE", "SPARE"] }))).toBe(false);
    expect(isRepairView(state({ status: ["SPARE"] }))).toBe(false);
    expect(isRepairView(state({}))).toBe(false);
  });

  it("any stage facet is repair mode, even the one that isn't DEFECTIVE", () => {
    expect(isRepairView(state({ stage: ["returned-ok"] }))).toBe(true);
    expect(isRepairView(state({ stage: ["nonsense"] }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/repairs.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/repairs.ts`**

```ts
import { fmtMoney } from "./format";
import type { ListState } from "./url-state";

/**
 * Repairs is a SAVED VIEW over the inventory list, not a route and not an enum
 * (README 7b): every stage is derived from the vendor/RMA/quote/defectiveSince
 * fields that already exist on Asset. Ids are URL-safe slugs; the uppercase
 * words are display only.
 */
export const REPAIR_STAGES = ["to-assess", "at-vendor", "returned-ok", "beyond-repair"] as const;

export type RepairStage = (typeof REPAIR_STAGES)[number];

export const REPAIR_STAGE_LABEL: Record<RepairStage, string> = {
  "to-assess": "TO ASSESS",
  "at-vendor": "AT VENDOR",
  "returned-ok": "RETURNED OK",
  "beyond-repair": "BEYOND REPAIR",
};

/** The named URL behind the "Repairs" saved view — sorted by the down clock, oldest first. */
export const REPAIRS_SAVED_VIEW = "/inventory?status=DEFECTIVE&sort=defectiveSince";

/**
 * A stated default, not a discovered truth (scope decision #6): a quote at or
 * above this share of what the unit cost is a replace decision, not a repair
 * one. It lives in exactly one place so moving the line is a one-line change.
 */
export const REPAIR_WRITE_OFF_SHARE = 0.6;

export interface RepairLike {
  status: string;
  vendorId: string | null;
  rmaRef: string | null;
  repairQuote: number | null;
  cost: number | null;
  defectiveSince: Date | null;
}

export function isRepairStage(value: string): value is RepairStage {
  return (REPAIR_STAGES as readonly string[]).includes(value);
}

export function beyondRepair(quote: number | null, cost: number | null): boolean {
  if (quote === null || cost === null || cost <= 0) return false;
  return quote >= cost * REPAIR_WRITE_OFF_SHARE;
}

/**
 * RETURNED OK deliberately steps outside `status=DEFECTIVE` — it is the stage
 * for an item that came back — which is why the chips write a URL rather than
 * filtering the current page.
 */
export function repairStage(a: RepairLike): RepairStage | null {
  if (a.status !== "DEFECTIVE") return a.defectiveSince ? "returned-ok" : null;
  if (beyondRepair(a.repairQuote, a.cost)) return "beyond-repair";
  if (a.vendorId || a.rmaRef) return "at-vendor";
  return "to-assess";
}

/**
 * Days out of service — the column that changes behaviour. null once the item
 * no longer reads DEFECTIVE: the clock stopped and we don't record when, so a
 * number here would be a lie.
 */
export function downDays(
  a: Pick<RepairLike, "status" | "defectiveSince">,
  now: Date = new Date(),
): number | null {
  if (a.status !== "DEFECTIVE" || !a.defectiveSince) return null;
  return Math.max(0, Math.floor((now.getTime() - a.defectiveSince.getTime()) / 86_400_000));
}

/** The sentence on the record when repairing costs too much of a new unit. */
export function quoteWarning(quote: number | null, cost: number | null): string | null {
  if (!beyondRepair(quote, cost)) return null;
  const share = Math.round((quote! / cost!) * 100);
  return `The ${fmtMoney(quote)} quote is ${share}% of the ${fmtMoney(cost)} this unit cost — at or above the ${Math.round(REPAIR_WRITE_OFF_SHARE * 100)}% write-off line. Replace rather than repair.`;
}

/** The inventory list switches into repair mode when the URL says so. */
export function isRepairView(state: ListState): boolean {
  if ((state.filters.stage ?? []).some(isRepairStage)) return true;
  const status = state.filters.status ?? [];
  return status.length === 1 && status[0] === "DEFECTIVE";
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/repairs.test.ts` — Expected: PASS.

- [ ] **Step 5: Teach the list state about `stage` (TDD)**

Append to `src/lib/inventory-list.test.ts`:

```ts
describe("the stage facet narrows to the repair candidate set", () => {
  it("any known stage adds the candidate clause — the final cut is repairStage's", () => {
    expect(buildAssetWhere(parse("stage=beyond-repair")).AND).toEqual([
      { OR: [{ status: "DEFECTIVE" }, { defectiveSince: { not: null } }] },
    ]);
  });

  it("an unknown stage narrows nothing", () => {
    expect(buildAssetWhere(parse("stage=sort-of-broken")).AND).toBeUndefined();
  });

  it("stage rides alongside q without eating its OR", () => {
    const where = buildAssetWhere(parse("q=dell&stage=at-vendor"));
    expect(where.OR).toHaveLength(3);
    expect(where.AND).toHaveLength(1);
  });

  it("stage is a configured facet, so the URL round-trips it", () => {
    expect(parse("stage=at-vendor").filters.stage).toEqual(["at-vendor"]);
  });

  it("defectiveSince is sortable — the Down column is a real header", () => {
    expect(INVENTORY_LIST_CONFIG.sortable).toContain("defectiveSince");
    expect(parse("sort=defectiveSince").sort).toEqual([{ key: "defectiveSince", dir: "asc" }]);
  });
});
```

Run: `npm run test -- src/lib/inventory-list.test.ts` — Expected: FAIL (four new cases).

Now edit `src/lib/inventory-list.ts`. Add the import below the existing ones:

```ts
import { isRepairStage } from "./repairs";
```

Replace the config with:

```ts
export const INVENTORY_LIST_CONFIG: ListConfig = {
  facets: ["status", "category", "type", "assignee", "stage"],
  sortable: [
    "tag", "model", "category", "status", "purchasedAt", "warrantyUntil",
    // the repairs view's Down column
    "defectiveSince",
  ],
  defaultSort: [{ key: "tag", dir: "asc" }],
};
```

and add this immediately before `return where;` in `buildAssetWhere`:

```ts
  // `stage` is DERIVED, and one of its four values (beyond-repair) compares
  // repairQuote against cost — something no Prisma filter can express. So the
  // facet narrows to the repair CANDIDATE set here and repairStage() makes the
  // final cut in listAssets: one source of truth, correct counts.
  // AND coexists with the q-driven OR above; Prisma ands them together.
  if ((f.stage ?? []).some(isRepairStage)) {
    where.AND = [{ OR: [{ status: "DEFECTIVE" }, { defectiveSince: { not: null } }] }];
  }
```

Run: `npm run test -- src/lib/inventory-list.test.ts` — Expected: PASS (including the pre-existing cases).

- [ ] **Step 6: Fix the two repair fixtures the seed can't currently show**

`prisma/seed.ts` has no asset that reaches `beyond-repair` (BR-LT-0090's ₱18,400 quote is 33% of its
₱55,000 cost, well under the write-off line) and none that reaches `returned-ok` at all. Two chips
with nothing behind them is the exact gap Phase 6 found twice.

Replace this line:

```ts
      mk("BR-LT-0090", "Dell Latitude 5410", "Laptop", "DEFECTIVE", { defectiveSince: day(-44), repairQuote: 18_400, notes: "Board failure, out of warranty", warrantyUntil: day(-200), purchasedAt: day(-1250) }),
```

with:

```ts
      // the BEYOND REPAIR fixture: ₱34,000 to fix a ₱55,000 machine is 62%,
      // over the 60% write-off line, so the repairs view can show the warning
      // the design is about
      mk("BR-LT-0090", "Dell Latitude 5410", "Laptop", "DEFECTIVE", { defectiveSince: day(-44), repairQuote: 34_000, notes: "Board failure, out of warranty — vendor quote is most of a new unit", warrantyUntil: day(-200), purchasedAt: day(-1250) }),
```

and replace this line:

```ts
      mk("BR-MN-0911", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000, purchasedAt: day(-200) }),
```

with:

```ts
      // the RETURNED OK fixture: back from the vendor and usable again, but it
      // KEEPS its defectiveSince — "was defective, isn't now" is what that
      // stage means, and clearing the date would erase the repair history
      mk("BR-MN-0911", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000, purchasedAt: day(-200), defectiveSince: day(-70), notes: "Reflowed by Octagon Repairs — back in the spare pool" }),
```

BR-MN-0911 stays `SPARE`, so Home's coverage line and the spare pool are untouched.

- [ ] **Step 7: Start the down clock when an item BECOMES defective**

Without this, the wizard's Defective outcome lands as `DEFECTIVE` with no `defectiveSince`, so the
repairs view shows it with an empty Down column forever.

In `src/worker/execute-approval.ts`, replace:

```ts
    // Apply + audit the ASSET diff in the same transaction (entry criterion #2).
    await tx.asset.update({ where: { id: asset.id }, data: plan.updates });
```

with:

```ts
    // Apply + audit the ASSET diff in the same transaction (entry criterion #2).
    // The repairs view derives its Down clock and its stage chips from
    // defectiveSince, so an item ENTERING defective has to start that clock —
    // the offboarding wizard's Defective outcome arrives right here. It is
    // never cleared: "has a defectiveSince but no longer reads DEFECTIVE" is
    // precisely what the RETURNED OK stage means.
    const updates: Prisma.AssetUpdateInput = { ...plan.updates };
    if (plan.updates.status === "DEFECTIVE" && asset.status !== "DEFECTIVE") {
      updates.defectiveSince = new Date();
    }
    await tx.asset.update({ where: { id: asset.id }, data: updates });
```

`Prisma` is already imported as a type at the top of that file — no new import.

- [ ] **Step 8: Full unit suite, typecheck, lint, reseed, commit**

```bash
npm run test && npx tsc --noEmit && npm run lint && npm run db:seed
```

Expected: all unit tests pass; the seed reports success. (E2E comes in Task 15.)

```bash
git add src/lib/repairs.ts src/lib/repairs.test.ts src/lib/inventory-list.ts src/lib/inventory-list.test.ts prisma/seed.ts src/worker/execute-approval.ts
git commit -m "feat(repairs): derived stages, the down clock, and fixtures that can reach both ends"
```

---

### Task 12: Repair mode on the inventory list — and the hold marker

> **Two requirements from the Task 11 review — read before writing any of this.**
>
> **1. The in-memory `repairStage()` cut must be applied to EVERY consumer of `buildAssetWhere`, not
> just `listAssets`.** There are four: `listAssets`, `facetOptions` (its four `groupBy` counts), the
> CSV export route (`src/app/(app)/inventory/export/route.ts`), and — the dangerous one —
> `bulkRequestStatusChange` (`src/server/modules/inventory/actions.ts`), which acts on **all matching**
> when the drawer's "all matching" path is used. `stage` is a configured facet, so it survives
> `serializeListState` and reaches all four. Add the cut to `listAssets` alone and this happens: the
> operator opens `?stage=beyond-repair`, the table says **1 asset**, the bulk drawer says "acting on
> all 1 matching", they pick DISPOSE — and **7 approvals are created**, including a healthy SPARE
> monitor. The CSV has 7 rows for the same reason, and the Status dropdown's counts read 6/1 on a page
> showing 1 row. The narrowing in SQL is a *candidate set*, and a candidate set is not safe to act on.
> Either resolve `stage` to explicit ids before the bulk/export paths run, or refuse the `filters` path
> when `state.filters.stage` is set.
>
> **2. Stage chips must write their URL with `withRepairStage(state, stage)` from `src/lib/repairs.ts`,
> never `withFilter(state, "stage", …)`.** `REPAIRS_SAVED_VIEW` pins `status=DEFECTIVE`, and
> `returned-ok` is *defined* as "not DEFECTIVE", so a chip that keeps the pin composes to a query
> matching nothing for every possible dataset. `withRepairStage` clears `status` and is tested for it.

> **Amended after the Task 12 review — the shipped code differs from the blocks below in four ways:**
> the Repair card on `/inventory/[id]` is gated on having repair **data** (`stage !== null ||
> asset.vendor || asset.rmaRef || quote !== null`), not on having a stage, with only the Down and
> Defective-since rows gated on the stage — gating the whole card hid the quote and the write-off
> banner for an asset quoted before its DEFECTIVE approval executed, which is the normal order;
> `ChipFilterRow` in `inventory/page.tsx` skips the `stage` facet while `repairMode` (its generic
> remove cleared the stage without restoring the status pin, dumping the user out of repair mode);
> `InventoryToolbar` hides the **Status** facet while a stage facet is active (a stage already
> constrains status, and the dropdown was advertising counts for combinations that can never match);
> and one exported `stageOf()` in `queries.ts`, typed `Prisma.Decimal | null`, replaces the three
> hand-written copies of the row→stage marshalling.

The saved view is a named URL; what makes it *repairs* is the stage chips, the **Down** column, and
the warning on the record. The `HOLD` marker rides along in the same query because both facts come
from the same read: reserved stock **still reads SPARE** (README 5c) and pretending otherwise creates
phantom spares.

**Files:**
- Modify: `src/server/modules/inventory/queries.ts`, `src/components/inventory/inventory-table.tsx`,
  `src/app/(app)/inventory/page.tsx`, `src/app/(app)/inventory/[id]/page.tsx`
- Create: `src/components/inventory/repair-chips.tsx`

- [ ] **Step 1: Widen the list query**

In `src/server/modules/inventory/queries.ts`, add these imports below the existing ones:

```ts
import type { Prisma } from "@prisma/client";
import { REPAIR_STAGE_LABEL, downDays, isRepairStage, repairStage, type RepairStage } from "@/lib/repairs";
```

Replace the `AssetRow` interface and `listAssets` (everything from `export interface AssetRow` down to
the closing brace of `listAssets`) with:

```ts
/** Serializable DTO for the client table island — strings only, preformatted. */
export interface AssetRow {
  id: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  assignee: string | null;
  /** ACTIVE-reservation holder. The asset still reads SPARE — the hold is a marker, not a status. */
  hold: string | null;
  purchased: string;
  warranty: string;
  /** derived repair stage id; null if the asset was never defective */
  stage: RepairStage | null;
  stageLabel: string | null;
  /** days out of service; null unless it currently reads DEFECTIVE */
  down: number | null;
}

const LIST_INCLUDE = {
  category: true,
  assignee: true,
  reservations: { where: { state: "ACTIVE" }, include: { employee: true } },
} satisfies Prisma.AssetInclude;

function toRow(a: {
  id: string;
  tag: string;
  model: string;
  status: string;
  purchasedAt: Date | null;
  warrantyUntil: Date | null;
  defectiveSince: Date | null;
  vendorId: string | null;
  rmaRef: string | null;
  cost: unknown;
  repairQuote: unknown;
  category: { name: string };
  assignee: { name: string } | null;
  reservations: Array<{ employee: { name: string } }>;
}): AssetRow {
  const stage = repairStage({
    status: a.status,
    vendorId: a.vendorId,
    rmaRef: a.rmaRef,
    repairQuote: a.repairQuote === null ? null : Number(a.repairQuote),
    cost: a.cost === null ? null : Number(a.cost),
    defectiveSince: a.defectiveSince,
  });
  return {
    id: a.id,
    tag: a.tag,
    model: a.model,
    category: a.category.name,
    status: a.status,
    assignee: a.assignee?.name ?? null,
    hold: a.reservations[0]?.employee.name ?? null,
    purchased: fmtDate(a.purchasedAt),
    warranty: fmtDate(a.warrantyUntil),
    stage,
    stageLabel: stage ? REPAIR_STAGE_LABEL[stage] : null,
    down: downDays(a),
  };
}

export async function listAssets(state: ListState): Promise<{
  rows: AssetRow[];
  total: number;
  pageCount: number;
}> {
  const where = buildAssetWhere(state);
  const orderBy = buildAssetOrderBy(state.sort);
  const stages = (state.filters.stage ?? []).filter(isRepairStage);

  // Repair mode pages in memory: beyond-repair compares repairQuote against
  // cost, which no Prisma filter can express, so repairStage() has to make the
  // cut after the read — and then the count has to come from the cut set, not
  // from the candidate set, or "12 assets" would be a lie. buildAssetWhere has
  // already narrowed this to the defective corner of a team-scale fleet (the
  // same reasoning the employees list uses for its loadout filter).
  if (stages.length > 0) {
    const matched = (await prisma.asset.findMany({ where, orderBy, include: LIST_INCLUDE }))
      .map(toRow)
      .filter((r) => r.stage !== null && stages.includes(r.stage));
    const total = matched.length;
    return {
      total,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      rows: matched.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE),
    };
  }

  const [total, assets] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy,
      skip: (state.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: LIST_INCLUDE,
    }),
  ]);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: assets.map(toRow),
  };
}
```

- [ ] **Step 2: The stage chips**

Create `src/components/inventory/repair-chips.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@/lib/cn";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { REPAIR_STAGES, REPAIR_STAGE_LABEL, isRepairStage } from "@/lib/repairs";
import { serializeListState, withFilter, type ListState } from "@/lib/url-state";

/**
 * Stage chips write the URL rather than filtering the page, because one of them
 * (RETURNED OK) describes assets that are NOT DEFECTIVE — so picking a stage
 * clears the status facet instead of narrowing inside it.
 */
export function RepairChips({ state }: { state: ListState }) {
  const active = (state.filters.stage ?? []).filter(isRepairStage);
  const href = (next: ListState) => "/inventory" + serializeListState(next, INVENTORY_LIST_CONFIG);
  const chipClass = (on: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
      on
        ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
        : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-fg-faint">stage</span>
      <Link
        href={href(withFilter({ ...state, filters: { ...state.filters, stage: [] } }, "status", ["DEFECTIVE"]))}
        aria-current={active.length === 0 ? "page" : undefined}
        className={chipClass(active.length === 0)}
      >
        ALL DEFECTIVE
      </Link>
      {REPAIR_STAGES.map((stage) => {
        const on = active.includes(stage);
        // picking a stage drops the status facet; un-picking returns to all-defective
        const cleared: ListState = { ...state, filters: { ...state.filters, status: [] } };
        const next = withFilter(cleared, "stage", on ? [] : [stage]);
        return (
          <Link
            key={stage}
            href={href(on ? withFilter({ ...next, filters: { ...next.filters, stage: [] } }, "status", ["DEFECTIVE"]) : next)}
            aria-current={on ? "page" : undefined}
            className={chipClass(on)}
          >
            {REPAIR_STAGE_LABEL[stage]}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Two more columns and the hold marker in the table**

In `src/components/inventory/inventory-table.tsx`:

Add `Pill` to the imports:

```tsx
import { Pill } from "@/components/ui/pill";
```

Extend the column list — replace `INVENTORY_COLUMNS` with:

```tsx
/** README `1f`: ☐ · dot · tag(104) · model(flex) · category(84) · assigned(168) · status(88) · purchased(104) · warranty(72). */
export const INVENTORY_COLUMNS: ColumnDef[] = [
  { id: "tag", label: "Tag", width: 104, sortKey: "tag" },
  { id: "model", label: "Model", sortKey: "model" },
  { id: "category", label: "Category", width: 84, sortKey: "category" },
  { id: "assigned", label: "Assigned", width: 168 },
  { id: "status", label: "Status", width: 88, sortKey: "status" },
  // repairs saved view only (README 7b)
  { id: "stage", label: "Stage", width: 108 },
  { id: "down", label: "Down", width: 68, sortKey: "defectiveSince" },
  { id: "purchased", label: "Purchased", width: 104, sortKey: "purchasedAt" },
  { id: "warranty", label: "Warranty", width: 72, sortKey: "warrantyUntil" },
];

/** Columns that only exist in repair mode — never offered to the column chooser. */
export const REPAIR_ONLY_COLUMNS = ["stage", "down"] as const;
```

Add `repairMode` to the props — replace the component's parameter list and destructuring:

```tsx
export function InventoryTable({
  rows,
  state,
  visible,
  canMutate,
  filtersQS,
  total,
  repairMode = false,
}: {
  rows: AssetRow[];
  state: ListState;
  visible: string[]; // hideable-column ids currently shown
  canMutate: boolean;
  filtersQS: string; // serialized current list state, no leading "?"
  total: number;
  /** the repairs saved view: adds Stage + Down (README 7b) */
  repairMode?: boolean;
}) {
```

Replace the `columns` computation with:

```tsx
  const columns = INVENTORY_COLUMNS.filter((c) => {
    if ((REPAIR_ONLY_COLUMNS as readonly string[]).includes(c.id)) return repairMode;
    return !(HIDEABLE_COLUMNS as readonly string[]).includes(c.id) || visible.includes(c.id);
  });
```

Replace the `case "assigned":` arm with:

```tsx
                case "assigned":
                  return (
                    <Td key={col.id}>
                      {row.assignee ?? (row.hold ? (
                        // README 5c: a hold never changes the status — the asset
                        // still reads SPARE, and the marker says who wants it.
                        <span className="inline-flex items-center gap-1.5">
                          <Pill tone="accent">HOLD</Pill>
                          <span className="text-[11px] text-fg-muted">for {row.hold}</span>
                        </span>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      ))}
                    </Td>
                  );
```

and add these two arms directly after the `case "status":` arm:

```tsx
                case "stage":
                  return <Td key={col.id} mono className="text-[10.5px]">{row.stageLabel ?? "—"}</Td>;
                case "down":
                  return (
                    <Td key={col.id} mono>
                      {row.down === null ? <span className="text-fg-faint">—</span> : `${row.down} d`}
                    </Td>
                  );
```

- [ ] **Step 4: Wire the page**

In `src/app/(app)/inventory/page.tsx`, add imports:

```tsx
import { REPAIRS_SAVED_VIEW, REPAIR_STAGE_LABEL, isRepairStage, isRepairView } from "@/lib/repairs";
import { RepairChips } from "@/components/inventory/repair-chips";
```

After the `hasFilters` / `href` lines, add:

```tsx
  const repairMode = isRepairView(state);
```

Give the stage chip a readable label — replace the chip-building loop with:

```tsx
  const chips: FilterChip[] = [];
  for (const [facet, values] of Object.entries(state.filters)) {
    for (const value of values) {
      const label =
        facet === "stage" && isRepairStage(value)
          ? REPAIR_STAGE_LABEL[value]
          : facets[facet]?.find((o) => o.value === value)?.label ?? value;
      chips.push({
        label: `${facet}: ${label}`,
        removeHref: href(withFilter(state, facet, values.filter((v) => v !== value))),
      });
    }
  }
```

Add the saved-view link inside the toolbar, next to the column chooser — replace:

```tsx
        <InventoryToolbar state={state} total={total} facets={facets}>
          <ColumnChooser visible={visibleColumns} />
        </InventoryToolbar>
```

with:

```tsx
        <InventoryToolbar state={state} total={total} facets={facets}>
          <ColumnChooser visible={visibleColumns} />
          {/* Saved views are named URLs (README): Repairs is one of them. */}
          <ButtonLink size="sm" href={REPAIRS_SAVED_VIEW}>Repairs</ButtonLink>
        </InventoryToolbar>
        {repairMode && <RepairChips state={state} />}
```

and pass the flag to the table — replace `total={total}` in the `<InventoryTable>` call with:

```tsx
              total={total}
              repairMode={repairMode}
```

- [ ] **Step 5: The repair card on the record**

In `src/app/(app)/inventory/[id]/page.tsx`, add imports:

```tsx
import { Banner } from "@/components/ui/banner";
import { Pill } from "@/components/ui/pill";
import { REPAIR_STAGE_LABEL, downDays, quoteWarning, repairStage } from "@/lib/repairs";
```

After the `warranty` line, add:

```tsx
  const cost = asset.cost === null ? null : Number(asset.cost);
  const quote = asset.repairQuote === null ? null : Number(asset.repairQuote);
  const stage = repairStage({
    status: asset.status,
    vendorId: asset.vendorId,
    rmaRef: asset.rmaRef,
    repairQuote: quote,
    cost,
    defectiveSince: asset.defectiveSince,
  });
  const warning = quoteWarning(quote, cost);
  const down = downDays(asset);
```

Remove the repair rows from the procurement card so the facts live in one place — replace:

```tsx
              ...(asset.vendor || asset.rmaRef || asset.repairQuote
                ? [
                    { label: "Vendor", value: asset.vendor?.name ?? "—" },
                    { label: "RMA", value: asset.rmaRef ?? "—", mono: true },
                    { label: "Quote", value: fmtMoney(asset.repairQuote === null ? null : Number(asset.repairQuote)), mono: true },
                  ]
                : []),
              { label: "Notes", value: asset.notes ?? "—" },
```

with:

```tsx
              { label: "Notes", value: asset.notes ?? "—" },
```

and add this card as the last child of the outer grid `div`, after the closing `</Card>` of
"Procurement & warranty":

```tsx
      {stage !== null && (
        <Card className="lg:col-span-2">
          <CardHeader
            title="Repair"
            actions={<Pill tone={stage === "returned-ok" ? "neutral" : "accent"}>{REPAIR_STAGE_LABEL[stage]}</Pill>}
          />
          <CardBody className="flex flex-col gap-3">
            {warning && <Banner tone="attention" title="Repairing costs too much of a new unit">{warning}</Banner>}
            <DescriptionList
              items={[
                { label: "Down", value: down === null ? "clock stopped" : `${down} d out of service`, mono: true },
                { label: "Defective since", value: fmtDate(asset.defectiveSince), mono: true },
                { label: "Vendor", value: asset.vendor?.name ?? "—" },
                { label: "RMA", value: asset.rmaRef ?? "—", mono: true },
                { label: "Quote", value: fmtMoney(quote), mono: true },
              ]}
            />
          </CardBody>
        </Card>
      )}
```

- [ ] **Step 6: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

In the preview as `it@thebackroomop.com`:

1. `/inventory` → the **Repairs** button lands on `?status=DEFECTIVE&sort=defectiveSince`, six rows,
   Stage and Down columns present, `BR-LT-0090` reading `BEYOND REPAIR` / `44 d`.
2. Click **AT VENDOR** → URL becomes `?stage=at-vendor`, three rows (BR-LT-0118, BR-MN-0731, BR-DK-0033).
3. Click **RETURNED OK** → one row, `BR-MN-0911`, whose Status still reads `SPARE` and whose Down is `—`.
4. Back on the unfiltered list, `BR-MN-0910` shows `HOLD · for Nina Robles` in Assigned while Status
   still reads `SPARE`.
5. Open `BR-LT-0090` → the Repair card carries the amber quote warning naming 62% and 60%.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/inventory/queries.ts src/components/inventory "src/app/(app)/inventory/page.tsx" "src/app/(app)/inventory/[id]/page.tsx"
git commit -m "feat(repairs): stage chips, the Down column, the quote warning and the hold marker"
```

---

### Task 13: `/reservations`

Read-only this phase (scope decision #10): creating and releasing holds already live on the asset
record. What was missing is the cross-asset view the sidebar has been linking to.

**Files:**
- Create: `src/server/modules/reservations/queries.ts`, `src/app/(app)/reservations/page.tsx`

- [ ] **Step 1: Write the query module**

Create `src/server/modules/reservations/queries.ts`:

```ts
import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";

/**
 * Tabs write `?state=`. EXPIRED (the clock ran out) and RELEASED (a person let
 * it go) share the Closed tab but must stay distinguishable — README 5c.
 */
export const RESERVATION_TABS = [
  { id: "ACTIVE", label: "Active", states: ["ACTIVE"] },
  { id: "FULFILLED", label: "Fulfilled", states: ["FULFILLED"] },
  { id: "CLOSED", label: "Closed", states: ["RELEASED", "EXPIRED"] },
] as const;

export type ReservationTab = (typeof RESERVATION_TABS)[number]["id"];

export function parseReservationTab(raw: string | null | undefined): ReservationTab {
  return (RESERVATION_TABS.some((t) => t.id === raw) ? raw : "ACTIVE") as ReservationTab;
}

export interface ReservationRow {
  id: string;
  state: string;
  assetId: string;
  tag: string;
  model: string;
  /** the asset's OWN status — a hold never changes it, or spares turn into phantoms */
  assetStatus: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  reason: string | null;
  expires: string;
  resolved: string;
  /** how it closed: the clock, or a person */
  closedBy: "clock" | "person" | null;
}

export async function listReservations(tab: ReservationTab): Promise<{
  rows: ReservationRow[];
  counts: Record<ReservationTab, number>;
}> {
  const states = RESERVATION_TABS.find((t) => t.id === tab)!.states;
  const [reservations, grouped] = await Promise.all([
    prisma.reservation.findMany({
      where: { state: { in: [...states] } },
      include: { asset: true, employee: true },
      // rows seeded in one transaction share a createdAt millisecond — the id
      // tiebreaker is what stops two reads returning a different order
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.reservation.groupBy({ by: ["state"], _count: true }),
  ]);
  const countOf = (s: string) => grouped.find((g) => g.state === s)?._count ?? 0;

  return {
    rows: reservations.map((r): ReservationRow => ({
      id: r.id,
      state: r.state,
      assetId: r.assetId,
      tag: r.asset.tag,
      model: r.asset.model,
      assetStatus: r.asset.status,
      employeeId: r.employeeId,
      employeeName: r.employee.name,
      employeeNo: r.employee.employeeNo,
      reason: r.reason,
      expires: fmtDate(r.expiresAt),
      resolved: fmtDate(r.resolvedAt),
      closedBy: r.state === "EXPIRED" ? "clock" : r.state === "RELEASED" ? "person" : null,
    })),
    counts: {
      ACTIVE: countOf("ACTIVE"),
      FULFILLED: countOf("FULFILLED"),
      CLOSED: countOf("RELEASED") + countOf("EXPIRED"),
    },
  };
}
```

- [ ] **Step 2: Write the page**

Create `src/app/(app)/reservations/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import {
  RESERVATION_TABS, listReservations, parseReservationTab,
} from "@/server/modules/reservations/queries";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const tab = parseReservationTab(toSearchParams(await searchParams).get("state"));
  const { rows, counts } = await listReservations(tab);

  return (
    <>
      <PageHeader
        title="Reservations"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      <div className="flex flex-col gap-3">
        <Banner tone="neutral" title="A hold never changes an asset's status">
          Reserved stock still reads <span className="font-mono">SPARE</span> in inventory, marked{" "}
          <span className="font-mono">HOLD</span> — pretending it is gone creates phantom spares. Holds
          are placed and released on the asset record.
        </Banner>

        <Tabs
          items={RESERVATION_TABS.map((t) => ({
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                <span className="font-mono text-[10px] text-fg-muted">{counts[t.id]}</span>
              </span>
            ),
            href: `/reservations?state=${t.id}`,
            active: t.id === tab,
          }))}
          className="pb-1"
        />

        {rows.length === 0 ? (
          <EmptyState
            title={tab === "ACTIVE" ? "No active holds" : "Nothing in this tab"}
            description={
              tab === "ACTIVE"
                ? "Reserve a spare from an asset record when it is promised to someone but not yet assigned."
                : "Holds land here once they are fulfilled, released or expired."
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th width={19}><span className="sr-only">Hold state colour</span></Th>
                <Th width={104}>State</Th>
                <Th width={112}>Asset</Th>
                <Th>Model</Th>
                <Th width={96}>Reads</Th>
                <Th width={186}>For</Th>
                <Th>Reason</Th>
                <Th width={104}>Expires</Th>
                <Th width={160}>Closed</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="pr-0"><StatusDot value={r.state} /></Td>
                  <Td mono className="text-[10.5px]">{r.state}</Td>
                  <Td mono>
                    <Link href={`/inventory/${r.assetId}`} className="text-accent hover:underline">{r.tag}</Link>
                  </Td>
                  <Td>{r.model}</Td>
                  {/* the point of the column: the hold did not move the status */}
                  <Td mono className="text-[10.5px]">{r.assetStatus}</Td>
                  <Td>
                    <Link href={`/employees/${r.employeeId}`} className="text-accent hover:underline">
                      {r.employeeName}
                    </Link>
                    <span className="pl-1.5 font-mono text-[10.5px] text-fg-muted">{r.employeeNo}</span>
                  </Td>
                  <Td>{r.reason ?? "—"}</Td>
                  <Td mono>{r.expires}</Td>
                  <Td>
                    {r.closedBy === null ? (
                      <span className="text-fg-faint">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-muted">
                        <Icon name={r.closedBy === "clock" ? "sla" : "employee"} size={13} />
                        {r.closedBy === "clock" ? "expired" : "released"} {r.resolved}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

Expected in the preview: **Active 1** (BR-MN-0910 held for Nina Robles, "Reads" column showing
`SPARE`), **Fulfilled 1**, **Closed 2** — one row with the clock icon reading "expired", one with the
person icon reading "released". The two closed rows must not look interchangeable.

- [ ] **Step 4: Commit**

```bash
git add src/server/modules/reservations "src/app/(app)/reservations/page.tsx"
git commit -m "feat(reservations): the cross-asset hold list, expired and released kept distinct"
```

---

### Task 14: `/admin/equipment-policies`

Entry criterion #6: solid chips are required slots, grey are optional, role policy beats department
policy — and **editing never touches existing assignments**, which is why every slot change records
BOTH slot lists in the audit.

**Files:**
- Create: `src/server/modules/admin/policy-actions.ts`, `src/components/admin/policy-editor.tsx`,
  `src/app/(app)/admin/equipment-policies/page.tsx`
- Modify: `src/server/modules/employees/queries.ts`, `src/app/(app)/employees/[id]/page.tsx`,
  `src/server/modules/home/queries.ts`

- [ ] **Step 1: Make policy resolution deterministic**

Nothing stops two policies naming the same department once this page exists, and `resolvePolicy` takes
the first match — so the three `equipmentPolicy.findMany` calls must agree on an order. Add
`orderBy: [{ name: "asc" }]` to each:

- `src/server/modules/employees/queries.ts` — `prisma.equipmentPolicy.findMany({ include: { slots: true } })`
- `src/app/(app)/employees/[id]/page.tsx` — `prisma.equipmentPolicy.findMany({ include: { slots: { include: { assetType: true } } } })`
- `src/server/modules/home/queries.ts` — the `equipmentPolicy.findMany` call there

For example, the first becomes:

```ts
    prisma.equipmentPolicy.findMany({ include: { slots: true }, orderBy: [{ name: "asc" }] }),
```

(Task 5's `getWizard` already orders by name.)

- [ ] **Step 2: Write the actions**

Create `src/server/modules/admin/policy-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const PATHS = ["/admin/equipment-policies", "/employees", "/"] as const;

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** One slot, rendered the way the audit trail should read it. */
async function slotList(tx: Prisma.TransactionClient, policyId: string): Promise<string[]> {
  const slots = await tx.policySlot.findMany({
    where: { policyId },
    include: { assetType: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return slots.map((s) => `${s.name} · ${s.assetType?.name ?? "any type"} · ${s.required ? "required" : "optional"}`);
}

/**
 * Entry criterion #6: a policy edit changes what counts as complete from this
 * moment on and touches NO existing assignment — so before-and-after slot lists
 * are the only way the change is legible after the fact.
 */
async function auditSlots(
  tx: Prisma.TransactionClient,
  user: { id: string; name: string },
  policyId: string,
  before: string[],
  action: string,
): Promise<void> {
  await writeAudit(tx, {
    actorId: user.id,
    actorLabel: user.name,
    entityType: "equipment-policy",
    entityId: policyId,
    action,
    diff: { slots: { from: before, to: await slotList(tx, policyId) } },
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60),
  /** exactly one target: a role (title) or a department */
  appliesToTitle: z.string().trim().max(120).optional(),
  appliesToDepartmentId: z.string().optional(),
});

export async function createPolicy(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const title = (parsed.data.appliesToTitle ?? "").trim();
  const departmentId = parsed.data.appliesToDepartmentId ?? "";

  // A policy that targets nothing can never resolve; one that targets both
  // would hide which rule won. Role beats department, so it must be one.
  if ((title === "") === (departmentId === "")) {
    return validationError({
      appliesToTitle: "Target exactly one: a role title OR a department (role policy beats department policy).",
    });
  }
  if (departmentId && !(await prisma.department.findUnique({ where: { id: departmentId } }))) {
    return validationError({ appliesToDepartmentId: "Unknown department" });
  }

  try {
    let id = "";
    await prisma.$transaction(async (tx) => {
      const policy = await tx.equipmentPolicy.create({
        data: {
          name: parsed.data.name,
          appliesToTitle: title || null,
          appliesToDepartmentId: departmentId || null,
        },
      });
      id = policy.id;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "equipment-policy", entityId: policy.id,
        action: "create",
        diff: {
          name: { from: null, to: policy.name },
          appliesTo: { from: null, to: title ? `role: ${title}` : `department: ${departmentId}` },
          slots: { from: null, to: [] },
        },
      });
    });
    revalidateAll();
    return ok({ id });
  } catch (err) {
    if (isUnique(err)) return validationError({ name: "That policy name already exists" });
    throw err;
  }
}

const idSchema = z.object({ id: z.string().min(1) });

export async function deletePolicy(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const failure = await prisma.$transaction(async (tx) => {
    const policy = await tx.equipmentPolicy.findUnique({ where: { id: parsed.data.id } });
    if (!policy) return conflict("That policy no longer exists.");
    const before = await slotList(tx, policy.id);
    // PolicySlot cascades with the policy; assignments are untouched by design.
    await tx.equipmentPolicy.delete({ where: { id: policy.id } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "equipment-policy", entityId: policy.id,
      action: "delete",
      diff: { name: { from: policy.name, to: null }, slots: { from: before, to: null } },
    });
    return null;
  });
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}

const addSlotSchema = z.object({
  policyId: z.string().min(1),
  name: z.string().trim().min(2, "Name the slot").max(40),
  assetTypeId: z.string().min(1, "Pick an asset type"),
  required: z.boolean(),
});

export async function addSlot(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSlotSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let id = "";
  const failure = await prisma.$transaction(async (tx) => {
    const policy = await tx.equipmentPolicy.findUnique({ where: { id: d.policyId } });
    if (!policy) return conflict("That policy no longer exists.");
    // A typeless slot could never be filled — computeLoadout matches on type —
    // so it would be a permanent policy gap. Require the type.
    if (!(await tx.assetType.findUnique({ where: { id: d.assetTypeId } }))) {
      return validationError({ assetTypeId: "Unknown asset type" });
    }
    const before = await slotList(tx, policy.id);
    const slot = await tx.policySlot.create({
      data: { policyId: policy.id, name: d.name, assetTypeId: d.assetTypeId, required: d.required },
    });
    id = slot.id;
    await auditSlots(tx, user, policy.id, before, "policy.slot.added");
    return null;
  });
  if (failure) return failure;
  revalidateAll();
  return ok({ id });
}

const slotIdSchema = z.object({ slotId: z.string().min(1) });

export async function removeSlot(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = slotIdSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const failure = await prisma.$transaction(async (tx) => {
    const slot = await tx.policySlot.findUnique({ where: { id: parsed.data.slotId } });
    if (!slot) return conflict("That slot no longer exists.");
    const before = await slotList(tx, slot.policyId);
    await tx.policySlot.delete({ where: { id: slot.id } });
    await auditSlots(tx, user, slot.policyId, before, "policy.slot.removed");
    return null;
  });
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}

const requiredSchema = z.object({ slotId: z.string().min(1), required: z.boolean() });

/** Solid chip ⇄ grey chip: the difference between a policy gap and a nice-to-have. */
export async function setSlotRequired(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = requiredSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const failure = await prisma.$transaction(async (tx) => {
    const slot = await tx.policySlot.findUnique({ where: { id: d.slotId } });
    if (!slot) return conflict("That slot no longer exists.");
    if (slot.required === d.required) return null;
    const before = await slotList(tx, slot.policyId);
    // guarded on the before-value: two people flipping the same chip must not
    // silently agree on whichever write landed last
    const written = await tx.policySlot.updateMany({
      where: { id: slot.id, required: slot.required },
      data: { required: d.required },
    });
    if (written.count === 0) return conflict("Someone else just changed that slot — refresh.");
    await auditSlots(tx, user, slot.policyId, before, "policy.slot.changed");
    return null;
  });
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}
```

- [ ] **Step 3: Write the editor components**

Create `src/components/admin/policy-editor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  addSlot, createPolicy, deletePolicy, removeSlot, setSlotRequired,
} from "@/server/modules/admin/policy-actions";
import type { ActionResult } from "@/server/action-result";

export interface PolicySlotRow {
  id: string;
  name: string;
  typeName: string;
  required: boolean;
}

export interface PolicyCard {
  id: string;
  name: string;
  /** "role: Accountant" | "department: Finance" */
  appliesTo: string;
  slots: PolicySlotRow[];
  /** how many employees this policy currently resolves for */
  employees: number;
}

export interface TypeOption {
  id: string;
  label: string;
}

/** Shared error plumbing: every action returns the same ActionResult union. */
function useRunner() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, okMsg: string, onOk?: () => void) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast(okMsg, "settled");
        onOk?.();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return { pending, error, fieldErrors, retryAfter, setRetryAfter, run };
}

export function PolicyEditor({
  policy,
  types,
  canMutate,
}: {
  policy: PolicyCard;
  types: TypeOption[];
  canMutate: boolean;
}) {
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useRunner();
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [required, setRequired] = useState(true);

  return (
    <Card>
      <CardHeader
        title={policy.name}
        actions={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-fg-muted">
              {policy.appliesTo} · {policy.employees} {policy.employees === 1 ? "person" : "people"}
            </span>
            {canMutate && (
              <Menu
                trigger={(props) => (
                  <button
                    type="button"
                    {...props}
                    aria-label={`Actions for ${policy.name}`}
                    className="rounded-(--radius-ctl) px-2 py-0.5 text-fg-muted hover:bg-surface-subtle"
                  >
                    ⋯
                  </button>
                )}
                items={[
                  {
                    label: "Delete policy",
                    danger: true,
                    onSelect: () => run(() => deletePolicy({ id: policy.id }), "Policy deleted"),
                  },
                ]}
              />
            )}
          </span>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}

        <div className="flex flex-wrap items-center gap-1.5">
          {policy.slots.length === 0 && (
            <span className="text-xs text-fg-muted">No slots yet — nothing counts as missing for this policy.</span>
          )}
          {policy.slots.map((slot) => (
            <span key={slot.id} className="inline-flex items-center">
              {/* Solid = required (an unfilled one is the policy gap that lights
                  up on the loadout view and in Home's HIRE rows); grey = optional. */}
              <button
                type="button"
                disabled={!canMutate || pending}
                aria-label={`${slot.name} · ${slot.typeName} · ${slot.required ? "required" : "optional"}${canMutate ? " — click to toggle" : ""}`}
                onClick={() =>
                  run(
                    () => setSlotRequired({ slotId: slot.id, required: !slot.required }),
                    `${slot.name} is now ${slot.required ? "optional" : "required"}`,
                  )
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                  slot.required
                    ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                    : "border-border bg-border-faint text-fg-muted",
                  canMutate && "hover:opacity-80",
                )}
              >
                {slot.name}
                <span className="text-[9px] opacity-70">{slot.typeName}</span>
              </button>
              {canMutate && (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Remove the ${slot.name} slot from ${policy.name}`}
                  onClick={() => run(() => removeSlot({ slotId: slot.id }), `${slot.name} removed`)}
                  className="px-1 text-fg-faint hover:text-fg-secondary"
                >
                  −
                </button>
              )}
            </span>
          ))}
        </div>

        {canMutate && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-faint pt-3">
            <div className="flex flex-col gap-1">
              <Input
                aria-label={`New slot name for ${policy.name}`}
                placeholder="slot name, e.g. webcam"
                value={name}
                invalid={!!fieldErrors.name}
                className="w-[180px] py-1.5 text-xs"
                onChange={(e) => setName(e.target.value)}
              />
              <FormError>{fieldErrors.name}</FormError>
            </div>
            <div className="flex flex-col gap-1">
              <Select
                aria-label={`Asset type for the new slot in ${policy.name}`}
                value={typeId}
                invalid={!!fieldErrors.assetTypeId}
                className="w-[220px] py-1.5 text-xs"
                onChange={(e) => setTypeId(e.target.value)}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </Select>
              <FormError>{fieldErrors.assetTypeId}</FormError>
            </div>
            <label className="flex items-center gap-1.5 pb-1.5 text-xs text-fg-secondary">
              <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
              required
            </label>
            <Button
              size="sm"
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () => addSlot({ policyId: policy.id, name, assetTypeId: typeId, required }),
                  "Slot added — existing assignments are untouched",
                  () => setName(""),
                )
              }
            >
              Add slot
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function NewPolicyCard({ departments }: { departments: Array<{ id: string; name: string }> }) {
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useRunner();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("department");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [title, setTitle] = useState("");

  return (
    <Card>
      <CardHeader title="New policy" />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Input
              aria-label="New policy name"
              placeholder="policy name, e.g. Sales standard"
              value={name}
              invalid={!!fieldErrors.name}
              className="w-[200px] py-1.5 text-xs"
              onChange={(e) => setName(e.target.value)}
            />
            <FormError>{fieldErrors.name}</FormError>
          </div>
          <Select
            aria-label="Applies to"
            value={target}
            className="w-[140px] py-1.5 text-xs"
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="department">a department</option>
            <option value="title">a role title</option>
          </Select>
          {target === "department" ? (
            <Select
              aria-label="Department this policy applies to"
              value={departmentId}
              className="w-[180px] py-1.5 text-xs"
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          ) : (
            <div className="flex flex-col gap-1">
              <Input
                aria-label="Role title this policy applies to"
                placeholder="exact job title"
                value={title}
                invalid={!!fieldErrors.appliesToTitle}
                className="w-[180px] py-1.5 text-xs"
                onChange={(e) => setTitle(e.target.value)}
              />
              <FormError>{fieldErrors.appliesToTitle}</FormError>
            </div>
          )}
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            onClick={() =>
              run(
                () =>
                  createPolicy({
                    name,
                    ...(target === "department" ? { appliesToDepartmentId: departmentId } : { appliesToTitle: title }),
                  }),
                "Policy created — add its slots next",
                () => setName(""),
              )
            }
          >
            Create policy
          </Button>
        </div>
        <p className="text-[11px] text-fg-muted">
          A role policy beats a department policy for anyone whose title matches, so target exactly one.
        </p>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 4: Write the page**

Create `src/app/(app)/admin/equipment-policies/page.tsx`:

```tsx
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { resolvePolicy } from "@/lib/loadout";
import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import {
  NewPolicyCard, PolicyEditor, type PolicyCard,
} from "@/components/admin/policy-editor";

export default async function EquipmentPoliciesPage() {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";

  const [policies, types, employees, departments] = await Promise.all([
    prisma.equipmentPolicy.findMany({
      include: {
        appliesToDepartment: true,
        slots: { include: { assetType: true }, orderBy: [{ name: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.assetType.findMany({ include: { category: true }, orderBy: [{ name: "asc" }] }),
    prisma.employee.findMany({
      where: { employment: { not: "OFFBOARDED" } },
      select: { title: true, departmentId: true },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Whose completeness each policy actually decides — resolvePolicy is the same
  // brain the loadout view and Home's HIRE rows use, so the number can't drift.
  const resolved = employees.map((e) => resolvePolicy(e, policies)?.id ?? null);

  const cards: PolicyCard[] = policies.map((p) => ({
    id: p.id,
    name: p.name,
    appliesTo: p.appliesToTitle
      ? `role: ${p.appliesToTitle}`
      : p.appliesToDepartment
        ? `department: ${p.appliesToDepartment.name}`
        : "applies to nobody",
    employees: resolved.filter((id) => id === p.id).length,
    slots: p.slots.map((s) => ({
      id: s.id,
      name: s.name,
      typeName: s.assetType?.name ?? "any type",
      required: s.required,
    })),
  }));

  return (
    <>
      <PageHeader
        title="Equipment policies"
        badge={canMutate ? undefined : <Pill>READ-ONLY · VIEWER</Pill>}
      />
      <div className="flex max-w-[820px] flex-col gap-3">
        <Banner tone="neutral" title="Editing a policy never touches existing assignments">
          It changes what counts as <em>complete</em> from this moment on — which is why every slot
          change writes an audit entry carrying both the before and after slot lists. Solid chips are
          required (an unfilled one is the policy gap that lights up on the loadout view and in Home&apos;s
          hire rows); grey chips are optional. A role policy beats a department policy.
        </Banner>

        {cards.length === 0 && (
          <p className="text-xs text-fg-muted">
            No policies yet — without one, an employee record has no slot grid and nothing can read as missing.
          </p>
        )}

        {cards.map((policy) => (
          <PolicyEditor
            key={policy.id}
            policy={policy}
            canMutate={canMutate}
            types={types.map((t) => ({ id: t.id, label: `${t.category.name} · ${t.name}` }))}
          />
        ))}

        {canMutate && <NewPolicyCard departments={departments.map((d) => ({ id: d.id, name: d.name }))} />}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

In the preview as `it@thebackroomop.com`, `/admin/equipment-policies`:

1. "Finance standard" with six chips — five solid, "second monitor" grey — and
   `department: Finance · 4 people`.
2. Click the grey `second monitor` chip → it goes solid; the toast says so.
3. Add a slot ("webcam", any type, required) → a new solid chip appears.
4. `/audit` now has an `equipment-policy` row whose diff carries **both** slot lists.
5. Remove the webcam slot again and flip `second monitor` back to optional, so the seeded fixture is
   unchanged for the e2e run.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/admin/policy-actions.ts src/components/admin/policy-editor.tsx "src/app/(app)/admin/equipment-policies/page.tsx" src/server/modules/employees/queries.ts "src/app/(app)/employees/[id]/page.tsx" src/server/modules/home/queries.ts
git commit -m "feat(policies): slot chips, required toggle, and an audit trail carrying both lists"
```

---

### Task 15: E2E, cleanup, full battery, close-out

**Files:**
- Create: `e2e/offboarding.spec.ts`
- Modify: `src/app/(app)/[...pending]/page.tsx`, `docs/HANDOVER.md`

- [ ] **Step 1: Retire the "arrives in Phase 7" placeholder**

All three Phase 7 surfaces are real routes now, so the catch-all can never match them. In
`src/app/(app)/[...pending]/page.tsx`, delete this line from `PHASE_BY_PREFIX`:

```ts
  [/^(offboarding|reservations|admin\/equipment-policies)(\/|$)/, 7],
```

- [ ] **Step 2: Write the e2e spec**

Create `e2e/offboarding.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login, which keeps this
  // helper safe to call again mid-file to switch users.
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Seeded fixtures this file depends on (prisma/seed.ts):
//   Dennis Ong EMP-0090 is the only OFFBOARDING employee and holds exactly three
//   items: BR-LT-0166 (laptop ₱48,000), BR-PH-0312 (phone ₱18,000),
//   BR-HS-0510 (headset ₱5,500). His M365 reads `offboarding`.
//   Repairs: BR-LT-0090 beyond-repair (₱34,000 quote on a ₱55,000 unit, 44 d down) ·
//   BR-LT-0118 / BR-MN-0731 / BR-DK-0033 at-vendor · BR-LT-0122 / BR-KB-0402
//   to-assess · BR-MN-0911 returned-ok (SPARE, keeps its defectiveSince).
//   Holds: BR-MN-0910 ACTIVE for Nina Robles, plus one FULFILLED, one RELEASED,
//   one EXPIRED. One policy: "Finance standard", 6 slots, 5 required.
// Never reference raw cuids — the DB is reseeded and ids change every time.

// Spec files share one database and run in alphabetical order, so each file
// reseeds rather than inheriting another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("offboarding queue", () => {
  test("lists the leaver with what is still out, and Home's LEAVE row opens the wizard", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await expectNoSeriousAxe(page);

    const row = page.getByRole("row", { name: /Dennis Ong/ });
    await expect(row).toContainText("EMP-0090");
    await expect(row).toContainText("Operations");
    await expect(row).toContainText("0 of 3");
    await expect(row).toContainText("3 to go");

    await page.goto("/");
    const leave = page.locator("li").filter({ hasText: "Dennis Ong is leaving" });
    await expect(leave).toContainText("3 items still out");
    await expect(leave.getByRole("link", { name: "Collect equipment" })).toHaveAttribute(
      "href",
      /\/offboarding\/[a-z0-9]+/i,
    );
  });
});

// The wizard is a lifecycle: these run in order and depend on each other.
test.describe.serial("the 4-step wizard", () => {
  async function openWizard(page: Page) {
    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
    await expect(page.getByRole("heading", { name: "Dennis Ong", level: 1 })).toBeVisible();
  }

  // The page header carries its own "Farewell report" link (to the printable
  // sheet), so step navigation must always go through the step bar.
  async function gotoStep(page: Page, label: RegExp) {
    await page.getByRole("list", { name: "Offboarding steps" }).getByRole("link", { name: label }).click();
  }

  test("step 1 reviews holdings; steps 3 and 4 are not reachable while items are undecided", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    await expectNoSeriousAxe(page);

    // Operations has no equipment policy — the step must still be useful.
    await expect(page.getByText("No equipment policy applies to this person")).toBeVisible();
    for (const tag of ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"]) {
      await expect(page.getByRole("row", { name: new RegExp(tag) })).toBeVisible();
    }

    // Only Review and Collect are links; Accounts and Farewell report are inert.
    const steps = page.getByRole("list", { name: "Offboarding steps" });
    await expect(steps.getByRole("link")).toHaveCount(2);
    await expect(steps).toContainText("Accounts & M365");
  });

  test("a Missing decision without a reason is refused by the server", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    await gotoStep(page, /Collect items/);

    const phone = page.getByRole("group", { name: "Decide BR-PH-0312" });
    await phone.getByRole("radiogroup", { name: /Outcome for BR-PH-0312/ }).getByText("Missing").click();
    await phone.getByRole("button", { name: "Confirm decision" }).click();
    await expect(phone.getByText(/Missing needs a reason/)).toBeVisible();
  });

  test("each decision becomes its own approval, and Continue unblocks only when none are undecided", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    await gotoStep(page, /Collect items/);

    // Undecided is not the same as returned: the button is disabled, and it says why.
    await expect(page.getByRole("button", { name: /Continue to Accounts/ })).toBeDisabled();
    await expect(page.getByText(/3 items undecided/)).toBeVisible();

    const decide = async (tag: string, outcome: string, reason: string) => {
      const card = page.getByRole("group", { name: `Decide ${tag}` });
      await card.getByRole("radiogroup", { name: new RegExp(`Outcome for ${tag}`) }).getByText(outcome).click();
      if (reason) await card.getByLabel(/Reason/).fill(reason);
      await card.getByRole("button", { name: "Confirm decision" }).click();
      await expect(page.getByText(new RegExp(`APR-\\d+ created — ${tag}`))).toBeVisible();
    };

    await decide("BR-PH-0312", "Missing", "never handed back — investigation open");
    await decide("BR-LT-0166", "Defective", "screen cracked in transit");
    await decide("BR-HS-0510", "Returned", "");

    // Every decided item now shows its request and its landing status.
    await expect(page.getByText("MISSING").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue to Accounts/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Offboarding steps" }).getByRole("link")).toHaveCount(4);
  });

  test("step 3 closes the account; completion is refused until it does", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
    await gotoStep(page, /Accounts & M365/);

    await page.getByLabel(/Microsoft 365 account status/).selectOption("inactive");
    await page.getByRole("button", { name: /Save account status/ }).click();
    await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();
  });

  test("step 4 totals the outcomes and completing flips the person to OFFBOARDED", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
    await gotoStep(page, /Farewell report/);

    // returned ₱5,500 + defective ₱48,000 back in the fleet; ₱18,000 lost.
    await expect(page.getByText("₱53,500")).toBeVisible();
    // the phone cost repeats in the table below — the Stat tile is the first
    await expect(page.getByText("₱18,000").first()).toBeVisible();

    await page.getByRole("button", { name: "Complete offboarding" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText("Dennis Ong is now OFFBOARDED")).toBeVisible();

    // The queue is empty and the wizard still reads as the record of what happened.
    await page.goto("/offboarding");
    await expect(page.getByText("Nobody is offboarding")).toBeVisible();
  });

  test("the printable farewell report names every outcome and the value recovered", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Dennis");
    await page.getByRole("link", { name: /Dennis Ong/ }).click();
    const url = page.url();
    await page.goto(`/offboarding/${url.split("/").pop()}/report`);

    await expect(page.getByText("Offboarding farewell report")).toBeVisible();
    await expect(page.getByText("EMP-0090")).toBeVisible();
    for (const tag of ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"]) {
      await expect(page.getByText(tag)).toBeVisible();
    }
    await expect(page.getByText("never handed back — investigation open")).toBeVisible();
  });

  test("a MISSING return now executes to MISSING instead of failing (the Task 1 payoff)", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/approvals");
    const row = page.getByRole("row", { name: /BR-PH-0312/ });
    // The queue's change cell must name the real target, not a hard-coded SPARE.
    await expect(row).toContainText("→ MISSING");
    await row.getByRole("link").first().click();

    // "What the system checked" must pass on a Missing return, not cross it.
    await expect(page.getByText("returns as MISSING")).toBeVisible();
    await page.getByRole("button", { name: "Claim" }).click();
    await page.getByRole("button", { name: "Approve" }).click();

    execSync("npm run worker:once", { timeout: 60_000, stdio: "inherit" });

    await page.goto("/inventory?q=BR-PH-0312");
    // the scanner contract redirects an exact tag match to the record
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 15_000 });
    await expect(page.getByText("MISSING").first()).toBeVisible();
    await expect(page.getByText("Dennis Ong")).toHaveCount(0);
  });
});

test.describe("offboarding — the server gate does not trust the wizard", () => {
  test("a return filed BEFORE the offboarding began blocks the item and refuses completion", async ({ page }) => {
    // The regression: that approval owns the asset's one open slot but decides
    // nothing in this window, so the wizard must show the item as blocked (not
    // decided, not silently skipped) and completion must refuse. An earlier
    // version counted it as decided server-side and let the offboarding finish
    // with the item still assigned to the departed employee.
    await login(page, "it@thebackroomop.com");

    // file a routine return on a held item while the employee is still ACTIVE-ish,
    // by using the employee record's − affordance BEFORE touching the wizard
    await page.goto("/employees?q=Marites");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    await page.getByRole("button", { name: /laptop slot/ }).click();
    await page.getByLabel(/Reason/).fill("routine swap, pre-offboarding");
    await page.getByRole("button", { name: "Request return" }).click();
    await expect(page.getByText(/APR-\d+ created/)).toBeVisible();

    // now mark her offboarding — the anchor lands AFTER that approval
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel(/Employment/).selectOption("OFFBOARDING");
    await page.getByRole("button", { name: /Save/ }).click();

    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Marites Bautista/ }).getByRole("link", { name: "Open wizard" }).click();
    await gotoStep(page, /Collect items/);

    // the item names its blocker instead of offering a control or claiming a decision
    await expect(page.getByText(/is held by APR-\d+/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue to Accounts/ })).toBeDisabled();
  });
});

test.describe("repairs — a saved view, not an enum", () => {
  test("the named URL adds Stage and Down; chips move between stages, including the one outside DEFECTIVE", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await page.getByRole("link", { name: "Repairs" }).click();
    await expect(page).toHaveURL(/status=DEFECTIVE&sort=defectiveSince/);

    await expect(page.getByRole("columnheader", { name: /Down/ })).toBeVisible();
    const worst = page.getByRole("row", { name: /BR-LT-0090/ });
    await expect(worst).toContainText("BEYOND REPAIR");
    await expect(worst).toContainText("44 d");

    await page.getByRole("link", { name: "AT VENDOR" }).click();
    await expect(page).toHaveURL(/stage=at-vendor/);
    for (const tag of ["BR-LT-0118", "BR-MN-0731", "BR-DK-0033"]) {
      await expect(page.getByRole("row", { name: new RegExp(tag) })).toBeVisible();
    }
    await expect(page.getByRole("row", { name: /BR-LT-0090/ })).toHaveCount(0);

    // RETURNED OK deliberately leaves status=DEFECTIVE behind.
    await page.getByRole("link", { name: "RETURNED OK" }).click();
    await expect(page).toHaveURL(/stage=returned-ok/);
    const returned = page.getByRole("row", { name: /BR-MN-0911/ });
    await expect(returned).toContainText("SPARE");
    await expect(returned).toContainText("RETURNED OK");
  });

  test("the record warns when the quote is most of a new unit", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-LT-0090");
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 15_000 });
    await expect(page.getByText("Repairing costs too much of a new unit")).toBeVisible();
    await expect(page.getByText(/62% of the ₱55,000/)).toBeVisible();
    await expect(page.getByText(/60% write-off line/)).toBeVisible();
  });
});

test.describe("reservations", () => {
  test("a hold never changes the asset's status, and closed holds stay distinguishable", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/reservations");
    await expectNoSeriousAxe(page);

    const active = page.getByRole("row", { name: /BR-MN-0910/ });
    await expect(active).toContainText("Nina Robles");
    await expect(active).toContainText("SPARE"); // the point: the hold moved nothing

    await page.getByRole("link", { name: /Closed/ }).click();
    await expect(page).toHaveURL(/state=CLOSED/);
    await expect(page.getByText(/expired/)).toBeVisible();
    await expect(page.getByText(/released/)).toBeVisible();

    // ...and the inventory list marks the held spare without restating its status
    await page.goto("/inventory?status=SPARE");
    const row = page.getByRole("row", { name: /BR-MN-0910/ });
    await expect(row).toContainText("HOLD");
    await expect(row).toContainText("for Nina Robles");
    await expect(row).toContainText("SPARE");
  });
});

test.describe("equipment policies", () => {
  test("chips show required vs optional, a slot can be added, and the audit records both lists", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/admin/equipment-policies");
    await expectNoSeriousAxe(page);

    await expect(page.getByRole("heading", { name: "Finance standard" })).toBeVisible();
    await expect(page.getByText("department: Finance")).toBeVisible();
    await expect(page.getByRole("button", { name: /second monitor · .* · optional/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^laptop · .* · required/ })).toBeVisible();

    await page.getByLabel(/New slot name for Finance standard/).fill("webcam");
    await page.getByRole("button", { name: "Add slot" }).click();
    await expect(page.getByText(/Slot added/)).toBeVisible();
    await expect(page.getByRole("button", { name: /webcam · .* · required/ })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByRole("row", { name: /equipment-policy/ }).first()).toBeVisible();
  });

  test("viewer sees the policies read-only — no chips to click, no add row", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/admin/equipment-policies");
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add slot" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Actions for Finance standard/ })).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Confirm the Task 3 and Task 11 fixture edits landed in the specs**

Task 3 Step 3 already moved `e2e/home-finance.spec.ts` to `Fleet of 25 assets by status` and
`<1y: 3, 1–2y: 14, 2–3y: 1, 3–4y: 3, 4y+: 4`. Verify both are in place (`git log -p -- e2e/home-finance.spec.ts`),
and check that nothing else pinned a count Task 11's seed edits touched — `BR-LT-0090`'s quote moved
from ₱18,400 to ₱34,000 and `BR-MN-0911` gained a `defectiveSince`, neither of which is referenced by
any pre-Phase-7 spec. The coverage line ("spare pool covers 4 of the 10 slots…") must still read
exactly as before; if it changed, something consumed a spare — fix that, not the assertion.

- [ ] **Step 4: Run the whole battery**

Restart the preview first (a long-lived dev server degrades the suite into phantom failures), then:

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

```bash
npm run db:seed && npx playwright test --workers=1
```

Expected: unit tests green (Phase 6 ended at 284; Tasks 1, 2, 4 and 11 add roughly 30 more), build
clean, and every e2e spec passing. **Fix causes, not assertions** — the one class of assertion that may
legitimately change is a count Task 3 moved, and Step 3 already handled those.

- [ ] **Step 5: Commit**

```bash
git add e2e "src/app/(app)/[...pending]/page.tsx"
git commit -m "test(offboarding): the wizard, repairs, reservations and policies end to end"
```

- [ ] **Step 6: Update the handover for Phase 8**

Rewrite `docs/HANDOVER.md` so a fresh session can start Phase 8 cold. Keep the structure and edit in
place — sections 1, 2, 3 and 7 stay largely as they are. Specifically:

1. **Header** — "main @ phase-7 merge · Phases 1–7 merged, 8 remains", today's date, and the real
   battery numbers from Step 4.
2. **§0 Start here** — point at Phase 8's plan-writing (`/admin/users`, `/admin/webhooks` +
   `/deliveries` with dead-letter replay, `/admin/flags`, the 3-step import, the Excel export upgrade
   + split-by-year chips, the printable label sheet, USB-scanner polish, the deployment README, the
   full axe pass, and the Entra decision), re-reading README cards `3h`, `5a`, `1m`, `7g`.
3. **§4 What's DONE** — add a Phase 7 paragraph: the wizard as a producer of approvals (four outcomes,
   Missing first-class, reason required, Continue blocked, `?step=`), `lifecycle.return` widened plus
   the summary and system-check fixes that rode with it, the repairs saved view (derived stages, the
   Down clock, the 60% write-off warning), `/reservations` with the hold marker, and
   `/admin/equipment-policies` auditing both slot lists.
4. **§4 conventions table** — add: *derived state beats stored state* (`decisionOf` reads the
   approvals; there is no wizard table) and *a facet that can't be expressed in SQL narrows to a
   candidate set and is cut in memory by the same pure function that renders it* (`repairStage`).
5. **§5 What REMAINS** — Phase 7 out, Phase 8 only.
6. **§6** — replace the Phase 7 entry criteria with **Phase 8 entry criteria**, including: the worker
   currently dead-letters `DELIVER_WEBHOOK` with "ships in Phase 8"; `WebhookEndpoint.secret` is
   unencrypted; the permanent admin must read as a `LOCKED` row rather than a failed save; import is a
   dry run that writes nothing, partial import is the default, blocked rows group by cause; export
   refuses at 10,000 rows rather than truncating; `/admin` has no Home of its own.
7. **§8 Deferred** — add Phase 7's leftovers: a 3-character reason minimum accepts invisible
   characters (`trim()` strips Unicode Zs but not U+200B/U+2060), so a MISSING item can be justified
   with a blank-looking string — shared by `decideItem`, `requestReturn` and `rejectApproval`, so the
   fix is one zod refinement wherever the shared helpers live, not a per-action patch; four separate
   copies of "read a string field off a
   `Prisma.JsonValue`" now exist (`obj`/`str` in `src/lib/approval-execution.ts`,
   `returnTargetStatus` and `payloadReason` in the offboarding modules, and the `target` hoist in
   `src/server/modules/approvals/queries.ts`) — they agree today, and one exported pair would make it
   one truth; `/offboarding` and `/reservations` have no pagination,
   sortable headers or facets (team-scale lists, unbounded); a scan does not yet tick the matching
   wizard row (Phase 8's scanner polish); the farewell report is printable but neither emailable nor
   an Excel export (the brief's `farewell-report` export route is Phase 8); `RETURNED OK` shows `—` in
   the Down column because nothing records when a repair ended; `/reservations` is read-only, so holds
   are still created and released on the asset record; the repairs stage facet pages in memory, which
   is correct for a team-scale defective set and would need a generated column at fleet scale.
8. **§7 gotchas** — add: *a Prisma filter cannot compare two columns*, so a derived facet either
   changes shape or moves in-memory; and *widening one end of a pipeline means auditing the readers* —
   teaching `lifecycle.return` four outcomes also required fixing `summarizeApproval` and the
   "Return target" system check, both of which had SPARE hard-coded.

```bash
git add docs/HANDOVER.md
git commit -m "docs: handover advanced — phase 7 done, phase 8 entry criteria"
```

- [ ] **Step 7: Finish the branch**

Use `superpowers:finishing-a-development-branch`: merge `phase-7-offboarding` into `main`, delete the
branch, push. Confirm `main` is green on the same battery afterwards.
