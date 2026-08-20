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
        // partitionEvents splits the row's raw events into names this build
        // still recognises and names it doesn't. `before` (known-only) is what
        // the no-op check and the diff compare against — the same shape the
        // form's checkboxes can actually represent. `unknown` is carried
        // through untouched below: the form never rendered a control for those
        // names, so this save can't have meant to remove them, and dropping
        // them here would be exactly the silent, unaudited deletion the
        // amendment calls out.
        const { known: before, unknown } = partitionEvents(endpoint.events);
        if (endpoint.url === parsed.data.url && before.join(",") === events.join(",")) return null;

        // Guarded on the URL's before-value. `events` is a String[] and cannot
        // be compared in a Prisma where, so the URL carries the guard — which is
        // enough, because the editor saves both fields together.
        const written = await tx.webhookEndpoint.updateMany({
          where: { id: endpoint.id, url: endpoint.url },
          // Unknown events are appended back rather than left out: this save
          // only ever expresses an intent about the KNOWN set (that's all the
          // checkboxes can represent), so the write must not narrow the column
          // beyond that intent.
          data: { url: parsed.data.url, events: [...events, ...unknown] },
        });
        if (written.count === 0) return conflict("Someone else just changed that endpoint — refresh.");

        // Each diff key is included only when it actually changed — diffOf
        // compares `before` against `after` field by field, so a save that
        // only touched the URL produces `{ url: {...} }` alone, not an
        // `events` entry whose from and to are identical. Unknown events are
        // deliberately absent from both sides: they're preserved, not edited,
        // and Task 8's banner — not the audit trail — is what surfaces them.
        const diff = diffOf({ url: endpoint.url, events: before }, { url: parsed.data.url, events });
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
