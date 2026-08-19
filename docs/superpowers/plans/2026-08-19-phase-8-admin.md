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
  it("covers every Role in the schema, admin first", () => {
    expect(ROLE_OPTIONS).toEqual(["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"]);
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
  });

  it("refuses to touch the permanent admin even when re-enabling", () => {
    const off: TargetUser = { ...permanent, disabled: true };
    expect(disableChange(off, false, "actor-9").allowed).toBe(false);
  });

  // Scope decision #3: unlike a demotion, this one has no way back for you.
  it("refuses self-disable and names the way back", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    const res = disableChange(self, true, "actor-9");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/permanent admin/i);
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
 * accident rather than an intent. The refusal names who can undo it.
 */
export function disableChange(target: TargetUser, next: boolean, actorId: string): RuleResult {
  const locked = lockReason(target);
  if (locked) return { allowed: false, reason: locked };
  if (next && target.id === actorId) {
    return {
      allowed: false,
      reason:
        "You can't disable your own account — you'd be signed out with no way back in. Ask the permanent admin to do it.",
    };
  }
  return { allowed: true };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx vitest run src/lib/admin-users.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 6: Mutation-test the suite before trusting it**

This project has shipped tests that passed for the wrong reason (HANDOVER §7), so break each rule in
turn, confirm a test dies, and put it back:

1. `lockReason` returns `null` unconditionally → the `lockReason` permanent test and all four
   permanent-admin tests must fail.
2. Drop the `next &&` from the self-disable guard → "allows re-enabling yourself" must fail.
3. Change `target.id === actorId` to `target.id !== actorId` → "allows disabling an ordinary user"
   must fail.

If a mutation leaves the suite green, the test for that rule is not testing it — fix the test, not the
module.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npx vitest run src/lib/admin-users.test.ts
git add src/lib/admin-users.ts src/lib/admin-users.test.ts
git commit -m "feat(admin): the user rules, with the permanent admin locked against disable too"
```

---

### Task 2: User actions

Two mutations, both guarded by Task 1's rules and both state-guarded on the value they are replacing.
This is also where the phase's `asActionResult` helper is written; Tasks 5, 7 and 13 import it, so get
the shape right here.

**Files:**
- Create: `src/server/modules/admin/user-actions.ts`

- [ ] **Step 1: Write the actions**

Create `src/server/modules/admin/user-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { ROLE_OPTIONS, disableChange, roleChange, type TargetUser } from "@/lib/admin-users";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/**
 * Prisma throws rather than returning. P2028 (the transaction couldn't get a
 * connection — reachable with two concurrent transactions) and P2025 (the row
 * vanished between the read and the guarded write) are both designed conflicts
 * here, not 500s. Everything else rethrows: an unexpected error must never be
 * laundered into a friendly banner.
 *
 * NOTE for anyone editing the callbacks below: RETURNING a failure from a
 * $transaction callback COMMITS the transaction — only a throw rolls it back.
 * That is safe here because every `return conflict(...)` precedes every write.
 * Add a write before one of them and it will commit silently.
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

/** The narrow select every rule in `@/lib/admin-users` reads. */
const TARGET_SELECT = { id: true, role: true, isPermanentAdmin: true, disabled: true } as const;

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLE_OPTIONS as [string, ...string[]]),
});

export async function setUserRole(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const nextRole = parsed.data.role as TargetUser["role"];

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: { ...TARGET_SELECT, name: true, email: true },
        });
        if (!target) return conflict("That user no longer exists.");

        // Task 1's rule, called by the server independently of the UI — the page
        // hides the select for a locked row, and this refuses a request that
        // never came from that page.
        const verdict = roleChange(target, nextRole, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);
        if (target.role === nextRole) return null; // no-op: don't pollute the trail

        // Guarded on the before-value: two admins changing one row must not
        // silently agree on whichever write landed last.
        const written = await tx.user.updateMany({
          where: { id: target.id, role: target.role },
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
        return null;
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (failure) return failure;
  revalidatePath("/admin/users");
  return ok(null);
}

const disableSchema = z.object({
  userId: z.string().min(1),
  disabled: z.boolean(),
});

export async function setUserDisabled(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data.disabled;

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: { ...TARGET_SELECT, name: true, email: true },
        });
        if (!target) return conflict("That user no longer exists.");

        const verdict = disableChange(target, next, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);
        if (target.disabled === next) return null;

        const written = await tx.user.updateMany({
          where: { id: target.id, disabled: target.disabled },
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
          // The email is in the diff because a disabled user drops out of every
          // list that would otherwise say who this row was.
          diff: {
            disabled: { from: target.disabled, to: next },
            email: { from: target.email, to: target.email },
          },
        });
        return null;
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (failure) return failure;
  revalidatePath("/admin/users");
  return ok(null);
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
  if (action.includes("failed") || action === "delete" || action === "disable") return "DEFECTIVE"; // fault
```

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
          select: { id: true, name: true },
        })
      : [],
```

and beside the other `map.set` lines:

```ts
  for (const u of users) map.set(`user:${u.id}`, { label: u.name, href: "/admin/users" });
```

naming the new binding `users` in the destructuring. Without this, every role change in the audit log
reads as a truncated cuid.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/server/modules/admin/user-actions.ts src/components/patterns/activity-feed.tsx src/server/modules/audit/queries.ts
git commit -m "feat(admin): role and access changes, guarded and audited by name"
```

---

### Task 3: `/admin/users`

Card `3h`: role selects per row, **except the permanent admin**, which shows a `LOCKED` chip and static
text and is tinted one step back. The constraint is stated before the click.

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
import { asActionResult } from "@/server/modules/admin/user-actions";
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
import { STATUS_FAMILIES } from "./status";

describe("WEBHOOK_EVENTS", () => {
  it("is the short, deliberate list from scope decision #9", () => {
    expect(WEBHOOK_EVENTS).toEqual([
      "approval.executed", "asset.status_changed", "offboarding.completed",
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
    expect(deliveryStage("DELIVERED", 2, 5)).toEqual({ label: "DELIVERED", tone: "settled" });
  });

  it("reads DEAD with the full ratio, which is the design's DEAD · 5/5", () => {
    expect(deliveryStage("DEAD", 5, 5)).toEqual({ label: "DEAD · 5/5", tone: "fault" });
  });

  it("reads RETRYING with progress through the budget", () => {
    expect(deliveryStage("RETRYING", 2, 5)).toEqual({ label: "RETRYING · 2/5", tone: "attention" });
  });

  it("reads a never-attempted row as QUEUED, not as 0/5", () => {
    expect(deliveryStage("PENDING", 0, 5)).toEqual({ label: "QUEUED", tone: "inflight" });
  });

  it("reads a re-queued row with its attempts so far", () => {
    expect(deliveryStage("PENDING", 1, 5)).toEqual({ label: "QUEUED · 1/5", tone: "inflight" });
  });

  // Every tone must be one of the six families, or Pill/StatusDot render nothing
  // recognisable. "pending" is NOT one of them — the family for "failing but not
  // finished" is "attention".
  it("only ever returns a real status family", () => {
    const cases: Array<[string, number]> = [
      ["DELIVERED", 1], ["DEAD", 5], ["RETRYING", 2], ["PENDING", 0], ["PENDING", 1],
    ];
    for (const [status, attempts] of cases) {
      expect(STATUS_FAMILIES).toContain(deliveryStage(status, attempts, 5).tone);
    }
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
import type { StatusFamily } from "./status";

/**
 * Scope decision #9: a short, deliberate list. Every entry is a moment the code
 * already passes through with a transaction open, so emitting is a call rather
 * than a new hook — and every entry is something an outside system has an
 * obvious reason to know. Growing this list is one line here plus one
 * `emitWebhook` call, and a decision about what outsiders are entitled to see.
 */
export const WEBHOOK_EVENTS = [
  "approval.executed",
  "asset.status_changed",
  "offboarding.completed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const EVENT_LABELS: Record<WebhookEvent, string> = {
  "approval.executed": "An approval finished executing",
  "asset.status_changed": "An asset changed status",
  "offboarding.completed": "An offboarding was completed",
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
 * The chip on /admin/webhooks/deliveries. The ratio is the point: card 3h shows
 * `DEAD · 5/5`, which is only meaningful because the denominator is the worker's
 * MAX_ATTEMPTS. Scope decision #6 is what keeps this number honest — the
 * delivery row's `attempts` is mirrored from the job rather than counted twice.
 */
export function deliveryStage(
  status: string,
  attempts: number,
  maxAttempts: number,
): { label: string; tone: StatusFamily } {
  if (status === "DELIVERED") return { label: "DELIVERED", tone: "settled" };
  if (status === "DEAD") return { label: `DEAD · ${attempts}/${maxAttempts}`, tone: "fault" };
  if (status === "RETRYING") return { label: `RETRYING · ${attempts}/${maxAttempts}`, tone: "attention" };
  // PENDING with no attempt yet has no ratio worth printing: "0/5" reads as a
  // failure that hasn't happened. Once it has been tried, the count is news.
  return {
    label: attempts > 0 ? `QUEUED · ${attempts}/${maxAttempts}` : "QUEUED",
    tone: "inflight",
  };
}
```

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

Expected: PASS, 18 tests.

- [ ] **Step 7: Mutation-test them**

1. Make `parseEvents` return `wanted` directly instead of filtering through `WEBHOOK_EVENTS` → both
   "drops unknown events" and "keeps known events in WEBHOOK_EVENTS order" must fail.
2. Drop the `attempts > 0` branch in `deliveryStage` so PENDING always prints a ratio → "reads a
   never-attempted row as QUEUED" must fail.
3. In `signPayload`, ignore `secret` (use a constant key) → "changes when the secret changes" must fail.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint && npm run test
git add src/lib/webhooks.ts src/lib/webhooks.test.ts src/server/webhooks/sign.ts src/server/webhooks/sign.test.ts
git commit -m "feat(webhooks): the event list, the envelope, the chip, and the signature"
```

---
