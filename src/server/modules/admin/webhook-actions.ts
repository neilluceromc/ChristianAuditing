"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { encryptSecret } from "@/server/crypto";
import { newSecret, secretAad } from "@/server/webhooks/sign";
import { WEBHOOK_EVENTS, parseEvents, partitionEvents } from "@/lib/webhooks";
import { diffOf } from "@/lib/audit-diff";
import { asActionResult } from "@/server/prisma-errors";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const PATHS = ["/admin/webhooks", "/admin/webhooks/deliveries"] as const;

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

/**
 * Hosts with no legitimate reason to ever be a webhook target: the cloud
 * metadata endpoint (169.254.169.254, and the /16 it lives in — AWS, Azure
 * and GCP all use this range) and GCP's DNS alias for the same thing. An
 * admin who can create an endpoint could otherwise point this app's signed
 * POST at its own instance credentials.
 *
 * Deliberately narrow: this is the one guard with zero false positives.
 * Loopback and RFC1918 (10/8, 172.16/12, 192.168/16) are NOT blocked — scope
 * decision #4's "another container on the same host" rationale, and the
 * plan's own `http://localhost:4999/hook` verification target, both depend
 * on those staying reachable.
 */
function isBlockedWebhookHost(hostname: string): boolean {
  if (hostname === "metadata.google.internal") return true;
  const octets = hostname.split(".");
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    const [a, b] = octets.map(Number);
    return a === 169 && b === 254;
  }
  return false;
}

/**
 * The URL an endpoint POSTs to.
 *
 * http is allowed deliberately — this deploys to a single machine, and a
 * receiver may legitimately be another container on the same host. That is
 * the accepted capability (scope decision #4), not an oversight, but signing
 * the payload is not what makes it safe: `signPayload` gives the RECEIVER
 * integrity and authenticity (proof this app sent the request) and gives us
 * nothing about where the URL points. Over plain http it gives no
 * confidentiality either — the envelope and its HMAC cross the wire in the
 * clear, replayable for the five-minute window `sign.ts` allows. The one
 * guard this schema does add is `isBlockedWebhookHost`, above.
 */
const urlSchema = z
  .string()
  .trim()
  .min(1, "Enter the URL to POST to")
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v), "Must start with http:// or https://")
  .refine((v) => {
    try {
      return !isBlockedWebhookHost(new URL(v).hostname);
    } catch {
      return false;
    }
  }, "That isn't a valid URL, or points at a host this app refuses to call");

const eventsSchema = z
  // zod 4 takes the `as const` tuple directly and preserves WebhookEvent —
  // no cast. Task 4 removed the same zod-3 idiom from ROLE_OPTIONS; the cast
  // is what erases the element type and forces one downstream.
  .array(z.enum(WEBHOOK_EVENTS))
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
  // No `return conflict(...)` in this callback at all — a fresh row has
  // nothing to conflict with — so the precondition ("every conflict precedes
  // every write") holds trivially.
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
        // secret written there would be unremovable by construction. url/events
        // are real from-null transitions, which is the one sanctioned shape.
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
  // The one `return conflict(...)` below precedes the only write — the
  // updateMany's own zero-count conflict is itself the guard, and the write
  // it guards happens in the same statement, so there is no write it could
  // trail.
  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: parsed.data.id } });
        if (!endpoint) return conflict("That endpoint no longer exists.");
        // Guarded on `updatedAt`, not a bare `update` — two rotations racing
        // (two admins, or one operator double-clicking; nothing upstream of
        // this action gates repeat clicks) would otherwise both succeed, the
        // second write silently winning, and the shown-once secret handed to
        // whichever caller's response resolved last would be the wrong one
        // with no way to tell — the reveal is the only place the value ever
        // appears, so there is nothing to check it against afterward.
        const written = await tx.webhookEndpoint.updateMany({
          where: { id: endpoint.id, updatedAt: endpoint.updatedAt },
          data: { secret: encryptSecret(secret, secretAad(endpoint.id)) },
        });
        if (written.count === 0) {
          return conflict("Someone else just rotated this endpoint's secret — refresh and rotate again.");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "webhook-endpoint",
          entityId: endpoint.id,
          action: "rotate-secret",
          // No diff: nothing in `url`/`events`/`active` changed, and the secret
          // itself never appears in a diff (see createEndpoint). Logging a
          // from-equals-to `url` here would tell a reader the URL changed —
          // it didn't. entityLabels resolves the URL from the row for display;
          // the action name alone says what happened.
        });
        return null;
      }),
    { goneMessage: "That endpoint no longer exists." },
  );
  if (failure) return failure;
  revalidateAll();
  return ok({ secret });
}

const updateSchema = z.object({
  id: z.string().min(1),
  url: urlSchema,
  events: eventsSchema,
  /**
   * Never inferred from absence. The checkboxes this input reflects can only
   * ever represent `WEBHOOK_EVENTS` — a build has no control for a
   * subscription it doesn't recognise — so an unrecognised name is preserved
   * across every save UNLESS its exact name appears here, naming it
   * explicitly as something Task 8's editor is choosing to drop.
   */
  removeUnknown: z.array(z.string()).default([]),
});

export async function updateEndpoint(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const events = parseEvents(parsed.data.events);
  const removeSet = new Set(parsed.data.removeUnknown);

  // The one `return conflict(...)` below precedes the only write in this
  // callback (the guarded `updateMany`); the write's own zero-count case is
  // itself a conflict, returned before anything else runs.
  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: parsed.data.id } });
        if (!endpoint) return conflict("That endpoint no longer exists.");
        // partitionEvents splits the row's raw events into names this build
        // still recognises and names it doesn't. `existingUnknown` is carried
        // through untouched unless explicitly named in `removeUnknown` — the
        // form's checkboxes can only ever express intent about the KNOWN set,
        // so a save that doesn't mention an unrecognised name can't have meant
        // to remove it.
        const { known: before, unknown: existingUnknown } = partitionEvents(endpoint.events);
        const keptUnknown = existingUnknown.filter((e) => !removeSet.has(e));
        const noEventsChange = before.join(",") === events.join(",") && keptUnknown.length === existingUnknown.length;
        if (endpoint.url === parsed.data.url && noEventsChange) return null;

        // Guarded on `updatedAt` rather than `url`: a `url`-only guard misses
        // two admins editing only the events with the same URL — Postgres
        // re-checks the `where` against the NEW row version after the lock
        // (EvalPlanQual), the URL still matches, so the second write commits
        // over the first with no conflict raised, and its audit entry claims
        // a `from` that had already been superseded. `updatedAt` is
        // `@updatedAt`, so it moves on every write, whichever column changed.
        const written = await tx.webhookEndpoint.updateMany({
          where: { id: endpoint.id, updatedAt: endpoint.updatedAt },
          // Unknown events not explicitly named in `removeUnknown` are
          // appended back rather than left out — see the doc comment on that
          // field.
          data: { url: parsed.data.url, events: [...events, ...keptUnknown] },
        });
        if (written.count === 0) return conflict("Someone else just changed that endpoint — refresh.");

        // Compared as the FULL raw column (known ∪ preserved-unknown) on
        // both sides, not just the known set: that's what makes a
        // `removeUnknown` name show up as a real change (present in `from`,
        // absent from `to`) while a save that only touched the URL still
        // produces `{ url: {...} }` alone — diffOf's structural equality
        // collapses `events` out of the diff whenever the full array is
        // byte-for-byte identical on both sides.
        const diff = diffOf(
          { url: endpoint.url, events: [...before, ...existingUnknown] },
          { url: parsed.data.url, events: [...events, ...keptUnknown] },
        );
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "webhook-endpoint",
          entityId: endpoint.id,
          action: "update",
          diff,
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

  // Both `return conflict(...)`s below precede the only write; guarded on
  // `active` itself, the column being written, which loses no data either
  // direction — unlike `updateEndpoint`, this one didn't need an `updatedAt`
  // guard, because the guarded column and the written column are the same.
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
          // Namespaced (not bare "enable"/"disable") — `setUserDisabled`
          // already writes those bare verbs for entityType "user" (§6a rule
          // 22's sibling case), and `activity-feed.tsx`'s `actionDot` treats
          // bare "disable" as scoped to that one entity type.
          action: next ? "endpoint-enable" : "endpoint-disable",
          // `url` is not here — it didn't change, and the action name plus
          // entityLabels' URL already say which endpoint this was.
          diff: { active: { from: endpoint.active, to: next } },
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

  // The one `return conflict(...)` below precedes both writes (the count and
  // the delete). The count-then-delete gap is still real — a delivery can
  // land between them — but that race no longer escapes as an unhandled
  // P2003: `asActionResult`'s P2003 branch (src/server/prisma-errors.ts)
  // catches it and this call site names it with `restrictedMessage`.
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
          // Namespaced — see setEndpointActive's comment; "delete" already
          // has several producers (asset-category, asset-type, department)
          // that aren't this row's entity type either.
          action: "endpoint-delete",
          // The URL is the only thing that can name a deleted endpoint later —
          // entityLabels cannot resolve a row that is gone.
          diff: { url: { from: endpoint.url, to: null } },
        });
        return null;
      }),
    {
      goneMessage: "That endpoint no longer exists.",
      restrictedMessage: "That endpoint just received a delivery — refresh; it can no longer be deleted.",
    },
  );
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}
