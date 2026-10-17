# Pending-work handover — parked on 2026-09-10

**Purpose.** Everything that was open when the user said "let's focus on the IT side first" (2026-09-10),
so it can be picked up later without re-deriving it. The long reference stays [`HANDOVER.md`](HANDOVER.md);
the short front door stays [`PICKUP.md`](PICKUP.md). This file only lists what is parked and where to
start on each item.

**Where the code stands at parking time.** `main` = `origin/main` at `93291f0`. Phases 1–19 were merged
and pushed. Staging (the office laptop, `192.168.203.183` since 2026-09-21; `.153` before) ran the
**Phase 18** build (`4cf5697`, 19 migrations); **Phase 19 (stock control D1, migration 20) was merged
but NOT yet deployed.**

**Phase 41 update (2026-10-17).** Phase 41 (`phase-41-cris`: Cris, the in-app IT assistant - a mascot and chat box on every IT page for admin and it_staff that checks someone's items, assigns a spare by pick, scan or typed tag, replaces a laptop with outcome Defective, Triage or Missing, says who has a tag and lists spares in stock, with a Confirm-then-Undo safety chain and Settings › Cris; final code tree `ed6ce10`, 26 commits above plan commit `08d4f03`; adds MIGRATION 34 `20261018090000_cris`) is CODE-COMPLETE 2026-10-17 on branch `phase-41-cris`, MERGED to `main` via `37f1b00` (`--no-ff`, merged tree = tested tip; code tree `ed6ce10`, docs commit `e91d43d`) and PUSHED 2026-10-17 (33 commits; secret scan zero) and with staging REDEPLOYED 2026-10-17 at `37f1b00` (CI image pulled, `pg_dump -Fc` snapshot taken first (`staging-before-mig34.dump`, about 149 KB, 40 tables), IP check passed (.193), migration 34 `20261018090000_cris` applied, now 34 migrations (tables `CrisConversation`, `CrisMessage`, `CrisPendingAction`); web healthy; /login answers 200 locally and over the LAN); Cris is OFF on staging: its `.env` has no `ANTHROPIC_API_KEY`, and the owner adds it themselves. Spec commits `22a5115`, `6f7b289`, `99872f9` and `08d4f03` (approved) and plan commits `3ebc748` and `08d4f03` sit on `main`, pushed with the merge (`origin/main` = `37f1b00` before this docs fix); the worktree and branch `phase-41-cris` are removed. **Numbering changed:** Cris took Phase 41, so the audit's client-staff phase is now Phase 42 and the deeper asset management phase is now Phase 43 (the items below recorded as deferred to Phase 41 and Phase 42 now read 42 and 43). **Deploy notes:** migration 34 is additive (the `CrisConversation`, `CrisMessage` and `CrisPendingAction` tables) and the staging redeploy applied it (33 to 34; the snapshot `staging-before-mig34.dump` was taken first); Cris stays OFF on staging until the owner adds `ANTHROPIC_API_KEY` to staging's `.env` themselves (Settings › Cris then shows "Key: set on the server ✓"), after which the app is restarted (`deploy-staging.ps1 -Force`, or a compose restart of web and worker); the default model is Claude Haiku 5.5 (admins can switch to Sonnet 5.5 or Opus 5.5 in Settings › Cris); set a monthly spend cap in the Anthropic console; once the key is in, run one short live lookup, then a second message after changing page, to confirm there is no 400 (still owed); **local note:** the owner's untracked folder "Claude outputs/" (Cris images and the voiceover script) is listed in the main checkout's `.git/info/exclude`, which keeps the deploy script's clean-tree check passing; never commit or delete it; `CRIS_MODEL=fake` is for dev and e2e only and is refused in production. **Verification:** tsc and lint clean, vitest 2831 / 155 files, the full Playwright battery green in chunks on `inventory_dev:3100` (all 54 files pass plus 17 Cris cases on the fake model, 2 expected quick-login skips), the affected specs re-run green after the final fix wave, axe sweep clean; final review Ready after fixes (one fix wave). **Parked follow-ups (open):** the employee Timeline does not show "via Cris"; racing prefs saves between Settings and a second tab; `recordUndo` duplicates part of `commitDirect`; the rollover at 40 can leave an extra empty chat; the 3-minute one-reply guard versus a worst-case turn; fallback-iteration accounting and the month cost undercounting failed turns; the model-written assign / replace reason; a scan whose tag is not on the open spares card loses "Scanned ✓"; person-card links to records the person cannot open; a type-name filter for spares in stock. **Still open from Phase 38, carried forward unchanged:** should IT and viewers see peso amounts ("Value at cost") on profiles and offboarding at all? **Next:** Phase 42 (client staff and people flows; the six mockups are already on the canvas), then Phase 43 (deeper asset management). Record: `HANDOVER.md` (ah).

**Phase 40 update (2026-10-17).** Phase 40 (`phase-40-it-fixes`: fix what's broken, and the IT basics - a Keyboard shortcuts dialog and a phone shell, search by serial and holder, readable asset History and Timeline, offboarding that removes IT access, a Purchase reviews worklist group, triage with a reason, page titles and dismissable toasts; final code tree `808e23a`, 27 commits above plan commit `fc16778`; adds MIGRATION 33 `20261017120000_setup_removed`) is CODE-COMPLETE 2026-10-17, MERGED to `main` via `2469068` (`--no-ff`, merged tree = tested tip; docs commit `110a4a3`) and PUSHED 2026-10-17, with staging REDEPLOYED 2026-10-17 at `2469068` (CI image pulled, `pg_dump -Fc` snapshot taken first (`staging-before-mig33.dump`, 149 KB, 40 tables), IP check passed (.193), migration 33 `20261017120000_setup_removed` applied, now 33 migrations; web healthy; /login answers 200 locally and over the LAN, title "Sign in · Backroom IT"); spec `e3c9890` and plan `fc16778` sit on `main`, pushed with the merge; the worktree and branch `phase-40-it-fixes` are removed. **Deploy note:** migration 33 adds `REMOVED` to the `SetupState` enum (now DONE, NOT_YET, NOT_NEEDED, REMOVED); it is forward-only once anyone marks access "Removed", so do not roll staging back past `2469068` (an older image would break the employee pages that read the enum); restore the snapshot instead. **Deferred to Phase 41, by ruling:** raw approval, purchase-request and reservation states in pills; the palette's request state; employment enums in offboarding conflict messages; uppercase pill casing; "Offboarding" vs "Leaving" wording; worker-error raw codes; the waiting age for requests Finance sent back; IT access still "Removed" after cancelling an offboarding (with the cancel moving into the wizard). **Deferred to Phase 42:** Change status to Dispose / Donated still takes no reason. **Still open from Phase 38, carried forward unchanged:** should IT and viewers see peso amounts ("Value at cost") on profiles and offboarding at all? **Next:** Phase 41 (client staff and people flows), then Phase 42 (deeper asset management). Record: `HANDOVER.md` (ag).

**Phase 39 update (2026-10-17).** Phase 39 (`phase-39-no-long-scrolls`: no long scrolls - a tabbed profile side card, side panels for the long logs, paged stocktake / On hand / Expiry tables, bounded lists, spares loaded on demand; final code tree `4e79632`, 19 commits above plan commit `ee5a662`; adds NO MIGRATION) is CODE-COMPLETE 2026-10-17, MERGED to `main` via `8faf91b` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17, with staging REDEPLOYED 2026-10-17 at `1b502a1` (CI image pulled, `pg_dump -Fc` snapshot taken first, no migration, still 32 migrations); spec `3d033f4` and plan `ee5a662` sit on `main`, pushed with the merge. **Merged, pushed and on staging** (no migration). The standing design rule it records: a page never grows with the data. **Still open from Phase 38:** should IT and viewers see peso amounts ("Value at cost") on profiles and offboarding at all? Phase 39 changed nothing there. Follow-ups from its build: the stock Consumption report is not paged; the asset record header's spare list and Register's purchase-request select still load everything; Reserve still drops spares held for the same person client-side (after the 50 cap); no action-level tests for `listEmployeeNotes` / `spareCandidates`; no e2e for Esc cancelling a note edit in the notes panel; the shared Pagination drops focus when Next lands on the last page (house-wide); Expiry's "Expiring (n)" on the Expired tab uses a window that tab does not show. Record: `HANDOVER.md` (af).

**Phase 38 update (2026-10-17).** Phase 38 (`phase-38-equipment-by-client`: the Equipment by client report and export, and depreciation from the purchase month; final code tree `649767f`; adds NO migration) is CODE-COMPLETE, MERGED to `main` via `1b16921` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17, with staging REDEPLOYED 2026-10-17 at `a3cb693` (CI image pulled, `pg_dump -Fc` snapshot taken first, no migration, still 32 migrations; staging had 1 of 33 assets Finance-approved, so only its book value moved); spec `8391e22` and plan `a7f80d8` sit on `main`, pushed with the merge. The redeploy changed nothing stored; approved assets' book values dropped, because depreciation now starts at the purchase month and takes the current month. **Open question for the user:** should IT and viewers see peso amounts on profiles and offboarding at all ("Value at cost")? Today they do (Phase 29 / 37 behaviour). Follow-ups from its build: the export repeats the page's money mapping (a shared helper would remove the drift); "Held since" and the export dates use UTC (a day early before 08:00 Manila, house-wide); each row click re-runs the full query set; the e2e peso assertions do not distinguish a ₱0; the spec setup sits outside the try in `equipment-by-client.spec.ts`. Record: `HANDOVER.md` (ae).

**Phase 37 update (2026-10-17).** Phase 37 (`phase-37-clients-profile`: client staff, equipment policies per client or department, the profile redesign, a three-step Add employee; final code tree `b1f3c66`; adds migration 32 `20261016180000_clients_profile`) is CODE-COMPLETE, MERGED to `main` via `6050649` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17, with staging REDEPLOYED 2026-10-17 at `c8eca0e` (CI image pulled, `pg_dump -Fc` snapshot taken first, MIGRATION 32 applied, 32 migrations; all 5 departments read INTERNAL, the Finance standard kit's slots now read Laptop / Monitor / Docking Station / Headset / Phone / Monitor (shown "Monitor 2"), IT setup reads "Not recorded" for everyone, and no clients exist until added on Departments & clients); the figures below are older. Nothing is pending for Phase 37 except adding the clients on staging (Departments & clients) and giving each its equipment list. Follow-ups from its build: the reference-actions department create / rename / delete stay reachable by a hand-made call; extras and loans are not numbered (duplicate "More for Monitor" names); the IT setup select keeps its optimistic value on a rate-limit refusal; no action-level DB tests for the new actions; a fast "Create and add another" can hit the write-rate cap on spares; offboarding queries still order slots by name. Record: `HANDOVER.md` (ad).

**Where the code stands today (2026-09-25).** Staging runs `4a39db8` (the **Phase 32** merge plus the
Phase 33 spec commit, **26 migrations**) since the 2026-09-25 forced redeploy, at the laptop's new DHCP address
`http://192.168.203.79:3000` (`.56` 2026-09-23 → 2026-09-25; `.183` before). `main` = `origin/main` since the
Phase 28 push (Phase 27 merged via `--no-ff` `5dd3372`, Phase 28 via `--no-ff` `7214066`, both pushed
2026-09-22), with no unpushed commits on it. **Phase 27 (`phase-27-leftovers-sweep`,
final tree `66445ed`) is on `main` and on staging since the 2026-09-23 redeploy, which applied its
migration 26** — see §1 below and `PICKUP.md` §4 item 2. **Phase 28
(`phase-28-back-control`, a Back control on every page that has a parent; final tree `5a8bbcf`) is on
`main` too (merged `7214066`, pushed 2026-09-22)** — a bounded change with no
spec and no plan document (the record is `HANDOVER.md` (u)); the redeploy is the
user's decision. **It adds no migration** (26 stays), so the redeploy that would carry it is code-only
— but it would ride the same `-Force` that finally applies Phase 27's migration 26, so the
duplicate check comes first. **Phase 29 (`phase-29-employee-uiux`, Laws of UX applied to the
employee area; final tree `9660e6e`) is MERGED TO `main` via `--no-ff` `d76903b` and PUSHED (2026-09-23), and
it adds no migration either** — it rode the 2026-09-23 redeploy. The push also carried the two
docs-only commits `401b838` (the Phase 29 spec) and `1acd928` (the plan) that had sat on local
`main`; `main` = `origin/main` again after that push. **Phase 30 (`phase-30-inventory-uiux`, Laws of UX
applied to the inventory area; final tree `4e6fc7f`) is MERGED TO `main` via `--no-ff` `69f8545` and
PUSHED (2026-09-24), and adds no migration** — the push also carried `a94f47a` (the Phase 30 spec) and
`b582535` (the plan); `main` = `origin/main` again. Staging carries it since the 2026-09-24 code-only
redeploy. See `PICKUP.md` §4 item 1 and `HANDOVER.md` (w).
**Phase 31 (`phase-31-leftovers-sweep`, the leftovers sweep; final tree `7599d9e`) is MERGED TO `main`
via `--no-ff` `bcc7b16` and PUSHED (2026-09-24), and adds no migration** — `main` = `origin/main`; staging
carries it since the second 2026-09-24 code-only redeploy (`7a479e1`). See `HANDOVER.md` (x).
**Phase 32 (`phase-32-it-work-uiux`, Laws of UX on the IT screens where the work gets done; final tree
`e29e879`) is MERGED TO `main` via `--no-ff` `853d13d` and PUSHED (2026-09-24), and adds no migration** — the
push also carried `7b878ed` (spec) and `4b77f59` (plan); `main` = `origin/main`. Staging carries it
since the third 2026-09-24 code-only redeploy (`2e333ef`). See `HANDOVER.md` (y).
**Phase 33 (`phase-33-queues-records-uiux`, Laws of UX on the IT queues and records; final tree `fd2ee57`) is
MERGED (`9bc7785`) and PUSHED 2026-10-01, and adds no migration** — staging still runs `4a39db8`; the
code-only redeploy is the user's decision. See `HANDOVER.md` (z).
**Phase 36 (`phase-36-own-tags-real-types`: typed tags, Type always asked, Laptop types data fix, people search, Schedule by category) is CODE-COMPLETE (2026-10-16), merged `033c061`, pushed and on staging 2026-10-16 (migration 29 applied), and adds MIGRATION 29 (data only)** - it retires the suggested-tag and model-sets-the-type behaviour (nothing in this file listed either as parked, so nothing is struck through); the merge, push and redeploy are the user's decisions, and on the redeploy staging's Laptop types are renamed and BR-LT-0201 moves to MacBook. See `HANDOVER.md` (ac).
**Phase 34 (`phase-34-register-labels`, the Register and Labels redesign; final code tree `f7c4f70`) is
CODE-COMPLETE (2026-10-15), MERGED to `main` via `ffbc0e8` (`--no-ff`, merged tree = tested tip `cf39923`) and PUSHED 2026-10-15; staging REDEPLOYED 2026-10-15 at `07b1f32` (migration 27 applied; image built by GitHub Actions), and adds MIGRATION 27 `20261014090000_register_labels`** —
so the staging redeploy that carries it APPLIES a migration (the deploy script runs `prisma migrate deploy`;
the migration reshapes the IT categories on real data and RAISEs on a Purchasing-class name clash). Battery
A 58 · B 87 (+2 skipped) · C 64 · D 70 · E1 61 · E2 56 · F 66 = 462 passed / 464 listed; 1786 unit / 106 files; 27 migrations. Merge, push and the redeploy are the user's
decisions; the spec (`908fe14`) and plan (`2904714`) commits also sit unpushed on local `main`. Owed after the
redeploy: the physical print-and-scan check of the new label (§4). See `HANDOVER.md` (aa).

---

## 1. Operations — one command when the user says so

- **Redeploy staging** when the user asks. Staging runs `4a39db8` (the **Phase 32** merge,
  **26 migrations**) since the 2026-09-25 forced redeploy, so nothing is pending on it today. The
  one command, whenever a merge needs carrying over:

  ```bash
  powershell -ExecutionPolicy Bypass -File .\scripts\deploy-staging.ps1 -Force
  ```

  `-Force` is needed because the merge happens on the laptop, so the plain run sees nothing new and
  skips. Verify afterwards: `docker compose ps` (web healthy), `docker compose exec -T web npx prisma
  migrate status` (**26 found, up to date** since 2026-09-23), HTTP 200 on
  `http://127.0.0.1:3000/login` and on the LAN URL `http://192.168.203.79:3000` (DHCP since 2026-09-25; `.56` 2026-09-23 → 25; `.183` before).
  Never seed staging — the seed truncates every table.
  Migrations 20–25 rode earlier redeploys: 20 (`stock_control`) and 21 (`employee_transfers`) the
  2026-09-10 `-Force`, 22 the 2026-09-15 one, 23 (`stock_lots_and_allocations`, with its asserted
  backfill) the first 2026-09-17 one, 24 (`parkinson_deadlines`) the second, and 25
  (`repair_end_and_holds`) the 2026-09-22 one.

- **Phase 27's migration 26 is the next one to apply, and it needs a check run first.**
  `phase-27-leftovers-sweep` (final tree `66445ed`) is **merged to `main` (`5dd3372`) and pushed** — the
  redeploy is the user's decision. Migration 26 `case_insensitive_names` applies
  on the next `-Force` redeploy, and `migrate status` should then read
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

- Decide **which machine owns the app's address** — `192.168.203.79` since 2026-09-25, a DHCP lease (`.56` DHCP 2026-09-23 → 2026-09-25; `.183` static 2026-09-21 → 2026-09-23; `.153` before) — or use a DNS name; the value is printed on every label, so every label printed before 2026-09-25 encodes a dead address and needs reprinting, and a DHCP lease can move again without a reservation.
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

**Phase 34 adds one physical check:** print a sheet of the redesigned label from the Labels tab on a real A4
sheet on the office printer, measure the 100 mm calibration bar, and scan a barcode and a QR with the office
scanner and a phone. Owed once staging runs Phase 34 (see `HANDOVER.md` (aa)).

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

### 5.2 Other candidates (PICKUP §4 item 14, unchanged order)

- ~~**Depreciation module** (Finance; straight-line by category with a useful life and salvage, a monthly
  schedule report, and Finance's confirmation as the capitalisation date).~~
  **✅ SHIPPED in Phase 35 (merged `2963bc7`, pushed and on staging 2026-10-15, migration 28) —** per-category
  policies, per-asset overrides, the year Jan–Dec schedule, the Finance asset register and asset page. The same
  phase added **registration review**: every registered asset goes to Finance, which approves it (or approves it
  as not capitalised) or sends it back with a checklist and note; IT and Purchasing fix it and reply. Disposals
  are still ignored by depreciation (spec §1). Record `HANDOVER.md` (ab).
- **Purchasing bulk import** of assets (the IT importer is admin/IT only). Also re-recorded as a
  non-goal by Phase 27's spec §2.
- ~~The Replace dialog's headerless **"other spares" list** when no same-type spare exists.~~
  **✅ SHIPPED in Phase 24 —** `ComboOption` gained `group?: string` and `EntityCombobox` renders a
  heading wherever the group changes, so the picker reads SAME TYPE / OTHER SPARES, and only OTHER
  SPARES when no same-type spare exists. This line should have come off the list at Phase 24's close;
  §6 below has always carried the closure.

### 5.3 Small deferred items with a home in the plans' D-blocks

**Phase 33 — "queues and records" (the second half of the 2026-09-24 IT-screens audit) — MERGED (`9bc7785`), from
`phase-33-queues-records-uiux` (`fd2ee57`); the list below is the scope it took (record `HANDOVER.md` (z)).**
The audit file's findings not taken by Phase 32 (spec `2026-09-24-it-work-ux-design.md` §2): the
old-toolbar sweep on `/offboarding`, `/reservations`, `/approvals` and `/audit` (house search shape,
busy transition, value-only chips, `page 1 of 1` hidden); the rest of `/reservations` (the permanent
banner, per-tab columns, an expiry count; a Reserve dialog was declined); `/inventory/labels` (stale
empty-state copy, a tags box for pasted or scanned tags, `Start at label N`, skipped tags named, a
class-aware crumb, operator wording); `/approvals` and its detail (a header with one primary, one-step
approve, Next in queue, card order, error text, a link back to the offboarding, a queue row menu, search
and a Type facet, friendly states); `/audit` and the feeds searchable by what the Entity column shows.
Open product questions carried over: one-step approve (Q4), the labels tags box (Q8) and `Start at label
N` (Q8b). Also Phase 32's display wording "no sync yet" on the employee profile and the farewell
report. The audit itself is not committed; its findings are summarised here and in the spec.


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

**Phase 30's parked items** (spec §2), each with where to start: **merging the History and Timeline
tabs** (F-RECORD-5) into one audit-and-approvals stream with expandable field diffs — its own phase;
start at `mergeTimeline` in `src/lib/timeline.ts` and the record's `(record)/history` and
`(record)/timeline` pages, and expect two e2e files to pin the tabs; **Record RMA… / Record quote…
dialogs on the Repair card** (F-RECORD-13) — start at the Repair card in
`src/app/(app)/inventory/[id]/(record)/page.tsx` and `src/lib/repairs.ts`; it needs its own server
action in `src/server/modules/inventory/actions.ts` and repair-stage tests; **a record-shaped list
loading skeleton** (the second half of F-LIST-16; the list-navigation pending state shipped) — start
at `src/app/(app)/inventory/loading.tsx`; **Serial and Loan due as optional columns** (the second
half of F-LIST-17; the `Saved for you` caption shipped) — start at `INVENTORY_COLUMNS` in
`src/components/inventory/inventory-table.tsx` and `COLUMN_PREF_KEYS` in `src/lib/column-prefs.ts`.
What Phase 30 ships knowingly is listed in `HANDOVER.md` (w).

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
`phase-27-leftovers-sweep` (final tree `66445ed`, code-complete 2026-09-22; **merged to `main` as `5dd3372`
and pushed 2026-09-22**; it adds **migration 26**, pending on staging — see §1). Kept for the history, not as work:

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
