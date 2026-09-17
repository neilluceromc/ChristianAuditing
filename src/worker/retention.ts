import { prisma } from "../server/db/client";
import { PRUNE_BATCH, retentionCutoff } from "../lib/retention";

export interface PruneResult { deliveries: number; jobs: number }

/** One full pass: finished deliveries and jobs older than the cutoff, deleted in id batches. */
export async function pruneRetention(now: Date = new Date()): Promise<PruneResult> {
  const cutoff = retentionCutoff(now);
  const deliveries = await pruneTable(
    () => prisma.webhookDelivery.findMany({ where: { status: { in: ["DELIVERED", "DEAD"] }, createdAt: { lt: cutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.webhookDelivery.deleteMany({ where: { id: { in: ids } } }),
  );
  const jobs = await pruneTable(
    () => prisma.job.findMany({ where: { status: { in: ["DONE", "DEAD"] }, updatedAt: { lt: cutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.job.deleteMany({ where: { id: { in: ids } } }),
  );
  return { deliveries, jobs };
}

async function pruneTable(pick: () => Promise<{ id: string }[]>, drop: (ids: string[]) => Promise<{ count: number }>): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = (await pick()).map((r) => r.id);
    if (ids.length === 0) return total;
    total += (await drop(ids)).count;
    if (ids.length < PRUNE_BATCH) return total;
  }
}
