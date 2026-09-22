# Phase 27 — IT and quality leftovers sweep

**Status:** design approved in conversation 2026-09-22 (decisions 1–9 below); **implemented on branch `phase-27-leftovers-sweep`** — plan `docs/superpowers/plans/2026-09-22-phase-27-leftovers-sweep.md` (7 tasks, `D-1`…`D-10`: the pre-flight rulings R1–R4 are `D-1`, the final whole-branch review added `D-8`, its fix wave `D-9`, the final battery `D-10`) — **code-complete 2026-09-22 at final tree `66445ed`**, final-review fix wave included. **Merged to `main` via `--no-ff` `5dd3372` and pushed 2026-09-22** (the merged tree is byte-identical to the tested tip `0abf560`); the staging redeploy is the user's decision, not pre-authorised. **Migration 26 `20260922010908_case_insensitive_names` is PENDING on staging** and applies on the next `scripts/deploy-staging.ps1 -Force` — run §3.1's duplicate check first; staging was checked clean on 2026-09-22. Battery on the final tree: `tsc` and `lint` clean, **26 migrations** (schema up to date), **1528 unit / 87 files**, **377 e2e / 36 files** across the seven foreground chunks — A 54 · B 67 · C 64 · D 50 · E1 37 · E2 39 · F 66 — zero failed, zero did-not-run. What shipped, in prose: `docs/HANDOVER.md` **(t)**. The `*Amended (D-n):*` notes below record every place the execution departed from this document.

**Predecessors:** Phase 24 (`2026-09-17-it-gaps-2-design.md`) and Phase 25 (`2026-09-21-it-navigation-sweep-design.md`) each named three IT items out of scope; Phase 26 closed the two that needed schema work. This phase closes the three that remain, pays down the parked Minors of Phases 17–26, and records the three design decisions those phases left open. Facts gathered by two read-only scouts on 2026-09-22 (audit scoping, reference-data uniqueness, the activity feeds; every parked Minor re-verified against current code).

---

## 0. Decisions made during the brainstorm

1. **Scope is the leftovers list, nothing new.** Three IT items (audit scoping, case-insensitive uniqueness, the activity feeds), the parked Minors that are still true and either one-line or user-visible, three recorded decisions, and the stale documentation lines. Depreciation and the Purchasing bulk import stay parked (§2).
2. **Activity feeds: facet, sentences and field names, through one shared module.** The four feeds get an Action facet on the same list-state pattern `/audit` uses, every action that can reach a feed gets a plain-English sentence, and `update`/`import-update` print human field names from one dictionary. One module (`src/lib/activity-list.ts`), one query, one toolbar serve all four pages — not four copies of the wiring, and not a redirect into `/audit` (which renders raw action names).
3. **Uniqueness: index plus a named conflict message.** Migration 26 adds seven `lower()` unique indexes; every create/rename action checks case-insensitively before writing and names the existing row; the five independent `P2002` helpers become one. No live hint while typing (the supplier nudge stays the supplier form's alone).
4. **Parked Minors: the one-liners and the user-visible smalls.** Seven one-line code fixes, one ruling recorded instead of a change, five small visible fixes (§5.5). Items recorded as deliberate, declined, or not worth the diff stay recorded with their reasons (§2).
5. **No `role="group"` rewrite of the grouped combobox.** The Phase 24 shape (a `role="presentation"` heading row plus `aria-describedby` on the options under it) already gives assistive technology the group name; a `group` wrapper would only change the DOM `e2e/it-gaps.spec.ts` cases 4 and 7 assert on. Revisit only on AT feedback.
6. **The Home age histogram stays unlinked.** Its buckets are rolling years since purchase; `/inventory` knows only calendar purchase years, so an honest link needs a new rolling-age facet. Out of scope, recorded.
7. **Keyboard support stays at Enter on a focused row**, and `/inventory` — the app's largest list and the one with no keyboard path — gets it this phase, through one shared helper so the pattern is written once, not a third time.
8. **Audit scoping is built from the "see" map, not the "manage" map.** `VISIBLE_CLASSES`/`canSeeClass` is the basis (the one `invisibleAssetIds` already uses); `approvalClassWhere` is not reused because Purchasing and Finance staff see both classes but manage one, and reusing the manage map would hide their other class's approvals from `/audit`.
9. **Migration 26 also carries an ordinary index** on `AuditEntry (entityType, action)` for the facet's filter and counts, in the same migration as the seven unique indexes — one migration for the phase, not two.

---

## 1. Goal

Close the three IT items every phase since 24 has carried forward, pay down the parked Minors that are cheap or visible, and leave the documentation's "what remains" lists true.

## 2. Non-goals (recorded, each with its home)

- **Depreciation module** and **Purchasing bulk import** (PICKUP §4 item 5; HANDOVER-PENDING §5.2) — the next phases' candidates.
- **A rolling-age facet on `/inventory` and links from the Home age histogram** (decision 6).
- **`role="group"` combobox shape** (decision 5); **the richer j/k/action-letter keyboard layer** the approvals queue has (decision 7).
- **`worker:once` prune split** (Phase 24 M-9: four e2e specs shell out to the combined behaviour); **`holdFacets` inside the paged snapshot** and **the Employee facet list narrowed by Department** (Phase 26 M-9 / M-P26-4: correct at team scale, declined by ruling); **bind-parameter dedupe in the repair-stage branch** (Phase 24 M-10); **`createEmployee`'s unconditional due-date floor** (correctly scoped to a new record); **`revalidateStocktake` not revalidating `/`** (inert, every `(app)` route is dynamic).
- **The importers' `refKey` collision guards stay.** They answer "which existing row does this sheet name mean", protect against rows created before the index, and cover the read-then-decide window an index cannot; the write-time index answers a different question.
- **Search or sort on the activity feeds.** The feeds stay newest-first; the one facet is the feature.

---

## 3. Data and rules

### 3.1 Migration 26 — `prisma/migrations/<timestamp>_case_insensitive_names/migration.sql`

Created with `npx prisma migrate dev --create-only` after adding `@@index([entityType, action])` to `model AuditEntry` in `schema.prisma`, then the raw indexes appended by hand (Prisma cannot express a functional index; `User_email_lower_key` in `20260814090100_integrity_constraints` is the precedent):

```sql
-- Phase 27 (spec §3.1): the feeds' Action facet filters and counts on (entityType, action).
CREATE INDEX "AuditEntry_entityType_action_idx" ON "AuditEntry"("entityType", "action");

-- Phase 27 (spec §3.1): one name per table whatever the case. Postgres' plain UNIQUE is
-- case-sensitive, so "Laptop" and "laptop" were two rows; User.email has had this shape since
-- migration 20260814090100. Not expressible in schema.prisma — documented in HANDOVER/PICKUP
-- beside User_email_lower_key and Reservation_one_active_hold_per_asset as database-only invariants.
CREATE UNIQUE INDEX "AssetCategory_name_lower_key"     ON "AssetCategory"   (lower(name));
CREATE UNIQUE INDEX "AssetType_category_name_lower_key" ON "AssetType"      ("categoryId", lower(name));
CREATE UNIQUE INDEX "Department_name_lower_key"        ON "Department"      (lower(name));
CREATE UNIQUE INDEX "EquipmentPolicy_name_lower_key"   ON "EquipmentPolicy" (lower(name));
CREATE UNIQUE INDEX "Vendor_name_lower_key"            ON "Vendor"          (lower(name));
CREATE UNIQUE INDEX "StockCategory_name_lower_key"     ON "StockCategory"   (lower(name));
CREATE UNIQUE INDEX "StockCategory_prefix_lower_key"   ON "StockCategory"   (lower(prefix));
```

Additive. Fails loudly if a target database already holds two names differing only by case — `prisma/seed.ts` has none, and staging had none on 2026-09-22 (checked: 11 categories, 19 types, 5 departments, 1 policy, 2 vendors, 0 stock categories). The deployment note (HANDOVER (t), PICKUP Database row) carries the check to run before any redeploy that applies it:

```sql
select 'AssetCategory', lower(name), count(*) from "AssetCategory" group by 2 having count(*) > 1;
-- …the same for "AssetType" grouped by ("categoryId", lower(name)), "Department", "EquipmentPolicy",
-- "Vendor", "StockCategory" (name), "StockCategory" (prefix)
```

`StockItem.code` is machine-generated and `StockItem.name` is not unique; both are out. `User.email` already has its index.

### 3.2 Shared Prisma error helper — `src/server/prisma-errors.ts` (new)

*Amended (D-2):* the module was **not** new — `src/server/prisma-errors.ts` already existed, exporting the `asActionResult` P2028/P2025/P2003 handler that the flag, user and webhook actions use. Task 1 **appended** `isUniqueViolation` and `uniqueTarget` to it with their own unit test; nothing already there was touched or merged, and `admin/policy-actions.ts` keeps its own private `asActionResult` (a different P2003 meaning).

```ts
import { Prisma } from "@prisma/client";

/** Any unique-index violation — Prisma's own @unique and the raw lower() indexes alike. */
export function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * P2002 meta.target is a column array (["serial"]) for a Prisma-declared index or the index NAME
 * string ("StockCategory_prefix_lower_key") for a raw one — `.includes("prefix")` matches both
 * shapes; keep every caller on includes().
 */
export function uniqueTarget(err: unknown): string[] {
  if (!isUniqueViolation(err)) return [];
  const target = (err.meta as { target?: string[] | string } | undefined)?.target;
  return Array.isArray(target) ? target : target ? [String(target)] : [];
}
```

Replaces the five copies: `isUnique` in `admin/reference-actions.ts` and `admin/policy-actions.ts`, `isP2002` + `p2002Target` in `stock/item-actions.ts`, `isP2002` in `suppliers/actions.ts`, `uniqueTarget` plus the three inline `instanceof … P2002` checks in `inventory/actions.ts`. Behaviour identical; unit-tested (both `meta.target` shapes, a non-Prisma error).

### 3.3 Audit list rules — `src/lib/audit-list.ts`

```ts
export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "purchase-request", "user",
  "asset-category", "asset-type", "department", "equipment-policy",
  "feature-flag", "webhook-endpoint",
  "vendor", "stock-item", "stock-category", "stocktake",   // Phase 27: rows the page already renders and links
] as const;

/** Ids of the class-bearing rows a role may NOT see — one list per audit entityType that has a class. */
export interface HiddenAuditRefs { assetIds: string[]; approvalIds: string[]; categoryIds: string[]; typeIds: string[] }
export const NO_HIDDEN_REFS: HiddenAuditRefs = { assetIds: [], approvalIds: [], categoryIds: [], typeIds: [] };

export function buildAuditWhere(state: ListState, hidden: HiddenAuditRefs = NO_HIDDEN_REFS): Prisma.AuditEntryWhereInput {
  // q and entity facet unchanged …
  const branches = ([
    ["asset", hidden.assetIds], ["approval", hidden.approvalIds],
    ["asset-category", hidden.categoryIds], ["asset-type", hidden.typeIds],
  ] as const).filter(([, ids]) => ids.length > 0)
    .map(([entityType, ids]) => ({ entityType, entityId: { in: [...ids] } }));
  // Phase 14 (spec §3.1) generalised in Phase 27: rows about class-bearing things this role cannot
  // see are not its audit trail either. No clause at all for an all-class role.
  if (branches.length) where.NOT = { OR: branches };
  return where;
}
```

Entity-facet labels for the four new types: **Supplier**, **Stock item**, **Stock category**, **Stocktake** (wherever the page maps `AUDIT_ENTITY_TYPES` to labels today).

### 3.4 Activity list rules — `src/lib/activity-list.ts` (new, pure, unit-tested)

*Amended (D-2, D-3 / plan P-7):* `financeActivityWhere` was **removed outright** from `finance/queries.ts` rather than rewritten as a wrapper — its only caller was the finance feed, and Home has no copy, so `feedWhere("finance", …)` in this module is now the one definition of the predicate. Task 2's two bridge edits kept the four pages compiling for one task and were deleted by Task 4. One occurrence of the old name survives on purpose: the module's own doc comment says where the predicate came from (M-P27-1, ruled kept as provenance).

```ts
export const ACTIVITY_FEEDS = ["inventory", "employees", "finance", "purchases"] as const;
export type ActivityFeed = (typeof ACTIVITY_FEEDS)[number];
export const ACTIVITY_LIST_CONFIG: ListConfig = { facets: ["action"], sortable: [], defaultSort: [] };

/** The four base predicates, moved verbatim from the pages; class hiding uses the audit refs. */
export function feedWhere(feed: ActivityFeed, hidden: HiddenAuditRefs): Prisma.AuditEntryWhereInput {
  const assetRows = (extra: Prisma.AuditEntryWhereInput = {}) => ({
    entityType: "asset", ...extra, ...(hidden.assetIds.length ? { entityId: { notIn: hidden.assetIds } } : {}),
  });
  switch (feed) {
    case "inventory": return assetRows();
    case "employees": return { entityType: "employee" };
    case "finance":   return { OR: [{ entityType: "purchase-request" }, assetRows({ diff: { path: ["cost"], not: Prisma.DbNull } })] };
    case "purchases": return { entityType: "purchase-request" };
  }
}

export function buildActivityWhere(feed: ActivityFeed, state: ListState, hidden: HiddenAuditRefs): Prisma.AuditEntryWhereInput {
  const base = feedWhere(feed, hidden);
  return state.filters.action?.length ? { AND: [base, { action: { in: state.filters.action } }] } : base;
}
```

`financeActivityWhere` in `finance/queries.ts` becomes `feedWhere("finance", NO_HIDDEN_REFS)` for any remaining caller (Home), so the predicate lives once.

### 3.5 Sentences, action labels and field names — `src/lib/activity.ts`

*Amended (D-9, from the final review's I-1 and M-1):* the table below was incomplete. The approvals worker writes five **`<lifecycle.*> executed`** asset actions (`execute-approval.ts` × `labels.ts`) that reach `/inventory/activity`, and they had neither a sentence nor a label — so the new Action facet listed a raw `lifecycle.assign executed` beside “Assigned” and choosing “Assigned” dropped every queue-executed assign. All five now run through the lifecycle sentence bodies with the suffix **“ (approved request)”** and carry facet labels of the same shape (“Assigned (approved request)” …), and **`lifecycle.transfer`** gained its own sentence and label (“Asset transferred”). `fieldList` **sorts on the label**, so an `update`/`import-update` sentence lists fields in one stable order whatever order Postgres' jsonb stored them in — which is why the shipped copy is “updated department, join date on Nina Robles by import”; two pre-existing unit assertions were re-pinned to the sorted order (“assignee, status”, “cost, model”). The asset **history tab** still prints the raw `lifecycle.assign executed` string by design: it is a raw-trail path, not one of the four feeds.

**New `auditSentence` cases** (every action that can reach one of the four feeds and falls to the raw-verb default today). `actor` = `entry.actorLabel`, `entity` = `entry.entityLabel`, `diff` = `entry.diff`:

| action | sentence |
|---|---|
| `document.uploaded` | `{actor} attached {diff.document.to} to {entity}` |
| `document.signed` | `{actor} marked {fileName} signed on {entity}` — the diff's one key is the file name |
| `loan.due-changed` | to set: `{actor} moved the loan due date of {entity} to {fmtDate(to)}`; cleared: `{actor} cleared the loan due date of {entity}` |
| `secret.created` | `{actor} added the secret "{diff.label.to}" to {entity}` |
| `acknowledgement.recorded` | `{actor} recorded {entity}'s signed acknowledgement of {n} item(s)` (`n` = `diff.items.to`, pluralised) |
| `policy.exception.added` | `{actor} added the exception slot {diff.slot.to} for {entity} — {diff.reason.to}` |
| `policy.exception.waived` | `{actor} waived {diff.slot.from} for {entity} — {diff.reason.to}` |
| `policy.exception.removed` | `{actor} removed the exception slot {diff.slot.from} for {entity}` |
| `supplier-set` | to set: `{actor} set {diff.supplier.to} as the supplier on {entity}`; cleared: `{actor} cleared the supplier on {entity}` |

Actions that never reach a feed (`rename`, `delete`, `rotate-secret`, `endpoint-*`, `flag-*`, `disable`/`enable`, `role-change`, `claim`/`release`/`approve`/`reject`/`escalate`/`retry`, the `vendor` document upload) keep the default `{actor} {action} {entity}`; the unit test that pins the default moves from `document.signed` to `flag-enable`.

**Field names.** `FIELD_LABELS: Record<string, string>` and `fieldLabel(key)`:

```ts
export const FIELD_LABELS: Record<string, string> = {
  name: "name", model: "model", serial: "serial", cost: "cost", location: "location", notes: "notes",
  categoryId: "category", typeId: "type", departmentId: "department", assigneeId: "holder", vendorId: "supplier",
  purchasedAt: "purchase date", warrantyUntil: "warranty end", loanDueAt: "loan due date",
  employeeNo: "employee number", email: "email", title: "title", employment: "employment", joinedAt: "join date",
  offboardingAt: "offboarding start", offboardingDueAt: "complete-by date",
  registeredName: "registered name", contactPerson: "contact person", phone: "phone", address: "address",
  registrationNo: "registration number", contractStatus: "contract status", contractStart: "contract start", contractEnd: "contract end",
  unit: "unit", packSize: "pack size", reorderLevel: "reorder level", expiresAt: "expiry",
};
/** Known keys read from the table; unknown ones lose a trailing "Id" and split camelCase: "loanDueAt" → "loan due at". */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}
```

Both the `update` and the `import-update` cases render `Object.keys(diff).map(fieldLabel).join(", ")`: "updated department, join date on Nina Robles by import".

**Action labels for the facet.** `ACTION_LABELS: Record<string, string>` and `actionLabel(action)` (fallback: the raw action):

| action | label | action | label |
|---|---|---|---|
| `create` | Created | `update` | Updated |
| `register` | Registered | `import-create` | Imported (new) |
| `import-update` | Imported (update) | `lifecycle.assign` | Assigned |
| `lifecycle.return` | Returned | `lifecycle.change-status` | Status changed |
| `lifecycle.replace` | Replaced | `lifecycle.triage` | Triaged |
| `loan.due-changed` | Loan due date changed | `reservation.placed` | Hold placed |
| `reservation.released` | Hold released | `document.uploaded` | Document attached |
| `document.signed` | Document signed | `secret.created` | Secret added |
| `SECRET_READ` | Secret read | `approval.requested` | Change requested |
| `comment` | Comment | `unit-update` | Units updated |
| `submit` | Submitted | `it-review` | IT review |
| `it-reject` | Returned by IT | `request-info` | Info requested |
| `cancel` | Cancelled | `complete` | Completed |
| `finance.confirm` | Finance confirmed | `it.verify` | IT verified |
| `finance.return` | Returned by Finance | `finance.resubmit` | Resubmitted |
| `supplier-set` | Supplier set | `employee.transferred` | Transferred |
| `offboarding.completed` | Offboarding completed | `acknowledgement.recorded` | Acknowledgement signed |
| `policy.exception.added` | Exception added | `policy.exception.waived` | Exception waived |
| `policy.exception.removed` | Exception removed | | |

### 3.6 Paging helper — `src/lib/paging.ts`, `src/lib/timeline.ts` (Phase 17 D-11)

*Amended (D-1, ruling R4):* the plan's unit expectation `parseIntParam("page=0", "page", 1) === 0` was wrong. `Number.parseInt("0", 10) || fallback` is **1**, because `||` reads 0 as absent — exactly the behaviour both hand-rolled parsers already had, so the helper preserves it rather than changing it. The shipped test expects 1 and says why.

`export function parseIntParam(params: URLSearchParams, key: string, fallback: number): number` — `Number.parseInt(params.get(key) ?? "", 10) || fallback`. `parsePage` becomes `Math.max(1, parseIntParam(params, "page", 1))`; `parseTimelineCursor` reads `skip` through it (its own clamp to `TIMELINE_MAX_SKIP` unchanged). `byWhenDesc` (timeline.ts:27) gains the comment: cuids are ASCII and compare byte-wise, so JS `<`/`>` orders them exactly as Postgres' `id desc` does — the tiebreaker matches the source queries.

---

## 4. Server

### 4.1 Audit queries — `src/server/modules/audit/queries.ts`

*Amended (D-3 / plan P-8):* `invisibleAssetIds` in `inventory/queries.ts` is **kept and called** — `invisibleAuditRefs` uses it for the asset list, so the asset rule lives in one place and the helper keeps a caller. *Amended (D-3 / plan P-9):* the action `groupBy` runs **inside** `listActivity`'s paged-snapshot count closure (stashed in a closure variable, the Phase 26 `listReservations` pattern), so rows, total and facet counts come from one RepeatableRead snapshot; the assignment is split across two statements for Prisma's generic inference. *Amended (D-9, from the final review's I-2):* `entityLabels` had **no branch for `asset-category` or `asset-type`**, so `/audit` and its export printed truncated cuids for exactly the two entity types this section class-scopes. Both now resolve to names — the category's own name linking to `/admin/asset-categories`, and `Category · Type` linking to `/admin/asset-types` — following the file's majority convention for admin rows rather than `department`'s unlinked label.

```ts
/** Phase 27 (spec §3.3): every class-bearing row this role may not see. Four empty lists for an all-class role, no query. */
export async function invisibleAuditRefs(role: Role): Promise<HiddenAuditRefs> {
  const hidden = ASSET_CLASSES.filter((c) => !canSeeClass(role, c));
  if (hidden.length === 0) return NO_HIDDEN_REFS;
  const cls = { in: [...hidden] };
  const [assets, approvals, categories, types] = await Promise.all([
    prisma.asset.findMany({ where: { cls }, select: { id: true } }),
    prisma.approval.findMany({ where: { asset: { cls } }, select: { id: true } }),          // assetId null → no class → never hidden
    prisma.assetCategory.findMany({ where: { cls }, select: { id: true } }),
    prisma.assetType.findMany({ where: { category: { cls } }, select: { id: true } }),
  ]);
  return { assetIds: ids(assets), approvalIds: ids(approvals), categoryIds: ids(categories), typeIds: ids(types) };
}
```

`listAudit(state, hidden: HiddenAuditRefs)`; `audit/page.tsx` and `audit/export/route.ts` call `invisibleAuditRefs` once and pass the same object to `listAudit` and the entity-facet `groupBy`. `invisibleAssetIds` in `inventory/queries.ts` stays for its other callers (the plan lists them); the inventory feed no longer calls it.

**`listActivity(feed, state, hidden)`** (same module, next to `entityLabels`) returns `{ items: ActivityItem[]; total; page; pageCount; actionOptions: FacetOption[] }`:
- inside one `pagedSnapshot(LOG_PAGE_SIZE, …)`: the count closure runs `groupBy({ by: ["action"], where: buildActivityWhere(feed, withoutAction(state), hidden), _count: true })` for the facet (the facet's own selection removed, the `/audit` rule) and returns `count({ where: buildActivityWhere(feed, state, hidden) })`; the rows closure pages `findMany` ordered `createdAt desc, id desc`;
- items: `entityLabels` + `auditSentence` + `actionDot`, the mapping the four pages do by hand today, moved here; `domain` set only for the finance feed;
- `actionOptions`: `{ value: action, label: actionLabel(action), count }` sorted by count desc, then label.

### 4.2 Reference data — `admin/reference-actions.ts`, `admin/policy-actions.ts`, `stock/item-actions.ts`, `suppliers/actions.ts`

*Amended (D-4, ruling R5):* the consolidation is **scoped to these five modules**, as this section names them. The plan's grep gate (“`P2002` only in `prisma-errors.ts`”) was wider than the spec: six pre-existing inline `P2002` checks live elsewhere — `suppliers/bank-actions`, `admin/webhook-actions`, `approvals`, `employees`, `offboarding`, and `receiving`/`reservations` actions. Each is correct, carries its own module's message and touches no `lower()` index, so they stay and are recorded in `HANDOVER.md` (t) and `HANDOVER-PENDING.md` §6 as a mechanical swap for whoever next opens those files. Two other execution facts: the policy check surfaces its named message through a thrown marker, because that module's private `asActionResult` would otherwise flatten it; and `inventory/actions.ts`' weaker local `uniqueTarget` was deleted while its two approval-race catches kept their own messages.

Guard order unchanged (role → rate → zod). Before the write, inside the same transaction, one case-insensitive lookup that returns the existing row's name or null:

```ts
// reference-actions.ts — categories, departments; types scoped to their category
const clash = await tx[model].findFirst({
  where: { name: { equals: name, mode: "insensitive" }, ...(entity === "type" ? { categoryId } : {}), ...(excludeId ? { id: { not: excludeId } } : {}) },
  select: { name: true },
});
if (clash) return validationError({ name: `That name is already taken by "${clash.name}"` });
```

Renames pass the row's own id as `excludeId`, so "Laptop" → "LAPTOP" is a rename, not a clash. Copy per module (pinned, §9):

| module | field | message |
|---|---|---|
| categories, types, departments | `name` | `That name is already taken by "{existing}"` |
| policies | `name` | `That policy name is already taken by "{existing}"` |
| suppliers | `name` | `A supplier with this name already exists: "{existing}"` |
| stock categories | `name` | `A category with this name already exists: "{existing}"` |
| stock categories | `prefix` | `That prefix is already in use by "{existing category name}"` |

The `P2002` catch after the write stays as the race net with each module's existing generic message, now through `isUniqueViolation`/`uniqueTarget` (§3.2). One `writeAudit` per write, unchanged.

---

## 5. Screens

### 5.1 `/audit` — `app/(app)/audit/page.tsx`, `audit/export/route.ts`

*Amended (D-3 / plan P-10):* the entity facet labels `vendor` as **“Supplier”** through a one-entry override map consulted before `humanize` (which would print “Vendor”); the other three new types humanise correctly. *Recorded, not fixed (final review M-2):* the row's entity **pill** still renders the raw `vendor` while the facet and the chip say “Supplier”. The fix is a one-line `humanize` on the pill, but the pill is CSS-uppercased and an existing e2e asserts `ASSET` on it, so it needs its own e2e pass — carried in `HANDOVER.md` (t) and `HANDOVER-PENDING.md` §6.

No visible change except: IT and viewer accounts no longer see Purchasing approvals, categories or types in the log or the export; the Entity dropdown lists Supplier, Stock item, Stock category and Stocktake.

### 5.2 The four activity feeds — `app/(app)/{inventory,employees,finance,purchases}/activity/page.tsx`, new `components/patterns/activity-toolbar.tsx`

*Amended (D-5 / plan P-2):* the wiring this section describes lives in **one** server component, `src/components/patterns/activity-list-page.tsx` (`ActivityListPage`), which does parse → refs → `listActivity` → toolbar → feed → pagination; each `activity/page.tsx` is a five-line wrapper passing `feed`, `title`, `base` and its own empty-state copy. “The four pages shrink to parse, query, render” is met with one copy of the wiring instead of four. *Amended (D-9, final review M-3):* the pagination and facet hrefs **drop a stray `?q=`** — `serializeListState` emitted the (always empty) search key for feeds that have no search box.

Each page becomes: `requireUser` → `parseListState(sp, ACTIVITY_LIST_CONFIG)` → `invisibleAuditRefs(user.role)` → `listActivity(feed, state, hidden)` → `PageHeader` (copy unchanged) → `ActivityToolbar` → `ActivityFeed` → `Pagination` with hrefs from `serializeListState` so a page change keeps the facet. Finance keeps its domain pill.

`ActivityToolbar({ state, total, actionOptions })` mirrors `AuditToolbar` minus the search box: one `FacetDropdown label="Action"`, applied through `withFilter(state, "action", values)` and `serializeListState(…, ACTIVITY_LIST_CONFIG)` on the current pathname; a **Clear** link (visible only with a selection) to the bare path; the count `{total} entries` (singular `entry`) with `aria-live="polite"`. Empty state when the filter matches nothing: `EmptyState` "No entries match this filter" with the same Clear link; the unfiltered empty copy each page shows today is unchanged.

### 5.3 Reference-data forms

No new UI. The named message renders where the field error renders today (`components/admin/ref-table.tsx` inline `role="alert"`, the policy, supplier and stock-category forms' existing field errors).

### 5.4 Inventory rows open on Enter — `components/ui/table.tsx`, `components/inventory/inventory-table.tsx`, `components/employees/employees-table.tsx`, `components/reservations/holds-table.tsx`

```ts
/** A whole-row link: focusable, opens on click (not on a text selection) and on Enter pressed on the row itself. */
export function rowOpenProps(open: () => void): Pick<React.HTMLAttributes<HTMLTableRowElement>, "tabIndex" | "onClick" | "onKeyDown"> {
  return {
    tabIndex: 0,
    onClick: () => { if (window.getSelection()?.toString()) return; open(); },
    onKeyDown: (e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}
```

`InventoryTable`'s row spreads `rowOpenProps(() => router.push(`/inventory/${row.id}`))` (its checkbox cell keeps `stopPropagation`; `selected` and `className` unchanged); `EmployeesTable` and `HoldsTable` replace their duplicated six lines with the same spread. Behaviour of the two existing tables is byte-for-byte the same.

### 5.5 The small visible fixes

*Amended (D-6 / plan P-3):* `Stat`'s accent is **`text-accent` on the value span plus a `data-tone` attribute** — coloured text, no pill chrome, because a stat number is not a pill; `tone` defaults to `"neutral"`. The `data-tone` attribute was reviewed and kept (state attributes already ship in this codebase). *Amended (D-6 / plan P-5):* the combobox blast radius listed below is corrected — the specs that actually drive an `EntityCombobox` are `custody`, `department-owned`, `direct-lifecycle`, `holds`, `it-gaps`, `quick-forms`, `registration`, `stock` and `stock-lots` (`it-core`, `transfers`, `purchasing-ext` and `stocktake` have none; `suppliers` and `auth-shell` only touch the command palette). They ran green in two foreground chunks — 39 passed (3.4m) and 48 passed (4.5m) — after one sanctioned test fix: `e2e/quick-forms.spec.ts` case 2 relied on focus opening the list and now clicks. *Amended (D-9, final review M-5):* the synthetic “No supplier” option is keyed and identified as **`none`** rather than by its empty value, so it cannot collide with a real option's id; the sentinel is commented on the receive form.

- **Work-page note** (`components/home/worklist.tsx:43`): `Showing the first {g.rows.length} — the oldest first.` — the number of rows actually rendered, which is what "showing" means; `g.total` keeps driving the section header. (Phase 17 D-11.)
- **Purchasing Home tile** (`app/(app)/page.tsx:132`, `components/ui/stat.tsx`): `Stat` gains `tone?: "neutral" | "accent"` (default neutral; accent renders the value in the `DuePill` accent colour token); the "Stocktakes past close-by" stat passes `tone={d.stocktakesOverdue > 0 ? "accent" : "neutral"}`. (Phase 23 D-15 #1.)
- **Receive form "No supplier"** (`components/stock/receive-form.tsx:183-192`): the supplier combobox's options lead with `{ value: "", label: "No supplier" }`; picking it calls `onChange("")` → `supplierId` cleared, the field shows empty. (Phase 23 D-15 #2; the Phase 23 spec §8 asked for it.)
- **Combobox does not open on mount** (`components/patterns/entity-combobox.tsx:91-93`): `onFocus` only resets `active`; the list opens on click (`onClick={() => setOpen(true)}`), on typing (`onChange`, already) and on ArrowDown (already). `autoFocus` keeps putting the caret in the field. This removes the second listbox on `/stock/issue` and `/stock/receive`. Every combobox in the app shares this component, so the plan's task for it runs the specs that pick from a combobox (stock, stock-lots, stocktake, quick-forms, custody, it-core, transfers, suppliers, purchasing-ext) before its review, and the battery covers the rest. (Phase 23 D-15 #3.)
- **Inventory rows open on Enter** — §5.4. (Decision 7.)

### 5.6 The one-liners (Phase 17 D-11, Phase 18 D-19, Phase 19 D-30, Phase 24 M-11)

- `src/lib/paging.ts` / `src/lib/timeline.ts` — §3.6 (helper + comment).
- `components/suppliers/use-supplier-runner.ts:21,62` — `setError`/`setFieldErrors` leave the returned object (no caller reads them).
- `server/modules/suppliers/queries.ts:109-113` — `documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] }`.
- `prisma/seed.ts:652` — the `CM-0002` weekly-cleaning issue moves to `day(-11)`, before the stocktake snapshot it must precede.
- `e2e/it-gaps.spec.ts` cases 1 and 3 — the mutations move inside `try { … } finally { restore }`, the file's own shape.
- **Ruling, no change:** the lapsed-contract banner on the supplier page keeps `tone="attention"` — the Phase 18 plan prescribed it, and a lapsed contract is a heads-up, not a fault. Recorded in the plan's D-block and HANDOVER-PENDING §5.3.
- **Ruling, docs only:** Phase 23 D-15's remaining "§5.4/§8 wording" item is the "No supplier" clear (now shipped); HANDOVER-PENDING §5.3 closes the line.

---

## 6. Errors and edge cases

- **A race between two creates** with the same name in different case: the pre-check passes for both, the second `INSERT` hits the `lower()` index, the module's `P2002` catch returns its generic message. Never a thrown error past the action.
- **Renaming to the same name in another case** is allowed (`excludeId` excludes the row itself).
- **A type named like a type in another category** stays allowed (the type check and index are scoped by `categoryId`).
- **Stock prefix**: the schema already upper-cases it; the `lower()` index and the check are belt and braces.
- **Audit refs for an all-class role**: `invisibleAuditRefs` runs no query and `buildAuditWhere` emits no `NOT`; the unit test asserts the absence of the key.
- **An approval with no asset** is never hidden (class-less, mirrors the approvals queue).
- **Facet counts** exclude the facet's own selection, so unchecking one action never zeroes the others; the total in the toolbar counts the filtered rows; both come from one snapshot.
- **An action with no label** shows its raw name in the dropdown; an action with no sentence renders the default; neither throws.
- **A feed filtered to an action with no rows** shows the filtered empty state with Clear; the URL keeps `?action=`.
- **Combobox opening**: a user who tabs into a combobox sees no list until they type, press ArrowDown or click — `aria-expanded` is false until then, which is the ARIA 1.2 combobox default.
- **Enter on a row while focus is inside a link or button in it** does nothing extra (`e.target === e.currentTarget`).
- **The migration on a database with a case-duplicate** fails with Postgres' duplicate-key message and leaves the schema unchanged; the deployment note carries the check to run first (§3.1). Staging is clean as of 2026-09-22.

---

## 7. Tests

*Amended (D-7 / plan P-4):* case 3's “upload via the record's Documents tab” is replaced by the e2e **writing the audit rows it renders** (`db.auditEntry.create` for `document.uploaded`, an `import-update` and a Purchasing asset row) and leaving them — `AuditEntry` is append-only, the sentence renderer is the unit under test, and the upload flow itself is already covered by `it-core.spec.ts`. *Amended (D-7):* the shipped `--list` total is **377 tests in 36 files**, not 378 — the plan counted `e2e/it-gaps.spec.ts`' two `try`/`finally` edits as new cases when they are edits to existing ones; thirteen cases are genuinely new (`activity` 7, `admin` +3, `approvals-audit` +1, `stock` +1, `suppliers` +1). *Amended (D-7), ten recorded adaptations, three of them worth keeping as e2e conventions:* the seed holds no `lifecycle.assign` audit row, so activity case 1 writes its own; `?q=<exact tag>` **redirects to the record**, so a search case must use a partial (`?q=0148`); `getByRole("alert")` collides with Next's route announcer, so assertions scope to `p[role="alert"]`; and Postgres' jsonb reorders diff keys, which is why `fieldList` sorts (M-1). *Amended (D-9):* two cases adapted to the fix wave — the audit-hygiene case locates its category row by name now that `entityLabels` resolves it, and activity case 1 picks its facet option by the exact label span, because the new “Assigned (approved request)” label made `getByLabel("Assigned")` ambiguous.

**Unit** (`vitest`): `audit-list.test.ts` rewritten for `HiddenAuditRefs` (each type alone, mixed, all empty → no `NOT`); `activity-list.test.ts` (four feeds, the asset hiding in inventory and finance, the action filter, no filter → the bare base); `activity.test.ts` (each new sentence, `fieldLabel` known keys and the fallback, `update`/`import-update` through the dictionary, the default pinned on `flag-enable`, `actionLabel` fallback); `prisma-errors.test.ts` (array target, string target, non-Prisma error); `paging.test.ts` (`parseIntParam` fallback and `parsePage` clamp); a `Stat` tone test only if a component test harness already exists (none does today — skip).

**e2e** (new cases; each seeds nothing, restores what it changes, never deletes audit rows):

`e2e/admin.spec.ts` (+3): as admin, create category "Laptop" exists → "laptop" refused with `That name is already taken by "Laptop"`; rename "Headset" to "HEADSET" accepted and back; a department "hr" refused against "HR". `e2e/stock.spec.ts` (+1): stock category "office supplies" refused, prefix clash refused with the prefix message. `e2e/suppliers.spec.ts` (+1): a same-name-different-case supplier refused with the supplier message.

`e2e/approvals-audit.spec.ts` (+1): admin creates a Purchasing-class category "Phase 27 Fleet" (audit row `create` on `asset-category`); `/audit?entity=asset-category` as `it@` does not list it, as `admin@` does; a seeded Purchasing approval row is absent for `it@` under `entity=approval`; cleanup deletes the category (the audit rows stay — append-only).

New `e2e/activity.spec.ts` (joins chunk **E2**, the lightest): 1 the Action facet on `/inventory/activity` lists labels with counts, choosing "Assigned" narrows the feed, the URL carries `action=lifecycle.assign`, page 2 (if any) keeps it, Clear returns to the full feed; 2 `it@` sees no Purchasing rows on `/inventory/activity` while `admin@` does; 3 an attached document reads as "attached <file> to <tag>" (upload via the record's Documents tab, then the feed); 4 an `import-update` row written directly by `db` with `{ departmentId, joinedAt }` reads "updated department, join date on <name> by import" on `/employees/activity`; 5 `/inventory` rows: Tab to a row, Enter opens the record; 6 `/stock/receive` loads with no open listbox (`[role=listbox]` count 0), a click opens it, and "No supplier" clears a chosen supplier; 7 Purchasing Home's stocktake tile carries the accent class when a stocktake is overdue (drive by creating an overdue stocktake via `db`, restore after).

**Battery:** the seven chunks; `e2e/activity.spec.ts` joins E2; expected `--list` 364 + new cases.

---

## 8. Files

- **New:** `prisma/migrations/<ts>_case_insensitive_names/migration.sql`; `src/server/prisma-errors.ts` (+test); `src/lib/activity-list.ts` (+test); `src/components/patterns/activity-toolbar.tsx`; `e2e/activity.spec.ts`.
- **Modified:** `prisma/schema.prisma` (the `AuditEntry` index), `prisma/seed.ts`; `src/lib/audit-list.ts` (+test), `src/lib/activity.ts` (+test), `src/lib/paging.ts` (+test), `src/lib/timeline.ts`; `src/server/modules/audit/queries.ts`, `finance/queries.ts`, `admin/reference-actions.ts`, `admin/policy-actions.ts`, `stock/item-actions.ts`, `suppliers/actions.ts`, `suppliers/queries.ts`, `inventory/actions.ts`; `src/app/(app)/audit/page.tsx`, `audit/export/route.ts`, the four `activity/page.tsx`, `src/app/(app)/page.tsx`; `src/components/ui/table.tsx`, `ui/stat.tsx`, `patterns/entity-combobox.tsx`, `home/worklist.tsx`, `inventory/inventory-table.tsx`, `employees/employees-table.tsx`, `reservations/holds-table.tsx`, `stock/receive-form.tsx`, `suppliers/use-supplier-runner.ts`; `e2e/admin.spec.ts`, `e2e/stock.spec.ts`, `e2e/suppliers.spec.ts`, `e2e/approvals-audit.spec.ts`, `e2e/it-gaps.spec.ts`.
- **Docs (closing task):** `docs/HANDOVER.md` (line 3, a new (t) block, §0 item 9's chunk E2, §8 closures for the three IT items and the database-only index list), `docs/PICKUP.md` (Branch, Database → **26 migrations**, Battery, Last two phases, §4 item 1, §5), `docs/HANDOVER-PENDING.md` (§1 rewritten — it still says "redeploy staging to pick up Phase 19"; §5.3 and §6 closures; the three decisions), this spec's Status line, the plan's D-block.

## 9. Constraints (binding on every task)

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write in its transaction; `AuditEntry` is append-only at the database — no test deletes audit rows.
- Copy pinned verbatim: the conflict messages (§4.2), the sentences (§3.5), the action labels (§3.5), the field labels (§3.5), "No supplier", "No entries match this filter", "Showing the first N — the oldest first.", "{total} entries"/"entry".
- The migration is created in the worktree with `prisma migrate dev --create-only`, the raw SQL appended, then `migrate dev --skip-seed` against `inventory_dev` only; never reset a database; never run the seed while another agent tests.
- `schema.prisma` gains only the `AuditEntry` index; the seven unique indexes live in SQL and in the docs' database-only list.
- Product `aria-label`s near a field never contain that field's label word; the Action dropdown's label is "Action".
- Dev only in the git worktree with its own `.env` (`inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`, no `SEED_PASSWORD`); Playwright foreground, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a time, port free before and after; only one implementer walks a dev server at a time.
- Docs are CRLF; HANDOVER's lettered blocks are not in one order — anchor edits on block headers.
