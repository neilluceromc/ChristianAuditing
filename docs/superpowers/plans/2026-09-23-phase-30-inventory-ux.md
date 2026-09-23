# Phase 30 — Laws of UX applied to the inventory area — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/inventory`, the Register flow and `/inventory/[id]` obey the Laws of UX the way Phase 29 made the employee area obey them: one state-chosen primary per record, one create flow, a list that shows unfinished business and acts from the row, tolerant input, and endings worth the task.

**Architecture:** Pure rules first (`record-actions.ts`, `inventory-attention.ts`, `register-input.ts`, additions to `asset-class.ts` and `inventory-list.ts`), then the server (role-aware class default, the list row's new inputs and the Attention pass, `checkIdentifiers`' new payload, one-pass create errors, the loan date and purchase request at quantity 1, the Replace exclusions, Finance's next-to-review), then the record header (controlled dialogs + `RecordActions`), the record body and the Edit route move, the merged Register form, the list header and toolbar, the list rows and selection bar, a new e2e spec, and the battery with docs. No migration.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, zod 4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-09-23-inventory-ux-design.md` (decisions 1–10, §3–§11). Facts gathered before this plan (verbatim current code, every pinned e2e selector with file:line, seed fixtures): the worktree's `.superpowers/sdd/phase-30-ux-audit.md`, `phase-30-plan-facts-record.md`, `phase-30-plan-facts-list-register.md` — copy them into the SDD workspace's `briefs/`. Every UI task's implementer reads the relevant facts sections before editing.

## Global Constraints

- Guard order role → rate → zod; refusals through `ActionResult`; one `writeAudit` per domain write inside its transaction; `AuditEntry` is append-only — no test deletes audit rows (tests may INSERT and leave them).
- Copy pinned verbatim (spec §8, plus the plan decisions below). No phase numbers and no roadmap talk ("yet") in operator-facing text. Dates through `fmtDate` (Asia/Manila), including every toast. Product `aria-label`s never contain a nearby field's label word.
- Role discipline unchanged: viewers and Finance see no create or lifecycle controls; the approval path for non-direct classes keeps working exactly as today.
- Dev only in the worktree `phase-30-inventory-uiux` with its own `.env` (`DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.56:3100`, no `SEED_PASSWORD`); never read or print `.env` — the password constant is `SEED_PASSWORD` in `prisma/fixtures.ts`. Never touch the `inventory` database or port 3000; never seed staging.
- **Verification (spec decision 8):** agents never sign in through the Browser pane. A task proves its screens by running the Playwright files it adapted, FOREGROUND: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000` (Bash timeout 600000). Only ONE agent runs Playwright at a time; port 3100 free before and after (`netstat -ano | findstr :3100 | findstr LISTENING`, `taskkill /PID <pid> /T /F`). `npm run db:seed` runs last in any task that ran Playwright.
- Task-end gate for every task: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` all clean. Baseline: 90 files / 1556 tests; 26 migrations up to date; `--list` 389 tests / 38 files.
- Commits carry the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` new files before a pathspec commit; never amend; never `git stash`/`checkout --`/`restore`/`reset`/`switch`. Docs are CRLF; HANDOVER's lettered blocks are not in one order — anchor edits on block headers.
- The worktree branch sits at `a94f47a`; before Task 1 the executor runs `git merge --ff-only main` inside the worktree so this plan is in its history.

## Plan-level decisions (P-1…P-16; the D-block records anything execution changes)

- **P-1 Order:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9, strictly sequential (every UI task runs Playwright on 3100).
- **P-2 Each UI task adapts the pinned e2e its own change breaks**, in the same task and commit, and proves itself by running those files. Each task's "Pinned e2e" list names them (from the facts files); the implementer greps once more for anything the list missed. A failure that is a product defect outside the task's files → STOP and report.
- **P-3 Controlled dialogs.** `HolderControl`, `ReplaceControl`, `StatusControl`, `TriageControl`, `LoanDueControl`, `ItCheck` and `FinanceReview` stop rendering their own trigger buttons. Each becomes a controlled dialog (`open`, `onClose`, an asset summary prop) — the Phase 29 `TransferDialog` shape. `RecordActions` (record header) and the list's row menu own the open state and render the same dialogs.
- **P-4 `recordActions(state, role)` is the one rule** for what a record offers: `{ primary, more, edit }`. Its precedence refines spec §4.1: **Finance's Confirm / Send back and IT's Mark checked / Mark corrected are not lifecycle changes, so a pending approval does not suppress them**; the pending row suppresses only the lifecycle actions (Triage, Return, Replace, Assign, Reserve, Change status, Set loan date). Effective order: Triage → Mark checked → Mark corrected → Confirm details → Return → Assign → none. `more` lists every other applicable action in the fixed order Triage, Mark checked, Mark corrected, Confirm details, Send back, Return, Assign, Replace, Reserve, Change status, Set loan date, Print label. *Spec §4.1 amended.*
- **P-5 Non-direct (approval-path) labels and dialog titles stay as today** — "Assign holder", "Return", "Request status change…", dialogs "Assign a holder", "Request a return", "Request a status change" — per spec §7 ("exactly as today's controls do"); only the direct dialogs get the §4.3 titles and verbs. The non-direct dialogs gain the line `This files a request for approval.` *Spec §4.3 scoped.*
- **P-6 One friendly status map**, `STATUS_LABEL: Record<AssetStatus, string>` in `asset-class.ts` (TEMPORARY → "Loan"), used wherever an operator picks a status (Change status, the bulk picker, Register's initial state). Option VALUES stay the enum, so `selectOption("DISPOSE")` keeps working. The list's Status column, facet labels and toasts keep the enum.
- **P-7 The list's class default is role-aware without breaking other roles' URLs.** New `defaultClassFor(role)` and `withViewClsQS(qs, cls, defaultCls)` (emits `cls=` only when the class differs from the viewer's default). For every role whose default is IT it produces exactly today's URLs. Every server parser that reads a list query string (`/inventory` page, `/inventory/export`, the bulk actions' `filters`) defaults to `defaultClassFor(role)` instead of `"IT"`. The Purchasing nav's "IT inventory" link becomes `/inventory?cls=IT`.
- **P-8 The Purchased facet is UI-only.** A `Menu` in the toolbar (trigger `Purchased` / `Purchased: 2024`, items `Any year`, `2026 · 4`, …, `No date · 2`) that writes the existing `?purchaseYear=` side-channel. `INVENTORY_LIST_CONFIG`, the export route and the bulk filters are untouched.
- **P-9 The search box keeps `aria-label="Search assets"`** (it-core pins it); only the placeholder changes.
- **P-10 Attention is computed from row data**, one reason per row, worst first in spec §6.3's order; severities rank in that same order (overdue above no due date — the spec's reading order wins over the worklist's internal severities). The count line uses `attentionWhere(now)`, a Prisma predicate that agrees with `attentionOf` boundary for boundary (unit-tested at the 7-day edge). The sort runs a candidate pass in memory, like Phase 29's Loadout sort; `buildAssetOrderBy` filters the `attention` key first, then falls back to the default order.
- **P-11 The row menu renders only when it has an action beyond Open record** (a one-item menu that duplicates the row click fails Hick). *Spec §6.3 amended.*
- **P-12 At quantity 1 the Register form keeps its one-row table** (`Tag 1` / `Serial 1`, the tag suggested from the category prefix and editable) — that row is spec §5.2's "one Tag field", and ~11 pinned selectors survive. The quantity-1 extras (Initial state, Assign to, Loan until, documents with kinds) render below it. *Spec §5.2 amended.*
- **P-13 Quantity 1 submits through `createAsset`** (extended with `loanDueAt`, `requestId`, one-pass errors); **quantity > 1 through `registerAssets`** (one-pass errors). Both share one model rule (min 2 / max 120 — spec §3's "one rule set"), and the client sends Cost already normalised by `normaliseCost`.
- **P-14 The bulk drawer keeps its dialog name "Bulk actions"** and its internal mode radiogroup; the selection bar's `Change status…` / `Assign…` buttons open it pre-set to that mode. Spec §6.4 does not pin the drawer title; keeping it limits churn.
- **P-15 Edit leaves the record layout through a route group:** the record's layout, pages, tabs and `loading.tsx` move under `src/app/(app)/inventory/[id]/(record)/`; `edit/` stays a sibling; `[id]/not-found.tsx` stays where it is (it is only a boundary).
- **P-16 The new spec joins chunk E2** (the stock line, 42 tests): `e2e/inventory-ux.spec.ts`, expected `--list` 389 + N tests / 39 files, N = its case count.

---

## File structure

- **Rules (pure):** `src/lib/asset-class.ts` (+test) — `STATUS_LABEL`, `statusTargets`, `defaultClassFor`, `withViewClsQS`; `src/lib/record-actions.ts` (+test, new); `src/lib/inventory-attention.ts` (+test, new); `src/lib/register-input.ts` (+test, new); `src/lib/inventory-list.ts` (+test) — holder terms, the `attention` sort key; `src/lib/activity.ts` (+test) — `auditPhrase`.
- **Server:** `src/server/modules/inventory/queries.ts`, `inventory/actions.ts`, `purchases/receiving.ts`, `lifecycle/actions.ts` (bulk `filters` class default), `finance/queries.ts`, `src/app/(app)/inventory/export/route.ts`.
- **Record:** `src/components/inventory/record-actions.tsx` (new), the seven controls, `record-tabs.tsx`, `documents-panel.tsx`, `secrets-panel.tsx`, `src/app/(app)/inventory/[id]/(record)/*` (moved), `[id]/edit/page.tsx`, `asset-form.tsx` (edit-only).
- **Register:** `register/page.tsx`, `register-form.tsx`, `register-success.tsx`, `created-notice.tsx`, `new/page.tsx` (redirect), `src/components/patterns/file-drop.tsx` (new), `src/lib/workspaces.ts`.
- **List:** `inventory/page.tsx`, `inventory-toolbar.tsx`, `inventory-table.tsx`, `bulk-drawer.tsx`, `column-chooser.tsx`, `src/components/inventory/inventory-more-menu.tsx` (new), `src/components/ui/table.tsx` (`Th` hit area).
- **e2e:** `e2e/inventory-ux.spec.ts` (new) plus the adapted files named per task.
- **Docs (T9):** `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, the spec's Status, this plan's D-block.

---

### Task 1: Pure rules

**Files:**
- Modify: `src/lib/asset-class.ts`, `src/lib/asset-class.test.ts`; `src/lib/inventory-list.ts`, `src/lib/inventory-list.test.ts`; `src/lib/activity.ts` and its test file (find it: `ls src/lib/activity*.test.ts`)
- Create: `src/lib/record-actions.ts`, `src/lib/record-actions.test.ts`; `src/lib/inventory-attention.ts`, `src/lib/inventory-attention.test.ts`; `src/lib/register-input.ts`, `src/lib/register-input.test.ts`

**Interfaces — Produces:**
- `STATUS_LABEL: Record<AssetStatus, string>`; `statusTargets(a: { cls; status; hasHolder }): AssetStatus[]`; `defaultClassFor(role: Role): AssetClass`; `withViewClsQS(qs: string, cls: AssetClass, defaultCls: AssetClass): string`
- `type RecordAction`; `interface RecordState`; `recordActions(state, role): { primary: RecordAction | null; more: RecordAction[]; edit: boolean }`; `recordPrimary(state, role): RecordAction | null`; `actionLabel(action, ctx: { cls; direct; inMenu }): string`
- `attentionOf(a: AttentionInput, now: Date): Attention | null`; `orderByAttention<T extends { attention: Attention | null; tag: string; id: string }>(rows: T[], dir): T[]`; `attentionWhere(now: Date): Prisma.AssetWhereInput`
- `parseSerialPaste(text: string): string[]`; `normaliseCost(text: string): { ok: true; value: string } | { ok: false }`
- `INVENTORY_LIST_CONFIG.sortable` gains `"attention"`; `buildAssetWhere`'s `q` OR gains the holder's name and employee number; `buildAssetOrderBy` never emits `attention`.
- `auditPhrase(entry: { action: string; diff: unknown }): string` — the `auditSentence` phrase without the leading actor and without the entity label.

- [ ] **Step 1: Tests for `asset-class.ts` additions** — append to `src/lib/asset-class.test.ts` (merge the new names into the file's existing import from `./asset-class`):

```ts
import { STATUS_LABEL, STATUSES_BY_CLASS, defaultClassFor, statusTargets, withViewClsQS } from "./asset-class";

describe("STATUS_LABEL — the friendly word for every status of both classes", () => {
  it("covers all fourteen statuses, and a loan reads Loan", () => {
    for (const s of [...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING]) expect(STATUS_LABEL[s]).toBeTruthy();
    expect(STATUS_LABEL.TEMPORARY).toBe("Loan");
    expect(STATUS_LABEL.SPARE).toBe("Spare");
    expect(STATUS_LABEL.OPERATIONAL).toBe("Operational");
  });
});

describe("statusTargets — only the statuses a direct change may pick", () => {
  it("an unheld IT spare: no holder statuses, never the current one", () => {
    expect(statusTargets({ cls: "IT", status: "SPARE", hasHolder: false })).toEqual(["DEFECTIVE", "DONATED", "BUYOUT", "DISPOSE", "MISSING"]);
  });
  it("a held IT device: only the other holder status", () => {
    expect(statusTargets({ cls: "IT", status: "DEPLOYED", hasHolder: true })).toEqual(["TEMPORARY"]);
    expect(statusTargets({ cls: "IT", status: "TEMPORARY", hasHolder: true })).toEqual(["DEPLOYED"]);
  });
  it("a held Purchasing asset has nothing to change to", () => {
    expect(statusTargets({ cls: "PURCHASING", status: "OPERATIONAL", hasHolder: true })).toEqual([]);
  });
  it("an unheld Purchasing asset: every non-holder status but its own", () => {
    expect(statusTargets({ cls: "PURCHASING", status: "STORED", hasHolder: false })).toEqual(["REPAIRING", "RETIRED", "SOLD", "LOST"]);
  });
});

describe("defaultClassFor — the class /inventory opens on", () => {
  it("is the first class the role manages", () => {
    expect(defaultClassFor("purchasing_staff")).toBe("PURCHASING");
    expect(defaultClassFor("it_staff")).toBe("IT");
    expect(defaultClassFor("admin")).toBe("IT");
  });
  it("falls back to the first visible class for roles that manage none", () => {
    expect(defaultClassFor("finance_staff")).toBe("IT");
    expect(defaultClassFor("viewer")).toBe("IT");
  });
});

describe("withViewClsQS — cls only when it is not the viewer's default", () => {
  it("IT-default viewers get exactly today's URLs", () => {
    expect(withViewClsQS("", "IT", "IT")).toBe("");
    expect(withViewClsQS("?q=x", "PURCHASING", "IT")).toBe("?q=x&cls=PURCHASING");
  });
  it("a Purchasing-default viewer names IT explicitly and omits its own class", () => {
    expect(withViewClsQS("", "IT", "PURCHASING")).toBe("?cls=IT");
    expect(withViewClsQS("?q=x", "PURCHASING", "PURCHASING")).toBe("?q=x");
  });
});
```

- [ ] **Step 2: Run — FAIL.** Implement in `src/lib/asset-class.ts` (append; `statusesFor` and `HOLDER_STATUSES` already exist):

```ts

/** Phase 30 (spec §3, plan P-6): the word an operator reads when choosing a status. Option values stay the enum. */
export const STATUS_LABEL: Record<AssetStatus, string> = {
  DEPLOYED: "Deployed", SPARE: "Spare", DEFECTIVE: "Defective", DONATED: "Donated", TEMPORARY: "Loan",
  BUYOUT: "Buyout", DISPOSE: "Dispose", MISSING: "Missing",
  OPERATIONAL: "Operational", STORED: "Stored", REPAIRING: "Repairing", RETIRED: "Retired", SOLD: "Sold", LOST: "Lost",
};

/**
 * Phase 30 (spec §4.2): the statuses a direct Change status may pick — never the current one; no holder
 * status without a holder (Assign does that); while held, only the other holder statuses (Return does the rest).
 */
export function statusTargets(a: { cls: AssetClass; status: AssetStatus; hasHolder: boolean }): AssetStatus[] {
  const holder = HOLDER_STATUSES[a.cls] as readonly AssetStatus[];
  return statusesFor(a.cls).filter((s) => s !== a.status && (a.hasHolder ? holder.includes(s) : !holder.includes(s)));
}

/** Phase 30 (spec decision 6): the class /inventory opens on — the first the role manages, else the first it sees. */
export function defaultClassFor(role: Role): AssetClass {
  return MANAGEABLE_CLASSES[role].find((c) => canSeeClass(role, c)) ?? VISIBLE_CLASSES[role][0];
}

/**
 * Phase 30 (plan P-7): a list URL names its class only when it is not the viewer's default — so every
 * IT-default role keeps today's URLs, and a Purchasing-default viewer's IT view says `cls=IT`.
 */
export function withViewClsQS(qs: string, cls: AssetClass, defaultCls: AssetClass): string {
  if (cls === defaultCls) return qs;
  return qs ? `${qs}&cls=${cls}` : `?cls=${cls}`;
}
```

(`VISIBLE_CLASSES` and `canSeeClass` are declared further down the file than `MANAGEABLE_CLASSES`; function declarations hoist, `const` does not — place these additions at the END of the file so every constant they read is initialised.)

- [ ] **Step 3: Run — PASS** (`npx vitest run src/lib/asset-class.test.ts`).

- [ ] **Step 4: `record-actions.ts`** — test first (`src/lib/record-actions.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { actionLabel, recordActions, recordPrimary, type RecordState } from "./record-actions";

const base: RecordState = {
  cls: "IT", status: "SPARE", hasHolder: false, returnedAt: null, itVerifiedAt: new Date("2025-01-01"),
  financeConfirmedAt: new Date("2025-02-01"), financeReturnedAt: null, pending: false, held: false,
};

describe("recordActions — one state-chosen primary per record (spec §4.1, plan P-4)", () => {
  it("an assignable spare: Assign, then Reserve, Change status, Print label", () => {
    expect(recordActions(base, "it_staff")).toEqual({ primary: "assign", more: ["reserve", "change-status", "print-label"], edit: true });
  });
  it("a held device: Return, then Replace, Change status, Print label", () => {
    expect(recordActions({ ...base, status: "DEPLOYED", hasHolder: true }, "it_staff"))
      .toEqual({ primary: "return", more: ["replace", "change-status", "print-label"], edit: true });
  });
  it("a loan adds Set loan date after Change status", () => {
    expect(recordActions({ ...base, status: "TEMPORARY", hasHolder: true }, "it_staff").more)
      .toEqual(["replace", "change-status", "set-loan-date", "print-label"]);
  });
  it("back, not checked: Triage, then Change status and Print label (not assignable yet)", () => {
    expect(recordActions({ ...base, returnedAt: new Date("2026-09-20") }, "it_staff"))
      .toEqual({ primary: "triage", more: ["change-status", "print-label"], edit: true });
  });
  it("a pending approval suppresses every lifecycle action", () => {
    expect(recordActions({ ...base, status: "DEPLOYED", hasHolder: true, pending: true }, "it_staff"))
      .toEqual({ primary: null, more: ["print-label"], edit: true });
  });
  it("a held spare (reserved) still offers Assign but not Reserve", () => {
    expect(recordActions({ ...base, held: true }, "it_staff").more).toEqual(["change-status", "print-label"]);
  });
  it("awaiting IT check: Mark checked for IT, Edit for the registrant too", () => {
    const awaiting = { ...base, itVerifiedAt: null, financeConfirmedAt: null };
    expect(recordPrimary(awaiting, "it_staff")).toBe("mark-checked");
    expect(recordActions(awaiting, "purchasing_staff")).toEqual({ primary: null, more: [], edit: true });
  });
  it("Finance on an unconfirmed record: Confirm details, Send back in More, no Edit", () => {
    expect(recordActions({ ...base, financeConfirmedAt: null }, "finance_staff"))
      .toEqual({ primary: "confirm-details", more: ["send-back"], edit: false });
  });
  it("a pending approval does not suppress Finance's review (plan P-4)", () => {
    expect(recordPrimary({ ...base, financeConfirmedAt: null, pending: true }, "finance_staff")).toBe("confirm-details");
  });
  it("admin on a Finance-returned IT spare: one primary, the rest in More in the fixed order", () => {
    const returned = { ...base, financeConfirmedAt: null, financeReturnedAt: new Date("2026-09-21") };
    expect(recordActions(returned, "admin")).toEqual({
      primary: "mark-corrected",
      more: ["confirm-details", "send-back", "assign", "reserve", "change-status", "print-label"],
      edit: true,
    });
  });
  it("a Purchasing record on the approval path: Assign (as a request), no Replace or Reserve", () => {
    const car = { ...base, cls: "PURCHASING" as const, status: "STORED" as const, itVerifiedAt: null };
    expect(recordActions(car, "purchasing_staff")).toEqual({ primary: "assign", more: ["change-status", "print-label"], edit: true });
  });
  it("a viewer gets nothing", () => {
    expect(recordActions(base, "viewer")).toEqual({ primary: null, more: [], edit: false });
  });
  it("a held Purchasing asset offers no Change status (no target to pick)", () => {
    const car = { ...base, cls: "PURCHASING" as const, status: "OPERATIONAL" as const, hasHolder: true, itVerifiedAt: null };
    expect(recordActions(car, "purchasing_staff").more).toEqual(["print-label"]);
  });
});

describe("actionLabel — header buttons, menu items, and the approval path's words (plan P-5)", () => {
  it("primaries have no ellipsis; menu items do", () => {
    expect(actionLabel("return", { cls: "IT", direct: true, inMenu: false })).toBe("Return");
    expect(actionLabel("return", { cls: "IT", direct: true, inMenu: true })).toBe("Return…");
    expect(actionLabel("replace", { cls: "IT", direct: true, inMenu: true })).toBe("Replace…");
    expect(actionLabel("print-label", { cls: "IT", direct: true, inMenu: true })).toBe("Print label");
  });
  it("the approval path keeps today's words", () => {
    expect(actionLabel("assign", { cls: "PURCHASING", direct: false, inMenu: false })).toBe("Assign holder");
    expect(actionLabel("change-status", { cls: "PURCHASING", direct: false, inMenu: true })).toBe("Request status change…");
  });
  it("Send back names the class it returns to", () => {
    expect(actionLabel("send-back", { cls: "PURCHASING", direct: false, inMenu: true })).toBe("Send back to Purchasing…");
  });
});
```

Then `src/lib/record-actions.ts`:

```ts
import type { AssetClass, AssetStatus, Role } from "@prisma/client";
import { CLASS_LABEL, canEditAsset, canManageClass, isAssignable, isAwaitingItCheck, isDirectLifecycle, statusTargets } from "./asset-class";

/** Phase 30 (spec §4.1, plan P-4): everything a record header or a list row can offer. */
export type RecordAction =
  | "triage" | "mark-checked" | "mark-corrected" | "confirm-details" | "send-back"
  | "return" | "assign" | "replace" | "reserve" | "change-status" | "set-loan-date" | "print-label";

export interface RecordState {
  cls: AssetClass;
  status: AssetStatus;
  hasHolder: boolean;
  returnedAt: Date | null;
  itVerifiedAt: Date | null;
  financeConfirmedAt: Date | null;
  financeReturnedAt: Date | null;
  /** an open (PENDING / CLAIMED / APPROVED) approval on this asset */
  pending: boolean;
  /** an ACTIVE reservation on this asset */
  held: boolean;
}

const PRIMARY_ORDER: readonly RecordAction[] = ["triage", "mark-checked", "mark-corrected", "confirm-details", "return", "assign"];
const FULL_ORDER: readonly RecordAction[] = [
  "triage", "mark-checked", "mark-corrected", "confirm-details", "send-back",
  "return", "assign", "replace", "reserve", "change-status", "set-loan-date", "print-label",
];

function applicable(a: RecordState, role: Role): Record<RecordAction, boolean> {
  const canMutate = canManageClass(role, a.cls);
  const direct = isDirectLifecycle(role, a.cls);
  const awaitingIt = isAwaitingItCheck(a);
  const assignable = isAssignable(a);
  const finance = (role === "admin" || role === "finance_staff") && a.financeConfirmedAt === null && !awaitingIt;
  const live = !a.pending; // plan P-4: only lifecycle actions wait for an open approval
  return {
    triage: direct && live && a.returnedAt !== null,
    "mark-checked": awaitingIt && canManageClass(role, "IT"),
    "mark-corrected": canMutate && a.financeReturnedAt !== null,
    "confirm-details": finance,
    "send-back": finance,
    return: canMutate && live && a.hasHolder,
    assign: canMutate && live && !a.hasHolder && assignable,
    replace: direct && live && a.hasHolder,
    reserve: direct && live && !a.hasHolder && assignable && !a.held,
    "change-status": canMutate && live && statusTargets(a).length > 0,
    "set-loan-date": direct && live && a.status === "TEMPORARY",
    "print-label": canMutate,
  };
}

/** Phase 30 (spec §4.1): the one primary, the rest in the fixed More order, and whether Edit shows. */
export function recordActions(a: RecordState, role: Role): { primary: RecordAction | null; more: RecordAction[]; edit: boolean } {
  const can = applicable(a, role);
  const primary = PRIMARY_ORDER.find((k) => can[k]) ?? null;
  return { primary, more: FULL_ORDER.filter((k) => can[k] && k !== primary), edit: canEditAsset(role, a) };
}

export function recordPrimary(a: RecordState, role: Role): RecordAction | null {
  return recordActions(a, role).primary;
}

/** Phase 30 (spec §8, plan P-5): header buttons carry no ellipsis; menu items do; the approval path keeps today's words. */
export function actionLabel(action: RecordAction, ctx: { cls: AssetClass; direct: boolean; inMenu: boolean }): string {
  const dots = ctx.inMenu ? "…" : "";
  switch (action) {
    case "triage": return `Triage${dots}`;
    case "mark-checked": return `Mark checked${dots}`;
    case "mark-corrected": return `Mark corrected${dots}`;
    case "confirm-details": return `Confirm details${dots}`;
    case "send-back": return `Send back to ${CLASS_LABEL[ctx.cls]}…`;
    case "return": return `Return${dots}`;
    case "assign": return `${ctx.direct ? "Assign" : "Assign holder"}${dots}`;
    case "replace": return "Replace…";
    case "reserve": return "Reserve…";
    case "change-status": return ctx.direct ? "Change status…" : "Request status change…";
    case "set-loan-date": return "Set loan date…";
    case "print-label": return "Print label";
  }
}
```

(`isAssignable` takes `{ cls, status, returnedAt }`, `isAwaitingItCheck` and `canEditAsset` take `{ cls, itVerifiedAt }`, `statusTargets` takes `{ cls, status, hasHolder }` — `RecordState` satisfies all four structurally.)

- [ ] **Step 5: Run — PASS.** (If an expectation disagrees with the code, the plan's intent is the precedence in P-4 and the FULL_ORDER above; report any mismatch as a concern rather than changing a test to fit.)

- [ ] **Step 6: `inventory-attention.ts`** — test first (`src/lib/inventory-attention.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { attentionOf, attentionWhere, orderByAttention, type AttentionInput } from "./inventory-attention";

const now = new Date("2026-09-23T02:00:00Z"); // 10:00 Manila
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const quiet: AttentionInput = { cls: "IT", status: "SPARE", returnedAt: null, loanDueAt: null, pendingRef: null, itVerifiedAt: day("2025-01-01") };

describe("attentionOf — one reason per row, worst first (spec §6.3)", () => {
  it("nothing owed → null", () => expect(attentionOf(quiet, now)).toBeNull());
  it("back, not checked beats everything", () => {
    expect(attentionOf({ ...quiet, returnedAt: day("2026-09-20"), pendingRef: "APR-1" }, now)?.label).toBe("back, not checked");
  });
  it("loans: overdue, no due date, due soon — in that order of worry", () => {
    const loan = { ...quiet, status: "TEMPORARY" };
    expect(attentionOf({ ...loan, loanDueAt: day("2026-09-20") }, now)?.label).toBe("overdue by 3 d");
    expect(attentionOf({ ...loan, loanDueAt: null }, now)?.label).toBe("no due date");
    expect(attentionOf({ ...loan, loanDueAt: day("2026-09-25") }, now)?.label).toBe("due in 2 d");
    expect(attentionOf({ ...loan, loanDueAt: day("2026-10-23") }, now)).toBeNull();
  });
  it("the due-soon edge is exactly seven days", () => {
    const loan = { ...quiet, status: "TEMPORARY" };
    expect(attentionOf({ ...loan, loanDueAt: day("2026-09-30") }, now)?.label).toBe("due in 7 d");
    expect(attentionOf({ ...loan, loanDueAt: day("2026-10-01") }, now)).toBeNull();
  });
  it("a queued approval, then awaiting IT check", () => {
    expect(attentionOf({ ...quiet, pendingRef: "APR-2041" }, now)?.label).toBe("queued APR-2041");
    expect(attentionOf({ ...quiet, itVerifiedAt: null }, now)?.label).toBe("awaiting IT check");
    expect(attentionOf({ ...quiet, cls: "PURCHASING", itVerifiedAt: null }, now)).toBeNull();
  });
  it("severity follows the reading order", () => {
    const loan = { ...quiet, status: "TEMPORARY" };
    const s = (a: AttentionInput) => attentionOf(a, now)!.severity;
    const back = s({ ...quiet, returnedAt: day("2026-09-20") });
    const overdue = s({ ...loan, loanDueAt: day("2026-09-20") });
    const noDate = s({ ...loan, loanDueAt: null });
    const soon = s({ ...loan, loanDueAt: day("2026-09-25") });
    const queued = s({ ...quiet, pendingRef: "APR-1" });
    const check = s({ ...quiet, itVerifiedAt: null });
    expect([back, overdue, noDate, soon, queued, check]).toEqual([...[back, overdue, noDate, soon, queued, check]].sort((a, b) => b - a));
  });
});

describe("orderByAttention — worst first, quiet rows last either way", () => {
  const rows = [
    { id: "1", tag: "BR-LT-0003", attention: null },
    { id: "2", tag: "BR-LT-0002", attention: { kind: "queued" as const, label: "queued APR-1", severity: 1000 } },
    { id: "3", tag: "BR-LT-0001", attention: { kind: "back" as const, label: "back, not checked", severity: 5000 } },
    { id: "4", tag: "BR-LT-0000", attention: null },
  ];
  it("ascending: most severe first, quiet rows by tag at the end", () => {
    expect(orderByAttention(rows, "asc").map((r) => r.id)).toEqual(["3", "2", "4", "1"]);
  });
  it("descending: least severe first, quiet rows still last", () => {
    expect(orderByAttention(rows, "desc").map((r) => r.id)).toEqual(["2", "3", "4", "1"]);
  });
});

describe("attentionWhere — the count's predicate (agrees with attentionOf's edges)", () => {
  it("ORs the five reasons, with the loan edge at now + 7 days", () => {
    const w = attentionWhere(now);
    expect(w.OR).toEqual([
      { returnedAt: { not: null } },
      { status: "TEMPORARY", loanDueAt: null },
      { status: "TEMPORARY", loanDueAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
      { approvals: { some: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } } },
      { cls: "IT", itVerifiedAt: null },
    ]);
  });
});
```

Then `src/lib/inventory-attention.ts`:

```ts
import type { AssetClass, Prisma } from "@prisma/client";
import { LOAN_DUE_SOON_DAYS } from "./worklist";

/** Phase 30 (spec §6.3): the one reason a row still owes someone something. */
export type AttentionKind = "back" | "overdue" | "no-due-date" | "due-soon" | "queued" | "awaiting-check";
export interface Attention { kind: AttentionKind; label: string; severity: number }
export interface AttentionInput {
  cls: AssetClass;
  status: string;
  returnedAt: Date | null;
  loanDueAt: Date | null;
  pendingRef: string | null;
  itVerifiedAt: Date | null;
}

const DAY_MS = 86_400_000;
// The same states approvals/create.ts calls OPEN_APPROVAL_STATES — repeated here because src/lib cannot import src/server.
const OPEN_STATES = ["PENDING", "CLAIMED", "APPROVED"] as const;

/** Worst first, in the reading order of spec §6.3 (plan P-10); the loan arithmetic is worklist.ts loanRow's. */
export function attentionOf(a: AttentionInput, now: Date): Attention | null {
  if (a.returnedAt) return { kind: "back", label: "back, not checked", severity: 6000 };
  if (a.status === "TEMPORARY") {
    if (a.loanDueAt === null) return { kind: "no-due-date", label: "no due date", severity: 4000 };
    const overdue = Math.floor((now.getTime() - a.loanDueAt.getTime()) / DAY_MS);
    if (overdue > 0) return { kind: "overdue", label: `overdue by ${overdue} d`, severity: 5000 + overdue };
    const until = -overdue;
    if (until <= LOAN_DUE_SOON_DAYS) return { kind: "due-soon", label: `due in ${until} d`, severity: 3000 + (LOAN_DUE_SOON_DAYS - until) };
  }
  if (a.pendingRef) return { kind: "queued", label: `queued ${a.pendingRef}`, severity: 2000 };
  if (a.cls === "IT" && a.itVerifiedAt === null) return { kind: "awaiting-check", label: "awaiting IT check", severity: 1000 };
  return null;
}

/** asc = most severe first; desc = least severe first; quiet rows last either way; ties by tag then id. */
export function orderByAttention<T extends { attention: Attention | null; tag: string; id: string }>(rows: T[], dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? -1 : 1;
  return [...rows].sort((x, y) => {
    if (!x.attention || !y.attention) {
      if (!x.attention && !y.attention) return x.tag.localeCompare(y.tag) || x.id.localeCompare(y.id);
      return x.attention ? -1 : 1;
    }
    return sign * (x.attention.severity - y.attention.severity) || x.tag.localeCompare(y.tag) || x.id.localeCompare(y.id);
  });
}

/** The count line's predicate — true exactly when attentionOf returns a reason (the loan edge is due ≤ now + 7 d). */
export function attentionWhere(now: Date): Prisma.AssetWhereInput {
  return {
    OR: [
      { returnedAt: { not: null } },
      { status: "TEMPORARY", loanDueAt: null },
      { status: "TEMPORARY", loanDueAt: { lte: new Date(now.getTime() + LOAN_DUE_SOON_DAYS * DAY_MS) } },
      { approvals: { some: { state: { in: [...OPEN_STATES] } } } },
      { cls: "IT", itVerifiedAt: null },
    ],
  };
}
```

(Check the edge: `until ≤ 7` ⟺ `floor((now − due)/day) ≥ −7` ⟺ `now − due ≥ −7 days` ⟺ `due ≤ now + 7 days`. The test at 2026-09-30 / 2026-10-01 pins it.)

- [ ] **Step 7: `register-input.ts`** — test first (`src/lib/register-input.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { normaliseCost, parseSerialPaste } from "./register-input";

describe("parseSerialPaste — a packing list's column into rows (spec §5.4)", () => {
  it("splits on newlines and tabs, trims, drops blanks", () => {
    expect(parseSerialPaste("SN-1\r\n SN-2 \n\nSN-3\tSN-4\n")).toEqual(["SN-1", "SN-2", "SN-3", "SN-4"]);
  });
  it("a single value stays a single value", () => {
    expect(parseSerialPaste("  SN-9  ")).toEqual(["SN-9"]);
  });
});

describe("normaliseCost — the way a receipt prints it (spec §5.4)", () => {
  it("strips peso signs, commas and spaces", () => {
    expect(normaliseCost("₱12,500")).toEqual({ ok: true, value: "12500" });
    expect(normaliseCost(" 12,500.50 ")).toEqual({ ok: true, value: "12500.50" });
    expect(normaliseCost("PHP 1 200")).toEqual({ ok: true, value: "1200" });
  });
  it("blank is a valid empty cost", () => {
    expect(normaliseCost("")).toEqual({ ok: true, value: "" });
  });
  it("anything that is not an amount with at most two decimals is refused", () => {
    expect(normaliseCost("twelve")).toEqual({ ok: false });
    expect(normaliseCost("12.505")).toEqual({ ok: false });
    expect(normaliseCost("-5")).toEqual({ ok: false });
  });
});
```

Then `src/lib/register-input.ts`:

```ts
/** Phase 30 (spec §5.4): paste a column of serials; one value per row, blanks dropped. */
export function parseSerialPaste(text: string): string[] {
  return text.split(/[\r\n\t]+/).map((s) => s.trim()).filter(Boolean);
}

/** Phase 30 (spec §5.4): "₱12,500.50" → "12500.50"; "" stays ""; anything else is refused, never silently blanked. */
export function normaliseCost(text: string): { ok: true; value: string } | { ok: false } {
  const cleaned = text.replace(/₱|PHP|,|\s/gi, "");
  if (cleaned === "") return { ok: true, value: "" };
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? { ok: true, value: cleaned } : { ok: false };
}
```

- [ ] **Step 8: `inventory-list.ts`** — tests (append to `src/lib/inventory-list.test.ts`, and change the existing "q searches tag, model and serial" expectation to five terms):

```ts
      OR: [
        { tag: { contains: "latitude", mode: "insensitive" } },
        { model: { contains: "latitude", mode: "insensitive" } },
        { serial: { contains: "latitude", mode: "insensitive" } },
        { assignee: { name: { contains: "latitude", mode: "insensitive" } } },
        { assignee: { employeeNo: { contains: "latitude", mode: "insensitive" } } },
      ],
```

Also change the two `toHaveLength(3)` assertions on `where.OR` (the "stage rides alongside q" and "rides alongside other facets and q" tests) to `toHaveLength(5)`. Add:

```ts
describe("the Attention sort key (spec §6.3, plan P-10)", () => {
  it("is sortable and parses from the URL", () => {
    expect(INVENTORY_LIST_CONFIG.sortable).toContain("attention");
    expect(parse("sort=attention").sort).toEqual([{ key: "attention", dir: "asc" }]);
  });
  it("never reaches the SQL order, and alone falls back to the default order", () => {
    expect(buildAssetOrderBy([{ key: "attention", dir: "asc" }])).toEqual(buildAssetOrderBy([]));
    expect(buildAssetOrderBy([{ key: "attention", dir: "asc" }, { key: "model", dir: "desc" }])).toEqual([{ model: "desc" }, { id: "asc" }]);
  });
});
```

Implement: add `"attention"` to the end of `INVENTORY_LIST_CONFIG.sortable`; add the two assignee terms to `buildAssetWhere`'s OR; in `buildAssetOrderBy`:

```ts
export function buildAssetOrderBy(sort: SortKey[]): Prisma.AssetOrderByWithRelationInput[] {
  // "attention" is derived, not a column — listAssets orders it in memory (plan P-10). Filter first, then fall back.
  const kept = sort.filter((s) => s.key !== "attention");
  const order = kept.length ? kept : INVENTORY_LIST_CONFIG.defaultSort;
  return [
    ...order.map(({ key, dir }): Prisma.AssetOrderByWithRelationInput =>
      key === "category" ? { category: { name: dir } } : { [key]: dir }),
    { id: "asc" },
  ];
}
```

- [ ] **Step 9: `auditPhrase`** — read `src/lib/activity.ts` (`auditSentence`) and its test. Add `auditPhrase(entry: { action: string; diff: unknown; actorLabel?: string; entityLabel?: string })` returning the SAME sentence `auditSentence` builds, minus its leading actor and minus the entity label — built from the same verb map, not by string surgery on the full sentence (e.g. `assigned to Carlo Dizon`, `returned · now SPARE`, `registered`). Unit-test three actions against their `auditSentence` counterparts: for each, `auditSentence(...)` equals `${actorLabel} ` + a sentence that contains `auditPhrase(...)`'s words, and `auditPhrase` never contains the actor label or the tag. If `auditSentence`'s structure makes a clean phrase impossible without duplicating its map, add an `{ omitActor, omitEntity }` option to `auditSentence` instead and test that — record which in the report.

- [ ] **Step 10: Gate** — `npx vitest run` (93 files), `npx tsc --noEmit`, `npx eslint .` clean.
- [ ] **Step 11: Commit** — `git add` the three new modules and their tests, then commit all Task 1 files: `feat(rules): Phase 30 -- STATUS_LABEL, statusTargets, defaultClassFor, withViewClsQS; recordActions; attentionOf and the Attention sort key; holder search terms; parseSerialPaste, normaliseCost; auditPhrase` with a second `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

---

### Task 2: Server

**Files:**
- Modify: `src/server/modules/inventory/queries.ts`, `src/server/modules/inventory/actions.ts`, `src/server/modules/purchases/receiving.ts`, `src/server/modules/lifecycle/actions.ts`, `src/server/modules/finance/queries.ts`, `src/app/(app)/inventory/export/route.ts`, and minimal caller fixes in `src/components/inventory/register-form.tsx` and `asset-form.tsx` (only what tsc needs for the `checkIdentifiers` payload change)

**Interfaces — Consumes:** T1's `attentionOf`, `attentionWhere`, `orderByAttention`, `defaultClassFor`, `statusTargets`, `normaliseCost`. **Produces:**
- `AssetRow` gains `assigneeId: string | null`, `assigneeNo: string | null`, `cls: AssetClass`, `statusValue: AssetStatus`, `returned: boolean`, `pendingRef: string | null`, `loanDueAt: string | null` (ISO date), `awaitingItCheck: boolean`, `financeConfirmed: boolean`, `financeReturned: boolean`, `attention: Attention | null`. (`status: string` stays for display.)
- `listAssets(state, purchaseYear, cls, now = new Date())` honours `sort=attention` and returns `attentionCount: number` beside `total`.
- `spareOptions(preferTypeId)` → `{ options: ComboOption[]; hidden: number }` (excludes spares with an ACTIVE reservation OR an open approval; `hidden` counts both).
- `checkIdentifiers` → `ActionResult<{ tags: Array<{ tag: string; id: string }>; serials: Array<{ serial: string; id: string; tag: string }> }>`, metered on `checkRate(user.id, "check")`.
- `createAsset` accepts `loanDueAt?: string` and `requestId?: string`; returns every post-schema refusal in one `validationError`; model rule min 2 / max 120.
- `registerAssets` returns every post-schema refusal in one `validationError` (keys `tags` / `serials` / `categoryId` / `typeId` / `requestId`); model rule min 2 / max 120.
- `nextToReview(currentId: string, cls: AssetClass)` in `finance/queries.ts` → `{ id: string; tag: string } | null`; `confirmAssetDetails` returns `{ tag, next }`.
- Every list-query-string parser defaults its class with `defaultClassFor(user.role)`.

- [ ] **Step 1: Class default in the parsers (P-7).** `grep -n "parseCls(" src -r` and inspect each hit. Where a class is parsed from a LIST query string (the export route's `?? "IT"`, the bulk actions' `filters` in `lifecycle/actions.ts` and `inventory/actions.ts`, and any other `?? "IT"` fallback on list state), replace the IT fallback with `defaultClassFor(user.role)` (import from `@/lib/asset-class`). Leave `parseCls` itself and non-list callers (e.g. `/inventory/new`'s `?cls=` scoping) unchanged. List every changed site in the report.

- [ ] **Step 2: The list row.** In `queries.ts`: `LIST_INCLUDE` gains `approvals: { where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } }, select: { refNo: true }, orderBy: { createdAt: "desc" }, take: 1 }` and the assignee's `employeeNo` (the include already loads the whole assignee). `toRow(a, now)` fills the new `AssetRow` fields:

```ts
    assigneeId: a.assignee?.id ?? null,
    assigneeNo: a.assignee?.employeeNo ?? null,
    cls: a.cls,
    statusValue: a.status,
    returned: a.returnedAt !== null,
    pendingRef: a.approvals[0]?.refNo ?? null,
    loanDueAt: a.loanDueAt ? a.loanDueAt.toISOString().slice(0, 10) : null,
    awaitingItCheck: a.cls === "IT" && a.itVerifiedAt === null,
    financeConfirmed: a.financeConfirmedAt !== null,
    financeReturned: a.financeReturnedAt !== null,
    attention: attentionOf({
      cls: a.cls, status: a.status, returnedAt: a.returnedAt, loanDueAt: a.loanDueAt,
      pendingRef: a.approvals[0]?.refNo ?? null, itVerifiedAt: a.itVerifiedAt,
    }, now),
```

(widen `toRow`'s parameter type with those scalar fields — `include` already returns every scalar). `hold` stays.

- [ ] **Step 3: The Attention pass and the count.** In `listAssets`, compute `const where = …` (or the stage path's `idWhere`) once, then:

```ts
  const attentionCount = await prisma.asset.count({ where: { AND: [baseWhere, attentionWhere(now)] } });
  const attentionSort = state.sort.find((s) => s.key === "attention");
  if (attentionSort) {
    const all = await prisma.asset.findMany({ where: baseWhere, orderBy, include: LIST_INCLUDE });
    const ordered = orderByAttention(all.map((a) => toRow(a, now)), attentionSort.dir);
    const pg = pageOf(ordered.length, state.page, ENTITY_PAGE_SIZE);
    return { rows: ordered.slice(pg.skip, pg.skip + pg.take), total: pg.total, page: pg.page, pageCount: pg.pageCount, attentionCount };
  }
```

where `baseWhere` is the stage path's `{ id: { in: ids } }` or the plain `buildAssetWhere(...)`; `pageOf` comes from `@/lib/paging` (check its return field names — Phase 29 used `pg.skip`, `pg.take`, `pg.page`, `pg.pageCount`, `pg.total` or `pageOf(total, page, size)`; match the real signature). The two existing `pagedSnapshot` paths return `attentionCount` too.

- [ ] **Step 4: Replace exclusions.** `spareOptions` becomes:

```ts
export async function spareOptions(preferTypeId: string | null): Promise<{ options: ComboOption[]; hidden: number }> {
  const pool = { cls: "IT" as const, status: ASSIGNABLE_FROM.IT, returnedAt: null };
  const [rows, all] = await Promise.all([
    prisma.asset.findMany({
      where: { ...pool, reservations: { none: { state: "ACTIVE" } }, approvals: { none: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } } },
      select: { id: true, tag: true, model: true, typeId: true },
      orderBy: { tag: "asc" },
    }),
    prisma.asset.count({ where: pool }),
  ]);
  const isSameType = (t: string | null) => preferTypeId !== null && t === preferTypeId;
  const rank = (t: string | null) => (isSameType(t) ? 0 : 1);
  const options = rows.sort((a, b) => rank(a.typeId) - rank(b.typeId) || a.tag.localeCompare(b.tag))
    .map((a) => ({ value: a.id, label: a.tag, sub: a.model, group: isSameType(a.typeId) ? "Same type" : "Other spares" }));
  return { options, hidden: all - rows.length };
}
```

Update its one caller (`[id]/layout.tsx`: `const spares = canReplace ? await spareOptions(asset.typeId) : …`) to pass `spares.options` to `ReplaceControl` for now (T3 wires `hidden`).

- [ ] **Step 5: `checkIdentifiers`.** Add `const rate = await checkRate(user.id, "check"); if (!rate.allowed) return rateLimited(rate.retryAfterSec);` after the role guard; select `{ tag: true, id: true }` and `{ serial: true, id: true, tag: true }`; return `ok({ tags: byTag, serials: bySerial.map((a) => ({ serial: a.serial as string, id: a.id, tag: a.tag })) })`. Fix the two client callers minimally so tsc passes (map `res.data.tags.map((t) => t.tag)` / `serials.map((s) => s.serial)` where they used strings) — T5 rebuilds the messages.

- [ ] **Step 6: `createAsset` — one pass, the loan date, the request.** Schema: `model: z.string().trim().min(2, "Name the model").max(120)` (unchanged), add `loanDueAt: dateStr.optional()` and `requestId: z.string().optional()`; `cost` keeps its union (the client sends a normalised string or ""). Replace the early-return chain after `safeParse` with an accumulator:

```ts
  const errors: Record<string, string> = {};
  const category = await prisma.assetCategory.findUnique({ where: { id: d.categoryId }, select: { name: true, cls: true } });
  if (!category) errors.categoryId = "Unknown category";
  else if (!canRegisterClass(user.role, category.cls)) {
    errors.categoryId = `${category.name} is ${CLASS_PHRASE[category.cls]} category — your department does not create ${CLASS_LABEL[category.cls]} assets.`;
  }
  const plan = category ? creationPlan(d.requestedStatus, d.assigneeId || null, category.cls) : null;
  if (plan && !plan.ok) {
    if (plan.error === "assignee_required") errors.assigneeId = "Pick who this deploys to";
    else errors.requestedStatus = `${d.requestedStatus} is not an initial state for ${CLASS_PHRASE[category!.cls]} asset.`;
  }
  const loan = loanDueFor(d.requestedStatus, d.loanDueAt || undefined, new Date());
  if (!loan.ok) errors.loanDueAt = "Pick the date the loan ends";
  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId } });
    if (!type || type.categoryId !== d.categoryId) errors.typeId = "That type doesn't belong to the chosen category";
  }
  if (d.requestId) {
    const req = await prisma.purchaseRequest.findUnique({ where: { id: d.requestId }, select: { refNo: true, state: true } });
    if (!req) errors.requestId = "Unknown request";
    else if (req.state !== "COMPLETED") errors.requestId = `${req.refNo} is ${req.state.toLowerCase()} — only a completed request can be linked.`;
  }
  const tagTaken = await prisma.asset.findUnique({ where: { tag: d.tag }, select: { id: true } });
  if (tagTaken) errors.tag = `${d.tag} is already registered`;
  if (d.serial) {
    const serialTaken = await prisma.asset.findFirst({ where: { serial: d.serial }, select: { tag: true } });
    if (serialTaken) errors.serial = `Serial ${d.serial} is already on ${serialTaken.tag}`;
  }
  let employee: { name: string; employment: string } | null = null;
  if (plan?.ok && plan.approval) {
    employee = await prisma.employee.findUnique({ where: { id: plan.approval.assigneeId }, select: { name: true, employment: true } });
    if (!employee) errors.assigneeId = "Unknown employee";
  }
  if (Object.keys(errors).length) return validationError(errors);
  if (employee && employee.employment !== "ACTIVE") return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — assignments are frozen.`);
```

(import `loanDueFor` from `@/lib/lifecycle`). In the create data add `purchaseRequestId: d.requestId || null`; in the direct `prepareLifecycle(... { kind: "assign", ..., loanDueAt: null })` call pass `loanDueAt: loan.ok ? loan.value : null`. Keep the P2002 catch as the last line of defence, with the messages `${d.tag} is already registered` and `That serial is already registered`.

- [ ] **Step 7: `registerAssets` — one pass.** Model rule → `.min(2, "Name the model").max(120)`. Replace the early returns after `safeParse` with an accumulator: in-batch duplicate tag → `errors.tags = "Row {i} · {tag} appears twice in this batch"` (1-based i of the second occurrence); category checks → `errors.categoryId`; type/category mismatch → `errors.typeId` (add the same check `createAsset` does); in-batch duplicate serial → `errors.serials = "Row {i} · serial {serial} appears twice in this batch"`; tags already registered (one `findMany` over `d.tags` in the class) → `errors.tags = "Row {i} · {tag} is already registered"` for the FIRST such row (keep the first message; list the rest count as ` and {k} more` when k > 0); serials already registered → `errors.serials = "Serial {serial} is already on {tag}"` (first one, same ` and {k} more`); the request checks move BEFORE the transaction into the accumulator (`errors.requestId`). `if (Object.keys(errors).length) return validationError(errors);` Keep the transaction and its P2002 catch.

- [ ] **Step 8: Finance's next to review.** `finance/queries.ts`:

```ts
/** Phase 30 (spec §4.6): the next record waiting on Finance, in the queue's own order. */
export async function nextToReview(currentId: string, cls: AssetClass): Promise<{ id: string; tag: string } | null> {
  return prisma.asset.findFirst({
    where: {
      cls, cost: { not: null }, ...(cls === "IT" ? { itVerifiedAt: { not: null } } : {}),
      financeConfirmedAt: null, financeReturnedAt: null, id: { not: currentId },
    },
    orderBy: [{ cost: "desc" }, { tag: "asc" }, { id: "asc" }],
    select: { id: true, tag: true },
  });
}
```

(import `prisma`). `confirmAssetDetails` returns `ok({ tag, next: await nextToReview(asset.id, asset.cls) })` — after the transaction commits; widen its return type to `ActionResult<{ tag: string; next: { id: string; tag: string } | null }>` and fix `FinanceReview`'s typing minimally (T3 renders `next`).

- [ ] **Step 9: Proof against `inventory_dev`** (read-only `npx tsx scratch-t2.ts` in the worktree root, deleted before the commit): `listAssets({ q: "", page: 1, sort: [{ key: "attention", dir: "asc" }], filters: {} }, null, "IT")` → the first rows carry attention (BR-LT-0181 `queued APR-2041`, BR-LT-0148 `queued APR-2039`, the TEMPORARY loans with `no due date`), quiet rows after, and `attentionCount` equals the number of rows with non-null attention over the whole IT fleet (compute both and print them side by side); `q: "Carlo"` returns BR-LT-0201 (held by EMP-0099); `spareOptions(null).hidden` ≥ 2 (BR-MN-0910 is reserved, BR-LT-0181 is queued); `nextToReview("x", "IT")` returns the highest-cost unconfirmed checked IT asset. Record the printed lines.

- [ ] **Step 10: Gate** — tsc, eslint, vitest clean. No Playwright in this task.
- [ ] **Step 11: Commit** — `feat(inventory-server): Phase 30 -- the list row carries holder ids, loan, queue and review state with its attention reason; the Attention sort and count; Replace excludes queued spares and counts the hidden; checkIdentifiers returns records on the check rate kind; createAsset and registerAssets refuse in one pass, with the loan date and request at quantity 1; Finance's next to review; list parsers default to the role's class`.

---

### Task 3: The record header — controlled dialogs and `RecordActions`

**Files:**
- Modify: `holder-control.tsx`, `replace-control.tsx`, `status-control.tsx`, `triage-control.tsx`, `loan-due-control.tsx`, `it-check.tsx`, `finance-review.tsx` (all in `src/components/inventory/`), `src/app/(app)/inventory/[id]/layout.tsx`
- Create: `src/components/inventory/record-actions.tsx`
- Adapt e2e: see "Pinned e2e" below

**Interfaces — Consumes:** `recordActions`, `actionLabel`, `RecordAction`, `RecordState` (T1); `STATUS_LABEL`, `statusTargets`, `defaultClassFor`, `withViewClsQS` (T1); `spareOptions` → `{ options, hidden }`, `confirmAssetDetails` → `{ tag, next }` (T2). **Produces (T7 reuses them in the list's row menu):**
- `AssignDialog({ open, onClose, asset: { id, tag, model }, direct, employees, recentEmployees?, heldFor? })`
- `ReturnDialog({ open, onClose, asset: { id, tag, model }, holder: { id, name }, direct })`
- `ReserveDialog({ open, onClose, asset: { id, tag, model }, employees, recentEmployees?, defaultExpiry, minExpiry })`
- `ReplaceDialog({ open, onClose, asset: { id, tag, model }, holder: { id, name }, spares: ComboOption[], hidden: number })`
- `ChangeStatusDialog({ open, onClose, asset: { id, tag, model, cls, status, hasHolder }, direct })`
- `TriageDialog({ open, onClose, asset: { id, tag, model } })`
- `LoanDueDialog({ open, onClose, asset: { id, tag }, loanDueAt: string | null })` and a display-only `LoanLine({ loanDueAt, today })`
- `ItCheckDialog({ open, onClose, asset: { id, tag } })`, `FinanceReviewDialog({ mode: "confirm" | "return" | "resubmit" | null, onClose, asset: { id, tag, cls }, onConfirmed?(next) })`
- `RecordActions({ plan, asset, direct, ...dialog data })`

- [ ] **Step 1: Split every control into a controlled dialog** (P-3). Keep each file's dialog body, state, submit logic, toasts and error handling; delete the internal `open` state and the self-rendered trigger `Button`; take `open` / `onClose` props; reset fields in a `useEffect` keyed on `open` (the Phase 29 `TransferDialog` shape: `useEffect(() => { if (open) { …reset… } }, [open])`); every `setOpen(false)` / `close()` → reset + `onClose()`. `HolderControl` splits into `AssignDialog`, `ReturnDialog`, `ReserveDialog` in the same file (share the submit helper). `LoanDueControl` splits into `LoanDueDialog` and `LoanLine` (display only: `On loan until ` + `<DuePill dueAt={new Date(loanDueAt + "T00:00:00Z")} today={today} withDate />`, or the attention-styled `No due date` when null). `FinanceReview` becomes `FinanceReviewDialog` driven by a `mode` prop; its fault `Banner` and `RateLimitNotice` move INSIDE the dialog body and the dialog stays open on failure (F-RECORD-14).

- [ ] **Step 2: Direct titles, verbs and focus** (spec §4.3; non-direct unchanged per P-5 plus the line `This files a request for approval.` in each non-direct dialog's explanatory paragraph):

| dialog | direct title | confirm button |
|---|---|---|
| Assign | `Assign {tag} · {model}` | `Assign` |
| Return | `Return {tag} · {model} from {holder}?` | `Return` |
| Reserve | `Reserve {tag} · {model}` | `Reserve` |
| Replace | `Replace {tag} · {model} for {holder}` | `Replace` |
| Change status | `Change status of {tag} · {model}` | `Change status` |
| Triage | `Triage {tag} · {model}` | `Save decision` |
| Loan date | `Set the loan date for {tag}` | `Save date` |

Assign puts `Assign to` first with `autoFocus`, then the Deployed / Loan segmented control, then `Loan until`. Replace's combobox gets `autoFocus`; below it, when `hidden > 0`, the muted line `{hidden} more spare{s} {is|are} held or queued for someone else`. Change status: options are `statusTargets(asset)` rendered with `STATUS_LABEL` (values the enum), preceded by a disabled placeholder `<option value="">Pick a status…</option>` selected by default; submitting with no pick sets the field error `Pick a status`. Loan toasts use `fmtDate` (`{tag} on loan to {name} until {date}`, `{tag} due back {date}`).

- [ ] **Step 3: `record-actions.tsx`** (client):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { actionLabel, type RecordAction } from "@/lib/record-actions";
import { CLASS_LABEL } from "@/lib/asset-class";
import type { AssetClass, AssetStatus } from "@prisma/client";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { AssignDialog, ReserveDialog, ReturnDialog } from "./holder-control";
import { ReplaceDialog } from "./replace-control";
import { ChangeStatusDialog } from "./status-control";
import { TriageDialog } from "./triage-control";
import { LoanDueDialog } from "./loan-due-control";
import { ItCheckDialog } from "./it-check";
import { FinanceReviewDialog } from "./finance-review";

/**
 * Phase 30 (spec §4.1, plan P-3/P-4): the record's one state-chosen primary, Edit visible, the rest in More.
 * The twin of ProfileActions: this component owns which dialog is open; the dialogs own nothing but their form.
 */
export function RecordActions(props: {
  plan: { primary: RecordAction | null; more: RecordAction[]; edit: boolean };
  asset: { id: string; tag: string; model: string; cls: AssetClass; status: AssetStatus; hasHolder: boolean; loanDueAt: string | null };
  holder: { id: string; name: string } | null;
  direct: boolean;
  employees: ComboOption[];
  recentEmployees: string[];
  heldFor?: { id: string; name: string };
  spares: { options: ComboOption[]; hidden: number };
  holdExpiry: { defaultExpiry: string; minExpiry: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<RecordAction | null>(null);
  const [next, setNext] = useState<{ id: string; tag: string } | null | undefined>(undefined);
  const { plan, asset, direct } = props;
  const close = () => setOpen(null);

  function run(action: RecordAction) {
    if (action === "print-label") { router.push(`/inventory/labels?ids=${asset.id}`); return; }
    setOpen(action);
  }

  const items: MenuItem[] = plan.more.map((a) => ({ label: actionLabel(a, { cls: asset.cls, direct, inMenu: true }), onSelect: () => run(a) }));
  const nothing = !plan.primary && !plan.edit && items.length === 0;

  return (
    <>
      {next !== undefined && (next
        ? <ButtonLink href={`/inventory/${next.id}`}>Next to review →</ButtonLink>
        : <span className="text-xs text-fg-muted">Queue clear · <a className="underline" href="/finance/assets">Back to the queue</a></span>)}
      {nothing && next === undefined && <span className="text-xs text-fg-muted">Managed by {CLASS_LABEL[asset.cls]} — view only</span>}
      {plan.primary && (
        <Button variant="primary" onClick={() => run(plan.primary!)}>{actionLabel(plan.primary, { cls: asset.cls, direct, inMenu: false })}</Button>
      )}
      {plan.edit && <ButtonLink href={`/inventory/${asset.id}/edit`}>Edit</ButtonLink>}
      {items.length > 0 && (
        <Menu align="end" items={items} trigger={(p) => <IconButton {...p} aria-label="More actions">⋯</IconButton>} />
      )}
      {/* one dialog per action kind; each mounts closed and resets itself on open */}
      <AssignDialog open={open === "assign"} onClose={close} asset={asset} direct={direct} employees={props.employees} recentEmployees={props.recentEmployees} heldFor={props.heldFor} />
      {props.holder && <ReturnDialog open={open === "return"} onClose={close} asset={asset} holder={props.holder} direct={direct} />}
      {props.holder && <ReplaceDialog open={open === "replace"} onClose={close} asset={asset} holder={props.holder} spares={props.spares.options} hidden={props.spares.hidden} />}
      <ReserveDialog open={open === "reserve"} onClose={close} asset={asset} employees={props.employees} recentEmployees={props.recentEmployees} {...props.holdExpiry} />
      <ChangeStatusDialog open={open === "change-status"} onClose={close} asset={asset} direct={direct} />
      <TriageDialog open={open === "triage"} onClose={close} asset={asset} />
      <LoanDueDialog open={open === "set-loan-date"} onClose={close} asset={asset} loanDueAt={asset.loanDueAt} />
      <ItCheckDialog open={open === "mark-checked"} onClose={close} asset={asset} />
      <FinanceReviewDialog
        mode={open === "confirm-details" ? "confirm" : open === "send-back" ? "return" : open === "mark-corrected" ? "resubmit" : null}
        onClose={close} asset={asset} onConfirmed={(n) => setNext(n)}
      />
    </>
  );
}
```

(Adjust prop shapes to the real dialog signatures you produced in Step 1; keep the behaviour: exactly one primary, Edit visible when `plan.edit`, `⋯` with `aria-label="More actions"` only when More has items, the view-only line when nothing renders, `Next to review →` / `Queue clear` after a confirm.)

- [ ] **Step 4: The layout** (`[id]/layout.tsx`). Build `const state: RecordState = { cls, status, hasHolder: !!asset.assignee, returnedAt, itVerifiedAt, financeConfirmedAt, financeReturnedAt, pending: !!pending, held: !!hold }` and `const plan = recordActions(state, user.role)`; load `employees`/`recentEmployees` when `plan.primary === "assign" || plan.more.includes("assign") || … "reserve"`, `spares` when Replace is offered (`spareOptions(asset.typeId)`, else `{ options: [], hidden: 0 }`). `actions={<RecordActions … />}`. Breadcrumb: `{ label: asset.cls === "IT" ? "Inventory" : "Purchasing assets", href: "/inventory" + withViewClsQS("", asset.cls, defaultClassFor(user.role)) }`. Badges (spec §4.1): `StatusPill`; then at most ONE of — `BACK · NOT CHECKED` (when `returnedAt`), else `AWAITING IT CHECK` (IT roles, awaiting), else `AWAITING FINANCE` (finance_staff and admin, unconfirmed and not awaiting IT), else `RETURNED BY FINANCE` (roles that may resubmit, when returned); then `READ-ONLY · VIEWER` for viewers. The class, provenance and finance-state pills leave the header (T4 puts them in the Overview's Record row). The info line under the header: the model, ` · held by ` + a `Link` (not `<a>`) to the holder; `Last change: {auditPhrase} · {fmtDate} · {actor}` (use T1's `auditPhrase` via a small change to `lastLifecycleChange` returning `phrase` beside `sentence`); for a loan, `<LoanLine loanDueAt today />` (no Change / Set date button — Set loan date is in More). Delete the old per-control renders.

- [ ] **Step 5: Pinned e2e** (adapt only for this task's changes — the facts file `phase-30-plan-facts-record.md` §11 has every line): `direct-lifecycle.spec.ts` (Change status → More, pick a target explicitly because nothing is preselected, dialog names and verbs; Replace → More; Triage `Save decision`; line 343–347 Purchasing checks), `holds.spec.ts` (Reserve → More `Reserve…`; Replace → More; Assign verb `Assign`; Change status), `custody.spec.ts:226–261` (Assign/Return/Triage titles and verbs; `On loan until {date}` → the loan line now reads `On loan until` beside a `DuePill` — assert both), `it-gaps.spec.ts:253–324, 407–424` (Replace via More, Return title/verb, the `Last change:` line's new phrase), `rate-limit.spec.ts:74–88`, `oversight.spec.ts:145–149`, `receiving.spec.ts` (Send back → More `Send back to IT…`; Confirm details stays the primary; dialog titles unchanged), `asset-classes.spec.ts:346–376` (Send back to Purchasing → More; Mark corrected stays primary), `department-owned.spec.ts:117–162, 369–420` (non-direct labels unchanged — expect no change; confirm), `quick-forms.spec.ts:460–488` (Return title/verb), `employee-ux.spec.ts` (only if it drives an inventory record dialog — it should not). Then `grep -n 'name: "Confirm"' e2e/*.ts` and adapt only the hits inside inventory record dialogs.

- [ ] **Step 6: Run** FOREGROUND: `E2E_PORT=3100 npx playwright test e2e/direct-lifecycle.spec.ts e2e/holds.spec.ts e2e/custody.spec.ts e2e/it-gaps.spec.ts --workers=1 --global-timeout=540000`, then `e2e/receiving.spec.ts e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/rate-limit.spec.ts e2e/oversight.spec.ts e2e/quick-forms.spec.ts` — until green; port check after each; `npm run db:seed` last.
- [ ] **Step 7: Gate + commit** — `feat(record): Phase 30 -- one state-chosen primary with Edit kept and a More menu; controlled dialogs that name device and person and confirm with a verb; Change status offers only legal targets; the Replace picker hides queued spares and says how many; one pill that asks something of the viewer; class-aware breadcrumb; Finance's next to review`.

---

### Task 4: The record body and the Edit route

**Files:**
- Move (git mv): `src/app/(app)/inventory/[id]/{layout.tsx,page.tsx,loading.tsx,history,timeline,documents,secrets,reservations}` → `src/app/(app)/inventory/[id]/(record)/…`; keep `[id]/not-found.tsx` and `[id]/edit/` in place
- Modify: `(record)/page.tsx` (Overview), `record-tabs.tsx`, `documents-panel.tsx`, `secrets-panel.tsx`, `[id]/edit/page.tsx`, `asset-form.tsx`, `created-notice.tsx`
- Adapt e2e: `it-core.spec.ts:232–257, 444–445`, `axe-sweep.spec.ts` (only if a route path it builds changed — it should not), any `AUDITED` / `Reservations` tab assertion

**Interfaces — Consumes:** `LoanLine` (T3), `auditPhrase` (T1). **Produces:** `AssetForm` edit-only (`mode="edit"` is the only mode), with a sticky bar and a toast.

- [ ] **Step 1: Route group (P-15).** `git mv` the listed files into `(record)/`. Fix the relative imports if any (they are `@/` aliases — likely none). `[id]/edit/page.tsx` now renders OUTSIDE the record layout: give it `<PageHeader title={`Edit ${asset.tag}`} breadcrumb={[{ label: asset.cls === "IT" ? "Inventory" : "Purchasing assets", href: "/inventory" + withViewClsQS("", asset.cls, defaultClassFor(user.role)) }, { label: asset.tag, href: `/inventory/${asset.id}` }, { label: "Edit" }]} />` (the last linked crumb makes Back return to the record) and delete the old comment about the double breadcrumb.

- [ ] **Step 2: `asset-form.tsx` edit-only.** Remove the `mode="new"` branch and every create-only field and prop (Initial state, assignee, documents, suggestions, `directClasses`). Add the sticky bar `Cancel` (`router.push('/inventory/{id}')`) · `Save changes` (primary). On success: `toast(`${tag} saved`, "settled")` and `router.push('/inventory/{id}')`; drop the `✓ Saved` flash. Trim text fields on blur; the Cost field becomes a text input with `inputMode="decimal"` normalised on blur with `normaliseCost` (error `Enter an amount like 12500 or 12,500.50`). Every field error renders in one pass and focuses the first `[aria-invalid="true"]` (the Phase 29 `useEffect` keyed on `errors`).

- [ ] **Step 3: Overview** (`(record)/page.tsx`, spec §4.4): Identity = Brand, Serial, Category, Type, and (loans) `Loan until` with `<DuePill … withDate />`. Procurement & warranty gains a first row **Record**: the class label, the provenance (`From {refNo}` linked, or the provenance label with ` · no purchase request` for historical), and the finance state (`Finance confirmed · {date}` / `Returned by Finance` / `Awaiting IT check` / `Awaiting Finance`). The holder is no longer repeated here. `CreatedNotice` becomes `{tag} registered` with a `Print label` `ButtonLink` (to `/inventory/labels?ids={id}`) and a `Register another` link (to `/inventory/register` + the class qs).

- [ ] **Step 4: Tabs** (`record-tabs.tsx`): Secrets' label is plain `Secrets` (no pill); Reservations renders only when `cls === "IT"` (new prop `cls`; the layout passes it). The reservations page's empty-state copy stays IT-worded (it is IT-only now).

- [ ] **Step 5: Documents** (`documents-panel.tsx`): rows show `KIND_LABELS[doc.kind] ?? doc.kind`. The dropzone stops uploading on drop/choose: a chosen or dropped file shows its name, a kind `Select` (default `photo` when `file.type.startsWith("image/")`, else the current kind), and an **Upload** button (plus `Cancel`); only Upload calls `uploadDocument`. Extract the dropzone as `src/components/patterns/file-drop.tsx` — `FileDrop({ onFile(file), accept, hint, disabled })` rendering the dashed zone, `Choose file`, the drag state — so T5 reuses it; `DocumentsPanel` composes it with the kind select and Upload button.

- [ ] **Step 6: Secrets** (`secrets-panel.tsx`): per-secret pending (`const [revealing, setRevealing] = useState<string | null>(null)`, only that row's Reveal shows `loading`); a revealed value gains a `Copy` button (`navigator.clipboard.writeText(value)`) whose label reads `Copied` for 2 s; `Store encrypted` keeps its own pending.

- [ ] **Step 7: Pinned e2e:** `it-core.spec.ts:232–257` (Edit → save: assert the toast `{tag} saved` and the URL back on the record instead of the `✓ Saved` button), `:444–445`; grep `e2e/*.ts` for `AUDITED`, `"Reservations"` (tab), `Saved`, `/edit` on inventory records and adapt only this task's changes. Run FOREGROUND `E2E_PORT=3100 npx playwright test e2e/it-core.spec.ts e2e/axe-sweep.spec.ts e2e/asset-classes.spec.ts e2e/holds.spec.ts --workers=1 --global-timeout=540000` until green; port check; seed last.
- [ ] **Step 8: Gate + commit** — `feat(record): Phase 30 -- Edit leaves the record layout with its own breadcrumb, a sticky bar and a toast; the Overview stops repeating the header and gains the loan date and a Record row; documents choose a kind before upload; one Reveal spins at a time and a revealed secret can be copied; Reservations only on IT records`.

---

### Task 5: One Register flow

**Files:**
- Modify: `src/app/(app)/inventory/register/page.tsx`, `register-form.tsx`, `register-success.tsx`, `src/app/(app)/inventory/new/page.tsx` (redirect), `src/lib/workspaces.ts`
- Adapt e2e: `registration.spec.ts`, `asset-classes.spec.ts:66–107, 408–466, 539–552`, `department-owned.spec.ts:347–361`, `it-gaps.spec.ts:169–197`, `purchasing-ext.spec.ts:293–347`, `receiving.spec.ts:124–186`, `it-core.spec.ts:206–215`, `direct-lifecycle.spec.ts:207–217`, `axe-sweep.spec.ts:129`

**Interfaces — Consumes:** `createAsset` (loanDueAt, requestId, one pass), `registerAssets` (one pass), `checkIdentifiers` (records + check kind) (T2); `parseSerialPaste`, `normaliseCost`, `STATUS_LABEL`, `CREATABLE_BY_CLASS`, `HOLDER_STATUSES` (T1 / existing); `FileDrop` (T4).

- [ ] **Step 1: `/inventory/new` → redirect.** `new/page.tsx` becomes `redirect("/inventory/register" + (cls ? `?cls=${cls}` : ""))` keeping `?cls=` (read it with `parseCls`). `workspaces.ts`: both nav entries read `Register assets` (`href: "/inventory/register"`); the Purchasing workspace's `IT inventory` link becomes `/inventory?cls=IT` (P-7).

- [ ] **Step 2: The page.** `register/page.tsx` reads `?cls=` and scopes categories and types to it when `canRegisterClass(role, cls)` (the old `new/page.tsx` rule, D-14), else to `REGISTRABLE_CLASSES[role]`. It loads, besides today's data: ACTIVE employees (`activeEmployeeOptions()`), `recentPicks(user.id, "employee")` and `recentPicks(user.id, "vendor")`, the direct classes (`ASSET_CLASSES.filter((c) => isDirectLifecycle(role, c))`), and purchase requests with their vendor name and a date (read `PurchaseRequest` in `prisma/schema.prisma` for the completion/updated date field; label options `{refNo} · {vendor} · {fmtDate(date)}`). Title `Register assets`; breadcrumb `[{ label: cls === "PURCHASING" ? "Purchasing assets" : "Inventory", href: "/inventory" + withViewClsQS("", cls ?? defaultClassFor(role), defaultClassFor(role)) }, { label: "Register assets" }]`.

- [ ] **Step 3: Field order** (spec §5.2) in card **Asset**: Category (autofocus; `<optgroup label="IT">` / `<optgroup label="Purchasing">` when the categories span both classes) → Type (hint `Leave blank only if no loadout slot should match it.`) → Model → Brand (moved here from Procurement) → Quantity (a text field holding the raw string; on blur clamp to 1–200 with the inline hint `Between 1 and 200`) → the tag run (prefix + start number as today; hint `The label is printed after you register.`) → the rows (P-12: always a table, one row at quantity 1): visible row numbers, `Tag` / `Serial` column headers, `aria-label`s `Tag {i}` / `Serial {i}` unchanged, and `{k} of {n} serials entered` when n > 1. Card **Procurement (optional)**: Purchase request (picking one fills an empty Vendor) → Vendor (`EntityCombobox` with `recent`) → Purchased → Warranty until → Cost (text, `inputMode="decimal"`, `normaliseCost` on blur, error `Enter an amount like 12500 or 12,500.50`) → Invoice no. → documents.

- [ ] **Step 4: Quantity 1 extras** (spec §5.3): below the rows, **Initial state** as a `SegmentedControl` (`aria-label="Initial state"`) over `CREATABLE_BY_CLASS[cls]` with `STATUS_LABEL` words (IT: Spare · Deployed · Loan; Purchasing: Stored · Operational); a holder status reveals `Assign to` (`EntityCombobox`, `recent`); `TEMPORARY` also reveals `Loan until` (`type="date"`, default `defaultLoanDue(new Date())`, `min` `minLoanDue(new Date())`); the explanatory line per state: Spare/Stored `Registered as a spare, ready to assign.`, Deployed/Operational `Deployed to the chosen person.`, Loan `Lent to the chosen person until the date below.`; for a non-direct class add `This files a request for approval.`. Documents at quantity 1: `FileDrop` accepting several files, each listed with a kind `Select`; at quantity > 1: one invoice file applied to every unit (today's behaviour) through `FileDrop`.

- [ ] **Step 5: Input tolerance** (spec §5.4): Enter in any row input never submits — `onKeyDown` Enter → `preventDefault()` and focus the next row's serial (the last row focuses the primary submit button). Paste in a serial cell: `onPaste` reads `clipboardData.getData("text")`; when `parseSerialPaste` yields more than one value, `preventDefault()`, fill that row and the rows below, raise Quantity if needed (cap 200), and show `Pasted {n} serials` under the rows (`Pasted 200 of {n} serials — the rest were not added.` when capped).

- [ ] **Step 6: Checks and errors** (spec §5.5): tag and serial duplicates checked WHILE TYPING (400 ms debounce + the staleness guard, blur still triggers) via `checkIdentifiers({ tags, serials, cls })`; messages under the rows naming the row and linking the record: `Row {i} · {tag} is already registered` (the tag a `Link` to `/inventory/{id}`), `Serial {serial} is already on {tag}` (tag linked). The submit is always enabled; client checks (category, model ≥ 2 chars, a valid tag run, the loan date when Loan, the assignee when a holder status) set every error at once; server `fieldErrors` merge in; after a refused submit, focus and scroll to the first `[aria-invalid="true"]`.

- [ ] **Step 7: Submit, bar, endings** (spec §5.6, P-13): sticky bar `Cancel` (ghost, `router.back()`) · **`Register 1 asset`** / **`Register {n} assets`** (primary, `name="intent" value="register"`) · `Register and add another` (secondary, `value="register-add"`; intent read from `SubmitEvent.submitter`, the Phase 29 R10 pattern; both buttons `disabled` while pending). Quantity 1 → `createAsset({ tag, model, brand, serial, categoryId, typeId, purchasedAt, cost, warrantyUntil, vendorId, invoiceRef, requestId, requestedStatus, assigneeId, loanDueAt })`, then upload each document with `uploadDocument` (kind per file); on success → `/inventory/{id}?created=1`, or `/inventory/{id}/documents?failed={k}&of={n}` when any upload failed. Quantity > 1 → `registerAssets` then the one invoice via the existing batch upload; success card. `Register and add another` keeps Category, Type, Vendor, Purchase request, Purchased, Warranty until and Invoice no.; clears the rest; toasts `Registered {n} asset(s)`; focuses Model. `register-success.tsx`: every tag as a `TagRef` link (first 10, then `and {k} more`), **Print labels** stays primary, then `Open the list` and `Register another batch`; the invoice-failure banner links the first unit's `/documents`.

- [ ] **Step 8: Pinned e2e** — the facts file `phase-30-plan-facts-list-register.md` §9 lists every hit. Adapt: `/inventory/new` flows now land on Register (field labels `Category` / `Model` / `Tag 1` / `Serial 1`, `Initial state`, `Assign to`); `Register asset` → `Register 1 asset` (10 hits); `Already registered…` strings → the new row messages; `Suggested — next free number…` hint (registration.spec:87) → whatever the tag-run hint now says (read the form); `New asset` / `Register several` links → `Register assets` (asset-classes:435, it-core:152, registration:215 — the list's header change lands in T6; if T6 has not run, adapt these in T6 instead and leave them here). Run FOREGROUND `E2E_PORT=3100 npx playwright test e2e/registration.spec.ts e2e/receiving.spec.ts e2e/purchasing-ext.spec.ts e2e/asset-classes.spec.ts --workers=1 --global-timeout=540000`, then `e2e/department-owned.spec.ts e2e/it-gaps.spec.ts e2e/it-core.spec.ts e2e/direct-lifecycle.spec.ts e2e/axe-sweep.spec.ts`; port checks; seed last.
- [ ] **Step 9: Gate + commit** — `feat(register): Phase 30 -- one Register flow (/inventory/new redirects) with the fields in the order they depend on, a loan date and holder at quantity 1, Enter that moves between rows, a pasted serial column, costs typed the way receipts print them, live checks that name and link the record, every error at once, a sticky bar with Register and add another, and endings that list what was made`.

---

### Task 6: The list header and toolbar

**Files:**
- Modify: `src/app/(app)/inventory/page.tsx`, `inventory-toolbar.tsx`, `column-chooser.tsx`
- Create: `src/components/inventory/inventory-more-menu.tsx`
- Adapt e2e: `import-export.spec.ts:461–466, 594–669`, `asset-classes.spec.ts:292–310, 435–440`, `it-core.spec.ts:85–152`, `registration.spec.ts:214–217`, `paging.spec.ts:224`, `offboarding.spec.ts:320–321`, `labels.spec.ts:204`

**Interfaces — Consumes:** `defaultClassFor`, `withViewClsQS` (T1); `listAssets` → `attentionCount` (T2).

- [ ] **Step 1: Default class and URL builders** (P-7): `const defaultCls = defaultClassFor(user.role); const cls = requested ?? defaultCls;` The page's `href`, `exportQS`, `sortHrefs` use `withViewClsQS(…, cls, defaultCls)` instead of `withClsQS`; pass `defaultCls` to the toolbar, which uses it in `submitSearch`, `applyFacet`, the class-switch links and the Purchased items. The unauthorised-class redirect stays.

- [ ] **Step 2: Header** (spec §6.1): one primary `Register assets` (`ButtonLink variant="primary"`, `/inventory/register` + `withViewClsQS("", cls, defaultCls)`) when `canRegister`, then `<InventoryMoreMenu importHref={canMutate && cls === "IT" ? "/inventory/import" : null} exportHref={"/inventory/export" + exportQS} />` — a client `Menu` behind `IconButton aria-label="More actions"` with `Import…` (`router.push`) and `Export` (`window.location.assign`). The no-assets empty state: title `No assets yet`; description `Register the first asset, or import a spreadsheet.` for roles that can register (IT view; the Purchasing view says `Register the first asset.`), else `No assets in this view.`; its action is the same single `Register assets`.

- [ ] **Step 3: Toolbar** (spec §6.2) in this order: the class switch and `Repairs` as pill toggles (links, `rounded-full`, at least 28 px tall, a leading aria-hidden `✓` and `aria-current="page"` when on; `Repairs` is on while `isRepairView(state)`), then the search (placeholder `Search tag, model, serial, holder · Enter`, `aria-label="Search assets"` unchanged (P-9), `key={state.q}`, a Clear `×` button `aria-label="Clear search"` when `state.q`), then the facets, then **Purchased** (P-8): a `Menu` whose trigger reads `Purchased` or `Purchased: {year|No date}` and whose items are `Any year` (clears) and one item per year chip `{label} · {count}`; then `Columns` at the right (its caption `Saved for you`); then the count line: `{n} asset{s}` and, when `attentionCount > 0`, ` · ` + a link `{k} need{s} attention` whose href is the current state with `sort: [{ key: "attention", dir: "asc" }]`, `page: 1`.

- [ ] **Step 4: Chips and paging** (spec §6.2, §6.5): chip labels are the value alone (`label`, not `${facet}: ${label}`), plus `Search: {q}` (removes `q`) and `Purchased: {year}` (removes the year) — the filtered-empty description counts `chips.length`. `page {n} of {m}` renders only when `pageCount > 1`. Search, facet, sort and page navigations run in `useTransition` (toolbar and table), and the table wrapper gets `data-pending` + `aria-busy` + `opacity-60` while one is in flight (the table's own `router.push` calls move into the same transition in T7; here, wrap the toolbar's).

- [ ] **Step 5: Pinned e2e:** `import-export.spec.ts:597` (Export → `More actions` → menuitem `Export`, still `waitForEvent("download")`), `:629–635` (the year chip → open `Purchased`, pick the first `\d{4}` item), `:461–466` (Import absence — confirm it still passes), `asset-classes.spec.ts:306–310` and `it-core.spec.ts:129` (chip labels without the facet prefix — scope to the chip row), `asset-classes.spec.ts:435–440` and `it-core.spec.ts:152` and `registration.spec.ts:215` (`New asset` / `Register several` → `Register assets`), `paging.spec.ts:224` (read the case: if it asserts `page 1 of` on a one-page inventory list, assert its absence instead), Repairs link assertions (still links — confirm), and every purchasing_staff test that opens `/inventory` expecting the IT view (it now opens Purchasing — add `?cls=IT` or adapt the expectation, whichever the test means). Run FOREGROUND `E2E_PORT=3100 npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/asset-classes.spec.ts e2e/paging.spec.ts --workers=1 --global-timeout=540000`, then `e2e/registration.spec.ts e2e/offboarding.spec.ts e2e/labels.spec.ts e2e/department-owned.spec.ts e2e/receiving.spec.ts`; port checks; seed last.
- [ ] **Step 6: Gate + commit** — `feat(inventory-list): Phase 30 -- one Register assets primary with Import and Export in More; the list opens on the role's own class; pill view switches; holder search with Clear; a single Purchased facet; value-only chips including search and year; the attention count; no "page 1 of 1"; pending dimming on list navigations`.

---

### Task 7: The list rows, the row menu and the selection bar

**Files:**
- Modify: `inventory-table.tsx`, `bulk-drawer.tsx`, `src/components/ui/table.tsx` (`Th`), `src/app/(app)/inventory/page.tsx` (props for the row menu)
- Adapt e2e: `custody.spec.ts:301–311`, `direct-lifecycle.spec.ts:188–190`, `it-core.spec.ts:163–172`, `it-gaps.spec.ts:138–144`, `labels.spec.ts:202–217`, `asset-classes.spec.ts:318`, `employees` table specs only if the `Th` change moves a pinned selector

**Interfaces — Consumes:** `AssetRow`'s new fields (T2); `recordActions`, `actionLabel`, `STATUS_LABEL`, `statusTargets` (T1); `AssignDialog`, `ReturnDialog`, `ChangeStatusDialog` (T3).

- [ ] **Step 1: Status cell** (spec §6.3): drop the separate dot column; the Status cell renders `<StatusDot/>` + the enum word, and under it, when `row.attention`, a muted second line `{row.attention.label}` (`text-[10.5px] text-fg-muted`; `overdue` reasons use the attention text colour).
- [ ] **Step 2: Links and targets:** the tag cell is a `Link` (`onClick` stops propagation); the Assigned cell's holder is a `Link` to `/employees/{row.assigneeId}` with `{name} · {assigneeNo}` (stops propagation); the checkbox cell is the whole hit target (the `Td`'s own `onClick` toggles the row and stops propagation; the `Checkbox` keeps its `aria-label`). `Th` (shared primitive): the sort `<button>` fills the cell (`w-full`, the cell's padding moved onto the button, `text-left` / `text-right` per `align`) — verify the employees table still renders and its e2e still pass.
- [ ] **Step 3: Row menu** (spec §6.3, P-11): a last column (`<Th width={40} aria-label="Row actions" />`) with, per row, `recordActions(rowState, role)` filtered to `assign`, `return`, `change-status`, `print-label`; when that list is non-empty, a `Menu` trigger `IconButton aria-label={`Actions for ${row.tag}`}` (its `Td` stops propagation) whose items are those actions' `actionLabel(…, { inMenu: true })` followed by `Open record`. `rowState` comes from the row: `{ cls: row.cls, status: row.statusValue, hasHolder: !!row.assigneeId, returnedAt: row.returned ? new Date(0) : null, itVerifiedAt: row.awaitingItCheck ? null : new Date(0), financeConfirmedAt: row.financeConfirmed ? new Date(0) : null, financeReturnedAt: row.financeReturned ? new Date(0) : null, pending: !!row.pendingRef, held: !!row.hold }`. The table owns `const [dialog, setDialog] = useState<{ kind: RecordAction; row: AssetRow } | null>(null)` and renders one `AssignDialog` / `ReturnDialog` / `ChangeStatusDialog` for the active row (the page passes `role`, `direct`, `employees`, `recentEmployees`); Print label → `router.push('/inventory/labels?ids={id}')`; Open record → `router.push('/inventory/{id}')`. The table's `router.push` sort calls run in the Task 6 transition.
- [ ] **Step 4: Selection bar** (spec §6.4, P-14): `Clear` · **`Print labels`** (`ButtonLink` to `/inventory/labels?ids=…`, hidden when `allMatching`) · `Export` (`ButtonLink` to the export route with `?ids=` or the filters) · `Change status…` · `Assign…` (direct only, as today's drawer) — the last two open the drawer pre-set to that mode (new `BulkDrawer` prop `initialMode`). The drawer loses its two internal links, lists the selected tags under its scope line (the first 5, then `and {k} more`; for `allMatching`, `all {total} matching`), its Target status options are the union of `statusTargets({ cls, status: any, hasHolder: false })` minus nothing current — i.e. `statusesFor(cls)` without `HOLDER_STATUSES[cls]` — labelled with `STATUS_LABEL`, and `off-the-books stock` becomes `stock that is not assigned to anyone`.
- [ ] **Step 5: Pinned e2e:** `Bulk actions…` button (custody:301, direct-lifecycle:188, it-core:170, it-gaps:138) → `Change status…` or `Assign…` on the selection bar (the dialog is still named `Bulk actions`); `Print labels for 1 selected` (labels:210) → the selection bar's `Print labels`; `asset-classes.spec.ts:318` reads the Target status option texts → the friendly words. Run FOREGROUND `E2E_PORT=3100 npx playwright test e2e/custody.spec.ts e2e/direct-lifecycle.spec.ts e2e/it-core.spec.ts e2e/it-gaps.spec.ts --workers=1 --global-timeout=540000`, then `e2e/labels.spec.ts e2e/asset-classes.spec.ts e2e/holds.spec.ts e2e/directory.spec.ts e2e/employee-ux.spec.ts` (the last two for the `Th` change); port checks; seed last.
- [ ] **Step 6: Gate + commit** — `feat(inventory-list): Phase 30 -- the status dot beside the word with the row's attention reason under it; tag and holder as links; the whole checkbox cell and header cell as targets; a row menu with Assign, Return, Change status and Print label; the selection bar acts directly and the drawer names what it will touch`.

---

### Task 8: e2e — `e2e/inventory-ux.spec.ts`

**Files:** Create `e2e/inventory-ux.spec.ts`; adapt any remaining pinned case the earlier tasks' runs did not cover (grep once more: `Register several`, `New asset`, `Bulk actions…`, `status: `, `Yours only`, `name: "Change status" })`, `AUDITED`).

- [ ] **Step 1: The spec** — helpers copied from `e2e/it-nav.spec.ts:59–122` (`login`, `expectNoSeriousAxe`, `waitForHydration`; house rule: never import helpers across specs), `db = new PrismaClient()`, `beforeAll` seeds (`execSync("npm run db:seed", { timeout: 120_000 })`), `afterAll` disconnects; `SEED_PASSWORD` from `../prisma/fixtures`. Cases (write every body in full; keep every assertion named; restore every mutation in `finally`; never delete audit rows):
  1. **Spare header** (IT, BR-HS-0502): the one primary is `Assign`, `Edit` is visible, `More actions` holds `Reserve…`, `Change status…`, `Print label` and nothing else; axe.
  2. **Held header** (IT, BR-LT-0201, held by Carlo Dizon): primary `Return`; `More actions` holds `Replace…` first; the Return dialog is named `Return BR-LT-0201 · MacBook Air M3 from Carlo Dizon?` and confirms with `Return`; cancel it.
  3. **Back, not checked** (set `returnedAt` on BR-HS-0502 via `db` in the body, restore in `finally`): primary `Triage`; the badge `BACK · NOT CHECKED` is the only extra pill; the Triage dialog's button is `Save decision`.
  4. **Pending** (BR-LT-0181, APR-2041): no primary button in the header, the pending banner is visible, `More actions` holds only `Print label`.
  5. **Change status targets** (BR-HS-0502): the dialog opens on `Pick a status…`; its options are exactly the friendly words of `DEFECTIVE, DONATED, BUYOUT, DISPOSE, MISSING`; Change status with nothing picked shows `Pick a status`.
  6. **Row-menu Return** (IT, the list, BR-DK-0071 held by EMP-0042): `Actions for BR-DK-0071` → `Return…` → the named dialog → `Return`; the toast fires and the row's holder cell empties; `finally` restores the asset through `db` (`status`, `assigneeId`, `returnedAt: null`).
  7. **Attention** (IT, the list): the count line reads `{n} assets · {k} need attention`; clicking the attention link puts `sort=attention` in the URL and the first row's Status cell carries a reason line; BR-LT-0181's row reads `queued APR-2041`.
  8. **Holder search and Clear** (IT): search `Carlo` + Enter → BR-LT-0201 is listed; `Clear search` empties the box (`toHaveValue("")`) and drops `q` from the URL.
  9. **Register at quantity 1 as a Loan** (IT, `/inventory/register`): Category Laptop, Model, Initial state `Loan`, `Assign to` EMP-0097, `Loan until` = today + 10 d; `Register 1 asset` lands on `/inventory/{id}?created=1` with `Print label` and `Register another`; the DB row is TEMPORARY with that `loanDueAt`; `finally` deletes nothing (assets cannot be deleted) — use a unique model name and leave the asset (the next spec file's reseed removes it).
  10. **Batch with pasted serials** (IT): Quantity 3, paste `SN-A\nSN-B\nSN-C` into `Serial 1` (use `page.evaluate` to dispatch a `ClipboardEvent("paste")` with `DataTransfer`, or `locator.dispatchEvent` — whichever works; record which) → the three serial cells hold A, B, C and `Pasted 3 serials` shows; Enter in `Serial 1` moves focus to `Serial 2`; submit is NOT triggered by Enter (URL unchanged); then `Register 3 assets` → the success card lists three tag links.
  11. **One-pass errors** (IT, `/inventory/register`): submit with no Category and no Model → both field errors show at once and focus is on Category.
  12. **Purchasing opens on Purchasing** (`purchasing@`): `/inventory` shows the heading `Purchasing assets`; the `IT` switch link carries `cls=IT`; the record breadcrumb of a Purchasing asset returns to `/inventory` (no `cls`).
  13. **Viewer** (`viewer@`, BR-LT-0201): no primary, no `Edit`, no `More actions`; the `READ-ONLY · VIEWER` pill; axe.
- [ ] **Step 2: Run** FOREGROUND `E2E_PORT=3100 npx playwright test e2e/inventory-ux.spec.ts --workers=1 --global-timeout=540000` until green; then `npx playwright test --list | tail -1` → `{389 + 13} tests in 39 files` (report the real number); port check; `npm run db:seed` last.
- [ ] **Step 3: Gate + commit** — `test(e2e): Phase 30 -- inventory-ux.spec (record header per state, legal status targets, a row-menu return, attention, holder search, Register at quantity 1 as a loan, a pasted batch, one-pass errors, Purchasing's own class, a viewer's record)`.

---

### Task 9: Battery and documents

- [ ] Pre-checks: `git status` clean; tsc, eslint, vitest (files/tests); `npx prisma migrate status` (26, up to date — never migrate); `--list` (389 + N / 39).
- [ ] The seven chunks exactly as `docs/HANDOVER.md` §0 item 9 lists them, FOREGROUND, one at a time, with `e2e/inventory-ux.spec.ts` appended to the stock line (E2: `e2e/stock.spec.ts e2e/stocktake.spec.ts e2e/stock-lots.spec.ts e2e/stock-reports.spec.ts e2e/activity.spec.ts e2e/back.spec.ts e2e/inventory-ux.spec.ts`); expected A 54 · B 67 · C 64 · D 50 · E1 46 · E2 42 + N · F 66. Port check after each chunk. A failing chunk is re-run once; if it reproduces, STOP and report. `npm run db:seed` last.
- [ ] Docs (CRLF; a Python script with exact-once asserts, anchored on block headers): HANDOVER line 3 (Phase 30 CODE-COMPLETE, UNMERGED/UNPUSHED, no migration; "Before it:" keeps the Phase 29 sentence), a **(w)** block above the (v) block (what shipped per screen, the plan and P-1…P-16, every ruling from the ledger, the final review and fix wave, the battery, the parked items: History/Timeline merge, repair dialogs, the record-shaped skeleton, extra columns, plus anything the reviews deferred), §0 item 9's E2 line + a `**Phase 30 keeps all seven too**` sentence; PICKUP Branch / a new Battery row / Last two phases / §4 item 1; HANDOVER-PENDING's today paragraph and the parked items; the spec's Status and `*Amended (P-n / R-n):*` notes for P-4, P-5, P-11, P-12 and anything execution changed; this plan's D-block from the ledger. Commit `docs(handover,pickup,pending,plan,spec): Phase 30 code-complete -- battery {total} e2e / 39 files, {unit} unit, 26 migrations; (w) block; D-1..D-n`.

---

## Self-review

**Spec coverage:** §0 decisions 1–10 → T1 (`recordActions`, `defaultClassFor`, attention) + T3–T8; §3 shared rules → Global Constraints + T1 rules; §4.1 → T1 `recordActions` + T3 Steps 3–4 (P-4, P-5); §4.2 → T1 `statusTargets` + T3 Step 2 + T7 Step 4; §4.3 → T3 Step 2; §4.4 → T4 Steps 3–6; §4.5 → T4 Steps 1–2 (P-15); §4.6 → T2 Step 8 + T3 Step 3; §5.1 → T5 Step 1; §5.2 → T5 Step 3 (P-12); §5.3 → T2 Step 6 + T5 Step 4; §5.4 → T1 `register-input` + T5 Step 5 + T4 Step 5 (`FileDrop`); §5.5 → T2 Steps 5–7 + T5 Step 6; §5.6 → T5 Step 7; §6.1 → T1 `defaultClassFor` + T6 Steps 1–2 (P-7); §6.2 → T6 Steps 3–4 (P-8, P-9); §6.3 → T1 attention + T2 Steps 2–3 + T7 Steps 1–3 (P-10, P-11); §6.4 → T7 Step 4 (P-14); §6.5 → T6 Step 4; §7 edge cases → T1 tests (pending, Purchasing, admin), T2 (dateless loan refused), T5 (paste cap, redirect); §8 pinned copy → the task steps quote it verbatim; §9 tests → T1, T3–T8, T9; §10 files → the file list; §11 constraints → Global Constraints. Parked items (§2) → T9 docs.

**Placeholder scan:** the UI tasks give the component shapes, copy and behaviour and point at the facts files for today's verbatim code; the e2e case bodies are named assertion by assertion and written in full by the implementer — no TBD.

**Type consistency:** `RecordState` / `recordActions` / `actionLabel` (T1) → `RecordActions` (T3) and the row menu (T7); `AssetRow`'s new fields (T2) → the row's `RecordState` (T7) and the Status cell (T7); `spareOptions` → `{ options, hidden }` (T2) → `ReplaceDialog` (T3); `confirmAssetDetails` → `{ tag, next }` (T2) → `FinanceReviewDialog.onConfirmed` (T3); `checkIdentifiers` records (T2) → Register's messages (T5); `attentionCount` (T2) → the count line (T6); `defaultClassFor` / `withViewClsQS` (T1) → the parsers (T2), the breadcrumbs (T3, T4, T5) and the list builders (T6); `FileDrop` (T4) → Register (T5); the dialogs (T3) → the row menu (T7).

## Amendments made during execution

- *(Task 9 replaces this bullet with the D-block from the SDD ledger.)*
