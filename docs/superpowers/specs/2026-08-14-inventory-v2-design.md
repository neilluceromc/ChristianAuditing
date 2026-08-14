# Backroom IT — Inventory v2: Build-from-scratch Design

**Date:** 2026-08-14
**Status:** Approved by user (brainstorming session)
**Source documents:** `ChristianAuditing-main/design_handover/original-brief.md` (functional spec) and
`ChristianAuditing-main/design_handover/README.md` (design spec + tokens + motion + per-screen notes).
Those two documents are normative for *what screens do* and *how they look*; this document decides
*how the system is built*.

---

## 1. Decisions made

| Concern | Decision |
|---|---|
| Framework | Next.js (App Router, server actions, server-rendered lists) |
| Database | PostgreSQL 16 |
| Data layer | Prisma (audit trigger ships as raw SQL in a migration) |
| Auth | Auth.js v5 — credentials provider + Microsoft Entra ID provider behind a feature flag |
| Styling | Tailwind v4 over CSS custom properties (all handover tokens as variables) |
| Architecture | Modular monolith, single repo; background worker polls Postgres (no Redis/queue infra) |
| Deployment | Single machine (user's own device), one Docker Compose stack: `web` + `worker` + `db` |
| Scope | Full system (all 39 routes), delivered in 8 phases |
| M365 | Flag-ready: SSO button, domain allowlist, and M365 status fields built per spec; flag off and tenant-directory sync stubbed until Entra ID credentials exist |

Rejected alternatives: monorepo with extracted packages (tooling overhead, single consumer),
Redis/BullMQ queue (overkill at 60 mutations/min), SQLite (weaker concurrency, no advantage once
Docker is in play), Clerk (external SaaS dependency for an internal tool).

## 2. Architecture

Three processes in one repo, one compose file:

- **web** — Next.js. Lists are server-rendered; URL search params are the source of truth for
  filters/sort/page/tab (fixed contract from the brief). All mutations are server actions.
- **worker** — small Node process (`src/worker/`), polls Postgres every few seconds using
  `SELECT … FOR UPDATE SKIP LOCKED` over a `Job` table. Two job families:
  - execute `APPROVED` approvals → `EXECUTED` or `EXECUTION_FAILED` (worker error stored verbatim
    for the retry UI);
  - deliver webhooks — retry with backoff, dead-letter after 5 attempts (drives
    `/admin/webhooks/deliveries`).
- **db** — Postgres 16. `AuditEntry` is append-only via a trigger that raises on UPDATE/DELETE —
  enforced in the database, not by convention.

### Repo layout

```
src/
  app/            # routes only — layouts, pages, loading/error states
  components/
    ui/           # primitive layer (Button, Input, Table, Drawer, Dialog, …)
    patterns/     # composites (ActivityFeed, FacetDropdown, CommandPalette, …)
  server/
    modules/      # inventory/ employees/ approvals/ purchases/ audit/ admin/
    auth/         # Auth.js config, role/permission helpers
    db/           # Prisma client singleton
  worker/         # poller + job executors
  lib/            # status-family map, formatting, url-state helpers, enums
prisma/           # schema.prisma + migrations (incl. audit trigger SQL)
e2e/              # Playwright + axe
docs/superpowers/ # specs and plans
```

Each domain module owns its queries, server actions, state-machine rules, and audit writes.
Server actions stay thin; domain logic is plain testable functions.

### UI state that is not URL state

| Concern | Storage |
|---|---|
| Active workspace | cookie `br.dept` |
| Theme (light/dark/system) | cookie |
| Density (comfortable/compact) | cookie |
| Focus mode (Home) | cookie |
| Column visibility/order | per-user preference in DB (not URL) |
| Facet draft selection, row selection | component state |

## 3. Data model (Prisma entities)

Enums come verbatim from the brief §5.

- **User** — email, passwordHash (nullable for SSO-only), role
  (`admin | it_staff | purchasing_staff | finance_staff | viewer`), `isPermanentAdmin`
  (renders as the locked row on `/admin/users`; role change rejected server-side).
- **Employee** — name, title, department FK, employee number, M365 status (four canonical values
  plus free-text custom values stored as-is → Neutral family; `null` = "no sync yet", never a false
  `inactive`), offboarding state, joined date.
- **Asset** — unique tag (`BR-LT-0148` pattern), model, serial, category FK, type FK, status
  (7 values), assignee FK (nullable), purchase date/cost/PR link, warrantyUntil, vendor/RMA/quote
  fields (repair view is a saved filter over `status=DEFECTIVE` — no new enum), notes.
- **AssetSecret** — encrypted credential rows; every reveal writes a `SECRET_READ` audit entry;
  UI auto-hides after 30 s.
- **AssetDocument** — uploads with kind + signed flag (accountability forms scan back in here).
- **Reservation** — asset ↔ employee hold; `ACTIVE | FULFILLED | RELEASED | EXPIRED`; expiry date.
  Reserved stock still reads `SPARE` in inventory, with a hold marker.
- **PurchaseRequest** — state `DRAFT → SUBMITTED → IT_REVIEWED → COMPLETED` + `CANCELLED`;
  submitter; per-transition timestamps (submittedAt, reviewedAt/by, completedAt); notes as
  **NoteEntry[]** — append-only thread (actor, action chip, text, timestamp). Never a single
  overwritable text column.
- **PurchaseUnit** — description, specs, qty, price, state
  (`PENDING | APPROVED | REJECTED | CANCELLED`), IT slot fields, finance fields.
- **Approval** — type (`lifecycle.assign | replace | transfer | return | change-status`), state
  (`PENDING | CLAIMED | APPROVED | REJECTED | EXECUTED | EXECUTION_FAILED`), payload JSON
  (before→after), priority, SLA deadline, claimedBy, resolution reason, workerError text.
- **AuditEntry** — append-only: actor, entity type + id, action, before/after JSON diff.
  Per-record history renders "one row per field" from the diff. DB trigger blocks mutation.
- **EquipmentPolicy / PolicySlot** — per role/department loadout (slot name, asset type,
  required/optional). Role policy beats department policy. Policy edits never touch existing
  assignments; the audit entry records both slot lists.
- **Reference data** — AssetCategory, AssetType, Department (locked `Uncategorised` row), Vendor
  (small reference table; resolves the handover's open item for repairs).
- **Admin** — WebhookEndpoint, WebhookDelivery (attempt rows + dead-letter flag), FeatureFlag,
  Job (worker queue table).
- **UserPreference** — column visibility/order per user per table.

**Status→family mapping** lives in `src/lib/status.ts`: one exhaustive typed map from every enum
value to one of the six families (Neutral / In-flight / Settled / Attention / Fault / Closed),
consumed by `StatusDot`/`StatusPill`. Unknown values → Neutral. `EXECUTION_FAILED` gets the dashed
border + diamond mark; Closed renders hollow. No screen picks a status colour ad hoc.

## 4. Auth & authorization

- **Auth.js v5.** Credentials provider (bcrypt) always on; Microsoft Entra ID provider registered
  but gated by the `m365_sso` feature flag (default off). Domain allowlist enforced at signup and
  at SSO callback. Session = encrypted JWT cookie with userId + role.
- **/bootstrap** — works only while zero users exist; creates the permanent admin; 404s forever
  after. Dark surface per spec.
- **Three enforcement layers** (brief: "role gating is real, not cosmetic"):
  1. **Middleware** — session + `br.dept` resolution; unauthenticated → `/login`; workspace not
     allowed for role → server-side redirect to that role's landing page. The Forbidden screen
     renders only on direct links.
  2. **Server actions** — every action begins `requireRole(…)`; unauthorized calls return a typed
     `forbidden` result.
  3. **UI** — mutating affordances are absent (not disabled) for roles lacking them; render layer
     uses the same permission helpers as the server so they cannot drift.

## 5. Server action conventions

Every mutation follows one shape:

```
auth check → rate limit → zod validation → domain module call (in a transaction,
audit write in the same transaction) → revalidatePath → typed result
```

- Typed result union: `ok | forbidden | rate_limited | validation | conflict` — the UI maps these
  onto the spec's designed states (rate-limited amber card with countdown, inline form errors,
  conflict banners).
- **Rate limits** (from the brief): 60 mutations/min per user, 10 imports/min — implemented as a
  Postgres counter table, checked inside the action.
- **State machines as pure functions**: `purchaseTransition(state, action, role)` and
  `approvalTransition(state, action, ctx)` in their domain modules, unit-tested exhaustively;
  server actions are the only callers. Encoded rules (brief §6):
  - submit only from DRAFT; it-review only from SUBMITTED; it-reject → back to DRAFT with reason
    **appended**; request-info only from IT_REVIEWED → back to SUBMITTED; cancel from any
    non-terminal state, reason required; complete only from IT_REVIEWED.
  - claim only from PENDING; release only from CLAIMED; approve only from CLAIMED **by the owner**;
    reject from PENDING/CLAIMED/EXECUTION_FAILED with reason; escalate changes priority, not state;
    REJECTED and EXECUTED are terminal.
- **Worker execution**: approve enqueues a Job; worker executes the lifecycle change in a
  transaction → `EXECUTED`, or `EXECUTION_FAILED` with the error stored verbatim. Failed executions
  can be retried (re-enqueue) or rejected. UI shows the background-pending card meanwhile.

## 6. UI foundation

- **tokens.css** — every colour/spacing/radius/shadow/motion value from the handover as CSS custom
  properties; light on `:root`, dark on `[data-theme="dark"]` (re-derived palette per spec).
  Tailwind v4 exposes them as utilities; screens only use token utilities.
  `prefers-reduced-motion: reduce` sets all animation/transition durations to 0.01ms globally —
  hard requirement.
- **Status system first** — `status.ts` + `StatusDot`/`StatusPill` before anything else.
  In tables: dot + plain mono text. Everywhere else: tinted pill.
- **Primitive layer** — the ~22 missing primitives + 16 redesigned existing ones from the handover,
  with its exact sizes and behaviours (Button holds width while loading; Dialog only for
  irreversible decisions; Table density-aware 41px/33px rows; Drawer 376px on list pages; …).
  A `/dev/kitchen-sink` page renders every primitive in both themes and densities for review.
- **Composite patterns** — ActivityFeed (domain pill only on cross-domain feeds), FacetDropdown
  (URL updates only on Apply), ChipFilterRow, CommandPalette (⌘K), AttentionCard, EmployeePicker, …
- **Shell** — 238px sidebar; workspace switcher degrades to a static label for single-workspace
  roles; Approvals badge pulses when any item is past SLA; 52px topbar; mobile overlay drawer with
  focus trap + scroll lock. The four workspace IAs are data in one config file, not four sidebars.
- **Accessibility** — skip link, spec focus ring, ESC closes overlays, focus trap + return,
  landmarks/roles, queue keys (J/K/C/A/R/E), loadout grid arrow navigation. Built into primitives
  so screens inherit them.
- **Every screen designs its eight states** (loading skeletons that match final rhythm, two empty
  states, section-level error with retry, forbidden, read-only, rate-limited, optimistic-pending,
  background-pending) — per handover.

## 7. Delivery phases

Each phase ends with the app running, seeded, and its e2e tests green.

1. **Foundation** — scaffold, Docker Compose, Prisma schema + audit trigger + seed script, tokens,
   status system, primitive layer, kitchen-sink page.
2. **Auth + shell** — login/signup/bootstrap, sessions, middleware, workspace switching,
   sidebar/topbar/command palette, theme + density toggles.
3. **IT core** — inventory list/new/detail/edit + record tabs (history, timeline, documents,
   secrets, reservations), employees list/detail (loadout view)/edit, reference-data CRUD.
4. **Approvals + audit** — queue + detail, claim/approve/reject/escalate, worker process,
   `/audit`, activity feeds (one renderer, scoped variants).
5. **Purchasing** — request list/new/detail/edit, multi-unit rows, bounce-back banner + stepper,
   append-only notes thread, IT slot editor + Finance unit editor.
6. **Finance + Home** — finance assets/activity, role-aware Home dashboards with independently
   degrading sections, Focus mode.
7. **Offboarding + repairs + policies** — offboarding list + 4-step wizard (per-item decisions,
   each creating its own `lifecycle.return` approval), repairs saved view + detail panel,
   reservations list, equipment policies.
8. **Admin + import/export + polish** — users (locked permanent admin), webhooks + deliveries
   (replay dead-lettered), flags, import dry-run flow (blocked rows grouped by cause, partial
   import default), exports with the 10,000-row cap + split-by-year, printable label sheet +
   accountability form, USB-scanner behaviour, full axe pass across all routes.

## 8. Testing

- **Vitest (TDD)** — state machines, status map, rate limiter, url-state helpers: pure functions
  with exact specs.
- **Playwright e2e per phase** — `@axe-core/playwright` on every route; keyboard-path tests for
  the approval queue (J/K/C/A/R/E) and the loadout grid; mobile viewport checks for the drawer.
- **Seed script** — realistic demo data (assets across all 7 statuses, requests in every state,
  approvals incl. EXECUTION_FAILED, an offboarding in progress) so e2e and manual review share
  fixtures.

## 9. Out of scope / deferred

- Real Entra ID wiring (SSO + tenant directory sync) — built flag-off with a stubbed sync until
  credentials exist.
- Real product photography, brand mark, barcode generation service choice — placeholders per
  handover; barcode lib chosen at implementation time.
- HR review of the accountability form's acknowledgement copy (handover open item).
- Off-device backups. Nightly `pg_dump` into a local `backups/` volume ships with compose;
  copying those dumps to a second machine or cloud storage is the user's call later.
