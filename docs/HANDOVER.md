# Inventory v2 — Session Handover

**Last updated:** 2026-08-17 · **main @ phase-5 merge** · **Phases 1–5 merged, 6–8 remain.**

This is the pick-up doc for a fresh session. Read this first, then the spec
(`docs/superpowers/specs/2026-08-14-inventory-v2-design.md`) and the two design-handover files
(`design_handover/original-brief.md` = what each screen does; `design_handover/README.md` = how it
looks + tokens). The client's 39 routes are enumerated in the brief §7; 27 pages + 4 route handlers
exist today.

---

## 0. Start here (next session, in order)

1. `docker compose up -d db` → `npm run db:seed` → open the preview (`preview_start` name `app-dev`).
2. Read §6 (Phase 6 entry criteria) — they are load-bearing and were written while the reasoning was fresh.
3. Write the Phase 6 plan with `superpowers:writing-plans` → `docs/superpowers/plans/2026-08-1X-phase-6-finance-home.md`.
4. Execute it with `superpowers:subagent-driven-development` on branch `phase-6-finance-home`.

Nothing is half-finished. main is green: `tsc` · `lint` · **255 unit** · `next build` · **63 e2e**.

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
- **Seed contents:** 22 assets (all 8 statuses), 10 employees (Marites EMP-0042 holds 4 items against the only equipment policy → 1 gap; Dennis EMP-0090 is OFFBOARDING; Nina EMP-0097 has a reserved monitor), 7 approvals (all 6 states; APR-2040 past SLA → badge reads "3, urgent"; APR-2035 is APPROVED with a **deliberately malformed payload** + a queued job — the worker's EXECUTION_FAILED demo), 5 PRs (one per state; **PR-0198 is the bounce-back with a three-party note thread**, still the fixture the purchasing e2e leans on; `purchase_request_ref_seq` sits at 201 so the first drafted ref is PR-0202), 4 reservations.

## 4. What's DONE (Phases 1–5, on main)

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

**Phase 5 — Purchasing** (`docs/superpowers/plans/2026-08-17-phase-5-purchasing.md`): the three-party handoff made real —
`purchaseTransition` (brief §6.1, pure + TDD) driving six state-guarded server actions, each appending a **NoteEntry**
in the same transaction; `/purchases` (tabs write `?state=`, dwell second line under State), `/purchases/new` +
`/purchases/[id]/edit` (multi-unit editable rows, autosaved DRAFT created by the first save, "add from a policy
loadout", centavo-safe prices), `/purchases/[id]` (**the bounce-back**: red-left-bordered banner naming who sent it
back with the verbatim reason and `IT_REVIEWED → SUBMITTED · nothing was cleared`, a 4-stop stepper whose return path
is a dashed "← sent back" connector, `NOW · 2nd time`, per-unit states, the IT slot editor and Finance unit editor
inline), and `/purchases/activity`. **IT gained access to `/purchases`** — brief §6.1 makes IT the second party, and
`it-review`/`it-reject` were otherwise unreachable for `it_staff` (see §7).

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
| Purchase transitions | `runTransition` in `src/server/modules/purchases/actions.ts` — pure check → state-guarded `updateMany` → **NoteEntry append** → `writeAudit`, all in one tx; `asActionResult` maps P2028 → conflict |
| Partial updates | Write **only the fields the caller sent**, and put each written field's before-value in the `updateMany` guard — filling untouched fields from the row you read loses concurrent edits silently (Phase 5's `saveUnit`) |
| DB invariants to catch (P2002 → typed conflict) | `Approval_one_open_per_asset` (one open approval per asset) · `Job_one_live_execute_per_approval` (one live execute-job per approval) · `Reservation_one_active_hold_per_asset` |

## 5. What REMAINS (Phases 6–8)

- **Phase 6 — Finance + Home.** `/finance/assets`, `/finance/activity`; role-aware Home dashboards (IT has **no KPI row** — "Your shift", Fleet bar, Age histogram, Claimed-by-you, Warranty runway; Finance leads with money; Viewer minus mutating affordances) with **independently degrading sections** + Focus mode cookie.
- **Phase 7 — Offboarding + repairs + policies.** `/offboarding` + the 4-step wizard (per-item Returned/Defective/Buyout/**Missing**, each creating its own `lifecycle.return` approval — the Phase 4 pipeline already executes these), repairs saved view (`?status=DEFECTIVE` + vendor fields, no new enum), `/reservations`, `/admin/equipment-policies`.
- **Phase 8 — Admin + import/export + polish.** `/admin/users` (locked permanent admin), `/admin/webhooks` + `/deliveries` (dead-letter replay — **the worker currently dead-letters DELIVER_WEBHOOK jobs with "ships in Phase 8"**), `/admin/flags`; import (3-step dry-run → commit, blocked rows grouped by cause), export upgrade (real Excel + split-by-year chips), printable label sheet, USB-scanner polish, deployment README, full axe pass. Entra SSO wiring lands here or is explicitly deferred.

## 6. Phase 6 entry criteria (READ BEFORE STARTING — load-bearing)

1. **Every Home section degrades independently** (brief §7, README `1d`/`5d`) — one failing query must not blank the page. Wrap each section in its own boundary and design the FAILED state: a card with a `FAILED` pill, a plain explanation, and "Retry this section", while everything else renders. Build the degraded state first, not last; it is the requirement that shapes the composition.
2. **IT Home has NO KPI tile row** — deliberate (README): "742 deployed" is a number nobody acts on, and it was occupying the most valuable strip. IT Home is: **Your shift** (5 rows ordered by *what breaks first*, each with a 52px kind chip `SLA`/`EXEC`/`HIRE`/`LEAVE`/`DATA` and the one action that clears it) · **Claimed by you** *above* the pool (a forgotten claim is worse than an unclaimed item) · Fleet stacked bar over all 8 statuses + the line that matters ("spare pool covers 4 of the 5 slots the incoming hires need") · Age histogram where only the `4y+` bar changes colour · Warranty runway (next 90 days) · Jump-to links.
3. **Finance Home leads with money and age**, not counts — "₱208k waiting, oldest 2 days". Purchasing Home leads with a to-do list + spend. **Viewer Home is the same layout minus every mutating affordance and minus Needs-attention** (it is an action queue; a viewer has no actions).
4. **Focus mode is a cookie** (`br.focus`, alongside `br.dept`/theme/density in `src/app/(app)/layout.tsx`) — it collapses Home to the queue and your claims. Cookie, never URL: it is a personal working mode, not a shareable view.
5. **The current `/` is a Phase-2 placeholder** (`src/app/(app)/page.tsx` — a "Jump to" card built from `WORKSPACE_NAV`). Phase 6 replaces it wholesale; keep the role-aware nav-derived quick links, drop the rest.
6. **`/finance/assets` is the `1f` table pattern with value columns** (capitalized/approved assets), and `/finance/activity` is the same `ActivityFeed` renderer scoped to finance — the fifth and last consumer of it. `/finance(\/|$)` is already gated to the finance workspace in `PATH_RULES`; the nav entries already exist.
7. **Money is `Decimal` everywhere it appears** — convert to `number`/preformatted string in the query layer. A `Prisma.Decimal` crossing into a `"use client"` component throws at runtime and tsc will not catch it (Phase 5, `queries.ts`).
8. **Reuse, don't rebuild:** `ActivityFeed` + `actionDot` + `auditSentence` (Phase 4), `StatusDot`/`StatusPill` and the six-family map, `dwellLine` (Phase 5) for "how long has this been waiting", and `slaLabel` (Phase 4) for overdue text. Home is a composition phase; a new primitive here is a smell.

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
- **Rows created in one transaction share a `createdAt` millisecond**, so `orderBy: { createdAt: "asc" }` alone is NOT a stable order — Postgres may return them either way between reads. Phase 5 shipped a bug where this flipped which purchase line was "unit 1", corrupting the `unit-N` anchors. Always add an `id` tiebreaker.
- **A partial update must write only the fields the caller sent, and guard each on its before-value.** Filling untouched fields from the row you read (`specs ?? unit.specs`) rewrites them with a value that is already stale under READ COMMITTED — two people editing different fields of one row silently clobber each other, and a `diffOf` against the same stale row records no trace of it.
- **Prisma throws; it doesn't return.** Without a `try`/`catch` a P2028 (transaction couldn't get a connection — reachable with just two concurrent transactions) escapes as a 500 instead of the designed conflict banner. Every actions module needs the mapping.
- **Widening a path rule can leave an operation ungoverned.** Granting `/purchases` to the IT workspace made every role pass the path gate, so "who may create a request" stopped being answered by any layer until `DRAFT_ROLES` was added. When you widen a gate, ask which rule it was silently carrying.
- **A client-side navigation currently leaves the previous page's DOM in the document** (a second `<table>` outside `<main>`). Reproducible between two Phase-3 pages, so it predates Phase 5; observed in dev only, not investigated.
- **`design_handover/` is excluded from lint/build** and must stay untouched — it's the source of truth, not code.

## 8. Deferred / out-of-scope (tracked, don't lose)

- **Phase 4 leftovers:** `/approvals` shows the first 50 rows of a tab with a "showing N of M" hint but no pagination; no admin surface reads the `Job` table (Phase 8's deliveries page is the natural home); the worker's stale-lease recovery uses a 5-minute wall-clock heuristic (safe now because every terminal write is state-guarded).
- **Phase 5 leftovers:** the draft autosave churns unit rows (`createDraft`/`saveDraft` return only request-level fields, so `/purchases/new` never learns the unit ids it just created and every later autosave deletes and recreates the set — `/purchases/[id]/edit` does pass real ids and updates in place); `/purchases` has no sortable headers or column chooser; the ⌘K palette now returns purchase requests to `it_staff` and `viewer`, and the detail page shows money and finance notes to anyone who can reach it (no field-level restriction was specified); `addComment` deliberately still accepts comments on COMPLETED/CANCELLED requests.
- **Phase 3 leftovers:** CSV export buffers up to 10k rows in memory and silently truncates `?ids=` beyond 500; sort remount drops keyboard focus to `<body>`; `EntityCombobox` lacks a listbox accessible name and Home/End.
- Entra SSO real wiring (needs tenant creds). Real product photography, brand mark, barcode generation (striped placeholders today). Off-device backups (nightly `pg_dump` to a local volume ships; copying elsewhere is the user's call). HR review of the accountability-form acknowledgement copy. `WebhookEndpoint.secret` encryption (Phase 8). CI workflow + jsdom component tests (declined in Phase 1, revisitable).
