# Pick up here — new device, new session

**Written 2026-09-07** at `main` = `origin/main`, Phases 1–13 merged and pushed. This is the short front
door. The long reference is [`HANDOVER.md`](HANDOVER.md) (≈2,500 lines; read its §0 once you are running).
Everything below that is a *decision* rather than a fact about the code lived only in one machine's
assistant memory until now — that is why this file exists.

---

## 1. Where the code stands

| | |
|---|---|
| Repository | `github.com/neilluceromc/ChristianAuditing` — **public**, by choice. Never commit `.env` or any real secret; scan before every push. |
| Branch | `main`, **level with `origin/main`** after the Phase 24 push (merge `48c37f7`, 2026-09-21; the same push carried the spec/plan commits `0aeb8ce`/`32e6959` and the IP renumbering commit `efd6d9e`) — count with `git rev-list --count origin/main..main` before trusting this. Phase branches (`phase-10-polish` … `phase-14-department-owned-classes`) exist only on the old dev laptop; `phase-15-direct-it-lifecycle`, `phase-16-registration-custody`, `phase-17-scale-sweep`, `phase-18-purchasing-suppliers` and `phase-19-stock-control` were merged and deleted on the staging laptop. All are fully contained in `main`. **`phase-20-it-people-and-gaps` (final tree `4d54382`, after the final-review fix wave) IS MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10)** (9 tasks, `D-1`…`D-30`; battery in the table below); the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. **Staging runs the Phase 24 merge** (`48c37f7`) since the 2026-09-21 forced redeploy (code-only — no new migration; 24 was applied by the second 2026-09-17 redeploy, 23 came with the first 2026-09-17 redeploy, 22 with the 2026-09-15 one, 20 and 21 with the 2026-09-10 one, 19 with the 2026-09-09 one, 16–18 with the two 2026-09-08 ones) — `-Force` is needed whenever the merge happened on this laptop, because the plain run sees nothing new and skips. **`phase-21-approvals-oversight` (final tree `2ae8738`, after the final-review fix wave and ruling R7's Manila-date fix) IS MERGED TO `main` via `--no-ff` `b716767` AND PUSHED (2026-09-15) — 8 tasks, `D-1`…`D-16` — the final-review fix wave added `D-11`…`D-13`, the final battery `D-15` and `D-16`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed.** The push also carried `8817488`, the Phase 21 spec-and-plan docs commit that had sat on local `main` since 2026-09-14. **`phase-22-stock-control-d2` (final tree `a4b57b5`, after the final-review fix wave) IS MERGED TO `main` via `--no-ff` `26aaf82` AND PUSHED (2026-09-16) — 10 tasks, `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed.** The push also carried `935595e` and `0c4d103`, the Phase 22 spec-and-plan docs commits that had sat on local `main` since earlier that day. Nothing remains for Phase 22. **`phase-23-parkinson-sweep` (final tree `09bf0a5`, after the final-review fix wave and one test-only battery fix) IS MERGED TO `main` via `--no-ff` `18228b0` AND PUSHED (2026-09-17) — 10 tasks, `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed.** The push also carried `39f73a3` and `8b2dfd7`, the Phase 23 spec-and-plan docs commits that had sat on local `main` since earlier that day. Nothing remains for Phase 23. **`phase-24-it-gaps-2` (final tree `7601cab`, after the final-review fix wave; docs `40a11b6`) IS MERGED TO `main` via `--no-ff` `48c37f7` AND PUSHED (2026-09-21)** — 6 tasks, `D-1`…`D-10`; battery in the table below; the merged tree equals the tested tip except the three lines of the same-day IP renumbering commit `efd6d9e`; branch and worktree removed. The push also carried the two Phase 24 docs-only commits `0aeb8ce` (spec) and `32e6959` (plan) that had sat on local `main` since 2026-09-17, plus `efd6d9e`. Nothing remains for Phase 24 beyond the parked items in §5. |
| Stack | Next.js 15 App Router · Prisma 6 · PostgreSQL 16 (Docker) · Auth.js v5 · Tailwind v4 · Playwright · vitest. Node ≥ 22, npm ≥ 11 (dev machine ran Node 24). |
| Database | **24 migrations** on `main` (migration 24 `parkinson_deadlines`: additive — `Employee.offboardingDueAt` and `Stocktake.dueAt` added nullable, a plain `IS NULL`-guarded SQL backfill gives every OFFBOARDING employee `offboardingAt + 7` days and every stocktake `openedAt + 3`, then `SET NOT NULL` on the stocktake column; applied on `inventory_dev`, **24 found, schema up to date**). **staging is at 24 too** since the second 2026-09-17 forced redeploy (its one OFFBOARDING employee gained a complete-by date of start + 7 d, already past — overdue by design; it had no stocktakes). Migration 23 `stock_lots_and_allocations` (merged 2026-09-16, asserted plpgsql backfill of D1's history) reached staging in the first 2026-09-17 redeploy with empty stock tables. **Phase 24 adds no migration** — it deletes rows rather than modelling anything new, so `phase-24-it-gaps-2` is still 24 found / schema up to date, and the redeploy that carries it is a code-only `-Force`. `prisma migrate reset` is **not** used in this project. |
| Battery, last run 2026-09-17 (Phase 24 final tree `7601cab`, `phase-24-it-gaps-2`, **merged to `main` via `--no-ff` `48c37f7` and pushed 2026-09-21**, after the final-review fix wave) | `tsc` clean · `lint` clean · **24 migrations**, schema up to date (this phase adds none) · **1485 unit / 84 files** · **340 e2e / 33 files** by `--list`. Task 6's close ran the same seven foreground chunks Phase 23 used, composition unchanged (it-gaps stays in F), `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47 passed (3.5m) · E1 36 passed (5.7m) · E2 31 passed (3.1m) · F 42 passed (4.4m) = 340 / 340**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first pass — no chunk re-run, and no test-only fix commit in this phase. Only F's count moved, 39 → 42, for the three new `e2e/it-gaps.spec.ts` cases. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the four rulings and the fix wave: `HANDOVER.md` (q). |
| Battery, last run 2026-09-17 (Phase 23 final tree `09bf0a5`, `phase-23-parkinson-sweep`, the tree merged as `18228b0`, after the final-review fix wave) | `tsc` clean · `lint` clean · **24 migrations**, schema up to date · **1476 unit / 82 files** · **337 e2e / 33 files** by `--list`. Task 10's close ran seven foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000` — Phase 22's seven with `e2e/quick-forms.spec.ts` added to chunk D and `e2e/deadlines.spec.ts` to chunk F: **A 54 passed (3.4m) · B 67 passed (5.8m) · C 63 passed (5.9m) · D 47 passed (4.7m) · E1 36 passed (8.9m) · E2 31 passed (4.1m) · F 39 passed (4.8m) = 337 / 337**, zero failed, zero did-not-run. One test-only fix, `09bf0a5`: chunk B's first pass on `dbc93a0` was **64 passed, 2 failed, 1 did not run**, reproduced identically on an immediate as-is re-run, and both failures were one bug — `e2e/department-owned.spec.ts` case 9's duplicate create relied on the new-employee form's old auto-defaulted department, which this phase deliberately replaced with a blank "Choose a department", and because that case sits in a `test.describe.serial` its failure retires the worker, so the file's `beforeAll` reseed ran again before case 11 and left Purchasing Home reading Approvals 1 / Below reorder level 1 / Expiring within 30 days 1 — three exact matches for that case's `getByRole("link", { name: "1", exact: true })`. Chunk B then ran 67/67 and chunk A was re-run on the final tree, so every number above is post-fix. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the nine rulings and the fix wave: `HANDOVER.md` (p). |
| Battery, last run 2026-09-16 (Phase 22 final tree `a4b57b5`, `phase-22-stock-control-d2`, the tree merged as `26aaf82`, after the final-review fix wave) | `tsc` clean · `lint` clean · **23 migrations**, schema up to date · **1404 unit / 79 files** · **319 e2e / 31 files** by `--list`. Task 10's close (branch tip `dfb1a0f`, 2026-09-16) ran seven foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000` (chunk E split into E1/E2 per spec §9.3, since the combined chunk would have carried 67 tests): **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.7m) · E1 36 passed (5.6m) · E2 31 passed (3.0m) · F 30 passed (3.2m) = 319 / 319**, zero failed, zero did-not-run, all first pass, no re-run needed anywhere in the battery, **1404 unit / 79 files**. The final review's fix wave (`2eeabf7`, `D-16`…`D-19`) was verified with `tsc` (clean) and a scoped `vitest run src/lib/stock-allocation.test.ts` (24 passed), plus a scoped re-review — ADDRESSED all four findings, 0 new; the full seven-chunk battery then ran on `2eeabf7`: chunks B–F and E1/E2 passed clean on the first try, but chunk A failed once — `e2e/it-core.spec.ts:302`'s documents-upload PNG-rejection case, 53 passed/1 failed, reproduced identically on an immediate as-is re-run, diagnosed as a pre-existing hydration-race gap (the file's own `waitForHydration()` helper was wired to only one of its two upload call sites) — fixed test-only (`a4b57b5`), verified in isolation, then chunk A re-ran 54 passed/0 failed. **The whole battery then re-ran on the final tree `a4b57b5`: A 54 passed (3.3m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E1 36 passed (5.7m) · E2 31 passed (3.1m) · F 30 passed (3.3m) = 319 / 319**, zero failed, zero did-not-run, all first pass, no further fix commits, **1404 unit / 79 files** (unchanged). `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped and what the fix wave/final battery found: `HANDOVER.md` (o). |
| Battery, last run 2026-09-15 (Phase 21 final tree `2ae8738`, `phase-21-approvals-oversight`, the tree merged as `b716767`, after the final-review fix wave and ruling R7's Manila-date fix) | `tsc` clean · `lint` clean · **22 migrations** · **1317 unit / 77 files** · **305 e2e / 29 files** by `--list`. Task 8's close (branch tip `562587f`, 2026-09-14) ran six foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.4m) · F 30 passed (3.3m) = 305 / 305**, zero failed, zero did-not-run, **1312 unit / 77 files**. The final review's fix wave (`b6b4e2a`, ruling R6, `D-11`/`D-12`) re-ran `tsc`/`eslint`/`vitest` (**1314 unit / 77 files**) and a scoped re-review, both clean; the full six-chunk battery on `b6b4e2a` then reproduced chunk F's `transfers.spec.ts` UTC-midnight failure at 01:00 Manila (Phase 20's parked M-5) — **25 passed, 1 failed, 4 did not run**, chunks A–E green — before ruling R7 (`D-15`) fixed it in product code (`localDateISO`, the dialog/schema, `isRecentTransfer`'s one-day grace, and the spec's own "tomorrow"). **The whole battery then re-ran on the final tree `2ae8738`: A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.6m) · E 53 passed (7.4m) · F 30 passed (3.2m) = 305 / 305**, zero failed, zero did-not-run, all first pass, no further fix commits, **1317 unit / 77 files**. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped and what the fix wave/final battery found: `HANDOVER.md` (n). |
| Battery, last run 2026-09-10 (Phase 20 final tree `4d54382`, `phase-20-it-people-and-gaps`, unmerged, after the final-review fix wave) | `tsc` clean · `lint` clean · **21 migrations** · **1295 unit / 75 files** · **296 e2e / 27 files** by `--list`. Task 9's close (branch tip `f6ec5e1`) ran six foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.3m) · B 67 passed (3.9m) · C 68 passed (4.4m) · D 38 passed (2.6m) · E 53 passed (7.3m) · F 21 passed (2.0m) = 301 run / 296 unique** (chunk C's file argument was the bare pattern `offboarding`, which also matched `offboarding-v2.spec.ts`), zero failed, zero did-not-run on the runs recorded. Chunks A, C and D each failed a first pass on a stale pre-Phase-20 e2e expectation, were reproduced once as-is, fixed in their own commit (`fe4295c`, `63df64a`, then `0b463b1` and `f6ec5e1` for chunk D's two), and re-ran clean; chunks B, E, F passed clean first try. The final-review fix wave re-ran `directory.spec.ts` (5 passed, twice), `it-gaps.spec.ts` (6 passed, twice), `transfers.spec.ts` (5 passed), `import-export.spec.ts` (21 passed) and `paging.spec.ts` (12 passed) — `--list` still **296 / 27**, unchanged. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the final review's findings and the wave: `HANDOVER.md` (m). **The whole battery then re-ran on the final tree `4d54382` with explicit file paths throughout, not the bare pattern above: A 54 passed (3.4m) · B 67 passed (3.8m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.3m) · F 21 passed (2.0m) = 296 / 296**, zero failed, zero did-not-run (chunk A's first pass was 53 + 1 failed on `it-core.spec.ts:302`, a `toBeVisible` 5 s timeout, not reproduced on an immediate re-run — the cold-compile/headroom class §7 documents). |
| Battery, last run 2026-09-09 (Phase 19 final tree `a185729`, `phase-19-stock-control`, unmerged) | `tsc` clean · `lint` clean · **20 migrations** · **1224 unit / 72 files** · **275 e2e / 23 files** by `--list`. Task 9's close ran five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 passed (3.3m) · 67 passed (3.9m) · 63 passed (4.0m) · 38 passed (2.6m) · 53 passed (7.3m) = 275 / 275**, zero failed, zero did-not-run; the fix wave re-ran only `stock.spec.ts` + `stocktake.spec.ts` — **17/17 passed (1.6m)**, `--list` still **275/23** unchanged. Commands and history: `HANDOVER.md` §0 item 9; what shipped and what the wave fixed: `HANDOVER.md` (l). **The whole battery then re-ran on the final tree after the fix wave, ruling R14 and the re-review minors: 54 (3.4m) · 67 (3.8m) · 63 (4.0m) · 38 (2.5m) · 53 (7.1m) = 275 / 275**, zero failed, zero did-not-run (chunks A and B on `ad19921`, C–E on `a185729`; the delta between them is a comment, a test title and one e2e assertion). |
| Battery, earlier full run 2026-09-09 (Phase 18 final tree `3298abf`, the tree merged as `d4b95bb`) | `tsc` clean · `lint` clean · **19 migrations** · **1113 unit / 64 files** · **258 e2e / 21 files** by `--list`. Five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 passed (3.3m) · 67 passed (3.9m) · 63 passed (4.0m) · 38 passed (2.5m) · 36 passed (5.6m) = 258 / 258**, zero failed, zero did-not-run (Task 10's 74-test last chunk was split in two to fit the ten-minute foreground cap). Commands and history: `HANDOVER.md` §0 item 9. |
| Last two phases | **Phase 24** — IT gaps 2: Replace groups, the repairs view paged in SQL, worker retention. The last three genuinely open items on the IT list (`docs/HANDOVER-PENDING.md` §6), all built under spec §0 decision 3's "approach A — reuse what exists": the combobox already rendered heading rows, the repair stage cut already ran in SQL, and the worker already had a periodic hook. `ComboOption` gains `group?: string` and `EntityCombobox` renders a `role="presentation"` heading wherever the new pure `headingBefore()` says the group changed — one branch replacing the two hard-coded Recent/All ones — so the Replace picker reads SAME TYPE / OTHER SPARES, and only OTHER SPARES when no same-type spare exists, which was the gap; the per-row "Same type" / "Other spare" note goes, because under a heading it said the same thing twice (decision 4). `listAssets`' repair branch pages `repairStageIds`' SQL id set through `pagedSnapshot` instead of loading every candidate row with its includes and paging the array in memory — the cut has been SQL since Phase 20, the paging is SQL now; facet counts deliberately stay on the candidate set (decision 5). And the worker prunes finished rows older than **90 days** — `DELIVERED`/`DEAD` deliveries by `createdAt`, `DONE`/`DEAD` jobs by `updatedAt` — in id batches of 1000, once at start and hourly thereafter, never fatally, with `npm run worker:prune` for a one-off pass and the deliveries page stating the rule from the same constant (decisions 2 and 6). **No migration, no new table, no new route, no role change.** Spec `superpowers/specs/2026-09-17-it-gaps-2-design.md`, plan `superpowers/plans/2026-09-17-phase-24-it-gaps-2.md` (6 tasks, `D-1`…`D-10` — the final whole-branch review added `D-8`, the fix wave `D-9`, the final battery `D-10`), four rulings: R1 settled that `ComboOption.group` is a type-only addition either of the two parallel tasks could land; R2 accepted that e2e case 8's `?page=2` clamps on today's seed (largest stage cut 3 rows) so the second-page branch is present but unexercised, because cases 6 and 8 prove the SQL-versus-screen parity and `e2e/paging.spec.ts`'s 1000-asset `?page=41` already drives the same `pagedSnapshot` at depth; R3 closed the final review's accessibility finding; R4 fixed the wave's contents. The final whole-branch review found 0 Critical, 2 Important, 11 Minor: the retention delete identified rows by id alone, so an admin's Replay landing between the select and the delete could have its revived `PENDING` row deleted anyway (both deletes now repeat the status-and-cutoff predicate, making spec §7's "impossible by predicate" literally true), and — a **spec-level** regression all five task reviews passed — `role="presentation"` headings are outside the accessibility tree, so the same-type signal the deleted note used to carry was announced to nobody. R3 fixed that additively: each heading `li` gets an `id` and options under a *grouped* heading get `aria-describedby` to it, while the synthetic Recent/All headings are deliberately not described, so the five recent-enabled callers announce exactly as before. All fixed in one wave (`7601cab`, six files); the scoped re-review found all nine ADDRESSED, 0 new. Battery in the table above. **MERGED TO `main` via `--no-ff` `48c37f7` AND PUSHED 2026-09-21 (final tree `7601cab`, docs `40a11b6`); branch and worktree removed; staging redeployed the same day with a code-only `-Force` and runs it at `http://192.168.203.183:3000`.** Recorded rather than fixed: `npm run worker:once` now prunes as a side effect and four specs shell out to it; the stage cut travels as bind parameters twice; case 8's page-2 clamp; the fuller `role="group"` ARIA shape, parked in `docs/HANDOVER-PENDING.md` §6. **Phase 23** — Parkinson sweep: quick forms and complete-by dates. Both readings of Parkinson's Law at once (spec §0 decisions 1 and 3) — shrink the time a task takes, and put a clock on the two pieces of work that had none. `Employee.offboardingDueAt` and `Stocktake.dueAt` are stored, not derived, so they can be edited at start the way a loan's due date is (decisions 2 and 4): offboarding defaults to 5 working days from the day employment flips to OFFBOARDING and is set and edited in the employee form, so the change lands in the existing `update` audit with old and new values (decision 5); a stocktake defaults to 3 days and is set at open only (decision 6). They surface as the offboarding list's Due column, facet and sort, the wizard header pill, a completion line on the farewell report, the stocktake list and page's "Close by", the IT Home worklist's leaver row, and a ninth Purchasing Home tile "Stocktakes past close-by". The shrink half (spec §8) gives every required "why" a row of `ReasonField` chips that fill the box and never submit (decision 8), remembers the last five picks per kind in `UserPreference` as a "Recent" group on the comboboxes, written best-effort after the transaction and never audited (decision 7), focuses the first form control in every dialog, turns the stock issue form's full-roster employee dropdown into a typeahead, adds "Same item again" to receive, prefills the adjust dialog's counted balance, adds a line on Enter in a purchase draft, warns on a same-named supplier, and makes the new-employee form's department start blank instead of silently defaulting to whatever sorts first. `DuePill` uses the existing `Pill` tones with the distinction carried by the text, no new colour token (decision 9). One additive migration, **24** (`parkinson_deadlines`), with a plain `IS NULL`-guarded SQL backfill; backfilled dates may already be in the past and are shown overdue, which is the truthful reading. Two new e2e files, `deadlines.spec.ts` (9 cases) and `quick-forms.spec.ts` (9 cases). Spec `superpowers/specs/2026-09-17-parkinson-sweep-design.md`, plan `superpowers/plans/2026-09-17-phase-23-parkinson-sweep.md` (10 tasks, `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`), nine rulings: R2 relaxed the spec's over-strict "every chip ≥ 5 characters" rule (every chip site's minimum is 3), R3 recorded that the inputs' `min` makes the server date floors unreachable through the UI by design and kept both layers, R4 settled that `/audit?entity=employee` is this phase's surface for field-level employee history because no `/employees/<id>/history` route exists, and R6 renamed the chip group to "Quick picks" and dropped the chips' `aria-label`s rather than edit the 21 `getByLabel("Reason")`/`("Purpose")` sites they had started colliding with. The final whole-branch review then found one Critical — spec §6.1/§8's `enterKeyHint` had never reached the plan or any brief, so no task review could see it missing (R7) — and two Important: the chip-label collision (R6) and an overdue leaver's employee form that could not be saved at all, because `min={today}` blocked the stored past date natively and the server floor was unconditional (R8, guaranteed on staging by migration 24's own backfill). All fixed in one wave (`27479ad` + `dbc93a0`), scoped re-review ADDRESSED all eight findings. Battery in the table above. **MERGED TO `main` via `--no-ff` `18228b0` AND PUSHED (2026-09-17; final tree `09bf0a5`); branch and worktree removed — staging redeployed 2026-09-17 with `-Force`, migration 24 applied, web healthy;** the six deferred Minors are in `docs/HANDOVER-PENDING.md` §5.3 and plan `D-15`. Phase 22's entry rolled off this row at Phase 24's close, as Phase 21's did at Phase 23's — it is unchanged in §4 item 3 and `HANDOVER.md` (o). |

## 2. Dev environment on the new device

Nothing that matters travels except the repository: `.env`, `node_modules`, `.next`, the Docker database
volume, `uploads/` and `backups/` are all local to the old machine, and all are regenerated.

```bash
git clone https://github.com/neilluceromc/ChristianAuditing.git
cd ChristianAuditing
cp .env.example .env         # then fill it — see below
docker compose up -d db
npm ci                       # from the committed lockfile; the only npm *install* that is safe on Windows
npx prisma generate          # required; the postinstall hook is not reliable
npx prisma migrate deploy    # applies the 14 migrations
npm run db:seed              # 25 IT + 7 Purchasing assets, 5 accounts — see below
npm run dev                  # http://localhost:3000
```

**Filling `.env` for development** (the comments in `.env.example` are the source of truth):

- `POSTGRES_PASSWORD` — any long random string **without `/ + =`** (it is spliced unescaped into a URL). Also paste it into the `DATABASE_URL` line.
- `AUTH_SECRET`, `SECRET_ENCRYPTION_KEY` — random 24 and 32 bytes, base64. New values are fine: the old dev database does not come along, so there is nothing encrypted under the old key.
- `SEED_PASSWORD` — **leave unset for local development.** Set, it makes every Playwright login fail (the reason is in `.env.example`). Seeded accounts then use the documented default `admin123`.
- `APP_BASE_URL` — the dev machine had `http://192.168.202.141:3000`. This is only read when printing labels; for development leave the placeholder or use your own LAN address. **See §4 before this value goes anywhere near a printer.**

Seeded accounts, all `@thebackroomop.com`: `admin@` (sysadmin, both asset classes) · `it@` · `purchasing@` · `finance@` · `viewer@`.

Then prove the machine works before changing anything:

```bash
npx tsc --noEmit && npm run lint && npm run test      # expect 908 / 51
npx playwright install                                # once
npx playwright test e2e/auth-shell.spec.ts --workers=1   # ~1 min, 16 tests — the cheapest e2e smoke
```

The full e2e battery does not fit one command; the five-part split is in `HANDOVER.md` §0 item 9. Run
parts in the **foreground** with `--global-timeout`, never backgrounded, and read the count line — a run
that hits the timeout prints "N did not run" and still looks like a pass.

**Windows-specific, learned the hard way:** never run `npm run build` while `npm run dev` is running (they
share `.next`); never install a package with plain `npm install` on Windows — it drops the Linux optional
dependencies from the lockfile and breaks the Alpine production image (`HANDOVER.md` §7 has the recovery);
Docker Desktop must be started by hand from the desktop session.

## 3. Decisions that are not written in the code

These were made with the user and would be invisible to anyone reading only the repository.

- **"Admin" in the stakeholder notes means the Purchasing department.** In the codebase `admin` is the
  sysadmin role; Purchasing is the `purchasing` workspace and the `purchasing_staff` role. `HANDOVER.md` §9
  carries the warning.
- **Finance confirmation is a label, not a gate.** An unconfirmed asset is fully live. Do not "fix" this into
  a hold.
- **IT sees and manages IT assets only. Purchasing sees everything, registers both classes and manages Purchasing assets. A Purchasing-registered IT asset is IT's and waits for IT's check before Finance sees it. Finance confirms everything.** Offboarding stays IT-run and shared; the class owner approves the return. Person-centric pages show every class, with invisible tags as text. (Phase 14.)
- **IT lifecycle changes apply on confirm** and are recorded as EXECUTED approvals plus audit; Purchasing keeps its queue; a returned IT device waits for triage before it is a spare again; offboarding decisions on IT devices are immediate, a leaver's car still goes to Purchasing's queue. (Phase 15.)
- **Deployment is a prototype on the office LAN.** The Cloudflare Tunnel idea was withdrawn; the label URL
  is a reserved LAN address or a UniFi DNS name. Staging runs on a dedicated laptop and is updated by pushing
  `main` from dev and running `scripts/deploy-staging.ps1` on the laptop. Comparison of hosting options that
  led here: `superpowers/specs/2026-09-03-staging-hosting-comparison.md`.
- **Merging and pushing are separate, explicit decisions by the user.** Neither happens unprompted. Only
  `main` is ever pushed; phase branches stay local.
- **Working method:** brainstorm → spec → plan → subagent-driven execution, a fresh implementer per task
  with a spec-compliance review and then a code-quality review that asks *"is the rule right?"*, not *"does
  the diff match?"* Every plan amendment is committed as `docs(plan): …` so the plan never lies. Use the
  cheapest model that can do each job: mechanical work to a small model, implementers and spec review to a
  mid model, judgment reviews to the strongest. Long mechanical runs (the battery) belong in the controller's
  own foreground calls — a subagent dies with the session.
- **Review the rule, not the diff.** Across Phases 7–15 almost every real defect was in the *plan* and was
  transcribed faithfully by the implementer; the reviews are where correctness comes from. The 119 rules
  distilled from this are `HANDOVER.md` §6a.

## 4. What is next, in order

1. **Phase 24 — IT gaps 2: Replace groups, the repairs view paged in SQL, worker retention — IS
   MERGED TO `main` via `--no-ff` `48c37f7` AND PUSHED (2026-09-21; final tree `7601cab` after the
   final-review fix wave, docs `40a11b6`); the merged tree equals the tested tip except the three lines of
   the same-day IP renumbering commit `efd6d9e`; branch and worktree removed** (6 tasks, `D-1`…`D-10` —
   the final whole-branch review added `D-8`, the fix wave `D-9`, the final battery `D-10`). There is
   **no migration** (24 stays): **staging was redeployed 2026-09-21 with a code-only
   `scripts/deploy-staging.ps1 -Force`** (24 found, none pending; web healthy; local and LAN `/login`
   answer 200 at the laptop's new address `http://192.168.203.183:3000`). The push also carried the two
   docs-only commits `0aeb8ce` (spec) and `32e6959` (plan) that had sat on local `main` since 2026-09-17,
   plus `efd6d9e`. Nothing remains for Phase 24 beyond the parked items in §5. See §1's table above and `HANDOVER.md` (q) for what shipped, the four rulings,
   the final review and the battery; the parked `role="group"` ARIA shape and the three IT items still
   open are in `docs/HANDOVER-PENDING.md` §6.
2. **Phase 23 — Parkinson sweep: quick forms and complete-by dates — IS MERGED TO `main` via
   `--no-ff` `18228b0` AND PUSHED (2026-09-17; final tree `09bf0a5`, after the final-review fix wave and one
   test-only battery fix); branch and worktree removed** (10 tasks,
   `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`) —
   **Staging redeployed 2026-09-17 with `scripts/deploy-staging.ps1 -Force`: migration 24 applied (24 found), web healthy, the LAN URL answers; the one leaver already on staging now shows a complete-by date and reads overdue, as intended. Nothing remains for this phase.**
   Migration 24 `parkinson_deadlines` is additive and its backfill is two guarded `UPDATE`s, so it
   applies on the next `scripts/deploy-staging.ps1 -Force`; every leaver already on staging acquires a
   complete-by date and some will read overdue on the first render, which is spec §0 decision 4's
   intent. The push also carried the two docs-only commits `39f73a3` (spec) and
   `8b2dfd7` (plan). See §1's table above and `HANDOVER.md` (p) for what shipped, the nine rulings, the
   final review and the battery; the six deferred Minors are in `docs/HANDOVER-PENDING.md` §5.3 and
   plan `D-15`.
3. **Phase 22 — Stock control D2: FIFO lot consumption and costing, optional expiry, three report pages
   with exports, receipt documents, and the six D1 leftovers — IS MERGED TO `main` via
   `--no-ff` `26aaf82` AND PUSHED (2026-09-16; final tree `a4b57b5`, after the final-review fix wave);
   branch and worktree removed** (10 tasks, `D-1`…`D-20` — the final-review fix wave added
   `D-16`…`D-19`, the final battery `D-20`) —
   **Staging redeployed 2026-09-17 with `scripts/deploy-staging.ps1 -Force`: migration 23 applied (23 found;
   staging's stock tables were empty, so the backfill had nothing to convert), web healthy, the LAN URL
   answers. Nothing remains for this phase.** See §1's table above and `HANDOVER.md` (o) for
   what shipped and the battery; `docs/HANDOVER-PENDING.md` §5.1 is shipped, its requisition question
   decided no (2026-09-16).
4. **Phase 21 — Approvals oversight: direct IT changes made visible, plus five correctness and quality
   items — IS MERGED TO `main` via `--no-ff` `b716767` AND PUSHED (2026-09-15); branch and worktree
   removed** (8 tasks, `D-1`…`D-16` — the final-review fix wave added `D-11`…`D-13`, the final
   battery `D-15` and `D-16`; final tree `2ae8738`) — **staging redeployed the same day with `scripts/deploy-staging.ps1 -Force`; migration 22
   applied, web healthy, the LAN URL answers. Nothing remains for this phase.** See §1's table above and `HANDOVER.md` (n) for what shipped and
   the battery.
5. **Phase 20 — IT side: transfers, offboarding attribution and facets, directory quality, six known
   gaps — IS MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10), including the final-review
   fix wave; branch and worktree removed** (9 tasks, `D-1`…`D-30` — the final-review fix wave added `D-23`…`D-29`, the
   final battery `D-30`; final tree `4d54382`) — **the staging redeploy (migrations 20 and 21 together, `scripts/deploy-staging.ps1 -Force`) is the
   user's decision, not pre-authorised.** See §1's table and `HANDOVER.md` (m) for what shipped, the final
   review's findings and the wave, and the battery.
   Once merged: Phase 19's migration 20 and Phase 20's migration 21 both apply on the same next
   `scripts/deploy-staging.ps1 -Force` redeploy (staging is still on the Phase 18 build). The parked
   Purchasing/stock work (D2, supplier and stock imports, the visual checks, deployment loose ends) stays
   in `docs/HANDOVER-PENDING.md`.
6. **Phase 19 — Stock control, part D1 (the ledger core) — is DONE, including the final-review fix
   wave** (9 tasks, `D-1`…`D-30` — the final-review fix wave added `D-21`…`D-30`; final tree `a185729`) —
   **merged to `main` via `--no-ff` `d311e26` and pushed (2026-09-10); branch and worktree removed; staging
   not yet redeployed.** Items and categories with an automatic code series, an append-only movement
   ledger (opening/receipt/issue/adjustment) with balances always derived (never stored), a blind-count
   stocktake with a variance review that posts real adjustments, a spreadsheet importer for items and
   opening stock, and a balances export, all under a new Stock area at `/stock` in the Purchasing
   workspace. One additive migration, **20** (`stock_control`). Spec
   `superpowers/specs/2026-09-09-stock-control-design.md`, plan
   `superpowers/plans/2026-09-09-phase-19-stock-control.md` (30 amendments, `D-1`…`D-30`). Battery at
   Task 9's close: `tsc`/`lint` clean, **1212 unit / 72 files**, **275 e2e / 23 files** by `--list` —
   five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 (3.3m) · 67 (3.9m) ·
   63 (4.0m) · 38 (2.6m) · 53 (7.3m) = 275**, zero failed, zero did-not-run on the first pass of every
   chunk. **After the final-review fix wave** (I-1..I-4, M-1..M-3, then R14 and the re-review minors; final tree `a185729`): `tsc`/`lint`
   clean, **1224 unit / 72 files** (12 new, RED before the fix / GREEN after), `stock.spec.ts` +
   `stocktake.spec.ts` **17/17 passed (1.6m)**, `--list` still **275 e2e / 23 files**. See the
   table in §1 above and `HANDOVER.md` (l) for what shipped. **What remains: redeploy staging with
   `scripts/deploy-staging.ps1 -Force` (migration 20 applies on start); D2 (FIFO costing, expiry, reports)
   is next (item 10 below); Purchasing's opening stock goes in through `/stock/import`.**
7. **Phase 18 — Purchasing: suppliers and request extensions — is DONE, including the
   final-review fix wave** — merged to `main` via `--no-ff` `d4b95bb` and pushed (2026-09-09), **branch and
   worktree removed; staging redeployed the same day with `-Force`, migration 19 applied**: a supplier master record (profile, contract, encrypted bank accounts, documents, search)
   under a new Suppliers area at `/purchases/suppliers`; a required department and an optional supplier on
   every purchase request, with list filters/columns and role-gated attachments; an asset's provenance
   (from a purchase request, registered directly, or a historical import) derived and shown everywhere —
   the inventory facet, the detail badge, the export and Finance columns. One additive migration, **19**.
   Spec `superpowers/specs/2026-09-08-purchasing-suppliers-design.md`, plan
   `superpowers/plans/2026-09-08-phase-18-purchasing-suppliers.md` (19 amendments, `D-1`…`D-19` — the
   final-review fix wave added `D-18`/`D-19`: archived suppliers left the inventory vendor pickers, and
   edit-save's toast-and-refresh vs. redirect behaviour was kept with spec §4.3 reworded to match).
   Battery: `tsc`/`lint` clean, **1113 unit / 64 files**, **258 e2e / 21 files** by `--list` (unchanged
   after the wave — see the table in §1 above and `HANDOVER.md` (k) for the fix wave's own 47/47 e2e run
   and what it changed).
8. **Deploy the prototype to the staging laptop and let Purchasing and Finance use it.** Chosen by the user
   on 2026-09-07 as the next step before any more features. The ordered checklist is
   [`staging-run-sheet.md`](staging-run-sheet.md) (also delivered as a PDF). It hinges on one decision only
   the user can make — **which machine owns the reserved address `192.168.203.183`** (the laptop was renumbered from `.153` on 2026-09-21; `.env` and this file follow), or whether to use a
   DNS name instead — because that value is printed onto every label. Physical steps nobody else can do:
   the UniFi DHCP reservation, the phone reachability test, the printed sheet (tape-measure the 100 mm bar,
   scan one QR).
9. **Two visual checks never done by a human:** the inventory class-switch chips and Finance's IT/Purchasing
   tabs by eye, and the Register form signed in as `purchasing@`. Both are asserted by e2e and axe, never
   looked at.
10. **Remaining candidates**, in value order (**Phase 16 delivered the fourth item this list used to
   carry — a real `Asset.loanDueAt` for TEMPORARY loans, no longer a 30-day proxy — so it's dropped here**):
   - The **depreciation module** (user's choice, own brainstorm).
   - **Purchasing bulk import**.
   - ~~The Replace dialog's headerless **"other spares" list** when no same-type spare exists.~~ **Closed
     in Phase 20 (gap 4):** every Replace option now carries a "Same type" / "Other spare" note.
11. **The §9 subsystems from the Admin meeting — B and C shipped in Phase 18; D's first half (D1) shipped
   in Phase 19 (item 6 above); D2 shipped in Phase 22 (merged `26aaf82`, item 3 above).** Vendor master data (B)
   and purchasing workflow extensions (C) are code-complete on `phase-18-purchasing-suppliers`, merged.
   **D1 · stock control** (items, the ledger, derived balances, stocktake, import) is merged to `main`
   (`d311e26`, 2026-09-10; on staging since the 2026-09-10 redeploy). **D2 · FIFO costing, expiry warnings, report
   views and exports by department and month** shipped in Phase 22 as stock control D2 —
   merged to `main` via `--no-ff` `26aaf82` and pushed 2026-09-16 (`HANDOVER.md` §9, item 3 above).

## 5. Known gaps to keep in view

- **No HTTPS** on the LAN; on-site only; one machine, no failover. Acceptable for the prototype, written up in
  the run sheet.
- `SEED_PASSWORD` is the only credential on staging until the seeded accounts' passwords are changed.
- Two server-side gates are unreachable from the UI and covered by the database trigger and review only:
  a wrong-class register request and a mixed-class bulk request (`D-13`); likewise `updateAsset`'s
  cross-class guard (`D-15`).
- `/audit` and `/inventory/activity` exclude invisible assets by id list — fine while the Purchasing fleet is
  small; revisit if it grows past a few thousand rows.
- `/audit` excludes only `asset` rows of the other class; `approval`, `asset-category` and `asset-type` rows
  about Purchasing objects still appear for IT with resolved labels (spec §3.1 asked for asset rows only).
- `resubmitAssetToFinance`'s `canManageClass` refusal is no longer reachable from e2e (IT now gets not-found
  on a Purchasing record), like D-13/D-15's gates — server guard unchanged, review-covered.
- **Answered in Phase 21 —** Direct IT changes leave no PENDING row, so the record's pending banner and `Open requests` stat only ever show Purchasing or legacy approvals for IT devices. Not built as a pending row (Phase 15's choice stands): oversight instead — `Approval.appliedDirectly` (migration 22), the Closed tab's route chips and `via` filter, and an admin Home section totalling the last 7 days by kind and by person.
- Phase 15 changed Home dismissal keys from `KIND:id` to `section:id`, so dismissals made earlier on deploy day reappear until cleared again — one-day effect.
- Backups land on the same disk as the data; copy them off periodically.
- **Closed in Phase 20 — `checkIdentifiers` (Phase 16) leaks existence across classes.** The live duplicate check queries the whole `Asset` table regardless of `cls`, so IT registering a laptop can learn that a tag or serial is "already registered" even when the matching row is a Purchasing asset IT cannot otherwise see — accepted, since it only ever confirms existence, never any detail of the other class's row. Phase 20 §6 gap 2: `checkIdentifiers({ tags, serials, cls })` now queries `where: { cls }` only, and the register/asset forms pass the class they render for (skipping the live check entirely until a category names one) — a cross-class collision surfaces only as the pre-existing neutral P2002 conflict copy at submit.
- **Closed in Phase 20 — `bulkChangeStatus` still returns a bare `{ changed, skipped }` count**, unlike the new `bulkAssign` (Phase 16), which names which tags it skipped and why. Spec §10 puts changing `bulkChangeStatus`'s return shape explicitly out of scope for this phase. Phase 20 §6 gap 1: `bulkChangeStatus` now returns `{ changed, skipped: Array<{ tag, reason }> }` with the same named reasons `bulkAssign` uses, and the bulk drawer renders the skipped list the same way for both.
- **Signing-date tolerance (Phase 16, plan `D-13`) is a one-day window, not true local-timezone awareness:** the server refuses only a date later than the UTC date of `now + 1 day`, so a signing date genuinely one day in the future (not just "tomorrow" at 03:00 PHT) would also be accepted. Traded deliberately — a wrong refusal at local midnight was worse than the one-day slack.
- **Closed in Phase 20 — the loaner rule (Phase 16 §3.3, spec decision 8) reads a standard slot as "missing" from deploy day on, if it is filled by a device on loan.** `computeLoadout` now matches a standard (non-loaner) slot only to a non-`TEMPORARY` asset, so a person whose only device of a type is on loan shows that slot empty and missing — intended (a loan is not a permanent fill), not a regression; visible in `it-core.spec.ts`'s "list shows loadout gaps" count moving from 1 to 2 missing once one seeded holder's device turned out to be `TEMPORARY`. Phase 20 §6 gap 3: `computeLoadout` now marks such a slot `coveredByLoan` (the device stays in `onLoan`, uncounted) and excludes it from `missingRequired`, so the tile reads "on loan" instead of a policy gap — Marites Bautista's count in `it-core.spec.ts` moved back from 2 to 1 missing.
- **Closed in Phase 24 — the repair-stage saved view and the `gaps=1` facet counts were deliberately left untouched by Phase 17.** The plan's Global Constraints named both as "behaviour that must not change": the repair-stage view (`?stage=&down=`) still grouped DEFECTIVE assets in memory rather than in SQL, and the employees list's facet counts under `gaps=1` are computed the same way they were before that phase. Both remained by decision, not oversight. **Phase 24 closed the first half:** the stage cut itself has run in SQL since Phase 20 (`REPAIR_STAGE_CASE_SQL`, `repairStageIds`), and `listAssets` now pages that id set through `pagedSnapshot`'s count/skip/take instead of loading every repair-candidate row with its includes and slicing the array — so the repairs view is an ordinary paged list. The `gaps=1` facet counts are unchanged and stay open, as do the assets-side stage facet counts, which spec §0 decision 5 deliberately left on the candidate set.
- **Closed in Phase 24 — webhook delivery rows have no retention policy.** Phase 17 paginated the admin deliveries list (Task 4), but nothing pruned old `WebhookDelivery` rows — the table grew without bound. **Phase 24's worker now deletes `DELIVERED`/`DEAD` deliveries (by `createdAt`) and `DONE`/`DEAD` jobs (by `updatedAt`) older than 90 days**, in id batches of 1000, once after `recoverStale` at start and hourly thereafter; a prune failure is logged and the loop carries on. `npm run worker:prune` runs a single pass by hand, and the deliveries page states the rule from the same constant. Live rows (`PENDING`, `RETRYING`, `RUNNING`, `FAILED`) are never touched, and the policy is the constant in `src/lib/retention.ts`, not an admin setting.
- **The merged-timeline cursor's `skip` URL parameter is clamped.** Flagged during Phase 17 (plan `D-8`'s fix) as unclamped; closed in the final-review fix wave (plan `D-11`): `parseTimelineCursor` now clamps `skip` to `TIMELINE_MAX_SKIP = 1_000` on the way in, so a hand-edited URL can no longer inflate `mergeTimeline`'s per-source `take = limit + 1 + skip`. No longer a follow-up.

## 6. If you are an assistant reading this

Start with this file, then `HANDOVER.md` §0. Follow §3 above as standing instructions. Before proposing
work, check `HANDOVER.md` §8 and §9 for what is deferred and why. Do not merge or push without being asked,
do not seed a database people are using (the seed truncates every table), and when a plan and the code
disagree, the code wins and the plan gets amended.
