# Phase 32 — Laws of UX on the IT screens where the work gets done — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring offboarding (queue, wizard, farewell report), the worklist, IT Home, the scan card and the reservations hand-over into line with the house UX standard set by Phases 29–30: the next step is the loudest thing, unfinished business is ordered worst first, work is done where it is listed, gates show before they refuse, and the ending is worth the task.

**Architecture:** Pure rules first (`src/lib/offboarding.ts`, `src/lib/offboarding-list.ts`, `src/lib/worklist.ts`, `src/lib/home.ts`), unit-tested; then the server (one shared offboarding snapshot, the attention pass, `decideRemaining`, `undismissShiftRow`, the badge count); then each screen renders what the rules return, reusing Phase 30's shared record controls, the portal `Menu` and controlled dialogs. No migration.

**Tech Stack:** Next.js 15 App Router (server components + client islands), Prisma 6 / Postgres 16, zod 4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-09-24-it-work-ux-design.md` (commit `7b878ed`). Read it before any task — it is the binding authority; this plan is its argument.

**Facts files** (verbatim current code, every e2e pin with file:line, seed fixtures) — the controller copies both into the SDD workspace's `briefs/`:
- `phase-32-plan-facts-offboarding.md` — offboarding lib/list/queries/actions/pages/components, reused UI components, every offboarding e2e pin.
- `phase-32-plan-facts-work-scan-holds.md` — worklist/home/nav/badge, the Phase 30 shared controls, scan page, reservations, every worklist/Home/scan/holds e2e pin, seed fixtures.

## Global Constraints

- Guard order **role → rate → zod** in every server action; refusals through `ActionResult` (`ok`, `forbidden`, `rateLimited`, `validationError`, `conflict` from `@/server/action-result`); one `writeAudit` per domain write inside its transaction; `AuditEntry` is append-only — tests never delete audit rows.
- **No migration.** No new tables, columns or preferences. Hide/undo lives in the existing `UserPreference` key `home:dismissed` (`{ date, keys }`).
- Copy is pinned in spec §9 — use it verbatim. Subject first, no phase numbers, no roadmap talk; dates through `fmtDate` (Asia/Manila), including toasts.
- Headers: one primary (`variant="primary"`), visible secondaries only where the spec says, then `IconButton` ⋯ `aria-label="More actions"` opening `Menu` (`@/components/ui/menu`). Navigation items call `router.push`; route-handler targets (exports) call `window.location.assign`.
- Row menus are named `Actions for {tag}` (asset rows) or `Actions for {name}` (person rows). The menu's cell and every in-row link stop propagation so the row's own click is untouched.
- Dialogs name the device and the person in the title and confirm with a verb — never a bare "Confirm".
- No interactive element inside another; every icon button named; product `aria-label`s never contain a nearby field's label word.
- Friendly status words (`STATUS_LABEL` in `src/lib/asset-class.ts`) wherever an operator reads a status; enums stay only as mono labels where the house already prints them.
- Role discipline unchanged: viewers see no action controls and every verb reads `Open` / `View`; Finance and Purchasing see IT records read-only; the server guards stay the real ones.
- Dev only in the worktree `.claude/worktrees/phase-32-it-work-uiux` (its own `.env`: `inventory_dev`, `APP_BASE_URL=http://192.168.203.56:3100`, no `SEED_PASSWORD`). Never read or print `.env`. Never touch the `inventory` database or port 3000. Never seed staging.
- One agent at a time runs Playwright or a dev server on port 3100; the port is free before and after (`netstat -ano | findstr :3100 | findstr LISTENING`, then `taskkill /PID <pid> /T /F`). Playwright runs in the foreground: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`.
- Agents never type passwords into the Browser pane; screens are verified with focused Playwright runs and unit tests.
- Git: never amend (a mistyped message is fixed by a NEW commit); never `git stash`, `checkout`, `restore`, `reset` or `switch`; `git add` new files before a pathspec commit. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- e2e specs never import helpers from other spec files (copy them); every existing pin a task changes is adapted in that task, never deleted.

## Plan decisions (P-n)

- **P-1** Execution order is strictly T1 → T14, one implementer at a time.
- **P-2** The offboarding queue's default sort becomes `[{ key: "attention", dir: "desc" }]` (desc = worst first). `attention` joins `OFFBOARDING_LIST_CONFIG.sortable` but has no header; a header click demotes it (`toggleSort`), and `buildOffboardingOrderBy` returns `null` (in-memory path) when Attention is primary and drops it when it is not (the Phase 31 `primarySortOf` rule).
- **P-3** The wizard header's primary is a **link** to the step `offboardingNext` names, labelled from it (`Complete` reads `Complete offboarding` in the header). When the operator is already on that step, the header shows no primary — the step's own panel carries the action (spec §4.2 "one loudest thing").
- **P-4** The success ending is signalled by `?done=1`: `CompleteButton` pushes `/offboarding/{id}?step=report&done=1` on success; an OFFBOARDED record with `done=1` renders the success card, without it the existing "already offboarded" banner (spec §4.4 "someone arriving later").
- **P-5** Clearing a live M365 status needs both the dialog and a server flag: `closeAccounts` gains `confirmClear?: boolean`; `next === null` over a live status is refused unless `confirmClear === true` (new copy, T7). An empty status stays a plain choice.
- **P-6** `decideItem`'s transaction body is extracted into a non-exported `decideOne(tx, user, input, now)` so `decideItem` and `decideRemaining` share it byte for byte (T3). `decideRemaining` runs one transaction per item, sequentially, under one `checkRate` event.
- **P-7** The worklist's in-place controls (spec §5.1) are: Triage rows → `Triage…` (`TriageDialog`); Awaiting IT check rows → `Mark checked` (`ItCheckDialog`); Loans rows → `Set loan date…` (`LoanDueDialog`, every loan row); "reads DEPLOYED with no holder" rows → `Assign…` (`AssignDialog`). Repairs (`Chase`), Missing (`Investigate`) keep links to the record; approvals read `Open`; new hires `Fill loadout` → `/employees/{id}#loadout`; leavers take label + href from `offboardingNext`.
- **P-8** A worklist capped section's "See all" target (spec §5.2): triage and check → `/inventory?sort=attention`; repairs → `/inventory?status=DEFECTIVE`; loans → `/inventory?status=TEMPORARY&sort=attention`; missing → `/inventory?status=MISSING`; hires → `/employees?gaps=1`; queue → `/approvals`. Home keeps its existing `See all {n}` link to `/inventory/work#{section}`.
- **P-9** The Worklist badge counts every section the worklist shows, minus today's hidden rows, uncapped: indexed `count` queries for triage, repairs, check, loans, missing (two), queue (breached, failed, leavers) plus the new-hires rows from the same helper `worklist()` uses (`hireWorkRows`). Shown for admin and it_staff only; computed in the app layout beside `getApprovalsBadge`.
- **P-10** "Claimed by you" renders only when `isApprover(user.role)` (`@/lib/approval-access`). Viewer Home runs `worklist(user.id, "viewer", { limit: 2 })` and renders it with `canAct={false}`.
- **P-11** "Jump to" is removed from the IT/admin/viewer Home branch only; the purchasing and finance branches keep it (spec §5.4 is IT's Home).
- **P-12** The Release dialog's fuller title (`Release the hold on {tag} · {model} for {name}?`) applies on `/reservations` only: `ReleaseHoldDialog` (new, controlled, extracted from `ReleaseHoldButton`) takes optional `model` and `holderName` and uses the fuller title when both are given; `ReleaseHoldButton`'s three other call sites pass neither and keep `Release the hold on {tag}?` (their pins in `holds.spec.ts` stay).
- **P-13** Friendly words: `EMPLOYMENT_LABEL` (new, `src/lib/labels.ts`: ACTIVE "Active", OFFBOARDING "Leaving", OFFBOARDED "Offboarded") and `decisionStateLabel(state)` (new, `src/lib/offboarding.ts`: PENDING and CLAIMED "awaiting approval", APPROVED "approved", EXECUTED "done", EXECUTION_FAILED "failed to execute", anything else the raw state lower-cased).
- **P-14** The scan card offers an action only when `recordPrimary` returns one of `triage`, `mark-checked`, `return`, `assign`; any other primary (`mark-corrected`, `confirm-details`) or `null` shows no action button.
- **P-15** The new e2e file `e2e/it-work-ux.spec.ts` joins battery chunk **E1** (46 → about 61).
- **P-16** The seed has no Triage row, no Awaiting-IT-check row and no EXECUTION_FAILED return: e2e cases create them at runtime with Prisma and restore mutable fields in `finally` (never deleting audit rows).

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/offboarding.ts` | `LeaverState`, `m365Live`, `offboardingNext`, `readiness`, `completionBlockers`, `offboardingAttention`, `orderByOffboardingAttention`, `defaultStep`, `decisionStateLabel`, step label "Finish" | T1 |
| `src/lib/offboarding-list.ts` | `attention` sort key, default sort, `buildOffboardingOrderBy` | T1 |
| `src/lib/labels.ts` | `EMPLOYMENT_LABEL` | T1 |
| `src/lib/worklist.ts` | `WorkControl`, `leaverRow` via `offboardingNext`, Manila-day `loanRow`, `groupWork` with hidden rows, `workActionLabel`, `capLine`, `SEE_ALL_HREF`, `summaryChips`, `pastSlaCount` | T2 |
| `src/lib/home.ts` | `withoutDismissal` | T2 |
| `src/server/modules/offboarding/queries.ts` | row `failed` + `attention`, `leaverStates`, attention pass in `listOffboarding`, `nextLeaver`, wizard `failed` list | T3 |
| `src/server/modules/offboarding/actions.ts` | `decideOne` extraction, `decideRemaining`, `closeAccounts` `confirmClear` | T3, T7 |
| `src/app/(app)/offboarding/page.tsx`, `src/components/offboarding/offboarding-more-menu.tsx` (new) | the queue | T4 |
| `src/app/(app)/offboarding/[employeeId]/page.tsx`, `wizard-steps.tsx`, `wizard-more-menu.tsx` (new) | wizard header, entry step, names, Review cell | T5 |
| `item-decision.tsx`, `scan-provider.tsx`, `mark-rest-dialog.tsx` (new), `mark-rest-button.tsx` (new) | Collect step | T6 |
| `accounts-panel.tsx`, `complete-button.tsx`, `readiness-checklist.tsx` (new), `offboarded-card.tsx` (new) | Accounts & Finish | T7 |
| `src/app/(app)/offboarding/[employeeId]/report/page.tsx` | farewell report | T8 |
| `src/server/modules/home/queries.ts`, `src/components/home/worklist.tsx`, `work-row-actions.tsx` (new) | worklist rows act in place | T9 |
| `src/server/modules/home/actions.ts`, `worklist.tsx`, `work-summary.tsx` (new), `dismiss-button.tsx` (deleted) | row menu, hide/undo, chips, caps | T10 |
| `src/lib/workspaces.ts`, `src/components/shell/{nav-list,sidebar,topbar,mobile-nav}.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx` | badge, Home | T11 |
| `src/app/(app)/inventory/scan/[tag]/page.tsx`, `src/components/inventory/scan-action.tsx` (new) | scan card | T12 |
| `src/components/reservations/holds-table.tsx`, `src/components/inventory/release-hold-button.tsx` | reservations hand-over | T13 |
| `e2e/it-work-ux.spec.ts` (new), docs | proof, battery, docs | T14 |

---

### Task 1: Pure rules — offboarding next step, readiness, attention, default step, list config

**Files:**
- Modify: `src/lib/offboarding.ts`, `src/lib/offboarding-list.ts`, `src/lib/labels.ts`
- Test: `src/lib/offboarding.test.ts`, `src/lib/offboarding-list.test.ts`

**Interfaces:**
- Consumes: `daysUntil`, `isPastDue` from `./deadlines`.
- Produces (every later task relies on these exact names):
  ```ts
  export interface FailedReturn { refNo: string; approvalId: string }
  export interface LeaverState {
    id: string; employment: string; dueAt: Date | null;
    undecided: number; failed: FailedReturn | null; m365Status: string | null;
  }
  export function m365Live(status: string | null): boolean
  export interface NextStep { step: StepId | null; label: string; href: string }
  export function offboardingNext(s: LeaverState): NextStep | null
  export interface ReadinessInput { id: string; total: number; undecided: number; failed: FailedReturn[]; m365Status: string | null }
  export interface ReadinessLine { kind: "equipment" | "requests" | "m365"; label: string; ok: boolean; href: string | null }
  export function readiness(d: ReadinessInput): ReadinessLine[]
  export function completionBlockers(d: ReadinessInput): ReadinessLine[]
  export type OffboardingAttentionKind = "failed" | "overdue" | "no-date" | "undecided" | "m365" | "ready";
  export interface OffboardingAttention { kind: OffboardingAttentionKind; label: string; severity: number }
  export function offboardingAttention(s: LeaverState, todayISO: string): OffboardingAttention | null
  export function orderByOffboardingAttention<T extends { attention: OffboardingAttention | null; name: string; id: string }>(rows: T[], dir: "asc" | "desc"): T[]
  export function defaultStep(s: { employment: string; undecided: number; m365Status: string | null }): StepId
  export function decisionStateLabel(state: string): string
  // src/lib/labels.ts
  export const EMPLOYMENT_LABEL: Record<EmploymentStatus, string>
  // src/lib/offboarding-list.ts — OFFBOARDING_LIST_CONFIG.sortable gains "attention"; defaultSort [{ key: "attention", dir: "desc" }]
  ```

- [ ] **Step 1: Write the failing tests** — append to `src/lib/offboarding.test.ts` (extend its import list with the new names):

```ts
import {
  completionBlockers, decisionStateLabel, defaultStep, m365Live, offboardingAttention, offboardingNext,
  orderByOffboardingAttention, readiness, type LeaverState,
} from "./offboarding";

const leaver = (over: Partial<LeaverState> = {}): LeaverState => ({
  id: "e1", employment: "OFFBOARDING", dueAt: new Date("2026-09-30T00:00:00+08:00"),
  undecided: 0, failed: null, m365Status: "inactive", ...over,
});

describe("m365Live — mirrors completeOffboarding's M365 gate", () => {
  it("null and any-case inactive are not live; everything else is", () => {
    expect(m365Live(null)).toBe(false);
    expect(m365Live("inactive")).toBe(false);
    expect(m365Live(" Inactive ")).toBe(false);
    expect(m365Live("active")).toBe(true);
    expect(m365Live("offboarding")).toBe(true);
    expect(m365Live("")).toBe(true);
  });
});

describe("offboardingNext — the one next step", () => {
  it("nothing once offboarded", () => {
    expect(offboardingNext(leaver({ employment: "OFFBOARDED" }))).toBeNull();
  });
  it("a failed return wins over everything", () => {
    expect(offboardingNext(leaver({ failed: { refNo: "APR-9", approvalId: "a9" }, dueAt: null, undecided: 2 })))
      .toEqual({ step: null, label: "Resolve APR-9", href: "/approvals/a9" });
  });
  it("no date comes next, pointing at the employee form", () => {
    expect(offboardingNext(leaver({ dueAt: null, undecided: 2 })))
      .toEqual({ step: null, label: "Set a date", href: "/employees/e1/edit" });
  });
  it("undecided items: Collect, singular and plural", () => {
    expect(offboardingNext(leaver({ undecided: 3 })))
      .toEqual({ step: "collect", label: "Collect 3 items", href: "/offboarding/e1?step=collect" });
    expect(offboardingNext(leaver({ undecided: 1 }))?.label).toBe("Collect 1 item");
  });
  it("a live account: Close account", () => {
    expect(offboardingNext(leaver({ m365Status: "active" })))
      .toEqual({ step: "accounts", label: "Close account", href: "/offboarding/e1?step=accounts" });
  });
  it("otherwise Complete, on the Finish step", () => {
    expect(offboardingNext(leaver()))
      .toEqual({ step: "report", label: "Complete", href: "/offboarding/e1?step=report" });
  });
});

describe("readiness / completionBlockers — the three server gates, shown first", () => {
  const input = { id: "e1", total: 5, undecided: 0, failed: [], m365Status: "inactive" };
  it("all clear: three ok lines, no blockers", () => {
    expect(readiness(input)).toEqual([
      { kind: "equipment", label: "Equipment · 5 of 5 decided", ok: true, href: null },
      { kind: "m365", label: "Microsoft 365 · inactive", ok: true, href: null },
    ]);
    expect(completionBlockers(input)).toEqual([]);
  });
  it("undecided items block and link Collect", () => {
    expect(completionBlockers({ ...input, undecided: 2 })).toEqual([
      { kind: "equipment", label: "Equipment · 3 of 5 decided", ok: false, href: "/offboarding/e1?step=collect" },
    ]);
  });
  it("each failed return is its own line linking the approval", () => {
    const failed = [{ refNo: "APR-1", approvalId: "a1" }, { refNo: "APR-2", approvalId: "a2" }];
    expect(completionBlockers({ ...input, failed }).map((l) => [l.label, l.href])).toEqual([
      ["Requests · APR-1 failed to execute", "/approvals/a1"],
      ["Requests · APR-2 failed to execute", "/approvals/a2"],
    ]);
  });
  it("no account at all is fine; a live one blocks and links Accounts", () => {
    expect(readiness({ ...input, m365Status: null })[1])
      .toEqual({ kind: "m365", label: "Microsoft 365 · never had an account", ok: true, href: null });
    expect(completionBlockers({ ...input, m365Status: "active" })).toEqual([
      { kind: "m365", label: "Microsoft 365 · active", ok: false, href: "/offboarding/e1?step=accounts" },
    ]);
  });
});

describe("offboardingAttention — worst reason first", () => {
  const today = "2026-09-24";
  it("each kind, in precedence", () => {
    expect(offboardingAttention(leaver({ failed: { refNo: "APR-1", approvalId: "a1" } }), today))
      .toEqual({ kind: "failed", label: "return failed · APR-1", severity: 6000 });
    expect(offboardingAttention(leaver({ dueAt: new Date("2026-09-21T00:00:00+08:00"), undecided: 2 }), today))
      .toEqual({ kind: "overdue", label: "overdue by 3 d", severity: 5003 });
    expect(offboardingAttention(leaver({ dueAt: null }), today))
      .toEqual({ kind: "no-date", label: "no completion date", severity: 4000 });
    expect(offboardingAttention(leaver({ undecided: 2 }), today))
      .toEqual({ kind: "undecided", label: "2 to decide", severity: 3002 });
    expect(offboardingAttention(leaver({ m365Status: "active" }), today))
      .toEqual({ kind: "m365", label: "account still active", severity: 2000 });
    expect(offboardingAttention(leaver(), today))
      .toEqual({ kind: "ready", label: "ready to complete", severity: 1000 });
  });
  it("due today is not overdue", () => {
    expect(offboardingAttention(leaver({ dueAt: new Date("2026-09-24T09:00:00+08:00") }), today)?.kind).toBe("ready");
  });
  it("nothing for someone already offboarded", () => {
    expect(offboardingAttention(leaver({ employment: "OFFBOARDED" }), today)).toBeNull();
  });
  it("orders desc worst first, ties by name then id, null last", () => {
    const at = (severity: number) => ({ kind: "ready" as const, label: "", severity });
    const rows = [
      { id: "3", name: "Cy", attention: at(1000) },
      { id: "1", name: "Ana", attention: null },
      { id: "2", name: "Ben", attention: at(6000) },
      { id: "5", name: "Ana", attention: at(1000) },
      { id: "4", name: "Ana", attention: at(1000) },
    ];
    expect(orderByOffboardingAttention(rows, "desc").map((r) => r.id)).toEqual(["2", "4", "5", "3", "1"]);
    expect(orderByOffboardingAttention(rows, "asc").map((r) => r.id)).toEqual(["4", "5", "3", "2", "1"]);
  });
});

describe("defaultStep — open where the work is", () => {
  it("review once offboarded; collect, accounts, report otherwise", () => {
    expect(defaultStep({ employment: "OFFBOARDED", undecided: 0, m365Status: null })).toBe("review");
    expect(defaultStep({ employment: "OFFBOARDING", undecided: 2, m365Status: "active" })).toBe("collect");
    expect(defaultStep({ employment: "OFFBOARDING", undecided: 0, m365Status: "active" })).toBe("accounts");
    expect(defaultStep({ employment: "OFFBOARDING", undecided: 0, m365Status: "inactive" })).toBe("report");
  });
});

describe("decisionStateLabel", () => {
  it("friendly words for the decision states", () => {
    expect(decisionStateLabel("PENDING")).toBe("awaiting approval");
    expect(decisionStateLabel("CLAIMED")).toBe("awaiting approval");
    expect(decisionStateLabel("APPROVED")).toBe("approved");
    expect(decisionStateLabel("EXECUTED")).toBe("done");
    expect(decisionStateLabel("EXECUTION_FAILED")).toBe("failed to execute");
    expect(decisionStateLabel("SOMETHING_NEW")).toBe("something new");
  });
});
```

In the existing `"the four steps"` describe, change any expectation of the last label `"Farewell report"` to `"Finish"` (the id stays `"report"`).

Append to `src/lib/offboarding-list.test.ts` and update the pinned config test:

```ts
describe("OFFBOARDING_LIST_CONFIG", () => {
  it("facets department, progress and due, sorts by name/started/undecided/due/attention, defaults to Attention worst first", () => {
    expect(OFFBOARDING_LIST_CONFIG.facets).toEqual(["department", "progress", "due"]);
    expect(OFFBOARDING_LIST_CONFIG.sortable).toEqual(["name", "started", "undecided", "due", "attention"]);
    expect(OFFBOARDING_LIST_CONFIG.defaultSort).toEqual([{ key: "attention", dir: "desc" }]);
  });
});

describe("buildOffboardingOrderBy — Attention only as the primary key (Phase 31 rule)", () => {
  it("null (in memory) when Attention is primary, including the default", () => {
    expect(buildOffboardingOrderBy([])).toBeNull();
    expect(buildOffboardingOrderBy([{ key: "attention", dir: "desc" }])).toBeNull();
  });
  it("a secondary Attention left by a header click is dropped", () => {
    expect(buildOffboardingOrderBy([{ key: "name", dir: "asc" }, { key: "attention", dir: "desc" }]))
      .toEqual([{ name: "asc" }, { employeeNo: "asc" }, { id: "asc" }]);
  });
  it("undecided still orders in memory", () => {
    expect(buildOffboardingOrderBy([{ key: "undecided", dir: "asc" }])).toBeNull();
  });
});
```

Any existing `buildOffboardingOrderBy` test that expects `[]` to yield the name order must now expect `null` — adapt it, do not delete it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/offboarding.test.ts src/lib/offboarding-list.test.ts`
Expected: FAIL — `offboardingNext is not a function` (and the other new names), the config test on `sortable`/`defaultSort`.

- [ ] **Step 3: Implement** — in `src/lib/offboarding.ts`, change the last step's label and add (after `canContinue`):

```ts
import { daysUntil, isPastDue } from "./deadlines";

// WIZARD_STEPS: { id: "report", label: "Finish" }  — the id stays "report" so every ?step=report link keeps working

export interface FailedReturn { refNo: string; approvalId: string }

/** One leaver as the queue, the wizard, the worklist and Home all read them (spec §3). */
export interface LeaverState {
  id: string;
  employment: string;
  dueAt: Date | null;
  undecided: number;
  /** the first held item whose return failed to execute */
  failed: FailedReturn | null;
  m365Status: string | null;
}

/** Exactly completeOffboarding's M365 gate: trimmed, case-folded, anything but null or "inactive" is live. */
export function m365Live(status: string | null): boolean {
  const s = status?.trim().toLowerCase() ?? null;
  return s !== null && s !== "inactive";
}

export interface NextStep { step: StepId | null; label: string; href: string }

/** The next step for one leaver, worst blocker first (spec §3). Null once offboarded. */
export function offboardingNext(s: LeaverState): NextStep | null {
  if (s.employment !== "OFFBOARDING") return null;
  if (s.failed) return { step: null, label: `Resolve ${s.failed.refNo}`, href: `/approvals/${s.failed.approvalId}` };
  if (s.dueAt === null) return { step: null, label: "Set a date", href: `/employees/${s.id}/edit` };
  if (s.undecided > 0) {
    return { step: "collect", label: `Collect ${s.undecided} item${s.undecided === 1 ? "" : "s"}`, href: `/offboarding/${s.id}?step=collect` };
  }
  if (m365Live(s.m365Status)) return { step: "accounts", label: "Close account", href: `/offboarding/${s.id}?step=accounts` };
  return { step: "report", label: "Complete", href: `/offboarding/${s.id}?step=report` };
}

export interface ReadinessInput { id: string; total: number; undecided: number; failed: FailedReturn[]; m365Status: string | null }
export interface ReadinessLine { kind: "equipment" | "requests" | "m365"; label: string; ok: boolean; href: string | null }

/** The Finish step's checklist: one line per server gate, in completeOffboarding's order. */
export function readiness(d: ReadinessInput): ReadinessLine[] {
  const lines: ReadinessLine[] = [{
    kind: "equipment",
    label: `Equipment · ${d.total - d.undecided} of ${d.total} decided`,
    ok: d.undecided === 0,
    href: d.undecided === 0 ? null : `/offboarding/${d.id}?step=collect`,
  }];
  for (const f of d.failed) {
    lines.push({ kind: "requests", label: `Requests · ${f.refNo} failed to execute`, ok: false, href: `/approvals/${f.approvalId}` });
  }
  const live = m365Live(d.m365Status);
  lines.push({
    kind: "m365",
    label: `Microsoft 365 · ${d.m365Status ?? "never had an account"}`,
    ok: !live,
    href: live ? `/offboarding/${d.id}?step=accounts` : null,
  });
  return lines;
}

/** Empty means Complete may be offered; the server gate stays the backstop. */
export function completionBlockers(d: ReadinessInput): ReadinessLine[] {
  return readiness(d).filter((l) => !l.ok);
}

export type OffboardingAttentionKind = "failed" | "overdue" | "no-date" | "undecided" | "m365" | "ready";
export interface OffboardingAttention { kind: OffboardingAttentionKind; label: string; severity: number }

/** The one worst reason a leaver needs attention (spec §3), the Phase 30 severity shape. */
export function offboardingAttention(s: LeaverState, todayISO: string): OffboardingAttention | null {
  if (s.employment !== "OFFBOARDING") return null;
  if (s.failed) return { kind: "failed", label: `return failed · ${s.failed.refNo}`, severity: 6000 };
  if (s.dueAt !== null && isPastDue(s.dueAt, todayISO)) {
    const days = -daysUntil(s.dueAt, todayISO);
    return { kind: "overdue", label: `overdue by ${days} d`, severity: 5000 + days };
  }
  if (s.dueAt === null) return { kind: "no-date", label: "no completion date", severity: 4000 };
  if (s.undecided > 0) return { kind: "undecided", label: `${s.undecided} to decide`, severity: 3000 + s.undecided };
  if (m365Live(s.m365Status)) return { kind: "m365", label: `account still ${s.m365Status}`, severity: 2000 };
  return { kind: "ready", label: "ready to complete", severity: 1000 };
}

/** desc = worst first. Ties by name then id; rows without a reason last either way. */
export function orderByOffboardingAttention<T extends { attention: OffboardingAttention | null; name: string; id: string }>(
  rows: T[], dir: "asc" | "desc",
): T[] {
  const sign = dir === "desc" ? -1 : 1;
  const tie = (x: T, y: T) => x.name.localeCompare(y.name) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return [...rows].sort((x, y) => {
    if (!x.attention || !y.attention) {
      if (!x.attention && !y.attention) return tie(x, y);
      return x.attention ? -1 : 1;
    }
    return sign * (x.attention.severity - y.attention.severity) || tie(x, y);
  });
}

/** Without ?step=, open where the work is (spec §3). */
export function defaultStep(s: { employment: string; undecided: number; m365Status: string | null }): StepId {
  if (s.employment !== "OFFBOARDING") return "review";
  if (s.undecided > 0) return "collect";
  if (m365Live(s.m365Status)) return "accounts";
  return "report";
}

const DECISION_STATE_WORD: Record<string, string> = {
  PENDING: "awaiting approval", CLAIMED: "awaiting approval", APPROVED: "approved",
  EXECUTED: "done", EXECUTION_FAILED: "failed to execute",
};
export function decisionStateLabel(state: string): string {
  return DECISION_STATE_WORD[state] ?? state.toLowerCase().replaceAll("_", " ");
}
```

In `src/lib/labels.ts` (add `EmploymentStatus` to the `@prisma/client` type import):

```ts
/** Friendly employment words (Phase 32); the enum stays only as a mono label where the house prints it. */
export const EMPLOYMENT_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: "Active", OFFBOARDING: "Leaving", OFFBOARDED: "Offboarded",
};
```

In `src/lib/offboarding-list.ts`:

```ts
export const OFFBOARDING_LIST_CONFIG: ListConfig = {
  facets: ["department", "progress", "due"],
  sortable: ["name", "started", "undecided", "due", "attention"],
  defaultSort: [{ key: "attention", dir: "desc" }],
};

/**
 * `null` = order in memory: Attention as the PRIMARY key (the default, spec §4.1) or any
 * `undecided` key (plan P-5 of Phase 20). A secondary Attention left behind by a header click is
 * dropped, so the clicked column really orders the rows (the Phase 31 rule).
 */
export function buildOffboardingOrderBy(sort: SortKey[]): Prisma.EmployeeOrderByWithRelationInput[] | null {
  const order = sort.length ? sort : OFFBOARDING_LIST_CONFIG.defaultSort;
  if (order[0]?.key === "attention" || order.some((s) => s.key === "undecided")) return null;
  const kept = order.filter((s) => s.key !== "attention");
  return [
    ...kept.map(({ key, dir }): Prisma.EmployeeOrderByWithRelationInput => {
      if (key === "started") return { offboardingAt: dir };
      if (key === "due") return { offboardingDueAt: { sort: dir, nulls: "last" } };
      return { [key]: dir };
    }),
    { employeeNo: "asc" },
    { id: "asc" },
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/offboarding.test.ts src/lib/offboarding-list.test.ts` → PASS. Then `npx tsc --noEmit` → clean (the queue page still compiles: `listOffboarding` keeps working because its in-memory branch already handles `orderBy === null`; it sorts by undecided there until T3 — acceptable between tasks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offboarding.ts src/lib/offboarding.test.ts src/lib/offboarding-list.ts src/lib/offboarding-list.test.ts src/lib/labels.ts
git commit -m "feat(offboarding): pure rules for the next step, readiness, attention and the entry step (Phase 32 T1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure rules — worklist rows, labels, hidden rows, caps, chips; undismissal

**Files:**
- Modify: `src/lib/worklist.ts`, `src/lib/home.ts`
- Test: `src/lib/worklist.test.ts`, `src/lib/home.test.ts` (create the `withoutDismissal` describe; if `home.test.ts` does not exist, create it)

**Interfaces:**
- Consumes (T1): `LeaverState`, `offboardingNext` from `./offboarding`; `daysUntil`, `dueStatus` from `./deadlines`; `fmtDate`, `localDateISO` from `./format`.
- Produces:
  ```ts
  export type WorkControl =
    | { kind: "triage"; asset: { id: string; tag: string; model: string } }
    | { kind: "it-check"; asset: { id: string; tag: string } }
    | { kind: "loan-due"; asset: { id: string; tag: string }; loanDueAt: Date | null }
    | { kind: "assign"; asset: { id: string; tag: string; model: string } };
  // WorkRow gains: control?: WorkControl; entity?: { kind: "asset" | "employee"; id: string; label: string }
  export interface WorkGroup { section: WorkSection; rows: WorkRow[]; total: number; capped: boolean; hidden: WorkRow[] }
  export interface LeaverLike extends LeaverState { name: string; employeeNo: string; itemsOut: number }
  export function leaverRow(e: LeaverLike, todayISO: string): WorkRow
  export function loanRow(a: LoanLike, now: Date): WorkRow | null   // Manila-day words; control "loan-due"
  export function workActionLabel(row: WorkRow, canAct: boolean): string
  export const SEE_ALL_HREF: Record<WorkSectionId, string>
  export function capLine(g: WorkGroup): string | null
  export function summaryChips(groups: WorkGroup[]): { id: WorkSectionId; label: string; href: string }[]
  export function pastSlaCount(groups: WorkGroup[]): number
  // src/lib/home.ts
  export function withoutDismissal(value: unknown, today: string, key: string): DismissPref
  ```

- [ ] **Step 1: Write the failing tests.** In `src/lib/worklist.test.ts`, update the existing `loanRow` and `leaverRow` describes to the new shapes and add the new describes:

```ts
import {
  capLine, groupWork, leaverRow, loanRow, pastSlaCount, SEE_ALL_HREF, summaryChips, workActionLabel,
  WORK_SECTIONS, type LeaverLike, type WorkRow,
} from "./worklist";

const NOW = new Date("2026-09-24T10:00:00+08:00");
const TODAY = "2026-09-24";

describe("loanRow — Manila-day words, a Set loan date… control on every loan row", () => {
  const base = { id: "a1", tag: "BR-LT-0210", model: "ThinkPad", holder: "Leo Tan" };
  it("no due date sits on top and asks for one", () => {
    const r = loanRow({ ...base, loanDueAt: null }, NOW)!;
    expect(r.title).toBe("BR-LT-0210 on loan with no due date");
    expect(r.meta).toBe("Leo Tan · set a due date");
    expect(r.control).toEqual({ kind: "loan-due", asset: { id: "a1", tag: "BR-LT-0210" }, loanDueAt: null });
    expect(r.severity).toBe(1000);
  });
  it("overdue by N days on the Manila calendar, date in the house form", () => {
    const r = loanRow({ ...base, loanDueAt: new Date("2026-09-23T00:00:00+08:00") }, NOW)!;
    expect(r.title).toBe("BR-LT-0210 overdue by 1 d");
    expect(r.meta).toBe(`Leo Tan · due ${fmtDate(new Date("2026-09-23T00:00:00+08:00"))}`);
    expect(r.severity).toBe(501);
  });
  it("due today, tomorrow and within the week", () => {
    expect(loanRow({ ...base, loanDueAt: new Date("2026-09-24T18:00:00+08:00") }, NOW)!.title).toBe("BR-LT-0210 due today");
    expect(loanRow({ ...base, loanDueAt: new Date("2026-09-25T00:00:00+08:00") }, NOW)!.title).toBe("BR-LT-0210 due tomorrow");
    expect(loanRow({ ...base, loanDueAt: new Date("2026-09-28T00:00:00+08:00") }, NOW)!.title).toBe("BR-LT-0210 due in 4 d");
  });
  it("due later is not on the list", () => {
    expect(loanRow({ ...base, loanDueAt: new Date("2026-10-10T00:00:00+08:00") }, NOW)).toBeNull();
  });
});

describe("leaverRow — label and href from offboardingNext", () => {
  const e = (over: Partial<LeaverLike> = {}): LeaverLike => ({
    id: "e1", name: "Dennis Ong", employeeNo: "EMP-0090", itemsOut: 3,
    employment: "OFFBOARDING", dueAt: new Date("2026-09-22T00:00:00+08:00"),
    undecided: 3, failed: null, m365Status: "offboarding", ...over,
  });
  it("undecided items: Collect N items into the Collect step", () => {
    const r = leaverRow(e(), TODAY);
    expect(r.title).toBe("Dennis Ong is leaving");
    expect(r.meta).toBe("EMP-0090 · 3 items still out · 2 d overdue");
    expect(r.action).toBe("Collect 3 items");
    expect(r.href).toBe("/offboarding/e1?step=collect");
    expect(r.key).toBe("queue:e1");
  });
  it("no date asks for one", () => {
    const r = leaverRow(e({ dueAt: null }), TODAY);
    expect(r.title).toBe("Dennis Ong is leaving — no completion date");
    expect(r.action).toBe("Set a date");
    expect(r.href).toBe("/employees/e1/edit");
    expect(r.severity).toBe(1000);
  });
  it("equipment returned reads as closing the account", () => {
    const r = leaverRow(e({ itemsOut: 0, undecided: 0 }), TODAY);
    expect(r.meta).toBe("EMP-0090 · equipment returned · accounts still to close · 2 d overdue");
    expect(r.action).toBe("Close account");
    expect(r.href).toBe("/offboarding/e1?step=accounts");
  });
});

describe("workActionLabel", () => {
  const row = (over: Partial<WorkRow>): WorkRow =>
    ({ key: "k", section: "triage", title: "", meta: "", href: "/x", action: "Chase", severity: 0, ...over });
  it("controls read their verb; links keep their action; viewers read Open", () => {
    expect(workActionLabel(row({ control: { kind: "triage", asset: { id: "a", tag: "T", model: "M" } } }), true)).toBe("Triage…");
    expect(workActionLabel(row({ control: { kind: "it-check", asset: { id: "a", tag: "T" } } }), true)).toBe("Mark checked");
    expect(workActionLabel(row({ control: { kind: "loan-due", asset: { id: "a", tag: "T" }, loanDueAt: null } }), true)).toBe("Set loan date…");
    expect(workActionLabel(row({ control: { kind: "assign", asset: { id: "a", tag: "T", model: "M" } } }), true)).toBe("Assign…");
    expect(workActionLabel(row({}), true)).toBe("Chase");
    expect(workActionLabel(row({ control: { kind: "it-check", asset: { id: "a", tag: "T" } } }), false)).toBe("Open");
  });
});

describe("groupWork — hidden rows are kept, not dropped", () => {
  const r = (key: string, section: WorkRow["section"], severity = 0): WorkRow =>
    ({ key, section, title: key, meta: "", href: "/", action: "Open", severity });
  it("partitions today's hidden rows per section and keeps a section with only hidden rows", () => {
    const groups = groupWork([r("triage:1", "triage"), r("triage:2", "triage"), r("loans:3", "loans")], new Set(["triage:2", "loans:3"]), {});
    expect(groups.map((g) => [g.section.id, g.rows.map((x) => x.key), g.hidden.map((x) => x.key), g.total])).toEqual([
      ["triage", ["triage:1"], ["triage:2"], 1],
      ["loans", [], ["loans:3"], 0],
    ]);
  });
});

describe("capLine / SEE_ALL_HREF / summaryChips / pastSlaCount", () => {
  const section = WORK_SECTIONS.find((s) => s.id === "repairs")!;
  it("a capped section says how many of how many", () => {
    expect(capLine({ section, rows: new Array(50).fill(null) as WorkRow[], total: 50, capped: true, hidden: [] }))
      .toBe("Showing 50 of 50+ · See all");
    expect(capLine({ section, rows: [], total: 0, capped: false, hidden: [] })).toBeNull();
  });
  it("every section has a list that holds the rest", () => {
    expect(SEE_ALL_HREF).toEqual({
      triage: "/inventory?sort=attention", check: "/inventory?sort=attention",
      repairs: "/inventory?status=DEFECTIVE", loans: "/inventory?status=TEMPORARY&sort=attention",
      missing: "/inventory?status=MISSING", hires: "/employees?gaps=1", queue: "/approvals",
    });
  });
  it("chips count each non-empty section; past SLA counts rank-0 queue rows", () => {
    const rows: WorkRow[] = [
      { key: "queue:a", section: "queue", title: "", meta: "", href: "/", action: "Open", severity: 3, rank: 0 },
      { key: "queue:b", section: "queue", title: "", meta: "", href: "/", action: "Open", severity: 1, rank: 1 },
      { key: "loans:c", section: "loans", title: "", meta: "", href: "/", action: "Open", severity: 1 },
    ];
    const groups = groupWork(rows, new Set(), {});
    expect(summaryChips(groups)).toEqual([
      { id: "loans", label: "Loans 1", href: "#loans" },
      { id: "queue", label: "Approvals & leavers 2", href: "#queue" },
    ]);
    expect(pastSlaCount(groups)).toBe(1);
  });
});
```

(`fmtDate` is imported from `./format` at the top of the test file.)

In `src/lib/home.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withDismissal, withoutDismissal } from "./home";

describe("withoutDismissal — Undo", () => {
  it("removes one key from today's set and leaves the others", () => {
    const pref = withDismissal(withDismissal(null, "2026-09-24", "triage:1"), "2026-09-24", "loans:2");
    expect(withoutDismissal(pref, "2026-09-24", "triage:1")).toEqual({ date: "2026-09-24", keys: ["loans:2"] });
  });
  it("a stale or empty value yields an empty set for today", () => {
    expect(withoutDismissal({ date: "2026-09-23", keys: ["triage:1"] }, "2026-09-24", "triage:1")).toEqual({ date: "2026-09-24", keys: [] });
    expect(withoutDismissal(null, "2026-09-24", "x:1")).toEqual({ date: "2026-09-24", keys: [] });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/worklist.test.ts src/lib/home.test.ts` → FAIL (missing exports, changed shapes).

- [ ] **Step 3: Implement** in `src/lib/worklist.ts`:

```ts
import { daysUntil, dueStatus } from "./deadlines";
import { fmtDate, localDateISO } from "./format";
import { offboardingNext, type LeaverState } from "./offboarding";

export type WorkControl =
  | { kind: "triage"; asset: { id: string; tag: string; model: string } }
  | { kind: "it-check"; asset: { id: string; tag: string } }
  | { kind: "loan-due"; asset: { id: string; tag: string }; loanDueAt: Date | null }
  | { kind: "assign"; asset: { id: string; tag: string; model: string } };

// WorkRow gains two optional fields:
//   /** a shared record control that clears the row in place (spec §5.1); absent = the action is a link */
//   control?: WorkControl;
//   /** what the row menu's Open record / Open profile opens */
//   entity?: { kind: "asset" | "employee"; id: string; label: string };

export interface WorkGroup { section: WorkSection; rows: WorkRow[]; total: number; capped: boolean; hidden: WorkRow[] }

export function loanRow(a: LoanLike, now: Date): WorkRow | null {
  const base = {
    key: `loans:${a.id}`, section: "loans" as const, href: `/inventory/${a.id}`, action: "Set loan date…",
    control: { kind: "loan-due" as const, asset: { id: a.id, tag: a.tag }, loanDueAt: a.loanDueAt },
    entity: { kind: "asset" as const, id: a.id, label: a.tag },
  };
  const holder = a.holder ?? "unassigned";
  if (a.loanDueAt === null) {
    return { ...base, title: `${a.tag} on loan with no due date`, meta: `${holder} · set a due date`, severity: 1000 };
  }
  const days = daysUntil(a.loanDueAt, localDateISO(now));
  const meta = `${holder} · due ${fmtDate(a.loanDueAt)}`;
  if (days < 0) return { ...base, title: `${a.tag} overdue by ${-days} d`, meta, severity: 500 - days };
  if (days > LOAN_DUE_SOON_DAYS) return null;
  const when = days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} d`;
  return { ...base, title: `${a.tag} ${when}`, meta, severity: LOAN_DUE_SOON_DAYS - days };
}

export interface LeaverLike extends LeaverState { name: string; employeeNo: string; itemsOut: number }

/** Spec §3: the leaver row's label and href come from offboardingNext. Key stays `queue:<id>` so existing dismissals hold. */
export function leaverRow(e: LeaverLike, todayISO: string): WorkRow {
  const next = offboardingNext(e);
  const base = {
    key: `queue:${e.id}`, section: "queue" as const, rank: 2,
    href: next?.href ?? `/offboarding/${e.id}`, action: next?.label ?? "Open",
    entity: { kind: "employee" as const, id: e.id, label: e.name },
  };
  const kit = e.itemsOut > 0
    ? `${e.employeeNo} · ${e.itemsOut} item${e.itemsOut === 1 ? "" : "s"} still out`
    : `${e.employeeNo} · equipment returned · accounts still to close`;
  if (e.dueAt === null) {
    return { ...base, title: `${e.name} is leaving — no completion date`, meta: `${kit} · set a completion date`, severity: 1000 };
  }
  const due = dueStatus(e.dueAt, todayISO);
  const severity = due.overdue ? 500 - due.days : due.days === 0 ? 2 : due.days === 1 ? 1 : 0;
  return { ...base, title: `${e.name} is leaving`, meta: `${kit} · ${due.text}`, severity };
}

const CONTROL_LABEL: Record<WorkControl["kind"], string> = {
  triage: "Triage…", "it-check": "Mark checked", "loan-due": "Set loan date…", assign: "Assign…",
};

/** Spec §5.1: controls read their verb, links keep theirs, a viewer reads Open everywhere. */
export function workActionLabel(row: WorkRow, canAct: boolean): string {
  if (!canAct) return "Open";
  return row.control ? CONTROL_LABEL[row.control.kind] : row.action;
}

export function groupWork(
  rows: WorkRow[],
  dismissed: Set<string>,
  opts: { limit?: number },
  saturated: ReadonlySet<WorkSectionId> = new Set(),
): WorkGroup[] {
  const order = (a: WorkRow, b: WorkRow) => (a.rank ?? 0) - (b.rank ?? 0) || b.severity - a.severity;
  return WORK_SECTIONS.flatMap((section) => {
    const mine = rows.filter((r) => r.section === section.id);
    const live = mine.filter((r) => !dismissed.has(r.key)).sort(order);
    const hidden = mine.filter((r) => dismissed.has(r.key)).sort(order);
    if (live.length === 0 && hidden.length === 0) return [];
    return [{
      section,
      rows: opts.limit ? live.slice(0, opts.limit) : live,
      total: live.length,
      capped: saturated.has(section.id),
      hidden,
    }];
  });
}

/** Plan P-8: where the rest of a capped section lives. */
export const SEE_ALL_HREF: Record<WorkSectionId, string> = {
  triage: "/inventory?sort=attention", check: "/inventory?sort=attention",
  repairs: "/inventory?status=DEFECTIVE", loans: "/inventory?status=TEMPORARY&sort=attention",
  missing: "/inventory?status=MISSING", hires: "/employees?gaps=1", queue: "/approvals",
};

/** The standalone page's cap line (spec §5.2); null when every row is shown. */
export function capLine(g: WorkGroup): string | null {
  if (!g.capped && g.total <= g.rows.length) return null;
  return `Showing ${g.rows.length} of ${g.total}${g.capped ? "+" : ""} · See all`;
}

/** One chip per section with live rows, in section order (spec §5.2). */
export function summaryChips(groups: WorkGroup[]): { id: WorkSectionId; label: string; href: string }[] {
  return groups
    .filter((g) => g.total > 0)
    .map((g) => ({ id: g.section.id, label: `${g.section.title} ${g.capped ? `${g.total}+` : g.total}`, href: `#${g.section.id}` }));
}

/** Rank-0 queue rows are SLA breaches (worklist()'s own ranking). */
export function pastSlaCount(groups: WorkGroup[]): number {
  return groups.find((g) => g.section.id === "queue")?.rows.filter((r) => (r.rank ?? 0) === 0).length ?? 0;
}
```

Keep `WORK_SECTIONS`, `WorkRow`, `LoanLike`, `LOAN_DUE_SOON_DAYS`, `DEFAULT_LOAN_DAYS` as they are. Delete the now-unused `daysBetween`/`DAY_MS` if nothing else in the file uses them.

In `src/lib/home.ts`, after `withDismissal`:

```ts
/** Undo for one hidden row (spec §5.2): today's set without that key. */
export function withoutDismissal(value: unknown, today: string, key: string): DismissPref {
  const pref = asPref(value);
  if (!pref || pref.date !== today) return { date: today, keys: [] };
  return { date: today, keys: pref.keys.filter((k) => k !== key) };
}
```

Existing `groupWork` tests that expected a dismissed-only section to disappear must now expect it to stay with `rows: []` and its row in `hidden` — adapt them.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/worklist.test.ts src/lib/home.test.ts` → PASS. Then `npx tsc --noEmit`: the only errors allowed are in `src/server/modules/home/queries.ts` (the `leaverRow` input shape) — fix them minimally now so tsc is clean: in `worklist()` build `LeaverLike` with `employment: "OFFBOARDING", dueAt: e.offboardingDueAt, undecided: e._count.assets, failed: null, m365Status: null` (a stop-gap T9 replaces with the real snapshot). Re-run `npx tsc --noEmit` → clean; `npx vitest run` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/worklist.ts src/lib/worklist.test.ts src/lib/home.ts src/lib/home.test.ts src/server/modules/home/queries.ts
git commit -m "feat(worklist): pure rules for in-place controls, honest labels, hidden rows, caps and chips (Phase 32 T2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server — the offboarding snapshot, the Attention pass, next leaver, `decideOne` and `decideRemaining`

**Files:**
- Modify: `src/server/modules/offboarding/queries.ts`, `src/server/modules/offboarding/actions.ts`
- Test: `npx tsc --noEmit`; the existing `e2e/offboarding.spec.ts` + `e2e/offboarding-v2.spec.ts` as the regression net (focused run).

**Interfaces:**
- Consumes (T1): `LeaverState`, `FailedReturn`, `offboardingAttention`, `orderByOffboardingAttention`, `decisionOf`; `primarySortOf` from `@/lib/url-state`.
- Produces:
  ```ts
  // OffboardingRow gains: employment: string; failed: FailedReturn | null; attention: OffboardingAttention | null
  export async function leaverStates(): Promise<OffboardingRow[]>        // every OFFBOARDING employee, attention computed
  export async function nextLeaver(currentId: string): Promise<{ id: string; name: string } | null>
  // WizardData gains: failed: FailedReturn[]
  export async function decideRemaining(input: unknown): Promise<ActionResult<{
    filed: { assetId: string; refNo: string }[];
    refused: { assetId: string; message: string }[];
  }>>
  ```

- [ ] **Step 1: The snapshot fields.** In `queries.ts`, extend `OffboardingRow` with `employment: string; failed: FailedReturn | null; attention: OffboardingAttention | null`. Change `toOffboardingRow(e)` to `toOffboardingRow(e, todayISO: string)` and compute:

```ts
  // the first held item whose live decision failed to execute — completeOffboarding's second gate
  const failed = e.assets
    .map((a) => decisionOf(byAsset.get(a.id) ?? [], { held: true }))
    .find((d) => d?.state === "EXECUTION_FAILED");
  const state = {
    id: e.id, employment: e.employment, dueAt: e.offboardingDueAt, undecided: heldIdSet.size - decidedHeld,
    failed: failed ? { refNo: failed.refNo, approvalId: failed.id } : null, m365Status: e.m365Status,
  };
  return {
    /* every existing field, unchanged */,
    employment: e.employment,
    failed: state.failed,
    attention: offboardingAttention(state, todayISO),
  };
```

Update every `toOffboardingRow` caller to pass `localDateISO(new Date())` (computed once per request). If `OFFBOARDING_INCLUDE` / `OffboardingCandidate` does not already select `employment` and `m365Status`, add them (the facts file shows `m365Status` is read; confirm `employment`).

- [ ] **Step 2: `leaverStates` and `nextLeaver`** (append to `queries.ts`):

```ts
/** Every OFFBOARDING employee as a row — the worklist's leavers, Home and the wizard's Next leaver read this. */
export async function leaverStates(): Promise<OffboardingRow[]> {
  const today = localDateISO(new Date());
  const candidates = await prisma.employee.findMany({
    where: { employment: "OFFBOARDING" },
    orderBy: [{ name: "asc" }, { employeeNo: "asc" }, { id: "asc" }],
    include: OFFBOARDING_INCLUDE,
  });
  return candidates.map((e) => toOffboardingRow(e, today));
}

/** Spec §4.4: the next person in Attention order after the one just completed, or null (Queue clear). */
export async function nextLeaver(currentId: string): Promise<{ id: string; name: string } | null> {
  const rows = orderByOffboardingAttention(await leaverStates(), "desc");
  const next = rows.find((r) => r.id !== currentId);
  return next ? { id: next.id, name: next.name } : null;
}
```

- [ ] **Step 3: The Attention pass in `listOffboarding`.** In its in-memory branch, replace the `undecided`-only ordering with:

```ts
    const attentionSort = primarySortOf(state.sort, "attention");
    if (attentionSort) {
      computed = orderByOffboardingAttention(computed, attentionSort.dir);
    } else if (orderBy === null) {
      const undecidedSort = state.sort.find((s) => s.key === "undecided");
      computed = sortByUndecided(computed, undecidedSort?.dir ?? "asc");
    }
```

`offboardingExportRows` follows the same order when Attention is primary (mirror the branch; the Phase 31 rule "exports follow the derived sorts").

- [ ] **Step 4: The wizard's failed list.** In `getWizard`, add to `WizardData`:

```ts
  /** held items whose live decision failed to execute — the Finish checklist's Requests lines */
  failed: FailedReturn[];
```

computed as `rows.filter((i) => i.held && i.decision?.state === "EXECUTION_FAILED").map((i) => ({ refNo: i.decision!.refNo, approvalId: i.decision!.id }))`.

- [ ] **Step 5: Extract `decideOne` (plan P-6).** In `actions.ts`, move the body of `decideItem`'s `prisma.$transaction(async (tx) => { … })` callback — from `const employee = await tx.employee.findUnique(...)` through the queued branch's `return null` — into:

```ts
type DecideInput = { employeeId: string; assetId: string; outcome: Outcome; reason: string };
type DecideOutcome = { failure: ActionResult<never> } | { refNo: string; applied: string | null };

/** One item's decision inside the caller's transaction — decideItem and decideRemaining share it (plan P-6). */
async function decideOne(
  tx: Prisma.TransactionClient,
  user: { id: string; name: string; role: Role },
  d: DecideInput,
  now: Date,
): Promise<DecideOutcome> {
  // …the moved body, unchanged, with `return conflict(…)` / `return validationError(…)` written as
  // `return { failure: conflict(…) }` / `return { failure: validationError(…) }`, and the two success
  // paths returning `{ refNo: approval.refNo, applied: targetStatus }` (direct) and
  // `{ refNo: approval.refNo, applied: null }` (queued) instead of assigning outer variables.
}
```

`decideItem` keeps its guards, its `P2002`/`P2028` catch and its `revalidate(d.employeeId, d.assetId)`, and becomes:

```ts
    const result = await prisma.$transaction((tx) => decideOne(tx, user, { ...d, reason }, now));
    if ("failure" in result) return result.failure;
    refNo = result.refNo;
    applied = result.applied;
```

Import `Outcome` from `@/lib/offboarding` and `Role` from `@prisma/client` as needed. Behaviour, copy and audit rows must be byte-identical — `e2e/offboarding.spec.ts` is the net.

- [ ] **Step 6: `decideRemaining`** (append to `actions.ts`):

```ts
const remainingSchema = z.object({
  employeeId: z.string().min(1),
  decisions: z.array(z.object({
    assetId: z.string().min(1),
    outcome: z.enum(OUTCOMES),
    reason: reasonOptional(),
  })).min(1).max(50),
});

/**
 * Spec §4.3 / §8: "Mark the rest as Returned…" — one decision per item, each in its own
 * transaction through decideOne, so every item is direct or queued exactly as decideItem would
 * file it, with one audit row each. One rate event for the batch. Items decided or taken in the
 * meantime come back in `refused` with decideOne's own copy; nothing is filed twice.
 */
export async function decideRemaining(input: unknown): Promise<ActionResult<{
  filed: { assetId: string; refNo: string }[];
  refused: { assetId: string; message: string }[];
}>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = remainingSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId, decisions } = parsed.data;
  const now = new Date();

  const filed: { assetId: string; refNo: string }[] = [];
  const refused: { assetId: string; message: string }[] = [];
  for (const item of decisions) {
    try {
      const result = await prisma.$transaction((tx) =>
        decideOne(tx, user, { employeeId, assetId: item.assetId, outcome: item.outcome, reason: cleanReason(item.reason) }, now));
      if ("failure" in result) {
        const f = result.failure;
        const message = !f.ok ? (f.fieldErrors?.reason ?? f.fieldErrors?.outcome ?? f.message) : "Not filed.";
        refused.push({ assetId: item.assetId, message });
      } else {
        filed.push({ assetId: item.assetId, refNo: result.refNo });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2028")) {
        refused.push({
          assetId: item.assetId,
          message: err.code === "P2002"
            ? "Another request just took this asset's open slot — refresh the wizard."
            : "The database is busy right now — nothing was written. Try that again.",
        });
        continue;
      }
      throw err;
    }
  }
  for (const f of filed) revalidate(employeeId, f.assetId);
  if (filed.length === 0) revalidate(employeeId);
  return ok({ filed, refused });
}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → clean; `npx vitest run` → green. Then, port 3100 free, foreground:
`E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/offboarding-v2.spec.ts --workers=1 --global-timeout=540000` → every case passes **except** pins that depend on the queue's default order (none are expected — the queue has a single seeded leaver). If a case fails, it is a behaviour change in `decideOne` — fix the code, not the test. Leave no server on 3100.

- [ ] **Step 8: Commit**

```bash
git add src/server/modules/offboarding/queries.ts src/server/modules/offboarding/actions.ts
git commit -m "feat(offboarding): leaver snapshot with failed returns and attention, Attention order, next leaver, decideOne shared by decideItem and decideRemaining (Phase 32 T3)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The offboarding queue `/offboarding` (spec §4.1)

**Files:**
- Create: `src/components/offboarding/offboarding-more-menu.tsx`
- Modify: `src/app/(app)/offboarding/page.tsx`
- Adapt e2e: `e2e/offboarding.spec.ts` (L49 "Open wizard" link, L71-80 "0 of 3"/"3 to go"), `e2e/it-nav.spec.ts` (test 12's Export click ~L500), `e2e/paging.spec.ts` (offboarding count line — re-verify only). See facts §8a.

**Interfaces:**
- Consumes (T1/T3): `offboardingNext`, `OffboardingRow.attention`, `.failed`, `.employment`; `ProgressBar`; `Menu`, `IconButton`.
- Produces: `OffboardingMoreMenu({ exportHref }: { exportHref: string })`.

- [ ] **Step 1: The More menu** — create `src/components/offboarding/offboarding-more-menu.tsx`:

```tsx
"use client";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";

/** The queue header's ⋯ (spec §4.1): Export is a route handler, so it is a full navigation. */
export function OffboardingMoreMenu({ exportHref }: { exportHref: string }) {
  const items: MenuItem[] = [{ label: "Export", onSelect: () => window.location.assign(exportHref) }];
  return <Menu align="end" items={items} trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>} />;
}
```

- [ ] **Step 2: The page.** In `src/app/(app)/offboarding/page.tsx`:
  - Header `actions={<OffboardingMoreMenu exportHref={"/offboarding/export" + <the same query string the Export link uses today>} />}` — no primary.
  - Count line (replacing `… · every item is collected as its own request`). `{k}` is the Due facet's `overdue` count, which `offboardingFacets` already computes over the whole filtered set (not just the page): `const overdueCount = Number(facets.due.find((o) => o.value === "overdue")?.count ?? 0);` (match the `FacetOption` field names). Render:

```tsx
<p aria-live="polite" className="text-[12px] text-fg-muted">
  {total} {total === 1 ? "person" : "people"} leaving
  {overdueCount > 0 && (
    <> · <Link href={"/offboarding" + serializeListState(withFilter(state, "due", ["overdue"]), OFFBOARDING_LIST_CONFIG)} className="text-accent hover:underline">{overdueCount} overdue</Link></>
  )}
</p>
```

  (Keep the existing copy's grammar for `person`/`people`; the pinned form is `{n} people leaving · {k} overdue`.)
  - Empty state (no rows and no filters): title `No one is leaving`, description `Start offboarding from a person's profile — More › Start offboarding…`. The filtered-empty state (`No one matches these filters`) stays.
  - Columns: dot, **Name** (link to `/offboarding/{id}`, `employeeNo · title` beneath, then the marker line `row.attention?.label` in `text-[10.5px]` — accent tone for `failed`/`overdue`, muted otherwise), **Department**, **Started**, **Due** (unchanged cell), **Progress** (header keeps the `undecided` sort key):

```tsx
<Td>
  <span className="font-mono text-[11px] text-fg">{row.decided} of {row.total} decided</span>
  <ProgressBar value={row.decided} max={row.total} label={`${row.name}: ${row.decided} of ${row.total} decided`} />
</Td>
```

  and the action cell:

```tsx
<Td className="text-right" onClick={(e) => e.stopPropagation()}>
  {(() => {
    const next = canMutate ? offboardingNext({ id: row.id, employment: row.employment, dueAt: row.dueAt, undecided: row.undecided, failed: row.failed, m365Status: row.m365 }) : null;
    return next
      ? <ButtonLink size="sm" variant="secondary" href={next.href}>{next.label}</ButtonLink>
      : <ButtonLink size="sm" variant="ghost" href={`/offboarding/${row.id}`}>View</ButtonLink>;
  })()}
</Td>
```

  Remove the **Items out**, **Undecided**, **M365** and **Joined** columns and their headers. `canMutate` is the page's existing admin/IT check.

- [ ] **Step 3: Adapt the pins** (facts §8a):
  - `offboarding.spec.ts:49` → `page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: /^Collect \d+ items?$/ }).click();`
  - `offboarding.spec.ts:71-80` → assert the Progress cell `0 of 3 decided` and the marker line (Dennis is seeded 2 days overdue, so `overdue by 2 d`); drop the `3 to go` assertion (that copy is gone).
  - `it-nav.spec.ts` test 12's Export → `await page.getByRole("button", { name: "More actions" }).click(); await page.getByRole("menuitem", { name: "Export" }).click();` inside the existing `waitForEvent("download")` promise.
  - `paging.spec.ts` offboarding count: re-run; the unanchored `{n} people leaving` still matches.

- [ ] **Step 4: Verify** — `npx tsc --noEmit`, `npx vitest run`, then foreground: `E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/it-nav.spec.ts e2e/paging.spec.ts e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` → all pass. Port free after.

- [ ] **Step 5: Commit**

```bash
git add src/components/offboarding/offboarding-more-menu.tsx src/app/(app)/offboarding/page.tsx e2e/offboarding.spec.ts e2e/it-nav.spec.ts e2e/paging.spec.ts
git commit -m "feat(offboarding): the queue opens worst first with one state-labelled action, a Progress cell and the overdue count (Phase 32 T4)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wizard header, entry step, step names, friendly words, reachability, Review's Decision cell (spec §4.2, §4.4 first bullet, §4.4 last bullet)

**Files:**
- Create: `src/components/offboarding/wizard-more-menu.tsx`
- Modify: `src/app/(app)/offboarding/[employeeId]/page.tsx`, `src/components/offboarding/wizard-steps.tsx`
- Adapt e2e: `offboarding.spec.ts:110-112` (step-bar link count), `:196` (`/Farewell report/` step link → `/Finish/`), `direct-lifecycle.spec.ts:255-307` (link count `toHaveCount(4)`), `import-export.spec.ts:705-736` (`Export sheet` now in More), `deadlines.spec.ts:140-166` (re-verify the header due text).

**Interfaces:**
- Consumes: `offboardingNext`, `defaultStep`, `parseStep`, `decisionStateLabel`, `EMPLOYMENT_LABEL`, `STATUS_LABEL`, `WizardData.failed`.
- Produces: `WizardMoreMenu({ recordHref, reportHref, exportHref })`; `WizardSteps({ employeeId, current })` (the `unlocked` prop is removed).

- [ ] **Step 1: More menu** — `src/components/offboarding/wizard-more-menu.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";

/** The wizard header's ⋯ (spec §4.2). Export sheet is a route handler: a full navigation. */
export function WizardMoreMenu({ recordHref, reportHref, exportHref }: { recordHref: string; reportHref: string; exportHref: string }) {
  const router = useRouter();
  const items: MenuItem[] = [
    { label: "Employee record", onSelect: () => router.push(recordHref) },
    { label: "Farewell report", onSelect: () => router.push(reportHref) },
    { label: "Export sheet", onSelect: () => window.location.assign(exportHref) },
  ];
  return <Menu align="end" items={items} trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>} />;
}
```

- [ ] **Step 2: Entry step and header.** In `[employeeId]/page.tsx`:
  - `const step = searchParams.step ? parseStep(searchParams.step) : defaultStep({ employment: employee.employment, undecided, m365Status: employee.m365Status });`
  - Build the leaver state once: `const state = { id: employee.id, employment: employee.employment, dueAt: employee.dueAt, undecided: data.undecided, failed: data.failed[0] ?? null, m365Status: employee.m365Status };` and `const next = canMutate ? offboardingNext(state) : null;`.
  - Header actions (plan P-3):

```tsx
actions={
  <>
    {next && next.step !== step && (
      <ButtonLink variant="primary" href={next.href}>{next.step === "report" ? "Complete offboarding" : next.label}</ButtonLink>
    )}
    <WizardMoreMenu
      recordHref={`/employees/${employee.id}`}
      reportHref={`/offboarding/${employee.id}/report`}
      exportHref={`/offboarding/${employee.id}/report/export`}
    />
  </>
}
```

  (Use the export route the current "Export sheet" link points at — read it from the report page.) Remove the two old header `ButtonLink`s. Viewers: no primary; the READ-ONLY pill stays.
  - Header badge: `EMPLOYMENT_LABEL[employee.employment]` instead of the mono enum.
  - Status cells: `STATUS_LABEL[i.status as AssetStatus] ?? i.status`; decision state cells: `decisionStateLabel(decision.state)`.

- [ ] **Step 3: Reachability.** In `wizard-steps.tsx` remove the `unlocked` prop; every step is a link (`reachable = true`), the current one `aria-current="step"`. The Collect step's own inline Continue button keeps its `canContinue` gate (spec §4.3 does not remove it). Update the page's `<WizardSteps … />` call.

- [ ] **Step 4: Review's Decision cell.** Replace the three columns Decision / Decided by / Decided on with one `Decision` column, rendered only when `data.items.some((i) => i.decision)`:

```tsx
<Td>{i.decision ? `${OUTCOME_LABEL[i.decision.outcome]} · ${i.decision.decidedBy ?? "—"} · ${fmtDate(i.decision.decidedAt)}` : "—"}</Td>
```

- [ ] **Step 5: Adapt pins** (facts §8a): step-bar counts become `toHaveCount(4)` at every point (all four are links); `gotoStep(page, /Farewell report/)` → `/Finish/`; `import-export.spec.ts` "Export sheet" → open `More actions`, click `menuitem` `Export sheet` inside the download promise; `direct-lifecycle.spec.ts` test 7 — replace the raw link count assertion by asserting the `Finish` step link exists before and after deciding (it is always reachable now). Any assertion on `Decided by` / `Decided on` column headers → the single `Decision` cell text.

- [ ] **Step 6: Verify** — tsc, vitest, then foreground `E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/offboarding-v2.spec.ts e2e/direct-lifecycle.spec.ts e2e/import-export.spec.ts e2e/deadlines.spec.ts e2e/scanner.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 7: Commit**

```bash
git add src/components/offboarding/wizard-more-menu.tsx src/components/offboarding/wizard-steps.tsx "src/app/(app)/offboarding/[employeeId]/page.tsx" e2e/offboarding.spec.ts e2e/direct-lifecycle.spec.ts e2e/import-export.spec.ts e2e/offboarding-v2.spec.ts
git commit -m "feat(offboarding): the wizard opens where the work is, its header carries the next step and a More menu, every step is reachable (Phase 32 T5)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Collect step (spec §4.3)

**Files:**
- Create: `src/components/offboarding/mark-rest-dialog.tsx`, `src/components/offboarding/mark-rest-button.tsx`
- Modify: `src/app/(app)/offboarding/[employeeId]/page.tsx` (Collect branch), `src/components/offboarding/item-decision.tsx`, `src/components/offboarding/scan-provider.tsx`
- Adapt e2e: `offboarding.spec.ts:132-144` (banner text, if asserted), `scanner.spec.ts` (the "Scanning works here" banner, if asserted — the verdict slot stays).

**Interfaces:**
- Consumes: `decideRemaining` (T3), `outcomesFor`, `OUTCOME_LABEL`, `reasonRequired`, `Dialog`, `ProgressBar`, `useToast`, `RateLimitNotice`.
- Produces: `MarkRestButton({ employeeId, name, items })` where `items: { assetId: string; tag: string; model: string; cls: AssetClass }[]`.

- [ ] **Step 1: One hint line.** Replace the Collect step's neutral `Banner` ("Each decision is recorded the moment you confirm it") and `ScanProvider`'s "Scanning works here" banner with one muted line under the step bar:

```tsx
<p className="text-[11.5px] text-fg-muted">
  Each confirm is saved at once · scan a tag to jump to it
  {mixedPaths && <> · Some items file a request for approval.</>}
</p>
```

`mixedPaths` = the undecided items include both direct and queued items (`isDirectLifecycle(user.role, i.cls)` differs across them). `ScanProvider` keeps its `aria-live` verdict slot as the only banner-tone element. For viewers render one line `Read-only — collecting equipment is an IT action.` above the list and remove the per-card repetition.

- [ ] **Step 2: Progress and order.** Above the list:

```tsx
<div className="flex flex-col gap-1">
  <span className="text-[12px] text-fg">{decidedCount} of {data.items.length} decided</span>
  <ProgressBar value={decidedCount} max={data.items.length} label={`${decidedCount} of ${data.items.length} decided`} />
</div>
```

Order the cards: undecided and unblocked first, then blocked (`blockedBy`), then decided-awaiting-approval as compact one-line rows `Decided · {refNo} · awaiting approval` (a plain `li`, the refNo linking `/approvals/{id}`). Within each group keep tag order.

- [ ] **Step 3: After a confirm (item-decision.tsx).** On success: set `data-changed` on the card for 2 s (the Phase 29 §4.7 attribute), then after `router.refresh()` focus the next undecided card's group — the same non-activatable `tabIndex={-1}` group element the scanner focuses (look up by `[data-decision-group]:not([data-decided])` in DOM order after the refreshed card; add those data attributes if the group lacks them). Client reason check: in `submit()`, before calling the server,

```ts
if (picked && reasonRequired(picked) && reason.trim().length < 3) {
  setFieldErrors({ reason: `${OUTCOME_LABEL[picked]} needs a reason (at least 3 characters) — it lands in the approval and on the farewell report.` });
  reasonRef.current?.focus();
  return;
}
```

(the server's exact copy; add `const reasonRef = useRef<HTMLTextAreaElement>(null)` and pass it to `ReasonField`'s input — if `ReasonField` does not forward a ref, add `inputRef` to its props). Confirm stays enabled.

- [ ] **Step 4: Mark the rest dialog** — `mark-rest-dialog.tsx`:

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { OUTCOME_LABEL, outcomesFor, reasonRequired, type Outcome } from "@/lib/offboarding";
import { decideRemaining } from "@/server/modules/offboarding/actions";

export interface RestItem { assetId: string; tag: string; model: string; cls: AssetClass }

/** Spec §4.3: every remaining item preselected Returned, each changeable; one confirm files one decision per item. */
export function MarkRestDialog({ open, onClose, employeeId, name, items }: {
  open: boolean; onClose: () => void; employeeId: string; name: string; items: RestItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<RestItem[]>(items);
  const [choice, setChoice] = useState<Record<string, { outcome: Outcome; reason: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(items);
    setChoice(Object.fromEntries(items.map((i) => [i.assetId, { outcome: "RETURNED" as Outcome, reason: "" }])));
    setErrors({});
    setRetryAfter(null);
  }, [open, items]);

  function submit() {
    const missing: Record<string, string> = {};
    for (const r of rows) {
      const c = choice[r.assetId];
      if (reasonRequired(c.outcome) && c.reason.trim().length < 3) {
        missing[r.assetId] = `${OUTCOME_LABEL[c.outcome]} needs a reason (at least 3 characters) — it lands in the approval and on the farewell report.`;
      }
    }
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    startTransition(async () => {
      const res = await decideRemaining({
        employeeId,
        decisions: rows.map((r) => ({ assetId: r.assetId, outcome: choice[r.assetId].outcome, reason: choice[r.assetId].reason })),
      });
      if (!res.ok) {
        if (res.kind === "rate_limited" && res.retryAfterSec) setRetryAfter(res.retryAfterSec);
        else toast(res.message, "fault");
        return;
      }
      const { filed, refused } = res.data;
      if (refused.length === 0) {
        toast(`${filed.length} decisions filed`, "settled");
        onClose();
      } else {
        const filedIds = new Set(filed.map((f) => f.assetId));
        setRows((cur) => cur.filter((r) => !filedIds.has(r.assetId)));
        setErrors(Object.fromEntries(refused.map((r) => [r.assetId, r.message])));
      }
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Mark the rest as Returned · ${name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit}>File {rows.length} decisions</Button>
      </>}
    >
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const c = choice[r.assetId] ?? { outcome: "RETURNED" as Outcome, reason: "" };
          const selectId = `rest-outcome-${r.assetId}`;
          const reasonId = `rest-reason-${r.assetId}`;
          return (
            <li key={r.assetId} className="flex flex-col gap-1.5">
              <label htmlFor={selectId} className="text-[12.5px] text-fg">{r.tag} · {r.model}</label>
              <select
                id={selectId}
                value={c.outcome}
                onChange={(e) => setChoice((cur) => ({ ...cur, [r.assetId]: { ...c, outcome: e.target.value as Outcome } }))}
                className="rounded-(--radius-ctl) border border-border bg-surface px-2 py-1 text-[12.5px]"
              >
                {outcomesFor(r.cls).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
              </select>
              {reasonRequired(c.outcome) && (
                <>
                  <label htmlFor={reasonId} className="text-[11.5px] text-fg-muted">Reason for {r.tag}</label>
                  <textarea
                    id={reasonId}
                    value={c.reason}
                    onChange={(e) => setChoice((cur) => ({ ...cur, [r.assetId]: { ...c, reason: e.target.value } }))}
                    className="rounded-(--radius-ctl) border border-border bg-surface px-2 py-1 text-[12.5px]"
                    aria-invalid={errors[r.assetId] ? true : undefined}
                    aria-describedby={errors[r.assetId] ? `${reasonId}-error` : undefined}
                  />
                </>
              )}
              {errors[r.assetId] && <p id={`${reasonId}-error`} className="text-[11.5px] text-[color:var(--st-fault-text)]">{errors[r.assetId]}</p>}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
```

Match the house form controls: if the codebase has a `Select` / `Textarea` / `Field` primitive (the facts file shows `AccountsPanel` uses `Select`, `ItemDecision` uses `ReasonField`), use those instead of the raw elements, keeping the labels and ids above.

`mark-rest-button.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkRestDialog, type RestItem } from "./mark-rest-dialog";

/** Shown while two or more items are undecided and unblocked (spec §4.3, §10). */
export function MarkRestButton({ employeeId, name, items }: { employeeId: string; name: string; items: RestItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length < 2) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Mark the rest as Returned…</Button>
      <MarkRestDialog open={open} onClose={() => setOpen(false)} employeeId={employeeId} name={name} items={items} />
    </>
  );
}
```

Mount it above the item list when `canDecide`, with `items = data.items.filter((i) => i.held && !i.decision && !i.blockedBy).map(({ assetId, tag, model, cls }) => ({ assetId, tag, model, cls }))`.

- [ ] **Step 5: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/scanner.spec.ts e2e/asset-classes.spec.ts --workers=1 --global-timeout=540000` → pass (adapt only pins on the removed banner copy). Port free.

- [ ] **Step 6: Commit**

```bash
git add src/components/offboarding/mark-rest-dialog.tsx src/components/offboarding/mark-rest-button.tsx src/components/offboarding/item-decision.tsx src/components/offboarding/scan-provider.tsx "src/app/(app)/offboarding/[employeeId]/page.tsx" e2e/offboarding.spec.ts e2e/scanner.spec.ts
git commit -m "feat(offboarding): Collect shows progress, undecided first, focus moves on, reasons checked in one pass, and Mark the rest as Returned (Phase 32 T6)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Accounts & M365 and the Finish step (spec §4.4)

**Files:**
- Create: `src/components/offboarding/readiness-checklist.tsx`, `src/components/offboarding/offboarded-card.tsx`
- Modify: `src/components/offboarding/accounts-panel.tsx`, `src/components/offboarding/complete-button.tsx`, `src/server/modules/offboarding/actions.ts` (`closeAccounts`), `src/app/(app)/offboarding/[employeeId]/page.tsx` (Accounts + report branches)
- Adapt e2e: `offboarding.spec.ts:203-205` (after Complete: the success card).

**Interfaces:**
- Consumes: `readiness`, `completionBlockers` (T1); `nextLeaver`, `WizardData.failed` (T3).
- Produces: `ReadinessChecklist({ lines }: { lines: ReadinessLine[] })`; `OffboardedCard({ name, decisions, completedAt, reportHref, next })`; `AccountsPanel({ employeeId, employeeName, m365Status })`.

- [ ] **Step 1: `closeAccounts` (plan P-5).** Add `confirmClear: z.boolean().optional()` to its schema. Replace the refusal that blocks clearing a live status with: refuse only when `next === null && m365Live(employee.m365Status) && parsed.data.confirmClear !== true`, message `Confirm that ${employee.name} never had an account before clearing ${employee.m365Status}.` Everything else (guard order, `updateMany` guard, audit) unchanged.

- [ ] **Step 2: `AccountsPanel`.** Add `employeeName` prop. The null option's label becomes `Never had an account`. When the chosen value is `""` and the stored status is live, submitting opens a `Dialog` titled `Clear ${employeeName}'s Microsoft 365 status? Only do this if they never had an account.` with buttons Cancel / `Clear status` (primary), which calls `closeAccounts({ employeeId, m365Status: null, confirmClear: true })`. When the stored status is live, render `Inactive` as the first option (the suggested choice). The custom-value hint reads `Stored exactly as typed.` The success toast keeps its shape, reading `never had an account` instead of `no sync yet` when null.

- [ ] **Step 3: `ReadinessChecklist`:**

```tsx
import Link from "next/link";
import type { ReadinessLine } from "@/lib/offboarding";

/** Spec §4.4: the three server gates, shown before anyone clicks Complete. */
export function ReadinessChecklist({ lines }: { lines: ReadinessLine[] }) {
  return (
    <ul aria-label="Ready to complete" className="flex flex-col gap-1.5">
      {lines.map((l) => (
        <li key={l.kind + l.label} className="flex items-center gap-2 text-[12.5px]">
          <span aria-hidden className={l.ok ? "text-[color:var(--st-settled-dot)]" : "text-[color:var(--st-fault-text)]"}>{l.ok ? "✓" : "✗"}</span>
          <span className="sr-only">{l.ok ? "Done:" : "Blocking:"}</span>
          {l.href ? <Link href={l.href} className="text-accent hover:underline">{l.label}</Link> : <span className="text-fg">{l.label}</span>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Finish step.** In the `report` branch: compute `const input = { id: employee.id, total: data.items.length, undecided: data.undecided, failed: data.failed, m365Status: employee.m365Status }`; render `<ReadinessChecklist lines={readiness(input)} />` above the totals for an active leaver; render `<CompleteButton … />` (as the step's primary) only when `completionBlockers(input).length === 0 && canMutate`.

- [ ] **Step 5: The ending (plan P-4).** `CompleteButton` on success: `router.push(\`/offboarding/${employeeId}?step=report&done=1\`)` (instead of `router.refresh()`), toast unchanged. `offboarded-card.tsx`:

```tsx
import { ButtonLink } from "@/components/ui/button-link";
import { fmtDate } from "@/lib/format";

/** Spec §4.4 Peak-End: what the operator who just finished sees. */
export function OffboardedCard({ name, decisions, completedAt, reportHref, next }: {
  name: string; decisions: number; completedAt: Date | null; reportHref: string; next: { id: string; name: string } | null;
}) {
  return (
    <section aria-labelledby="offboarded-title" className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4">
      <h2 id="offboarded-title" className="text-[15px] font-semibold text-fg">
        {name} offboarded · {decisions} decision{decisions === 1 ? "" : "s"} · {fmtDate(completedAt)}
      </h2>
      <div className="flex flex-wrap gap-2">
        <ButtonLink variant="primary" href={reportHref}>Print farewell report</ButtonLink>
        {next
          ? <ButtonLink variant="secondary" href={`/offboarding/${next.id}`}>Next leaver →</ButtonLink>
          : <ButtonLink variant="secondary" href="/offboarding">Queue clear</ButtonLink>}
      </div>
    </section>
  );
}
```

In the page: when `employee.employment === "OFFBOARDED" && searchParams.done === "1"`, render `<OffboardedCard … next={await nextLeaver(employee.id)} />` in place of the "already offboarded" banner; otherwise keep the banner. `nextLeaver` only lists OFFBOARDING people, so it never returns someone the IT viewer cannot act on (the wizard is IT's own page).

- [ ] **Step 6: Adapt pins** — `offboarding.spec.ts:203-205`: after the Complete dialog, expect `page.getByRole("heading", { name: /Dennis Ong offboarded · 3 decisions · / })`, the `Print farewell report` link, and `Queue clear` (Dennis is the only seeded leaver). The existing M365 test that selects `inactive` stays as is.

- [ ] **Step 7: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/offboarding-v2.spec.ts e2e/deadlines.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 8: Commit**

```bash
git add src/components/offboarding/readiness-checklist.tsx src/components/offboarding/offboarded-card.tsx src/components/offboarding/accounts-panel.tsx src/components/offboarding/complete-button.tsx src/server/modules/offboarding/actions.ts "src/app/(app)/offboarding/[employeeId]/page.tsx" e2e/offboarding.spec.ts
git commit -m "feat(offboarding): Finish shows the readiness checklist before Complete, Never had an account asks first, and completing ends on a success card with the next leaver (Phase 32 T7)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The farewell report (spec §4.5)

**Files:**
- Modify: `src/app/(app)/offboarding/[employeeId]/report/page.tsx`, the report export route (`src/app/(app)/offboarding/[employeeId]/report/export/route.ts`) and its row builder
- Adapt e2e: `deadlines.spec.ts:353` (re-verify), `import-export.spec.ts:705-736` (the sheet — add the undecided rows only if a case prints mid-way; the existing case decides everything first).

- [ ] **Step 1: Header.** Add at the top, print-hidden:

```tsx
<div className="print:hidden">
  <PageHeader
    title="Farewell report"
    breadcrumb={[
      { label: "Offboarding", href: "/offboarding" },
      { label: data.employee.employeeNo, href: `/offboarding/${data.employee.id}` },
      { label: "Farewell report" },
    ]}
    actions={<>{/* the existing Export sheet and Print buttons, moved here */}</>}
  />
</div>
```

The printed H1 becomes `Farewell report` (keep any brand prefix the page prints today, e.g. `Backroom IT — Farewell report`; `offboarding.spec.ts:225` matches `Offboarding farewell report` as a substring — update that one pin to `Farewell report`).

- [ ] **Step 2: Remove** the `STRIPES` constant and its `<span role="img" aria-label="scan code placeholder" …/>`, and the roadmap tail: the line reads `{employeeNo} · {n} decision{n === 1 ? "" : "s"}`.

- [ ] **Step 3: Draft state.** When `data.undecided > 0`: a line above the title block `DRAFT — {n} items undecided` (`n === 1` → `item`), and after the decided table a `Still to decide` section listing each undecided held item (`{tag} · {model} · {category}`). The export sheet appends the same undecided rows with an empty decision cell (read the export's row builder in `queries.ts` / the route; add the rows there so print and sheet stay in step).

- [ ] **Step 4: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/deadlines.spec.ts e2e/import-export.spec.ts e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/offboarding/[employeeId]/report" src/server/modules/offboarding/queries.ts e2e/offboarding.spec.ts
git commit -m "feat(offboarding): the farewell report has a Back control, loses the roadmap copy and placeholder, and says DRAFT with what is still to decide (Phase 32 T8)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Worklist rows act in place (spec §5.1)

**Files:**
- Create: `src/components/home/work-row-actions.tsx`
- Modify: `src/server/modules/home/queries.ts` (`worklist()` rows + `hireWorkRows` extraction + leavers from `leaverStates`), `src/components/home/worklist.tsx`, `src/app/(app)/inventory/work/page.tsx`, `src/app/(app)/page.tsx` (pass `employees` / `direct` to `Worklist`)
- Adapt e2e: `custody.spec.ts:284-289` (loan row `link "Set date"` → button `Set loan date…`), `offboarding.spec.ts:86-92` (leaver row link `Collect 3 items`, href `…?step=collect`), `deadlines.spec.ts:215-249` (re-verify).

**Interfaces:**
- Consumes (T2): `WorkControl`, `workActionLabel`, `leaverRow(LeaverLike)`, `loanRow`; (T3) `leaverStates`; the Phase 30 dialogs `TriageDialog`, `ItCheckDialog`, `LoanDueDialog`, `AssignDialog`; `activeEmployeeOptions()` (`@/server/modules/employees/queries`).
- Produces: `hireWorkRows(now: Date): Promise<WorkRow[]>` (exported, for T11's badge); `WorkRowActions({ row, canAct, direct, employees })`.

- [ ] **Step 1: Row data.** In `worklist()`:
  - Triage rows: add `control: { kind: "triage", asset: { id: a.id, tag: a.tag, model: a.model } }`, `entity: { kind: "asset", id: a.id, label: a.tag }`.
  - Awaiting-check rows: `control: { kind: "it-check", asset: { id: a.id, tag: a.tag } }`, `entity`.
  - Orphaned (DEPLOYED, no holder) rows: `control: { kind: "assign", asset: { id: a.id, tag: a.tag, model: a.model } }`, `entity`.
  - Loans: `loanRow` already carries its control (T2).
  - Repairs / Missing: `entity` only (links stay).
  - Approvals (breached and failed): `action: "Open"` (was "Claim"/"Retry"), `entity: undefined` (the link is the row's only target).
  - Hires: `href: \`/employees/${e.id}#loadout\``, `entity: { kind: "employee", id: e.id, label: e.name }`. Move the hires block (policies, exceptions, loop) into `export async function hireWorkRows(now: Date): Promise<WorkRow[]>` and call it from `worklist()`; it keeps its own `CAP.small` query and returns `{ rows, saturated }` if the caller needs the saturation flag — return type `{ rows: WorkRow[]; saturated: boolean }`.
  - Leavers: replace the leavers query with `leaverStates()` ordered by `orderByOffboardingAttention(…, "desc")`, sliced to `CAP.small`, each mapped to `leaverRow({ ...row, dueAt: row.dueAt, m365Status: row.m365, itemsOut: row.itemsOut }, todayISO)` (map `OffboardingRow` field names onto `LeaverLike`: `m365` → `m365Status`). Remove T2's stop-gap.

- [ ] **Step 2: `work-row-actions.tsx`:**

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { TriageDialog } from "@/components/inventory/triage-control";
import { ItCheckDialog } from "@/components/inventory/it-check";
import { LoanDueDialog } from "@/components/inventory/loan-due-control";
import { AssignDialog } from "@/components/inventory/holder-control";
import { workActionLabel, type WorkRow } from "@/lib/worklist";

/** Spec §5.1: a control opens the record's own dialog in place; everything else stays a link. One dialog per row. */
export function WorkRowActions({ row, canAct, direct, employees }: {
  row: WorkRow; canAct: boolean; direct: boolean; employees: ComboOption[];
}) {
  const [open, setOpen] = useState(false);
  const label = workActionLabel(row, canAct);
  const c = row.control;
  if (!canAct || !c) {
    return <Link href={row.href} className="shrink-0 text-[12px] font-medium text-accent hover:underline">{label}</Link>;
  }
  const close = () => setOpen(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{label}</Button>
      {c.kind === "triage" && <TriageDialog open={open} onClose={close} asset={c.asset} />}
      {c.kind === "it-check" && <ItCheckDialog open={open} onClose={close} asset={c.asset} />}
      {c.kind === "loan-due" && <LoanDueDialog open={open} onClose={close} asset={c.asset} loanDueAt={c.loanDueAt} />}
      {c.kind === "assign" && <AssignDialog open={open} onClose={close} asset={c.asset} direct={direct} employees={employees} />}
    </>
  );
}
```

Match each dialog's real prop names from the facts file (§4.2–4.6); if `LoanDueDialog`'s `loanDueAt` expects a string, convert there.

- [ ] **Step 3: `Worklist` component.** Make `worklist.tsx` a client component boundary only where needed: keep `Worklist` a server component that renders `WorkRowActions` per row. New props: `direct: boolean` and `employees: ComboOption[]`. Replace the row's `<Link>` with `<WorkRowActions row={row} canAct={canAct} direct={direct} employees={employees} />`. The ✓ `DismissButton` stays until T10.

- [ ] **Step 4: Callers.** `/inventory/work` and Home pass `direct={isDirectLifecycle(user.role, "IT")}` and `employees={groups.some((g) => g.rows.some((r) => r.control?.kind === "assign")) ? await activeEmployeeOptions() : []}`.

- [ ] **Step 5: Adapt pins** — `custody.spec.ts` case 10: `rows.nth(0).getByRole("button", { name: "Set loan date…" })`; `offboarding.spec.ts:86-92`: link `Collect 3 items` with `href` matching `/\/offboarding\/[a-z0-9]+\?step=collect/i`. Re-run `deadlines.spec.ts` case 3 (title `Dennis Ong is leaving` and `2 d overdue` are unchanged).

- [ ] **Step 6: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/custody.spec.ts e2e/offboarding.spec.ts e2e/deadlines.spec.ts e2e/direct-lifecycle.spec.ts e2e/oversight.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 7: Commit**

```bash
git add src/components/home/work-row-actions.tsx src/components/home/worklist.tsx src/server/modules/home/queries.ts "src/app/(app)/inventory/work/page.tsx" "src/app/(app)/page.tsx" e2e/custody.spec.ts e2e/offboarding.spec.ts
git commit -m "feat(worklist): rows open the record's own controls in place, links say what they do, leavers read their next step (Phase 32 T9)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Worklist row menu, Hide until tomorrow with Undo, summary chips, cap lines (spec §5.2)

**Files:**
- Create: `src/components/home/work-row-menu.tsx`, `src/components/home/hidden-rows.tsx`, `src/components/home/work-summary.tsx`
- Modify: `src/server/modules/home/actions.ts`, `src/components/home/worklist.tsx`, `src/app/(app)/inventory/work/page.tsx`
- Delete: `src/components/home/dismiss-button.tsx`
- Adapt e2e: `direct-lifecycle.spec.ts:317-352` (the `/^Clear "/` button → row menu), `home-finance.spec.ts:127-134` (the `/^Clear "/` check → no `Actions for` menu for a viewer), `paging.spec.ts:452-465` (cap line copy).

**Interfaces:**
- Consumes (T2): `groupWork` hidden rows, `capLine`, `SEE_ALL_HREF`, `summaryChips`, `pastSlaCount`, `withoutDismissal`.
- Produces: `undismissShiftRow(input: unknown): Promise<ActionResult<null>>`; `WorkRowMenu({ row })`; `HiddenRows({ rows })`; `WorkSummary({ groups })`.

- [ ] **Step 1: Actions.** Rewrite `home/actions.ts` so both actions run role → rate → zod:

```ts
export async function dismissShiftRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  await writeDismissal(user.id, (value) => withDismissal(value, todayStamp(), parsed.data.key));
  return ok(null);
}

/** Undo for Hide until tomorrow (spec §5.2) — the same per-user, per-day preference, one key removed. */
export async function undismissShiftRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  await writeDismissal(user.id, (value) => withoutDismissal(value, todayStamp(), parsed.data.key));
  return ok(null);
}

async function writeDismissal(userId: string, next: (value: unknown) => DismissPref) {
  const existing = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
    select: { value: true },
  });
  const value = next(existing?.value) as unknown as Prisma.InputJsonObject;
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
    create: { userId, key: DISMISS_PREF_KEY, value },
    update: { value },
  });
  revalidatePath("/");
  revalidatePath("/inventory/work");
}
```

(`writeDismissal` is a non-exported helper in the `"use server"` file — allowed; keep the existing comment on why no audit row is written.)

- [ ] **Step 2: Row menu** — `work-row-menu.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { dismissShiftRow, undismissShiftRow } from "@/server/modules/home/actions";
import type { WorkRow } from "@/lib/worklist";

/** Spec §5.2: Open record / Open profile / Hide until tomorrow — replacing the ✓ that looked like "done". */
export function WorkRowMenu({ row }: { row: WorkRow }) {
  const router = useRouter();
  const toast = useToast();
  const items: MenuItem[] = [];
  if (row.entity?.kind === "asset") items.push({ label: "Open record", onSelect: () => router.push(`/inventory/${row.entity!.id}`) });
  if (row.entity?.kind === "employee") items.push({ label: "Open profile", onSelect: () => router.push(`/employees/${row.entity!.id}`) });
  items.push({
    label: "Hide until tomorrow",
    onSelect: async () => {
      const res = await dismissShiftRow({ key: row.key });
      if (!res.ok) { toast(res.message, "fault"); return; }
      router.refresh();
      toast("Hidden until tomorrow · Undo", "neutral");
    },
  });
  const name = row.entity?.label ?? row.title;
  return <Menu align="end" items={items} trigger={(p) => <IconButton {...p} aria-label={`Actions for ${name}`}>⋯</IconButton>} />;
}
```

The toast must offer a real **Undo**: if `useToast` supports an action (check `src/components/ui/toast.tsx`), pass `{ label: "Undo", onAction: () => undismissShiftRow({ key: row.key }).then(() => router.refresh()) }`; if it does not, extend `ToastProvider`'s push signature with an optional `action?: { label: string; onAction: () => void }` rendered as a button inside the toast (it is the only toast that needs one). A rate-limited refusal shows `RateLimitNotice` copy through the toast message (`res.message` already carries it).

- [ ] **Step 3: Hidden rows** — `hidden-rows.tsx`: a client disclosure rendered under a section heading when `g.hidden.length > 0`: a `Show` button (`aria-expanded`) revealing the hidden rows, each with its title and an `Unhide` button calling `undismissShiftRow` then `router.refresh()`. The heading reads `{g.total}` or `{g.total} · {g.hidden.length} hidden today`.

- [ ] **Step 4: Summary and caps.** `work-summary.tsx` (server component): a `nav aria-label="Worklist sections"` of chip links from `summaryChips(groups)`, plus, when `pastSlaCount(groups) > 0`, an accent chip `{k} past SLA` linking `#queue`. Render it at the top of `/inventory/work` only. In `Worklist`, on the standalone page (no `seeAllBase`), replace `Showing the first {n} — the oldest first.` with `capLine(g)` rendered as text + a `See all` link to `SEE_ALL_HREF[g.section.id]` (the line ends `· See all`; render `Showing {n} of {total}+ · ` followed by the link). Home keeps its `See all {n}` link.

- [ ] **Step 5: Wire** `WorkRowMenu` into each `Worklist` row when `canAct` (replacing `DismissButton`), and `HiddenRows` under each section heading when `canAct`. Delete `dismiss-button.tsx`.

- [ ] **Step 6: Adapt pins** — `direct-lifecycle.spec.ts` case 8: `await row.getByRole("button", { name: /^Actions for / }).click(); await page.getByRole("menuitem", { name: "Hide until tomorrow" }).click();` then expect the row gone and the heading to read `… · 1 hidden today` if asserted exactly (adapt `toHaveText(triageHeadingText)` only where the hidden row is in that section); `home-finance.spec.ts:127-134` viewer: replace the `/^Clear "/` check with `expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0)` (T11 flips the Worklist heading assertion); `paging.spec.ts` case 9: expect `workRepairsSection.getByText(/Showing 50 of 50\+ ·/)` and a `See all` link with `href` `/inventory?status=DEFECTIVE`.

- [ ] **Step 7: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/direct-lifecycle.spec.ts e2e/home-finance.spec.ts e2e/paging.spec.ts e2e/oversight.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 8: Commit**

```bash
git rm src/components/home/dismiss-button.tsx
git add src/components/home/work-row-menu.tsx src/components/home/hidden-rows.tsx src/components/home/work-summary.tsx src/components/home/worklist.tsx src/server/modules/home/actions.ts "src/app/(app)/inventory/work/page.tsx" src/components/ui/toast.tsx e2e/direct-lifecycle.spec.ts e2e/home-finance.spec.ts e2e/paging.spec.ts
git commit -m "feat(worklist): a row menu with Hide until tomorrow and Undo, hidden counts, section chips and cap lines that lead to the rest (Phase 32 T10)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The Worklist badge and Home (spec §5.3, §5.4)

**Files:**
- Modify: `src/lib/workspaces.ts`, `src/lib/worklist.ts` + `src/lib/worklist.test.ts` (`ageDays`, `workHeadline`), `src/server/modules/home/queries.ts` (`worklistCount`, `ageDays`), `src/components/shell/nav-list.tsx`, `src/components/shell/sidebar.tsx`, `src/components/shell/topbar.tsx` (and the mobile nav it renders), `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`
- Adapt e2e: `home-finance.spec.ts:50-65` (drop `"Jump to"`), `:127-134` (viewer Worklist heading now visible), `:333-345` (delete the dead `Jump to` assertion).

**Interfaces:**
- Consumes (T2/T9): `activeDismissals`, `todayStamp`, `hireWorkRows`, `LOAN_DUE_SOON_DAYS`, `isApprover`.
- Produces: `worklistCount(userId: string, role: Role, now?: Date): Promise<number>`; `NavBadges = { approvals: ApprovalsBadge; worklist: number }` passed to `NavList`.

- [ ] **Step 1: `NavItem.badge`** in `workspaces.ts`: `badge?: "approvals" | "worklist";` and the IT Tracking item `{ label: "Worklist", href: "/inventory/work", badge: "worklist" }`.

- [ ] **Step 2: `worklistCount` (plan P-9)** in `home/queries.ts`:

```ts
/** The Worklist nav badge (spec §5.3): every row the worklist shows, minus today's hidden ones, uncapped. */
export async function worklistCount(userId: string, role: Role, now: Date = new Date()): Promise<number> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
    select: { value: true },
  });
  const hidden = activeDismissals(pref?.value, todayStamp(now));
  const hiddenIds = (section: WorkSectionId) =>
    [...hidden].filter((k) => k.startsWith(`${section}:`)).map((k) => k.slice(section.length + 1));
  const scope = approvalClassWhere(role);
  const soonEdge = dayFromISO(addDays(localDateISO(now), LOAN_DUE_SOON_DAYS + 1));
  const [triage, repairs, check, loans, missing, orphaned, breached, failed, leavers, hires] = await Promise.all([
    prisma.asset.count({ where: { cls: "IT", returnedAt: { not: null }, id: { notIn: hiddenIds("triage") } } }),
    prisma.asset.count({ where: { cls: "IT", status: "DEFECTIVE", id: { notIn: hiddenIds("repairs") } } }),
    prisma.asset.count({ where: { cls: "IT", itVerifiedAt: null, id: { notIn: hiddenIds("check") } } }),
    prisma.asset.count({
      where: { cls: "IT", status: "TEMPORARY", id: { notIn: hiddenIds("loans") }, OR: [{ loanDueAt: null }, { loanDueAt: { lt: soonEdge } }] },
    }),
    prisma.asset.count({ where: { cls: "IT", status: "MISSING", id: { notIn: hiddenIds("missing") } } }),
    prisma.asset.count({ where: { cls: "IT", status: "DEPLOYED", assigneeId: null, id: { notIn: hiddenIds("missing") } } }),
    prisma.approval.count({ where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now }, id: { notIn: hiddenIds("queue") } }, scope] } }),
    prisma.approval.count({ where: { AND: [{ state: "EXECUTION_FAILED" }, { id: { notIn: hiddenIds("queue") } }, scope] } }),
    prisma.employee.count({ where: { employment: "OFFBOARDING", id: { notIn: hiddenIds("queue") } } }),
    hireWorkRows(now),
  ]);
  const hireCount = hires.rows.filter((r) => !hidden.has(r.key)).length;
  return triage + repairs + check + loans + missing + orphaned + breached + failed + leavers + hireCount;
}
```

Import `dayFromISO`, `addDays` from `@/lib/deadlines` and `localDateISO` from `@/lib/format`. The loan edge must agree with `loanRow` (a row appears while `daysUntil ≤ 7`): verify with one focused check that a loan due exactly 7 Manila days out is counted and one due 8 days out is not — if `dayFromISO` is not Manila midnight, derive the edge the same way `attentionWhere` does in `src/lib/inventory-attention.ts` and note it in the report.

- [ ] **Step 3: Layout and nav.** In `(app)/layout.tsx`:

```ts
const [approvals, worklist] = await Promise.all([
  getApprovalsBadge(user.role),
  user.role === "admin" || user.role === "it_staff" ? worklistCount(user.id, user.role) : Promise.resolve(0),
]);
const badges = { approvals, worklist };
```

Pass `badges` through `Sidebar` / `Topbar` / mobile nav into `NavList` (rename the prop `badge` → `badges: NavBadges`, type exported from `nav-list.tsx`). In `NavList`, keep the approvals branch reading `badges.approvals` and add:

```tsx
{item.badge === "worklist" && badges.worklist > 0 && (
  <span
    className="inline-flex items-center rounded-(--radius-ctl) border border-border bg-border-faint px-1.5 font-mono text-[10px] text-fg-secondary"
    aria-label={`${badges.worklist} waiting on the worklist`}
  >
    {badges.worklist}
  </span>
)}
```

- [ ] **Step 4: Home.** In the IT/admin/viewer branch of `(app)/page.tsx`:
  - Run the worklist for every role in the branch: `safeSection("Worklist", () => worklist(user.id, user.role, { limit: 2, excludeOwnClaims: !isViewer }))` and render the Worklist card for everyone, with `canAct={!isViewer}` (plan P-10).
  - The Worklist card's headline, above the groups, from `workHeadline(groups)` (below): `{n} waiting · oldest {d} d · {k} past SLA`, parts omitted when zero; and `Open worklist` as the card's header action linking `/inventory/work` (if `SectionCard` has no actions slot, add an optional `action` prop). To make "oldest" honest, `WorkRow` gains `ageDays?: number`, set in `worklist()` wherever a row already computes a `daysSince` (triage `back {n} d`, check `{n} d waiting`, hires `started {n} d ago`, repairs `down {n} d`, missing `custody lost {n} d ago`, orphaned, failed approvals `execution failed {n} d ago`, breached approvals `daysSince(slaAt)`). Add to `src/lib/worklist.ts` with its test:

```ts
/** Home's Worklist headline (spec §5.4): parts omitted when zero. */
export function workHeadline(groups: WorkGroup[]): string {
  const n = groups.reduce((s, g) => s + g.total, 0);
  if (n === 0) return "";
  const oldest = Math.max(0, ...groups.flatMap((g) => g.rows.map((r) => r.ageDays ?? 0)));
  const late = pastSlaCount(groups);
  return [`${n} waiting`, oldest > 0 ? `oldest ${oldest} d` : null, late > 0 ? `${late} past SLA` : null].filter(Boolean).join(" · ");
}
```

```ts
describe("workHeadline", () => {
  const row = (over: Partial<WorkRow>): WorkRow => ({ key: "k", section: "triage", title: "", meta: "", href: "/", action: "Open", severity: 0, ...over });
  it("counts, the oldest age and past-SLA rows, dropping zero parts", () => {
    const groups = groupWork([
      row({ key: "triage:1", ageDays: 4 }),
      row({ key: "queue:2", section: "queue", rank: 0, ageDays: 9 }),
    ], new Set(), {});
    expect(workHeadline(groups)).toBe("2 waiting · oldest 9 d · 1 past SLA");
    expect(workHeadline(groupWork([row({ key: "triage:1" })], new Set(), {}))).toBe("1 waiting");
    expect(workHeadline([])).toBe("");
  });
});
```

  Note Home's groups are capped at 2 rows per section, so "oldest" reads the oldest of the rows shown — each section sorts worst (usually oldest) first, which is the intent.
  - "Claimed by you" renders only when `isApprover(user.role)`; when empty it is one muted line `You hold no claims.` directly under the Worklist card (no card of its own).
  - Remove the IT branch's `Jump to` card and its `JumpTo` import only if no other branch uses it (purchasing and finance keep theirs — plan P-11).

- [ ] **Step 5: Adapt pins** — `home-finance.spec.ts:50-65`: the heading array drops `"Jump to"` (and `"Claimed by you"` if the IT user in that case holds no claim — it becomes a line, not a heading: assert accordingly); `:127-134` viewer: `expect(page.getByRole("heading", { name: "Worklist", level: 2 })).toBeVisible()` and no `Actions for` buttons; `:333-345`: delete the `Jump to` `toHaveCount(0)` line. `oversight.spec.ts` case 6 (admin, holds APR-2040) keeps the Claimed-by-you card — re-verify.

- [ ] **Step 6: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/home-finance.spec.ts e2e/oversight.spec.ts e2e/direct-lifecycle.spec.ts e2e/auth-shell.spec.ts e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workspaces.ts src/lib/worklist.ts src/lib/worklist.test.ts src/server/modules/home/queries.ts src/components/shell "src/app/(app)/layout.tsx" "src/app/(app)/page.tsx" src/components/home e2e/home-finance.spec.ts e2e/oversight.spec.ts
git commit -m "feat(home): a Worklist count badge, a headline on IT's Worklist card, the viewer's read-only worklist, claims only for approvers, no Jump to (Phase 32 T11)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The scan card `/inventory/scan/[tag]` (spec §6)

**Files:**
- Create: `src/components/inventory/scan-action.tsx`, `src/components/inventory/scan-retype.tsx`
- Modify: `src/app/(app)/inventory/scan/[tag]/page.tsx`
- Adapt e2e: `labels.spec.ts:285-293` (make the `Open full record` assertion tolerant: `.or(page.getByRole("button", …))`), re-verify `department-owned.spec.ts:356-363`.

**Interfaces:**
- Consumes: `recordPrimary`, `RecordState` (`@/lib/record-actions`); `attentionOf` (`@/lib/inventory-attention`); `TriageDialog`, `ItCheckDialog`, `ReturnDialog`, `AssignDialog`; `HoldPill`, `DuePill`; `STATUS_LABEL`; `activeEmployeeOptions`; `isDirectLifecycle`, `canManageClass`.
- Produces: `ScanAction({ action, asset, holder, direct, employees })` where `action: "triage" | "mark-checked" | "return" | "assign"`.

- [ ] **Step 1: Query.** Widen the `select` with `returnedAt`, `loanDueAt`, `itVerifiedAt`, `financeConfirmedAt`, `financeReturnedAt`, the open approval (`approvals: { where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } }, select: { id: true, refNo: true }, take: 1 }` — use the same relation/filter the record layout uses for `pending`), and the active hold (`reservations: { where: { state: "ACTIVE" }, select: { expiresAt: true, employee: { select: { id: true, name: true } } }, take: 1 }` — or call `activeHoldFor(asset.id)` as the record layout does). Keep the two early-return branches (`!asset`, wrong class) verbatim.

- [ ] **Step 2: State and action (plan P-14).**

```ts
const state: RecordState = {
  cls: asset.cls, status: asset.status, hasHolder: !!asset.assignee,
  returnedAt: asset.returnedAt, itVerifiedAt: asset.itVerifiedAt,
  financeConfirmedAt: asset.financeConfirmedAt, financeReturnedAt: asset.financeReturnedAt,
  pending: !!pending, held: !!hold,
};
const primary = recordPrimary(state, user.role);
const SCAN_ACTIONS = ["triage", "mark-checked", "return", "assign"] as const;
const action = SCAN_ACTIONS.find((a) => a === primary) ?? null;
const attention = attentionOf({
  cls: asset.cls, status: asset.status, returnedAt: asset.returnedAt, loanDueAt: asset.loanDueAt,
  pendingRef: pending?.refNo ?? null, itVerifiedAt: asset.itVerifiedAt,
}, new Date());
```

- [ ] **Step 3: `scan-action.tsx`:**

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { TriageDialog } from "@/components/inventory/triage-control";
import { ItCheckDialog } from "@/components/inventory/it-check";
import { AssignDialog, ReturnDialog } from "@/components/inventory/holder-control";

const LABEL = { triage: "Triage…", "mark-checked": "Mark checked", return: "Return…", assign: "Assign…" } as const;

/** Spec §6: the state's main action, full width and at least 44 px, opening the record's own control. */
export function ScanAction({ action, asset, holder, direct, employees }: {
  action: keyof typeof LABEL;
  asset: { id: string; tag: string; model: string };
  holder: { id: string; name: string } | null;
  direct: boolean;
  employees: ComboOption[];
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button variant="primary" size="lg" className="min-h-11 w-full" onClick={() => setOpen(true)}>{LABEL[action]}</Button>
      {action === "triage" && <TriageDialog open={open} onClose={close} asset={asset} />}
      {action === "mark-checked" && <ItCheckDialog open={open} onClose={close} asset={asset} />}
      {action === "return" && holder && <ReturnDialog open={open} onClose={close} asset={asset} holder={holder} direct={direct} />}
      {action === "assign" && <AssignDialog open={open} onClose={close} asset={asset} direct={direct} employees={employees} />}
    </>
  );
}
```

(`Button` must accept `className`; if it does not, wrap it in a `div className="w-full [&>button]:w-full [&>button]:min-h-11"`.)

- [ ] **Step 4: The page body.** Below the details list:
  - Leaver line when `asset.assignee?.employment === "OFFBOARDING"`: `<Link href={\`/offboarding/${asset.assignee.id}?step=collect\`} className="text-accent">{asset.assignee.name} is leaving · collect it in the offboarding wizard →</Link>` in the accent tone.
  - The attention line `attention?.label`; `HoldPill` when `hold` (`expiresAt`, `today = localDateISO()`); `DuePill` when `asset.status === "TEMPORARY" && asset.loanDueAt`.
  - Pending approval: the house banner linking `/approvals/{pending.id}` (no action button).
  - Status through `STATUS_LABEL`; the holder's name links `/employees/{id}` when `canManageClass(user.role, "IT") || user.role === "purchasing_staff"` (roles that can see employees — use the app's existing employee-visibility predicate if one exists).
  - `{action && <ScanAction … />}` then `Open full record` as a full-width secondary `ButtonLink` (min-h-11).
  - `employees` = `action === "assign" ? await activeEmployeeOptions() : []`; `direct = isDirectLifecycle(user.role, asset.cls)`.
  - Cost / vendor / purchase data stay absent.

- [ ] **Step 5: Unknown tag** — `scan-retype.tsx` (client): a labelled input (`Tag`, autofocus) whose submit navigates to `/inventory/scan/{value}` (trimmed, upper-cased), plus a link `Search inventory for "{tag}"` → `/inventory?q={encodeURIComponent(tag)}`. Render both under the existing unknown-tag banner (its text unchanged).

- [ ] **Step 6: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/labels.spec.ts e2e/department-owned.spec.ts e2e/scanner.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory/scan-action.tsx src/components/inventory/scan-retype.tsx "src/app/(app)/inventory/scan/[tag]/page.tsx" e2e/labels.spec.ts
git commit -m "feat(scan): the scan card offers IT the state's main action, flags a leaver's device and attention, and recovers from a misread tag (Phase 32 T12)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The reservations hand-over (spec §7)

**Files:**
- Modify: `src/components/inventory/release-hold-button.tsx` (extract `ReleaseHoldDialog`), `src/components/reservations/holds-table.tsx`, `src/app/(app)/reservations/page.tsx` (pass `employees`, `direct`, `role`)
- Adapt e2e: `holds.spec.ts:397-416` (the `/reservations` row's Release moves into the menu; its dialog title gains model and person — plan P-12), `:519-575` (viewer: no `Actions for` Release item).

**Interfaces:**
- Consumes: `AssignDialog` (`heldFor` preset), `Menu`, `activeEmployeeOptions`, `isDirectLifecycle`.
- Produces: `ReleaseHoldDialog({ open, onClose, reservationId, tag, model?, holderName? })`.

- [ ] **Step 1: Extract the dialog.** Move `ReleaseHoldButton`'s `Dialog`, its state and `submit` into an exported controlled `ReleaseHoldDialog`:

```tsx
export function ReleaseHoldDialog({ open, onClose, reservationId, tag, model, holderName }: {
  open: boolean; onClose: () => void; reservationId: string; tag: string; model?: string; holderName?: string;
}) {
  // …the existing state, submit (releaseHold) and body, unchanged…
  const title = model && holderName ? `Release the hold on ${tag} · ${model} for ${holderName}?` : `Release the hold on ${tag}?`;
  // <Dialog open={open} onClose={onClose} title={title} footer={…Cancel / Release…}>
}
```

`ReleaseHoldButton` keeps its props and renders its button + `<ReleaseHoldDialog open={open} onClose={close} reservationId={reservationId} tag={tag} />` (no model/name → the old title at the three other call sites).

- [ ] **Step 2: Row menu.** In `holds-table.tsx`, replace the last column's inline `ReleaseHoldButton` with a menu cell (the `inventory-table.tsx` pattern: `onClick={(e) => e.stopPropagation()}` on the `Td`):

```tsx
const items: MenuItem[] = [];
if (canAct && r.state === "ACTIVE") {
  items.push({ label: `Assign to ${r.employeeName}…`, onSelect: () => setDialog({ kind: "assign", row: r }) });
  items.push({ label: "Release…", onSelect: () => setDialog({ kind: "release", row: r }) });
}
items.push({ label: "Open record", onSelect: () => router.push(`/inventory/${r.assetId}`) });
items.push({ label: `Open ${r.employeeName}'s profile`, onSelect: () => router.push(`/employees/${r.employeeId}`) });
// <Menu align="end" items={items} trigger={(p) => <IconButton {...p} aria-label={`Actions for ${r.tag}`}>⋯</IconButton>} />
```

One dialog state for the table (`useState<{ kind: "assign" | "release"; row: ReservationRow } | null>`), rendering below the table:

```tsx
{dialog?.kind === "assign" && (
  <AssignDialog
    open onClose={() => setDialog(null)}
    asset={{ id: dialog.row.assetId, tag: dialog.row.tag, model: dialog.row.model }}
    direct={direct} employees={employees}
    heldFor={{ id: dialog.row.employeeId, name: dialog.row.employeeName }}
  />
)}
{dialog?.kind === "release" && (
  <ReleaseHoldDialog
    open onClose={() => setDialog(null)}
    reservationId={dialog.row.id} tag={dialog.row.tag} model={dialog.row.model} holderName={dialog.row.employeeName}
  />
)}
```

(Check `AssignDialog`'s `heldFor` shape in the facts file §4.6 and pass what it expects; it presets the assignee.) The column header becomes an empty `Th` with `aria-label="Row actions"`. `canAct` replaces `canRelease` (same predicate: `isDirectLifecycle(user.role, "IT")`); viewers get Open record and Open profile only.

- [ ] **Step 3: Page.** `/reservations` passes `canAct`, `direct = isDirectLifecycle(user.role, "IT")`, and `employees = canAct ? await activeEmployeeOptions() : []`.

- [ ] **Step 4: Adapt pins** — `holds.spec.ts` case 6's `/reservations` part: `await listRow.getByRole("button", { name: "Actions for BR-MN-0911" }).click(); await page.getByRole("menuitem", { name: "Release…" }).click();` and the dialog name `Release the hold on BR-MN-0911 · {model} for {name}?` (read the model and person from the fixture the case builds). The profile-area Release in the same case keeps the old title. Case 9's viewer check additionally asserts the menu (if opened) has no `Release…` item.

- [ ] **Step 5: Verify** — tsc, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/holds.spec.ts e2e/custody.spec.ts --workers=1 --global-timeout=540000` → pass. Port free.

- [ ] **Step 6: Commit**

```bash
git add src/components/inventory/release-hold-button.tsx src/components/reservations/holds-table.tsx "src/app/(app)/reservations/page.tsx" e2e/holds.spec.ts
git commit -m "feat(reservations): each hold row hands the spare to its person, Release moves into the row menu and names who the hold was for (Phase 32 T13)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The phase's own e2e, the battery, the docs

**Files:**
- Create: `e2e/it-work-ux.spec.ts`
- Modify: `docs/HANDOVER.md` (a (y) block; §0 item 9's chunk list adds the new file to E1), `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md` (Phase 33's scope from spec §2), the spec's Status line, this plan's D-block.

- [ ] **Step 1: Write `e2e/it-work-ux.spec.ts`** — house shape (copy `login`, `expectNoSeriousAxe`, `waitForHydration` from `e2e/it-nav.spec.ts` as `e2e/leftovers.spec.ts` does; `beforeAll` runs `npm run db:seed`; each case builds its own runtime fixtures with Prisma and restores mutable fields in `finally`; never delete audit rows). Cases (spec §11), each independent:
  1. The queue opens in Attention order: with a second leaver created at runtime (OFFBOARDING, due in 10 days, holding nothing, `m365Status: "inactive"`) Dennis (2 d overdue) is the first row; his row's action is `Collect 3 items`; the count line's `1 overdue` link lands on `due=overdue`.
  2. The wizard opens on Collect without `?step=` (Dennis has undecided items); the header's primary is absent on Collect (plan P-3) and `More actions` lists Employee record / Farewell report / Export sheet.
  3. Mark the rest as Returned: open the dialog, switch BR-PH-0312 to Missing with reason `lost on site`, file 3 decisions; toast `3 decisions filed`; the Collect progress reads `3 of 3 decided`.
  4. The client reason error: on one card pick Defective, leave the reason empty, Confirm → the reason error shows and the reason field is focused, with no toast.
  5. Accounts is reachable while items are undecided (step bar link), and choosing `Never had an account` over `offboarding` opens `Clear Dennis Ong's Microsoft 365 status? …` and `Clear status` saves it.
  6. Finish checklist: with an EXECUTION_FAILED `lifecycle_return` created at runtime on a held item, Finish shows `Requests · {refNo} failed to execute` and no `Complete offboarding` button; after rejecting/removing the blocker (update the fixture's state back) and deciding everything with M365 inactive, `Complete offboarding` appears; completing shows `Dennis Ong offboarded · 3 decisions · …` with `Print farewell report` and `Next leaver →` (the runtime second leaver).
  7. The farewell report: Back control present; mid-way it reads `DRAFT — 3 items undecided` and lists `Still to decide`.
  8. A worklist `Triage…` in place: set `returnedAt` on a spare at runtime; on `/inventory/work` the row's `Triage…` opens `Triage {tag} · {model}`; `Save decision` → toast `{tag} triaged · Keep as spare` and the row leaves.
  9. Hide until tomorrow with Undo: hide a Loans row via `Actions for …` → gone, heading `· 1 hidden today`; `Undo` in the toast → back.
  10. The Worklist badge: `nav` link `Worklist` carries a count equal to the rows the page lists.
  11. A viewer's Home shows the Worklist card read-only: rows read `Open`, no `Actions for` buttons, no `Claimed by you` heading.
  12. The scan card for IT on BR-LT-0201 (DEPLOYED to Carlo Dizon): a `Return…` button; the dialog is `Return BR-LT-0201 …` (read the record's Return dialog title from `holder-control.tsx`); cancel.
  13. The scan card on one of Dennis's devices shows `Dennis Ong is leaving · collect it in the offboarding wizard →` linking `?step=collect`.
  14. A viewer's scan card has no action button and still shows `Open full record`.
  15. `/reservations`: `Actions for BR-MN-0910` → `Assign to Nina Robles…` opens the Assign dialog with Nina preset; Cancel (do not mutate the shared hold).
  Each screen case ends with `expectNoSeriousAxe(page)`.

- [ ] **Step 2: Run the new file** foreground: `E2E_PORT=3100 npx playwright test e2e/it-work-ux.spec.ts --workers=1 --global-timeout=540000` → all pass. Fix product code if a case exposes a bug (a test-only fix only for a genuine test error).

- [ ] **Step 3: `--list`** — `npx playwright test --list | tail -1` → 413 + the new cases + any added in adapted files, over **41 files**. Record the numbers.

- [ ] **Step 4: The battery** — the seven foreground chunks on the final tree (commands in `HANDOVER.md` §0 item 9), with `e2e/it-work-ux.spec.ts` appended to **E1**; `E2E_PORT=3100 --workers=1 --global-timeout=540000`; port free before, between and after; `npm run db:seed` last. Record per-chunk counts and times.

- [ ] **Step 5: Docs** — CRLF-safe Python edits anchored on exact, unique text (grep the windows first): HANDOVER (y) block (what shipped, the rulings, the battery, what ships knowingly, NOT merged / NOT pushed), §0 item 9's E1 line; PICKUP branch row + battery row + §4 item 1 (Phase 32 on top, Phase 31 becomes "Already landed"); HANDOVER-PENDING: Phase 32 status plus Phase 33's scope (spec §2's list and the audit's Q4 / Q8 / Q8b); the spec's Status line; this plan's D-block (every ruling the execution made).

- [ ] **Step 6: Commit**

```bash
git add e2e/it-work-ux.spec.ts docs/HANDOVER.md docs/PICKUP.md docs/HANDOVER-PENDING.md docs/superpowers/specs/2026-09-24-it-work-ux-design.md docs/superpowers/plans/2026-09-24-phase-32-it-work-ux.md
git commit -m "test(e2e)+docs: Phase 32 -- it-work-ux (15 cases, chunk E1); battery; (y) block; D-block" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** §3 rules → T1/T2; §4.1 → T4; §4.2 → T5; §4.3 → T6; §4.4 → T5 (reachability, Review cell) + T7; §4.5 → T8; §5.1 → T9; §5.2 → T10; §5.3 → T11; §5.4 → T11; §6 → T12; §7 → T13; §8 server → T3, T7 (`closeAccounts`), T10 (`undismissShiftRow`), T11 (`worklistCount`), T12 (scan query); §9 copy → the tasks that render it; §10 edge cases → T3 (`decideRemaining` refusals), T6 (Mark-the-rest hides below two, blocked items excluded), T7 (confirm, next leaver, Queue clear), T10 (next-day reappearance is `activeDismissals`' existing rule), T12, T13; §11 tests → T1/T2 units, every task's adapted pins, T14's new file and battery.
- **Placeholder scan:** none found; every code step shows code; UI edits to existing pages name the exact elements, copy and props, with the facts files holding the verbatim current code.
- **Type consistency:** `LeaverState` / `FailedReturn` / `offboardingNext` / `readiness` / `completionBlockers` / `offboardingAttention` / `orderByOffboardingAttention` / `defaultStep` (T1) are consumed with the same names in T3, T4, T5, T7, T9; `WorkControl` / `workActionLabel` / `groupWork().hidden` / `capLine` / `SEE_ALL_HREF` / `summaryChips` / `pastSlaCount` / `withoutDismissal` (T2) in T9–T11; `leaverStates` / `nextLeaver` / `decideRemaining` / `WizardData.failed` (T3) in T6, T7, T9; `hireWorkRows` (T9) in T11; `ReleaseHoldDialog` (T13) only in T13.

## D-block (decisions made during execution)

- **D-1 (R1)** — e2e pins broken by T1/T2's pure changes (the step label "Finish"; the worklist leaver link "Collect N items" with `?step=collect`) were adapted in T3, the first task that runs e2e — cost if wrong: two pin edits move between tasks.
- **D-2 (R2)** — `MarkRestDialog` resets its state only when it opens, so a partial refusal's inline messages survive `router.refresh()`; `MarkRestButton` also stays mounted while its dialog is open (T6 fix round) — cost if wrong: one effect dependency.
- **D-3 (R3)** — `decideRemaining` does not re-read the wizard to refuse an item whose live decision is EXECUTION_FAILED, exactly like `decideItem` — cost if wrong: an "already decided" refusal in `decideOne`.
- **D-4 (R4)** — the last two stale "Open wizard" queue pins were adapted in T5 — cost if wrong: none.
- **D-5 (R5)** — clearing a stored `inactive` to "Never had an account" needs no confirmation (not live, unlocks no gate) — cost if wrong: widen the predicate to `status !== null`.
- **D-6 (R6)** — plan P-7 corrected: the "reads DEPLOYED with no holder" worklist row keeps its Fix record link; `assignAsset` refuses non-SPARE assets — cost if wrong: a Change status control on that row later.
- **D-7 (R7)** — the badge's loan edge is `loanSoonEdge(now)` (Manila midnight, today + 8), the only edge that agrees with `loanRow` hour by hour — cost if wrong: one helper.
- **D-8 (R8)** — Purchasing staff see the scan card's action on their own class's records (it follows `recordPrimary`) — cost if wrong: gate on `cls === "IT"`.
- **D-9 (R9)** — Task 14 split: the e2e file first; `--list`, the battery and the docs after the final review's fix wave, on the final tree `e29e879` — cost if wrong: none.
- **D-10 (R10)** — battery chunk B re-run as-is after asset-classes case 21 timed out waiting for Validate (the same known flake as Phase 29's battery; this phase does not touch the import wizard) — cost if wrong: an intermittent import-wizard bug stays unfixed.
