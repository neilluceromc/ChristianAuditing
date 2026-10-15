# Phase 37 — Client staff, policies per client, a better profile, 3-step Add employee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees can be internal staff (departments) or client staff (clients), and each client or department has
its own equipment policy on a master-detail page. The profile becomes equal tiles with a side panel, notes and IT
setup. Add a slot asks category then type, and Add employee becomes three steps.

**Architecture:**
- **Clients are `Department` rows** with `kind = CLIENT` and an `archivedAt`. Every relation keeps working; the UI
  reads `kind` to say "Client", and pickers list active rows only.
- **Pure rules** live in `src/lib/`, each with a vitest file beside it:
  - `slotLabel`, `numberSlotLabels` and the new `resolvePolicy` order (`loadout.ts`);
  - group filters and pickers (`groups.ts`);
  - policy line diffing (`policy-lines.ts`);
  - note permissions and setup values (`employee-notes.ts`, `it-setup.ts`).
- **Server actions** follow the house pipeline. One migration (32) adds the columns, the `EmployeeNote` table and a
  guarded slot-name rewrite.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / Postgres 16, zod 4, vitest (pure), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-16-clients-and-profile-design.md` (`0cafcf1`). Read it first; it is the
authority. The mockups are on the canvas https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz (boards Main, AddSlot,
NewHire, Org and Policies). Implementers cannot open it, so every value they need is in this plan.

## Global Constraints

**Where the work happens**
- Do the work in the worktree `.claude/worktrees/phase-37-clients-profile`, on branch `phase-37-clients-profile`.
- `.env` there points at `inventory_dev` with `APP_BASE_URL=http://192.168.1.193:3100`, and has no `SEED_PASSWORD`
  or `QUICK_LOGIN_EMAILS`.
- Never read or print `.env`. Never touch the `inventory` database or port 3000.
- Dev server: `npm run dev -- -p 3100`, never 3000. Only one implementer walks a dev server at a time.

**Database and migrations**
- Apply migrations with `npx prisma migrate deploy` only. Never run `prisma migrate dev` or `prisma migrate reset`.
- `npm run db:seed` runs only on `inventory_dev`, last after e2e work.

**Playwright**
- Run it in the **foreground only**: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`,
  with a Bash timeout of 600000.
- Never use `run_in_background` or the Monitor tool. One process at a time.
- Check port 3100 before and after each run (`netstat -ano | grep ":3100 " | grep LISTEN`).

**Git**
- Never amend. Never run `git stash`, `checkout`, `restore`, `reset` or `switch`.
- `git add` new files before a pathspec commit. Commit trailer exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Repo files are CRLF and UTF-8. Use the Edit tool (never `sed -i`). New files are CRLF.
- Python that touches files must use `open(..., encoding="utf-8", newline="")`.

**House rules**
- Server actions follow `actionRole(...)` → `checkRate(user.id[, "check"])` → zod → one `prisma.$transaction`
  with `writeAudit(tx, …)` inside it.
- State changes are state-guarded (`updateMany` with the expected state in `where`, then check `count`).
- `AuditEntry` is append-only.
- Product aria-labels near a field never contain that field's label word.
- UI copy uses they/them, never gendered pronouns.

**Spec values (verbatim)**
- **Enums:** `GroupKind { INTERNAL CLIENT }` and `SetupState { DONE NOT_YET NOT_NEEDED }`.
- **Migration 32** is `20261016180000_clients_profile`.
- **Slot label:** the type name when the category name is "other" (case-insensitive); otherwise the category name.
  Repeats are numbered "Monitor", "Monitor 2", "Monitor 3".
- **Name clash:** "A department or client with that name already exists".
- **Archived target:** "That department or client is archived".
- **Import block cause `archived-department`:** "{name} is archived — restore it first or pick another".
- **Policy refusals:**
  - "Add at least one item, or remove the policy"
  - "{group} already has a policy"
  - "{group} already has a rule for {title}"
  - "Unknown asset type"
- **Policy names:** base = "{group name}"; title rule = "{group name} · {title}". On a clash, " (2)", " (3)" … is
  added.
- **Limits:**
  - policy lines 1–20;
  - copy targets 1–60;
  - title 2–120;
  - group name 2–60;
  - note 1–2000 ("Write a note first" / "At most 2000 characters");
  - VPN 1–40 ("Name the VPN" / "At most 40 characters");
  - assign list ≤ 20, distinct ("Each spare can be picked once");
  - spares per type ≤ 50.
- **VPN choices:** "None", "Cloudflare WARP", "OpenVPN", "Other…" (free text).
- **Reason chips:**
  - `policy.exception.add`: "Role needs it", "Client requirement", "Remote work setup", "Accessibility need";
  - `policy.exception.waive`: "Not needed for this role", "Uses own device", "Client provides it".
- **Seed clients:**
  - **"Bluepeak Telecom"**, with a base policy named "Bluepeak Telecom":
    1. Workstation (PC)/Mini PC
    2. Monitor/24-inch
    3. Monitor/24-inch
    4. Headset/Wired

    All four lines are required.
  - **"Harborline Billing"**, with no policy.
  - No new employees.

## Review Focus

1. **A client is ended while someone has Add employee open, and they then press Create.** The server refuses with
   "That department or client is archived", and nothing is created. *(Task 10 e2e.)*
2. **A policy with two Monitor lines.** The profile shows "Monitor" and "Monitor 2" tiles, and two different monitors
   fill them. *(Task 1 unit on `numberSlotLabels`; Task 8 e2e on the seeded Finance standard, whose two monitor lines
   become "Monitor"/"Monitor 2".)*
3. **Saving a policy that drops a line someone had waived.** The slot is deleted, its waiver cascades away, and the
   profile renders without the waived-slot row. *(Task 4 unit on `planSlotChanges`; Task 5 e2e removes a line from a
   policy with a waiver.)*
4. **The same spare chosen twice, or a spare taken between steps.**
   - The UI disables an asset already picked on another line.
   - The server refuses duplicates with "Each spare can be picked once".
   - A spare taken meanwhile shows on the created notice as "{tag} could not be assigned: {reason}", and the person
     still exists.

   *(Task 10 unit on the schema; e2e for the notice.)*
5. **A note of only spaces, or of 2001 characters.** It is refused with "Write a note first" / "At most 2000
   characters", and nothing is written. *(Task 6 unit on `noteSchema`.)*

## Decisions taken in this plan
- **P-1.** Clients reuse `Department` (spec ruling 1). The Departments page gets its own component; `RefTable` stays
  for categories and types.
- **P-2.** Group filters on the Departments page run in the browser over all rows (spec §2.2). The Equipment
  policies page keeps the selected group in `?group=` and loads only that group's detail on the server.
- **P-3.** `previewPolicy` gains the lines, and `PolicyPreview` stays only for the edit page (Title changes). The
  wizard has its own panel component.
- **P-4.** Pickers share one helper, `groupPickerOptions`, rendered as `<optgroup>`s by a small
  `GroupSelectOptions` component.
- **P-5.** `loadout-view.tsx` (1091 lines) is split as part of Task 8:
  - tiles go to `equipment-tile.tsx`;
  - the side panel goes to `held-item-panel.tsx`;
  - the view keeps the dialogs and their orchestration.

---

### Task 1: Migration 32, schema, seed, slot labels and the policy order

**Files:**
- Modify: `prisma/schema.prisma` (Department, Employee, User, the new enums, `EmployeeNote`)
- Create: `prisma/migrations/20261016180000_clients_profile/migration.sql`
- Modify: `prisma/seed.ts` (departments get `kind`; the two clients; Bluepeak's policy; slot names from `slotLabel`)
- Modify: `src/lib/loadout.ts`, `src/lib/loadout.test.ts`

**Interfaces:**
- Produces:
  - `slotLabel(categoryName: string, typeName: string): string`
  - `numberSlotLabels(labels: string[]): string[]`
  - `resolvePolicy` with the new order (signature unchanged)
  - Prisma models `Department.kind` / `archivedAt`, `Employee.entraStatus` / `autopilotStatus` / `argusStatus` /
    `vpn`, and `EmployeeNote`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/loadout.test.ts`):

```ts
import { numberSlotLabels, resolvePolicy, slotLabel } from "./loadout";

describe("slotLabel", () => {
  it("uses the category name", () => {
    expect(slotLabel("Monitor", "24-inch")).toBe("Monitor");
    expect(slotLabel("Workstation (PC)", "Mini PC")).toBe("Workstation (PC)");
  });
  it("uses the type name inside Other, any case", () => {
    expect(slotLabel("Other", "Docking Station")).toBe("Docking Station");
    expect(slotLabel(" other ", "Phone")).toBe("Phone");
  });
});

describe("numberSlotLabels", () => {
  it("leaves unique labels alone", () => {
    expect(numberSlotLabels(["Laptop", "Monitor"])).toEqual(["Laptop", "Monitor"]);
  });
  it("numbers repeats in order", () => {
    expect(numberSlotLabels(["Monitor", "Laptop", "Monitor", "Monitor"])).toEqual(["Monitor", "Laptop", "Monitor 2", "Monitor 3"]);
  });
  it("counts case-insensitively but keeps the first spelling", () => {
    expect(numberSlotLabels(["Monitor", "monitor"])).toEqual(["Monitor", "monitor 2"]);
  });
});

describe("resolvePolicy order (Phase 37)", () => {
  const base = { id: "b", name: "Acme", appliesToTitle: null, appliesToDepartmentId: "acme" };
  const rule = { id: "r", name: "Acme · Team Lead", appliesToTitle: "Team Lead", appliesToDepartmentId: "acme" };
  const otherRule = { id: "o", name: "Zen · Team Lead", appliesToTitle: "Team Lead", appliesToDepartmentId: "zen" };
  const global = { id: "g", name: "Leads", appliesToTitle: "team lead", appliesToDepartmentId: null };
  it("a group title rule beats a global title policy", () => {
    expect(resolvePolicy({ title: " team lead ", departmentId: "acme" }, [global, base, otherRule, rule])?.id).toBe("r");
  });
  it("a global title policy beats the group base", () => {
    expect(resolvePolicy({ title: "Team Lead", departmentId: "acme" }, [base, global])?.id).toBe("g");
  });
  it("another group's title rule never applies", () => {
    expect(resolvePolicy({ title: "Team Lead", departmentId: "acme" }, [otherRule, base])?.id).toBe("b");
  });
  it("falls back to null", () => {
    expect(resolvePolicy({ title: "Agent", departmentId: "none" }, [base, rule])).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/loadout.test.ts`. Expected: FAIL (`slotLabel` is not exported, and the order test
fails).

- [ ] **Step 3: Implement in `src/lib/loadout.ts`**

```ts
/** Phase 37 (spec §3.2): the label a slot shows — the type inside "Other", else the category. */
export function slotLabel(categoryName: string, typeName: string): string {
  return categoryName.trim().toLowerCase() === "other" ? typeName : categoryName;
}

/** Phase 37 (spec §3.2): repeats become "Monitor 2", "Monitor 3" … in order; counted case-insensitively. */
export function numberSlotLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const key = label.trim().toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? label : `${label} ${n}`;
  });
}
```

Then replace the body of `resolvePolicy`, and update its doc comment to the spec §3.1 order:

```ts
  const title = employee.title.trim().toLowerCase();
  const titleMatch = (p: P) => p.appliesToTitle?.trim().toLowerCase() === title;
  return (
    policies.find((p) => p.appliesToDepartmentId === employee.departmentId && titleMatch(p)) ??
    policies.find((p) => p.appliesToDepartmentId === null && titleMatch(p)) ??
    policies.find((p) => p.appliesToDepartmentId === employee.departmentId && !p.appliesToTitle) ??
    null
  );
```

- [ ] **Step 4: Update the schema** (`prisma/schema.prisma`)

New enums, placed after `EmploymentStatus`:

```prisma
enum GroupKind {
  INTERNAL
  CLIENT
}

enum SetupState {
  DONE
  NOT_YET
  NOT_NEEDED
}
```

**`Department`** gains:

```prisma
  /// Phase 37 (spec §2.1): a client is a Department row with kind CLIENT.
  kind          GroupKind          @default(INTERNAL)
  /// Phase 37: null = active; set = archived (internal) / ended (client). History and people stay.
  archivedAt    DateTime?
```

**`Employee`** gains:

```prisma
  /// Phase 37 (spec §4.6): IT setup checklist; null = not recorded.
  entraStatus      SetupState?
  autopilotStatus  SetupState?
  argusStatus      SetupState?
  /// "None" | "Cloudflare WARP" | "OpenVPN" | any other name (1–40); null = not recorded.
  vpn              String?
  notes            EmployeeNote[]
```

**`User`** gains `employeeNotes EmployeeNote[]`. Add the new model after `EmployeeTransfer`:

```prisma
/// Phase 37 (spec §4.5): a dated note on a person. The author edits their own; Admin may delete any.
model EmployeeNote {
  id         String    @id @default(cuid())
  employeeId String
  employee   Employee  @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  authorId   String
  author     User      @relation(fields: [authorId], references: [id], onDelete: Restrict)
  text       String
  createdAt  DateTime  @default(now())
  editedAt   DateTime?

  @@index([employeeId, createdAt])
}
```

- [ ] **Step 5: Write the migration** `prisma/migrations/20261016180000_clients_profile/migration.sql` (CRLF):

```sql
-- Phase 37 (spec §6): clients as Department rows, IT setup on Employee, EmployeeNote, derived slot names.
CREATE TYPE "GroupKind" AS ENUM ('INTERNAL', 'CLIENT');
CREATE TYPE "SetupState" AS ENUM ('DONE', 'NOT_YET', 'NOT_NEEDED');

ALTER TABLE "Department" ADD COLUMN "kind" "GroupKind" NOT NULL DEFAULT 'INTERNAL',
                         ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Employee" ADD COLUMN "entraStatus" "SetupState",
                       ADD COLUMN "autopilotStatus" "SetupState",
                       ADD COLUMN "argusStatus" "SetupState",
                       ADD COLUMN "vpn" TEXT;

CREATE TABLE "EmployeeNote" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    CONSTRAINT "EmployeeNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeNote_employeeId_createdAt_idx" ON "EmployeeNote"("employeeId", "createdAt");
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data only, re-runnable: slot names come from the category (or the type, inside Other). No audit rows.
UPDATE "PolicySlot" s
   SET "name" = CASE WHEN lower(trim(c."name")) = 'other' THEN t."name" ELSE c."name" END
  FROM "AssetType" t JOIN "AssetCategory" c ON c."id" = t."categoryId"
 WHERE s."assetTypeId" = t."id";

UPDATE "EmployeeSlotException" e
   SET "name" = CASE WHEN lower(trim(c."name")) = 'other' THEN t."name" ELSE c."name" END
  FROM "AssetType" t JOIN "AssetCategory" c ON c."id" = t."categoryId"
 WHERE e."assetTypeId" = t."id" AND e."kind" = 'ADD';
```

- [ ] **Step 6: Apply, regenerate and check for drift**

Run:

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: the migration applies, and the diff exits 0 (no drift). If the diff shows a difference (index name,
column order of FKs), fix the SQL in this unapplied-on-staging migration so the diff is empty. Because the migration
is already applied on `inventory_dev`, re-create that database by running `npx prisma migrate deploy` against a
fresh DB only if needed. Ask the controller first; never `migrate reset`.

- [ ] **Step 7: Seed**

In `prisma/seed.ts`:
- **Departments:** existing departments stay INTERNAL. After them, upsert two `kind: "CLIENT"` rows: "Bluepeak
  Telecom" and "Harborline Billing".
- **Bluepeak's policy:** create an `EquipmentPolicy` named "Bluepeak Telecom" (`appliesToDepartmentId` = Bluepeak)
  with four required, non-loaner slots, in order:
  1. Workstation (PC)/Mini PC
  2. Monitor/24-inch
  3. Monitor/24-inch
  4. Headset/Wired

  Each slot's `name` = `slotLabel(category, type)`.
- **Finance standard:** its slots' `name`s also come from `slotLabel`. Import it from `../src/lib/loadout`; the seed
  already imports from `src/lib`.

Keep every existing seeded row and count otherwise unchanged.

- [ ] **Step 8: Run the tests and typecheck**

Run: `npx vitest run src/lib/loadout.test.ts && npx tsc --noEmit`. Expected: PASS. Fix any compile error caused by
the new required relation fields. None is expected: all new fields are optional or have defaults.

Run `npm run db:seed` once on `inventory_dev`. Expected: it completes. Then run `npx vitest run`. Expected: all
pass, or only failures that name slot names (old "laptop"/"second monitor" fixtures). Fix those tests to the new
labels.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261016180000_clients_profile prisma/seed.ts src/lib/loadout.ts src/lib/loadout.test.ts
git commit -m "feat(model): clients as Department kind, IT setup fields, EmployeeNote, derived slot labels (migration 32); resolvePolicy: group title rule > global title > group base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Departments & clients page

**Files:**
- Create: `src/lib/groups.ts`, `src/lib/groups.test.ts`
- Create: `src/server/modules/admin/group-actions.ts`
- Create: `src/components/admin/groups-page.tsx` (client component)
- Modify: `src/app/(app)/admin/departments/page.tsx`
- Modify: `src/lib/workspaces.ts` (nav label "Departments & clients"); `src/lib/workspaces.test.ts` if it asserts the
  label
- Modify: `src/lib/activity.ts`, `src/lib/activity.test.ts` (sentences and `ACTION_LABELS`)
- Modify: `e2e/admin.spec.ts` (department cases), `e2e/axe-sweep.spec.ts` (the page still listed)

**Interfaces:**
- Consumes: `Department.kind` / `archivedAt` (Task 1).
- Produces (`src/lib/groups.ts`):

```ts
export type GroupKindValue = "INTERNAL" | "CLIENT";
export interface GroupRow { id: string; name: string; kind: GroupKindValue; archivedAt: string | null; locked: boolean; people: number; policyItems: number | null }
export type GroupShow = "active" | "nopol" | "ended" | "all";
export function filterGroups(rows: GroupRow[], f: { kind: GroupKindValue; q: string; show: GroupShow }): GroupRow[];
export function sortGroups(rows: GroupRow[], sort: "name" | "people", dir: 1 | -1): GroupRow[];
export function showCounts(rows: GroupRow[], kind: GroupKindValue): Record<GroupShow, number>;
export interface PickerGroup { id: string; name: string; kind: GroupKindValue; archivedAt: Date | string | null }
/** Active rows of each kind, sorted by name (natural); `keepId` is kept even when archived (an edit form's current value). */
export function groupPickerOptions<G extends PickerGroup>(rows: G[], keepId?: string | null): { internal: G[]; client: G[] };
export const GROUP_NAME_TAKEN = "A department or client with that name already exists";
export const GROUP_ARCHIVED = "That department or client is archived";
```

- Server actions (`group-actions.ts`):
  - `createGroup({kind, name})`
  - `renameGroup({id, name})`
  - `setGroupArchived({id, archived})`

  Each returns `ActionResult<{ id: string }>`.

- [ ] **Step 1: Write failing tests** `src/lib/groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterGroups, groupPickerOptions, showCounts, sortGroups, type GroupRow } from "./groups";

const row = (o: Partial<GroupRow> & { name: string }): GroupRow => ({ id: o.name, kind: "CLIENT", archivedAt: null, locked: false, people: 0, policyItems: null, ...o });
const rows = [
  row({ name: "[Client 10]", people: 5, policyItems: 3 }),
  row({ name: "[Client 2]", people: 9 }),
  row({ name: "[Client 3]", archivedAt: "2026-10-01T00:00:00.000Z" }),
  row({ name: "Finance", kind: "INTERNAL", people: 4, policyItems: 6 }),
];

describe("filterGroups", () => {
  it("Active hides archived and the other kind", () => {
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "active" }).map((r) => r.name)).toEqual(["[Client 10]", "[Client 2]"]);
  });
  it("No policy is active rows without a policy", () => {
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "nopol" }).map((r) => r.name)).toEqual(["[Client 2]"]);
  });
  it("Ended is archived only; All is everything of the kind", () => {
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "ended" }).map((r) => r.name)).toEqual(["[Client 3]"]);
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "all" })).toHaveLength(3);
  });
  it("search is a case-insensitive substring, trimmed", () => {
    expect(filterGroups(rows, { kind: "INTERNAL", q: "  FIN ", show: "all" }).map((r) => r.name)).toEqual(["Finance"]);
  });
});

describe("sortGroups", () => {
  it("sorts names naturally", () => {
    expect(sortGroups(rows.slice(0, 3), "name", 1).map((r) => r.name)).toEqual(["[Client 2]", "[Client 3]", "[Client 10]"]);
  });
  it("sorts people descending", () => {
    expect(sortGroups(rows.slice(0, 2), "people", -1).map((r) => r.name)).toEqual(["[Client 2]", "[Client 10]"]);
  });
});

describe("showCounts", () => {
  it("counts each filter for one kind", () => {
    expect(showCounts(rows, "CLIENT")).toEqual({ active: 2, nopol: 1, ended: 1, all: 3 });
  });
});

describe("groupPickerOptions", () => {
  it("splits by kind, active only, natural order, keeping the current value", () => {
    const o = groupPickerOptions(rows, "[Client 3]");
    expect(o.internal.map((r) => r.name)).toEqual(["Finance"]);
    expect(o.client.map((r) => r.name)).toEqual(["[Client 2]", "[Client 3]", "[Client 10]"]);
    expect(groupPickerOptions(rows).client.map((r) => r.name)).toEqual(["[Client 2]", "[Client 10]"]);
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run src/lib/groups.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/groups.ts`**

- **Natural sort:** `a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })`.
- **Filters:**
  - `active` = `!archivedAt`
  - `nopol` = `!archivedAt && !policyItems`
  - `ended` = `!!archivedAt`
  - `all` = true

  The kind always filters.
- **Search:** `q.trim().toLowerCase()`, matched as a substring of `name.toLowerCase()`.
- `sortGroups(…, "people", dir)` breaks ties by natural name, ascending.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Server actions** `src/server/modules/admin/group-actions.ts`

Follow `src/server/modules/admin/reference-actions.ts` for imports (`actionRole`, `checkRate`, `ok`, `forbidden`,
`rateLimited`, `validationError`, `zodFieldErrors`, `writeAudit`, `revalidatePath`), but use
`actionRole("admin","it_staff")`.

- **Schemas:**
  - name: `z.string().trim().min(2, "At least 2 characters").max(60)`
  - `createGroup`: `{ kind: z.enum(["INTERNAL","CLIENT"]), name }`
  - `renameGroup`: `{ id: z.string().min(1), name }`
  - `setGroupArchived`: `{ id, archived: z.boolean() }`
- **Name clash:** before create or rename, look up `department.findFirst({ where: { name: { equals: name, mode:
  "insensitive" }, NOT: { id } } })`. Return `validationError({ name: GROUP_NAME_TAKEN })` on a hit. Also catch
  Prisma P2002 into the same error, since the `lower(name)` unique index is the real guard.
- **Locked:** a locked row refuses rename and archive with `validationError({ _form: "{name} is locked" })`.
- **`setGroupArchived`:**
  - `updateMany({ where: { id, archivedAt: archived ? null : { not: null } }, data: { archivedAt: archived ? new
    Date() : null } })`;
  - `count === 0` returns ok without audit (already in that state).
- **Audit** (`entityType: "department"`):

  | Action | Diff |
  |---|---|
  | `create` | `{ name: { from: null, to: name }, kind: { from: null, to: kind } }` |
  | `rename` | `{ name: { from, to } }` |
  | `archive` / `restore` | `{ name: { from: name, to: name }, kind: { from: kind, to: kind } }` (the sentence needs both) |

- **Revalidate:** `/admin/departments`, `/admin/equipment-policies`, `/employees` and `/employees/new`.

- [ ] **Step 6: Audit sentences** (`src/lib/activity.ts` + tests)

Add these cases, and add them to `ACTION_LABELS`:

| Action | Label | Sentence |
|---|---|---|
| `create` with entity department | (existing label) | "{actor} added client {name}" when `diff.kind.to === "CLIENT"`, else "{actor} added department {name}". Find how `create` currently branches; add the branch only when the diff has `kind`, so existing department `create` entries (no `kind`) still read as before. |
| `rename` | "Renamed" | "{actor} renamed {from} to {to}" |
| `archive` | "Ended or archived" | `kind` CLIENT → "{actor} ended the {name} account"; else "{actor} archived {name}" |
| `restore` | "Restored" | "{actor} restored {name}" |

Add one `auditSentence` test per sentence in `activity.test.ts`, in the style of the existing "policy exceptions"
test.

- [ ] **Step 7: The page**

**`page.tsx`** (server):
- `requireRole("admin","it_staff")`.
- Load every department: `select { id, name, kind, archivedAt, locked, _count: { select: { employees: { where: {
  employment: { not: "OFFBOARDED" } } } } } }`.
- Load base policies: `equipmentPolicy.findMany({ where: { appliesToTitle: null, appliesToDepartmentId: { not: null }
  }, select: { appliesToDepartmentId, _count: { select: { slots: true } } } })`.
- Build `GroupRow[]`. `policyItems` = the slot count of the group's base policy, or null. `archivedAt` is an ISO
  string.
- Render `<PageHeader title="Departments & clients" …>` with the subtitle "Everyone either works in an internal
  department or is client staff on a client account." Then `<GroupsPage rows={rows} canMutate initialTab=… />`.

**`groups-page.tsx`** (client) builds the spec §2.2 layout exactly:
- **Tabs:** `role="tablist"`, Clients then Internal departments, with counts of active rows.
- **Three stat cards.** The third is a button that sets `show = "nopol"`.
- **Toolbar:**
  - a search input (label "Find a client" / "Find a department", visually hidden; placeholder "Find a client…");
  - a segmented group of 4 buttons with `aria-pressed` and counts;
  - "+ Add client" / "+ Add department".
- **Inline add row:**
  - an input, Add and Cancel;
  - a hint line: "Next: set up its equipment policy so new staff show what they are missing." normally, or
    `GROUP_NAME_TAKEN` in red (`text-danger`) when the typed name matches any row case-insensitively, which also
    disables Add;
  - on success it clears, closes, sets `q` to the new name and `show` to `active`, and calls `router.refresh()`.
- **Table:**
  - in a `max-h-[520px] overflow-auto` box, with a `sticky top-0` header;
  - the Name and People headers are buttons that toggle sort, with `aria-sort` on the `th`;
  - rows as spec §2.2;
  - the policy link is `/admin/equipment-policies?tab=<client|internal>&group=<id>`;
  - **Rename** is inline (an input replaces the name; Enter saves, Esc cancels);
  - End account / Archive / Restore call `setGroupArchived`, with no confirm (Restore undoes it).
- **Empty state:** "No client matches "{q}"." / "Nothing here."
- **Footer:** "Showing {shown} of {total}." plus the spec footer sentence for the tab.
- **URL:** keep `tab`, `show` and `q` in the URL with `history.replaceState`; read them on mount from
  `useSearchParams`.
- **Styling:** use the app's existing primitives (`Card`, `Button`, `Pill`/`Chip`, `PageHeader`, the toast hook). Find
  them in `src/components/ui/` and copy their use from `src/components/admin/ref-table.tsx`.

The nav item in `workspaces.ts` becomes "Departments & clients".

- [ ] **Step 8: E2E updates** (`e2e/admin.spec.ts`)

- Rewrite the department cases to the new page:
  - add "E2E Dept {stamp}" on the Internal tab;
  - the case clash: typing an existing name shows `GROUP_NAME_TAKEN` and Add is disabled;
  - rename it;
  - archive it: it leaves Active and appears under Archived;
  - restore it.
- Add one client case: on Clients, add "E2E Client {stamp}". It shows "No policy" and "Set one up" with an href
  containing `group=`.
- Keep `axe-sweep.spec.ts` listing `/admin/departments`.

Run:
`E2E_PORT=3100 npx playwright test e2e/admin.spec.ts e2e/axe-sweep.spec.ts e2e/it-nav.spec.ts --workers=1 --global-timeout=540000`.
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/groups.ts src/lib/groups.test.ts src/server/modules/admin/group-actions.ts src/components/admin/groups-page.tsx "src/app/(app)/admin/departments/page.tsx" src/lib/workspaces.ts src/lib/workspaces.test.ts src/lib/activity.ts src/lib/activity.test.ts e2e/admin.spec.ts e2e/axe-sweep.spec.ts
git commit -m "feat(admin): Departments & clients — tabs, search, Active/No policy/Ended filters, sort, add, rename, end/archive/restore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: "Works for" across lists, export, import and pickers

**Files:**
- Create: `src/components/ui/group-select-options.tsx`: renders `<optgroup label="Internal departments">` and
  `<optgroup label="Clients">` from `groupPickerOptions`.
- Modify:
  - `src/lib/employees-list.ts` (+test): facet `kind`, values `INTERNAL|CLIENT`, `where.department = { kind }`;
  - `src/server/modules/employees/queries.ts`: facet options (`department` labels "{name} (client)" for clients,
    internal first; `kind` options "Internal" / "Client staff" with counts); the row's `department.kind`;
  - `src/components/employees/employees-toolbar.tsx`: the facet title "Works for", plus a new facet "Staff";
  - `src/components/employees/employees-table.tsx`: the column "Works for", with a "Client" pill for clients;
  - `src/lib/export-columns.ts` (+test): `EMPLOYEE_EXPORT_COLUMNS` "Department" → "Works for", plus a new "Staff"
    column after it ("Internal" / "Client");
  - `src/lib/import-employees.ts` (+test): `department` alt headers gain "works for" and "client"; archived block;
  - `src/lib/import-vocabulary.ts`: the `archived-department` cause text;
  - `src/server/modules/import/resolve.ts`: refs carry `archivedAt`;
  - `src/components/employees/transfer-dialog.tsx`: label "Moves to", optgroups, active only, current excluded;
  - `src/server/modules/employees/transfer-actions.ts`: refuse an archived target with `GROUP_ARCHIVED`;
  - `src/components/purchases/draft-form.tsx` and its pages (`purchases/new`, `purchases/[id]/edit`): optgroups,
    active plus the current value;
  - `src/server/modules/purchases/draft-actions.ts`: refuse an archived department unless it equals the draft's
    current one;
  - `src/components/stock/issue-form.tsx` and its page: optgroups, active only;
  - `src/server/modules/stock/movement-actions.ts`: refuse archived;
  - `e2e/transfers.spec.ts`, `e2e/import-export.spec.ts`: label and header changes.

**Interfaces:**
- Consumes: `groupPickerOptions`, `GROUP_ARCHIVED` (Task 2).
- Produces:
  - `<GroupSelectOptions groups={…} keepId? />`, used again in Task 10;
  - the employees list facet param `kind`.

- [ ] **Step 1: Write failing unit tests**

- **`employees-list.test.ts`:** `buildEmployeeWhere` with `kind: ["CLIENT"]` yields a `where` containing
  `department: { kind: { in: ["CLIENT"] } }`. Mirror how the existing `department` facet test asserts `departmentId`.
- **`export-columns.test.ts`:** the `EMPLOYEE_EXPORT_COLUMNS` headers include "Works for" immediately followed by
  "Staff". A client row exports "Client", and an internal one "Internal".
- **`import-employees.test.ts`:**
  - the headers "Works for" and "Client" map to the `department` key;
  - a row naming a department whose ref has `archivedAt` set is blocked with cause `archived-department`.

  Copy the existing `unknown-department` test's fixture shape and give the ref `archivedAt: new Date()`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run src/lib/employees-list.test.ts src/lib/export-columns.test.ts src/lib/import-employees.test.ts`.
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement** each file in the list above.
  - The import ref type gains `archivedAt: Date | null`, filled in `buildEmployeeRefs`/`resolveEmployeeRefs`.
  - The block text is `"{name} is archived — restore it first or pick another"`, built the same way the
    `unknown-department` text is.
  - Server guards: before the transaction, load the target department and return `validationError({ <field>:
    GROUP_ARCHIVED })` when `archivedAt` is set. The fields are `toDepartmentId`, `departmentId` and `departmentId`.

- [ ] **Step 4: Run the units**

Expected: PASS. Then run `npx tsc --noEmit` and `npm run lint`. Expected: clean. The lint already fails on two
pre-existing unused imports in `src/lib/worklist.test.ts`. If it still does, remove those two unused imports in this
task and say so in the report.

- [ ] **Step 5: E2E**

Update the selectors that changed:
- the transfer dialog's "New department" → "Moves to";
- the export header "Works for" and the new "Staff" column.

Then run:
`E2E_PORT=3100 npx playwright test e2e/transfers.spec.ts e2e/import-export.spec.ts e2e/directory.spec.ts e2e/purchases.spec.ts e2e/stock.spec.ts --workers=1 --global-timeout=540000`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src e2e
git commit -m "feat(people): Works for (department or client) on the employees list, export and import; Staff facet; pickers list active departments and clients in two groups; archived targets refused

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Before committing, run `git status --short` and make sure `-A` adds only the files of this task.)

---

### Task 4: Policy actions per group

**Files:**
- Create: `src/lib/policy-lines.ts`, `src/lib/policy-lines.test.ts`
- Rewrite: `src/server/modules/admin/policy-actions.ts`
- Modify: `src/lib/activity.ts`, `src/lib/activity.test.ts`

**Interfaces:**
- Consumes: `slotLabel` (Task 1).
- Produces:

```ts
// src/lib/policy-lines.ts
export interface PolicyLine { slotId?: string; assetTypeId: string; required: boolean; loaner: boolean }
export interface ExistingSlot { id: string; assetTypeId: string | null; required: boolean; loaner: boolean; name: string }
export interface SlotPlan { update: Array<{ id: string; assetTypeId: string; required: boolean; loaner: boolean }>; create: PolicyLine[]; remove: string[] }
/** Lines carrying a slotId that exists are updates (even if unchanged); other lines are creates; existing slots not referenced are removed. A slotId not in `existing` is treated as a create. A slotId used twice: the second is a create. */
export function planSlotChanges(existing: ExistingSlot[], lines: PolicyLine[]): SlotPlan;
export function policyNameFor(groupName: string, title: string | null, taken: (name: string) => boolean): string;
export const POLICY_LINES_MIN = "Add at least one item, or remove the policy";
```

- Server actions:
  - `savePolicy({ departmentId, title?: string | null, policyId?: string, lines: PolicyLine[] }): ActionResult<{ id: string }>`
  - `copyPolicy({ fromPolicyId, toDepartmentIds: string[] }): ActionResult<{ copied: number }>`
  - `deletePolicy({ id })`, kept

- [ ] **Step 1: Write failing tests** `src/lib/policy-lines.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planSlotChanges, policyNameFor } from "./policy-lines";

const ex = [
  { id: "s1", assetTypeId: "mon", required: true, loaner: false, name: "Monitor" },
  { id: "s2", assetTypeId: "mon", required: false, loaner: false, name: "Monitor" },
  { id: "s3", assetTypeId: "hs", required: true, loaner: false, name: "Headset" },
];

describe("planSlotChanges", () => {
  it("keeps referenced slots as updates, creates new lines, removes the rest", () => {
    const p = planSlotChanges(ex, [
      { slotId: "s1", assetTypeId: "mon", required: true, loaner: false },
      { assetTypeId: "kb", required: true, loaner: false },
      { slotId: "s3", assetTypeId: "hs", required: false, loaner: true },
    ]);
    expect(p.update.map((u) => u.id)).toEqual(["s1", "s3"]);
    expect(p.update[1]).toMatchObject({ required: false, loaner: true });
    expect(p.create).toEqual([{ assetTypeId: "kb", required: true, loaner: false }]);
    expect(p.remove).toEqual(["s2"]);
  });
  it("treats an unknown or repeated slotId as a create", () => {
    const p = planSlotChanges(ex, [
      { slotId: "s1", assetTypeId: "mon", required: true, loaner: false },
      { slotId: "s1", assetTypeId: "mon", required: true, loaner: false },
      { slotId: "zz", assetTypeId: "hs", required: true, loaner: false },
    ]);
    expect(p.update.map((u) => u.id)).toEqual(["s1"]);
    expect(p.create).toHaveLength(2);
    expect(p.remove.sort()).toEqual(["s2", "s3"]);
  });
});

describe("policyNameFor", () => {
  it("names a base policy after the group and a rule with the title", () => {
    expect(policyNameFor("Bluepeak Telecom", null, () => false)).toBe("Bluepeak Telecom");
    expect(policyNameFor("Bluepeak Telecom", "Team Lead", () => false)).toBe("Bluepeak Telecom · Team Lead");
  });
  it("adds (2), (3) on a clash", () => {
    const taken = new Set(["finance", "finance (2)"]);
    expect(policyNameFor("Finance", null, (n) => taken.has(n.toLowerCase()))).toBe("Finance (3)");
  });
});
```

- [ ] **Step 2: Run and see them fail**

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `policy-lines.ts`**, then rewrite `policy-actions.ts`

Keep the file's existing helpers (`slotList`, the `PolicyNameTaken` pattern, the revalidate list) where they still
serve.

**`savePolicy`:**
- **Pipeline:** `actionRole("admin","it_staff")` → `checkRate(user.id)` → zod.
- **Schema:** `{ departmentId: min1, title: z.string().trim().min(2).max(120).nullable().optional(), policyId:
  z.string().min(1).optional(), lines: z.array(lineSchema).min(1, POLICY_LINES_MIN).max(20) }`, where `lineSchema` is
  `{ slotId: z.string().min(1).optional(), assetTypeId: z.string().min(1), required: z.boolean(), loaner:
  z.boolean() }`.
- **Inside one transaction:**
  1. **The group:** load it. It must exist. When no `policyId` is given, it must be active (`GROUP_ARCHIVED`).
  2. **The types:** load every `assetTypeId` with its category. Each must be IT class (`category.cls === "IT"`),
     otherwise `validationError({ lines: "Unknown asset type" })`.
  3. **Creating** (no `policyId`):
     - check uniqueness: base → no other `{appliesToDepartmentId, appliesToTitle: null}`; rule → no other policy of
       that group whose title matches case-insensitively (trimmed);
     - refuse with `"{group} already has a policy"` / `"{group} already has a rule for {title}"` under `_form`;
     - the name comes from `policyNameFor` against all policy names lowercased.
  4. **Updating** (`policyId` given): the policy must have `appliesToDepartmentId === departmentId`, and the same title
     (case-insensitive, or both null). Otherwise `_form: "That policy belongs elsewhere"`.
  5. **Apply `planSlotChanges`:**
     - `deleteMany` the `remove` ids (waivers cascade);
     - `update` each kept slot with `assetTypeId`, `required`, `loaner` and `name: slotLabel(cat, type)`;
     - `create` the new ones with `slotLabel` names.
  6. **Audit:**
     - creating: `create`, diff `{ name: {from:null,to:name}, appliesTo: {from:null,to: title ? \`${group} ·
       ${title}\` : group}, slots: {from:null,to: slotList(after)} }`;
     - updating: `policy.saved`, diff `{ slots: { from: slotList(before), to: slotList(after) } }`.
- **Revalidate:** `/admin/equipment-policies`, `/employees`, `/` and `/admin/departments`.

**`copyPolicy`:**
- **Schema:** `{ fromPolicyId: min1, toDepartmentIds: z.array(z.string().min(1)).min(1).max(60) }`.
- **Refuse when:**
  - there are duplicates in `toDepartmentIds`;
  - a target is the source group;
  - a target is archived, missing, or of a different kind.

  Each refuses with `_form`: "Pick other active {clients|departments} to copy to".
- **For each target:** run the same create-or-replace logic as `savePolicy` on its base policy, with lines =
  the source's slots (type, required, loaner), as one transaction.
- **Audit** each target (`create` or `policy.saved`) with an extra diff key `copiedFrom: { from: null, to: source.name
  }`.

**`deletePolicy`:** keep it as it is.

**Delete** `createPolicy`, `addSlot`, `removeSlot` and `setSlotRequired`, and every import of them. Grep the repo.
`src/components/admin/policy-editor.tsx` is deleted in Task 5, but if a caller blocks `tsc` now, delete it here and
leave the page compiling with a temporary "Loading…" body that Task 5 replaces.

- [ ] **Step 4: Audit sentences**

- `policy.saved` → "{actor} saved {entityLabel}'s equipment list". When `diff.copiedFrom` is present: "{actor} copied
  {copiedFrom.to} to {entityLabel}".
- `create` for `equipment-policy` with `copiedFrom` reads the same copied sentence.
- `ACTION_LABELS["policy.saved"] = "Policy saved"`.

Add tests.

- [ ] **Step 5: Run the units, tsc and lint**

Run: `npx vitest run src/lib/policy-lines.test.ts src/lib/activity.test.ts && npx tsc --noEmit && npm run lint`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/policy-lines.ts src/lib/policy-lines.test.ts src/server/modules/admin/policy-actions.ts src/lib/activity.ts src/lib/activity.test.ts
git commit -m "feat(policies): savePolicy/copyPolicy per department or client — one base policy and title rules per group, derived slot names, independent copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(If `policy-editor.tsx` or the page had to change for `tsc`, add them to the commit.)

---

### Task 5: Equipment policies page (master-detail)

**Files:**
- Rewrite: `src/app/(app)/admin/equipment-policies/page.tsx`
- Create: `src/components/admin/policies/group-list.tsx`, `policy-lines-editor.tsx`, `copy-policy-dialog.tsx` and
  `legacy-title-policies.tsx`
- Delete: `src/components/admin/policy-editor.tsx`
- Modify: the e2e specs that used the old editor (grep `e2e/` for "Create policy", "New slot name", "Add slot" and
  "Department this policy applies to")
- Create: `e2e/policies-per-group.spec.ts`

**Interfaces:**
- Consumes:
  - `savePolicy`, `copyPolicy`, `deletePolicy` (Task 4);
  - `numberSlotLabels`, `slotLabel`, `headcountByPolicy`, `resolvePolicy` (`loadout.ts`);
  - `resolveMissing` (`src/server/modules/employees/queries.ts`, reused for the gap count; read its signature);
  - `filterGroups` / `GroupRow` (Task 2).
- Produces: the URL contract `/admin/equipment-policies?tab=client|internal&group=<id>`, linked from Task 2.

- [ ] **Step 1: Server page**

- **Auth:** `requireUser()`; `canMutate` = admin or it_staff.
- **Load:**
  - active groups of the tab's kind, with the active people count (`employment != OFFBOARDED`) and whether a base
    policy exists;
  - both tabs' active counts;
  - the IT categories with their types (`category.cls = IT`, at least one type, ordered by name; types ordered by
    name);
  - the selected group: `?group`, else the first by natural name. For it, its base policy and title rules with slots
    (slot order `[id asc]` is creation order; use it so the editor shows lines in the order they were saved), its
    active employees for the gap count via `resolveMissing`, and the source options for "Start from" (groups of the
    same kind with a base policy: `{policyId, groupName, lines}`);
  - legacy global title policies (`appliesToDepartmentId: null, appliesToTitle: { not: null }`).
- **Render:**
  - `PageHeader` "Equipment policies", with the subtitle "What each client's staff and each internal department
    should have.";
  - the Banner "Editing a policy never touches existing assignments";
  - the legacy fold (only when any exist);
  - a two-column grid `minmax(0,320px) 1fr`, stacking below 1024 px: `GroupList` on the left, the detail on the
    right.

- [ ] **Step 2: `group-list.tsx`** (client)

- **Layout:**
  - tabs (links that keep nothing else);
  - a search input ("Find a client…", label visually hidden);
  - a check-box "Only those without a policy ({n})";
  - the list in `max-h-[640px] overflow-auto`.
- **Rows:** each is a `Link` to `?tab=…&group=<id>` with `aria-current="page"` when selected. It shows the name,
  the people count (mono) and a dot (`bg-success` or `bg-warning`, `aria-hidden`).
- **Legend:** "has a policy · none yet".
- **Empty:** "No match."
- **Unsaved changes:** before following a row link while the editor is dirty, ask
  `confirm("Leave without saving?")`. The editor exposes dirtiness through a small context or a
  `window.__policyDirty` flag. Prefer a React context provided by the page wrapper.

- [ ] **Step 3: `policy-lines-editor.tsx`** (client)

- **Props:** `{ departmentId, groupName, kind, policyId?: string, title: string | null, initialLines: Array<{slotId?,
  assetTypeId, required, loaner}>, categories: Array<{id,name,types:{id,name}[]}>, people: number, canMutate }`.
- **Each line** is a grid row: Category select, Type select, a Required check-box (label "Yes" when on, "Optional"
  when off), a Loan check-box and a × button.
  - Aria labels per line: "Line {n} kind" (Category select), "Line {n} variant" (Type select) and "Remove line {n}"
    (the house rule: no field label word).
  - Changing the category sets the type to that category's first type.
- **Below the table:** the note "Each line becomes a tile on the person's profile, named after its category (or its
  type, for Other). A second line of the same kind shows as "Monitor 2"."
- **+ Add slot** appends `{ Headset category's first type, required: true, loaner: false }`. If there is no Headset
  category, it uses the first category.
- **Impact line:** "{people} people get {n} slots ({r} required). Missing items show as gaps on their profile. Nothing
  is taken back."
- **Buttons:**
  - **Save** calls `savePolicy`. On success: a toast "Saved" and `router.refresh()`. Errors: show `_form`/`lines`
    under the table (`role="alert"`).
  - The dirty flag is on when the lines differ from `initialLines`, with `beforeunload` registered while dirty.
- **Read-only:** for a viewer, the same table as text, and no buttons.

- [ ] **Step 4: Detail section** (in `page.tsx`, a server component composing client parts)

- **Header:** the kind label, the group name, the line "{n} people · {m} people missing something" / "everyone fully
  equipped" / "no policy", and "See their staff →" (`/employees?department=<id>`).
- **Base policy present:**
  - the editor;
  - "Copy to other {clients|departments}…" (opens `CopyPolicyDialog`);
  - a ⋯ menu with "Remove policy", which confirms "Remove {group}'s policy? Their staff will show no gaps." and then
    calls `deletePolicy`.
- **No base policy:** the amber dashed box from spec §3.3:
  - a "Start from another {client|department}'s list…" select (`EntityCombobox` if one exists in
    `src/components/ui/`; otherwise a native `<select>`);
  - "or **Start empty**".

  Choosing either swaps in the editor with those lines, unsaved (`policyId` undefined).
- **Title rules:** a `<details>` "Different for a job title on {group}":
  - each rule renders as a small heading "{title}", plus the editor (with `policyId` and `title`) and a Remove
    button;
  - "+ Add a title rule" shows an input "Exact job title" and Add, which opens an editor for that title pre-filled
    with the base lines (unsaved);
  - it is hidden for a group with no base policy.

- [ ] **Step 5: `copy-policy-dialog.tsx`**

- **Contents:**
  - a search input;
  - a checklist of the other active groups of the same kind, each with "no policy yet" or "replaces its {n} items";
  - "Select all" / "Select none" acting on the filtered rows;
  - the button "Copy to {n}", disabled at 0, which calls `copyPolicy`.
- **On success:** a toast "Copied to {n}", close, and `router.refresh()`.
- Use the app's existing `Dialog` primitive (focus trap, Esc).

- [ ] **Step 6: `legacy-title-policies.tsx`**

- A fold: "Older rules by job title ({n}) — they apply in every department and client".
- Each rule shows its title and its numbered lines as text, plus a Remove button for mutators (`deletePolicy` with
  a confirm).

- [ ] **Step 7: E2E** `e2e/policies-per-group.spec.ts`

Sign in as IT the way `admin.spec.ts` does.

1. **Bluepeak Telecom.** Open `/admin/equipment-policies?tab=client` and pick "Bluepeak Telecom" from the list. The
   detail shows 4 lines, the second and third both Monitor, and the impact line.
2. **Harborline Billing.** Pick it. It shows "has no equipment policy yet". Start from "Bluepeak Telecom", change
   line 4's Category to Keyboard, and Save. The toast "Saved" appears, the list dot for Harborline is green, and a
   reload keeps 4 lines with Keyboard last.
3. **Copy.** Back on Bluepeak, "Copy to other clients…" lists Harborline as "replaces its 4 items". Create a client
   via the Departments page in this test ("E2E Copy {stamp}"); it lists as "no policy yet". Select it and copy. Its
   detail now shows 4 lines.
4. **Removing a waived line** (Review Focus 3).
   - Seed state: on Finance standard (Internal → Finance), find EMP-0042's waivable slot through the profile ⋯ menu.
     Waive "Headset" for EMP-0042 with reason chip "Uses own device". This is the profile's existing Waive dialog;
     the chip key is renamed in Task 9. Until then, type a reason.
   - Then on Finance's editor, remove the Headset line and Save.
   - EMP-0042's profile loads, and "Waived for this person" no longer lists Headset.
5. **Viewer** (`viewer@thebackroomop.com`, same sign-in helper): sees "READ-ONLY", and no Save button.

Update the old specs that drove the removed editor to use the new page, or delete their now-meaningless steps. Name
each file you change in the report.

Run:
`E2E_PORT=3100 npx playwright test e2e/policies-per-group.spec.ts <each changed spec> e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000`.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/(app)/admin/equipment-policies src/components/admin e2e
git commit -m "feat(policies): per-client / per-department master-detail page — searchable list, own list per group with Category/Type lines, start from a copy, copy to others, title rules, older global rules fold

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Notes, IT setup and the held-item panel (server and rules)

**Files:**
- Create:
  - `src/lib/employee-notes.ts`, `src/lib/employee-notes.test.ts`
  - `src/lib/it-setup.ts`, `src/lib/it-setup.test.ts`
  - `src/server/modules/employees/note-actions.ts`
  - `src/server/modules/employees/setup-actions.ts`
  - `src/server/modules/employees/panel-actions.ts`
- Modify: `src/lib/activity.ts`, `src/lib/activity.test.ts`

**Interfaces:**
- Produces:

```ts
// src/lib/employee-notes.ts
export const noteSchema: z.ZodString; // trim, min(1,"Write a note first"), max(2000,"At most 2000 characters")
export function canEditNote(note: { authorId: string }, user: { id: string; role: string }): boolean; // author && role in admin|it_staff
export function canDeleteNote(note: { authorId: string }, user: { id: string; role: string }): boolean; // (author && admin|it_staff) || admin
// src/lib/it-setup.ts
export const SETUP_FIELDS = ["entra", "autopilot", "argus"] as const;
export type SetupField = (typeof SETUP_FIELDS)[number] | "vpn";
export const SETUP_LABELS: Record<SetupField, string>; // entra "Entra / Intune", autopilot "Autopilot", argus "Argus", vpn "VPN"
export const SETUP_COLUMN: Record<(typeof SETUP_FIELDS)[number], "entraStatus" | "autopilotStatus" | "argusStatus">;
export const SETUP_STATE_LABELS: { DONE: "Done"; NOT_YET: "Not yet"; NOT_NEEDED: "Not needed" };
export const VPN_CHOICES: readonly ["None", "Cloudflare WARP", "OpenVPN"];
export const vpnSchema: z.ZodString; // trim, min(1,"Name the VPN"), max(40,"At most 40 characters")
export const setupStateSchema: z.ZodEnum<["DONE","NOT_YET","NOT_NEEDED"]>;
export function setupSummary(e: { entraStatus: string|null; autopilotStatus: string|null; argusStatus: string|null; vpn: string|null }): string; // "Entra / Intune: Not yet · Autopilot: Done · Argus: Not needed · VPN: Cloudflare WARP"; null → "Not recorded"
export function notYetCount(e: { entraStatus: string|null; autopilotStatus: string|null; argusStatus: string|null }): number;
```

- Server actions:
  - `addEmployeeNote({employeeId, text})` → `{ id }`
  - `editEmployeeNote({id, text})`
  - `deleteEmployeeNote({id})`
  - `setItSetup({employeeId, field, value})`, where `value` is a `SetupState` for the three, or a string for `vpn`
  - `heldItemPanel({employeeId, assetId})` → `ActionResult<{ panel: HeldItemPanel }>`, where:

```ts
export interface HeldItemPanel {
  id: string; tag: string; model: string; status: string; serial: string | null;
  categoryName: string | null; typeName: string | null; loanDueAt: string | null;
  heldSince: string | null; bookValue: string | null;
  history: Array<{ at: string; sentence: string }>;
}
```

- [ ] **Step 1: Write failing tests**

**`employee-notes.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { canDeleteNote, canEditNote, noteSchema } from "./employee-notes";

describe("noteSchema", () => {
  it("refuses blank and over-long notes", () => {
    expect(noteSchema.safeParse("   ").error?.issues[0].message).toBe("Write a note first");
    expect(noteSchema.safeParse("x".repeat(2001)).error?.issues[0].message).toBe("At most 2000 characters");
    expect(noteSchema.parse("  ok  ")).toBe("ok");
  });
});

describe("note permissions", () => {
  const note = { authorId: "u1" };
  it("the author edits and deletes while IT or admin", () => {
    expect(canEditNote(note, { id: "u1", role: "it_staff" })).toBe(true);
    expect(canDeleteNote(note, { id: "u1", role: "it_staff" })).toBe(true);
  });
  it("an author who became a viewer cannot", () => {
    expect(canEditNote(note, { id: "u1", role: "viewer" })).toBe(false);
    expect(canDeleteNote(note, { id: "u1", role: "viewer" })).toBe(false);
  });
  it("admin deletes anyone's but edits only their own", () => {
    expect(canDeleteNote(note, { id: "a", role: "admin" })).toBe(true);
    expect(canEditNote(note, { id: "a", role: "admin" })).toBe(false);
  });
  it("other IT staff cannot touch it", () => {
    expect(canEditNote(note, { id: "u2", role: "it_staff" })).toBe(false);
    expect(canDeleteNote(note, { id: "u2", role: "it_staff" })).toBe(false);
  });
});
```

**`it-setup.test.ts`:**
- `setupSummary` with all null → "Entra / Intune: Not recorded · Autopilot: Not recorded · Argus: Not recorded ·
  VPN: Not recorded";
- with values → the spec example;
- `notYetCount` counts NOT_YET only;
- `vpnSchema` refuses "" with "Name the VPN" and 41 characters with "At most 40 characters".

- [ ] **Step 2: Run and see them fail**

Expected: FAIL.

- [ ] **Step 3: Implement the libs, then the actions**

**`note-actions.ts`:**
- **Pipeline:** `actionRole("admin","it_staff")` → `checkRate(user.id)` → zod.
- **Add:** the employee must exist (any employment). Create the note, then audit `note.added` (`entityType
  "employee"`, `entityId` = employeeId, diff `{ note: { from: null, to: text } }`).
- **Edit:** load the note. When `!canEditNote` → `forbidden()`. A state-guarded update (`updateMany where { id, text:
  before }`) sets `text` and `editedAt`; count 0 → `_form: "That note changed — reload and try again"`. Audit
  `note.edited`, diff `{note:{from,to}}`.
- **Delete:** when `!canDeleteNote` → `forbidden()`. `deleteMany({ where: { id } })`; count 0 → ok (already gone).
  Audit `note.deleted`, diff `{ note: { from: text, to: null } }`.
- **Revalidate:** `/employees/<id>`.

**`setup-actions.ts`:**
- **Schema:** a discriminated union on `field` — the three setup fields take `setupStateSchema`, and `vpn` takes
  `vpnSchema`.
- **Pipeline:** `actionRole("admin","it_staff")` → `checkRate`.
- Load the employee (refuse OFFBOARDED? **No**: setup can be recorded for anyone).
- Update the column, then audit `employee.setup` with diff `{ [SETUP_LABELS[field]]: { from: before ?? null, to:
  value } }`, storing `SetupState` values as their labels ("Done" …).

**`panel-actions.ts`:**
- **Pipeline:** `requireUser`-style action auth (copy how a read-only action authenticates any signed-in user; if
  only `actionRole` exists, use `actionRole("admin","it_staff","purchasing_staff","finance_staff","viewer")`) →
  `checkRate(user.id, "check")` → zod `{ employeeId, assetId }`.
- Load the asset with category and type. It must have `assigneeId === employeeId`, else `notFound`-style
  `validationError({ _form: "That item is no longer with this person" })`.
- **Book value:** compute exactly as the profile's stat does today; find its helper in `employees/[id]/page.tsx` and
  reuse it. If no cost, it is null.
- **History:** the asset's newest 5 `AuditEntry` rows (`entityType "asset"`, `entityId` assetId), turned into
  sentences with `auditSentence` (`entityLabel` = tag).
- **`heldSince`:** the `createdAt` of the newest asset audit entry whose diff shows the assignee becoming this
  employee. Inspect how assignment audits record it (`grep -n "assignee" src/server/modules/lifecycle` and
  `src/lib/activity.ts`) and match that exact shape. Null if none.

- [ ] **Step 4: Sentences**

- `note.added` → "{actor} added a note on {name}"
- `note.edited` → "{actor} edited a note on {name}"
- `note.deleted` → "{actor} deleted a note on {name}"
- `employee.setup` → "{actor} set {name}'s {label} to {value}", where `{label}` and `{value}` come from the single
  diff key

`ACTION_LABELS`: "Note added", "Note edited", "Note deleted", "IT setup changed". Add tests.

- [ ] **Step 5: Run the units, tsc and lint**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/employee-notes.ts src/lib/employee-notes.test.ts src/lib/it-setup.ts src/lib/it-setup.test.ts src/server/modules/employees/note-actions.ts src/server/modules/employees/setup-actions.ts src/server/modules/employees/panel-actions.ts src/lib/activity.ts src/lib/activity.test.ts
git commit -m "feat(employees): note log, IT setup and held-item panel actions with their rules and audit sentences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Profile layout — identity band, Notes card, IT setup card

**Files:**
- Modify: `src/app/(app)/employees/[id]/page.tsx`
- Create: `src/components/employees/identity-band.tsx`, `notes-card.tsx` and `it-setup-card.tsx`
- Modify: `e2e/employee-ux.spec.ts` / `e2e/custody.spec.ts` only where selectors of the old character panel break

**Interfaces:**
- Consumes: the Task 6 actions and libs; `Department.kind`.
- Produces: the page structure that Task 8 fills (the Equipment card stays `LoadoutView` for now).

- [ ] **Step 1: Restructure `page.tsx`** to spec §4.1–§4.2

- **Keep:** every query and the derived values.
- **Add to the `Promise.all`:**
  - `employeeNote.findMany({ where: { employeeId }, include: { author: { select: { id, name } } }, orderBy: {
    createdAt: "desc" } })`;
  - the setup fields, from the employee row itself.

  Read the User model's display-name field: use whichever the app shows elsewhere.
- **Layout:**
  - `EmployeeCreatedNotice`;
  - `IdentityBand` (full width);
  - a grid `lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4`:
    - **left:** `LoadoutView` inside the Equipment card;
    - **right:** `NotesCard`, `ItSetupCard`, `AcknowledgementCard`, then `TransfersCard`.

**`identity-band.tsx`:**
- **Layout:** a card with:
  - an initials avatar;
  - the name plus the existing status dot, due pill and viewer pill (move them from the header into the band, and
    keep `PageHeader` for the breadcrumb and Back);
  - the line "{title} · {group}{Client pill} · {employeeNo}";
  - the muted line "Joined {date} · M365 {status}" plus "Transferred from …" (existing text);
  - `ProfileActions` on the right.
- **Below:**
  - the stat strip (the same four stats and helpers as today);
  - the progress line: "{filled} of {total} slots filled · {policy name}", or "No equipment policy applies";
  - the open approval refs (existing).

**`notes-card.tsx`** (client):
- Title "Notes ({n})".
- For mutators: a textarea (label visually hidden "New note", placeholder "Add a note about {name}…") and **Add
  note**.
- **The list:**
  - newest first; the first 5, then a "Show all {n}" button;
  - each entry shows the author, a date and time (the app's existing date-time formatter), "· edited" when
    `editedAt`, and the text with `whitespace-pre-wrap`;
  - **Edit:** an inline textarea with Save / Cancel; shown when `canEditNote`;
  - **Delete:** confirms "Delete this note?"; shown when `canDeleteNote`.
- The current user's id and role are passed from the page.
- **After each action:** a toast ("Note added" / "Note saved" / "Note deleted") and `router.refresh()`.
- **Errors** from zod show under the textarea (`role="alert"`).

**`it-setup-card.tsx`** (client):
- Title "IT setup", with a header chip "{n} not yet" (warning) when `notYetCount > 0`.
- **Rows Entra / Intune connected, Autopilot, Argus:** a `<select>` with an option "Not recorded" only while the
  value is null (disabled), then Done / Not yet / Not needed. On change it calls `setItSetup`, with a toast "Saved".
- **VPN row:** a select with "Not recorded" (while null, disabled), None, Cloudflare WARP, OpenVPN and Other….
  - "Other…" reveals a text input pre-filled with the current custom value, plus a Save button.
  - A stored value not in the choices shows as Other… with the text.
- **Viewer:** plain text values.
- **Aria labels:** "Entra / Intune connected", "Autopilot", "Argus", and "VPN in use" / "VPN name" for the input.

- [ ] **Step 2: Typecheck, then walk the page**

Run `npx tsc --noEmit`. Start the dev server on 3100 (only if no other implementer is walking) and open EMP-0042.
Check the band, the cards and their actions (add, edit and delete a note; set Argus).

- [ ] **Step 3: Fix the e2e selectors that break**

Run:
`E2E_PORT=3100 npx playwright test e2e/employee-ux.spec.ts e2e/custody.spec.ts e2e/it-nav.spec.ts --workers=1 --global-timeout=540000`.
Fix selectors only where the old character panel's structure was asserted.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/employees/[id]/page.tsx" src/components/employees/identity-band.tsx src/components/employees/notes-card.tsx src/components/employees/it-setup-card.tsx e2e
git commit -m "feat(profile): identity band across the top; Notes log and IT setup cards beside the equipment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Equal tiles, loans as a status, and the side panel

**Files:**
- Modify: `src/components/employees/loadout-view.tsx`
- Create: `src/components/employees/equipment-tile.tsx`, `src/components/employees/held-item-panel.tsx`
- Modify: `src/lib/loadout.ts` (+test): add `profileTiles` (below)
- Modify: `e2e/custody.spec.ts` (the On loan and Also holding cards are gone) and any spec asserting them (grep "On
  loan", "Also holding")

**Interfaces:**
- Consumes:
  - `numberSlotLabels`, `orderTiles`, `tileMenuItems`, `computeLoadout`;
  - `heldItemPanel` (Task 6).
- Produces:

```ts
// src/lib/loadout.ts
export type TileKind = "slot" | "extra" | "loan";
export interface ProfileTile<A> { key: string; kind: TileKind; label: string; asset: A | null; required: boolean; coveredByLoan: boolean; slot: SlotLike | null }
/** Spec §4.3 order: orderTiles(slots) with numbered labels, then extras (unslotted), then unclaimed loans (onLoan); extras/loans labelled by `categoryOf(asset)`. */
export function profileTiles<A extends HeldAssetLike>(loadout: Loadout<A>, labelOf: (slot: SlotLike) => string, categoryOf: (a: A) => string): ProfileTile<A>[];
```

- [ ] **Step 1: Failing unit test for `profileTiles`**

Build a loadout from `computeLoadout` with:
- slots: Monitor (filled), Monitor (empty, optional), Headset (empty, required);
- one unslotted asset;
- one TEMPORARY asset of an unrelated type.

Expected:
- the labels are `["Headset", "Monitor", "Monitor 2", <cat of extra>, <cat of loan>]`. The numbering follows **slot
  order before sorting**: Monitor (first in policy) is "Monitor", and the second is "Monitor 2";
- the kinds are `["slot","slot","slot","extra","loan"]`;
- the keys are unique.

- [ ] **Step 2: Run, fail, implement, pass**

- Number the labels over `loadout.slots` in policy order first, then apply `orderTiles`.
- Keys: `slot:<slot.id>`, `extra:<asset.id>`, `loan:<asset.id>`.

- [ ] **Step 3: `equipment-tile.tsx`**

- **The tile:** a fixed-structure card (`h-full flex flex-col`) with three regions:
  - top: the label and the ⋯ menu button (aria-label "More for {label}");
  - middle: the model (font-medium) and tag (mono, a link to `/inventory/<id>` kept as today), or for a gap "Nothing
    assigned";
  - bottom: the chip.
- **Chips:**
  - "Missing" (danger), with a **Fill** button when allowed (the existing fill handler);
  - "Optional" (neutral);
  - "Held" (success);
  - "On loan · due {d MMM}" (warning; danger when overdue). It shows for a loaner slot's asset, a covered slot, or a
    `loan` tile. Reuse the existing loan-due formatting helper.
  - "Not in policy" (neutral) for extras.
- **Clicking the card body** of a tile with an asset calls `onOpen(asset.id)`: a `button` overlay or the card as a
  button, with the inner menu and links stopping propagation.
  - Keyboard: Enter / Space on the focused tile opens it.
  - The tile's accessible name is "{label}: {model} {tag}".

- [ ] **Step 4: Grid and removed cards** in `loadout-view.tsx`

- **Replace** the slot grid with `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 auto-rows-fr gap-3` over
  `profileTiles(...)`.
- **Delete** the "On loan" and "Also holding" cards; their items are tiles now.
- **Keep:**
  - the Holding area;
  - the Waived details;
  - the frozen banner;
  - the Slots / Table switch;
  - every dialog.
- **The Table view** keeps its rows. Make its slot names use the numbered labels too.
- **"Add a slot for this person…"** moves into the Equipment card header, beside the switch.
- **Extras and loans** get the menu items `["return", "open"]` when the user may act (Return through the existing
  dialog), else `["open"]`.

- [ ] **Step 5: `held-item-panel.tsx`**

- **The drawer:** a right-side drawer rendered in a portal.
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the heading "{tag} · {model}".
  - Width `w-full sm:w-[420px]`, full height, with a backdrop that closes on click.
  - Focus goes to the close button on open. Esc closes it. Focus returns to the opening tile (keep a ref).
- **Data:** fetched with `heldItemPanel` on open, showing a skeleton while loading. On error it shows the message
  and a Close button.
- **Content:** spec §4.4.
  - "Held since {d MMM yyyy}" is omitted when null.
  - Book value, when present.
  - **Recent history:** 5 lines "{d MMM} — {sentence}", and "See all" → `/inventory/<id>`.
- **Actions** (only those `tileMenuItems` allows for that tile, plus the links for everyone who can open the
  record):
  - **Replace…** and **Return…** close the panel and open the existing dialogs for that tile;
  - **Change status** → `/inventory/<id>#status`;
  - **Edit details** → `/inventory/<id>/edit` (only for admin and it_staff);
  - **Open full record** → `/inventory/<id>`.
- **URL:** `?item=<assetId>` is set with `history.replaceState` on open and removed on close. On mount, when `item`
  names a held asset, open it.

- [ ] **Step 6: Walk the page and update the e2e**

- **Walk:** EMP-0042 (Finance standard). The tiles are equal in height. The two monitor lines read "Monitor" and
  "Monitor 2". The phone loan, if seeded, reads "On loan · due …". Clicking Laptop opens the panel; Esc closes it and
  the focus returns.
- **`e2e/custody.spec.ts`:** replace assertions about the On loan and Also holding cards with tile assertions:
  `getByRole("button", { name: /^Phone:/ })` contains "On loan".
- **Add to `e2e/employee-ux.spec.ts`:** a case "side panel": open EMP-0042, click the Laptop tile, and the dialog
  shows "Recent history" and "Open full record". Press Escape: the dialog is gone and the Laptop tile is focused.
  Reload with `?item=<that asset id>` and the panel is open.

Run:
`E2E_PORT=3100 npx playwright test e2e/custody.spec.ts e2e/employee-ux.spec.ts e2e/direct-lifecycle.spec.ts e2e/holds.spec.ts e2e/offboarding-v2.spec.ts --workers=1 --global-timeout=540000`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/loadout.ts src/lib/loadout.test.ts src/components/employees e2e
git commit -m "feat(profile): equal equipment tiles with numbered labels, loans and extras as tiles, and a side panel for a held item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Add a slot (category, then type) and split reason chips

**Files:**
- Modify: `src/components/employees/slot-exception-controls.tsx` (`AddSlotDialog`, `WaiveSlotDialog` chip key)
- Modify: `src/server/modules/employees/exception-actions.ts` (`addSlotException` drops `name`)
- Modify: `src/lib/reason-chips.ts`, `src/lib/reason-chips.test.ts`
- Modify: `src/app/(app)/employees/[id]/page.tsx` (pass IT categories with types instead of the flat type list)
- Modify: e2e specs that used the old Add slot dialog's "Slot name" field (grep "Slot name" / "loaner laptop")

**Interfaces:**
- Consumes: `slotLabel`, `numberSlotLabels` (Task 1).
- Produces: `REASON_CHIPS["policy.exception.add"]` and `REASON_CHIPS["policy.exception.waive"]`. The key
  `"policy.exception"` is removed.

- [ ] **Step 1: Failing test in `reason-chips.test.ts`**

`REASON_CHIPS["policy.exception.add"]` equals the four add chips, and `.waive` the three waive chips (Global
Constraints). `"policy.exception" in REASON_CHIPS` is false.

- [ ] **Step 2: Run, fail, implement the chips, pass**

Fix every user of the old key: grep `policy.exception"`.

- [ ] **Step 3: The dialog**

- Title "Add a slot for {name}".
- **Category select:** label "What", over the IT categories that have types. **Type select:** label "Which kind";
  it is shown only when the category has ≥2 types, set silently when it has one, and reset on a category change.
- **The line "Shows as "{label}"":** compute `slotLabel(category, type)`, then number it against the person's
  current tile labels (pass the base labels in) with `numberSlotLabels([...current, label]).at(-1)`.
- **Keep:** the required and loaner check-boxes, and the `ReasonField` with `"policy.exception.add"`.
- **Submit:** `addSlotException({ employeeId, assetTypeId, required, loaner, reason })`.

`WaiveSlotDialog` uses `"policy.exception.waive"`.

- [ ] **Step 4: Server**

- `addSlotException` schema: remove `name`.
- After loading the type with its category, set `name: slotLabel(type.category.name, type.name)`.
- The audit stays `policy.exception.added` with diff `slot` text `"{label}[ (loaner)] · {type}"`.

- [ ] **Step 5: E2E**

Update the old specs, then add to `e2e/employee-ux.spec.ts`: on EMP-0051 (no policy), "Add a slot for this
person…". Category Monitor shows "Which kind" with 24-inch / 27-inch. Pick 27-inch: the text "Shows as "Monitor""
appears. Pick the chip "Client requirement" and Add. A "Monitor" tile with "Missing" appears. Add another Monitor:
it shows as "Monitor 2".

Run the changed specs (foreground, as above). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/employees/slot-exception-controls.tsx src/server/modules/employees/exception-actions.ts src/lib/reason-chips.ts src/lib/reason-chips.test.ts "src/app/(app)/employees/[id]/page.tsx" e2e
git commit -m "feat(profile): Add a slot asks category then type and names itself; separate reason chips for adding and waiving

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Add an employee in three steps

**Files:**
- Create: `src/components/employees/new-employee-wizard.tsx` (client), `src/components/employees/policy-panel.tsx`
  (client)
- Modify: `src/app/(app)/employees/new/page.tsx` (loads groups with `kind`/`archivedAt`; renders the wizard)
- Modify: `src/server/modules/employees/actions.ts`:
  - `createEmployeeSchema` additions;
  - `createEmployee` (note, setup, the archived guard, assignments after the transaction);
  - `previewPolicy` returns the lines;
  - a new `spareOptions`
- Modify: `src/lib/policy-preview.ts` (+test): the preview includes `lines: Array<{ label: string; required: boolean;
  loaner: boolean; assetTypeId: string | null }>` (numbered labels)
- Create: `src/lib/new-employee.ts`, `src/lib/new-employee.test.ts` (the schema pieces and pure step checks)
- Modify: `src/components/employees/employee-created-notice.tsx` (assigned count and failures)
- Modify: `src/components/employees/employee-form.tsx`: the edit mode only. Remove the `mode="new"` branches if
  nothing else uses them; the edit page still uses it.
- Modify: the e2e specs that create employees through the old form (grep `e2e/` for "Create employee" and "Create
  and add another"; `e2e/fixtures/make.ts` if it drives the form)

**Interfaces:**
- Consumes:
  - `GroupSelectOptions`, `groupPickerOptions`, `GROUP_ARCHIVED` (Tasks 2–3);
  - `SETUP_*`, `VPN_CHOICES`, `vpnSchema`, `setupSummary`, `noteSchema` (Task 6);
  - `numberSlotLabels`, `slotLabel` (Task 1);
  - `isAssignable`, `isDirectLifecycle` (`src/lib/asset-class.ts`);
  - the existing `assignAsset` (`src/server/modules/lifecycle/actions.ts`) and `requestAssign`
    (`src/server/modules/employees/actions.ts`). Read both signatures first; call them with the same arguments the
    profile's Fill dialog uses.
- Produces:
  - `spareOptions({ departmentId, title })` → `{ lines: Array<{ key: string; label: string; required: boolean;
    loaner: boolean; assetTypeId: string | null; spares: Array<{ id: string; tag: string; model: string }> }> }`
  - `createEmployee` result `{ id: string; assigned: number; failed: Array<{ tag: string; reason: string }> }`

- [ ] **Step 1: Failing tests** `src/lib/new-employee.test.ts`

Export `newEmployeeExtras` (a zod object) from `src/lib/new-employee.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detailsMissing, newEmployeeExtras } from "./new-employee";

describe("newEmployeeExtras", () => {
  const base = { entraStatus: "NOT_YET", autopilotStatus: "DONE", argusStatus: "NOT_NEEDED", vpn: "None", note: "", assign: [] };
  it("accepts the defaults", () => { expect(newEmployeeExtras.safeParse(base).success).toBe(true); });
  it("refuses a repeated spare", () => {
    const r = newEmployeeExtras.safeParse({ ...base, assign: [{ assetId: "a" }, { assetId: "a" }] });
    expect(r.error?.issues[0].message).toBe("Each spare can be picked once");
  });
  it("refuses more than 20 assignments and a 2001-character note", () => {
    expect(newEmployeeExtras.safeParse({ ...base, assign: Array.from({ length: 21 }, (_, i) => ({ assetId: `a${i}` })) }).success).toBe(false);
    expect(newEmployeeExtras.safeParse({ ...base, note: "x".repeat(2001) }).success).toBe(false);
  });
  it("refuses a blank VPN name", () => {
    expect(newEmployeeExtras.safeParse({ ...base, vpn: "  " }).error?.issues[0].message).toBe("Name the VPN");
  });
});

describe("detailsMissing", () => {
  it("lists what step 1 still needs", () => {
    expect(detailsMissing({ name: "A", title: "", departmentId: "", employeeNo: "EMP-1", joinedAt: "2026-10-16" }))
      .toEqual(["title", "departmentId"]);
  });
});
```

Details:
- **`note`:** an empty string is allowed and means none: `z.string().trim().max(2000, "At most 2000 characters")`.
- **`detailsMissing(d)`** returns, in that order, the keys among `name` / `title` / `departmentId` / `employeeNo` /
  `joinedAt` that are empty after trimming. Name and title also count as missing when shorter than 2 characters.

Extend `src/lib/policy-preview.test.ts`: the preview for Finance carries numbered lines whose labels include
"Monitor" and "Monitor 2".

- [ ] **Step 2: Run, fail, implement the lib parts, pass**

- [ ] **Step 3: Server**

**`createEmployeeSchema`** = the existing one `.extend(newEmployeeExtras.shape)`, wrapped so the distinct-spare
refinement still applies (zod 4: put the `superRefine` on the merged object).

**`createEmployee`:**
1. **Archived guard:** after loading the department, refuse with `validationError({ departmentId: GROUP_ARCHIVED })`
   when `archivedAt` is set.
2. **The transaction** creates the employee with the setup fields and `vpn`. When `note` is non-empty, it creates
   the `EmployeeNote` (author = user) plus audit `note.added`. The existing `create` audit stays.
3. **After the commit,** for each `assign` entry in order:
   - load the asset (tag);
   - call the direct or request path per `isDirectLifecycle(user.role, "IT")`, exactly as the profile's Fill does
     for a policy slot (status as the Fill sets it; standard, not loan);
   - on `ok` count it, otherwise push `{ tag, reason: <first error message> }`.
4. **Return** `ok({ id, assigned, failed })`.

**`previewPolicy`:**
- It returns `lines` too: load the policies with their slots' types and categories, and pass them to
  `previewPolicyFor`.
- Lines are in slot order. The labels come from `numberSlotLabels(slots.map(s => s.assetType ? slotLabel(cat, type)
  : s.name))`.

**`spareOptions`:**
- **Pipeline:** `actionRole("admin","it_staff")` → `checkRate(user.id, "check")` → zod `{ departmentId, title }`.
- Resolve the policy the same way, then for each distinct non-loaner `assetTypeId` load up to 50 assets of that type
  satisfying the same where-clause the profile page uses for spares (`ASSIGNABLE_FROM.IT` plus no active
  reservation and no open approval). Read the profile page query and reuse it. Order them by tag.
- **Return** the lines with keys `line:<index>`.

- [ ] **Step 4: The wizard** (`new-employee-wizard.tsx`)

- **Props:** `groups` (from `groupPickerOptions`), `nextNo: string | null` and `today: string`.
- **State:** all fields, `step: 1 | 2 | 3`, and `picks: Record<lineKey, assetId | "">`.
- **The stepper:** a `<ol aria-label="Steps">` with three items; the current one has `aria-current="step"`.
- **Step 1** (spec §5.2):
  - **"Works for":** a `radiogroup` (Internal / Client staff). Switching clears `departmentId`.
  - **The select** is labelled "Department" or "Client", using `GroupSelectOptions` with only that kind (pass one
    group array).
  - **Name** with the existing `SameNameCheck`.
  - **Title.**
  - **Employee no.:** pre-filled with `nextNo`, with the existing `EmployeeNoCheck`. It only shows its "Use it" when
    the field is empty.
  - **Start date.**
  - **Accounts & access:** three `radiogroup`s (Done / Not yet / Not needed; the default is Not yet) and the VPN
    select (the default is None) with an Other… text input.
  - **First note:** a textarea.
  - **"More":** a `<details>` with Employment (with the existing Complete-by behaviour) and Account status (M365).
    Copy both controls from `employee-form.tsx`.
  - **Next** runs `detailsMissing`. It focuses the first missing field and shows "Fill in the {label}" under it.
- **Step 2:** when entered (and whenever the group or title changed since the last load), call `spareOptions`.
  - Each line shows the label, a "Required" / "Optional" chip and a select whose first option is "Leave as a gap".
  - An option already picked on another line is `disabled`.
  - Loaner lines show "Filled by a loan later".
  - No lines: "Nothing to assign yet — add equipment from their profile after creating."
- **Step 3:** the summary (spec §5.4) as a definition list:
  - each section has an "Edit" link that jumps to its step;
  - **buttons:** **Create employee** and **Create and add another**;
  - **errors:** field errors from the server jump back to step 1 and show there; the same-name confirm flow works as
    today, copied from `employee-form.tsx`.
  - **On success:** `router.push(\`/employees/${id}?created=1&assigned=${assigned}${failed.length ? "&failed=" +
    encodeURIComponent(JSON.stringify(failed)) : ""}\`)`. For "add another", reset the form, keep Works for and the
    group, and show the existing "added" toast.
- **The right column** is `PolicyPanel` (`policy-panel.tsx`):
  - it calls `previewPolicy` debounced at 400 ms on title and group changes;
  - it shows "Equipment policy", the policy name and its lines with chips;
  - or "No equipment policy for {group} yet — they will start with no gaps.";
  - or, before a group is chosen, "Pick who they work for to see their equipment."
- **Layout:** `lg:grid-cols-[minmax(0,1fr)_320px]`, with the panel `lg:sticky lg:top-4`.

`EmployeeCreatedNotice`:
- reads `assigned` and `failed` from the search params (parse defensively; ignore bad JSON);
- adds "{n} items assigned" when n > 0, and one line per failure: "{tag} could not be assigned: {reason}".

- [ ] **Step 5: E2E**

Update the old specs that used the one-card form (the field labels mostly hold; add the step clicks). Then add to
`e2e/clients-profile.spec.ts` (create the file if it does not exist; Task 11 extends it):

1. **Client staff, one spare.** IT opens `/employees/new` and sees "Works for". Choose Client staff, then Client
   "Bluepeak Telecom". Fill the name "E2E Hire {stamp}", title "Agent" and the employee no. (pre-filled). Set Argus
   Done and VPN Cloudflare WARP, with the note "Starts Monday". Next.
   - Step 2 lists Workstation (PC), Monitor, Monitor 2 and Headset.
   - Pick the first spare for Monitor; the same asset is disabled under Monitor 2.
   - Next. Step 3 shows "Argus: Done" and "VPN: Cloudflare WARP". Create.
   - The profile shows "1 item assigned", a Monitor tile "Held", and "Monitor 2" "Missing". The Notes card shows
     "Starts Monday". IT setup Argus reads Done.
2. **Ended between steps** (Review Focus 1). Open `/employees/new` and choose Client staff, then "Harborline
   Billing", and fill step 1. In a second page (same context), end Harborline on `/admin/departments`; then restore
   it at the end of the test. Back on the first page, Next, Next, Create. The error "That department or client is
   archived" shows on step 1, and no employee with that name exists (search `/employees?q=`).
3. **A spare taken meanwhile** (Review Focus 4). Pick a spare in step 2. Before Create, assign that same asset to
   EMP-0051 through the API path the tests already use for assignment (find a helper in `e2e/fixtures/` or drive the
   profile's Fill on a second page). Then Create. The notice shows "{tag} could not be assigned:", and the person
   exists.

Run:
`E2E_PORT=3100 npx playwright test e2e/clients-profile.spec.ts e2e/employee-ux.spec.ts e2e/quick-forms.spec.ts e2e/deadlines.spec.ts e2e/paging.spec.ts --workers=1 --global-timeout=540000`,
plus any other spec you changed. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src e2e
git commit -m "feat(employees): Add an employee in three steps — Works for (department or client), accounts and access, first note, a spare per slot, check and create; live policy panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Check `git status --short` before `-A`.)

---

### Task 11: End-to-end journey, accessibility, and the battery

**Files:**
- Modify: `e2e/clients-profile.spec.ts` (complete the spec §7.2 journey), `e2e/axe-sweep.spec.ts`

- [ ] **Step 1: Complete `e2e/clients-profile.spec.ts`** with the spec §7.2 cases not already covered by Tasks 2, 5,
  8, 9 and 10:

1. **Notes:** add, edit, then delete on the person created in this file. Then a viewer sees the notes, with no
   textarea and no Edit or Delete.
2. **IT setup:** set VPN to Other… with "Zscaler", and Save. After a reload, VPN shows Other… with "Zscaler", and
   Argus keeps its value.
3. **Ending a client:** end the client created in this file on `/admin/departments`. `/employees/new` → Client staff
   no longer lists it. Restore it.
4. **The Works for column and filter:** `/employees?kind=CLIENT` lists the hire with the "Client" pill and not
   EMP-0042.

- [ ] **Step 2: Axe**

Add these to `axe-sweep.spec.ts` (follow its pattern):
- `/admin/equipment-policies?tab=client`;
- `/employees/new` (on step 1, then after reaching step 2 and step 3 with valid input);
- `/employees/<EMP-0042 id>?item=<its laptop id>` (with the panel open).

- [ ] **Step 3: Run the new and changed specs**

Run them in the foreground. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/clients-profile.spec.ts e2e/axe-sweep.spec.ts
git commit -m "test(e2e): client staff journey — notes, IT setup, ending a client, Works for filter; axe on the new screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: The battery** (the controller runs this, not an implementer)

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```

Then run Playwright over every `e2e/*.spec.ts` in chunks, each under the 540 s global timeout (the previous
phase's A–F chunking plus the new spec files).

Finally run `npm run db:seed` on `inventory_dev`. Record the counts (e2e / files, unit / files, 32 migrations) in the
ledger.

---

### Task 12: Docs

**Files:**
- Modify:
  - `docs/HANDOVER.md`: line 3, plus a new lettered block for Phase 37 after the last one (anchor on the block
    header, not a prefix);
  - `docs/PICKUP.md`: the Branch, Database and Battery rows, and §4 item 1;
  - `docs/HANDOVER-PENDING.md`: the preamble;
  - the spec's **Status** line.

- [ ] **Step 1: Write**

Record:
- **The state:** "code-complete, unmerged, unpushed", the branch, the final tree, the battery numbers, migration 32
  (and that it rewrites slot names), and the rulings P-1..P-5 plus every ledger ruling.
- **What the next redeploy does on staging:**
  - departments stay INTERNAL;
  - slot names change to labels;
  - IT setup reads "Not recorded" for everyone;
  - clients must be added on Departments & clients.

Keep the files CRLF. Use the Edit tool.

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOVER.md docs/PICKUP.md docs/HANDOVER-PENDING.md docs/superpowers/specs/2026-10-16-clients-and-profile-design.md
git commit -m "docs(handover,pickup): Phase 37 code-complete on phase-37-clients-profile (migration 32), unmerged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
