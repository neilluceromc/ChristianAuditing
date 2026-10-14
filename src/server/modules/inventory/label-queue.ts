import type { AssetClass, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { groupLabelQueue, type QueueGroup } from "@/lib/label-queue";
import { labelScope } from "@/lib/label-scope";

// Ruling R20: the ONE scope definition lives in a pure lib so it is unit-tested (ruling R26, M9).
export { labelScope } from "@/lib/label-scope";

const WAITING = (classes: readonly AssetClass[], userId: string): Prisma.AssetWhereInput => ({
  ...labelScope(classes, userId), labelPrintedAt: null,
});

/** Phase 34 (spec §5): the newest `limitGroups` batches with labels not yet printed, in the Labels scope (R20). */
export async function labelQueue(
  classes: readonly AssetClass[], userId: string, limitGroups = 50,
): Promise<{ groups: QueueGroup[]; more: boolean }> {
  const rows = await prisma.asset.findMany({
    where: WAITING(classes, userId),
    select: { id: true, tag: true, model: true, purchaseRecordId: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 2000,
  });
  const groups = groupLabelQueue(rows);
  return { groups: groups.slice(0, limitGroups), more: groups.length > limitGroups };
}

export async function queueCount(classes: readonly AssetClass[], userId: string): Promise<number> {
  return prisma.asset.count({ where: WAITING(classes, userId) });
}
