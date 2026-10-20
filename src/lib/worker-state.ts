/**
 * Cloud staging (spec §4.3): whether this process is inside `runTicks` right now. `kickWorker()` reads it so a job
 * that queues another job (executeApproval emitting a webhook) never starts a nested tick from inside a tick.
 *
 * No imports, on purpose: both `src/worker/run.ts` and `src/server/worker-kick.ts` use it, and `run.ts` already
 * reaches `worker-kick.ts` through execute-approval → emit, so anything heavier here would risk a cycle.
 */
let ticking = false;

export function isTicking(): boolean {
  return ticking;
}

export function setTicking(v: boolean): void {
  ticking = v;
}
