# Phase 15 — Direct IT Lifecycle, Replace, Triage and the Worklist — Design

**Status:** implemented on branch `phase-15-direct-it-lifecycle`, 2026-09-07; amendments are `D-` entries at the top of the plan. The offboarding decision is
the user's; the loans default is the assistant's (§1 row 9). The depreciation module the user chose in
Phase 14 remains a separate Phase 15b spec; this document does not touch it.

**Goal:** IT works its own devices without ceremony. A status change, an assignment, a return, a
replacement or an offboarding decision on an IT asset takes effect the moment IT confirms it, is
audited under IT's name, and never waits in a queue. A device that comes back is held out of the spare
pool until IT has looked at it. IT's Home becomes a worklist that says what to do next, in order.

**Source requirement:** the user's words of 2026-09-07:

> *"the IT doesn't need approval when changing a status or owner of an asset, since we are on a fast
> paced environment. but just needed another confirmation if possible."*

> *"All i just want it whenever an employee replaced her laptop/asset there will be no need for finance
> to middle on it. Just IT."*

> *"i think there are still problem on IT specially in inventory management and flow of changes of
> status."* — pain points chosen: too many steps for one change; replacing a device is two actions; hard
> to see what needs doing. Confirmation chosen: the same person confirms in a dialog.

> *"for offboarding of staff, there is no need to proceed with finance."*

Finance was never in these flows; what the user is describing is the approval queue, which IT used to
approve its own requests. That queue stays for Purchasing.

---

## 0. Naming — read this first

`admin` is the sysadmin role. The business's "Admin department" is Purchasing (`purchasing` workspace,
`purchasing_staff` role). "IT" below means the `it_staff` role and `admin` acting on IT-class assets.

---

## 1. Decisions, with who made them and what was rejected

| # | Question | Decision | By | Rejected |
|---|---|---|---|---|
| 1 | Which changes skip the queue? | **Every lifecycle change by a role that manages an IT asset:** status change, assign, return, bulk status change, day-one reserved assignment, deploy-at-creation, and offboarding decisions. `DIRECT_LIFECYCLE_CLASSES = ["IT"]`. §2 | user | IT status changes only; both departments (Purchasing keeps its queue). |
| 2 | What kind of confirmation? | **The same person confirms in a dialog.** The dialog restates the change; on confirm it applies at once. | user | A second IT person confirms (the queue trimmed to IT); no dialog with an undo window. |
| 3 | Is a direct change recorded as an approval? | **Yes, as an already-EXECUTED approval row plus the asset audit entry.** The row is a record of a decision, never a request: created in state `EXECUTED`, `requestedBy = claimedBy = actor`, `resolvedAt = now`, refNo allocated as today. §2.3 | assistant | Audit entry only. Rejected because History, Timeline, the offboarding wizard, the farewell report, the `approval.executed` webhook and the Closed tab all read approval rows; keeping the row keeps every one of them working with no rewrite, and gives each change a refNo to quote. |
| 4 | Replacement is one action | **Yes.** `Replace` retires the old device with a chosen outcome and assigns the new one, in one transaction, with cross-referenced audit. §3 | user | Return then assign as two confirmations. |
| 5 | A returned device is not a spare yet | **Yes.** `Asset.returnedAt` marks it "back, not checked"; it leaves the spare pool until IT triages it. One additive migration. §4 | user | Land straight on SPARE as today (how lost laptops happen); a new `RETURNED` status word (an enum change and a trigger change for one flag). |
| 6 | Triage outcomes | **Keep as spare · Send to repair (DEFECTIVE) · Dispose · Donate.** | assistant | A free-text disposition. |
| 7 | Return outcomes offered to IT | **Back for triage (SPARE) · Defective · Missing · Buyout** — exactly `RETURN_TARGETS.IT`. Missing requires a reason. | assistant | Only "back for triage". |
| 8 | What is on the worklist, in what order | **Triage → Repairs to chase → Awaiting IT check → New hires with empty slots → Loans out too long → Missing → remaining approvals and leavers.** Home shows the top two per section with counts; `/inventory/work` shows everything. §5 | user (contents) / assistant (order) | Keep the flat five-row "Your shift". |
| 9 | What is a loan "out too long"? | **A TEMPORARY device whose status was last set more than 30 days ago**, using the newest audit entry that set TEMPORARY, else `updatedAt`. No new field. | assistant (the user did not answer) | A real `loanDueAt` field — a Phase 16 candidate if 30 days proves wrong. |
| 10 | Offboarding decisions | **Direct for IT-class devices; queued for Purchasing-class ones.** The wizard, the Continue gate and the farewell report are unchanged because they read approval rows, and direct decisions still write one (row 3). §6 | user | Leave offboarding queued. |
| 11 | Purchasing | **Unchanged.** Requests, queue, approvals, worker. | user | — |
| 12 | Schema change | **One additive migration:** `Asset.returnedAt DateTime?` + index. Migration count 15 → 16. | — | — |

---

## 2. Direct lifecycle

### 2.1 The map

`src/lib/asset-class.ts` gains `DIRECT_LIFECYCLE_CLASSES = ["IT"]` and
`isDirectLifecycle(role, cls) = canManageClass(role, cls) && DIRECT_LIFECYCLE_CLASSES.includes(cls)`.
Pinned: `DIRECT_LIFECYCLE_CLASSES ⊆ ASSET_CLASSES`; for every role, `isDirectLifecycle` implies
`canManageClass`.

### 2.2 One executor, two callers

The worker's `runExecution` in `src/worker/execute-approval.ts` today holds the live guards and the
asset write. They move to `src/server/modules/lifecycle/apply.ts`:

```ts
export async function applyLifecycle(tx, input: {
  asset: { id, tag, cls, status, assigneeId, defectiveSince, returnedAt };
  change: { kind: "assign"; employeeId; status } | { kind: "return"; status } | { kind: "change-status"; status };
}): Promise<{ ok: true; diff: AuditDiff } | { ok: false; error: string }>
```

Guards, verbatim from the worker: assign → recipient exists and is ACTIVE, `isAssignable(asset)`
(§4.2), a reservation held by someone else refuses; return → the asset is held; change-status → a held
asset may only move within `HOLDER_STATUSES[cls]`. Writes: `status`, `assigneeId`, `defectiveSince` set
on entering DEFECTIVE (never cleared, as today), `returnedAt` per §4.1; settles an ACTIVE reservation
for the recipient. Returns the field-level diff. **No audit, no approval writes** — the caller owns those,
because the worker and the direct actions phrase them differently.

The worker keeps `executionPlan` (pure) and calls `applyLifecycle`; its audit strings
(`lifecycle.assign executed`, actor `worker`) do not change.

### 2.3 The direct actions

New module `src/server/modules/lifecycle/actions.ts`, every action guarded by `actionUser()` then
`isDirectLifecycle(user.role, asset.cls)` else `forbidden()`, rate-limited, one transaction each:

| Action | Input | Effect |
|---|---|---|
| `changeStatus` | `assetId`, `to ∈ STATUSES_BY_CLASS[cls]`, `reason?` | `applyLifecycle(change-status)` |
| `assignAsset` | `assetId`, `employeeId`, `status ∈ ASSIGN_TARGETS[cls]` (default `DEFAULT_ASSIGN_STATUS`), `reason?` | `applyLifecycle(assign)` |
| `returnAsset` | `assetId`, `outcome ∈ RETURN_TARGETS[cls]`, `reason?` (required when MISSING) | `applyLifecycle(return)` |
| `replaceAsset` | §3 | two applies |
| `triageAsset` | §4.3 | status write + clear `returnedAt` |
| `bulkChangeStatus` | the bulk drawer's `ids | filters`, `to`, `reason?` | one `applyLifecycle` per asset, same skip rules as today (already there, closed family, open approval); refuses over `BULK_MAX` |
| `assignReserved` | `employeeId` | one assign per ACTIVE reservation whose asset `isAssignable` |

Each successful apply writes, in the same transaction: an **`Approval` row in state `EXECUTED`** with
the same type and payload the request path would have produced, `requestedById = claimedById = user.id`,
`claimedAt = resolvedAt = now`, `priority NORMAL`, refNo from the sequence; the **asset audit entry**
`{ action: "lifecycle.assign" | "lifecycle.return" | "lifecycle.change-status" | "lifecycle.replace" |
"lifecycle.triage", diff, actorId: user.id }`; and the `approval.executed` webhook, exactly as the
worker emits it. `src/lib/activity.ts` gains sentences for the five actions — *"J. Sarmiento assigned
BR-LT-0148 to EMP-0097"*, *"returned BR-LT-0148 for triage"*, *"changed BR-LT-0122 to DEFECTIVE"*,
*"replaced BR-LT-0148 with BR-LT-0201 for EMP-0097"*, *"triaged BR-LT-0148: keep as spare"*.

An asset with an **open** approval (PENDING/CLAIMED/APPROVED — legacy or Purchasing) refuses every direct
action: *"BR-LT-0148 is held by APR-2041 — resolve it in Approvals first."*

### 2.4 The request path closes for IT

`requestStatusChange`, `bulkRequestStatusChange`, `requestAssign`, `requestReturn`,
`requestAssignReserved` and offboarding's `decideItem` refuse a direct-lifecycle class:
*"IT changes apply directly — use Change status, Assign or Return."* `createAsset`'s deploy-at-creation
for a direct class applies the assignment inline (`applyLifecycle(assign)` after the insert, same
transaction) instead of creating a pending approval; `creationPlan` is unchanged.

### 2.5 Surfaces

Every control that spoke the approval language gets a `direct` mode chosen by the page from
`isDirectLifecycle(user.role, cls)`:

- **Record header** (`RequestStatusChange` → **Change status**; `HolderControl` → **Assign**, **Return**
  with the outcome picker, **Replace** when held). Dialog copy: *"Applies now and is recorded in the audit
  trail under your name."* Toasts: *"BR-LT-0148 is now DEFECTIVE"*, *"BR-LT-0148 assigned to Nina Robles"*.
- **Loadout view**: slot fill → **Assign**; filled tile → **Return** (outcome picker) and **Replace**;
  day-one button → **Assign all N reserved**. Tiles never show PENDING for IT devices; the "Also holding"
  queued list is empty for them.
- **Bulk drawer**: *"Changes the status of N selected assets now."*
- **Create form**: *"Deployed to the chosen person at registration."*
- **Offboarding wizard** (§6).

The record's pending banner stays for genuinely open approvals (Purchasing or legacy).

---

## 3. Replace

`replaceAsset({ employeeId, oldAssetId, newAssetId, outcome: "TRIAGE" | "DEFECTIVE" | "MISSING", reason? })`,
`reason` required for MISSING. Guards: both assets IT-class and direct for the role; the old asset is held
by the employee; the new one `isAssignable` and not reserved for someone else; neither has an open
approval. In one transaction: `applyLifecycle(return)` on the old with `TRIAGE → SPARE` (sets
`returnedAt`), `DEFECTIVE`, `MISSING`; `applyLifecycle(assign)` on the new with the old device's holder
status (DEPLOYED, or TEMPORARY if the old was a loan). Two `EXECUTED` approvals (`lifecycle_return`,
`lifecycle_assign`) and two audit entries whose diffs carry `replacedBy: { from: null, to: "BR-LT-0201" }`
and `replaces: { from: null, to: "BR-LT-0148" }`. The pure planner `replacePlan(old, new, outcome)` in
`src/lib/lifecycle.ts` decides the two target states and is unit-tested.

Surfaces: **Replace** on the loadout's filled tile and on the record header. The dialog lists spares of the
same type first, then any IT spare, using the same combobox as Assign; then the outcome for the old device;
then a reason.

---

## 4. Triage on return

### 4.1 `returnedAt`

Migration `20260907100000_asset_returned_at`: `ALTER TABLE "Asset" ADD COLUMN "returnedAt" TIMESTAMP(3);
CREATE INDEX "Asset_returnedAt_idx" ON "Asset"("returnedAt");`. No backfill: nothing is mid-triage today.
Seed: no change (no new fixtures; `home-finance.spec.ts` pins the fleet).

`applyLifecycle` sets `returnedAt = now` when a **return** lands an asset of a direct-lifecycle class on
`DEFAULT_STATUS[cls]` (SPARE), whichever caller — direct, Replace, or the worker executing an offboarding
or legacy return. Any other status write clears it: a change to DEFECTIVE, DISPOSE or DONATED is itself a
triage decision, and an assign is impossible while it is set (§4.2). Purchasing assets never carry it.

### 4.2 `isAssignable`

`src/lib/asset-class.ts`: `isAssignable(a: { cls, status, returnedAt }) = a.status === ASSIGNABLE_FROM[a.cls]
&& a.returnedAt === null`. It replaces every bare status comparison: the employee page's spare picker, Home's
fleet coverage, `requestAssign`, `requestAssignReserved`, the worker/`applyLifecycle` assign guard, the
record's `canAssign`, the approval detail's "Asset is assignable" check, and Replace's new-device check.

### 4.3 Triage

`triageAsset({ assetId, outcome: "SPARE" | "DEFECTIVE" | "DISPOSE" | "DONATED", note? })`: requires
`returnedAt !== null`; writes the status (SPARE keeps it), clears `returnedAt`, appends `note` to
`notes` when given, audits `lifecycle.triage`, records an `EXECUTED` `lifecycle_change_status` approval
only when the status actually changes. Surfaces: the record shows a **BACK · NOT CHECKED** pill and a
**Triage** button (IT); the worklist's Triage rows link to the record.

---

## 5. The worklist

### 5.1 Sections, in order

Pure `src/lib/worklist.ts` defines `WORK_SECTIONS` in this order, each with a title, the one action's
label, and a `homeLimit` of 2:

| Section | Rows | Order | Action |
|---|---|---|---|
| Triage | IT assets with `returnedAt` set | oldest first | Triage → record |
| Repairs | DEFECTIVE IT assets with stage, vendor, RMA, days down, beyond-repair warning | longest down first | Chase → record |
| Awaiting IT check | Phase 14's CHECK rows | oldest first | Check → record |
| New hires | as today (empty required slots, 30-day window) | earliest start first | Fill loadout → employee |
| Loans | TEMPORARY IT assets, "out N d" per §1 row 9; flagged when N > 30 | longest first | Review → record |
| Missing & records | MISSING IT assets, and DEPLOYED IT assets with no holder (today's orphaned DATA rows) | oldest first | Investigate / Fix record → record |
| Approvals & leavers | today's SLA, EXEC and LEAVE rows | as today | as today |

`groupWork(rows, dismissed)` replaces `shiftOrder`: it filters dismissals, groups by section, sorts within
a section by severity, and caps each section at `homeLimit` for Home or leaves it uncapped for the page.
Each section reports `total` so Home can say "3 of 7". `SHIFT_LIMIT` and `KIND_RANK` retire; `ShiftKind`
gains `TRIAGE`, `REPAIR`, `LOAN`; the orphaned-DEPLOYED DATA rows sit in the Missing & records section
rather than vanish.

### 5.2 Surfaces

- **Home (IT workspace):** "Your shift" becomes the grouped list: section heading with count, up to two
  rows, a "See all N" link to `/inventory/work#<section>`. Empty sections are omitted. The per-day clear
  button stays and works per row as today.
- **`/inventory/work`:** the same list, uncapped, IT workspace (`PATH_RULES` rule preceding the general
  `/inventory` rule, `workspaces: ["it"]`; viewer reads). Nav item **Worklist** under IT's Tracking,
  above Approvals.

---

## 6. Offboarding

`decideItem` for an IT-class device applies the return immediately through `applyLifecycle`, records the
`EXECUTED` `lifecycle_return` approval (so `allReturns`, the Continue gate and the farewell report read it
unchanged) and audits `lifecycle.return`. The item's copy becomes *"BR-LT-0166 returned for triage"* /
*"… marked MISSING"* instead of *"APR-2044 created"*. A RETURNED outcome sets `returnedAt`, so the
leaver's laptop shows up in Triage rather than silently rejoining the pool. A Purchasing-class holding
(a car) still creates a PENDING approval for Purchasing to approve. The "a return filed before the
offboarding began blocks the item" rule can now only arise for Purchasing assets or legacy rows; it stays.

---

## 7. What does not change

Purchasing's request path, queue, worker and approvals pages; Finance confirmation; the IT check;
`/employees/new`; the Phase 13 class triggers; the eight IT status words and their families; the
repairs saved view (`/inventory?status=DEFECTIVE&sort=defectiveSince`), which the Repairs section links
to as "Open in inventory".

---

## 8. Testing

### 8.1 Unit (pure, `src/lib`)

- `asset-class.test.ts`: `DIRECT_LIFECYCLE_CLASSES`, `isDirectLifecycle` per role × class, `isAssignable`
  over status × `returnedAt`.
- `lifecycle.test.ts`: `replacePlan` (outcome → old target; holder status carried to the new device;
  MISSING requires reason).
- `worklist.test.ts`: section order, per-section caps, totals, dismissal filtering, loans threshold.
- `activity.test.ts`: the five new sentences.

### 8.2 End-to-end

New `e2e/direct-lifecycle.spec.ts`:

| # | Case |
|---|---|
| 1 | IT changes a spare's status with one confirm; the record and list read it at once; History shows "changed … to DEFECTIVE" under IT's name; an `EXECUTED` approval exists and nothing is PENDING. |
| 2 | IT assigns a spare from the record; the employee's tile shows it without a PENDING pill. |
| 3 | IT returns a held laptop "for triage": SPARE, **BACK · NOT CHECKED**, absent from the spare picker; Triage → keep as spare clears it and it reappears. |
| 4 | Replace: the leaver's laptop goes back for triage, the new one is DEPLOYED to the same person, both Histories cross-reference. |
| 5 | Bulk change status on two selected IT assets applies at once ("2 assets are now …"). |
| 6 | Deploy at creation lands the new asset DEPLOYED with a holder, no approval pending. |
| 7 | Offboarding: three decisions apply immediately; the wizard's Continue unblocks; the leaver's returned laptop is in Triage; the farewell report lists all three. |
| 8 | Worklist: Home shows Triage, Repairs and Loans sections with counts; `/inventory/work` lists everything; clearing a row hides it for the day. |
| 9 | A Purchasing car still goes through the queue (request → PENDING), and IT's direct actions are absent on it. |
| 10 | A legacy PENDING approval on an IT asset blocks direct actions with the refNo in the message. |

Rewritten: `it-core.spec.ts` "bulk selection creates one approval per asset" and "filling a slot creates an
assign approval and a pending tile"; `offboarding.spec.ts` "each decision becomes its own approval" and
"a MISSING return now executes" (now immediate) and "a return filed BEFORE the offboarding began" (runs on
a Purchasing car, or on a hand-made legacy approval as `scanner.spec.ts` already does). Unchanged:
`approvals-audit.spec.ts` (seeded legacy rows), `asset-classes.spec.ts`, `department-owned.spec.ts`,
`home-finance.spec.ts` (Home ordering is asserted on the seeded SLA/claim rows, which remain in the last
section — the assertion moves to that section).

---

## 9. Out of scope, on the record

- The depreciation module (Phase 15b, own spec) and Purchasing bulk import.
- A real loan due date (`loanDueAt`) — Phase 16 candidate if the 30-day proxy misleads.
- Direct lifecycle for Purchasing — the user kept its queue.
- Deleting or hiding the approvals pages for IT: legacy rows and Purchasing still need them.
- Notifications.

---

## 10. Files

New: `prisma/migrations/20260907100000_asset_returned_at/migration.sql` · `src/server/modules/lifecycle/{apply,actions}.ts` ·
`src/lib/lifecycle.ts` (+test) · `src/lib/worklist.ts` (+test) · `src/components/inventory/replace-control.tsx` ·
`src/components/inventory/triage-control.tsx` · `src/components/home/worklist.tsx` · `src/app/(app)/inventory/work/page.tsx` ·
`e2e/direct-lifecycle.spec.ts`.

Changed: `prisma/schema.prisma` · `src/lib/asset-class.ts` (+test) · `src/lib/home.ts` (+test) · `src/lib/activity.ts` (+test) ·
`src/lib/workspaces.ts` (+test) · `src/worker/execute-approval.ts` · `src/server/modules/inventory/actions.ts` ·
`src/server/modules/employees/actions.ts` · `src/server/modules/offboarding/actions.ts` · `src/server/modules/home/queries.ts` ·
`src/server/modules/approvals/queries.ts` · `src/components/inventory/{request-status-change,holder-control,bulk-drawer,asset-form}.tsx` ·
`src/components/employees/loadout-view.tsx` · `src/components/offboarding/item-decision.tsx` · `src/components/home/your-shift.tsx` ·
`src/app/(app)/page.tsx` · `src/app/(app)/inventory/[id]/layout.tsx` · `src/app/(app)/employees/[id]/page.tsx` ·
`e2e/{it-core,offboarding}.spec.ts` · `docs/PICKUP.md` · `docs/HANDOVER.md`.
