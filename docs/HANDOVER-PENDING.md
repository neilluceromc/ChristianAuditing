# Pending-work handover — parked on 2026-09-10

**Purpose.** Everything that was open when the user said "let's focus on the IT side first" (2026-09-10),
so it can be picked up later without re-deriving it. The long reference stays [`HANDOVER.md`](HANDOVER.md);
the short front door stays [`PICKUP.md`](PICKUP.md). This file only lists what is parked and where to
start on each item.

**Where the code stands at parking time.** `main` = `origin/main` at `93291f0`. Phases 1–19 were merged
and pushed. Staging (the office laptop, `192.168.203.183` since 2026-09-21; `.153` before) ran the
**Phase 18** build (`4cf5697`, 19 migrations); **Phase 19 (stock control D1, migration 20) was merged
but NOT yet deployed.**

**Where the code stands today (2026-09-22).** Staging runs the **Phase 26** merge (`e96fb2a`,
**25 migrations**) since the 2026-09-22 forced redeploy. `main` carries Phases 1–26 plus two unpushed
docs commits (`385b484`, `8c24c3b`) beyond `origin/main` `8dc21a1`. **Phase 27
(`phase-27-leftovers-sweep`) is code-complete at final tree `66445ed`, UNMERGED and UNPUSHED, and adds
migration 26** — see §1 below and `PICKUP.md` §4 item 1.

---

## 1. Operations — one command when the user says so

- **Redeploy staging** when the user asks. Staging already runs the **Phase 26** merge (`e96fb2a`,
  **25 migrations**) since the 2026-09-22 forced redeploy, so there is nothing pending on it today. The
  one command, whenever a merge needs carrying over:

  ```bash
  powershell -ExecutionPolicy Bypass -File .\scripts\deploy-staging.ps1 -Force
  ```

  `-Force` is needed because the merge happens on the laptop, so the plain run sees nothing new and
  skips. Verify afterwards: `docker compose ps` (web healthy), `docker compose exec -T web npx prisma
  migrate status` (**25 found, up to date** as things stand), HTTP 200 on
  `http://127.0.0.1:3000/login` and on the LAN URL `http://192.168.203.183:3000`.
  Never seed staging — the seed truncates every table.
  Migrations 20–25 rode earlier redeploys: 20 (`stock_control`) and 21 (`employee_transfers`) the
  2026-09-10 `-Force`, 22 the 2026-09-15 one, 23 (`stock_lots_and_allocations`, with its asserted
  backfill) the first 2026-09-17 one, 24 (`parkinson_deadlines`) the second, and 25
  (`repair_end_and_holds`) the 2026-09-22 one.

- **Phase 27's migration 26 is the next one to apply, and it needs a check run first.**
  `phase-27-leftovers-sweep` is code-complete at `66445ed` but **UNMERGED and UNPUSHED** — merging,
  pushing and the redeploy are all the user's decisions. Migration 26 `case_insensitive_names` applies
  on the first `-Force` redeploy after that branch is merged, and `migrate status` should then read
  **26 found, up to date**. It is additive — one ordinary index on `AuditEntry ("entityType",
  "action")` plus seven `lower()` UNIQUE indexes on asset categories, asset types (scoped by
  `"categoryId"`), departments, equipment policies, vendors, and stock categories by name and by prefix
  — but it **FAILS LOUDLY** on a database that already holds two names differing only by case, leaving
  the schema unchanged. **Run this on staging first, and expect zero rows from every statement:**

  ```sql
  select 'AssetCategory',   lower(name),               count(*) from "AssetCategory"   group by 2    having count(*) > 1;
  select 'AssetType',       "categoryId", lower(name), count(*) from "AssetType"       group by 2, 3 having count(*) > 1;
  select 'Department',      lower(name),               count(*) from "Department"      group by 2    having count(*) > 1;
  select 'EquipmentPolicy', lower(name),               count(*) from "EquipmentPolicy" group by 2    having count(*) > 1;
  select 'Vendor',          lower(name),               count(*) from "Vendor"          group by 2    having count(*) > 1;
  select 'StockCategory',   lower(name),               count(*) from "StockCategory"   group by 2    having count(*) > 1;
  select 'StockCategory',   lower(prefix),             count(*) from "StockCategory"   group by 2    having count(*) > 1;
  ```

  Staging was checked clean on 2026-09-22 (11 categories, 19 types, 5 departments, 1 policy, 2 vendors,
  0 stock categories), but it is a live database that people are typing into — run the check again at
  the redeploy rather than trusting this line. Full facts: `HANDOVER.md` (t), `PICKUP.md` §1 and §4
  item 1.

## 2. Needs the user or Administrator rights on the laptop

From [`staging-run-sheet.md`](staging-run-sheet.md); none of these can be done by an agent (UAC elevation
is blocked in auto mode):

- Decide **which machine owns `192.168.203.183`** (renumbered from `.153` on 2026-09-21), or use a DNS name — the value is printed on every label, so any label printed before 2026-09-21 encodes the dead `.153` address and needs reprinting.
- Network profile → **Private**; add the inbound firewall rule for TCP 3000 (inert while Public).
- UniFi **DHCP reservation** for the address.
- Reach the app from **another PC and a phone**.
- **Print one label sheet**, tape-measure the 100 mm calibration bar, scan one QR.
- **Rotate the five seeded passwords** (`SEED_PASSWORD` in `.env`) and **copy a backup off** the laptop
  (backups land on the same disk as the data).

## 3. Data owed by Purchasing

- The **cleaned supplier list** → `/purchases/suppliers/import` (template columns: Name, Registered name,
  Category, Contact person, Phone, Email, Address, Registration no, Contract status, Contract start,
  Contract end, Notes; bank details are entered on each supplier's page, never imported).
- The **opening stock sheet** → `/stock/import` (Code optional, Name, Category, Unit, Pack size, Reorder
  level, Opening quantity, Unit cost (accepted, ignored), Notes). Opening quantities are recorded once, on
  new items only; existing items take receipts and adjustments.

## 4. Two visual checks never done by a human

The inventory class-switch chips and Finance's IT/Purchasing tabs by eye, and the Register form signed in
as `purchasing@`. Both pass e2e and axe; nobody has looked at them.

## 5. Development candidates parked here

### 5.1 D2 — stock control, second half (own brainstorm and spec) — **SHIPPED in Phase 22**
(`phase-22-stock-control-d2`, code-complete 2026-09-16 at final tree `a4b57b5` after the final-review fix wave; merged to `main` via `--no-ff` `26aaf82` and pushed 2026-09-16)

Consumed what Phase 19 records. Scope agreed in the D1 brainstorm (spec
`superpowers/specs/2026-09-09-stock-control-design.md` §1 "Out"); implemented per spec
`superpowers/specs/2026-09-16-stock-control-d2-design.md`, plan
`superpowers/plans/2026-09-16-phase-22-stock-control-d2.md` (10 tasks, `D-1`…`D-20`):

- **FIFO lot consumption** — **shipped:** an issue consumes the oldest `StockLot`s first; cost of issue and
  on-hand value from lot `unitCost`; an allocation table (movement → lot, quantity) so a lot's remaining
  quantity is derived, never stored.
- **Expiry** — **shipped:** an optional expiry date on any lot with warnings (list facet and pill, item page
  Lots card, the "Expiring within 30 days" Home tile) and earliest-expiry-first consumption on issue and
  write-off.
- **Reports and exports** — **shipped:** on-hand and value (category subtotals, an uncosted toggle),
  consumption by department and month (grid, flat export), and expiring/expired lots (window chips) — each
  with an xlsx export.
- **Receipt documents** — **shipped:** `StockLotDocument`, a fourth per-owner document table mirroring
  `AssetDocument`, attached from the Lots card and downloaded through a role-gated route.
- Open question, now decided: whether Purchasing wants **requisitions** after using the ledger —
  **decided no on 2026-09-16** (D2 brainstorm); revisit only if Purchasing asks after using the ledger.
- Known deferred minors from D1 — **all closed in Phase 22** (spec §8, "The D1 leftovers closed here"): the
  importer now refuses an archived category, in the planner and the apply path (plan D-10 closed);
  `SupplierOption.archived` — the unused prop removed from `receive-form.tsx`, and the caller's population
  of it with it; the redundant `state === "OPEN"` re-check in `stocktake-review.tsx` removed; `canCount` —
  the always-true prop removed from `stocktake-count.tsx` (its one call site never rendered it any other
  way); the planner's duplicate-key gap — an import code row now also registers the matched item's `new:`
  key; a Home worklist low-stock signal — shipped as the "Below reorder level" `Stat` tile on Purchasing
  Home, linking to `/stock?low=1`. One more landed as a bonus, not originally on this list: the import's
  unit cost is now honoured on CREATE rows (the "Unit cost is ignored" notice removed) — spec §8 item 6.

### 5.2 Other candidates (PICKUP §4 item 13, unchanged order)

- **Depreciation module** (Finance; own brainstorm — straight-line by category with a useful life and
  salvage, a monthly schedule report, and Finance's confirmation as the capitalisation date were the ideas
  floated; nothing designed). Still the first candidate; Phase 27's spec §2 names it a non-goal again.
- **Purchasing bulk import** of assets (the IT importer is admin/IT only). Also re-recorded as a
  non-goal by Phase 27's spec §2.
- ~~The Replace dialog's headerless **"other spares" list** when no same-type spare exists.~~
  **✅ SHIPPED in Phase 24 —** `ComboOption` gained `group?: string` and `EntityCombobox` renders a
  heading wherever the group changes, so the picker reads SAME TYPE / OTHER SPARES, and only OTHER
  SPARES when no same-type spare exists. This line should have come off the list at Phase 24's close;
  §6 below has always carried the closure.

### 5.3 Small deferred items with a home in the plans' D-blocks

Phase 17 D-11 (approvals double count, work-page note wording, `parsePage` duplication, a collation comment)
— **three of the four ✅ CLOSED in Phase 27:** the work-page note now reads
`Showing the first {rows.length} — the oldest first.`, so it states what it literally renders;
`parseIntParam` in `src/lib/paging.ts` is the one parser behind both `parsePage` and
`parseTimelineCursor`; and `byWhenDesc` in `src/lib/timeline.ts` carries the comment explaining that
cuids are ASCII and compare byte-wise, so the JS tiebreaker orders exactly as Postgres' `id desc` does.
**The approvals double count stays open.**
Phase 18 D-19 (edit-save toast vs redirect wording) and its review minors — **one ✅ CLOSED in Phase 27:**
the supplier runner's two unused setters (`setError`/`setFieldErrors`) left the returned object, and
supplier documents now order by created date **then id** so the list has a deterministic tiebreaker.
Phase 19 D-30 (export plain branch ordering done; audit sentences done; the rest cosmetic). Phase 24 M-11
— **✅ CLOSED in Phase 27:** the seed's `CM-0002` weekly-cleaning issue moved to day −11, before the
stocktake snapshot it has to precede. None blocks anything.

Phase 23 `D-15` (the final review's six deferred Minors, all cosmetic or one-line): **✅ CLOSED in
Phase 27 —** the Purchasing Home tile "Stocktakes past close-by" stayed `neutral` when the count was
> 0 where the other overdue surfaces turn `accent`; `Stat` gained `tone` (`text-accent` on the value
span plus a `data-tone` attribute, plan P-3 — coloured text, not pill chrome, because a stat number is
not a pill) and the tile passes `accent` when the count is over zero. **✅ CLOSED in Phase 27 —** the
receive form's supplier combobox had no visible "No supplier" clear, so clearing a chosen supplier
meant emptying the field by hand; its options now lead with "No supplier", which calls `onChange("")`.
**✅ CLOSED in Phase 27 —** `EntityCombobox`'s `autoFocus` opened the dropdown on mount, which is what
put a second listbox on `/stock/issue` and `/stock/receive`; `onFocus` now only resets the active
option and the list opens on click, on typing or on ArrowDown, so `aria-expanded` is false until the
user asks — the ARIA 1.2 combobox default. The trailing clause about the e2e's combobox picks being
scoped to their own listbox is now historical: the scoping stays, but it is no longer working around a
second listbox. (One test-only consequence, recorded in plan `D-6`: `e2e/quick-forms.spec.ts` case 2
relied on focus opening the list and now clicks.) **✅ CLOSED in Phase 25 —** the offboarding
`progress` and `due` facet counts did not narrow each other (exactly as `department` has always behaved,
written down in the query's own comment at the time), and now do: the pure `narrowedFacetCounts` in
`src/lib/offboarding-list.ts` tallies each facet over the candidate set with that facet's own selection
removed, so `due=overdue` changes the progress counts and `progress=complete` zeroes the due counts, while
`department` keeps its documented SQL-groupBy behaviour; **✅ CLOSED in Phase 25 —** the wizard header
rendered no `DuePill` once an employee was OFFBOARDED, so a completed offboarding lost the date from the
header while the report still carried it, and now renders one with the new `DuePill.override` reading a
neutral `closed`, so the date stays visible without a finished case ever reading "overdue"; and two wording
reconciliations between spec §5.4/§8 and what landed. Also parked, and named in the fix wave's report
rather than dropped: `revalidateStocktake` still does not revalidate `/` (final-review Minor 6's other
half — inert today, since every `(app)` route is dynamically rendered), and `createEmployee`'s
unconditional date floor keeps its position (Task 4 Minor 5). None blocks anything.

**Two rulings recorded in Phase 27 instead of a change** (spec §5.6, plan `D-1`…`D-10`): the
**lapsed-contract banner** on the supplier page keeps `tone="attention"` — the Phase 18 plan
prescribed it and a lapsed contract is a heads-up, not a fault; and Phase 23 `D-15`'s remaining
"§5.4/§8 wording" item **was** the "No supplier" clear, now shipped, so that line is closed rather
than carried.

**Phase 27's own deferred Minors**, each re-verified by its review and parked with a reason:
**M-P27-1** the doc comment in `src/lib/activity-list.ts` still names the removed
`financeActivityWhere` — kept as provenance, so a reader grepping the old name lands on the sentence
that says where the predicate went; **M-P27-2** `renameRefRow`'s type-scoping `findUniqueOrThrow` can
throw P2025 in a tiny window — a pre-existing exposure of the `update` that follows it, and closing it
means a `conflict()` branch in every rename; **M-P27-3** the worklist note's `rows.length` is a no-op
for today's one capped caller — kept because the note now states what it literally renders for any
caller. Also parked by the final review: `Stat`'s `data-tone` in production markup (state attributes
already ship in this codebase), and the six inline `P2002` checks of §6 below.

---

## 6. The IT side — the current focus (2026-09-10 →)

The user chose to work on the IT workspace next. Candidates already on record (PICKUP §5, HANDOVER §8).
**Corrected 2026-09-17 (Phase 24, `D-2`):** this list was carrying three items as open that Phase 20 had
already closed — the Phase 24 brainstorm found it out, took the three that really were open, and shipped
them. Each line below now says where it stands.

- **Closed in Phase 20 —** `bulkChangeStatus` returned a bare `{ changed, skipped }` while `bulkAssign`
  named the skipped tags and why (Phase 16 put the change out of scope). Phase 20 §6 gap 1 gave both the
  same `{ tag, reason }[]` shape, and the bulk drawer renders the skipped list the same way for both.
- **Closed in Phase 20 —** `checkIdentifiers` leaked tag/serial existence across classes (accepted for
  Phase 16). Phase 20 §6 gap 2 made `cls` required and scoped both `where` clauses to it; a genuine
  cross-class collision now surfaces only at submit, as the pre-existing neutral conflict copy.
- **Shipped in Phase 24 —** the Replace dialog's headerless "other spares" list. `ComboOption` gained
  `group?: string` and `EntityCombobox` renders a heading wherever `headingBefore()` says the group
  changed, so the picker reads SAME TYPE / OTHER SPARES — and only OTHER SPARES when no same-type spare
  exists, which was the gap. The per-row "Same type" / "Other spare" note is gone: under a heading it
  said the same thing twice.
- **Answered in Phase 21 —** Direct IT changes leave no PENDING row, so the record's pending banner and
  `Open requests` stat only ever show Purchasing or legacy approvals for IT devices. Not built as a
  pending row: `Approval.appliedDirectly` (migration 22) makes every direct change queryable, the Closed
  tab's route chips and `via` filter separate it from queue approvals, its detail page carries a "How it
  was applied" card, and an admin Home section totals the last 7 days by kind.
- **Closed in Phase 20 —** the loaner rule read a standard slot as "missing" while a person's only device
  of that type was on loan. Phase 20 §6 gap 3 marks such a slot `coveredByLoan`, so the tile reads "on
  loan" instead of a policy gap.
- **Shipped in Phase 24 —** the repair-stage saved view still grouped DEFECTIVE assets in memory rather
  than in SQL (Phase 17 left it). The stage cut has been SQL since Phase 20; `listAssets` now pages
  `repairStageIds`' id set through `pagedSnapshot` instead of loading every candidate row with its
  includes. Stage *facet counts* deliberately stay on the candidate set (spec §0 decision 5).
- **Shipped in Phase 24 —** webhook delivery rows had no retention policy. The worker prunes
  `DELIVERED`/`DEAD` deliveries and `DONE`/`DEAD` jobs older than 90 days in id batches, at start and
  hourly, with `npm run worker:prune` for a one-off pass and the rule stated on the deliveries page.

**Phase 25 (IT navigation sweep) audited the whole IT surface — 47 routes — for dead ends and unwired
affordances before choosing, and shipped the half that needed no schema change.** It is code-complete on
`phase-25-it-navigation-sweep` at final tree `fab0780`, merged to `main` via `--no-ff` `bb577f8` and pushed 2026-09-21; see `HANDOVER.md` (r).

- **Shipped in Phase 25 —** starting an offboarding meant a trip through the Edit form. A new
  `startOffboarding` server action — a faithful twin of the Edit path (same guard order, same
  `minOffboardingDue` floor, one transaction with one audit row, the same seven revalidations) — puts a
  **Start offboarding** button with a **Complete by** date, defaulted to five working days, on the profile
  header for admin/IT whenever the employee is ACTIVE, and lands on the collection wizard.
- **Shipped in Phase 25 —** every reference shown on screen was a dead end that had to be retyped into a
  search. Eight sites became links: the asset record's pending banner ("Open request"), the asset
  timeline's ref, the employee timeline's refs and asset tags, both IT activity feeds (a trailing entity
  chip; the Purchasing callers pass none and are unchanged), the `HOLD` pill's holder, the profile's five
  newest open requests with `+N more`, the Home fleet bar's segments and legend
  (`/inventory?status=<STATUS>`), and `department` in the audit page's entity labels (name resolved, no
  link — there is no department route).
- **Shipped in Phase 25 —** a newly created employee landed on a profile with no next step, and
  `/employees` honoured `sort` in SQL but rendered plain headers, so sorting was reachable only by editing
  the URL. Creating now redirects to `?created=1` and the profile shows a banner offering **Assign
  devices** (a focusable `#loadout` anchor) and **Accountability form**; the Name field takes focus on the
  form; and a new client `EmployeesTable` builds `sortHrefs` exactly as `/inventory` does, with focusable
  rows that open on click or Enter under the house's selection and stop-propagation rules.
- **Shipped in Phase 25 —** the four deferred safety-net items. `(app)/error.tsx` catches a render
  failure inside the shell (digest, **Try again**, **Home**; it never prints `error.message`); five
  `loading.tsx` skeletons cover `/offboarding`, `/reservations`, the asset record, the employee record and
  the offboarding wizard, each shaped like the page beneath it; `offboarding/[employeeId]/not-found.tsx`
  answers a stale wizard link with "Not in the offboarding queue"; and `/offboarding` gained an Export
  button and route mirroring `/employees/export` row for row.

**Shipped in Phase 26 — holds that work + a repair end-date.** Phase 25's audit found both and split
them off because both need schema work; Phase 26 got its own brainstorm, spec and plan and delivered
both on `phase-26-holds-and-repair-end` (final tree `1442289` after the final-review fix wave; merged to
`main` as `a5883ad` and pushed 2026-09-22; migration 25 applied on staging by the 2026-09-22 `-Force` redeploy). Both
bullets below are closed — kept for the history, not as work:

- **Shipped in Phase 26 — reservations that can actually be created, released and expired.** Nothing in `src/server` ever created
  a `Reservation` — the only writer anywhere is `prisma/seed.ts` — and `HolderControl` exposes only
  `mode: "assign" | "return"`, so no screen can place a hold. `ReservationState` carries `RELEASED` and
  `EXPIRED`, but the single state write in the codebase is `ACTIVE → FULFILLED` when the reserved employee
  is assigned the asset, and nothing sweeps a hold at its `expiresAt`, so a long-expired hold still renders
  as live. `/reservations`' own empty-state copy ("Reserve a spare from an asset record when it is promised
  to someone but not yet assigned") and its banner ("Holds are placed and released on the asset record")
  therefore both describe a control that does not exist — and so did `HANDOVER.md` §8's "read-only by
  design" line, corrected there by this audit. **All of that shipped:** `reserveAsset` and `releaseHold`
  (`src/server/modules/reservations/actions.ts`, one audit row each) place and release a hold from the
  asset record, an empty policy slot's **Reserve a spare…** menu item on a profile, the profile's
  holding area and `/reservations`; `src/worker/holds.ts` sweeps ACTIVE holds past their Manila day to
  EXPIRED once at start and hourly after; and `/reservations` gained search, Employee and Department
  facets, four sortable headers, whole-row click and Release, so the empty state and the banner describe
  controls that now exist.
- **Shipped in Phase 26 — recording when a repair ended.** `RETURNED OK` showed `—` in the Down column because `downDays`
  returns `null` for anything not `status === "DEFECTIVE"`, and nothing anywhere records when a repair
  actually ended, so a completed repair's downtime cannot be reported at all. The phase would store a
  repair end-date on the asset (or on the repair record) and teach `downDays` to close the interval, which
  makes the Down column truthful for returned-OK assets and the repairs saved view reportable. **That is
  what shipped:** `Asset.repairEndedAt` (migration 25, additive and nullable) is stamped by
  `prepareLifecycle` on every path that leaves DEFECTIVE and cleared when an asset re-enters it, and
  `downDays` closes the interval on it — the dash now survives only where no end was ever recorded,
  because the migration's backfill fills only rows whose audit history shows the transition.

**Shipped in Phase 27 — IT and quality leftovers sweep.** The three items below were named out of
scope by Phase 24's spec §0 decision 1 and Phase 25's §2, carried by Phase 26, and closed together on
`phase-27-leftovers-sweep` (final tree `66445ed`, code-complete 2026-09-22; **unmerged and unpushed**;
it adds **migration 26** — see §1). Kept for the history, not as work:

- **Shipped in Phase 27 —** `/audit` class scoping of approval, category and type rows (only `asset`
  rows of the other class were excluded). `invisibleAuditRefs(role)` builds four id lists from the SEE
  map (`canSeeClass`, not the manage map — spec §0 decision 8, so Purchasing and Finance staff keep
  both classes' approvals) and `buildAuditWhere` emits one `NOT: { OR: […] }` branch per non-empty
  list, in the log, the entity facet and the export; an approval with no asset carries no class and is
  never hidden, and an all-class role runs no query at all. The Entity dropdown also gained Supplier,
  Stock item, Stock category and Stocktake, and `entityLabels` now resolves `asset-category` and
  `asset-type` to names instead of truncated cuids.
- **Shipped in Phase 27 —** case-insensitive uniqueness for reference data. **Migration 26**
  `case_insensitive_names` adds seven `lower()` UNIQUE indexes (asset categories, asset types scoped by
  category, departments, equipment policy **names**, vendors, stock categories by name and by prefix),
  and every create and rename checks case-insensitively inside its own transaction before the write,
  naming the row it clashes with; a rename excludes its own row, so "Laptop" → "LAPTOP" is still a
  rename. **Narrowed:** this line used to read "categories, types, departments, policy titles" — what
  shipped is policy **names**. `EquipmentPolicy.appliesToTitle` is untouched and **stays open**:
  `resolvePolicy` case-folds titles when it matches but they are stored raw, so `Accountant` and
  `accountant` still collide invisibly at resolve time (`HANDOVER.md` §8, Phase 7 Task 14).
- **Shipped in Phase 27 —** the activity feeds' action facet and their import-update sentences. One
  shared module (`src/lib/activity-list.ts`) and one server component (`ActivityListPage`, behind four
  five-line pages) give all four feeds an **Action** facet whose counts come from the same snapshot as
  the rows, a Clear link, a live entry count and a filtered empty state; every action that can reach a
  feed has a sentence and a facet label, and `update`/`import-update` print human field names sorted on
  the label ("updated department, join date on Nina Robles by import") instead of raw column keys.
  `/audit` itself still has no action facet — that half was never in scope.

Still open, each recorded in PICKUP §5 / HANDOVER §8:
- **DECIDED in Phase 27 (spec §0 decision 5), from Phase 24's final review (I-2, ruling R3):** the
  fuller ARIA shape for a grouped combobox — `role="group"` with an `aria-label` per block wrapping
  that block's options — **will not be built.** Phase 24 closed the accessibility finding additively
  (a heading `id` plus `aria-describedby` on the options under a *grouped* heading), which already gives
  assistive technology the group name; a `group` wrapper would only change the DOM
  `e2e/it-gaps.spec.ts` cases 4 and 7 assert on. **Revisit only on AT feedback.**
- **DECIDED in Phase 27 (spec §0 decision 6), from Phase 25 (spec §2, non-goals):** the Home **age
  histogram**'s buckets **stay unlinked.** Its buckets are rolling years since purchase; `/inventory`
  knows only calendar purchase years, so an honest link needs a new rolling-age facet, which is a
  feature and not a link. Recorded rather than left hanging.
- **DECIDED in Phase 27 (spec §0 decision 7), from Phase 25 (spec §2, non-goals):** **keyboard support
  stays at Enter on a focused row.** `/inventory` — the app's largest list and the one with no keyboard
  path — got it this phase through one shared helper (`rowOpenProps` in `components/ui/table.tsx`, now
  spread by the inventory, employees and holds tables), so the pattern is written once rather than a
  third time. Arrow-key roving, type-ahead and a shortcut layer across the lists stay out: they are a
  pattern decision, not a page edit.
- **New, from Phase 27's final review (M-2):** `/audit`'s **entity pill still renders the raw
  `vendor`** while the entity facet and the row chip both say "Supplier" (the facet gets it from a
  one-entry override map before `humanize`, plan P-10). The fix is a one-line `humanize` on the pill,
  but the pill is CSS-uppercased and an existing e2e asserts `ASSET` on it, so it needs its own e2e
  pass — which is why the wave recorded it instead of taking it.
- **New, from Phase 27 (ruling R5):** **six inline `P2002` checks live outside the five consolidated
  modules** — `suppliers/bank-actions`, `admin/webhook-actions`, `approvals`, `employees`,
  `offboarding`, and `receiving`/`reservations` actions. Phase 27 replaced the five hand-rolled helpers
  the spec named with the shared `isUniqueViolation`/`uniqueTarget` pair in `src/server/prisma-errors.ts`
  and stopped there. Each of the six is correct, carries its own module's message, and touches no
  `lower()` index, so swapping them onto the shared pair is a mechanical widening for whoever next opens
  those files — not a defect.

The brainstorm for the next IT phase decides which of these, and what else, goes in. The named
candidates on record are the **depreciation module** and the **Purchasing bulk import** (§5.2).
