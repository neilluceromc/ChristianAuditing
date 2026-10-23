import type { Prisma, Role } from "@prisma/client";
import { emitWebhook } from "@/server/webhooks/emit";
import { lineProgress } from "@/lib/po-flow";
import { notify } from "@/server/notifications/notify";

/**
 * Spec §3 / Global Constraints (controller ruling R5): a purchase order is fully approved when every line is registered
 * or closed short AND every asset from it is approved. That moment fires `purchase_order.approved` and the old
 * `purchase_request.completed` side by side, once. Whichever action completes it calls this inside its own
 * transaction, after its writes and under the PO row's lock (lockPo): Finance approving the last assets
 * (approveGroup, confirmAssetDetails) or Purchasing closing the last units short (closeLineShort).
 *
 * Once only: the PO's `completedAt` is stamped by a guarded write (still null), and nothing fires when it already was
 * — a legacy completed order keeps the stamp it was migrated with, and an approval undone and given again does not
 * fire twice. A plain module: it takes a transaction client, so it can't live in a "use server" file.
 *
 * 2026-10-23: that same once-only moment tells Purchasing ("{ref}: Finance approved all its assets", on the PO), by
 * `actor` — so Purchasing closing the last units short itself is not news to Purchasing (notify's own-team rule).
 */
export async function emitIfPoFullyApproved(
  tx: Prisma.TransactionClient,
  poId: string,
  actor: { id: string; role: Role },
): Promise<boolean> {
  const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, select: { id: true, refNo: true, state: true, completedAt: true } });
  if (!po || po.completedAt || po.state === "CANCELLED" || po.state === "SENT_BACK") return false;

  const assets = await tx.asset.findMany({ where: { purchaseOrderId: poId }, select: { purchaseOrderLineId: true, financeConfirmedAt: true } });
  if (assets.length === 0 || assets.some((a) => a.financeConfirmedAt === null)) return false;

  const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: poId }, select: { id: true, qty: true, closedShort: true } });
  const registered = new Map<string, number>();
  for (const a of assets) {
    if (a.purchaseOrderLineId) registered.set(a.purchaseOrderLineId, (registered.get(a.purchaseOrderLineId) ?? 0) + 1);
  }
  const done = lines.every((l) => lineProgress({ qty: l.qty, registered: registered.get(l.id) ?? 0, closedShort: l.closedShort }).remaining === 0);
  if (!done) return false;

  const hit = await tx.purchaseOrder.updateMany({ where: { id: poId, completedAt: null }, data: { completedAt: new Date() } });
  if (hit.count === 0) return false;
  await emitWebhook(tx, "purchase_order.approved", { purchaseOrderId: po.id, refNo: po.refNo });
  await emitWebhook(tx, "purchase_request.completed", { purchaseRequestId: po.id, refNo: po.refNo });
  await notify(tx, {
    team: "PURCHASING", kind: "CHANGED", title: `${po.refNo}: Finance approved all its assets`, href: `/purchases/${po.id}`,
    actorId: actor.id, actorRole: actor.role, entityType: "purchase-order", entityId: po.id,
  });
  return true;
}
