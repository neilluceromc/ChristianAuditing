# Inventory v2 — Session Handover

**Last updated:** 2026-08-16 · **main @ `22675ff`** · Phases 1–2 merged, Phases 3–8 remain.

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

## 4. What's DONE (Phases 1–2, on main)

**Phase 1 — Foundation:** design tokens (light/dark, motion, reduced-motion kill switch); six-family status system (`src/lib/status.ts`, `MISSING` is the 8th AssetStatus → fault family); full Prisma schema (5 migrations incl. append-only triggers on AuditEntry/NoteEntry, partial uniques, refNo sequences); seed; ~34 UI primitives in `src/components/ui/`; `/dev/kitchen-sink` review page (404s in prod); 5 Playwright+axe tests.

**Phase 2 — Auth + Shell:** Auth.js v5 (credentials; Entra registered only when fully configured, off by default); **three-layer authorization** — edge middleware (JWT-only) → DB-backed `requireUser`/`requireRole` (`src/server/auth/guards.ts`) → UI nav filtering, all from one truth module (`src/lib/workspaces.ts`, default-deny path gating); login/signup/bootstrap; four workspace sidebars + switcher (degrades to static label) + topbar + mobile left-drawer + ⌘K command palette; cookie-driven SSR theme/density/workspace. 80 unit + 20 e2e (axe on login and shell).

## 5. What REMAINS (Phases 3–8)

Each gets its own plan → subagent execution → review → merge. Scope from the spec §7 and brief §7.

- **Phase 3 — IT core.** `/inventory` list (filter/facet/sort/paginate/density/bulk-select→bulk drawer/export), `/inventory/new`, `/inventory/[id]` (tabs + DescriptionList), `/inventory/[id]/edit`, and record sub-tabs `history` (one row per field), `timeline`, `documents`, `secrets` (AUDITED — reveal writes SECRET_READ, 30s auto-hide), `reservations`; `/employees` list, `/employees/[id]` (**the loadout view** — slot grid vs policy, the distinctive screen), `/employees/[id]/edit` (M365 status select), `/employees/[id]/timeline`, `/employees/[id]/form` (printable accountability form); reference-data CRUD `/admin/asset-categories|asset-types|departments` (one table design, inline add row, locked Uncategorised).
- **Phase 4 — Approvals + audit.** `/approvals` queue (tabs Open/Mine/Unclaimed/Failed/Closed; keyboard J/K/C/A/R/E), `/approvals/[id]` (claim→approve; Approve only appears after claim; EXECUTION_FAILED gets its own card), the **worker process** (poll Job table `FOR UPDATE SKIP LOCKED`, set the lease `lockedAt` atomically, execute → EXECUTED/EXECUTION_FAILED), `/audit` (append-only, no row actions), activity feeds (one renderer, scoped variants).
- **Phase 5 — Purchasing.** `/purchases` (tabs write `?state=`), `/purchases/new` (multi-unit rows), `/purchases/[id]` (**the bounce-back is the design problem** — red banner, 4-stop stepper with dashed return path, per-unit states, append-only notes thread, IT slot editor / Finance unit editor inline), `/purchases/[id]/edit`, `/purchases/activity`.
- **Phase 6 — Finance + Home.** `/finance/assets`, `/finance/activity`; the role-aware Home dashboards (IT has NO KPI row — "Your shift", Fleet bar, Age histogram, Claimed-by-you, Warranty runway; Finance leads with money; Viewer minus mutating affordances) with **independently degrading sections** (Focus mode cookie).
- **Phase 7 — Offboarding + repairs + policies.** `/offboarding` + `/offboarding/[employeeId]` (4-step wizard; per-item Returned/Defective/Buyout/**Missing** segmented control, each creating its own `lifecycle.return` approval), repairs saved view (`?status=DEFECTIVE` + vendor fields, no new enum), `/reservations`, `/admin/equipment-policies`.
- **Phase 8 — Admin + import/export + polish.** `/admin/users` (locked permanent admin), `/admin/webhooks` + `/deliveries` (dead-letter replay), `/admin/flags`; import (3-step dry-run → commit, blocked rows grouped by cause), export (10,000-row cap, split-by-year), printable label sheet, USB-scanner behaviour, deployment README, full axe pass. **Entra SSO wiring** (needs tenant creds + a signIn callback mapping profile→User) also lands here or is explicitly deferred.

## 6. Phase 3 entry criteria (READ BEFORE STARTING — these are load-bearing)

Also recorded at the end of `docs/superpowers/plans/2026-08-16-phase-2-auth-shell.md`:

1. **Path gating is navigation-only, NOT write protection.** A viewer has *path* access to `/employees`, `/approvals`, `/inventory` etc. **Every Phase 3 server action must call `requireRole(...)` itself** (mirror `switchWorkspace`/`paletteSearch`). This is the #1 thing to get right.
2. **Fix the `EmploymentStatus` status-map collision before any employee status pill renders.** In `src/lib/status.ts`: `ACTIVE` collides with Reservation `ACTIVE` → renders *inflight* (should be *settled*); `OFFBOARDING`/`OFFBOARDED` are absent → fall through to *neutral* (should be *inflight*/*closed*). Namespace the lookup per entity, or give employment distinct values.
3. **Every mutating server action follows the spec's shape:** auth guard → **rate limit** (60/min per user via the `RateEvent` table — deferred from P2, lands now) → zod validation → domain call in a transaction with the audit write in the same transaction → `revalidatePath` → typed result (`ok|forbidden|rate_limited|validation|conflict`).
4. **Secrets:** `/inventory/[id]/secrets` is already gated to the IT workspace in path rules, but the reveal action needs its own `requireRole` + writes `SECRET_READ` audit + 30s auto-hide. Implement AES-256-GCM using `SECRET_ENCRYPTION_KEY` (env; add a real key to `.env`).
5. **URL is the source of truth for list state** (filters/sort/page/tab in query params) — fixed contract, don't break it. Column visibility/order is per-user preference (`UserPreference` table), NOT URL. `paletteSearch` needs query-level gating + rate limiting.
6. **Client-island rule:** `Table`'s `onSort`/`Tr onClick` and form-control handlers require a **client** caller — extract client islands for the inventory table's sorting/selection; the page/layout stays a server component.

## 7. Recurring gotchas that have cost real time

- **Prisma `mode: "insensitive"` on an identity/`equals` field compiles to ILIKE** and makes `%`/`_` wildcards — caused an auth bypass (login) AND an enumeration oracle (signup). **Use `findUnique` on the normalized (lowercased) email.** `contains`-search (palette) with insensitive mode is fine.
- **Installing any npm package on Windows** drops the Linux optional-dep trees (`@tailwindcss/oxide-wasm32-wasi`, `@emnapi/*`) from `package-lock.json`, breaking the Alpine prod `npm ci`. Fix: regenerate inside Linux —
  `docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only --no-audit --no-fund"`, commit the lockfile.
- **`auth()` immediately after `signIn(..., {redirect:false})` in the same server action returns a stale/empty session** — read what you need from the DB instead (login redirect does `findUnique` by email for the role landing).
- **Browser-pane quirks:** synthetic `computer key Return`/`.click()` sometimes don't reach React handlers; use `form.requestSubmit()` / dispatch a real `KeyboardEvent`, or rely on Playwright (real trusted events). Screenshot clicks use the **screenshot's** coordinate frame; ref coordinates can be stale after a resize — re-read the page. The sidebar only renders at `lg:` width — set a 1280px viewport to see it.
- **Reviewers may stop the controller's dev server.** After a review round, `preview_list` and restart if needed before the next live check.
- **`design_handover/` is git-ignored from lint/build** and must stay untouched — it's the source of truth, not code.

## 8. Deferred / out-of-scope (tracked, don't lose)

- Rate limiting (starts Phase 3). Entra SSO real wiring (Phase 8 / when tenant creds exist). Real product photography, brand mark, barcode generation (placeholders now). Off-device backups (nightly `pg_dump` to a local volume ships; copying elsewhere is the user's call). HR review of the accountability-form copy. `WebhookEndpoint.secret` encryption (Phase 8). CI workflow + jsdom component tests (declined in P1, revisitable).
