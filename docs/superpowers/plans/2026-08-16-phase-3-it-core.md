# Inventory v2 — Phase 3: IT Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The IT workspace's working core — `/inventory` (list, new, record with Overview/History/Timeline/Documents/Secrets/Reservations tabs, edit), `/employees` (list, the loadout view, edit, timeline, printable accountability form), and the three reference-data CRUD screens — with every mutation following the spec's server-action shape (guard → rate limit → zod → transaction+audit → revalidate → typed result).

**Architecture:** Pure decision logic lives in `src/lib/` (TDD: url-state, rate decision, audit diff, loadout, list builders, history rows, csv); Prisma-touching code lives in `src/server/modules/{inventory,employees,admin,approvals}`. Lists are server-rendered; URL search params are the only source of list state; client islands handle sort clicks, facet drafts, row selection, and the loadout grid. Lifecycle changes (assign/return/change-status) NEVER write assets directly — they create `Approval` rows (Phase 4's worker executes them), and the UI shows background-pending honestly.

**Tech Stack:** Next.js 15 App Router · Prisma 6 · zod (new dep, installed in Task 1) · node:crypto AES-256-GCM · Phase 1 primitives + Phase 2 shell · Vitest for pure logic · Playwright + axe.

**Conventions for every task:** work on branch `phase-3-it-core` (Task 1 creates it); run `npx tsc --noEmit && npm run lint` before each commit; NEVER run `npm run build` while a dev server is running (shared `.next`); do NOT run `prisma migrate reset` (blocked; no schema changes this phase — the schema already has everything Phase 3 needs). DB up via `docker compose up -d db`, seed via `npm run db:seed`. Subagents do NOT start dev servers — the controller owns the Browser-pane preview; verify with unit tests + typecheck + lint, and leave live checks to the controller.

**Seeded accounts (password `ChangeMe123!` for all):** admin@thebackroomop.com (admin) · it@thebackroomop.com (it_staff) · purchasing@thebackroomop.com (purchasing_staff) · finance@thebackroomop.com (finance_staff) · viewer@thebackroomop.com (viewer). Seed: 22 assets across all 8 statuses; 10 employees (EMP-0042 Marites Bautista holds laptop+monitor+dock+phone; Finance dept has the only equipment policy: laptop/monitor/dock/headset/phone required + second monitor optional); 7 approvals; 4 reservations; `approval_ref_seq` is at 2041.

**Entry criteria this plan implements (from the Phase 2 handoff — load-bearing):**
1. Path gating is navigation-only. **Every server action here calls `actionRole(...)` itself** and returns a typed `forbidden` result when it fails.
2. The `EmploymentStatus` status-map collision is fixed in Task 2 **before any employee pill renders** (employment `ACTIVE` → settled, `OFFBOARDING` → inflight, `OFFBOARDED` → closed; reservation `ACTIVE` stays inflight).
3. Every mutation follows: guard → **rate limit (60/min via `RateEvent`)** → zod → domain call in a transaction with the audit write in the same transaction → `revalidatePath` → typed result (`ok|forbidden|rate_limited|validation|conflict`).
4. Secrets reveal has its own `requireRole`-equivalent guard, writes `SECRET_READ`, auto-hides after 30 s, AES-256-GCM via `SECRET_ENCRYPTION_KEY`.
5. URL is the source of truth for list state; column visibility is per-user `UserPreference`, NOT URL. `paletteSearch` gets query-level gating + rate limiting (Task 4).
6. `Table`'s `onSort`/`Tr onClick` need client callers — pages stay server components, tables become client islands fed serialized row DTOs.

**Recorded scope decisions:**
1. **Export ships as CSV in Phase 3** (current filters honored, 10,000-row cap refused with the designed message, CSV-injection-safe). Phase 8 upgrades to real Excel + split-by-year chips. No new dependency.
2. **Asset creation is a direct write and always lands as `SPARE`.** Requesting `DEPLOYED`/`TEMPORARY` with an assignee additionally creates a `lifecycle.assign` approval; the record shows a background-pending banner until Phase 4's worker executes it. (README `3b`: "picking an assignee … routes through lifecycle.assign"; interaction summary: "the asset still reads SPARE everywhere else".)
3. **The edit form mutates identity/procurement/repair fields only.** `tag` is immutable after creation (it's the printed label — Phase 8 owns relabeling); status/assignee change only via approval-creating actions ("every + and − opens a request, not a write").
4. **No tag auto-generation** — manual entry validated against `BR-[A-Z]{2}-\d{4}`; barcode/label work is Phase 8.
5. **Employment status is editable on `/employees/[id]/edit`** (audited); the real offboarding flow (wizard, per-item returns) is Phase 7. There is **no `/employees/new`** route in the brief — employees arrive via import (Phase 8) or seed.
6. **`/inventory/activity` and `/employees/activity` get explicit static placeholder pages** ("arrives in Phase 4") — without them the new `[id]` dynamic routes would swallow those paths and 404.
7. **Bulk status-change requests are capped at 200 approvals per call** (conflict result above that, telling the user to narrow the filter).
8. **Documents:** upload + mark-signed + download only; no delete this phase. Download is a route nested under `/inventory/[id]/…` so middleware path rules apply to it automatically.
9. **Column-preference writes skip the audit trail** (user preference, not domain data) but still count against the rate limit.
10. **Vendor select** on the edit form reads the seeded `Vendor` table; vendor CRUD arrives with repairs (Phase 7).
11. **M365 select is stubbed from the canonical four values + `custom…`** (tenant-directory sync lands with Entra creds, Phase 8). `null` renders as "no sync yet", never a false `inactive`.
12. **paletteSearch rate limiting is an in-memory sliding window** (30 searches/10 s per user) — a DB `RateEvent` per keystroke would be write amplification, and the palette is a read path; the DB-backed 60/min budget stays reserved for mutations.

---

## File structure created/modified in this phase

```
src/lib/
  status.ts (+ .test.ts)                       (modify — employment namespace, entry criterion #2)
  url-state.ts (+ .test.ts)                    (create — parse/serialize/toggleSort/facet helpers)
  rate-limit.ts (+ .test.ts)                   (create — pure window decision + limits table)
  audit-diff.ts (+ .test.ts)                   (create — field-level diff for AuditEntry.diff)
  format.ts (+ .test.ts)                       (create — fmtDate/fmtMoney/fmtRelativeDays, Asia/Manila)
  inventory-list.ts (+ .test.ts)               (create — list config, where/orderBy builders)
  asset-rules.ts (+ .test.ts)                  (create — creation plan, warranty progress)
  history.ts (+ .test.ts)                      (create — audit entries → one-row-per-field)
  csv.ts (+ .test.ts)                          (create — csvEscape incl. formula-injection guard, toCsv)
  loadout.ts (+ .test.ts)                      (create — resolvePolicy, computeLoadout)
  employees-list.ts (+ .test.ts)               (create — employees list config + where builder)
src/server/
  action-result.ts                             (create — ActionResult union + constructors)
  rate-limit.ts                                (create — checkRate over RateEvent)
  crypto.ts (+ .test.ts)                       (create — AES-256-GCM encrypt/decryptSecret)
  audit.ts                                     (create — writeAudit(tx, …))
  preferences.ts                               (create — saveColumns action + getColumns)
  palette.ts                                   (modify — query-level gating + in-memory rate limit)
  auth/guards.ts                               (modify — add actionRole/actionUser, no-redirect guards)
  modules/approvals/create.ts                  (create — createApproval(tx), open-approval helpers)
  modules/inventory/queries.ts                 (create — listAssets, facetOptions, getAsset, exact-tag)
  modules/inventory/actions.ts                 (create — createAsset, updateAsset, requestStatusChange, bulkRequestStatusChange)
  modules/inventory/document-actions.ts        (create — uploadDocument, markDocumentSigned)
  modules/inventory/secret-actions.ts          (create — addSecret, revealSecret)
  modules/employees/queries.ts                 (create — listEmployees, getEmployeeLoadout)
  modules/employees/actions.ts                 (create — updateEmployee, requestAssign, requestReturn, requestAssignReserved)
  modules/admin/reference-actions.ts           (create — create/rename/deleteRefRow for the 3 entities)
src/components/patterns/
  chip-filter-row.tsx                          (create — active filters as removable Link chips)
  facet-dropdown.tsx                           (create — draft-state multi-select, URL on Apply)
  rate-limit-notice.tsx                        (create — amber card + countdown, "Nothing was lost")
  timeline-list.tsx                            (create — the per-record chronological list)
  entity-combobox.tsx                          (create — accessible typeahead over preloaded options)
src/components/inventory/
  inventory-table.tsx                          (create — client island: sort, selection, bulk drawer)
  inventory-toolbar.tsx                        (create — search + 4 facets + result count)
  bulk-drawer.tsx                              (create — selection summary + request status change)
  column-chooser.tsx                           (create — per-user visibility popover)
  asset-form.tsx                               (create — shared new/edit form)
  record-tabs.tsx                              (create — client tab bar w/ AUDITED chip)
  request-status-change.tsx                    (create — dialog → requestStatusChange)
  documents-panel.tsx                          (create — dropzone + rows + mark signed)
  secrets-panel.tsx                            (create — masked rows, reveal + 30s auto-hide)
src/components/employees/
  employees-toolbar.tsx                        (create — search + dept facet + gaps toggle)
  loadout-view.tsx                             (create — grid, keyboard nav, fill panel, holding area)
  employee-form.tsx                            (create — edit form w/ M365 select + save morph)
src/components/admin/
  ref-table.tsx                                (create — one table design for all 3 CRUD routes)
src/app/(app)/inventory/
  page.tsx + loading.tsx                       (create — the list)
  export/route.ts                              (create — CSV, 10k cap)
  new/page.tsx                                 (create)
  activity/page.tsx                            (create — Phase 4 placeholder, beats [id])
  [id]/layout.tsx + page.tsx + not-found.tsx   (create — record chrome + Overview)
  [id]/edit/page.tsx                           (create)
  [id]/history/page.tsx                        (create)
  [id]/timeline/page.tsx                       (create)
  [id]/documents/page.tsx                      (create)
  [id]/documents/[docId]/download/route.ts     (create — authed file streaming)
  [id]/secrets/page.tsx                        (create)
  [id]/reservations/page.tsx                   (create)
src/app/(app)/employees/
  page.tsx + loading.tsx                       (create — the list)
  activity/page.tsx                            (create — Phase 4 placeholder, beats [id])
  [id]/page.tsx                                (create — the loadout view)
  [id]/edit/page.tsx                           (create)
  [id]/timeline/page.tsx                       (create)
  [id]/form/page.tsx                           (create — printable accountability form)
src/app/(app)/admin/
  asset-categories/page.tsx                    (create)
  asset-types/page.tsx                         (create)
  departments/page.tsx                         (create)
src/app/(app)/layout.tsx                       (modify — print:hidden on shell chrome)
e2e/it-core.spec.ts                            (create)
.env                                           (modify locally — SECRET_ENCRYPTION_KEY; NEVER committed)
package.json / package-lock.json               (modify — zod; lockfile regenerated inside Linux)
```

Responsibilities: `src/lib` = pure, tested decision logic. `src/server/modules/*` = the only Prisma writers, every mutation in a transaction with its audit entry. Route files stay thin — fetch, parse URL state, compose components.

---

### Task 1: Branch, zod, encryption key, action plumbing

**Files:**
- Modify: `package.json`, `package-lock.json` (zod — lockfile regenerated in Linux), `.env` (local only), `src/server/auth/guards.ts`
- Create: `src/server/action-result.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-3-it-core
```

- [ ] **Step 2: Install zod, then repair the lockfile for Linux**

Installing on Windows drops the Linux optional-dep trees from the lockfile and breaks the Alpine prod `npm ci` (known gotcha). Install, then regenerate the lockfile inside Linux:

```bash
npm install zod
docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only --no-audit --no-fund"
```

Verify: `git diff package-lock.json | grep -c wasm32` should show the `@tailwindcss/oxide-wasm32-wasi` tree still present (no mass deletions of `@emnapi/*`).

- [ ] **Step 3: Add the secret-encryption key to `.env` (LOCAL ONLY — the repo is public, `.env*` is gitignored; never commit it)**

```bash
node -e "console.log('SECRET_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))" >> .env
```

*(Deviation recorded during execution: `.env` already carried a `SECRET_ENCRYPTION_KEY=` placeholder, so the generated value replaced it in place instead of appending a duplicate line.)*

- [ ] **Step 4: Create `src/server/action-result.ts`**

```ts
/**
 * Every mutation returns this union (spec §5). The UI maps kinds onto the
 * designed states: rate_limited → amber countdown card, validation → inline
 * field errors, conflict → banner, forbidden → toast (the affordance should
 * not have rendered — this is the server refusing anyway).
 */
export type ActionErrorKind = "forbidden" | "rate_limited" | "validation" | "conflict";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: ActionErrorKind;
      message: string;
      /** kind === "validation": first message per field */
      fieldErrors?: Record<string, string>;
      /** kind === "rate_limited": seconds until the window frees up */
      retryAfterSec?: number;
    };

export const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });

export const forbidden = (): ActionResult<never> => ({
  ok: false,
  kind: "forbidden",
  message: "You don't have permission to do that.",
});

export const rateLimited = (retryAfterSec: number): ActionResult<never> => ({
  ok: false,
  kind: "rate_limited",
  retryAfterSec,
  message: "You've made 60 changes this minute — the cap. Nothing was lost: this form still holds your input.",
});

export const validationError = (fieldErrors: Record<string, string>): ActionResult<never> => ({
  ok: false,
  kind: "validation",
  message: "Fix the highlighted fields.",
  fieldErrors,
});

export const conflict = (message: string): ActionResult<never> => ({
  ok: false,
  kind: "conflict",
  message,
});

/** zod → first message per field, for validationError(). */
export function zodFieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
```

- [ ] **Step 5: Add no-redirect guards to `src/server/auth/guards.ts`** (append at the end; keep `requireUser`/`requireRole` for pages)

```ts
/**
 * Guards for server actions: same checks as requireUser/requireRole but they
 * RETURN null instead of redirecting, so actions hand back the typed
 * `forbidden` result (spec §5) rather than navigating mid-mutation.
 */
export async function actionUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled || user.role !== session.user.role) return null;
  return user;
}

export async function actionRole(...roles: Role[]): Promise<User | null> {
  const user = await actionUser();
  return user && roles.includes(user.role) ? user : null;
}
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add package.json package-lock.json src/server/action-result.ts src/server/auth/guards.ts
git commit -m "feat(server): zod dep, typed ActionResult, no-redirect action guards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix the EmploymentStatus status-map collision (entry criterion #2, TDD)

Employment `ACTIVE` currently renders *inflight* (colliding with reservation `ACTIVE`), and `OFFBOARDING`/`OFFBOARDED` fall through to *neutral*. Namespace the lookup.

**Files:**
- Modify: `src/lib/status.ts`, `src/lib/status.test.ts`, `src/components/ui/status.tsx`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/status.test.ts`)

```ts
describe("employment namespace (entry criterion #2)", () => {
  it("employment ACTIVE is settled — the person is in the right state", () => {
    expect(statusFamily("ACTIVE", "employment")).toBe("settled");
  });
  it("reservation ACTIVE stays inflight (no namespace)", () => {
    expect(statusFamily("ACTIVE")).toBe("inflight");
  });
  it("OFFBOARDING is inflight, OFFBOARDED is closed", () => {
    expect(statusFamily("OFFBOARDING", "employment")).toBe("inflight");
    expect(statusFamily("OFFBOARDED", "employment")).toBe("closed");
  });
  it("unknown employment values map to neutral, not the flat map", () => {
    expect(statusFamily("SUBMITTED", "employment")).toBe("neutral");
  });
});
```

(Import `describe/it/expect` from `vitest` if the file's existing imports don't already cover them.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/status.test.ts`
Expected: FAIL — `statusFamily` doesn't accept a second argument / wrong families.

- [ ] **Step 3: Implement the namespace in `src/lib/status.ts`** (add below `MAP`, replace `statusFamily`)

```ts
/**
 * Namespaced lookups override the flat map where enum values collide across
 * entities. Employment ACTIVE is *settled* (person is in the right state);
 * reservation ACTIVE is *inflight* (someone owes an action). Entry criterion
 * #2 of the Phase 2 → 3 handoff.
 */
export type StatusNamespace = "employment";

const NAMESPACED: Record<StatusNamespace, Record<string, StatusFamily>> = {
  employment: { ACTIVE: "settled", OFFBOARDING: "inflight", OFFBOARDED: "closed" },
};

export function statusFamily(value: string, ns?: StatusNamespace): StatusFamily {
  if (ns) return Object.hasOwn(NAMESPACED[ns], value) ? NAMESPACED[ns][value] : "neutral";
  // Object.hasOwn: a client-defined status named "constructor" or "toString"
  // must map to neutral, not walk the prototype chain into a Function.
  return Object.hasOwn(MAP, value) ? MAP[value] : "neutral";
}
```

- [ ] **Step 4: Thread the namespace through `StatusDot`/`StatusPill`** in `src/components/ui/status.tsx`

Add an optional `ns` prop to both components and pass it to every `statusFamily(value)` call:

```tsx
import { statusFamily, isSystemFailure, type StatusNamespace } from "@/lib/status";

export function StatusDot({ value, ns, className }: { value: string; ns?: StatusNamespace; className?: string }) {
  const family = statusFamily(value, ns);
  // …rest unchanged (isSystemFailure branch, closed branch, dot render)
}

export function StatusPill({ value, ns, label, className }: { value: string; ns?: StatusNamespace; label?: string; className?: string }) {
  const family = statusFamily(value, ns);
  const failed = isSystemFailure(value);
  // …unchanged, except pass ns down: <StatusDot value={value} ns={ns} className="size-[6px]" />
}
```

- [ ] **Step 5: Run tests, verify, commit**

```bash
npm run test -- src/lib/status.test.ts && npx tsc --noEmit && npm run lint
git add src/lib/status.ts src/lib/status.test.ts src/components/ui/status.tsx
git commit -m "fix(status): namespace employment statuses — ACTIVE settled, OFFBOARDING inflight, OFFBOARDED closed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: URL list-state helpers (TDD)

The fixed contract: filters/sort/page live in query params; sort is one param like `-purchasedAt,model` (max 2 keys, `-` = desc); facet params are comma-joined (`status=DEPLOYED,SPARE`); page resets on any filter change.

**Files:**
- Create: `src/lib/url-state.ts`, `src/lib/url-state.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/url-state.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  parseListState, serializeListState, toggleSort, withFilter, withSearch,
  clearFilters, toSearchParams, type ListConfig,
} from "./url-state";

const config: ListConfig = {
  facets: ["status", "category"],
  sortable: ["tag", "model", "purchasedAt"],
  defaultSort: [{ key: "tag", dir: "asc" }],
};

const parse = (qs: string) => parseListState(new URLSearchParams(qs), config);

describe("parseListState", () => {
  it("returns defaults for an empty query", () => {
    expect(parse("")).toEqual({ q: "", page: 1, sort: [{ key: "tag", dir: "asc" }], filters: {} });
  });
  it("parses q, page, comma-joined facets and the sort param", () => {
    expect(parse("q=latitude&page=3&status=DEPLOYED,SPARE&sort=-purchasedAt,model")).toEqual({
      q: "latitude",
      page: 3,
      sort: [{ key: "purchasedAt", dir: "desc" }, { key: "model", dir: "asc" }],
      filters: { status: ["DEPLOYED", "SPARE"] },
    });
  });
  it("drops unknown facets, unknown sort keys, and clamps bad pages", () => {
    const s = parse("evil=1&sort=-hax,tag&page=0");
    expect(s.filters).toEqual({});
    expect(s.sort).toEqual([{ key: "tag", dir: "asc" }]);
    expect(s.page).toBe(1);
  });
  it("caps sort at two keys", () => {
    expect(parse("sort=tag,model,purchasedAt").sort).toHaveLength(2);
  });
});

describe("serializeListState", () => {
  it("omits defaults entirely", () => {
    expect(serializeListState(parse(""), config)).toBe("");
  });
  it("round-trips a full state", () => {
    const qs = "?q=latitude&status=DEPLOYED,SPARE&sort=-purchasedAt,model&page=3";
    expect(serializeListState(parse(qs.slice(1)), config)).toBe(qs);
  });
});

describe("toggleSort", () => {
  const def = [{ key: "tag", dir: "asc" as const }];
  it("new key becomes primary asc and demotes the old primary", () => {
    expect(toggleSort(def, "model")).toEqual([
      { key: "model", dir: "asc" }, { key: "tag", dir: "asc" },
    ]);
  });
  it("primary asc flips to desc", () => {
    expect(toggleSort(def, "tag")).toEqual([{ key: "tag", dir: "desc" }]);
  });
  it("primary desc is removed and the secondary promotes", () => {
    expect(toggleSort([{ key: "tag", dir: "desc" }, { key: "model", dir: "asc" }], "tag"))
      .toEqual([{ key: "model", dir: "asc" }]);
  });
  it("secondary promotes to primary keeping its direction", () => {
    expect(toggleSort([{ key: "tag", dir: "asc" }, { key: "model", dir: "desc" }], "model"))
      .toEqual([{ key: "model", dir: "desc" }, { key: "tag", dir: "asc" }]);
  });
  it("never exceeds two keys", () => {
    expect(toggleSort([{ key: "tag", dir: "asc" }, { key: "model", dir: "asc" }], "purchasedAt"))
      .toEqual([{ key: "purchasedAt", dir: "asc" }, { key: "tag", dir: "asc" }]);
  });
});

describe("state updates reset the page", () => {
  it("withFilter replaces one facet and resets page", () => {
    const s = withFilter(parse("page=4&status=SPARE"), "status", ["DEPLOYED"]);
    expect(s.filters.status).toEqual(["DEPLOYED"]);
    expect(s.page).toBe(1);
  });
  it("withSearch sets q and resets page", () => {
    const s = withSearch(parse("page=4"), "dell");
    expect(s.q).toBe("dell");
    expect(s.page).toBe(1);
  });
  it("clearFilters drops filters and q but keeps sort", () => {
    const s = clearFilters(parse("q=x&status=SPARE&sort=-model"));
    expect(s.filters).toEqual({});
    expect(s.q).toBe("");
    expect(s.sort).toEqual([{ key: "model", dir: "desc" }]);
  });
});

describe("toSearchParams", () => {
  it("converts Next's searchParams record (last value wins for arrays)", () => {
    const sp = toSearchParams({ q: "x", status: ["a", "b"], gone: undefined });
    expect(sp.get("q")).toBe("x");
    expect(sp.get("status")).toBe("b");
    expect(sp.has("gone")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/url-state.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/lib/url-state.ts`**

```ts
/**
 * URL search params are the source of truth for list state (brief §3.2).
 * Contract: `q` free text · one comma-joined param per facet · `sort` like
 * `-purchasedAt,model` (max 2 keys, `-` = desc) · `page` 1-based.
 * Column visibility is per-user preference, NOT here.
 */
export interface SortKey {
  key: string;
  dir: "asc" | "desc";
}

export interface ListState {
  q: string;
  page: number;
  sort: SortKey[];
  filters: Record<string, string[]>;
}

export interface ListConfig {
  facets: string[];
  sortable: string[];
  defaultSort: SortKey[];
}

export const MAX_SORT_KEYS = 2;

export function parseListState(params: URLSearchParams, config: ListConfig): ListState {
  const filters: Record<string, string[]> = {};
  for (const facet of config.facets) {
    const raw = params.get(facet);
    if (!raw) continue;
    const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length) filters[facet] = values;
  }

  const sort: SortKey[] = (params.get("sort") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): SortKey => (part.startsWith("-")
      ? { key: part.slice(1), dir: "desc" }
      : { key: part, dir: "asc" }))
    .filter((s) => config.sortable.includes(s.key))
    .slice(0, MAX_SORT_KEYS);

  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  return {
    q: (params.get("q") ?? "").trim(),
    page,
    sort: sort.length ? sort : config.defaultSort,
    filters,
  };
}

function sameSort(a: SortKey[], b: SortKey[]): boolean {
  return a.length === b.length && a.every((s, i) => s.key === b[i].key && s.dir === b[i].dir);
}

/** Stable order: q, facets (config order), sort, page. Defaults are omitted. */
export function serializeListState(state: ListState, config: ListConfig): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  for (const facet of config.facets) {
    const values = state.filters[facet];
    if (values?.length) params.set(facet, values.join(","));
  }
  if (!sameSort(state.sort, config.defaultSort)) {
    params.set("sort", state.sort.map((s) => (s.dir === "desc" ? `-${s.key}` : s.key)).join(","));
  }
  if (state.page > 1) params.set("page", String(state.page));
  const qs = params.toString();
  // URLSearchParams percent-encodes commas; keep them readable — they're safe in queries.
  return qs ? `?${qs.replaceAll("%2C", ",")}` : "";
}

/**
 * Header-click cycle: new key → primary asc (old primary demotes, max 2) ·
 * primary asc → desc · primary desc → removed (secondary promotes) ·
 * secondary → promoted keeping its direction.
 */
export function toggleSort(sort: SortKey[], key: string): SortKey[] {
  const [primary, secondary] = sort;
  if (primary?.key === key) {
    if (primary.dir === "asc") return [{ key, dir: "desc" }, ...(secondary ? [secondary] : [])];
    return secondary ? [secondary] : [];
  }
  if (secondary?.key === key) return [secondary, primary];
  return [{ key, dir: "asc" as const }, ...(primary ? [primary] : [])].slice(0, MAX_SORT_KEYS);
}
```

*(Deviation recorded during execution: `as const` on that literal — `.slice()` breaks contextual typing, so strict tsc widened `dir` to `string` without it.)*

```ts

export function withFilter(state: ListState, facet: string, values: string[]): ListState {
  const filters = { ...state.filters };
  if (values.length) filters[facet] = values;
  else delete filters[facet];
  return { ...state, filters, page: 1 };
}

export function withSearch(state: ListState, q: string): ListState {
  return { ...state, q: q.trim(), page: 1 };
}

export function clearFilters(state: ListState): ListState {
  return { ...state, q: "", filters: {}, page: 1 };
}

/** Next 15 gives pages a plain record; normalize to URLSearchParams. */
export function toSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") out.set(key, value);
    else if (Array.isArray(value) && value.length) out.set(key, value[value.length - 1]);
  }
  return out;
}
```

- [ ] **Step 4: Run tests until green**

Run: `npm run test -- src/lib/url-state.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/url-state.ts src/lib/url-state.test.ts
git commit -m "feat(lib): URL list-state contract — parse/serialize/toggleSort, page resets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Rate limiter, audit diff, secret crypto, palette hardening (TDD)

**Files:**
- Create: `src/lib/rate-limit.ts` (+ `.test.ts`), `src/lib/audit-diff.ts` (+ `.test.ts`), `src/server/rate-limit.ts`, `src/server/crypto.ts` (+ `.test.ts`), `src/server/audit.ts`
- Modify: `src/server/palette.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/rate-limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rateDecision, RATE_LIMITS } from "./rate-limit";

const now = new Date("2026-08-16T10:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

describe("rateDecision", () => {
  it("allows while fewer than the limit exist in the window", () => {
    const recent = Array.from({ length: RATE_LIMITS.mutation.limit - 1 }, (_, i) => secondsAgo(i));
    expect(rateDecision(recent, "mutation", now)).toEqual({ allowed: true });
  });
  it("blocks at the limit and reports when the window frees up", () => {
    // 60 events, newest first; the 60th-newest is 30s old → frees in 30s.
    const recent = Array.from({ length: 60 }, (_, i) => secondsAgo(i * 0.5));
    const d = rateDecision(recent, "mutation", now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.retryAfterSec).toBe(31); // ceil(30.5s remaining)
  });
  it("retryAfterSec is never below 1", () => {
    const recent = Array.from({ length: 60 }, () => secondsAgo(59.999));
    const d = rateDecision(recent, "mutation", now);
    if (!d.allowed) expect(d.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
  it("import kind uses the 10/min budget", () => {
    const recent = Array.from({ length: 10 }, (_, i) => secondsAgo(i));
    expect(rateDecision(recent, "import", now).allowed).toBe(false);
  });
});
```

`src/lib/audit-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffOf } from "./audit-diff";

describe("diffOf", () => {
  it("captures only changed fields, from → to", () => {
    expect(diffOf({ model: "A", serial: "S1" }, { model: "B", serial: "S1" }))
      .toEqual({ model: { from: "A", to: "B" } });
  });
  it("normalizes Dates to ISO strings and undefined to null", () => {
    const d = diffOf(
      { warrantyUntil: new Date("2026-01-01T00:00:00Z"), notes: undefined },
      { warrantyUntil: new Date("2027-01-01T00:00:00Z"), notes: "hello" },
    );
    expect(d.warrantyUntil).toEqual({ from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
    expect(d.notes).toEqual({ from: null, to: "hello" });
  });
  it("treats equal Dates and equal decimals as unchanged", () => {
    const dec = { toNumber: () => 55000 }; // Prisma.Decimal shape
    expect(diffOf({ at: new Date(1000), cost: dec }, { at: new Date(1000), cost: 55000 })).toEqual({});
  });
  it("only inspects keys present in `after` (partial updates)", () => {
    expect(diffOf({ a: 1, b: 2 }, { b: 3 })).toEqual({ b: { from: 2, to: 3 } });
  });
});
```

`src/server/crypto.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

describe("secret crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips plaintext and never stores it verbatim", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const ct = encryptSecret("wifi: hunter2");
    expect(ct).not.toContain("hunter2");
    expect(decryptSecret(ct)).toBe("wifi: hunter2");
  });
  it("produces a fresh IV every call", async () => {
    const { encryptSecret } = await import("./crypto");
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("rejects tampered ciphertext (GCM auth tag)", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const raw = Buffer.from(encryptSecret("x"), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });
  it("refuses to run without a 32-byte key", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "dG9vLXNob3J0");
    const { encryptSecret } = await import("./crypto");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/rate-limit.test.ts src/lib/audit-diff.test.ts src/server/crypto.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `src/lib/rate-limit.ts`**

```ts
/** Brief §8: mutations 60/min per user, imports 10/min. */
export const RATE_LIMITS = {
  mutation: { limit: 60, windowMs: 60_000 },
  import: { limit: 10, windowMs: 60_000 },
} as const;

export type RateKind = keyof typeof RATE_LIMITS;

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

/**
 * Pure decision. `recent` = this user's event timestamps inside the window,
 * NEWEST FIRST, at most `limit` of them. Blocked until the limit-th newest
 * event leaves the window.
 */
export function rateDecision(recent: Date[], kind: RateKind, now: Date): RateDecision {
  const { limit, windowMs } = RATE_LIMITS[kind];
  if (recent.length < limit) return { allowed: true };
  const nthNewest = recent[limit - 1];
  const freesAt = nthNewest.getTime() + windowMs;
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)) };
}
```

- [ ] **Step 4: Implement `src/lib/audit-diff.ts`**

```ts
export type AuditDiff = Record<string, { from: unknown; to: unknown }>;

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber(); // Prisma.Decimal
  }
  return value ?? null;
}

/**
 * Field-level diff for AuditEntry.diff — `{ field: { from, to } }`, changed
 * fields only. Only keys present in `after` are inspected, so partial updates
 * never claim untouched fields changed. The history tab renders one row per
 * field from exactly this shape.
 */
export function diffOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditDiff {
  const diff: AuditDiff = {};
  for (const key of Object.keys(after)) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (!Object.is(from, to)) diff[key] = { from, to };
  }
  return diff;
}
```

- [ ] **Step 5: Implement `src/server/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const b64 = process.env.SECRET_ENCRYPTION_KEY;
  if (!b64) throw new Error("SECRET_ENCRYPTION_KEY is not set — add it to .env (never commit it)");
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) throw new Error("SECRET_ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

/** AES-256-GCM → base64(iv || tag || data) — the AssetSecret.ciphertext format. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 6: Run the three test files — all green**

Run: `npm run test -- src/lib/rate-limit.test.ts src/lib/audit-diff.test.ts src/server/crypto.test.ts`
Expected: PASS.

- [ ] **Step 7: Implement the Prisma wrappers**

`src/server/rate-limit.ts`:

```ts
import { prisma } from "./db/client";
import { RATE_LIMITS, rateDecision, type RateDecision, type RateKind } from "@/lib/rate-limit";

/**
 * Spec §5 step 2 — check-and-record against the RateEvent table. The event
 * is recorded only when allowed, so blocked retries don't extend the block.
 * Runs BEFORE validation: the cap counts attempts, not successes.
 */
export async function checkRate(userId: string, kind: RateKind = "mutation"): Promise<RateDecision> {
  const { limit, windowMs } = RATE_LIMITS[kind];
  const recent = await prisma.rateEvent.findMany({
    where: { userId, kind, at: { gte: new Date(Date.now() - windowMs) } },
    orderBy: { at: "desc" },
    take: limit,
    select: { at: true },
  });
  const decision = rateDecision(recent.map((r) => r.at), kind, new Date());
  if (decision.allowed) await prisma.rateEvent.create({ data: { userId, kind } });
  return decision;
}
```

`src/server/audit.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { AuditDiff } from "@/lib/audit-diff";

/**
 * The audit write happens in the SAME transaction as the domain write —
 * callers pass their TransactionClient. AuditEntry is append-only by DB
 * trigger; nothing here ever updates or deletes.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    actorId: string | null;
    actorLabel: string;
    entityType: string;
    entityId: string;
    action: string;
    diff?: AuditDiff;
  },
): Promise<void> {
  await tx.auditEntry.create({
    data: {
      ...entry,
      diff: entry.diff && Object.keys(entry.diff).length
        ? (entry.diff as Prisma.InputJsonObject)
        : undefined,
    },
  });
}
```

- [ ] **Step 8: Harden `src/server/palette.ts` (entry criterion #5)**

Replace the file body with query-level gating (skip queries whose target routes the role can't reach — don't fetch then filter) and an in-memory sliding window (decision 12):

```ts
"use server";

import { prisma } from "./db/client";
import { requireUser } from "./auth/guards";
import { pathAllowedForRole } from "@/lib/workspaces";

export interface PaletteHit {
  label: string;
  sub: string;
  href: string;
}

export interface PaletteResults {
  assets: PaletteHit[];
  people: PaletteHit[];
  requests: PaletteHit[];
}

const EMPTY: PaletteResults = { assets: [], people: [], requests: [] };

// In-memory sliding window: 30 searches / 10 s per user. A DB RateEvent per
// keystroke would be write amplification on a read path; process-local is
// fine on a single-machine deploy.
const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 30;
const recentByUser = new Map<string, number[]>();

function searchAllowed(userId: string): boolean {
  const now = Date.now();
  const recent = (recentByUser.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_IN_WINDOW) {
    recentByUser.set(userId, recent);
    return false;
  }
  recent.push(now);
  recentByUser.set(userId, recent);
  return true;
}

export async function paletteSearch(query: string): Promise<PaletteResults> {
  const user = await requireUser();
  const q = query.trim();
  if (q.length < 2 || !searchAllowed(user.id)) return EMPTY;

  // Query-level gating: don't even run the query for groups whose target
  // routes this role can't reach (entry criterion #5).
  const canAssets = pathAllowedForRole("/inventory/x", user.role);
  const canPeople = pathAllowedForRole("/employees/x", user.role);
  const canRequests = pathAllowedForRole("/purchases/x", user.role);

  const [assets, people, requests] = await Promise.all([
    canAssets
      ? prisma.asset.findMany({
          where: { OR: [{ tag: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }] },
          take: 5,
          orderBy: { tag: "asc" },
        })
      : [],
    canPeople
      ? prisma.employee.findMany({
          where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { employeeNo: { contains: q, mode: "insensitive" } }] },
          take: 5,
          orderBy: { name: "asc" },
        })
      : [],
    canRequests
      ? prisma.purchaseRequest.findMany({
          where: { refNo: { contains: q, mode: "insensitive" } },
          take: 5,
          orderBy: { refNo: "desc" },
        })
      : [],
  ]);

  return {
    assets: assets.map((a) => ({ label: a.tag, sub: a.model, href: `/inventory/${a.id}` })),
    people: people.map((e) => ({ label: e.name, sub: e.employeeNo, href: `/employees/${e.id}` })),
    requests: requests.map((r) => ({ label: r.refNo, sub: r.state, href: `/purchases/${r.id}` })),
  };
}
```

- [ ] **Step 9: Verify and commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/rate-limit.ts src/lib/rate-limit.test.ts src/lib/audit-diff.ts src/lib/audit-diff.test.ts \
  src/server/rate-limit.ts src/server/crypto.ts src/server/crypto.test.ts src/server/audit.ts src/server/palette.ts
git commit -m "feat(server): RateEvent limiter, audit diff helper, AES-256-GCM secret crypto, palette query gating

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Format helpers (TDD) + approval creation helper

**Files:**
- Create: `src/lib/format.ts` (+ `.test.ts`), `src/server/modules/approvals/create.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/format.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { fmtDate, fmtMoney, fmtRelativeDays } from "./format";

describe("format", () => {
  it("fmtDate renders dd MMM yyyy in Asia/Manila and — for empty", () => {
    expect(fmtDate(new Date("2026-08-16T00:00:00Z"))).toBe("16 Aug 2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("2026-01-05T00:00:00Z")).toBe("05 Jan 2026");
  });
  it("fmtMoney renders whole pesos and — for empty", () => {
    expect(fmtMoney(55000)).toBe("₱55,000");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney("18400")).toBe("₱18,400");
  });
  it("fmtRelativeDays", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    expect(fmtRelativeDays(new Date("2026-08-16T09:00:00Z"), now)).toBe("today");
    expect(fmtRelativeDays(new Date("2026-08-13T12:00:00Z"), now)).toBe("3 d ago");
    expect(fmtRelativeDays(new Date("2026-08-19T12:00:00Z"), now)).toBe("in 3 d");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/format.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/format.ts`**

```ts
/**
 * Every ID, serial, date, count and enum renders in mono with tabular-nums
 * (handover typography) — these helpers produce the strings; the mono styling
 * is the caller's. Timezone pinned to Asia/Manila (the business), so server
 * and tests agree regardless of host TZ.
 */
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Manila",
});

const moneyFmt = new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", maximumFractionDigits: 0,
});

export function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(typeof value === "string" ? new Date(value) : value);
}

export function fmtMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return moneyFmt.format(Number(value));
}

const DAY_MS = 86_400_000;

export function fmtRelativeDays(value: Date | string, now: Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const days = Math.round((d.getTime() - now.getTime()) / DAY_MS);
  if (days === 0) return "today";
  return days < 0 ? `${-days} d ago` : `in ${days} d`;
}
```

- [ ] **Step 4: Run tests — green**

Run: `npm run test -- src/lib/format.test.ts` — Expected: PASS.

- [ ] **Step 5: Implement `src/server/modules/approvals/create.ts`**

```ts
import type { ApprovalType, Priority, Prisma } from "@prisma/client";

/** PENDING/CLAIMED/APPROVED blockers for "one open request per asset". */
export const OPEN_APPROVAL_STATES = ["PENDING", "CLAIMED", "APPROVED"] as const;

const DEFAULT_SLA_HOURS = 48;

/**
 * Phase 3 never mutates asset lifecycle directly — it creates Approval rows;
 * Phase 4's worker executes them. refNo continues the seeded APR-#### range
 * via the approval_ref_seq sequence (seed left it at 2041).
 */
export async function createApproval(
  tx: Prisma.TransactionClient,
  input: {
    type: ApprovalType;
    payload: Prisma.InputJsonObject;
    requestedById: string;
    assetId?: string;
    employeeId?: string;
    priority?: Priority;
  },
) {
  const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('approval_ref_seq')`;
  return tx.approval.create({
    data: {
      refNo: `APR-${nextval}`,
      type: input.type,
      payload: input.payload,
      requestedById: input.requestedById,
      assetId: input.assetId,
      employeeId: input.employeeId,
      priority: input.priority ?? "NORMAL",
      slaAt: new Date(Date.now() + DEFAULT_SLA_HOURS * 3_600_000),
    },
  });
}

export function openApprovalForAsset(tx: Prisma.TransactionClient, assetId: string) {
  return tx.approval.findFirst({
    where: { assetId, state: { in: [...OPEN_APPROVAL_STATES] } },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/format.ts src/lib/format.test.ts src/server/modules/approvals/create.ts
git commit -m "feat(server): date/money formatters, approval creation over approval_ref_seq

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Inventory list query module (TDD builders)

**Files:**
- Create: `src/lib/inventory-list.ts` (+ `.test.ts`), `src/server/modules/inventory/queries.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/inventory-list.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { ASSET_STATUSES, buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG } from "./inventory-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), INVENTORY_LIST_CONFIG);

describe("buildAssetWhere", () => {
  it("empty state → empty where", () => {
    expect(buildAssetWhere(parse(""))).toEqual({});
  });
  it("q searches tag, model and serial (contains, insensitive — NOT equals)", () => {
    expect(buildAssetWhere(parse("q=latitude"))).toEqual({
      OR: [
        { tag: { contains: "latitude", mode: "insensitive" } },
        { model: { contains: "latitude", mode: "insensitive" } },
        { serial: { contains: "latitude", mode: "insensitive" } },
      ],
    });
  });
  it("maps facets to in-filters and silently drops invalid statuses", () => {
    const where = buildAssetWhere(parse("status=DEPLOYED,HACKED&category=c1&type=t1,t2&assignee=e1"));
    expect(where.status).toEqual({ in: ["DEPLOYED"] });
    expect(where.categoryId).toEqual({ in: ["c1"] });
    expect(where.typeId).toEqual({ in: ["t1", "t2"] });
    expect(where.assigneeId).toEqual({ in: ["e1"] });
  });
  it("all-invalid status facet filters nothing rather than everything", () => {
    expect(buildAssetWhere(parse("status=HACKED")).status).toBeUndefined();
  });
});

describe("buildAssetOrderBy", () => {
  it("defaults to tag asc", () => {
    expect(buildAssetOrderBy([])).toEqual([{ tag: "asc" }]);
  });
  it("category sorts through the relation name", () => {
    expect(buildAssetOrderBy([{ key: "category", dir: "desc" }, { key: "model", dir: "asc" }]))
      .toEqual([{ category: { name: "desc" } }, { model: "asc" }]);
  });
});

it("ASSET_STATUSES covers all 8 enum values", () => {
  expect(ASSET_STATUSES).toHaveLength(8);
  expect(ASSET_STATUSES).toContain("MISSING");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/inventory-list.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/inventory-list.ts`**

```ts
import type { AssetStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";

export const ASSET_STATUSES = [
  "DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING",
] as const satisfies readonly AssetStatus[];

export const INVENTORY_LIST_CONFIG: ListConfig = {
  facets: ["status", "category", "type", "assignee"],
  sortable: ["tag", "model", "category", "status", "purchasedAt", "warrantyUntil"],
  defaultSort: [{ key: "tag", dir: "asc" }],
};

export function buildAssetWhere(state: ListState): Prisma.AssetWhereInput {
  const where: Prisma.AssetWhereInput = {};
  if (state.q) {
    // contains-search with insensitive mode is the sanctioned use; the
    // ILIKE-wildcard hazard applies to identity/equals lookups only.
    where.OR = [
      { tag: { contains: state.q, mode: "insensitive" } },
      { model: { contains: state.q, mode: "insensitive" } },
      { serial: { contains: state.q, mode: "insensitive" } },
    ];
  }
  const f = state.filters;
  const statuses = (f.status ?? []).filter((s): s is AssetStatus =>
    (ASSET_STATUSES as readonly string[]).includes(s));
  if (statuses.length) where.status = { in: statuses };
  if (f.category?.length) where.categoryId = { in: f.category };
  if (f.type?.length) where.typeId = { in: f.type };
  if (f.assignee?.length) where.assigneeId = { in: f.assignee };
  return where;
}

export function buildAssetOrderBy(sort: SortKey[]): Prisma.AssetOrderByWithRelationInput[] {
  const order = sort.length ? sort : INVENTORY_LIST_CONFIG.defaultSort;
  return order.map(({ key, dir }): Prisma.AssetOrderByWithRelationInput =>
    key === "category" ? { category: { name: dir } } : { [key]: dir });
}
```

- [ ] **Step 4: Run tests — green**

Run: `npm run test -- src/lib/inventory-list.test.ts` — Expected: PASS.

- [ ] **Step 5: Implement `src/server/modules/inventory/queries.ts`**

```ts
import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";
import {
  ASSET_STATUSES, buildAssetOrderBy, buildAssetWhere,
} from "@/lib/inventory-list";
import type { ListState } from "@/lib/url-state";

export const PAGE_SIZE = 25;

/** Serializable DTO for the client table island — strings only, preformatted. */
export interface AssetRow {
  id: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  assignee: string | null;
  purchased: string;
  warranty: string;
}

export async function listAssets(state: ListState): Promise<{
  rows: AssetRow[];
  total: number;
  pageCount: number;
}> {
  const where = buildAssetWhere(state);
  const [total, assets] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy: buildAssetOrderBy(state.sort),
      skip: (state.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: true, assignee: true },
    }),
  ]);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: assets.map((a): AssetRow => ({
      id: a.id,
      tag: a.tag,
      model: a.model,
      category: a.category.name,
      status: a.status,
      assignee: a.assignee?.name ?? null,
      purchased: fmtDate(a.purchasedAt),
      warranty: fmtDate(a.warrantyUntil),
    })),
  };
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Standard faceting: each facet's counts apply every OTHER facet (and q) but
 * not its own selection — options stay visible (dimmed at zero) instead of
 * vanishing once a sibling is picked. URL updates only on Apply, so these
 * recompute per navigation, not per click.
 */
export async function facetOptions(state: ListState): Promise<Record<string, FacetOption[]>> {
  const without = (facet: string): ListState => ({
    ...state,
    filters: { ...state.filters, [facet]: [] },
  });

  const [statusG, categoryG, typeG, assigneeG, categories, types, assignees] = await Promise.all([
    prisma.asset.groupBy({ by: ["status"], where: buildAssetWhere(without("status")), _count: true }),
    prisma.asset.groupBy({ by: ["categoryId"], where: buildAssetWhere(without("category")), _count: true }),
    prisma.asset.groupBy({ by: ["typeId"], where: buildAssetWhere(without("type")), _count: true }),
    prisma.asset.groupBy({ by: ["assigneeId"], where: buildAssetWhere(without("assignee")), _count: true }),
    prisma.assetCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ orderBy: { name: "asc" }, include: { category: true } }),
    prisma.employee.findMany({ where: { assets: { some: {} } }, orderBy: { name: "asc" } }),
  ]);

  return {
    status: ASSET_STATUSES.map((s) => ({
      value: s, label: s, count: statusG.find((g) => g.status === s)?._count ?? 0,
    })),
    category: categories.map((c) => ({
      value: c.id, label: c.name, count: categoryG.find((g) => g.categoryId === c.id)?._count ?? 0,
    })),
    type: types.map((t) => ({
      value: t.id, label: `${t.category.name} · ${t.name}`,
      count: typeG.find((g) => g.typeId === t.id)?._count ?? 0,
    })),
    assignee: assignees.map((e) => ({
      value: e.id, label: e.name, count: assigneeG.find((g) => g.assigneeId === e.id)?._count ?? 0,
    })),
  };
}

/**
 * A USB scanner is just a keyboard: an exact tag match opens the record
 * instead of listing it. findUnique on the uppercased tag — NEVER an
 * insensitive equals (ILIKE wildcard hazard).
 */
export function exactTagMatch(q: string) {
  const tag = q.trim().toUpperCase();
  if (!/^BR-[A-Z]{2}-\d{4}$/.test(tag)) return null;
  return prisma.asset.findUnique({ where: { tag }, select: { id: true } });
}

export function getAsset(id: string) {
  return prisma.asset.findUnique({
    where: { id },
    include: {
      category: true,
      type: true,
      assignee: true,
      vendor: true,
      approvals: {
        where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/inventory-list.ts src/lib/inventory-list.test.ts src/server/modules/inventory/queries.ts
git commit -m "feat(inventory): list query module — tested where/orderBy builders, facet counts, exact-tag scan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: `/inventory` — the list page

Toolbar (search + result count), chip filter row, sortable server-rendered table (client island for sort + row-open), pagination, both designed empty states, loading skeleton, exact-tag scan redirect, viewer read-only. Facets arrive in Task 8, selection in Task 9, column chooser in Task 10.

**Files:**
- Create: `src/components/ui/button-link.tsx`, `src/components/patterns/chip-filter-row.tsx`, `src/components/inventory/inventory-toolbar.tsx`, `src/components/inventory/inventory-table.tsx`, `src/app/(app)/inventory/page.tsx`, `src/app/(app)/inventory/loading.tsx`

- [ ] **Step 1: Create `src/components/ui/button-link.tsx`** (Button-styled `Link` — nesting a `<button>` in `<a>` is invalid HTML; lists need link actions everywhere)

```tsx
import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg border border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary: "bg-surface text-fg-secondary border border-border-strong hover:bg-surface-subtle",
  ghost: "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-subtle",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-[11.5px]",
  md: "px-3.5 py-[9px] text-[13px]",
};

export function ButtonLink({
  href, variant = "secondary", size = "md", prefetch, className, children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  prefetch?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-(--radius-btn) font-medium",
        "[transition:background_var(--dur-1)_linear,border-color_var(--dur-1)_linear,scale_var(--dur-press)_linear] active:scale-[.965]",
        VARIANT[variant], SIZE[size], className,
      )}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Create `src/components/patterns/chip-filter-row.tsx`** (server-safe — chips are plain Links echoing the URL verbatim)

```tsx
import Link from "next/link";

export interface FilterChip {
  label: string;
  removeHref: string;
}

export function ChipFilterRow({ chips, clearHref }: { chips: FilterChip[]; clearHref: string }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-2">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.removeHref}
          className="inline-flex items-center gap-1 rounded-(--radius-ctl) border border-accent-soft-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-accent-soft-text hover:opacity-80"
        >
          {chip.label}
          <span aria-hidden>✕</span>
          <span className="sr-only"> — remove filter</span>
        </Link>
      ))}
      <Link href={clearHref} className="px-1 text-[11px] text-fg-muted underline-offset-2 hover:underline">
        Clear filters
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/inventory/inventory-toolbar.tsx`** (client — search pushes URL state; facet slots filled in Task 8)

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { serializeListState, withSearch, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

export function InventoryToolbar({
  state,
  total,
  facets, // used from Task 8 onward; empty object renders no dropdowns
  children,
}: {
  state: ListState;
  total: number;
  facets: Record<string, FacetOption[]>;
  children?: React.ReactNode; // Task 8 mounts FacetDropdowns here; Task 10 the column chooser
}) {
  const router = useRouter();
  const pathname = usePathname();

  function submitSearch(q: string) {
    router.push(pathname + serializeListState(withSearch(state, q), INVENTORY_LIST_CONFIG));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          type="search"
          aria-label="Search assets"
          placeholder="Search tag, model, serial…"
          defaultValue={state.q}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch(e.currentTarget.value);
          }}
        />
      </div>
      {children}
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} asset{total === 1 ? "" : "s"}
      </span>
    </div>
  );
}
```

(`facets` is accepted now so Task 8 doesn't change the page↔toolbar contract; the lint rule tolerates unused props on destructured object params — if `eslint` complains, prefix with a void statement `void facets;` until Task 8 uses it.)

- [ ] **Step 4: Create `src/components/inventory/inventory-table.tsx`** (client island — sort + row open; Task 9 adds selection)

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { serializeListState, toggleSort, type ListState } from "@/lib/url-state";
import type { AssetRow } from "@/server/modules/inventory/queries";

export interface ColumnDef {
  id: string;
  label: string;
  width?: number;
  sortKey?: string; // present ⇒ sortable
}

/** README `1f`: ☐ · dot · tag(104) · model(flex) · category(84) · assigned(168) · status(88) · purchased(104) · warranty(72). */
export const INVENTORY_COLUMNS: ColumnDef[] = [
  { id: "tag", label: "Tag", width: 104, sortKey: "tag" },
  { id: "model", label: "Model", sortKey: "model" },
  { id: "category", label: "Category", width: 84, sortKey: "category" },
  { id: "assigned", label: "Assigned", width: 168 },
  { id: "status", label: "Status", width: 88, sortKey: "status" },
  { id: "purchased", label: "Purchased", width: 104, sortKey: "purchasedAt" },
  { id: "warranty", label: "Warranty", width: 72, sortKey: "warrantyUntil" },
];

/** Columns the chooser may hide (Task 10). tag/model/status always render. */
export const HIDEABLE_COLUMNS = ["category", "assigned", "purchased", "warranty"] as const;

export function InventoryTable({
  rows,
  state,
  visible,
}: {
  rows: AssetRow[];
  state: ListState;
  visible: string[]; // hideable-column ids currently shown
}) {
  const router = useRouter();

  const columns = INVENTORY_COLUMNS.filter(
    (c) => !HIDEABLE_COLUMNS.includes(c.id as (typeof HIDEABLE_COLUMNS)[number]) || visible.includes(c.id),
  );

  function onSort(sortKey: string) {
    const next = { ...state, sort: toggleSort(state.sort, sortKey), page: 1 };
    router.push("/inventory" + serializeListState(next, INVENTORY_LIST_CONFIG));
  }

  function sortProps(col: ColumnDef) {
    if (!col.sortKey) return {};
    const idx = state.sort.findIndex((s) => s.key === col.sortKey);
    return {
      onSort: () => onSort(col.sortKey!),
      sort: idx >= 0 ? state.sort[idx].dir : undefined,
      sortIndex: idx >= 0 && state.sort.length > 1 ? idx + 1 : undefined,
    };
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th width={19} aria-label="Status colour" />
          {columns.map((col) => (
            <Th key={col.id} width={col.width} {...sortProps(col)}>
              {col.label}
            </Th>
          ))}
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr
            key={row.id}
            className="cursor-pointer"
            onClick={() => router.push(`/inventory/${row.id}`)}
          >
            <Td className="pr-0">
              <StatusDot value={row.status} />
            </Td>
            {columns.map((col) => {
              switch (col.id) {
                case "tag":
                  return (
                    <Td key={col.id} mono>
                      <a
                        href={`/inventory/${row.id}`}
                        className="text-accent hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.tag}
                      </a>
                    </Td>
                  );
                case "model":
                  return <Td key={col.id}>{row.model}</Td>;
                case "category":
                  return <Td key={col.id}>{row.category}</Td>;
                case "assigned":
                  return <Td key={col.id}>{row.assignee ?? <span className="text-fg-faint">—</span>}</Td>;
                case "status":
                  return <Td key={col.id} mono className="text-[10.5px]">{row.status}</Td>;
                case "purchased":
                  return <Td key={col.id} mono>{row.purchased}</Td>;
                case "warranty":
                  return <Td key={col.id} mono>{row.warranty}</Td>;
                default:
                  return <Td key={col.id} />;
              }
            })}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
```

- [ ] **Step 5: Create `src/app/(app)/inventory/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import {
  clearFilters, parseListState, serializeListState, toSearchParams, withFilter,
} from "@/lib/url-state";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { exactTagMatch, facetOptions, listAssets } from "@/server/modules/inventory/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { InventoryTable, HIDEABLE_COLUMNS } from "@/components/inventory/inventory-table";
import { InventoryToolbar } from "@/components/inventory/inventory-toolbar";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const state = parseListState(toSearchParams(await searchParams), INVENTORY_LIST_CONFIG);

  // USB scanner contract: an exact tag match opens the record, not a list.
  if (state.q) {
    const hit = await exactTagMatch(state.q);
    if (hit) redirect(`/inventory/${hit.id}`);
  }

  const [{ rows, total, pageCount }, facets] = await Promise.all([
    listAssets(state),
    facetOptions(state),
  ]);

  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0;
  const href = (s: typeof state) => "/inventory" + serializeListState(s, INVENTORY_LIST_CONFIG);

  const chips: FilterChip[] = [];
  for (const [facet, values] of Object.entries(state.filters)) {
    for (const value of values) {
      const label = facets[facet]?.find((o) => o.value === value)?.label ?? value;
      chips.push({
        label: `${facet}: ${label}`,
        removeHref: href(withFilter(state, facet, values.filter((v) => v !== value))),
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={
          <>
            <ButtonLink href={"/inventory/export" + serializeListState(state, INVENTORY_LIST_CONFIG)}>
              Export
            </ButtonLink>
            {canMutate && <ButtonLink variant="primary" href="/inventory/new">New asset</ButtonLink>}
          </>
        }
      />
      <div className="flex flex-col gap-2">
        <InventoryToolbar state={state} total={total} facets={facets} />
        <ChipFilterRow chips={chips} clearHref={href(clearFilters(state))} />
        {rows.length > 0 ? (
          <>
            <InventoryTable rows={rows} state={state} visible={[...HIDEABLE_COLUMNS]} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">
                page {state.page} of {pageCount}
              </span>
              <Pagination page={state.page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
            </div>
          </>
        ) : hasFilters ? (
          <EmptyState
            title="Your filters matched nothing"
            description={`${chips.length + (state.q ? 1 : 0)} active filter${chips.length + (state.q ? 1 : 0) === 1 ? "" : "s"} — loosen or clear them.`}
            actions={<ButtonLink href={href(clearFilters(state))}>Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="No assets yet"
            description="Register the first asset; bulk import arrives in Phase 8."
            actions={canMutate ? <ButtonLink variant="primary" href="/inventory/new">New asset</ButtonLink> : undefined}
          />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Create `src/app/(app)/inventory/loading.tsx`** (matches the final rhythm — same row height, roughly same column masses)

```tsx
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function InventoryLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-[260px]" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonRow key={i} columns={7} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/ui/button-link.tsx src/components/patterns/chip-filter-row.tsx \
  src/components/inventory/inventory-toolbar.tsx src/components/inventory/inventory-table.tsx \
  "src/app/(app)/inventory/page.tsx" "src/app/(app)/inventory/loading.tsx"
git commit -m "feat(inventory): server-rendered list — search, sortable island, chips, pagination, empty/loading states

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check after this task: `/inventory` as it@ (sort toggles rewrite `?sort=`, exact tag search `BR-LT-0148` jumps to the record — record 404s until Task 13, the redirect is what's being checked) and as viewer@ (READ-ONLY badge, no New asset).

---

### Task 8: Facet dropdowns (URL updates only on Apply)

**Files:**
- Create: `src/components/patterns/facet-dropdown.tsx`
- Modify: `src/components/inventory/inventory-toolbar.tsx`, `src/app/(app)/inventory/page.tsx`

- [ ] **Step 1: Create `src/components/patterns/facet-dropdown.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";

export interface FacetOptionLike {
  value: string;
  label: string;
  count: number;
}

/**
 * Draft-state multi-select: checking boxes edits local state only; the URL
 * updates on Apply (handover: "URL updates only on Apply"). Zero-count
 * options render dimmed but present.
 */
export function FacetDropdown({
  label,
  options,
  selected,
  onApply,
}: {
  label: string;
  options: FacetOptionLike[];
  selected: string[];
  onApply: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const focusTrigger = () =>
    rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();

  useOverlayLayer(open, () => {
    setOpen(false);
    focusTrigger();
  });

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selected));
    setFilter("");
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-(--radius-btn) border px-2.5 py-1.5 text-[11.5px] font-medium",
          "transition-colors duration-(--dur-1)",
          selected.length
            ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
            : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
        )}
      >
        {label}
        {selected.length > 0 && <span className="font-mono text-[10px]">{selected.length}</span>}
        <span aria-hidden className="text-fg-faint">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Filter by ${label}`}
          className="absolute left-0 top-full z-40 mt-1 w-[230px] rounded-(--radius-btn) border border-border bg-surface-raised p-2 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          <Input
            aria-label={`Search ${label} options`}
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-2 px-2 py-1 text-xs"
          />
          <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
            {shown.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 text-xs hover:bg-surface-subtle",
                  opt.count === 0 && !draft.has(opt.value) && "opacity-45",
                )}
              >
                <Checkbox
                  checked={draft.has(opt.value)}
                  onChange={(e) => {
                    const next = new Set(draft);
                    if (e.target.checked) next.add(opt.value);
                    else next.delete(opt.value);
                    setDraft(next);
                  }}
                />
                <span className="flex-1 truncate text-fg-secondary">{opt.label}</span>
                <span className="font-mono text-[10px] text-fg-faint">{opt.count}</span>
              </label>
            ))}
            {shown.length === 0 && (
              <p className="px-1.5 py-2 text-[11px] text-fg-muted">No options match.</p>
            )}
          </div>
          <div className="mt-2 flex justify-between gap-2 border-t border-border-faint pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDraft(new Set())}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setOpen(false);
                focusTrigger();
                onApply([...draft]);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the four facets in `src/components/inventory/inventory-toolbar.tsx`**

Replace the `{children}` slot usage for facets: add inside the toolbar, after the search input:

```tsx
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { withFilter } from "@/lib/url-state"; // extend the existing import

// inside the component body:
function applyFacet(facet: string, values: string[]) {
  router.push(pathname + serializeListState(withFilter(state, facet, values), INVENTORY_LIST_CONFIG));
}

// in JSX, after the search input (keep {children} after these for Task 10's chooser):
{(["status", "category", "type", "assignee"] as const).map((facet) => (
  <FacetDropdown
    key={facet}
    label={facet === "assignee" ? "Assigned" : facet[0].toUpperCase() + facet.slice(1)}
    options={facets[facet] ?? []}
    selected={state.filters[facet] ?? []}
    onApply={(values) => applyFacet(facet, values)}
  />
))}
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/patterns/facet-dropdown.tsx src/components/inventory/inventory-toolbar.tsx
git commit -m "feat(inventory): facet dropdowns — draft state, per-option counts, URL on Apply

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: pick two statuses → URL only changes on Apply; chips echo the URL; zero-count options dimmed but present.

---

### Task 9: Row selection, bulk drawer, bulk status-change approvals

**Files:**
- Create: `src/components/inventory/bulk-drawer.tsx`, `src/components/patterns/rate-limit-notice.tsx`, `src/server/modules/inventory/actions.ts`
- Modify: `src/components/inventory/inventory-table.tsx`, `src/app/(app)/inventory/page.tsx`

- [ ] **Step 1: Create `src/components/patterns/rate-limit-notice.tsx`** (the designed rate-limited state — reused by every mutating form this phase)

```tsx
"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { ProgressBar } from "@/components/ui/progress-bar";

export function RateLimitNotice({
  retryAfterSec,
  onExpire,
}: {
  retryAfterSec: number;
  onExpire?: () => void;
}) {
  const [left, setLeft] = useState(retryAfterSec);
  useEffect(() => {
    setLeft(retryAfterSec);
    const timer = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          onExpire?.();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryAfterSec]);

  return (
    <Banner tone="attention" title="You've made 60 changes this minute — the cap">
      <p>Nothing was lost: this form still holds your input.</p>
      <div className="mt-2">
        <ProgressBar value={retryAfterSec - left} max={retryAfterSec} label="Seconds until retry" />
      </div>
      <p className="mt-1 font-mono text-[11px]">
        {left > 0 ? `you can retry in ${left}s` : "you can retry now"}
      </p>
    </Banner>
  );
}
```

- [ ] **Step 2: Create `src/server/modules/inventory/actions.ts`** with the bulk action (createAsset/updateAsset/requestStatusChange join this file in Tasks 12/14)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { ASSET_STATUSES, buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { parseListState } from "@/lib/url-state";

const BULK_MAX = 200;

const bulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    /** serialized list query (e.g. "status=SPARE&q=dell") when acting on all matching */
    filters: z.string().max(2000).optional(),
    to: z.enum(ASSET_STATUSES),
    reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filters !== undefined, {
    message: "Nothing is selected",
    path: ["ids"],
  });

/**
 * Bulk lifecycle change = one lifecycle.change-status approval PER asset —
 * never a direct write (spec: approvals gate lifecycle). Assets already in
 * the target status or with an open approval are skipped and counted.
 */
export async function bulkRequestStatusChange(
  input: unknown,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { ids, filters, to, reason } = parsed.data;

  const where = ids?.length
    ? { id: { in: ids } }
    : buildAssetWhere(parseListState(new URLSearchParams(filters), INVENTORY_LIST_CONFIG));

  const assets = await prisma.asset.findMany({
    where,
    take: BULK_MAX + 1,
    select: { id: true, status: true },
  });
  if (assets.length === 0) return conflict("Nothing matched the selection.");
  if (assets.length > BULK_MAX) {
    return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
  }

  let created = 0;
  let skipped = 0;
  await prisma.$transaction(async (tx) => {
    for (const asset of assets) {
      if (asset.status === to || (await openApprovalForAsset(tx, asset.id))) {
        skipped += 1;
        continue;
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_change_status",
        payload: { from: { status: asset.status }, to: { status: to }, reason },
        requestedById: user.id,
        assetId: asset.id,
      });
      await writeAudit(tx, {
        actorId: user.id,
        actorLabel: user.name,
        entityType: "asset",
        entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      created += 1;
    }
  });

  revalidatePath("/inventory");
  return ok({ created, skipped });
}
```

- [ ] **Step 3: Create `src/components/inventory/bulk-drawer.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import { bulkRequestStatusChange } from "@/server/modules/inventory/actions";

export function BulkDrawer({
  open,
  onClose,
  selectedIds,
  allMatching,
  filtersQS,
  total,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  allMatching: boolean;
  filtersQS: string; // serialized current list state, no leading "?"
  total: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [to, setTo] = useState<string>("SPARE");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const scope = allMatching ? `all ${total} matching assets` : `${selectedIds.length} selected asset${selectedIds.length === 1 ? "" : "s"}`;

  function submit() {
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
    startTransition(async () => {
      const res = await bulkRequestStatusChange({
        ids: allMatching ? undefined : selectedIds,
        filters: allMatching ? filtersQS : undefined,
        to,
        reason,
      });
      if (res.ok) {
        toast(
          `${res.data.created} approval${res.data.created === 1 ? "" : "s"} created` +
            (res.data.skipped ? ` · ${res.data.skipped} skipped (already there or already requested)` : ""),
          "settled",
        );
        onDone();
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") {
        setRetryAfter(res.retryAfterSec ?? 60);
      } else if (res.kind === "validation") {
        setFieldErrors(res.fieldErrors ?? {});
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <Drawer open={open} onClose={onClose} title="Bulk actions">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-fg-muted">
          Acting on <span className="font-medium text-fg-secondary">{scope}</span>. Each asset gets its
          own <span className="font-mono">lifecycle.change-status</span> approval — nothing changes until
          it's approved and executed.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="Target status" required error={fieldErrors.to}>
          {(props) => (
            <Select
              id={props.id}
              aria-describedby={props["aria-describedby"]}
              invalid={props.invalid}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Reason" required error={fieldErrors.reason} hint="Goes into every approval's payload.">
          {(props) => (
            <Textarea
              id={props.id}
              aria-describedby={props["aria-describedby"]}
              invalid={props.invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Request status change
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 4: Add selection to `src/components/inventory/inventory-table.tsx`**

Modify the island: new props `canMutate: boolean`, `filtersQS: string`, `total: number`. Add state and the selection bar; render a checkbox column only when `canMutate` (viewer/purchasing get NO checkboxes — read-only means absent, not disabled):

```tsx
// additional imports
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { BulkDrawer } from "./bulk-drawer";

// inside InventoryTable({ rows, state, visible, canMutate, filtersQS, total }):
const [selected, setSelected] = useState<Set<string>>(new Set());
const [allMatching, setAllMatching] = useState(false);
const [drawerOpen, setDrawerOpen] = useState(false);

const pageIds = rows.map((r) => r.id);
const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
const someOnPage = pageIds.some((id) => selected.has(id));

function toggleAllOnPage() {
  setAllMatching(false);
  setSelected(allOnPage ? new Set() : new Set(pageIds));
}
function toggleRow(id: string) {
  setAllMatching(false);
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
function clearSelection() {
  setSelected(new Set());
  setAllMatching(false);
}
```

Selection bar JSX (render above `<Table>` when `selected.size > 0`):

```tsx
{canMutate && selected.size > 0 && (
  <div className="flex items-center gap-3 rounded-(--radius-card) border border-accent-soft-border bg-accent-tint px-3 py-2 text-xs text-fg-secondary">
    <span className="font-mono text-[11px]">
      {allMatching ? `all ${total} matching selected` : `${selected.size} selected on this page`}
    </span>
    {!allMatching && total > rows.length && (
      <button type="button" className="text-accent hover:underline" onClick={() => setAllMatching(true)}>
        Select all {total} matching
      </button>
    )}
    <span className="ml-auto flex gap-2">
      <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
      <Button size="sm" variant="primary" onClick={() => setDrawerOpen(true)}>Bulk actions…</Button>
    </span>
  </div>
)}
```

Header/body checkbox cells (first column, before the dot column, only when `canMutate`):

```tsx
// header
{canMutate && (
  <Th width={30}>
    <Checkbox
      aria-label="Select all on this page"
      checked={allOnPage}
      indeterminate={!allOnPage && someOnPage}
      onChange={toggleAllOnPage}
    />
  </Th>
)}
// body row (first cell; stop propagation so ticking doesn't open the record)
{canMutate && (
  <Td className="pr-0" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
    <Checkbox
      aria-label={`Select ${row.tag}`}
      checked={selected.has(row.id)}
      onChange={() => toggleRow(row.id)}
    />
  </Td>
)}
```

(`Td` doesn't accept `onClick` today — extend it in `src/components/ui/table.tsx` by spreading rest props: change its signature to `({ className, align = "left", mono, children, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right"; mono?: boolean })` and spread `{...rest}` onto `<td>`. Keep the existing styling logic.)

Mount the drawer after `</Table>`:

```tsx
{canMutate && (
  <BulkDrawer
    open={drawerOpen}
    onClose={() => setDrawerOpen(false)}
    selectedIds={[...selected]}
    allMatching={allMatching}
    filtersQS={filtersQS}
    total={total}
    onDone={clearSelection}
  />
)}
```

Also add `selected={selected.has(row.id)}` to each `Tr` so selected rows tint.

- [ ] **Step 5: Pass the new props from `src/app/(app)/inventory/page.tsx`**

```tsx
<InventoryTable
  rows={rows}
  state={state}
  visible={[...HIDEABLE_COLUMNS]}
  canMutate={canMutate}
  filtersQS={serializeListState(state, INVENTORY_LIST_CONFIG).replace(/^\?/, "")}
  total={total}
/>
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/inventory src/components/patterns/rate-limit-notice.tsx \
  src/server/modules/inventory/actions.ts src/components/ui/table.tsx "src/app/(app)/inventory/page.tsx"
git commit -m "feat(inventory): row selection, select-all-matching, bulk status-change approvals

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: as it@ select 2 rows → bulk drawer → request DISPOSE with a reason → toast "2 approvals created"; repeat immediately → "2 skipped". As viewer@: no checkboxes at all.

### Task 10: Column chooser (per-user `UserPreference`, NOT URL)

**Files:**
- Create: `src/lib/column-prefs.ts`, `src/server/preferences.ts`, `src/components/inventory/column-chooser.tsx`
- Modify: `src/components/inventory/inventory-table.tsx` (import the hideable list from lib), `src/server/modules/inventory/queries.ts` (getInventoryColumns), `src/app/(app)/inventory/page.tsx`

- [ ] **Step 1: Create `src/lib/column-prefs.ts`** (the whitelist lives in lib — a `"use server"` file may only export async functions)

```ts
/** Column visibility is a per-user preference (UserPreference table), NOT URL state — a shared link shows YOUR columns, not theirs. */
export const COLUMN_PREF_KEYS = {
  "columns:inventory": ["category", "assigned", "purchased", "warranty"],
} as const;

export type ColumnPrefKey = keyof typeof COLUMN_PREF_KEYS;
```

In `src/components/inventory/inventory-table.tsx`, replace the local `HIDEABLE_COLUMNS` definition with:

```tsx
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";

export const HIDEABLE_COLUMNS = COLUMN_PREF_KEYS["columns:inventory"];
```

(Adjust the `includes` cast accordingly: `!(HIDEABLE_COLUMNS as readonly string[]).includes(c.id)`.)

- [ ] **Step 2: Create `src/server/preferences.ts`** (the save action)

```ts
"use server";

import { z } from "zod";
import { prisma } from "./db/client";
import { actionUser } from "./auth/guards";
import { checkRate } from "./rate-limit";
import {
  forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "./action-result";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";

const schema = z.object({
  key: z.literal("columns:inventory"), // extend to a union as more tables gain choosers
  visible: z.array(z.string()).max(20),
});

/**
 * Preference writes skip the audit trail (user preference, not domain data —
 * recorded scope decision #9) but still count against the mutation budget.
 * Any authenticated role may save its own columns — viewer included.
 */
export async function saveColumns(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const allowed = COLUMN_PREF_KEYS[parsed.data.key] as readonly string[];
  const visible = parsed.data.visible.filter((c) => allowed.includes(c));

  await prisma.userPreference.upsert({
    where: { userId_key: { userId: user.id, key: parsed.data.key } },
    update: { value: visible },
    create: { userId: user.id, key: parsed.data.key, value: visible },
  });
  return ok(null);
}
```

- [ ] **Step 3: Add the read side to `src/server/modules/inventory/queries.ts`**

```ts
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";

/** Visible hideable columns for this user; default = all. */
export async function getInventoryColumns(userId: string): Promise<string[]> {
  const allowed = COLUMN_PREF_KEYS["columns:inventory"] as readonly string[];
  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "columns:inventory" } },
  });
  if (!pref || !Array.isArray(pref.value)) return [...allowed];
  return (pref.value as string[]).filter((c) => allowed.includes(c));
}
```

- [ ] **Step 4: Create `src/components/inventory/column-chooser.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";
import { saveColumns } from "@/server/preferences";

const LABELS: Record<string, string> = {
  category: "Category", assigned: "Assigned", purchased: "Purchased", warranty: "Warranty",
};

export function ColumnChooser({ visible }: { visible: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(visible));
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const focusTrigger = () => rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  useOverlayLayer(open, () => { setOpen(false); focusTrigger(); });

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(visible));
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function apply() {
    startTransition(async () => {
      await saveColumns({ key: "columns:inventory", visible: [...draft] });
      setOpen(false);
      focusTrigger();
      router.refresh();
    });
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Columns
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose columns"
          className="absolute right-0 top-full z-40 mt-1 w-[180px] rounded-(--radius-btn) border border-border bg-surface-raised p-2 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          <p className="px-1 pb-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-faint">
            Yours only — not in the URL
          </p>
          {COLUMN_PREF_KEYS["columns:inventory"].map((col) => (
            <label key={col} className="flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 text-xs text-fg-secondary hover:bg-surface-subtle">
              <Checkbox
                checked={draft.has(col)}
                onChange={(e) => {
                  const next = new Set(draft);
                  if (e.target.checked) next.add(col);
                  else next.delete(col);
                  setDraft(next);
                }}
              />
              {LABELS[col]}
            </label>
          ))}
          <div className="mt-2 flex justify-end border-t border-border-faint pt-2">
            <Button size="sm" variant="primary" loading={pending} onClick={apply}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire into the page** (`src/app/(app)/inventory/page.tsx`)

Fetch the preference alongside the list and pass it through; mount the chooser in the toolbar's `children` slot:

```tsx
import { getInventoryColumns } from "@/server/modules/inventory/queries"; // extend import
import { ColumnChooser } from "@/components/inventory/column-chooser";

const [{ rows, total, pageCount }, facets, visibleColumns] = await Promise.all([
  listAssets(state),
  facetOptions(state),
  getInventoryColumns(user.id),
]);

<InventoryToolbar state={state} total={total} facets={facets}>
  <ColumnChooser visible={visibleColumns} />
</InventoryToolbar>
…
<InventoryTable … visible={visibleColumns} … />
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/column-prefs.ts src/server/preferences.ts src/components/inventory/column-chooser.tsx \
  src/components/inventory/inventory-table.tsx src/server/modules/inventory/queries.ts "src/app/(app)/inventory/page.tsx"
git commit -m "feat(inventory): per-user column visibility via UserPreference — not URL state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: CSV export with the 10,000-row cap (TDD for csv helpers)

**Files:**
- Create: `src/lib/csv.ts` (+ `.test.ts`), `src/app/(app)/inventory/export/route.ts`
- Modify: `src/components/inventory/bulk-drawer.tsx` (Export selection link)

- [ ] **Step 1: Write the failing tests** (`src/lib/csv.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("passes plain values through and blanks null/undefined", () => {
    expect(csvCell("BR-LT-0148")).toBe("BR-LT-0148");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("quotes commas/quotes/newlines and doubles inner quotes", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutralizes spreadsheet formula injection", () => {
    expect(csvCell("=HYPERLINK(...)")).toBe("'=HYPERLINK(...)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2")).toBe("'-2");
  });
});

it("toCsv joins with CRLF and ends with a newline", () => {
  expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/csv.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/csv.ts`**

```ts
/**
 * CSV for Excel: CRLF rows, RFC-4180 quoting, and a formula-injection guard —
 * a cell starting with = + - @ gets an apostrophe prefix so Excel treats it
 * as text (asset notes are user input landing in a spreadsheet).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: Run tests — green**

Run: `npm run test -- src/lib/csv.test.ts` — Expected: PASS.

- [ ] **Step 5: Create `src/app/(app)/inventory/export/route.ts`**

The static `export` segment wins over `[id]`, and living under `/inventory` means middleware path rules already gate it (it + purchasing workspaces; read-only roles may export — it's a read).

```ts
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toCsv } from "@/lib/csv";
import { buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { parseListState } from "@/lib/url-state";

const CAP = 10_000;

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);

  const idsParam = url.searchParams.get("ids");
  const state = parseListState(url.searchParams, INVENTORY_LIST_CONFIG);
  const where = idsParam
    ? { id: { in: idsParam.split(",").filter(Boolean).slice(0, 500) } }
    : buildAssetWhere(state);

  const count = await prisma.asset.count({ where });
  if (count > CAP) {
    return new Response(
      `Export refused: ${count} rows exceeds the ${CAP}-row cap. ` +
        `Narrow the filters (splitting by purchase year works well) and try again. Nothing was exported.`,
      { status: 413, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: idsParam ? { tag: "asc" } : buildAssetOrderBy(state.sort),
    include: { category: true, type: true, assignee: true, vendor: true },
  });

  const csv = toCsv(
    ["tag", "model", "serial", "category", "type", "status", "assignee", "employeeNo",
     "purchasedAt", "cost", "warrantyUntil", "vendor", "rmaRef", "notes"],
    assets.map((a) => [
      a.tag, a.model, a.serial, a.category.name, a.type?.name ?? "", a.status,
      a.assignee?.name ?? "", a.assignee?.employeeNo ?? "",
      a.purchasedAt?.toISOString().slice(0, 10) ?? "", a.cost?.toString() ?? "",
      a.warrantyUntil?.toISOString().slice(0, 10) ?? "", a.vendor?.name ?? "",
      a.rmaRef ?? "", a.notes ?? "",
    ]),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
```

- [ ] **Step 6: Add "Export selection" to the bulk drawer** (`src/components/inventory/bulk-drawer.tsx`, below the scope paragraph)

```tsx
<a
  href={allMatching || selectedIds.length === 0
    ? `/inventory/export${filtersQS ? `?${filtersQS}` : ""}`
    : `/inventory/export?ids=${selectedIds.join(",")}`}
  className="text-xs text-accent hover:underline"
>
  Export this selection as CSV
</a>
```

(Plain `<a>`, not `Link` — a download route must not be prefetched.)

- [ ] **Step 7: Verify and commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/csv.ts src/lib/csv.test.ts "src/app/(app)/inventory/export/route.ts" src/components/inventory/bulk-drawer.tsx
git commit -m "feat(inventory): CSV export — filters honored, 10k-row cap refusal, injection-safe cells

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: `/inventory/new` — create form + `createAsset` (TDD for creation rules)

**Files:**
- Create: `src/lib/asset-rules.ts` (+ `.test.ts`), `src/components/patterns/entity-combobox.tsx`, `src/components/inventory/asset-form.tsx`, `src/app/(app)/inventory/new/page.tsx`
- Modify: `src/server/modules/inventory/actions.ts`

- [ ] **Step 1: Write the failing tests** (`src/lib/asset-rules.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { creationPlan, warrantyProgress, CREATABLE_STATUSES } from "./asset-rules";

describe("creationPlan (README 3b: assignment routes through lifecycle.assign)", () => {
  it("SPARE is a plain direct write", () => {
    expect(creationPlan("SPARE", null)).toEqual({ ok: true, status: "SPARE", approval: null });
  });
  it("DEPLOYED/TEMPORARY require an assignee", () => {
    expect(creationPlan("DEPLOYED", null)).toEqual({ ok: false, error: "assignee_required" });
    expect(creationPlan("TEMPORARY", "")).toEqual({ ok: false, error: "assignee_required" });
  });
  it("assignment creates the asset SPARE plus an approval — never a direct DEPLOYED write", () => {
    expect(creationPlan("DEPLOYED", "emp1")).toEqual({
      ok: true, status: "SPARE", approval: { toStatus: "DEPLOYED", assigneeId: "emp1" },
    });
  });
  it("only SPARE/DEPLOYED/TEMPORARY are offered on creation", () => {
    expect(CREATABLE_STATUSES).toEqual(["SPARE", "DEPLOYED", "TEMPORARY"]);
  });
});

describe("warrantyProgress", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  it("null without a warranty date", () => {
    expect(warrantyProgress(new Date(), null, now)).toBeNull();
  });
  it("reports elapsed share and days remaining", () => {
    const p = warrantyProgress(new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), now);
    expect(p?.label).toBe("expires in 138 d");
    expect(Math.round(p!.pct)).toBe(62);
  });
  it("clamps at 100% and reports expiry age", () => {
    const p = warrantyProgress(new Date("2024-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"), now);
    expect(p?.pct).toBe(100);
    expect(p?.label).toBe("expired 593 d ago");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/asset-rules.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/asset-rules.ts`**

```ts
/** Only these are offered on creation (README 3b). */
export const CREATABLE_STATUSES = ["SPARE", "DEPLOYED", "TEMPORARY"] as const;
export type CreatableStatus = (typeof CREATABLE_STATUSES)[number];

export type CreationPlan =
  | { ok: true; status: "SPARE"; approval: null | { toStatus: "DEPLOYED" | "TEMPORARY"; assigneeId: string } }
  | { ok: false; error: "assignee_required" };

/**
 * Assets are always CREATED as SPARE. Requesting DEPLOYED/TEMPORARY yields a
 * lifecycle.assign approval — the worker (Phase 4) performs the actual flip,
 * and until then the asset honestly reads SPARE everywhere.
 */
export function creationPlan(requested: CreatableStatus, assigneeId: string | null): CreationPlan {
  if (requested === "SPARE") return { ok: true, status: "SPARE", approval: null };
  if (!assigneeId) return { ok: false, error: "assignee_required" };
  return { ok: true, status: "SPARE", approval: { toStatus: requested, assigneeId } };
}

const DAY_MS = 86_400_000;

/** Warranty as text + mini bar (record Overview). pct = elapsed share of the span. */
export function warrantyProgress(
  purchasedAt: Date | null,
  warrantyUntil: Date | null,
  now: Date = new Date(),
): { pct: number; label: string } | null {
  if (!warrantyUntil) return null;
  const end = warrantyUntil.getTime();
  const start = purchasedAt?.getTime() ?? end - 365 * DAY_MS;
  const span = Math.max(1, end - start);
  const pct = Math.min(100, Math.max(0, ((now.getTime() - start) / span) * 100));
  const days = Math.ceil((end - now.getTime()) / DAY_MS);
  return { pct, label: days >= 0 ? `expires in ${days} d` : `expired ${-days} d ago` };
}
```

- [ ] **Step 4: Run tests — green**

Run: `npm run test -- src/lib/asset-rules.test.ts` — Expected: PASS.

- [ ] **Step 5: Add `createAsset` to `src/server/modules/inventory/actions.ts`**

Add imports: `import { creationPlan, CREATABLE_STATUSES } from "@/lib/asset-rules";`, `import { Prisma } from "@prisma/client";` and:

```ts
const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);

const createSchema = z.object({
  tag: z.string().trim().toUpperCase().regex(/^BR-[A-Z]{2}-\d{4}$/, "Format: BR-XX-0000"),
  model: z.string().trim().min(2, "Name the model").max(120),
  serial: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  purchasedAt: dateStr.optional(),
  cost: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000)]).optional(),
  warrantyUntil: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  requestedStatus: z.enum(CREATABLE_STATUSES),
  assigneeId: z.string().optional(),
  assignReason: z.string().trim().max(500).optional(),
});

function uniqueTarget(err: unknown): string[] {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    ? ((err.meta?.target as string[] | undefined) ?? [])
    : [];
}

const toDate = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const toCost = (c: number | "" | undefined) => (c === "" || c === undefined ? null : c);

export async function createAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const plan = creationPlan(d.requestedStatus, d.assigneeId || null);
  if (!plan.ok) return validationError({ assigneeId: "Pick who this deploys to" });

  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId } });
    if (!type || type.categoryId !== d.categoryId) {
      return validationError({ typeId: "That type doesn't belong to the chosen category" });
    }
  }
  if (plan.approval) {
    const employee = await prisma.employee.findUnique({ where: { id: plan.approval.assigneeId } });
    if (!employee) return validationError({ assigneeId: "Unknown employee" });
    if (employee.employment !== "ACTIVE") {
      return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — assignments are frozen.`);
    }
  }

  try {
    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          tag: d.tag,
          model: d.model,
          serial: d.serial || null,
          categoryId: d.categoryId,
          typeId: d.typeId || null,
          status: "SPARE",
          purchasedAt: toDate(d.purchasedAt),
          cost: toCost(d.cost),
          warrantyUntil: toDate(d.warrantyUntil),
          notes: d.notes || null,
        },
      });
      await writeAudit(tx, {
        actorId: user.id,
        actorLabel: user.name,
        entityType: "asset",
        entityId: created.id,
        action: "create",
        diff: {
          tag: { from: null, to: created.tag },
          model: { from: null, to: created.model },
          status: { from: null, to: "SPARE" },
        },
      });
      if (plan.approval) {
        const approval = await createApproval(tx, {
          type: "lifecycle_assign",
          payload: {
            to: { assigneeId: plan.approval.assigneeId, status: plan.approval.toStatus },
            reason: d.assignReason || "assigned at registration",
          },
          requestedById: user.id,
          assetId: created.id,
          employeeId: plan.approval.assigneeId,
        });
        await writeAudit(tx, {
          actorId: user.id,
          actorLabel: user.name,
          entityType: "asset",
          entityId: created.id,
          action: "approval.requested",
          diff: { approval: { from: null, to: approval.refNo } },
        });
      }
      return created;
    });
    revalidatePath("/inventory");
    return ok({ id: asset.id });
  } catch (err) {
    const target = uniqueTarget(err);
    if (target.includes("tag")) return validationError({ tag: "That tag is already registered" });
    if (target.includes("serial")) return validationError({ serial: "That serial is already registered" });
    throw err;
  }
}
```

- [ ] **Step 6: Create `src/components/patterns/entity-combobox.tsx`** (keyboard-first typeahead over preloaded options — team scale, no server round-trips)

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "@/components/ui/input";

export interface ComboOption {
  value: string;
  label: string;
  sub?: string;
  note?: string; // e.g. "reserved for K. Uy" — shown, not disabling
}

export function EntityCombobox({
  options,
  value,
  onChange,
  placeholder,
  id,
  invalid,
  "aria-describedby": describedBy,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const shown = query
    ? options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(query.toLowerCase()))
    : options;

  function pick(option: ComboOption | null) {
    onChange(option?.value ?? null);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].value}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={fieldClasses(invalid)}
        placeholder={placeholder}
        value={open ? query : (selected ? `${selected.label}${selected.sub ? ` · ${selected.sub}` : ""}` : "")}
        onFocus={() => { setOpen(true); setActive(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // let option mousedown land first
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); if (!e.target.value) onChange(null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }
          else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-[220px] w-full overflow-y-auto rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          {shown.length === 0 && <li className="px-2 py-1.5 text-xs text-fg-muted">No matches.</li>}
          {shown.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${option.value}`}
              role="option"
              aria-selected={option.value === value}
              className={cn(
                "cursor-pointer rounded-[5px] px-2 py-1.5 text-xs",
                i === active ? "bg-accent-tint text-fg" : "text-fg-secondary",
              )}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(option); }}
            >
              <span className="font-medium">{option.label}</span>
              {option.sub && <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{option.sub}</span>}
              {option.note && <span className="ml-1.5 text-[10px] text-fg-muted">{option.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create `src/components/inventory/asset-form.tsx`** (shared by new + edit; edit specifics land in Task 14)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { CREATABLE_STATUSES, type CreatableStatus } from "@/lib/asset-rules";
import type { ActionResult } from "@/server/action-result";

export interface AssetFormInitial {
  tag: string;
  model: string;
  serial: string;
  categoryId: string;
  typeId: string;
  purchasedAt: string; // yyyy-mm-dd or ""
  cost: string;
  warrantyUntil: string;
  notes: string;
  vendorId: string;
  rmaRef: string;
  repairQuote: string;
}

export function AssetForm({
  mode,
  categories,
  types,
  employees,
  vendors = [],
  initial,
  action,
}: {
  mode: "new" | "edit";
  categories: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string; categoryId: string }>;
  employees: ComboOption[];
  vendors?: Array<{ id: string; name: string }>;
  initial?: AssetFormInitial;
  action: (payload: Record<string, unknown>) => Promise<ActionResult<{ id: string }>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<AssetFormInitial>(
    initial ?? {
      tag: "", model: "", serial: "", categoryId: "", typeId: "", purchasedAt: "",
      cost: "", warrantyUntil: "", notes: "", vendorId: "", rmaRef: "", repairQuote: "",
    },
  );
  const [requestedStatus, setRequestedStatus] = useState<CreatableStatus>("SPARE");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assignReason, setAssignReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof AssetFormInitial) => (value: string) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Derived, pre-filled, never blank: purchase date suggests +12 mo warranty.
      if (key === "purchasedAt" && value && !f.warrantyUntil) {
        const d = new Date(`${value}T00:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        next.warrantyUntil = d.toISOString().slice(0, 10);
      }
      return next;
    });
  };

  const typesForCategory = types.filter((t) => t.categoryId === form.categoryId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setConflictMsg(null);
    setRetryAfter(null);
    startTransition(async () => {
      const res = await action({
        ...form,
        requestedStatus: mode === "new" ? requestedStatus : undefined,
        assigneeId: mode === "new" ? (assigneeId ?? "") : undefined,
        assignReason: mode === "new" ? assignReason : undefined,
      });
      if (res.ok) {
        if (mode === "new") router.push(`/inventory/${res.data.id}`);
        else {
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
          router.refresh();
        }
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setErrors(res.fieldErrors ?? {});
      else setConflictMsg(res.message);
    });
  }

  const field = (
    label: string,
    key: keyof AssetFormInitial,
    opts: { required?: boolean; hint?: string; type?: string; disabled?: boolean; placeholder?: string } = {},
  ) => (
    <FormField label={label} required={opts.required} hint={opts.hint} error={errors[key]}>
      {(p) => (
        <Input
          id={p.id}
          aria-describedby={p["aria-describedby"]}
          invalid={p.invalid}
          type={opts.type ?? "text"}
          disabled={opts.disabled}
          placeholder={opts.placeholder}
          value={form[key]}
          onChange={(e) => set(key)(e.target.value)}
        />
      )}
    </FormField>
  );

  return (
    <form onSubmit={submit} className="flex max-w-[720px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {conflictMsg && <Banner tone="fault" title={conflictMsg} />}

      <Card>
        <CardHeader title="Identity" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("Asset tag", "tag", {
            required: true,
            hint: mode === "edit" ? "Tags are permanent — they're printed labels." : "Format BR-XX-0000, as printed on the label.",
            disabled: mode === "edit",
            placeholder: "BR-LT-0201",
          })}
          {field("Model", "model", { required: true, placeholder: "ThinkPad T14 Gen 4" })}
          {field("Serial", "serial")}
          <FormField label="Category" required error={errors.categoryId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value, typeId: "" }))}
              >
                <option value="">Pick a category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Type" hint="Types drive loadout-slot matching." error={errors.typeId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.typeId}
                disabled={!form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}
              >
                <option value="">—</option>
                {typesForCategory.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Procurement" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("Purchased", "purchasedAt", { type: "date" })}
          {field("Cost (₱)", "cost", { type: "number" })}
          {field("Warranty until", "warrantyUntil", { type: "date", hint: "Pre-filled at purchase + 12 months — adjust if the quote says otherwise." })}
          <FormField label="Notes" error={errors.notes} className="sm:col-span-2">
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.notes}
                onChange={(e) => set("notes")(e.target.value)}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      {mode === "edit" && (
        <Card>
          <CardHeader title="Repair / RMA" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Vendor" error={errors.vendorId}>
              {(p) => (
                <Select
                  id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.vendorId}
                  onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}
                >
                  <option value="">—</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              )}
            </FormField>
            {field("RMA reference", "rmaRef")}
            {field("Repair quote (₱)", "repairQuote", { type: "number" })}
          </CardBody>
        </Card>
      )}

      {mode === "new" && (
        <Card>
          <CardHeader title="Initial state" />
          <CardBody className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Initial status"
              options={CREATABLE_STATUSES.map((s) => ({ value: s, label: s }))}
              value={requestedStatus}
              onChange={(v) => setRequestedStatus(v as CreatableStatus)}
            />
            {requestedStatus !== "SPARE" && (
              <>
                <p className="text-xs text-fg-muted">
                  Assignment routes through a <span className="font-mono">lifecycle.assign</span> approval —
                  the asset is registered as SPARE and flips once the request executes.
                </p>
                <FormField label="Assign to" required error={errors.assigneeId}>
                  {(p) => (
                    <EntityCombobox
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      invalid={p.invalid}
                      options={employees}
                      value={assigneeId}
                      onChange={setAssigneeId}
                      placeholder="Type a name or EMP number…"
                    />
                  )}
                </FormField>
                <FormField label="Reason" error={errors.assignReason}>
                  {(p) => (
                    <Textarea
                      id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                      value={assignReason}
                      onChange={(e) => setAssignReason(e.target.value)}
                    />
                  )}
                </FormField>
              </>
            )}
          </CardBody>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {mode === "new" ? "Register asset" : saved ? "✓ Saved" : "Save changes"}
        </Button>
        {saved && <span className="text-xs text-fg-muted">audit entry written</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 8: Create `src/app/(app)/inventory/new/page.tsx`**

```tsx
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { AssetForm } from "@/components/inventory/asset-form";
import { createAsset } from "@/server/modules/inventory/actions";

export default async function NewAssetPage() {
  await requireRole("admin", "it_staff");
  const [categories, types, employees] = await Promise.all([
    prisma.assetCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { employment: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="New asset"
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "New" }]}
      />
      <AssetForm
        mode="new"
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        types={types.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId }))}
        employees={employees.map((e) => ({ value: e.id, label: e.name, sub: e.employeeNo }))}
        action={createAsset}
      />
    </>
  );
}
```

- [ ] **Step 9: Verify and commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/asset-rules.ts src/lib/asset-rules.test.ts src/components/patterns/entity-combobox.tsx \
  src/components/inventory/asset-form.tsx "src/app/(app)/inventory/new/page.tsx" src/server/modules/inventory/actions.ts
git commit -m "feat(inventory): asset registration — SPARE direct write, assignment via lifecycle.assign approval

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: register a SPARE asset (lands on the record once Task 13 ships — until then expect the redirect + 404, which is fine); duplicate tag shows the inline field error; DEPLOYED without assignee blocks.

### Task 13: Record chrome — `[id]` layout, tabs, Overview, activity placeholders

**Files:**
- Create: `src/lib/labels.ts`, `src/components/inventory/record-tabs.tsx`, `src/app/(app)/inventory/[id]/layout.tsx`, `src/app/(app)/inventory/[id]/page.tsx`, `src/app/(app)/inventory/[id]/not-found.tsx`, `src/app/(app)/inventory/activity/page.tsx`, `src/app/(app)/employees/activity/page.tsx`
- Modify: `src/server/modules/inventory/queries.ts` (wrap `getAsset` in React `cache`)

- [ ] **Step 1: Create `src/lib/labels.ts`**

```ts
import type { ApprovalType } from "@prisma/client";

/** Prisma maps the dotted enum values to underscored names; the UI shows the dotted originals. */
export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  lifecycle_assign: "lifecycle.assign",
  lifecycle_replace: "lifecycle.replace",
  lifecycle_transfer: "lifecycle.transfer",
  lifecycle_return: "lifecycle.return",
  lifecycle_change_status: "lifecycle.change-status",
};
```

- [ ] **Step 2: Dedupe `getAsset` between layout and pages** — in `src/server/modules/inventory/queries.ts`:

```ts
import { cache } from "react";

// (replace the existing declaration)
export const getAsset = cache((id: string) =>
  prisma.asset.findUnique({
    where: { id },
    include: {
      category: true,
      type: true,
      assignee: true,
      vendor: true,
      approvals: {
        where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
      },
    },
  }),
);
```

- [ ] **Step 3: Create `src/components/inventory/record-tabs.tsx`**

```tsx
"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Pill } from "@/components/ui/pill";

export function RecordTabs({ assetId }: { assetId: string }) {
  const pathname = usePathname();
  const base = `/inventory/${assetId}`;
  const items = [
    { label: "Overview" as React.ReactNode, href: base },
    { label: "History" as React.ReactNode, href: `${base}/history` },
    { label: "Timeline" as React.ReactNode, href: `${base}/timeline` },
    { label: "Documents" as React.ReactNode, href: `${base}/documents` },
    {
      label: (
        <span className="inline-flex items-center gap-1.5">
          Secrets <Pill>AUDITED</Pill>
        </span>
      ) as React.ReactNode,
      href: `${base}/secrets`,
    },
    { label: "Reservations" as React.ReactNode, href: `${base}/reservations` },
  ].map((t) => ({ ...t, active: t.href === base ? pathname === base : pathname.startsWith(t.href) }));
  return <Tabs items={items} />;
}
```

- [ ] **Step 4: Create `src/app/(app)/inventory/[id]/layout.tsx`**

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getAsset } from "@/server/modules/inventory/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { RecordTabs } from "@/components/inventory/record-tabs";
import { RequestStatusChange } from "@/components/inventory/request-status-change";

export default async function AssetRecordLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const pending = asset.approvals[0];

  return (
    <>
      <PageHeader
        title={asset.tag}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: asset.tag }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={asset.status} />
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          canMutate ? (
            <>
              <RequestStatusChange assetId={asset.id} currentStatus={asset.status} />
              <ButtonLink href={`/inventory/${asset.id}/edit`}>Edit</ButtonLink>
            </>
          ) : undefined
        }
      />
      <p className="-mt-2 pb-3 text-[13px] text-fg-secondary">
        {asset.model}
        {asset.assignee && (
          <>
            {" · held by "}
            <a href={`/employees/${asset.assignee.id}`} className="text-accent hover:underline">
              {asset.assignee.name}
            </a>
          </>
        )}
      </p>
      {pending && (
        <div className="pb-3">
          <Banner
            tone="inflight"
            title={`${pending.refNo} · ${APPROVAL_TYPE_LABEL[pending.type]} is ${pending.state.toLowerCase()}`}
          >
            Queued in the approval pipeline — until it executes, this asset still reads{" "}
            <span className="font-mono">{asset.status}</span> everywhere.
          </Banner>
        </div>
      )}
      <RecordTabs assetId={asset.id} />
      <div className="pt-4">{children}</div>
    </>
  );
}
```

(`RequestStatusChange` is created in Task 14 — to keep this task self-contained, create a placeholder file `src/components/inventory/request-status-change.tsx` now with the real signature and a plain disabled Button, and note Task 14 replaces its body:)

```tsx
"use client";

import { Button } from "@/components/ui/button";

/** Placeholder — Task 14 replaces the body with the dialog + server action. */
export function RequestStatusChange({ assetId, currentStatus }: { assetId: string; currentStatus: string }) {
  void assetId;
  void currentStatus;
  return <Button disabled>Request status change</Button>;
}
```

- [ ] **Step 5: Create `src/app/(app)/inventory/[id]/page.tsx`** (Overview)

```tsx
import { notFound } from "next/navigation";
import { getAsset } from "@/server/modules/inventory/queries";
import { warrantyProgress } from "@/lib/asset-rules";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status";

export default async function AssetOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const warranty = warrantyProgress(asset.purchasedAt, asset.warrantyUntil);

  return (
    <div className="grid max-w-[860px] grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Tag", value: asset.tag, mono: true },
              { label: "Model", value: asset.model },
              { label: "Serial", value: asset.serial ?? "—", mono: true },
              { label: "Category", value: asset.category.name },
              { label: "Type", value: asset.type?.name ?? "—" },
              { label: "Status", value: <StatusPill value={asset.status} /> },
              {
                label: "Assigned",
                value: asset.assignee ? (
                  <a href={`/employees/${asset.assignee.id}`} className="text-accent hover:underline">
                    {asset.assignee.name} · {asset.assignee.employeeNo}
                  </a>
                ) : ("—"),
              },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Procurement & warranty" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Purchased", value: fmtDate(asset.purchasedAt), mono: true },
              { label: "Cost", value: fmtMoney(asset.cost === null ? null : Number(asset.cost)), mono: true },
              {
                label: "Warranty",
                value: warranty ? (
                  <span className="flex w-full max-w-[240px] flex-col gap-1">
                    <span className="font-mono text-xs">{fmtDate(asset.warrantyUntil)} · {warranty.label}</span>
                    <ProgressBar value={warranty.pct} label="Warranty elapsed" />
                  </span>
                ) : ("—"),
              },
              ...(asset.vendor || asset.rmaRef || asset.repairQuote
                ? [
                    { label: "Vendor", value: asset.vendor?.name ?? "—" },
                    { label: "RMA", value: asset.rmaRef ?? "—", mono: true },
                    { label: "Quote", value: fmtMoney(asset.repairQuote === null ? null : Number(asset.repairQuote)), mono: true },
                  ]
                : []),
              { label: "Notes", value: asset.notes ?? "—" },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/app/(app)/inventory/[id]/not-found.tsx`**

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function AssetNotFound() {
  return (
    <EmptyState
      title="Asset not found"
      description="It may have been removed, or the link is stale."
      actions={<ButtonLink href="/inventory">Back to inventory</ButtonLink>}
    />
  );
}
```

- [ ] **Step 7: Create the two activity placeholders** (static segments beat `[id]` — without these, `/inventory/activity` would resolve to the record route and 404)

`src/app/(app)/inventory/activity/page.tsx`:

```tsx
import { requireUser } from "@/server/auth/guards";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";

export default async function InventoryActivityPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Inventory activity" badge={<Pill>PLANNED</Pill>} />
      <EmptyState
        title="This screen arrives in Phase 4"
        description="/inventory/activity is on the roadmap — the navigation is real, the page isn't built yet."
      />
    </>
  );
}
```

`src/app/(app)/employees/activity/page.tsx`: identical shape with title "Employee activity" and path `/employees/activity`.

- [ ] **Step 8: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/labels.ts src/components/inventory/record-tabs.tsx src/components/inventory/request-status-change.tsx \
  "src/app/(app)/inventory/[id]" "src/app/(app)/inventory/activity" "src/app/(app)/employees/activity" \
  src/server/modules/inventory/queries.ts
git commit -m "feat(inventory): record chrome — tabs with AUDITED chip, overview, pending-approval banner

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: open BR-LT-0148 → header pill DEPLOYED, held-by link; BR-LT-0181 shows the APR-2041 pending banner; `/inventory/activity` still shows the Phase 4 placeholder.

---

### Task 14: `/inventory/[id]/edit` + `updateAsset` + `requestStatusChange`

**Files:**
- Create: `src/app/(app)/inventory/[id]/edit/page.tsx`
- Modify: `src/server/modules/inventory/actions.ts`, `src/components/inventory/request-status-change.tsx` (replace placeholder body)

- [ ] **Step 1: Add `updateAsset` and `requestStatusChange` to `src/server/modules/inventory/actions.ts`**

Add import: `import { diffOf } from "@/lib/audit-diff";` and:

```ts
const updateSchema = z.object({
  id: z.string().min(1),
  model: z.string().trim().min(2, "Name the model").max(120),
  serial: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  purchasedAt: dateStr.optional(),
  cost: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000)]).optional(),
  warrantyUntil: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  vendorId: z.string().optional(),
  rmaRef: z.string().trim().max(60).optional(),
  repairQuote: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000)]).optional(),
});

/**
 * Direct-write surface: identity/procurement/repair fields ONLY (scope
 * decision #3). tag is immutable; status/assignee move via approvals.
 */
export async function updateAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const asset = await prisma.asset.findUnique({ where: { id: d.id } });
  if (!asset) return conflict("That asset no longer exists.");
  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId } });
    if (!type || type.categoryId !== d.categoryId) {
      return validationError({ typeId: "That type doesn't belong to the chosen category" });
    }
  }
  if (d.vendorId && !(await prisma.vendor.findUnique({ where: { id: d.vendorId } }))) {
    return validationError({ vendorId: "Unknown vendor" });
  }

  const data = {
    model: d.model,
    serial: d.serial || null,
    categoryId: d.categoryId,
    typeId: d.typeId || null,
    purchasedAt: toDate(d.purchasedAt),
    cost: toCost(d.cost),
    warrantyUntil: toDate(d.warrantyUntil),
    notes: d.notes || null,
    vendorId: d.vendorId || null,
    rmaRef: d.rmaRef || null,
    repairQuote: toCost(d.repairQuote),
  };
  const diff = diffOf(asset as unknown as Record<string, unknown>, data);
  if (Object.keys(diff).length === 0) return ok({ id: asset.id }); // no audit noise for no-ops

  try {
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id: asset.id }, data });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "update", diff,
      });
    });
  } catch (err) {
    if (uniqueTarget(err).includes("serial")) return validationError({ serial: "That serial is already registered" });
    throw err;
  }
  revalidatePath(`/inventory/${asset.id}`);
  revalidatePath("/inventory");
  return ok({ id: asset.id });
}

const statusChangeSchema = z.object({
  assetId: z.string().min(1),
  to: z.enum(ASSET_STATUSES),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

/** Lifecycle change = approval, never a direct write. */
export async function requestStatusChange(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  const result = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
    if (!asset) return conflict("That asset no longer exists.");
    if (asset.status === d.to) return conflict(`Already ${d.to}.`);
    if (await openApprovalForAsset(tx, asset.id)) {
      return conflict("This asset already has an open request — resolve it first.");
    }
    const approval = await createApproval(tx, {
      type: "lifecycle_change_status",
      payload: { from: { status: asset.status }, to: { status: d.to }, reason: d.reason },
      requestedById: user.id,
      assetId: asset.id,
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: asset.id,
      action: "approval.requested",
      diff: { approval: { from: null, to: approval.refNo } },
    });
    refNo = approval.refNo;
    return null;
  });
  if (result) return result;
  revalidatePath(`/inventory/${d.assetId}`);
  return ok({ refNo });
}
```

- [ ] **Step 2: Replace the placeholder body of `src/components/inventory/request-status-change.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import { requestStatusChange } from "@/server/modules/inventory/actions";

export function RequestStatusChange({ assetId, currentStatus }: { assetId: string; currentStatus: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const options = ASSET_STATUSES.filter((s) => s !== currentStatus);
  const [to, setTo] = useState<string>(options[0]);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function submit() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await requestStatusChange({ assetId, to, reason });
      if (res.ok) {
        toast(`${res.data.refNo} created — waiting in the approval queue`, "settled");
        setOpen(false);
        setReason("");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Request status change</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Request a status change"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Request</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            Creates a <span className="font-mono">lifecycle.change-status</span> approval; the asset
            stays <span className="font-mono">{currentStatus}</span> until it executes.
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <FormField label="New status" required error={fieldErrors.to}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={to} onChange={(e) => setTo(e.target.value)}>
                {options.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Reason" required error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/inventory/[id]/edit/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { AssetForm } from "@/components/inventory/asset-form";
import { updateAsset } from "@/server/modules/inventory/actions";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "it_staff");
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) notFound();

  const [categories, types, vendors] = await Promise.all([
    prisma.assetCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);

  async function action(payload: Record<string, unknown>) {
    "use server";
    return updateAsset({ ...payload, id });
  }

  const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <>
      <PageHeader
        title={`Edit ${asset.tag}`}
        breadcrumb={[
          { label: "Inventory", href: "/inventory" },
          { label: asset.tag, href: `/inventory/${asset.id}` },
          { label: "Edit" },
        ]}
      />
      <AssetForm
        mode="edit"
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        types={types.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId }))}
        employees={[]}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        initial={{
          tag: asset.tag,
          model: asset.model,
          serial: asset.serial ?? "",
          categoryId: asset.categoryId,
          typeId: asset.typeId ?? "",
          purchasedAt: date(asset.purchasedAt),
          cost: asset.cost === null ? "" : String(asset.cost),
          warrantyUntil: date(asset.warrantyUntil),
          notes: asset.notes ?? "",
          vendorId: asset.vendorId ?? "",
          rmaRef: asset.rmaRef ?? "",
          repairQuote: asset.repairQuote === null ? "" : String(asset.repairQuote),
        }}
        action={action}
      />
    </>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/inventory/actions.ts src/components/inventory/request-status-change.tsx "src/app/(app)/inventory/[id]/edit"
git commit -m "feat(inventory): edit form (direct fields only) + status change via approval

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: edit BR-LT-0181's model → Save morphs to ✓ Saved + "audit entry written"; Request status change on the same asset → conflict banner (APR-2041 already open on it).

---

### Task 15: History (one row per field), Timeline, Reservations tabs (TDD for history rows)

**Files:**
- Create: `src/lib/history.ts` (+ `.test.ts`), `src/components/patterns/timeline-list.tsx`, `src/app/(app)/inventory/[id]/history/page.tsx`, `src/app/(app)/inventory/[id]/timeline/page.tsx`, `src/app/(app)/inventory/[id]/reservations/page.tsx`

- [ ] **Step 1: Write the failing tests** (`src/lib/history.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { historyRows } from "./history";

const at = new Date("2026-08-16T09:41:00Z");

describe("historyRows — one row per FIELD, not per save (README 7c)", () => {
  it("expands a multi-field diff into rows sharing the entry timestamp", () => {
    const rows = historyRows([{
      id: "e1", actorLabel: "J. Sarmiento", action: "update", createdAt: at,
      diff: { status: { from: "SPARE", to: "DEPLOYED" }, assignee: { from: null, to: "EMP-0042" } },
    }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ field: "status", from: "SPARE", to: "DEPLOYED", first: true });
    expect(rows[1]).toMatchObject({ field: "assignee", from: "—", to: "EMP-0042", first: false });
    expect(rows[0].at).toEqual(at);
  });
  it("renders diff-less entries (SECRET_READ) as a single action row", () => {
    const rows = historyRows([{ id: "e2", actorLabel: "System Admin", action: "SECRET_READ", createdAt: at, diff: null }]);
    expect(rows).toEqual([
      { key: "e2", at, actor: "System Admin", action: "SECRET_READ", field: "—", from: "—", to: "—", first: true },
    ]);
  });
  it("stringifies values and blanks nullish to —", () => {
    const rows = historyRows([{ id: "e3", actorLabel: "x", action: "update", createdAt: at, diff: { cost: { from: 55000, to: null } } }]);
    expect(rows[0]).toMatchObject({ from: "55000", to: "—" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/history.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/history.ts`**

```ts
export interface AuditEntryLike {
  id: string;
  actorLabel: string;
  action: string;
  createdAt: Date;
  diff: unknown;
}

export interface HistoryRow {
  key: string;
  at: Date;
  actor: string;
  action: string;
  field: string;
  from: string;
  to: string;
  /** first row of its entry — later rows render with dimmed timestamp/actor */
  first: boolean;
}

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

/** "One row per field, not per save. Two rows sharing a timestamp were one action." */
export function historyRows(entries: AuditEntryLike[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const entry of entries) {
    const diff = (entry.diff ?? null) as Record<string, { from: unknown; to: unknown }> | null;
    const fields = diff ? Object.keys(diff) : [];
    if (fields.length === 0) {
      rows.push({
        key: entry.id, at: entry.createdAt, actor: entry.actorLabel, action: entry.action,
        field: "—", from: "—", to: "—", first: true,
      });
      continue;
    }
    fields.forEach((field, i) => {
      rows.push({
        key: `${entry.id}:${field}`, at: entry.createdAt, actor: entry.actorLabel, action: entry.action,
        field, from: show(diff![field]?.from), to: show(diff![field]?.to), first: i === 0,
      });
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run tests — green**

Run: `npm run test -- src/lib/history.test.ts` — Expected: PASS.

- [ ] **Step 5: Create `src/app/(app)/inventory/[id]/history/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getAsset } from "@/server/modules/inventory/queries";
import { historyRows } from "@/lib/history";
import { fmtDate } from "@/lib/format";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export default async function AssetHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const entries = await prisma.auditEntry.findMany({
    where: { entityType: "asset", entityId: id },
    orderBy: { createdAt: "desc" },
  });
  const rows = historyRows(entries);

  if (rows.length === 0) {
    return <EmptyState title="No changes recorded" description="Every field change lands here, one row per field." />;
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th width={130}>When</Th>
          <Th width={140}>Actor</Th>
          <Th width={130}>Action</Th>
          <Th width={120}>Field</Th>
          <Th>Change</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td mono className={row.first ? "" : "opacity-40"}>{fmtDate(row.at)}</Td>
            <Td className={row.first ? "" : "opacity-40"}>{row.actor}</Td>
            <Td mono className={row.first ? "text-[10.5px]" : "text-[10.5px] opacity-40"}>{row.action}</Td>
            <Td mono>{row.field}</Td>
            <Td>
              <span className="font-mono text-xs">
                <span className="text-fg-faint line-through decoration-[1px]">{row.from}</span>
                <span aria-hidden className="px-1.5 text-fg-faint">→</span>
                <span className="text-accent">{row.to}</span>
              </span>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
```

- [ ] **Step 6: Create `src/components/patterns/timeline-list.tsx`** (server-safe — used by asset + employee timelines and later phases)

```tsx
import { StatusDot } from "@/components/ui/status";

export interface TimelineItem {
  id: string;
  /** preformatted display date */
  at: string;
  /** any status value for the dot; omit for a neutral dot */
  status?: string;
  title: React.ReactNode;
  meta?: string;
}

export function TimelineList({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="ml-2 flex flex-col border-l border-border-faint pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative pb-5">
          <span className="absolute -left-[24.5px] top-[5px] rounded-full bg-canvas p-[1px]">
            <StatusDot value={item.status ?? "SPARE"} />
          </span>
          <div className="text-[12.5px] text-fg-secondary">{item.title}</div>
          <div className="pt-0.5 font-mono text-[10.5px] text-fg-faint">
            {item.meta ? `${item.meta} · ` : ""}{item.at}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 7: Create `src/app/(app)/inventory/[id]/timeline/page.tsx`** (audit entries + approvals, merged chronologically)

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getAsset } from "@/server/modules/inventory/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { TimelineList, type TimelineItem } from "@/components/patterns/timeline-list";

export default async function AssetTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();

  const [entries, approvals] = await Promise.all([
    prisma.auditEntry.findMany({ where: { entityType: "asset", entityId: id } }),
    prisma.approval.findMany({ where: { assetId: id } }),
  ]);

  const merged = [
    ...entries.map((e) => ({
      when: e.createdAt,
      item: {
        id: `audit-${e.id}`,
        at: fmtDate(e.createdAt),
        title: (
          <>
            <span className="font-medium text-fg">{e.actorLabel}</span> — <span className="font-mono text-xs">{e.action}</span>
            {e.diff ? ` · ${Object.keys(e.diff as object).length} field${Object.keys(e.diff as object).length === 1 ? "" : "s"}` : ""}
          </>
        ),
      } satisfies TimelineItem,
    })),
    ...approvals.map((a) => ({
      when: a.createdAt,
      item: {
        id: `approval-${a.id}`,
        at: fmtDate(a.createdAt),
        status: a.state,
        title: (
          <>
            <span className="font-mono text-xs text-accent">{a.refNo}</span> · {APPROVAL_TYPE_LABEL[a.type]} —{" "}
            <span className="font-mono text-xs">{a.state}</span>
          </>
        ),
      } satisfies TimelineItem,
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .map((x) => x.item);

  if (merged.length === 0) return <EmptyState title="Nothing has happened yet" />;
  return <div className="max-w-[640px] pt-2"><TimelineList items={merged} /></div>;
}
```

- [ ] **Step 8: Create `src/app/(app)/inventory/[id]/reservations/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getAsset } from "@/server/modules/inventory/queries";
import { fmtDate } from "@/lib/format";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";

export default async function AssetReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const reservations = await prisma.reservation.findMany({
    where: { assetId: id },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });

  if (reservations.length === 0) {
    return (
      <EmptyState
        title="No holds on this asset"
        description="Reserved stock still reads SPARE in inventory — holds only appear here and on the reservations list."
      />
    );
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th width={19} aria-label="State colour" />
          <Th width={104}>State</Th>
          <Th>For</Th>
          <Th>Reason</Th>
          <Th width={110}>Expires</Th>
          <Th width={110}>Resolved</Th>
        </Tr>
      </THead>
      <TBody>
        {reservations.map((r) => (
          <Tr key={r.id}>
            <Td className="pr-0"><StatusDot value={r.state} /></Td>
            <Td mono className="text-[10.5px]">{r.state}</Td>
            <Td>
              <a href={`/employees/${r.employee.id}`} className="text-accent hover:underline">
                {r.employee.name} · {r.employee.employeeNo}
              </a>
            </Td>
            <Td>{r.reason ?? "—"}</Td>
            <Td mono>{fmtDate(r.expiresAt)}</Td>
            <Td mono>{fmtDate(r.resolvedAt)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
```

- [ ] **Step 9: Verify and commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/history.ts src/lib/history.test.ts src/components/patterns/timeline-list.tsx "src/app/(app)/inventory/[id]/history" "src/app/(app)/inventory/[id]/timeline" "src/app/(app)/inventory/[id]/reservations"
git commit -m "feat(inventory): history one-row-per-field, merged timeline, per-asset reservations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: BR-LT-0148 history shows the seeded update as TWO rows (status, assignee) sharing one dimmed-timestamp group + the SECRET_READ row; BR-MN-0910 reservations shows the ACTIVE hold.

### Task 16: Documents tab — upload, mark signed, authed download

**Files:**
- Create: `src/server/modules/inventory/document-actions.ts`, `src/components/inventory/documents-panel.tsx`, `src/app/(app)/inventory/[id]/documents/page.tsx`, `src/app/(app)/inventory/[id]/documents/[docId]/download/route.ts`

- [ ] **Step 1: Create `src/server/modules/inventory/document-actions.ts`**

```ts
"use server";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, type ActionResult,
} from "@/server/action-result";

const ALLOWED: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = ["receipt", "accountability-form", "photo", "other"] as const;

/**
 * Files land on the local uploads/ volume (single-machine deploy, no object
 * storage); the row stores a RELATIVE posix path + sha256 checksum. The
 * filename is sanitized to a safe charset — the original name survives only
 * as display text.
 */
export async function uploadDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const assetId = String(formData.get("assetId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const file = formData.get("file");
  if (!assetId) return conflict("Missing asset.");
  if (!(KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  if (!(file instanceof File) || file.size === 0) return validationError({ file: "Pick a file first" });
  if (file.size > MAX_BYTES) return validationError({ file: "Too big — the cap is 10 MB" });

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED[ext] || (file.type && file.type !== ALLOWED[ext])) {
    return validationError({ file: `That type isn't allowed. Accepted: PDF, PNG, JPG.` });
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return conflict("That asset no longer exists.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const safeName = path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const relPath = path.posix.join("assets", assetId, `${Date.now()}-${safeName}`);
  await mkdir(path.join(process.cwd(), "uploads", "assets", assetId), { recursive: true });
  await writeFile(path.join(process.cwd(), "uploads", relPath), bytes);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.assetDocument.create({
      data: {
        assetId, kind,
        fileName: path.basename(file.name),
        path: relPath, checksum,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: assetId,
      action: "document.uploaded",
      diff: { document: { from: null, to: created.fileName } },
    });
    return created;
  });
  revalidatePath(`/inventory/${assetId}/documents`);
  return ok({ id: doc.id });
}

/** Accountability forms scan back in and get flagged SIGNED. */
export async function markDocumentSigned(input: { docId: string }): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const doc = await prisma.assetDocument.findUnique({ where: { id: String(input.docId ?? "") } });
  if (!doc) return conflict("That document no longer exists.");
  if (doc.signed) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.assetDocument.update({ where: { id: doc.id }, data: { signed: true } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: doc.assetId,
      action: "document.signed",
      diff: { [doc.fileName]: { from: "unsigned", to: "SIGNED" } },
    });
  });
  revalidatePath(`/inventory/${doc.assetId}/documents`);
  return ok(null);
}
```

- [ ] **Step 2: Create the download route** `src/app/(app)/inventory/[id]/documents/[docId]/download/route.ts` (nested under the record path so middleware's `/inventory` rules gate it)

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  await requireUser();
  const { id, docId } = await ctx.params;
  const doc = await prisma.assetDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.assetId !== id) return new Response("Not found", { status: 404 });

  const root = path.resolve(process.cwd(), "uploads");
  const abs = path.resolve(root, doc.path);
  if (!abs.startsWith(root + path.sep)) return new Response("Not found", { status: 404 }); // traversal guard

  const bytes = await readFile(abs).catch(() => null);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": TYPES[path.extname(doc.fileName).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${doc.fileName.replaceAll('"', "")}"`,
    },
  });
}
```

- [ ] **Step 3: Create `src/components/inventory/documents-panel.tsx`**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { markDocumentSigned, uploadDocument } from "@/server/modules/inventory/document-actions";

export interface DocumentRow {
  id: string;
  kind: string;
  fileName: string;
  signed: boolean;
  uploadedBy: string;
  at: string;
  downloadHref: string;
}

const KIND_OPTIONS = [
  { value: "receipt", label: "Receipt" },
  { value: "accountability-form", label: "Accountability form" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];

export function DocumentsPanel({
  assetId,
  docs,
  canMutate,
}: {
  assetId: string;
  docs: DocumentRow[];
  canMutate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState("receipt");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);
    setRetryAfter(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.set("assetId", assetId);
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadDocument(fd);
      setFileName(null);
      if (res.ok) {
        toast("Document uploaded — audit entry written", "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.file ?? res.fieldErrors?.kind ?? res.message);
    });
  }

  function sign(docId: string) {
    startTransition(async () => {
      const res = await markDocumentSigned({ docId });
      if (res.ok) {
        toast("Marked signed", "settled");
        router.refresh();
      } else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title="Upload rejected">{error}</Banner>}

      {docs.length === 0 ? (
        <p className="py-4 text-center text-xs text-fg-muted">
          Nothing attached yet — receipts, photos and signed accountability forms live here.
        </p>
      ) : (
        <ul className="flex flex-col rounded-(--radius-card) border border-border bg-surface shadow-card">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 border-b border-border-faint px-3 py-2.5 last:border-b-0">
              <Pill>{doc.kind}</Pill>
              <a href={doc.downloadHref} className="min-w-0 flex-1 truncate text-[12.5px] text-accent hover:underline">
                {doc.fileName}
              </a>
              {doc.signed ? (
                <Pill tone="accent">SIGNED</Pill>
              ) : (
                canMutate && doc.kind === "accountability-form" && (
                  <Button size="sm" variant="ghost" onClick={() => sign(doc.id)}>Mark signed</Button>
                )
              )}
              <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">
                {doc.uploadedBy} · {doc.at}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canMutate && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) upload(file);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-(--radius-card) border border-dashed p-6 text-center",
            dragging ? "border-accent bg-accent-tint" : "border-border-strong",
          )}
        >
          {pending && fileName ? (
            <span className="inline-flex items-center gap-2 text-xs text-fg-secondary">
              <Spinner size={12} /> uploading {fileName}…
            </span>
          ) : (
            <>
              <p className="text-xs text-fg-secondary">Drop a file here, or</p>
              <div className="flex items-center gap-2">
                <Select aria-label="Document kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto py-1.5 text-xs">
                  {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <Button size="sm" onClick={() => inputRef.current?.click()}>Choose file</Button>
              </div>
              <p className="font-mono text-[10px] text-fg-faint">PDF · PNG · JPG — max 10 MB</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="sr-only"
            aria-label="Upload document"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/inventory/[id]/documents/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getAsset } from "@/server/modules/inventory/queries";
import { fmtDate } from "@/lib/format";
import { DocumentsPanel, type DocumentRow } from "@/components/inventory/documents-panel";

export default async function AssetDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const docs = await prisma.assetDocument.findMany({
    where: { assetId: id },
    include: { uploadedBy: true },
    orderBy: { createdAt: "desc" },
  });

  const rows: DocumentRow[] = docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    fileName: d.fileName,
    signed: d.signed,
    uploadedBy: d.uploadedBy?.name ?? "system",
    at: fmtDate(d.createdAt),
    downloadHref: `/inventory/${id}/documents/${d.id}/download`,
  }));

  return (
    <DocumentsPanel
      assetId={id}
      docs={rows}
      canMutate={user.role === "admin" || user.role === "it_staff"}
    />
  );
}
```

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/inventory/document-actions.ts src/components/inventory/documents-panel.tsx "src/app/(app)/inventory/[id]/documents"
git commit -m "feat(inventory): documents — allowlisted upload with checksum, SIGNED flag, authed download

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: upload a PNG → row appears + toast; a `.txt` → rejection banner listing the allowlist; download link streams the file back.

---

### Task 17: Secrets tab — audited reveal with 30 s auto-hide (entry criterion #4)

**Files:**
- Create: `src/server/modules/inventory/secret-actions.ts`, `src/components/inventory/secrets-panel.tsx`, `src/app/(app)/inventory/[id]/secrets/page.tsx`

- [ ] **Step 1: Create `src/server/modules/inventory/secret-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const addSchema = z.object({
  assetId: z.string().min(1),
  label: z.string().trim().min(1, "Name the credential").max(60),
  value: z.string().min(1, "Nothing to store").max(500),
});

/** Plaintext exists only in transit; the row stores AES-256-GCM ciphertext. The audit diff carries the LABEL only. */
export async function addSecret(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const asset = await prisma.asset.findUnique({ where: { id: d.assetId } });
  if (!asset) return conflict("That asset no longer exists.");
  const existing = await prisma.assetSecret.findUnique({
    where: { assetId_label: { assetId: d.assetId, label: d.label } },
  });
  if (existing) return validationError({ label: "That label already exists on this asset" });

  const secret = await prisma.$transaction(async (tx) => {
    const created = await tx.assetSecret.create({
      data: { assetId: d.assetId, label: d.label, ciphertext: encryptSecret(d.value) },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: d.assetId,
      action: "secret.created",
      diff: { label: { from: null, to: d.label } },
    });
    return created;
  });
  revalidatePath(`/inventory/${d.assetId}/secrets`);
  return ok({ id: secret.id });
}

const revealSchema = z.object({
  assetId: z.string().min(1),
  secretId: z.string().min(1),
});

/**
 * Entry criterion #4: reveal is a deliberate, logged action. Its own role
 * guard (path gating alone would let a viewer in — viewer is IT-workspace),
 * rate-limited, and every call writes SECRET_READ before the plaintext
 * leaves the server. No revalidate — the 30 s auto-hide is client state.
 */
export async function revealSecret(
  input: unknown,
): Promise<ActionResult<{ value: string; label: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = revealSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const secret = await prisma.assetSecret.findUnique({ where: { id: d.secretId } });
  if (!secret || secret.assetId !== d.assetId) return conflict("That secret no longer exists.");

  await writeAudit(prisma, {
    actorId: user.id, actorLabel: user.name,
    entityType: "asset", entityId: secret.assetId,
    action: "SECRET_READ",
    diff: { label: { from: null, to: secret.label } },
  });

  return ok({ value: decryptSecret(secret.ciphertext), label: secret.label });
}
```

- [ ] **Step 2: Create `src/components/inventory/secrets-panel.tsx`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { addSecret, revealSecret } from "@/server/modules/inventory/secret-actions";

export interface SecretRowDto {
  id: string;
  label: string;
  createdAt: string;
}

const HIDE_AFTER_S = 30;

interface Revealed {
  value: string;
  revealedAtLabel: string;
  expiresAt: number;
}

export function SecretsPanel({
  assetId,
  secrets,
  canReveal,
}: {
  assetId: string;
  secrets: SecretRowDto[];
  canReveal: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  const [now, setNow] = useState(() => Date.now());
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // One ticking clock drives every countdown; entries drop at 0 (30 s auto-hide).
  useEffect(() => {
    if (Object.keys(revealed).length === 0) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setRevealed((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, r]) => r.expiresAt > t));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [revealed]);

  function reveal(secretId: string) {
    setError(null);
    startTransition(async () => {
      const res = await revealSecret({ assetId, secretId });
      if (res.ok) {
        setRevealed((prev) => ({
          ...prev,
          [secretId]: {
            value: res.data.value,
            revealedAtLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
            expiresAt: Date.now() + HIDE_AFTER_S * 1000,
          },
        }));
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setError(null);
    startTransition(async () => {
      const res = await addSecret({ assetId, label, value });
      if (res.ok) {
        toast("Secret stored encrypted — audit entry written", "settled");
        setLabel("");
        setValue("");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <Banner tone="attention" title="Reads are audited">
        Revealing a value writes a <span className="font-mono">SECRET_READ</span> entry with your name
        on it, and the value hides itself after {HIDE_AFTER_S} s.
      </Banner>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      {secrets.length === 0 ? (
        <p className="py-4 text-center text-xs text-fg-muted">No credentials stored for this asset.</p>
      ) : (
        <ul className="flex flex-col rounded-(--radius-card) border border-border bg-surface shadow-card">
          {secrets.map((secret) => {
            const r = revealed[secret.id];
            const left = r ? Math.max(0, Math.ceil((r.expiresAt - now) / 1000)) : 0;
            return (
              <li key={secret.id} className="flex items-center gap-3 border-b border-border-faint px-3 py-2.5 last:border-b-0">
                <span className="w-[140px] shrink-0 font-mono text-xs text-fg">{secret.label}</span>
                {r ? (
                  <span className="min-w-0 flex-1 font-mono text-xs text-fg-secondary">
                    {r.value}
                    <span className="ml-2 text-[10px] text-fg-faint">
                      revealed {r.revealedAtLabel} · hides in {left}s
                    </span>
                  </span>
                ) : (
                  <span aria-label="hidden" className="flex-1 font-mono text-xs tracking-widest text-fg-faint">
                    ••••••••••••
                  </span>
                )}
                {canReveal && !r && (
                  <Button size="sm" loading={pending} onClick={() => reveal(secret.id)}>Reveal</Button>
                )}
                <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">{secret.createdAt}</span>
              </li>
            );
          })}
        </ul>
      )}

      {canReveal && (
        <form onSubmit={add} className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
          <p className="text-[13px] font-semibold text-fg">Add a credential</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Label" required error={fieldErrors.label} hint="e.g. BIOS password, local admin">
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={label} onChange={(e) => setLabel(e.target.value)} />
              )}
            </FormField>
            <FormField label="Value" required error={fieldErrors.value} hint="Stored AES-256-GCM encrypted.">
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  type="password" autoComplete="off"
                  value={value} onChange={(e) => setValue(e.target.value)} />
              )}
            </FormField>
          </div>
          <div>
            <Button type="submit" variant="primary" loading={pending}>Store encrypted</Button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/inventory/[id]/secrets/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getAsset } from "@/server/modules/inventory/queries";
import { fmtDate } from "@/lib/format";
import { SecretsPanel } from "@/components/inventory/secrets-panel";

export default async function AssetSecretsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  // Ciphertext NEVER leaves the server — the panel gets labels only.
  const secrets = await prisma.assetSecret.findMany({
    where: { assetId: id },
    orderBy: { label: "asc" },
    select: { id: true, label: true, createdAt: true },
  });

  return (
    <SecretsPanel
      assetId={id}
      secrets={secrets.map((s) => ({ id: s.id, label: s.label, createdAt: fmtDate(s.createdAt) }))}
      canReveal={user.role === "admin" || user.role === "it_staff"}
    />
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/inventory/secret-actions.ts src/components/inventory/secrets-panel.tsx "src/app/(app)/inventory/[id]/secrets"
git commit -m "feat(inventory): audited secrets — encrypted at rest, SECRET_READ on reveal, 30s auto-hide

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: add a secret to BR-LT-0148, reveal it → countdown ticks, row hides at 0; History tab now shows the SECRET_READ entry with the label; sign in as viewer@ → no Reveal button, no add form.

---

### Task 18: Loadout computation module (TDD)

**Files:**
- Create: `src/lib/loadout.ts` (+ `.test.ts`)

- [ ] **Step 1: Write the failing tests** (`src/lib/loadout.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { computeLoadout, resolvePolicy } from "./loadout";

const policies = [
  { id: "p-dept", name: "Finance standard", appliesToTitle: null, appliesToDepartmentId: "dept-fin", slots: [] },
  { id: "p-title", name: "Team lead kit", appliesToTitle: "Team Lead", appliesToDepartmentId: null, slots: [] },
];

describe("resolvePolicy — role (title) policy beats department policy", () => {
  it("matches title first, case-insensitively", () => {
    expect(resolvePolicy({ title: "team lead", departmentId: "dept-fin" }, policies)?.id).toBe("p-title");
  });
  it("falls back to department", () => {
    expect(resolvePolicy({ title: "Accountant", departmentId: "dept-fin" }, policies)?.id).toBe("p-dept");
  });
  it("null when nothing applies", () => {
    expect(resolvePolicy({ title: "Contractor", departmentId: "dept-ops" }, policies)).toBeNull();
  });
});

const slots = [
  { id: "s1", name: "laptop", assetTypeId: "t-laptop", required: true },
  { id: "s2", name: "monitor", assetTypeId: "t-monitor", required: true },
  { id: "s3", name: "second monitor", assetTypeId: "t-monitor", required: false },
  { id: "s4", name: "headset", assetTypeId: "t-headset", required: true },
];

const asset = (id: string, typeId: string | null) => ({ id, tag: id, model: "m", typeId, status: "DEPLOYED" });

describe("computeLoadout", () => {
  it("fills slots by asset type, one asset per slot, leftovers unslotted", () => {
    const held = [asset("a1", "t-laptop"), asset("a2", "t-monitor"), asset("a3", "t-monitor"), asset("a4", "t-monitor")];
    const l = computeLoadout(slots, held);
    expect(l.slots.map((s) => s.asset?.id ?? null)).toEqual(["a1", "a2", "a3", null]);
    expect(l.unslotted.map((a) => a.id)).toEqual(["a4"]);
    expect(l.filled).toBe(3);
    expect(l.totalSlots).toBe(4);
    expect(l.missingRequired).toBe(1); // headset
  });
  it("day one: everything empty, all required missing", () => {
    const l = computeLoadout(slots, []);
    expect(l.filled).toBe(0);
    expect(l.missingRequired).toBe(3);
  });
  it("assets with no type never fill slots", () => {
    const l = computeLoadout(slots, [asset("a1", null)]);
    expect(l.filled).toBe(0);
    expect(l.unslotted).toHaveLength(1);
  });
  it("no policy → empty grid, nothing missing", () => {
    const l = computeLoadout([], [asset("a1", "t-laptop")]);
    expect(l.totalSlots).toBe(0);
    expect(l.missingRequired).toBe(0);
    expect(l.unslotted).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/loadout.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/loadout.ts`**

```ts
/**
 * The loadout view's brain: equipment policies define expected slots per
 * role/department, so "what do they have" and "what's missing" are the same
 * glance. Role (title) policy beats department policy; policy edits never
 * touch existing assignments.
 */
export interface PolicyLike {
  id: string;
  name: string;
  appliesToTitle: string | null;
  appliesToDepartmentId: string | null;
}

export interface SlotLike {
  id: string;
  name: string;
  assetTypeId: string | null;
  required: boolean;
}

export interface HeldAssetLike {
  id: string;
  tag: string;
  model: string;
  typeId: string | null;
  status: string;
}

export function resolvePolicy<P extends PolicyLike>(
  employee: { title: string; departmentId: string },
  policies: P[],
): P | null {
  const title = employee.title.trim().toLowerCase();
  return (
    policies.find((p) => p.appliesToTitle?.trim().toLowerCase() === title) ??
    policies.find((p) => p.appliesToDepartmentId === employee.departmentId) ??
    null
  );
}

export interface Loadout<A extends HeldAssetLike> {
  slots: Array<{ slot: SlotLike; asset: A | null }>;
  /** held assets no slot claimed — shown in the holding area / table view */
  unslotted: A[];
  filled: number;
  totalSlots: number;
  missingRequired: number;
}

/** Greedy fill in slot order: each slot takes the first remaining held asset of its type. */
export function computeLoadout<A extends HeldAssetLike>(slots: SlotLike[], held: A[]): Loadout<A> {
  const remaining = [...held];
  const filledSlots = slots.map((slot) => {
    const i = slot.assetTypeId ? remaining.findIndex((a) => a.typeId === slot.assetTypeId) : -1;
    return { slot, asset: i >= 0 ? remaining.splice(i, 1)[0] : null };
  });
  return {
    slots: filledSlots,
    unslotted: remaining,
    filled: filledSlots.filter((s) => s.asset).length,
    totalSlots: slots.length,
    missingRequired: filledSlots.filter((s) => !s.asset && s.slot.required).length,
  };
}
```

- [ ] **Step 4: Run tests — green, commit**

```bash
npm run test -- src/lib/loadout.test.ts && npx tsc --noEmit && npm run lint
git add src/lib/loadout.ts src/lib/loadout.test.ts
git commit -m "feat(lib): loadout computation — title policy beats department, greedy slot fill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 19: `/employees` — list with Items + Loadout columns (TDD for the where builder)

**Files:**
- Create: `src/lib/employees-list.ts` (+ `.test.ts`), `src/server/modules/employees/queries.ts`, `src/components/employees/employees-toolbar.tsx`, `src/app/(app)/employees/page.tsx`, `src/app/(app)/employees/loading.tsx`

- [ ] **Step 1: Write the failing tests** (`src/lib/employees-list.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { buildEmployeeWhere, EMPLOYEES_LIST_CONFIG } from "./employees-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), EMPLOYEES_LIST_CONFIG);

describe("buildEmployeeWhere", () => {
  it("q searches name, employeeNo and title", () => {
    expect(buildEmployeeWhere(parse("q=mar"))).toEqual({
      OR: [
        { name: { contains: "mar", mode: "insensitive" } },
        { employeeNo: { contains: "mar", mode: "insensitive" } },
        { title: { contains: "mar", mode: "insensitive" } },
      ],
    });
  });
  it("maps facets and drops invalid employment values", () => {
    const where = buildEmployeeWhere(parse("department=d1&employment=ACTIVE,BOGUS"));
    expect(where.departmentId).toEqual({ in: ["d1"] });
    expect(where.employment).toEqual({ in: ["ACTIVE"] });
  });
  it("empty state → empty where", () => {
    expect(buildEmployeeWhere(parse(""))).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/employees-list.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/employees-list.ts`**

```ts
import type { EmploymentStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState } from "./url-state";

export const EMPLOYMENT_STATUSES = ["ACTIVE", "OFFBOARDING", "OFFBOARDED"] as const satisfies readonly EmploymentStatus[];

export const EMPLOYEES_LIST_CONFIG: ListConfig = {
  facets: ["department", "employment"],
  sortable: ["name", "employeeNo", "joinedAt"],
  defaultSort: [{ key: "name", dir: "asc" }],
};

export function buildEmployeeWhere(state: ListState): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  if (state.q) {
    where.OR = [
      { name: { contains: state.q, mode: "insensitive" } },
      { employeeNo: { contains: state.q, mode: "insensitive" } },
      { title: { contains: state.q, mode: "insensitive" } },
    ];
  }
  if (state.filters.department?.length) where.departmentId = { in: state.filters.department };
  const employment = (state.filters.employment ?? []).filter((v): v is EmploymentStatus =>
    (EMPLOYMENT_STATUSES as readonly string[]).includes(v));
  if (employment.length) where.employment = { in: employment };
  return where;
}
```

- [ ] **Step 4: Run tests — green**

Run: `npm run test -- src/lib/employees-list.test.ts` — Expected: PASS.

- [ ] **Step 5: Create `src/server/modules/employees/queries.ts`**

```ts
import { prisma } from "@/server/db/client";
import { buildEmployeeWhere } from "@/lib/employees-list";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { fmtDate } from "@/lib/format";
import type { ListState } from "@/lib/url-state";

export const PAGE_SIZE = 25;

export interface EmployeeListRow {
  id: string;
  name: string;
  title: string;
  employeeNo: string;
  department: string;
  employment: string;
  m365: string | null;
  items: number;
  /** null = no policy applies */
  missingRequired: number | null;
  joined: string;
}

/**
 * The two columns a normal HR list wouldn't have — Items and Loadout — are
 * why IT opens this page. Loadout needs policy resolution per employee, so
 * we fetch the (team-scale) matching set, compute in memory, and paginate
 * after the optional policy-gaps filter.
 */
export async function listEmployees(state: ListState, gapsOnly: boolean): Promise<{
  rows: EmployeeListRow[];
  total: number;
  pageCount: number;
}> {
  const orderKey = state.sort[0]?.key ?? "name";
  const orderDir = state.sort[0]?.dir ?? "asc";
  const [employees, policies] = await Promise.all([
    prisma.employee.findMany({
      where: buildEmployeeWhere(state),
      include: {
        department: true,
        assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
      },
      orderBy: { [orderKey]: orderDir },
    }),
    prisma.equipmentPolicy.findMany({ include: { slots: true } }),
  ]);

  const all = employees.map((e): EmployeeListRow => {
    const policy = resolvePolicy(e, policies);
    const loadout = policy ? computeLoadout(policy.slots, e.assets) : null;
    return {
      id: e.id,
      name: e.name,
      title: e.title,
      employeeNo: e.employeeNo,
      department: e.department.name,
      employment: e.employment,
      m365: e.m365Status,
      items: e.assets.length,
      missingRequired: loadout ? loadout.missingRequired : null,
      joined: fmtDate(e.joinedAt),
    };
  });

  const filtered = gapsOnly ? all.filter((r) => (r.missingRequired ?? 0) > 0) : all;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { rows: filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE), total, pageCount };
}

export interface EmployeeFacets {
  department: Array<{ value: string; label: string; count: number }>;
  employment: Array<{ value: string; label: string; count: number }>;
}

export async function employeeFacetOptions(state: ListState): Promise<EmployeeFacets> {
  const without = (facet: string): ListState => ({ ...state, filters: { ...state.filters, [facet]: [] } });
  const [deptGroups, empGroups, departments] = await Promise.all([
    prisma.employee.groupBy({ by: ["departmentId"], where: buildEmployeeWhere(without("department")), _count: true }),
    prisma.employee.groupBy({ by: ["employment"], where: buildEmployeeWhere(without("employment")), _count: true }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    department: departments.map((d) => ({
      value: d.id, label: d.name, count: deptGroups.find((g) => g.departmentId === d.id)?._count ?? 0,
    })),
    employment: (["ACTIVE", "OFFBOARDING", "OFFBOARDED"] as const).map((s) => ({
      value: s, label: s, count: empGroups.find((g) => g.employment === s)?._count ?? 0,
    })),
  };
}
```

- [ ] **Step 6: Create `src/components/employees/employees-toolbar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { EmployeeFacets } from "@/server/modules/employees/queries";

export function EmployeesToolbar({
  state,
  total,
  facets,
  gapsOnly,
}: {
  state: ListState;
  total: number;
  facets: EmployeeFacets;
  gapsOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const href = (s: ListState, gaps: boolean) => {
    const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
    if (!gaps) return pathname + qs;
    return pathname + (qs ? `${qs}&gaps=1` : "?gaps=1");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          type="search"
          aria-label="Search employees"
          placeholder="Search name, EMP number, title…"
          defaultValue={state.q}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push(href(withSearch(state, e.currentTarget.value), gapsOnly));
          }}
        />
      </div>
      <FacetDropdown
        label="Department"
        options={facets.department}
        selected={state.filters.department ?? []}
        onApply={(values) => router.push(href(withFilter(state, "department", values), gapsOnly))}
      />
      <FacetDropdown
        label="Employment"
        options={facets.employment}
        selected={state.filters.employment ?? []}
        onApply={(values) => router.push(href(withFilter(state, "employment", values), gapsOnly))}
      />
      <Link
        href={href({ ...state, page: 1 }, !gapsOnly)}
        aria-pressed={gapsOnly}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-(--radius-btn) border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-(--dur-1)",
          gapsOnly
            ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
            : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
        )}
      >
        Policy gaps only
      </Link>
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "person" : "people"}
      </span>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/app/(app)/employees/page.tsx`** (rows are Links via a plain server-rendered table — no selection/bulk here, so no client island is needed beyond the toolbar)

```tsx
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { clearFilters, parseListState, serializeListState, toSearchParams } from "@/lib/url-state";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { employeeFacetOptions, listEmployees } from "@/server/modules/employees/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmployeesToolbar } from "@/components/employees/employees-toolbar";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, EMPLOYEES_LIST_CONFIG);
  const gapsOnly = sp.get("gaps") === "1";

  const [{ rows, total, pageCount }, facets] = await Promise.all([
    listEmployees(state, gapsOnly),
    employeeFacetOptions(state),
  ]);

  const href = (s: typeof state, gaps = gapsOnly) => {
    const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
    return "/employees" + (gaps ? (qs ? `${qs}&gaps=1` : "?gaps=1") : qs);
  };
  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0 || gapsOnly;

  return (
    <>
      <PageHeader
        title="Employees"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      <div className="flex flex-col gap-2">
        <EmployeesToolbar state={state} total={total} facets={facets} gapsOnly={gapsOnly} />
        {rows.length > 0 ? (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Employee</Th>
                  <Th width={110}>Department</Th>
                  <Th width={110}>Employment</Th>
                  <Th width={120}>M365</Th>
                  <Th width={60} align="right">Items</Th>
                  <Th width={100}>Loadout</Th>
                  <Th width={110}>Joined</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/employees/${row.id}`} className="flex items-center gap-2.5 hover:underline">
                        <Avatar name={row.name} size="sm" />
                        <span className="flex flex-col leading-tight">
                          <span className="text-[12.5px] font-medium text-fg">{row.name}</span>
                          <span className="font-mono text-[10px] text-fg-faint">
                            {row.employeeNo} · {row.title}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td>{row.department}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot value={row.employment} ns="employment" />
                        <span className="font-mono text-[10.5px]">{row.employment}</span>
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot value={row.m365 ?? ""} />
                        <span className="font-mono text-[10.5px] text-fg-muted">{row.m365 ?? "no sync yet"}</span>
                      </span>
                    </Td>
                    <Td mono align="right">{row.items}</Td>
                    <Td>
                      {row.missingRequired === null ? (
                        <span className="text-fg-faint">—</span>
                      ) : row.missingRequired === 0 ? (
                        <span className="font-mono text-[10.5px]" style={{ color: "var(--st-settled-dot)" }}>complete</span>
                      ) : (
                        <span className="font-mono text-[10.5px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                          {row.missingRequired} missing
                        </span>
                      )}
                    </Td>
                    <Td mono>{row.joined}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {state.page} of {pageCount}</span>
              <Pagination page={state.page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
            </div>
          </>
        ) : hasFilters ? (
          <EmptyState
            title="Your filters matched nothing"
            actions={<ButtonLink href={href(clearFilters(state), false)}>Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="No employees yet"
            description="Employees arrive via import (Phase 8) or the seed — there is no create form by design."
          />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 8: Create `src/app/(app)/employees/loading.tsx`**

```tsx
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function EmployeesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-[260px]" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonRow key={i} columns={7} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Verify and commit**

```bash
npm run test && npx tsc --noEmit && npm run lint
git add src/lib/employees-list.ts src/lib/employees-list.test.ts src/server/modules/employees/queries.ts \
  src/components/employees/employees-toolbar.tsx "src/app/(app)/employees/page.tsx" "src/app/(app)/employees/loading.tsx"
git commit -m "feat(employees): list with Items + Loadout columns and policy-gaps filter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: Marites (Finance policy, holds 4) shows "1 missing" (headset); "Policy gaps only" keeps her visible and drops complete/no-policy rows; employment pills — Dennis Ong OFFBOARDING renders inflight (blue), Faith Mercado OFFBOARDED renders hollow.

---

### Task 20: `/employees/[id]` — the loadout view + assign/return request actions

The distinctive screen (README `1i`/`7a`/`7d`): left character panel, centre 4-column slot grid with keyboard nav, holding area, right fill-slot panel. **Every `+` and `−` opens a request, not a write.** Recorded decision: the tile's ⇄ swap affordance ships with the replace flow (Phase 7) — this phase offers fill (`+`) on empty slots and return (`−`) on filled ones.

**Files:**
- Create: `src/server/modules/employees/actions.ts`, `src/components/employees/loadout-view.tsx`, `src/app/(app)/employees/[id]/page.tsx`, `src/app/(app)/employees/[id]/not-found.tsx`

- [ ] **Step 1: Create `src/server/modules/employees/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const assignSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

/** `+` on a slot: lifecycle.assign approval. The asset stays SPARE until execution. */
export async function requestAssign(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  const failure = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment !== "ACTIVE") {
      return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — slots are frozen.`);
    }
    const asset = await tx.asset.findUnique({
      where: { id: d.assetId },
      include: { reservations: { where: { state: "ACTIVE" }, include: { employee: true } } },
    });
    if (!asset) return conflict("That asset no longer exists.");
    if (asset.status !== "SPARE") return conflict(`${asset.tag} is ${asset.status}, not SPARE — only spares can be assigned.`);
    const hold = asset.reservations[0];
    if (hold && hold.employeeId !== d.employeeId) {
      return conflict(`${asset.tag} is reserved for ${hold.employee.name} — release the hold first.`);
    }
    if (await openApprovalForAsset(tx, asset.id)) {
      return conflict(`${asset.tag} already has an open request.`);
    }
    const approval = await createApproval(tx, {
      type: "lifecycle_assign",
      payload: {
        to: { assigneeId: d.employeeId, status: "DEPLOYED" },
        reason: d.reason || (hold ? "reserved — fulfilling the hold" : "slot fill"),
      },
      requestedById: user.id,
      assetId: asset.id,
      employeeId: d.employeeId,
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: asset.id,
      action: "approval.requested",
      diff: { approval: { from: null, to: approval.refNo } },
    });
    refNo = approval.refNo;
    return null;
  });
  if (failure) return failure;
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/inventory");
  return ok({ refNo });
}

const returnSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

/** `−` on a filled tile: lifecycle.return approval. */
export async function requestReturn(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  const failure = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
    if (!asset) return conflict("That asset no longer exists.");
    if (asset.assigneeId !== d.employeeId) return conflict(`${asset.tag} isn't held by this person.`);
    if (await openApprovalForAsset(tx, asset.id)) return conflict(`${asset.tag} already has an open request.`);
    const approval = await createApproval(tx, {
      type: "lifecycle_return",
      payload: {
        from: { assigneeId: d.employeeId },
        to: { assigneeId: null, status: "SPARE" },
        reason: d.reason,
      },
      requestedById: user.id,
      assetId: asset.id,
      employeeId: d.employeeId,
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: asset.id,
      action: "approval.requested",
      diff: { approval: { from: null, to: approval.refNo } },
    });
    refNo = approval.refNo;
    return null;
  });
  if (failure) return failure;
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/inventory");
  return ok({ refNo });
}

const reservedSchema = z.object({ employeeId: z.string().min(1) });

/** Day-one: one button turns every ACTIVE reservation into its own assign request. */
export async function requestAssignReserved(input: unknown): Promise<ActionResult<{ created: number }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reservedSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;

  let created = 0;
  const failure = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment !== "ACTIVE") return conflict("Slots are frozen for a leaver.");
    const holds = await tx.reservation.findMany({
      where: { employeeId, state: "ACTIVE" },
      include: { asset: true },
    });
    for (const hold of holds) {
      if (hold.asset.status !== "SPARE") continue;
      if (await openApprovalForAsset(tx, hold.assetId)) continue;
      const approval = await createApproval(tx, {
        type: "lifecycle_assign",
        payload: { to: { assigneeId: employeeId, status: "DEPLOYED" }, reason: "reserved — day-one setup" },
        requestedById: user.id,
        assetId: hold.assetId,
        employeeId,
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: hold.assetId,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      created += 1;
    }
    return null;
  });
  if (failure) return failure;
  if (created === 0) return conflict("No reserved spares were available to request.");
  revalidatePath(`/employees/${employeeId}`);
  return ok({ created });
}
```

- [ ] **Step 2: Create `src/components/employees/loadout-view.tsx`**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Pill } from "@/components/ui/pill";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { requestAssign, requestAssignReserved, requestReturn } from "@/server/modules/employees/actions";
import type { ActionResult } from "@/server/action-result";

export interface SlotTile {
  slotId: string;
  name: string;
  typeId: string | null;
  typeName: string;
  required: boolean;
  asset: { id: string; tag: string; model: string; status: string; age: string; pendingRef: string | null } | null;
}

export interface SpareOption {
  id: string;
  tag: string;
  model: string;
  typeId: string | null;
  reservedFor: string | null; // employee name, or null
  reservedForThis: boolean;
}

export interface HoldingItem {
  id: string;
  tag: string;
  model: string;
  note: string; // "reserved · expires 23 Aug 2026" | "assignment queued · APR-2042"
  kind: "reserved" | "queued";
}

const STRIPES = "repeating-linear-gradient(135deg, var(--border-faint) 0 6px, var(--surface-subtle) 6px 12px)";

export function LoadoutView({
  employeeId,
  slots,
  unslotted,
  spares,
  holding,
  frozen,
  canMutate,
}: {
  employeeId: string;
  slots: SlotTile[];
  unslotted: SlotTile["asset"][];
  spares: SpareOption[];
  holding: HoldingItem[];
  frozen: boolean;
  canMutate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState("slots");
  const [fillSlot, setFillSlot] = useState<SlotTile | null>(null);
  const [pickedSpare, setPickedSpare] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState<SlotTile["asset"] | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const mayAct = canMutate && !frozen;
  const dayOne = slots.length > 0 && slots.every((s) => !s.asset);
  const reservedCount = holding.filter((h) => h.kind === "reserved").length;

  function handle<T>(res: ActionResult<T>, onOk: (data: T) => void) {
    if (res.ok) onOk(res.data);
    else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
    else setError(res.message);
  }

  function submitFill() {
    if (!pickedSpare) {
      setFieldErrors({ spare: "Pick a spare first" });
      return;
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      handle(await requestAssign({ employeeId, assetId: pickedSpare, reason }), ({ refNo }) => {
        toast(`${refNo} created — tile shows pending until it executes`, "settled");
        setFillSlot(null);
        setPickedSpare(null);
        setReason("");
        router.refresh();
      });
    });
  }

  function submitReturn() {
    if (!returning) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      handle(await requestReturn({ employeeId, assetId: returning.id, reason: returnReason }), ({ refNo }) => {
        toast(`${refNo} created — return is queued`, "settled");
        setReturning(null);
        setReturnReason("");
        router.refresh();
      });
    });
  }

  function submitReservedBatch() {
    setError(null);
    startTransition(async () => {
      handle(await requestAssignReserved({ employeeId }), ({ created }) => {
        toast(`${created} assign request${created === 1 ? "" : "s"} created from reservations`, "settled");
        router.refresh();
      });
    });
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const idx = tileRefs.current.findIndex((el) => el === document.activeElement);
    if (idx < 0) return;
    const move = (to: number) => {
      const el = tileRefs.current[Math.min(Math.max(to, 0), slots.length - 1)];
      el?.focus();
    };
    if (e.key === "ArrowRight") { e.preventDefault(); move(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(idx - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(idx + 4); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(idx - 4); }
    else if (e.key === "Backspace" && mayAct) {
      const tile = slots[idx];
      if (tile.asset && !tile.asset.pendingRef) { e.preventDefault(); setReturning(tile.asset); }
    }
  }

  const sparesForSlot = fillSlot ? spares.filter((s) => s.typeId && s.typeId === fillSlot.typeId) : [];

  return (
    <div className="flex flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      {frozen && (
        <Banner tone="attention" title="Offboarding in progress — slots are frozen">
          No new assignments for a leaver.{" "}
          <Link href={`/offboarding/${employeeId}`} className="text-accent hover:underline">
            Open the offboarding wizard
          </Link>{" "}
          to collect equipment back.
        </Banner>
      )}

      <div className="flex items-center justify-between">
        <SegmentedControl
          aria-label="Loadout view"
          options={[{ value: "slots", label: "Slots" }, { value: "table", label: "Table" }]}
          value={view}
          onChange={setView}
        />
        {mayAct && dayOne && reservedCount > 0 && (
          <Button variant="primary" size="sm" loading={pending} onClick={submitReservedBatch}>
            Request assign for all {reservedCount} reserved
          </Button>
        )}
      </div>

      {slots.length === 0 && (
        <Banner tone="neutral" title="No equipment policy applies">
          Held items are listed below; define a policy under Equipment policies to get the slot grid.
        </Banner>
      )}

      {view === "slots" ? (
        <div role="group" aria-label="Equipment slots" className="grid grid-cols-2 gap-[11px] lg:grid-cols-4" onKeyDown={onGridKeyDown}>
          {slots.map((tile, i) => {
            const a = tile.asset;
            const name = `${tile.name} slot, ${a ? a.model : "empty"}, ${tile.required ? "required" : "optional"}`;
            return (
              <button
                key={tile.slotId}
                ref={(el) => { tileRefs.current[i] = el; }}
                type="button"
                aria-label={name}
                onClick={() => {
                  if (!mayAct) return;
                  if (!a) { setFillSlot(tile); setPickedSpare(null); setFieldErrors({}); }
                  else if (!a.pendingRef) setReturning(a);
                }}
                className={cn(
                  "group flex flex-col gap-1.5 rounded-(--radius-card) border p-3 text-left transition-colors duration-(--dur-1)",
                  a ? "border-border bg-surface shadow-card" : "border-dashed border-border-strong",
                  !a && tile.required && "bg-[var(--st-attention-bg)]/40",
                  mayAct && "hover:border-accent",
                )}
              >
                {a ? (
                  <>
                    <span aria-hidden className="relative h-[56px] w-full rounded-[6px]" style={{ background: STRIPES }}>
                      <span className="absolute left-1.5 top-1.5"><StatusDot value={a.status} /></span>
                      {a.pendingRef && (
                        <span className="absolute right-1.5 top-1.5"><Pill tone="accent">PENDING</Pill></span>
                      )}
                    </span>
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-faint">{tile.name}</span>
                    <span className={cn("text-[11.5px] font-medium text-fg", a.pendingRef && "opacity-60")}>{a.model}</span>
                    <span className="font-mono text-[11px] text-accent">{a.tag}</span>
                    <span className="flex items-center justify-between font-mono text-[10px] text-fg-faint">
                      {a.pendingRef ?? a.age}
                      {mayAct && !a.pendingRef && (
                        <span aria-hidden className="opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">− return</span>
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <span aria-hidden className="grid h-[56px] w-full place-items-center rounded-[6px]">
                      <span className="grid size-[30px] place-items-center rounded-full border border-border-strong text-fg-muted">+</span>
                    </span>
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-secondary">{tile.name}</span>
                    <span className="font-mono text-[10px] text-fg-faint">
                      {tile.typeName} · {tile.required ? "required" : "optional"}
                    </span>
                    {tile.required && (
                      <span className="font-mono text-[10px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                        policy gap
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th width={19} aria-label="Status colour" />
              <Th width={104}>Tag</Th>
              <Th>Model</Th>
              <Th width={110}>Slot</Th>
              <Th width={90}>Status</Th>
              <Th width={110}>Age</Th>
            </Tr>
          </THead>
          <TBody>
            {[...slots.filter((s) => s.asset).map((s) => ({ a: s.asset!, slot: s.name })),
              ...unslotted.filter(Boolean).map((a) => ({ a: a!, slot: "—" }))].map(({ a, slot }) => (
              <Tr key={a.id}>
                <Td className="pr-0"><StatusDot value={a.status} /></Td>
                <Td mono><Link href={`/inventory/${a.id}`} className="text-accent hover:underline">{a.tag}</Link></Td>
                <Td>{a.model}</Td>
                <Td mono className="text-[10.5px]">{slot}</Td>
                <Td mono className="text-[10.5px]">{a.status}</Td>
                <Td mono>{a.age}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {unslotted.length > 0 && view === "slots" && (
        <Card>
          <CardHeader title="Also holding" />
          <CardBody className="flex flex-col gap-1.5">
            {unslotted.filter(Boolean).map((a) => (
              <div key={a!.id} className="flex items-center gap-2 text-xs text-fg-secondary">
                <StatusDot value={a!.status} />
                <Link href={`/inventory/${a!.id}`} className="font-mono text-accent hover:underline">{a!.tag}</Link>
                {a!.model}
                {a!.pendingRef && <Pill tone="accent">{a!.pendingRef}</Pill>}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {holding.length > 0 && (
        <Card>
          <CardHeader title="Holding area" />
          <CardBody className="flex flex-col gap-1.5">
            {holding.map((h) => (
              <div key={h.id} className="flex items-center gap-2 text-xs text-fg-secondary">
                <StatusDot value={h.kind === "reserved" ? "ACTIVE" : "PENDING"} />
                <Link href={`/inventory/${h.id}`} className={cn("font-mono text-accent hover:underline", h.kind === "queued" && "opacity-60")}>
                  {h.tag}
                </Link>
                <span className={cn(h.kind === "queued" && "opacity-60")}>{h.model}</span>
                <span className="ml-auto font-mono text-[10px] text-fg-faint">{h.note}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* Fill-slot dialog (the right-panel behaviour, rendered as an overlay for keyboard/mobile sanity) */}
      <Dialog
        open={fillSlot !== null}
        onClose={() => setFillSlot(null)}
        title={fillSlot ? `Fill the ${fillSlot.name} slot` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFillSlot(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submitFill}>Request assign</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {sparesForSlot.length === 0 ? (
            <p className="text-xs text-fg-muted">
              No spare {fillSlot?.typeName} in stock — register one or route a purchase.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Pick a spare" className="flex flex-col gap-1">
              {fieldErrors.spare && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{fieldErrors.spare}</p>}
              {sparesForSlot.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-(--radius-ctl) border px-2 py-1.5 text-xs",
                    pickedSpare === s.id ? "border-accent bg-accent-tint" : "border-border hover:bg-surface-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name="spare"
                    className="sr-only"
                    checked={pickedSpare === s.id}
                    onChange={() => setPickedSpare(s.id)}
                  />
                  <span className="font-mono text-accent">{s.tag}</span>
                  <span className="text-fg-secondary">{s.model}</span>
                  <span className="ml-auto font-mono text-[10px] text-fg-faint">
                    {s.reservedForThis ? "reserved for them" : s.reservedFor ? `reserved for ${s.reservedFor}` : "spare"}
                  </span>
                </label>
              ))}
            </div>
          )}
          <FormField label="Reason" hint="Optional — lands in the approval payload." error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>

      {/* Return dialog */}
      <Dialog
        open={returning !== null}
        onClose={() => setReturning(null)}
        title={returning ? `Return ${returning.tag}?` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturning(null)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={submitReturn}>Request return</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            Creates a <span className="font-mono">lifecycle.return</span> approval — the item stays on
            this loadout until the return executes.
          </p>
          <FormField label="Reason" required error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/employees/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { fmtDate, fmtMoney, fmtRelativeDays } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { LoadoutView, type HoldingItem, type SlotTile, type SpareOption } from "@/components/employees/loadout-view";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id }, include: { department: true } });
  if (!employee) notFound();

  const [held, reservations, openApprovals, policies, spareAssets] = await Promise.all([
    prisma.asset.findMany({ where: { assigneeId: id }, orderBy: { tag: "asc" } }),
    prisma.reservation.findMany({ where: { employeeId: id, state: "ACTIVE" }, include: { asset: true } }),
    prisma.approval.findMany({
      where: { employeeId: id, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
      include: { asset: true },
    }),
    prisma.equipmentPolicy.findMany({ include: { slots: { include: { assetType: true } } } }),
    prisma.asset.findMany({
      where: { status: "SPARE" },
      include: { reservations: { where: { state: "ACTIVE" }, include: { employee: true } } },
      orderBy: { tag: "asc" },
    }),
  ]);

  const policy = resolvePolicy(employee, policies);
  const loadout = computeLoadout(policy?.slots ?? [], held);
  const pendingByAsset = new Map(openApprovals.filter((a) => a.assetId).map((a) => [a.assetId!, a.refNo]));
  const typeName = new Map(policies.flatMap((p) => p.slots).map((s) => [s.id, s.assetType?.name ?? "any"]));

  const toTileAsset = (a: (typeof held)[number]) => ({
    id: a.id, tag: a.tag, model: a.model, status: a.status,
    age: a.purchasedAt ? fmtRelativeDays(a.purchasedAt).replace(" ago", " old") : "age unknown",
    pendingRef: pendingByAsset.get(a.id) ?? null,
  });

  const slots: SlotTile[] = loadout.slots.map(({ slot, asset }) => ({
    slotId: slot.id,
    name: slot.name,
    typeId: slot.assetTypeId,
    typeName: typeName.get(slot.id) ?? "any",
    required: slot.required,
    asset: asset ? toTileAsset(asset) : null,
  }));

  const spares: SpareOption[] = spareAssets.map((a) => ({
    id: a.id, tag: a.tag, model: a.model, typeId: a.typeId,
    reservedFor: a.reservations[0]?.employee.name ?? null,
    reservedForThis: a.reservations[0]?.employeeId === id,
  }));

  const holding: HoldingItem[] = [
    ...reservations.map((r) => ({
      id: r.assetId, tag: r.asset.tag, model: r.asset.model,
      note: `reserved${r.expiresAt ? ` · expires ${fmtDate(r.expiresAt)}` : ""}`,
      kind: "reserved" as const,
    })),
    ...openApprovals
      .filter((a) => a.asset && a.asset.assigneeId !== id)
      .map((a) => ({
        id: a.assetId!, tag: a.asset!.tag, model: a.asset!.model,
        note: `assignment queued · ${a.refNo}`,
        kind: "queued" as const,
      })),
  ];

  const bookValue = held.reduce((sum, a) => sum + (a.cost === null ? 0 : Number(a.cost)), 0);
  const oldest = held.reduce<Date | null>((min, a) =>
    a.purchasedAt && (!min || a.purchasedAt < min) ? a.purchasedAt : min, null);
  const canMutate = user.role === "admin" || user.role === "it_staff";

  return (
    <>
      <PageHeader
        title={employee.name}
        breadcrumb={[{ label: "Employees", href: "/employees" }, { label: employee.employeeNo }]}
        badge={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot value={employee.employment} ns="employment" />
            <span className="font-mono text-[10.5px] text-fg-muted">{employee.employment}</span>
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/employees/${id}/timeline`}>Timeline</ButtonLink>
            <ButtonLink href={`/employees/${id}/form`}>Accountability form</ButtonLink>
            {canMutate && <ButtonLink variant="primary" href={`/employees/${id}/edit`}>Edit</ButtonLink>}
          </>
        }
      />
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Character panel */}
        <Card className="h-fit w-full shrink-0 lg:w-[250px]">
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-col items-start gap-2">
              <Avatar name={employee.name} size="xxl" />
              <div>
                <p className="text-[15px] font-semibold text-fg">{employee.name}</p>
                <p className="text-xs text-fg-secondary">{employee.title} · {employee.department.name}</p>
                <p className="pt-0.5 font-mono text-[10.5px] text-fg-faint">
                  {employee.employeeNo} · joined {fmtDate(employee.joinedAt)}
                </p>
                <p className="font-mono text-[10.5px] text-fg-faint">
                  M365: {employee.m365Status ?? "no sync yet"}
                </p>
              </div>
            </div>
            {policy && (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-faint">Loadout vs policy</span>
                  <span className="font-mono text-xs text-fg">{loadout.filled} / {loadout.totalSlots}</span>
                </div>
                <ProgressBar value={loadout.filled} max={loadout.totalSlots} label="Loadout completeness" />
                <span className="text-[10.5px] text-fg-muted">{policy.name}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Items held" value={String(held.length)} />
              <Stat label="Book value" value={fmtMoney(bookValue)} />
              <Stat label="Oldest item" value={oldest ? fmtDate(oldest) : "—"} />
              <Stat label="Open requests" value={String(openApprovals.length)} />
            </div>
          </CardBody>
        </Card>

        <div className="min-w-0 flex-1">
          <LoadoutView
            employeeId={id}
            slots={slots}
            unslotted={loadout.unslotted.map(toTileAsset)}
            spares={spares}
            holding={holding}
            frozen={employee.employment !== "ACTIVE"}
            canMutate={canMutate}
          />
        </div>
      </div>
      {/* keep an escape hatch for link-followers */}
      <p className="sr-only"><Link href="/employees">Back to employees</Link></p>
    </>
  );
}
```

(`Stat`'s API is `{ label: string; value: React.ReactNode; hint?: string }` — the four usages above match it.)

- [ ] **Step 4: Create `src/app/(app)/employees/[id]/not-found.tsx`**

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function EmployeeNotFound() {
  return (
    <EmptyState
      title="Employee not found"
      description="They may have been removed, or the link is stale."
      actions={<ButtonLink href="/employees">Back to employees</ButtonLink>}
    />
  );
}
```

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/employees/actions.ts src/components/employees/loadout-view.tsx "src/app/(app)/employees/[id]"
git commit -m "feat(employees): loadout view — slot grid, keyboard nav, fill/return via approvals, holding area

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check (1280px viewport): Marites → 4 filled tiles + headset gap tile (amber "policy gap"); fill headset → BR-HS-0502 offered → request → toast + PENDING pill on tile; Dennis Ong (OFFBOARDING) → frozen banner, clicking tiles does nothing; Nina Robles → reserved monitor in holding area; viewer@ → grid renders, no actions.

---

### Task 21: `/employees/[id]/edit` — M365 select with custom values, save morph

**Files:**
- Create: `src/components/employees/employee-form.tsx`, `src/app/(app)/employees/[id]/edit/page.tsx`
- Modify: `src/server/modules/employees/actions.ts`

- [ ] **Step 1: Add `updateEmployee` to `src/server/modules/employees/actions.ts`**

Add imports: `import { diffOf } from "@/lib/audit-diff";` and:

```ts
const M365_CANONICAL = ["pending", "active", "offboarding", "inactive"] as const;

const employeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2, "Name the person").max(120),
  title: z.string().trim().min(2, "Give a title").max(120),
  departmentId: z.string().min(1, "Pick a department"),
  employment: z.enum(["ACTIVE", "OFFBOARDING", "OFFBOARDED"]),
  /** null = never synced ("no sync yet"); custom strings stored as-is → Neutral family */
  m365Status: z.string().trim().max(60).nullable(),
});

export async function updateEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: d.id } });
  if (!employee) return conflict("That employee no longer exists.");
  if (!(await prisma.department.findUnique({ where: { id: d.departmentId } }))) {
    return validationError({ departmentId: "Unknown department" });
  }

  const data = {
    name: d.name,
    title: d.title,
    departmentId: d.departmentId,
    employment: d.employment,
    m365Status: d.m365Status === "" ? null : d.m365Status,
  };
  const diff = diffOf(employee as unknown as Record<string, unknown>, data);
  if (Object.keys(diff).length === 0) return ok({ id: employee.id });

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employee.id }, data });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employee.id,
      action: "update", diff,
    });
  });
  revalidatePath(`/employees/${employee.id}`);
  revalidatePath("/employees");
  return ok({ id: employee.id });
}
```

Export the canonical list for the form: add `export const M365_OPTIONS = M365_CANONICAL;`? No — `"use server"` files export async functions only. Put the list in `src/lib/labels.ts` instead:

```ts
export const M365_CANONICAL = ["pending", "active", "offboarding", "inactive"] as const;
```

…and have `actions.ts` import it from there (`import { M365_CANONICAL } from "@/lib/labels";`, drop the local const).

- [ ] **Step 2: Create `src/components/employees/employee-form.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { M365_CANONICAL } from "@/lib/labels";
import { updateEmployee } from "@/server/modules/employees/actions";

const CUSTOM = "__custom";

export function EmployeeForm({
  employeeId,
  departments,
  initial,
}: {
  employeeId: string;
  departments: Array<{ id: string; name: string }>;
  initial: { name: string; title: string; departmentId: string; employment: string; m365Status: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isCustom = initial.m365Status !== null && !(M365_CANONICAL as readonly string[]).includes(initial.m365Status);
  const [form, setForm] = useState({
    name: initial.name,
    title: initial.title,
    departmentId: initial.departmentId,
    employment: initial.employment,
    m365Select: initial.m365Status === null ? "" : isCustom ? CUSTOM : initial.m365Status,
    m365Custom: isCustom ? initial.m365Status! : "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    startTransition(async () => {
      const m365Status =
        form.m365Select === "" ? null : form.m365Select === CUSTOM ? form.m365Custom.trim() || null : form.m365Select;
      const res = await updateEmployee({
        id: employeeId,
        name: form.name,
        title: form.title,
        departmentId: form.departmentId,
        employment: form.employment,
        m365Status,
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-[560px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Card>
        <CardHeader title="Person" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Name" required error={errors.name}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}
          </FormField>
          <FormField label="Title" required error={errors.title} hint="Title drives role-based equipment policies.">
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />}
          </FormField>
          <FormField label="Department" required error={errors.departmentId}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Employment" required error={errors.employment} hint="The offboarding wizard (Phase 7) owns the full flow.">
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.employment} onChange={(e) => setForm((f) => ({ ...f, employment: e.target.value }))}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="OFFBOARDING">OFFBOARDING</option>
                <option value="OFFBOARDED">OFFBOARDED</option>
              </Select>
            )}
          </FormField>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Microsoft 365" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Account status" error={errors.m365Status}
            hint="Sourced from the tenant directory once Entra sync lands (Phase 8). Custom values map to the Neutral family.">
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.m365Select} onChange={(e) => setForm((f) => ({ ...f, m365Select: e.target.value }))}>
                <option value="">no sync yet</option>
                {M365_CANONICAL.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value={CUSTOM}>custom…</option>
              </Select>
            )}
          </FormField>
          {form.m365Select === CUSTOM && (
            <FormField label="Custom value" hint="Stored exactly as typed.">
              {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.m365Custom} onChange={(e) => setForm((f) => ({ ...f, m365Custom: e.target.value }))} />}
            </FormField>
          )}
        </CardBody>
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {saved ? "✓ Saved" : "Save changes"}
        </Button>
        {saved && <span className="text-xs text-fg-muted">audit entry written</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/employees/[id]/edit/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { EmployeeForm } from "@/components/employees/employee-form";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "it_staff");
  const { id } = await params;
  const [employee, departments] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!employee) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${employee.name}`}
        breadcrumb={[
          { label: "Employees", href: "/employees" },
          { label: employee.employeeNo, href: `/employees/${id}` },
          { label: "Edit" },
        ]}
      />
      <EmployeeForm
        employeeId={id}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        initial={{
          name: employee.name,
          title: employee.title,
          departmentId: employee.departmentId,
          employment: employee.employment,
          m365Status: employee.m365Status,
        }}
      />
    </>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/labels.ts src/server/modules/employees/actions.ts src/components/employees/employee-form.tsx "src/app/(app)/employees/[id]/edit"
git commit -m "feat(employees): edit form — M365 canonical+custom values, employment select, save morph

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: Leo Tan shows M365 select preloaded to custom… with "contractor"; save a title change → ✓ Saved morph holds button width + "audit entry written".

### Task 22: Employee timeline + printable accountability form

**Files:**
- Create: `src/components/employees/print-button.tsx`, `src/app/(app)/employees/[id]/timeline/page.tsx`, `src/app/(app)/employees/[id]/form/page.tsx`
- Modify: `src/app/(app)/layout.tsx` (hide shell chrome in print)

- [ ] **Step 1: Create `src/app/(app)/employees/[id]/timeline/page.tsx`** (one person's story: audit + approvals + reservations, merged)

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TimelineList, type TimelineItem } from "@/components/patterns/timeline-list";

export default async function EmployeeTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  const [entries, approvals, reservations] = await Promise.all([
    prisma.auditEntry.findMany({ where: { entityType: "employee", entityId: id } }),
    prisma.approval.findMany({ where: { employeeId: id }, include: { asset: true } }),
    prisma.reservation.findMany({ where: { employeeId: id }, include: { asset: true } }),
  ]);

  const merged = [
    ...entries.map((e) => ({
      when: e.createdAt,
      item: {
        id: `audit-${e.id}`, at: fmtDate(e.createdAt),
        title: (<><span className="font-medium text-fg">{e.actorLabel}</span> — <span className="font-mono text-xs">{e.action}</span></>),
      } satisfies TimelineItem,
    })),
    ...approvals.map((a) => ({
      when: a.createdAt,
      item: {
        id: `approval-${a.id}`, at: fmtDate(a.createdAt), status: a.state,
        title: (<>
          <span className="font-mono text-xs text-accent">{a.refNo}</span> · {APPROVAL_TYPE_LABEL[a.type]}
          {a.asset ? <> · <span className="font-mono text-xs">{a.asset.tag}</span></> : null} —{" "}
          <span className="font-mono text-xs">{a.state}</span>
        </>),
      } satisfies TimelineItem,
    })),
    ...reservations.map((r) => ({
      when: r.createdAt,
      item: {
        id: `res-${r.id}`, at: fmtDate(r.createdAt), status: r.state,
        title: (<>
          hold on <span className="font-mono text-xs text-accent">{r.asset.tag}</span> —{" "}
          <span className="font-mono text-xs">{r.state}</span>
        </>),
      } satisfies TimelineItem,
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .map((x) => x.item);

  return (
    <>
      <PageHeader
        title={`${employee.name} — timeline`}
        breadcrumb={[
          { label: "Employees", href: "/employees" },
          { label: employee.employeeNo, href: `/employees/${id}` },
          { label: "Timeline" },
        ]}
      />
      {merged.length === 0
        ? <EmptyState title="Nothing has happened yet" />
        : <div className="max-w-[640px] pt-2"><TimelineList items={merged} /></div>}
    </>
  );
}
```

- [ ] **Step 2: Hide the shell in print** — in `src/app/(app)/layout.tsx`, wrap `Sidebar` in `<div className="contents print:hidden">…</div>`, add `print:hidden` to the Topbar's wrapper the same way (`<div className="contents print:hidden"><Topbar … /></div>`), add `print:hidden` to the skip link's class list, and change main's classes to `flex-1 p-6 print:p-0`.

(`display: contents` keeps the flex row identical on screen; print swaps it to `none`.)

- [ ] **Step 3: Create `src/components/employees/print-button.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="primary" className="print:hidden" onClick={() => window.print()}>
      Print
    </Button>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/employees/[id]/form/page.tsx`** (generated from live records, never typed; the signed scan uploads back into the asset's documents)

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { fmtDate } from "@/lib/format";
import { PrintButton } from "@/components/employees/print-button";

const STRIPES = "repeating-linear-gradient(135deg, #EEF1F5 0 6px, #F7F9FB 6px 12px)";

export default async function AccountabilityFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { department: true, assets: { orderBy: { tag: "asc" } } },
  });
  if (!employee) notFound();

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="flex justify-end pb-3 print:hidden">
        <PrintButton />
      </div>
      {/* The sheet is deliberately light-theme-only: it's a printed artifact. */}
      <div className="flex flex-col gap-6 rounded-(--radius-card) border border-border bg-white p-8 text-[#101828] shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-center justify-between border-b-2 border-[#101828] pb-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-6 place-items-center bg-[#101828] font-mono text-[11px] font-bold text-white">BR</span>
            <div>
              <p className="text-[15px] font-semibold">Backroom IT — Equipment accountability form</p>
              <p className="font-mono text-[10px] text-[#667085]">generated {fmtDate(new Date())} · from live records</p>
            </div>
          </div>
          <span aria-label="scan code placeholder" className="h-10 w-24" style={{ background: STRIPES }} />
        </header>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-[13px]">
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Employee</dt><dd className="font-medium">{employee.name}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Number</dt><dd className="font-mono">{employee.employeeNo}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Title</dt><dd>{employee.title}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Department</dt><dd>{employee.department.name}</dd></div>
        </dl>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[#D0D5DD] text-left font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#667085]">
              <th className="py-1.5 pr-3">#</th>
              <th className="py-1.5 pr-3">Asset tag</th>
              <th className="py-1.5 pr-3">Model</th>
              <th className="py-1.5 pr-3">Serial</th>
              <th className="py-1.5">Issued</th>
            </tr>
          </thead>
          <tbody>
            {employee.assets.map((a, i) => (
              <tr key={a.id} className="border-b border-[#F2F4F7]">
                <td className="py-1.5 pr-3 font-mono">{String(i + 1).padStart(2, "0")}</td>
                <td className="py-1.5 pr-3 font-mono">{a.tag}</td>
                <td className="py-1.5 pr-3">{a.model}</td>
                <td className="py-1.5 pr-3 font-mono">{a.serial ?? "—"}</td>
                <td className="py-1.5 font-mono">{fmtDate(a.purchasedAt)}</td>
              </tr>
            ))}
            {employee.assets.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-center text-[#667085]">No equipment currently issued.</td></tr>
            )}
          </tbody>
        </table>

        {/* Acknowledgement copy is placeholder-final: flagged for HR review (handover open item). */}
        <p className="text-[12px] leading-relaxed text-[#475467]">
          I acknowledge receipt of the equipment listed above, issued for the performance of my duties.
          I agree to keep it in good working condition, to report loss, theft or damage within one
          business day, and to return every item on request or upon separation. Replacement cost for
          unreturned or negligently damaged items may be recovered as permitted by law and company policy.
        </p>

        <div className="grid grid-cols-2 gap-10 pt-6">
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">{employee.name}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">employee signature · date</p>
          </div>
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">Backroom IT</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">issued by · date</p>
          </div>
        </div>

        <p className="font-mono text-[8.5px] text-[#98A2B3]">
          {employee.employeeNo} · scan the code to open this record · the signed scan uploads back into the equipment's documents
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/employees/print-button.tsx "src/app/(app)/employees/[id]/timeline" "src/app/(app)/employees/[id]/form" "src/app/(app)/layout.tsx"
git commit -m "feat(employees): personal timeline + printable accountability form (print-hidden shell)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: Marites → Accountability form lists her 4 items; browser print preview (Ctrl+P) shows the sheet without sidebar/topbar.

---

### Task 23: Reference-data CRUD — one table design for categories, types, departments

**Files:**
- Create: `src/server/modules/admin/reference-actions.ts`, `src/components/admin/ref-table.tsx`, `src/app/(app)/admin/asset-categories/page.tsx`, `src/app/(app)/admin/asset-types/page.tsx`, `src/app/(app)/admin/departments/page.tsx`

- [ ] **Step 1: Create `src/server/modules/admin/reference-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const entitySchema = z.enum(["category", "type", "department"]);
type RefEntity = z.infer<typeof entitySchema>;

const PATHS: Record<RefEntity, string> = {
  category: "/admin/asset-categories",
  type: "/admin/asset-types",
  department: "/admin/departments",
};
const AUDIT_TYPE: Record<RefEntity, string> = {
  category: "asset-category",
  type: "asset-type",
  department: "department",
};

const nameSchema = z.string().trim().min(2, "At least 2 characters").max(60);

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const createSchema = z.object({
  entity: entitySchema,
  name: nameSchema,
  categoryId: z.string().optional(), // types only
});

export async function createRefRow(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, name, categoryId } = parsed.data;
  if (entity === "type" && !categoryId) return validationError({ categoryId: "Pick a category" });

  try {
    let id = "";
    await prisma.$transaction(async (tx) => {
      if (entity === "category") id = (await tx.assetCategory.create({ data: { name } })).id;
      else if (entity === "department") id = (await tx.department.create({ data: { name } })).id;
      else id = (await tx.assetType.create({ data: { name, categoryId: categoryId! } })).id;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: AUDIT_TYPE[entity], entityId: id,
        action: "create", diff: { name: { from: null, to: name } },
      });
    });
    revalidatePath(PATHS[entity]);
    return ok({ id });
  } catch (err) {
    if (isUnique(err)) return validationError({ name: "That name already exists" });
    throw err;
  }
}

const renameSchema = z.object({ entity: entitySchema, id: z.string().min(1), name: nameSchema });

export async function renameRefRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, id, name } = parsed.data;

  const row =
    entity === "category" ? await prisma.assetCategory.findUnique({ where: { id } })
    : entity === "department" ? await prisma.department.findUnique({ where: { id } })
    : await prisma.assetType.findUnique({ where: { id } });
  if (!row) return conflict("That row no longer exists.");
  if (row.locked) return conflict(`"${row.name}" is locked and can't be renamed.`);
  if (row.name === name) return ok(null);

  try {
    await prisma.$transaction(async (tx) => {
      if (entity === "category") await tx.assetCategory.update({ where: { id }, data: { name } });
      else if (entity === "department") await tx.department.update({ where: { id }, data: { name } });
      else await tx.assetType.update({ where: { id }, data: { name } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: AUDIT_TYPE[entity], entityId: id,
        action: "rename", diff: { name: { from: row.name, to: name } },
      });
    });
    revalidatePath(PATHS[entity]);
    return ok(null);
  } catch (err) {
    if (isUnique(err)) return validationError({ name: "That name already exists" });
    throw err;
  }
}

const deleteSchema = z.object({ entity: entitySchema, id: z.string().min(1) });

/** The friendly usage check runs first; the DB's Restrict FKs are the backstop. */
export async function deleteRefRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, id } = parsed.data;

  if (entity === "category") {
    const row = await prisma.assetCategory.findUnique({
      where: { id }, include: { _count: { select: { types: true, assets: true } } },
    });
    if (!row) return conflict("That row no longer exists.");
    if (row.locked) return conflict(`"${row.name}" is locked.`);
    if (row._count.types || row._count.assets) {
      return conflict(`"${row.name}" is in use by ${row._count.types} type(s) and ${row._count.assets} asset(s) — move them first.`);
    }
  } else if (entity === "department") {
    const row = await prisma.department.findUnique({
      where: { id }, include: { _count: { select: { employees: true, policies: true } } },
    });
    if (!row) return conflict("That row no longer exists.");
    if (row.locked) return conflict(`"${row.name}" is locked.`);
    if (row._count.employees || row._count.policies) {
      return conflict(`"${row.name}" is in use by ${row._count.employees} employee(s) and ${row._count.policies} polic(ies) — move them first.`);
    }
  } else {
    const row = await prisma.assetType.findUnique({
      where: { id }, include: { _count: { select: { assets: true, policySlots: true } } },
    });
    if (!row) return conflict("That row no longer exists.");
    if (row.locked) return conflict(`"${row.name}" is locked.`);
    if (row._count.assets || row._count.policySlots) {
      return conflict(`"${row.name}" is in use by ${row._count.assets} asset(s) and ${row._count.policySlots} policy slot(s) — move them first.`);
    }
  }

  let name = "";
  try {
    await prisma.$transaction(async (tx) => {
      if (entity === "category") name = (await tx.assetCategory.delete({ where: { id } })).name;
      else if (entity === "department") name = (await tx.department.delete({ where: { id } })).name;
      else name = (await tx.assetType.delete({ where: { id } })).name;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: AUDIT_TYPE[entity], entityId: id,
        action: "delete", diff: { name: { from: name, to: null } },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return conflict("Still referenced by other records — the database refused the delete.");
    }
    throw err;
  }
  revalidatePath(PATHS[entity]);
  return ok(null);
}
```

- [ ] **Step 2: Create `src/components/admin/ref-table.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { createRefRow, deleteRefRow, renameRefRow } from "@/server/modules/admin/reference-actions";

export interface RefRow {
  id: string;
  name: string;
  usage: string; // "12 assets · 2 types" — preformatted server-side
  locked: boolean;
  categoryName?: string; // types only
}

/** One table design serves all three reference screens (README 4c): inline add row, locked rows, in-use delete refusal. */
export function RefTable({
  entity,
  rows,
  categories,
}: {
  entity: "category" | "type" | "department";
  rows: RefRow[];
  categories?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState(categories?.[0]?.id ?? "");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const isType = entity === "type";

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: string) {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const res = (await fn()) as Awaited<ReturnType<typeof createRefRow>>;
      if (res.ok) {
        toast(okMsg, "settled");
        setNewName("");
        setRenaming(null);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldError(Object.values(res.fieldErrors ?? {})[0] ?? res.message);
      else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Table>
        <THead>
          <Tr>
            <Th>Name</Th>
            {isType && <Th width={140}>Category</Th>}
            <Th width={200}>In use by</Th>
            <Th width={60} aria-label="Row actions" />
          </Tr>
        </THead>
        <TBody>
          {/* Inline add row — reference data is entered in batches, not through dialogs. */}
          <Tr className="bg-surface-subtle">
            <Td>
              <div className="flex flex-col gap-1 py-1.5">
                <Input
                  aria-label={`New ${entity} name`}
                  placeholder={`Add a ${entity}…`}
                  value={newName}
                  invalid={!!fieldError}
                  className="py-1.5 text-xs"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      run(() => createRefRow({ entity, name: newName, categoryId: isType ? newCategory : undefined }), "Added");
                    }
                  }}
                />
                {fieldError && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{fieldError}</p>}
              </div>
            </Td>
            {isType && (
              <Td>
                <Select aria-label="Category for the new type" value={newCategory} className="py-1.5 text-xs"
                  onChange={(e) => setNewCategory(e.target.value)}>
                  {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Td>
            )}
            <Td className="text-fg-faint">—</Td>
            <Td>
              <Button size="sm" variant="primary" loading={pending}
                onClick={() => run(() => createRefRow({ entity, name: newName, categoryId: isType ? newCategory : undefined }), "Added")}>
                Add
              </Button>
            </Td>
          </Tr>
          {rows.map((row) => (
            <Tr key={row.id}>
              <Td>
                {renaming?.id === row.id ? (
                  <Input
                    aria-label={`Rename ${row.name}`}
                    value={renaming.name}
                    autoFocus
                    className="py-1.5 text-xs"
                    onChange={(e) => setRenaming({ id: row.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") run(() => renameRefRow({ entity, id: row.id, name: renaming.name }), "Renamed");
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <span className="text-[12.5px] text-fg">{row.name}</span>
                )}
              </Td>
              {isType && <Td>{row.categoryName}</Td>}
              <Td mono className="text-[10.5px]">{row.usage}</Td>
              <Td>
                {row.locked ? (
                  <Pill>LOCKED</Pill>
                ) : (
                  <Menu
                    trigger={(props) => (
                      <button type="button" {...props} aria-label={`Actions for ${row.name}`}
                        className="rounded-(--radius-ctl) px-2 py-0.5 text-fg-muted hover:bg-surface-subtle">
                        ⋯
                      </button>
                    )}
                    items={[
                      { label: "Rename", onSelect: () => setRenaming({ id: row.id, name: row.name }) },
                      { label: "Delete", danger: true, onSelect: () => run(() => deleteRefRow({ entity, id: row.id }), "Deleted") },
                    ]}
                  />
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Create the three pages**

`src/app/(app)/admin/asset-categories/page.tsx`:

```tsx
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";

export default async function AssetCategoriesPage() {
  await requireRole("admin", "it_staff");
  const rows = await prisma.assetCategory.findMany({
    include: { _count: { select: { types: true, assets: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <PageHeader title="Asset categories" />
      <RefTable
        entity="category"
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked,
          usage: `${r._count.types} types · ${r._count.assets} assets`,
        }))}
      />
    </>
  );
}
```

`src/app/(app)/admin/asset-types/page.tsx`:

```tsx
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";

export default async function AssetTypesPage() {
  await requireRole("admin", "it_staff");
  const [rows, categories] = await Promise.all([
    prisma.assetType.findMany({
      include: { category: true, _count: { select: { assets: true, policySlots: true } } },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.assetCategory.findMany({ where: { locked: false }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Asset types" />
      <RefTable
        entity="type"
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked, categoryName: r.category.name,
          usage: `${r._count.assets} assets · ${r._count.policySlots} policy slots`,
        }))}
      />
    </>
  );
}
```

`src/app/(app)/admin/departments/page.tsx`:

```tsx
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";

export default async function DepartmentsPage() {
  await requireRole("admin", "it_staff");
  const rows = await prisma.department.findMany({
    include: { _count: { select: { employees: true, policies: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <PageHeader title="Departments" />
      <RefTable
        entity="department"
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked,
          usage: `${r._count.employees} employees · ${r._count.policies} policies`,
        }))}
      />
    </>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/server/modules/admin/reference-actions.ts src/components/admin/ref-table.tsx "src/app/(app)/admin"
git commit -m "feat(admin): reference-data CRUD — one table design, inline add, locked rows, in-use refusal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Controller live-check: Uncategorised shows LOCKED with no menu; add "Tablet" inline; deleting "Laptop" (in use) → conflict banner naming the counts; viewer@ gets redirected off `/admin/asset-categories` (Phase 2 path rule, still true).

---

### Task 24: E2E suite, full battery, docs, finish the branch

**Files:**
- Create: `e2e/it-core.spec.ts`
- Modify: `docs/HANDOVER.md`, this plan (check off tasks, record deviations)

- [ ] **Step 1: Create `e2e/it-core.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

test.describe("inventory list", () => {
  test("axe passes", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await expectNoSeriousAxe(page);
  });

  test("sort clicks rewrite the URL contract", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await page.getByRole("button", { name: "Model" }).click();
    await expect(page).toHaveURL(/sort=model/);
    await page.getByRole("button", { name: "Model" }).click();
    await expect(page).toHaveURL(/sort=-model/);
  });

  test("facets update the URL only on Apply, and chips echo it", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("dialog", { name: /Filter by Status/ }).getByLabel(/^DEFECTIVE/i).check();
    await expect(page).not.toHaveURL(/status=/);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/status=DEFECTIVE/);
    await expect(page.getByRole("link", { name: /status: DEFECTIVE/i })).toBeVisible();
  });

  test("an exact tag search opens the record (scanner contract)", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await page.getByLabel("Search assets").fill("BR-LT-0148");
    await page.getByLabel("Search assets").press("Enter");
    await expect(page.getByRole("heading", { name: "BR-LT-0148" })).toBeVisible();
  });

  test("viewer is read-only: no checkboxes, no New asset, badge shown", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/inventory");
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    await expect(page.getByRole("link", { name: "New asset" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("bulk selection creates one approval per asset", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?status=DONATED,BUYOUT");
    await page.getByLabel(/Select BR-LT-0075/).check();
    await page.getByLabel(/Select BR-LT-0060/).check();
    await page.getByRole("button", { name: "Bulk actions…" }).click();
    await page.getByLabel(/Target status/).selectOption("DISPOSE");
    await page.getByLabel(/Reason/).fill("e2e bulk disposal run");
    await page.getByRole("button", { name: "Request status change" }).click();
    await expect(page.getByText(/2 approvals created/)).toBeVisible();
  });

  test("CSV export honors filters and is typed", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const res = await page.request.get("/inventory/export?status=DEPLOYED");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("BR-LT-0148");
    expect(body).not.toContain("BR-LT-0181"); // SPARE — filtered out
  });
});

test.describe("asset record", () => {
  test("create → duplicate tag is an inline error, valid create lands on the record", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/new");
    await page.getByLabel(/Asset tag/).fill("BR-LT-0148");
    await page.getByLabel(/Model/).fill("e2e duplicate probe");
    await page.getByLabel(/Category/).selectOption({ label: "Laptop" });
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByText("That tag is already registered")).toBeVisible();

    const tag = `BR-ZZ-${String(Date.now() % 10000).padStart(4, "0")}`;
    await page.getByLabel(/Asset tag/).fill(tag);
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByRole("heading", { name: tag })).toBeVisible();
  });

  test("edit writes field-level history rows", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-MN-0910");
    await expect(page.getByRole("heading", { name: "BR-MN-0910" })).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel(/Model/).fill("LG 27UL500-W");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();
    await page.goto(page.url().replace(/\/edit$/, "/history"));
    await expect(page.getByRole("row", { name: /model/ }).first()).toContainText("LG 27UL500-W");
  });

  test("secrets: reveal is audited and counts down; viewer can't reveal", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-LT-0201");
    const recordUrl = page.url();
    await page.goto(`${recordUrl}/secrets`);
    await page.getByLabel(/Label/).fill("bios");
    await page.getByLabel(/Value/).fill("hunter2-e2e");
    await page.getByRole("button", { name: "Store encrypted" }).click();
    await expect(page.getByText("bios")).toBeVisible();
    await page.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText("hunter2-e2e")).toBeVisible();
    await expect(page.getByText(/hides in \d+s/)).toBeVisible();
    await page.goto(`${recordUrl}/history`);
    await expect(page.getByRole("row", { name: /SECRET_READ/ }).first()).toBeVisible();

    await login(page, "viewer@thebackroomop.com");
    await page.goto(`${recordUrl}/secrets`);
    await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);
  });

  test("documents: type allowlist rejects, PNG uploads", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-LT-0201");
    await page.goto(`${page.url()}/documents`);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByLabel("Upload document").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(page.getByText(/Accepted: PDF, PNG, JPG/)).toBeVisible();
    await page.getByLabel("Upload document").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("link", { name: "photo.png" })).toBeVisible();
  });
});

test.describe("employees & loadout", () => {
  test("list shows loadout gaps; the gaps filter narrows", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    const marites = page.getByRole("row", { name: /Marites Bautista/ });
    await expect(marites).toContainText("1 missing");
    await page.getByRole("link", { name: "Policy gaps only" }).click();
    await expect(page).toHaveURL(/gaps=1/);
    await expect(page.getByRole("row", { name: /Marites Bautista/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Carlo Dizon/ })).toHaveCount(0); // Operations — no policy
  });

  test("loadout view passes axe and shows the policy gap", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    await expect(page.getByRole("button", { name: /headset slot, empty, required/ })).toBeVisible();
    await expectNoSeriousAxe(page);
  });

  test("filling a slot creates an assign approval and a pending tile", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    await page.getByRole("button", { name: /headset slot, empty, required/ }).click();
    await page.getByRole("radiogroup", { name: "Pick a spare" }).getByText("BR-HS-0502").click();
    await page.getByRole("button", { name: "Request assign" }).click();
    await expect(page.getByText(/APR-\d+ created/)).toBeVisible();
  });

  test("a leaver's grid is frozen", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Dennis");
    await page.getByRole("link", { name: /Dennis Ong/ }).click();
    await expect(page.getByText(/slots are frozen/i)).toBeVisible();
  });

  test("employee edit keeps custom M365 values", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Leo");
    await page.getByRole("link", { name: /Leo Tan/ }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByLabel(/Account status/)).toHaveValue("__custom");
    await expect(page.getByLabel(/Custom value/)).toHaveValue("contractor");
  });

  test("accountability form renders the held items", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Marites");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    await page.getByRole("link", { name: "Accountability form" }).click();
    await expect(page.getByText("Equipment accountability form")).toBeVisible();
    await expect(page.getByText("BR-LT-0148")).toBeVisible();
  });
});

test.describe("reference data", () => {
  test("inline add, locked row, in-use delete refusal; axe passes", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    await expectNoSeriousAxe(page);

    const locked = page.getByRole("row", { name: /Uncategorised/ });
    await expect(locked).toContainText("LOCKED");
    await expect(locked.getByRole("button")).toHaveCount(0);

    const name = `E2E Cat ${Date.now() % 100000}`;
    await page.getByLabel("New category name").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

    await page.getByRole("row", { name: /^Laptop/ }).getByLabel(/Actions for Laptop/).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText(/is in use by .* — move them first/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the full battery** (STOP the dev server before `npm run build` — shared `.next`)

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
npm run db:seed && npm run e2e
```

Expected: all green. The e2e run mutates data (approvals, an asset, a secret, a document, a category) — reseed afterwards if you want a clean manual-review state: `npm run db:seed`.

- [ ] **Step 3: Update the docs**

- Check off every task in this plan; append a "Deviations" section listing anything that shipped differently (there will be some — record them, don't let the plan drift).
- Update `docs/HANDOVER.md`: Phase 3 → DONE (one paragraph: what shipped, new conventions — ActionResult, checkRate, writeAudit, url-state contract), Phase 4 entry notes (worker executes the approvals Phase 3 now creates; activity-feed placeholders to replace; approvals queue reads `Approval` rows already being produced; `getApprovalsBadge` in the sidebar already counts them).

```bash
git add docs/
git commit -m "docs(plan): phase 3 checked off — deviations recorded, phase 4 entry notes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch`: merge `phase-3-it-core` to `main`, delete the branch, push.

---

## Self-review notes (spec coverage)

- Brief §7 IT-workspace routes shipped this phase: `/inventory` (+new/[id]/edit/history/timeline/documents/secrets/reservations), `/employees` (+[id]/edit/timeline/form), `/admin/asset-categories|asset-types|departments`. Explicit Phase 4 placeholders: `/inventory/activity`, `/employees/activity`. Already live from Phase 2: `/approvals` badge counts. Phase 7: `/offboarding`, `/reservations` list, `/admin/equipment-policies` (loadout view links to the first).
- Entry criteria: #1 every action guards via `actionRole` (Tasks 9, 10, 12, 14, 16, 17, 20, 21, 23) · #2 Task 2 · #3 the action shape everywhere (guard → checkRate → zod → tx+audit → revalidate → typed result) · #4 Task 17 · #5 Tasks 3/10 + palette in Task 4 · #6 client islands only where interaction demands (inventory table, loadout grid, forms).
- Eight states: loading (loading.tsx, Tasks 7/19), two empties (Tasks 7/19), forbidden (middleware + requireRole + typed forbidden), read-only (checkbox/action absence + badge), rate-limited (RateLimitNotice everywhere), optimistic-pending (Button loading everywhere), background-pending (record banner, PENDING tiles, holding area). Section-level error-with-retry is deliberately deferred to Home (Phase 6) where the design specifies it — list pages fail whole-route this phase.







