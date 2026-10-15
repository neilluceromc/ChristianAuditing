# Phase 35 — Registration review, Finance's asset register, and depreciation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every registered asset goes through a Finance review that IT and Purchasing can see and act on. Finance gets a full asset register with a per-asset money page. Finance also sees straight-line book value with policies, overrides, a year schedule and exports.

**Architecture:**
- **Registration is derived, never stored.** `src/lib/registration.ts` maps today's columns (`itVerifiedAt`, `financeConfirmedAt`, `financeReturnedAt`) to four states, plus a filter `where` for each. Three new columns hold the not-capitalised flag, the send-back checklist and IT's reply.
- **The existing actions grow.** `confirmAssetDetails`, `returnAssetToIt` and `resubmitAssetToFinance` (`src/server/modules/inventory/actions.ts`) gain those fields. Finance's review UI moves from IT's record page to a new Finance asset page.
- **Depreciation is one pure module.** `src/lib/depreciation.ts` works in integer centavos and Asia/Manila months. Every screen and export calls it.
- **Settings only.** Five optional columns hold the depreciation settings; nothing is precomputed.
- **All of it is migration 28.**

**Tech Stack:** Next.js 15 App Router (RSC + client islands), Prisma 6 / Postgres 16, zod, vitest (pure, node env, `src/**/*.test.{ts,tsx}`), Playwright + axe, write-excel-file through `src/server/xlsx/write.ts`.

**Spec:** `docs/superpowers/specs/2026-10-15-depreciation-design.md` (commit `58355c0`). Read it first, and treat it as the authority. The mockups are the "Depreciation mockups" canvas artifact; they are illustrative, and the spec wins where they differ (e.g. chip names).

## Global Constraints

**Where the work happens**
- Do the work in the worktree `.claude/worktrees/phase-35-registration-depreciation`, on branch `phase-35-registration-depreciation`.
- `.env` there points at `inventory_dev` with `APP_BASE_URL=http://192.168.1.193:3100`, and has no `SEED_PASSWORD` or `QUICK_LOGIN_EMAILS`.
- Never read or print `.env`. Never touch the `inventory` database or port 3000.

**Database and migrations**
- Apply migrations with `npx prisma migrate deploy` only. Never run `prisma migrate dev` or `prisma migrate reset`.
- Generate DDL with `npx prisma migrate diff --from-schema-datamodel <HEAD schema copy> --to-schema-datamodel prisma/schema.prisma --script`.
- After `npm ci`, run `npx prisma generate`.
- `npm run db:seed` runs only on `inventory_dev`, and runs last after e2e work.

**Playwright**
- Run it in the **foreground only**: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`, with a Bash timeout of 600000.
- Never use `run_in_background` or the Monitor tool. One Playwright process at a time.
- Check port 3100 before and after each run with `netstat -ano | findstr :3100 | findstr LISTENING`.
- Only ONE implementer runs a dev server at a time. The dev server is `npm run dev -- -p 3100`, never 3000.

**Git**
- Never amend. Never run `git stash`, `checkout`, `restore`, `reset` or `switch`.
- `git add` new files before a pathspec commit.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Repo files are CRLF. Edit existing files with the Edit tool, never `sed -i`, and write new files CRLF.

**House rules**
- Product aria-labels near a field never contain that field's label word.
- `AuditEntry` is append-only, so tests never delete audit rows.
- Server actions follow the guard order `actionRole` → `checkRate(user.id)` → zod. They return the house `ActionResult` (`@/server/action-result`) and write audit rows through `writeAudit(tx, …)` in the same transaction.
- State changes are state-guarded writes (`updateMany` with the precondition in `where`, then `count === 0` → `conflict`), as the existing finance actions already do.
- Money is never handled as floats in the calculation: convert to integer centavos (`Math.round(Number(decimal) * 100)`) at the boundary.
- Show money on screen with `fmtMoneyExact` (2 decimals) wherever depreciation appears, and in Excel as `{ type: Number, format: "#,##0.00" }`.

**Spec values**
- **Registration states and labels:**

  | State | IT / Purchasing label | Finance label |
  |---|---|---|
  | `awaiting-it` | Waiting for IT check | Waiting for IT |
  | `with-finance` | With Finance | To review |
  | `needs-correction` | Needs correction | Sent back |
  | `registered` | Fully registered | Approved / Not capitalised |

  `registrationState` checks them in the order `awaiting-it` → `registered` → `needs-correction` → `with-finance`.
- **Send-back:**
  - at least one checklist key; keys come from `REGISTRATION_FIELDS`, with no duplicates;
  - the note is 3–500 characters when given, and required when `other` is ticked;
  - the reply is 3–500 characters when given.
- **Approve as not capitalised** only when `cost` is null. **Approve** only when `cost` is set. Finance acts only on `with-finance` assets.
- **A cost saved on a not-capitalised asset** clears `financeConfirmedAt/ById` and `financeNotCapitalised` in the same write, plus the audit `finance.reopened`.
- **Finance's asset list `fin` values:**

  | Value | Chip |
  |---|---|
  | `with-finance` | To review |
  | `needs-correction` | Sent back |
  | `awaiting-it` | Waiting for IT |
  | `approved` | Approved |
  | `not-capitalised` | Not capitalised |
  | `no-cost` | No cost |

- **Access:** the new pages and actions are for roles `admin` and `finance_staff` only. Pages live under `/finance` (PATH_RULE `/finance` → workspace `finance`), and actions check `actionRole("admin", "finance_staff")`.
- **Life** is 1–600 months. A category's salvage % is ≥ 0 and < 100, with at most 2 decimals.
- **Override:**
  - salvage is ≥ 0 and < the asset's cost;
  - the reason is 3–300 characters;
  - it is both fields or neither.
- **Depreciation start:** the month **after** the month of `financeConfirmedAt` (Asia/Manila).
- **As-of month:** the last **completed** Asia/Manila month.
- **Monthly amount:** `monthly = floor(base / lifeMonths)` in centavos. The last month charges `base − monthly × (lifeMonths − 1)`.
- **Floor:** book value is never below salvage.
- **Excluded:** depreciation covers capitalised assets only (`cost` not null AND `financeNotCapitalised` false). The rest are excluded from every total.
- **At cost:** unconfirmed assets and assets with no policy show book value = cost and count in totals at cost.
- **Disposals are ignored:** status never stops depreciation.

## Review Focus

These are the inputs most likely to bite a real user that no task's tests cover by default. Each one gets a test in the task named.

1. **Confirmation late in the evening (Manila) on the last day of a month.** For example, `2026-01-31T22:00+08:00` is still 31 Jan in Manila but already February in UTC. The start must be February. *(Task 5 test.)*
2. **Opening a page on the 1st of a month before 08:00 Manila.** The as-of month is still the month before last. *(Task 5 test.)*
3. **A cost lowered below an existing override's salvage.** It must not produce a negative base. *(Task 5 test: state `bad-salvage`.)*
4. **A send-back whose checklist arrives with a duplicate or unknown key from a tampered form.** It is refused, never stored. *(Task 2 test of `sendBackSchema`.)*
5. **An old send-back from before this phase** (a reason, no field list). It reads as Needs correction with the reason as its note, and an empty checklist. *(Task 2 test of `registrationState` plus `returnSummary`.)*

## Decisions taken in this plan

- **P-1.** If salvage ≥ cost (possible after a cost edit), `depreciate` returns state `bad-salvage`: book value = cost, with the note **"Salvage is not below cost — check the override"** (spec §5.2's `bad-salvage` row).
- **P-2.** The Policies tab edits each row inline. Rows are client islands; the page is a Server Component.
- **P-3.** "Last changed" reads the newest `depreciation.policy` audit row per category, in one query.
- **P-4.** List totals cover every matching capitalised row, not just the page. They are computed in Node through `depreciate` (under 10k assets).
- **P-5.** The Finance nav section "Capitalized assets" is renamed **"Assets & depreciation"**, with items Assets (`/finance/assets`) · Depreciation (`/finance/depreciation`) · Activity log. The page title becomes **"Assets"**.
- **P-6.** The new export routes use `requireRole("admin", "finance_staff")`.
- **P-7. The checklist matches what Edit can change.** The spec §3.3 table lists Delivery and fees and Purchase request. Those live on the shared `PurchaseRecord` and the PR link, and no per-asset edit exists for them, so ticking them would ask IT for a fix it cannot make. `REGISTRATION_FIELDS` therefore drops them. Meanwhile **OR no., Covered by and Who to call** exist on `Asset` (Phase 34) but not on the Edit form, so Task 3 **adds them to `AssetForm` and `updateAsset`**. Task 12 updates the spec's table to match. *Cost if wrong: two checklist rows and one edit surface.*
- **P-8.** "Approve" keeps the existing action `confirmAssetDetails`, and the audit action stays `finance.confirm`. The existing sentence "confirmed {tag}'s details" stays; a not-capitalised approval reads "approved {tag} as not capitalised". *Cost if wrong: one sentence.*
- **P-9.** Finance's review controls leave IT's record page (spec ruling 1):
  - `RecordAction` loses `confirm-details` and `send-back`;
  - `FinanceReviewDialog` is replaced by `ResubmitDialog` (IT's Mark corrected… with a reply), and Finance's own review box lives on the Finance asset page;
  - three e2e specs pinned the old flow (`asset-classes`, `department-owned`, `receiving`), and Task 12 moves them to the new page.
- **P-10.** The **To-review-first** ordering on Finance's list (spec §4.1) applies on the **All** chip. It uses two queries stitched by the pure `pageAcross` helper; with a `fin` chip set, the order is cost desc, tag, id.
- **P-11.** The asset page's **Export** is one sheet: the month-by-month schedule over the asset's whole life (Month, Book value at start, Depreciation, Book value at end, Projected), headed by a summary block of the five money figures. File: `asset-{tag}-YYYY-MM-DD.xlsx`.
- **P-12.** The asset page's Purchase section shows the PR as its ref number (linked) and requester, plus the PR total from its units. The approver's name is omitted, because the PR model's approval data is per-approval rather than a field. *Cost if wrong: one line.*

---

## File structure

**Create**
- `prisma/migrations/20261015090000_registration_depreciation/migration.sql`
- `src/lib/registration.ts` and `src/lib/registration.test.ts`: states, labels, the checklist constant, `where` builders and `pageAcross`.
- `src/lib/registration-input.ts` and `src/lib/registration-input.test.ts`: `sendBackSchema`, `resubmitSchema`, `approveSchema`.
- `src/lib/depreciation.ts` and `src/lib/depreciation.test.ts`
- `src/lib/depreciation-input.ts` and `src/lib/depreciation-input.test.ts`
- `src/server/modules/finance/depreciation-actions.ts` and `src/server/modules/finance/depreciation-queries.ts`
- `src/server/modules/finance/asset-detail.ts`: `financeAssetDetail(id)`.
- `src/components/inventory/resubmit-dialog.tsx`, `src/components/inventory/registration-cell.tsx`, `src/components/inventory/registration-block.tsx`
- `src/components/finance/review-box.tsx`, `send-back-dialog.tsx`, `policy-row.tsx`, `override-dialog.tsx`, `asset-row-menu.tsx`, `schedule-table.tsx`, `fin-chips.tsx`, `use-finance-runner.ts`
- `src/app/(app)/finance/assets/[id]/page.tsx` and `src/app/(app)/finance/assets/[id]/export/route.ts`
- `src/app/(app)/finance/assets/export/route.ts`
- `src/app/(app)/finance/depreciation/page.tsx` and `src/app/(app)/finance/depreciation/export/route.ts`
- `e2e/finance-registration-depreciation.spec.ts`

**Modify**
- `prisma/schema.prisma`
- `src/lib/status.ts`: the `registration` namespace.
- `src/lib/activity.ts` and `src/lib/activity.test.ts`
- `src/lib/workspaces.ts` and `src/lib/workspaces.test.ts`
- `src/lib/record-actions.ts` and `src/lib/record-actions.test.ts`
- `src/lib/inventory-list.ts`, `src/lib/column-prefs.ts`, `src/lib/export-columns.ts`
- `src/server/modules/inventory/actions.ts` and `src/server/modules/inventory/queries.ts`
- `src/server/modules/finance/queries.ts` and `src/server/modules/home/queries.ts`
- `src/components/inventory/inventory-table.tsx`, `inventory-toolbar.tsx`, `record-actions.tsx`, `asset-form.tsx`
- `src/app/(app)/inventory/page.tsx`, `src/app/(app)/inventory/[id]/(record)/page.tsx`, `src/app/(app)/inventory/[id]/edit/page.tsx`
- `src/app/(app)/finance/assets/page.tsx` and `src/app/(app)/page.tsx`
- **Delete:** `src/components/inventory/finance-review.tsx` (P-9).

---

### Task 1: Schema and migration 28

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261015090000_registration_depreciation/migration.sql`

**Interfaces — Produces:**
- `Asset.financeNotCapitalised Boolean @default(false)`, `Asset.financeReturnFields String[] @default([])`, `Asset.financeResubmitNote String?`
- `Asset.depreciationLifeMonths Int?`, `Asset.depreciationSalvage Decimal? @db.Decimal(12,2)`, `Asset.depreciationNote String?`
- `AssetCategory.depreciationLifeMonths Int?`, `AssetCategory.depreciationSalvagePercent Decimal? @db.Decimal(5,2)`

- [ ] **Step 1: Edit the schema.**

  In `model Asset`, right after `financeReturnReason String?`, add:

```prisma
  /// Phase 35 (spec §3.2): approved by Finance as NOT capitalised — no cost, no book value, no depreciation.
  financeNotCapitalised Boolean         @default(false)
  /// Phase 35 (spec §3.3): the send-back checklist — keys of REGISTRATION_FIELDS (src/lib/registration.ts).
  financeReturnFields  String[]         @default([])
  /// Phase 35 (spec §3.4): the registering department's reply on Mark corrected; cleared by Finance's next decision.
  financeResubmitNote  String?
```

  In `model Asset`, after `labelPrintedAt`, add:

```prisma
  /// Phase 35 (spec §5.3): a per-asset override — life AND salvage (pesos) together, or neither.
  depreciationLifeMonths Int?
  depreciationSalvage    Decimal?         @db.Decimal(12, 2)
  depreciationNote       String?
```

  In `model AssetCategory`, after `tagPrefix`, add:

```prisma
  /// Phase 35 (spec §5.3): Finance's straight-line policy for the category; life null = no policy.
  depreciationLifeMonths     Int?
  depreciationSalvagePercent Decimal?    @db.Decimal(5, 2)
```

- [ ] **Step 2: Generate the DDL.**

  Run `git show HEAD:prisma/schema.prisma > <SDD workspace>/old.prisma`, then
  `npx prisma migrate diff --from-schema-datamodel <SDD workspace>/old.prisma --to-schema-datamodel prisma/schema.prisma --script`.
  Write the output to the migration file. Expected: eight `ADD COLUMN` statements and no drops.

  Append these guards as the file's last statements:

```sql
-- Phase 35 (spec §6): an override is both fields or neither.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_depreciation_override_pair"
  CHECK (("depreciationLifeMonths" IS NULL) = ("depreciationSalvage" IS NULL));
-- Phase 35 (spec §6): "not capitalised" is an approval of an asset with no cost.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_not_capitalised_needs_confirm"
  CHECK (NOT "financeNotCapitalised" OR "financeConfirmedAt" IS NOT NULL);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_not_capitalised_no_cost"
  CHECK (NOT "financeNotCapitalised" OR "cost" IS NULL);
```

- [ ] **Step 3: Apply and check.**
  Run `npx prisma migrate deploy && npx prisma generate && npx tsc --noEmit`.
  Expected: `28 migrations found … applied`, and `tsc` clean.

- [ ] **Step 4: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations/20261015090000_registration_depreciation/migration.sql
git commit -m "feat(db): migration 28 -- registration review (not-capitalised flag, send-back checklist, resubmit reply) and depreciation settings (category policy, paired per-asset override), with CHECKs"
```

---

### Task 2: Registration — the pure module and its inputs

**Files:**
- Create: `src/lib/registration.ts`, `src/lib/registration.test.ts`, `src/lib/registration-input.ts`, `src/lib/registration-input.test.ts`
- Modify: `src/lib/status.ts` (add the namespace), and its test if one pins the namespace list.

**Interfaces — Produces (exact):**

```ts
// registration.ts
export type RegState = "awaiting-it" | "with-finance" | "needs-correction" | "registered";
export const REG_STATES: readonly RegState[];            // ["needs-correction","with-finance","awaiting-it","registered"] (facet order)
export const REG_LABEL: Record<RegState, string>;         // IT / Purchasing wording
export const REG_LABEL_FINANCE: Record<RegState, string>; // Finance wording ("registered" → "Approved")
export interface RegFacts { cls: AssetClass; itVerifiedAt: Date | null; financeConfirmedAt: Date | null; financeReturnedAt: Date | null }
export function registrationState(a: RegFacts): RegState;
export function parseRegState(raw: string | null | undefined): RegState | null;
export function regWhere(s: RegState): Prisma.AssetWhereInput;
export const REGISTRATION_FIELDS: ReadonlyArray<{ key: RegFieldKey; label: string; group: RegFieldGroup }>;
export type RegFieldKey = (typeof REGISTRATION_FIELDS)[number]["key"];
export const REGISTRATION_FIELD_KEYS: [RegFieldKey, ...RegFieldKey[]];
export const REG_FIELD_GROUPS: readonly RegFieldGroup[]; // ["Purchase","Warranty","Asset details","Documents","Anything else"]
export function fieldLabels(keys: readonly string[]): string[]; // unknown keys dropped, form order kept
export function returnSummary(a: { financeReturnFields: string[]; financeReturnReason: string | null }): { items: string[]; note: string | null };
export type FinFilter = "with-finance" | "needs-correction" | "awaiting-it" | "approved" | "not-capitalised" | "no-cost";
export const FIN_FILTERS: readonly FinFilter[];
export const FIN_LABEL: Record<FinFilter, string>;
export function parseFin(raw: string | null | undefined): FinFilter | null;
export function finWhere(f: FinFilter): Prisma.AssetWhereInput;
export function pageAcross(firstCount: number, skip: number, take: number): { first: { skip: number; take: number }; rest: { skip: number; take: number } };
// registration-input.ts
export const sendBackSchema; // { id, fields: RegFieldKey[], note?: "" | string }
export const resubmitSchema; // { id, reply?: "" | string }
export const approveSchema;  // { id, notCapitalised?: boolean }
```

- [ ] **Step 1: Write the failing tests** in `src/lib/registration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FIN_FILTERS, REGISTRATION_FIELDS, REG_STATES, fieldLabels, finWhere, pageAcross, parseFin, parseRegState,
  regWhere, registrationState, returnSummary,
} from "./registration";

const d = new Date("2026-10-01T00:00:00Z");
const base = { cls: "IT" as const, itVerifiedAt: d, financeConfirmedAt: null, financeReturnedAt: null };

describe("registrationState", () => {
  it("each state, in the spec's order", () => {
    expect(registrationState({ ...base, itVerifiedAt: null })).toBe("awaiting-it");
    expect(registrationState({ ...base, financeConfirmedAt: d })).toBe("registered");
    expect(registrationState({ ...base, financeReturnedAt: d })).toBe("needs-correction");
    expect(registrationState(base)).toBe("with-finance");
  });
  it("a Purchasing asset is never awaiting IT", () => {
    expect(registrationState({ ...base, cls: "PURCHASING", itVerifiedAt: null })).toBe("with-finance");
  });
  it("awaiting IT wins over everything else", () => {
    expect(registrationState({ ...base, itVerifiedAt: null, financeReturnedAt: d })).toBe("awaiting-it");
  });
  it("parses only known states", () => {
    expect(parseRegState("needs-correction")).toBe("needs-correction");
    expect(parseRegState("bogus")).toBeNull();
    expect(REG_STATES).toEqual(["needs-correction", "with-finance", "awaiting-it", "registered"]);
  });
  it("regWhere mirrors registrationState", () => {
    expect(regWhere("awaiting-it")).toEqual({ cls: "IT", itVerifiedAt: null });
    expect(regWhere("registered")).toEqual({ NOT: { cls: "IT", itVerifiedAt: null }, financeConfirmedAt: { not: null } });
    expect(regWhere("needs-correction")).toEqual({ NOT: { cls: "IT", itVerifiedAt: null }, financeConfirmedAt: null, financeReturnedAt: { not: null } });
    expect(regWhere("with-finance")).toEqual({ NOT: { cls: "IT", itVerifiedAt: null }, financeConfirmedAt: null, financeReturnedAt: null });
  });
});

describe("REGISTRATION_FIELDS", () => {
  it("unique keys, other present and last", () => {
    const keys = REGISTRATION_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.at(-1)).toBe("other");
  });
  it("fieldLabels keeps form order and drops unknown keys", () => {
    expect(fieldLabels(["doc:invoice", "cost", "nope"])).toEqual(["Cost", "Sales invoice"]);
  });
});

describe("returnSummary (Review Focus 5)", () => {
  it("a pre-Phase-35 send-back: reason becomes the note, no items", () => {
    expect(returnSummary({ financeReturnFields: [], financeReturnReason: "Wrong invoice" })).toEqual({ items: [], note: "Wrong invoice" });
  });
  it("a checklist with no note", () => {
    expect(returnSummary({ financeReturnFields: ["cost"], financeReturnReason: null })).toEqual({ items: ["Cost"], note: null });
  });
});

describe("fin filters", () => {
  it("parse and where", () => {
    expect(FIN_FILTERS).toEqual(["with-finance", "needs-correction", "awaiting-it", "approved", "not-capitalised", "no-cost"]);
    expect(parseFin("approved")).toBe("approved");
    expect(parseFin("x")).toBeNull();
    expect(finWhere("approved")).toEqual({ ...regWhere("registered"), financeNotCapitalised: false });
    expect(finWhere("not-capitalised")).toEqual({ ...regWhere("registered"), financeNotCapitalised: true });
    expect(finWhere("no-cost")).toEqual({ cost: null });
  });
});

describe("pageAcross", () => {
  it("a page entirely inside the first group", () => {
    expect(pageAcross(30, 0, 25)).toEqual({ first: { skip: 0, take: 25 }, rest: { skip: 0, take: 0 } });
  });
  it("a page straddling both groups", () => {
    expect(pageAcross(30, 25, 25)).toEqual({ first: { skip: 25, take: 5 }, rest: { skip: 0, take: 20 } });
  });
  it("a page entirely in the rest", () => {
    expect(pageAcross(30, 50, 25)).toEqual({ first: { skip: 0, take: 0 }, rest: { skip: 20, take: 25 } });
  });
});
```

  And `src/lib/registration-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { approveSchema, resubmitSchema, sendBackSchema } from "./registration-input";

describe("sendBackSchema", () => {
  it("accepts ticked fields with or without a note", () => {
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost", "doc:invoice"] }).success).toBe(true);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost"], note: "Invoice is for PO-90" }).success).toBe(true);
  });
  it("refuses none ticked, unknown or duplicate keys (Review Focus 4)", () => {
    expect(sendBackSchema.safeParse({ id: "a", fields: [] }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost", "hacker"] }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost", "cost"] }).success).toBe(false);
  });
  it("Other needs a note; a note is 3-500 characters", () => {
    expect(sendBackSchema.safeParse({ id: "a", fields: ["other"] }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["other"], note: "Box was opened" }).success).toBe(true);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost"], note: "no" }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost"], note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("resubmitSchema / approveSchema", () => {
  it("reply optional, 3-500 when given", () => {
    expect(resubmitSchema.safeParse({ id: "a" }).success).toBe(true);
    expect(resubmitSchema.safeParse({ id: "a", reply: "" }).success).toBe(true);
    expect(resubmitSchema.safeParse({ id: "a", reply: "ok" }).success).toBe(false);
    expect(resubmitSchema.safeParse({ id: "a", reply: "Uploaded the right invoice" }).success).toBe(true);
  });
  it("approve takes an optional notCapitalised flag", () => {
    expect(approveSchema.safeParse({ id: "a" }).success).toBe(true);
    expect(approveSchema.safeParse({ id: "a", notCapitalised: true }).success).toBe(true);
  });
});
```

  Run `npx vitest run src/lib/registration.test.ts src/lib/registration-input.test.ts`. Expected: FAIL, the modules are missing.

- [ ] **Step 2: Implement `src/lib/registration.ts`.**

```ts
import type { AssetClass, Prisma } from "@prisma/client";
import { isAwaitingItCheck } from "./asset-class";

/**
 * Phase 35 (spec §3.1): an asset's registration review, DERIVED from today's columns — never stored.
 * Order matters: awaiting IT → registered → needs correction → with Finance.
 */
export type RegState = "awaiting-it" | "with-finance" | "needs-correction" | "registered";
export const REG_STATES: readonly RegState[] = ["needs-correction", "with-finance", "awaiting-it", "registered"];

export const REG_LABEL: Record<RegState, string> = {
  "awaiting-it": "Waiting for IT check",
  "with-finance": "With Finance",
  "needs-correction": "Needs correction",
  registered: "Fully registered",
};

export const REG_LABEL_FINANCE: Record<RegState, string> = {
  "awaiting-it": "Waiting for IT",
  "with-finance": "To review",
  "needs-correction": "Sent back",
  registered: "Approved",
};

export interface RegFacts { cls: AssetClass; itVerifiedAt: Date | null; financeConfirmedAt: Date | null; financeReturnedAt: Date | null }

export function registrationState(a: RegFacts): RegState {
  if (isAwaitingItCheck(a)) return "awaiting-it";
  if (a.financeConfirmedAt) return "registered";
  if (a.financeReturnedAt) return "needs-correction";
  return "with-finance";
}

export function parseRegState(raw: string | null | undefined): RegState | null {
  return raw && (REG_STATES as readonly string[]).includes(raw) ? (raw as RegState) : null;
}

const AWAITING_IT: Prisma.AssetWhereInput = { cls: "IT", itVerifiedAt: null };

export function regWhere(s: RegState): Prisma.AssetWhereInput {
  switch (s) {
    case "awaiting-it": return { ...AWAITING_IT };
    case "registered": return { NOT: AWAITING_IT, financeConfirmedAt: { not: null } };
    case "needs-correction": return { NOT: AWAITING_IT, financeConfirmedAt: null, financeReturnedAt: { not: null } };
    case "with-finance": return { NOT: AWAITING_IT, financeConfirmedAt: null, financeReturnedAt: null };
  }
}

/**
 * Phase 35 (spec §3.3, plan P-7): every field IT or Purchasing can fix from Edit (or the Documents tab),
 * in the form's order. Keys equal AssetForm's field keys, so the Edit page can flag them; documents are `doc:<kind>`.
 */
export const REGISTRATION_FIELDS = [
  { key: "cost", label: "Cost", group: "Purchase" },
  { key: "purchasedAt", label: "Purchase date", group: "Purchase" },
  { key: "vendorId", label: "Vendor", group: "Purchase" },
  { key: "invoiceRef", label: "Invoice no.", group: "Purchase" },
  { key: "receiptRef", label: "Official receipt (OR) no.", group: "Purchase" },
  { key: "warrantyUntil", label: "Warranty until", group: "Warranty" },
  { key: "warrantyCoveredBy", label: "Covered by", group: "Warranty" },
  { key: "warrantyContact", label: "Who to call for repairs", group: "Warranty" },
  { key: "brand", label: "Brand", group: "Asset details" },
  { key: "model", label: "Model", group: "Asset details" },
  { key: "categoryId", label: "Category", group: "Asset details" },
  { key: "serial", label: "Serial number", group: "Asset details" },
  { key: "doc:invoice", label: "Sales invoice", group: "Documents" },
  { key: "doc:official-receipt", label: "Official receipt", group: "Documents" },
  { key: "doc:warranty-slip", label: "Warranty slip", group: "Documents" },
  { key: "doc:delivery-receipt", label: "Delivery receipt", group: "Documents" },
  { key: "other", label: "Other (explain in the note)", group: "Anything else" },
] as const;

export type RegFieldKey = (typeof REGISTRATION_FIELDS)[number]["key"];
export type RegFieldGroup = (typeof REGISTRATION_FIELDS)[number]["group"];
export const REGISTRATION_FIELD_KEYS = REGISTRATION_FIELDS.map((f) => f.key) as unknown as [RegFieldKey, ...RegFieldKey[]];
export const REG_FIELD_GROUPS: readonly RegFieldGroup[] = ["Purchase", "Warranty", "Asset details", "Documents", "Anything else"];

export function fieldLabels(keys: readonly string[]): string[] {
  const set = new Set(keys);
  return REGISTRATION_FIELDS.filter((f) => set.has(f.key)).map((f) => f.label);
}

/** What IT reads: the ticked labels, and the note (a pre-Phase-35 reason reads as the note). */
export function returnSummary(a: { financeReturnFields: string[]; financeReturnReason: string | null }): { items: string[]; note: string | null } {
  return { items: fieldLabels(a.financeReturnFields), note: a.financeReturnReason };
}

/** Phase 35 (spec §4.1): Finance's list chips. */
export type FinFilter = "with-finance" | "needs-correction" | "awaiting-it" | "approved" | "not-capitalised" | "no-cost";
export const FIN_FILTERS: readonly FinFilter[] = ["with-finance", "needs-correction", "awaiting-it", "approved", "not-capitalised", "no-cost"];
export const FIN_LABEL: Record<FinFilter, string> = {
  "with-finance": "To review", "needs-correction": "Sent back", "awaiting-it": "Waiting for IT",
  approved: "Approved", "not-capitalised": "Not capitalised", "no-cost": "No cost",
};

export function parseFin(raw: string | null | undefined): FinFilter | null {
  return raw && (FIN_FILTERS as readonly string[]).includes(raw) ? (raw as FinFilter) : null;
}

export function finWhere(f: FinFilter): Prisma.AssetWhereInput {
  switch (f) {
    case "approved": return { ...regWhere("registered"), financeNotCapitalised: false };
    case "not-capitalised": return { ...regWhere("registered"), financeNotCapitalised: true };
    case "no-cost": return { cost: null };
    default: return regWhere(f);
  }
}

/** Plan P-10: one page of `firstCount` rows of group A followed by group B, as two (skip, take) windows. */
export function pageAcross(firstCount: number, skip: number, take: number) {
  const firstSkip = Math.min(skip, firstCount);
  const firstTake = Math.max(0, Math.min(take, firstCount - skip));
  const restSkip = Math.max(0, skip - firstCount);
  return { first: { skip: firstTake ? firstSkip : 0, take: firstTake }, rest: { skip: restSkip, take: take - firstTake } };
}
```

- [ ] **Step 3: Implement `src/lib/registration-input.ts`.**

```ts
import { z } from "zod";
import { REGISTRATION_FIELD_KEYS } from "./registration";

/** Phase 35 (spec §3.3-3.4): Finance's send-back, the department's reply, Finance's approval. */
const text = z.string().trim().min(3, "Say a little more — at least 3 characters").max(500, "500 characters at most");

export const sendBackSchema = z.object({
  id: z.string().min(1),
  fields: z.array(z.enum(REGISTRATION_FIELD_KEYS)).min(1, "Tick at least one thing that's wrong")
    .refine((f) => new Set(f).size === f.length, "Each item once"),
  note: z.union([z.literal(""), text]).optional(),
}).refine((v) => !v.fields.includes("other") || !!v.note, { message: "Explain “Other” in the note", path: ["note"] });

export const resubmitSchema = z.object({ id: z.string().min(1), reply: z.union([z.literal(""), text]).optional() });

export const approveSchema = z.object({ id: z.string().min(1), notCapitalised: z.boolean().optional() });
```

- [ ] **Step 4: Add the status namespace.**
  In `src/lib/status.ts`, `StatusNamespace` becomes `"employment" | "delivery" | "registration"`, and `NAMESPACED` gains:

```ts
  registration: { "awaiting-it": "neutral", "with-finance": "inflight", "needs-correction": "fault", registered: "settled" },
```

  If a test pins the namespaces (`grep -n NAMESPACED src/lib/status.test.ts`), add a case asserting `hasStatusFamily("needs-correction", "registration")`.

- [ ] **Step 5: Run the checks.** Run `npx vitest run && npx tsc --noEmit`. Expected: green.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/registration.ts src/lib/registration.test.ts src/lib/registration-input.ts src/lib/registration-input.test.ts src/lib/status.ts src/lib/status.test.ts
git commit -m "feat(registration): derived registration state, the send-back checklist, Finance filters and their inputs"
```

---

### Task 3: Registration — actions, Edit form fields, audit sentences

**Files:**
- Modify: `src/server/modules/inventory/actions.ts` (`confirmAssetDetails`, `returnAssetToIt`, `resubmitAssetToFinance`, `updateSchema` / `updateAsset`), `src/server/modules/finance/queries.ts` (`nextToReview`), `src/components/inventory/asset-form.tsx`, `src/app/(app)/inventory/[id]/edit/page.tsx`, `src/lib/activity.ts`, `src/lib/activity.test.ts`

**Interfaces:**
- Consumes: Task 2 (`sendBackSchema`, `resubmitSchema`, `approveSchema`, `fieldLabels`).
- Produces:
  - `confirmAssetDetails({ id, notCapitalised? })` → `ActionResult<{ tag; next: { id; tag } | null }>`
  - `returnAssetToIt({ id, fields, note? })` → `ActionResult<{ tag }>`
  - `resubmitAssetToFinance({ id, reply? })` → `ActionResult<{ tag }>`
  - `updateAsset` accepts `receiptRef`, `warrantyCoveredBy` (`"" | "manufacturer" | "vendor" | "both"`) and `warrantyContact`.
  - `AssetForm` takes the optional props `flagged?: string[]` and `flagNote?: string | null`.
  - `nextToReview(currentId, cls)` covers every `with-finance` asset, oldest `createdAt` first.

- [ ] **Step 1: Failing audit-sentence tests.** Append to `src/lib/activity.test.ts`:

```ts
describe("Phase 35 registration sentences", () => {
  const s = (action: string, diff: unknown) => auditSentence({ actorLabel: "L. Domingo", action, diff, entityLabel: "BR-LT-0214" });
  it("send-back with items and a note; an old reason still reads", () => {
    expect(s("finance.return", { financeReturn: { from: null, to: { fields: ["Cost", "Sales invoice"], note: "Wrong PO" } } }))
      .toBe("L. Domingo sent BR-LT-0214 back: Cost, Sales invoice — “Wrong PO”");
    expect(s("finance.return", { financeReturn: { from: null, to: { fields: ["Cost"], note: null } } }))
      .toBe("L. Domingo sent BR-LT-0214 back: Cost");
    expect(s("finance.return", { financeReturn: { from: null, to: "Wrong invoice" } }))
      .toBe("L. Domingo sent BR-LT-0214 back to IT · Wrong invoice");
  });
  it("resubmit with a reply, approval as not capitalised, reopen", () => {
    expect(s("finance.resubmit", { financeReturn: { from: "returned", to: null }, reply: { from: null, to: "Uploaded it" } }))
      .toBe("L. Domingo marked BR-LT-0214 corrected — “Uploaded it”");
    expect(s("finance.confirm", { financeConfirmed: { from: null, to: "L. Domingo" }, notCapitalised: { from: false, to: true } }))
      .toBe("L. Domingo approved BR-LT-0214 as not capitalised");
    expect(s("finance.reopened", { cost: { from: null, to: 500 } }))
      .toBe("L. Domingo added a cost to BR-LT-0214, so it went back to Finance");
  });
});
```

  Run it. Expected: FAIL.

- [ ] **Step 2: The sentences.** In `src/lib/activity.ts`:
  - Replace the `finance.return` case:

```ts
    case "finance.return": {
      // Phase 35 (spec §3.3): `to` is { fields: labels[], note } now; a string is a pre-Phase-35 reason.
      const to = diff?.financeReturn?.to as { fields?: string[]; note?: string | null } | string | null | undefined;
      if (to && typeof to === "object") {
        const items = (to.fields ?? []).join(", ");
        const note = to.note ? ` — “${to.note}”` : "";
        return omitEntity ? `${actor}sent back: ${items}${note}` : `${actor}sent ${entry.entityLabel} back: ${items}${note}`;
      }
      const tail = to ? ` · ${String(to)}` : "";
      return omitEntity ? `${actor}sent back to IT${tail}` : `${actor}sent ${entry.entityLabel} back to IT${tail}`;
    }
```

  - Replace `finance.resubmit`:

```ts
    case "finance.resubmit": {
      const reply = diff?.reply?.to ? ` — “${String(diff.reply.to)}”` : "";
      if (reply) return omitEntity ? `${actor}marked corrected${reply}` : `${actor}marked ${entry.entityLabel} corrected${reply}`;
      return omitEntity ? `${actor}marked corrected for Finance` : `${actor}marked ${entry.entityLabel} corrected for Finance`;
    }
```

  - In `finance.confirm`, before the existing return, add:

```ts
      if (diff?.notCapitalised?.to === true) {
        return omitEntity ? `${actor}approved as not capitalised` : `${actor}approved ${entry.entityLabel} as not capitalised`;
      }
```

    The `case` becomes a block `{ … }` if it isn't one.
  - Add `finance.reopened`:

```ts
    case "finance.reopened":
      return omitEntity ? `${actor}added a cost, so it went back to Finance` : `${actor}added a cost to ${entry.entityLabel}, so it went back to Finance`;
```

  - In the action-label map near the top of the file (line ~22), add `"finance.reopened": "Back to Finance"`.

  Run the test. Expected: PASS. Run the whole `activity.test.ts`; existing `finance.return` pins still pass via the string branch.

- [ ] **Step 3: `confirmAssetDetails`.** Replace `confirmSchema` with `approveSchema` (import from `@/lib/registration-input`).
  - **Select:** add `cost: true, financeReturnedAt: true` to the `findUnique` select.
  - **Guards,** after the existing awaiting-IT guard:

```ts
    if (asset.financeReturnedAt) {
      failure = conflict(`${asset.tag} is waiting for ${CLASS_LABEL[asset.cls]} to correct it — Finance reviews it when it comes back.`);
      return;
    }
    const notCap = parsed.data.notCapitalised === true;
    if (notCap && asset.cost !== null) {
      failure = conflict(`${asset.tag} has a cost, so it is approved as capitalised — use Approve.`);
      return;
    }
    if (!notCap && asset.cost === null) {
      failure = conflict(`${asset.tag} has no cost. Send it back for the cost, or approve it as not capitalised.`);
      return;
    }
```

  - **Where:** the `updateMany` gains `financeReturnedAt: null` (state-guarded).
  - **Data** gains `financeNotCapitalised: notCap, financeReturnFields: [], financeResubmitNote: null`.
  - **Audit diff** becomes `{ financeConfirmed: { from: null, to: user.name }, ...(notCap ? { notCapitalised: { from: false, to: true } } : {}) }`.
  - **Revalidate:** add `revalidatePath("/finance/assets")` and `revalidatePath(\`/finance/assets/${parsed.data.id}\`)`.

  Import `CLASS_LABEL` from `@/lib/asset-class` if it isn't imported already.

- [ ] **Step 4: `returnAssetToIt`.**
  - **Schema:** replace `returnSchema` with `sendBackSchema`.
  - **Body:** destructure `{ id, fields, note }` and compute `const cleanNote = note ? note : null;`.
  - **Data:** `financeReturnedAt: new Date(), financeReturnedById: user.id, financeReturnReason: cleanNote, financeReturnFields: fields, financeResubmitNote: null`.
  - **Audit diff:** `{ financeReturn: { from: null, to: { fields: fieldLabels(fields), note: cleanNote } } }`.
  - Keep the rest as is, and add the two `/finance/assets` revalidations.
  - Update the doc comment: the reason is now an optional note plus a checklist (spec §3.3).

- [ ] **Step 5: `resubmitAssetToFinance`.**
  - **Schema:** `resubmitSchema`.
  - **Data:** `financeReturnedAt: null, financeReturnedById: null, financeReturnReason: null, financeReturnFields: [], financeResubmitNote: reply ? reply : null`.
  - **Audit diff:** `{ financeReturn: { from: "returned", to: null }, ...(reply ? { reply: { from: null, to: reply } } : {}) }`.
  - Add the two `/finance/assets` revalidations.

- [ ] **Step 6: `updateSchema` / `updateAsset` (P-7 and spec §3.6).**
  - **Schema:** add to `updateSchema`:

```ts
  receiptRef: z.string().trim().max(60).optional(),
  warrantyCoveredBy: z.union([z.literal(""), z.enum(["manufacturer", "vendor", "both"])]).optional(),
  warrantyContact: z.string().trim().max(120).optional(),
```

    If the Phase 34 register schema uses different max lengths for these, copy those instead: `grep -n "warrantyContact\|receiptRef" src/server/modules/inventory/*.ts`.
  - **`data`:** add `receiptRef: d.receiptRef || null, warrantyCoveredBy: d.warrantyCoveredBy || null, warrantyContact: d.warrantyContact || null`.
  - **Reopen (spec §3.6):** after computing `{ diff, changed }`, and before the no-op return:

```ts
  // Phase 35 (spec §3.6): a cost on an asset approved as NOT capitalised reopens Finance's review —
  // Finance never saw that cost, and depreciation must start from an approval of it.
  const reopen = asset.financeNotCapitalised && data.cost !== null;
```

  - **Inside the transaction:** use `data: reopen ? { ...changed, financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false } : changed`. When `reopen`, write a second audit row:

```ts
      if (reopen) {
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
          action: "finance.reopened", diff: { cost: diff.cost ?? { from: null, to: Number(data.cost) } },
        });
      }
```

  - Revalidate `/finance/assets` as well.

- [ ] **Step 7: Edit form fields and flags.**
  - **`asset-form.tsx`:**
    - Add `receiptRef`, `warrantyCoveredBy` and `warrantyContact` to the form state and `initial` type.
    - Rename the existing "Invoice / receipt no." field label to **"Invoice no."**.
    - In Procurement, add `field("Official receipt (OR) no.", "receiptRef", …)`.
    - Add a **Warranty** card holding `Warranty until` (moved from wherever it renders now), **Covered by** (a `Select` with —, Manufacturer, Vendor, Both — the same options as `purchase-section.tsx:289`) and `field("Who to call for repairs", "warrantyContact")`.
  - **New props:** `flagged?: string[]` and `flagNote?: string | null`.
    - When `flagged` includes a field's key, wrap that `FormField` in `<div data-flagged className="rounded-(--radius-ctl) p-2 ring-2 ring-[var(--st-attention-border)]">`. Its `hint` becomes "Finance flagged this" (prepended to any existing hint with " · ").
    - Above the first card, when `flagged?.length || flagNote`, render `<Banner tone="attention" title="Finance sent this back">`. It lists `fieldLabels(flagged)` and shows `flagNote` in quotes. When any `doc:` key is flagged, it adds a link "Upload documents on the record →" to `/inventory/{assetId}?tab=documents`; check the record's documents tab param with `grep -n "documents" src/components/inventory/record-tabs.tsx`.
  - **`edit/page.tsx`:** pass `initial.receiptRef`, `warrantyCoveredBy` and `warrantyContact` from the asset. When `asset.financeReturnedAt` is set, pass `flagged={asset.financeReturnFields}` and `flagNote={asset.financeReturnReason}`.

- [ ] **Step 8: `nextToReview`** in `src/server/modules/finance/queries.ts`.
  - **Where:** `{ cls, ...regWhere("with-finance"), id: { not: currentId } }`.
  - **Order:** `orderBy: [{ createdAt: "asc" }, { id: "asc" }]`.
  - Update its doc comment (spec §4.1: the queue covers assets without a cost too, oldest registration first).

- [ ] **Step 9: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green. (`finance-review.tsx` still compiles: Task 4 removes it.)

- [ ] **Step 10: Commit.**

```bash
git add src/server/modules/inventory/actions.ts src/server/modules/finance/queries.ts src/components/inventory/asset-form.tsx "src/app/(app)/inventory/[id]/edit/page.tsx" src/lib/activity.ts src/lib/activity.test.ts
git commit -m "feat(registration): approve / approve as not capitalised / send back with a checklist / resubmit with a reply; Edit gains OR no., covered by, repair contact and Finance's flags; a cost reopens a not-capitalised asset"
```

---

### Task 4: Registration — IT and Purchasing see it

**Files:**
- Create: `src/components/inventory/resubmit-dialog.tsx`, `src/components/inventory/registration-cell.tsx`, `src/components/inventory/registration-block.tsx`
- Modify: `src/lib/record-actions.ts`, `src/lib/record-actions.test.ts`, `src/components/inventory/record-actions.tsx`, `src/lib/inventory-list.ts`, `src/lib/column-prefs.ts`, `src/server/modules/inventory/queries.ts`, `src/components/inventory/inventory-table.tsx`, `src/components/inventory/inventory-toolbar.tsx`, `src/app/(app)/inventory/page.tsx`, `src/app/(app)/inventory/[id]/(record)/page.tsx`
- Delete: `src/components/inventory/finance-review.tsx`

**Interfaces:**
- Consumes: Task 2 (`registrationState`, `REG_LABEL`, `REG_STATES`, `parseRegState`, `regWhere`, `returnSummary`) and Task 3 (`resubmitAssetToFinance({ id, reply })`).
- Produces the DOM contract (relied on by e2e):
  - **Column:** the inventory table has a column header **"Registration"**. Each cell holds a `StatusPill ns="registration"` reading the `REG_LABEL`.
  - **Needs correction** cells also show:
    - "Finance flagged:" followed by a `<ul>` of the item labels;
    - the note in quotes;
    - "— {name}, {d Mon}";
    - a link **"Edit"** (only when the viewer may edit);
    - a button **"Mark corrected…"** (only when the viewer manages the class).
  - **Resubmit dialog:** titled `Mark {tag} corrected?`. It has a textarea labelled **"Reply to Finance"** (optional) and the buttons "Cancel" and **"Send to Finance"**. The toast reads `{tag} sent back to Finance`.
  - **Notice:** above the list, when the class has any `needs-correction` asset: `role="status"` with the text "{n} need correction — Finance sent them back." and a link **"Show them"** → `?reg=needs-correction` (keeping `cls`).
  - **Filter:** the facet labelled **"Registration"** in the toolbar, URL parameter `reg`.
  - **Record page:** a block with the heading **"Registration"** showing the pill, then the needs-correction details, and for Finance viewers (role `finance_staff` or `admin`) a link **"Review in Finance →"** to `/finance/assets/{id}`.
  - **Record header:** never offers "Confirm details" or "Send back…" (P-9).

- [ ] **Step 1: `recordActions` (P-9).**
  - In `src/lib/record-actions.ts`:
    - remove `"confirm-details"` and `"send-back"` from the `RecordAction` union, `PRIMARY_ORDER`, `FULL_ORDER`, `applicable` and `actionLabel`;
    - delete the `finance` local.
  - In `record-actions.test.ts`:
    - delete or rewrite every case that expected those two actions;
    - add one case: a Finance user on an unconfirmed, IT-checked asset gets `primary === null` and `more` without any finance action.
  - Run the test. Expected: PASS after the edit.

- [ ] **Step 2: `resubmit-dialog.tsx` (client).**
  - **Props:** `{ open: boolean; onClose: () => void; asset: { id: string; tag: string } }`.
  - **Shape:** copy the runner, toast and rate-limit handling from the deleted `finance-review.tsx`; that file is shown in git history, so `git show HEAD:src/components/inventory/finance-review.tsx`.
  - **Content:** title `Mark ${tag} corrected?`, the blurb "Finance reviews it again. Say what you fixed if it helps them." and `FormField label="Reply to Finance" hint="Optional"` around a `Textarea`.
  - **Submit:** call `resubmitAssetToFinance({ id, reply })`. Field errors go to `fieldErrors.reply`. On success, toast `${tag} sent back to Finance` with tone `settled`, then `router.refresh()`.

- [ ] **Step 3: `record-actions.tsx`.**
  - Remove the `FinanceReviewDialog` import and its `confirm` / `return` triggers.
  - The `mark-corrected` primary and menu item open `ResubmitDialog`.
  - Delete `src/components/inventory/finance-review.tsx`; `grep -rn "finance-review\|NextToReview" src` must return nothing afterwards.

- [ ] **Step 4: Rows carry registration.** In `src/server/modules/inventory/queries.ts`:
  - **Include:** add `financeReturnFields`, `financeReturnReason`, `financeResubmitNote` and `financeReturnedBy: { select: { name: true } }` to the list include/select. The row mapper gets them through `toRow`'s parameter type.
  - **`AssetRow`:** gains `reg: RegState`, `regItems: string[]`, `regNote: string | null`, `regBy: string | null` and `regAt: string | null`. Compute `regAt` with `fmtDate(financeReturnedAt)` and the rest with `registrationState` / `returnSummary`.
  - **Facet:**
    - `INVENTORY_LIST_CONFIG.facets` gains `"reg"`.
    - In `buildAssetWhere` (`src/lib/inventory-list.ts`), next to provenance, add: `const regs = (f.reg ?? []).map(parseRegState).filter((r): r is RegState => r !== null); if (regs.length) and.push({ OR: regs.map(regWhere) });`.
    - In `facetOptions`, add four counts the same way provenance does: `reg: REG_STATES.map((r, i) => ({ value: r, label: REG_LABEL[r], count: regCounts[i] }))`, with `without("reg")`.
  - **Toolbar:** in `inventory-toolbar.tsx`, add `"reg"` to both facet lists. The label is "Registration" (extend the label ternary).

- [ ] **Step 5: The column.**
  - **Column definition:** in `inventory-table.tsx`, `INVENTORY_COLUMNS` gains `{ id: "registration", label: "Registration", width: 220 }` after `status`. `COLUMN_PREF_KEYS["columns:inventory"]` (`src/lib/column-prefs.ts`) gains `"registration"`; check the default-visible list there and include it. Update `column-prefs.test.ts` if it pins the list.
  - **Cell:** `registration-cell.tsx` (client, because it opens `ResubmitDialog`).
    - **Props:** `{ row: AssetRow; canEdit: boolean; canMutate: boolean }`.
    - **Content:** the pill, and the needs-correction block per the DOM contract.
  - **`canEdit`:** computed per row with `canEditAsset(role, { cls: row.cls, itVerifiedAt: row.awaitingItCheck ? null : new Date(0) })`.

- [ ] **Step 6: The notice.** In `src/app/(app)/inventory/page.tsx`:
  - Count `prisma.asset.count({ where: { AND: [{ cls }, regWhere("needs-correction")] } })`, beside the existing reads.
  - When it is above 0 and `state.filters.reg` is not exactly `["needs-correction"]`, render the notice with `Banner tone="fault"`, or the house equivalent used by other list notices: `grep -rn 'role="status"' src/app/\(app\)/inventory`.

- [ ] **Step 7: Record page block.** In `src/app/(app)/inventory/[id]/(record)/page.tsx`, replace the `financeState` line (currently around lines 43–49) with `<RegistrationBlock>`.
  - **Type:** `registration-block.tsx` is a server component.
  - **Props:** `{ asset: { id; tag; cls; itVerifiedAt; financeConfirmedAt; financeReturnedAt; financeReturnFields; financeReturnReason; financeResubmitNote; financeNotCapitalised; financeReturnedBy: { name } | null; financeConfirmedBy: { name } | null }; viewerRole: Role }`.
  - **Contents:**
    - the heading "Registration" and the pill;
    - for `registered`: "Approved by {name} · {date}", plus " · not capitalised" when flagged;
    - for `needs-correction`: the summary;
    - for `with-finance` with a reply: "Your reply: “…”";
    - for Finance viewers: the "Review in Finance →" link.

  Extend the record page's asset query to include those relations.

- [ ] **Step 8: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.

- [ ] **Step 9: Commit.**

```bash
git add -A src/components/inventory src/lib/record-actions.ts src/lib/record-actions.test.ts src/lib/inventory-list.ts src/lib/column-prefs.ts src/lib/column-prefs.test.ts src/server/modules/inventory/queries.ts "src/app/(app)/inventory"
git commit -m "feat(registration): IT and Purchasing see Registration on the list (column, filter, needs-correction notice) and the record; Mark corrected takes a reply; Finance's review leaves the record page"
```

---

### Task 5: Depreciation — the pure calculation

**Files:**
- Create: `src/lib/depreciation.ts`, `src/lib/depreciation.test.ts`

**Interfaces — Produces (exact):**

```ts
export type MonthIndex = number; // year * 12 + (month - 1), Asia/Manila
export function manilaMonth(d: Date): MonthIndex;
export function asOfMonth(now: Date): MonthIndex;                 // last completed month
export function monthLabel(m: MonthIndex): string;                // "September 2026"
export function monthEndLabel(m: MonthIndex): string;             // "30 Sep 2026"
export function toCentavos(v: number | string | { toString(): string } | null | undefined): number | null;
export interface Policy { lifeMonths: number; salvage: number /* centavos */; basis: "category" | "custom" }
export function resolvePolicy(
  asset: { cost: number; lifeMonths: number | null; salvage: number | null },
  category: { lifeMonths: number | null; salvagePercent: number | null },
): Policy | null;
export type DepState = "depreciating" | "fully-depreciated" | "not-started" | "no-policy" | "bad-salvage";
export interface DepResult {
  state: DepState; cost: number; accumulated: number; bookValue: number;
  monthly: number | null; startMonth: MonthIndex | null; policy: Policy | null;
}
export function depreciate(cost: number, confirmedAt: Date | null, policy: Policy | null, asOf: MonthIndex): DepResult;
export interface YearRow { opening: number; months: number[]; projected: boolean[]; total: number; closing: number }
export function yearGrid(cost: number, confirmedAt: Date | null, policy: Policy | null, year: number, asOf: MonthIndex): YearRow | null;
export function stateNote(r: DepResult, categoryName: string): string | null;
```

- [ ] **Step 1: Write the failing tests** in `src/lib/depreciation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  asOfMonth, depreciate, manilaMonth, monthEndLabel, monthLabel, resolvePolicy, stateNote, toCentavos, yearGrid,
} from "./depreciation";

const M = (y: number, m: number) => y * 12 + (m - 1);
const cat = (life: number | null, pct: number | null) => ({ lifeMonths: life, salvagePercent: pct });

describe("months in Asia/Manila", () => {
  it("a late-evening confirmation on the last day stays in that month (Review Focus 1)", () => {
    expect(manilaMonth(new Date("2026-01-31T22:00:00+08:00"))).toBe(M(2026, 1));
  });
  it("as-of is the last completed month, also before 08:00 on the 1st (Review Focus 2)", () => {
    expect(asOfMonth(new Date("2026-10-01T07:30:00+08:00"))).toBe(M(2026, 9));
    expect(asOfMonth(new Date("2026-10-31T23:59:00+08:00"))).toBe(M(2026, 9));
  });
  it("labels", () => {
    expect(monthLabel(M(2026, 9))).toBe("September 2026");
    expect(monthEndLabel(M(2026, 2))).toBe("28 Feb 2026");
  });
});

describe("toCentavos", () => {
  it("converts decimals and strings, keeps null", () => {
    expect(toCentavos("68500.5")).toBe(6_850_050);
    expect(toCentavos(10_000)).toBe(1_000_000);
    expect(toCentavos(null)).toBeNull();
  });
});

describe("resolvePolicy", () => {
  it("override wins over category", () => {
    expect(resolvePolicy({ cost: 1_000_000, lifeMonths: 24, salvage: 50_000 }, cat(36, 10)))
      .toEqual({ lifeMonths: 24, salvage: 50_000, basis: "custom" });
  });
  it("category % → centavos, rounded", () => {
    expect(resolvePolicy({ cost: 1_000_001, lifeMonths: null, salvage: null }, cat(36, 10)))
      .toEqual({ lifeMonths: 36, salvage: 100_000, basis: "category" });
  });
  it("category with life but no % means zero salvage", () => {
    expect(resolvePolicy({ cost: 500_000, lifeMonths: null, salvage: null }, cat(12, null))?.salvage).toBe(0);
  });
  it("no life anywhere → no policy", () => {
    expect(resolvePolicy({ cost: 500_000, lifeMonths: null, salvage: null }, cat(null, 10))).toBeNull();
  });
});

describe("depreciate", () => {
  const p = (life: number, salvage = 0) => ({ lifeMonths: life, salvage, basis: "category" as const });
  const conf = new Date("2026-01-14T10:00:00+08:00"); // starts Feb 2026

  it("₱10,000 over 3 months: 3,333.33 + 3,333.33 + 3,333.34", () => {
    const r1 = depreciate(1_000_000, conf, p(3), M(2026, 2));
    expect([r1.state, r1.monthly, r1.accumulated, r1.bookValue]).toEqual(["depreciating", 333_333, 333_333, 666_667]);
    const r3 = depreciate(1_000_000, conf, p(3), M(2026, 4));
    expect([r3.state, r3.accumulated, r3.bookValue]).toEqual(["fully-depreciated", 1_000_000, 0]);
  });
  it("never below salvage, and stays there after the life", () => {
    const r = depreciate(1_000_000, conf, p(10, 100_000), M(2030, 1));
    expect([r.state, r.bookValue]).toEqual(["fully-depreciated", 100_000]);
  });
  it("a tiny base over a long life never goes negative in the last month", () => {
    const g = yearGrid(7, new Date("2025-12-10T10:00:00+08:00"), p(10), 2026, M(2026, 12));
    expect(g!.months.every((c) => c >= 0)).toBe(true);
    expect(g!.months.reduce((a, b) => a + b, 0)).toBe(7);
  });
  it("starts the month after confirmation; the confirmation month itself charges nothing", () => {
    expect(depreciate(1_000_000, conf, p(3), M(2026, 1)).state).toBe("not-started");
  });
  it("unconfirmed and no-policy show book value = cost", () => {
    expect(depreciate(1_000_000, null, p(3), M(2026, 9))).toMatchObject({ state: "not-started", bookValue: 1_000_000 });
    expect(depreciate(1_000_000, conf, null, M(2026, 9))).toMatchObject({ state: "no-policy", bookValue: 1_000_000 });
  });
  it("salvage at or above cost (cost lowered after an override) is refused, not negative (Review Focus 3)", () => {
    expect(depreciate(100_000, conf, { lifeMonths: 12, salvage: 150_000, basis: "custom" }, M(2026, 9)))
      .toMatchObject({ state: "bad-salvage", bookValue: 100_000, accumulated: 0 });
  });
});

describe("yearGrid", () => {
  const p = (life: number, salvage = 0) => ({ lifeMonths: life, salvage, basis: "category" as const });
  it("a mid-year start: zeros before, charges after, opening = cost", () => {
    const g = yearGrid(1_200_000, new Date("2026-03-05T09:00:00+08:00"), p(12), 2026, M(2026, 9))!;
    expect(g.opening).toBe(1_200_000);
    expect(g.months).toEqual([0, 0, 0, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000]);
    expect(g.projected).toEqual([false, false, false, false, false, false, false, false, false, true, true, true]);
    expect([g.total, g.closing]).toEqual([900_000, 300_000]);
  });
  it("a life ending mid-year", () => {
    const g = yearGrid(1_200_000, new Date("2025-08-20T09:00:00+08:00"), p(12), 2026, M(2026, 12))!;
    expect(g.opening).toBe(800_000);
    expect(g.months.slice(0, 9)).toEqual([100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 0]);
    expect(g.closing).toBe(0);
  });
  it("fully depreciated before the year, not started yet, unconfirmed, no policy → no row (Review Focus 5)", () => {
    expect(yearGrid(1_200_000, new Date("2023-01-05T09:00:00+08:00"), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, new Date("2026-12-20T09:00:00+08:00"), p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, null, p(12), 2026, M(2026, 9))).toBeNull();
    expect(yearGrid(1_200_000, new Date("2026-03-05T09:00:00+08:00"), null, 2026, M(2026, 9))).toBeNull();
  });
});

describe("stateNote", () => {
  it("one plain sentence per non-depreciating state", () => {
    const base = { cost: 1, accumulated: 0, bookValue: 1, monthly: null, startMonth: null, policy: null };
    expect(stateNote({ ...base, state: "not-started" }, "Laptop")).toBe("Not depreciating yet");
    expect(stateNote({ ...base, state: "no-policy" }, "Laptop")).toBe("No policy for Laptop");
    expect(stateNote({ ...base, state: "bad-salvage" }, "Laptop")).toBe("Salvage is not below cost — check the override");
    expect(stateNote({ ...base, state: "fully-depreciated" }, "Laptop")).toBe("Fully depreciated");
    expect(stateNote({ ...base, state: "depreciating" }, "Laptop")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**
  Run `npx vitest run src/lib/depreciation.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement `src/lib/depreciation.ts`.**

```ts
/**
 * Phase 35 (spec §5.2): straight-line depreciation, computed on read. Integer centavos and
 * Asia/Manila calendar months throughout; every screen and export calls these functions.
 */
export type MonthIndex = number;

const MANILA = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Manila" });
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function manilaMonth(d: Date): MonthIndex {
  const [y, m] = MANILA.format(d).split("-").map(Number);
  return y * 12 + (m - 1);
}

export function asOfMonth(now: Date): MonthIndex {
  return manilaMonth(now) - 1;
}

export function monthLabel(m: MonthIndex): string {
  return `${MONTH_NAMES[((m % 12) + 12) % 12]} ${Math.floor(m / 12)}`;
}

export function monthEndLabel(m: MonthIndex): string {
  const y = Math.floor(m / 12);
  const mo = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return `${String(last).padStart(2, "0")} ${SHORT[mo]} ${y}`;
}

export function toCentavos(v: number | string | { toString(): string } | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(Number(typeof v === "object" ? v.toString() : v) * 100);
}

export interface Policy { lifeMonths: number; salvage: number; basis: "category" | "custom" }

export function resolvePolicy(
  asset: { cost: number; lifeMonths: number | null; salvage: number | null },
  category: { lifeMonths: number | null; salvagePercent: number | null },
): Policy | null {
  if (asset.lifeMonths !== null && asset.salvage !== null) {
    return { lifeMonths: asset.lifeMonths, salvage: asset.salvage, basis: "custom" };
  }
  if (category.lifeMonths === null) return null;
  const salvage = Math.round((asset.cost * (category.salvagePercent ?? 0)) / 100);
  return { lifeMonths: category.lifeMonths, salvage, basis: "category" };
}

export type DepState = "depreciating" | "fully-depreciated" | "not-started" | "no-policy" | "bad-salvage";
export interface DepResult {
  state: DepState; cost: number; accumulated: number; bookValue: number;
  monthly: number | null; startMonth: MonthIndex | null; policy: Policy | null;
}

function chargeFor(base: number, life: number, k: number): number {
  if (k < 1 || k > life) return 0;
  const monthly = Math.floor(base / life);
  return k < life ? monthly : base - monthly * (life - 1);
}

function accumulatedThrough(base: number, life: number, start: MonthIndex, through: MonthIndex): number {
  const months = Math.min(Math.max(through - start + 1, 0), life);
  if (months === life) return base;
  return Math.floor(base / life) * months;
}

export function depreciate(cost: number, confirmedAt: Date | null, policy: Policy | null, asOf: MonthIndex): DepResult {
  const flat = (state: DepState, startMonth: MonthIndex | null): DepResult =>
    ({ state, cost, accumulated: 0, bookValue: cost, monthly: null, startMonth, policy });
  if (!confirmedAt) return flat("not-started", null);
  const start = manilaMonth(confirmedAt) + 1;
  if (!policy) return flat("no-policy", start);
  if (policy.salvage >= cost) return flat("bad-salvage", start);
  if (start > asOf) return flat("not-started", start);
  const base = cost - policy.salvage;
  const accumulated = accumulatedThrough(base, policy.lifeMonths, start, asOf);
  return {
    state: accumulated === base ? "fully-depreciated" : "depreciating",
    cost, accumulated, bookValue: cost - accumulated,
    monthly: Math.floor(base / policy.lifeMonths), startMonth: start, policy,
  };
}

export interface YearRow { opening: number; months: number[]; projected: boolean[]; total: number; closing: number }

export function yearGrid(cost: number, confirmedAt: Date | null, policy: Policy | null, year: number, asOf: MonthIndex): YearRow | null {
  if (!confirmedAt || !policy || policy.salvage >= cost) return null;
  const start = manilaMonth(confirmedAt) + 1;
  const first = year * 12;
  if (start > first + 11) return null;
  const base = cost - policy.salvage;
  const months = Array.from({ length: 12 }, (_, i) => chargeFor(base, policy.lifeMonths, first + i - start + 1));
  const opening = cost - accumulatedThrough(base, policy.lifeMonths, start, first - 1);
  const total = months.reduce((a, b) => a + b, 0);
  if (total === 0 && opening <= policy.salvage) return null;
  return { opening, months, projected: months.map((_, i) => first + i > asOf), total, closing: opening - total };
}

export function stateNote(r: DepResult, categoryName: string): string | null {
  switch (r.state) {
    case "not-started": return "Not depreciating yet";
    case "no-policy": return `No policy for ${categoryName}`;
    case "bad-salvage": return "Salvage is not below cost — check the override";
    case "fully-depreciated": return "Fully depreciated";
    default: return null;
  }
}
```

- [ ] **Step 4: Run the tests and the suite.**
  Run `npx vitest run src/lib/depreciation.test.ts && npx vitest run`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/depreciation.ts src/lib/depreciation.test.ts
git commit -m "feat(finance): pure straight-line depreciation (Manila months, centavos, floor + last-month remainder, year grid, state notes)"
```

---

### Task 6: Depreciation — inputs, actions and audit sentences

**Files:**
- Create: `src/lib/depreciation-input.ts`, `src/lib/depreciation-input.test.ts`, `src/server/modules/finance/depreciation-actions.ts`
- Modify: `src/lib/activity.ts`, `src/lib/activity.test.ts`

**Interfaces:**
- Consumes: the Task 1 schema.
- Produces:

```ts
// depreciation-input.ts
export const MAX_LIFE_MONTHS = 600;
export function lifeFromYearsMonths(years: string, months: string): number | null | "bad"; // "" + "" → null
export function lifeLabel(months: number | null): string;            // 36 → "3 years", 18 → "1 year 6 months", null → "—"
export const policySchema: z.ZodType<{ categoryId: string; lifeMonths: number | null; salvagePercent: number | null }>;
export const overrideSchema: z.ZodType<{ assetId: string; lifeMonths: number; salvage: number /* pesos */; note: string }>;
// depreciation-actions.ts ("use server")
export async function setCategoryPolicy(input: unknown): Promise<ActionResult<{ affected: number }>>;
export async function setAssetOverride(input: unknown): Promise<ActionResult<null>>;
export async function clearAssetOverride(input: unknown): Promise<ActionResult<null>>; // { assetId }
```

- [ ] **Step 1: Write the failing input tests.**

```ts
import { describe, expect, it } from "vitest";
import { lifeFromYearsMonths, lifeLabel, overrideSchema, policySchema } from "./depreciation-input";

describe("lifeFromYearsMonths", () => {
  it("years + months → months; both empty → no policy", () => {
    expect(lifeFromYearsMonths("3", "")).toBe(36);
    expect(lifeFromYearsMonths("1", "6")).toBe(18);
    expect(lifeFromYearsMonths("", "")).toBeNull();
  });
  it("refuses junk, months ≥ 12, zero and > 50 years", () => {
    for (const [y, m] of [["x", ""], ["1", "12"], ["0", "0"], ["51", "0"], ["-1", ""]]) expect(lifeFromYearsMonths(y, m)).toBe("bad");
  });
});

describe("lifeLabel", () => {
  it("reads naturally", () => {
    expect(lifeLabel(36)).toBe("3 years");
    expect(lifeLabel(18)).toBe("1 year 6 months");
    expect(lifeLabel(5)).toBe("5 months");
    expect(lifeLabel(null)).toBe("—");
  });
});

describe("policySchema", () => {
  it("accepts a policy and a cleared policy", () => {
    expect(policySchema.safeParse({ categoryId: "c", lifeMonths: 36, salvagePercent: 10 }).success).toBe(true);
    expect(policySchema.safeParse({ categoryId: "c", lifeMonths: null, salvagePercent: null }).success).toBe(true);
  });
  it("refuses salvage ≥ 100, > 2 decimals, a % without a life, and life out of range", () => {
    for (const v of [
      { lifeMonths: 36, salvagePercent: 100 }, { lifeMonths: 36, salvagePercent: 10.123 },
      { lifeMonths: null, salvagePercent: 10 }, { lifeMonths: 0, salvagePercent: 0 }, { lifeMonths: 601, salvagePercent: 0 },
    ]) expect(policySchema.safeParse({ categoryId: "c", ...v }).success).toBe(false);
  });
});

describe("overrideSchema", () => {
  it("needs life, salvage and a 3–300 character reason", () => {
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: 5000, note: "refurbished" }).success).toBe(true);
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: 5000, note: "no" }).success).toBe(false);
    expect(overrideSchema.safeParse({ assetId: "a", lifeMonths: 24, salvage: -1, note: "refurbished" }).success).toBe(false);
  });
});
```

  Run `npx vitest run src/lib/depreciation-input.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/lib/depreciation-input.ts`.**

```ts
import { z } from "zod";

/** Phase 35 (spec §5.4-5.5): the depreciation settings' input rules, shared by the forms and the actions. */
export const MAX_LIFE_MONTHS = 600;

export function lifeFromYearsMonths(years: string, months: string): number | null | "bad" {
  const y = years.trim(), m = months.trim();
  if (y === "" && m === "") return null;
  if ((y !== "" && !/^\d+$/.test(y)) || (m !== "" && !/^\d+$/.test(m))) return "bad";
  const total = Number(y || 0) * 12 + Number(m || 0);
  if (Number(m || 0) > 11 || total < 1 || total > MAX_LIFE_MONTHS) return "bad";
  return total;
}

export function lifeLabel(months: number | null): string {
  if (months === null) return "—";
  const y = Math.floor(months / 12), m = months % 12;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [y ? part(y, "year") : "", m ? part(m, "month") : ""].filter(Boolean).join(" ");
}

const twoDecimals = (n: number) => Math.round(n * 100) === n * 100;
const life = z.number().int().min(1, "Life is at least 1 month").max(MAX_LIFE_MONTHS, "Life is at most 50 years");

export const policySchema = z.object({
  categoryId: z.string().min(1),
  lifeMonths: life.nullable(),
  salvagePercent: z.number().min(0, "Salvage can't be negative").lt(100, "Salvage must be under 100%")
    .refine(twoDecimals, "Two decimals at most").nullable(),
}).refine((v) => v.lifeMonths !== null || v.salvagePercent === null, { message: "Set a useful life first", path: ["lifeMonths"] });

export const overrideSchema = z.object({
  assetId: z.string().min(1),
  lifeMonths: life,
  salvage: z.number().min(0, "Salvage can't be negative").refine(twoDecimals, "Whole centavos only"),
  note: z.string().trim().min(3, "Say why this asset differs").max(300),
});
```

  Run the test. Expected: PASS.

- [ ] **Step 3: Failing audit-sentence test.** Append to `src/lib/activity.test.ts`:

```ts
describe("Phase 35 depreciation sentences", () => {
  const s = (action: string, diff: unknown, label = "Laptop") => auditSentence({ actorLabel: "L. Domingo", action, diff, entityLabel: label });
  it("policy set and cleared", () => {
    expect(s("depreciation.policy", { lifeMonths: { from: null, to: 36 }, salvagePercent: { from: null, to: 10 } }))
      .toBe("L. Domingo set depreciation on Laptop: 3 years, 10% salvage");
    expect(s("depreciation.policy", { lifeMonths: { from: 36, to: null }, salvagePercent: { from: 10, to: null } }))
      .toBe("L. Domingo cleared depreciation on Laptop");
  });
  it("override set and cleared", () => {
    expect(s("depreciation.override", { lifeMonths: { from: null, to: 24 }, salvage: { from: null, to: 5000 } }, "BR-LT-0148"))
      .toBe("L. Domingo set custom depreciation on BR-LT-0148: 2 years, ₱5,000.00 salvage");
    expect(s("depreciation.override.cleared", null, "BR-LT-0148")).toBe("L. Domingo cleared custom depreciation on BR-LT-0148");
  });
});
```

  Run it. Expected: FAIL.

- [ ] **Step 4: Add the cases in `src/lib/activity.ts`.**

  Add them before `default`, using the switch's `actor`, `diff` and `omitEntity` locals. Import `lifeLabel` from `./depreciation-input` and `fmtMoneyExact` from `./format`.

```ts
    case "depreciation.policy": {
      const life = diff?.lifeMonths?.to as number | null | undefined;
      if (life == null) return omitEntity ? `${actor}cleared depreciation` : `${actor}cleared depreciation on ${entry.entityLabel}`;
      const pct = (diff?.salvagePercent?.to as number | null | undefined) ?? 0;
      const tail = `${lifeLabel(life)}, ${pct}% salvage`;
      return omitEntity ? `${actor}set depreciation: ${tail}` : `${actor}set depreciation on ${entry.entityLabel}: ${tail}`;
    }
    case "depreciation.override": {
      const tail = `${lifeLabel(diff?.lifeMonths?.to as number)}, ${fmtMoneyExact(diff?.salvage?.to as number)} salvage`;
      return omitEntity ? `${actor}set custom depreciation: ${tail}` : `${actor}set custom depreciation on ${entry.entityLabel}: ${tail}`;
    }
    case "depreciation.override.cleared":
      return omitEntity ? `${actor}cleared custom depreciation` : `${actor}cleared custom depreciation on ${entry.entityLabel}`;
```

  Run the test. Expected: PASS. If `activity.ts` keeps an Action-filter label map (search for `"purchase.recorded"` in `src/lib`), add the three actions there with the labels "Depreciation policy", "Custom depreciation" and "Custom depreciation cleared".

- [ ] **Step 5: Implement `src/server/modules/finance/depreciation-actions.ts`.**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { overrideSchema, policySchema } from "@/lib/depreciation-input";

/** Phase 35 (spec §5.4): a category's policy; the reply says how many costed assets it now drives (overrides excluded). */
export async function setCategoryPolicy(input: unknown): Promise<ActionResult<{ affected: number }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const cat = await prisma.assetCategory.findUnique({ where: { id: d.categoryId } });
  if (!cat) return conflict("That category no longer exists. Refresh and try again.");
  const before = { lifeMonths: cat.depreciationLifeMonths, salvagePercent: cat.depreciationSalvagePercent === null ? null : Number(cat.depreciationSalvagePercent) };
  await prisma.$transaction(async (tx) => {
    await tx.assetCategory.update({
      where: { id: cat.id },
      data: { depreciationLifeMonths: d.lifeMonths, depreciationSalvagePercent: d.lifeMonths === null ? null : (d.salvagePercent ?? 0) },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset-category", entityId: cat.id, action: "depreciation.policy",
      diff: {
        lifeMonths: { from: before.lifeMonths, to: d.lifeMonths },
        salvagePercent: { from: before.salvagePercent, to: d.lifeMonths === null ? null : (d.salvagePercent ?? 0) },
      },
    });
  });
  const affected = await prisma.asset.count({ where: { categoryId: cat.id, cost: { not: null }, financeNotCapitalised: false, depreciationLifeMonths: null } });
  revalidatePath("/finance/depreciation");
  revalidatePath("/finance/assets");
  return ok({ affected });
}

/** Phase 35 (spec §5.5): life AND salvage (pesos) AND a reason, together. */
export async function setAssetOverride(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const asset = await prisma.asset.findUnique({ where: { id: d.assetId } });
  if (!asset || asset.cost === null) return conflict("This asset has no cost, so it can't depreciate.");
  if (d.salvage >= Number(asset.cost)) return validationError({ salvage: "Salvage must be less than the cost" });
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id: asset.id }, data: { depreciationLifeMonths: d.lifeMonths, depreciationSalvage: d.salvage, depreciationNote: d.note } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: "depreciation.override",
      diff: {
        lifeMonths: { from: asset.depreciationLifeMonths, to: d.lifeMonths },
        salvage: { from: asset.depreciationSalvage === null ? null : Number(asset.depreciationSalvage), to: d.salvage },
        note: { from: asset.depreciationNote, to: d.note },
      },
    });
  });
  revalidatePath("/finance/assets");
  revalidatePath("/finance/depreciation");
  return ok(null);
}

export async function clearAssetOverride(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const id = typeof input === "object" && input && "assetId" in input ? String((input as { assetId: unknown }).assetId) : "";
  if (!id) return validationError({ assetId: "Missing asset" });
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset || asset.depreciationLifeMonths === null) return conflict("This asset has no custom depreciation to clear.");
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null } });
    await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: id, action: "depreciation.override.cleared" });
  });
  revalidatePath("/finance/assets");
  revalidatePath("/finance/depreciation");
  return ok(null);
}
```

- [ ] **Step 6: Run the checks.** Run `npx tsc --noEmit && npx vitest run`. Expected: green.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/depreciation-input.ts src/lib/depreciation-input.test.ts src/server/modules/finance/depreciation-actions.ts src/lib/activity.ts src/lib/activity.test.ts
git commit -m "feat(finance): depreciation inputs, policy/override actions (role → rate → zod, audited), audit sentences"
```

---

### Task 7: Finance queries — the register, totals, policies, schedule, asset detail, home

**Files:**
- Create: `src/server/modules/finance/depreciation-queries.ts`, `src/server/modules/finance/asset-detail.ts`
- Modify: `src/server/modules/finance/queries.ts`, `src/server/modules/home/queries.ts`, `src/lib/depreciation.ts`, `src/lib/depreciation.test.ts`

**Interfaces:**
- Consumes: Task 2 (`regWhere`, `finWhere`, `FIN_FILTERS`, `pageAcross`, `registrationState`, `REG_LABEL_FINANCE`, `returnSummary`), Task 5 (`depreciate`, `resolvePolicy`, `toCentavos`, `asOfMonth`, `monthLabel`, `monthEndLabel`, `stateNote`, `yearGrid`, `manilaMonth`) and Task 6 (`lifeLabel`).
- Produces:

```ts
// src/lib/depreciation.ts (pure, added here)
export function affectedByPolicy(rows: Array<{ costC: number | null; custom: boolean }>): number;
export interface LifeYear { year: number; opening: number; total: number; closing: number; done: number; projected: number; months: Array<{ month: MonthIndex; opening: number; charge: number; closing: number; projected: boolean }> }
export function lifeYears(cost: number, confirmedAt: Date | null, policy: Policy | null, asOf: MonthIndex): LifeYear[];
// depreciation-queries.ts (server-only)
export const CAPITALISED: Prisma.AssetWhereInput; // { cost: { not: null }, financeNotCapitalised: false }
export interface DepAssetRow { id: string; tag: string; model: string; category: string; cls: AssetClass; status: AssetStatus;
  holder: string | null; reg: RegState; notCapitalised: boolean;
  costC: number | null; confirmedAt: Date | null; result: DepResult | null; note: string | null; custom: boolean; overrideNote: string | null;
  lifeMonths: number | null; salvageC: number | null; categoryLife: number | null; categorySalvagePercent: number | null }
export async function depRows(where: Prisma.AssetWhereInput, now?: Date): Promise<DepAssetRow[]>; // every row; result null when excluded
export async function bookValueTotals(where: Prisma.AssetWhereInput, now?: Date): Promise<{ costC: number; accumulatedC: number; bookC: number; asOf: MonthIndex }>;
export interface PolicyRow { id: string; name: string; cls: AssetClass; costed: number; affected: number; lifeMonths: number | null; salvagePercent: number | null; changedBy: string | null; changedAt: Date | null }
export async function policyRows(): Promise<PolicyRow[]>;
export interface ScheduleGroup { category: string; rows: Array<{ id: string; tag: string; model: string; costC: number; custom: boolean; grid: YearRow }>; subtotal: YearRow }
export async function scheduleYear(cls: AssetClass, year: number, now?: Date): Promise<{ groups: ScheduleGroup[]; total: YearRow | null; notStarted: number; noPolicy: number; asOf: MonthIndex; years: number[] }>;
// finance/queries.ts
export interface FinanceListParams { cls: AssetClass; status: AssetStatus | null; fin: FinFilter | null; q: string; page: number }
export function financeListWhere(p: Omit<FinanceListParams, "page" | "fin">): Prisma.AssetWhereInput;
export async function financeAssets(p: FinanceListParams, now?: Date): Promise<{
  rows: DepAssetRow[]; total: number; page: number; pageCount: number;
  chips: Record<FinFilter | "all", number>;
  totals: { count: number; costed: number; cost: string; depreciation: string; book: string; asOfLabel: string } }>;
// asset-detail.ts
export async function financeAssetDetail(id: string, now?: Date): Promise<FinanceAssetDetail | null>; // see Step 5
// home/queries.ts: FinanceHome gains { bookValue: string; depreciation: string; asOfEnd: string; toReview: number }
```

- [ ] **Step 1: Pure helpers, test first.** Append to `src/lib/depreciation.test.ts`:

```ts
import { affectedByPolicy, lifeYears } from "./depreciation";

describe("affectedByPolicy", () => {
  it("counts costed rows without a custom override", () => {
    expect(affectedByPolicy([{ costC: 100, custom: false }, { costC: 200, custom: true }, { costC: null, custom: false }])).toBe(1);
  });
});

describe("lifeYears", () => {
  const p = { lifeMonths: 36, salvage: 550_000, basis: "category" as const };
  it("BR-LT-0148: ₱55,000 confirmed 10 Mar 2025, 3 years, 10% salvage, as of Sep 2026", () => {
    const ys = lifeYears(5_500_000, new Date("2025-03-10T10:00:00+08:00"), p, 2026 * 12 + 8);
    expect(ys.map((y) => y.year)).toEqual([2025, 2026, 2027, 2028]);
    expect(ys[0]).toMatchObject({ opening: 5_500_000, total: 9 * 137_500, done: 9, projected: 0 });
    expect(ys[1]).toMatchObject({ done: 9, projected: 3 });
    expect(ys[3].closing).toBe(550_000);
    expect(ys[1].months[0]).toMatchObject({ charge: 137_500, projected: false });
  });
  it("unconfirmed or no policy → no years", () => {
    expect(lifeYears(5_500_000, null, p, 2026 * 12 + 8)).toEqual([]);
    expect(lifeYears(5_500_000, new Date("2025-03-10T10:00:00+08:00"), null, 2026 * 12 + 8)).toEqual([]);
  });
});
```

  Run it (FAIL), then implement in `src/lib/depreciation.ts`:

```ts
export function affectedByPolicy(rows: Array<{ costC: number | null; custom: boolean }>): number {
  return rows.filter((r) => r.costC !== null && !r.custom).length;
}

export interface LifeYear {
  year: number; opening: number; total: number; closing: number; done: number; projected: number;
  months: Array<{ month: MonthIndex; opening: number; charge: number; closing: number; projected: boolean }>;
}

/** Phase 35 (spec §4.2 item 5): the asset page's year-by-year schedule over the whole life. */
export function lifeYears(cost: number, confirmedAt: Date | null, policy: Policy | null, asOf: MonthIndex): LifeYear[] {
  if (!confirmedAt || !policy || policy.salvage >= cost) return [];
  const start = manilaMonth(confirmedAt) + 1;
  const end = start + policy.lifeMonths - 1;
  const base = cost - policy.salvage;
  const out: LifeYear[] = [];
  let book = cost;
  for (let y = Math.floor(start / 12); y <= Math.floor(end / 12); y++) {
    const months: LifeYear["months"] = [];
    const opening = book;
    for (let m = Math.max(y * 12, start); m <= Math.min(y * 12 + 11, end); m++) {
      const charge = chargeFor(base, policy.lifeMonths, m - start + 1);
      months.push({ month: m, opening: book, charge, closing: book - charge, projected: m > asOf });
      book -= charge;
    }
    const projected = months.filter((x) => x.projected).length;
    out.push({ year: y, opening, total: opening - book, closing: book, done: months.length - projected, projected, months });
  }
  return out;
}
```

  Run it. Expected: PASS.

- [ ] **Step 2: `depreciation-queries.ts`.** Every function routes through the Task 5 functions; none recomputes arithmetic itself.
  - **`CAPITALISED`:** `{ cost: { not: null }, financeNotCapitalised: false }`.
  - **`depRows(where)`:**
    - `findMany({ where, select: { id, tag, model, cls, status, cost, itVerifiedAt, financeConfirmedAt, financeReturnedAt, financeNotCapitalised, depreciationLifeMonths, depreciationSalvage, depreciationNote, assignee: { select: { name } }, category: { select: { name, depreciationLifeMonths, depreciationSalvagePercent } } } })`.
    - Map each row:
      - `reg = registrationState(row)`;
      - `costC = toCentavos(cost)`;
      - when `costC !== null && !financeNotCapitalised`: `policy = resolvePolicy(...)`, `result = depreciate(costC, financeConfirmedAt, policy, asOfMonth(now))` and `note = stateNote(result, category.name)`;
      - otherwise `result = null` and `note = notCapitalised ? "Not capitalised" : "No cost recorded"`;
      - `custom = policy?.basis === "custom"`.
  - **`bookValueTotals(where)`:** sum over `depRows({ AND: [where, CAPITALISED] })`.
  - **`policyRows()`:**
    - Read categories (both classes) with `_count` of capitalised assets.
    - For each category, `affected` = `affectedByPolicy` over its capitalised rows (`depreciationLifeMonths: null` means not custom). One grouped read: `prisma.asset.groupBy({ by: ["categoryId"], where: { ...CAPITALISED, depreciationLifeMonths: null }, _count: { _all: true } })`.
    - Find the latest change per category with `prisma.auditEntry.findMany({ where: { entityType: "asset-category", action: "depreciation.policy" }, orderBy: { createdAt: "desc" }, select: { entityId, actorLabel, createdAt } })`, keeping the first per `entityId`.
    - Sort no-policy first, then class, then name.
  - **`scheduleYear(cls, year)`:**
    - Build `depRows({ AND: [{ cls }, CAPITALISED] })`, then `yearGrid` per row, dropping nulls.
    - Group by category name and sort by category, then tag.
    - Subtotals and the total sum the `YearRow` fields element-wise; `projected` is the year's flags. `total` is null when there are no groups.
    - `notStarted` / `noPolicy` count the rows whose `result.state` is `not-started` / `no-policy`.
    - `years` runs from the earliest confirmation year (or this year) to this year + 1.

- [ ] **Step 3: `financeAssets`** (rewrite; spec §4.1).
  - **`financeListWhere({ cls, status, q })`:** `{ cls, ...(status ? { status } : {}), ...(q ? { OR: [{ tag: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }, { serial: { contains: q, mode: "insensitive" } }, { assignee: { name: { contains: q, mode: "insensitive" } } }] } : {}) }`. There is no cost filter and no IT gate any more.
  - **Chips:** `chips.all = count(where)`; for each `f` of `FIN_FILTERS`, `count({ AND: [where, finWhere(f)] })`. Run them in one `Promise.all`.
  - **Paging:** `ENTITY_PAGE_SIZE`.
    - **With `fin` set:** `depRows` over `{ AND: [where, finWhere(fin)] }`, ordered by `[{ cost: { sort: "desc", nulls: "last" } }, { tag: "asc" }, { id: "asc" }]`, skip/take.
    - **With `fin` null (P-10):**
      - Group A is `with-finance` ordered `[{ createdAt: "asc" }, { id: "asc" }]`.
      - Group B is `NOT with-finance`, ordered as above.
      - Compute the windows with `pageAcross(chips["with-finance"], skip, take)` and concatenate.
    - `depRows` must accept `orderBy`, `skip` and `take`: extend its signature with an optional `opts: { orderBy?; skip?; take? }`.
  - **Totals:** `bookValueTotals(where)` with the `fin` filter applied when set, plus `count = total` and `costed` = the count of `{ AND: [where(+fin), CAPITALISED] }`. Format with `fmtMoneyExact(c / 100)`; `asOfLabel = monthLabel(asOf)`.
  - **Clean-up:** delete `FinanceAssetRow` and the old body; keep `parseAssetStatus` and `nextToReview`. Update the doc comment (no more "No book-value column").

- [ ] **Step 4: Home.** `financeHome` adds:
  - `bookValueTotals({})` → `bookValue` and `depreciation` (via `fmtMoneyExact`), plus `asOfEnd = monthEndLabel(asOf)`;
  - `toReview = prisma.asset.count({ where: regWhere("with-finance") })`.

  `capitalized` keeps its meaning (cost sum of costed assets).

- [ ] **Step 5: `asset-detail.ts`.**
  - **Read:** `financeAssetDetail(id, now)` reads one asset with:
    - `category` (with its policy), `assignee { name }`, `vendor { name }`;
    - `purchaseRequest { id, refNo, requestedBy { name }, units { qty, unitPrice } }`;
    - `purchaseRecord { fees }`;
    - `documents { id, kind, fileName, createdAt }`;
    - `financeConfirmedBy { name }` and `financeReturnedBy { name }`.
  - **Returns `FinanceAssetDetail`:**
    - **Identity:** `id, tag, model, brand, serial, cls, status, category, holder`.
    - **Registration:** `reg` and `regFinanceLabel` (`REG_LABEL_FINANCE`, or "Not capitalised"); `returnSummary`; `resubmitNote`; `approvedBy`, `approvedAt`; `notCapitalised`.
    - **Money:** `costC`, `result: DepResult | null`, `note`, `policyText` ("Laptop policy · 3 years, 10% salvage", "Custom · 2 years, ₱20,000.00 salvage — {reason}" or "No policy for {category}"), `custom`, `lifeMonths`, `salvageC`, `startLabel`, `endLabel`, `monthsUsed`, `asOfLabel`.
    - **Purchase:** `pr: { id, refNo, requester, totalC } | null`, `vendor`, `invoiceRef`, `receiptRef`, `purchasedAt`, `feesC`, `warrantyUntil`, `coveredBy`, `contact`.
    - **Documents:** `docs` — the four `SLOTS` kinds in order, each `{ kind, title, file: { id, fileName } | null }`, then `other` documents.
    - **Schedule:** `years: LifeYear[]`.
    - **History:** `history: Array<{ at: Date; sentence: string }>`. It holds this asset's audit rows with actions `register`, `update` (only when the diff has `cost`), `finance.*`, `it.verify` and `depreciation.*`, plus its category's `depreciation.policy` rows, newest first, capped at 50. Each sentence comes from `auditSentence`, with entity labels the tag / category name.
  - Returns `null` if not found.

- [ ] **Step 6: Run the checks.** Run `npx tsc --noEmit && npx vitest run`. Expected: green. (The `/finance/assets` page breaks against the new `financeAssets` shape; fix it minimally to compile, since Task 9 rebuilds it.)

- [ ] **Step 7: Commit.**

```bash
git add src/server/modules/finance src/server/modules/home/queries.ts src/lib/depreciation.ts src/lib/depreciation.test.ts "src/app/(app)/finance/assets/page.tsx"
git commit -m "feat(finance): register queries (every asset, search, Finance-state chips, to-review first), depreciation rows/totals/policies/schedule, asset detail, home figures"
```

---

### Task 8: Depreciation page — Policies tab, and the Finance nav

**Files:**
- Create: `src/app/(app)/finance/depreciation/page.tsx`, `src/components/finance/policy-row.tsx`, `src/components/finance/use-finance-runner.ts`
- Modify: `src/lib/workspaces.ts`, `src/lib/workspaces.test.ts`

**Interfaces:**
- Consumes: `policyRows` (Task 7), `setCategoryPolicy` (Task 6), `lifeFromYearsMonths`, `lifeLabel` (Task 6).
- Produces the DOM contract:
  - **Page:** `PageHeader title="Depreciation"`, and `Tabs label="Depreciation views"` with items "Schedule" (`?tab=schedule` or bare) and "Policies" (`?tab=policies`).
  - **Notice:** when policies are missing, `"{n} categories have no useful life yet — their assets show at full cost."`
  - **Row:** each row is a `<tr>` whose first cell is the category name.
    - Its inputs are labelled `"Years for {category}"`, `"Months for {category}"` and `"Salvage percent for {category}"`.
    - The save button reads `Save`.
    - The warning `"This updates the book value of {n} assets, including past months on the schedule."` shows while the row is dirty and `affected > 0`.
  - **Toast on save:** `Saved — {category}`.

- [ ] **Step 1: Nav (P-5).**
  - In `WORKSPACE_NAV.finance`, the section `{ heading: "Capitalized assets", … }` becomes `{ heading: "Assets & depreciation", items: [{ label: "Assets", href: "/finance/assets" }, { label: "Depreciation", href: "/finance/depreciation" }, { label: "Activity log", href: "/finance/activity" }] }`.
  - Fix any existing `workspaces.test.ts` pin of the old heading or label.
  - Add:

```ts
it("Finance nav: Assets & depreciation", () => {
  const sec = WORKSPACE_NAV.finance.find((s) => s.heading === "Assets & depreciation");
  expect(sec?.items.map((i) => i.label)).toEqual(["Assets", "Depreciation", "Activity log"]);
});
it("/finance/depreciation and /finance/assets/<id> are Finance-only", () => {
  for (const p of ["/finance/depreciation", "/finance/assets/abc"]) {
    expect(pathAllowedForRole(p, "finance_staff")).toBe(true);
    expect(pathAllowedForRole(p, "it_staff")).toBe(false);
    expect(pathAllowedForRole(p, "purchasing_staff")).toBe(false);
  }
});
```

  Run `npx vitest run src/lib/workspaces.test.ts`. Expected: PASS.

- [ ] **Step 2: `use-finance-runner.ts`.** Copy the shape of `useEmployeeRunner` (`grep -rn "export function useEmployeeRunner" src`) into a local `useFinanceRunner`: pending, errors, rate-limit, toast.

- [ ] **Step 3: `policy-row.tsx` (client).**
  - **Props:** `{ row: PolicyRow }`.
  - **State:** `years`, `months` (from `row.lifeMonths`) and `salvage` (string). Dirty means the values differ from the initial ones.
  - **Save:** parse with `lifeFromYearsMonths`. A `"bad"` result shows the inline error "Enter whole years and 0–11 months, up to 50 years". Otherwise call `setCategoryPolicy({ categoryId, lifeMonths, salvagePercent: salvage === "" ? null : Number(salvage) })`.
  - **Visible cells:** Category · Class pill · Costed · Useful life (two numeric inputs, "y" / "m" suffixes) · Salvage % · Last changed ("L. Domingo · 15 Oct 2026" or "—") · Save.

- [ ] **Step 4: `page.tsx`.**
  - **Guard:** `requireRole("admin", "finance_staff")`.
  - **Tab:** read `tab`, defaulting to `schedule`.
  - **Policies:** `policyRows()`, the notice, and a `Table` of `PolicyRow`s.
  - **Schedule:** until Task 11, the Schedule tab renders only the tab row.

- [ ] **Step 5: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/workspaces.ts src/lib/workspaces.test.ts "src/app/(app)/finance/depreciation/page.tsx" src/components/finance/policy-row.tsx src/components/finance/use-finance-runner.ts
git commit -m "feat(finance): Depreciation page Policies tab (inline life + salvage per category, change warning, last changed); nav becomes Assets & depreciation"
```

---

### Task 9: Finance's Assets list — the register

**Files:**
- Modify: `src/app/(app)/finance/assets/page.tsx`, `src/lib/export-columns.ts`
- Create: `src/components/finance/fin-chips.tsx`, `src/components/finance/asset-row-menu.tsx`, `src/components/finance/override-dialog.tsx`, `src/app/(app)/finance/assets/export/route.ts`

**Interfaces:**
- Consumes: `financeAssets`, `financeListWhere`, `depRows`, `CAPITALISED` (Task 7); `setAssetOverride` / `clearAssetOverride`, `lifeFromYearsMonths` (Task 6); `FIN_FILTERS`, `FIN_LABEL`, `parseFin`, `finWhere`, `REG_LABEL_FINANCE` (Task 2).
- Produces the DOM contract:
  - **Header:** `PageHeader title="Assets"`, with the class tabs (IT · Purchasing) as today.
  - **Search:** a GET form with a search input labelled **"Search assets"** (placeholder "Tag, model, serial or holder") and parameter `q`.
  - **Chips:** a `nav aria-label="Finance state"` of links "All {n}", "To review {n}", "Sent back {n}", "Waiting for IT {n}", "Approved {n}", "Not capitalised {n}" and "No cost {n}". The current chip has `aria-current="page"`. They keep `cls`, `q` and `status`.
  - **Table headers:** Tag · Model · Category · Status · **Finance** · Cost · **Depreciation to date** · **Book value** · (row menu).
    - The tag links to `/finance/assets/{id}`.
    - The holder shows under the model.
    - The Finance cell is a `StatusPill ns="registration"` with `REG_LABEL_FINANCE`, or "Not capitalised" (value `registered`).
    - Cost is "—" when null.
    - Under the book value: the note (`DepAssetRow.note`), muted.
    - A custom override shows a `Pill` "custom" beside the tag.
  - **Row menu:** `IconButton aria-label="Actions for {tag}"`, with the item **"Depreciation for this asset…"**, only for capitalised rows.
  - **Dialog:** titled `Depreciation for {tag}`, containing:
    - the muted category values ("Category: 3 years, 10% salvage" or "Category: no policy");
    - the inputs "Years", "Months", "Salvage (₱)" and **Reason** (`ReasonField`);
    - a preview line "With this: {monthly} a month · book value now {book}", computed client-side with `resolvePolicy` + `depreciate` from `@/lib/depreciation` (pure);
    - the buttons "Save", "Cancel" and, when custom, "Clear override".
  - **Footer line:** `{count} assets · {costed} with a cost · {cost} at cost · {depreciation} depreciation · {book} book value` plus `As of the end of {Month YYYY}`.
  - **Export:** a button "Export" (`ButtonLink` to `/finance/assets/export?` plus the current `cls`, `status`, `fin` and `q`).

- [ ] **Step 1: Export columns.** In `src/lib/export-columns.ts`, add `FINANCE_ASSETS_EXPORT_COLUMNS: XlsxColumn<DepAssetRow>[]`. Its labels, in order (spec §4.1): Tag, Model, Category, Class, Status, Holder, Registration, Cost, Confirmed on, Starts, Life (months), Salvage, Monthly amount, Depreciation to date, Book value, Basis, Note.
  - Money cells are `{ value: c / 100, type: Number, format: "#,##0.00" }`, or empty when null.
  - Dates are `{ type: Date, format: "yyyy-mm-dd" }`.
  - "Starts" is the `monthLabel` of `result.startMonth`.
  - "Basis" is "Custom" / "Category" / "".
  - "Registration" is the Finance label.
  - "Note" is the override note if custom, else the row note.
- [ ] **Step 2: Export route.**
  - **Guard:** `requireRole("admin", "finance_staff")`.
  - **Parse:** `cls`, `status`, `fin` and `q` exactly as the page does.
  - **Rows:** `depRows({ AND: [financeListWhere(...), ...(fin ? [finWhere(fin)] : [])] })`.
  - **Cap:** over `EXPORT_CAP` → `capRefusal`.
  - **Output:** `xlsxResponse(exportFilename("finance-assets", new Date()), toXlsxBuffer(FINANCE_ASSETS_EXPORT_COLUMNS, rows))`.
- [ ] **Step 3: Row menu and override dialog (client).**
  - **Menu:** `asset-row-menu.tsx` takes `{ id, tag, costC, custom, lifeMonths, salvageC, note, categoryText, categoryLife, categorySalvagePercent }` and holds `open` state. It renders `Menu` + `IconButton` (pattern: `src/components/home/work-row-menu.tsx`) and `OverrideDialog`.
  - **Dialog:** the `TransferDialog` pattern (Dialog + FormField + ReasonField + runner).
    - Save: `lifeFromYearsMonths` must not be null or "bad" (refuse with "Enter the asset's useful life"), the salvage is parsed as pesos, then call `setAssetOverride`.
    - Clear: `clearAssetOverride`.
    - Toasts: "Custom depreciation saved — {tag}" and "Custom depreciation cleared — {tag}".
  - **Reuse:** export `OverrideDialog` so Task 10 reuses it.
- [ ] **Step 4: `fin-chips.tsx` (server)** and the page rewrite per the DOM contract. Parse `fin` with `parseFin` and `q` trimmed, max 100 characters.
- [ ] **Step 5: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.
- [ ] **Step 6: Commit.**

```bash
git add -A "src/app/(app)/finance/assets" src/components/finance src/lib/export-columns.ts
git commit -m "feat(finance): Assets register -- every asset, search, Finance-state chips (to review first), depreciation and book value with whole-filter totals, per-asset override, Excel export"
```

---

### Task 10: The Finance asset page and Finance's review

**Files:**
- Create: `src/app/(app)/finance/assets/[id]/page.tsx`, `src/app/(app)/finance/assets/[id]/export/route.ts`, `src/components/finance/review-box.tsx`, `src/components/finance/send-back-dialog.tsx`
- Modify: `src/lib/export-columns.ts`

**Interfaces:**
- Consumes: `financeAssetDetail` (Task 7); `confirmAssetDetails`, `returnAssetToIt` (Task 3); `REGISTRATION_FIELDS`, `REG_FIELD_GROUPS` (Task 2); `OverrideDialog` (Task 9).
- Produces the DOM contract:
  - **Header:** a breadcrumb "Assets" → `/finance/assets?cls=…`, then `PageHeader title={tag}`. The subtitle reads `{model} · {category} · {IT|Purchasing} · S/N {serial} · {holder}`, plus the Status pill and the Finance pill. The buttons are **"Depreciation settings…"** (capitalised only; opens `OverrideDialog`) and **"Export"**.
  - **Review box** (only `with-finance`): `role="region" aria-label="Review"`, containing:
    - the heading **"Waiting for your review"**;
    - the hint (spec §3.2 wording; no-cost: "No cost recorded. Send it back for the cost, or approve it as not capitalised.");
    - when present, "{Department} replied: “{reply}”";
    - the buttons **"Approve"** (cost set) or **"Approve as not capitalised"** (no cost), and **"Send back to {IT|Purchasing}…"**.
  - **After Approve:** the toast is `{tag} approved` / `{tag} approved as not capitalised`. Then navigate to the next asset (`/finance/assets/{next.id}`) if `next`, else `router.refresh()`.
  - **Send-back dialog:** titled `Send {tag} back to {IT|Purchasing}`.
    - One `fieldset` per group, with a `legend` = the group name.
    - One checkbox per field, labelled by the field label.
    - When the asset has no cost, Cost is pre-ticked.
    - A textarea labelled **"Note for {IT|Purchasing}"**, with the hint "Optional — required for Other".
    - The buttons "Cancel" and **"Send back"** (danger).
    - A "{n} ticked" count.
    - On success, the toast reads `{tag} sent back to {IT|Purchasing}`.
  - **Section headings:** "Money summary", "Purchase", "Capitalization & depreciation", "Documents", "Depreciation schedule" (capitalised with a policy only) and "Financial history".
  - **Schedule:** a table `aria-label="Depreciation by year"` with a row per year (a `button` "{year}" toggles `aria-expanded` and reveals that year's month rows). Projected months carry the text "projected".
  - **Not shown when:** for no-cost and not-capitalised assets, the money summary shows the state note instead of figures.

- [ ] **Step 1: `send-back-dialog.tsx` (client).** Use the runner; state is `Set<RegFieldKey>` plus `note`. Call `returnAssetToIt({ id, fields: [...set], note })`. Field errors: `fields` → banner, `note` → under the textarea.
- [ ] **Step 2: `review-box.tsx` (client).** Props: `{ id; tag; cls; hasCost: boolean; reply: string | null; deptLabel: string }`. It renders the buttons and calls `confirmAssetDetails({ id, notCapitalised: !hasCost })`.
- [ ] **Step 3: `page.tsx` (server).**
  - **Guard:** `requireRole("admin", "finance_staff")`; `const d = await financeAssetDetail(id)`; `notFound()` when null.
  - **Render:** the sections in spec §4.2 order. Documents link through the existing document route; find it with `grep -rn "documents/\[" src/app`. The schedule's expand/collapse is a small client component inside the page file's folder, or inline in `review-box.tsx`'s file if simpler.
- [ ] **Step 4: Export (P-11).**
  - **Columns:** `ASSET_SCHEDULE_EXPORT_COLUMNS: XlsxColumn<{ label: string; opening: number | null; charge: number | null; closing: number | null; projected: string }>[]`, with labels Month, Book value at start, Depreciation, Book value at end, Projected.
  - **Rows:** first the five summary rows (label = "Cost" / "Depreciation to date" / "Book value" / "Monthly amount" / "Salvage", value in `closing`), then a blank row, then every month from `lifeYears`.
  - **Route:** `requireRole("admin", "finance_staff")`; 404 when not found. File: `asset-${tag}-YYYY-MM-DD.xlsx` via `exportFilename(\`asset-${tag}\`, new Date())`.
- [ ] **Step 5: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.
- [ ] **Step 6: Commit.**

```bash
git add -A "src/app/(app)/finance/assets/[id]" src/components/finance/review-box.tsx src/components/finance/send-back-dialog.tsx src/lib/export-columns.ts
git commit -m "feat(finance): the Finance asset page -- money summary, purchase, capitalization, documents, year-by-year schedule, history; Finance approves (or not capitalised) or sends back with a checklist and note"
```

---

### Task 11: Schedule tab, its export, and the home

**Files:**
- Create: `src/components/finance/schedule-table.tsx`, `src/app/(app)/finance/depreciation/export/route.ts`
- Modify: `src/app/(app)/finance/depreciation/page.tsx`, `src/app/(app)/page.tsx`, `src/lib/export-columns.ts`

**Interfaces:**
- Consumes: `scheduleYear` and the `financeHome` additions (Task 7).
- Produces the DOM contract:
  - **Controls:** class tabs (`Tabs label="Asset class"`: IT / Purchasing) and a year `<select aria-label="Year">`. The year select is a GET form whose submit button reads "Show", for no-JS; keep `tab` and `cls`.
  - **Table:** `<table aria-label="Depreciation schedule {year}">`, with headers Tag, Model, Category, Cost, "Book value 1 Jan", Jan … Dec, "Year total", "Book value 31 Dec".
    - A projected month header has `title="projected"` and a muted style. Its cells are muted too.
  - **Rows:** subtotal rows read `Subtotal — {category}`, and the grand total reads `Total`.
  - **Above the table:** `{n} assets aren't depreciating yet · {m} have no policy`, with a link "Set policies" → `?tab=policies`.
  - **Empty year:** "No asset depreciates in {year}."
  - **Export:** a link "Export" → `/finance/depreciation/export?year={y}&cls={c}`.
  - **Home stats:**
    - `<Stat label="Book value" value={d.bookValue} hint={\`after ${d.depreciation} depreciation · as of ${d.asOfEnd}\`} />`, linked to `/finance/assets`, with the grid `sm:grid-cols-4`.
    - When `toReview > 0`, a line or link **"{n} registrations to review"** → `/finance/assets?fin=with-finance`, placed with the home's existing waiting items.

- [ ] **Step 1: `schedule-table.tsx` (server).** Render each cell with `fmtMoneyExact(c / 100)`, inside an `overflow-x: auto` box. The first two columns are sticky. Subtotal rows get `bg-surface-subtle font-semibold`.
- [ ] **Step 2: Export columns and route.**
  - **Columns:** `SCHEDULE_EXPORT_COLUMNS: XlsxColumn<ScheduleSheetRow>[]`, where `ScheduleSheetRow = { tag: string; model: string; category: string; costC: number | null; grid: YearRow }`. Subtotal and total rows use an empty tag and model, category "Subtotal — {category}" / "Total", and cost `null`.
  - **Route:** `requireRole("admin", "finance_staff")`. Parse `year` (integer 2000–2100, default this year) and `cls`. Flatten the groups into rows with the subtotal after each group and the total last. Over `EXPORT_CAP` → `capRefusal`. File: `depreciation-${cls.toLowerCase()}-${year}.xlsx`.
- [ ] **Step 3: Page Schedule tab and home.** Replace Task 8's placeholder, then add the home stat and the to-review link.
- [ ] **Step 4: Run the checks.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.
- [ ] **Step 5: Commit.**

```bash
git add -A "src/app/(app)/finance/depreciation" src/components/finance/schedule-table.tsx "src/app/(app)/page.tsx" src/lib/export-columns.ts
git commit -m "feat(finance): year depreciation schedule (Jan-Dec grid, category subtotals, projected months, Excel export); home Book value stat and registrations to review"
```

---

### Task 12: e2e, adapted pins, battery and docs

**Files:**
- Create: `e2e/finance-registration-depreciation.spec.ts`
- Modify: `e2e/asset-classes.spec.ts`, `e2e/department-owned.spec.ts`, `e2e/receiving.spec.ts`, `e2e/home-finance.spec.ts` (and anything else the greps below find), `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, the spec and this plan.

- [ ] **Step 1: Write `e2e/finance-registration-depreciation.spec.ts`.**
  - **House shape:** copy `login`, `expectNoSeriousAxe` and `waitForHydration` from `e2e/queues-records-ux.spec.ts:62-85`; `beforeAll` seeds; `afterAll` disconnects.
  - **Fixtures:** Prisma helpers set registration and confirmation fields on chosen seeded assets, and restore them in `finally` with plain field updates. No audit rows are deleted. Read exports with `readSheet` from `read-excel-file/node` (`e2e/directory.spec.ts:5`).
  - **Cases:**
    1. **Registration round trip.**
       - it@ registers nothing new: pick a seeded IT asset with a cost and reset it to `with-finance`.
       - On it@'s `/inventory`, its Registration cell reads "With Finance".
       - finance@ opens `/finance/assets/{id}`: the region "Review" shows. "Send back to IT…" opens the dialog; tick "Cost" and "Sales invoice", enter the note "Invoice is for another PO", then "Send back".
       - it@'s list shows "Needs correction", "Finance flagged:", both labels and the note.
       - `/inventory/{id}/edit` shows the banner "Finance sent this back", and the Cost field wrapper has `data-flagged`.
       - "Mark corrected…" with the reply "Uploaded the right invoice" → "Send to Finance".
       - finance@ sees "IT replied: “Uploaded the right invoice”", then Approve.
       - it@ sees "Fully registered".
       - The audit rows `finance.return`, `finance.resubmit` and `finance.confirm` exist.
    2. **No cost.** A seeded asset with `cost` null, reset to `with-finance`:
       - finance@ sees "Approve as not capitalised" (and no "Approve") and approves.
       - The list chip "Not capitalised" includes it.
       - it@ edits Cost = 500 and saves.
       - The asset reads "With Finance" again; a `finance.reopened` audit row exists, and `financeNotCapitalised` is false.
    3. **Register.**
       - `/finance/assets` (IT) lists a no-cost asset and an `awaiting-it` asset; the chips filter (`?fin=no-cost` shows only cost "—" rows).
       - Search `q` by a model substring narrows the list.
       - The tag link opens the asset page, which has the "Money summary", "Documents" and "Financial history" headings.
    4. **Policies.**
       - On `/finance/depreciation?tab=policies`, the notice counts categories without a policy.
       - Set "Years for Laptop" = 3 and "Salvage percent for Laptop" = 10; the warning shows; Save.
       - The toast reads "Saved — Laptop"; the DB has 36 and 10.00, plus one `depreciation.policy` audit row.
       - Axe passes.
    5. **Book value.**
       - On `/finance/assets?fin=approved` (IT), one confirmed laptop's book value equals `depreciate(resolvePolicy(...))` computed in the test from `@/lib/depreciation`.
       - The footer shows totals and "As of the end of".
    6. **Override.**
       - "Actions for {tag}" → "Depreciation for this asset…": 2 years, ₱5,000, the reason "refurbished unit"; Save.
       - The row shows "custom" and the book value changes.
       - "Clear override" reverts it, and two audit rows exist.
    7. **Asset page schedule.** On a confirmed laptop with the Laptop policy, the "Depreciation by year" table has a year button; expanding it shows month rows, and future months read "projected".
    8. **Home.** finance@ on `/` sees "Book value" with "as of", and "registrations to review" when any exist.
    9. **Schedule.**
       - `/finance/depreciation` (this year) shows a "Subtotal — Laptop" row and a "Total" row; projected headers have `title="projected"`.
       - Year 2020 shows "No asset depreciates in 2020."
       - Axe passes.
    10. **Exports.**
        - `finance-assets-YYYY-MM-DD.xlsx` has the header row `[Tag, …, Note]`.
        - `depreciation-it-{year}.xlsx` has a "Total" row.
        - `asset-{tag}-YYYY-MM-DD.xlsx` starts with "Cost".
    11. **Access.** it@ and purchasing@ visiting `/finance/depreciation` and `/finance/assets/{id}` are redirected away.
    12. **Axe** on: it@'s `/inventory` with the Registration column, `/finance/assets`, and `/finance/assets/{id}` in review with the send-back dialog open.
- [ ] **Step 2: Adapt pins (P-9 and P-5).**
  - Run `grep -rn "Confirm details\|Send back\|Mark corrected\|Capitalized assets\|Approved assets" e2e`.
  - Every Finance confirm or send-back flow moves to `/finance/assets/{id}`, using the new names ("Approve", "Send back to …", the checklist dialog).
  - Mark corrected uses `Mark {tag} corrected?` / "Send to Finance".
  - The `/finance/assets` heading pin becomes "Assets".
  - `receiving.spec.ts`'s "next to review" flow now lands on `/finance/assets/{next}`.
  - Run each changed file alone in the foreground.
- [ ] **Step 3: The battery.**
  - Run the seven chunks from `docs/HANDOVER.md` §0 item 9, with `e2e/finance-registration-depreciation.spec.ts` added to **chunk C** (home-finance is there). Split D, E1 and F into halves when slow.
  - `npx playwright test --list | tail -1`: expect the previous total plus this file's cases, in one more file.
  - `npx vitest run`, `npx tsc --noEmit` and `npm run lint` must be green.
  - `npx prisma migrate status`: 28 migrations.
  - `npm run db:seed` runs last.
- [ ] **Step 4: Docs.**
  - **Spec:** update the §3.3 checklist table to P-7's field set (drop Delivery and fees and Purchase request), and set the Status line to code-complete.
  - **`HANDOVER.md`:** a status prefix on line 3, a new lettered block "(ab)", and the chunk C line gains the new file.
  - **`PICKUP.md`:** the branch row, the battery row, and §4 item 1.
  - **`HANDOVER-PENDING.md`:** §5.2 marks "Depreciation module" shipped in Phase 35, and notes registration review.
  - **This plan:** the D-block.
  - **State everywhere:**
    - code-complete, unmerged and unpushed;
    - **migration 28**;
    - staging deploys by pulling the GitHub Actions image (the laptop never builds);
    - on first deploy every unconfirmed asset lands in Finance's To review (spec §3.1, by design).
- [ ] **Step 5: Commit.**

```bash
git add e2e docs/HANDOVER.md docs/PICKUP.md docs/HANDOVER-PENDING.md docs/superpowers/specs/2026-10-15-depreciation-design.md docs/superpowers/plans/2026-10-15-phase-35-depreciation.md
git commit -m "test(e2e)+docs: Phase 35 -- registration review round trip, not capitalised + reopen, Finance register and asset page, depreciation policies/override/schedule/home/exports, access; adapted pins; battery; migration 28"
```

---

## D-block (decisions made during execution)

(Filled in during execution: each ruling as `D-n — what — why — cost if wrong`.)
