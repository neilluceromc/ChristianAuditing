import type { Prisma } from "@prisma/client";
import { poSendBackUndoCheck, UNDO_WINDOW_MS, type PoSendBackUndoCheck } from "@/lib/finance-undo";

/*
 * Task 6 fix round 1 (spec §5: Undo covers the new send-backs, one action each): what an undo of a PO's send-back
 * reads — the PO, its own audit trail, its assets and theirs — and the verdict (poSendBackUndoCheck). The server
 * action reads it inside its transaction under the PO row's lock; the PO page and the group page read it for the
 * banner, which is only a hint. A plain module: it takes a client, so it can't live in a "use server" file.
 */

const ENTRY_SELECT = {
  id: true, actorId: true, actorLabel: true, entityType: true, entityId: true, action: true, diff: true, createdAt: true,
} as const;

export const UNDO_ASSET_SELECT = {
  id: true, tag: true, financeConfirmedAt: true, financeNotCapitalised: true, financeReturnedAt: true, financeReturnFields: true,
} as const;

export async function readPoSendBackUndo(client: Prisma.TransactionClient, poId: string, userId: string, now: Date) {
  const po = await client.purchaseOrder.findUnique({ where: { id: poId }, select: { id: true, refNo: true, state: true } });
  if (!po) return null;
  const poEntries = await client.auditEntry.findMany({
    // Readers accept the old entity type too, so the trail keeps what was written before migration 38.
    where: { entityType: { in: ["purchase-order", "purchase-request"] }, entityId: poId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: ENTRY_SELECT,
  });
  const assets = await client.asset.findMany({ where: { purchaseOrderId: poId }, select: UNDO_ASSET_SELECT });
  const assetEntries = assets.length === 0 ? [] : await client.auditEntry.findMany({
    where: { entityType: "asset", entityId: { in: assets.map((a) => a.id) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 2000,
    select: ENTRY_SELECT,
  });
  const check: PoSendBackUndoCheck = poSendBackUndoCheck(po, poEntries, assets, assetEntries, userId, now);
  return { po, assets, check };
}

/** The PO page's and the group page's banner: "You sent PO-0214 back to Purchasing at 10:42 · Undo", or null. */
export async function poSendBackUndoBanner(
  client: Prisma.TransactionClient, poId: string, userId: string, now: Date,
): Promise<{ label: string; msLeft: number; endsAt: number } | null> {
  const read = await readPoSendBackUndo(client, poId, userId, now);
  if (!read || !read.check.ok) return null;
  const endsAt = read.check.at.getTime() + UNDO_WINDOW_MS;
  return { label: read.check.label, endsAt, msLeft: endsAt - now.getTime() };
}
