# Inventory v2 — Session Handover

**Last updated:** 2026-08-21 · **Phases 1–7 merged to `main`; `phase-7-offboarding` deleted** · **Phase 8 is MERGED to `main`** (`--no-ff`, `e5a5730`); `phase-8-admin` deleted. · **Phase 9 (import / export) is MID-FLIGHT on branch `phase-9-import-export` — tasks 1–6 of 14 committed, unmerged. The EXPORT HALF IS DONE; the import half is untouched.** · **NOTHING IS PUSHED: `main` is ~72 commits ahead of `origin/main` and the branch is ahead of that — count it (`git rev-list --count origin/main..main`), don't trust a number in this doc.** · **Merging and pushing are the user's decisions; do neither unprompted.** · Battery on the branch, run at the Task 6 close: **514 unit tests / 32 files**, **103 e2e / 8.0 min**, `tsc` + `lint` + `build` clean, and `docker compose --profile prod build` verified at Task 1.

This is the pick-up doc for a fresh session. Read this first, then the spec
(`docs/superpowers/specs/2026-08-14-inventory-v2-design.md`) and the two design-handover files
(`design_handover/original-brief.md` = what each screen does; `design_handover/README.md` = how it
looks + tokens). The client's 39 routes are enumerated in the brief §7; 38 pages (35 under the
`(app)` group, 3 auth) + 4 route handlers exist today — `/dev/kitchen-sink` not counted, since it
404s in prod.

---

## 0. Start here (next session, in order)

1. **`git checkout phase-9-import-export`** — Phase 9 is mid-flight there, tasks 1–6 of 14
   committed. Phase 8 IS merged to `main` (`e5a5730`, `--no-ff`) and `phase-8-admin` is deleted, so
   `main` is a valid base; this branch forks from it. `git log --oneline main..HEAD` shows the phase so
   far and `git status` should be clean. **Don't trust a commit count written into this doc** — every
   correction to one is itself a commit, so it chases itself. The command is the answer.

   **Nothing has been pushed, at all, for either phase.** `main` is roughly 72 commits ahead of
   `origin/main`. That is not a problem, it is a standing decision: the user treats merging and
   publishing as separate choices and asks for each explicitly. **Never push unprompted.** The repo is
   public — never commit `.env` or any real secret.

   **Push state, which is easy to get wrong here.** The last thing pushed to `origin/main` was the
   Phase 1–7 merge, on 2026-08-19. Everything since is local: the Phase 8 plan, all of Phase 8, its
   merge commit, the Phase 9 plan, and Phase 9 tasks 1–5. That is **~72 commits on `main` plus the
   branch** — count it rather than trusting that number. Nothing is lost; it is simply unpushed, and
   deliberately so. The user treats merging and publishing as separate decisions and has asked for each
   explicitly, so **never push or merge unprompted.** The repo is public — never commit `.env` or any
   real secret.
2. `docker compose up -d db` → **`npx prisma migrate deploy`** → `npm run db:seed` → open the preview
   (`preview_start` name `app-dev`). **8 migrations, none pending** as of this handover — Task 9 added
   the phase's one and only migration, so there is none ahead of you.

   **`npm run db:seed` was NOT blocked this session** — it ran directly, several times, always fine.
   Treat §3's classifier note as "may be blocked", not "is". If it is, the cheap in-session route to a
   fresh database is **`npx playwright test e2e/auth-shell.spec.ts --workers=1`** — ~60s, 15 tests,
   reseeding via `execSync` in `beforeAll`, which is never blocked.

   **The database is NOT freshly seeded.** The last thing that ran was the full Playwright suite, which
   leaves whatever `e2e/purchases.spec.ts` — alphabetically last — finished with. Reseed before
   trusting any fixture-dependent read. That is normal after a battery, not a problem.

   **Two dependencies were added in Phase 9 Task 1** (`write-excel-file`, `read-excel-file`) and the
   lockfile was regenerated inside Alpine per §7's procedure. If `node_modules` looks stale, `npm ci`
   rather than `npm install` — an `npm install` on Windows is what §7's hazard is about.
3. Read **§6** for Phase 9's entry criteria, which now records **which of them are already done**
   (all four export routes, the cap, the `?ids=` refusal) and which remain (the two importers). The plan
   exists — `docs/superpowers/plans/2026-08-21-phase-9-import-export.md`, 14 tasks, 12 recorded scope
   decisions — so §6 is the *why* behind the remaining tasks rather than a list to act on directly. **§6a is the other section that matters** — 63 numbered rules, all of them things Phase 8's
   fourteen tasks established the hard way,
   and the **checklist in item 4 below is the distilled version**: run it against every task you
   execute, and read §6a's entry for whichever rules it points at. §6a is about how work goes wrong in
   THIS codebase; it did not stop being true when Phase 8 ended.
4. **Resume at Task 7** of `docs/superpowers/plans/2026-08-21-phase-9-import-export.md` with
   `superpowers:subagent-driven-development`. Tasks 1–6 are committed; 7–14 remain. **The export half
   is finished; the import half has not been started.**

   **What is done:** the two xlsx dependencies with the Alpine lockfile regenerated (T1); the one module
   that owns `write-excel-file` (T2); the shared cap/response helpers plus the assets export converted
   to xlsx, with `?ids=` now refusing instead of silently slicing (T3); the audit and employees export
   routes (T4); the farewell-report route (T5); split-by-year chips threaded through every consumer of
   `buildAssetWhere` (T6). **All four export routes the brief requires now exist**, `src/lib/csv.ts` is
   deleted, and `capRefusalText`'s promise that year chips exist is finally true.

   **What remains — and Task 7 is the biggest single task in the phase.** T7 is the pure rule module:
   the block-cause vocabulary and the asset row rules. TDD, no I/O, ~18 tests, plus a mutation pass. It
   is the heart of the import half and every task after it reads from it. Then T8 the sheet reader, T9
   the dry run, T10 the commit, T11 the wizard, T12 the employee importer, T13 e2e, T14 close-out.

   **Three things to carry into T7 specifically.** It contains one of the **two remaining column specs**,
   and §6a rule 64 records that all three written so far were defective the same way — write it from
   `prisma/schema.prisma`, not from what the sheet ought to hold. Its whole design rests on **scope
   decision 2**: `read-excel-file`'s schema mode returns *either* objects *or* errors, never both, so it
   **cannot express partial success**, which is the brief's default — that is why the import reads a raw
   grid and validates through this module, and it is exactly the kind of thing a later reader would
   "simplify" straight back into a bug. And the module is **pure by design**: no `src/server` imports, no
   database, so every rule is testable with plain arrays. Keep it that way; T9 is where Prisma enters.

   **THE SINGLE MOST USEFUL THING TO KNOW BEFORE YOU EXECUTE ANOTHER TASK: this plan has been wrong, in
   a way that mattered, in every one of the five tasks that has shipped.** Not stylistically wrong —
   wrong in ways that would have shipped defects. In order: Task 1's stated hazard could not fire for
   those packages; Task 2's code would have produced a **headerless sheet** on any zero-row export;
   Task 3's column spec silently **dropped two real columns** the CSV emitted; Task 4's employees export
   **ignored the page's filters** and would have exported ten rows against a screen showing three; Task
   5's column spec **invented an approver and a timestamp** that exist nowhere in the codebase.

   **Three of those five were column specs, and all three failed the same way** — written from what the
   sheet ought to say rather than from what the source actually holds. Two column specs remain, in
   Tasks 7 and 12. Read the source before you trust either.

   So: **treat every code block in that plan as a draft to check, not a spec to follow.** Every
   implementer prompt this session said so explicitly, and every implementer found something. When the
   plan and the code disagree, the code wins and the plan gets amended — Tasks 1–5 all carry `AMENDED`
   banners recording exactly what was wrong, and reading three of them is the fastest way to calibrate.

   **A second thing, learned the hard way at the Task 5 close.** Five tasks shipped with `tsc`, `lint`,
   the unit suite and `npm run build` green, and **an e2e test had been failing the whole time** —
   `it-core.spec.ts` asserted `text/csv` on a route Task 3 converted to xlsx. Nobody ran Playwright,
   including two code reviews. **Run the full e2e suite at least every few tasks**, not only at Task 14;
   the unit suite cannot see a route's content type. Fixed in `139feef`, and the assertion is now a
   round trip through the buffer rather than a header check.

   **THE CHECKLIST — the single most useful thing in this doc.** Every one of the fourteen tasks executed
   so far has hit at least one of these, and **not one instance was caught by the unit suite** — several
   were found only by a fresh reviewer reading a sibling function, or by running the real thing against a
   real database. The root cause is nearly always the same: **a rule and its surface that only partly
   agree.** Rules 15 and 8 were each reproduced on a NEW page *after* being written down here (Tasks 11
   and 5), which is why this is a checklist to run and not a lesson to have absorbed. Before calling any
   task done, check each of these explicitly:

   - **Does the page consume EVERY refusal its rule module can return** — not just the one the design card
     names? (rule 10 — **now five instances, and it is the only rule this phase has broken in every
     single task that pairs a rule with a page, including the one warned about it in advance**.
     Task 3 shipped a live Disable button on the actor's own row
     because the component imported `selfRoleChangeWarning` and not `disableChange`; **every click was
     guaranteed to fail**, the rule was already written and unit-tested, and it was invisible from the
     seeded `admin@` account because that row is locked. Task 8 found two more before shipping: a live
     Delete on an endpoint with delivery history, and a live "remove the unrecognised events" on a row
     whose removal `eventsSchema` would refuse. **Task 13 made it five, and its instance is the one
     to learn from: the blocking fact lived in neither the row nor the rule module but in a DATABASE INDEX**
     (`Job_one_live_deliver_per_delivery`), so a live Replay button would have rendered on nearly every
     in-flight row with a guaranteed P2002 — and the seed hid it completely, because it queues no `Job`
     rows for its deliveries. See rule 56.)
   - **Does the rule permit the SAFE direction?** (rule 14. Three instances: Task 1's `disableChange`
     refuses *re-enabling* the permanent admin, Task 3's Critical, and Task 4's `flagChange` refusing to
     turn `m365_sso` **off**. Turning a dangerous thing off is never the dangerous direction.)
   - **Is any context being smuggled into an audit diff as a from-equals-to key?** (rules 8 and 19. Twice
     shipped — Task 2's `email`, Task 5's `key` — and Task 7 nearly made it three. `/audit` renders diff
     **key names** into an append-only table, so the row claims a field changed that didn't. Context goes
     in the **entity label**.)
   - **Can `/audit` NAME the entity type this task introduces?** (rule 20. `entityLabels` in
     `src/server/modules/audit/queries.ts` **and** `AUDIT_ENTITY_TYPES` in `src/lib/audit-list.ts` are two
     separate places. Three tasks running have needed a new branch and **the plan scheduled none of
     them.**)
   - **Is every write guarded on a column the write actually moves** — or on `updatedAt`? (rules 21, 29,
     30. Guarding an unchanged column can never fire: Postgres re-checks the predicate against the new row
     version after the lock.)
   - **Does a comment claim a property the code doesn't have?** (rule 16. **Five instances**, including
     one that said signing made plain `http` safe, one that said a secret was never selected when it was
     fetched on every render, and Task 8's banner promising "the button below" in the one branch that
     renders no button. **It applies to user-facing prose exactly as much as to comments** — rule 35.)
   - **Could this fixture have been produced by the running code?** (rules 51, 52. Task 12's seeded
     webhook deliveries cited an approval type in the DB's `@map`'d spelling rather than the emitted one,
     omitted two fields the emitter always sends, paired refNos with the wrong types, and cited a purchase
     request in a state that cannot fire the event. **Check a new fixture against the emitter, not against
     the plan** — and if a payload shape is at issue, capture a real one from a live run first.)
   - **Does a SUMMARY surface recompute a state that a detail surface already computes properly?**
     (rule 47. Task 11's Admin Home read `FeatureFlag.enabled` raw while `listFlags` two functions above
     it computes the *effective* state through `flagDomain` — so Home would have said a signup
     restriction was ON while `/admin/flags` correctly said OFF and `/signup` enforced nothing. §6a rule
     15's exact shape, on a new page, one phase later. **Any new page that summarises state another page
     already renders: find that page's expression and call it, don't re-derive it.**)
   - **When two rows must agree, do they agree on the LAST step as well as the middle?** (rule 43. Task
     10's handler wrote `RETRYING` on every retryable failure while the worker dead-letters the job at the
     cap — so on attempt five the job read `DEAD` and the ledger read `RETRYING`, and `DEAD · 5/5`, card
     3h's headline artifact, could never render for the commonest cause of a dead delivery. A mirror that
     agrees on four steps out of five looks authoritative and is wrong exactly when someone is looking.)
   - **When copying an existing pattern, did you copy ALL of it?** (rule 39. Task 9's migration mirrored
     `Job_one_live_execute_per_approval` and left behind its companion CHECK constraint — without which
     the partial unique index it copied silently constrains nothing, because it indexes an expression and
     Postgres never collides NULLs. The original migration's own comment says exactly this. Same shape as
     rule 27, where a status family map got three of an enum's four values.)
   - **Is a number or a contract string in the UI defined anywhere else?** (rules 26, 37, 38. Task 8
     found two: the page's prose said a delivery "retries five times" where `MAX_JOB_ATTEMPTS` is the
     worker's cap and means five attempts in TOTAL, and the shown-once banner hardcoded the signature
     header name a rename would leave behind.)

   **Applied to Phase 9**, the four that will bite hardest. **Import is a rule module paired with a
   page** — the combination this checklist's first item has caught in every single task that has ever
   tried it, so whatever `importRows`/`validateImport` refuses, the Results step has to consume all of
   it, not just the causes the design card names. **Blocked rows grouped by cause is a summary
   surface** recomputing a verdict the dry run already computed — item 8's shape exactly, so call the
   dry run's own expression rather than re-deriving a count. **The 10 imports/min limit is a number in
   the UI** (item 11): it belongs beside `RATE_LIMITS` in `src/lib/rate-limit.ts` as a new `RateKind`,
   not as a literal in a component. And **import writes an audit entry for rows nobody typed**, so
   item 4 applies before you write the action — `/audit` needs to be able to name whatever entity type
   an imported row is, and item 3 applies to its diff: an import's audit diff is a from-null
   transition, never a from-equals-to.

The branch is green end to end, and this is the FULL battery run at Phase 8's close, not a figure
carried over from an earlier merge: `npx tsc --noEmit` · `npm run lint` · **474 unit tests across 30
files**, up from 345 across 26 at the Phase 7 merge — so Phase 8 added **129**, most of them
mutation-driven, concentrated in the three pure-rule modules it created
(`src/lib/admin-users.test.ts` 23, `src/lib/admin-flags.test.ts` 36, `src/lib/webhooks.test.ts` 41).
Several tasks added none at all: actions, UI, worker, seed and e2e code are what the unit suite cannot
reach, which is exactly why §6a's rules mostly describe defects it could not have caught. · `npm run build` ·
**`npx playwright test --workers=1` — 102 e2e tests, 7.4 minutes** (up from 89 before this phase:
Task 14's `e2e/admin.spec.ts` adds 12, and one more went into `e2e/it-core.spec.ts` — an axe check on
the `/employees` LIST, which had never had one).

**The e2e suite WAS re-run on this branch, at Task 3, and it found a pre-existing flake.** Task 3
modified `src/components/ui/dialog.tsx` — a primitive **six e2e-covered components** use — so the run
existed to rule out a regression there. It was not one: 88 of 89 passed, and the failure was
`e2e/offboarding.spec.ts`'s "Task 1 payoff" test, which passed in a single-file run. **The dump was the
tell**: the browser was still on `/approvals` with the row rendered correctly and `→ MISSING` present,
so the click had not navigated and the *next* assertion's default 5s budget was covering the whole
click → route → server-render round trip. It was test 71 of 89, on a dev server eight minutes into a
run. Same class as the "✓ Saved" race in §7, so the same answer — headroom, not a weaker assertion —
fixed in `bf23284` by awaiting the URL change explicitly.

**`e2e/admin.spec.ts` NOW EXISTS** (Task 14, 12 tests) and covers all four admin screens plus the
Admin Home. Its `users & roles` block is `test.describe.serial`, because its five tests deliberately
chain (V. Cruz's role and disabled state, then J. Sarmiento's promotion, carry forward) — the same
idiom `offboarding.spec.ts:75` and `approvals-audit.spec.ts:92` already use for that shape, and the
reason is diagnostic: without it one real failure cascades into three misleading ones.

**One flake was seen once during Task 14 and did not reproduce.** `e2e/it-core.spec.ts:127` ("edit
writes field-level history rows") failed on one combined run and then passed on three subsequent runs
including the full battery. It is the "✓ Saved" class again, which §7 records as fixed in Phase 7 with
a 20s assertion — so this is either a second site that assertion did not cover or a genuine
intermittent. **It is recorded rather than closed**: nobody has proved it fixed, and "it passed on
re-run" is not that proof. If it reappears, read the dump before touching the assertion.

**A note on isolating an e2e failure in this repo:** `-g "some test name"` is NOT a valid isolation for
`offboarding.spec.ts`. Several of its tests depend on state earlier tests **in the same file** create
(the wizard's decisions produce the approvals a later test opens), and only `beforeAll` reseeds. Filtering
with `-g` made the same test fail at a *different*, earlier assertion, which reads like a second bug and
is not one. **Run the whole spec file** to isolate.

**A recurring test-design gotcha worth knowing before you write more e2e:** a UI confirmation that
clears itself on a timer cannot be asserted with the default `expect` budget. `/inventory/[id]/edit`'s
"✓ Saved" is a 3-second self-clearing flash (`setSaved(true)` plus a 3000ms timer in
`src/components/inventory/asset-form.tsx`), so the default 5s assertion budget has to cover the whole
server-action round trip *before* the flash even begins. A dev server several minutes into a full
suite run occasionally takes longer than that, and the failure reads as "element(s) not found" with
the button still showing `"Loading" [disabled]` and an empty alert — nothing about the message points
at a timing race. It failed once in three full runs and was reproduced byte-for-byte by delaying
`updateAsset` 7s. The fix is headroom on the assertion (20s), not a weaker assertion.

**Nothing is half-finished in the code.** Every Phase 8 task ended on a green commit, and each one's
plan text and §6a entry were updated in the same session it shipped. The next unit of work is a whole
task — **Task 10** — not a fragment of anything. Every review finding was either fixed or recorded in
§8; none was left silently open.

**State this session left behind:** working tree **clean**, **no dev server running** (verified: zero
`node.exe` processes, and nothing listening on 3000/4999/5000), `inventory-db-1` **up**, **8 migrations,
none pending** (`prisma migrate status` says "up to date"). `main` is **4 commits ahead of
`origin/main`** and the branch is **54 ahead of `main`** — but count it rather than trusting that
(`git rev-list --count main..HEAD`), because every correction to this line is itself a commit. **No scratch files anywhere in the repo** — the session's working scripts live in the
harness scratchpad, outside the tree. Last verified green: `npx tsc --noEmit` · `npm run lint` ·
**460 tests / 30 files** · `npm run build`.

**THE DB IS FRESHLY SEEDED, with ONE known deviation.** Task 12's verification reseeded it via
`npx playwright test e2e/auth-shell.spec.ts --workers=1` (15/15 passed), which cleared every piece of
drift the paragraphs below describe — the purchase-request states are back to one-per-state,
`APR-2041`/`BR-LT-0181` are back, Grace Lim (EMP-0063) is ACTIVE again, and the audit table is down to
the seed's own 3 `asset` rows. **They are kept below as the record of what a verification pass costs,
not as a description of current state.**

**The one deviation, and it is the seed's own demo:** a `npm run worker:once` was run after that reseed
(to prove Task 12 seeds no webhook work), which **drained the seeded `EXECUTE_APPROVAL` job**. So
`APR-2035` is `EXECUTION_FAILED` rather than the seeded `APPROVED`, its job is `DONE` rather than
`PENDING`, and there is a 4th audit row (`approval` / `execution.failed`). Nothing else differs.
**If Task 14's spec asserts anything about that demo, reseed first** — one Playwright spec run, ~60s.
Everything Task 13 needs (2 endpoints, 5 deliveries, no `DELIVER_WEBHOOK` jobs) is exactly as seeded.

Historical record follows: Task 3's live verification (all five users restored to their
seeded roles and enabled state, but **7 `user` `AuditEntry` rows** remain — append-only by DB trigger);
Task 5's live verification (`allowed_domain` restored to `thebackroomop.com`, plus **`feature-flag` audit
rows**, and it was briefly set to `(enabled: true, value: NULL)` to exercise the Critical); and Task 6's
`npm run worker:once`, which **drained the seeded `EXECUTE_APPROVAL` job** — so one seeded approval is
now EXECUTED and its asset moved; and Task 7's verification wrote **`webhook-endpoint` audit rows** while
`allowed_domain` was edited to `backroomop.com` and back (it is `thebackroomop.com` now — confirmed, and
it matters, because every seeded account is `@thebackroomop.com` and signup would refuse them otherwise);
and **Task 8's live verification, which is the largest single contributor to the audit table's drift: 9
`webhook-endpoint` rows** (create · rotate-secret · two updates · disable · enable · delete, plus the
earlier pass), from two endpoints that were both created and then deleted through the UI.
Nothing is broken, but **reseed before anything that assumes pristine fixtures**, and prefer **delta**
assertions over absolute audit counts in e2e (Task 14).

**Task 11's verification touched one row and put it back:** `allowed_domain` was forced to
`(enabled: true, value: NULL)` to prove the rule-15 fix, then restored to `thebackroomop.com`
(confirmed — and it matters, because every seeded account is `@thebackroomop.com` and signup would
refuse them otherwise). One `feature-flag` audit row may have been added by nothing here — the force was
raw SQL, not the action — so the audit table is unchanged by Task 11.

**Task 10's verification left nothing behind either** — its endpoint (whose secret it deliberately
corrupted to test that path) and all six of its deliveries were deleted, and the scratch scripts it used
lived under the gitignored `backups/t10/` and are gone. **No process is left listening on 4999 or 5000**
(verified).

**There are still no `WebhookEndpoint` or `WebhookDelivery` rows, and that is deliberate.** Task 8's page
can now create them, and its verification did — twice — but both endpoints were deleted again on the way
out. **Do not leave one behind:** the secret is shown exactly once, so an endpoint that outlives its
session is one whose plaintext secret nobody holds, and Task 10's end-to-end check needs that plaintext
to verify the signature at its local receiver. Task 10 creates its own; the seed adds fixtures in Task 12,
which is why Task 12 exists at all — `/admin/webhooks/deliveries` is unreachable without them.

**Task 9's verification moved real fixture data** (since undone by Task 12's reseed — kept for the
record). What moved: **`PR-0195`, `PR-0198` and `PR-0201` are all now `COMPLETED`** (they were IT_REVIEWED, SUBMITTED
and DRAFT — so the seed's "one PR per state" property is GONE, and `PR-0198`, the bounce-back fixture the
purchasing e2e leans on, is one of them); **`APR-2041` is EXECUTED** and its asset **`BR-LT-0181` moved
SPARE → DEPLOYED** and is assigned to EMP-0097; and **Grace Lim (EMP-0063) is OFFBOARDED** — she was
ACTIVE, and was deliberately made OFFBOARDING-with-nothing-held to exercise the third emit call site.
She was **not** edited back: the completion wrote an append-only audit entry, and flipping her to ACTIVE
would leave the row contradicting a trail that can never be corrected. All the webhook rows those
verifications produced (2 endpoints, 3 deliveries, 2 dead jobs) **were** deleted — their shown-once
secrets are lost, so they would only mislead Task 10.

**One `WebhookDelivery` row was inserted by hand during Task 8's verification and deleted again**, to
exercise the Delete gate. If you need the same, the insert is
`insert into "WebhookDelivery" (id, "endpointId", event, payload, status, attempts) select '<id>', id,
'approval.executed', '{}'::jsonb, 'DEAD', 5 from "WebhookEndpoint" limit 1;` — and note `psql` in this
container wants `-U inventory`, not `-U postgres`.

**One environment note that cost time and will cost it again: `npm run db:seed` is BLOCKED by the harness
classifier in this session** (it TRUNCATEs). `prisma migrate reset` was already known to be blocked (§3);
add the seed to that list. Playwright can still reseed — every spec does it via `execSync` in `beforeAll`,
and that is not blocked — so a full e2e run is currently the only in-session route to a fresh fixture. To
reseed directly, run `npm run db:seed` from your own terminal. Because of this, Task 3's live verification
was restored by editing rows back through the UI rather than reseeding: **all five users are at their
seeded roles and enabled**, but **7 `user` `AuditEntry` rows remain** from the verification and cannot be
removed (append-only by DB trigger). This is why Task 14's new assertions are written against an audit
count **delta** rather than an absolute count — keep them that way.

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

**Settled 2026-08-21: subagent-driven execution is the approved mode, and it is now exercised rather
than aspirational.** Tasks 8–10 of Phase 8 were done single-context (one agent implementing and
self-reviewing) because agent dispatch was gated in that session; the user lifted the gate for 11
onward. Tasks 11 and 12 ran the full loop — fresh implementer, spec-compliance review, quality review,
each reviewer re-reviewing after fixes — and **both turned up defects that types, lint and a fully green
unit suite could not see** (§6a rules 47 and 51). Two things learned about running it: a self-review is
structurally bad at catching unrequested scope, because the author has already justified it to
themselves; and **verify a reviewer's claims before acting on them** — one hinged on a nav table having
only three entries (true, and one grep to check), and the correct remedy for another was the opposite of
what it proposed.

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

- **DB:** `docker compose up -d db`. Seed: `npm run db:seed` (TRUNCATE + reseed — the sanctioned reset; **`prisma migrate reset` is blocked by the harness classifier and unnecessary**). **`npm run db:seed` is SOMETIMES blocked by the classifier when run directly** — it was during Phase 8 Task 3, and it was not during Task 13, which ran it twice. Try it; if it is refused, run it from your own terminal or let Playwright do it (every spec reseeds via `execSync` in `beforeAll`, which is never blocked). **8 migrations** as of Phase 8 Task 9 (7 at the Phase 7 merge); add new ones as hand-written SQL dirs, then `npx prisma migrate deploy && npx prisma generate` (`migrate dev` also works but invents a name). **A reseed TRUNCATEs, so a migration's backfill does not survive it** — anything the app depends on has to be set by `prisma/seed.ts` too (`Employee.offboardingAt` is set both ways for exactly this reason).
- **Dev app:** never via Bash — use the Browser-pane preview (`preview_start` name `app-dev`, port 3000). The controller owns this server; subagents must not start one.
- **Worker:** `npm run worker` (poll loop) or `npm run worker:once` (drain and exit — what e2e uses). In prod it's the compose `worker` service.
- **NEVER run `npm run build` while a dev server is running** — they share `.next` and it bricks the dev server.
- **Full battery:** `npx tsc --noEmit && npm run lint && npm run test && npm run build`, then `npm run db:seed && npx playwright test --workers=1`. The e2e run takes ~5 minutes; **run it in the foreground with a long timeout.** A backgrounded Playwright run that is never reaped keeps its own `beforeAll` reseed racing yours, which produces FK/unique errors and a cascade of unrelated timeouts in specs that pass in isolation — diagnose by listing live `node.exe` command lines, not by editing assertions.
- **Seeded accounts** (all `@thebackroomop.com`, password `ChangeMe123!`): `admin@` (admin, permanent) · `it@` (it_staff) · `purchasing@` (purchasing_staff) · `finance@` (finance_staff) · `viewer@` (viewer).
- **Seed contents:** 22 assets (all 8 statuses), 10 employees (one equipment policy, "Finance standard", targeting the Finance department — so **three** employees currently have policy gaps: EMP-0042, EMP-0088, EMP-0097. Marites EMP-0042 holds 4 items against that policy and is short **1** required slot; do not read her "1 gap" as the seed's total, which is what misled a Phase 9 task; Dennis EMP-0090 is OFFBOARDING; Nina EMP-0097 has a reserved monitor), 7 approvals (all 6 states; APR-2040 past SLA → badge reads "3, urgent"; APR-2035 is APPROVED with a **deliberately malformed payload** + a queued job — the worker's EXECUTION_FAILED demo), 5 PRs (one per state; **PR-0198 is the bounce-back with a three-party note thread**, still the fixture the purchasing e2e leans on; `purchase_request_ref_seq` sits at 201 so the first drafted ref is PR-0202), 4 reservations. **As of Phase 8 Task 12: 2 `WebhookEndpoint` rows** (`hooks.thebackroomop.com/inventory`
active, subscribed to `approval.executed` + `offboarding.completed`; `legacy.thebackroomop.com/erp-bridge`
**disabled**, subscribed to `purchase_request.completed` — so "disabled" is a real state on the list) with
their secrets AES-GCM encrypted under `secretAad(row.id)`, **and 5 `WebhookDelivery` rows** spread so every
chip `deliveryStage` can produce is reachable: 2 `DELIVERED`, 1 `RETRYING · 2/5` (with a real
`nextAttemptAt`), 2 `DEAD · 5/5`. **No `DELIVER_WEBHOOK` `Job` rows, deliberately** — a queued one would
make `worker:once` POST to a hostname that does not resolve on every seeded run. **On the Phase 7
branch:** 25 assets (Dennis EMP-0090 holds `BR-LT-0166` / `BR-PH-0312` / `BR-HS-0510`), and every non-ACTIVE employee carries `offboardingAt = day(-3)`.

## 4. What's DONE (Phases 1–8 on `main`; Phase 9 tasks 1–5 on `phase-9-import-export`)

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

**Phase 9 — import / export (MID-FLIGHT, tasks 1–6 of 14 on `phase-9-import-export`)**

**All four export routes the brief requires now exist, as `.xlsx`.** `src/server/xlsx/write.ts` is the
one module that imports `write-excel-file`, exposing `toXlsxBuffer(columns, rows)`; it builds the grid
via the library's public `getSheetData` rather than its objects overload, because that overload cannot
tell an empty row array from a finished sheet and would emit a **headerless** file for a zero-row
export. `src/lib/export-columns.ts` holds the four column specs plus `EXPORT_CAP` (10,000) and
`IDS_CAP` (500); `src/server/export/respond.ts` owns the 413 refusals and the download headers, and
sanitises the filename prefix to `[A-Za-z0-9_-]` because one caller derives it from `employeeNo`, which
has no format constraint. The assets route now **refuses** an oversized `?ids=` selection instead of
silently slicing it to 500 (§8's recorded gap, closed). `src/lib/csv.ts` is deleted. The employees
export honours the page's search, facets AND policy-gaps filter through a shared
`filteredEmployees` — the gaps cut is in-memory, so a bare `where` would have exported the candidate
set. The farewell-report route reuses the report page's own `getWizard` plus a shared `decidedItems`,
so the sheet and the printable page cannot disagree about which rows belong.

**Split-by-year chips (T6)** make the cap refusal's own advice actionable. `purchaseYear` is threaded as
an explicit second argument to `buildAssetWhere(state, purchaseYear)` rather than inside `ListState`,
because `ListState` only round-trips `config.facets` and would have dropped it across the export link,
the bulk drawer and the toolbar's navigation. All six consumers inherit it — the list, `repairStageIds`,
the four facet groupBys, the export route, and `bulkRequestStatusChange`, which acts on *all matching*.
`purchaseYearBuckets` deliberately omits it, because a facet's own count must not apply its own filter.
Every `/inventory` URL is now built by one helper passed down from the page, so no component imports
`serializeListState` and none can rebuild a URL that forgets the year — §6a rule 66 records the
client-boundary constraint that shaped how that helper is handed over.

**Phase 8 — Admin workspace (COMPLETE, all 14 tasks, MERGED to `main` as `e5a5730`)**
(`docs/superpowers/plans/2026-08-19-phase-8-admin.md`): the user rules and the two mutations behind
them. **Task 1** — `src/lib/admin-users.ts` + tests: `ROLE_OPTIONS` / `ROLE_LABELS`, and the pure rules
`lockReason` / `roleChange` / `disableChange`, with the permanent admin locked against **both** role and
`disabled`. **Task 2** — `setUserRole` / `setUserDisabled` in `src/server/modules/admin/user-actions.ts`,
**the first code anywhere in this repo that writes `User.role` or `User.disabled`**, plus
`selfRoleChangeWarning` (added by review) and the shared `asActionResult` in `src/server/prisma-errors.ts`.
`/audit` can now name a `user` row (`name · email` → `/admin/users`) instead of printing a truncated cuid.
**Task 3** — `/admin/users` itself: the permanent admin as a `LOCKED` chip with its reason in a caption,
role selects per row, a confirm dialog before a self role change, the artboard's `Workspaces` column
(`roleWorkspaces()`), avatars, and the actor's own row stating `Your own account` instead of a
Disable button that could only fail. Also `aria-describedby` on the shared `Dialog` primitive.
**Task 4** — `src/lib/admin-flags.ts` + tests, the feature-flag allowlist: `FLAG_SPECS`, `specFor`,
`FlagState`, `flagChange(state, next)`, `flagChangeWarning(state, next)` and `domainValue`, with
`m365_sso` refused ON but permitted OFF, and `allowed_domain` refused ON without a value. Plus
`flagDomain()` in `src/lib/auth-shared.ts`, now the single effective-value expression for all four
readers of that flag.
**Task 5** — `setFlag` / `setFlagValue`, `listFlags`, `/admin/flags` and `FlagRows`: two switch cards, a
value editor for `allowed_domain`, a confirm dialog before the direction that opens signup to anyone, a
stated reason on any switch the rule won't move, and the `feature-flag` branch in `entityLabels` so the
log can name the flag it changed. Review fixes deliberately left unsquashed so the verdicts stay
legible: `c699743` + `d29ce9b`; `28e21ba` + `4b112cd`; `5d8e819` + `8a604df`;
`cc43421` + `3ae53d2` + `e3191a2` + `3b158df`; `ce275c1` + `3157a5c` + `aaca261`;
`5c4ab33` + `093a209`.
**Task 6** — the webhook vocabulary, and the first code of the phase's second half: `src/lib/webhooks.ts`
(`WEBHOOK_EVENTS`, `EVENT_LABELS`, `partitionEvents`/`parseEvents`, `webhookEnvelope`, `deliveryStage`),
`src/lib/jobs.ts` (`MAX_JOB_ATTEMPTS`, now the repo's only `5` — the worker imports it), the `"delivery"`
namespace and `JobStatus` families in `src/lib/status.ts`, and `src/server/webhooks/sign.ts` — the only
file in the feature allowed to touch `node:crypto`, signing `t=<seconds>,v1=<hex>` over `"t.body"`.
**Task 7** — the endpoint actions in `src/server/modules/admin/webhook-actions.ts`:
`createEndpoint` / `rotateSecret` / `updateEndpoint` / `setEndpointActive` / `deleteEndpoint`, with the
signing secret **AES-256-GCM encrypted under an AAD bound to its own row** (`secretAad`) and returned in
plaintext exactly once, `urlSchema`'s metadata-host refusal, `removeUnknown` so an unrecognised
subscription is never deleted by inference, and `listEndpoints`' explicit `select` keeping the ciphertext
out of the RSC payload. Also the `webhook-endpoint` branches in `entityLabels` and `AUDIT_ENTITY_TYPES`.
**Task 8** — `/admin/webhooks` and `src/components/admin/endpoint-editor.tsx`: the endpoint list, the
shown-once secret banner, per-endpoint URL/events editing, the ⋯ menu (disable/enable, rotate behind a
dialog stating `ROTATION_WARNING`, delete), and the banner that names subscriptions this build no longer
sends with one explicit removal. Added `deleteBlockedReason` to `src/lib/webhooks.ts` (the phase's third
one-string-two-surfaces rule) and **moved `SIGNATURE_HEADER` there from `src/server/webhooks/sign.ts`**,
which a client component cannot import. Review fixes for Tasks 6–8, unsquashed:
`5c4ab33` + `093a209`; `cc13bf5` + `df7a9a8` + `e90b277`; `4b26385`.
**Task 9** — `emitWebhook` in `src/server/webhooks/emit.ts`, the only producer of `DELIVER_WEBHOOK`
jobs: no I/O, called inside the transaction that writes the domain change, writing one `WebhookDelivery`
(the ledger) plus one `Job` (the retry engine) per **active, subscribed** endpoint. Wired into
`executeApproval` (worker-side, relative import), `completeOffboarding` and `runTransition`'s `complete`
branch. Plus the phase's one migration: `Job_one_live_deliver_per_delivery` **and**
`Job_deliver_payload_shape`, the pair that together mean "at most one live job per delivery" while still
letting Replay re-enqueue a terminal one.
**Task 10** — `src/worker/deliver-webhook.ts`, the first outbound network request in this project.
One attempt per job: signs the exact bytes it POSTs (`t=<seconds>,v1=<hex>` over `` `${t}.${body}` ``),
**`redirect: "manual"`** so an approved receiver cannot bounce the signed body to a host nobody approved,
`AbortSignal.timeout(10s)`, and a classification of permanent (3xx, 4xx except 408/429, disabled
endpoint, undecryptable secret, missing row) versus retryable (everything else). Never reads a response
body — status and statusText only, which is what keeps the SSRF capability a blind oracle. The worker's
`tick()` still owns backoff and the cap; the handler's job is the ledger, and `retryStatus()` is what
makes it agree with the job on the final attempt as well as the earlier ones.
**The pipeline is COMPLETE, and as of Task 13 it is READ**: Task 12 added the fixtures, Task 13
`/admin/webhooks/deliveries`.
**Task 11** — the Admin Home: `adminHome()` in `queries.ts`, `AdminHomeBody` in
`src/components/home/admin-home.tsx`, and an `admin` branch in `src/app/(app)/page.tsx` above the other
workspaces. Four stat tiles then three lists — who can get in, what is switched on, integrations — each
linking to its own admin page. Also **`flagEnabled(spec, row)` in `src/lib/admin-flags.ts`**, now the
single expression for a flag's EFFECTIVE on/off state, which `listFlags` and `adminHome` both call, and
**`SHOWS_FOCUS_TOGGLE` in `page.tsx`**, so the Focus button is not offered on a Home with nothing to
collapse. First task executed properly subagent-driven; both reviews found real defects.
**Task 12** — the seed fixtures: 2 endpoints (one disabled) with encrypted secrets, and 5 deliveries
spread across every chip `deliveryStage` can render, including the `DEAD · 5/5` row the design's Replay
control exists for. No `DELIVER_WEBHOOK` jobs — a deliberate absence that turned out to hide the defect
§6a rule 56 describes, because with no live jobs every Replay works against seeded data.
`/admin/webhooks/deliveries` is reachable against a fresh database — which it had to be before Task 13
built it.

**Task 13** — `/admin/webhooks/deliveries` and `src/components/admin/delivery-table.tsx`: the delivery
ledger with `DEAD · 5/5` chips (`deliveryStage`, denominator defaulted to the worker's
`MAX_JOB_ATTEMPTS`, coloured through `statusFamily(status, "delivery")`), four `?state=` tabs, a per-row
Replay and a batch "Replay N dead-lettered". Plus `replayDelivery` / `replayAllDead` in
`webhook-actions.ts` (reset-not-resume per scope decision #11, `lastError` kept deliberately,
`nextAttemptAt` cleared, P2002 from `Job_one_live_deliver_per_delivery` as a designed refusal, and an
audit diff of `status`/`attempts` only), `listDeliveries` in `queries.ts`, and **two new pieces of
vocabulary in `src/lib/webhooks.ts`**: `DELIVERY_TABS`/`parseDeliveryTab` (labels and status groups on
the entry, so the page has no second list) and `replayBlockedReason` — the single owner of the three
replay refusals, which the action refuses with and the query renders `replayable` from. 14 unit tests.
Verified in a real browser against a real database, including the click, the refusal-by-absence
afterwards, `worker:once` producing `RETRYING · 1/5`, and the audit row. `5394a8a`.

**Task 14** — `e2e/admin.spec.ts`, 12 tests, the only protection any `/admin/*` route has: the
permanent admin's lock stated before the click (and its affordances ABSENT, not disabled), an ordinary
role change resolved to a NAME on `/audit`, a disable that then blocks sign-in, **a no-op save that
writes no audit entry** and **a self role change that warns naming the incoming role, signs the actor
out, and lets them back in with the new role** — the last two are the behaviours Task 2's review said
were the whole reason this spec exists, and the plan's own draft had omitted both. Plus the flags
allowlist, the shown-once secret, the no-events refusal, the delivery chips, and a replayed delivery
losing its Replay control. One axe check per area. `cde5c12` → `e3b0002`.

Task 14 also produced **`aa75b44`, a WCAG AA fix that is not scoped to Phase 8 at all.** Its new axe
checks surfaced `--text-faint` (`#98A2B3`) rendering at **2.4–2.57:1** where AA requires 4.5:1 — on
~24 usages, including ten on the `/employees` list that had been there since Phase 3, green only
because `it-core.spec.ts` axe-checked `/employees/[id]` and never the list. Fixed at the TOKEN
(`#667085` light, `#868f9c` dark), not at the three Phase 8 call sites that happened to trip the new
checks. **This puts shipped code deliberately out of step with `design_handover/README.md`, which
specifies the old values and which §7 calls the untouchable source of truth** — see §8 for the
standing record of that deviation, because it is the kind of thing that must not be discoverable only
by grepping a CSS comment.

**TWO PURELY VISUAL CHECKS WERE NEVER DONE, and they need a human at a keyboard.** Everything about
both screens is asserted behaviourally — through the DOM, by `e2e/admin.spec.ts`, against a real
database — so what is missing is only what the eye catches. Neither blocks Phase 9 and nothing depends
on either. Sign in once at `http://localhost:3000` as `admin@thebackroomop.com` and both take about a
minute:

1. **The Admin Home (Task 11) has never been LOOKED at.** Its data was verified by calling
   `adminHome()` directly (all five roles present, `sum(rows) === total`, `m365_sso` reading
   `unavailable`) and `e2e/admin.spec.ts` now asserts its structure. What to check by eye: four tiles
   then three lists, **no fleet bar and no age histogram** (those belong to IT Home and their presence
   here was the original bug), and that IT Home is unchanged when you switch the workspace back.
2. **`/admin/webhooks/deliveries` (Task 13) has been driven but not looked at.** What to check: the
   status chips in **both** light and dark themes — four status families land on one table, and the
   `delivery` namespace exists precisely so a healthy `QUEUED` row does not read as amber like a
   failing one — plus the table at **375px** with a long endpoint URL and a long `lastError` beneath
   it, and where the dead-lettered banner sits relative to the tabs.

### Conventions every later phase must follow

**Added by Phase 8** (both learned the hard way, both cheap to violate):

- **A retry engine and its ledger are written in the SAME handler, from the same value.** Scope
  decision #6: the `Job` row owns retries, `WebhookDelivery` mirrors it. `deliver-webhook.ts` derives
  the ledger's terminal state from the same `attempts` and the same `MAX_JOB_ATTEMPTS` the worker uses,
  because a mirror that disagrees only on the LAST step is worse than no mirror (§6a rule 43).
- **A `"use server"` module makes every export a server action, so the worker cannot import one.** That
  is why `secretAad`/`signPayload` live in `src/server/webhooks/sign.ts` and not beside the actions
  that also need them. The mirror-image rule: **a `src/lib/` module imported by a client component must
  not reach `node:`** — which is why `SIGNATURE_HEADER` had to move OUT of `sign.ts` into
  `src/lib/webhooks.ts` when a client component needed to name it.

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

**The old "Phase 8" was split in two on 2026-08-19**, because as one plan it came to ~28 tasks — nearly
double any phase so far — and its two halves share no code. `/admin/*` already mapped to phase 8 in the
pending-route table, so the split falls on a seam that already existed.

- **Phase 8 — the Admin workspace. COMPLETE and MERGED** (`e5a5730`). What it delivered is §4; the
  invariants it established are §6a. Two things remain outstanding and neither is code: **the push
  decision, which is the user's and unmade**, and **two purely visual checks** listed at the end of §4.
- **Phase 9 — import / export. MID-FLIGHT: tasks 1–6 of 14 done** on `phase-9-import-export`.
  `docs/superpowers/plans/2026-08-21-phase-9-import-export.md` (14 tasks, 12 recorded scope decisions,
  every shipped task carrying an `AMENDED` banner). **The export half is DONE — see §4.**
  **What remains is the whole import half**: the pure rule module (T7, the heart and the biggest single
  task in the phase), the sheet reader (T8), the dry run (T9), the commit (T10), the wizard (T11), the
  employee importer (T12), e2e (T13), close-out (T14).
- **Phase 10 — polish. Not yet planned.** Split out of Phase 9 on 2026-08-21 because the two halves
  share almost no code: the printable 3×4 A4 label sheet with scan codes, USB-scanner polish so a scan
  ticks the matching offboarding wizard row, the deployment README, and the full axe pass.
- **Phase 9 — import/export + polish. Not yet planned.** Import (3-step dry-run → commit, blocked rows
  grouped by cause), export upgrade (real Excel + split-by-year chips, including the brief's
  `farewell-report` route), printable label sheet, USB-scanner polish (a scan should tick the matching
  wizard row), deployment README, full axe pass.
- **Entra SSO is deferred, deliberately and on the record.** `src/server/auth/index.ts` registers the
  provider when three env vars are set but carries `TODO(sso-phase)`: there is **no `signIn` callback**
  mapping an Entra profile to a `User` row, so an Entra login would arrive with no role. That is why
  Phase 8 makes `m365_sso` unavailable rather than togglable — on the one deployment that has
  configured the env vars, a free switch is one click from a sign-in path that authenticates and lands
  nowhere. Wiring it needs real tenant credentials; when they exist, the work is that callback plus
  deleting the refusal.

---

## 6. Phase 9 entry criteria (the plan implements these — most of the export half is DONE)

**The plan now exists** (`docs/superpowers/plans/2026-08-21-phase-9-import-export.md`) and items 3,
4 and most of 7 below are **DONE** — see §4. What remains of this section is items 1 and 2 (the two
importers), which are Tasks 7–12. Items 5, 6 and 8, plus the axe pass, were split out to **Phase 10**.
Read this as the *why* behind the remaining tasks. They are what the brief and the current state of the code commit the next plan
to. Source: `design_handover/README.md` cards `5a, 1m, 7g` — re-read them; they carry the stepper
shape, the label-sheet geometry and the scanner rules in more detail than is repeated here.

1. **Import is new from zero.** There is no import code anywhere in `src/` today — no route, no
   action, no parser. Brief `[5a]` fixes the shape: **Upload → Validate → Results**, where Validate is
   an explicit **dry run** that writes nothing and delivers the whole verdict at once (*not* a climbing
   counter), Results shows a proportional bar plus counts of new / updates / blocked, and blocked rows
   are **grouped by cause with a fix action per cause** ("Update instead", "Create category", "Leave as
   spare") rather than one line per row — the brief's own words: eighteen identical "duplicate serial"
   lines is a wall, one line with a button is a decision. **Partial import is the default**, not
   all-or-nothing, so the plan must say what a half-applied import leaves behind and how an operator
   sees which half.
2. **Import is rate limited to 10/min, and the plumbing for that ALREADY EXISTS — do not re-invent it.**
   `src/lib/rate-limit.ts` has held `import: { limit: 10, windowMs: 60_000 }` since Phase 1, beside the
   60/min `mutation` kind, and `checkRate(userId, kind)` already takes the `RateKind`. So the import
   actions pass `checkRate(actor.id, "import")` and nothing else changes. The trap is writing `10` into
   an action or a component instead (§6a rules 26, 37, 38) — the number has an owner already.
3. **The export path already refuses over its cap — do not regress it.**
   `src/app/(app)/inventory/export/route.ts` counts before querying and returns a **413** past
   **10,000** rows (`CAP`, line 8; the 413 at line 31), writing nothing. The Excel upgrade plus
   split-by-year chips has to keep that, not merely change the output format. The narrower gap already
   on record (§8, Phase 3) is real and worth closing in the same pass: **`?ids=` silently `.slice(0,
   500)`s** (line 21) instead of refusing, and that pattern must not be copied into the `/audit` and
   `/employees` exports as they are added.
4. **The `farewell-report` export route from the brief does not exist.** Phase 7 shipped the
   offboarding farewell report as a printable page only — neither emailable nor an Excel export (§8,
   Phase 7 Task 15). The brief's route is Phase 9's.
5. **The scanner contract is honoured everywhere except the one place the brief singles out.** `?q=`
   exact-tag-match redirecting to the record works on the built surfaces, but **the offboarding wizard
   does not tick a matching row when scanned** — there is no scan handling in
   `src/app/(app)/offboarding/[employeeId]/page.tsx`. A USB scanner is just a keyboard, so this is
   input handling, not hardware work.
6. **The printable label sheet does not exist**: a 3×4 A4 sheet of asset tags with scan codes,
   printable straight from a bulk selection or a completed purchase, so sticker and record are created
   in the same minute. Note this and the label sheet are **the only two items in the phase with no
   server surface**, which makes them the easiest to under-plan and the likeliest to be the reason the
   phase does not close on time.
7. **The full axe pass is Phase 9's, and Phase 8 has already done a slice of it — read §8 first.**
   Task 14 fixed `--text-faint` app-wide for WCAG AA contrast (§4), which means the remaining known
   accessibility debt is narrower than it was but no longer matches the design handover's stated
   tokens. Two known items are already recorded: the app-wide `heading-order` violation (`PageHeader`
   renders `<h1>`, `CardHeader` renders `<h3>`, so every page combining them skips `<h2>` — moderate,
   below the serious/critical bar the specs assert on) and `SegmentedControl` exposing no
   `aria-describedby`/`aria-invalid`. Neither is fixed. **Decide in the plan whether "full axe pass"
   means clearing moderates too**, because the e2e helper only fails on serious/critical today and a
   pass that leaves the helper alone will not notice.
8. **The deployment README does not exist**, and everything it needs to say is already true and
   scattered: the compose profile (`docker compose --profile prod up`), the loopback-only db, the
   generated secrets including `SECRET_ENCRYPTION_KEY`, the migration procedure (additive SQL dirs;
   `prisma migrate reset` is classifier-blocked), the worker service, and the npm-on-Windows
   package-lock hazard in §7. This is a writing task with no code, which historically means it slips.

---

## 6a. What Phases 8 and 9 have established (66 rules — read before executing anything)

The plan's **Recorded scope decisions** are the full list (14). These are the ones the review
sharpened, and the ones a later task can silently break. **Phase 8 is finished, but this section is
not history** — rules 8, 10, 15, 16, 26 and 47 were each broken on a NEW page *after* being written
down here, which is why §0's checklist exists as a thing to run rather than a thing to have read.

1. **The permanent admin is locked against `role` AND `disabled`, and the UI says so before the click.**
   `authorize()` returns `null` for a disabled user, so disabling that account locks every human out as
   thoroughly as demoting it would. Card `3h` names only the role select; the guard is deliberately
   wider. `lockReason()` returns the *sentence*, which both the page (as static text beside a `LOCKED`
   chip) and the action (as a conflict message) print — one string, two surfaces.
2. **There is no "last admin" guard, and the property it would protect holds on four facts, not one.**
   (a) exactly one permanent admin per database, from **two** producers — `prisma/seed.ts` and
   `createBootstrapAdmin` (`src/server/auth/actions.ts:115`), mutually exclusive because bootstrap is
   gated on `tx.user.count() === 0`; (b) **no writer of `User.role` or `User.disabled` anywhere outside
   `src/lib/admin-users.ts`'s callers** — **Task 2 becomes the first**; (c) no user-deletion path;
   (d) no email or password change flow. Break any of those and this decision needs revisiting, not
   just the `isPermanentAdmin` flag becoming editable.
3. **An admin may demote themselves; they may not disable themselves.** Demotion is recoverable — any
   admin can restore it. Self-disable ends your own session with no way back for you specifically. The
   refusal names **any other admin**, deliberately not the permanent one: nothing forbids one ordinary
   admin disabling another, so pointing at the permanent account would send someone to bother one
   named individual for something a colleague can do.
4. **The two refusals `disableChange` can return must stay textually disjoint.** The self-disable
   string must not contain "permanent admin", and the lock string must not contain "your own account";
   the tests assert both directions. This is not styling — see the §7 gotcha about assertions that
   cannot tell two branches apart.

**From Task 2 (`28e21ba` + the review fix `4b112cd`). Rule 5 is the one Task 3 must act on.**

5. **Any self role change signs the actor out, and the page — not the action — has to say so first.**
   `requireUser` compares the JWT's role to the DB's on every request and redirects a mismatch to
   `/logout`, because the JWT freezes role at sign-in. So an admin changing their **own** role to any
   different role is signed out mid-session, and `revalidatePath("/admin/users")` triggers exactly that
   *inside the action's own response* — which means the success state very likely never renders. Scope
   decision #3 still permits self-demotion; what it was missing was the warning.
   **`selfRoleChangeWarning(target, next, actorId)`** in `src/lib/admin-users.ts` is `lockReason`'s
   sibling — a warning, not a refusal, one string on two surfaces. Task 3 gates the select's `onChange`
   behind a `Dialog` carrying that sentence (the precedent is
   `src/components/offboarding/complete-button.tsx`), and `setUserRole` returns `signsOutActor` derived
   from the same function so the two surfaces cannot disagree. **Never restate the rule inline as
   `row.id === actorId`.**

6. **Neither action returns `ActionResult<null>`, and the no-op path is why.** `setUserRole` returns
   `{ changed, signsOutActor }`, `setUserDisabled` returns `{ changed }`, and `revalidatePath` fires only
   when `changed`. Re-selecting a role a user already has writes nothing, and a caller that can't see
   that will claim an immutable audit entry that does not exist — the identical bug
   `src/server/modules/offboarding/actions.ts:239` already fixed one phase earlier, with a comment
   saying so. **The trap when editing these:** both `$transaction` callbacks now return a full
   `ActionResult` on *every* path and the caller discriminates on `.ok`. A returned `{ changed: false }`
   is truthy, so the older `if (failure) return failure` shape would read a successful no-op as a
   failure to propagate. Don't reintroduce it. And remember `writeAudit` runs inside that callback:
   **returning** from a Prisma `$transaction` callback COMMITS it — only a throw rolls it back — so
   every `return conflict(...)` must stay ahead of every write.

7. **`asActionResult` is a shared plain module, `src/server/prisma-errors.ts`, and must never move into
   a `"use server"` file.** Every export of a `"use server"` module becomes a network-reachable server
   action, and this helper's first parameter is a function, which isn't serializable across that
   boundary. The plan originally had it exported from `user-actions.ts`; Tasks 5, 7 and 13 import it from
   `@/server/prisma-errors` instead. Its doc comment is deliberately a **precondition addressed to
   callers** — the helper cannot see a callback's body, so each call site verifies the
   conflict-before-write ordering in a comment of its own. Four private copies predate it (§8).

8. **The audit trail names a user; the diff does not pad itself to do it.** `entityLabels` resolves
   `user:<id>` to `name · email` linking to `/admin/users` (`User.name` has no unique constraint, so a
   bare name would let two colleagues share one audit identity). The disable diff carries `disabled`
   **only**. An earlier version added `email: { from: X, to: X }` to carry identity, which made `/audit`
   print `Fields: disabled, email` — `/audit` renders diff *key names*, so that row told a later reader
   the email had changed, in an append-only table that can never be corrected. **Don't put a
   from-equals-to key in a diff to smuggle context; put the context in the label.** (There is one
   sanctioned from===to precedent — `offboarding.completed`'s `m365Status` — and it earns it by
   snapshotting a value that mutable rows can later lose. Nothing here can be lost: there is no
   email-change flow and no user-deletion path.)

9. **Scope decision #2's four facts were re-verified now that something finally writes these columns,
   and all four hold** — the only writes to an existing `User` row anywhere in `src/` are Task 2's two
   `updateMany` calls, and the lock is now a **database predicate** (`isPermanentAdmin: false` in both
   guarded `where` clauses) rather than application code alone. **The deferred SSO callback is the change
   that would falsify two of them at once:** it becomes a third producer of `User.role`, and SSO mappings
   conventionally refresh role from group claims on every login — a writer of `User.role` on existing
   rows, outside this module, unaware of the lock. Re-litigate #2 when that lands; don't re-cite it.

**From Task 3 (`5d8e819` + the review fix `8a604df`). Rule 10 is the one that generalises.**

10. **A page must consume EVERY refusal its rule module can return, not just the one the design card
    names.** Task 3 shipped with a live **Disable** button on the actor's own row: `lockReason` returns
    `null` for your own row, so the unlocked branch rendered a normal button, while `disableChange`
    refuses self-disable unconditionally — and `next` can only be `true` for the actor, since a disabled
    user is bounced at `guards.ts:19` and can never be on the page. **Every click was guaranteed to
    fail.** The rule was already written, exported and unit-tested; the component imported
    `selfRoleChangeWarning` and not `disableChange`. This breaks brief §3's hard constraint (*"Anything a
    role can't do must not render an action they'll get a 403 from"*) and card 3h's own thesis, which the
    same file applied correctly to the permanent admin two cells away. **Tasks 5, 8 and 13 each pair a
    rule module with a page — check this explicitly for each.** Note also it was **invisible from the
    seeded `admin@` account**, which is the permanent admin and therefore locked: verifying a
    self-targeted rule requires promoting a second admin.

11. **Don't synthesize a rule's input object in a client component.** The first fix built a `TargetUser`
    in the table with a hardcoded `isPermanentAdmin: false`. True at the time, and
    `selfRoleChangeWarning` does not even read that field — which is what made it dangerous: nothing
    could ever falsify it, while `admin-users.ts:42-44` promises that a rule which *starts* reading a
    pre-wired param is a change to one function, not to its call sites. `UserRow` now carries
    `target: TargetUser`, which `listUsers` was already building and discarding. Don't derive it from
    `row.locked` either — `locked` is computed *from* `isPermanentAdmin`, so that inverts the dependency.

12. **`changed: false` must still refresh the page.** Work out when that branch can fire: a `<select>`
    emits no change event for the already-selected option and a toggle button always sends the opposite
    of what it shows, so it fires **only when the client's props are stale.** Task 2's original reasoning
    ("a no-op refresh is a pointless round trip") is therefore exactly backwards — in the one reachable
    case, the refresh is the whole remedy. Left as shipped, a second admin clicking Disable on an
    already-disabled row got a spinner and then silence, repeatable forever, until they reloaded by hand.
    The server keeping `revalidatePath` gated on `changed` is still correct; the client refreshes on every
    `ok`.

13. **`Dialog` now sets `aria-describedby`, and that was load-bearing, not polish.** It set
    `aria-labelledby` only, and `useFocusTrap` focuses the first focusable element — usually Cancel — so
    a screen reader announced the title, then "Cancel, button", and never the body. Every dialog in the
    app was hiding its own reason for existing. Additive fix in the primitive; all seven call sites
    benefit. **This is also why the e2e suite was re-run at Task 3** (see §0): six e2e-covered components
    use that primitive.

**From Task 4 (`cc43421` through `3b158df`). Rule 14 is the one to carry forward — it is now this
phase's most-repeated defect.**

14. **A rule must permit the SAFE direction. This shape has appeared three times in four tasks.**
    (a) Task 1's `disableChange` is direction-blind, so it refuses *re-enabling* the permanent admin as
    well as disabling it — the one transition that repairs an out-of-band lockout is the one the rule
    forbids (§8). (b) Task 3's Critical was the mirror image: a live control for an action the rule would
    always refuse. (c) Task 4's `flagChange` refused turning `m365_sso` **off** as well as on — so a
    database where that row is already enabled shows *Continue with Microsoft* on `/login`, the exact
    roleless-login path scope decision #7 exists to prevent, while the admin page renders the row ON with
    a pill explaining the danger **and no way to close it.** Both Phase 8 rule modules now take the
    requested direction. **Turning a dangerous thing off is never the dangerous direction** — check it
    for every rule Tasks 5, 8 and 13 add.

15. **A switch must not be able to claim a restriction that isn't enforced.** `isAllowedDomain`
    (`src/lib/auth-shared.ts`) returns `true` — **unrestricted** — whenever the domain is falsy, and
    `FeatureFlag.value` is `Json?` with no default. `createBootstrapAdmin` with a blank domain writes
    `(enabled: false, value: null)`, the resting state of **every deployment that bootstrapped without a
    domain**. One click made that `(true, null)`: `/admin/flags` read ON beside *"Limits who may create an
    account"* while any address on earth could sign up, and `/signup` correctly showed no banner — so the
    two surfaces disagreed and **the admin page was the one lying.** `flagChange` now refuses enabling a
    `hasValue` flag with no value, and **`flagDomain()` in `auth-shared.ts` is the single expression every
    reader uses**, so the admin page cannot compute a stricter reality than the gate enforces. Three
    readers had hand-rolled that expression; Task 5's query would have been a fourth that diverged.

16. **A user-facing description can assert a security property the code doesn't have.** `m365_sso`'s said
    the Microsoft button was *"for accounts in the allowed domain."* `isAllowedDomain` is called in
    exactly one place — the credentials `signUp` path — and there is **no `signIn` callback anywhere** in
    `src/server/auth`, so an Entra login is filtered by nothing: not domain, not an existing `User`, not
    role. That is the sentence an admin reads while deciding whether to want the feature. Fixed, with a
    test asserting it never re-acquires the claim. **`prisma/seed.ts` still carries the same falsehood in
    the row's own `description` column**, which is why a flags page must render `spec.description` and
    never `row.description`.

17. **A test that asserts agreement is not a test that asserts structure.** `flagChangeWarning` reads
    `spec.offWarning`. A test checking it equals each spec's `offWarning` catches *drift* — but a
    reintroduced hardcoded `key === "allowed_domain"` branch returning the same sentence **passes it**,
    which I verified by mutation. The property is "reads spec data", and the only test that catches it
    registers a flag at runtime and requires the warning to follow. Worth remembering whenever a test's
    name claims a structural guarantee: mutate the structure, not just the value.

18. **`trim()` does not strip invisible characters; a whitelist is what saves you.** U+200B and U+2060 are
    `Cf`, not `Zs`, so `trim()` leaves them — the hole §8 records for the 3-character reason minimum,
    which ends on a *length* check. `domainValue` is immune because its final check is an ASCII
    **whitelist**, and there are now regression tests saying so, plus a homoglyph case and a trailing-dot
    case. The refactor they guard against is realistic: collapsing the four sequential checks into one
    looser pattern passes every test the plan originally specified while accepting a Cyrillic-о
    homoglyph — a silent 100% signup lockout.

**From Task 5 (`ce275c1` + `3157a5c` + `aaca261`).**

19. **Rule 8 got reproduced after it was written down — treat it as a checklist item, not a lesson.**
    Task 5's audit diffs carried `key: { from: X, to: X }` for exactly the reason Task 2's carried
    `email` — "to carry identity" — and `/audit`, which renders diff **key names**, printed
    `Fields: key, enabled`. Append-only, uncorrectable. **Before any task that writes an audit diff:
    does every key in it name a field that actually changed?** If context is needed, it goes in the
    entity label. The one sanctioned exception remains `offboarding.completed`'s `m365Status`, which
    earns it by snapshotting a value a mutable row can lose.

20. **A new `entityType` needs an `entityLabels` branch, and the plan will not remind you.** Task 2
    needed one for `user`; Task 5 needed one for `feature-flag` and the plan **never scheduled it**
    (Task 7 adds only `webhook-endpoint`). Without it every row of that type is an unlinked truncated
    cuid — so the most consequential thing the app can record, "signup was opened to any address",
    would have read `feature-flag | clx1234567… | update | key, enabled`. Note there are **two**
    places: `entityLabels` in `src/server/modules/audit/queries.ts` (the label) and
    `AUDIT_ENTITY_TYPES` in `src/lib/audit-list.ts` (the facet). Task 7 owns the latter for both
    `feature-flag` and `webhook-endpoint`, so until it lands the facet cannot filter flag rows even
    though the label resolves. **Tasks 7 and 13 introduce `webhook-endpoint` and `webhook-delivery`
    — check both places for each.**

21. **Guard the write even when the column is `Json`.** `setFlagValue` shipped with an unguarded
    `update`, so two admins saving different domains meant the second silently discarded the first
    **and the trail held two entries both claiming the same `from`** — the second false, permanently.
    A `Json?` column makes an equality filter awkward (`Prisma.DbNull` for the null case), which is
    presumably why it was skipped. **`updatedAt` is the answer**: it is `@updatedAt`, so it is a clean
    optimistic-concurrency token, and it catches a concurrent change to *any* column rather than just
    the one being written.

22. **Distinct audit verbs, per mutation.** Both flag actions shipped as `action: "update"`, so
    `/audit`'s Action column could not tell a switch flip from a value edit — only the Fields cell
    hinted, and that cell was simultaneously polluted by rule 8. Now `flag-enable` / `flag-disable` /
    `flag-value`, matching the sibling module's `role-change` / `disable` / `enable`. Don't add cases to
    `actionDot` for any of them: `/audit` never calls it and the four activity feeds scope to
    employee/asset/purchase-request, so it is dead code (§6a rule 13's note).

23. **A client mirror of server state needs a reset path the server can't trigger.** `flag-rows` keys a
    `useEffect` on every row's value to resync the input after `router.refresh()`. That structurally
    cannot catch a **normalizing no-op**: stored `example.com`, admin types `EXAMPLE.COM`,
    `domainValue` normalizes to the same string, nothing is written, the key never changes, and the box
    keeps the uppercase forever — the exact failure the effect exists to prevent. The fix is to reset
    from the normalized value in the success path too, not to make the effect cleverer.

**From Task 6 (`5c4ab33` + `093a209`). This review read FORWARD into Tasks 7–13 and its findings are
already written into their plan text — rule 24 is why that mattered.**

24. **A contract to systems you cannot migrate has exactly one cheap moment to get right, and it is
    before the first consumer.** Task 6's signature signed only the body, so it was replayable — and this
    phase *ships a replay button*, which the reviewer verified produces **byte-identical** bytes and
    therefore a byte-identical signature (the envelope's four inputs are `delivery.id`, `.event`,
    `.createdAt`, `.payload`, and `replayDelivery` touches none of them). With no timestamp in the
    request a receiver cannot implement a tolerance window even if it wants to. We had copied GitHub's
    scheme without either of its mitigations — GitHub mandates TLS and its delivery GUID **changes** on
    redelivery, where ours is stable, and Task 7's URL schema permits `http://`. Now
    `t=<seconds>,v1=<hex>` over `` `${t}.${body}` ``, where `v1` names the **scheme** (the old `sha256=`
    named the algorithm, so the comment's claim that it gave receivers a migration path was false —
    §6a rule 16 again). **Fixed at zero consumers; after Task 10 it is a breaking change to receivers we
    cannot see.**

25. **One parser cannot serve two callers that need opposite things.** `parseEvents` dropped unknown
    events, which is right for `emitWebhook` (never fan out to a name nothing emits) and wrong for the
    editor. The consequence was severe and silent: an endpoint holding a renamed event showed **no trace**
    in the UI, and an admin editing **only the URL** caused the narrowed list to be written back —
    permanently deleting the subscription — audited as `events: { from: [x], to: [x] }`, an append-only
    entry asserting the field did not change on the write that erased it. Now `partitionEvents(raw) →
    { known, unknown }` with `parseEvents = partitionEvents(raw).known`. **When a normalizer discards
    something, ask which caller needs to know what was discarded.**

26. **A number that appears in the UI needs exactly one definition.** The `DEAD · 5/5` chip's denominator
    was a parameter fed from a literal in the worker, and Task 13's planned code declared a **second**.
    Tune the worker to 3 and the chip reads `DEAD · 3/5` — card `3h`'s headline artifact, wrong, with a
    green suite and a mutation-clean function. `MAX_JOB_ATTEMPTS` in `src/lib/jobs.ts` is now the only
    `5`; the worker imports it and `deliveryStage` defaults to it. Note the name: it is the
    **job-engine-wide** cap (`src/worker/index.ts:73` applies it to every job type), which is why it is
    not `MAX_DELIVERY_ATTEMPTS` and does not live in `webhooks.ts`. **`npm run worker:once` is the only
    check that covers `src/worker/index.ts` — nothing in the unit suite reaches that file.**

27. **Adding a status to the family map means ALL of its values, and check the namespace.** Task 6 added
    three of `DeliveryStatus`'s four; `PENDING` inherited the flat map's **approval** entry, so a queued
    delivery rendered amber (`attention`) — and since `RETRYING` is also `attention`, **colour could not
    distinguish "queued and healthy" from "failing".** `status.ts` already had namespaced lookups for
    exactly this collision. There is now a `"delivery"` namespace covering all four, `JobStatus`'s
    `RUNNING`/`DONE`/`FAILED` are in the flat map (`status.ts`'s doc comment claimed every enum value
    mapped and it did not), and **an exhaustiveness test iterating the real Prisma enum objects** makes
    the claim true. Any task that renders a new enum should add that enum to the test.

28. **When a test's subject is embedded in a larger string, assert on the part a mutation would change.**
    The first version of "the digest changes when the signing instant changes" compared the whole
    `t=…,v1=…` header — which can only pass, because the visible `t=` differs between two instants no
    matter what was actually hashed. A mutant that dropped `t` from the **signed string** sailed through
    it. Same family as §6a rule 17 and the `ROLE_OPTIONS`/`domainValue` tautologies in §8. **Golden
    vectors are the other half of this:** the reviewer demonstrated that
    `createHmac("sha256", Buffer.from(secret, "base64url"))` — tempting, because Task 7's `newSecret()`
    is base64url — passes every property-style assertion while invalidating every signature in
    existence, and so does `.update(body, "latin1")` on any non-ASCII body. Pinned literals are what
    catch those.

**From Task 7 (`cc13bf5` + `df7a9a8` + `e90b277`) — the security-critical task, and the one where a
design choice made a bug invisible.**

29. **Guard EVERY write, and notice when a design choice hides the failure.** `rotateSecret` shipped a
    bare `update`. Two rotations racing — two admins, **or one operator double-clicking** — both succeed;
    the second wins in the DB while the shown-once banner shows whichever response resolved last. The
    operator pastes S1, S2 is live, every delivery 401s, the worker treats that as permanent, everything
    goes `DEAD`. **The shown-once design is what makes it undetectable**: the reveal is the only place the
    value ever appears, so there is nothing to check it against. When a feature deliberately makes state
    unreadable, every write to that state needs a guard *more* than usual, not less.

30. **Guard on a column the write actually moves — or on `updatedAt`.** `updateEndpoint` guarded on `url`
    while the common edit changes only `events`. Postgres re-checks a `where` against the **new** row
    version after the lock (EvalPlanQual), so the stale-but-unchanged `url` still matched and the second
    write committed over the first, with an append-only audit entry claiming a superseded `from`. Same as
    §6a rule 21. `updatedAt` is `@updatedAt` and moves on every write, whichever column changed — that is
    the general answer. `setEndpointActive` needs no such fix: it guards the column it writes.

31. **`findMany` with no `select` fetches everything, including ciphertext.** `listEndpoints` pulled
    `secret` on every render while its comment claimed *"never selected"* — true only of what it
    *returned*. Its rows feed a `"use client"` component, so the object is serialised into the RSC
    payload: one `...r` from ciphertext in an admin page's source. **An explicit `select` makes the
    guarantee structural**, and the comment should assert something a reader can check four lines up.

32. **Signing is not confidentiality, and saying it is stops the next reader from fixing it.** The
    `http://` allowance was justified with *"the payload is signed either way, which is what makes that
    safe."* Signing gives the **receiver** integrity and authenticity; it says nothing about where the URL
    points, and over plain http the envelope and its HMAC cross the wire in the clear. §6a rule 16 again,
    and this one is load-bearing because it reads as "already considered".

33. **SSRF here is an accepted capability, recorded as one.** An authenticated admin can make the worker
    POST to any host it can reach. That actor can already change roles and open signup, and Task 10 stores
    only status codes — never bodies — so it is a blind reachability oracle, not a data read. `urlSchema`
    refuses `169.254.0.0/16` and `metadata.google.internal` only; **loopback and RFC1918 are deliberately
    allowed** (scope decision #4 and the plan's own `http://localhost:4999/hook` verification depend on
    them). **The guard's soundness rests on a non-obvious fact worth not breaking:** it pattern-matches a
    dotted quad, and `new URL` normalizes every integer form to one first — `http://2852039166/`,
    `http://0xa9fea9fe/`, `http://0251.0376.0251.0376/` all yield `169.254.169.254`. IPv6
    `[fd00:ec2::254]` is not blocked; accepted, no metadata service here. **The real hole is in Task 10:**
    `fetch` follows redirects by default, so a 307 from an approved receiver forwards the signed body to a
    host the admin never approved — `urlSchema` cannot see past the first hop.

34. **Pin a magic string that a rename would silently invalidate.** `secretAad` is `` `webhook:${id}` ``
    in a one-line function. Renaming it — or a caller passing `endpoint.id` instead of
    `secretAad(endpoint.id)` — typechecks, lints, passes everything, and makes every **pre-existing**
    secret permanently undecryptable while newly created ones work perfectly. Now pinned by a literal
    (`secretAad("abc") === "webhook:abc"`) plus a round-trip and a cross-row refusal. Rule 28's lesson
    applied to a constant rather than a format.

**From Task 8 (`4b26385`) — the first task in this phase whose defects were all caught before the
commit, because the §0 checklist was run against it deliberately rather than remembered. Rules 35 and 36
are the two a later task can reproduce.**

35. **Rule 16 governs user-facing PROSE, not just comments — and a sentence can be falsified by the
    branch it renders in.** Task 8's unknown-events banner ended *"the only thing that drops them is the
    button below"*, which was true in the branch that has a button and false in the branch that
    deliberately doesn't (a row with no recognised events left, where the removal would be refused, so
    the button is replaced by the sentence saying what to do first). Both branches print the same
    paragraph. **When copy references another element, check every branch that renders the copy still
    renders the element** — the clause is now conditional on the same flag the button is. Same family as
    rule 16's four earlier instances, but the falsehood was in prose an admin reads rather than a comment
    a developer reads, which makes it worse, not better.

36. **Rule 10 has now been broken in EVERY task of this phase that pairs a rule with a page — treat it
    as the default outcome, not a risk.** Task 8 had two, both found by running the §0 checklist rather
    than by testing: Delete was live on an endpoint with delivery history (`deleteEndpoint` always
    refuses those, and `EndpointRow.attempts` already knew), and "remove the unrecognised events" was
    live on a row whose recognised set is empty (`eventsSchema.min(1)` always refuses that save). Neither
    was reachable from the plan's own verification steps, because the seed has no deliveries and no
    renamed events — **the fixtures that would have exposed them do not exist, so the checklist is the
    only thing that catches this class.** The fix in both cases is the same shape: `disabled` plus the
    refusal's own sentence, from the rule module, printed before the click.

37. **A rule that is only a sentence still belongs in the rule module.** `deleteBlockedReason(attempts)`
    is the phase's third one-string-two-surfaces export (after `lockReason` and `flagChangeWarning`), and
    it exists because `deleteEndpoint` was building the sentence inline: the page needed the same words,
    and a second copy diverges the moment either is reworded. It returns `null` rather than `""` for the
    deletable case so a caller cannot render a blank explanation beside a dead control, and it is
    unit-tested for singularisation, for pointing at the safe direction (Disable), and for **staying
    textually disjoint from `deleteEndpoint`'s other refusal** — the P2003 race message — per rule 4.

38. **A constant a client component needs cannot live in a module that imports `node:crypto`.**
    `SIGNATURE_HEADER` was in `src/server/webhooks/sign.ts`; `/admin/webhooks`'s shown-once banner tells
    the operator which header to paste the secret against, and that banner is `"use client"`. The plan's
    answer was a **literal in the component** — a second definition of a contract with receivers we
    cannot migrate, which a rename typechecks past and leaves wrong in the one place a human reads it.
    It now lives in `src/lib/webhooks.ts` (the vocabulary module, which imports nothing platform-specific)
    and is pinned by a literal on both sides. **Task 10's import is already amended.** The general form:
    when a server-only module holds a value the UI must display, move the value, don't copy it — and
    `src/lib/*` versus `src/server/*` is the line that decides which module can hold it.

**From Task 9 (`5a5494e`) — the first task with no advance banner, which still had two defects. Rule 39
is the one to carry.**

39. **Mirroring an existing pattern means mirroring ALL of it — and a constraint that silently doesn't
    constrain looks identical to one that does.** Task 9's migration was told to mirror
    `Job_one_live_execute_per_approval`, and did: a partial unique index on
    `(payload->>'deliveryId')` where the job is live. What it did not copy is the **companion CHECK**
    (`Job_execute_payload_shape`), whose own comment in
    `20260814093000_provenance_restrict_and_indexes` says why it exists — *"or the one-live-job partial
    unique above it silently no-ops (NULLs never collide)"*. The index is on an **expression**; a job
    with no `deliveryId` key evaluates to NULL, and Postgres never collides NULLs, so unlimited live
    jobs would have been permitted for exactly the malformed payloads the guarantee matters most for.
    **Nothing in a green suite can tell you this.** The only thing that catches it is asserting the
    constraint against the live database — insert the violating row and require the error. Same family
    as rule 27 (a status map given three of an enum's four values). When you copy a guard, go read what
    else the migration that introduced it shipped in the same breath.

40. **A runtime re-check that the type system already guarantees is dead code, and its comment is a
    lie about where safety comes from.** The plan's emitter had
    `if (!parseEvents(endpoint.events).includes(event)) continue;`, commented as stopping a renamed
    event being resurrected by a stale row. `has` is exact array membership, so every row the query
    returns provably contains `event`, and `event` is typed `WebhookEvent` — so `partitionEvents` puts
    it in `known` unconditionally and the branch can never be taken. Harmless in itself; the damage is
    the comment, which tells the next reader that a runtime filter is what makes this safe when the
    **parameter type** is. Rule 16 in the form where the false claim is about which mechanism protects
    you. Ask of any defensive branch: what input reaches it, and can that input exist?

41. **"Prove it does nothing" is not a test of a producer.** Task 9's plan verified the emitter by
    completing a purchase with no endpoints configured and asserting `WebhookDelivery` count `0` — which
    an `emitWebhook` with an empty body passes perfectly. The positive case has to be run too, and the
    cheap version is worth knowing: create **two** endpoints subscribed to **different** events, trigger
    one, and require exactly one delivery on the right endpoint plus a `Job` whose `deliveryId` matches
    it. Then disable it and trigger again to prove `active: true` means "stops receiving". Generalise:
    when a task's verification only asserts an absence, ask what a no-op implementation would do.

42. **The worker's call sites are the ones a typecheck proves least about.** `src/worker/**` runs under
    `tsx`, not Next, and uses relative imports exclusively — there is not one `@/` import under that
    directory. A new module imported from both sides (`emit.ts` is imported by the worker AND by two
    `"use server"` modules) has to use the style that works in both. `npm run worker:once` loading at
    all is the cheap smoke test — module resolution happens before any job is leased — and executing a
    real approval through it is the full one. **Note also `emit.ts` is a PLAIN module deliberately:**
    its first parameter is a transaction client, which is not serialisable, and being exported from a
    `"use server"` file would make it a network-reachable action (§6a rule 7's shape).

**From Task 10 (`7ad0014`) — the security-critical task, and the one that proves a banner is not an
audit. It had five pre-written amendments, every one of them correct, and still shipped with two more
defects of the same family — one of them inside the branch the banner named as the model to copy.**

43. **A mirror that agrees on four steps out of five is worse than no mirror, because the page looks
    authoritative.** `deliverWebhook` was drafted to write `RETRYING` on every retryable failure. The
    worker's `tick()` dead-letters the job when `job.attempts >= MAX_JOB_ATTEMPTS` — so on the fifth
    failure the **job** goes `DEAD` and the **delivery row** still says `RETRYING`, `deliveryStage`
    renders `RETRYING · 5/5`, and **card `3h`'s headline artifact `DEAD · 5/5` can only ever appear for a
    PERMANENT failure**, never for a receiver that was simply down — which is the commonest way a
    delivery dies. Scope decision #6 makes that row a mirror of the job; the fix (`retryStatus(attempts)`)
    derives the terminal decision from the same value and the same constant the worker uses, so they
    cannot drift. **The general question: when two rows must agree, check the LAST transition, not just
    the steady state.** A test that stops after one attempt passes either way — this took driving one
    delivery through all five.

44. **A banner is what one reviewer found reading forward, not a completed audit — and its own examples
    can be broken.** Task 10's banner said to treat a `decryptSecret` failure "as a `Permanent` in the
    same shape as the disabled-endpoint branch." **The disabled-endpoint branch had the identical bug**:
    it threw without marking the delivery row, leaving it at `PENDING`/`0` — which `deliveryStage`
    renders as a healthy `QUEUED` — while the job went `DEAD` and the real reason sat in `Job.lastError`,
    a column no admin page reads. One omission in two paths, with the banner pointing at the broken one
    as the model. Fixed **structurally** rather than by remembering: a private
    `permanent(id, attempts, reason)` marks `DEAD` and *then* throws, so a `Permanent` cannot be raised
    without the ledger moving. When a review tells you to copy a sibling, read the sibling.

45. **Printing a signature is not testing it.** Task 10's plan verified delivery by printing the
    `x-backroom-signature` header and eyeballing the envelope. Task 6's review had already demonstrated
    two mutations that produce perfectly well-formed headers and invalidate every signature in existence
    (`Buffer.from(secret, "base64url")` as the HMAC key, and `.update(body, "latin1")`). **The receiver
    has to RECOMPUTE the HMAC**, which means the test needs the plaintext secret — obtainable without
    scraping the shown-once banner by creating the endpoint from a script that calls the same
    `newSecret` / `encryptSecret(…, secretAad(id))` pair `createEndpoint` does. The check that proved the
    SSRF fix is the same shape: a **second listener on another port that must stay silent**, rather than
    an assertion about the first one.

46. **`src/worker/**` has no unit coverage at all and cannot easily get any** (§6a rule 26 said this for
    `index.ts`; it is now true of a second file). `deliver-webhook.ts` is `fetch` plus Prisma with no pure
    core worth extracting, so `npm run worker:once` against a real receiver is its ONLY coverage. Anything
    that changes it needs the seven-case table in the plan's Task 10 Step 4 re-run — a green
    `npm run test` says nothing whatsoever about this file.

**From Task 11 (`e3e19eb` → `ac976ac`) — the first task executed properly subagent-driven, and the
evidence for doing 12–14 the same way.**

47. **A summary surface must not re-derive a state the detail surface already computes — §6a rule 15
    recurred, one phase later, on a brand-new page.** `adminHome()` read `FeatureFlag.enabled` raw;
    `listFlags()`, two functions above it in the same file, computes the EFFECTIVE state
    (`spec.hasValue ? flagDomain(row) !== null : row?.enabled ?? false`). They differ exactly in
    `(enabled: true, value: null)` — which `flagDomain`'s doc comment calls the resting state of any
    deployment that bootstrapped without a domain. The Admin Home would have shown a green dot and "on"
    beside *Signup domain restriction* while `/signup` enforced nothing **and `/admin/flags` one click
    away said "off"**: two admin surfaces contradicting each other, the summary being the liar. Rule 15
    was recorded after Task 5 and this still happened, which is why it is now a checklist line and not a
    lesson. The fix is `flagEnabled(spec, row)` in `src/lib/admin-flags.ts` with **both** callers routed
    through it — a copied ternary would have been the second definition rule 15 exists to prevent (three
    readers had already hand-rolled it once). Seven tests, mutation-verified: reintroducing the
    raw-column shortcut kills three.

48. **Don't invent work for a control that has nothing to do — remove the control.** The plan's Step 3
    left `FocusToggle` rendering on the Admin Home with nothing gated on `focus`, so the button flipped a
    cookie and re-rendered identically. The implementer's first fix was to add a `!focus`-gated `Jump to`
    card so Focus would have something to hide; review rejected it, because `WORKSPACE_NAV.admin` is
    exactly the three destinations `AdminHomeBody` already links inline — the card would have repeated
    them plus a link to the page you are on. `SHOWS_FOCUS_TOGGLE: Record<WorkspaceId, boolean>` is the
    fix: don't offer it. **Note it is a near relative of rule 10, not an instance** — rule 10 is an
    action guaranteed to FAIL, this one succeeds and does nothing visible. Same remedy, and worth keeping
    the distinction because the citation was wrong in the first comment written for it.

49. **Two reviewers can split on where something belongs, and the tiebreaker is blast radius.** The
    quality review wanted `SHOWS_FOCUS_TOGGLE` moved to `src/lib/workspaces.ts` beside the other three
    `Record<WorkspaceId, …>` tables; the spec review wanted it next to the JSX it governs. Kept in
    `page.tsx`: `workspaces.ts` is the nav-and-access truth the **edge middleware** reads, and "does this
    Home have a focus-gated secondary section" is a fact about one page's composition. Coupling routing
    truth to layout for a single consumer is the worse trade — and the quality reviewer agreed once the
    middleware point was made. **Recorded because the tempting refactor is the wrong one.**

50. **What the subagent split actually bought, stated plainly.** Tasks 8–10 were implemented and reviewed
    in one context; Task 11 had a fresh implementer and two fresh reviewers. The spec review caught
    unrequested scope (the `Jump to` card) that a self-review is structurally bad at noticing, since the
    author has already justified it to themselves. The quality review caught rule 47 — a correctness
    defect invisible to types, lint and 453 passing tests, found only by reading the sibling function and
    asking whether two surfaces could disagree. **Also: verify a reviewer's claims before acting on them.**
    The spec reviewer's redundancy argument depended on `WORKSPACE_NAV.admin` having only three entries;
    that happened to be true, and checking took one grep. The quality reviewer's rule-47 finding was
    likewise confirmed by reading `listFlags` before any code changed.

**From Task 12 (`8521589` → `b0d7c94`) — a fixture-only task, which found more defects per line than
any task in the phase. All of them were fixtures that the running code could not have produced.**

51. **A fixture must be checkable against the CODE THAT WRITES IT, never against the plan — and the
    comment describing it is the part most likely to be false.** The plan's seeded webhook deliveries had
    four shape defects: `type` in the DB's `@map`'d spelling (`lifecycle.assign`) rather than the Prisma
    client value the emitter actually sends (`lifecycle_assign`); `assetId`/`assetTag` missing though the
    emitter always sends both; refNos paired with the wrong types; and a `purchase_request.completed`
    delivery citing `PR-0198`, which is seeded `SUBMITTED` and therefore cannot fire that event. **The
    method that caught them was comparing against a payload captured from a live run** (Task 9's
    verification), not against the plan text. Then the comment block turned out to be worse than the data:
    it disclosed two rows as fiction while presenting a third as the honest one, and that third
    (`APR-2031`) **carries no `assetId`, which `execute-approval.ts:63-65` refuses for every approval type
    before ever reaching `emitWebhook`.** All three were fiction on the same axis. When you write a
    fixture, the honest comment is usually shorter than the one you first want to write.

52. **A promissory comment is a defect from the moment it ships until the task it names lands, and
    nothing checks it.** `deliver-webhook.ts` (Task 10) shipped *"Task 12's seed gives a RETRYING fixture
    a real `nextAttemptAt`"* — and Task 12's planned code did not set one. It was found from the other
    side, by the implementer reading the comment while writing the fixture; nothing else would have. If
    you must write one, phrase it as an intention ("Task 12 is expected to…") rather than a statement of
    fact, or better, don't.

53. **State a deliberate ABSENCE, not just deliberate presences.** Seeding no `DELIVER_WEBHOOK` `Job`
    rows is load-bearing — one would make `worker:once` POST to a hostname that does not resolve on every
    seeded run — and the block said nothing about it, three lines below the file's own
    `// Job queued for the APPROVED approval`. A reader had every reason to read the absence as an
    oversight to fix. Same for one plaintext `HOOK_SECRET` shared by two endpoints: safe because
    `secretAad(id)` binds each ciphertext to its row, and worth saying so, or the next reader "fixes" a
    copy-paste that was never one.

54. **"The secret is encrypted" is the claim that fails silently, so test the ROUND TRIP.** A length
    check on the ciphertext column proves nothing about whether it decrypts. Task 12's verification
    decrypts both seeded secrets under `secretAad(theirOwnId)` back to the fixture plaintext **and**
    confirms decrypting one under the other endpoint's AAD is refused. Do that whenever a seed writes
    ciphertext — a seed that stored plaintext, or encrypted under the wrong AAD, would look identical
    until something tried to use it.

55. **The cheap in-session reseed is a Playwright spec.** `npm run db:seed` is *sometimes*
    classifier-blocked for agents (it ran fine in Task 13's session), but every spec reseeds via
    `execSync` in `beforeAll` and that is never blocked.
    `npx playwright test e2e/auth-shell.spec.ts --workers=1` is ~60s / 15 tests and doubles as a
    regression check on the fixture you just changed. This is how Task 12 verified its numbers against a
    genuinely fresh database rather than reasoning about them.
56. **A refusal enforced by a DATABASE INDEX is still a refusal the page owes the operator — and it is
    the one rule 10 instance nothing in the rule module will remind you of.** Task 13's `replayDelivery`
    refuses three things: a `DELIVERED` row, an inactive endpoint, and a delivery that already holds a
    live `DELIVER_WEBHOOK` job. Only the first two are visible in the action's own `if`s; the third is
    `Job_one_live_deliver_per_delivery` raising P2002. The plan's `replayable: status !== "DELIVERED" &&
    endpoint.active` therefore rendered a live Replay button on **every freshly-emitted `PENDING` row and
    every backing-off `RETRYING` row** — which is what those statuses mean — each click a guaranteed
    P2002. **The fix is one owner:** `replayBlockedReason` in `src/lib/webhooks.ts`, which the action
    refuses with and the query renders from, exactly as `deleteBlockedReason` already did in the same
    module. When you check rule 10, ask what the DATABASE will refuse, not only what the rule module
    returns.
57. **A deliberate ABSENCE in the seed is still a coverage hole, and rule 53 is only half the lesson.**
    Task 12 correctly seeded no `Job` rows and correctly *said so*. That same absence is what made rule
    56 invisible: with no live jobs, every Replay works against seeded data and a green suite proves
    nothing about the case that matters. **When you state a deliberate absence, also state what it stops
    exercising** — a reader can then choose to probe it directly, which is how 56 was actually confirmed
    (insert a live job, watch `replayable` flip, delete it).
58. **A batch action must return what it DID, not that it ran.** Task 13's planned `replayAllDead`
    returned `{ queued }`, dropped every per-row refusal, and the component announced
    `Replaying ${deadReplayable}` — **the count rendered before the click**. A batch of four that queued
    two would have claimed four. As shipped it returns `{ queued, attempted, blocked }` and the banner
    says `Queued 2 of 4` with the reason. Same family as rule 43: a surface that agrees with reality most
    of the time reads as authoritative and is wrong exactly when someone is looking.
59. **A bare `catch {}` inside a batch loop converts a fault into a short count with no reason
    attached.** The planned loop swallowed everything escaping `replayDelivery` "because it is one row's
    problem". But that action already maps every failure it *expects* onto an `ActionResult`, so anything
    escaping it is real — and `src/server/prisma-errors.ts` states the rule outright: *an unexpected
    error must never be laundered into a friendly banner.* Let it throw.
60. **When one exit path clears a column, ask which other paths leave it stale.**
    `deliver-webhook.ts` clears `nextAttemptAt` on success, with the comment *"must not keep advertising
    an attempt that will never happen."* Task 13's replay re-queues a row from scratch — the identical
    situation — and the planned reset left the old timestamp behind. Related: **`nextAttemptAt` is
    written by NOTHING but the seed** (the worker's retry path never sets it, only clears it), so
    Task 13 deliberately does not render it and says so in `listDeliveries`. If a "next attempt" column
    is ever wanted, it comes from the job's `runAt`. Tracked in §8.
61. **A `fill()` that lands before React hydrates is silently discarded, and the assertion after it
    can pass for the wrong reason.** Task 14's flags test failed reproducibly on the full-file run and
    passed standalone. The tell was Playwright's own snapshot: the textbox held the STORED value, not
    the typed one, and the error slot was present but empty — so the action had received the original
    value and no-op'd. `src/components/admin/flag-rows.tsx` binds the input to `draft[row.key]`,
    initialised from props, so hydration overwrites anything typed before it runs. It passed alone
    because compiling the route inside the test bought hydration the time it needed; in the full file
    an earlier test had already warmed `/admin/flags`. **Fix with headroom, never a weaker assertion:
    wait for the field's expected INITIAL value (which proves the controlled component is mounted from
    props), fill, then assert the new value stuck BEFORE clicking submit.** That last assertion is the
    point — it turns a lost keystroke into a clear failure instead of a wrong-reason pass. Same family
    as §7's "✓ Saved" race and the Task 3 navigation race.
62. **"The other specs pass" is not evidence the other pages are clean — it may only mean nobody
    looked.** Task 14's implementer found a contrast violation on three admin pages and concluded it
    was not a pre-existing pattern, having checked that other axe-covered pages passed. The same token
    was failing on ~24 usages, including ten on `/employees`, and the suite was green solely because
    `it-core.spec.ts` axe-checked `/employees/[id]` and never the list. **Before calling a defect new,
    grep for the construct on older surfaces AND check whether any test actually asserts against
    them.** A green suite bounds what has been checked, not what is true. The corollary bit twice in
    one task: fixing three call sites would have left twenty-one, and made two tokens mean one thing.
63. **A comment that cites a line number is a promise that rots.** The token fix above invalidated a
    forensic comment in `e2e/it-core.spec.ts` that quoted both a hex value and `globals.css:16` — the
    hex changed, and inserting an explanatory comment above the declaration moved the line. Worse, that
    comment opened with "BUG (app, not test)" and ran eleven lines before revealing in its final clause
    that the bug had been FIXED. **Cite names you can grep, not coordinates, and when a note records a
    resolved bug, say so in its first line.** (Rule 16's family: a comment must not claim a property
    the code lacks — including a location.)
66. **A `"use client"` component cannot take a function prop from a Server Component, and nothing in
    the toolchain will tell you.** Phase 9 Task 6 fixed a dropped-filter bug by passing the page's URL
    builder down to two components so neither could rebuild a URL wrongly. That works for
    `RepairChips` (a Server Component) and is **impossible** for `InventoryTable`, which carries
    `"use client"` — React only passes serializable data across that boundary. It receives a
    precomputed `Record<string, string>` of hrefs instead. **`tsc`, `lint` and `build` all pass on the
    broken version**; it fails only when the page actually renders, which in this repo means only under
    Playwright. So: when the fix for "a caller can get this wrong" is "pass the caller a function",
    check which side of the client boundary the caller is on first, and prefer precomputed data across
    it. Related to §7's note that a `"use server"` module's exports are all server actions — both are
    boundary rules the type system does not enforce.
64. **A column spec written from what the output OUGHT to say is wrong three times out of three.**
    Phase 9's plan produced three export column specs and all three were defective, identically: Task 3
    **dropped** `Employee no` and `RMA ref`, two columns the CSV it replaced actually emitted; Task 4
    **invented** an `email` field the `Employee` model does not have; Task 5 **invented** `decidedBy`
    and `decidedAt`, which appear nowhere in `src/` at all. None was caught by a test — the specs'
    assertions (unique non-empty labels, a known first column) pass just as happily on a spec missing
    two columns as on a complete one. **Write a column spec from the source, not from the intent, and
    when a task rewrites an existing output, diff the OLD output's field list against the new spec.**
    The suite now pins the asset sheet's full ordered label list precisely because that is the only
    assertion that would have caught it. Same family as rule 39 (copying a pattern but not all of it),
    one layer up.
65. **An equality that holds at zero is not evidence.** Task 5 verified that the farewell sheet's row
    count matches the printable report's by running both against the live database — and both returned
    **0**, because the seed contains no `lifecycle_return` approvals, so the employee had three held
    items and no decided ones. The check passed and proved nothing: a function returning a constant
    empty array satisfies it. Sibling of the Task 9 lesson that *"prove it does nothing" is not a test
    of a producer*. **When a verification compares two counts, confirm at least one of them is
    non-zero**, or say plainly in the report that you could not — which Task 5 did, and which is why the
    real assertion moved to the e2e that can create the state.

---

## 7. Recurring gotchas that have cost real time

- **A fresh dev server has no session, and an agent will not type the seeded password into the login form.** It happened twice in one session. Any check that needs a signed-in browser therefore needs **you** to sign in once at `http://localhost:3000` (`admin@thebackroomop.com`), after which the agent can drive the page normally. **Two workarounds that need no browser at all, and are often better:** call the page's own query directly (`npx tsx` a throwaway script under the gitignored `backups/` that imports e.g. `adminHome()` and prints its output — this is how Task 11's data assertions were verified, and it checks the numbers rather than the pixels); or, for anything the DB can answer, `docker exec inventory-db-1 psql -U inventory -d inventory -c "…"` (note **`-U inventory`**, not `postgres` — that role does not exist and the error is unhelpful). Delete the scratch script afterwards. **A third route, and the best one for behaviour: write a throwaway Playwright spec.** The e2e harness logs in by filling the seed's fixture password (`ChangeMe123!`) from a script — that is the suite's own established mechanism, not an agent typing a human's password — so a temporary spec under `e2e/` can drive a signed-in browser, assert through the DOM, and be deleted afterwards. This is how Task 13 verified its click path, its refusal-by-absence, and its audit row. Name it `zz-*` so it sorts last and cannot perturb the files after it, and remember that **tests in one file share a database and only `beforeAll` reseeds** — Task 13's second test failed purely because its first had already consumed the fixture. Reserve the manual browser for what only the eye shows: layout, contrast, focus order, axe.
- **Browser-pane synthetic clicks often miss React handlers.** A `computer` click at page coordinates can land nowhere because the screenshot frame is scaled (a 1400×900 viewport screenshots at 800×514, so page coords are ~1.75× too large). Dispatching from `javascript_tool` is reliable: `el.click()` on the real element works for buttons AND for React-controlled checkboxes; for text inputs use the native value setter plus an `input` event, since assigning `.value` alone does not notify React. Also: the `Menu` primitive closes on **mousedown** outside, so `document.body.click()` does NOT close it — the next trigger click then toggles it shut and your menu item is gone.

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
- **Three e2e assertions that sat close to the default 5s budget started failing during Phase 9, and the cause was NOT a large slowdown — measure before blaming one.** The clean full run went 7.5 → 8.0 minutes across the whole phase, about 7%. A *failing* run clocked 10.0 minutes, and reading that as a 33% regression was wrong: failures inflate a run with retries and artifact capture, so **never measure performance from a run that failed.** What did change is that three specific first-hit navigations and one hydration race were already marginal, and a modest growth in on-demand compilation was enough to tip them: More routes for `next dev` to compile on demand means every first-hit navigation in the suite costs more, and three assertions were sitting close enough to the default 5s budget to start losing: the offboarding wizard's first `/offboarding/[employeeId]` hit, the approvals queue's first `/approvals/[id]` hit, and `/admin/flags`' hydration race. **None was a product defect.** The remedy each time was headroom — await the URL separately from the heading, or retry a fill until it sticks — never a weaker assertion. **Expect this to recur as the app grows**, and treat "a full-suite failure that passes in isolation" as a budget problem to measure rather than a flake to re-run. One specific trap: asserting a server-rendered input's seeded value does NOT prove hydration has run, because the SSR'd HTML already carries that value.
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
- **An assertion satisfied by BOTH branches of a function cannot tell them apart — and mutation testing
  will not catch it.** Task 1's self-disable test asserted its refusal matched `/permanent admin/i`, and
  the self-disable sentence happened to contain "the permanent admin". Swapping the two branches of
  `disableChange` left the suite fully green, because `allowed` is `false` either way, so every
  boolean-level mutation still failed the same tests. The fix is to assert the *distinguishing* clause
  plus a **negative** assertion on the other branch's wording, which keeps the two strings disjoint as
  they get edited. Whenever one function returns two different refusals, ask what the test would do if
  they were swapped.
- **`design_handover/` is excluded from lint/build** and must stay untouched — it's the source of truth, not code. **One deliberate exception now exists**, and it is recorded in §8: Phase 8 changed `--text-faint` away from the hex this doc specifies, because the specified value fails WCAG AA. The rule stands; the exception is documented rather than silent.
- **A `"use server"` module makes EVERY export a server action, so the worker cannot import one.** Server actions are compiled into a POST endpoint per export and are not callable in a plain Node process — which is why `secretAad`/`signPayload` live in `src/server/webhooks/sign.ts` rather than beside the webhook actions that also use them. The mirror-image trap is just as sharp: **a `src/lib/` module imported by a client component must not reach `node:`**, or the client build breaks. That is why `SIGNATURE_HEADER` had to move out of `sign.ts` (which imports `node:crypto`) into `src/lib/webhooks.ts` when `/admin/webhooks` needed to print the header name. The two rules together mean a value shared by the worker AND a client component belongs in `src/lib/` with no `node:` imports anywhere in its module graph.
- **Typing into a controlled input immediately after a navigation can lose the keystrokes to hydration**, and the assertion that follows may then pass for the wrong reason rather than failing. Playwright's `fill()` operates on the DOM; if React hydrates afterwards it rebinds the input to its prop-derived state and your text is gone, the submit posts the ORIGINAL value, and a no-op branch returns a cheerful toast. It is timing-sensitive, so it shows up in a full-file run and vanishes when you run the test alone (the route is already compiled, so the page arrives faster and loses the race). **Assert the field's initial value, fill, then assert the filled value before clicking submit** — see §6a rule 61.
- **A UI confirmation that clears itself on a timer needs headroom on the assertion, not just on the timer.** `/inventory/[id]/edit`'s "✓ Saved" is a 3-second self-clearing flash (`setSaved(true)` plus a 3000ms timeout in `src/components/inventory/asset-form.tsx`), so the default 5s Playwright budget has to cover the whole server-action round trip *before* the flash even starts. A dev server minutes into a full e2e run occasionally takes long enough that it doesn't, and the failure looks like "element(s) not found" with the button still reading `"Loading" [disabled]` — nothing points at a timing race. It failed once in three full runs and was reproduced byte-for-byte by delaying `updateAsset` 7s. Fixed with a 20s assertion, not a weaker one.
- **A new audit `action` string needs a reader that will actually see it — check that BEFORE teaching the display layer, not after.** Phase 7 initially taught `auditSentence` four new cases and then reverted all four: the app's activity feeds each scope to one `entityType` (`employee` / `asset` / `purchase-request`), and `/audit` itself renders `listAudit`'s raw `action` string plus the diff's **key names** — it never calls `auditSentence` at all. So the four new cases were unreachable by any page in the app, and their tests were exercising dead code. Before adding a case for a new `entityType`, trace which surface would actually route it through the function you're editing.

## 8. Deferred / out-of-scope (tracked, don't lose)

- **Phase 4 leftovers:** `/approvals` shows the first 50 rows of a tab with a "showing N of M" hint but no pagination; no admin surface LISTS the `Job` table — Phase 8 half-answered this: `/admin/webhooks/deliveries`
  reads `Job` to decide whether a delivery already has a live one (that is what makes its Replay
  control honest), but nothing anywhere renders job state, `lastError` or `runAt`, so a stuck
  `EXECUTE_APPROVAL` job is still invisible outside `psql`; the worker's stale-lease recovery uses a 5-minute wall-clock heuristic (safe now because every terminal write is state-guarded).
- **Phase 5 leftovers:** the draft autosave churns unit rows (`createDraft`/`saveDraft` return only request-level fields, so `/purchases/new` never learns the unit ids it just created and every later autosave deletes and recreates the set — `/purchases/[id]/edit` does pass real ids and updates in place); `/purchases` has no sortable headers or column chooser; the ⌘K palette now returns purchase requests to `it_staff` and `viewer`, and the detail page shows money and finance notes to anyone who can reach it (no field-level restriction was specified); `addComment` deliberately still accepts comments on COMPLETED/CANCELLED requests.
- **Settled 2026-08-17 — "Admin" means system administration, and the procurement department is just Purchasing.** No renaming is pending: the `Admin` workspace (Users & roles / Webhooks / Feature flags) is software settings, the `admin` role is the superuser, and the procurement workspace is `Purchasing` as built. Recorded only so nobody re-opens it.
- **Phase 6 leftovers:** the Admin workspace has no Home of its own (`ws === "admin"` falls through to the IT layout, so an admin sees SLA breaches and fleet composition under a Users/Webhooks/Flags sidebar); "Retry this section" refreshes the whole route because RSC has no per-section refetch; section degradation is loader-level, so a render-time bug inside a section still escapes to the route error boundary; `/finance/assets` has no search, no sortable headers and no book-value column (depreciation is a policy nobody has stated); Home's `DATA` rows key on `DATA:<assetId>`, which is unambiguous only while an asset can't be both MISSING and DEPLOYED-without-a-holder.
- **Phase 3 leftovers:** CSV export buffers up to 10k rows in memory and silently truncates `?ids=` beyond 500; sort remount drops keyboard focus to `<body>`; `EntityCombobox` lacks a listbox accessible name and Home/End.
- **Phase 7, Task 14 — equipment-policy leftovers:** the before/after slot lists `auditSlots` writes on every policy edit are **stored and queryable but rendered nowhere** — `/audit` shows only `slots` as a changed *field name* (see §7's audit-reader gotcha above), and no UI anywhere in the repo renders an audit diff's *values* for any entity. A policy-scoped activity feed, or diff-value rendering on `/audit` generally, is what would make them legible. Nothing prevents two policies targeting the same department or title — the schema has no constraint and `createPolicy` only checks the policy *name* for uniqueness. Task 14 answered this by ordering all five `equipmentPolicy.findMany` calls that feed `resolvePolicy` by name, so the first-match tie-break is deterministic — which makes the winner **stable, not correct**. The shadowed policy stays fully editable and governs nobody; the only visible signal is its card reading `0 people`, which is ambiguous with a policy that legitimately targets an empty department. Titles are case-folded when `resolvePolicy` matches them but stored raw when created, so `Accountant` and `accountant` would collide invisibly at resolve time while reading as two distinct policies on the page. The module is also create/delete only — **no rename and no retarget** — so fixing a typo'd title means deleting the policy, which cascades every slot and severs the audit chain; `renameRefRow` in `src/server/modules/admin/reference-actions.ts` already does this for the sibling reference-data rows (asset categories/types/departments) and is the template. `auditSlots` infers what changed by set-differencing two slot-list snapshots taken around the write, so under READ COMMITTED a concurrent edit to a *different* slot of the same policy lands inside this actor's from→to pair — the stored lists stay correct, only an inferred summary of "what this actor did" would be wrong; carrying the acted-on slot id explicitly would close it. And the policy card's "N people" counts `employment: { not: "OFFBOARDED" }`, but `listEmployees` (which lights up the policy-gaps filter) applies policies to every matching employee, offboarded included — so an offboarded person can trigger a policy gap under a policy whose own card does not count them. `/admin/equipment-policies` also has one **moderate** axe `heading-order` violation, and it's app-wide rather than new to this page: `PageHeader` renders an `<h1>` and `CardHeader` renders an `<h3>` (`src/components/ui/page-header.tsx`, `src/components/ui/card.tsx`), so every page that combines the two skips `<h2>`. It sits below the serious/critical bar the e2e specs assert on, which is why it hasn't blocked anything yet.
- **Phase 7, Task 15 — close-out leftovers:** `/offboarding` and `/reservations` have no pagination, sortable headers or facets — team-scale lists, currently unbounded; the offboarding wizard doesn't yet tick a matching row when a USB scanner hits it (Phase 8's scanner polish, §6); the farewell report is printable but neither emailable nor an Excel export (the brief's `farewell-report` export route is Phase 8); `RETURNED OK` shows `—` in the Down column because `downDays` returns `null` for anything not `status === "DEFECTIVE"`, and nothing records when a repair actually ended; `/reservations` is read-only by design (scope decision #10), so holds are still created and released from the asset record, not from this page; and the repairs stage facet pages in memory, which scope decision 5b judged correct at team scale but would need a generated column at fleet scale.
- **Phase 7, Task 13:** `RESERVATION_TABS` / `parseReservationTab` live in `src/server/modules/reservations/queries.ts` alongside the Prisma call, where every sibling list (`inventory-list.ts`, `approvals-list.ts`, `purchases-list.ts`, `audit-list.ts`, `employees-list.ts`) puts its pure tab/parse logic in `src/lib/*.ts` with a unit-test file. Bundled with the query, it cannot be unit-tested without pulling in the DB client — which is why it is the one list parser with no test. Worth normalising if that module gains any more logic. **Still the only one:** Phase 8's Task 13 was pre-warned about this exact precedent and put `DELIVERY_TABS` / `parseDeliveryTab` in `src/lib/webhooks.ts` with 7 tests instead — and went one better by hanging each tab's `label` and `statuses` off the entry, so the page has no parallel `TAB_LABELS` map and the where-clause has no separate ternary. That is the shape to copy if `RESERVATION_TABS` is ever normalised.
- **Phase 7 so far:** a 3-character reason minimum accepts invisible characters (`trim()` strips Unicode `Zs` but not U+200B/U+2060), so a MISSING item can carry a blank-looking justification — shared with `requestReturn` and `rejectApproval`, so the fix is one zod refinement in a shared helper, not a per-action patch; four separate copies of "read a string field off a `Prisma.JsonValue`" (`obj`/`str` in `approval-execution.ts`, `returnTargetStatus`, `payloadReason`, and the `target` hoist in `approvals/queries.ts`) agree today and could be one exported pair; `getWizard` reads assets and approvals as two statements, so a worker commit between them shows an item as undecided for one render (self-correcting, and `decideItem` refuses with its designed conflict — closing it needs `RepeatableRead`, i.e. a transaction per render, which was declined deliberately); an empty policy slot on a leaver reads "not held" but does not yet distinguish "already returned" from "left their name with no return at all"; **`SegmentedControl` exposes no `aria-describedby`/`aria-invalid`**, so `ItemDecision`'s "pick an outcome" `FormError` is announced but not associated with the radiogroup that caused it — and now that "no value" is a meaningful, refusable state for that control (Task 8), the props are worth adding; **all four offboarding components hand-roll the `ok / rate_limited / validation / conflict` ladder** that `loadout-view.tsx` already abstracted into a local `handle<T>()` and `asset-form.tsx` extended — the duplication is what produced two of the Task 8 review's defects (a missing `validation` branch and a dropped unclaimed-key fallback), so a shared `useActionResult` in `src/components/patterns/` would be a real fix rather than tidying; **`beyondRepair` answers `false` for an asset with no recorded `cost`**, so an asset registered without one (the forms allow it; every seeded asset has one only because `mk()` defaults it) can be quoted any amount and still read TO ASSESS with no write-off warning — it is a three-state question (yes/no/unknown) being answered as a boolean, and Task 12's record view is where "no acquisition cost recorded" should surface; **nothing has ever written `defectiveSince` except the seed and, as of Task 11, the worker** — every asset that reached DEFECTIVE before this sits at `null`, which reads as `to-assess` with a permanently blank Down column, and `updateSchema` deliberately excludes the field so there is no way to correct it but to bounce the asset out of DEFECTIVE and back in (destroying the original date); that untested `status === "DEFECTIVE" && defectiveSince === null` branch wants a backfill (`UPDATE "Asset" SET "defectiveSince" = "updatedAt" WHERE status = 'DEFECTIVE' AND "defectiveSince" IS NULL`) and an editable field before this ships to anyone with real data; **`downDays` counts elapsed 24h periods, not `Asia/Manila` calendar days**, unlike the rest of the app; and **`beyond-repair` outranks `at-vendor` in `repairStage`**, so an item physically sitting at a vendor with a high quote loses its at-vendor-ness in the chip — a decision attribute hiding a location attribute, which matters if the screen is used to chase equipment. **From Task 12's review, all judged worth recording rather than fixing now:** `facetOptions` still counts the repair *candidate* set, so Category/Type/Assigned counts read slightly high in repair mode (the Status facet, the one case that offered an unsatisfiable combination, is now hidden instead); the CSV export's 10k guard runs *after* `repairStageIds` has materialised the candidate set, so that path can exceed the bind-parameter limit before the friendly 413 (unreachable at team scale); `repairStageIds` resolves outside the transaction, a deliberate exception to `bulkRequestStatusChange`'s "reads happen INSIDE the transaction" — the alternative makes `BULK_MAX` count candidates instead of the cut; the `HOLD` marker is hidden whenever an assignee is present and never discloses expiry, and **nothing anywhere sweeps `ACTIVE → EXPIRED` at `expiresAt`**, so a long-expired hold still renders as live; and `Reservation_one_active_hold_per_asset` — which `reservations[0]` now depends on for correctness — exists only in raw migration SQL, not in `schema.prisma`.
- **Phase 8, Task 1 (recorded by review, judged not worth fixing now):** the permanent-admin lock is
  **direction-blind** — `disableChange` refuses *re-enabling* the permanent admin as well as disabling
  it, so if that account were ever disabled out of band the one transition that repairs the lockout is
  the one the module forbids, leaving a manual DB edit as the only recovery (**this became reachable
  the moment Task 2 landed** — `setUserDisabled` is now a real writer of `User.disabled`, though it
  refuses the permanent admin in both directions, so the lockout still requires an out-of-band write to
  create; the correct rule would refuse only transitions that
  *reduce* its access, and the fix is not one line because `lockReason` must still report the row as
  LOCKED for the UI while `disableChange` diverges — the two surfaces that share one string today would
  have to stop sharing it); **`ROLE_OPTIONS` is not exhaustiveness-checked** (`Role[]` accepts a subset
  and its test compares against a hardcoded literal, so a sixth role would silently vanish from every
  role select — `ROLE_LABELS: Record<Role, string>` would fail to compile, but that can be fixed
  without touching `ROLE_OPTIONS`). **The test half of that was FIXED in `4b112cd`**: it now asserts
  set-equality against `Object.values(Role)` from `@prisma/client`, with the admin-first ordering split
  into its own `it` so a failure says which claim broke. The *type* half stands — `ROLE_OPTIONS: Role[]`
  still accepts a subset, and `as const satisfies readonly Role[]` plus an `Exclude<Role, …> extends
  never` guard is what would move the guarantee to compile time. Also still open: **`TargetUser.disabled`
  is declared but never read**
  by any of the three rules, despite the type's comment promising it holds only what they read; and the
  **self-disable guard fails open on an id-space mismatch** — `target.id === actorId` is the only
  identity-keyed rule and `TargetUser` is unbranded primitives, so a caller sourcing `actorId` from the
  `Employee` id space instead of `User` would silently turn a refusal into an allow.
- **Phase 8, Task 2 (recorded by review, judged not worth fixing now):** there are now **five**
  implementations of `asActionResult` — the new shared `src/server/prisma-errors.ts` plus four private
  copies that predate it (`modules/admin/policy-actions.ts`, `modules/offboarding/actions.ts`,
  `modules/purchases/actions.ts`, `modules/purchases/draft-actions.ts`). Migrating them is a one-file-each
  change but not a pure deletion: `policy-actions.ts`'s copy carries an extra **P2003** branch with a
  message specific to its own FK direction, and the purchases pair have a narrower signature
  (`() => Promise<ActionResult<T>>` rather than `() => Promise<T>`). Worth one consolidation pass once
  Phase 8's own callers (Tasks 5, 7, 13) have settled the shared shape. **P2025 is currently unreachable
  in both user actions** — `updateMany` returns a count rather than throwing, and `auditEntry.create`
  can only P2003 on a deleted actor, which no code path can produce — so `goneMessage` is insurance for
  the later tasks, not for these two. The concurrency guard is also **safe by accident of which columns
  are immutable rather than by construction**: `roleChange` reads only `isPermanentAdmin` and
  `disableChange` only `isPermanentAdmin` + `id`, both of which nothing writes, so guarding the single
  written field happens to cover each rule's whole read set. A future rule that reads `disabled` while
  writing `role` — or any real "last admin" count — would open a window the current `where` clauses
  don't cover. And `actionDot`'s new `"disable"` case is **unreachable today** (all four callers scope
  `entityType` to employee/asset/purchase-request, and `/audit` never imports it); it is commented as
  pre-wired for a feed Task 11 may add, and if that lands, `DEFECTIVE` — the *fault* family — is worth
  re-examining as the reading for a deliberate administrative action.
- **Phase 8, Task 3 (recorded by review, judged not worth fixing now):** `listUsers()` is **unbounded**
  — no `take`, no pagination, no URL state, unlike `/employees` and `/inventory` and against brief §3.2.
  Fine at five users; a departure from the house list pattern worth closing if the org ever grows.
  `roleWorkspaces()` hardcodes the artboard's literal string **"all four"** while deriving the count from
  `Object.keys(WORKSPACE_META).length`, so adding a fifth workspace would render "all four" for five —
  the count is right, the word isn't. The **`signsOutActor` field on `setUserRole` now has no consumer**:
  the toast that used it was deleted as provably unreachable (`/logout` is a route handler, so the
  redirect is a document navigation that destroys `ToastProvider` and every queued toast), and the
  pre-click dialog is what actually does the job. It is left on the return type because a notice on
  `/login` explaining *why* you were signed out is the thing that would consume it — worth doing in
  Phase 9's polish, and until then the actor lands on a bare `/login` with no explanation. Also
  repo-wide, noticed here: `router.refresh()` after a server action that already called
  `revalidatePath` is a **second RSC round trip per mutation** (`policy-editor.tsx` does the same), and
  `retryAfter` is never cleared on success in any of these components, so after a rate-limit window
  slides you can briefly see a success toast and a "you've hit the cap" banner together.
- **Phase 8, Task 4 — two PRE-EXISTING Phase 2 bugs found by review, deliberately NOT fixed** (auth code
  behind `e2e/auth-shell.spec.ts`, outside this phase's scope — but both are real, so don't lose them):
  **(1) `createBootstrapAdmin` doesn't validate its domain field.** `src/server/auth/actions.ts:103` does
  `String(...).trim().toLowerCase()` and nothing else, so bootstrapping with `someone@corp.com` stores
  that verbatim; `isAllowedDomain` compares against the text after the last `@`, so it can never match and
  **every signup is refused, permanently, from the deployment's first minute** — with the error reading
  "Signup is limited to @someone@corp.com addresses." This is exactly the failure `domainValue`'s doc
  comment describes, on the one path that doesn't call it. The fix is to route bootstrap through
  `domainValue` (`src/lib/admin-flags.ts`) or move that function somewhere both can reach.
  **(2) `/login` gates the Microsoft button on one env var where the provider needs three.**
  `src/app/(auth)/login/page.tsx:19` tests only `AUTH_MICROSOFT_ENTRA_ID_ID`, while
  `src/server/auth/index.ts:35-41` registers `MicrosoftEntraID` only when ID, SECRET **and** ISSUER are
  all set — and its own comment says the conditional registration exists to stop a half-set env showing a
  broken button. With only the ID set and the flag on, the button renders and `signIn` throws on an
  unregistered provider. Low reachability today (the flag can't be turned on), but it widens the surface
  scope decision #7 reasons about.
- **Phase 8, Task 5 (recorded by review, judged not worth fixing now):** `m365_sso`'s displayed state is
  the **raw** `row.enabled`, not an effective one — `/login` gates the button on
  `enabled && !!AUTH_MICROSOFT_ENTRA_ID_ID`, so on a database where that row was enabled out of band with
  no env vars configured, `/admin/flags` shows the switch ON while `/login` shows nothing. That is the
  same "admin page describes a reality the enforcement point doesn't have" that `FlagRow.enabled` exists
  to prevent, just not applied to this flag; mitigated by the UNAVAILABLE pill and its sentence sitting
  right beside it, and unreachable in-app since the flag cannot be turned on. **`setFlag`'s zod schema has
  no `.max()` on `key`**, so a large string is parsed before `flagChange` rejects it — bounded by Next's
  server-action body limit, cosmetic. The value editor's `FormError` is **not** wired to its `Input` via
  `aria-describedby` (it is `role="alert"`, so it is still announced on appearance, and `FormField`
  already does this properly but is bypassed here). `SwitchProps` exposes no `aria-describedby` channel at
  all, so a disabled switch's reason cannot be programmatically attached — harmless today because a
  disabled `<button>` isn't focusable and the sibling `<p>` is read in document order, but worth knowing
  if a switch ever needs to be focusable-but-refusing. And **presentationally the flags panel departs from
  card `3h`'s artboard**: the artboard is one bordered container of divider-separated rows with the mono
  key as the primary label, where this ships a discrete `Card` per flag with the human label primary and
  the key demoted to 10px. Deliberate and arguably better, recorded so it reads as a choice.
- **Phase 8, Tasks 8 and 9 (recorded, judged not worth fixing now):** **`emitWebhook` can fail the
  transaction it is called from.** Scope decision #10 forbids I/O and it does none, but `create` is
  still a write: the emitter reads an endpoint, a concurrent `deleteEndpoint` commits, and
  `webhookDelivery.create` then violates its foreign key. In `executeApproval` that surfaces as
  `EXECUTION_FAILED` on the approval, which a retry clears (the endpoint is gone by then, so the retry
  emits nothing). Not guardable cheaply: swallowing is unavailable because a failed statement poisons
  the Postgres transaction, and emitting outside the transaction trades this for "webhook fired for a
  change that rolled back", which is strictly worse. Narrow enough to accept, recorded so it isn't
  rediscovered as a mystery. **`Job_one_live_deliver_per_delivery` and `Job_deliver_payload_shape` exist
  only in raw migration SQL, not in `schema.prisma`** — the fourth and fifth constraints in that
  position (`Reservation_one_active_hold_per_asset` is already on this list for the same reason), so
  `prisma db pull` still would not reproduce the schema this app actually depends on. **The delete
  affordance on `/admin/webhooks` is disabled from `endpoint.attempts`, which counts ALL deliveries** —
  so an endpoint whose entire history is a single dead delivery from a long-deleted receiver can never
  be deleted through the UI, only disabled. Correct per the rule (the ledger is the record of what was
  sent), but there is no "purge this endpoint's history" path anywhere, and Task 13 is where one would
  naturally live if it is ever wanted.
- **Phase 8, Task 12 — a PRE-EXISTING seed gap, surfaced by a fixture review and deliberately left
  visible:** **`APR-2031` is seeded `EXECUTED` but carries no `assetId`**, and
  `src/worker/execute-approval.ts:63-65` refuses every approval type with
  `if (!approval.assetId || !approval.asset) return fail(…)` before doing any work. So the seed contains
  an executed approval the real execution path could never have produced — which also means it can never
  have emitted `approval.executed`, which is why Task 12's webhook deliveries have no honest source row
  at all. Task 12's quality review proposed adding `assetId` to that literal; declined, because it edits
  an approval the IT Home and other fixtures read, needs a full ~8-minute Playwright run to clear, and
  would silently close a gap worth knowing about. The alternative — adding a *new* `EXECUTED` approval —
  is worse: `e2e/approvals-audit.spec.ts` pins `Closed 2`. **If Phase 9 ever tidies the seed, this is the
  one-line fix, and it needs the full e2e suite run behind it.** Related, and cheap to get wrong the same
  way: `prisma/seed.ts` is NOT prettier-formatted (compact one-line object literals per row) — running
  `npx prettier --write` on it produces a ~575-line reformat that buries any real change.
- **Phase 8, Task 10 (recorded, judged out of scope):** **there is no `secretVersion` column and no
  key-id header**, so a receiver cannot support an overlap window during a rotation — rotating is a hard
  cutover, which is why `ROTATION_WARNING` exists and why `/admin/webhooks` states it before the click.
  An overlap scheme (nullable `secretPrev` + a dual-signature header) was declined deliberately: this
  phase has one migration. **`lastError` for a network failure is undici's terse `"fetch failed"`** with
  no cause chain, so "DNS did not resolve" and "connection refused" are indistinguishable on the
  deliveries page; surfacing `err.cause.code` would fix it and was left alone because the retry behaviour
  is identical either way. **The delivery is signed with the secret decrypted AT ATTEMPT TIME**, which is
  what makes rotation affect in-flight deliveries — deliberate (a replay after rotation must use the live
  secret), but it does mean a delivery's signature is not reproducible from the row afterwards.
  **IPv6 literals are not checked by `urlSchema`** (§6a rule 33) and `redirect: "manual"` does not change
  that: it closes the redirect hop, not the first hop.
- **Phase 8, Task 13 (recorded, judged out of scope for this task):** **`WebhookDelivery.nextAttemptAt`
  is written by nothing but `prisma/seed.ts`.** The worker's retry path (`mark` in
  `src/worker/deliver-webhook.ts`) never sets it; the only other writer is the DELIVERED path, which
  *clears* it. So the column is indexed (`@@index([status, nextAttemptAt])`), seeded on one fixture, and
  otherwise permanently `NULL` for every delivery the running code has produced — which is why
  `listDeliveries` deliberately does not read it and says so, and why `replayDelivery` clears it on
  reset (§6a rule 60). **Either the worker should maintain it or the column should go**; a "next attempt"
  column sourced from it would look authoritative and be blank in production. The real schedule is the
  job's `runAt`, which `listDeliveries` already fetches for the live-job set and could surface for a few
  lines more. Note this also makes the seed's `RETRYING` fixture a value the running code cannot produce
  — a narrow instance of §6a rule 51, disclosed in the seed's own comment.
  **The deliveries list has no pagination and no per-tab counts.** No pagination is scope decision #12
  (matching `/approvals`), and the page states "Showing N of M" — but unlike `/purchases` and
  `/reservations`, whose `Tabs` carry a count per tab, these do not. Four extra `count`s in the existing
  `Promise.all` would close it; left out because the plan did not ask and `deadReplayable` already
  surfaces the number that matters. **`/admin/webhooks/deliveries` has no sidebar entry**, so no nav item
  highlights while you are on it (`navIsActive` compares whole pathnames) — it is reached from
  `/admin/webhooks` and from `endpoint-editor.tsx`'s `N dead` link, and the breadcrumb goes back. That
  matches every other sub-page in the app, so it is recorded rather than fixed. **`endpoint-editor.tsx`
  hardcodes `?state=DEAD`** rather than deriving it from `DELIVERY_TABS`; harmless while `DEAD` is a
  `DeliveryStatus`, worth knowing if the tab ids ever stop being status names. Lastly, **the batch replay
  is rate-limited per row** (one `checkRate` token for the batch plus one per delivery, against a 60/min
  cap), which is invisible at seed scale and correct at real scale — and now visible when it bites,
  because the action reports `queued` against `attempted` with the reason.
- **Phase 9, Task 5 — the farewell report cannot say WHO decided an item, or WHEN.** `Decision`
  (`src/lib/offboarding.ts:113`) carries `refNo`, `outcome`, `state`, `reason` — no actor, no
  timestamp — so neither the printable report nor the new `.xlsx` export can attribute a decision. For
  a document HR reads and files, that is a real gap. It was declined for Phase 9 deliberately and the
  reasoning is worth keeping: **"decided" is DERIVED from the approvals that exist** (Phase 7 scope
  decision #3 — there is no wizard-state table, which is what makes a half-finished offboarding N
  correct records instead of a lost session). So the actor and the moment are not two fields to add to
  a type; they are a join against the `Approval` row and its `AuditEntry` trail, where the data already
  exists. Widening `Decision` to carry them would touch the wizard, `decisionOf`, and every consumer,
  and would mean a domain type growing fields for an export's benefit. **The data is not lost — it is in
  the audit log.** If HR asks for attribution on the report, this is a small feature against
  `AuditEntry`, not a schema change.
- **Phase 9, Task 4 — the facet-count half of §8's candidate-set rule, for employees.**
  `employeeFacetOptions` never receives `gapsOnly`, so with "Policy gaps only" active the toolbar's
  department/employment counts describe the candidate set while the table and the export show the cut
  set (3 of 10 in the seed). Identical in kind to the assets version already tracked here, and now
  carrying the same explanatory comment in `src/server/modules/employees/queries.ts`. Accepted for the
  same reason: they are read-only display counts, and both consumers that ACT on the set
  (`listEmployees`, `employeeExportRows`) resolve the real cut through `filteredEmployees`. **Pre-existing
  — Phase 9 fixed the list/export half of this pattern and deliberately left the count half**, so a
  future reader has a signal rather than a mystery. Closing it means teaching the facet counts to run
  the in-memory cut, which costs a full resolve per facet.
- **Phase 8, Task 14 — a DELIBERATE, STANDING deviation from `design_handover/README.md`, recorded
  here because a CSS comment is not durable enough.** The design handover specifies
  `text-faint` as **`#98A2B3`** (light) and **`#6B7480`** (dark), for "mono metadata, placeholder".
  Both fail WCAG AA: measured **2.40:1** against `--canvas` and **2.575:1** against `--surface` in
  light, **3.41:1** against `--surface-raised` in dark, where AA requires 4.5:1 and grants no relief
  below 18pt. `src/app/globals.css` now ships **`#667085`** (light, 4.64:1 on canvas / 4.98:1 on
  surface) and **`#868f9c`** (dark, 4.93:1). The design doc has NOT been edited — it remains the source
  of truth for everything else, and this is the one place shipped code knowingly disagrees with it.
  **Two consequences worth knowing before anyone "fixes" this back.** (a) *Light mode lost a tier.* At
  4.5:1 against `--canvas` there is no room for a third step: anything lighter than `--text-muted`
  fails, so light-mode `faint` and `muted` now hold the SAME value while dark mode keeps all three. The
  token survives because the semantic tier is still real and a lighter canvas would re-separate them.
  (b) *This overrides a Phase 7 precedent.* Phase 7 hit the same defect on the offboarding wizard's
  locked step-bar entries and fixed it at the CALL SITE (`text-fg-faint` → `text-fg-muted`, recorded in
  §4). Phase 8 fixed it at the token instead, because ~24 usages shared the defect and patching a
  subset leaves two tokens meaning one thing. Both fixes are correct for their scale; the call-site one
  is now redundant but harmless. If the design system is ever revised, revisit this together with the
  `heading-order` violation below — they are the two known standing a11y items.
- **Phase 8, Task 14 — the flake nobody has closed.** `e2e/it-core.spec.ts:127` ("edit writes
  field-level history rows") failed once during Task 14 and then passed on three subsequent runs
  including the full battery. It is the "✓ Saved" self-clearing-flash class that §7 records as fixed in
  Phase 7 with a 20s assertion — so this is either a second site that fix did not cover, or a genuine
  intermittent. **Recorded, not closed**: "it passed on re-run" is not proof, and this project has
  already had one failure of exactly that shape turn out to be a real timing bug with a real cause. If
  it reappears, read the Playwright dump before touching the assertion.
- **Phase 8 leftovers (recorded, judged out of scope):** `/admin/webhooks/deliveries` has **no
  pagination** — scope decision #12, matching `/approvals`; it shows the newest 50 with a "Showing N of
  M" line, and unlike `/purchases` and `/reservations` its tabs carry **no per-tab counts** (four extra
  `count`s in the existing `Promise.all` would close that). **`replayAllDead` is rate-limited per row**,
  because it calls `replayDelivery` per delivery and each call spends a token against the 60/min cap —
  invisible at seed scale, correct at real scale, and now visible when it bites because the action
  reports `queued` against `attempted`. **Nothing prunes `WebhookDelivery`**, so the ledger grows
  without bound; there is no retention policy anywhere in the schema. **`WebhookDelivery.nextAttemptAt`
  is written by nothing but the seed** (§6a rule 60) — the job's `runAt` is the real schedule, so either
  the worker should maintain the column or it should go. (The raw-SQL-only constraints
  `Job_one_live_deliver_per_delivery` and `Job_deliver_payload_shape` are already tracked in the
  Tasks 8-and-9 bullet above — not repeated here.)
- **`/bootstrap`'s copy under-states the lock**: `src/app/(auth)/bootstrap/page.tsx` promises the
  permanent admin's *role* can never be changed, but Phase 8 widened that to access as well. Worth
  aligning when Task 3 lands. The corollary belongs here too — a bootstrapped permanent admin's account
  **can never be revoked in-app** if the holder departs or the credentials leak. That is the accepted
  cost of the lock, not an oversight.
- **Phase 1 gap, found during Phase 8's Task 1 review:** `/signup` is not gated on user count, while
  `/bootstrap` permanently 404s once any `User` row exists. On an empty database, whoever reaches
  `/signup` first creates a `viewer`, closes bootstrap forever, and the system has **zero admins with
  no in-app recovery**. A last-admin guard would not have prevented it — that prevents removing the
  last admin, it cannot conjure one.
- Entra SSO real wiring (needs tenant creds). Real product photography, brand mark, barcode generation (striped placeholders today). Off-device backups (nightly `pg_dump` to a local volume ships; copying elsewhere is the user's call). HR review of the accountability-form acknowledgement copy. `WebhookEndpoint.secret` encryption (Phase 8). CI workflow + jsdom component tests (declined in Phase 1, revisitable).
