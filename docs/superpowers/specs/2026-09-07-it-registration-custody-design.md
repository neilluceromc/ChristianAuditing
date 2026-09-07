# Phase 16 — Registration, Policy Exceptions, Loans, Bulk Assign and the Signed Form — Design

**Status:** approved in chat 2026-09-07 ("go"); not yet implemented. Amendments during execution are `D-`
entries at the top of the plan. Phase 17 (the scale sweep: pagination everywhere, the employees list in
SQL, cursor paging on the merged timelines) has its own spec and is listed in §10 so nothing here waits
on it.

**Goal:** IT registers devices faster and with fewer slips, models the loadouts it actually issues
(loaners, one-off exceptions), lends a device with a date attached, hands out several spares in one
action, and keeps the signed accountability form on the person, not on paper alone.

**Source requirement:** the user's words of 2026-09-07:

> *"lets do 1-6, then registering employees just adding as of now no m365 integration yet, do 11, 12,
> 16, 17, 18, 25, 26, also pagination of every thing that needs pagination, we might have 1000 assets
> and 600 employees"*

Items refer to the gap list presented the same day: 1 next-tag suggestion · 2 vendor and documents at
creation · 3 one model, N serials · 4 print labels after registering · 5 live duplicate check · 6 the
Purchasing registration fields · 11 per-person policy exceptions · 12 loaner slot · 16 loan due date ·
17 bulk assign · 18 signed acknowledgement · 25/26 pagination and the employees list (→ Phase 17).

Follow-up answers: the missing Purchasing fields are **serial per unit, warranty end date, invoice or
receipt number with the document, description or notes plus brand**. Employees: **keep the manual form
as it is**, no M365. Acknowledgement: **a signing date plus the scanned signed form**. Approach chosen:
**two phases, features first**.

---

## 0. Naming — read this first

`admin` is the sysadmin role. The business's "Admin department" is Purchasing (`purchasing` workspace,
`purchasing_staff` role). "IT" below means the `it_staff` role and `admin` acting on IT-class assets.
"Register" is the single-asset form at `/inventory/new`; "the batch page" is `/inventory/register`,
which both IT and Purchasing may open (`requireRole("admin","it_staff","purchasing_staff")` today).
"Loan" is an assignment that lands on `TEMPORARY`. "Standard slot" is a policy slot as it exists today;
"loaner slot" is the new kind.

---

## 1. Decisions, with who made them and what was rejected

| # | Question | Decision | By | Rejected |
|---|---|---|---|---|
| 1 | Scope split | **Two phases.** Phase 16 is this spec; Phase 17 is the scale sweep. Each has its own spec, plan, merge. | user | One 16-task plan; scale first. |
| 2 | Where does "one model, N serials" live for IT? | **The batch page IT can already open.** It gains a link from the IT navigation and toolbar and the fields in row 5. No second batch form. §2.3, §2.7 | assistant | A quantity field on the single-asset form. |
| 3 | Next-tag suggestion | **Both forms suggest the next free number for the category's most-used prefix**, computed by one grouped query. The tag stays editable. §2.1 | user (item 1) | Auto-assigned, read-only tags. |
| 4 | Documents at creation | **Single form: files chosen before submit are uploaded with the existing `uploadDocument` action right after the asset is created.** Batch page: **one invoice file stored once, one document row per unit.** §2.5 | user (items 2, 6) | Files inside the create transaction (a multipart create action); a document table keyed by batch. |
| 5 | The Purchasing fields | **Warranty until, brand, notes, invoice/receipt number, invoice document** join the batch page; serial per unit already exists there. Brand and invoice reference are two new nullable columns on `Asset`. §2.3, §8 | user | Brand folded into `model`; invoice number kept only in the file name. |
| 6 | Live duplicate check | **A `checkIdentifiers` action the forms call on blur**, reporting which tags and serials are already registered. The batch action also names a clashing serial instead of blaming a tag. §2.4 | user (item 5) | Submit-time errors only. |
| 7 | Per-person exceptions | **Exceptions layered on the resolved policy**: a small table of ADD and WAIVE rows per employee, applied by a pure function before the loadout is computed. §3.2 | user (item 11); shape by assistant | A one-person policy (`appliesToEmployeeId`), which duplicates every slot to change one. |
| 8 | Loaner slots | **A `loaner` flag on `PolicySlot`.** Loaner slots fill only with `TEMPORARY` devices; standard slots only with non-`TEMPORARY` ones; an unmatched `TEMPORARY` device is "on loan", never an extra. §3.1, §3.3 | user (item 12); rule by assistant | Letting a loaner fill a standard slot (today's behaviour, which hides a missing device). |
| 9 | Loan due date | **`Asset.loanDueAt DateTime?`**, set when an assignment lands on `TEMPORARY`, cleared by every other status write. Required in the dialogs, not in the executor (worker guard messages do not change). Legacy loans with no date surface at the top of the Loans section with a "set a due date" action. §4 | user (item 16); placement by assistant | Deriving the due date from the audit trail (Phase 15's proxy — an unbounded scan). |
| 10 | Bulk assign | **A direct action beside bulk status change**: one person, Deployed or Loan, one transaction, the 200 cap, and a per-tag list of what was skipped and why. §5 | user (item 17) | Bulk assign through the request queue. |
| 11 | Signed acknowledgement | **An employee-level `Acknowledgement` row**: signing date, the scanned file, who recorded it, and a snapshot of the items covered. Shown on the employee page with an "issued since last signature" hint. §6 | user (item 18: date + scan) | On-screen signature; a date stamp with no file; reusing `AssetDocument` (asset-scoped, `Restrict` FK). |
| 12 | Employees | **Unchanged**: the manual form and the spreadsheet import. No M365. | user | Manager/site fields; pre-hire dates. |
| 13 | Schema change | **One additive migration** `20260907110000_it_registration_custody`: three nullable columns on `Asset`, one flag on `PolicySlot`, one enum, two tables. Migration count 16 → 17. No backfill. §8 | — | — |

---

## 2. Registration

### 2.1 Next-tag suggestion — one query, both forms

`tagSuggestions(categoryIds: string[]): Promise<Record<string, CategorySuggestion>>` in
`src/server/modules/inventory/tag-suggest.ts` (`"use server"` not needed — a server-only module called
from server components and actions). One raw SQL statement over `Asset` grouped by `categoryId` and
`substring("tag",4,2)` returning, per category, `prefixes: Array<{ prefix: string; n: number }>` ordered
`n desc, prefix asc` and `highest: Record<prefix, number>` (`max(substring("tag",7,4))`). It replaces
`prefixCountsForCategory` and `highestTagNumber` in `src/server/modules/purchases/receiving.ts`, whose
one-query-per-category and one-query-per-prefix loops on the batch page are deleted. The pure pieces
stay where they are: `nextTags`, `preferredPrefix`, `PREFIX_SHAPE`, `MAX_TAG_NUMBER` in
`src/lib/receiving.ts`; `TAG_SHAPE` in `src/lib/tag-key.ts`.

Both pages pass the suggestion map to their forms. On category change, the form sets the prefix to
`preferredPrefix(prefixes)` and the tag to `nextTags(prefix, highest[prefix] ?? null, 1).tags[0]`, with
the hint *"Suggested — next free number for BR-LT. Edit if you need another."* A category with no tags
yet leaves the tag blank with the hint *"No tags yet for this category — type BR-XX-0000."* The
suggestion re-applies on category change only while the user has not typed in the tag field (a
`touched` flag, the same rule the batch page already uses for its tag run). A prefix at 9999 shows
`nextTags`' `overflow` refusal text and no suggestion.

### 2.2 The single-asset form (`/inventory/new`)

Additions to `AssetForm` in `mode="new"` and to `createSchema`/`createAsset`:

- **Vendor.** The page passes `vendors` (already loaded by the edit page); the form renders the vendor
  `Select` inside the Procurement group (Purchased · Cost · Warranty until · Vendor) in both modes, and
  no longer only inside the Repair card in edit mode. `createSchema` gains `vendorId: z.string().optional()`;
  a vanished vendor is the existing `P2003` conflict.
- **Brand and invoice reference.** `brand` (text, ≤ 60) in the Identity group after Model; `invoiceRef`
  (text, ≤ 60, label *"Invoice / receipt no."*) in the Procurement group. Both optional, both in
  `createSchema` and `updateSchema`, both shown on the record (Identity and Procurement & warranty cards),
  in `asset-diff.ts` labels (*Brand*, *Invoice / receipt no.*, *Loan until*) and in the asset export
  columns after *Vendor*.
- **Documents.** A *Documents* field: multiple files, each `.pdf/.png/.jpg/.jpeg` ≤ 10 MB, a kind per file
  from `KINDS` (which gains `"invoice"`; default `"receipt"`). On submit the form calls `createAsset`
  as today; on success it calls the existing `uploadDocument(formData)` once per file, in order, then
  navigates to the record with `?created=1`. If any upload fails the navigation goes to the record's
  Documents tab with the banner *"Registered. N of M documents did not upload — add them here."* No
  change to `createAsset`'s transaction; every upload is audited by the existing action.
- **Labels after registering.** The record page reads `?created=1` and shows a one-time toast
  *"BR-LT-0211 registered"* with a *Print label* link to `/inventory/labels?ids=<id>`.

### 2.3 The batch page (`/inventory/register`)

`RegisterForm` and `registerSchema`/`registerAssets` gain, applied to every unit in the batch:

- **Warranty until** (date). Prefilled as purchased date + 12 months when a purchased date is entered,
  the same derivation `asset-form.tsx` uses; editable.
- **Brand** (≤ 60), **Notes** (≤ 2000, textarea), **Invoice / receipt no.** (≤ 60).
- **Invoice document** (one file, same type and size rules). After `registerAssets` succeeds — it now
  returns `{ created: number; ids: string[] }` — the form calls the new
  `uploadBatchDocument(formData)` in `src/server/modules/inventory/document-actions.ts`: `assetIds[]`
  (1–200), `kind` (from `KINDS`), `file`. The action checks every asset exists and that the actor
  `canManageClass` each one's class, stores the file **once** at `uploads/batches/<Date.now()>-<safeName>`,
  and in one transaction creates one `AssetDocument` row per asset (same `path`, `checksum`, `fileName`,
  `kind`) with one `document.uploaded` audit entry per asset. The download route is unchanged: it
  resolves any relative path under `uploads/` and already refuses traversal.
- **Success panel** replacing the current count toast: *"5 assets registered — BR-LT-0211 … BR-LT-0215"*,
  with *Print labels* (`/inventory/labels?ids=<ids>`), *Open the list*, *Register another batch*.

Serial per unit already exists on this page and is unchanged. The batch page's role guard is unchanged.

### 2.4 Live duplicate check

`checkIdentifiers(input: { tags?: string[]; serials?: string[] }): Promise<ActionResult<{ tags: string[]; serials: string[] }>>`
in `src/server/modules/inventory/actions.ts`: roles `admin`, `it_staff`, `purchasing_staff`; ≤ 200 of
each; tags normalised with `tagKey`, serials trimmed; returns the subset already present on any asset of
any class. It returns only the echoed identifiers, never asset details. **Known leak, accepted:** IT
learns that a tag or serial exists on a Purchasing asset — the same fact the unique-constraint error
reveals at submit today.

The single form calls it on blur of Tag and of Serial (debounced 300 ms) and shows the field error
*"Already registered"* before submit. The batch page calls it on blur of any tag or serial cell and
before submit, and flags in-batch duplicate serials client-side the way it flags duplicate tags. Server
side, `registerAssets` refuses an in-batch duplicate serial with `conflict("Serial <value> appears twice
in this batch.")`, pre-checks serials before the transaction so a clash is reported as
`validationError({ serials: "Serial <value> is already registered" })`, and the residual `P2002` catch
uses `uniqueTarget()` (as `createAsset` does) to say *"That tag is already registered"* or *"That serial
is already registered"* instead of *"One of those tags was just taken."*

### 2.5 Documents — shared rules

The validation and storage halves of `uploadDocument` move to `src/server/uploads.ts`:
`validateUpload(file: File): { ok: true; ext: string } | { ok: false; error: string }` (extension table,
MIME cross-check, `MAX_BYTES`) and `storeUpload(relDir: string, file: File): Promise<{ relPath: string; checksum: string; safeName: string }>`.
`uploadDocument`, `uploadBatchDocument` and §6's `recordAcknowledgement` all call them. Behaviour of
`uploadDocument` is unchanged.

### 2.6 Register form fields, as a table

| Field | Single form | Batch page | Column |
|---|---|---|---|
| Tag | suggested, editable | tag run, editable per row | `tag` |
| Serial | optional, live-checked | per row, live-checked | `serial` |
| Model, Category, Type | as today | as today | — |
| Brand | new | new | `brand` (new) |
| Purchased, Cost | as today | as today | — |
| Warranty until | as today | new | `warrantyUntil` |
| Vendor | new in `mode="new"` | as today | `vendorId` |
| Invoice / receipt no. | new | new | `invoiceRef` (new) |
| Notes | as today | new | `notes` |
| Documents | new, N files, uploaded after create | new, one invoice file to every unit | `AssetDocument` rows |
| Initial status, Assign to | as today | — | — |
| Purchase request | — | as today | — |

### 2.7 Navigation

IT's Inventory group gains *"Register several"* → `/inventory/register` for `admin` and `it_staff`
(Purchasing's *"Register assets"* entry is unchanged). The inventory page's *New asset* button gains a
secondary *Register several* link beside it for the same roles. `src/lib/workspaces.ts`'s path rule for
`/inventory/register` is unchanged.

---

## 3. Equipment policies

### 3.1 Loaner slots

`PolicySlot.loaner Boolean @default(false)`. `addSlotSchema` gains `loaner: z.boolean()`; the policy
editor's add-slot row gains the checkbox *"Loaner slot — filled by a device on loan (TEMPORARY)"*; slot
rows show a `LOAN` pill. Audit diff for slot lists (`slotList`) names loaner slots with a `(loaner)`
suffix so `policy.slot.added` reads correctly.

### 3.2 Per-person exceptions

```prisma
enum SlotExceptionKind { ADD WAIVE }

model EmployeeSlotException {
  id          String            @id @default(cuid())
  employeeId  String
  employee    Employee          @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  kind        SlotExceptionKind
  /// WAIVE: the policy slot this person does not need. Cascade: a slot removed from
  /// the policy takes its waivers with it.
  slotId      String?
  slot        PolicySlot?       @relation(fields: [slotId], references: [id], onDelete: Cascade)
  /// ADD: an extra slot for this person only.
  name        String?
  assetTypeId String?
  assetType   AssetType?        @relation(fields: [assetTypeId], references: [id], onDelete: Restrict)
  required    Boolean           @default(true)
  loaner      Boolean           @default(false)
  reason      String
  createdById String
  createdBy   User              @relation("slotExceptionsCreated", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt   DateTime          @default(now())

  @@index([employeeId])
}
```

Actions in `src/server/modules/employees/exception-actions.ts`, all `actionRole("admin","it_staff")`,
reason ≥ 3 characters, employee not `OFFBOARDED`:

- `addSlotException({ employeeId, name (2–40), assetTypeId, required, loaner, reason })` → `{ id }`.
- `waiveSlot({ employeeId, slotId, reason })` → `{ id }`; refuses a slot that is not in the employee's
  currently resolved policy (*"That slot is not part of this person's policy."*) and a second waiver of
  the same slot.
- `removeSlotException({ id })` → `null`.

Each writes an `AuditEntry` with `entityType: "employee"`, actions `policy.exception.added`,
`policy.exception.waived`, `policy.exception.removed`, diff `{ slot: { from, to } }` where the value is
the slot's name (with `(loaner)` when set) and the reason is in `diff.reason`. Revalidates the employee
page, `/employees` and `/`.

### 3.3 Loadout rules (pure, `src/lib/loadout.ts`)

`ExceptionLike` is the structural shape of one exception row:
`{ id: string; kind: "ADD" | "WAIVE"; slotId: string | null; name: string | null; assetTypeId: string | null; required: boolean; loaner: boolean }`
(the Prisma model, with `reason` and the audit fields left out — the same pattern as `SlotLike`).

`effectiveSlots(slots: SlotLike[], exceptions: ExceptionLike[]): SlotLike[]`:
1. drop every slot whose `id` is the `slotId` of a `WAIVE` row — a waiver whose `slotId` is not among
   `slots` (the person's policy changed) is ignored, not an error;
2. append every `ADD` row as a slot `{ id: "x:" + exception.id, name, assetTypeId, required, loaner, exception: true }`,
   ordered by `name` then id, after the policy's slots.

A person with no resolved policy but with `ADD` rows gets a loadout of those rows alone — a personal
loadout for someone outside every policy.

`computeLoadout(slots, held)` keeps its greedy order and adds one rule: a **standard slot** matches a held
asset with the slot's `assetTypeId` and `status !== "TEMPORARY"`; a **loaner slot** matches one with the
slot's `assetTypeId` and `status === "TEMPORARY"`. Leftover `TEMPORARY` assets go to a new `onLoan: A[]`;
other leftovers stay in `unslotted`. `missingRequired` counts unfilled required slots of both kinds;
`filled`/`totalSlots` are unchanged in meaning. `SlotLike` gains `loaner: boolean` and optional
`exception?: true`.

Every consumer computes over `effectiveSlots(policy?.slots ?? [], exceptions)`: the employee page, the
Employees list and its export (the in-memory path fetches the candidates' exceptions in one query; Phase
17 restructures that path), the Worklist "hires" section and Home's fleet coverage (both use
`missingRequired`).

### 3.4 Surfaces

Employee page (`admin`/`it_staff`, employee not `OFFBOARDED`):

- Loaner slot tiles carry a `LOAN` pill; filling one opens the assign dialog in Loan mode (§4.2).
- An *"On loan"* group lists `onLoan` devices after the slots and before *Unslotted*.
- Each slot tile's menu gains *"Waive for this person…"* (dialog: reason). Waived slots collapse into
  *"Waived for this person (N)"* with a *Restore* action (= `removeSlotException`).
- *"Add a slot for this person…"* (dialog: name, type, required, loaner, reason). Exception tiles carry
  an `EXCEPTION` pill whose tooltip is the reason, and a *Remove exception* menu item.

The policies admin page is unchanged apart from the loaner checkbox and pill.

---

## 4. Loans

### 4.1 `loanDueAt`

`Asset.loanDueAt DateTime?` + index. Set by an assignment whose target status is `TEMPORARY`; cleared —
set to `null` — by every other status write through `prepareLifecycle` (assign to `DEPLOYED`, return,
change-status, replace, triage). `LifecycleChange`'s assign variant becomes
`{ kind: "assign"; employeeId: string; status: AssetStatus; loanDueAt: Date | null }`; the executor copies
`status === "TEMPORARY" ? change.loanDueAt : null` into `updates.loanDueAt` and adds `loanDueAt` to the
diff when it changes. **No new executor guard**: a legacy queued approval whose payload has no
`loanDueAt` (the seeded `APR-2039`) still executes to `TEMPORARY` with `loanDueAt = null`. The worker
reads `payload.to.loanDueAt` when present. Direct assign payloads record `to: { status, loanDueAt }`.

### 4.2 Dialogs

`assignSchema` gains `loanDueAt: dateStr.optional()` with a refinement: `status === "TEMPORARY"` requires
a `loanDueAt` on or after today (*"A loan needs a due date."*). `DEFAULT_LOAN_DAYS = 30` in
`src/lib/worklist.ts` replaces `LOAN_DAYS` and is the dialogs' default (today + 30).

- `HolderControl` assign mode gains a `SegmentedControl` *Deployed | Loan*; Loan reveals *Loan until*
  (date, default today + 30, min tomorrow). Default is Deployed, so existing e2e flows are unchanged.
- Loadout tile dialog: a loaner slot opens in Loan mode with the date field; a standard slot stays
  Deployed with no toggle.
- The record's Holder card, when `TEMPORARY`: *"On loan until 7 Oct 2026 · Change"*, or in attention
  tone *"No due date — set one"*. Both open a small dialog for `setLoanDue`.
- Purchasing-class dialogs are unchanged (`ASSIGN_TARGETS.PURCHASING` has no `TEMPORARY`).

`setLoanDue({ assetId, loanDueAt })` in `src/server/modules/lifecycle/actions.ts`: the asset is IT-class,
`status === "TEMPORARY"`, the role manages IT; writes `loanDueAt` and an audit entry `loan.due-changed`
with diff `{ loanDueAt: { from, to } }`. **No approval row**: a due date is metadata like notes, not a
lifecycle transition (decision 9). Revalidates the record, `/inventory/work` and `/`.

### 4.3 The Loans section

`src/server/modules/home/queries.ts` drops the audit-entry scan. Query: `cls: "IT", status: "TEMPORARY"`,
select `id, tag, model, loanDueAt, assignee.name`, `orderBy: { loanDueAt: { sort: "asc", nulls: "first" } }`,
`take: 50`. Rows come from a pure `loanRow(asset, now): WorkRow | null` in `src/lib/worklist.ts`:

| Case | Title | Meta | Severity | Action |
|---|---|---|---|---|
| `loanDueAt === null` | `BR-LT-0210 on loan with no due date` | `<holder> · set a due date` | 1000 | *Set date* → record |
| overdue by N days | `BR-LT-0210 overdue by N d` | `<holder> · due <date>` | 500 + N | *Review* → record |
| due within 7 days | `BR-LT-0210 due in N d` | `<holder> · due <date>` | 7 − N | *Review* → record |
| later | excluded | | | |

Section blurb: *"Loans overdue, due this week, or with no due date."* Section order is unchanged.

---

## 5. Bulk assign

`bulkAssign(input)` in `src/server/modules/lifecycle/actions.ts`:

```ts
const bulkAssignSchema = z.object({
  ids: z.array(z.string().min(1)).max(500).optional(),
  filters: z.string().max(2000).optional(),
  employeeId: z.string().min(1),
  status: z.enum(["DEPLOYED", "TEMPORARY"]),
  loanDueAt: dateStr.optional(),
  reason: z.string().trim().max(500).optional(),
}).refine(ids-or-filters).refine(TEMPORARY ⇒ loanDueAt ≥ today);
// → ActionResult<{ assigned: number; skipped: Array<{ tag: string; reason: string }> }>
```

Same `where` resolution, `BULK_MAX` (200) refusal, mixed-class refusal, `isDirectLifecycle` refusal and
`$transaction({ timeout: 60_000, maxWait: 10_000 })` as `bulkChangeStatus`. The employee is checked once
(exists, `ACTIVE`). Per asset: `loadDirect`'s refusals and `recordDirect({ change: { kind: "assign", … }, type: "lifecycle_assign", action: "lifecycle.assign" })`;
any refusal becomes a `skipped` entry with the humanised guard text (not assignable, untriaged, reserved
for someone else, held by an open approval). Each success writes the `EXECUTED` approval row, the
`lifecycle.assign` audit entry and the `approval.executed` webhook, exactly as a single assign does.
Revalidates `/inventory`, `/employees/[id]`, `/`.

`BulkDrawer` gains an *Assign to a person* mode when `direct && cls === "IT"` (the page passes `employees`,
ACTIVE only, to the drawer): person combobox, *Deployed | Loan* with *Loan until*, optional reason. On
completion it shows *"Assigned N · Skipped M"* and the skipped tags with their reasons. `bulkChangeStatus`
keeps its `{ changed, skipped: number }` shape; changing it is out of scope.

---

## 6. The signed accountability form

```prisma
model Acknowledgement {
  id           String   @id @default(cuid())
  employeeId   String
  employee     Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  signedAt     DateTime
  fileName     String
  path         String   // relative under uploads/
  checksum     String
  /// snapshot of what they held when the form was recorded: [{ assetId, tag, model, serial }]
  items        Json
  recordedById String
  recordedBy   User     @relation("acknowledgementsRecorded", fields: [recordedById], references: [id], onDelete: Restrict)
  createdAt    DateTime @default(now())

  @@index([employeeId, signedAt])
}
```

`recordAcknowledgement(formData)` in `src/server/modules/employees/acknowledgement-actions.ts`:
`actionRole("admin","it_staff")`; `employeeId`; `signedAt` (date, not after today); `file` through
`validateUpload`/`storeUpload` into `uploads/employees/<employeeId>/`; `items` = the employee's held
assets at record time; audit `entityType: "employee"`, action `acknowledgement.recorded`, diff
`{ signedAt: { from: null, to }, items: { from: null, to: String(n) } }`. Download route
`src/app/(app)/employees/[id]/acknowledgements/[ackId]/download/route.ts`: `requireUser`, the row's
`employeeId` must equal `[id]`, traversal guard, `content-disposition: attachment`. Any signed-in role
may download (every role can open the employee page).

Pure `uncoveredItems(held: Array<{ assetId: string; tag: string }>, last: Array<{ assetId: string }> | null)`
in `src/lib/acknowledgement.ts`: held items whose `assetId` is not in the last snapshot; with no
acknowledgement on file, all held items.

Employee page card *"Accountability form"*: last signing date and *"N items covered"* with a download
link, or *"No signed form on file"*; the hint *"Issued since last signature: BR-LT-0211, BR-MN-0902"*
when `uncoveredItems` is non-empty; buttons *Print form* (the existing `/employees/[id]/form`) and, for
`admin`/`it_staff`, *Record a signed form…* (dialog: date, file). *History (N)* collapses earlier rows
(date, items, download). The printed form's footer sentence changes to *"After signing, IT records the
scan on this person's page under Accountability form."*

---

## 7. What does not change

Purchasing's request queue, approvals and worker; the worker's guard messages; `createAsset`'s
transaction and its direct-assign branch; the offboarding wizard; Replace and triage; the label sheet;
`uploadDocument`'s behaviour; the employees form and import; `bulkChangeStatus`'s return shape; the
`asset_class_invariants` trigger (none of the new columns are in its scope).

---

## 8. Schema and migration

`prisma/migrations/20260907110000_it_registration_custody/migration.sql`, hand-written, additive, no
backfill:

- `ALTER TABLE "Asset" ADD COLUMN "loanDueAt" TIMESTAMP(3), ADD COLUMN "brand" TEXT, ADD COLUMN "invoiceRef" TEXT;`
  `CREATE INDEX "Asset_loanDueAt_idx" ON "Asset"("loanDueAt");`
- `ALTER TABLE "PolicySlot" ADD COLUMN "loaner" BOOLEAN NOT NULL DEFAULT false;`
- `CREATE TYPE "SlotExceptionKind" AS ENUM ('ADD', 'WAIVE');` and `CREATE TABLE "EmployeeSlotException"`
  with the foreign keys and index in §3.2.
- `CREATE TABLE "Acknowledgement"` with the foreign keys and index in §6.

`schema.prisma` mirrors it, including the back-relations on `Employee` (`slotExceptions`,
`acknowledgements`), `PolicySlot` (`waivers`), `AssetType` (`slotExceptions`) and `User` (the two named
relations). Migration count 16 → 17. Seed fixtures: **none added** (`home-finance.spec.ts` pins the
fleet at 25 IT assets); e2e manufactures what it needs through Prisma as `scanner.spec.ts` does.

---

## 9. Testing

Baselines on `main` at `acc9aed`: 998 unit / 54 files · 214 e2e / 16 files · `tsc` and `lint` clean ·
16 migrations.

### 9.1 Unit (pure, `src/lib`)

- `loadout.test.ts`: standard vs loaner matching; `TEMPORARY` never fills a standard slot; `onLoan`;
  `effectiveSlots` with a waiver, a stale waiver, an `ADD`, and `ADD`-only with no policy;
  `missingRequired` across both kinds.
- `worklist.test.ts`: `loanRow` for the four cases in §4.3; section order unchanged; `DEFAULT_LOAN_DAYS`.
- `acknowledgement.test.ts`: `uncoveredItems` with no record, a full match, and a partial match.
- `receiving.test.ts` (exists): add `nextTags` at 9998 → one tag; at 9999 → overflow, if not already
  covered.
- `asset-diff.test.ts`: the three new labels.
- `uploads.test.ts`: `validateUpload`'s table (extension, MIME mismatch, size).

### 9.2 End-to-end

New `e2e/registration.spec.ts` (IT and Purchasing sign-ins):
1. Picking a category on `/inventory/new` prefills the next free tag for its most-used prefix; the tag
   stays editable.
2. A vendor and a brand chosen at creation appear on the record; a document chosen before submit is on
   the record's Documents tab with an audit entry.
3. Typing a seeded serial and leaving the field shows *Already registered* before submit.
4. The batch page registers 3 units with warranty, brand, invoice reference and notes on every unit,
   one invoice document on each, and the success panel's *Print labels* link carries the 3 ids.
5. Two equal serials in one batch are refused naming the serial; a seeded serial is refused as a
   serial, not a tag.
6. *Register several* is in IT's navigation and opens the batch page.

New `e2e/custody.spec.ts` (IT sign-in):
7. Adding a loaner slot to *Finance standard* fills it with a Finance employee's `TEMPORARY` device and
   leaves the standard slot for that type unfilled.
8. Waiving a slot drops the person's missing count; the waiver shows under *Waived for this person*;
   restoring it brings the slot back. Adding a personal slot shows the `EXCEPTION` pill and its reason.
9. Assigning a spare as a Loan with a due date shows *On loan until* on the record and writes
   `loanDueAt` (DB check); returning it clears the column.
10. A `TEMPORARY` device with a past `loanDueAt` (set through Prisma) appears in the Worklist's Loans
    section as overdue; a seeded loan with none appears at the top with *Set date*.
11. Bulk assign of three selected spares to one person assigns two and skips the untriaged one, naming
    it; each success has an `EXECUTED` approval row and a `lifecycle.assign` audit entry (DB check).
12. Recording a signed form with a date and a PDF shows the date and *N items covered*, the download
    answers 200 with `content-disposition: attachment`, and issuing one more device makes the *Issued
    since last signature* hint name it.

Existing specs to touch: `direct-lifecycle.spec.ts` (the Loans row text), `it-core.spec.ts` (the assign
dialog now has a mode toggle; defaults keep the flows), `admin.spec.ts` (policy editor add-slot row),
`axe-sweep.spec.ts` (new dialogs and the batch success panel). Expected: 214 → about 226 e2e / 18 files.

---

## 10. Out of scope, on the record

- **Phase 17 — the scale sweep** (own spec): page numbers on Approvals, Offboarding, Reservations,
  Admin users and webhook deliveries; the Employees list paged in SQL with loadout computed only for the
  page; an *older* cursor on the asset History and the two merged Timelines; `take` and ordering
  tiebreakers everywhere skip/take is used; a grouped count instead of the 600-row employee read on the
  policies page; the worklist's remaining uncapped sources.
- M365 or Entra: sign-in, directory import, account status.
- Employee fields (manager, site) and pre-hire start dates.
- Bulk import columns for brand and invoice reference.
- A quantity column on policy slots; per-slot ordering.
- Changing `bulkChangeStatus`'s return shape to list skipped tags.
- Notifications.

---

## 11. Files

New: `prisma/migrations/20260907110000_it_registration_custody/migration.sql` ·
`src/server/modules/inventory/tag-suggest.ts` · `src/server/uploads.ts` (+test) ·
`src/server/modules/employees/exception-actions.ts` · `src/server/modules/employees/acknowledgement-actions.ts` ·
`src/lib/acknowledgement.ts` (+test) · `src/components/employees/{slot-exception-controls,acknowledgement-card}.tsx` ·
`src/components/inventory/{register-success,loan-due-control}.tsx` ·
`src/app/(app)/employees/[id]/acknowledgements/[ackId]/download/route.ts` ·
`e2e/{registration,custody}.spec.ts`.

Changed: `prisma/schema.prisma` · `src/lib/loadout.ts` (+test) · `src/lib/worklist.ts` (+test) ·
`src/lib/asset-diff.ts` (+test) · `src/lib/export-columns.ts` · `src/lib/workspaces.ts` (+test) ·
`src/lib/receiving.ts` (+test) · `src/server/modules/inventory/{actions,document-actions,queries}.ts` ·
`src/server/modules/purchases/receiving.ts` · `src/server/modules/lifecycle/{apply,actions}.ts` ·
`src/worker/execute-approval.ts` · `src/server/modules/home/queries.ts` · `src/server/modules/employees/queries.ts` ·
`src/server/modules/admin/policy-actions.ts` · `src/components/inventory/{asset-form,register-form,holder-control,bulk-drawer}.tsx` ·
`src/components/employees/loadout-view.tsx` · `src/components/admin/policy-editor.tsx` ·
`src/app/(app)/inventory/{new,register,page}.tsx` · `src/app/(app)/inventory/[id]/{layout,page,edit/page}.tsx` ·
`src/app/(app)/employees/[id]/{page,form/page}.tsx` · `src/app/(app)/inventory/export/route.ts` ·
`e2e/{direct-lifecycle,it-core,admin,axe-sweep}.spec.ts` · `docs/PICKUP.md` · `docs/HANDOVER.md`.
