# Phase 13 — Asset Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Purchasing register and manage non-IT assets (cars, furniture, buildings, pantry equipment) in the same register as IT's equipment, with their own six-word status vocabulary, excluded from IT-only workflows, and give Finance **IT** and **Purchasing** tabs.

**Architecture:** One `Asset` table, two classes. `AssetClass { IT, PURCHASING }` lives on the category and is copied onto each asset at creation; two Postgres triggers make the copy unable to drift and make a status outside its class impossible to write. Six new `AssetStatus` values are disjoint from IT's eight; a new pure module `src/lib/asset-class.ts` owns the partition and every status control, filter, rule and executor consults it. `?cls=` on `/inventory` and `/finance/assets` is a nav-destination parameter modelled exactly on `?purchaseYear=`.

**Tech Stack:** Next.js 15 App Router · Prisma 6 / PostgreSQL 16 (plpgsql triggers) · vitest (node env, pure `src/lib`) · Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-asset-classes-design.md` — read §0 (naming) and §1 (the decisions and what they rejected) before touching anything. "Admin" in the meeting notes means the **Purchasing** department; the codebase's `admin` is the sysadmin role.

**Baselines on `phase-13-asset-classes` at start:** 843 unit / 50 files · 167 e2e / 13 files · `tsc` and `lint` clean · **11 migrations**, none pending (D-2).
> ### AMENDED DURING EXECUTION — D-1 through D-13. D-1/D-2 caught by the Task 1 implementer; D-3/D-4 by its code-quality reviewer; D-5 by the re-review, in text I wrote for the fix; D-6 by Task 2's reviewer. **D-3 is a real concurrency hole in a trigger this spec called a guarantee; D-6 a guard name that would have locked Finance out.**
>
> **D-1. "Expected: 6 failures" was wrong — only five of the six status-family tests CAN fail.**
> `STORED` maps to `neutral`, and `neutral` is also what `statusFamily` returns for an
> UNMAPPED value. So `["STORED", "neutral"]` passes whether or not the map entry exists — it is an inert
> assertion, and this plan predicted it would go red. The same is true of the pre-existing
> `["SPARE", "neutral"]` case, which nobody had noticed. **The lesson is the C-12 one again, one layer
> down: a red-then-green test is only evidence when the red was actually possible.** A test whose
> expected value equals the fallback needs a different shape — e.g. asserting the key is present in the
> map — or an honest comment saying it documents intent rather than guards it.
>
> **D-2. The migration baseline was 11, not 12, so every count in this plan and in spec §3.5 is off by
> one.** `ls prisma/migrations | wc -l` returned 12 because it counted `migration_lock.toml`. Phase 12's
> own handover says 11. Corrected below and in the spec: **11 → 13**. The implementer did the right
> thing — reported the discrepancy against both briefing documents instead of assuming the repo was
> wrong.
>
> **D-3. The trigger had a READ COMMITTED race, and it was the exact hole the design claimed did not
> exist.** Found by the Task 1 code-quality reviewer. `asset_class_invariants` read the category with an
> unlocked `SELECT`. Transaction 1 inserts an asset and reads `cls='IT'` from its snapshot;
> transaction 2 flips the category to `PURCHASING` and `category_class_frozen`'s `EXISTS` cannot
> see T1's uncommitted row; both commit; the asset now carries a class its category no longer has, and
> no trigger revisits it. Spec §2.4 justified storing `Asset.cls` at all on *"there is no drift path…
> enforced by Postgres, not trusted."* **That sentence was false as written.** Fixed with `FOR SHARE` on
> the category read — a row lock a plain `UPDATE` conflicts with, so the flip waits and re-checks. Not
> `FOR KEY SHARE`, which is what FK checks take and which does NOT conflict with an update of a non-key
> column. The re-review confirmed both interleavings are now refused and two concurrent inserts still
> both succeed (the lock is shared).
>
> Because migration 001 was already applied and this project never resets, the fix is a **third
> migration** with `CREATE OR REPLACE FUNCTION` — the clause was there for exactly this. Migration count:
> **11 → 14**, not 13. Three smaller findings ride in the same migration: a missing category now falls
> through to the FK's own error; the `::text` comparison is documented as *defensive* (a plpgsql body is
> not parsed until first execution, so the "can't use a new enum value in the same transaction" rule
> does not apply to it — correct fact, wrong anchor); and the backfill `UPDATE` in 001 is noted as
> provably inert (both columns were added with `DEFAULT 'IT'` two lines earlier) and left frozen.
>
> **The lesson:** a trigger that reads another table is a concurrency question, not just a logic
> question. "Enforced by the database" is only true if the read is locked against the write it is
> guarding. Ask what the *other* transaction sees.
>
> **D-4. Task 2's pin test read the wrong file.** It hard-coded migration 001 as the source of the
> trigger's status lists. After D-3, 001 holds a **stale** function body and 002 holds the live one —
> the test would have pinned `asset-class.ts` to text the database no longer runs, and stayed green while
> the two drifted. Task 2 is amended below to read every migration in order and take the **last**
> `CREATE OR REPLACE FUNCTION asset_class_invariants()` body. Also from the same review: the
> `["STORED", "neutral"]` test is now backed by `hasStatusFamily`, a presence check that CAN fail — closing
> D-1 properly rather than merely noting it.
>
> **D-5. The fix for Important 2 re-introduced the defect it was fixing, and I wrote it.** The
> review said the `Asset.cls` comment described a future state. My replacement text ended *"updateAsset
> refuses cross-class moves in application code"* — which is **Task 6**, not this commit — and the
> enum doc I supplied said *"set from the category by every code path that creates one"*, also false
> until Task 6. The re-review caught both. The same fix's migration comment cited
> `asset-class.test.ts`, a file Task 2 has not yet created, and stated the `::text` trade backwards (with
> the cast a typo'd literal is *not* caught — it silently widens or narrows the set; the enum comparison
> is the one that fails loudly). **The lesson is C-8's, one level up: when you write the correction,
> re-read it against the code AS IT IS AT THAT COMMIT, not as the plan says it will be.** A comment
> that names a future task's behaviour is a false comment today.
>
> **D-6. Task 2's module was correct and its shape was wrong in five ways, all caught while it still
> had zero call sites.** The code-quality reviewer verified every one of the six maps against the four
> consumers that hold the IT literals today and found no wrong entry — and then found the following,
> each cheap now and expensive after Tasks 3-10 import the module:
>
> - `canActOnClass` was **misnamed in a way with a concrete victim**: `finance_staff` maps to `[]`, but Finance
>   acts on assets of both classes through confirm / send back. A later task reaching for that guard
>   would have locked Finance out of what Phase 12 shipped. Renamed `canManageClass` /
>   `MANAGEABLE_CLASSES` — the four write rows of spec §5, and nothing else. **This plan is renamed
>   throughout.**
> - `HOLDER_STATUSES = ASSIGN_TARGETS` aliased a **safety invariant** (the worker's don't-change-status-out-
>   from-under-the-holder guard) to a **workflow set** that spec §7 already expects to widen. Its own
>   literal now, with a test asserting the two coincide today.
> - Three invariants were unasserted: the assign default ∈ assign targets (the summary and the executor
>   must agree); creatable = default + assign targets (what `creationPlan` encodes); the create default ∉
>   holder statuses (an asset is created with nobody holding it). All hold; none would have survived an
>   edit unnoticed.
> - Nothing caught a third `AssetClass`: `satisfies readonly AssetClass[]` does not check completeness, and
>   `parseCls` retyped the two literals inside a module whose thesis is single ownership.
> - The IT sets now coexist with the constants they replace (`RETURN_STATUSES`, `CREATABLE_STATUSES`,
>   `ASSET_STATUSES`) until Tasks 3, 6 and 5 delete or widen them. **Three transition pins** hold them equal
>   in that window — and **each later task now has an explicit step to delete its pin**, because two of
>   those constants are widened rather than deleted and a stale pin would fail for the wrong reason.
>
> Also: the migration scan filters on `CREATE OR REPLACE FUNCTION asset_class_invariants()` (a trigger-only
> migration or a comment would otherwise be mistaken for a definition), `::text` in the regex is
> optional (002's own comment invites dropping it), and the path is module-relative via
> `import.meta.url`, the house idiom.
>
> **The lesson:** review a new module's *names* as hard as its *values*. The values were all right. The
> name would have caused a bug in someone else's task, at a call site where the doc comment is not
> visible.
>
> Task 2's code snippets below are left as originally written; **the committed module (`d65e12c`) is the
> reference**, not the snippet. Re-deriving from the snippet would rebuild what the review removed.
>
> **D-7. Task 3 as written leaves ONE commit on the branch with red `tsc`, and the plan's own conventions
> forbid exactly that.** Task 3 deletes `RETURN_STATUSES`; `src/lib/offboarding.test.ts` imports it; Task 4 rewrites
> that file. The dispatch told the implementer to leave `offboarding.test.ts` alone, so commit `a21d034` has
> one `tsc` error and one failing vitest case, both fixed by Task 4's first step. **Every commit should be
> green; this one is not, and the reason is my sequencing, not the implementer's.** Two smaller defects in the
> same task text, both caught by the implementer: Step 6's `git add` omitted `src/lib/asset-class.test.ts`,
> which Step 1a edits (the pin deletion), so following it literally would have left a dangling import; and
> rewriting the change-status refusal to name the class changed the wording an existing test asserted on
> (`/not a valid asset status/` → `/not a IT status/`), which the plan's list of touched assertions did not
> mention. The implementer updated that regex and said so rather than working around it — correct.
>
> **The lesson:** when a task deletes an export, the SAME task must touch every importer at least
> minimally, even if a later task rewrites the file properly. "Task N owns that file" is not a reason to
> commit red.
>
> **D-8. Task 3's plan scoped a call-site sweep to one file, and the call site that mattered was in
> another.** Step 5 said pass `cls` to "every other `summarizeApproval` call **in this file**". The one call
> that renders the change line is `src/app/(app)/approvals/[id]/page.tsx`. Without `cls`, a Purchasing
> `lifecycle.assign` whose payload omits `to.status` — the seeded APR-2035 shape, the case that page exists
> to show — rendered **"→ DEPLOYED" for a car**. Found by the Task 3 code-quality reviewer, who walked
> all five call sites. Fixed two ways: the missing `cls` added, AND `cls` made a **required key**
> (`cls: AssetClass | undefined`) so the omission is a compile error next time.
>
> Three more from the same review. **`ASSIGNABLE_FROM`**: the worker's assign precondition was reading
> `DEFAULT_STATUS` ("what a new asset reads") as "the status an asset must be in to be assigned" — the
> same conflation D-6 removed between `HOLDER_STATUSES` and `ASSIGN_TARGETS`. Its own constant now,
> pinned equal; **Task 6's assign guards use it** (amended below). **Wording**: "not a IT status" in three
> strings stored verbatim in `Approval.workerError`; reworded. **The return check's detail** said "returns as
> SPARE" beside a red dot when the asset row was gone; it now says why.
>
> For **Task 11**: seeded APR-2035 (assign, APPROVED, no asset) now fails with "no asset attached" rather
> than "malformed payload" — update its seed comment or attach an asset. And **neither class-aware worker
> guard is reachable by a unit test** — Task 11's e2e gains a case: a held car may not be status-changed.
> Also confirmed: no IT flow can create an approval the new executor refuses. The Purchasing side has a
> window until Task 6 lands; **Task 6 precedes Task 11's seed in this plan; keep it that way.**
>
> **The re-review of that fix found one more of mine (D-1, third occurrence):** the new test I specified
> passed an explicit `OPERATIONAL` with `cls: "PURCHASING"` — and `OPERATIONAL` IS Purchasing's fallback, so
> deleting the explicit-status path leaves it green. It now uses `STORED`.
>
> **D-9. Task 4 listed one consumer of the export it deleted; there were five.** Step 5 named the single
> `<ItemDecision>` render line. That page had **three more** bare `OUTCOME_STATUS` reads, and
> `src/app/(app)/offboarding/[employeeId]/report/page.tsx` — the farewell report, a file the plan never
> mentioned — imported it too. The task's grep non-negotiable caught it; the implementer fixed all five and
> flagged it. **When a task deletes an export, the plan must `grep` for every consumer at planning time.**
>
> **D-10. Printing a re-derivation of a stored fact, when the row already carries the fact.** The five
> consumers D-9 fixed all rendered `outcomeStatus(i.cls, i.decision.outcome)` — that is
> `forward(cls, reverse(storedStatus))`, a lossy round-trip that equals the stored status only when the
> payload's status belongs to the asset's own class, and yields `null` (hence `?? ""` and bare-null
> renders) otherwise. The decision row already knows the payload's real target. Task 4's reviewer had the
> fix: carry `toStatus` on `Decision` and print it. Now no page re-derives; `item-decision.tsx` keeps
> `outcomeStatus(cls, picked)` because there `picked` is a *choice* constrained to `outcomesFor(cls)`, not a
> stored fact. Same review: a `!` non-null assertion whose proof lived in another function (this codebase's
> own rule forbids it — collapsed to one lookup narrowed on `null`); the class refusal now wins over the
> reason check (a Purchasing BUYOUT with no reason used to get "Buyout needs a reason", a remedy that
> could never work); and two docstrings still said "4-way control".
>
> **The lesson is derived-beats-stored's inverse:** when the stored value IS the fact — the payload's
> target, what the worker will actually apply — print it. Re-deriving it through two maps is not
> "derived state", it is a second copy that can disagree with the first.
>
> **D-11. Task 5 named one existing assertion its change would break; there were four.** Making `cls` an
> unconditional key in `buildAssetWhere`'s output broke the `toHaveLength(8)` check the plan called out — and
> three more that asserted `toEqual({})` on the WHOLE where object ("empty state → empty where", the
> `q` search shape, and the null-`purchaseYear` cases). The implementer fixed all four mechanically and flagged
> them. Same lesson as D-9, one notch smaller: **when a change alters a function's output shape, grep
> its test file for whole-object assertions, not just the one you remember.**
>
> **D-12. Task 5 scoped two of `facetOptions`' three reference lists and left the third global.** Categories
> and types got `where: { cls }`; the assignee list did not — so once Task 11's seed lands, the IT view's
> Assigned facet would list a driver who holds only a car, at a permanent zero. Not "dimmed at zero", which
> means *could have rows*; an option that can never have rows in this view. One-line fix
> (`assets: { some: { cls } }`), found by the code-quality reviewer, who also walked every asset query the task
> did NOT touch and confirmed each is right to stay global: the label sheet's `?ids=`, the palette, the
> employee record, offboarding's holdings (a leaver holds a laptop AND a car), import dedupe (a tag must be
> unique across classes), and `exactTagMatch` — a scanner contract: the label read off the object opens the
> object, from whichever view. That last one now says so in its doc comment, because the sibling non-exact
> path IS class-scoped and a later reader would "fix" the asymmetry.
>
> Three hand-offs from the same review, recorded in the tasks that own them. **Task 9:** the class switch
> carries the whole serialized state across, so `?status=SPARE` on the Purchasing view would render a
> "status: SPARE" chip for a filter `buildAssetWhere` silently drops — and a category, type or assignee id
> from the other class would render as a raw cuid chip over an honestly empty list (the re-review's
> addition). Every facet option belongs to exactly one class, so the switch now clears the facet filters
> outright and keeps only what is class-neutral (`q`, sort, columns, year); the URL says what the where does. Also Task 9: the `cls = "IT"` defaults on the four
> query functions were right for intermediate `tsc` and become a trap the moment the page threads `cls` —
> removed there, in the same commit. **Task 11:** case 10 asserts the Filters panel (the three scoped lists
> have zero coverage otherwise — no e2e case looked at the panel) and the class-switch clear. **Noted, not
> amended:** `import-assets.ts` now accepts `OPERATIONAL` (fourteen statuses), so such a row passes
> `bad-status` and dies at the trigger with the generic row error; Task 10 Step 3 closes it as planned.
>
> **The lesson:** when a change scopes one list in a function, scope *every* list in that function or write
> down why not. Two of three is the shape that ships green.
>
> **D-13. Task 6's one-sentence rule over-claimed, one write path was missed, and the fourth literal sat one
> file away.** All from the code-quality review; the implementer's own report added two more.
>
> - **`resubmitAssetToFinance` was still `actionRole("admin", "it_staff")`.** Task 7 renders Resubmit for
>   whoever `canManageClass` says may (plan line ~1588), so a Purchasing user would have seen the button and got
>   `forbidden()` on the click. Resubmit is the mirror of register — Finance sent the registration back to the
>   department that made it — so the register row of spec §5 governs it. Fixed in Task 6: role widened,
>   `canManageClass(user.role, asset.cls)` after the read, `cls` added to the select. **When a later task
>   renders a control gated by a predicate, the action behind it must be gated by the same predicate, and the
>   plan must say which task adds it.**
> - **The fourth literal.** Step 4 was titled "the three literals in `employees/actions.ts`"; the employee page's
>   spare picker (`src/app/(app)/employees/[id]/page.tsx`, `status: "SPARE"`) is the fourth, one file away, and
>   no task in this plan touched that file. Pinned deliberately to `cls: "IT", status: ASSIGNABLE_FROM.IT` with
>   the reason in a comment. **When a step counts the literals it replaces, grep for the one it did not count.**
> - **"a IT", again.** D-8 fixed "not a IT status" in three worker strings; Task 6 reintroduced the article
>   before `CLASS_LABEL[cls]` at six sites and Task 4 at one. Fixed at the source: `CLASS_PHRASE` ("an IT",
>   "a Purchasing") in `asset-class.ts`, used everywhere an article precedes the label, with a test.
> - **Decision, argued from the spec: assign / return / reserve-fulfil in `employees/actions.ts` do NOT get a class
>   check.** §5's intro is "each class is *registered and edited* by its own department; everything else is
>   shared", and its table has no assign row; §8 has IT's offboarding wizard returning a leaver's car (Task 11
>   case 8 asserts it). `MANAGEABLE_CLASSES`' own docblock already says "deliberately NOT 'act on' in general".
>   The plan's sentence "a role may act on an asset only if `canManageClass`" was the loose text — corrected
>   below. Also confirmed: no reservation can hold a Purchasing asset today (there is no reservation write
>   path in `src/`; the seed's four are IT), so the loop's PURCHASING branch is dead-but-correct.
> - **Recorded, not fixed — follow-ups beside §7's approvals asymmetry:** Purchasing has no assign or return
>   surface (`/employees` is IT's workspace; a car is assigned at create time only); a change-status request to
>   a holder status with no holder is allowed on BOTH sides (Task 11 case 7 relies on it — a pool car may
>   legitimately be OPERATIONAL with no driver), but IT's Home detects the resulting state for laptops and
>   Purchasing has no detector; `@default(IT)` plus a category-creation UI means an import row naming a Purchasing
>   category now reaches the trigger's raw error until Task 10 lands.
> - **From the implementer:** a second `CREATABLE_STATUSES` pin in `asset-rules.test.ts` the plan did not name
>   (widened to five, honestly); Step 3's import line listed `DEFAULT_STATUS`, which nothing in that file reads.
> - **Coverage.** Every server-side class refusal Task 6 added is Prisma-bound, and none of Task 11's fourteen
>   cases posts a wrong-class request — cases 2 and 3 assert the picker's options and an unchanged count,
>   which reads as coverage of the server gate and is not. Two cases added (15: a cross-class category edit;
>   16: Finance sends a Purchasing registration back and Purchasing resubmits it). The gates unreachable from
>   the UI (wrong-class register, mixed-class bulk) ship covered by the trigger and by review only; Task 12
>   says so.
> - **From the re-review, handed to Task 7 (Step 4b):** widening resubmit made Finance's send-back copy wrong
>   for the class it can now reach — `finance-review.tsx` says "sent back to IT" / "Send back to IT" and its
>   docblock speaks of IT throughout, and `resubmitAssetToFinance`'s own docstring still says "IT says fixed".
>   The action name `returnAssetToIt` stays (renaming a server action for a word is churn; a comment says why).



---

## Conventions for every task

- Stay on `phase-13-asset-classes`. Run `npx tsc --noEmit && npm run lint` before every commit; `lint` is `eslint . --max-warnings 0` — **one unused import fails it** (Phase 12's C-2).
- **NEVER run `npm run build` while a dev server is running** (they share `.next`). Subagents must not start a dev server; the controller owns the preview.
- **After any schema change: `npx prisma generate`.** The client is generated into gitignored `node_modules/.prisma` and is shared across branches; `tsc` blaming an application file for a missing field means you skipped this (§7 of the handover).
- Commit style: `feat(scope): …` / `fix(scope): …` / `test(scope): …` / `docs(plan): …`. Trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **Never push, never merge.**
- **If something in this plan looks wrong, STOP and report.** Phase 12 recorded twelve amendments, nine of them defects in its plan, and three were caught only because an implementer refused to guess. Amendments to this plan use the prefix **`D-`**.
- **Write down the numbers you actually got**, not the ones this plan predicts. Phase 12's plan was wrong about its own test counts twice.

---

## Design in one screen

| | IT | PURCHASING |
|---|---|---|
| statuses | `DEPLOYED SPARE DEFECTIVE DONATED TEMPORARY BUYOUT DISPOSE MISSING` | `OPERATIONAL STORED REPAIRING RETIRED SOLD LOST` |
| default on create / register | `SPARE` | `STORED` |
| assign target | `DEPLOYED` or `TEMPORARY` | `OPERATIONAL` |
| return targets | `SPARE DEFECTIVE BUYOUT MISSING` | `STORED REPAIRING LOST` |
| offboarding outcomes | Returned Defective Buyout Missing | Returned Defective Missing (**no Buyout**) |
| registers / edits / requests | `admin`, `it_staff` | `admin`, `purchasing_staff` |
| approves | `admin`, `it_staff` | `admin`, `it_staff` (unchanged — follow-up) |
| confirms / sends back (Phase 12) | `admin`, `finance_staff` | same |
| Secrets tab | yes | **hidden, and the URL 404s** |
| in equipment policies | yes | no |
| import wizard | yes | rows refused with `wrong-class` |
| Home alerts | yes | no (Home is IT's) |

**`?cls=`** — absent or `IT` means IT, so every existing URL behaves exactly as today. Only `PURCHASING` is ever written into a URL.

---

## File structure

| file | responsibility in this phase |
|---|---|
| `prisma/schema.prisma` **(modify)** | `AssetClass`; `AssetCategory.cls`; `Asset.cls` + index; six enum values |
| `prisma/migrations/20260906090000_asset_status_purchasing_values/migration.sql` **(create)** | the six `ADD VALUE` statements, alone |
| `prisma/migrations/20260906090001_asset_classes/migration.sql` **(create)** | enum type, columns, backfill, both triggers |
| `src/lib/asset-class.ts` **(create)** + `.test.ts` | THE partition. Every other file asks this one |
| `src/lib/status.ts` + `.test.ts` **(modify)** | six family entries |
| `src/lib/approval-execution.ts` + `.test.ts` **(modify)** | class-aware targets; `executionPlan` gains `cls` |
| `src/lib/offboarding.ts` + `.test.ts` **(modify)** | class-keyed outcomes; no Buyout for Purchasing |
| `src/lib/asset-rules.ts` **(modify)** | `creationPlan` gains `cls` |
| `src/lib/inventory-list.ts` + `.test.ts` **(modify)** | `ASSET_STATUSES` becomes all fourteen; `buildAssetWhere` gains `cls` |
| `src/lib/import-vocabulary.ts`, `import-assets.ts` + tests **(modify)** | `wrong-class`; IT-set status check |
| `src/lib/workspaces.ts` + `.test.ts` **(modify)** | register rule admits purchasing; nav |
| `src/server/modules/import/resolve.ts` + `.test.ts` **(modify)** | `categoryClass` map |
| `src/server/modules/purchases/receiving.ts` **(modify)** | `registerAssets`: class gate, `cls`, default status |
| `src/server/modules/inventory/actions.ts` **(modify)** | create / edit / request / bulk: class gates and target validation |
| `src/server/modules/inventory/queries.ts` **(modify)** | `cls` threaded through list, facets, buckets, stage ids |
| `src/server/modules/employees/actions.ts` **(modify)** | three status literals become class-aware |
| `src/server/modules/offboarding/actions.ts`, `queries.ts` **(modify)** | outcome validated per class; held items carry `cls` |
| `src/server/modules/approvals/queries.ts` **(modify)** | two system checks become class-aware |
| `src/server/modules/finance/queries.ts` **(modify)** | `financeAssets(…, cls)`; `parseAssetStatus(raw, cls)` |
| `src/server/modules/home/queries.ts` **(modify)** | every asset query pinned to `cls: "IT"` |
| `src/server/modules/admin/reference-actions.ts` **(modify)** | `createRefRow` accepts `cls` for categories |
| `src/worker/execute-approval.ts` **(modify)** | passes `asset.cls`; two literal guards become class-aware |
| `src/app/(app)/inventory/page.tsx` **(modify)** | `?cls=`; class chips; `cls` everywhere a URL is built |
| `src/app/(app)/inventory/export/route.ts` **(modify)** | `cls` |
| `src/app/(app)/inventory/[id]/layout.tsx`, `…/secrets/page.tsx` **(modify)** | class pill; Secrets 404 |
| `src/app/(app)/inventory/register/page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx` **(modify)** | roles widened; categories filtered by class |
| `src/app/(app)/finance/assets/page.tsx` **(modify)** | the two tabs |
| `src/app/(app)/admin/asset-categories/page.tsx`, `equipment-policies/page.tsx` **(modify)** | class column; IT types only |
| `src/app/(app)/offboarding/[employeeId]/page.tsx` **(modify)** | passes `cls` to `ItemDecision` |
| `src/components/inventory/record-tabs.tsx`, `request-status-change.tsx`, `bulk-drawer.tsx`, `inventory-table.tsx`, `inventory-toolbar.tsx`, `asset-form.tsx` **(modify)** | class-aware controls |
| `src/components/offboarding/item-decision.tsx` **(modify)** | `cls` prop; `outcomesFor(cls)` |
| `src/components/admin/ref-table.tsx` **(modify)** | Class column + picker for categories |
| `prisma/seed.ts` **(modify)** | four Purchasing categories, seven assets |
| `e2e/asset-classes.spec.ts` **(create)**; `e2e/axe-sweep.spec.ts` **(modify)** | 13 cases; two routes |
| `docs/HANDOVER.md` **(modify)** | §9 "Admin" → "Purchasing"; Phase 13 entries |

---

### Task 1: Schema, two migrations, and the six status families

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260906090000_asset_status_purchasing_values/migration.sql`
- Create: `prisma/migrations/20260906090001_asset_classes/migration.sql`
- Modify: `src/lib/status.ts`, `src/lib/status.test.ts`

**Why `Asset.cls` gets a database default of `IT` even though the spec says it is set from the category:** every existing insert path (`registerAssets`, `createAsset`, the seed, the import wizard, e2e fixtures) omits `cls` today. A required column with no default would break all of them in this task, before the later tasks that teach each one to set it. The default keeps every intermediate commit green. **It is not the guarantee** — the trigger is: any insert whose `cls` does not match its category's raises. Today every category is IT, so the default is also correct; the moment a Purchasing category exists (Task 11's seed), an insert that forgets `cls` fails loudly rather than silently.

- [ ] **Step 1: Add the six status-family tests (they fail: the enum values do not exist yet)**

In `src/lib/status.test.ts`, inside the `cases` array, directly after the `["DISPOSE", "closed"],` line:

```ts
    // Purchasing-class asset status (Phase 13, 6): the same six families, so a
    // car in repair is amber the way a laptop in repair is
    ["OPERATIONAL", "settled"], ["STORED", "neutral"], ["REPAIRING", "fault"],
    ["RETIRED", "closed"], ["SOLD", "closed"], ["LOST", "fault"],
```

Run: `npx vitest run src/lib/status.test.ts`
Expected: **5 failures** — each new value maps to `neutral` (the fallback), e.g. `expected 'neutral' to be 'settled'`. **Not six:** `STORED → neutral` equals the fallback and passes vacuously (D-1).

- [ ] **Step 2: The schema**

In `prisma/schema.prisma`:

Add the enum (anywhere among the other enums, e.g. directly above `enum AssetStatus`):

```prisma
/// Phase 13. Lives on the category; copied onto each asset at creation and
/// held equal to the category's by a trigger. See spec §2.
enum AssetClass {
  IT
  PURCHASING
}
```

Extend `enum AssetStatus` — append after `MISSING`:

```prisma
  // Purchasing-class vocabulary (Phase 13). Disjoint from the eight above; a
  // trigger refuses any asset whose status is outside its class's set.
  OPERATIONAL
  STORED
  REPAIRING
  RETIRED
  SOLD
  LOST
```

In `model AssetCategory`, after `locked Boolean @default(false)`:

```prisma
  cls    AssetClass  @default(IT)
```

In `model Asset`, directly after the `status` line:

```prisma
  // Copied from category.cls at creation, never edited; the
  // asset_class_invariants trigger keeps it equal to the category's.
  cls               AssetClass       @default(IT)
```

And in `model Asset`'s index block, after `@@index([financeReturnedAt])`:

```prisma
  @@index([cls])
```

- [ ] **Step 3: Migration one — the enum values, alone**

Create `prisma/migrations/20260906090000_asset_status_purchasing_values/migration.sql`:

```sql
-- Phase 13: the Purchasing-class status vocabulary. In its OWN migration on
-- purpose: Postgres refuses to USE a newly added enum value inside the
-- transaction that added it, and Prisma runs each migration in one
-- transaction. The trigger that names these values lives in the next one.
ALTER TYPE "AssetStatus" ADD VALUE 'OPERATIONAL';
ALTER TYPE "AssetStatus" ADD VALUE 'STORED';
ALTER TYPE "AssetStatus" ADD VALUE 'REPAIRING';
ALTER TYPE "AssetStatus" ADD VALUE 'RETIRED';
ALTER TYPE "AssetStatus" ADD VALUE 'SOLD';
ALTER TYPE "AssetStatus" ADD VALUE 'LOST';
```

- [ ] **Step 4: Migration two — the class dimension and both triggers**

Create `prisma/migrations/20260906090001_asset_classes/migration.sql`:

```sql
-- Phase 13: asset classes. See docs/superpowers/specs/2026-09-06-asset-classes-design.md §2-3.

CREATE TYPE "AssetClass" AS ENUM ('IT', 'PURCHASING');

ALTER TABLE "AssetCategory" ADD COLUMN "cls" "AssetClass" NOT NULL DEFAULT 'IT';
ALTER TABLE "Asset"         ADD COLUMN "cls" "AssetClass" NOT NULL DEFAULT 'IT';

-- Every existing category is IT, so this is a no-op today; it is here so the
-- statement that establishes the invariant is the same one that would
-- backfill it on any database where it was not already true.
UPDATE "Asset" a SET "cls" = c."cls" FROM "AssetCategory" c WHERE c."id" = a."categoryId";

CREATE INDEX "Asset_cls_idx" ON "Asset"("cls");

-- An asset's status must belong to its class, and its class must equal its
-- category's. Compared as text on purpose: the values were added by the
-- previous migration, and text comparison cannot trip over enum-literal
-- parsing whatever order a future maintainer runs these in.
CREATE OR REPLACE FUNCTION asset_class_invariants() RETURNS trigger AS $$
DECLARE cat_cls "AssetClass";
BEGIN
  SELECT "cls" INTO cat_cls FROM "AssetCategory" WHERE "id" = NEW."categoryId";
  IF cat_cls IS DISTINCT FROM NEW."cls" THEN
    RAISE EXCEPTION 'asset % carries class % but its category is %', NEW."tag", NEW."cls", cat_cls;
  END IF;
  IF NEW."cls" = 'IT' AND NEW."status"::text NOT IN
       ('DEPLOYED','SPARE','DEFECTIVE','DONATED','TEMPORARY','BUYOUT','DISPOSE','MISSING') THEN
    RAISE EXCEPTION 'IT asset % cannot hold status %', NEW."tag", NEW."status";
  ELSIF NEW."cls" = 'PURCHASING' AND NEW."status"::text NOT IN
       ('OPERATIONAL','STORED','REPAIRING','RETIRED','SOLD','LOST') THEN
    RAISE EXCEPTION 'Purchasing asset % cannot hold status %', NEW."tag", NEW."status";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER asset_class_invariants
  BEFORE INSERT OR UPDATE OF "status", "cls", "categoryId" ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION asset_class_invariants();

-- The other side of "no drift path": a category's class is frozen once any
-- asset references it. Without this, a raw UPDATE could flip a category and
-- leave every asset under it holding a class its category no longer has.
CREATE OR REPLACE FUNCTION category_class_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW."cls" IS DISTINCT FROM OLD."cls"
     AND EXISTS (SELECT 1 FROM "Asset" WHERE "categoryId" = OLD."id") THEN
    RAISE EXCEPTION 'category % has assets; its class cannot change', OLD."name";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER category_class_frozen
  BEFORE UPDATE OF "cls" ON "AssetCategory"
  FOR EACH ROW EXECUTE FUNCTION category_class_frozen();
```

- [ ] **Step 5: Apply, regenerate, verify the count**

```bash
npx prisma migrate deploy && npx prisma generate && npx prisma migrate status
```

Expected: **13 migrations found** at this step (11 + 2 — D-2); **14** once the review fix in D-3 lands.

- [ ] **Step 6: The six family entries**

In `src/lib/status.ts`, inside `MAP`, directly after the line ending `TEMPORARY: "attention", BUYOUT: "closed", DISPOSE: "closed",`:

```ts
  // Purchasing-class asset status (Phase 13). STORED is neutral for the same
  // reason SPARE is — idle stock is not a problem; REPAIRING and LOST are
  // faults for the same reason DEFECTIVE and MISSING are.
  OPERATIONAL: "settled", STORED: "neutral", REPAIRING: "fault",
  RETIRED: "closed", SOLD: "closed", LOST: "fault",
```

Run: `npx vitest run src/lib/status.test.ts`
Expected: PASS, six more than before.

- [ ] **Step 7: Full check**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
```

Expected: clean; **849 tests** (843 + 6). Write down what you got.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260906090000_asset_status_purchasing_values prisma/migrations/20260906090001_asset_classes src/lib/status.ts src/lib/status.test.ts
git commit -m "feat(schema): asset classes — two class columns, six Purchasing statuses, two triggers"
```

---

### Task 2: `src/lib/asset-class.ts` — the partition (TDD)

**Files:**
- Create: `src/lib/asset-class.ts`
- Create: `src/lib/asset-class.test.ts`

This module is the **only** place that knows which statuses belong to which class. Everything else imports from here. It has zero runtime imports — Prisma is type-only.

- [ ] **Step 1: The failing tests**

Create `src/lib/asset-class.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetStatus, type AssetClass } from "@prisma/client";
import {
  ASSET_CLASSES, ASSIGN_TARGETS, MANAGEABLE_CLASSES, CREATABLE_BY_CLASS, DEFAULT_ASSIGN_STATUS,
  DEFAULT_STATUS, HOLDER_STATUSES, RETURN_TARGETS, STATUSES_BY_CLASS,
  canManageClass, isStatusOf, parseCls, statusesFor, withClsQS,
} from "./asset-class";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("STATUSES_BY_CLASS — a partition of the enum", () => {
  it("the two sets are disjoint", () => {
    const it = new Set<string>(STATUSES_BY_CLASS.IT);
    for (const s of STATUSES_BY_CLASS.PURCHASING) expect(it.has(s), s).toBe(false);
  });
  it("their union is EVERY AssetStatus value — a new status must be placed in a class or this fails", () => {
    const union = sorted([...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING]);
    expect(union).toEqual(sorted(Object.values(AssetStatus)));
  });
  it("IT keeps exactly the original eight, in the original order", () => {
    expect([...STATUSES_BY_CLASS.IT]).toEqual([
      "DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING",
    ]);
  });
  it("Purchasing has exactly the six the user chose", () => {
    expect([...STATUSES_BY_CLASS.PURCHASING]).toEqual([
      "OPERATIONAL", "STORED", "REPAIRING", "RETIRED", "SOLD", "LOST",
    ]);
  });
});

describe("the derived sets stay inside their class", () => {
  for (const cls of ASSET_CLASSES) {
    const set = new Set<string>(STATUSES_BY_CLASS[cls]);
    it(`${cls}: defaults, assign, return, creatable and holder statuses are all members`, () => {
      expect(set.has(DEFAULT_STATUS[cls])).toBe(true);
      expect(set.has(DEFAULT_ASSIGN_STATUS[cls])).toBe(true);
      for (const s of ASSIGN_TARGETS[cls]) expect(set.has(s), s).toBe(true);
      for (const s of RETURN_TARGETS[cls]) expect(set.has(s), s).toBe(true);
      for (const s of CREATABLE_BY_CLASS[cls]) expect(set.has(s), s).toBe(true);
      for (const s of HOLDER_STATUSES[cls]) expect(set.has(s), s).toBe(true);
    });
  }
  it("a return never lands on a holder status — that is what lifecycle.assign is for", () => {
    for (const cls of ASSET_CLASSES) {
      for (const s of RETURN_TARGETS[cls]) expect(HOLDER_STATUSES[cls]).not.toContain(s);
    }
  });
  it("Purchasing has no Buyout-shaped return: nobody buys out a company car through the leaver wizard", () => {
    expect(RETURN_TARGETS.PURCHASING).not.toContain("BUYOUT");
    expect(RETURN_TARGETS.PURCHASING).toEqual(["STORED", "REPAIRING", "LOST"]);
  });
});

describe("statusesFor / isStatusOf", () => {
  it("answer by class", () => {
    expect(statusesFor("PURCHASING")).toEqual(STATUSES_BY_CLASS.PURCHASING);
    expect(isStatusOf("PURCHASING", "STORED")).toBe(true);
    expect(isStatusOf("PURCHASING", "SPARE")).toBe(false);
    expect(isStatusOf("IT", "SPARE")).toBe(true);
    expect(isStatusOf("IT", "STORED")).toBe(false);
    expect(isStatusOf("IT", "BANANAS")).toBe(false);
  });
});

describe("MANAGEABLE_CLASSES / canManageClass — each class is its own department's", () => {
  it.each<[Parameters<typeof canManageClass>[0], AssetClass, boolean]>([
    ["admin", "IT", true], ["admin", "PURCHASING", true],
    ["it_staff", "IT", true], ["it_staff", "PURCHASING", false],
    ["purchasing_staff", "PURCHASING", true], ["purchasing_staff", "IT", false],
    ["finance_staff", "IT", false], ["finance_staff", "PURCHASING", false],
    ["viewer", "IT", false], ["viewer", "PURCHASING", false],
  ])("%s on %s → %s", (role, cls, ok) => {
    expect(canManageClass(role, cls)).toBe(ok);
    expect(MANAGEABLE_CLASSES[role].includes(cls)).toBe(ok);
  });
});

describe("parseCls / withClsQS — the ?cls= nav parameter", () => {
  it("parses the two classes and nothing else", () => {
    expect(parseCls("IT")).toBe("IT");
    expect(parseCls("PURCHASING")).toBe("PURCHASING");
    expect(parseCls("purchasing")).toBeNull(); // case-sensitive like every enum here
    expect(parseCls("OFFICE")).toBeNull();
    expect(parseCls(null)).toBeNull();
    expect(parseCls(undefined)).toBeNull();
  });
  it("IT is the default and is never written into a URL; only PURCHASING is", () => {
    expect(withClsQS("", "IT")).toBe("");
    expect(withClsQS("?q=x", "IT")).toBe("?q=x");
    expect(withClsQS("", "PURCHASING")).toBe("?cls=PURCHASING");
    expect(withClsQS("?q=x", "PURCHASING")).toBe("?q=x&cls=PURCHASING");
  });
});

describe("the trigger's literal lists are pinned to STATUSES_BY_CLASS", () => {
  // Same move as receiving.test.ts pinning MAX_TAG_NUMBER to TAG_SHAPE: the
  // status list exists twice — here and in plpgsql — and the two must move
  // together. This test reads the migration so a drift is a red test, not a
  // production error at the first write.
  // The LAST definition wins: migration 001 created the function and 002
  // replaced it (D-3), and CREATE OR REPLACE means the database runs whichever
  // came last. Pinning a fixed filename would pin a body the database no
  // longer executes -- a green test proving nothing (D-4).
  const migrationsDir = path.join(process.cwd(), "prisma/migrations");
  const bodies = readdirSync(migrationsDir)
    .filter((d) => statSync(path.join(migrationsDir, d)).isDirectory())
    .sort()
    .map((d) => readFileSync(path.join(migrationsDir, d, "migration.sql"), "utf8"))
    .filter((sql) => sql.includes("FUNCTION asset_class_invariants()"));
  if (bodies.length === 0) throw new Error("no migration defines asset_class_invariants()");
  const sql = bodies[bodies.length - 1];
  const listAfter = (cls: AssetClass): string[] => {
    const m = new RegExp(`NEW\\."cls" = '${cls}' AND NEW\\."status"::text NOT IN\\s*\\(([^)]*)\\)`).exec(sql);
    if (!m) throw new Error(`trigger has no NOT IN list for ${cls}`);
    return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  };
  it("IT", () => expect(sorted(listAfter("IT"))).toEqual(sorted(STATUSES_BY_CLASS.IT)));
  it("PURCHASING", () => expect(sorted(listAfter("PURCHASING"))).toEqual(sorted(STATUSES_BY_CLASS.PURCHASING)));
});
```

Run: `npx vitest run src/lib/asset-class.test.ts`
Expected: FAIL — `Cannot find module './asset-class'`.

- [ ] **Step 2: The module**

Create `src/lib/asset-class.ts`:

```ts
import type { AssetClass, AssetStatus, Role } from "@prisma/client";

/**
 * Phase 13. THE partition of AssetStatus into the two classes, and every rule
 * that follows from it. Nothing else in the codebase may hard-code which
 * status belongs to which class — it asks here.
 *
 * "Admin" in the 2026-09-02 meeting notes is the PURCHASING department; the
 * codebase's `admin` is the sysadmin role. Hence the class is PURCHASING.
 */
export const ASSET_CLASSES = ["IT", "PURCHASING"] as const satisfies readonly AssetClass[];

export const CLASS_LABEL: Record<AssetClass, string> = { IT: "IT", PURCHASING: "Purchasing" };

export const STATUSES_BY_CLASS = {
  IT: ["DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING"],
  PURCHASING: ["OPERATIONAL", "STORED", "REPAIRING", "RETIRED", "SOLD", "LOST"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** What a freshly registered or created asset reads. */
export const DEFAULT_STATUS = {
  IT: "SPARE", PURCHASING: "STORED",
} as const satisfies Record<AssetClass, AssetStatus>;

/** What lifecycle.assign lands on when the payload does not say. */
export const DEFAULT_ASSIGN_STATUS = {
  IT: "DEPLOYED", PURCHASING: "OPERATIONAL",
} as const satisfies Record<AssetClass, AssetStatus>;

/** Legal `to.status` for lifecycle.assign. */
export const ASSIGN_TARGETS = {
  IT: ["DEPLOYED", "TEMPORARY"], PURCHASING: ["OPERATIONAL"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** Legal `to.status` for lifecycle.return — the wizard's outcomes. */
export const RETURN_TARGETS = {
  IT: ["SPARE", "DEFECTIVE", "BUYOUT", "MISSING"], PURCHASING: ["STORED", "REPAIRING", "LOST"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** Offered on the create form (README 3b); anything beyond the default routes through an approval. */
export const CREATABLE_BY_CLASS = {
  IT: ["SPARE", "DEPLOYED", "TEMPORARY"], PURCHASING: ["STORED", "OPERATIONAL"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** Statuses an asset may hold WHILE assigned — the worker's change-status guard. */
export const HOLDER_STATUSES = ASSIGN_TARGETS;

/** Which classes a role may register, edit and request changes on. Finance and viewers act on none. */
export const MANAGEABLE_CLASSES: Record<Role, readonly AssetClass[]> = {
  admin: ["IT", "PURCHASING"],
  it_staff: ["IT"],
  purchasing_staff: ["PURCHASING"],
  finance_staff: [],
  viewer: [],
};

export function statusesFor(cls: AssetClass): readonly AssetStatus[] {
  return STATUSES_BY_CLASS[cls];
}

export function isStatusOf(cls: AssetClass, status: string): status is AssetStatus {
  return (STATUSES_BY_CLASS[cls] as readonly string[]).includes(status);
}

export function canManageClass(role: Role, cls: AssetClass): boolean {
  return MANAGEABLE_CLASSES[role].includes(cls);
}

/**
 * `?cls=` is a nav destination, not a config facet — the same shape as
 * `?purchaseYear=` (see inventory-list.ts's parsePurchaseYear). Invalid input
 * parses to null and the caller treats null as IT, so every URL that predates
 * this phase means exactly what it used to.
 */
export function parseCls(raw: string | null | undefined): AssetClass | null {
  return raw === "IT" || raw === "PURCHASING" ? raw : null;
}

/** Splice `cls` onto an already-serialized list query string. IT is the default and is never written. */
export function withClsQS(qs: string, cls: AssetClass | null): string {
  if (cls !== "PURCHASING") return qs;
  return qs ? `${qs}&cls=PURCHASING` : "?cls=PURCHASING";
}
```

- [ ] **Step 3: Run**

Run: `npx vitest run src/lib/asset-class.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 4: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/lib/asset-class.ts src/lib/asset-class.test.ts
git commit -m "feat(lib): asset-class — the status partition, class defaults and role rights"
```

Expected before commit: **873 tests / 51 files** (850 + 23); **881** after the D-6 review fixes.

---

### Task 3: Class-aware lifecycle rules — `approval-execution.ts`, the worker, the approval checks

**Files:**
- Modify: `src/lib/approval-execution.ts`, `src/lib/approval-execution.test.ts`
- Modify: `src/worker/execute-approval.ts`
- Modify: `src/server/modules/approvals/queries.ts`

`executionPlan` gains a third parameter, the asset's class, and validates every target against that class's set. The worker already loads the asset; it now reads the plan **after** the asset null-check so it has a class to pass.

- [ ] **Step 1: Update the existing tests for the new signature, and add the class cases**

In `src/lib/approval-execution.test.ts`, every existing `executionPlan(type, payload)` call gains a third argument `"IT"` — the existing behaviour is IT's behaviour. Then append inside the first `describe`:

```ts
  it("assign (PURCHASING): OPERATIONAL is the only legal target", () => {
    expect(executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "OPERATIONAL" } }, "PURCHASING"))
      .toEqual({ ok: true, updates: { assigneeId: "emp1", status: "OPERATIONAL" } });
    const wrong = executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "DEPLOYED" } }, "PURCHASING");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/OPERATIONAL/);
  });
  it("assign (IT): OPERATIONAL is refused — the class sets are disjoint both ways", () => {
    const plan = executionPlan("lifecycle_assign", { to: { assigneeId: "emp1", status: "OPERATIONAL" } }, "IT");
    expect(plan.ok).toBe(false);
  });
  it("return (PURCHASING): STORED / REPAIRING / LOST, never BUYOUT", () => {
    expect(executionPlan("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: "STORED" } }, "PURCHASING"))
      .toEqual({ ok: true, updates: { assigneeId: null, status: "STORED" } });
    const buyout = executionPlan("lifecycle_return", { from: { assigneeId: "e" }, to: { assigneeId: null, status: "BUYOUT" } }, "PURCHASING");
    expect(buyout.ok).toBe(false);
    if (!buyout.ok) expect(buyout.error).toMatch(/STORED, REPAIRING, LOST/);
  });
  it("change-status validates against the CLASS's set, not the whole enum", () => {
    // DEPLOYED is a perfectly valid AssetStatus — and illegal for a car.
    const plan = executionPlan("lifecycle_change_status", { from: { status: "STORED" }, to: { status: "DEPLOYED" } }, "PURCHASING");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/not a Purchasing status/);
    expect(executionPlan("lifecycle_change_status", { from: { status: "STORED" }, to: { status: "SOLD" } }, "PURCHASING"))
      .toEqual({ ok: true, updates: { status: "SOLD" } });
  });
```

And in the `summarizeApproval` tests (find the existing assign summary test), add:

```ts
  it("assign summary defaults to the CLASS's assign status when the payload omits one", () => {
    expect(summarizeApproval("lifecycle_assign", { to: { assigneeId: "e" } }, { assetTag: "BR-VH-0001", cls: "PURCHASING" }).line2)
      .toBe("→ OPERATIONAL");
    expect(summarizeApproval("lifecycle_assign", { to: { assigneeId: "e" } }, { assetTag: "BR-LT-0001" }).line2)
      .toBe("→ DEPLOYED");
  });
```

Run: `npx vitest run src/lib/approval-execution.test.ts`
Expected: FAIL — `tsc`-level: `Expected 2 arguments, but got 3` (vitest surfaces it as a type error or the new cases fail at runtime).

- [ ] **Step 1a: Delete the transition pin.** In `src/lib/asset-class.test.ts`, remove the `it` that pins `RETURN_TARGETS.IT` to `RETURN_STATUSES` and the `RETURN_STATUSES` import — this task deletes that constant (D-6).

- [ ] **Step 2: Rewrite `executionPlan` and `summarizeApproval`**

In `src/lib/approval-execution.ts`, replace the imports and everything down to the end of `executionPlan` with:

```ts
import type { ApprovalType, AssetClass, AssetStatus } from "@prisma/client";
import { APPROVAL_TYPE_LABEL } from "./labels";
import {
  ASSIGN_TARGETS, CLASS_LABEL, DEFAULT_ASSIGN_STATUS, RETURN_TARGETS, isStatusOf,
} from "./asset-class";

/**
 * Pure payload → planned asset update. The worker re-validates LIVE state
 * (employment, current holder, current status) inside its transaction —
 * this module only decides what a well-formed payload MEANS for an asset of
 * the given CLASS. Failures become EXECUTION_FAILED with the error stored
 * verbatim.
 *
 * `cls` is required, not defaulted: an approval can never execute a car into
 * DEPLOYED, and the only way to be sure is to make every caller say which
 * class it is executing against (Phase 13, spec §7).
 */
export type ExecutionPlan =
  | { ok: true; updates: { assigneeId?: string | null; status: AssetStatus } }
  | { ok: false; error: string };

type Payload = Record<string, unknown>;

const obj = (v: unknown): Payload | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function executionPlan(type: ApprovalType, payload: unknown, cls: AssetClass): ExecutionPlan {
  const p = obj(payload) ?? {};
  switch (type) {
    case "lifecycle_assign": {
      const to = obj(p.to);
      const assigneeId = to ? str(to.assigneeId) : null;
      const status = to ? str(to.status) : null;
      if (!assigneeId || !status) {
        return { ok: false, error: `Malformed lifecycle.assign payload: expected to.assigneeId and to.status, got ${JSON.stringify(payload)}` };
      }
      if (!(ASSIGN_TARGETS[cls] as readonly string[]).includes(status)) {
        return { ok: false, error: `lifecycle.assign target status for a ${CLASS_LABEL[cls]} asset must be ${ASSIGN_TARGETS[cls].join(" or ")}, got ${status}` };
      }
      return { ok: true, updates: { assigneeId, status: status as AssetStatus } };
    }
    case "lifecycle_return": {
      const to = obj(p.to);
      const status = to ? str(to.status) : null;
      // A return is the item coming back from a person; WHAT STATE it comes
      // back in is exactly what the offboarding wizard asks. The holder is
      // cleared either way — who it came from survives in from.assigneeId.
      if (!status) {
        return { ok: false, error: `Malformed lifecycle.return payload: expected to.status, got ${JSON.stringify(payload)}` };
      }
      // A disallowed target is not a malformed payload, and the operator reading
      // this in the retry UI needs the offending value, not a JSON blob.
      if (!(RETURN_TARGETS[cls] as readonly string[]).includes(status)) {
        return {
          ok: false,
          error: `lifecycle.return target status for a ${CLASS_LABEL[cls]} asset must be one of ${RETURN_TARGETS[cls].join(", ")}, got ${status}`,
        };
      }
      return { ok: true, updates: { assigneeId: null, status: status as AssetStatus } };
    }
    case "lifecycle_change_status": {
      const to = obj(p.to);
      const status = to ? str(to.status) : null;
      if (!status) {
        return { ok: false, error: `Malformed lifecycle.change-status payload: expected to.status, got ${JSON.stringify(payload)}` };
      }
      // Against the CLASS's set, not the whole enum: DEPLOYED is a valid
      // AssetStatus and an illegal one for a car. (A blind cast here once let
      // an out-of-enum value throw INSIDE the execution transaction.)
      if (!isStatusOf(cls, status)) {
        return { ok: false, error: `lifecycle.change-status target ${status} is not a ${CLASS_LABEL[cls]} status` };
      }
      return { ok: true, updates: { status } };
    }
    default:
      return { ok: false, error: `Execution guard: ${APPROVAL_TYPE_LABEL[type]} has no executor yet (arrives with its producing flow).` };
  }
}
```

Then in `summarizeApproval`, change the signature and the assign case:

```ts
export function summarizeApproval(
  type: ApprovalType,
  payload: unknown,
  names: { assetTag?: string | null; employeeName?: string | null; cls?: AssetClass },
): { line1: string; line2: string } {
```

and

```ts
    case "lifecycle_assign": {
      const fallback = DEFAULT_ASSIGN_STATUS[names.cls ?? "IT"];
      const status = to ? str(to.status) ?? fallback : fallback;
      const who = names.employeeName ? ` · ${names.employeeName}` : "";
      return { line1, line2: withReason(`→ ${status}${who}`) };
    }
```

`RETURN_STATUSES` is **gone**, not aliased -- an alias with no reader is exactly the dead code C-11 spent
264 lines deleting. Run `grep -rn RETURN_STATUSES src/ e2e/` and replace every hit with
`RETURN_TARGETS.IT` (import from `@/lib/asset-class`); Step 5 below covers the one in
`approvals/queries.ts`, and Task 4 covers `offboarding.test.ts`.

Run: `npx vitest run src/lib/approval-execution.test.ts`
Expected: PASS.

- [ ] **Step 3: Mutation-test the class checks — three of them, report all three**

Each must be shown to fail a test, then reverted:

1. In `lifecycle_assign`, change `ASSIGN_TARGETS[cls]` to `ASSIGN_TARGETS.IT` → the PURCHASING assign test must fail.
2. In `lifecycle_return`, change `RETURN_TARGETS[cls]` to `RETURN_TARGETS.IT` → the "never BUYOUT" test must fail.
3. In `lifecycle_change_status`, change `isStatusOf(cls, status)` to `isStatusOf("IT", status) || isStatusOf("PURCHASING", status)` → the "against the CLASS's set" test must fail.

Revert each. **Report the actual output for all three.**

- [ ] **Step 4: The worker — plan after the asset check, class-aware guards**

In `src/worker/execute-approval.ts`, replace:

```ts
    const plan = executionPlan(approval.type, approval.payload);
    if (!plan.ok) return fail(plan.error);
    if (!approval.assetId || !approval.asset) {
      return fail("Execution guard: approval has no asset attached — nothing to execute against");
    }
    const asset = approval.asset;
```

with:

```ts
    // The asset first: the plan needs its class, and an approval with no
    // asset has nothing to be planned against anyway.
    if (!approval.assetId || !approval.asset) {
      return fail("Execution guard: approval has no asset attached — nothing to execute against");
    }
    const asset = approval.asset;
    const plan = executionPlan(approval.type, approval.payload, asset.cls);
    if (!plan.ok) return fail(plan.error);
```

Replace the assign guard:

```ts
      if (asset.status !== "SPARE") {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, not SPARE — assignment refused`);
      }
```

with:

```ts
      if (asset.status !== DEFAULT_STATUS[asset.cls]) {
        return fail(`Execution guard: ${asset.tag} reads ${asset.status}, not ${DEFAULT_STATUS[asset.cls]} — assignment refused`);
      }
```

Replace the change-status holder guard line:

```ts
      const keepsHolder = plan.updates.status === "DEPLOYED" || plan.updates.status === "TEMPORARY";
```

with:

```ts
      const keepsHolder = (HOLDER_STATUSES[asset.cls] as readonly string[]).includes(plan.updates.status);
```

And add to the imports at the top of the file:

```ts
import { DEFAULT_STATUS, HOLDER_STATUSES } from "../lib/asset-class";
```

- [ ] **Step 5: The approval detail's two system checks**

In `src/server/modules/approvals/queries.ts`:

Change the import line `import { RETURN_STATUSES, summarizeApproval } from "@/lib/approval-execution";` to:

```ts
import { summarizeApproval } from "@/lib/approval-execution";
import { DEFAULT_STATUS, RETURN_TARGETS } from "@/lib/asset-class";
```

In the `lifecycle_assign` case, replace:

```ts
          ? { label: "Asset is assignable", pass: asset.status === "SPARE", detail: `reads ${asset.status} right now` }
```

with:

```ts
          ? { label: "Asset is assignable", pass: asset.status === DEFAULT_STATUS[asset.cls], detail: `reads ${asset.status} right now` }
```

In the `lifecycle_return` case, replace:

```ts
          pass: target !== null && (RETURN_STATUSES as readonly string[]).includes(target),
```

with:

```ts
          pass: target !== null && asset !== null && (RETURN_TARGETS[asset.cls] as readonly string[]).includes(target),
```

⚠️ `asset` in that scope is the approval's asset row (already loaded a few lines above for `assetCheck`). If its select does not include `cls`, add `cls: true` to that select — do not guess; read the query directly above the `switch`. **Every other call to `summarizeApproval` in this file** should pass `cls: approval.asset?.cls` in its `names` object where the asset is available; where it is not, leave it and the IT default applies.

- [ ] **Step 6: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/lib/approval-execution.ts src/lib/approval-execution.test.ts src/worker/execute-approval.ts src/server/modules/approvals/queries.ts
git commit -m "feat(approvals): lifecycle rules validate targets against the asset's class"
```

---

### Task 4: Class-keyed offboarding outcomes — no Buyout for a car

**Files:**
- Modify: `src/lib/offboarding.ts`, `src/lib/offboarding.test.ts`
- Modify: `src/server/modules/offboarding/actions.ts`, `src/server/modules/offboarding/queries.ts`
- Modify: `src/components/offboarding/item-decision.tsx`
- Modify: `src/app/(app)/offboarding/[employeeId]/page.tsx`

The old `OUTCOME_STATUS` export is **removed**, not aliased, so every consumer fails to compile until it says which class it means.

- [ ] **Step 1: Failing tests**

In `src/lib/offboarding.test.ts`, the import line changes from `OUTCOME_STATUS` to `OUTCOME_STATUS_BY_CLASS, outcomeStatus, outcomesFor`, and the two existing `OUTCOME_STATUS` assertions (around lines 16 and 26) become:

```ts
    expect(OUTCOME_STATUS_BY_CLASS.IT).toEqual({
      RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
    });
```

and

```ts
    expect(new Set(Object.values(OUTCOME_STATUS_BY_CLASS.IT))).toEqual(new Set(RETURN_TARGETS.IT));
```

(import `RETURN_TARGETS` from `./asset-class` in place of `RETURN_STATUSES` from `./approval-execution`). Then append:

```ts
describe("outcomes by class (Phase 13)", () => {
  it("Purchasing offers Returned / Defective / Missing — Buyout does not exist for a company car", () => {
    expect(outcomesFor("PURCHASING")).toEqual(["RETURNED", "DEFECTIVE", "MISSING"]);
    expect(outcomesFor("IT")).toEqual(OUTCOMES);
  });
  it("Purchasing outcomes land on Purchasing statuses", () => {
    expect(outcomeStatus("PURCHASING", "RETURNED")).toBe("STORED");
    expect(outcomeStatus("PURCHASING", "DEFECTIVE")).toBe("REPAIRING");
    expect(outcomeStatus("PURCHASING", "MISSING")).toBe("LOST");
    expect(outcomeStatus("PURCHASING", "BUYOUT")).toBeNull();
    expect(outcomeStatus("IT", "BUYOUT")).toBe("BUYOUT");
  });
  it("every class's outcome map is a subset of that class's return targets", () => {
    for (const cls of ["IT", "PURCHASING"] as const) {
      for (const s of Object.values(OUTCOME_STATUS_BY_CLASS[cls])) {
        expect(RETURN_TARGETS[cls]).toContain(s);
      }
    }
  });
  it("outcomeOfStatus reads both vocabularies", () => {
    expect(outcomeOfStatus("SPARE")).toBe("RETURNED");
    expect(outcomeOfStatus("STORED")).toBe("RETURNED");
    expect(outcomeOfStatus("LOST")).toBe("MISSING");
    expect(outcomeOfStatus("DEPLOYED")).toBeNull();
  });
});
```

Run: `npx vitest run src/lib/offboarding.test.ts` — Expected: FAIL (missing exports).

- [ ] **Step 2: The lib**

In `src/lib/offboarding.ts`, replace the `OUTCOME_STATUS` block:

```ts
/** What the worker will set the asset to — the payload's `to.status`. */
export const OUTCOME_STATUS: Record<Outcome, AssetStatus> = {
  RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
};
```

with:

```ts
/**
 * What the worker will set the asset to — the payload's `to.status` — per
 * CLASS (Phase 13). Purchasing has no Buyout: nobody buys out a company car or
 * a desk through the leaver wizard, so the key is simply absent, and
 * `outcomesFor` derives the offered set from what is present.
 */
export const OUTCOME_STATUS_BY_CLASS: Record<AssetClass, Partial<Record<Outcome, AssetStatus>>> = {
  IT: { RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING" },
  PURCHASING: { RETURNED: "STORED", DEFECTIVE: "REPAIRING", MISSING: "LOST" },
};

/** The outcomes the wizard offers for an asset of this class, in README 3e order. */
export function outcomesFor(cls: AssetClass): readonly Outcome[] {
  return OUTCOMES.filter((o) => OUTCOME_STATUS_BY_CLASS[cls][o] !== undefined);
}

/** The status an outcome lands on for this class, or null if the class does not offer it. */
export function outcomeStatus(cls: AssetClass, outcome: Outcome): AssetStatus | null {
  return OUTCOME_STATUS_BY_CLASS[cls][outcome] ?? null;
}
```

Change the type import at the top to `import type { AssetClass, AssetStatus } from "@prisma/client";`.

Replace `outcomeOfStatus`:

```ts
/** Reverse of the outcome maps, across BOTH classes: what a stored payload's target status meant. */
export function outcomeOfStatus(status: string | null | undefined): Outcome | null {
  for (const cls of ["IT", "PURCHASING"] as const) {
    const hit = OUTCOMES.find((o) => OUTCOME_STATUS_BY_CLASS[cls][o] === status);
    if (hit) return hit;
  }
  return null;
}
```

Run: `npx vitest run src/lib/offboarding.test.ts` — Expected: PASS.

- [ ] **Step 3: The action validates the outcome for the asset's class**

In `src/server/modules/offboarding/actions.ts`, update the import from `@/lib/offboarding` to include `outcomeStatus, outcomesFor` and drop `OUTCOME_STATUS`; add `import { CLASS_LABEL } from "@/lib/asset-class";`. Then, inside the transaction, directly after the `if (asset.assigneeId !== d.employeeId)` refusal, add:

```ts
      // A car has no Buyout. Validated HERE, against the asset's class, not
      // at parse time — the outcome is legal for the enum and illegal for
      // this asset, and only the asset knows which it is.
      if (!outcomesFor(asset.cls).includes(d.outcome)) {
        return validationError({ outcome: `${OUTCOME_LABEL[d.outcome]} is not an outcome for a ${CLASS_LABEL[asset.cls]} asset.` });
      }
      const targetStatus = outcomeStatus(asset.cls, d.outcome)!;
```

and in the `createApproval` payload replace `status: OUTCOME_STATUS[d.outcome]` with `status: targetStatus`.

- [ ] **Step 4: Held items carry their class**

In `src/server/modules/offboarding/queries.ts`, the `held` query already does `include: { category: true }`, so each row has `cls`. Find where `held` rows are mapped into the items the page renders (the object that has `assetId`, `tag`, `blockedBy`, …) and add **`cls: a.cls,`** beside `tag` (use whatever the row variable is called in that map). Add `cls: AssetClass` to the item's exported type in the same file, importing `type AssetClass` from `@prisma/client`.

- [ ] **Step 5: The decision control**

In `src/components/offboarding/item-decision.tsx`:

- Import: replace `OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, reasonRequired, type Outcome` with `OUTCOME_LABEL, outcomeStatus, outcomesFor, reasonRequired, type Outcome`, and add `import type { AssetClass } from "@prisma/client";`.
- Props: add `cls: AssetClass` to the destructured props and their type.
- Directly after `const outcomeErrorId = …`, add `const outcomes = outcomesFor(cls);`.
- `const picked = (OUTCOMES as readonly string[]).includes(outcome) ? … : null;` becomes `const picked = (outcomes as readonly string[]).includes(outcome) ? (outcome as Outcome) : null;`
- Both `OUTCOME_STATUS[picked]` occurrences become `outcomeStatus(cls, picked)`.
- `options={OUTCOMES.map(…)}` becomes `options={outcomes.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}`.

In `src/app/(app)/offboarding/[employeeId]/page.tsx`, the render becomes:

```tsx
                      <ItemDecision employeeId={employeeId} assetId={i.assetId} tag={i.tag} cls={i.cls} />
```

- [ ] **Step 6: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/lib/offboarding.ts src/lib/offboarding.test.ts src/server/modules/offboarding src/components/offboarding/item-decision.tsx "src/app/(app)/offboarding/[employeeId]/page.tsx"
git commit -m "feat(offboarding): outcomes are keyed by class — a car cannot be bought out"
```

---

### Task 5: `cls` through the list — `buildAssetWhere`, queries, export, bulk filters

**Files:**
- Modify: `src/lib/inventory-list.ts`, `src/lib/inventory-list.test.ts`
- Modify: `src/server/modules/inventory/queries.ts`
- Modify: `src/app/(app)/inventory/export/route.ts`
- Modify: `src/server/modules/inventory/actions.ts` (the `filters` branch of bulk only — the rest is Task 6)

- [ ] **Step 1: Failing tests**

In `src/lib/inventory-list.test.ts`, append:

```ts
describe("buildAssetWhere — class (Phase 13)", () => {
  const empty = { q: "", page: 1, sort: [], filters: {} };
  it("defaults to IT, so every pre-Phase-13 URL means what it used to", () => {
    expect(buildAssetWhere(empty).cls).toBe("IT");
    expect(buildAssetWhere(empty, null).cls).toBe("IT");
  });
  it("filters to the requested class", () => {
    expect(buildAssetWhere(empty, null, "PURCHASING").cls).toBe("PURCHASING");
  });
  it("a status filter outside the class is dropped, not passed through", () => {
    // ?status=SPARE on the Purchasing view is a stale link, not a query
    const w = buildAssetWhere({ ...empty, filters: { status: ["SPARE", "STORED"] } }, null, "PURCHASING");
    expect(w.status).toEqual({ in: ["STORED"] });
  });
  it("ASSET_STATUSES is now every status of both classes", () => {
    expect(ASSET_STATUSES).toHaveLength(14);
    expect(ASSET_STATUSES).toEqual([...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING]);
  });
});
```

(add `STATUSES_BY_CLASS` from `./asset-class` to the test's imports, and `ASSET_STATUSES` from `./inventory-list` if it is not already imported there.)

Run: `npx vitest run src/lib/inventory-list.test.ts` — Expected: FAIL.

- [ ] **Step 1a: Delete the transition pin.** In `src/lib/asset-class.test.ts`, remove the `it` that pins `STATUSES_BY_CLASS.IT` to `ASSET_STATUSES` and, if nothing else in that file uses it, the `ASSET_STATUSES` import — this task widens that constant to fourteen (D-6).

- [ ] **Step 2: `inventory-list.ts`**

Replace the `ASSET_STATUSES` definition:

```ts
import type { AssetClass, AssetStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";
import { isRepairStage } from "./repairs";
import { STATUSES_BY_CLASS, isStatusOf } from "./asset-class";

/**
 * EVERY status of BOTH classes (Phase 13) — the flat list for the places that
 * genuinely mean "any valid value" (zod enums on request payloads, the import
 * wizard's error text). A control that offers statuses to a person must use
 * `statusesFor(cls)` instead; offering DEPLOYED for a car is a bug.
 */
export const ASSET_STATUSES = [
  ...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING,
] as const satisfies readonly AssetStatus[];
```

Change `buildAssetWhere`'s signature and the status filter:

```ts
export function buildAssetWhere(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
  cls: AssetClass = "IT",
): Prisma.AssetWhereInput {
  // Class first: it is the one filter that is ALWAYS applied. IT by default
  // so that every consumer and every URL that predates Phase 13 behaves
  // identically — the Purchasing view is the one that has to ask for itself.
  const where: Prisma.AssetWhereInput = { cls };
```

and

```ts
  const statuses = (f.status ?? []).filter((s): s is AssetStatus => isStatusOf(cls, s));
```

Run: `npx vitest run src/lib/inventory-list.test.ts` — Expected: PASS.

- [ ] **Step 3: Thread `cls` through `queries.ts`**

In `src/server/modules/inventory/queries.ts`:

- Add `import type { AssetClass } from "@prisma/client";` and `import { statusesFor } from "@/lib/asset-class";`.
- `repairStageIds(state, purchaseYear = null, cls: AssetClass = "IT")` → `buildAssetWhere(state, purchaseYear, cls)`.
- `listAssets(state, purchaseYear = null, cls: AssetClass = "IT")` → `buildAssetWhere(state, purchaseYear, cls)`.
- `facetOptions(state, purchaseYear = null, cls: AssetClass = "IT")`: every `buildAssetWhere(without(...), purchaseYear)` gains `, cls`; the two reference lists are scoped to the class —
  `prisma.assetCategory.findMany({ where: { cls }, orderBy: { name: "asc" } })` and
  `prisma.assetType.findMany({ where: { category: { cls } }, orderBy: { name: "asc" }, include: { category: true } })`;
  and the status options become `status: statusesFor(cls).map((s) => ({ value: s, label: s, count: … }))`.
- `purchaseYearBuckets(state, cls: AssetClass = "IT")` → `buildAssetWhere(state, null, cls)`.

- [ ] **Step 4: The export route and bulk's `filters` branch**

In `src/app/(app)/inventory/export/route.ts`: add `import { parseCls } from "@/lib/asset-class";`, then next to the `purchaseYear` parse add `const cls = parseCls(url.searchParams.get("cls")) ?? "IT";`, and pass `cls` as the third argument to both `repairStageIds(...)` and `buildAssetWhere(...)`.

In `src/server/modules/inventory/actions.ts`, inside `bulkRequestStatusChange`'s `else` branch, after the `purchaseYear` line:

```ts
    const cls = parseCls(filterParams.get("cls")) ?? "IT";
    const cutIds = await repairStageIds(state, purchaseYear, cls);
    where = cutIds !== null ? { id: { in: cutIds } } : buildAssetWhere(state, purchaseYear, cls);
```

(replacing the two existing lines), and add `parseCls` to the file's imports from `@/lib/asset-class` — you will extend that import further in Task 6.

- [ ] **Step 5: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/lib/inventory-list.ts src/lib/inventory-list.test.ts src/server/modules/inventory/queries.ts "src/app/(app)/inventory/export/route.ts" src/server/modules/inventory/actions.ts
git commit -m "feat(inventory): the list, facets, export and bulk filters are scoped by class"
```

---

### Task 6: The write paths — class gates on register, create, edit, request, bulk

**Files:**
- Modify: `src/lib/asset-rules.ts`
- Modify: `src/server/modules/purchases/receiving.ts`
- Modify: `src/server/modules/inventory/actions.ts`
- Modify: `src/server/modules/employees/actions.ts`
- Modify: `src/server/modules/admin/reference-actions.ts`

**The rule, once:** a role may REGISTER, CREATE, EDIT or REQUEST A STATUS CHANGE on an asset (or register into a category) only if `canManageClass(user.role, cls)`. Finance and viewers do none of those. `admin` does both classes. Assign / return through `/employees`, offboarding, approvals and Finance confirmation are **shared** and are not gated by class (spec §5 intro, §7, §8 — D-13).

- [ ] **Step 0: Delete the transition pin.** In `src/lib/asset-class.test.ts`, remove the `it` that pins `CREATABLE_BY_CLASS.IT` to `CREATABLE_STATUSES` and the `CREATABLE_STATUSES` import — this task widens that constant to both classes (D-6).

- [ ] **Step 1: `creationPlan` learns its class**

Replace `src/lib/asset-rules.ts`'s first section (down to and including `creationPlan`) with:

```ts
import type { AssetClass, AssetStatus } from "@prisma/client";
import { CREATABLE_BY_CLASS, DEFAULT_STATUS } from "./asset-class";

/** Re-exported for the form; the source of truth is asset-class.ts (Phase 13). */
export { CREATABLE_BY_CLASS };

/** Any creatable status of either class — the zod enum on the create payload. */
export const CREATABLE_STATUSES = [
  ...CREATABLE_BY_CLASS.IT, ...CREATABLE_BY_CLASS.PURCHASING,
] as const satisfies readonly AssetStatus[];
export type CreatableStatus = (typeof CREATABLE_STATUSES)[number];

export type CreationPlan =
  | { ok: true; status: AssetStatus; approval: null | { toStatus: AssetStatus; assigneeId: string } }
  | { ok: false; error: "assignee_required" | "not_creatable_for_class" };

/**
 * Assets are always CREATED in their class's default state (SPARE / STORED).
 * Requesting anything else yields a lifecycle.assign approval — the worker
 * performs the flip, and until then the asset honestly reads its default.
 */
export function creationPlan(requested: CreatableStatus, assigneeId: string | null, cls: AssetClass): CreationPlan {
  if (!(CREATABLE_BY_CLASS[cls] as readonly string[]).includes(requested)) {
    return { ok: false, error: "not_creatable_for_class" };
  }
  const base = DEFAULT_STATUS[cls];
  if (requested === base) return { ok: true, status: base, approval: null };
  if (!assigneeId) return { ok: false, error: "assignee_required" };
  return { ok: true, status: base, approval: { toStatus: requested, assigneeId } };
}
```

If `src/lib/asset-rules.test.ts` exists, add `"IT"` as the third argument to every `creationPlan` call and add:

```ts
  it("Purchasing creates as STORED and an OPERATIONAL request becomes an assign approval", () => {
    expect(creationPlan("STORED", null, "PURCHASING")).toEqual({ ok: true, status: "STORED", approval: null });
    expect(creationPlan("OPERATIONAL", "e1", "PURCHASING")).toEqual({ ok: true, status: "STORED", approval: { toStatus: "OPERATIONAL", assigneeId: "e1" } });
  });
  it("a status the class cannot be created in is refused by name", () => {
    expect(creationPlan("DEPLOYED", "e1", "PURCHASING")).toEqual({ ok: false, error: "not_creatable_for_class" });
    expect(creationPlan("STORED", null, "IT")).toEqual({ ok: false, error: "not_creatable_for_class" });
  });
```

- [ ] **Step 2: `registerAssets`**

In `src/server/modules/purchases/receiving.ts`:

Imports — add `import { CLASS_LABEL, DEFAULT_STATUS, canManageClass } from "@/lib/asset-class";`.

Replace `const user = await actionRole("admin", "it_staff");` with `const user = await actionRole("admin", "it_staff", "purchasing_staff");`.

Directly after `if (dupe) return conflict(...)`, add:

```ts
  // The category decides the class; the class decides who may register into
  // it. Finance and viewers never reach here (actionRole above), so the only
  // refusal this produces is IT registering a Purchasing category or vice
  // versa — named, because "forbidden" would not say what to do instead.
  const category = await prisma.assetCategory.findUnique({
    where: { id: d.categoryId },
    select: { name: true, cls: true },
  });
  if (!category) return validationError({ categoryId: "Unknown category" });
  if (!canManageClass(user.role, category.cls)) {
    return validationError({
      categoryId: `${category.name} is a ${CLASS_LABEL[category.cls]} category — ${CLASS_LABEL[category.cls]} staff register ${CLASS_LABEL[category.cls]} assets.`,
    });
  }
```

Inside the create, replace `status: "SPARE",` with:

```ts
            status: DEFAULT_STATUS[category.cls],
            cls: category.cls,
```

and in the audit diff replace `status: { from: null, to: "SPARE" },` with `status: { from: null, to: DEFAULT_STATUS[category.cls] },`.

- [ ] **Step 3: `createAsset`, `updateAsset`, `requestStatusChange`, `bulkRequestStatusChange`**

In `src/server/modules/inventory/actions.ts`, extend the `@/lib/asset-class` import to:

```ts
import { CLASS_LABEL, DEFAULT_STATUS, canManageClass, isStatusOf, parseCls } from "@/lib/asset-class";
```

**`createAsset`:**
- `actionRole("admin", "it_staff", "purchasing_staff")`.
- Replace the block from `const plan = creationPlan(...)` through the `if (!plan.ok)` line with:

```ts
  const category = await prisma.assetCategory.findUnique({ where: { id: d.categoryId }, select: { name: true, cls: true } });
  if (!category) return validationError({ categoryId: "Unknown category" });
  if (!canManageClass(user.role, category.cls)) {
    return validationError({ categoryId: `${category.name} is a ${CLASS_LABEL[category.cls]} category — ${CLASS_LABEL[category.cls]} staff create ${CLASS_LABEL[category.cls]} assets.` });
  }
  const plan = creationPlan(d.requestedStatus, d.assigneeId || null, category.cls);
  if (!plan.ok) {
    return plan.error === "assignee_required"
      ? validationError({ assigneeId: "Pick who this deploys to" })
      : validationError({ requestedStatus: `${d.requestedStatus} is not an initial state for a ${CLASS_LABEL[category.cls]} asset.` });
  }
```

- In the `tx.asset.create` data, replace `status: "SPARE",` with `status: plan.status, cls: category.cls,`; in the audit diff replace `to: "SPARE"` with `to: plan.status`.

**`updateAsset`:**
- `actionRole("admin", "it_staff", "purchasing_staff")`.
- After `if (!asset) return conflict("That asset no longer exists.");` add:

```ts
  if (!canManageClass(user.role, asset.cls)) return forbidden();
  if (d.categoryId !== asset.categoryId) {
    // Same class only. A category change across classes would flip the
    // asset's class and invalidate its status; the trigger would refuse it,
    // but the person deserves the reason, not a database error.
    const target = await prisma.assetCategory.findUnique({ where: { id: d.categoryId }, select: { name: true, cls: true } });
    if (!target) return validationError({ categoryId: "Unknown category" });
    if (target.cls !== asset.cls) {
      return validationError({ categoryId: `${target.name} is a ${CLASS_LABEL[target.cls]} category; this is a ${CLASS_LABEL[asset.cls]} asset.` });
    }
  }
```

**`requestStatusChange`:**
- `actionRole("admin", "it_staff", "purchasing_staff")`.
- Inside the transaction, after `if (!asset) return conflict(...)`, add:

```ts
      if (!canManageClass(user.role, asset.cls)) return forbidden();
      if (!isStatusOf(asset.cls, d.to)) {
        return validationError({ to: `${d.to} is not a ${CLASS_LABEL[asset.cls]} status.` });
      }
```

**`bulkRequestStatusChange`:**
- `actionRole("admin", "it_staff", "purchasing_staff")`.
- Change the `findMany` select to `select: { id: true, status: true, cls: true }`.
- Directly after the `BULK_MAX` refusal, add:

```ts
      // No status is valid for both a laptop and a desk, so a mixed selection
      // has no legal target. The list is class-scoped, so this is unreachable
      // from the UI — it guards a hand-built request.
      const classes = new Set(assets.map((a) => a.cls));
      if (classes.size > 1) return conflict("Select assets of one class — IT and Purchasing assets cannot share a status change.");
      const cls = assets[0].cls;
      if (!canManageClass(user.role, cls)) return forbidden();
      if (!isStatusOf(cls, to)) return validationError({ to: `${to} is not a ${CLASS_LABEL[cls]} status.` });
```

- [ ] **Step 4: The three literals in `employees/actions.ts`**

In `src/server/modules/employees/actions.ts`, add `import { ASSIGNABLE_FROM, DEFAULT_ASSIGN_STATUS, DEFAULT_STATUS } from "@/lib/asset-class";` and:

- The assign action's `if (asset.status !== "SPARE") return conflict(\`${asset.tag} is ${asset.status}, not SPARE — only spares can be assigned.\`);` becomes
  `if (asset.status !== ASSIGNABLE_FROM[asset.cls]) return conflict(\`${asset.tag} is ${asset.status}, not ${ASSIGNABLE_FROM[asset.cls]} — only idle stock can be assigned.\`);`
- Its payload `to: { assigneeId: d.employeeId, status: "DEPLOYED" }` becomes `to: { assigneeId: d.employeeId, status: DEFAULT_ASSIGN_STATUS[asset.cls] }`.
- The return action's `to: { assigneeId: null, status: "SPARE" }` becomes `to: { assigneeId: null, status: DEFAULT_STATUS[asset.cls] }`.
- The reservation-fulfilment loop's `if (hold.asset.status !== "SPARE") continue;` becomes `if (hold.asset.status !== ASSIGNABLE_FROM[hold.asset.cls]) continue;` and its payload's `status: "DEPLOYED"` becomes `status: DEFAULT_ASSIGN_STATUS[hold.asset.cls]`. (`hold.asset` is already included there; if `cls` is not selected, add it.)

- [ ] **Step 5: Categories are created WITH a class**

In `src/server/modules/admin/reference-actions.ts`:

```ts
const createSchema = z.object({
  entity: entitySchema,
  name: nameSchema,
  categoryId: z.string().optional(), // types only
  cls: z.enum(["IT", "PURCHASING"]).optional(), // categories only (Phase 13); defaults to IT
});
```

and in `createRefRow`, `const { entity, name, categoryId } = parsed.data;` becomes `const { entity, name, categoryId, cls } = parsed.data;`, and the category create becomes:

```ts
      if (entity === "category") id = (await tx.assetCategory.create({ data: { name, cls: cls ?? "IT" } })).id;
```

with the audit diff for a category also recording the class: change that `diff:` to `diff: entity === "category" ? { name: { from: null, to: name }, cls: { from: null, to: cls ?? "IT" } } : { name: { from: null, to: name } },`.

- [ ] **Step 5a: The write path the plan missed, the fourth literal, and the article (D-13)**

- `resubmitAssetToFinance` in `src/server/modules/inventory/actions.ts`: `actionRole("admin", "it_staff", "purchasing_staff")`;
  add `cls: true` to its asset `select`; after the `!asset` guard, refuse with `forbidden()` unless
  `canManageClass(user.role, asset.cls)`. Resubmit is the department's own action, like register.
- `src/app/(app)/employees/[id]/page.tsx`: the spare picker's `where: { status: "SPARE" }` becomes
  `where: { cls: "IT", status: ASSIGNABLE_FROM.IT }` with a comment: assignment through `/employees` is IT's surface in
  this phase; pinned explicitly so the picker never offers a STORED car by accident.
- `src/lib/asset-class.ts` gains `CLASS_PHRASE: Record<AssetClass, string> = { IT: "an IT", PURCHASING: "a Purchasing" }`;
  every `a ${CLASS_LABEL[x]}` in `src/` becomes `${CLASS_PHRASE[x]}` (six sites in this task's files, one in
  `offboarding/actions.ts`); one unit test pins the article to the label. `grep -rn 'a \${CLASS_LABEL' src/` must be empty.
- `src/server/modules/import/asset-actions.ts`: the comment claiming `creationPlan` "guarantees SPARE-only direct
  creation" now says `DEFAULT_STATUS[cls]`-only.

Expected after this step: **895 tests / 51 files.**

- [ ] **Step 6: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/lib/asset-rules.ts src/lib/asset-rules.test.ts src/server/modules/purchases/receiving.ts src/server/modules/inventory/actions.ts src/server/modules/employees/actions.ts src/server/modules/admin/reference-actions.ts
git commit -m "feat(inventory): each class is registered, edited and requested by its own department"
```

(`git add` of `asset-rules.test.ts` only if it exists.)

---

### Task 7: Routing and page gates — register opens to Purchasing; Secrets closes to Purchasing assets

**Files:**
- Modify: `src/lib/workspaces.ts`, `src/lib/workspaces.test.ts`
- Modify: `src/app/(app)/inventory/register/page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`
- Modify: `src/app/(app)/inventory/[id]/secrets/page.tsx`, `[id]/layout.tsx`
- Modify: `src/components/inventory/record-tabs.tsx`
- Modify: `src/app/(app)/admin/equipment-policies/page.tsx`

- [ ] **Step 1: Failing PATH_RULES test**

In `src/lib/workspaces.test.ts`, change `["/inventory/register", "purchasing_staff", false],` to `["/inventory/register", "purchasing_staff", true],` and update the comment above it: the rule now admits purchasing because Purchasing registers Purchasing-class assets, and **the class check moved server-side** (`registerAssets`). `finance_staff` and `viewer` stay `false`.

Run: `npx vitest run src/lib/workspaces.test.ts` — Expected: 1 failure.

- [ ] **Step 2: The rule and the nav**

In `src/lib/workspaces.ts`, replace the `/inventory/register` rule and its comment:

```ts
  // Phase 13: registering is each department's own — IT registers IT-class
  // categories, Purchasing registers Purchasing-class ones — so BOTH
  // workspaces are admitted here and `registerAssets` refuses the wrong class
  // by name. This MUST still precede the general /inventory rule below,
  // because that rule admits finance and viewer, and neither registers
  // anything. The ORDERING is asserted only in workspaces.test.ts.
  { test: /^\/inventory\/register(\/|$)/, workspaces: ["it", "purchasing"], roles: ["admin", "it_staff", "purchasing_staff"] },
```

In the purchasing nav, replace the Reference section:

```ts
    {
      heading: "Assets",
      items: [
        { label: "Purchasing assets", href: "/inventory?cls=PURCHASING" },
        { label: "Register assets", href: "/inventory/register", roles: ["admin", "purchasing_staff"] },
      ],
    },
    { heading: "Reference", items: [{ label: "IT inventory", href: "/inventory" }] },
```

Run: `npx vitest run src/lib/workspaces.test.ts` — Expected: PASS.

- [ ] **Step 3: The three form pages**

`src/app/(app)/inventory/register/page.tsx`:

```ts
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
```

and the categories query becomes:

```ts
    prisma.assetCategory.findMany({
      where: { cls: { in: [...MANAGEABLE_CLASSES[user.role]] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
```

(import `MANAGEABLE_CLASSES` from `@/lib/asset-class`). Types are filtered the same way through their category: `prisma.assetType.findMany({ where: { category: { cls: { in: [...MANAGEABLE_CLASSES[user.role]] } } }, select: …, orderBy: … })`.

`src/app/(app)/inventory/new/page.tsx`: same `requireRole` and the same two `where` clauses; the `categories.map` passed to `AssetForm` becomes `categories.map((c) => ({ id: c.id, name: c.name, cls: c.cls }))`.

`src/app/(app)/inventory/[id]/edit/page.tsx`: `requireRole("admin", "it_staff", "purchasing_staff")`, then after `if (!asset) notFound();` add `if (!canManageClass(user.role, asset.cls)) redirect(ROLE_LANDING[user.role]);` (import `redirect` from `next/navigation`, `ROLE_LANDING` from `@/lib/workspaces`, `canManageClass` from `@/lib/asset-class`; capture `const user = await requireRole(...)`). Categories and types are filtered to **the asset's own class**: `where: { cls: asset.cls }` / `where: { category: { cls: asset.cls } }`. The `categories.map` gains `cls: c.cls`.

- [ ] **Step 4: Secrets closes; the record shows its class**

`src/app/(app)/inventory/[id]/secrets/page.tsx`, after `if (!asset) notFound();`:

```ts
  // A car has no credentials. 404 rather than 403: the tab is not rendered
  // for this class, so a request here is a typed URL, and "there is nothing
  // here" is the true answer.
  if (asset.cls === "PURCHASING") notFound();
```

`src/components/inventory/record-tabs.tsx`: the signature becomes `export function RecordTabs({ assetId, cls }: { assetId: string; cls: AssetClass })` (import `type AssetClass` from `@prisma/client`), and the Secrets entry is wrapped: build `items` as before, then `.filter((t) => cls === "IT" || !t.href.endsWith("/secrets"))` before the `.map`.

`src/app/(app)/inventory/[id]/layout.tsx`:
- Import `CLASS_LABEL, canManageClass` from `@/lib/asset-class`.
- `const canMutate = canManageClass(user.role, asset.cls);`
- `const canResubmit = canManageClass(user.role, asset.cls) && returned;` (Purchasing marks its own registrations corrected.)
- In the badge span, directly after `<StatusPill value={asset.status} />`: `<Pill>{CLASS_LABEL[asset.cls].toUpperCase()}</Pill>`.
- `<RequestStatusChange assetId={asset.id} currentStatus={asset.status} cls={asset.cls} />`.
- `<RecordTabs assetId={asset.id} cls={asset.cls} />`.

- [ ] **Step 4a: `RequestStatusChange` takes the class** (here, not Task 8, so this task's `tsc` is green on its own)

In `src/components/inventory/request-status-change.tsx`:

```ts
import type { AssetClass } from "@prisma/client";
import { statusesFor } from "@/lib/asset-class";
```

(remove the `ASSET_STATUSES` import). Signature: `({ assetId, currentStatus, cls }: { assetId: string; currentStatus: string; cls: AssetClass })`. `const options = statusesFor(cls).filter((s) => s !== currentStatus);`

- [ ] **Step 4b: Finance's send-back copy names the class it is sending back to (D-13)**

`src/components/inventory/finance-review.tsx`: add prop `cls: AssetClass` (import `type AssetClass` from `@prisma/client` and
`CLASS_LABEL` from `@/lib/asset-class`). The three IT-specific strings become class-aware: `done: "sent back to IT"` →
`done: `sent back to ${CLASS_LABEL[cls]}``; the blurb's "IT sees this reason on the record…" → ``${CLASS_LABEL[cls]} sees this reason on the record, …``;
the button `Send back to IT` → `Send back to {CLASS_LABEL[cls]}`. If those strings live in a constant outside the component, turn it
into a function of `cls` (or index a per-class record) — do not duplicate the object. Reword the component's docblock so
"IT" becomes "the registering department" where it means the department, and leave a one-line comment on the
`returnAssetToIt` import: the action keeps its Phase 12 name; it sends the record back to whichever department registered it.

`src/app/(app)/inventory/[id]/layout.tsx`: pass `cls={asset.cls}` to `<FinanceReview …>`.

`src/server/modules/inventory/actions.ts`: the docstring on `resubmitAssetToFinance` — "IT says 'fixed, look again'" and "an IT
staffer correcting an unrelated field" — becomes class-neutral ("the registering department says…", "a staffer correcting…").

If a unit or e2e test asserts the literal "sent back to IT" / "Send back to IT", update it to the IT-class rendering
(the seeded send-back fixtures are IT assets, so the visible text is unchanged there) and say which test.

- [ ] **Step 5: Equipment policies offer IT types only**

In `src/app/(app)/admin/equipment-policies/page.tsx`:

```ts
    prisma.assetType.findMany({ where: { category: { cls: "IT" } }, include: { category: true }, orderBy: [{ name: "asc" }] }),
```

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/lib/workspaces.ts src/lib/workspaces.test.ts "src/app/(app)/inventory" src/components/inventory/record-tabs.tsx src/components/inventory/request-status-change.tsx src/components/inventory/finance-review.tsx src/server/modules/inventory/actions.ts "src/app/(app)/admin/equipment-policies/page.tsx"
git commit -m "feat(routes): register opens to Purchasing; Secrets and leaver kits stay IT"
```

---

### Task 8: Class-aware controls — status pickers, the create form, the category table

**Files:**
- Modify: `src/components/inventory/bulk-drawer.tsx`, `inventory-table.tsx`, `asset-form.tsx`
- Modify: `src/components/admin/ref-table.tsx`, `src/app/(app)/admin/asset-categories/page.tsx`

- [ ] **Step 1: `RequestStatusChange`** -- already done in Task 7 Step 4a. Nothing to do here.

- [ ] **Step 2: `BulkDrawer` and `InventoryTable`**

`bulk-drawer.tsx`: same two imports; add `cls: AssetClass` to props and their type; `const [to, setTo] = useState<string>(DEFAULT_STATUS[cls]);` (import `DEFAULT_STATUS` too); the `<Select>` maps `statusesFor(cls)` instead of `ASSET_STATUSES`.

`inventory-table.tsx`: add `cls: AssetClass` to `InventoryTable`'s props and pass `cls={cls}` to `<BulkDrawer …>`. **Locate the `<BulkDrawer` element in this file and add the prop there** — it is the only render site.

- [ ] **Step 3: `AssetForm` — the initial-state control follows the chosen category's class**

In `src/components/inventory/asset-form.tsx`:

- Imports: `import { CREATABLE_BY_CLASS, type CreatableStatus } from "@/lib/asset-rules";` and `import { DEFAULT_STATUS } from "@/lib/asset-class";` and `import type { AssetClass } from "@prisma/client";`.
- `categories: Array<{ id: string; name: string; cls: AssetClass }>;`
- After `const typesForCategory = …` add:

```ts
  // The category decides the class; the class decides which initial states
  // exist. Before a category is picked the form shows IT's, which is also
  // what an empty pre-Phase-13 form showed.
  const cls: AssetClass = categories.find((c) => c.id === form.categoryId)?.cls ?? "IT";
  const creatable = CREATABLE_BY_CLASS[cls];
```

- `const [requestedStatus, setRequestedStatus] = useState<CreatableStatus>("SPARE");` stays, and directly after the `cls` line add a reset so a class switch never leaves an IT status selected for a Purchasing category:

```ts
  useEffect(() => {
    if (!(creatable as readonly string[]).includes(requestedStatus)) setRequestedStatus(DEFAULT_STATUS[cls]);
  }, [cls, creatable, requestedStatus]);
```

  (add `useEffect` to the React import.)
- `options={CREATABLE_STATUSES.map(...)}` → `options={creatable.map((s) => ({ value: s, label: s }))}`.
- `{requestedStatus !== "SPARE" && (` → `{requestedStatus !== DEFAULT_STATUS[cls] && (`, and in the paragraph inside, `registered as SPARE` → `` registered as {DEFAULT_STATUS[cls]} ``.

- [ ] **Step 4: The category table gets a Class column and picker**

`src/components/admin/ref-table.tsx`:
- `RefRow` gains `cls?: string; // categories only`.
- Add state: `const [newCls, setNewCls] = useState<"IT" | "PURCHASING">("IT");` and `const isCategory = entity === "category";`.
- Header: after `<Th>Name</Th>` add `{isCategory && <Th width={130}>Class</Th>}`.
- Add row: after the name `<Td>`, add

```tsx
            {isCategory && (
              <Td>
                <Select aria-label="Class for the new category" value={newCls} className="py-1.5 text-xs"
                  onChange={(e) => setNewCls(e.target.value as "IT" | "PURCHASING")}>
                  <option value="IT">IT</option>
                  <option value="PURCHASING">Purchasing</option>
                </Select>
              </Td>
            )}
```

- Both `createRefRow({ entity, name: newName, categoryId: … })` calls gain `, cls: isCategory ? newCls : undefined`.
- Data rows: after the name `<Td>`, add `{isCategory && <Td mono className="text-[10.5px]">{row.cls}</Td>}`.

`src/app/(app)/admin/asset-categories/page.tsx`: the row map gains `cls: r.cls,`.

- [ ] **Step 5: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/components/inventory src/components/admin/ref-table.tsx "src/app/(app)/admin/asset-categories/page.tsx"
git commit -m "feat(ui): status pickers, the create form and the category table know their class"
```

---

### Task 9: `?cls=` on `/inventory`, the two Finance tabs, and Home pinned to IT

**Files:**
- Modify: `src/app/(app)/inventory/page.tsx`, `src/components/inventory/inventory-toolbar.tsx`
- Modify: `src/server/modules/finance/queries.ts`, `src/app/(app)/finance/assets/page.tsx`
- Modify: `src/server/modules/home/queries.ts`

- [ ] **Step 1: The inventory page**

In `src/app/(app)/inventory/page.tsx`:

- Import `CLASS_LABEL, canManageClass, parseCls, withClsQS, type AssetClass` — `type AssetClass` from `@prisma/client`, the rest from `@/lib/asset-class`.
- After `const purchaseYear = …`: `const cls: AssetClass = parseCls(sp.get("cls")) ?? "IT";`
- `const canMutate = canManageClass(user.role, cls);` (replaces the admin/it_staff line — on the Purchasing view, Purchasing gets New asset; IT does not).
- Pass `cls` as the third argument to `listAssets`, `facetOptions`, and as the second to `purchaseYearBuckets(state, cls)`.
- `href` and `exportQS` wrap with `withClsQS(..., cls)`:

```ts
  const href = (s: typeof state, py: PurchaseYearValue | null = purchaseYear) =>
    "/inventory" + withClsQS(withPurchaseYearQS(serializeListState(s, INVENTORY_LIST_CONFIG), py), cls);
  const exportQS = withClsQS(withPurchaseYearQS(serializeListState(state, INVENTORY_LIST_CONFIG), purchaseYear), cls);
```

- `hasFilters` is unchanged — the class is a view, not a filter.
- `PageHeader title` becomes `` title={cls === "IT" ? "Inventory" : `${CLASS_LABEL[cls]} assets`} ``.
- The Import button stays IT-only: `{canMutate && cls === "IT" && <ButtonLink href="/inventory/import">Import</ButtonLink>}`.
- `<InventoryToolbar … cls={cls}>` and `<InventoryTable … cls={cls}>`.

In `src/components/inventory/inventory-toolbar.tsx`:

- Import `ASSET_CLASSES, CLASS_LABEL, withClsQS` from `@/lib/asset-class` and `type AssetClass`.
- Add prop `cls: AssetClass`.
- Every `pathname + withPurchaseYearQS(...)` becomes `pathname + withClsQS(withPurchaseYearQS(...), cls)` (three places: `submitSearch`, `applyFacet`, `yearHref`).
- The class switch must not carry facet filters across (D-12). Every facet option belongs to exactly one
  class: an out-of-class status is dropped silently by `buildAssetWhere` while the chip row still shows it and
  `hasFilters` still counts it; an out-of-class category, type or assignee id is applied, matches nothing, and
  renders as a raw cuid chip because no option carries its label. Clear the facets at the switch and keep
  only what is class-neutral — `q`, sort, columns, page size, the year. Above the component's `return`:

```ts
  // Every facet option belongs to one class, so no facet filter survives a
  // class switch: a status from the other class is silently dropped by the
  // where but still shown as a chip; a category/type/assignee id from the
  // other class matches nothing and renders as a raw id. Clear them; keep the
  // class-neutral parts (q, sort, columns). The active class keeps its state.
  const stateFor = (c: AssetClass): ListState => (c === cls ? state : { ...state, filters: {}, page: 1 });
```

  (Not `clearFilters` — that also blanks `q`, and a search term is class-neutral.)

- Render the class switch **before** the search box:

```tsx
      <div className="flex items-center gap-1.5" role="navigation" aria-label="Asset class">
        {ASSET_CLASSES.map((c) => {
          const active = c === cls;
          return (
            <Link
              key={c}
              href={pathname + withClsQS(withPurchaseYearQS(serializeListState(stateFor(c), INVENTORY_LIST_CONFIG), purchaseYear), c)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                active
                  ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                  : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
              )}
            >
              {CLASS_LABEL[c]}
            </Link>
          );
        })}
      </div>
```

- [ ] **Step 1a: Remove the scaffolding defaults (D-12)**

In `src/server/modules/inventory/queries.ts`, `repairStageIds`, `listAssets`, `facetOptions` and
`purchaseYearBuckets` each took `cls: AssetClass = "IT"` in Task 5 so that every intermediate commit compiled. After
Step 1 the page passes `cls` explicitly, and the export route and bulk's `filters` branch already parse their own
`?? "IT"` — no caller relies on the default any more. Make it `cls: AssetClass` (required) on all four. `tsc` is
the proof that no caller was missed: a fifth caller added next year then fails to compile instead of silently
reading IT. `buildAssetWhere` keeps its default — it is a pure function whose tests exercise the default on
purpose, and its only callers are the three above.

- [ ] **Step 2: Finance — the query and the tabs**

`src/server/modules/finance/queries.ts`:

```ts
import { Prisma, type AssetClass, type AssetStatus } from "@prisma/client";
import { isStatusOf } from "@/lib/asset-class";
```

(remove the `ASSET_STATUSES` import.)

```ts
export function parseAssetStatus(raw: string | null | undefined, cls: AssetClass): AssetStatus | null {
  return raw != null && isStatusOf(cls, raw) ? raw : null;
}
```

`financeAssets(status, page, cls: AssetClass, now = new Date())` and the where becomes `{ cls, cost: { not: null }, ...(status ? { status } : {}) }`.

`src/app/(app)/finance/assets/page.tsx`:

- Imports: `ASSET_CLASSES, CLASS_LABEL, parseCls, statusesFor` from `@/lib/asset-class`; drop `ASSET_STATUSES`.
- `const cls = parseCls(params.get("cls")) ?? "IT";` then `const status = parseAssetStatus(params.get("status"), cls);` and `financeAssets(status, page, cls)`.
- `hrefFor`: add `if (cls === "PURCHASING") next.set("cls", "PURCHASING");` before `if (status) …`.
- Above the status-chip row, add the tabs:

```tsx
        <nav aria-label="Asset class" className="flex gap-1 border-b border-border">
          {ASSET_CLASSES.map((c) => (
            <Link
              key={c}
              href={c === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets"}
              aria-current={c === cls ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium",
                c === cls ? "border-accent text-fg" : "border-transparent text-fg-secondary hover:text-fg",
              )}
            >
              {CLASS_LABEL[c]}
            </Link>
          ))}
        </nav>
```

- The "All" chip's href becomes `cls === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets"`; the status chips map `statusesFor(cls)` and each href is `` `/finance/assets?${cls === "PURCHASING" ? "cls=PURCHASING&" : ""}status=${s}` ``.
- `PageHeader title` becomes `` `Capitalized ${CLASS_LABEL[cls]} assets` `` — **check `e2e/home-finance.spec.ts:187`**, which asserts the heading `"Capitalized assets"` by exact name: change that assertion to `/Capitalized IT assets/` in the same commit, or keep the title as `"Capitalized assets"` and show the class only in the tabs. **Choose the second** — one fewer moving part in an e2e file this phase does not otherwise touch — and leave the title unchanged.
- Both `EmptyState` titles gain the class: `` `No capitalized ${CLASS_LABEL[cls]} asset reads ${status}` `` and `` `No ${CLASS_LABEL[cls]} asset has been capitalized yet` ``; the "Clear filter" href carries `cls`.

- [ ] **Step 3: Home is IT's**

In `src/server/modules/home/queries.ts`, **every** `prisma.asset.findMany`, `prisma.asset.count` and `prisma.asset.groupBy` gets `cls: "IT"` added to its `where` (create the `where` if a call has none), and the employee query's nested `assets: { select: … }` becomes `assets: { where: { cls: "IT" }, select: … }`. A `LOST` car is not an IT alert, and a Purchasing desk must not count in IT's fleet composition. **Grep the file for `prisma.asset` and `assets:` and touch every hit; report the count you changed.**

- [ ] **Step 4: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add "src/app/(app)/inventory/page.tsx" src/components/inventory/inventory-toolbar.tsx src/server/modules/inventory/queries.ts src/server/modules/finance/queries.ts "src/app/(app)/finance/assets/page.tsx" src/server/modules/home/queries.ts
git commit -m "feat(views): ?cls= switches the inventory view; Finance gets IT and Purchasing tabs; Home stays IT"
```

---

### Task 10: The import wizard refuses Purchasing rows by name

**Files:**
- Modify: `src/lib/import-vocabulary.ts`, `src/lib/import-vocabulary.test.ts`
- Modify: `src/lib/import-assets.ts`, `src/lib/import-assets.test.ts`
- Modify: `src/server/modules/import/resolve.ts`, `src/server/modules/import/resolve.test.ts`

- [ ] **Step 1: Failing tests**

`src/lib/import-vocabulary.test.ts` — the "names all eight statuses" test now iterates IT's set and asserts a Purchasing word is **absent**:

```ts
  it("names IT's eight statuses in bad-status's explanation, derived not retyped — and none of Purchasing's", () => {
    const explain = blockSpec("bad-status").explain;
    for (const s of STATUSES_BY_CLASS.IT) expect(explain).toContain(s);
    for (const s of STATUSES_BY_CLASS.PURCHASING) expect(explain).not.toContain(s);
  });
  it("wrong-class sends the operator to the register screen, not to a file fix", () => {
    const spec = blockSpec("wrong-class");
    expect(spec.fix).toEqual({ kind: "link", label: "Register Purchasing assets", href: "/inventory/register" });
  });
```

(import `STATUSES_BY_CLASS` from `./asset-class`; drop `ASSET_STATUSES` if it becomes unused.)

`src/lib/import-assets.test.ts` — find how existing tests build `refs` (the `AssetRefs` fixture) and add a test that a row whose category is Purchasing-class blocks with `wrong-class`. The fixture's `categoryClass` map must mark that category `"PURCHASING"`; every existing fixture gets `categoryClass: new Map()` (an absent entry reads as IT — see Step 3).

Run both — Expected: FAIL.

- [ ] **Step 2: The vocabulary**

In `src/lib/import-vocabulary.ts`: append `"wrong-class",` to `BLOCK_CAUSES` (last, per the array's own append-only rule), and add to `SPECS`:

```ts
  "wrong-class": {
    label: "Purchasing category",
    explain:
      "These rows name a Purchasing-class category (vehicles, furniture, buildings, pantry equipment). " +
      "This importer is IT's — Purchasing assets are registered on the Register screen, where the " +
      "tags are numbered for you.",
    fix: { kind: "link", label: "Register Purchasing assets", href: "/inventory/register" },
  },
```

Change `bad-status`'s explain to use IT's set: replace `${ASSET_STATUSES.join(", ")}` with `${STATUSES_BY_CLASS.IT.join(", ")}` and `one of this system's eight` with `one of IT's eight` (import `STATUSES_BY_CLASS` from `./asset-class`; remove the `ASSET_STATUSES` import if nothing else uses it).

- [ ] **Step 3: The refs and the rule**

`src/lib/import-assets.ts`: add to `AssetRefs`:

```ts
  /** categoryId → class. Absent means IT, so a fixture that predates classes still reads as it did. */
  categoryClass: Map<string, AssetClass>;
```

(import `type AssetClass`). In the row validator, directly after the `duplicate-category-name` block:

```ts
    // Phase 13: this importer is IT's. A Purchasing-class category is not an
    // unknown category — it exists — so it gets its own cause and its own
    // fix, which is a different screen, not a different spreadsheet.
    if (refs.categoryClass.get(categoryId) === "PURCHASING") {
      block("wrong-class", categoryRaw);
      return;
    }
```

And the status match becomes IT's set: replace `(ASSET_STATUSES as readonly string[]).find((s) => s === upper)` with `(STATUSES_BY_CLASS.IT as readonly string[]).find((s) => s === upper)` (import `STATUSES_BY_CLASS` from `./asset-class`; remove `ASSET_STATUSES` import if unused).

`src/server/modules/import/resolve.ts`: the categories query selects `cls` — `prisma.assetCategory.findMany({ select: { id: true, name: true, cls: true }, orderBy: { name: "asc" } })`; `CategoryRow` gains `cls: AssetClass`; `buildAssetRefs` builds `categoryClass: new Map(categories.map((c) => [c.id, c.cls]))` and returns it in the refs object. Update `resolve.test.ts`'s category fixtures with `cls: "IT"`.

- [ ] **Step 4: Full check and commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
git add src/lib/import-vocabulary.ts src/lib/import-vocabulary.test.ts src/lib/import-assets.ts src/lib/import-assets.test.ts src/server/modules/import/resolve.ts src/server/modules/import/resolve.test.ts
git commit -m "feat(import): a Purchasing-class row is refused by name and pointed at the register screen"
```

---

### Task 11: Seed, the end-to-end spec, and the axe routes

**Files:**
- Modify: `prisma/seed.ts`
- Create: `e2e/asset-classes.spec.ts`
- Modify: `e2e/axe-sweep.spec.ts`

- [ ] **Step 1: The seed**

In `prisma/seed.ts`, replace the `catData` block through the `Uncategorised` create with:

```ts
  // Phase 13: every category carries a class. The six IT categories are what
  // they always were; the four Purchasing ones are the meeting's own examples.
  const catData: Record<string, { cls: AssetClass; types: string[] }> = {
    Laptop: { cls: "IT", types: ["Dell Latitude", "ThinkPad"] },
    Monitor: { cls: "IT", types: ["24-inch", "27-inch"] },
    Phone: { cls: "IT", types: ["iPhone", "Android"] },
    Dock: { cls: "IT", types: ["USB-C Dock"] },
    Headset: { cls: "IT", types: ["Wired", "Wireless"] },
    Peripheral: { cls: "IT", types: ["Keyboard", "Mouse"] },
    Vehicle: { cls: "PURCHASING", types: ["Sedan", "Van"] },
    Furniture: { cls: "PURCHASING", types: ["Desk", "Chair"] },
    "Pantry Equipment": { cls: "PURCHASING", types: ["Microwave", "Air purifier"] },
    Building: { cls: "PURCHASING", types: ["Floor", "Warehouse"] },
  };
  const cats: Record<string, { id: string; typeIds: string[]; cls: AssetClass }> = {};
  for (const [name, { cls, types }] of Object.entries(catData)) {
    const cat = await prisma.assetCategory.create({ data: { name, cls } });
    const typeIds: string[] = [];
    for (const t of types) {
      typeIds.push((await prisma.assetType.create({ data: { name: t, categoryId: cat.id } })).id);
    }
    cats[name] = { id: cat.id, typeIds, cls };
  }
  await prisma.assetCategory.create({ data: { name: "Uncategorised", locked: true } });
```

(import `type AssetClass` alongside `AssetStatus` at the top.) In `mk`, add `cls: cats[cat].cls,` beside `categoryId`. Then append to the `createMany` data, after the last IT row:

```ts
      // Purchasing-class fixtures (Phase 13): one per branch a test needs —
      // a car that is assigned (custody works for a car), idle stock, a repair,
      // a building with no holder. Ramon (EMP-0051, ACTIVE) drives the car so
      // Dennis's three-item offboarding fixture is untouched; the leaver-with-
      // a-car case builds its own row inside e2e/asset-classes.spec.ts.
      mk("BR-VH-0001", "Toyota Vios", "Vehicle", "OPERATIONAL", { assigneeId: emp("EMP-0051").id, cost: 950_000, purchasedAt: day(-800), warrantyUntil: day(300) }),
      mk("BR-VH-0002", "Toyota HiAce", "Vehicle", "STORED", { cost: 1_600_000, purchasedAt: day(-1400), warrantyUntil: null }),
      mk("BR-FN-0001", "Executive desk", "Furniture", "OPERATIONAL", { cost: 25_000, warrantyUntil: null }),
      mk("BR-FN-0002", "Ergonomic chair", "Furniture", "OPERATIONAL", { cost: 12_000, warrantyUntil: null }),
      mk("BR-FN-0003", "Meeting table", "Furniture", "STORED", { cost: 40_000, warrantyUntil: null }),
      mk("BR-PE-0001", "Panasonic microwave", "Pantry Equipment", "REPAIRING", { cost: 8_000, defectiveSince: day(-5), notes: "Turntable motor", warrantyUntil: null }),
      mk("BR-BL-0001", "Makati office, 12F", "Building", "OPERATIONAL", { cost: 45_000_000, purchasedAt: day(-3000), warrantyUntil: null }),
```

Run: `npm run db:seed` — Expected: completes. Then `npx vitest run` — unchanged count. **APR-2035** (D-8): the worker now checks for an asset before planning the payload, so this fixture's `workerError` reads "no asset attached" instead of "malformed payload". Update its seed comment to say it now demonstrates the missing-asset guard, or attach an asset and keep the malformed payload — either is honest; pick one and say which.

⚠️ **Every existing e2e count of IT things is protected by the IT default**, not by accident: the list, facets, export, Home and Finance all pin `cls: "IT"` unless asked otherwise. If Task 12's battery shows an IT-side count moving, the leak is in a query that was not pinned — find it, do not adjust the assertion.

- [ ] **Step 2: The spec**

Create `e2e/asset-classes.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 13 — asset classes. Thirteen cases across five surfaces: Purchasing
 * registration and its class gate, Finance's two tabs, the IT-only Secrets
 * surface, class-aware status controls and approvals, the leaver wizard with
 * a car, the two database triggers, and the category admin.
 *
 * Never reference a raw cuid — the DB reseeds and cuids change every run.
 * Assets are referenced by tag, employees by employeeNo, categories by name.
 *
 * Tests share fixture state in declaration order (`--workers=1`; every block
 * is `serial`).
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const idOf = async (tag: string) => (await db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true } })).id;

/** Highest number in use under a prefix — never hardcode 0003; an earlier test may have registered more. */
async function highestNumber(prefix: string): Promise<number> {
  const rows = await db.asset.findMany({ where: { tag: { startsWith: `BR-${prefix}-` } }, select: { tag: true } });
  return rows.reduce((max, r) => Math.max(max, Number(r.tag.slice(6))), 0);
}
const tagOf = (prefix: string, n: number) => `BR-${prefix}-${String(n).padStart(4, "0")}`;

let vehicleCategoryId: string;
let sedanTypeId: string;
let registeredTag: string;

test.beforeAll(async () => {
  const vehicle = await db.assetCategory.findFirstOrThrow({ where: { name: "Vehicle" } });
  vehicleCategoryId = vehicle.id;
  sedanTypeId = (await db.assetType.findFirstOrThrow({ where: { name: "Sedan", categoryId: vehicle.id } })).id;
});

test.describe("registration — each class is its own department's", () => {
  test.describe.configure({ mode: "serial" });

  test("1. Purchasing registers a Vehicle → PURCHASING, STORED, prefix VH", async ({ page }) => {
    registeredTag = tagOf("VH", (await highestNumber("VH")) + 1);
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/inventory/register");

    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    await page.getByLabel("Type").selectOption({ label: "Sedan" });
    await page.getByLabel("Model").fill("Toyota Corolla Cross (e2e)");
    await page.getByLabel("Quantity").fill("1");
    await expect(page.getByLabel("Prefix")).toHaveValue("VH");
    await expect(page.getByLabel("Tag 1")).toHaveValue(registeredTag);

    await page.getByRole("button", { name: /^Register 1 asset/ }).click();
    await page.waitForURL(/\/inventory/);

    const a = await db.asset.findUniqueOrThrow({ where: { tag: registeredTag } });
    expect(a.cls).toBe("PURCHASING");
    expect(a.status).toBe("STORED");
    expect(a.categoryId).toBe(vehicleCategoryId);
    expect(a.typeId).toBe(sedanTypeId);
    expect(a.financeConfirmedAt).toBeNull();
  });

  test("2. Purchasing is never offered an IT category, and nothing is written", async ({ page }) => {
    const before = await db.asset.count();
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/inventory/register");
    const options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Vehicle");
    expect(options).not.toContain("Laptop");
    expect(await db.asset.count()).toBe(before);
  });

  test("3. IT is never offered a Purchasing category, and nothing is written", async ({ page }) => {
    const before = await db.asset.count();
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/register");
    const options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Laptop");
    expect(options).not.toContain("Vehicle");
    expect(await db.asset.count()).toBe(before);
  });
});

test.describe("Finance sees two tabs", () => {
  test("4. the car is under Purchasing with Purchasing words, and absent from IT", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/finance/assets?cls=PURCHASING");
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "OPERATIONAL" })).toBeVisible();
    await expect(page.getByRole("link", { name: "DEPLOYED" })).toHaveCount(0);

    await page.goto("/finance/assets");
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "DEPLOYED" })).toBeVisible();
    await expect(page.getByRole("link", { name: "OPERATIONAL" })).toHaveCount(0);
  });
});

test.describe("IT-only surfaces close to a Purchasing asset", () => {
  test("5. Secrets tab absent, and the URL 404s", async ({ page }) => {
    const id = await idOf("BR-VH-0001");
    await login(page, "admin@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("link", { name: /Secrets/ })).toHaveCount(0);
    await expect(page.getByText("PURCHASING", { exact: true })).toBeVisible();
    const res = await page.goto(`/inventory/${id}/secrets`);
    expect(res?.status()).toBe(404);
  });
});

test.describe("status controls and approvals speak the class's language", () => {
  test.describe.configure({ mode: "serial" });

  test("6. the picker on a car offers exactly the six, minus its current status", async ({ page }) => {
    const id = await idOf("BR-VH-0002"); // STORED, unassigned
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    const options = await page.getByLabel("New status").locator("option").allTextContents();
    expect(options.sort()).toEqual(["LOST", "OPERATIONAL", "REPAIRING", "RETIRED", "SOLD"]);
    expect(options).not.toContain("DEPLOYED");
  });

  test("7. an approval executes the car to OPERATIONAL", async ({ page }) => {
    const id = await idOf("BR-VH-0002");
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("OPERATIONAL");
    await page.getByLabel("Reason").fill("e2e — car back in service");
    await page.getByRole("button", { name: "Request" }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();

    // Fixture shortcut: approve directly rather than through the queue UI,
    // which approvals-audit.spec.ts already covers end to end.
    const approval = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } });
    await db.approval.update({ where: { id: approval.id }, data: { state: "APPROVED" } });
    execSync("npm run worker:once", { timeout: 60_000 });

    const after = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("OPERATIONAL");
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).state).toBe("EXECUTED");
  });
});

test.describe("a leaver who holds a car", () => {
  test("8. sees Returned / Defective / Missing, no Buyout, and Returned lands on STORED", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    const car = await db.asset.create({
      data: {
        tag: "BR-VH-0090", model: "Isuzu D-Max (e2e leaver)", categoryId: vehicleCategoryId, typeId: sedanTypeId,
        cls: "PURCHASING", status: "OPERATIONAL", assigneeId: dennis.id,
      },
    });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/offboarding/${dennis.id}?step=collect`);
    const group = page.getByRole("group", { name: `Decide ${car.tag}` });
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: "Returned" })).toBeVisible();
    await expect(group.getByRole("button", { name: "Missing" })).toBeVisible();
    await expect(group.getByRole("button", { name: "Buyout" })).toHaveCount(0);

    await group.getByRole("button", { name: "Returned" }).click();
    await group.getByRole("button", { name: "Confirm decision" }).click();
    await expect(page.getByText(`${car.tag} → STORED`)).toBeVisible();

    const approval = await db.approval.findFirstOrThrow({ where: { assetId: car.id, type: "lifecycle_return" } });
    expect((approval.payload as { to: { status: string } }).to.status).toBe("STORED");
  });
});

test.describe("the database is the guarantee", () => {
  test("9. a Purchasing asset cannot be written into an IT status, even via Prisma", async () => {
    await expect(db.asset.update({ where: { tag: "BR-FN-0001" }, data: { status: "DEPLOYED" } }))
      .rejects.toThrow(/cannot hold status/);
    expect((await db.asset.findUniqueOrThrow({ where: { tag: "BR-FN-0001" } })).status).toBe("OPERATIONAL");
  });

  test("13. a category with assets cannot change class, even via Prisma", async () => {
    await expect(db.assetCategory.update({ where: { name: "Vehicle" }, data: { cls: "IT" } }))
      .rejects.toThrow(/has assets/);
    expect((await db.assetCategory.findUniqueOrThrow({ where: { name: "Vehicle" } })).cls).toBe("PURCHASING");
  });
});

test.describe("the inventory view", () => {
  test("10. ?cls=PURCHASING lists Purchasing assets and scopes the Filters panel; the plain URL is unchanged", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?cls=PURCHASING");
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BR-LT-0148" })).toHaveCount(0);
    // The Filters panel is scoped too (D-12): six Purchasing statuses, Purchasing categories only.
    // FacetDropdown opens a dialog labelled "Filter by <label>" with one checkbox per option.
    await page.getByRole("button", { name: /^Status/ }).click();
    const statusDialog = page.getByRole("dialog", { name: "Filter by Status" });
    await expect(statusDialog.getByRole("checkbox")).toHaveCount(6);
    await expect(statusDialog.getByText("RETIRED")).toBeVisible();
    await expect(statusDialog.getByText("DISPOSE")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Category/ }).click();
    const categoryDialog = page.getByRole("dialog", { name: "Filter by Category" });
    await expect(categoryDialog.getByText("Vehicle")).toBeVisible();
    await expect(categoryDialog.getByText("Laptop")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/inventory");
    await expect(page.getByRole("link", { name: "BR-LT-0148" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);
    // Switching class clears the facet filters — none of them can apply to the other class (D-12).
    await page.goto("/inventory?status=SPARE");
    await expect(page.getByText("status: SPARE")).toBeVisible();
    await page.getByRole("navigation", { name: "Asset class" }).getByRole("link", { name: "Purchasing" }).click();
    await expect(page).toHaveURL(/cls=PURCHASING/);
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByText("status: SPARE")).toHaveCount(0);
  });

  test("11. the bulk drawer on the Purchasing view offers Purchasing statuses", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory?cls=PURCHASING");
    await page.getByRole("row", { name: /BR-FN-0003/ }).getByRole("checkbox").check();
    await page.getByRole("button", { name: /Bulk/ }).click();
    const options = await page.getByLabel("Target status").locator("option").allTextContents();
    expect(options).toContain("RETIRED");
    expect(options).not.toContain("DISPOSE");
  });
});

test.describe("category admin", () => {
  test("12. a category is created with a class and the column shows it", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    await page.getByLabel("Class for the new category").selectOption("PURCHASING");
    await page.getByLabel("New category name").fill("Artwork");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("row", { name: /Artwork/ })).toContainText("PURCHASING");
    expect((await db.assetCategory.findUniqueOrThrow({ where: { name: "Artwork" } })).cls).toBe("PURCHASING");
  });
});
```

**Add a 14th case (D-8)** — the only test that reaches the worker's `HOLDER_STATUSES` guard. Using the car
assigned to a driver (`BR-VH-0001`, `OPERATIONAL`): as `purchasing_staff`, request a status change to
`STORED`; set that approval to `APPROVED` via Prisma (the same fixture shortcut test 7 uses); run
`execSync("npm run worker:once")`; then assert the approval is `EXECUTION_FAILED` with a `workerError` that
matches `/lifecycle\.return/`, and that the car is still `OPERATIONAL` and still assigned. A held asset may not
be status-changed out from under its holder; for a Purchasing asset that means it cannot be changed at all
while held — return it first.

**Add a 15th and a 16th case (D-13)** — Task 6's server-side class gates are Prisma-bound and no case above
posts a wrong-class request (cases 2 and 3 assert the picker and an unchanged count, not the refusal).

15. **A cross-class category edit is refused by name.** As `admin` (who sees both classes), open the edit form of
    `BR-LT-0148` and change its category to `Vehicle`; save; assert the field error
    `Vehicle is a Purchasing category; this is an IT asset.` and, via Prisma, that the row's `categoryId` and `cls` are
    unchanged. **Conditional:** if Task 8 has made the edit form's category picker class-filtered so that no
    other-class category can be chosen even by admin, this case is unreachable from the UI — drop it and write
    in Task 12 that the `updateAsset` cross-class guard is covered by review and the trigger (case 13) only.
16. **Finance sends a Purchasing registration back; Purchasing resubmits it; IT cannot.** As `finance_staff`, open
    `BR-FN-0003` and use the Phase 12 send-back control with a reason; assert the record reads as returned. As
    `purchasing_staff`, open the same record, assert the Resubmit control is present, click it, and assert the
    record reads as awaiting Finance again and, via Prisma, `financeReturnedAt` is null. Then as `it_staff`, open
    the record and assert the Resubmit control is absent (Task 7's `canResubmit`). Selectors for the send-back
    and resubmit controls: read `src/app/(app)/inventory/[id]/` — the warning below applies; report what you used.

The two gates that remain unreachable from the UI — a wrong-class register POST (the picker is filtered) and a
mixed-class bulk request (the list is class-scoped) — ship covered by the trigger and by code review only.
Task 12 records that in the handover rather than pretending otherwise.

⚠️ **Two sets of selectors are guesses at markup this plan did not read, and must be corrected to what the components actually render before the run:** test 11's (`checkbox` in a row, a button matching `/Bulk/` — see `inventory-table.tsx` and its selection bar), and test 8's (`getByRole("button", { name: "Returned" })` etc. inside the group — see `src/components/ui/segmented-control.tsx` for whether its options are buttons, radios or something else). Report what you changed.

- [ ] **Step 3: The axe routes**

In `e2e/axe-sweep.spec.ts`: add `"/inventory?cls=PURCHASING"` to `VIEWER_STATIC_ROUTES` (viewer reaches `/inventory`; the class view is read-only for them) and `"/finance/assets?cls=PURCHASING"` to `FINANCE_STAFF_ROUTES`. The table is hardcoded and nothing keeps it in sync (B-13, C-9).

- [ ] **Step 4: Run it and read the count**

```bash
npx playwright test e2e/asset-classes.spec.ts --workers=1 --global-timeout=600000
```

A run that hits `--global-timeout` prints "N did not run" and its tail still reads like a pass. **Read the number. Expect 16** (13 planned + D-8's held-car case + D-13's two; 15 if case 15 was dropped as unreachable — say which).

- [ ] **Step 5: Prove the guards are not inert — four mutations, report all four**

1. In the migration SQL — **on the live database only, via `psql` or a throwaway `npx tsx -e` script, never by editing the committed migration** — `DROP TRIGGER asset_class_invariants ON "Asset";` → test 9 must fail. Recreate it by re-running the `CREATE TRIGGER` statement from the migration.
2. Same for `category_class_frozen` → test 13 must fail. Recreate.
3. In `secrets/page.tsx`, comment out the `if (asset.cls === "PURCHASING") notFound();` line → test 5 must fail on the status code. Revert.
4. In `outcomesFor`, return `OUTCOMES` regardless of class → test 8 must fail on the Buyout count. Revert.

**Report the actual observed output for all four.** Tests 2 and 3 assert the UI gate; the server gate behind it (`canManageClass` in `registerAssets`) is pinned by the unit matrix in `asset-class.test.ts`, and **cannot** be reached through the UI once the options are filtered — say so in the report rather than claiming e2e coverage of it.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts e2e/asset-classes.spec.ts e2e/axe-sweep.spec.ts
git commit -m "test(e2e): asset classes — registration gates, Finance tabs, Secrets 404, class-aware controls, both triggers"
```

---

### Task 12: Handover, amendments, battery, close-out

**Files:**
- Modify: `docs/HANDOVER.md`
- Modify: `docs/superpowers/plans/2026-09-06-phase-13-asset-classes.md` (this file — amendments `D-1`…)

- [ ] **Step 1: Correct §9's naming**

In `docs/HANDOVER.md` §9, add directly under the heading:

> ⚠️ **"Admin" below means the PURCHASING DEPARTMENT** — confirmed by the user on 2026-09-06 (*"remember admin = purchasing"*). In this codebase `admin` is the sysadmin role and Purchasing is the `purchasing` workspace / `purchasing_staff` role. Phase 13 built item A on that reading; nothing here should be read as concerning the `admin` role.

- [ ] **Step 2: Phase 13 in §0 and §4**

Header line: Phase 13 code-complete on `phase-13-asset-classes`, unmerged, unpushed, with the battery numbers you actually got. §0 item 4: a Phase 13 paragraph pointing at the spec and this plan, naming the two premise-level facts (own vocabulary; one register), the two accepted defaults (approvers unchanged; categories admin/IT-created), and the two triggers. §4: a "Phase 13" paragraph in the DONE list.

- [ ] **Step 3: §6a rules** — append at **101** (the list ends at 100; rules 75-80 sit out of order at the tail — see the warning there). Candidates from this phase: the `Asset.cls` default-plus-trigger pattern (a default is not a guarantee; a trigger is); the "IT is the URL default so nothing that predates the phase changes meaning" pattern; a default parameter added so intermediate commits compile is removed in the commit where the last caller passes the value (D-12); when a function scopes one of its lists by a key, every list in it is scoped by the same key or the exception is written down (D-12); a control rendered behind a predicate has its action gated by the same predicate, in the same phase (D-13); a label that can start with a vowel sound never takes a bare article — the vocabulary carries the phrase (D-8, D-13); anything an amendment taught. **Also record in §8 (D-13):** Task 6's wrong-class register and mixed-class bulk gates are unreachable from the UI and are covered by the trigger and review only.

- [ ] **Step 4: The battery**

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
docker compose --profile prod build
rm -rf .next
npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/receiving.spec.ts e2e/asset-classes.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/scanner.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```

Baseline before this phase: **167 e2e / 13 files** (52 · 47 · 39 · 23 · 6). Expect **183 / 14 files** — 167 + 16 (D-8, D-13); 182 if case 15 was dropped. **Read every count; write down what you got.** ⚠️ `home-finance.spec.ts`, `it-core.spec.ts` and `import-export.spec.ts` are the ones to watch: they assert IT-side counts and totals, and a failure there means a query was not pinned to `cls: "IT"` (Task 9 Step 3) — fix the query, never the assertion.

- [ ] **Step 5: Finish the branch** — `superpowers:finishing-a-development-branch`. **Merging and pushing are the user's decisions, separately.**

---

## Out of scope, deliberately (spec §12)

Locations · Purchasing self-service categories · Purchasing bulk import · a Purchasing Home · **Purchasing-owned approvals (first follow-up)** · a Purchasing assign / return surface (D-13: `/employees` is IT's workspace; a car is assigned at create time only) · a detector for an unassigned holder status on the Purchasing side (IT's Home has one for DEPLOYED; D-13) · depreciation / accounting classes · consumables (§9 D) · vendor master (§9 B).
