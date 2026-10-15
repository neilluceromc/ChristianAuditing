# Phase 35 — Depreciation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Finance a correct current book value for every costed asset. It shows on the Approved assets list (with totals and an export) and on the Finance home, alongside a full-year schedule (with an export). All of it is driven by per-category depreciation policies and per-asset overrides that Finance edits.

**Architecture:**
- **One calculation.** `src/lib/depreciation.ts` is a pure module that does all the arithmetic, in integer centavos and Asia/Manila months, and is fully unit-tested. Every screen and export calls it, so nothing else computes depreciation.
- **Stored settings only.** Five optional columns (migration 28) hold the settings; nothing is precomputed.
- **Server side.** Server actions edit the policies and overrides with the house guard order and an audit row. Finance queries read the settings and feed the pure functions.
- **Pages.** They live under `/finance`, which is already gated to the Finance workspace.

**Tech Stack:** Next.js 15 App Router (RSC + client islands), Prisma 6 / Postgres 16, zod, vitest (pure, node env), Playwright + axe, write-excel-file through `src/server/xlsx/write.ts`.

**Spec:** `docs/superpowers/specs/2026-10-15-depreciation-design.md` (commits `d51ac73`, `d1d328c`). Read it first.

## Global Constraints

**Where the work happens**
- Do the work in the worktree `.claude/worktrees/phase-35-depreciation`, branch `phase-35-depreciation`.
- `.env` there points at `inventory_dev` with `APP_BASE_URL=http://192.168.1.193:3100`, and has no `SEED_PASSWORD` or `QUICK_LOGIN_EMAILS`.
- Never read or print `.env`. Never touch the `inventory` database or port 3000.

**Database and migrations**
- Apply migrations with `npx prisma migrate deploy` only. Never run `prisma migrate dev` or `prisma migrate reset`.
- Generate DDL with `npx prisma migrate diff --from-schema-datamodel <HEAD schema copy> --to-schema-datamodel prisma/schema.prisma --script`.
- After `npm ci`, run `npx prisma generate`.
- `npm run db:seed` runs only on `inventory_dev`, and runs last after e2e work.

**Playwright**
- Run it in the **foreground only**: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`, with a Bash timeout of 600000.
- Never use `run_in_background` or the Monitor tool. One Playwright process at a time.
- Check that port 3100 is free before and after each run.

**Git**
- Never amend. Never run `git stash`, `checkout`, `restore`, `reset` or `switch`.
- `git add` new files before a pathspec commit.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Repo files are CRLF. Edit existing files with the Edit tool, never `sed -i`, and write new files CRLF.

**House rules**
- Product aria-labels near a field never contain that field's label word.
- `AuditEntry` is append-only, so tests never delete audit rows.
- Server actions follow the guard order `actionRole` → `checkRate(user.id)` → zod. They return the house `ActionResult` (`@/server/action-result`) and write audit rows through `writeAudit(tx, …)` in the same transaction.
- Money is never handled as floats in the calculation: convert to integer centavos (`Math.round(Number(decimal) * 100)`) at the boundary.
- Show money on screen with `fmtMoneyExact` (2 decimals) wherever depreciation appears, and in Excel as `{ type: Number, format: "#,##0.00" }`.

**Spec values**
- Access to the new pages and actions is roles `admin` and `finance_staff` only. Pages live under `/finance` (PATH_RULE `/finance` → workspace `finance`), and actions check `actionRole("admin", "finance_staff")`.
- Life is 1–600 months.
- A category's salvage % is ≥ 0 and < 100, with at most 2 decimals.
- An override's salvage is ≥ 0 and < the asset's cost.
- An override reason is 3–300 characters.
- An override is both fields or neither.
- Depreciation starts the month **after** the month of `financeConfirmedAt` (Asia/Manila).
- The as-of month is the last **completed** Asia/Manila month.
- `monthly = floor(base / lifeMonths)` in centavos. The last month charges `base − monthly × (lifeMonths − 1)`.
- Book value is never below salvage.
- `cost` null means the asset is excluded everywhere.
- Unconfirmed assets and assets with no policy show book value = cost and count in totals at cost.
- Disposals are ignored: status never stops depreciation.

## Review Focus

These are the inputs most likely to bite a real user that no task's tests cover by default. Each one gets a test in the task named.

1. **Confirmation late in the evening (Manila) on the last day of a month.** For example, `2026-01-31T22:00+08:00` is still 31 Jan in Manila but already February in UTC. The start must be February, never March. *(Task 2 test.)*
2. **Opening the page on the 1st of a month.** On 1 Oct the as-of month is September; before 08:00 Manila the UTC date is still 30 Sep. *(Task 2 test.)*
3. **A cost edited after confirmation.** The numbers follow the new cost, and a cost lowered below an existing override salvage must not produce a negative base. *(Task 2 test: salvage ≥ cost → state `no-policy`-like "salvage exceeds cost" guard, see `depreciate`.)*
4. **A category policy changed while overrides exist.** Assets with a custom override keep their override, and the "updates N assets" count excludes them. *(Task 4 test of the count query's where, via the pure `affectedByPolicy` helper.)*
5. **Year picker on a year with no confirmed assets.** The grid is empty with a plain sentence, not an error, and the export still has a header row. *(Task 7 e2e assertion plus Task 2 `yearGrid` returning an empty list.)*

## Decisions taken in this plan

- **P-1.** If salvage ≥ cost (possible after a cost edit), `depreciate` returns a new state, `bad-salvage`: book value = cost, with the reason "Salvage exceeds cost". It is not a fifth spec state, but the only safe answer to Review Focus 3. It is shown like `no-policy`.
- **P-2.** The Policies tab edits each row inline (life in years + months, salvage %, Save). Rows are client islands, each with its own runner; the page is a Server Component.
- **P-3.** The "Last changed" column reads the newest `depreciation.policy` audit row per category, in one query.
- **P-4.** Approved assets totals cover every matching row, not just the page. The page computes them in Node by streaming the matching rows' minimal fields (`id, cost, financeConfirmedAt, depreciationLifeMonths, depreciationSalvage, category policy`) through `depreciate`. The volume is fine: under 10k costed assets.
- **P-5.** Nav: the Finance sidebar's "Capitalized assets" section gains `{ label: "Depreciation", href: "/finance/depreciation" }` after "Approved assets". The "By status" list is untouched, so its pinned last item stays "Stock".
- **P-6.** Exports: `/finance/assets/export` and `/finance/depreciation/export` use `requireRole("admin", "finance_staff")`. Today's `/finance/assets` page uses `requireUser()` and the workspace gate; the new routes use the stricter role guard.

---

## File structure

**Create**
- `prisma/migrations/20261015090000_depreciation/migration.sql`: the DDL only.
- `src/lib/depreciation.ts` and `src/lib/depreciation.test.ts`: the pure calculation.
- `src/lib/depreciation-input.ts` and `src/lib/depreciation-input.test.ts`: zod schemas and the "years+months" parse/format helpers.
- `src/server/modules/finance/depreciation-actions.ts` ("use server"): `setCategoryPolicy`, `setAssetOverride`, `clearAssetOverride`.
- `src/server/modules/finance/depreciation-queries.ts`: `policyRows`, `bookValueTotals`, `scheduleYear`, and the export rows.
- `src/app/(app)/finance/depreciation/page.tsx`: the Schedule and Policies tabs.
- `src/app/(app)/finance/depreciation/export/route.ts`
- `src/app/(app)/finance/assets/export/route.ts`
- `src/components/finance/policy-row.tsx`: client, one editable policy row.
- `src/components/finance/override-dialog.tsx`: client.
- `src/components/finance/asset-row-menu.tsx`: client, the ⋯ menu opening the dialog.
- `src/components/finance/schedule-table.tsx`: server, the grid.
- `e2e/finance-depreciation.spec.ts`

**Modify**
- `prisma/schema.prisma`
- `src/lib/activity.ts` and `src/lib/activity.test.ts`: the audit sentences.
- `src/lib/workspaces.ts` and `src/lib/workspaces.test.ts`: the nav entry.
- `src/server/modules/finance/queries.ts`: rows and totals carry depreciation.
- `src/app/(app)/finance/assets/page.tsx`: columns, footer, row menu, Export.
- `src/server/modules/home/queries.ts` (`financeHome`) and `src/app/(app)/page.tsx`: the Book value stat.
- `src/lib/export-columns.ts`: the two new column sets.

---

### Task 1: Schema and migration 28

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261015090000_depreciation/migration.sql`

**Interfaces — Produces:**
- `AssetCategory.depreciationLifeMonths Int?`, `AssetCategory.depreciationSalvagePercent Decimal? @db.Decimal(5,2)`
- `Asset.depreciationLifeMonths Int?`, `Asset.depreciationSalvage Decimal? @db.Decimal(12,2)`, `Asset.depreciationNote String?`

- [ ] **Step 1: Edit the schema.**

  In `model AssetCategory`, after `tagPrefix`, add:

```prisma
  /// Phase 35 (spec §3.1): Finance's straight-line policy for the category; both null = no policy.
  depreciationLifeMonths     Int?
  depreciationSalvagePercent Decimal?    @db.Decimal(5, 2)
```

  In `model Asset`, after `labelPrintedAt`, add:

```prisma
  /// Phase 35 (spec §3.3): a per-asset override — life AND salvage (pesos) together, or neither.
  depreciationLifeMonths Int?
  depreciationSalvage    Decimal?         @db.Decimal(12, 2)
  depreciationNote       String?
```

- [ ] **Step 2: Generate the DDL.**

  Run `git show HEAD:prisma/schema.prisma > <SDD workspace>/old.prisma`, then
  `npx prisma migrate diff --from-schema-datamodel <SDD workspace>/old.prisma --to-schema-datamodel prisma/schema.prisma --script`.
  Write the output to `prisma/migrations/20261015090000_depreciation/migration.sql`.

  Expected: five `ALTER TABLE … ADD COLUMN` statements, with no drops.

  Append this guard as the file's last statement:

```sql
-- Phase 35 (spec §3.3): an override is both fields or neither.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_depreciation_override_pair"
  CHECK (("depreciationLifeMonths" IS NULL) = ("depreciationSalvage" IS NULL));
```

- [ ] **Step 3: Apply and check.**

  Run `npx prisma migrate deploy && npx prisma generate && npx tsc --noEmit`.
  Expected: `28 migrations found … applied`, and `tsc` clean.

- [ ] **Step 4: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations/20261015090000_depreciation/migration.sql
git commit -m "feat(db): migration 28 -- depreciation policy on categories, per-asset override (life + salvage + note, paired by CHECK)"
```

---

### Task 2: The pure calculation

**Files:**
- Create: `src/lib/depreciation.ts`, `src/lib/depreciation.test.ts`

**Interfaces — Produces (exact):**

```ts
export type MonthIndex = number; // year * 12 + (month - 1), Asia/Manila
export function manilaMonth(d: Date): MonthIndex;
export function asOfMonth(now: Date): MonthIndex;                 // last completed month
export function monthLabel(m: MonthIndex): string;                // "September 2026"
export function monthEndLabel(m: MonthIndex): string;             // "30 Sep 2026"
export function toCentavos(v: number | string | { toString(): string } | null | undefined): number | null;
export interface Policy { lifeMonths: number; salvage: number /* centavos */; basis: "category" | "custom" }
export function resolvePolicy(
  asset: { cost: number; lifeMonths: number | null; salvage: number | null },
  category: { lifeMonths: number | null; salvagePercent: number | null },
): Policy | null;
export type DepState = "depreciating" | "fully-depreciated" | "not-started" | "no-policy" | "bad-salvage";
export interface DepResult {
  state: DepState; cost: number; accumulated: number; bookValue: number;
  monthly: number | null; startMonth: MonthIndex | null; policy: Policy | null;
}
export function depreciate(cost: number, confirmedAt: Date | null, policy: Policy | null, asOf: MonthIndex): DepResult;
export interface YearRow { opening: number; months: number[]; projected: boolean[]; total: number; closing: number }
export function yearGrid(cost: number, confirmedAt: Date | null, policy: Policy | null, year: number, asOf: MonthIndex): YearRow | null;
export function stateNote(r: DepResult, categoryName: string): string | null;
```

- [ ] **Step 1: Write the failing tests** in `src/lib/depreciation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  asOfMonth, depreciate, manilaMonth, monthEndLabel, monthLabel, resolvePolicy, stateNote, toCentavos, yearGrid,
} from "./depreciation";

const M = (y: number, m: number) => y * 12 + (m - 1);
const cat = (life: number | null, pct: number | null) => ({ lifeMonths: life, salvagePercent: pct });

describe("months in Asia/Manila", () => {
  it("a late-evening confirmation on the last day stays in that month (Review Focus 1)", () => {
    expect(manilaMonth(new Date("2026-01-31T22:00:00+08:00"))).toBe(M(2026, 1));
  });
  it("as-of is the last completed month, also before 08:00 on the 1st (Review Focus 2)", () => {
    expect(asOfMonth(new Date("2026-10-01T07:30:00+08:00"))).toBe(M(2026, 9));
    expect(asOfMonth(new Date("2026-10-31T23:59:00+08:00"))).toBe(M(2026, 9));
  });
  it("labels", () => {
    expect(monthLabel(M(2026, 9))).toBe("September 2026");
    expect(monthEndLabel(M(2026, 2))).toBe("28 Feb 2026");
  });
});

describe("toCentavos", () => {
  it("converts decimals and strings, keeps null", () => {
    expect(toCentavos("68500.5")).toBe(6_850_050);
    expect(toCentavos(10_000)).toBe(1_000_000);
    expect(toCentavos(null)).toBeNull();
  });
});

describe("resolvePolicy", () => {
  it("override wins over category", () => {
    expect(resolvePolicy({ cost: 1_000_000, lifeMonths: 24, salvage: 50_000 }, cat(36, 10)))
      .toEqual({ lifeMonths: 24, salvage: 50_000, basis: "custom" });
  });
  it("category % → centavos, rounded", () => {
    expect(resolvePolicy({ cost: 1_000_001, lifeMonths: null, salvage: null }, cat(36, 10)))
      .toEqual({ lifeMonths: 36, salvage: 100_000, basis: "category" });
  });
  it("category with life but no % means zero salvage", () => {
    expect(resolvePolicy({ cost: 500_000, lifeMonths: null, salvage: null }, cat(12, null))?.salvage).toBe(0);
  });
  it("no life anywhere → no policy", () => {
    expect(resolvePolicy({ cost: 500_000, lifeMonths: null, salvage: null }, cat(null, 10))).toBeNull();
  });
});

describe("depreciate", () => {
  const p = (life: number, salvage = 0) => ({ lifeMonths: life, salvage, basis: "category" as const });
  const conf = new Date("2026-01-14T10:00:00+08:00"); // starts Feb 2026

  it("₱10,000 over 3 months: 3,333.33 + 3,333.33 + 3,333.34", () => {
    const r1 = depreciate(1_000_000, conf, p(3), M(2026, 2));
    expect([r1.state, r1.monthly, r1.accumulated, r1.bookValue]).toEqual(["depreciating", 333_333, 333_333, 666_667]);
    const r3 = depreciate(1_000_000, conf, p(3), M(2026, 4));
    expect([r3.state, r3.accumulated, r3.bookValue]).toEqual(["fully-depreciated", 1_000_000, 0]);
  });
  it("never below salvage, and stays there after the life", () => {
    const r = depreciate(1_000_000, conf, p(10, 100_000), M(2030, 1));
    expect([r.state, r.bookValue]).toEqual(["fully-depreciated", 100_000]);
  });
  it("a tiny base over a long life never goes negative in the last month", () => {
    const g = yearGrid(7, new Date("2025-12-10T10:00:00+08:00"), p(10), 2026, M(2026, 12));
    expect(g!.months.every((c) => c >= 0)).toBe(true);
    expect(g!.months.reduce((a, b) => a + b, 0)).toBe(7);
  });
  it("starts the month after confirmation; the confirmation month itself charges nothing", () => {
    expect(depreciate(1_000_000, conf, p(3), M(2026, 1)).state).toBe("not-started");
  });
  it("unconfirmed and no-policy show book value = cost", () => {
    expect(depreciate(1_000_000, null, p(3), M(2026, 9))).toMatchObject({ state: "not-started", bookValue: 1_000_000 });
    expect(depreciate(1_000_000, conf, null, M(2026, 9))).toMatchObject({ state: "no-policy", bookValue: 1_000_000 });
  });
  it("salvage at or above cost (cost lowered after an override) is refused, not negative (Review Focus 3)", () => {
    expect(depreciate(100_000, conf, { lifeMonths: 12, salvage: 150_000, basis: "custom" }, M(2026, 9)))
      .toMatchObject({ state: "bad-salvage", bookValue: 100_000, accumulated: 0 });
  });
});

describe("yearGrid", () => {
  const p = (life: number, salvage = 0) => ({ lifeMonths: life, salvage, basis: "category" as const });
  it("a mid-year start: zeros before, charges after, opening = cost", () => {
    const g = yearGrid(1_200_000, new Date("2026-03-05T09:00:00+08:00"), p(12), 2026, M(2026, 9))!;
    expect(g.opening).toBe(1_200_000);
    expect(g.months).toEqual([0, 0, 0, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000]);
    expect(g.projected).toEqual([false, false, false, false, false, false, false, false, false, true, true, true]);
    expect([g.total, g.closing]).toEqual([900_000, 300_000]);
  });
  it("a life ending mid-year", () => {
    const g = yearGrid(1_200_000, new Date("2025-08-20T09:00:00+08:00"), p(12), 2026, M(2026, 12))!;
    expect(g.opening).toBe(800_000);
    expect(g.months.slice(0, 9)).toEqual([100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 0]);
    expect(g.closing).toBe(0);
  });
  it("fully depreciated before the year, not started yet, unconfirmed, no policy → no row (Review Focus 5)", () => {
    expect(yearGrid(1_200_000, new Date("2023-01-05T09:00:00+08:00"), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, new Date("2026-12-20T09:00:00+08:00"), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, null, p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, new Date("2026-03-05T09:00:00+08:00"), null, 2026, M(2026, 9))).toBeNull();
  });
});

describe("stateNote", () => {
  it("one plain sentence per non-depreciating state", () => {
    const base = { cost: 1, accumulated: 0, bookValue: 1, monthly: null, startMonth: null, policy: null };
    expect(stateNote({ ...base, state: "not-started" }, "Laptop")).toBe("Not depreciating yet");
    expect(stateNote({ ...base, state: "no-policy" }, "Laptop")).toBe("No policy for Laptop");
    expect(stateNote({ ...base, state: "bad-salvage" }, "Laptop")).toBe("Salvage exceeds cost");
    expect(stateNote({ ...base, state: "fully-depreciated" }, "Laptop")).toBe("Fully depreciated");
    expect(stateNote({ ...base, state: "depreciating" }, "Laptop")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
  Run `npx vitest run src/lib/depreciation.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement `src/lib/depreciation.ts`.**

```ts
/**
 * Phase 35 (spec §2): straight-line depreciation, computed on read. Integer centavos and
 * Asia/Manila calendar months throughout; every screen and export calls these functions.
 */
export type MonthIndex = number;

const MANILA = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Manila" });
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function manilaMonth(d: Date): MonthIndex {
  const [y, m] = MANILA.format(d).split("-").map(Number);
  return y * 12 + (m - 1);
}

export function asOfMonth(now: Date): MonthIndex {
  return manilaMonth(now) - 1;
}

export function monthLabel(m: MonthIndex): string {
  return `${MONTH_NAMES[((m % 12) + 12) % 12]} ${Math.floor(m / 12)}`;
}

export function monthEndLabel(m: MonthIndex): string {
  const y = Math.floor(m / 12);
  const mo = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return `${String(last).padStart(2, "0")} ${SHORT[mo]} ${y}`;
}

export function toCentavos(v: number | string | { toString(): string } | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(Number(typeof v === "object" ? v.toString() : v) * 100);
}

export interface Policy { lifeMonths: number; salvage: number; basis: "category" | "custom" }

export function resolvePolicy(
  asset: { cost: number; lifeMonths: number | null; salvage: number | null },
  category: { lifeMonths: number | null; salvagePercent: number | null },
): Policy | null {
  if (asset.lifeMonths !== null && asset.salvage !== null) {
    return { lifeMonths: asset.lifeMonths, salvage: asset.salvage, basis: "custom" };
  }
  if (category.lifeMonths === null) return null;
  const salvage = Math.round((asset.cost * (category.salvagePercent ?? 0)) / 100);
  return { lifeMonths: category.lifeMonths, salvage, basis: "category" };
}

export type DepState = "depreciating" | "fully-depreciated" | "not-started" | "no-policy" | "bad-salvage";
export interface DepResult {
  state: DepState; cost: number; accumulated: number; bookValue: number;
  monthly: number | null; startMonth: MonthIndex | null; policy: Policy | null;
}

function chargeFor(base: number, life: number, k: number): number {
  if (k < 1 || k > life) return 0;
  const monthly = Math.floor(base / life);
  return k < life ? monthly : base - monthly * (life - 1);
}

function accumulatedThrough(base: number, life: number, start: MonthIndex, through: MonthIndex): number {
  const months = Math.min(Math.max(through - start + 1, 0), life);
  if (months === life) return base;
  return Math.floor(base / life) * months;
}

export function depreciate(cost: number, confirmedAt: Date | null, policy: Policy | null, asOf: MonthIndex): DepResult {
  const flat = (state: DepState, startMonth: MonthIndex | null): DepResult =>
    ({ state, cost, accumulated: 0, bookValue: cost, monthly: null, startMonth, policy });
  if (!confirmedAt) return flat("not-started", null);
  const start = manilaMonth(confirmedAt) + 1;
  if (!policy) return flat("no-policy", start);
  if (policy.salvage >= cost) return flat("bad-salvage", start);
  if (start > asOf) return flat("not-started", start);
  const base = cost - policy.salvage;
  const accumulated = accumulatedThrough(base, policy.lifeMonths, start, asOf);
  return {
    state: accumulated === base ? "fully-depreciated" : "depreciating",
    cost, accumulated, bookValue: cost - accumulated,
    monthly: Math.floor(base / policy.lifeMonths), startMonth: start, policy,
  };
}

export interface YearRow { opening: number; months: number[]; projected: boolean[]; total: number; closing: number }

export function yearGrid(cost: number, confirmedAt: Date | null, policy: Policy | null, year: number, asOf: MonthIndex): YearRow | null {
  if (!confirmedAt || !policy || policy.salvage >= cost) return null;
  const start = manilaMonth(confirmedAt) + 1;
  const first = year * 12;
  if (start > first + 11) return null;
  const base = cost - policy.salvage;
  const months = Array.from({ length: 12 }, (_, i) => chargeFor(base, policy.lifeMonths, first + i - start + 1));
  const opening = cost - accumulatedThrough(base, policy.lifeMonths, start, first - 1);
  const total = months.reduce((a, b) => a + b, 0);
  if (total === 0 && opening <= policy.salvage) return null;
  return { opening, months, projected: months.map((_, i) => first + i > asOf), total, closing: opening - total };
}

export function stateNote(r: DepResult, categoryName: string): string | null {
  switch (r.state) {
    case "not-started": return "Not depreciating yet";
    case "no-policy": return `No policy for ${categoryName}`;
    case "bad-salvage": return "Salvage exceeds cost";
    case "fully-depreciated": return "Fully depreciated";
    default: return null;
  }
}
```

- [ ] **Step 4: Run the tests and the suite.**
  Run `npx vitest run src/lib/depreciation.test.ts && npx vitest run`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/depreciation.ts src/lib/depreciation.test.ts
git commit -m "feat(finance): pure straight-line depreciation (Manila months, centavos, floor + last-month remainder, year grid, state notes)"
```

---

### Task 3: Inputs, actions and audit sentences

**Files:**
- Create: `src/lib/depreciation-input.ts`, `src/lib/depreciation-input.test.ts`, `src/server/modules/finance/depreciation-actions.ts`
- Modify: `src/lib/activity.ts`, `src/lib/activity.test.ts`

**Interfaces:**
- Consumes: the Task 1 schema.
- Produces:

```ts
// depreciation-input.ts
export const MAX_LIFE_MONTHS = 600;
export function lifeFromYearsMonths(years: string, months: string): number | null | "bad"; // "" + "" → null
export function lifeLabel(months: number | null): string;            // 36 → "3 years", 18 → "1 year 6 months", null → "—"
export const policySchema: z.ZodType<{ categoryId: string; lifeMonths: number | null; salvagePercent: number | null }>;
export const overrideSchema: z.ZodType<{ assetId: string; lifeMonths: number; salvage: number /* pesos */; note: string }>;
// depreciation-actions.ts ("use server")
export async function setCategoryPolicy(input: unknown): Promise<ActionResult<{ affected: number }>>;
export async function setAssetOverride(input: unknown): Promise<ActionResult<null>>;
export async function clearAssetOverride(input: unknown): Promise<ActionResult<null>>; // { assetId }
```

- [ ] **Step 1: Write the failing input tests.**

```ts
import { describe, expect, it } from "vitest";
import { lifeFromYearsMonths, lifeLabel, overrideSchema, policySchema } from "./depreciation-input";

describe("lifeFromYearsMonths", () => {
  it("years + months → months; both empty → no policy", () => {
    expect(lifeFromYearsMonths("3", "")).toBe(36);
    expect(lifeFromYearsMonths("1", "6")).toBe(18);
    expect(lifeFromYearsMonths("", "")).toBeNull();
  });
  it("refuses junk, months ≥ 12, zero and > 50 years", () => {
    for (const [y, m] of [["x", ""], ["1", "12"], ["0", "0"], ["51", "0"], ["-1", ""]]) expect(lifeFromYearsMonths(y, m)).toBe("bad");
  });
});

describe("lifeLabel", () => {
  it("reads naturally", () => {
    expect(lifeLabel(36)).toBe("3 years");
    expect(lifeLabel(18)).toBe("1 year 6 months");
    expect(lifeLabel(5)).toBe("5 months");
    expect(lifeLabel(null)).toBe("—");
  });
});

describe("policySchema", () => {
  it("accepts a policy and a cleared policy", () => {
    expect(policySchema.safeParse({ categoryId: "c", lifeMonths: 36, salvagePercent: 10 }).success).toBe(true);
    expect(policySchema.safeParse({ categoryId: "c", lifeMonths: null, salvagePercent: null }).success).toBe(true);
  });
  it("refuses salvage ≥ 100, > 2 decimals, a % without a life, and life out of range", () => {
    for (const v of [
      { lifeMonths: 36, salvagePercent: 100 }, { lifeMonths: 36, salvagePercent: 10.123 },
      { lifeMonths: null, salvagePercent: 10 }, { lifeMonths: 0, salvagePercent: 0 }, { lifeMonths: 601, salvagePercent: 0 },
    ]) expect(policySchema.safeParse({ categoryId: "c", ...v }).success).toBe(false);
  });
});

describe("overrideSchema", () => {
  it("needs life, salvage and a 3–300 character reason", () => {
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: 5000, note: "refurbished" }).success).toBe(true);
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: 5000, note: "no" }).success).toBe(false);
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: -1, note: "refurbished" }).success).toBe(false);
  });
});
```

  Run `npx vitest run src/lib/depreciation-input.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/lib/depreciation-input.ts`.**

```ts
import { z } from "zod";

/** Phase 35 (spec §3.2-3.3): the depreciation settings' input rules, shared by the forms and the actions. */
export const MAX_LIFE_MONTHS = 600;

export function lifeFromYearsMonths(years: string, months: string): number | null | "bad" {
  const y = years.trim(), m = months.trim();
  if (y === "" && m === "") return null;
  if ((y !== "" && !/^\d+$/.test(y)) || (m !== "" && !/^\d+$/.test(m))) return "bad";
  const total = Number(y || 0) * 12 + Number(m || 0);
  if (Number(m || 0) > 11 || total < 1 || total > MAX_LIFE_MONTHS) return "bad";
  return total;
}

export function lifeLabel(months: number | null): string {
  if (months === null) return "—";
  const y = Math.floor(months / 12), m = months % 12;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [y ? part(y, "year") : "", m ? part(m, "month") : ""].filter(Boolean).join(" ");
}

const twoDecimals = (n: number) => Math.round(n * 100) === n * 100;
const life = z.number().int().min(1, "Life is at least 1 month").max(MAX_LIFE_MONTHS, "Life is at most 50 years");

export const policySchema = z.object({
  categoryId: z.string().min(1),
  lifeMonths: life.nullable(),
  salvagePercent: z.number().min(0, "Salvage can't be negative").lt(100, "Salvage must be under 100%")
    .refine(twoDecimals, "Two decimals at most").nullable(),
}).refine((v) => v.lifeMonths !== null || v.salvagePercent === null, { message: "Set a useful life first", path: ["lifeMonths"] });

export const overrideSchema = z.object({
  assetId: z.string().min(1),
  lifeMonths: life,
  salvage: z.number().min(0, "Salvage can't be negative").refine(twoDecimals, "Whole centavos only"),
  note: z.string().trim().min(3, "Say why this asset differs").max(300),
});
```

  Run the test. Expected: PASS.

- [ ] **Step 3: Failing audit-sentence test.** Append to `src/lib/activity.test.ts`:

```ts
describe("Phase 35 depreciation sentences", () => {
  const s = (action: string, diff: unknown, label = "Laptop") => auditSentence({ actorLabel: "L. Domingo", action, diff, entityLabel: label });
  it("policy set and cleared", () => {
    expect(s("depreciation.policy", { lifeMonths: { from: null, to: 36 }, salvagePercent: { from: null, to: 10 } }))
      .toBe("L. Domingo set depreciation on Laptop: 3 years, 10% salvage");
    expect(s("depreciation.policy", { lifeMonths: { from: 36, to: null }, salvagePercent: { from: 10, to: null } }))
      .toBe("L. Domingo cleared depreciation on Laptop");
  });
  it("override set and cleared", () => {
    expect(s("depreciation.override", { lifeMonths: { from: null, to: 24 }, salvage: { from: null, to: 5000 } }, "BR-LT-0148"))
      .toBe("L. Domingo set custom depreciation on BR-LT-0148: 2 years, ₱5,000.00 salvage");
    expect(s("depreciation.override.cleared", null, "BR-LT-0148")).toBe("L. Domingo cleared custom depreciation on BR-LT-0148");
  });
});
```

  Run it. Expected: FAIL.

- [ ] **Step 4: Add the cases in `src/lib/activity.ts`.**

  Add them before `default`, using the switch's `actor`, `diff` and `omitEntity` locals. Import `lifeLabel` from `./depreciation-input` and `fmtMoneyExact` from `./format`.

```ts
    case "depreciation.policy": {
      const life = diff?.lifeMonths?.to as number | null | undefined;
      if (life == null) return omitEntity ? `${actor}cleared depreciation` : `${actor}cleared depreciation on ${entry.entityLabel}`;
      const pct = (diff?.salvagePercent?.to as number | null | undefined) ?? 0;
      const tail = `${lifeLabel(life)}, ${pct}% salvage`;
      return omitEntity ? `${actor}set depreciation: ${tail}` : `${actor}set depreciation on ${entry.entityLabel}: ${tail}`;
    }
    case "depreciation.override": {
      const tail = `${lifeLabel(diff?.lifeMonths?.to as number)}, ${fmtMoneyExact(diff?.salvage?.to as number)} salvage`;
      return omitEntity ? `${actor}set custom depreciation: ${tail}` : `${actor}set custom depreciation on ${entry.entityLabel}: ${tail}`;
    }
    case "depreciation.override.cleared":
      return omitEntity ? `${actor}cleared custom depreciation` : `${actor}cleared custom depreciation on ${entry.entityLabel}`;
```

  Run the test. Expected: PASS. If `activity.ts` keeps an Action-filter label map (search for `"purchase.recorded"` in `src/lib`), add the three actions there with the labels "Depreciation policy", "Custom depreciation" and "Custom depreciation cleared".

- [ ] **Step 5: Implement `src/server/modules/finance/depreciation-actions.ts`.**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { overrideSchema, policySchema } from "@/lib/depreciation-input";

/** Phase 35 (spec §3.2): a category's policy; the reply says how many costed assets it now drives (overrides excluded). */
export async function setCategoryPolicy(input: unknown): Promise<ActionResult<{ affected: number }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const cat = await prisma.assetCategory.findUnique({ where: { id: d.categoryId } });
  if (!cat) return conflict("That category no longer exists. Refresh and try again.");
  const before = { lifeMonths: cat.depreciationLifeMonths, salvagePercent: cat.depreciationSalvagePercent === null ? null : Number(cat.depreciationSalvagePercent) };
  await prisma.$transaction(async (tx) => {
    await tx.assetCategory.update({
      where: { id: cat.id },
      data: { depreciationLifeMonths: d.lifeMonths, depreciationSalvagePercent: d.lifeMonths === null ? null : (d.salvagePercent ?? 0) },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset-category", entityId: cat.id, action: "depreciation.policy",
      diff: {
        lifeMonths: { from: before.lifeMonths, to: d.lifeMonths },
        salvagePercent: { from: before.salvagePercent, to: d.lifeMonths === null ? null : (d.salvagePercent ?? 0) },
      },
    });
  });
  const affected = await prisma.asset.count({ where: { categoryId: cat.id, cost: { not: null }, depreciationLifeMonths: null } });
  revalidatePath("/finance/depreciation");
  revalidatePath("/finance/assets");
  return ok({ affected });
}

/** Phase 35 (spec §3.3): life AND salvage (pesos) AND a reason, together. */
export async function setAssetOverride(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const asset = await prisma.asset.findUnique({ where: { id: d.assetId } });
  if (!asset || asset.cost === null) return conflict("This asset has no cost, so it can't depreciate.");
  if (d.salvage >= Number(asset.cost)) return validationError({ salvage: "Salvage must be less than the cost" });
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id: asset.id }, data: { depreciationLifeMonths: d.lifeMonths, depreciationSalvage: d.salvage, depreciationNote: d.note } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: "depreciation.override",
      diff: {
        lifeMonths: { from: asset.depreciationLifeMonths, to: d.lifeMonths },
        salvage: { from: asset.depreciationSalvage === null ? null : Number(asset.depreciationSalvage), to: d.salvage },
        note: { from: asset.depreciationNote, to: d.note },
      },
    });
  });
  revalidatePath("/finance/assets");
  revalidatePath("/finance/depreciation");
  return ok(null);
}

export async function clearAssetOverride(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const id = typeof input === "object" && input && "assetId" in input ? String((input as { assetId: unknown }).assetId) : "";
  if (!id) return validationError({ assetId: "Missing asset" });
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset || asset.depreciationLifeMonths === null) return conflict("This asset has no custom depreciation to clear.");
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null } });
    await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: id, action: "depreciation.override.cleared" });
  });
  revalidatePath("/finance/assets");
  revalidatePath("/finance/depreciation");
  return ok(null);
}
```

- [ ] **Step 6: Run the checks.** Run `npx tsc --noEmit && npx vitest run`. Expected: green.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/depreciation-input.ts src/lib/depreciation-input.test.ts src/server/modules/finance/depreciation-actions.ts src/lib/activity.ts src/lib/activity.test.ts
git commit -m "feat(finance): depreciation inputs, policy/override actions (role → rate → zod, audited), audit sentences"
```

---

### Task 4: Queries (rows, totals, policies, schedule, home)

**Files:**
- Create: `src/server/modules/finance/depreciation-queries.ts`
- Modify: `src/server/modules/finance/queries.ts`, `src/server/modules/home/queries.ts`

**Interfaces:**
- Consumes: `depreciate`, `resolvePolicy`, `toCentavos`, `asOfMonth`, `monthLabel`, `monthEndLabel`, `stateNote`, `yearGrid`, `manilaMonth` (Task 2); `lifeLabel` (Task 3).
- Produces:

```ts
// depreciation-queries.ts (server-only)
export interface DepAssetRow { id: string; tag: string; model: string; category: string; cls: AssetClass; status: AssetStatus;
  costC: number; confirmedAt: Date | null; result: DepResult; note: string | null; custom: boolean; overrideNote: string | null;
  lifeMonths: number | null; salvageC: number | null; categoryLife: number | null; categorySalvagePercent: number | null }
// (affectedByPolicy lives in src/lib/depreciation.ts — pure, unit-tested; see Step 1)
export async function depRows(where: Prisma.AssetWhereInput, now?: Date): Promise<DepAssetRow[]>;
export async function bookValueTotals(where: Prisma.AssetWhereInput, now?: Date): Promise<{ costC: number; accumulatedC: number; bookC: number; asOf: MonthIndex }>;
export interface PolicyRow { id: string; name: string; cls: AssetClass; costed: number; lifeMonths: number | null; salvagePercent: number | null; changedBy: string | null; changedAt: Date | null }
export async function policyRows(): Promise<PolicyRow[]>;     // no-policy first, then class, then name
export interface ScheduleGroup { category: string; rows: Array<{ id: string; tag: string; model: string; costC: number; grid: YearRow }>; subtotal: YearRow }
export async function scheduleYear(cls: AssetClass, year: number, now?: Date): Promise<{ groups: ScheduleGroup[]; total: YearRow; notStarted: number; noPolicy: number; asOf: MonthIndex; years: number[] }>;
// finance/queries.ts: FinanceAssetRow gains { accumulated: string; bookValue: string; note: string | null; custom: boolean; overrideNote: string | null; lifeMonths: number | null; salvage: string | null; categoryLife: string; costNumber: number }
//   financeAssets(...) return adds { totalDepreciation: string; totalBookValue: string; asOfLabel: string }
// home/queries.ts: FinanceHome gains { bookValue: string; depreciation: string; asOfEnd: string }
```

- [ ] **Step 1: A failing test for the pure helper** (Review Focus 4).
  Add `src/server/modules/finance/depreciation-queries.test.ts`, or put the helper in `src/lib/depreciation.ts` if server modules are excluded from vitest's include. **They are not:** the include is `src/**/*.test.{ts,tsx}`. The test must import only the pure helper, so put `affectedByPolicy` in `src/lib/depreciation.ts` and re-export it.

```ts
import { affectedByPolicy } from "./depreciation";
it("a category change counts costed rows without a custom override", () => {
  expect(affectedByPolicy([{ costC: 100, custom: false }, { costC: 200, custom: true }, { costC: null, custom: false }])).toBe(1);
});
```

  Implement it in `src/lib/depreciation.ts`:

```ts
export function affectedByPolicy(rows: Array<{ costC: number | null; custom: boolean }>): number {
  return rows.filter((r) => r.costC !== null && !r.custom).length;
}
```

- [ ] **Step 2: Implement `depreciation-queries.ts`.** Every function routes through the Task 2 functions; none recomputes arithmetic itself.
  - **`depRows(where)`:** `prisma.asset.findMany({ where: { ...where, cost: { not: null } }, select: { id, tag, model, cls, status, cost, financeConfirmedAt, depreciationLifeMonths, depreciationSalvage, depreciationNote, category: { select: { name, depreciationLifeMonths, depreciationSalvagePercent } } } })`. Map each row with `costC = toCentavos(cost)!`, `policy = resolvePolicy(...)` and `result = depreciate(costC, financeConfirmedAt, policy, asOfMonth(now))`.
  - **`bookValueTotals(where)`:** sums `depRows` results.
  - **`policyRows()`:** reads categories with `_count` of costed assets. Find the latest change per category with `prisma.auditEntry.findMany({ where: { entityType: "asset-category", action: "depreciation.policy" }, orderBy: { createdAt: "desc" }, select: { entityId, actorLabel, createdAt } })`, keeping the first per `entityId`.
  - **`scheduleYear(cls, year)`:**
    - Build `depRows({ cls })`, then `yearGrid` per row, dropping nulls.
    - Group by category name and sort by category, then tag.
    - Subtotals and the total sum the `YearRow` fields element-wise; a subtotal's `projected` equals the year's projected flags.
    - `notStarted` / `noPolicy` count the rows whose `result.state` is `not-started` / `no-policy`.
    - `years` runs from the earliest `manilaMonth(financeConfirmedAt)` year (or this year) to this year + 1.
- [ ] **Step 3: Extend `financeAssets` in `finance/queries.ts`.**
  - **Per row:** add `select`/`include` of the depreciation fields and the category policy, then compute each row with `resolvePolicy` + `depreciate`. Set `accumulated` / `bookValue` via `fmtMoneyExact(c / 100)`, `note = stateNote(...)`, `custom = policy?.basis === "custom"`, `overrideNote`, `lifeMonths`, `salvage` (pesos as string) and `categoryLife = lifeLabel(category life)`.
  - **Totals over the whole filter (P-4):** call `bookValueTotals(where)` inside the same function and return `totalDepreciation`, `totalBookValue` and `asOfLabel = monthLabel(asOf)`.
  - Update the doc comment that says "No book-value column".
- [ ] **Step 4: Extend `financeHome`.**
  Add `bookValueTotals({})`, which gives both classes as the spec requires. Return `bookValue`, `depreciation` (via `fmtMoneyExact`) and `asOfEnd = monthEndLabel(asOf)`.
- [ ] **Step 5: Run the checks.** Run `npx tsc --noEmit && npx vitest run`. Expected: green.
- [ ] **Step 6: Commit.**

```bash
git add src/server/modules/finance/depreciation-queries.ts src/server/modules/finance/queries.ts src/server/modules/home/queries.ts src/lib/depreciation.ts src/lib/depreciation.test.ts
git commit -m "feat(finance): depreciation queries -- per-row results, whole-filter totals, policy rows with last change, year schedule, home totals"
```

---

### Task 5: The Depreciation page — Policies tab, nav entry

**Files:**
- Create: `src/app/(app)/finance/depreciation/page.tsx`, `src/components/finance/policy-row.tsx`
- Modify: `src/lib/workspaces.ts`, `src/lib/workspaces.test.ts`

**Interfaces:**
- Consumes: `policyRows` (Task 4), `setCategoryPolicy` (Task 3), `lifeFromYearsMonths`, `lifeLabel` (Task 3).
- Produces the DOM contract (relied on by e2e):
  - **Page:** `PageHeader title="Depreciation"`, and `Tabs label="Depreciation views"` with items "Schedule" (`?tab=schedule` or bare) and "Policies" (`?tab=policies`).
  - **Notice:** when policies are missing, `"{n} categories have no useful life yet — their assets show at full cost."`
  - **Row:** each row is a `<tr>` whose first cell is the category name.
    - Its inputs are labelled `"Years for {category}"`, `"Months for {category}"` and `"Salvage percent for {category}"`. The word "life" is avoided so the labels don't repeat the column header word.
    - The save button reads `Save`.
    - The warning line `"This updates the book value of {n} assets, including past months on the schedule."` shows only while the row is dirty and the category has costed, non-custom assets.
  - **Toast on save:** `Saved — {category}`.

- [ ] **Step 1: Nav entry (P-5).**
  In `WORKSPACE_NAV.finance`, the "Capitalized assets" `items` become `[{ label: "Approved assets", href: "/finance/assets" }, { label: "Depreciation", href: "/finance/depreciation" }, { label: "Activity log", href: "/finance/activity" }]`. Add to `workspaces.test.ts`:

```ts
it("Finance nav carries Depreciation under Capitalized assets", () => {
  const sec = WORKSPACE_NAV.finance.find((s) => s.heading === "Capitalized assets");
  expect(sec?.items.map((i) => i.label)).toEqual(["Approved assets", "Depreciation", "Activity log"]);
});
it("/finance/depreciation is Finance-only", () => {
  expect(pathAllowedForRole("/finance/depreciation", "finance_staff")).toBe(true);
  expect(pathAllowedForRole("/finance/depreciation", "it_staff")).toBe(false);
  expect(pathAllowedForRole("/finance/depreciation", "purchasing_staff")).toBe(false);
});
```

  Run `npx vitest run src/lib/workspaces.test.ts`. Expected: PASS.
- [ ] **Step 2: `policy-row.tsx` (client).**
  - **Props:** `{ row: PolicyRow; affected: number }`, where `affected` is the costed count minus custom overrides, computed server-side with `affectedByPolicy`.
  - **State:** `years`, `months` (from `row.lifeMonths`) and `salvage` (string).
  - **Dirty** means the values differ from the initial ones.
  - **Save:** parse with `lifeFromYearsMonths`. A `"bad"` result shows the inline error "Enter whole years and 0–11 months, up to 50 years". Otherwise call `setCategoryPolicy({ categoryId, lifeMonths, salvagePercent: salvage === "" ? null : Number(salvage) })`.
  - **Result handling:** use the `useEmployeeRunner` pattern (copy its shape into a local `useFinanceRunner` inside `src/components/finance/use-finance-runner.ts`). Field errors render under the inputs.
  - **Visible cells:** Category · Class pill · Costed (count) · Useful life (two numeric inputs, `inputMode="numeric"`, "y" / "m" suffixes) · Salvage % (input, "%" suffix) · Last changed ("L. Domingo · 15 Oct 2026" or "—") · Save button.
- [ ] **Step 3: `page.tsx`.**
  - **Guard:** `requireRole("admin", "finance_staff")`.
  - **Tab:** read `tab` from `searchParams`, defaulting to `schedule`.
  - **Policies:** call `policyRows()` and `affected` per category from `depRows`, i.e. the count of costed rows with no override; reuse `affectedByPolicy`. Render the notice and a `Table` of `PolicyRow`s.
  - **Schedule:** until Task 7 lands (same branch, never merged alone) the Schedule tab renders only the tab row; Task 7 fills it and makes it the default.
- [ ] **Step 4: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`, then a foreground smoke: `E2E_PORT=3100 npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000`. Expected: green.
- [ ] **Step 5: Commit.**

```bash
git add src/lib/workspaces.ts src/lib/workspaces.test.ts src/app/(app)/finance/depreciation/page.tsx src/components/finance/policy-row.tsx src/components/finance/use-finance-runner.ts
git commit -m "feat(finance): Depreciation page Policies tab -- inline life + salvage per category, change warning, last changed; nav entry"
```

---

### Task 6: Approved assets — columns, totals, override dialog, export

**Files:**
- Modify: `src/app/(app)/finance/assets/page.tsx`, `src/lib/export-columns.ts`
- Create: `src/components/finance/asset-row-menu.tsx`, `src/components/finance/override-dialog.tsx`, `src/app/(app)/finance/assets/export/route.ts`

**Interfaces:**
- Consumes: the extended `financeAssets` (Task 4), `depRows` (Task 4), `setAssetOverride` / `clearAssetOverride` (Task 3).
- Produces the DOM contract:
  - **New headers:** "Depreciation to date" and "Book value", both right-aligned.
  - **Under the book value:** the state note (muted, 11px).
  - **Custom marker:** a `Pill` "custom" beside the tag when overridden.
  - **Row menu:** `IconButton aria-label="Actions for {tag}"`, with the item "Depreciation for this asset…".
  - **Dialog** titled `Depreciation for {tag}`, containing:
    - the category's values as muted text, e.g. "Category: 3 years, 10% salvage", or "Category: no policy";
    - inputs labelled "Years", "Months", "Salvage (₱)" and **Reason** (`ReasonField`);
    - the buttons "Save", "Cancel" and, when custom, "Clear override".
  - **Footer line:** `{n} assets · {cost} at cost · {dep} depreciation · {book} book value` plus `As of the end of {Month YYYY}`.
  - **Export:** a button "Export" (`ButtonLink` to `/finance/assets/export?…`, carrying the current `cls`/`status`).

- [ ] **Step 1: Export columns.**
  In `src/lib/export-columns.ts`, add `BOOK_VALUE_EXPORT_COLUMNS: XlsxColumn<DepAssetRow>[]`. Its labels, in order: Tag, Model, Category, Class, Status, Cost, Confirmed on, Starts, Life (months), Salvage, Monthly amount, Depreciation to date, Book value, Basis, Note.
  - Money cells are `{ value: c / 100, type: Number, format: "#,##0.00" }`.
  - Dates are `{ value: date, type: Date, format: "yyyy-mm-dd" }`.
  - "Starts" is the `monthLabel` text.
  - "Basis" is "Custom" or "Category" (empty when there is no policy).
  - "Note" is the override note if custom, else the state note.
- [ ] **Step 2: Export route** `src/app/(app)/finance/assets/export/route.ts`.
  `requireRole("admin", "finance_staff")`. Parse `cls` (default IT) and `status` exactly as the page does. Build the same `where` the page uses (costed; IT gated on `itVerifiedAt`), then call `depRows(where)`. Over `EXPORT_CAP` → `capRefusal`. Otherwise `toXlsxBuffer(BOOK_VALUE_EXPORT_COLUMNS, rows)` → `xlsxResponse(exportFilename("finance-book-value", new Date()), buf)`.
- [ ] **Step 3: Row menu and dialog (client).**
  - **Menu:** `asset-row-menu.tsx` takes `{ id, tag, cost: number, custom: boolean, lifeMonths, salvage, note, categoryText }` and holds `open` state. It renders `Menu` + `IconButton` (pattern: `src/components/home/work-row-menu.tsx`) and `OverrideDialog`.
  - **Dialog:** the `TransferDialog` pattern (Dialog + FormField + ReasonField + runner).
    - Save: `lifeFromYearsMonths` must not be null or "bad" (refuse with "Enter the asset's useful life"), the salvage is parsed as pesos, then call `setAssetOverride`.
    - Clear: `clearAssetOverride`.
    - Toasts: "Custom depreciation saved — {tag}" and "Custom depreciation cleared — {tag}".
- [ ] **Step 4: Page.**
  Add the two columns, the note, the custom pill, the last column holding `AssetRowMenu`, the new footer line, and Export next to the class tabs. Rename the page title from "Capitalized assets" to "Approved assets" only if the nav already says "Approved assets" (it does); keep the heading text in sync with the nav. **Ruling P-7:** the title becomes "Approved assets". Grep the e2e for `"Capitalized assets"` heading pins and update them in Task 8.
- [ ] **Step 5: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.
- [ ] **Step 6: Commit.**

```bash
git add -A src/app/(app)/finance/assets src/components/finance src/lib/export-columns.ts
git commit -m "feat(finance): Approved assets shows depreciation to date and book value with whole-filter totals, a per-asset override dialog, and an Excel export"
```

---

### Task 7: Schedule tab, its export, and the home stat

**Files:**
- Create: `src/components/finance/schedule-table.tsx`, `src/app/(app)/finance/depreciation/export/route.ts`
- Modify: `src/app/(app)/finance/depreciation/page.tsx`, `src/app/(app)/page.tsx`, `src/lib/export-columns.ts`

**Interfaces:**
- Consumes: `scheduleYear` (Task 4), `financeHome` additions (Task 4).
- Produces the DOM contract:
  - **Controls:** class tabs (`Tabs label="Asset class"`: IT / Purchasing) and a year `<select aria-label="Year">`. The year select is a GET form whose submit button reads "Show", for no-JS; keep the selected `tab` and `cls`.
  - **Table:** `<table aria-label="Depreciation schedule {year}">`, with headers Tag, Model, Category, Cost, "Book value 1 Jan", Jan … Dec, "Year total", "Book value 31 Dec".
    - A projected month header carries `title="projected"` and a muted style. Its cells are muted too.
  - **Rows:** category subtotal rows read `Subtotal — {category}`, and the grand total reads `Total`.
  - **Above the table:** `{n} assets aren't depreciating yet · {m} have no policy`, with a link "Set policies" to `?tab=policies`.
  - **Empty year:** "No asset depreciates in {year}." (Review Focus 5).
  - **Export:** a link "Export" → `/finance/depreciation/export?year={y}&cls={c}`.
  - **Home:** `<Stat label="Book value" value={d.bookValue} hint={`after ${d.depreciation} depreciation · as of ${d.asOfEnd}`} />`, linked to `/finance/assets`. Wrap the `Stat` in a `Link`, and make the grid `sm:grid-cols-4`.

- [ ] **Step 1: `schedule-table.tsx` (server).**
  Render the grid with `fmtMoneyExact(c / 100)` per cell, inside an `overflow-x: auto` box. The first two columns are sticky (`sticky left-0` and `left-[112px]`, with a background). Subtotal rows get `bg-surface-subtle font-semibold`.
- [ ] **Step 2: Export columns and route.**
  - **Columns:** `SCHEDULE_EXPORT_COLUMNS: XlsxColumn<ScheduleSheetRow>[]`, where `ScheduleSheetRow = { tag: string; model: string; category: string; costC: number | null; grid: YearRow }`. Subtotal and total rows use an empty tag and model, with category "Subtotal — {category}" / "Total" and cost `null`.
  - **Route:** `requireRole("admin", "finance_staff")`. Parse `year` (integer 2000–2100, default this year) and `cls`. Flatten the groups into rows with the subtotal after each group and the total last. Over `EXPORT_CAP` → `capRefusal`. File name: `depreciation-${cls.toLowerCase()}-${year}.xlsx`. Use `xlsxResponse(\`depreciation-${cls.toLowerCase()}-${year}.xlsx\`, buf)`; that name is already safe characters.
- [ ] **Step 3: Page Schedule tab and home stat.**
  Replace Task 5's placeholder with the Schedule tab, and add the home stat.
- [ ] **Step 4: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.
- [ ] **Step 5: Commit.**

```bash
git add -A src/app/(app)/finance/depreciation src/components/finance/schedule-table.tsx src/app/(app)/page.tsx src/lib/export-columns.ts
git commit -m "feat(finance): year depreciation schedule (Jan-Dec grid, category subtotals, projected months, Excel export) and the home Book value stat"
```

---

### Task 8: e2e, adapted pins, battery and docs

**Files:**
- Create: `e2e/finance-depreciation.spec.ts`
- Modify: any spec pinning "Capitalized assets" as the `/finance/assets` heading (grep), and the docs.

- [ ] **Step 1: Write `e2e/finance-depreciation.spec.ts`.**
  - **House shape:** copy `login`, `expectNoSeriousAxe` and `waitForHydration` from `e2e/queues-records-ux.spec.ts:62-85`; `beforeAll` seeds; `afterAll` disconnects.
  - **Fixture:** a Prisma helper sets `financeConfirmedAt` on chosen seeded assets to a fixed past date, e.g. `2026-01-14T10:00:00+08:00`. Restore them in `finally` (plain field updates, no audit rows touched). Read exports with `readSheet` from `read-excel-file/node`, as `e2e/directory.spec.ts:5` does.
  - **Cases:**
    1. Finance (finance@) opens `/finance/depreciation?tab=policies`. The notice counts categories without a policy. Fill "Years for Laptop" = 3 and "Salvage percent for Laptop" = 10; the change warning shows; Save. The toast reads "Saved — Laptop". The DB category has life 36 and 10.00%, and one `depreciation.policy` audit row exists. Axe passes.
    2. `/finance/assets` (IT tab) shows "Depreciation to date" and "Book value". For one confirmed laptop, the book value equals the value computed in the test with the same formula from `src/lib/depreciation.ts`: import `depreciate` / `resolvePolicy` / `asOfMonth` from `@/lib/depreciation`, the way existing specs import from `@/lib`. The footer shows totals and "As of the end of".
    3. Override: the row menu "Actions for BR-LT-0148" opens "Depreciation for this asset…". Set 2 years, ₱5,000 and the reason "refurbished unit"; Save. The row shows "custom", and the book value changes. "Clear override" reverts it, and two audit rows exist.
    4. An unconfirmed costed asset shows "Not depreciating yet". A confirmed asset in a no-policy category shows "No policy for {category}".
    5. Home (finance@ on `/`) shows the "Book value" stat with "as of".
    6. Schedule: on `/finance/depreciation` (the current year), the table "Depreciation schedule {year}" has a "Subtotal — Laptop" row and a "Total" row. Months after the as-of month have `title="projected"`. The year select switches to `year + 1`. Pick a year before any confirmation (e.g. 2020) and see "No asset depreciates in 2020." Axe passes.
    7. Both exports download. `finance-book-value-YYYY-MM-DD.xlsx` has header row `[Tag, Model, …, Note]`. `depreciation-it-{year}.xlsx` has the header row and a "Total" row.
    8. it@ and purchasing@ visiting `/finance/depreciation` are redirected away (not 200 on that path), and posting the action from their session is refused. The action refusal is covered by the role guard; asserting the redirect is enough.
- [ ] **Step 2: Adapt pins.**
  Run `grep -rn "Capitalized assets" e2e`. Every heading pin on `/finance/assets` becomes "Approved assets" (P-7); the nav-section heading "Capitalized assets" is unchanged. Run each changed file alone in the foreground.
- [ ] **Step 3: The battery.**
  Run the seven chunks from `docs/HANDOVER.md` §0 item 9 with `e2e/finance-depreciation.spec.ts` added to **chunk C** (home-finance is there). Split D, E1 and F into halves when slow, as before.
  - `npx playwright test --list | tail -1`: expect the previous total + this file's cases, in 45 files.
  - `npx vitest run`, `npx tsc --noEmit` and `npm run lint` must be green.
  - `npx prisma migrate status`: 28 migrations.
  - `npm run db:seed` runs last.
- [ ] **Step 4: Docs.**
  - `HANDOVER.md`: a status prefix on line 3, a new lettered block before the newest (that is "(aa)", so add "(ab)"), and the chunk C line gains the new file.
  - `PICKUP.md`: branch row, battery row, §4 item 1.
  - `HANDOVER-PENDING.md`: §5.2 marks "Depreciation module" shipped in Phase 35.
  - The spec's Status line, and this plan's D-block.
  - State everywhere: code-complete, unmerged and unpushed; **migration 28**; staging deploys by pulling the GitHub Actions image (the laptop never builds).
- [ ] **Step 5: Commit.**

```bash
git add e2e/finance-depreciation.spec.ts docs/HANDOVER.md docs/PICKUP.md docs/HANDOVER-PENDING.md docs/superpowers/specs/2026-10-15-depreciation-design.md docs/superpowers/plans/2026-10-15-phase-35-depreciation.md
git commit -m "test(e2e)+docs: Phase 35 depreciation -- policies, book value, override, home stat, year schedule, exports, access; battery; migration 28"
```

(Add the adapted spec files to the commit too.)

---

## D-block (decisions made during execution)

(Filled in during execution: each ruling as `D-n — what — why — cost if wrong`.)
