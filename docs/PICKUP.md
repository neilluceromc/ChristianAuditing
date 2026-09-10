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
| Branch | `main`, **level with `origin/main`** after the Phase 20 push (merge `e48b457`, 2026-09-10) — count with `git rev-list --count origin/main..main` before trusting this. Phase branches (`phase-10-polish` … `phase-14-department-owned-classes`) exist only on the old dev laptop; `phase-15-direct-it-lifecycle`, `phase-16-registration-custody`, `phase-17-scale-sweep`, `phase-18-purchasing-suppliers` and `phase-19-stock-control` were merged and deleted on the staging laptop. All are fully contained in `main`. **`phase-20-it-people-and-gaps` (final tree `4d54382`, after the final-review fix wave) IS MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10)** (9 tasks, `D-1`…`D-30`; battery in the table below); the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed. **Staging still runs the Phase 18 merge** (`4cf5697`) since the 2026-09-09 forced redeploy (migration 19 applied; 16–18 came with the two 2026-09-08 redeploys); **Phase 19's migration 20 applies at the next `scripts/deploy-staging.ps1 -Force`**, and Phase 20's migration 21 rides the same redeploy — `-Force` is needed whenever the merge happened on this laptop, because the plain run sees nothing new and skips. |
| Stack | Next.js 15 App Router · Prisma 6 · PostgreSQL 16 (Docker) · Auth.js v5 · Tailwind v4 · Playwright · vitest. Node ≥ 22, npm ≥ 11 (dev machine ran Node 24). |
| Database | **21 migrations** on `main` (merge `e48b457`; migration 21 `employee_transfers`, additive); staging remains at **19** until the next `-Force` redeploy applies 20 and 21 together. `prisma migrate reset` is **not** used in this project. |
| Battery, last run 2026-09-10 (Phase 20 final tree `4d54382`, `phase-20-it-people-and-gaps`, unmerged, after the final-review fix wave) | `tsc` clean · `lint` clean · **21 migrations** · **1295 unit / 75 files** · **296 e2e / 27 files** by `--list`. Task 9's close (branch tip `f6ec5e1`) ran six foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **A 54 passed (3.3m) · B 67 passed (3.9m) · C 68 passed (4.4m) · D 38 passed (2.6m) · E 53 passed (7.3m) · F 21 passed (2.0m) = 301 run / 296 unique** (chunk C's file argument was the bare pattern `offboarding`, which also matched `offboarding-v2.spec.ts`), zero failed, zero did-not-run on the runs recorded. Chunks A, C and D each failed a first pass on a stale pre-Phase-20 e2e expectation, were reproduced once as-is, fixed in their own commit (`fe4295c`, `63df64a`, then `0b463b1` and `f6ec5e1` for chunk D's two), and re-ran clean; chunks B, E, F passed clean first try. The final-review fix wave re-ran `directory.spec.ts` (5 passed, twice), `it-gaps.spec.ts` (6 passed, twice), `transfers.spec.ts` (5 passed), `import-export.spec.ts` (21 passed) and `paging.spec.ts` (12 passed) — `--list` still **296 / 27**, unchanged. Commands and history: `HANDOVER.md` §0 item 9; what shipped, the final review's findings and the wave: `HANDOVER.md` (m). **The whole battery then re-ran on the final tree `4d54382` with explicit file paths throughout, not the bare pattern above: A 54 passed (3.4m) · B 67 passed (3.8m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.3m) · F 21 passed (2.0m) = 296 / 296**, zero failed, zero did-not-run (chunk A's first pass was 53 + 1 failed on `it-core.spec.ts:302`, a `toBeVisible` 5 s timeout, not reproduced on an immediate re-run — the cold-compile/headroom class §7 documents). |
| Battery, last run 2026-09-09 (Phase 19 final tree `a185729`, `phase-19-stock-control`, unmerged) | `tsc` clean · `lint` clean · **20 migrations** · **1224 unit / 72 files** · **275 e2e / 23 files** by `--list`. Task 9's close ran five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 passed (3.3m) · 67 passed (3.9m) · 63 passed (4.0m) · 38 passed (2.6m) · 53 passed (7.3m) = 275 / 275**, zero failed, zero did-not-run; the fix wave re-ran only `stock.spec.ts` + `stocktake.spec.ts` — **17/17 passed (1.6m)**, `--list` still **275/23** unchanged. Commands and history: `HANDOVER.md` §0 item 9; what shipped and what the wave fixed: `HANDOVER.md` (l). **The whole battery then re-ran on the final tree after the fix wave, ruling R14 and the re-review minors: 54 (3.4m) · 67 (3.8m) · 63 (4.0m) · 38 (2.5m) · 53 (7.1m) = 275 / 275**, zero failed, zero did-not-run (chunks A and B on `ad19921`, C–E on `a185729`; the delta between them is a comment, a test title and one e2e assertion). |
| Battery, earlier full run 2026-09-09 (Phase 18 final tree `3298abf`, the tree merged as `d4b95bb`) | `tsc` clean · `lint` clean · **19 migrations** · **1113 unit / 64 files** · **258 e2e / 21 files** by `--list`. Five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 passed (3.3m) · 67 passed (3.9m) · 63 passed (4.0m) · 38 passed (2.5m) · 36 passed (5.6m) = 258 / 258**, zero failed, zero did-not-run (Task 10's 74-test last chunk was split in two to fit the ten-minute foreground cap). Commands and history: `HANDOVER.md` §0 item 9. |
| Last two phases | **Phase 20** — IT side: department transfers, offboarding attribution and facets, directory quality, six known gaps: a new `EmployeeTransfer` table records every department (and optional title) change with an effective date and reason; a **Transfer** dialog on the employee page, a 90-day "Transferred from X on `<date>`" header line, an unpaged Transfers card, and a fourth `mergeTimeline` source; the edit form loses its Department select entirely — one path for one fact. The offboarding wizard, printable report and export now name who decided each item and when (the executing approval's claimer and resolved time); the offboarding list gains Department and Progress facets and sortable name/started/undecided columns. A same-name-same-department guard on employee create and import (deliberate confirm/option); leavers hidden from `/employees` by default behind a "Show leavers" toggle; a per-employee holdings export. Six recorded IT gaps closed: `bulkChangeStatus`'s skipped list, class-scoped `checkIdentifiers`, loan-covered slots excluded from `missingRequired`, the Replace picker's "Same type"/"Other spare" notes, a "Last change" line on the asset record, and `repairStageIds` as one raw-SQL `CASE`. One additive migration, **21** (`employee_transfers`). Spec `superpowers/specs/2026-09-10-it-people-and-gaps-design.md`, plan `superpowers/plans/2026-09-10-phase-20-it-people-and-gaps.md` (30 amendments, `D-1`…`D-30` — the final-review fix wave added `D-23`…`D-29`, the final battery `D-30`): the fix wave made the employment facet's OFFBOARDED count honest with the leavers toggle forced on, proved the repair-stage SQL cut against `repairStage()` per asset instead of comparing JS with JS, closed a stale-read race in `transferEmployee` with a conditional `updateMany` and a conflict refusal, and added a `department-via-import` block cause (with `keepCurrentDepartment`) for an import row that moved a department with no `EmployeeTransfer` row. **MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10) from final tree `4d54382`; the merged tree is byte-identical to the tested tip (tree hashes matched); branch and worktree removed; staging not yet redeployed (migrations 20 and 21 pending a `-Force` redeploy).** — merging, pushing and the staging redeploy are the user's decisions; `docs/HANDOVER-PENDING.md` holds the parked work. **Phase 19** — Stock control, part D1 (the ledger core): six new models beside the asset register (`StockCategory`, `StockItem`, `StockLot`, `StockMovement`, `Stocktake`, `StocktakeLine`) with balances always derived (`SUM(quantity)`, never stored) and `StockMovement` append-only (trigger plus sign-by-kind check constraints); categories carry an automatic code series (`OS-0001`); Receive (lots, a pack-to-units helper), Issue (an on-hand guard with an exact over-issue refusal) and Adjust (delta or set-to) all run under row locks; Stocktakes open one per scope, blind-count with no book quantity shown, review variance and drift, and post real `ADJUSTMENT` rows against the current balance; a spreadsheet importer creates/updates items and records opening stock; a balances export. New Stock area under `/stock` in the Purchasing workspace. One additive migration, **20**. Spec `superpowers/specs/2026-09-09-stock-control-design.md`, plan `superpowers/plans/2026-09-09-phase-19-stock-control.md` (30 amendments, `D-1`…`D-30` — the final-review fix wave added `D-21`…`D-30`: refusals now throw inside every stock transaction, `openStocktake` is serialised with an advisory lock, count/post lock the stocktake row, and a POSTED/CANCELLED review is a frozen record with adjustment links). **MERGED TO `main` via `--no-ff` `d311e26` AND PUSHED (2026-09-10); branch and worktree removed; staging not yet redeployed (migration 20 pending a `-Force` redeploy).** |

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

1. **Phase 20 — IT side: transfers, offboarding attribution and facets, directory quality, six known
   gaps — IS MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10), including the final-review
   fix wave; branch and worktree removed** (9 tasks, `D-1`…`D-30` — the final-review fix wave added `D-23`…`D-29`, the
   final battery `D-30`; final tree `4d54382`) — **the staging redeploy (migrations 20 and 21 together, `scripts/deploy-staging.ps1 -Force`) is the
   user's decision, not pre-authorised.** See §1's table and `HANDOVER.md` (m) for what shipped, the final
   review's findings and the wave, and the battery.
   Once merged: Phase 19's migration 20 and Phase 20's migration 21 both apply on the same next
   `scripts/deploy-staging.ps1 -Force` redeploy (staging is still on the Phase 18 build). The parked
   Purchasing/stock work (D2, supplier and stock imports, the visual checks, deployment loose ends) stays
   in `docs/HANDOVER-PENDING.md`.
2. **Phase 19 — Stock control, part D1 (the ledger core) — is DONE, including the final-review fix
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
   is next (item 6 below); Purchasing's opening stock goes in through `/stock/import`.**
3. **Phase 18 — Purchasing: suppliers and request extensions — is DONE, including the
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
4. **Deploy the prototype to the staging laptop and let Purchasing and Finance use it.** Chosen by the user
   on 2026-09-07 as the next step before any more features. The ordered checklist is
   [`staging-run-sheet.md`](staging-run-sheet.md) (also delivered as a PDF). It hinges on one decision only
   the user can make — **which machine owns the reserved address `192.168.203.153`**, or whether to use a
   DNS name instead — because that value is printed onto every label. Physical steps nobody else can do:
   the UniFi DHCP reservation, the phone reachability test, the printed sheet (tape-measure the 100 mm bar,
   scan one QR).
5. **Two visual checks never done by a human:** the inventory class-switch chips and Finance's IT/Purchasing
   tabs by eye, and the Register form signed in as `purchasing@`. Both are asserted by e2e and axe, never
   looked at.
6. **Remaining candidates**, in value order (**Phase 16 delivered the fourth item this list used to
   carry — a real `Asset.loanDueAt` for TEMPORARY loans, no longer a 30-day proxy — so it's dropped here**):
   - The **depreciation module** (user's choice, own brainstorm).
   - **Purchasing bulk import**.
   - ~~The Replace dialog's headerless **"other spares" list** when no same-type spare exists.~~ **Closed
     in Phase 20 (gap 4):** every Replace option now carries a "Same type" / "Other spare" note.
7. **The §9 subsystems from the Admin meeting — B and C shipped in Phase 18; D's first half (D1) shipped
   in Phase 19 (item 2 above); only D2 remains.** Vendor master data (B) and purchasing workflow
   extensions (C) are code-complete on `phase-18-purchasing-suppliers`, merged. **D1 · stock control**
   (items, the ledger, derived balances, stocktake, import) is merged to `main` (`d311e26`, 2026-09-10;
   staging still to be redeployed). **D2 · FIFO costing, expiry warnings, report views and exports by
   department and month** is still NOT yet planned — it needs its own spec and consumes the lots D1
   records (`HANDOVER.md` §9).

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
- **Direct IT changes leave no PENDING row,** so the record's pending banner and `Open requests` stat only ever show Purchasing or legacy approvals for IT devices.
- Phase 15 changed Home dismissal keys from `KIND:id` to `section:id`, so dismissals made earlier on deploy day reappear until cleared again — one-day effect.
- Backups land on the same disk as the data; copy them off periodically.
- **Closed in Phase 20 — `checkIdentifiers` (Phase 16) leaks existence across classes.** The live duplicate check queries the whole `Asset` table regardless of `cls`, so IT registering a laptop can learn that a tag or serial is "already registered" even when the matching row is a Purchasing asset IT cannot otherwise see — accepted, since it only ever confirms existence, never any detail of the other class's row. Phase 20 §6 gap 2: `checkIdentifiers({ tags, serials, cls })` now queries `where: { cls }` only, and the register/asset forms pass the class they render for (skipping the live check entirely until a category names one) — a cross-class collision surfaces only as the pre-existing neutral P2002 conflict copy at submit.
- **Closed in Phase 20 — `bulkChangeStatus` still returns a bare `{ changed, skipped }` count**, unlike the new `bulkAssign` (Phase 16), which names which tags it skipped and why. Spec §10 puts changing `bulkChangeStatus`'s return shape explicitly out of scope for this phase. Phase 20 §6 gap 1: `bulkChangeStatus` now returns `{ changed, skipped: Array<{ tag, reason }> }` with the same named reasons `bulkAssign` uses, and the bulk drawer renders the skipped list the same way for both.
- **Signing-date tolerance (Phase 16, plan `D-13`) is a one-day window, not true local-timezone awareness:** the server refuses only a date later than the UTC date of `now + 1 day`, so a signing date genuinely one day in the future (not just "tomorrow" at 03:00 PHT) would also be accepted. Traded deliberately — a wrong refusal at local midnight was worse than the one-day slack.
- **Closed in Phase 20 — the loaner rule (Phase 16 §3.3, spec decision 8) reads a standard slot as "missing" from deploy day on, if it is filled by a device on loan.** `computeLoadout` now matches a standard (non-loaner) slot only to a non-`TEMPORARY` asset, so a person whose only device of a type is on loan shows that slot empty and missing — intended (a loan is not a permanent fill), not a regression; visible in `it-core.spec.ts`'s "list shows loadout gaps" count moving from 1 to 2 missing once one seeded holder's device turned out to be `TEMPORARY`. Phase 20 §6 gap 3: `computeLoadout` now marks such a slot `coveredByLoan` (the device stays in `onLoan`, uncounted) and excludes it from `missingRequired`, so the tile reads "on loan" instead of a policy gap — Marites Bautista's count in `it-core.spec.ts` moved back from 2 to 1 missing.
- **The repair-stage saved view and the `gaps=1` facet counts were deliberately left untouched by Phase 17.** The plan's Global Constraints named both as "behaviour that must not change": the repair-stage view (`?stage=&down=`) still groups DEFECTIVE assets in memory rather than in SQL, and the employees list's facet counts under `gaps=1` are computed the same way they were before this phase. Both remain by decision, not oversight — revisit if either set grows enough to matter at scale.
- **Webhook delivery rows have no retention policy.** Phase 17 paginated the admin deliveries list (Task 4), but nothing prunes old `WebhookDelivery` rows — the table grows without bound. A storage and query-cost concern for later, not yet user-facing.
- **The merged-timeline cursor's `skip` URL parameter is clamped.** Flagged during Phase 17 (plan `D-8`'s fix) as unclamped; closed in the final-review fix wave (plan `D-11`): `parseTimelineCursor` now clamps `skip` to `TIMELINE_MAX_SKIP = 1_000` on the way in, so a hand-edited URL can no longer inflate `mergeTimeline`'s per-source `take = limit + 1 + skip`. No longer a follow-up.

## 6. If you are an assistant reading this

Start with this file, then `HANDOVER.md` §0. Follow §3 above as standing instructions. Before proposing
work, check `HANDOVER.md` §8 and §9 for what is deferred and why. Do not merge or push without being asked,
do not seed a database people are using (the seed truncates every table), and when a plan and the code
disagree, the code wins and the plan gets amended.
