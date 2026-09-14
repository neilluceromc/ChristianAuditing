# Phase 21 — Approvals oversight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make direct IT changes visible and distinguishable on the approvals surfaces (a stored flag, a Closed-tab route filter and pill, a direct-row detail card, an admin Home section), show each approval once per Home screen, read every paged list from one snapshot, strip invisible characters from every reason, zero the axe sweep's tolerated tail, and prove the rate limiter end to end.

**Architecture:** One additive column with a backfill (`Approval.appliedDirectly`, migration 22) set by the single approval writer; pure rules in `src/lib/approvals-list.ts` and a new `src/lib/reason.ts`; one server helper `src/server/paged.ts` adopted by every count-then-page list; UI changes confined to `/approvals`, `/approvals/[id]`, Home and two shared components (`Tabs`, `Th`); two new e2e files.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / PostgreSQL 16, Auth.js v5, zod 4, vitest, Playwright + axe-core; existing `pageOf`, `SectionCard`, `Stat`, `Pill`, `RateLimitNotice`, `summarizeApproval`.

**Spec:** `docs/superpowers/specs/2026-09-14-approvals-oversight-design.md` — the binding authority.

## Global Constraints

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env`: `DATABASE_URL` → `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`. Never the `inventory` database, never port 3000. Never read or print `.env` (check a key's presence with `grep -c "^NAME=" .env`, never its value).
- Playwright: foreground only, `E2E_PORT=3100 --workers=1 --global-timeout=540000`, one process at a time, port free before, no server left behind.
- `"use server"` modules export only async functions; zod at every boundary; `ActionResult` union; role guard THEN `checkRate`; one `writeAudit` per write.
- Additive migration only; the seed's TRUNCATE already covers `Approval` and `RateEvent`.
- The approval state machine, every state value, the worker, the Open/Mine/Unclaimed/Failed rules, every existing URL and every reason field's min/max/message do not change.
- Tests first for pure modules; measured counts in commit messages; never amend; commit after every task by pathspec.
- Reviewer subagents: read-only — never `git stash`, `git checkout`, `git restore`, `git reset`, `git switch`; verification in the foreground; report written before the reply.

## Decisions the plan makes beyond the spec

- **P-1** `directChanges` lives in `src/server/modules/home/queries.ts` (not `approvals/queries.ts`) so Task 2 (approvals surfaces) and Task 3 (Home) touch disjoint files and can run side by side.
- **P-2** Task 2 keeps `listApprovals`'s existing count → `pageOf` → `findMany` shape; Task 4 converts it with every other list. One task owns the paging change.
- **P-3** `pagedSnapshot` takes an optional `client` (default `prisma`) so its unit test injects a fake whose `$transaction(fn, opts)` calls `fn(fakeTx)` and records the isolation level — no prisma mocking (none exists in the suite).
- **P-4** zod 4: `reasonRequired` is `z.string().overwrite(cleanReason).min(min, message).max(max)` (`.overwrite` keeps the schema a `ZodString`, so callers' `.optional()`/`.default("")` chains still type-check); the implementer proves with the unit test that checks run on the cleaned value, and falls back to `.transform().pipe()` only if they do not.
- **P-5** The oversight e2e's double-count case claims `APR-2040` for `admin@` through Prisma (`state: "CLAIMED", claimedById, claimedAt: now`) rather than the UI — the case is about Home's rendering, and `home-finance.spec.ts` already proves the Claimed-by-you list itself.
- **P-6** Execution order: Task 1 ‖ Task 5 (disjoint files), then Task 2 ‖ Task 3, then Task 4, Task 6, Task 7, Task 8 in sequence.

---

## File structure

- `prisma/schema.prisma`, `prisma/migrations/<ts>_approval_applied_directly/migration.sql`, `prisma/seed.ts` — the flag, its index and backfill, three seeded direct rows.
- `src/server/modules/approvals/create.ts` — sets the flag.
- `src/lib/approvals-list.ts` (+ `.test.ts`) — `CLOSED_VIA`, `parseVia`, `viaWhere`, `CLOSED_VIA_LABEL`, `DIRECT_WINDOW_DAYS`, `DIRECT_KIND_LABEL`, the `tabWhere` doc comment.
- `src/server/modules/approvals/queries.ts` — `listApprovals(tab, via, …)` with `direct` per row, `closedViaCounts`.
- `src/app/(app)/approvals/page.tsx`, `src/components/approvals/queue-table.tsx`, `src/components/approvals/closed-via-chips.tsx` (new), `src/app/(app)/approvals/[id]/page.tsx` — chips, pill, announce, direct detail card.
- `src/server/modules/home/queries.ts` — `directChanges`, `worklist(..., { excludeOwnClaims })`; `src/components/home/direct-changes.tsx` (new); `src/app/(app)/page.tsx` — the section on both branches, `SHOWS_FOCUS_TOGGLE.admin`.
- `src/server/paged.ts` (+ `.test.ts`) — `pagedSnapshot`; adopted in `approvals/queries.ts`, `audit/queries.ts`, `admin/queries.ts` (users, deliveries), `purchases/queries.ts`, `suppliers/queries.ts`, `stock/queries.ts` (items plain path, stocktakes), `employees/queries.ts` (plain path), `inventory/queries.ts` (plain path), `reservations/queries.ts`, `src/app/(app)/inventory/[id]/history/page.tsx`.
- `src/lib/reason.ts` (+ `.test.ts`) — `cleanReason`, `reasonRequired`, `reasonOptional`; adopted at the twelve sites spec §6 lists.
- `e2e/axe-sweep.spec.ts` — `PROMOTED_RULES`, `AXE_DETAIL`; `src/components/ui/tabs.tsx` (+ four callers), `src/components/ui/table.tsx`, plus whatever the detail run attributes.
- `e2e/oversight.spec.ts` (7), `e2e/rate-limit.spec.ts` (2); `e2e/approvals-audit.spec.ts` (Closed count 5).
- Docs: `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, this plan, the spec.

---

### Task 1: Flag, migration 22, seed, pure rules

**Files:** `prisma/schema.prisma` (model `Approval` ~564–592), new migration, `prisma/seed.ts` (approvals block ~283–300; helpers `asset(tag)`, `emp(no)`, `itStaff`, `day(n)`), `src/server/modules/approvals/create.ts`, `src/lib/approvals-list.ts` (+ `src/lib/approvals-list.test.ts`), `e2e/approvals-audit.spec.ts:62`.

**Interfaces — Produces:** `Approval.appliedDirectly: boolean`; everything in spec §3.1 exactly as typed there.

- [ ] **Step 1: Schema** — add `appliedDirectly Boolean @default(false)` with the spec's doc comment and `@@index([appliedDirectly, resolvedAt])`.
- [ ] **Step 2: Migration** — `npx prisma migrate dev --name approval_applied_directly --create-only`; append spec §2's `UPDATE … WHERE "state" = 'EXECUTED' AND "claimedAt" IS NOT NULL AND "claimedAt" = "resolvedAt";` after the generated statements; `npx prisma migrate deploy`; `npx prisma generate`; `npx prisma migrate status` → 22, up to date.
- [ ] **Step 3: Writer** — in `createApproval`, `appliedDirectly: input.executed !== undefined` inside `data`.
- [ ] **Step 4: Seed** — after `a0181` is read, add the three rows of spec §2 (`refNo`, `type`, `state: "EXECUTED"`, `priority: "NORMAL"`, `slaAt: <resolved + 48h>`, `requestedById: itStaff.id`, `claimedById: itStaff.id`, `claimedAt: <resolved>`, `resolvedAt: <resolved>`, `appliedDirectly: true`, `assetId`, `employeeId` where the payload names one, `payload` as the table). Grep `e2e/*.spec.ts` for `BR-HS-0501`, `BR-HS-0502`, `BR-KB-0402` and confirm no spec queries `approval` rows for them; if one does, pick another IT asset with the same status and say so in the report.
- [ ] **Step 5: Pure rules, tests first** — extend `src/lib/approvals-list.test.ts`: `parseVia("direct") → "direct"`, `parseVia("x") → "all"`, `viaWhere("direct")` deep-equals `{ appliedDirectly: true }`, `viaWhere("queue")` → `{ appliedDirectly: false }`, `viaWhere("all")` → `{}`, `DIRECT_KIND_LABEL` has every `ApprovalType` key (build the key list from `Object.values(ApprovalType)` of `@prisma/client`). Run red, implement spec §3.1, run green. Add the `tabWhere` doc comment.
- [ ] **Step 6: The one e2e count** — `e2e/approvals-audit.spec.ts:62` `Closed` `toContainText("2")` → `"5"` with a comment naming Phase 21's three seeded direct rows.
- [ ] **Step 7: Verify and commit** — `npm run db:seed` twice; `npx tsc --noEmit`; `npx vitest run` (record); `npx eslint src/lib prisma e2e/approvals-audit.spec.ts`.
```bash
git commit -m "feat(approvals): appliedDirectly flag (migration 22, backfill); seed three direct rows; parseVia/viaWhere/labels" -- prisma/schema.prisma prisma/migrations prisma/seed.ts src/server/modules/approvals/create.ts src/lib/approvals-list.ts src/lib/approvals-list.test.ts e2e/approvals-audit.spec.ts
```

---

### Task 2: The Closed tab and the direct-row detail

**Files:** `src/server/modules/approvals/queries.ts` (`ApprovalRow` ~11–21, `listApprovals` ~23–56, `tabCounts` ~58), `src/app/(app)/approvals/page.tsx`, `src/components/approvals/queue-table.tsx` (State cell ~169, announce ~97), new `src/components/approvals/closed-via-chips.tsx`, `src/app/(app)/approvals/[id]/page.tsx` (meta line ~46–49, the checks card ~52–66).

**Interfaces — Consumes:** Task 1's `parseVia`, `viaWhere`, `CLOSED_VIA`, `CLOSED_VIA_LABEL`. **Produces:** `listApprovals(tab: QueueTab, via: ClosedVia, userId, role, requestedPage)`; `ApprovalRow.direct: boolean`; `closedViaCounts(userId, role): Promise<Record<ClosedVia, number>>`.

- [ ] **Step 1: Queries** — thread `via` (applied only when `tab === "closed"`), map `direct: a.appliedDirectly`; add `closedViaCounts` (three `count`s under `AND[tabWhere("closed"), viaWhere(v), approvalClassWhere(role)]`). Keep the count/`pageOf`/`findMany` shape (P-2).
- [ ] **Step 2: Page** — `const via = tab === "closed" ? parseVia(sp.get("via")) : "all"`; `hrefFor(t, p, via)` appends `via` only when `t === "closed" && via !== "all"`; the tab links stay as they are; load `closedViaCounts` only when `tab === "closed"`; render `<ClosedViaChips via counts hrefFor>` under the tab nav on the Closed tab; the via-aware empty states of spec §3.2; the count line reads `{total} in this tab` unchanged.
- [ ] **Step 3: Chips** — `closed-via-chips.tsx`: `<div role="group" aria-label="Closed by route" className="flex flex-wrap items-center gap-1.5">`, one `Link` per `CLOSED_VIA` with the `repair-chips.tsx` chip classes, text `{CLOSED_VIA_LABEL[v]} <span className="font-mono">{counts[v]}</span>`, `aria-current={v === via ? "true" : undefined}`; `all` links to `hrefFor("closed", 1, "all")`.
- [ ] **Step 4: Row** — State cell: `{row.state}{row.direct && <Pill>DIRECT</Pill>}` (a `gap-1.5` inline flex); the announce string appends `, applied directly` when `row.direct`.
- [ ] **Step 5: Detail** — when `approval.appliedDirectly`: the meta line per spec §3.3 (uses `fmtDateTime`; `claimedBy` may be null in theory → fall back to `requestedBy.name`); replace the "What the system checked" `Card` with the "How it was applied" card (copy verbatim from spec §3.3; the link only when `approval.assetId`); do not call `systemChecks` for a direct row. A queue row renders exactly as before.
- [ ] **Step 6: Verify** — `npx tsc --noEmit`; `npx eslint "src/app/(app)/approvals" src/components/approvals src/server/modules/approvals`; run the dev server foreground on 3100 and walk: `/approvals?tab=closed` shows `All 5 · Applied directly 3 · Through the queue 2`, `via=direct` lists APR-2036..2038 with `DIRECT` pills, page 2 links keep `via` (force by checking the `Pagination` hrefs in the DOM), a direct detail shows the new card, `APR-2031` still shows "What the system checked"; stop the server.
```bash
git commit -m "feat(approvals): Closed tab filters by route (via=direct|queue) with counts and a DIRECT pill; a direct row's detail says who applied it and when" -- src/server/modules/approvals/queries.ts "src/app/(app)/approvals" src/components/approvals
```

---

### Task 3: Home — the admin section and one approval per screen

**Files:** `src/server/modules/home/queries.ts` (`worklist` ~30–40 `breached` where; new `directChanges` near `claimedByYou` ~440), new `src/components/home/direct-changes.tsx`, `src/app/(app)/page.tsx` (`SHOWS_FOCUS_TOGGLE` ~40, admin branch ~82–102, IT branch ~172–230, the `worklist(...)` call ~176).

**Interfaces — Consumes:** Task 1's `DIRECT_WINDOW_DAYS`, `DIRECT_KIND_LABEL`. **Produces:** `directChanges(now?, days?): Promise<DirectChanges>` (spec §4.1's interface); `worklist(userId, role, { limit?, excludeOwnClaims? })`.

- [ ] **Step 1: Query** — `directChanges` per spec §4.1: `since = now - days*DAY_MS`; `groupBy({ by: ["type"], where, _count: { _all: true } })`, `groupBy({ by: ["claimedById"], where, _count: { _all: true } })`, names via `user.findMany({ where: { id: { in } }, select: { id, name } })` (a null `claimedById` group reads "Unknown"); sort as the spec says; `total` = sum of kinds.
- [ ] **Step 2: Worklist option** — add `excludeOwnClaims?: boolean` to `opts`; when set, the `breached` where becomes `AND: [{ state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now } }, { NOT: { claimedById: userId } }, scope]`. Doc comment: one approval appears once on Home; own claims live in "Claimed by you". Home passes `{ limit: 2, excludeOwnClaims: true }`; `/inventory/work` stays `{}`.
- [ ] **Step 3: Component** — `direct-changes.tsx` (server component): empty → `<p className="text-xs text-fg-muted">Nothing was applied directly in the last 7 days.</p>`; else `<Stat label="Applied directly" value={total} />`, then two lists in the `AdminHomeBody` "Who can get in" style (uppercase `text-[11px]` caption "By kind" / "By whom", rows `label` + mono count), then `<Link href="/approvals?tab=closed&via=direct">See them in Closed →</Link>`. Use `DIRECT_WINDOW_DAYS` in the copy, not a literal 7.
- [ ] **Step 4: Page** — `SHOWS_FOCUS_TOGGLE.admin = true`; both branches: `const direct = user.role === "admin" ? await safeSection("Applied directly", () => directChanges()) : null` (fold into the existing `Promise.all` on the IT branch); admin branch: below "System", `{direct && !focus && <SectionCard title="Applied directly · last 7 days" result={direct}>{(d) => <DirectChangesBody data={d} />}</SectionCard>}`; IT branch: the same inside the `!focus` block above "Fleet". Update the page-top comment that said the admin Home has no secondary section.
- [ ] **Step 5: Verify** — `npx tsc --noEmit`; `npx eslint "src/app/(app)/page.tsx" src/components/home src/server/modules/home`; `npx vitest run`; dev server foreground: as `admin@` `/` shows the section (total 3, "Status changed 1 · Assigned 1 · Returned 1" in count-desc-then-label order, "J. Sarmiento 3"), focus on hides it; with the `br.dept=admin` cookie (switch workspace in the UI) the admin branch shows it and the focus toggle; as `it@` no section; stop the server.
```bash
git commit -m "feat(home): admin section 'Applied directly · last 7 days' on both admin landings; the worklist stops repeating the viewer's own claims" -- src/server/modules/home/queries.ts src/components/home/direct-changes.tsx "src/app/(app)/page.tsx"
```

---

### Task 4: One snapshot per page

**Files:** new `src/server/paged.ts` + `src/server/paged.test.ts`; `src/server/modules/approvals/queries.ts:27–37`, `audit/queries.ts:111–120`, `admin/queries.ts:36–45` and `:280–290`, `purchases/queries.ts:72–80`, `suppliers/queries.ts:21–30`, `stock/queries.ts:97–105` and `:234–242`, `employees/queries.ts:71–76` (the non-gaps path), `inventory/queries.ts:190–198` (the non-repair path), `reservations/queries.ts:47–62`, `src/app/(app)/inventory/[id]/history/page.tsx:26–34`.

**Interfaces — Produces:** spec §5's `pagedSnapshot` signature.

- [ ] **Step 1: Test first** — `paged.test.ts`: a fake client `{ $transaction: (fn, opts) => { seen = opts; return fn(fakeTx); } }`; assert `count` is called before `rows`, `rows` receives `pageOf(total, requested, size)` (requested 9 with total 30 and size 25 → page 2, skip 25), the result spreads the page fields plus `rows`, and `seen.isolationLevel === "RepeatableRead"`.
- [ ] **Step 2: Helper** — `prisma.$transaction(async (tx) => { const total = await count(tx); const pg = pageOf(total, requested, size); const rows = await rows(tx, pg); return { rows, ...pg }; }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })`.
- [ ] **Step 3: Adopt** — each listed site becomes `const { rows, total, page, pageCount } = await pagedSnapshot(SIZE, requestedPage, (tx) => tx.<model>.count({ where }), (tx, pg) => tx.<model>.findMany({ …, skip: pg.skip, take: pg.take }))`, keeping every `where`, `orderBy`, `include` and return shape byte-for-byte; reservations: the `groupBy` runs as the `count` function (it returns `counts[tab]`; keep `counts` by computing them inside and returning them alongside — restructure minimally). Grep `\.count\(` across `src/server` and `src/app` once more and list every remaining count→findMany pair you did NOT convert with the reason (in-memory path, facet count, cursor).
- [ ] **Step 4: Verify** — `npx tsc --noEmit`; `npx eslint src/server src/app`; `npx vitest run`; foreground `E2E_PORT=3100 npx playwright test e2e/paging.spec.ts e2e/approvals-audit.spec.ts --workers=1 --global-timeout=540000` green.
```bash
git commit -m "refactor(paging): pagedSnapshot reads a list's count and page in one RepeatableRead transaction; adopted by twelve lists" -- src/server/paged.ts src/server/paged.test.ts src/server/modules src/app
```

---

### Task 5: Reasons

**Files:** new `src/lib/reason.ts` + `src/lib/reason.test.ts`; the sites in spec §6: `src/server/modules/approvals/actions.ts:19`, `employees/actions.ts:25,:100`, `employees/exception-actions.ts:13`, `inventory/actions.ts:49,:457,:590`, `offboarding/actions.ts:72,:90`, `purchases/actions.ts:29,:70`, `lifecycle/actions.ts:93,:221,:263`, `src/lib/stock-schema.ts:51,:59`, `src/lib/transfer-schema.ts:23`.

**Interfaces — Produces:** spec §6's four exports.

- [ ] **Step 1: Test first** — `reason.test.ts`: `cleanReason("​​​")` → `""`; `cleanReason(" ​ok⁠ ")` → `"ok"`; `cleanReason("ab")` → `"ab"`; `reasonRequired().safeParse("​​​​").success === false` with message `REASON_MESSAGE`; `reasonRequired().parse("​fix​")` → `"fix"`; `reasonRequired({ min: 5, message: "Say what is wrong — at least 5 characters." }).safeParse("okay")` fails with that message; `reasonRequired().safeParse("x".repeat(501)).success === false`; `reasonOptional().parse(undefined)` → `undefined`; `reasonOptional({ max: 200 }).parse("​")` → `""`. Run red.
- [ ] **Step 2: Implement** — per P-4; `cleanReason` uses `/[\p{Cf}\p{Cc}]/gu`. Run green.
- [ ] **Step 3: Adopt** — replace each site's schema with `reasonRequired({...})`/`reasonOptional({...})` carrying that site's own min/max/message (`inventory:590` keeps min 5 and its message; `stock-schema:59` keeps "Say why" and max 200; `transfer-schema:23` keeps max 300 and `.default("")`; `stock-schema:51` keeps `.optional().default("")`); the manual trims at `offboarding:90`, `purchases:70` and the two lifecycle MISSING checks use `cleanReason`.
- [ ] **Step 4: Verify** — `npx tsc --noEmit`; `npx eslint src/lib src/server/modules`; `npx vitest run` (record the delta).
```bash
git commit -m "fix(reasons): one shared reason schema strips invisible and control characters before the length check; adopted at every reason field" -- src/lib/reason.ts src/lib/reason.test.ts src/lib/stock-schema.ts src/lib/transfer-schema.ts src/server/modules
```

---

### Task 6: Accessibility — attribute, fix, promote

**Files:** `e2e/axe-sweep.spec.ts` (`scanRoute` ~76–91 and the admin-branch copy ~155–163), `src/components/ui/tabs.tsx` + callers (`src/components/inventory/record-tabs.tsx:29`, `src/app/(app)/purchases/page.tsx:74`, `reservations/page.tsx:46`, `admin/webhooks/deliveries/page.tsx:34`), `src/components/ui/table.tsx` (`Th` ~58–75), plus whatever the detail run attributes.

- [ ] **Step 1: Sweep instrumentation** — `const PROMOTED_RULES = new Set<string>([])`; factor the violation handling into one `record(results, label)` used by both scan sites: a violation fails when `impact` is serious/critical OR `PROMOTED_RULES.has(v.id)`; otherwise it is counted, and when `process.env.AXE_DETAIL === "1"` each node prints `${label} · ${v.id} · ${v.impact} · ${node.target.join(" ")}`.
- [ ] **Step 2: Attribute** — foreground `AXE_DETAIL=1 E2E_PORT=3100 npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=540000`; paste the printed detail lines for the four rules into the report.
- [ ] **Step 3: Fix root causes** — `Tabs` gains a required `label: string` rendered as `aria-label` (callers: "Record sections", "Request states", "Reservation states", "Delivery states"); `Th`: when `ariaLabel` is set and `children` is empty, render `<span className="sr-only">{ariaLabel}</span>` as the content; then each remaining node the detail run named (a missing `<h1>` gets a `PageHeader` or an `h1` in the page's own style; a skipped heading level is fixed at the component that skips it). Never disable a rule; never change a landmark's role to dodge it.
- [ ] **Step 4: Promote** — `PROMOTED_RULES = new Set(["empty-table-header", "page-has-heading-one", "heading-order", "landmark-unique"])`; re-run the sweep foreground: green, and the printed tail shows none of the four. If one cannot reach zero, leave it out of the set and write why in the report (the controller records a ruling).
- [ ] **Step 5: Verify** — `npx tsc --noEmit`; `npx eslint .`; `npx vitest run`; also re-run foreground the specs whose pages changed (`e2e/kitchen-sink.spec.ts` if the kitchen sink uses `Tabs`, `e2e/purchases.spec.ts`, `e2e/custody.spec.ts` for reservations, `e2e/admin.spec.ts`).
```bash
git commit -m "a11y: Tabs carry a label, empty Th has sr-only text, <the attributed fixes>; the axe sweep promotes empty-table-header, page-has-heading-one, heading-order and landmark-unique to failing rules (tail now zero)" -- e2e/axe-sweep.spec.ts src/components src/app
```

---

### Task 7: E2E — `oversight.spec.ts` and `rate-limit.spec.ts`

**Files:** create `e2e/oversight.spec.ts` (7), `e2e/rate-limit.spec.ts` (2).

House rules: reseed in `beforeAll` and at the end; copy `login`, `waitForHydration`, `expectNoSeriousAxe` from `e2e/transfers.spec.ts`; state-based waits; dialog-scoped clicks; toasts with `{ exact: true }`; DB facts via `PrismaClient` with `$disconnect`; the admin branch needs the `br.dept=admin` cookie with `path: "/"` (see `axe-sweep.spec.ts`'s comment); dates via `fmtDateTime` from `src/lib/format.ts`.

- [ ] **oversight.spec.ts** — 1 fresh seed: `/approvals?tab=closed` chips read `All 5`, `Applied directly 3`, `Through the queue 2` (group "Closed by route"); `via=direct` lists rows APR-2036, APR-2037, APR-2038 each with a `DIRECT` pill and not APR-2031/APR-2028; `via=queue` the inverse; the chip links' hrefs carry `via`, the tab links do not. 2 as `it@`: Change status on `BR-MN-0910` → DEFECTIVE (the `direct-lifecycle.spec.ts` case-1 flow); the new row has `appliedDirectly === true` in the DB, appears under `via=direct` with the pill; its detail page shows the meta `applied directly by J. Sarmiento` and the heading "How it was applied", and no "What the system checked". 3 APR-2031's detail still shows "What the system checked" and its row has no `DIRECT` pill. 4 as `admin@` with the admin cookie: `/` shows "Applied directly · last 7 days" with total equal to the DB count of `appliedDirectly` rows resolved in the last 7 days, the by-kind rows in the spec's order, "J. Sarmiento", and the link to `/approvals?tab=closed&via=direct`; the focus toggle is present; turning focus on hides the section. 5 as `admin@` without the cookie: `/` shows the section; as `it@` it does not. 6 double-count (P-5): claim APR-2040 for admin via Prisma; `/` as `admin@` shows APR-2040 in "Claimed by you" exactly once on the page and the Worklist's queue section does not list it; `/inventory/work` lists it. 7 axe on `/approvals?tab=closed&via=direct`, a direct detail, and `/` on the admin branch.
- [ ] **rate-limit.spec.ts** — spec §8's two cases; assert the notice by its title text and `/you can retry in \d+s/`; clean the `RateEvent` rows the case created before its second attempt; the import case reads the expected message from `src/server/modules/import/employee-actions.ts` (quote it in a comment).
- [ ] Run each file foreground until green, once more; `--list`; reseed. Commit: `test(e2e): approvals oversight -- closed-tab route chips and pill, direct detail card, admin Home section on both landings, one approval per screen, axe; rate limits -- mutation and import caps render the notice (9 cases; --list N / M files)`.

---

### Task 8: Battery, documentation, amendment block

- [ ] **Battery** — `npx tsc --noEmit`; `npx eslint .`; `npx vitest run` (record); `npx prisma migrate status` (22); `npx playwright test --list | tail -1`; six foreground chunks with explicit file paths, `E2E_PORT=3100 --workers=1 --global-timeout=540000`: A `it-core import-export purchases`; B `asset-classes department-owned auth-shell labels`; C `offboarding receiving paging home-finance approvals-audit`; D `admin direct-lifecycle scanner registration`; E `custody axe-sweep kitchen-sink suppliers purchasing-ext stock stocktake`; F `transfers directory offboarding-v2 it-gaps oversight rate-limit`. Zero failed, zero did-not-run; a failure is re-run once as-is, then diagnosed and fixed (test-only unless the controller rules otherwise) and both runs recorded.
- [ ] **Documents** — HANDOVER line 3 leading parenthetical for Phase 21 (CODE-COMPLETE, UNMERGED and UNPUSHED; spec, plan, `D-1`…`D-n`; battery; 22 migrations; `--list`); a new **(n)** block after (m) (~line 478 onward; what shipped per spec §2–§8, why, the battery, "What remains: merge/push and the staging redeploy are the user's decisions"); §0 item 9 (~line 651) totals, chunk list, correction history naming any pre-existing e2e file changed; PICKUP: Branch, Database (22 on the branch; main/staging at 21), a Battery row above Phase 20's, Last two phases (21 then 20), §4 item 1, §5 lines for the PENDING-row gap and the double-count closed; `HANDOVER-PENDING.md` §6 the direct-changes candidate closed; the plan's D-block above "## File structure" with every ledger ruling and P-1…P-6; the spec's Status line.
- [ ] Commit: `docs(handover,pickup,plan): Phase 21 code-complete -- battery N e2e / 29 files, M unit, 22 migrations; (n) block; D-1..D-n`.

---

## Self-review (writing-plans checklist, run 2026-09-14)

1. **Spec coverage.** §2 → Task 1; §3.1 → Task 1; §3.2–3.3 → Task 2; §4 → Task 3; §5 → Task 4; §6 → Task 5; §7 → Task 6; §8 → Task 7; §9 → Tasks 1, 4, 5, 7, 8; §10 → Task 8. No gap.
2. **Placeholders.** The Task 6 commit subject carries `<the attributed fixes>` by design — the detail run names them; everything else is exact.
3. **Type consistency.** `listApprovals(tab, via, userId, role, requestedPage)` (Task 2) ↔ the page (Task 2) ↔ `pagedSnapshot` adoption (Task 4) keeps the signature; `ApprovalRow.direct` (Task 2) ↔ `queue-table.tsx`; `directChanges` (Task 3) ↔ `DirectChangesBody`; `worklist(..., { excludeOwnClaims })` (Task 3) ↔ `page.tsx` and `/inventory/work`; `reasonRequired`/`reasonOptional` return `ZodString`-based schemas so `.default("")` chains hold (P-4); `PROMOTED_RULES` (Task 6) ↔ the four rule ids the sweep prints today.
