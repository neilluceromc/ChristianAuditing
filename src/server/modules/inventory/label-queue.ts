import type { AssetClass } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { groupLabelQueue, type QueueGroup } from "@/lib/label-queue";

const WAITING = (classes: AssetClass[]) => ({ cls: { in: classes }, labelPrintedAt: null });

/** Phase 34 (spec §5): the newest `limitGroups` batches with labels not yet printed, in the given classes. */
export async function labelQueue(classes: AssetClass[], limitGroups = 50): Promise<{ groups: QueueGroup[]; more: boolean }> {
  if (classes.length === 0) return { groups: [], more: false };
  const rows = await prisma.asset.findMany({
    where: WAITING(classes),
    select: { id: true, tag: true, model: true, purchaseRecordId: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 2000,
  });
  const groups = groupLabelQueue(rows);
  return { groups: groups.slice(0, limitGroups), more: groups.length > limitGroups };
}

export async function queueCount(classes: AssetClass[]): Promise<number> {
  if (classes.length === 0) return 0;
  return prisma.asset.count({ where: WAITING(classes) });
}
