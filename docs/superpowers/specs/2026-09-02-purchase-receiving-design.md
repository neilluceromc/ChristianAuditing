# Phase 12 — Purchase → asset receiving

**Date:** 2026-09-02 · **Status:** approved, not yet planned · **Base:** `main` (`59977e2`, Phases 1–10
merged and pushed) · **Branch to cut:** `phase-12-receiving`

One item, and it closes the last outstanding commitment in the original brief rather than adding
something new. `design_handover/README.md` card `1m` says labels print "straight from a bulk selection
**or a completed purchase**". The second half has never been possible: nothing in this application
creates an `Asset` from a `PurchaseRequest`, so a completed purchase has nothing with a tag to put on a
sticker, and the purchasing workflow dead-ends at `COMPLETED`.

**Independent of Phase 11.** That branch (the label QR) is unmerged, and this does not touch it. Cut
from `main`. The label sheet already accepts `?ids=`, so newly received assets are printable with no
change to it.

---

## 0. What the code actually looks like today, verified

Recorded because two of these contradict `docs/HANDOVER.md` §8, which describes this gap.

1. **The request-level link ALREADY EXISTS and is completely unused.** `Asset.purchaseRequestId` and
   `PurchaseRequest.assets` have been in the schema since Phase 1. Nothing writes them, nothing reads
   them, and `purchaseRequest` appears in no `.tsx` file. The handover says "no relation to `Asset`" —
   true of `PurchaseUnit`, **false of `PurchaseRequest`**. So no migration is needed for that half.
2. **`completeRequest` does not create anything.** It flips state to `COMPLETED`, appends a
   `NoteEntry`, writes one audit row, and emits the `purchase_request.completed` webhook. That is all.
3. **No tag generator exists anywhere.** Every tag in the system was typed by a human
   (`createAsset` takes `d.tag`) or read from a spreadsheet (the importer). Sequences exist for
   `purchase_request_ref_seq` and `approval_ref_seq`; there is none for asset tags.
4. **`COMPLETED` and `CANCELLED` are terminal** (`src/lib/purchase-flow.ts`), and comments are
   deliberately still allowed on a terminal request. Receiving must therefore be a **separate
   operation on a terminal request**, not a new state transition.
5. **Units carry their own state**: `PENDING | APPROVED | REJECTED | CANCELLED`.

---

## 1. Decisions taken during brainstorming

1. **Receiving is a deliberate screen, not an automatic side effect of `complete`.** A unit is free
   text (`description`, `specs`) and `Asset.categoryId` is **required**, so any automatic path must
   guess a category from prose. A wrong guess puts unchecked rows into the asset register, which then
   need editing — and an asset register whose rows nobody confirmed is the thing this application
   exists to prevent. **Rejected:** deriving category/type from the description. **Rejected:** a
   pre-filled link to `/inventory/new` per asset — `qty: 8` means doing it eight times.

2. **Tag numbers are the next free number for that prefix**, computed as the maximum existing number
   for the prefix plus one, and **editable** before submit. Chosen by the user over a global Postgres
   sequence and over hand-typing every tag.

3. **The tag PREFIX is LEARNED from existing data, not configured and not derived.** Measured on the
   live seed:

   | prefix | category | type |
   | --- | --- | --- |
   | `LT` | Laptop | Dell Latitude |
   | `MN` | Monitor | 24-inch |
   | `HS` | Headset | Wired |
   | `PH` | Phone | iPhone |
   | `DK` | Dock | USB-C Dock |
   | `KB` | **Peripheral** | **Keyboard** |

   The prefix tracks the **category** in five of six cases and the **type** in the sixth, because
   "Peripheral" is a generic bucket. And categories hold several types (Headset → Wired *and*
   Wireless), so a purely type-derived prefix would split one physical kind across two prefixes.
   **There is no rule to implement — it is a human convention.** So the screen defaults the prefix to
   the one already most used by assets in the chosen category, falling back to the chosen type when
   the category yields nothing, and leaves it editable.
   **Rejected:** adding `tagPrefix` columns to `AssetCategory` and `AssetType` plus admin UI to
   maintain them — a migration and a screen in service of a two-character string, when the answer is
   already sitting in the data. Learning it also gets `Peripheral + Keyboard → KB` right for free.

4. **One migration: `Asset.purchaseUnitId`.** Nullable, `onDelete: Restrict` to match every other
   `Asset` relation. It exists so that **"has this unit been received?" is DERIVED** — count the assets
   pointing at the unit — rather than stored in a `receivedAt` flag that can drift from reality. That
   is this project's own recorded principle (§6a: *derived state beats stored state*), and it is what
   makes receiving idempotent and partial deliveries expressible: 5 of 8 received leaves 3 outstanding
   with no extra bookkeeping.

5. **No approval.** Every other lifecycle change goes through the approval queue; this deliberately
   does not. The purchase already passed IT review and Finance sign-off, receiving **creates** rows
   rather than mutating existing ones, and there is nothing left for an approver to weigh. Stated as a
   decision so a later reader does not read it as an oversight.

6. **Only `APPROVED` units are receivable.** A `REJECTED` or `CANCELLED` unit was not bought, and a
   `PENDING` one on a `COMPLETED` request is a data inconsistency rather than something to receive.

7. **Received assets land as `SPARE`**, matching `createAsset`'s default. Receiving records that the
   hardware arrived, not that anyone has it.

---

## 2. What gets built

### `prisma/migrations/<ts>_asset_purchase_unit/migration.sql` — new

Hand-written additive SQL, matching every migration in this repo:

```sql
ALTER TABLE "Asset" ADD COLUMN "purchaseUnitId" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_purchaseUnitId_fkey"
  FOREIGN KEY ("purchaseUnitId") REFERENCES "PurchaseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Asset_purchaseUnitId_idx" ON "Asset"("purchaseUnitId");
```

The index is the point of the column: every receiving read counts assets grouped by unit.

### `src/lib/receiving.ts` — pure, new

The rules, with no I/O, so they are unit-testable without a database:

```
export interface UnitReceipt { unitId: string; ordered: number; received: number }
export function outstanding(r: UnitReceipt): number
export function isFullyReceived(r: UnitReceipt): boolean
export function nextTags(prefix: string, highest: number | null, count: number): string[]
export function preferredPrefix(counts: Array<{ prefix: string; n: number }>): string | null
```

`nextTags` pads to four digits and **refuses** rather than wrapping when a run would exceed `9999` —
`BR-LT-10000` does not match `TAG_SHAPE` (`/^BR-[A-Z]{2}-\d{4}$/`) and would be rejected downstream, so
it must fail where the number is minted, not where it is validated.

### `src/server/modules/purchases/receiving.ts` — new

`receivableUnits(requestId)` reads units plus their received counts. `receiveUnits(input)` creates the
assets in **one transaction**: validate every tag against `TAG_SHAPE`, create each asset with
`purchaseRequestId` **and** `purchaseUnitId` set, write **one audit row per asset**, append a single
`NoteEntry` to the request recording who received what, and refuse if any unit would exceed its
ordered quantity.

**Concurrency is handled by the unique index, not by a lock.** `Asset.tag` is `@unique`, so two
simultaneous receipts collide on `P2002` and the loser gets a typed conflict telling them to reload —
loudly, never a silent duplicate. That is exactly how this app already handles `Approval` and
`Reservation` collisions.

### `src/app/(app)/purchases/[id]/receive/page.tsx` — new

Gated `admin`/`it_staff`. Reachable only from a `COMPLETED` request with at least one outstanding
`APPROVED` unit; anything else renders a plain explanation rather than a form. Per unit: category
select, type select, quantity (defaulting to outstanding), prefix (two chars, defaulted as decided),
the generated tags shown and editable, and optional serials.

### `src/app/(app)/purchases/[id]/page.tsx` — modified

A **Receive items** action on a `COMPLETED` request, plus a per-unit received indicator
(`5 of 8 received`) derived from the asset counts. This is the only change to an existing screen.

---

## 3. What is NOT built

- **No new purchase state.** `COMPLETED` stays terminal; receiving is an operation on it.
- **No approval flow**, per decision 5.
- **No automatic category inference** from unit descriptions, per decision 1.
- **No `tagPrefix` schema or admin UI**, per decision 3.
- **No change to the label sheet.** It already takes `?ids=`.
- **No backfill.** Existing assets keep `purchaseUnitId = NULL`; nothing claims they came from a
  purchase, because nothing knows whether they did.

---

## 4. Testing

**Unit — `receiving.ts`:** `outstanding` and `isFullyReceived` across zero/partial/full/over-received;
`nextTags` for a normal run, from a null highest (first asset of a new prefix), across a 9999 boundary
(must refuse), and for `count: 0`; `preferredPrefix` with a clear winner, a tie, and an empty list.
**Mutation-test these once green** — reverse a comparator and weaken the 9999 bound and confirm the
suite fails, per §6a.

**E2E — a new `e2e/receiving.spec.ts`, driven by `PR-0188` (the seed's one receivable request, qty 2):**
receive a partial quantity and assert the unit reads `1 of 2 received` and the created assets exist with the right tags, category, type, `SPARE` status and
**both** foreign keys set; receive the remainder and assert the unit reads fully received and the
Receive action is gone; assert a duplicate tag is refused with a conflict and **writes nothing** (a
Prisma count delta, not the absence of a toast); assert `viewer` and `finance_staff` cannot reach the
route; assert an audit row exists per created asset.

**The count delta matters more than the message.** This is the first code path in the application that
creates assets outside `createAsset` and the importer, so "did it write exactly what it said" is the
assertion that earns its keep.

---

## 5. Risks, named

1. **The seed's receivable fixture is `PR-0188`, and it is the ONLY one — checked, not assumed.**
   `COMPLETED`, one unit, "Dell Latitude 5420", `qty: 2`, unit state `APPROVED`. Every other seeded
   request is either non-terminal or has non-`APPROVED` units, so exactly one row in the seed is
   receivable. That is enough and it is well chosen: `qty: 2` exercises a partial receipt (1, then the
   remainder) without needing a fixture built by hand, and being a laptop it lands on prefix `LT`,
   whose current highest is `0210` — so the first generated tags are `BR-LT-0211` and `BR-LT-0212`.
   **The fragility to name:** the e2e must reference `PR-0188` by `refNo`, never by cuid, and must not
   assume 0210 stays the highest — read the maximum, do not hardcode 0211.
2. **Tag collision under concurrency** is real but loud, and the unique index is the guard. The risk is
   writing a test that *asserts* the collision and passes for the wrong reason; assert the count delta.
3. **The 9999 boundary is reachable per prefix**, not theoretical, since numbers are per-prefix and
   `LT` is already at 0210 in a fixture set of 25 assets.
4. **`onDelete: Restrict` turns out to be unreachable, and that was worth proving rather than assuming.**
   Exactly one code path deletes a unit: `draft-actions.ts:166` drops units removed while editing a
   draft. It is guarded at line 152 by `req.state !== "DRAFT"` → conflict. A unit can only carry assets
   if its request reached `COMPLETED` (receiving refuses anything else), and `COMPLETED` is terminal — so a
   unit with assets can never re-enter the one path that deletes units. **`Restrict` is therefore the
   right constraint AND costs nothing today**; it is insurance against a future editable-after-complete
   feature, not a live constraint on the current one.

---

## 6. Task order

1. The migration + `prisma generate`, and confirm `migrate deploy` applies cleanly.
2. `src/lib/receiving.ts` + its unit tests (TDD, pure, no dependencies).
3. `receiving.ts` server module + the transaction, audit rows and note.
4. The receive screen.
5. The `COMPLETED` request's Receive action and per-unit received indicator.
6. `e2e/receiving.spec.ts`, including building a receivable fixture if the seed has none.
7. Battery, plan amendments, handover.
