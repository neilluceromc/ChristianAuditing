# Phase 23 — Parkinson sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the time the operational forms take (reason chips, remembered picks, typeahead where a dropdown was, first-field focus, Enter handling, eight per-form fixes) and give the two open-ended pieces of work — offboarding and stocktakes — a stored, editable-at-start complete-by date shown wherever approvals and loans already show due state.

**Architecture:** Migration 24 adds `Employee.offboardingDueAt` and `Stocktake.dueAt` with a plain-SQL backfill. One pure module (`src/lib/deadlines.ts`) owns working days, defaults, floors and the due label; `src/lib/reason-chips.ts` is the single reviewable chip list; `src/lib/recent-picks.ts` + `src/server/recent-picks.ts` own remembered picks (in `UserPreference`, written best-effort after each action's transaction). Three shared components (`ReasonField`, `DuePill`, an `EntityCombobox` "Recent" group) and one focus-trap change land once and are used everywhere. Server actions gain the date resolution and the `rememberPicks` calls; queries surface the dates; pages render pills and the Purchasing tile.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, Auth.js v5, zod 4, vitest, Playwright + axe; existing `FormField` render-prop pattern, `Pill` (`neutral`/`accent`), `EntityCombobox`, `useFocusTrap`, `UserPreference`, `ListState`/`withFilter`/`FacetDropdown`, `pagedSnapshot`, `localDateISO`/`fmtDate`, `manilaDayBounds`.

**Spec:** `docs/superpowers/specs/2026-09-17-parkinson-sweep-design.md` — the binding authority. **Facts file** (verbatim current code at every site, gathered 2026-09-17): `.superpowers/sdd/phase-23-facts.md` — read the item named in each task before editing.

## Global Constraints

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`. Never the `inventory` database, never port 3000. Never read or print `.env` (check a key's presence with `grep -c "^NAME=" .env`, never its value).
- Dev server for a manual walk: `npm run dev -- -p 3100` (plain `npm run dev` binds the staging stack's 3000); only ONE implementer walks a dev server at a time (the Browser pane is shared); a parallel implementer verifies with tsc/eslint/vitest/curl only. After stopping a server: `netstat -ano | findstr :3100` and `taskkill /PID <pid> /T`.
- Playwright: foreground only, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a time, explicit file lists per chunk, port free before, no server left behind. Never seed while another agent walks or tests against the database.
- `"use server"` modules export only async functions (plain helpers live in non-server modules); zod at every boundary; `ActionResult` union; role guard THEN `checkRate`; one `writeAudit` per domain write. Preference writes: no audit, no rate event, best effort AFTER the transaction has committed.
- Dates: day-precision UTC midnight in storage (`dayFromISO`); "today" is `localDateISO(new Date())` (Asia/Manila); never `new Date().toISOString().slice(0, 10)` for "today".
- Copy: "Pick today or later", "Pick tomorrow or later", "Use the date picker", "Pick a department"; no new colour tokens — `Pill` tones `neutral`/`accent` only; every new or changed route gets an axe check (`PROMOTED_RULES`) in the e2e.
- Every required field stays required; every default is visible in its field; chips only fill text.
- Tests first for pure modules; measured counts in commit messages; never amend; commit after every task by explicit file list.
- Reviewer subagents: read-only — never `git stash`, `git checkout`, `git restore`, `git reset`, `git switch`; verification in the foreground; report written before the reply.

## Decisions the plan makes beyond the spec

- **P-1** `rememberPicks`/`recentPicks` live in `src/server/recent-picks.ts`, a plain (non-`"use server"`) module imported by the action modules — a `"use server"` file may export only async server actions (Phase 22 P-1's reason).
- **P-2** `loadout-view.tsx` has no `EntityCombobox` (facts A9) — spec §8's "assign dialog combobox gets Recent" for that file is void; Recent applies to `holder-control.tsx`, `bulk-drawer.tsx`, `issue-form.tsx`, `receive-form.tsx`, `asset-form.tsx`. `loadout-view.tsx` gets chips only.
- **P-3** `EntityCombobox` gains `autoFocus?: boolean`; the list opens on that initial focus exactly as it does on a click, so the Recent group is the first thing on screen.
- **P-4** `useFocusTrap`'s existing `"first"` mode is changed to prefer the first form control (`input`, `select`, `textarea`, `[role=combobox]`) and fall back to today's first-focusable; no new option, so every `Dialog` and `Drawer` gets it without a caller change.
- **P-5** E2E Home assertions for the worklist use `/inventory/work` (uncapped) — Home shows only two rows per section, so a leaver can legitimately be cut off there.
- **P-6** Execution order: Task 1 ‖ Task 2 (schema+seed vs pure rules — disjoint, Task 2 needs no DB); then Task 3 ‖ Task 4 (shared components + preference helper vs server actions/queries — disjoint files); then Task 5 ‖ Task 6 ‖ Task 7 (clock UI vs stock/purchases/supplier forms vs inventory/employee/approval dialogs — disjoint files; Task 5 walks the dev server on 3100, Tasks 6 and 7 verify with tsc/eslint/vitest/curl on 3101/3102); then Task 8, Task 9, Task 10 in sequence (each runs Playwright).
- **P-7** The only way to reach an overdue stocktake in a test without waiting a day is to backdate `dueAt` through the e2e Prisma client; the same client cancels it afterwards (`state: "CANCELLED"`) so no OPEN stocktake outlives the case. The seed opens none (spec §2.5).
- **P-8** Purchasing Home's stat grid goes from `lg:grid-cols-8` (eight tiles) to `sm:grid-cols-3 lg:grid-cols-5` for nine.
- **P-9** `employee-form.tsx`'s `today()` moves from `new Date().toISOString().slice(0, 10)` to `localDateISO(new Date())` (Global Constraints), which also fixes the Joined default between 00:00 and 08:00 Manila.
- **P-10** Reason fields in `adjust-dialog.tsx` and `write-off-dialog.tsx` were hand-built `<label>` + `<Textarea aria-label="Reason">` blocks; they become `ReasonField` (FormField-based), keeping the accessible name "Reason" via the visible label, so `getByLabel("Reason")` in the D1/D2 stock specs still resolves.
- **P-11** Case counts in spec §9.2 are targets; the measured `--list` count governs the docs (`D-1` at close).

## Amendments made during execution (`D-1`…)

- *(filled by the SDD ledger at close)*

---

## File structure

New pure modules and tests in `src/lib`; the preference helper in `src/server/recent-picks.ts`; shared UI in `src/components/ui/due-pill.tsx`, `src/components/patterns/reason-field.tsx`, `src/components/suppliers/supplier-same-name.tsx`; everything else edits the files named per task. Spec §10 is the full list.

---

### Task 1: Schema, migration 24, seed

**Files:** `prisma/schema.prisma` (`Employee`, `Stocktake`), `prisma/migrations/<ts>_parkinson_deadlines/migration.sql`, `prisma/seed.ts`. Facts: C47.

**Interfaces — Produces:** `Employee.offboardingDueAt: Date | null`, `Stocktake.dueAt: Date` in the Prisma client; a seeded overdue leaver.

- [ ] **Step 1: Schema** — in `model Employee`, after `offboardingAt    DateTime?`, add:
```prisma
  /// Phase 23 (spec §2.1). Complete-by date for the current offboarding, day-precision UTC like
  /// loanDueAt. Set when employment enters OFFBOARDING (default addWorkingDays(today, 5), editable
  /// in the employee form), cleared on ACTIVE, kept once OFFBOARDED for the farewell report.
  offboardingDueAt DateTime?
```
In `model Stocktake`, after `openedById String`… block (after `postedBy`), add:
```prisma
  /// Phase 23 (spec §2.2). Close-by date, set once at open (default openedAt + 3 days). Day-precision UTC.
  dueAt      DateTime
```
- [ ] **Step 2: Migration** — `npx prisma migrate dev --name parkinson_deadlines --create-only`, then replace the generated SQL body with spec §2.4 verbatim (two `ADD COLUMN`, the two guarded `UPDATE`s, then `ALTER COLUMN "dueAt" SET NOT NULL`). `npx prisma migrate deploy` → 24; `npx prisma generate`.
- [ ] **Step 3: Seed** — `prisma/seed.ts`: where employees are created from `employeeRows` (facts C47 lines 100–111 and the create loop that follows), Dennis Ong `EMP-0090` gets `offboardingDueAt: day(-2)` — add to the create data: `offboardingDueAt: employment === "OFFBOARDING" ? day(-2) : null` (find the `employment` variable the loop already destructures from the row tuple). In the `ST-0001` create (lines 634–644) add `dueAt: day(-8),` after `openedAt: day(-10),`.
- [ ] **Step 4: Prove** — `npm run db:seed`; `npx prisma migrate status` (24, up to date); `npx tsx -e` one-liner (no `.env` echo) printing Dennis's `offboardingDueAt` ISO day and `ST-0001.dueAt`; `npx tsc --noEmit`; `npx vitest run` (baseline count in the report).
```bash
git commit -m "feat(schema): Phase 23 -- Employee.offboardingDueAt and Stocktake.dueAt; migration 24 backfills OFFBOARDING employees (+7 d) and open stocktakes (+3 d); seed: Dennis due -2 d, ST-0001 dueAt" -- prisma/schema.prisma prisma/migrations prisma/seed.ts
```

---

### Task 2: Pure rules — deadlines, chips, recent picks, worklist, offboarding list, schema

**Files:** create `src/lib/deadlines.ts` (+ `.test.ts`), `src/lib/reason-chips.ts` (+ `.test.ts`), `src/lib/recent-picks.ts` (+ `.test.ts`); modify `src/lib/worklist.ts` (+ test), `src/lib/offboarding-list.ts` (+ test), `src/lib/stock-schema.ts` (+ test). Facts: C40–C43.

**Interfaces — Produces:** everything in spec §4.1–§4.3, §4.5, §4.6, plus `offboardingCompletionText`, `dueOf`, `Due`, and `stocktakeOpenSchema.dueAt`.

- [ ] **Step 1: Tests first** — `deadlines.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  addDays, addWorkingDays, dayFromISO, defaultOffboardingDue, defaultStocktakeDue, dueStatus, isPastDue,
  minOffboardingDue, minStocktakeDue, offboardingCompletionText, OFFBOARDING_DUE_WORKING_DAYS, STOCKTAKE_DUE_DAYS,
} from "./deadlines";

const TODAY = "2026-09-16"; // a Wednesday
describe("addWorkingDays", () => {
  it("skips weekends from every start day", () => {
    expect(addWorkingDays("2026-09-14", 5)).toBe("2026-09-21"); // Mon → Mon
    expect(addWorkingDays("2026-09-15", 5)).toBe("2026-09-22"); // Tue → Tue
    expect(addWorkingDays("2026-09-16", 5)).toBe("2026-09-23"); // Wed → Wed
    expect(addWorkingDays("2026-09-17", 5)).toBe("2026-09-24"); // Thu → Thu
    expect(addWorkingDays("2026-09-18", 5)).toBe("2026-09-25"); // Fri → Fri
    expect(addWorkingDays("2026-09-19", 5)).toBe("2026-09-25"); // Sat → Fri
    expect(addWorkingDays("2026-09-20", 5)).toBe("2026-09-25"); // Sun → Fri
  });
  it("crosses a month end and a year end", () => {
    expect(addWorkingDays("2026-09-29", 5)).toBe("2026-10-06");
    expect(addWorkingDays("2026-12-30", 5)).toBe("2027-01-06");
  });
});
describe("addDays / defaults / floors", () => {
  it("adds calendar days across a month end", () => expect(addDays("2026-09-29", 3)).toBe("2026-10-02"));
  it("defaults are 5 working days and 3 days", () => {
    expect(OFFBOARDING_DUE_WORKING_DAYS).toBe(5); expect(STOCKTAKE_DUE_DAYS).toBe(3);
    expect(defaultOffboardingDue(TODAY)).toBe("2026-09-23"); expect(defaultStocktakeDue(TODAY)).toBe("2026-09-19");
  });
  it("floors: offboarding today, stocktake tomorrow", () => {
    expect(minOffboardingDue(TODAY)).toBe(TODAY); expect(minStocktakeDue(TODAY)).toBe("2026-09-17");
  });
});
describe("dueStatus", () => {
  it("labels overdue, today, tomorrow and later, with tone accent at or past the day", () => {
    expect(dueStatus(dayFromISO("2026-09-06"), TODAY)).toEqual({ days: -10, text: "10 d overdue", tone: "accent", overdue: true });
    expect(dueStatus(dayFromISO("2026-09-15"), TODAY)).toEqual({ days: -1, text: "1 d overdue", tone: "accent", overdue: true });
    expect(dueStatus(dayFromISO("2026-09-16"), TODAY)).toEqual({ days: 0, text: "due today", tone: "accent", overdue: false });
    expect(dueStatus(dayFromISO("2026-09-17"), TODAY)).toEqual({ days: 1, text: "due tomorrow", tone: "neutral", overdue: false });
    expect(dueStatus(dayFromISO("2026-09-19"), TODAY)).toEqual({ days: 3, text: "due in 3 d", tone: "neutral", overdue: false });
  });
  it("isPastDue is false on the due day itself", () => {
    expect(isPastDue(dayFromISO(TODAY), TODAY)).toBe(false);
    expect(isPastDue(dayFromISO("2026-09-15"), TODAY)).toBe(true);
  });
});
describe("offboardingCompletionText", () => {
  const due = dayFromISO("2026-09-14");
  it("no date", () => expect(offboardingCompletionText(null, null, TODAY)).toBe("No completion date set"));
  it("completed on or before the day", () =>
    expect(offboardingCompletionText(due, dayFromISO("2026-09-14"), TODAY)).toBe("Completed on time (due 14 Sep 2026)"));
  it("completed late", () =>
    expect(offboardingCompletionText(due, dayFromISO("2026-09-16"), TODAY)).toBe("Completed 2 d late (due 14 Sep 2026)"));
  it("still open", () => {
    expect(offboardingCompletionText(due, null, TODAY)).toBe("Still open · 2 d overdue (due 14 Sep 2026)");
    expect(offboardingCompletionText(dayFromISO("2026-09-19"), null, TODAY)).toBe("Still open · due in 3 d (due 19 Sep 2026)");
  });
});
```
(`fmtDate` renders `14 Sep 2026` — en-GB, Asia/Manila; a UTC-midnight day reads as the same calendar day there.) `reason-chips.test.ts`: every context 1–5 chips, no duplicates within a context, every chip 5–40 chars; `chipsForOutcome("MISSING")` equals `REASON_CHIPS["asset.missing"]`, `("DEFECTIVE")` → `asset.defective`, `("BUYOUT")` → `asset.buyout`, `("TRIAGE")` and `("RETURNED")` → `[]`. `recent-picks.test.ts`: `pushRecent(["a","b"], "b")` → `["b","a"]`; `pushRecent(["a","b","c","d","e"], "f")` → `["f","a","b","c","d"]`; `recentOptions([{value:"a"},{value:"c"}], ["c","x","a"])` → `[{value:"c"},{value:"a"}]`; `parseRecent(null)`, `parseRecent("x")`, `parseRecent(["a", 1])` → `[]`, `[]`, `["a"]`; `recentKey("vendor")` → `"recent:vendor"`; `RECENT_MAX` 5. Run red.
- [ ] **Step 2: `deadlines.ts`**
```ts
import { fmtDate, localDateISO } from "./format";

export const OFFBOARDING_DUE_WORKING_DAYS = 5;
export const STOCKTAKE_DUE_DAYS = 3;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD → the app's day-precision UTC-midnight Date (asset-diff.ts toDay convention). */
export function dayFromISO(iso: string): Date { return new Date(`${iso}T00:00:00.000Z`); }
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = dayFromISO(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d);
}
/** Mon–Fri only, no holiday list (spec §1 Out): step a day at a time, count the step when it lands on a weekday. */
export function addWorkingDays(iso: string, n: number): string {
  const d = dayFromISO(iso);
  for (let left = n; left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return toISO(d);
}
export const defaultOffboardingDue = (todayISO: string) => addWorkingDays(todayISO, OFFBOARDING_DUE_WORKING_DAYS);
export const defaultStocktakeDue = (todayISO: string) => addDays(todayISO, STOCKTAKE_DUE_DAYS);
export const minOffboardingDue = (todayISO: string) => todayISO;
export const minStocktakeDue = (todayISO: string) => addDays(todayISO, 1);

export interface DueStatus { days: number; text: string; tone: "neutral" | "accent"; overdue: boolean }
/** Calendar days from today to the due day, both on the Asia/Manila calendar. */
export function daysUntil(dueAt: Date, todayISO: string): number {
  return Math.round((dayFromISO(localDateISO(dueAt)).getTime() - dayFromISO(todayISO).getTime()) / DAY_MS);
}
export function dueStatus(dueAt: Date, todayISO: string): DueStatus {
  const days = daysUntil(dueAt, todayISO);
  const text = days < 0 ? `${-days} d overdue` : days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} d`;
  return { days, text, tone: days <= 0 ? "accent" : "neutral", overdue: days < 0 };
}
export function isPastDue(dueAt: Date, todayISO: string): boolean { return localDateISO(dueAt) < todayISO; }
/** The farewell report's one line (spec §6.3). */
export function offboardingCompletionText(dueAt: Date | null, completedAt: Date | null, todayISO: string): string {
  if (!dueAt) return "No completion date set";
  const due = `(due ${fmtDate(dueAt)})`;
  if (completedAt) {
    const late = -daysUntil(dueAt, localDateISO(completedAt));
    return late <= 0 ? `Completed on time ${due}` : `Completed ${late} d late ${due}`;
  }
  return `Still open · ${dueStatus(dueAt, todayISO).text} ${due}`;
}
```
- [ ] **Step 3: `reason-chips.ts`** — spec §4.2's `REASON_CHIPS` verbatim plus:
```ts
export function chipsForOutcome(outcome: "MISSING" | "DEFECTIVE" | "BUYOUT" | "TRIAGE" | "RETURNED"): readonly string[] {
  switch (outcome) {
    case "MISSING": return REASON_CHIPS["asset.missing"];
    case "DEFECTIVE": return REASON_CHIPS["asset.defective"];
    case "BUYOUT": return REASON_CHIPS["asset.buyout"];
    default: return [];
  }
}
```
- [ ] **Step 4: `recent-picks.ts`** — spec §4.3 verbatim: `RECENT_KINDS`, `RecentKind`, `RECENT_MAX = 5`, `recentKey`, `pushRecent` (`[id, ...existing.filter((x) => x !== id)].slice(0, RECENT_MAX)`), `recentOptions` (`recent.flatMap((id) => { const o = options.find((x) => x.value === id); return o ? [o] : []; })`), `parseRecent` (`Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []`).
- [ ] **Step 5: `worklist.ts`** — import `dueStatus` from `./deadlines`; add after `loanRow`:
```ts
export interface LeaverLike { id: string; name: string; employeeNo: string; itemsOut: number; offboardingDueAt: Date | null }

/** Spec §4.5: the queue section's leaver rule, mirroring loanRow. Key stays `queue:<id>` so existing dismissals hold. */
export function leaverRow(e: LeaverLike, todayISO: string): WorkRow {
  const base = { key: `queue:${e.id}`, section: "queue" as const, rank: 2 };
  const kit = e.itemsOut > 0
    ? `${e.employeeNo} · ${e.itemsOut} item${e.itemsOut === 1 ? "" : "s"} still out`
    : `${e.employeeNo} · equipment returned · accounts still to close`;
  const action = e.itemsOut > 0 ? "Collect equipment" : "Close accounts";
  if (e.offboardingDueAt === null) {
    return { ...base, title: `${e.name} is leaving — no completion date`, meta: `${kit} · set a completion date`, href: `/employees/${e.id}/edit`, action: "Set date", severity: 1000 };
  }
  const due = dueStatus(e.offboardingDueAt, todayISO);
  const severity = due.overdue ? 500 - due.days : due.days === 0 ? 2 : due.days === 1 ? 1 : 0;
  return { ...base, title: `${e.name} is leaving`, meta: `${kit} · ${due.text}`, href: `/offboarding/${e.id}`, action, severity };
}
```
Tests (`worklist.test.ts`): no date → action "Set date", severity 1000, href ends `/edit`; overdue 3 d → severity 503, meta ends "3 d overdue"; due today → 2; in 4 d → 0; within one `groupWork` call the overdue leaver sorts above the fresh one and both stay below a rank-0 SLA row.
- [ ] **Step 6: `offboarding-list.ts`** — `facets: ["department", "progress", "due"]`, `sortable: ["name", "started", "undecided", "due"]`; add
```ts
export type Due = "overdue" | "on-track";
/** Derived: a row with no date is on track (spec §4.6). */
export function dueOf(dueAt: Date | null, todayISO: string): Due {
  return dueAt !== null && isPastDue(dueAt, todayISO) ? "overdue" : "on-track";
}
```
(import `isPastDue` from `./deadlines`) and in `buildOffboardingOrderBy` map `key === "due"` → `{ offboardingDueAt: { sort: dir, nulls: "last" } }`. Tests: the config assertions updated; `buildOffboardingOrderBy([{ key: "due", dir: "asc" }])` → `[{ offboardingDueAt: { sort: "asc", nulls: "last" } }, { employeeNo: "asc" }, { id: "asc" }]`; `dueOf(null, T)` → `"on-track"`, `dueOf(dayFromISO("2026-09-15"), "2026-09-16")` → `"overdue"`.
- [ ] **Step 7: `stock-schema.ts`** — `stocktakeOpenSchema` gains `dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")`; update the two existing tests to pass `dueAt: "2026-09-20"` and add: refuses `dueAt: "20/09/2026"`, refuses a missing `dueAt`.
- [ ] **Step 8: Verify** — `npx tsc --noEmit`; `npx eslint src/lib`; `npx vitest run` (record the count).
```bash
git commit -m "feat(lib): Phase 23 pure rules -- working-day deadlines and due labels, reason chip list, recent-picks merge, leaverRow, offboarding due facet/sort, stocktakeOpenSchema.dueAt" -- src/lib
```

---

### Task 3: Shared components and the preference helper

**Files:** create `src/components/patterns/reason-field.tsx`, `src/components/ui/due-pill.tsx`, `src/server/recent-picks.ts`; modify `src/components/patterns/entity-combobox.tsx`, `src/components/ui/use-focus-trap.ts`. Facts: C44–C46.

**Interfaces — Consumes:** Task 2's `dueStatus`, `recentOptions`, `RECENT_KINDS`, `parseRecent`, `pushRecent`, `recentKey`. **Produces:** `ReasonField`, `DuePill`, `EntityCombobox` props `recent?: string[]`, `autoFocus?: boolean`; `rememberPicks`, `recentPicks`.

- [ ] **Step 1: `ReasonField`**
```tsx
"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

/** Spec §6.1: a reason textarea with quick-pick chips. A chip only fills the box (decision 8); validation is the caller's. */
export function ReasonField({
  label = "Reason", required, hint, error, value, onChange, chips, rows = 3, disabled, className,
}: {
  label?: string; required?: boolean; hint?: string; error?: string;
  value: string; onChange: (value: string) => void;
  chips: readonly string[]; rows?: number; disabled?: boolean; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <FormField label={label} required={required} hint={hint} error={error} className={className}>
      {(p) => (
        <div className="flex flex-col gap-1.5">
          {chips.length > 0 && (
            <div role="group" aria-label={`Quick ${label.toLowerCase()}s`} className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <Button
                  key={chip} type="button" size="sm" variant={value === chip ? "secondary" : "ghost"}
                  aria-label={`Use reason: ${chip}`} aria-pressed={value === chip} disabled={disabled}
                  onClick={() => { onChange(chip); ref.current?.focus(); }}
                >
                  {chip}
                </Button>
              ))}
            </div>
          )}
          <Textarea
            ref={ref} id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} rows={rows}
            disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </FormField>
  );
}
```
- [ ] **Step 2: `DuePill`** (`src/components/ui/due-pill.tsx`)
```tsx
import { Pill } from "@/components/ui/pill";
import { fmtDate } from "@/lib/format";
import { dueStatus } from "@/lib/deadlines";

/** Spec §0 decision 9: two tones only; the text carries the distinction. */
export function DuePill({ dueAt, today, withDate = false }: { dueAt: Date; today: string; withDate?: boolean }) {
  const s = dueStatus(dueAt, today);
  return (
    <span className="inline-flex items-center gap-1.5">
      {withDate && <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(dueAt)}</span>}
      <Pill tone={s.tone}>{s.text}</Pill>
    </span>
  );
}
```
- [ ] **Step 3: `EntityCombobox`** — add props `recent?: string[]` and `autoFocus?: boolean`; import `recentOptions` from `@/lib/recent-picks`. Replace the `shown` computation (facts C45 lines 44–47) with:
```ts
  const filtered = query
    ? options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(query.toLowerCase()))
    : options;
  const recentShown = query ? [] : recentOptions(options, recent ?? []);
  const recentSet = new Set(recentShown.map((o) => o.value));
  const rest = query ? filtered : options.filter((o) => !recentSet.has(o.value));
  const shown = [...recentShown, ...rest];
```
Pass `autoFocus={autoFocus}` on the `<input>`. In the list, render a heading before index 0 and before index `recentShown.length` when `recentShown.length > 0`:
```tsx
          {shown.map((option, i) => (
            <Fragment key={option.value}>
              {recentShown.length > 0 && i === 0 && <li role="presentation" className="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-[0.06em] text-fg-faint">Recent</li>}
              {recentShown.length > 0 && i === recentShown.length && <li role="presentation" className="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-[0.06em] text-fg-faint">All</li>}
              <li id={`${listId}-${option.value}`} role="option" … (unchanged) />
            </Fragment>
          ))}
```
(`import { Fragment, useId, useRef, useState } from "react"`.) Arrow keys already index `shown`, which has no headings, so they skip them by construction.
- [ ] **Step 4: `useFocusTrap`** (P-4) — add after `focusableIn`:
```ts
const FIELD = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]';
function firstFieldIn(container: HTMLElement): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>(FIELD)).find(
    (el) => el.getClientRects().length > 0 && !el.closest("[inert]"),
  ) ?? null;
}
```
and change line 136 (`else (focusableIn(container)[0] ?? container).focus();`) to `else (firstFieldIn(container) ?? focusableIn(container)[0] ?? container).focus();`. Update the hook's doc comment: "first" = first form control, else first focusable.
- [ ] **Step 5: `src/server/recent-picks.ts`** (P-1)
```ts
import { prisma } from "./db/client";
import { RECENT_KINDS, parseRecent, pushRecent, recentKey, type RecentKind } from "@/lib/recent-picks";

/** Spec §5.3: the stored list for a page render, parsed defensively. */
export async function recentPicks(userId: string, kind: RecentKind): Promise<string[]> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: recentKey(kind) } }, select: { value: true },
  });
  return parseRecent(row?.value);
}

/**
 * Best effort, called AFTER the caller's transaction committed (decision 7): a failure is logged and
 * swallowed — the domain action has already succeeded. Not audited, no rate event.
 */
export async function rememberPicks(userId: string, picks: Partial<Record<RecentKind, string | null | undefined>>): Promise<void> {
  for (const kind of RECENT_KINDS) {
    const id = picks[kind];
    if (!id) continue;
    try {
      const key = recentKey(kind);
      const next = pushRecent(await recentPicks(userId, kind), id);
      await prisma.userPreference.upsert({
        where: { userId_key: { userId, key } }, update: { value: next }, create: { userId, key, value: next },
      });
    } catch (err) {
      console.error(`recent-picks: could not remember ${kind} for user ${userId}`, err);
    }
  }
}
```
- [ ] **Step 6: Verify** — `npx tsc --noEmit`; `npx eslint src/components src/server/recent-picks.ts`; `npx vitest run`. No walk (Task 5 walks).
```bash
git commit -m "feat(ui): Phase 23 shared pieces -- ReasonField with chips, DuePill, EntityCombobox Recent group and autoFocus, focus trap prefers the first form control; recent-picks preference helper" -- src/components/patterns/reason-field.tsx src/components/ui/due-pill.tsx src/components/patterns/entity-combobox.tsx src/components/ui/use-focus-trap.ts src/server/recent-picks.ts
```

---

### Task 4: Server — dates, remembered picks, queries

**Files:** `src/server/modules/employees/actions.ts`, `src/server/modules/import/employee-actions.ts`, `src/server/modules/stock/stocktake-actions.ts`, `src/server/modules/stock/movement-actions.ts`, `src/server/modules/stock/queries.ts`, `src/server/modules/lifecycle/actions.ts`, `src/server/modules/inventory/actions.ts`, `src/server/modules/home/queries.ts`, `src/server/modules/offboarding/queries.ts`, `src/server/modules/suppliers/actions.ts`, `src/server/modules/suppliers/queries.ts`. Facts: A19 (employees), C32–C39.

**Interfaces — Consumes:** Task 1's columns; Task 2's `dayFromISO`, `defaultOffboardingDue`, `minOffboardingDue`, `minStocktakeDue`, `leaverRow`, `dueOf`, `Due`, `stocktakeOpenSchema`; Task 3's `rememberPicks`. **Produces:** `updateEmployee`/`createEmployee` accept `offboardingDueAt?: string`; `openStocktake` requires `dueAt`; `OffboardingRow.dueAt`, `WizardData.employee.dueAt`, `WizardData.completedAt`, `listOffboarding(...).facets.due`; `listStocktakes` and `getStocktake` rows carry `dueAt`; `stockHomeSignals` → `{ low, expiringLots, stocktakesOverdue }`; `PurchasingHome.stocktakesOverdue`; `checkSameSupplierName(input)` → `ActionResult<{ match: { id: string; name: string } | null }>`.

- [ ] **Step 1: employees/actions.ts** — move `const dateStr = …` (line 279) above `employeeSchema`; add `offboardingDueAt: z.union([z.literal(""), dateStr]).optional(),` to `employeeSchema`; import `dayFromISO, defaultOffboardingDue, minOffboardingDue` from `@/lib/deadlines` and `localDateISO` from `@/lib/format`. In `updateEmployee`, after `if (!employee) …` insert spec §5.1's resolution block verbatim and add `offboardingDueAt,` to `data`. In `createEmployee`, after the `joinedAt` check:
```ts
  const today = localDateISO(new Date());
  if (d.employment === "OFFBOARDING" && d.offboardingDueAt && d.offboardingDueAt < minOffboardingDue(today)) {
    return validationError({ offboardingDueAt: "Pick today or later" });
  }
```
and in `data`: `offboardingDueAt: d.employment === "OFFBOARDING" ? dayFromISO(d.offboardingDueAt || defaultOffboardingDue(today)) : null,`. The create audit diff gains `...(data.offboardingDueAt ? { offboardingDueAt: { from: null, to: data.offboardingDueAt } } : {})`.
- [ ] **Step 2: import/employee-actions.ts** — before the row loop: `const today = localDateISO(new Date());` (import from `@/lib/format`; import `dayFromISO, defaultOffboardingDue` from `@/lib/deadlines`). Line 149 becomes:
```ts
          const employee = await tx.employee.create({
            data: { ...row.data, offboardingDueAt: row.data.employment === "OFFBOARDING" ? dayFromISO(defaultOffboardingDue(today)) : null },
          });
```
and after line 155: `if (employee.offboardingDueAt) diff.offboardingDueAt = { from: null, to: employee.offboardingDueAt };`.
- [ ] **Step 3: stocktake-actions.ts `openStocktake`** — after `const d = parsed.data;`:
```ts
  const today = localDateISO(new Date());
  if (d.dueAt < minStocktakeDue(today)) return validationError({ dueAt: "Pick tomorrow or later" });
  const dueAt = dayFromISO(d.dueAt);
```
(import `dayFromISO, minStocktakeDue` from `@/lib/deadlines`); the create becomes `data: { refNo, categoryId: scope, openedById: user.id, note: d.note || null, dueAt }`; the audit diff gains `dueAt: { from: null, to: d.dueAt }`.
- [ ] **Step 4: remembered picks** — import `rememberPicks` from `@/server/recent-picks` in each module. `movement-actions.ts` `receiveStock`: after `revalidateItem(item.id);` add `await rememberPicks(user.id, { "stock-item": item.id, vendor: d.supplierId || null });`. `issueStock`: after `revalidateItem(item.id);` (inside the try, before `return ok(result)`) add `await rememberPicks(user.id, { "stock-item": item.id, employee: d.employeeId || null });`. `lifecycle/actions.ts`: `assignAsset` after `revalidateAsset(d.assetId, [d.employeeId]);`, `bulkAssign` after `revalidatePath("/");`, `replaceAsset` after `revalidatePath(\`/inventory/${d.newAssetId}\`);` — each `await rememberPicks(user.id, { employee: d.employeeId });`. `inventory/actions.ts`: `createAsset` before `return ok({ id: asset.id });` and `updateAsset` before its `return ok({ id: asset.id });` — `await rememberPicks(user.id, { vendor: d.vendorId || null });` (`d.vendorId` is the parsed field both schemas carry).
- [ ] **Step 5: stock/queries.ts** — `listStocktakes`: row type and mapping gain `dueAt: s.dueAt`. `getStocktake`: include `dueAt` in its returned object (the function returns the row's scalar fields — add `dueAt: st.dueAt` beside `openedAt`). `stockHomeSignals`: return type `{ low: number; expiringLots: number; stocktakesOverdue: number }`; add to the first `Promise.all` a third read `prisma.stocktake.count({ where: { state: "OPEN", dueAt: { lt: manilaDayBounds(today, today).start } } })` (import `manilaDayBounds` from `@/lib/stock-reports`) and return it as `stocktakesOverdue`.
- [ ] **Step 6: home/queries.ts** — import `leaverRow` from `@/lib/worklist` (extend the existing import) ; leavers `select` gains `offboardingDueAt: true`; replace the `for (const e of leavers) { rows.push({ … }) }` block (lines 180–197) with:
```ts
  const todayISO = localDateISO(now);
  for (const e of leavers) {
    rows.push(leaverRow({ id: e.id, name: e.name, employeeNo: e.employeeNo, itemsOut: e._count.assets, offboardingDueAt: e.offboardingDueAt }, todayISO));
  }
```
`PurchasingHome` gains `stocktakesOverdue: number;` and `purchasingHome` returns `stocktakesOverdue: stockSignals.stocktakesOverdue`.
- [ ] **Step 7: offboarding/queries.ts** — `OffboardingRow` gains `dueAt: Date | null` (`toOffboardingRow`: `dueAt: e.offboardingDueAt`); `listOffboarding`: parse `const dueFilter = (state.filters.due ?? []).filter((d): d is Due => d === "overdue" || d === "on-track");` (import `Due, dueOf` from `@/lib/offboarding-list`, `localDateISO` from `@/lib/format`), take the in-memory branch when `dueFilter.length > 0` too, and filter `computed = computed.filter((r) => dueFilter.includes(dueOf(r.dueAt, today)))` with `const today = localDateISO(new Date())`; the return type's `facets` gains `due: FacetOption[]`; `offboardingFacets` counts `overdue`/`on-track` over the same candidate set the progress counts use (facts line 180's loop) and returns `due: [{ value: "overdue", label: "Overdue", count }, { value: "on-track", label: "On track", count }]`. `WizardData.employee` gains `dueAt: Date | null` and `WizardData` gains `completedAt: Date | null`; in `getWizard`, read `completedAt` as
```ts
  const completed = employee.employment === "OFFBOARDED"
    ? await prisma.auditEntry.findFirst({ where: { entityType: "employee", entityId: employee.id, action: "offboarding.completed" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
    : null;
```
and return `employee: { …, dueAt: employee.offboardingDueAt }, completedAt: completed?.createdAt ?? null`.
- [ ] **Step 8: suppliers** — `suppliers/queries.ts`:
```ts
/** Phase 23 (spec §8): the supplier form's live duplicate nudge — case-insensitive contains, first match, never the row being edited. */
export async function findSameSupplierName(name: string, excludeId?: string): Promise<{ id: string; name: string } | null> {
  const q = name.trim();
  if (q.length < 3) return null;
  return prisma.vendor.findFirst({
    where: { name: { contains: q, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true }, orderBy: { name: "asc" },
  });
}
```
`suppliers/actions.ts`: `checkSameSupplierName(input)` — `actionRole("admin", "purchasing_staff")`, `checkRate`, schema `{ name: z.string(), excludeId: z.string().optional() }`, `return ok({ match: await findSameSupplierName(name, excludeId) })`.
- [ ] **Step 9: Verify** — `npx tsc --noEmit`; `npx eslint src/server`; `npx vitest run`; `npx tsx -e` against the seeded `inventory_dev`: `stockHomeSignals(localDateISO(new Date()))` prints `stocktakesOverdue: 0`; `listOffboarding` default state returns Dennis with `dueAt` two days back and `facets.due` `[overdue 1, on-track 0]`.
```bash
git commit -m "feat(server): Phase 23 -- offboardingDueAt resolved on every OFFBOARDING entry (form, create, import), stocktake dueAt with floor, remembered picks after commit, leaverRow on Home, due facet and report completion, stocktakesOverdue signal, supplier same-name check" -- src/server
```

---

### Task 5: Clock UI — employee form, stocktake open form, lists, wizard, report, Home

**Files:** `src/components/employees/employee-form.tsx`, `src/app/(app)/employees/[id]/edit/page.tsx`, `src/components/stock/stocktake-open-form.tsx`, `src/app/(app)/offboarding/page.tsx`, `src/components/offboarding/offboarding-toolbar.tsx`, `src/app/(app)/offboarding/[employeeId]/page.tsx`, `src/app/(app)/offboarding/[employeeId]/report/page.tsx`, `src/app/(app)/stock/stocktakes/page.tsx`, `src/app/(app)/stock/stocktakes/[id]/page.tsx`, `src/app/(app)/page.tsx`. Facts: B21–B28, B31, and `employee-form.tsx` (full file read by the controller; the Employment block is lines 145–154).

**Interfaces — Consumes:** Task 2's `defaultOffboardingDue`, `minOffboardingDue`, `defaultStocktakeDue`, `minStocktakeDue`, `offboardingCompletionText`; Task 3's `DuePill`; Task 4's row fields. Accessible-name CONTRACT for the e2e: employee date field label "Complete offboarding by"; stocktake date field label "Close by"; offboarding list column header "Due", facet dropdown label "Due" with options "Overdue"/"On track"; Home stat label "Stocktakes past close-by"; wizard header link "Set a completion date".

- [ ] **Step 1: employee-form.tsx** — imports: `localDateISO` from `@/lib/format`; `defaultOffboardingDue, minOffboardingDue` from `@/lib/deadlines`. `const today = () => localDateISO(new Date());` (P-9). `Initial` gains `offboardingDueAt: string;` new-mode initial `{ …, departmentId: "", …, offboardingDueAt: "" }`; state gains `offboardingDueAt: initial.offboardingDueAt`. Employment select `onChange`:
```tsx
                onChange={(e) => {
                  const employment = e.target.value;
                  setForm((f) => ({
                    ...f, employment,
                    offboardingDueAt: employment === "OFFBOARDING" ? (f.offboardingDueAt || defaultOffboardingDue(today())) : "",
                  }));
                }}
```
After the Employment `FormField` add:
```tsx
          {form.employment === "OFFBOARDING" && (
            <FormField label="Complete offboarding by" required error={errors.offboardingDueAt} hint="5 working days by default.">
              {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                min={minOffboardingDue(today())} value={form.offboardingDueAt}
                onChange={(e) => setForm((f) => ({ ...f, offboardingDueAt: e.target.value }))} />}
            </FormField>
          )}
```
`common` gains `offboardingDueAt: form.employment === "OFFBOARDING" ? form.offboardingDueAt : ""`. Department select (new mode): first option `<option value="">Choose a department</option>`. `edit/page.tsx` passes `offboardingDueAt: employee.offboardingDueAt ? localDateISO(employee.offboardingDueAt) : ""` (import `localDateISO`).
- [ ] **Step 2: stocktake-open-form.tsx** — imports `localDateISO`, `defaultStocktakeDue, minStocktakeDue`; `const today = localDateISO(new Date());` inside the component; `const [dueAt, setDueAt] = useState(() => defaultStocktakeDue(today));`; `CLAIMED = ["categoryId", "note", "dueAt"]`; `openStocktake({ categoryId, note, dueAt })`; between Scope and Note:
```tsx
          <FormField label="Close by" required error={fieldErrors.dueAt} hint="3 days by default.">
            {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              min={minStocktakeDue(today)} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
          </FormField>
```
(import `Input`.)
- [ ] **Step 3: offboarding list** — `page.tsx`: `const today = localDateISO(new Date());` (import from `@/lib/format`, `DuePill` from `@/components/ui/due-pill`); after the Started `<Th>` add `<Th width={168} sort={sortDir("due")} sortIndex={sortIndex("due")}><Link href={sortHref("due")}>Due</Link></Th>`; after the `fmtDate(r.started)` cell add `<Td>{r.dueAt ? <DuePill dueAt={r.dueAt} today={today} withDate /> : <span className="text-fg-faint">—</span>}</Td>`. `offboarding-toolbar.tsx`: `facets: Record<"department" | "progress" | "due", FacetOption[]>`; `const DUE_LABEL: Record<string, string> = { overdue: "Overdue", "on-track": "On track" };` and a third `FacetDropdown label="Due" options={facets.due.map((o) => ({ ...o, label: DUE_LABEL[o.value] ?? o.label }))} selected={state.filters.due ?? []} onApply={(values) => go(withFilter(state, "due", values))} />`.
- [ ] **Step 4: wizard header** — `[employeeId]/page.tsx`: `const today = localDateISO(new Date());`; inside the badge `<span>` after the employment text:
```tsx
            {employee.dueAt
              ? <DuePill dueAt={employee.dueAt} today={today} withDate />
              : active && canMutate && <Link href={`/employees/${employeeId}/edit`} className="text-[10.5px] text-accent underline hover:text-accent-hover">Set a completion date</Link>}
```
- [ ] **Step 5: report** — `report/page.tsx`: import `offboardingCompletionText` and `localDateISO`; add to the `<dl>` a seventh row `<div className="flex gap-2 col-span-2"><dt className="w-24 text-[#667085]">Completion</dt><dd>{offboardingCompletionText(employee.dueAt, data.completedAt, localDateISO(new Date()))}</dd></div>`.
- [ ] **Step 6: stocktakes** — list: `<Th>Close by</Th>` between Opened and Posted; cell `<Td>{s.state === "OPEN" ? <DuePill dueAt={s.dueAt} today={today} withDate /> : <span className="font-mono">{fmtDate(s.dueAt)}</span>}</Td>`. Page `[id]/page.tsx`: badge becomes `<span className="inline-flex items-center gap-1.5"><Pill tone={STATE_TONE[st.state]}>{st.state}</Pill>{st.state === "OPEN" && <DuePill dueAt={st.dueAt} today={today} withDate />}</span>`.
- [ ] **Step 7: Home** — `src/app/(app)/page.tsx` Purchasing block: grid classes → `grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5` (P-8); add after the Expiring tile `<Stat label="Stocktakes past close-by" value={<Link href="/stock/stocktakes" className="hover:underline">{d.stocktakesOverdue}</Link>} />`.
- [ ] **Step 8: Verify** — `npx tsc --noEmit`; `npx eslint src/components/employees src/components/stock/stocktake-open-form.tsx "src/app/(app)"`; `npx vitest run`; dev server `npm run dev -- -p 3100` FOREGROUND and walk as IT then Purchasing (the seeded logins): `/offboarding` shows Dennis with "2 d overdue" and the Due facet works; his wizard header shows the pill; his report reads "Still open · 2 d overdue"; `/employees/<dennis>/edit` shows the date and refuses yesterday; `/employees/new` starts on "Choose a department"; `/inventory/work` lists Dennis with the due text; Purchasing: `/stock/stocktakes/new` prefilled, refuses today; the list and page show the pill; Home tile reads 0. Stop the server; port free.
```bash
git commit -m "feat(ui): Phase 23 clock sweep -- complete-by on the employee form (blank department, Manila today), close-by on open stocktake, Due column/facet/sort and wizard pill, report completion line, stocktake close-by column and header, Purchasing tile" -- src/components/employees/employee-form.tsx "src/app/(app)/employees/[id]/edit/page.tsx" src/components/stock/stocktake-open-form.tsx "src/app/(app)/offboarding" src/components/offboarding/offboarding-toolbar.tsx "src/app/(app)/stock/stocktakes" "src/app/(app)/page.tsx"
```

---

### Task 6: Shrink UI — stock forms, purchase draft, supplier form

**Files:** `src/components/stock/issue-form.tsx`, `receive-form.tsx`, `adjust-dialog.tsx`, `write-off-dialog.tsx`, `stocktake-count.tsx`, `src/app/(app)/stock/issue/page.tsx`, `src/app/(app)/stock/receive/page.tsx`, `src/components/purchases/draft-form.tsx`, `src/components/suppliers/supplier-form.tsx`, create `src/components/suppliers/supplier-same-name.tsx`. Facts: A1–A3, A15–A19, B29.

**Interfaces — Consumes:** Task 3's `ReasonField`, `EntityCombobox` `recent`/`autoFocus`; Task 2's `REASON_CHIPS`; Task 4's `recentPicks`, `checkSameSupplierName`. Accessible-name CONTRACT: chips `getByRole("button", { name: "Use reason: <chip>" })`; issue Employee combobox `getByLabel("Employee")` with `role="combobox"`; receive button "Same item again"; supplier warning banner title starts `A supplier named`.

- [ ] **Step 1: issue-form.tsx** — props: `employees: ComboOption[]` (the page maps `{ value: e.id, label: e.name, sub: e.employeeNo }`), `recentEmployees: string[]`, `recentItems: string[]`; drop `EmployeeOption`/`Select` imports if unused. Item combobox: `recent={recentItems} autoFocus`. Employee field:
```tsx
          <FormField label="Employee" error={fieldErrors.employeeId}>
            {(p) => (
              <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={employees} recent={recentEmployees} value={form.employeeId || null}
                onChange={(id) => set("employeeId", id ?? "")} placeholder="Type a name or EMP number…" />
            )}
          </FormField>
```
Purpose: `<ReasonField label="Purpose" error={fieldErrors.reason} value={form.purpose} onChange={(v) => set("purpose", v)} chips={REASON_CHIPS["stock.issue"]} rows={2} className="sm:col-span-2" />`. `issue/page.tsx`: `const user = await requireRole(…)`; `recentPicks(user.id, "employee")` and `recentPicks(user.id, "stock-item")` in the `Promise.all`; pass both.
- [ ] **Step 2: receive-form.tsx** — props gain `recentItems: string[]`, `recentVendors: string[]`; item combobox `recent={recentItems} autoFocus`; supplier `<Select>` → `<EntityCombobox … options={suppliers.map((s) => ({ value: s.id, label: s.name }))} recent={recentVendors} value={form.supplierId || null} onChange={(id) => set("supplierId", id ?? "")} placeholder="Type a supplier name…" />`. Same-item-again: `const [lastItemId, setLastItemId] = useState<string | null>(null); const quantityId = useRef("");` (import `useRef`); in `submit`'s `onOk` add `if (itemId) setLastItemId(itemId);`; Quantity render prop stores `quantityId.current = p.id;`; inside the success `Banner`, after the "View item" link:
```tsx
          {lastItemId && !form.itemId && (
            <Button type="button" size="sm" variant="ghost" className="ml-2"
              onClick={() => { onItemChange(lastItemId); requestAnimationFrame(() => document.getElementById(quantityId.current)?.focus()); }}>
              Same item again
            </Button>
          )}
```
`receive/page.tsx`: `const user = await requireRole(…)`; add the two `recentPicks` reads; pass them.
- [ ] **Step 3: adjust-dialog.tsx** — `openDialog` sets `setQuantity(String(balance))`; mode select `onChange={(e) => { const m = e.target.value as Mode; setMode(m); setQuantity(m === "set" ? String(balance) : ""); }}`; the Reason block (lines 90–99) → `<ReasonField error={fieldErrors.reason} value={reason} onChange={setReason} chips={REASON_CHIPS["stock.adjust"]} disabled={pending} />` (P-10). `write-off-dialog.tsx`: lines 94–103 → `<ReasonField error={fieldErrors.reason} value={reason} onChange={setReason} chips={REASON_CHIPS["stock.write-off"]} disabled={pending} />`. Remove now-unused `Textarea` imports.
- [ ] **Step 4: stocktake-count.tsx** — `lines.map((l, i) => …)` and `autoFocus={i === 0}` on the count `Input`.
- [ ] **Step 5: draft-form.tsx** — on the unit-price `Input` (lines 298–303) add:
```tsx
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (i === units.length - 1 && u.description.trim()) {
                          setUnits((rows) => [...rows, emptyRow()]);
                          requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[aria-label="Line ${i + 2} description"]`)?.focus());
                        }
                      }}
```
- [ ] **Step 6: supplier same-name** — `supplier-same-name.tsx`: the `SameNameCheck` shape (facts A19) without the checkbox — props `{ name: string; excludeId?: string }`, 400 ms debounce, `checkSameSupplierName({ name, excludeId })`, renders `null` or `<Banner tone="attention" title={\`A supplier named "${match.name}" already exists\`}><Link href={\`/purchases/suppliers/${match.id}\`} className="underline">Open it</Link></Banner>`. `supplier-form.tsx`: Name `Input` gets `autoFocus`; under the Name field `<div className="sm:col-span-2"><SupplierSameName name={form.name} excludeId={props.mode === "edit" ? props.id : undefined} /></div>`.
- [ ] **Step 7: Verify** — `npx tsc --noEmit`; `npx eslint src/components/stock src/components/purchases src/components/suppliers "src/app/(app)/stock"`; `npx vitest run`; `npm run dev -- -p 3101` FOREGROUND, curl only (Task 5 owns the Browser pane): `/stock/issue`, `/stock/receive`, `/purchases/suppliers/new` answer 307 signed out; stop it, port 3101 free. Visual checks are Task 9's e2e.
```bash
git commit -m "feat(ui): Phase 23 shrink sweep (stock, purchases, suppliers) -- issue employee typeahead with Recent, purpose chips; receive supplier typeahead, Recent, Same item again; adjust prefilled balance and chips; write-off chips; count autofocus; draft Enter adds a line; supplier same-name warning" -- src/components/stock/issue-form.tsx src/components/stock/receive-form.tsx src/components/stock/adjust-dialog.tsx src/components/stock/write-off-dialog.tsx src/components/stock/stocktake-count.tsx "src/app/(app)/stock/issue/page.tsx" "src/app/(app)/stock/receive/page.tsx" src/components/purchases/draft-form.tsx src/components/suppliers/supplier-form.tsx src/components/suppliers/supplier-same-name.tsx
```

---

### Task 7: Shrink UI — inventory, employee and approval dialogs

**Files:** `src/components/inventory/holder-control.tsx`, `replace-control.tsx`, `status-control.tsx`, `bulk-drawer.tsx`, `asset-form.tsx`, `register-form.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`, `src/app/(app)/inventory/new/page.tsx`, `src/app/(app)/inventory/[id]/edit/page.tsx`, the page that renders `<BulkDrawer` (grep `<BulkDrawer` under `src/app/(app)/inventory`), `src/components/employees/loadout-view.tsx`, `transfer-dialog.tsx`, `slot-exception-controls.tsx`, `src/components/offboarding/item-decision.tsx`, `src/components/approvals/approval-actions.tsx`, `queue-table.tsx`, `src/components/purchases/request-actions.tsx`. Facts: A4–A14, A20, B30.

**Interfaces — Consumes:** Task 3's `ReasonField`, `EntityCombobox` `recent`; Task 2's `REASON_CHIPS`, `chipsForOutcome`; Task 4's `recentPicks`.

- [ ] **Step 1: the reason fields** — replace each `FormField label="Reason" … <Textarea …/>` block with `ReasonField`, keeping its `required`, `hint`, `error`, value/setter and `rows`:
  - `holder-control.tsx` line 155–157 → `chips={isAssign ? REASON_CHIPS["asset.assign"] : props.direct ? chipsForOutcome(outcome) : []}`; assign combobox gets `recent={props.recentEmployees}` (assign-mode props gain `recentEmployees?: string[]`).
  - `replace-control.tsx` 73–75 → `chipsForOutcome(outcome)`.
  - `status-control.tsx` 105–109 → `REASON_CHIPS["asset.status"]`.
  - `bulk-drawer.tsx` 296–306 → `REASON_CHIPS["asset.assign"]`; 325–335 → `REASON_CHIPS["asset.status"]` (keep the hint); its employee `EntityCombobox` gets `recent={recentEmployees}` (new prop `recentEmployees?: string[]`, passed by its page from `recentPicks(user.id, "employee")`).
  - `asset-form.tsx` 486–494 → `REASON_CHIPS["asset.assign"]`.
  - `loadout-view.tsx` 577–586 → `REASON_CHIPS["asset.assign"]` (keep the hint); 621–626 → `direct ? chipsForOutcome(outcome) : []`; 704–709 → `chipsForOutcome(outcome)`.
  - `transfer-dialog.tsx` 133–143 → `REASON_CHIPS["employee.transfer"]`.
  - `slot-exception-controls.tsx` 101–110 and 222–232 → `REASON_CHIPS["policy.exception"]`.
  - `item-decision.tsx` 156–175 → `chips={picked ? chipsForOutcome(picked) : []} rows={2}` (keep the required/hint logic).
  - `approval-actions.tsx` 106–111, `queue-table.tsx` 194–199 → `REASON_CHIPS["approval.reject"]`.
  - `request-actions.tsx` 135–142 → `REASON_CHIPS["purchase.reason"]`.
  Remove each file's `Textarea` import when nothing else uses it.
- [ ] **Step 2: asset-form.tsx** — props gain `recentVendors?: string[]`; Vendor block (366–377) →
```tsx
          <FormField label="Vendor" error={errors.vendorId}>
            {(p) => (
              <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))} recent={recentVendors}
                value={form.vendorId || null} onChange={(id) => setForm((f) => ({ ...f, vendorId: id ?? "" }))}
                placeholder="Type a vendor name…" />
            )}
          </FormField>
```
Upload loop (218–230) →
```ts
          const results = await Promise.all(files.map(async ({ file, kind }) => {
            const fd = new FormData();
            fd.set("assetId", res.data.id); fd.set("kind", kind); fd.set("file", file);
            try { return (await uploadDocument(fd)).ok; } catch { return false; }
          }));
          const failed = results.filter((ok) => !ok).length;
```
`field()` gains `autoFocus?: boolean` passed to `Input`; the tag field passes `autoFocus: mode === "new"`, the Model field `autoFocus: mode === "edit"`. `inventory/new/page.tsx` and `[id]/edit/page.tsx` pass `recentVendors={await recentPicks(user.id, "vendor")}`.
- [ ] **Step 3: register-form.tsx** — `autoFocus` on the Category `Select` (line 332).
- [ ] **Step 4: inventory layout** — `[id]/layout.tsx`: `const recentEmployees = canAssign ? await recentPicks(user.id, "employee") : [];` and `<HolderControl mode="assign" … recentEmployees={recentEmployees} />`.
- [ ] **Step 5: Verify** — `npx tsc --noEmit`; `npx eslint src/components/inventory src/components/employees src/components/offboarding src/components/approvals src/components/purchases/request-actions.tsx "src/app/(app)/inventory"`; `npx vitest run` (`workspaces.test.ts` and any snapshot of these dialogs still green); `npm run dev -- -p 3102` FOREGROUND, curl only: `/inventory/new`, `/inventory/register` answer 307 signed out; stop it, port free.
```bash
git commit -m "feat(ui): Phase 23 shrink sweep (inventory, employees, approvals) -- reason chips in every dialog, vendor typeahead with Recent, parallel document uploads, first-field focus, Recent employees on assign" -- src/components/inventory src/components/employees/loadout-view.tsx src/components/employees/transfer-dialog.tsx src/components/employees/slot-exception-controls.tsx src/components/offboarding/item-decision.tsx src/components/approvals src/components/purchases/request-actions.tsx "src/app/(app)/inventory"
```

---

### Task 8: E2E — `deadlines.spec.ts`

**Files:** create `e2e/deadlines.spec.ts` (8 cases). House rules as every Phase 20–22 spec: reseed in `beforeAll`/`afterAll`; `login` and `waitForHydration` copied from `e2e/stock-lots.spec.ts`; the axe helper (`PROMOTED_RULES`, `AXE_DETAIL`) copied from `e2e/stock-reports.spec.ts`; state-based waits; toasts `{ exact: true }`; DB facts via the file's own `new PrismaClient()`; dates via `localDateISO`/`fmtDate`/`dayFromISO`/`defaultStocktakeDue` imported from `@/lib`.

- [ ] Cases: (1) IT — `/offboarding`: Dennis Ong's row contains "2 d overdue"; `/offboarding?due=overdue` keeps him, `/offboarding?due=on-track` shows "Nobody is offboarding" or no Dennis row; his wizard header contains "2 d overdue". (2) `/employees/<dennis>/edit`: `getByLabel("Complete offboarding by")` has value `localDateISO(dennis.offboardingDueAt)`; fill yesterday → Save → text "Pick today or later"; fill `addDays(today, 3)` → "✓ Saved"; `/employees/<dennis>/history` first rows include field `offboardingDueAt`. (3) `/inventory/work` (P-5): the row "Dennis Ong is leaving" carries the due text; flip Leo Tan (EMP-0095) to OFFBOARDING through `/employees/<leo>/edit` (default date accepted), reload `/inventory/work`, Dennis's row precedes Leo's within "Approvals & leavers", then flip Leo back to ACTIVE. (4) Purchasing — `/stock/stocktakes/new`: "Close by" value equals `defaultStocktakeDue(today)`; fill `today` → "Pick tomorrow or later"; restore the default → Open → the page header shows "due in 3 d"; `/stock/stocktakes` shows it. (5) With that stocktake OPEN: `db.stocktake.update({ where: { id }, data: { dueAt: dayFromISO(addDays(today, -1)) } })` → Purchasing `/` stat "Stocktakes past close-by" reads 1; the list pill reads "1 d overdue"; then `db.stocktake.update({ where: { id }, data: { state: "CANCELLED" } })` (P-7). (6) `/offboarding/<dennis>/report` contains "Still open · 2 d overdue". (7) `/employees/new`: Department reads "Choose a department"; fill the other required fields; Create → "Pick a department". (8) axe on `/offboarding`, `/stock/stocktakes`, `/stock/stocktakes/new`, `/employees/<dennis>/edit`.
- [ ] Run foreground until green, once more; `npx playwright test --list` (count/files); reseed. Commit: `test(e2e): deadlines -- offboarding due column, facet, wizard pill, form floor and history, worklist ordering, stocktake close-by default/floor/pill, overdue tile, report line, blank department, axe (8 cases; --list N / M files)`.

---

### Task 9: E2E — `quick-forms.spec.ts`

**Files:** create `e2e/quick-forms.spec.ts` (9 cases), same house rules as Task 8.

- [ ] Cases (Purchasing unless stated): (1) `/stock/issue`: `getByLabel("Employee")` has `role="combobox"`; type "Den" → option "Dennis Ong"; pick item PN-0001, quantity 1, department (first), click `Use reason: Regular supply` → Purpose reads "Regular supply"; Record issue → toast; then receive 1 of PN-0001 to restore the balance. (2) reload `/stock/issue`: focusing the Employee combobox shows a "Recent" heading with Dennis first; the Item combobox shows PN-0001 under Recent. (3) `/stock/receive`: record a line for OS-0001 → click "Same item again" → item reads OS-0001 and Quantity is focused (`toBeFocused()`). (4) PN-0001 item page: Adjust → Quantity value equals the shown balance in Set mode; `Use reason: Count correction` fills Reason. (5) `/purchases/new` (or a draft): type a description in the last line, press Enter in its unit price → a second line appears; Enter on an empty description adds none. (6) IT — `/employees/new`: Department starts on "Choose a department". (7) `/purchases/suppliers/new`: type the first seeded supplier's name → banner "A supplier named … already exists" with an "Open it" link. (8) PN-0003's page: Write off → chips include `Use reason: Expired`; IT — BR-LT-0166's page: Return → outcome Missing shows `Use reason: Lost`, outcome "Back for triage" shows no chip buttons. (9) axe on `/stock/issue`, `/stock/receive`, `/employees/new`, `/purchases/suppliers/new`.
- [ ] Run foreground until green, once more; `--list`; reseed. Commit: `test(e2e): quick forms -- issue typeahead and chips, Recent group, Same item again, adjust prefilled balance, draft Enter adds a line, blank department, supplier same-name, write-off and return chips, axe (9 cases; --list N / M files)`.

---

### Task 10: Battery, documentation, amendment block

- [ ] **Battery** — `npx tsc --noEmit`; `npx eslint .`; `npx vitest run`; `npx prisma migrate status` (24); `npx playwright test --list`; the seven chunks of HANDOVER §0 item 9 with two additions — `e2e/quick-forms.spec.ts` joins chunk D (`admin, direct-lifecycle, scanner, registration`), `e2e/deadlines.spec.ts` joins chunk F (`transfers, directory, offboarding-v2, it-gaps, oversight, rate-limit`) — `E2E_PORT=3100 --workers=1 --global-timeout=540000`, zero failed, zero did-not-run; `npm run db:seed` last; port free before, between and after.
- [ ] **Documents** — HANDOVER line 3 parenthetical (Phase 23 CODE-COMPLETE, UNMERGED, UNPUSHED; 24 migrations; `D-1`…`D-n`; battery), a new **(p)** block after (o), §0 item 9's chunk lines updated; PICKUP rows (Branch, Database 24 on the branch / main and staging at 23, a Battery row, Last two phases 23 then 22, §4 item 1); the plan's D-block above "## File structure"; the spec's Status line.
- [ ] Commit: `docs(handover,pickup,plan): Phase 23 code-complete -- battery N e2e / M files, K unit, 24 migrations; (p) block; D-1..D-n`.

---

## Self-review (writing-plans checklist, run 2026-09-17)

1. **Spec coverage.** §2 → Task 1; §3 → Tasks 5, 7 (pages pass Recent); §4.1–§4.3 → Task 2; §4.4 → Tasks 2 (stock), 4 (employee schema); §4.5–§4.7 → Tasks 2, 4; §5 → Task 4; §6.1 → Task 3; §6.2–§6.5 → Task 5; §7 → Tasks 4, 5, 6; §8 → Tasks 6, 7 (every row of the table has a step; loadout-view's combobox row is void per P-2); §9 → Tasks 2, 8, 9, 10; §10–§11 → this plan. No gap.
2. **Placeholders.** None: every step shows the code or names the file, lines and copy; the one "grep" (the `<BulkDrawer` caller) is the action itself.
3. **Type consistency.** `dueStatus`/`DueStatus` (Task 2) ↔ `DuePill` (Task 3) ↔ pages (Task 5); `leaverRow(LeaverLike, todayISO)` (Task 2) ↔ `home/queries.ts` (Task 4); `dueOf`/`Due` (Task 2) ↔ `listOffboarding` (Task 4) ↔ toolbar facet values `overdue`/`on-track` (Task 5); `recentOptions` (Task 2) ↔ `EntityCombobox.recent` (Task 3) ↔ every `recent=` prop (Tasks 6, 7) ↔ `recentPicks(userId, kind)` (Task 3/4) with kinds `employee`/`stock-item`/`vendor`; `chipsForOutcome` accepts both `ReturnOutcome` and offboarding `Outcome` members; `stocktakeOpenSchema.dueAt` (Task 2) ↔ `openStocktake` (Task 4) ↔ `stocktake-open-form` (Task 5); `offboardingCompletionText(dueAt, completedAt, today)` (Task 2) ↔ `WizardData.completedAt` (Task 4) ↔ report (Task 5); `PurchasingHome.stocktakesOverdue` (Task 4) ↔ the tile (Task 5).
