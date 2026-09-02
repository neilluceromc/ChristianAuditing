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

> ### AMENDED DURING EXECUTION — C-1 through C-6. Five were defects in this plan; C-5 is a change of PREMISE from the user that replaced Tasks 5-7. C-4 would have corrupted the asset register and no test in the plan as written could have caught it.
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
> someone received a purchase.** It was not loosened to `Partial<Record<…>>` to silence the error.>
> **C-2. Task 3's given code imported `TAG_SHAPE` and never used it, so it failed
> `eslint --max-warnings 0`.** The import was referenced only inside two doc comments. Caught by the
> implementer, who stopped rather than deleting it silently — right call, because the obvious fix hides
> a worse problem.
>
> **The worse problem: `MAX_TAG_NUMBER = 9999` and `TAG_SHAPE`'s `\d{4}` are two encodings of one
> constraint, in two files.** That is precisely the duplication **Task 1 existed to remove** — the plan
> hoisted the regex to a single definition and then, one task later, wrote its arithmetic twin as a
> separate literal. Deleting the dead import alone would have left that standing behind a comment, and
> comments do not fail.
>
> Resolved three ways rather than one: the dead import is gone, the comment on `MAX_TAG_NUMBER` now
> states that it is the arithmetic face of `\d{4}` and that the two must move together, and a test
> **pins them to each other** — the highest number the generator will mint must satisfy `TAG_SHAPE`,
> and one past it must not. Widen the regex to five digits and the generator silently keeps refusing at
> 9999; narrow it to three and it mints tags the rest of the app rejects. The pinning test catches both
> of those.
>
> **CORRECTION, and it was the implementer's, not mine.** I predicted the pinning test would ALSO catch
> the `start + count - 1 > MAX` → `start > MAX` off-by-one, making mutation 2 fail two tests. It fails
> **one**. At `count: 1` the two expressions evaluate to the same number, so the mutation is simply
> unobservable at that call site. The tests are right; my arithmetic was wrong. **The off-by-one is
> covered by the overflow test's `count: 3` case and by nothing else** — which the implementer
> correctly described as coverage that "happens to" exist. Incidental coverage is one tidy-up away from
> gone, so that test now carries a comment explaining why both of its cases are load-bearing, why the
> `count > 1` case is the only guard against the off-by-one, and that collapsing them would silently
> delete the only thing standing between the generator and `BR-LT-10000`.
>
> **Rejected:** widening the pinning test to also assert a run ending past the ceiling. That is exactly
> what the overflow test already asserts — it would be duplicate coverage dressed as a stronger test,
> and it would blur what the pinning test is for.>
> **C-3. Three signature errors in Task 4's given code, found by the controller before dispatch rather
> than by an implementer after.** All three would have failed `tsc` — so they were survivable — but a
> plan that says "implement as written" and then does not compile wastes the implementer's turn and
> teaches it to distrust the text.
>
> - `checkRate` takes a **bare userId** and returns `{ allowed, retryAfterSec }`, not a boolean. The
>   plan passed a composite key (``receive:${user.id}``) and treated the result as truthy. Corrected to
>   the two-line form `purchases/actions.ts:74-75` already uses.
> - `rateLimited` requires `retryAfterSec`. The plan called it with no argument.
> - `forbidden` takes **no arguments** — it is `(): ActionResult<never>`. The plan passed it a message.
>
> **The pattern across C-1, C-2 and C-3 is one thing, not three:** every defect came from writing code
> against a remembered API instead of a read one. The fix is not more care — it is reading the signature
> of every helper a task calls before writing the call, which is what caught these three.>
> **C-4. Task 4's transaction did NOT guarantee all-or-nothing, which was the one invariant that task
> said mattered most. This is the worst defect in the plan and it would have corrupted the asset
> register.** Found by the implementer, who committed the code as written and then reported it rather
> than either papering over it or silently fixing it.
>
> **The mechanism.** Prisma commits an interactive transaction when the callback **resolves** and rolls
> back only when it **throws**. Every refusal in the drafted loop was `failure = conflict(...); return;` —
> a plain return. The loop validated *and wrote* per line, so a second line's refusal fired **after the
> first line had already created assets and audit rows**. The callback then resolved, Prisma committed,
> and the caller was handed a failure. **An operator would see an error toast while real assets with
> generated tags sat permanently in the register** — precisely the "partial receipt that half-wrote"
> the task text forbade.
>
> **Why it was easy to miss, and this is the useful part:** `runTransition` in the same directory uses the
> identical return-don't-throw shape and is **safe**, because every one of its refusals precedes its
> single write. The pattern is not wrong; **interleaving it with writes in a loop is.** The implementer
> drew that distinction unprompted and it is the whole diagnosis.
>
> **Fixed structurally, not with a sentinel throw.** Two passes: validate every line, write nothing;
> then write, with no refusal paths left below the first write. A sentinel would have worked but would
> leave correctness depending on someone remembering to throw rather than return, forever. Two passes
> make it so that breaking it requires *moving a write above a validation*.
>
> **It also closed a second bug neither of us had named:** two lines naming the same unit could each
> clear an independent `outstanding` check while together exceeding the order. Pass 1 now aggregates
> requested counts per unit before validating.
>
> **And a testing gap that is mine, recorded here because it is the reason this survived to
> implementation: `PR-0188` HAS EXACTLY ONE UNIT.** Every e2e case Task 7 originally specified sends a
> single line, so **no test in this plan could ever have reached the multi-line failure path.** A green
> suite would have proved nothing about the invariant the task called most important. Task 7 now
> requires a purpose-built two-unit `COMPLETED` fixture and an explicit rollback assertion.
>
> **This is the fourth defect in this plan** (after the contradictory scope line, the nonexistent
> `SYSTEM` enum member, and the deliberately-wrong test expectation I removed at self-review). All four
> were mine, none would have failed a test suite as written, and three of the four were caught only
> because an implementer refused to paper over something odd. **That ratio is the argument for the
> review loop, and for telling implementers that objecting is part of the job.**
>
> **C-5. THE ENTRY POINT WAS WRONG. Tasks 5 and 6 are replaced.** On 2026-09-02 the user corrected the
> premise: *"we are not doing purchase request but these assets are already purchased and we are
> registering them to our system."*
>
> **What that invalidated.** Tasks 5–6 gated the tag generator behind a `COMPLETED` `PurchaseRequest`.
> The seed has exactly one such request and in real use there would be none, so those tasks would have
> built a screen **nobody could open**. The machinery from Tasks 1–4 was right; only its doorway was
> wrong.
>
> **What was already true and nobody had said.** Registering already-purchased assets **already works** —
> `/inventory/import` shipped in Phase 9 and takes 13 columns (tag, model, serial, category, type,
> status, assignee, employee no, purchased, cost, warranty, vendor, notes), which is exactly "convert
> the existing Excel records". **What it cannot do is number them:** `tag` is a *required* column, so
> every tag must be typed by hand. The Admin meeting explicitly asked for **automated item numbering**,
> and that is precisely what Tasks 1–4 built. So Phase 12's value was never the purchase-request path —
> it was the numbering, and that survives the retarget intact.
>
> **New Task 5:** `/inventory/register` — a batch registration screen with **no purchase request
> required**. Category, type, quantity, a learned prefix, auto-numbered editable tags, optional serials.
> Linking a purchase request becomes **optional metadata**, not a gate, so the path still works if one
> ever exists. **New Task 6:** the Finance confirmation flag and action (below).
>
> **The user also added a two-stage requirement:** *"IT will register the assets then finance will
> confirm if the details are correct"*, with separate Finance tabs for IT and for Purchasing
> (office/pantry supplies).
>
> **Confirmation is NOT an `AssetStatus`, and this is the decision worth defending.** Those eight values
> are custody and physical states — `DEPLOYED`, `SPARE`, `DEFECTIVE`, `DONATED`, `TEMPORARY`, `BUYOUT`,
> `DISPOSE`, `MISSING`. An asset can be `SPARE` **and** unconfirmed simultaneously, so confirmation is an
> **orthogonal dimension**. Adding an `UNCONFIRMED` status would make "confirmed" unrepresentable for
> every asset that is not spare, and would silently break `statusFamily`, the status chips, the facet
> counts and `buildAssetWhere` — all of which treat the enum as a partition.
>
> **Nor does it ride the approval queue.** All five `ApprovalType` values are lifecycle changes to an
> asset that already exists (`lifecycle.assign`, `.replace`, `.transfer`, `.return`, `.change-status`).
> Finance confirming that *registration details are accurate* is data verification, not approval of a
> change — a different question, a different audience, and a different failure mode.
>
> **So: `Asset.financeConfirmedAt` + `financeConfirmedById`, nullable, plus a Finance-only action.**
> Null means awaiting confirmation. That is one migration, one action, one filter — and it means nothing
> ships unconfirmable.
>
> **DEFERRED to Phase 13, deliberately: the Finance TABS.** "Different tabs, IT and Purchasing" **is the
> asset-class dimension** (§9 item A). Building tabs now would mean inventing a source/department axis
> that Phase 13 then has to reconcile or replace — the precise mistake §9 warns about, where B and D
> each invent their own answer because A had not landed yet. The confirmation flag ships now because it
> is orthogonal to class; the tabs wait because they *are* class.
>
> **C-6. Task 5 told the implementer to reuse `toCost`, and it cannot be reused.** Verified after the
> implementer flagged it: `src/server/modules/inventory/actions.ts` begins with a module-level
> `"use server"`, and `toCost` is a **non-exported synchronous arrow** at line 174. Next.js requires
> every top-level export from a `"use server"` module to be an **async function**, so exporting it would
> break the build — and its signature `(c: number | "" | undefined)` does not match a
> `z.string().optional()` field regardless.
>
> The plan reached for DRY (rules 26/37/38, the same instinct that justified Task 1) without checking
> whether the thing could be shared at all. **The implementer kept the string pass-through, commented why,
> and flagged that `toCost`/`toDate` would first have to move to a non-`"use server"` lib module to be
> shareable.** That is the correct answer and the correct place to stop.
>
> **The lesson generalises past this helper: a `"use server"` module is not a library.** Anything in one is
> reachable only as an async server action, so "extract the shared helper" is not always available — and
> a plan that assumes it is will send an implementer into a build error. Check the directive before
> proposing reuse across that boundary. Worth noting the cost was near zero here because the implementer
> stopped; the same instruction followed literally would have failed the build.

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
| — | **Replaced by C-5.** The receive screen and its form are not built: registration needs no purchase request. |
| `src/app/(app)/inventory/register/page.tsx` **(create)** | Batch registration — no purchase request required. |
| `src/components/inventory/register-form.tsx` **(create)** | The client form: quantity, learned prefix, editable tags. |
| `src/lib/workspaces.ts` **(modify)** | One `PATH_RULES` entry, ABOVE the general `/inventory` rule. |
| `src/app/(app)/inventory/[id]/layout.tsx` **(modify)** | The Finance confirmation pill and Confirm action. |
| `e2e/receiving.spec.ts` **(create)** | Registration, confirmation and receiving — four write-nothing cases. |

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
  if (!user) return forbidden();
  // checkRate takes a bare userId and returns { allowed, retryAfterSec } — it
  // is NOT a boolean, and the kind defaults to "mutation". This is the exact
  // shape purchases/actions.ts:74-75 uses; do not invent a composite key.
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

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

### Task 5: `/inventory/register` — batch registration with auto-numbered tags

**Files:**
- Create: `src/app/(app)/inventory/register/page.tsx`
- Create: `src/components/inventory/register-form.tsx`
- Modify: `src/lib/workspaces.ts` (one `PATH_RULES` entry)
- Modify: `src/server/modules/purchases/receiving.ts` (make the purchase request optional)

**Replaces the original Task 5 — see amendment C-5.** No purchase request is required or expected.

⚠️ **`PATH_RULES` is first-match-wins and this route MUST precede the general `/inventory` rule**, which
admits purchasing and finance. Registration is IT's job, so it needs
`{ test: /^\/inventory\/register(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] }` placed
beside the existing `/inventory/import` and `/inventory/labels` entries — all three share that shape and
that reason. Three separate comments in that file warn about ordering; a mis-ordered rule has already
caused a defect here.

- [ ] **Step 1: Make the purchase request optional in the server module**

`receiveUnits` currently requires a `requestId` and refuses anything that is not `COMPLETED`.
Registration has no request at all. Add a sibling action rather than loosening the existing one — the
receiving path's `COMPLETED` guard is correct for receiving and must not be weakened:

```ts
const registerSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  model: z.string().trim().min(1, "Model is required").max(200),
  // One tag per asset. The COUNT is the quantity — there is no separate qty
  // field, so the two cannot disagree.
  tags: z.array(z.string().trim().toUpperCase().regex(TAG_SHAPE, "Format: BR-XX-0000")).min(1).max(200),
  serials: z.array(z.string().trim().max(120)).optional(),
  purchasedAt: z.string().optional(),
  cost: z.string().optional(),
  vendorId: z.string().optional(),
  // OPTIONAL metadata, never a gate (C-5). If a request is named it must be
  // COMPLETED, because linking an asset to a request still in flight would
  // claim a provenance that is not settled.
  requestId: z.string().optional(),
});

interface Registered {
  created: number;
}

export async function registerAssets(input: unknown): Promise<ActionResult<Registered>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const dupe = d.tags.find((t, i) => d.tags.indexOf(t) !== i);
  if (dupe) return conflict(`${dupe} appears twice in this batch.`);

  let done: Registered | null = null;
  let failure: ActionResult<Registered> | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // SAME two-pass discipline as receiveUnits, and for the same reason
      // (C-4): Prisma commits when this callback resolves and rolls back only
      // when it throws, so every refusal must sit above every write.
      if (d.requestId) {
        const req = await tx.purchaseRequest.findUnique({
          where: { id: d.requestId },
          select: { refNo: true, state: true },
        });
        if (!req) {
          failure = validationError({ requestId: "Unknown request" });
          return;
        }
        if (req.state !== "COMPLETED") {
          failure = conflict(`${req.refNo} is ${req.state.toLowerCase()} — only a completed request can be linked.`);
          return;
        }
      }

      let created = 0;
      for (const [i, tag] of d.tags.entries()) {
        const asset = await tx.asset.create({
          data: {
            tag,
            model: d.model,
            serial: d.serials?.[i]?.trim() || null,
            categoryId: d.categoryId,
            typeId: d.typeId || null,
            status: "SPARE",
            purchasedAt: d.purchasedAt ? new Date(d.purchasedAt) : null,
            cost: d.cost ? d.cost : null,
            vendorId: d.vendorId || null,
            purchaseRequestId: d.requestId || null,
          },
        });
        created++;
        await writeAudit(tx, {
          actorId: user.id,
          actorLabel: user.name,
          entityType: "asset",
          entityId: asset.id,
          action: "register",
          diff: {
            tag: { from: null, to: asset.tag },
            status: { from: null, to: "SPARE" },
          },
        });
      }
      done = { created };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return conflict("One of those tags was just taken. Reload and try again.");
    }
    throw e;
  }

  if (failure) return failure;
  revalidatePath("/inventory");
  return ok(done!);
}
```

⚠️ **`cost` is `Decimal?` in the schema.** Passing a string works because Prisma coerces, but check how
`createAsset` in `src/server/modules/inventory/actions.ts` does it (it has a `toCost` helper) and **use
that helper** rather than a second conversion — a number formatted two ways is rules 26/37/38.

- [ ] **Step 2: Add the route rule**

In `src/lib/workspaces.ts`, add beside `/inventory/import`:

```ts
  { test: /^\/inventory\/register(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
```

It must sit **above** the general `/inventory` rule. Add a test to `src/lib/workspaces.test.ts` asserting
that `finance_staff` and `viewer` are refused `/inventory/register` while `it_staff` is allowed — the
existing tests for `/inventory/import` show the shape.

- [ ] **Step 3: Write the page**

Create `src/app/(app)/inventory/register/page.tsx`. It must `await requireRole("admin", "it_staff")`,
load all `AssetCategory` rows (`id`, `name`), all `AssetType` rows (`id`, `name`, `categoryId`), all
`Vendor` rows (`id`, `name`), and the `COMPLETED` purchase requests (`id`, `refNo`) for the optional
link. Then render `<RegisterForm …/>`.

It must also pass a **map of prefix → highest number** and **prefix counts per category**, computed with
the existing `highestTagNumber` and `prefixCountsForCategory`. The client must not guess either.

- [ ] **Step 4: Write the form**

Create `src/components/inventory/register-form.tsx`, `"use client"`. Fields: category (required), type
(filtered to category, optional), model (required), quantity (`min={1}`), prefix (two characters,
defaulted via `preferredPrefix` for the chosen category), one editable tag input per quantity
(pre-filled from `nextTags`), one optional serial input per quantity, plus optional purchased date,
cost, vendor and purchase request.

When category, prefix or quantity changes, recompute the tags from `nextTags`. On
`{ ok: false }` show the reason and **disable submit**: `bad-prefix` → "Prefix must be two capital
letters"; `overflow` → "That run passes BR-XX-9999 — register fewer, or use another prefix";
`bad-count` → "Quantity must be at least 1".

- [ ] **Step 5: Typecheck, lint, and view it**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

Then ask the controller to open `/inventory/register` in the preview and confirm the tags default to the
next free numbers for the chosen category. **Do not start a dev server yourself.**

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/inventory/register/page.tsx" src/components/inventory/register-form.tsx src/lib/workspaces.ts src/lib/workspaces.test.ts src/server/modules/purchases/receiving.ts
git commit -m "feat(inventory): register already-purchased assets with auto-numbered tags"
```

---

### Task 6: Finance confirmation

**Files:**
- Create: `prisma/migrations/<timestamp>_asset_finance_confirmed/migration.sql`
- Modify: `prisma/schema.prisma`, `src/server/modules/inventory/actions.ts`,
  `src/app/(app)/inventory/[id]/layout.tsx`

**Replaces the original Task 6 — see C-5.** IT registers; Finance confirms the details are correct.

- [ ] **Step 1: The migration**

Add to `model Asset`:

```prisma
  financeConfirmedAt   DateTime?
  financeConfirmedById String?
  financeConfirmedBy   User?     @relation("financeConfirmedBy", fields: [financeConfirmedById], references: [id], onDelete: Restrict)
```

and the back-relation on `model User`:

```prisma
  financeConfirmed Asset[] @relation("financeConfirmedBy")
```

Migration SQL:

```sql
ALTER TABLE "Asset" ADD COLUMN "financeConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "financeConfirmedById" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_financeConfirmedById_fkey"
  FOREIGN KEY ("financeConfirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Asset_financeConfirmedAt_idx" ON "Asset"("financeConfirmedAt");
```

**NULL means awaiting confirmation.** No backfill: every existing asset becomes unconfirmed, which is
honest — Finance has never confirmed any of them.

⚠️ **This is NOT an `AssetStatus` value, and must not become one.** Status is custody and physical state;
an asset can be `SPARE` *and* unconfirmed. Adding `UNCONFIRMED` to that enum would make "confirmed"
unrepresentable for anything not spare, and would break `statusFamily`, the status chips, the facet
counts and `buildAssetWhere`, all of which treat the enum as a partition. See C-5.

Then `npx prisma migrate deploy && npx prisma generate` — expect **10 migrations, none pending**.

- [ ] **Step 2: The action**

Add to `src/server/modules/inventory/actions.ts`:

```ts
const confirmSchema = z.object({ id: z.string().min(1) });

/**
 * Finance confirms that a registered asset's details are correct. Separate
 * from the approval queue on purpose (C-5): every ApprovalType is a lifecycle
 * change to an asset that already exists, whereas this is data verification —
 * a different question with a different audience.
 *
 * Idempotent by refusal rather than by silence: confirming twice is a
 * conflict, so a double-submit cannot quietly overwrite who confirmed it and
 * when.
 */
export async function confirmAssetDetails(input: unknown): Promise<ActionResult<{ tag: string }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  let out: { tag: string } | null = null;
  let failure: ActionResult<{ tag: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, tag: true, financeConfirmedAt: true },
    });
    if (!asset) {
      failure = validationError({ id: "Unknown asset" });
      return;
    }
    if (asset.financeConfirmedAt) {
      failure = conflict(`${asset.tag} was already confirmed.`);
      return;
    }
    // State-guarded write: the null check is IN the where clause, so two
    // simultaneous confirmations cannot both succeed.
    const hit = await tx.asset.updateMany({
      where: { id: asset.id, financeConfirmedAt: null },
      data: { financeConfirmedAt: new Date(), financeConfirmedById: user.id },
    });
    if (hit.count === 0) {
      failure = conflict(`${asset.tag} was confirmed by someone else just now.`);
      return;
    }
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "asset",
      entityId: asset.id,
      action: "finance.confirm",
      diff: { financeConfirmed: { from: null, to: user.name } },
    });
    out = { tag: asset.tag };
  });

  if (failure) return failure;
  revalidatePath(`/inventory/${parsed.data.id}`);
  revalidatePath("/inventory");
  return ok(out!);
}
```

- [ ] **Step 3: Surface it on the record**

In `src/app/(app)/inventory/[id]/layout.tsx`, add to the header badge area: a `Pill` reading
`AWAITING FINANCE` when `financeConfirmedAt` is null, or `FINANCE CONFIRMED` with the date when it is
set. Show a **Confirm details** button only to `admin` and `finance_staff`, and only while unconfirmed.
`getAsset` must select the two new fields.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add prisma/schema.prisma prisma/migrations src/server/modules/inventory/actions.ts "src/app/(app)/inventory/[id]/layout.tsx" src/server/modules/inventory/queries.ts
git commit -m "feat(inventory): finance confirms a registered asset's details"
```

**Deferred to Phase 13, deliberately:** the Finance **tabs** separating IT from Purchasing. Those are the
asset-class dimension (§9 item A), and building them before classes exist means inventing an axis that
Phase 13 then has to reconcile or replace.

---

### Task 7: `e2e/receiving.spec.ts` — registration, receiving, and confirmation

**Files:**
- Create: `e2e/receiving.spec.ts`

**Rewritten after C-5.** There are now THREE surfaces to prove, not one. Registration is the primary
path the user will actually use; receiving is kept because it is already built and because C-4's
rollback guard lives there; confirmation is Task 6's.

Model the file on `e2e/purchases.spec.ts` for the login helper and the reseeding `beforeAll`.

⚠️ **Never reference a raw cuid.** The database reseeds and cuids change every run — reference
`PR-0188` by `refNo` and assets by `tag`. This has already bitten this project once, producing a
silently empty label sheet.

⚠️ **Read the highest existing number and derive expected tags. Do not hardcode `BR-LT-0211`.**
A fresh seed has `LT` at `0210`, but any earlier test in the file may have registered more.

- [ ] **Step 1: Registration — the primary path**

1. **A batch writes exactly what it said.** Register 3 laptops. Assert via Prisma that three assets
   exist with consecutive expected tags, `status: "SPARE"`, the chosen `categoryId` and `typeId`, and
   `financeConfirmedAt: null` — **unconfirmed is the correct initial state** and asserting it here is
   what stops a later change quietly auto-confirming.
2. **A duplicate tag inside one batch is refused and writes NOTHING.** Submit two identical tags.
   Assert the conflict names the tag, and assert a **Prisma count delta of zero** — the absence of a
   success message proves nothing.
3. **A tag that already exists is refused and writes NOTHING.** Use a seeded tag. Count delta zero.
4. **An audit row exists per registered asset**, with `action: "register"`.
5. **Neither `viewer` nor `finance_staff` can reach `/inventory/register`.** Assert the redirect for
   **both** — do not assume one implies the other. This is the `PATH_RULES` ordering guard: if the new
   rule were placed after the general `/inventory` rule, `finance_staff` would sail through, and this
   is the only test that would notice.

- [ ] **Step 2: Confirmation — Task 6's surface**

6. **Finance confirms and the record says so.** As `finance_staff`, confirm a registered asset; assert
   `financeConfirmedAt` is set, `financeConfirmedById` is that user, and an audit row exists with
   `action: "finance.confirm"`.
7. **Confirming twice is refused.** Assert the conflict and that `financeConfirmedAt` did **not**
   change — capture the first timestamp and compare. A second write that merely overwrote the same
   field with a new time would pass a naive "still confirmed" assertion.
8. **`it_staff` cannot confirm.** IT registers, Finance confirms; asserting the split is the whole
   point of the two-stage flow.

- [ ] **Step 3: Receiving — kept, and C-4's guard**

9. **A partial receipt against `PR-0188` writes exactly what it said**, with **both**
   `purchaseRequestId` and `purchaseUnitId` set, and the unit then reads `1 of 2 received`.
10. **An over-receipt is refused and writes NOTHING.** Attempt 3 against the qty-2 unit; count delta
    zero.
11. **A MULTI-LINE receipt whose second line fails rolls back the first — the C-4 case, and the most
    important test in this file.** **The seed cannot express it:** `PR-0188` has exactly one unit, so
    every case above sends a single line and none reaches the multi-line failure path. **Build the
    fixture** — create a `COMPLETED` request with **two** `APPROVED` units through Prisma inside the
    spec (Phase 9 Task 13 set the precedent: construct what the seed lacks rather than asserting
    around it). Submit two lines where the first is valid and the second over-receives, and assert a
    **count delta of ZERO**. Before C-4's fix this delta would have been the first line's assets,
    committed, while the caller saw a conflict.

- [ ] **Step 4: Run it and read the count**

```bash
npx playwright test e2e/receiving.spec.ts --workers=1 --global-timeout=600000
```

A run that hits `--global-timeout` prints "N did not run" and its tail still reads like a pass. **Read
the number.** Expect 11.

- [ ] **Step 5: Prove the write-nothing assertions are not inert**

Four tests above assert a count delta of zero. Each must be shown capable of failing:

- weaken the in-batch duplicate check (`d.tags.indexOf(t) !== i` → `false`) → test 2 must fail **on the
  count**, not only the message;
- weaken the over-receipt guard (`line.tags.length > outstanding(receipt)` → `> 999`) → tests 10 and 11
  must fail on the count;
- move a write above a refusal in `receiveUnits` (undo C-4's two-pass split) → **test 11 must fail**. If
  it does not, the rollback case is inert and the C-4 regression is unguarded.

Revert each after observing it. **Report the actual output for all four.** A write-nothing test that
passes against a broken guard is worse than no test, because it certifies the bug.

- [ ] **Step 6: Commit**

```bash
git add e2e/receiving.spec.ts
git commit -m "test(e2e): registration, confirmation and receiving each write exactly what they say"
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

⚠️ **Phase 11 IS in this branch — `main` was merged in on 2026-09-02, so an earlier revision of this
warning (claiming Phase 11 was absent and `labels.spec.ts` had 9 tests) is WRONG.** The real baseline
here is Phase 11's: **153 e2e / 12 files** across four parts — **51 · 62 · 34 · 6** — plus whatever
`e2e/receiving.spec.ts` adds (expect 11). `labels.spec.ts` has **11** tests, not 9, because it carries the
QR and scan-card cases. **Re-balance the split and write down what you actually ran and got**, rather
than trusting any number in this paragraph — it has already been wrong once.

⚠️ **`e2e/purchases.spec.ts` is the one to watch.** It exercises the request page — and note that after
C-5 this phase no longer modifies it, so a failure there means something leaked out of scope,
including `PR-0198`'s bounce-back thread. A failure there means Task 6 changed more than the indicator.

⚠️ **The axe sweep's route table is a HARDCODED list that nothing keeps in sync** — a new page route
does not fail it, it silently stops being scanned. This bit Phase 11 exactly once (amendment B-13),
so add **`/inventory/register`** to the it_staff group (`admin`/`it_staff` only). Phase 12 no longer adds a
receive screen, so there is no `/purchases/<id>/receive` route to scan.

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
