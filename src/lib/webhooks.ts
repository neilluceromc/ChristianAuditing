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
