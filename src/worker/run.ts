import { prisma } from "../server/db/client";
import { executeApproval } from "./execute-approval";
import { deliverWebhook, PermanentDeliveryError } from "./deliver-webhook";
import { MAX_JOB_ATTEMPTS } from "../lib/jobs";
import { pruneRetention } from "./retention";
import { METRIC_SNAPSHOT_DAYS, RETENTION_DAYS } from "../lib/retention";
import { expireHolds } from "./holds";
import { writeSnapshot } from "../server/modules/metrics/snapshot";
import { manilaDay } from "../lib/snapshot";
import { setTicking } from "../lib/worker-state";

/**
 * Cloud staging (spec §4.3): the worker's steps, shared by three callers — the long-running loop in `./index.ts`
 * (dev, e2e, the laptop), the cron routes under `src/app/api/worker/`, and `kickWorker()` on Vercel. None of them
 * keeps state here: the loop's schedule (`last*`) stays in `index.ts`, and the routes ask the database instead.
 */

const STALE_MS = 5 * 60_000;

interface LeasedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/** One atomic statement: pick, lock, lease. SKIP LOCKED makes concurrent workers safe. */
async function leaseNext(workerId: string): Promise<LeasedJob | null> {
  const rows = await prisma.$queryRaw<LeasedJob[]>`
    UPDATE "Job"
    SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
        attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts`;
  return rows[0] ?? null;
}

/** A crashed worker never strands a job: stale RUNNING leases return to PENDING. Returns how many were recovered. */
export async function recoverStale(): Promise<number> {
  const recovered = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
  if (recovered.count > 0) console.log(`[worker] recovered ${recovered.count} stale lease(s)`);
  return recovered.count;
}

async function handle(job: LeasedJob): Promise<void> {
  if (job.type === "EXECUTE_APPROVAL") {
    const approvalId = String((job.payload as { approvalId?: unknown } | null)?.approvalId ?? "");
    if (!approvalId) throw new Error("EXECUTE_APPROVAL job has no approvalId");
    await executeApproval(approvalId);
    return;
  }
  if (job.type === "DELIVER_WEBHOOK") {
    // Job_deliver_payload_shape (Task 9's migration) makes a job without this
    // key impossible to insert, so this throw is a belt-and-braces check on a
    // row that predates the constraint — not the guard the invariant rests on.
    const deliveryId = String((job.payload as { deliveryId?: unknown } | null)?.deliveryId ?? "");
    if (!deliveryId) throw new Error("DELIVER_WEBHOOK job has no deliveryId");
    await deliverWebhook(deliveryId, job.attempts);
    return;
  }
  throw new Error(`Unknown job type ${job.type}`);
}

/** Leases and works one job. False when no job was due; a job whose handler throws is retried or DEAD, never rethrown. */
export async function tick(workerId: string): Promise<boolean> {
  const job = await leaseNext(workerId);
  if (!job) return false;
  try {
    await handle(job);
    // handle() may have terminal-ized the job itself (DEAD) — only close RUNNING ones.
    await prisma.job.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "DONE" } });
    console.log(`[worker] ${job.type} ${job.id} done`);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    // A 404, a disabled endpoint, an undecryptable secret or a vanished
    // delivery row cannot succeed on attempt five either — dead-letter it now
    // rather than spending the budget to reach the same answer four failures
    // later. The delivery row is already DEAD in that case (deliver-webhook.ts
    // marks it before throwing, which is what `permanent()` exists to
    // guarantee), so the ledger and the job agree without a second write.
    const dead = job.attempts >= MAX_JOB_ATTEMPTS || err instanceof PermanentDeliveryError;
    await prisma.job.update({
      where: { id: job.id },
      data: dead
        ? { status: "DEAD", lastError: message }
        : {
            status: "PENDING",
            lastError: message,
            lockedAt: null,
            lockedBy: null,
            runAt: new Date(Date.now() + 2 ** job.attempts * 30_000),
          },
    });
    console.error(`[worker] ${job.type} ${job.id} ${dead ? "DEAD" : "retrying"}: ${message}`);
  }
  return true;
}

/**
 * Works jobs until none is due or `budgetMs` is spent (checked before each job, so one job may run past it — the
 * route's maxDuration leaves the headroom). `done` counts jobs worked, retried and dead-lettered alike. The
 * ticking flag is set for the whole run so a kick from inside a job never nests a second run.
 */
export async function runTicks(opts: {
  workerId: string;
  budgetMs: number;
  now?: () => number;
}): Promise<{ done: number; budgetHit: boolean }> {
  const now = opts.now ?? Date.now;
  setTicking(true);
  try {
    const start = now();
    let done = 0;
    for (;;) {
      if (now() - start >= opts.budgetMs) return { done, budgetHit: true };
      if (!(await tick(opts.workerId))) return { done, budgetHit: false };
      done++;
    }
  } finally {
    setTicking(false);
  }
}

/** Phase 24 (spec §5.3): retention runs at start and hourly; a failure is logged and never stops job processing. */
export async function safePrune(): Promise<void> {
  try {
    const r = await pruneRetention();
    if (r.deliveries || r.jobs) {
      console.log(`[worker] pruned ${r.deliveries} deliver${r.deliveries === 1 ? "y" : "ies"}, ${r.jobs} job${r.jobs === 1 ? "" : "s"} older than ${RETENTION_DAYS} days`);
    }
    if (r.crisConversations || r.crisPending) {
      console.log(`[worker] pruned ${r.crisConversations} Cris chat${r.crisConversations === 1 ? "" : "s"}, ${r.crisPending} Cris pending action${r.crisPending === 1 ? "" : "s"}`);
    }
    if (r.metricSnapshots) {
      console.log(`[worker] pruned ${r.metricSnapshots} metric snapshot${r.metricSnapshots === 1 ? "" : "s"} older than ${METRIC_SNAPSHOT_DAYS} days`);
    }
  } catch (err) {
    console.error(`[worker] prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Phase 26 (spec §4.3): holds expire at start and hourly; a failure is logged and never stops job processing. */
export async function safeExpire(): Promise<void> {
  try {
    const n = await expireHolds();
    if (n) console.log(`[worker] expired ${n} hold${n === 1 ? "" : "s"}`);
  } catch (err) {
    console.error(`[worker] hold sweep failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Phase 46 (spec §2.3): writes `now`'s MetricSnapshot. True on success; a failure is logged and returns false, and
 * never stops job processing. The caller decides when to retry (the loop: snapshotAttemptDue; the maintenance
 * route: snapshotMissing on its next hourly run).
 */
export async function safeSnapshot(now: Date): Promise<boolean> {
  try {
    await writeSnapshot(now);
    console.log(`[worker] metric snapshot written for ${manilaDay(now)}`);
    return true;
  } catch (err) {
    console.error(`[worker] metric snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** True when no MetricSnapshot row exists for `now`'s Manila day — asked of the database, not of process memory. */
export async function snapshotMissing(now: Date): Promise<boolean> {
  const row = await prisma.metricSnapshot.findFirst({
    where: { day: new Date(manilaDay(now) + "T00:00:00Z") },
    select: { id: true },
  });
  return row === null;
}
