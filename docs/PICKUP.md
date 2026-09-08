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
| Branch | `main`, **level with `origin/main`** after the Phase 17 push (merge `aef53fa`, 2026-09-08) — count with `git rev-list --count origin/main..main` before trusting this. Phase branches (`phase-10-polish` … `phase-14-department-owned-classes`) exist only on the old dev laptop; `phase-15-direct-it-lifecycle`, `phase-16-registration-custody` and `phase-17-scale-sweep` were merged and deleted on the staging laptop. All are fully contained in `main`. **Staging runs the Phase 17 merge** (`aef53fa` plus its docs commit) since the second 2026-09-08 forced redeploy (migration 18 applied; 16 and 17 came with the first) — use `scripts/deploy-staging.ps1 -Force` whenever the merge happened on this laptop, because the plain run sees nothing new and skips. |
| Stack | Next.js 15 App Router · Prisma 6 · PostgreSQL 16 (Docker) · Auth.js v5 · Tailwind v4 · Playwright · vitest. Node ≥ 22, npm ≥ 11 (dev machine ran Node 24). |
| Database | 18 migrations, additive only. `prisma migrate reset` is **not** used in this project. |
| Battery, last run 2026-09-08 (Phase 17 final tree `4f7b29e`, the tree merged as `aef53fa`) | `tsc` clean · `lint` clean · **18 migrations** · **1056 unit / 58 files** · **239 e2e / 19 files** by `--list`. Four foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: **54 passed (3.4m) · 67 passed (3.9m) · 63 passed (4.0m) · 55 passed (5.9m) = 239 / 239**, zero failed, zero did-not-run. The last chunk needed one test-only fix first: `custody.spec.ts` case 7 waited on a toast the previous add had left showing and failed twice after `admin` and `axe-sweep` in the same server (plan `D-12`); it now waits on the slot chip. Commands and history: `HANDOVER.md` §0 item 9. |
| Last two phases | **Phase 17** — the scale sweep: one pure `pageOf(total, requested, size)` rule (`src/lib/paging.ts`, `ENTITY_PAGE_SIZE` 25 / `LOG_PAGE_SIZE` 50) pages every list that can grow — approvals, offboarding, reservations, admin users, webhook deliveries, plus the inventory and audit pages' clamped-page rendering — each ordered by its key(s) then `id` and clamped server-side to the last page; the Employees list splits into a SQL-paged plain path and a narrow `HeldAssetLike`-select gaps path, never reading a full employee row outside the current page; the asset History and the two merged Timelines page with a `?before=&skip=` cursor (`mergeTimeline`, whose `skip` now accumulates across pages so a tie group longer than one page is never truncated); `groupWork` caps Worklist sections and renders "See all 50+" honestly instead of an undercount; `headcountByPolicy` replaces the policies page's 600-row employee read with one grouped query; one additive migration adds seven indexes (17 → 18). Spec `superpowers/specs/2026-09-08-scale-sweep-design.md`, plan `superpowers/plans/2026-09-08-phase-17-scale-sweep.md` (12 amendments, `D-1`…`D-12` — the final-review fix wave added `D-10`/`D-11`, the final battery `D-12`). **MERGED TO `main` via `--no-ff` `aef53fa` AND PUSHED (2026-09-08); branch and worktree removed; staging redeployed.** **Phase 16** — registration, policy exceptions, loans, bulk assign and the signed form: the batch page (`/inventory/register`) gains the Purchasing fields (warranty, brand, notes, invoice ref/document) and a live duplicate check shared with the single-asset form; loadouts apply per-employee ADD/WAIVE exceptions before slots are computed (`effectiveSlots`), and a `PolicySlot.loaner` flag lets a slot fill only from a `TEMPORARY` device (an unmatched one reads "on loan", never an extra); `Asset.loanDueAt` threads through the shared lifecycle executor and a metadata-only `setLoanDue`; `bulkAssign` hands out several spares in one transaction beside `bulkChangeStatus`; a signed accountability form is recorded on the employee (`Acknowledgement`) with its own safe-download route and an "issued since last signature" hint. Spec `superpowers/specs/2026-09-07-it-registration-custody-design.md`, plan `superpowers/plans/2026-09-07-phase-16-registration-custody.md`. **MERGED TO `main` via `--no-ff` `83643b4` AND PUSHED (2026-09-08); branch and worktree removed.** |

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

1. **Phase 17 — the scale sweep — is DONE.** Merged to `main` via `--no-ff` `aef53fa` and pushed, 2026-09-08
   (branch and worktree removed; staging redeployed with `-Force`, migration 18 applied): pagination on Approvals, Offboarding, Reservations,
   Admin users and webhook deliveries (plus the inventory and audit pages' clamped-page rendering); the
   Employees list paged in SQL with loadout computed only for the page; a `?before=&skip=` cursor on the
   asset History and the two merged Timelines (`mergeTimeline`, whose `skip` now survives a tie longer
   than a page); `take`/ordering tiebreakers everywhere `skip`/`take` is used; `headcountByPolicy`
   replacing the 600-row employee read on the policies page; the Worklist's remaining sections capped and
   saying "See all 50+" honestly. Spec `superpowers/specs/2026-09-08-scale-sweep-design.md`, plan
   `superpowers/plans/2026-09-08-phase-17-scale-sweep.md` (12 amendments, `D-1`…`D-12` — the final-review
   fix wave added `D-10`/`D-11`, the final battery `D-12`). Nothing of this phase remains open.
   **Next candidates, in order: the §9 stakeholder subsystems (item 5 below) and the depreciation module
   (item 4 below)** — no further scale or feature work is queued ahead of them.
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
- Phase 15 changed Home dismissal keys from `KIND:id` to `section:id`, so dismissals made earlier on deploy day reappear until cleared again — one-day effect.
- Backups land on the same disk as the data; copy them off periodically.
- **`checkIdentifiers` (Phase 16) leaks existence across classes.** The live duplicate check queries the whole `Asset` table regardless of `cls`, so IT registering a laptop can learn that a tag or serial is "already registered" even when the matching row is a Purchasing asset IT cannot otherwise see — accepted, since it only ever confirms existence, never any detail of the other class's row.
- **`bulkChangeStatus` still returns a bare `{ changed, skipped }` count**, unlike the new `bulkAssign` (Phase 16), which names which tags it skipped and why. Spec §10 puts changing `bulkChangeStatus`'s return shape explicitly out of scope for this phase.
- **Signing-date tolerance (Phase 16, plan `D-13`) is a one-day window, not true local-timezone awareness:** the server refuses only a date later than the UTC date of `now + 1 day`, so a signing date genuinely one day in the future (not just "tomorrow" at 03:00 PHT) would also be accepted. Traded deliberately — a wrong refusal at local midnight was worse than the one-day slack.
- **The loaner rule (Phase 16 §3.3, spec decision 8) reads a standard slot as "missing" from deploy day on, if it is filled by a device on loan.** `computeLoadout` now matches a standard (non-loaner) slot only to a non-`TEMPORARY` asset, so a person whose only device of a type is on loan shows that slot empty and missing — intended (a loan is not a permanent fill), not a regression; visible in `it-core.spec.ts`'s "list shows loadout gaps" count moving from 1 to 2 missing once one seeded holder's device turned out to be `TEMPORARY`.
- **The repair-stage saved view and the `gaps=1` facet counts were deliberately left untouched by Phase 17.** The plan's Global Constraints named both as "behaviour that must not change": the repair-stage view (`?stage=&down=`) still groups DEFECTIVE assets in memory rather than in SQL, and the employees list's facet counts under `gaps=1` are computed the same way they were before this phase. Both remain by decision, not oversight — revisit if either set grows enough to matter at scale.
- **Webhook delivery rows have no retention policy.** Phase 17 paginated the admin deliveries list (Task 4), but nothing prunes old `WebhookDelivery` rows — the table grows without bound. A storage and query-cost concern for later, not yet user-facing.
- **The merged-timeline cursor's `skip` URL parameter is clamped.** Flagged during Phase 17 (plan `D-8`'s fix) as unclamped; closed in the final-review fix wave (plan `D-11`): `parseTimelineCursor` now clamps `skip` to `TIMELINE_MAX_SKIP = 1_000` on the way in, so a hand-edited URL can no longer inflate `mergeTimeline`'s per-source `take = limit + 1 + skip`. No longer a follow-up.

## 6. If you are an assistant reading this

Start with this file, then `HANDOVER.md` §0. Follow §3 above as standing instructions. Before proposing
work, check `HANDOVER.md` §8 and §9 for what is deferred and why. Do not merge or push without being asked,
do not seed a database people are using (the seed truncates every table), and when a plan and the code
disagree, the code wins and the plan gets amended.
