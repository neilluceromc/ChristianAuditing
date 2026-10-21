import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

/*
 * Task 6: what the group actions (group-actions.ts, and undo-actions.ts's undo and reopen) share. A plain module —
 * a "use server" file may export only async server actions, and these take a transaction client.
 */

/** A group asset's review columns: what approve, send back, undo and reopen read. */
export const GROUP_ASSET_SELECT = {
  id: true, tag: true, cls: true, cost: true, itVerifiedAt: true, purchaseRecordId: true,
  financeConfirmedAt: true, financeConfirmedById: true, financeNotCapitalised: true,
  financeReturnedAt: true, financeReturnedTo: true, financeReturnFields: true, financeResubmitNote: true,
} as const;

/** A guarded write found an asset changed under it: thrown so the whole group action rolls back. */
export class StaleGroupError extends Error {
  constructor(readonly tag: string) {
    super(`stale group asset ${tag}`);
  }
}

/** `SELECT … FOR UPDATE` on every asset row of the registration, held until the transaction ends. */
export async function lockGroupAssets(tx: Prisma.TransactionClient, recordId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "purchaseRecordId" = ${recordId} FOR UPDATE`;
}

export function revalidateGroup(recordId: string, assetIds: readonly string[], poId: string | null) {
  revalidatePath("/finance/review");
  revalidatePath(`/finance/review/${recordId}`);
  revalidatePath("/finance/assets");
  for (const id of assetIds) {
    revalidatePath(`/finance/assets/${id}`);
    revalidatePath(`/inventory/${id}`);
  }
  if (poId) revalidatePath(`/purchases/${poId}`);
}
