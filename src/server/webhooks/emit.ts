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
