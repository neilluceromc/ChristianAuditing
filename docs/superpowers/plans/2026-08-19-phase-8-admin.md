# Inventory v2 — Phase 8: Admin workspace Implementation Plan

> ## Draft — 14 tasks. Architecture and scope decisions settled; task bodies land next.
>
> Written 2026-08-19 from `design_handover/README.md` card `3h` and `design_handover/original-brief.md`
> §7 (Admin workspace). Four things found while scoping it are worth knowing before you start,
> because each one changes a task rather than decorating it:
>
> - **Webhooks have no producer.** Nothing in `src/` has ever created a `DELIVER_WEBHOOK` job, so the
>   worker's dead-letter branch has always been answering an empty queue. "Webhooks" is therefore four
>   pieces, not one: deciding which domain events emit, the emitter, the delivery loop, and the UI.
> - **The permanent admin lock has to cover `disabled`, not just `role`.** `authorize()` refuses a
>   `disabled` user, so disabling the permanent admin locks everyone out exactly as thoroughly as
>   demoting them would. The brief only names the role; the guard has to be wider than the brief.
> - **`m365_sso` is not a safe switch.** `src/server/auth/index.ts` registers the Entra provider when
>   three env vars are present, but carries a `TODO(sso-phase)` because **no `signIn` callback maps an
>   Entra profile to a `User` row**. On a deployment with those env vars set, flipping this flag
>   surfaces a button that authenticates and then lands a user with no role. See scope decision #7.
> - **Everything else already has its schema.** `User.isPermanentAdmin`/`disabled`, `FeatureFlag`,
>   `WebhookEndpoint`, `WebhookDelivery` and `Job` all exist, and `FeatureFlag` is seeded. This phase
>   adds **one** migration, and it is a single partial unique index.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Admin workspace made real — `/admin/users` (role assignment with a permanent admin that reads as **locked before the click**), `/admin/flags`, `/admin/webhooks` (endpoint config with the signing secret **encrypted at rest**), `/admin/webhooks/deliveries` (attempt history with dead-letter replay), the **webhook pipeline behind them** (an emitter, a real delivery loop in the worker, and the retry ledger the page reads), and an Admin Home so the workspace stops borrowing IT's.

**Architecture:** Webhook delivery reuses the Phase 4 job engine rather than growing a second one. `emitWebhook(tx, event, payload)` is called from inside the transaction that already writes the domain change; it creates one `WebhookDelivery` row plus one `DELIVER_WEBHOOK` job per subscribed endpoint and **never performs I/O**. The worker owns retry and backoff exactly as it already does for approvals; the `WebhookDelivery` row is a **ledger mirrored from the job in the same handler**, so the page's `DEAD · 5/5` chip cannot disagree with the queue. Role and flag mutations are ordinary Phase 1–7 actions: pure TDD'd rules in `src/lib/`, called through `actionRole` → `checkRate` → zod → tx(write + `writeAudit`) → `revalidatePath`.

**Tech Stack:** Existing Phase 1–7 conventions (`ActionResult`, `actionRole`/`requireRole`, `checkRate`, `writeAudit` + `diffOf`, `safeSection` + `SectionCard`, url-state, `RefTable` as the CRUD table precedent) · `src/server/crypto.ts` (AES-256-GCM v1, unchanged — webhooks become its second caller) · Prisma 6 · Vitest · Playwright + axe · `node:crypto` `createHmac` for the delivery signature.

**Conventions for every task:** branch `phase-8-admin` (Task 1 creates it); `npx tsc --noEmit && npm run lint` before each commit (lint runs `--max-warnings 0`, so an unused import is a build failure); NEVER `npm run build` while a dev server runs; DB via `docker compose up -d db`, seed via `npm run db:seed`; subagents don't start dev servers — the controller owns the preview. **Restart the preview before any full-suite confirmation run** (Phase 6 gotcha). Commit style `feat(scope): …` / `fix(scope): …` / `docs(plan): …` with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

**One schema change this phase** — Task 9's migration adds a single partial unique index, mirroring `Job_one_live_execute_per_approval` byte for byte in shape:

```sql
CREATE UNIQUE INDEX "Job_one_live_deliver_per_delivery"
  ON "Job" ((payload->>'deliveryId'))
  WHERE "status" IN ('PENDING', 'RUNNING') AND "type" = 'DELIVER_WEBHOOK';
```

**Seed facts this phase leans on:** 5 users — `admin@thebackroomop.com` ("System Admin") is the **only** row with `isPermanentAdmin: true`, and the other four (`it@`, `purchasing@`, `finance@`, `viewer@`) are ordinary rows whose roles this phase can change · 2 feature flags: **`m365_sso`** (disabled, and per scope decision #7 it must stay unavailable) and **`allowed_domain`** (enabled, `value: "thebackroomop.com"`, and `src/server/auth/actions.ts` upserts it during bootstrap — so `/admin/flags` is its *second* writer, not its first) · **no `WebhookEndpoint` rows at all**, which is why Task 12 seeds two endpoints and a spread of deliveries including a `DEAD · 5/5` one, since the design's whole deliveries page is unreachable without them · `TRUNCATE` in `prisma/seed.ts` already covers `WebhookEndpoint`, `WebhookDelivery`, `Job`, `FeatureFlag` and `User`, so no seed surgery is needed beyond adding rows.

**Entry criteria this plan implements (HANDOVER §6):** #1 the worker's `DELIVER_WEBHOOK` dead-letter placeholder is replaced by real delivery, so "Replay" means something (Tasks 9, 10, 13) · #2 `WebhookEndpoint.secret` stops being a plaintext column (Task 7) · #3 `User.isPermanentAdmin` gets the `LOCKED` chip stated before the click (Tasks 2, 3) · #6 `/admin` stops falling through to the IT Home (Task 11) · Entra SSO is **explicitly deferred** by scope decision #7, which is criterion #8's "decide, don't discover". Criteria #4, #5 and #7 (import, export, the scanner) belong to Phase 9 and are deliberately absent here.

**Task map:** 1 branch + the user-role rules (TDD) · 2 user actions · 3 `/admin/users` · 4 the flag rules (TDD) · 5 flag actions + `/admin/flags` · 6 the webhook secret + endpoint rules (TDD) · 7 endpoint actions (encrypted secret, show-once) · 8 `/admin/webhooks` · 9 the emitter + the migration · 10 the worker delivers for real · 11 Admin Home · 12 the seed fixtures the deliveries page needs · 13 `/admin/webhooks/deliveries` + replay · 14 e2e, full battery, close-out.

---

## Recorded scope decisions

1. **The permanent admin is locked against `role` AND `disabled`, and the UI says so before the click.**
   `authorize()` in `src/server/auth/index.ts` returns `null` for `user.disabled`, so disabling the
   permanent admin locks every human out of the system just as completely as demoting them would.
   Card `3h` only names the role select, which is why the guard has to be deliberately wider than the
   design: both mutations refuse server-side, and the row renders a `LOCKED` chip with static text,
   tinted one step back. The constraint is *stated*, never discovered through a failed save.

2. **No separate "last admin" guard, and that is a decision rather than an oversight.** Because the
   permanent admin can be neither demoted nor disabled (decision #1), at least one enabled `admin`
   always exists. A second guard counting admins would be dead code that reads like a safety net —
   worse than none, because the next reader would trust it. If `isPermanentAdmin` ever becomes
   editable, this decision is what has to be revisited first.

3. **An admin may change their own role, and may not disable themselves.** Demoting yourself is
   recoverable — the permanent admin can restore it. Disabling yourself ends your own session with no
   way back in for you specifically, and reads as an accident rather than an intent. The refusal names
   the permanent admin as the way back.

4. **`WebhookEndpoint.secret` is encrypted at rest with the existing v1 scheme**, AAD `webhook:${id}`,
   reusing `src/server/crypto.ts` unchanged. It is a signing key sitting in a table an admin page
   reads; storing it as typed means storing it in the clear. This is a **second caller of one scheme**,
   not a second scheme — the AAD binds ciphertext to its endpoint row exactly as `assetId:label` binds
   an asset secret. The seed has no endpoint rows, so there is nothing to backfill.

5. **The secret is shown once, at creation, and is never readable again — only rotatable.** A
   decrypt-and-display path would need its own `SECRET_READ` audit obligation, a reveal countdown and
   a role gate, all to re-show a value the operator already pasted into the receiving system. Rotation
   answers the real need ("I lost it") without any of that. The create/rotate response carries the
   plaintext exactly once; nothing else ever decrypts it except the worker, when it signs.

6. **The Job is the retry engine; `WebhookDelivery` is the ledger the page reads.** The worker already
   has exponential backoff (`2 ** attempts * 30_000`) and dead-letters at `MAX_ATTEMPTS = 5` — the
   design's `DEAD · 5/5` chip is that number. Growing a second retry loop on
   `WebhookDelivery.attempts`/`nextAttemptAt` would put two counters on one process, and the first
   thing to expose the drift would be the chip itself. So the handler mirrors the job's state onto the
   delivery row **in the same handler that succeeds or fails**, and `Job.payload` carries `deliveryId`.

7. **Entra SSO is deferred, and `m365_sso` is therefore NOT a togglable flag this phase.**
   `src/server/auth/index.ts` registers `MicrosoftEntraID` whenever three env vars are set but carries
   `TODO(sso-phase)`: there is no `signIn` callback resolving `entraObjectId`/email to a `User`, so an
   Entra login would carry no role. `/login` shows the button when `m365_sso` is enabled **and**
   `AUTH_MICROSOFT_ENTRA_ID_ID` is set. A freely togglable switch is therefore one click away from a
   sign-in path that authenticates and lands nowhere, on exactly the deployment that has tried hardest
   to configure it. `/admin/flags` renders `m365_sso` as **unavailable with the reason** and
   `setFlag` refuses it by key. Wiring SSO needs real tenant credentials that do not exist yet; when
   they do, the work is the `signIn` callback plus removing this refusal — and this decision is the
   note explaining why the refusal is there.

8. **`allowed_domain` is editable here, and `/admin/flags` is its second writer.**
   `src/server/auth/actions.ts` already upserts it during bootstrap. Editing it changes who may sign
   up, so it is a value edit rather than a switch, and its audit entry records both values.

9. **Which events emit is a deliberately short list, chosen because each has an external consumer that
   is obvious.** `approval.executed`, `asset.status_changed` and `offboarding.completed`. Every one is
   already a moment the code passes through with a transaction open, so the emitter is a call, not a
   new hook. Growing this list is a one-line change per event *and a decision about what an outside
   system is entitled to know* — which is why the list is short rather than "every audit action".

10. **`emitWebhook` never performs I/O and never throws into its caller's transaction.** It writes
    rows. An endpoint being unreachable must never roll back the domain change that emitted it — a
    failed webhook is a delivery problem, not an inventory problem. The one thing it can raise is a
    `P2002` from the new partial unique index, which is the designed "there is already a live job for
    this delivery" and is caught as a conflict.

11. **Replay resets the attempt cycle rather than continuing it.** The design's control is
    "Replay 4 dead-lettered", which is a decision to try again, not to resume. So replay sets the
    delivery back to `PENDING` with `attempts = 0` and enqueues a fresh job, keeping `lastError`
    until the next attempt overwrites it, so the page still shows *why* it died while it waits. The
    new partial unique index is what stops a double-click producing two live jobs for one delivery.

12. **`/admin/webhooks/deliveries` shows the first 50 rows of a filter with a "showing N of M" hint
    and no pagination** — the same shape `/approvals` shipped in Phase 4 and for the same reason.
    Recorded so it reads as consistency rather than an omission.

13. **Admin gets its own Home (Task 11).** Today `ws === "admin"` falls through to the IT layout, so an
    admin sees SLA breaches and fleet composition under a Users/Webhooks/Flags sidebar — a sidebar and
    a body describing different jobs. The Admin Home answers the three questions its own sidebar
    raises: who can get in, what is switched on, and whether integrations are healthy. It reuses
    `safeSection`/`SectionCard`, so a failing section degrades exactly as every other Home does.

14. **The payload an endpoint receives is a small, stable envelope** — `{ id, event, occurredAt, data }`
    — and `data` carries ids and refNos rather than whole rows. A webhook is a notification that
    something happened, not a replication feed; shipping whole rows would make every schema change a
    breaking change for consumers we cannot see.

---

## File structure created/modified in this phase

**Pure rules (TDD, no DB) — `src/lib/`**
- `admin-users.ts` + `admin-users.test.ts` — `ROLE_OPTIONS`, `roleChange()` / `disableChange()`
  returning a typed refusal or an allowance, and `lockReason()` for the UI. The permanent-admin and
  self-disable rules live here so the page and the action cannot disagree.
- `admin-flags.ts` + `admin-flags.test.ts` — `FLAG_SPECS` (key → label, description, kind, and
  `unavailable` reason), `flagChange()`, and `isValueFlag()`.
- `webhooks.ts` + `webhooks.test.ts` — `WEBHOOK_EVENTS`, `parseEvents()`, `signPayload()`,
  `deliveryStage()` (the `DEAD · 5/5` / `RETRYING · 2/5` / `DELIVERED` chip text), and
  `webhookEnvelope()`.

**Server — `src/server/`**
- `modules/admin/user-actions.ts` — `setUserRole`, `setUserDisabled`.
- `modules/admin/flag-actions.ts` — `setFlag`, `setFlagValue`.
- `modules/admin/webhook-actions.ts` — `createEndpoint`, `rotateSecret`, `setEndpointActive`,
  `updateEndpoint`, `deleteEndpoint`, `replayDelivery`, `replayAllDead`.
- `modules/admin/queries.ts` — `listUsers`, `listFlags`, `listEndpoints`, `listDeliveries`, `adminHome`.
- `webhooks/emit.ts` — `emitWebhook(tx, event, data)`, the only producer of `DELIVER_WEBHOOK` jobs.

**Worker — `src/worker/`**
- `deliver-webhook.ts` — the real delivery: sign, POST, mirror the outcome onto the ledger.
- `index.ts` — the `DELIVER_WEBHOOK` branch stops dead-lettering and calls the above.

**UI — `src/app/(app)/admin/` and `src/components/admin/`**
- `users/page.tsx` + `components/admin/user-table.tsx`
- `flags/page.tsx` + `components/admin/flag-rows.tsx`
- `webhooks/page.tsx` + `components/admin/endpoint-editor.tsx`
- `webhooks/deliveries/page.tsx` + `components/admin/delivery-table.tsx`
- `components/home/admin-home.tsx` and the `ws === "admin"` branch in the Home route.

**Other**
- `prisma/migrations/20260819090000_job_one_live_deliver_per_delivery/migration.sql`
- `prisma/seed.ts` — two endpoints and a spread of deliveries (Task 12).
- `e2e/admin.spec.ts` (Task 14).

---
