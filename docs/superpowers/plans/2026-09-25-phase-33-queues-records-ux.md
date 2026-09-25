# Phase 33 — Laws of UX on the IT queues and records — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/approvals` and its detail page, `/inventory/labels`, the rest of `/reservations`, `/audit` and the four activity feeds, and the older list toolbars into line with the house standard: one decisive primary, a one-step Approve, the next item after each decision, search that finds what the screen shows, and every list shaped like every other list.

**Architecture:** Pure rules first (`src/lib/approval-header.ts`, `labels.ts`, `label-geometry.ts`, `tag-paste.ts`, `audit-list.ts`, `activity-list.ts`, `approvals-list.ts`, `holds.ts`), unit-tested; then shared list pieces in `src/components/patterns/`; then the server (`approveNow`, `nextInQueue`, approvals search, the entity-search resolver); then each screen. No migration.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / Postgres 16, zod 4, vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-09-24-queues-records-ux-design.md` (commit `4a39db8`). Read it before any task — it is the binding authority; this plan is its argument and records where the code forced a ruling (P-block).

**Facts files** (verbatim current code, every e2e pin with file:line, seed fixtures) — the controller copies both into the SDD workspace's `briefs/`:
- `phase-33-plan-facts-approvals.md` — approvals actions, state machine, queries, pages, components, shared UI, every approvals e2e pin, the seeded approvals table.
- `phase-33-plan-facts-lists.md` — labels, reservations, audit, feeds, the house list shape, pager locations, every pin on those screens, seed fixtures.

## Global Constraints

- Guard order **role → rate → zod** in every server action; refusals through `ActionResult`; one `writeAudit` per domain write inside its transaction; `AuditEntry` is append-only — tests never delete audit rows.
- **No migration.** No new tables, columns or preferences.
- Copy is pinned in spec §9 — use it verbatim. Subject first, no phase numbers, no roadmap talk; dates through `fmtDate` (Asia/Manila).
- Headers: one primary, visible secondaries only where the spec says, then `IconButton` ⋯ `aria-label="More actions"` opening `Menu` (`@/components/ui/menu`). Row menus named `Actions for {refNo}` / `Actions for {tag}`; the menu's cell and every in-row link stop propagation.
- Dialogs name the subject and confirm with a verb. No interactive element inside another. Product `aria-label`s never contain a nearby field's label word. Keep existing accessible names that e2e pins rely on unless a task says otherwise (e.g. `aria-label="Search audit log"`, `aria-label="Queue tabs"`, the queue's `group` label `Approval queue — …`).
- The house list shape on the lists this phase touches: search keyed on `state.q` with a Clear × (`aria-label="Clear search"`) and `· Enter` in the placeholder; value-only chips; navigations in a transition marking the table `data-pending` / `aria-busy`; `page n of m` only when `pageCount > 1`.
- Role discipline unchanged: only approvers act on approvals (`isApprover`, `canActOnApproval`); viewers and Finance read.
- Dev only in the worktree `.claude/worktrees/phase-33-queues-records-uiux` (its own `.env`: `inventory_dev`, `APP_BASE_URL=http://192.168.203.79:3100`, no `SEED_PASSWORD`). Never read or print `.env`. Never touch the `inventory` database or port 3000. Never seed staging.
- Playwright ONLY in the foreground: Bash with timeout 600000 and `run_in_background` omitted, never the Monitor tool, never end a turn while a process runs; one process at a time on port 3100, free before and after (`netstat -ano | findstr :3100 | findstr LISTENING`, else `taskkill /PID <pid> /T /F`). Command shape: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`.
- Agents never type passwords into the Browser pane.
- Git: never amend; never `git stash`, `checkout`, `restore`, `reset` or `switch`; `git add` new files before a pathspec commit. Files are CRLF — preserve endings, no `sed -i` on CRLF files. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- e2e specs never import helpers from other spec files; every existing pin a task changes is adapted in that task, never deleted.

## Plan decisions (P-n)

- **P-1** Execution order is strictly T1 → T10, one implementer at a time.
- **P-2 (spec §4.1 corrected)** The spec's row "CLAIMED by someone else, admin → Approve (admin override, as today)" does not match the code: `approvalTransition("CLAIMED", "approve", ctx)` requires `ctx.isOwner`, and today's UI offers an admin only Release and Reject on another person's claim. This phase adds no new privilege. `approvalHeader` for an admin on someone else's claim returns **no primary, Reject… visible, More: Release, Escalate**, and the header reads `Claimed by {name}`. `approvalTransition` is unchanged.
- **P-3** `approveNow` is its own `prisma.$transaction` in `approvals/actions.ts` (the shared `transition()` helper writes exactly one update and one audit row): claim then approve, with the same guards, the existing audit action names **`claim`** then **`approve`**, the same `EXECUTE_APPROVAL` job, the same `P2002` copy and revalidations.
- **P-4** `nextInQueue` filters explicitly: `approvalClassWhere(role)` AND (`PENDING` OR `CLAIMED` by this user) AND `id ≠ afterId`, ordered `slaAt asc, id asc`, `take: 1`; `null` for a non-approver.
- **P-5** Approvals search uses two plain query parameters, `q` and `type` (comma-separated types), beside today's `tab` / `via` / `page`. `hrefFor` emits exactly today's URLs when `q` and `type` are empty (pins such as `/approvals?tab=closed&via=direct` stay byte-identical). `q` matches `refNo`, asset `tag`, employee `name` / `employeeNo` (contains, insensitive). Both narrow every tab, the tab counts and the via counts.
- **P-6** The Reject **trigger** reads `Reject…`; its dialog keeps the title `Reject {refNo}?` and the confirm button `Reject` (danger).
- **P-7** Friendly words: `PRIORITY_LABEL` (`Normal` / `High` / `Urgent`) and `APPROVAL_KIND_LABEL` (`Assign` / `Return` / `Change status` / `Replace` / `Transfer`, for the Type facet) in `src/lib/labels.ts`. The queue's State column keeps the mono enum (the house prints it); its Priority column shows the friendly word (a `Pill` for High and Urgent). `APPROVAL_TYPE_LABEL` stays as is (line 1 of each row still prints it in mono).
- **P-8** `Next in queue →` / `Queue clear` render on the detail page whenever the viewer is an approver and `approvalHeader` returns no primary (after Approve, Reject or Retry, and on any closed or someone-else's item). Claim, Release and Escalate keep refreshing in place.
- **P-9** The labels Tags box resolves tags within the classes the role **manages** (`MANAGEABLE_CLASSES`), exactly as the existing `?ids=` path does (spec §5.1 says "may see"; for Purchasing the two differ, and one page must answer one way).
- **P-10** The Tags box is a plain GET form: the page reads `?tags=` and `?start=` (no server action). The `?ids=` path keeps its summary `{n} label(s) · {k} sheet(s)` and its `could not be printed and was skipped` banner (pinned); the Tags path shows `{n} labels · {k} skipped` plus the named skipped tags. Both paths show the on-sheet list (first 10, `and {k} more`). When nothing resolves (no parameters, or unresolved `?ids=`), the banner keeps its title `Nothing to print` (pinned) with the spec's new body copy, and the Tags box sits under it. More tags than `BULK_MAX` get the existing refusal sentence (`over the {BULK_MAX}-asset label cap … Nothing was printed.`).
- **P-11** `labelSlots(tags, startAt, perPage = LABELS_PER_PAGE)` is new; `labelPages` stays for its callers and tests. `?start=` is clamped to `1…LABELS_PER_PAGE` on the server; the field is `type="number" min=1 max=12`.
- **P-12** Reservations' Active tab drops the Reads column as the spec lists; the pin `offboarding.spec.ts:374` (`SPARE` on the Active page) is adapted to the new hint line `Held spares still read SPARE · …`, which carries the same fact. No textual pager is added to `/reservations` (the spec asks for the count line).
- **P-13** Shared pieces: `src/components/inventory/list-navigation.tsx` moves to `src/components/patterns/list-navigation.tsx` (imports updated, no shim); a new `src/components/patterns/search-box.tsx` holds the house search. The inventory and employee toolbars are **not** refactored onto them (spec §8: their behaviour and pins must not change); the five older lists use them.
- **P-14** `/audit` keeps `aria-label="Search audit log"`; the feeds' search is `aria-label="Search activity"`. The audit table stays free of buttons and checkboxes; each row keeps the raw action slug in mono beside the sentence.
- **P-15** The When facet is a single-choice pill group (`role="group"` `aria-label="When"`, links with `aria-current`, the `ClosedViaChips` shape), stored as `?when=today|7d|30d`, registered in `AUDIT_LIST_CONFIG.facets`.
- **P-16** `resolveEntitySearch(q, role)` lives in `src/server/modules/audit/search.ts`; the pure where-builders take its result as a `matchIds: string[]` argument, so they stay unit-testable.
- **P-17** The new e2e file `e2e/queues-records-ux.spec.ts` joins battery chunk **D** (56 → about 68).
- **P-18** Runtime fixtures for e2e are created with Prisma and restored in `finally` (never deleting audit rows); approvals-state fixtures are created fresh per case rather than mutating the seeded APR-20xx rows other cases rely on.

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/approval-header.ts` (new) | `approvalHeader`, `ApprovalVerb`, `VERB_LABEL` | T1 |
| `src/lib/labels.ts` | `PRIORITY_LABEL`, `APPROVAL_KIND_LABEL` | T1 |
| `src/lib/approvals-list.ts` | `approvalsSearchWhere`, `parseTypes`, `approvalsHref` | T1 |
| `src/lib/label-geometry.ts` | `labelSlots` | T1 |
| `src/lib/tag-paste.ts` (new) | `parseTagPaste` | T1 |
| `src/lib/audit-list.ts` | `whenRange`, `when` facet, `matchIds` in `buildAuditWhere` | T1 |
| `src/lib/activity-list.ts` | `q` + `matchIds` in `buildActivityWhere` | T1 |
| `src/lib/holds.ts` | `expiringSoon` | T1 |
| `src/components/patterns/list-navigation.tsx` (moved), `search-box.tsx` (new) | shared list pieces | T2 |
| `src/server/modules/approvals/actions.ts`, `queries.ts` | `approveNow`, `nextInQueue`, search + Type facet | T3 |
| `src/app/(app)/approvals/[id]/page.tsx`, `src/components/approvals/approval-header.tsx` (new), `next-in-queue.tsx` (new), `approval-actions.tsx` (replaced) | detail page | T4 |
| `src/app/(app)/approvals/page.tsx`, `src/components/approvals/queue-table.tsx`, `approvals-toolbar.tsx` (new) | queue | T5 |
| `src/app/(app)/inventory/labels/page.tsx`, `src/components/inventory/label-sheet.tsx`, `src/components/inventory/tags-box.tsx` (new) | labels | T6 |
| `src/app/(app)/reservations/page.tsx`, `src/components/reservations/holds-table.tsx`, `holds-toolbar.tsx`, `src/server/modules/reservations/queries.ts` | reservations | T7 |
| `src/server/modules/audit/search.ts` (new), `queries.ts`, `src/app/(app)/audit/page.tsx`, `audit/export/route.ts`, `src/components/patterns/audit-toolbar.tsx`, `when-pills.tsx` (new) | audit | T8 |
| `src/components/patterns/activity-list-page.tsx`, `activity-toolbar.tsx`, `src/components/offboarding/offboarding-toolbar.tsx`, `src/app/(app)/offboarding/page.tsx` | feeds + offboarding toolbar | T9 |
| `e2e/queues-records-ux.spec.ts` (new), docs | proof, battery, docs | T10 |

---

### Task 1: Pure rules

**Files:**
- Create: `src/lib/approval-header.ts`, `src/lib/approval-header.test.ts`, `src/lib/tag-paste.ts`, `src/lib/tag-paste.test.ts`
- Modify: `src/lib/labels.ts`, `src/lib/approvals-list.ts` (+ its test, create `src/lib/approvals-list.test.ts` if absent), `src/lib/label-geometry.ts` (+ test), `src/lib/audit-list.ts` (+ test), `src/lib/activity-list.ts` (+ test, create if absent), `src/lib/holds.ts` (+ test, create if absent)

**Interfaces (produced):**
```ts
// approval-header.ts
export type ApprovalVerb = "approve-now" | "approve" | "claim" | "release" | "escalate" | "retry";
export const VERB_LABEL: Record<ApprovalVerb, string>;
export interface HeaderCtx { state: ApprovalState; canAct: boolean; mine: boolean; isAdmin: boolean }
export function approvalHeader(ctx: HeaderCtx): { primary: ApprovalVerb | null; reject: boolean; more: ApprovalVerb[] }
// labels.ts
export const PRIORITY_LABEL: Record<Priority, string>;
export const APPROVAL_KIND_LABEL: Record<ApprovalType, string>;
// approvals-list.ts
export function parseTypes(raw: string | null | undefined): ApprovalType[]
export function approvalsSearchWhere(q: string, types: ApprovalType[]): Prisma.ApprovalWhereInput
export function approvalsHref(p: { tab: QueueTab; page?: number; via?: ClosedVia; q?: string; types?: ApprovalType[] }): string
// label-geometry.ts
export function labelSlots(tags: readonly string[], startAt: number, perPage?: number): (string | null)[][]
export function clampStart(raw: string | null | undefined): number   // 1…LABELS_PER_PAGE
// tag-paste.ts
export function parseTagPaste(text: string): string[]
// audit-list.ts
export const WHEN_VALUES: readonly ["today", "7d", "30d"];
export const WHEN_LABEL: Record<(typeof WHEN_VALUES)[number], string>;
export function whenRange(value: string | undefined, todayISO: string): { gte: Date } | null
export function buildAuditWhere(state: ListState, hidden?: HiddenAuditRefs, matchIds?: string[], todayISO?: string): Prisma.AuditEntryWhereInput
// activity-list.ts
export function buildActivityWhere(feed: ActivityFeed, state: ListState, hidden: HiddenAuditRefs, matchIds?: string[]): Prisma.AuditEntryWhereInput
// holds.ts
export function expiringSoon(rows: { state: string; expiresAt: Date | null }[], todayISO: string, days?: number): number
```

- [ ] **Step 1: Write the failing tests.**

`src/lib/approval-header.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ApprovalState } from "@prisma/client";
import { approvalTransition, type QueueAction } from "./approval-flow";
import { approvalHeader, VERB_LABEL, type ApprovalVerb } from "./approval-header";

const h = (state: ApprovalState, o: Partial<{ canAct: boolean; mine: boolean; isAdmin: boolean }> = {}) =>
  approvalHeader({ state, canAct: true, mine: false, isAdmin: false, ...o });

describe("approvalHeader — spec §4.1 with plan P-2", () => {
  it("PENDING: one-step Approve, Reject… visible, Claim and Escalate in More", () => {
    expect(h("PENDING")).toEqual({ primary: "approve-now", reject: true, more: ["claim", "escalate"] });
  });
  it("CLAIMED by me: Approve, Reject…, Release and Escalate", () => {
    expect(h("CLAIMED", { mine: true })).toEqual({ primary: "approve", reject: true, more: ["release", "escalate"] });
  });
  it("CLAIMED by someone else, admin: no primary (no override), Reject…, Release and Escalate", () => {
    expect(h("CLAIMED", { isAdmin: true })).toEqual({ primary: null, reject: true, more: ["release", "escalate"] });
  });
  it("CLAIMED by someone else, not admin: nothing", () => {
    expect(h("CLAIMED")).toEqual({ primary: null, reject: false, more: [] });
  });
  it("EXECUTION_FAILED: Retry and Reject…", () => {
    expect(h("EXECUTION_FAILED")).toEqual({ primary: "retry", reject: true, more: [] });
  });
  it("terminal states and roles that cannot act: nothing", () => {
    for (const s of ["APPROVED", "EXECUTED", "REJECTED"] as ApprovalState[]) expect(h(s)).toEqual({ primary: null, reject: false, more: [] });
    expect(h("PENDING", { canAct: false })).toEqual({ primary: null, reject: false, more: [] });
  });
  it("labels", () => {
    expect(VERB_LABEL).toEqual({
      "approve-now": "Approve", approve: "Approve", claim: "Claim", release: "Release", escalate: "Escalate", retry: "Retry",
    });
  });
});

describe("approvalHeader never offers a verb approvalTransition refuses", () => {
  const states: ApprovalState[] = ["PENDING", "CLAIMED", "APPROVED", "EXECUTED", "EXECUTION_FAILED", "REJECTED"];
  const steps = (v: ApprovalVerb): QueueAction[] => (v === "approve-now" ? ["claim", "approve"] : [v]);
  for (const state of states) for (const mine of [false, true]) for (const isAdmin of [false, true]) {
    it(`${state} mine=${mine} admin=${isAdmin}`, () => {
      const r = approvalHeader({ state, canAct: true, mine, isAdmin });
      for (const v of [r.primary, ...r.more].filter((x): x is ApprovalVerb => x !== null)) {
        let s: ApprovalState = state;
        let owner = mine;
        for (const a of steps(v)) {
          const t = approvalTransition(s, a, { isOwner: owner, isAdmin });
          expect(t.ok, `${v} via ${a} from ${s}`).toBe(true);
          if (t.ok && t.next) s = t.next;
          if (a === "claim") owner = true;
        }
      }
      if (r.reject) expect(approvalTransition(state, "reject", { isOwner: mine, isAdmin }).ok).toBe(true);
    });
  }
});
```

`src/lib/tag-paste.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseTagPaste } from "./tag-paste";

describe("parseTagPaste", () => {
  it("splits on lines, tabs and commas, trims, upper-cases and de-duplicates in first-seen order", () => {
    expect(parseTagPaste(" br-lt-0148 , BR-LT-0201\nbr-lt-0148\t BR-VH-0001 \r\n\n,")).toEqual(["BR-LT-0148", "BR-LT-0201", "BR-VH-0001"]);
  });
  it("empty input is an empty list", () => {
    expect(parseTagPaste("  \n , ")).toEqual([]);
  });
});
```

Append to `src/lib/label-geometry.test.ts`:
```ts
import { clampStart, labelSlots, LABELS_PER_PAGE } from "./label-geometry";

describe("labelSlots — Start at label N (spec §5.1)", () => {
  const tags = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
  it("start 1 fills from the first slot", () => {
    expect(labelSlots(tags(3), 1)).toEqual([["T1", "T2", "T3"]]);
  });
  it("start N leaves N-1 blank slots on page 1 only", () => {
    const pages = labelSlots(tags(10), 5);
    expect(pages[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(pages[0].slice(4)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]);
    expect(pages[1]).toEqual(["T9", "T10"]);
  });
  it("a start that fills page 1 exactly spills to page 2", () => {
    const pages = labelSlots(tags(2), LABELS_PER_PAGE);
    expect(pages[0].filter((s) => s === null)).toHaveLength(LABELS_PER_PAGE - 1);
    expect(pages[0][LABELS_PER_PAGE - 1]).toBe("T1");
    expect(pages[1]).toEqual(["T2"]);
  });
  it("no tags, no pages", () => {
    expect(labelSlots([], 4)).toEqual([]);
  });
  it("clampStart keeps 1…12", () => {
    expect([clampStart(undefined), clampStart("0"), clampStart("5"), clampStart("99"), clampStart("x")]).toEqual([1, 1, 5, LABELS_PER_PAGE, 1]);
  });
});
```

Append to `src/lib/audit-list.test.ts`:
```ts
import { whenRange, WHEN_LABEL } from "./audit-list";

describe("whenRange (Manila calendar)", () => {
  it("today, 7d, 30d start at Manila midnight; anything else is no filter", () => {
    expect(whenRange("today", "2026-09-25")).toEqual({ gte: new Date("2026-09-25T00:00:00+08:00") });
    expect(whenRange("7d", "2026-09-25")).toEqual({ gte: new Date("2026-09-19T00:00:00+08:00") });
    expect(whenRange("30d", "2026-09-25")).toEqual({ gte: new Date("2026-08-27T00:00:00+08:00") });
    expect(whenRange(undefined, "2026-09-25")).toBeNull();
    expect(whenRange("year", "2026-09-25")).toBeNull();
    expect(WHEN_LABEL).toEqual({ today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" });
  });
});

describe("buildAuditWhere — resolved matches and When", () => {
  const state = (q: string, when?: string) => ({ q, page: 1, sort: [], filters: when ? { when: [when] } : {} });
  it("q matches action, entityId, actor, and the resolved entity ids", () => {
    const w = buildAuditWhere(state("dennis"), NO_HIDDEN_REFS, ["e1", "a2"]);
    expect(JSON.stringify(w)).toContain('"entityId":{"in":["e1","a2"]}');
    expect(JSON.stringify(w)).toContain('"actorLabel"');
  });
  it("when narrows createdAt", () => {
    const w = buildAuditWhere(state("", "today"), NO_HIDDEN_REFS, [], "2026-09-25");
    expect(JSON.stringify(w)).toContain('"createdAt":{"gte":"2026-09-24T16:00:00.000Z"}');
  });
});
```
(Import `buildAuditWhere`, `NO_HIDDEN_REFS` if the file does not already.)

Append (or create) `src/lib/activity-list.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildActivityWhere } from "./activity-list";
import { NO_HIDDEN_REFS } from "./audit-list";

describe("buildActivityWhere — search (spec §6.1)", () => {
  const st = (q: string) => ({ q, page: 1, sort: [], filters: {} });
  it("no q, no search branch", () => {
    expect(JSON.stringify(buildActivityWhere("inventory", st(""), NO_HIDDEN_REFS))).not.toContain("actorLabel");
  });
  it("q adds action / actor / resolved ids, ANDed with the feed's own scope", () => {
    const w = JSON.stringify(buildActivityWhere("inventory", st("BR-LT"), NO_HIDDEN_REFS, ["a1"]));
    expect(w).toContain('"entityId":{"in":["a1"]}');
    expect(w).toContain('"actorLabel"');
    expect(w).toContain('"entityType"');
  });
});
```

Append (or create) `src/lib/approvals-list.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { approvalsHref, approvalsSearchWhere, parseTypes } from "./approvals-list";

describe("approvals search (plan P-5)", () => {
  it("parseTypes keeps only real types", () => {
    expect(parseTypes("lifecycle_return,nope,lifecycle_assign")).toEqual(["lifecycle_return", "lifecycle_assign"]);
    expect(parseTypes(undefined)).toEqual([]);
  });
  it("where: q over refNo, tag, employee; types in", () => {
    expect(approvalsSearchWhere("", [])).toEqual({});
    const w = JSON.stringify(approvalsSearchWhere("br-lt", ["lifecycle_return"]));
    expect(w).toContain('"refNo":{"contains":"br-lt","mode":"insensitive"}');
    expect(w).toContain('"tag":{"contains":"br-lt","mode":"insensitive"}');
    expect(w).toContain('"employeeNo"');
    expect(w).toContain('"type":{"in":["lifecycle_return"]}');
  });
  it("hrefs are byte-identical to today without q/type", () => {
    expect(approvalsHref({ tab: "open" })).toBe("/approvals");
    expect(approvalsHref({ tab: "closed", via: "direct" })).toBe("/approvals?tab=closed&via=direct");
    expect(approvalsHref({ tab: "open", page: 2 })).toBe("/approvals?page=2");
    expect(approvalsHref({ tab: "mine", q: "dennis", types: ["lifecycle_return"] }))
      .toBe("/approvals?tab=mine&q=dennis&type=lifecycle_return");
  });
});
```

Append (or create) `src/lib/holds.test.ts` — `expiringSoon`:
```ts
import { expiringSoon } from "./holds";

describe("expiringSoon — within the next two Manila days", () => {
  it("counts ACTIVE holds expiring today, tomorrow or the day after; not later, not expired, not other states", () => {
    const rows = [
      { state: "ACTIVE", expiresAt: new Date("2026-09-25T00:00:00+08:00") },
      { state: "ACTIVE", expiresAt: new Date("2026-09-27T00:00:00+08:00") },
      { state: "ACTIVE", expiresAt: new Date("2026-09-28T00:00:00+08:00") },
      { state: "ACTIVE", expiresAt: new Date("2026-09-24T00:00:00+08:00") },
      { state: "ACTIVE", expiresAt: null },
      { state: "FULFILLED", expiresAt: new Date("2026-09-25T00:00:00+08:00") },
    ];
    expect(expiringSoon(rows, "2026-09-25")).toBe(2);
  });
});
```

And `labels.ts` constants are asserted where used (T5) — add a one-line test in `approval-header.test.ts`:
```ts
import { APPROVAL_KIND_LABEL, PRIORITY_LABEL } from "./labels";
it("friendly priority and kind words", () => {
  expect(PRIORITY_LABEL).toEqual({ NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" });
  expect(APPROVAL_KIND_LABEL).toEqual({
    lifecycle_assign: "Assign", lifecycle_return: "Return", lifecycle_change_status: "Change status",
    lifecycle_replace: "Replace", lifecycle_transfer: "Transfer",
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/approval-header.test.ts src/lib/tag-paste.test.ts src/lib/label-geometry.test.ts src/lib/audit-list.test.ts src/lib/activity-list.test.ts src/lib/approvals-list.test.ts src/lib/holds.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Implement.**

`src/lib/approval-header.ts`:
```ts
import type { ApprovalState } from "@prisma/client";

/** The detail header's and the queue row menu's verbs (spec §4.1, plan P-2). */
export type ApprovalVerb = "approve-now" | "approve" | "claim" | "release" | "escalate" | "retry";

export const VERB_LABEL: Record<ApprovalVerb, string> = {
  "approve-now": "Approve", approve: "Approve", claim: "Claim", release: "Release", escalate: "Escalate", retry: "Retry",
};

export interface HeaderCtx { state: ApprovalState; canAct: boolean; mine: boolean; isAdmin: boolean }

const NONE = { primary: null, reject: false, more: [] as ApprovalVerb[] };

/**
 * One primary, a visible Reject…, the rest in More — by state. Never a verb
 * approvalTransition would refuse (the test proves it row by row). No admin
 * override on someone else's claim: the code has none and this phase adds none (P-2).
 */
export function approvalHeader(c: HeaderCtx): { primary: ApprovalVerb | null; reject: boolean; more: ApprovalVerb[] } {
  if (!c.canAct) return NONE;
  switch (c.state) {
    case "PENDING": return { primary: "approve-now", reject: true, more: ["claim", "escalate"] };
    case "CLAIMED":
      if (c.mine) return { primary: "approve", reject: true, more: ["release", "escalate"] };
      if (c.isAdmin) return { primary: null, reject: true, more: ["release", "escalate"] };
      return NONE;
    case "EXECUTION_FAILED": return { primary: "retry", reject: true, more: [] };
    default: return NONE;
  }
}
```

`src/lib/labels.ts` (add `Priority` to the type import):
```ts
/** Friendly priority words (Phase 33); the queue shows High and Urgent as a pill. */
export const PRIORITY_LABEL: Record<Priority, string> = { NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

/** Friendly request kinds for the approvals Type facet (Phase 33); line 1 of a row still prints APPROVAL_TYPE_LABEL. */
export const APPROVAL_KIND_LABEL: Record<ApprovalType, string> = {
  lifecycle_assign: "Assign", lifecycle_return: "Return", lifecycle_change_status: "Change status",
  lifecycle_replace: "Replace", lifecycle_transfer: "Transfer",
};
```

`src/lib/approvals-list.ts` (append; import `APPROVAL_KIND_LABEL` keys for the type list):
```ts
import { APPROVAL_KIND_LABEL } from "./labels";

const APPROVAL_TYPES = Object.keys(APPROVAL_KIND_LABEL) as ApprovalType[];

export function parseTypes(raw: string | null | undefined): ApprovalType[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter((s): s is ApprovalType => (APPROVAL_TYPES as string[]).includes(s));
}

/** Plan P-5: q over ref no, tag and person; types in. {} when neither is set. */
export function approvalsSearchWhere(q: string, types: ApprovalType[]): Prisma.ApprovalWhereInput {
  const and: Prisma.ApprovalWhereInput[] = [];
  const t = q.trim();
  if (t) {
    const c = { contains: t, mode: "insensitive" as const };
    and.push({ OR: [{ refNo: c }, { asset: { tag: c } }, { employee: { name: c } }, { employee: { employeeNo: c } }] });
  }
  if (types.length) and.push({ type: { in: types } });
  return and.length ? { AND: and } : {};
}

/** Today's exact URLs when q/type are empty (pins such as /approvals?tab=closed&via=direct stay byte-identical). */
export function approvalsHref(p: { tab: QueueTab; page?: number; via?: ClosedVia; q?: string; types?: ApprovalType[] }): string {
  const qs = new URLSearchParams();
  if (p.tab !== "open") qs.set("tab", p.tab);
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  if (p.tab === "closed" && p.via && p.via !== "all") qs.set("via", p.via);
  if (p.q?.trim()) qs.set("q", p.q.trim());
  if (p.types?.length) qs.set("type", p.types.join(","));
  const s = qs.toString().replaceAll("%2C", ",");
  return s ? `/approvals?${s}` : "/approvals";
}
```

`src/lib/label-geometry.ts` (append):
```ts
/** Spec §5.1: the first startAt−1 slots of page 1 stay blank so a half-used sheet can go back in. */
export function labelSlots(tags: readonly string[], startAt: number, perPage: number = LABELS_PER_PAGE): (string | null)[][] {
  if (tags.length === 0) return [];
  const lead = Math.min(Math.max(1, Math.floor(startAt)), perPage) - 1;
  const flat: (string | null)[] = [...Array<null>(lead).fill(null), ...tags];
  const pages: (string | null)[][] = [];
  for (let i = 0; i < flat.length; i += perPage) pages.push(flat.slice(i, i + perPage));
  return pages;
}

/** `?start=` → 1…LABELS_PER_PAGE (plan P-11). */
export function clampStart(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, LABELS_PER_PAGE);
}
```

`src/lib/tag-paste.ts`:
```ts
/** Spec §5.1: pasted or scanned tags — one per line, tab or comma; trimmed, upper-cased, first occurrence kept. */
export function parseTagPaste(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\r\n\t,]+/)) {
    const tag = raw.trim().toUpperCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}
```

`src/lib/audit-list.ts`: add `"when"` to `AUDIT_LIST_CONFIG.facets` (`["entity", "when"]`), and:
```ts
import { addDays, dayFromISO } from "./deadlines";

export const WHEN_VALUES = ["today", "7d", "30d"] as const;
export const WHEN_LABEL: Record<(typeof WHEN_VALUES)[number], string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

/** Spec §6.2, on the Manila calendar: today → from today's midnight; 7d → the last 7 days including today; 30d likewise. */
export function whenRange(value: string | undefined, todayISO: string): { gte: Date } | null {
  const back = value === "today" ? 0 : value === "7d" ? 6 : value === "30d" ? 29 : null;
  if (back === null) return null;
  return { gte: manilaMidnight(addDays(todayISO, -back)) };
}
const manilaMidnight = (iso: string) => new Date(`${iso}T00:00:00+08:00`);
```
(If `dayFromISO` already returns Manila midnight, use it instead of the local helper and drop the unused import; the test pins the exact instants.) Extend `buildAuditWhere(state, hidden = NO_HIDDEN_REFS, matchIds: string[] = [], todayISO = localDateISO())`: the `q` OR-clause gains `{ entityId: { in: matchIds } }` when `matchIds.length`; a `when` filter (`state.filters.when?.[0]`) ANDs `{ createdAt: whenRange(...) }` when non-null. Keep every existing branch (action / entityId / actorLabel contains, entity facet, hidden NOT-branch) unchanged.

`src/lib/activity-list.ts`: `buildActivityWhere(feed, state, hidden, matchIds: string[] = [])` ANDs, when `state.q.trim()` is set, `{ OR: [{ action: c }, { actorLabel: c }, ...(matchIds.length ? [{ entityId: { in: matchIds } }] : [])] }` with `c = { contains: q, mode: "insensitive" }` — alongside (never around) `feedWhere(feed, hidden)`.

`src/lib/holds.ts`:
```ts
/** Spec §5.2: ACTIVE holds expiring today, tomorrow or within `days` Manila days — never an already-expired one. */
export function expiringSoon(rows: { state: string; expiresAt: Date | null }[], todayISO: string, days = 2): number {
  return rows.filter((r) => {
    if (r.state !== "ACTIVE" || !r.expiresAt) return false;
    const d = daysUntil(r.expiresAt, todayISO);
    return d >= 0 && d <= days;
  }).length;
}
```
(import `daysUntil` from `./deadlines`.)

- [ ] **Step 4: Run to verify they pass** — the same command → PASS; then `npx tsc --noEmit` clean and full `npx vitest run` green (existing `audit-list` / `label-geometry` tests unchanged).

- [ ] **Step 5: Commit**
```bash
git add src/lib/approval-header.ts src/lib/approval-header.test.ts src/lib/tag-paste.ts src/lib/tag-paste.test.ts src/lib/labels.ts src/lib/approvals-list.ts src/lib/approvals-list.test.ts src/lib/label-geometry.ts src/lib/label-geometry.test.ts src/lib/audit-list.ts src/lib/audit-list.test.ts src/lib/activity-list.ts src/lib/activity-list.test.ts src/lib/holds.ts src/lib/holds.test.ts
git commit -m "feat(queues): pure rules for the approval header, approvals search, label slots, tag paste, When and feed search, expiring holds (Phase 33 T1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared list pieces

**Files:**
- Move: `src/components/inventory/list-navigation.tsx` → `src/components/patterns/list-navigation.tsx` (update every import: grep `list-navigation`)
- Create: `src/components/patterns/search-box.tsx`
- Test: `npx tsc --noEmit`; `E2E_PORT=3100 npx playwright test e2e/inventory-ux.spec.ts --workers=1 --global-timeout=540000` (the move must not change inventory behaviour)

**Interfaces (produced):** `ListNavigationProvider`, `useListNavigation`, `NavLink`, `ListPendingRegion` (unchanged API, new path); `SearchBox({ value, ariaLabel, placeholder, onSubmit }: { value: string; ariaLabel: string; placeholder: string; onSubmit: (q: string) => void })`.

- [ ] **Step 1: Move** `list-navigation.tsx` with `git mv`, update imports (inventory toolbar, inventory page, pagination users, any other). No behaviour change.

- [ ] **Step 2: `search-box.tsx`** — the inventory toolbar's search, extracted verbatim in behaviour (the inventory toolbar itself is **not** changed, P-13):
```tsx
"use client";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";

/** The house search (Phase 30 §3): keyed on the URL's q, Enter submits, Clear × clears. */
export function SearchBox({ value, ariaLabel, placeholder, onSubmit }: {
  value: string; ariaLabel: string; placeholder: string; onSubmit: (q: string) => void;
}) {
  return (
    <div className="relative w-[280px]">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint"><Icon name="search" size={14} /></span>
      <Input
        key={value}
        type="search"
        aria-label={ariaLabel}
        placeholder={placeholder}
        defaultValue={value}
        className="pl-8 pr-7"
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(e.currentTarget.value); }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-0.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-(--radius-ctl) text-fg-muted hover:bg-surface-subtle hover:text-fg"
          onClick={() => onSubmit("")}
        >
          ×
        </button>
      )}
    </div>
  );
}
```
(Use the same `Input` / `Icon` imports the inventory toolbar uses — read it for the exact paths.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit`, eslint on changed files, `npx vitest run`, then the inventory-ux run above (foreground) → pass. Port free after.

- [ ] **Step 4: Commit**
```bash
git add src/components/patterns/list-navigation.tsx src/components/patterns/search-box.tsx src/components src/app
git commit -m "refactor(patterns): the list-navigation hook moves to patterns and a shared house SearchBox joins it (Phase 33 T2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Approvals server — `approveNow`, `nextInQueue`, search and the Type facet

**Files:**
- Modify: `src/server/modules/approvals/actions.ts`, `src/server/modules/approvals/queries.ts`
- Test: `npx tsc --noEmit`; `E2E_PORT=3100 npx playwright test e2e/approvals-audit.spec.ts e2e/department-owned.spec.ts e2e/oversight.spec.ts --workers=1 --global-timeout=540000` (regression — no UI changed yet)

**Interfaces (produced):**
```ts
export async function approveNow(input: unknown): Promise<ActionResult<Acted>>
export async function nextInQueue(userId: string, role: Role, afterId: string): Promise<{ id: string; refNo: string } | null>
export async function listApprovals(tab, via, userId, role, page, search?: { q: string; types: ApprovalType[] })  // same return shape
export async function tabCounts(userId, role, search?)       // narrowed by search
export async function closedViaCounts(userId, role, search?)
export async function typeCounts(tab, via, userId, role, q: string): Promise<{ value: ApprovalType; label: string; count: number }[]>
```

- [ ] **Step 1: `approveNow` (plan P-3)** — append to `actions.ts`:
```ts
/**
 * Spec §4.1 decision 1: on a PENDING request, claim and approve in one transaction —
 * the same guards, the same two audit rows (claim, then approve) and the same
 * execution job as the two separate actions. Anything else is a conflict.
 */
export async function approveNow(input: unknown): Promise<ActionResult<Acted>> {
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  let acted: Acted | null = null;
  let failure;
  try {
    failure = await prisma.$transaction(async (tx) => {
      const a = await tx.approval.findUnique({ where: { id }, select: { id: true, refNo: true, state: true, asset: { select: { cls: true } } } });
      if (!a) return conflict("That approval no longer exists.");
      if (!canActOnApproval(user.role, a.asset?.cls ?? null)) return forbidden();
      const claim = approvalTransition(a.state, "claim", { isOwner: false, isAdmin: user.role === "admin" });
      if (!claim.ok) return conflict(claim.error);
      const claimed = await tx.approval.updateMany({
        where: { id, state: "PENDING" },
        data: { state: "CLAIMED", claimedById: user.id, claimedAt: new Date() },
      });
      if (claimed.count === 0) return conflict("Someone else changed this item first — refresh and retry.");
      await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "approval", entityId: id, action: "claim", diff: { state: { from: a.state, to: "CLAIMED" } } });
      const approve = approvalTransition("CLAIMED", "approve", { isOwner: true, isAdmin: user.role === "admin" });
      if (!approve.ok) return conflict(approve.error);
      const approved = await tx.approval.updateMany({ where: { id, state: "CLAIMED", claimedById: user.id }, data: { state: "APPROVED" } });
      if (approved.count === 0) return conflict("Someone else changed this item first — refresh and retry.");
      await tx.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: id } } });
      await writeAudit(tx, { actorId: user.id, actorLabel: user.name, entityType: "approval", entityId: id, action: "approve", diff: { state: { from: "CLAIMED", to: "APPROVED" } } });
      acted = { refNo: a.refNo, state: "APPROVED" };
      return null;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Execution for this item is already queued or running — the worker settles it first, then retry becomes available.");
    }
    throw err;
  }
  if (failure) return failure;
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
  return ok(acted!);
}
```
If the existing `transition()` revalidates more paths than these two, mirror its list exactly.

- [ ] **Step 2: Search and counts (plan P-5)** — thread `search = { q: "", types: [] }` through `listApprovals`, `tabCounts`, `closedViaCounts`, ANDing `approvalsSearchWhere(search.q, search.types)` into each `where`. Add:
```ts
/** Type facet options for the current tab + q (the facet's own selection cleared), friendly labels. */
export async function typeCounts(tab: QueueTab, via: ClosedVia, userId: string, role: Role, q: string) {
  const where = { AND: [tabWhere(tab, userId), tab === "closed" ? viaWhere(via) : {}, approvalClassWhere(role), approvalsSearchWhere(q, [])] };
  const groups = await prisma.approval.groupBy({ by: ["type"], where, _count: { _all: true } });
  const by = new Map(groups.map((g) => [g.type, g._count._all]));
  return (Object.keys(APPROVAL_KIND_LABEL) as ApprovalType[]).map((value) => ({ value, label: APPROVAL_KIND_LABEL[value], count: by.get(value) ?? 0 }));
}
```

- [ ] **Step 3: `nextInQueue` (plan P-4)**:
```ts
/** Spec §4.1: the next request this user can act on, in the Open tab's SLA order. */
export async function nextInQueue(userId: string, role: Role, afterId: string): Promise<{ id: string; refNo: string } | null> {
  if (!isApprover(role)) return null;
  return prisma.approval.findFirst({
    where: {
      AND: [
        approvalClassWhere(role),
        { OR: [{ state: "PENDING" }, { state: "CLAIMED", claimedById: userId }] },
        { id: { not: afterId } },
      ],
    },
    orderBy: [{ slaAt: "asc" }, { id: "asc" }],
    select: { id: true, refNo: true },
  });
}
```

- [ ] **Step 4: Verify** — tsc, eslint, vitest; the foreground regression run above → all pass (nothing visible changed). Port free.

- [ ] **Step 5: Commit**
```bash
git add src/server/modules/approvals/actions.ts src/server/modules/approvals/queries.ts
git commit -m "feat(approvals): approveNow claims and approves in one transaction, nextInQueue, search and the Type facet on the queue queries (Phase 33 T3)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The approval detail page (spec §4.1)

**Files:**
- Create: `src/components/approvals/approval-header.tsx`, `src/components/approvals/next-in-queue.tsx`
- Modify: `src/app/(app)/approvals/[id]/page.tsx`, `src/components/approvals/approval-actions.tsx` (becomes the failure/queued notice only, or is removed if nothing remains)
- Adapt e2e: `approvals-audit.spec.ts` L112-121 (PENDING detail: Approve visible, Reject… visible, Claim and Escalate as `menuitem`s in More), L178-188 (the failure sentence visible; open the `Worker error` disclosure, then the raw text), `department-owned.spec.ts` L90/L92/L113/L146/L148 (Claim now in More, or use the one-step Approve — keep each case's intent: Purchasing approves its own class; a cross-class user sees no Claim), axe routes re-verified.

**Interfaces:** `ApprovalHeaderActions({ id, refNo, plan, ownerName })` where `plan = approvalHeader(...)`; `NextInQueue({ next }: { next: { id: string; refNo: string } | null })`.

- [ ] **Step 1: `approval-header.tsx`** (client): renders, in order, the primary `Button variant="primary"` (label `VERB_LABEL[plan.primary]`), a visible `Button` `Reject…` when `plan.reject`, and a `Menu` (`IconButton aria-label="More actions"`) with `plan.more` items. Each verb calls its action — `approve-now` → `approveNow`, `approve` → `approveApproval`, `claim` → `claimApproval`, `release` → `releaseApproval`, `escalate` → `escalateApproval`, `retry` → `retryApproval` — with the existing result handling (toast `${refNo} ${verb}` settled, `RateLimitNotice`, fault banner). `Reject…` opens the existing reject dialog (title `Reject {refNo}?`, `ReasonField` + `REASON_CHIPS["approval.reject"]`, Cancel / `Reject` danger) — move that markup here unchanged. After every success: `router.refresh()` (the page then renders Next in queue when the header has no primary — P-8). When `plan` is empty and the item is CLAIMED by someone else, render `Claimed by {ownerName}` in muted text instead.

- [ ] **Step 2: `next-in-queue.tsx`** (server-safe):
```tsx
import Link from "next/link";
/** Spec §4.1 goal gradient: after a decision, the next request — or Queue clear. */
export function NextInQueue({ next }: { next: { id: string; refNo: string } | null }) {
  return next
    ? <Link href={`/approvals/${next.id}`} className="text-[12.5px] font-medium text-accent hover:underline">Next in queue → <span className="font-mono">{next.refNo}</span></Link>
    : <Link href="/approvals" className="text-[12.5px] font-medium text-accent hover:underline">Queue clear</Link>;
}
```

- [ ] **Step 3: The page.** `plan = approvalHeader({ state: approval.state, canAct, mine, isAdmin: user.role === "admin" })`. `PageHeader actions={<ApprovalHeaderActions … />}`. When `isApprover(user.role) && plan.primary === null`, render `<NextInQueue next={await nextInQueue(user.id, user.role, approval.id)} />` under the header line. Card order: **Before → after first**, then What the system checked / How it was applied. Execution failure (`state === "EXECUTION_FAILED"`): a `Banner tone="fault"` titled `The change could not be applied.` with, when `workerError` names a known cause, one sentence — `The target person is no longer active.` for `/OFFBOARDED/`, `The asset's status changed since the request.` for `/status/i`, `The asset's holder changed since the request.` for `/holder|assignee/i` — then `<details><summary>Worker error</summary><pre>{workerError}</pre></details>`. A `lifecycle_return` whose employee is OFFBOARDING links `Open the offboarding wizard →` to `/offboarding/{employee.id}?step=collect`. Priority in the badge: `PRIORITY_LABEL`. The APPROVED "Queued for execution" notice stays.

- [ ] **Step 4: Adapt pins** (facts §13) and run foreground: `E2E_PORT=3100 npx playwright test e2e/approvals-audit.spec.ts e2e/department-owned.spec.ts e2e/oversight.spec.ts e2e/it-nav.spec.ts e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` (split into two runs if tight) → pass. tsc, eslint, vitest. Port free.

- [ ] **Step 5: Commit**
```bash
git add src/components/approvals src/app/(app)/approvals/[id]/page.tsx e2e/approvals-audit.spec.ts e2e/department-owned.spec.ts
git commit -m "feat(approvals): the request page leads with the decision — one-step Approve, Reject… beside it, the rest in More, Next in queue after, the change before the checks, plain failure words (Phase 33 T4)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The approvals queue (spec §4.2)

**Files:**
- Create: `src/components/approvals/approvals-toolbar.tsx`
- Modify: `src/app/(app)/approvals/page.tsx`, `src/components/approvals/queue-table.tsx`, `src/components/approvals/closed-via-chips.tsx` (its `hrefFor` callback now builds through `approvalsHref`)
- Adapt e2e: `approvals-audit.spec.ts` L131 `toContainText("HIGH")` → `"High"`; any tab pin still matches `navigation "Queue tabs"`; `paging.spec.ts` approvals case re-verified.

- [ ] **Step 1: Page state.** Read `q = sp.get("q") ?? ""`, `types = parseTypes(sp.get("type"))`; pass `{ q, types }` to `listApprovals`, `tabCounts`, `closedViaCounts`; `typeCounts(tab, via, user.id, user.role, q)` for the facet. Every link builds through `approvalsHref({ tab, page, via, q, types })`.

- [ ] **Step 2: Tabs.** Replace the hand-rolled `<nav>` with `<Tabs label="Queue tabs" items={QUEUE_TABS.map(t => ({ label: <>{t.label}<span className="ml-1.5 font-mono text-[10px] text-fg-faint">{counts[t.id]}</span></>, href: approvalsHref({ tab: t.id, q, types }), active: t.id === tab }))} />`.

- [ ] **Step 3: Toolbar** (`approvals-toolbar.tsx`, client): `SearchBox` (`ariaLabel="Search approvals"`, placeholder `Search ref no, tag, person · Enter`) and a `FacetDropdown` titled `Type` over `typeCounts`, both navigating through `useListNavigation().navigate(approvalsHref(...))` (page reset to 1). Under it a `ChipFilterRow` of value-only chips (`q` → `Search: {q}`, each type → its friendly label) with `clearHref = approvalsHref({ tab, via })`. Wrap the table in `ListNavigationProvider` + `ListPendingRegion`.

- [ ] **Step 4: Rows.** In `queue-table.tsx`: a final column (`Th aria-label="Row actions"`) with a `Menu` per row the user can act on — items from `approvalHeader({ state: row.state, canAct, mine: row.mine, isAdmin })` (primary first, `Reject…` if `reject`, then `more`) plus `Open`; trigger `IconButton aria-label={`Actions for ${row.refNo}`}`; the cell stops propagation. `Approve` on a PENDING row calls `approveNow`; on a mine CLAIMED row `approveApproval`; `Reject…` opens the existing reject dialog. The keyboard contract (C/A/R/E, `group` label, announcements, the "Claim it first" short-circuit on `a`) is unchanged. Row 1's selected styling shows only while the wrapper has focus (track focus with `onFocus`/`onBlur` on the wrapper). Priority column: `PRIORITY_LABEL[row.priority]` (a `Pill tone="accent"` for High and Urgent, plain text for Normal). `isAdmin` comes from the page.

- [ ] **Step 5: Paging line.** `{total} in this tab — ordered by SLA` (non-closed tabs; the closed tab `{total} in this tab`), with `page {page} of {pageCount} · ` prefixed only when `pageCount > 1`.

- [ ] **Step 6: Verify** — tsc, eslint, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/approvals-audit.spec.ts e2e/oversight.spec.ts e2e/paging.spec.ts e2e/auth-shell.spec.ts e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` (split if tight) → pass. Port free.

- [ ] **Step 7: Commit**
```bash
git add src/components/approvals src/app/(app)/approvals/page.tsx e2e/approvals-audit.spec.ts
git commit -m "feat(approvals): the queue gains search, a Type facet, a row menu with one-step Approve, shared tabs, friendly priority and a pager line only when there are pages (Phase 33 T5)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Labels (spec §5.1)

**Files:**
- Create: `src/components/inventory/tags-box.tsx`
- Modify: `src/app/(app)/inventory/labels/page.tsx`, `src/components/inventory/label-sheet.tsx`
- Adapt e2e: `labels.spec.ts:144` (the `Nothing to print` banner's body copy changes — keep the title assertion); everything else in `labels.spec.ts` / `department-owned.spec.ts:265-278` must pass unchanged (P-10).

- [ ] **Step 1: The page.** Read `ids` (as today), `tagsRaw = sp.tags`, `start = clampStart(sp.start)`, and the class the operator came from (`cls` param, default IT) for the crumb. If `ids` present → today's path (refusal over `BULK_MAX`, `MANAGEABLE_CLASSES` scoping, summary `{n} label(s) · {k} sheet(s)`, the `could not be printed and was skipped` banner). Else if `tagsRaw` → `tags = parseTagPaste(tagsRaw)`; over `BULK_MAX` → the same refusal sentence with `{tags.length}`; resolve `prisma.asset.findMany({ where: { tag: { in: tags }, cls: { in: [...MANAGEABLE_CLASSES[user.role]] } }, select: { tag: true, model: true } })`, keep the typed order, `skipped = tags.filter(t => !found.has(t))`; summary `{n} labels · {k} skipped`, and when `k > 0` a line `{skipped.join(", ")} — not found or not your class`. Both paths list the tags on the sheet (first 10, then `and {k} more`). When nothing resolves (no parameters, or unresolved `ids`/`tags`): `Banner tone="attention" title="Nothing to print"` with body `Select assets on the list, then choose Print labels in the selection bar — or Print label from a record's More menu.`, then the `TagsBox` (P-10).

- [ ] **Step 2: `tags-box.tsx`** — a plain GET form to `/inventory/labels`: a labelled `Textarea` (`Tags`, hint `One per line, or separated by commas — paste or scan`, `name="tags"`), a number `Input` (`Start at label`, `name="start"`, `min=1 max={LABELS_PER_PAGE}`, default 1), and a `Make sheet` submit. On the sheet view, a small GET form re-submits the same `tags`/`ids` with a new `start` (so `Start at label` works on both paths).

- [ ] **Step 3: Sheet.** `LabelSheet` gains `startAt?: number` and renders from `labelSlots(rows.map(r => r.tag), startAt ?? 1)`; a `null` slot renders an empty label cell of the same size. The sheet count uses the same call.

- [ ] **Step 4: Crumb and QR note.** `breadcrumb={[{ label: cls === "PURCHASING" ? "Purchasing assets" : "Inventory", href: "/inventory" + withClsQS("", cls) }, { label: "Print labels" }]}` on every branch. When `qrBase(APP_BASE_URL)` is not ok: a `Banner tone="attention"` `No QR on these labels — the app's address is set to this computer only. Ask the administrator to set the network address.`, and for admin a `details` (`Why`) holding the existing per-cause `QR_NOTE` text.

- [ ] **Step 5: Verify** — tsc, eslint, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/labels.spec.ts e2e/department-owned.spec.ts e2e/registration.spec.ts e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` (split if tight) → pass. Port free.

- [ ] **Step 6: Commit**
```bash
git add src/components/inventory/tags-box.tsx src/components/inventory/label-sheet.tsx src/app/(app)/inventory/labels/page.tsx e2e/labels.spec.ts
git commit -m "feat(labels): print from pasted or scanned tags, start at any label on a used sheet, name what was skipped, a class-aware crumb and plain QR words (Phase 33 T6)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Reservations (spec §5.2)

**Files:**
- Modify: `src/app/(app)/reservations/page.tsx`, `src/components/reservations/holds-table.tsx`, `src/components/reservations/holds-toolbar.tsx`, `src/server/modules/reservations/queries.ts`
- Adapt e2e: `offboarding.spec.ts:374` (`SPARE` → assert the hint line `Held spares still read SPARE` — P-12); `holds.spec.ts` and `it-work-ux.spec.ts` must pass unchanged.

- [ ] **Step 1: Banner → hint.** Replace the neutral `Banner` with `<p className="text-[11.5px] text-fg-muted">Held spares still read SPARE · place holds from a record or a profile</p>` under the tabs.

- [ ] **Step 2: Columns per tab** in `HoldsTable` (prop `tab`): Active — Asset, Model, For, Reason, Expires (sortable, keeps its header button), menu; Fulfilled — Asset, Model, For, Reason, Fulfilled on (`resolved`), menu; Closed — Asset, Model, For, Reason, State (`Released` / `Expired` from `r.state`), Closed (`resolved`), menu. The row click and the row menu are unchanged.

- [ ] **Step 3: Count line.** The query returns, for the Active tab, `soon = expiringSoon(activeFilteredRows, localDateISO())` computed over the Active tab's filtered set (a `findMany` selecting `state, expiresAt` with the same `buildHoldWhere("ACTIVE", state)`). The toolbar's count line reads `{n} holds · {k} expire within 2 days` (the second part only when `k > 0`, a link to the Active tab sorted by `expiresAt` asc).

- [ ] **Step 4: Toolbar.** `SearchBox` (`ariaLabel="Search holds"`, placeholder `Tag, model or person · Enter`), the two `FacetDropdown`s, a value-only `ChipFilterRow`, navigation through `useListNavigation` with `ListPendingRegion` around the table.

- [ ] **Step 5: Verify** — tsc, eslint, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/holds.spec.ts e2e/offboarding.spec.ts e2e/it-work-ux.spec.ts e2e/paging.spec.ts --workers=1 --global-timeout=540000` (split if tight) → pass. Port free.

- [ ] **Step 6: Commit**
```bash
git add src/app/(app)/reservations/page.tsx src/components/reservations src/server/modules/reservations/queries.ts e2e/offboarding.spec.ts
git commit -m "feat(reservations): a one-line hint, columns that fit each tab, an expiring-soon count, and the house toolbar (Phase 33 T7)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `/audit` (spec §6)

**Files:**
- Create: `src/server/modules/audit/search.ts`, `src/components/patterns/when-pills.tsx`
- Modify: `src/server/modules/audit/queries.ts` (`listAudit` takes `matchIds`), `src/app/(app)/audit/page.tsx`, `src/app/(app)/audit/export/route.ts`, `src/components/patterns/audit-toolbar.tsx`
- Adapt e2e: `approvals-audit.spec.ts:216` (`entity: Approval` chip → value-only `Approval`); keep `:210-211` (no buttons/checkboxes in the table), `:227` (`getByLabel("Search audit log")`), `it-nav.spec.ts:542-546` (`department`, `rename`, `Operations X` still in the row) passing.

- [ ] **Step 1: `search.ts` (P-16):**
```ts
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { visibleClassWhere } from "@/lib/asset-class";
import { approvalClassWhere } from "@/lib/approval-access";

/** Spec §6.1: what the Entity column shows — tag, person, ref no — resolved to ids this role may see. */
export async function resolveEntitySearch(q: string, role: Role): Promise<string[]> {
  const t = q.trim();
  if (!t) return [];
  const c = { contains: t, mode: "insensitive" as const };
  const [assets, employees, approvals] = await Promise.all([
    prisma.asset.findMany({ where: { AND: [{ tag: c }, visibleClassWhere(role)] }, select: { id: true }, take: 100 }),
    prisma.employee.findMany({ where: { OR: [{ name: c }, { employeeNo: c }] }, select: { id: true }, take: 100 }),
    prisma.approval.findMany({ where: { AND: [{ refNo: c }, approvalClassWhere(role)] }, select: { id: true }, take: 100 }),
  ]);
  return [...assets, ...employees, ...approvals].map((r) => r.id);
}
```

- [ ] **Step 2: Page, export, queries.** Both the page and the export route compute `matchIds = await resolveEntitySearch(state.q, user.role)` and pass it to `buildAuditWhere(state, hidden, matchIds)` (the `when` filter comes from `state.filters.when`). `/audit` rows: columns When · Entity (a `Pill` in friendly words — `humanize(entityType)` — plus the linked label) · What happened (`auditSentence({ actorLabel, action, diff, entityLabel }, { omitEntity: true })`) · Action (the raw slug in mono). No buttons or checkboxes inside the table. Chips value-only (`humanize(value)`, and `WHEN_LABEL[when]` for When). Pager: `page n of m` only when `pageCount > 1`.

- [ ] **Step 3: Toolbar.** `audit-toolbar.tsx`: `SearchBox` with `ariaLabel="Search audit log"` (kept — P-14) and placeholder `Search tag, person, ref no, action · Enter`; the Entity `FacetDropdown`; `WhenPills` (`role="group" aria-label="When"`, links for `Today` / `Last 7 days` / `Last 30 days`, `aria-current` on the active one, a second click on the active one clears it); navigation through `useListNavigation`, `ListPendingRegion` around the table.

- [ ] **Step 4: Verify** — tsc, eslint, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/approvals-audit.spec.ts e2e/it-nav.spec.ts e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000` (split if tight) → pass. Port free.

- [ ] **Step 5: Commit**
```bash
git add src/server/modules/audit src/app/(app)/audit src/components/patterns/audit-toolbar.tsx src/components/patterns/when-pills.tsx e2e/approvals-audit.spec.ts
git commit -m "feat(audit): search finds tags, people and ref nos, rows read as sentences with the action beside them, a When filter, value-only chips (Phase 33 T8)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The activity feeds and the offboarding toolbar

**Files:**
- Modify: `src/components/patterns/activity-list-page.tsx`, `src/components/patterns/activity-toolbar.tsx`, `src/server/modules/audit/queries.ts` (`listActivity` takes `matchIds`), `src/components/offboarding/offboarding-toolbar.tsx`, `src/app/(app)/offboarding/page.tsx`
- Adapt e2e: `activity.spec.ts` (re-read in full: paging + facet + Clear must keep passing once `q` is no longer stripped).

- [ ] **Step 1: Feeds.** Stop stripping `q` in both files (delete the "no search on the feeds" comments). `activity-list-page.tsx` resolves `matchIds = await resolveEntitySearch(state.q, user.role)` and passes it to `listActivity` → `buildActivityWhere(feed, state, hidden, matchIds)`. `activity-toolbar.tsx`: `SearchBox` (`ariaLabel="Search activity"`, placeholder `Search tag, person, ref no · Enter`), the Action facet, a value-only `ChipFilterRow` replacing the bare Clear link, navigation through `useListNavigation`, `ListPendingRegion` around the feed. Pager: `page n of m` only when `pageCount > 1`.

- [ ] **Step 2: Offboarding toolbar.** Its three facets navigate through `useListNavigation` with `ListPendingRegion` around the queue table; a value-only `ChipFilterRow` for the active facets. No search box (the queue has none, and `listOffboarding` reads no `q`).

- [ ] **Step 3: Verify** — tsc, eslint, vitest; foreground `E2E_PORT=3100 npx playwright test e2e/activity.spec.ts e2e/offboarding.spec.ts e2e/offboarding-v2.spec.ts e2e/it-work-ux.spec.ts --workers=1 --global-timeout=540000` (split if tight) → pass. Port free.

- [ ] **Step 4: Commit**
```bash
git add src/components/patterns src/server/modules/audit/queries.ts src/components/offboarding/offboarding-toolbar.tsx src/app/(app)/offboarding/page.tsx e2e/activity.spec.ts
git commit -m "feat(feeds): the four activity feeds gain search by tag, person and ref no; the feeds and the offboarding queue take the house toolbar (Phase 33 T9)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The phase's own e2e, the battery, the docs

**Files:** Create `e2e/queues-records-ux.spec.ts`; docs as in Phase 32 (a (z) block in `HANDOVER.md`, §0 item 9's chunk D line gains the file, `PICKUP.md`, `HANDOVER-PENDING.md`, the spec's Status line, this plan's D-block).

- [ ] **Step 1: Write `e2e/queues-records-ux.spec.ts`** (about 12 cases; house shape — copy `login` / `expectNoSeriousAxe` / `waitForHydration` from `e2e/it-work-ux.spec.ts`; `beforeAll` runs `npm run db:seed`; per-case Prisma fixtures restored in `finally`, P-18):
  1. A fresh PENDING IT approval's detail header: primary `Approve`, a visible `Reject…`, `More actions` lists `Claim` and `Escalate`.
  2. One-step Approve on it: toast `{refNo} approved`; the DB shows it APPROVED with two new audit rows (`claim`, `approve`) for this id; `Next in queue →` appears.
  3. `Reject…` from the header on another fresh PENDING approval: the dialog `Reject {refNo}?`, a reason, confirm → `{refNo} rejected`.
  4. A fresh EXECUTION_FAILED approval: `The change could not be applied.` visible; the raw error hidden until `Worker error` is opened.
  5. The queue row menu `Actions for {refNo}` → `Approve` on a fresh PENDING row approves it.
  6. Queue search by a tag narrows the Open tab and its count; the Type facet (`Return`) narrows further; value-only chips; Clear search restores.
  7. Labels Tags box: `BR-LT-0148, BR-LT-0201` + `BR-VH-0001` as it@ → `2 labels · 1 skipped` and `BR-VH-0001 — not found or not your class`.
  8. `Start at label 5` leaves four blank slots on page 1 (count empty label cells).
  9. The labels crumb reads `Purchasing assets › Print labels` for `?cls=PURCHASING` as purchasing@.
  10. Reservations: the hint line; the Active tab's columns (no Reads, has Expires); `{n} holds · {k} expire within 2 days` with a runtime hold expiring tomorrow.
  11. `/audit` search `BR-LT-0148` returns rows for that asset; search a person's name returns their rows; rows read as sentences with the action in mono; `Today` narrows; axe.
  12. `/inventory/activity` search by a tag narrows the feed; paging keeps `q`.
  Each screen case ends with `expectNoSeriousAxe(page)`.

- [ ] **Step 2: Run the new file** foreground → all pass.

- [ ] **Steps 3–5 (run after the final whole-branch review's fix wave, on the final tree — the Phase 32 R9 precedent):** `npx playwright test --list | tail -1` (428 today + the new cases, 42 files); the seven foreground chunks with `e2e/queues-records-ux.spec.ts` appended to **D**; `npm run db:seed` last; docs (CRLF-safe Python edits anchored on unique text; never record a password value).

- [ ] **Step 6: Commit** — the spec file first (`test(e2e): Phase 33 -- queues-records-ux, 12 cases (chunk D)`), the docs after the battery.

---

## Self-review

- **Spec coverage:** §3 rules → T1; §4.1 → T3 (`approveNow`, `nextInQueue`), T4; §4.2 → T3 (search, Type facet), T5; §5.1 → T1 (`labelSlots`, `parseTagPaste`), T6; §5.2 → T1 (`expiringSoon`), T7; §6.1 → T1 (where-builders), T8 (`resolveEntitySearch`, `/audit`), T9 (feeds); §6.2 → T1 (`whenRange`), T8; §6.3 → T8, T9; §7 → T3, T6, T7, T8; §8 → T2, T5, T7, T8, T9; §9 copy → the tasks that render it; §10 edge cases → T3 (conflict copy, Next skips others' claims, no admin override P-2), T6 (cap, other class, clamp), T8/T9 (AND of search + facets + When, cuid still matches, feed scoping); §11 → T1 units, every task's adapted pins, T10.
- **Placeholder scan:** none found; UI edits name the exact elements, copy and props, with the facts files holding the verbatim current code.
- **Type consistency:** `approvalHeader` / `ApprovalVerb` / `VERB_LABEL` (T1) in T4 and T5; `approvalsSearchWhere` / `parseTypes` / `approvalsHref` (T1) in T3 and T5; `labelSlots` / `clampStart` (T1) in T6; `parseTagPaste` (T1) in T6; `whenRange` / `WHEN_LABEL` / `buildAuditWhere(state, hidden, matchIds)` (T1) in T8; `buildActivityWhere(feed, state, hidden, matchIds)` (T1) in T9; `expiringSoon` (T1) in T7; `SearchBox` / `list-navigation` (T2) in T5, T7, T8, T9; `approveNow` / `nextInQueue` / `typeCounts` (T3) in T4, T5; `resolveEntitySearch` (T8) in T9.

## D-block (decisions made during execution)

(Filled in during execution: each ruling as `D-n — what — why — cost if wrong`.)
