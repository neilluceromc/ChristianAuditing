import { prisma } from "../server/db/client";
import { pruneDue } from "../lib/retention";
import { expireDue } from "../lib/holds";
import { manilaDay, snapshotAttemptDue } from "../lib/snapshot";
import { recoverStale, safeExpire, safePrune, safeSnapshot, tick } from "./run";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = 3_000;
const ONCE = process.argv.includes("--once");

let draining = false;
let lastPruneAt: Date | null = null;
let lastExpireAt: Date | null = null;
/** The Manila day of the last snapshot written; null until one succeeds, so a failure retries on the next loop. */
let lastSnapshotDay: string | null = null;
/** When safeSnapshot last ran, success or failure: a failing snapshot retries at most every 10 minutes. */
let lastSnapshotAttemptAt: Date | null = null;

/* The steps live in ./run (cloud staging, spec §4.3), shared with the cron routes and kickWorker(). This loop keeps
   only its own schedule: when each step last ran, so it knows when the next one is due. */

async function prune(): Promise<void> {
  await safePrune();
  lastPruneAt = new Date();
}

async function expire(): Promise<void> {
  await safeExpire();
  lastExpireAt = new Date();
}

/**
 * Phase 46 (spec §2.3): today's MetricSnapshot, at start and on the first loop of each Manila day. A failure leaves
 * lastSnapshotDay alone, so it is retried, at most every 10 minutes (snapshotAttemptDue).
 */
async function snapshot(): Promise<void> {
  const now = new Date();
  if (await safeSnapshot(now)) lastSnapshotDay = manilaDay(now);
  lastSnapshotAttemptAt = new Date();
}

async function main(): Promise<void> {
  console.log(`[worker] ${WORKER_ID} starting${ONCE ? " (--once)" : ""}`);
  await recoverStale();
  await prune();
  await expire();
  await snapshot();
  let cycles = 0;
  for (;;) {
    if (draining) break;
    if (pruneDue(lastPruneAt, new Date())) await prune();
    if (expireDue(lastExpireAt, new Date())) await expire();
    if (snapshotAttemptDue(lastSnapshotDay, lastSnapshotAttemptAt, new Date())) await snapshot();
    const worked = await tick(WORKER_ID);
    if (!worked) {
      if (ONCE) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (++cycles % 10 === 0) await recoverStale();
    }
  }
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} — finishing the current job`);
    draining = true;
  });
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
