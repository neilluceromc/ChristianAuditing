# Inventory v2 — Phase 6: Finance + Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** The role-aware Home dashboards and the Finance workspace — IT Home built around **"Your shift"** (5 rows ordered by what breaks first, no KPI tile row), Purchasing Home leading with a to-do list and spend, Finance Home leading with **money and age**, Viewer Home the same minus every mutating affordance — with **every section degrading independently**, a Focus-mode cookie, plus `/finance/assets` (the `1f` table with value columns) and `/finance/activity`.

**Architecture:** Each Home section is loaded through `safeSection(label, run)`, which turns a thrown query into a typed `{ok:false}` instead of a blank page; `SectionCard` renders either the section or the designed FAILED state with a "Retry this section" button. Ranking, bucketing and coverage arithmetic are pure TDD'd functions in `src/lib/home.ts`; the query module composes them. Home is a **composition phase** — it reuses `ActivityFeed`, `StatusDot`/`StatusPill`, `slaLabel`, `dwellLine` and the six-family status map rather than inventing primitives.

**Tech Stack:** Existing Phase 1–5 conventions (`ActionResult`, `actionRole`, `checkRate`, `writeAudit`, cookie-driven SSR preferences, url-state) · Prisma 6 · Vitest · Playwright + axe.

**Conventions for every task:** branch `phase-6-finance-home` (Task 1 creates it); `npx tsc --noEmit && npm run lint` before each commit; NEVER `npm run build` while a dev server runs; **no schema changes** — `UserPreference` (per-user JSON, already used for column prefs) carries the shift dismissals, and every other field Home needs already exists. DB via `docker compose up -d db`, seed via `npm run db:seed`. Subagents don't start dev servers — the controller owns the preview.

**Seed facts this phase leans on** (`prisma/seed.ts`): approvals **APR-2040** PENDING URGENT **past SLA** (the `SLA` shift row) and **APR-2025** `EXECUTION_FAILED` (the `EXEC` row) · **APR-2039** CLAIMED by `admin@` (the "Claimed by you" fixture when signed in as admin) · employees **Nina Robles EMP-0097** joined 10 days ago and **Karen Uy EMP-0088** 20 days ago, both Finance-department → the `Finance standard` policy's 6 slots, both holding nothing (the `HIRE` rows) · **Dennis Ong EMP-0090** is `OFFBOARDING` (the `LEAVE` row) · **BR-LT-0027** is `MISSING` (the `DATA` row) · 22 assets across all 8 statuses with `cost` and `warrantyUntil` set (Fleet, Age, Warranty runway, `/finance/assets`) · 5 purchase requests, **PR-0195 IT_REVIEWED ₱45,000** and **PR-0198 SUBMITTED ₱92,000** (Finance Home's "waiting" money).

**Entry criteria this plan implements (HANDOVER §6):** #1 `safeSection` + `SectionCard` built in Task 2, **before** any section that uses them (Tasks 6–8) · #2 IT Home has no KPI row; Your shift, Claimed-by-you above the pool, Fleet, Age, Warranty runway, Jump-to (Tasks 3, 6) · #3 the three other role variants (Task 7) · #4 Focus mode is the `br.focus` cookie (Task 5) · #5 the Phase-2 placeholder `/` is replaced wholesale, keeping only the nav-derived quick links (Task 6) · #6 `/finance/assets` + `/finance/activity` (Tasks 8, 9) · #7 money converted to `number`/string in the query layer (Tasks 3, 4, 8) · #8 reuse over rebuild — every task names what it reuses.

---

## Recorded scope decisions

1. **Degradation is loader-level, not an error boundary.** `safeSection(label, run)` try/catches the query and returns `{ok:true,data} | {ok:false,label,message}`; `SectionCard` renders the FAILED card from that. Rationale: it is deterministic, unit-testable, and matches the actual requirement ("if one query fails the rest of the page still renders"). A React error boundary would also catch render-time bugs, but it cannot be tested without a browser and it turns a typo into the same UI as a database outage. Sections are additionally wrapped in `<Suspense>` so a slow section streams in rather than holding the page.
2. **"Retry this section" refreshes the route.** With RSC there is no per-section refetch; the button calls `router.refresh()`, which re-runs every section's loader. The label stays honest because the *effect* the user wants — this section tries again — is exactly what happens. The button is a small client island.
3. **"Cleared items leave for the rest of the day"** (README) is implemented with a `UserPreference` row keyed `home:dismissed`, value `{date: "YYYY-MM-DD", keys: string[]}`. A date change empties it, so the promise is "for the rest of the day", not forever. No schema change — `UserPreference` already stores per-user JSON.
4. **Shift-row identity is a stable synthetic key**, `"<kind>:<entityId>"` (e.g. `SLA:<approvalId>`), so dismissal survives re-ordering and never collides across kinds.
5. **"What breaks first" ordering** is `KIND_RANK` (SLA → EXEC → LEAVE → HIRE → DATA) then, within a kind, descending `severity` (days overdue, days since failure, days since the leaver started offboarding, days a hire has gone without kit). Not recency — that is the whole point of the design note.
6. **The Fleet coverage line** ("spare pool covers 4 of the 5 slots the incoming hires need") counts, per asset **type**: required policy slots unfilled for ACTIVE employees who joined in the last 30 days, against `SPARE` assets of that type that are not under an ACTIVE reservation. Greedy, one spare per slot.
7. **No invented depreciation.** `/finance/assets` shows acquisition cost, purchase date, age and warranty, with a total — a book-value column would require a depreciation policy nobody has stated. Recorded as deferred, not omitted by accident.
8. **`/finance/assets` means capitalized assets: `cost` is not null.** Status is shown, not filtered — finance cares that a ₱55,000 laptop is `DEFECTIVE`. `?status=` narrows it, reusing `ASSET_STATUSES`.
9. **`/finance/activity` is the one CROSS-DOMAIN scoped feed**, so it is also the one that renders `ActivityFeed`'s domain pill: purchase-request entries **plus** asset entries whose diff touched `cost`. If the Prisma JSON-path filter doesn't hold up against the real database, fall back to purchase-request-only and record it — do not silently ship a feed that claims to show money changes it can't see.
10. **Viewer Home shows the same sections minus Your-shift** (it is an action queue) **and minus every action link**; the Fleet/Age/Warranty read-outs stay, because looking is what the role is for.
11. **Home queries are capped and indexed-friendly** — Your shift takes at most 5 rows after ordering, Warranty runway 8, Claimed-by-you 5. Home must not become the slowest page in the app.

---

## File structure created/modified in this phase

```
src/lib/
  home.ts (+ .test.ts)              (create — ShiftKind/KIND_RANK/shiftOrder, ageBucket/AGE_BUCKETS,
                                     coverageLine, warrantyDaysLeft, dismissal helpers; pure, TDD)
  section.ts (+ .test.ts)           (create — SectionResult + safeSection; pure-ish, TDD)
src/server/modules/home/
  queries.ts                        (create — yourShift, claimedByYou, fleet, ageHistogram,
                                     warrantyRunway, purchasingHome, financeHome)
  actions.ts                        (create — dismissShiftRow)
src/components/home/
  section-card.tsx                  (create — server: renders section or the FAILED state)
  retry-section.tsx                 (create — client: "Retry this section" → router.refresh())
  focus-toggle.tsx                  (create — client: writes br.focus, then refreshes)
  your-shift.tsx                    (create — server list + per-row dismiss island)
  dismiss-button.tsx                (create — client: clears a row for the rest of the day)
  fleet-bar.tsx                     (create — server: 8-status stacked bar + legend + coverage line)
  age-histogram.tsx                 (create — server: 5 buckets, only 4y+ changes colour)
  warranty-runway.tsx               (create — server: next 90 days)
  jump-to.tsx                       (create — server: nav-derived quick links, kept from Phase 2)
src/app/(app)/page.tsx              (replace — role-aware composition, Focus mode)
src/app/(app)/finance/assets/page.tsx    (create)
src/app/(app)/finance/activity/page.tsx  (create)
src/server/modules/finance/queries.ts    (create — financeAssets + the activity where-builder)
e2e/home-finance.spec.ts            (create)
```

`safeSection` is the ONLY way a Home section loads data. `src/lib/home.ts` holds every arithmetic decision; the query module does I/O and calls into it.

---

### Task 1: Branch + the Home arithmetic (TDD)

**Files:**
- Create: `src/lib/home.ts`, `src/lib/home.test.ts`

- [x] **Step 1: Create the branch**

```bash
git checkout -b phase-6-finance-home
```

- [x] **Step 2: Write the failing tests** (`src/lib/home.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  AGE_BUCKETS, KIND_RANK, activeDismissals, ageBucket, coverageLine, shiftOrder,
  warrantyDaysLeft, withDismissal, type ShiftRow,
} from "./home";

const NOW = new Date("2026-08-17T09:00:00+08:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const row = (over: Partial<ShiftRow>): ShiftRow => ({
  key: "SLA:a1", kind: "SLA", title: "APR-2040", meta: "1 d overdue",
  href: "/approvals/a1", action: "Open", severity: 1, ...over,
});

describe("shiftOrder — what breaks first, not what happened last", () => {
  it("ranks the kinds SLA → EXEC → LEAVE → HIRE → DATA", () => {
    expect(KIND_RANK.SLA).toBeLessThan(KIND_RANK.EXEC);
    expect(KIND_RANK.EXEC).toBeLessThan(KIND_RANK.LEAVE);
    expect(KIND_RANK.LEAVE).toBeLessThan(KIND_RANK.HIRE);
    expect(KIND_RANK.HIRE).toBeLessThan(KIND_RANK.DATA);
  });

  it("puts an overdue approval above a data finding regardless of age", () => {
    const ordered = shiftOrder([
      row({ key: "DATA:x", kind: "DATA", severity: 99 }),
      row({ key: "SLA:y", kind: "SLA", severity: 1 }),
    ]);
    expect(ordered.map((r) => r.key)).toEqual(["SLA:y", "DATA:x"]);
  });

  it("within a kind, the worse one goes first", () => {
    const ordered = shiftOrder([
      row({ key: "SLA:mild", severity: 1 }),
      row({ key: "SLA:bad", severity: 12 }),
    ]);
    expect(ordered.map((r) => r.key)).toEqual(["SLA:bad", "SLA:mild"]);
  });

  it("is stable for equal rank and severity, and never mutates its input", () => {
    const input = [row({ key: "DATA:a", kind: "DATA", severity: 0 }), row({ key: "DATA:b", kind: "DATA", severity: 0 })];
    const snapshot = input.map((r) => r.key);
    expect(shiftOrder(input).map((r) => r.key)).toEqual(["DATA:a", "DATA:b"]);
    expect(input.map((r) => r.key)).toEqual(snapshot);
  });

  it("drops dismissed rows before taking the top 5", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ key: `DATA:${i}`, kind: "DATA", severity: i }));
    const kept = shiftOrder(rows, new Set(["DATA:7", "DATA:6"])).map((r) => r.key);
    expect(kept).not.toContain("DATA:7");
    expect(kept).toHaveLength(5);
    expect(kept[0]).toBe("DATA:5"); // 7 and 6 dismissed, 5 is now the worst
  });
});

describe("ageBucket", () => {
  it("names the five buckets in order", () => {
    expect(AGE_BUCKETS).toEqual(["<1y", "1–2y", "2–3y", "3–4y", "4y+"]);
  });
  it("buckets by completed years since purchase", () => {
    expect(ageBucket(daysAgo(30), NOW)).toBe("<1y");
    expect(ageBucket(daysAgo(400), NOW)).toBe("1–2y");
    expect(ageBucket(daysAgo(800), NOW)).toBe("2–3y");
    expect(ageBucket(daysAgo(1200), NOW)).toBe("3–4y");
    expect(ageBucket(daysAgo(2000), NOW)).toBe("4y+");
  });
  it("treats an unknown purchase date as unbucketable rather than new", () => {
    expect(ageBucket(null, NOW)).toBeNull();
  });
  it("puts the exact boundary in the older bucket", () => {
    expect(ageBucket(daysAgo(365), NOW)).toBe("1–2y");
  });
});

describe("coverageLine — the line that matters under the Fleet bar", () => {
  it("counts spares against the slots incoming hires actually need", () => {
    const line = coverageLine({ laptop: 2, monitor: 1 }, { laptop: 2, monitor: 2, dock: 1 });
    expect(line.needed).toBe(5);
    expect(line.covered).toBe(3); // 2 laptops + 1 monitor; the 2nd monitor and the dock are uncovered
    expect(line.text).toBe("spare pool covers 3 of the 5 slots the incoming hires need");
  });
  it("never counts more spares than slots needed", () => {
    expect(coverageLine({ laptop: 9 }, { laptop: 2 }).covered).toBe(2);
  });
  it("says so plainly when nothing is needed", () => {
    expect(coverageLine({ laptop: 3 }, {}).text).toBe("no incoming hires need equipment right now");
  });
  it("singularises one slot", () => {
    expect(coverageLine({}, { laptop: 1 }).text).toBe("spare pool covers 0 of the 1 slot the incoming hires need");
  });
});

describe("warrantyDaysLeft", () => {
  it("counts forward, and negative once expired", () => {
    expect(warrantyDaysLeft(daysAhead(30), NOW)).toBe(30);
    expect(warrantyDaysLeft(daysAgo(5), NOW)).toBe(-5);
  });
});

describe("dismissals — cleared items leave for the rest of the day", () => {
  it("reads an empty set from nothing", () => {
    expect(activeDismissals(null, "2026-08-17").size).toBe(0);
    expect(activeDismissals({ nonsense: true }, "2026-08-17").size).toBe(0);
  });
  it("keeps today's keys", () => {
    const set = activeDismissals({ date: "2026-08-17", keys: ["SLA:a", "DATA:b"] }, "2026-08-17");
    expect([...set].sort()).toEqual(["DATA:b", "SLA:a"]);
  });
  it("forgets yesterday's — the promise was for the day, not forever", () => {
    expect(activeDismissals({ date: "2026-08-16", keys: ["SLA:a"] }, "2026-08-17").size).toBe(0);
  });
  it("appends without duplicating, and resets on a new day", () => {
    expect(withDismissal({ date: "2026-08-17", keys: ["SLA:a"] }, "2026-08-17", "DATA:b"))
      .toEqual({ date: "2026-08-17", keys: ["SLA:a", "DATA:b"] });
    expect(withDismissal({ date: "2026-08-17", keys: ["SLA:a"] }, "2026-08-17", "SLA:a"))
      .toEqual({ date: "2026-08-17", keys: ["SLA:a"] });
    expect(withDismissal({ date: "2026-08-16", keys: ["SLA:a"] }, "2026-08-17", "DATA:b"))
      .toEqual({ date: "2026-08-17", keys: ["DATA:b"] });
  });
});
```

- [x] **Step 3: Run to verify failure**

Run: `npm run test -- src/lib/home.test.ts` — Expected: FAIL (module missing).

- [x] **Step 4: Implement `src/lib/home.ts`**

```ts
/**
 * Home's arithmetic, kept pure so the dashboard's judgement calls are testable:
 * what breaks first, how old the fleet is, whether the spare pool covers the
 * people starting next week, and what "cleared for the rest of the day" means.
 */
export type ShiftKind = "SLA" | "EXEC" | "HIRE" | "LEAVE" | "DATA";

export interface ShiftRow {
  /** stable identity for dismissal: "<kind>:<entityId>" */
  key: string;
  kind: ShiftKind;
  title: string;
  /** the mono metadata line */
  meta: string;
  href: string;
  /** the one action that clears it */
  action: string;
  /** higher = worse, compared only within a kind (days overdue, days stuck, …) */
  severity: number;
}

/**
 * README: the rows are ordered by *what breaks first*, not recency. A breached
 * SLA outranks a failed execution outranks a leaver mid-offboarding outranks a
 * hire without kit outranks a data finding.
 */
export const KIND_RANK: Record<ShiftKind, number> = {
  SLA: 0, EXEC: 1, LEAVE: 2, HIRE: 3, DATA: 4,
};

export const SHIFT_LIMIT = 5;

export function shiftOrder(rows: ShiftRow[], dismissed: Set<string> = new Set()): ShiftRow[] {
  return [...rows]
    .filter((r) => !dismissed.has(r.key))
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.severity - a.severity)
    .slice(0, SHIFT_LIMIT);
}

export const AGE_BUCKETS = ["<1y", "1–2y", "2–3y", "3–4y", "4y+"] as const;

export type AgeBucket = (typeof AGE_BUCKETS)[number];

const YEAR_MS = 365 * 86_400_000;

/** null = no purchase date recorded; an unknown age must not read as "new". */
export function ageBucket(purchasedAt: Date | null | undefined, now: Date = new Date()): AgeBucket | null {
  if (!purchasedAt) return null;
  const years = Math.floor((now.getTime() - purchasedAt.getTime()) / YEAR_MS);
  if (years <= 0) return "<1y";
  if (years >= 4) return "4y+";
  return AGE_BUCKETS[years];
}

export interface Coverage {
  covered: number;
  needed: number;
  text: string;
}

/**
 * The line under the Fleet bar. Per asset type, one spare covers one unfilled
 * required slot — greedy, and never counting more spares than slots.
 */
export function coverageLine(
  spareByType: Record<string, number>,
  neededByType: Record<string, number>,
): Coverage {
  let covered = 0;
  let needed = 0;
  for (const [type, count] of Object.entries(neededByType)) {
    needed += count;
    covered += Math.min(count, spareByType[type] ?? 0);
  }
  const text = needed === 0
    ? "no incoming hires need equipment right now"
    : `spare pool covers ${covered} of the ${needed} slot${needed === 1 ? "" : "s"} the incoming hires need`;
  return { covered, needed, text };
}

export function warrantyDaysLeft(until: Date, now: Date = new Date()): number {
  return Math.round((until.getTime() - now.getTime()) / 86_400_000);
}

/** UserPreference key holding today's cleared rows. */
export const DISMISS_PREF_KEY = "home:dismissed";

export interface DismissPref {
  date: string;
  keys: string[];
}

function asPref(value: unknown): DismissPref | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<DismissPref>;
  return typeof v.date === "string" && Array.isArray(v.keys) ? { date: v.date, keys: v.keys.filter((k) => typeof k === "string") } : null;
}

/** Cleared items leave for the rest of the day — a new date forgets them. */
export function activeDismissals(value: unknown, today: string): Set<string> {
  const pref = asPref(value);
  return new Set(pref && pref.date === today ? pref.keys : []);
}

export function withDismissal(value: unknown, today: string, key: string): DismissPref {
  const pref = asPref(value);
  if (!pref || pref.date !== today) return { date: today, keys: [key] };
  return pref.keys.includes(key) ? pref : { date: today, keys: [...pref.keys, key] };
}

/** Asia/Manila day stamp — the business's day, so "the rest of the day" means theirs. */
export function todayStamp(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}
```

- [x] **Step 5: Run the tests**

Run: `npm run test -- src/lib/home.test.ts` — Expected: PASS.

- [x] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/home.ts src/lib/home.test.ts
git commit -m "feat(home): the dashboard's arithmetic — what breaks first, age, coverage, dismissals"
```

---

### Task 2: Independent degradation (TDD) — build this BEFORE any section uses it

Entry criterion #1. The design (`1d`) shows the failed-section state as a first-class screen: a card with a `FAILED` pill, a plain explanation, and "Retry this section", while the rest of the page is unaffected.

**Files:**
- Create: `src/lib/section.ts`, `src/lib/section.test.ts`
- Create: `src/components/home/section-card.tsx`, `src/components/home/retry-section.tsx`

- [x] **Step 1: Write the failing tests** (`src/lib/section.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";
import { safeSection } from "./section";

describe("safeSection — one failing query must not blank the page", () => {
  it("passes data through when the loader resolves", async () => {
    const res = await safeSection("Fleet", async () => ({ total: 22 }));
    expect(res).toEqual({ ok: true, data: { total: 22 } });
  });

  it("turns a thrown error into a typed failure carrying the section label", async () => {
    const res = await safeSection("Fleet", async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.label).toBe("Fleet");
      expect(res.message).toBe("This section couldn't load.");
    }
  });

  it("does not leak the underlying error text to the UI", async () => {
    const res = await safeSection("Fleet", async () => {
      throw new Error("password authentication failed for user \"postgres\"");
    });
    if (!res.ok) expect(res.message).not.toMatch(/password|postgres/);
  });

  it("still logs the real error server-side so it is diagnosable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await safeSection("Fleet", async () => {
      throw new Error("boom");
    });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.join(" "))).toMatch(/Fleet/);
    spy.mockRestore();
  });

  it("catches a synchronous throw as well as a rejected promise", async () => {
    const res = await safeSection("Fleet", () => {
      throw new Error("sync boom");
    });
    expect(res.ok).toBe(false);
  });

  it("never throws, whatever the loader does", async () => {
    await expect(safeSection("X", async () => { throw "a string, not an Error"; })).resolves.toMatchObject({ ok: false });
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/section.test.ts` — Expected: FAIL (module missing).

- [x] **Step 3: Implement `src/lib/section.ts`**

```ts
/**
 * Brief §7: "Every section degrades independently — if one query fails the rest
 * of the page still renders. Design the degraded state, not just the happy one."
 *
 * The loader is wrapped here rather than behind a React error boundary because
 * this is the failure the design is about — a query that didn't come back —
 * and because a typed result is testable without a browser.
 */
export type SectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; label: string; message: string };

export async function safeSection<T>(
  label: string,
  run: () => Promise<T> | T,
): Promise<SectionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    // the real error stays server-side; the card shows a sentence a person can act on
    console.error(`[home] section "${label}" failed:`, err);
    return { ok: false, label, message: "This section couldn't load." };
  }
}
```

- [x] **Step 4: Run the tests**

Run: `npm run test -- src/lib/section.test.ts` — Expected: PASS.

- [x] **Step 5: The retry island** (`src/components/home/retry-section.tsx`)

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * There is no per-section refetch in RSC — the button re-runs the route, which
 * re-runs this section's loader. The label promises the effect, not the
 * mechanism, and the effect is exactly what happens.
 */
export function RetrySection({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() => startTransition(() => router.refresh())}
      aria-label={`Retry ${label}`}
    >
      Retry this section
    </Button>
  );
}
```

- [x] **Step 6: The section card** (`src/components/home/section-card.tsx`)

```tsx
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import type { SectionResult } from "@/lib/section";
import { RetrySection } from "./retry-section";

/**
 * Renders a section, or the designed FAILED state (README 1d): a red-bordered
 * card with a FAILED pill, a plain explanation, and "Retry this section" —
 * while every other section on the page renders normally.
 */
export function SectionCard<T>({
  title,
  result,
  actions,
  children,
  className,
}: {
  title: string;
  result: SectionResult<T>;
  actions?: React.ReactNode;
  children: (data: T) => React.ReactNode;
  className?: string;
}) {
  if (result.ok) {
    return (
      <Card className={className}>
        <CardHeader title={title} actions={actions} />
        <CardBody>{children(result.data)}</CardBody>
      </Card>
    );
  }
  return (
    <Card className={className} style={{ borderColor: "var(--st-fault-border)" }}>
      <CardHeader title={title} actions={<Pill tone="neutral">FAILED</Pill>} />
      <CardBody className="flex flex-col items-start gap-2">
        <p className="text-xs text-fg-secondary">
          {result.message} The rest of this page is unaffected.
        </p>
        <RetrySection label={title} />
      </CardBody>
    </Card>
  );
}
```

- [x] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean.

`Card` currently takes only `className` and `children`. If it does not accept `style`, add the prop to `src/components/ui/card.tsx` (`style?: React.CSSProperties`, spread onto the div) rather than hard-coding a colour class here — and say so in your report.

- [x] **Step 8: Commit**

```bash
git add src/lib/section.ts src/lib/section.test.ts src/components/home
git commit -m "feat(home): sections degrade independently — typed failure + the designed FAILED card"
```

---

### Task 3: The IT Home queries

Everything "Your shift" needs comes from rows that already exist — breached approvals, failed executions, leavers, hires without kit, and assets whose custody doesn't add up. No new tables, no new enum.

**Files:**
- Create: `src/server/modules/home/queries.ts`
- Modify: `src/lib/home.ts`, `src/lib/home.test.ts` (add `warrantyClusters`)

- [x] **Step 1: Write the failing test for the warranty cluster helper** (append to `src/lib/home.test.ts`)

```ts
describe("warrantyClusters — two identical laptops expiring the same week is the point", () => {
  it("marks rows that share a model and an expiry week", () => {
    const rows = [
      { id: "a", model: "ThinkPad T14", days: 12 },
      { id: "b", model: "ThinkPad T14", days: 14 },
      { id: "c", model: "Dell P2419H", days: 40 },
    ];
    const marked = warrantyClusters(rows);
    expect(marked.find((r) => r.id === "a")!.clustered).toBe(true);
    expect(marked.find((r) => r.id === "b")!.clustered).toBe(true);
    expect(marked.find((r) => r.id === "c")!.clustered).toBe(false);
  });
  it("does not cluster the same model in different weeks", () => {
    const marked = warrantyClusters([
      { id: "a", model: "ThinkPad T14", days: 3 },
      { id: "b", model: "ThinkPad T14", days: 60 },
    ]);
    expect(marked.every((r) => !r.clustered)).toBe(true);
  });
  it("clusters an already-expired pair too (negative days)", () => {
    const marked = warrantyClusters([
      { id: "a", model: "X", days: -2 },
      { id: "b", model: "X", days: -4 },
    ]);
    expect(marked.every((r) => r.clustered)).toBe(true);
  });
});
```

Add `warrantyClusters` to that file's import list.

- [x] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/home.test.ts` — Expected: FAIL (`warrantyClusters` is not exported).

- [x] **Step 3: Implement it** (append to `src/lib/home.ts`)

```ts
export interface WarrantyLike {
  id: string;
  model: string;
  days: number;
}

/**
 * README: the runway's job is to surface that *two identical laptops expire the
 * same week* — one row is a diary note, two is a purchase order. Week = the
 * 7-day bucket the expiry falls in, so a pair 2 days apart clusters and a pair
 * 2 months apart doesn't.
 */
export function warrantyClusters<T extends WarrantyLike>(rows: T[]): Array<T & { clustered: boolean }> {
  const bucket = (r: WarrantyLike) => `${r.model}:${Math.floor(r.days / 7)}`;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(bucket(r), (counts.get(bucket(r)) ?? 0) + 1);
  return rows.map((r) => ({ ...r, clustered: (counts.get(bucket(r)) ?? 0) > 1 }));
}
```

- [x] **Step 4: Run the tests**

Run: `npm run test -- src/lib/home.test.ts` — Expected: PASS.

- [x] **Step 5: Write the query module** (`src/server/modules/home/queries.ts`)

```ts
import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";
import { slaLabel } from "@/lib/approvals-list";
import { summarizeApproval } from "@/lib/approval-execution";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import {
  AGE_BUCKETS, DISMISS_PREF_KEY, activeDismissals, ageBucket, coverageLine, shiftOrder,
  todayStamp, warrantyClusters, warrantyDaysLeft, type AgeBucket, type ShiftRow,
} from "@/lib/home";

const DAY_MS = 86_400_000;
const daysSince = (d: Date, now: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / DAY_MS));

/** ACTIVE employees who started recently are the ones whose kit is still landing. */
const HIRE_WINDOW_DAYS = 30;
const WARRANTY_WINDOW_DAYS = 90;

/**
 * "Your shift" (README): five rows ordered by what breaks first, each with the
 * one action that clears it. Every row is a real record — nothing here is a
 * count for its own sake.
 */
export async function yourShift(userId: string, now: Date = new Date()): Promise<ShiftRow[]> {
  const [breached, failed, leavers, hires, missing, orphaned, pref] = await Promise.all([
    prisma.approval.findMany({
      where: { state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now } },
      orderBy: { slaAt: "asc" },
      take: 10,
      include: { asset: true, employee: true },
    }),
    prisma.approval.findMany({
      where: { state: "EXECUTION_FAILED" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      include: { asset: true, employee: true },
    }),
    prisma.employee.findMany({
      where: { employment: "OFFBOARDING" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, name: true, employeeNo: true, updatedAt: true, _count: { select: { assets: true } } },
    }),
    prisma.employee.findMany({
      where: { employment: "ACTIVE", joinedAt: { gte: new Date(now.getTime() - HIRE_WINDOW_DAYS * DAY_MS) } },
      orderBy: { joinedAt: "asc" },
      take: 10,
      select: {
        id: true, name: true, employeeNo: true, title: true, departmentId: true, joinedAt: true,
        assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
      },
    }),
    prisma.asset.findMany({
      where: { status: "MISSING" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    // custody that doesn't add up: DEPLOYED with nobody holding it
    prisma.asset.findMany({
      where: { status: "DEPLOYED", assigneeId: null },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
      select: { value: true },
    }),
  ]);

  const policies = hires.length
    ? await prisma.equipmentPolicy.findMany({
        select: {
          id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
          slots: { select: { id: true, name: true, assetTypeId: true, required: true } },
        },
      })
    : [];

  const rows: ShiftRow[] = [];

  for (const a of breached) {
    const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name });
    rows.push({
      key: `SLA:${a.id}`,
      kind: "SLA",
      title: `${a.refNo} · ${s.line1}`,
      meta: `${slaLabel(a.slaAt, now).text} · ${a.priority.toLowerCase()}`,
      href: `/approvals/${a.id}`,
      action: a.state === "PENDING" ? "Claim" : "Open",
      severity: daysSince(a.slaAt, now),
    });
  }

  for (const a of failed) {
    const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name });
    rows.push({
      key: `EXEC:${a.id}`,
      kind: "EXEC",
      title: `${a.refNo} · ${s.line1}`,
      meta: `execution failed ${daysSince(a.updatedAt, now)} d ago`,
      href: `/approvals/${a.id}`,
      action: "Retry",
      severity: daysSince(a.updatedAt, now),
    });
  }

  for (const e of leavers) {
    rows.push({
      key: `LEAVE:${e.id}`,
      kind: "LEAVE",
      title: `${e.name} is leaving`,
      meta: `${e.employeeNo} · ${e._count.assets} item${e._count.assets === 1 ? "" : "s"} still out`,
      href: `/employees/${e.id}`,
      action: "Collect equipment",
      severity: daysSince(e.updatedAt, now),
    });
  }

  for (const e of hires) {
    const policy = resolvePolicy({ title: e.title, departmentId: e.departmentId }, policies);
    if (!policy) continue;
    const loadout = computeLoadout(policy.slots, e.assets);
    if (loadout.missingRequired === 0) continue;
    rows.push({
      key: `HIRE:${e.id}`,
      kind: "HIRE",
      title: `${e.name} started ${daysSince(e.joinedAt, now)} d ago`,
      meta: `${e.employeeNo} · ${loadout.missingRequired} required slot${loadout.missingRequired === 1 ? "" : "s"} empty · ${policy.name}`,
      href: `/employees/${e.id}`,
      action: "Fill loadout",
      severity: daysSince(e.joinedAt, now),
    });
  }

  for (const a of missing) {
    rows.push({
      key: `DATA:${a.id}`,
      kind: "DATA",
      title: `${a.tag} is MISSING`,
      meta: `${a.model} · custody lost ${daysSince(a.updatedAt, now)} d ago`,
      href: `/inventory/${a.id}`,
      action: "Investigate",
      severity: daysSince(a.updatedAt, now),
    });
  }

  for (const a of orphaned) {
    rows.push({
      key: `DATA:${a.id}`,
      kind: "DATA",
      title: `${a.tag} reads DEPLOYED with no holder`,
      meta: `${a.model} · assign it or return it to the pool`,
      href: `/inventory/${a.id}`,
      action: "Fix record",
      severity: daysSince(a.updatedAt, now),
    });
  }

  return shiftOrder(rows, activeDismissals(pref?.value, todayStamp(now)));
}

export interface ClaimRow {
  id: string;
  refNo: string;
  line1: string;
  sla: { text: string; overdue: boolean };
}

/** README: claims sit ABOVE the pool — a forgotten claim is worse than an unclaimed item. */
export async function claimedByYou(userId: string, now: Date = new Date()): Promise<ClaimRow[]> {
  const rows = await prisma.approval.findMany({
    where: { state: "CLAIMED", claimedById: userId },
    orderBy: { slaAt: "asc" },
    take: 5,
    include: { asset: true, employee: true },
  });
  return rows.map((a) => ({
    id: a.id,
    refNo: a.refNo,
    line1: summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name }).line1,
    sla: slaLabel(a.slaAt, now),
  }));
}

export interface FleetSlice {
  status: string;
  count: number;
  share: number;
}

export interface Fleet {
  total: number;
  slices: FleetSlice[];
  coverage: string;
}

/**
 * One stacked bar over every status, a legend with counts and shares, and then
 * the line that actually decides something: does the spare pool cover the
 * people starting next week?
 */
export async function fleet(now: Date = new Date()): Promise<Fleet> {
  const [groups, spares, hires] = await Promise.all([
    prisma.asset.groupBy({ by: ["status"], _count: { _all: true } }),
    // a spare under an ACTIVE hold is already promised to someone
    prisma.asset.findMany({
      where: { status: "SPARE", reservations: { none: { state: "ACTIVE" } } },
      select: { typeId: true },
    }),
    prisma.employee.findMany({
      where: { employment: "ACTIVE", joinedAt: { gte: new Date(now.getTime() - HIRE_WINDOW_DAYS * DAY_MS) } },
      select: {
        title: true, departmentId: true,
        assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
      },
    }),
  ]);

  const total = groups.reduce((sum, g) => sum + g._count._all, 0);
  const slices = groups
    .map((g): FleetSlice => ({
      status: g.status,
      count: g._count._all,
      share: total === 0 ? 0 : Math.round((g._count._all / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const spareByType: Record<string, number> = {};
  for (const s of spares) {
    const key = s.typeId ?? "untyped";
    spareByType[key] = (spareByType[key] ?? 0) + 1;
  }

  const neededByType: Record<string, number> = {};
  if (hires.length) {
    const policies = await prisma.equipmentPolicy.findMany({
      select: {
        id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
        slots: { select: { id: true, name: true, assetTypeId: true, required: true } },
      },
    });
    for (const e of hires) {
      const policy = resolvePolicy({ title: e.title, departmentId: e.departmentId }, policies);
      if (!policy) continue;
      const { slots } = computeLoadout(policy.slots, e.assets);
      for (const { slot, asset } of slots) {
        if (asset || !slot.required) continue;
        const key = slot.assetTypeId ?? "untyped";
        neededByType[key] = (neededByType[key] ?? 0) + 1;
      }
    }
  }

  return { total, slices, coverage: coverageLine(spareByType, neededByType).text };
}

export interface AgeBar {
  bucket: AgeBucket;
  count: number;
}

/** Five buckets; only 4y+ changes colour, because that's next year's capex conversation. */
export async function ageHistogram(now: Date = new Date()): Promise<AgeBar[]> {
  const assets = await prisma.asset.findMany({ select: { purchasedAt: true } });
  const counts = new Map<AgeBucket, number>(AGE_BUCKETS.map((b) => [b, 0]));
  for (const a of assets) {
    const bucket = ageBucket(a.purchasedAt, now);
    if (bucket) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return AGE_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }));
}

export interface WarrantyRow {
  id: string;
  tag: string;
  model: string;
  until: string;
  days: number;
  clustered: boolean;
}

export async function warrantyRunway(now: Date = new Date()): Promise<WarrantyRow[]> {
  const horizon = new Date(now.getTime() + WARRANTY_WINDOW_DAYS * DAY_MS);
  const assets = await prisma.asset.findMany({
    where: { warrantyUntil: { not: null, lte: horizon }, status: { notIn: ["DISPOSE", "DONATED", "BUYOUT"] } },
    orderBy: { warrantyUntil: "asc" },
    take: 8,
    select: { id: true, tag: true, model: true, warrantyUntil: true },
  });
  return warrantyClusters(
    assets.map((a) => ({
      id: a.id,
      tag: a.tag,
      model: a.model,
      until: fmtDate(a.warrantyUntil),
      days: warrantyDaysLeft(a.warrantyUntil!, now),
    })),
  );
}
```

- [x] **Step 6: Verify against the real database**

There is no unit test for this module (it is I/O). Prove it with a throwaway script in the scratchpad (`.../scratchpad/check-home.ts`, run with `npx tsx`, DELETE it afterwards; `npm run db:seed` first).

Print and check, against the seeded data:
1. `yourShift(<admin's id>)` — expect rows including **APR-2040** (`SLA`, overdue), **APR-2025** (`EXEC`), **Dennis Ong** (`LEAVE`), a `HIRE` row for **Nina Robles** and/or **Karen Uy** (both Finance-department, joined ≤30 d, holding nothing against the 6-slot `Finance standard` policy), and **BR-LT-0027** (`DATA`, MISSING). Confirm the ORDER is SLA → EXEC → LEAVE → HIRE → DATA and that exactly 5 come back.
2. `claimedByYou(<admin's id>)` — APR-2039 is CLAIMED by `admin@` in the seed, so expect exactly one row.
3. `fleet()` — `total` 22, slices summing to 22, and a `coverage` sentence naming a real number of slots (the two Finance hires need laptop/monitor/dock/headset/phone slots).
4. `ageHistogram()` — five buckets, counts summing to the number of assets WITH a purchase date.
5. `warrantyRunway()` — rows within 90 days, ordered soonest-first, and check whether any pair clusters.

Report the printed output for 1, 3 and 5.

- [x] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/home.ts src/lib/home.test.ts src/server/modules/home/queries.ts
git commit -m "feat(home): your shift, claims, fleet coverage, age and warranty runway"
```

**Watch for:** `warrantyUntil: { not: null, lte: horizon }` — confirm Prisma accepts `not: null` alongside `lte` in one filter; if not, use `AND: [{ warrantyUntil: { not: null } }, { warrantyUntil: { lte: horizon } }]` and report. The `reservations: { none: { state: "ACTIVE" } }` relation filter must also be verified against the real schema.

---

### Task 4: Purchasing and Finance Home data

Entry criterion #3: **Finance Home leads with money and age** ("₱208k waiting, oldest 2 days"), Purchasing Home with a to-do list and spend.

**Files:**
- Modify: `src/server/modules/home/queries.ts` (append)

- [x] **Step 1: Append the two role queries**

First widen the file's format import — Task 3 deliberately left `fmtMoney` out because nothing used it yet and lint runs at `--max-warnings 0`:

```ts
import { fmtDate, fmtMoney } from "@/lib/format";
```

Then append:

```ts
export interface TodoRow {
  id: string;
  refNo: string;
  what: string;
  meta: string;
  href: string;
  action: string;
}

export interface PurchasingHome {
  todo: TodoRow[];
  draftCount: number;
  awaitingIT: number;
  awaitingFinance: number;
  /** completed this calendar month, preformatted */
  spendThisMonth: string;
}

const unitsValue = (units: Array<{ qty: number; unitPrice: unknown }>) =>
  units.reduce((sum, u) => sum + u.qty * (u.unitPrice === null || u.unitPrice === undefined ? 0 : Number(u.unitPrice)), 0);

/**
 * Purchasing Home leads with what this person still has to do: drafts nobody
 * has sent, and anything that came back to them.
 */
export async function purchasingHome(userId: string, now: Date = new Date()): Promise<PurchasingHome> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [mine, counts, completed] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { requestedById: userId, state: { in: ["DRAFT", "SUBMITTED"] } },
      orderBy: { updatedAt: "asc" },
      take: 8,
      select: {
        id: true, refNo: true, state: true, updatedAt: true,
        units: { select: { qty: true, unitPrice: true } },
        notes: {
          where: { kind: { not: "COMMENT" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { kind: true, author: { select: { name: true } } },
        },
      },
    }),
    prisma.purchaseRequest.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.purchaseRequest.findMany({
      where: { state: "COMPLETED", completedAt: { gte: monthStart } },
      select: { units: { select: { qty: true, unitPrice: true } } },
    }),
  ]);

  const count = (state: string) => counts.find((c) => c.state === state)?._count._all ?? 0;

  const todo: TodoRow[] = mine.map((r) => {
    const last = r.notes[0];
    const bounced = (r.state === "DRAFT" && last?.kind === "IT_REJECT") || (r.state === "SUBMITTED" && last?.kind === "REQUEST_INFO");
    return {
      id: r.id,
      refNo: r.refNo,
      what: bounced ? `came back from ${last?.author.name ?? "review"}` : r.state === "DRAFT" ? "still a draft" : "waiting on IT",
      meta: `${fmtMoney(unitsValue(r.units))} · ${daysSince(r.updatedAt, now)} d`,
      href: `/purchases/${r.id}`,
      action: bounced ? "Fix and resubmit" : r.state === "DRAFT" ? "Submit" : "Open",
    };
  });

  return {
    todo,
    draftCount: count("DRAFT"),
    awaitingIT: count("SUBMITTED"),
    awaitingFinance: count("IT_REVIEWED"),
    spendThisMonth: fmtMoney(completed.reduce((sum, r) => sum + unitsValue(r.units), 0)),
  };
}

export interface FinanceHome {
  /** the headline: money sitting on finance's desk */
  waiting: string;
  waitingCount: number;
  /** "oldest 2 days" — null when nothing is waiting */
  oldestDays: number | null;
  approvedThisMonth: string;
  capitalized: string;
  capitalizedCount: number;
  queue: TodoRow[];
}

/**
 * README 5d: Finance Home leads with MONEY AND AGE, not counts — "₱208k
 * waiting, oldest 2 days". The count is the supporting detail, not the headline.
 */
export async function financeHome(now: Date = new Date()): Promise<FinanceHome> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [waiting, completed, capitalized] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { state: "IT_REVIEWED" },
      orderBy: { reviewedAt: "asc" },
      select: {
        id: true, refNo: true, reviewedAt: true, updatedAt: true,
        requestedBy: { select: { name: true } },
        units: { select: { qty: true, unitPrice: true } },
      },
    }),
    prisma.purchaseRequest.findMany({
      where: { state: "COMPLETED", completedAt: { gte: monthStart } },
      select: { units: { select: { qty: true, unitPrice: true } } },
    }),
    prisma.asset.aggregate({ where: { cost: { not: null } }, _sum: { cost: true }, _count: { _all: true } }),
  ]);

  const oldest = waiting[0];
  return {
    waiting: fmtMoney(waiting.reduce((sum, r) => sum + unitsValue(r.units), 0)),
    waitingCount: waiting.length,
    oldestDays: oldest ? daysSince(oldest.reviewedAt ?? oldest.updatedAt, now) : null,
    approvedThisMonth: fmtMoney(completed.reduce((sum, r) => sum + unitsValue(r.units), 0)),
    // Prisma returns Decimal | null from _sum — Number() before it ever leaves here
    capitalized: fmtMoney(capitalized._sum.cost === null ? 0 : Number(capitalized._sum.cost)),
    capitalizedCount: capitalized._count._all,
    queue: waiting.slice(0, 8).map((r) => ({
      id: r.id,
      refNo: r.refNo,
      what: `from ${r.requestedBy.name}`,
      meta: `${fmtMoney(unitsValue(r.units))} · waiting ${daysSince(r.reviewedAt ?? r.updatedAt, now)} d`,
      href: `/purchases/${r.id}`,
      action: "Review",
    })),
  };
}
```

- [x] **Step 2: Verify against the real database**

Extend your throwaway scratchpad script (delete it after; reseed first):
1. `financeHome()` — the seed has PR-0195 `IT_REVIEWED` at ₱45,000, so expect `waiting` ≈ `₱45,000`, `waitingCount` 1, and a non-null `oldestDays`. `capitalized` should be the sum of all 22 assets' costs, and `capitalizedCount` the number with a cost.
2. `purchasingHome(<purchasing@'s id>)` — expect PR-0201 (DRAFT, "still a draft", action "Submit") and PR-0198 (SUBMITTED with a REQUEST_INFO as its newest flow note → "came back from L. Domingo", action "Fix and resubmit"). **That bounced row is the whole point of this list** — confirm it says "came back", not "waiting on IT".
3. Confirm no `Prisma.Decimal` escapes: `typeof` every money field on both results must be `"string"` (they are preformatted) and no field should be an object.

Report the printed output for 1 and 2.

- [x] **Step 3: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/home/queries.ts
git commit -m "feat(home): purchasing to-do + spend, finance money-and-age headline"
```

---

### Task 5: Focus mode + clearing a shift row

Entry criteria #4 and the README's "cleared items leave for the rest of the day rather than reappearing — the count is a promise, not a feed."

**Files:**
- Create: `src/server/modules/home/actions.ts`
- Create: `src/components/home/focus-toggle.tsx`, `src/components/home/dismiss-button.tsx`

- [x] **Step 1: The dismiss action** (`src/server/modules/home/actions.ts`)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { DISMISS_PREF_KEY, todayStamp, withDismissal } from "@/lib/home";
import {
  forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const schema = z.object({ key: z.string().min(3).max(120) });

/**
 * Clearing a shift row is a per-user, per-day preference — not an audited
 * domain event. It writes no AuditEntry deliberately: nothing about the record
 * changed, only what this person wants to look at for the rest of today.
 */
export async function dismissShiftRow(input: unknown): Promise<ActionResult<null>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const existing = await prisma.userPreference.findUnique({
    where: { userId_key: { userId: user.id, key: DISMISS_PREF_KEY } },
    select: { value: true },
  });
  const next = withDismissal(existing?.value, todayStamp(), parsed.data.key);

  await prisma.userPreference.upsert({
    where: { userId_key: { userId: user.id, key: DISMISS_PREF_KEY } },
    create: { userId: user.id, key: DISMISS_PREF_KEY, value: next },
    update: { value: next },
  });

  revalidatePath("/");
  return ok(null);
}
```

- [x] **Step 2: The dismiss island** (`src/components/home/dismiss-button.tsx`)

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { dismissShiftRow } from "@/server/modules/home/actions";

/** Clears one row for the rest of the day — the count is a promise, not a feed. */
export function DismissButton({ shiftKey, title }: { shiftKey: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <IconButton
      aria-label={`Clear "${title}" for today`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await dismissShiftRow({ key: shiftKey });
          router.refresh();
        })
      }
    >
      ✓
    </IconButton>
  );
}
```

- [x] **Step 3: The focus toggle** (`src/components/home/focus-toggle.tsx`)

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Focus is a personal working mode, so it lives in a cookie, never the URL —
 * a shared link must not drag someone else into your collapsed view. Written
 * client-side like the theme and density toggles, then refreshed because the
 * page is server-rendered from that cookie.
 */
export function FocusToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      aria-pressed={on}
      onClick={() => {
        document.cookie = `br.focus=${on ? "off" : "on"};path=/;max-age=31536000;samesite=lax`;
        startTransition(() => router.refresh());
      }}
    >
      {on ? "Show everything" : "Focus"}
    </Button>
  );
}
```

- [x] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/home/actions.ts src/components/home/focus-toggle.tsx src/components/home/dismiss-button.tsx
git commit -m "feat(home): focus-mode cookie and per-day clearing of a shift row"
```

**Check carefully:** `UserPreference` has a `@@unique([userId, key])`, so `userId_key` is the compound-where name Prisma generates — confirm against `prisma/schema.prisma` and against how `getInventoryColumns` (`src/server/modules/inventory/queries.ts`) already queries it. `value` is `Json`; passing a plain object is correct, but check whether Prisma needs `value: next as Prisma.InputJsonObject` to typecheck and report what you did.

---

### Task 6: The IT Home sections

Entry criterion #2. **No KPI tile row** — the most valuable strip on the page goes to work that needs doing, not to "742 deployed".

**Files:**
- Create: `src/components/home/your-shift.tsx`, `fleet-bar.tsx`, `age-histogram.tsx`, `warranty-runway.tsx`, `jump-to.tsx`

- [x] **Step 1: Your shift** (`src/components/home/your-shift.tsx`)

```tsx
import Link from "next/link";
import { StatusDot } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import type { ShiftKind, ShiftRow } from "@/lib/home";
import { DismissButton } from "./dismiss-button";

/** The 52px kind chip (README). The dot family says how bad, the chip says what kind. */
const KIND_DOT: Record<ShiftKind, string> = {
  SLA: "DEFECTIVE",   // fault — it is already late
  EXEC: "EXECUTION_FAILED", // the dashed diamond: a system failure, not a decision
  LEAVE: "SUBMITTED", // in flight
  HIRE: "PENDING",    // attention
  DATA: "TEMPORARY",  // attention, quieter
};

export function YourShift({ rows, canAct }: { rows: ShiftRow[]; canAct: boolean }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing is on fire"
        description="No breached approvals, no failed executions, no leaver or new starter waiting on you."
      />
    );
  }
  return (
    <ol className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-center gap-3 border-b border-border-faint py-2.5 last:border-b-0"
        >
          <StatusDot value={KIND_DOT[row.kind]} />
          <span className="inline-flex w-[52px] shrink-0 justify-center rounded-(--radius-ctl) border border-border bg-border-faint py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-fg-secondary">
            {row.kind}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-fg">{row.title}</span>
            <span className="block truncate font-mono text-[10.5px] text-fg-muted">{row.meta}</span>
          </span>
          <Link
            href={row.href}
            className="shrink-0 text-[12px] font-medium text-accent hover:underline"
          >
            {row.action}
          </Link>
          {canAct && <DismissButton shiftKey={row.key} title={row.title} />}
        </li>
      ))}
    </ol>
  );
}
```

- [x] **Step 2: The fleet bar** (`src/components/home/fleet-bar.tsx`)

```tsx
import { StatusDot } from "@/components/ui/status";
import { statusFamily } from "@/lib/status";
import type { Fleet } from "@/server/modules/home/queries";

/**
 * One 12px stacked bar over every status, a legend with counts and shares, and
 * then the line that matters — whether the spare pool covers the people
 * starting next week. Colours come from the six-family map; no screen picks a
 * status colour by hand.
 */
export function FleetBar({ fleet }: { fleet: Fleet }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-border-faint"
        role="img"
        aria-label={`Fleet of ${fleet.total} assets by status`}
      >
        {fleet.slices.map((s) => (
          <span
            key={s.status}
            title={`${s.status} ${s.count}`}
            style={{
              width: `${s.share}%`,
              background: `var(--st-${statusFamily(s.status)}-dot)`,
              animation: "grow var(--dur-3) var(--ease-std)",
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {fleet.slices.map((s) => (
          <li key={s.status} className="inline-flex items-center gap-1.5">
            <StatusDot value={s.status} />
            <span className="font-mono text-[10.5px] text-fg-secondary">{s.status}</span>
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

- [x] **Step 3: The age histogram** (`src/components/home/age-histogram.tsx`)

```tsx
import type { AgeBar } from "@/server/modules/home/queries";

const MAX_H = 74; // README: 74px max bar

/** Only the 4y+ bar changes colour — it is next year's capex conversation. */
export function AgeHistogram({ bars }: { bars: AgeBar[] }) {
  const peak = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div className="flex items-end gap-3" role="img" aria-label={bars.map((b) => `${b.bucket}: ${b.count}`).join(", ")}>
      {bars.map((b) => (
        <div key={b.bucket} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="font-mono text-[10.5px] font-semibold text-fg">{b.count}</span>
          <span
            aria-hidden
            className="w-full rounded-t-[3px]"
            style={{
              height: `${Math.max(2, Math.round((b.count / peak) * MAX_H))}px`,
              background: b.bucket === "4y+" ? "var(--st-attention-dot)" : "var(--st-neutral-dot)",
              animation: "grow var(--dur-3) var(--ease-std)",
            }}
          />
          <span className="font-mono text-[10px] text-fg-muted">{b.bucket}</span>
        </div>
      ))}
    </div>
  );
}
```

- [x] **Step 4: The warranty runway** (`src/components/home/warranty-runway.tsx`)

```tsx
import Link from "next/link";
import type { WarrantyRow } from "@/server/modules/home/queries";

/** Next 90 days. A clustered pair is the point: one is a diary note, two is a PO. */
export function WarrantyRunway({ rows }: { rows: WarrantyRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-fg-muted">Nothing comes off warranty in the next 90 days.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex items-baseline gap-2">
          <Link href={`/inventory/${r.id}`} className="font-mono text-[11px] text-accent hover:underline">
            {r.tag}
          </Link>
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-secondary">{r.model}</span>
          {r.clustered && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[color:var(--st-attention-text)]">
              same week
            </span>
          )}
          <span className="font-mono text-[10.5px] text-fg-muted">
            {r.days < 0 ? `expired ${-r.days} d ago` : `${r.days} d`}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [x] **Step 5: Jump to** (`src/components/home/jump-to.tsx`) — the one thing kept from the Phase-2 placeholder

```tsx
import Link from "next/link";
import type { NavSection } from "@/lib/workspaces";

export function JumpTo({ sections }: { sections: NavSection[] }) {
  const links = sections.flatMap((s) => s.items).filter((i) => i.href !== "/").slice(0, 10);
  return (
    <div className="grid grid-cols-2 gap-1">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-(--radius-ctl) px-2.5 py-1.5 text-[12.5px] text-fg-secondary hover:bg-surface-subtle hover:text-fg"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
```

- [x] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/home
git commit -m "feat(home): the IT sections — your shift, fleet bar, age, warranty runway, jump to"
```

**Check carefully:** `KIND_DOT.EXEC` is `"EXECUTION_FAILED"`, which `StatusDot` renders as the dashed diamond — that is deliberate (a system failure must not look like a human decision). Confirm `isSystemFailure` in `src/lib/status.ts` still keys on exactly that string. Also confirm `--st-attention-dot`, `--st-attention-text` and `--st-neutral-dot` exist in `src/app/globals.css`; if a name differs, use the real one and report.

---

### Task 7: Home itself — the four role variants and Focus mode

Entry criteria #2, #3, #4, #5. This replaces the Phase-2 placeholder wholesale.

**Files:**
- Replace: `src/app/(app)/page.tsx`

- [x] **Step 1: Write the page**

```tsx
import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/guards";
import { resolveWorkspace, WORKSPACE_NAV } from "@/lib/workspaces";
import { filterSectionsForRole } from "@/components/shell/sidebar";
import { safeSection } from "@/lib/section";
import {
  ageHistogram, claimedByYou, financeHome, fleet, purchasingHome, warrantyRunway, yourShift,
} from "@/server/modules/home/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { SectionCard } from "@/components/home/section-card";
import { FocusToggle } from "@/components/home/focus-toggle";
import { YourShift } from "@/components/home/your-shift";
import { FleetBar } from "@/components/home/fleet-bar";
import { AgeHistogram } from "@/components/home/age-histogram";
import { WarrantyRunway } from "@/components/home/warranty-runway";
import { JumpTo } from "@/components/home/jump-to";
import Link from "next/link";
import type { TodoRow } from "@/server/modules/home/queries";

function TodoList({ rows, empty }: { rows: TodoRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-xs text-fg-muted">{empty}</p>;
  return (
    <ol className="flex flex-col">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 border-b border-border-faint py-2 last:border-b-0">
          <Link href={r.href} className="font-mono text-[11px] font-medium text-accent hover:underline">{r.refNo}</Link>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-fg">{r.what}</span>
            <span className="block font-mono text-[10.5px] text-fg-muted">{r.meta}</span>
          </span>
          <Link href={r.href} className="shrink-0 text-[12px] font-medium text-accent hover:underline">{r.action}</Link>
        </li>
      ))}
    </ol>
  );
}

export default async function Home() {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const focus = jar.get("br.focus")?.value === "on";
  const sections = filterSectionsForRole(WORKSPACE_NAV[ws], user.role);
  const isViewer = user.role === "viewer";

  const header = (
    <PageHeader
      title={`Hello, ${user.name.split(" ")[0]}`}
      badge={isViewer ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      actions={<FocusToggle on={focus} />}
    />
  );

  // ── Purchasing: a to-do list and spend ─────────────────────────────────
  if (ws === "purchasing") {
    const home = await safeSection("Your requests", () => purchasingHome(user.id));
    return (
      <>
        {header}
        <div className="flex max-w-[900px] flex-col gap-4">
          <SectionCard title="Your requests" result={home}>
            {(d) => (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Drafts" value={d.draftCount} />
                  <Stat label="Awaiting IT" value={d.awaitingIT} />
                  <Stat label="Awaiting finance" value={d.awaitingFinance} />
                  <Stat label="Spend this month" value={d.spendThisMonth} />
                </div>
                <TodoList rows={d.todo} empty="Nothing of yours is waiting — every request has moved on." />
              </div>
            )}
          </SectionCard>
          {!focus && (
            <SectionCard title="Jump to" result={{ ok: true, data: sections }}>
              {(s) => <JumpTo sections={s} />}
            </SectionCard>
          )}
        </div>
      </>
    );
  }

  // ── Finance: money and age first, counts second ────────────────────────
  if (ws === "finance") {
    const home = await safeSection("Waiting on you", () => financeHome());
    return (
      <>
        {header}
        <div className="flex max-w-[900px] flex-col gap-4">
          <SectionCard title="Waiting on you" result={home}>
            {(d) => (
              <div className="flex flex-col gap-4">
                <p className="text-[19px] font-semibold leading-tight text-fg">
                  {d.waiting} waiting
                  {d.oldestDays !== null && (
                    <span className="text-fg-muted">
                      , oldest {d.oldestDays} day{d.oldestDays === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Stat label="Requests waiting" value={d.waitingCount} />
                  <Stat label="Approved this month" value={d.approvedThisMonth} />
                  <Stat label="Capitalized" value={d.capitalized} hint={`${d.capitalizedCount} assets`} />
                </div>
                <TodoList rows={d.queue} empty="Nothing is waiting on finance right now." />
              </div>
            )}
          </SectionCard>
          {!focus && (
            <SectionCard title="Jump to" result={{ ok: true, data: sections }}>
              {(s) => <JumpTo sections={s} />}
            </SectionCard>
          )}
        </div>
      </>
    );
  }

  // ── IT (and admin, and viewer read-only): no KPI row, work first ───────
  const [shift, claims, fleetData, age, warranty] = await Promise.all([
    isViewer
      ? Promise.resolve({ ok: true as const, data: [] })
      : safeSection("Your shift", () => yourShift(user.id)),
    safeSection("Claimed by you", () => claimedByYou(user.id)),
    safeSection("Fleet", () => fleet()),
    safeSection("Age", () => ageHistogram()),
    safeSection("Warranty runway", () => warrantyRunway()),
  ]);

  return (
    <>
      {header}
      <div className="flex max-w-[980px] flex-col gap-4">
        {/* Viewer has no action queue, so it doesn't get one (entry criterion #3). */}
        {!isViewer && (
          <SectionCard title="Your shift" result={shift}>
            {(rows) => <YourShift rows={rows} canAct />}
          </SectionCard>
        )}

        {/* Claims sit ABOVE the pool — a forgotten claim is worse than an unclaimed item. */}
        <SectionCard title="Claimed by you" result={claims}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-xs text-fg-muted">You hold no claims.</p>
            ) : (
              <ol className="flex flex-col">
                {rows.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 border-b border-border-faint py-2 last:border-b-0">
                    <StatusDot value="CLAIMED" />
                    <Link href={`/approvals/${c.id}`} className="font-mono text-[11px] font-medium text-accent hover:underline">
                      {c.refNo}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-secondary">{c.line1}</span>
                    <span className={c.sla.overdue ? "font-mono text-[10.5px] font-semibold text-[color:var(--st-fault-text)]" : "font-mono text-[10.5px] text-fg-muted"}>
                      {c.sla.text}
                    </span>
                  </li>
                ))}
              </ol>
            )
          }
        </SectionCard>

        {!focus && (
          <>
            <SectionCard title="Fleet" result={fleetData}>
              {(d) => <FleetBar fleet={d} />}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard title="Age" result={age}>
                {(bars) => <AgeHistogram bars={bars} />}
              </SectionCard>
              <SectionCard title="Warranty runway" result={warranty}>
                {(rows) => <WarrantyRunway rows={rows} />}
              </SectionCard>
            </div>

            <SectionCard title="Jump to" result={{ ok: true, data: sections }}>
              {(s) => <JumpTo sections={s} />}
            </SectionCard>
          </>
        )}

        {focus && (
          <p className="font-mono text-[10.5px] text-fg-muted">
            Focus mode — fleet, age, warranty and quick links are hidden. Everything else is still there.
          </p>
        )}
      </div>
    </>
  );
}
```

- [x] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean. Lint runs at `--max-warnings 0`, so an import you end up not using is a build failure, not a warning — the import list above is exactly what this page uses.

- [x] **Step 3: Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "feat(home): role-aware dashboards with independently degrading sections and focus mode"
```

**Check carefully:**
- **Viewer must get no `Your shift` card at all** and no dismiss buttons anywhere. Confirm by reading the render path, and note that `yourShift` is not even queried for a viewer (it costs six queries).
- The **admin** workspace (`ws === "admin"`) falls through to the IT layout. That is deliberate — an admin in the Admin workspace still wants the operational queue — but say in your report whether the sections make sense there, since the Admin sidebar is Users/Webhooks/Flags.
- `safeSection("Jump to", …)` is not used for the nav links because they come from a constant, not a query — passing `{ok: true, data: sections}` directly is correct and intentional. Do not "fix" it into a query.
- Focus mode must keep **the queue and your claims** and drop the rest (entry criterion #4).

---

### Task 8: `/finance/assets` — the capitalized register

**Files:**
- Create: `src/server/modules/finance/queries.ts`
- Create: `src/app/(app)/finance/assets/page.tsx`

- [x] **Step 1: The query** (`src/server/modules/finance/queries.ts`)

```ts
import type { AssetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import { ageBucket } from "@/lib/home";

export const FINANCE_PAGE_SIZE = 25;

export interface FinanceAssetRow {
  id: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  cost: string;
  purchased: string;
  age: string;
  warranty: string;
  assignee: string | null;
}

export function parseAssetStatus(raw: string | null | undefined): AssetStatus | null {
  return (ASSET_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as AssetStatus) : null;
}

/**
 * Capitalized assets: anything with an acquisition cost. Status is shown, not
 * filtered — finance cares that a ₱55,000 laptop currently reads DEFECTIVE.
 * No book-value column: depreciation is a policy nobody has stated, and
 * inventing one would put a number on screen the business never agreed to.
 */
export async function financeAssets(
  status: AssetStatus | null,
  page: number,
  now: Date = new Date(),
): Promise<{ rows: FinanceAssetRow[]; total: number; page: number; pageCount: number; totalCost: string }> {
  const where: Prisma.AssetWhereInput = { cost: { not: null }, ...(status ? { status } : {}) };
  const [total, sum] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.aggregate({ where, _sum: { cost: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / FINANCE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const assets = await prisma.asset.findMany({
    where,
    orderBy: [{ cost: "desc" }, { tag: "asc" }],
    skip: (safePage - 1) * FINANCE_PAGE_SIZE,
    take: FINANCE_PAGE_SIZE,
    include: { category: true, assignee: true },
  });

  return {
    total,
    page: safePage,
    pageCount,
    // Decimal never leaves this module
    totalCost: fmtMoney(sum._sum.cost === null ? 0 : Number(sum._sum.cost)),
    rows: assets.map((a): FinanceAssetRow => ({
      id: a.id,
      tag: a.tag,
      model: a.model,
      category: a.category.name,
      status: a.status,
      cost: fmtMoney(a.cost === null ? 0 : Number(a.cost)),
      purchased: fmtDate(a.purchasedAt),
      age: ageBucket(a.purchasedAt, now) ?? "—",
      warranty: fmtDate(a.warrantyUntil),
      assignee: a.assignee?.name ?? null,
    })),
  };
}
```

- [x] **Step 2: The page** (`src/app/(app)/finance/assets/page.tsx`)

```tsx
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import { financeAssets, parseAssetStatus } from "@/server/modules/finance/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ButtonLink } from "@/components/ui/button-link";
import { cn } from "@/lib/cn";

export default async function FinanceAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = toSearchParams(await searchParams);
  const status = parseAssetStatus(params.get("status"));
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const { rows, total, page: current, pageCount, totalCost } = await financeAssets(status, page);

  const hrefFor = (p: number) => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <>
      <PageHeader title="Capitalized assets" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href="/finance/assets"
            aria-current={status ? undefined : "page"}
            className={cn(
              "rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
              status ? "border-border bg-surface text-fg-secondary hover:bg-surface-subtle" : "border-accent-soft-border bg-accent-soft text-accent-soft-text",
            )}
          >
            All
          </Link>
          {ASSET_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/finance/assets?status=${s}`}
              aria-current={status === s ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                status === s ? "border-accent-soft-border bg-accent-soft text-accent-soft-text" : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
              )}
            >
              <StatusDot value={s} />
              {s}
            </Link>
          ))}
          <span className="ml-auto font-mono text-[11px] text-fg-muted">
            {total} asset{total === 1 ? "" : "s"} · {totalCost} at cost
          </span>
        </div>

        {rows.length > 0 ? (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th width={26} />
                  <Th width={112}>Tag</Th>
                  <Th>Model</Th>
                  <Th width={96}>Category</Th>
                  <Th width={124} align="right">Cost</Th>
                  <Th width={104}>Purchased</Th>
                  <Th width={64}>Age</Th>
                  <Th width={104}>Warranty</Th>
                  <Th width={150}>Held by</Th>
                  <Th width={104}>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((a) => (
                  <Tr key={a.id}>
                    <Td><StatusDot value={a.status} /></Td>
                    <Td>
                      <Link href={`/inventory/${a.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                        {a.tag}
                      </Link>
                    </Td>
                    <Td className="text-fg">{a.model}</Td>
                    <Td mono>{a.category}</Td>
                    <Td align="right" mono>{a.cost}</Td>
                    <Td mono>{a.purchased}</Td>
                    <Td mono>{a.age}</Td>
                    <Td mono>{a.warranty}</Td>
                    <Td>{a.assignee ?? "—"}</Td>
                    <Td><StatusPill value={a.status} /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {current} of {pageCount}</span>
              <Pagination page={current} pageCount={pageCount} hrefFor={hrefFor} />
            </div>
          </>
        ) : status ? (
          <EmptyState
            title={`No capitalized asset reads ${status}`}
            description="Only assets with an acquisition cost appear here."
            actions={<ButtonLink href="/finance/assets">Clear filter</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="Nothing has been capitalized yet"
            description="An asset appears here once it carries an acquisition cost."
          />
        )}
      </div>
    </>
  );
}
```

- [x] **Step 3: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/finance/queries.ts "src/app/(app)/finance/assets/page.tsx"
git commit -m "feat(finance): capitalized asset register with value columns and a cost total"
```

**Check carefully:** `cost: { not: null }` inside a `Prisma.AssetWhereInput` — verify it compiles and behaves (Prisma treats `not: null` as IS NOT NULL). `_sum.cost` comes back as `Decimal | null`; the `Number()` conversion above is the only thing standing between a Decimal and a client component.

---

### Task 9: `/finance/activity` — the one cross-domain scoped feed

Entry criterion #6 and scope decision #9. Finance's log is the money trail: purchase-request events **and** asset cost changes. Because it spans two domains, this is the one scoped feed that shows `ActivityFeed`'s domain pill.

**Files:**
- Create: `src/app/(app)/finance/activity/page.tsx`
- Modify: `src/server/modules/finance/queries.ts` (append the where-builder)

- [x] **Step 1: Append the where-builder** (`src/server/modules/finance/queries.ts`)

```ts
/**
 * The money trail: everything that happened to a purchase request, plus any
 * asset edit that touched `cost`. The JSON path filter is what makes the second
 * half possible without a new column — if it turns out unsupported, fall back
 * to purchase-request-only and SAY SO rather than shipping a feed that claims
 * to show cost changes it can't see.
 */
export const financeActivityWhere: Prisma.AuditEntryWhereInput = {
  OR: [
    { entityType: "purchase-request" },
    { entityType: "asset", diff: { path: ["cost"], not: Prisma.DbNull } },
  ],
};
```

Add `Prisma` to the value imports at the top of the file (it currently imports `Prisma` as a type only — you need the runtime object for `Prisma.DbNull`): `import { Prisma, type AssetStatus } from "@prisma/client";`

- [x] **Step 2: Verify the JSON filter against the real database FIRST**

Before writing the page, prove the filter works. Throwaway scratchpad script (delete it; reseed after):

```ts
// count entries the filter returns, then compare against a manual scan
const viaFilter = await prisma.auditEntry.count({ where: financeActivityWhere });
const all = await prisma.auditEntry.findMany({ select: { entityType: true, diff: true } });
const manual = all.filter(
  (e) => e.entityType === "purchase-request" ||
    (e.entityType === "asset" && e.diff !== null && typeof e.diff === "object" && "cost" in (e.diff as object)),
).length;
console.log({ viaFilter, manual });
```

To have an asset-cost entry to find, first make one: update any asset's `cost` through the app's own `updateAsset` action path, or insert an `AuditEntry` with `entityType: "asset"` and `diff: { cost: { from: 1, to: 2 } }` directly for the purposes of the check (then reseed).

`viaFilter` must equal `manual`. **If it does not, stop**: fall back to `{ entityType: "purchase-request" }`, drop the domain pill, and report the discrepancy prominently.

- [x] **Step 3: The page** (`src/app/(app)/finance/activity/page.tsx`)

```tsx
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { entityLabels } from "@/server/modules/audit/queries";
import { financeActivityWhere } from "@/server/modules/finance/queries";
import { auditSentence } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed, actionDot, type ActivityItem } from "@/components/patterns/activity-feed";

const PAGE_SIZE = 50;

const DOMAIN: Record<string, string> = { "purchase-request": "PURCHASE", asset: "ASSET" };

export default async function FinanceActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const rawPage = Math.max(1, Number.parseInt(toSearchParams(await searchParams).get("page") ?? "1", 10) || 1);

  const total = await prisma.auditEntry.count({ where: financeActivityWhere });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(rawPage, pageCount); // unbounded ?page= must not become a huge OFFSET
  const entries = await prisma.auditEntry.findMany({
    where: financeActivityWhere,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const labels = await entityLabels(entries);

  const items: ActivityItem[] = entries.map((e) => ({
    id: e.id,
    sentence: auditSentence({
      actorLabel: e.actorLabel,
      action: e.action,
      diff: e.diff,
      entityLabel: labels.get(`${e.entityType}:${e.entityId}`)!.label,
    }),
    when: fmtDateTime(e.createdAt),
    actor: e.actorLabel,
    dotValue: actionDot(e.action),
    // the pill renders ONLY on cross-domain feeds — this is the one
    domain: DOMAIN[e.entityType],
  }));

  return (
    <>
      <PageHeader title="Finance activity" />
      <div className="flex flex-col gap-2">
        {items.length > 0 ? (
          <>
            <ActivityFeed items={items} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount}</span>
              <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `?page=${p}`} />
            </div>
          </>
        ) : (
          <EmptyState
            title="No money has moved yet"
            description="Purchase decisions and changes to an asset's cost both land here."
          />
        )}
      </div>
    </>
  );
}
```

- [x] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/finance/queries.ts "src/app/(app)/finance/activity/page.tsx"
git commit -m "feat(finance): the money trail — purchases plus asset cost changes, domain pill on"
```

---

### Task 10: e2e, the full battery, and close-out

**Files:**
- Create: `e2e/home-finance.spec.ts`
- Modify: this plan (check the boxes, add a close-out), `docs/HANDOVER.md`

- [x] **Step 1: Write the spec** (`e2e/home-finance.spec.ts`)

Follow `e2e/purchases.spec.ts` for the house helpers (`login`, `expectNoSeriousAxe`, the `beforeAll` reseed, a 1280px viewport for the sidebar). Cover:

1. **IT Home has no KPI tile row and leads with work** — signed in as `it@`, "Your shift" is the first card, and rows carry a kind chip (`SLA`/`EXEC`/`LEAVE`/`HIRE`/`DATA`). Assert the seeded `APR-2040` (breached SLA) appears and that the first row's chip is `SLA` — ordering by what breaks first is the requirement.
2. **Claims sit above the pool** — as `admin@` (who holds APR-2039 in the seed), "Claimed by you" lists it and appears BEFORE the Fleet card in the DOM.
3. **Clearing a row keeps it gone for the day** — click a row's clear button, assert it leaves, reload the page, assert it is still gone.
4. **Focus mode** — click Focus, assert Fleet/Age/Warranty/Jump-to are gone while Your shift and Claimed-by-you remain, reload and assert it survived (it is a cookie), then toggle back.
5. **A failing section degrades alone** — this is entry criterion #1 and the hardest to test honestly. Prove it at the unit level instead (already done in `src/lib/section.test.ts`) and in e2e assert only the positive: every expected section renders. **Do not fake a failure by breaking the database mid-suite** — say in your report that the FAILED card is covered by unit tests plus the controller's live check.
6. **Viewer Home** — no "Your shift" card at all, no clear buttons, the `READ-ONLY · VIEWER` badge, and Fleet/Age/Warranty still visible.
7. **Purchasing Home** — as `purchasing@`, the to-do list shows PR-0198 as having **come back** (not "waiting on IT"), and the stat row shows drafts/awaiting counts.
8. **Finance Home leads with money** — as `finance@`, the headline contains a peso amount and "oldest N day(s)"; assert the money line appears before the count stats in the DOM.
9. **`/finance/assets`** — the register lists capitalized assets with a cost column and a total; a `?status=` chip filters and `aria-current` follows; the tag links to the inventory record.
10. **`/finance/activity`** — renders entries with a domain pill.
11. **axe** on `/` (as IT, as viewer, and in Focus mode), `/finance/assets`, `/finance/activity`.

- [x] **Step 2: Run it**

```bash
npm run db:seed && npx playwright test e2e/home-finance.spec.ts --workers=1
```

Iterate until green. When a test fails, decide whether the test or the app is wrong before changing either, and say which you concluded. Never loosen an assertion about the absent KPI row, the viewer's missing shift card, the money-first Finance headline, or the Focus cookie surviving a reload — those ARE the requirements.

- [x] **Step 3: The full suite**

```bash
npm run db:seed && npx playwright test --workers=1
```

Expected: the 63 pre-existing tests plus yours, all green.

- [x] **Step 4: Commit**

```bash
git add e2e/home-finance.spec.ts
git commit -m "test(e2e): home dashboards, focus mode, dismissals, finance register and activity"
```

- [x] **Step 5: The full battery** (controller runs this with the dev server stopped)

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

- [x] **Step 6: Check off this plan and write the close-out**

Mark every `- [x]` as `- [x]` and append a **Close-out** section recording: the battery numbers, what the reviews caught, deviations from the plan, and anything deferred.

```bash
git add docs/superpowers/plans/2026-08-17-phase-6-finance-home.md
git commit -m "docs(plan): phase 6 checked off + close-out"
```

- [x] **Step 7: Advance the handover** (`docs/HANDOVER.md`)

Update the header line and §0 to point at **Phase 7 (Offboarding + repairs + policies)**; add a Phase 6 paragraph to §4; drop the Phase 6 bullet from §5; replace §6 with **Phase 7 entry criteria** (the 4-step wizard where each per-item decision creates its own `lifecycle.return` approval immediately, so a half-finished offboarding is still N correct records; `Missing` is first-class and a reason is required for anything other than Returned; Continue is blocked while any item is undecided; the repairs view is a saved filter over `?status=DEFECTIVE` with vendor fields and a **Down** column — no new enum; `/reservations`; `/admin/equipment-policies` where editing never touches existing assignments, which is why the audit entry records both slot lists); add any new gotcha to §7 and anything deferred to §8.

```bash
git add docs/HANDOVER.md
git commit -m "docs: handover advanced — phase 6 done, phase 7 entry criteria"
```

- [x] **Step 8: Finish the branch**

Use `superpowers:finishing-a-development-branch`: merge `phase-6-finance-home` into `main`, delete the branch, push.

---

## Self-review checklist (run before declaring the phase done)

- [x] Every entry criterion has a task: #1 → Task 2 (and every section uses it) · #2 → Tasks 3, 6, 7 · #3 → Tasks 4, 7 · #4 → Tasks 5, 7 · #5 → Task 7 · #6 → Tasks 8, 9 · #7 → grep for `Decimal` reaching a client component: `grep -rn "cost\|unitPrice" src/components` should return nothing that isn't a preformatted string · #8 → no new primitive was added to `src/components/ui/` (a `style` prop on `Card` is the one sanctioned exception).
- [x] `grep -rn "safeSection" src/app` — every Home section loads through it.
- [x] Viewer: no `Your shift`, no dismiss button, no action links that mutate.
- [x] Focus mode survives a reload (cookie, not state) and never appears in the URL.
- [x] The IT Home has **no KPI tile row** — if a `Stat` grid appeared at the top of the IT variant, it is wrong.

---

## Close-out (2026-08-17)

**Battery on merge:** `tsc` clean · `lint` clean · **284 unit tests** (was 255; +29 across `home` and `section`) · `next build` clean, both `/finance/*` routes emitted · **75 e2e** (was 63; +12 in `e2e/home-finance.spec.ts`), full suite green at `--workers=1` on a freshly started server.

### What the reviews and live checks caught

- **The plan's own `warrantyClusters` failed the test the plan wrote for it.** Fixed-width `Math.floor(days/7)` buckets put a pair 2 days apart (12 d and 14 d) either side of a boundary, so the very case the design is about — *two identical laptops expiring the same week* — didn't cluster. Replaced with pairwise "same model, within 7 days of each other" clustering, which also handles the already-expired (negative-days) case the bucket form got wrong.
- **The warranty runway looked backwards.** With no lower bound, a card titled "next 90 days" filled with kit that came off warranty up to 300 days ago. The window is now `[now, now+90d]`.
- **Two seeded fixtures didn't exercise their own design**, and were fixed rather than worked around: every asset shared one purchase date, so the five-bucket age histogram was a single bar and the `4y+` amber — the only bar that changes colour — could never render; and nothing at all expired inside the 90-day window, so the clustered pair never appeared. Purchase dates now span all five buckets, and two Dell Latitude 5420s expire 3 days apart.
- **The finance register's asset tags were dead ends.** `/finance/assets` is a register of asset records, but `/inventory` was gated to IT and purchasing, so every tag on the page redirected the one role the page exists for. Finance now reaches the record — and only the record: the IT-only `/secrets` rule still precedes it, which the tests now pin.
- **A leaver with nothing outstanding rendered "0 items still out · Collect equipment"** — true, and useless as a call to action. When the kit is already back the row now names the half of offboarding that remains.
- **The full e2e suite failed intermittently — and it wasn't the code.** A different set of pre-existing tests failed on each run, always as "clicked a link, heading never arrived", while the dev server's resident memory climbed from ~8.5GB to ~12.2GB. Every one passed in isolation, and the whole suite passed 75/75 once the server was restarted. Worth knowing before anyone debugs a phantom.

### Deviations from the plan as written

1. `warrantyClusters` uses pairwise proximity, not fixed buckets (above).
2. `Card` gained an optional `style` prop so the FAILED card's red border comes from the `--st-fault-border` token rather than a hard-coded class — the one sanctioned addition to the primitive layer this phase.
3. `dismissShiftRow` needed `as unknown as Prisma.InputJsonObject` to satisfy Prisma's `Json` input type from a typed interface; documented inline.
4. The e2e adds explicit 15s timeouts to assertions that immediately follow a click-driven navigation — locators and expected values unchanged.
5. `/finance/activity` needed one real purchase transition in its test before it has anything to show: the seed writes `asset` audit rows directly but `purchase-request` rows only ever come from real actions.

### Deferred (carried into the handover)

- **The Admin workspace has no Home of its own** — `ws === "admin"` falls through to the IT layout, so an admin sees SLA breaches and fleet composition under a Users/Webhooks/Flags sidebar. Defensible (an admin can act on all of it) but not purpose-built.
- **"Retry this section" refreshes the whole route**, not just its section — RSC has no per-section refetch. The effect the label promises is what happens; the cost is that the other sections re-run too.
- **Degradation is loader-level**, so a render-time bug inside a section still escapes to the route-level error boundary. A React error boundary per section would close that gap.
- `/finance/assets` has no free-text search or sortable headers (the inventory list has both), and no book-value column — depreciation is a policy nobody has stated.
- The shift's `DATA` rows key on `DATA:<assetId>`, which is unambiguous today only because an asset can't be both MISSING and DEPLOYED-without-a-holder. A third asset-keyed finding would need the key to encode the finding type.
