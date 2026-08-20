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
