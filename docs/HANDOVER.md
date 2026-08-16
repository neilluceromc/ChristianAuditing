# Inventory v2 — Session Handover

**Last updated:** 2026-08-17 · **main @ `21809e0`** (127 commits) · **Phases 1–4 merged, 5–8 remain.**

This is the pick-up doc for a fresh session. Read this first, then the spec
(`docs/superpowers/specs/2026-08-14-inventory-v2-design.md`) and the two design-handover files
(`design_handover/original-brief.md` = what each screen does; `design_handover/README.md` = how it
looks + tokens). The client's 39 routes are enumerated in the brief §7; 27 pages + 4 route handlers
exist today.

---

## 0. Start here (next session, in order)

1. `docker compose up -d db` → `npm run db:seed` → open the preview (`preview_start` name `app-dev`).
2. Read §6 (Phase 5 entry criteria) — they are load-bearing and were written while the reasoning was fresh.
3. Write the Phase 5 plan with `superpowers:writing-plans` → `docs/superpowers/plans/2026-08-1X-phase-5-purchasing.md`.
4. Execute it with `superpowers:subagent-driven-development` on branch `phase-5-purchasing`.

Nothing is half-finished. main is green: `tsc` · `lint` · **185 unit** · `next build` · **51 e2e**.

---

## 1. What this project is

Building "Backroom IT — Inventory v2" from scratch for The Backroom Offshoring: an internal IT
asset-management app (purchase → assignment → repair → disposal) with an approval queue, an
append-only audit trail, four role-gated workspaces, and an offboarding wizard. **We are recreating
a high-fidelity HTML design prototype in a real Next.js codebase** — not porting the prototype's markup.

- **Repo:** github.com/neilluceromc/ChristianAuditing (**PUBLIC** — never commit secrets or `.env`)
- **Stack:** Next.js 15 App Router · PostgreSQL 16 (Docker) · Prisma 6 · Auth.js v5 · Tailwind v4 (CSS-var tokens)
- **Deploy:** single machine (the user's own device), one Docker Compose stack: `docker compose --profile prod up`
- **Machine:** Windows 11 · Node 24 · Docker Desktop · Postgres as container `inventory-db-1` (compose project `inventory`, loopback-only 127.0.0.1:5432)

## 2. How we work (follow this exactly — it is load-bearing, not ceremony)

One **plan per phase** under `docs/superpowers/plans/`, executed **subagent-driven**:

1. Write the phase plan with `superpowers:writing-plans` — bite-sized tasks, **full verbatim code in every step**, recorded scope decisions up front, entry criteria mapped to tasks.
2. Execute with `superpowers:subagent-driven-development`: **fresh implementer subagent per task** (paste the full task text into the prompt — never "go read the plan"), then review. Small/verbatim tasks get one fresh-eyes **spec review (sonnet)**; security-, concurrency- or logic-critical tasks get an **opus quality review**.
3. **The controller applies review fixes** for small, well-understood defects directly and verifies live in the Browser pane; larger fixes go back to an implementer subagent.
4. **Amend the plan doc whenever code deviates** (commit as `docs(plan): …`) so the plan never lies to a future reader.
5. Finish with `superpowers:finishing-a-development-branch` → merge to main, delete branch, push.

**Models:** sonnet implementers and spec reviewers; opus for quality reviews of anything that moves
data or gates access. **Verbatim implementers transfer plan defects wholesale — the reviews are where
correctness actually comes from.** Across four phases they caught: a working auth bypass (`a%` in the
email field logging in as admin), a fail-open authorization default, a signup enumeration oracle, a
focus trap that never installed, a bulk transaction that would time out at its own documented cap,
phantom audit entries on every first edit of a seeded asset, ciphertext that wasn't bound to its row,
and an execution path that could strand an approval in APPROVED forever.

**Recorded deviation from the skills:** work happens **in-place on a `phase-N-<name>` branch**, not a
git worktree — the repo root IS the app root and this is a single workstream. Commit style
`feat(scope): …` / `fix(scope): …` / `docs(plan): …`, co-author trailer
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 3. Environment / how to run

- **DB:** `docker compose up -d db`. Seed: `npm run db:seed` (TRUNCATE + reseed — the sanctioned reset; **`prisma migrate reset` is blocked by the harness classifier and unnecessary**). 6 migrations; add new ones as hand-written SQL dirs + `prisma migrate dev`.
- **Dev app:** never via Bash — use the Browser-pane preview (`preview_start` name `app-dev`, port 3000). The controller owns this server; subagents must not start one.
- **Worker:** `npm run worker` (poll loop) or `npm run worker:once` (drain and exit — what e2e uses). In prod it's the compose `worker` service.
- **NEVER run `npm run build` while a dev server is running** — they share `.next` and it bricks the dev server.
- **Full battery:** `npx tsc --noEmit && npm run lint && npm run test && npm run build`, then `npm run db:seed && npx playwright test --workers=1`.
- **Seeded accounts** (all `@thebackroomop.com`, password `ChangeMe123!`): `admin@` (admin, permanent) · `it@` (it_staff) · `purchasing@` (purchasing_staff) · `finance@` (finance_staff) · `viewer@` (viewer).
- **Seed contents:** 22 assets (all 8 statuses), 10 employees (Marites EMP-0042 holds 4 items against the only equipment policy → 1 gap; Dennis EMP-0090 is OFFBOARDING; Nina EMP-0097 has a reserved monitor), 7 approvals (all 6 states; APR-2040 past SLA → badge reads "3, urgent"; APR-2035 is APPROVED with a **deliberately malformed payload** + a queued job — the worker's EXECUTION_FAILED demo), 5 PRs (one per state; **PR-0198 is the bounce-back with a three-party note thread** — Phase 5's fixture), 4 reservations.

## 4. What's DONE (Phases 1–4, on main)

**Phase 1 — Foundation:** design tokens (light/dark, motion, reduced-motion kill switch); six-family
status system (`src/lib/status.ts`; `MISSING` is the 8th AssetStatus → fault); full Prisma schema
(append-only triggers on AuditEntry/NoteEntry, partial uniques, refNo sequences); seed; ~34 UI
primitives in `src/components/ui/`; `/dev/kitchen-sink` (404s in prod).

**Phase 2 — Auth + Shell:** Auth.js v5 (credentials; Entra registered only when fully configured);
**three-layer authorization** — edge middleware (JWT-only) → DB-backed `requireUser`/`requireRole` →
UI nav filtering, all from one truth module (`src/lib/workspaces.ts`, default-deny path gating);
login/signup/bootstrap; four workspace sidebars + switcher + topbar + mobile drawer + ⌘K palette;
cookie-driven SSR theme/density/workspace.

**Phase 3 — IT core** (`docs/superpowers/plans/2026-08-16-phase-3-it-core.md`): the full `/inventory`
surface (facets/sort/chips/bulk-select → approval-creating bulk drawer/CSV export/column prefs; new;
record with Overview/History/Timeline/Documents/Secrets/Reservations; edit), the full `/employees`
surface (Items+Loadout columns, **the loadout view**, edit with M365 canonical+custom, timeline,
printable accountability form), reference-data CRUD ×3.

**Phase 4 — Approvals + audit** (`docs/superpowers/plans/2026-08-17-phase-4-approvals-audit.md`): the
claim-based queue (five tabs, J/K/C/A/R/E + screen-reader live region), the detail page (live system
checks, Approve-only-after-claim, background-pending + EXECUTION_FAILED cards with verbatim worker
errors, Retry), **the worker** (atomic `FOR UPDATE SKIP LOCKED` lease, stale recovery, `--once`,
per-type live re-validation inside the execution tx, state-guarded terminal writes, catch-all →
EXECUTION_FAILED so nothing strands in APPROVED), `/audit` (zero row actions by design), and the
ActivityFeed renderer powering the two scoped feeds.

### Conventions every later phase must follow

| Concern | Where |
|---|---|
| Mutation shape | `actionRole` guard → `checkRate` → zod → tx (domain write + `writeAudit` together) → `revalidatePath` → `ActionResult` |
| Typed results / guards | `src/server/action-result.ts` · `src/server/auth/guards.ts` (`actionRole`/`actionUser` return null, never redirect) |
| Audit | `writeAudit(tx, …)` + `diffOf` — day-precision date compare in `updateAsset` is the template for avoiding phantom diffs |
| State machines | Pure + TDD'd first (`src/lib/approval-flow.ts` is the template), called via **state-guarded `updateMany`** (count 0 → conflict) |
| List state | URL search params via `src/lib/url-state.ts`; column prefs are per-user DB rows, never URL |
| Lifecycle changes | Never a direct asset write — create an Approval; the worker executes it |
| Secrets | AES-256-GCM **v1: base64(version‖iv‖tag‖data), AAD = `"assetId:label"`** |
| DB invariants to catch (P2002 → typed conflict) | `Approval_one_open_per_asset` (one open approval per asset) · `Job_one_live_execute_per_approval` (one live execute-job per approval) · `Reservation_one_active_hold_per_asset` |

## 5. What REMAINS (Phases 5–8)

- **Phase 5 — Purchasing.** `/purchases` (tabs write `?state=`), `/purchases/new` (multi-unit editable rows, autosaved DRAFT, "add from a policy loadout"), `/purchases/[id]` (**the bounce-back is the design problem**), `/purchases/[id]/edit`, `/purchases/activity`.
- **Phase 6 — Finance + Home.** `/finance/assets`, `/finance/activity`; role-aware Home dashboards (IT has **no KPI row** — "Your shift", Fleet bar, Age histogram, Claimed-by-you, Warranty runway; Finance leads with money; Viewer minus mutating affordances) with **independently degrading sections** + Focus mode cookie.
- **Phase 7 — Offboarding + repairs + policies.** `/offboarding` + the 4-step wizard (per-item Returned/Defective/Buyout/**Missing**, each creating its own `lifecycle.return` approval — the Phase 4 pipeline already executes these), repairs saved view (`?status=DEFECTIVE` + vendor fields, no new enum), `/reservations`, `/admin/equipment-policies`.
- **Phase 8 — Admin + import/export + polish.** `/admin/users` (locked permanent admin), `/admin/webhooks` + `/deliveries` (dead-letter replay — **the worker currently dead-letters DELIVER_WEBHOOK jobs with "ships in Phase 8"**), `/admin/flags`; import (3-step dry-run → commit, blocked rows grouped by cause), export upgrade (real Excel + split-by-year chips), printable label sheet, USB-scanner polish, deployment README, full axe pass. Entra SSO wiring lands here or is explicitly deferred.

## 6. Phase 5 entry criteria (READ BEFORE STARTING — load-bearing)

1. **`purchaseTransition(state, action, role)` is a pure TDD'd function FIRST** (mirror `src/lib/approval-flow.ts`), encoding brief §6.1 exactly: submit only from DRAFT (stamps `submittedAt`) · it-review only from SUBMITTED (stamps reviewer) · it-reject SUBMITTED→**DRAFT** with the reason **appended** · request-info only IT_REVIEWED→SUBMITTED (Finance's bounce-back) · cancel from any non-terminal state, reason required · complete only from IT_REVIEWED. Server actions are its only callers, via state-guarded `updateMany` (Phase 4's `transition()` skeleton in `src/server/modules/approvals/actions.ts` is the template — copy its shape including the P2002 catch).
2. **NoteEntry is the only notes surface — append-only, enforced by a DB trigger.** Every transition carrying a reason APPENDS a NoteEntry (kinds SUBMIT/IT_REVIEW/IT_REJECT/REQUEST_INFO/CANCEL/COMPLETE); free comments use COMMENT. Never an overwritable text column. Seeded PR-0198 already carries a three-party thread to build against.
3. **The bounce-back is THE design problem** (README `1j`): red-left-bordered banner naming who sent it back, when, the verbatim reason, and `IT_REVIEWED → SUBMITTED · nothing was cleared`; a 4-stop stepper whose return path is a dashed amber/red connector labeled "← sent back"; `SUBMITTED` marked `NOW · 2nd time`. Header state and per-unit states must read together.
4. **`?state=` is the tab contract** — the sidebar's "By status" links already target it and `navIsActive` already highlights them. Don't break either.
5. **Role surfaces share one detail page:** IT slot editor and Finance unit editor render inline for their roles; **saving a unit does NOT re-submit the request**. Purchasing edits only DRAFTs. Path gating is workspace-level (purchasing + finance); the **actions** carry per-operation `actionRole` (submit/edit = purchasing_staff+admin; it-review/it-reject = it_staff+admin; request-info/complete = finance_staff+admin).
6. **These are PR-state transitions, NOT Approval rows.** The Approval table stays lifecycle-only; nothing in Phase 5 enqueues worker jobs.
7. **`/purchases/activity`** reuses the Phase 4 `ActivityFeed`, scoped to `entityType: "purchase-request"` — write purchase audit rows with that entityType from the start, and extend `entityLabels` (`src/server/modules/audit/queries.ts`) + `AUDIT_ENTITY_TYPES` (`src/lib/audit-list.ts`) so `/audit` resolves them to refNo links.
8. **Money:** `PurchaseUnit.unitPrice` is `Decimal(12,2)`. Reuse Phase 3's lesson — `step="0.01"` + `inputMode="decimal"` on inputs and `.multipleOf(0.01)` in zod, or centavos become unenterable and the audit records a value Postgres never stored.

## 7. Recurring gotchas that have cost real time

- **Prisma `mode: "insensitive"` on an identity/`equals` field compiles to ILIKE**, making `%`/`_` wildcards — caused an auth bypass AND an enumeration oracle. Use `findUnique` on a normalized value. `contains`-search is the sanctioned use.
- **Installing any npm package on Windows** drops the Linux optional-dep trees (`@tailwindcss/oxide-wasm32-wasi`, `@emnapi/*`) from `package-lock.json` and breaks the Alpine prod `npm ci`. Regenerate inside Linux: `docker run --rm -v "$PWD:/app" -w //app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only --no-audit --no-fund"` (Git Bash needs `MSYS_NO_PATHCONV=1` and `//app`).
- **`auth()` immediately after `signIn(…, {redirect:false})`** in the same action returns a stale session — read from the DB instead.
- **Non-component exports from a `"use client"` module are not values on the server** — a server page importing an array from a client file gets a reference proxy and crashes at runtime; tsc and lint both pass. Shared constants live in `src/lib/`.
- **Reseeding invalidates every session** (new user ids). Stale JWTs escape via `GET /logout`, which clears the cookie; `requireUser` redirects there. Without it the login bounce loops forever.
- **Playwright: `--workers=1`, and every DB-touching spec file reseeds in `beforeAll`** — the files share one database and alphabetical order otherwise leaks state (approvals-audit deploys an asset and drains the badge that auth-shell asserts).
- **Prisma interactive transactions default to a 5s budget** — batch per-row loops (`createMany`, one `generate_series` nextval call) instead of N sequential round trips.
- **Seed payloads must mirror what the real producers write.** A seeded approval using `to.assignee` (an employeeNo) instead of `to.assigneeId` (a row id) made the happy-path demo item fail execution honestly but confusingly.
- **CSS syntax errors only surface at `npm run build`** — tsc and lint sail past a stray brace. That's what the full battery is for; run it before every merge.
- **Reviewers are usually right but occasionally wrong about repo facts.** One review asserted a migration didn't exist when it did. Verify claims against the migrations and the live DB before acting on them — then fix the real finding underneath.
- **Browser-pane quirks:** synthetic clicks often don't reach React handlers — dispatch a real bubbling `MouseEvent`/`KeyboardEvent` from `javascript_tool`, or use `form.requestSubmit()`. The sidebar only renders at `lg:` — use a 1280px viewport. Background reviewers may stop the dev server; `preview_list` and restart before the next live check.
- **`design_handover/` is excluded from lint/build** and must stay untouched — it's the source of truth, not code.

## 8. Deferred / out-of-scope (tracked, don't lose)

- **Phase 4 leftovers:** `/approvals` shows the first 50 rows of a tab with a "showing N of M" hint but no pagination; no admin surface reads the `Job` table (Phase 8's deliveries page is the natural home); the worker's stale-lease recovery uses a 5-minute wall-clock heuristic (safe now because every terminal write is state-guarded).
- **Phase 3 leftovers:** CSV export buffers up to 10k rows in memory and silently truncates `?ids=` beyond 500; sort remount drops keyboard focus to `<body>`; `EntityCombobox` lacks a listbox accessible name and Home/End.
- Entra SSO real wiring (needs tenant creds). Real product photography, brand mark, barcode generation (striped placeholders today). Off-device backups (nightly `pg_dump` to a local volume ships; copying elsewhere is the user's call). HR review of the accountability-form acknowledgement copy. `WebhookEndpoint.secret` encryption (Phase 8). CI workflow + jsdom component tests (declined in Phase 1, revisitable).
