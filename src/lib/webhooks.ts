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

/**
 * The header every signed POST carries, named ONCE for the three surfaces that
 * have to agree: `signPayload` (which builds the value), the worker that sends
 * it (Task 10), and `/admin/webhooks`, which tells the operator what to paste
 * the shown-once secret against. It lives here rather than in
 * `src/server/webhooks/sign.ts` — its original home — because that module
 * imports `node:crypto` and so cannot be pulled into a `"use client"`
 * component; a client-side copy of this string would be a second definition
 * that a rename silently leaves behind, wrong, in the one place a human reads
 * it (HANDOVER §6a rule 26).
 */
export const SIGNATURE_HEADER = "x-backroom-signature";


export const EVENT_LABELS: Record<WebhookEvent, string> = {
  "approval.executed": "An approval finished executing",
  "offboarding.completed": "An offboarding was completed",
  "purchase_request.completed": "A purchase request was completed",
};

/**
 * The Rotate control's consequence, stated rather than left for an admin to
 * discover — the same "stated, not discovered" discipline as `lockReason`
 * (admin-users.ts) and `flagChangeWarning` (admin-flags.ts): one sentence,
 * exported as data so a component never hardcodes it (§6a rules 5 and 11).
 * Rotating is a hard cutover: every delivery from this moment signs with the
 * new secret, a receiver still holding the old one will reject it (401), and
 * the worker (Task 10) treats a 401 as permanent — so deliveries go straight
 * to DEAD until the receiver is updated with the new secret. Recoverable
 * with Replay all once it is.
 */
export const ROTATION_WARNING =
  "Every delivery from now on signs with the new secret. Until the receiver is updated to match, " +
  "deliveries will fail immediately and go straight to Dead — use Replay all once it has the new secret.";

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
