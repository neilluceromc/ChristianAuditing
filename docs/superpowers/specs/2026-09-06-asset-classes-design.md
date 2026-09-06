# Phase 13 — Asset Classes: IT and Purchasing — Design

**Status:** approved by the user on 2026-09-06, in two parts, after five design questions. This is
the record of what was decided and why. The implementation plan is written from it.

**Goal:** let the Purchasing department register and manage non-IT assets — cars, furniture, buildings,
pantry equipment — in the same register as IT's equipment, with **their own status vocabulary**, without
inheriting IT's workflows (secrets, leaver kits, the IT home page), and give Finance the **IT** and
**Purchasing** tabs it asked for.

**Source requirement:** `docs/HANDOVER.md` §9 item **A**, from the 2026-09-02 Admin meeting, plus the
user's direct instruction: *"different tabs, IT and Purchasing Department (IT will register the assets
then finance will confirm if the details are correct, this goes with purchasing)."*

---

## 0. Naming — read this first

In this codebase **"admin" means system administration**: the `admin` role and the `/admin/*` routes.
The business's **"Admin department" is the Purchasing department** — the user confirmed this during
design (*"remember admin = purchasing"*) — and in the codebase that is the **`purchasing` workspace and
the `purchasing_staff` role**. The handover settled on 2026-08-17 that "the procurement department is
just Purchasing".

Consequences, all deliberate:

- The class is named **`PURCHASING`**, not `OFFICE` and not `ADMIN`.
- The Finance tab is labelled **"Purchasing"**.
- §9 of the handover currently says "Admin" for the department. **This phase corrects it** so nobody
  builds a third meaning.

---

## 1. Decisions taken during design, with the alternatives rejected

The user was asked five questions. Their answers shape everything below; the rejected options are
recorded so nobody re-litigates them without knowing they were considered.

| # | Question | Decision | Rejected |
|---|---|---|---|
| 1 | §9 says "Finance records some assets differently from Admin" — what does that mean? | **"Admin" is Purchasing.** The two-stage register-then-confirm flow Phase 12 built *is* the difference. **No separate Finance grouping, threshold or accounting class is modelled.** | A capitalization threshold; accounting-class grouping; cost-centre attribution |
| 2 | Should non-IT assets share IT's eight statuses? | **No — their own words.** | Same eight for everything (recommended, rejected); a restricted subset of the eight |
| 3 | How far does the separation go? | **One register, two classes.** Same `Asset` table, same tag system; class-gated statuses and permissions. | Two registers with nothing shared — roughly a second inventory module |
| 4 | Which words? | **`OPERATIONAL · STORED · REPAIRING · RETIRED · SOLD · LOST`** | `IN_SERVICE / IN_STORAGE / …` (needs a display layer for underscores); a four-state minimum |
| 5 | (Presented in the design, approved) Custody for buildings and furniture? | **Holder stays optional; no location model.** | Adding a Location/Room model |

Two defaults were presented for pushback and accepted without change:

- **Approvals for Purchasing assets are still approved by `admin` / `it_staff`** in this phase. §7.
- **Only `admin` / `it_staff` create categories**; the seed provides four Purchasing categories. §5.

---

## 2. The class dimension

### 2.1 `AssetClass`

```prisma
enum AssetClass {
  IT
  PURCHASING
}
```

### 2.2 Class lives on the category

```prisma
model AssetCategory {
  // …existing fields…
  cls AssetClass @default(IT)
}
```

Every existing category — Laptop, Monitor, Phone, Dock, Headset, Peripheral, and the locked
"Uncategorised" — becomes `IT` through the default. **No backfill decision is needed.** New Purchasing
categories are created as `PURCHASING`.

### 2.3 An asset's class is derived from its category, never chosen per item

You cannot register a laptop as a Purchasing asset; the category decides. Two rules make that airtight:

1. **A category's class is immutable once any asset references it.** No action changes `cls`; the
   create form sets it once, **and a database trigger refuses an `UPDATE` of `cls` on any category that
   has assets** (§3.4), so a raw SQL edit cannot do it either. Before the first asset exists it may be
   corrected by deleting and recreating the category, which the existing reference-data tools allow.
2. **An asset may move only to a category of the same class.** `updateAsset` and the import wizard both
   refuse a cross-class category change with a named validation error.

### 2.4 `Asset.cls` is also stored on the row — and why that is not a violation

```prisma
model Asset {
  // …existing fields…
  cls AssetClass
}
```

This project's rule is *derived state beats stored state* (§6a). `Asset.cls` is stored anyway, for two
reasons that survive that rule:

- **There is no drift path.** With §2.3's two rules, `Asset.cls` can never disagree with
  `category.cls`. It is a cache with nothing to invalidate.
- **It buys enforcement.** Every status check reads it without a join — a join per check is exactly what
  makes people skip the check — and the database trigger in §3.4 can only enforce class ↔ status if the
  row carries the class.

The trigger also asserts `Asset.cls = category.cls` on every write, so the "no drift" claim is enforced
by Postgres, not trusted.

---

## 3. Two vocabularies, one enum

### 3.1 The six new statuses

`AssetStatus` gains six values via `ALTER TYPE "AssetStatus" ADD VALUE` — the same shape as when
`NoteKind` gained `RECEIVE` in Phase 12:

```
OPERATIONAL   in use
STORED        in storage
REPAIRING     being fixed
RETIRED       written off the books
SOLD          sold on
LOST          cannot be found
```

They are single words in all caps with no underscores, matching how the existing eight render.

### 3.2 The partition

```ts
// src/lib/asset-class.ts (new, pure, zero imports beyond Prisma types)
export const STATUSES_BY_CLASS = {
  IT:         ["DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING"],
  PURCHASING: ["OPERATIONAL", "STORED", "REPAIRING", "RETIRED", "SOLD", "LOST"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

export const DEFAULT_STATUS        = { IT: "SPARE",    PURCHASING: "STORED" }      as const;
export const DEFAULT_ASSIGN_STATUS = { IT: "DEPLOYED", PURCHASING: "OPERATIONAL" } as const;
```

Properties, each pinned by a unit test:

- The two sets are **disjoint**.
- Their union is **every** `AssetStatus` value — so adding a status without placing it in a class fails
  a test rather than silently rendering grey.
- Each class's default is a member of its own set.

`ASSET_STATUSES` (the flat list of all fourteen) remains, for the places that genuinely need "every valid
value": the import wizard's error text and the exhaustive checks.

### 3.3 Status families

`src/lib/status.ts` gains six entries so nothing falls to the neutral default:

```
OPERATIONAL: settled    STORED: neutral    REPAIRING: fault
RETIRED:     closed     SOLD:   closed     LOST:      fault
```

### 3.4 The database enforces class ↔ status

A `BEFORE INSERT OR UPDATE OF status, cls, "categoryId"` trigger on `"Asset"` raises when:

- `status` is not in the class's set, or
- `cls` does not equal the referenced category's `cls`.

```sql
CREATE OR REPLACE FUNCTION asset_class_invariants() RETURNS trigger AS $$
DECLARE cat_cls "AssetClass";
BEGIN
  SELECT "cls" INTO cat_cls FROM "AssetCategory" WHERE "id" = NEW."categoryId";
  IF cat_cls IS DISTINCT FROM NEW."cls" THEN
    RAISE EXCEPTION 'asset % carries class % but its category is %', NEW."tag", NEW."cls", cat_cls;
  END IF;
  IF NEW."cls" = 'IT' AND NEW."status"::text NOT IN
       ('DEPLOYED','SPARE','DEFECTIVE','DONATED','TEMPORARY','BUYOUT','DISPOSE','MISSING') THEN
    RAISE EXCEPTION 'IT asset % cannot hold status %', NEW."tag", NEW."status";
  ELSIF NEW."cls" = 'PURCHASING' AND NEW."status"::text NOT IN
       ('OPERATIONAL','STORED','REPAIRING','RETIRED','SOLD','LOST') THEN
    RAISE EXCEPTION 'Purchasing asset % cannot hold status %', NEW."tag", NEW."status";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER asset_class_invariants
  BEFORE INSERT OR UPDATE OF "status", "cls", "categoryId" ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION asset_class_invariants();
```

**Why a trigger, when `categoryId`/`typeId` consistency is app-only today (§8 gap):** this invariant
would otherwise be checked in about eight write paths — register, create, edit, import, three approval
executors, offboarding — and Phase 12's C-9 showed exactly how a missed case in a set like that stays
silent. The project already uses a trigger for the append-only note thread; this is not a new kind of
thing. The application still validates first and returns a named error; the trigger is the guarantee
that a wrong write is *impossible*, not merely tested.

A second, smaller trigger guards the other side of the invariant:

```sql
CREATE OR REPLACE FUNCTION category_class_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW."cls" IS DISTINCT FROM OLD."cls"
     AND EXISTS (SELECT 1 FROM "Asset" WHERE "categoryId" = OLD."id") THEN
    RAISE EXCEPTION 'category % has assets; its class cannot change', OLD."name";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER category_class_frozen
  BEFORE UPDATE OF "cls" ON "AssetCategory"
  FOR EACH ROW EXECUTE FUNCTION category_class_frozen();
```

Together the two triggers make §2.4's "no drift path" a property of the database rather than of the
application's discipline.

The status list appears twice — in `STATUSES_BY_CLASS` and in the trigger. **A unit test pins them to
each other** by reading the migration file, the same way `receiving.test.ts` pins `MAX_TAG_NUMBER` to
`TAG_SHAPE`.

### 3.5 Migrations

Two, in order, taking the count from 12 to 14:

1. **`asset_status_purchasing_values`** — the six `ADD VALUE` statements only. Postgres will not let a
   newly added enum value be *used* in the transaction that added it, and Prisma runs each migration in
   its own transaction.
2. **`asset_classes`** — the `AssetClass` enum; `AssetCategory.cls` with default `IT`; `Asset.cls` added
   nullable, backfilled from the category, then set `NOT NULL`; both trigger functions and triggers.

---

## 4. Custody

**A Purchasing asset's holder is optional, exactly as today.** A car is assigned to an employee — the
driver. Furniture, a building, a microwave have no holder; they are simply `OPERATIONAL` or `STORED`,
and that reads correctly.

**No location model in this phase.** §9 asks what *kind* of thing an asset is, not *where*. "Which room
is this desk in" is a fourth subsystem whose shape should be forced by a real question, not guessed.

The IT home page's alert for *"DEPLOYED with nobody holding it"* stays IT-only for the same reason: an
unassigned `OPERATIONAL` desk is correct, not an anomaly.

---

## 5. Permissions

**Each class is registered and edited by its own department. Everything else is shared.**

| action | IT-class asset | Purchasing-class asset |
|---|---|---|
| Register (`/inventory/register`) | `admin`, `it_staff` | `admin`, `purchasing_staff` |
| Create one manually (`/inventory/new`) | `admin`, `it_staff` | `admin`, `purchasing_staff` |
| Edit the record | `admin`, `it_staff` | `admin`, `purchasing_staff` |
| Request a status change (single or bulk) | `admin`, `it_staff` | `admin`, `purchasing_staff` |
| Confirm / send back (Phase 12) | `admin`, `finance_staff` | `admin`, `finance_staff` |
| Approve lifecycle changes | `admin`, `it_staff` | `admin`, `it_staff` — see §7 |
| Create categories and types | `admin`, `it_staff` | `admin`, `it_staff` |

Mechanics:

- **Registration and manual create** show a user only the categories their class allows, and the server
  refuses any other with a validation error that names the class (`"Vehicle is a Purchasing category;
  IT staff register IT assets"`). `admin` sees both.
- **`PATH_RULES`**: the narrow `/inventory/register` entry (currently `workspaces: ["it"]`, `roles:
  ["admin","it_staff"]`) widens to `workspaces: ["it","purchasing"]`, `roles: ["admin","it_staff",
  "purchasing_staff"]`. It stays **above** the general `/inventory` rule. The class check moves
  server-side. `/inventory/new` gets the same treatment.
- **Category creation stays `admin`/`it_staff`.** The seed provides four Purchasing categories with
  types. Letting `purchasing_staff` create their own would mean widening `/admin/asset-categories` and
  `/admin/asset-types` to the purchasing workspace for a nice-to-have; deferred, and easy to reverse.

---

## 6. What Purchasing assets are excluded from

| surface | rule | reason |
|---|---|---|
| **Secrets** `/inventory/[id]/secrets` | hidden tab; direct URL `notFound()` | a car has no credentials |
| **Equipment policies** type picker | IT-class types only | leaver kits are an IT concept |
| **Import wizard** `/inventory/import` | route stays IT-only; a row whose category is `PURCHASING` is refused with a new cause `wrong-class`; status must be in IT's set | Purchasing bulk import is deferred |
| **Home alerts** (`MISSING`, unassigned `DEPLOYED`) | unchanged, IT-only | IT's home. Purchasing has no Home (§8), so a `LOST` car has nowhere to appear yet — follow-up |

**Shared without change:** labels and the Code 128 barcode, the QR and scan card, documents, audit,
Finance confirm / send back, the `/inventory/activity` feed. A car gets a sticker if someone prints one.

---

## 7. Approvals

Purchasing assets use the **same** approval mechanism with **class-appropriate targets**:

| type | IT (unchanged) | PURCHASING |
|---|---|---|
| `lifecycle.assign` | → `DEPLOYED` or `TEMPORARY` | → `OPERATIONAL` |
| `lifecycle.return` | → `SPARE`, `DEFECTIVE`, `BUYOUT`, `MISSING` | → `STORED`, `REPAIRING`, `LOST` |
| `lifecycle.change-status` | any of the eight | any of the six |
| `lifecycle.replace` / `.transfer` | **no executor exists today** (`approval-execution.ts` falls to its guard) | unchanged — still none; when one arrives it takes the assign rules |

Validation happens **twice**: when the request is created (`requestStatusChange`,
`bulkRequestStatusChange`, the employee assign/return flows) and again in the executor
(`approval-execution.ts`) — which today validates against the full enum and must validate against the
*class's* set, so an approval can never execute a car into `DEPLOYED`. The executor needs the asset's
class; it already loads the asset inside its transaction.

`summarizeApproval` defaults an assign's status to `"DEPLOYED"` when the payload omits it; that default
becomes `DEFAULT_ASSIGN_STATUS[cls]`.

**The one asymmetry, on the record: approvers stay `admin` and `it_staff` in this phase.**
`purchasing_staff` cannot reach `/approvals` today (`PATH_RULES` admits `it` and `finance` workspaces
only). Admitting the workspace, scoping the queue by class, and deciding who in Purchasing may approve is
real work, not a toggle. **Purchasing-owned approvals is the first follow-up after this phase.** The
user accepted this default when it was presented for pushback.

---

## 8. Offboarding

The wizard already lists everything a leaver holds, so an assigned car appears. Its outcomes become
**class-keyed**:

| outcome | IT (unchanged) | PURCHASING |
|---|---|---|
| Returned | `SPARE` | `STORED` |
| Defective | `DEFECTIVE` | `REPAIRING` |
| Buyout | `BUYOUT` | **not offered** |
| Missing | `MISSING` | `LOST` |

`OUTCOME_STATUS` becomes `Record<AssetClass, Partial<Record<Outcome, AssetStatus>>>`, and
`outcomeOfStatus` searches both maps. The wizard's per-item control hides Buyout for a Purchasing item.

---

## 9. Surfaces

### 9.1 `/inventory` — a class switch

`?cls=IT|PURCHASING`, built exactly like the existing `?purchaseYear=` chips: a **nav destination**, not
a config facet. `parseCls(raw)` returns the class or `null`; `null` means `IT`, so **every existing URL
behaves identically**. The Purchasing workspace's "Inventory" nav link carries `?cls=PURCHASING`.

Everything downstream honours it: the status facet offers that class's vocabulary; facet counts, the
Export link, and the bulk drawer's "act on all matching" all carry `cls` (a `withClsQS` helper, mirroring
`withPurchaseYearQS`, because `cls` rides outside `serializeListState` for the same reason
`purchaseYear` does).

### 9.2 `/finance/assets` — the two tabs

**IT** and **Purchasing**, via the same `?cls=`. Status chips in that class's vocabulary; count and
cost total per tab. Default tab: IT. `financeAssets(status, page, cls)` and `parseAssetStatus` validate
the status against the class's set.

### 9.3 The asset record

- A class pill beside the status pill.
- The Secrets tab is absent for `PURCHASING` (`record-tabs.tsx`), and the page 404s.
- `RequestStatusChange` receives `cls` and offers that class's statuses minus the current one.

### 9.4 Bulk drawer

**Refuses a mixed-class selection for a status change** — *"Select assets of one class"* — because no
status is valid for both a laptop and a desk. Once the selection is single-class, the picker shows that
class's vocabulary. The server re-derives the classes of the resolved ids and refuses if more than one,
so the client check is a convenience, not the guard.

### 9.5 `/inventory/register` and `/inventory/new`

Category list filtered to the user's allowed classes; status set to `DEFAULT_STATUS[cls]` (today
`registerAssets` hard-codes `SPARE`); `cls` set from the category. Tag prefixes are learned per category
as before — a new "Vehicle" category needs its first prefix typed once and then remembers it.

### 9.6 `/admin/asset-categories`

A **Class** column, and a Class picker on the create form (default IT). No edit of class after create.

---

## 10. Seed

Four Purchasing categories with types, and seven assets so every branch has a fixture:

| category | types | tag prefix | assets |
|---|---|---|---|
| Vehicle | Sedan, Van | `VH` | 2 — one `OPERATIONAL` and assigned to an employee, one `STORED` |
| Furniture | Desk, Chair | `FN` | 3 — `OPERATIONAL`, `OPERATIONAL`, `STORED` |
| Pantry Equipment | Microwave, Air purifier | `PE` | 1 — `REPAIRING` |
| Building | Floor, Warehouse | `BL` | 1 — `OPERATIONAL` |

Existing seeded assets are untouched and become IT.

---

## 11. Testing

### 11.1 Unit (pure, `src/lib`)

- `asset-class.test.ts`: the partition is disjoint; its union is every enum value; each default is in
  its set; `parseCls`; `statusesFor`. **Pins the trigger's two literal lists to `STATUSES_BY_CLASS`** by
  reading the migration file.
- `approval-execution.test.ts`: class-aware targets, **mutation-tested** — each rule shown to fail when
  its class check is removed.
- `offboarding.test.ts`: the class-keyed outcome maps; Buyout absent for Purchasing; `outcomeOfStatus`
  finds both classes' statuses.
- `status.test.ts`: the six new family entries.
- `import-vocabulary.test.ts` / `import-assets.test.ts`: the `wrong-class` cause; an IT import refuses a
  Purchasing status word.
- `inventory-list.test.ts`: `buildAssetWhere` carries `cls`.

### 11.2 End-to-end — `e2e/asset-classes.spec.ts`, 13 cases

1. `purchasing_staff` registers a Vehicle → `cls: PURCHASING`, `status: STORED`, tag prefix `VH`.
2. `purchasing_staff` cannot register into an IT category — refused, **writes nothing** (count delta 0).
3. `it_staff` cannot register into a Purchasing category — refused, writes nothing.
4. The car appears under Finance's **Purchasing** tab and **not** under IT; the chips read `OPERATIONAL
   · STORED …`.
5. The Secrets tab is absent on the car, and `/inventory/<id>/secrets` returns 404.
6. The status picker on the car offers exactly the six.
7. An approval executes the car to `OPERATIONAL`; **requesting** `DEPLOYED` for it is refused at
   request time (the executor's refusal is unit-tested, §11.1).
8. A leaver holding a car sees Returned / Defective / Missing and **no Buyout**; Returned → `STORED`.
9. **The trigger rejects an invalid pair even through Prisma** — a direct `asset.update` to `DEPLOYED`
   on a Purchasing asset throws, and the row is unchanged.
10. `/inventory?cls=PURCHASING` lists only Purchasing assets; the IT view is unchanged from today.
11. A mixed-class bulk status change is refused, writes nothing.
12. `admin/asset-categories` shows the Class column and creates a `PURCHASING` category.
13. **The category trigger holds:** a direct Prisma `assetCategory.update` flipping `cls` on a category
    with assets throws, and the category is unchanged.

Write-nothing cases (2, 3, 11) get **mutation proofs** per the project standard. `/inventory?cls=
PURCHASING` and `/finance/assets?cls=PURCHASING` join the axe sweep's **hardcoded** route list — it
silently stops scanning anything not listed (B-13, C-9).

---

## 12. Out of scope, on the record

- Locations / rooms / sites.
- Purchasing self-service category and type creation.
- Purchasing bulk import.
- A Purchasing home page, and alerts for `LOST` Purchasing assets.
- **Purchasing-owned approvals** — first follow-up.
- Depreciation, capitalization thresholds, accounting classes — the user confirmed Finance has none to
  model.
- Consumables and stock control — §9 item D, a separate domain with its own spec.
- Vendor master data — §9 item B.

---

## 13. Files

| file | change |
|---|---|
| `prisma/schema.prisma` | `AssetClass`; `AssetCategory.cls`; `Asset.cls`; six enum values |
| `prisma/migrations/…_asset_status_purchasing_values/` | six `ADD VALUE` |
| `prisma/migrations/…_asset_classes/` | enum, columns, backfill, trigger |
| `prisma/seed.ts` | four categories, seven assets |
| `src/lib/asset-class.ts` **(new)** + test | the partition, defaults, `parseCls`, labels |
| `src/lib/status.ts` | six family entries |
| `src/lib/inventory-list.ts` | `cls` in `buildAssetWhere`; `withClsQS` |
| `src/lib/approval-execution.ts` | class-aware targets |
| `src/lib/offboarding.ts` | class-keyed `OUTCOME_STATUS` |
| `src/lib/import-assets.ts`, `import-vocabulary.ts` | `wrong-class`; IT-set status validation |
| `src/lib/workspaces.ts` | register/new rules admit purchasing; nav link carries `?cls=` |
| `src/server/modules/purchases/receiving.ts` | `registerAssets`: class gate, `cls`, default status |
| `src/server/modules/inventory/actions.ts` | create/edit class gate; request-time target validation; bulk mixed-class refusal |
| `src/server/modules/inventory/queries.ts` | `cls` in list/facets/export |
| `src/server/modules/finance/queries.ts` | `financeAssets(…, cls)` |
| `src/server/modules/admin/reference-actions.ts` | `createRefRow` accepts `cls` for categories |
| `src/app/(app)/inventory/page.tsx` | class chips |
| `src/app/(app)/inventory/[id]/layout.tsx`, `…/secrets/page.tsx`; `src/components/inventory/record-tabs.tsx` | class pill; Secrets hidden / 404 |
| `src/app/(app)/inventory/register/page.tsx`, `register-form.tsx` | filtered categories |
| `src/app/(app)/finance/assets/page.tsx` | the two tabs |
| `src/app/(app)/admin/asset-categories/page.tsx` | Class column and picker |
| `src/app/(app)/admin/equipment-policies/page.tsx` | IT types only |
| `src/components/inventory/request-status-change.tsx`, `bulk-drawer.tsx` | class-aware pickers |
| `src/components/offboarding/item-decision.tsx` | hide Buyout for Purchasing |
| `e2e/asset-classes.spec.ts` **(new)**; `e2e/axe-sweep.spec.ts` | §11.2 |
| `docs/HANDOVER.md` §9 | "Admin" → "Purchasing" |
