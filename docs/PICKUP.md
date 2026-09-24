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
| Branch | `main`, **level with `origin/main`** after the Phase 31 push (merge `bcc7b16`, 2026-09-24, plus its merge-docs commit; final tree `7599d9e`, docs `3d477c0`, tree hashes matched, branch and worktree removed; no migration; record `HANDOVER.md` (x)) — before it, the Phase 30 push (merge `69f8545`, 2026-09-24, plus its merge-docs commit; the same push carried the docs commits `a94f47a` and `b582535`) — before it, the Phase 29 push (merge `d76903b`, 2026-09-23, plus its merge-docs commits; the same push carried the docs commits `401b838` and `1acd928`) — count with `git rev-list --count origin/main..main` before trusting this. Phase branches (`phase-10-polish` … `phase-14-department-owned-classes`) exist only on the old dev laptop; `phase-15-direct-it-lifecycle`, `phase-16-registration-custody`, `phase-17-scale-sweep`, `phase-18-purchasing-suppliers` and `phase-19-stock-control` were merged and deleted on the staging laptop. All are fully contained in `main`. **`phase-20-it-people-and-gaps` (final tree `4d54382`, after the final-review fix wave) IS MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10)** (9 tasks, `D-1`…`D-30`; battery in the table below); the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. **Staging runs the Phase 26 merge** (`e96fb2a`) since the 2026-09-22 forced redeploy, which applied migration 25 (the two 2026-09-21 redeploys carried Phase 24 `48c37f7` and then Phase 25 `5727572`, both code-only; 24 was applied by the second 2026-09-17 redeploy, 23 came with the first 2026-09-17 redeploy, 22 with the 2026-09-15 one, 20 and 21 with the 2026-09-10 one, 19 with the 2026-09-09 one, 16–18 with the two 2026-09-08 ones) — `-Force` is needed whenever the merge happened on this laptop, because the plain run sees nothing new and skips. **`phase-21-approvals-oversight` (final tree `2ae8738`, after the final-review fix wave and ruling R7's Manila-date fix) IS MERGED TO `main` via `--no-ff` `b716767` AND PUSHED (2026-09-15) — 8 tasks, `D-1`…`D-16` — the final-review fix wave added `D-11`…`D-13`, the final battery `D-15` and `D-16`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed.** The push also carried `8817488`, the Phase 21 spec-and-plan docs commit that had sat on local `main` since 2026-09-14. **`phase-22-stock-control-d2` (final tree `a4b57b5`, after the final-review fix wave) IS MERGED TO `main` via `--no-ff` `26aaf82` AND PUSHED (2026-09-16) — 10 tasks, `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed.** The push also carried `935595e` and `0c4d103`, the Phase 22 spec-and-plan docs commits that had sat on local `main` since earlier that day. Nothing remains for Phase 22. **`phase-23-parkinson-sweep` (final tree `09bf0a5`, after the final-review fix wave and one test-only battery fix) IS MERGED TO `main` via `--no-ff` `18228b0` AND PUSHED (2026-09-17) — 10 tasks, `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed.** The push also carried `39f73a3` and `8b2dfd7`, the Phase 23 spec-and-plan docs commits that had sat on local `main` since earlier that day. Nothing remains for Phase 23. **`phase-24-it-gaps-2` (final tree `7601cab`, after the final-review fix wave; docs `40a11b6`) IS MERGED TO `main` via `--no-ff` `48c37f7` AND PUSHED (2026-09-21)** — 6 tasks, `D-1`…`D-10`; battery in the table below; the merged tree equals the tested tip except the three lines of the same-day IP renumbering commit `efd6d9e`; branch and worktree removed. The push also carried the two Phase 24 docs-only commits `0aeb8ce` (spec) and `32e6959` (plan) that had sat on local `main` since 2026-09-17, plus `efd6d9e`. Nothing remains for Phase 24 beyond the parked items in §5. **`phase-25-it-navigation-sweep` (IT navigation sweep; final tree `fab0780` after the final-review fix wave, docs `641e96f`) IS MERGED TO `main` via `--no-ff` `bb577f8` AND PUSHED (2026-09-21)** — 8 tasks, `D-1`…`D-12`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. It adds **no migration**, so the staging redeploy that carries it is a code-only `scripts/deploy-staging.ps1 -Force`. Local `main` also carries three docs-only commits beyond `origin/main` `a9970ad`, themselves unpushed: `9dd7ba5` and `98a94a1` (the Phase 25 spec and its corrections) and `5acb5fd` (the plan). **`phase-26-holds-and-repair-end` (holds that work + the repair end-date; final tree `1442289` after the final-review fix wave, docs `6175af3`) IS MERGED TO `main` via `--no-ff` `a5883ad` AND PUSHED (2026-09-22)** — 6 tasks, `D-1`…`D-10`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. The push also carried the two Phase 26 docs-only commits `2bed93b` (spec) and `611d91f` (plan and spec corrections) that had sat on local `main` since 2026-09-21. Unlike the last two phases it is **not** code-only: it adds **migration 25** `repair_end_and_holds` — **applied on staging by the 2026-09-22 `-Force` redeploy** (25 found, all applied; web healthy; local and LAN `/login` 200). Nothing remains for Phase 26 beyond the parked items in §5. **`phase-27-leftovers-sweep` (IT and quality leftovers sweep; final tree `66445ed` after the final-review fix wave, docs `0abf560`) IS MERGED TO `main` via `--no-ff` `5dd3372` AND PUSHED (2026-09-22)** — 7 tasks, `D-1`…`D-10`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. The push also carried the two Phase 27 docs-only commits `385b484` (spec) and `8c24c3b` (plan) that had sat on local `main` since 2026-09-22. Unlike Phases 24 and 25 it is not code-only: it adds **migration 26** `case_insensitive_names`, so it waited for the **2026-09-23 `-Force` redeploy (`ccb0432`), which applied that migration after the duplicate check in the Database row below returned no rows.**`phase-28-back-control` (a Back control on every page that has a parent; final tree `5a8bbcf` = product commit `ad39271` plus the e2e fix round, docs `e8b48a4`) IS MERGED TO `main` via `--no-ff` `7214066` AND PUSHED (2026-09-22)** — the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed; the staging redeploy is the user's decision, not pre-authorised. It is a bounded change with no spec and no plan document (design and rulings: `HANDOVER.md` (u)) and it adds **no migration**; it rode the 2026-09-23 `-Force` redeploy, which also applied Phase 27's migration 26. `main` was level with `origin/main` `67f4e9e` after the Phase 28 push (the merge plus its merge-docs commit) — count with `git rev-list --count origin/main..main` before trusting this **`phase-29-employee-uiux` (Laws of UX applied to the employee area; final tree `9660e6e` after the final-review fix wave, docs `e01923a`) IS MERGED TO `main` via `--no-ff` `d76903b` AND PUSHED (2026-09-23)** — 8 tasks, `D-1`…`D-16`; battery in the table below; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. The push also carried the two Phase 29 docs-only commits `401b838` (spec) and `1acd928` (plan) that had sat on local `main` since 2026-09-22. It adds **no migration** (26 stays); it rode the 2026-09-23 `-Force` redeploy (staging runs `ccb0432`). **`phase-30-inventory-uiux` (Laws of UX applied to the inventory area; final tree `4e6fc7f` after the final-review fix wave, docs `bba0f6c`) IS MERGED TO `main` via `--no-ff` `69f8545` AND PUSHED (2026-09-24)** — 9 tasks, `D-1`…`D-16`; battery in the table below; the record is `HANDOVER.md` (w); the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. It adds **no migration** (26 stays); **staging was REDEPLOYED 2026-09-24** with a code-only `-Force` (runs `e07bef7`, 26 migrations, none pending). |
| Stack | Next.js 15 App Router · Prisma 6 · PostgreSQL 16 (Docker) · Auth.js v5 · Tailwind v4 · Playwright · vitest. Node ≥ 22, npm ≥ 11 (dev machine ran Node 24). |
| Database | **26 migrations on `main` and on staging** since the 2026-09-23 `-Force` redeploy (`ccb0432`): Phase 27's migration 26 `20260922010908_case_insensitive_names` applied after the seven-statement duplicate check at the end of this row returned no rows (11 categories, 19 types, 5 departments, 1 policy, 2 vendors, 0 stock categories). Before it: **25 migrations** on `main` and on staging since the 2026-09-22 redeploy (migration 25 `repair_end_and_holds`, see below; migration 24 `parkinson_deadlines`: additive — `Employee.offboardingDueAt` and `Stocktake.dueAt` added nullable, a plain `IS NULL`-guarded SQL backfill gives every OFFBOARDING employee `offboardingAt + 7` days and every stocktake `openedAt + 3`, then `SET NOT NULL` on the stocktake column; applied on `inventory_dev`, **24 found, schema up to date**). **staging reached 24** with the second 2026-09-17 forced redeploy (its one OFFBOARDING employee gained a complete-by date of start + 7 d, already past — overdue by design; it had no stocktakes). Migration 23 `stock_lots_and_allocations` (merged 2026-09-16, asserted plpgsql backfill of D1's history) reached staging in the first 2026-09-17 redeploy with empty stock tables. **Phase 24 adds no migration** — it deletes rows rather than modelling anything new, so `phase-24-it-gaps-2` is still 24 found / schema up to date, and the redeploy that carries it is a code-only `-Force`. **Phase 25 adds no migration** either — the IT navigation sweep is links, a server action and safety nets, nothing new in the schema — so `phase-25-it-navigation-sweep` is still 24 found / schema up to date, and the redeploy that carries it is a code-only `-Force`. **Phase 26 adds migration 25** `repair_end_and_holds` — additive: one nullable `Asset.repairEndedAt` column plus a commented backfill that fills it only where an audit row actually moved a status off DEFECTIVE (it invents nothing). Applied on `inventory_dev`: **25 found, schema up to date**. So `main` is at **25 migrations** since the Phase 26 merge (`a5883ad`, 2026-09-22) and **staging is at 25 too** since the 2026-09-22 `-Force` redeploy (the backfill filled `repairEndedAt` on one of staging's two closed repairs; the other has no audit transition and keeps its dash). **Phase 27 adds migration 26** `case_insensitive_names` — additive: one ordinary index on `AuditEntry ("entityType", "action")` for the activity feeds' Action facet, plus seven `lower()` UNIQUE indexes (`AssetCategory_name_lower_key`, `AssetType_category_name_lower_key` scoped by `"categoryId"`, `Department_name_lower_key`, `EquipmentPolicy_name_lower_key`, `Vendor_name_lower_key`, `StockCategory_name_lower_key`, `StockCategory_prefix_lower_key`). Applied on `inventory_dev`: **26 found, schema up to date**. It **FAILS LOUDLY** on a database that already holds two names differing only by case, leaving the schema unchanged — so **run this on the target database before any redeploy that applies it, and expect zero rows from each of the seven statements**: `select 'AssetCategory', lower(name), count(*) from "AssetCategory" group by 2 having count(*) > 1;` and the same shape for `"AssetType"` grouped by `("categoryId", lower(name))` (`group by 2, 3`), `"Department"`, `"EquipmentPolicy"`, `"Vendor"`, `"StockCategory"` by `lower(name)` and `"StockCategory"` by `lower(prefix)`. The full block is in `HANDOVER.md` (t). Staging was checked clean on 2026-09-22 (11 categories, 19 types, 5 departments, 1 policy, 2 vendors, 0 stock categories), but it is a live database — run the check again at the redeploy rather than trusting this line. **Phase 28 adds no migration** — the Back control is a component, a client tracker and a `sessionStorage` helper, nothing new in the schema — so `phase-28-back-control` is still **26 found, schema up to date**, and the redeploy that carries it is a code-only `-Force` (which would nonetheless apply Phase 27's pending migration 26, so run the check above first). `prisma migrate reset` is **not** used in this project. |
| Battery, last run 2026-09-24 (Phase 31 final tree `7599d9e`, `phase-31-leftovers-sweep`, **merged to `main` as `bcc7b16` and pushed 2026-09-24**, after the final-review fix wave) | `tsc` clean · `lint` clean · **26 migrations**, schema up to date (**this phase adds none**) · **1634 unit / 96 files** · **413 e2e / 40 files** by `--list`. The same seven foreground chunks, composition unchanged apart from the new `e2e/leftovers.spec.ts` joining **D**, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 58 · B 67 · C 64 · D 56 · E1 46 · E2 56 · F 66 = 413 / 413**. Chunk C's first pass failed on `net::ERR_NETWORK_IO_SUSPENDED` (the laptop's network suspended mid-run) and ran into the global timeout; the as-is re-run was 64 passed (4.3m), no code touched. `npm run db:seed` ran last, clean; port 3100 free before, between and after every chunk. Record: `HANDOVER.md` (x). |
| Battery, last run 2026-09-23 (Phase 30 final tree `4e6fc7f`, `phase-30-inventory-uiux`, **merged to `main` as `69f8545` and pushed 2026-09-24**, after the final-review fix wave) | `tsc` clean · `lint` clean · **26 migrations**, schema up to date (**this phase adds none**) · **1624 unit / 95 files** · **409 e2e / 39 files** by `--list`. Task 9's close ran the same seven foreground chunks, composition unchanged apart from the new `e2e/inventory-ux.spec.ts` joining **E2**, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 58 passed (3.7m) · B 67 passed (4.1m) · C 64 passed (4.2m) · D 52 passed (3.9m) · E1 46 passed (6.6m) · E2 56 passed (4.9m) · F 66 passed (6.8m) = 409 / 409**, zero failed, zero flaky, zero skipped, zero did-not-run, no re-run needed. Twenty cases are new: the 13 of `e2e/inventory-ux.spec.ts`, four in `it-core` (A 54 → 58), two in `registration` (D 50 → 52) and one in `back` (E2 42 → 56 with the new file). `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; the design, the sixteen rulings and what ships knowingly: `HANDOVER.md` (w). |
| Battery, last run 2026-09-22 (Phase 29 final tree `9660e6e`, `phase-29-employee-uiux`, **merged to `main` as `d76903b` and pushed 2026-09-23**, after the final-review fix wave) | `tsc` clean · `lint` clean · **26 migrations**, schema up to date (**this phase adds none**; `main` carries 26 since the Phase 27 merge, staging stays at 25 until that migration's redeploy) · **1556 unit / 90 files** · **389 e2e / 38 files** by `--list`. Task 8's close ran the same seven foreground chunks Phase 23 introduced, composition unchanged apart from the new `e2e/employee-ux.spec.ts` joining **E1**, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.4m) · B 67 passed (4.1m) · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 46 passed (6.6m) · E2 42 passed (4.1m) · F 66 passed (6.8m) = 389 / 389**, zero failed, zero skipped, zero did-not-run. **One flake:** chunk B's first pass was 66 passed / 1 failed (4.4m) on `e2e/asset-classes.spec.ts:499` (“21. names Purchasing, points at the Register screen, and admin can follow the fix”); the as-is re-run was 67 passed (4.1m), so no product or test code was touched and there is no test-only fix commit in this battery. Only E1's count moved, 37 → 46, for the nine new `e2e/employee-ux.spec.ts` cases. `npm run db:seed` ran last, clean — it also removed the throwaway rows EMP-9801 / EMP-9802 a Task 5 fix-round click-through had created in `inventory_dev`; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; the design, the sixteen rulings and the post-merge hygiene list: `HANDOVER.md` (v). |
| Battery, last run 2026-09-22 (Phase 28 final tree `5a8bbcf`, `phase-28-back-control`, **merged to `main` as `7214066` and pushed 2026-09-22**, after the review's one fix round) | `tsc` clean · `lint` clean · **26 migrations**, schema up to date (**this phase adds none**; `main` carries 26 since the Phase 27 merge, staging stays at 25 until that migration's redeploy) · **1532 unit / 88 files** · **380 e2e / 37 files** by `--list`. Task 2's close ran the same seven foreground chunks Phase 23 introduced, composition unchanged apart from the new `e2e/back.spec.ts` joining **E2**, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.4m) · B 67 passed (4.0m) · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 37 passed (5.9m) · E2 42 passed (4.1m) · F 66 passed (6.7m) = 380 / 380**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first pass — no chunk re-run, and no test-only fix commit in the battery. Only E2's count moved, 39 → 42, for the three new `e2e/back.spec.ts` cases. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; the design, the two rulings and what stays parked: `HANDOVER.md` (u). |
| Battery, last run 2026-09-22 (Phase 27 final tree `66445ed`, `phase-27-leftovers-sweep`, **merged to `main` as `5dd3372` and pushed 2026-09-22**, after the final-review fix wave) | `tsc` clean · `lint` clean · **26 migrations**, schema up to date (migration 26 `case_insensitive_names` is this phase's; `main` now carries it, staging stays at 25 until the redeploy) · **1528 unit / 87 files** · **377 e2e / 36 files** by `--list`. Task 7's close ran the same seven foreground chunks Phase 23 introduced, composition unchanged apart from the new `e2e/activity.spec.ts` joining **E2** (plan P-6 — the first phase to grow E2 rather than F), `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.5m) · B 67 passed (3.9m) · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 37 passed (5.8m) · E2 39 passed (3.6m) · F 66 passed (6.6m) = 377 / 377**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first pass — no chunk re-run, and no test-only fix commit in the battery. Thirteen cases are new: `e2e/activity.spec.ts` (7) plus admin +3, approvals-audit +1, stock +1 and suppliers +1, so 364 → 377 and E2 moved 31 → 39. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the six rulings, the ten plan decisions and the fix wave: `HANDOVER.md` (t). |
| Battery, last run 2026-09-21 (Phase 26 final tree `1442289`, `phase-26-holds-and-repair-end`, **merged to `main` as `a5883ad` and pushed 2026-09-22**, after the final-review fix wave) | `tsc` clean · `lint` clean · **25 migrations**, schema up to date (migration 25 `repair_end_and_holds` is this phase's; `main` and staging both carry it since the 2026-09-22 redeploy) · **1511 unit / 85 files** · **364 e2e / 35 files** by `--list`. Task 6's close ran the same seven foreground chunks Phase 23 introduced, composition unchanged apart from the new `e2e/holds.spec.ts` joining F, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.5m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47 passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed (3.0m) · F 66 passed (6.6m) = 364 / 364**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first pass — no chunk re-run, and no test-only fix commit in this phase. Only F's count moved, 55 → 66, for the eleven new `e2e/holds.spec.ts` cases. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the five rulings and the fix wave: `HANDOVER.md` (s). |
| Battery, last run 2026-09-21 (Phase 25 final tree `fab0780`, `phase-25-it-navigation-sweep`, **merged to `main` via `--no-ff` `bb577f8` and pushed 2026-09-21**, after the final-review fix wave) | `tsc` clean · `lint` clean · **24 migrations**, schema up to date (this phase adds none) · **1493 unit / 84 files** · **353 e2e / 34 files** by `--list`. Task 8's close ran the same seven foreground chunks Phase 23 introduced, composition unchanged apart from the new `e2e/it-nav.spec.ts` joining F, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.4m) · B 67 passed (4.0m) · C 63 passed (4.1m) · D 47 passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed (3.0m) · F 55 passed (5.6m) = 353 / 353**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first pass — no chunk re-run, and no test-only fix commit in this phase. Only F's count moved, 42 → 55, for the thirteen new `e2e/it-nav.spec.ts` cases. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the four rulings and the fix wave: `HANDOVER.md` (r). |
| Battery, last run 2026-09-17 (Phase 24 final tree `7601cab`, `phase-24-it-gaps-2`, **merged to `main` via `--no-ff` `48c37f7` and pushed 2026-09-21**, after the final-review fix wave) | `tsc` clean · `lint` clean · **24 migrations**, schema up to date (this phase adds none) · **1485 unit / 84 files** · **340 e2e / 33 files** by `--list`. Task 6's close ran the same seven foreground chunks Phase 23 used, composition unchanged (it-gaps stays in F), `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47 passed (3.5m) · E1 36 passed (5.7m) · E2 31 passed (3.1m) · F 42 passed (4.4m) = 340 / 340**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first pass — no chunk re-run, and no test-only fix commit in this phase. Only F's count moved, 39 → 42, for the three new `e2e/it-gaps.spec.ts` cases. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the four rulings and the fix wave: `HANDOVER.md` (q). |
| Battery, last run 2026-09-17 (Phase 23 final tree `09bf0a5`, `phase-23-parkinson-sweep`, the tree merged as `18228b0`, after the final-review fix wave) | `tsc` clean · `lint` clean · **24 migrations**, schema up to date · **1476 unit / 82 files** · **337 e2e / 33 files** by `--list`. Task 10's close ran seven foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000` — Phase 22's seven with `e2e/quick-forms.spec.ts` added to chunk D and `e2e/deadlines.spec.ts` to chunk F: **A 54 passed (3.4m) · B 67 passed (5.8m) · C 63 passed (5.9m) · D 47 passed (4.7m) · E1 36 passed (8.9m) · E2 31 passed (4.1m) · F 39 passed (4.8m) = 337 / 337**, zero failed, zero did-not-run. One test-only fix, `09bf0a5`: chunk B's first pass on `dbc93a0` was **64 passed, 2 failed, 1 did not run**, reproduced identically on an immediate as-is re-run, and both failures were one bug — `e2e/department-owned.spec.ts` case 9's duplicate create relied on the new-employee form's old auto-defaulted department, which this phase deliberately replaced with a blank "Choose a department", and because that case sits in a `test.describe.serial` its failure retires the worker, so the file's `beforeAll` reseed ran again before case 11 and left Purchasing Home reading Approvals 1 / Below reorder level 1 / Expiring within 30 days 1 — three exact matches for that case's `getByRole("link", { name: "1", exact: true })`. Chunk B then ran 67/67 and chunk A was re-run on the final tree, so every number above is post-fix. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the nine rulings and the fix wave: `HANDOVER.md` (p). |
| Battery, last run 2026-09-16 (Phase 22 final tree `a4b57b5`, `phase-22-stock-control-d2`, the tree merged as `26aaf82`, after the final-review fix wave) | `tsc` clean · `lint` clean · **23 migrations**, schema up to date · **1404 unit / 79 files** · **319 e2e / 31 files** by `--list`. Task 10's close (branch tip `dfb1a0f`, 2026-09-16) ran seven foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000` (chunk E split into E1/E2 per spec §9.3, since the combined chunk would have carried 67 tests): **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.7m) · E1 36 passed (5.6m) · E2 31 passed (3.0m) · F 30 passed (3.2m) = 319 / 319**, zero failed, zero did-not-run, all first pass, no re-run needed anywhere in the battery, **1404 unit / 79 files**. The final review's fix wave (`2eeabf7`, `D-16`…`D-19`) was verified with `tsc` (clean) and a scoped `vitest run src/lib/stock-allocation.test.ts` (24 passed), plus a scoped re-review — ADDRESSED all four findings, 0 new; the full seven-chunk battery then ran on `2eeabf7`: chunks B–F and E1/E2 passed clean on the first try, but chunk A failed once — `e2e/it-core.spec.ts:302`'s documents-upload PNG-rejection case, 53 passed/1 failed, reproduced identically on an immediate as-is re-run, diagnosed as a pre-existing hydration-race gap (the file's own `waitForHydration()` helper was wired to only one of its two upload call sites) — fixed test-only (`a4b57b5`), verified in isolation, then chunk A re-ran 54 passed/0 failed. **The whole battery then re-ran on the final tree `a4b57b5`: A 54 passed (3.3m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E1 36 passed (5.7m) · E2 31 passed (3.1m) · F 30 passed (3.3m) = 319 / 319**, zero failed, zero did-not-run, all first pass, no further fix commits, **1404 unit / 79 files** (unchanged). `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped and what the fix wave/final battery found: `HANDOVER.md` (o). |
| Battery, last run 2026-09-15 (Phase 21 final tree `2ae8738`, `phase-21-approvals-oversight`, the tree merged as `b716767`, after the final-review fix wave and ruling R7's Manila-date fix) | `tsc` clean · `lint` clean · **22 migrations** · **1317 unit / 77 files** · **305 e2e / 29 files** by `--list`. Task 8's close (branch tip `562587f`, 2026-09-14) ran six foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.4m) · F 30 passed (3.3m) = 305 / 305**, zero failed, zero did-not-run, **1312 unit / 77 files**. The final review's fix wave (`b6b4e2a`, ruling R6, `D-11`/`D-12`) re-ran `tsc`/`eslint`/`vitest` (**1314 unit / 77 files**) and a scoped re-review, both clean; the full six-chunk battery on `b6b4e2a` then reproduced chunk F's `transfers.spec.ts` UTC-midnight failure at 01:00 Manila (Phase 20's parked M-5) — **25 passed, 1 failed, 4 did not run**, chunks A–E green — before ruling R7 (`D-15`) fixed it in product code (`localDateISO`, the dialog/schema, `isRecentTransfer`'s one-day grace, and the spec's own "tomorrow"). **The whole battery then re-ran on the final tree `2ae8738`: A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.6m) · E 53 passed (7.4m) · F 30 passed (3.2m) = 305 / 305**, zero failed, zero did-not-run, all first pass, no further fix commits, **1317 unit / 77 files**. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. Commands and history: `HANDOVER.md` §0 item 9; what shipped and what the fix wave/final battery found: `HANDOVER.md` (n). |
| Battery, last run 2026-09-10 (Phase 20 final tree `4d54382`, `phase-20-it-people-and-gaps`, unmerged, after the final-review fix wave) | `tsc` clean · `lint` clean · **21 migrations** · **1295 unit / 75 files** · **296 e2e / 27 files** by `--list`. Task 9's close (branch tip `f6ec5e1`) ran six foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.3m) · B 67 passed (3.9m) · C 68 passed (4.4m) · D 38 passed (2.6m) · E 53 passed (7.3m) · F 21 passed (2.0m) = 301 run / 296 unique** (chunk C's file argument was the bare pattern `offboarding`, which also matched `offboarding-v2.spec.ts`), zero failed, zero did-not-run on the runs recorded. Chunks A, C and D each failed a first pass on a stale pre-Phase-20 e2e expectation, were reproduced once as-is, fixed in their own commit (`fe4295c`, `63df64a`, then `0b463b1` and `f6ec5e1` for chunk D's two), and re-ran clean; chunks B, E, F passed clean first try. The final-review fix wave re-ran `directory.spec.ts` (5 passed, twice), `it-gaps.spec.ts` (6 passed, twice), `transfers.spec.ts` (5 passed), `import-export.spec.ts` (21 passed) and `paging.spec.ts` (12 passed) — `--list` still **296 / 27**, unchanged. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the final review's findings and the wave: `HANDOVER.md` (m). **The whole battery then re-ran on the final tree `4d54382` with explicit file paths throughout, not the bare pattern above: A 54 passed (3.4m) · B 67 passed (3.8m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.3m) · F 21 passed (2.0m) = 296 / 296**, zero failed, zero did-not-run (chunk A's first pass was 53 + 1 failed on `it-core.spec.ts:302`, a `toBeVisible` 5 s timeout, not reproduced on an immediate re-run — the cold-compile/headroom class §7 documents). |
| Battery, last run 2026-09-09 (Phase 19 final tree `a185729`, `phase-19-stock-control`, unmerged) | `tsc` clean · `lint` clean · **20 migrations** · **1224 unit / 72 files** · **275 e2e / 23 files** by `--list`. Task 9's close ran five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 passed (3.3m) · 67 passed (3.9m) · 63 passed (4.0m) · 38 passed (2.6m) · 53 passed (7.3m) = 275 / 275**, zero failed, zero did-not-run; the fix wave re-ran only `stock.spec.ts` + `stocktake.spec.ts` — **17/17 passed (1.6m)**, `--list` still **275/23** unchanged. Commands and history: `HANDOVER.md` §0 item 9; what shipped and what the wave fixed: `HANDOVER.md` (l). **The whole battery then re-ran on the final tree after the fix wave, ruling R14 and the re-review minors: 54 (3.4m) · 67 (3.8m) · 63 (4.0m) · 38 (2.5m) · 53 (7.1m) = 275 / 275**, zero failed, zero did-not-run (chunks A and B on `ad19921`, C–E on `a185729`; the delta between them is a comment, a test title and one e2e assertion). |
| Battery, earlier full run 2026-09-09 (Phase 18 final tree `3298abf`, the tree merged as `d4b95bb`) | `tsc` clean · `lint` clean · **19 migrations** · **1113 unit / 64 files** · **258 e2e / 21 files** by `--list`. Five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 passed (3.3m) · 67 passed (3.9m) · 63 passed (4.0m) · 38 passed (2.5m) · 36 passed (5.6m) = 258 / 258**, zero failed, zero did-not-run (Task 10's 74-test last chunk was split in two to fit the ten-minute foreground cap). Commands and history: `HANDOVER.md` §0 item 9. |
| Last two phases | **Phase 30** — Laws of UX applied to the inventory area, all three screens in one phase (55 of the 57 audit findings, two parked with a home). The record gained a **state-chosen primary** (Return on a held device) with **Edit kept visible** and a ⋯ More menu, controlled dialogs that name device and person, Change status offering only legal targets and Edit on its own route; **one Register flow** replaced the two create paths (`/inventory/new` redirects), with a loan date and holder at quantity 1, pasted serial columns, live linked checks and every error at once; the list opens on the role's own class and gained attention markers with an **Attention sort**, holder search, a single Purchased facet and a ⋯ **row menu**, and the shared Menu now renders in a portal so no table clips it. Spec `docs/superpowers/specs/2026-09-23-inventory-ux-design.md` (`a94f47a`), plan `docs/superpowers/plans/2026-09-23-phase-30-inventory-ux.md` (`b582535`) — 9 tasks, `D-1`…`D-16` (the sixteen rulings R1–R16; the final review's four Importants closed by the fix wave `4e6fc7f`). Final tree `4e6fc7f`; battery in the table above; the full record: `HANDOVER.md` (w). **MERGED to `main` via `--no-ff` `69f8545` and PUSHED (2026-09-24); the merged tree is byte-identical to the tested tip `bba0f6c`; no migration; the code-only staging redeploy is the user's decision.** **Phase 29** — Laws of UX applied to the employee area, all three screens in one phase (about 35 of the 43 audit findings). The profile gained a **state-chosen primary** with **Edit kept as a visible button** and a ⋯ More menu, agreeing numbers (“1 required gap” over “3 of 6 slots filled”), **slot tiles that open an action menu** — Replace…, Return…, Open record, Waive this slot… / Remove exception — with the ⋯ always visible and required gaps ordered first, reservations shown on the tile they fill with an **Assign reserved** button, a searchable `EntityCombobox` Replace picker, pending and changed feedback on the tile, and a Slots/Table choice remembered per user. The New form became one card in thinking order with Name focused, three live read-only checks (the taken employee number naming its owner, “Next free” with a Use it button, a policy preview under Title), **every validation error returned in one pass** with focus on the first, a single same-name refusal carrying a profile link, and a sticky Cancel / Create / Create and add another bar. The list became a worklist: a **sortable Loadout column** third, the hidden-leaver count in the count line, search clear and a department term, pill toggles, and filter chips on the empty state. Spec `docs/superpowers/specs/2026-09-22-employee-ux-design.md` (`401b838`), plan `docs/superpowers/plans/2026-09-22-phase-29-employee-ux.md` (`1acd928`) — 8 tasks, `D-1`…`D-16` (the sixteen rulings R1–R16; the final whole-branch review added the Critical R11/R14 and the Important R7/R15, the fix wave `9660e6e` closed them, R16 is parked). Final tree `9660e6e`; battery in the table above; the full record, including the post-merge hygiene list: `HANDOVER.md` (v). **MERGED to `main` via `--no-ff` `d76903b` and PUSHED (2026-09-23); the merged tree is byte-identical to the tested tip `e01923a`; the staging redeploy is the user's decision, not pre-authorised. It adds no migration** (26 stays), so the merge was a plain `--no-ff` into `main` with the tree-hash check done afterwards (the root checkout has no `node_modules`, so the merged tree cannot be re-tested there), and it rode the 2026-09-23 `-Force` redeploy, which also applied Phase 27's migration 26 after the duplicate check. |

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
1. **Phase 31 — the leftovers sweep (a derived sort orders only as the primary key, both exports
   follow the derived sorts, typed `revalidatePath` patterns on real file paths, disabled pager arrows
   that are not links) IS MERGED TO `main` via `--no-ff` `bcc7b16` AND PUSHED (2026-09-24); final tree
   `7599d9e`, docs `3d477c0`, tree hashes matched, branch and worktree removed; no migration.** Bounded, no
   spec or plan; design, the seven rulings and the battery (413 e2e / 40 files, 1634 unit / 96 files)
   in `HANDOVER.md` (x). **Staging is NOT yet redeployed** — the code-only `scripts/deploy-staging.ps1
   -Force` that carries it is the user's decision.

   **Already landed — Phase 30 — Laws of UX applied to the inventory area (the record's state-chosen primary with
   Return on held devices and Edit kept, one Register flow, a row menu and attention markers on
   the list, the role's own class by default) IS MERGED TO
   `main` via `--no-ff` `69f8545` AND PUSHED (2026-09-24) — final tree `4e6fc7f`, docs `bba0f6c`, tree hashes
   matched, branch and worktree removed.** Spec
   `docs/superpowers/specs/2026-09-23-inventory-ux-design.md` (`a94f47a`), plan
   `docs/superpowers/plans/2026-09-23-phase-30-inventory-ux.md` (`b582535`) — 9 tasks, `D-1`…`D-16`,
   the sixteen rulings R1–R16 written out in `HANDOVER.md` (w); battery on the final tree in §1's
   table (409 e2e / 39 files, 1624 unit / 95 files, 26 migrations). **The merge is done:** `--no-ff`
   into `main` as `69f8545`, the branch tip's tree compared with the merge commit's tree (identical —
   the root checkout has no `node_modules`), then **only `main`** pushed, carrying the two docs-only
   commits `a94f47a` and `b582535`. **Staging REDEPLOYED 2026-09-24** (runs `e07bef7`; web healthy; `/login` 200
   locally and on the LAN) — the phase adds **no migration** (26 stays), so it was a code-only
   `scripts/deploy-staging.ps1 -Force`. `inventory_dev` is clean: `npm run db:seed`
   ran at the close of the battery. What ships knowingly (the Attention scale note, Export ignoring
   the Attention sort, the `revalidatePath` route-group check, the Loadout sort's twin of I-2) is in
   `HANDOVER.md` (w) and §5 below; the four parked items are in `HANDOVER-PENDING.md` §5.3.

   **Already landed — Phase 29 — Laws of UX applied to the employee area (the profile's state-chosen primary with
   Edit kept and a More menu, slot tiles that open an action menu, the New form's live checks with
   every error in one pass, the list as a worklist with a sortable Loadout column) IS MERGED TO
   `main` via `--no-ff` `d76903b` AND PUSHED (2026-09-23) — final tree `9660e6e`, docs `e01923a`, tree hashes
   matched, branch and worktree removed.** Spec
   `docs/superpowers/specs/2026-09-22-employee-ux-design.md` (`401b838`), plan
   `docs/superpowers/plans/2026-09-22-phase-29-employee-ux.md` (`1acd928`) — 8 tasks, `D-1`…`D-16`,
   the sixteen rulings R1–R16 written out in `HANDOVER.md` (v); battery on the final tree in §1's
   table (389 e2e / 38 files, 1556 unit / 90 files, 26 migrations). **The merge is done:**
   `--no-ff` into `main` as `d76903b`, the branch tip's tree compared with the merge commit's tree
   (identical — the root checkout has no `node_modules`, so the tree-hash check is what stands in for
   a re-test), then **only `main`** pushed, carrying the two docs-only commits `401b838` and
   `1acd928`. **Staging REDEPLOYED 2026-09-23** (`scripts/deploy-staging.ps1 -Force`, runs `ccb0432`): the
   seven-statement duplicate check in §1's Database row returned no rows, Phase 27's **migration 26**
   `case_insensitive_names` applied (26 found, up to date), web healthy, `/login` 200 locally and at the
   laptop's NEW DHCP address `http://192.168.203.56:3000` (`.183` before — see item 12). Phase 29 adds
   **no migration**. `inventory_dev` is clean:
   `npm run db:seed` ran at the close of the battery and removed the throwaway rows EMP-9801 /
   EMP-9802 a Task 5 fix-round click-through had created. The post-merge hygiene list (the
   `loadout-view.tsx` extraction, a shared `useDebouncedCheck`, the five sibling toolbars, the
   `rateLimited()` sentence, `reservationsBySlot` vs `reservedCount`) is in `HANDOVER.md` (v).

   **Already landed — Phase 28 — a Back control on every page that has a parent: where the operator came
   from when this tab has a previous in-app page, otherwise the breadcrumb's parent — IS
   MERGED TO `main` via `--no-ff` `7214066` AND PUSHED (2026-09-22) — final tree `5a8bbcf` (product
   commit `ad39271` plus the e2e fix round), docs `e8b48a4`; the merged tree is byte-identical to the
   tested tip (tree hashes matched); branch and worktree removed.**
   It is a **bounded change**: the design was approved in conversation on 2026-09-22, so there is no
   spec and no plan document — `HANDOVER.md` (u) is the record, with the design paragraph,
   the two rulings (R1 the branch point, R2 Back is navigation and the purchases viewer assertion
   adapts) and what stays parked. **Staging REDEPLOYED 2026-09-23** with Phases 27 and 29 (`ccb0432`). **This phase adds no
   migration** (26 stays), so it rode that redeploy code-only. Verified exactly as Phase 26 did: `docker compose ps` (web healthy),
   `docker compose exec -T web npx prisma migrate status` (**26 found, up to date**), HTTP 200 on
   `http://127.0.0.1:3000/login` and on the LAN URL. Battery on the final tree: §1's table
   above — **380 e2e / 37 files**, 1532 unit / 88 files, `tsc` and `lint` clean.
2. **Phase 27 — IT and quality leftovers sweep: `/audit` class scoping of approval, category and
   type rows, case-insensitive uniqueness for reference data, and the four activity feeds' Action
   facet, sentences and human field names, plus the parked Minors of Phases 17–26 — IS
   MERGED TO `main` via `--no-ff` `5dd3372` AND PUSHED (2026-09-22); final tree `66445ed` (after the
   final-review fix wave), docs `0abf560`; the merged tree is byte-identical to the tested tip (tree
   hashes matched); branch and worktree removed** (7 tasks, `D-1`…`D-10` — the
   pre-flight rulings R1–R4 are `D-1`, the final whole-branch review added `D-8`, the fix wave `D-9`,
   the final battery `D-10`). **Staging REDEPLOYED 2026-09-23** (`scripts/deploy-staging.ps1 -Force`, runs `ccb0432`). This phase
   is **not** code-only — **migration 26** `case_insensitive_names` applied on that redeploy after the
   seven-statement duplicate check in §1's Database row returned no rows (it FAILS LOUDLY on two names
   differing only by case; staging was clean on 2026-09-22 and again on 2026-09-23). Verified exactly as Phase 26 did: `docker compose ps` (web healthy),
   `docker compose exec -T web npx prisma migrate status` (**26 found, up to date**), HTTP 200 on
   `http://127.0.0.1:3000/login` and on the LAN URL. The push also carried the two docs-only commits
   `385b484` (spec) and `8c24c3b` (plan) that had sat on local `main` since 2026-09-22. See §1's table
   above and `HANDOVER.md` (t) for what shipped, the six rulings, the ten plan decisions, the final
   review and the battery; what stays parked is in `docs/HANDOVER-PENDING.md` §5.3 and §6 and in §5
   below.
3. **Phase 26 — holds that work + a repair end-date: reserve a spare from the asset record or from
   an empty profile slot, release it, an hourly expiry sweep, `/reservations` list parity, and
   `Asset.repairEndedAt` stamped by the lifecycle preparer — IS MERGED TO `main` via `--no-ff`
   `a5883ad` AND PUSHED (2026-09-22); final tree `1442289` (after the final-review fix wave), docs `6175af3`;
   the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree
   removed** (6 tasks, `D-1`…`D-10` — the spec corrections before the plan are `D-2`, the
   final whole-branch review added `D-8`, the fix wave `D-9`, the final battery `D-10`). **Staging
   redeployed 2026-09-22 with `scripts/deploy-staging.ps1 -Force`** (`-Force` because the merge happened on
   this laptop) — **not code-only: migration 25 `repair_end_and_holds` applied on it** (25 found, all
   applied; additive, one nullable column; its backfill filled `repairEndedAt` on one of staging's two
   closed repairs and left the other's dash, since nothing is invented). Web healthy within 25 s, local
   and LAN `/login` 200, `/reservations` redirects to login when signed out; the worker's first sweep
   expired staging's one long-dead seeded hold (`[worker] expired 1 hold`), as designed. The push also
   carried the two docs-only commits `2bed93b` (spec) and `611d91f` (plan and spec corrections) that
   had sat on local `main` since 2026-09-21. See §1's table above and `HANDOVER.md` (s) for what
   shipped, the five rulings, the final review and the battery; what stays parked is in
   `docs/HANDOVER-PENDING.md` §6 and §5 below.
4. **Phase 25 — IT navigation sweep: start offboarding from the profile, every reference a link, the
   new-hire finish line, employees list parity, safety nets — IS MERGED TO `main` via `--no-ff` `bb577f8` AND
   PUSHED (2026-09-21; final tree `fab0780` after the final-review fix wave, docs `641e96f`; the merged tree is
   byte-identical to the tested tip — tree hashes matched); branch and worktree removed** (8 tasks, `D-1`…`D-12` —
   the final whole-branch review added `D-10`, the fix wave `D-11`, the final battery `D-12`). There is **no
   migration** (24 stays), so the staging redeploy that carries it is a code-only
   `scripts/deploy-staging.ps1 -Force` (`-Force` because the merge happened on this laptop) — **run 2026-09-21**:
   staging serves `5727572` (24 migrations found, none pending; web healthy; `/login` answers 200 locally and on the LAN). The push also carried the three docs-only commits `9dd7ba5`,
   `98a94a1` (spec) and `5acb5fd` (plan) that had sat on local `main`. See §1's
   table above and `HANDOVER.md` (r) for what shipped, the four rulings, the final review and the battery;
   the next IT candidate (**Phase 26 — reservations that work + repair end-date**) and the items that
   stay parked are in `docs/HANDOVER-PENDING.md` §6 and §5 below.
5. **Phase 24 — IT gaps 2: Replace groups, the repairs view paged in SQL, worker retention — IS
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
6. **Phase 23 — Parkinson sweep: quick forms and complete-by dates — IS MERGED TO `main` via
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
7. **Phase 22 — Stock control D2: FIFO lot consumption and costing, optional expiry, three report pages
   with exports, receipt documents, and the six D1 leftovers — IS MERGED TO `main` via
   `--no-ff` `26aaf82` AND PUSHED (2026-09-16; final tree `a4b57b5`, after the final-review fix wave);
   branch and worktree removed** (10 tasks, `D-1`…`D-20` — the final-review fix wave added
   `D-16`…`D-19`, the final battery `D-20`) —
   **Staging redeployed 2026-09-17 with `scripts/deploy-staging.ps1 -Force`: migration 23 applied (23 found;
   staging's stock tables were empty, so the backfill had nothing to convert), web healthy, the LAN URL
   answers. Nothing remains for this phase.** See §1's table above and `HANDOVER.md` (o) for
   what shipped and the battery; `docs/HANDOVER-PENDING.md` §5.1 is shipped, its requisition question
   decided no (2026-09-16).
8. **Phase 21 — Approvals oversight: direct IT changes made visible, plus five correctness and quality
   items — IS MERGED TO `main` via `--no-ff` `b716767` AND PUSHED (2026-09-15); branch and worktree
   removed** (8 tasks, `D-1`…`D-16` — the final-review fix wave added `D-11`…`D-13`, the final
   battery `D-15` and `D-16`; final tree `2ae8738`) — **staging redeployed the same day with `scripts/deploy-staging.ps1 -Force`; migration 22
   applied, web healthy, the LAN URL answers. Nothing remains for this phase.** See §1's table above and `HANDOVER.md` (n) for what shipped and
   the battery.
9. **Phase 20 — IT side: transfers, offboarding attribution and facets, directory quality, six known
   gaps — IS MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10), including the final-review
   fix wave; branch and worktree removed** (9 tasks, `D-1`…`D-30` — the final-review fix wave added `D-23`…`D-29`, the
   final battery `D-30`; final tree `4d54382`) — **the staging redeploy (migrations 20 and 21 together, `scripts/deploy-staging.ps1 -Force`) is the
   user's decision, not pre-authorised.** See §1's table and `HANDOVER.md` (m) for what shipped, the final
   review's findings and the wave, and the battery.
   Once merged: Phase 19's migration 20 and Phase 20's migration 21 both apply on the same next
   `scripts/deploy-staging.ps1 -Force` redeploy (staging is still on the Phase 18 build). The parked
   Purchasing/stock work (D2, supplier and stock imports, the visual checks, deployment loose ends) stays
   in `docs/HANDOVER-PENDING.md`.
10. **Phase 19 — Stock control, part D1 (the ledger core) — is DONE, including the final-review fix
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
   shipped in Phase 22 (item 7 above); Purchasing's opening stock goes in through `/stock/import`.**
11. **Phase 18 — Purchasing: suppliers and request extensions — is DONE, including the
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
12. **Deploy the prototype to the staging laptop and let Purchasing and Finance use it.** Chosen by the user
   on 2026-09-07 as the next step before any more features. The ordered checklist is
   [`staging-run-sheet.md`](staging-run-sheet.md) (also delivered as a PDF). It hinges on one decision only
   the user can make — **which machine owns the app's address — `192.168.203.56` since 2026-09-23, a DHCP lease after a change of location (`.183` static from 2026-09-21; `.153` before); `.env` and this file follow** — or whether to use a
   DNS name instead — because that value is printed onto every label. Physical steps nobody else can do:
   the UniFi DHCP reservation, the phone reachability test, the printed sheet (tape-measure the 100 mm bar,
   scan one QR).
13. **Two visual checks never done by a human:** the inventory class-switch chips and Finance's IT/Purchasing
   tabs by eye, and the Register form signed in as `purchasing@`. Both are asserted by e2e and axe, never
   looked at.
14. **Remaining candidates**, in value order (**Phase 16 delivered the fourth item this list used to
   carry — a real `Asset.loanDueAt` for TEMPORARY loans, no longer a 30-day proxy — so it's dropped here**):
   - The **depreciation module** (user's choice, own brainstorm).
   - **Purchasing bulk import**.
   - ~~The Replace dialog's headerless **"other spares" list** when no same-type spare exists.~~ **Closed
     in Phase 20 (gap 4):** every Replace option now carries a "Same type" / "Other spare" note.
15. **The §9 subsystems from the Admin meeting — B and C shipped in Phase 18; D's first half (D1) shipped
   in Phase 19 (item 10 above); D2 shipped in Phase 22 (merged `26aaf82`, item 7 above).** Vendor master data (B)
   and purchasing workflow extensions (C) are code-complete on `phase-18-purchasing-suppliers`, merged.
   **D1 · stock control** (items, the ledger, derived balances, stocktake, import) is merged to `main`
   (`d311e26`, 2026-09-10; on staging since the 2026-09-10 redeploy). **D2 · FIFO costing, expiry warnings, report
   views and exports by department and month** shipped in Phase 22 as stock control D2 —
   merged to `main` via `--no-ff` `26aaf82` and pushed 2026-09-16 (`HANDOVER.md` §9, item 7 above).

## 5. Known gaps to keep in view

- **No HTTPS** on the LAN; on-site only; one machine, no failover. Acceptable for the prototype, written up in
  the run sheet.
- `SEED_PASSWORD` is the only credential on staging until the seeded accounts' passwords are changed.
- Two server-side gates are unreachable from the UI and covered by the database trigger and review only:
  a wrong-class register request and a mixed-class bulk request (`D-13`); likewise `updateAsset`'s
  cross-class guard (`D-15`).
- `/audit` and the four activity feeds exclude invisible rows by id list — **four** lists since Phase 27
  (assets, approvals, asset categories, asset types), across `/audit`, its export and all four feeds. Fine
  while the Purchasing fleet is small; revisit if it grows past a few thousand rows. An all-class role
  runs no query at all.
- **Closed in Phase 27 —** `/audit` excluded only `asset` rows of the other class; `approval`,
  `asset-category` and `asset-type` rows about Purchasing objects still appeared for IT (spec §3.1 asked
  for asset rows only). `invisibleAuditRefs(role)` now hides all four, in the log, the entity facet and
  the export. The "with resolved labels" clause this line used to carry was in fact **never true** for
  `asset-category` and `asset-type` — `entityLabels` had no branch for either, so those rows printed
  truncated cuids — which the phase's final review caught (I-2) and its fix wave closed: both now
  resolve to names, linked to `/admin/asset-categories` and `/admin/asset-types`.
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
- **Closed in Phase 26 — holds that work, and a repair end-date.** Phase 25's audit turned two
  long-standing lines in `HANDOVER.md` §8 into a named next phase, and
  `phase-26-holds-and-repair-end` delivered both (final tree `1442289`; merged to `main` as `a5883ad` and pushed 2026-09-22; staging redeployed 2026-09-22, migration 25 applied).
  **Holds:** `reserveAsset` and `releaseHold` (`src/server/modules/reservations/actions.ts`) are direct
  admin/IT actions writing one audit row each (`reservation.placed` / `reservation.released`), reached
  from the asset record's **Reserve** control, an empty policy slot's **Reserve a spare…** menu item
  on a profile, the profile's holding area and `/reservations`; `src/worker/holds.ts` sweeps ACTIVE
  holds past their Manila day to EXPIRED once at start and hourly after; and `/reservations` gained
  search, Employee and Department facets, four sortable headers, row click and Release. Its empty state
  now reads “No active holds — reserve a spare from its record or from a person's profile.”
  and its banner “Holds are placed from the asset record or the person's profile and released there
  or here.” — both true for the first time. **Repair end-date:** `Asset.repairEndedAt` (migration
  25) is stamped by `prepareLifecycle` on every path that leaves DEFECTIVE and cleared when an asset
  re-enters it, and `downDays` closes its interval on it, so a returned-OK asset reads “down N d,
  back since {date}” (or “closed {date}” once the status family is closed) instead of a dash.
  The dash survives only where no end was ever recorded: the migration's backfill fills only rows whose
  audit history shows the transition. Full facts: `HANDOVER.md` (s) and `docs/HANDOVER-PENDING.md`
  §6.
- **Closed in Phase 27 — the three IT items every phase since 24 carried forward.** `/audit` class
  scoping of approval, category and type rows; case-insensitive uniqueness for reference data; and the
  activity feeds' action facet with its import-update sentences. All three shipped on
  `phase-27-leftovers-sweep` (final tree `66445ed`, code-complete 2026-09-22; merged to `main` as `5dd3372` and pushed 2026-09-22; on staging since the 2026-09-23 redeploy). Two things the
  phase recorded rather than fixed, and they are the phase's own leftovers: **`/audit`'s entity pill
  still prints the raw `vendor`** while the facet and the chip say "Supplier" — a one-line `humanize`
  on the pill, but the pill is CSS-uppercased and an existing e2e asserts `ASSET` on it, so it needs its
  own e2e pass; and **six inline `P2002` checks live outside the five consolidated modules**
  (`suppliers/bank-actions`, `admin/webhook-actions`, `approvals`, `employees`, `offboarding`,
  `receiving`/`reservations` actions) — each correct and carrying its own module's message, none
  touching a `lower()` index, so swapping them onto the shared helper is mechanical work for whoever
  next opens those files. Full facts: `HANDOVER.md` (t).
- **The merged-timeline cursor's `skip` URL parameter is clamped.** Flagged during Phase 17 (plan `D-8`'s fix) as unclamped; closed in the final-review fix wave (plan `D-11`): `parseTimelineCursor` now clamps `skip` to `TIMELINE_MAX_SKIP = 1_000` on the way in, so a hand-edited URL can no longer inflate `mergeTimeline`'s per-source `take = limit + 1 + skip`. No longer a follow-up.
- **The Attention sort is an in-memory candidate pass (Phase 30).** `?sort=attention` on `/inventory` reads every asset the filters admit and orders them in memory, like Phase 29's Loadout sort — fine at today's size, to revisit past a few thousand assets (spec §7). Recorded with it, and **closed by Phase 31** (`HANDOVER.md` (x)): Export now follows the Attention sort; the Loadout sort orders only as the primary key; the typed `revalidatePath` patterns name real file paths, with a guard test. Full facts: `HANDOVER.md` (w).

## 6. If you are an assistant reading this

Start with this file, then `HANDOVER.md` §0. Follow §3 above as standing instructions. Before proposing
work, check `HANDOVER.md` §8 and §9 for what is deferred and why. Do not merge or push without being asked,
do not seed a database people are using (the seed truncates every table), and when a plan and the code
disagree, the code wins and the plan gets amended.
