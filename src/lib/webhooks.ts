import type { DeliveryStatus } from "@prisma/client";
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
 * Exported as data, like `ROTATION_WARNING`, because it has two producers that
 * must not drift: `replayBlockedReason` returns it when the page already knows
 * a live job exists, and `replayDelivery`'s P2002 branch returns it when
 * `Job_one_live_deliver_per_delivery` discovered the same fact mid-click. An
 * operator who loses that race should read the same sentence either way.
 */
export const ALREADY_QUEUED_REASON = "That delivery is already queued for another attempt.";

/**
 * Why this delivery cannot be replayed, or `null` when it can.
 *
 * The same shape as `deleteBlockedReason` above, for the same reason and with
 * the same discipline: `replayDelivery` prints these sentences when the click
 * has already happened, and `listDeliveries` calls the SAME function to decide
 * whether a Replay control may render at all — so a fourth refusal added to
 * the action cannot leave the table offering a button whose click is
 * guaranteed to fail (HANDOVER §6a rule 10, which this phase has broken in
 * every task that pairs a rule with a page). Returning `null` rather than a
 * boolean pair is what stops a caller rendering the refusal and the
 * affordance at once.
 *
 * `alreadyQueued` is the one condition a delivery row cannot answer by itself:
 * it means a live `DELIVER_WEBHOOK` job exists, which
 * `Job_one_live_deliver_per_delivery` will refuse to duplicate. Without it,
 * every freshly-emitted PENDING row and every backing-off RETRYING row offers
 * a Replay whose P2002 is certain — invisible against this repo's seed, which
 * queues no jobs for its deliveries at all.
 *
 * The order is the order `replayDelivery` checks in, so the sentence an
 * operator reads after a race is the sentence this would have given before it.
 */
export function replayBlockedReason(delivery: {
  status: string;
  endpointUrl: string;
  endpointActive: boolean;
  alreadyQueued: boolean;
}): string | null {
  if (delivery.status === "DELIVERED") {
    return "That one already landed — there's nothing to replay.";
  }
  if (!delivery.endpointActive) {
    return `${delivery.endpointUrl} is disabled — enable the endpoint first, or the replay will just die again.`;
  }
  if (delivery.alreadyQueued) return ALREADY_QUEUED_REASON;
  return null;
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

/**
 * The tab contract for `/admin/webhooks/deliveries`: `?state=`, the same one
 * `/purchases` and `/reservations` use, and the one `endpoint-editor.tsx`
 * already links into with `?state=DEAD`.
 *
 * Here, in `src/lib`, rather than beside the Prisma call in
 * `admin/queries.ts`: `RESERVATION_TABS` is bundled with its query and is for
 * that reason the one list parser in this app with no unit test (HANDOVER §8),
 * because reaching it pulls in the DB client. Every other sibling
 * (`approvals-list.ts`, `purchases-list.ts`, `audit-list.ts`) keeps the pure
 * part here.
 *
 * `label` and `statuses` ride on the ENTRY, not in a second map beside the
 * page's markup: a `TAB_LABELS` record and a `where`-building ternary are two
 * more lists that have to agree with this one, and §6a rule 26 is what happens
 * when they stop.
 *
 * "In flight" groups PENDING and RETRYING because to an operator that is one
 * fact — the worker still owes this delivery an attempt. They are two statuses
 * only because of how the last attempt went, which the chip already says.
 */
export const DELIVERY_TABS = [
  // `null`, not a list of all four statuses: an unfiltered query cannot go
  // stale the day a fifth DeliveryStatus is added, whereas an enumeration
  // here would silently hide the new rows from the one tab whose whole job is
  // to hide nothing. The other three enumerate deliberately — a new status
  // belongs in no existing tab until someone decides which.
  { id: "ALL", label: "All", statuses: null },
  { id: "DEAD", label: "Dead-lettered", statuses: ["DEAD"] },
  { id: "PENDING", label: "In flight", statuses: ["PENDING", "RETRYING"] },
  { id: "DELIVERED", label: "Delivered", statuses: ["DELIVERED"] },
] as const satisfies readonly {
  id: string;
  label: string;
  statuses: readonly DeliveryStatus[] | null;
}[];

export type DeliveryTab = (typeof DELIVERY_TABS)[number]["id"];

/**
 * `null | undefined` as well as `string`, matching `parseReservationTab`:
 * `searchParams` hands back `undefined` for an absent key and
 * `URLSearchParams.get` hands back `null`, and a parser that only accepts one
 * of those is a cast waiting to happen at the other call site.
 */
export function parseDeliveryTab(raw: string | null | undefined): DeliveryTab {
  return (DELIVERY_TABS.some((t) => t.id === raw) ? raw : "ALL") as DeliveryTab;
}
