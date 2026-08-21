import { prisma } from "../server/db/client";
import { executeApproval } from "./execute-approval";
import { deliverWebhook, PermanentDeliveryError } from "./deliver-webhook";
import { MAX_JOB_ATTEMPTS } from "../lib/jobs";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = 3_000;
const STALE_MS = 5 * 60_000;
const ONCE = process.argv.includes("--once");

let draining = false;

interface LeasedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/** One atomic statement: pick, lock, lease. SKIP LOCKED makes concurrent workers safe. */
async function leaseNext(): Promise<LeasedJob | null> {
  const rows = await prisma.$queryRaw<LeasedJob[]>`
    UPDATE "Job"
    SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${WORKER_ID},
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

/** A crashed worker never strands a job: stale RUNNING leases return to PENDING. */
async function recoverStale(): Promise<void> {
  const recovered = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
  if (recovered.count > 0) console.log(`[worker] recovered ${recovered.count} stale lease(s)`);
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

async function tick(): Promise<boolean> {
  const job = await leaseNext();
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

async function main(): Promise<void> {
  console.log(`[worker] ${WORKER_ID} starting${ONCE ? " (--once)" : ""}`);
  await recoverStale();
  let cycles = 0;
  for (;;) {
    if (draining) break;
    const worked = await tick();
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
