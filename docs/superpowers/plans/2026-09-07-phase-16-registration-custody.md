# Phase 16 — Registration, Policy Exceptions, Loans, Bulk Assign and the Signed Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IT registers devices with a suggested tag, a vendor, documents and a live duplicate check (single or batch, with the Purchasing fields), models loaners and one-off exceptions in loadouts, lends with a due date, assigns several spares in one action, and records the signed accountability form on the person.

**Architecture:** One additive migration (three nullable `Asset` columns, a `PolicySlot.loaner` flag, an enum and two small tables). Pure rules stay in `src/lib` (`loadout.ts` gains `effectiveSlots` and the loaner rule; `worklist.ts` gains `loanRow`; new `acknowledgement.ts`). The shared lifecycle executor carries `loanDueAt`. Server actions follow the house shape (role → rate → zod → transaction → audit → revalidate). Upload validation and storage are extracted once into `src/server/uploads.ts` and reused by three actions.

**Tech Stack:** Next.js 15 App Router (server actions), Prisma 6 / PostgreSQL 16, zod, vitest for `src/lib` and `src/server/uploads.ts`, Playwright for e2e. Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-09-07-it-registration-custody-design.md` — read §1 (decisions), §2 (registration), §3 (policies), §4 (loans), §5 (bulk assign), §6 (acknowledgement), §8 (schema), §9 (testing).

**Baselines on `main` at `7712524`:** 998 unit / 54 files · 214 e2e / 16 files · `tsc` and `lint` clean · 16 migrations, none pending. Verify before Task 1 and correct these numbers if they differ.

**Dev environment on the staging laptop (PICKUP §2, memory):** work in a git worktree under `.claude/worktrees/`, with its own `.env`: `DATABASE_URL` pointing at the `inventory_dev` database in the same Postgres container, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`. Dev server on port 3100; Playwright with `E2E_PORT=3100`, always foreground, `--workers=1`. Never touch the `inventory` database or port 3000.

## Global Constraints

- **Exactly one migration**, `20260907110000_it_registration_custody`, hand-written, additive, no backfill. Never `prisma migrate dev` or `reset`; `npm run db:seed` is the sanctioned reset. **Add no seed fixtures** (`home-finance.spec.ts` pins the fleet at 25 IT assets); e2e manufactures what it needs through Prisma.
- **Direct mode is decided by `isDirectLifecycle(role, cls)` and nothing else.** Purchasing-class dialogs and actions are unchanged.
- **The worker's guard messages do not change** (the retry UI shows them verbatim; `approvals-audit.spec.ts` asserts one). No new executor guard: a legacy `lifecycle_assign` payload without `loanDueAt` executes to `TEMPORARY` with `loanDueAt = null`.
- **Every direct lifecycle change writes, in one transaction:** the asset update, an `EXECUTED` approval row, the asset `AuditEntry` and the `approval.executed` webhook — through `recordDirect`. `setLoanDue` is metadata: audit entry only, no approval row (spec §4.2).
- **Loaner rule:** a standard slot matches `status !== "TEMPORARY"`, a loaner slot matches `status === "TEMPORARY"`, leftover `TEMPORARY` devices are `onLoan`, never `unslotted`.
- **Uploads:** `.pdf/.png/.jpg/.jpeg`, MIME cross-checked, ≤ 10 MB, sha256 checksum, sanitised file name, relative path under `uploads/`. Document kinds are `receipt · accountability-form · photo · other · invoice`.
- **Copy, verbatim:** *"Suggested — next free number for BR-LT. Edit if you need another."* · *"No tags yet for this category — type BR-XX-0000."* · *"Already registered"* · *"Serial <value> appears twice in this batch."* · *"Serial <value> is already registered"* · *"A loan needs a due date."* · *"That slot is not part of this person's policy."* · *"Loans overdue, due this week, or with no due date."* · *"Issued since last signature: …"* · *"No signed form on file"* · *"After signing, IT records the scan on this person's page under Accountability form."*
- **Caps:** `BULK_MAX = 200` for bulk assign and batch documents; `checkIdentifiers` ≤ 200 of each list.
- **Ordering of new list reads** that could grow: every `findMany` with `take` also orders by a unique tiebreaker (`id`) after its primary key.
- Commit after every task; never amend; commit messages state real test counts.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/migrations/20260907110000_it_registration_custody/migration.sql`, `prisma/schema.prisma` | the additive schema change (Task 1) |
| `src/lib/loadout.ts` (+test) | `SlotLike.loaner`, `ExceptionLike`, `effectiveSlots`, loaner matching, `onLoan` (Task 2) |
| `src/server/modules/admin/policy-actions.ts`, `src/components/admin/policy-editor.tsx` | loaner slots in the editor (Task 3) |
| `src/server/modules/employees/exception-actions.ts` | add / waive / remove exceptions; consumers fetch exceptions (Task 4) |
| `src/components/employees/loadout-view.tsx`, `src/components/employees/slot-exception-controls.tsx`, `src/app/(app)/employees/[id]/page.tsx` | exception and loaner surfaces (Task 5) |
| `src/lib/lifecycle.ts` (+test), `src/server/modules/lifecycle/{apply,actions}.ts`, `src/worker/execute-approval.ts` | `loanDueAt` in the executor, `assignAsset`, `setLoanDue` (Task 6) |
| `src/components/inventory/{holder-control,loan-due-control}.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`, `loadout-view.tsx` | Deployed/Loan toggle, due date, record card (Task 7) |
| `src/lib/worklist.ts` (+test), `src/server/modules/home/queries.ts` | `loanRow`, the Loans section (Task 8) |
| `src/server/modules/lifecycle/actions.ts`, `src/components/inventory/{bulk-drawer,inventory-table}.tsx`, `src/app/(app)/inventory/page.tsx` | `bulkAssign` and the drawer mode (Task 9) |
| `src/server/uploads.ts` (+test), `src/server/modules/inventory/document-actions.ts` | shared upload rules, `uploadBatchDocument`, `invoice` kind (Task 10) |
| `src/server/modules/inventory/{tag-suggest,actions}.ts`, `src/server/modules/purchases/receiving.ts`, `src/lib/asset-diff.ts`, `src/lib/export-columns.ts`, `src/app/(app)/inventory/export/route.ts` | suggestions, `checkIdentifiers`, new columns in create/update/register/export (Task 11) |
| `src/components/inventory/asset-form.tsx`, `src/app/(app)/inventory/new/page.tsx`, `src/app/(app)/inventory/[id]/{page,edit/page}.tsx` | the single form (Task 12) |
| `src/components/inventory/{register-form,register-success}.tsx`, `src/app/(app)/inventory/register/page.tsx`, `src/lib/workspaces.ts` (+test), `src/app/(app)/inventory/page.tsx` | the batch page and navigation (Task 13) |
| `src/lib/acknowledgement.ts` (+test), `src/server/modules/employees/acknowledgement-actions.ts`, `src/app/(app)/employees/[id]/acknowledgements/[ackId]/download/route.ts`, `src/components/employees/acknowledgement-card.tsx`, `src/app/(app)/employees/[id]/{page,form/page}.tsx` | the signed form (Task 14) |
| `e2e/registration.spec.ts`, `e2e/custody.spec.ts`, existing specs | end-to-end (Task 15) |
| `docs/HANDOVER.md`, `docs/PICKUP.md`, the spec's Status line | close-out (Task 16) |

---

### Task 1: Schema and migration

**Files:**
- Create: `prisma/migrations/20260907110000_it_registration_custody/migration.sql`
- Modify: `prisma/schema.prisma` (`Asset` ~240-310, `User` 131-154, `AssetType` 194-204, `Employee` 215-237, `PolicySlot` 470-477; new enum and two models after `PolicySlot`)

**Interfaces:**
- Produces: Prisma client types `Asset.loanDueAt: Date | null`, `Asset.brand: string | null`, `Asset.invoiceRef: string | null`, `PolicySlot.loaner: boolean`, enum `SlotExceptionKind = "ADD" | "WAIVE"`, models `EmployeeSlotException`, `Acknowledgement` with the fields below. Every later task consumes them.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 16 (spec §8): additive only, no backfill.
ALTER TABLE "Asset"
  ADD COLUMN "loanDueAt" TIMESTAMP(3),
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "invoiceRef" TEXT;
CREATE INDEX "Asset_loanDueAt_idx" ON "Asset"("loanDueAt");

ALTER TABLE "PolicySlot" ADD COLUMN "loaner" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "SlotExceptionKind" AS ENUM ('ADD', 'WAIVE');

CREATE TABLE "EmployeeSlotException" (
  "id"          TEXT NOT NULL,
  "employeeId"  TEXT NOT NULL,
  "kind"        "SlotExceptionKind" NOT NULL,
  "slotId"      TEXT,
  "name"        TEXT,
  "assetTypeId" TEXT,
  "required"    BOOLEAN NOT NULL DEFAULT true,
  "loaner"      BOOLEAN NOT NULL DEFAULT false,
  "reason"      TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeSlotException_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeSlotException_employeeId_idx" ON "EmployeeSlotException"("employeeId");
ALTER TABLE "EmployeeSlotException"
  ADD CONSTRAINT "EmployeeSlotException_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployeeSlotException_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PolicySlot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployeeSlotException_assetTypeId_fkey" FOREIGN KEY ("assetTypeId") REFERENCES "AssetType"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployeeSlotException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Acknowledgement" (
  "id"           TEXT NOT NULL,
  "employeeId"   TEXT NOT NULL,
  "signedAt"     TIMESTAMP(3) NOT NULL,
  "fileName"     TEXT NOT NULL,
  "path"         TEXT NOT NULL,
  "checksum"     TEXT NOT NULL,
  "items"        JSONB NOT NULL,
  "recordedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Acknowledgement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Acknowledgement_employeeId_signedAt_idx" ON "Acknowledgement"("employeeId", "signedAt");
ALTER TABLE "Acknowledgement"
  ADD CONSTRAINT "Acknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Acknowledgement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 2: Mirror it in `schema.prisma`**

In `model Asset`, after `returnedAt`:
```prisma
  /// Phase 16: when a loan (status TEMPORARY) is due back. Set by an assignment
  /// that lands on TEMPORARY; every other status write clears it.
  loanDueAt            DateTime?
  brand                String?
  /// supplier invoice or receipt number, as Purchasing registered it
  invoiceRef           String?
```
and `@@index([loanDueAt])` beside `@@index([returnedAt])`.

In `model PolicySlot`, after `required`:
```prisma
  /// Phase 16: filled only by a device on loan (status TEMPORARY); standard
  /// slots never are. computeLoadout applies the rule.
  loaner      Boolean         @default(false)
  waivers     EmployeeSlotException[]
```

After `model PolicySlot`:
```prisma
enum SlotExceptionKind {
  ADD
  WAIVE
}

/// Phase 16 (spec §3.2): one person's deviation from their resolved policy.
/// WAIVE names a policy slot they do not need (cascades away with the slot);
/// ADD is an extra slot for them alone. Applied by effectiveSlots().
model EmployeeSlotException {
  id          String            @id @default(cuid())
  employeeId  String
  employee    Employee          @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  kind        SlotExceptionKind
  slotId      String?
  slot        PolicySlot?       @relation(fields: [slotId], references: [id], onDelete: Cascade)
  name        String?
  assetTypeId String?
  assetType   AssetType?        @relation(fields: [assetTypeId], references: [id], onDelete: Restrict)
  required    Boolean           @default(true)
  loaner      Boolean           @default(false)
  reason      String
  createdById String
  createdBy   User              @relation("slotExceptionCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt   DateTime          @default(now())

  @@index([employeeId])
}

/// Phase 16 (spec §6): the signed accountability form, on the person.
model Acknowledgement {
  id           String   @id @default(cuid())
  employeeId   String
  employee     Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  signedAt     DateTime
  fileName     String
  path         String
  checksum     String
  /// [{ assetId, tag, model, serial }] held when the form was recorded
  items        Json
  recordedById String
  recordedBy   User     @relation("acknowledgementRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)
  createdAt    DateTime @default(now())

  @@index([employeeId, signedAt])
}
```

Back-relations: `Employee` gains `slotExceptions EmployeeSlotException[]` and `acknowledgements Acknowledgement[]`; `AssetType` gains `slotExceptions EmployeeSlotException[]`; `User` gains `slotExceptionsCreated EmployeeSlotException[] @relation("slotExceptionCreatedBy")` and `acknowledgementsRecorded Acknowledgement[] @relation("acknowledgementRecordedBy")`.

- [ ] **Step 3: Apply and generate**

Run: `npx prisma migrate deploy` (against `inventory_dev`), then `npx prisma generate`, then `npx prisma migrate status`.
Expected: 17 migrations applied, none pending; `tsc` still clean (`npx tsc --noEmit`).

- [ ] **Step 4: Prove it is additive**

Run: `npm run db:seed` then `npx vitest run` → 998 passed. The seed writes nothing to the new columns; every new column is nullable or defaulted.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260907110000_it_registration_custody/migration.sql
git commit -m "feat(schema): Phase 16 -- loanDueAt, brand, invoiceRef; PolicySlot.loaner; EmployeeSlotException; Acknowledgement (migration 17, additive)"
```

---

### Task 2: Loadout rules — loaner slots and exceptions (pure)

**Files:**
- Modify: `src/lib/loadout.ts`, `src/lib/loadout.test.ts`
- Modify (keep `tsc` green — every `computeLoadout` caller must now select `loaner`): `src/server/modules/home/queries.ts:129,364` (`slots: { select: … }` add `loaner: true`), `src/app/(app)/employees/[id]/page.tsx:31` (the `include: { slots: { include: { assetType: true } } }` already returns all columns — no change), `src/server/modules/employees/queries.ts:59` (`slots: true` — no change), `src/app/(app)/admin/equipment-policies/page.tsx` (check its slots select and add `loaner: true` if it selects columns).

**Interfaces:**
- Produces:
  ```ts
  export interface SlotLike { id: string; name: string; assetTypeId: string | null; required: boolean; loaner: boolean; exceptionId?: string }
  export interface ExceptionLike { id: string; kind: "ADD" | "WAIVE"; slotId: string | null; name: string | null; assetTypeId: string | null; required: boolean; loaner: boolean }
  export function effectiveSlots(slots: SlotLike[], exceptions: ExceptionLike[]): SlotLike[]
  export interface Loadout<A> { slots: Array<{ slot: SlotLike; asset: A | null }>; unslotted: A[]; onLoan: A[]; filled: number; totalSlots: number; missingRequired: number }
  ```
  `exceptionId` refines the spec's `exception?: true` (§3.3): the UI needs the row id to remove the exception, so the flag carries it.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/loadout.test.ts`; update the existing `slots` fixture to add `loaner: false` to each row)

```ts
import { computeLoadout, effectiveSlots, resolvePolicy, type ExceptionLike } from "./loadout";

const slots = [
  { id: "s1", name: "laptop", assetTypeId: "t-laptop", required: true, loaner: false },
  { id: "s2", name: "monitor", assetTypeId: "t-monitor", required: true, loaner: false },
  { id: "s3", name: "second monitor", assetTypeId: "t-monitor", required: false, loaner: false },
  { id: "s4", name: "headset", assetTypeId: "t-headset", required: true, loaner: false },
];
const loanerSlot = { id: "s5", name: "loaner laptop", assetTypeId: "t-laptop", required: false, loaner: true };
const asset = (id: string, typeId: string | null, status = "DEPLOYED") => ({ id, tag: id, model: "m", typeId, status });

describe("computeLoadout — loaner rule (Phase 16 §3.3)", () => {
  it("a TEMPORARY device never fills a standard slot; it is on loan", () => {
    const l = computeLoadout(slots, [asset("a1", "t-laptop", "TEMPORARY")]);
    expect(l.slots[0].asset).toBeNull();
    expect(l.onLoan.map((a) => a.id)).toEqual(["a1"]);
    expect(l.unslotted).toEqual([]);
    expect(l.missingRequired).toBe(3);
  });
  it("a loaner slot takes only a TEMPORARY device of its type", () => {
    const l = computeLoadout([...slots, loanerSlot], [asset("a1", "t-laptop", "DEPLOYED"), asset("a2", "t-laptop", "TEMPORARY")]);
    expect(l.slots.find((s) => s.slot.id === "s1")?.asset?.id).toBe("a1");
    expect(l.slots.find((s) => s.slot.id === "s5")?.asset?.id).toBe("a2");
    expect(l.onLoan).toEqual([]);
  });
  it("a DEPLOYED device never fills a loaner slot", () => {
    const l = computeLoadout([loanerSlot], [asset("a1", "t-laptop", "DEPLOYED")]);
    expect(l.slots[0].asset).toBeNull();
    expect(l.unslotted.map((a) => a.id)).toEqual(["a1"]);
  });
  it("a required loaner slot left empty counts as missing", () => {
    expect(computeLoadout([{ ...loanerSlot, required: true }], []).missingRequired).toBe(1);
  });
});

describe("effectiveSlots (Phase 16 §3.3)", () => {
  const waive = (slotId: string): ExceptionLike =>
    ({ id: `w-${slotId}`, kind: "WAIVE", slotId, name: null, assetTypeId: null, required: true, loaner: false });
  const add: ExceptionLike =
    { id: "x1", kind: "ADD", slotId: null, name: "tablet", assetTypeId: "t-tablet", required: true, loaner: false };
  it("drops waived slots", () => {
    expect(effectiveSlots(slots, [waive("s4")]).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
  it("ignores a waiver whose slot is not in this policy", () => {
    expect(effectiveSlots(slots, [waive("gone")])).toHaveLength(4);
  });
  it("appends ADD rows after the policy's slots, carrying the exception id", () => {
    const out = effectiveSlots(slots, [add]);
    expect(out[4]).toEqual({ id: "x:x1", name: "tablet", assetTypeId: "t-tablet", required: true, loaner: false, exceptionId: "x1" });
  });
  it("orders several ADD rows by name then id", () => {
    const b: ExceptionLike = { ...add, id: "x2", name: "camera" };
    expect(effectiveSlots([], [add, b]).map((s) => s.name)).toEqual(["camera", "tablet"]);
  });
  it("ADD-only with no policy gives a personal loadout", () => {
    expect(computeLoadout(effectiveSlots([], [add]), [asset("a1", "t-tablet")]).filled).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/loadout.test.ts`
Expected: FAIL — `effectiveSlots` is not exported; `onLoan` undefined.

- [ ] **Step 3: Implement**

```ts
export interface SlotLike {
  id: string;
  name: string;
  assetTypeId: string | null;
  required: boolean;
  /** Phase 16: filled only by a device on loan (TEMPORARY). */
  loaner: boolean;
  /** Phase 16: set when this slot comes from an ADD exception — the row's id, so the UI can remove it. */
  exceptionId?: string;
}

export interface ExceptionLike {
  id: string;
  kind: "ADD" | "WAIVE";
  slotId: string | null;
  name: string | null;
  assetTypeId: string | null;
  required: boolean;
  loaner: boolean;
}

/**
 * Phase 16 (spec §3.3): one person's slots = their policy's slots minus the
 * ones waived for them, plus the ones added for them. A waiver naming a slot
 * that is not in `slots` (their policy changed) is ignored, not an error.
 */
export function effectiveSlots(slots: SlotLike[], exceptions: ExceptionLike[]): SlotLike[] {
  const waived = new Set(exceptions.filter((e) => e.kind === "WAIVE" && e.slotId).map((e) => e.slotId as string));
  const kept = slots.filter((s) => !waived.has(s.id));
  const added = exceptions
    .filter((e) => e.kind === "ADD")
    .map<SlotLike>((e) => ({
      id: `x:${e.id}`, name: e.name ?? "extra", assetTypeId: e.assetTypeId, required: e.required, loaner: e.loaner, exceptionId: e.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [...kept, ...added];
}

export interface Loadout<A extends HeldAssetLike> {
  slots: Array<{ slot: SlotLike; asset: A | null }>;
  /** held assets no slot claimed — shown in the holding area / table view */
  unslotted: A[];
  /** Phase 16: TEMPORARY devices no loaner slot claimed — never "extras" */
  onLoan: A[];
  filled: number;
  totalSlots: number;
  missingRequired: number;
}

/** Greedy fill in slot order. A standard slot takes the first remaining non-loan asset of its type; a loaner slot the first remaining TEMPORARY one. */
export function computeLoadout<A extends HeldAssetLike>(slots: SlotLike[], held: A[]): Loadout<A> {
  const remaining = [...held];
  const filledSlots = slots.map((slot) => {
    const i = slot.assetTypeId
      ? remaining.findIndex((a) => a.typeId === slot.assetTypeId && (a.status === "TEMPORARY") === slot.loaner)
      : -1;
    return { slot, asset: i >= 0 ? remaining.splice(i, 1)[0] : null };
  });
  return {
    slots: filledSlots,
    unslotted: remaining.filter((a) => a.status !== "TEMPORARY"),
    onLoan: remaining.filter((a) => a.status === "TEMPORARY"),
    filled: filledSlots.filter((s) => s.asset).length,
    totalSlots: slots.length,
    missingRequired: filledSlots.filter((s) => !s.asset && s.slot.required).length,
  };
}
```

- [ ] **Step 4: Fix the callers' selects** — in `home/queries.ts` both `slots: { select: { id: true, name: true, assetTypeId: true, required: true } }` become `{ id: true, name: true, assetTypeId: true, required: true, loaner: true }`. Grep `computeLoadout(` and `slots: { select` across `src/` and add `loaner: true` wherever columns are enumerated.

Run: `npx vitest run src/lib/loadout.test.ts && npx tsc --noEmit`
Expected: all loadout tests pass (the pre-existing 9 plus 9 new); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadout.ts src/lib/loadout.test.ts src/server/modules/home/queries.ts
git commit -m "feat(loadout): loaner slots fill only from TEMPORARY devices; effectiveSlots applies per-person exceptions; onLoan group"
```

---

### Task 3: Loaner slots in the policy editor

**Files:**
- Modify: `src/server/modules/admin/policy-actions.ts:211-247` (`addSlotSchema`, `addSlot`), `:71` (`slotList`)
- Modify: `src/components/admin/policy-editor.tsx` (the add-slot row around :205-235; slot rows around :140-175)

**Interfaces:**
- Consumes: `PolicySlot.loaner` (Task 1).
- Produces: `addSlot({ policyId, name, assetTypeId, required, loaner })`; the editor's slot row shows a `LOAN` pill; `slotList` names loaner slots `"<name> (loaner)"` so the `policy.slot.*` audit diffs read correctly.

- [ ] **Step 1: Server** — in `addSlotSchema` add `loaner: z.boolean()`; in the `policySlot.create` data add `loaner: d.loaner`. In `slotList(tx, policyId)` make the label `slot.loaner ? \`${slot.name} (loaner)\` : slot.name` (read the function; it maps slots to strings — extend the map, keep ordering).

- [ ] **Step 2: Editor** — beside the existing `required` `<Checkbox>` add:
```tsx
<label className="inline-flex items-center gap-2 text-xs">
  <Checkbox checked={loaner} onChange={(e) => setLoaner(e.target.checked)} />
  loaner slot — filled by a device on loan (TEMPORARY)
</label>
```
with `const [loaner, setLoaner] = useState(false);`, pass `loaner` into `addSlot({ policyId: policy.id, name, assetTypeId: typeId, required, loaner })`, reset it with the other fields after success. In the slot row (both the toggle-button branch and the read-only branch), render `{slot.loaner && <Pill>LOAN</Pill>}` after the slot name and include `· loaner` in the `aria-label` when set. The `slot` prop type in this file gains `loaner: boolean`; the admin page maps it from Prisma (`loaner: s.loaner`).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx eslint src/components/admin/policy-editor.tsx src/server/modules/admin/policy-actions.ts`
Manual: start the dev server on 3100 (`npm run dev -- -p 3100`), sign in as `admin@thebackroomop.com`, open `/admin/equipment-policies`, add a slot with the checkbox ticked, see the `LOAN` pill; `/audit` shows `policy.slot.added` with `(loaner)` in the diff. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/server/modules/admin/policy-actions.ts src/components/admin/policy-editor.tsx "src/app/(app)/admin/equipment-policies/page.tsx"
git commit -m "feat(policies): loaner slots -- add-slot checkbox, LOAN pill, (loaner) in the slot audit"
```

---

### Task 4: Exception actions, and every loadout consumer applies exceptions

**Files:**
- Create: `src/server/modules/employees/exception-actions.ts`
- Modify: `src/server/modules/employees/queries.ts:56-70` (`filteredEmployees`), `src/server/modules/home/queries.ts` (hires ~:126-195 and fleet ~:360-375), `src/app/(app)/employees/[id]/page.tsx:24-44` (fetch exceptions, compute over `effectiveSlots`)

**Interfaces:**
- Consumes: `effectiveSlots`, `ExceptionLike` (Task 2); Prisma `employeeSlotException`.
- Produces:
  ```ts
  export async function addSlotException(input: unknown): Promise<ActionResult<{ id: string }>>   // { employeeId, name, assetTypeId, required, loaner, reason }
  export async function waiveSlot(input: unknown): Promise<ActionResult<{ id: string }>>          // { employeeId, slotId, reason }
  export async function removeSlotException(input: unknown): Promise<ActionResult<null>>         // { id }
  ```
  Audit: `entityType: "employee"`, actions `policy.exception.added | policy.exception.waived | policy.exception.removed`, diff `{ slot: { from, to }, reason: { from: null, to } }`.

- [ ] **Step 1: Write the actions**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { resolvePolicy } from "@/lib/loadout";

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);

function revalidate(employeeId: string) {
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/");
}

/** The two refusals every exception write shares: the person exists and is not gone. */
async function loadEmployee(employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, title: true, departmentId: true, employment: true } });
  if (!e) return { failure: conflict("That employee no longer exists.") } as const;
  if (e.employment === "OFFBOARDED") return { failure: conflict("This offboarding is closed — exceptions cannot change.") } as const;
  return { employee: e } as const;
}

const addSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().trim().min(2, "Name the slot").max(40),
  assetTypeId: z.string().min(1, "Pick an asset type"),
  required: z.boolean(),
  loaner: z.boolean(),
  reason,
});

export async function addSlotException(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const loaded = await loadEmployee(d.employeeId);
  if ("failure" in loaded) return loaded.failure;
  const type = await prisma.assetType.findFirst({ where: { id: d.assetTypeId, category: { cls: "IT" } }, select: { name: true } });
  if (!type) return validationError({ assetTypeId: "Unknown asset type" });

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.employeeSlotException.create({
      data: { employeeId: d.employeeId, kind: "ADD", name: d.name, assetTypeId: d.assetTypeId, required: d.required, loaner: d.loaner, reason: d.reason, createdById: user.id },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: d.employeeId,
      action: "policy.exception.added",
      diff: { slot: { from: null, to: `${d.name}${d.loaner ? " (loaner)" : ""} · ${type.name}` }, reason: { from: null, to: d.reason } },
    });
    return row.id;
  });
  revalidate(d.employeeId);
  return ok({ id });
}

const waiveSchema = z.object({ employeeId: z.string().min(1), slotId: z.string().min(1), reason });

export async function waiveSlot(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = waiveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const loaded = await loadEmployee(d.employeeId);
  if ("failure" in loaded) return loaded.failure;

  const policies = await prisma.equipmentPolicy.findMany({ include: { slots: true } });
  const policy = resolvePolicy(loaded.employee, policies);
  const slot = policy?.slots.find((s) => s.id === d.slotId);
  if (!slot) return conflict("That slot is not part of this person's policy.");
  const dup = await prisma.employeeSlotException.findFirst({ where: { employeeId: d.employeeId, kind: "WAIVE", slotId: d.slotId } });
  if (dup) return conflict(`${slot.name} is already waived for this person.`);

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.employeeSlotException.create({
      data: { employeeId: d.employeeId, kind: "WAIVE", slotId: d.slotId, reason: d.reason, createdById: user.id },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: d.employeeId,
      action: "policy.exception.waived",
      diff: { slot: { from: `${slot.name}${slot.loaner ? " (loaner)" : ""}`, to: null }, reason: { from: null, to: d.reason } },
    });
    return row.id;
  });
  revalidate(d.employeeId);
  return ok({ id });
}

const idSchema = z.object({ id: z.string().min(1) });

export async function removeSlotException(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const row = await prisma.employeeSlotException.findUnique({ where: { id: parsed.data.id }, include: { slot: true } });
  if (!row) return ok(null); // already gone — idempotent
  const loaded = await loadEmployee(row.employeeId);
  if ("failure" in loaded) return loaded.failure;
  const label = row.kind === "ADD" ? `${row.name}${row.loaner ? " (loaner)" : ""}` : `waiver of ${row.slot?.name ?? "a removed slot"}`;
  await prisma.$transaction(async (tx) => {
    await tx.employeeSlotException.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: row.employeeId,
      action: "policy.exception.removed",
      diff: { slot: { from: label, to: null } },
    });
  });
  revalidate(row.employeeId);
  return ok(null);
}
```

- [ ] **Step 2: Consumers** — everywhere `computeLoadout(policy.slots, …)` runs, fetch the exceptions and compute over `effectiveSlots(policy?.slots ?? [], exceptions)`:
  - `employees/[id]/page.tsx`: add `prisma.employeeSlotException.findMany({ where: { employeeId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { assetType: { select: { name: true } }, slot: { select: { name: true } } } })` to the `Promise.all`; `const loadout = computeLoadout(effectiveSlots(policy?.slots ?? [], exceptions), held);`. (Task 5 finishes this page's UI.)
  - `employees/queries.ts` `filteredEmployees`: after `fetchCandidates`, `const exceptions = await prisma.employeeSlotException.findMany({ where: { employeeId: { in: employees.map((e) => e.id) } } });` grouped into a `Map<string, ExceptionLike[]>`; `computeLoadout(effectiveSlots(policy?.slots ?? [], byEmployee.get(employee.id) ?? []), employee.assets)`. `missingRequired` stays `null` only when there is neither a policy nor an ADD exception.
  - `home/queries.ts` hires block and `fleet()`: same pattern, one `findMany` over the employees in hand.

Run: `npx tsc --noEmit && npx vitest run` → 1007 passed (998 + 9).

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/employees/exception-actions.ts src/server/modules/employees/queries.ts src/server/modules/home/queries.ts "src/app/(app)/employees/[id]/page.tsx"
git commit -m "feat(policies): per-person slot exceptions -- add, waive, remove actions with employee audit; every loadout consumer applies them"
```

---

### Task 5: Exception and loaner surfaces on the employee page

**Files:**
- Create: `src/components/employees/slot-exception-controls.tsx`
- Modify: `src/components/employees/loadout-view.tsx` (`SlotTile` :26-33, props :55-73, tile menu, groups), `src/app/(app)/employees/[id]/page.tsx:55-62,150-159`

**Interfaces:**
- Consumes: `addSlotException`, `waiveSlot`, `removeSlotException` (Task 4); `Loadout.onLoan` (Task 2).
- Produces: `SlotTile` gains `loaner: boolean; exceptionId: string | null; exceptionReason: string | null`; `LoadoutView` gains props `onLoan: SlotTile["asset"][]`, `waived: Array<{ id: string; slotName: string; reason: string }>`, `itTypes: Array<{ id: string; name: string }>`. The fill-slot dialog for a loaner tile is finished in Task 7 (Loan mode); in this task a loaner tile's fill button opens the dialog as today.

- [ ] **Step 1: Controls component** — `"use client"`; exports `WaiveSlotDialog({ employeeId, slot: { id, name }, open, onClose })`, `AddSlotDialog({ employeeId, itTypes, open, onClose })`, `RemoveExceptionButton({ id, label })`. Each uses `Dialog`, `FormField`, `Textarea`/`Input`/`Select`/`Checkbox`, `useToast`, `useRouter().refresh()`, `RateLimitNotice`, and the `handle` result pattern from `loadout-view.tsx:95-100`. Copy for the toasts: `"<slot> waived for this person"`, `"<name> added for this person"`, `"Exception removed"`. Field errors map to `reason`, `name`, `assetTypeId`; a `conflict` renders as a `Banner tone="fault"`.

- [ ] **Step 2: Loadout view** — each tile's action menu (where Return/Replace live) gains *"Waive for this person…"* when `mayAct && !tile.exceptionId`; exception tiles show `<Pill title={exceptionReason}>EXCEPTION</Pill>` and a *"Remove exception"* item; loaner tiles show `<Pill>LOAN</Pill>`. After the slot grid: an *"On loan"* card listing `onLoan` (tag, model, `on loan` note) when non-empty, before the existing unslotted/holding area; then *"Waived for this person (N)"* collapsed (`<details>`) listing `waived` with a *Restore* button (`RemoveExceptionButton`) when `mayAct`. An *"Add a slot for this person…"* button in the slots card header when `mayAct`.

- [ ] **Step 3: Page wiring** — `slots` mapping adds `loaner: slot.loaner, exceptionId: slot.exceptionId ?? null, exceptionReason: exceptions.find((e) => e.id === slot.exceptionId)?.reason ?? null`; `waived = exceptions.filter((e) => e.kind === "WAIVE").map((e) => ({ id: e.id, slotName: e.slot?.name ?? "removed slot", reason: e.reason }))`; `itTypes = await prisma.assetType.findMany({ where: { category: { cls: "IT" } }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] })`; pass `onLoan={loadout.onLoan.map(toTileAsset)}`. The `typeName` map must also resolve ADD slots: `typeName.get(slot.id) ?? exceptionTypeName ?? "any"` where exception rows carry `assetType.name`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx eslint src/components/employees "src/app/(app)/employees"`; dev server on 3100 as `it@`: open a Finance employee, waive `headset`, see the count drop and the waived list; add `tablet`; remove it; audit rows appear on `/employees/activity`. Run axe on the page via the browser devtools if available, else rely on Task 15's sweep.

- [ ] **Step 5: Commit**

```bash
git add src/components/employees "src/app/(app)/employees/[id]/page.tsx"
git commit -m "feat(employees): waive and add slots per person, EXCEPTION and LOAN pills, On loan group"
```

---

### Task 6: `loanDueAt` in the executor, `assignAsset`, the worker, and `setLoanDue`

**Files:**
- Modify: `src/lib/lifecycle.ts` (+ `src/lib/lifecycle.test.ts`), `src/server/modules/lifecycle/apply.ts:7-15,39-69,104-107`, `src/server/modules/lifecycle/actions.ts:40-42,129-165`, `src/worker/execute-approval.ts:87-91`, `src/lib/worklist.ts:11` (rename)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/lifecycle.ts
  export const DEFAULT_LOAN_DAYS = 30;
  export function loanDueFor(status: string, raw: string | undefined, today: Date): { ok: true; value: Date | null } | { ok: false; error: string }
  // apply.ts
  export type LifecycleAsset = { …; loanDueAt: Date | null };
  export type LifecycleChange = { kind: "assign"; employeeId: string; status: AssetStatus; loanDueAt: Date | null } | …
  // actions.ts
  assignAsset({ assetId, employeeId, status?, loanDueAt?, reason? })
  export async function setLoanDue(input: unknown): Promise<ActionResult<{ tag: string; loanDueAt: string }>>   // { assetId, loanDueAt: "YYYY-MM-DD" }
  ```
  `DEFAULT_LOAN_DAYS` lives in `src/lib/lifecycle.ts`; `src/lib/worklist.ts` re-exports it and drops `LOAN_DAYS` (Task 8 rewrites the section).

- [ ] **Step 1: Failing unit tests** (append to `src/lib/lifecycle.test.ts`)

```ts
import { DEFAULT_LOAN_DAYS, loanDueFor } from "./lifecycle";

describe("loanDueFor (Phase 16 §4.2)", () => {
  const today = new Date("2026-09-07T10:00:00Z");
  it("DEPLOYED ignores any date and stores null", () => {
    expect(loanDueFor("DEPLOYED", "2026-10-01", today)).toEqual({ ok: true, value: null });
  });
  it("TEMPORARY needs a date", () => {
    expect(loanDueFor("TEMPORARY", undefined, today)).toEqual({ ok: false, error: "A loan needs a due date." });
    expect(loanDueFor("TEMPORARY", "", today)).toEqual({ ok: false, error: "A loan needs a due date." });
  });
  it("TEMPORARY accepts today or later, refuses the past", () => {
    expect(loanDueFor("TEMPORARY", "2026-09-07", today)).toEqual({ ok: true, value: new Date("2026-09-07T00:00:00Z") });
    expect(loanDueFor("TEMPORARY", "2026-09-06", today).ok).toBe(false);
  });
  it("the default loan is 30 days", () => expect(DEFAULT_LOAN_DAYS).toBe(30));
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/lifecycle.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement the pure rule** (in `src/lib/lifecycle.ts`)

```ts
/** Phase 16 (spec §4.2): the dialogs' default loan length. */
export const DEFAULT_LOAN_DAYS = 30;

/**
 * What `loanDueAt` an assignment stores. Only a loan (TEMPORARY) carries one,
 * and it may not be in the past. Dates are day-precision UTC, like every
 * other date field this app stores (asset-diff.ts's toDay).
 */
export function loanDueFor(status: string, raw: string | undefined, today: Date):
  { ok: true; value: Date | null } | { ok: false; error: string } {
  if (status !== "TEMPORARY") return { ok: true, value: null };
  if (!raw) return { ok: false, error: "A loan needs a due date." };
  const value = new Date(`${raw}T00:00:00Z`);
  const floor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (Number.isNaN(value.getTime()) || value < floor) return { ok: false, error: "A loan needs a due date on or after today." };
  return { ok: true, value };
}
```

- [ ] **Step 4: Executor** (`apply.ts`) — `LifecycleAsset` gains `loanDueAt: Date | null`; the assign variant gains `loanDueAt: Date | null`. In `prepareLifecycle`, after the kind-specific blocks and before the diff lines:
```ts
  // Phase 16 (spec §4.1): only a loan carries a due date; every other status
  // write clears it. No guard here — a legacy queued assign without a date
  // still executes (worker messages are frozen).
  const nextDue = change.kind === "assign" && change.status === "TEMPORARY" ? change.loanDueAt : null;
  if ((nextDue?.getTime() ?? null) !== (asset.loanDueAt?.getTime() ?? null)) {
    updates.loanDueAt = nextDue;
    diff.loanDueAt = { from: asset.loanDueAt, to: nextDue };
  }
```
`assetSelect` in `actions.ts:40` adds `loanDueAt: true`. Grep every other `LifecycleAsset` literal (offboarding/actions.ts, inventory/actions.ts createAsset's direct branch, employees/actions.ts) and make sure the selected asset carries `loanDueAt` (a `select` needs the column; a full row already has it).

- [ ] **Step 5: Worker** (`execute-approval.ts:87-91`) — the assign change reads the payload's optional date:
```ts
const rawDue = (approval.payload as { to?: { loanDueAt?: unknown } } | null)?.to?.loanDueAt;
const loanDueAt = typeof rawDue === "string" && !Number.isNaN(Date.parse(rawDue)) ? new Date(rawDue) : null;
const change: LifecycleChange =
  approval.type === "lifecycle_assign"
    ? { kind: "assign", employeeId: plan.updates.assigneeId as string, status: plan.updates.status, loanDueAt }
    : …
```

- [ ] **Step 6: `assignAsset` and `setLoanDue`** (`actions.ts`) — add `const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);` near the top; `assignSchema` gains `loanDueAt: dateStr.optional()`. Inside the transaction after `status` is settled:
```ts
    const due = loanDueFor(status, d.loanDueAt, now);
    if (!due.ok) return validationError({ loanDueAt: due.error });
    …
      change: { kind: "assign", employeeId: d.employeeId, status, loanDueAt: due.value },
      payload: { to: { assigneeId: d.employeeId, status, ...(due.value ? { loanDueAt: due.value.toISOString() } : {}) }, reason: d.reason || "assigned" },
```
Then the metadata action:
```ts
// ── setLoanDue ──────────────────────────────────────────────────────────────
const loanDueSchema = z.object({ assetId: z.string().min(1), loanDueAt: dateStr });

/** Spec §4.2: a due date is metadata, like notes — audited, no approval row. */
export async function setLoanDue(input: unknown): Promise<ActionResult<{ tag: string; loanDueAt: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = loanDueSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  const due = loanDueFor("TEMPORARY", d.loanDueAt, now);
  if (!due.ok) return validationError({ loanDueAt: due.error });
  let out: { tag: string; loanDueAt: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: d.assetId }, select: assetSelect });
    if (!asset) return conflict("That asset no longer exists.");
    if (!isDirectLifecycle(user.role, asset.cls)) return forbidden();
    if (asset.status !== "TEMPORARY") return conflict(`${asset.tag} is not on loan — it reads ${asset.status}.`);
    await tx.asset.update({ where: { id: asset.id }, data: { loanDueAt: due.value } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
      action: "loan.due-changed", diff: { loanDueAt: { from: asset.loanDueAt, to: due.value } },
    });
    out = { tag: asset.tag, loanDueAt: d.loanDueAt };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, []);
  revalidatePath("/inventory/work");
  return ok(out!);
}
```
Also add `"loan.due-changed"` to `src/lib/activity.ts`'s sentence map if it has an exhaustive switch (read it; if it falls back to a generic sentence, leave it and note in the report). Add the label `loanDueAt: "Loan until"` in `src/lib/asset-diff.ts` if it has a label map; otherwise it is Task 11's job.

- [ ] **Step 7: Verify** — `npx vitest run` (1011 passed) and `npx tsc --noEmit`. `worklist.ts:11` now reads `export { DEFAULT_LOAN_DAYS } from "./lifecycle";` and the `LOAN_DAYS` test in `worklist.test.ts` is rewritten in Task 8 — for this task change it to `it("the default loan is 30 days", () => expect(DEFAULT_LOAN_DAYS).toBe(30));` with the import updated, and change `home/queries.ts`'s `LOAN_DAYS` import to `DEFAULT_LOAN_DAYS` so `tsc` passes (Task 8 replaces that code).

- [ ] **Step 8: Commit**

```bash
git add src/lib/lifecycle.ts src/lib/lifecycle.test.ts src/lib/worklist.ts src/lib/worklist.test.ts src/server/modules/lifecycle src/worker/execute-approval.ts src/server/modules/home/queries.ts
git commit -m "feat(lifecycle): loanDueAt travels with an assignment -- executor sets it on TEMPORARY and clears it otherwise; assignAsset takes a due date; setLoanDue edits it with an audit entry"
```

---

### Task 7: Deployed | Loan in the dialogs, and the record's loan card

**Files:**
- Create: `src/components/inventory/loan-due-control.tsx`
- Modify: `src/components/inventory/holder-control.tsx:18-20,36-52,109-116`, `src/components/employees/loadout-view.tsx` (fill dialog :102-128 and :397-455), `src/app/(app)/inventory/[id]/layout.tsx:46-50,83,114-120`

**Interfaces:**
- Consumes: `assignAsset` with `status`/`loanDueAt`, `setLoanDue`, `DEFAULT_LOAN_DAYS` (Task 6); `SlotTile.loaner` (Task 5).
- Produces: `LoanDueControl({ assetId, tag, loanDueAt: string | null })` (client) rendering *"On loan until <date> · Change"* or the attention-tone *"No due date — set one"*, both opening a dialog that calls `setLoanDue`.

- [ ] **Step 1: A shared default-date helper** — in `src/lib/lifecycle.ts`: `export function defaultLoanDue(today: Date): string` returning `today + DEFAULT_LOAN_DAYS` as `YYYY-MM-DD` (UTC). Unit test: `defaultLoanDue(new Date("2026-09-07T10:00:00Z"))` → `"2026-10-07"`.

- [ ] **Step 2: `HolderControl` assign mode** — state `const [mode, setMode] = useState<"DEPLOYED" | "TEMPORARY">("DEPLOYED"); const [loanDueAt, setLoanDueAt] = useState(defaultLoanDue(new Date()));`. When `props.direct && isAssign`, render above *Assign to*:
```tsx
<SegmentedControl aria-label="Assignment kind" value={mode}
  options={[{ value: "DEPLOYED", label: "Deployed" }, { value: "TEMPORARY", label: "Loan" }]}
  onChange={(v) => setMode(v as "DEPLOYED" | "TEMPORARY")} />
{mode === "TEMPORARY" && (
  <FormField label="Loan until" required error={fieldErrors.loanDueAt} hint={`Defaults to ${DEFAULT_LOAN_DAYS} days.`}>
    {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date" value={loanDueAt} onChange={(e) => setLoanDueAt(e.target.value)} />}
  </FormField>
)}
```
and call `assignAsset({ assetId, employeeId, status: mode, loanDueAt: mode === "TEMPORARY" ? loanDueAt : undefined, reason })`. The toast for a loan: `` `${props.tag} on loan to ${employeeName} until ${loanDueAt}` ``. `close()` resets `mode` and `loanDueAt`. Purchasing (`!direct`) sees no toggle.

- [ ] **Step 3: Loadout fill dialog** — when `fillSlot?.loaner` and `direct`, the dialog title reads `Lend for the ${fillSlot.name} slot`, shows the *Loan until* field (same `Input`, default `defaultLoanDue`), and `submitFill` calls `assignAsset({ assetId: pickedSpare, employeeId, status: "TEMPORARY", loanDueAt, reason })`; otherwise unchanged. Field error `loanDueAt` renders under the field.

- [ ] **Step 4: Record card** — `layout.tsx` includes `loanDueAt` in its asset read (it already reads the full row via `getVisibleAsset` — confirm); when `asset.status === "TEMPORARY" && canMutate && direct`, render `<LoanDueControl assetId tag loanDueAt={asset.loanDueAt?.toISOString().slice(0, 10) ?? null} />` inside the holder block (:114-120) under the holder's name. `LoanDueControl` shows `fmtDate` of the date or the attention copy, a *Change* / *Set date* button, and a `Dialog` with one date field calling `setLoanDue`; toast `` `${tag} due back ${loanDueAt}` ``; `router.refresh()`.

- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx eslint src/components/inventory src/components/employees`; dev server: assign BR-MN-0910 to someone as a Loan with a date, record shows *On loan until*; change it; return it → the column is null (`SELECT "loanDueAt" FROM "Asset" WHERE tag='BR-MN-0910'` via `npx prisma db execute --stdin` or the record's History showing `Loan until → —`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/lifecycle.ts src/lib/lifecycle.test.ts src/components/inventory/holder-control.tsx src/components/inventory/loan-due-control.tsx src/components/employees/loadout-view.tsx "src/app/(app)/inventory/[id]/layout.tsx"
git commit -m "feat(loans): Deployed | Loan in the assign dialogs with a due date; loaner tiles lend; the record shows and edits the due date"
```

---

### Task 8: The Loans section reads `loanDueAt`

**Files:**
- Modify: `src/lib/worklist.ts:10-21` (+ `src/lib/worklist.test.ts`), `src/server/modules/home/queries.ts:99-124,270-280`

**Interfaces:**
- Produces:
  ```ts
  export const LOAN_DUE_SOON_DAYS = 7;
  export interface LoanLike { id: string; tag: string; model: string; loanDueAt: Date | null; holder: string | null }
  export function loanRow(a: LoanLike, now: Date): WorkRow | null
  ```

- [ ] **Step 1: Failing tests** (replace the `LOAN_DAYS` test; append)

```ts
import { LOAN_DUE_SOON_DAYS, WORK_SECTIONS, groupWork, loanRow, type WorkRow } from "./worklist";

describe("loanRow (Phase 16 §4.3)", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const loan = (loanDueAt: Date | null) => ({ id: "a1", tag: "BR-LT-0210", model: "T14", loanDueAt, holder: "Ana Cruz" });
  it("no due date sits on top and asks for one", () => {
    const r = loanRow(loan(null), now)!;
    expect(r.title).toBe("BR-LT-0210 on loan with no due date");
    expect(r.meta).toBe("Ana Cruz · set a due date");
    expect(r.severity).toBe(1000);
    expect(r.action).toBe("Set date");
    expect(r.href).toBe("/inventory/a1");
  });
  it("overdue by N days", () => {
    const r = loanRow(loan(new Date("2026-09-04T00:00:00Z")), now)!;
    expect(r.title).toBe("BR-LT-0210 overdue by 3 d");
    expect(r.severity).toBe(503);
    expect(r.action).toBe("Review");
  });
  it("due within the week", () => {
    const r = loanRow(loan(new Date("2026-09-10T00:00:00Z")), now)!;
    expect(r.title).toBe("BR-LT-0210 due in 3 d");
    expect(r.severity).toBe(LOAN_DUE_SOON_DAYS - 3);
  });
  it("due later is not on the list", () => {
    expect(loanRow(loan(new Date("2026-10-30T00:00:00Z")), now)).toBeNull();
  });
  it("section blurb names the three cases", () => {
    expect(WORK_SECTIONS.find((s) => s.id === "loans")?.blurb).toBe("Loans overdue, due this week, or with no due date.");
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `worklist.ts`:

```ts
export { DEFAULT_LOAN_DAYS } from "./lifecycle";
/** A loan due within this many days is already on the list. */
export const LOAN_DUE_SOON_DAYS = 7;
// in WORK_SECTIONS:
  { id: "loans", title: "Loans", blurb: "Loans overdue, due this week, or with no due date." },

export interface LoanLike { id: string; tag: string; model: string; loanDueAt: Date | null; holder: string | null }

const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY_MS);

/** Spec §4.3: the Loans section's one rule. Null when the loan is not due soon. */
export function loanRow(a: LoanLike, now: Date): WorkRow | null {
  const base = { key: `loans:${a.id}`, section: "loans" as const, href: `/inventory/${a.id}` };
  const holder = a.holder ?? "unassigned";
  if (a.loanDueAt === null) {
    return { ...base, title: `${a.tag} on loan with no due date`, meta: `${holder} · set a due date`, action: "Set date", severity: 1000 };
  }
  const due = a.loanDueAt.toISOString().slice(0, 10);
  const overdue = daysBetween(a.loanDueAt, now);
  if (overdue > 0) return { ...base, title: `${a.tag} overdue by ${overdue} d`, meta: `${holder} · due ${due}`, action: "Review", severity: 500 + overdue };
  const until = -overdue;
  if (until <= LOAN_DUE_SOON_DAYS) return { ...base, title: `${a.tag} due in ${until} d`, meta: `${holder} · due ${due}`, action: "Review", severity: LOAN_DUE_SOON_DAYS - until };
  return null;
}
```
`daysBetween(due, now)` for `due = 2026-09-04T00:00Z`, `now = 2026-09-07T12:00Z` is 3 (floor of 3.5) — matching the test; `due = 2026-09-10` gives −2.5 → floor −3 → `until = 3`.

- [ ] **Step 4: Query** (`home/queries.ts`) — replace the loans read with
```ts
    prisma.asset.findMany({
      where: { cls: "IT", status: "TEMPORARY" },
      orderBy: [{ loanDueAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: 50,
      select: { id: true, tag: true, model: true, loanDueAt: true, assignee: { select: { name: true } } },
    }),
```
delete the `loanAudits`/`loanSince` block and the `daysSince`-based row loop; instead
```ts
  for (const a of loans) {
    const r = loanRow({ id: a.id, tag: a.tag, model: a.model, loanDueAt: a.loanDueAt, holder: a.assignee?.name ?? null }, now);
    if (r) rows.push(r);
  }
```
Remove the now-unused imports. `e2e/direct-lifecycle.spec.ts:317` only checks the "Loans" heading — unchanged.

- [ ] **Step 5: Verify** — `npx vitest run` → 1017 passed (1011 + 5 loanRow + 1 blurb − the removed LOAN_DAYS test, count as measured); `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/worklist.ts src/lib/worklist.test.ts src/server/modules/home/queries.ts
git commit -m "feat(worklist): Loans read loanDueAt -- no date on top, overdue, due this week; the audit scan is gone"
```

---

### Task 9: Bulk assign

**Files:**
- Modify: `src/server/modules/lifecycle/actions.ts` (after `bulkChangeStatus`, ~:390), `src/components/inventory/bulk-drawer.tsx`, `src/components/inventory/inventory-table.tsx:15,250`, `src/app/(app)/inventory/page.tsx:177`

**Interfaces:**
- Consumes: `recordDirect`, `loadDirect`, `assetSelect`, `BULK_MAX`, `loanDueFor` and `defaultLoanDue` (Tasks 6-7), `ComboOption`.
- Produces:
  ```ts
  export async function bulkAssign(input: unknown): Promise<ActionResult<{ assigned: number; skipped: Array<{ tag: string; reason: string }> }>>
  // input: { ids?: string[]; filters?: string; employeeId: string; status: "DEPLOYED" | "TEMPORARY"; loanDueAt?: string; reason?: string }
  ```
  `BulkDrawer` gains `employees: ComboOption[]`; `InventoryTable` passes it through; the inventory page loads ACTIVE employees once with the same `activeEmployeeOptions()` helper `src/app/(app)/inventory/[id]/layout.tsx:50` uses (grep its import there).

- [ ] **Step 1: Action**

```ts
// ── bulkAssign ──────────────────────────────────────────────────────────────
const bulkAssignSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    filters: z.string().max(2000).optional(),
    employeeId: z.string().min(1, "Pick a person"),
    status: z.enum(["DEPLOYED", "TEMPORARY"]),
    loanDueAt: dateStr.optional(),
    reason: reasonOpt,
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filters !== undefined, { message: "Nothing is selected", path: ["ids"] });

/** Spec §5: several spares to one person, one transaction, the same record per asset a single assign writes. */
export async function bulkAssign(input: unknown): Promise<ActionResult<{ assigned: number; skipped: Array<{ tag: string; reason: string }> }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkAssignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  const due = loanDueFor(d.status, d.loanDueAt, now);
  if (!due.ok) return validationError({ loanDueAt: due.error });

  let where: Prisma.AssetWhereInput;
  if (d.ids?.length) where = { id: { in: d.ids } };
  else {
    const fp = new URLSearchParams(d.filters);
    const state: ListState = parseListState(fp, INVENTORY_LIST_CONFIG);
    const purchaseYear = parsePurchaseYear(fp.get("purchaseYear"));
    const cls = parseCls(fp.get("cls")) ?? "IT";
    const cutIds = await repairStageIds(state, purchaseYear, cls);
    where = cutIds !== null ? { id: { in: cutIds } } : buildAssetWhere(state, purchaseYear, cls);
  }

  let assigned = 0;
  const skipped: Array<{ tag: string; reason: string }> = [];
  const failure = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { name: true, employment: true } });
    if (!employee) return validationError({ employeeId: "Unknown employee" });
    if (employee.employment !== "ACTIVE") return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — assignments are frozen.`);
    const assets = await tx.asset.findMany({ where, take: BULK_MAX + 1, orderBy: [{ tag: "asc" }, { id: "asc" }], select: assetSelect });
    if (assets.length === 0) return conflict("Nothing matched the selection.");
    if (assets.length > BULK_MAX) return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
    const classes = new Set(assets.map((a) => a.cls));
    if (classes.size > 1) return conflict("Select assets of one class — IT and Purchasing assets cannot share an assignment.");
    const cls = assets[0].cls;
    if (!isDirectLifecycle(user.role, cls)) return forbidden();
    if (!(ASSIGN_TARGETS[cls] as readonly string[]).includes(d.status)) {
      return validationError({ status: `${d.status} is not an assign target for ${CLASS_PHRASE[cls]} asset.` });
    }
    for (const asset of assets) {
      const open = await openApprovalForAsset(tx, asset.id);
      if (open) { skipped.push({ tag: asset.tag, reason: `held by ${open.refNo}` }); continue; }
      const r = await recordDirect(tx, {
        actor: user, asset, now, type: "lifecycle_assign", action: "lifecycle.assign", employeeId: d.employeeId,
        change: { kind: "assign", employeeId: d.employeeId, status: d.status, loanDueAt: due.value },
        payload: { to: { assigneeId: d.employeeId, status: d.status, ...(due.value ? { loanDueAt: due.value.toISOString() } : {}) }, reason: d.reason || "bulk assigned" },
      });
      if (!r.ok) { skipped.push({ tag: asset.tag, reason: r.error }); continue; }
      assigned += 1;
    }
    return null;
  }, { timeout: 60_000, maxWait: 10_000 });
  if (failure) return failure;
  revalidatePath("/inventory");
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/");
  return ok({ assigned, skipped });
}
```
`recordDirect` already runs `humanizeGuard` on the executor's refusal, so `r.error` is the plain sentence (for example *BR-LT-0210 reads DEPLOYED, not SPARE — assignment refused*) without the `Execution guard:` prefix.

- [ ] **Step 2: Drawer** — add prop `employees: ComboOption[]`; state `const [mode, setMode] = useState<"status" | "assign">("status")`, `employeeId`, `assignKind: "DEPLOYED" | "TEMPORARY"`, `loanDueAt` (default `defaultLoanDue(new Date())`), `skippedList: Array<{ tag: string; reason: string }>`. When `direct && cls === "IT"` render a `SegmentedControl` *Change status | Assign to a person* at the top. In assign mode show *Assign to* (`EntityCombobox` over `employees`), the *Deployed | Loan* control and *Loan until*, and the optional reason; submit calls `bulkAssign({ ids/filters as today, employeeId, status: assignKind, loanDueAt: assignKind === "TEMPORARY" ? loanDueAt : undefined, reason })`. On success: toast `${assigned} asset(s) assigned to <name>` and, when `skipped.length > 0`, keep the drawer open showing `<Banner tone="attention" title={`${skipped.length} skipped`}>` with a `<ul>` of `tag — reason` and a *Done* button that closes; when none skipped, close as today. `onDone()` and `router.refresh()` run in both cases.

- [ ] **Step 3: Wiring** — `InventoryTable` gains `employees: ComboOption[]` and passes it to `<BulkDrawer employees={employees} …/>`; `inventory/page.tsx` loads `const employees = canMutate ? await activeEmployeeOptions() : [];` and passes it. The drawer's copy in assign mode: *"Assigns <scope> to one person now. Devices that are not spares, are untriaged, reserved for someone else or held by an open request are skipped and listed."*

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx eslint src/components/inventory src/server/modules/lifecycle`; dev server: select BR-MN-0910 (SPARE) and a DEPLOYED device, *Assign to a person* → 1 assigned, 1 skipped with the reason named.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/lifecycle/actions.ts src/components/inventory/bulk-drawer.tsx src/components/inventory/inventory-table.tsx "src/app/(app)/inventory/page.tsx"
git commit -m "feat(inventory): bulk assign -- several spares to one person, Deployed or Loan, skipped tags listed with reasons"
```

---

### Task 10: Shared upload rules, `invoice` kind, and one file to many assets

**Files:**
- Create: `src/server/uploads.ts`, `src/server/uploads.test.ts`, `src/lib/documents.ts`
- Modify: `src/server/modules/inventory/document-actions.ts:17-24,32-81`, `src/components/inventory/documents-panel.tsx` (its kind list)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/documents.ts
  export const DOCUMENT_KINDS = ["receipt", "accountability-form", "photo", "other", "invoice"] as const;
  // src/server/uploads.ts
  export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
  export const UPLOAD_TYPES: Record<string, string>; // ".pdf" → "application/pdf", …
  export function checkUploadMeta(meta: { name: string; type: string; size: number }): string | null  // pure; the error text or null
  export function validateUpload(value: unknown): { ok: true; file: File } | { ok: false; error: string }
  export async function storeUpload(relDir: string, file: File): Promise<{ relPath: string; checksum: string; fileName: string }>
  // document-actions.ts ("use server" — async exports only, so DOCUMENT_KINDS lives in src/lib/documents.ts)
  export async function uploadBatchDocument(formData: FormData): Promise<ActionResult<{ created: number }>>  // fields: assetIds (repeated), kind, file
  ```

- [ ] **Step 1: Failing unit test** (`src/server/uploads.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { checkUploadMeta, UPLOAD_MAX_BYTES } from "./uploads";

describe("checkUploadMeta", () => {
  it("accepts pdf, png, jpg, jpeg with matching MIME", () => {
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: 10 })).toBeNull();
    expect(checkUploadMeta({ name: "a.JPG", type: "image/jpeg", size: 10 })).toBeNull();
    expect(checkUploadMeta({ name: "a.jpeg", type: "", size: 10 })).toBeNull(); // no MIME reported: extension decides
  });
  it("refuses other extensions and MIME mismatches", () => {
    expect(checkUploadMeta({ name: "a.exe", type: "application/octet-stream", size: 10 })).toBe("That type isn't allowed. Accepted: PDF, PNG, JPG.");
    expect(checkUploadMeta({ name: "a.pdf", type: "image/png", size: 10 })).toBe("That type isn't allowed. Accepted: PDF, PNG, JPG.");
  });
  it("refuses empty and oversized files", () => {
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: 0 })).toBe("Pick a file first");
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: UPLOAD_MAX_BYTES + 1 })).toBe("Too big — the cap is 10 MB");
  });
});
```
`vitest.config.*` must include `src/server/**/*.test.ts` — `src/server/action-result.test.ts` already runs, so it does; confirm before assuming.

- [ ] **Step 2: Implement** `src/server/uploads.ts`

```ts
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

/** Pure: the same three refusals uploadDocument has always made, in one place. */
export function checkUploadMeta(meta: { name: string; type: string; size: number }): string | null {
  if (meta.size === 0) return "Pick a file first";
  if (meta.size > UPLOAD_MAX_BYTES) return "Too big — the cap is 10 MB";
  const ext = path.extname(meta.name).toLowerCase();
  if (!UPLOAD_TYPES[ext] || (meta.type && meta.type !== UPLOAD_TYPES[ext])) return "That type isn't allowed. Accepted: PDF, PNG, JPG.";
  return null;
}

export function validateUpload(value: unknown): { ok: true; file: File } | { ok: false; error: string } {
  if (!(value instanceof File)) return { ok: false, error: "Pick a file first" };
  const error = checkUploadMeta({ name: value.name, type: value.type, size: value.size });
  return error ? { ok: false, error } : { ok: true, file: value };
}

/** Writes under uploads/<relDir>/<timestamp>-<safeName>; returns the relative posix path the row stores. */
export async function storeUpload(relDir: string, file: File): Promise<{ relPath: string; checksum: string; fileName: string }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const safeName = path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const relPath = path.posix.join(relDir, `${Date.now()}-${safeName}`);
  await mkdir(path.join(process.cwd(), "uploads", ...relDir.split("/")), { recursive: true });
  await writeFile(path.join(process.cwd(), "uploads", relPath), bytes);
  return { relPath, checksum, fileName: path.basename(file.name) };
}
```

- [ ] **Step 3: Rewire `uploadDocument`** to `validateUpload(formData.get("file"))` and `storeUpload(\`assets/${assetId}\`, file)`; delete the local `ALLOWED`/`MAX_BYTES`/`KINDS`; import `DOCUMENT_KINDS` from `src/lib/documents.ts` here and in `documents-panel.tsx` (which renders the kind select). Behaviour and messages of `uploadDocument` are unchanged.

- [ ] **Step 4: `uploadBatchDocument`**

```ts
/** Spec §2.3: one invoice, stored once, one document row per unit of the batch. */
export async function uploadBatchDocument(formData: FormData): Promise<ActionResult<{ created: number }>> {
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const assetIds = [...new Set(formData.getAll("assetIds").map(String).filter(Boolean))];
  const kind = String(formData.get("kind") ?? "");
  if (assetIds.length === 0) return conflict("Missing assets.");
  if (assetIds.length > BULK_MAX) return conflict(`A batch document covers at most ${BULK_MAX} assets.`);
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, cls: true } });
  if (assets.length !== assetIds.length) return conflict("One of those assets no longer exists.");
  if (assets.some((a) => !canManageClass(user.role, a.cls))) return forbidden();

  const stored = await storeUpload("batches", checked.file);
  const created = await prisma.$transaction(async (tx) => {
    for (const a of assets) {
      const doc = await tx.assetDocument.create({
        data: { assetId: a.id, kind, fileName: stored.fileName, path: stored.relPath, checksum: stored.checksum, uploadedById: user.id },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: a.id,
        action: "document.uploaded", diff: { document: { from: null, to: doc.fileName } },
      });
    }
    return assets.length;
  });
  for (const a of assets) revalidatePath(`/inventory/${a.id}/documents`);
  return ok({ created });
}
```
`BULK_MAX` comes from `@/lib/inventory-list`. The download route needs no change: it resolves `doc.path` under `uploads/` and already refuses traversal.

- [ ] **Step 5: Verify** — `npx vitest run src/server/uploads.test.ts` (3 passed) then `npx vitest run` and `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/server/uploads.ts src/server/uploads.test.ts src/lib/documents.ts src/server/modules/inventory/document-actions.ts src/components/inventory/documents-panel.tsx
git commit -m "feat(documents): shared upload rules in src/server/uploads.ts; invoice kind; uploadBatchDocument stores once and links every unit"
```

---

### Task 11: Registration server side — suggestions, identifier check, new fields

**Files:**
- Create: `src/server/modules/inventory/tag-suggest.ts`
- Modify: `src/server/modules/inventory/actions.ts:177-190,352-364` and the create/update writes; `src/server/modules/purchases/receiving.ts` (delete `:18-43`, extend `:45-60`, `:62-64`, `:121-168`); `src/lib/asset-diff.ts:60-70` (+test); `src/lib/export-columns.ts:35-60`; `src/app/(app)/inventory/export/route.ts` (select + map the new columns); `src/app/(app)/inventory/register/page.tsx:5,34-51`

**Interfaces:**
- Produces:
  ```ts
  // tag-suggest.ts (server-only module, not "use server")
  export interface CategorySuggestion { prefixes: Array<{ prefix: string; n: number }>; highest: Record<string, number> }
  export async function tagSuggestions(categoryIds: string[]): Promise<Record<string, CategorySuggestion>>
  // actions.ts
  export async function checkIdentifiers(input: unknown): Promise<ActionResult<{ tags: string[]; serials: string[] }>>  // { tags?: string[]; serials?: string[] }
  // receiving.ts: registerAssets returns { created: number; ids: string[] }; schema gains warrantyUntil?, brand?, notes?, invoiceRef?
  // createSchema gains vendorId?, brand?, invoiceRef?; updateSchema gains brand?, invoiceRef?
  ```

- [ ] **Step 1: `tagSuggestions`** — two grouped statements instead of one per category and one per prefix:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

export interface CategorySuggestion { prefixes: Array<{ prefix: string; n: number }>; highest: Record<string, number> }

/**
 * Spec §2.1. Counts are per (category, prefix) — the form picks the category's
 * most-used prefix; the highest number is per PREFIX across the whole fleet,
 * because a tag is unique fleet-wide and one prefix may live in two categories.
 */
export async function tagSuggestions(categoryIds: string[]): Promise<Record<string, CategorySuggestion>> {
  if (categoryIds.length === 0) return {};
  const counts = await prisma.$queryRaw<Array<{ categoryId: string; prefix: string; n: bigint }>>`
    SELECT "categoryId", substring("tag", 4, 2) AS prefix, count(*) AS n
    FROM "Asset" WHERE "categoryId" IN (${Prisma.join(categoryIds)})
    GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2 ASC`;
  const prefixes = [...new Set(counts.map((c) => c.prefix))];
  const highs = prefixes.length
    ? await prisma.$queryRaw<Array<{ prefix: string; max: string | null }>>`
        SELECT substring("tag", 4, 2) AS prefix, max(substring("tag", 7, 4)) AS max
        FROM "Asset" WHERE substring("tag", 4, 2) IN (${Prisma.join(prefixes)}) GROUP BY 1`
    : [];
  const highest: Record<string, number> = Object.fromEntries(highs.filter((h) => h.max != null).map((h) => [h.prefix, Number(h.max)]));
  const out: Record<string, CategorySuggestion> = {};
  for (const id of categoryIds) out[id] = { prefixes: [], highest };
  for (const c of counts) out[c.categoryId].prefixes.push({ prefix: c.prefix, n: Number(c.n) });
  return out;
}
```
The register page replaces its two loops with `const suggestions = await tagSuggestions(categories.map((c) => c.id));` and derives the props the form still takes: `prefixCountsByCategory = Object.fromEntries(Object.entries(suggestions).map(([id, s]) => [id, s.prefixes]))`, `highestByPrefix = Object.values(suggestions)[0]?.highest ?? {}` (every entry carries the same fleet-wide map). Delete `prefixCountsForCategory` and `highestTagNumber` from `receiving.ts` and the import at `register/page.tsx:5`.

- [ ] **Step 2: `checkIdentifiers`** (in `inventory/actions.ts`)

```ts
const identifiersSchema = z.object({
  tags: z.array(z.string().trim().max(20)).max(200).optional(),
  serials: z.array(z.string().trim().max(120)).max(200).optional(),
});

/** Spec §2.4: which of these tags/serials already exist, on any asset of any class. Echoes identifiers only. */
export async function checkIdentifiers(input: unknown): Promise<ActionResult<{ tags: string[]; serials: string[] }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const parsed = identifiersSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const tags = [...new Set((parsed.data.tags ?? []).map(tagKey).filter(Boolean))];
  const serials = [...new Set((parsed.data.serials ?? []).filter(Boolean))];
  const [byTag, bySerial] = await Promise.all([
    tags.length ? prisma.asset.findMany({ where: { tag: { in: tags } }, select: { tag: true } }) : [],
    serials.length ? prisma.asset.findMany({ where: { serial: { in: serials } }, select: { serial: true } }) : [],
  ]);
  return ok({ tags: byTag.map((a) => a.tag), serials: bySerial.map((a) => a.serial as string) });
}
```
(`tagKey` from `@/lib/tag-key`.) No rate limit: it is a read on blur; it returns nothing but the caller's own strings.

- [ ] **Step 3: New columns on create/update** — `createSchema` gains `vendorId: z.string().optional()`, `brand: z.string().trim().max(60).optional()`, `invoiceRef: z.string().trim().max(60).optional()`; the `tx.asset.create` data gains `vendorId: d.vendorId || null, brand: d.brand || null, invoiceRef: d.invoiceRef || null`. `updateSchema` gains `brand`, `invoiceRef` and the patch passes them through (follow how `notes` flows into `assetDiff` and the update). In `asset-diff.ts` add `loanDueAt: toDay(before.loanDueAt)` beside `warrantyUntil` so a due-date diff never disagrees on time-of-day, and add a test mirroring the existing `warrantyUntil` day-normalisation test. Find the History field-label map (grep `"Warranty until"` under `src/lib`) and add `brand: "Brand"`, `invoiceRef: "Invoice / receipt no."`, `loanDueAt: "Loan until"` there.

- [ ] **Step 4: `registerAssets`** — schema additions `warrantyUntil: z.string().optional(), brand: z.string().trim().max(60).optional(), notes: z.string().trim().max(2000).optional(), invoiceRef: z.string().trim().max(60).optional()`; `Registered` becomes `{ created: number; ids: string[] }`. Before the transaction:
```ts
  const serials = (d.serials ?? []).map((s) => s.trim()).filter(Boolean);
  const dupSerial = serials.find((s, i) => serials.indexOf(s) !== i);
  if (dupSerial) return conflict(`Serial ${dupSerial} appears twice in this batch.`);
  if (serials.length) {
    const taken = await prisma.asset.findFirst({ where: { serial: { in: serials } }, select: { serial: true } });
    if (taken) return validationError({ serials: `Serial ${taken.serial} is already registered` });
  }
```
In the create data add `warrantyUntil: d.warrantyUntil ? new Date(d.warrantyUntil) : null, brand: d.brand || null, notes: d.notes || null, invoiceRef: d.invoiceRef || null`; collect `ids.push(asset.id)`; `done = { created, ids }`. Replace the `P2002` catch with:
```ts
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta as { target?: string[] | string } | undefined)?.target;
      const t = Array.isArray(target) ? target.join(",") : String(target ?? "");
      return t.includes("serial")
        ? validationError({ serials: "That serial is already registered" })
        : conflict("One of those tags was just taken. Reload and try again.");
    }
```

- [ ] **Step 5: Export** — `ASSET_EXPORT_COLUMNS` row type gains `brand: string | null; invoiceRef: string | null; loanDueAt: Date | null`; add `{ label: "Brand", width: 16, cell: (r) => ({ value: r.brand }) }` after *Model*, `{ label: "Invoice / receipt no.", width: 18, cell: (r) => ({ value: r.invoiceRef }) }` after *Vendor*, and a *Loan until* date column after *Warranty until* copying the exact date-cell shape *Warranty until* uses. The export route's select/map carries the three fields. `e2e/import-export.spec.ts` may assert the header row — read it and update the expected header list if it does.

- [ ] **Step 6: Verify** — `npx vitest run` and `npx tsc --noEmit`; `npx eslint src/server src/lib`.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/inventory/tag-suggest.ts src/server/modules/inventory/actions.ts src/server/modules/purchases/receiving.ts src/lib/asset-diff.ts src/lib/asset-diff.test.ts src/lib/export-columns.ts "src/app/(app)/inventory/export/route.ts" "src/app/(app)/inventory/register/page.tsx"
git commit -m "feat(registration): tagSuggestions in two grouped reads; checkIdentifiers; brand, invoiceRef and vendor at creation; batch names a clashing serial; export columns"
```

---

### Task 12: The single-asset form

**Files:**
- Modify: `src/components/inventory/asset-form.tsx`, `src/app/(app)/inventory/new/page.tsx`, `src/app/(app)/inventory/[id]/page.tsx:30-70,105-115`, `src/app/(app)/inventory/[id]/edit/page.tsx` (pass `brand`/`invoiceRef` in `initial`), `src/app/(app)/inventory/[id]/documents/page.tsx` (the `?failed=&of=` banner), `src/lib/receiving.ts` (export `RUN_REFUSAL`)
- Create: `src/components/inventory/created-notice.tsx`

**Interfaces:**
- Consumes: `tagSuggestions`, `checkIdentifiers`, `createAsset` with the new fields (Task 11); `uploadDocument`, `DOCUMENT_KINDS` (Task 10); `nextTags`, `preferredPrefix` (`src/lib/receiving.ts`).
- Produces: `AssetForm` props gain `suggestions?: Record<string, CategorySuggestion>` (new mode); `AssetFormInitial` gains `brand`, `invoiceRef`; `RUN_REFUSAL` moves from `register-form.tsx` to `src/lib/receiving.ts` (exported, same text); the record page renders `<CreatedNotice tag id />` when `?created=1`.

- [ ] **Step 1: Suggestion** — in `AssetForm`, `const [tagTouched, setTagTouched] = useState(false)` and `const [tagHint, setTagHint] = useState<string | null>(null)`; the category `Select`'s `onChange` becomes:
```ts
const categoryId = e.target.value;
const s = suggestions?.[categoryId];
const prefix = s ? preferredPrefix(s.prefixes) : null;
const run = prefix ? nextTags(prefix, s!.highest[prefix] ?? null, 1) : null;
setForm((f) => ({ ...f, categoryId, typeId: "", tag: mode === "new" && !tagTouched && run?.ok ? run.tags[0] : f.tag }));
if (mode === "new") {
  setTagHint(!categoryId ? null : !prefix ? "No tags yet for this category — type BR-XX-0000."
    : run?.ok ? `Suggested — next free number for BR-${prefix}. Edit if you need another.` : RUN_REFUSAL[run!.reason]);
}
```
The tag field's `onChange` sets `tagTouched` to `true`; its hint is `tagHint ?? "Format BR-XX-0000, as printed on the label."` in new mode.

- [ ] **Step 2: Vendor, brand, invoice ref** — move the *Vendor* `FormField` out of the `mode === "edit"` Repair card into the Procurement card (both modes); add `{field("Brand", "brand")}` after *Model* in Identity and `{field("Invoice / receipt no.", "invoiceRef")}` in Procurement. `new/page.tsx` loads `vendors` (`prisma.vendor.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })`) and `suggestions = await tagSuggestions(categories.map((c) => c.id))` and passes both. `edit/page.tsx` passes `brand`/`invoiceRef` in `initial`.

- [ ] **Step 3: Live check** — `onBlur` on Tag and Serial (new mode): debounce 300 ms via a `useRef<ReturnType<typeof setTimeout> | null>`; call `checkIdentifiers({ tags: [form.tag] })` / `({ serials: [form.serial] })`; when the value comes back in the list, `setErrors((e) => ({ ...e, tag: "Already registered" }))` (or `serial`); when it does not, delete that key. Never block submit on the check — the server's unique constraint remains the authority.

- [ ] **Step 4: Documents** — `const [files, setFiles] = useState<Array<{ file: File; kind: string }>>([])`; a *Documents* card (new mode) with `<input type="file" accept=".pdf,.png,.jpg,.jpeg" multiple>` and, per chosen file, a `Select` of `DOCUMENT_KINDS` (default `"receipt"`) and a remove button. In `submit`, after `res.ok` in new mode:
```ts
let failed = 0;
for (const { file, kind } of files) {
  const fd = new FormData(); fd.set("assetId", res.data.id); fd.set("kind", kind); fd.set("file", file);
  const up = await uploadDocument(fd);
  if (!up.ok) failed += 1;
}
router.push(failed ? `/inventory/${res.data.id}/documents?failed=${failed}&of=${files.length}` : `/inventory/${res.data.id}?created=1`);
```
The Documents tab page reads `?failed=&of=` and shows `<Banner tone="attention" title={`Registered. ${failed} of ${of} documents did not upload — add them here.`} />`.

- [ ] **Step 5: Created notice** — `created-notice.tsx`: `<Banner tone="settled" title={`${tag} registered`}><a className="text-accent underline" href={`/inventory/labels?ids=${id}`}>Print label</a></Banner>`; the record page renders it when `searchParams.created === "1"`. The record page also shows *Brand* (Identity list, after Model) and *Invoice / receipt no.* (Procurement list, after Vendor).

- [ ] **Step 6: Verify** — `npx tsc --noEmit && npx eslint src/components/inventory "src/app/(app)/inventory"`; dev server as `it@`: pick *Laptop* → tag prefilled `BR-LT-<next>`, type a seeded serial and tab away → *Already registered*; register with a vendor, brand and a PDF → record shows both fields, the Documents tab lists the PDF, the banner offers *Print label*.

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory/asset-form.tsx src/components/inventory/created-notice.tsx src/components/inventory/register-form.tsx src/lib/receiving.ts "src/app/(app)/inventory/new/page.tsx" "src/app/(app)/inventory/[id]"
git commit -m "feat(register): next-tag suggestion, vendor/brand/invoice at creation, documents uploaded on submit, live duplicate check, print-label notice"
```

---

### Task 13: The batch page and navigation

**Files:**
- Create: `src/components/inventory/register-success.tsx`
- Modify: `src/components/inventory/register-form.tsx`, `src/app/(app)/inventory/register/page.tsx` (props from Task 11), `src/lib/workspaces.ts:47-56` (+ `src/lib/workspaces.test.ts`), `src/app/(app)/inventory/page.tsx:144,211`

**Interfaces:**
- Consumes: `registerAssets` → `{ created, ids }`, `checkIdentifiers` (Task 11); `uploadBatchDocument` (Task 10); `RUN_REFUSAL` from `src/lib/receiving.ts` (Task 12).
- Produces: `RegisterSuccess({ tags, ids, cls, onAgain })`; the IT nav item `{ label: "Register several", href: "/inventory/register", roles: ["admin", "it_staff"] }` after *Inventory*; the inventory page's secondary link.

- [ ] **Step 1: Fields** — state `warrantyUntil`, `brand`, `notes`, `invoiceRef`, `invoiceFile: File | null`. When `purchasedAt` changes and `warrantyUntil` is empty, derive `+12 months` exactly as `asset-form.tsx:79-84` does (UTC, `toISOString().slice(0, 10)`). Render in the *Procurement (optional)* card: *Warranty until* (date), *Brand*, *Invoice / receipt no.*, *Notes* (textarea, `sm:col-span-2`), *Invoice document* (`<input type="file" accept=".pdf,.png,.jpg,.jpeg">`, hint *"Attached to every unit in this batch."*). Payload adds `warrantyUntil, brand, notes, invoiceRef` (each `|| undefined`).

- [ ] **Step 2: Live check** — on blur of any tag or serial cell, and before submit: `checkIdentifiers({ tags, serials: serials.filter(Boolean) })`; set `errors.tags` / `errors.serials` to `"Already registered: BR-LT-0212"` style lists (join taken values with `, `) and mark the offending inputs `invalid`. In-batch duplicate serials get `errors.serials = "Serial <value> appears twice in this batch."` client-side too. The check never blocks submit; the server refuses with the same words.

- [ ] **Step 3: Success panel** — on `res.ok`: if `invoiceFile`, build `FormData` (`assetIds` appended per id, `kind = "invoice"`, `file`) and `await uploadBatchDocument(fd)`; a failure sets `docError` shown in the panel as `<Banner tone="attention" title="Registered — the invoice did not attach. Add it from any unit's Documents tab." />`. Then swap the form for `<RegisterSuccess tags={tags} ids={res.data.ids} cls={cls} onAgain={reset} />`:
```tsx
export function RegisterSuccess({ tags, ids, cls, onAgain, children }: { tags: string[]; ids: string[]; cls: AssetClass; onAgain: () => void; children?: React.ReactNode }) {
  const range = tags.length === 1 ? tags[0] : `${tags[0]} … ${tags[tags.length - 1]}`;
  return (
    <Card>
      <CardHeader title={`${tags.length} asset${tags.length === 1 ? "" : "s"} registered — ${range}`} />
      <CardBody className="flex flex-col gap-3">
        {children}
        <div className="flex flex-wrap gap-2">
          <ButtonLink variant="primary" href={`/inventory/labels?ids=${ids.join(",")}`}>Print labels</ButtonLink>
          <ButtonLink href={"/inventory" + withClsQS("", cls)}>Open the list</ButtonLink>
          <Button onClick={onAgain}>Register another batch</Button>
        </div>
      </CardBody>
    </Card>
  );
}
```
`reset` clears every field and the tag run. The `action` prop type becomes `Promise<ActionResult<{ created: number; ids: string[] }>>`.

- [ ] **Step 4: Navigation** — add the nav item; in `workspaces.test.ts` add `it("IT can reach the batch register page", () => expect(navFor("it_staff").some((i) => i.href === "/inventory/register")).toBe(true))` using whatever helper the file already uses to flatten nav items for a role (read the file; mirror an existing assertion). On `/inventory` (`page.tsx:144` and `:211`) render beside *New asset*: `{canRegister && <ButtonLink href="/inventory/register">Register several</ButtonLink>}`.

- [ ] **Step 5: Verify** — `npx vitest run src/lib/workspaces.test.ts && npx tsc --noEmit && npx eslint src/components/inventory src/lib/workspaces.ts`; dev server as `purchasing@`: register 3 units with warranty, brand, invoice ref, notes and a PDF → success panel; *Print labels* opens the sheet with 3 labels; each unit's Documents tab lists the same file. As `it@`: *Register several* is in the nav.

- [ ] **Step 6: Commit**

```bash
git add src/components/inventory/register-form.tsx src/components/inventory/register-success.tsx src/lib/workspaces.ts src/lib/workspaces.test.ts "src/app/(app)/inventory/page.tsx" "src/app/(app)/inventory/register/page.tsx"
git commit -m "feat(register): batch page takes warranty, brand, notes, invoice ref and one invoice document for every unit; live duplicate check; success panel with Print labels; IT nav link"
```

---

### Task 14: The signed accountability form

**Files:**
- Create: `src/lib/acknowledgement.ts`, `src/lib/acknowledgement.test.ts`, `src/server/modules/employees/acknowledgement-actions.ts`, `src/app/(app)/employees/[id]/acknowledgements/[ackId]/download/route.ts`, `src/components/employees/acknowledgement-card.tsx`
- Modify: `src/app/(app)/employees/[id]/page.tsx` (fetch + card), `src/app/(app)/employees/[id]/form/page.tsx:108-110` (footer sentence)

**Interfaces:**
- Consumes: `validateUpload`, `storeUpload` (Task 10); Prisma `acknowledgement` (Task 1).
- Produces:
  ```ts
  // src/lib/acknowledgement.ts
  export interface AckItem { assetId: string; tag: string; model: string; serial: string | null }
  export function uncoveredItems<A extends { assetId: string; tag: string }>(held: A[], last: Array<{ assetId: string }> | null): A[]
  // acknowledgement-actions.ts
  export async function recordAcknowledgement(formData: FormData): Promise<ActionResult<{ id: string }>>  // employeeId, signedAt (YYYY-MM-DD), file
  ```

- [ ] **Step 1: Failing unit test**

```ts
import { describe, expect, it } from "vitest";
import { uncoveredItems } from "./acknowledgement";

const held = [{ assetId: "a", tag: "BR-LT-0001" }, { assetId: "b", tag: "BR-MN-0002" }];
describe("uncoveredItems (Phase 16 §6)", () => {
  it("no record on file: everything held is uncovered", () => {
    expect(uncoveredItems(held, null).map((h) => h.tag)).toEqual(["BR-LT-0001", "BR-MN-0002"]);
  });
  it("a full match covers everything", () => {
    expect(uncoveredItems(held, [{ assetId: "a" }, { assetId: "b" }])).toEqual([]);
  });
  it("items issued since the last signature are named", () => {
    expect(uncoveredItems(held, [{ assetId: "a" }]).map((h) => h.tag)).toEqual(["BR-MN-0002"]);
  });
});
```

- [ ] **Step 2: Implement**

```ts
export interface AckItem { assetId: string; tag: string; model: string; serial: string | null }

/** Held items the last signed form does not cover. With no form on file, all of them. */
export function uncoveredItems<A extends { assetId: string; tag: string }>(held: A[], last: Array<{ assetId: string }> | null): A[] {
  if (!last) return held;
  const covered = new Set(last.map((i) => i.assetId));
  return held.filter((h) => !covered.has(h.assetId));
}
```

- [ ] **Step 3: Action**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { storeUpload, validateUpload } from "@/server/uploads";
import { conflict, forbidden, ok, rateLimited, validationError, type ActionResult } from "@/server/action-result";
import type { AckItem } from "@/lib/acknowledgement";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Spec §6: the signed paper, recorded on the person with what they held at that moment. */
export async function recordAcknowledgement(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const employeeId = String(formData.get("employeeId") ?? "");
  const signedRaw = String(formData.get("signedAt") ?? "");
  if (!employeeId) return conflict("Missing employee.");
  if (!DAY.test(signedRaw)) return validationError({ signedAt: "Use the date picker" });
  const signedAt = new Date(`${signedRaw}T00:00:00Z`);
  if (signedAt.getTime() > Date.now()) return validationError({ signedAt: "A signing date cannot be in the future" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, assets: { select: { id: true, tag: true, model: true, serial: true }, orderBy: [{ tag: "asc" }, { id: "asc" }] } },
  });
  if (!employee) return conflict("That employee no longer exists.");
  const items: AckItem[] = employee.assets.map((a) => ({ assetId: a.id, tag: a.tag, model: a.model, serial: a.serial }));

  const stored = await storeUpload(`employees/${employeeId}`, checked.file);
  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.acknowledgement.create({
      data: { employeeId, signedAt, fileName: stored.fileName, path: stored.relPath, checksum: stored.checksum, items, recordedById: user.id },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: employeeId,
      action: "acknowledgement.recorded",
      diff: { signedAt: { from: null, to: signedAt }, items: { from: null, to: String(items.length) } },
    });
    return row.id;
  });
  revalidatePath(`/employees/${employeeId}`);
  return ok({ id });
}
```
(`items` is a JSON column: pass the array directly; Prisma accepts `InputJsonValue`. If `tsc` objects, cast with `items as unknown as Prisma.InputJsonValue`.)

- [ ] **Step 4: Download route** — copy `src/app/(app)/inventory/[id]/documents/[docId]/download/route.ts` and adapt: `requireUser()`; `prisma.acknowledgement.findUnique({ where: { id: ackId } })`; 404 when missing or `row.employeeId !== id`; resolve `path.resolve(process.cwd(), "uploads", row.path)` and refuse when it does not start with the uploads root (the same traversal guard); stream with `content-disposition: attachment; filename="<fileName>"` and the MIME from `UPLOAD_TYPES` by extension.

- [ ] **Step 5: Card** — `acknowledgement-card.tsx` (`"use client"` for the dialog only; the list can be server-rendered — split into `AcknowledgementCard` (server, receives `latest`, `history`, `uncovered`, `employeeId`, `canRecord`) and `RecordAcknowledgementDialog` (client: date default today, file input, calls `recordAcknowledgement(formData)`, toast *"Signed form recorded"*, `router.refresh()`). Card content per spec §6: *"Signed 7 Sep 2026 · 4 items covered · Download"* or *"No signed form on file"*; the `Banner tone="attention"` *"Issued since last signature: BR-LT-0211, BR-MN-0902"* when `uncovered.length > 0`; buttons *Print form* (`/employees/[id]/form`) and *Record a signed form…* when `canRecord`; `<details>` *History (N)* rows `date · items · Download`.

- [ ] **Step 6: Page** — add to the `Promise.all` `prisma.acknowledgement.findMany({ where: { employeeId: id }, orderBy: [{ signedAt: "desc" }, { id: "desc" }], take: 20 })`; `const latest = acks[0] ?? null; const uncovered = uncoveredItems(held.map((a) => ({ assetId: a.id, tag: a.tag })), latest ? (latest.items as AckItem[]) : null);` render the card under the character panel (left column) so it is visible without scrolling the loadout. The printed form's footer sentence becomes *"After signing, IT records the scan on this person's page under Accountability form."* — update the comment above it to match.

- [ ] **Step 7: Verify** — `npx vitest run src/lib/acknowledgement.test.ts` (3) then all; `npx tsc --noEmit`; dev server: record a PDF for a Finance employee → card shows the date and count; `curl -I` is not possible without a session, so check the download link in the browser saves the file; assign one more device → the *Issued since* hint names it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/acknowledgement.ts src/lib/acknowledgement.test.ts src/server/modules/employees/acknowledgement-actions.ts src/components/employees/acknowledgement-card.tsx "src/app/(app)/employees/[id]"
git commit -m "feat(employees): the signed accountability form is recorded on the person -- date, scan, items covered, issued-since hint, download"
```

---

### Task 15: End-to-end

**Files:**
- Create: `e2e/registration.spec.ts`, `e2e/custody.spec.ts`
- Modify: `e2e/direct-lifecycle.spec.ts` (only if a Loans row assertion exists — `:317` checks the heading only), `e2e/it-core.spec.ts` (assign dialog: default mode is Deployed, so existing steps hold — run and fix only what fails), `e2e/admin.spec.ts` (policy add-slot row gained a checkbox — run and fix only what fails), `e2e/axe-sweep.spec.ts` (add `/inventory/register` if absent from its route list; new dialogs are reached by existing routes)

**Interfaces:**
- Consumes: everything above. Helpers copied from `e2e/direct-lifecycle.spec.ts:24-51` (`db`, `login`, `idOf`, `highestNumber`, `tagOf`) — copy them, do not import across spec files (house rule; each file reseeds in `beforeAll`).

**Protocol (mandatory, from Phase 14/15):** every Playwright run is FOREGROUND, `E2E_PORT=3100`, `--workers=1`, one or two files per command, never backgrounded. Report each command's own pass/fail line. A flaky pass is re-run alone before it counts.

- [ ] **Step 1: `e2e/registration.spec.ts`** — six cases, `test.describe.serial`:

```ts
test("1. picking a category prefills the next free tag for its most-used prefix", async ({ page }) => {
  const next = tagOf("LT", (await highestNumber("LT")) + 1);
  await login(page, IT);
  await page.goto("/inventory/new");
  await page.getByLabel("Category").selectOption({ label: "Laptop" });
  await expect(page.getByLabel("Asset tag")).toHaveValue(next);
  await expect(page.getByText("Suggested — next free number for BR-LT. Edit if you need another.")).toBeVisible();
  await page.getByLabel("Asset tag").fill(tagOf("LT", 9000)); // still editable
  await expect(page.getByLabel("Asset tag")).toHaveValue("BR-LT-9000");
});

test("2. vendor, brand and a document chosen at creation land on the record", async ({ page }) => {
  const tag = tagOf("LT", (await highestNumber("LT")) + 1);
  await login(page, IT);
  await page.goto("/inventory/new");
  await page.getByLabel("Category").selectOption({ label: "Laptop" });
  await page.getByLabel("Model").fill("ThinkPad E14 (e2e reg)");
  await page.getByLabel("Brand").fill("Lenovo");
  await page.getByLabel("Vendor").selectOption({ label: "TechServe PH" });
  await page.getByLabel(/Documents/).setInputFiles({ name: "quote.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
  await page.getByRole("button", { name: "Register asset" }).click();
  await expect(page).toHaveURL(/\/inventory\/[^/?]+\?created=1$/, { timeout: 30_000 });
  await expect(page.getByText(`${tag} registered`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Print label" })).toHaveAttribute("href", /\/inventory\/labels\?ids=/);
  await expect(page.getByText("Lenovo")).toBeVisible();
  await expect(page.getByText("TechServe PH")).toBeVisible();
  const asset = await db.asset.findUniqueOrThrow({ where: { tag }, include: { documents: true } });
  expect(asset.brand).toBe("Lenovo");
  expect(asset.documents.map((d) => d.fileName)).toEqual(["quote.pdf"]);
  expect(await db.auditEntry.count({ where: { entityType: "asset", entityId: asset.id, action: "document.uploaded" } })).toBe(1);
});

test("3. a seeded serial is flagged as already registered before submit", async ({ page }) => {
  const seeded = await db.asset.findFirstOrThrow({ where: { serial: { not: null }, cls: "IT" }, select: { serial: true } });
  await login(page, IT);
  await page.goto("/inventory/new");
  await page.getByLabel("Serial").fill(seeded.serial!);
  await page.getByLabel("Model").click(); // blur
  await expect(page.getByText("Already registered")).toBeVisible({ timeout: 10_000 });
});

test("4. the batch page registers 3 units with the Purchasing fields and one invoice on each", async ({ page }) => {
  await login(page, P);
  await page.goto("/inventory/register");
  await page.getByLabel("Category").selectOption({ label: "Vehicle" });
  await page.getByLabel("Model").fill("Toyota Vios (e2e batch)");
  await page.getByLabel("Quantity").fill("3");
  await page.getByLabel("Purchased").fill("2026-09-01");
  await expect(page.getByLabel("Warranty until")).toHaveValue("2027-09-01");
  await page.getByLabel("Brand").fill("Toyota");
  await page.getByLabel("Invoice / receipt no.").fill("INV-2026-0912");
  await page.getByLabel("Notes").fill("fleet renewal");
  await page.getByLabel("Invoice document").setInputFiles({ name: "inv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 inv") });
  const tags = await Promise.all([1, 2, 3].map((i) => page.getByLabel(`Tag ${i}`).inputValue()));
  await page.getByRole("button", { name: "Register 3 assets" }).click();
  await expect(page.getByText(/3 assets registered/)).toBeVisible({ timeout: 30_000 });
  const ids = (await db.asset.findMany({ where: { tag: { in: tags } }, select: { id: true } })).map((a) => a.id);
  await expect(page.getByRole("link", { name: "Print labels" })).toHaveAttribute("href", `/inventory/labels?ids=${ids.join(",")}`);
  const rows = await db.asset.findMany({ where: { tag: { in: tags } }, include: { documents: true } });
  for (const r of rows) {
    expect(r.brand).toBe("Toyota"); expect(r.invoiceRef).toBe("INV-2026-0912"); expect(r.notes).toBe("fleet renewal");
    expect(r.warrantyUntil?.toISOString().slice(0, 10)).toBe("2027-09-01");
    expect(r.documents.map((d) => d.kind)).toEqual(["invoice"]);
  }
  expect(new Set(rows.flatMap((r) => r.documents.map((d) => d.path))).size).toBe(1); // stored once
});

test("5. duplicate serials are refused by name, and a seeded serial as a serial", async ({ page }) => {
  const seeded = await db.asset.findFirstOrThrow({ where: { serial: { not: null } }, select: { serial: true } });
  await login(page, P);
  await page.goto("/inventory/register");
  await page.getByLabel("Category").selectOption({ label: "Vehicle" });
  await page.getByLabel("Model").fill("Dup test");
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Serial 1").fill("SAME-1"); await page.getByLabel("Serial 2").fill("SAME-1");
  await page.getByLabel("Model").click();
  await expect(page.getByText("Serial SAME-1 appears twice in this batch.")).toBeVisible();
  await page.getByLabel("Serial 2").fill(seeded.serial!);
  await page.getByLabel("Model").click();
  await expect(page.getByText(`Already registered: ${seeded.serial}`)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Register 2 assets" }).click();
  await expect(page.getByText(`Serial ${seeded.serial} is already registered`)).toBeVisible();
});

test("6. IT's navigation reaches the batch page", async ({ page }) => {
  await login(page, IT);
  await page.goto("/inventory");
  await page.getByRole("link", { name: "Register several" }).first().click();
  await expect(page).toHaveURL(/\/inventory\/register$/);
  await expect(page.getByRole("heading", { name: "Register assets" })).toBeVisible();
});
```
Read the batch page's submit button text before writing case 4/5 (`register-form.tsx` renders `Register N assets` or similar — use the real string). The `Vehicle` category is Purchasing-class; `purchasing@` may register it.

- [ ] **Step 2: `e2e/custody.spec.ts`** — six cases, `test.describe.serial`, sign-in `IT` unless stated. Fixtures: `Finance standard` policy applies to the Finance department; pick a Finance employee by `db.employee.findFirstOrThrow({ where: { department: { name: "Finance" }, employment: "ACTIVE" } })`. Seeded loans: BR-LT-0210 (EMP-0095) and BR-PH-0287 (EMP-0042) are TEMPORARY with `loanDueAt` null.

```ts
test("7. a loaner slot fills only from a TEMPORARY device", async ({ page }) => {
  const laptopType = await db.assetType.findFirstOrThrow({ where: { name: "Laptop" } });
  const emp = await db.employee.findFirstOrThrow({ where: { employeeNo: "EMP-0095" } }); // holds BR-LT-0210 on loan
  await login(page, ADMIN);
  await page.goto("/admin/equipment-policies");
  // add a loaner laptop slot to the policy that applies to EMP-0095 (create a title policy for their title if none applies)
  … (use the editor: name "loaner laptop", type Laptop, tick "loaner slot", Add slot) …
  await page.goto(`/employees/${emp.id}`);
  const tile = page.getByRole("group", { name: /loaner laptop/ });
  await expect(tile.getByText("BR-LT-0210")).toBeVisible();
  await expect(tile.getByText("LOAN")).toBeVisible();
});
```
Write case 7 against the real DOM (read `loadout-view.tsx`'s tile markup for its accessible name), and cases 8–12 from spec §9.2 rows 8–12 the same way:
- 8: waive `headset` on a Finance employee → the *Waived for this person (1)* details lists it, the missing count in the progress line drops by one; *Restore* brings it back; *Add a slot for this person…* with name `tablet` → tile with `EXCEPTION` pill; hover/tooltip text equals the reason; DB: `employeeSlotException` rows and `policy.exception.*` audit entries.
- 9: on BR-MN-0910's record → *Assign* → *Loan* → date → *Confirm*; record shows *On loan until*; DB `loanDueAt` equals the date; *Return* → *Confirm*; DB `loanDueAt` null.
- 10: `db.asset.update` BR-PH-0287 `loanDueAt = yesterday`; `/inventory/work` shows `BR-PH-0287 overdue by 1 d` and `BR-LT-0210 on loan with no due date` above it with action *Set date*.
- 11: select three spares in `/inventory` (BR-MN-0910 plus two more SPARE tags from the seed; first set one of them `returnedAt = now` via Prisma so it is untriaged) → *Bulk actions…* → *Assign to a person* → pick an ACTIVE employee → *Confirm*; the drawer reports *2 assigned · 1 skipped* naming the untriaged tag with "back but not yet triaged"; DB: two `EXECUTED` `lifecycle_assign` rows and two `lifecycle.assign` audit entries for those ids; zero open approvals.
- 12: on a Finance employee → *Record a signed form…* → date today, PDF → card shows *Signed <date> · N items covered*; `page.request.get(downloadHref)` → status 200 and `content-disposition` contains `attachment`; assign one more spare to them → the *Issued since last signature:* banner names that tag.

- [ ] **Step 3: Run the new files** — `E2E_PORT=3100 npx playwright test e2e/registration.spec.ts e2e/custody.spec.ts --workers=1 --global-timeout=540000` (foreground). Fix until green; a case that cannot reach its spec row is a **report item**, never a weakened assertion.

- [ ] **Step 4: Run the touched existing files** — `E2E_PORT=3100 npx playwright test e2e/it-core.spec.ts e2e/direct-lifecycle.spec.ts e2e/admin.spec.ts --workers=1 --global-timeout=540000`, then `e2e/axe-sweep.spec.ts` alone with `--global-timeout=1200000`. Fix failures caused by this phase's UI changes (a new control in a dialog, a moved Vendor field) by updating locators, never by removing assertions.

- [ ] **Step 5: Commit** (message states the real counts from `npx playwright test --list`)

```bash
git add e2e
git commit -m "test(e2e): Phase 16 -- registration.spec (6) and custody.spec (6); existing specs follow the new dialogs"
```

---

### Task 16: Full battery, docs, close-out

**Files:**
- Modify: `docs/HANDOVER.md` (§0 header line; new item **(i)** after (h) at ~:266-275; §7 counts), `docs/PICKUP.md` (Battery row, Last two phases row, §3 decisions, §4 next steps, §5 gaps), the spec's **Status** line, this plan's `D-` block (if any amendments accrued)

- [ ] **Step 1: The battery, five foreground chunks** (each its own command, `E2E_PORT=3100`, `--workers=1`):
```bash
npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts e2e/department-owned.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/receiving.spec.ts e2e/asset-classes.spec.ts e2e/direct-lifecycle.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/scanner.spec.ts e2e/labels.spec.ts e2e/registration.spec.ts e2e/custody.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```
Record each chunk's count and time. Then `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx playwright test --list | tail -1`. Fix anything red; re-run the affected chunk.

- [ ] **Step 2: Docs** — HANDOVER header: Phase 16 code-complete on its branch, counts; item **(i)** in the §0 style of (h): the core shape (one migration; `effectiveSlots` and the loaner rule; `loanDueAt` in the executor; `bulkAssign`; `uploads.ts`; `Acknowledgement`), why (decisions 7–11 of the spec), what remains (merge/push; Phase 17 scale sweep). PICKUP: Battery row and *Last two phases* row (Phase 15 → Phase 16 summary, Phase 15 becomes the earlier entry); §4: Phase 17 is next; §5: note the accepted `checkIdentifiers` existence leak and that `bulkChangeStatus` still returns a bare skipped count. Spec Status line: *implemented on branch `phase-16-registration-custody`, <date>*.

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOVER.md docs/PICKUP.md docs/superpowers/specs/2026-09-07-it-registration-custody-design.md docs/superpowers/plans/2026-09-07-phase-16-registration-custody.md
git commit -m "docs(phase-16): HANDOVER (i), PICKUP battery and next steps, spec status; battery <unit> unit / <files> · <e2e> e2e / 18 files"
```

---

## Self-review (run by the plan author before Task 1)

**Spec coverage.** §2.1 → T11 S1, T12 S1, T13; §2.2 → T11 S3, T12; §2.3 → T11 S4, T13; §2.4 → T11 S2, T12 S3, T13 S2; §2.5 → T10; §2.6 → T12/T13; §2.7 → T13 S4; §3.1 → T2, T3; §3.2 → T1, T4; §3.3 → T2; §3.4 → T5, T7 S3; §4.1 → T1, T6 S4-5; §4.2 → T6 S6, T7; §4.3 → T8; §5 → T9; §6 → T1, T14; §8 → T1; §9.1 → T2, T6, T8, T10, T11, T14; §9.2 → T15; docs → T16.

**Type consistency.** `SlotLike.loaner` (T2) is required, so every Prisma select feeding `computeLoadout` adds `loaner: true` (T2 S4) and `resolvePolicy`'s policies carry full slot rows (T4). `LifecycleChange.assign.loanDueAt: Date | null` (T6) is what T9's `bulkAssign` passes (`due.value`). `registerAssets` returns `{ created, ids }` (T11) and `RegisterForm`'s `action` type follows (T13). `RUN_REFUSAL` moves to `src/lib/receiving.ts` in T12 and T13 imports it from there. `DOCUMENT_KINDS` lives in `src/lib/documents.ts` (T10) and T12 imports it there. `DEFAULT_LOAN_DAYS` and `defaultLoanDue` live in `src/lib/lifecycle.ts` (T6/T7); `worklist.ts` re-exports the constant (T8).

**Known judgement calls, for the ledger.** Documents on the single form upload after the create (spec decision 4), so a failed upload cannot roll back the asset — the banner tells IT where to add it. `checkIdentifiers` has no rate limit (blur-driven read). Task 15 case 7 is written against the real DOM by its implementer; its assertions must still prove spec row 7 (loaner fills from TEMPORARY, standard slot stays empty).
