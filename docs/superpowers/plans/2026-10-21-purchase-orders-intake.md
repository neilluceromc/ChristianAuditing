# Purchase Orders, Three-Team Intake and the Notification Bell: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace Purchase Requests with Purchase Orders. Route new assets Purchasing → IT → Finance, where each team either fixes a problem itself (with a reason) or sends it back to the team that owns the field. Let Finance review a whole registration group at once. Add a team notification bell and "Sent back" tabs.

**Architecture:**
- **Pure rules in `src/lib`:**
  - `intake-rules.ts`: field ownership, who may edit what at which stage, and reason rules.
  - `po-flow.ts`: PO states, line progress and legacy mapping.
  - `po-money.ts`: what a PO copies onto its assets.
- **Server code:**
  - PO actions and register-from-PO in `src/server/modules/purchases/`;
  - group review in `src/server/modules/finance/`;
  - a transactional `notify()` writer and the notification read side in `src/server/notifications/`.
- **One hand-written migration (38).** It keeps the old table names (Prisma `@@map` / `@map`), changes the request state enum to the PO state enum, and adds the new columns and the two notification tables.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6 / Postgres, Tailwind v4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-21-purchase-orders-intake-design.md` (binding).

## Global Constraints

**Reasons and copy**
- **Reason for a cross-team fix, and Purchasing's reply on a sent-back PO:** 5–300 characters, trimmed (`EDIT_REASON = { min: 5, max: 300 }`).
- **PO numbers:** `PO-` plus 4 digits. Existing `PR-0188` becomes `PO-0188`. Keep the DB sequence `purchase_request_ref_seq`.
- **Wording:**
  - "Purchase request(s)" becomes "Purchase order(s)" in all UI copy, breadcrumbs, page titles, exports and palette entries.
  - Purchasing's "Register purchase" becomes "New purchase order".

**Undo, retention, webhooks**
- **Undo window:** the existing `UNDO_WINDOW_MS` (15 min), with the same person and nothing changed since. It covers Approve all and the new send-backs, one action each.
- **Notification retention:** 90 days (`NOTIFICATION_DAYS = 90` in `src/lib/retention.ts`).
- **Webhooks:** add `purchase_order.approved`, payload `{ purchaseOrderId, refNo }`. Keep emitting `purchase_request.completed`, payload `{ purchaseRequestId, refNo }`, at the same moment. Both fire once, when every line of a PO is registered or closed short **and** every asset from it is approved.

**Audit**
- Audit stays append-only.
- New writes use `entityType: "purchase-order"`. Readers accept the old `"purchase-request"` too, so history keeps its links.
- Every new action code goes into `AUDIT_ACTIONS` (`src/lib/audit-actions.ts`), `ACTION_LABELS` and `auditSentence` (`src/lib/activity.ts`), plus `HISTORY_VERBS` (`src/lib/finance-history.ts`) when it is Finance-relevant. `audit-actions.test.ts` enforces this.
- `source: "web"` on every new write.

**No changes to:** depreciation maths (`src/lib/depreciation.ts`), the asset tag format, or who can open which workspace.

**Process**
- **Migrations:**
  - Hand-written `prisma/migrations/20261022090000_purchase_orders/migration.sql`.
  - Never `prisma migrate dev`, `reset`, `format` or `db push`.
  - Apply locally only with `npx prisma migrate deploy` against the dev database.
  - The Supabase dump (`scripts/supabase/dump.ps1 -Image postgres:17-alpine`) runs before the eventual push, which belongs to the controller, not the tasks.
- **Git:**
  - Never `stash`, `checkout`, `restore`, `reset`, `switch`, `--amend`, `rebase`, `merge`, `pull` or `push`.
  - Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - CRLF files keep CRLF; use the Edit tool or Python `newline=""`, never `sed -i`.
- **Don't:** read `.env`, run `next build` locally, or seed staging.
- **Browser tests run only in Task 9:**
  - dev server `npm run dev -- -p 3100`, never 3000;
  - `--workers=1`, foreground;
  - reseed first and last.

## Review Focus

1. **Two people register the last units of a line at the same time.** The second is refused ("Only 2 left to register on this line"), never over-registered. *Task 5 test.*
2. **A Finance fix to a PO's SI number after some of its assets are approved.** Every asset from the PO, approved ones included, shows the new SI number. None is un-approved. *Task 3 test.*
3. **Finance tries to send money problems back to Purchasing on a PO with an approved asset.** It is refused with "Some assets from PO-0214 are approved. Fix it yourself with a reason." *Task 3 test.*
4. **One teammate reads a notification.** It stays unread for the others. The Sent back tab count does not drop until the item is fixed and sent on. *Task 7 test.*
5. **On a mixed PO, Purchasing tries to register the IT line, or IT the non-IT line.** It is refused ("IT registers IT gear" / "Purchasing registers these items"). *Task 5 test.*

---

### Task 1: Intake rules and PO flow (pure)

**Files:**
- Create: `src/lib/intake-rules.ts`, `src/lib/intake-rules.test.ts`
- Create: `src/lib/po-flow.ts`, `src/lib/po-flow.test.ts`
- Create: `src/lib/po-money.ts`, `src/lib/po-money.test.ts`

**Interfaces (Produces):**
- **`intake-rules.ts`:**
  - `type Team = "IT" | "PURCHASING" | "FINANCE"`. It matches the Prisma enum `Team` added in Task 2.
  - `teamOfRole(role: Role): Team | null`. `it_staff` → IT, `purchasing_staff` → PURCHASING, `finance_staff` → FINANCE, `admin` and `viewer` → null.
  - `MONEY_FIELDS = ["cost","fees","purchasedAt","vendorId","invoiceRef","receiptRef"] as const`.
  - `DEVICE_FIELDS = ["brand","model","categoryId","serial","warrantyUntil","warrantyCoveredBy","warrantyContact"] as const`.
  - `type MoneyField = (typeof MONEY_FIELDS)[number]`, `type DeviceField = (typeof DEVICE_FIELDS)[number]`, `type IntakeField = MoneyField | DeviceField`.
  - `fieldOwner(key: IntakeField | RegFieldKey, cls: AssetClass): "IT" | "PURCHASING"`:
    - money fields and `doc:invoice` / `doc:official-receipt` / `doc:delivery-receipt` → PURCHASING;
    - device fields and `doc:warranty-slip` → IT when `cls === "IT"`, else PURCHASING;
    - `other` → null is not allowed; the caller passes the team the user picked.
  - `returnTeamFor(key: IntakeField | RegFieldKey, cls: AssetClass, ctx: { hasPo: boolean; registeredByRole: Role | null }): "IT" | "PURCHASING"`:
    - it equals `fieldOwner` except for **money fields and money documents on an asset with no PO** (spec §5, way 3);
    - those go to the team that registered the batch: `it_staff` → IT, `purchasing_staff` → PURCHASING, `admin` or unknown → `fieldOwner(key, cls)` for device keys, and IT when `cls === "IT"` otherwise.
  - `type IntakeStage = "with-purchasing" | "with-it" | "with-finance" | "approved"`.
  - `type EditVerdict = { ok: true; reasonRequired: boolean } | { ok: false; why: string }`.
  - `canEditField(role: Role, field: IntakeField, cls: AssetClass, stage: IntakeStage): EditVerdict`.
  - `EDIT_REASON = { min: 5, max: 300 }` and `reasonError(text: string | undefined): string | null`.
  - `poMoneyStage(p: { state: PoState; registeredCount: number; approvedCount: number }): IntakeStage`. Rules in order:
    1. `approvedCount > 0` → approved;
    2. `SENT_BACK` → with-purchasing;
    3. `registeredCount > 0` → with-finance;
    4. `WITH_IT` → with-it;
    5. `READY` → with-purchasing.
  - `assetMoneyStage(a: { cls; itVerifiedAt; financeConfirmedAt; financeReturnedAt; financeReturnedTo: Team | null }): IntakeStage`. It is used for assets with no PO.
- **`po-flow.ts`:**
  - `type PoState = "WITH_IT" | "SENT_BACK" | "READY" | "CANCELLED"`.
  - `PO_STATE_LABEL`: `{ WITH_IT: "With IT", SENT_BACK: "Sent back to Purchasing", READY: "Ready to register", CANCELLED: "Cancelled" }`.
  - `stateAfterSave(lines: { cls: AssetClass | null }[]): "WITH_IT" | "READY"`. Any line with `cls === "IT"`, or a legacy `null`, → `WITH_IT`.
  - `stateAfterResubmit(sentBackBy: Team): "WITH_IT" | "READY"`. IT → `WITH_IT`, FINANCE → `READY`.
  - `lineProgress(l: { qty: number; registered: number; closedShort: number }): { remaining: number; label: string }`. The label reads "3 of 5 registered", or adds "· 2 closed short".
  - `poProgress(lines, approvedAll: boolean): "Partly registered" | "Registered" | "Approved" | null`.
  - `canRegisterLine(role: Role, lineCls: AssetClass, state: PoState): { ok: true } | { ok: false; why: string }`:
    - IT lines are for `it_staff` / `admin` when the state is `WITH_IT` or `READY`;
    - other lines are for `purchasing_staff` / `admin` when the state is `READY` or `WITH_IT`;
    - `SENT_BACK` and `CANCELLED` refuse.
  - `legacyPoState(old: "DRAFT"|"SUBMITTED"|"IT_REVIEWED"|"COMPLETED"|"CANCELLED"): PoState`. DRAFT → SENT_BACK; SUBMITTED and IT_REVIEWED → WITH_IT; COMPLETED → READY; CANCELLED → CANCELLED.
  - `poRefNo(n: number): string`, giving `"PO-0188"`.
- **`po-money.ts`:** `moneyForAsset(po: { vendorId; invoiceRef; receiptRef; purchasedAt }, line: { unitPrice }): { cost; vendorId; invoiceRef; receiptRef; purchasedAt }`.

**`canEditField` table** (copy it into the test as a table-driven case list):

| Field kind | Stage | Purchasing | IT | Finance | Admin |
|---|---|---|---|---|---|
| money | with-purchasing | ok, no reason | no ("It's with Purchasing") | no | ok, no reason |
| money | with-it | ok, no reason | ok, reason | no | ok, reason |
| money | with-finance | no ("It's with Finance; ask Finance to fix or send it back") | no (same) | ok, reason | ok, reason |
| money | approved | no ("Approved: only Finance can change it") | no (same) | ok, reason | ok, reason |
| device | any | ok, no reason when `fieldOwner` is PURCHASING, else no | ok, no reason when `fieldOwner` is IT, else no | no ("Send it back to IT" / "…to Purchasing") | ok, no reason |

Viewer is always no.

- [ ] **Step 1: Write the failing tests:**
  - **`intake-rules.test.ts`:**
    - every row of the table, for both `cls` values;
    - `fieldOwner("serial","PURCHASING") === "PURCHASING"` and `fieldOwner("serial","IT") === "IT"`;
    - `reasonError("abcd")` is not null, `reasonError("  fixed typo  ")` is null, and a 301-character string is not null;
    - `returnTeamFor("invoiceRef","IT",{hasPo:false,registeredByRole:"it_staff"}) === "IT"`, `returnTeamFor("invoiceRef","IT",{hasPo:true,registeredByRole:"it_staff"}) === "PURCHASING"`, and `returnTeamFor("invoiceRef","PURCHASING",{hasPo:false,registeredByRole:"purchasing_staff"}) === "PURCHASING"`;
    - `poMoneyStage` rules in order, including `{ state: "SENT_BACK", registeredCount: 3, approvedCount: 0 }` → `"with-purchasing"`.
  - **`po-flow.test.ts`:**
    - `stateAfterSave([{cls:"PURCHASING"}]) === "READY"` and `stateAfterSave([{cls:"PURCHASING"},{cls:"IT"}]) === "WITH_IT"`;
    - `lineProgress({qty:5,registered:3,closedShort:0})` → `{remaining:2,label:"3 of 5 registered"}`;
    - `lineProgress({qty:5,registered:3,closedShort:2}).remaining === 0`;
    - `canRegisterLine("purchasing_staff","IT","READY").ok === false` with why `"IT registers IT gear"`;
    - `canRegisterLine("it_staff","PURCHASING","READY").ok === false` with why `"Purchasing registers these items"`;
    - `legacyPoState` for all five;
    - `poRefNo(188) === "PO-0188"`.
  - **`po-money.test.ts`:** copies the four PO fields, and `cost` equals `unitPrice`. A null `unitPrice` gives a null `cost`.
- [ ] **Step 2:** `npx vitest run src/lib/intake-rules.test.ts src/lib/po-flow.test.ts src/lib/po-money.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the three modules to the interfaces above. `PoState` and `Team` are string unions here, so `src/lib` stays free of `@prisma/client` runtime imports. Type-only imports are fine.
- [ ] **Step 4:** The same command PASSES.
- [ ] **Step 5: Commit** `feat(intake): pure rules for field ownership, edit permissions and PO flow`.

### Task 2: Migration 38, Prisma rename and the compile sweep

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261022090000_purchase_orders/migration.sql`
- Modify:
  - every reference listed under "Other references to touch" below;
  - `prisma/seed.ts`, `prisma/seed-scale.ts`, `prisma/scale/purchases.ts`.
- Delete:
  - `src/lib/purchase-flow.ts` + test (replaced by `po-flow.ts`);
  - the old transition actions in `src/server/modules/purchases/actions.ts`: `submitRequest`, `itReviewRequest`, `itRejectRequest`, `requestMoreInfo`, `completeRequest`, `runTransition`;
  - `src/server/modules/purchases/supplier-actions.ts`.
- Test: `prisma/purchase-orders-migration.test.ts`. It runs a pure SQL-text check (below); the data check is the Step 4 command.

**Interfaces (Produces), in the Prisma schema:**
- **`enum Team { IT PURCHASING FINANCE }`.**
- **`enum PurchaseOrderState { WITH_IT SENT_BACK READY CANCELLED }`.** This replaces `PurchaseRequestState`; the column `state` stays.
- **`model PurchaseOrder`** with `@@map("PurchaseRequest")`.
  - It keeps every existing field.
  - The relation fields are renamed: `lines PurchaseOrderLine[]`, `notes`, `documents`, `assets`, `records PurchaseRecord[]`.
  - New fields: `invoiceRef String?`, `receiptRef String?`, `purchasedAt DateTime?`, `fees Decimal? @db.Decimal(12,2)`, `sentBackAt DateTime?`, `sentBackById String?`, `sentBackBy Team?`, `sentBackFields String[]`, `sentBackNote String?`.
  - Drop nothing. `reviewedAt` and `completedAt` stay for history.
- **`model PurchaseOrderLine`** with `@@map("PurchaseUnit")`.
  - `orderId String @map("requestId")`.
  - New fields: `categoryId String?` (FK `Category`, `onDelete: Restrict`), `closedShort Int @default(0)`, `closedShortReason String?`.
  - The old `state`, `itSlotNotes` and `financeNotes` stay for history.
- **`Asset`:**
  - `purchaseOrderId String? @map("purchaseRequestId")` and `purchaseOrderLineId String? @map("purchaseUnitId")`;
  - new `financeReturnedTo Team?`.
- **`PurchaseRecord`:** new `purchaseOrderId String?` (FK, indexed).
- **`NoteEntry` and `RequestDocument`:** `orderId String @map("requestId")`.
- **`NoteKind`:** add `PO_SAVED`, `PO_SENT_BACK`, `PO_RESUBMITTED`, `PO_FIXED`, `PO_REGISTERED`, `PO_LINE_CLOSED`, `PO_CANCELLED`.
- **`model Notification`:**
  - Fields: `id`, `team Team`, `kind NotificationKind` (`SENT_BACK | TO_CHECK | CHANGED`), `title String`, `body String?`, `href String`, `actorId String?` (FK `User`, `SetNull`), `entityType String`, `entityId String`, `createdAt`, `reads NotificationRead[]`.
  - `@@index([team, createdAt])`.
- **`model NotificationRead`:** `notificationId` (FK cascade), `userId` (FK cascade), `readAt DateTime @default(now())`, `@@id([notificationId, userId])`, `@@index([userId])`.

**Migration SQL** (hand-written, in this order, with a comment block per part):
1. Create the `Team`, `PurchaseOrderState` and `NotificationKind` types.
2. Add `PurchaseRequest.state_new "PurchaseOrderState"` and fill it with a `CASE` mirroring `legacyPoState`. Drop the old `state` column and its index, rename `state_new` to `state`, set it `NOT NULL`, and recreate `@@index([state])`. Drop the type `"PurchaseRequestState"`.
3. Rewrite the refs: `UPDATE "PurchaseRequest" SET "refNo" = 'PO-' || substring("refNo" from 4) WHERE "refNo" LIKE 'PR-%'`.
4. Add the new columns, FKs and indexes listed above.
5. `ALTER TYPE "NoteKind" ADD VALUE ...`, once per new kind.
6. Create the `Notification` and `NotificationRead` tables.

The NoteEntry append-only trigger is untouched.

**Other references to touch** (rename `purchaseRequest` → `purchaseOrder`, the old state names → the new ones, and the copy):
- `src/lib/activity-list.ts`, `src/lib/audit-list.ts`, `src/lib/provenance.ts`, `src/lib/purchases-list.ts`, `src/lib/purchase-thread.ts`, `src/lib/workspaces.ts`, `src/lib/nav-badges.ts`;
- `src/server/modules/audit/queries.ts`, `src/server/page-titles.ts`, `src/server/palette.ts`;
- `src/server/modules/home/{queries,overview,nav-counts}.ts`;
- `src/server/modules/inventory/{actions,queries}.ts`, `src/server/modules/finance/asset-detail.ts`, `src/server/modules/suppliers/queries.ts`;
- `src/app/(app)/inventory/export/route.ts`, `src/app/(app)/inventory/[id]/(record)/page.tsx`, `src/components/patterns/activity-feed.tsx`;
- every file under `src/app/(app)/purchases/**` and `src/components/purchases/**`.

**This task only has to compile and keep today's pages rendering under the new states.**
- `purchasesList` tabs become All / With IT / Sent back / Ready to register / Cancelled, through `PURCHASE_TABS`.
- The detail page shows `PO_STATE_LABEL` and hides the removed transition buttons.
- The nav count keys `prDraft`, `prSubmitted` and `prItReviewed` become `poSentBack`, `poWithIt` and `poReady`. `NAV_COUNT_HREF` is updated to match.
- `purchaseReviews` (IT's approvals badge) becomes `poWithIt` on a new IT sidebar item "Purchase orders", href `/purchases?state=WITH_IT`.
- **Audit readers:**
  - In `audit/queries.ts`, `provenance.ts` and `activity-list.ts`, readers treat `entityType` `"purchase-request"` and `"purchase-order"` alike.
  - New writes use `"purchase-order"`.
- **Seed:**
  - Seeded requests become POs in the new states, with an SI number, a purchase date and categories on their lines.
  - PR-0188 becomes PO-0188, keeps its linked asset, and gains `purchaseOrderLineId` on it.
  - Add one SENT_BACK PO (sent back by IT, note "Price is per box, not per unit") and one READY non-IT PO (office chairs, qty 4, nothing registered).

- [ ] **Step 1: Write the failing test.** `prisma/purchase-orders-migration.test.ts` reads the migration file and asserts that the SQL contains:
  - the `CASE` lines `WHEN 'DRAFT' THEN 'SENT_BACK'`, `WHEN 'SUBMITTED' THEN 'WITH_IT'`, `WHEN 'IT_REVIEWED' THEN 'WITH_IT'`, `WHEN 'COMPLETED' THEN 'READY'`, `WHEN 'CANCELLED' THEN 'CANCELLED'`;
  - the `'PO-' ||` refNo rewrite;
  - `CREATE TABLE "Notification"` and `CREATE TABLE "NotificationRead"`.

  It also asserts the SQL does **not** contain `DROP TABLE` or `RENAME TO "Purchase`, because the table names stay.
- [ ] **Step 2:** `npx vitest run prisma/purchase-orders-migration.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the schema and the migration, then run `npx prisma generate`. Sweep the references until `npx tsc --noEmit` is clean. Update the seeds.
- [ ] **Step 4: Verify the data mapping against the local dev DB.**
  - Run `npx prisma migrate deploy` (expect "Applying migration `20261022090000_purchase_orders`").
  - Then `npx prisma db execute --stdin` with `SELECT state, count(*) FROM "PurchaseRequest" GROUP BY 1; SELECT count(*) FROM "PurchaseRequest" WHERE "refNo" LIKE 'PR-%';`. Expected: only the four new states, and 0 PR- refs.
  - Then `npx prisma migrate status`. Expected: "Database schema is up to date".
- [ ] **Step 5:** `npx vitest run`. Expected: all green. Old `purchase-flow` tests are deleted; `nav-counts.test.ts` and `nav-badges.test.ts` are updated to the new keys.
- [ ] **Step 6: Commit** `feat(purchases)!: Purchase Orders replace Purchase Requests (migration 38, states mapped, refs PR- → PO-)`.

### Task 3: PO actions, notify() and the PO-level fix

**Files:**
- Create:
  - `src/server/notifications/notify.ts`;
  - `src/server/modules/purchases/po-actions.ts` + `po-actions.test.ts`, which mocks `@/server/db/client` with an in-memory fake, modelled on `src/server/modules/finance/undo-actions.test.ts`.
- Modify:
  - `src/server/modules/purchases/draft-actions.ts`: delete `createDraft` and `saveDraft`, which are replaced;
  - `src/server/modules/purchases/document-actions.ts`: rename the export to `uploadPoDocument`;
  - the audit registries.

**Interfaces:**
- **Consumes** from Task 1: `canEditField`, `poMoneyStage`, `reasonError`, `stateAfterSave`, `stateAfterResubmit`, `moneyForAsset`, `teamOfRole`, `fieldOwner`.
- **Produces:**
  - `notify(tx: Prisma.TransactionClient, n: { team: Team; kind: "SENT_BACK"|"TO_CHECK"|"CHANGED"; title: string; body?: string; href: string; actorId: string; entityType: string; entityId: string }): Promise<void>`.
    - It writes one row and is always called inside the action's transaction.
    - It never notifies the actor's own team for `CHANGED`.
  - `savePurchaseOrder(input: unknown): Promise<ActionResult<{ id: string; refNo: string; state: PoState }>>`. Roles: `purchasing_staff`, `admin`.
    - **Input:** `{ id?, vendorId, invoiceRef, receiptRef?, purchasedAt, departmentId?, fees?, lines: { id?, description, specs?, categoryId, qty ≥ 1, unitPrice ≥ 0 }[] (≥1), reply? }`.
    - **New PO:** the state is `stateAfterSave` (line class from its category). `WITH_IT` calls `notify` with IT · TO_CHECK · "PO-0214 · 5 laptops from Purchasing to check".
    - **Editing:** allowed only while `poMoneyStage` is `with-purchasing` or `with-it` and nothing is registered on an IT line.
    - **When the state is `SENT_BACK`:** `reply` is required (`reasonError`). The state becomes `stateAfterResubmit(sentBackBy)` and the sent-back fields are cleared. TO_CHECK goes to `sentBackBy`. If that was FINANCE, the PO's assets with `financeReturnedTo = PURCHASING` are un-returned, and their money is re-copied with `moneyForAsset`.
    - Writes a `NoteEntry` (`PO_SAVED` or `PO_RESUBMITTED`) and audit `po.save` / `po.resubmit`.
  - `sendBackPurchaseOrder(input: unknown): Promise<ActionResult<{ refNo: string }>>`.
    - **Input:** `{ id, fields: (MoneyField | "doc:invoice" | "doc:official-receipt" | "doc:delivery-receipt" | "other")[] (≥1), note? }`. A note is required when `other` is ticked; `reasonError` applies when a note is present.
    - **IT** may send back in state `WITH_IT`.
    - **Finance** may send back when `registeredCount > 0` and `approvedCount === 0`. Otherwise it is refused with `"Some assets from PO-0214 are approved. Fix it yourself with a reason."`. Finance also sets `financeReturnedAt`, `financeReturnedTo = PURCHASING` and the fields on every unapproved asset from the PO.
    - **Admin:** either path.
    - The state becomes `SENT_BACK`, with `sentBackBy` set to the actor's team (admin's is the stage owner: with-it → IT, else FINANCE).
    - Calls `notify` with PURCHASING · SENT_BACK. Audit `po.send-back`; note `PO_SENT_BACK`.
  - `fixPurchaseOrder(input: unknown): Promise<ActionResult<{ refNo: string; changed: string[] }>>`.
    - **Input:** `{ id, patch: Partial<Record<MoneyField, …>> & { lines?: { id, unitPrice }[] }, reason }`.
    - Every patched field must pass `canEditField(role, field, "PURCHASING", poMoneyStage(po))` with `reasonRequired` honoured.
    - It copies to **every** asset from the PO, approved ones included, **without** touching `financeConfirmedAt`.
    - Writes one `asset.money.fixed` audit per changed asset (diff, reason) and one `po.fix`. Note `PO_FIXED`.
    - Calls `notify` with PURCHASING · CHANGED · "Finance changed the SI number on PO-0214", unless the actor is Purchasing.
    - It locks the PO row (`SELECT … FOR UPDATE`) before reading the counts.
  - `cancelPurchaseOrder({ id, reason })`: Purchasing/admin, only when nothing is registered. Audit `po.cancel`; note `PO_CANCELLED`.
  - `closeLineShort({ lineId, qty, reason })`: Purchasing/admin. `qty` must be ≤ remaining. Audit `po.line-closed`; note `PO_LINE_CLOSED`.
  - `addComment` keeps its name and moves to `po-actions.ts`.
- **New audit codes:** `po.save`, `po.resubmit`, `po.send-back`, `po.fix`, `po.cancel`, `po.line-closed`, `asset.money.fixed`.
  - Labels: "Saved the purchase order", "Corrected and sent back on", "Sent back to Purchasing", "Fixed the money details", "Cancelled the purchase order", "Closed a line short", "Fixed the money details".
  - `asset.money.fixed` is Finance-relevant. Its history verb is "fixed the money details", followed by the reason in quotes.

- [ ] **Step 1: Write the failing tests** in `po-actions.test.ts`:
  - **`save routes by class`:** a non-IT-only PO is saved `READY` with no notification; a mixed PO is saved `WITH_IT` with exactly one IT TO_CHECK notification.
  - **`save on SENT_BACK needs a reply`:** a missing reply is refused with the `reasonError` message. With `"price per unit now"` and `sentBackBy: "FINANCE"`, the state becomes READY and the assets are un-returned.
  - **`IT send-back`:** from `WITH_IT` it gives `SENT_BACK`, `sentBackBy === "IT"`, and one PURCHASING SENT_BACK notification.
  - **`Finance send-back refused once anything is approved`:** the exact message from Review Focus 3.
  - **`fix after partial approval`** (Review Focus 2): a PO with 3 assets, 1 approved. Finance `fixPurchaseOrder` with `invoiceRef: "SI-0021"`, reason `"typo on receipt"`. All 3 assets get `invoiceRef === "SI-0021"`, the approved one keeps `financeConfirmedAt`, there are 3 `asset.money.fixed` audits, and one PURCHASING CHANGED notification.
  - **`fix without reason refused`;** **`Purchasing fix while with Finance refused`** with the table's message.
  - **`IT cannot fix device fields via fixPurchaseOrder`:** the patch accepts money fields only (a schema error).
  - **`closeLineShort over remaining refused`.**
- [ ] **Step 2:** `npx vitest run src/server/modules/purchases/po-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the actions and `notify`, and register the audit codes and labels.
- [ ] **Step 4:** The same command PASSES. `npx vitest run src/lib/audit-actions.test.ts` PASSES.
- [ ] **Step 5: Commit** `feat(purchases): save, send back, fix and close-short on purchase orders, with team notifications`.

### Task 4: Purchase Order pages and the wording sweep

**Files:**
- Modify:
  - `src/app/(app)/purchases/{page,new/page,[id]/page,[id]/edit/page}.tsx`;
  - `src/components/purchases/*`. `draft-form.tsx` becomes `po-form.tsx` (`PoForm`); `request-actions.tsx` becomes `po-actions-bar.tsx` (`PoActionsBar`);
  - `src/lib/workspaces.ts`: Purchasing item "Purchase orders" with views All / With IT / Sent back / Ready to register / Cancelled, and "New purchase order".
- Create:
  - `src/components/purchases/send-back-po-dialog.tsx`, `fix-po-dialog.tsx`, `close-short-dialog.tsx`;
  - `src/lib/po-copy.test.ts`.

**Behaviour:**
- **`PoForm`** has fields in this order:
  - supplier (required), SI number (required), OR number, purchase date (required), department, fees;
  - lines: description, category (required), specs, qty, unit price (required).

  On a SENT_BACK PO it shows the flagged fields ringed, the sender's note in a fault banner, and a required "What did you fix?" reply.
- **The detail page shows:**
  - the state pill (`PO_STATE_LABEL`) and `poProgress`;
  - per-line `lineProgress`, plus "N assets linked" on legacy POs;
  - a missing-SI warning, "No SI number yet. Finance can't approve until it's added.";
  - documents (`uploadPoDocument`) and the thread.
- **The detail page's buttons:**
  - **Register:** links to Task 5's page; shown only to whoever `canRegisterLine` allows for at least one line with `remaining > 0`.
  - **Send back to Purchasing:** for IT on WITH_IT, and for Finance per the Task 3 rules.
  - **Fix money details:** shown whenever `canEditField` says ok with a reason.
  - **Edit:** Purchasing, when allowed.
  - **Close line short** and **Cancel**.
- **Documents:** `uploadPoDocument` allows `purchasing_staff`, `it_staff`, `finance_staff` and `admin` on any PO that isn't cancelled. Re-uploading a kind adds a new document; nothing is deleted.
- **Wording:** "Purchase request(s)" → "Purchase order(s)" across `src` UI strings. Breadcrumbs read "Purchase orders".

- [ ] **Step 1: Write the failing tests.** In the document-actions test (create it beside `document-actions.ts` if missing): **`finance and IT can upload to a PO`** and **`viewer refused`**. Then `src/lib/po-copy.test.ts` greps `src/app` and `src/components` (excluding `*.test.*`) for `/purchase request/i` and expects 0 matches. It also asserts that `WORKSPACE_NAV`'s Purchasing workspace contains the labels "Purchase orders" and "New purchase order".
- [ ] **Step 2:** `npx vitest run src/lib/po-copy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Build the pages and components, and sweep the copy.
- [ ] **Step 4:** `npx vitest run` and `npx tsc --noEmit` are green.
- [ ] **Step 5: Commit** `feat(purchases): purchase order pages, send-back and fix dialogs, close short; wording sweep`.

### Task 5: Register from a PO, and the direct Register for IT only

**Files:**
- Create:
  - `src/server/modules/purchases/po-register.ts` + `po-register.test.ts`;
  - `src/app/(app)/purchases/[id]/register/page.tsx`;
  - `src/components/purchases/po-register-form.tsx`.
- Modify:
  - `src/lib/asset-class.ts`: `REGISTRABLE_CLASSES.purchasing_staff = []`, so Purchasing registers only from a PO;
  - `src/app/(app)/inventory/register/page.tsx`: `requireRole("admin","it_staff")`; the `requests` query is removed;
  - `src/components/inventory/register-form.tsx` and `purchase-section.tsx`: remove `requestId`, `requests` and `onRequest`;
  - `src/server/modules/purchases/receiving.ts`: drop `requestId` from `registerSchema`, and allow only `admin` / `it_staff`;
  - `src/lib/workspaces.ts`: Purchasing loses "Register assets".

**Interfaces:**
- **Produces:** `registerFromPurchaseOrder(input: unknown): Promise<ActionResult<{ created: number; purchaseRecordId: string; ids: string[] }>>`.
  - **Input:** `{ poId, lines: { lineId, categoryId? (required when the line has none), typeId?, brand?, model, warrantyUntil?, warrantyCoveredBy?, warrantyContact?, units: { tag, serial? }[] (≥1) }[] (≥1) }`.
  - **Rules:**
    - Every line passes `canRegisterLine(role, cls, state)`. A single submit may not mix classes, except for admin.
    - The serial is required for IT units.
    - The units per line are ≤ `remaining`, re-read after `SELECT … FOR UPDATE` on the PO row; otherwise `"Only N left to register on this line"`.
    - Tags are unique.
  - **Writes:**
    - one `PurchaseRecord { purchaseOrderId, cls, quantity, vendorId, invoiceRef, receiptRef, purchasedAt, fees: null, createdById }`;
    - one `Asset` per unit, with `moneyForAsset` values, `purchaseOrderId`, `purchaseOrderLineId`, `purchaseRecordId`, and `itVerifiedAt` / `itVerifiedById` when `cls === "IT"`;
    - a `register` audit per asset and `po.register` once; note `PO_REGISTERED`.
  - **State and notification:**
    - A `WITH_IT` PO becomes `READY`.
    - Calls `notify` with FINANCE · TO_CHECK · "PO-0214 · 3 laptops registered, ready to check", linking to `/finance/review/<purchaseRecordId>`.
  - **Tags:** the form suggests tags the same way `RegisterForm` does today. Reuse its helper; don't write a new allocator.

- [ ] **Step 1: Write the failing tests** in `po-register.test.ts`:
  - **`registers 3 of 5`:** 3 assets carrying the PO's money and line link; `lineProgress` remaining 2; one FINANCE TO_CHECK notification.
  - **`second submit beyond remaining refused`** (Review Focus 1): two calls each asking for 2 of 2 remaining, run against the fake with the lock emulated; the second gets `"Only 0 left to register on this line"`.
  - **`mixed PO class guard`** (Review Focus 5): both messages.
  - **`IT serial required`.**
  - **`legacy line needs a category`.**
  - **`SENT_BACK PO refused`.**
- [ ] **Step 2:** `npx vitest run src/server/modules/purchases/po-register.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the action, the page and the form.
- [ ] **Step 4:** The same command PASSES. `npx vitest run` and `npx tsc --noEmit` are green.
- [ ] **Step 5: Commit** `feat(purchases): register from a purchase order, part deliveries included; direct Register is IT-only`.

### Task 6: Finance reviews a group

**Files:**
- Create:
  - `src/server/modules/finance/groups.ts` (queries) + `groups.test.ts`;
  - `src/server/modules/finance/group-actions.ts` + `group-actions.test.ts`;
  - `src/app/(app)/finance/review/page.tsx`;
  - `src/app/(app)/finance/review/[recordId]/page.tsx`;
  - `src/components/finance/group-review.tsx`;
  - `src/components/finance/fix-money-dialog.tsx`.
- Modify:
  - `src/server/modules/inventory/actions.ts`:
    - `returnAssetToIt` becomes `returnAsset({ id, team: "IT"|"PURCHASING", fields, note? })`. Each field must have `returnTeamFor(field, cls, { hasPo, registeredByRole })` equal to `team` (`registeredByRole` comes from the asset's `PurchaseRecord.createdBy`), or `team` is the user's pick for `other`. It sets `financeReturnedTo`. A money field on an asset with a PO is refused with "Send PO-0214 back instead".
    - `resubmitAssetToFinance` is gated by `financeReturnedTo === teamOfRole(role)` (admin passes).
    - `updateAsset` enforces `canEditField` per changed field with `assetMoneyStage`. It refuses money fields on assets with a PO ("Fix it on PO-0214"), and accepts a `reason` when one is required. Finance may call it for money fields only.
  - `src/server/modules/finance/undo-actions.ts`: add `undoGroupAction` and `reopenGroup`.
  - `src/lib/asset-class.ts`: `canAttachDocuments` also allows `finance_staff` on any asset it can see, so Finance can re-upload a receipt.
  - `src/lib/workspaces.ts`: Finance item "To review", href `/finance/review`, badge `finGroupsToReview`.
  - `nav-counts.ts`: add the reader for `finGroupsToReview`.
  - The callers of `returnAssetToIt`: `send-back-dialog.tsx` gets a team picker.

**Interfaces:**
- **Consumes:**
  - Task 3's `notify` and `fixPurchaseOrder`;
  - `undoCheck` / `undoState` from `src/lib/finance-undo.ts`;
  - the per-asset effects of `confirmAssetDetails`: move its write block into an exported `approveOne(tx, asset, user, notCapitalised)` in `inventory/actions.ts` and call it from both places.
- **Produces:**
  - `reviewGroups(): Promise<ReviewGroup[]>`, where `ReviewGroup = { key: string; recordId: string | null; assetId: string | null; refNo: string | null; title: string; count: number; total: Decimal; registeredAt: Date; team: "IT"|"PURCHASING" }`.
    - Groups are `PurchaseRecord`s with ≥1 asset in `with-finance`.
    - Legacy assets with no record become single-asset groups, `key = "asset:<id>"`, linking to the existing `/finance/assets/<id>`.
  - `groupDetail(recordId: string)`: the PO money, documents, assets (tag, serial, model, cost, state) and totals.
  - `approveGroup(input: unknown): Promise<ActionResult<{ approved: number; heldBack: number; refNo: string | null }>>`.
    - **Input:** `{ recordId, notCapitalised: boolean, overrides?: { assetId, notCapitalised }[], holdBack?: { assetId, team, fields, note }[] }`.
    - **Refusals:**
      - the PO has no `invoiceRef`: "No SI number yet. Add it before approving.";
      - any non-held asset is no longer `with-finance`: "BR-LT-0207 changed since you opened this. Reload.".
    - **Effects:** `approveOne` per remaining asset, with the audit diff carrying `{ group: recordId }`; `returnAsset` per held asset; one notification per team that got held assets.
    - It emits the two webhooks when the PO becomes fully approved (Global Constraints).
  - `undoGroupAction({ recordId })`.
    - It reverses the actor's last `approveGroup` on that record: approvals and hold-backs, all or nothing, using `undoCheck` per asset.
    - If any asset fails, the whole undo is refused with that asset's reason.
    - Audit: the per-asset `finance.confirm.undone` / `asset.return.undone`.
  - `reopenGroup({ recordId, reason })`: admin only. It reopens every approved asset in the group with `finance.confirm.reopened`.
  - For assets with no PO, Finance fixes money through `updateAsset` with a reason. The fix dialog on `/finance/assets/[id]` and the group page call `fixPurchaseOrder` when the asset has a PO, and `updateAsset` otherwise.
- **UI on `/finance/review/[recordId]`:**
  - The money card has "Fix money details" and "Send back to Purchasing" (PO groups).
  - Documents have preview and upload/re-upload.
  - The asset table has a per-row "Hold back" control, which opens a team picker (IT / Purchasing, defaulting to `returnTeamFor`), fields and a note. There's also a per-row not-capitalised override.
  - The footer has "Approve N" (N excludes held-back assets) and a group-level "Not capitalised" switch.
  - Toasts follow the existing Finance pattern: Undo, then "Approved 3 from PO-0214 · 1 held back".

- [ ] **Step 1: Write the failing tests:**
  - **`groups.test.ts`:** the group per record and legacy single-asset groups; the counts.
  - **`group-actions.test.ts`:**
    - **`approve all`:** sets `financeConfirmedAt` on each asset, with the audit diff `group`.
    - **`hold back one`:** 2 approved and 1 returned with `financeReturnedTo: "IT"`; one IT SENT_BACK notification.
    - **`no SI refused`.**
    - **`stale asset refused`.**
    - **`undo group`:** all reversed; when one asset changed since, the whole undo is refused.
    - **`reopenGroup admin only`.**
    - **`webhooks fire once on full approval`:** both events, and they don't fire on a partial group.
  - **`inventory/actions` tests for `returnAsset`:**
    - money field on a PO asset refused;
    - a way-3 asset registered by IT, with `invoiceRef` sent to IT: accepted; the same sent to PURCHASING: refused;
    - `fieldOwner` mismatch refused;
    - Finance `updateAsset` on serial refused with "Send it back to IT".
- [ ] **Step 2:** `npx vitest run src/server/modules/finance src/server/modules/inventory`. Expected: FAIL.
- [ ] **Step 3:** Implement. Register the audit labels if any new codes appear; reuse existing codes where possible.
- [ ] **Step 4:** `npx vitest run` and `npx tsc --noEmit` are green.
- [ ] **Step 5: Commit** `feat(finance): review a registration group in one go, hold back, send back by team, undo and reopen a group`.

### Task 7: Bell, notifications page, Sent back tabs, Home cards and pruning

**Files:**
- Create:
  - `src/server/notifications/queries.ts` + `queries.test.ts`;
  - `src/server/notifications/actions.ts`;
  - `src/components/shell/notification-bell.tsx`;
  - `src/app/(app)/notifications/page.tsx`.
- Modify:
  - `src/components/shell/topbar.tsx`: put the bell before `DensityToggle`;
  - `src/app/(app)/layout.tsx`: add the initial unread count to its `Promise.all`;
  - `src/lib/retention.ts` + `src/worker/retention.ts`: prune notifications and add `notifications` to `PruneResult`;
  - `src/worker/prune.ts` and `src/worker/retention.test.ts`;
  - `src/lib/workspaces.ts` + `nav-counts.ts`: add the badges `itSentBack` (Inventory → "Sent back" view, `/inventory?reg=needs-correction&to=IT`), `poSentBack` and `finGroupsToReview`;
  - `src/server/modules/home/overview.ts`: needs-you items.

**Interfaces:**
- **Produces:**
  - `unreadCount(user: { id: string; role: Role }): Promise<number>`.
    - It counts notifications for `teamOfRole(role)` with no `NotificationRead` for this user, created within 90 days.
    - Admin and viewer get 0.
  - `listNotifications(user, { tab: "sent-back"|"to-check"|"changed"|"all"; team?: Team; cursor?: string }): Promise<{ items: NotificationView[]; next: string | null }>`.
    - Admins must pass `team`; others get their own team.
    - `NotificationView = { id, kind, title, body, href, actorName, createdAt, read }`.
  - Server actions `markRead({ ids })`, `markAllRead()`, and `bellCount()`, which returns `{ count }` for polling.
- **Bell:**
  - A real button labelled "Notifications, N unread".
  - Its panel has tabs Sent back · To check · Changed · All, with 8 items each and "See all" → `/notifications`.
  - Opening an item marks it read and navigates to it.
  - It polls `bellCount` on route change and every 60 s while the tab is visible.
  - A polite live region announces "1 new notification" only when the count goes up.
- **`/notifications`:** the same tabs, paged 30 at a time, with "Mark all read". Admin gets a team select.
- **Sent back tab:** the inventory filter `to=IT|PURCHASING` adds `financeReturnedTo` to `reg=needs-correction`.
- **Home `needsYou`:**
  - "N sent back to you", linking to that team's Sent back view: Purchasing → `/purchases?state=SENT_BACK`; IT → the Inventory view above.
  - "N to check": IT → `/purchases?state=WITH_IT`; Finance → `/finance/review`.
  - Counts come from state, never from notifications.

- [ ] **Step 1: Write the failing tests:**
  - **`queries.test.ts`:**
    - **`unread is per person`** (Review Focus 4): IT users A and B and one IT notification; A marks it read; `unreadCount(A) === 0` and `unreadCount(B) === 1`.
    - **`a team sees only its team`.**
    - **`older than 90 days not counted`.**
    - **`admin requires team`.**
  - **`nav-counts.test.ts`:** **`itSentBack counts state, not reads`.** One IT-returned asset with its notification read by everyone still gives the count 1. After `resubmitAssetToFinance`, the count is 0.
  - **`retention.test.ts`:** notifications older than 90 days are pruned and their reads cascade; `PruneResult.notifications` is reported.
  - **`overview` test:** the IT overview includes "1 sent back to you".
- [ ] **Step 2:** `npx vitest run src/server/notifications src/server/modules/home src/worker`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx vitest run` and `npx tsc --noEmit` are green.
- [ ] **Step 5: Commit** `feat(notifications): team bell with per-person read state, notifications page, Sent back tabs and Home cards; 90-day pruning`.

### Task 8: Webhook labels and history wording

**Files:**
- Modify:
  - `src/lib/webhooks.ts`: add `purchase_order.approved`, labelled "A purchase order was fully approved". The `purchase_request.completed` label becomes "(old name) A purchase order was fully approved";
  - `src/lib/webhooks.test.ts`;
  - `src/lib/activity.ts` and `src/lib/finance-history.ts`: sentences for every new code, for example "Ana (Finance) fixed the SI number on PO-0214: 'typo on receipt'" and "Ben (IT) sent PO-0214 back to Purchasing";
  - `prisma/seed.ts`: the seeded delivery payload.

- [ ] **Step 1: Write the failing tests:**
  - `webhooks.test.ts` asserts that both events are in `WEBHOOK_EVENTS`.
  - The `activity` / `finance-history` tests assert the exact sentences above, from audit rows built in the test.
- [ ] **Step 2:** `npx vitest run src/lib/webhooks.test.ts src/lib/activity.test.ts src/lib/finance-history.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS. `npx vitest run` is green.
- [ ] **Step 5: Commit** `feat(audit): sentences and webhook labels for purchase orders and fixes`.

### Task 9: Browser tests and docs (runs last)

**Files:**
- Rewrite: `e2e/purchases.spec.ts`, `e2e/receiving.spec.ts`
- Create: `e2e/po-intake.spec.ts`
- Repair: any spec broken by the wording, nav or register changes. Run `npx playwright test --list` first, then grep for "Purchase request", "Register purchase", "Purchase reviews" and `requestId`.
- Docs: `docs/HANDOVER.md` gets an entry (au) for migration 38, the rulings and the follow-ups; `docs/PICKUP.md` gets its status line.

**e2e cases in `po-intake.spec.ts`:**
1. Purchasing saves a mixed PO; IT's bell shows 1.
2. IT sends it back; Purchasing's bell rings and its Sent back tab lists it.
3. Purchasing corrects it with a reply; it's back With IT.
4. IT registers 3 of 5 laptops; the line reads "3 of 5 registered" and Finance's bell rings.
5. Finance opens the group, holds back one asset to IT, and approves 2. The toast reads "Approved 2 from PO-… · 1 held back"; Undo restores all three.
6. Finance fixes the SI number with a reason. Purchasing's bell shows "Changed", and the asset's Financial history shows the sentence and the reason.
7. Purchasing registers the non-IT line on the same PO, and Purchasing can't reach `/inventory/register`.
8. A legacy PO with no SI: Approve is refused with the message.
9. Notifications page: Mark all read; the other IT user still sees unread.
10. axe on the PO page, the group review page and the open bell panel, in light and dark.

- [ ] **Step 1:** Reseed the local DB (`npm run db:seed` or the project's seed script), then start `npm run dev -- -p 3100`.
- [ ] **Step 2:** Run in chunks, foreground: first `npx playwright test e2e/po-intake.spec.ts e2e/purchases.spec.ts e2e/receiving.spec.ts --workers=1`, then the Finance specs (`finance-*`, `phase-47-finance`, `home-finance`, `registration`, `phase-46-home`), then the rest. Expected: all green.
- [ ] **Step 3:** Reseed again. Stop the dev server.
- [ ] **Step 4: Commits:**
  - `test(e2e): purchase orders, three-team intake, group review and the bell`;
  - `docs(handover): Purchase Orders and the three-team intake (migration 38), code-complete`.
