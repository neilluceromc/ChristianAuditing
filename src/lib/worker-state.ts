/**
 * Cloud staging (spec §4.3): whether this process is inside `runTicks` right now. `kickWorker()` reads it so a job
 * that queues another job (executeApproval emitting a webhook) never starts a nested tick from inside a tick.
 *
 * A depth counter, not a boolean: with Fluid compute a cron tick and a kick can run `runTicks` at the same time
 * on one instance, and the first to finish must not clear the flag while the other is still working.
 *
 * No imports, on purpose: both `src/worker/run.ts` and `src/server/worker-kick.ts` use it, and `run.ts` already
 * reaches `worker-kick.ts` through execute-approval → emit, so anything heavier here would risk a cycle.
 */
let ticking = 0;

export function isTicking(): boolean {
  return ticking > 0;
}

/** `true` enters a run (count + 1); `false` leaves one (count - 1, never below 0). */
export function setTicking(v: boolean): void {
  ticking = v ? ticking + 1 : Math.max(0, ticking - 1);
}
