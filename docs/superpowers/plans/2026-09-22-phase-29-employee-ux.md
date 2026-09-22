# Phase 29 — Laws of UX applied to the employee area — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/employees`, `/employees/new` and `/employees/[id]` obey the Laws of UX the operators feel daily: one loudest thing per screen, fewer and clearer choices, targets you can see, feedback in the moment, tolerant input, an ending worth the task.

**Architecture:** Pure rules first (`loadout.ts`: the profile's state-chosen primary, tile ordering, tile menu items; `employees-list.ts`: the department search term and the in-memory Loadout ordering; new `employee-no.ts` and `policy-preview.ts` rules), then the server (three read-only actions, `checkSameName` forwarding the id, `createEmployee` collecting every error, `listEmployees` with the Loadout sort and the hidden-leavers count, `saveLoadoutView`), then the three screens one at a time (each walks the dev server), then the e2e, then the battery and docs. No migration.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, zod 4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-09-22-employee-ux-design.md` (decisions 1–10, §3–§11). Facts gathered before this plan (verbatim current code): the worktree's `.superpowers/sdd/phase-29-ux-audit.md`, `phase-29-plan-facts-profile.md`, `phase-29-plan-facts-form-list.md` — copy them into the SDD workspace's `briefs/`.

## Global Constraints

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write in its transaction; `AuditEntry` append-only — no test deletes audit rows (tests may INSERT and leave them).
- Copy pinned verbatim (spec §8, plus the amendments in P-2, P-3, P-9, P-11 below). No phase numbers in operator-facing text. Product `aria-label`s never contain a nearby field's label word.
- Department stays blank on create ("Choose a department"; the server's "Pick a department"). The reason chips, remembered picks, first-field focus, the created notice and the role discipline are kept.
- Dev only in the worktree `phase-29-employee-uiux` with its own `.env` (`DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`, no `SEED_PASSWORD`); never read or print `.env`. Dev server for a walk: `npm run dev -- -p 3100`, never 3000; only ONE implementer walks or runs Playwright at a time; port 3100 free before and after (`netstat -ano | findstr :3100 | findstr LISTENING`). Playwright foreground, `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`.
- Docs are CRLF; HANDOVER's lettered blocks are not in one order — anchor edits on block headers. Commits carry the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; `git add` new files before a pathspec commit; never amend; never `git stash`/`checkout --`/`restore`/`reset`/`switch`.
- Task-end gate for every task: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` all clean. Baseline: 88 files / 1532 tests; 26 migrations up to date.
- The worktree branch sits at `67f4e9e`; before Task 1 the executor runs `git merge --ff-only main` inside the worktree so the spec (401b838) and this plan are in its history.

## Plan-level decisions (P-1…P-13; the D-block records anything execution changes)

- **P-1 Order:** T1 → T2 → T3 (walks) → T4 (walks) → T5 (walks) → T6 (walks) → T7 (Playwright) → T8 (battery + docs). Strictly sequential — every screen task walks the one dev server.
- **P-2 The two list toggles stay links.** `directory.spec.ts`, `import-export.spec.ts` and `it-core.spec.ts` reach "Show leavers"/"Hide leavers"/"Policy gaps only" by `getByRole("link")`. They become pill-shaped links with a leading `✓` when on and keep `aria-current`; spec §6.2's `role="switch"` is not applied (a link with a switch role is a lie to AT). *Spec §6.2 amended.*
- **P-3 The same-name refusal keeps its pinned sentence, in the banner.** `createEmployee` returns the refusal under the key `_sameName` (no FormField claims it); the form hands it to `SameNameCheck`, which shows it as the banner's body line — the exact text `Another {name} exists in {department} ({no}) — tick 'This is a different person' to add them anyway` — so `directory.spec.ts:84`'s substring still appears once, under the checkbox it names. No field error under Name. *Spec §5.4 amended.*
- **P-4 The Loadout sort runs in memory over the candidate set:** `pageEmployees` gets a `"loadout"` branch shaped like `gapKeptIds` — fetch candidates (`where`, tiebreak `name asc, id asc`), `resolveMissing`, order with the pure `orderByLoadout(rows, dir)` (asc = most required gaps first, `null` last; desc = fewest first, `null` still last), then page in memory. `buildEmployeeOrderBy` never sees the key.
- **P-5 Header dialogs become controlled.** `TransferDialog` and `StartOffboardingDialog` lose their own trigger buttons and take `open`/`onClose`; a new client `ProfileActions` owns the state-chosen primary, Edit, the More menu and both dialogs. The e2e that clicked the bare "Transfer"/"Start offboarding" buttons (`transfers.spec.ts`, `it-nav.spec.ts`) open the More menu first (T7).
- **P-6 "Fill N gaps" / "Assign kit" reach the grid through one DOM event:** `ProfileActions` dispatches `window.dispatchEvent(new CustomEvent("br:loadout", { detail: { action: "focus-gap" | "fill-first" } }))`; `LoadoutView` listens and focuses the first empty required tile or opens its Fill dialog. No ref threading across the server boundary.
- **P-7 Filled tiles are `Menu` triggers, and the ⋯ stays.** A filled tile's `<button>` is the `Menu` trigger (click/Enter/Space open it; Backspace clicks it); the always-visible ⋯ sibling is a second `Menu` with the same items, keeping the accessible name `Actions for the {name} slot` that `custody.spec.ts` pins. Empty tiles keep click → Fill and their ⋯ (Reserve, Waive). *Spec §4.4 amended.*
- **P-8 The tag inside a tile stays text, not a link.** A link nested in the tile button fails axe `nested-interactive` (the same reason the ⋯ is a sibling). The tag loses the accent colour that made it look like a link (`text-fg` mono); "Open record" in the menu is the route. *Spec §4.4 amended.*
- **P-9 The Replace combobox excludes what cannot be picked.** `EntityCombobox` has no disabled options, so spares held for someone else and spares with a queued approval are left out of the Replace list, with a muted line under the field: `{n} more spare(s) are held or queued for someone else`. Reserved-for-this-person spares stay in, marked `· reserved for them` in `sub`. The Fill dialog keeps its radiogroup (disabled rows with their note). *Spec §4.5 amended.*
- **P-10 Feedback plumbing is new:** `LoadoutView` gains `busySlotId` / `changedSlotId` state; tiles carry `data-pending`/`aria-busy` and `data-changed`; `globals.css` gains a 2 s `changed-ring` keyframe. The toast is unchanged.
- **P-11 `saveLoadoutView` is its own action** in `src/server/preferences.ts` (`saveColumns`'s upsert shape, key `view:loadout`, value `"slots" | "table"`); the page reads the row and passes `initialView`. Fire-and-forget from the toggle.
- **P-12 `employeeNo` has no case-insensitive index** (migration 26 skipped `Employee`); `checkEmployeeNo` repeats the app-level `mode: "insensitive"` query `createEmployee` already uses. No migration.
- **P-13 The new spec joins chunk E1**; expected `--list` 389 tests / 38 files.

---

## File structure

- **Rules (pure):** `src/lib/loadout.ts` (+test) — `profilePrimary`, `orderTiles`, `tileMenuItems`; `src/lib/employees-list.ts` (+test) — department term, `orderByLoadout`; `src/lib/employee-no.ts` (+test, new) — `nextEmployeeNo`; `src/lib/policy-preview.ts` (+test, new) — `previewPolicyFor`.
- **Server:** `src/server/modules/employees/actions.ts` (`checkEmployeeNo`, `nextEmployeeNo`, `previewPolicy`, `checkSameName` id, `createEmployee` all errors); `queries.ts` (`listEmployees` loadout sort + `hiddenLeavers`); `src/server/preferences.ts` (`saveLoadoutView`).
- **Profile:** `src/components/employees/profile-actions.tsx` (new), `transfer-dialog.tsx`, `start-offboarding-dialog.tsx`, `transfers-card.tsx`, `loadout-view.tsx`, `src/app/(app)/employees/[id]/page.tsx`, `src/app/globals.css`.
- **Form:** `src/components/employees/employee-form.tsx`, `same-name-check.tsx`, `employee-no-check.tsx` (new), `policy-preview.tsx` (new).
- **List:** `src/app/(app)/employees/page.tsx`, `src/components/employees/employees-toolbar.tsx`, `employees-table.tsx`.
- **e2e:** `e2e/employee-ux.spec.ts` (new); `e2e/it-nav.spec.ts`, `e2e/transfers.spec.ts` (More-menu adaptations).
- **Docs (T8):** `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, the spec's Status, this plan's D-block.

---

### Task 1: Pure rules

**Files:**
- Modify: `src/lib/loadout.ts`, `src/lib/loadout.test.ts`; `src/lib/employees-list.ts`, `src/lib/employees-list.test.ts`
- Create: `src/lib/employee-no.ts`, `src/lib/employee-no.test.ts`; `src/lib/policy-preview.ts`, `src/lib/policy-preview.test.ts`

**Interfaces — Produces:**
- `profilePrimary(input: { employment: string; totalSlots: number; filled: number; missingRequired: number }): { kind: "assign-kit" | "fill-gaps" | "wizard"; label: string } | null`
- `orderTiles<T extends { asset: unknown | null; required: boolean; coveredByLoan: boolean }>(tiles: T[]): T[]`
- `tileMenuItems(tile: { filled: boolean; pending: boolean; required: boolean; exceptionId: string | null; waivable: boolean }, ctx: { mayAct: boolean; direct: boolean }): TileMenuItem[]` where `TileMenuItem = "replace" | "return" | "open" | "reserve" | "waive" | "remove-exception"`
- `orderByLoadout<T extends { missingRequired: number | null; name: string; id: string }>(rows: T[], dir: "asc" | "desc"): T[]`; `EMPLOYEES_LIST_CONFIG.sortable` gains `"loadout"`; `buildEmployeeWhere`'s `q` OR gains the department name term.
- `nextEmployeeNo(existing: readonly string[]): string | null`; `previewPolicyFor(title, departmentId, policies): { name: string; slots: number; via: "title" | "department" } | null`.

- [ ] **Step 1: Tests for `loadout.ts` additions** — append to `src/lib/loadout.test.ts`:

```ts
import { orderTiles, profilePrimary, tileMenuItems } from "./loadout";

describe("profilePrimary — one state-chosen primary per profile (spec §4.1)", () => {
  it("day one: every slot empty → Assign kit", () => {
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 0, missingRequired: 5 })).toEqual({ kind: "assign-kit", label: "Assign kit" });
  });
  it("gaps → Fill N gap(s), singular and plural", () => {
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 3, missingRequired: 1 })).toEqual({ kind: "fill-gaps", label: "Fill 1 gap" });
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 2, missingRequired: 3 })).toEqual({ kind: "fill-gaps", label: "Fill 3 gaps" });
  });
  it("complete, or no policy → none", () => {
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 6, missingRequired: 0 })).toBeNull();
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 0, filled: 0, missingRequired: 0 })).toBeNull();
  });
  it("a leaver → the wizard; offboarded → none", () => {
    expect(profilePrimary({ employment: "OFFBOARDING", totalSlots: 6, filled: 0, missingRequired: 5 })).toEqual({ kind: "wizard", label: "Open the offboarding wizard" });
    expect(profilePrimary({ employment: "OFFBOARDED", totalSlots: 6, filled: 0, missingRequired: 5 })).toBeNull();
  });
});

describe("orderTiles — required gaps first, then filled, then optional gaps (spec §4.4)", () => {
  const t = (id: string, asset: boolean, required: boolean, coveredByLoan = false) => ({ id, asset: asset ? { id } : null, required, coveredByLoan });
  it("keeps relative order inside each band", () => {
    const tiles = [t("a", true, true), t("b", false, false), t("c", false, true), t("d", true, false), t("e", false, true)];
    expect(orderTiles(tiles).map((x) => x.id)).toEqual(["c", "e", "a", "d", "b"]);
  });
  it("a loan-covered empty required tile is not a gap — it sits with the filled", () => {
    expect(orderTiles([t("a", false, true, true), t("b", false, true)]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("tileMenuItems — what a tile's menu offers (spec §4.4)", () => {
  const ctx = { mayAct: true, direct: true };
  it("a filled tile: Replace, Return, Open record, then Waive for a required policy slot", () => {
    expect(tileMenuItems({ filled: true, pending: false, required: true, exceptionId: null, waivable: true }, ctx)).toEqual(["replace", "return", "open", "waive"]);
  });
  it("a filled exception tile offers Remove exception instead of Waive", () => {
    expect(tileMenuItems({ filled: true, pending: false, required: true, exceptionId: "x1", waivable: false }, ctx)).toEqual(["replace", "return", "open", "remove-exception"]);
  });
  it("a pending tile only opens the record", () => {
    expect(tileMenuItems({ filled: true, pending: true, required: true, exceptionId: null, waivable: true }, ctx)).toEqual(["open"]);
  });
  it("an empty tile: Reserve (direct only) and Waive", () => {
    expect(tileMenuItems({ filled: false, pending: false, required: true, exceptionId: null, waivable: true }, ctx)).toEqual(["reserve", "waive"]);
    expect(tileMenuItems({ filled: false, pending: false, required: true, exceptionId: null, waivable: true }, { mayAct: true, direct: false })).toEqual(["waive"]);
  });
  it("without mayAct, a filled tile only opens the record and an empty tile has nothing", () => {
    expect(tileMenuItems({ filled: true, pending: false, required: true, exceptionId: null, waivable: true }, { mayAct: false, direct: false })).toEqual(["open"]);
    expect(tileMenuItems({ filled: false, pending: false, required: true, exceptionId: null, waivable: true }, { mayAct: false, direct: false })).toEqual([]);
  });
  it("Replace needs the direct path; the request path still returns", () => {
    expect(tileMenuItems({ filled: true, pending: false, required: true, exceptionId: null, waivable: true }, { mayAct: true, direct: false })).toEqual(["return", "open", "waive"]);
  });
});
```

- [ ] **Step 2: Run — FAIL.** Append to `src/lib/loadout.ts`:

```ts

/** Phase 29 (spec §4.1): the header's one state-chosen primary; null when Edit should lead. */
export function profilePrimary(input: { employment: string; totalSlots: number; filled: number; missingRequired: number }): { kind: "assign-kit" | "fill-gaps" | "wizard"; label: string } | null {
  if (input.employment === "OFFBOARDING") return { kind: "wizard", label: "Open the offboarding wizard" };
  if (input.employment !== "ACTIVE" || input.totalSlots === 0) return null;
  if (input.filled === 0 && input.missingRequired > 0) return { kind: "assign-kit", label: "Assign kit" };
  if (input.missingRequired > 0) return { kind: "fill-gaps", label: `Fill ${input.missingRequired} gap${input.missingRequired === 1 ? "" : "s"}` };
  return null;
}

/** Phase 29 (spec §4.4): required gaps first, then filled (and loan-covered) tiles, then optional gaps — stable within each band. */
export function orderTiles<T extends { asset: unknown | null; required: boolean; coveredByLoan: boolean }>(tiles: T[]): T[] {
  const band = (t: T) => (!t.asset && !t.coveredByLoan ? (t.required ? 0 : 2) : 1);
  return [...tiles].sort((a, b) => band(a) - band(b));
}

export type TileMenuItem = "replace" | "return" | "open" | "reserve" | "waive" | "remove-exception";

/** Phase 29 (spec §4.4): the items a tile's menu offers, in order. Pure so the view and the tests agree. */
export function tileMenuItems(
  tile: { filled: boolean; pending: boolean; required: boolean; exceptionId: string | null; waivable: boolean },
  ctx: { mayAct: boolean; direct: boolean },
): TileMenuItem[] {
  if (tile.filled) {
    if (tile.pending || !ctx.mayAct) return ["open"];
    const items: TileMenuItem[] = [];
    if (ctx.direct) items.push("replace");
    items.push("return", "open");
    if (tile.exceptionId) items.push("remove-exception");
    else if (tile.waivable) items.push("waive");
    return items;
  }
  if (!ctx.mayAct) return [];
  const items: TileMenuItem[] = [];
  if (ctx.direct) items.push("reserve");
  if (tile.exceptionId) items.push("remove-exception");
  else if (tile.waivable) items.push("waive");
  return items;
}
```

- [ ] **Step 3: Run — PASS** (`npx vitest run src/lib/loadout.test.ts`).

- [ ] **Step 4: Tests for `employees-list.ts`** — in `src/lib/employees-list.test.ts` change the first test's expected `OR` to four terms and add the new describes:

```ts
      OR: [
        { name: { contains: "mar", mode: "insensitive" } },
        { employeeNo: { contains: "mar", mode: "insensitive" } },
        { title: { contains: "mar", mode: "insensitive" } },
        { department: { name: { contains: "mar", mode: "insensitive" } } },
      ],
```

```ts
import { orderByLoadout } from "./employees-list";

describe("the Loadout sort key (spec decision 8)", () => {
  it("is declared sortable and never reaches buildEmployeeOrderBy", () => {
    expect(EMPLOYEES_LIST_CONFIG.sortable).toEqual(["name", "employeeNo", "joinedAt", "loadout"]);
  });
  const rows = [
    { id: "1", name: "Ana", missingRequired: 0 }, { id: "2", name: "Ben", missingRequired: 3 },
    { id: "3", name: "Cy", missingRequired: null }, { id: "4", name: "Dee", missingRequired: 1 }, { id: "5", name: "Eve", missingRequired: 3 },
  ];
  it("ascending completeness: most gaps first, ties by name, no policy last", () => {
    expect(orderByLoadout(rows, "asc").map((r) => r.id)).toEqual(["2", "5", "4", "1", "3"]);
  });
  it("descending: fewest gaps first, no policy still last", () => {
    expect(orderByLoadout(rows, "desc").map((r) => r.id)).toEqual(["1", "4", "2", "5", "3"]);
  });
});
```

- [ ] **Step 5: Run — FAIL.** In `src/lib/employees-list.ts`: `sortable: ["name", "employeeNo", "joinedAt", "loadout"]`; in `buildEmployeeWhere` add `{ department: { name: { contains: state.q, mode: "insensitive" } } },` as the fourth OR term; make `buildEmployeeOrderBy` skip the key: `const order = (sort.length ? sort : EMPLOYEES_LIST_CONFIG.defaultSort).filter((s) => s.key !== "loadout");` with a comment `// "loadout" is derived, not a column — pageEmployees orders it in memory (plan P-4)`; append:

```ts

/**
 * Phase 29 (spec decision 8): completeness ascending = the least complete first (most required gaps),
 * descending the reverse; people with no policy sort last either way; ties by name then id.
 */
export function orderByLoadout<T extends { missingRequired: number | null; name: string; id: string }>(rows: T[], dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.missingRequired === null || b.missingRequired === null) {
      if (a.missingRequired === b.missingRequired) return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      return a.missingRequired === null ? 1 : -1;
    }
    return sign * (a.missingRequired - b.missingRequired) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
```

(`buildEmployeeOrderBy([])` with the filter still falls back to `[{ name: "asc" }, { id: "asc" }]`; add a test that `buildEmployeeOrderBy([{ key: "loadout", dir: "asc" }])` returns the default order.)

- [ ] **Step 6: Run — PASS.**

- [ ] **Step 7: `employee-no.ts`** — test first (`src/lib/employee-no.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { nextEmployeeNo } from "./employee-no";

describe("nextEmployeeNo — the next free EMP-#### (spec §5.2)", () => {
  it("is highest + 1, zero-padded to four digits", () => {
    expect(nextEmployeeNo(["EMP-0042", "EMP-0099", "EMP-0071"])).toBe("EMP-0100");
    expect(nextEmployeeNo(["EMP-9999"])).toBe("EMP-10000");
  });
  it("ignores numbers that do not follow the pattern, case-insensitively matching the prefix", () => {
    expect(nextEmployeeNo(["EMP-0007", "CONTRACTOR-1", "emp-0010"])).toBe("EMP-0011");
  });
  it("gaps stay gaps; nothing matching → null", () => {
    expect(nextEmployeeNo(["EMP-0001", "EMP-0003"])).toBe("EMP-0004");
    expect(nextEmployeeNo(["T-1", ""])).toBeNull();
    expect(nextEmployeeNo([])).toBeNull();
  });
});
```

Then `src/lib/employee-no.ts`:

```ts
/** Phase 29 (spec §5.2): the seed's EMP-#### habit, read off the table — nothing enforces it, so it is a suggestion, never a prefill. */
const PATTERN = /^EMP-(\d+)$/i;

export function nextEmployeeNo(existing: readonly string[]): string | null {
  let max = -1;
  for (const no of existing) {
    const m = PATTERN.exec(no.trim());
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  if (max < 0) return null;
  return `EMP-${String(max + 1).padStart(4, "0")}`;
}
```

- [ ] **Step 8: `policy-preview.ts`** — test first (`src/lib/policy-preview.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { previewPolicyFor } from "./policy-preview";

const policies = [
  { id: "p-dept", name: "Finance standard", appliesToTitle: null, appliesToDepartmentId: "dept-fin", slots: [{ id: "s1" }, { id: "s2" }] },
  { id: "p-title", name: "Team lead kit", appliesToTitle: "Team Lead", appliesToDepartmentId: null, slots: [{ id: "s3" }] },
];

describe("previewPolicyFor — what the typed title will resolve to (spec §5.3)", () => {
  it("title beats department", () => {
    expect(previewPolicyFor("team lead", "dept-fin", policies)).toEqual({ name: "Team lead kit", slots: 1, via: "title" });
  });
  it("falls back to the department policy", () => {
    expect(previewPolicyFor("Accountant", "dept-fin", policies)).toEqual({ name: "Finance standard", slots: 2, via: "department" });
  });
  it("nothing typed, or nothing matching → null", () => {
    expect(previewPolicyFor("", "dept-fin", policies)).toBeNull();
    expect(previewPolicyFor("Contractor", "dept-ops", policies)).toBeNull();
  });
});
```

Then `src/lib/policy-preview.ts`:

```ts
import { resolvePolicy, type PolicyLike } from "./loadout";

/** Phase 29 (spec §5.3): the New form's live line under Title — the same resolution the profile uses. */
export function previewPolicyFor<P extends PolicyLike & { slots: unknown[] }>(
  title: string, departmentId: string, policies: P[],
): { name: string; slots: number; via: "title" | "department" } | null {
  if (!title.trim()) return null;
  const policy = resolvePolicy({ title, departmentId }, policies);
  if (!policy) return null;
  const via = policy.appliesToTitle?.trim().toLowerCase() === title.trim().toLowerCase() ? "title" : "department";
  return { name: policy.name, slots: policy.slots.length, via };
}
```

- [ ] **Step 9: Gate** — `npx vitest run` (91 files), `npx tsc --noEmit`, `npx eslint .` clean.
- [ ] **Step 10: Commit** — `git add src/lib/loadout.ts src/lib/loadout.test.ts src/lib/employees-list.ts src/lib/employees-list.test.ts src/lib/employee-no.ts src/lib/employee-no.test.ts src/lib/policy-preview.ts src/lib/policy-preview.test.ts` · `git commit -m "feat(rules): Phase 29 -- profilePrimary, orderTiles, tileMenuItems; Loadout sort and department search on the employees list; nextEmployeeNo; previewPolicyFor" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 2: Server — three read-only actions, one-pass validation, the Loadout sort, the view preference

**Files:**
- Modify: `src/server/modules/employees/actions.ts` (`checkSameName` L467–494, `createEmployee` L393–465, + three new actions), `src/server/modules/employees/queries.ts` (`pageEmployees` L68–90, `listEmployees` L100–124), `src/server/preferences.ts`

**Interfaces — Produces:**
- `checkSameName` → `ActionResult<{ match: { id: string; employeeNo: string; department: string } | null }>`
- `checkEmployeeNo(input: { employeeNo: string })` → `ActionResult<{ taken: { id: string; name: string } | null }>`
- `nextEmployeeNo()` → `ActionResult<{ next: string | null }>`
- `previewPolicy(input: { title: string; departmentId: string })` → `ActionResult<{ preview: { name: string; slots: number; via: "title" | "department" } | null }>`
- `createEmployee` returns every field error in one `validationError`; the same-name refusal under key `_sameName` (P-3).
- `listEmployees(state, gapsOnly)` → adds `hiddenLeavers: number`; honours a `loadout` sort key (P-4).
- `saveLoadoutView(input: { view: "slots" | "table" })` → `ActionResult<null>`; `loadoutViewFor(userId): Promise<"slots" | "table">` (read helper, exported from `src/server/preferences.ts`).

- [ ] **Step 1: `checkSameName` forwards the id** — last line: `return ok({ match: match ? { id: match.id, employeeNo: match.employeeNo, department: match.department } : null });` and the return type accordingly.

- [ ] **Step 2: Three new read-only actions** (after `checkSameName`; imports: `nextEmployeeNo as nextNo` from `@/lib/employee-no`, `previewPolicyFor` from `@/lib/policy-preview`):

```ts
const checkEmployeeNoSchema = z.object({ employeeNo: z.string() });

/** Phase 29 (spec §5.2): read-only — the create form's live number check; the same insensitive query createEmployee refuses on. */
export async function checkEmployeeNo(input: unknown): Promise<ActionResult<{ taken: { id: string; name: string } | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = checkEmployeeNoSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const no = parsed.data.employeeNo.trim();
  if (!no) return ok({ taken: null });
  const taken = await prisma.employee.findFirst({ where: { employeeNo: { equals: no, mode: "insensitive" } }, select: { id: true, name: true } });
  return ok({ taken });
}

/** Phase 29 (spec §5.2): the next free EMP-#### — a suggestion the operator accepts with one click, never a prefill. */
export async function nextEmployeeNo(): Promise<ActionResult<{ next: string | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const rows = await prisma.employee.findMany({ select: { employeeNo: true } });
  return ok({ next: nextNo(rows.map((r) => r.employeeNo)) });
}

const previewPolicySchema = z.object({ title: z.string(), departmentId: z.string() });

/** Phase 29 (spec §5.3): read-only — which policy the typed title (or the department) will resolve to. */
export async function previewPolicy(input: unknown): Promise<ActionResult<{ preview: { name: string; slots: number; via: "title" | "department" } | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = previewPolicySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const policies = await prisma.equipmentPolicy.findMany({ include: { slots: { select: { id: true } } }, orderBy: [{ name: "asc" }] });
  return ok({ preview: previewPolicyFor(parsed.data.title, parsed.data.departmentId, policies) });
}
```

- [ ] **Step 3: `createEmployee` collects every error.** Replace the early-return block from `const joinedAt = …` through the `if (taken) return …` with:

```ts
  const errors: Record<string, string> = {};
  const joinedAt = new Date(`${d.joinedAt}T00:00:00Z`);
  if (Number.isNaN(joinedAt.getTime())) errors.joinedAt = "Use the date picker";
  if (!(await prisma.department.findUnique({ where: { id: d.departmentId } }))) errors.departmentId = "Unknown department";
  const today = localDateISO(new Date());
  if (d.employment === "OFFBOARDING" && d.offboardingDueAt && d.offboardingDueAt < minOffboardingDue(today)) {
    errors.offboardingDueAt = "Pick today or later";
  }
  // Phase 20 (spec §5) → Phase 29 (plan P-3): the same-name warning is one statement, carried under a key no field
  // claims so the form hands it to the banner that holds the checkbox — never under Name.
  if (!d.confirmSameName && !errors.departmentId) {
    const match = await findSameName(d.name, d.departmentId);
    if (match) {
      errors._sameName = `Another ${d.name} exists in ${match.department} (${match.employeeNo}) — tick 'This is a different person' to add them anyway`;
    }
  }
  const taken = await prisma.employee.findFirst({ where: { employeeNo: { equals: d.employeeNo, mode: "insensitive" } }, select: { id: true } });
  if (taken) errors.employeeNo = "That employee number is already in use";
  if (Object.keys(errors).length) return validationError(errors);
```

(Everything after — `data`, the transaction, the `P2002` catch, `revalidatePath("/employees")`, `ok({ id })` — unchanged.)

- [ ] **Step 4: `pageEmployees` — the `loadout` branch and the hidden-leavers count** (`queries.ts`). Import `orderByLoadout` from `@/lib/employees-list` and `pageOf` (already imported). Replace `pageEmployees` with:

```ts
/** Spec §4: the plain list pages in SQL; the gaps filter and the Loadout sort (Phase 29, plan P-4) cut a NARROW candidate pass first, then page in memory. */
async function pageEmployees(state: ListState, gapsOnly: boolean) {
  const where = buildEmployeeWhere(state);
  const orderBy = buildEmployeeOrderBy(state.sort);
  const loadoutSort = state.sort.find((s) => s.key === "loadout");
  if (!gapsOnly && !loadoutSort) {
    const { rows: employees, ...pg } = await pagedSnapshot(
      ENTITY_PAGE_SIZE,
      state.page,
      (tx) => tx.employee.count({ where }),
      (tx, pg) => tx.employee.findMany({ where, orderBy, skip: pg.skip, take: pg.take, include: rowInclude }),
    );
    const missing = await resolveMissing(employees);
    return { pg, employees, missing };
  }
  // Candidate pass: everything the where admits, resolved once; then the gaps cut and/or the derived order.
  const candidates = await prisma.employee.findMany({ where, orderBy, include: rowInclude });
  const missingAll = await resolveMissing(candidates);
  let kept = gapsOnly ? candidates.filter((c) => (missingAll.get(c.id) ?? 0) > 0) : candidates;
  if (loadoutSort) {
    kept = orderByLoadout(kept.map((c) => ({ ...c, missingRequired: missingAll.get(c.id) ?? null })), loadoutSort.dir);
  }
  const pg = pageOf(kept.length, state.page, ENTITY_PAGE_SIZE);
  const employees = kept.slice(pg.skip, pg.skip + pg.take);
  return { pg, employees, missing: missingAll };
}
```

Keep `gapKeptIds` — `employeeExportRows` (queries.ts L164) still calls it; the export path is untouched this phase. Then `listEmployees` adds the count: after `pageEmployees`, `const hiddenLeavers = state.filters.employment?.length || (state.filters.leavers ?? []).includes("1") ? 0 : await prisma.employee.count({ where: { ...buildEmployeeWhere({ ...state, filters: { ...state.filters, leavers: ["1"] } }), employment: "OFFBOARDED" } });` and return it (`hiddenLeavers`) beside `total`.

- [ ] **Step 5: `saveLoadoutView` and `loadoutViewFor`** — `src/server/preferences.ts`:

```ts
const LOADOUT_VIEW_KEY = "view:loadout";
const loadoutViewSchema = z.object({ view: z.enum(["slots", "table"]) });

/** Phase 29 (spec §4.8): the Slots/Table choice, per user — the same upsert shape as saveColumns; not audited. */
export async function saveLoadoutView(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = loadoutViewSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  await prisma.userPreference.upsert({
    where: { userId_key: { userId: user.id, key: LOADOUT_VIEW_KEY } },
    update: { value: parsed.data.view },
    create: { userId: user.id, key: LOADOUT_VIEW_KEY, value: parsed.data.view },
  });
  return ok(null);
}
```

and in a NEW non-"use server" module `src/server/loadout-view.ts` (a `"use server"` file may export only async functions — fine, but keep the reader beside the other readers): `export async function loadoutViewFor(userId: string): Promise<"slots" | "table"> { const row = await prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "view:loadout" } }, select: { value: true } }); return row?.value === "table" ? "table" : "slots"; }`.

- [ ] **Step 6: Proof against `inventory_dev`** (read-only `npx tsx scratch-t2.ts` in the worktree root, deleted before the commit): `listEmployees({ q: "", page: 1, sort: [{ key: "loadout", dir: "asc" }], filters: {} }, false)` → the first rows carry the largest `missingRequired`, `null`s last, and `hiddenLeavers` is 1 on the seed; `q: "finance"` returns the Finance people; `previewPolicyFor` via the raw query for `"Analyst"` in Finance → "Finance standard". Record the printed lines.

- [ ] **Step 7: Gate** — tsc, eslint, vitest clean. (`same-name-check.tsx` still compiles: its `match` type is narrower than the new payload — widen it in Task 5; if tsc complains here, type the state as `{ id?: string; employeeNo: string; department: string }` now.)
- [ ] **Step 8: Commit** — the three server files (+ `src/server/loadout-view.ts`): `feat(employees): Phase 29 -- checkEmployeeNo, nextEmployeeNo, previewPolicy; checkSameName forwards the id; createEmployee returns every error at once; the list sorts by Loadout in memory and counts hidden leavers; saveLoadoutView`.

---

### Task 3: The profile header and panel (walks)

**Files:**
- Create: `src/components/employees/profile-actions.tsx`
- Modify: `src/components/employees/transfer-dialog.tsx`, `start-offboarding-dialog.tsx`, `transfers-card.tsx`; `src/app/(app)/employees/[id]/page.tsx`

**Interfaces — Consumes:** `profilePrimary` (T1); `loadoutViewFor` (T2). **Produces:** `ProfileActions({ employeeId, employeeName, currentTitle, employment, canMutate, primary, departments, defaultDue, minDue })`; `TransferDialog`/`StartOffboardingDialog` take `open`/`onClose` and render no trigger; `LoadoutView` receives `initialView` (wired in T4 — pass it now as an optional prop it ignores until T4, or add the prop in T4 and pass it then; choose the latter and note it).

- [ ] **Step 1: Controlled dialogs.** `transfer-dialog.tsx`: props gain `open: boolean; onClose: () => void`; remove the internal `open` state and the `<Button onClick={openDialog}>Transfer</Button>`; `openDialog`'s reset runs in a `useEffect(() => { if (open) { reset(); setToDepartmentId(departments[0]?.id ?? ""); setToTitle(currentTitle); setEffectiveAt(today()); setReason(""); } }, [open])`; `setOpen(false)` → `onClose()`. Same shape for `start-offboarding-dialog.tsx` (`setDueAt(defaultDue)` in the effect).

- [ ] **Step 2: `profile-actions.tsx`** (client):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { TransferDialog } from "./transfer-dialog";
import { StartOffboardingDialog } from "./start-offboarding-dialog";

/**
 * Phase 29 (spec §4.1): one state-chosen primary, Edit always visible (daily work — decision 1), the rest in More.
 * "Assign kit" and "Fill N gaps" reach the slot grid through one DOM event LoadoutView listens for (plan P-6).
 */
export function ProfileActions({
  employeeId, employeeName, currentTitle, employment, canMutate, primary, departments, defaultDue, minDue,
}: {
  employeeId: string; employeeName: string; currentTitle: string; employment: string; canMutate: boolean;
  primary: { kind: "assign-kit" | "fill-gaps" | "wizard"; label: string } | null;
  departments: Array<{ id: string; name: string }>; defaultDue: string; minDue: string;
}) {
  const router = useRouter();
  const [transferOpen, setTransferOpen] = useState(false);
  const [offboardingOpen, setOffboardingOpen] = useState(false);
  if (!canMutate) return null;

  const items: MenuItem[] = [
    { label: "Timeline", onSelect: () => router.push(`/employees/${employeeId}/timeline`) },
    { label: "Export holdings", onSelect: () => router.push(`/employees/${employeeId}/holdings`) },
  ];
  if (employment === "ACTIVE") {
    items.push({ label: "Transfer…", onSelect: () => setTransferOpen(true) });
    items.push({ label: "Start offboarding…", onSelect: () => setOffboardingOpen(true) });
  }

  function firePrimary() {
    if (!primary) return;
    if (primary.kind === "wizard") { router.push(`/offboarding/${employeeId}`); return; }
    document.getElementById("loadout")?.scrollIntoView({ block: "start" });
    window.dispatchEvent(new CustomEvent("br:loadout", { detail: { action: primary.kind === "assign-kit" ? "fill-first" : "focus-gap" } }));
  }

  return (
    <>
      {primary && <Button variant="primary" onClick={firePrimary}>{primary.label}</Button>}
      <ButtonLink href={`/employees/${employeeId}/edit`}>Edit</ButtonLink>
      <Menu
        align="end"
        items={items}
        trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>}
      />
      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} employeeId={employeeId} employeeName={employeeName} currentTitle={currentTitle} departments={departments} />
      {employment === "ACTIVE" && (
        <StartOffboardingDialog open={offboardingOpen} onClose={() => setOffboardingOpen(false)} employeeId={employeeId} employeeName={employeeName} defaultDue={defaultDue} minDue={minDue} />
      )}
    </>
  );
}
```

(Viewers: the page renders nothing in `actions` — the READ-ONLY pill stays in `badge`.)

- [ ] **Step 3: The page** (`[id]/page.tsx`):
  - imports: drop `ButtonLink`, `StartOffboardingDialog`, `TransferDialog`; add `ProfileActions`, `DuePill` (`@/components/ui/due-pill`), `profilePrimary` (`@/lib/loadout`), `loadoutViewFor` (`@/server/loadout-view`).
  - after `loadout`: `const primary = profilePrimary({ employment: employee.employment, totalSlots: loadout.totalSlots, filled: loadout.filled, missingRequired: loadout.missingRequired });` and `const initialView = await loadoutViewFor(user.id);` (add to the `Promise.all`).
  - `badge`: after the employment text, `{employee.employment === "OFFBOARDING" && employee.offboardingDueAt && <DuePill dueAt={employee.offboardingDueAt} today={today} withDate />}`.
  - `actions`: `<ProfileActions employeeId={id} employeeName={employee.name} currentTitle={employee.title} employment={employee.employment} canMutate={canMutate} primary={primary} departments={otherDepartments} defaultDue={defaultOffboardingDue(today)} minDue={minOffboardingDue(today)} />`.
  - Left panel: delete the `<p className="text-[15px] font-semibold text-fg">{employee.name}</p>` line. Replace the `policy && (…)` progress block with:

```tsx
              {policy && (
                <div className="flex flex-col gap-1" data-testid="loadout-progress">
                  <span className="text-xs font-medium text-fg">
                    {loadout.missingRequired === 0 ? "No required gaps" : `${loadout.missingRequired} required gap${loadout.missingRequired === 1 ? "" : "s"}`}
                  </span>
                  <ProgressBar value={loadout.filled} max={loadout.totalSlots} label="Slots filled" />
                  <span className="font-mono text-[10.5px] text-fg-muted">{loadout.filled} of {loadout.totalSlots} slots filled · {policy.name}</span>
                </div>
              )}
```

  - Stats: `{held.length === 0 ? <p className="text-xs text-fg-muted">No items yet</p> : (<div className="grid grid-cols-2 gap-2"> …the four Stats… </div>)}`.
  - `TransfersCard` unchanged call; `LoadoutView` gets `initialView={initialView}` in Task 4 (leave the prop out here).

- [ ] **Step 4: `transfers-card.tsx`** — when `transfers.length === 0` return `<p className="text-xs text-fg-muted">No transfers</p>` (no `Card`).

- [ ] **Step 5: Walk on 3100** as `it@`: Nina Robles (EMP-0097) → primary "Assign kit", Edit beside it, More holds Timeline / Export holdings / Transfer… / Start offboarding… and each opens; Marites (EMP-0042) → "Fill 1 gap" (the click scrolls to the grid — the focus lands in T4); Dennis Ong (EMP-0090) → the due pill in the header, "Open the offboarding wizard" primary, More without Transfer/Start offboarding; the progress line reads "1 required gap · 3 of 6 slots filled"; "No items yet" on a day-one hire; "No transfers" as one line. As `viewer@`: no actions, the READ-ONLY pill. Stop the server; port free.

- [ ] **Step 6: Gate + commit** — `feat(profile): Phase 29 -- state-chosen primary with Edit kept and a More menu (controlled Transfer/Start offboarding dialogs), the due pill in the header, one number for gaps, the panel and empty cards`.

---

### Task 4: The slot tiles, dialogs, feedback and Table view (walks)

**Files:**
- Modify: `src/components/employees/loadout-view.tsx` (the tile render L400–494, the dialogs L610–830, the view toggle L340–347, the Table branch L498–524, the batch button L348–352, the no-policy banner L361–365), `src/app/(app)/employees/[id]/page.tsx` (`SpareOption.pendingRef`, `initialView`, the no-policy link role), `src/app/globals.css`

**Interfaces — Consumes:** `orderTiles`, `tileMenuItems` (T1); `saveLoadoutView` (T2). **Produces:** `SpareOption.pendingRef: string | null`; `LoadoutView` props gain `initialView: "slots" | "table"` and `canLinkPolicies: boolean`; listens for `br:loadout`.

- [ ] **Step 1: Types and page wiring.** `SpareOption` gains `pendingRef: string | null`; page: `spares` map adds `pendingRef: pendingByAsset.get(a.id) ?? null`; `LoadoutView` gets `initialView={initialView}` and `canLinkPolicies={user.role === "admin" || user.role === "it_staff"}`.

- [ ] **Step 2: State and event.** In `LoadoutView`: `const [view, setView] = useState<"slots" | "table">(initialView);` and `function pickView(v) { setView(v); void saveLoadoutView({ view: v }); }` (fire-and-forget; import from `@/server/preferences`). Add `const [busySlotId, setBusySlotId] = useState<string | null>(null); const [changedSlotId, setChangedSlotId] = useState<string | null>(null);` and a helper `function markChanged(slotId) { setChangedSlotId(slotId); setTimeout(() => setChangedSlotId((c) => (c === slotId ? null : c)), 2000); }`. Every `submit*` sets `setBusySlotId(<the tile's slotId>)` before `startTransition`, clears it in `handle`'s completion (both branches), and calls `markChanged(slotId)` in its `onOk`. The sorted tiles: `const ordered = orderTiles(slots);` used by the grid map and by `tileRefs` indexing (keep `tileRefs` aligned with `ordered`). The event listener:

```ts
  useEffect(() => {
    function onLoadout(e: Event) {
      const action = (e as CustomEvent<{ action: "focus-gap" | "fill-first" }>).detail?.action;
      const idx = ordered.findIndex((t) => !t.asset && !t.coveredByLoan && t.required);
      if (idx < 0) return;
      if (action === "focus-gap") tileRefs.current[idx]?.focus();
      else if (action === "fill-first" && mayAct) openFill(ordered[idx]);
    }
    window.addEventListener("br:loadout", onLoadout);
    return () => window.removeEventListener("br:loadout", onLoadout);
  }, [ordered, mayAct]);
```

with `openFill(tile)` extracted from today's empty-tile `onClick` body (`setFillSlot(tile); setPickedSpare(sole ?? null); …` — see Step 5 for the preselect).

- [ ] **Step 3: The tile render.** Replace the `slots.map((tile, i) => …)` block with a map over `ordered`. Per tile compute:

```tsx
            const a = tile.asset;
            const name = `${tile.name} slot, ${a ? a.model : tile.coveredByLoan ? "on loan" : "empty"}, ${tile.required ? "required" : "optional"}`;
            const kinds = tileMenuItems(
              { filled: !!a, pending: !!a?.pendingRef, required: tile.required, exceptionId: tile.exceptionId, waivable: !tile.exceptionId },
              { mayAct, direct },
            );
            const menuItems: MenuItem[] = kinds.map((k) => {
              switch (k) {
                case "replace": return { label: "Replace…", onSelect: () => { setReplacing(a!); setReplacementId(null); setFieldErrors({}); } };
                case "return": return { label: "Return…", danger: true, onSelect: () => setReturning(a!) };
                case "open": return { label: "Open record", onSelect: () => router.push(`/inventory/${a!.id}`) };
                case "reserve": return { label: "Reserve a spare…", onSelect: () => { setReservingSlot(tile); setReserveSpare(null); setReserveExpiry(defaultHoldExpiry(today)); setReserveReason(""); setFieldErrors({}); setError(null); } };
                case "waive": return { label: "Waive this slot…", onSelect: () => setWaivingSlot(tile) };
                case "remove-exception": return { label: "Remove exception", onSelect: () => removeException(tile.exceptionId!) };
              }
            });
            const reservedHere = !a && holding.find((h) => h.kind === "reserved" && spares.find((s) => s.id === h.id)?.typeId === tile.typeId);
            const busy = busySlotId === tile.slotId;
            const changed = changedSlotId === tile.slotId;
```

The tile body (shared by both branches) is a function `tileBody()` returning today's inner markup with these edits: the stripe `<span … style={{ background: STRIPES }}>` becomes `<span aria-hidden className="h-1.5 w-full rounded-full" style={{ background: a ? `var(--st-${statusFamily(a.status)}-dot)` : "transparent" }} />` (import `statusFamily` from `@/lib/status`; keep the PENDING pill beside the model line instead); the tag `<span className="font-mono text-[11px] text-accent">{a.tag}</span>` → `text-fg` (P-8); the age line loses the hover "− return" hint; the optional empty tile's text `{tile.typeName} · optional` becomes `optional — not a gap` in `text-fg-muted` when `!tile.required && !tile.coveredByLoan`; a reserved-here empty tile adds `<span className="font-mono text-[10px] text-fg-muted">reserved · {reservedHere.tag}</span>` and, when `mayAct && direct`, `<Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); submitAssignReserved(reservedHere.id, tile.slotId); }}>Assign reserved</Button>` — as a SIBLING below the tile button (never inside it).

Render:

```tsx
            const tileClass = cn(
              "flex w-full flex-col gap-1.5 rounded-(--radius-card) border p-3 text-left transition-colors duration-(--dur-1)",
              a ? "border-border bg-surface shadow-card" : "border-dashed border-border-strong",
              !a && tile.required && !tile.coveredByLoan && "bg-[var(--st-attention-bg)]/40",
              mayAct && "hover:border-accent",
              busy && "opacity-60",
              changed && "tile-changed",
            );
            const shared = { "aria-label": name, "data-pending": busy || undefined, "aria-busy": busy || undefined, "data-changed": changed || undefined } as const;
            return (
              <div key={tile.slotId} className="group relative flex flex-col gap-1">
                {!mayAct && !frozen ? (
                  <div role="group" {...shared} className={tileClass}>{tileBody()}</div>
                ) : a ? (
                  <Menu
                    align="start"
                    items={menuItems}
                    trigger={(props) => (
                      <button ref={(el) => { tileRefs.current[i] = el; }} type="button" {...props} {...shared} className={tileClass}>{tileBody()}</button>
                    )}
                  />
                ) : (
                  <button ref={(el) => { tileRefs.current[i] = el; }} type="button" {...shared} className={tileClass} onClick={() => { if (mayAct) openFill(tile); }}>{tileBody()}</button>
                )}
                {menuItems.length > 0 && mayAct && (
                  <div className="absolute right-1.5 top-1.5">
                    <Menu align="end" items={menuItems} trigger={(props) => (
                      <button type="button" {...props} aria-label={`Actions for the ${tile.name} slot`} className="grid size-7 place-items-center rounded-[6px] border border-transparent bg-surface/90 font-mono text-[12px] text-fg-faint shadow-card hover:text-fg">⋯</button>
                    )} />
                  </div>
                )}
                {reservedHere && mayAct && direct && (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => submitAssignReserved(reservedHere.id, tile.slotId)}>Assign reserved</Button>
                )}
              </div>
            );
```

(`Menu`'s root is `inline-flex` — give the tile trigger `w-full` and wrap it so the grid cell stretches: `<div className="[&>div]:w-full">` around the `Menu` if needed; verify visually. The viewer branch: `!mayAct && !frozen` is a viewer; a frozen leaver keeps buttons whose menu is `["open"]`.) `onGridKeyDown`'s Backspace branch: `if (tile.asset) { e.preventDefault(); tileRefs.current[idx]?.click(); }` (opens the menu).

- [ ] **Step 4: `submitAssignReserved(assetId, slotId)`** — direct: `assignAsset({ assetId, employeeId, reason: "" })`; request path: `requestAssign({ employeeId, assetId, reason: "" })`; toast as `submitFill` does; `markChanged(slotId)`. The batch button condition `mayAct && dayOne && reservedCount > 0` → `mayAct && reservedCount > 0`.

- [ ] **Step 5: Fill dialog.** `openFill(tile)`: compute `const eligible = spares.filter((s) => s.typeId === tile.typeId && !isHeld(s) && !s.pendingRef);` and `setPickedSpare(eligible.length === 1 ? eligible[0].id : null)`. Each radio row: `disabled={isHeld(s) || !!s.pendingRef}` and the note `s.pendingRef ? \`assignment queued · ${s.pendingRef}\` : s.reservedForThis ? "reserved for them" : s.reservedFor ? \`reserved for ${s.reservedFor}\` : "spare"` — extract this ternary into `spareNote(s)` used by both dialogs (gotcha 7). The no-spares copy: `No spare {typeName} in stock — <Link href="/inventory/register">register one</Link> or <Link href="/purchases/new">route a purchase</Link>.`

- [ ] **Step 6: Replace dialog → combobox** (P-9). Replace the two radiogroups with:

```tsx
          <FormField label="Replacement" required error={fieldErrors.replacement} hint={excludedCount ? `${excludedCount} more spare${excludedCount === 1 ? "" : "s"} ${excludedCount === 1 ? "is" : "are"} held or queued for someone else` : undefined}>
            {(p) => (
              <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={replaceOptions} value={replacementId} onChange={setReplacementId} placeholder="Type a tag…" autoFocus />
            )}
          </FormField>
```

with `const replaceable = replacing ? spares.filter((s) => !isHeld(s) && !s.pendingRef) : []; const excludedCount = replacing ? spares.length - replaceable.length : 0; const replaceOptions: ComboOption[] = replaceable.sort(sameTypeFirstFor(replacingTypeId)).map((s) => ({ value: s.id, label: s.tag, sub: s.reservedForThis ? `${s.model} · reserved for them` : s.model, group: s.typeId === replacingTypeId ? "Same type" : "Other spares" }));` (generalise `sameTypeFirst` to take the type id). The Reserve dialog's options reuse the same builder with `reservingSlot.typeId`.

- [ ] **Step 7: Return title** — `title={returning ? \`Return ${returning.tag} · ${returning.model} from ${employeeName}?\` : ""}` — `LoadoutView` gains an `employeeName: string` prop (the page passes `employee.name`).

- [ ] **Step 8: Table view** — rows: `[...ordered.map((s) => ({ a: s.asset, slot: s.name, gap: !s.asset && !s.coveredByLoan ? (s.required ? "policy gap" : "optional") : s.coveredByLoan ? "on loan" : null })), …onLoan, …unslotted]`; an empty-slot row renders `—` in Tag/Model/Status/Age and the `gap` word in Slot's neighbour cell (`Status` column shows `gap`); keep the On-loan and Also-holding cards in both views (drop the `&& view === "slots"` guards). The `SegmentedControl` uses `pickView`.

- [ ] **Step 9: Banner** — the no-policy banner: `Held items are listed below; {canLinkPolicies ? <Link href="/admin/equipment-policies" className="underline">define a policy under Equipment policies</Link> : "define a policy under Equipment policies"} to get the slot grid.` and render it only when `!frozen`.

- [ ] **Step 10: CSS** — `src/app/globals.css`: `@keyframes changed-ring { from { box-shadow: 0 0 0 3px var(--accent); } to { box-shadow: 0 0 0 0 transparent; } } .tile-changed { animation: changed-ring 2000ms var(--ease-std) forwards; }`.

- [ ] **Step 11: Walk on 3100** (sole walker; you may assign and return to Nina Robles and put it back through the UI — the seed is rerun before Playwright; record what you changed): filled tile click → the menu (Replace…, Return…, Open record, Waive…); Enter/Space/Backspace on a focused tile open it; Escape closes and refocuses; the ⋯ is visible without hover and opens the same menu; an empty tile → Fill, sole spare preselected, a queued spare disabled with its refNo, held spares dimmed; Replace → a combobox with Same type / Other spares and the "held or queued" hint; the Return title names model and holder; a mutation dims the tile then rings it for 2 s and the toast fires; Nina's monitor tile reads "reserved · BR-MN-0910" with Assign reserved; "Assign all N reserved" visible whenever a reservation exists; optional empty tile says "optional — not a gap"; required gaps sort first; the Table view lists empty slots and keeps the cards; switch to Table, reload → Table (remembered); "Fill 1 gap" from the header focuses the first gap tile; "Assign kit" on a day-one profile opens the first Fill dialog. As `viewer@`: tiles are inert `div`s with no `+`, no menus; the tag is plain text. Stop the server; port free.

- [ ] **Step 12: Gate + commit** — `feat(loadout): Phase 29 -- tiles open an action menu (the ⋯ always visible), required gaps first, reservations on the tile with Assign reserved, Fill preselect and queued marks, a combobox Replace picker, the Return title names model and holder, pending and changed feedback, a fuller Table view remembered per user`.

---

### Task 5: The New employee form (walks)

**Files:**
- Create: `src/components/employees/employee-no-check.tsx`, `src/components/employees/policy-preview.tsx`
- Modify: `src/components/employees/employee-form.tsx`, `same-name-check.tsx`

**Interfaces — Consumes:** `checkEmployeeNo`, `nextEmployeeNo`, `previewPolicy`, `checkSameName` (T2). **Produces:** `EmployeeNoCheck({ value, onUse })`, `PolicyPreview({ title, departmentId })`, `SameNameCheck` gains `refusal?: string | null`.

- [ ] **Step 1: `employee-no-check.tsx`** (client; the debounce/staleness shape of `same-name-check.tsx`): props `{ value: string; onUse: (no: string) => void }`. On mount: `nextEmployeeNo()` → state `next`. When `value.trim()` is empty and `next` → render `<p className="text-[11px] text-fg-muted">Next free: <span className="font-mono">{next}</span> <button type="button" className="ml-1 text-accent underline" onClick={() => onUse(next)}>Use it</button></p>`. When `value.trim()` is non-empty: debounce 400 ms → `checkEmployeeNo({ employeeNo: value })`; staleness-guarded; render `<FormError>{value.trim()} is already <Link href={`/employees/${taken.id}`} className="underline">{taken.name}</Link>'s</FormError>` when taken.

- [ ] **Step 2: `policy-preview.tsx`** (client): props `{ title: string; departmentId: string }`; debounce 400 ms → `previewPolicy({ title, departmentId })`; renders `<p className="text-[11px] text-fg-muted">` with `matches {name} · {slots} slots` (+ ` (department)` when `via === "department"`) or `no policy matches this title yet` when `title.trim()` is non-empty and the result is null; nothing when the title is empty.

- [ ] **Step 3: `same-name-check.tsx`** — `match` state type gains `id: string`; props gain `refusal?: string | null`; the banner title becomes `Another ${name} exists in ${match.department} (<Link href={`/employees/${match.id}`} className="underline">{match.employeeNo}</Link>)` — `Banner`'s `title` accepts a ReactNode (check `banner.tsx`; if it is `string`, put the link in the body instead); body: `{refusal && <p className="text-xs">{refusal}</p>}` above the checkbox (P-3).

- [ ] **Step 4: `employee-form.tsx`**:
  - Field order inside the Person card (create mode): Name (`autoFocus`, `onBlur` trims), Title (+ `<PolicyPreview title={form.title} departmentId={form.departmentId} />` under it via the field's hint slot replaced by the component — render it right after the `FormField`), Department, then the `props.mode === "new"` block (Employee number with `<EmployeeNoCheck value={form.employeeNo} onUse={(no) => setForm((f) => ({ ...f, employeeNo: no }))} />` under it; Joined with `hint="defaults to today"`), Employment (hint `Offboarding is started from the person's page.`), the conditional due date, then Account status (moved from the second card; hint `Set when the M365 account exists; the directory sync fills it in later.`) and its custom input. Delete the Microsoft 365 `Card`. The `SameNameCheck` mount gets `refusal={sameNameRefusal}`.
  - State: `const [sameNameRefusal, setSameNameRefusal] = useState<string | null>(null); const [addAnother, setAddAnother] = useState(false); const nameRef = useRef<HTMLInputElement>(null); const rootRef = useRef<HTMLFormElement>(null);`.
  - Trim on blur: each text `Input` gets `onBlur={() => setForm((f) => ({ ...f, <key>: f.<key>.trim() }))}`.
  - `submit`: on validation, `const { _sameName, ...rest } = fe; setErrors(rest); setSameNameRefusal(_sameName ?? null);` then focus the first invalid: `queueMicrotask(() => { const first = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]'); first?.focus(); first?.scrollIntoView({ block: "center" }); });` (FormField sets `invalid` → the `Input` renders `aria-invalid` — confirm in `input.tsx`; if not, select by `.invalid` class it renders). On success in create mode: `if (addAnother) { toast(\`Added ${form.name}\`, "settled"); setForm((f) => ({ ...f, employeeNo: "", joinedAt: today(), name: "", title: "", employment: "ACTIVE", m365Select: "", m365Custom: "", offboardingDueAt: "" })); setConfirmSameName(false); setSameNameRefusal(null); setAddAnother(false); nameRef.current?.focus(); } else router.push(...)` (import `useToast`).
  - Action bar (replaces the single-button row):

```tsx
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t border-border bg-surface px-1 py-3">
        {props.mode === "new" && <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={pending && !addAnother}>
          {props.mode === "new" ? "Create employee" : saved ? "✓ Saved" : "Save changes"}
        </Button>
        {props.mode === "new" && (
          <Button type="submit" variant="secondary" loading={pending && addAnother} onClick={() => setAddAnother(true)}>Create and add another</Button>
        )}
        {saved && <span className="text-xs text-fg-muted">audit entry written</span>}
      </div>
```

(The second submit button sets the flag in its click handler before the form's `onSubmit` runs — React fires the click first; if the ordering proves unreliable, submit imperatively from the click handler instead and record it.)

- [ ] **Step 5: Walk on 3100** as `it@` on `/employees/new` (submit nothing that persists except one "Create and add another" you delete afterwards via the UI is NOT possible — employees have no delete; so do NOT create; drive the refusals only): focus lands on Name; the Person card order; "Next free: EMP-0100" with Use it filling the field; typing `emp-0099` → "EMP-0099 is already Carlo Dizon's" with the link; Title "Analyst" + Department Finance → "matches Finance standard · 6 slots"; an unknown title → "no policy matches this title yet"; name "Carlo Dizon" + Operations → the banner with the linked EMP-0099; submit unticked → the banner's refusal line and the number error at once, focus on the first invalid field; the sticky bar stays visible with the banner open; Cancel returns to the list. Stop the server; port free.

- [ ] **Step 6: Gate + commit** — `feat(employee-form): Phase 29 -- Name first, live number check with the next free number, one same-name refusal with a profile link, every error at once then focus, a policy preview under Title, one card, phase-free hints, a sticky action bar with Cancel and Create-and-add-another`.

---

### Task 6: The employees list (walks)

**Files:**
- Modify: `src/app/(app)/employees/page.tsx`, `src/components/employees/employees-toolbar.tsx`, `employees-table.tsx`

**Interfaces — Consumes:** `listEmployees` (`hiddenLeavers`, `loadout` sort) (T2); `ChipFilterRow`, `IconButton`, `Menu`.

- [ ] **Step 1: Table** — column order `Employee · Department · Loadout · Items · Employment · M365 · Joined · (chevron)`; `<Th width={100} {...sortProps("loadout")}>Loadout</Th>`; Loadout cell `null` → `<span className="text-fg-faint">no policy</span>`; M365 cell → `<Td mono className="text-[10.5px] text-fg-muted">{row.m365 ?? "no sync yet"}</Td>`; the last `<Th width={28} aria-label="Open" />` and per row `<Td className="text-fg-faint" aria-hidden>›</Td>`; the row keeps `rowOpenProps`; add `focus-visible:outline-2 focus-visible:outline-accent` to the row's className.

- [ ] **Step 2: Toolbar** — props gain `hiddenLeavers: number`; the search box: placeholder `Search name, number, title, department · Enter`; a clear button when `state.q`: `<button type="button" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg" onClick={() => router.push(href(withSearch(state, ""), gapsOnly))}>×</button>`; the two toggles stay `<Link>` (P-2) with `{active && <span aria-hidden>✓</span>}` leading and `rounded-full` pill shape; the count: `{total} {total === 1 ? "person" : "people"}{hiddenLeavers > 0 && <> · <Link href={href(withFilter(state, "leavers", ["1"]), gapsOnly)} className="underline">{hiddenLeavers} leaver{hiddenLeavers === 1 ? "" : "s"} hidden</Link></>}`.

- [ ] **Step 3: Page** — pass `hiddenLeavers`; header actions: `{canMutate && <ButtonLink variant="primary" href="/employees/new">New employee</ButtonLink>}` then a client `EmployeesMoreMenu` (new small component in `employees-toolbar.tsx` or its own file) rendering `Menu` with `IconButton aria-label="More"` and items `Import…` (canMutate) → `/employees/import`, `Export` → the export href with the current state; `page {page} of {pageCount}` only when `pageCount > 1`; the filtered-empty branch renders `<ChipFilterRow chips={chips} clearHref={href(clearFilters(state), false)} />` above the `EmptyState`, where `chips` = `q` (`search: {q}`), each department value (label from `facets.department`), each employment value, `Leavers shown` when `leavers=1`, `Policy gaps only` when `gapsOnly` — each with the `removeHref` that drops just that filter.

- [ ] **Step 4: Walk on 3100** as `it@`: Loadout third; click its header → gaps first, `?sort=loadout`; again → `-loadout`; "no policy" faint, "complete" settled; "9 people · 1 leaver hidden" with the link; search "finance" → Finance people; × clears; the toggles show ✓ when on; Enter on a row opens it; New employee first, More holds Import/Export; no "page 1 of 1"; `?q=zzz` → chips + Clear filters. As `viewer@`: no New/Import, Export in More. Stop the server; port free.

- [ ] **Step 5: Gate + commit** — `feat(employees-list): Phase 29 -- sortable Loadout third with no policy/complete, the hidden-leavers count, search clear and department term, pill toggles with a check, a visible row target, New employee first with Import/Export in More, filter chips on the empty state`.

---

### Task 7: e2e

**Files:**
- Create: `e2e/employee-ux.spec.ts`
- Modify: `e2e/it-nav.spec.ts` (cases at :135, :170, :187, :207 — "Start offboarding" now `More actions` → menuitem "Start offboarding…"), `e2e/transfers.spec.ts` (:81, :150, :171, :199, :229 — "Transfer" via More → "Transfer…"), `e2e/custody.spec.ts` only if case 8's headset slot is FILLED (then the ⋯ still exists — P-7 keeps it; expect no change).

- [ ] **Step 1: The adaptations** — for each pinned `getByRole("button", { name: "Start offboarding" })` / `"Transfer"` click: `await page.getByRole("button", { name: "More actions" }).click(); await page.getByRole("menuitem", { name: "Start offboarding…" }).click();` (same for `Transfer…`). Run `E2E_PORT=3100 npx playwright test e2e/it-nav.spec.ts e2e/transfers.spec.ts e2e/custody.spec.ts e2e/directory.spec.ts e2e/deadlines.spec.ts --workers=1 --global-timeout=540000` and fix only test code for changes this phase made; a product defect → STOP and report.

- [ ] **Step 2: `e2e/employee-ux.spec.ts`** — helpers copied from `e2e/it-nav.spec.ts` (`login`, `expectNoSeriousAxe`, `waitForHydration`, `facetCounts`), `db`, seed in `beforeAll`, `afterAll` disconnect; constants `IT`, `VIEWER`. Nine cases (adapt selectors to the real DOM; keep every assertion):

```ts
test.describe("Phase 29 — the employee area obeys the laws", () => {
  test("1. a filled tile opens its menu; Return… confirms with model and holder; Escape refocuses", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, IT);
    await page.goto(`/employees/${marites.id}`);
    const tile = page.getByRole("button", { name: /^laptop slot, / });
    await waitForHydration(tile);
    await tile.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Replace…" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Open record" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Return…" }).click();
    await expect(page.getByRole("dialog", { name: /^Return BR-LT-\d+ · .+ from Marites Bautista\?$/ })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(tile).toBeFocused();
    await expectNoSeriousAxe(page);
  });

  test("2. Open record from the menu lands on the asset", async ({ page }) => { /* click the filled tile, choose Open record, expect URL /inventory/<id> */ });

  test("3. a leaver's header: the due pill, the wizard primary, Edit still present, no Transfer in More", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    await login(page, IT);
    await page.goto(`/employees/${dennis.id}`);
    const header = page.locator("main header").first();
    await expect(header.getByText(/overdue|due/i)).toBeVisible();
    await expect(header.getByRole("button", { name: "Open the offboarding wizard" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Edit" })).toBeVisible();
    await header.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Transfer…" })).toHaveCount(0);
  });

  test("4. Nina: Assign kit on day one opens the first Fill dialog; after one assignment Fill N gaps focuses the first gap tile", async ({ page }) => { /* primary "Assign kit" → dialog "Fill the … slot" visible; cancel; assign one spare via the dialog (direct IT) then expect the primary reads /^Fill \d gaps?$/ and clicking it focuses a tile whose name contains ", empty, required"; finally: return that asset via the tile menu */ });

  test("5. the reserved spare shows on its tile and Assign reserved fulfils the hold", async ({ page }) => { /* Nina's monitor tile shows "reserved · BR-MN-0910"; click Assign reserved → toast; the hold state in db is FULFILLED; finally: return BR-MN-0910 through the tile menu and recreate the ACTIVE hold row via db with the seed's expiresAt shape (dayFromISO(addDays(today, 7))) */ });

  test("6. the list sorted by Loadout puts gaps first and no policy last; the count states the hidden leaver", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    await expect(page.getByText(/^\d+ people · 1 leaver hidden$/)).toBeVisible();
    const loadout = page.getByRole("button", { name: "Loadout" });
    await waitForHydration(loadout);
    await loadout.click();
    await expect(page).toHaveURL(/sort=loadout/);
    const cells = await page.locator("tbody tr td:nth-child(3)").allInnerTexts();
    const firstNoPolicy = cells.findIndex((c) => c.trim() === "no policy");
    const lastMissing = cells.map((c) => /missing/.test(c)).lastIndexOf(true);
    expect(lastMissing).toBeLessThan(firstNoPolicy < 0 ? cells.length : firstNoPolicy);
    expect(/^\d+ missing$/.test(cells[0].trim()) || cells[0].trim() === "complete").toBe(true);
  });

  test("7. search clears and matches a department", async ({ page }) => { /* fill "Finance" + Enter → every row's Department cell reads Finance; click "Clear search" → URL without q */ });

  test("8. the New form: Name focused, the live number check, Next free, the policy preview, one same-name refusal, Create and add another", async ({ page }) => { /* as in spec §9 case 8; the created employees (two, EMP-9301/EMP-9302) are deleted in finally; the same-name refusal text contains "tick 'This is a different person'" exactly once on the page */ });

  test("9. a viewer's tiles are inert", async ({ page }) => { /* login VIEWER; Marites; no getByRole("button", { name: /slot,/ }); the tiles exist as role=group with the same names; no More actions; axe */ });
});
```

Write the bodies in full (the sketches above name the assertions). Run `E2E_PORT=3100 npx playwright test e2e/employee-ux.spec.ts --workers=1 --global-timeout=540000` until green; then `--list` (expect 389 / 38); `npm run db:seed` last.

- [ ] **Step 3: Gate + commit** — `test(e2e): Phase 29 -- employee-ux.spec (tile menu, leaver header, Assign kit/Fill gaps, Assign reserved, Loadout sort and hidden count, search, the New form, viewer tiles); More-menu adaptations in it-nav and transfers`.

---

### Task 8: Battery and documents

- [ ] Pre-checks: tsc, eslint, vitest (files/tests), `migrate status` (26), `--list` (389 / 38).
- [ ] The seven chunks, foreground, `e2e/employee-ux.spec.ts` appended to E1 (`e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts e2e/employee-ux.spec.ts`); expected A 54 · B 67 · C 64 · D 50 · E1 46 · E2 42 · F 66 = 389. Re-run a failing chunk once; if it reproduces, STOP.
- [ ] Docs (CRLF; anchor on block headers): HANDOVER line 3 parenthetical (Phase 29 CODE-COMPLETE, UNMERGED/UNPUSHED, no migration, migration 26 still pending on staging), a (v) block after (u), §0 item 9's E1 line + sentence, §8 closures if any statement names the employee area's old behaviour; PICKUP Branch/Battery/Last two phases/§4 item 1; HANDOVER-PENDING preamble; the spec's Status line + `*Amended (D-n):*` notes for P-2, P-3, P-7, P-8, P-9 and anything execution changed; this plan's D-block from the ledger. Commit `docs(handover,pickup,pending,plan,spec): Phase 29 code-complete -- battery 389 e2e / 38 files, N unit, 26 migrations; (v) block; D-1..D-N`.

---

## Self-review

**Spec coverage:** §4.1 → T1 `profilePrimary` + T3; §4.2, §4.3 → T3; §4.4 → T1 `orderTiles`/`tileMenuItems` + T4 Step 3 (P-7/P-8); §4.5 → T4 Steps 5–7 (P-9); §4.6 → T4 Steps 3–4; §4.7 → T4 Steps 2, 10; §4.8 → T2 Step 5 + T4 Steps 2, 8; §5.1 → T5 Step 4; §5.2 → T1 `employee-no`, T2, T5 Step 1; §5.3 → T1 `policy-preview`, T2, T5 Step 2; §5.4 → T2 Steps 1, 3 + T5 Steps 3–4 (P-3); §5.5 → T5 Step 4; §6.1 → T1, T2 Step 4, T6 Step 1; §6.2 → T6 Step 2 (P-2); §6.3 → T6 Step 3; §7 edge cases → the guards in T2/T4/T5; §9 → T1 tests, T7, T8; §10 files → the task file lists; decisions 5–7 recorded → T8 docs. **Placeholder scan:** case sketches in T7 name their assertions and are written in full by the implementer — no TBD. **Type consistency:** `profilePrimary` → `ProfileActions.primary`; `TileMenuItem` union → the switch in T4; `SpareOption.pendingRef` (T4 Step 1) read by `spareNote`; `listEmployees.hiddenLeavers` (T2) → toolbar prop (T6); `loadoutViewFor` (T2) → page (T3) → `initialView` (T4); `saveLoadoutView` (T2) → `pickView` (T4); `checkSameName.match.id` (T2) → `SameNameCheck` (T5).

## Amendments made during execution

- *(Task 8 replaces this bullet with the D-block from the SDD ledger.)*
