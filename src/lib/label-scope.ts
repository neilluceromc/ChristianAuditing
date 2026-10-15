import type { AssetClass, Prisma } from "@prisma/client";

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
