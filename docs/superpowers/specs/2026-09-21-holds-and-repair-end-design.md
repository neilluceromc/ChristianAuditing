# Phase 26 — Holds that work and the repair end-date: reserve a spare for a person, release or expire a hold, `/reservations` list parity, `Asset.repairEndedAt`

**Status:** design approved in conversation 2026-09-21 (approach A — direct IT actions, one nullable column, an hourly worker sweep; decisions 1–8 below). Not yet planned or implemented.

**Companion facts file (scratch, git-ignored):** `.superpowers/sdd/phase-26-facts.md` — verbatim code of every reservation read/write, the lifecycle preparer, the repair rules and their consumers, the worker hook, the seed rows and the e2e anchors. Every claim below was verified against `main` @ `6530623`.

---

## 0. Decisions made during the brainstorm

1. **Hold expiry: 7 calendar days by default, editable when placing the hold, today as the floor.** An hourly worker sweep flips ACTIVE holds past their day to EXPIRED; the spare returns to every pool automatically because every pool already filters on `state: "ACTIVE"`.
2. **Conflicts block.** Assigning a held spare to anyone but the holder stays refused (the execution guard in `prepareLifecycle` already does this — `apply.ts:59-68`); the UI now shows the hold and offers Release instead of failing on submit.
3. **Repair end is stamped automatically** when an asset leaves DEFECTIVE, in the shared `prepareLifecycle`, so every status path (direct, bulk, triage, worker-executed approvals) records it identically. No new button; one nullable column.
4. **Holds are placed from both the asset record and the person's profile** — the record for "this spare is promised", the profile's empty slot for "line up the new hire's kit" — and released from the record, the profile's holding area and `/reservations`.
5. **`/reservations` gets toolbar parity** with the other lists: search, Employee and Department facets, sortable headers, whole-row click, a Release button, the expiry as a pill. No Export (holds are few and short-lived).
6. **Approach A**: direct admin/IT actions (no approval type — a hold is IT-internal bookkeeping, like triage), audit entries on the asset, `Asset.repairEndedAt` with an audit-history backfill, one migration (25). Approaches B (holds as approvals) and C (derive repair end from history at render time) rejected: B adds a queue for an act nobody approves; C makes the Down column a JSON query per row, unsortable and wrong for pre-vocabulary history.
7. **Expiry writes no audit row** (the worker has no acting user); the reservation row's state and `resolvedAt` are the record and already render on the employee timeline; the worker log line is the operator trail.
8. **One live hold per asset stays an application-level rule**, checked inside the reserve transaction — the codebase has never had a partial unique index and Prisma's schema cannot declare one.

---

## 1. Goal

Make holds real: IT can promise a spare to a person before day one, see where every hold stands and when it lapses, release it, and trust that a lapsed hold frees the spare without anyone remembering. And make the repairs view truthful: a repair that ended records when, so RETURNED OK rows report their downtime instead of a dash.

## 2. Non-goals

- Approvals for holds, notifications when a hold nears expiry, holds on Purchasing-class assets, an Export on `/reservations`, holds for people not yet in the employee directory.
- A repair record entity, vendor turnaround reports, changing the repair stages or `REPAIR_STAGE_CASE_SQL`, editing `repairEndedAt` by hand.
- The Home coverage line already excludes held spares and needs no change.

---

## 3. Data and rules

### 3.1 Schema and migration 25 (`prisma/migrations/<timestamp>_repair_end_and_holds/migration.sql`)

`Asset` gains `/// Phase 26: set when the status leaves DEFECTIVE, cleared when it re-enters; pairs with defectiveSince to close the Down interval. repairEndedAt DateTime?` (no index — the repairs view sorts by `defectiveSince`, unchanged). `Reservation` is unchanged.

```sql
ALTER TABLE "Asset" ADD COLUMN "repairEndedAt" TIMESTAMP(3);

-- Backfill (spec §0 decision 3). An asset that is not DEFECTIVE but still carries defectiveSince
-- has a closed repair; its end is the newest audit row that moved status OFF DEFECTIVE. Rows with
-- no such history stay NULL and keep showing "—" in the Down column — never a guess.
UPDATE "Asset" a
   SET "repairEndedAt" = h."endedAt"
  FROM (
    SELECT e."entityId" AS "assetId", max(e."createdAt") AS "endedAt"
      FROM "AuditEntry" e
     WHERE e."entityType" = 'asset'
       AND e."diff"->'status'->>'from' = 'DEFECTIVE'
       AND e."diff"->'status'->>'to' IS DISTINCT FROM 'DEFECTIVE'
     GROUP BY e."entityId"
  ) h
 WHERE h."assetId" = a."id"
   AND a."status" <> 'DEFECTIVE'
   AND a."defectiveSince" IS NOT NULL
   AND h."endedAt" > a."defectiveSince";
```

### 3.2 Hold rules — `src/lib/holds.ts` (new, pure, unit-tested)

```ts
export const HOLD_DEFAULT_DAYS = 7;
export const defaultHoldExpiry = (todayISO: string) => addDays(todayISO, HOLD_DEFAULT_DAYS); // from @/lib/deadlines
export const minHoldExpiry = (todayISO: string) => todayISO;
export interface HoldStatus { days: number; text: string; tone: "neutral" | "accent"; expired: boolean }
export function holdStatus(expiresAt: Date, todayISO: string): HoldStatus  // "expires in 3 d" | "expires today" | "expired 2 d ago"; accent when days <= 0
export function isHoldExpired(expiresAt: Date, todayISO: string): boolean   // localDateISO(expiresAt) < todayISO — same rule as isPastDue
export const HOLDS_SWEEP_INTERVAL_MS = PRUNE_INTERVAL_MS;                    // from @/lib/retention — hourly, like retention
export const expireDue = pruneDue;                                           // same gate
export const RESERVATION_TABS / ReservationTab / parseReservationTab          // MOVED here verbatim from src/server/modules/reservations/queries.ts
export const HOLDS_LIST_CONFIG: ListConfig = { facets: ["employee", "department"], sortable: ["expiresAt", "createdAt", "employee", "tag"], defaultSort: [{ key: "expiresAt", dir: "asc" }] };
export function buildHoldWhere(tab: ReservationTab, state: ListState): Prisma.ReservationWhereInput
  // state.in = the tab's states; q → OR over asset.tag / asset.model / employee.name / employee.employeeNo (insensitive contains);
  // filters.employee → employeeId in; filters.department → employee.departmentId in
export function buildHoldOrderBy(sort: SortKey[]): Prisma.ReservationOrderByWithRelationInput[]
  // expiresAt → { expiresAt: { sort: dir, nulls: "last" } }; createdAt → { createdAt: dir }; employee → { employee: { name: dir } }; tag → { asset: { tag: dir } }; then { id: "asc" }
```

The `daysUntil`/`dueStatus` shape in `src/lib/deadlines.ts` is the model for `holdStatus`; text differs ("expires…" not "due…") so the two never read alike on one screen.

### 3.3 Repair rules — `src/lib/repairs.ts`

`RepairLike` gains `repairEndedAt: Date | null`. `repairStage` and `REPAIR_STAGE_CASE_SQL` are untouched (the stage is still derived from status + `defectiveSince`). `downDays` becomes:

```ts
export function downDays(a: Pick<RepairLike, "status" | "defectiveSince" | "repairEndedAt">, now = new Date()): number | null {
  if (!a.defectiveSince) return null;
  if (a.status === "DEFECTIVE") return Math.max(0, Math.floor((now.getTime() - a.defectiveSince.getTime()) / DAY_MS));
  if (!a.repairEndedAt) return null;                                   // ended before we recorded ends — "—", never a guess
  return Math.max(0, Math.floor((a.repairEndedAt.getTime() - a.defectiveSince.getTime()) / DAY_MS));
}
```

Every consumer passes the new field: `stageOf`/`toRow` in `inventory/queries.ts` (the `RepairLike` projection and `AssetRow.down`), the Home repairs rows (`home/queries.ts:245-270`, which only list DEFECTIVE assets, so `down` still counts to now), the record page (`inventory/[id]/page.tsx:35`, renders "N d out of service" for DEFECTIVE and "down N d, back since <date>" once closed), the repairs saved view's Down column (already renders `row.down`).

### 3.4 Lifecycle preparer — `src/server/modules/lifecycle/apply.ts:96-102`

```ts
if (change.status === "DEFECTIVE" && asset.status !== "DEFECTIVE") {
  updates.defectiveSince = now;  diff.defectiveSince = { from: asset.defectiveSince, to: now };
  updates.repairEndedAt = null;  diff.repairEndedAt = { from: asset.repairEndedAt, to: null };   // a new repair measures from its own start
}
if (change.status !== "DEFECTIVE" && asset.status === "DEFECTIVE") {
  updates.repairEndedAt = now;   diff.repairEndedAt = { from: asset.repairEndedAt, to: now };
}
```
`LifecycleAsset`/`assetSelect` in `lifecycle/actions.ts` add `repairEndedAt`. The existing comment ("is never cleared") is rewritten to describe both stamps.

---

## 4. Server actions and the worker

### 4.1 `src/server/modules/reservations/actions.ts` (new; `"use server"`)

Guard order role → `checkRate` → zod → loads → writes, one `writeAudit` per write inside the same `prisma.$transaction`, `ActionResult` returns, exactly as `lifecycle/actions.ts` does.

```ts
const reserveSchema = z.object({ assetId: z.string().min(1), employeeId: z.string().min(1), expiresAt: dateStr /* YYYY-MM-DD */, reason: reasonOptional });
export async function reserveAsset(input: unknown): Promise<ActionResult<{ id: string; tag: string }>>
```
Rules, in order, each a `conflict`/`validationError` with the exact copy: asset missing → "That asset no longer exists."; `asset.cls !== "IT"` → "Holds are for IT spares."; `!isAssignable(asset)` → "`{tag}` is not a spare." (covers DEFECTIVE, DEPLOYED, returned-for-triage); an ACTIVE hold exists → "`{tag}` is already held for `{employeeNo}` — release that hold first."; `openApprovalForAsset(tx, assetId)` → "`{tag}` has an open request — decide it first."; employee missing → "That employee no longer exists."; `employee.employment !== "ACTIVE"` → "`{name}` is `{employment}` — slots are frozen."; `expiresAt < minHoldExpiry(today)` → `validationError({ expiresAt: "Pick today or later" })`. Write: `reservation.create({ assetId, employeeId, state: "ACTIVE", reason, expiresAt: dayFromISO(d.expiresAt) })`; audit on the asset — `action: "reservation.placed"`, `diff: { hold: { from: null, to: employee.employeeNo }, expiresAt: { from: null, to: <Date> }, ...(reason ? { reason: { from: null, to: reason } } : {}) }`. Guard: `actionRole("admin", "it_staff")`.

```ts
const releaseSchema = z.object({ reservationId: z.string().min(1), reason: reasonOptional });
export async function releaseHold(input: unknown): Promise<ActionResult<{ id: string; tag: string }>>
```
Load the reservation with asset and employee; not found → "That hold no longer exists."; `state !== "ACTIVE"` → "That hold is already closed."; `updateMany({ where: { id, state: "ACTIVE" }, data: { state: "RELEASED", resolvedAt: now } })` and if `count === 0` → the same "already closed" conflict (a sweep or fulfilment won the race); audit on the asset — `action: "reservation.released"`, `diff: { hold: { from: employeeNo, to: null }, ...(reason ? { reason: { from: null, to: reason } } : {}) }`.

Both then revalidate: `/inventory/${assetId}`, `/inventory/${assetId}/reservations`, `/inventory`, `/reservations`, `/employees/${employeeId}`, `/` (the fleet coverage moves). A `revalidateHold(assetId, employeeId)` helper in the same file.

`src/lib/activity.ts` `auditSentence` gains: `case "reservation.placed": return \`${actor} reserved ${entity} for ${diff.hold.to} until ${fmtDate(diff.expiresAt.to)}\`;` and `case "reservation.released": return \`${actor} released the hold on ${entity}\`;`. `actionDot` (`activity-feed.tsx`): `"reservation.placed"` → `"ACTIVE"` (inflight), `"reservation.released"` → `"CANCELLED"` (closed). `REASON_CHIPS` (`src/lib/reason-chips.ts`) gains `"hold.place": ["New hire setup", "Replacement pending", "Project loan"]` and `"hold.release": ["No longer needed", "Assigned another unit", "Hire cancelled"]`.

### 4.2 Reading holds — `src/server/modules/reservations/queries.ts`

`listReservations(tab, state: ListState)` replaces `(tab, requestedPage)`: `where = buildHoldWhere(tab, state)`, `orderBy = buildHoldOrderBy(state.sort)`, the same `pagedSnapshot` with the tab `groupBy` counts, plus `facets: { employee: FacetOption[]; department: FacetOption[] }` counted over the current tab with the other facet applied (the Phase 25 narrowing rule). `ReservationRow` gains `expiresAt: Date | null` (raw, for the pill) and `assetId` stays. `resolved` reads `resolvedAt` first and falls back to `expiresAt` for EXPIRED rows without one (the seeded row). New `activeHoldFor(assetId)` → `{ id, employee: { id, name, employeeNo }, expiresAt } | null` for the record layout and the assign dialog. `AssetRow.hold` (`inventory/queries.ts`) gains `expiresAt: Date | null` (the `LIST_INCLUDE` reservation already carries it).

### 4.3 Worker — `src/worker/holds.ts` (new), `src/worker/index.ts`

```ts
export async function expireHolds(now = new Date()): Promise<number> {
  const cutoff = dayFromISO(localDateISO(now));                      // start of today, Asia/Manila — a hold is live through its whole day
  const r = await prisma.reservation.updateMany({ where: { state: "ACTIVE", expiresAt: { lt: cutoff } }, data: { state: "EXPIRED", resolvedAt: now } });
  return r.count;
}
```
`index.ts`: `let lastExpireAt: Date | null = null;` and `safeExpire()` mirroring `safePrune` (try → `const n = await expireHolds(); if (n) console.log(\`[worker] expired ${n} hold${n === 1 ? "" : "s"}\`)`, catch → `console.error(\`[worker] hold sweep failed: …\`)`, finally → `lastExpireAt = new Date()`); called after `safePrune()` at start and `if (expireDue(lastExpireAt, new Date())) await safeExpire();` in the loop. `--once` runs it once. Relative imports only (`../lib/holds`, `../server/db/client`).

---

## 5. Screens

### 5.1 Asset record — `inventory/[id]/layout.tsx`, `components/inventory/holder-control.tsx`, new `components/inventory/release-hold-button.tsx`

The layout loads `hold = await activeHoldFor(asset.id)` and passes `today`. Predicates: `canReserve = canMutate && direct && !pending && !asset.assignee && isAssignable(asset) && !hold`; `canReleaseHold = canMutate && direct && !!hold`.

- `HolderControl` gains `mode: "reserve"` in its `Props` union: `{ assetId; tag; mode: "reserve"; employees: ComboOption[]; recentEmployees?: string[]; defaultExpiry: string; minExpiry: string }`. Button **Reserve**; dialog title "Reserve {tag}"; fields: **For** (employee combobox, ACTIVE employees, recent picks first), **Expires** (`type="date"`, `min`, value `defaultExpiry`, `autoFocus` goes to the combobox), **Reason** (`ReasonField` with `REASON_CHIPS["hold.place"]`); primary **Reserve** → `reserveAsset`; the `ok / rate_limited / validation / conflict` ladder the other modes use; success toast "{tag} reserved for {name}" and `router.refresh()`.
- Held: a `Banner tone="inflight"` above the tabs — title "Held for {name}" (name → `/employees/{id}`), body the `HoldPill` (`holdStatus` text) and the reason when present, actions `<ReleaseHoldButton reservationId tag />` (confirm dialog "Release the hold on {tag}?" with an optional reason via `REASON_CHIPS["hold.release"]`, primary **Release**). The **Reserve** button is absent while held. **Assign** stays; `HolderControl` assign mode gains an optional `heldFor?: { id; name }`: the combobox preselects the holder and one line under it reads "Held for {name} — assigning to anyone else is refused until the hold is released."
- `inventory/[id]/reservations/page.tsx`: the Expires column renders `HoldPill` for ACTIVE rows (date + status text) and plain dates otherwise; ACTIVE rows gain a `ReleaseHoldButton` cell for admin/IT.

`components/ui/hold-pill.tsx` (new): `HoldPill({ expiresAt, today, withDate })` — the `DuePill` shape over `holdStatus`.

### 5.2 Employee profile — `components/employees/loadout-view.tsx`, `employees/[id]/page.tsx`

- An empty policy slot's actions gain **Reserve a spare** beside Assign (admin/IT, `direct`, employee ACTIVE): dialog with a spare combobox fed by `spareOptions(slot.typeId)` (unheld IT spares, "Same type" / "Other spares" groups — held spares are already excluded there), **Expires** and **Reason** as on the record; calls `reserveAsset({ assetId, employeeId, expiresAt, reason })`; toast "{tag} reserved for {name}"; refresh.
- The slot's "fill" spare picker keeps its `reservedFor` labels and additionally sets `disabled` on a spare held for someone else (the guard would refuse it; the label says why).
- Holding area: each `kind: "reserved"` row shows `HoldPill` (the page passes `expiresAt` on `HoldingItem`) and a **Release** button for admin/IT (`ReleaseHoldButton` with `size="sm"`). The day-one "Assign all N reserved" button is unchanged.

### 5.3 Inventory list — `components/inventory/inventory-table.tsx`

The HOLD cell: `HOLD` pill · "for {name}" link (Phase 25) · `HoldPill` text without the date ("expires in 3 d" / "expired 2 d ago", accent when at or past). `InventoryTable` receives `today` from the page.

### 5.4 `/reservations` — `app/(app)/reservations/page.tsx`, new `components/reservations/holds-toolbar.tsx`, `holds-table.tsx`

State = `parseReservationTab(sp.get("state"))` + `parseListState(sp, HOLDS_LIST_CONFIG)`; `href(s)` serialises both. Tabs stay as they are (counts from the query). Toolbar: search box (placeholder "Tag, model or person"), `FacetDropdown` **Employee** and **Department**, the row-count `total`. `HoldsTable` (client, the `EmployeesTable` pattern): sortable **Asset** (`tag`), **For** (`employee`), **Expires** (`expiresAt`), **Created** (`createdAt`); whole-row click → `/inventory/{assetId}`, inner links (tag, person) stop propagation; columns Asset · Model · Status pill of the asset · For (link) · Reason · Expires (`HoldPill` with date on ACTIVE rows; plain date otherwise) · Resolved (`resolved` + `closedBy` glyph as today) · Release (`ReleaseHoldButton` on ACTIVE rows for admin/IT). Empty states: "No active holds — reserve a spare from its record or from a person's profile." / "Nothing in this tab" / "Your filters matched nothing" with Clear filters. The banner's last sentence becomes "Holds are placed from the asset record or the person's profile and released there or here." A `loading.tsx` for `/reservations` already exists (Phase 25).

---

## 6. Errors and edge cases

- Reserve on a held / returned-for-triage / non-spare / Purchasing asset, or for a non-ACTIVE employee → `conflict` with the §4.1 copy; the dialog shows it in its error line.
- Expiry before today → `validationError` under the field, also when the browser `min` is stripped.
- Two people reserve the same spare at once → the second `findFirst` inside the transaction sees the first's row and conflicts (READ COMMITTED; the tiny window is the same the app accepts elsewhere).
- Release of a hold already fulfilled or expired → "That hold is already closed." (`updateMany` count 0 covers the race with the sweep or an assignment).
- Assigning the holder their spare fulfils the hold (`commitLifecycle`, unchanged); assigning anyone else is refused by the guard with the holder's number (unchanged) — the UI now shows why beforehand.
- A hold expires while the record is open → the next action refreshes; the sweep and a release cannot both win (`state: "ACTIVE"` predicate on both).
- An asset re-entering DEFECTIVE clears `repairEndedAt`; a repair that ended before this phase with no matching audit row keeps a dash in Down.
- Deleting an employee is not possible while reservations reference them (existing FK); nothing new.
- Seed: BR-MN-0910's ACTIVE hold for EMP-0097 (`expiresAt` +7 d) is the live fixture; BR-PH-0301's EXPIRED row has no `resolvedAt` and keeps reading its `expiresAt`; BR-MN-0911 (RETURNED OK fixture, `defectiveSince` −70 d, no audit transition) keeps a dash in Down after the backfill — the e2e creates a real DEFECTIVE→SPARE transition on another asset.

## 7. Tests

**Unit (vitest).** `src/lib/holds.test.ts`: `defaultHoldExpiry`/`minHoldExpiry`; `holdStatus` text and tone for +3 d, today, −2 d; `isHoldExpired` boundary (yesterday true, today false); `expireDue`; `parseReservationTab` (moved, its existing behaviour); `buildHoldWhere` (tab states, `q` OR, both facets) and `buildHoldOrderBy` (each key, nulls last on `expiresAt`, id tiebreak). `src/lib/repairs.test.ts`: `downDays` closed interval, null when not DEFECTIVE without an end, DEFECTIVE ignores `repairEndedAt`, the twelve-row fixture still passes (`repairEndedAt: null` added to `repairStageFixture` rows). `src/lib/activity.test.ts` (if present): the two sentences.

**End to end — new `e2e/holds.spec.ts`** (reseed in `beforeAll`; local helpers; every mutating case restores mutable fields in `finally` — reservations it created are deleted by id, `repairEndedAt`/`defectiveSince`/`status` restored; never delete audit rows):
1. Reserve from the record: as IT on `BR-HS-0502` (a seeded SPARE headset with no ACTIVE hold and no open request — its only reservation is the RELEASED history row): the **Reserve** button, dialog Expires prefilled today + 7, pick Nina Robles, a chip, Reserve → toast, the held banner with "expires in 7 d", the HOLD pill on `/inventory?q=HS-0502` with "expires in 7 d", the audit sentence on the asset timeline, and the headset absent from BR-LT-0201's Replace picker. `finally`: delete the created reservation by id.
2. Reserve from a profile slot: on Carlo Dizon's profile an empty policy slot offers **Reserve a spare**; pick `BR-PH-0301` (a seeded SPARE phone; its EXPIRED history row is not ACTIVE), Reserve → the holding area lists it with the pill and a Release button. `finally`: delete the reservation by id.
3. Conflict: on `BR-MN-0910` (held for Nina Robles) the **Reserve** button is absent, the banner reads "Held for Nina Robles" with the pill; the Assign dialog preselects Nina and shows the held line; picking Paolo Santos and submitting is refused with `EMP-0097` in the message; the asset still reads SPARE and the hold is still ACTIVE.
4. Floor: strip `min`, pick yesterday → "Pick today or later"; no row written.
5. Release from the record → RELEASED with `resolvedAt`; audit sentence "released the hold".
6. Release from the profile's holding area and from `/reservations` (two fresh holds).
7. Fulfilment: assign BR-MN-0910 to Nina → hold FULFILLED (unchanged behaviour, asserted).
8. Expiry: set a fresh hold's `expiresAt` to two days ago via `db`, run `npm run worker:once` (foreground, `execSync`) → EXPIRED with `resolvedAt` today, `/reservations` Closed tab shows "clock", the pill on the record is gone and the spare is back in the Replace picker.
9. `/reservations` parity: search "Nina" filters to her holds; Employee facet lists her with the count; sort by Expires flips the order; row click lands on the asset; the viewer sees no Release buttons.
10. Backfill honesty: on the fresh seed `BR-MN-0911` (a closed repair with no audit transition) shows a dash in Down on the repairs view and the record says "back since —" is NOT shown (only the stage); i.e. `repairEndedAt` is null after the migration's backfill.
11. Repair end: as IT on `BR-MN-0911` (SPARE; the seeded RETURNED OK fixture) change status → DEFECTIVE (the record shows "0 d out of service"; `defectiveSince` is today, `repairEndedAt` null), then → SPARE: `repairEndedAt` is set, the record reads "down 0 d, back since <today>", the repairs view `?stage=returned-ok` shows `0 d` in Down for it; change → DEFECTIVE again: `repairEndedAt` back to null and Down counts from the new start. `finally`: restore `status: SPARE`, the seeded `defectiveSince`, `repairEndedAt: null`, `returnedAt: null` (read all four before the case).
Expected `--list` about 364 tests / 35 files; the new file joins chunk F. Existing specs that touch holds or the Down column run in the battery: `offboarding` (reservations describe), `paging` (30 seeded holds; the Active tab count), `custody`, `it-gaps` (Replace picker), `it-nav` case 7 (HOLD link), `axe-sweep`, `direct-lifecycle`.

**Walk (foreground, 3100):** the three Reserve/Release surfaces and the held Assign dialog; `npm run worker:once` proof of one expiry against `inventory_dev`.

## 8. Files

New: `prisma/migrations/<ts>_repair_end_and_holds/migration.sql`, `src/lib/holds.ts` (+test), `src/server/modules/reservations/actions.ts`, `src/worker/holds.ts`, `src/components/ui/hold-pill.tsx`, `src/components/inventory/release-hold-button.tsx`, `src/components/reservations/holds-toolbar.tsx`, `src/components/reservations/holds-table.tsx`, `e2e/holds.spec.ts`.

Modified: `prisma/schema.prisma`, `src/lib/repairs.ts` (+test), `src/lib/activity.ts` (+test if present), `src/lib/reason-chips.ts`, `src/server/modules/lifecycle/apply.ts`, `src/server/modules/lifecycle/actions.ts` (`assetSelect`), `src/server/modules/reservations/queries.ts`, `src/server/modules/inventory/queries.ts` (`RepairLike` projection, `AssetRow.hold.expiresAt`, `stageOf`/`toRow`), `src/server/modules/home/queries.ts` (repair rows pass `repairEndedAt`), `src/worker/index.ts`, `src/components/patterns/activity-feed.tsx` (`actionDot`), `src/components/inventory/holder-control.tsx`, `src/components/inventory/inventory-table.tsx`, `src/components/employees/loadout-view.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`, `src/app/(app)/inventory/[id]/page.tsx`, `src/app/(app)/inventory/[id]/reservations/page.tsx`, `src/app/(app)/inventory/page.tsx` (passes `today`), `src/app/(app)/employees/[id]/page.tsx` (`HoldingItem.expiresAt`, spares `heldForOther`), `src/app/(app)/reservations/page.tsx`, `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`.

## 9. Constraints (binding on every task)

- Migration 25 is additive and nullable, forward-only, house shape (bare `ALTER TABLE`, commented backfill citing the decision); staging gets it at the next `-Force` redeploy after a merge; never seed staging.
- Guard order role then `checkRate`; one `writeAudit` per domain write in the same transaction; `ActionResult` returns; audit action strings `reservation.placed` / `reservation.released` and no others.
- No `aria-label` near a form field may contain that field's label word; heading rows stay `role="presentation"`; links inside clickable rows stop propagation.
- Copy: "Reserve", "Reserve a spare", "Release", "For", "Expires", "Held for {name}", "Pick today or later", "expires in N d" / "expires today" / "expired N d ago".
- Dev only in a worktree with its own `.env` (`inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`); `npx prisma generate` after `npm ci`; `npx prisma migrate dev` in the worktree only; dev server `npm run dev -- -p 3100` foreground, one walker at a time; Playwright foreground `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process; nobody seeds while another agent walks or tests; `npm run worker:once` hits `inventory_dev` only; `netstat`/`taskkill` port hygiene.
- Never read or print `.env`; docs are CRLF; new files `git add`ed before a pathspec commit; wrong messages fixed with a new commit; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
