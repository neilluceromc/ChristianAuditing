# Inventory v2 — Phase 5: Purchasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The purchase-request lifecycle becomes real — `/purchases` (tabs write `?state=`), `/purchases/new` (multi-unit editable rows with an autosaved DRAFT), `/purchases/[id]` (the bounce-back banner + 4-stop stepper + append-only note thread + the IT slot editor and Finance unit editor inline), `/purchases/[id]/edit`, and `/purchases/activity` — a three-party handoff (Purchasing drafts → IT specs → Finance approves the money) where rejection is a visible loop, not a dead end.

**Architecture:** `purchaseTransition(state, action, role)` is a pure TDD'd function in `src/lib/purchase-flow.ts` — server actions are its only callers, each writing through a **state-guarded `updateMany`** (count 0 → typed conflict) exactly like Phase 4's `transition()` skeleton. Every transition appends a **NoteEntry** (the notes surface is append-only, enforced by a DB trigger) in the same transaction as the domain write and the audit write. Bounce-back detection, the stepper model and the dwell line are pure functions derived from the thread — no new columns, no new enum. These are PR-state transitions only: no Approval rows, no worker jobs.

**Tech Stack:** Existing Phase 3/4 conventions (`ActionResult`, `actionRole`, `checkRate`, `writeAudit` + `diffOf`, `url-state`, `ActivityFeed`) · Prisma 6 · Vitest · Playwright + axe.

**Conventions for every task:** branch `phase-5-purchasing` (Task 1 creates it); `npx tsc --noEmit && npm run lint` before each commit; NEVER `npm run build` while a dev server runs; **NO schema changes and NO `prisma migrate reset` this phase** — every model, enum, trigger, sequence and CHECK constraint Phase 5 needs already exists. DB via `docker compose up -d db`, seed via `npm run db:seed`. Subagents do not start dev servers — the controller owns the preview; verify with unit tests + tsc + lint.

**Seed facts this phase leans on** (`prisma/seed.ts`): **PR-0201** DRAFT (1 unit) · **PR-0198** SUBMITTED — the bounce-back fixture: `reviewedAt`/`reviewedById` set (it *was* IT-reviewed), 2 units (`27-inch monitors` ×4, `USB-C docks` ×4 with `itSlotNotes`), and a **three-party thread** SUBMIT (purchasing) → IT_REVIEW (it) → REQUEST_INFO (finance, text starts "Unit 02: …") · **PR-0195** IT_REVIEWED, 1 APPROVED unit, 1 SUBMIT note · **PR-0188** COMPLETED · **PR-0183** CANCELLED with `cancelReason`. `purchase_request_ref_seq` sits at 201, so the first allocated refNo is `PR-202`.

**Entry criteria this plan implements (HANDOVER §6):** #1 `purchaseTransition` pure + TDD first, brief §6.1 verbatim, called only through state-guarded `updateMany` (Task 1, 7) · #2 NoteEntry is the only notes surface, every reason-carrying transition APPENDS (Task 7) · #3 the bounce-back banner + stepper + per-unit states reading together with the header state (Tasks 3, 11) · #4 `?state=` is the tab contract and `navIsActive` keeps highlighting the sidebar links (Tasks 2, 9) · #5 one detail page, role editors inline, saving a unit never re-submits, per-operation `actionRole` (Tasks 7, 11) · #6 no Approval rows, no jobs (whole phase) · #7 `/purchases/activity` reuses `ActivityFeed` scoped to `entityType: "purchase-request"`, with `entityLabels` + `AUDIT_ENTITY_TYPES` extended (Tasks 4, 13) · #8 money is `Decimal(12,2)` — `step="0.01"` + `inputMode="decimal"` + `.multipleOf(0.01)` (Tasks 8, 10).

---

## Recorded scope decisions

1. **IT staff get a real entry point to `/purchases`.** Brief §6.1 makes IT the second party to the flow and HANDOVER §6.5 gives `it-review`/`it-reject` to `it_staff`, but today `PATH_RULES` grants `/purchases` to the purchasing + finance workspaces only — an `it_staff` user could never reach the page whose action they own. Task 5 adds `"it"` to that rule and one IT-workspace nav item (**Purchase reviews** → `/purchases?state=SUBMITTED`, under Tracking). This is a deliberate deviation from brief §2's IT sidebar IA; the alternative is a transition only an admin can ever fire. `viewer` (IT workspace) therefore sees purchases read-only — mutating affordances absent, per the read-only state.
2. **Per-operation roles** (`PURCHASE_ACTION_ROLES`, Task 1): submit/cancel/draft-edit = `purchasing_staff` + `admin` · it-review/it-reject + the IT slot editor = `it_staff` + `admin` · request-info/complete + the Finance unit editor = `finance_staff` + `admin`. Cancel is the requester's own withdrawal (the brief is silent on who; purchasing owns the request). Free **COMMENT** notes: any of `purchasing_staff | it_staff | finance_staff | admin` — `viewer` cannot post. **Draft editing additionally requires ownership** (`saveDraft`: the requester or an admin) — a draft is not yet a shared document; once submitted, the request belongs to the flow and the per-operation roles above govern it.
3. **Every transition appends a NoteEntry**, not only the reason-carrying ones. `it-reject`, `request-info` and `cancel` **require** a typed reason; `submit`, `it-review` and `complete` take optional text and fall back to a canonical sentence, so the thread reads as a complete conversation instead of a log with holes (this is exactly how the seed's PR-0198 thread is shaped).
4. **Draft rows are created by the first autosave, not by opening the form.** `/purchases/new` holds unsaved rows in client state; the first autosave fires 2.5s after a change and only once at least one line carries a description, allocating the `PR-####`. Every later autosave edits that same row **in place, without navigating** — a route change mid-typing would remount the form and steal focus. The header chip becomes `DRAFT · SAVED 09:41` next to a link to the saved record; reloading `/purchases/new` deliberately starts a new draft (that is what "new" means), while `/purchases/[id]/edit` reopens an existing one. Autosave is skipped when nothing changed — the 60/min mutation cap is real.
5. **Draft saves audit only when something changed**, and the diff records the request-level summary (`units` count, `total`) rather than one entry per keystroke-level field. Create and every transition always audit.
6. **Cancel cancels its units:** the request going `CANCELLED` moves every non-terminal unit (`PENDING`) to `CANCELLED` in the same transaction. **Complete approves the remainder:** any still-`PENDING` unit becomes `APPROVED` when finance completes — completing *is* the money approval. Both are recorded in the audit diff.
7. **Completing a request does not create assets.** The `Asset.purchaseRequestId` link is filled when the equipment is registered (Phase 8's import / label-sheet work); Phase 5 stops at `COMPLETED`.
8. **Audit `entityType` is `"purchase-request"`** from the first write, with actions `create` · `update` · `submit` · `it-review` · `it-reject` · `request-info` · `cancel` · `complete` · `unit-update` · `comment`. `/audit` resolves them to `PR-####` links via `entityLabels`.
9. **List state:** `?state=` (the tab contract, parsed on its own — it is not a url-state facet), `?q=` free text over refNo + unit description, `?page=` at 50/page, fixed `updatedAt desc` ordering. No sortable headers this phase; adding them later doesn't break the contract.
10. **"Jump to unit 04" is derived, not faked:** `unitAnchor(reason)` matches `/unit\s*0*(\d+)/i` in the bounce-back reason and links `#unit-NN`; with no match the banner offers "Jump to units" (`#units`). The seeded reason ("Unit 02: quote exceeds…") exercises the match.
11. **Prisma `Decimal` never crosses into a client component.** Queries convert `unitPrice` to a `number` (and a preformatted string) server-side; `diffOf` already normalizes Decimals for the audit diff.

---

## File structure created/modified in this phase

```
src/lib/
  purchase-flow.ts (+ .test.ts)      (create — purchaseTransition, PURCHASE_ACTION_ROLES, note kinds; pure, TDD)
  purchases-list.ts (+ .test.ts)     (create — PURCHASE_TABS, parsePurchaseState, purchaseWhere, dwellLine; pure, TDD)
  purchase-thread.ts (+ .test.ts)    (create — NOTE_CHIP, bounceBack, unitAnchor, submittedVisits, stepperModel; pure, TDD)
  audit-list.ts                      (modify — add "purchase-request" to AUDIT_ENTITY_TYPES)
  activity.ts (+ .test.ts)           (modify — sentences for the purchase actions)
  workspaces.ts (+ .test.ts)         (modify — /purchases reachable from the IT workspace + the nav item)
src/server/modules/purchases/
  queries.ts                         (create — listPurchases, stateCounts, getPurchase, policyLoadouts)
  actions.ts                         (create — submit/it-review/it-reject/request-info/cancel/complete, addComment, saveUnit)
  draft-actions.ts                   (create — createDraft, saveDraft: the multi-unit editor's writer)
src/server/modules/audit/queries.ts  (modify — entityLabels resolves purchase-request → PR-#### link)
src/components/purchases/
  purchases-table.tsx                (create — server: rows + the dwell second line)
  purchase-stepper.tsx               (create — server: 4 stops, dashed "← sent back" return connector)
  bounce-back-banner.tsx             (create — server: red-left-bordered banner + jump links)
  note-thread.tsx                    (create — server thread + client composer island)
  request-actions.tsx                (create — client: per-role transition buttons + reason dialogs)
  unit-editor.tsx                    (create — client: IT slot editor / Finance unit editor per row)
  draft-form.tsx                     (create — client: multi-unit rows, autosave, add-from-policy)
src/app/(app)/purchases/
  page.tsx + loading.tsx             (create — list)
  new/page.tsx                       (create)
  [id]/page.tsx + not-found.tsx      (create — detail)
  [id]/edit/page.tsx                 (create — draft editing)
  activity/page.tsx                  (create — ActivityFeed scoped to purchase-request)
e2e/purchases.spec.ts                (create)
```

`purchase-flow.ts` is the ONLY place transition legality lives. `actions.ts` is the only writer of request state; `draft-actions.ts` is the only writer of a DRAFT's units; `unit-editor` writes through `saveUnit` and never touches request state.

---

### Task 1: Branch + the purchase state machine (TDD)

**Files:**
- Create: `src/lib/purchase-flow.ts`, `src/lib/purchase-flow.test.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-5-purchasing
```

- [ ] **Step 2: Write the failing tests** (`src/lib/purchase-flow.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  PURCHASE_ACTION_ROLES, PURCHASE_NOTE_KIND, REASON_REQUIRED, canAct, purchaseTransition,
  unitEditorMode, type PurchaseAction,
} from "./purchase-flow";

const ALL_STATES = ["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"] as const;
const ALL_ACTIONS: PurchaseAction[] = ["submit", "it-review", "it-reject", "request-info", "cancel", "complete"];

describe("purchaseTransition — brief §6.1, exact", () => {
  it("submit only from DRAFT, purchasing or admin", () => {
    expect(purchaseTransition("DRAFT", "submit", "purchasing_staff")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("DRAFT", "submit", "admin")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("DRAFT", "submit", "it_staff").ok).toBe(false);
    for (const s of ["SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"] as const) {
      expect(purchaseTransition(s, "submit", "purchasing_staff").ok).toBe(false);
    }
  });

  it("it-review only from SUBMITTED, IT or admin", () => {
    expect(purchaseTransition("SUBMITTED", "it-review", "it_staff")).toEqual({ ok: true, next: "IT_REVIEWED" });
    expect(purchaseTransition("SUBMITTED", "it-review", "admin")).toEqual({ ok: true, next: "IT_REVIEWED" });
    expect(purchaseTransition("SUBMITTED", "it-review", "finance_staff").ok).toBe(false);
    expect(purchaseTransition("DRAFT", "it-review", "it_staff").ok).toBe(false);
    expect(purchaseTransition("IT_REVIEWED", "it-review", "it_staff").ok).toBe(false);
  });

  it("it-reject sends SUBMITTED back to DRAFT — the loop, not a dead end", () => {
    expect(purchaseTransition("SUBMITTED", "it-reject", "it_staff")).toEqual({ ok: true, next: "DRAFT" });
    expect(purchaseTransition("IT_REVIEWED", "it-reject", "it_staff").ok).toBe(false);
    expect(purchaseTransition("SUBMITTED", "it-reject", "purchasing_staff").ok).toBe(false);
  });

  it("request-info sends IT_REVIEWED back to SUBMITTED — finance's bounce-back", () => {
    expect(purchaseTransition("IT_REVIEWED", "request-info", "finance_staff")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("IT_REVIEWED", "request-info", "admin")).toEqual({ ok: true, next: "SUBMITTED" });
    expect(purchaseTransition("SUBMITTED", "request-info", "finance_staff").ok).toBe(false);
    expect(purchaseTransition("IT_REVIEWED", "request-info", "it_staff").ok).toBe(false);
  });

  it("cancel from any non-terminal state; COMPLETED and CANCELLED are terminal", () => {
    for (const s of ["DRAFT", "SUBMITTED", "IT_REVIEWED"] as const) {
      expect(purchaseTransition(s, "cancel", "purchasing_staff")).toEqual({ ok: true, next: "CANCELLED" });
    }
    expect(purchaseTransition("COMPLETED", "cancel", "admin").ok).toBe(false);
    expect(purchaseTransition("CANCELLED", "cancel", "admin").ok).toBe(false);
    expect(purchaseTransition("DRAFT", "cancel", "finance_staff").ok).toBe(false);
  });

  it("complete only from IT_REVIEWED, finance or admin", () => {
    expect(purchaseTransition("IT_REVIEWED", "complete", "finance_staff")).toEqual({ ok: true, next: "COMPLETED" });
    expect(purchaseTransition("SUBMITTED", "complete", "finance_staff").ok).toBe(false);
    expect(purchaseTransition("IT_REVIEWED", "complete", "purchasing_staff").ok).toBe(false);
  });

  it("COMPLETED and CANCELLED refuse every action", () => {
    for (const action of ALL_ACTIONS) {
      expect(purchaseTransition("COMPLETED", action, "admin").ok).toBe(false);
      expect(purchaseTransition("CANCELLED", action, "admin").ok).toBe(false);
    }
  });

  it("viewer can do nothing at all", () => {
    for (const state of ALL_STATES) {
      for (const action of ALL_ACTIONS) {
        expect(purchaseTransition(state, action, "viewer").ok).toBe(false);
      }
    }
  });

  it("admin can do everything the state allows", () => {
    expect(purchaseTransition("DRAFT", "submit", "admin").ok).toBe(true);
    expect(purchaseTransition("SUBMITTED", "it-review", "admin").ok).toBe(true);
    expect(purchaseTransition("SUBMITTED", "it-reject", "admin").ok).toBe(true);
    expect(purchaseTransition("IT_REVIEWED", "request-info", "admin").ok).toBe(true);
    expect(purchaseTransition("IT_REVIEWED", "complete", "admin").ok).toBe(true);
    expect(purchaseTransition("DRAFT", "cancel", "admin").ok).toBe(true);
  });

  it("failures carry a human reason naming the role or the state", () => {
    const wrongRole = purchaseTransition("SUBMITTED", "it-review", "purchasing_staff");
    expect(wrongRole.ok).toBe(false);
    if (!wrongRole.ok) expect(wrongRole.error).toMatch(/IT/i);
    const wrongState = purchaseTransition("DRAFT", "complete", "finance_staff");
    expect(wrongState.ok).toBe(false);
    if (!wrongState.ok) expect(wrongState.error).toMatch(/DRAFT/);
  });
});

describe("canAct — the UI asks the same function the action does", () => {
  it("is true exactly when the transition would be allowed", () => {
    expect(canAct("DRAFT", "submit", "purchasing_staff")).toBe(true);
    expect(canAct("DRAFT", "submit", "viewer")).toBe(false);
    expect(canAct("IT_REVIEWED", "complete", "finance_staff")).toBe(true);
    expect(canAct("IT_REVIEWED", "complete", "it_staff")).toBe(false);
  });
});

describe("unitEditorMode", () => {
  it("gives IT the slot editor while SUBMITTED and finance the unit editor while IT_REVIEWED", () => {
    expect(unitEditorMode("SUBMITTED", "it_staff")).toBe("it");
    expect(unitEditorMode("SUBMITTED", "admin")).toBe("it");
    expect(unitEditorMode("IT_REVIEWED", "finance_staff")).toBe("finance");
    expect(unitEditorMode("IT_REVIEWED", "admin")).toBe("finance");
    expect(unitEditorMode("SUBMITTED", "finance_staff")).toBeNull();
    expect(unitEditorMode("DRAFT", "admin")).toBeNull();
    expect(unitEditorMode("COMPLETED", "finance_staff")).toBeNull();
    expect(unitEditorMode("SUBMITTED", "viewer")).toBeNull();
  });
});

describe("action metadata", () => {
  it("maps every action to its NoteKind", () => {
    expect(PURCHASE_NOTE_KIND).toEqual({
      submit: "SUBMIT", "it-review": "IT_REVIEW", "it-reject": "IT_REJECT",
      "request-info": "REQUEST_INFO", cancel: "CANCEL", complete: "COMPLETE",
    });
  });
  it("requires a reason exactly for the three bounce/withdraw actions", () => {
    expect([...REASON_REQUIRED].sort()).toEqual(["cancel", "it-reject", "request-info"]);
  });
  it("gives admin every action and viewer none", () => {
    for (const action of ALL_ACTIONS) {
      expect(PURCHASE_ACTION_ROLES[action]).toContain("admin");
      expect(PURCHASE_ACTION_ROLES[action]).not.toContain("viewer");
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- src/lib/purchase-flow.test.ts` — Expected: FAIL ("Failed to resolve import ./purchase-flow").

- [ ] **Step 4: Implement `src/lib/purchase-flow.ts`**

```ts
import type { NoteKind, PurchaseRequestState, Role } from "@prisma/client";

/**
 * Brief §6.1 verbatim: submit only from DRAFT · it-review only from SUBMITTED ·
 * it-reject SUBMITTED → DRAFT (reason appended, never overwritten) ·
 * request-info IT_REVIEWED → SUBMITTED (finance's bounce-back — nothing is
 * cleared) · cancel from any non-terminal state, reason required · complete
 * only from IT_REVIEWED. COMPLETED and CANCELLED are terminal.
 *
 * Pure. Server actions are the only callers, and they write through a
 * state-guarded updateMany so a concurrent transition conflicts instead of
 * silently winning. The UI asks canAct() so an affordance never renders for a
 * transition the server would refuse.
 */
export type PurchaseAction = "submit" | "it-review" | "it-reject" | "request-info" | "cancel" | "complete";

export type PurchaseTransitionResult =
  | { ok: true; next: PurchaseRequestState }
  | { ok: false; error: string };

/** Per-operation authorization (HANDOVER §6.5). admin is every party; viewer is none. */
export const PURCHASE_ACTION_ROLES: Record<PurchaseAction, Role[]> = {
  submit: ["purchasing_staff", "admin"],
  "it-review": ["it_staff", "admin"],
  "it-reject": ["it_staff", "admin"],
  "request-info": ["finance_staff", "admin"],
  cancel: ["purchasing_staff", "admin"],
  complete: ["finance_staff", "admin"],
};

/** Every transition appends a NoteEntry of this kind — the thread IS the history. */
export const PURCHASE_NOTE_KIND: Record<PurchaseAction, NoteKind> = {
  submit: "SUBMIT",
  "it-review": "IT_REVIEW",
  "it-reject": "IT_REJECT",
  "request-info": "REQUEST_INFO",
  cancel: "CANCEL",
  complete: "COMPLETE",
};

/** Bounce-backs and withdrawals must say why; the rest may. */
export const REASON_REQUIRED: readonly PurchaseAction[] = ["it-reject", "request-info", "cancel"];

/** Fallback thread text when an optional-reason transition carries none. */
export const CANONICAL_NOTE: Record<PurchaseAction, string> = {
  submit: "Submitted for IT review.",
  "it-review": "Specs reviewed — passed to finance.",
  "it-reject": "",
  "request-info": "",
  cancel: "",
  complete: "Approved and completed.",
};

const RULES: Record<PurchaseAction, { from: PurchaseRequestState[]; to: PurchaseRequestState; party: string }> = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", party: "Purchasing" },
  "it-review": { from: ["SUBMITTED"], to: "IT_REVIEWED", party: "IT" },
  "it-reject": { from: ["SUBMITTED"], to: "DRAFT", party: "IT" },
  "request-info": { from: ["IT_REVIEWED"], to: "SUBMITTED", party: "Finance" },
  cancel: { from: ["DRAFT", "SUBMITTED", "IT_REVIEWED"], to: "CANCELLED", party: "Purchasing" },
  complete: { from: ["IT_REVIEWED"], to: "COMPLETED", party: "Finance" },
};

export function purchaseTransition(
  state: PurchaseRequestState,
  action: PurchaseAction,
  role: Role,
): PurchaseTransitionResult {
  const rule = RULES[action];
  if (!PURCHASE_ACTION_ROLES[action].includes(role)) {
    return { ok: false, error: `Only ${rule.party} (or an admin) can ${action.replace("-", " ")} a request.` };
  }
  if (!rule.from.includes(state)) {
    return {
      ok: false,
      error: `A ${state} request can't be ${action === "submit" ? "submitted" : action.replace("-", " ") + "ed"} — it must be ${rule.from.join(" or ")}.`,
    };
  }
  return { ok: true, next: rule.to };
}

/** Render-layer twin: the button exists only when the transition would pass. */
export function canAct(state: PurchaseRequestState, action: PurchaseAction, role: Role): boolean {
  return purchaseTransition(state, action, role).ok;
}

/**
 * Which unit editor a person gets: the request's state × their role (README
 * 1j — both editors live inline on the same detail page). Pure, and it lives
 * here rather than beside the action because a `"use server"` module may only
 * export async functions.
 */
export function unitEditorMode(state: PurchaseRequestState, role: Role): "it" | "finance" | null {
  if (state === "SUBMITTED" && (role === "it_staff" || role === "admin")) return "it";
  if (state === "IT_REVIEWED" && (role === "finance_staff" || role === "admin")) return "finance";
  return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -- src/lib/purchase-flow.test.ts` — Expected: PASS (all assertions).

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/purchase-flow.ts src/lib/purchase-flow.test.ts
git commit -m "feat(purchases): purchaseTransition — brief §6.1 state machine, pure + TDD"
```

---

### Task 2: The list contract — tabs, filter, dwell line (TDD)

`?state=` is the tab contract the sidebar's "By status" links already target; `dwellLine` produces the second line under State that says *how long it's been there* (README `4d`) — the thing the enum can't tell you.

**Files:**
- Create: `src/lib/purchases-list.ts`, `src/lib/purchases-list.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/purchases-list.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  PURCHASE_PAGE_SIZE, PURCHASE_TABS, dwellLine, parsePurchaseState, purchaseWhere,
} from "./purchases-list";

const NOW = new Date("2026-08-17T09:00:00+08:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("parsePurchaseState — the ?state= tab contract", () => {
  it("accepts the five real states", () => {
    for (const s of ["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"] as const) {
      expect(parsePurchaseState(s)).toBe(s);
    }
  });
  it("treats anything else as All", () => {
    expect(parsePurchaseState(null)).toBeNull();
    expect(parsePurchaseState(undefined)).toBeNull();
    expect(parsePurchaseState("")).toBeNull();
    expect(parsePurchaseState("draft")).toBeNull();
    expect(parsePurchaseState("DELETED")).toBeNull();
  });
});

describe("PURCHASE_TABS", () => {
  it("leads with All and covers every state, hrefs writing ?state=", () => {
    expect(PURCHASE_TABS[0]).toEqual({ id: "ALL", label: "All", href: "/purchases" });
    expect(PURCHASE_TABS.map((t) => t.id)).toEqual([
      "ALL", "DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED",
    ]);
    expect(PURCHASE_TABS.find((t) => t.id === "IT_REVIEWED")!.href).toBe("/purchases?state=IT_REVIEWED");
  });
  it("labels the middle states by who is waiting, matching the sidebar", () => {
    const label = (id: string) => PURCHASE_TABS.find((t) => t.id === id)!.label;
    expect(label("SUBMITTED")).toBe("Awaiting IT");
    expect(label("IT_REVIEWED")).toBe("Awaiting finance");
  });
});

describe("purchaseWhere", () => {
  it("is empty for All with no search", () => {
    expect(purchaseWhere(null, "")).toEqual({});
  });
  it("filters by state", () => {
    expect(purchaseWhere("DRAFT", "")).toEqual({ state: "DRAFT" });
  });
  it("searches refNo and unit descriptions (contains — the sanctioned use)", () => {
    expect(purchaseWhere(null, "monitor")).toEqual({
      OR: [
        { refNo: { contains: "monitor", mode: "insensitive" } },
        { units: { some: { description: { contains: "monitor", mode: "insensitive" } } } },
      ],
    });
  });
  it("combines state and search", () => {
    const where = purchaseWhere("SUBMITTED", "PR-0198");
    expect(where.state).toBe("SUBMITTED");
    expect(where.OR).toHaveLength(2);
  });
  it("pages at 50", () => {
    expect(PURCHASE_PAGE_SIZE).toBe(50);
  });
});

describe("dwellLine — how long it's been there, not derivable from the enum", () => {
  const row = (over: Partial<Parameters<typeof dwellLine>[0]> = {}) => ({
    state: "SUBMITTED" as const, updatedAt: daysAgo(2), submittedAt: daysAgo(2),
    reviewedAt: null, completedAt: null, cancelledAt: null, bounced: false, ...over,
  });

  it("names the bounce-back before anything else", () => {
    expect(dwellLine(row({ state: "SUBMITTED", bounced: true, updatedAt: daysAgo(1) }), NOW))
      .toBe("back from finance · 1 d");
    expect(dwellLine(row({ state: "DRAFT", bounced: true, updatedAt: daysAgo(3) }), NOW))
      .toBe("sent back by IT · 3 d");
  });
  it("says who is waiting, and for how long", () => {
    expect(dwellLine(row({ submittedAt: daysAgo(2) }), NOW)).toBe("awaiting IT · 2 d");
    expect(dwellLine(row({ state: "IT_REVIEWED", reviewedAt: daysAgo(5) }), NOW)).toBe("awaiting finance · 5 d");
  });
  it("reads today for anything under a day", () => {
    expect(dwellLine(row({ submittedAt: new Date(NOW.getTime() - 3_600_000) }), NOW)).toBe("awaiting IT · today");
  });
  it("closes out terminal rows", () => {
    expect(dwellLine(row({ state: "COMPLETED", completedAt: daysAgo(30) }), NOW)).toBe("completed 30 d ago");
    expect(dwellLine(row({ state: "CANCELLED", cancelledAt: daysAgo(48) }), NOW)).toBe("cancelled 48 d ago");
  });
  it("describes an untouched draft by its last edit", () => {
    expect(dwellLine(row({ state: "DRAFT", submittedAt: null, updatedAt: daysAgo(4) }), NOW))
      .toBe("draft · edited 4 d ago");
  });
  it("falls back to updatedAt when a stamp is missing rather than printing NaN", () => {
    expect(dwellLine(row({ state: "IT_REVIEWED", reviewedAt: null, updatedAt: daysAgo(6) }), NOW))
      .toBe("awaiting finance · 6 d");
  });
  it("never says 'today ago'", () => {
    expect(dwellLine(row({ state: "DRAFT", submittedAt: null, updatedAt: NOW }), NOW)).toBe("draft · edited today");
    expect(dwellLine(row({ state: "COMPLETED", completedAt: NOW }), NOW)).toBe("completed today");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/purchases-list.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/purchases-list.ts`**

```ts
import type { Prisma, PurchaseRequestState } from "@prisma/client";

/**
 * `?state=` is the tab contract (HANDOVER §6.4): the sidebar's "By status"
 * links target it and navIsActive already highlights them, so the tab is
 * parsed on its own rather than as a url-state facet (facets are comma-joined
 * multi-selects; this is a single value that names a nav destination).
 */
export const PURCHASE_STATES = [
  "DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED",
] as const satisfies readonly PurchaseRequestState[];

export const PURCHASE_TABS = [
  { id: "ALL", label: "All", href: "/purchases" },
  { id: "DRAFT", label: "Drafts", href: "/purchases?state=DRAFT" },
  { id: "SUBMITTED", label: "Awaiting IT", href: "/purchases?state=SUBMITTED" },
  { id: "IT_REVIEWED", label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED" },
  { id: "COMPLETED", label: "Completed", href: "/purchases?state=COMPLETED" },
  { id: "CANCELLED", label: "Cancelled", href: "/purchases?state=CANCELLED" },
] as const;

export type PurchaseTabId = (typeof PURCHASE_TABS)[number]["id"];

export const PURCHASE_PAGE_SIZE = 50;

export function parsePurchaseState(raw: string | null | undefined): PurchaseRequestState | null {
  return (PURCHASE_STATES as readonly string[]).includes(raw ?? "")
    ? (raw as PurchaseRequestState)
    : null;
}

export function purchaseWhere(
  state: PurchaseRequestState | null,
  q: string,
): Prisma.PurchaseRequestWhereInput {
  const where: Prisma.PurchaseRequestWhereInput = {};
  if (state) where.state = state;
  if (q) {
    // contains-search with insensitive mode is the sanctioned use; the
    // ILIKE-wildcard hazard applies to identity/equals lookups only.
    where.OR = [
      { refNo: { contains: q, mode: "insensitive" } },
      { units: { some: { description: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

const DAY_MS = 86_400_000;

/** "today" under a day, "N d" after — the waiting-on form. */
function since(from: Date | null, fallback: Date, now: Date): string {
  const d = from ?? fallback;
  const days = Math.floor((now.getTime() - d.getTime()) / DAY_MS);
  return days < 1 ? "today" : `${days} d`;
}

/** Past-tense form: "today" must not become "today ago". */
function ago(from: Date | null, fallback: Date, now: Date): string {
  const label = since(from, fallback, now);
  return label === "today" ? "today" : `${label} ago`;
}

export interface DwellRow {
  state: PurchaseRequestState;
  updatedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** derived from the thread (bounceBack !== null) — not a column */
  bounced: boolean;
}

/**
 * README 4d: the second line under State. "back from finance" is the fact the
 * enum can't carry — SUBMITTED reached forwards and SUBMITTED reached
 * backwards are the same value and a completely different situation.
 */
export function dwellLine(row: DwellRow, now: Date = new Date()): string {
  const waiting = (d: Date | null) => since(d, row.updatedAt, now);
  switch (row.state) {
    case "DRAFT":
      return row.bounced
        ? `sent back by IT · ${waiting(row.updatedAt)}`
        : `draft · edited ${ago(row.updatedAt, row.updatedAt, now)}`;
    case "SUBMITTED":
      return row.bounced
        ? `back from finance · ${waiting(row.updatedAt)}`
        : `awaiting IT · ${waiting(row.submittedAt)}`;
    case "IT_REVIEWED":
      return `awaiting finance · ${waiting(row.reviewedAt)}`;
    case "COMPLETED":
      return `completed ${ago(row.completedAt, row.updatedAt, now)}`;
    case "CANCELLED":
      return `cancelled ${ago(row.cancelledAt, row.updatedAt, now)}`;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/purchases-list.test.ts` — Expected: PASS (all 12 assertions, including `never says 'today ago'`).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/purchases-list.ts src/lib/purchases-list.test.ts
git commit -m "feat(purchases): ?state= tab contract, filter builder and the dwell line"
```

---

### Task 3: The thread model — bounce-back, stepper, unit anchor (TDD)

This is the design problem (README `1j`) reduced to pure functions: the banner's content, the stepper's shape including the return connector, and the `NOW · 2nd time` mark all derive from the append-only thread. No new columns.

**Files:**
- Create: `src/lib/purchase-thread.ts`, `src/lib/purchase-thread.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/purchase-thread.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import type { NoteKind } from "@prisma/client";
import {
  NOTE_CHIP, bounceBack, stepperModel, submittedVisits, unitAnchor, type ThreadNote,
} from "./purchase-thread";

let seq = 0;
const note = (kind: NoteKind, author: string, text = "…", dayOffset = 0): ThreadNote => ({
  id: `n${seq++}`, kind, author, text, at: new Date(2026, 7, 10 + dayOffset),
});

// The seeded PR-0198 thread, verbatim in shape.
const BOUNCED = [
  note("SUBMIT", "P. Reyes", "Batch for the July hires.", 0),
  note("IT_REVIEW", "J. Sarmiento", "Specs confirmed, docks need wattage check.", 2),
  note("REQUEST_INFO", "M. Cruz", "Unit 02: quote exceeds standing rate — attach vendor quote.", 3),
];

describe("NOTE_CHIP", () => {
  it("names every kind, and both bounce kinds read as SENT BACK", () => {
    expect(NOTE_CHIP.SUBMIT).toBe("SUBMITTED");
    expect(NOTE_CHIP.IT_REVIEW).toBe("IT REVIEW");
    expect(NOTE_CHIP.IT_REJECT).toBe("SENT BACK");
    expect(NOTE_CHIP.REQUEST_INFO).toBe("SENT BACK");
    expect(NOTE_CHIP.CANCEL).toBe("CANCELLED");
    expect(NOTE_CHIP.COMPLETE).toBe("COMPLETED");
    expect(NOTE_CHIP.COMMENT).toBe("COMMENT");
  });
});

describe("bounceBack", () => {
  it("detects finance's bounce: SUBMITTED with REQUEST_INFO newest", () => {
    const b = bounceBack("SUBMITTED", BOUNCED);
    expect(b).not.toBeNull();
    expect(b!.by).toBe("M. Cruz");
    expect(b!.from).toBe("finance");
    expect(b!.reason).toBe("Unit 02: quote exceeds standing rate — attach vendor quote.");
    expect(b!.transition).toBe("IT_REVIEWED → SUBMITTED · nothing was cleared");
  });

  it("detects IT's rejection: DRAFT with IT_REJECT newest", () => {
    const b = bounceBack("DRAFT", [
      note("SUBMIT", "P. Reyes", "First pass", 0),
      note("IT_REJECT", "J. Sarmiento", "Specs are too vague to price.", 1),
    ]);
    expect(b!.from).toBe("it");
    expect(b!.transition).toBe("SUBMITTED → DRAFT · nothing was cleared");
  });

  it("ignores COMMENT notes posted after the bounce", () => {
    const b = bounceBack("SUBMITTED", [...BOUNCED, note("COMMENT", "P. Reyes", "On it.", 4)]);
    expect(b!.by).toBe("M. Cruz");
  });

  it("is null for a forward SUBMITTED, a fresh draft, and terminal states", () => {
    expect(bounceBack("SUBMITTED", [note("SUBMIT", "P. Reyes", "Batch", 0)])).toBeNull();
    expect(bounceBack("DRAFT", [])).toBeNull();
    expect(bounceBack("IT_REVIEWED", BOUNCED)).toBeNull();
    expect(bounceBack("COMPLETED", BOUNCED)).toBeNull();
    expect(bounceBack("CANCELLED", BOUNCED)).toBeNull();
  });

  it("is null once the request moved on from the bounce", () => {
    expect(bounceBack("SUBMITTED", [...BOUNCED, note("SUBMIT", "P. Reyes", "Quote attached.", 5)])).toBeNull();
  });
});

describe("unitAnchor — 'Jump to unit 04' is derived, never faked", () => {
  it("finds a unit number in the reason and zero-pads the label", () => {
    expect(unitAnchor("Unit 02: quote exceeds standing rate")).toEqual({ anchor: "#unit-2", label: "Jump to unit 02" });
    expect(unitAnchor("unit 4 is wrong")).toEqual({ anchor: "#unit-4", label: "Jump to unit 04" });
  });
  it("falls back to the units section when no number is named", () => {
    expect(unitAnchor("Please attach the vendor quote")).toEqual({ anchor: "#units", label: "Jump to units" });
  });
});

describe("submittedVisits", () => {
  it("counts arrivals at SUBMITTED — forwards and backwards", () => {
    expect(submittedVisits([])).toBe(0);
    expect(submittedVisits([note("SUBMIT", "P", "x", 0)])).toBe(1);
    expect(submittedVisits(BOUNCED)).toBe(2); // one SUBMIT + one REQUEST_INFO
  });
  it("counts a resubmission after an IT rejection", () => {
    expect(submittedVisits([
      note("SUBMIT", "P", "x", 0), note("IT_REJECT", "J", "y", 1), note("SUBMIT", "P", "z", 2),
    ])).toBe(2);
  });
});

describe("stepperModel", () => {
  it("walks the four stops with the current one marked NOW", () => {
    const m = stepperModel("SUBMITTED", [note("SUBMIT", "P", "x", 0)]);
    expect(m.stops.map((s) => s.state)).toEqual(["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED"]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(m.stops[1].note).toBe("NOW");
    expect(m.sentBack).toBeNull();
    expect(m.cancelled).toBe(false);
  });

  it("marks the bounced stop NOW · 2nd time and flags the return connector", () => {
    const m = stepperModel("SUBMITTED", BOUNCED);
    expect(m.stops[1].status).toBe("current");
    expect(m.stops[1].note).toBe("NOW · 2nd time");
    expect(m.sentBack).toBe("finance");
  });

  it("labels an IT rejection's return path", () => {
    const m = stepperModel("DRAFT", [note("SUBMIT", "P", "x", 0), note("IT_REJECT", "J", "y", 1)]);
    expect(m.sentBack).toBe("it");
    expect(m.stops[0].status).toBe("current");
  });

  it("completes every stop for COMPLETED", () => {
    const m = stepperModel("COMPLETED", [note("SUBMIT", "P", "x", 0), note("IT_REVIEW", "J", "y", 1)]);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "done", "done", "current"]);
  });

  it("freezes a cancelled request at how far it actually got", () => {
    const m = stepperModel("CANCELLED", [note("SUBMIT", "P", "x", 0), note("CANCEL", "P", "duplicate", 1)]);
    expect(m.cancelled).toBe(true);
    expect(m.stops.map((s) => s.status)).toEqual(["done", "done", "upcoming", "upcoming"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/purchase-thread.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/purchase-thread.ts`**

```ts
import type { NoteKind, PurchaseRequestState } from "@prisma/client";

/**
 * The bounce-back is the design problem (README 1j). Everything the banner and
 * the stepper need is DERIVED from the append-only thread — there is no
 * "bounced" column to drift out of sync with the notes.
 */
export interface ThreadNote {
  id: string;
  kind: NoteKind;
  text: string;
  author: string;
  at: Date;
}

export const NOTE_CHIP: Record<NoteKind, string> = {
  COMMENT: "COMMENT",
  SUBMIT: "SUBMITTED",
  IT_REVIEW: "IT REVIEW",
  IT_REJECT: "SENT BACK",
  REQUEST_INFO: "SENT BACK",
  CANCEL: "CANCELLED",
  COMPLETE: "COMPLETED",
};

export interface BounceBack {
  by: string;
  at: Date;
  reason: string;
  /** who sent it back — finance bounced IT_REVIEWED, IT rejected SUBMITTED */
  from: "finance" | "it";
  /** the honest transition line: nothing was cleared */
  transition: string;
}

/** Notes arrive oldest-first; COMMENT never changes state, so it never ends a bounce. */
function lastFlowNote(notes: ThreadNote[]): ThreadNote | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    if (notes[i].kind !== "COMMENT") return notes[i];
  }
  return null;
}

export function bounceBack(state: PurchaseRequestState, notes: ThreadNote[]): BounceBack | null {
  const last = lastFlowNote(notes);
  if (!last) return null;
  if (state === "SUBMITTED" && last.kind === "REQUEST_INFO") {
    return {
      by: last.author, at: last.at, reason: last.text, from: "finance",
      transition: "IT_REVIEWED → SUBMITTED · nothing was cleared",
    };
  }
  if (state === "DRAFT" && last.kind === "IT_REJECT") {
    return {
      by: last.author, at: last.at, reason: last.text, from: "it",
      transition: "SUBMITTED → DRAFT · nothing was cleared",
    };
  }
  return null;
}

/** "Jump to unit 04" when the reason names one, the units section otherwise. */
export function unitAnchor(reason: string): { anchor: string; label: string } {
  const m = /unit\s*0*(\d+)/i.exec(reason);
  if (!m) return { anchor: "#units", label: "Jump to units" };
  return { anchor: `#unit-${m[1]}`, label: `Jump to unit ${m[1].padStart(2, "0")}` };
}

/** Every arrival at SUBMITTED: one per submit, one per finance bounce-back. */
export function submittedVisits(notes: ThreadNote[]): number {
  return notes.filter((n) => n.kind === "SUBMIT" || n.kind === "REQUEST_INFO").length;
}

export type StopStatus = "done" | "current" | "upcoming";

export interface StepperStop {
  state: PurchaseRequestState;
  label: string;
  status: StopStatus;
  note?: string;
}

export interface Stepper {
  stops: StepperStop[];
  /** renders the dashed amber/red "← sent back" connector */
  sentBack: "finance" | "it" | null;
  cancelled: boolean;
}

const STOPS: Array<{ state: PurchaseRequestState; label: string }> = [
  { state: "DRAFT", label: "Draft" },
  { state: "SUBMITTED", label: "Submitted" },
  { state: "IT_REVIEWED", label: "IT reviewed" },
  { state: "COMPLETED", label: "Completed" },
];

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** How far a cancelled request actually got, read off the thread. */
function reachedIndex(notes: ThreadNote[]): number {
  let reached = 0;
  for (const n of notes) {
    if (n.kind === "SUBMIT" && reached < 1) reached = 1;
    if (n.kind === "IT_REVIEW" && reached < 2) reached = 2;
    if (n.kind === "COMPLETE") reached = 3;
  }
  return reached;
}

export function stepperModel(state: PurchaseRequestState, notes: ThreadNote[]): Stepper {
  const bounce = bounceBack(state, notes);
  const cancelled = state === "CANCELLED";
  const currentIndex = cancelled ? -1 : STOPS.findIndex((s) => s.state === state);
  const frozenAt = cancelled ? reachedIndex(notes) : -1;
  const visits = submittedVisits(notes);

  const stops = STOPS.map((stop, i): StepperStop => {
    if (cancelled) return { ...stop, status: i <= frozenAt ? "done" : "upcoming" };
    if (i < currentIndex) return { ...stop, status: "done" };
    if (i > currentIndex) return { ...stop, status: "upcoming" };
    const repeat = stop.state === "SUBMITTED" && visits > 1 ? ` · ${ordinal(visits)} time` : "";
    return { ...stop, status: "current", note: `NOW${repeat}` };
  });

  return { stops, sentBack: bounce?.from ?? null, cancelled };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/purchase-thread.test.ts` — Expected: PASS.

- [ ] **Step 5: Run the whole unit suite** (nothing above may regress the 185 existing tests)

Run: `npm run test` — Expected: PASS.

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/purchase-thread.ts src/lib/purchase-thread.test.ts
git commit -m "feat(purchases): bounce-back, stepper model and unit anchor derived from the thread"
```

---

### Task 4: Audit plumbing — `purchase-request` becomes a first-class entity

Entry criterion #7: write purchase audit rows with `entityType: "purchase-request"` **from the start**, and teach `/audit` and the activity feeds to resolve them.

**Files:**
- Modify: `src/lib/audit-list.ts:4-6`
- Modify: `src/lib/activity.ts:15-32`, `src/lib/activity.test.ts`
- Modify: `src/server/modules/audit/queries.ts:29-42`
- Modify: `src/components/patterns/activity-feed.tsx:35-41`

- [ ] **Step 1: Add the entity type** (`src/lib/audit-list.ts`)

Replace the `AUDIT_ENTITY_TYPES` constant with:

```ts
export const AUDIT_ENTITY_TYPES = [
  "asset", "employee", "approval", "purchase-request", "user",
  "asset-category", "asset-type", "department",
] as const;
```

- [ ] **Step 2: Write the failing sentence tests** (append inside the existing `describe` in `src/lib/activity.test.ts`)

```ts
  it("names the purchase transitions in the language of the handoff", () => {
    const pr = { ...base, actorLabel: "P. Reyes", entityLabel: "PR-0198", diff: null as unknown };
    expect(auditSentence({ ...pr, action: "submit" })).toBe("P. Reyes submitted PR-0198 for IT review");
    expect(auditSentence({ ...pr, action: "it-review" })).toBe("P. Reyes marked PR-0198 IT-reviewed");
    expect(auditSentence({ ...pr, action: "it-reject" })).toBe("P. Reyes sent PR-0198 back to purchasing");
    expect(auditSentence({ ...pr, action: "request-info" })).toBe("P. Reyes sent PR-0198 back for more information");
    expect(auditSentence({ ...pr, action: "cancel" })).toBe("P. Reyes cancelled PR-0198");
    expect(auditSentence({ ...pr, action: "complete" })).toBe("P. Reyes completed PR-0198");
    expect(auditSentence({ ...pr, action: "comment" })).toBe("P. Reyes commented on PR-0198");
    expect(auditSentence({ ...pr, action: "unit-update" })).toBe("P. Reyes updated a unit on PR-0198");
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- src/lib/activity.test.ts` — Expected: FAIL (the default branch renders "P. Reyes submit PR-0198").

- [ ] **Step 4: Implement the sentences** (`src/lib/activity.ts`)

Add these cases to the `switch` in `auditSentence`, immediately before `default:`:

```ts
    case "submit":
      return `${entry.actorLabel} submitted ${entry.entityLabel} for IT review`;
    case "it-review":
      return `${entry.actorLabel} marked ${entry.entityLabel} IT-reviewed`;
    case "it-reject":
      return `${entry.actorLabel} sent ${entry.entityLabel} back to purchasing`;
    case "request-info":
      return `${entry.actorLabel} sent ${entry.entityLabel} back for more information`;
    case "cancel":
      return `${entry.actorLabel} cancelled ${entry.entityLabel}`;
    case "complete":
      return `${entry.actorLabel} completed ${entry.entityLabel}`;
    case "comment":
      return `${entry.actorLabel} commented on ${entry.entityLabel}`;
    case "unit-update":
      return `${entry.actorLabel} updated a unit on ${entry.entityLabel}`;
```

- [ ] **Step 5: Resolve refNo labels and links** (`src/server/modules/audit/queries.ts`)

In `entityLabels`, replace the `const [assets, employees, approvals] = await Promise.all([…]);` block **and** the three `for` loops that follow it with:

```ts
  const [assets, employees, approvals, purchases] = await Promise.all([
    byType.has("asset")
      ? prisma.asset.findMany({ where: { id: { in: [...byType.get("asset")!] } }, select: { id: true, tag: true } })
      : [],
    byType.has("employee")
      ? prisma.employee.findMany({ where: { id: { in: [...byType.get("employee")!] } }, select: { id: true, name: true } })
      : [],
    byType.has("approval")
      ? prisma.approval.findMany({ where: { id: { in: [...byType.get("approval")!] } }, select: { id: true, refNo: true } })
      : [],
    byType.has("purchase-request")
      ? prisma.purchaseRequest.findMany({
          where: { id: { in: [...byType.get("purchase-request")!] } },
          select: { id: true, refNo: true },
        })
      : [],
  ]);
  for (const a of assets) map.set(`asset:${a.id}`, { label: a.tag, href: `/inventory/${a.id}` });
  for (const e of employees) map.set(`employee:${e.id}`, { label: e.name, href: `/employees/${e.id}` });
  for (const a of approvals) map.set(`approval:${a.id}`, { label: a.refNo, href: `/approvals/${a.id}` });
  for (const p of purchases) map.set(`purchase-request:${p.id}`, { label: p.refNo, href: `/purchases/${p.id}` });
```

- [ ] **Step 6: Give the new actions honest status dots** (`src/components/patterns/activity-feed.tsx`)

Replace the body of `actionDot` with:

```ts
export function actionDot(action: string): string {
  if (action === "SECRET_READ") return "TEMPORARY"; // attention
  if (action === "it-reject" || action === "request-info") return "PENDING"; // attention: it came back
  if (action === "cancel") return "CANCELLED"; // closed
  if (action === "complete") return "COMPLETED"; // settled
  if (action === "submit" || action === "it-review") return "SUBMITTED"; // inflight
  if (action.includes("failed") || action === "delete") return "DEFECTIVE"; // fault
  if (action === "create" || action.includes("executed")) return "DEPLOYED"; // settled
  if (action.includes("requested") || action === "claim") return "SUBMITTED"; // inflight
  return "SPARE"; // neutral
}
```

- [ ] **Step 7: Run the tests, typecheck, lint**

Run: `npm run test -- src/lib/activity.test.ts src/lib/audit-list.test.ts && npx tsc --noEmit && npm run lint` — Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/audit-list.ts src/lib/activity.ts src/lib/activity.test.ts src/server/modules/audit/queries.ts src/components/patterns/activity-feed.tsx
git commit -m "feat(audit): purchase-request entity type, sentences, refNo links and dots"
```

---

### Task 5: Let IT reach the requests it reviews

Scope decision #1. Without this, `it-review`/`it-reject` — the actions `it_staff` owns — are unreachable for `it_staff`, because `/purchases` is gated to the purchasing + finance workspaces.

**Files:**
- Modify: `src/lib/workspaces.ts` (IT nav section + the `/purchases` PATH_RULES entry)
- Modify: `src/lib/workspaces.test.ts`

- [ ] **Step 1: Update the test expectations** (`src/lib/workspaces.test.ts`)

In the `pathAllowedForRole` `cases` array, replace the two lines under the `// purchases shared purchasing + finance` comment with:

```ts
    // purchases: purchasing + finance own it; IT joins because brief §6.1 makes
    // IT the second party (it-review / it-reject). Page-level requireRole still
    // keeps it_staff out of the purchasing-only create form.
    ["/purchases", "finance_staff", true],
    ["/purchases", "it_staff", true],
    ["/purchases/new", "it_staff", true],
    ["/purchases", "viewer", true],
    ["/purchases/abc", "it_staff", true],
```

Add `WORKSPACE_NAV` to the existing `import { … } from "./workspaces";` at the top of the file, then append this describe block at the end:

```ts
describe("IT workspace nav", () => {
  it("carries a Purchase reviews entry pointing at the awaiting-IT filter", () => {
    const tracking = WORKSPACE_NAV.it.find((s) => s.heading === "Tracking")!;
    expect(tracking.items.map((i) => i.href)).toContain("/purchases?state=SUBMITTED");
  });
  it("highlights it only when the state param matches", () => {
    expect(navIsActive("/purchases?state=SUBMITTED", "/purchases", new URLSearchParams("state=SUBMITTED"))).toBe(true);
    expect(navIsActive("/purchases?state=SUBMITTED", "/purchases", new URLSearchParams("state=DRAFT"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/workspaces.test.ts` — Expected: FAIL (`/purchases` for `it_staff` is false; the nav item doesn't exist).

- [ ] **Step 3: Widen the path rule** (`src/lib/workspaces.ts`)

Replace the `/purchases` entry inside `PATH_RULES` with:

```ts
  // Brief §6.1 is a three-party handoff: purchasing drafts, IT specs it,
  // finance approves the money. IT therefore needs the path its own
  // it-review/it-reject actions live on; page-level requireRole keeps
  // it_staff out of /purchases/new, and viewer sees it read-only.
  { test: /^\/purchases(\/|$)/, workspaces: ["purchasing", "finance", "it"] },
```

- [ ] **Step 4: Add the IT nav item** (`src/lib/workspaces.ts`)

In `WORKSPACE_NAV.it`, replace the whole "Tracking" section with:

```ts
    {
      heading: "Tracking",
      items: [
        { label: "Inventory", href: "/inventory" },
        { label: "Employees", href: "/employees" },
        { label: "Approvals", href: "/approvals", badge: "approvals" },
        { label: "Purchase reviews", href: "/purchases?state=SUBMITTED", roles: ["admin", "it_staff"] },
        { label: "Audit log", href: "/audit" },
      ],
    },
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -- src/lib/workspaces.test.ts` — Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/workspaces.ts src/lib/workspaces.test.ts
git commit -m "feat(shell): IT workspace reaches /purchases — the review step needs a door"
```

---

### Task 6: Purchase queries

**Files:**
- Create: `src/server/modules/purchases/queries.ts`

- [ ] **Step 1: Write the module**

```ts
import type { PurchaseRequestState, PurchaseUnitState } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtMoney } from "@/lib/format";
import { PURCHASE_PAGE_SIZE, dwellLine, purchaseWhere } from "@/lib/purchases-list";
import { bounceBack, type ThreadNote } from "@/lib/purchase-thread";

export interface PurchaseListRow {
  id: string;
  refNo: string;
  state: PurchaseRequestState;
  requester: string;
  unitCount: number;
  totalQty: number;
  total: string;
  /** README 4d second line — "back from finance", "awaiting IT · 2 d" */
  dwell: string;
}

export interface PurchaseUnitView {
  id: string;
  /** 1-based position — the "unit 04" a bounce-back reason names */
  index: number;
  description: string;
  specs: string | null;
  qty: number;
  /** number, never a Prisma.Decimal: this crosses into client components */
  unitPrice: number | null;
  price: string;
  lineTotal: string;
  state: PurchaseUnitState;
  itSlotNotes: string | null;
  financeNotes: string | null;
}

export interface PurchaseDetail {
  id: string;
  refNo: string;
  state: PurchaseRequestState;
  requester: string;
  requestedById: string;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  units: PurchaseUnitView[];
  notes: ThreadNote[];
  total: string;
  totalValue: number;
}

const money = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export async function listPurchases(
  state: PurchaseRequestState | null,
  q: string,
  page: number,
): Promise<{ rows: PurchaseListRow[]; total: number; page: number; pageCount: number }> {
  const where = purchaseWhere(state, q);
  const total = await prisma.purchaseRequest.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PURCHASE_PAGE_SIZE));
  // an unbounded ?page= must not become a huge OFFSET
  const safePage = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.purchaseRequest.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (safePage - 1) * PURCHASE_PAGE_SIZE,
    take: PURCHASE_PAGE_SIZE,
    select: {
      id: true, refNo: true, state: true, updatedAt: true, submittedAt: true,
      reviewedAt: true, completedAt: true, cancelledAt: true,
      requestedBy: { select: { name: true } },
      units: { select: { qty: true, unitPrice: true } },
      // the newest state-carrying note decides "did this come back?" —
      // bounceBack() reads the last non-COMMENT note, so one row is enough
      notes: {
        where: { kind: { not: "COMMENT" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, kind: true, text: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  });

  const now = new Date();
  return {
    total,
    page: safePage,
    pageCount,
    rows: rows.map((r): PurchaseListRow => {
      const last: ThreadNote[] = r.notes.map((n) => ({
        id: n.id, kind: n.kind, text: n.text, author: n.author.name, at: n.createdAt,
      }));
      const value = r.units.reduce((sum, u) => sum + u.qty * money(u.unitPrice), 0);
      return {
        id: r.id,
        refNo: r.refNo,
        state: r.state,
        requester: r.requestedBy.name,
        unitCount: r.units.length,
        totalQty: r.units.reduce((sum, u) => sum + u.qty, 0),
        total: fmtMoney(value),
        dwell: dwellLine(
          {
            state: r.state, updatedAt: r.updatedAt, submittedAt: r.submittedAt,
            reviewedAt: r.reviewedAt, completedAt: r.completedAt, cancelledAt: r.cancelledAt,
            bounced: bounceBack(r.state, last) !== null,
          },
          now,
        ),
      };
    }),
  };
}

/** Tab counts — one grouped query, plus the All total. */
export async function stateCounts(): Promise<Record<string, number>> {
  const groups = await prisma.purchaseRequest.groupBy({ by: ["state"], _count: { _all: true } });
  const counts: Record<string, number> = {
    ALL: 0, DRAFT: 0, SUBMITTED: 0, IT_REVIEWED: 0, COMPLETED: 0, CANCELLED: 0,
  };
  for (const g of groups) {
    counts[g.state] = g._count._all;
    counts.ALL += g._count._all;
  }
  return counts;
}

export async function getPurchase(id: string): Promise<PurchaseDetail | null> {
  const r = await prisma.purchaseRequest.findUnique({
    where: { id },
    select: {
      id: true, refNo: true, state: true, createdAt: true, submittedAt: true, reviewedAt: true,
      completedAt: true, cancelledAt: true, cancelReason: true, requestedById: true,
      requestedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      units: { orderBy: { createdAt: "asc" } },
      notes: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, text: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  });
  if (!r) return null;

  const units = r.units.map((u, i): PurchaseUnitView => {
    const price = money(u.unitPrice);
    return {
      id: u.id,
      index: i + 1,
      description: u.description,
      specs: u.specs,
      qty: u.qty,
      unitPrice: u.unitPrice === null ? null : price,
      price: u.unitPrice === null ? "—" : fmtMoney(price),
      lineTotal: u.unitPrice === null ? "—" : fmtMoney(price * u.qty),
      state: u.state,
      itSlotNotes: u.itSlotNotes,
      financeNotes: u.financeNotes,
    };
  });
  const totalValue = units.reduce((sum, u) => sum + (u.unitPrice ?? 0) * u.qty, 0);

  return {
    id: r.id,
    refNo: r.refNo,
    state: r.state,
    requester: r.requestedBy.name,
    requestedById: r.requestedById,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy?.name ?? null,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    units,
    notes: r.notes.map((n) => ({
      id: n.id, kind: n.kind, text: n.text, author: n.author.name, at: n.createdAt,
    })),
    total: fmtMoney(totalValue),
    totalValue,
  };
}

export interface PolicyLoadout {
  id: string;
  name: string;
  slots: Array<{ name: string; type: string | null; required: boolean }>;
}

/** "Add from a policy loadout" (README 3f) — the standard kit as draft rows. */
export async function policyLoadouts(): Promise<PolicyLoadout[]> {
  const policies = await prisma.equipmentPolicy.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true,
      slots: {
        orderBy: { name: "asc" },
        select: { name: true, required: true, assetType: { select: { name: true } } },
      },
    },
  });
  return policies.map((p) => ({
    id: p.id,
    name: p.name,
    slots: p.slots.map((s) => ({ name: s.name, type: s.assetType?.name ?? null, required: s.required })),
  }));
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/purchases/queries.ts
git commit -m "feat(purchases): list, detail and policy-loadout queries"
```

---

### Task 7: Transitions, notes and the unit editors (server actions)

Entry criteria #1, #2, #5, #6. Every transition: `actionRole` (per operation) → `checkRate` → zod → **transaction** (state-guarded `updateMany` + unit side effects + **NoteEntry append** + `writeAudit`) → `revalidatePath` → typed result. No Approval rows, no Jobs.

**Files:**
- Create: `src/server/modules/purchases/actions.ts`

- [ ] **Step 1: Write the module**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import {
  CANONICAL_NOTE, PURCHASE_ACTION_ROLES, PURCHASE_NOTE_KIND, REASON_REQUIRED,
  purchaseTransition, unitEditorMode, type PurchaseAction,
} from "@/lib/purchase-flow";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

// not exported: a "use server" module's runtime exports must all be async
// functions, and Phase 4's approvals actions set the same precedent
interface Acted {
  refNo: string;
  state: string;
}

const transitionSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

function revalidate(id: string) {
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  revalidatePath("/purchases/activity");
  revalidatePath("/audit");
}

/**
 * Shared skeleton (Phase 4's transition() shape): read → pure transition check
 * → state-guarded updateMany. `where: { id, state: current }` makes a
 * concurrent transition a no-op (count 0 → conflict) instead of a lost update.
 * The NoteEntry append and the audit write share the transaction, so a
 * transition can never land without its thread entry.
 */
async function runTransition(action: PurchaseAction, input: unknown): Promise<ActionResult<Acted>> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;
  const reason = (parsed.data.reason ?? "").trim();

  const user = await actionRole(...(PURCHASE_ACTION_ROLES[action] as Role[]));
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  if (REASON_REQUIRED.includes(action) && reason.length < 3) {
    return validationError({ reason: "Give a reason (at least 3 characters) — it is appended to the thread." });
  }

  let acted: Acted | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const req = await tx.purchaseRequest.findUnique({
      where: { id },
      select: { id: true, refNo: true, state: true },
    });
    if (!req) return conflict("That request no longer exists.");

    const t = purchaseTransition(req.state, action, user.role);
    if (!t.ok) return conflict(t.error);

    const now = new Date();
    // reviewedById is a relation FK: UpdateManyMutationInput omits it, so it
    // rides along in the intersection type (the same shape Phase 4 used for
    // claimedById on the approvals queue).
    const data: Prisma.PurchaseRequestUpdateManyMutationInput & { reviewedById?: string } = {
      state: t.next,
      updatedAt: now,
    };
    if (action === "submit") data.submittedAt = now;
    if (action === "it-review") {
      data.reviewedAt = now;
      data.reviewedById = user.id;
    }
    if (action === "complete") data.completedAt = now;
    if (action === "cancel") {
      data.cancelledAt = now;
      data.cancelReason = reason;
    }

    const updated = await tx.purchaseRequest.updateMany({ where: { id, state: req.state }, data });
    if (updated.count === 0) {
      return conflict("Someone else moved this request first — refresh and retry.");
    }

    // Scope decision #6: cancelling withdraws its open units; completing IS
    // the money approval for whatever finance left PENDING.
    let unitDiff: Record<string, { from: unknown; to: unknown }> = {};
    if (action === "cancel" || action === "complete") {
      const to = action === "cancel" ? "CANCELLED" : "APPROVED";
      const moved = await tx.purchaseUnit.updateMany({
        where: { requestId: id, state: "PENDING" },
        data: { state: to },
      });
      if (moved.count > 0) {
        unitDiff = { units: { from: `${moved.count} PENDING`, to: `${moved.count} ${to}` } };
      }
    }

    // NoteEntry is the only notes surface, and it is append-only (DB trigger).
    await tx.noteEntry.create({
      data: {
        requestId: id,
        authorId: user.id,
        kind: PURCHASE_NOTE_KIND[action],
        text: reason || CANONICAL_NOTE[action],
      },
    });

    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "purchase-request",
      entityId: id,
      action,
      diff: {
        state: { from: req.state, to: t.next },
        ...unitDiff,
        ...(reason ? { reason: { from: null, to: reason } } : {}),
      },
    });

    acted = { refNo: req.refNo, state: t.next };
    return null;
  });

  if (failure) return failure;
  revalidate(id);
  return ok(acted!);
}

export async function submitRequest(input: unknown): Promise<ActionResult<Acted>> {
  return runTransition("submit", input);
}
export async function itReviewRequest(input: unknown): Promise<ActionResult<Acted>> {
  return runTransition("it-review", input);
}
export async function itRejectRequest(input: unknown): Promise<ActionResult<Acted>> {
  return runTransition("it-reject", input);
}
export async function requestMoreInfo(input: unknown): Promise<ActionResult<Acted>> {
  return runTransition("request-info", input);
}
export async function cancelRequest(input: unknown): Promise<ActionResult<Acted>> {
  return runTransition("cancel", input);
}
export async function completeRequest(input: unknown): Promise<ActionResult<Acted>> {
  return runTransition("complete", input);
}

const commentSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(2, "Say something").max(2000),
});

/** A free comment in the three-party thread — never a state change. */
export async function addComment(input: unknown): Promise<ActionResult<null>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, text } = parsed.data;

  const user = await actionRole("purchasing_staff", "it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const failure = await prisma.$transaction(async (tx) => {
    const req = await tx.purchaseRequest.findUnique({ where: { id }, select: { id: true } });
    if (!req) return conflict("That request no longer exists.");
    await tx.noteEntry.create({ data: { requestId: id, authorId: user.id, kind: "COMMENT", text } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "purchase-request",
      entityId: id, action: "comment",
    });
    return null;
  });

  if (failure) return failure;
  revalidate(id);
  return ok(null);
}

const unitSaveSchema = z.object({
  unitId: z.string().min(1),
  specs: z.string().trim().max(500).optional(),
  itSlotNotes: z.string().trim().max(500).optional(),
  financeNotes: z.string().trim().max(500).optional(),
  state: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

/**
 * The editor a person gets is decided by `unitEditorMode` (pure, in
 * `@/lib/purchase-flow` — a "use server" module may only export async
 * functions). Saving a unit does NOT re-submit the request: nothing below
 * touches PurchaseRequest.state.
 */
export async function saveUnit(input: unknown): Promise<ActionResult<null>> {
  const parsed = unitSaveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { unitId, specs, itSlotNotes, financeNotes, state } = parsed.data;

  const user = await actionRole("it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  let requestId: string | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const unit = await tx.purchaseUnit.findUnique({
      where: { id: unitId },
      select: {
        id: true, requestId: true, specs: true, itSlotNotes: true, financeNotes: true, state: true,
        request: { select: { state: true } },
      },
    });
    if (!unit) return conflict("That unit no longer exists.");
    requestId = unit.requestId;

    const mode = unitEditorMode(unit.request.state, user.role);
    if (!mode) {
      return conflict(`A ${unit.request.state} request has no editable units for your role.`);
    }
    if (unit.state === "CANCELLED") return conflict("A cancelled unit is read-only.");

    const after =
      mode === "it"
        ? { specs: specs ?? unit.specs, itSlotNotes: itSlotNotes ?? unit.itSlotNotes }
        : { financeNotes: financeNotes ?? unit.financeNotes, state: state ?? unit.state };

    const diff = diffOf(
      { specs: unit.specs, itSlotNotes: unit.itSlotNotes, financeNotes: unit.financeNotes, state: unit.state },
      after,
    );
    if (Object.keys(diff).length === 0) return null; // nothing changed — no write, no audit row

    const updated = await tx.purchaseUnit.updateMany({
      where: { id: unitId, state: unit.state, request: { state: unit.request.state } },
      data: after,
    });
    if (updated.count === 0) {
      return conflict("Someone else changed this unit first — refresh and retry.");
    }

    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "purchase-request",
      entityId: unit.requestId,
      action: "unit-update",
      diff: { unit: { from: null, to: unit.id }, ...diff },
    });
    return null;
  });

  if (failure) return failure;
  if (requestId) revalidate(requestId);
  return ok(null);
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean. If `tsc` objects to `data.reviewedById`, confirm you copied the intersection type `& { reviewedById?: string }` — `PurchaseRequestUpdateManyMutationInput` omits relation FKs on its own.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/purchases/actions.ts
git commit -m "feat(purchases): state-guarded transitions, append-only notes, per-role unit editors"
```

---

### Task 8: The draft writer

Scope decisions #4 and #5. `/purchases/new` holds rows in client state until the first autosave allocates a `PR-####`; from then on `saveDraft` replaces the unit set. Money is `Decimal(12,2)` — centavos must survive the round trip (entry criterion #8).

**Files:**
- Create: `src/server/modules/purchases/draft-actions.ts`

- [ ] **Step 1: Write the module**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/**
 * Prices are Decimal(12,2) in Postgres: .multipleOf(0.01) is what stops a
 * third decimal being accepted here and silently rounded by the database, so
 * the audit trail can never record a number Postgres never stored.
 */
const unitSchema = z.object({
  id: z.string().min(1).optional(), // present = an existing row
  description: z.string().trim().min(2, "Say what this is").max(200),
  specs: z.string().trim().max(500).default(""),
  qty: z.number().int().min(1, "At least one").max(999),
  unitPrice: z
    .number()
    .min(0)
    .max(99_999_999.99)
    .multipleOf(0.01, "Prices go to centavos — two decimal places at most")
    .nullable(),
});

const draftSchema = z.object({
  id: z.string().min(1).optional(),
  units: z.array(unitSchema).min(1, "A request needs at least one unit").max(50),
});

export interface DraftSaved {
  id: string;
  refNo: string;
  savedAt: string;
}

const summarize = (units: Array<{ qty: number; unitPrice: number | null }>) => ({
  units: units.length,
  total: units.reduce((sum, u) => sum + u.qty * (u.unitPrice ?? 0), 0),
});

/**
 * The DRAFT row is created by the first autosave, not by opening the form —
 * abandoning /purchases/new leaves no junk PR behind. refNo continues the
 * seeded PR-#### range via purchase_request_ref_seq (the seed leaves it at 201).
 */
export async function createDraft(input: unknown): Promise<ActionResult<DraftSaved>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { units } = parsed.data;

  const user = await actionRole("purchasing_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const created = await prisma.$transaction(async (tx) => {
    const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('purchase_request_ref_seq')`;
    const request = await tx.purchaseRequest.create({
      data: {
        refNo: `PR-${String(nextval).padStart(4, "0")}`,
        state: "DRAFT",
        requestedById: user.id,
        units: {
          create: units.map((u) => ({
            description: u.description,
            specs: u.specs || null,
            qty: u.qty,
            unitPrice: u.unitPrice,
          })),
        },
      },
      select: { id: true, refNo: true },
    });
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "purchase-request",
      entityId: request.id,
      action: "create",
      diff: { state: { from: null, to: "DRAFT" }, ...diffOf({}, summarize(units)) },
    });
    return request;
  });

  revalidatePath("/purchases");
  revalidatePath("/purchases/activity");
  return ok({ id: created.id, refNo: created.refNo, savedAt: new Date().toISOString() });
}

/**
 * Replaces the unit set of a DRAFT: rows dropped in the editor are deleted,
 * known ids updated, new ones created — one transaction, batched rather than
 * one round trip per row (Prisma's interactive-transaction budget is 5s).
 * Editing requires ownership (or admin): a draft is not yet a shared document.
 * Audits only when something actually changed (scope decision #5).
 */
export async function saveDraft(input: unknown): Promise<ActionResult<DraftSaved>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, units } = parsed.data;
  if (!id) return validationError({ _form: "Missing draft id." });

  const user = await actionRole("purchasing_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  let saved: DraftSaved | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const req = await tx.purchaseRequest.findUnique({
      where: { id },
      select: {
        id: true, refNo: true, state: true, requestedById: true,
        units: { select: { id: true, qty: true, unitPrice: true } },
      },
    });
    if (!req) return conflict("That request no longer exists.");
    if (req.state !== "DRAFT") {
      return conflict(`Only a draft can be edited — this one is ${req.state}.`);
    }
    if (req.requestedById !== user.id && user.role !== "admin") return forbidden();

    const known = new Set(req.units.map((u) => u.id));
    const keep = new Set(units.map((u) => u.id).filter((x): x is string => !!x));
    // an id the caller invented (or one belonging to another request) must not
    // become a row under this draft
    if ([...keep].some((unitId) => !known.has(unitId))) {
      return conflict("This draft changed elsewhere — refresh and retry.");
    }
    const drop = req.units.filter((u) => !keep.has(u.id)).map((u) => u.id);

    if (drop.length) await tx.purchaseUnit.deleteMany({ where: { id: { in: drop }, requestId: id } });
    for (const u of units.filter((x) => x.id)) {
      await tx.purchaseUnit.update({
        where: { id: u.id },
        data: { description: u.description, specs: u.specs || null, qty: u.qty, unitPrice: u.unitPrice },
      });
    }
    const fresh = units.filter((u) => !u.id);
    if (fresh.length) {
      await tx.purchaseUnit.createMany({
        data: fresh.map((u) => ({
          requestId: id,
          description: u.description,
          specs: u.specs || null,
          qty: u.qty,
          unitPrice: u.unitPrice,
        })),
      });
    }

    const now = new Date();
    await tx.purchaseRequest.updateMany({ where: { id, state: "DRAFT" }, data: { updatedAt: now } });

    const before = summarize(
      req.units.map((u) => ({ qty: u.qty, unitPrice: u.unitPrice === null ? null : Number(u.unitPrice) })),
    );
    const diff = diffOf(before, summarize(units));
    // autosave fires per edit; an unchanged save must not spam the audit log
    if (Object.keys(diff).length > 0 || drop.length > 0 || fresh.length > 0) {
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "purchase-request",
        entityId: id, action: "update", diff,
      });
    }
    saved = { id, refNo: req.refNo, savedAt: now.toISOString() };
    return null;
  });

  if (failure) return failure;
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  revalidatePath(`/purchases/${id}/edit`);
  return ok(saved!);
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/purchases/draft-actions.ts
git commit -m "feat(purchases): draft writer — refNo allocation, unit-set replace, centavo-safe prices"
```

---

### Task 9: `/purchases` — the list

Entry criterion #4: the tabs write `?state=` and the sidebar's "By status" links land on them. Two different empty sentences (nothing exists / filters matched nothing), a `READ-ONLY · VIEWER` badge, and the dwell second line under State.

**Files:**
- Create: `src/components/purchases/purchases-table.tsx`
- Create: `src/app/(app)/purchases/page.tsx`, `src/app/(app)/purchases/loading.tsx`

- [ ] **Step 1: Write the table** (`src/components/purchases/purchases-table.tsx`)

```tsx
import Link from "next/link";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusDot, StatusPill } from "@/components/ui/status";
import type { PurchaseListRow } from "@/server/modules/purchases/queries";

/**
 * README 4d: the State column carries a second line saying how long it's been
 * there — "back from finance" is the fact the enum can't hold, and it is the
 * difference between a queue you can read and a queue you have to open.
 */
export function PurchasesTable({ rows }: { rows: PurchaseListRow[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th width={26} />
          <Th width={104}>Ref</Th>
          <Th>Request</Th>
          <Th width={78} align="right">Units</Th>
          <Th width={124} align="right">Value</Th>
          <Th width={150}>Requested by</Th>
          <Th width={168}>State</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td><StatusDot value={row.state} /></Td>
            <Td>
              <Link href={`/purchases/${row.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                {row.refNo}
              </Link>
            </Td>
            <Td className="text-fg">
              {row.unitCount === 1 ? "1 line" : `${row.unitCount} lines`} · {row.totalQty} item{row.totalQty === 1 ? "" : "s"}
            </Td>
            <Td align="right" mono>{row.unitCount}</Td>
            <Td align="right" mono>{row.total}</Td>
            <Td>{row.requester}</Td>
            <Td>
              <span className="flex flex-col gap-0.5 py-1.5">
                <StatusPill value={row.state} className="self-start" />
                <span className="font-mono text-[10px] text-fg-muted">{row.dwell}</span>
              </span>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
```

- [ ] **Step 2: Write the page** (`src/app/(app)/purchases/page.tsx`)

```tsx
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { PURCHASE_TABS, parsePurchaseState } from "@/lib/purchases-list";
import { listPurchases, stateCounts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { PurchasesTable } from "@/components/purchases/purchases-table";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = toSearchParams(await searchParams);
  const state = parsePurchaseState(params.get("state"));
  const q = (params.get("q") ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const [{ rows, total, page: current, pageCount }, counts] = await Promise.all([
    listPurchases(state, q, page),
    stateCounts(),
  ]);

  const canCreate = user.role === "purchasing_staff" || user.role === "admin";
  const filtered = Boolean(state || q);
  const hrefFor = (p: number) => {
    const next = new URLSearchParams();
    if (state) next.set("state", state);
    if (q) next.set("q", q);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <>
      <PageHeader
        title="Purchase requests"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={canCreate ? <ButtonLink href="/purchases/new" variant="primary">New request</ButtonLink> : undefined}
      />
      <div className="flex flex-col gap-3">
        <Tabs
          items={PURCHASE_TABS.map((t) => ({
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                <span className="font-mono text-[10px] text-fg-faint">{counts[t.id] ?? 0}</span>
              </span>
            ),
            href: q ? `${t.href}${t.href.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : t.href,
            active: t.id === (state ?? "ALL"),
          }))}
        />

        <form method="get" className="flex items-center gap-2">
          {state && <input type="hidden" name="state" value={state} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search PR number or line description…"
            aria-label="Search purchase requests"
            className="max-w-[320px]"
          />
          <Button type="submit" size="sm">Search</Button>
          <span className="ml-auto font-mono text-[10.5px] text-fg-muted">
            {total} request{total === 1 ? "" : "s"}
          </span>
        </form>

        {rows.length > 0 ? (
          <>
            <PurchasesTable rows={rows} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {current} of {pageCount}</span>
              <Pagination page={current} pageCount={pageCount} hrefFor={hrefFor} />
            </div>
          </>
        ) : filtered ? (
          <EmptyState
            title="No request matches this filter"
            description={
              state && q
                ? `Filtered to ${state} and searching "${q}".`
                : state
                  ? `Filtered to ${state}.`
                  : `Searching "${q}".`
            }
            actions={<ButtonLink href="/purchases">Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="No purchase requests yet"
            description="A request starts as a draft, goes to IT for specs, then to finance for the money."
            actions={canCreate ? <ButtonLink href="/purchases/new" variant="primary">New request</ButtonLink> : undefined}
          />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Write the skeleton** (`src/app/(app)/purchases/loading.tsx`)

```tsx
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function PurchasesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-24" />)}
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} columns={7} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean. (`ButtonLink` and `Pagination` already exist from Phase 1/3 — check `src/components/ui/button-link.tsx` and `src/components/ui/pagination.tsx` for their exact props if tsc complains.)

- [ ] **Step 5: Commit**

```bash
git add src/components/purchases/purchases-table.tsx "src/app/(app)/purchases/page.tsx" "src/app/(app)/purchases/loading.tsx"
git commit -m "feat(purchases): request list — ?state= tabs, search, dwell line, two empty states"
```

---

### Task 10: `/purchases/new` — multi-unit rows with an autosaved draft

README 3f: units are **editable rows, not a repeated form**; an autosaved DRAFT chip; "add from a policy loadout"; vague specs are allowed on submit, prices are not.

**Files:**
- Create: `src/components/purchases/draft-form.tsx`
- Create: `src/app/(app)/purchases/new/page.tsx`
- Modify: `src/server/modules/purchases/actions.ts` (the submit price guard)

- [ ] **Step 1: Add the price guard to `submit`** (`src/server/modules/purchases/actions.ts`)

Inside `runTransition`, immediately after `if (!t.ok) return conflict(t.error);`, insert:

```ts
    // README 3f: vague specs are exactly what IT review is for. Missing prices
    // are not — finance can't approve a number nobody wrote down.
    if (action === "submit") {
      const unpriced = await tx.purchaseUnit.count({ where: { requestId: id, unitPrice: null } });
      if (unpriced > 0) {
        return conflict(
          `${unpriced} line${unpriced === 1 ? "" : "s"} still ${unpriced === 1 ? "has" : "have"} no price — IT review sharpens specs, it doesn't invent budgets.`,
        );
      }
    }
```

- [ ] **Step 2: Write the form** (`src/components/purchases/draft-form.tsx`)

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { useToast } from "@/components/ui/toast";
import { createDraft, saveDraft } from "@/server/modules/purchases/draft-actions";
import { submitRequest } from "@/server/modules/purchases/actions";
import type { PolicyLoadout } from "@/server/modules/purchases/queries";
import type { ActionResult } from "@/server/action-result";

export interface UnitDraft {
  id?: string;
  description: string;
  specs: string;
  qty: string;
  unitPrice: string;
}

const emptyRow = (): UnitDraft => ({ description: "", specs: "", qty: "1", unitPrice: "" });

const AUTOSAVE_MS = 2500;

/** The wire shape: strings from the inputs become numbers exactly once, here. */
function toPayload(units: UnitDraft[]) {
  return units
    .filter((u) => u.description.trim().length >= 2)
    .map((u) => ({
      id: u.id,
      description: u.description.trim(),
      specs: u.specs.trim(),
      qty: Number.parseInt(u.qty, 10) || 1,
      unitPrice: u.unitPrice.trim() === "" ? null : Number(u.unitPrice),
    }));
}

/**
 * Units are rows, not a repeated form (README 3f). The DRAFT row itself is
 * created by the FIRST autosave — opening this page and walking away leaves no
 * junk PR behind — and every later autosave edits that same row in place, so
 * typing is never interrupted by a navigation. Reloading /purchases/new
 * deliberately starts a new draft; the chip links to the saved one.
 */
export function DraftForm({
  loadouts,
  initial,
}: {
  loadouts: PolicyLoadout[];
  initial?: { id: string; refNo: string; units: UnitDraft[] };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [units, setUnits] = useState<UnitDraft[]>(initial?.units.length ? initial.units : [emptyRow()]);
  const [draft, setDraft] = useState<{ id: string; refNo: string } | null>(
    initial ? { id: initial.id, refNo: initial.refNo } : null,
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [loadoutId, setLoadoutId] = useState("");
  const lastSaved = useRef<string>(JSON.stringify(toPayload(initial?.units ?? [])));

  const handleFailure = useCallback((res: Extract<ActionResult<unknown>, { ok: false }>) => {
    if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] ?? res.message : res.message);
  }, []);

  /** Autosave: debounce, skip when unchanged, never fire on an empty request. */
  useEffect(() => {
    const payload = toPayload(units);
    if (payload.length === 0) return;
    const serialized = JSON.stringify(payload);
    if (serialized === lastSaved.current) return;

    const timer = setTimeout(() => {
      setSaving(true);
      setError(null);
      startTransition(async () => {
        const res = draft
          ? await saveDraft({ id: draft.id, units: payload })
          : await createDraft({ units: payload });
        setSaving(false);
        if (res.ok) {
          lastSaved.current = serialized;
          setDraft({ id: res.data.id, refNo: res.data.refNo });
          setSavedAt(new Date(res.data.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } else {
          handleFailure(res);
        }
      });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [units, draft, handleFailure]);

  const set = (i: number, key: keyof UnitDraft) => (value: string) =>
    setUnits((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  function addLoadout() {
    const policy = loadouts.find((l) => l.id === loadoutId);
    if (!policy) return;
    setUnits((rows) => [
      ...rows.filter((r) => r.description.trim() || r.unitPrice.trim()),
      ...policy.slots.map((s) => ({
        description: `${s.name}${s.type ? ` (${s.type})` : ""}`,
        specs: s.required ? "Required by policy" : "Optional",
        qty: "1",
        unitPrice: "",
      })),
    ]);
  }

  function submit() {
    const payload = toPayload(units);
    if (payload.length === 0) {
      setError("Add at least one line before submitting.");
      return;
    }
    if (payload.some((u) => u.unitPrice === null)) {
      setError("Every line needs a price — IT review sharpens specs, it doesn't invent budgets.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // save first: submit acts on what the database holds, not on the inputs
      const saved = draft
        ? await saveDraft({ id: draft.id, units: payload })
        : await createDraft({ units: payload });
      if (!saved.ok) {
        handleFailure(saved);
        return;
      }
      lastSaved.current = JSON.stringify(payload);
      setDraft({ id: saved.data.id, refNo: saved.data.refNo });
      const res = await submitRequest({ id: saved.data.id });
      if (!res.ok) {
        handleFailure(res);
        return;
      }
      toast(`${res.data.refNo} submitted for IT review`, "settled");
      router.push(`/purchases/${saved.data.id}`);
    });
  }

  return (
    <div className="flex max-w-[900px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Card>
        <CardHeader
          title="Lines"
          actions={
            <span className="flex items-center gap-2" aria-live="polite">
              {draft ? (
                <Link href={`/purchases/${draft.id}`} className="font-mono text-[10px] text-accent hover:underline">
                  {draft.refNo}
                </Link>
              ) : null}
              <Pill tone={draft ? "accent" : "neutral"}>
                {saving ? "SAVING…" : savedAt ? `DRAFT · SAVED ${savedAt}` : "DRAFT · NOT SAVED YET"}
              </Pill>
            </span>
          }
        />
        <CardBody className="flex flex-col gap-3">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th scope="col" className="w-[26px] pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">#</th>
                <th scope="col" className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Description</th>
                <th scope="col" className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Specs</th>
                <th scope="col" className="w-[76px] pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Qty</th>
                <th scope="col" className="w-[128px] pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Unit price ₱</th>
                <th scope="col" className="w-[40px] pb-2" />
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id ?? `row-${i}`}>
                  <td className="py-1 pr-2 font-mono text-[10.5px] text-fg-muted">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Line ${i + 1} description`}
                      value={u.description}
                      onChange={(e) => set(i, "description")(e.target.value)}
                      placeholder="27-inch monitors"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Line ${i + 1} specs`}
                      value={u.specs}
                      onChange={(e) => set(i, "specs")(e.target.value)}
                      placeholder="IPS, USB-C 90W"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Line ${i + 1} quantity`}
                      type="number" min="1" step="1" inputMode="numeric"
                      value={u.qty}
                      onChange={(e) => set(i, "qty")(e.target.value)}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    {/* centavos must not stepMismatch — Decimal(12,2) upstream */}
                    <Input
                      aria-label={`Line ${i + 1} unit price`}
                      type="number" min="0" step="0.01" inputMode="decimal"
                      value={u.unitPrice}
                      onChange={(e) => set(i, "unitPrice")(e.target.value)}
                    />
                  </td>
                  <td className="py-1">
                    <IconButton
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => setUnits((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows))}
                    >
                      −
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setUnits((rows) => [...rows, emptyRow()])}>Add line</Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Select
              aria-label="Policy loadout"
              value={loadoutId}
              onChange={(e) => setLoadoutId(e.target.value)}
              className="max-w-[220px]"
            >
              <option value="">Add from a policy loadout…</option>
              {loadouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Button size="sm" disabled={!loadoutId} onClick={addLoadout}>Add rows</Button>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="primary" loading={pending} onClick={submit}>Submit for IT review</Button>
        <span className="text-xs text-fg-muted">
          Vague specs are fine — that is what IT review is for. Prices are not.
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the page** (`src/app/(app)/purchases/new/page.tsx`)

```tsx
import { requireRole } from "@/server/auth/guards";
import { policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DraftForm } from "@/components/purchases/draft-form";

export default async function NewPurchasePage() {
  await requireRole("purchasing_staff", "admin");
  const loadouts = await policyLoadouts();

  return (
    <>
      <PageHeader
        title="Register purchase"
        breadcrumb={[{ label: "Purchase requests", href: "/purchases" }, { label: "New" }]}
      />
      <DraftForm loadouts={loadouts} />
    </>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean. (`IconButton` ships from the same module as `Button`, which is why they share one import line above.)

- [ ] **Step 5: Commit**

```bash
git add src/components/purchases/draft-form.tsx "src/app/(app)/purchases/new/page.tsx" src/server/modules/purchases/actions.ts
git commit -m "feat(purchases): multi-unit draft form with autosave, policy loadouts and the price rule"
```

---

### Task 11: `/purchases/[id]` — the bounce-back, the stepper, the thread, the editors

This is the design problem (README `1j`, entry criteria #3 and #5). The banner names **who** sent it back, **when**, the **verbatim** reason and the transition; the stepper shows the loop with a dashed "← sent back" connector and marks `SUBMITTED` as `NOW · 2nd time`; per-unit states read alongside the header state; both role editors render inline and **saving a unit does not re-submit the request**.

**Files:**
- Create: `src/components/purchases/bounce-back-banner.tsx`, `src/components/purchases/purchase-stepper.tsx`, `src/components/purchases/note-thread.tsx`, `src/components/purchases/unit-editor.tsx`, `src/components/purchases/request-actions.tsx`
- Create: `src/app/(app)/purchases/[id]/page.tsx`, `src/app/(app)/purchases/[id]/not-found.tsx`

- [ ] **Step 1: The banner** (`src/components/purchases/bounce-back-banner.tsx`)

```tsx
import { Banner } from "@/components/ui/banner";
import { fmtDateTime } from "@/lib/format";
import { unitAnchor, type BounceBack } from "@/lib/purchase-thread";

/**
 * README 1j: "a purchasing user landing on a bounced-back request understands
 * *why* it came back within two seconds." Red left border, the sender by name,
 * the reason verbatim, and the honest transition line — nothing was cleared.
 */
export function BounceBackBanner({ bounce }: { bounce: BounceBack }) {
  const jump = unitAnchor(bounce.reason);
  const sender = bounce.from === "finance" ? "Finance" : "IT";
  return (
    <Banner
      tone="fault"
      title={`${sender} sent this back — ${bounce.by} · ${fmtDateTime(bounce.at)}`}
      actions={
        <>
          <a href={jump.anchor} className="text-xs font-medium text-accent hover:underline">{jump.label}</a>
          <a href="#thread" className="text-xs font-medium text-accent hover:underline">Reply in thread</a>
        </>
      }
    >
      <p className="text-[13px] text-fg">{bounce.reason}</p>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">{bounce.transition}</p>
    </Banner>
  );
}
```

- [ ] **Step 2: The stepper** (`src/components/purchases/purchase-stepper.tsx`)

```tsx
import { cn } from "@/lib/cn";
import type { Stepper } from "@/lib/purchase-thread";

/**
 * Four stops, and the loop drawn explicitly: when a request came back, the
 * connector it travelled backwards along is dashed amber/red and labelled
 * "← sent back", so the return path is visible instead of implied.
 */
export function PurchaseStepper({ model }: { model: Stepper }) {
  // finance bounced IT_REVIEWED → SUBMITTED (connector 1); IT rejected
  // SUBMITTED → DRAFT (connector 0)
  const returnAt = model.sentBack === "finance" ? 1 : model.sentBack === "it" ? 0 : -1;

  return (
    <ol className="flex flex-wrap items-start gap-1" aria-label="Request progress">
      {model.stops.map((stop, i) => (
        <li key={stop.state} className="flex items-start gap-1">
          <div className="flex w-[104px] flex-col items-center gap-1 text-center">
            <span
              aria-hidden
              className={cn(
                "inline-block size-[9px] rounded-full",
                stop.status === "upcoming" && "border border-border-strong",
              )}
              style={{
                background:
                  stop.status === "done"
                    ? "var(--st-settled-dot)"
                    : stop.status === "current"
                      ? "var(--st-inflight-dot)"
                      : "transparent",
              }}
            />
            <span
              className={cn(
                "text-[11.5px]",
                stop.status === "upcoming" ? "text-fg-muted" : "font-medium text-fg",
              )}
            >
              {stop.label}
            </span>
            {stop.note && (
              <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[color:var(--st-inflight-text)]">
                {stop.note}
              </span>
            )}
            <span className="sr-only">
              {stop.status === "current" ? "current step" : stop.status === "done" ? "completed step" : "upcoming step"}
            </span>
          </div>
          {i < model.stops.length - 1 && (
            <div className="mt-1 flex w-[72px] flex-col items-center gap-0.5">
              <span
                aria-hidden
                className="h-0 w-full"
                style={{
                  borderTop:
                    i === returnAt
                      ? "1.5px dashed var(--st-fault-dot)"
                      : "1.5px solid var(--border-strong, var(--st-closed-ring))",
                }}
              />
              {i === returnAt && (
                <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-[color:var(--st-fault-text)]">
                  ← sent back
                </span>
              )}
            </div>
          )}
        </li>
      ))}
      {model.cancelled && (
        <li className="ml-2 self-center font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
          cancelled — the rest never happened
        </li>
      )}
    </ol>
  );
}
```

- [ ] **Step 3: The thread** (`src/components/purchases/note-thread.tsx`)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { fmtDateTime } from "@/lib/format";
import { NOTE_CHIP, type ThreadNote } from "@/lib/purchase-thread";
import { addComment } from "@/server/modules/purchases/actions";

/**
 * The notes field is an append-only conversation across three parties — actor,
 * action chip, timestamp — never a textarea that overwrites (brief §6.1). The
 * composer only appends; nothing here can edit or delete a line, because the
 * database won't allow it either (NoteEntry has an append-only trigger).
 */
export function NoteThread({
  requestId,
  notes,
  canComment,
}: {
  requestId: string;
  notes: ThreadNote[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function post() {
    setError(null);
    startTransition(async () => {
      const res = await addComment({ id: requestId, text });
      if (res.ok) {
        setText("");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.text ?? res.message);
    });
  }

  return (
    <Card>
      <CardHeader title="Thread" actions={<Pill>APPEND-ONLY</Pill>} />
      <CardBody className="flex flex-col gap-3">
        <ol id="thread" className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2.5">
              <Avatar name={n.author} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-medium text-fg">{n.author}</span>
                  <Pill tone={n.kind === "COMMENT" ? "neutral" : "accent"}>{NOTE_CHIP[n.kind]}</Pill>
                  <span className="font-mono text-[10px] text-fg-muted">{fmtDateTime(n.at)}</span>
                </div>
                <p className="text-[12.5px] text-fg-secondary">{n.text}</p>
              </div>
            </li>
          ))}
          {notes.length === 0 && <li className="text-xs text-fg-muted">Nothing said yet.</li>}
        </ol>

        {canComment && (
          <div className="flex flex-col gap-2 border-t border-border-faint pt-3">
            {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
            {error && <Banner tone="fault" title={error} />}
            <Textarea
              aria-label="Add a comment"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Reply to the thread…"
            />
            <Button size="sm" loading={pending} onClick={post} className="self-start">Post comment</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 4: The per-unit editors** (`src/components/purchases/unit-editor.tsx`)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { saveUnit } from "@/server/modules/purchases/actions";
import type { PurchaseUnitView } from "@/server/modules/purchases/queries";

/**
 * README 1j: the IT slot editor and the Finance unit editor are the same row,
 * rendered for whoever's turn it is. Saving a unit does NOT re-submit the
 * request — this component never calls a transition action.
 */
export function UnitEditor({ unit, mode }: { unit: PurchaseUnitView; mode: "it" | "finance" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [specs, setSpecs] = useState(unit.specs ?? "");
  const [itSlotNotes, setItSlotNotes] = useState(unit.itSlotNotes ?? "");
  const [financeNotes, setFinanceNotes] = useState(unit.financeNotes ?? "");
  const [state, setState] = useState<string>(unit.state);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveUnit(
        mode === "it"
          ? { unitId: unit.id, specs, itSlotNotes }
          : { unitId: unit.id, financeNotes, state },
      );
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-(--radius-card) border border-border-faint bg-surface-subtle p-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {mode === "it" ? (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Specs
              <Input value={specs} onChange={(e) => setSpecs(e.target.value)} placeholder="IPS, USB-C 90W" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              IT slot note
              <Input value={itSlotNotes} onChange={(e) => setItSlotNotes(e.target.value)} placeholder="Confirm wattage for T14" />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Finance note
              <Input value={financeNotes} onChange={(e) => setFinanceNotes(e.target.value)} placeholder="Within standing rate" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Unit decision
              <Select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
              </Select>
            </label>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" loading={pending} onClick={save}>{saved ? "✓ Saved" : "Save line"}</Button>
        <span className="text-[11px] text-fg-muted">Saving a line does not re-submit the request.</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: The action panel** (`src/components/purchases/request-actions.tsx`)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseRequestState, Role } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { canAct, type PurchaseAction } from "@/lib/purchase-flow";
import {
  cancelRequest, completeRequest, itRejectRequest, itReviewRequest, requestMoreInfo, submitRequest,
} from "@/server/modules/purchases/actions";
import type { ActionResult } from "@/server/action-result";

/** Mirrors what the transitions return (kept local — see actions.ts). */
type Acted = { refNo: string; state: string };

const RUN: Record<PurchaseAction, (input: { id: string; reason?: string }) => Promise<ActionResult<Acted>>> = {
  submit: submitRequest,
  "it-review": itReviewRequest,
  "it-reject": itRejectRequest,
  "request-info": requestMoreInfo,
  cancel: cancelRequest,
  complete: completeRequest,
};

const COPY: Record<PurchaseAction, { label: string; variant: "primary" | "secondary" | "danger"; past: string; prompt?: string }> = {
  submit: { label: "Submit for IT review", variant: "primary", past: "submitted" },
  "it-review": { label: "Mark IT-reviewed", variant: "primary", past: "marked IT-reviewed" },
  "it-reject": {
    label: "Send back to purchasing", variant: "danger", past: "sent back",
    prompt: "It goes back to DRAFT so purchasing can edit and resubmit. Your reason is appended to the thread — nothing is cleared.",
  },
  "request-info": {
    label: "Request more info", variant: "danger", past: "sent back",
    prompt: "It goes back to SUBMITTED so IT can revisit the per-unit fields. Nothing captured is cleared, and your reason is appended to the thread.",
  },
  cancel: { label: "Cancel request", variant: "danger", past: "cancelled", prompt: "Cancelling withdraws every open line. This cannot be undone." },
  complete: { label: "Complete", variant: "primary", past: "completed" },
};

/**
 * The button set is what the CURRENT state + this role allow, asked of the
 * same pure function the server action calls — never a disabled button
 * standing in for a transition that would fail.
 */
export function RequestActions({
  id,
  state,
  role,
  isDraftOwner,
}: {
  id: string;
  state: PurchaseRequestState;
  role: Role;
  isDraftOwner: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<PurchaseAction | null>(null);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function fire(action: PurchaseAction, withReason?: string) {
    setError(null);
    setFieldError(undefined);
    startTransition(async () => {
      const res = await RUN[action]({ id, reason: withReason });
      if (res.ok) {
        setAsking(null);
        setReason("");
        toast(`${res.data.refNo} ${COPY[action].past}`, "settled");
        router.refresh();
      } else if (res.kind === "validation") setFieldError(res.fieldErrors?.reason ?? res.message);
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else {
        setAsking(null);
        setError(res.message);
      }
    });
  }

  const available = (["submit", "it-review", "it-reject", "request-info", "complete", "cancel"] as PurchaseAction[])
    .filter((a) => canAct(state, a, role));

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === "DRAFT" && isDraftOwner && <ButtonLink href={`/purchases/${id}/edit`}>Edit draft</ButtonLink>}
        {available.map((action) => (
          <Button
            key={action}
            variant={COPY[action].variant}
            loading={pending && asking === null && action === "submit"}
            onClick={() => (COPY[action].prompt ? setAsking(action) : fire(action))}
          >
            {COPY[action].label}
          </Button>
        ))}
      </div>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking ? COPY[asking].label : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={() => asking && fire(asking, reason)}>
              {asking ? COPY[asking].label : ""}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">{asking ? COPY[asking].prompt : ""}</p>
          <FormField label="Reason" required error={fieldError}>
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 6: The page** (`src/app/(app)/purchases/[id]/page.tsx`)

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getPurchase } from "@/server/modules/purchases/queries";
import { unitEditorMode } from "@/lib/purchase-flow";
import { bounceBack, stepperModel } from "@/lib/purchase-thread";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { BounceBackBanner } from "@/components/purchases/bounce-back-banner";
import { PurchaseStepper } from "@/components/purchases/purchase-stepper";
import { NoteThread } from "@/components/purchases/note-thread";
import { RequestActions } from "@/components/purchases/request-actions";
import { UnitEditor } from "@/components/purchases/unit-editor";

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const request = await getPurchase(id);
  if (!request) notFound();

  const bounce = bounceBack(request.state, request.notes);
  const stepper = stepperModel(request.state, request.notes);
  const editorMode = unitEditorMode(request.state, user.role);
  const canComment = user.role !== "viewer";

  return (
    <>
      <PageHeader
        title={request.refNo}
        breadcrumb={[{ label: "Purchase requests", href: "/purchases" }, { label: request.refNo }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={request.state} />
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          user.role === "viewer" ? undefined : (
            <RequestActions
              id={request.id}
              state={request.state}
              role={user.role}
              isDraftOwner={request.requestedById === user.id || user.role === "admin"}
            />
          )
        }
      />
      <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
        requested by {request.requester} · {fmtDate(request.createdAt)} · {request.units.length} line
        {request.units.length === 1 ? "" : "s"} · {request.total}
        {request.reviewedBy ? ` · IT-reviewed by ${request.reviewedBy}` : ""}
      </p>

      <div className="flex flex-col gap-4">
        {bounce && <BounceBackBanner bounce={bounce} />}

        <Card>
          <CardHeader title="Progress" />
          <CardBody>
            <PurchaseStepper model={stepper} />
            {request.state === "CANCELLED" && request.cancelReason && (
              <p className="mt-3 text-xs text-fg-secondary">
                Cancelled {fmtDate(request.cancelledAt)} — {request.cancelReason}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lines"
            actions={
              editorMode && (
                <Pill tone="accent">
                  {editorMode === "it" ? "IT SLOT EDITOR" : "FINANCE UNIT EDITOR"}
                </Pill>
              )
            }
          />
          <CardBody className="px-0 py-0">
            <div id="units">
              <Table className="rounded-none border-0 shadow-none">
                <THead>
                  <Tr>
                    <Th width={40}>#</Th>
                    <Th>Line</Th>
                    <Th width={60} align="right">Qty</Th>
                    <Th width={120} align="right">Unit price</Th>
                    <Th width={120} align="right">Line total</Th>
                    <Th width={110}>State</Th>
                  </Tr>
                </THead>
                <TBody>
                  {request.units.map((unit) => (
                    <Tr key={unit.id} id={`unit-${unit.index}`}>
                      <Td mono>{String(unit.index).padStart(2, "0")}</Td>
                      <Td>
                        {/* a div, not a span: UnitEditor renders block elements */}
                        <div className="flex flex-col gap-0.5 py-1.5">
                          <span className="text-fg">{unit.description}</span>
                          {unit.specs && <span className="text-[11px] text-fg-muted">{unit.specs}</span>}
                          {unit.itSlotNotes && (
                            <span className="font-mono text-[10px] text-fg-muted">IT: {unit.itSlotNotes}</span>
                          )}
                          {unit.financeNotes && (
                            <span className="font-mono text-[10px] text-fg-muted">Finance: {unit.financeNotes}</span>
                          )}
                          {editorMode && (
                            <div className="mt-2">
                              <UnitEditor unit={unit} mode={editorMode} />
                            </div>
                          )}
                        </div>
                      </Td>
                      <Td align="right" mono>{unit.qty}</Td>
                      <Td align="right" mono>{unit.price}</Td>
                      <Td align="right" mono>{unit.lineTotal}</Td>
                      <Td><StatusPill value={unit.state} /></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardBody>
        </Card>

        <NoteThread requestId={request.id} notes={request.notes} canComment={canComment} />
      </div>
    </>
  );
}
```

- [ ] **Step 7: The not-found** (`src/app/(app)/purchases/[id]/not-found.tsx`)

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function PurchaseNotFound() {
  return (
    <EmptyState
      title="Request not found"
      description="It may have been removed, or the link is stale."
      actions={<ButtonLink href="/purchases">Back to purchase requests</ButtonLink>}
    />
  );
}
```

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean. `Tr` accepts the `id` prop because it spreads `React.HTMLAttributes<HTMLTableRowElement>`; `unitEditorMode` comes from `@/lib/purchase-flow` (Task 1), never from the `"use server"` module.

- [ ] **Step 9: Run the unit suite**

Run: `npm run test` — Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/purchases "src/app/(app)/purchases/[id]" src/lib/purchase-flow.ts src/lib/purchase-flow.test.ts src/server/modules/purchases/actions.ts
git commit -m "feat(purchases): detail page — bounce-back banner, stepper loop, thread, role editors"
```

---

### Task 12: `/purchases/[id]/edit` — draft editing

**Files:**
- Create: `src/app/(app)/purchases/[id]/edit/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { getPurchase, policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DraftForm, type UnitDraft } from "@/components/purchases/draft-form";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("purchasing_staff", "admin");
  const { id } = await params;
  const [request, loadouts] = await Promise.all([getPurchase(id), policyLoadouts()]);
  if (!request) notFound();
  // only a draft is editable, and only by its requester (or an admin) — the
  // server action enforces both; this keeps the dead end off the screen
  if (request.state !== "DRAFT") redirect(`/purchases/${id}`);
  if (request.requestedById !== user.id && user.role !== "admin") redirect(`/purchases/${id}`);

  const units: UnitDraft[] = request.units.map((u) => ({
    id: u.id,
    description: u.description,
    specs: u.specs ?? "",
    qty: String(u.qty),
    unitPrice: u.unitPrice === null ? "" : String(u.unitPrice),
  }));

  return (
    <>
      <PageHeader
        title={`Edit ${request.refNo}`}
        breadcrumb={[
          { label: "Purchase requests", href: "/purchases" },
          { label: request.refNo, href: `/purchases/${id}` },
          { label: "Edit" },
        ]}
      />
      <DraftForm loadouts={loadouts} initial={{ id: request.id, refNo: request.refNo, units }} />
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add "src/app/(app)/purchases/[id]/edit/page.tsx"
git commit -m "feat(purchases): draft editing reuses the multi-unit form"
```

---

### Task 13: `/purchases/activity`

Entry criterion #7 — the same `ActivityFeed` renderer as Phase 4, scoped to `entityType: "purchase-request"`, domain pill hidden (this is a scoped log, not a cross-domain one).

**Files:**
- Create: `src/app/(app)/purchases/activity/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { entityLabels } from "@/server/modules/audit/queries";
import { auditSentence } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed, actionDot, type ActivityItem } from "@/components/patterns/activity-feed";

const PAGE_SIZE = 50;
const WHERE = { entityType: "purchase-request" } as const;

export default async function PurchasingActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const rawPage = Math.max(1, Number.parseInt(toSearchParams(await searchParams).get("page") ?? "1", 10) || 1);

  const total = await prisma.auditEntry.count({ where: WHERE });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(rawPage, pageCount); // unbounded ?page= must not become a huge OFFSET
  const entries = await prisma.auditEntry.findMany({
    where: WHERE,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const labels = await entityLabels(entries);

  const items: ActivityItem[] = entries.map((e) => ({
    id: e.id,
    sentence: auditSentence({
      actorLabel: e.actorLabel,
      action: e.action,
      diff: e.diff,
      entityLabel: labels.get(`${e.entityType}:${e.entityId}`)!.label,
    }),
    when: fmtDateTime(e.createdAt),
    actor: e.actorLabel,
    dotValue: actionDot(e.action),
  }));

  return (
    <>
      <PageHeader title="Purchasing activity" />
      <div className="flex flex-col gap-2">
        {items.length > 0 ? (
          <>
            <ActivityFeed items={items} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount}</span>
              <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `?page=${p}`} />
            </div>
          </>
        ) : (
          <EmptyState title="Nothing has happened yet" description="Drafts, submissions and decisions all land here." />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add "src/app/(app)/purchases/activity/page.tsx"
git commit -m "feat(purchases): activity log reuses the Phase 4 feed renderer"
```

---

### Task 14: e2e, the full battery, and close-out

**Files:**
- Create: `e2e/purchases.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-17-phase-5-purchasing.md` (check the boxes), `docs/HANDOVER.md`

- [ ] **Step 1: Write the spec** (`e2e/purchases.spec.ts`)

```ts
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Seeded refNos this file depends on (prisma/seed.ts):
//   PR-0201 DRAFT · PR-0198 SUBMITTED (bounce-back: SUBMIT → IT_REVIEW → REQUEST_INFO)
//   PR-0195 IT_REVIEWED · PR-0188 COMPLETED · PR-0183 CANCELLED
// Spec files share one database and run alphabetically — each file reseeds so
// no file inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("purchases — the ?state= tab contract", () => {
  test("tabs write ?state= and the sidebar's By-status links land on them", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 }); // the sidebar only renders at lg:
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");

    await expect(page.getByRole("row", { name: /PR-0198/ })).toBeVisible();
    await page.getByRole("link", { name: /Awaiting IT/ }).first().click();
    await expect(page).toHaveURL(/state=SUBMITTED/);
    await expect(page.getByRole("row", { name: /PR-0198/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PR-0201/ })).toHaveCount(0);

    // the sidebar saved-filter link highlights when the params match
    const drafts = page.getByRole("link", { name: "My drafts" });
    await drafts.click();
    await expect(page).toHaveURL(/state=DRAFT/);
    await expect(drafts).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /PR-0201/ })).toBeVisible();
  });

  test("the state column carries how long it's been there", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases?state=SUBMITTED");
    await expect(page.getByRole("row", { name: /PR-0198/ })).toContainText("back from finance");
  });

  test("search and the two different empty states", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases?q=nothing-matches-this");
    await expect(page.getByText("No request matches this filter")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/purchases$/);
  });
});

test.describe("the bounce-back — README 1j", () => {
  test("names who sent it back, why, and the transition; the stepper marks the 2nd visit", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases?state=SUBMITTED");
    await page.getByRole("link", { name: "PR-0198" }).click();

    const banner = page.getByRole("alert").first();
    await expect(banner).toContainText("Finance sent this back");
    await expect(banner).toContainText("Unit 02: quote exceeds standing rate");
    await expect(banner).toContainText("IT_REVIEWED → SUBMITTED · nothing was cleared");
    await expect(banner.getByRole("link", { name: "Jump to unit 02" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Reply in thread" })).toBeVisible();

    const stepper = page.getByRole("list", { name: "Request progress" });
    await expect(stepper).toContainText("NOW · 2nd time");
    await expect(stepper).toContainText("← sent back");

    // the three-party thread renders as a conversation, oldest first
    await expect(page.getByText("Batch for the July hires.")).toBeVisible();
    await expect(page.getByText("Specs confirmed, docks need wattage check.")).toBeVisible();
    await expect(page.getByText("Unit 02: quote exceeds standing rate — attach vendor quote.")).toHaveCount(2); // banner + thread
  });

  test("axe is clean on the bounced detail page", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases?state=SUBMITTED");
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expectNoSeriousAxe(page);
  });
});

// The four tests below run in file order and deliberately hand work to each
// other: IT moves PR-0198 to IT_REVIEWED, finance bounces PR-0195 back, and
// the completion test then acts on whatever is left awaiting finance. Reorder
// them and the fixtures stop lining up.
test.describe.configure({ mode: "serial" });

test.describe("the three-party handoff", () => {
  test("purchasing drafts and submits; the draft autosaves", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases/new");

    await page.getByLabel("Line 1 description").fill("Standing desks");
    await page.getByLabel("Line 1 quantity").fill("3");
    await page.getByLabel("Line 1 unit price").fill("18500.50");
    // autosave debounces at 2.5s and allocates the PR-#### on first save
    await expect(page.getByText(/DRAFT · SAVED/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Submit for IT review" }).click();
    await page.waitForURL(/\/purchases\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("PR-02");
    await expect(page.getByText("SUBMITTED").first()).toBeVisible();
    // centavos survived the Decimal(12,2) round trip
    await expect(page.getByRole("row", { name: /Standing desks/ })).toContainText("18,50");
  });

  test("a submit with no price is refused", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases/new");
    await page.getByLabel("Line 1 description").fill("Unpriced thing");
    await page.getByRole("button", { name: "Submit for IT review" }).click();
    await expect(page.getByText(/Every line needs a price/)).toBeVisible();
  });

  test("IT reviews from its own workspace, and saving a line does not re-submit", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/purchases?state=SUBMITTED");
    await page.getByRole("link", { name: "PR-0198" }).click();

    // the IT slot editor renders inline for this role at this state
    await expect(page.getByText("IT SLOT EDITOR")).toBeVisible();
    const unit = page.getByRole("row", { name: /USB-C docks/ });
    await unit.getByLabel(/IT slot note/).fill("90W confirmed with vendor");
    await unit.getByRole("button", { name: "Save line" }).click();
    await expect(page.getByText("IT: 90W confirmed with vendor")).toBeVisible();
    // saving a line is not a transition: the request is still awaiting IT, and
    // the action that moves it is still on offer
    await expect(page.getByText("SUBMITTED").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark IT-reviewed" })).toBeVisible();

    await page.getByRole("button", { name: "Mark IT-reviewed" }).click();
    await expect(page.getByText("IT_REVIEWED").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark IT-reviewed" })).toHaveCount(0);
  });

  test("finance bounces it back, and the loop is visible again", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/purchases?state=IT_REVIEWED");
    await page.getByRole("link", { name: "PR-0195" }).click();

    await expect(page.getByText("FINANCE UNIT EDITOR")).toBeVisible();
    await page.getByRole("button", { name: "Request more info" }).click();
    await page.getByLabel("Reason").fill("Unit 01: attach the vendor quote before we release funds.");
    await page.getByRole("button", { name: "Request more info" }).last().click();

    await expect(page.getByRole("alert").first()).toContainText("Finance sent this back");
    await expect(page.getByRole("alert").first()).toContainText("attach the vendor quote");
    // nothing was cleared: the previously approved unit keeps its state
    await expect(page.getByRole("row", { name: /Wireless headsets/ })).toContainText("APPROVED");
  });

  test("finance completes a request and the lines settle", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/purchases?state=IT_REVIEWED");
    const first = page.getByRole("link", { name: /^PR-/ }).first();
    const refNo = (await first.textContent())?.trim();
    await first.click();
    await page.getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText("COMPLETED").first()).toBeVisible();
    await expect(page.getByRole("list").filter({ hasText: "Approved and completed." })).toBeVisible();
    expect(refNo).toMatch(/^PR-/);
  });
});

test.describe("read-only and the audit trail", () => {
  test("viewer sees the request with no mutating affordance", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/purchases");
    await expect(page.getByText("READ-ONLY · VIEWER").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "New request" })).toHaveCount(0);
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expect(page.getByRole("button", { name: /Send back|Mark IT-reviewed|Cancel request/ })).toHaveCount(0);
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
  });

  test("purchase actions land in /audit as PR links and in the purchasing activity log", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases/activity");
    await expect(page.getByText(/submitted PR-\d+ for IT review/).first()).toBeVisible();
    await expectNoSeriousAxe(page);

    await login(page, "admin@thebackroomop.com");
    await page.goto("/audit?entity=purchase-request");
    await expect(page.getByRole("link", { name: /PR-\d+/ }).first()).toBeVisible();
  });

  test("axe is clean on the list and the create form", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");
    await expectNoSeriousAxe(page);
    await page.goto("/purchases/new");
    await expectNoSeriousAxe(page);
  });
});
```

- [ ] **Step 2: Reseed and run the new spec alone**

```bash
npm run db:seed && npx playwright test e2e/purchases.spec.ts --workers=1
```

Expected: PASS. If a locator is ambiguous, fix the locator (or add the missing accessible name to the component) — never loosen an assertion about the bounce-back copy, the transition line, or the unchanged header state; those are the entry criteria.

- [ ] **Step 3: The full battery**

Stop any dev server first (`npm run build` and `next dev` share `.next`).

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

Expected: clean · clean · all unit tests pass (185 existing + the new purchase suites) · build succeeds.

```bash
npm run db:seed && npx playwright test --workers=1
```

Expected: PASS — the 51 existing e2e plus the new purchases spec.

- [ ] **Step 4: Commit**

```bash
git add e2e/purchases.spec.ts
git commit -m "test(e2e): purchasing — tab contract, bounce-back, three-party handoff, read-only, audit"
```

- [ ] **Step 5: Check off this plan**

Mark every `- [ ]` in this document as `- [x]`, and append a **Close-out** section at the end recording: anything that deviated from the plan, anything deferred, and the final battery numbers (unit test count, e2e test count).

```bash
git add docs/superpowers/plans/2026-08-17-phase-5-purchasing.md
git commit -m "docs(plan): phase 5 checked off + close-out"
```

- [ ] **Step 6: Advance the handover** (`docs/HANDOVER.md`)

Update, at minimum:
- the header line (commit, phase status: "Phases 1–5 merged, 6–8 remain");
- §0 "Start here" → Phase 6 (Finance + Home);
- §4 → add a **Phase 5 — Purchasing** paragraph naming the plan file and what shipped;
- the conventions table → add the purchase transition + NoteEntry-append shape;
- §5 → delete the Phase 5 bullet;
- §6 → replace the Phase 5 entry criteria with **Phase 6 entry criteria** (role-aware Home with independently degrading sections + Focus mode cookie; `/finance/assets` value columns; Finance Home leads with money and age; IT Home has no KPI row);
- §7 → add any new gotcha this phase produced;
- §8 → add anything deferred (e.g. `/purchases` has no sortable headers; the draft autosave has no offline/conflict merge).

```bash
git add docs/HANDOVER.md
git commit -m "docs: handover advanced — phase 5 done, phase 6 entry criteria"
```

- [ ] **Step 7: Finish the branch**

Use `superpowers:finishing-a-development-branch`: merge `phase-5-purchasing` into `main`, delete the branch, push.

---

## Self-review checklist (run before declaring the phase done)

- [ ] Every HANDOVER §6 entry criterion has a task: #1 → Task 1 + 7 · #2 → Task 7 · #3 → Tasks 3 + 11 · #4 → Tasks 2 + 9 · #5 → Tasks 7 + 11 · #6 → nothing in this phase writes an `Approval` or a `Job` (grep to confirm: `grep -rn "createApproval\|tx.job.create" src/server/modules/purchases` returns nothing) · #7 → Tasks 4 + 13 · #8 → Tasks 8 + 10.
- [ ] `grep -rn "state:" src/server/modules/purchases/actions.ts` — every request-state write goes through `runTransition`'s guarded `updateMany`.
- [ ] `NoteEntry` is only ever created, never updated or deleted (the DB trigger would raise anyway).
- [ ] No `Prisma.Decimal` reaches a `"use client"` module — `queries.ts` converts with `Number()`.
- [ ] The seeded PR-0198 thread still reads correctly after the phase (reseed and open it).
