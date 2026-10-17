import { prisma } from "../server/db/client";
import { PRUNE_BATCH, crisConversationCutoff, crisPendingCutoff, retentionCutoff } from "../lib/retention";

export interface PruneResult { deliveries: number; jobs: number; crisConversations: number; crisPending: number }

/**
 * One full pass, in id batches: finished deliveries and jobs older than the cutoff, and (Phase 41, spec §7) Cris
 * chats untouched for 30 days (their messages cascade) and Cris pending actions older than a day.
 */
export async function pruneRetention(now: Date = new Date()): Promise<PruneResult> {
  const cutoff = retentionCutoff(now);
  // Predicate repeated in the delete (final review I-1): a Replay between select and delete revives a DEAD row — it must survive.
  const deliveries = await pruneTable(
    () => prisma.webhookDelivery.findMany({ where: { status: { in: ["DELIVERED", "DEAD"] }, createdAt: { lt: cutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.webhookDelivery.deleteMany({ where: { id: { in: ids }, status: { in: ["DELIVERED", "DEAD"] }, createdAt: { lt: cutoff } } }),
  );
  const jobs = await pruneTable(
    () => prisma.job.findMany({ where: { status: { in: ["DONE", "DEAD"] }, updatedAt: { lt: cutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.job.deleteMany({ where: { id: { in: ids }, status: { in: ["DONE", "DEAD"] }, updatedAt: { lt: cutoff } } }),
  );
  // Predicate repeated in the delete: a chat written to between select and delete bumped its updatedAt — it stays.
  const chatCutoff = crisConversationCutoff(now);
  const crisConversations = await pruneTable(
    () => prisma.crisConversation.findMany({ where: { updatedAt: { lt: chatCutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.crisConversation.deleteMany({ where: { id: { in: ids }, updatedAt: { lt: chatCutoff } } }),
  );
  // Pending actions expire after 10 minutes and Undo lasts 60 s: a day-old one is never read again.
  const pendingCutoff = crisPendingCutoff(now);
  const crisPending = await pruneTable(
    () => prisma.crisPendingAction.findMany({ where: { createdAt: { lt: pendingCutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.crisPendingAction.deleteMany({ where: { id: { in: ids }, createdAt: { lt: pendingCutoff } } }),
  );
  return { deliveries, jobs, crisConversations, crisPending };
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
