# Phase 18 — Purchasing: supplier master data and request extensions

**Status:** design approved in conversation 2026-09-08 (approach and section 1 explicitly; sections 2–6 by
the instruction "continue until we finished developing this phase"). Implements HANDOVER §9 items **B**
(vendor / supplier master data) and **C** (purchasing workflow extensions). Item **D** (consumables and
stock control) is a separate phase with its own spec. **Implemented on `phase-18-purchasing-suppliers`
(code-complete 2026-09-08) — see the plan's `D-1`…`D-17` amendment block for every deviation.** Contra
§8.2's "no existing e2e file changes": two pre-existing e2e files changed, both compile-forced by an
earlier task's own column addition, not new assertions — `e2e/asset-classes.spec.ts` (a `provenance`
value in its hand-built fixture literal, Task 7) and `e2e/purchases.spec.ts` (two `selectOption` lines so
its existing draft-creation steps pick a department, Task 9) — see plan `D-15`.

**Plan:** `docs/superpowers/plans/2026-09-08-phase-18-purchasing-suppliers.md` (written next).

---

## 0. Decisions made in the brainstorm

| # | Decision | Why |
|---|---|---|
| 1 | B and C ship together as one phase; D waits. | Both edit `PurchaseRequest` and the Purchasing workspace; D is a second domain. |
| 2 | One supplier per request, optional, settable at any state. | Matches one vendor per asset on the register page; per-line suppliers were not asked for. |
| 3 | Purchasing (and the sysadmin role) maintain suppliers; Purchasing, Finance and sysadmin may reveal bank numbers; everyone signed in reads profiles. | §9: "admin (= Purchasing) maintains the master list, others get access matching their responsibilities." Finance pays suppliers. |
| 4 | Department on a request is REQUIRED for new and saved drafts; it filters and counts; it does not route. | Routing changes the review flow and approvals model — its own design. |
| 5 | Asset provenance shows three values (purchase request / direct / historical) and is DERIVED: request link → purchase request; `importedAt` set → historical; else direct. | §6a: derived state beats stored state. Only "came from a CSV import" is new information. |
| 6 | Request attachments: quotation, purchase order, invoice, delivery receipt, other; uploaded at any state by Purchasing, IT, Finance or sysadmin; downloaded by anyone who can open the request. | A late quotation or corrected invoice needs somewhere to go. |
| 7 | Starting data arrives through an in-app CSV import with the employee importer's preview-then-commit flow; no bank details in the file. | The current list is years old; a several-hundred-row list is not typed by hand; e2e uses a fixture list. |
| 8 | Documents are per-owner tables (`VendorDocument`, `RequestDocument`) shaped like `AssetDocument`, not one polymorphic table. | Real foreign keys, per-owner access rules, no migration of existing asset documents. |
| 9 | Nothing is deleted: suppliers are archived; documents are Restrict-on-delete. The one exception is a supplier bank account, which may be removed (audited) because a stale account number is a payment risk. | Same posture as every other reference row in the app. |

---

## 1. Scope

**In:** the `Vendor` profile, contract, bank accounts (encrypted), documents; a Suppliers area under the
Purchasing workspace (list, profile, new, edit, import); suppliers in the command palette; supplier and
department on purchase requests with list filters and columns; request attachments; asset provenance
(filter, badge, export column, importer stamp, migration backfill); the register page prefilling the
vendor from a named request's supplier; access rules; audit entries; tests.

**Out (deferred, recorded here so nobody infers them):** department-based routing or approval
responsibility; a purchase-order document type or PO numbering (the request IS the order in this app);
supplier ratings or performance; supplier-level price lists; M365/Entra sync of anything; an inventory
facet by vendor (the supplier page lists its assets instead); consumables (item D).

**Behaviour that must not change:** the IT-then-Finance review flow and its state machine; every existing
purchases URL; `Pagination`'s markup; the asset importer's existing columns and row rules (it only gains a
stamp); the label sheet, offboarding, approvals and secrets surfaces.

---

## 2. Data model — migration 19 `purchasing_suppliers`

Additive, plus one backfill. All new columns nullable unless stated.

### 2.1 `Vendor` (extended in place)

Keeps `id`, `name @unique`, `locked`, `assets[]`. Adds:

| Column | Type | Notes |
|---|---|---|
| `registeredName` | String? | legal / registered company name |
| `category` | String? | product or service category; free text; the form autocompletes from existing distinct values |
| `contactPerson`, `phone`, `email`, `address` | String? | |
| `registrationNo` | String? | SEC/DTI/TIN or similar, free text |
| `contractStatus` | enum `VendorContractStatus { NONE, ACTIVE, EXPIRED, SUSPENDED }` default `NONE` (NOT NULL) | |
| `contractStart`, `contractEnd` | DateTime? | dates only (UTC midnight, `dateStr` shape) |
| `contractTerms` | String? | free text, max 2000 |
| `notes` | String? | max 2000 |
| `archivedAt` | DateTime? | hidden from pickers when set; still listed under the Archived filter |
| `createdAt` | DateTime default now | |
| `updatedAt` | DateTime default now, `@updatedAt` | |
| relations | `requests PurchaseRequest[]`, `documents VendorDocument[]`, `bankAccounts VendorBankAccount[]` | |

Indexes: `@@index([archivedAt])`, `@@index([category])`, `@@index([contractStatus])`.

### 2.2 `VendorBankAccount`

`id`, `vendorId` (→ Vendor, onDelete Cascade — a supplier is never deleted, so this never fires; Cascade
keeps the schema honest), `label` String, `bankName` String, `accountName` String, `accountLast4` String
(clear text, the masked display), `ciphertext` String (the full account number, AES-256-GCM v1 via
`encryptSecret`, AAD `${vendorId}:${label}`), `createdById` → User (Restrict), `createdAt`.
`@@unique([vendorId, label])`.

### 2.3 `VendorDocument` and `RequestDocument`

Both mirror `AssetDocument` exactly: `id`, owner id (→ Vendor / PurchaseRequest, onDelete Restrict),
`kind` String, `fileName`, `path` (relative under `uploads/`), `checksum`, `uploadedById` → User
(Restrict), `createdAt`. Index on the owner id. No `signed` flag — that is an accountability-form concept.

Kinds live in `src/lib/documents.ts` beside `DOCUMENT_KINDS`:
`SUPPLIER_DOCUMENT_KINDS = ["registration", "certificate", "contract", "other"]`,
`REQUEST_DOCUMENT_KINDS = ["quotation", "purchase-order", "invoice", "delivery-receipt", "other"]`, each
with a label map.

### 2.4 `PurchaseRequest`

Adds `vendorId String?` → Vendor (Restrict) and `departmentId String?` → Department (Restrict), both
indexed. Nullable at the database because existing rows have neither; the create and save actions
require `departmentId` (decision 4). `Department` gains `requests PurchaseRequest[]`.

### 2.5 `Asset.importedAt DateTime?`

Set by the CSV importer on rows it CREATES (never on updates). Indexed. The migration backfills
`UPDATE "Asset" SET "importedAt" = now() WHERE "purchaseRequestId" IS NULL AND "importedAt" IS NULL` so
every pre-existing asset without a request reads as a historical import (decision 5). No trigger and no
check constraint: provenance is computed, never stored.

### 2.6 Seed

`prisma/seed.ts`: the two seeded vendors gain a profile (category, contact, phone, email; "TechServe PH"
`ACTIVE` contract ending in 14 months, "Octagon Repairs" `NONE`); three more suppliers are seeded so the
list, search and archived filter have something to show ("Metro Office Supply" `EXPIRED`, "Quezon
Furniture Works" `ACTIVE`, "Old Line Trading" archived). Every seeded purchase request names a
department (rotate through IT, HR, Finance) and the two COMPLETED ones name "TechServe PH". Seeded assets
with `purchasedAt` more than two years before seed time are stamped `importedAt` so the provenance filter
has all three values. No bank accounts are seeded (a number in the seed is a number in git).

---

## 3. Access rules — `src/lib/supplier-access.ts` (pure)

| Function | True for |
|---|---|
| `canManageSuppliers(role)` | `admin`, `purchasing_staff` — create, edit, archive, restore, bank accounts, documents, import |
| `canRevealBank(role)` | `admin`, `purchasing_staff`, `finance_staff` |
| `canAttachToRequest(role)` | `admin`, `purchasing_staff`, `it_staff`, `finance_staff` |
| `canSetRequestSupplier(role)` | `admin`, `purchasing_staff` (same set as `canManageSuppliers`, named separately because it gates a request, not a supplier) |

Reading a supplier profile (without bank numbers) needs only a signed-in user. Downloading a supplier
document or a request attachment needs only a signed-in user (the routes are unguessable ids and the
content is not credentials). Bank numbers never render server-side; `revealBankAccount` is the only path
and it writes an audit entry per call.

Route gating (`src/lib/workspaces.ts` `PATH_RULES`, first-match-wins, placed BEFORE the general
`/purchases` rule): `^/purchases/suppliers/(new|import)(/|$)` and `^/purchases/suppliers/[^/]+/edit(/|$)` →
workspaces `purchasing`, `admin`; roles `admin`, `purchasing_staff`. Every page also carries its own
`requireRole`/`requireUser` backstop, the way `/inventory/import` does. `workspaces.test.ts` asserts the
ordering.

Navigation: the Purchasing workspace gains a section **Suppliers** — "All suppliers" `/purchases/suppliers`,
"New supplier" `/purchases/suppliers/new`, "Import suppliers" `/purchases/suppliers/import` (the last two
`roles: ["admin", "purchasing_staff"]`). The Finance workspace gains one read link "Suppliers" in its
purchases section. IT's nav is unchanged (suppliers are reachable from any request and the palette).

---

## 4. The Suppliers area

### 4.1 List — `/purchases/suppliers`

`listSuppliers(state: ListState)` → `{ rows, total, page, pageCount, facets }`. Search `q` is a
case-insensitive `contains` across `name`, `registeredName`, `contactPerson`, `email`. Filters (all from
the URL, `ListState.filters`): `category[]`, `contract[]` (`VendorContractStatus`), `archived` (`"1"` shows
archived only; default hides them). Order `name asc, id asc`; `pageOf(total, page, ENTITY_PAGE_SIZE)`.
Columns: Name (link; registered name beneath), Category, Contact (person · phone · email), Contract
(status pill; end date beneath when set), Requests (count), Assets (count). Empty state: "No suppliers
yet — add one or import a list" with both links for managers, plain text for others. Facet counts:
category and contract status by `groupBy` over the SAME where minus the facet's own key (the inventory
list's pattern).

### 4.2 Profile — `/purchases/suppliers/[id]`

`getSupplier(id, page)`. Header: name, registered name, category pill, contract status pill, Archived
pill when archived; actions for managers: Edit, Archive/Restore. Cards:

- **Profile** — contact person, phone, email, address, registration no., notes.
- **Contract** — status, start, end, terms. An `ACTIVE` contract whose `contractEnd` is in the past shows
  a fault-tone hint "past its end date — update the status"; the status is never changed automatically
  (stored state is the operator's, derived hints are ours).
- **Bank accounts** — one row per account: label, bank name, account name, `•••• 1234`. For
  `canRevealBank` roles a **Reveal** button per row calls `revealBankAccount` and shows the full number
  inline until the page is left; an audit entry `supplier.bank.revealed` is written per reveal. Managers
  see **Add account** (label, bank name, account name, account number) and a per-row **Remove** (confirm
  dialog). Roles without `canRevealBank` see the card with masked rows and no Reveal.
- **Documents** — kind + file upload (managers), table of kind, file, uploaded by, date, Download link
  (`/purchases/suppliers/[id]/documents/[docId]/download`, `contentDisposition` RFC 5987, traversal guard
  — a copy of the asset download route with the vendor lookup).
- **Purchase requests** — the requests naming this supplier, newest `updatedAt` first, `LOG_PAGE_SIZE`,
  columns ref (link), state pill, department, requester, updated; a "See all in requests" link to
  `/purchases?supplier=<id>`.
- **Registered assets** — assets with `vendorId = id`, `tag asc, id asc`, `ENTITY_PAGE_SIZE`, columns tag
  (link), model, status pill, purchased, provenance pill. (No inventory facet by vendor — decision in §1.)

### 4.3 New and edit — `/purchases/suppliers/new`, `/purchases/suppliers/[id]/edit`

One client component `supplier-form.tsx`; one zod schema `supplierSchema` in `src/lib/supplier-schema.ts`
shared by the form (field errors) and the actions (`createSupplier`, `updateSupplier`): `name` required
(trim, 1–120), `registeredName`, `category`, `contactPerson` ≤120, `phone` ≤40, `email` optional but
must be an email when present, `address` ≤400, `registrationNo` ≤60, `contractStatus` enum, `contractStart`
and `contractEnd` `dateStr` with `contractEnd >= contractStart` when both present ("End date is before the
start"), `contractTerms` and `notes` ≤2000. The category input autocompletes from
`supplierCategories()` (distinct non-null values, ≤50). A duplicate name (Prisma P2002 on `name`) is the
field error "A supplier with this name already exists". Success: redirect to the profile with a
"Supplier created" / "Saved" toast. Audit: `supplier.created`, `supplier.updated` (diff of changed
fields), `supplier.archived`, `supplier.restored`, entityType `vendor`.

`archiveSupplier` / `restoreSupplier` from the profile header. Archiving never touches requests or
assets that reference the supplier; the supplier keeps appearing on them.

### 4.4 Import — `/purchases/suppliers/import`

Reuses `ImportWizard` with `planSupplierImport(form)` / `applySupplierImport(...)` in
`src/server/modules/import/supplier-actions.ts`, mirroring `employee-actions.ts`. Pure row logic in
`src/lib/import-suppliers.ts`, handed to the existing generic `matchHeaders` (`import-assets.ts`).

Headers (`SUPPLIER_IMPORT_HEADERS`): `name` (required; labels "name", "supplier", "supplier name",
"vendor", "company"), `registeredName` ("registered name", "legal name"), `category`, `contactPerson`
("contact", "contact person"), `phone` ("phone", "telephone", "mobile"), `email`, `address`,
`registrationNo` ("registration no", "registration number", "reg no", "tin"), `contractStatus`
("contract status", "contract"), `contractStart` ("contract start", "start date"), `contractEnd`
("contract end", "end date", "expiry"), `notes`. **No bank columns** — the planner rejects a sheet that
carries a header matching "bank", "account no", "account number" or "iban" with one file-level cause: "Bank
details are entered on the supplier's page, never imported."

Row rules: match an existing supplier by `refKey(name)` (case-insensitive, like `byEmployeeNo`); matched →
UPDATE (absent column = untouched; present empty cell = clear, the employee importer's semantics); unmatched
→ CREATE. Blocked-row causes: duplicate name within the sheet (both rows blocked, the asset importer's
rule); `contractStatus` not one of the four values (case-insensitive match on the enum names, "none"
accepted); an unparseable date; `contractEnd` before `contractStart` within the row; an email that is not
an email. Archived suppliers match and update like any other (the sheet does not un-archive). Row cap:
the same `IMPORT_ROW_CAP` the other importers use. Apply runs in chunks inside transactions exactly as
`applyEmployeeImport` does, one audit entry per created or updated supplier (`import-create` /
`import-update` on entityType `vendor` — the app's existing importer action names, plan P-1).

### 4.5 Command palette

`paletteSearch` gains a `suppliers` group (`name` label, `category ?? contactPerson` sub,
`/purchases/suppliers/<id>`), `contains` insensitive on `name` and `registeredName`, archived excluded,
take 5, no role gate. The palette renders the new group with the heading "Suppliers".

### 4.6 Audit log resolution

The audit page's entity resolver learns entityType `vendor`: label = supplier name, link
`/purchases/suppliers/<id>`; a supplier that no longer resolves (cannot happen without a delete, but the
resolver must not throw) falls back to the raw id like other types do.

---

## 5. Purchase requests

### 5.1 Department (decision 4)

- `createDraft` / `saveDraft` schemas gain `departmentId: z.string().min(1, "Pick the requesting
  department")`; the draft form shows a **Requesting department** select (departments by name) as its
  first field. `getPurchase` returns `department: { id, name } | null`.
- Detail header: a pill "For <Department>" or a faint "No department" for pre-phase rows. The
  department is editable only while the request is a DRAFT (through the existing draft form); after
  submit it is part of the record.
- List: a **Department** column; a `department=<id>|none` filter (select above the table, beside the state
  tabs) applied inside `purchaseWhere`, which moves to a pure `src/lib/purchases-list.ts` so it can be
  unit-tested. `stateCounts` stays unfiltered (tabs count the whole queue, as today).
- Activity page (`/purchases/activity`): unchanged.

### 5.2 Supplier (decision 2)

- `setRequestSupplier({ id, vendorId })`, `vendorId` nullable to clear; `canSetRequestSupplier`; refuses
  an archived supplier ("That supplier is archived — restore it first") and an unknown id; any request
  state including COMPLETED and CANCELLED (metadata, never a gate — the same rule `registerAssets` applies
  to `requestId`). Audit `supplier-set` on `purchase-request` with `diff: { supplier: { from, to } }` by
  name.
- Detail: a **Supplier** card — the current supplier as a link to its profile (or "Not set"), and for
  `canSetRequestSupplier` roles a select of active suppliers (plus the current one even if archived, so
  the control never shows a blank for a real value) with Save. Client component
  `supplier-picker.tsx`.
- List: a **Supplier** column and a `supplier=<id>` filter (used by the profile page's "See all" link).

### 5.3 Attachments (decision 6)

- `uploadRequestDocument(formData: { requestId, kind, file })` → `validateUpload`,
  `storeUpload("requests/<id>", file)`, row in `RequestDocument`, audit `document.uploaded` on
  `purchase-request`. Gate `canAttachToRequest`. Download route
  `/purchases/[id]/documents/[docId]/download` (copy of the asset route; `requireUser`; the doc must belong
  to the request in the URL).
- Detail: an **Attachments** card — upload form (kind select from `REQUEST_DOCUMENT_KINDS` + file) for
  `canAttachToRequest` roles, and a table kind · file · uploaded by · date · Download. Present in every
  state; a CANCELLED request keeps and shows its files.
- The NoteThread is untouched; an upload is an audit event, not a thread note.

### 5.4 Register page prefill

`/inventory/register`'s request options carry `vendorId`; choosing a request whose supplier is set fills
the Vendor select when it is still empty (never overwrites a vendor the operator already picked). No
server change beyond the option payload.

---

## 6. Asset provenance (decision 5)

`src/lib/provenance.ts`:

```ts
export type Provenance = "PURCHASE_REQUEST" | "DIRECT" | "HISTORICAL";
export const PROVENANCES: readonly Provenance[];
export const PROVENANCE_LABEL: Record<Provenance, string>; // "From a purchase request" | "Registered directly" | "Historical import"
export function provenanceOf(a: { purchaseRequestId: string | null; importedAt: Date | null }): Provenance;
export function provenanceWhere(p: Provenance): Prisma.AssetWhereInput;
// PURCHASE_REQUEST → { purchaseRequestId: { not: null } }
// DIRECT           → { purchaseRequestId: null, importedAt: null }
// HISTORICAL       → { purchaseRequestId: null, importedAt: { not: null } }
export function parseProvenance(raw: string | null | undefined): Provenance | null;
```

- **Filter:** `buildAssetWhere` reads `state.filters.provenance` (array of `Provenance`) and ANDs an `OR`
  of `provenanceWhere` for each (appended to `where.AND`, the stage facet's discipline). The inventory
  facet rail gains a **Provenance** group with the three fixed options; its counts are three `count`
  calls over the same where minus this key (a derived facet cannot `groupBy`). The `gaps`-style facet
  count machinery is not touched.
- **Badge:** the asset detail header shows one pill: "From PR-0188" (link to the request), "Registered
  directly", or "Historical import · no purchase request".
- **Export:** `export-columns.ts` gains `provenance` (label text) after `purchaseRequest`.
- **Importer:** the apply step (`asset-actions.ts`) writes `importedAt: now` on every row it CREATES; UPDATE
  rows never touch it. The pure planner is unchanged, so the proof is e2e (`purchasing-ext.spec.ts` case
  6), not a planner unit test (plan P-5).
- **Register / receive paths:** untouched — they leave `importedAt` null and set or omit
  `purchaseRequestId`, which is exactly what the derivation needs.
- **Finance view** (`/finance/assets`): a Provenance column, no filter.

---

## 7. Error handling

- Every action returns the existing `ActionResult` union (`forbidden`, `validationError` with field keys
  the form renders, `conflict`, `rateLimited`); every action checks `checkRate` after the role guard, the
  house pattern.
- Duplicate supplier name → field error on `name` (both create/update, from P2002). Archived supplier on
  a request → `conflict`. Unknown department on a draft → `validationError({ departmentId: "Unknown
  department" })`.
- Uploads: `validateUpload` decides type and size (10 MB; PDF, PNG, JPG); the row is written only after
  the file is stored; a store failure surfaces as `conflict("Could not store the file")` with nothing
  written.
- `revealBankAccount`: decrypt failure → `conflict("Could not decrypt this account — the encryption key may
  have changed")`, mirroring the asset-secrets copy; no audit entry on failure, one on success.
- Import: planning never writes; a file-level cause (bank columns, missing `name` header, over the row
  cap) stops the wizard before the preview; row causes block only their rows; apply is chunked in
  transactions and reports created/updated/blocked counts like the employee importer.
- Download routes answer 404 for a missing row, a row on the wrong owner, a traversal attempt, or a file
  missing from the volume — the same four cases as the asset route, same copy.

---

## 8. Testing

### 8.1 Unit (vitest)

- `supplier-access.test.ts` — the four predicates across all five roles.
- `supplier-schema.test.ts` — required name; optional email must be an email; end before start refused;
  status enum; length caps; blank strings become null.
- `import-suppliers.test.ts` — header aliases resolve; bank header rejected at file level; create vs update
  by case-insensitive name; duplicate-in-sheet blocks both rows; bad status, bad date, end-before-start,
  bad email block the row; absent column leaves the field untouched, present-empty clears it.
- `provenance.test.ts` — `provenanceOf` three ways; `provenanceWhere` shapes; `parseProvenance`.
- `inventory-list.test.ts` — `buildAssetWhere` with one and two provenance values (OR inside AND, nothing
  else displaced).
- `purchases-list.test.ts` — `purchaseWhere` with state, q, department (id and `none`), supplier.
- `workspaces.test.ts` — the two new PATH_RULES precede the general purchases rule; roles resolve as §3.
- `documents.test.ts` (new or extended) — the two kind lists and their labels are total.

### 8.2 E2E (Playwright, foreground, `E2E_PORT=3100 --workers=1`)

Two new files; no existing e2e file changes (D-10's lesson: the file that must prove a thing owns it).

**`e2e/suppliers.spec.ts`** (reseeds first; login helper copied per house rule):
1. Purchasing creates a supplier (all profile fields, `ACTIVE` contract) → profile shows them; list finds
   it by name and by contact; category facet chip counts it.
2. Edit changes the category and sets `contractEnd` before `contractStart` → field error; corrected → saved.
3. Add a bank account → row shows `•••• 1234`; Reveal shows the full number; the audit log carries
   `supplier.bank.revealed` for that supplier; Remove asks, then removes.
4. IT opens the same profile → bank rows are masked with no Reveal button; viewer sees no Edit, Add or
   Upload controls.
5. Upload a "registration" PDF → table row; the download route answers 200 with `content-disposition`
   naming the file and `application/pdf`.
6. Archive → the supplier leaves the default list and the request supplier picker, appears under
   Archived; Restore brings it back.
7. Import: a fixture CSV with one new supplier, one existing (name in different case, new phone), one
   duplicate pair and one bad status → preview shows 1 create, 1 update, 3 blocked with causes; commit →
   counts match; the existing supplier's untouched columns are unchanged.
8. A CSV with a "Bank account" column is refused at the file level with the spec's sentence.
9. Palette: typing a supplier's name lists it under Suppliers and opens the profile.
10. Duplicate name on create → field error, nothing created.
11. axe (serious/critical = none) on list, profile, new, import.

**`e2e/purchasing-ext.spec.ts`**:
1. New request without a department → field error; with one → detail header "For HR", list Department
   column.
2. Department filter narrows the list; `none` shows the pre-phase seeded rows without one (the seed keeps
   one such row for this).
3. Set a supplier on a SUBMITTED request → Supplier card links to the profile; list Supplier column; audit
   `supplier-set`; the supplier's profile lists the request under Purchase requests.
4. An archived supplier is not offered by the picker; the current supplier stays selected even if
   archived.
5. Attachments: Purchasing uploads a quotation, Finance an invoice (as `finance@`), viewer sees the two
   rows and Download but no upload form; download answers 200 with the right headers; a CANCELLED request
   still shows its files.
6. Provenance: an imported asset (via the CSV import page) carries "Historical import" and appears under
   the Historical facet; a directly registered one "Registered directly"; one registered against a
   COMPLETED request "From PR-####" linking to it; the export CSV has the `provenance` column with the
   three labels.
7. Register page: choosing a request whose supplier is set fills the Vendor select; a vendor already
   chosen is not overwritten.
8. axe on a request detail with attachments and supplier cards, and on the inventory list with the
   provenance facet open.

### 8.3 Battery at the close

`tsc`, `lint`, full vitest, all e2e in foreground chunks (add the two new files to the chunk list in
HANDOVER §0 item 9), `--list` total recorded, 19 migrations on `inventory_dev`.

---

## 9. Files

**Create:** `prisma/migrations/20260908120000_purchasing_suppliers/migration.sql`;
`src/lib/{supplier-access,supplier-schema,import-suppliers,provenance,purchases-list}.ts` (+ tests);
`src/server/modules/suppliers/{queries,actions,bank-actions,document-actions}.ts`;
`src/server/modules/import/supplier-actions.ts`;
`src/server/modules/purchases/{supplier-actions,document-actions}.ts`;
`src/components/suppliers/{supplier-form,suppliers-table,bank-accounts-card,supplier-documents-card,archive-controls}.tsx`;
`src/components/purchases/{supplier-picker,request-documents-card,department-select}.tsx`;
`src/app/(app)/purchases/suppliers/{page,new/page,import/page,[id]/page,[id]/edit/page}.tsx`,
`src/app/(app)/purchases/suppliers/[id]/documents/[docId]/download/route.ts`,
`src/app/(app)/purchases/[id]/documents/[docId]/download/route.ts`;
`e2e/suppliers.spec.ts`, `e2e/purchasing-ext.spec.ts`, `e2e/fixtures/suppliers*.csv`.

**Modify:** `prisma/schema.prisma`, `prisma/seed.ts`; `src/lib/{documents,workspaces,inventory-list,export-columns,import-assets}.ts`;
`src/server/palette.ts`; `src/server/modules/purchases/{draft-actions,queries}.ts`;
`src/server/modules/import/asset-actions.ts` (the CREATE data object gains `importedAt`);
`src/components/purchases/{draft-form,purchases-table}.tsx`; `src/components/shell/command-palette.tsx`;
`src/app/(app)/purchases/{page,[id]/page,new/page,[id]/edit/page}.tsx`;
`src/app/(app)/inventory/{page,[id]/page,register/page,export/route}.tsx`;
`src/components/inventory/inventory-toolbar.tsx` (the facet rail); `src/app/(app)/finance/assets/page.tsx`; `src/server/modules/audit/queries.ts` (the entity
resolver, for `vendor`); `docs/HANDOVER.md`,
`docs/PICKUP.md`.

---

## 10. Global constraints (copied into the plan)

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env`: `DATABASE_URL` →
  `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`. Never touch the
  `inventory` database or port 3000. Never seed staging. Never commit `.env` or any credential.
- Playwright: foreground, `E2E_PORT=3100`, `--workers=1`, `--global-timeout`, no server left behind.
- Every paged query: `pageOf` with `ENTITY_PAGE_SIZE`/`LOG_PAGE_SIZE`, `orderBy` ending in `id`, no new
  page-size constant.
- `"use server"` modules export only async functions; zod at every action boundary; `ActionResult`
  union; role guard then `checkRate`; one audit entry per write with the action names in this spec.
- Secrets: `encryptSecret`/`decryptSecret` with a per-row AAD; never render a plaintext number in a
  server component; audit every reveal.
- Uploads: `validateUpload`, `storeUpload`, `contentDisposition`, traversal guard — never a second copy of
  those rules.
- Nothing is deleted except a supplier bank account (decision 9).
- Copy: sentences, not labels; a refusal says what to do instead; match the punctuation and tone of the
  surrounding file.
- Tests first for every pure module; measured counts in commit messages.

---

## 11. Open items carried forward

- The cleaned-up supplier list from Purchasing (HANDOVER §9 B) — the import page exists for it; the list
  itself is theirs to produce.
- Item D (consumables and stock control) — next phase, own brainstorm; it will consume the supplier table
  for receipts.
- Department-based routing — only if the stakeholders ask for it after using the tag for a while.
