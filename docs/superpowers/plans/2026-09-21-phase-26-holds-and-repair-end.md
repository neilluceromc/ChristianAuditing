# Phase 26 — Holds that work and the repair end-date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IT can reserve a spare for a person (from the asset record or the person's empty policy slot), release a hold (record, profile, `/reservations`), holds expire on their own through an hourly worker sweep, `/reservations` gets list parity, and a repair's end is stamped on the asset so RETURNED OK rows report real downtime.

**Architecture:** One additive migration (`Asset.repairEndedAt`, backfilled from audit history). Pure rules in `src/lib/holds.ts` and a widened `downDays` in `src/lib/repairs.ts` land first. Two direct server actions (`reserveAsset`, `releaseHold`) with asset-side audit entries; `prepareLifecycle` stamps the repair end; `listReservations` learns `ListState` + facets; the worker gets `expireHolds`. Then the asset-record UI (a `reserve` mode on `HolderControl`, a held banner, a Release button), the profile UI (a "Reserve a spare…" slot-menu item, pills and Release in the holding area) and the rebuilt `/reservations` list. One new e2e file, then the battery and docs.

**Tech Stack:** Next.js 15 App Router (RSC + client components), Prisma 6 / PostgreSQL 16, Auth.js v5, zod 4, vitest, Playwright + axe, tsx worker.

**Spec:** `docs/superpowers/specs/2026-09-21-holds-and-repair-end-design.md` (2bed93b + corrections committed with this plan). Facts (scratch, git-ignored, at the repo root — copy both into the SDD workspace `briefs/`): `.superpowers/sdd/phase-26-facts.md` (brainstorm facts) and `.superpowers/sdd/phase-26-plan-facts.md` (verbatim code every task below edits).

## Global Constraints

- Migration 25 is additive, nullable, forward-only, house shape: bare `ALTER TABLE … ADD COLUMN`, then a commented backfill citing the decision. Created with `npx prisma migrate dev --create-only --name repair_end_and_holds` in the worktree, SQL edited, applied with `npx prisma migrate dev --skip-seed`, then `npx prisma generate`. If Prisma reports drift and offers a reset, STOP and report — never reset a database from a task. Never seed staging; staging gets migration 25 at the next `-Force` redeploy after a merge.
- Every server action: role guard (`actionRole("admin", "it_staff")` → `forbidden()`) THEN `checkRate(user.id)` → `rateLimited(...)`; one `writeAudit` per domain write inside the same `prisma.$transaction`; `ActionResult` returns. Audit action strings for holds are exactly `reservation.placed` and `reservation.released`; expiry writes no audit row.
- Copy (verbatim): buttons "Reserve", "Reserve a spare…", "Release", "Assign"; fields "For", "Expires", "Reason"; banner "Held for {name}"; errors "Pick today or later", "{tag} is already held for {employeeNo} — release that hold first.", "{tag} is not a spare.", "Holds are for IT spares.", "{tag} has an open request — decide it first.", "{name} is {employment} — slots are frozen.", "That hold is already closed.", "That hold no longer exists.", "That asset no longer exists.", "That employee no longer exists."; pill text "expires in N d" / "expires today" / "expired N d ago"; record copy "N d out of service" (DEFECTIVE), "down N d, back since {date}" (closed), "clock stopped" only when no end is recorded; worker log `[worker] expired N hold(s)`.
- No `aria-label` near a form field may contain that field's label word (Playwright `getByLabel` substring-matches aria-label). Heading rows in comboboxes stay `role="presentation"`. Links inside clickable rows stop propagation. Keep the existing `HOLD` pill and holder link markup in the inventory row exactly (an e2e locates them); append the expiry text after them.
- `canAssign` on the asset record is UNCHANGED (an existing e2e assigns a held asset to its holder); only `canReserve`/`canReleaseHold` are new.
- Dev only in a git worktree with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`, no `SEED_PASSWORD`. Never read or print `.env` (`grep -c "^NAME=" .env` only). After `npm ci` run `npx prisma generate` (npm 12 blocks install scripts). Never touch the `inventory` database or port 3000.
- Dev server for a walk: `npm run dev -- -p 3100`, FOREGROUND; only ONE implementer walks at a time; after stopping: `netstat -ano | findstr :3100 | findstr LISTENING` prints nothing, else `taskkill /PID <pid> /T`. `npm run worker:once` and `npx tsx -e` proofs hit `inventory_dev` only.
- Playwright: FOREGROUND, `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`, one process at a time; nobody seeds (`npm run db:seed`) while another agent walks or tests; e2e fixtures never delete `AuditEntry` rows (append-only at the database).
- Docs are CRLF in the working tree; edits preserve line endings.
- Commits: `git add` new files before a pathspec commit; a wrong message is fixed with a NEW commit, never amend/reset; every message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Rulings, not stalls: the controller records every ruling in the SDD ledger and Task 6 copies them into this plan's D-block.

### File structure (who owns what)

| Area | Files | Task |
|---|---|---|
| Schema + pure rules | `prisma/schema.prisma`, `prisma/migrations/<ts>_repair_end_and_holds/migration.sql` (new), `src/lib/holds.ts` (+test, new), `src/lib/repairs.ts` (+test), `src/lib/reason-chips.ts`, `src/lib/activity.ts` (+test), `src/components/patterns/activity-feed.tsx` (`actionDot`), `src/components/ui/hold-pill.tsx` (new), `src/server/modules/reservations/queries.ts` (tab re-export only), `src/server/modules/inventory/queries.ts` (`stageOf`/`toRow` widen), `src/server/modules/home/queries.ts` (repair rows select) | 1 |
| Server + worker | `src/server/modules/lifecycle/apply.ts`, `src/server/modules/lifecycle/actions.ts` (`assetSelect`), `src/server/modules/reservations/actions.ts` (new), `src/server/modules/reservations/queries.ts`, `src/server/modules/inventory/queries.ts` (`AssetRow.hold.expiresAt`), `src/app/(app)/reservations/page.tsx` (call-site only), `src/worker/holds.ts` (new), `src/worker/index.ts` | 2 |
| Asset-record UI + list | `src/components/inventory/holder-control.tsx`, `src/components/inventory/release-hold-button.tsx` (new), `src/app/(app)/inventory/[id]/layout.tsx`, `src/app/(app)/inventory/[id]/page.tsx`, `src/app/(app)/inventory/[id]/reservations/page.tsx`, `src/components/inventory/inventory-table.tsx`, `src/app/(app)/inventory/page.tsx` | 3 |
| Profile + `/reservations` UI | `src/components/employees/loadout-view.tsx`, `src/app/(app)/employees/[id]/page.tsx`, `src/app/(app)/reservations/page.tsx`, `src/components/reservations/holds-toolbar.tsx` (new), `src/components/reservations/holds-table.tsx` (new) | 4 |
| E2E | `e2e/holds.spec.ts` (new) | 5 |
| Battery + docs | `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, this plan, the spec | 6 |

### Execution order (P-1)

Strictly sequential: **Task 1 → 2 → 3 → 4 → 5 → 6**. Task 2 consumes Task 1's exports; Tasks 3 and 4 consume Task 2's; Tasks 3 and 4 both walk a dev server (one walker at a time); Task 5 is the sole Playwright user; Task 6 runs the battery.

**P-2** `RESERVATION_TABS`/`parseReservationTab`/`ReservationTab` move to `src/lib/holds.ts` in Task 1; `reservations/queries.ts` re-exports them so every caller compiles until Task 4 rewrites the page. **P-3** `RepairLike` gains `repairEndedAt` in Task 1, so every consumer (`stageOf`, `toRow`, the Home repair rows, the fixture rows, the test helper) changes in Task 1 too — tsc must be green at the end of every task. **P-4** `listReservations(tab, state)` changes signature in Task 2; Task 2 also updates the page's one call so the tree compiles; Task 4 replaces the page. **P-5** The empty slot's Reserve affordance is a `⋯` menu item ("Reserve a spare…"), because the whole empty tile is already the Assign affordance. **P-6** e2e case 2 uses Nina Robles (EMP-0097, "Finance standard" policy, empty phone slot); Carlo Dizon has no policy. **P-7** `--list` expected after Task 5: **364 tests / 35 files**; the new file joins battery chunk F. **P-8** Every e2e mutation is restored in `finally` (created reservations deleted by id; asset fields restored to values read before the case); no audit deletes.

---

### Task 1: Schema, migration 25 and the pure rules

**Files:**
- Modify: `prisma/schema.prisma` (after `defectiveSince`, ~line 410), `src/lib/repairs.ts` (`RepairLike` 33-40, `downDays` 72-78, `repairStageFixture` rows), `src/lib/repairs.test.ts` (`asset()` helper 9-12, Down block 66-84), `src/lib/reason-chips.ts` (the map), `src/lib/activity.ts` (after the `lifecycle.triage` case), `src/lib/activity.test.ts` (append), `src/components/patterns/activity-feed.tsx` (`actionDot`), `src/server/modules/reservations/queries.ts` (lines 1-20: remove the local tabs, re-export), `src/server/modules/inventory/queries.ts` (`stageOf` 49-65, `toRow` param type), `src/server/modules/home/queries.ts` (the repairs query select ~117-125 and the `repairStage`/`downDays` calls ~250-258).
- Create: `prisma/migrations/<timestamp>_repair_end_and_holds/migration.sql`, `src/lib/holds.ts`, `src/lib/holds.test.ts`, `src/components/ui/hold-pill.tsx`.

**Interfaces:**
- Produces: `Asset.repairEndedAt: Date | null` (Prisma); from `@/lib/holds`: `HOLD_DEFAULT_DAYS`, `defaultHoldExpiry(todayISO)`, `minHoldExpiry(todayISO)`, `HoldStatus`, `holdStatus(expiresAt, todayISO)`, `isHoldExpired(expiresAt, todayISO)`, `HOLDS_SWEEP_INTERVAL_MS`, `expireDue(lastAt, now)`, `RESERVATION_TABS`, `ReservationTab`, `parseReservationTab`, `HOLDS_LIST_CONFIG`, `buildHoldWhere(tab, state)`, `buildHoldOrderBy(sort)`; from `@/lib/repairs`: `RepairLike.repairEndedAt`, `downDays(a, now)` closing on `repairEndedAt`; `REASON_CHIPS["hold.place"]`, `REASON_CHIPS["hold.release"]`; `auditSentence` cases; `actionDot` mappings; `HoldPill({ expiresAt, today, withDate })`.

- [ ] **Step 1: Schema + migration**

`prisma/schema.prisma`, directly after `  defectiveSince       DateTime?`:
```prisma
  /// Phase 26: set when the status leaves DEFECTIVE, cleared when it re-enters;
  /// pairs with defectiveSince to close the Down interval. NULL on a closed
  /// repair = ended before this was recorded (the Down column shows "—").
  repairEndedAt        DateTime?
```
Run `npx prisma migrate dev --create-only --name repair_end_and_holds`, then REPLACE the generated `migration.sql` body with:
```sql
ALTER TABLE "Asset" ADD COLUMN "repairEndedAt" TIMESTAMP(3);

-- Backfill (spec §0 decision 3). An asset that is not DEFECTIVE but still carries defectiveSince
-- has a closed repair; its end is the newest audit row that moved status OFF DEFECTIVE. Rows with
-- no such history stay NULL and keep showing "—" in the Down column — never a guess.
UPDATE "Asset" a
   SET "repairEndedAt" = h."endedAt"
  FROM (
    SELECT e."entityId" AS "assetId", max(e."createdAt") AS "endedAt"
      FROM "AuditEntry" e
     WHERE e."entityType" = 'asset'
       AND e."diff"->'status'->>'from' = 'DEFECTIVE'
       AND e."diff"->'status'->>'to' IS DISTINCT FROM 'DEFECTIVE'
     GROUP BY e."entityId"
  ) h
 WHERE h."assetId" = a."id"
   AND a."status" <> 'DEFECTIVE'
   AND a."defectiveSince" IS NOT NULL
   AND h."endedAt" > a."defectiveSince";
```
Then `npx prisma migrate dev --skip-seed` (applies 25 to `inventory_dev`), `npx prisma generate`, `npx prisma migrate status` → 25 found, up to date. Then `npm run db:seed` (nobody else is using the database in Task 1).

- [ ] **Step 2: Failing tests — holds, repairs, activity**

Create `src/lib/holds.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  HOLD_DEFAULT_DAYS, HOLDS_LIST_CONFIG, buildHoldOrderBy, buildHoldWhere, defaultHoldExpiry, expireDue,
  holdStatus, isHoldExpired, minHoldExpiry, parseReservationTab,
} from "./holds";

const today = "2026-09-21";

describe("hold expiry dates", () => {
  it("defaults to seven calendar days from today and floors at today", () => {
    expect(HOLD_DEFAULT_DAYS).toBe(7);
    expect(defaultHoldExpiry(today)).toBe("2026-09-28");
    expect(minHoldExpiry(today)).toBe(today);
  });
  it("is expired only once the day has passed on the Manila calendar", () => {
    expect(isHoldExpired(new Date("2026-09-20T12:00:00Z"), today)).toBe(true);
    expect(isHoldExpired(new Date("2026-09-21T00:00:00Z"), today)).toBe(false);
    expect(isHoldExpired(new Date("2026-09-22T00:00:00Z"), today)).toBe(false);
  });
});

describe("holdStatus — the pill's text and tone", () => {
  it("counts down, then reads today, then counts up as expired", () => {
    expect(holdStatus(new Date("2026-09-24T00:00:00Z"), today)).toMatchObject({ days: 3, text: "expires in 3 d", tone: "neutral", expired: false });
    expect(holdStatus(new Date("2026-09-22T00:00:00Z"), today)).toMatchObject({ days: 1, text: "expires tomorrow", tone: "neutral", expired: false });
    expect(holdStatus(new Date("2026-09-21T00:00:00Z"), today)).toMatchObject({ days: 0, text: "expires today", tone: "accent", expired: false });
    expect(holdStatus(new Date("2026-09-19T00:00:00Z"), today)).toMatchObject({ days: -2, text: "expired 2 d ago", tone: "accent", expired: true });
  });
});

describe("the sweep gate", () => {
  it("is due at start and then hourly", () => {
    const now = new Date("2026-09-21T03:00:00Z");
    expect(expireDue(null, now)).toBe(true);
    expect(expireDue(new Date("2026-09-21T02:30:00Z"), now)).toBe(false);
    expect(expireDue(new Date("2026-09-21T01:59:00Z"), now)).toBe(true);
  });
});

describe("reservation tabs (moved from the server module)", () => {
  it("falls back to ACTIVE for anything unknown", () => {
    expect(parseReservationTab("CLOSED")).toBe("CLOSED");
    expect(parseReservationTab("nope")).toBe("ACTIVE");
    expect(parseReservationTab(null)).toBe("ACTIVE");
  });
});

describe("the /reservations list config", () => {
  const empty = { q: "", page: 1, sort: [], filters: {} };
  it("declares the two facets and four sort keys, expiring-first by default", () => {
    expect(HOLDS_LIST_CONFIG).toEqual({ facets: ["employee", "department"], sortable: ["expiresAt", "createdAt", "employee", "tag"], defaultSort: [{ key: "expiresAt", dir: "asc" }] });
  });
  it("scopes the where to the tab's states and layers search and facets on top", () => {
    expect(buildHoldWhere("CLOSED", empty)).toEqual({ state: { in: ["RELEASED", "EXPIRED"] } });
    const w = buildHoldWhere("ACTIVE", { ...empty, q: "nina", filters: { employee: ["e1"], department: ["d1"] } });
    expect(w.state).toEqual({ in: ["ACTIVE"] });
    expect(w.employeeId).toEqual({ in: ["e1"] });
    expect(w.employee).toEqual({ departmentId: { in: ["d1"] } });
    expect(w.OR).toEqual([
      { asset: { tag: { contains: "nina", mode: "insensitive" } } },
      { asset: { model: { contains: "nina", mode: "insensitive" } } },
      { employee: { name: { contains: "nina", mode: "insensitive" } } },
      { employee: { employeeNo: { contains: "nina", mode: "insensitive" } } },
    ]);
  });
  it("orders by the chosen key with nulls last on expiry and an id tiebreak", () => {
    expect(buildHoldOrderBy([])).toEqual([{ expiresAt: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
    expect(buildHoldOrderBy([{ key: "employee", dir: "desc" }])).toEqual([{ employee: { name: "desc" } }, { id: "asc" }]);
    expect(buildHoldOrderBy([{ key: "tag", dir: "asc" }, { key: "createdAt", dir: "desc" }])).toEqual([{ asset: { tag: "asc" } }, { createdAt: "desc" }, { id: "asc" }]);
  });
});
```

`src/lib/repairs.test.ts`: the `asset()` helper gains `repairEndedAt: null,` (before `...over`); in the Down block, replace the "is null once the item no longer reads DEFECTIVE" test with two tests:
```ts
  it("closes the interval on repairEndedAt once the item no longer reads DEFECTIVE", () => {
    expect(downDays({ status: "SPARE", defectiveSince: new Date("2026-08-01T00:00:00Z"), repairEndedAt: new Date("2026-08-11T00:00:00Z") }, now)).toBe(10);
  });
  it("is null for a closed repair with no recorded end — the clock stopped and we don't know when", () => {
    expect(downDays({ status: "SPARE", defectiveSince: new Date("2026-08-01T00:00:00Z"), repairEndedAt: null }, now)).toBeNull();
  });
  it("ignores a stale end while the item reads DEFECTIVE again", () => {
    expect(downDays({ status: "DEFECTIVE", defectiveSince: new Date("2026-08-15T00:00:00Z"), repairEndedAt: new Date("2026-08-11T00:00:00Z") }, now)).toBe(3);
  });
```
and add `repairEndedAt: null` to the two remaining `downDays({...})` literals in that block.

`src/lib/activity.test.ts`: append to the "Phase 15 direct actions read as sentences" style, a new `it` in the same describe:
```ts
  it("Phase 26 holds read as sentences", () => {
    const base = { actorLabel: "J. Sarmiento", entityLabel: "BR-HS-0502" };
    expect(auditSentence({ ...base, action: "reservation.placed", diff: { hold: { from: null, to: "EMP-0097" }, expiresAt: { from: null, to: "2026-09-28T00:00:00.000Z" } } }))
      .toBe("J. Sarmiento reserved BR-HS-0502 for EMP-0097 until 28 Sept 2026");
    expect(auditSentence({ ...base, action: "reservation.released", diff: { hold: { from: "EMP-0097", to: null } } }))
      .toBe("J. Sarmiento released the hold on BR-HS-0502");
  });
```
and in the `actionDot` describe at the bottom: `expect(actionDot("reservation.placed")).toBe("ACTIVE"); expect(actionDot("reservation.released")).toBe("CANCELLED");`.

- [ ] **Step 3: Run the tests to verify they fail**

`npx vitest run src/lib/holds.test.ts src/lib/repairs.test.ts src/lib/activity.test.ts` → FAIL (module `./holds` missing; `downDays` ignores `repairEndedAt`; sentences fall through to the default).

- [ ] **Step 4: Implement the rules**

Create `src/lib/holds.ts`:
```ts
import type { Prisma } from "@prisma/client";
import { addDays, dayFromISO, isPastDue } from "./deadlines";
import { localDateISO } from "./format";
import { PRUNE_INTERVAL_MS, pruneDue } from "./retention";
import type { ListConfig, ListState, SortKey } from "./url-state";

/** Phase 26 (spec §0 decision 1): a hold lasts seven calendar days unless IT picks another date; today is the floor. */
export const HOLD_DEFAULT_DAYS = 7;
export const defaultHoldExpiry = (todayISO: string) => addDays(todayISO, HOLD_DEFAULT_DAYS);
export const minHoldExpiry = (todayISO: string) => todayISO;

export interface HoldStatus { days: number; text: string; tone: "neutral" | "accent"; expired: boolean }

/** The pill's words — deliberately "expires…", never "due…", so a hold and a deadline never read alike on one screen. */
export function holdStatus(expiresAt: Date, todayISO: string): HoldStatus {
  const days = Math.round((dayFromISO(localDateISO(expiresAt)).getTime() - dayFromISO(todayISO).getTime()) / 86_400_000);
  const text = days < 0 ? `expired ${-days} d ago` : days === 0 ? "expires today" : days === 1 ? "expires tomorrow" : `expires in ${days} d`;
  return { days, text, tone: days <= 0 ? "accent" : "neutral", expired: days < 0 };
}
/** A hold is live through the whole of its last day (Asia/Manila) — the same rule as isPastDue. */
export function isHoldExpired(expiresAt: Date, todayISO: string): boolean { return isPastDue(expiresAt, todayISO); }

/** The worker sweeps hourly, on the same gate retention uses. */
export const HOLDS_SWEEP_INTERVAL_MS = PRUNE_INTERVAL_MS;
export const expireDue = pruneDue;

/**
 * Tabs write `?state=`. EXPIRED (the clock ran out) and RELEASED (a person let
 * it go) share the Closed tab but must stay distinguishable — README 5c.
 * (Moved here from the server module in Phase 26 so it has a unit test.)
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

/** Phase 26 (spec §5.4): search, two facets, four sort keys; expiring first. */
export const HOLDS_LIST_CONFIG: ListConfig = {
  facets: ["employee", "department"],
  sortable: ["expiresAt", "createdAt", "employee", "tag"],
  defaultSort: [{ key: "expiresAt", dir: "asc" }],
};

export function buildHoldWhere(tab: ReservationTab, state: ListState): Prisma.ReservationWhereInput {
  const states = RESERVATION_TABS.find((t) => t.id === tab)!.states;
  const where: Prisma.ReservationWhereInput = { state: { in: [...states] } };
  if (state.q) {
    const q = { contains: state.q, mode: "insensitive" as const };
    where.OR = [
      { asset: { tag: q } }, { asset: { model: q } },
      { employee: { name: q } }, { employee: { employeeNo: q } },
    ];
  }
  if (state.filters.employee?.length) where.employeeId = { in: state.filters.employee };
  if (state.filters.department?.length) where.employee = { departmentId: { in: state.filters.department } };
  return where;
}

export function buildHoldOrderBy(sort: SortKey[]): Prisma.ReservationOrderByWithRelationInput[] {
  const order = sort.length ? sort : HOLDS_LIST_CONFIG.defaultSort;
  return [
    ...order.map(({ key, dir }): Prisma.ReservationOrderByWithRelationInput => {
      if (key === "expiresAt") return { expiresAt: { sort: dir, nulls: "last" } };
      if (key === "employee") return { employee: { name: dir } };
      if (key === "tag") return { asset: { tag: dir } };
      return { createdAt: dir };
    }),
    { id: "asc" },
  ];
}
```
Note: the `state.q`/`state.filters.department` names collide in meaning with Prisma's `state` column — the function above names the Prisma column `state` inside `where` and the `ListState` argument `state`; keep both as written (the test pins the shapes).

`src/lib/repairs.ts`: `RepairLike` gains `repairEndedAt: Date | null;` after `defectiveSince`; replace `downDays`:
```ts
/**
 * Days out of service — the column that changes behaviour. While DEFECTIVE it
 * counts to now; once the item reads anything else it closes on
 * `repairEndedAt` (Phase 26), and is null for a closed repair whose end was
 * never recorded — a number there would be a guess.
 */
export function downDays(
  a: Pick<RepairLike, "status" | "defectiveSince" | "repairEndedAt">,
  now: Date = new Date(),
): number | null {
  if (!a.defectiveSince) return null;
  const end = a.status === "DEFECTIVE" ? now : a.repairEndedAt;
  if (!end) return null;
  return Math.max(0, Math.floor((end.getTime() - a.defectiveSince.getTime()) / 86_400_000));
}
```
Every `repairStageFixture` row's `asset` gains `repairEndedAt: null` (twelve rows; the returned-ok row may carry `new Date("2026-08-11T00:00:00Z")` instead — `repairStage` ignores it either way).

`src/lib/reason-chips.ts`: add to the map `"hold.place": ["New hire setup", "Replacement pending", "Project loan"],` and `"hold.release": ["No longer needed", "Assigned another unit", "Hire cancelled"],`.

`src/lib/activity.ts`: after the `lifecycle.triage` case:
```ts
    // Phase 26 (spec §4.1): holds are placed and released on the asset.
    case "reservation.placed": {
      const until = diff?.expiresAt?.to;
      return `${entry.actorLabel} reserved ${entry.entityLabel} for ${String(diff?.hold?.to ?? "someone")}${typeof until === "string" ? ` until ${fmtDate(new Date(until))}` : ""}`;
    }
    case "reservation.released":
      return `${entry.actorLabel} released the hold on ${entry.entityLabel}`;
```
(`fmtDate` from `./format` — import it if the file does not already.) `activity-feed.tsx` `actionDot`: before the final `return "SPARE"`, add `if (action === "reservation.placed") return "ACTIVE"; if (action === "reservation.released") return "CANCELLED";` (the `CANCELLED` branch already exists for `cancel` — place the two lines directly above `if (action === "cancel") return "CANCELLED";`).

Create `src/components/ui/hold-pill.tsx`:
```tsx
import { Pill } from "@/components/ui/pill";
import { fmtDate } from "@/lib/format";
import { holdStatus } from "@/lib/holds";

/** Phase 26 (spec §5): a live hold's expiry — the DuePill shape, with "expires…" words so it never reads like a deadline. */
export function HoldPill({ expiresAt, today, withDate = false }: { expiresAt: Date; today: string; withDate?: boolean }) {
  const s = holdStatus(expiresAt, today);
  return (
    <span className="inline-flex items-center gap-1.5">
      {withDate && <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(expiresAt)}</span>}
      <Pill tone={s.tone}>{s.text}</Pill>
    </span>
  );
}
```

Consumers of `RepairLike` (P-3): `src/server/modules/reservations/queries.ts` — delete its local `RESERVATION_TABS`/`ReservationTab`/`parseReservationTab` and add `export { RESERVATION_TABS, parseReservationTab, type ReservationTab } from "@/lib/holds";`. `src/server/modules/inventory/queries.ts` — `stageOf`'s parameter type and `toRow`'s parameter type each gain `repairEndedAt: Date | null;`, and `stageOf` passes `repairEndedAt: a.repairEndedAt` into `repairStage(...)`. `src/server/modules/home/queries.ts` — the repairs query's `select` gains `repairEndedAt: true` and both the `repairStage({...})` and `downDays({...})` calls pass `repairEndedAt: a.repairEndedAt`. `src/app/(app)/inventory/[id]/page.tsx` needs no change (`getAsset` returns every scalar; `downDays(asset)` and `stageOf(asset)` type-check once the column exists).

- [ ] **Step 5: Run everything**

`npx vitest run src/lib/holds.test.ts src/lib/repairs.test.ts src/lib/activity.test.ts` → PASS. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (record files/tests; baseline 84 / 1493 + the new cases). `npx prisma migrate status` → 25.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations src/lib/holds.ts src/lib/holds.test.ts src/components/ui/hold-pill.tsx
git commit -m "feat(schema,lib): Phase 26 rules -- Asset.repairEndedAt (migration 25 with an audit-history backfill), downDays closes on it, hold rules (defaults, holdStatus, sweep gate, tabs moved, /reservations list config), hold reason chips, hold audit sentences and dots, HoldPill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- prisma/schema.prisma prisma/migrations src/lib/holds.ts src/lib/holds.test.ts src/lib/repairs.ts src/lib/repairs.test.ts src/lib/reason-chips.ts src/lib/activity.ts src/lib/activity.test.ts src/components/patterns/activity-feed.tsx src/components/ui/hold-pill.tsx src/server/modules/reservations/queries.ts src/server/modules/inventory/queries.ts src/server/modules/home/queries.ts
```

---

### Task 2: Lifecycle stamps, hold actions and queries, the worker sweep

**Files:**
- Modify: `src/server/modules/lifecycle/apply.ts` (`LifecycleAsset` 7-10; the `defectiveSince` block 96-102), `src/server/modules/lifecycle/actions.ts` (`assetSelect` 42-44), `src/server/modules/reservations/queries.ts` (rewrite `listReservations`; add `activeHoldFor`), `src/server/modules/inventory/queries.ts` (`AssetRow.hold` + `toRow`), `src/app/(app)/reservations/page.tsx` (the `listReservations` call only), `src/worker/index.ts`.
- Create: `src/server/modules/reservations/actions.ts`, `src/worker/holds.ts`.

**Interfaces:**
- Consumes (Task 1): `@/lib/holds` (`buildHoldWhere`, `buildHoldOrderBy`, `HOLDS_LIST_CONFIG`, `parseReservationTab`, `minHoldExpiry`, `expireDue`), `dayFromISO`/`localDateISO`, `reasonOptional` (`@/lib/reason`), `openApprovalForAsset` (`@/server/modules/approvals/create`), `isAssignable`, `pagedSnapshot`, `ENTITY_PAGE_SIZE`.
- Produces: `reserveAsset(input): Promise<ActionResult<{ id: string; tag: string }>>`, `releaseHold(input): Promise<ActionResult<{ id: string; tag: string }>>`; `listReservations(tab, state): Promise<{ rows: ReservationRow[]; counts; total; page; pageCount; facets: { employee: FacetOption[]; department: FacetOption[] } }>`; `ReservationRow.expiresAt: Date | null`; `activeHoldFor(assetId): Promise<{ id: string; expiresAt: Date | null; reason: string | null; employee: { id: string; name: string; employeeNo: string } } | null>`; `AssetRow.hold: { id; name; expiresAt: Date | null } | null`; `expireHolds(now): Promise<number>`.

- [ ] **Step 1: Lifecycle stamps**

`apply.ts`: `LifecycleAsset` gains `repairEndedAt: Date | null;`. Replace the `defectiveSince` block with:
```ts
  // Phase 26 (spec §3.4): the repairs view's Down clock starts when a device
  // ENTERS defective and closes when it LEAVES — both stamped here so every
  // path (direct, bulk, triage, worker-executed approvals) records them alike.
  if (change.status === "DEFECTIVE" && asset.status !== "DEFECTIVE") {
    updates.defectiveSince = now;   diff.defectiveSince = { from: asset.defectiveSince, to: now };
    updates.repairEndedAt = null;   diff.repairEndedAt = { from: asset.repairEndedAt, to: null };
  }
  if (change.status !== "DEFECTIVE" && asset.status === "DEFECTIVE") {
    updates.repairEndedAt = now;    diff.repairEndedAt = { from: asset.repairEndedAt, to: now };
  }
```
`actions.ts` `assetSelect` gains `repairEndedAt: true,`. Grep `LifecycleAsset` literals elsewhere (`src/worker/execute-approval.ts` may build one) and add the field where a literal object is constructed.

- [ ] **Step 2: Hold actions**

Create `src/server/modules/reservations/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { openApprovalForAsset } from "@/server/modules/approvals/create";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { isAssignable } from "@/lib/asset-class";
import { dayFromISO } from "@/lib/deadlines";
import { localDateISO } from "@/lib/format";
import { minHoldExpiry } from "@/lib/holds";
import { reasonOptional } from "@/lib/reason";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");

/** Every surface that shows a hold (spec §4.1). */
function revalidateHold(assetId: string, employeeId: string) {
  revalidatePath(`/inventory/${assetId}`);
  revalidatePath(`/inventory/${assetId}/reservations`);
  revalidatePath("/inventory");
  revalidatePath("/reservations");
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/");
}

const reserveSchema = z.object({
  assetId: z.string().min(1), employeeId: z.string().min(1), expiresAt: dateStr, reason: reasonOptional,
});

/** Phase 26 (spec §4.1): promise an IT spare to a person. Direct, audited on the asset, no approval. */
export async function reserveAsset(input: unknown): Promise<ActionResult<{ id: string; tag: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reserveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const today = localDateISO(new Date());
  if (d.expiresAt < minHoldExpiry(today)) return validationError({ expiresAt: "Pick today or later" });

  const now = new Date();
  let out: { id: string; tag: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
    if (!asset) return conflict("That asset no longer exists.");
    if (asset.cls !== "IT") return conflict("Holds are for IT spares.");
    if (!isAssignable(asset)) return conflict(`${asset.tag} is not a spare.`);
    const held = await tx.reservation.findFirst({ where: { assetId: asset.id, state: "ACTIVE" }, include: { employee: { select: { employeeNo: true } } } });
    if (held) return conflict(`${asset.tag} is already held for ${held.employee.employeeNo} — release that hold first.`);
    if (await openApprovalForAsset(tx, asset.id)) return conflict(`${asset.tag} has an open request — decide it first.`);
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment !== "ACTIVE") return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — slots are frozen.`);

    const expiresAt = dayFromISO(d.expiresAt);
    const reason = d.reason?.trim() ? d.reason.trim() : null;
    const created = await tx.reservation.create({
      data: { assetId: asset.id, employeeId: employee.id, state: "ACTIVE", reason, expiresAt },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: asset.id,
      action: "reservation.placed",
      diff: {
        hold: { from: null, to: employee.employeeNo },
        expiresAt: { from: null, to: expiresAt },
        ...(reason ? { reason: { from: null, to: reason } } : {}),
      },
    });
    out = { id: created.id, tag: asset.tag };
    return null;
  });
  if (failure) return failure;
  revalidateHold(d.assetId, d.employeeId);
  return ok(out!);
}

const releaseSchema = z.object({ reservationId: z.string().min(1), reason: reasonOptional });

/** Phase 26 (spec §4.1): let a hold go. `updateMany` on the ACTIVE predicate so a sweep or a fulfilment that won the race is reported, not overwritten. */
export async function releaseHold(input: unknown): Promise<ActionResult<{ id: string; tag: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { id: string; tag: string; assetId: string; employeeId: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const hold = await tx.reservation.findUnique({
      where: { id: d.reservationId },
      include: { asset: { select: { id: true, tag: true } }, employee: { select: { id: true, employeeNo: true } } },
    });
    if (!hold) return conflict("That hold no longer exists.");
    if (hold.state !== "ACTIVE") return conflict("That hold is already closed.");
    const r = await tx.reservation.updateMany({ where: { id: hold.id, state: "ACTIVE" }, data: { state: "RELEASED", resolvedAt: now } });
    if (r.count === 0) return conflict("That hold is already closed.");
    const reason = d.reason?.trim() ? d.reason.trim() : null;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: hold.asset.id,
      action: "reservation.released",
      diff: { hold: { from: hold.employee.employeeNo, to: null }, ...(reason ? { reason: { from: null, to: reason } } : {}) },
    });
    out = { id: hold.id, tag: hold.asset.tag, assetId: hold.asset.id, employeeId: hold.employee.id };
    return null;
  });
  if (failure) return failure;
  revalidateHold(out!.assetId, out!.employeeId);
  return ok({ id: out!.id, tag: out!.tag });
}
```
If `reasonOptional`'s type is not a plain optional string (check `src/lib/reason.ts`), adapt the `.trim()` lines to its shape; the audit diff carries the reason only when given.

- [ ] **Step 3: Queries**

`src/server/modules/reservations/queries.ts` — keep the Task 1 re-export; `ReservationRow` gains `expiresAt: Date | null;`; replace `listReservations`:
```ts
export interface HoldFacets { employee: FacetOption[]; department: FacetOption[] }

export async function listReservations(tab: ReservationTab, state: ListState): Promise<{
  rows: ReservationRow[]; counts: Record<ReservationTab, number>; total: number; page: number; pageCount: number; facets: HoldFacets;
}> {
  const where = buildHoldWhere(tab, state);
  const orderBy = buildHoldOrderBy(state.sort);
  let counts!: Record<ReservationTab, number>;
  const { rows: reservations, total, page, pageCount } = await pagedSnapshot(
    ENTITY_PAGE_SIZE, state.page,
    async (tx) => {
      const grouped = await tx.reservation.groupBy({ by: ["state"], _count: true });
      const countOf = (s: string) => grouped.find((g) => g.state === s)?._count ?? 0;
      counts = { ACTIVE: countOf("ACTIVE"), FULFILLED: countOf("FULFILLED"), CLOSED: countOf("RELEASED") + countOf("EXPIRED") };
      return tx.reservation.count({ where });
    },
    (tx, pg) => tx.reservation.findMany({ where, include: { asset: true, employee: { include: { department: true } } }, orderBy, skip: pg.skip, take: pg.take }),
  );
  const facets = await holdFacets(tab, state);
  return {
    rows: reservations.map((r): ReservationRow => ({
      id: r.id, state: r.state, assetId: r.assetId, tag: r.asset.tag, model: r.asset.model, assetStatus: r.asset.status,
      employeeId: r.employeeId, employeeName: r.employee.name, employeeNo: r.employee.employeeNo, reason: r.reason,
      expiresAt: r.expiresAt, expires: fmtDate(r.expiresAt),
      // Phase 26: the sweep now stamps resolvedAt on expiry; the seeded EXPIRED row predates it and keeps reading expiresAt.
      resolved: fmtDate(r.resolvedAt ?? (r.state === "EXPIRED" ? r.expiresAt : null)),
      closedBy: r.state === "EXPIRED" ? "clock" : r.state === "RELEASED" ? "person" : null,
    })),
    counts, total, page, pageCount, facets,
  };
}

/** Facet counts over the current tab, each narrowed by the OTHER facet and the search (the Phase 25 rule). */
async function holdFacets(tab: ReservationTab, state: ListState): Promise<HoldFacets> {
  const without = (facet: string): ListState => ({ ...state, filters: { ...state.filters, [facet]: [] } });
  const [byEmployee, byDept, employees, departments] = await Promise.all([
    prisma.reservation.groupBy({ by: ["employeeId"], where: buildHoldWhere(tab, without("employee")), _count: true }),
    prisma.reservation.findMany({ where: buildHoldWhere(tab, without("department")), select: { employee: { select: { departmentId: true } } } }),
    prisma.employee.findMany({ where: { reservations: { some: { state: { in: [...RESERVATION_TABS.find((t) => t.id === tab)!.states] } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const deptCount = new Map<string, number>();
  for (const r of byDept) deptCount.set(r.employee.departmentId, (deptCount.get(r.employee.departmentId) ?? 0) + 1);
  return {
    employee: employees.map((e) => ({ value: e.id, label: e.name, count: byEmployee.find((g) => g.employeeId === e.id)?._count ?? 0 })),
    department: departments.map((d) => ({ value: d.id, label: d.name, count: deptCount.get(d.id) ?? 0 })).filter((o) => o.count > 0),
  };
}

/** Phase 26 (spec §4.2): the one live hold on an asset, for the record's banner and the Assign dialog. */
export async function activeHoldFor(assetId: string) {
  return prisma.reservation.findFirst({
    where: { assetId, state: "ACTIVE" },
    select: { id: true, expiresAt: true, reason: true, employee: { select: { id: true, name: true, employeeNo: true } } },
  });
}
```
Imports: `buildHoldWhere, buildHoldOrderBy, RESERVATION_TABS, type ReservationTab` from `@/lib/holds`; `ListState` from `@/lib/url-state`; `FacetOption` from `@/server/modules/inventory/queries`; `prisma` from `@/server/db/client`. `inventory/queries.ts`: `AssetRow.hold` → `{ id: string; name: string; expiresAt: Date | null } | null`; `toRow`'s reservations type `Array<{ expiresAt: Date | null; employee: { id: string; name: string } }>` and `hold: a.reservations[0] ? { id: …, name: …, expiresAt: a.reservations[0].expiresAt } : null`. `reservations/page.tsx` (call-site only, P-4): `const state = parseListState(sp, HOLDS_LIST_CONFIG); const { rows, counts, page, pageCount } = await listReservations(tab, state);` with `parseListState`/`HOLDS_LIST_CONFIG` imported and `parsePage` dropped; `hrefFor` keeps `state=tab` and `page` (Task 4 rewrites the page).

- [ ] **Step 4: Worker sweep**

Create `src/worker/holds.ts`:
```ts
import { prisma } from "../server/db/client";
import { dayFromISO } from "../lib/deadlines";
import { localDateISO } from "../lib/format";

/** Phase 26 (spec §4.3): a hold is live through the whole of its last day (Asia/Manila); anything older flips to EXPIRED. */
export async function expireHolds(now: Date = new Date()): Promise<number> {
  const cutoff = dayFromISO(localDateISO(now));
  const r = await prisma.reservation.updateMany({
    where: { state: "ACTIVE", expiresAt: { lt: cutoff } },
    data: { state: "EXPIRED", resolvedAt: now },
  });
  return r.count;
}
```
`src/worker/index.ts`: import `{ expireHolds } from "./holds"` and `{ expireDue } from "../lib/holds"`; `let lastExpireAt: Date | null = null;`; add
```ts
/** Phase 26 (spec §4.3): holds expire at start and hourly; a failure is logged and never stops job processing. */
async function safeExpire(): Promise<void> {
  try {
    const n = await expireHolds();
    if (n) console.log(`[worker] expired ${n} hold${n === 1 ? "" : "s"}`);
  } catch (err) {
    console.error(`[worker] hold sweep failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    lastExpireAt = new Date();
  }
}
```
and in `main()`: `await safeExpire();` after `await safePrune();`, and `if (expireDue(lastExpireAt, new Date())) await safeExpire();` after the prune gate inside the loop.

- [ ] **Step 5: Verify (no dev server, no Playwright)**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. Proofs with `npx tsx -e` against `inventory_dev`: `activeHoldFor(<BR-MN-0910 id>)` → Nina Robles, expiry +7 d; `listReservations("ACTIVE", parseListState(new URLSearchParams("q=nina"), HOLDS_LIST_CONFIG))` → 1 row, facets employee [Nina Robles: 1]; `listReservations("CLOSED", empty)` → 2 rows, resolved dates present. Worker: insert one ACTIVE reservation with `expiresAt` two days ago (a spare with no hold, e.g. BR-HS-0502 for EMP-0051) via `npx tsx -e`, run `npm run worker:once` → prints `[worker] expired 1 hold`, the row is EXPIRED with `resolvedAt` set; then delete that row by id and confirm the seeded holds are untouched. Actions: call `reserveAsset`/`releaseHold` cannot run outside a request (they need a session) — their proof is Task 5's e2e; type-check only here.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/reservations/actions.ts src/worker/holds.ts
git commit -m "feat(lifecycle,reservations,worker): repair end stamped on leaving DEFECTIVE; reserveAsset and releaseHold (direct, audited); listReservations takes ListState with employee/department facets; activeHoldFor; AssetRow.hold carries expiresAt; hourly expireHolds sweep

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- src/server/modules/lifecycle/apply.ts src/server/modules/lifecycle/actions.ts src/server/modules/reservations/actions.ts src/server/modules/reservations/queries.ts src/server/modules/inventory/queries.ts "src/app/(app)/reservations/page.tsx" src/worker/holds.ts src/worker/index.ts
```
(If Step 1's grep touched `src/worker/execute-approval.ts`, add it to the pathspec.)

---

### Task 3: Asset record — Reserve, held banner, Release; the list's expiry text; the record's closed-repair copy

**Files:**
- Modify: `src/components/inventory/holder-control.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`, `src/app/(app)/inventory/[id]/page.tsx` (the Down row ~112-122), `src/app/(app)/inventory/[id]/reservations/page.tsx`, `src/components/inventory/inventory-table.tsx` (props + HOLD cell), `src/app/(app)/inventory/page.tsx` (`today`).
- Create: `src/components/inventory/release-hold-button.tsx`.

**Interfaces:**
- Consumes: `reserveAsset`, `releaseHold`, `activeHoldFor`, `HoldPill`, `defaultHoldExpiry`/`minHoldExpiry`, `REASON_CHIPS["hold.place"|"hold.release"]`, `localDateISO`.
- Produces: `HolderControl` `mode: "reserve"` and `heldFor?` on `mode: "assign"`; `ReleaseHoldButton({ reservationId, tag, size? })`; `InventoryTable` prop `today: string`.

- [ ] **Step 1: `ReleaseHoldButton`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { releaseHold } from "@/server/modules/reservations/actions";

/** Phase 26 (spec §5): the one Release control, used on the record banner, the record's Reservations tab, the profile's holding area and /reservations. */
export function ReleaseHoldButton({ reservationId, tag, size = "md" }: { reservationId: string; tag: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function close() { setOpen(false); setReason(""); setError(null); setRetryAfter(null); }
  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await releaseHold({ reservationId, reason });
      if (res.ok) { toast(`Hold on ${tag} released`, "settled"); close(); router.refresh(); }
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setError(res.fieldErrors?.reason ?? res.fieldErrors?._form ?? "Check the form");
      else setError(res.message);
    });
  }

  return (
    <>
      <Button size={size} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Release</Button>
      <Dialog open={open} onClose={close} title={`Release the hold on ${tag}?`}
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" loading={pending} onClick={submit}>Release</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">The spare goes back to the pool; the person keeps nothing. Recorded in the audit trail under your name.</p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <ReasonField value={reason} onChange={setReason} chips={REASON_CHIPS["hold.release"]} disabled={pending} />
        </div>
      </Dialog>
    </>
  );
}
```
(`Button`'s `size` accepts `"sm" | "md" | "lg"`; `onClick` receives the mouse event — the `stopPropagation` keeps a clickable row from navigating.)

- [ ] **Step 2: `HolderControl` reserve mode and `heldFor`**

`Props` becomes:
```ts
type Props =
  | { assetId: string; tag: string; mode: "assign"; employees: ComboOption[]; direct: boolean; recentEmployees?: string[]; heldFor?: { id: string; name: string } }
  | { assetId: string; tag: string; mode: "return"; holder: { id: string; name: string }; direct: boolean }
  | { assetId: string; tag: string; mode: "reserve"; employees: ComboOption[]; recentEmployees?: string[]; defaultExpiry: string; minExpiry: string };
```
Changes inside the component:
- `const isReserve = props.mode === "reserve";` and `const isAssign = props.mode === "assign";` (both used below); state `const [expiresAt, setExpiresAt] = useState(props.mode === "reserve" ? props.defaultExpiry : "");` and `useState<string | null>(props.mode === "assign" ? props.heldFor?.id ?? null : null)` for `employeeId` (preselects the holder); `close()` resets `expiresAt` to `props.defaultExpiry` when reserving and `employeeId` to the held id when assigning.
- `submit()`: a third branch first — `if (props.mode === "reserve") { res = await reserveAsset({ assetId: props.assetId, employeeId: employeeId ?? "", expiresAt, reason }); }`; success toast `` `${props.tag} reserved for ${employees.find(o => o.value === employeeId)?.label ?? "them"}` `` — simpler: `res.data` carries `{ id, tag }`, and the label lookup comes from `props.employees` (the `ComboOption.label` is the name).
- Button label: `isReserve ? "Reserve" : isAssign ? (props.direct ? "Assign" : "Assign holder") : "Return"`; dialog title `isReserve ? \`Reserve ${props.tag}\` : …`; primary button `isReserve ? "Reserve" : …`, disabled when `(isAssign || isReserve) && !employeeId`.
- Body: the explanatory line for reserve: "Promises this spare to one person. It still reads SPARE and marked HOLD until it is assigned, released or the hold expires." When `isReserve`: `FormField label="For" required` with the `EntityCombobox` (`autoFocus`, `recent={props.recentEmployees}`, placeholder "Type a name or EMP number…"), then `FormField label="Expires" required error={fieldErrors.expiresAt}` with `<Input type="date" min={props.minExpiry} value={expiresAt} onChange=… />`, then `ReasonField` with `chips={REASON_CHIPS["hold.place"]}`. When `isAssign && props.heldFor`: under the "Assign to" field render `<p className="text-xs text-fg-muted">Held for {props.heldFor.name} — assigning to anyone else is refused until the hold is released.</p>`.
- The validation branch's unclaimed keys: add `fe.expiresAt` handling by leaving it in `fieldErrors` (the field shows it) — keep the existing `fe.assetId ?? fe._form` for the banner.

- [ ] **Step 3: Record layout, tab page, record copy**

`layout.tsx`: import `activeHoldFor` (`@/server/modules/reservations/queries`), `localDateISO`, `HoldPill`, `ReleaseHoldButton`, `defaultHoldExpiry, minHoldExpiry` (`@/lib/holds`). After `const direct = …`: `const hold = await activeHoldFor(asset.id); const today = localDateISO(new Date());`. Predicates after `canTriage`: `const canReserve = direct && !pending && !asset.assignee && isAssignable(asset) && !hold; const canReleaseHold = direct && !!hold;`. Load `employees`/`recentEmployees` when `canAssign || canReserve`. In `actions`: the Assign control passes `heldFor={hold ? { id: hold.employee.id, name: hold.employee.name } : undefined}`; after it, `{canReserve && <HolderControl mode="reserve" assetId={asset.id} tag={asset.tag} employees={employees} recentEmployees={recentEmployees} defaultExpiry={defaultHoldExpiry(today)} minExpiry={minHoldExpiry(today)} />}`; extend the `actions` visibility condition with `|| canReserve`. Between the "Last change" block and the pending banner:
```tsx
      {hold && (
        <div className="pb-3">
          <Banner
            tone="inflight"
            title={<>Held for <Link href={`/employees/${hold.employee.id}`} className="underline hover:text-accent-hover">{hold.employee.name}</Link></>}
            actions={canReleaseHold ? <ReleaseHoldButton reservationId={hold.id} tag={asset.tag} size="sm" /> : undefined}
          >
            <span className="inline-flex flex-wrap items-center gap-2">
              {hold.expiresAt && <HoldPill expiresAt={hold.expiresAt} today={today} withDate />}
              {hold.reason && <span className="text-fg-secondary">{hold.reason}</span>}
              <span className="font-mono text-[10.5px] text-fg-muted">{hold.employee.employeeNo}</span>
            </span>
          </Banner>
        </div>
      )}
```
(`Banner` takes `title?: React.ReactNode` and `actions?`.)

`inventory/[id]/reservations/page.tsx`: import `HoldPill`, `ReleaseHoldButton`, `localDateISO`, `canManageClass, isDirectLifecycle`; compute `const today = localDateISO(new Date()); const canRelease = isDirectLifecycle(user.role, asset.cls);`; add a last `<Th width={96}><span className="sr-only">Actions</span></Th>`; Expires cell: `r.state === "ACTIVE" && r.expiresAt ? <HoldPill expiresAt={r.expiresAt} today={today} withDate /> : fmtDate(r.expiresAt)`; actions cell: `r.state === "ACTIVE" && canRelease ? <ReleaseHoldButton reservationId={r.id} tag={asset.tag} size="sm" /> : null`.

`inventory/[id]/page.tsx` Down row value:
```tsx
                        value:
                          down !== null
                            ? asset.status === "DEFECTIVE"
                              ? `${down} d out of service`
                              : `down ${down} d, back since ${fmtDate(asset.repairEndedAt)}`
                            : asset.status === "DEFECTIVE"
                              ? "start date unknown"
                              : "clock stopped",
```

- [ ] **Step 4: Inventory list**

`inventory-table.tsx`: import `HoldPill`; props gain `today: string;` (`/** Phase 26: the Manila day for the HOLD cell's expiry text. */`); the HOLD cell keeps `Pill HOLD` + "for {link}" exactly and appends, inside the same outer span, `{row.hold.expiresAt && <HoldPill expiresAt={row.hold.expiresAt} today={today} />}`. `inventory/page.tsx`: import `localDateISO`; `const today = localDateISO(new Date());`; pass `today={today}` to `InventoryTable`.

- [ ] **Step 5: Verify with a walk (you are the only walker)**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. `npm run dev -- -p 3100` FOREGROUND as IT: BR-HS-0502's record shows **Reserve** and **Assign**; open Reserve — For combobox focused, Expires = today + 7, chips; Cancel (do NOT submit). BR-MN-0910's record: no Reserve, the "Held for Nina Robles" banner with "expires in 7 d" and **Release**; open Assign — Nina preselected with the held line; Cancel. `/inventory?q=MN-0910`: HOLD · for Nina Robles · "expires in 7 d". BR-MN-0911's record: Repair card reads "clock stopped" (no recorded end). Reservations tab on BR-MN-0910: pill and Release on the ACTIVE row. As viewer: no Reserve/Release. Stop the server; port free.

- [ ] **Step 6: Commit**

```bash
git add src/components/inventory/release-hold-button.tsx
git commit -m "feat(inventory): Reserve from the asset record (HolderControl reserve mode), held banner with Release and a preselected holder in Assign, expiry pill on the record's holds tab and the list's HOLD cell, closed-repair copy on the record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- src/components/inventory/holder-control.tsx src/components/inventory/release-hold-button.tsx "src/app/(app)/inventory/[id]/layout.tsx" "src/app/(app)/inventory/[id]/page.tsx" "src/app/(app)/inventory/[id]/reservations/page.tsx" src/components/inventory/inventory-table.tsx "src/app/(app)/inventory/page.tsx"
```

---

### Task 4: Profile — Reserve a spare… and Release; `/reservations` list parity

**Files:**
- Modify: `src/components/employees/loadout-view.tsx` (imports; `HoldingItem`; `menuItems` ~330-336; the fill-slot picker label ~572-577; the Holding area ~495-514; a new Reserve dialog next to the fill-slot dialog), `src/app/(app)/employees/[id]/page.tsx` (`holding` mapping 117-138), `src/app/(app)/reservations/page.tsx` (rewrite).
- Create: `src/components/reservations/holds-toolbar.tsx`, `src/components/reservations/holds-table.tsx`.

**Interfaces:**
- Consumes: `reserveAsset`, `ReleaseHoldButton`, `HoldPill`, `defaultHoldExpiry`/`minHoldExpiry`, `REASON_CHIPS["hold.place"]`, `listReservations(tab, state)` + `HoldFacets`, `HOLDS_LIST_CONFIG`, `RESERVATION_TABS`, `parseReservationTab`, `parseListState`/`serializeListState`/`withFilter`/`withSearch`/`toggleSort`/`clearFilters`, `EntityCombobox`, `FacetDropdown`, `Th` sort props.
- Produces: `HoldingItem` gains `reservationId: string | null; expiresAt: Date | null;`; `HoldsToolbar({ tab, state, total, facets })`; `HoldsTable({ rows, state, sortHrefs, today, canRelease })`.

- [ ] **Step 1: Profile**

`employees/[id]/page.tsx`: the reserved `holding` entries gain `reservationId: r.id, expiresAt: r.expiresAt,`; the queued entries `reservationId: null, expiresAt: null,`.

`loadout-view.tsx`:
- Imports: `HoldPill` (`@/components/ui/hold-pill`), `ReleaseHoldButton` (`@/components/inventory/release-hold-button`), `EntityCombobox, type ComboOption` (`@/components/patterns/entity-combobox`), `reserveAsset` (`@/server/modules/reservations/actions`), `defaultHoldExpiry, minHoldExpiry` (`@/lib/holds`).
- `HoldingItem` gains `reservationId: string | null; expiresAt: Date | null;`.
- State: `const [reservingSlot, setReservingSlot] = useState<SlotTile | null>(null); const [reserveSpare, setReserveSpare] = useState<string | null>(null); const [reserveExpiry, setReserveExpiry] = useState(defaultHoldExpiry(today)); const [reserveReason, setReserveReason] = useState("");`.
- `menuItems` (P-5): `if (mayAct && direct && !a) menuItems.push({ label: "Reserve a spare…", onSelect: () => { setReservingSlot(tile); setReserveSpare(null); setReserveExpiry(defaultHoldExpiry(today)); setReserveReason(""); setFieldErrors({}); setError(null); } });` — pushed FIRST so it leads the menu on an empty tile.
- Reserve dialog (a sibling of the fill-slot `Dialog`): title `` `Reserve a spare for the ${reservingSlot.name} slot` ``; options `const reserveOptions: ComboOption[] = spares.filter((s) => s.reservedFor === null).sort(sameTypeFirst).map((s) => ({ value: s.id, label: s.tag, sub: s.model, group: s.typeId === reservingSlot.typeId ? "Same type" : "Other spares" }))` (same-type first, then by tag); body: `FormField label="Spare" required` → `EntityCombobox` (`autoFocus`, placeholder "Type a tag…"), `FormField label="Expires" required error={fieldErrors.expiresAt}` → `<Input type="date" min={minHoldExpiry(today)} …/>`, `ReasonField chips={REASON_CHIPS["hold.place"]}`; footer Cancel / primary **Reserve** (disabled without a spare) → `handle(await reserveAsset({ assetId: reserveSpare!, employeeId, expiresAt: reserveExpiry, reason: reserveReason }), ({ tag }) => { toast(\`${tag} reserved\`, "settled"); setReservingSlot(null); router.refresh(); })`.
- The fill-slot picker: each spare radio gets `disabled={s.reservedFor !== null && !s.reservedForThis}` and its label the existing text (already says "reserved for X"). Apply the same `disabled` to the two Replace-picker sites.
- Holding area row for `kind === "reserved"`: replace the `{h.note}` span with `<span className="ml-auto inline-flex items-center gap-2">{h.expiresAt && <HoldPill expiresAt={h.expiresAt} today={today} />}{mayAct && direct && h.reservationId && <ReleaseHoldButton reservationId={h.reservationId} tag={h.tag} size="sm" />}</span>`; queued rows keep `{h.note}`.

- [ ] **Step 2: `/reservations`**

Create `src/components/reservations/holds-toolbar.tsx` (the `EmployeesToolbar` shape minus the two toggles):
```tsx
"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { HOLDS_LIST_CONFIG, type ReservationTab } from "@/lib/holds";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { HoldFacets } from "@/server/modules/reservations/queries";

/** Phase 26 (spec §5.4): search + Employee/Department facets over the current tab. The tab travels as `state=`. */
export function HoldsToolbar({ tab, state, total, facets }: { tab: ReservationTab; state: ListState; total: number; facets: HoldFacets }) {
  const router = useRouter();
  const href = (s: ListState) => {
    const qs = serializeListState(s, HOLDS_LIST_CONFIG);
    return "/reservations" + (qs ? `${qs}&state=${tab}` : `?state=${tab}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint"><Icon name="search" size={14} /></span>
        <Input type="search" aria-label="Search holds" placeholder="Tag, model or person" defaultValue={state.q} className="pl-8"
          onKeyDown={(e) => { if (e.key === "Enter") router.push(href(withSearch(state, e.currentTarget.value))); }} />
      </div>
      <FacetDropdown label="Employee" options={facets.employee} selected={state.filters.employee ?? []}
        onApply={(values) => router.push(href(withFilter(state, "employee", values)))} />
      <FacetDropdown label="Department" options={facets.department} selected={state.filters.department ?? []}
        onApply={(values) => router.push(href(withFilter(state, "department", values)))} />
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">{total} {total === 1 ? "hold" : "holds"}</span>
    </div>
  );
}
```
Create `src/components/reservations/holds-table.tsx` (client; the `EmployeesTable` pattern): props `{ rows: ReservationRow[]; state: ListState; sortHrefs: Record<string, string>; today: string; canRelease: boolean }`; `sortProps(key)` as in `employees-table.tsx`; columns: state dot (sr-only header) · State · **Asset** (`sortProps("tag")`, tag link, `stopPropagation`) · Model · Reads (asset status) · **For** (`sortProps("employee")`, person link + number, `stopPropagation`) · Reason · **Expires** (`sortProps("expiresAt")`: `r.state === "ACTIVE" && r.expiresAt ? <HoldPill expiresAt={r.expiresAt} today={today} withDate /> : r.expires`) · **Created** (`sortProps("createdAt")`, — needs `createdAt` on the row: add `created: string` to `ReservationRow` in this task, `fmtDate(r.createdAt)`) · Closed (the existing `closedBy` glyph + `resolved`) · actions (`r.state === "ACTIVE" && canRelease ? <ReleaseHoldButton reservationId={r.id} tag={r.tag} size="sm" /> : null`). Rows: `tabIndex={0}`, `className="cursor-pointer"`, `onClick` → `/inventory/${r.assetId}` with the text-selection guard, Enter on the row itself opens it. Keep `role="table"`/`role="row"` semantics (the `Table`/`Tr` primitives) and the visible words "expired" / "released" in the Closed cell — an existing e2e asserts them.

Rewrite `src/app/(app)/reservations/page.tsx`: parse `tab` and `state = parseListState(sp, HOLDS_LIST_CONFIG)`; `const { rows, counts, total, page, pageCount, facets } = await listReservations(tab, state)`; `const today = localDateISO(new Date()); const canRelease = user.role === "admin" || user.role === "it_staff";`; `href(s)` as in the toolbar; `sortHrefs` from `HOLDS_LIST_CONFIG.sortable` with `toggleSort`; `hasFilters = state.q !== "" || Object.keys(state.filters).length > 0`. Render: `PageHeader`; the banner with its last sentence replaced by "Holds are placed from the asset record or the person's profile and released there or here."; `Tabs` whose hrefs keep search/facets (`href({ ...state, page: 1 })` with the tab swapped — build with the same helper taking a tab argument); `HoldsToolbar`; then `HoldsTable` or the empty states: ACTIVE and no filters → "No active holds" / "Reserve a spare from its record or from a person's profile."; other tabs → "Nothing in this tab" / "Holds land here once they are fulfilled, released or expired."; filters active → "Your filters matched nothing" with a Clear filters `ButtonLink` to `href(clearFilters(state))`; `Pagination` with `hrefFor={(p) => href({ ...state, page: p })}`.

- [ ] **Step 3: Verify with a walk (you are the only walker)**

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. `npm run dev -- -p 3100` FOREGROUND as IT: Nina Robles' profile — the empty **phone** slot's ⋯ menu offers "Reserve a spare…"; the dialog lists BR-PH-0301 under "Other spares"/"Same type" as appropriate with Expires = today + 7; Cancel (do NOT submit). The holding area shows BR-MN-0910 with "expires in 7 d" and **Release**. `/reservations`: search "Nina" → 1 row; Employee facet shows her; click Expires header twice (URL `sort=-expiresAt`); Closed tab shows "expired …" and "released …"; a row click opens the asset; Release on the ACTIVE row (do NOT confirm). As viewer: no Release, no menu item. Stop the server; port free.

- [ ] **Step 4: Commit**

```bash
git add src/components/reservations/holds-toolbar.tsx src/components/reservations/holds-table.tsx
git commit -m "feat(employees,reservations): Reserve a spare from an empty profile slot, expiry pill and Release in the holding area, held spares disabled in the pickers; /reservations gains search, Employee and Department facets, sortable headers, row click, Release and the expiry pill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- src/components/employees/loadout-view.tsx "src/app/(app)/employees/[id]/page.tsx" "src/app/(app)/reservations/page.tsx" src/components/reservations/holds-toolbar.tsx src/components/reservations/holds-table.tsx src/server/modules/reservations/queries.ts
```
(`reservations/queries.ts` is in the pathspec for the `created` column.)

---

### Task 5: End-to-end coverage — `e2e/holds.spec.ts`

**Files:**
- Create: `e2e/holds.spec.ts`.

**Interfaces:**
- Consumes everything Tasks 1–4 shipped. Fixtures: IT `it@thebackroomop.com`, admin `admin@thebackroomop.com`, viewer `viewer@thebackroomop.com`, `SEED_PASSWORD` from `../prisma/fixtures`; spares with no ACTIVE hold and no open request: `BR-HS-0502` (headset; its reservation history row is RELEASED), `BR-PH-0301` (phone; history EXPIRED), `BR-MN-0911` (monitor; history FULFILLED; the RETURNED OK fixture with `defectiveSince` −70 d); `BR-MN-0910` held ACTIVE for Nina Robles (EMP-0097), `expiresAt` +7 d; `BR-LT-0181` has open `APR-2041` (reserve → "has an open request"); Nina Robles = Finance standard policy, empty phone/dock/headset slots; Paolo Santos EMP-0071 (ACTIVE); the Replace dialog on BR-LT-0201 lists spares (`waitForHydration`, combobox "Replacement").

- [ ] **Step 1: Write the spec file** (helpers copied locally from `e2e/it-gaps.spec.ts:34-58`; `beforeAll` reseeds; every case restores in `finally`; never delete audit rows)

Cases, each with its fixture, assertions and restore:
1. **Reserve from the record** (IT, BR-HS-0502): Reserve → dialog "Reserve BR-HS-0502"; `getByLabel("Expires")` value = `defaultHoldExpiry(today)`; For: fill "EMP-0097", pick the option; chip "New hire setup"; **Reserve** → toast contains "reserved"; banner "Held for Nina Robles" + text "expires in 7 d"; `db.reservation.findFirst({ where: { assetId, state: "ACTIVE" } })` exists with `expiresAt` = that day; `/inventory/${id}/timeline` shows "reserved BR-HS-0502 for EMP-0097 until"; `/inventory?q=HS-0502` row contains "HOLD", link "Nina Robles", text "expires in 7 d"; BR-LT-0201's Replace combobox has no option matching BR-HS-0502. `finally`: `db.reservation.deleteMany({ where: { assetId, state: "ACTIVE" } })`.
2. **Reserve from the profile** (IT, Nina Robles): the phone slot tile's ⋯ menu (`getByRole("button", { name: "Actions for the phone slot" })`) → "Reserve a spare…" → dialog; Spare: pick BR-PH-0301; **Reserve** → the holding area lists BR-PH-0301 with "expires in 7 d" and a Release button; row exists in db. `finally`: delete that reservation.
3. **Held record** (IT, BR-MN-0910): no Reserve button; banner "Held for Nina Robles"; Assign dialog: "Assign to" shows Nina preselected (input value contains "Nina"), the held line is visible; pick Paolo Santos (fill "EMP-0071", option) and Confirm → the error contains "EMP-0097"; asset still SPARE, hold still ACTIVE.
4. **Floor** (IT, BR-HS-0502): open Reserve, strip `min` on Expires via `evaluate`, set yesterday, pick Nina, Reserve → "Pick today or later" visible; no ACTIVE reservation written.
5. **Release from the record** (IT): create a hold on BR-HS-0502 via the UI (or `db.reservation.create` for speed with a +7 d expiry), then the banner's **Release** → dialog "Release the hold on BR-HS-0502?" → Release → toast; row RELEASED with `resolvedAt`; timeline shows "released the hold on BR-HS-0502". `finally`: delete the row.
6. **Release from the profile and from /reservations**: two `db`-created holds (BR-PH-0301 for Nina; BR-MN-0911 for Paolo) → Release in Nina's holding area; Release on the `/reservations` ACTIVE row for BR-MN-0911 (scope `getByRole("row", { name: /BR-MN-0911/ })`); both RELEASED. `finally`: delete both.
7. **Fulfilment stays**: assign BR-MN-0910 to Nina from the record (Assign → Confirm with the preselected holder) → the seeded hold is FULFILLED. `finally`: restore the asset (`assigneeId: null, status: "SPARE", loanDueAt: null`) and the reservation (`state: "ACTIVE", resolvedAt: null`).
8. **Expiry sweep**: `db.reservation.create` on BR-HS-0502 for Paolo with `expiresAt` two days ago → `execSync("npm run worker:once", { timeout: 120_000, encoding: "utf8" })` → stdout matches `/\[worker\] expired 1 hold/`; row EXPIRED with `resolvedAt`; `/reservations?state=CLOSED` row shows "expired"; BR-HS-0502 is back in BR-LT-0201's Replace picker. `finally`: delete the row.
9. **/reservations parity** (IT): `/reservations?q=nina` shows one row (BR-MN-0910); the Employee facet button opens and lists "Nina Robles"; `?sort=-expiresAt` vs default flips order once a second hold exists (create one for Paolo on BR-PH-0301 with +3 d, then assert the first row); clicking the BR-MN-0910 row (its Model cell) lands on the asset record; as viewer no Release button. `finally`: delete the extra hold.
10. **Backfill honesty** (runs before 11): BR-MN-0911's record Repair card reads "clock stopped" and `?stage=returned-ok` shows "—" in Down for it; `db.asset` `repairEndedAt` is null.
11. **Repair end** (IT, BR-MN-0911): read `status, defectiveSince, repairEndedAt, returnedAt`; Status control → DEFECTIVE (reason chip) → record reads "0 d out of service", db `repairEndedAt` null and `defectiveSince` today; Status → SPARE → db `repairEndedAt` set today, record reads "down 0 d, back since", `/inventory?stage=returned-ok` shows "0 d" for it; Status → DEFECTIVE again → `repairEndedAt` null. `finally`: restore the four fields read.
Every case ends with `expectNoSeriousAxe(page)` on its last page.

- [ ] **Step 2: Run**

`npm run db:seed` first. `E2E_PORT=3100 npx playwright test e2e/holds.spec.ts --workers=1 --global-timeout=540000` FOREGROUND, twice → both `11 passed`. Then the touched neighbours once: `E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/paging.spec.ts e2e/custody.spec.ts e2e/it-nav.spec.ts --workers=1 --global-timeout=540000` → green. `npx eslint e2e/holds.spec.ts`, `npx tsc --noEmit`, `npx playwright test --list` → `Total: 364 tests in 35 files` (report actual). Port free before/after; `npm run db:seed` last.

- [ ] **Step 3: Commit**

```bash
git add e2e/holds.spec.ts
git commit -m "test(e2e): holds -- reserve from the record and a profile slot, held record and refused reassignment, expiry floor, release from record/profile/list, fulfilment, worker expiry sweep, /reservations parity, backfill honesty and repair end stamps (11 cases; --list 364 / 35)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- e2e/holds.spec.ts
```

---

### Task 6: Battery on the final tree and the docs addendum

- [ ] **Step 1: Pre-checks** — `git status --short` empty; `npx tsc --noEmit`; `npx eslint .`; `npx vitest run`; `npx prisma migrate status` (25 found, up to date); `npx playwright test --list`.
- [ ] **Step 2: The seven chunks** FOREGROUND, one at a time, port free before each and after the last, `N passed (M.Mm)` recorded (the controller's `task-6-anchors.md` carries the commands; `e2e/holds.spec.ts` joins chunk F). A failing chunk: re-run once; if it reproduces, STOP and report. `npm run db:seed` after the last chunk.
- [ ] **Step 3: Docs** (CRLF preserved; one commit): HANDOVER line 3 parenthetical (Phase 26 CODE-COMPLETE, UNMERGED/UNPUSHED, **migration 25 pending on staging** — "the next staging redeploy applies migration 25 (additive; its backfill only fills rows with a matching audit transition)"), a new **(s)** block after (r), §0 item 9 with `holds.spec.ts` in F, §8 closures ("read-only by design" reservations line; the RETURNED OK dash line; the `/reservations` "no pagination, sortable headers or facets" line); PICKUP rows (Branch, Database → **25 migrations**, Battery, Last two phases 26/25, §4 item 1, §5 closures); HANDOVER-PENDING §6 (the two items → "Shipped in Phase 26"); this plan's D-block; the spec's Status line and *Amended (D-n)* notes (at least P-5 and P-6). Commit `docs(handover,pickup,pending,plan,spec): Phase 26 code-complete -- battery N e2e / M files, K unit, 25 migrations; (s) block; D-1..D-N`.

---

## Self-review

**Spec coverage.** §3.1 → Task 1 (schema, migration, backfill); §3.2 → Task 1 (`holds.ts`); §3.3 → Task 1 (`downDays`, consumers); §3.4 → Task 2 (preparer); §4.1 → Task 2 (actions, sentences in Task 1); §4.2 → Task 2 (queries) + Task 4 (`created`); §4.3 → Task 2 (worker); §5.1 → Task 3; §5.2 → Task 4 (with P-5's menu-item correction); §5.3 → Task 3; §5.4 → Task 4; §6 edge cases → the action copy (Task 2) and e2e cases 3, 4, 6, 8, 10 (Task 5); §7 unit → Task 1, e2e → Task 5 (P-6's Nina correction), walk → Tasks 3 and 4; §8 file list matches the table above plus `holds-table.tsx`'s `created` column; §9 constraints are the Global Constraints.

**Placeholder scan.** Task 3's `HolderControl` edits are described against the quoted component (facts §1) with every new label, state and branch named; Task 4's dialog and table columns are enumerated; e2e cases name fixtures, selectors and restores. Task 6's counts are measured at close by design.

**Type consistency.** `holdStatus`/`HoldPill` (Task 1) used by Tasks 3 and 4; `activeHoldFor`'s select shape (Task 2) matches the banner (Task 3); `HoldingItem.reservationId/expiresAt` (Task 4) match the page mapping; `listReservations` return (Task 2) plus `created` (Task 4) match `HoldsTable`; `ReleaseHoldButton` props are identical at all four call sites; `AssetRow.hold.expiresAt` (Task 2) matches the HOLD cell (Task 3); `RepairLike.repairEndedAt` (Task 1) matches `stageOf`/`toRow`/Home/record.

## Amendments made during execution

- *(Task 6 replaces this bullet with the D-block from the SDD ledger.)*
