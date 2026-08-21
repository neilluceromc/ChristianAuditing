# Inventory v2 — Phase 8: Admin workspace Implementation Plan

> ## Complete — 14 tasks, ready to execute.
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

**Task map:** 1 branch + the user-role rules (TDD) · 2 user actions · 3 `/admin/users` · 4 the flag rules (TDD) · 5 flag actions + `/admin/flags` · 6 the webhook vocabulary, the signature, and `DeliveryStatus` in the family map (TDD) · 7 endpoint actions (encrypted secret, show-once) · 8 `/admin/webhooks` · 9 the emitter + the migration · 10 the worker delivers for real · 11 Admin Home · 12 the seed fixtures the deliveries page needs · 13 `/admin/webhooks/deliveries` + replay · 14 e2e, full battery, close-out.

---

## Recorded scope decisions

1. **The permanent admin is locked against `role` AND `disabled`, and the UI says so before the click.**
   `authorize()` in `src/server/auth/index.ts` returns `null` for `user.disabled`, so disabling the
   permanent admin locks every human out of the system just as completely as demoting them would.
   Card `3h` only names the role select, which is why the guard has to be deliberately wider than the
   design: both mutations refuse server-side, and the row renders a `LOCKED` chip with static text,
   tinted one step back. The constraint is *stated*, never discovered through a failed save.

2. **No separate "last admin" guard, and that is a decision rather than an oversight.** A guard
   counting admins would be dead code that reads like a safety net — worse than none, because the next
   reader would trust it. **Amended after the Task 1 review, which checked the argument rather than
   accepting it:** the property holds, but not for the reason first written. It rests on four facts
   together, and the first three are what a later phase can break — (a) exactly one permanent admin per
   database, from either of its **two** producers (`prisma/seed.ts` and `createBootstrapAdmin` in
   `src/server/auth/actions.ts:115`, mutually exclusive because bootstrap is gated on
   `tx.user.count() === 0`); (b) **no writer of `User.role` or `User.disabled` anywhere outside this
   module** — Task 2 will be the first; (c) no user-deletion path at all; and (d) no email or password
   change flow, so the permanent admin's credentials stay usable. Revisit this decision if any of those
   changes, not only if `isPermanentAdmin` becomes editable.

   The review also found the statement "at least one enabled `admin` always exists" is false as a
   *global* claim, for a reason outside this phase: `/signup` is not gated on user count while
   `/bootstrap` 404s once any row exists, so on an empty database whoever signs up first creates a
   `viewer` and closes bootstrap forever. A last-admin guard would not have helped — it prevents
   removing the last admin, it cannot conjure one — so this is a Phase 1 gap recorded in HANDOVER §8,
   not an argument against this decision.

   **Re-verified after Task 2, which is the first code to exercise fact (b): all four still hold.**
   The only writes to an existing `User` row anywhere in `src/` are `user-actions.ts`'s two
   `updateMany` calls; `auth/actions.ts` and `prisma/seed.ts` set `role` at **create** time, so they
   are fact (a)'s producers rather than mutators. There is no writer of `isPermanentAdmin`,
   `passwordHash` or `email` at all, and no `user.delete` anywhere. Task 2 additionally made the lock a
   **database predicate** (`isPermanentAdmin: false` in both guarded `where` clauses) rather than
   leaving it enforced only in application code, since this decision stakes everything on it holding.

   **The one change most likely to falsify (a) and (b) at once is the deferred SSO work** (scope
   decision #7). A `signIn` callback mapping an Entra profile to a `User` row becomes a **third
   producer** of `User.role`, and SSO mappings conventionally *refresh* role from group claims on every
   login — which makes it a writer of `User.role` **on existing rows, outside this module's callers,
   unaware of the permanent-admin lock**. When that callback is written, this decision must be
   re-litigated, not re-cited.

   One pre-existing caveat found while re-verifying, **not** introduced by this phase and not a threat
   to the property: `createBootstrapAdmin`'s `tx.user.count() === 0` gate is a check-then-act at
   ReadCommitted, so two concurrent bootstrap POSTs with different emails could both pass and create
   two permanent admins. That is a wider lock, not a lockout.

3. **An admin may change their own role, and may not disable themselves.** Demoting yourself is
   recoverable — any admin can restore it. Disabling yourself ends your own session with no
   way back in for you specifically, and reads as an accident rather than an intent.

   **Amended twice against shipped code — the original text was wrong on both halves.**

   *The refusal's wording (Task 1 review, commit `d29ce9b`).* This decision first said the refusal
   "names the permanent admin as the way back." It doesn't, deliberately: nothing forbids one ordinary
   admin disabling another, so pointing at the permanent account would send someone to bother one named
   individual for something any colleague can do. `disableChange` names **any other admin**. That also
   keeps the string free of the words "permanent admin", which is what lets
   `admin-users.test.ts` tell this branch apart from the lock branch — the two refusals must stay
   textually disjoint, and the suite asserts both directions.

   *The consequence of self-demotion (Task 2 review, commit `4b112cd`).* "Recoverable" was true and
   also not the whole story. `requireUser` (`src/server/auth/guards.ts:22`) compares the JWT's role to
   the DB's on every request and redirects a mismatch to `/logout`, because the JWT freezes role at
   sign-in. So **any** self role change — not only a demotion — signs the actor out on their very next
   request, and `revalidatePath("/admin/users")` triggers exactly that inside the action's own
   response. Shipping only "it's recoverable" would have meant an admin gets no warning before the
   click and no explanation after: precisely the failure `lockReason` exists to prevent, in the one
   action in the file that can cause it. So `src/lib/admin-users.ts` gained
   **`selfRoleChangeWarning(target, next, actorId)`** — `lockReason`'s sibling, one string on two
   surfaces, a **warning and not a refusal** (this decision still permits self-demotion). Task 3's
   page must print it **before** the click, and `setUserRole` returns `signsOutActor` derived from the
   same rule so the two surfaces cannot disagree about when it applies.

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

9. **Which events emit is a deliberately short list, and the three are chosen to not overlap.**
   `approval.executed`, `offboarding.completed`, `purchase_request.completed`. Every one is already a
   moment the code passes through with a transaction open, so the emitter is a call rather than a new
   hook, and each answers a different outside system: asset lifecycle, HR/IT departure, procurement.
   **`asset.status_changed` was considered and rejected as redundant** — the conventions table forbids
   a direct asset write, so every status change arrives through an approval and would already have
   fired `approval.executed`. Two events for one fact is how consumers end up double-processing.
   Growing this list is one line here *and a decision about what an outside system is entitled to
   know* — which is why it is short rather than "every audit action".

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
  returning a typed refusal or an allowance, `lockReason()` for the UI, and — added by the Task 2
  review — `selfRoleChangeWarning()`, the warning (not a refusal) that a self role change signs you
  out, and — added by the Task 3 review — `roleWorkspaces()`, the artboard's `Workspaces` column derived
  from `ROLE_WORKSPACES`/`WORKSPACE_META`. The permanent-admin and self-disable rules live here so the
  page and the action cannot disagree — **and Task 3 proved that only holds if the page actually calls
  every rule**: it shipped once with a live Disable button on the actor's own row, because the UI
  imported `selfRoleChangeWarning` and not `disableChange`.
- `admin-flags.ts` + `admin-flags.test.ts` — `FLAG_SPECS` (key → label, description, `hasValue`, an
  `unavailable` reason and — added by the Task 4 review — an `offWarning`), plus `specFor()`,
  `FlagState`, `flagChange(state, next)`, `flagChangeWarning(state, next)` and `domainValue()`. It is an
  **allowlist**: `FeatureFlag` is key-value, so without it the flags page writes arbitrary config. Both
  rules take the **direction**, because turning a dangerous thing off is never the dangerous direction.
- `auth-shared.ts` — gains `flagDomain()`, the one expression for "is `allowed_domain` actually enforced
  right now". Three readers hand-rolled it and Task 5's query would have been a fourth that disagreed;
  the admin page must compute the enforced state exactly as the signup gate does, or its switch lies.
- `webhooks.ts` + `webhooks.test.ts` — `WEBHOOK_EVENTS`, `EVENT_LABELS`, `parseEvents()`,
  `webhookEnvelope()`, and `deliveryStage()` (the `DEAD · 5/5` / `RETRYING · 2/5` / `DELIVERED` chip
  **label** — colour is not its business). **No `node:` imports**: a `"use client"` table calls
  `deliveryStage`, so signing lives server-side instead (below).
- `status.ts` — gains the three `DeliveryStatus` values. It is the one app enum the six-family map has
  never covered, so a `DEAD` delivery would otherwise render the same grey as a spare laptop.

**Server — `src/server/`**
- `prisma-errors.ts` — `asActionResult`, the phase's shared Prisma-error mapper (P2028/P2025 → typed
  conflict, everything else rethrown). **A plain module, for the same reason `webhooks/sign.ts` is one:**
  the plan originally exported it from `user-actions.ts`, but that file carries `"use server"`, so every
  export becomes a network-reachable server action — and `asActionResult`'s first parameter is a
  function, which is not serializable across that boundary anyway. Tasks 5, 7 and 13 import it from
  here. Four private copies predate it (`modules/admin/policy-actions.ts`,
  `modules/offboarding/actions.ts`, `modules/purchases/actions.ts`, `modules/purchases/draft-actions.ts`);
  consolidating them is a recorded follow-up, deliberately not this phase's work — `policy-actions.ts`'s
  copy carries an extra P2003 branch this one does not.
- `modules/admin/user-actions.ts` — `setUserRole`, `setUserDisabled`.
- `modules/admin/flag-actions.ts` — `setFlag`, `setFlagValue`.
- `modules/admin/webhook-actions.ts` — `createEndpoint`, `rotateSecret`, `setEndpointActive`,
  `updateEndpoint`, `deleteEndpoint`, `replayDelivery`, `replayAllDead`.
- `modules/admin/queries.ts` — `listUsers`, `listFlags`, `listEndpoints`, `listDeliveries`, `adminHome`.
- `webhooks/emit.ts` — `emitWebhook(tx, event, data)`, the only producer of `DELIVER_WEBHOOK` jobs.
  Imported by **both** the worker and Next server actions, so it uses relative imports.
- `webhooks/sign.ts` — `signPayload()` and `secretAad()`. (**AMENDED by Task 8: `SIGNATURE_HEADER`
  now lives in `src/lib/webhooks.ts`** — this module imports `node:crypto`, so a `"use client"`
  component cannot import from it, and `/admin/webhooks` has to name the header it tells the
  operator to paste against.) A plain module on
  purpose: `webhook-actions.ts` carries `"use server"`, which would make every export a server action
  and put it out of reach of the worker — a bare `tsx` script outside Next.

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

### Task 1: Branch + the user-role rules (TDD)

Scope decisions #1, #2 and #3 all live in one pure module, so `/admin/users` and `user-actions.ts`
cannot disagree about who may be changed. The page needs the *reason* a row is locked in order to
print it before the click; the action needs the same rule in order to refuse independently. One
function returning that reason serves both.

**Files:**
- Create: `src/lib/admin-users.ts`, `src/lib/admin-users.test.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git status
git checkout -b phase-8-admin
```

`git status` must be clean before you branch.

- [ ] **Step 2: Write the failing test**

Create `src/lib/admin-users.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ROLE_LABELS, ROLE_OPTIONS, disableChange, lockReason, roleChange, type TargetUser,
} from "./admin-users";

const ordinary: TargetUser = { id: "u-1", role: "it_staff", isPermanentAdmin: false, disabled: false };
const permanent: TargetUser = { id: "u-0", role: "admin", isPermanentAdmin: true, disabled: false };

describe("ROLE_OPTIONS", () => {
  // AMENDED in 4b112cd — as originally written, this test compared ROLE_OPTIONS
  // against a hardcoded copy of itself, so it could never fail for the reason
  // its name claimed. It now reads the schema (`import { Role } from
  // "@prisma/client"` — Prisma exports it as a runtime value), and the ordering
  // claim is a separate `it` so a failure says which of the two broke.
  it("covers every Role in the schema", () => {
    expect(new Set(ROLE_OPTIONS)).toEqual(new Set(Object.values(Role)));
  });

  it("puts admin first", () => {
    expect(ROLE_OPTIONS[0]).toBe("admin");
  });

  it("labels every option, so a select can never render a raw enum", () => {
    for (const role of ROLE_OPTIONS) expect(ROLE_LABELS[role]).toBeTruthy();
  });
});

describe("lockReason", () => {
  it("names the permanent admin, so the row can say why before the click", () => {
    expect(lockReason(permanent)).toMatch(/permanent admin/i);
  });

  it("is null for an ordinary row", () => {
    expect(lockReason(ordinary)).toBeNull();
  });
});

describe("roleChange", () => {
  it("allows an ordinary user's role to change", () => {
    expect(roleChange(ordinary, "viewer", "actor-9")).toEqual({ allowed: true });
  });

  it("refuses the permanent admin, quoting the lock reason", () => {
    const res = roleChange(permanent, "viewer", "actor-9");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/permanent admin/i);
  });

  // Scope decision #3: recoverable, because the permanent admin can restore it.
  it("allows an admin to demote themselves", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    expect(roleChange(self, "viewer", "actor-9")).toEqual({ allowed: true });
  });
});

describe("disableChange", () => {
  it("allows disabling an ordinary user", () => {
    expect(disableChange(ordinary, true, "actor-9")).toEqual({ allowed: true });
  });

  it("allows re-enabling an ordinary user", () => {
    const off: TargetUser = { ...ordinary, disabled: true };
    expect(disableChange(off, false, "actor-9")).toEqual({ allowed: true });
  });

  // Scope decision #1: authorize() refuses a disabled user, so disabling the
  // permanent admin locks everyone out exactly as thoroughly as demoting them.
  it("refuses to disable the permanent admin", () => {
    const res = disableChange(permanent, true, "actor-9");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/permanent admin/i);
    // ...and not with the self-disable wording, which is the other refusal this
    // function can return.
    expect(res.allowed === false && res.reason).not.toMatch(/your own account/i);
  });

  it("refuses to touch the permanent admin even when re-enabling", () => {
    const off: TargetUser = { ...permanent, disabled: true };
    expect(disableChange(off, false, "actor-9").allowed).toBe(false);
  });

  // Scope decision #3: unlike a demotion, this one has no way back for you.
  //
  // Assert the DISTINGUISHING clause, not /permanent admin/. Both branches of
  // disableChange return { allowed: false }, so a reason-match both strings
  // satisfy cannot tell them apart — and no mutation test can catch that,
  // because `allowed` is false either way. The negative assertion is what keeps
  // the two strings disjoint as they get edited.
  it("refuses self-disable, and says so in its own words", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    const res = disableChange(self, true, "actor-9");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/your own account/i);
    expect(res.allowed === false && res.reason).not.toMatch(/permanent admin/i);
  });

  it("allows re-enabling yourself, which is unreachable but harmless", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: true };
    expect(disableChange(self, false, "actor-9")).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/lib/admin-users.test.ts
```

Expected: FAIL — `Failed to resolve import "./admin-users"`.

- [ ] **Step 4: Write the module**

Create `src/lib/admin-users.ts`:

```ts
import type { Role } from "@prisma/client";

/** Admin first: the select reads as a privilege ladder, most-privileged at the top. */
export const ROLE_OPTIONS: Role[] = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  it_staff: "IT staff",
  purchasing_staff: "Purchasing staff",
  finance_staff: "Finance staff",
  viewer: "Viewer",
};

/** Only the fields the rules below read, so a caller can pass a narrow select. */
export interface TargetUser {
  id: string;
  role: Role;
  isPermanentAdmin: boolean;
  disabled: boolean;
}

export type RuleResult = { allowed: true } | { allowed: false; reason: string };

const PERMANENT_LOCK =
  "This is the permanent admin account — its role and access can't be changed, so the system can never be locked out of itself.";

/**
 * Why this row cannot be edited at all, or null when it can. The page prints
 * this beside a LOCKED chip so the constraint is STATED (card 3h) rather than
 * discovered through a failed save, and the actions call the same rules below,
 * so a hand-rolled request is refused on exactly the same grounds.
 */
export function lockReason(target: TargetUser): string | null {
  return target.isPermanentAdmin ? PERMANENT_LOCK : null;
}

/**
 * Scope decision #3: demoting yourself is allowed. It is recoverable — the
 * permanent admin can put it back — and forbidding it would mean an admin
 * tidying up their own over-privilege has to ask someone else to do it.
 *
 * `next` and `actorId` are unused today and are part of the signature on
 * purpose: every caller already has them, so adding a rule that needs either
 * one is a change to this function alone rather than to four call sites.
 */
export function roleChange(target: TargetUser, next: Role, actorId: string): RuleResult {
  void next;
  void actorId;
  const locked = lockReason(target);
  return locked ? { allowed: false, reason: locked } : { allowed: true };
}

/**
 * Wider than card 3h asks for, deliberately (scope decision #1): `authorize()`
 * returns null for a disabled user, so disabling the permanent admin ends every
 * route back into the system just as completely as demoting them would.
 *
 * Self-disable is refused for the opposite reason to self-demotion — it ends
 * your own session with no way back for you specifically, so it reads as an
 * accident rather than an intent.
 *
 * The refusal names ANY other admin, not the permanent one: an ordinary admin
 * may disable another ordinary admin (nothing here forbids it), so pointing at
 * the permanent account would send someone to bother one specific person for
 * something any of their colleagues can do. It also keeps this string free of
 * the words "permanent admin", which is what lets the tests tell this branch
 * apart from the lock branch above — see the note in the test file.
 */
export function disableChange(target: TargetUser, next: boolean, actorId: string): RuleResult {
  const locked = lockReason(target);
  if (locked) return { allowed: false, reason: locked };
  if (next && target.id === actorId) {
    return {
      allowed: false,
      reason:
        "You can't disable your own account — you'd be signed out with no way back in. Another admin can do it for you.",
    };
  }
  return { allowed: true };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx vitest run src/lib/admin-users.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Mutation-test the suite before trusting it**

This project has shipped tests that passed for the wrong reason (HANDOVER §7), so break each rule in
turn, confirm a test dies, and put it back:

1. `lockReason` returns `null` unconditionally → the `lockReason` permanent test and all four
   permanent-admin tests must fail.
2. Drop the `next &&` from the self-disable guard → "allows re-enabling yourself" must fail.
3. Change `target.id === actorId` to `target.id !== actorId` → **two** tests must fail: "allows
   disabling an ordinary user" and "refuses self-disable" — the same comparison guards both paths.
4. Swap the branches: return `PERMANENT_LOCK` as the self-disable reason → "refuses self-disable, and
   says so in its own words" must fail. This is the mutation the original assertion could **not**
   catch, because `allowed` is `false` in both branches and the old regex matched both strings.

If a mutation leaves the suite green, the test for that rule is not testing it — fix the test, not the
module.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run src/lib/admin-users.test.ts
git add src/lib/admin-users.ts src/lib/admin-users.test.ts
git commit -m "feat(admin): the user rules, with the permanent admin locked against disable too"
```

**Task 2's review reached back into both of these files** (commit `4b112cd`), so this module is larger
than this task left it. It gained **`selfRoleChangeWarning(target, next, actorId)`** — `lockReason`'s
sibling, a warning rather than a refusal, returning the sentence when the actor is changing their **own**
role to any different role, because `requireUser` bounces a JWT/DB role mismatch to `/logout` and the
actor is signed out mid-session. See the amended scope decision #3 and Task 2's preamble. Task 3 must
print it before the click.

---

### Task 2: User actions

Two mutations, both guarded by Task 1's rules and both state-guarded on the value they are replacing.
This is also where the phase's shared `asActionResult` helper lands; Tasks 5, 7 and 13 import it, so get
the shape right here.

**AMENDED to the shipped code (commits `28e21ba` + `4b112cd`).** Three things below differ from what this
task originally said, and each one is a defect the reviews caught rather than a preference:

1. **`asActionResult` lives in its own plain module, `src/server/prisma-errors.ts`** — not exported from
   `user-actions.ts`. That file carries `"use server"`, so every export of it becomes a network-reachable
   server action, and this helper's first parameter is a function, which is not serializable across that
   boundary. This plan already applies the same reasoning to `webhooks/sign.ts` (Task 6); it simply
   failed to apply it here.
2. **Neither action returns `ok(null)`.** `setUserRole` returns
   `ActionResult<{ changed: boolean; signsOutActor: boolean }>` and `setUserDisabled` returns
   `ActionResult<{ changed: boolean }>`, and `revalidatePath` fires **only when `changed`**. Without
   `changed`, a no-op save is indistinguishable from a real one, so Task 3 would report "audit entry
   written" for a save that wrote nothing — the exact bug `src/server/modules/offboarding/actions.ts:239`
   already fixed one phase earlier, with a comment saying why. `signsOutActor` carries scope decision
   #3's amended consequence. **Because the callbacks now return objects, the old `if (failure)` check is
   a trap** — `{ changed: false }` is truthy, so a no-op would propagate as a failure. Both callbacks
   therefore return a full `ActionResult` on **every** path and the caller discriminates on `.ok`, which
   is structural rather than something a later edit can weaken back into a truthiness test.
3. **The disable audit diff carries `disabled` only.** The original block added
   `email: { from: X, to: X }` so the row would say who it was about. But `/audit` renders the diff's
   **key names** (`Object.keys(diff).join(", ")`), so that row read `Fields: disabled, email` —
   telling a later auditor the email changed, in an append-only table that can never be corrected. The
   justification was also already false: Step 3 below puts the user's identity on the audit row itself.
   Identity moved there (`name · email`, since `User.name` is not unique) and out of the diff.

Two smaller amendments: both `updateMany` guards gained `isPermanentAdmin: false`, so the lock scope
decision #2 rests on is a database predicate and not only application code; and `z.enum(ROLE_OPTIONS)`
needs neither of the two casts the original block used (zod 4 accepts a plain `Role[]` and preserves the
element type — the `as [string, ...string[]]` was what erased `Role` and forced the second cast).

**Files:**
- Create: `src/server/prisma-errors.ts`
- Create: `src/server/modules/admin/user-actions.ts`

- [ ] **Step 0: The shared Prisma-error mapper**

Create `src/server/prisma-errors.ts`. Note the doc comment is addressed to **callers**: this helper
cannot see a caller's callback body, so it states the ordering rule as a precondition and each call site
verifies it in a comment of its own.

```ts
import { Prisma } from "@prisma/client";
import { conflict, type ActionResult } from "@/server/action-result";

/**
 * Prisma throws rather than returning. P2028 (the transaction couldn't get a
 * connection — reachable with two concurrent transactions) and P2025 (the row
 * vanished between the read and the guarded write) are both designed conflicts
 * here, not 500s. Everything else rethrows: an unexpected error must never be
 * laundered into a friendly banner.
 *
 * PRECONDITION FOR CALLERS: `run` is expected to wrap a `prisma.$transaction`
 * callback. RETURNING a failure from that callback COMMITS the transaction —
 * only a throw rolls it back. So every `return conflict(...)` inside your
 * callback must precede every write in it; this helper has no way to check
 * that for you, and can't see your callback's body at all. Verify the
 * ordering holds at each call site, in a comment there — not here.
 */
export async function asActionResult<T>(
  run: () => Promise<T>,
  opts?: { goneMessage?: string },
): Promise<T | ActionResult<never>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2028") {
        return conflict("The database is busy right now — nothing was written. Try that again.");
      }
      if (err.code === "P2025") {
        return conflict(opts?.goneMessage ?? "That record no longer exists.");
      }
    }
    throw err;
  }
}
```

- [ ] **Step 1: Write the actions**

Create `src/server/modules/admin/user-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { asActionResult } from "@/server/prisma-errors";
import { ROLE_OPTIONS, disableChange, roleChange, selfRoleChangeWarning } from "@/lib/admin-users";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/** The narrow select every rule in `@/lib/admin-users` reads. */
const TARGET_SELECT = { id: true, role: true, isPermanentAdmin: true, disabled: true } as const;

const roleSchema = z.object({
  userId: z.string().min(1),
  // zod 4 accepts ROLE_OPTIONS's plain `Role[]` directly and preserves the
  // element type, so `parsed.data.role` below is already `Role` — no cast.
  role: z.enum(ROLE_OPTIONS),
});

export async function setUserRole(
  input: unknown,
): Promise<ActionResult<{ changed: boolean; signsOutActor: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const nextRole = parsed.data.role;

  // The callback below always returns an ActionResult — `conflict(...)` on
  // every failure path, `ok({...})` on both the no-op and the written path —
  // so the check after `asActionResult` can discriminate on `.ok` instead of
  // truthiness. A bare `{ changed: false }` is truthy; `if (result)` would
  // have silently treated a no-op as a failure to propagate.
  //
  // Every `return conflict(...)` below precedes every write in this callback
  // (see prisma-errors.ts's precondition): the two lookups and both rule
  // checks return before `updateMany` is ever reached.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: TARGET_SELECT,
        });
        if (!target) return conflict("That user no longer exists.");

        // Task 1's rule, called by the server independently of the UI — the page
        // hides the select for a locked row, and this refuses a request that
        // never came from that page.
        const verdict = roleChange(target, nextRole, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);

        // lockReason's sibling flag, not a refusal: an admin changing their OWN
        // role gets signed out on the very next request (the JWT freezes role
        // at sign-in — see selfRoleChangeWarning's doc comment in admin-users.ts).
        // Derived from the same rule the page will use, so the two surfaces can
        // never disagree about when this applies.
        const signsOutActor = selfRoleChangeWarning(target, nextRole, actor.id) !== null;

        if (target.role === nextRole) return ok({ changed: false, signsOutActor }); // no-op: don't pollute the trail

        // Guarded on the before-value, so two admins changing one row can't
        // silently agree on whichever write landed last. `isPermanentAdmin:
        // false` restates the lock the verdict check above already enforces —
        // unreachable today, but scope decision #2 stakes the "no last-admin
        // guard needed" call entirely on this lock holding, so it shouldn't
        // hold only in application code. If this predicate ever DID fire,
        // `count === 0` below would read as an ordinary "someone else changed
        // it" conflict, which would be the wrong message for what actually
        // happened — the honest one is the lock message `roleChange` already
        // returned above.
        const written = await tx.user.updateMany({
          where: { id: target.id, role: target.role, isPermanentAdmin: false },
          data: { role: nextRole },
        });
        if (written.count === 0) {
          return conflict("Someone else just changed that user's role — refresh.");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "user",
          entityId: target.id,
          action: "role-change",
          diff: { role: { from: target.role, to: nextRole } },
        });
        return ok({ changed: true, signsOutActor });
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (!result.ok) return result;
  // A no-op cache bust is what this guard exists to avoid — see offboarding's
  // m365 action, which the same fix is modeled on.
  if (result.data.changed) revalidatePath("/admin/users");
  return result;
}

const disableSchema = z.object({
  userId: z.string().min(1),
  disabled: z.boolean(),
});

export async function setUserDisabled(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data.disabled;

  // Same discriminated-on-.ok shape as setUserRole above, and the same
  // precondition holds: every `return conflict(...)` below precedes the write.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: TARGET_SELECT,
        });
        if (!target) return conflict("That user no longer exists.");

        // No `signsOutActor` flag here: self-disable is refused outright by
        // this rule, so the actor can never be the target of a written change.
        const verdict = disableChange(target, next, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);
        if (target.disabled === next) return ok({ changed: false });

        // `isPermanentAdmin: false` restates the lock enforced above — see the
        // matching comment in setUserRole.
        const written = await tx.user.updateMany({
          where: { id: target.id, disabled: target.disabled, isPermanentAdmin: false },
          data: { disabled: next },
        });
        if (written.count === 0) {
          return conflict("Someone else just changed that user's access — refresh.");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "user",
          entityId: target.id,
          action: next ? "disable" : "enable",
          diff: { disabled: { from: target.disabled, to: next } },
        });
        return ok({ changed: true });
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (!result.ok) return result;
  if (result.data.changed) revalidatePath("/admin/users");
  return result;
}
```

- [ ] **Step 2: Teach the audit display layer the two new action strings**

`actionDot` in `src/components/patterns/activity-feed.tsx` matches exact strings and falls through to
the neutral `SPARE` dot. `disable` is a fault-shaped event and should read as one. Add it to the fault
line, which currently reads:

```ts
  if (action.includes("failed") || action === "delete") return "DEFECTIVE"; // fault
```

so that it becomes:

```ts
  // "disable" (entityType "user") is unreachable today: every actionDot caller
  // scopes to employee/asset/purchase-request, and /audit — the one page that
  // renders "user" entries — never calls this. Pre-wired for a user-scoped
  // feed Task 11 may add; not dead by mistake.
  if (action.includes("failed") || action === "delete" || action === "disable") return "DEFECTIVE"; // fault
```

**The comment is not decoration — it is the amendment.** The Task 2 review verified this plan's
`auditSentence` claim (below) and found it proves rather more than intended: all four `actionDot` callers
filter `entityType` to `employee` / `asset` / `purchase-request`, and `/audit` never imports `actionDot`
at all, so **this line is unreachable today**. It is kept because Task 11 may add an admin activity feed,
and commented so the next reader doesn't take it for live code. If Task 11 does light it up, revisit
whether `DEFECTIVE` — the *fault* family — is the right reading for a deliberate administrative action;
`enable` is correctly left neutral, since a restoration is not an incident.

**Do not touch `auditSentence`.** Phase 7 learned this the hard way: the four activity feeds scope to
`entityType` `employee` / `asset` / `purchase-request`, and `/audit` renders `listAudit`'s raw `action`
plus the diff's *key names*, never `auditSentence`. A `user` entry reaches none of them, so cases added
there would be dead code. See HANDOVER §7.

- [ ] **Step 3: Make `/audit` able to name and filter these rows**

Two one-line additions, both of which `/audit` genuinely reads (unlike `auditSentence`):

In `src/lib/audit-list.ts`, `AUDIT_ENTITY_TYPES` already contains `"user"` — confirm it and change
nothing.

In `src/server/modules/audit/queries.ts`, `entityLabels` resolves ids to labels for `asset`,
`employee`, `approval`, `purchase-request` and `equipment-policy`. Add `user`, following the existing
`Promise.all` + `byType.has(...)` shape exactly — add to the destructured array:

```ts
    byType.has("user")
      ? prisma.user.findMany({
          where: { id: { in: [...byType.get("user")!] } },
          select: { id: true, name: true, email: true },
        })
      : [],
```

and beside the other `map.set` lines:

```ts
  // `User.name` isn't unique (only `email` is) — the label carries both so it
  // reads as an identity, not just a display name two people might share.
  for (const u of users) map.set(`user:${u.id}`, { label: `${u.name} · ${u.email}`, href: "/admin/users" });
```

naming the new binding `users` in the destructuring. Without this, every role change in the audit log
reads as a truncated cuid.

**Amended:** the label carries `name · email` rather than `name` alone, and the select therefore takes
`email`. This is the other half of amendment #3 at the top of this task — it is *because* the row now
names the user that the false `email: { from: X, to: X }` diff key could be deleted. `User.name` has no
unique constraint, so a bare name would have left two colleagues sharing one audit identity.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/server/prisma-errors.ts src/server/modules/admin/user-actions.ts src/components/patterns/activity-feed.tsx src/server/modules/audit/queries.ts
git commit -m "feat(admin): role and access changes, guarded and audited by name"
```

**As shipped this became two commits, deliberately left unsquashed** so the review verdict stays legible
in history: `28e21ba` is the task as written above, and `4b112cd`
(`fix(admin): honest results for a self role change and a no-op save`) is the review fix — the
`changed` / `signsOutActor` returns, `selfRoleChangeWarning` and its tests, the deleted `email` diff key,
the `isPermanentAdmin: false` predicates, the removed casts, and the `ROLE_OPTIONS` test that now reads
`Object.values(Role)` instead of a hardcoded copy of itself. `4b112cd` also touches
`src/lib/admin-users.ts` and `src/lib/admin-users.test.ts`, which Task 1 created.

Verified green at `4b112cd`: `npx tsc --noEmit` · `npm run lint` · **363 tests across 27 files** ·
`npm run build`.

---

### Task 3: `/admin/users`

Card `3h`: role selects per row, **except the permanent admin**, which shows a `LOCKED` chip and static
text and is tinted one step back. The constraint is stated before the click.

> ### AMENDED to the shipped code (`5d8e819` + `8a604df`). The earlier REQUIRED AMENDMENT banner has been applied and folded in.
>
> The code below is what shipped and was confirmed in the browser. Six things differ from what this task
> originally specified. The first is the one to read if you read only one, because the same mistake is
> available in every remaining task of this phase.
>
> **1. The Disable button on the actor's own row was a guaranteed-fail affordance.** `lockReason` returns
> `null` for your own row, so the `!row.locked` branch rendered a normal live button — while
> `disableChange` refuses self-disable unconditionally, and `next` can only ever be `true` for the actor
> (a disabled user is bounced at `guards.ts:19`, so they can never be looking at this page). **Every
> click on it produced a red conflict banner. 100% of them.** That breaks brief section 3's hard constraint
> — *"Anything a role can't do must not render an action they'll get a 403 from"* — and card 3h's whole
> thesis, which this task applied meticulously to the permanent admin and to the self *role* change and
> then dropped for the self *disable*. The rule was already written, exported and unit-tested; the UI
> simply never imported it. **The lesson for Tasks 5, 8 and 13: for every rule module this phase adds,
> check that the page consumes every refusal it can return, not just the one the design card names.**
>
> **2. `UserRow` carries `target: TargetUser`.** The first fix synthesized a `TargetUser` in the client
> with a hardcoded `isPermanentAdmin: false`. It was true, and `selfRoleChangeWarning` does not even read
> that field — which is what made it dangerous: unfalsifiable, so nothing would ever catch it going
> wrong, while `admin-users.ts:42-44` promises that a rule which *starts* reading it is a change to one
> function and not to its call sites. `listUsers` was already building that exact object and throwing it
> away; it now returns it. Do not derive it from `row.locked` — that inverts the dependency.
>
> **3. `changed: false` now always refreshes.** Reason about when that branch can fire: a `<select>`
> emits no change event for the already-selected option, and the Disable button always sends the opposite
> of what it shows — so it fires **only when the client's props are stale.** The original "a no-op
> refresh is a pointless round trip" reasoning is therefore backwards: in the one case it fires, the
> refresh is the entire remedy. Without it, a second admin clicking Disable on an already-disabled row
> gets a spinner, then silence, **forever**, until they reload by hand. `router.refresh()` now runs on
> every `ok`, with a neutral "already X" toast when nothing changed. `setUserRole`/`setUserDisabled` were
> **not** touched: the server keeping `revalidatePath` gated on `changed` is right and matches
> `offboarding/actions.ts`, and `router.refresh()` refetches regardless on a dynamic route.
>
> **4. Progress is per-row.** `loading={pending}` off one shared `useTransition` put a spinner in all
> five rows' buttons — four false claims per click. `queue-table.tsx:32,39-40` shares `pending` but
> tracks the acting row by id, and `policy-editor.tsx:53,92` scopes its runner per card. Now
> `loading={acting === row.id}`, with `disabled={pending}` still shared — that part is correct, it stops
> cross-row double-submits into one shared error state.
>
> **5. Both refusal sentences moved out of the cells into a caption under the table.**
> `PERMANENT_LOCK` is ~128 chars at `text-[10.5px]` in a 170px cell — about five wrapped lines, making
> the first row 2-3x `--row-h` and defeating the density toggle (brief section 3.5) on the one row every
> reader sees first. The self-disable refusal is ~100 chars in a 130px cell, so it had the same problem.
> Cells now carry a short label (`LOCKED` + role, or `Your own account`); the caption carries the
> sentences, which is where the artboard puts the explanation. **Both constraints are still stated on
> screen** — that is the point — just not inside a 130px cell. Measured after: all five rows are 41px.
>
> **6. The artboard's `Workspaces` column was restored, and `Last seen` is an explicit deferral.**
> This task claimed card 3h "only names the role select". True of the card's *prose*; its **artboard**
> specifies four columns, and two were dropped silently. `Workspaces` is derivable today from
> `ROLE_WORKSPACES` / `WORKSPACE_META` with no schema change, and it matters because the role name does
> not answer the question — brief section 2 puts `it_staff` and `viewer` in the **same** workspace with
> different access, so an admin picking "Viewer" otherwise learns nothing about what that grants. It is
> a pure function, `roleWorkspaces()` in `src/lib/admin-users.ts`, tested against `ROLE_WORKSPACES`
> rather than a hand-copied string table. `Last seen` is **deliberately not built**: `model User` has no
> `lastSeenAt`, and brief section 3.1 forbids new backend work — the `Sign-in` column stands in for it.
> `Avatar` was also restored, matching `employees/page.tsx:64`.
>
> Plus one shared-primitive fix: **`src/components/ui/dialog.tsx` gained `aria-describedby`.** It set
> `aria-labelledby` only, and `useFocusTrap` focuses the first focusable element — Cancel — so a screen
> reader announced the title, then "Cancel, button", and never the body. The warning sentence, the entire
> reason this dialog exists, went unread. Additive, benefits all seven `Dialog` call sites, and this is
> the one dialog in the app that ends the actor's session. **Confirmed in the browser:**
> `aria-describedby` resolves to the warning text.

**Files:**
- Create: `src/server/modules/admin/queries.ts`, `src/components/admin/user-table.tsx`,
  `src/app/(app)/admin/users/page.tsx`
- Modify: `src/lib/admin-users.ts` + `src/lib/admin-users.test.ts` (add `roleWorkspaces`),
  `src/components/ui/dialog.tsx` (`aria-describedby`)

- [ ] **Step 1: Write the query module**

Create `src/server/modules/admin/queries.ts`. Tasks 5, 8, 11 and 13 all add functions to this file —
this is its first one.

```ts
import { prisma } from "@/server/db/client";
import { lockReason, roleWorkspaces, type TargetUser } from "@/lib/admin-users";
import type { Role } from "@prisma/client";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  /** non-null → the row is locked, and this is the sentence explaining why */
  locked: string | null;
  /** a passwordHash-less row can only arrive via Entra */
  signIn: "credentials" | "SSO only";
  /** "all four" | "IT · read-only" | … — see roleWorkspaces */
  workspaces: string;
  /**
   * The exact shape every rule in `@/lib/admin-users` reads, passed straight
   * through rather than left for the client to rebuild — a client-synthesized
   * copy of this object is exactly the kind of thing that quietly hardcodes a
   * field (isPermanentAdmin, say) that happens to be right today.
   */
  target: TargetUser;
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await prisma.user.findMany({
    orderBy: [{ isPermanentAdmin: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, role: true,
      isPermanentAdmin: true, disabled: true, passwordHash: true,
    },
  });
  return rows.map((r) => {
    const target: TargetUser = {
      id: r.id, role: r.role, isPermanentAdmin: r.isPermanentAdmin, disabled: r.disabled,
    };
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      disabled: r.disabled,
      locked: lockReason(target),
      signIn: r.passwordHash ? "credentials" : "SSO only",
      workspaces: roleWorkspaces(r.role),
      target,
    };
  });
}
```

The permanent admin sorts first because it is the row that explains the screen's one rule.

- [ ] **Step 2: Write the table component**

Create `src/components/admin/user-table.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  ROLE_LABELS, ROLE_OPTIONS, disableChange, selfRoleChangeWarning, type RuleResult,
} from "@/lib/admin-users";
import { setUserDisabled, setUserRole } from "@/server/modules/admin/user-actions";
import type { ActionResult } from "@/server/action-result";
import type { UserRow } from "@/server/modules/admin/queries";
import type { Role } from "@prisma/client";

/** A role picked for the actor's own row, waiting on the confirm dialog. */
interface PendingSelfChange {
  row: UserRow;
  next: Role;
  warning: string;
}

/** `RuleResult`'s reason, or null when the rule allows it — a small reader so
 * call sites don't each re-narrow the discriminated union by hand. */
function refusalReason(verdict: RuleResult): string | null {
  return verdict.allowed ? null : verdict.reason;
}

export function UserTable({ rows, actorId }: { rows: UserRow[]; actorId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A deadline, not a duration: RateLimitNotice resets its own countdown on
  // every mount, and this component remounts it (top of the table vs. inside
  // the confirm dialog). Storing "when it ends" and computing the remaining
  // seconds fresh at render — instead of a `retryAfterSec` captured once —
  // is what keeps a remount from restarting the clock.
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingSelfChange | null>(null);
  // Scoped to the one row whose Disable/Enable button is actually in flight —
  // `pending` alone would put a spinner in all five rows for one click.
  const [acting, setActing] = useState<string | null>(null);

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  // Both constraints this screen enforces — the permanent-admin lock and the
  // self-disable refusal — are stated once here rather than inside a 130px
  // cell (card 3h still requires both be stated, just not squeezed into the
  // Access column). Derived from the same rule functions the actions call,
  // never a second copy of the wording.
  const permanentLockCaption = rows.find((r) => r.locked)?.locked ?? null;
  const selfRow = rows.find((r) => r.id === actorId);
  // Guarded the same way the per-row check below is: when the actor IS the
  // permanent admin, disableChange would return the lock reason again —
  // identical to permanentLockCaption above it — rather than the self-disable
  // wording, which would read as the same sentence stated twice.
  const selfDisableCaption =
    selfRow && !selfRow.locked && !selfRow.disabled
      ? refusalReason(disableChange(selfRow.target, true, actorId))
      : null;

  // A real generic, not a same-shape-assumed cast — setUserRole and
  // setUserDisabled don't share a data shape beyond `changed`. `changed` can
  // only be false when this row's props were already stale (another admin
  // edited it, or this tab was open across an edit), so `router.refresh()`
  // always runs on success: in that one case it's the entire remedy, not a
  // wasted round trip, and staying silent would leave the row looking like
  // the click did nothing, forever, until a manual reload.
  function run<T extends { changed: boolean }>(
    fn: () => Promise<ActionResult<T>>,
    messages: { changed: (data: T) => string; unchanged: string },
    opts?: { onOk?: () => void; onSettled?: () => void },
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          opts?.onOk?.();
          toast(res.data.changed ? messages.changed(res.data) : messages.unchanged, "settled");
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        } else {
          // Every refusal on this screen is a conflict or a forbidden — there
          // are no field-level inputs to hang a validation error on, so all
          // of them go to the banner rather than dead-ending silently.
          setError(res.message);
        }
      } finally {
        opts?.onSettled?.();
      }
    });
  }

  function submitRoleChange(row: UserRow, next: Role) {
    run(
      () => setUserRole({ userId: row.id, role: next }),
      {
        // The result also carries `signsOutActor`, deliberately unread here:
        // on a self change, router.refresh() above runs requireUser again,
        // whose JWT/DB role mismatch redirects this document to /logout — a
        // full navigation that tears down ToastProvider before a toast
        // queued this tick could reliably render. The confirm dialog already
        // said this before the click; a notice on /login is the only place
        // left for a post-redirect message, and that's out of scope here.
        changed: () => `${row.name} is now ${ROLE_LABELS[next]}`,
        unchanged: `${row.name} is already ${ROLE_LABELS[next]}`,
      },
      { onOk: () => setPendingChange(null) },
    );
  }

  function pickRole(row: UserRow, next: Role) {
    // One function decides when a role change signs the actor out, reading
    // the same `target` object `listUsers` built server-side — this never
    // restates that as `row.id === actorId` or re-synthesizes the target, so
    // the select and the action can't drift apart on when it applies.
    const warning = selfRoleChangeWarning(row.target, next, actorId);
    if (warning) {
      // A stale refusal from a different row's click must not leak into this
      // dialog, reading as though it were about the change being confirmed.
      setError(null);
      setRetryDeadline(null);
      setPendingChange({ row, next, warning });
    } else {
      submitRoleChange(row, next);
    }
  }

  function toggleDisabled(row: UserRow) {
    setActing(row.id);
    run(
      () => setUserDisabled({ userId: row.id, disabled: !row.disabled }),
      {
        changed: () => (row.disabled ? `${row.name} can sign in again` : `${row.name} is disabled`),
        unchanged: row.disabled ? `${row.name} can already sign in` : `${row.name} is already disabled`,
      },
      { onSettled: () => setActing(null) },
    );
  }

  return (
    <>
      {retryAfterSec !== null && !pendingChange && (
        <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
      )}
      {error && !pendingChange && <Banner tone="fault" title={error} />}

      <Table>
        <THead>
          <Tr>
            <Th>User</Th>
            <Th width={170}>Role</Th>
            <Th width={150}>Workspaces</Th>
            <Th width={110}>Sign-in</Th>
            <Th width={130}>Access</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => {
            // Card 3h's thesis — the constraint is STATED, never discovered
            // through a failed save — applies to this button exactly as it
            // applies to the locked row: an admin can never actually disable
            // their own account (disableChange refuses it outright, and a
            // disabled user is bounced before they could see this page
            // anyway), so a live "Disable" button on the actor's own row
            // could only ever end in a conflict banner. Call the same rule
            // the action calls and render its refusal as static text instead.
            const disableRefusal =
              !row.locked && !row.disabled ? refusalReason(disableChange(row.target, true, actorId)) : null;

            return (
              <Tr key={row.id} className={cn(row.locked && "bg-surface-subtle")}>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={row.name} size="sm" />
                    <span className="flex flex-col leading-tight">
                      <span className={cn("text-[12.5px]", row.disabled ? "text-fg-muted" : "text-fg")}>
                        {row.name}
                      </span>
                      <span className="font-mono text-[10.5px] text-fg-muted">
                        {row.email}
                        {row.locked && " · permanent"}
                        {!row.locked && row.disabled && " · disabled"}
                      </span>
                    </span>
                  </span>
                </Td>

                <Td>
                  {row.locked ? (
                    // Card 3h: the constraint is STATED. A LOCKED chip plus the
                    // static role label — never a select that fails on save.
                    // The reason it's locked lives in the caption below the
                    // table, not squeezed into this 170px cell.
                    <span className="flex items-center gap-1.5">
                      <Pill>LOCKED</Pill>
                      <span className="text-[12px] text-fg-muted">{ROLE_LABELS[row.role]}</span>
                    </span>
                  ) : (
                    <Select
                      aria-label={`Role for ${row.name}`}
                      value={row.role}
                      disabled={pending}
                      className="w-[150px] py-1.5 text-xs"
                      onChange={(e) => pickRole(row, e.target.value as Role)}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                      ))}
                    </Select>
                  )}
                </Td>

                <Td>
                  <span className="text-[12px] text-fg-secondary">{row.workspaces}</span>
                </Td>

                <Td>
                  <span className="font-mono text-[10.5px] text-fg-muted">{row.signIn}</span>
                </Td>

                <Td>
                  {row.locked ? (
                    <span className="text-[12px] text-fg-muted">Always enabled</span>
                  ) : disableRefusal ? (
                    // Short label in the cell; the sentence explaining it is
                    // in the caption below — the same width discipline as
                    // the locked row above.
                    <span className="text-[12px] text-fg-muted">Your own account</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={row.disabled ? "secondary" : "ghost"}
                      loading={acting === row.id}
                      disabled={pending}
                      aria-label={row.disabled ? `Enable ${row.name}` : `Disable ${row.name}`}
                      onClick={() => toggleDisabled(row)}
                    >
                      {row.disabled ? "Enable" : "Disable"}
                    </Button>
                  )}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      {(permanentLockCaption || selfDisableCaption) && (
        <div className="flex flex-col gap-1 px-1">
          {permanentLockCaption && (
            <p className="text-[11px] leading-snug text-fg-faint">{permanentLockCaption}</p>
          )}
          {selfDisableCaption && (
            <p className="text-[11px] leading-snug text-fg-faint">{selfDisableCaption}</p>
          )}
        </div>
      )}

      {/*
        A Dialog, not a static hint: the README reserves dialogs for decisions
        of this weight, and this is the one control on this screen that can
        end the actor's own session. The Select stays bound to `row.role`
        (prop, not local state), so cancelling — or the dialog just closing —
        snaps the visible value back to whatever is actually saved, with no
        extra state to reset by hand.
      */}
      <Dialog
        open={pendingChange !== null}
        onClose={() => setPendingChange(null)}
        title="Change your own role?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingChange(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => pendingChange && submitRoleChange(pendingChange.row, pendingChange.next)}
            >
              Change role
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {/* Dialog portals to document.body and its focus trap marks every
              other body child inert, so a refusal here has to render INSIDE
              the dialog or the operator sees the spinner stop and nothing else. */}
          {retryAfterSec !== null && (
            <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
          )}
          {error && <Banner tone="fault" title={error} />}
          <p>{pendingChange?.warning}</p>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Write the page**

Create `src/app/(app)/admin/users/page.tsx`:

```tsx
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { UserTable } from "@/components/admin/user-table";
import { listUsers } from "@/server/modules/admin/queries";

export default async function UsersPage() {
  const actor = await requireRole("admin");
  const rows = await listUsers();

  return (
    <>
      <PageHeader title="Users & roles" />
      <div className="flex max-w-[860px] flex-col gap-3">
        <Banner tone="neutral" title="Role decides which workspace someone lands in">
          Disabling an account keeps its history and blocks sign-in. The permanent admin cannot be
          demoted or disabled, so the system can never be locked out of itself.
        </Banner>
        <UserTable rows={rows} actorId={actor.id} />
      </div>
    </>
  );
}
```

`requireRole("admin")` rather than `requireUser()`: unlike `/admin/equipment-policies`, this path is
already admin-workspace-only in `PATH_RULES`, and only the `admin` role holds that workspace — so there
is no viewer read-only variant to design here. It returns the actor, whose `id` the table needs for the
two self-targeted rules.

- [ ] **Step 4: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

In the preview as `admin@thebackroomop.com`, `/admin/users` — **all of this was confirmed on
`8a604df`:**

1. Five rows with initials avatars, **System Admin first**, its email line suffixed `. permanent`, its
   Role cell showing a `LOCKED` chip and the static text `Admin`, its Access cell `Always enabled` with
   no button. The lock sentence is in the caption **below** the table, not in the cell.
2. The `Workspaces` column reads `all four` for the admin, `Purchasing` / `IT` / `Finance` for the
   staff roles, and **`IT . read-only`** for the viewer — the artboard's own strings.
3. Change `V. Cruz` from Viewer to IT staff, and the toast says so and the select holds its new value.
4. Disable `V. Cruz`, and the button flips to `Enable`, the name goes muted, the email line gains
   `. disabled`. Each Disable/Enable button's accessible name names its row.
5. `/audit` has two new `user` rows whose entity cell reads **`V. Cruz . viewer@thebackroomop.com`**
   (Task 2 changed this from the bare name), with actions `role-change` and `disable`, and **`Fields`
   reading `role` and `disabled`** — no phantom `email`.
6. **The self-targeted rules need a second admin, because the seeded `admin@` IS the permanent admin
   and its row is locked — the two bugs above are invisible from that account.** Promote `it@`, sign in
   as it, and check: its own row's Access cell reads `Your own account` with **no button**, and the
   self-disable sentence joins the caption. Changing its own role opens the confirm dialog naming the
   incoming role; Cancel snaps the select back to the saved value; Confirm writes, audits under the
   actor's own name, and lands on `/login`.
7. Put everything back afterwards. Note `AuditEntry` is append-only by DB trigger, so the entries this
   leaves behind cannot be removed — reseed if you need a pristine fixture, and prefer **delta**
   assertions over absolute audit counts in e2e (Task 14).

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/admin/queries.ts src/components/admin/user-table.tsx "src/app/(app)/admin/users/page.tsx" src/lib/admin-users.ts src/lib/admin-users.test.ts src/components/ui/dialog.tsx
git commit -m "feat(admin): users and roles, with the permanent admin locked before the click"
```

As shipped this was two commits, left unsquashed so the review verdict stays legible: `5d8e819` is the
task as originally written, `8a604df` (`fix(admin): the self-disable refusal is stated, not clicked
into`) is the review fix.

Verified green at `8a604df`: `npx tsc --noEmit` / `npm run lint` / **368 tests across 27 files** /
`npm run build` / **`npx playwright test --workers=1` gave 88 of 89**, the one failure being a
pre-existing navigation race in `e2e/offboarding.spec.ts` that this branch did not cause (it passed in a
single-file run; fixed separately in `bf23284`, since `ui/dialog.tsx` is used by six e2e-covered
components and the run existed to rule out a regression there).


### Task 4: The flag rules (TDD)

`FeatureFlag` is a key-value table, which means `/admin/flags` is one careless action away from being
an arbitrary writer into application configuration. This module is the allowlist: a flag this build
does not know about is not editable, and a flag whose feature is not finished cannot be turned on.

Scope decision #7 is the reason the second half of that sentence exists. Read it before you start.

> ### AMENDED to the shipped code (`cc43421` + `3ae53d2` + `e3191a2` + `3b158df`).
>
> The reviews changed the shape of this module, not just its details. **`flagChange` takes the flag's
> state and the requested direction, not a key** — Task 5's plan code below still calls `flagChange(key)`
> and must be updated. Five things to know:
>
> **1. CRITICAL, and the reason for the new signature: `allowed_domain` could be enabled with no value,
> and then the switch read ON while signup was wide open.** `isAllowedDomain` (`src/lib/auth-shared.ts`)
> returns `true` — **unrestricted** — whenever the domain is falsy, and `FeatureFlag.value` is `Json?`
> with no default. `createBootstrapAdmin` with the domain field left blank writes `(enabled: false,
> value: null)`, which is the resting state of **every deployment that bootstrapped without a domain**.
> One click on the switch made that `(true, null)`: any address on earth could then create an account,
> while `/admin/flags` rendered the switch ON beside *"Limits who may create an account."* `/signup` and
> `/login` correctly showed no restriction banner, so the two surfaces disagreed and **the admin page was
> the one lying.** `domainValue` refusing `""` was never the guard for this — that guards the *value*
> path, and this state is reached through the *enable* path.
>
> **2. `flagChange` refused turning `m365_sso` OFF as well as on — the third instance of one defect
> shape in this phase.** A database with `m365_sso.enabled = true` (hand-inserted, a restored backup, an
> operator experimenting) shows *Continue with Microsoft* on `/login` — the roleless-login path scope
> decision #7 exists to prevent — while the admin page renders the row ON with an UNAVAILABLE pill
> explaining the danger and **no way to switch it off.** HANDOVER §8 already recorded this shape for
> Task 1's `disableChange` (direction-blind, so the transition that repairs a lockout is the one it
> forbids) and Task 3's Critical was its mirror image. **Turning a dangerous thing off is never the
> dangerous direction.** `unavailable` now refuses only `next === true`.
>
> **3. `flagChangeWarning(state, next)` is new — `selfRoleChangeWarning`'s sibling.** Turning
> `allowed_domain` off opens account creation to any address on the public internet, and the plan's page
> wired the `<Switch>` straight to `setFlag` with no pre-click statement. `spec.description` is not a
> substitute: it is static and renders identically in both states. The consequence lives in
> **`FlagSpec.offWarning`** — spec data, exactly like `unavailable` — so a future consequential flag is a
> line in `FLAG_SPECS` rather than an edit to the function. It is deliberately **not** keyed off
> `hasValue`: a future value flag could be a numeric threshold whose off state widens nothing.
>
> **4. `m365_sso`'s description claimed a security property that does not exist.** It said the Microsoft
> button was *"for accounts in the allowed domain."* `isAllowedDomain` is called in exactly one place —
> the credentials `signUp` path — and there is no `signIn` callback anywhere in `src/server/auth`, so an
> Entra login is filtered by nothing: not domain, not an existing `User`, not role. That sentence is what
> an admin reads while deciding whether to want the feature. Now corrected, with a test asserting it
> never re-acquires the claim. **`prisma/seed.ts` still carries the same falsehood in the row's own
> `description` column** — which is why the page must render `spec.description` and never
> `row.description` (they also disagree about the safety warning).
>
> **5. The effective-value read was duplicated three times and about to become a fourth that disagreed.**
> `login/page.tsx`, `signup/page.tsx` and `signUp` each hand-rolled
> `flag?.enabled && typeof flag.value === "string" ? flag.value : null`. That is not a DRY nit: **the
> admin page must compute the enforced state with exactly the same expression as the signup gate, or the
> switch misrepresents reality.** Extracted as `flagDomain()` in `src/lib/auth-shared.ts`, with a trim —
> which makes the Critical above non-exploitable at every read site as defence in depth, independent of
> whatever rule guards the write. All three call sites now use it, and `e2e/auth-shell.spec.ts` was
> re-run (15/15) because those are Phase 2 auth files.
>
> Plus: `domainValue` gained a **253-character cap** (DNS's limit on a full name), and three regression
> tests that lock in the property making it safe — **its final check is an ASCII whitelist**, so it is
> immune to homoglyphs, to invisible Unicode format characters (U+200B/U+2060 are `Cf`, so `trim()`
> leaves them — the whitelist is the immunity, not the trim; contrast HANDOVER §8's 3-character reason
> minimum, which ends on a length check and does have that hole), and to a trailing dot. The refactor
> those guard against is real: collapsing the four sequential checks into one looser pattern like
> `/^[^\s@:/]+\.[^\s@:/]+$/` passes every test the plan originally specified while starting to accept a
> Cyrillic-о homoglyph, which would be a silent 100% signup lockout.

**Files:**
- Create: `src/lib/admin-flags.ts`, `src/lib/admin-flags.test.ts`
- Modify: `src/lib/auth-shared.ts` + `src/lib/auth-shared.test.ts` (add `flagDomain`),
  `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/server/auth/actions.ts`
  (use it)

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin-flags.test.ts`. **Write this first, run it, and confirm it fails because the
module does not exist** before writing Step 3.

```ts
import { describe, expect, it } from "vitest";
import {
  FLAG_SPECS, domainValue, flagChange, flagChangeWarning, specFor,
  type FlagSpec, type FlagState,
} from "./admin-flags";

const ssoOff: FlagState = { key: "m365_sso", enabled: false, value: null };
const ssoOn: FlagState = { key: "m365_sso", enabled: true, value: null };
const domainOff: FlagState = { key: "allowed_domain", enabled: false, value: null };
const domainOn: FlagState = { key: "allowed_domain", enabled: true, value: "thebackroomop.com" };
const domainOnNoValue: FlagState = { key: "allowed_domain", enabled: true, value: null };
const unknown: FlagState = { key: "arbitrary_key", enabled: false, value: null };

describe("FLAG_SPECS", () => {
  it("covers both seeded keys", () => {
    expect(FLAG_SPECS.map((f) => f.key).sort()).toEqual(["allowed_domain", "m365_sso"]);
  });

  it("gives every spec a label and a description, so no row renders a bare key", () => {
    for (const spec of FLAG_SPECS) {
      expect(spec.label).toBeTruthy();
      expect(spec.description).toBeTruthy();
    }
  });

  // The description is what an admin reads while deciding whether to want
  // this feature. isAllowedDomain is only ever called from the credentials
  // signUp path — there is no signIn callback anywhere, so an Entra login
  // isn't filtered by domain at all. Claiming otherwise would be read as a
  // fence that isn't there.
  it("does not claim m365_sso is domain-restricted, which isn't true", () => {
    const spec = specFor("m365_sso");
    expect(spec?.description).not.toMatch(/allowed domain/i);
  });
});

describe("specFor", () => {
  it("finds a known key", () => {
    expect(specFor("allowed_domain")?.hasValue).toBe(true);
  });

  it("returns null for a key this build doesn't know", () => {
    expect(specFor("something_someone_inserted")).toBeNull();
  });
});

describe("flagChange", () => {
  it("allows turning the domain restriction on when a value is already set", () => {
    expect(flagChange(domainOn, true)).toEqual({ allowed: true });
  });

  it("allows turning the domain restriction off, regardless of its value", () => {
    expect(flagChange(domainOn, false)).toEqual({ allowed: true });
    expect(flagChange(domainOnNoValue, false)).toEqual({ allowed: true });
  });

  // FeatureFlag.value is Json? with no default: (enabled: true, value: null)
  // is the resting state of a deployment that bootstrapped without a domain.
  // Enabling from there would render the switch ON beside "limits who may
  // create an account" while signup stays open to any address — the switch
  // would be lying. Only the "turn ON" direction is guarded; turning off
  // never needs a value.
  it("refuses turning the domain restriction on with no value set", () => {
    const res = flagChange(domainOnNoValue, true);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/set a domain/i);
    expect(res.allowed === false && res.reason).not.toMatch(/doesn't recognise/i);
    expect(res.allowed === false && res.reason).not.toMatch(/not wired|isn't wired/i);
  });

  it("refuses turning the domain restriction on with a whitespace-only value", () => {
    const res = flagChange({ key: "allowed_domain", enabled: true, value: "   " }, true);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/set a domain/i);
  });

  // Scope decision #7: auth/index.ts still carries TODO(sso-phase) — there is no
  // signIn callback mapping an Entra profile to a User row, so enabling this on a
  // deployment that HAS the env vars surfaces a button that authenticates and
  // lands a user with no role.
  it("refuses turning m365_sso on and explains that SSO isn't wired yet", () => {
    const res = flagChange(ssoOff, true);
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/not wired|isn't wired|no role/i);
    expect(res.allowed === false && res.reason).not.toMatch(/set a domain/i);
    expect(res.allowed === false && res.reason).not.toMatch(/doesn't recognise/i);
  });

  // The Critical this fix addresses: a key-only refusal would also block
  // turning OFF an m365_sso row that got enabled out of band (hand-inserted,
  // a restored backup, an operator experimenting) — exactly the repair scope
  // decision #7 needs to stay reachable. Turning a dangerous thing off is
  // never the dangerous direction.
  it("allows turning m365_sso off even though it can't be turned on", () => {
    expect(flagChange(ssoOn, false)).toEqual({ allowed: true });
  });

  // The table is key-value: without this, /admin/flags writes arbitrary config.
  // Refused in both directions — unlike m365_sso, there is no legitimate row
  // behind an unrecognised key for an "off" transition to repair.
  it("refuses a key with no spec, in either direction", () => {
    const on = flagChange(unknown, true);
    const off = flagChange(unknown, false);
    expect(on.allowed).toBe(false);
    expect(on.allowed === false && on.reason).toMatch(/doesn't recognise|not a flag/i);
    expect(off.allowed).toBe(false);
    expect(off.allowed === false && off.reason).toMatch(/doesn't recognise|not a flag/i);
  });
});

describe("flagChangeWarning", () => {
  // The consequence of THIS direction: opens signup to any address on the
  // public internet. Stated pre-click so the page and the action can't
  // disagree about when it applies — selfRoleChangeWarning's sibling.
  it("warns when turning the domain restriction off", () => {
    expect(flagChangeWarning(domainOn, false)).toMatch(/any email address/i);
  });

  it("is null when turning the domain restriction on", () => {
    expect(flagChangeWarning(domainOff, true)).toBeNull();
  });

  it("is null for a flag other than allowed_domain, in either direction", () => {
    expect(flagChangeWarning(ssoOn, false)).toBeNull();
    expect(flagChangeWarning(ssoOff, true)).toBeNull();
  });

  it("is null for a key this build doesn't know", () => {
    expect(flagChangeWarning(unknown, false)).toBeNull();
  });

  it("returns each spec's own offWarning", () => {
    for (const spec of FLAG_SPECS) {
      const state: FlagState = { key: spec.key, enabled: true, value: "thebackroomop.com" };
      expect(flagChangeWarning(state, false)).toBe(spec.offWarning);
    }
  });

  // The one above only catches DRIFT between the spec and the function. This
  // one catches the structure: it registers a flag the function has never heard
  // of and requires the warning to follow, which a `key === "allowed_domain"`
  // branch cannot do however carefully its string is copied. That branch is
  // what this module started with, and reintroducing it is the regression —
  // the point of `offWarning` is that a new consequential flag is a line in
  // FLAG_SPECS and not an edit here.
  it("follows spec data for a flag added at runtime, not a hardcoded key", () => {
    const probe: FlagSpec = {
      key: "probe_flag",
      label: "Probe",
      description: "Registered by a test.",
      hasValue: false,
      unavailable: null,
      offWarning: "Probe consequence.",
    };
    FLAG_SPECS.push(probe);
    try {
      const state: FlagState = { key: "probe_flag", enabled: true, value: null };
      expect(flagChangeWarning(state, false)).toBe("Probe consequence.");
      expect(flagChangeWarning(state, true)).toBeNull();
    } finally {
      FLAG_SPECS.splice(FLAG_SPECS.indexOf(probe), 1);
    }
    expect(FLAG_SPECS.map((f) => f.key)).not.toContain("probe_flag");
  });
});

describe("domainValue", () => {
  it("accepts a plain domain and lowercases it", () => {
    expect(domainValue("  TheBackroomOp.com ")).toEqual({ ok: true, value: "thebackroomop.com" });
  });

  it("accepts a subdomain", () => {
    expect(domainValue("mail.thebackroomop.com")).toEqual({ ok: true, value: "mail.thebackroomop.com" });
  });

  // Asserted on the reason, not just `.ok`: the trailing domain-format check
  // would ALSO reject "someone@thebackroomop.com" (the "@" isn't a valid
  // domain character), so a mere `.ok === false` can't tell the dedicated
  // "@" check apart from that fallback catching the same input by accident.
  it("rejects an address rather than silently keeping the local part", () => {
    const res = domainValue("someone@thebackroomop.com");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/full address/i);
  });

  it("rejects a bare word with no dot", () => {
    expect(domainValue("localhost").ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(domainValue("   ").ok).toBe(false);
  });

  // Same trap as the address test above: the trailing domain-format check
  // would ALSO reject "https://thebackroomop.com" (":" and "/" aren't valid
  // domain characters either), so `.ok === false` alone can't tell the
  // dedicated scheme check apart from that fallback firing by coincidence.
  it("rejects a scheme", () => {
    const res = domainValue("https://thebackroomop.com");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/https:\/\//i);
  });

  it("rejects a domain longer than DNS's 253-character cap", () => {
    const res = domainValue(`${"a".repeat(250)}.com`); // 254 chars, otherwise well-formed
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/253|too long/i);
  });

  // The property that makes the final check safe is that it's an ASCII
  // WHITELIST, not "has a dot" or some other shape test — so a refactor that
  // "obviously" covers the address/scheme/bare-word cases with one looser
  // pattern (e.g. /^[^\s@:/]+\.[^\s@:/]+$/) would start accepting these three
  // and pass every other test in this file unchanged. The immunity is the
  // whitelist, not trim() — trim() only strips real whitespace (Zs/line
  // terminators), not the format characters (Cf) used below.
  it("rejects a domain containing a Cyrillic homoglyph, not just a Latin lookalike", () => {
    // "thebackrоomop.com" reads as thebackroomop.com but the 'о' after
    // "backr" is CYRILLIC SMALL LETTER O (U+043E), not Latin 'o'.
    expect(domainValue("thebackrоomop.com").ok).toBe(false);
  });

  it("rejects a domain carrying a zero-width space", () => {
    expect(domainValue("thebackroomop​.com").ok).toBe(false);
  });

  it("rejects a domain carrying a trailing word joiner", () => {
    expect(domainValue("thebackroomop.com⁠").ok).toBe(false);
  });

  it("rejects a trailing dot, which exact comparison would otherwise silently lock everyone out", () => {
    expect(domainValue("thebackroomop.com.").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/lib/admin-flags.test.ts
```

Expect `Cannot find module './admin-flags'`. That is the RED step; do not skip past it.

- [ ] **Step 3: Write the module**

Create `src/lib/admin-flags.ts`:

```ts
import type { RuleResult } from "./admin-users";

export interface FlagSpec {
  key: string;
  label: string;
  description: string;
  /** value flags render a text editor beside the switch (allowed_domain) */
  hasValue: boolean;
  /** non-null → turning this ON is refused, and this is the reason to print */
  unavailable: string | null;
  /**
   * non-null → turning this OFF is allowed but consequential, and this is the
   * sentence to state before the click. Spec data rather than a branch in
   * `flagChangeWarning`, for the same reason `unavailable` is: the consequence
   * belongs to the individual flag, and it is NOT derivable from `hasValue` —
   * a future value flag could be a numeric threshold whose off state widens
   * nothing, and attaching this sentence to it would be a new lie.
   */
  offWarning: string | null;
}

/**
 * The allowlist. `FeatureFlag` is a key-value table, so without this the flags
 * page is an arbitrary writer into application configuration — a row someone
 * inserted by hand would render with an editable switch and no meaning.
 */
export const FLAG_SPECS: FlagSpec[] = [
  {
    key: "m365_sso",
    label: "Microsoft 365 sign-in",
    // No domain-restriction claim here: isAllowedDomain is only ever called
    // from the credentials signUp path (src/server/auth/actions.ts). There is
    // no signIn callback anywhere in src/server/auth, so an Entra login is
    // filtered by nothing — not domain, not an existing User, not role. This
    // description is what an admin reads while deciding whether to want this
    // feature; claiming a fence that doesn't exist would be the lie, not the
    // fix, the moment someone wires the callback and forgets the domain check.
    description: "Offers Continue with Microsoft on the sign-in page. Domain restriction is not applied to this path.",
    hasValue: false,
    // Scope decision #7. src/server/auth/index.ts registers the Entra provider
    // whenever three env vars are present, but carries TODO(sso-phase): there is
    // no signIn callback resolving an Entra profile to a User row. So on the one
    // deployment that has configured the env vars, flipping this switch produces
    // a button that authenticates and then lands a user carrying no role.
    // Wiring SSO needs real tenant credentials; when they exist, the work is that
    // callback plus deleting this string.
    unavailable:
      "Single sign-on isn't wired up yet — an Entra login would arrive with no role attached, so this switch stays off until that callback exists.",
    // Nothing to warn about: it cannot be on in the first place, and if a row
    // arrived enabled out of band then turning it off is the repair, not a risk.
    offWarning: null,
  },
  {
    key: "allowed_domain",
    label: "Signup domain restriction",
    description:
      "Limits who may create an account. Turn it off and any email address can sign up.",
    hasValue: true,
    unavailable: null,
    offWarning: "Turning this off lets anyone with any email address create an account.",
  },
];

export function specFor(key: string): FlagSpec | null {
  return FLAG_SPECS.find((f) => f.key === key) ?? null;
}

/**
 * The row as flagChange/flagChangeWarning need to see it, mirroring
 * TargetUser / roleChange(target, next, actorId) — the rule reads the row
 * plus the requested direction, not just the key, because "turn on" and
 * "turn off" are different questions for both flags this build knows about.
 * `value` is the flag's stored value already narrowed to a plain string (or
 * null); callers read it off `FeatureFlag.value`, which is `Json?`.
 */
export interface FlagState {
  key: string;
  enabled: boolean;
  value: string | null;
}

/**
 * One rule for both the page (which greys the row / disables the switch) and
 * the action (which refuses). Takes the direction because turning a
 * dangerous thing OFF is never the dangerous direction — this phase has hit
 * the same defect shape twice already (HANDOVER §8: the permanent-admin lock
 * refuses re-enabling that account exactly as it refuses disabling it, so the
 * one transition that repairs an out-of-band lockout is the one the rule
 * forbids; Task 3's self-disable Critical was the mirror image). A key-only
 * refusal here would make this a third: it would refuse turning OFF an
 * `m365_sso` row that got enabled out of band — hand-inserted, a restored
 * backup, an operator experimenting — which is exactly the repair scope
 * decision #7 needs to stay reachable.
 */
export function flagChange(state: FlagState, next: boolean): RuleResult {
  const spec = specFor(state.key);
  if (!spec) {
    return {
      allowed: false,
      reason: `This build doesn't recognise the flag "${state.key}", so it can't be changed here.`,
    };
  }
  if (spec.unavailable && next) {
    return { allowed: false, reason: spec.unavailable };
  }
  // allowed_domain, turned ON with nothing to enforce: FeatureFlag.value is
  // Json? with no default, so (enabled: true, value: null) is the resting
  // state of any deployment that bootstrapped without a domain — and
  // flagDomain (src/lib/auth-shared.ts) reads that as unrestricted. Enabling
  // with no value would make the switch claim a restriction signup doesn't
  // enforce, so this is refused on the way in rather than left to render a
  // lie once it's saved.
  if (spec.hasValue && next && !state.value?.trim()) {
    return {
      allowed: false,
      reason: "Set a domain first — an empty restriction lets any address sign up.",
    };
  }
  return { allowed: true };
}

/**
 * selfRoleChangeWarning's sibling: a consequence that's true before the click,
 * returned as one string so the page states it pre-click and the action cannot
 * compute a different answer. Reads `spec.offWarning` rather than testing the
 * key, so adding a flag with a consequential off state is a line in FLAG_SPECS
 * and not a branch here.
 *
 * Only the OFF direction has warnings today. Turning something ON is either
 * refused outright (`unavailable`, or `allowed_domain` with no value) or
 * unremarkable, and a refusal is not a warning — flagChange owns that.
 */
export function flagChangeWarning(state: FlagState, next: boolean): string | null {
  if (next) return null;
  return specFor(state.key)?.offWarning ?? null;
}

export type DomainResult = { ok: true; value: string } | { ok: false; reason: string };

/**
 * `allowed_domain` is compared against the part of an address after the "@"
 * (src/lib/auth-shared.ts), so storing "someone@example.com" or "https://…"
 * silently locks everyone out rather than failing loudly. Normalise and refuse.
 */
export function domainValue(raw: string): DomainResult {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, reason: "Enter a domain, e.g. thebackroomop.com" };
  if (value.includes("@")) {
    return { ok: false, reason: "Just the domain, not a full address — thebackroomop.com" };
  }
  if (value.includes("/") || value.includes(":")) {
    return { ok: false, reason: "Just the domain, with no https:// in front of it" };
  }
  // DNS caps a full name at 253 characters. This value is interpolated into
  // /signup and /login copy and stored in an uncapped Json column, so an
  // absurd length is a storage/rendering honesty concern, not a performance
  // one — the regex below has no catastrophic-backtracking exposure to guard
  // against.
  if (value.length > 253) {
    return { ok: false, reason: "That's too long for a domain — 253 characters max" };
  }
  // An ASCII whitelist, not merely "has a dot": this is what rejects a
  // Cyrillic-о homoglyph and the invisible Unicode format characters (Cf,
  // not Zs — trim() above only strips real whitespace, not these) that could
  // otherwise ride along in a pasted domain. The immunity comes from this
  // whitelist, not from the trim() call.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return { ok: false, reason: "That doesn't look like a domain — try thebackroomop.com" };
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: The shared effective-value reader**

Add `flagDomain` to `src/lib/auth-shared.ts` (the whole file, for context — only the last function is
new), then replace the hand-rolled expression in `src/app/(auth)/login/page.tsx`,
`src/app/(auth)/signup/page.tsx` and `src/server/auth/actions.ts` with a call to it. Change **only**
that expression in those three files; they are Phase 2 auth code covered by `e2e/auth-shell.spec.ts`.

```ts
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * allowedDomain comes from the allowed_domain feature flag's value when the
 * flag is enabled; null/undefined/"" means unrestricted. Matching is exact
 * on the text after the LAST @ — subdomains are different domains.
 */
export function isAllowedDomain(
  email: string,
  allowedDomain: string | null | undefined,
): boolean {
  if (!allowedDomain) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === allowedDomain.toLowerCase();
}

/**
 * The one expression for "is allowed_domain actually enforced right now" —
 * every reader of the flag (login page, signup page, the signUp gate itself)
 * must compute the SAME thing, or the admin page can describe a stricter
 * reality than the gate enforces. `enabled` alone isn't the answer:
 * `FeatureFlag.value` is `Json?` with no default, so `(enabled: true, value:
 * null)` is the resting state of any deployment that bootstrapped without a
 * domain, and would otherwise read as "restricted" while isAllowedDomain
 * treats it as wide open. The trim defends the same read against `(enabled:
 * true, value: "")` or `(… value: "   ")` — not reachable through this
 * build's own write path once admin-flags.ts's flagChange guards it, but a
 * value can still arrive here from psql or a future migration.
 */
export function flagDomain(
  flag: { enabled: boolean; value: unknown } | null | undefined,
): string | null {
  if (!flag?.enabled || typeof flag.value !== "string") return null;
  const trimmed = flag.value.trim();
  return trimmed ? trimmed : null;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

- [ ] **Step 6: Mutation-test it — every branch, not a sample**

Break each of these, confirm a test dies **and name which one**, then restore:

1. `flagChange`'s direction guard: `spec.unavailable && next` → `spec.unavailable`.
2. `flagChange`'s enable-with-no-value branch, removed entirely.
3. `flagChangeWarning`'s `if (next) return null`.
4. **`flagChangeWarning` reading `spec.offWarning` → a hardcoded `key === "allowed_domain"` branch
   returning the same sentence.** This one is instructive: the "returns each spec's own offWarning"
   test **passes** under it, because the copied string agrees — a drift test cannot catch a faithful
   duplicate. The test that kills it registers a flag at runtime and requires the warning to follow.
   That is the difference between testing agreement and testing structure.
5. `flagDomain`'s `.trim()`, and its `typeof value === "string"` check.
6. `domainValue`'s `@` check, its scheme check, and its 253-char cap — note the first two need
   assertions on the refusal's **`reason`**, not just `ok === false`: the trailing format regex already
   rejects `@`, `/` and `:`, so an `ok`-only assertion passes for the wrong reason and cannot detect the
   deleted branch. The plan originally specified `ok`-only assertions here and they were a real defect.

If a mutation leaves the suite green, the test for that rule is not testing it — fix the test.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
npx playwright test e2e/auth-shell.spec.ts --workers=1
git add src/lib/admin-flags.ts src/lib/admin-flags.test.ts src/lib/auth-shared.ts src/lib/auth-shared.test.ts "src/app/(auth)/login/page.tsx" "src/app/(auth)/signup/page.tsx" src/server/auth/actions.ts
git commit -m "feat(admin): the flag allowlist, with SSO held shut until it works"
```

As shipped this was four commits, left unsquashed so the review trail stays legible: `cc43421` (the
task as written), `3ae53d2` (a test asserting `domainValue`'s reason text rather than only `ok`),
`e3191a2` (the review fix), `3b158df` (`offWarning` as spec data).

Verified green at `3b158df`: `npx tsc --noEmit` / `npm run lint` / **404 tests across 28 files** /
`npx playwright test e2e/auth-shell.spec.ts` 15/15.


### Task 5: Flag actions + `/admin/flags`

Card `3h`: switch rows with a description line. Two of them, one of which also carries a value.

> ### AMENDED to the shipped code (`ce275c1` + `3157a5c` + `aaca261`). The earlier REQUIRED AMENDMENT banner's ten guarantees are all satisfied and folded in.
>
> The code below is what shipped and was confirmed in the browser. **Read #1 even if you read nothing
> else: it is the fifth instance of one defect shape in five tasks, and the rule against it was already
> written down when this task shipped it anyway.**
>
> **1. The audit diffs carried `key: { from: X, to: X }`, so `/audit` said the flag's key changed.**
> `/audit` renders diff **key names**, so the Fields cell read `key, enabled` / `key, value` — telling a
> future reader the key itself was edited, in a table that is append-only by DB trigger and can never be
> corrected. This is **HANDOVER §6a rule 8 verbatim**, written after Task 2 shipped
> `email: { from: X, to: X }` "to carry identity" and made `/audit` print `Fields: disabled, email`. It
> does not qualify for the one sanctioned from-equals-to precedent (`offboarding.completed`'s
> `m365Status`), which earns it by snapshotting something a mutable row can lose: **nothing writes
> `FeatureFlag.key` anywhere in `src/`, and there is no flag-deletion path.** The comment defending it was
> also false — it claimed the entity label resolved to the key, which it did not (see #2). Both diffs now
> carry only the column they change.
>
> **2. `/audit` could not name a `feature-flag` row, and no task in this plan ever fixed it.**
> `entityLabels` had no `feature-flag` branch, so every flag row fell to the truncated-id fallback: an
> unlinked `clx1234567…`. Task 2 added a `user` branch for exactly this reason. Task 7 adds only
> `webhook-endpoint`, so this was never scheduled — meaning the single most consequential change the app
> can record ("who may create an account was opened to the world") would have landed in the log as
> `feature-flag | clx1234567… | update | key, enabled`. **Confirmed fixed in the browser:** the row now
> reads `FEATURE-FLAG allowed_domain | flag-value | value`.
> `AUDIT_ENTITY_TYPES` in `src/lib/audit-list.ts` is a **separate** gap and is still Task 7's (it adds
> both `feature-flag` and `webhook-endpoint` there), so until Task 7 lands the Entity **facet** cannot
> filter to these rows even though the label resolves.
>
> **3. `setFlagValue` wrote with no before-value guard.** Every sibling write in the codebase guards on
> the before-value, and this module's own comment boasted that "the value it checks is the one this write
> is guarded on" — a guarantee that did not extend to the action writing that column. Two admins saving
> different domains: the second silently discards the first, **and the trail keeps two entries both
> claiming the same `from`**, the second of which is false, permanently. Now a state-guarded `updateMany`
> **keyed on `updatedAt`** rather than on `value`: `value` is `Json?`, so an equality filter needs
> `Prisma.DbNull` for the null case and is fiddly, whereas `updatedAt` is `@updatedAt` and therefore a
> clean optimistic-concurrency token that also catches a concurrent `enabled` flip.
>
> **4. The rate-limit countdown restarted across the dialog boundary — Task 3's bug, re-shipped.**
> `retryAfter` held a duration, `RateLimitNotice` resets its countdown on every mount, and this component
> mounts it twice (card list and dialog). Now the `retryDeadline` timestamp pattern from
> `user-table.tsx:41-53`, copied rather than re-solved.
>
> **Also, from the same review:** distinct audit verbs (`flag-enable` / `flag-disable` / `flag-value`)
> so `/audit`'s Action column distinguishes a switch flip from a value edit — both were `update`; both
> actions now return `{ changed }` per §6a rule 6, so `revalidateAll()` no longer fires on a no-op and the
> value toast stops claiming "updated" when nothing was written; the `draft` box is reset from the
> normalized value on success, closing the case the `valuesKey` effect structurally cannot reach (stored
> `example.com`, typed `EXAMPLE.COM` — normalizes to the same string, nothing written, key unchanged, box
> keeps the uppercase forever); `setFlag`'s `validation` refusal routes to the **banner**, since
> `FormError` only exists inside the `hasValue && !unavailable` block and a validation refusal on
> `m365_sso` would otherwise vanish silently; `acting` is a composite `${key}:toggle` / `${key}:save` key
> so a switch confirmation no longer spins the unrelated Save button; and the page's copy no longer says
> *"the switch stays off until it is"*, which is false in the one state rule 14 deliberately keeps
> closeable.
>
> **One earlier fix folded in (`3157a5c`):** the component computed `flagChange(row.state, next)` and used
> the verdict only to set the switch's `disabled` prop — `verdict.reason` was never rendered, and
> `row.unavailable` is `null` for `allowed_domain`, so a row with no usable value showed a **dead switch
> with no explanation.** The two `<p>` blocks are deliberately separate: `unavailable` belongs to the
> **flag** and prints whenever set (including when the switch is live because the row is already on and
> closing it is permitted — precisely when the admin most needs it), while `verdict.reason` belongs to
> **this click**.
>
> **A correction to a comment this task shipped, worth keeping straight:** `(enabled: true, value: null)`
> is **not** "the resting state of a deployment that bootstrapped without a domain."
> `createBootstrapAdmin` writes `enabled: !!domain, value: domain || undefined`, so a blank domain gives
> **`(false, null)`**. And `(true, null)` now has **no in-app producer at all**, since `flagChange`
> refuses it — it is reachable only out of band (psql, a restored backup, a migration). Both states render
> OFF, disabled, with the reason, so the behaviour was always right; the comment was not.

**Files:**
- Create: `src/server/modules/admin/flag-actions.ts`, `src/components/admin/flag-rows.tsx`,
  `src/app/(app)/admin/flags/page.tsx`
- Modify: `src/server/modules/admin/queries.ts` (add `FlagRow` / `listFlags`),
  `src/server/modules/audit/queries.ts` (add the `feature-flag` label branch)

- [ ] **Step 1: Write the actions**

Create `src/server/modules/admin/flag-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { domainValue, flagChange, specFor, type FlagState } from "@/lib/admin-flags";
import { asActionResult } from "@/server/prisma-errors";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/**
 * Both /login and /signup read these flags on every render, and the bootstrap
 * action upserts allowed_domain — so a flag write has to invalidate the auth
 * pages as well as its own.
 */
const PATHS = ["/admin/flags", "/login", "/signup"] as const;

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

const setSchema = z.object({ key: z.string().min(1), enabled: z.boolean() });

export async function setFlag(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { key, enabled } = parsed.data;

  // Same discriminated-on-.ok shape as user-actions.ts: every path below
  // returns a full ActionResult, so the caller can tell a real refusal apart
  // from a truthy-but-successful no-op.
  //
  // flagChange is called AFTER the row is read, inside this transaction —
  // not before it. It used to run pre-transaction against just the key, but
  // the new signature needs `value`, and the guarantee this task owns is
  // that the value it checks is the one this write is guarded on, not
  // whatever the page happened to render with: the stored value can change
  // between the render and this click, so re-reading it here is the point,
  // not an optimization to skip.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const flag = await tx.featureFlag.findUnique({ where: { key } });
        if (!flag) return conflict(`The flag "${key}" isn't in the database.`);

        const state: FlagState = {
          key: flag.key,
          enabled: flag.enabled,
          value: typeof flag.value === "string" ? flag.value : null,
        };
        const verdict = flagChange(state, enabled);
        if (!verdict.allowed) return conflict(verdict.reason);

        if (flag.enabled === enabled) return ok({ changed: false }); // no-op: don't pollute the trail

        const written = await tx.featureFlag.updateMany({
          where: { key, enabled: flag.enabled },
          data: { enabled },
        });
        if (written.count === 0) return conflict("Someone else just changed that flag — refresh.");

        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "feature-flag",
          entityId: flag.id,
          // Distinct per direction so /audit's Action column can tell a switch
          // flip apart from a value edit (setFlagValue uses "flag-value").
          action: enabled ? "flag-enable" : "flag-disable",
          // No `key` entry here: /audit renders diff KEY NAMES, not values, so
          // a from-equals-to `key` field would print "Fields: key, enabled" —
          // telling a reader the flag's key itself changed. It didn't; nothing
          // writes FeatureFlag.key and there is no flag-deletion path, so this
          // doesn't qualify for the one sanctioned from===to precedent
          // (offboarding.completed's m365Status, which snapshots a value a
          // mutable row can later lose). The flag is already named — see
          // entityLabels' "feature-flag" branch in audit/queries.ts.
          diff: { enabled: { from: flag.enabled, to: enabled } },
        });
        return ok({ changed: true });
      }),
    { goneMessage: "That flag no longer exists." },
  );
  if (!result.ok) return result;
  if (result.data.changed) revalidateAll();
  return result;
}

const valueSchema = z.object({ key: z.string().min(1), value: z.string() });

export async function setFlagValue(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = valueSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { key } = parsed.data;

  const spec = specFor(key);
  if (!spec?.hasValue) return conflict(`The flag "${key}" doesn't carry a value.`);

  // `value` has exactly one write path, and this is it: domainValue is the
  // only function on it, there is no clear/reset branch, and nothing past
  // this line can store null, "", or a non-string. flagChange is deliberately
  // NOT called here — it takes a direction (turning the flag on/off), and a
  // value edit isn't that; the flag's `enabled` column is untouched by this
  // action on every path.
  const domain = domainValue(parsed.data.value);
  if (!domain.ok) return validationError({ value: domain.reason });

  // Today allowed_domain is the only value flag, and its value is a domain.
  // When a second one arrives, this is the line that has to learn to branch.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const flag = await tx.featureFlag.findUnique({ where: { key } });
        if (!flag) return conflict(`The flag "${key}" isn't in the database.`);
        const before = typeof flag.value === "string" ? flag.value : null;
        if (before === domain.value) return ok({ changed: false });

        // Guarded on `updatedAt`, not on `value`: `value` is Json?, and an
        // equality filter on it needs Prisma.DbNull for the null case and is
        // fiddly to get right, where `updatedAt` is `@updatedAt` and so is
        // already a clean optimistic-concurrency token — bumped by ANY write
        // to this row, which is a bonus: it also catches a concurrent
        // `enabled` flip racing this value edit, not just a concurrent value
        // edit. Without this guard, two admins reading the same `before` and
        // saving different values would let the second write silently
        // discard the first, while BOTH audit rows claimed `from: before` —
        // the second one falsely, forever.
        const written = await tx.featureFlag.updateMany({
          where: { key, updatedAt: flag.updatedAt },
          data: { value: domain.value },
        });
        if (written.count === 0) return conflict("Someone else just changed that flag — refresh.");

        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "feature-flag",
          entityId: flag.id,
          // Distinct from setFlag's "flag-enable"/"flag-disable" — see the
          // comment there.
          action: "flag-value",
          // No `key` entry — see the matching comment in setFlag.
          diff: { value: { from: before, to: domain.value } },
        });
        return ok({ changed: true });
      }),
    { goneMessage: "That flag no longer exists." },
  );
  if (!result.ok) return result;
  if (result.data.changed) revalidateAll();
  return result;
}
```

- [ ] **Step 2: Add the query**

Append `FlagRow` and `listFlags` to `src/server/modules/admin/queries.ts`. The two things to get right
are that **`enabled` is the EFFECTIVE state** (via `flagDomain`, the same expression `/login` and
`/signup` use) while **`state` carries the RAW row** — feeding the rule the effective value would hand it
a lie for exactly the row it exists to correct.

- [ ] **Step 3: Add the `feature-flag` branch to `entityLabels`**

In `src/server/modules/audit/queries.ts`, following the existing `Promise.all` + `byType.has(...)` shape:
`prisma.featureFlag.findMany({ where: { id: { in: [...] } }, select: { id: true, key: true } })`, then
`map.set(\`feature-flag:${f.id}\`, { label: f.key, href: "/admin/flags" })`. Without it every flag row
in the log is an unlinked truncated cuid.

- [ ] **Step 4: Write the rows component**

Create `src/components/admin/flag-rows.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { domainValue, flagChange, flagChangeWarning } from "@/lib/admin-flags";
import { setFlag, setFlagValue } from "@/server/modules/admin/flag-actions";
import type { ActionResult } from "@/server/action-result";
import type { FlagRow } from "@/server/modules/admin/queries";

/** A switch flip picked for a row whose rule returned a warning, waiting on the confirm dialog. */
interface PendingToggle {
  row: FlagRow;
  next: boolean;
  warning: string;
}

export function FlagRows({ rows }: { rows: FlagRow[] }) {
  const router = useRouter();
  const toast = useToast();
  // `pending` itself is unused: `startTransition` still batches the async
  // calls below, but per-control busy state is tracked by `acting` instead —
  // see its comment.
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the SAME composite key as `acting` (`${row.key}:save`), not by
  // `row.key` alone: today only Save ever populates this, but keying it to
  // the control rather than the row keeps the two maps consistent if a
  // second control on a row ever needs its own field error.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // A deadline, not a duration — RateLimitNotice resets its own countdown on
  // every mount, and this component remounts it (top of the list vs. inside
  // the confirm dialog). Storing "when it ends" and computing the remaining
  // seconds fresh at render, instead of a `retryAfterSec` captured once, is
  // what keeps crossing that boundary from restarting the clock (Task 3's
  // bug, in user-table.tsx:41-53 — copied here rather than re-solved).
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  // Scoped to the one control actually in flight (`${row.key}:toggle` or
  // `${row.key}:save`) — the precedent is user-table.tsx's `acting`. Without
  // this, a single shared `pending` flag puts a spinner on every row's Save
  // button while a different row's switch confirmation is still in flight.
  const [acting, setActing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])),
  );

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  // `router.refresh()` re-renders this component with new `rows` props without
  // remounting it, so the lazy initializer above only ever runs once — left
  // alone, a Save that comes back normalized (lowercased, say) would write the
  // canonical value to the database while the input kept showing whatever the
  // admin actually typed. Keyed on the values themselves, not on `rows` (a new
  // array every render), so an unrelated switch toggle's refresh — which never
  // touches `value` — doesn't stomp an edit still in progress on this field.
  //
  // This alone still misses a NORMALIZING no-op: if the stored value is
  // "example.com" and the admin types "EXAMPLE.COM", domainValue normalizes
  // to the same string, nothing is written, and this key doesn't change — so
  // the box would keep showing "EXAMPLE.COM" forever. The Save handler below
  // covers that case directly, from the same domainValue() call it uses to
  // decide whether to submit at all.
  const valuesKey = rows.map((r) => `${r.key}:${r.value ?? ""}`).join("|");
  useEffect(() => {
    setDraft(Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey]);

  // A real generic over the one shape both actions share. `changed` decides
  // the toast wording (a value Save that normalizes to what's already stored
  // writes nothing and must not claim "updated"), but `router.refresh()` runs
  // on every `ok` regardless — the no-op branch is reachable only when this
  // row's props are already stale (another admin, or another tab, changed
  // the same flag), and in that one case the refresh IS the remedy. Staying
  // silent would leave the control looking like the click did nothing,
  // forever, until a manual reload.
  function run(
    actingKey: string,
    fn: () => Promise<ActionResult<{ changed: boolean }>>,
    messages: { changed: string; unchanged: string },
    opts?: {
      onOk?: (data: { changed: boolean }) => void;
      onSettled?: () => void;
      /** Where a `validation` refusal belongs. Only Save has a field to put it in. */
      validationTarget?: "field" | "banner";
    },
  ) {
    setError(null);
    setFieldErrors((f) => ({ ...f, [actingKey]: "" }));
    setActing(actingKey);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          opts?.onOk?.(res.data);
          toast(res.data.changed ? messages.changed : messages.unchanged, "settled");
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        } else if (res.kind === "validation" && opts?.validationTarget === "field") {
          setFieldErrors((f) => ({ ...f, [actingKey]: Object.values(res.fieldErrors ?? {})[0] ?? res.message }));
        } else {
          // forbidden, conflict, or a validation refusal with no field to
          // hang it on (setFlag's schema has none — unreachable today, but a
          // refusal that routes nowhere is a silent failure waiting for the
          // day it isn't).
          setError(res.message);
        }
      } finally {
        setActing(null);
        opts?.onSettled?.();
      }
    });
  }

  function submitToggle(row: FlagRow, next: boolean) {
    run(
      `${row.key}:toggle`,
      () => setFlag({ key: row.key, enabled: next }),
      {
        changed: `${row.label} is ${next ? "on" : "off"}`,
        unchanged: `${row.label} is already ${next ? "on" : "off"}`,
      },
      { onOk: () => setPendingToggle(null) },
    );
  }

  function toggle(row: FlagRow, next: boolean) {
    // flagChangeWarning reads the REAL row (row.state), never a client
    // guess — see FlagRow.state's doc comment. Only the off direction ever
    // carries a warning, and only allowed_domain's off does today.
    const warning = flagChangeWarning(row.state, next);
    if (warning) {
      setError(null);
      setRetryDeadline(null);
      setPendingToggle({ row, next, warning });
    } else {
      submitToggle(row, next);
    }
  }

  function saveValue(row: FlagRow) {
    const raw = draft[row.key] ?? "";
    // Computed client-side too, ahead of the call: the server is still the
    // authority on whether the write happens, but knowing the NORMALIZED
    // value here is what lets the success path reset the box to it even on
    // a no-op (see valuesKey's comment above for why the effect alone misses
    // that case).
    const normalized = domainValue(raw);
    run(
      `${row.key}:save`,
      () => setFlagValue({ key: row.key, value: raw }),
      { changed: `${row.label} updated`, unchanged: `${row.label} is already set to that value` },
      {
        validationTarget: "field",
        onOk: () => {
          if (normalized.ok) setDraft((d) => ({ ...d, [row.key]: normalized.value }));
        },
      },
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      {retryAfterSec !== null && !pendingToggle && (
        <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
      )}
      {error && !pendingToggle && <Banner tone="fault" title={error} />}

      {rows.map((row) => {
        // The direction THIS click would attempt. Bound to the rule the
        // action itself enforces, not to `row.unavailable` alone: an
        // `unavailable` flag must still be closeable if it's somehow already
        // on (HANDOVER §6a rule 14 — refusing the safe direction is the
        // defect this phase keeps re-shipping), and a `hasValue` flag with no
        // usable value must stay refused on the ON direction until a value
        // is saved, even though `row.unavailable` is null for it.
        const next = !row.enabled;
        const verdict = flagChange(row.state, next);
        const saveKey = `${row.key}:save`;
        const fieldError = fieldErrors[saveKey];

        return (
          <Card key={row.key}>
            <CardBody className="flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-fg">{row.label}</span>
                    <span className="font-mono text-[10px] text-fg-faint">{row.key}</span>
                    {row.unavailable && <Pill>UNAVAILABLE</Pill>}
                  </span>
                  {/* spec.description, never FeatureFlag.description — the two
                      disagree today, and the spec's is the build-controlled
                      prose (see FLAG_SPECS's doc comments). */}
                  <span className="text-[11.5px] leading-snug text-fg-muted">{row.description}</span>
                </div>
                {/* Unlike a viewer's absent affordances, this switch is DISABLED
                    rather than hidden: the admin has permission, the feature is
                    what's missing. Hiding it would read as "this flag is gone". */}
                <Switch
                  checked={row.enabled}
                  disabled={acting !== null || !verdict.allowed}
                  aria-label={`${row.label}${row.unavailable ? " — unavailable" : ""}`}
                  onCheckedChange={(checked) => toggle(row, checked)}
                />
              </div>

              {/* Two different sentences, and both have to be here.
                  `unavailable` is a property of the FLAG ("this feature isn't
                  finished"), so it prints whenever it's set — including when
                  the switch is live because the row is somehow already on and
                  the safe direction is permitted, which is precisely when the
                  admin most needs to know why they should close it.
                  `verdict.reason` is a property of THIS CLICK, and without it
                  a `hasValue` flag with no value renders a dead switch and no
                  explanation: `row.unavailable` is null for allowed_domain, so
                  on any deployment that bootstrapped without a domain the
                  admin would see a greyed-out "Signup domain restriction" and
                  nothing saying "set a domain first". The rule already returns
                  that sentence — HANDOVER §6a rule 10 is that the page has to
                  consume every refusal the rule can return, not just the one
                  the design card names. */}
              {row.unavailable && (
                <p className="border-l-2 border-border-strong pl-2.5 text-[11px] leading-snug text-fg-muted">
                  {row.unavailable}
                </p>
              )}

              {!verdict.allowed && !row.unavailable && (
                <p className="border-l-2 border-border-strong pl-2.5 text-[11px] leading-snug text-fg-muted">
                  {verdict.reason}
                </p>
              )}

              {row.hasValue && !row.unavailable && (
                <div className="flex flex-wrap items-end gap-2 border-t border-border-faint pt-2.5">
                  <div className="flex flex-col gap-1">
                    <Input
                      aria-label={`Value for ${row.label}`}
                      value={draft[row.key] ?? ""}
                      invalid={!!fieldError}
                      className="w-[220px] py-1.5 text-xs"
                      onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                    />
                    <FormError>{fieldError}</FormError>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={acting === saveKey}
                    disabled={acting !== null && acting !== saveKey}
                    onClick={() => saveValue(row)}
                  >
                    Save
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}

      {/* Reserved for the one direction that carries a stated consequence
          (allowed_domain, turned off): the sentence is shown BEFORE the
          click, not as a toast after — the selfRoleChangeWarning pattern. */}
      <Dialog
        open={pendingToggle !== null}
        onClose={() => setPendingToggle(null)}
        title={pendingToggle ? `Turn off ${pendingToggle.row.label}?` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingToggle(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pendingToggle ? acting === `${pendingToggle.row.key}:toggle` : false}
              onClick={() => pendingToggle && submitToggle(pendingToggle.row, pendingToggle.next)}
            >
              Turn off
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {retryAfterSec !== null && (
            <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
          )}
          {error && <Banner tone="fault" title={error} />}
          <p>{pendingToggle?.warning}</p>
        </div>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Write the page**

Create `src/app/(app)/admin/flags/page.tsx`:

```tsx
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { FlagRows } from "@/components/admin/flag-rows";
import { listFlags } from "@/server/modules/admin/queries";

export default async function FlagsPage() {
  await requireRole("admin");
  const rows = await listFlags();

  return (
    <>
      <PageHeader title="Feature flags" />
      <div className="flex max-w-[720px] flex-col gap-3">
        <Banner tone="neutral" title="These take effect immediately, for everyone">
          Both flags change who can get in, so they are audited like any other change. A flag marked
          UNAVAILABLE is one whose feature isn&apos;t finished — it can always be turned off, never on,
          until it is.
        </Banner>
        <FlagRows rows={rows} />
      </div>
    </>
  );
}
```

- [ ] **Step 6: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

In the preview as `admin@thebackroomop.com`, `/admin/flags` — **all of this was confirmed on `aaca261`:**

1. Two cards. `m365_sso` carries an `UNAVAILABLE` pill, its corrected description (no domain-restriction
   claim), and the reason sentence; its switch is off and disabled.
2. `allowed_domain` shows its description, the value editor holding `thebackroomop.com`, and Save.
3. Type `BackroomOp.COM` → Save → the DB holds `backroomop.com` (lowercased by `domainValue`) **and the
   input box shows the normalized value**, not what was typed.
4. `/audit`'s newest row reads **`FEATURE-FLAG allowed_domain | flag-value | value`** — named rather than
   a truncated cuid, a verb that distinguishes a value edit from a switch flip, and **no phantom `key`
   in the Fields cell.**
5. **The state that produces the Critical needs a direct DB write, because the UI deliberately cannot
   create it.** `UPDATE "FeatureFlag" SET enabled = true, value = NULL WHERE key = 'allowed_domain';`
   then reload: the switch must read `aria-checked="false"` — **OFF, not ON** — and carry *"Set a domain
   first — an empty restriction lets any address sign up."* If it reads ON, the page is claiming a
   restriction `signUp` does not enforce. Restore the value afterwards.
6. Turning `allowed_domain` off opens the confirm dialog with the consequence stated before the click.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/admin/flag-actions.ts src/components/admin/flag-rows.tsx "src/app/(app)/admin/flags/page.tsx" src/server/modules/admin/queries.ts src/server/modules/audit/queries.ts
git commit -m "feat(admin): feature flags, with the one that would break sign-in held shut"
```

As shipped this was three commits, left unsquashed so the review trail stays legible: `ce275c1` (the task
as written), `3157a5c` (the switch states its refusal), `aaca261` (the review fix).

Verified green at `aaca261`: `npx tsc --noEmit` / `npm run lint` / **404 tests across 28 files**.


### Task 6: The webhook vocabulary (TDD)

Everything the webhook screens and the worker both need to agree on: which events exist, what an
endpoint's subscription list is allowed to contain, the envelope a consumer receives, and the chip
text the deliveries page prints.

**One structural rule, and it is why this is two files.** `src/lib/webhooks.ts` must not import
`node:crypto`: `deliveryStage` is called from a `"use client"` table in Task 13, and a client bundle
that reaches a node builtin either fails to build or drags a polyfill in behind it. Signing therefore
lives in `src/server/webhooks/sign.ts`, which only the worker imports. (This supersedes the single
`src/lib/webhooks.ts` named in the file-structure section above.)

> ### AMENDED to the shipped code (`5c4ab33` + `093a209`). Four Important findings, all fixed here rather than deferred.
>
> **1. The signature was replayable, and this phase ships a button that makes replays byte-identical.**
> Task 10 builds the envelope from `(delivery.id, delivery.event, delivery.createdAt, delivery.payload)`
> and `replayDelivery` writes only `status`/`attempts`/`deliveredAt` — **all four envelope inputs are
> untouched, so a replay POSTs identical bytes and an identical signature.** With no timestamp anywhere
> in the request a receiver cannot implement a tolerance window even if it wanted one. The original
> scheme was GitHub's (`sha256=<hex>` over the body) without either of GitHub's mitigations: it mandates
> TLS, and its delivery GUID **changes** on redelivery where our `id` is stable — and Task 7's URL schema
> permits plain `http://`. The comment also claimed the `sha256=` prefix gave receivers a migration path;
> it names the **algorithm**, not the signed-string construction, so changing to `"t.body"` would have
> failed every signature silently. **Now Stripe/Slack shape:** `signPayload(body, secret, at: Date)`
> signs `` `${t}.${body}` `` (`t` = Unix seconds) and returns `t=<seconds>,v1=<hex>`, where `v1` names
> the **scheme** so the next change genuinely is detectable. Fixed here because there were **zero
> consumers**; after Task 10 it is a breaking change to receivers we cannot see or migrate.
>
> **2. `parseEvents` narrowed silently and the first unrelated Save destroyed the evidence.**
> `WebhookEndpoint.events` is a raw `String[]`, so it can hold an event this build has renamed. The
> editor rendered no trace of the extra name, and an admin editing **only the URL** caused
> `updateEndpoint` to write the narrowed list back — **permanently deleting the subscription** — and
> audit it as `events: { from: [x], to: [x] }`, an append-only entry asserting the field did not change
> on the very write that erased it. Silent narrowing is right for `emitWebhook` (never fan out to a name
> nothing emits) and wrong for the editor; one function was serving two callers with opposite needs, and
> Task 8 **structurally could not** detect the drop. Now **`partitionEvents(raw) → { known, unknown }`**,
> with `parseEvents` implemented as `partitionEvents(raw).known` so there is still one parser.
>
> **3. The `DEAD · 5/5` chip's denominator had no owner.** Scope decision #6 governs the *numerator*
> (`attempts` mirrored from the job). The denominator was a parameter, sourced from a literal in
> `src/worker/index.ts` — and Task 13's code below declared a **second** `MAX_DELIVERY_ATTEMPTS = 5`.
> Tune the worker to 3 and the chip reads `DEAD · 3/5`: card `3h`'s headline artifact, wrong, with a
> green suite and a mutation-clean `deliveryStage`. The stated reason for the parameter was also false —
> Task 13 calls `deliveryStage` **server-side** in `listDeliveries`, so no client component ever imports
> it. Now **`src/lib/jobs.ts` exports `MAX_JOB_ATTEMPTS = 5`**, the worker imports it, and
> `deliveryStage(status, attempts, maxAttempts = MAX_JOB_ATTEMPTS)` defaults to it. Note the name: this
> is the **job-engine-wide** cap (`src/worker/index.ts:73` applies it to every job type), not a
> delivery-specific one, which is why it is not called `MAX_DELIVERY_ATTEMPTS` and does not live in
> `webhooks.ts`.
>
> **4. Step 3b taught the map three of `DeliveryStatus`'s four values.** `PENDING` was left inheriting
> the flat map's approval entry, so a queued delivery rendered **amber** (`attention`) reading QUEUED —
> and since `RETRYING` is also `attention`, **colour could not distinguish "queued and healthy" from
> "failing".** A freshly-seeded deliveries page would be a wall of amber with the only real signal in the
> text. `status.ts` already shipped the mechanism for exactly this (namespaced lookups override the flat
> map where enum values collide across entities), so there is now a **`"delivery"` namespace covering all
> four values**, and `JobStatus`'s `RUNNING`/`DONE`/`FAILED` were added to the flat map because
> `status.ts`'s own doc comment claims every enum value maps and they did not. An **exhaustiveness test
> over the real Prisma enum objects** now makes that claim true, and would have caught this on its own.
>
> Plus: `deliveryStage` has an explicit `PENDING` branch (the catch-all previously made a typo'd or
> future status read as QUEUED); `webhookEnvelope` takes one object parameter instead of four positionals
> of which two adjacent ones were both `string`; and **two golden vectors** were added after the reviewer
> demonstrated that plausible refactors pass every existing test while changing every byte on the wire —
> `createHmac("sha256", Buffer.from(secret, "base64url"))` (tempting, because Task 7's `newSecret()` is
> base64url) and an alphabetised envelope literal. The signature now has pinned expected strings for an
> ASCII and a UTF-8 body, and the envelope has a pinned `JSON.stringify` output, because key order is the
> bytes the HMAC covers and scope decision #14 calls the envelope *stable*.
>
> **One test-design note worth carrying forward.** The first version of "the digest changes when the
> signing instant changes" compared the **whole header**, which can only pass: the visible `t=` field
> differs between two instants regardless of what was actually hashed, so a mutant that dropped `t` from
> the signed string still passed it. The corrected test extracts and compares only the `v1=` digest. Same
> class as the `ROLE_OPTIONS` and `domainValue` tautologies (HANDOVER §6a rules 17 and §8) — **when a
> test's subject is embedded in a larger string, assert on the part the mutation would change.**

**Files:**
- Create: `src/lib/webhooks.ts`, `src/lib/webhooks.test.ts`, `src/server/webhooks/sign.ts`,
  `src/server/webhooks/sign.test.ts`, `src/lib/jobs.ts`
- Modify: `src/lib/status.ts` + `src/lib/status.test.ts`, `src/worker/index.ts` (import
  `MAX_JOB_ATTEMPTS` instead of declaring its own cap)

- [ ] **Step 1: Write the failing test for the pure half**

Create `src/lib/webhooks.test.ts`. **Write it first, run it, and confirm it fails because the module
does not exist** before writing Step 3.

```ts
import { describe, expect, it } from "vitest";
import {
  EVENT_LABELS, WEBHOOK_EVENTS, deliveryStage, parseEvents, partitionEvents, webhookEnvelope,
} from "./webhooks";
import { MAX_JOB_ATTEMPTS } from "./jobs";
import { statusFamily } from "./status";

describe("WEBHOOK_EVENTS", () => {
  it("is the short, deliberate list from scope decision #9", () => {
    expect(WEBHOOK_EVENTS).toEqual([
      "approval.executed", "offboarding.completed", "purchase_request.completed",
    ]);
  });

  it("labels every event, so no checkbox renders a bare dotted key", () => {
    for (const event of WEBHOOK_EVENTS) expect(EVENT_LABELS[event]).toBeTruthy();
  });
});

describe("parseEvents", () => {
  it("keeps known events in WEBHOOK_EVENTS order, not input order", () => {
    expect(parseEvents(["offboarding.completed", "approval.executed"]))
      .toEqual(["approval.executed", "offboarding.completed"]);
  });

  it("drops unknown events rather than storing them", () => {
    expect(parseEvents(["approval.executed", "asset.deleted"])).toEqual(["approval.executed"]);
  });

  it("de-duplicates", () => {
    expect(parseEvents(["approval.executed", "approval.executed"])).toEqual(["approval.executed"]);
  });

  it("survives junk from the database column without throwing", () => {
    expect(parseEvents(null)).toEqual([]);
    expect(parseEvents("approval.executed")).toEqual([]);
    expect(parseEvents([1, 2, 3])).toEqual([]);
  });

  // parseEvents is partitionEvents().known, not an independent implementation
  // — vary partitionEvents (via its exported behaviour) and parseEvents must
  // move with it. Asserting agreement with a hand-copied expectation would
  // pass even if someone re-forked parseEvents into its own filter, so this
  // compares the two functions to each other on the same input instead.
  it("is derived from partitionEvents, not a parallel implementation", () => {
    const raw = ["purchase_request.completed", "asset.deleted", "approval.executed"];
    expect(parseEvents(raw)).toEqual(partitionEvents(raw).known);
  });
});

describe("partitionEvents", () => {
  it("keeps known events in WEBHOOK_EVENTS order", () => {
    expect(partitionEvents(["offboarding.completed", "approval.executed"]).known)
      .toEqual(["approval.executed", "offboarding.completed"]);
  });

  it("keeps unknown events in input order rather than dropping them", () => {
    expect(partitionEvents(["asset.deleted", "approval.executed", "widget.pinged"]).unknown)
      .toEqual(["asset.deleted", "widget.pinged"]);
  });

  it("de-duplicates the unknown side too", () => {
    expect(partitionEvents(["asset.deleted", "asset.deleted"]).unknown).toEqual(["asset.deleted"]);
  });

  it("returns empty arrays for junk from the database column", () => {
    expect(partitionEvents(null)).toEqual({ known: [], unknown: [] });
    expect(partitionEvents("approval.executed")).toEqual({ known: [], unknown: [] });
  });

  it("a name can only land on one side, never both", () => {
    const { known, unknown } = partitionEvents(["approval.executed", "asset.deleted"]);
    expect(known).toEqual(["approval.executed"]);
    expect(unknown).toEqual(["asset.deleted"]);
  });
});

describe("webhookEnvelope", () => {
  it("carries id, event, occurredAt and data — and nothing else", () => {
    const env = webhookEnvelope({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: new Date("2026-08-19T02:00:00Z"),
      data: { refNo: "APR-2042" },
    });
    expect(Object.keys(env).sort()).toEqual(["data", "event", "id", "occurredAt"]);
    expect(env).toEqual({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: "2026-08-19T02:00:00.000Z",
      data: { refNo: "APR-2042" },
    });
  });

  // Object.keys(...).sort() and toEqual are both order-blind: an
  // alphabetised return literal would pass both of the assertions above
  // while changing every byte the signature (src/server/webhooks/sign.ts)
  // covers. Pinning the exact serialized string is what catches that,
  // since scope decision #14 calls this envelope's shape stable.
  it("serializes to a pinned byte-exact string — key order is part of the contract", () => {
    const env = webhookEnvelope({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: new Date("2026-08-19T02:00:00Z"),
      data: { refNo: "APR-2042" },
    });
    expect(JSON.stringify(env)).toBe(
      '{"id":"wd-1","event":"approval.executed","occurredAt":"2026-08-19T02:00:00.000Z","data":{"refNo":"APR-2042"}}',
    );
  });
});

describe("deliveryStage", () => {
  it("reads DELIVERED without a counter — the count stops mattering once it lands", () => {
    expect(deliveryStage("DELIVERED", 2, 5)).toBe("DELIVERED");
  });

  it("reads DEAD with the full ratio, which is the design's DEAD · 5/5", () => {
    expect(deliveryStage("DEAD", 5, 5)).toBe("DEAD · 5/5");
  });

  it("reads RETRYING with progress through the budget", () => {
    expect(deliveryStage("RETRYING", 2, 5)).toBe("RETRYING · 2/5");
  });

  it("reads a never-attempted row as QUEUED, not as 0/5", () => {
    expect(deliveryStage("PENDING", 0, 5)).toBe("QUEUED");
  });

  it("reads a re-queued row with its attempts so far", () => {
    expect(deliveryStage("PENDING", 1, 5)).toBe("QUEUED · 1/5");
  });

  // A status this build doesn't recognise must look unrecognised, not fall
  // into the PENDING branch and read as a healthy queue.
  it("passes an unrecognised status straight through rather than defaulting to QUEUED", () => {
    expect(deliveryStage("SOMETHING_NEW", 3, 5)).toBe("SOMETHING_NEW");
  });

  // The denominator defaults to the worker's real cap so a caller can't
  // silently supply a different number — this is what Important 3 in the
  // quality review was about: two literal 5s (worker + this module) meant
  // tuning one didn't tune the other, invisibly, with a green suite.
  it("defaults the denominator to MAX_JOB_ATTEMPTS when none is supplied", () => {
    expect(deliveryStage("DEAD", MAX_JOB_ATTEMPTS)).toBe(`DEAD · ${MAX_JOB_ATTEMPTS}/${MAX_JOB_ATTEMPTS}`);
  });
});

// `deliveryStage` returns a LABEL and nothing else. Colour is not its business:
// src/lib/status.ts owns "every enum value in the app maps into exactly one
// family; nothing gets a bespoke colour", and StatusPill derives the family from
// the raw status value. DeliveryStatus was simply the one app enum that map had
// never been taught — Step 3b fixes that, and these are the tests for it.
// (`statusFamily` needs the "delivery" namespace here — PENDING and RETRYING
// both live under "attention" in the flat map, which is exactly the collision
// src/lib/status.ts's delivery namespace exists to separate; its own test
// suite in src/lib/status.test.ts covers that in depth.)
describe("DeliveryStatus is in the six-family system", () => {
  it("colours a dead delivery as a fault and a landed one as settled", () => {
    expect(statusFamily("DELIVERED", "delivery")).toBe("settled");
    expect(statusFamily("DEAD", "delivery")).toBe("fault");
    expect(statusFamily("RETRYING", "delivery")).toBe("attention");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/lib/webhooks.test.ts
```

Expect `Cannot find module './webhooks'`. That is the RED step; do not skip past it.

- [ ] **Step 3: The job budget, which the chip's denominator borrows**

Create `src/lib/jobs.ts`. **`src/lib/`, not `src/server/`** — the worker imports it and so does
`webhooks.ts`, which must stay free of `node:` builtins. Exactly one literal `5` may exist in the repo.

```ts
/**
 * The retry budget for EVERY job type in the queue — not just
 * `DELIVER_WEBHOOK` — because `src/worker/index.ts` enforces one cap for the
 * whole engine, not a per-type one. It is the single literal: the worker
 * imports this instead of declaring its own `MAX_ATTEMPTS`.
 *
 * The deliveries chip's denominator (`DEAD · 5/5`) is this number, not a
 * copy of it: scope decision #6 makes the `Job` row the retry engine, so a
 * `WebhookDelivery`'s attempts are mirrored from its job rather than counted
 * separately. If this changes, the chip changes with it — that's the point
 * of importing it rather than re-declaring `5` in `src/lib/webhooks.ts`.
 */
export const MAX_JOB_ATTEMPTS = 5;
```

Then delete `const MAX_ATTEMPTS = 5;` from `src/worker/index.ts` and import this instead. That file's
`DELIVER_WEBHOOK` branch is Task 10's to rewrite — **change nothing else in it here.**

- [ ] **Step 4: Write the pure module**

Create `src/lib/webhooks.ts`:

```ts
import { MAX_JOB_ATTEMPTS } from "./jobs";

/**
 * Scope decision #9: a short, deliberate list, chosen so the three do not
 * overlap — asset lifecycle, HR/IT departure, procurement. Every entry is a
 * moment the code already passes through with a transaction open, so emitting
 * is a call rather than a new hook.
 *
 * `asset.status_changed` is deliberately absent: a lifecycle change is never a
 * direct asset write in this codebase, so it always arrives through an approval
 * and would already have fired `approval.executed`. Two events for one fact is
 * how a consumer ends up processing it twice.
 */
export const WEBHOOK_EVENTS = [
  "approval.executed",
  "offboarding.completed",
  "purchase_request.completed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const EVENT_LABELS: Record<WebhookEvent, string> = {
  "approval.executed": "An approval finished executing",
  "offboarding.completed": "An offboarding was completed",
  "purchase_request.completed": "A purchase request was completed",
};

/**
 * `WebhookEndpoint.events` is a raw `String[]` column, so it can hold anything
 * that was ever written to it — including an event this build has since renamed.
 * `parseEvents` alone would DISCARD that fact: `emitWebhook` is right to fan
 * out only to names it still knows, but an editor that reads through
 * `parseEvents` and then saves has just narrowed the row on the admin's
 * behalf — an edit to the URL alone silently deletes the unrecognised
 * subscription, with nothing left to show it ever existed.
 *
 * `partitionEvents` keeps both halves so a caller that needs to show — or at
 * least preserve — the leftover can. `known` is in `WEBHOOK_EVENTS` order for
 * the same reason `parseEvents` always was: two endpoints with the same
 * subscription must produce the same array. `unknown` has no canonical order
 * to impose, so it keeps input order, de-duplicated.
 */
export function partitionEvents(raw: unknown): { known: WebhookEvent[]; unknown: string[] } {
  if (!Array.isArray(raw)) return { known: [], unknown: [] };
  const strings = raw.filter((e): e is string => typeof e === "string");
  const wanted = new Set(strings);
  const known = WEBHOOK_EVENTS.filter((e) => wanted.has(e));
  const isKnown = new Set<string>(WEBHOOK_EVENTS);
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const e of strings) {
    if (isKnown.has(e) || seen.has(e)) continue;
    seen.add(e);
    unknown.push(e);
  }
  return { known, unknown };
}

/**
 * The worker's view: fan out only to names this build still recognises.
 * Never use this to populate an editor — it discards exactly the fact
 * (`partitionEvents(...).unknown`) an editor needs to avoid silently
 * deleting a subscription on an unrelated save.
 */
export function parseEvents(raw: unknown): WebhookEvent[] {
  return partitionEvents(raw).known;
}

export interface WebhookEnvelope {
  id: string;
  event: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/**
 * Scope decision #14: a small, stable envelope. `data` carries ids and refNos,
 * never whole rows — a webhook is a notification that something happened, not a
 * replication feed, and shipping rows would make every schema change a breaking
 * change for consumers we cannot see or migrate.
 *
 * This function is the one place the envelope's KEY ORDER is defined — that
 * matters because the signed bytes (`src/server/webhooks/sign.ts`) are
 * whatever `JSON.stringify` produces from this object, not from a re-derived
 * one. A single object parameter, rather than four positionals of which two
 * (`id`, `event`) are same-typed strings, is deliberate: a caller can't ship
 * `webhookEnvelope(delivery.event, delivery.id, …)` and have it compile.
 */
export function webhookEnvelope(input: {
  id: string;
  event: string;
  occurredAt: Date;
  data: Record<string, unknown>;
}): WebhookEnvelope {
  return {
    id: input.id,
    event: input.event,
    occurredAt: input.occurredAt.toISOString(),
    data: input.data,
  };
}

/**
 * The chip's LABEL on /admin/webhooks/deliveries — colour is not this
 * function's business (see Step 3b). The ratio is the point: card 3h shows
 * `DEAD · 5/5`, which is only meaningful because the denominator is
 * `MAX_JOB_ATTEMPTS` (`src/lib/jobs.ts`) — the worker's job-engine-wide retry
 * cap, not a number this module owns. Scope decision #6 is what keeps the
 * NUMERATOR honest — the delivery row's `attempts` is mirrored from the job
 * rather than counted twice — and defaulting the denominator here is what
 * keeps IT honest: a caller has to go out of its way to supply a different
 * number, rather than every call site being a second place this can drift
 * from the worker's actual cap.
 */
export function deliveryStage(
  status: string,
  attempts: number,
  maxAttempts: number = MAX_JOB_ATTEMPTS,
): string {
  if (status === "DELIVERED") return "DELIVERED";
  if (status === "DEAD") return `DEAD · ${attempts}/${maxAttempts}`;
  if (status === "RETRYING") return `RETRYING · ${attempts}/${maxAttempts}`;
  if (status === "PENDING") {
    // No attempt yet has no ratio worth printing: "0/5" reads as a failure
    // that hasn't happened. Once it has been tried, the count is news.
    return attempts > 0 ? `QUEUED · ${attempts}/${maxAttempts}` : "QUEUED";
  }
  // A status this build doesn't recognise (typo, future enum value, stale
  // row) should look unrecognised rather than quietly reading as QUEUED —
  // the PENDING branch above was never meant to be a catch-all.
  return status;
}
```

- [ ] **Step 5: Teach the six-family system about `DeliveryStatus` and `JobStatus`**

`src/lib/status.ts`. Two separate changes, and the second is the one a first pass misses:

- **The flat `MAP`** gains `JobStatus`'s `RUNNING` / `DONE` / `FAILED` (`DEAD` and `PENDING` are already
  there and are shared). `status.ts`'s own doc comment claims *every* enum value in the app maps into
  exactly one family, and until this it was false — those three rendered neutral grey.
- **A `"delivery"` namespace** covering all four `DeliveryStatus` values. `PENDING` unnamespaced resolves
  to the **approval** family (`attention`), so a queued delivery would render amber reading QUEUED —
  and `RETRYING` is also `attention`, so **colour could not distinguish "queued and healthy" from
  "failing".** Namespaced lookups exist for exactly this collision; the file already says so.

Then add an **exhaustiveness test** to `src/lib/status.test.ts` that iterates the real Prisma enum objects
(`import { DeliveryStatus, JobStatus } from "@prisma/client"` — they are runtime values) and asserts every
member resolves to something other than the neutral fallback, under the namespace each is read with. That
test is what would have caught the missing `PENDING` on its own.

- [ ] **Step 6: Write the failing test for the signing half**

Create `src/server/webhooks/sign.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SIGNATURE_HEADER } from "@/lib/webhooks"; // AMENDED by Task 8 (moved out of sign.ts)
import { signPayload } from "./sign";

const AT = new Date("2026-08-19T02:00:00Z"); // t = 1787104800

describe("signPayload", () => {
  it("is t=<seconds>,v1=<64-hex>, so a receiver can find the timestamp without parsing hex", () => {
    const sig = signPayload('{"a":1}', "shhh", AT);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  // Golden vectors: computed from this exact implementation and pasted as
  // literals, so a refactor that changes the signed-string construction (key
  // encoding, body encoding, separator, field order) is caught even though it
  // would still pass every property-style assertion below.
  it("matches a pinned vector for a fixed body, secret and instant", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).toBe(
      "t=1787104800,v1=92d5a4bc4967ee6f3cd0906c63e8ab7aea6590005270d3642812deade4d29504",
    );
  });

  it("matches a pinned vector for a non-ASCII body, pinning the UTF-8 encoding", () => {
    expect(signPayload('{"msg":"café"}', "shhh", AT)).toBe(
      "t=1787104800,v1=eb0b7a92544e2a68a322bc1b42f0815ecbc8fa8bb99b061646304d28b90cf09a",
    );
  });

  it("is stable for the same body, secret and instant", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).toBe(signPayload('{"a":1}', "shhh", AT));
  });

  it("changes when the body changes", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).not.toBe(signPayload('{"a":2}', "shhh", AT));
  });

  // The whole point of a signing secret: a receiver that checks the signature
  // can tell our POST from anyone else's.
  it("changes when the secret changes", () => {
    expect(signPayload('{"a":1}', "shhh", AT)).not.toBe(signPayload('{"a":1}', "other", AT));
  });

  // The whole point of THIS change: a replayed request — same body, same
  // secret — must sign differently once time has moved on, or a captured
  // request stays valid forever. Comparing the DIGEST alone (not the whole
  // header) matters: the header's visible `t=` field always differs between
  // two instants regardless of what got hashed, so a version that hashed
  // only the body — dropping `t` from the signed string — would still pass
  // a whole-string comparison. Only the digest tells you `t` was actually
  // part of what got signed.
  it("changes the v1 digest when the signing instant changes, even with the same body and secret", () => {
    const later = new Date(AT.getTime() + 5 * 60_000);
    const digest = (sig: string) => sig.split(",v1=")[1];
    expect(digest(signPayload('{"a":1}', "shhh", AT)))
      .not.toBe(digest(signPayload('{"a":1}', "shhh", later)));
  });

  it("names the header once, so the worker and the docs can't drift", () => {
    expect(SIGNATURE_HEADER).toBe("x-backroom-signature");
  });
});
```

**Two notes on these tests, both learned the hard way.** The golden vectors are not decoration: a
reviewer demonstrated that `createHmac("sha256", Buffer.from(secret, "base64url"))` — tempting, since
Task 7's `newSecret()` is base64url, so "key it with the real 32 bytes" reads like a tidy-up — passes
every non-golden test while invalidating every signature in existence, and so does
`.update(body, "latin1")` for any non-ASCII body. And the "digest changes when the instant changes" test
must compare **only the `v1=` part**: comparing the whole header can only pass, because the visible `t=`
differs between two instants no matter what was actually hashed.

- [ ] **Step 7: Write the signing module**

Create `src/server/webhooks/sign.ts`. **This is the only file in the webhooks feature that may touch
`node:crypto`** — `src/lib/webhooks.ts` must stay importable from a `"use client"` boundary.

```ts
import { createHmac } from "node:crypto";

/** Named once so the worker, any future docs page, and the tests agree. */
export const SIGNATURE_HEADER = "x-backroom-signature"; // AMENDED: Task 8 moved this to src/lib/webhooks.ts

/**
 * Stripe/Slack-shaped signing, not GitHub's: signing the body alone made every
 * replay of a captured request byte-identical (same `id`, same `payload`, same
 * signature — nothing to reject a delivery a receiver already processed, an
 * admin's month-later "Replay", or an attacker's replay of a sniffed POST).
 *
 * The signed string is `` `${t}.${body}` ``, where `t` is Unix time in
 * SECONDS at the moment of signing — the timestamp is part of what's hashed,
 * not a sibling header, so a receiver can't strip it without invalidating the
 * signature. The header value is `t=<seconds>,v1=<hex>`: `v1` names the
 * *construction* (this exact "t.body" scheme), so a future change to how the
 * string is built is something a receiver can detect, unlike a bare `sha256=`
 * prefix that only ever named the algorithm.
 *
 * A receiver MUST: recompute the same `t.body` string, compare the digest
 * with a timing-safe equality function (never `===` on the hex strings), and
 * reject `t` outside a tolerance window — 5 minutes is the usual choice —
 * to bound how long a captured request stays replayable.
 *
 * `at` is a parameter rather than `Date.now()` inside, so the caller signs
 * the exact instant it sends (no drift between what's hashed and what's
 * logged) and so this stays testable without mocking the clock.
 */
export function signPayload(body: string, secret: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  const hex = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return `t=${t},v1=${hex}`;
}
```

- [ ] **Step 8: Run both suites and watch them pass**

```bash
npx vitest run src/lib/webhooks.test.ts src/server/webhooks/sign.test.ts
```

- [ ] **Step 9: Mutation-test them — every branch, not a sample**

Break each of these, confirm a test dies **and name which one**, then restore: `parseEvents` returning
input strings unfiltered; `partitionEvents`'s unknown side always `[]`, and its dedup removed;
`deliveryStage`'s explicit `PENDING` branch, its `attempts > 0` branch, its `DEAD` ratio, and its default
denominator hardcoded to a different number; `signPayload` ignoring its `secret`, and dropping `t` from
the **hashed** string; each of the four `NAMESPACED.delivery` entries; and one flat-map `JobStatus` entry
(the exhaustiveness test must die).

- [ ] **Step 10: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/lib/webhooks.ts src/lib/webhooks.test.ts src/lib/jobs.ts src/lib/status.ts src/lib/status.test.ts src/server/webhooks/sign.ts src/server/webhooks/sign.test.ts src/worker/index.ts
git commit -m "feat(webhooks): the event list, the envelope, the chip, and the signature"
```

As shipped this was two commits, left unsquashed so the review trail stays legible: `5c4ab33` (the task as
originally written) and `093a209` (the review fix).

Verified green at `093a209`: `npx tsc --noEmit` / `npm run lint` / **443 tests across 30 files** /
`npm run worker:once` still drains a job, which is the only check that covers the `src/worker/index.ts`
edit — nothing in the unit suite reaches that file.


---

### Task 7: Endpoint actions — the secret is encrypted, and shown once

> ### AMENDED to the shipped code (`cc13bf5` + `df7a9a8` + `e90b277`). The pre-written amendment below was applied; six further Important findings were fixed on top of it.
>
> **The code blocks in the Steps below are the ORIGINAL text and are now stale in several places.** Read
> the shipped files as the source of truth: `src/server/modules/admin/webhook-actions.ts`,
> `src/server/modules/admin/queries.ts`, `src/server/webhooks/sign.ts`, `src/server/prisma-errors.ts`.
> What changed beyond the pre-written amendment:
>
> **A. Every write is guarded, and `rotateSecret` was the dangerous one.** It shipped as a bare
> `tx.webhookEndpoint.update` with no guard. Two rotations racing — two admins, **or one operator
> double-clicking**, since nothing upstream gates repeat clicks — both succeed; the second wins in the DB
> while the shown-once banner displays whichever response resolved last. The operator pastes S1 into the
> receiver, S2 is live, every delivery 401s, Task 10 classifies that as permanent, and deliveries go
> straight to `DEAD`. **The shown-once design is exactly what makes this undetectable** — the reveal is
> the only place the value ever appears, so there is nothing to check it against. Now guarded on
> `updatedAt`.
>
> **B. `updateEndpoint` guarded the one column neither writer touches.** Its guard was `where: { url }`,
> with a comment claiming that was "enough, because the editor saves both fields together." Two admins
> editing **only the events** (same URL): Postgres re-checks the predicate against the new row version
> after the lock (EvalPlanQual), the URL still matches, so the second write commits over the first with no
> conflict, and its append-only audit entry claims a `from` that had already been superseded. **§6a rule
> 21 verbatim** — the same defect as Task 5's `setFlagValue`. Now guarded on `updatedAt`.
> `setEndpointActive` was deliberately **left alone**: it guards on `active`, the column it writes.
>
> **C. `listEndpoints` fetched the ciphertext while its comment said it didn't.** `findMany` with no
> `select` pulls every scalar column, so `secret` was materialised on every render — and `EndpointRow` is
> consumed by a `"use client"` component, so the object is serialised into the RSC payload. One `...r`
> from ciphertext in an admin page's source. Now an explicit `select`, with a comment that asserts
> something a reader can verify four lines up.
>
> **D. The `http://` comment claimed a security property signing does not provide.** It said http was safe
> *"because the payload is signed either way."* Signing gives the **receiver** integrity and authenticity;
> it says nothing about where the URL points, and over plain http gives **no confidentiality** — the
> envelope and its HMAC cross the wire in the clear, replayable for the five minutes `sign.ts` allows.
> Rewritten to say what is true.
>
> **E. One SSRF guard, deliberately narrow.** `isBlockedWebhookHost` refuses `169.254.0.0/16` and
> `metadata.google.internal` — never legitimate webhook targets, zero false positives. **Loopback and
> RFC1918 are deliberately NOT blocked**: scope decision #4's "a receiver may be another container on the
> same host" rationale and this plan's own `http://localhost:4999/hook` verification both depend on them.
> **The guard's soundness rests on a non-obvious fact, verified rather than assumed:** it pattern-matches
> only a dotted quad, but `new URL` normalizes every integer form first — `http://2852039166/`,
> `http://0xa9fea9fe/` and `http://0251.0376.0251.0376/` all yield hostname `169.254.169.254`, so there is
> no decimal/hex/octal bypass. IPv6 `[fd00:ec2::254]` is **not** blocked; accepted, since this deployment
> has no metadata service. The broader capability — an authenticated admin can make the worker POST to any
> host it can reach — is an **accepted capability, not an escalation**: the actor can already change roles
> and open signup, and Task 10 stores only status codes, never response bodies, so it is a blind
> reachability oracle rather than a data read.
>
> **F. An unrecognised event is removable, deliberately.** `updateEndpoint` preserves unknown events on
> every save — which was right, but combined with no other writer of `events` and `deleteEndpoint`
> refusing any endpoint with history, it made them **unremovable for the row's lifetime**. It now accepts
> **`removeUnknown: string[]`** (default `[]`, **never inferred from absence**) and audits the removal as a
> real `events` diff, comparing the full raw column on both sides so the dropped name appears in `from`
> and not in `to`.
>
> Plus: `secretAad` is now **pinned by a literal test** (`secretAad("abc") === "webhook:abc"`) with an
> encrypt/decrypt round-trip and a cross-row-AAD refusal — renaming that six-character prefix, or a Task
> 10 implementer passing `endpoint.id` instead of `secretAad(endpoint.id)`, typechecks and passes
> everything while making every **pre-existing** secret permanently undecryptable and leaving new ones
> fine; `newSecret` moved to `sign.ts` (a plain module a test can import) with its 43-char/256-bit shape
> pinned; `asActionResult` gained a **P2003** branch with an `opts.restrictedMessage` override, because
> `deleteEndpoint`'s count-then-delete window is real once Task 9's emitter exists and an unhandled P2003
> reaches the operator as an error boundary rather than a banner; the action verbs are namespaced
> (`endpoint-enable` / `endpoint-disable` / `endpoint-delete`) per §6a rule 22; `ROTATION_WARNING` is a
> const in `src/lib/webhooks.ts` so Task 8 does not hardcode it; and `eventsSchema` dropped the
> `as unknown as [string, ...string[]]` cast, which is the zod-3 idiom Task 4 already removed once.
>
> ---
>
> **The pre-written amendment, for the record — all three were applied:**
>
> **1. Two of the audit diffs are pure from-equals-to, which HANDOVER §6a rules 8 and 19 forbid — and
> this would be the sixth and seventh instance of that shape in this phase.** `/audit` renders diff **key
> names** into an append-only table, so:
> - `rotateSecret`'s **entire** diff is `url: { from: endpoint.url, to: endpoint.url }`. A secret
>   rotation would log `Fields: url` — telling a reader the URL changed. It didn't.
> - `setEndpointActive`'s diff is `url: {equal}, active: {from,to}`, so merely enabling an endpoint logs
>   `Fields: url, active`.
> - `updateEndpoint`'s `events: { from: before, to: events }` is from-equals-to **whenever the save
>   changed only the URL**, which is the common case.
>
> **The URL belongs in the entity label, not the diff** — and Step 3 of this task already teaches
> `entityLabels` about `webhook-endpoint`, so the label is available. Each diff must contain only the
> fields that actually changed. `createEndpoint`'s `from: null` and `deleteEndpoint`'s `to: null` are
> fine; those are real transitions.
>
> **2. `flagChange`-style direction checks aside, check that the page consumes every refusal** these
> actions can return (§6a rule 10). This phase has shipped that defect in five of five tasks.
>
> **3. `parseEvents` is now `partitionEvents(raw).known`** (Task 6's review). `EndpointRow` must carry
> **`unknownEvents: string[]`** from `partitionEvents(...).unknown`, because otherwise a save that
> touches only the URL silently deletes a subscription this build no longer recognises and audits it as
> unchanged. `updateEndpoint` must not write a narrowed list without that having been surfaced — see
> Task 8's banner for what the editor owes the admin.
>
> Also: **`signPayload` now takes three arguments** (`body`, `secret`, `at: Date`) and returns
> `t=<seconds>,v1=<hex>`. Nothing in this task calls it, but `secretAad()` is still this task's to add to
> `src/server/webhooks/sign.ts`, as the plan already says.

Scope decisions #4 and #5. The signing secret is generated server-side, returned to the caller
**exactly once**, and stored as ciphertext bound to its own row. Nothing ever reads it back for
display; the only reader is the worker, when it signs.

**Files:**
- Create: `src/server/modules/admin/webhook-actions.ts`
- Modify: `src/server/modules/admin/queries.ts`

**Before you start:** `secretAad` belongs in `src/server/webhooks/sign.ts`, not here. This file carries
`"use server"`, which makes every export a server action — and Task 10's worker, a plain `tsx` script
outside Next, has to call the same function to decrypt. Add it to `sign.ts` (created in Task 6) now:

```ts
/** AAD binds ciphertext to its endpoint row — a secret lifted into another row refuses to decrypt. */
export function secretAad(endpointId: string): string {
  return `webhook:${endpointId}`;
}
```

- [ ] **Step 1: Write the actions**

Create `src/server/modules/admin/webhook-actions.ts`:

```ts
"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { encryptSecret } from "@/server/crypto";
import { secretAad } from "@/server/webhooks/sign";
import { WEBHOOK_EVENTS, parseEvents } from "@/lib/webhooks";
import { asActionResult } from "@/server/prisma-errors";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const PATHS = ["/admin/webhooks", "/admin/webhooks/deliveries"] as const;

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The URL an endpoint POSTs to. http is allowed because this deploys to a single
 * machine where a receiver may legitimately be another container on the same
 * host — but the payload is signed either way, which is what makes that safe.
 */
const urlSchema = z
  .string()
  .trim()
  .min(1, "Enter the URL to POST to")
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v), "Must start with http:// or https://")
  .refine((v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, "That isn't a valid URL");

const eventsSchema = z
  .array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]))
  .min(1, "Pick at least one event — an endpoint with none would never fire");

const createSchema = z.object({ url: urlSchema, events: eventsSchema });

/**
 * The ONLY moment the plaintext secret exists outside the worker. Scope decision
 * #5: it is returned once, here, and never readable again — a decrypt-and-display
 * path would need its own SECRET_READ audit trail, reveal countdown and role gate,
 * all to re-show a value the operator already pasted into the receiving system.
 * `rotateSecret` answers "I lost it" without any of that.
 */
export async function createEndpoint(
  input: unknown,
): Promise<ActionResult<{ id: string; secret: string }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const secret = newSecret();
  const result = await asActionResult(async () =>
    prisma.$transaction(async (tx) => {
      // Two statements rather than one: the AAD needs the row's id, which only
      // exists after the insert. The placeholder never leaves this transaction.
      const endpoint = await tx.webhookEndpoint.create({
        data: { url: parsed.data.url, events: parseEvents(parsed.data.events), secret: "", active: true },
      });
      await tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { secret: encryptSecret(secret, secretAad(endpoint.id)) },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "webhook-endpoint",
        entityId: endpoint.id,
        action: "create",
        // The secret is never in the diff — AuditEntry is append-only, so a
        // secret written there would be unremovable by construction.
        diff: {
          url: { from: null, to: endpoint.url },
          events: { from: null, to: parseEvents(parsed.data.events) },
        },
      });
      return endpoint.id;
    }),
  );
  if (typeof result !== "string") return result;
  revalidateAll();
  return ok({ id: result, secret });
}

const idSchema = z.object({ id: z.string().min(1) });

export async function rotateSecret(input: unknown): Promise<ActionResult<{ secret: string }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const secret = newSecret();
  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: parsed.data.id } });
        if (!endpoint) return conflict("That endpoint no longer exists.");
        await tx.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { secret: encryptSecret(secret, secretAad(endpoint.id)) },
        });
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "webhook-endpoint",
          entityId: endpoint.id,
          action: "rotate-secret",
          // No values, only the fact and the URL it belongs to: a rotation is
          // worth recording precisely because deliveries will start failing at
          // the far end until someone updates the receiver.
          diff: { url: { from: endpoint.url, to: endpoint.url } },
        });
        return null;
      }),
    { goneMessage: "That endpoint no longer exists." },
  );
  if (failure) return failure;
  revalidateAll();
  return ok({ secret });
}

const updateSchema = z.object({ id: z.string().min(1), url: urlSchema, events: eventsSchema });

export async function updateEndpoint(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const events = parseEvents(parsed.data.events);

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: parsed.data.id } });
        if (!endpoint) return conflict("That endpoint no longer exists.");
        const before = parseEvents(endpoint.events);
        if (endpoint.url === parsed.data.url && before.join(",") === events.join(",")) return null;

        // Guarded on the URL's before-value. `events` is a String[] and cannot
        // be compared in a Prisma where, so the URL carries the guard — which is
        // enough, because the editor saves both fields together.
        const written = await tx.webhookEndpoint.updateMany({
          where: { id: endpoint.id, url: endpoint.url },
          data: { url: parsed.data.url, events },
        });
        if (written.count === 0) return conflict("Someone else just changed that endpoint — refresh.");

        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "webhook-endpoint",
          entityId: endpoint.id,
          action: "update",
          diff: {
            url: { from: endpoint.url, to: parsed.data.url },
            events: { from: before, to: events },
          },
        });
        return null;
      }),
    { goneMessage: "That endpoint no longer exists." },
  );
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}

const activeSchema = z.object({ id: z.string().min(1), active: z.boolean() });

export async function setEndpointActive(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data.active;

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: parsed.data.id } });
        if (!endpoint) return conflict("That endpoint no longer exists.");
        if (endpoint.active === next) return null;
        const written = await tx.webhookEndpoint.updateMany({
          where: { id: endpoint.id, active: endpoint.active },
          data: { active: next },
        });
        if (written.count === 0) return conflict("Someone else just changed that endpoint — refresh.");
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "webhook-endpoint",
          entityId: endpoint.id,
          action: next ? "enable" : "disable",
          diff: { url: { from: endpoint.url, to: endpoint.url }, active: { from: endpoint.active, to: next } },
        });
        return null;
      }),
    { goneMessage: "That endpoint no longer exists." },
  );
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}

export async function deleteEndpoint(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: parsed.data.id } });
        if (!endpoint) return conflict("That endpoint no longer exists.");
        // WebhookDelivery.endpointId is onDelete: Restrict, so an endpoint with
        // history cannot be deleted — and shouldn't be: the deliveries page is a
        // record of what was sent, and deleting the endpoint would orphan it.
        const history = await tx.webhookDelivery.count({ where: { endpointId: endpoint.id } });
        if (history > 0) {
          return conflict(
            `That endpoint has ${history} delivery ${history === 1 ? "attempt" : "attempts"} on record. Disable it instead — deleting it would erase the history of what was sent.`,
          );
        }
        await tx.webhookEndpoint.delete({ where: { id: endpoint.id } });
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "webhook-endpoint",
          entityId: endpoint.id,
          action: "delete",
          // The URL is the only thing that can name a deleted endpoint later —
          // entityLabels cannot resolve a row that is gone.
          diff: { url: { from: endpoint.url, to: null } },
        });
        return null;
      }),
    { goneMessage: "That endpoint no longer exists." },
  );
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}
```

- [ ] **Step 2: Add the endpoint query**

Append to `src/server/modules/admin/queries.ts`:

```ts
import { parseEvents, type WebhookEvent } from "@/lib/webhooks";

export interface EndpointRow {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  /** how many attempts this endpoint has on record, and how many died */
  attempts: number;
  dead: number;
}

export async function listEndpoints(): Promise<EndpointRow[]> {
  const rows = await prisma.webhookEndpoint.findMany({ orderBy: [{ url: "asc" }] });
  // Two grouped counts rather than N per-row queries.
  const [all, dead] = await Promise.all([
    prisma.webhookDelivery.groupBy({ by: ["endpointId"], _count: { _all: true } }),
    prisma.webhookDelivery.groupBy({
      by: ["endpointId"],
      where: { status: "DEAD" },
      _count: { _all: true },
    }),
  ]);
  const allBy = new Map(all.map((g) => [g.endpointId, g._count._all]));
  const deadBy = new Map(dead.map((g) => [g.endpointId, g._count._all]));
  // The secret is never selected out of this function — nothing above the
  // worker has a reason to hold ciphertext, let alone plaintext.
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: parseEvents(r.events),
    active: r.active,
    attempts: allBy.get(r.id) ?? 0,
    dead: deadBy.get(r.id) ?? 0,
  }));
}
```

- [ ] **Step 3: Teach `entityLabels` about endpoints**

In `src/server/modules/audit/queries.ts`, add `webhook-endpoint` alongside the types added in Task 2,
following the same `Promise.all` + `byType.has(...)` shape:

```ts
    byType.has("webhook-endpoint")
      ? prisma.webhookEndpoint.findMany({
          where: { id: { in: [...byType.get("webhook-endpoint")!] } },
          select: { id: true, url: true },
        })
      : [],
```

and beside the other `map.set` lines:

```ts
  for (const e of endpoints) map.set(`webhook-endpoint:${e.id}`, { label: e.url, href: "/admin/webhooks" });
```

Also add `"feature-flag"` and `"webhook-endpoint"` to `AUDIT_ENTITY_TYPES` in `src/lib/audit-list.ts`,
so `/audit`'s Entity facet can filter to them. A deleted endpoint keeps the truncated-id fallback,
which is why `deleteEndpoint` puts the URL in its diff.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/server/modules/admin/webhook-actions.ts src/server/modules/admin/queries.ts src/server/modules/audit/queries.ts src/lib/audit-list.ts
git commit -m "feat(webhooks): endpoints, with the signing secret encrypted and shown once"
```

---
### Task 8: `/admin/webhooks`

> ### AMENDED — this section is the code as SHIPPED (`4b26385`). The banner below records what the
> original blocks got wrong, because the reasoning still matters to Tasks 10 and 13.
>
> **1. Name the subscriptions this build no longer recognises — and saving does NOT remove them.**
> An earlier version of this banner said *"saving will remove it"*. That was true of Task 6's
> `parseEvents` and is **false of Task 7's shipped code, which preserves unknown events on every write**
> — verified live: a URL-only save on a row holding `asset.status_changed` and `employee.hired` kept
> both, and audited `{ url: {...} }` alone. Built from the old sentence the page would have told the
> admin the opposite of what Save does.
>
> Shipped: the banner names them, says saving preserves them, and offers **one explicit removal** passing
> their exact names in `updateEndpoint`'s **`removeUnknown: string[]`** — never inferred from absence.
> That call passes the endpoint's **stored** `url`/`events`, not the card's drafts, so an in-progress URL
> edit is not smuggled into it. **The removal is gated on `endpoint.events.length > 0`:** removing every
> unrecognised name from a row with no recognised ones left would leave an endpoint with no events at
> all, which `eventsSchema` refuses — so the sentence saying what to do first replaces the button, rather
> than the click discovering it (§6a rule 10).
>
> **2. Rotation is a hard cutover — and the sentence already exists, so don't retype it.**
> `ROTATION_WARNING` in `src/lib/webhooks.ts` is the string; a `Dialog` renders **that**. `deliverWebhook`
> decrypts the secret **at attempt time**, so rotating re-signs in-flight deliveries with the new key; a
> receiver still holding the old one returns 401, Task 10 classifies 4xx-except-408/429 as **permanent**,
> and the delivery goes straight to `DEAD` on its first attempt — recoverable with `replayAllDead`, but
> the operator is never told unless the control says so first. (An overlap scheme — a nullable
> `secretPrev` and a dual-signature header — is deliberately **out of scope**; this phase has one
> migration.)
>
> **3. Every `Menu` item gates on `acting`.** Only `EventChecks` and Save were gated as drafted, so a
> double-click on **Rotate** was a live race — and per §6a rule 29 that race hands the operator a secret
> that isn't the live one, undetectably, because the reveal is the only place the value ever appears.
>
> **4. `dirty` compares canonically ordered event lists.** As drafted it joined checkbox *click* order
> against the row's canonical order, so untick-then-retick offered a Save, the server's canonicalised
> no-op check returned early, and the toast claimed success with no audit entry written — §6a rule 6's
> phantom-entry shape. Shipped as `toggleCanonical`, which rebuilds the selection through `parseEvents`:
> the state is canonical **by construction** rather than compared carefully. Verified live — the Save
> button appears on untick and withdraws on retick.
>
> **5. `useRunner` claims `events`**, with a `FormError` under the checkboxes on **both** cards (as
> drafted, `EndpointCard` had no `events` FormError at all and both claimed only `url`, so
> `eventsSchema`'s refusal would have landed in the banner while this task's verification text said
> otherwise).
>
> ### Two things the plan did not have, added here
>
> **6. `deleteBlockedReason(attempts)` — a new export in `src/lib/webhooks.ts`, and the third
> one-string-two-surfaces rule module in this phase.** `deleteEndpoint` refuses an endpoint with delivery
> history, and `EndpointRow.attempts` already tells the page that before the click. As drafted, Delete
> rendered live and always failed for such a row — §6a rule 10 exactly, the shape that has now appeared
> in every task of this phase. The menu item is `disabled` and the same sentence prints in the card.
> `deleteEndpoint` no longer builds its own copy of it. The action keeps its own check for the real race
> (a delivery landing between render and click), whose message stays textually disjoint (§6a rule 4).
>
> **7. `SIGNATURE_HEADER` moved from `src/server/webhooks/sign.ts` to `src/lib/webhooks.ts`.** `sign.ts`
> imports `node:crypto`, so a `"use client"` component cannot import from it — and the shown-once banner
> has to name the header the operator pastes the secret against. As drafted that was a **literal in a
> client component**: a second definition of a contract with receivers we cannot migrate, which a rename
> would silently leave behind, wrong, in the one place a human reads it (§6a rules 26 and 34). It is
> pinned by a literal in both `src/lib/webhooks.test.ts` and `src/server/webhooks/sign.test.ts`.
> **Task 10's import is amended to match.**

The endpoint list and its editor. The one screen in this phase with a genuinely unusual obligation:
**the secret is visible exactly once**, in the response to create or rotate, and there is no way back
to it. The UI has to make that obvious *before* the operator clicks away.

**Files:**
- Modify: `src/lib/webhooks.ts` (`SIGNATURE_HEADER`, `deleteBlockedReason`), `src/lib/webhooks.test.ts`,
  `src/server/webhooks/sign.ts`, `src/server/webhooks/sign.test.ts`,
  `src/server/modules/admin/webhook-actions.ts`
- Create: `src/components/admin/endpoint-editor.tsx`, `src/app/(app)/admin/webhooks/page.tsx`

- [x] **Step 1: `src/lib/webhooks.ts` — the header's new home, and the delete refusal**

`SIGNATURE_HEADER` moves in from `sign.ts` (delete it there; repoint `sign.test.ts`'s import), and:

```ts
/**
 * `WebhookDelivery.endpointId` is `onDelete: Restrict`, so an endpoint with
 * history cannot be deleted — and shouldn't be: the deliveries page is the
 * record of what was sent, and dropping the endpoint would orphan it.
 *
 * The sentence lives here, as data, for the same reason `lockReason`
 * (admin-users.ts) and `ROTATION_WARNING` do: `deleteEndpoint` prints it as a
 * conflict when the click has already happened, and `/admin/webhooks` prints
 * the SAME string beside a disabled Delete so the click doesn't have to
 * (HANDOVER §6a rules 5, 10 and 11 — a page must consume every refusal its
 * rule can return, and one string must not become two).
 *
 * Returns `null` for a deletable endpoint, so a caller can't render the
 * refusal and the affordance at once. `attempts` is a count of
 * `WebhookDelivery` rows for the endpoint, from either side: `listEndpoints`
 * groups it for the page, `deleteEndpoint` counts it inside its transaction.
 */
export function deleteBlockedReason(attempts: number): string | null {
  if (attempts <= 0) return null;
  return (
    `This endpoint has ${attempts} delivery ${attempts === 1 ? "attempt" : "attempts"} on record. ` +
    "Disable it instead — deleting it would erase the record of what was sent."
  );
}
```

In `webhook-actions.ts`, `deleteEndpoint`'s history branch becomes `const blocked =
deleteBlockedReason(history); if (blocked) return conflict(blocked);` — same refusal, one definition.

- [x] **Step 2: Write the editor component**

Create `src/components/admin/endpoint-editor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  EVENT_LABELS,
  ROTATION_WARNING,
  SIGNATURE_HEADER,
  WEBHOOK_EVENTS,
  deleteBlockedReason,
  parseEvents,
  type WebhookEvent,
} from "@/lib/webhooks";
import {
  createEndpoint, deleteEndpoint, rotateSecret, setEndpointActive, updateEndpoint,
} from "@/server/modules/admin/webhook-actions";
import type { EndpointRow } from "@/server/modules/admin/queries";
import type { ActionResult } from "@/server/action-result";

/**
 * Scope decision #5: this is the only moment the plaintext secret exists outside
 * the worker. It is deliberately loud and deliberately NOT dismissible by a
 * refresh — the operator has to acknowledge it, because there is no second copy.
 */
function SecretOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <Banner tone="attention" title="Copy this signing secret now — it is not shown again">
      <span className="flex flex-col gap-2">
        <code className="select-all break-all rounded-(--radius-ctl) border border-border bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg">
          {secret}
        </code>
        <span className="text-[11px] text-fg-muted">
          Paste it into the receiving system as the shared secret for the{" "}
          {/* SIGNATURE_HEADER, not a literal: `signPayload` builds the value and
              the worker sends it, so a rename that left this string behind would
              be wrong in the one place a human ever reads it. */}
          <code className="font-mono">{SIGNATURE_HEADER}</code> header. If you lose it, rotate — the
          value can&apos;t be read back out of the database.
        </span>
        <span>
          <Button size="sm" variant="secondary" onClick={onDone}>
            I&apos;ve copied it
          </Button>
        </span>
      </span>
    </Banner>
  );
}

/**
 * Shared plumbing: the same ActionResult ladder as every other admin screen.
 *
 * `acting` is a per-CONTROL key rather than one boolean, copied from
 * `flag-rows.tsx`/`user-table.tsx`: a single shared `pending` would spin every
 * button on a card while one of them is in flight, and — worse — a card here
 * has five controls, of which Rotate hands back a value that is only ever
 * shown once. Every control gates on `acting !== null`, so a double-click on
 * Rotate cannot race a second rotation whose response would silently win in
 * the database while the banner shows the other one (§6a rule 29).
 *
 * The rate limit is stored as a DEADLINE, not a duration: `RateLimitNotice`
 * restarts its own countdown on every mount, and this component mounts it in
 * two places (inline, and inside the Rotate dialog). A captured
 * `retryAfterSec` would restart the clock each time the operator crossed that
 * boundary — Task 3's bug, fixed once in `flag-rows.tsx` and copied here
 * rather than re-solved.
 */
function useRunner(claimedFieldKeys: string[]) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  function run<T>(
    actingKey: string,
    fn: () => Promise<ActionResult<T>>,
    okMsg: string,
    onOk?: (data: T) => void,
  ) {
    setError(null);
    setFieldErrors({});
    setActing(actingKey);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          toast(okMsg, "settled");
          onOk?.(res.data);
          // Unconditional, even where the server wrote nothing: the actions
          // return early on a no-op, and the only way to reach that branch
          // from here is props that are already stale — in which case the
          // refresh IS the remedy (§6a rule 12).
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        } else if (res.kind === "validation") {
          const errs = res.fieldErrors ?? {};
          setFieldErrors(errs);
          // A key no FormError claims must not dead-end silently (the Phase 7
          // lesson): fall it back into the banner. Reachable today only via
          // `zodFieldErrors`' indexed keys (`events.0`), which the checkboxes
          // can't produce — but a refusal that routes nowhere is a silent
          // failure waiting for the day it isn't.
          const unclaimed = Object.keys(errs).find((k) => !claimedFieldKeys.includes(k));
          if (unclaimed) setError(errs[unclaimed]);
        } else {
          // forbidden or conflict — including `deleteEndpoint`'s
          // history refusal and every `updatedAt` guard's "someone else just
          // changed that endpoint".
          setError(res.message);
        }
      } finally {
        setActing(null);
      }
    });
  }

  return {
    acting,
    error,
    setError,
    fieldErrors,
    retryAfterSec,
    clearRetry: () => setRetryDeadline(null),
    run,
  };
}

function EventChecks({
  selected,
  disabled,
  onToggle,
  namePrefix,
}: {
  selected: WebhookEvent[];
  disabled: boolean;
  onToggle: (event: WebhookEvent, on: boolean) => void;
  namePrefix: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {WEBHOOK_EVENTS.map((event) => (
        <label key={event} className="flex items-center gap-2 text-[11.5px] text-fg-secondary">
          <Checkbox
            checked={selected.includes(event)}
            disabled={disabled}
            aria-label={`${namePrefix}: ${EVENT_LABELS[event]}`}
            onChange={(e) => onToggle(event, e.target.checked)}
          />
          <span>{EVENT_LABELS[event]}</span>
          <span className="font-mono text-[10px] text-fg-faint">{event}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Toggling rebuilds the selection through `parseEvents`, which returns
 * `WEBHOOK_EVENTS` order — so this state is canonically ordered by
 * construction rather than in click order. That is what makes the `dirty`
 * comparison below sound: an untick-then-retick has to compare EQUAL to the
 * row's (also canonical) `events`, or the card offers a Save whose server-side
 * no-op check returns early, and the toast claims success with no audit entry
 * behind it (§6a rule 6's phantom-entry shape).
 */
function toggleCanonical(prev: WebhookEvent[], event: WebhookEvent, on: boolean): WebhookEvent[] {
  return parseEvents(on ? [...prev, event] : prev.filter((e) => e !== event));
}

export function EndpointCard({ endpoint }: { endpoint: EndpointRow }) {
  const { acting, error, setError, fieldErrors, retryAfterSec, clearRetry, run } = useRunner([
    "url",
    "events",
  ]);
  const [url, setUrl] = useState(endpoint.url);
  const [events, setEvents] = useState<WebhookEvent[]>(endpoint.events);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const busy = acting !== null;
  // `urlSchema` trims, so comparing the RAW box against the stored value would
  // keep offering a Save for a whitespace-only edit that writes nothing — the
  // normalizing-no-op shape of §6a rule 23. Compared trimmed, and the box is
  // reset to the trimmed value on success, so neither surface can keep a
  // version the database doesn't have.
  const trimmedUrl = url.trim();
  const dirty = trimmedUrl !== endpoint.url || events.join(",") !== endpoint.events.join(",");

  // Stated before the click rather than discovered by it: `deleteEndpoint`
  // refuses an endpoint with delivery history, and this is the same sentence
  // it would return (§6a rule 10 — consume every refusal the rule can make).
  // The action keeps its own check for the race where a delivery lands between
  // this render and the click.
  const deleteBlocked = deleteBlockedReason(endpoint.attempts);
  const unknown = endpoint.unknownEvents;
  // Removing every unrecognised name from a row whose recognised set is empty
  // would leave an endpoint with no events at all, which `eventsSchema`
  // refuses — so the affordance is replaced by the sentence that says what to
  // do first, rather than rendering a click guaranteed to fail.
  const canRemoveUnknown = endpoint.events.length > 0;
  const them = unknown.length === 1 ? "it" : "them";

  return (
    <Card>
      {/* `min-w-0` + `break-all` on the title, `shrink-0` on the actions: a URL
          is one unbreakable token, and CardHeader is a flex row whose h3 will
          not shrink below its content without both. Left alone, a long endpoint
          URL pushed the whole card past the viewport at 375px — /admin/flags
          does not, so that was this page's bug and not the app's accepted
          behaviour. */}
      <CardHeader
        title={<span className="block min-w-0 break-all font-mono text-[12.5px]">{endpoint.url}</span>}
        actions={
          <span className="flex shrink-0 items-center gap-2">
            {!endpoint.active && <Pill>DISABLED</Pill>}
            {endpoint.dead > 0 && (
              <Link
                href="/admin/webhooks/deliveries?state=DEAD"
                className="font-mono text-[10.5px] text-accent hover:underline"
              >
                {endpoint.dead} dead
              </Link>
            )}
            <span className="font-mono text-[10.5px] text-fg-muted">
              {endpoint.attempts} {endpoint.attempts === 1 ? "attempt" : "attempts"}
            </span>
            <Menu
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  aria-label={`Actions for ${endpoint.url}`}
                  className="rounded-(--radius-ctl) px-2 py-0.5 text-fg-muted hover:bg-surface-subtle"
                >
                  ⋯
                </button>
              )}
              items={[
                {
                  label: endpoint.active ? "Disable endpoint" : "Enable endpoint",
                  disabled: busy,
                  onSelect: () =>
                    run(
                      "active",
                      () => setEndpointActive({ id: endpoint.id, active: !endpoint.active }),
                      endpoint.active ? "Endpoint disabled" : "Endpoint enabled",
                    ),
                },
                {
                  label: "Rotate signing secret",
                  disabled: busy,
                  // Never fired straight from the menu: rotating is a hard
                  // cutover for the receiver, so ROTATION_WARNING is stated
                  // first and the dialog's own button is the only way through.
                  onSelect: () => {
                    setError(null);
                    clearRetry();
                    setConfirmRotate(true);
                  },
                },
                {
                  label: "Delete endpoint",
                  danger: true,
                  disabled: busy || deleteBlocked !== null,
                  onSelect: () =>
                    run("delete", () => deleteEndpoint({ id: endpoint.id }), "Endpoint deleted"),
                },
              ]}
            />
          </span>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {/* Both suppressed while the Rotate dialog is open — the dialog carries
            its own copies, so leaving these mounted underneath would show the
            same refusal twice (the flag-rows precedent). */}
        {retryAfterSec !== null && !confirmRotate && (
          <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />
        )}
        {error && !confirmRotate && <Banner tone="fault" title={error} />}
        {freshSecret && <SecretOnce secret={freshSecret} onDone={() => setFreshSecret(null)} />}

        {unknown.length > 0 && (
          <Banner
            tone="attention"
            title={
              unknown.length === 1
                ? "This endpoint subscribes to an event this build no longer sends"
                : "This endpoint subscribes to events this build no longer sends"
            }
          >
            <span className="flex flex-col gap-2">
              <span className="flex flex-wrap gap-1.5">
                {unknown.map((event) => (
                  <code
                    key={event}
                    className="rounded-(--radius-ctl) border border-border bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-fg"
                  >
                    {event}
                  </code>
                ))}
              </span>
              {/* The correction that matters: saving PRESERVES these. An earlier
                  draft of this banner said a save would remove them, which was
                  true of Task 6's `parseEvents` and is false of Task 7's
                  shipped `updateEndpoint` — built from the old sentence, the
                  page would tell the admin the opposite of what Save does.
                  The "button below" clause is gated on the button actually
                  being there: in the no-known-events branch the removal is
                  replaced by the sentence that says what to do first, and a
                  promise of a button that isn't rendered is §6a rule 16 in
                  miniature. */}
              <span className="text-[11px] text-fg-muted">
                Nothing is emitted for {them} — a rename or a removed integration left {them} behind.
                Saving this endpoint keeps {them} exactly as {unknown.length === 1 ? "it is" : "they are"}
                {canRemoveUnknown ? `, and the only thing that drops ${them} is the button below.` : "."}
              </span>
              {canRemoveUnknown ? (
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={acting === "remove-unknown"}
                    disabled={busy && acting !== "remove-unknown"}
                    onClick={() =>
                      run(
                        "remove-unknown",
                        () =>
                          // The endpoint's OWN stored url and events, not this
                          // card's drafts: this button removes the
                          // unrecognised names and nothing else, so an
                          // in-progress URL edit is not smuggled into the save.
                          // `removeUnknown` names them exactly — the action
                          // never infers a removal from absence.
                          updateEndpoint({
                            id: endpoint.id,
                            url: endpoint.url,
                            events: endpoint.events,
                            removeUnknown: unknown,
                          }),
                        unknown.length === 1
                          ? "Unrecognised subscription removed"
                          : "Unrecognised subscriptions removed",
                      )
                    }
                  >
                    {unknown.length === 1 ? "Remove it" : `Remove all ${unknown.length}`}
                  </Button>
                </span>
              ) : (
                <span className="text-[11px] text-fg-muted">
                  Tick at least one recognised event and save before removing {them} — this endpoint
                  has no recognised events left, and one with no events at all would never fire, so
                  the removal would be refused.
                </span>
              )}
            </span>
          </Banner>
        )}

        <div className="flex flex-col gap-1">
          <Input
            aria-label={`URL for ${endpoint.url}`}
            value={url}
            disabled={busy}
            invalid={!!fieldErrors.url}
            className="w-full max-w-[420px] py-1.5 font-mono text-xs"
            onChange={(e) => setUrl(e.target.value)}
          />
          <FormError>{fieldErrors.url}</FormError>
        </div>

        <div className="flex flex-col gap-1">
          <EventChecks
            selected={events}
            disabled={busy}
            namePrefix={endpoint.url}
            onToggle={(event, on) => setEvents((prev) => toggleCanonical(prev, event, on))}
          />
          {/* The "pick at least one event" refusal lands where the operator is
              looking. `useRunner` claims `events` above, so it does not also
              appear in the banner. */}
          <FormError>{fieldErrors.events}</FormError>
        </div>

        {deleteBlocked && (
          <p className="border-l-2 border-border-strong pl-2.5 text-[11px] leading-snug text-fg-muted">
            {deleteBlocked}
          </p>
        )}

        {dirty && (
          <span>
            <Button
              size="sm"
              variant="primary"
              loading={acting === "save"}
              disabled={busy && acting !== "save"}
              onClick={() =>
                run(
                  "save",
                  () => updateEndpoint({ id: endpoint.id, url: trimmedUrl, events }),
                  "Endpoint saved",
                  // Reset to what was actually sent, so a trailing space the
                  // server trimmed away can't survive in the box (rule 23).
                  () => setUrl(trimmedUrl),
                )
              }
            >
              Save changes
            </Button>
          </span>
        )}
      </CardBody>

      {/* Rotation is a hard cutover and the sentence for it already exists in
          `src/lib/webhooks.ts` — rendered, never retyped (§6a rules 5 and 11).
          `deliverWebhook` decrypts at attempt time, so rotating re-signs
          in-flight deliveries with the new key; a receiver still holding the
          old one answers 401, which Task 10 classifies as permanent. */}
      <Dialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title="Rotate this endpoint's signing secret?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={acting === "rotate"}
              onClick={() =>
                run(
                  "rotate",
                  () => rotateSecret({ id: endpoint.id }),
                  "Secret rotated — copy the new one",
                  (data) => {
                    setFreshSecret(data.secret);
                    setConfirmRotate(false);
                  },
                )
              }
            >
              Rotate secret
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {retryAfterSec !== null && (
            <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />
          )}
          {error && <Banner tone="fault" title={error} />}
          <p>{ROTATION_WARNING}</p>
          <p className="text-fg-muted">
            The new secret is shown once, on this card, and can never be read back out of the
            database.
          </p>
        </div>
      </Dialog>
    </Card>
  );
}

export function NewEndpointCard() {
  const { acting, error, fieldErrors, retryAfterSec, clearRetry, run } = useRunner(["url", "events"]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const busy = acting !== null;

  return (
    <Card>
      <CardHeader title="New endpoint" />
      <CardBody className="flex flex-col gap-3">
        {retryAfterSec !== null && (
          <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />
        )}
        {error && <Banner tone="fault" title={error} />}
        {freshSecret && <SecretOnce secret={freshSecret} onDone={() => setFreshSecret(null)} />}

        <div className="flex flex-col gap-1">
          <Input
            aria-label="New endpoint URL"
            placeholder="https://example.com/hooks/backroom"
            value={url}
            disabled={busy}
            invalid={!!fieldErrors.url}
            className="w-full max-w-[420px] py-1.5 font-mono text-xs"
            onChange={(e) => setUrl(e.target.value)}
          />
          <FormError>{fieldErrors.url}</FormError>
        </div>

        <div className="flex flex-col gap-1">
          <EventChecks
            selected={events}
            disabled={busy}
            namePrefix="New endpoint"
            onToggle={(event, on) => setEvents((prev) => toggleCanonical(prev, event, on))}
          />
          <FormError>{fieldErrors.events}</FormError>
        </div>

        <span>
          <Button
            size="sm"
            variant="primary"
            loading={acting === "create"}
            onClick={() =>
              run(
                "create",
                () => createEndpoint({ url: url.trim(), events }),
                "Endpoint created — copy its secret",
                (data) => {
                  setFreshSecret(data.secret);
                  setUrl("");
                  setEvents([]);
                },
              )
            }
          >
            Create endpoint
          </Button>
        </span>
      </CardBody>
    </Card>
  );
}
```

- [x] **Step 3: Write the page**

Create `src/app/(app)/admin/webhooks/page.tsx`:

```tsx
import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { EndpointCard, NewEndpointCard } from "@/components/admin/endpoint-editor";
import { listEndpoints } from "@/server/modules/admin/queries";
import { MAX_JOB_ATTEMPTS } from "@/lib/jobs";

export default async function WebhooksPage() {
  await requireRole("admin");
  const endpoints = await listEndpoints();

  return (
    <>
      <PageHeader
        title="Webhooks"
        actions={
          <Link href="/admin/webhooks/deliveries" className="text-[12px] font-medium text-accent hover:underline">
            Delivery attempts →
          </Link>
        }
      />
      <div className="flex max-w-[720px] flex-col gap-3">
        <Banner tone="neutral" title="Every POST is signed, and every attempt is recorded">
          The signing secret is shown once when you create or rotate it and is stored encrypted, so it
          can never be read back — only replaced. A failed delivery is retried with a widening gap,{" "}
          {/* MAX_JOB_ATTEMPTS, not the literal "five": the worker enforces this
              cap and the deliveries chip reads `DEAD · 5/5` from the same
              constant, so tuning the worker must not leave this sentence
              claiming a number nothing enforces (§6a rule 26). It is attempts
              in TOTAL, not retries after the first — the worker dead-letters
              when `attempts >= MAX_JOB_ATTEMPTS`. */}
          {MAX_JOB_ATTEMPTS} attempts in all, before it dead-letters — and a dead one can be replayed.
        </Banner>

        {endpoints.length === 0 && (
          <p className="text-xs text-fg-muted">
            No endpoints yet — nothing is being notified when approvals execute, offboardings complete
            or purchases are approved.
          </p>
        )}

        {endpoints.map((endpoint) => (
          <EndpointCard key={endpoint.id} endpoint={endpoint} />
        ))}

        <NewEndpointCard />
      </div>
    </>
  );
}
```

- [x] **Step 4: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

In the preview as `admin@thebackroomop.com`, `/admin/webhooks` — **all of this was run, and items 7–10
are the ones that found something:**

1. Empty state, then create an endpoint at `http://localhost:4999/hook` with **An approval finished
   executing** ticked. The `attention`-toned banner appears with a `select-all` secret and an "I've
   copied it" button.
2. Reload the page — **the secret is gone and there is no way to see it again.** That is the design.
   Also confirm the ciphertext is not in the page source: `listEndpoints`' explicit `select` is what
   keeps it out of the RSC payload (§6a rule 31).
3. Create with no events ticked → the refusal renders under the checkboxes, not in the banner.
4. `not-a-url` → refused under the URL field.
5. Rotate from the ⋯ menu → the dialog states `ROTATION_WARNING` **before** the click, then a new value,
   again once.
6. Disable, then re-enable — the safe direction has to work (§6a rule 14), and the `DISABLED` pill
   appears on the header.
7. **Add an unrecognised event straight into the row** (`update "WebhookEndpoint" set events =
   array['approval.executed','asset.status_changed','employee.hired']`), reload, and check the banner
   names both. Then **edit only the URL and save**: the unknown names must survive, and the audit diff
   must carry `url` alone. Then **Remove all 2**: the diff must show a real `events` change.
8. **Set the row to hold ONLY an unrecognised event.** The removal button must be replaced by the
   sentence telling the admin to tick a recognised event first.
9. **Insert one `WebhookDelivery` row.** Delete must go `disabled` and the card must print the refusal.
   Remove the row again and Delete works.
10. **375px.** The long mono URL in the card header overflowed the viewport (`/admin/flags` does not),
    fixed with `min-w-0`/`break-all` on the title and `shrink-0` on the actions.
11. `/audit?entity=webhook-endpoint` — every entry resolves and **no Fields cell names a field that
    didn't change** (§6a rules 8/19).

**Leave the endpoint table EMPTY.** The original text said to re-create an endpoint for Task 10's
end-to-end check; don't. The secret is shown once, so an endpoint left behind is one whose secret nobody
holds, and Task 10's check needs the plaintext to verify the signature at its local receiver. Task 10
creates its own.

- [x] **Step 5: Commit**

```bash
git add src/components/admin/endpoint-editor.tsx "src/app/(app)/admin/webhooks" \
  src/lib/webhooks.ts src/lib/webhooks.test.ts src/server/webhooks/sign.ts \
  src/server/webhooks/sign.test.ts src/server/modules/admin/webhook-actions.ts
git commit -m "feat(webhooks): endpoints, and a secret you get exactly one look at"
```

---

### Task 9: The emitter, and the index that stops a double-click

> ### AMENDED — this section is the code as SHIPPED (`5a5494e`). Two things the original blocks got
> wrong, both worth reading before Tasks 10 and 13.
>
> **1. The migration was HALF a guarantee.** The partial unique index indexes an **expression**
> (`payload->>'deliveryId'`), and Postgres never collides NULLs — so a `DELIVER_WEBHOOK` job with no
> `deliveryId` key would have been permitted without limit, and the "at most one live job per delivery"
> promise would have quietly not applied to exactly the payloads most likely to be malformed. The
> sibling index this task was told to mirror **already has the companion constraint**
> (`Job_execute_payload_shape`, in `20260814093000_provenance_restrict_and_indexes`) with a comment
> saying precisely this — *"or the one-live-job partial unique above it silently no-ops (NULLs never
> collide)"*. The plan copied the index and not its companion. `Job_deliver_payload_shape` is now in the
> same migration, so the phase still has **one** migration.
>
> Proven against the live database, all four cases: a `DELIVER_WEBHOOK` job with `payload = '{}'` is
> refused by the CHECK; a well-formed one is accepted; a **second live** job for the same `deliveryId` is
> refused by the unique index; and once the first job is `DONE`, the same `deliveryId` **can** be
> enqueued again — which is not incidental, it is what makes Task 13's Replay possible at all. A unique
> index without the `status IN ('PENDING','RUNNING')` predicate would have blocked replay forever.
>
> **2. The emitter's `parseEvents` re-check was dead code with a false comment.** The plan had
> `if (!parseEvents(endpoint.events).includes(event)) continue;`, commented as stopping a renamed event
> from being resurrected by a stale row. It cannot fire: `has` is exact array membership, so any row the
> query returns provably contains `event`, and `event` is typed `WebhookEvent` — therefore
> `partitionEvents` puts it in `known` unconditionally. §6a rule 16, in the form where the comment
> describes a guard the type system already provides. Removed, and the comment now says what is actually
> true: **the parameter type is the guard.** Unrecognised names in the same row are irrelevant to this
> event and are preserved untouched by Task 7's `removeUnknown`.
>
> **3. One accepted failure mode, recorded rather than guarded** (it is in `emit.ts`'s doc comment too).
> Scope decision #10 forbids I/O, and this does none — but `create` is still a write, and a throw here
> rolls back the caller's transaction. The reachable path is narrow: the emitter reads an endpoint, a
> concurrent `deleteEndpoint` commits, and `webhookDelivery.create` then violates its foreign key. In
> `executeApproval` that surfaces as `EXECUTION_FAILED`, which a retry clears (the endpoint is gone by
> then, so the retry emits nothing). **Swallowing it is not available** — a failed statement poisons the
> Postgres transaction, so there is nothing left to continue with — and moving the emit outside the
> transaction trades this for the far worse "webhook fired for a change that rolled back." Recorded in
> HANDOVER §8.
>
> **4. Local names, corrected.** `runTransition` calls the request row **`req`**, not `request`. And in
> `execute-approval.ts`, `asset` is non-null by the guard at the top of `runExecution`, so the plan's
> `asset?.tag ?? null` hedge is misleading — it is `asset.tag`, a real tag.

The producer that has never existed. `emitWebhook` writes rows and performs **no I/O** — scope
decision #10 — because an unreachable endpoint must never roll back the inventory change that
mentioned it.

**Files:**
- Create: `prisma/migrations/20260819090000_job_one_live_deliver_per_delivery/migration.sql`,
  `src/server/webhooks/emit.ts`
- Modify: `src/worker/execute-approval.ts`, `src/server/modules/offboarding/actions.ts`,
  `src/server/modules/purchases/actions.ts`

- [x] **Step 1: Write the migration**

`prisma/migrations/20260819090000_job_one_live_deliver_per_delivery/migration.sql`:

```sql
-- At most one live delivery job per WebhookDelivery row. The exact mirror of
-- Job_one_live_execute_per_approval (20260814090100_integrity_constraints):
-- Task 13's Replay re-enqueues, and a double-click would otherwise put two
-- workers on one delivery and POST the same envelope twice — which a receiver
-- cannot deduplicate, because a replay reuses the delivery's id and therefore
-- produces a byte-identical envelope and signature (see webhooks/sign.ts).
--
-- Raw SQL with no schema.prisma counterpart, like the three integrity
-- constraints before it: `prisma db pull` will not reproduce it. HANDOVER §8
-- tracks that gap rather than pretending it isn't there.
CREATE UNIQUE INDEX "Job_one_live_deliver_per_delivery"
  ON "Job" ((payload->>'deliveryId'))
  WHERE "status" IN ('PENDING', 'RUNNING') AND "type" = 'DELIVER_WEBHOOK';

-- The other half of that guarantee, and the half the plan for this task left
-- out: the partial unique above indexes an EXPRESSION, and a DELIVER_WEBHOOK
-- job with no 'deliveryId' key yields NULL, which never collides with
-- anything. Without this constraint the index silently permits unlimited live
-- jobs for a malformed payload — the identical reasoning, and the identical
-- pairing, as Job_execute_payload_shape in
-- 20260814093000_provenance_restrict_and_indexes. Copying the index without
-- its companion copies half a guarantee.
ALTER TABLE "Job" ADD CONSTRAINT "Job_deliver_payload_shape"
  CHECK (type <> 'DELIVER_WEBHOOK' OR payload ? 'deliveryId');
```

Apply it and regenerate the client:

```bash
npx prisma migrate deploy && npx prisma generate
```

Expected: `8 migrations found` … `Applied`. Raw SQL with no `schema.prisma` counterpart, exactly like
the three integrity constraints before it — `prisma db pull` would not reproduce it, which is why
HANDOVER §8 tracks that gap rather than pretending it doesn't exist.

**Then prove both halves bite**, because an index that silently doesn't constrain looks identical to one
that does:

```bash
docker exec inventory-db-1 psql -U inventory -d inventory \
  -c "insert into \"Job\" (id,type,payload) values ('t1','DELIVER_WEBHOOK','{}'::jsonb);"
```

Expected: `violates check constraint "Job_deliver_payload_shape"`. Then insert two jobs with the same
`deliveryId` (second refused by the unique index), mark the first `DONE`, and insert again (**accepted** —
that is Replay). Clean up the test rows afterwards.

- [x] **Step 2: Write the emitter**

Create `src/server/webhooks/emit.ts`:

```ts
import type { Prisma } from "@prisma/client";
// Relative, not "@/": src/worker runs under tsx and every worker-side module in
// this repo imports relatively (verified — there is not one "@/" import under
// src/worker). emit.ts is imported from BOTH the worker (execute-approval.ts)
// and Next server actions, so it has to use the style that works in both.
import type { WebhookEvent } from "../../lib/webhooks";

/**
 * The only producer of DELIVER_WEBHOOK jobs. Called from INSIDE the transaction
 * that writes the domain change, so a webhook is never emitted for something
 * that then rolled back.
 *
 * Scope decision #10: this function performs NO I/O and must never learn to.
 * An endpoint being unreachable is a delivery problem; rolling back an asset
 * lifecycle change because someone's server is down would be an inventory
 * problem, and a much worse one. All it does is write rows.
 *
 * Scope decision #6: one WebhookDelivery (the ledger the page reads) plus one
 * Job (the retry engine) per subscribed endpoint, created together so they
 * cannot disagree about whether a delivery exists.
 *
 * It lives in a PLAIN module, deliberately. Two of its three call sites are
 * `"use server"` files, where every export becomes a network-reachable server
 * action — and this function's first parameter is a transaction client, which
 * is not serialisable across that boundary. Importing INTO a "use server"
 * module is fine; being exported FROM one would not be (the same reasoning
 * that put `asActionResult` in src/server/prisma-errors.ts).
 *
 * **One accepted failure mode, recorded rather than guarded.** These are still
 * writes, so they can still fail, and a throw here rolls back the caller's
 * transaction. The reachable case is narrow: this reads an endpoint, a
 * concurrent `deleteEndpoint` commits, and the `webhookDelivery.create` below
 * then violates its foreign key. For `executeApproval` that surfaces as
 * EXECUTION_FAILED on the approval, which a retry clears (the endpoint is gone
 * by then, so the retry emits nothing). Swallowing it is not an option — a
 * failed statement poisons the Postgres transaction, so there is nothing left
 * to continue with — and the alternative, emitting outside the transaction,
 * trades this for the far worse "webhook fired for a change that rolled back".
 */
export async function emitWebhook(
  tx: Prisma.TransactionClient,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  // `active: true` is load-bearing, not a nicety: a disabled endpoint must
  // stop RECEIVING, and the only way to express that is to never write the
  // delivery. Its existing history stays readable on the deliveries page.
  //
  // The SQL predicate is the whole filter, and `parseEvents` is deliberately
  // NOT re-applied to the result. `has` is exact array membership, and `event`
  // is typed `WebhookEvent` — so any row this returns provably contains a name
  // that is in WEBHOOK_EVENTS, which is exactly what `partitionEvents` would
  // put in `known`. A runtime re-check here could never fail, and a comment
  // claiming it stopped a renamed event from being resurrected would be
  // describing something the type system already made impossible. The
  // parameter type IS the guard; unrecognised names in the same row are
  // irrelevant to this event and are preserved untouched (Task 7's
  // `removeUnknown`).
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { active: true, events: { has: event } },
    select: { id: true },
  });

  for (const endpoint of endpoints) {
    const delivery = await tx.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload: data as Prisma.InputJsonObject,
        status: "PENDING",
      },
    });
    // `deliveryId` is not optional in any sense the database will tolerate:
    // Job_deliver_payload_shape (this phase's migration) rejects a
    // DELIVER_WEBHOOK job without it, because the one-live-job-per-delivery
    // unique index is on an expression and NULLs never collide.
    await tx.job.create({
      data: { type: "DELIVER_WEBHOOK", payload: { deliveryId: delivery.id } },
    });
  }
}
```

`data` is the envelope's `data` only — `webhookEnvelope` wraps it at delivery time (Task 10), so the
stored payload stays the facts and the envelope stays a presentation concern.

- [x] **Step 3: Emit on `approval.executed`**

In `src/worker/execute-approval.ts`, add `import { emitWebhook } from "../server/webhooks/emit";` —
relative, matching every other import in that file, because the worker runs under `tsx` and there is not
one `@/` import anywhere under `src/worker`. Emit as the **last statement** of `runExecution`'s
transaction, after the `action: "executed"` audit entry:

```ts
    // Last thing in the transaction, and only reachable on genuine success:
    // every guard above leaves through `return fail(...)`, so nothing that
    // ended as EXECUTION_FAILED gets here. Scope decision #14 — ids and
    // refNos, never whole rows. `asset` is non-null by the guard at the top
    // of this function, so assetTag is the real tag rather than a hedge.
    await emitWebhook(tx, "approval.executed", {
      approvalId: approval.id,
      refNo: approval.refNo,
      type: approval.type,
      assetId: asset.id,
      assetTag: asset.tag,
    });
```

- [x] **Step 4: Emit on `offboarding.completed`**

Import as `@/server/webhooks/emit` here — this file is a Next module, unlike the worker. In
`completeOffboarding`, directly after the `action: "offboarding.completed"` `writeAudit` call and inside
the same transaction:

```ts
    await emitWebhook(tx, "offboarding.completed", {
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      decisions: decisions.length,
    });
```

`decisions` is one entry per held asset and the undecided guard has already returned, so the count is
the number of items actually settled. The item detail stays in the audit entry, which is the immutable
record; a webhook is a notification, not a replication feed.

- [x] **Step 5: Emit on `purchase_request.completed`**

In `runTransition`, after the `NoteEntry` and `writeAudit` calls and before `acted = …`. The request row
local is **`req`**:

```ts
    if (action === "complete") {
      await emitWebhook(tx, "purchase_request.completed", {
        purchaseRequestId: req.id,
        refNo: req.refNo,
      });
    }
```

`complete` is the only action reaching `COMPLETED`, and only from `IT_REVIEWED`
(`purchase-flow.ts:83`) — so guarding on the action is equivalent to guarding on the destination state,
without a second definition of which transition finishes a request.

- [x] **Step 6: Prove the emitter fires — and doesn't**

The plan originally asked only for the inert case (no endpoints → `SELECT count(*) FROM
"WebhookDelivery"` is `0`). **That is not sufficient: an `emitWebhook` with an empty body passes it
perfectly.** Both halves were run:

1. **Inert.** With zero endpoints, complete a purchase request. It completes; `WebhookDelivery` stays 0
   and no `DELIVER_WEBHOOK` job appears.
2. **Positive, with an event filter.** Create TWO endpoints — one subscribed to
   `purchase_request.completed`, one to `approval.executed` **only**. Complete a request: exactly ONE
   delivery, on the first endpoint, `status PENDING`, `attempts 0`, payload `{refNo,
   purchaseRequestId}`, plus one `DELIVER_WEBHOOK` job whose `deliveryId` **is** that delivery's id.
   The `approval.executed` endpoint gets nothing.
3. **Disabled.** Set `active = false` and complete another request → no new delivery. `active: true` in
   the emitter's `where` is what makes "disabled" mean "stops receiving".
4. **The worker's own call site.** Claim and approve `APR-2041` (its three system checks pass, so
   execution succeeds), then `npm run worker:once`. The asset moves SPARE → DEPLOYED, the approval
   reaches EXECUTED, and `approval.executed` is emitted from inside the worker's transaction and picked
   up **in the same drain**. This is the only check that proves the relative import resolves under
   `tsx`; a cheaper smoke test is that `npm run worker:once` loads at all.
5. **Offboarding.** The cheapest real exercise of the third call site is an OFFBOARDING employee holding
   **nothing** with `m365Status` inactive — `completeOffboarding` then succeeds immediately and emits
   with `decisions: 0`, which also confirms `employee.employeeNo` is in scope (the `findUnique` uses
   `include`, so all scalars ride along).

In every case the resulting `DELIVER_WEBHOOK` jobs dead-letter on the **existing**
`"webhook delivery ships in Phase 8"` placeholder, and `WebhookDelivery.status` stays `PENDING` — the
ledger is not mirrored from the job until Task 10. That divergence is Task 10's boundary, not a bug here.

**Clean up the endpoints and deliveries afterwards** — their shown-once secrets are gone, so they would
only mislead Task 10, which needs a plaintext secret at its receiver.

- [x] **Step 7: Typecheck, lint, full unit suite, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add prisma/migrations/20260819090000_job_one_live_deliver_per_delivery src/server/webhooks/emit.ts src/worker/execute-approval.ts src/server/modules/offboarding/actions.ts src/server/modules/purchases/actions.ts
git commit -m "feat(webhooks): the producer that never existed, and the index that stops a double-send"
```

No unit tests: `emitWebhook` needs a transaction client and the suite is node-only with no database, the
same reason Task 5 added none. Its verification is live, above.

---

### Task 10: The worker delivers for real

> ### AMENDED — this section is the code as SHIPPED (`7ad0014`). The banner's five items were all real;
> **two more of the same kind were found while implementing them**, and both are in the "ledger mirrors
> the job" family this task's own intro names.
>
> #### The five the reviewers wrote in advance, all confirmed
>
> **1. `redirect: "manual"`, and a 3xx is PERMANENT.** `fetch` defaults to `follow`, so a 307/308 from an
> approved receiver forwards the method, the body **and the signature header** to any host that receiver
> names — one the admin never approved and which Task 7's `urlSchema` never got to inspect, because it
> can only see the first hop. This is the real SSRF hole. Neither Stripe nor GitHub follows webhook
> redirects. **Verified with a receiver that 307s to a second local port: that port logged nothing.**
> A 3xx is also terminal — retrying cannot make a redirect resolve — and its `lastError` has to *say so*,
> because "307 Temporary Redirect" reads to an operator as exactly the kind of transient thing a retry
> fixes.
>
> **2. Response bodies never enter `lastError`** — status and statusText only, which is what keeps Task
> 7's accepted-capability argument true by making this a blind reachability oracle rather than a way to
> read arbitrary internal HTTP responses back out of an admin page. The shipped code also **cancels** the
> response body, which releases the socket and makes the never-read property structural rather than
> incidental. There is a comment telling the next reader not to "improve" it.
>
> **3. A `decryptSecret` failure marks the row `DEAD` before throwing.** As drafted the decrypt happened
> before any `mark()`, and the worker's catch updates **`Job` only** — so the row sat at `PENDING`/`0`
> forever, `deliveryStage` rendered it as a healthy `QUEUED`, and the real error was buried in
> `Job.lastError`, a column no admin page reads.
>
> **4. `secretAad(endpoint.id)`**, never a bare id or a re-derived string (Task 7 pinned it with a literal
> test for this reason). **5. `MAX_JOB_ATTEMPTS`**, not a reintroduced local `MAX_ATTEMPTS`.
>
> #### The two the banner did not have
>
> **6. A retryable failure on the LAST attempt has to write `DEAD`, not `RETRYING`.** This is the one that
> matters. The worker's `tick()` dead-letters the job when `job.attempts >= MAX_JOB_ATTEMPTS`, but the
> drafted handler always wrote `RETRYING` on a retryable failure — so on the fifth failure the **job** goes
> `DEAD` while the **delivery row** still reads `RETRYING`. `deliveryStage` then renders `RETRYING · 5/5`,
> and **card `3h`'s headline artifact, `DEAD · 5/5`, never appears for the single commonest cause of a
> dead delivery: a receiver that was simply down.** Only permanent failures would have produced it. Shipped
> as `retryStatus(attempts)`, which mirrors `tick()`'s decision from the same value and the same constant.
> Verified by driving one delivery through all five attempts against a 500: `RETRYING` 1–4 with `attempts`
> in lockstep with the job, then `DEAD` in **both** at 5, and `deliveryStage` returning `DEAD · 5/5`.
>
> **7. The disabled-endpoint branch had the exact bug the banner's item 3 describes.** Item 3 said to treat
> a decrypt failure "as a `Permanent` in the same shape as the disabled-endpoint branch" — but that branch
> threw **without marking the row**, so it left the ledger at `PENDING` too. Two paths, one omission, and
> the banner pointed at the broken one as the model. Fixed structurally rather than by remembering: a
> private `permanent(id, attempts, reason)` helper marks `DEAD` *and then* throws, so a `Permanent` cannot
> be raised without the ledger moving. The only path that throws `Permanent` directly is the one where the
> row does not exist to mark.

`src/worker/index.ts` currently answers every `DELIVER_WEBHOOK` job with
`status: "DEAD", lastError: "webhook delivery ships in Phase 8"`. This is that phase.

The delivery handler owns one subtle obligation: **the `WebhookDelivery` row is a mirror of the job,
not a second retry loop** (scope decision #6). The worker's existing `catch` already does backoff and
dead-letters at `MAX_JOB_ATTEMPTS`; the handler's job is to make the ledger say the same thing — which,
per amendments 6 and 7, is harder than it sounds and is where both new defects lived.

**Files:**
- Create: `src/worker/deliver-webhook.ts`
- Modify: `src/worker/index.ts`

- [x] **Step 1: Write the delivery handler**

Create `src/worker/deliver-webhook.ts`:

```ts
import { prisma } from "../server/db/client";
import { decryptSecret } from "../server/crypto";
import { MAX_JOB_ATTEMPTS } from "../lib/jobs";
import { SIGNATURE_HEADER, webhookEnvelope } from "../lib/webhooks";
// secretAad and the signer both live in sign.ts precisely so the worker never
// has to import webhook-actions.ts, which carries "use server". SIGNATURE_HEADER
// is in lib/webhooks.ts instead, because /admin/webhooks names the same header
// in a client component and sign.ts imports node:crypto (Task 8).
import { secretAad, signPayload } from "../server/webhooks/sign";

const TIMEOUT_MS = 10_000;

/** A delivery that can never succeed — dead-letter it now instead of burning five attempts. */
class Permanent extends Error {}

/**
 * The ledger's status for a RETRYABLE failure, mirroring the decision
 * `tick()` is about to make about the job from the same `attempts` value and
 * the same constant (`src/worker/index.ts`: `job.attempts >= MAX_JOB_ATTEMPTS`).
 *
 * This exists because the obvious version — always write RETRYING and let the
 * worker worry about the cap — puts the two out of step on the one attempt
 * that matters most. On the fifth failure the job goes DEAD while the delivery
 * row still reads RETRYING, so `deliveryStage` renders `RETRYING · 5/5` and
 * card 3h's headline artifact, `DEAD · 5/5`, never appears for the commonest
 * cause of a dead delivery: a receiver that was simply down. Scope decision #6
 * makes this row a MIRROR of the job; a mirror that disagrees on the terminal
 * state is worse than no mirror, because the page looks authoritative.
 */
function retryStatus(attempts: number): "RETRYING" | "DEAD" {
  return attempts >= MAX_JOB_ATTEMPTS ? "DEAD" : "RETRYING";
}

/**
 * One attempt. Throwing hands control back to the worker's existing catch, which
 * owns backoff and the dead-letter at MAX_JOB_ATTEMPTS — so this function must NOT
 * implement its own retry. What it does own is keeping WebhookDelivery in step
 * with the job, which is what makes the page's `DEAD · 5/5` chip honest.
 *
 * `attempts` is the job's own count, passed in, so the two can never diverge.
 *
 * **Why the writes below need no optimistic guard**, unlike every mutation in
 * `src/server`: the job lease IS the lock. `leaseNext` claims one job with
 * `FOR UPDATE SKIP LOCKED`, and `Job_one_live_deliver_per_delivery` (Task 9's
 * migration) makes it impossible for a second live job to exist for this
 * delivery — so there is exactly one writer of this row at a time. That is a
 * load-bearing dependency on a raw-SQL index with no schema.prisma
 * counterpart: if it is ever dropped, these updates need guards.
 */
export async function deliverWebhook(deliveryId: string, attempts: number): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  // A delivery whose row is gone is not a failure to retry — nothing to send,
  // and nothing to mark either, which is why this one throws directly instead
  // of going through `permanent()`.
  if (!delivery) throw new Permanent(`WebhookDelivery ${deliveryId} no longer exists`);
  if (delivery.status === "DELIVERED") return;
  if (!delivery.endpoint.active) {
    return permanent(delivery.id, attempts, `Endpoint ${delivery.endpoint.url} is disabled`);
  }

  const body = JSON.stringify(
    webhookEnvelope({
      id: delivery.id,
      event: delivery.event,
      occurredAt: delivery.createdAt,
      data: (delivery.payload ?? {}) as Record<string, unknown>,
    }),
  );

  // One instant for the whole attempt: it goes into the signature (the signed
  // string is `${t}.${body}`, so a receiver's tolerance window is checked
  // against this) and, on success, into deliveredAt. Signing at a different
  // moment than the one we record is how a log stops explaining a rejection.
  const at = new Date();

  let secret: string;
  try {
    // secretAad(endpoint.id), never a bare id or a re-derived string: Task 7
    // pinned that with a literal test because getting it wrong leaves newly
    // created secrets working while every pre-existing one silently fails.
    secret = decryptSecret(delivery.endpoint.secret, secretAad(delivery.endpoint.id));
  } catch (err) {
    // A secret this build cannot decrypt will not become decryptable on
    // attempt five. Marking the row FIRST is the whole point: the worker's
    // catch updates the Job only, so a throw from here without this leaves the
    // delivery at PENDING/0 forever, which `deliveryStage` renders as a
    // perfectly healthy QUEUED while the real error sits in `Job.lastError` —
    // a column no admin page reads.
    return permanent(
      delivery.id,
      attempts,
      `Signing secret could not be decrypted: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let response: Response;
  try {
    response = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Sign the exact bytes we send. Re-serialising the envelope on either
        // side of this is how signatures start disagreeing over key order.
        [SIGNATURE_HEADER]: signPayload(body, secret, at),
        "user-agent": "backroom-inventory/1",
      },
      body,
      // NOT the default "follow". A 307/308 from an approved receiver would
      // otherwise forward the method, the body AND the signature header to any
      // host that receiver names — one the admin never approved and cannot
      // see, and one Task 7's urlSchema never got to inspect, since it can only
      // check the first hop. Neither Stripe nor GitHub follows webhook
      // redirects. This is the difference between the accepted capability
      // (scope decision #4: an admin may point this at hosts it can reach) and
      // an open relay (anyone who controls a receiver may redirect it
      // anywhere).
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Connection refused, DNS failure, timeout — all worth retrying.
    await mark(delivery.id, retryStatus(attempts), attempts, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // The body is never read, and that is a deliberate security property, not an
  // oversight: it keeps this a blind reachability oracle rather than a way for
  // an admin to read arbitrary internal HTTP responses back out of
  // `lastError`, which is what Task 7's accepted-capability argument rests on.
  // Only status and statusText are ever recorded. Cancelling releases the
  // socket that would otherwise be held until GC. Do not "improve" this by
  // capturing response text for diagnostics.
  await response.body?.cancel().catch(() => {});

  if (!response.ok) {
    const permanentFailure = isPermanentStatus(response.status);
    await mark(
      delivery.id,
      permanentFailure ? "DEAD" : retryStatus(attempts),
      attempts,
      describe(response.status, response.statusText),
    );
    if (permanentFailure) throw new Permanent(describe(response.status, response.statusText));
    throw new Error(describe(response.status, response.statusText));
  }

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "DELIVERED",
      attempts,
      lastError: null,
      deliveredAt: at,
      // Cleared rather than left: Task 12's seed gives a RETRYING fixture a
      // real nextAttemptAt, so a row that later lands must not keep advertising
      // an attempt that will never happen.
      nextAttemptAt: null,
    },
  });
}

/**
 * A 3xx is permanent because we do not follow redirects (see the fetch call):
 * retrying cannot make a redirect resolve, so the receiver has to be
 * reconfigured. A 4xx other than 408/429 means the receiver understood and
 * refused — retrying a 404 or a 401 five times just delays the same answer.
 * Everything else (5xx, 408, 429) is the receiver having a bad moment.
 */
function isPermanentStatus(status: number): boolean {
  if (status >= 300 && status < 400) return true;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Status and statusText ONLY — see the comment at the `body.cancel()` above.
 * A 3xx says why it is terminal, because "307 Temporary Redirect" otherwise
 * reads to an operator as exactly the kind of transient thing a retry fixes.
 */
function describe(status: number, statusText: string): string {
  const base = `${status} ${statusText}`.trim();
  if (status >= 300 && status < 400) {
    return `${base} — redirects are not followed; point the endpoint at its final URL`;
  }
  return base;
}

/** Mark the ledger DEAD, then throw. Pairing them is what stops a Permanent from leaving the row stale. */
async function permanent(id: string, attempts: number, reason: string): Promise<never> {
  await mark(id, "DEAD", attempts, reason);
  throw new Permanent(reason);
}

async function mark(
  id: string,
  status: "RETRYING" | "DEAD",
  attempts: number,
  lastError: string,
): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id },
    data: { status, attempts, lastError: lastError.slice(0, 1000) },
  });
}

export { Permanent as PermanentDeliveryError };
```

`nextAttemptAt` is deliberately left alone on a failure: the job's `runAt` is the real schedule, and a
second copy of it on the delivery row is exactly the drift scope decision #6 exists to prevent. Task 13
reads the job when it wants to show "next attempt". It is *cleared* on success, because Task 12's seed
gives a `RETRYING` fixture a real one.

- [x] **Step 2: Replace the dead-letter branch**

In `src/worker/index.ts`, add `import { deliverWebhook, PermanentDeliveryError } from "./deliver-webhook";`
and replace the whole `if (job.type === "DELIVER_WEBHOOK") { … }` block in `handle()` with:

```ts
  if (job.type === "DELIVER_WEBHOOK") {
    // Job_deliver_payload_shape (Task 9's migration) makes a job without this
    // key impossible to insert, so this throw is a belt-and-braces check on a
    // row that predates the constraint — not the guard the invariant rests on.
    const deliveryId = String((job.payload as { deliveryId?: unknown } | null)?.deliveryId ?? "");
    if (!deliveryId) throw new Error("DELIVER_WEBHOOK job has no deliveryId");
    await deliverWebhook(deliveryId, job.attempts);
    return;
  }
```

- [x] **Step 3: Let a permanent failure skip the retry budget**

In `tick()`'s catch, `const dead = job.attempts >= MAX_JOB_ATTEMPTS;` becomes:

```ts
    // A 404, a disabled endpoint, an undecryptable secret or a vanished
    // delivery row cannot succeed on attempt five either — dead-letter it now
    // rather than spending the budget to reach the same answer four failures
    // later. The delivery row is already DEAD in that case (deliver-webhook.ts
    // marks it before throwing, which is what `permanent()` exists to
    // guarantee), so the ledger and the job agree without a second write.
    const dead = job.attempts >= MAX_JOB_ATTEMPTS || err instanceof PermanentDeliveryError;
```

- [x] **Step 4: Prove it end to end against a real receiver**

Nothing else in the suite POSTs anywhere, so this step is the only coverage this file has. **Print the
signature and hope is not enough — the receiver must RECOMPUTE the HMAC**, or the test passes for a
signer that produces well-formed garbage (Task 6's review demonstrated two such mutations). The throwaway
receiver used here listens on 4999, verifies `t=…,v1=…` against the plaintext secret, and **also listens
on 5000 as a redirect target that must stay silent.**

Getting the plaintext secret without scraping the shown-once banner: create the endpoint from a script
that calls the same `newSecret` / `encryptSecret(…, secretAad(id))` pair `createEndpoint` does, then emit
through `emitWebhook` inside a real transaction. Keep such scripts under the gitignored `backups/` and
delete them afterwards.

All seven cases were run:

| case | expected | ledger | job |
|---|---|---|---|
| 200 | delivered, signature valid | `DELIVERED`, attempts 1, `deliveredAt` set | `DONE` |
| **307 → :5000** | **:5000 never reached** | `DEAD` 1/5, "redirects are not followed" | `DEAD` |
| 500 ×5 | mirror at every step | `RETRYING` 1–4 then **`DEAD` 5/5** | `PENDING` ×4, `DEAD` |
| 404 | permanent, not 5 attempts | `DEAD` 1/5, "404 Not Found" | `DEAD` |
| connection refused | retryable | `RETRYING`, "fetch failed" | `PENDING` |
| endpoint disabled mid-flight | row marked, not just the job | `DEAD`, "…is disabled" | `DEAD` |
| secret corrupted | row marked, real reason readable | `DEAD`, "could not be decrypted…" | `DEAD` |

Then confirm the chips the page will actually render — `deliveryStage(status, attempts)` gave
`DELIVERED`, `DEAD · 1/5` and `DEAD · 5/5`. The `5/5` is the one that would have silently read
`RETRYING · 5/5` before amendment 6.

**Delete the endpoints and deliveries afterwards.** The corrupted-secret case leaves a row that cannot
deliver anything, and Task 12 seeds its own fixtures.

- [x] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/worker/deliver-webhook.ts src/worker/index.ts
git commit -m "feat(webhooks): the worker actually delivers, and the ledger mirrors the job"
```

No unit tests: this file is `fetch` plus Prisma with no pure core worth extracting, and
`src/worker/**` is reached by nothing in the unit suite (§6a rule 26). `npm run worker:once` against a
real receiver is its only coverage, which is why Step 4 is as detailed as it is.

---

### Task 11: Admin gets its own Home

> ### AMENDED — the code as SHIPPED (`e3e19eb` + `68fc359` + `aa91cf4` + `ac976ac`, deliberately
> unsquashed). **This was the first task executed subagent-driven** (fresh sonnet implementer → sonnet
> spec review → sonnet quality review), and the two reviews found things the previous three tasks'
> single-context passes would plausibly have missed.
>
> **1. The flag state on this page was the raw column, not the effective one — §6a rule 15, reproduced
> one page up.** `adminHome()` read `FeatureFlag.enabled` directly, while `listFlags()` two functions
> above it computes `spec.hasValue ? flagDomain(row) !== null : row?.enabled ?? false`. Those differ for
> `allowed_domain` in the state `(enabled: true, value: null)` — which `flagDomain`'s own doc comment
> calls *"the resting state of any deployment that bootstrapped without a domain"*. In that state the
> Admin Home would have shown a green dot and **"on"** beside "Signup domain restriction" while
> `/signup` enforced nothing **and `/admin/flags` one click away correctly said "off"** — two admin
> surfaces contradicting each other, with the summary being the liar. Fixed by extracting
> **`flagEnabled(spec, row)`** into `src/lib/admin-flags.ts` and routing BOTH callers through it: a
> copied ternary would have been the second definition of the expression rule 15 exists to keep single
> (the handover records three readers having already hand-rolled it once). Seven unit tests, mutation-
> verified — reintroducing the raw-column shortcut kills three of them. **Proven live:** forcing
> `(enabled: true, value: NULL)` makes the Home read `off`; restoring the domain makes it read `on`.
>
> **2. The plan's Step 3 snippet left the Focus toggle inert.** `FocusToggle` renders unconditionally in
> the shared `header`, and Focus's entire job across the other three Homes is hiding secondary sections.
> The Admin Home has none, so as drafted the button would flip a cookie and re-render identically. The
> implementer's first instinct — add a `!focus`-gated `Jump to` card so Focus has something to hide — was
> rejected on review: `WORKSPACE_NAV.admin` is exactly Users & roles / Webhooks / Feature flags, all
> three of which `AdminHomeBody` already links inline, so that card would have repeated them plus a link
> to the page you are on. **The fix is to not offer the control:** `SHOWS_FOCUS_TOGGLE:
> Record<WorkspaceId, boolean>` in `page.tsx`, so a fifth workspace is a compile error rather than a
> silent `undefined`. Note this is a *near relative* of §6a rule 10 and not an instance — rule 10 is
> about an action guaranteed to FAIL; this one succeeds and does nothing visible. Same remedy.
>
> **3. Three smaller corrections to the plan's code.** `String(...)` around the `Stat` values is
> unnecessary (`value` is a `ReactNode`; every sibling branch passes raw numbers). `specFor(spec.key)`
> while already iterating `FLAG_SPECS` re-finds an object in hand — `spec.unavailable` directly, which is
> what `listFlags` already does. And `` `, ${webhooks.inactive} endpoint disabled` `` does not
> pluralise, so two disabled endpoints read "2 endpoint disabled".
>
> **Two review Minors were declined on the record**, not overlooked: collapsing the seven parallel
> queries to five via `groupBy` (the count-pairs would each need `?? 0` fallbacks — more code and a new
> way to be wrong, for two round trips on a rarely-loaded page), and moving `SHOWS_FOCUS_TOGGLE` into
> `src/lib/workspaces.ts` beside the other three `Record<WorkspaceId, …>` tables (that module is the
> nav-and-access truth the **edge middleware** reads; whether one page's header renders a control is a
> fact about that page's JSX, and coupling routing truth to layout is the worse trade). Both reviewers
> independently agreed with the second call once the middleware point was made.

Scope decision #13, and HANDOVER §6 criterion #6. `resolveWorkspace` could already return `"admin"`
while `src/app/(app)/page.tsx` only branched on `purchasing` and `finance` — so an admin landed on the
IT Home and read SLA breaches and fleet composition under a Users / Webhooks / Feature-flags sidebar.
The sidebar and the body described different jobs.

The Admin Home answers the three questions its own sidebar raises: **who can get in, what is switched
on, and are the integrations healthy.**

**Files:**
- Create: `src/components/home/admin-home.tsx`
- Modify: `src/server/modules/admin/queries.ts`, `src/app/(app)/page.tsx`, `src/lib/admin-flags.ts`,
  `src/lib/admin-flags.test.ts`

- [x] **Step 1: One expression for "is this flag effectively on"**

In `src/lib/admin-flags.ts`:

```ts
export function flagEnabled(
  spec: FlagSpec,
  row: { enabled: boolean; value: unknown } | null | undefined,
): boolean {
  return spec.hasValue ? flagDomain(row) !== null : row?.enabled ?? false;
}
```

`listFlags()` replaces its inline ternary with a call to it, and `adminHome()` (Step 2) uses it rather
than the raw column. Takes `FlagSpec` rather than a bare `hasValue: boolean` deliberately: both call
sites already hold the spec, and a same-named boolean on a different object (`FlagRow.hasValue` sits
next to `.enabled` and `.value`) could otherwise be passed into the wrong slot. Seven tests in
`src/lib/admin-flags.test.ts`; mutate it to `return row?.enabled ?? false` and three must fail.

- [x] **Step 2: Add the query**

Append to `src/server/modules/admin/queries.ts`, extending its `@/lib/admin-flags` import with
`flagEnabled` and its `@/lib/admin-users` import with `ROLE_OPTIONS`. Shape as the plan originally had
it, with two changes: the flag map is keyed `key → row` rather than `key → boolean` (the helper needs
`value`, not just the bit), and `unavailable` reads `spec.unavailable`:

```ts
export interface AdminHome {
  users: { total: number; disabled: number; byRole: Array<{ role: Role; count: number }> };
  flags: Array<{ key: string; label: string; enabled: boolean; unavailable: boolean }>;
  webhooks: { endpoints: number; inactive: number; dead: number; delivered: number };
}
```

`byRole` is driven by `ROLE_OPTIONS` so a role nobody holds shows as `0` rather than vanishing — "no
admins" is exactly what a zero row is for — and `flags` by `FLAG_SPECS`, so a hand-inserted row is not
reported as configuration. `ROLE_OPTIONS` covers every value of the Prisma `Role` enum, which is what
keeps the Accounts tile and the role list from disagreeing; **if a sixth role is ever added, check that
still holds** (rule 27's shape).

- [x] **Step 3: Write the component**

Create `src/components/home/admin-home.tsx`:

```tsx
import Link from "next/link";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { ROLE_LABELS } from "@/lib/admin-users";
import type { AdminHome as AdminHomeData } from "@/server/modules/admin/queries";

export function AdminHomeBody({ data }: { data: AdminHomeData }) {
  const { users, flags, webhooks } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Stat label="Accounts" value={users.total} />
        <Stat
          label="Disabled"
          value={users.disabled}
          hint={users.disabled === 0 ? "everyone can sign in" : "blocked from signing in"}
        />
        <Stat label="Endpoints" value={webhooks.endpoints} />
        <Stat
          label="Dead deliveries"
          value={webhooks.dead}
          hint={webhooks.dead === 0 ? "nothing to replay" : "waiting on a replay"}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          Who can get in
        </span>
        <ul className="flex flex-col">
          {users.byRole.map((r) => (
            <li
              key={r.role}
              className="flex items-center justify-between border-b border-border-faint py-1.5 last:border-b-0"
            >
              <span className="text-[12.5px] text-fg">{ROLE_LABELS[r.role]}</span>
              <span className="font-mono text-[11px] text-fg-muted">{r.count}</span>
            </li>
          ))}
        </ul>
        <Link href="/admin/users" className="text-[12px] font-medium text-accent hover:underline">
          Manage users &amp; roles →
        </Link>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          What is switched on
        </span>
        <ul className="flex flex-col">
          {flags.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between border-b border-border-faint py-1.5 last:border-b-0"
            >
              <span className="flex items-center gap-2">
                <StatusDot value={f.enabled ? "EXECUTED" : "SPARE"} />
                <span className="text-[12.5px] text-fg">{f.label}</span>
              </span>
              <span className="font-mono text-[10.5px] text-fg-muted">
                {f.unavailable ? "unavailable" : f.enabled ? "on" : "off"}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/admin/flags" className="text-[12px] font-medium text-accent hover:underline">
          Feature flags →
        </Link>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          Integrations
        </span>
        <p className="text-[12.5px] text-fg-secondary">
          {webhooks.endpoints === 0
            ? "No endpoints configured — nothing outside this system is being told when approvals execute."
            : `${webhooks.delivered} delivered, ${webhooks.dead} dead${
                webhooks.inactive > 0
                  ? `, ${webhooks.inactive} endpoint${webhooks.inactive === 1 ? "" : "s"} disabled`
                  : ""
              }.`}
        </p>
        <Link href="/admin/webhooks" className="text-[12px] font-medium text-accent hover:underline">
          Webhooks →
        </Link>
      </div>
    </div>
  );
}
```

- [x] **Step 4: Branch the Home route, and stop offering Focus where it does nothing**

In `src/app/(app)/page.tsx`, add the `admin` branch **above** `purchasing` and `finance`, wrapped in the
same `max-w-[900px]` container purchasing uses and with **no** `Jump to` card (see amendment 2). Add
`SHOWS_FOCUS_TOGGLE: Record<WorkspaceId, boolean>` at module level and make `header`'s `actions` honour
it. `PageHeader` already renders nothing for a falsy `actions`, so admin gets no empty wrapper.

- [x] **Step 5: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

**460 tests / 30 files** (up 7). The data assertions were checked by calling `adminHome()` directly
rather than through the browser: all five roles present with `sum(rows) === total`; `Microsoft 365
sign-in` reads `unavailable`, not `off`; and the rule-15 fix proven by forcing `allowed_domain` to
`(enabled: true, value: NULL)` → Home reads `off`, then restoring the domain → `on`. **Restore that
value afterwards** — every seeded account is `@thebackroomop.com` and signup refuses them otherwise.

Still outstanding, and it needs a signed-in browser: the purely visual pass (four tiles then three
lists, no fleet bar or age histogram, and the IT Home unchanged when you switch back).

- [x] **Step 6: Commit**

```bash
git add src/components/home/admin-home.tsx src/server/modules/admin/queries.ts \
  "src/app/(app)/page.tsx" src/lib/admin-flags.ts src/lib/admin-flags.test.ts
git commit -m "feat(admin): a Home whose body matches its own sidebar"
```

---

### Task 12: The fixtures the deliveries page needs

> ### REQUIRED AMENDMENT — three checks from Task 7's review.
>
> **1. Keep `encryptSecret(HOOK_SECRET, secretAad(id))`.** As drafted this is correct — a seed that stored
> the secret as plaintext would silently defeat scope decision #4, and nothing would fail.
>
> **2. Confirm `SECRET_ENCRYPTION_KEY` is actually visible in the seed process.** Today it arrives only as
> an implicit side effect of Prisma Client's `.env` loading. If it is absent, `encryptSecret` throws and
> the seed fails loudly — which is the good outcome, but verify it rather than discovering it.
>
> **3. The insert-then-update pair is `Promise.all`'d, not transactional.** Harmless immediately after
> `TRUNCATE`, but the "no reader ever sees the empty placeholder" argument that justifies the same pattern
> in `createEndpoint` does **not** apply here. Either wrap it or state why it doesn't need wrapping.

`prisma/seed.ts` has never created a `WebhookEndpoint`, so every state the deliveries page is designed
around — `DELIVERED`, `RETRYING`, and the `DEAD · 5/5` row with its "Replay" control — is unreachable
against a fresh database. This is the Phase 6 lesson: *a seeded fixture that doesn't exercise its own
design is a silent gap.*

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Seed two endpoints and a spread of deliveries**

`TRUNCATE` in `prisma/seed.ts` already covers `WebhookEndpoint`, `WebhookDelivery` and `Job`, so this
is purely additive. Add near the end of the seed, after the approvals block:

```ts
  // Webhooks. Two endpoints so "disabled" is a real state on the list, and a
  // spread of deliveries so every chip deliveryStage() can produce is reachable
  // against a fresh database — including the DEAD · 5/5 row the design's
  // "Replay 4 dead-lettered" control exists for.
  // A fixture value, not a real secret — it signs nothing that leaves this machine.
  const HOOK_SECRET = "seed-signing-secret-not-a-real-one";
  const [liveHook, offHook] = await Promise.all([
    prisma.webhookEndpoint.create({
      data: {
        url: "https://hooks.thebackroomop.com/inventory",
        events: ["approval.executed", "offboarding.completed"],
        active: true,
        secret: "",
      },
    }),
    prisma.webhookEndpoint.create({
      data: {
        url: "https://legacy.thebackroomop.com/erp-bridge",
        events: ["purchase_request.completed"],
        active: false,
        secret: "",
      },
    }),
  ]);
  // The AAD binds ciphertext to the row id, which only exists after the insert.
  await Promise.all([
    prisma.webhookEndpoint.update({
      where: { id: liveHook.id },
      data: { secret: encryptSecret(HOOK_SECRET, secretAad(liveHook.id)) },
    }),
    prisma.webhookEndpoint.update({
      where: { id: offHook.id },
      data: { secret: encryptSecret(HOOK_SECRET, secretAad(offHook.id)) },
    }),
  ]);

  await prisma.webhookDelivery.createMany({
    data: [
      {
        endpointId: liveHook.id,
        event: "approval.executed",
        payload: { approvalId: "seed", refNo: "APR-2031", type: "lifecycle.assign" },
        status: "DELIVERED",
        attempts: 1,
        deliveredAt: day(-2),
      },
      {
        endpointId: liveHook.id,
        event: "offboarding.completed",
        payload: { employeeId: "seed", employeeNo: "EMP-0093", decisions: 2 },
        status: "DELIVERED",
        attempts: 2,
        lastError: null,
        deliveredAt: day(-1),
      },
      {
        endpointId: liveHook.id,
        event: "approval.executed",
        payload: { approvalId: "seed", refNo: "APR-2035", type: "lifecycle.change-status" },
        status: "RETRYING",
        attempts: 2,
        lastError: "connect ETIMEDOUT 10.0.0.9:443",
      },
      // The row the design is about: five attempts spent, dead-lettered, replayable.
      {
        endpointId: liveHook.id,
        event: "approval.executed",
        payload: { approvalId: "seed", refNo: "APR-2040", type: "lifecycle.return" },
        status: "DEAD",
        attempts: 5,
        lastError: "500 Internal Server Error",
      },
      {
        endpointId: offHook.id,
        event: "purchase_request.completed",
        payload: { purchaseRequestId: "seed", refNo: "PR-0198" },
        status: "DEAD",
        attempts: 5,
        lastError: "404 Not Found",
      },
    ],
  });
```

Import `encryptSecret` from `../src/server/crypto` and `secretAad` from `../src/server/webhooks/sign`
at the top of the seed. `day(offset)` is the seed's existing date helper (`prisma/seed.ts:6`), so the
dates above need no new code.

Note the two-step insert-then-update, for the same reason `createEndpoint` does it: the AAD binds the
ciphertext to the row id, and the id only exists after the insert.

**No `Job` rows are seeded for these.** A `PENDING` job would make `npm run worker:once` immediately
try to POST to a hostname that doesn't resolve, turning every seeded run into a slow, noisy failure.
The deliveries are history; the queue is empty.

- [ ] **Step 2: Reseed and check every chip is reachable**

```bash
npm run db:seed
docker exec inventory-db-1 psql -U inventory -d inventory -c "SELECT status, attempts, count(*) FROM \"WebhookDelivery\" GROUP BY 1,2 ORDER BY 1;"
```

Expected: `DEAD | 5 | 2`, `DELIVERED | 1 | 1`, `DELIVERED | 2 | 1`, `RETRYING | 2 | 1`.

Then confirm the worker is still quiet — the seeded deliveries must not have created work:

```bash
npm run worker:once
```

Expected: the usual `APR-2035` demo failure and nothing webhook-shaped.

- [ ] **Step 3: Confirm the numbers the earlier tasks assert**

Two Phase 8 screens now read these fixtures. Check them before the e2e spec depends on them:

- `/admin/webhooks` — two cards, the second carrying a `DISABLED` pill; the first shows `4 attempts`
  and a `1 dead` link, the second `1 attempt` and `1 dead`.
- Admin Home — `Endpoints 2`, `Dead deliveries 2`, and the integrations line reading
  `2 delivered, 2 dead, 1 endpoint disabled.`

If a number disagrees, fix the fixture rather than the assertion — these are the values Task 14's spec
will pin.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): endpoints and deliveries, so every delivery chip is reachable"
```

---

### Task 13: `/admin/webhooks/deliveries` + replay

> ### REQUIRED AMENDMENT — four things, three of them in the code blocks below.
>
> **1. Delete `export const MAX_DELIVERY_ATTEMPTS = 5;`** from `queries.ts`. Task 6's review established
> that the chip's denominator has exactly one owner — `MAX_JOB_ATTEMPTS` in `src/lib/jobs.ts`, which the
> worker imports and `deliveryStage` defaults to. A second literal here is what makes `DEAD · 3/5`
> possible after someone tunes the worker. Call `deliveryStage(r.status, r.attempts)` and let the default
> supply it.
>
> **2. Move `DELIVERY_TABS` / `parseDeliveryTab` into `src/lib/webhooks.ts` with unit tests.** As written
> they sit in `queries.ts` beside the Prisma call — which HANDOVER §8 records as the exact reason Phase
> 7's `RESERVATION_TABS` is *"the one list parser with no test"*: bundled with the query it cannot be
> unit-tested without pulling in the DB client. Every sibling (`approvals-list.ts`, `purchases-list.ts`,
> `audit-list.ts`) puts its pure tab/parse logic in `src/lib/`. Don't create the second recorded
> exception.
>
> **3. Pass `ns="delivery"` when rendering a delivery status.** Task 6's review added a `"delivery"`
> namespace to `src/lib/status.ts` because `PENDING` unnamespaced resolves to the **approval** family
> (`attention`), which made a healthy queued delivery amber and indistinguishable from `RETRYING`. Also:
> `deliveryStage` returns the chip's **label** and `statusFamily` needs the **status** — passing
> `stageLabel` where `status` belongs greys every chip in the table with no error anywhere.
>
> **4. `replayDelivery`'s audit diff must not be from-equals-to** (§6a rules 8 and 19) — `event:
> {from,to}` with equal sides would log `Fields: event` for a replay that changed no event. Record what
> actually changed (`status`, `attempts`), and put the endpoint or event in the entity label.
>
> Two §6a rule 10 checks for this page: `replayDelivery` refuses a `DELIVERED` row **and** an inactive
> endpoint — confirm neither can render a live Replay button, and that `replayAllDead`'s per-row rate
> limit cannot silently under-queue without telling the operator how many actually went. And if this page
> surfaces `Job` state (Task 10 notes "next attempt"), `JobStatus`'s families are now in the flat map —
> use them rather than adding new ones.

Card `3h`: delivery attempts with `DEAD · 5/5` rows and a **"Replay 4 dead-lettered"** control. Scope
decision #11 settles what replay means — a decision to try again, not to resume — and scope decision
#12 settles that this list has no pagination, matching `/approvals`.

**Files:**
- Create: `src/components/admin/delivery-table.tsx`,
  `src/app/(app)/admin/webhooks/deliveries/page.tsx`
- Modify: `src/server/modules/admin/webhook-actions.ts`, `src/server/modules/admin/queries.ts`

- [ ] **Step 1: Add the replay actions**

Append to `src/server/modules/admin/webhook-actions.ts`. Note the P2002 handling: the partial unique
index from Task 9 is what makes a double-click safe, and its refusal is a *designed* answer, not a bug.

```ts
/**
 * Scope decision #11: replay is a decision to try again, so the attempt cycle
 * RESETS rather than resuming. `lastError` is deliberately kept until the next
 * attempt overwrites it — while the row sits queued, why it died last time is
 * still the most useful thing on the screen.
 *
 * Job_one_live_deliver_per_delivery (Task 9) is what stops a double-click
 * producing two live jobs for one delivery; P2002 here means "already queued",
 * which is a conflict the operator can act on rather than an error.
 */
export async function replayDelivery(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  try {
    const failure = await asActionResult(
      async () =>
        prisma.$transaction(async (tx) => {
          const delivery = await tx.webhookDelivery.findUnique({
            where: { id: parsed.data.id },
            include: { endpoint: true },
          });
          if (!delivery) return conflict("That delivery no longer exists.");
          if (delivery.status === "DELIVERED") {
            return conflict("That one already landed — there's nothing to replay.");
          }
          if (!delivery.endpoint.active) {
            return conflict(
              `${delivery.endpoint.url} is disabled — enable the endpoint first, or the replay will just die again.`,
            );
          }
          await tx.webhookDelivery.updateMany({
            where: { id: delivery.id, status: delivery.status },
            data: { status: "PENDING", attempts: 0, deliveredAt: null },
          });
          await tx.job.create({
            data: { type: "DELIVER_WEBHOOK", payload: { deliveryId: delivery.id } },
          });
          await writeAudit(tx, {
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "webhook-endpoint",
            entityId: delivery.endpointId,
            action: "replay",
            diff: {
              delivery: { from: delivery.status, to: "PENDING" },
              event: { from: delivery.event, to: delivery.event },
            },
          });
          return null;
        }),
      { goneMessage: "That delivery no longer exists." },
    );
    if (failure) return failure;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("That delivery is already queued for another attempt.");
    }
    throw err;
  }
  revalidateAll();
  return ok(null);
}

/** The design's "Replay 4 dead-lettered" — one decision, not four clicks. */
export async function replayAllDead(): Promise<ActionResult<{ queued: number }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  // Only endpoints that are actually live: replaying into a disabled endpoint
  // spends five attempts to reach the answer the operator already has.
  const dead = await prisma.webhookDelivery.findMany({
    where: { status: "DEAD", endpoint: { active: true } },
    select: { id: true },
  });

  let queued = 0;
  for (const row of dead) {
    // One transaction per row, and a P2002 skips rather than aborting the batch:
    // one already-queued delivery must not stop the other three.
    try {
      const res = await replayDelivery({ id: row.id });
      if (res.ok) queued += 1;
    } catch {
      // replayDelivery already maps the errors it expects; anything escaping
      // here is one row's problem, not the batch's.
    }
  }
  revalidateAll();
  return ok({ queued });
}
```

`replayAllDead` calls `replayDelivery`, which re-checks the guard and re-audits per row — deliberately,
so a batch replay leaves exactly the same trail as four individual ones. It also means the batch is
rate-limited per row, which at seed scale is invisible and at real scale is the correct behaviour.

- [ ] **Step 2: Add the query**

Append to `src/server/modules/admin/queries.ts`:

```ts
import { deliveryStage } from "@/lib/webhooks";

/** The worker's MAX_ATTEMPTS. Named here so the chip's denominator has one source. */
export const MAX_DELIVERY_ATTEMPTS = 5;

export const DELIVERY_TABS = ["ALL", "DEAD", "PENDING", "DELIVERED"] as const;
export type DeliveryTab = (typeof DELIVERY_TABS)[number];

export function parseDeliveryTab(raw: string | undefined): DeliveryTab {
  return (DELIVERY_TABS as readonly string[]).includes(raw ?? "") ? (raw as DeliveryTab) : "ALL";
}

export interface DeliveryRow {
  id: string;
  endpointUrl: string;
  event: string;
  when: string;
  attempts: number;
  lastError: string | null;
  /** raw DeliveryStatus — StatusPill derives the colour from it (Task 6, Step 3b) */
  status: string;
  /** the label only: "DEAD · 5/5" */
  stageLabel: string;
  replayable: boolean;
}

const PAGE = 50;

export async function listDeliveries(
  tab: DeliveryTab,
): Promise<{ rows: DeliveryRow[]; total: number; deadReplayable: number }> {
  const where =
    tab === "ALL"
      ? {}
      : tab === "PENDING"
        ? { status: { in: ["PENDING", "RETRYING"] as const } }
        : { status: tab };

  const [rows, total, deadReplayable] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      include: { endpoint: true },
      // createdAt alone is not a stable order — rows written in one transaction
      // share a millisecond (HANDOVER §7). The id tiebreaker is mandatory.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE,
    }),
    prisma.webhookDelivery.count({ where }),
    prisma.webhookDelivery.count({ where: { status: "DEAD", endpoint: { active: true } } }),
  ]);

  return {
    total,
    deadReplayable,
    rows: rows.map((r) => ({
      id: r.id,
      endpointUrl: r.endpoint.url,
      event: r.event,
      when: fmtDateTime(r.createdAt),
      attempts: r.attempts,
      lastError: r.lastError,
      status: r.status,
      stageLabel: deliveryStage(r.status, r.attempts, MAX_DELIVERY_ATTEMPTS),
      replayable: r.status !== "DELIVERED" && r.endpoint.active,
    })),
  };
}
```

Import `fmtDateTime` from wherever `src/server/modules/audit/queries.ts` imports it — reuse that helper
rather than formatting dates a second way.

- [ ] **Step 3: Write the table**

Create `src/components/admin/delivery-table.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { replayAllDead, replayDelivery } from "@/server/modules/admin/webhook-actions";
import type { DeliveryRow } from "@/server/modules/admin/queries";

export function DeliveryTable({
  rows,
  total,
  deadReplayable,
}: {
  rows: DeliveryRow[];
  total: number;
  deadReplayable: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: string) {
    setError(null);
    startTransition(async () => {
      const res = (await fn()) as Awaited<ReturnType<typeof replayDelivery>>;
      if (res.ok) {
        toast(okMsg, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      {deadReplayable > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-border bg-surface-subtle px-3 py-2">
          <span className="text-[12px] text-fg-secondary">
            {deadReplayable} dead-lettered{" "}
            {deadReplayable === 1 ? "delivery is" : "deliveries are"} waiting on a live endpoint.
          </span>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() =>
              run(() => replayAllDead(), `Replaying ${deadReplayable} dead-lettered`)
            }
          >
            Replay {deadReplayable} dead-lettered
          </Button>
        </div>
      )}

      <Table>
        <THead>
          <Tr>
            <Th width={150}>When</Th>
            <Th>Endpoint</Th>
            <Th width={210}>Event</Th>
            <Th width={140}>Status</Th>
            <Th width={90} aria-label="Row actions" />
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.id}>
              <Td mono>{row.when}</Td>
              <Td>
                <span className="block truncate font-mono text-[11px] text-fg">{row.endpointUrl}</span>
                {row.lastError && (
                  // The reason it died is the most useful thing on the row while
                  // it waits — keep it visible rather than behind a disclosure.
                  <span className="block truncate text-[10.5px] text-fg-muted" title={row.lastError}>
                    {row.lastError}
                  </span>
                )}
              </Td>
              <Td mono>{row.event}</Td>
              <Td>
                {/* StatusPill derives the family from the raw status, which is
                    why Task 6 taught src/lib/status.ts about DeliveryStatus:
                    colour is the design system's job, not deliveryStage's. */}
                <StatusPill value={row.status} label={row.stageLabel} />
              </Td>
              <Td>
                {row.replayable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={pending}
                    onClick={() => run(() => replayDelivery({ id: row.id }), "Queued for another attempt")}
                  >
                    Replay
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {total > rows.length && (
        <p className="text-[11px] text-fg-muted">
          Showing {rows.length} of {total}. Older attempts aren&apos;t paged through yet.
        </p>
      )}
      {total === 0 && <p className="text-xs text-fg-muted">No delivery attempts in this view.</p>}
    </div>
  );
}
```

`StatusPill({ value, label })` is the right component here, not `Pill` — `Pill` only knows
`neutral | accent`, whereas `StatusPill` looks the value up in the six-family map and paints the
`DEAD` row as a fault. That is why Task 6 Step 3b had to teach the map about `DeliveryStatus` first.

- [ ] **Step 4: Write the page**

Create `src/app/(app)/admin/webhooks/deliveries/page.tsx`:

```tsx
import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/page-header";
import { DeliveryTable } from "@/components/admin/delivery-table";
import { DELIVERY_TABS, listDeliveries, parseDeliveryTab } from "@/server/modules/admin/queries";

const TAB_LABELS: Record<string, string> = {
  ALL: "All",
  DEAD: "Dead-lettered",
  PENDING: "In flight",
  DELIVERED: "Delivered",
};

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  await requireRole("admin");
  const { state } = await searchParams;
  const tab = parseDeliveryTab(state);
  const { rows, total, deadReplayable } = await listDeliveries(tab);

  return (
    <>
      <PageHeader
        title="Delivery attempts"
        breadcrumb={[{ label: "Webhooks", href: "/admin/webhooks" }, { label: "Delivery attempts" }]}
      />
      <div className="flex flex-col gap-3">
        {/* Tabs write ?state=, the same contract /purchases and /reservations use. */}
        <nav className="flex gap-1" aria-label="Delivery status">
          {DELIVERY_TABS.map((value) => (
            <Link
              key={value}
              href={value === "ALL" ? "/admin/webhooks/deliveries" : `/admin/webhooks/deliveries?state=${value}`}
              aria-current={tab === value ? "page" : undefined}
              className={cn(
                "rounded-(--radius-ctl) px-2.5 py-1 text-[12px] font-medium",
                tab === value ? "bg-surface-subtle text-fg" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {TAB_LABELS[value]}
            </Link>
          ))}
        </nav>
        <DeliveryTable rows={rows} total={total} deadReplayable={deadReplayable} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

In the preview as `admin@thebackroomop.com`, `/admin/webhooks/deliveries` (after Task 12's seed):

1. Five rows. One reads `DEAD · 5/5` against `hooks.thebackroomop.com/inventory` with
   `500 Internal Server Error` under the URL; one reads `RETRYING · 2/5`; two read `DELIVERED`.
2. The banner offers **Replay 1 dead-lettered** — one, not two: the second dead row belongs to the
   *disabled* `erp-bridge` endpoint, and replaying into it would just die again.
3. The `Dead-lettered` tab writes `?state=DEAD` and shows both dead rows; the one on the disabled
   endpoint has no Replay button.
4. Click Replay on the live one → it becomes `QUEUED`, and clicking again is refused with "already
   queued for another attempt" rather than creating a second job.
5. `npm run worker:once` → it attempts delivery to a hostname that doesn't resolve and comes back
   `RETRYING · 1/5`. That is the correct outcome, and it proves the ledger mirrors the job.
6. Reseed afterwards so the fixture is unchanged for the e2e run.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/delivery-table.tsx "src/app/(app)/admin/webhooks/deliveries/page.tsx" src/server/modules/admin/webhook-actions.ts src/server/modules/admin/queries.ts
git commit -m "feat(webhooks): delivery attempts, and a replay that means try again"
```

---

### Task 14: E2E, full battery, close-out

**Added by Task 2's review — two behaviors only e2e can protect.** Neither has a unit test, by design
(the pure rules are covered in `src/lib/admin-users.test.ts`; the actions are thin wiring over them), so
if this spec doesn't assert them, nothing does:

- **The no-op save writes no audit entry.** Re-select a user's existing role and assert the
  `AuditEntry` count for that user is unchanged. `changed: false` is a claim about the action, and a
  regression here reappears as a UI that reports an immutable audit entry which does not exist.
- **A self role change is warned about before it happens, and signs the actor out.** Sign in as an
  ordinary (non-permanent) admin, change your own role, assert the confirm dialog names the incoming
  role, then assert you land signed-out and can sign back in with the new role. This is the one path in
  the phase where a mutation ends the actor's own session; it cannot be exercised by the seeded
  `admin@` account, which is the permanent admin and locked. **Create the second admin in the spec** —
  or promote `it@` first, which is itself a `setUserRole` call worth asserting.

**Files:**
- Create: `e2e/admin.spec.ts`
- Modify: `docs/HANDOVER.md`

- [ ] **Step 1: Write the e2e spec**

Create `e2e/admin.spec.ts`. It sorts first alphabetically, so it runs before every other spec file —
which is exactly why it reseeds in `beforeAll` like all the others.

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

// Spec files share one database and run alphabetically — each reseeds so no file
// inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("users & roles", () => {
  test("the permanent admin is locked before the click, not on save", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    // First hit of this route in the suite — give the cold JIT compile headroom.
    await expect(page.getByRole("heading", { name: "Users & roles" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    const permanent = page.getByRole("row", { name: /System Admin/ });
    await expect(permanent).toContainText("LOCKED");
    await expect(permanent).toContainText("permanent admin");
    // The affordance is ABSENT, which is the whole point of the card.
    await expect(permanent.getByRole("combobox")).toHaveCount(0);
    await expect(permanent.getByRole("button", { name: /Disable/ })).toHaveCount(0);
  });

  test("an ordinary role change is audited by name", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    await page.getByRole("combobox", { name: "Role for V. Cruz" }).selectOption("it_staff");
    await expect(page.getByText(/V. Cruz is now IT staff/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/audit");
    const row = page.getByRole("row", { name: /role-change/ }).first();
    // entityLabels must resolve a user id to a NAME, not a truncated cuid.
    await expect(row).toContainText("V. Cruz");
  });

  test("disabling a user blocks sign-in", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    await page.getByRole("row", { name: /V. Cruz/ }).getByRole("button", { name: "Disable" }).click();
    await expect(page.getByText(/V. Cruz is disabled/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/logout");
    await page.getByLabel(/Email/).fill("viewer@thebackroomop.com");
    await page.getByLabel(/Password/).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Still on /login: authorize() refuses a disabled user.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("feature flags", () => {
  test("the SSO flag cannot be switched on, and says why", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/flags");
    await expect(page.getByRole("heading", { name: "Feature flags" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    await expect(page.getByText("UNAVAILABLE")).toBeVisible();
    await expect(page.getByText(/no role attached/)).toBeVisible();
    await expect(page.getByRole("switch", { name: /Microsoft 365 sign-in/ })).toBeDisabled();
  });

  test("the domain value is normalised and refuses an address", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/flags");
    const field = page.getByRole("textbox", { name: /Value for Signup domain restriction/ });

    await field.fill("someone@thebackroomop.com");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Just the domain, not a full address/)).toBeVisible({ timeout: 20_000 });

    await field.fill("TheBackroomOp.COM");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Signup domain restriction updated/)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(field).toHaveValue("thebackroomop.com");
  });
});

test.describe("webhooks", () => {
  test("a new endpoint shows its secret exactly once", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks");
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    await page.getByRole("textbox", { name: "New endpoint URL" }).fill("https://example.test/hook");
    await page.getByRole("checkbox", { name: /New endpoint: An approval finished executing/ }).check();
    await page.getByRole("button", { name: "Create endpoint" }).click();

    await expect(page.getByText(/Copy this signing secret now/)).toBeVisible({ timeout: 20_000 });
    // Reload: the secret is gone for good, which is the design.
    await page.reload();
    await expect(page.getByText(/Copy this signing secret now/)).toHaveCount(0);
  });

  test("an endpoint with no events is refused where the operator is looking", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks");
    await page.getByRole("textbox", { name: "New endpoint URL" }).fill("https://example.test/none");
    await page.getByRole("button", { name: "Create endpoint" }).click();
    await expect(page.getByText(/Pick at least one event/)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("delivery attempts", () => {
  test("every chip the seed can produce renders, and replay only offers live endpoints", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks/deliveries");
    await expect(page.getByRole("heading", { name: "Delivery attempts" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    await expect(page.getByText("DEAD · 5/5").first()).toBeVisible();
    await expect(page.getByText("RETRYING · 2/5")).toBeVisible();
    await expect(page.getByText("DELIVERED").first()).toBeVisible();
    await expect(page.getByText("500 Internal Server Error")).toBeVisible();

    // One, not two: the other dead row belongs to the DISABLED endpoint.
    await expect(page.getByRole("button", { name: /Replay 1 dead-lettered/ })).toBeVisible();

    await page.getByRole("link", { name: "Dead-lettered" }).click();
    await expect(page).toHaveURL(/state=DEAD/);
    await expect(page.getByRole("row", { name: /erp-bridge/ }).getByRole("button", { name: "Replay" }))
      .toHaveCount(0);
  });

  test("replaying twice is refused rather than queued twice", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks/deliveries?state=DEAD");
    const live = page.getByRole("row", { name: /hooks\.thebackroomop\.com/ }).first();
    await live.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByText(/Queued for another attempt/)).toBeVisible({ timeout: 20_000 });

    // The partial unique index is what makes the second click safe.
    await page.goto("/admin/webhooks/deliveries?state=PENDING");
    const queued = page.getByRole("row", { name: /hooks\.thebackroomop\.com/ }).first();
    await queued.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByText(/already queued/)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("admin home", () => {
  test("the body matches its own sidebar", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    // The admin role holds four workspaces; br.dept selects which one Home renders.
    await page.context().addCookies([
      { name: "br.dept", value: "admin", url: "http://localhost:3000" },
    ]);
    await page.goto("/");
    await expect(page.getByText("Who can get in")).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    await expect(page.getByText("What is switched on")).toBeVisible();
    await expect(page.getByText("unavailable")).toBeVisible();
    // The IT Home's sections must NOT be here — that was the bug.
    await expect(page.getByText("Your shift")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fleet", level: 3 })).toHaveCount(0);
  });
});
```

If a locator disagrees with what shipped, **check the page before changing the assertion** — several of
these encode a rule rather than a label.

- [ ] **Step 2: Get the spec green**

```bash
npm run db:seed && npx playwright test e2e/admin.spec.ts --workers=1
```

Run it in the **foreground** with a long timeout. Never background a Playwright run: an unreaped run's
own `beforeAll` reseed races the next one and produces a cascade of unrelated failures.

- [ ] **Step 3: Run the whole battery**

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
npm run db:seed && npx playwright test --workers=1
```

**Restart the preview first** — a long-lived dev server degrades the suite into phantom failures
(HANDOVER §7). Expect the e2e count to rise from 89 by however many tests Step 1 added.

- [ ] **Step 4: Update the handover for Phase 9**

Rewrite `docs/HANDOVER.md` so a fresh session can start Phase 9 cold. Keep the structure; §§1, 2, 3
and 7 stay largely as they are.

1. **Header** — Phases 1–8 merged, the real battery numbers from Step 3, and whether it has been
   pushed (the user decides that separately; write what is actually true).
2. **§0** — point at Phase 9's plan-writing: import (3-step dry-run → commit, blocked rows grouped by
   cause), the Excel export upgrade + split-by-year chips + the brief's `farewell-report` route, the
   printable label sheet, USB-scanner polish (a scan ticks the matching wizard row), the deployment
   README, and the full axe pass. Re-read README cards `5a, 1m, 7g`.
3. **§4** — add a Phase 8 paragraph: the admin surfaces, the permanent-admin lock covering `disabled`
   as well as `role`, the flag allowlist, and the webhook pipeline (emitter → job → ledger).
4. **§4 conventions table** — add: *a retry engine and its ledger are written in the same handler*
   (scope decision #6), and *a `"use server"` module is not importable by the worker* (which is why
   `secretAad` lives in `sign.ts`).
5. **§5** — Phase 8 out, Phase 9 only.
6. **§6** — replace Phase 8's entry criteria with **Phase 9's**, including: export already refuses at
   10,000 rows with a 413 and must keep doing so; `?ids=` silently slices to 500 and should be fixed
   in the same pass; import is new from zero and partial import is the default; a scan must tick the
   matching offboarding wizard row.
7. **§8** — add Phase 8's leftovers: `/admin/webhooks/deliveries` has no pagination (scope decision
   #12); `replayAllDead` is rate-limited per row because it calls `replayDelivery`; nothing prunes
   `WebhookDelivery`, so the table grows without bound; the delivery `nextAttemptAt` column is never
   written (the job's `runAt` is the real schedule — scope decision #6); and `Job_one_live_deliver_per_delivery`
   exists only in raw migration SQL, not in `schema.prisma`, alongside the three constraints already
   tracked there.
8. **§7** — add: *a `"use server"` module makes every export a server action, so the worker cannot
   import one*; and *a `src/lib/` module imported by a client component must not reach `node:`* —
   which is why the webhook signature lives in `src/server/webhooks/sign.ts`.

```bash
git add docs/HANDOVER.md
git commit -m "docs: handover advanced — phase 8 done, phase 9 entry criteria"
```

- [ ] **Step 5: Finish the branch**

Use `superpowers:finishing-a-development-branch`. **Merging and pushing are the user's decisions** —
present the options and wait rather than doing either unprompted. This repo is public.

---
