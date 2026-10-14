import type { AssetClass, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { groupLabelQueue, type QueueGroup } from "@/lib/label-queue";

/**
 * Ruling R20: the Labels tab's scope — every asset in a class this role
 * manages, plus any asset whose purchase record this user created (Purchasing
 * prints the IT laptop it just registered, but not IT's own batches). The ONE
 * definition: the queue, the badge, the sheet's pick/just/ids/tags resolution
 * and markLabelsPrinted all AND this in.
 */
export function labelScope(classes: readonly AssetClass[], userId: string): Prisma.AssetWhereInput {
  return { OR: [{ cls: { in: [...classes] } }, { purchaseRecord: { createdById: userId } }] };
}

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
