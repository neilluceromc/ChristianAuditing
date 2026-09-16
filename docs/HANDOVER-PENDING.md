# Pending-work handover — parked on 2026-09-10

**Purpose.** Everything that was open when the user said "let's focus on the IT side first" (2026-09-10),
so it can be picked up later without re-deriving it. The long reference stays [`HANDOVER.md`](HANDOVER.md);
the short front door stays [`PICKUP.md`](PICKUP.md). This file only lists what is parked and where to
start on each item.

**Where the code stands at parking time.** `main` = `origin/main` at `93291f0`. Phases 1–19 are merged and
pushed. Staging (the office laptop, `192.168.203.153`) runs the **Phase 18** build (`4cf5697`, 19
migrations); **Phase 19 (stock control D1, migration 20) is merged but NOT yet deployed.**

---

## 1. Operations — one command when the user says so

- **Redeploy staging** to pick up Phase 19. Migration 20 `stock_control` is additive (six new tables, an
  append-only trigger, sign checks, one sequence); it applies on start:

  ```bash
  powershell -ExecutionPolicy Bypass -File .\scripts\deploy-staging.ps1 -Force
  ```

  `-Force` is needed because the merge happened on the laptop, so the plain run sees nothing new and
  skips. Verify afterwards: `docker compose ps` (web healthy), `docker compose exec -T web npx prisma
  migrate status` (20 found, up to date), HTTP 200 on `http://127.0.0.1:3000/login` and the LAN URL.
  Never seed staging — the seed truncates every table.
  Phase 20's migration 21 (`employee_transfers`) rode the 2026-09-10 `-Force` redeploy and Phase 21's
  migration 22 the 2026-09-15 one; Phase 22's migration 23 (`stock_lots_and_allocations`, with an asserted
  backfill) the 2026-09-17 one.

## 2. Needs the user or Administrator rights on the laptop

From [`staging-run-sheet.md`](staging-run-sheet.md); none of these can be done by an agent (UAC elevation
is blocked in auto mode):

- Decide **which machine owns `192.168.203.153`**, or use a DNS name — the value is printed on every label.
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

### 5.2 Other candidates (PICKUP §4 item 5, unchanged order)

- **Depreciation module** (Finance; own brainstorm — straight-line by category with a useful life and
  salvage, a monthly schedule report, and Finance's confirmation as the capitalisation date were the ideas
  floated; nothing designed).
- **Purchasing bulk import** of assets (the IT importer is admin/IT only).
- The Replace dialog's headerless **"other spares" list** when no same-type spare exists.

### 5.3 Small deferred items with a home in the plans' D-blocks

Phase 17 D-11 (approvals double count, work-page note wording, `parsePage` duplication, a collation comment);
Phase 18 D-19 (edit-save toast vs redirect wording) and its review minors; Phase 19 D-30 (export plain
branch ordering done; audit sentences done; the rest cosmetic). None blocks anything.

---

## 6. The IT side — the current focus (2026-09-10 →)

The user chose to work on the IT workspace next. Candidates already on record (PICKUP §5, HANDOVER §8):

- `bulkChangeStatus` returns a bare `{ changed, skipped }` while `bulkAssign` names the skipped tags and
  why (Phase 16 put the change out of scope).
- `checkIdentifiers` leaks tag/serial existence across classes (accepted for Phase 16; a class-scoped check
  or a neutral message would close it).
- The Replace dialog's headerless "other spares" list.
- **Answered in Phase 21 —** Direct IT changes leave no PENDING row, so the record's pending banner and
  `Open requests` stat only ever show Purchasing or legacy approvals for IT devices. Not built as a
  pending row: `Approval.appliedDirectly` (migration 22) makes every direct change queryable, the Closed
  tab's route chips and `via` filter separate it from queue approvals, its detail page carries a "How it
  was applied" card, and an admin Home section totals the last 7 days by kind.
- The loaner rule reads a standard slot as "missing" while a person's only device of that type is on loan.
- The repair-stage saved view still groups DEFECTIVE assets in memory rather than in SQL (Phase 17 left it).
- Webhook delivery rows have no retention policy.

The brainstorm for the IT phase decides which of these, and what else, goes in.
