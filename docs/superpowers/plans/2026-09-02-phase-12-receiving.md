# Phase 12 — Purchase → asset receiving: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** A completed purchase request can be received — turning its approved units into real `Asset`
rows with generated tags — so the purchasing workflow no longer dead-ends at `COMPLETED`.

**Architecture:** One migration adds `Asset.purchaseUnitId`, which makes "has this unit been received?"
a derived count rather than a stored flag. A pure `receiving.ts` owns the arithmetic (outstanding
quantities, tag runs, prefix preference). A server module does the writes in one transaction with an
audit row per asset. A receive screen collects category, type, quantity and tags per unit; nothing is
written until submit.

**Tech Stack:** Next.js 15 Server Components + server actions · Prisma 6 · PostgreSQL 16 · vitest
(node env) · Playwright

**Spec:** `docs/superpowers/specs/2026-09-02-purchase-receiving-design.md` ·
**Branch:** `phase-12-receiving` (already cut, from `main` `59977e2`)

---

## Read this before Task 1

> ### AMENDED DURING EXECUTION — C-1, a contradiction in this plan's own constraints.
> **C-1. Task 2 told the implementer "migration only, no application code" AND "`tsc` clean before
> committing". Those are impossible together, and the implementer was right to stop rather than pick
> one.** Adding `NoteKind.RECEIVE` breaks `src/lib/purchase-thread.ts:16`, which holds
> `export const NOTE_CHIP: Record<NoteKind, string>` — an **exhaustive** map TypeScript now demands a
> `RECEIVE` entry for. Task 2's scope therefore includes that one line, because this project requires
> every task to end on a green commit and the migration is what breaks the map. Verified it is the
> **only** `Record<NoteKind, …>` in the codebase, so that is the whole blast radius — no second site
> is waiting to surprise a later task.
>
> **The lesson is not "widen the scope line".** It is that a schema change to an enum has a compile-time
> blast radius, and a plan that adds an enum member must go looking for the exhaustive maps over it
> *before* declaring the task's file list. **And the happy note: that map being exhaustive is precisely
> why this surfaced at compile time instead of rendering a blank chip in production the first time
> someone received a purchase.** It was not loosened to `Partial<Record<…>>` to silence the error.

**Conventions for every task:** stay on `phase-12-receiving`; run `npx tsc --noEmit && npm run lint`
before each commit; **NEVER run `npm run build` while a dev server is running** (they share `.next`).
DB via `docker compose up -d db`, seed via `npm run db:seed`. **Subagents must not start a dev server —
the controller owns the preview.** Commit style `feat(scope): …` / `fix(scope): …` / `docs(plan): …`,
trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

**Facts verified before this plan was written — do not re-derive, but do not silently contradict:**

1. **`Asset.purchaseRequestId` and `PurchaseRequest.assets` ALREADY EXIST** (since Phase 1) and are
   completely unused: nothing writes them, nothing reads them, `purchaseRequest` appears in no `.tsx`.
   Only the **unit**-level link is missing.
2. **`completeRequest` creates nothing.** It flips state, appends a `NoteEntry`, writes one audit row,
   emits `purchase_request.completed`. (Its line 179 `purchaseRequestId` is inside the *webhook
   payload* — it is not an asset create. This misled me once; do not repeat it.)
3. **`COMPLETED` and `CANCELLED` are terminal.** Receiving is an operation on a terminal request, not
   a new state transition. Do not add a state.
4. **Unit states are `PENDING | APPROVED | REJECTED | CANCELLED`.** Only `APPROVED` is receivable.
5. **The seed's one receivable fixture is `PR-0188`** — `COMPLETED`, one unit, "Dell Latitude 5420",
   `qty: 2`, unit state `APPROVED`. Every other seeded request is non-terminal or has non-`APPROVED`
   units. Reference it by `refNo`, **never by cuid** (the DB reseeds and cuids change every time).
6. **Prefix `LT`'s highest existing number is `0210`** in a fresh seed, so the first generated laptop
   tags are `BR-LT-0211` and `BR-LT-0212`. **Read the maximum in tests; never hardcode 0211** — a
   previous phase's e2e broke on exactly this class of assumption.
7. **`onDelete: Restrict` on the new column blocks nothing today — verified, not assumed.** The only
   code that deletes a unit is `draft-actions.ts:166`, reachable only while the request is `DRAFT`
   (guarded at line 152). A unit can only carry assets once its request is `COMPLETED`, which is
   terminal. So the two never meet. Do not weaken the constraint to `SetNull` or `Cascade` on the
   theory that it might break something.
8. **Existing patterns to copy, not invent:** server actions use `actionRole(...roles)` → `null` means
   refuse, `checkRate`, `zod` parse → `zodFieldErrors`, and return `ok()` / `conflict()` /
   `validationError()` / `forbidden()` / `rateLimited()` from `@/server/action-result`.
   `writeAudit(tx, { actorId, actorLabel, entityType, entityId, action, diff })`.
   `createAsset` in `src/server/modules/inventory/actions.ts` is the model for creating an asset and
   auditing it in one transaction.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/tag-key.ts` **(modify)** | Gains the single `TAG_SHAPE` every caller shares. |
| `src/lib/import-assets.ts` **(modify)** | Drops its private copy of the shape. |
| `src/server/modules/inventory/actions.ts` **(modify)** | Uses the shared shape in its zod schema. |
| `src/server/modules/inventory/queries.ts` **(modify)** | Uses the shared shape. |
| `prisma/migrations/<ts>_asset_purchase_unit/` **(create)** | `Asset.purchaseUnitId` + FK + index. |
| `prisma/schema.prisma` **(modify)** | The matching model fields. |
| `src/lib/receiving.ts` **(create)** | Pure arithmetic: outstanding, tag runs, prefix preference. |
| `src/lib/receiving.test.ts` **(create)** | Its unit tests. |
| `src/server/modules/purchases/receiving.ts` **(create)** | The read and the transactional write. |
| `src/app/(app)/purchases/[id]/receive/page.tsx` **(create)** | The receive screen. |
| `src/components/purchases/receive-form.tsx` **(create)** | The client form. |
| `src/app/(app)/purchases/[id]/page.tsx` **(modify)** | Receive action + per-unit received indicator. |
| `e2e/receiving.spec.ts` **(create)** | The end-to-end proof, including the write-nothing cases. |

---

### Task 1: One definition of the asset-tag shape (pure refactor)

**Files:**
- Modify: `src/lib/tag-key.ts`, `src/lib/import-assets.ts`,
  `src/server/modules/inventory/actions.ts`, `src/server/modules/inventory/queries.ts`

**Why this is first.** The shape `/^BR-[A-Z]{2}-\d{4}$/` is currently written out in **three** places
plus a comment describing it. Phase 12 needs it in a fourth, and this project treats a contract string
defined twice as a defect (§6a rules 26/37/38). Hoist it before adding a consumer, not after.

- [ ] **Step 1: Add the shared constant**

Append to `src/lib/tag-key.ts`:

```ts
/**
 * The asset tag contract: `BR-` then two uppercase letters then four digits,
 * e.g. `BR-LT-0148`. The two letters are a human convention (mostly the
 * category, sometimes the type — see the Phase 12 spec) and this regex does
 * not care which.
 *
 * ONE definition, deliberately. It was written out separately in
 * import-assets.ts, inventory/actions.ts and inventory/queries.ts, which is
 * three chances for them to disagree about what a tag is — and the four-digit
 * group is load-bearing for tag GENERATION, which cannot exceed 9999 without
 * producing a string the other three would reject.
 */
export const TAG_SHAPE = /^BR-[A-Z]{2}-\d{4}$/;
```

- [ ] **Step 2: Point `import-assets.ts` at it**

In `src/lib/import-assets.ts`, delete line 325 (`const TAG_SHAPE = /^BR-[A-Z]{2}-\d{4}$/;`) and add
`TAG_SHAPE` to its existing import from `./tag-key`. If it has no import from `./tag-key` yet, add:

```ts
import { TAG_SHAPE } from "./tag-key";
```

Leave the usage at line 474 untouched.

- [ ] **Step 3: Point the two server modules at it**

In `src/server/modules/inventory/actions.ts`, change the tag field of the create schema:

```ts
  tag: z.string().trim().toUpperCase().regex(TAG_SHAPE, "Format: BR-XX-0000"),
```

and add `TAG_SHAPE` to its imports from `@/lib/tag-key`. **Keep the message string exactly** — it is
user-facing.

In `src/server/modules/inventory/queries.ts`, change line 290:

```ts
  if (!TAG_SHAPE.test(tag)) return null;
```

and import `TAG_SHAPE` from `@/lib/tag-key`.

- [ ] **Step 4: Prove nothing changed**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

Expected: **797 passed / 47 files**, unchanged. This task alters no behaviour — the regex is
character-identical in all three places, which is why it is safe to share. If any test fails, the
three copies had *already* diverged and that is a finding worth reporting.

⚠️ **`TAG_SHAPE` has no `g` flag, so `.test()` is stateless and sharing one instance is safe.** If you
are tempted to add a flag, do not: a `g`-flagged regex carries `lastIndex` between calls and a shared
instance would then return different answers for the same input.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tag-key.ts src/lib/import-assets.ts src/server/modules/inventory/actions.ts src/server/modules/inventory/queries.ts
git commit -m "refactor(lib): one definition of the asset-tag shape, not three"
```

---

### Task 2: The migration — `Asset.purchaseUnitId`

**Files:**
- Create: `prisma/migrations/<timestamp>_asset_purchase_unit/migration.sql`
- Modify: `prisma/schema.prisma`, `src/lib/purchase-thread.ts`

**Why `purchase-thread.ts` is in scope (see C-1).** Adding a `NoteKind` member breaks
`NOTE_CHIP: Record<NoteKind, string>` at line 16, which is exhaustive by design. Add
`RECEIVE: "RECEIVED"` as its last entry — matching the map's convention, where every value is a
past-tense or state label in caps. It rides in this commit because the migration is what breaks it and
every task must end green.

- [ ] **Step 1: Write the schema fields**

In `prisma/schema.prisma`, add to `model Asset` (beside the existing `purchaseRequest` fields):

```prisma
  purchaseUnitId    String?
  purchaseUnit      PurchaseUnit?    @relation(fields: [purchaseUnitId], references: [id], onDelete: Restrict)
```

add the back-relation to `model PurchaseUnit`:

```prisma
  assets       Asset[]
```

and add a member to `enum NoteKind`:

```prisma
  RECEIVE
```

**Why a new note kind rather than reusing `COMMENT`.** Every purchase action already has its own kind
(`PURCHASE_NOTE_KIND` maps submit → `SUBMIT`, complete → `COMPLETE`, and so on), and the thread renders
them differently from a human comment. Receiving is a new kind of event on that thread, so filing it as
`COMMENT` would make an automated entry indistinguishable from something a person typed. There is **no**
`SYSTEM` member — the enum is `COMMENT | SUBMIT | IT_REVIEW | IT_REJECT | REQUEST_INFO | CANCEL |
COMPLETE` — so one has to be added.

- [ ] **Step 2: Write the migration by hand**

Create the directory using a real UTC timestamp, e.g. `20260902093000_asset_purchase_unit`, then
`migration.sql`:

```sql
ALTER TABLE "Asset" ADD COLUMN "purchaseUnitId" TEXT;

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_purchaseUnitId_fkey"
  FOREIGN KEY ("purchaseUnitId") REFERENCES "PurchaseUnit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Asset_purchaseUnitId_idx" ON "Asset"("purchaseUnitId");

ALTER TYPE "NoteKind" ADD VALUE 'RECEIVE';
```

⚠️ **PostgreSQL will not let a newly added enum value be USED in the same transaction that adds it.**
That is fine here — this migration only adds it, and the first write happens at runtime much later —
but do not be tempted to seed a `RECEIVE` note in the same migration.

Additive only — no backfill. Existing assets keep `NULL`, because nothing knows which purchase they
came from and inventing an answer would be worse than the gap.

- [ ] **Step 3: Apply and regenerate**

```bash
docker compose up -d db
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status
```

Expected: **9 migrations, none pending** (8 before this). `prisma generate` must also pick up the new
`NoteKind.RECEIVE` member — if `kind: "RECEIVE"` does not typecheck later, this step was skipped.

- [ ] **Step 4: Confirm the seed still runs**

```bash
npm run db:seed
```

Expected: "Seed complete." The seed does not set `purchaseUnitId`, and it should not start.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm run lint
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): link an asset to the purchase unit it arrived from"
```

---

### Task 3: `receiving.ts` — the arithmetic (TDD)

**Files:**
- Create: `src/lib/receiving.ts`
- Test: `src/lib/receiving.test.ts`

Pure: no Prisma, no React. Every rule that decides what gets written is testable without a database.

- [ ] **Step 1: Write the failing test**

Create `src/lib/receiving.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isFullyReceived, nextTags, outstanding, preferredPrefix } from "./receiving";
import { TAG_SHAPE } from "./tag-key";

describe("outstanding", () => {
  it("is what is left to receive", () => {
    expect(outstanding({ unitId: "u", ordered: 8, received: 0 })).toBe(8);
    expect(outstanding({ unitId: "u", ordered: 8, received: 5 })).toBe(3);
    expect(outstanding({ unitId: "u", ordered: 8, received: 8 })).toBe(0);
  });

  // Over-receipt should not produce a NEGATIVE outstanding that a caller then
  // renders as "-2 remaining" or uses to size an array.
  it("floors at zero when more arrived than was ordered", () => {
    expect(outstanding({ unitId: "u", ordered: 2, received: 5 })).toBe(0);
  });
});

describe("isFullyReceived", () => {
  it("is true at and beyond the ordered quantity", () => {
    expect(isFullyReceived({ unitId: "u", ordered: 2, received: 1 })).toBe(false);
    expect(isFullyReceived({ unitId: "u", ordered: 2, received: 2 })).toBe(true);
    expect(isFullyReceived({ unitId: "u", ordered: 2, received: 3 })).toBe(true);
  });

  // A zero-quantity unit is vacuously complete — it must not present a
  // Receive action forever.
  it("treats a zero-quantity unit as complete", () => {
    expect(isFullyReceived({ unitId: "u", ordered: 0, received: 0 })).toBe(true);
  });
});

describe("nextTags", () => {
  it("runs on from the highest existing number", () => {
    const r = nextTags("LT", 210, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tags).toEqual(["BR-LT-0211", "BR-LT-0212", "BR-LT-0213"]);
  });

  // A prefix with no assets yet must start somewhere sane, not at NaN.
  it("starts at 0001 for a prefix that has never been used", () => {
    const r = nextTags("ZZ", null, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tags).toEqual(["BR-ZZ-0001", "BR-ZZ-0002"]);
  });

  it("pads every tag to the shape the rest of the app validates", () => {
    const r = nextTags("MN", 8, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const t of r.tags) expect(TAG_SHAPE.test(t), t).toBe(true);
  });

  // THE boundary. Four digits means 9999 is the last legal tag, and a run that
  // crosses it must refuse where the number is minted — not produce
  // "BR-LT-10000" for TAG_SHAPE to reject three layers later.
  it("fills the last legal number exactly", () => {
    expect(nextTags("LT", 9998, 1)).toEqual({ ok: true, tags: ["BR-LT-9999"] });
  });

  it("refuses rather than wrapping past the four-digit ceiling", () => {
    expect(nextTags("LT", 9999, 1)).toEqual({ ok: false, reason: "overflow" });
    expect(nextTags("LT", 9998, 3)).toEqual({ ok: false, reason: "overflow" });
  });

  it("refuses a malformed prefix", () => {
    expect(nextTags("lt", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
    expect(nextTags("L", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
    expect(nextTags("LTX", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
    expect(nextTags("L1", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
  });

  it("refuses a count that cannot produce a run", () => {
    expect(nextTags("LT", 1, 0)).toEqual({ ok: false, reason: "bad-count" });
    expect(nextTags("LT", 1, -1)).toEqual({ ok: false, reason: "bad-count" });
    expect(nextTags("LT", 1, 1.5)).toEqual({ ok: false, reason: "bad-count" });
  });
});

describe("preferredPrefix", () => {
  it("picks the most-used prefix", () => {
    expect(preferredPrefix([{ prefix: "LT", n: 12 }, { prefix: "MN", n: 4 }])).toBe("LT");
  });

  // Deterministic on a tie, so the form does not offer a different default on
  // each render for the same data.
  it("breaks a tie alphabetically rather than by input order", () => {
    expect(preferredPrefix([{ prefix: "MN", n: 3 }, { prefix: "DK", n: 3 }])).toBe("DK");
  });

  it("has no opinion when there is nothing to learn from", () => {
    expect(preferredPrefix([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/lib/receiving.test.ts
```

Expected: FAIL — `Failed to resolve import "./receiving"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/receiving.ts`:

```ts
import { TAG_SHAPE } from "./tag-key";

/**
 * Receiving arithmetic. Pure by design: these are the rules that decide what
 * gets written into the asset register, so they are testable without a
 * database.
 *
 * `received` is always a COUNT OF ROWS (assets pointing at the unit), never a
 * stored flag — see the Phase 12 spec, decision 4. That is what makes partial
 * receipts and idempotency fall out for free instead of needing bookkeeping.
 */
export interface UnitReceipt {
  unitId: string;
  ordered: number;
  received: number;
}

/** Floors at zero: an over-receipt must not yield a negative that a caller
 *  renders as "-2 remaining" or uses to size an array. */
export function outstanding(r: UnitReceipt): number {
  return Math.max(0, r.ordered - r.received);
}

/** `>=`, not `===`: an over-received unit is finished, not perpetually open.
 *  A zero-quantity unit is vacuously complete. */
export function isFullyReceived(r: UnitReceipt): boolean {
  return r.received >= r.ordered;
}

const PREFIX_SHAPE = /^[A-Z]{2}$/;

/** Four digits in TAG_SHAPE means 9999 is the last legal number. */
const MAX_TAG_NUMBER = 9999;

export type TagRun =
  | { ok: true; tags: string[] }
  | { ok: false; reason: "bad-prefix" | "bad-count" | "overflow" };

/**
 * The next `count` tags for `prefix`, starting after `highest`.
 *
 * A discriminated union rather than a throw or a truncated array: the caller
 * renders these into form fields, and a refusal it can display beats an
 * exception it has to catch. `highest` is null when no asset uses the prefix
 * yet — the run then starts at 1, not at NaN.
 *
 * Refuses on overflow rather than emitting `BR-LT-10000`, which TAG_SHAPE
 * would reject at the server action three layers later. Fail where the number
 * is minted.
 */
export function nextTags(prefix: string, highest: number | null, count: number): TagRun {
  if (!PREFIX_SHAPE.test(prefix)) return { ok: false, reason: "bad-prefix" };
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: "bad-count" };

  const start = (highest ?? 0) + 1;
  if (start + count - 1 > MAX_TAG_NUMBER) return { ok: false, reason: "overflow" };

  const tags: string[] = [];
  for (let n = start; n < start + count; n++) {
    tags.push(`BR-${prefix}-${String(n).padStart(4, "0")}`);
  }
  return { ok: true, tags };
}

/**
 * Which two-letter prefix the assets in a given group already use.
 *
 * There is no rule to compute this from a category or type name — measured on
 * live data, the prefix follows the category five times out of six and the
 * type in the sixth ("Peripheral" holding a Keyboard tagged KB). So it is
 * LEARNED from existing rows rather than configured. Ties break
 * alphabetically so a form does not offer a different default on each render.
 */
export function preferredPrefix(counts: Array<{ prefix: string; n: number }>): string | null {
  if (counts.length === 0) return null;
  return [...counts].sort((a, b) => b.n - a.n || a.prefix.localeCompare(b.prefix))[0].prefix;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/receiving.test.ts && npm run test
```

Expected: all green in the new file; full suite **797 + the new file's count**.

- [ ] **Step 5: Mutation-test the two rules that guard writes**

Report the actual failure output for each.

- Change `Math.max(0, ...)` to plain subtraction → the over-receipt test must fail.
- Change `start + count - 1 > MAX_TAG_NUMBER` to `start > MAX_TAG_NUMBER` → the `9998, 3` overflow
  test must fail (this is the off-by-one that would emit `BR-LT-10000`).
- Change `r.received >= r.ordered` to `===` → the over-received test must fail.
- Change the tie-break to `b.n - a.n` only → the `preferredPrefix` tie test must fail.

Revert each after observing it. A green suite under any of these means that test proves nothing.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/receiving.ts src/lib/receiving.test.ts
git commit -m "feat(receiving): the arithmetic, with a four-digit ceiling that refuses"
```

---

### Task 4: The server module — read the units, write the assets

**Files:**
- Create: `src/server/modules/purchases/receiving.ts`

- [ ] **Step 1: Write the module**

Create `src/server/modules/purchases/receiving.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { TAG_SHAPE } from "@/lib/tag-key";
import { isFullyReceived, outstanding, type UnitReceipt } from "@/lib/receiving";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const lineSchema = z.object({
  unitId: z.string().min(1),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  // One tag per asset to create. The COUNT is the received quantity — there is
  // no separate qty field, so the two can never disagree.
  tags: z.array(z.string().trim().toUpperCase().regex(TAG_SHAPE, "Format: BR-XX-0000")).min(1),
  serials: z.array(z.string().trim().max(120)).optional(),
});

const receiveSchema = z.object({
  requestId: z.string().min(1),
  lines: z.array(lineSchema).min(1, "Nothing to receive"),
});

interface Received {
  refNo: string;
  created: number;
}

/**
 * Units of a request with how many assets already point at each.
 *
 * `received` is a COUNT, never a flag (spec decision 4). Only APPROVED units
 * are returned: a REJECTED or CANCELLED unit was not bought, and a PENDING one
 * on a COMPLETED request is a data inconsistency rather than something to
 * receive.
 */
export async function receivableUnits(requestId: string): Promise<UnitReceipt[]> {
  const units = await prisma.purchaseUnit.findMany({
    where: { requestId, state: "APPROVED" },
    select: { id: true, qty: true, _count: { select: { assets: true } } },
    orderBy: { createdAt: "asc" },
  });
  return units.map((u) => ({ unitId: u.id, ordered: u.qty, received: u._count.assets }));
}

/** The prefixes already in use by assets of a given category, most-used first
 *  — the raw material for `preferredPrefix`. Grouped in SQL rather than pulled
 *  into memory, because this runs on every render of the receive screen. */
export async function prefixCountsForCategory(
  categoryId: string,
): Promise<Array<{ prefix: string; n: number }>> {
  const rows = await prisma.$queryRaw<Array<{ prefix: string; n: bigint }>>`
    SELECT substring("tag", 4, 2) AS prefix, count(*) AS n
    FROM "Asset"
    WHERE "categoryId" = ${categoryId}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
  `;
  return rows.map((r) => ({ prefix: r.prefix, n: Number(r.n) }));
}

/** The highest number currently used by a prefix, or null if unused. */
export async function highestTagNumber(prefix: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ max: string | null }>>`
    SELECT max(substring("tag", 7, 4)) AS max
    FROM "Asset"
    WHERE substring("tag", 4, 2) = ${prefix}
  `;
  const raw = rows[0]?.max;
  return raw == null ? null : Number(raw);
}

export async function receiveUnits(input: unknown): Promise<ActionResult<Received>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden("Only IT can receive a purchase.");
  if (!(await checkRate(`receive:${user.id}`))) return rateLimited();

  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  // A duplicate WITHIN one submission would otherwise reach the database and
  // surface as a P2002 that reads like a concurrent receipt. Catch it here so
  // the message names the real cause.
  const all = d.lines.flatMap((l) => l.tags);
  const dupe = all.find((t, i) => all.indexOf(t) !== i);
  if (dupe) return conflict(`${dupe} appears twice in this receipt.`);

  let done: Received | null = null;
  let failure: ActionResult<Received> | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const req = await tx.purchaseRequest.findUnique({
        where: { id: d.requestId },
        select: { id: true, refNo: true, state: true },
      });
      if (!req) {
        failure = validationError({ requestId: "Unknown request" });
        return;
      }
      if (req.state !== "COMPLETED") {
        failure = conflict(`${req.refNo} is ${req.state.toLowerCase()} — only a completed request can be received.`);
        return;
      }

      let created = 0;
      for (const line of d.lines) {
        const unit = await tx.purchaseUnit.findUnique({
          where: { id: line.unitId },
          select: {
            id: true, requestId: true, qty: true, state: true, description: true,
            unitPrice: true, _count: { select: { assets: true } },
          },
        });
        if (!unit || unit.requestId !== req.id) {
          failure = validationError({ lines: "A unit does not belong to this request" });
          return;
        }
        if (unit.state !== "APPROVED") {
          failure = conflict(`"${unit.description}" is ${unit.state.toLowerCase()} — it was not purchased.`);
          return;
        }

        // Re-read INSIDE the transaction: the screen was rendered from a
        // snapshot, and someone else may have received in between.
        const receipt: UnitReceipt = { unitId: unit.id, ordered: unit.qty, received: unit._count.assets };
        if (isFullyReceived(receipt)) {
          failure = conflict(`"${unit.description}" is already fully received.`);
          return;
        }
        if (line.tags.length > outstanding(receipt)) {
          failure = conflict(
            `"${unit.description}" has ${outstanding(receipt)} outstanding — cannot receive ${line.tags.length}.`,
          );
          return;
        }

        for (const [i, tag] of line.tags.entries()) {
          const asset = await tx.asset.create({
            data: {
              tag,
              model: unit.description,
              serial: line.serials?.[i]?.trim() || null,
              categoryId: line.categoryId,
              typeId: line.typeId || null,
              status: "SPARE",
              cost: unit.unitPrice ?? null,
              purchaseRequestId: req.id,
              purchaseUnitId: unit.id,
            },
          });
          created++;
          await writeAudit(tx, {
            actorId: user.id,
            actorLabel: user.name,
            entityType: "asset",
            entityId: asset.id,
            action: "receive",
            diff: {
              tag: { from: null, to: asset.tag },
              status: { from: null, to: "SPARE" },
              purchaseRequest: { from: null, to: req.refNo },
            },
          });
        }
      }

      // One note for the whole receipt, not one per asset: the thread is a
      // human conversation about the request, and twelve identical lines would
      // bury it.
      await tx.noteEntry.create({
        data: {
          requestId: req.id,
          authorId: user.id,
          kind: "RECEIVE",
          text: `Received ${created} asset${created === 1 ? "" : "s"}.`,
        },
      });

      done = { refNo: req.refNo, created };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Asset.tag is @unique, so a concurrent receipt collides here rather
      // than silently duplicating. Loud is the whole point.
      return conflict("One of those tags was just taken. Reload and try again.");
    }
    throw e;
  }

  if (failure) return failure;
  revalidatePath(`/purchases/${d.requestId}`);
  revalidatePath(`/purchases/${d.requestId}/receive`);
  revalidatePath("/inventory");
  return ok(done!);
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: both clean. Nothing imports this module yet.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/purchases/receiving.ts
git commit -m "feat(receiving): read outstanding units, write assets in one transaction"
```

---

### Task 5: The receive screen

**Files:**
- Create: `src/app/(app)/purchases/[id]/receive/page.tsx`
- Create: `src/components/purchases/receive-form.tsx`

**Read first:** `src/app/(app)/purchases/[id]/page.tsx` for how this app lays out a purchase surface,
and `src/app/(app)/inventory/new/` for how a create form binds a server action and renders field
errors. Follow those; do not invent a third style.

- [ ] **Step 1: Write the page (server component)**

Create `src/app/(app)/purchases/[id]/receive/page.tsx`. It must:

1. `await requireRole("admin", "it_staff")`.
2. Load the request (`id`, `refNo`, `state`) and `notFound()` if absent.
3. If `state !== "COMPLETED"`, render a `PageHeader` plus a `Banner tone="attention"` saying the
   request is not completed yet, with a `ButtonLink` back to the request. **Do not render the form.**
4. Call `receivableUnits(id)`. If every unit `isFullyReceived`, render a `Banner tone="neutral"`
   saying everything has been received, with a link back. **Do not render the form.**
5. Load all `AssetCategory` rows (`id`, `name`) and all `AssetType` rows (`id`, `name`, `categoryId`)
   for the selects, and each unit's `description`, `specs`, `qty`, `unitPrice`.
6. Render `<ReceiveForm …/>` with the outstanding units, the categories, the types, and the request's
   `id` and `refNo`.

Every branch above is a real state the operator can reach by clicking Receive on a request someone
else just finished — so each gets a surface, not a redirect.

- [ ] **Step 2: Write the form (client component)**

Create `src/components/purchases/receive-form.tsx`, `"use client"`. Per outstanding unit:

- the unit's `description`, `specs` and `N outstanding of M` as static text;
- a category `<select>` (required);
- a type `<select>`, filtered to the chosen category, optional;
- a quantity `<input type="number">` defaulting to `outstanding`, `min={1}` `max={outstanding}`;
- a prefix `<input>` of two characters, defaulted from `preferredPrefix` for the chosen category;
- one tag `<input>` per quantity, pre-filled from `nextTags(prefix, highest, qty)` and editable;
- one optional serial `<input>` per quantity.

When category, prefix or quantity changes, recompute the tag inputs from `nextTags`. If `nextTags`
returns `{ ok: false }`, show its reason and **disable submit** — `bad-prefix` reads "Prefix must be two
capital letters", `overflow` reads "That run passes BR-XX-9999 — receive fewer, or use another prefix",
`bad-count` reads "Quantity must be at least 1".

Submit calls `receiveUnits` with `{ requestId, lines }` and renders the returned field errors or
conflict message inline. On success, navigate to `/purchases/<id>`.

**The `highest` value must come from the server** — pass a map of prefix → highest number as a prop,
computed with `highestTagNumber` for the prefixes the categories suggest. The client must not guess it,
and it is only a starting point: the server re-validates every tag and the unique index is the real
guard.

- [ ] **Step 3: Typecheck, lint, and view it**

```bash
npx tsc --noEmit && npm run lint
```

Then ask the controller to open `/purchases/<PR-0188's id>/receive` in the preview and confirm: two
outstanding, tags defaulting to `BR-LT-0211` and `BR-LT-0212`, and submit disabled until a category is
chosen. **Do not start a dev server yourself.**

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/purchases/[id]/receive/page.tsx" src/components/purchases/receive-form.tsx
git commit -m "feat(receiving): the receive screen, one tag field per asset"
```

---

### Task 6: The request page — the action and the indicator

**Files:**
- Modify: `src/app/(app)/purchases/[id]/page.tsx`

- [ ] **Step 1: Add the received indicator and the action**

Load `receivableUnits(id)` on the request page. Then:

- For a `COMPLETED` request with at least one unit not fully received, render a **Receive items**
  `ButtonLink` to `/purchases/<id>/receive`, visible only to `admin` and `it_staff` (the page already
  knows the viewer's role — reuse that, do not re-fetch).
- Against each `APPROVED` unit, render `received of ordered received` — e.g. `1 of 2 received` — derived
  from the counts, never from a stored flag.
- When every unit is fully received, show that state and **no** Receive action.

- [ ] **Step 2: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add "src/app/(app)/purchases/[id]/page.tsx"
git commit -m "feat(purchases): a completed request offers receiving, and shows what arrived"
```

---

### Task 7: `e2e/receiving.spec.ts`

**Files:**
- Create: `e2e/receiving.spec.ts`

Model it on `e2e/purchases.spec.ts` for the login helper and reseed `beforeAll`.

- [ ] **Step 1: Write the spec**

Cover exactly these, and **reference `PR-0188` by `refNo`, never by cuid**:

1. **A partial receipt writes exactly what it said.** Receive 1 of PR-0188's 2. Assert via Prisma that
   one new asset exists with the expected tag, `status: "SPARE"`, the chosen `categoryId`, **and both
   `purchaseRequestId` and `purchaseUnitId` set**. Assert the request page then reads `1 of 2 received`.
   **Read the highest `LT` number from the database first and derive the expected tag** — do not
   hardcode `BR-LT-0211`.
2. **The remainder completes it.** Receive the second. Assert the unit reads fully received and the
   **Receive items action is gone**.
3. **An over-receipt is refused and writes NOTHING.** Attempt 3 against a qty-2 unit. Assert the
   conflict message and a **Prisma count delta of zero** — the absence of a toast proves nothing.
4. **A duplicate tag is refused and writes NOTHING.** Submit a tag that already exists. Assert the
   conflict and a zero count delta.
5. **An audit row exists per created asset**, with `action: "receive"` and the asset's id.
6. **`viewer` and `finance_staff` cannot reach `/purchases/<id>/receive`** — assert the redirect, and
   assert it for BOTH roles rather than assuming one implies the other.

- [ ] **Step 2: Run it and read the count**

```bash
npx playwright test e2e/receiving.spec.ts --workers=1 --global-timeout=600000
```

A run that hits `--global-timeout` prints "N did not run" and its tail still reads like a pass. **Read
the number.**

- [ ] **Step 3: Prove the write-nothing assertions are not inert**

Temporarily weaken the over-receipt guard (`line.tags.length > outstanding(receipt)` → `> 999`), re-run
test 3, and **confirm it fails on the COUNT, not just the message**. Revert. Report the output. A
write-nothing test that passes against a broken guard is worse than no test.

- [ ] **Step 4: Commit**

```bash
git add e2e/receiving.spec.ts
git commit -m "test(e2e): receiving writes exactly what it says, or nothing at all"
```

---

### Task 8: Battery and close-out

- [ ] **Step 1: The battery**

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
docker compose --profile prod build
```

- [ ] **Step 2: Clear `.next`, then the e2e in five parts**

`build` and `next dev` share `.next` and their outputs are incompatible, so clear it and expect a cold
compile.

```bash
rm -rf .next
npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/receiving.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/scanner.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```

⚠️ **This branch is off `main`, which does NOT have Phase 11.** So `labels.spec.ts` here is the Phase 10
version (9 tests, no QR) and `scanner.spec.ts` is present. The `main` baseline is **51 · 55 · 34 · 6**
across four parts; re-balance and **write down what you actually used and got**.

⚠️ **`e2e/purchases.spec.ts` is the one to watch.** It exercises the request page this phase modifies,
including `PR-0198`'s bounce-back thread. A failure there means Task 6 changed more than the indicator.

⚠️ **The axe sweep's route table is a HARDCODED list that nothing keeps in sync** — a new page route
does not fail it, it silently stops being scanned. Add `/purchases/<id>/receive` to the it_staff group
(it is `admin`/`it_staff` only) using a `refNo` lookup, not a cuid.

- [ ] **Step 3: Amend this plan** with `C-1` onward — Phase 10 used `A-`, Phase 11 `B-`, so this phase
uses `C-` and the three stay distinguishable.

- [ ] **Step 4: Update `docs/HANDOVER.md`** — the header, §0, §4 (a Phase 12 paragraph), §6a (this
phase's rules) and §8, which currently describes this gap as unbuilt and must stop.

- [ ] **Step 5: Finish the branch.** `superpowers:finishing-a-development-branch`. **Merging and pushing
are the user's decisions** — present the options and wait. Note that Phase 11 is also unmerged, so the
merge question now covers two branches.

---

## Out of scope, deliberately

- **No new purchase state.** `COMPLETED` stays terminal.
- **No approval for receiving**, per spec decision 5.
- **No category inference** from unit descriptions, per spec decision 1.
- **No `tagPrefix` columns or admin UI**, per spec decision 3.
- **No backfill** of `purchaseUnitId` on existing assets.
- **No change to the label sheet.** It already accepts `?ids=`.
