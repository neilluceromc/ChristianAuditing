# Phase 25 — IT navigation sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the detours the IT audit found on the four daily paths: start an offboarding from the profile, make every request/asset/person reference a link, land a new hire on a "what next" banner, give the employees list sortable headers and row click, add the missing error page and loading skeletons, and close four small deferred items — with no migration.

**Architecture:** One new server action (`startOffboarding`) built exactly like `updateEmployee`; everything else is data-plus-markup edits on existing pages and components, two new tiny client components (`StartOffboardingDialog`, `EmployeesTable`), one new export route copied from the employees export, and Next.js `error.tsx` / `loading.tsx` / `not-found.tsx` files. Pure helpers (`derivedFilters`, `narrowedFacetCounts`, `Decision.id`, `OFFBOARDING_EXPORT_COLUMNS`, `DuePill.override`) land first so the UI tasks can run in parallel.

**Tech Stack:** Next.js 15 App Router (RSC + client components), Prisma 6 / PostgreSQL 16, Auth.js v5, zod 4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-09-21-it-navigation-sweep-design.md` (commits 9dd7ba5 + corrections 98a94a1). Facts the spec was ranked from: `.superpowers/sdd/phase-25-facts.md`; verbatim code the tasks below quote: `.superpowers/sdd/phase-25-plan-facts.md` (both scratch, git-ignored, at the repo root — copy them into the SDD workspace `briefs/` at execution time).

## Global Constraints

- No migration; `prisma/` untouched.
- Every server action: role guard (`actionRole(...)` → `forbidden()`) THEN `checkRate(user.id)` → `rateLimited(...)`; one `writeAudit` per domain write inside the same `prisma.$transaction`; `ActionResult` union returns (`ok`, `conflict`, `validationError`, `rateLimited`, `forbidden`).
- No `aria-label` near a form field may contain that field's label word (Playwright `getByLabel` substring-matches aria-label). New links carry visible text; the fleet-bar segments carry `sr-only` text, not an aria-label. Combobox heading rows stay `role="presentation"` (untouched here).
- A link inside a clickable row stops propagation; a row click is ignored while text is selected.
- Copy: "Start offboarding", "Complete by", "Start", "Open request", "Assign devices", "Accountability form", "Export", "Something went wrong", "Try again", "Home", "Not in the offboarding queue". `DuePill` override text for a completed case: `closed`.
- Dev only in a git worktree with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`, no `SEED_PASSWORD`. Never read or print `.env` (`grep -c "^NAME=" .env` only). Never touch the `inventory` database or port 3000; never seed staging.
- Dev server for a walk: `npm run dev -- -p 3100`, FOREGROUND; only ONE implementer walks at a time (the Browser pane is shared); after stopping: `netstat -ano | findstr :3100 | findstr LISTENING` prints nothing, else `taskkill /PID <pid> /T`.
- Playwright: FOREGROUND, `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`, one process at a time; nobody seeds (`npm run db:seed`) while another agent walks or tests.
- Docs are CRLF in the working tree; edits preserve line endings (Edit tool, or Python matching `\r\n`).
- Commits: `git add` new files before a pathspec commit; a wrong message is fixed with a NEW commit, never amend/reset; every message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Rulings, not stalls: the controller records every ruling in the SDD ledger and Task 8 copies them into this plan's D-block.

### File structure (who owns what)

| Area | Files | Task |
|---|---|---|
| Pure rules / primitives | `src/lib/offboarding-list.ts` (+tests), `src/lib/offboarding.ts` (+tests), `src/lib/export-columns.ts` (+tests), `src/components/ui/due-pill.tsx` | 1 |
| Start offboarding | `src/server/modules/employees/actions.ts`, `src/components/employees/start-offboarding-dialog.tsx` (new), `src/components/employees/loadout-view.tsx`, `src/app/(app)/employees/[id]/page.tsx` (header + `LoadoutView` props) | 2 |
| Offboarding cluster | `src/server/modules/offboarding/queries.ts`, `src/app/(app)/offboarding/[employeeId]/page.tsx`, `src/app/(app)/offboarding/page.tsx`, `src/app/(app)/offboarding/export/route.ts` (new), `src/app/(app)/offboarding/loading.tsx` (new), `src/app/(app)/offboarding/[employeeId]/not-found.tsx` (new) | 3 |
| Asset-side links + Home | `src/app/(app)/inventory/[id]/layout.tsx`, `src/app/(app)/inventory/[id]/timeline/page.tsx`, `src/server/modules/inventory/queries.ts`, `src/components/inventory/inventory-table.tsx`, `src/server/modules/home/queries.ts`, `src/components/home/fleet-bar.tsx` | 4 |
| Employee-side links + feeds + audit | `src/app/(app)/employees/[id]/timeline/page.tsx`, `src/app/(app)/employees/[id]/page.tsx` (Stat grid), `src/components/patterns/activity-feed.tsx`, `src/app/(app)/inventory/activity/page.tsx`, `src/app/(app)/employees/activity/page.tsx`, `src/server/modules/audit/queries.ts` | 5 |
| New hire, list parity, safety nets | `src/components/employees/employee-form.tsx`, `src/components/employees/employee-created-notice.tsx` (new), `src/app/(app)/employees/[id]/page.tsx` (`searchParams`, banner, anchor), `src/components/employees/employees-table.tsx` (new), `src/app/(app)/employees/page.tsx`, `src/app/(app)/error.tsx` (new), `src/app/(app)/reservations/loading.tsx`, `src/app/(app)/inventory/[id]/loading.tsx`, `src/app/(app)/employees/[id]/loading.tsx` (new) | 6 |
| E2E | `e2e/it-nav.spec.ts` (new) | 7 |
| Battery + docs | `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, this plan, the spec | 8 |

### Execution order (P-1)

Task 1 first. Then **Task 2 ‖ Task 3 ‖ Task 4** in parallel (disjoint files; Task 2 is the only one that walks a dev server). Then **Task 5**, then **Task 6** (both edit `employees/[id]/page.tsx`, which Task 2 also edits — sequential on purpose; Task 6 walks). Then Task 7 (sole Playwright user), then Task 8.

**P-2** `Decision.id` lands in Task 1 (`src/lib/offboarding.ts`), so Task 3 only consumes it. **P-3** `DuePill.override` lands in Task 1, so Task 3 only consumes it. **P-4** Task 5's profile edit is the Stat grid only; Task 6's profile edit is the signature, the banner and the `id="loadout"` wrapper — no overlapping lines. **P-5** Every e2e case that mutates data restores it in `finally`; the new spec file reseeds in `beforeAll` like `it-gaps.spec.ts`. **P-6** `--list` expected after Task 7: **353 tests / 34 files**; the new file joins battery chunk F.

---

### Task 1: Pure rules and shared primitives

**Files:**
- Modify: `src/lib/offboarding-list.ts` (append), `src/lib/offboarding-list.test.ts` (append), `src/lib/offboarding.ts:144-154` and `:214-222` (`Decision`, `decisionOf` return), `src/lib/offboarding.test.ts:132-135`, `src/lib/export-columns.ts` (append), `src/lib/export-columns.test.ts` (append), `src/components/ui/due-pill.tsx` (replace file).

**Interfaces:**
- Produces: `derivedFilters(state): { progressFilter: Progress[]; dueFilter: Due[] }`, `narrowedFacetCounts(rows, progressFilter, dueFilter, todayISO): { progress: Record<Progress, number>; due: Record<Due, number> }` (both in `@/lib/offboarding-list`); `Decision.id: string` (`@/lib/offboarding`); `OffboardingExportRow`, `OFFBOARDING_EXPORT_COLUMNS` (`@/lib/export-columns`); `DuePill` prop `override?: { tone: "neutral" | "accent"; text: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/offboarding-list.test.ts` (it already imports from `./offboarding-list`; extend that import with `derivedFilters, narrowedFacetCounts`):

```ts
describe("derivedFilters (Phase 25)", () => {
  it("keeps only the known progress and due values", () => {
    const state = { q: "", page: 1, sort: [], filters: { progress: ["open", "bogus"], due: ["overdue"] } };
    expect(derivedFilters(state)).toEqual({ progressFilter: ["open"], dueFilter: ["overdue"] });
  });
  it("is empty when neither facet is active", () => {
    expect(derivedFilters({ q: "", page: 1, sort: [], filters: {} })).toEqual({ progressFilter: [], dueFilter: [] });
  });
});

describe("narrowedFacetCounts (Phase 25, spec §6.4) — progress and due narrow each other", () => {
  const today = "2026-09-21";
  const rows = [
    { undecided: 2, dueAt: new Date("2026-09-10T00:00:00Z") }, // open · overdue
    { undecided: 0, dueAt: new Date("2026-09-10T00:00:00Z") }, // complete · overdue
    { undecided: 1, dueAt: new Date("2026-10-01T00:00:00Z") }, // open · on-track
    { undecided: 0, dueAt: null },                               // complete · on-track (no date)
  ];
  it("with no filters counts every row on both facets", () => {
    expect(narrowedFacetCounts(rows, [], [], today)).toEqual({
      progress: { open: 2, complete: 2 }, due: { overdue: 2, "on-track": 2 },
    });
  });
  it("an active due filter narrows the progress counts", () => {
    expect(narrowedFacetCounts(rows, [], ["overdue"], today).progress).toEqual({ open: 1, complete: 1 });
  });
  it("an active progress filter narrows the due counts", () => {
    expect(narrowedFacetCounts(rows, ["open"], [], today).due).toEqual({ overdue: 1, "on-track": 1 });
  });
  it("a facet's own filter never narrows its own counts", () => {
    const r = narrowedFacetCounts(rows, ["open"], ["overdue"], today);
    expect(r.progress).toEqual({ open: 1, complete: 1 });
    expect(r.due).toEqual({ overdue: 1, "on-track": 1 });
  });
});
```

Edit `src/lib/offboarding.test.ts:132-135` — the expected `Decision` literal gains `id: "a1",` as its first key (the `cand` helper's id):

```ts
    expect(decisionOf([cand({ toStatus: "MISSING", state: "CLAIMED", reason: "never handed back" })], { held: true })).toEqual({
      id: "a1", refNo: "APR-2100", outcome: "MISSING", state: "CLAIMED", reason: "never handed back", toStatus: "MISSING",
      decidedBy: null, decidedAt: null,
    });
```

Append to `src/lib/export-columns.test.ts` (extend its import with `OFFBOARDING_EXPORT_COLUMNS, type OffboardingExportRow`):

```ts
describe("OFFBOARDING_EXPORT_COLUMNS (Phase 25, spec §6.5)", () => {
  it("carries the seven queue columns in this exact order", () => {
    expect(OFFBOARDING_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Employee no", "Name", "Department", "Started", "Complete by", "Undecided", "Progress",
    ]);
  });
  it("writes dates as dates, the count as a number and progress as the word", () => {
    const row: OffboardingExportRow = {
      employeeNo: "EMP-0090", name: "Dennis Ong", department: "Operations",
      started: new Date("2026-09-18T00:00:00Z"), dueAt: null, undecided: 3, progress: "Open",
    };
    const cells = OFFBOARDING_EXPORT_COLUMNS.map((c) => c.cell(row));
    expect(cells[3]).toEqual({ value: row.started, type: Date, format: "yyyy-mm-dd" });
    expect(cells[4]).toEqual({ value: null, type: Date, format: "yyyy-mm-dd" });
    expect(cells[5]).toEqual({ value: 3, type: Number });
    expect(cells[6]).toEqual({ value: "Open" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/offboarding-list.test.ts src/lib/offboarding.test.ts src/lib/export-columns.test.ts`
Expected: FAIL — `derivedFilters`/`narrowedFacetCounts`/`OFFBOARDING_EXPORT_COLUMNS` are not exported; the `decisionOf` literal lacks `id`.

- [ ] **Step 3: Implement**

Append to `src/lib/offboarding-list.ts`:

```ts
/** Phase 25: the two in-memory facets' active values, parsed once for the list, the facet counts and the export. */
export function derivedFilters(state: ListState): { progressFilter: Progress[]; dueFilter: Due[] } {
  return {
    progressFilter: (state.filters.progress ?? []).filter((p): p is Progress => p === "open" || p === "complete"),
    dueFilter: (state.filters.due ?? []).filter((d): d is Due => d === "overdue" || d === "on-track"),
  };
}

/**
 * Phase 25 (spec §6.4): each derived facet's counts are tallied over the rows
 * that pass the OTHER derived facet's active filter, so `progress` and `due`
 * narrow each other the way SQL facets do. A facet never narrows itself
 * (its own options must stay pickable). `department` is not involved: it is
 * applied in SQL before these rows exist.
 */
export function narrowedFacetCounts<T extends { undecided: number; dueAt: Date | null }>(
  rows: T[], progressFilter: Progress[], dueFilter: Due[], todayISO: string,
): { progress: Record<Progress, number>; due: Record<Due, number> } {
  const progress: Record<Progress, number> = { open: 0, complete: 0 };
  const due: Record<Due, number> = { overdue: 0, "on-track": 0 };
  for (const r of rows) {
    const p = progressOf(r.undecided);
    const d = dueOf(r.dueAt, todayISO);
    if (dueFilter.length === 0 || dueFilter.includes(d)) progress[p] += 1;
    if (progressFilter.length === 0 || progressFilter.includes(p)) due[d] += 1;
  }
  return { progress, due };
}
```

`src/lib/offboarding.ts`: in `export interface Decision {` add as the first member `/** Phase 25: the winning approval's id, so the wizard can link the ref to /approvals/{id}. */ id: string;`. In `decisionOf`'s final `return {`, add `id: winner.id,` as the first line.

Append to `src/lib/export-columns.ts`:

```ts
/** Phase 25 (spec §6.5): one row of the offboarding queue export. */
export interface OffboardingExportRow {
  employeeNo: string; name: string; department: string;
  started: Date | null; dueAt: Date | null; undecided: number; progress: "Open" | "Complete";
}

export const OFFBOARDING_EXPORT_COLUMNS: XlsxColumn<OffboardingExportRow>[] = [
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.employeeNo }) },
  { label: "Name", width: 26, cell: (r) => ({ value: r.name }) },
  { label: "Department", width: 20, cell: (r) => ({ value: r.department }) },
  { label: "Started", width: 13, cell: (r) => ({ value: r.started, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Complete by", width: 13, cell: (r) => ({ value: r.dueAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Undecided", width: 11, cell: (r) => ({ value: r.undecided, type: Number }) },
  { label: "Progress", width: 11, cell: (r) => ({ value: r.progress }) },
];
```

Replace `src/components/ui/due-pill.tsx`:

```tsx
import { Pill } from "@/components/ui/pill";
import { fmtDate } from "@/lib/format";
import { dueStatus } from "@/lib/deadlines";

/**
 * Spec §0 decision 9 (Phase 23): two tones only; the text carries the distinction.
 * Phase 25 (spec §3.4): `override` replaces both tone and text for a case that is
 * neither overdue nor on track — a completed offboarding reads "closed".
 */
export function DuePill({
  dueAt, today, withDate = false, override,
}: {
  dueAt: Date; today: string; withDate?: boolean; override?: { tone: "neutral" | "accent"; text: string };
}) {
  const s = dueStatus(dueAt, today);
  return (
    <span className="inline-flex items-center gap-1.5">
      {withDate && <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(dueAt)}</span>}
      <Pill tone={override?.tone ?? s.tone}>{override?.text ?? s.text}</Pill>
    </span>
  );
}
```

- [ ] **Step 4: Run the tests and the whole suite**

Run: `npx vitest run src/lib/offboarding-list.test.ts src/lib/offboarding.test.ts src/lib/export-columns.test.ts` → PASS. Then `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (record files/tests; baseline 84 files / 1485 tests + the new cases).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(lib): Phase 25 pure rules -- derivedFilters and narrowedFacetCounts (progress/due narrow each other), Decision.id, OFFBOARDING_EXPORT_COLUMNS, DuePill override

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- src/lib/offboarding-list.ts src/lib/offboarding-list.test.ts src/lib/offboarding.ts src/lib/offboarding.test.ts src/lib/export-columns.ts src/lib/export-columns.test.ts src/components/ui/due-pill.tsx
```

---

### Task 2: Start offboarding from the profile

**Files:**
- Modify: `src/server/modules/employees/actions.ts` (append after `updateEmployee`, ~line 315), `src/app/(app)/employees/[id]/page.tsx` (imports; header `actions` at ~156-171; `LoadoutView` call at ~224-238), `src/components/employees/loadout-view.tsx` (props at 71-98; frozen banner at ~269-276; imports).
- Create: `src/components/employees/start-offboarding-dialog.tsx`.

**Interfaces:**
- Consumes: `actionRole`, `checkRate`, `writeAudit`, `conflict/forbidden/ok/rateLimited/validationError/zodFieldErrors`, `dateStr` (module-local at `actions.ts:227`), `dayFromISO`, `defaultOffboardingDue`, `minOffboardingDue` (`@/lib/deadlines`), `localDateISO` (`@/lib/format`), `useEmployeeRunner` (`./use-employee-runner`), `Dialog`, `FormField`, `Input`, `Button`, `Banner`, `RateLimitNotice`, `DuePill` (Task 1 shape, default tone).
- Produces: `startOffboarding(input: unknown): Promise<ActionResult<{ id: string }>>`; `StartOffboardingDialog` props `{ employeeId, employeeName, defaultDue, minDue }`; `LoadoutView` new props `dueAt: Date | null; today: string`.

- [ ] **Step 1: Server action**

Append to `src/server/modules/employees/actions.ts` (after `updateEmployee`'s closing brace; every import it needs is already at the top of the file):

```ts
const startOffboardingSchema = z.object({
  employeeId: z.string().min(1),
  offboardingDueAt: dateStr,
});

/**
 * Phase 25 (spec §3.1): the profile's "Start offboarding" button. A DIRECT
 * employee edit — exactly what the Edit form does when Employment is switched
 * to OFFBOARDING: same guard order, same date floor and message, same audit
 * vocabulary (`action: "update"`), same revalidations — so every surface that
 * already renders the Edit-form path renders this one identically.
 */
export async function startOffboarding(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = startOffboardingSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: d.employeeId } });
  if (!employee) return conflict("That employee no longer exists.");
  if (employee.employment !== "ACTIVE") {
    return conflict(`${employee.name} is already ${employee.employment.toLowerCase()}.`);
  }

  const today = localDateISO(new Date());
  if (d.offboardingDueAt < minOffboardingDue(today)) {
    return validationError({ offboardingDueAt: "Pick today or later" });
  }

  const now = new Date();
  const due = dayFromISO(d.offboardingDueAt);
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: employee.id },
      data: { employment: "OFFBOARDING", offboardingAt: now, offboardingDueAt: due },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employee.id,
      action: "update",
      diff: {
        employment: { from: employee.employment, to: "OFFBOARDING" },
        offboardingAt: { from: employee.offboardingAt, to: now },
        offboardingDueAt: { from: employee.offboardingDueAt, to: due },
      },
    });
  });
  revalidatePath(`/employees/${employee.id}`);
  revalidatePath("/employees");
  revalidatePath("/offboarding");
  revalidatePath("/offboarding/[employeeId]", "page");
  revalidatePath("/offboarding/[employeeId]/report", "page");
  revalidatePath("/inventory/work");
  revalidatePath("/");
  return ok({ id: employee.id });
}
```

- [ ] **Step 2: The dialog**

Create `src/components/employees/start-offboarding-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { startOffboarding } from "@/server/modules/employees/actions";
import { useEmployeeRunner } from "./use-employee-runner";

/**
 * Phase 25 (spec §3.2): the profile header's "Start offboarding" button — the
 * page renders it only for admin/it_staff on an ACTIVE employee. Complete-by is
 * prefilled with the Phase 23 default (five working days) and stays editable;
 * the server floor ("Pick today or later") is the rule, `min` a courtesy.
 * Success lands in the wizard; `useEmployeeRunner` owns the result ladder.
 */
export function StartOffboardingDialog({
  employeeId, employeeName, defaultDue, minDue,
}: {
  employeeId: string; employeeName: string; defaultDue: string; minDue: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState(defaultDue);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useEmployeeRunner(["offboardingDueAt"]);

  function openDialog() {
    reset();
    setDueAt(defaultDue);
    setOpen(true);
  }

  function submit() {
    run(
      () => startOffboarding({ employeeId, offboardingDueAt: dueAt }),
      "Offboarding started",
      { onOk: () => { setOpen(false); router.push(`/offboarding/${employeeId}`); }, refresh: false },
    );
  }

  return (
    <>
      <Button onClick={openDialog}>Start offboarding</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Start offboarding ${employeeName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Start</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p className="text-xs text-fg-muted">
            Freezes {employeeName}&apos;s equipment slots and opens the collection wizard.
          </p>
          <FormField label="Complete by" required error={fieldErrors.offboardingDueAt}>
            {(p) => (
              <Input
                id={p.id}
                type="date"
                min={minDue}
                autoFocus
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Profile header and LoadoutView**

`src/app/(app)/employees/[id]/page.tsx`:
- Imports: change `import { fmtDate, fmtMoney, fmtRelativeDays } from "@/lib/format";` to `import { fmtDate, fmtMoney, fmtRelativeDays, localDateISO } from "@/lib/format";`; add `import { defaultOffboardingDue, minOffboardingDue } from "@/lib/deadlines";` and `import { StartOffboardingDialog } from "@/components/employees/start-offboarding-dialog";`.
- Right after `if (!employee) notFound();` add `const today = localDateISO(new Date());`.
- In `actions`, between the `TransferDialog` conditional's closing `)}` and the `Edit` line, insert:

```tsx
            {canMutate && employee.employment === "ACTIVE" && (
              <StartOffboardingDialog
                employeeId={id}
                employeeName={employee.name}
                defaultDue={defaultOffboardingDue(today)}
                minDue={minOffboardingDue(today)}
              />
            )}
```
- In the `<LoadoutView` call add two props after `frozen={...}`: `dueAt={employee.employment === "OFFBOARDING" ? employee.offboardingDueAt : null}` and `today={today}`.

`src/components/employees/loadout-view.tsx`:
- Add `import { DuePill } from "@/components/ui/due-pill";`.
- Props: add `dueAt,` and `today,` to the destructuring and `/** Phase 25: the leaver's complete-by date (OFFBOARDING only; null otherwise) and the Asia/Manila today for the pill. */ dueAt: Date | null; today: string;` to the type.
- Frozen banner: replace its body so the pill leads:

```tsx
      {frozen && (
        <Banner tone="attention" title="Offboarding in progress — slots are frozen">
          {dueAt && (
            <span className="mr-2 inline-flex align-middle">
              <DuePill dueAt={dueAt} today={today} withDate />
            </span>
          )}
          No new assignments for a leaver.{" "}
          <Link href={`/offboarding/${employeeId}`} className="text-accent underline hover:text-accent-hover">
            Open the offboarding wizard
          </Link>{" "}
          to collect equipment back.
        </Banner>
      )}
```

- [ ] **Step 4: Verify**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` — clean. Then `npm run dev -- -p 3100` FOREGROUND and walk as IT (`it@thebackroomop.com`): `/employees` → Carlo Dizon (EMP-0099, ACTIVE, one laptop) → **Start offboarding** is present, the dialog's Complete-by is prefilled with today + five working days, Cancel closes it. Do NOT submit (Task 7 exercises the write and restores; a walk write would leave Carlo OFFBOARDING for every parallel task). Open Dennis Ong (EMP-0090, OFFBOARDING): no button; the frozen banner shows the date and an overdue pill. As viewer (`viewer@thebackroomop.com`): no button. Stop the server; port free.

- [ ] **Step 5: Commit**

```bash
git add src/components/employees/start-offboarding-dialog.tsx
git commit -m "feat(employees): Start offboarding from the profile -- startOffboarding action (direct edit, Phase 23 floor and default), confirm dialog with editable complete-by, due pill in the frozen loadout banner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- src/server/modules/employees/actions.ts src/components/employees/start-offboarding-dialog.tsx src/components/employees/loadout-view.tsx "src/app/(app)/employees/[id]/page.tsx"
```

---

### Task 3: Offboarding cluster — wizard links, closed pill, narrowing facets, export, skeleton, not-found

**Files:**
- Modify: `src/server/modules/offboarding/queries.ts` (`WizardItem.blockedBy` ~274-295; `blockers` select ~385-390; `openByAsset` ~419-421; `offboardingFacets` 179-213; `listOffboarding` 225-270; append `offboardingExportRows`), `src/app/(app)/offboarding/[employeeId]/page.tsx` (header 56-66; links at ~320, ~336, ~484), `src/app/(app)/offboarding/page.tsx` (`PageHeader` at ~47-50).
- Create: `src/app/(app)/offboarding/export/route.ts`, `src/app/(app)/offboarding/loading.tsx`, `src/app/(app)/offboarding/[employeeId]/not-found.tsx`.

**Interfaces:**
- Consumes (Task 1): `derivedFilters`, `narrowedFacetCounts`, `sortByUndecided`, `progressOf`, `dueOf` (`@/lib/offboarding-list`); `Decision.id`; `EXPORT_CAP`, `OFFBOARDING_EXPORT_COLUMNS`, `OffboardingExportRow` (`@/lib/export-columns`); `DuePill.override`.
- Produces: `offboardingExportRows(state): Promise<{ rows: OffboardingExportRow[] } | { over: number }>`; `WizardItem.blockedBy: { id: string; refNo: string; type: ApprovalType } | null`; route `GET /offboarding/export`.

- [ ] **Step 1: Queries**

In `src/server/modules/offboarding/queries.ts`:
1. Extend the `@/lib/offboarding-list` import with `derivedFilters, narrowedFacetCounts` (keep what is there), and add `import { EXPORT_CAP, type OffboardingExportRow } from "@/lib/export-columns";`.
2. `WizardItem`: `blockedBy: { id: string; refNo: string; type: ApprovalType } | null;`.
3. The `blockers` query select: `select: { id: true, refNo: true, type: true, assetId: true },`.
4. `openByAsset`: `.map((b) => [b.assetId!, { id: b.id, refNo: b.refNo, type: b.type }])`.
5. `offboardingFacets`: replace everything from `const today = localDateISO(new Date());` through the `return {` block's `progress`/`due` arrays with:

```ts
  const today = localDateISO(new Date());
  const { progressFilter, dueFilter } = derivedFilters(state);
  // Phase 25 (spec §6.4): each derived facet's counts are narrowed by the OTHER
  // derived facet's active filter (department is already in the SQL where).
  const counts = narrowedFacetCounts(derivedCandidates.map(toOffboardingRow), progressFilter, dueFilter, today);

  return {
    department: departments.map((d) => ({
      value: d.id, label: d.name, count: deptGroups.find((g) => g.departmentId === d.id)?._count ?? 0,
    })),
    progress: [
      { value: "open", label: "Open", count: counts.progress.open },
      { value: "complete", label: "Complete", count: counts.progress.complete },
    ],
    due: [
      { value: "overdue", label: "Overdue", count: counts.due.overdue },
      { value: "on-track", label: "On track", count: counts.due["on-track"] },
    ],
  };
```
6. `listOffboarding`: replace the two inline filter parsings with `const { progressFilter, dueFilter } = derivedFilters(state);` (behaviour unchanged).
7. Append:

```ts
/**
 * Phase 25 (spec §6.5): the queue as `/offboarding` shows it — same where,
 * same in-memory progress/due cut, same sort — unpaged, capped before any
 * row is loaded (same shape as `employeeExportRows`).
 */
export async function offboardingExportRows(
  state: ListState,
): Promise<{ rows: OffboardingExportRow[] } | { over: number }> {
  const where = buildOffboardingWhere(state);
  const total = await prisma.employee.count({ where });
  if (total > EXPORT_CAP) return { over: total };
  const orderBy = buildOffboardingOrderBy(state.sort);
  const candidates = await prisma.employee.findMany({
    where,
    orderBy: orderBy ?? [{ name: "asc" }, { employeeNo: "asc" }, { id: "asc" }],
    include: OFFBOARDING_INCLUDE,
  });
  const today = localDateISO(new Date());
  const { progressFilter, dueFilter } = derivedFilters(state);
  let rows = candidates.map(toOffboardingRow);
  if (progressFilter.length > 0) rows = rows.filter((r) => progressFilter.includes(progressOf(r.undecided)));
  if (dueFilter.length > 0) rows = rows.filter((r) => dueFilter.includes(dueOf(r.dueAt, today)));
  if (orderBy === null) rows = sortByUndecided(rows, state.sort.find((s) => s.key === "undecided")?.dir ?? "asc");
  return {
    rows: rows.map((r) => ({
      employeeNo: r.employeeNo, name: r.name, department: r.department,
      started: r.started, dueAt: r.dueAt, undecided: r.undecided,
      progress: progressOf(r.undecided) === "open" ? "Open" : "Complete",
    })),
  };
}
```

- [ ] **Step 2: Wizard page**

`src/app/(app)/offboarding/[employeeId]/page.tsx`:
- Header (line ~65): `? <DuePill dueAt={employee.dueAt} today={today} withDate override={employee.employment === "OFFBOARDED" ? { tone: "neutral", text: "closed" } : undefined} />`.
- Collect step decided ref (~320): `<Link href={`/approvals/${i.decision.id}`} className="text-accent hover:underline">{i.decision.refNo}</Link>`.
- Collect step blocked ref (~336): `<Link href={`/approvals/${i.blockedBy.id}`} className="font-mono text-accent hover:underline">`.
- Summary (~484): `<Link href={`/approvals/${i.decision.id}`} className="text-accent hover:underline">{i.decision.refNo}</Link>`.
- Leave the `items={items.map(...)}` scan-pool prop as it is.

- [ ] **Step 3: Export route, header button, skeleton, not-found**

Create `src/app/(app)/offboarding/export/route.ts`:

```ts
import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { OFFBOARDING_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { OFFBOARDING_LIST_CONFIG } from "@/lib/offboarding-list";
import { parseListState } from "@/lib/url-state";
import { offboardingExportRows } from "@/server/modules/offboarding/queries";

/** Phase 25 (spec §6.5): honours exactly what `/offboarding` shows — facets and sort — same shape as the employees export. */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, OFFBOARDING_LIST_CONFIG);

  const result = await offboardingExportRows(state);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(OFFBOARDING_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("offboarding", new Date()), buffer);
}
```

`src/app/(app)/offboarding/page.tsx` — the `PageHeader` (imports for `ButtonLink`, `serializeListState`, `OFFBOARDING_LIST_CONFIG` already exist):

```tsx
      <PageHeader
        title="Offboarding"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={<ButtonLink href={"/offboarding/export" + serializeListState(state, OFFBOARDING_LIST_CONFIG)}>Export</ButtonLink>}
      />
```

Create `src/app/(app)/offboarding/loading.tsx` (list shape; the queue table has 10 columns):

```tsx
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function OffboardingLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonRow key={i} columns={10} />
        ))}
      </div>
    </div>
  );
}
```

Create `src/app/(app)/offboarding/[employeeId]/not-found.tsx`:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function OffboardingNotFound() {
  return (
    <EmptyState
      title="Not in the offboarding queue"
      description="They may be active again, or the link is stale."
      actions={<ButtonLink href="/offboarding">Back to offboarding</ButtonLink>}
    />
  );
}
```

- [ ] **Step 4: Verify (no dev server — Task 2 owns the Browser pane)**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. Proof against `inventory_dev` with `npx tsx -e` (print results only): `offboardingExportRows(parseListState(new URLSearchParams(""), OFFBOARDING_LIST_CONFIG))` returns one row (Dennis Ong, Operations, undecided 3, progress "Open"); `listOffboarding` with `due=overdue` returns facets whose `progress` counts equal those with no filter for this seed (one row, overdue) and with `progress=complete` the `due` counts are both 0 — record the numbers. `getWizard(<Dennis id>)` returns items with `blockedBy === null` and `decision === null` (no seeded decisions), typed with `id` present.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/offboarding/export/route.ts" "src/app/(app)/offboarding/loading.tsx" "src/app/(app)/offboarding/[employeeId]/not-found.tsx"
git commit -m "feat(offboarding): wizard refs link to their request (blocker id, Decision.id), closed pill after completion, progress/due facets narrow each other, queue export, loading skeleton and not-found page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- src/server/modules/offboarding/queries.ts "src/app/(app)/offboarding/[employeeId]/page.tsx" "src/app/(app)/offboarding/page.tsx" "src/app/(app)/offboarding/export/route.ts" "src/app/(app)/offboarding/loading.tsx" "src/app/(app)/offboarding/[employeeId]/not-found.tsx"
```

---

### Task 4: Asset-side links and the Home fleet bar

**Files:**
- Modify: `src/app/(app)/inventory/[id]/layout.tsx:158-166`, `src/app/(app)/inventory/[id]/timeline/page.tsx:53-65` (+import), `src/server/modules/inventory/queries.ts:22-37` and `:76-102`, `src/components/inventory/inventory-table.tsx:216-230` (+import), `src/server/modules/home/queries.ts:354-363` and `:233-239` (+imports), `src/components/home/fleet-bar.tsx` (replace file).

**Interfaces:**
- Produces: `AssetRow.hold: { id: string; name: string } | null`; `FleetSlice.href: string`.

- [ ] **Step 1: Pending banner and asset timeline**

`inventory/[id]/layout.tsx` (already imports `Link`): the banner body becomes

```tsx
            Queued in the approval pipeline — until it executes, this asset still reads{" "}
            <span className="font-mono">{asset.status}</span> everywhere.{" "}
            <Link href={`/approvals/${pending.id}`} className="text-accent underline hover:text-accent-hover">Open request</Link>
```

`inventory/[id]/timeline/page.tsx`: add `import Link from "next/link";` and change the ref span to
`<Link href={`/approvals/${a.id}`} className="font-mono text-xs text-accent hover:underline">{a.refNo}</Link>`.

- [ ] **Step 2: HOLD pill**

`src/server/modules/inventory/queries.ts`: in `AssetRow`, `hold: { id: string; name: string } | null;` (keep the comment). In `toRow`'s parameter type: `reservations: Array<{ employee: { id: string; name: string } }>;` and the field:
`hold: a.reservations[0] ? { id: a.reservations[0].employee.id, name: a.reservations[0].employee.name } : null,`.
`LIST_INCLUDE` is unchanged (`include: { employee: true }` already carries `id`). Grep the file for other readers of `.hold` (`grep -n "\.hold" src -r`) and fix any that treat it as a string.

`src/components/inventory/inventory-table.tsx`: add `import Link from "next/link";` and replace the HOLD span:

```tsx
                        <span className="inline-flex items-center gap-1.5">
                          <Pill tone="accent">HOLD</Pill>
                          <span className="text-[11px] text-fg-muted">
                            for{" "}
                            <Link
                              href={`/employees/${row.hold.id}`}
                              className="text-accent hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.hold.name}
                            </Link>
                          </span>
                        </span>
```

- [ ] **Step 3: Fleet bar**

`src/server/modules/home/queries.ts`: add `import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";` and `import { parseListState, serializeListState, withFilter } from "@/lib/url-state";`. `FleetSlice` gains `/** Phase 25: the inventory filtered to this status — the same URL the status facet produces. */ href: string;`. In `fleet()`'s slice map:

```ts
    .map((g): FleetSlice => ({
      status: g.status,
      count: g._count._all,
      share: total === 0 ? 0 : Math.round((g._count._all / total) * 100),
      href: "/inventory" + serializeListState(
        withFilter(parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG), "status", [g.status]),
        INVENTORY_LIST_CONFIG,
      ),
    }))
```

Replace `src/components/home/fleet-bar.tsx`:

```tsx
import Link from "next/link";
import { StatusDot } from "@/components/ui/status";
import { statusFamily } from "@/lib/status";
import type { Fleet } from "@/server/modules/home/queries";

/**
 * One 12px stacked bar over every status, a legend with counts and shares, and
 * the line that decides something: does the spare pool cover next week's hires?
 * Phase 25 (spec §4 row 7): every segment and legend status is a link to the
 * inventory filtered to that status. The bar wrapper lost its `role="img"` —
 * a group of real links is not an image — and each segment names itself with
 * visually hidden text (no aria-label needed).
 */
export function FleetBar({ fleet }: { fleet: Fleet }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-border-faint">
        {fleet.slices.map((s) => (
          <Link
            key={s.status}
            href={s.href}
            title={`${s.status} ${s.count}`}
            className="block h-full hover:opacity-80"
            style={{
              width: `${s.share}%`,
              background: `var(--st-${statusFamily(s.status)}-dot)`,
              animation: "grow var(--dur-3) var(--ease-std)",
            }}
          >
            <span className="sr-only">{`${s.status}: ${s.count} assets`}</span>
          </Link>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {fleet.slices.map((s) => (
          <li key={s.status} className="inline-flex items-center gap-1.5">
            <StatusDot value={s.status} />
            <Link href={s.href} className="font-mono text-[10.5px] text-fg-secondary hover:underline">{s.status}</Link>
            <span className="font-mono text-[10.5px] font-semibold text-fg">{s.count}</span>
            <span className="font-mono text-[10px] text-fg-muted">{s.share}%</span>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-fg-secondary">{fleet.coverage}</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify (no dev server)**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. `npx tsx -e` proof: `fleet()` slices each carry `href` of the shape `/inventory?status=DEPLOYED`; `listAssets` for IT with no filters returns the BR-MN-0910 row with `hold: { id: <Nina Robles id>, name: "Nina Robles" }`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(inventory,home): asset banner and timeline link their request, HOLD pill links the holder, Home fleet bar segments and legend link to the filtered inventory

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- "src/app/(app)/inventory/[id]/layout.tsx" "src/app/(app)/inventory/[id]/timeline/page.tsx" src/server/modules/inventory/queries.ts src/components/inventory/inventory-table.tsx src/server/modules/home/queries.ts src/components/home/fleet-bar.tsx
```

---

### Task 5: Employee-side links, activity chips, audit department labels

**Files:**
- Modify: `src/app/(app)/employees/[id]/timeline/page.tsx:67-89` (+import), `src/app/(app)/employees/[id]/page.tsx:206-211` (Stat grid — and nothing else in that file), `src/components/patterns/activity-feed.tsx:5-32` (+import), `src/app/(app)/inventory/activity/page.tsx:37-47`, `src/app/(app)/employees/activity/page.tsx:36-46`, `src/server/modules/audit/queries.ts:29-30` and the label loop.

**Interfaces:**
- Produces: `ActivityItem.entity?: { label: string; href: string | null }`; `entityLabels` resolves `department`.

- [ ] **Step 1: Employee timeline links**

Add `import Link from "next/link";` and change the three spans:

```tsx
      title: (<>
        <Link href={`/approvals/${a.id}`} className="font-mono text-xs text-accent hover:underline">{a.refNo}</Link> · {APPROVAL_TYPE_LABEL[a.type]}
        {a.asset ? <> · <Link href={`/inventory/${a.asset.id}`} className="font-mono text-xs hover:underline">{a.asset.tag}</Link></> : null} —{" "}
        <span className="font-mono text-xs">{a.state}</span>
      </>),
```
and for holds: `hold on <Link href={`/inventory/${r.asset.id}`} className="font-mono text-xs text-accent hover:underline">{r.asset.tag}</Link> —{" "}`.

- [ ] **Step 2: Profile open requests**

`employees/[id]/page.tsx` — directly after the `Stat` grid's closing `</div>` (line ~211, still inside the same `CardBody`) insert (`Link` is already imported):

```tsx
              {openApprovals.length > 0 && (
                // Phase 25 (spec §4 row 6): the count above, the requests themselves here.
                <ul className="flex flex-wrap gap-x-2 gap-y-1 pt-2">
                  {[...openApprovals]
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .slice(0, 5)
                    .map((a) => (
                      <li key={a.id}>
                        <Link href={`/approvals/${a.id}`} className="font-mono text-xs text-accent hover:underline">{a.refNo}</Link>
                      </li>
                    ))}
                  {openApprovals.length > 5 && (
                    <li>
                      <Link href={`/employees/${id}/timeline`} className="text-xs text-fg-muted hover:underline">
                        +{openApprovals.length - 5} more
                      </Link>
                    </li>
                  )}
                </ul>
              )}
```

- [ ] **Step 3: Activity feed chip**

`src/components/patterns/activity-feed.tsx`: add `import Link from "next/link";`; `ActivityItem` gains
`/** Phase 25 (spec §4 row 4): the entity the sentence is about — a trailing link chip when it still exists. */ entity?: { label: string; href: string | null };`
and the `<li>` gains, right after the sentence span:

```tsx
          {item.entity?.href && (
            <Link href={item.entity.href} className="shrink-0 font-mono text-[10.5px] text-accent hover:underline">
              {item.entity.label}
            </Link>
          )}
```

Both callers (`inventory/activity/page.tsx`, `employees/activity/page.tsx`): the mapping becomes

```tsx
  const items: ActivityItem[] = entries.map((e) => {
    const entity = labels.get(`${e.entityType}:${e.entityId}`)!;
    return {
      id: e.id,
      sentence: auditSentence({ actorLabel: e.actorLabel, action: e.action, diff: e.diff, entityLabel: entity.label }),
      when: fmtDateTime(e.createdAt),
      actor: e.actorLabel,
      dotValue: actionDot(e.action),
      entity,
    };
  });
```

- [ ] **Step 4: Audit department labels**

`src/server/modules/audit/queries.ts` `entityLabels`: add `departments` to the destructuring (last), one more `Promise.all` entry
`byType.has("department") ? prisma.department.findMany({ where: { id: { in: [...byType.get("department")!] } }, select: { id: true, name: true } }) : [],`
and one more loop `for (const d of departments) map.set(`department:${d.id}`, { label: d.name, href: null });` (departments have no detail page — `reference-actions.ts` writes `entityType: "department"` on create/rename/delete).

- [ ] **Step 5: Verify (no dev server)**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. `npx tsx -e`: `entityLabels([{ entityType: "department", entityId: <Operations id> }])` → `{ label: "Operations", href: null }`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(employees,activity,audit): employee timeline refs and tags link out, profile lists its open requests, activity feeds carry an entity link chip, audit labels departments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- "src/app/(app)/employees/[id]/timeline/page.tsx" "src/app/(app)/employees/[id]/page.tsx" src/components/patterns/activity-feed.tsx "src/app/(app)/inventory/activity/page.tsx" "src/app/(app)/employees/activity/page.tsx" src/server/modules/audit/queries.ts
```

---

### Task 6: New-hire finish line, employees list parity, safety nets

**Files:**
- Modify: `src/components/employees/employee-form.tsx:95` and `:127-130`, `src/app/(app)/employees/[id]/page.tsx` (signature 24-28; `searchParams`; banner; `id="loadout"` wrapper around `LoadoutView`), `src/app/(app)/employees/page.tsx` (table region 66-124; `sortHrefs`).
- Create: `src/components/employees/employee-created-notice.tsx`, `src/components/employees/employees-table.tsx`, `src/app/(app)/error.tsx`, `src/app/(app)/reservations/loading.tsx`, `src/app/(app)/inventory/[id]/loading.tsx`, `src/app/(app)/employees/[id]/loading.tsx`.

**Interfaces:**
- Consumes: `EmployeeListRow` (`@/server/modules/employees/queries`), `toggleSort`, `toSearchParams` (`@/lib/url-state`), `Th` sort props (`sort`, `sortIndex`, `onSort`).
- Produces: `EmployeeCreatedNotice({ name, employeeNo, id })`; `EmployeesTable({ rows, state, sortHrefs })`.

- [ ] **Step 1: Created banner and focus**

`employee-form.tsx`: line 95 → `if (props.mode === "new") { router.push(`/employees/${res.data.id}?created=1`); return; }`; the Name `<Input` gains `autoFocus`.

Create `src/components/employees/employee-created-notice.tsx`:

```tsx
import { Banner } from "@/components/ui/banner";

/** Phase 25 (spec §5.1): the profile right after creation (`?created=1`) — the employee twin of the asset record's CreatedNotice. */
export function EmployeeCreatedNotice({ name, employeeNo, id }: { name: string; employeeNo: string; id: string }) {
  return (
    <Banner tone="settled" title={`${name} added · ${employeeNo}`}>
      <a className="text-accent underline" href="#loadout">Assign devices</a>
      {" · "}
      <a className="text-accent underline" href={`/employees/${id}/form`}>Accountability form</a>
    </Banner>
  );
}
```

`employees/[id]/page.tsx`: signature → `export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> })`; after `const { id } = await params;` add `const sp = toSearchParams(await searchParams);` (import `toSearchParams` from `@/lib/url-state`; import `EmployeeCreatedNotice`). First child of the returned fragment, before `<PageHeader`:
`{sp.get("created") === "1" && <EmployeeCreatedNotice name={employee.name} employeeNo={employee.employeeNo} id={id} />}`.
Wrap the `<LoadoutView …/>` call: `<div id="loadout" tabIndex={-1} className="outline-none"><LoadoutView … /></div>`.

- [ ] **Step 2: Employees table**

Create `src/components/employees/employees-table.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { ListState } from "@/lib/url-state";
import type { EmployeeListRow } from "@/server/modules/employees/queries";

/**
 * Phase 25 (spec §5.2): the employees table as a Client Component — sortable
 * headers driven by precomputed URLs (the inventory-table.tsx pattern) and a
 * whole-row click with Enter support. The name link stays for middle-click and
 * screen readers; `employeeNo` remains a URL-only sort key (it shares the
 * Employee column). Focus styling comes from the global :focus-visible rule.
 */
export function EmployeesTable({
  rows, state, sortHrefs,
}: {
  rows: EmployeeListRow[]; state: ListState; sortHrefs: Record<string, string>;
}) {
  const router = useRouter();

  function sortProps(key: string) {
    const idx = state.sort.findIndex((s) => s.key === key);
    return {
      onSort: () => router.push(sortHrefs[key]),
      sort: idx >= 0 ? state.sort[idx].dir : undefined,
      sortIndex: idx >= 0 && state.sort.length > 1 ? idx + 1 : undefined,
    };
  }

  function open(id: string) {
    if (window.getSelection()?.toString()) return; // a text selection is not a click
    router.push(`/employees/${id}`);
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th {...sortProps("name")}>Employee</Th>
          <Th width={110}>Department</Th>
          <Th width={110}>Employment</Th>
          <Th width={120}>M365</Th>
          <Th width={60} align="right">Items</Th>
          <Th width={100}>Loadout</Th>
          <Th width={110} {...sortProps("joinedAt")}>Joined</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr
            key={row.id}
            tabIndex={0}
            className="cursor-pointer"
            onClick={() => open(row.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); open(row.id); }
            }}
          >
            <Td>
              <Link
                href={`/employees/${row.id}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2.5 hover:underline"
              >
                <Avatar name={row.name} size="sm" />
                <span className="flex flex-col leading-tight">
                  <span className="text-[12.5px] font-medium text-fg">{row.name}</span>
                  <span className="font-mono text-[10px] text-fg-faint">{row.employeeNo} · {row.title}</span>
                </span>
              </Link>
            </Td>
            <Td>{row.department}</Td>
            <Td>
              <span className="inline-flex items-center gap-1.5">
                <StatusDot value={row.employment} ns="employment" />
                <span className="font-mono text-[10.5px]">{row.employment}</span>
              </span>
            </Td>
            <Td>
              <span className="inline-flex items-center gap-1.5">
                <StatusDot value={row.m365 ?? ""} />
                <span className="font-mono text-[10.5px] text-fg-muted">{row.m365 ?? "no sync yet"}</span>
              </span>
            </Td>
            <Td mono align="right">{row.items}</Td>
            <Td>
              {row.missingRequired === null ? (
                <span className="text-fg-faint">—</span>
              ) : row.missingRequired === 0 ? (
                <span className="font-mono text-[10.5px]" style={{ color: "var(--st-settled-dot)" }}>complete</span>
              ) : (
                <span className="font-mono text-[10.5px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                  {row.missingRequired} missing
                </span>
              )}
            </Td>
            <Td mono>{row.joined}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
```

`src/app/(app)/employees/page.tsx`: extend the `@/lib/url-state` import with `toggleSort`; import `EmployeesTable`; drop the now-unused `Link`, `Avatar`, `StatusDot`, `Table, TBody, Td, Th, THead, Tr` imports. After `hasFilters`, add

```tsx
  const sortHrefs: Record<string, string> = Object.fromEntries(
    EMPLOYEES_LIST_CONFIG.sortable.map((key) => [key, href({ ...state, sort: toggleSort(state.sort, key), page: 1 })]),
  );
```
and replace the whole `<Table>…</Table>` block with `<EmployeesTable rows={rows} state={state} sortHrefs={sortHrefs} />`. `Th` renders `aria-sort` and the arrow itself; the `EmployeeListRow` fields used are exactly the ones the old markup read.

- [ ] **Step 3: Error page and skeletons**

Create `src/app/(app)/error.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Phase 25 (spec §6.1): the one error boundary under the app shell — sidebar
 * and topbar stay mounted, only the page segment is replaced. The message is
 * never `error.message` (it may carry internals); the digest is enough to find
 * the server log line.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      description={error.digest ? `Reference ${error.digest}` : "The page hit an unexpected error."}
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/">Home</ButtonLink>
        </>
      }
    />
  );
}
```

Create `src/app/(app)/reservations/loading.tsx` — the `employees/loading.tsx` file verbatim with the component renamed `ReservationsLoading`, the toolbar row reduced to one `<Skeleton className="h-9 w-[260px]" />` (state tabs), and `columns={9}`.

Create `src/app/(app)/inventory/[id]/loading.tsx` and `src/app/(app)/employees/[id]/loading.tsx` (record shape; identical bodies, components `AssetRecordLoading` / `EmployeeRecordLoading`):

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function AssetRecordLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-6 w-56" />
        </div>
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-24" />)}
      </div>
      <div className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify with a walk (you are the only walker)**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. `npm run dev -- -p 3100` FOREGROUND, as admin (`admin@thebackroomop.com`): `/employees` — click **Joined** twice (URL gains `?sort=joinedAt` then `?sort=-joinedAt`, order flips, arrow shows); Tab to a row, Enter opens the profile; back, click a row's Department cell opens it; middle-click on a name still works. `/employees/new` — Name has focus on load; create "Walk Test" (EMP-9901, any department, joined today) → lands on `?created=1` with the banner; **Assign devices** scrolls to the loadout; then delete the walk employee with `npx tsx -e` (`prisma.auditEntry.deleteMany({ where: { entityType: "employee", entityId } })` then `prisma.employee.delete`) and say so in the report. Error page: temporarily add `throw new Error("walk");` as the first line of `src/app/dev/kitchen-sink/page.tsx`'s component, load `/dev/kitchen-sink`, confirm the "Something went wrong" page inside the shell with Try again and Home, then REVERT that line before committing (`git diff --stat` must not list the kitchen-sink page). Skeletons: DevTools network throttling on `/offboarding`, `/reservations`, an asset record tab and an employee timeline tab show the skeletons. Stop the server; port free.

- [ ] **Step 5: Commit**

```bash
git add src/components/employees/employee-created-notice.tsx src/components/employees/employees-table.tsx "src/app/(app)/error.tsx" "src/app/(app)/reservations/loading.tsx" "src/app/(app)/inventory/[id]/loading.tsx" "src/app/(app)/employees/[id]/loading.tsx"
git commit -m "feat(employees,shell): employee-created banner with next steps and first-field focus, sortable employees headers and whole-row click, app error page, loading skeletons for reservations and record tabs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- src/components/employees/employee-form.tsx src/components/employees/employee-created-notice.tsx src/components/employees/employees-table.tsx "src/app/(app)/employees/[id]/page.tsx" "src/app/(app)/employees/page.tsx" "src/app/(app)/error.tsx" "src/app/(app)/reservations/loading.tsx" "src/app/(app)/inventory/[id]/loading.tsx" "src/app/(app)/employees/[id]/loading.tsx"
```

---

### Task 7: End-to-end coverage — `e2e/it-nav.spec.ts`

**Files:**
- Create: `e2e/it-nav.spec.ts`.

**Interfaces:**
- Consumes everything Tasks 1–6 shipped. Seed fixtures (`prisma/seed.ts`): IT `it@thebackroomop.com`, admin `admin@thebackroomop.com`, viewer `viewer@thebackroomop.com`, password `SEED_PASSWORD` from `../prisma/fixtures`; Carlo Dizon `EMP-0099` (ACTIVE, holds BR-LT-0201, no approvals); Nina Robles `EMP-0097` (open `APR-2041` on BR-LT-0181; ACTIVE hold on spare BR-MN-0910); BR-LT-0148 carries pending `APR-2039`; Dennis Ong `EMP-0090` (OFFBOARDING, holds BR-LT-0166, BR-PH-0312, BR-HS-0510, no decided items); Faith Mercado `EMP-0093` (OFFBOARDED, no due date); departments "Operations" etc.; `RefTable` rename input `aria-label="Rename {name}"`.

- [ ] **Step 1: Write the spec file**

House rules: define `login`, `expectNoSeriousAxe`, `waitForHydration` locally (copy from `e2e/it-gaps.spec.ts:34-58`), reseed in `beforeAll`, `db.$disconnect()` in `afterAll`, mutate → `try` → restore in `finally`. Skeleton and the thirteen cases:

```ts
import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { defaultOffboardingDue } from "@/lib/deadlines";
import { localDateISO } from "@/lib/format";

const db = new PrismaClient();
test.beforeAll(() => { execSync("npm run db:seed", { timeout: 120_000 }); });
test.afterAll(async () => { await db.$disconnect(); });

// … login / expectNoSeriousAxe / waitForHydration copied verbatim from it-gaps.spec.ts …

const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

test.describe("it navigation sweep (Phase 25)", () => {
  test("1. Start offboarding: IT sees the button on an active employee, the dialog is prefilled, submit lands in the wizard and writes one audit row", async ({ page }) => {
    const carlo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0099" } });
    const before = await db.auditEntry.count({ where: { entityType: "employee", entityId: carlo.id } });
    try {
      await login(page, IT);
      await page.goto(`/employees/${carlo.id}`);
      await page.getByRole("button", { name: "Start offboarding" }).click();
      const dialog = page.getByRole("dialog", { name: `Start offboarding ${carlo.name}` });
      await waitForHydration(dialog);
      const today = localDateISO(new Date());
      await expect(dialog.getByLabel("Complete by")).toHaveValue(defaultOffboardingDue(today));
      await dialog.getByRole("button", { name: "Start", exact: true }).click();
      await page.waitForURL(`**/offboarding/${carlo.id}`);
      const after = await db.employee.findUniqueOrThrow({ where: { id: carlo.id } });
      expect(after.employment).toBe("OFFBOARDING");
      expect(after.offboardingDueAt && localDateISO(after.offboardingDueAt)).toBe(defaultOffboardingDue(today));
      expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: carlo.id } })).toBe(before + 1);
      await page.goto(`/employees/${carlo.id}`);
      await expect(page.getByRole("button", { name: "Start offboarding" })).toHaveCount(0);
      await expect(page.getByText("Offboarding in progress — slots are frozen")).toBeVisible();
      await expect(page.getByText(/due in \d+ d|due today/)).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await db.employee.update({ where: { id: carlo.id }, data: { employment: "ACTIVE", offboardingAt: null, offboardingDueAt: null } });
      const extra = await db.auditEntry.findMany({ where: { entityType: "employee", entityId: carlo.id }, orderBy: { createdAt: "desc" }, take: 1 });
      if (extra.length && (await db.auditEntry.count({ where: { entityType: "employee", entityId: carlo.id } })) > before) {
        await db.auditEntry.delete({ where: { id: extra[0].id } });
      }
    }
  });
```

Cases 2–13, each in the same shape (fixture → `try` → assertions → `finally`):
2. **Floor**: open the dialog on Carlo as IT, `await dialog.getByLabel("Complete by").evaluate((el) => el.removeAttribute("min"))`, fill `2026-01-01`, Start → the field error "Pick today or later" is visible; `db.employee` still `ACTIVE`. Also: as `VIEWER` the button has count 0.
3. **Wizard ref link**: insert `db.approval.create({ data: { refNo: "APR-9901", type: "lifecycle_return", state: "PENDING", priority: "NORMAL", slaAt: <tomorrow>, requestedById: <it user id from db.user where email IT>, assetId: <BR-HS-0510 id>, employeeId: <Dennis id>, payload: { to: { status: "SPARE" }, reason: "e2e" } } })`; as IT open `/offboarding/${dennis.id}?step=collect` (the collect step's URL as `WizardSteps` builds it — read `src/components/offboarding/wizard-steps.tsx` for the exact `step` value); the link with text `APR-9901` has `href` `/approvals/${created.id}`; click it → the approval page shows `APR-9901`. `finally`: delete the approval.
4. **Asset banner + timeline**: as IT open `/inventory/${BR-LT-0148 id}`; the banner's **Open request** link href is `/approvals/${APR-2039 id}`; `/inventory/${id}/timeline` → link `APR-2039` with the same href.
5. **Employee timeline**: Nina Robles' `/employees/${id}/timeline` → link `APR-2041` → `/approvals/${id}`; link `BR-LT-0181` → `/inventory/${asset id}`; hold row link `BR-MN-0910` → its asset.
6. **Activity chips**: `/inventory/activity` — the first row's chip (a link inside `ol li`) has an href starting with `/inventory/`; `/employees/activity` — first chip href starts with `/employees/`. Assert `page.locator("ol li a").first()`.
7. **HOLD pill**: `/inventory?q=BR-MN-0910` as IT → the row shows `HOLD` and a link `Nina Robles` with href `/employees/${nina.id}`; clicking it lands on her profile (not the asset).
8. **Open requests on the profile**: Nina's profile shows `Open requests` = 1 and a link `APR-2041` → `/approvals/${id}`.
9. **Fleet bar**: Home as IT → the legend link `DEPLOYED` has href `/inventory?status=DEPLOYED`; click → `/inventory?status=DEPLOYED`, every status cell reads `DEPLOYED` (assert via the rows' status text) and the Status facet shows one selected value.
10. **New hire**: as admin `/employees/new` — `page.getByLabel("Name")` is focused (`toBeFocused()`); fill EMP-9902 "Nav Test", department Operations, title "Tester", joined today; submit → URL ends `?created=1`; banner `Nav Test added · EMP-9902`; links **Assign devices** (`href="#loadout"`) and **Accountability form** (`/employees/${id}/form`). `finally`: `db.auditEntry.deleteMany({ where: { entityType: "employee", entityId } })`, `db.employee.delete`.
11. **Employees list**: `/employees` → click the `Joined` header button; URL contains `sort=joinedAt`; first row is the earliest joiner (Faith Mercado is OFFBOARDED and hidden; earliest visible = Dennis Ong EMP-0090, joined −1100 d); click again → `sort=-joinedAt`, first row = Nina Robles (−10 d). Focus the first row (`page.locator("tbody tr").first().focus()`), press Enter → URL `/employees/{id}`. Back; click the Department cell of the first row → the profile opens.
12. **Offboarding**: `/offboarding?due=overdue` — the Progress facet's counts (open the dropdown, read the option counts) equal those on `/offboarding` for this seed (1 overdue leaver); `/offboarding?progress=complete` → the Due facet's counts are both 0. Export: `Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export" }).click()])` → `suggestedFilename()` matches `/^offboarding-\d{4}-\d{2}-\d{2}\.xlsx$/`. Closed pill: `db.employee.update(Faith, { offboardingDueAt: <a past day> })`, open `/offboarding/${faith.id}` → the header shows the pill text `closed`; `finally` restore `null`.
13. **Audit department label**: as admin `/admin/departments` → `page.getByLabel("Rename Operations")` fill `Operations X` + Enter (read `ref-table.tsx` for the save gesture); `/audit` shows a row whose entity cell reads `Operations X`; `finally`: rename back through `db.department.update` and `db.auditEntry.deleteMany({ where: { entityType: "department", entityId } })`.

Every case ends with `expectNoSeriousAxe(page)` on the last page it visited.

- [ ] **Step 2: Run**

`npm run db:seed` first. `E2E_PORT=3100 npx playwright test e2e/it-nav.spec.ts --workers=1 --global-timeout=540000` FOREGROUND, twice in a row — both `13 passed`. `npx eslint e2e/it-nav.spec.ts`, `npx tsc --noEmit`. `npx playwright test --list` → `Total: 353 tests in 34 files` (report the actual numbers). Port free before/after; `npm run db:seed` last.

- [ ] **Step 3: Commit**

```bash
git add e2e/it-nav.spec.ts
git commit -m "test(e2e): it-nav -- start offboarding, request/asset/person links everywhere, activity chips, HOLD pill, fleet bar, new-hire banner, employees sort and row click, offboarding facets and export, closed pill, department audit label (13 cases; --list 353 / 34)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- e2e/it-nav.spec.ts
```

---

### Task 8: Battery on the final tree and the docs addendum

**Files:**
- Modify: `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, `docs/superpowers/plans/2026-09-21-phase-25-it-navigation-sweep.md` (this file: the D-block), `docs/superpowers/specs/2026-09-21-it-navigation-sweep-design.md` (Status line, *Amended (D-n)* notes).

- [ ] **Step 1: Pre-checks** — `git status --short` empty; `npx tsc --noEmit`; `npx eslint .`; `npx vitest run` (files/tests); `npx prisma migrate status` (24 found, up to date — no new migration); `npx playwright test --list` (total/files).

- [ ] **Step 2: The seven chunks**, FOREGROUND, one at a time, port 3100 free before each and after the last (`netstat -ano | findstr :3100 | findstr LISTENING` prints nothing), recording `N passed (M.Mm)` exactly as printed:

```
E2E_PORT=3100 npx playwright test e2e/it-core.spec.ts e2e/import-export.spec.ts e2e/purchases.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/auth-shell.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/receiving.spec.ts e2e/paging.spec.ts e2e/home-finance.spec.ts e2e/approvals-audit.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/admin.spec.ts e2e/direct-lifecycle.spec.ts e2e/scanner.spec.ts e2e/registration.spec.ts e2e/quick-forms.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/stock.spec.ts e2e/stocktake.spec.ts e2e/stock-lots.spec.ts e2e/stock-reports.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/transfers.spec.ts e2e/directory.spec.ts e2e/offboarding-v2.spec.ts e2e/it-gaps.spec.ts e2e/it-nav.spec.ts e2e/oversight.spec.ts e2e/rate-limit.spec.ts e2e/deadlines.spec.ts --workers=1 --global-timeout=540000
```
Chunks A, B, C, D, E1, E2, F (Phase 24's close: A 54 · B 67 · C 63 · D 47 · E1 36 · E2 31 · F 42 = 340; Phase 25 adds `it-nav` (13) to F). A failing chunk: re-run once as-is; if it reproduces, STOP and report (no product-code edits; a test-only fix only when the diagnosis is certain, committed separately and named in the report and the D-block). After the last chunk: `npm run db:seed`; port free.

- [ ] **Step 3: Docs** (CRLF preserved; one commit, explicit file list):
- `docs/HANDOVER.md`: line 3 gains a new leading parenthetical **PHASE 25 (IT navigation sweep: start offboarding from the profile, every reference a link, new-hire finish line, employees list parity, safety nets) IS CODE-COMPLETE on `phase-25-it-navigation-sweep` at final tree `<sha>`; UNMERGED and UNPUSHED — merging and pushing are the user's decisions, not pre-authorised; NO new migration (24 stays), so the next staging redeploy is a code-only `-Force`** — spec/plan names, `D-1`…`D-N`, battery line in Phase 24's exact shape; keep every earlier parenthetical; "Last updated" → the date. A new **(r)** block after (q): what shipped by spec section, the rulings, the battery, what stays parked (Phase 26 reservations + repair end-date; age-histogram links; list keyboard shortcuts; the Phase 23/24 deferred Minors still open). §0 item 9: the "CURRENT SEVEN" block gains `e2e/it-nav.spec.ts` in F; update the counts sentence. §8: the entries for `/offboarding`/`/reservations` skeletons, the employee-created feedback, the wizard due pill and the facet narrowing (grep "deferred", "loading.tsx", "DuePill", "narrow") each gain **✅ CLOSED in Phase 25 —** with one sentence; history kept.
- `docs/PICKUP.md`: Branch row (phase-25 exists locally, CODE-COMPLETE at final tree, UNMERGED/UNPUSHED; `main` carries the spec/plan commits `9dd7ba5`, `98a94a1`, `<plan sha>` beyond `origin/main` `a9970ad`, themselves unpushed), Database row (24; "Phase 25 adds no migration"), a Battery row (Phase 25 final tree, the seven chunks), Last two phases (25 then 24), §4 item 1 = Phase 25 with the finishing-menu wording (Phase 24's item moves to 2 keeping its merged/redeployed text), §5: the items Phase 25 closed gain **Closed in Phase 25 —**, and a new §5 line parks Phase 26.
- `docs/HANDOVER-PENDING.md` §6: mark shipped items ("shipped in Phase 25": every reference a link, start offboarding, employees list sort/row-click, error/loading pages, the four deferred items), add **Phase 26 — reservations that work + repair end-date** as the next IT candidate with a two-line description each (facts: `.superpowers/sdd/phase-25-facts.md` §3), keep the remaining candidates (audit class scoping, reference-data uniqueness, activity facet, `role="group"` ARIA shape, age-histogram links, list keyboard shortcuts).
- This plan: replace the placeholder bullet under "## Amendments made during execution" with the D-block from the SDD ledger (`D-1`…`D-N`, last entry = "Measured at close, final tree `<sha>`: tsc · lint · unit files/tests · 24 migrations · --list e2e/files · seven chunk lines A–F · zero failed · seed last · port free").
- The spec: Status line → "implemented on branch `phase-25-it-navigation-sweep` (8 tasks, `D-1`…`D-N` — …), code-complete <date> at final tree `<sha>`, final-review fix wave included; unmerged and unpushed." plus "*Amended (D-n):*" notes wherever a ruling changed the design.

Commit: `docs(handover,pickup,pending,plan,spec): Phase 25 code-complete -- battery N e2e / M files, K unit, 24 migrations; (r) block; D-1..D-N` with the Co-Authored-By line.

---

## Self-review

**Spec coverage.** §3.1–3.2 → Task 2; §3.3–3.4 → Task 3 (with Task 1's `Decision.id` and `DuePill.override`); §4 rows 1, 2, 5, 7 → Task 4; rows 3, 4, 6, 8 → Task 5; §5 → Task 6 (banner, focus, table); §6.1–6.3 → Task 6 (error, three skeletons) and Task 3 (offboarding skeleton, not-found); §6.4–6.5 → Tasks 1 + 3; §8 unit → Task 1, e2e → Task 7, walk → Tasks 2 and 6; §9 file list matches the File structure table; §10 constraints are the Global Constraints above.

**Placeholder scan.** Case 3's collect-step URL and case 13's rename gesture point the implementer at the exact component file to read rather than guessing (`wizard-steps.tsx`, `ref-table.tsx`); every other step carries its code. Task 8's `<sha>`/`N` are measured at close by design.

**Type consistency.** `derivedFilters`/`narrowedFacetCounts` (Task 1) are used by name in Task 3; `Decision.id` and `WizardItem.blockedBy.id` (Tasks 1, 3) match the links in Task 3; `AssetRow.hold` `{ id, name }` (Task 4) matches the pill markup; `FleetSlice.href` (Task 4) matches `fleet-bar.tsx`; `ActivityItem.entity` (Task 5) matches both callers; `EmployeesTable` props `{ rows, state, sortHrefs }` match the page; `LoadoutView` `dueAt`/`today` (Task 2) match the page call; `DuePill.override` (Task 1) matches Task 3's header. Every commit command quotes its `(app)`/`[id]` paths.

## Amendments made during execution (`D-1`…`D-12`, from the SDD ledger, 2026-09-21)

Pre-flight and early rulings:

- **D-1** (ruling R1) — the worktree was branched from LOCAL `main` (5acb5fd) with `git worktree add`, not the harness's `fresh` base (`origin/main` a9970ad), so the spec (9dd7ba5, 98a94a1) and plan (5acb5fd) commits sit in the branch's history as in Phases 20–24. Cost if wrong: none (the merge is `--no-ff` into the same `main`).
- **D-2** (spec corrections before the plan, 98a94a1) — the plan facts corrected six spec details: the default complete-by date is `defaultOffboardingDue` (five working days), not "+7 days"; the employee timeline queries already `include: { asset: true }`, so only JSX changes; there is no Home activity feed (two IT callers only); the wizard blocker id comes from `getWizard`'s `blockers` query and `Decision` gains `id` in `src/lib/offboarding.ts`; `Pill` has only neutral/accent tones, so `DuePill` gains `override` instead of a "closed" tone; the offboarding Export button sits in `PageHeader actions` like `/employees`; e2e cases 3, 12, 13 build their own fixtures (no seeded decided item, no due date on the OFFBOARDED fixture, no department audit entry).

Task rulings:

- **D-3** (Task 1, 3e92d10) — `derivedFilters` and `narrowedFacetCounts` (`src/lib/offboarding-list.ts`, 6 tests), `Decision.id` copied from the winning candidate in `decisionOf`, `OffboardingExportRow` + `OFFBOARDING_EXPORT_COLUMNS` (2 tests), `DuePill.override`; a second `Decision`-shaped test literal ("after a rejection, the newer decision wins") also needed `id` — disclosed and correct. Suite 84 files / 1493 tests (+8); tsc, eslint clean. Review: spec ✅, quality approved, 1 Minor (that disclosed literal).
- **D-4** (Task 2, 058b201) — `startOffboarding` (guard → rate → zod → conflict on missing/non-ACTIVE → `minOffboardingDue` floor → one transaction with one `update` audit entry carrying the stored `from` values → the seven `revalidatePath`s), `StartOffboardingDialog` on `useEmployeeRunner`, the profile button for admin/IT on ACTIVE employees, `LoadoutView` `dueAt`/`today` with the pill in the frozen banner. Walk on 3100 as IT/viewer: button present on Carlo Dizon with the five-working-day default, absent on Dennis Ong (banner shows date + overdue pill) and for the viewer. Review: spec ✅, quality approved, 2 Minor parked — **M-P25-1** hand-built audit diff with raw `Date`s (harmless; Prisma serialises them as `diffOf` would), **M-P25-2** read-before-transaction without re-check (inherited from `updateEmployee`).
- **D-5** (Task 3, 911368f + fix f36f153) — `blockers` select gains `id` → `WizardItem.blockedBy.id`; the three wizard links point at `/approvals/{id}`; header pill `override={{ tone: "neutral", text: "closed" }}` when OFFBOARDED; `offboardingFacets` tallies through `narrowedFacetCounts`; `listOffboarding` parses through `derivedFilters`; `offboardingExportRows` (count-then-load cap, same cut and sort as the list) + `GET /offboarding/export` + header Export button; `offboarding/loading.tsx` (10 columns); wizard `not-found.tsx`. tsx proofs: export row Dennis Ong · Operations · undecided 3 · Open; `due=overdue` leaves the progress counts intact; `progress=complete` zeroes both due counts; `getWizard` blockedBy/decision null on the seed. Review: spec ✅, 1 Important — the `offboardingFacets` docstring still said the facets do not narrow each other; fix round 1 rewrote it; re-review ADDRESSED.
- **D-6** (Task 4, 6251bcc) — asset banner "Open request" link; asset timeline ref link; `AssetRow.hold: { id, name }` with a `stopPropagation` link in the HOLD pill; `FleetSlice.href` = `/inventory?status=<STATUS>` via `parseListState`/`withFilter`/`serializeListState`; fleet bar segments and legend are links, wrapper dropped `role="img"`, segments carry `sr-only` "STATUS: N assets". Proofs: `fleet()` hrefs `/inventory?status=DEPLOYED` etc.; BR-MN-0910 `hold` = Nina Robles' id/name; the `.hold` grep found only `inventory-table.tsx`. Review: spec ✅, 1 Important — `e2e/home-finance.spec.ts:204` asserts the old `role="img"` name. **Ruling R2**: the design stands (real links inside an image role would contradict ARIA); Task 7 rewrites that assertion in a test-only commit (legend link `DEPLOYED` + a segment link named /^DEPLOYED: \d+ assets$/). Cost if wrong: one assertion.
- **D-7** (Task 5, c01f6f6) — employee timeline: request refs, approval-row tags and hold-row tags are links; profile lists up to five open requests newest first with a `+N more` link to the timeline; `ActivityItem.entity?` with a trailing link chip fed by both IT activity pages (Purchasing pages unchanged, `entity` optional); `entityLabels` resolves `department` (name, no link). Proof: `entityLabels` → `{ label: "Operations", href: null }`. Review: spec ✅, quality approved, 1 Minor parked — **M-P25-3** the chip repeats the entity name already in the sentence (spec decision 5, by design).
- **D-8** (Task 6, 11bbda4) — employee create redirects to `?created=1`; `EmployeeCreatedNotice` ("Assign devices" → `#loadout`, "Accountability form"); Name `autoFocus`; profile page reads `searchParams` and wraps the loadout in `id="loadout" tabIndex={-1}`; `EmployeesTable` (client: `sortHrefs` for name/joinedAt through `Th`'s sort props, `tabIndex=0` rows with click + Enter, selection guard, the name link stops propagation) replaces the inline table; `(app)/error.tsx` (digest, Try again, Home); skeletons for `/reservations` and both record segments. Walk on 3100 as admin: sort URL/order/arrows, Tab + Enter opens a row, Department-cell click, banner and both links, `#loadout` focus, the error page inside the shell (verified on a real `(app)` route with a temporary throw, reverted — the kitchen-sink page sits outside the group), four skeletons; the walk employee deleted by id. **Ruling R3** — `AuditEntry` is append-only at the database (a trigger refuses deletes), so no e2e case deletes audit rows: they restore mutable fields only and rely on each spec file's `beforeAll` reseed; the plan's case 1/10/13 `finally` blocks lost their `auditEntry` deletes. Cost if wrong: none. Review: spec ✅, quality approved, 2 Minor (a packaging artefact; the report's tooling concerns).
- **D-9** (Task 7, 76f75b3 + 77f03c5) — `e2e/it-nav.spec.ts`, 13 cases (start offboarding incl. the server floor and the viewer's missing button; wizard ref link on a self-inserted `lifecycle_return` request; asset banner and both timelines; activity chips; HOLD pill; profile open requests; fleet segment → `/inventory?status=DEPLOYED`; new-hire banner and Name focus; employees sort both ways, Enter and cell click; offboarding facet narrowing, export filename and the closed pill on a self-set due date; department audit label via a rename on `/admin/departments`); every mutating case restores its fields in `finally` (R3: no audit deletes). Runs 13 passed (1.4m) twice; `--list` 353 tests / 34 files (P-6). R2 landed first as 76f75b3: `home-finance.spec.ts` asserts the legend link `DEPLOYED` and a segment link named /^DEPLOYED: \d+ assets$/ (12 passed (58.2s)). Implementation notes: case 7 searches `?q=MN-0910` because an exact tag redirects to the record; case 9 waits for visibility before counting rows; case 6 writes its own employee audit row (the seed has none). Review: spec ✅, quality approved, 2 Minor parked — **M-P25-4** case 6 has no `try`/`finally` (nothing to restore under R3), **M-P25-5** case 9's facet-trigger check is looser than the dropdown read; reviewer's run 13 passed (1.4m).
- **D-10** (final whole-branch review, opus, 5acb5fd..77f03c5) — Approved with fix wave: 0 Critical / 5 Important / 8 Minor; tsc, eslint clean, vitest 84 files / 1493 tests, no migration, no secrets. I-1: the asset-record `loading.tsx` repeated the layout's header and tab strip under the real ones; I-2: the wizard and farewell report inherited the queue's ten-row list skeleton; I-3: fleet-bar segment links had no visible focus ring (the global outline is clipped by the `overflow-hidden` wrapper) and a zero-share status would be a zero-width focusable link; I-4: e2e case 1 asserted only the audit count (never the three diff fields — the one check that pins parked M-P25-1) and case 9 clicked the legend, never a segment; I-5: `updateEmployee`'s "only writer of `offboardingDueAt`" comment became false. Minors: M-1 phantom tab strip on the employee-record skeleton; M-2 raw `<a>` for an internal route in `EmployeeCreatedNotice`; M-3 the HOLD holder link dead-ends for `finance_staff` (the house's existing assignee-link behaviour); M-4 `autoFocus` redundant with the focus trap (spec asked); M-5 a focusable `<tr>` without a role (spec §5.2's deliberate choice; the name link carries the affordance); M-6 `startOffboarding` writes `offboardingAt = now` unconditionally where the Edit path preserves it (unreachable difference — an ACTIVE row carries null); M-7 the profile's frozen banner shows the due pill for OFFBOARDING only (deliberate: a closed case must never read "overdue" there; the wizard header carries the closed pill); M-8 case 12 restored a literal `null` rather than what it read. Parked M-P25-1..4 stand per the reviewer's reasoning (`diffOf` and Prisma serialise a `Date` to the same ISO string; TOCTOU is the module's pattern; the chip repeat is decision 5; case 6 has nothing restorable); M-P25-5 folded into the wave.
- **D-11** (ruling R4, fix wave, fab0780, seven files) — I-1 the asset-record skeleton keeps only the card block; M-1 the employee-record skeleton loses its tab strip; I-2 a record-shaped `offboarding/[employeeId]/loading.tsx`; I-3 segment links draw the focus ring inside (`focus-visible:[outline-offset:-2px]`) and zero-share segments are skipped (the legend keeps every status); I-5 the `updateEmployee` comment names both writers and `startOffboarding` back-references it; M-2 `next/link` for the accountability-form link; I-4 case 1 asserts the audit row's `action` and its three diff keys with ISO `to` values, case 9 asserts the segment href equals the legend's and clicks the segment; M-P25-5 the facet check asserts the selected value exactly; M-8 case 12 restores the due date it read. Record-only: M-3, M-4, M-5, M-6, M-7. Results: tsc 0, eslint 0, vitest 84 files / 1493 tests; it-nav + home-finance 25 passed (2.1m); port free; seed last. Accepted as-is: case 9's facet check asserts `facetCounts("Status").DEPLOYED === rowCount` (exact while the DEPLOYED set fits one page); the `updateEmployee` comment paragraph was re-wrapped. Scoped re-review (sonnet): all ruled findings addressed, no new findings; it-nav 13 passed (1.4m), tsc/eslint clean, vitest 84 / 1493, seed last. **Final tree fab0780.**
- **D-12** — Measured at close, final tree `fab0780` (2026-09-21, Task 8; documentation only — no product-code and no test change, and no test-only battery fix was needed): `npx tsc --noEmit` clean · `npx eslint .` clean · `npx vitest run` **84 files / 1493 tests** passed · `npx prisma migrate status` **24 migrations found, database schema up to date** (this phase adds none) · `npx playwright test --list` **Total: 353 tests in 34 files** · the seven foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, composition unchanged from Phase 23 apart from the new `e2e/it-nav.spec.ts` joining F — **A 54 passed (3.4m) · B 67 passed (4.0m) · C 63 passed (4.1m) · D 47 passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed (3.0m) · F 55 passed (5.6m) = 353**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first pass, so no chunk was re-run; only F's count moved, 42 → 55, for the thirteen new it-nav cases, and the seven chunk totals reconcile exactly with `--list`. `npm run db:seed` ran last and printed "Seed complete."; `netstat -ano | findstr :3100 | findstr LISTENING` printed nothing before every chunk and after the last.
