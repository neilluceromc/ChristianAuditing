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
