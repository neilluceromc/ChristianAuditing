# Inventory v2 — Session Handover

**Last updated:** 2026-08-17 · Phases 1–3 merged to main, Phases 4–8 remain.

This is the pick-up doc for a fresh session. Read this, then the spec
(`docs/superpowers/specs/2026-08-14-inventory-v2-design.md`) and the two design-handover
files (`design_handover/original-brief.md` = what each screen does; `design_handover/README.md`
= how it looks + tokens). The client's 39 routes are enumerated in the brief §7.

---

## 1. What this project is

Building "Backroom IT — Inventory v2" from scratch: an internal IT asset-management app
(purchase → assignment → repair → disposal) with an approval queue, an append-only audit
trail, four role-gated workspaces, and an offboarding wizard. **Recreating a high-fidelity
HTML design prototype in a real Next.js codebase** — not porting the prototype's markup.

- **Repo:** github.com/neilluceromc/ChristianAuditing (**PUBLIC** — never commit secrets or the `.env`)
- **Stack:** Next.js 15 App Router · PostgreSQL 16 (Docker) · Prisma 6 · Auth.js v5 · Tailwind v4 (CSS-var tokens)
- **Deploy:** single machine (user's own device), one Docker Compose stack: `docker compose --profile prod up`

## 2. How we work (follow this exactly)

One **plan per phase** under `docs/superpowers/plans/`, executed **subagent-driven**:

1. Write the phase plan with the `superpowers:writing-plans` skill (bite-sized tasks, full verbatim code in each).
2. Execute with `superpowers:subagent-driven-development`: **fresh implementer subagent per task**, then review. Small/verbatim tasks get one fresh-eyes spec review; security- or logic-critical tasks get an **opus quality review** (the reviews have caught every real defect — an auth bypass, fail-open gating, an enumeration oracle, a focus-trap that never installed).
3. **The controller (you) applies review fixes** for small, well-understood defects directly and verifies live in the browser; larger fixes go back to the implementer subagent.
4. **Amend the plan doc whenever code deviates** (commit as `docs(plan): …`) so the plan never drifts from the code.
5. Finish each phase with `superpowers:finishing-a-development-branch` → merge to main, delete branch.

**Branch per phase:** `phase-N-<name>`. Commit style `feat(scope): …` / `fix(scope): …`. Co-author trailer:
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 3. Environment / how to run

- **DB:** `docker compose up -d db` (container `inventory-db-1`, healthy). Seed: `npm run db:seed` (idempotent TRUNCATE+reseed — the sanctioned reset; **`prisma migrate reset` is blocked by the harness classifier and unnecessary**).
- **Dev app:** never via Bash — use the Browser-pane preview (`preview_start` with the `app-dev` config in `.claude/launch.json`, port 3000). The controller manages this server; subagents can't start it.
- **NEVER run `npm run build` while a dev server is running** — they share `.next` and it bricks the dev server (500s until restart).
- **A new root file** like `middleware.ts` is **not hot-registered** by a running dev server — restart it. Middleware **must live at `src/middleware.ts`** (this is a `src/`-dir project; a repo-root one is silently ignored).
- **Full battery:** `npx tsc --noEmit && npm run lint && npm run test && npm run build`, then `npm run db:seed && npm run e2e`.
- **Seeded accounts** (all password `ChangeMe123!`): `admin@` (admin, permanent) · `it@` (it_staff) · `purchasing@` (purchasing_staff) · `finance@` (finance_staff) · `viewer@` (viewer) — all `@thebackroomop.com`. Seed has 22 assets (all 8 statuses), 7 approvals (all 6 states, 1 past SLA → badge shows "3, urgent"), 5 PRs (one per state, PR-0198 is a bounce-back thread), 4 reservations.

## 4. What's DONE (Phases 1–3, on main)

**Phase 1 — Foundation:** design tokens (light/dark, motion, reduced-motion kill switch); six-family status system (`src/lib/status.ts`, `MISSING` is the 8th AssetStatus → fault family); full Prisma schema (5 migrations incl. append-only triggers on AuditEntry/NoteEntry, partial uniques, refNo sequences); seed; ~34 UI primitives in `src/components/ui/`; `/dev/kitchen-sink` review page (404s in prod); 5 Playwright+axe tests.

**Phase 2 — Auth + Shell:** Auth.js v5 (credentials; Entra registered only when fully configured, off by default); **three-layer authorization** — edge middleware (JWT-only) → DB-backed `requireUser`/`requireRole` (`src/server/auth/guards.ts`) → UI nav filtering, all from one truth module (`src/lib/workspaces.ts`, default-deny path gating); login/signup/bootstrap; four workspace sidebars + switcher (degrades to static label) + topbar + mobile left-drawer + ⌘K command palette; cookie-driven SSR theme/density/workspace. 80 unit + 20 e2e (axe on login and shell).

**Phase 3 — IT core** (plan: `docs/superpowers/plans/2026-08-16-phase-3-it-core.md`, incl. all recorded deviations): the full `/inventory` surface (list with facets/sort/chips/bulk-select→approval-creating bulk drawer/CSV export/column prefs, new, record with Overview/History/Timeline/Documents/Secrets/Reservations tabs, edit), the full `/employees` surface (list with Items+Loadout columns, the loadout view with slot grid + fill/return via approvals, edit with M365 canonical+custom, timeline, printable accountability form), and reference-data CRUD ×3. **New server conventions every later phase must follow:** `ActionResult` union + `actionRole`/`actionUser` no-redirect guards (`src/server/action-result.ts`, `guards.ts`) · `checkRate` (60/min RateEvent, self-pruning) · `writeAudit(tx, …)` + `diffOf` (day-precision date handling in updateAsset is the template) · `createApproval`/`openApprovalForAsset`/`newSlaAt` over `approval_ref_seq` · URL list state via `src/lib/url-state.ts` · secrets AES-256-GCM **v1: base64(version‖iv‖tag‖data), AAD = "assetId:label"** · `Approval_one_open_per_asset` partial unique index (catch P2002 → conflict). 150 unit + 39 e2e.

## 5. What REMAINS (Phases 4–8)

Each gets its own plan → subagent execution → review → merge. Scope from the spec §7 and brief §7.

- **Phase 4 — Approvals + audit.** `/approvals` queue (tabs Open/Mine/Unclaimed/Failed/Closed; keyboard J/K/C/A/R/E), `/approvals/[id]` (claim→approve; Approve only appears after claim; EXECUTION_FAILED gets its own card), the **worker process** (poll Job table `FOR UPDATE SKIP LOCKED`, set the lease `lockedAt` atomically, execute → EXECUTED/EXECUTION_FAILED), `/audit` (append-only, no row actions), activity feeds (one renderer, scoped variants).
- **Phase 5 — Purchasing.** `/purchases` (tabs write `?state=`), `/purchases/new` (multi-unit rows), `/purchases/[id]` (**the bounce-back is the design problem** — red banner, 4-stop stepper with dashed return path, per-unit states, append-only notes thread, IT slot editor / Finance unit editor inline), `/purchases/[id]/edit`, `/purchases/activity`.
- **Phase 6 — Finance + Home.** `/finance/assets`, `/finance/activity`; the role-aware Home dashboards (IT has NO KPI row — "Your shift", Fleet bar, Age histogram, Claimed-by-you, Warranty runway; Finance leads with money; Viewer minus mutating affordances) with **independently degrading sections** (Focus mode cookie).
- **Phase 7 — Offboarding + repairs + policies.** `/offboarding` + `/offboarding/[employeeId]` (4-step wizard; per-item Returned/Defective/Buyout/**Missing** segmented control, each creating its own `lifecycle.return` approval), repairs saved view (`?status=DEFECTIVE` + vendor fields, no new enum), `/reservations`, `/admin/equipment-policies`.
- **Phase 8 — Admin + import/export + polish.** `/admin/users` (locked permanent admin), `/admin/webhooks` + `/deliveries` (dead-letter replay), `/admin/flags`; import (3-step dry-run → commit, blocked rows grouped by cause), export (10,000-row cap, split-by-year), printable label sheet, USB-scanner behaviour, deployment README, full axe pass. **Entra SSO wiring** (needs tenant creds + a signIn callback mapping profile→User) also lands here or is explicitly deferred.

## 6. Phase 4 entry criteria (READ BEFORE STARTING — these are load-bearing)

1. **The worker MUST re-validate before executing.** A `lifecycle_assign` approval can sit for its 48h SLA while the world changes: re-check `employee.employment === "ACTIVE"`, the asset still exists and is still assignable, inside the execution transaction. Store failures verbatim in `workerError` → `EXECUTION_FAILED` (the seed's APR-2025 shows the designed message shape). Request-time checks in Phase 3 actions are advisory only.
2. **Phase 3 is already producing real Approval rows** (bulk + single status changes, assigns, returns). The queue page renders them; the worker executes them: assign → set assigneeId + status from payload; return → clear assignee + SPARE; change-status → set status. Every execution writes the asset diff to AuditEntry in the same transaction.
3. **`Approval_one_open_per_asset`** (partial unique index, migration `20260817001000`): one PENDING/CLAIMED/APPROVED approval per asset, DB-enforced. Approve/reject/execute transitions never violate it, but any NEW approval-creating action must catch P2002 → typed conflict.
4. **Queue actions follow the Phase 3 action shape** (`actionRole` → `checkRate` → zod → tx+audit → revalidate → `ActionResult`) and the state machine from the brief §6.2 — claim only from PENDING, approve only by the claim owner, reject needs a reason, escalate changes priority not state. Build `approvalTransition(state, action, ctx)` as a pure TDD'd function first.
5. **Activity feeds replace the two placeholder pages** (`/inventory/activity`, `/employees/activity` — real static pages exist so the `[id]` routes don't swallow them; replace their bodies, keep the paths). One ActivityFeed renderer; the domain pill is the only difference between scoped and cross-domain feeds.
6. **The sidebar badge already counts PENDING/CLAIMED + past-SLA** (`getApprovalsBadge`); approving must decrement it only after the row leaves — revalidate the shell path.

## 7. Recurring gotchas that have cost real time

- **Prisma `mode: "insensitive"` on an identity/`equals` field compiles to ILIKE** and makes `%`/`_` wildcards — caused an auth bypass (login) AND an enumeration oracle (signup). **Use `findUnique` on the normalized (lowercased) email.** `contains`-search (palette) with insensitive mode is fine.
- **Installing any npm package on Windows** drops the Linux optional-dep trees (`@tailwindcss/oxide-wasm32-wasi`, `@emnapi/*`) from `package-lock.json`, breaking the Alpine prod `npm ci`. Fix: regenerate inside Linux —
  `docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only --no-audit --no-fund"`, commit the lockfile.
- **`auth()` immediately after `signIn(..., {redirect:false})` in the same server action returns a stale/empty session** — read what you need from the DB instead (login redirect does `findUnique` by email for the role landing).
- **Browser-pane quirks:** synthetic `computer key Return`/`.click()` sometimes don't reach React handlers; use `form.requestSubmit()` / dispatch a real `KeyboardEvent`, or rely on Playwright (real trusted events). Screenshot clicks use the **screenshot's** coordinate frame; ref coordinates can be stale after a resize — re-read the page. The sidebar only renders at `lg:` width — set a 1280px viewport to see it.
- **Reviewers may stop the controller's dev server.** After a review round, `preview_list` and restart if needed before the next live check.
- **`design_handover/` is git-ignored from lint/build** and must stay untouched — it's the source of truth, not code.
- **Non-component exports from a `"use client"` module are NOT values on the server** — a server page importing an array from a client file gets a reference proxy and crashes at runtime (tsc/lint don't catch it). Shared constants live in `src/lib/`.
- **Reseeding invalidates every session** (new user ids). Stale JWTs escape via `GET /logout` (clears the cookie) — `requireUser` redirects there; without it the login bounce loops forever.
- **Playwright must run `--workers=1`**: the spec files share one DB; auth-shell asserts the exact seeded badge count while it-core creates approvals.
- **Prisma interactive transactions default to a 5s budget** — batch per-row loops (`createMany`, one `generate_series` nextval call) instead of N sequential round trips.

## 8. Deferred / out-of-scope (tracked, don't lose)

- Rate limiting (starts Phase 3). Entra SSO real wiring (Phase 8 / when tenant creds exist). Real product photography, brand mark, barcode generation (placeholders now). Off-device backups (nightly `pg_dump` to a local volume ships; copying elsewhere is the user's call). HR review of the accountability-form copy. `WebhookEndpoint.secret` encryption (Phase 8). CI workflow + jsdom component tests (declined in P1, revisitable).
