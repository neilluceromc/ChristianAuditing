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
  Phase 20's migration 21 (`employee_transfers`, additive; code-complete on `phase-20-it-people-and-gaps`,
  unmerged) will ride the same `-Force` redeploy once it is merged to `main`.

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

### 5.1 D2 — stock control, second half (own brainstorm and spec)

Consumes what Phase 19 records. Scope agreed in the D1 brainstorm (spec
`superpowers/specs/2026-09-09-stock-control-design.md` §1 "Out"):

- **FIFO lot consumption**: an issue consumes the oldest `StockLot`s first; cost of issue and on-hand value
  from lot `unitCost`; an allocation table (movement → lot, quantity) so a lot's remaining quantity is
  derived, never stored.
- **Expiry**: an optional expiry date on pantry lots with warnings (list facet, item page, maybe Home).
- **Reports and exports**: quantities and value on hand, item history, consumption by department and month.
- **Receipt documents** (a fourth per-owner document table mirroring `AssetDocument`).
- Open question to settle first: whether Purchasing wants **requisitions** after using the ledger.
- Known deferred minors from D1 to fold in: the importer does not refuse an archived category (plan D-10);
  `SupplierOption.archived` unused; a redundant OPEN check in the review; `canCount` always true; the
  planner's duplicate-key gap; a Home worklist low-stock signal.

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
- Direct IT changes leave no PENDING row, so the record's pending banner and `Open requests` stat only
  ever show Purchasing or legacy approvals.
- The loaner rule reads a standard slot as "missing" while a person's only device of that type is on loan.
- The repair-stage saved view still groups DEFECTIVE assets in memory rather than in SQL (Phase 17 left it).
- Webhook delivery rows have no retention policy.

The brainstorm for the IT phase decides which of these, and what else, goes in.
