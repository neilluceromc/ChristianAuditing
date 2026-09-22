# Phase 27 — IT and quality leftovers sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three IT items every phase since 24 carried forward (audit class scoping, case-insensitive reference names, the activity feeds' facet and sentences), pay down the parked Minors that are cheap or visible, and record the three open design decisions.

**Architecture:** Pure rules first (`src/lib`: hidden audit refs, the activity list config and where-builder, sentences, action labels, field labels, a shared int parser; `src/server/prisma-errors.ts` gains the unique-violation helpers), then the server (one `invisibleAuditRefs`, `listAudit` on refs, one `listActivity`, the pre-write name checks in four action modules), then the screens (one `ActivityListPage` server component and `ActivityToolbar` serve all four feeds; the visible smalls), then e2e, then the battery and docs. Migration 26 = the `AuditEntry (entityType, action)` index Prisma generates plus seven raw `lower()` unique indexes appended by hand.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, zod 4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-09-22-leftovers-sweep-design.md` (decisions 1–9, §3–§9). Facts gathered before this plan: the root `.superpowers/sdd/phase-27-facts-a.md`, `phase-27-facts-b.md`, `phase-27-plan-facts-server.md`, `phase-27-plan-facts-ui.md` (verbatim current code; copy into the SDD workspace's `briefs/`).

## Global Constraints

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write in its transaction; `AuditEntry` is append-only at the database — no test deletes audit rows (tests may INSERT audit rows and leave them; Phase 26 P-8 precedent).
- Copy pinned verbatim: conflict messages (spec §4.2 table), sentences (§3.5), action labels (§3.5), field labels (§3.5), "No supplier", "No entries match this filter", "Showing the first N — the oldest first.", "{total} entries" / "1 entry", "Clear".
- The migration is created in the worktree with `npx prisma migrate dev --create-only --name case_insensitive_names`, the raw SQL appended to the generated file, then `npx prisma migrate dev --skip-seed` against `inventory_dev` only. Never reset a database. Never run the seed while another agent tests. `schema.prisma` gains only the `AuditEntry` index.
- `src/server/prisma-errors.ts` ALREADY EXISTS (it exports `asActionResult`, a P2028/P2025/P2003 handler used by flag/user/webhook actions) — Task 1 ADDS to it; nothing there is touched or merged. `admin/policy-actions.ts` keeps its own private `asActionResult` (different P2003 meaning) — leave it.
- Product `aria-label`s near a field never contain that field's label word. The Action dropdown's label is "Action".
- Dev only in the git worktree with its own `.env` (`DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.183:3100`, no `SEED_PASSWORD`); never read or print `.env`. Playwright foreground, `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000` (`--workers=1` is a CLI flag — the config sets none), one process at a time, port 3100 free before and after (`netstat -ano | findstr :3100 | findstr LISTENING`), never a dev server left behind. Only ONE implementer walks a dev server (`npm run dev -- -p 3100`) or runs Playwright at a time.
- Docs are CRLF; HANDOVER's lettered blocks are not in one order — anchor edits on block headers. Commits use the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; `git add` new files before a pathspec commit; never amend.
- After `npm ci`: `npx prisma generate`. Task-end gate for every task: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` all clean.

## Plan-level decisions (P-1…P-10; the executor's D-block records anything that changes them)

- **P-1 Execution order:** T1 → (T2 ∥ T3; only T3 walks 3100) → T4 (walks) → T5 (walks, runs Playwright) → T6 (Playwright) → T7 (battery + docs). Nothing else runs Playwright or the seed while T5/T6/T7 do.
- **P-2 One server component for the four feeds:** `src/components/patterns/activity-list-page.tsx` (`ActivityListPage`) does parse → refs → `listActivity` → toolbar → feed → pagination; each `activity/page.tsx` becomes a five-line wrapper passing `feed`, `title`, `base` and its empty-state copy. Spec §5.2's "the four pages shrink to parse, query, render" is met with one copy instead of four.
- **P-3 `Stat` accent = `text-accent`** on the value span (coloured text, no pill chrome — a stat number is not a pill). `tone` defaults to `"neutral"`.
- **P-4 The activity e2e writes the audit rows it renders** (`document.uploaded`, `import-update`, a Purchasing asset row) directly with `db.auditEntry.create` and leaves them (append-only). The sentence renderer is the unit under test; the upload flow itself is covered by `it-core.spec.ts`. Spec §7 case 3's "upload via the Documents tab" is replaced by this.
- **P-5 Combobox blast radius (corrected from spec §5.5):** the specs that drive an `EntityCombobox` are `custody`, `department-owned`, `direct-lifecycle`, `holds`, `it-gaps`, `quick-forms`, `registration`, `stock`, `stock-lots`. T5 runs them in two foreground chunks. (`it-core`, `transfers`, `purchasing-ext`, `stocktake` have no combobox; `suppliers` and `auth-shell` only touch the command palette.)
- **P-6 `e2e/activity.spec.ts` joins chunk E2** (`stock`, `stocktake`, `stock-lots`, `stock-reports`, the lightest chunk at 31 tests).
- **P-7 `financeActivityWhere` is removed** from `finance/queries.ts` (its one caller was the finance feed; Home has no copy) — `feedWhere("finance", …)` in `src/lib/activity-list.ts` is the predicate.
- **P-8 `invisibleAssetIds` stays** in `inventory/queries.ts`; `invisibleAuditRefs` calls it for the asset list, so it keeps one caller and the asset rule lives once.
- **P-9 Facet counts inside the snapshot:** `listActivity`'s count closure runs the action `groupBy` first (stashed in a closure variable) and returns the filtered count — the Phase 26 `listReservations` pattern, so rows, total and facet counts come from one RepeatableRead snapshot.
- **P-10 The `/audit` entity-facet label for `vendor` is "Supplier"** via a one-entry override map before `humanize` (which would print "Vendor"); the other three new types humanise correctly.

---

## File structure

- **Rules (pure, unit-tested):** `src/lib/audit-list.ts` (+test) — hidden refs; `src/lib/activity-list.ts` (+test, new) — feeds, config, where; `src/lib/activity.ts` (+test) — sentences, `ACTION_LABELS`/`actionLabel`, `FIELD_LABELS`/`fieldLabel`; `src/lib/paging.ts` (+test) — `parseIntParam`; `src/lib/timeline.ts` — comment + helper use; `src/server/prisma-errors.ts` (+test, new test) — `isUniqueViolation`, `uniqueTarget`.
- **Data:** `prisma/schema.prisma` (one index), `prisma/migrations/<ts>_case_insensitive_names/migration.sql` (new), `prisma/seed.ts` (one date).
- **Server:** `src/server/modules/audit/queries.ts` — `invisibleAuditRefs`, `listAudit(state, hidden)`, `listActivity`; `finance/queries.ts` (constant removed); `admin/reference-actions.ts`, `admin/policy-actions.ts`, `stock/item-actions.ts`, `suppliers/actions.ts`, `inventory/actions.ts` (helper consolidation + pre-write checks); `suppliers/queries.ts` (tiebreaker).
- **Screens:** `src/app/(app)/audit/page.tsx`, `audit/export/route.ts`; `src/components/patterns/activity-toolbar.tsx` (new), `activity-list-page.tsx` (new), the four `activity/page.tsx`; `src/components/ui/table.tsx` (`rowOpenProps`), `ui/stat.tsx`, `patterns/entity-combobox.tsx`, `home/worklist.tsx`, `inventory/inventory-table.tsx`, `employees/employees-table.tsx`, `reservations/holds-table.tsx`, `stock/receive-form.tsx`, `suppliers/use-supplier-runner.ts`, `src/app/(app)/page.tsx`.
- **e2e:** `e2e/activity.spec.ts` (new); `e2e/admin.spec.ts`, `e2e/stock.spec.ts`, `e2e/suppliers.spec.ts`, `e2e/approvals-audit.spec.ts`, `e2e/it-gaps.spec.ts`.
- **Docs (T7):** `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, the spec's Status line, this plan's D-block.

---

### Task 1: Pure rules, the shared helpers and migration 26

**Files:**
- Modify: `src/server/prisma-errors.ts` (append two exports; keep `asActionResult` byte-for-byte), Create: `src/server/prisma-errors.test.ts`
- Modify: `src/lib/audit-list.ts`, `src/lib/audit-list.test.ts`
- Create: `src/lib/activity-list.ts`, `src/lib/activity-list.test.ts`
- Modify: `src/lib/activity.ts`, `src/lib/activity.test.ts`
- Modify: `src/lib/paging.ts`, `src/lib/paging.test.ts`, `src/lib/timeline.ts`
- Modify: `prisma/schema.prisma` (`model AuditEntry`), Create: `prisma/migrations/<ts>_case_insensitive_names/migration.sql`, Modify: `prisma/seed.ts:652`

**Interfaces:**
- Produces: `isUniqueViolation(err): err is Prisma.PrismaClientKnownRequestError`, `uniqueTarget(err): string[]` (`@/server/prisma-errors`); `HiddenAuditRefs`, `NO_HIDDEN_REFS`, `buildAuditWhere(state, hidden = NO_HIDDEN_REFS)`, `AUDIT_ENTITY_TYPES` (+4) (`@/lib/audit-list`); `ACTIVITY_FEEDS`, `ActivityFeed`, `ACTIVITY_LIST_CONFIG`, `feedWhere(feed, hidden)`, `buildActivityWhere(feed, state, hidden)` (`@/lib/activity-list`); `ACTION_LABELS`, `actionLabel(action)`, `FIELD_LABELS`, `fieldLabel(key)` and the new `auditSentence` cases (`@/lib/activity`); `parseIntParam(params, key, fallback)` (`@/lib/paging`).
- Consumes: nothing new.

- [ ] **Step 1: Prisma error helpers — failing test**

Create `src/server/prisma-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isUniqueViolation, uniqueTarget } from "./prisma-errors";

const p2002 = (target: unknown) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6", meta: { target } });

describe("isUniqueViolation / uniqueTarget — one P2002 reader for every writer", () => {
  it("recognises P2002 and nothing else", () => {
    expect(isUniqueViolation(p2002(["serial"]))).toBe(true);
    expect(isUniqueViolation(new Prisma.PrismaClientKnownRequestError("gone", { code: "P2025", clientVersion: "6" }))).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });
  it("reads a Prisma-declared index's column array and a raw index's name string alike", () => {
    expect(uniqueTarget(p2002(["categoryId", "name"]))).toEqual(["categoryId", "name"]);
    expect(uniqueTarget(p2002("StockCategory_prefix_lower_key"))).toEqual(["StockCategory_prefix_lower_key"]);
    expect(uniqueTarget(p2002(undefined))).toEqual([]);
    expect(uniqueTarget(new Error("boom"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`npx vitest run src/server/prisma-errors.test.ts` → "isUniqueViolation is not exported").

- [ ] **Step 3: Append to `src/server/prisma-errors.ts`** (after `asActionResult`; the `Prisma` import already exists at line 1):

```ts

/** Phase 27 (spec §3.2): any unique-index violation — Prisma's own @unique and the raw lower() indexes alike. */
export function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * P2002 meta.target is a column array (["serial"]) for a Prisma-declared index or the index NAME
 * string ("StockCategory_prefix_lower_key") for a raw one — callers match with `.includes()`, which
 * reads both shapes; keep every caller on includes().
 */
export function uniqueTarget(err: unknown): string[] {
  if (!isUniqueViolation(err)) return [];
  const target = (err.meta as { target?: string[] | string } | undefined)?.target;
  return Array.isArray(target) ? target : target ? [String(target)] : [];
}
```

- [ ] **Step 4: Run it — PASS.**

- [ ] **Step 5: Audit list — rewrite the hidden test**

In `src/lib/audit-list.test.ts` replace the import line and the last `it` block:

```ts
import { AUDIT_ENTITY_TYPES, AUDIT_LIST_CONFIG, NO_HIDDEN_REFS, buildAuditWhere } from "./audit-list";
```

```ts
  it("lists the four Phase 27 entity types the page already renders", () => {
    expect(AUDIT_ENTITY_TYPES).toEqual(expect.arrayContaining(["vendor", "stock-item", "stock-category", "stocktake"]));
  });
  it("hides class-bearing rows per entity type, and emits no clause when nothing is hidden", () => {
    const state = parse("");
    expect(buildAuditWhere(state)).not.toHaveProperty("NOT");
    expect(buildAuditWhere(state, NO_HIDDEN_REFS)).not.toHaveProperty("NOT");
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, assetIds: ["a1"] })).toMatchObject({
      NOT: { OR: [{ entityType: "asset", entityId: { in: ["a1"] } }] },
    });
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, approvalIds: ["p1"] }).NOT).toEqual({ OR: [{ entityType: "approval", entityId: { in: ["p1"] } }] });
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, categoryIds: ["c1"] }).NOT).toEqual({ OR: [{ entityType: "asset-category", entityId: { in: ["c1"] } }] });
    expect(buildAuditWhere(state, { ...NO_HIDDEN_REFS, typeIds: ["t1"] }).NOT).toEqual({ OR: [{ entityType: "asset-type", entityId: { in: ["t1"] } }] });
    expect(buildAuditWhere(state, { assetIds: ["a1"], approvalIds: ["p1"], categoryIds: [], typeIds: ["t1"] }).NOT).toEqual({
      OR: [
        { entityType: "asset", entityId: { in: ["a1"] } },
        { entityType: "approval", entityId: { in: ["p1"] } },
        { entityType: "asset-type", entityId: { in: ["t1"] } },
      ],
    });
  });
```

- [ ] **Step 6: Run — FAIL.** Then rewrite `src/lib/audit-list.ts` (whole file):

```ts
import type { Prisma } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";

export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "purchase-request", "user",
  "asset-category", "asset-type", "department", "equipment-policy",
  "feature-flag", "webhook-endpoint",
  "vendor", "stock-item", "stock-category", "stocktake", // Phase 27 (spec §3.3): rows the page already renders and links
] as const;

export const AUDIT_LIST_CONFIG: ListConfig = {
  facets: ["entity"],
  sortable: [], // append-only log renders newest-first, always
  defaultSort: [],
};

/** Ids of the class-bearing rows a role may NOT see — one list per audit entityType that has a class (spec §3.3). */
export interface HiddenAuditRefs { assetIds: string[]; approvalIds: string[]; categoryIds: string[]; typeIds: string[] }
export const NO_HIDDEN_REFS: HiddenAuditRefs = { assetIds: [], approvalIds: [], categoryIds: [], typeIds: [] };

export function buildAuditWhere(state: ListState, hidden: HiddenAuditRefs = NO_HIDDEN_REFS): Prisma.AuditEntryWhereInput {
  const where: Prisma.AuditEntryWhereInput = {};
  if (state.q) {
    where.OR = [
      { action: { contains: state.q, mode: "insensitive" } },
      { entityId: { contains: state.q, mode: "insensitive" } },
      { actorLabel: { contains: state.q, mode: "insensitive" } },
    ];
  }
  if (state.filters.entity?.length) where.entityType = { in: state.filters.entity };
  // Phase 14 (spec §3.1), generalised in Phase 27 (spec §3.3): rows about class-bearing things this
  // role cannot see are not its audit trail either. No clause at all for an all-class role.
  const branches = ([
    ["asset", hidden.assetIds], ["approval", hidden.approvalIds],
    ["asset-category", hidden.categoryIds], ["asset-type", hidden.typeIds],
  ] as const)
    .filter(([, ids]) => ids.length > 0)
    .map(([entityType, ids]) => ({ entityType, entityId: { in: [...ids] } }));
  if (branches.length) where.NOT = { OR: branches };
  return where;
}
```

- [ ] **Step 7: Run — PASS** (`npx vitest run src/lib/audit-list.test.ts`). `npx tsc --noEmit` will now FAIL at `audit/queries.ts`, `audit/page.tsx`, `audit/export/route.ts` (string[] passed where `HiddenAuditRefs` is expected) — expected until Task 2; do NOT touch those files in this task. Continue.

- [ ] **Step 8: Activity list — failing test**

Create `src/lib/activity-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACTIVITY_FEEDS, ACTIVITY_LIST_CONFIG, buildActivityWhere, feedWhere } from "./activity-list";
import { NO_HIDDEN_REFS } from "./audit-list";

const empty = { q: "", page: 1, sort: [], filters: {} };

describe("the activity feeds' list rules (spec §3.4)", () => {
  it("names the four feeds and one facet, no sort, no search", () => {
    expect(ACTIVITY_FEEDS).toEqual(["inventory", "employees", "finance", "purchases"]);
    expect(ACTIVITY_LIST_CONFIG).toEqual({ facets: ["action"], sortable: [], defaultSort: [] });
  });
  it("keeps each feed's base predicate", () => {
    expect(feedWhere("inventory", NO_HIDDEN_REFS)).toEqual({ entityType: "asset" });
    expect(feedWhere("employees", NO_HIDDEN_REFS)).toEqual({ entityType: "employee" });
    expect(feedWhere("purchases", NO_HIDDEN_REFS)).toEqual({ entityType: "purchase-request" });
    const finance = feedWhere("finance", NO_HIDDEN_REFS);
    expect(finance.OR).toHaveLength(2);
    expect(finance.OR?.[0]).toEqual({ entityType: "purchase-request" });
    expect(finance.OR?.[1]).toMatchObject({ entityType: "asset", diff: { path: ["cost"] } });
  });
  it("hides the assets a role cannot see, in the inventory feed and finance's asset branch", () => {
    const hidden = { ...NO_HIDDEN_REFS, assetIds: ["a1", "a2"] };
    expect(feedWhere("inventory", hidden)).toEqual({ entityType: "asset", entityId: { notIn: ["a1", "a2"] } });
    expect(feedWhere("finance", hidden).OR?.[1]).toMatchObject({ entityType: "asset", entityId: { notIn: ["a1", "a2"] } });
    expect(feedWhere("employees", hidden)).toEqual({ entityType: "employee" });
  });
  it("layers the action facet on top, and is the bare base without it", () => {
    expect(buildActivityWhere("employees", empty, NO_HIDDEN_REFS)).toEqual({ entityType: "employee" });
    expect(buildActivityWhere("inventory", { ...empty, filters: { action: ["lifecycle.assign", "create"] } }, NO_HIDDEN_REFS)).toEqual({
      AND: [{ entityType: "asset" }, { action: { in: ["lifecycle.assign", "create"] } }],
    });
  });
});
```

- [ ] **Step 9: Run — FAIL.** Create `src/lib/activity-list.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { HiddenAuditRefs } from "./audit-list";
import type { ListConfig, ListState } from "./url-state";

/** Phase 27 (spec §3.4): the four activity feeds, one list config, one where-builder. */
export const ACTIVITY_FEEDS = ["inventory", "employees", "finance", "purchases"] as const;
export type ActivityFeed = (typeof ACTIVITY_FEEDS)[number];

export const ACTIVITY_LIST_CONFIG: ListConfig = { facets: ["action"], sortable: [], defaultSort: [] };

/**
 * Each feed's base predicate, moved verbatim from its page. Asset rows a role cannot see (spec §3.3's
 * hidden refs) leave the inventory feed and finance's asset branch alike; the finance predicate was
 * `financeActivityWhere` in finance/queries.ts until Phase 27.
 */
export function feedWhere(feed: ActivityFeed, hidden: HiddenAuditRefs): Prisma.AuditEntryWhereInput {
  const assetRows = (extra: Prisma.AuditEntryWhereInput = {}): Prisma.AuditEntryWhereInput => ({
    entityType: "asset",
    ...extra,
    ...(hidden.assetIds.length ? { entityId: { notIn: hidden.assetIds } } : {}),
  });
  switch (feed) {
    case "inventory": return assetRows();
    case "employees": return { entityType: "employee" };
    case "finance": return { OR: [{ entityType: "purchase-request" }, assetRows({ diff: { path: ["cost"], not: Prisma.DbNull } })] };
    case "purchases": return { entityType: "purchase-request" };
  }
}

export function buildActivityWhere(feed: ActivityFeed, state: ListState, hidden: HiddenAuditRefs): Prisma.AuditEntryWhereInput {
  const base = feedWhere(feed, hidden);
  const actions = state.filters.action;
  return actions?.length ? { AND: [base, { action: { in: actions } }] } : base;
}
```

- [ ] **Step 10: Run — PASS.**

- [ ] **Step 11: Sentences, labels, field names — failing tests**

In `src/lib/activity.test.ts` change the import to `import { ACTION_LABELS, actionLabel, auditSentence, fieldLabel } from "./activity";` and REPLACE the "unknown actions degrade" test (lines 71-73) with:

```ts
  it("unknown actions degrade to actor — action — entity (pinned on one that never reaches a feed)", () => {
    expect(auditSentence({ ...base, action: "flag-enable" })).toBe("J. Sarmiento flag-enable BR-LT-0148");
  });
```

Append a new describe at the end of the file:

```ts
describe("Phase 27 (spec §3.5) — every action a feed can show reads as a sentence", () => {
  const nina = { ...base, entityLabel: "Nina Robles" };
  it("documents", () => {
    expect(auditSentence({ ...base, action: "document.uploaded", diff: { document: { from: null, to: "warranty.pdf" } } }))
      .toBe("J. Sarmiento attached warranty.pdf to BR-LT-0148");
    expect(auditSentence({ ...base, action: "document.signed", diff: { "handover.pdf": { from: "unsigned", to: "SIGNED" } } }))
      .toBe("J. Sarmiento marked handover.pdf signed on BR-LT-0148");
  });
  it("loan due date moved or cleared", () => {
    expect(auditSentence({ ...base, action: "loan.due-changed", diff: { loanDueAt: { from: null, to: "2026-10-05T00:00:00.000Z" } } }))
      .toBe("J. Sarmiento moved the loan due date of BR-LT-0148 to 05 Oct 2026");
    expect(auditSentence({ ...base, action: "loan.due-changed", diff: { loanDueAt: { from: "2026-10-05T00:00:00.000Z", to: null } } }))
      .toBe("J. Sarmiento cleared the loan due date of BR-LT-0148");
  });
  it("secrets and acknowledgements", () => {
    expect(auditSentence({ ...base, action: "secret.created", diff: { label: { from: null, to: "BIOS password" } } }))
      .toBe('J. Sarmiento added the secret "BIOS password" to BR-LT-0148');
    expect(auditSentence({ ...nina, action: "acknowledgement.recorded", diff: { signedAt: { from: null, to: "x" }, items: { from: null, to: "3" } } }))
      .toBe("J. Sarmiento recorded Nina Robles's signed acknowledgement of 3 items");
    expect(auditSentence({ ...nina, action: "acknowledgement.recorded", diff: { items: { from: null, to: "1" } } }))
      .toBe("J. Sarmiento recorded Nina Robles's signed acknowledgement of 1 item");
  });
  it("policy exceptions", () => {
    expect(auditSentence({ ...nina, action: "policy.exception.added", diff: { slot: { from: null, to: "tablet · iPad" }, reason: { from: null, to: "field work" } } }))
      .toBe("J. Sarmiento added the exception slot tablet · iPad for Nina Robles — field work");
    expect(auditSentence({ ...nina, action: "policy.exception.waived", diff: { slot: { from: "headset", to: null }, reason: { from: null, to: "remote" } } }))
      .toBe("J. Sarmiento waived headset for Nina Robles — remote");
    expect(auditSentence({ ...nina, action: "policy.exception.removed", diff: { slot: { from: "tablet · iPad", to: null } } }))
      .toBe("J. Sarmiento removed the exception slot tablet · iPad for Nina Robles");
  });
  it("supplier set or cleared on a request", () => {
    const pr = { ...base, entityLabel: "PR-0188" };
    expect(auditSentence({ ...pr, action: "supplier-set", diff: { supplier: { from: null, to: "TechServe PH" } } }))
      .toBe("J. Sarmiento set TechServe PH as the supplier on PR-0188");
    expect(auditSentence({ ...pr, action: "supplier-set", diff: { supplier: { from: "TechServe PH", to: null } } }))
      .toBe("J. Sarmiento cleared the supplier on PR-0188");
  });
  it("update and import-update print human field names", () => {
    expect(auditSentence({ ...nina, action: "import-update", diff: { departmentId: { from: "d1", to: "d2" }, joinedAt: { from: "a", to: "b" } } }))
      .toBe("J. Sarmiento updated department, join date on Nina Robles by import");
    expect(auditSentence({ ...base, action: "update", diff: { loanDueAt: { from: null, to: "x" }, warrantyUntil: { from: "a", to: "b" } } }))
      .toBe("J. Sarmiento updated loan due date, warranty end on BR-LT-0148");
  });
  it("fieldLabel reads the table and humanises the rest", () => {
    expect(fieldLabel("departmentId")).toBe("department");
    expect(fieldLabel("offboardingDueAt")).toBe("complete-by date");
    expect(fieldLabel("status")).toBe("status");
    expect(fieldLabel("someOtherId")).toBe("some other");
    expect(fieldLabel("repairEndedAt")).toBe("repair ended at");
  });
  it("actionLabel names the facet options and falls back to the raw action", () => {
    expect(actionLabel("lifecycle.assign")).toBe("Assigned");
    expect(actionLabel("import-update")).toBe("Imported (update)");
    expect(actionLabel("stock.received")).toBe("stock.received");
    expect(Object.keys(ACTION_LABELS).length).toBeGreaterThanOrEqual(36);
  });
});
```

- [ ] **Step 12: Run — FAIL.** Edit `src/lib/activity.ts`:

(a) Below the imports (line 1 `import { fmtDate } from "./format";`) add:

```ts

/** Phase 27 (spec §3.5): the facet's words for each action a feed can show; an unmapped action shows its raw name. */
export const ACTION_LABELS: Record<string, string> = {
  create: "Created", update: "Updated", register: "Registered",
  "import-create": "Imported (new)", "import-update": "Imported (update)",
  "lifecycle.assign": "Assigned", "lifecycle.return": "Returned", "lifecycle.change-status": "Status changed",
  "lifecycle.replace": "Replaced", "lifecycle.triage": "Triaged", "loan.due-changed": "Loan due date changed",
  "reservation.placed": "Hold placed", "reservation.released": "Hold released",
  "document.uploaded": "Document attached", "document.signed": "Document signed",
  "secret.created": "Secret added", SECRET_READ: "Secret read",
  "approval.requested": "Change requested", comment: "Comment", "unit-update": "Units updated",
  submit: "Submitted", "it-review": "IT review", "it-reject": "Returned by IT", "request-info": "Info requested",
  cancel: "Cancelled", complete: "Completed", "finance.confirm": "Finance confirmed", "it.verify": "IT verified",
  "finance.return": "Returned by Finance", "finance.resubmit": "Resubmitted", "supplier-set": "Supplier set",
  "employee.transferred": "Transferred", "offboarding.completed": "Offboarding completed",
  "acknowledgement.recorded": "Acknowledgement signed",
  "policy.exception.added": "Exception added", "policy.exception.waived": "Exception waived", "policy.exception.removed": "Exception removed",
};
export function actionLabel(action: string): string { return ACTION_LABELS[action] ?? action; }

/** Phase 27 (spec §3.5): raw diff keys → words, shared by the `update` and `import-update` sentences. */
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
/** Known keys read from the table; unknown ones lose a trailing "Id" and split camelCase: "repairEndedAt" → "repair ended at". */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

const fieldList = (diff: Record<string, unknown> | null) => (diff ? Object.keys(diff).map(fieldLabel).join(", ") : "fields");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
```

(b) The `update` case (lines 37-40) becomes:

```ts
    case "update":
      return `${entry.actorLabel} updated ${fieldList(diff)} on ${entry.entityLabel}`;
```

(c) The `import-update` case (lines 160-163) becomes:

```ts
    case "import-update":
      return `${entry.actorLabel} updated ${fieldList(diff)} on ${entry.entityLabel} by import`;
```

(d) Immediately BEFORE the `default:` case add the nine new cases:

```ts
    // Phase 27 (spec §3.5): every action that can reach a feed reads as a sentence.
    case "document.uploaded":
      return `${entry.actorLabel} attached ${String(diff?.document?.to ?? "a document")} to ${entry.entityLabel}`;
    case "document.signed": {
      const fileName = diff ? Object.keys(diff)[0] ?? "a document" : "a document";
      return `${entry.actorLabel} marked ${fileName} signed on ${entry.entityLabel}`;
    }
    case "loan.due-changed": {
      const to = diff?.loanDueAt?.to;
      return to
        ? `${entry.actorLabel} moved the loan due date of ${entry.entityLabel} to ${fmtDate(String(to))}`
        : `${entry.actorLabel} cleared the loan due date of ${entry.entityLabel}`;
    }
    case "secret.created":
      return `${entry.actorLabel} added the secret "${String(diff?.label?.to ?? "")}" to ${entry.entityLabel}`;
    case "acknowledgement.recorded":
      return `${entry.actorLabel} recorded ${entry.entityLabel}'s signed acknowledgement of ${plural(Number(diff?.items?.to ?? 0), "item")}`;
    case "policy.exception.added": {
      const reason = diff?.reason?.to;
      return `${entry.actorLabel} added the exception slot ${String(diff?.slot?.to ?? "")} for ${entry.entityLabel}${reason ? ` — ${String(reason)}` : ""}`;
    }
    case "policy.exception.waived": {
      const reason = diff?.reason?.to;
      return `${entry.actorLabel} waived ${String(diff?.slot?.from ?? "")} for ${entry.entityLabel}${reason ? ` — ${String(reason)}` : ""}`;
    }
    case "policy.exception.removed":
      return `${entry.actorLabel} removed the exception slot ${String(diff?.slot?.from ?? "")} for ${entry.entityLabel}`;
    case "supplier-set": {
      const to = diff?.supplier?.to;
      return to
        ? `${entry.actorLabel} set ${String(to)} as the supplier on ${entry.entityLabel}`
        : `${entry.actorLabel} cleared the supplier on ${entry.entityLabel}`;
    }
```

(`fmtDate` is en-GB `day: "2-digit", month: "short"` in Asia/Manila — "05 Oct 2026", and "28 Sept 2026" in the existing `reservation.placed` test; if the exact string differs on your run, fix the TEST's expected string to what `fmtDate` prints, not the code.)

- [ ] **Step 13: Run — PASS** (`npx vitest run src/lib/activity.test.ts`; the pre-existing `update`/`import-update` tests still pass — `status`, `assignee`, `model`, `cost` are identity mappings).

- [ ] **Step 14: Paging helper — failing test**

Append to `src/lib/paging.test.ts`:

```ts
describe("parseIntParam", () => {
  it("parses an integer param and falls back on absence or garbage", () => {
    expect(parseIntParam(new URLSearchParams("skip=7"), "skip", 0)).toBe(7);
    expect(parseIntParam(new URLSearchParams(""), "skip", 0)).toBe(0);
    expect(parseIntParam(new URLSearchParams("skip=abc"), "skip", 0)).toBe(0);
    expect(parseIntParam(new URLSearchParams("page=0"), "page", 1)).toBe(0); // no clamp here — callers clamp
  });
});
```

and add `parseIntParam` to the import on line 2.

- [ ] **Step 15: Run — FAIL.** In `src/lib/paging.ts` replace `parsePage` (lines 17-20) with:

```ts
/** One integer query param: the value, or `fallback` on absence or garbage. Callers clamp. */
export function parseIntParam(params: URLSearchParams, key: string, fallback: number): number {
  return Number.parseInt(params.get(key) ?? "", 10) || fallback;
}

/** For pages without a ListState — the same lower clamp parseListState applies. */
export function parsePage(params: URLSearchParams): number {
  return Math.max(1, parseIntParam(params, "page", 1));
}
```

In `src/lib/timeline.ts`: add `import { parseIntParam } from "./paging";` at the top; line 27 becomes

```ts
// cuids are ASCII, so JS's byte-wise `<`/`>` orders them exactly as Postgres' `id desc` does in the source queries — the tiebreaker matches the page boundary.
const byWhenDesc = <T extends TimelinePoint>(a: T, b: T) => b.when.getTime() - a.when.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
```

and in `parseTimelineCursor` the line `const parsed = Number.parseInt(params.get("skip") ?? "0", 10) || 0;` becomes `const parsed = parseIntParam(params, "skip", 0);`.

- [ ] **Step 16: Run — PASS** (`npx vitest run src/lib/paging.test.ts src/lib/timeline.test.ts`).

- [ ] **Step 17: Schema index and migration 26**

In `prisma/schema.prisma`, `model AuditEntry`, add after `@@index([entityType, entityId, createdAt])`:

```prisma
  @@index([entityType, action]) // Phase 27 (spec §3.1): the feeds' Action facet filters and counts here
```

Run `npx prisma migrate dev --create-only --name case_insensitive_names` (worktree, `inventory_dev`). Open the generated `prisma/migrations/<ts>_case_insensitive_names/migration.sql` (it holds one `CREATE INDEX "AuditEntry_entityType_action_idx" …` line) and APPEND:

```sql

-- Phase 27 (spec §3.1): one name per table whatever the case. Postgres' plain UNIQUE is
-- case-sensitive, so "Laptop" and "laptop" were two rows; User.email has had this shape since
-- migration 20260814090100. Not expressible in schema.prisma — documented in HANDOVER/PICKUP
-- beside User_email_lower_key and Reservation_one_active_hold_per_asset as database-only invariants.
-- Fails loudly on a database that already holds two names differing only by case; run the
-- duplicate check in HANDOVER (t) before applying it to a live database.
CREATE UNIQUE INDEX "AssetCategory_name_lower_key"      ON "AssetCategory"   (lower(name));
CREATE UNIQUE INDEX "AssetType_category_name_lower_key" ON "AssetType"       ("categoryId", lower(name));
CREATE UNIQUE INDEX "Department_name_lower_key"         ON "Department"      (lower(name));
CREATE UNIQUE INDEX "EquipmentPolicy_name_lower_key"    ON "EquipmentPolicy" (lower(name));
CREATE UNIQUE INDEX "Vendor_name_lower_key"             ON "Vendor"          (lower(name));
CREATE UNIQUE INDEX "StockCategory_name_lower_key"      ON "StockCategory"   (lower(name));
CREATE UNIQUE INDEX "StockCategory_prefix_lower_key"    ON "StockCategory"   (lower(prefix));
```

Then `npx prisma migrate dev --skip-seed` → applies it; `npx prisma migrate status` → 26 migrations, up to date. `npx prisma generate`.

- [ ] **Step 18: Seed date** — `prisma/seed.ts:652`: `await issue("CM-0002", 8, 9, "Operations", null, "Weekly cleaning");` → `await issue("CM-0002", 8, 11, "Operations", null, "Weekly cleaning");` (the issue now precedes the `day(-10)` stocktake snapshot it must precede). Do NOT run the seed in this task.

- [ ] **Step 19: Gate** — `npx vitest run` (all green; file count +2), `npx eslint .` clean. `npx tsc --noEmit` reports ONLY the three audit-path errors named in Step 7 (list them in the report; Task 2 fixes them). If anything else fails, fix it here.

- [ ] **Step 20: Commit**

```bash
git add src/server/prisma-errors.ts src/server/prisma-errors.test.ts src/lib/audit-list.ts src/lib/audit-list.test.ts src/lib/activity-list.ts src/lib/activity-list.test.ts src/lib/activity.ts src/lib/activity.test.ts src/lib/paging.ts src/lib/paging.test.ts src/lib/timeline.ts prisma/schema.prisma prisma/migrations prisma/seed.ts
git commit -m "feat(rules): Phase 27 -- unique-violation helpers, hidden audit refs (+4 entity types), the activity list config and where, nine feed sentences, action and field labels, parseIntParam; migration 26 (AuditEntry action index + seven lower() unique names); seed CM-0002 before its stocktake" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Audit and activity server — hidden refs, `listAudit`, `listActivity`

**Files:**
- Modify: `src/server/modules/audit/queries.ts` (imports; `listAudit`; add `invisibleAuditRefs`, `listActivity`)
- Modify: `src/server/modules/finance/queries.ts` (remove `financeActivityWhere`, lines 100-105, and its now-unused `Prisma` import if nothing else uses it)
- Modify: `src/app/(app)/audit/page.tsx`, `src/app/(app)/audit/export/route.ts`

**Interfaces:**
- Consumes: `HiddenAuditRefs`, `NO_HIDDEN_REFS`, `buildAuditWhere` (T1); `ActivityFeed`, `buildActivityWhere` (T1); `actionLabel`, `auditSentence` (T1); `invisibleAssetIds` (`inventory/queries.ts`, unchanged).
- Produces: `invisibleAuditRefs(role: Role): Promise<HiddenAuditRefs>`; `listAudit(state, hidden: HiddenAuditRefs)`; `listActivity(feed, state, hidden): Promise<{ items: ActivityItem[]; total: number; page: number; pageCount: number; actionOptions: FacetOptionLike[] }>`.

- [ ] **Step 1: `audit/queries.ts` imports** — replace lines 1-6 with:

```ts
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { NO_HIDDEN_REFS, buildAuditWhere, type HiddenAuditRefs } from "@/lib/audit-list";
import { buildActivityWhere, type ActivityFeed } from "@/lib/activity-list";
import { actionLabel, auditSentence } from "@/lib/activity";
import { ASSET_CLASSES, canSeeClass } from "@/lib/asset-class";
import { fmtDateTime } from "@/lib/format";
import type { ListState } from "@/lib/url-state";
import { LOG_PAGE_SIZE } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";
import { invisibleAssetIds } from "@/server/modules/inventory/queries";
import { actionDot, type ActivityItem } from "@/components/patterns/activity-feed";
import type { FacetOptionLike } from "@/components/patterns/facet-dropdown";
```

(`inventory/queries.ts` already imports `auditSentence` from `@/lib/activity` and nothing from this module, so no import cycle.)

- [ ] **Step 2: `invisibleAuditRefs`** — add before `listAudit`:

```ts
/**
 * Phase 27 (spec §3.3/§4.1): every class-bearing row this role may NOT see — assets, the approvals
 * on them, categories of the class, types under those categories. Built from the SEE map
 * (`canSeeClass`), never the manage map: Purchasing and Finance staff see both classes but manage
 * one. Four empty lists and no query for an all-class role. An approval with no asset has no class
 * and is never hidden (the approvals queue's own rule).
 */
export async function invisibleAuditRefs(role: Role): Promise<HiddenAuditRefs> {
  const hidden = ASSET_CLASSES.filter((c) => !canSeeClass(role, c));
  if (hidden.length === 0) return NO_HIDDEN_REFS;
  const cls = { in: [...hidden] };
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
  const [assetIds, approvals, categories, types] = await Promise.all([
    invisibleAssetIds(role),
    prisma.approval.findMany({ where: { asset: { cls } }, select: { id: true } }),
    prisma.assetCategory.findMany({ where: { cls }, select: { id: true } }),
    prisma.assetType.findMany({ where: { category: { cls } }, select: { id: true } }),
  ]);
  return { assetIds, approvalIds: ids(approvals), categoryIds: ids(categories), typeIds: ids(types) };
}
```

- [ ] **Step 3: `listAudit` on refs** — its signature becomes `export async function listAudit(state: ListState, hidden: HiddenAuditRefs = NO_HIDDEN_REFS)` and the first line `const where = buildAuditWhere(state, hidden);`. Nothing else in it changes.

- [ ] **Step 4: `listActivity`** — add after `listAudit`:

```ts
/**
 * Phase 27 (spec §4.1): one query for the four activity feeds. Rows, the total and the Action facet's
 * counts come from ONE RepeatableRead snapshot (the count closure runs the groupBy first — the
 * listReservations pattern); the facet counts drop the facet's own selection so unchecking one
 * option never zeroes the others (/audit's rule). Items carry the entity chip on the inventory and
 * employees feeds and the domain pill on finance, exactly as the four pages did by hand.
 */
export async function listActivity(
  feed: ActivityFeed,
  state: ListState,
  hidden: HiddenAuditRefs,
): Promise<{ items: ActivityItem[]; total: number; page: number; pageCount: number; actionOptions: FacetOptionLike[] }> {
  const where = buildActivityWhere(feed, state, hidden);
  const withoutAction = buildActivityWhere(feed, { ...state, filters: { ...state.filters, action: [] } }, hidden);
  let grouped: Array<{ action: string; _count: number }> = [];
  const { rows: entries, total, page, pageCount } = await pagedSnapshot(
    LOG_PAGE_SIZE,
    state.page,
    async (tx) => {
      grouped = await tx.auditEntry.groupBy({ by: ["action"], where: withoutAction, _count: true });
      return tx.auditEntry.count({ where });
    },
    (tx, pg) => tx.auditEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take }),
  );
  const labels = await entityLabels(entries);
  const DOMAIN: Record<string, string> = { "purchase-request": "PURCHASE", asset: "ASSET" };
  const withEntityChip = feed === "inventory" || feed === "employees";
  const items: ActivityItem[] = entries.map((e) => {
    const entity = labels.get(`${e.entityType}:${e.entityId}`)!;
    return {
      id: e.id,
      sentence: auditSentence({ actorLabel: e.actorLabel, action: e.action, diff: e.diff, entityLabel: entity.label }),
      when: fmtDateTime(e.createdAt),
      actor: e.actorLabel,
      dotValue: actionDot(e.action),
      ...(withEntityChip ? { entity } : {}),
      // the pill renders ONLY on cross-domain feeds — finance is the one
      ...(feed === "finance" ? { domain: DOMAIN[e.entityType] } : {}),
    };
  });
  const actionOptions: FacetOptionLike[] = grouped
    .map((g) => ({ value: g.action, label: actionLabel(g.action), count: g._count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { items, total, page, pageCount, actionOptions };
}
```

- [ ] **Step 5: `finance/queries.ts`** — delete `financeActivityWhere` (lines 100-105) and, if `Prisma` is now unused in that file, its import; `grep -rn financeActivityWhere src` must return nothing after Task 4 (the finance page still imports it until Task 4 rewrites the pages — to keep tsc green NOW, leave the page importing it? No: tsc must be green at the end of THIS task. Therefore in this task ALSO change `src/app/(app)/finance/activity/page.tsx`'s two `where: financeActivityWhere` uses and its import to `import { feedWhere } from "@/lib/activity-list"; import { NO_HIDDEN_REFS } from "@/lib/audit-list";` and `const where = feedWhere("finance", NO_HIDDEN_REFS);` (a temporary bridge Task 4 deletes with the whole page body). Also change `src/app/(app)/inventory/activity/page.tsx` line 4 + 22 to `import { invisibleAuditRefs } from "@/server/modules/audit/queries";` / `const hidden = (await invisibleAuditRefs(user.role)).assetIds;` — same bridge.)

- [ ] **Step 6: `/audit` page and export** — in `audit/page.tsx`: import `invisibleAuditRefs` from `@/server/modules/audit/queries` instead of `invisibleAssetIds` from inventory (line 9 → `import { invisibleAuditRefs, listAudit } from "@/server/modules/audit/queries";`, delete line 10); line 29 `const hidden = await invisibleAuditRefs(user.role);`. Replace line 20 with:

```tsx
// Phase 27 (P-10): "vendor" is what the table is called; "Supplier" is what the operator calls it.
const ENTITY_LABEL_OVERRIDE: Record<string, string> = { vendor: "Supplier" };
const humanize = (s: string) => ENTITY_LABEL_OVERRIDE[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replaceAll("-", " ");
```

In `audit/export/route.ts`: import `invisibleAuditRefs` from `@/server/modules/audit/queries` (drop the inventory import); line 17 `const hidden = await invisibleAuditRefs(user.role);`.

- [ ] **Step 7: Proof against `inventory_dev`** (read-only; from the worktree; Prisma reads `.env` itself — never print it). Write `scratch-t2.ts` OUTSIDE the repo (e.g. the OS temp dir) or in the worktree root and delete it before the commit:

```ts
import { invisibleAuditRefs, listActivity, listAudit } from "./src/server/modules/audit/queries";
import { parseListState } from "./src/lib/url-state";
import { ACTIVITY_LIST_CONFIG } from "./src/lib/activity-list";
import { AUDIT_LIST_CONFIG } from "./src/lib/audit-list";
async function main() {
  const it = await invisibleAuditRefs("it_staff"); const admin = await invisibleAuditRefs("admin");
  console.log("it hides", { a: it.assetIds.length, p: it.approvalIds.length, c: it.categoryIds.length, t: it.typeIds.length }, "admin hides", admin);
  const audit = await listAudit(parseListState(new URLSearchParams("entity=asset-category"), AUDIT_LIST_CONFIG), it);
  console.log("it /audit categories:", audit.total, audit.rows.slice(0, 3).map((r) => r.entityLabel));
  const feed = await listActivity("inventory", parseListState(new URLSearchParams(""), ACTIVITY_LIST_CONFIG), it);
  console.log("inventory feed:", feed.total, feed.actionOptions.slice(0, 5), feed.items[0]?.sentence);
  const filtered = await listActivity("inventory", parseListState(new URLSearchParams("action=lifecycle.assign"), ACTIVITY_LIST_CONFIG), it);
  console.log("filtered total", filtered.total, "options still list others:", filtered.actionOptions.length);
}
main().then(() => process.exit(0));
```

Run `npx tsx scratch-t2.ts`. Record the printed lines in the report (IT hides > 0 assets/categories/types; admin hides nothing; the filtered total ≤ the unfiltered; the option list length unchanged by the filter). Delete the scratch file.

- [ ] **Step 8: Gate** — `npx tsc --noEmit` CLEAN (the three Task 1 errors are gone), `npx eslint .`, `npx vitest run` clean. `grep -rn "financeActivityWhere" src` → nothing.

- [ ] **Step 9: Commit**

```bash
git add src/server/modules/audit/queries.ts src/server/modules/finance/queries.ts "src/app/(app)/audit/page.tsx" "src/app/(app)/audit/export/route.ts" "src/app/(app)/finance/activity/page.tsx" "src/app/(app)/inventory/activity/page.tsx"
git commit -m "feat(audit): Phase 27 -- invisibleAuditRefs hides approvals, categories and types of an unseen class on /audit and its export; listActivity serves the four feeds from one snapshot with Action facet counts; Supplier label for vendor rows" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Reference-data actions — named conflicts, one helper, two one-liners

**Files:**
- Modify: `src/server/modules/admin/reference-actions.ts`, `admin/policy-actions.ts`, `stock/item-actions.ts`, `suppliers/actions.ts`, `inventory/actions.ts`, `suppliers/queries.ts:110`, `src/components/suppliers/use-supplier-runner.ts:62`

**Interfaces:**
- Consumes: `isUniqueViolation`, `uniqueTarget` (T1).
- Produces: the pinned messages (spec §4.2). No signature changes.

- [ ] **Step 1: `reference-actions.ts`**
  - Replace `import { Prisma, type AssetClass, type Role } from "@prisma/client";` with `import { Prisma, type AssetClass, type Role } from "@prisma/client";` unchanged EXCEPT add `import { isUniqueViolation } from "@/server/prisma-errors";` below the guards import. Delete `isUnique` (lines 57-59). Both `catch` blocks: `if (isUnique(err))` → `if (isUniqueViolation(err))` (message text unchanged — the race net).
  - Add after `nameSchema`:

```ts
/**
 * Phase 27 (spec §4.2): the case-insensitive pre-check that names the winner. Types are scoped to
 * their category; a rename excludes the row itself, so "Laptop" → "LAPTOP" is a rename, not a clash.
 * The lower() unique index behind it (migration 26) is the guarantee; this is the friendly first answer.
 */
async function nameTakenBy(
  tx: Prisma.TransactionClient, entity: RefEntity, name: string, opts: { categoryId?: string; excludeId?: string },
): Promise<string | null> {
  const where = { name: { equals: name, mode: "insensitive" as const }, ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}) };
  const row =
    entity === "category" ? await tx.assetCategory.findFirst({ where, select: { name: true } })
    : entity === "department" ? await tx.department.findFirst({ where, select: { name: true } })
    : await tx.assetType.findFirst({ where: { ...where, categoryId: opts.categoryId }, select: { name: true } });
  return row?.name ?? null;
}
const TAKEN = (existing: string) => validationError({ name: `That name is already taken by "${existing}"` });
```

  - In `createRefRow`, the transaction becomes (the callback returns a failure or null; the surrounding `try`/`catch` stays):

```ts
  try {
    let id = "";
    const failure = await prisma.$transaction(async (tx) => {
      const taken = await nameTakenBy(tx, entity, name, { categoryId: categoryId ?? undefined });
      if (taken) return TAKEN(taken);
      if (entity === "category") id = (await tx.assetCategory.create({ data: { name, cls: cls! } })).id;
      else if (entity === "department") id = (await tx.department.create({ data: { name } })).id;
      else id = (await tx.assetType.create({ data: { name, categoryId: categoryId! } })).id;
      await writeAudit(tx, { /* unchanged */ });
      return null;
    });
    if (failure) return failure;
    revalidatePath(PATHS[entity]);
    return ok({ id });
  } catch (err) {
```

  - In `renameRefRow`, the same shape: inside the transaction, first `const taken = await nameTakenBy(tx, entity, name, { excludeId: id, categoryId: entity === "type" ? (await tx.assetType.findUniqueOrThrow({ where: { id }, select: { categoryId: true } })).categoryId : undefined }); if (taken) return TAKEN(taken);` then the update + audit, `return null`; after: `if (failure) return failure;`.

- [ ] **Step 2: `policy-actions.ts`** — add `import { isUniqueViolation } from "@/server/prisma-errors";`; delete the local `isUnique` (lines 20-22) and change its one use to `isUniqueViolation(err)`. In `createPolicy`'s transaction, before `tx.equipmentPolicy.create`:

```ts
        const clash = await tx.equipmentPolicy.findFirst({ where: { name: { equals: parsed.data.name, mode: "insensitive" } }, select: { name: true } });
        if (clash) throw new PolicyNameTaken(clash.name);
```

and define, above `createPolicy`, `class PolicyNameTaken extends Error { constructor(public readonly existing: string) { super("policy name taken"); } }`; in `createPolicy`'s outer `catch`, FIRST: `if (err instanceof PolicyNameTaken) return validationError({ name: \`That policy name is already taken by "${err.existing}"\` });`. (The transaction here is wrapped by the module's `asActionResult`, which only handles Prisma errors and rethrows everything else — a thrown marker error rolls back and surfaces here. Do not touch `asActionResult`.)

- [ ] **Step 3: `stock/item-actions.ts`** — add `import { isUniqueViolation, uniqueTarget } from "@/server/prisma-errors";`; delete `isP2002`/`p2002Target` (lines 20-27); the two catch blocks become `if (isUniqueViolation(e)) { return uniqueTarget(e).some((t) => t.includes("prefix")) ? validationError({ prefix: "That prefix is already in use" }) : validationError({ name: "A category with this name already exists" }); }`. Add above `createStockCategory`:

```ts
/** Phase 27 (spec §4.2): name and prefix each checked case-insensitively before the write, naming the existing category. */
async function stockCategoryClash(tx: Prisma.TransactionClient, d: { name: string; prefix: string }, excludeId?: string) {
  const not = excludeId ? { id: { not: excludeId } } : {};
  const byName = await tx.stockCategory.findFirst({ where: { ...not, name: { equals: d.name, mode: "insensitive" } }, select: { name: true } });
  if (byName) return validationError({ name: `A category with this name already exists: "${byName.name}"` });
  const byPrefix = await tx.stockCategory.findFirst({ where: { ...not, prefix: { equals: d.prefix, mode: "insensitive" } }, select: { name: true } });
  if (byPrefix) return validationError({ prefix: `That prefix is already in use by "${byPrefix.name}"` });
  return null;
}
```

In `createStockCategory`'s transaction: first `const clash = await stockCategoryClash(tx, d); if (clash) return clash;` — the transaction now returns `ActionResult | StockCategory`; after it: `if ("ok" in created) return created;` before `revalidateCategories()`. In `updateStockCategory`: the transaction returns `clash ?? null`; `if (failure) return failure;`.

- [ ] **Step 4: `suppliers/actions.ts`** — add `import { isUniqueViolation } from "@/server/prisma-errors";`; delete `const isP2002 = …` (line 17); the two catches use `isUniqueViolation(e)`. In `createSupplier`'s transaction, first:

```ts
      const clash = await tx.vendor.findFirst({ where: { name: { equals: data.name, mode: "insensitive" } }, select: { name: true } });
      if (clash) return validationError({ name: `A supplier with this name already exists: "${clash.name}"` });
```

(the callback returns `ActionResult | Vendor`; after it `if ("ok" in created) return created;`). In `updateSupplier`: `where: { id: { not: id }, name: { equals: data.name, mode: "insensitive" } }`, returning the failure from the callback; `if (failure) return failure;`.

- [ ] **Step 5: `inventory/actions.ts`** — add `import { isUniqueViolation, uniqueTarget } from "@/server/prisma-errors";`; delete the local `uniqueTarget` (lines 199-208, doc comment included); the two approval-race catches (`:167`, `:513`) become `if (isUniqueViolation(err)) { return conflict(…same message…); }`. The `createAsset`/`updateAsset` `uniqueTarget(err).includes(…)` calls keep working unchanged (same signature). If `Prisma` is still used elsewhere in the file (it is — `PrismaClientKnownRequestError` P2003 at `:348`), keep its import.

- [ ] **Step 6: The two one-liners** — `suppliers/queries.ts:110`: `orderBy: { createdAt: "desc" },` → `orderBy: [{ createdAt: "desc" }, { id: "desc" }],`. `use-supplier-runner.ts:62`: `return { pending, error, setError, fieldErrors, setFieldErrors, retryAfter, setRetryAfter, reset, run };` → `return { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run };` (no caller destructures the two).

- [ ] **Step 7: Walk on 3100 (you are the only walker; nothing you do persists — every attempt below is REFUSED).** `npm run dev -- -p 3100`; sign in as `admin@thebackroomop.com` (password: `SEED_PASSWORD` from `prisma/fixtures.ts`). `/admin/asset-categories`: type `laptop` in "New category name", press Enter → the alert reads `That name is already taken by "Laptop"`. `/admin/departments`: `hr` → `That name is already taken by "HR"`. `/admin/equipment-policies`: New policy name `finance standard` with any target → `That policy name is already taken by "Finance standard"`. Sign in as `purchasing@thebackroomop.com`: `/stock/categories`: name `pantry`, prefix `ZZ` → `A category with this name already exists: "Pantry"`; name `Zebra`, prefix `os` (the seeded Office supplies prefix — read it off the table) → `That prefix is already in use by "Office supplies"`. `/purchases/suppliers/new`: the seeded supplier's name in lower case with the required fields → `A supplier with this name already exists: "<Seeded Name>"`. Stop the server; `netstat -ano | findstr :3100 | findstr LISTENING` prints nothing.

- [ ] **Step 8: Gate** — `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` clean. `grep -rn "P2002" src/server` → only `src/server/prisma-errors.ts` (and comments).

- [ ] **Step 9: Commit**

```bash
git add src/server/modules/admin/reference-actions.ts src/server/modules/admin/policy-actions.ts src/server/modules/stock/item-actions.ts src/server/modules/suppliers/actions.ts src/server/modules/inventory/actions.ts src/server/modules/suppliers/queries.ts src/components/suppliers/use-supplier-runner.ts
git commit -m "feat(reference-data): Phase 27 -- case-insensitive pre-checks name the existing row before every category, type, department, policy, supplier and stock-category write; one isUniqueViolation/uniqueTarget replaces five P2002 copies; supplier documents tiebreak on id; runner drops two unused setters" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The four activity feeds — one page component, one toolbar

**Files:**
- Create: `src/components/patterns/activity-toolbar.tsx`, `src/components/patterns/activity-list-page.tsx`
- Modify (rewrite): `src/app/(app)/inventory/activity/page.tsx`, `employees/activity/page.tsx`, `finance/activity/page.tsx`, `purchases/activity/page.tsx`

**Interfaces:**
- Consumes: `listActivity`, `invisibleAuditRefs` (T2); `ACTIVITY_LIST_CONFIG`, `ActivityFeed` (T1); `FacetDropdown`, `ActivityFeed` component, `Pagination`, `EmptyState`, `PageHeader`, `ButtonLink`.
- Produces: `ActivityListPage({ feed, title, base, emptyTitle, emptyDescription?, searchParams })`; `ActivityToolbar({ state, total, actionOptions, base })`.

- [ ] **Step 1: `activity-toolbar.tsx`** (client; mirrors `audit-toolbar.tsx` minus search):

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FacetDropdown, type FacetOptionLike } from "@/components/patterns/facet-dropdown";
import { ACTIVITY_LIST_CONFIG } from "@/lib/activity-list";
import { serializeListState, withFilter, type ListState } from "@/lib/url-state";

/** Phase 27 (spec §5.2): the feeds' one facet, a Clear link while a selection is on, and the entry count. */
export function ActivityToolbar({
  state, total, actionOptions, base,
}: {
  state: ListState; total: number; actionOptions: FacetOptionLike[]; base: string;
}) {
  const router = useRouter();
  const href = (s: ListState) => base + serializeListState(s, ACTIVITY_LIST_CONFIG);
  const selected = state.filters.action ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FacetDropdown
        label="Action"
        options={actionOptions}
        selected={selected}
        onApply={(values) => router.push(href(withFilter(state, "action", values)))}
      />
      {selected.length > 0 && (
        <Link href={base} className="text-[12px] text-accent hover:underline">Clear</Link>
      )}
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "entry" : "entries"}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: `activity-list-page.tsx`** (server component):

```tsx
import { requireUser } from "@/server/auth/guards";
import { invisibleAuditRefs, listActivity } from "@/server/modules/audit/queries";
import { ACTIVITY_LIST_CONFIG, type ActivityFeed as Feed } from "@/lib/activity-list";
import { parseListState, serializeListState, toSearchParams } from "@/lib/url-state";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed } from "@/components/patterns/activity-feed";
import { ActivityToolbar } from "@/components/patterns/activity-toolbar";

/**
 * Phase 27 (spec §5.2, plan P-2): the one body behind the four activity routes — parse the list
 * state, hide what the role cannot see, query once, render toolbar + feed + pagination. The pages
 * themselves are five-line wrappers that name their feed and copy.
 */
export async function ActivityListPage({
  feed, title, base, emptyTitle, emptyDescription, searchParams,
}: {
  feed: Feed;
  title: string;
  /** the route, e.g. "/inventory/activity" — pagination and Clear hrefs are built on it */
  base: string;
  emptyTitle: string;
  emptyDescription?: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const state = parseListState(toSearchParams(await searchParams), ACTIVITY_LIST_CONFIG);
  const hidden = await invisibleAuditRefs(user.role);
  const { items, total, page, pageCount, actionOptions } = await listActivity(feed, state, hidden);
  const filtered = (state.filters.action ?? []).length > 0;
  const href = (p: number) => base + serializeListState({ ...state, page: p }, ACTIVITY_LIST_CONFIG);

  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col gap-2">
        <ActivityToolbar state={state} total={total} actionOptions={actionOptions} base={base} />
        {items.length > 0 ? (
          <>
            <ActivityFeed items={items} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount}</span>
              <Pagination page={page} pageCount={pageCount} hrefFor={href} />
            </div>
          </>
        ) : filtered ? (
          <EmptyState title="No entries match this filter" actions={<ButtonLink href={base}>Clear</ButtonLink>} />
        ) : (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: The four pages** — each file's WHOLE content becomes (values per page):

```tsx
import { ActivityListPage } from "@/components/patterns/activity-list-page";

export default async function InventoryActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ActivityListPage feed="inventory" title="Inventory activity" base="/inventory/activity" emptyTitle="Nothing has happened yet" searchParams={searchParams} />;
}
```

| page | feed | title | base | emptyTitle | emptyDescription |
|---|---|---|---|---|---|
| inventory | `inventory` | Inventory activity | `/inventory/activity` | Nothing has happened yet | — |
| employees | `employees` | Employee activity | `/employees/activity` | Nothing has happened yet | — |
| finance | `finance` | Finance activity | `/finance/activity` | No money has moved yet | Purchase decisions and changes to an asset's cost both land here. |
| purchases | `purchases` | Purchasing activity | `/purchases/activity` | Nothing has happened yet | Drafts, submissions and decisions all land here. |

(Function names: `EmployeeActivityPage`, `FinanceActivityPage`, `PurchasingActivityPage` as today.)

- [ ] **Step 4: Walk on 3100** (sole walker; nothing persists). As `it@thebackroomop.com`: `/inventory/activity` — the Action dropdown lists labels with counts ("Assigned", "Status changed", …), the count reads "N entries"; check "Assigned", Apply → the URL carries `?action=lifecycle.assign`, the feed narrows, the count updates, Clear appears; the dropdown still lists the other actions with their counts; a page-2 link (if any) keeps `action=`; Clear returns to the bare route. The worker's seeded sentence "worker lifecycle.assign executed BR-LT-0181" is still there unfiltered (an existing e2e pins it). `/employees/activity`, `/purchases/activity` (as purchasing), `/finance/activity` (as finance; the domain pill still renders). As `viewer@…`: `/inventory/activity` renders with the toolbar. Stop the server; port free.

- [ ] **Step 5: Gate** — tsc, eslint, vitest clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/patterns/activity-toolbar.tsx src/components/patterns/activity-list-page.tsx "src/app/(app)/inventory/activity/page.tsx" "src/app/(app)/employees/activity/page.tsx" "src/app/(app)/finance/activity/page.tsx" "src/app/(app)/purchases/activity/page.tsx"
git commit -m "feat(activity): Phase 27 -- one ActivityListPage and ActivityToolbar behind the four feeds: Action facet with stable counts, Clear, filtered empty state, pagination that keeps the filter" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The visible smalls — combobox, "No supplier", the tile, the note, Enter on rows

**Files:**
- Modify: `src/components/patterns/entity-combobox.tsx:93` (+ an `onClick`), `src/components/stock/receive-form.tsx:187`, `src/components/ui/stat.tsx`, `src/app/(app)/page.tsx:132`, `src/components/home/worklist.tsx:43`, `src/components/ui/table.tsx` (add `rowOpenProps`), `src/components/inventory/inventory-table.tsx:187-192`, `src/components/employees/employees-table.tsx:54-61`, `src/components/reservations/holds-table.tsx:60-67`

**Interfaces:**
- Produces: `rowOpenProps(open: () => void)` (`@/components/ui/table`); `Stat` `tone?: "neutral" | "accent"`.

- [ ] **Step 1: Combobox opens on intent, not on focus** — `entity-combobox.tsx:93`: `onFocus={() => { setOpen(true); setActive(0); }}` → `onFocus={() => setActive(0)}` and add, right after it, `onClick={() => setOpen(true)}`. Comment above the input: `// Phase 27 (spec §5.5): focus alone never opens the list — a click, typing or ArrowDown does, so an autoFocus field no longer pops a listbox on page load.` `autoFocus` (line 91), `onChange` and `onKeyDown` unchanged.

- [ ] **Step 2: "No supplier"** — `receive-form.tsx:187`: `options={suppliers.map((s) => ({ value: s.id, label: s.name }))}` → `options={[{ value: "", label: "No supplier" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}` (picking it calls the existing `onChange` with `""`, which clears `supplierId`).

- [ ] **Step 3: `Stat` tone** — `stat.tsx` whole file:

```tsx
import { cn } from "@/lib/cn";

/** Phase 27 (spec §5.5, plan P-3): `tone="accent"` colours the value like every other overdue surface; neutral is the default. */
export function Stat({ label, value, hint, tone = "neutral" }: { label: string; value: React.ReactNode; hint?: string; tone?: "neutral" | "accent" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-muted">
        {label}
      </span>
      <span className={cn("font-mono text-lg font-semibold leading-tight", tone === "accent" ? "text-accent" : "text-fg")} data-tone={tone}>{value}</span>
      {hint && <span className="text-[10.5px] text-fg-muted">{hint}</span>}
    </div>
  );
}
```

`src/app/(app)/page.tsx:132`: `<Stat label="Stocktakes past close-by" value={…} />` → `<Stat label="Stocktakes past close-by" tone={d.stocktakesOverdue > 0 ? "accent" : "neutral"} value={…} />`.

- [ ] **Step 4: The work note** — `home/worklist.tsx:43`: `Showing the first {g.total} — the oldest first.` → `Showing the first {g.rows.length} — the oldest first.` (lines 33 and 37 keep `g.total`).

- [ ] **Step 5: `rowOpenProps`** — append to `src/components/ui/table.tsx`:

```tsx
/**
 * Phase 27 (spec §5.4): a whole-row link — focusable, opens on click (not on a text selection) and on
 * Enter pressed on the row itself, never on a link or button inside it. Written once here; the
 * inventory, employees and holds tables spread it onto their <Tr>.
 */
export function rowOpenProps(open: () => void): Pick<React.HTMLAttributes<HTMLTableRowElement>, "tabIndex" | "onClick" | "onKeyDown"> {
  return {
    tabIndex: 0,
    onClick: () => { if (window.getSelection()?.toString()) return; open(); },
    onKeyDown: (e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}
```

Then: `inventory-table.tsx:187-192` → `<Tr key={row.id} className="cursor-pointer" selected={selected.has(row.id)} {...rowOpenProps(() => router.push(\`/inventory/${row.id}\`))}>` (import `rowOpenProps` from `@/components/ui/table`); `employees-table.tsx:54-61` → `<Tr key={row.id} className="cursor-pointer" {...rowOpenProps(() => open(row.id))}>` and `open` loses its `getSelection` guard (now in the helper); `holds-table.tsx:60-67` → `<Tr key={r.id} className="cursor-pointer" {...rowOpenProps(() => open(r.assetId))}>`, same `open` simplification.

- [ ] **Step 6: Walk on 3100** (sole walker; nothing persists). `/stock/receive` as purchasing: no listbox open on load; click the Item field → the list opens; type → filters; the Supplier list leads with "No supplier"; pick a supplier, reopen, pick "No supplier" → the field is empty. `/inventory` as IT: Tab to a row, Enter → the record opens; click still opens; selecting text does not. `/employees`, `/reservations`: Enter still opens. Purchasing Home: the stocktake tile is neutral (0 overdue on the seed). `/inventory/work`: the capped note still reads "Showing the first 50". Stop the server; port free.

- [ ] **Step 7: The combobox blast radius (P-5), foreground, two chunks, port free between:**

```
E2E_PORT=3100 npx playwright test e2e/custody.spec.ts e2e/department-owned.spec.ts e2e/direct-lifecycle.spec.ts e2e/registration.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/holds.spec.ts e2e/it-gaps.spec.ts e2e/quick-forms.spec.ts e2e/stock.spec.ts e2e/stock-lots.spec.ts --workers=1 --global-timeout=540000
```

A failure caused by a pick that relied on focus opening the list: fix the TEST by clicking the combobox first (record it); a failure elsewhere: STOP and report. Then `npm run db:seed` (last), port free.

- [ ] **Step 8: Gate** — tsc, eslint, vitest clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/patterns/entity-combobox.tsx src/components/stock/receive-form.tsx src/components/ui/stat.tsx "src/app/(app)/page.tsx" src/components/home/worklist.tsx src/components/ui/table.tsx src/components/inventory/inventory-table.tsx src/components/employees/employees-table.tsx src/components/reservations/holds-table.tsx
git commit -m "fix(ui): Phase 27 -- comboboxes open on click, typing or ArrowDown, never on focus; a No supplier option on the receive form; the Purchasing stocktake tile turns accent when overdue; the work note counts rendered rows; rowOpenProps gives /inventory rows Enter and dedupes the two tables" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: e2e — `activity.spec.ts` and the added cases

**Files:**
- Create: `e2e/activity.spec.ts`
- Modify: `e2e/admin.spec.ts` (+3 cases, a `db` client), `e2e/stock.spec.ts` (+1, last in the serial block), `e2e/suppliers.spec.ts` (+1, last in the serial block), `e2e/approvals-audit.spec.ts` (+1 in "audit log"), `e2e/it-gaps.spec.ts` (cases 1 and 3 get `try/finally`)

**Interfaces:** consumes the product as shipped by T1–T5; helpers are copied per file (house rule: no shared e2e module).

- [ ] **Step 1: `e2e/activity.spec.ts`** — header, helpers copied from `e2e/it-nav.spec.ts` (`login`, `expectNoSeriousAxe`, `waitForHydration`, `facetCounts`; cite the source in a comment), `db`, `beforeAll` seed, `afterAll` disconnect, then seven cases:

```ts
const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";

test.describe("Phase 27 — activity feeds, audit sentences and the visible smalls", () => {
  test("1. the Action facet narrows /inventory/activity, the URL and paging keep it, Clear releases it", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory/activity");
    const counts = await facetCounts(page, "Action");
    expect(Object.keys(counts)).toContain("Assigned");
    expect(Number(counts["Assigned"])).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Action" }).click();
    await page.getByRole("dialog", { name: "Filter by Action" }).getByLabel("Assigned").check();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/action=lifecycle\.assign/);
    const feed = page.locator("ol");
    await expect(feed.locator("li").first()).toBeVisible();
    for (const text of await feed.locator("li").allInnerTexts()) expect(text).toMatch(/assigned|executed/i);
    // the other options keep their counts while one is selected
    const narrowed = await facetCounts(page, "Action");
    expect(Object.keys(narrowed).length).toBe(Object.keys(counts).length);
    const next = page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "2", exact: true });
    if (await next.count()) await expect(next).toHaveAttribute("href", /action=lifecycle\.assign/);
    await page.getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL(/\/inventory\/activity$/);
    await expectNoSeriousAxe(page);
  });

  test("2. IT's inventory feed carries no Purchasing rows; admin's does", async ({ page }) => {
    const vehicle = await db.asset.findFirstOrThrow({ where: { cls: "PURCHASING" } });
    await db.auditEntry.create({ data: { actorLabel: "e2e phase 27", entityType: "asset", entityId: vehicle.id, action: "update", diff: { location: { from: "Depot", to: "Yard 27" } } } });
    await login(page, IT);
    await page.goto("/inventory/activity");
    await expect(page.locator("ol")).not.toContainText(vehicle.tag);
    await login(page, ADMIN);
    await page.goto("/inventory/activity");
    await expect(page.locator("ol").getByText(`e2e phase 27 updated location on ${vehicle.tag}`)).toBeVisible();
  });

  test("3. an attached document reads as a sentence", async ({ page }) => {
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await db.auditEntry.create({ data: { actorLabel: "e2e phase 27", entityType: "asset", entityId: laptop.id, action: "document.uploaded", diff: { document: { from: null, to: "warranty-27.pdf" } } } });
    await login(page, IT);
    await page.goto("/inventory/activity");
    await expect(page.locator("ol").getByText("e2e phase 27 attached warranty-27.pdf to BR-LT-0148")).toBeVisible();
  });

  test("4. an import-update row prints human field names", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    await db.auditEntry.create({ data: { actorLabel: "e2e importer", entityType: "employee", entityId: nina.id, action: "import-update", diff: { departmentId: { from: "a", to: "b" }, joinedAt: { from: "2024-01-01", to: "2024-02-01" } } } });
    await login(page, IT);
    await page.goto("/employees/activity");
    await expect(page.locator("ol").getByText("e2e importer updated department, join date on Nina Robles by import")).toBeVisible();
  });

  test("5. Enter on a focused /inventory row opens the record", async ({ page }) => {
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, IT);
    await page.goto("/inventory?q=BR-LT-0148");
    const row = page.getByRole("row", { name: /BR-LT-0148/ });
    await waitForHydration(row);
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/inventory/${laptop.id}$`));
  });

  test("6. /stock/receive loads with no open listbox; a click opens it; No supplier clears a chosen supplier", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/stock/receive");
    const item = page.getByRole("combobox", { name: /^Item/ });
    await waitForHydration(item);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await item.click();
    await expect(page.getByRole("listbox")).toHaveCount(1);
    await page.keyboard.press("Escape");
    const supplier = page.getByRole("combobox", { name: "Supplier" });
    await supplier.click();
    const list = supplier.locator("xpath=following-sibling::ul");
    await expect(list.getByRole("option").first()).toHaveText(/No supplier/);
    await list.getByRole("option").nth(1).click();
    await expect(supplier).not.toHaveValue("");
    await supplier.click();
    await list.getByRole("option", { name: "No supplier" }).click();
    await expect(supplier).toHaveValue("");
    await expectNoSeriousAxe(page);
  });

  test("7. the Purchasing Home stocktake tile turns accent when a stocktake is past its close-by date", async ({ page }) => {
    const cat = await db.stockCategory.findFirstOrThrow();
    const opener = await db.user.findFirstOrThrow({ where: { email: PURCHASING } });
    const yesterday = new Date(Date.now() - 86_400_000);
    const st = await db.stocktake.create({ data: { refNo: "ST-E2E27", categoryId: cat.id, state: "OPEN", openedAt: yesterday, dueAt: yesterday, openedById: opener.id } });
    try {
      await login(page, PURCHASING);
      await page.goto("/");
      const tile = page.locator("div", { has: page.getByText("Stocktakes past close-by", { exact: true }) }).last();
      await expect(tile.locator('[data-tone="accent"]')).toBeVisible();
    } finally {
      await db.stocktake.delete({ where: { id: st.id } });
    }
  });
});
```

(Adjust the `Stocktake` create to the model's required columns — read `model Stocktake` in `schema.prisma` first; if a `refNo` sequence/format check exists, use a value the check accepts. The seed's stocktake is the shape to copy.)

- [ ] **Step 2: `e2e/admin.spec.ts` (+3)** — add `import { PrismaClient } from "@prisma/client"; const db = new PrismaClient(); test.afterAll(async () => { await db.$disconnect(); });` and a new describe:

```ts
test.describe("reference names are unique whatever the case (Phase 27)", () => {
  test("a category that differs only by case is refused, naming the existing row", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    const input = page.getByLabel("New category name");
    await input.fill("laptop");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toHaveText('That name is already taken by "Laptop"');
    await expect(page.getByRole("row", { name: /^laptop/ })).toHaveCount(0);
  });
  test("renaming a row to its own name in another case is a rename, not a clash", async ({ page }) => {
    const headset = await db.assetCategory.findFirstOrThrow({ where: { name: "Headset" } });
    try {
      await login(page, "admin@thebackroomop.com");
      await page.goto("/admin/asset-categories");
      await page.getByRole("button", { name: "Actions for Headset" }).click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      const input = page.getByLabel("Rename Headset");
      await input.fill("HEADSET");
      await input.press("Enter");
      await expect(page.getByText("HEADSET", { exact: true })).toBeVisible();
    } finally {
      await db.assetCategory.update({ where: { id: headset.id }, data: { name: "Headset" } });
    }
  });
  test("a department that differs only by case is refused", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/departments");
    const input = page.getByLabel("New department name");
    await input.fill("hr");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toHaveText('That name is already taken by "HR"');
  });
});
```

- [ ] **Step 3: `e2e/stock.spec.ts` (+1, LAST case inside `test.describe.serial("stock", …)`, after "Test supplies"/TS exist from case 1):**

```ts
  test("N. a stock category name or prefix that differs only by case is refused, naming the existing category", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/stock/categories");
    const name = page.getByLabel("New category name");
    await waitForHydration(name);
    await name.fill("test supplies");
    await page.getByLabel("New category prefix").fill("ZZ");
    await page.getByRole("button", { name: "Create category" }).click();
    await expect(page.getByRole("alert")).toHaveText('A category with this name already exists: "Test supplies"');
    await name.fill("Zebra supplies");
    await page.getByLabel("New category prefix").fill("ts");
    await page.getByRole("button", { name: "Create category" }).click();
    await expect(page.getByRole("alert")).toHaveText('That prefix is already in use by "Test supplies"');
  });
```

(N = the next number in the file.)

- [ ] **Step 4: `e2e/suppliers.spec.ts` (+1, LAST in the serial block):** copy case 1's fills with the name `bayside networks`, click "Create supplier", `await expect(page.getByRole("alert")).toHaveText('A supplier with this name already exists: "Bayside Networks"');` and `await expect(page).toHaveURL(/\/purchases\/suppliers\/new$/);`.

- [ ] **Step 5: `e2e/approvals-audit.spec.ts` (+1 in "audit log")** — the file needs a `db` (`PrismaClient`) if it has none; add it with `afterAll` disconnect:

```ts
  test("class hygiene: IT's audit log hides Purchasing categories and approvals; admin's shows them", async ({ page }) => {
    const cat = await db.assetCategory.create({ data: { name: "Phase 27 Fleet", cls: "PURCHASING" } });
    await db.auditEntry.create({ data: { actorLabel: "e2e phase 27", entityType: "asset-category", entityId: cat.id, action: "create", diff: { name: { from: null, to: cat.name }, cls: { from: null, to: "PURCHASING" } } } });
    const approval = await db.approval.findFirstOrThrow({ where: { asset: { cls: "PURCHASING" } } });
    await db.auditEntry.create({ data: { actorLabel: "e2e phase 27", entityType: "approval", entityId: approval.id, action: "claim", diff: { claimedBy: { from: null, to: "e2e" } } } });
    try {
      await login(page, "it@thebackroomop.com");
      await page.goto("/audit?entity=asset-category");
      await expect(page.getByText("Phase 27 Fleet")).toHaveCount(0);
      await page.goto("/audit?entity=approval");
      await expect(page.getByRole("row", { name: new RegExp(approval.refNo) })).toHaveCount(0);
      await login(page, "admin@thebackroomop.com");
      await page.goto("/audit?entity=asset-category");
      await expect(page.getByText("Phase 27 Fleet").first()).toBeVisible();
      await page.goto("/audit?entity=approval");
      await expect(page.getByRole("row", { name: new RegExp(approval.refNo) }).first()).toBeVisible();
    } finally {
      await db.assetCategory.delete({ where: { id: cat.id } }); // its audit rows stay (append-only)
    }
  });
```

(`Approval.refNo` — confirm the field name in `schema.prisma`; `entityLabels` labels an approval by it.)

- [ ] **Step 6: `e2e/it-gaps.spec.ts` cases 1 and 3** — case 1: before `await login(page, IT);` add `const hsBefore = await db.asset.findUniqueOrThrow({ where: { tag: "BR-HS-0502" } });` then wrap everything from `await login` to the last `expect` in `try { … } finally { await db.asset.update({ where: { id: hsBefore.id }, data: { status: hsBefore.status } }); }`. Case 3: keep the `policy`/`policySlot` creates before `try`; wrap from `await login(page, IT);` to the end in `try { … } finally { await db.policySlot.deleteMany({ where: { policyId: policy.id } }); await db.equipmentPolicy.delete({ where: { id: policy.id } }); }`.

- [ ] **Step 7: Run (foreground, sole user, port free between):**

```
E2E_PORT=3100 npx playwright test e2e/activity.spec.ts e2e/approvals-audit.spec.ts e2e/it-gaps.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/admin.spec.ts e2e/stock.spec.ts e2e/suppliers.spec.ts --workers=1 --global-timeout=540000
```

Each chunk green; a test-only fix is allowed (record it); a product defect: STOP and report. `npx playwright test --list` → record "Total: N tests in M files" (expect 364 + 14 = 378 in 36 files). `npm run db:seed` last; port free.

- [ ] **Step 8: Gate** — tsc, eslint (`npx eslint e2e`), vitest clean.

- [ ] **Step 9: Commit**

```bash
git add e2e/activity.spec.ts e2e/admin.spec.ts e2e/stock.spec.ts e2e/suppliers.spec.ts e2e/approvals-audit.spec.ts e2e/it-gaps.spec.ts
git commit -m "test(e2e): Phase 27 -- activity.spec (facet, class hygiene, sentences, Enter on rows, combobox opening, No supplier, the accent tile); case-insensitive name refusals in admin, stock and suppliers; audit class scoping; it-gaps cases 1 and 3 restore what they change" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Battery and documents

**Files:** `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, `docs/superpowers/specs/2026-09-22-leftovers-sweep-design.md` (Status), this plan (D-block).

- [ ] **Step 1: Pre-checks** — `git status --short` empty; `npx tsc --noEmit`; `npx eslint .`; `npx vitest run` (files/tests); `npx prisma migrate status` (26 found, up to date); `npx playwright test --list` (total/files).

- [ ] **Step 2: The seven chunks** FOREGROUND, one at a time, port free before each and after the last, `N passed (M.Mm)` recorded per chunk; `e2e/activity.spec.ts` joins E2 (P-6):

```
E2E_PORT=3100 npx playwright test e2e/it-core.spec.ts e2e/import-export.spec.ts e2e/purchases.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/auth-shell.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/offboarding.spec.ts e2e/receiving.spec.ts e2e/paging.spec.ts e2e/home-finance.spec.ts e2e/approvals-audit.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/admin.spec.ts e2e/direct-lifecycle.spec.ts e2e/scanner.spec.ts e2e/registration.spec.ts e2e/quick-forms.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/stock.spec.ts e2e/stocktake.spec.ts e2e/stock-lots.spec.ts e2e/stock-reports.spec.ts e2e/activity.spec.ts --workers=1 --global-timeout=540000
E2E_PORT=3100 npx playwright test e2e/transfers.spec.ts e2e/directory.spec.ts e2e/offboarding-v2.spec.ts e2e/it-gaps.spec.ts e2e/it-nav.spec.ts e2e/holds.spec.ts e2e/oversight.spec.ts e2e/rate-limit.spec.ts e2e/deadlines.spec.ts --workers=1 --global-timeout=540000
```

A failing chunk: re-run once; if it reproduces, STOP and report (no product code edits in this task). `npm run db:seed` after the last chunk; port free.

- [ ] **Step 3: Docs** (CRLF preserved; one commit): HANDOVER line 3 — a new leading parenthetical (Phase 27 CODE-COMPLETE on the branch at the final tree, UNMERGED/UNPUSHED, ADDS MIGRATION 26 `case_insensitive_names` — additive: one ordinary index and seven `lower()` unique indexes; fails loudly on a database with case-duplicate names; staging checked clean 2026-09-22 — so the next staging redeploy after the merge is a `-Force` that applies it), keeping every earlier parenthetical; a new **(t)** block after (s): what shipped by spec section, the rulings, the battery, the database-only index list (now eight `lower()`/partial indexes with no `schema.prisma` mirror), what stays parked (§2 of the spec), the duplicate-check SQL; §0 item 9's chunk block gains `e2e/activity.spec.ts` in E2 with one new sentence; §8: the three IT items marked **✅ CLOSED in Phase 27 —** with one sentence each (audit class scoping; case-insensitive uniqueness; the activity facet and import-update sentences), the `Reservation_one_active_hold_per_asset`/`User_email_lower_key` raw-SQL note extended with the seven new indexes. PICKUP: Branch row (phase-27 exists locally, CODE-COMPLETE, UNMERGED/UNPUSHED; `main` carries the docs commits beyond `origin/main`), Database row (**26 migrations** on the branch; `main` and staging at 25 until the merge and redeploy), Battery row, Last two phases (27 then 26), §4 item 1 (renumber the rest), §5 closures. HANDOVER-PENDING: §1 rewritten (current: staging runs the Phase 26 merge with 25 migrations; the one command; Phase 27's migration 26 applies at the next `-Force` after its merge — with the duplicate check first), §5.3 (the Phase 17/18/19/23/24 items closed or ruled, one line each), §6 (the three IT items → **Shipped in Phase 27 —**; the three decisions recorded). Spec Status line → implemented on the branch, code-complete <date> at final tree `<sha>`, unmerged and unpushed, migration 26 pending on staging; `*Amended (D-n):*` notes for P-2 (one page component), P-3 (`text-accent`), P-4 (e2e writes the audit rows), P-5 (the corrected combobox list), P-7 (`financeActivityWhere` removed), P-10 (Supplier label override) and anything the execution changed. This plan: replace the placeholder under "## Amendments made during execution" with the D-block from the SDD ledger.

- [ ] **Step 4: Commit** `docs(handover,pickup,pending,plan,spec): Phase 27 code-complete -- battery N e2e / M files, K unit, 26 migrations; (t) block; D-1..D-N`.

---

## Self-review

**Spec coverage:** §3.1 → T1 Step 17; §3.2 → T1 Steps 1-4 + T3; §3.3 → T1 Steps 5-7 + T2; §3.4 → T1 Steps 8-10; §3.5 → T1 Steps 11-13; §3.6 → T1 Steps 14-16; §4.1 → T2; §4.2 → T3; §5.1 → T2 Step 6; §5.2 → T4; §5.3 → T3 (no UI); §5.4 → T5 Step 5; §5.5 → T5 Steps 1-4; §5.6 → T1 Step 18, T3 Step 6, T6 Step 6, the two rulings → T7 docs; §6 → the tests in T1/T6; §7 → T1 tests, T6, T7 battery; §8 → the file lists; decisions 5-7 → T7 docs (recorded). **Placeholder scan:** none (`<ts>`, `<sha>`, `N` are values measured at execution). **Type consistency:** `HiddenAuditRefs`/`NO_HIDDEN_REFS` (T1) consumed by T2/T4; `buildActivityWhere(feed, state, hidden)` (T1) by T2; `listActivity` return `{ items, total, page, pageCount, actionOptions }` (T2) by T4's `ActivityListPage`; `ActivityToolbar` props `{ state, total, actionOptions, base }` (T4) match the page's call; `rowOpenProps` returns the three attributes `Tr` spreads; `Stat.tone` (T5) used by `page.tsx`; `isUniqueViolation`/`uniqueTarget` (T1) by T3's five modules.

## Amendments made during execution

- *(Task 7 replaces this bullet with the D-block from the SDD ledger.)*
