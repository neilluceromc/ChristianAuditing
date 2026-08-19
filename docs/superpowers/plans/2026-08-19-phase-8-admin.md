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
  out. The permanent-admin and self-disable rules live here so the page and the action cannot disagree.
- `admin-flags.ts` + `admin-flags.test.ts` — `FLAG_SPECS` (key → label, description, `hasValue`,
  and an `unavailable` reason), plus `specFor()`, `flagChange()` and `domainValue()`. It is an
  **allowlist**: `FeatureFlag` is key-value, so without it the flags page writes arbitrary config.
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
- `webhooks/sign.ts` — `signPayload()`, `SIGNATURE_HEADER` and `secretAad()`. A plain module on
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

> ### ⚠ REQUIRED AMENDMENT — read before implementing. The code blocks in this task predate `4b112cd`.
>
> Task 2's review changed the contract this page consumes, in two ways the blocks below do **not** yet
> reflect. Both are the *stated, never discovered* principle this task's own first paragraph invokes, so
> neither is optional.
>
> **1. The action results are no longer `ActionResult<null>`.** `setUserRole` now returns
> `ActionResult<{ changed: boolean; signsOutActor: boolean }>` and `setUserDisabled` returns
> `ActionResult<{ changed: boolean }>`. Step 2's `run()` helper must stop announcing success
> unconditionally: **when `res.data.changed === false` nothing was written**, so the toast must not claim
> a change and `router.refresh()` is a pointless round trip. Say something honest instead (the role was
> already that) or stay silent. The existing
> `const res = (await fn()) as Awaited<ReturnType<typeof setUserRole>>` cast is also now actively unsafe
> — the two actions no longer share a data shape, so that cast lets `setUserDisabled`'s result be read as
> if it carried `signsOutActor`. Give `run()` a real generic, or split it into two callers.
>
> **2. A self role change signs the actor out, and this page is the surface that has to say so.** Per the
> amended scope decision #3, `requireUser` bounces a JWT/DB role mismatch to `/logout`, so an admin
> changing their **own** role — to any different role, not only a demotion — is signed out on their very
> next request, and `revalidatePath` triggers it inside the action's own response. Without this, the admin
> gets no warning before the click and no explanation after: exactly the failure `lockReason` exists to
> prevent, in the one control on this screen that can cause it.
>
> Use `selfRoleChangeWarning` from `@/lib/admin-users` (a pure module with no `node:` imports, so a
> `"use client"` table may import it, exactly as it already imports `ROLE_LABELS`). It needs the **actor's
> id**, which `listUsers` does not have — the page does, from `requireRole("admin")`. Thread it through as
> a prop rather than widening `UserRow`, since it is a property of *who is looking*, not of the row.
>
> Gate the change behind a confirm rather than a static hint: the warning names the role you are about to
> land as, so it can only be written once a role has been picked, and it is still stated before anything
> is written. `src/components/offboarding/complete-button.tsx` is the precedent to follow — `Dialog` plus
> a comment noting the README reserves dialogs for decisions of exactly this weight. Call
> `selfRoleChangeWarning(target, picked, actorId)` in the select's `onChange`; if it returns a string,
> open the dialog with that string as the body and run the mutation only on confirm; if it returns
> `null`, run it directly as the block below already does. Reset the select on cancel so the UI doesn't
> keep showing a role that was never saved. `signsOutActor` on the result is the belt-and-braces half —
> use it to tell the actor what just happened before the redirect takes them, not as the primary warning.
>
> Don't restate the rule inline (`row.id === actorId`) anywhere. Both surfaces call the one function, so
> they cannot disagree about when it applies — the same discipline `lockReason` already follows.

**Files:**
- Create: `src/server/modules/admin/queries.ts`, `src/components/admin/user-table.tsx`,
  `src/app/(app)/admin/users/page.tsx`

- [ ] **Step 1: Write the query module**

Create `src/server/modules/admin/queries.ts`. Tasks 5, 8, 11 and 13 all add functions to this file —
this is its first one.

```ts
import { prisma } from "@/server/db/client";
import { lockReason, type TargetUser } from "@/lib/admin-users";
import type { Role } from "@prisma/client";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  /** non-null → the row is locked, and this is the sentence explaining why */
  locked: string | null;
  /** "credentials" | "SSO only" — a passwordHash-less row can only arrive via Entra */
  signIn: string;
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
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ROLE_LABELS, ROLE_OPTIONS } from "@/lib/admin-users";
import { setUserDisabled, setUserRole } from "@/server/modules/admin/user-actions";
import type { UserRow } from "@/server/modules/admin/queries";

export function UserTable({ rows }: { rows: UserRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: string) {
    setError(null);
    startTransition(async () => {
      const res = (await fn()) as Awaited<ReturnType<typeof setUserRole>>;
      if (res.ok) {
        toast(okMsg, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      // Every refusal on this screen is a conflict or a forbidden — there are no
      // field-level inputs to hang a validation error on, so all of them go to
      // the banner rather than dead-ending silently.
      else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Table>
        <THead>
          <Tr>
            <Th>User</Th>
            <Th width={170}>Role</Th>
            <Th width={110}>Sign-in</Th>
            <Th width={130}>Access</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.id} className={cn(row.locked && "bg-surface-subtle")}>
              <Td>
                <span className={cn("block text-[12.5px]", row.disabled ? "text-fg-muted" : "text-fg")}>
                  {row.name}
                </span>
                <span className="block font-mono text-[10.5px] text-fg-muted">{row.email}</span>
              </Td>

              <Td>
                {row.locked ? (
                  // Card 3h: the constraint is STATED. A LOCKED chip plus static
                  // text, tinted one step back — never a select that fails on save.
                  <span className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5">
                      <Pill>LOCKED</Pill>
                      <span className="text-[12px] text-fg-muted">{ROLE_LABELS[row.role]}</span>
                    </span>
                    <span className="text-[10.5px] leading-snug text-fg-faint">{row.locked}</span>
                  </span>
                ) : (
                  <Select
                    aria-label={`Role for ${row.name}`}
                    value={row.role}
                    disabled={pending}
                    className="w-[150px] py-1.5 text-xs"
                    onChange={(e) =>
                      run(
                        () => setUserRole({ userId: row.id, role: e.target.value }),
                        `${row.name} is now ${ROLE_LABELS[e.target.value as keyof typeof ROLE_LABELS]}`,
                      )
                    }
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </Select>
                )}
              </Td>

              <Td>
                <span className="font-mono text-[10.5px] text-fg-muted">{row.signIn}</span>
              </Td>

              <Td>
                {row.locked ? (
                  <span className="text-[12px] text-fg-muted">Always enabled</span>
                ) : (
                  <Button
                    size="sm"
                    variant={row.disabled ? "secondary" : "ghost"}
                    loading={pending}
                    onClick={() =>
                      run(
                        () => setUserDisabled({ userId: row.id, disabled: !row.disabled }),
                        row.disabled ? `${row.name} can sign in again` : `${row.name} is disabled`,
                      )
                    }
                  >
                    {row.disabled ? "Enable" : "Disable"}
                  </Button>
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

- [ ] **Step 3: Write the page**

Create `src/app/(app)/admin/users/page.tsx`:

```tsx
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { UserTable } from "@/components/admin/user-table";
import { listUsers } from "@/server/modules/admin/queries";

export default async function UsersPage() {
  await requireRole("admin");
  const rows = await listUsers();

  return (
    <>
      <PageHeader title="Users & roles" />
      <div className="flex max-w-[860px] flex-col gap-3">
        <Banner tone="neutral" title="Role decides which workspace someone lands in">
          Disabling an account keeps its history and blocks sign-in. The permanent admin cannot be
          demoted or disabled, so the system can never be locked out of itself.
        </Banner>
        <UserTable rows={rows} />
      </div>
    </>
  );
}
```

`requireRole("admin")` rather than `requireUser()`: unlike `/admin/equipment-policies`, this path is
already admin-workspace-only in `PATH_RULES`, and only the `admin` role holds that workspace — so there
is no viewer read-only variant to design here.

- [ ] **Step 4: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

In the preview as `admin@thebackroomop.com`, `/admin/users`:

1. Five rows, **System Admin first**, its Role cell showing a `LOCKED` chip, the static text `Admin`,
   and the sentence about not locking the system out of itself. Its Access cell reads `Always enabled`
   with no button.
2. Change `V. Cruz` from Viewer to IT staff → the toast says so and the select holds its new value
   after the refresh.
3. Disable `V. Cruz` → the button flips to `Enable` and the name goes muted.
4. `/audit` has two new `user` rows whose entity cell reads **`V. Cruz`**, not a truncated cuid, with
   actions `role-change` and `disable`.
5. Put `V. Cruz` back to Viewer and enabled, so the seeded fixture is unchanged for the e2e run.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/admin/queries.ts src/components/admin/user-table.tsx "src/app/(app)/admin/users/page.tsx"
git commit -m "feat(admin): users and roles, with the permanent admin locked before the click"
```

---

### Task 4: The flag rules (TDD)

`FeatureFlag` is a key-value table, which means `/admin/flags` is one careless action away from being
an arbitrary writer into application configuration. This module is the allowlist: a flag this build
does not know about is not editable, and a flag whose feature is not finished is not editable either.

Scope decision #7 is the reason the second half of that sentence exists. Read it before you start.

**Files:**
- Create: `src/lib/admin-flags.ts`, `src/lib/admin-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin-flags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FLAG_SPECS, domainValue, flagChange, specFor } from "./admin-flags";

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
  it("allows the domain restriction", () => {
    expect(flagChange("allowed_domain")).toEqual({ allowed: true });
  });

  // Scope decision #7: auth/index.ts still carries TODO(sso-phase) — there is no
  // signIn callback mapping an Entra profile to a User row, so enabling this on a
  // deployment that HAS the env vars surfaces a button that authenticates and
  // lands a user with no role.
  it("refuses m365_sso and explains that SSO isn't wired yet", () => {
    const res = flagChange("m365_sso");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/not wired|isn't wired|no role/i);
  });

  // The table is key-value: without this, /admin/flags writes arbitrary config.
  it("refuses a key with no spec", () => {
    const res = flagChange("arbitrary_key");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/doesn't recognise|not a flag/i);
  });
});

describe("domainValue", () => {
  it("accepts a plain domain and lowercases it", () => {
    expect(domainValue("  TheBackroomOp.com ")).toEqual({ ok: true, value: "thebackroomop.com" });
  });

  it("accepts a subdomain", () => {
    expect(domainValue("mail.thebackroomop.com")).toEqual({ ok: true, value: "mail.thebackroomop.com" });
  });

  it("rejects an address rather than silently keeping the local part", () => {
    expect(domainValue("someone@thebackroomop.com").ok).toBe(false);
  });

  it("rejects a bare word with no dot", () => {
    expect(domainValue("localhost").ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(domainValue("   ").ok).toBe(false);
  });

  it("rejects a scheme", () => {
    expect(domainValue("https://thebackroomop.com").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/lib/admin-flags.test.ts
```

Expected: FAIL — `Failed to resolve import "./admin-flags"`.

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
  /** non-null → the switch is not usable, and this is the reason to print */
  unavailable: string | null;
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
    description:
      "Offers Continue with Microsoft on the sign-in page, for accounts in the allowed domain.",
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
  },
  {
    key: "allowed_domain",
    label: "Signup domain restriction",
    description:
      "Limits who may create an account. Turn it off and any email address can sign up.",
    hasValue: true,
    unavailable: null,
  },
];

export function specFor(key: string): FlagSpec | null {
  return FLAG_SPECS.find((f) => f.key === key) ?? null;
}

/** One rule for both the page (which greys the row) and the action (which refuses). */
export function flagChange(key: string): RuleResult {
  const spec = specFor(key);
  if (!spec) {
    return {
      allowed: false,
      reason: `This build doesn't recognise the flag "${key}", so it can't be changed here.`,
    };
  }
  return spec.unavailable ? { allowed: false, reason: spec.unavailable } : { allowed: true };
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
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return { ok: false, reason: "That doesn't look like a domain — try thebackroomop.com" };
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run src/lib/admin-flags.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Mutation-test it**

1. Make `flagChange` return `{ allowed: true }` before the `spec.unavailable` check → the `m365_sso`
   test must fail.
2. Make `specFor` return `FLAG_SPECS[0]` instead of `null` for an unknown key → "refuses a key with no
   spec" must fail.
3. Drop the `@` check from `domainValue` → "rejects an address" must fail.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run src/lib/admin-flags.test.ts
git add src/lib/admin-flags.ts src/lib/admin-flags.test.ts
git commit -m "feat(admin): the flag allowlist, with SSO held shut until it works"
```

---

### Task 5: Flag actions + `/admin/flags`

Card `3h`: switch rows with a description line. Two of them, one of which also carries a value.

**Files:**
- Create: `src/server/modules/admin/flag-actions.ts`, `src/components/admin/flag-rows.tsx`,
  `src/app/(app)/admin/flags/page.tsx`
- Modify: `src/server/modules/admin/queries.ts`

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
import { domainValue, flagChange, specFor } from "@/lib/admin-flags";
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

export async function setFlag(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { key, enabled } = parsed.data;

  // The allowlist runs BEFORE the row is read: an unknown key must be refused
  // even if someone inserted a matching row by hand.
  const verdict = flagChange(key);
  if (!verdict.allowed) return conflict(verdict.reason);

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const flag = await tx.featureFlag.findUnique({ where: { key } });
        if (!flag) return conflict(`The flag "${key}" isn't in the database.`);
        if (flag.enabled === enabled) return null;

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
          action: "update",
          // The key is in the diff because the entity label resolves to it, and
          // a reader three months from now needs to know WHICH flag moved.
          diff: { key: { from: flag.key, to: flag.key }, enabled: { from: flag.enabled, to: enabled } },
        });
        return null;
      }),
    { goneMessage: "That flag no longer exists." },
  );
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}

const valueSchema = z.object({ key: z.string().min(1), value: z.string() });

export async function setFlagValue(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = valueSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { key } = parsed.data;

  const spec = specFor(key);
  if (!spec?.hasValue) return conflict(`The flag "${key}" doesn't carry a value.`);
  const verdict = flagChange(key);
  if (!verdict.allowed) return conflict(verdict.reason);

  // Today allowed_domain is the only value flag, and its value is a domain.
  // When a second one arrives, this is the line that has to learn to branch.
  const domain = domainValue(parsed.data.value);
  if (!domain.ok) return validationError({ value: domain.reason });

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const flag = await tx.featureFlag.findUnique({ where: { key } });
        if (!flag) return conflict(`The flag "${key}" isn't in the database.`);
        const before = typeof flag.value === "string" ? flag.value : null;
        if (before === domain.value) return null;

        await tx.featureFlag.update({ where: { key }, data: { value: domain.value } });
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "feature-flag",
          entityId: flag.id,
          action: "update",
          diff: { key: { from: flag.key, to: flag.key }, value: { from: before, to: domain.value } },
        });
        return null;
      }),
    { goneMessage: "That flag no longer exists." },
  );
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}
```

`setFlagValue` uses `update` rather than a guarded `updateMany` because `value` is `Json`: Prisma
cannot express "where value equals this JSON" portably, and the read-then-write window here is a
single admin editing a two-row table. Recorded so the difference from `setFlag` reads as a decision.

- [ ] **Step 2: Add the query**

Append to `src/server/modules/admin/queries.ts`:

```ts
import { FLAG_SPECS } from "@/lib/admin-flags";

export interface FlagRow {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  hasValue: boolean;
  value: string | null;
  /** non-null → the switch is not usable, and this is the reason to print */
  unavailable: string | null;
}

/**
 * Driven by FLAG_SPECS, not by the table: a flag this build doesn't know about
 * is not something the admin page should offer a switch for, and a spec with no
 * row yet still renders (disabled, value null) rather than vanishing.
 */
export async function listFlags(): Promise<FlagRow[]> {
  const rows = await prisma.featureFlag.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return FLAG_SPECS.map((spec) => {
    const row = byKey.get(spec.key);
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      enabled: row?.enabled ?? false,
      hasValue: spec.hasValue,
      value: typeof row?.value === "string" ? row.value : null,
      unavailable: spec.unavailable,
    };
  });
}
```

Only `FLAG_SPECS` is imported here. Task 11's `adminHome` is what needs `specFor`, and it adds that
import when it needs it — lint runs `--max-warnings 0`, so importing it early is a build failure, not
a tidy head start.

- [ ] **Step 3: Write the rows component**

Create `src/components/admin/flag-rows.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { setFlag, setFlagValue } from "@/server/modules/admin/flag-actions";
import type { FlagRow } from "@/server/modules/admin/queries";

export function FlagRows({ rows }: { rows: FlagRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])),
  );

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: string) {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const res = (await fn()) as Awaited<ReturnType<typeof setFlag>>;
      if (res.ok) {
        toast(okMsg, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      // The only field on this screen is the domain value, so a validation
      // refusal always belongs to it — but fall back to the banner rather than
      // dropping the message if that ever stops being true.
      else if (res.kind === "validation") {
        setFieldError(Object.values(res.fieldErrors ?? {})[0] ?? res.message);
      } else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      {rows.map((row) => (
        <Card key={row.key}>
          <CardBody className="flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{row.label}</span>
                  <span className="font-mono text-[10px] text-fg-faint">{row.key}</span>
                  {row.unavailable && <Pill>UNAVAILABLE</Pill>}
                </span>
                <span className="text-[11.5px] leading-snug text-fg-muted">{row.description}</span>
              </div>
              {/* Unlike a viewer's absent affordances, this switch is DISABLED
                  rather than hidden: the admin has permission, the feature is
                  what's missing. Hiding it would read as "this flag is gone". */}
              <Switch
                checked={row.enabled}
                disabled={pending || !!row.unavailable}
                aria-label={`${row.label}${row.unavailable ? " — unavailable" : ""}`}
                onCheckedChange={(next) =>
                  run(
                    () => setFlag({ key: row.key, enabled: next }),
                    `${row.label} is ${next ? "on" : "off"}`,
                  )
                }
              />
            </div>

            {row.unavailable && (
              <p className="border-l-2 border-border-strong pl-2.5 text-[11px] leading-snug text-fg-muted">
                {row.unavailable}
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
                  loading={pending}
                  onClick={() =>
                    run(
                      () => setFlagValue({ key: row.key, value: draft[row.key] ?? "" }),
                      `${row.label} updated`,
                    )
                  }
                >
                  Save
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write the page**

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
          UNAVAILABLE is one whose feature isn&apos;t finished — the switch stays off until it is.
        </Banner>
        <FlagRows rows={rows} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

In the preview as `admin@thebackroomop.com`, `/admin/flags`:

1. Two cards. **Microsoft 365 sign-in** carries an `UNAVAILABLE` pill, a switch that will not move, and
   the sentence about an Entra login arriving with no role. **Signup domain restriction** is on, with
   `thebackroomop.com` in its value field.
2. Change the domain to `TheBackroomOp.COM` and Save → it comes back lowercased, and `/audit` shows a
   `feature-flag` row with `key, value` in the changed-fields cell.
3. Try `someone@thebackroomop.com` → refused inline under the field, not in the banner.
4. Toggle the domain restriction off and on → two audit rows, and `/login` stops and starts showing
   its "Access is limited to @…" line.
5. Put the value back to `thebackroomop.com` and leave the flag enabled, so the seeded fixture is
   unchanged for the e2e run.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/admin/flag-actions.ts src/components/admin/flag-rows.tsx "src/app/(app)/admin/flags/page.tsx" src/server/modules/admin/queries.ts
git commit -m "feat(admin): feature flags, with the one that would break sign-in held shut"
```

---

### Task 6: The webhook vocabulary (TDD)

Everything the webhook screens and the worker both need to agree on: which events exist, what an
endpoint's subscription list is allowed to contain, the envelope a consumer receives, and the chip
text the deliveries page prints.

**One structural rule, and it is why this is two files.** `src/lib/webhooks.ts` must not import
`node:crypto`: `deliveryStage` is called from a `"use client"` table in Task 13, and a client bundle
that reaches a node builtin either fails to build or drags a polyfill in behind it. Signing therefore
lives in `src/server/webhooks/sign.ts`, which only the worker imports. (This supersedes the single
`src/lib/webhooks.ts` named in the file-structure section above.)

**Files:**
- Create: `src/lib/webhooks.ts`, `src/lib/webhooks.test.ts`, `src/server/webhooks/sign.ts`,
  `src/server/webhooks/sign.test.ts`

- [ ] **Step 1: Write the failing test for the pure half**

Create `src/lib/webhooks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EVENT_LABELS, WEBHOOK_EVENTS, deliveryStage, parseEvents, webhookEnvelope,
} from "./webhooks";
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
});

describe("webhookEnvelope", () => {
  it("carries id, event, occurredAt and data — and nothing else", () => {
    const env = webhookEnvelope("wd-1", "approval.executed", new Date("2026-08-19T02:00:00Z"), {
      refNo: "APR-2042",
    });
    expect(Object.keys(env).sort()).toEqual(["data", "event", "id", "occurredAt"]);
    expect(env).toEqual({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: "2026-08-19T02:00:00.000Z",
      data: { refNo: "APR-2042" },
    });
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
});

// `deliveryStage` returns a LABEL and nothing else. Colour is not its business:
// src/lib/status.ts owns "every enum value in the app maps into exactly one
// family; nothing gets a bespoke colour", and StatusPill derives the family from
// the raw status value. DeliveryStatus was simply the one app enum that map had
// never been taught — Step 3b fixes that, and these are the tests for it.
describe("DeliveryStatus is in the six-family system", () => {
  it("colours a dead delivery as a fault and a landed one as settled", () => {
    expect(statusFamily("DELIVERED")).toBe("settled");
    expect(statusFamily("DEAD")).toBe("fault");
    expect(statusFamily("RETRYING")).toBe("attention");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/lib/webhooks.test.ts
```

Expected: FAIL — `Failed to resolve import "./webhooks"`.

- [ ] **Step 3: Write the pure module**

Create `src/lib/webhooks.ts`. **No `node:` imports in this file** — see the rule at the top of this task. `./status` is fine: it is pure and already imported by client components.

```ts
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
 * Normalising on read means the worker never fans out to a subscription nobody
 * can satisfy, and the editor never renders a checkbox with no label.
 */
export function parseEvents(raw: unknown): WebhookEvent[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((e): e is string => typeof e === "string"));
  // WEBHOOK_EVENTS order, not input order: two endpoints with the same
  // subscription must produce the same array, or every diff looks like a change.
  return WEBHOOK_EVENTS.filter((e) => wanted.has(e));
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
 */
export function webhookEnvelope(
  id: string,
  event: string,
  occurredAt: Date,
  data: Record<string, unknown>,
): WebhookEnvelope {
  return { id, event, occurredAt: occurredAt.toISOString(), data };
}

/**
 * The chip's LABEL on /admin/webhooks/deliveries — colour is not this
 * function's business (see Step 3b). The ratio is the point: card 3h shows
 * `DEAD · 5/5`, which is only meaningful because the denominator is the
 * worker's MAX_ATTEMPTS. Scope decision #6 is what keeps this number honest — the
 * delivery row's `attempts` is mirrored from the job rather than counted twice.
 */
export function deliveryStage(status: string, attempts: number, maxAttempts: number): string {
  if (status === "DELIVERED") return "DELIVERED";
  if (status === "DEAD") return `DEAD · ${attempts}/${maxAttempts}`;
  if (status === "RETRYING") return `RETRYING · ${attempts}/${maxAttempts}`;
  // PENDING with no attempt yet has no ratio worth printing: "0/5" reads as a
  // failure that hasn't happened. Once it has been tried, the count is news.
  return attempts > 0 ? `QUEUED · ${attempts}/${maxAttempts}` : "QUEUED";
}
```

- [ ] **Step 3b: Teach the six-family system about `DeliveryStatus`**

`src/lib/status.ts` states the rule: *every enum value in the app maps into exactly one family; nothing
gets a bespoke colour*, and unknown values fall through to neutral. `DeliveryStatus` is the one app enum
that map has never covered, so a `DEAD` delivery would render neutral — the same grey as a spare laptop
— which is precisely the drift the six-family system exists to prevent.

In the `MAP` in `src/lib/status.ts`, the line that currently reads:

```ts
  PENDING: "attention", APPROVED: "settled", REJECTED: "fault",
```

gains the DeliveryStatus values it doesn't already carry (`PENDING` is there, and `attention` is right
for a queued delivery too):

```ts
  PENDING: "attention", APPROVED: "settled", REJECTED: "fault",
  // DeliveryStatus (Phase 8): DELIVERED landed, DEAD spent its budget,
  // RETRYING is failing but not finished.
  DELIVERED: "settled", DEAD: "fault", RETRYING: "attention",
```

Check the whole `MAP` for an existing `DELIVERED` or `DEAD` key first — if either is already claimed by
another namespace, use `StatusPill`'s `ns` parameter rather than overwriting it.

- [ ] **Step 4: Write the failing test for the signing half**

Create `src/server/webhooks/sign.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SIGNATURE_HEADER, signPayload } from "./sign";

describe("signPayload", () => {
  it("is a prefixed hex HMAC-SHA256, so a consumer can tell the scheme apart", () => {
    const sig = signPayload('{"a":1}', "shhh");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is stable for the same body and secret", () => {
    expect(signPayload('{"a":1}', "shhh")).toBe(signPayload('{"a":1}', "shhh"));
  });

  it("changes when the body changes", () => {
    expect(signPayload('{"a":1}', "shhh")).not.toBe(signPayload('{"a":2}', "shhh"));
  });

  // The whole point of a signing secret: a receiver that checks the signature
  // can tell our POST from anyone else's.
  it("changes when the secret changes", () => {
    expect(signPayload('{"a":1}', "shhh")).not.toBe(signPayload('{"a":1}', "other"));
  });

  it("names the header once, so the worker and the docs can't drift", () => {
    expect(SIGNATURE_HEADER).toBe("x-backroom-signature");
  });
});
```

- [ ] **Step 5: Write the signing module**

Create `src/server/webhooks/sign.ts`:

```ts
import { createHmac } from "node:crypto";

/** Named once so the worker, any future docs page, and the tests agree. */
export const SIGNATURE_HEADER = "x-backroom-signature";

/**
 * HMAC-SHA256 over the exact bytes we POST, hex, prefixed with the algorithm so
 * a receiver can recognise a future scheme change instead of silently failing
 * every signature. The caller must sign the SAME string it sends — re-serialising
 * the object on either side is how signatures start disagreeing over key order.
 */
export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}
```

- [ ] **Step 6: Run both suites and watch them pass**

```bash
npx vitest run src/lib/webhooks.test.ts src/server/webhooks/sign.test.ts
```

Expected: PASS, 17 tests.

- [ ] **Step 7: Mutation-test them**

1. Make `parseEvents` return `wanted` directly instead of filtering through `WEBHOOK_EVENTS` → both
   "drops unknown events" and "keeps known events in WEBHOOK_EVENTS order" must fail.
2. Drop the `attempts > 0` branch in `deliveryStage` so PENDING always prints a ratio → "reads a
   never-attempted row as QUEUED" must fail.
3. In `signPayload`, ignore `secret` (use a constant key) → "changes when the secret changes" must fail.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/lib/webhooks.ts src/lib/webhooks.test.ts src/lib/status.ts src/server/webhooks/sign.ts src/server/webhooks/sign.test.ts
git commit -m "feat(webhooks): the event list, the envelope, the chip, and the signature"
```

---

### Task 7: Endpoint actions — the secret is encrypted, and shown once

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

The endpoint list and its editor. The one screen in this phase with a genuinely unusual obligation:
**the secret is visible exactly once**, in the response to create or rotate, and there is no way back
to it. The UI has to make that obvious *before* the operator clicks away.

**Files:**
- Create: `src/components/admin/endpoint-editor.tsx`, `src/app/(app)/admin/webhooks/page.tsx`

- [ ] **Step 1: Write the editor component**

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
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EVENT_LABELS, WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks";
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
          <code className="font-mono">x-backroom-signature</code> header. If you lose it, rotate — the
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

/** Shared plumbing: same ActionResult ladder as every other admin screen. */
function useRunner(claimedFieldKeys: string[] = []) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, okMsg: string, onOk?: (data: T) => void) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast(okMsg, "settled");
        onOk?.(res.data);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const errs = res.fieldErrors ?? {};
        setFieldErrors(errs);
        // A key no FormError claims must not dead-end silently (the Phase 7
        // lesson): fall it back into the banner.
        const unclaimed = Object.keys(errs).find((k) => !claimedFieldKeys.includes(k));
        if (unclaimed) setError(errs[unclaimed]);
      } else setError(res.message);
    });
  }

  return { pending, error, fieldErrors, retryAfter, setRetryAfter, run };
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

export function EndpointCard({ endpoint }: { endpoint: EndpointRow }) {
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useRunner(["url"]);
  const [url, setUrl] = useState(endpoint.url);
  const [events, setEvents] = useState<WebhookEvent[]>(endpoint.events);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const dirty = url !== endpoint.url || events.join(",") !== endpoint.events.join(",");

  return (
    <Card>
      <CardHeader
        title={<span className="font-mono text-[12.5px]">{endpoint.url}</span>}
        actions={
          <span className="flex items-center gap-2">
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
                  onSelect: () =>
                    run(
                      () => setEndpointActive({ id: endpoint.id, active: !endpoint.active }),
                      endpoint.active ? "Endpoint disabled" : "Endpoint enabled",
                    ),
                },
                {
                  label: "Rotate signing secret",
                  onSelect: () =>
                    run(
                      () => rotateSecret({ id: endpoint.id }),
                      "Secret rotated — copy the new one",
                      (data) => setFreshSecret(data.secret),
                    ),
                },
                {
                  label: "Delete endpoint",
                  danger: true,
                  onSelect: () => run(() => deleteEndpoint({ id: endpoint.id }), "Endpoint deleted"),
                },
              ]}
            />
          </span>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        {freshSecret && <SecretOnce secret={freshSecret} onDone={() => setFreshSecret(null)} />}

        <div className="flex flex-col gap-1">
          <Input
            aria-label={`URL for ${endpoint.url}`}
            value={url}
            invalid={!!fieldErrors.url}
            className="w-full max-w-[420px] py-1.5 font-mono text-xs"
            onChange={(e) => setUrl(e.target.value)}
          />
          <FormError>{fieldErrors.url}</FormError>
        </div>

        <EventChecks
          selected={events}
          disabled={pending}
          namePrefix={endpoint.url}
          onToggle={(event, on) =>
            setEvents((prev) =>
              on ? [...prev, event] : prev.filter((e) => e !== event),
            )
          }
        />

        {dirty && (
          <span>
            <Button
              size="sm"
              variant="primary"
              loading={pending}
              onClick={() => run(() => updateEndpoint({ id: endpoint.id, url, events }), "Endpoint saved")}
            >
              Save changes
            </Button>
          </span>
        )}
      </CardBody>
    </Card>
  );
}

export function NewEndpointCard() {
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useRunner(["url"]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="New endpoint" />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        {freshSecret && <SecretOnce secret={freshSecret} onDone={() => setFreshSecret(null)} />}

        <div className="flex flex-col gap-1">
          <Input
            aria-label="New endpoint URL"
            placeholder="https://example.com/hooks/backroom"
            value={url}
            invalid={!!fieldErrors.url}
            className="w-full max-w-[420px] py-1.5 font-mono text-xs"
            onChange={(e) => setUrl(e.target.value)}
          />
          <FormError>{fieldErrors.url}</FormError>
        </div>

        <EventChecks
          selected={events}
          disabled={pending}
          namePrefix="New endpoint"
          onToggle={(event, on) =>
            setEvents((prev) => (on ? [...prev, event] : prev.filter((e) => e !== event)))
          }
        />
        <FormError>{fieldErrors.events}</FormError>

        <span>
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            onClick={() =>
              run(
                () => createEndpoint({ url, events }),
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

`fieldErrors.events` gets its own `FormError` below the checkboxes, so the "pick at least one event"
refusal lands where the operator is looking rather than in the banner.

- [ ] **Step 2: Write the page**

Create `src/app/(app)/admin/webhooks/page.tsx`:

```tsx
import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { EndpointCard, NewEndpointCard } from "@/components/admin/endpoint-editor";
import { listEndpoints } from "@/server/modules/admin/queries";

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
          can never be read back — only replaced. A failed delivery retries five times with a widening
          gap before it dead-letters, and a dead one can be replayed.
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

- [ ] **Step 3: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

In the preview as `admin@thebackroomop.com`, `/admin/webhooks`:

1. Empty state, then create an endpoint at `http://localhost:4999/hook` with **An approval finished
   executing** ticked. The `attention`-toned banner appears with a `select-all` secret and an "I've
   copied it" button.
2. Reload the page — **the secret is gone and there is no way to see it again.** That is the design.
3. Try creating one with no events ticked → the refusal renders under the checkboxes, not in the banner.
4. Try `not-a-url` → refused under the URL field.
5. Rotate the secret from the ⋯ menu → a new value, again once.
6. Delete the endpoint → it goes (it has no deliveries yet). Then re-create it and run Task 10's Step 4
   end-to-end check against it, so the next step has a real delivery to look at.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/endpoint-editor.tsx "src/app/(app)/admin/webhooks/page.tsx"
git commit -m "feat(webhooks): endpoints, and a secret you get exactly one look at"
```

---

### Task 9: The emitter, and the index that stops a double-click

The producer that has never existed. `emitWebhook` writes rows and performs **no I/O** — scope
decision #10 — because an unreachable endpoint must never roll back the inventory change that
mentioned it.

**Files:**
- Create: `prisma/migrations/20260819090000_job_one_live_deliver_per_delivery/migration.sql`,
  `src/server/webhooks/emit.ts`
- Modify: `src/worker/execute-approval.ts`, `src/server/modules/offboarding/actions.ts`,
  `src/server/modules/purchases/actions.ts`

- [ ] **Step 1: Write the migration**

Create `prisma/migrations/20260819090000_job_one_live_deliver_per_delivery/migration.sql`:

```sql
-- At most one live delivery job per WebhookDelivery row. The mirror of
-- Job_one_live_execute_per_approval (20260814090100_integrity_constraints):
-- Task 13's Replay re-enqueues, and a double-click would otherwise put two
-- workers on one delivery and POST the same envelope twice.
CREATE UNIQUE INDEX "Job_one_live_deliver_per_delivery"
  ON "Job" ((payload->>'deliveryId'))
  WHERE "status" IN ('PENDING', 'RUNNING') AND "type" = 'DELIVER_WEBHOOK';
```

Apply it and regenerate the client:

```bash
npx prisma migrate deploy && npx prisma generate
```

Expected: `1 migration found` … `Applied`. This is a raw-SQL index with no `schema.prisma` counterpart,
exactly like the three integrity constraints before it — `prisma db pull` would not reproduce it, which
is why HANDOVER §8 tracks that gap rather than pretending it doesn't exist.

- [ ] **Step 2: Write the emitter**

Create `src/server/webhooks/emit.ts`:

```ts
import type { Prisma } from "@prisma/client";
// Relative, not "@/": src/worker runs under tsx and every worker-side module
// in this repo imports relatively (see execute-approval.ts). emit.ts is imported
// from BOTH the worker and Next server actions, so it has to use the style that
// works in both.
import { parseEvents, type WebhookEvent } from "../../lib/webhooks";

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
 */
export async function emitWebhook(
  tx: Prisma.TransactionClient,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { active: true, events: { has: event } },
    select: { id: true, events: true },
  });

  for (const endpoint of endpoints) {
    // `events` is a raw String[]; the SQL `has` above matched the stored text,
    // and parseEvents is the same normalisation the editor and worker apply, so
    // a renamed event can't be resurrected by a stale row.
    if (!parseEvents(endpoint.events).includes(event)) continue;

    const delivery = await tx.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload: data as Prisma.InputJsonObject,
        status: "PENDING",
      },
    });
    await tx.job.create({
      data: { type: "DELIVER_WEBHOOK", payload: { deliveryId: delivery.id } },
    });
  }
}
```

`data` is the envelope's `data` only — `webhookEnvelope` wraps it at delivery time (Task 10), so the
stored payload stays the facts and the envelope stays a presentation concern.

- [ ] **Step 3: Emit on `approval.executed`**

In `src/worker/execute-approval.ts`, the execution transaction ends by writing the approval's audit
entry. Add the import at the top:

```ts
import { emitWebhook } from "../server/webhooks/emit";
```

Relative, matching every other import in that file — the worker runs under `tsx`, not Next.

and emit immediately after that `tx.auditEntry.create({ … action: "executed" … })` call, still inside
the same `tx`:

```ts
    await emitWebhook(tx, "approval.executed", {
      approvalId: approval.id,
      refNo: approval.refNo,
      type: approval.type,
      assetId: approval.assetId,
      assetTag: asset?.tag ?? null,
    });
```

Scope decision #14 — ids and refNos, never whole rows. Use whatever local the surrounding code already
holds for the asset; if it is not in scope at that point, pass `assetTag: null` rather than adding a
query, because the consumer has `assetId`.

- [ ] **Step 4: Emit on `offboarding.completed`**

Import it as `@/server/webhooks/emit` here — this file is a Next module, unlike the worker.

In `src/server/modules/offboarding/actions.ts`, `completeOffboarding` writes an audit entry with
`action: "offboarding.completed"` carrying the decision set. Add the import and emit inside the same
transaction, directly after that `writeAudit` call:

```ts
    await emitWebhook(tx, "offboarding.completed", {
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      decisions: decisions.length,
    });
```

Use the same `decisions` local the audit diff already uses. If its name differs in the shipped code,
match the shipped name rather than renaming it — this is the one number the event is worth sending.

- [ ] **Step 5: Emit on `purchase_request.completed`**

In `src/server/modules/purchases/actions.ts`, `runTransition` handles every purchase transition inside
one transaction and sets `data.completedAt = now` when `action === "complete"`. Emit inside that same
transaction, after the NoteEntry and `writeAudit` calls, guarded on the action:

```ts
    if (action === "complete") {
      await emitWebhook(tx, "purchase_request.completed", {
        purchaseRequestId: request.id,
        refNo: request.refNo,
      });
    }
```

Match the local names `runTransition` actually uses for the request row.

- [ ] **Step 6: Prove the emitter writes nothing when nobody is listening**

There are no endpoints in the seed until Task 12, which makes this the cheapest possible check that
the emitter is inert by default:

```bash
npm run db:seed
npm run worker:once
docker exec inventory-db-1 psql -U inventory -d inventory -c "SELECT count(*) FROM \"WebhookDelivery\";"
```

Expected: `0`. The seed's `APR-2035` demo job still runs and still fails the way it always has —
emitting is additive and must not have changed it.

- [ ] **Step 7: Typecheck, lint, full unit suite, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add prisma/migrations/20260819090000_job_one_live_deliver_per_delivery src/server/webhooks/emit.ts src/worker/execute-approval.ts src/server/modules/offboarding/actions.ts src/server/modules/purchases/actions.ts
git commit -m "feat(webhooks): the producer that never existed, and the index that stops a double-send"
```

---

### Task 10: The worker delivers for real

`src/worker/index.ts` currently answers every `DELIVER_WEBHOOK` job with
`status: "DEAD", lastError: "webhook delivery ships in Phase 8"`. This is that phase.

The delivery handler owns one subtle obligation: **the `WebhookDelivery` row is a mirror of the job,
not a second retry loop** (scope decision #6). The worker's existing `catch` already does backoff and
dead-letters at `MAX_ATTEMPTS`; the handler's job is to make the ledger say the same thing.

**Files:**
- Create: `src/worker/deliver-webhook.ts`
- Modify: `src/worker/index.ts`

- [ ] **Step 1: Write the delivery handler**

Create `src/worker/deliver-webhook.ts`:

```ts
import { prisma } from "../server/db/client";
import { decryptSecret } from "../server/crypto";
// secretAad and the signer both live in sign.ts precisely so the worker never
// has to import webhook-actions.ts, which carries "use server".
import { SIGNATURE_HEADER, secretAad, signPayload } from "../server/webhooks/sign";
import { webhookEnvelope } from "../lib/webhooks";

const TIMEOUT_MS = 10_000;

/** A delivery that can never succeed — dead-letter it now instead of burning five attempts. */
class Permanent extends Error {}

/**
 * One attempt. Throwing hands control back to the worker's existing catch, which
 * owns backoff and the dead-letter at MAX_ATTEMPTS — so this function must NOT
 * implement its own retry. What it does own is keeping WebhookDelivery in step
 * with the job, which is what makes the page's `DEAD · 5/5` chip honest.
 *
 * `attempts` is the job's own count, passed in, so the two can never diverge.
 */
export async function deliverWebhook(deliveryId: string, attempts: number): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  // A delivery whose row is gone is not a failure to retry — nothing to send.
  if (!delivery) throw new Permanent(`WebhookDelivery ${deliveryId} no longer exists`);
  if (delivery.status === "DELIVERED") return;
  if (!delivery.endpoint.active) {
    throw new Permanent(`Endpoint ${delivery.endpoint.url} is disabled`);
  }

  const body = JSON.stringify(
    webhookEnvelope(
      delivery.id,
      delivery.event,
      delivery.createdAt,
      (delivery.payload ?? {}) as Record<string, unknown>,
    ),
  );
  // Sign the exact bytes we send. Re-serialising on either side is how
  // signatures start disagreeing over key order.
  const secret = decryptSecret(delivery.endpoint.secret, secretAad(delivery.endpoint.id));
  const signature = signPayload(body, secret);

  let response: Response;
  try {
    response = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: signature,
        "user-agent": "backroom-inventory/1",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Connection refused, DNS failure, timeout — all worth retrying.
    await mark(delivery.id, "RETRYING", attempts, err instanceof Error ? err.message : String(err));
    throw err;
  }

  if (!response.ok) {
    const detail = `${response.status} ${response.statusText}`.trim();
    // 4xx (except 408/429) means the receiver understood and refused. Retrying
    // a 404 or a 401 five times just delays the same answer.
    const permanent = response.status >= 400 && response.status < 500
      && response.status !== 408 && response.status !== 429;
    await mark(delivery.id, permanent ? "DEAD" : "RETRYING", attempts, detail);
    if (permanent) throw new Permanent(detail);
    throw new Error(detail);
  }

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: "DELIVERED", attempts, lastError: null, deliveredAt: new Date(), nextAttemptAt: null },
  });
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
reads the job when it wants to show "next attempt".

- [ ] **Step 2: Replace the dead-letter branch**

In `src/worker/index.ts`, add the import:

```ts
import { deliverWebhook, PermanentDeliveryError } from "./deliver-webhook";
```

Replace the whole `if (job.type === "DELIVER_WEBHOOK") { … }` block in `handle()` with:

```ts
  if (job.type === "DELIVER_WEBHOOK") {
    const deliveryId = String((job.payload as { deliveryId?: unknown } | null)?.deliveryId ?? "");
    if (!deliveryId) throw new Error("DELIVER_WEBHOOK job has no deliveryId");
    await deliverWebhook(deliveryId, job.attempts);
    return;
  }
```

- [ ] **Step 3: Let a permanent failure skip the retry budget**

`tick()`'s catch currently dead-letters only when `job.attempts >= MAX_ATTEMPTS`. A `PermanentDeliveryError`
should not wait for five attempts. In that `catch`, change:

```ts
    const dead = job.attempts >= MAX_ATTEMPTS;
```

to:

```ts
    // A 404, a disabled endpoint or a vanished delivery row cannot succeed on
    // attempt five either — dead-letter it now rather than spending the budget
    // to reach the same answer four failures later.
    const dead = job.attempts >= MAX_ATTEMPTS || err instanceof PermanentDeliveryError;
```

The delivery row is already `DEAD` in that case (the handler marked it before throwing), so the ledger
and the job agree without a second write.

- [ ] **Step 4: Prove it end to end against a real receiver**

The point of this step is that nothing else in the suite POSTs anywhere. Run a throwaway listener,
create an endpoint through the UI in Task 8, then:

```bash
node -e "require('node:http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(q.headers['x-backroom-signature']);console.log(b);s.writeHead(200);s.end('ok')})}).listen(4999,()=>console.log('listening on 4999'))"
```

In a second shell, cause an `approval.executed` (approve any pending approval in `/approvals`), then:

```bash
npm run worker:once
```

Expected: the listener prints an `sha256=…` signature and a single-line envelope with `id`, `event`,
`occurredAt` and `data` — and nothing else. Then confirm the ledger agrees:

```bash
docker exec inventory-db-1 psql -U inventory -d inventory -c "SELECT status, attempts, \"deliveredAt\" IS NOT NULL AS landed FROM \"WebhookDelivery\";"
```

Expected: `DELIVERED | 1 | t`.

Now point the endpoint at `http://localhost:4999/nope` with the listener stopped and repeat: the job
retries, the delivery reads `RETRYING`, and `attempts` on the row matches the job's.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/worker/deliver-webhook.ts src/worker/index.ts
git commit -m "feat(webhooks): the worker actually delivers, and the ledger mirrors the job"
```

---

### Task 11: Admin gets its own Home

Scope decision #13, and HANDOVER §6 criterion #6. Today `resolveWorkspace` can return `"admin"` but
`src/app/(app)/page.tsx` only branches on `purchasing` and `finance` — so an admin lands on the IT
Home and reads SLA breaches and fleet composition under a Users / Webhooks / Feature-flags sidebar.
The sidebar and the body describe different jobs.

The Admin Home answers the three questions its own sidebar raises: **who can get in, what is switched
on, and are the integrations healthy.**

**Files:**
- Create: `src/components/home/admin-home.tsx`
- Modify: `src/server/modules/admin/queries.ts`, `src/app/(app)/page.tsx`

- [ ] **Step 1: Add the query**

Append to `src/server/modules/admin/queries.ts`. It needs `specFor`, so extend the existing
`@/lib/admin-flags` import to `import { FLAG_SPECS, specFor } from "@/lib/admin-flags";`.

```ts
export interface AdminHome {
  users: { total: number; disabled: number; byRole: Array<{ role: Role; count: number }> };
  flags: Array<{ key: string; label: string; enabled: boolean; unavailable: boolean }>;
  webhooks: { endpoints: number; inactive: number; dead: number; delivered: number };
}

export async function adminHome(): Promise<AdminHome> {
  const [byRole, disabled, flagRows, endpoints, inactive, dead, delivered] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { disabled: true } }),
    prisma.featureFlag.findMany(),
    prisma.webhookEndpoint.count(),
    prisma.webhookEndpoint.count({ where: { active: false } }),
    prisma.webhookDelivery.count({ where: { status: "DEAD" } }),
    prisma.webhookDelivery.count({ where: { status: "DELIVERED" } }),
  ]);

  const enabledBy = new Map(flagRows.map((f) => [f.key, f.enabled]));
  return {
    users: {
      total: byRole.reduce((sum, g) => sum + g._count._all, 0),
      disabled,
      // Driven by ROLE_OPTIONS so a role nobody holds still shows as 0 rather
      // than vanishing — "no admins" is exactly the kind of thing a zero row
      // is for.
      byRole: ROLE_OPTIONS.map((role) => ({
        role,
        count: byRole.find((g) => g.role === role)?._count._all ?? 0,
      })),
    },
    // FLAG_SPECS-driven for the same reason as listFlags: a hand-inserted row
    // is not something this page should report as configuration.
    flags: FLAG_SPECS.map((spec) => ({
      key: spec.key,
      label: spec.label,
      enabled: enabledBy.get(spec.key) ?? false,
      unavailable: !!specFor(spec.key)?.unavailable,
    })),
    webhooks: { endpoints, inactive, dead, delivered },
  };
}
```

Extend the file's existing imports with `ROLE_OPTIONS` from `@/lib/admin-users` (it already imports
`lockReason` and `TargetUser` from there).

- [ ] **Step 2: Write the component**

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
        <Stat label="Accounts" value={String(users.total)} />
        <Stat
          label="Disabled"
          value={String(users.disabled)}
          hint={users.disabled === 0 ? "everyone can sign in" : "blocked from signing in"}
        />
        <Stat label="Endpoints" value={String(webhooks.endpoints)} />
        <Stat
          label="Dead deliveries"
          value={String(webhooks.dead)}
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
                webhooks.inactive > 0 ? `, ${webhooks.inactive} endpoint disabled` : ""
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

`Stat` takes `{ label, value, hint }` and `StatusDot` takes `value` (not `status`) — both verified
against the shipped components.

- [ ] **Step 3: Branch the Home route**

In `src/app/(app)/page.tsx`, the route already computes `ws` and returns early for `purchasing` and
`finance`. Add the same shape for `admin`, **above** those two so the ordering reads as a list of
workspaces rather than a fall-through, and import what it needs:

```tsx
import { adminHome } from "@/server/modules/admin/queries";
import { AdminHomeBody } from "@/components/home/admin-home";
```

```tsx
  if (ws === "admin") {
    const admin = await safeSection("Admin overview", () => adminHome());
    return (
      <>
        {header}
        <SectionCard title="System" result={admin}>
          {(data) => <AdminHomeBody data={data} />}
        </SectionCard>
      </>
    );
  }
```

Use whatever local the file already binds for the page header — the existing `purchasing` and
`finance` branches show the exact shape; copy theirs rather than inventing a second one. Everything
loads through `safeSection` and renders through `SectionCard`, so a failing query gives the designed
FAILED card instead of a blank page, exactly like every other Home.

- [ ] **Step 4: Typecheck, lint, look at it**

```bash
npx tsc --noEmit && npm run lint
```

In the preview as `admin@thebackroomop.com`, switch the workspace to **Admin** and open `/`:

1. Four stat tiles, then the three lists. No SLA breaches, no fleet bar, no age histogram — the body
   now matches its own sidebar.
2. The role list shows all five roles including any with a count of 0.
3. `Microsoft 365 sign-in` reads `unavailable`, not `off`.
4. Switch back to the IT workspace and confirm the IT Home is untouched.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/admin-home.tsx src/server/modules/admin/queries.ts "src/app/(app)/page.tsx"
git commit -m "feat(admin): a Home whose body matches its own sidebar"
```

---

### Task 12: The fixtures the deliveries page needs

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
