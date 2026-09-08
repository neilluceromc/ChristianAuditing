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
| Branch | `main`, **level with `origin/main`** after the Phase 15 push (merge `c087f8d`, 2026-09-07) — count with `git rev-list --count origin/main..main` before trusting this. Phase branches (`phase-10-polish` … `phase-14-department-owned-classes`) exist only on the old dev laptop; `phase-15-direct-it-lifecycle` was merged and deleted on the staging laptop. All are fully contained in `main`. **Staging is behind `main`** until `scripts/deploy-staging.ps1` runs again (it applies migration 16). |
| Stack | Next.js 15 App Router · Prisma 6 · PostgreSQL 16 (Docker) · Auth.js v5 · Tailwind v4 · Playwright · vitest. Node ≥ 22, npm ≥ 11 (dev machine ran Node 24). |
| Database | 17 migrations, additive only. `prisma migrate reset` is **not** used in this project. |
| Battery, last run 2026-09-08 (final-review fix wave, D-19/D-20) | `tsc` clean · `lint` clean · **17 migrations** · **1040 unit / 56 files** · **227 e2e / 18 files** by `--list`. Task 16's own close ran the full five foreground chunks — **52 · 63 · 69 · 36 · 6 = 226** (chunks 2 and 3 needed a fix first — plan `D-18` — before they passed); the fix wave ran a targeted subset (registration+custody, department-owned+it-core, axe-sweep alone — 13 · 37 · 6 passed) and the controller then ran every remaining file on `ead422d` (52 · 69 · 24 · 26 passed) — **227 / 227 on the merge candidate**, `tsc` and 1040 unit re-run clean; nothing is owed before merge. Commands and history: `HANDOVER.md` §0 item 9. |
| Last two phases | **Phase 16** — registration, policy exceptions, loans, bulk assign and the signed form: the batch page (`/inventory/register`) gains the Purchasing fields (warranty, brand, notes, invoice ref/document) and a live duplicate check shared with the single-asset form; loadouts apply per-employee ADD/WAIVE exceptions before slots are computed (`effectiveSlots`), and a `PolicySlot.loaner` flag lets a slot fill only from a `TEMPORARY` device (an unmatched one reads "on loan", never an extra); `Asset.loanDueAt` threads through the shared lifecycle executor and a metadata-only `setLoanDue`; `bulkAssign` hands out several spares in one transaction beside `bulkChangeStatus`; a signed accountability form is recorded on the employee (`Acknowledgement`) with its own safe-download route and an "issued since last signature" hint. Spec `superpowers/specs/2026-09-07-it-registration-custody-design.md`, plan `superpowers/plans/2026-09-07-phase-16-registration-custody.md`. **CODE-COMPLETE on `phase-16-registration-custody`, UNMERGED and UNPUSHED.** **Phase 15** — direct IT lifecycle: for a role that manages an IT asset (`DIRECT_LIFECYCLE_CLASSES = ["IT"]`, `isDirectLifecycle`), status change, assign, return, replace, bulk, deploy-at-creation and offboarding decisions apply on confirm and are recorded as already-EXECUTED approvals plus audit (`lifecycle.*` actions); one shared executor `prepareLifecycle`/`commitLifecycle` serves the worker and the direct actions; a returned IT device waits for triage (`Asset.returnedAt`, migration 16, `isAssignable`); one `Replace` action; IT's Home is a grouped worklist with `/inventory/work`. Purchasing keeps its queue. Spec `superpowers/specs/2026-09-07-direct-it-lifecycle-design.md`, plan `superpowers/plans/2026-09-07-phase-15-direct-it-lifecycle.md`. |

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

1. **Phase 17 — the scale sweep — is next.** Split out of Phase 16 on purpose (spec decision 1, so scale
   work never waits on a feature phase): pagination on Approvals, Offboarding, Reservations, Admin users
   and webhook deliveries; the Employees list paged in SQL with loadout computed only for the page; a
   cursor on the asset History and the two merged Timelines; `take`/ordering tiebreakers everywhere
   skip/take is used; a grouped count instead of the 600-row employee read on the policies page; the
   worklist's remaining uncapped sources. Its own spec and plan are still to be written.
2. **Deploy the prototype to the staging laptop and let Purchasing and Finance use it.** Chosen by the user
   on 2026-09-07 as the next step before any more features. The ordered checklist is
   [`staging-run-sheet.md`](staging-run-sheet.md) (also delivered as a PDF). It hinges on one decision only
   the user can make — **which machine owns the reserved address `192.168.203.153`**, or whether to use a
   DNS name instead — because that value is printed onto every label. Physical steps nobody else can do:
   the UniFi DHCP reservation, the phone reachability test, the printed sheet (tape-measure the 100 mm bar,
   scan one QR).
3. **Two visual checks never done by a human:** the inventory class-switch chips and Finance's IT/Purchasing
   tabs by eye, and the Register form signed in as `purchasing@`. Both are asserted by e2e and axe, never
   looked at.
4. **Remaining candidates**, in value order (**Phase 16 delivered the fourth item this list used to
   carry — a real `Asset.loanDueAt` for TEMPORARY loans, no longer a 30-day proxy — so it's dropped here**):
   - The **depreciation module** (user's choice, own brainstorm).
   - **Purchasing bulk import**.
   - The Replace dialog's headerless **"other spares" list** when no same-type spare exists.
5. **The §9 subsystems from the Admin meeting** — vendor master data, purchasing extensions, consumables.
   Consumables is a second domain, not an extension of assets; it needs its own brainstorm and must not be
   modelled as an `Asset`.

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
- Worklist section totals are capped by their queries' `take` (10 for missing/records, 50 for triage/repairs), so "See all N" can understate on a very large fleet.
- Phase 15 changed Home dismissal keys from `KIND:id` to `section:id`, so dismissals made earlier on deploy day reappear until cleared again — one-day effect.
- Backups land on the same disk as the data; copy them off periodically.
- **`checkIdentifiers` (Phase 16) leaks existence across classes.** The live duplicate check queries the whole `Asset` table regardless of `cls`, so IT registering a laptop can learn that a tag or serial is "already registered" even when the matching row is a Purchasing asset IT cannot otherwise see — accepted, since it only ever confirms existence, never any detail of the other class's row.
- **`bulkChangeStatus` still returns a bare `{ changed, skipped }` count**, unlike the new `bulkAssign` (Phase 16), which names which tags it skipped and why. Spec §10 puts changing `bulkChangeStatus`'s return shape explicitly out of scope for this phase.
- **Signing-date tolerance (Phase 16, plan `D-13`) is a one-day window, not true local-timezone awareness:** the server refuses only a date later than the UTC date of `now + 1 day`, so a signing date genuinely one day in the future (not just "tomorrow" at 03:00 PHT) would also be accepted. Traded deliberately — a wrong refusal at local midnight was worse than the one-day slack.
- **The loaner rule (Phase 16 §3.3, spec decision 8) reads a standard slot as "missing" from deploy day on, if it is filled by a device on loan.** `computeLoadout` now matches a standard (non-loaner) slot only to a non-`TEMPORARY` asset, so a person whose only device of a type is on loan shows that slot empty and missing — intended (a loan is not a permanent fill), not a regression; visible in `it-core.spec.ts`'s "list shows loadout gaps" count moving from 1 to 2 missing once one seeded holder's device turned out to be `TEMPORARY`.

## 6. If you are an assistant reading this

Start with this file, then `HANDOVER.md` §0. Follow §3 above as standing instructions. Before proposing
work, check `HANDOVER.md` §8 and §9 for what is deferred and why. Do not merge or push without being asked,
do not seed a database people are using (the seed truncates every table), and when a plan and the code
disagree, the code wins and the plan gets amended.
