# Inventory v2 — Session Handover

**Last updated:** 2026-08-19 · **Phase 7 is DONE (15/15 tasks) and green on branch `phase-7-offboarding` — the branch is NOT merged, it is ahead of main** · **Phases 1–6 merged to main; the merge of Phase 7 is the one thing outstanding; Phase 8 remains after that.**

This is the pick-up doc for a fresh session. Read this first, then the spec
(`docs/superpowers/specs/2026-08-14-inventory-v2-design.md`) and the two design-handover files
(`design_handover/original-brief.md` = what each screen does; `design_handover/README.md` = how it
looks + tokens). The client's 39 routes are enumerated in the brief §7; 38 pages (35 under the
`(app)` group, 3 auth) + 4 route handlers exist today — `/dev/kitchen-sink` not counted, since it
404s in prod.

---

## 0. Start here (next session, in order)

1. **Resolve the merge before anything else.** Phase 7 is finished and green on
   `phase-7-offboarding`, but it is NOT merged to main — that decision belongs to the user, and
   nothing below should happen ahead of it:
   - **If the user wants it merged:** use `superpowers:finishing-a-development-branch` to merge
     `phase-7-offboarding` into `main`, delete the branch, and push. Do this first, then treat "main"
     as the working branch for everything that follows.
   - **If the user wants to keep building on this branch instead** (e.g. start Phase 8 before
     merging): say so explicitly and proceed on `phase-7-offboarding` — don't merge on their behalf,
     and don't let a fresh session assume main is current when it isn't.
   Either way, `git log --oneline main..HEAD` shows the whole of Phase 7 (15 tasks), and
   `git status` should be clean before you touch anything.
2. `docker compose up -d db` → **`npx prisma migrate deploy`** (Phase 7 added a 7th migration) →
   `npm run db:seed` → open the preview (`preview_start` name `app-dev`).
3. Read **§6** — it now carries Phase 8's entry criteria: the things the new admin/import/export
   surfaces have to account for from their first commit (the worker's dead-lettered webhook job, the
   permanent admin's locked row, the 10,000-row export cap, and the rest). Read it before writing
   Phase 8's plan, not after.
4. Write Phase 8's plan with `superpowers:writing-plans` — `/admin/users`, `/admin/webhooks` +
   `/deliveries` (dead-letter replay), `/admin/flags`, the 3-step import (dry-run → commit), the
   Excel export upgrade + split-by-year chips, the printable label sheet, USB-scanner polish, the
   deployment README, a full axe pass, and the Entra SSO decision. Re-read README cards `3h` (Admin
   workspace) and `5a, 1m, 7g` (Import / export) before drafting tasks — they're where the locked-row,
   dry-run and 10,000-row-cap behaviour is specified. Then execute with
   `superpowers:subagent-driven-development`, same as every phase before it (§2).

The branch is green end to end: `npx tsc --noEmit` · `npm run lint` · **345 unit tests across 26
files** · `npm run build` · **`npx playwright test --workers=1` — 89 e2e tests, 7.3 minutes** (up
from 75 before this phase; Phase 7's own `e2e/offboarding.spec.ts` adds 14 — the wizard end to end
through the worker, repair mode, reservations, and equipment policies, including the viewer
read-only path). This was the first full e2e run since Task 9, and it is what finally exercised the
things the browser pane could never confirm — see the two gotchas below.

**A recurring test-design gotcha worth knowing before you write more e2e:** a UI confirmation that
clears itself on a timer cannot be asserted with the default `expect` budget. `/inventory/[id]/edit`'s
"✓ Saved" is a 3-second self-clearing flash (`setSaved(true)` plus a 3000ms timer in
`src/components/inventory/asset-form.tsx`), so the default 5s assertion budget has to cover the whole
server-action round trip *before* the flash even begins. A dev server several minutes into a full
suite run occasionally takes longer than that, and the failure reads as "element(s) not found" with
the button still showing `"Loading" [disabled]` and an empty alert — nothing about the message points
at a timing race. It failed once in three full runs and was reproduced byte-for-byte by delaying
`updateAsset` 7s. The fix is headroom on the assertion (20s), not a weaker assertion.

**Nothing is half-finished in the code.** Every task ended on a green commit, including Task 15's
close-out. The next unit of work is a whole task — Phase 8's first — not a fragment of Phase 7.

**State this session left behind:** working tree clean, no dev server running, `inventory-db-1` up
and **freshly seeded** (Dennis Ong EMP-0090 is OFFBOARDING and holds all three fixture items —
`BR-LT-0166`, `BR-PH-0312`, `BR-HS-0510` — with no wizard decisions made against them). No scratch
files anywhere in the repo.

---

## 1. What this project is

Building "Backroom IT — Inventory v2" from scratch for The Backroom Offshoring: an internal IT
asset-management app (purchase → assignment → repair → disposal) with an approval queue, an
append-only audit trail, four role-gated workspaces, and an offboarding wizard. **We are recreating
a high-fidelity HTML design prototype in a real Next.js codebase** — not porting the prototype's markup.

- **Repo:** github.com/neilluceromc/ChristianAuditing (**PUBLIC** — never commit secrets or `.env`)
- **Stack:** Next.js 15 App Router · PostgreSQL 16 (Docker) · Prisma 6 · Auth.js v5 · Tailwind v4 (CSS-var tokens)
- **Deploy:** single machine (the user's own device), one Docker Compose stack: `docker compose --profile prod up`
- **Machine:** Windows 11 · Node 24 · Docker Desktop · Postgres as container `inventory-db-1` (compose project `inventory`, loopback-only 127.0.0.1:5432)

## 2. How we work (follow this exactly — it is load-bearing, not ceremony)

One **plan per phase** under `docs/superpowers/plans/`, executed **subagent-driven**:

1. Write the phase plan with `superpowers:writing-plans` — bite-sized tasks, **full verbatim code in every step**, recorded scope decisions up front, entry criteria mapped to tasks.
2. Execute with `superpowers:subagent-driven-development`: **fresh implementer subagent per task** (paste the full task text into the prompt — never "go read the plan"), then review. Small/verbatim tasks get one fresh-eyes **spec review (sonnet)**; security-, concurrency- or logic-critical tasks get an **opus quality review**.
3. **The controller applies review fixes** for small, well-understood defects directly and verifies live in the Browser pane; larger fixes go back to an implementer subagent.
4. **Amend the plan doc whenever code deviates** (commit as `docs(plan): …`) so the plan never lies to a future reader.
5. Finish with `superpowers:finishing-a-development-branch` → merge to main, delete branch, push.

**Models:** sonnet implementers and spec reviewers; opus for quality reviews of anything that moves
data or gates access. **Verbatim implementers transfer plan defects wholesale — the reviews are where
correctness actually comes from.** Across five phases they caught: a working auth bypass (`a%` in the
email field logging in as admin), a fail-open authorization default, a signup enumeration oracle, a
focus trap that never installed, a bulk transaction that would time out at its own documented cap,
phantom audit entries on every first edit of a seeded asset, ciphertext that wasn't bound to its row,
and an execution path that could strand an approval in APPROVED forever.

Phase 7 added three more, and all three were defects in the **plan** rather than the implementation —
which is the argument for reviewing the rule and not just the diff: a decision from a previous holding
that hid an item still needing collection; a wizard billing years-old returns to a farewell report; and
a completion gate that shared two thirds of the definition of "decided" while its comment claimed all of
it. None of the three could have been caught by the unit suite or by seed-based e2e, because no fixture
had a prior return — each was found by an opus reviewer asked "is the rule right?" rather than "does
this match the plan?". When a task is logic-critical, point the reviewer at the rule and give it the
domain facts (the unique index, what the execution plan guarantees, what the seed does and doesn't
contain) — and mutation-test the new tests once they're green, the way Phase 7's `decisionOf` suite
was: reversing a comparator and weakening a filter both passed the suite as written, and killing those
two mutations is what caught it.

**Recorded deviation from the skills:** work happens **in-place on a `phase-N-<name>` branch**, not a
git worktree — the repo root IS the app root and this is a single workstream. Commit style
`feat(scope): …` / `fix(scope): …` / `docs(plan): …`, co-author trailer
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 3. Environment / how to run

- **DB:** `docker compose up -d db`. Seed: `npm run db:seed` (TRUNCATE + reseed — the sanctioned reset; **`prisma migrate reset` is blocked by the harness classifier and unnecessary**). **7 migrations** as of the Phase 7 branch; add new ones as hand-written SQL dirs, then `npx prisma migrate deploy && npx prisma generate` (`migrate dev` also works but invents a name). **A reseed TRUNCATEs, so a migration's backfill does not survive it** — anything the app depends on has to be set by `prisma/seed.ts` too (`Employee.offboardingAt` is set both ways for exactly this reason).
- **Dev app:** never via Bash — use the Browser-pane preview (`preview_start` name `app-dev`, port 3000). The controller owns this server; subagents must not start one.
- **Worker:** `npm run worker` (poll loop) or `npm run worker:once` (drain and exit — what e2e uses). In prod it's the compose `worker` service.
- **NEVER run `npm run build` while a dev server is running** — they share `.next` and it bricks the dev server.
- **Full battery:** `npx tsc --noEmit && npm run lint && npm run test && npm run build`, then `npm run db:seed && npx playwright test --workers=1`. The e2e run takes ~5 minutes; **run it in the foreground with a long timeout.** A backgrounded Playwright run that is never reaped keeps its own `beforeAll` reseed racing yours, which produces FK/unique errors and a cascade of unrelated timeouts in specs that pass in isolation — diagnose by listing live `node.exe` command lines, not by editing assertions.
- **Seeded accounts** (all `@thebackroomop.com`, password `ChangeMe123!`): `admin@` (admin, permanent) · `it@` (it_staff) · `purchasing@` (purchasing_staff) · `finance@` (finance_staff) · `viewer@` (viewer).
- **Seed contents:** 22 assets (all 8 statuses), 10 employees (Marites EMP-0042 holds 4 items against the only equipment policy → 1 gap; Dennis EMP-0090 is OFFBOARDING; Nina EMP-0097 has a reserved monitor), 7 approvals (all 6 states; APR-2040 past SLA → badge reads "3, urgent"; APR-2035 is APPROVED with a **deliberately malformed payload** + a queued job — the worker's EXECUTION_FAILED demo), 5 PRs (one per state; **PR-0198 is the bounce-back with a three-party note thread**, still the fixture the purchasing e2e leans on; `purchase_request_ref_seq` sits at 201 so the first drafted ref is PR-0202), 4 reservations. **On the Phase 7 branch:** 25 assets (Dennis EMP-0090 holds `BR-LT-0166` / `BR-PH-0312` / `BR-HS-0510`), and every non-ACTIVE employee carries `offboardingAt = day(-3)`.

## 4. What's DONE (Phases 1–6 on main; Phase 7 complete on the unmerged branch)

**Phase 1 — Foundation:** design tokens (light/dark, motion, reduced-motion kill switch); six-family
status system (`src/lib/status.ts`; `MISSING` is the 8th AssetStatus → fault); full Prisma schema
(append-only triggers on AuditEntry/NoteEntry, partial uniques, refNo sequences); seed; ~34 UI
primitives in `src/components/ui/`; `/dev/kitchen-sink` (404s in prod).

**Phase 2 — Auth + Shell:** Auth.js v5 (credentials; Entra registered only when fully configured);
**three-layer authorization** — edge middleware (JWT-only) → DB-backed `requireUser`/`requireRole` →
UI nav filtering, all from one truth module (`src/lib/workspaces.ts`, default-deny path gating);
login/signup/bootstrap; four workspace sidebars + switcher + topbar + mobile drawer + ⌘K palette;
cookie-driven SSR theme/density/workspace.

**Phase 3 — IT core** (`docs/superpowers/plans/2026-08-16-phase-3-it-core.md`): the full `/inventory`
surface (facets/sort/chips/bulk-select → approval-creating bulk drawer/CSV export/column prefs; new;
record with Overview/History/Timeline/Documents/Secrets/Reservations; edit), the full `/employees`
surface (Items+Loadout columns, **the loadout view**, edit with M365 canonical+custom, timeline,
printable accountability form), reference-data CRUD ×3.

**Phase 4 — Approvals + audit** (`docs/superpowers/plans/2026-08-17-phase-4-approvals-audit.md`): the
claim-based queue (five tabs, J/K/C/A/R/E + screen-reader live region), the detail page (live system
checks, Approve-only-after-claim, background-pending + EXECUTION_FAILED cards with verbatim worker
errors, Retry), **the worker** (atomic `FOR UPDATE SKIP LOCKED` lease, stale recovery, `--once`,
per-type live re-validation inside the execution tx, state-guarded terminal writes, catch-all →
EXECUTION_FAILED so nothing strands in APPROVED), `/audit` (zero row actions by design), and the
ActivityFeed renderer powering the two scoped feeds.

**Phase 5 — Purchasing** (`docs/superpowers/plans/2026-08-17-phase-5-purchasing.md`): the three-party handoff made real —
`purchaseTransition` (brief §6.1, pure + TDD) driving six state-guarded server actions, each appending a **NoteEntry**
in the same transaction; `/purchases` (tabs write `?state=`, dwell second line under State), `/purchases/new` +
`/purchases/[id]/edit` (multi-unit editable rows, autosaved DRAFT created by the first save, "add from a policy
loadout", centavo-safe prices), `/purchases/[id]` (**the bounce-back**: red-left-bordered banner naming who sent it
back with the verbatim reason and `IT_REVIEWED → SUBMITTED · nothing was cleared`, a 4-stop stepper whose return path
is a dashed "← sent back" connector, `NOW · 2nd time`, per-unit states, the IT slot editor and Finance unit editor
inline), and `/purchases/activity`. **IT gained access to `/purchases`** — brief §6.1 makes IT the second party, and
`it-review`/`it-reject` were otherwise unreachable for `it_staff` (see §7).

**Phase 6 — Finance + Home** (`docs/superpowers/plans/2026-08-17-phase-6-finance-home.md`): the role-aware
dashboards. Every section loads through `safeSection` and renders through `SectionCard`, so one failing query
shows the designed FAILED card while the rest of the page renders. IT Home has **no KPI row** — "Your shift"
(5 rows ordered by what breaks first, each clearable for the rest of the day via a `UserPreference`), Claimed-by-you
above the pool, the Fleet bar with its coverage line, the 5-bucket Age histogram, and the Warranty runway that
marks two identical laptops expiring the same week. Purchasing Home leads with a to-do list and spend; **Finance
Home leads with money and age**; Viewer gets the same layout minus the queue. Focus mode is the `br.focus` cookie.
Plus `/finance/assets` (the capitalized register with value columns) and `/finance/activity` (the one cross-domain
scoped feed, so the only one showing the domain pill).

**Phase 7 — offboarding + repairs + policies (COMPLETE, 15/15 tasks committed on the unmerged
`phase-7-offboarding`).** Everything below is done and reviewed:

- **`lifecycle.return` learned four outcomes** (`SPARE | DEFECTIVE | BUYOUT | MISSING`, always clearing
  the holder) so the wizard's Defective / Buyout / Missing decisions execute instead of dying as
  `EXECUTION_FAILED`. Widening the producer meant fixing its two READERS as well: the queue's change-cell
  summary and the approval detail's "Return target" check both had `SPARE` hard-coded.
- **`src/lib/offboarding.ts`** — the phase's vocabulary and rules, pure and TDD'd: `OUTCOMES` /
  `OUTCOME_STATUS` / `reasonRequired`, the four `WIZARD_STEPS` + `parseStep`, `canContinue`,
  `reportTotals`, and the derivation trio `outcomeOfStatus` / `returnTargetStatus` / `decisionOf`.
- **`Employee.offboardingAt`** (migration `20260818090000_employee_offboarding_anchor`) — the anchor that
  makes "this offboarding" a real window. Stamped by `updateEmployee` when employment enters
  `OFFBOARDING`, cleared on a return to `ACTIVE`, kept once `OFFBOARDED` so the report stays readable.
- **`src/server/modules/offboarding/queries.ts`** — `listOffboarding` (the queue) and `getWizard`
  (everything one wizard needs, including the policy slots via the Phase 3 `computeLoadout`), sharing one
  windowed derivation through the exported `candidatesFor`.
- **`src/server/modules/offboarding/actions.ts`** — `decideItem` (one approval per decision,
  immediately), `closeAccounts` (guarded partial update of `m365Status`), `completeOffboarding`
  (person-only; refuses while anything is undecided, while any return sits `EXECUTION_FAILED`, or while
  the M365 account is still live).
- The seed's offboarding fixture **holds equipment**: Dennis Ong EMP-0090 now has `BR-LT-0166` (₱48,000),
  `BR-PH-0312` (₱18,000) and `BR-HS-0510` (₱5,500). Fleet 22 → 25, which moved two Home assertions.
- **`/offboarding`** (the queue) and **`/offboarding/[employeeId]`** (the 4-step wizard), plus the four
  components they render and Home's `LEAVE` row pointing at the wizard. Walked end to end against the
  seed: a reasonless MISSING is refused inline by the server, three decisions produce `APR-2042/3/4`,
  the report totals ₱53,500 / ₱18,000 / ₱0, and completion writes an `offboarding.completed` audit
  entry carrying the decision set.
- **`SegmentedControl` can hold no value** — the `Math.max(0, …)` clamp is gone and the indicator is
  not rendered at `-1`, so an undecided item cannot read as "Returned". Verified in the DOM (no radio
  checked, no indicator) and at the three pre-existing call sites, which all still slide normally.
- **`/offboarding/[employeeId]/report`** — the printable farewell sheet (scope decision #9): light-only
  hardcoded hex so it prints the same in dark mode, `PrintButton`, the decided-items table, the three
  totals, acknowledgement, signature blocks. A MISSING item with no cost on record adds ₱0 to
  `totals.lost` while still counting in `counts.MISSING`, so the sheet says that loss is unknown
  rather than zero.
- **`Th` forwards `aria-label`.** It destructured a fixed prop set and never spread, so the prop four
  call sites passed was silently dropped — and the compiler stayed quiet because every prop in the
  type is optional, making it a *weak type* and relaxing the excess-property check. Three of those
  four call sites predate Phase 7.
- **The repairs brain** (`src/lib/repairs.ts`, TDD, 21 tests): four stages derived from fields that
  already existed — `to-assess` / `at-vendor` / `returned-ok` / `beyond-repair` — plus `downDays`,
  `quoteWarning`, `isRepairView`, and `withRepairStage` (a stage chip clears the `status` pin it
  cannot coexist with). `beyondRepair` compares **whole centavos**, not floats. The `stage` facet
  narrows SQL to the repair candidate set; `repairStage()` makes the final cut in memory. Two seed
  fixtures were added so `beyond-repair` and `returned-ok` are reachable at all, and the worker now
  stamps `defectiveSince` when an asset **enters** DEFECTIVE (audited).
- **Repair mode on `/inventory`**: Stage + Down columns (repair-only, never offered to the column
  chooser), the stage chip row, the write-off warning on the record, and the `HOLD` marker for
  reserved-but-SPARE stock. `repairStageIds()` gives the bulk action and the CSV export the **same**
  cut the screen shows — a SQL candidate set is not safe to act on. One exported `stageOf()` owns the
  row→stage marshalling for all three call sites.
- **`/reservations`** — the read-only cross-asset hold list (scope decision #10): three tabs writing
  `?state=`, a "Reads" column proving a hold never moved the asset's status, and EXPIRED (the clock)
  kept visibly distinct from RELEASED (a person), each with its own date.
- **`/admin/equipment-policies`** — create/delete policies (exactly one of a role title or a
  department, never both — role wins when both would otherwise match), inline slot chips (solid =
  required, grey = optional) with click-to-add and click-to-toggle, and an audit trail that records
  the **whole slot list before and after** every change (`auditSlots` in
  `src/server/modules/admin/policy-actions.ts`) rather than just the one slot touched — a policy edit
  changes what counts as complete from that moment on and touches no existing assignment, so the
  before/after lists are the only way the change reads back afterward. `createPolicy` requires a
  slot to name an asset type (a typeless slot could never be filled by `computeLoadout`) and requires
  the policy to target exactly one of title or department. Every `equipmentPolicy.findMany` that
  feeds `resolvePolicy` (employees, home ×2, offboarding, purchases, this page) now orders by name, so
  which policy wins a tie is at least stable — see §8 for what that does and doesn't fix.
- **`e2e/offboarding.spec.ts`** — 14 tests, the first time any of the three Phase 7 surfaces (or
  repair mode, unreachable before this) were driven by a real browser rather than fetched HTML. It
  walks the wizard end to end through the worker (a Missing return now executing to MISSING instead
  of `EXECUTION_FAILED` is the Task 1 payoff, confirmed live), proves the server gate refuses
  completion when an item is blocked by a pre-window approval — the `candidatesFor`/`blockedBy`
  regression a review caught mid-phase, now covered live rather than only in the unit suite — and
  covers the viewer read-only path on the policies page. Running it for real found four bugs in
  the spec itself (two navigation races, two helper functions declared in the wrong closure) and one
  real product bug: the wizard's locked step-bar entries rendered at 2.4:1 contrast (`text-fg-faint`
  on canvas), which axe flags as serious — fixed to `text-fg-muted`, the token the reachable steps
  already used.

### Conventions every later phase must follow

| Concern | Where |
|---|---|
| Mutation shape | `actionRole` guard → `checkRate` → zod → tx (domain write + `writeAudit` together) → `revalidatePath` → `ActionResult` |
| Typed results / guards | `src/server/action-result.ts` · `src/server/auth/guards.ts` (`actionRole`/`actionUser` return null, never redirect) |
| Audit | `writeAudit(tx, …)` + `diffOf` — day-precision date compare in `updateAsset` is the template for avoiding phantom diffs |
| State machines | Pure + TDD'd first (`src/lib/approval-flow.ts` is the template), called via **state-guarded `updateMany`** (count 0 → conflict) |
| List state | URL search params via `src/lib/url-state.ts`; column prefs are per-user DB rows, never URL |
| Lifecycle changes | Never a direct asset write — create an Approval; the worker executes it |
| Secrets | AES-256-GCM **v1: base64(version‖iv‖tag‖data), AAD = `"assetId:label"`** |
| Purchase transitions | `runTransition` in `src/server/modules/purchases/actions.ts` — pure check → state-guarded `updateMany` → **NoteEntry append** → `writeAudit`, all in one tx; `asActionResult` maps P2028 → conflict |
| Partial updates | Write **only the fields the caller sent**, and put each written field's before-value in the `updateMany` guard — filling untouched fields from the row you read loses concurrent edits silently (Phase 5's `saveUnit`) |
| Dashboard sections | `safeSection(label, run)` → `SectionCard` — a failing query becomes a typed failure and the designed FAILED card, never a blank page |
| Per-user, per-day UI state | a `UserPreference` row (`home:dismissed`), reset by a date change — not an audited domain event |
| DB invariants to catch (P2002 → typed conflict) | `Approval_one_open_per_asset` (one open approval per asset) · `Job_one_live_execute_per_approval` (one live execute-job per approval) · `Reservation_one_active_hold_per_asset` |
| Derived state beats stored state | "Decided" is read out of the approvals that exist (`decisionOf`), not kept in a wizard table — which is what makes a half-finished offboarding N correct records instead of a lost session |
| A derived predicate is only shared if ALL of it is shared | Phase 7 extracted `groupCandidates` but left the *window* duplicated, and the server gate promptly disagreed with the UI. `candidatesFor` now owns window + grouping together, and all three call sites use it |
| A facet SQL can't express | narrow to a candidate set in the `where`, then make the final cut in memory with the same pure function that renders it (`repairStage`, Task 11) — never two rules for one concept |
| …and that cut belongs to EVERY consumer of the `where` | `buildAssetWhere` feeds the list, the facet counts, the CSV export and `bulkRequestStatusChange` (which acts on *all matching*). Cutting only in `listAssets` would let a screen showing 1 asset create 7 approvals. `repairStageIds()` is the shared resolver |
| Money compared on a threshold | in **whole centavos**, never floats — `Decimal(12,2)` plus `quote >= cost * 0.6` is not inclusive at exactly 60% (₱6,000.57 of ₱10,000.95 failed). A test with round numbers proves one lucky pair |
| Extracting a rule | grep for every other place that writes the same thing. `withRepairStage` was extracted to stop a chip leaving a contradictory filter, and the generic `ChipFilterRow` on the same page was a second chip that bypassed it |

---

## 5. What REMAINS

- **Merge `phase-7-offboarding` to main.** Phase 7 itself has no remaining tasks — this is purely the
  integration step, and it's a decision for the user to make, not something to do unprompted (§0).
- **Phase 8 — Admin + import/export + polish.** `/admin/users` (locked permanent admin),
  `/admin/webhooks` + `/deliveries` (dead-letter replay — **the worker currently dead-letters
  DELIVER_WEBHOOK jobs with "ships in Phase 8"**), `/admin/flags`; import (3-step dry-run → commit,
  blocked rows grouped by cause), export upgrade (real Excel + split-by-year chips, including the
  brief's `farewell-report` export route), printable label sheet, USB-scanner polish (a scan should tick
  the matching wizard row), deployment README, full axe pass. Entra SSO wiring lands here or is
  explicitly deferred.

---

## 6. Phase 8 entry criteria (READ BEFORE WRITING THE PLAN)

Phase 8 has no code on this repo yet, so none of this is an invariant a task can silently break —
it's what the design brief and the current state of the codebase already commit the plan to before
the first task is written. Map each of these to the task that has to satisfy it, the way every prior
phase's plan mapped scope decisions to tasks (§2).

1. **The worker already has an opinion about webhooks, and it isn't "not implemented."**
   `src/worker/index.ts` dead-letters every `DELIVER_WEBHOOK` job on purpose: `status: "DEAD"`,
   `lastError: "webhook delivery ships in Phase 8"`. `/admin/webhooks/deliveries` isn't just a new
   read of the `Job` table (Phase 4 left that as a leftover, §8) — it's the reader that makes good on
   an existing placeholder, and "Replay" has to mean something to a job the worker will keep
   dead-lettering until Phase 8 also teaches it to actually deliver.
2. **`WebhookEndpoint.secret` is a plain `String` column today** (`prisma/schema.prisma`), unlike
   `Secret.ciphertext` which is AES-256-GCM with an AAD bound to its row (§4 conventions table). If
   `/admin/webhooks` ships storing that secret as typed, it ships storing it in the clear — decide
   whether encrypting it is in scope for this phase or an explicit deferral, not something later
   discovered by grepping the database.
3. **`User.isPermanentAdmin` already exists on the schema** (`prisma/schema.prisma`) with no UI reading
   it yet. The brief is explicit that this has to read as a `LOCKED` chip stated before the click —
   "why can't I change this role" must never be answered by a failed save.
4. **Import is new from zero** — there is no import code anywhere in `src/` today. Brief `[5a]`
   specifies the shape: Upload → Validate → Results, where Validate is an explicit **dry run** (no
   writes; the whole verdict arrives at once, not a climbing counter), Results groups blocked rows
   **by cause** rather than repeating one line per row, and **partial import is the default** — not
   all-or-nothing. Rate limited to 10/min, matching the `checkRate` pattern every other action module
   already uses.
5. **The export path already refuses over its cap — don't regress that.**
   `src/app/(app)/inventory/export/route.ts` counts before querying and returns a 413 with nothing
   written past 10,000 rows; the Excel upgrade + split-by-year chips (brief `[5a]`) has to keep that
   behavior, not just change the output format. The one export gap already on record (§8, Phase 3) is
   real but narrower than "no cap": `?ids=` silently slices to 500 instead of refusing, which is worth
   fixing in the same pass rather than carrying into `/audit` and `/employees` exports as they're added.
6. **`/admin` has no Home of its own today** (§8, Phase 6) — it falls through to the IT layout, so an
   admin currently sees SLA breaches and fleet composition under a Users/Webhooks/Flags sidebar.
   Decide in the plan whether Phase 8 gives Admin its own Home or leaves that fall-through as the
   deliberate answer; don't let it stay merely unnoticed.
7. **The scanner contract (`?q=` exact-tag-match redirects to the record, README `[5a,1m,7g]`) is
   real everywhere it's been built, but the offboarding wizard doesn't yet tick a matching row when
   scanned** — Task 15's e2e confirmed there is no scan handling in
   `src/app/(app)/offboarding/[employeeId]/page.tsx` today. That polish is explicitly Phase 8's, per
   the brief.
8. **Re-read README cards `3h` (Admin workspace) and `5a, 1m, 7g` (Import / export)** before drafting
   tasks — they're the source for the locked-row, dry-run, blocked-row-grouping and 10,000-row-cap
   behavior above, plus the label sheet and USB-scanner specifics not repeated here.

---

## 7. Recurring gotchas that have cost real time

- **Prisma `mode: "insensitive"` on an identity/`equals` field compiles to ILIKE**, making `%`/`_` wildcards — caused an auth bypass AND an enumeration oracle. Use `findUnique` on a normalized value. `contains`-search is the sanctioned use.
- **Installing any npm package on Windows** drops the Linux optional-dep trees (`@tailwindcss/oxide-wasm32-wasi`, `@emnapi/*`) from `package-lock.json` and breaks the Alpine prod `npm ci`. Regenerate inside Linux: `docker run --rm -v "$PWD:/app" -w //app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only --no-audit --no-fund"` (Git Bash needs `MSYS_NO_PATHCONV=1` and `//app`).
- **`auth()` immediately after `signIn(…, {redirect:false})`** in the same action returns a stale session — read from the DB instead.
- **Non-component exports from a `"use client"` module are not values on the server** — a server page importing an array from a client file gets a reference proxy and crashes at runtime; tsc and lint both pass. Shared constants live in `src/lib/`.
- **Reseeding invalidates every session** (new user ids). Stale JWTs escape via `GET /logout`, which clears the cookie; `requireUser` redirects there. Without it the login bounce loops forever.
- **Playwright: `--workers=1`, and every DB-touching spec file reseeds in `beforeAll`** — the files share one database and alphabetical order otherwise leaks state (approvals-audit deploys an asset and drains the badge that auth-shell asserts).
- **Prisma interactive transactions default to a 5s budget** — batch per-row loops (`createMany`, one `generate_series` nextval call) instead of N sequential round trips.
- **Seed payloads must mirror what the real producers write.** A seeded approval using `to.assignee` (an employeeNo) instead of `to.assigneeId` (a row id) made the happy-path demo item fail execution honestly but confusingly.
- **CSS syntax errors only surface at `npm run build`** — tsc and lint sail past a stray brace. That's what the full battery is for; run it before every merge.
- **Reviewers are usually right but occasionally wrong about repo facts.** One review asserted a migration didn't exist when it did. Verify claims against the migrations and the live DB before acting on them — then fix the real finding underneath.
- **Browser-pane quirks:** synthetic clicks often don't reach React handlers — dispatch a real bubbling `MouseEvent`/`KeyboardEvent` from `javascript_tool`, or use `form.requestSubmit()`. The sidebar only renders at `lg:` — use a 1280px viewport. Background reviewers may stop the dev server; `preview_list` and restart before the next live check.
- **Rows created in one transaction share a `createdAt` millisecond**, so `orderBy: { createdAt: "asc" }` alone is NOT a stable order — Postgres may return them either way between reads. Phase 5 shipped a bug where this flipped which purchase line was "unit 1", corrupting the `unit-N` anchors. Always add an `id` tiebreaker.
- **A partial update must write only the fields the caller sent, and guard each on its before-value.** Filling untouched fields from the row you read (`specs ?? unit.specs`) rewrites them with a value that is already stale under READ COMMITTED — two people editing different fields of one row silently clobber each other, and a `diffOf` against the same stale row records no trace of it.
- **Prisma throws; it doesn't return.** Without a `try`/`catch` a P2028 (transaction couldn't get a connection — reachable with just two concurrent transactions) escapes as a 500 instead of the designed conflict banner. Every actions module needs the mapping.
- **Widening a path rule can leave an operation ungoverned.** Granting `/purchases` to the IT workspace made every role pass the path gate, so "who may create a request" stopped being answered by any layer until `DRAFT_ROLES` was added. When you widen a gate, ask which rule it was silently carrying.
- **A client-side navigation currently leaves the previous page's DOM in the document** (a second `<table>` outside `<main>`). Reproducible between two Phase-3 pages, so it predates Phase 5; observed in dev only, not investigated.
- **A long-lived dev server degrades the e2e suite into phantom failures.** After several full runs its resident memory climbed ~8.5GB → ~12.2GB and a different set of pre-existing specs failed each time, always as "clicked a link, the heading never arrived" — every one passing in isolation. Restart the preview before a confirmation run; the suite went 75/75 immediately afterwards.
- **A seeded fixture that doesn't exercise its own design is a silent gap.** Phase 6 found two: every asset shared one purchase date (so the five-bucket age histogram was one bar and the 4y+ amber could never render) and nothing expired inside the 90-day warranty window (so the clustered pair the design is about never appeared). When a screen's designed state can't occur against the seed, fix the seed — that is what it is for.
- **A Prisma filter cannot compare two columns.** A derived facet whose rule spans fields (repairs' `beyond-repair` = quote ≥ 60% of cost) either changes shape or narrows to a candidate set in SQL and gets its final cut in memory from the same pure function that renders it. Two rules for one concept is the failure mode.
- **Widening one end of a pipeline means auditing its readers.** Teaching `lifecycle.return` four outcomes also required fixing `summarizeApproval` and the "Return target" system check, both of which had `SPARE` hard-coded — and a third reader (`summarizeApproval`'s `?? "SPARE"` fallback) that invented a target for the one payload with none, contradicting the check rendered one card away.
- **A new audit `action` string is invisible to the display layer until you teach it.** `auditSentence` falls through to a raw default and `actionDot` matches exact strings, so `offboarding.completed` rendered as "X offboarding.completed Y" with a neutral dot until both were extended.
- **Returning a failure from a `$transaction` callback COMMITS it** — only a throw rolls back. Every `return conflict(...)` in the offboarding actions precedes every write, which is what makes them safe; adding a write before one would commit silently.
- **Mutation-test a new pure rule before trusting its tests.** Reversing a comparator and weakening a filter both left Phase 7's `decisionOf` suite fully green; the weakened version silently produced a `Decision` with `outcome: null` and a receipt with `undefined` money keys. Five targeted rows now kill five distinct mutations.
- **A "weak type" swallows props silently.** A component whose prop type has *every* field optional turns off TypeScript's excess-property check, so passing a prop it doesn't declare compiles and is then dropped at runtime. `Th` ate `aria-label` at four call sites this way. When a component doesn't spread rest props, the prop has to be declared and forwarded.
- **Copy that is true in one state is a bug in another.** Three of the Task 9 findings were sentences the plan wrote assuming the only way to arrive: "Equipment is settled" on a step reachable while items are undecided, "This offboarding is closed" for someone who never started one, "nothing was ever returned" on a windowed item set. When you write a sentence about state, enumerate the states that reach it — `?step=` and a rejected approval both get there.
- **Centralising a rule only helps if every call site actually goes through it.** `withRepairStage` was extracted so a stage chip could not leave the contradictory `status` pin in place — and the generic `ChipFilterRow` on the same page rendered a *second* stage chip that bypassed it entirely, with the opposite removal semantics. When you extract a rule, grep for every other place that writes the same thing.
- **A SQL "candidate set" is not safe to act on.** When a derived facet narrows in SQL and makes its final cut in memory, every consumer of that `where` needs the cut — not just the one that renders the list. `buildAssetWhere` has four (list, facet counts, CSV export, and `bulkRequestStatusChange`, which acts on *all matching*), so a cut applied only to `listAssets` would let a screen showing 1 row create 7 approvals. See Task 12's preamble.
- **Floating point is not inclusive on a money grid.** `quote >= cost * 0.6` looks like the 60% line the copy promises, and is — on whole pesos. `Asset.cost` is `Decimal(12,2)` and the forms take centavos, where ~2.6% of exact-60% points fall the wrong way (₱6,000.57 of ₱10,000.95 is exactly 60% and failed). Compare in whole centavos. A test that uses round numbers proves one lucky pair, not the boundary.
- **`design_handover/` is excluded from lint/build** and must stay untouched — it's the source of truth, not code.
- **A UI confirmation that clears itself on a timer needs headroom on the assertion, not just on the timer.** `/inventory/[id]/edit`'s "✓ Saved" is a 3-second self-clearing flash (`setSaved(true)` plus a 3000ms timeout in `src/components/inventory/asset-form.tsx`), so the default 5s Playwright budget has to cover the whole server-action round trip *before* the flash even starts. A dev server minutes into a full e2e run occasionally takes long enough that it doesn't, and the failure looks like "element(s) not found" with the button still reading `"Loading" [disabled]` — nothing points at a timing race. It failed once in three full runs and was reproduced byte-for-byte by delaying `updateAsset` 7s. Fixed with a 20s assertion, not a weaker one.
- **A new audit `action` string needs a reader that will actually see it — check that BEFORE teaching the display layer, not after.** Phase 7 initially taught `auditSentence` four new cases and then reverted all four: the app's activity feeds each scope to one `entityType` (`employee` / `asset` / `purchase-request`), and `/audit` itself renders `listAudit`'s raw `action` string plus the diff's **key names** — it never calls `auditSentence` at all. So the four new cases were unreachable by any page in the app, and their tests were exercising dead code. Before adding a case for a new `entityType`, trace which surface would actually route it through the function you're editing.

## 8. Deferred / out-of-scope (tracked, don't lose)

- **Phase 4 leftovers:** `/approvals` shows the first 50 rows of a tab with a "showing N of M" hint but no pagination; no admin surface reads the `Job` table (Phase 8's deliveries page is the natural home); the worker's stale-lease recovery uses a 5-minute wall-clock heuristic (safe now because every terminal write is state-guarded).
- **Phase 5 leftovers:** the draft autosave churns unit rows (`createDraft`/`saveDraft` return only request-level fields, so `/purchases/new` never learns the unit ids it just created and every later autosave deletes and recreates the set — `/purchases/[id]/edit` does pass real ids and updates in place); `/purchases` has no sortable headers or column chooser; the ⌘K palette now returns purchase requests to `it_staff` and `viewer`, and the detail page shows money and finance notes to anyone who can reach it (no field-level restriction was specified); `addComment` deliberately still accepts comments on COMPLETED/CANCELLED requests.
- **Settled 2026-08-17 — "Admin" means system administration, and the procurement department is just Purchasing.** No renaming is pending: the `Admin` workspace (Users & roles / Webhooks / Feature flags) is software settings, the `admin` role is the superuser, and the procurement workspace is `Purchasing` as built. Recorded only so nobody re-opens it.
- **Phase 6 leftovers:** the Admin workspace has no Home of its own (`ws === "admin"` falls through to the IT layout, so an admin sees SLA breaches and fleet composition under a Users/Webhooks/Flags sidebar); "Retry this section" refreshes the whole route because RSC has no per-section refetch; section degradation is loader-level, so a render-time bug inside a section still escapes to the route error boundary; `/finance/assets` has no search, no sortable headers and no book-value column (depreciation is a policy nobody has stated); Home's `DATA` rows key on `DATA:<assetId>`, which is unambiguous only while an asset can't be both MISSING and DEPLOYED-without-a-holder.
- **Phase 3 leftovers:** CSV export buffers up to 10k rows in memory and silently truncates `?ids=` beyond 500; sort remount drops keyboard focus to `<body>`; `EntityCombobox` lacks a listbox accessible name and Home/End.
- **Phase 7, Task 14 — equipment-policy leftovers:** the before/after slot lists `auditSlots` writes on every policy edit are **stored and queryable but rendered nowhere** — `/audit` shows only `slots` as a changed *field name* (see §7's audit-reader gotcha above), and no UI anywhere in the repo renders an audit diff's *values* for any entity. A policy-scoped activity feed, or diff-value rendering on `/audit` generally, is what would make them legible. Nothing prevents two policies targeting the same department or title — the schema has no constraint and `createPolicy` only checks the policy *name* for uniqueness. Task 14 answered this by ordering all five `equipmentPolicy.findMany` calls that feed `resolvePolicy` by name, so the first-match tie-break is deterministic — which makes the winner **stable, not correct**. The shadowed policy stays fully editable and governs nobody; the only visible signal is its card reading `0 people`, which is ambiguous with a policy that legitimately targets an empty department. Titles are case-folded when `resolvePolicy` matches them but stored raw when created, so `Accountant` and `accountant` would collide invisibly at resolve time while reading as two distinct policies on the page. The module is also create/delete only — **no rename and no retarget** — so fixing a typo'd title means deleting the policy, which cascades every slot and severs the audit chain; `renameRefRow` in `src/server/modules/admin/reference-actions.ts` already does this for the sibling reference-data rows (asset categories/types/departments) and is the template. `auditSlots` infers what changed by set-differencing two slot-list snapshots taken around the write, so under READ COMMITTED a concurrent edit to a *different* slot of the same policy lands inside this actor's from→to pair — the stored lists stay correct, only an inferred summary of "what this actor did" would be wrong; carrying the acted-on slot id explicitly would close it. And the policy card's "N people" counts `employment: { not: "OFFBOARDED" }`, but `listEmployees` (which lights up the policy-gaps filter) applies policies to every matching employee, offboarded included — so an offboarded person can trigger a policy gap under a policy whose own card does not count them. `/admin/equipment-policies` also has one **moderate** axe `heading-order` violation, and it's app-wide rather than new to this page: `PageHeader` renders an `<h1>` and `CardHeader` renders an `<h3>` (`src/components/ui/page-header.tsx`, `src/components/ui/card.tsx`), so every page that combines the two skips `<h2>`. It sits below the serious/critical bar the e2e specs assert on, which is why it hasn't blocked anything yet.
- **Phase 7, Task 15 — close-out leftovers:** `/offboarding` and `/reservations` have no pagination, sortable headers or facets — team-scale lists, currently unbounded; the offboarding wizard doesn't yet tick a matching row when a USB scanner hits it (Phase 8's scanner polish, §6); the farewell report is printable but neither emailable nor an Excel export (the brief's `farewell-report` export route is Phase 8); `RETURNED OK` shows `—` in the Down column because `downDays` returns `null` for anything not `status === "DEFECTIVE"`, and nothing records when a repair actually ended; `/reservations` is read-only by design (scope decision #10), so holds are still created and released from the asset record, not from this page; and the repairs stage facet pages in memory, which scope decision 5b judged correct at team scale but would need a generated column at fleet scale.
- **Phase 7, Task 13:** `RESERVATION_TABS` / `parseReservationTab` live in `src/server/modules/reservations/queries.ts` alongside the Prisma call, where every sibling list (`inventory-list.ts`, `approvals-list.ts`, `purchases-list.ts`, `audit-list.ts`, `employees-list.ts`) puts its pure tab/parse logic in `src/lib/*.ts` with a unit-test file. Bundled with the query, it cannot be unit-tested without pulling in the DB client — which is why it is the one list parser with no test. Worth normalising if that module gains any more logic.
- **Phase 7 so far:** a 3-character reason minimum accepts invisible characters (`trim()` strips Unicode `Zs` but not U+200B/U+2060), so a MISSING item can carry a blank-looking justification — shared with `requestReturn` and `rejectApproval`, so the fix is one zod refinement in a shared helper, not a per-action patch; four separate copies of "read a string field off a `Prisma.JsonValue`" (`obj`/`str` in `approval-execution.ts`, `returnTargetStatus`, `payloadReason`, and the `target` hoist in `approvals/queries.ts`) agree today and could be one exported pair; `getWizard` reads assets and approvals as two statements, so a worker commit between them shows an item as undecided for one render (self-correcting, and `decideItem` refuses with its designed conflict — closing it needs `RepeatableRead`, i.e. a transaction per render, which was declined deliberately); an empty policy slot on a leaver reads "not held" but does not yet distinguish "already returned" from "left their name with no return at all"; **`SegmentedControl` exposes no `aria-describedby`/`aria-invalid`**, so `ItemDecision`'s "pick an outcome" `FormError` is announced but not associated with the radiogroup that caused it — and now that "no value" is a meaningful, refusable state for that control (Task 8), the props are worth adding; **all four offboarding components hand-roll the `ok / rate_limited / validation / conflict` ladder** that `loadout-view.tsx` already abstracted into a local `handle<T>()` and `asset-form.tsx` extended — the duplication is what produced two of the Task 8 review's defects (a missing `validation` branch and a dropped unclaimed-key fallback), so a shared `useActionResult` in `src/components/patterns/` would be a real fix rather than tidying; **`beyondRepair` answers `false` for an asset with no recorded `cost`**, so an asset registered without one (the forms allow it; every seeded asset has one only because `mk()` defaults it) can be quoted any amount and still read TO ASSESS with no write-off warning — it is a three-state question (yes/no/unknown) being answered as a boolean, and Task 12's record view is where "no acquisition cost recorded" should surface; **nothing has ever written `defectiveSince` except the seed and, as of Task 11, the worker** — every asset that reached DEFECTIVE before this sits at `null`, which reads as `to-assess` with a permanently blank Down column, and `updateSchema` deliberately excludes the field so there is no way to correct it but to bounce the asset out of DEFECTIVE and back in (destroying the original date); that untested `status === "DEFECTIVE" && defectiveSince === null` branch wants a backfill (`UPDATE "Asset" SET "defectiveSince" = "updatedAt" WHERE status = 'DEFECTIVE' AND "defectiveSince" IS NULL`) and an editable field before this ships to anyone with real data; **`downDays` counts elapsed 24h periods, not `Asia/Manila` calendar days**, unlike the rest of the app; and **`beyond-repair` outranks `at-vendor` in `repairStage`**, so an item physically sitting at a vendor with a high quote loses its at-vendor-ness in the chip — a decision attribute hiding a location attribute, which matters if the screen is used to chase equipment. **From Task 12's review, all judged worth recording rather than fixing now:** `facetOptions` still counts the repair *candidate* set, so Category/Type/Assigned counts read slightly high in repair mode (the Status facet, the one case that offered an unsatisfiable combination, is now hidden instead); the CSV export's 10k guard runs *after* `repairStageIds` has materialised the candidate set, so that path can exceed the bind-parameter limit before the friendly 413 (unreachable at team scale); `repairStageIds` resolves outside the transaction, a deliberate exception to `bulkRequestStatusChange`'s "reads happen INSIDE the transaction" — the alternative makes `BULK_MAX` count candidates instead of the cut; the `HOLD` marker is hidden whenever an assignee is present and never discloses expiry, and **nothing anywhere sweeps `ACTIVE → EXPIRED` at `expiresAt`**, so a long-expired hold still renders as live; and `Reservation_one_active_hold_per_asset` — which `reservations[0]` now depends on for correctness — exists only in raw migration SQL, not in `schema.prisma`.
- Entra SSO real wiring (needs tenant creds). Real product photography, brand mark, barcode generation (striped placeholders today). Off-device backups (nightly `pg_dump` to a local volume ships; copying elsewhere is the user's call). HR review of the accountability-form acknowledgement copy. `WebhookEndpoint.secret` encryption (Phase 8). CI workflow + jsdom component tests (declined in Phase 1, revisitable).
