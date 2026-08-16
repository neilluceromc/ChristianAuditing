import { prisma } from "../server/db/client";
import { executeApproval } from "./execute-approval";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = 3_000;
const STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
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
    // No producer exists until Phase 8 — dead-letter honestly instead of spinning.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "DEAD", lastError: "webhook delivery ships in Phase 8" },
    });
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
    const dead = job.attempts >= MAX_ATTEMPTS;
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
