import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { dayFromISO } from "@/lib/deadlines";
import { manilaDay, SNAPSHOT_KEYS, type SnapshotKey } from "@/lib/snapshot";
import { toCentavos } from "@/lib/depreciation";
import { tabWhere } from "@/lib/approvals-list";
import type { ApprovalClassKey } from "@/lib/approval-access";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { parseListState } from "@/lib/url-state";
import { inventoryTileCounts } from "@/server/modules/inventory/queries";
import { stateCounts } from "@/server/modules/purchases/queries";
import { stockHomeSignals } from "@/server/modules/stock/queries";
import { financeViewWhere } from "@/server/modules/finance/queries";
import { bookValueTotals } from "@/server/modules/finance/depreciation-queries";
import { adminHome } from "@/server/modules/admin/queries";
import { financeWaitingRows, unitsValue } from "@/server/modules/home/queries";

/**
 * Spec §2.2 ruling: approvals are stored per class. The three fragments split every approval exactly once (an
 * approval with an asset has that asset's class; one without has none), so summing the classes approvalClassWhere
 * gives a role reproduces that role's Approvals count.
 */
const APPROVAL_CLASS: Record<ApprovalClassKey, Prisma.ApprovalWhereInput> = {
  it: { asset: { cls: "IT" } },
  purchasing: { asset: { cls: "PURCHASING" } },
  none: { assetId: null },
};

const big = (n: number) => BigInt(Math.round(n));

/**
 * Today's value of every key, each read through the helper its live number comes from (spec §2.2), so a snapshot
 * and the live tile cannot disagree. Unlike the nav counts, nothing here fails to 0: a failed read throws, and the
 * worker retries the whole snapshot rather than storing a made-up 0.
 */
export async function collectSnapshot(now: Date): Promise<Record<SnapshotKey, bigint>> {
  const today = manilaDay(now);
  // The Approvals page's Open tab (tabWhere "open"), per class; past SLA is the nav badge's red (slaAt < now).
  const open = tabWhere("open", "");
  const approvalCount = (cls: keyof typeof APPROVAL_CLASS, pastSla: boolean) =>
    prisma.approval.count({
      where: { AND: [open, APPROVAL_CLASS[cls], pastSla ? { slaAt: { lt: now } } : {}] },
    });
  // /finance/assets?fin=with-finance (and &cls=PURCHASING): the page's own "To review" chip predicate.
  const toConfirm = (cls: "IT" | "PURCHASING") =>
    prisma.asset.count({ where: financeViewWhere(cls, "with-finance") });

  const [
    tiles, openIt, openPurchasing, openNone, pastIt, pastPurchasing, pastNone,
    prStates, stock, waiting, toConfirmIt, toConfirmPurchasing, book, admin,
  ] = await Promise.all([
    // /inventory's IT tiles with nothing else filtered: each tile's count is what `?status=…` / `?attention=1` lists.
    inventoryTileCounts(parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG), null, "IT", now),
    approvalCount("it", false), approvalCount("purchasing", false), approvalCount("none", false),
    approvalCount("it", true), approvalCount("purchasing", true), approvalCount("none", true),
    stateCounts(),
    stockHomeSignals(today),
    financeWaitingRows(),
    toConfirm("IT"), toConfirm("PURCHASING"),
    bookValueTotals({}, now),
    adminHome(),
  ]);

  const waitingPesos = waiting.reduce((sum, r) => sum + unitsValue(r.units), 0);
  const values: Record<SnapshotKey, number> = {
    "it.spare": tiles["in-stock"] ?? 0,
    "it.deployed": tiles["deployed"] ?? 0,
    "it.defective": tiles["in-repair"] ?? 0,
    "it.missing": tiles["missing"] ?? 0,
    "it.attention": tiles["attention"] ?? 0,
    "approvals.open.it": openIt,
    "approvals.open.purchasing": openPurchasing,
    "approvals.open.none": openNone,
    "approvals.pastSla.it": pastIt,
    "approvals.pastSla.purchasing": pastPurchasing,
    "approvals.pastSla.none": pastNone,
    "pr.submitted": prStates.SUBMITTED ?? 0,
    "pr.itReviewed": prStates.IT_REVIEWED ?? 0,
    "stock.low": stock.low,
    "stock.expiringLots": stock.expiringLots,
    "stock.stocktakesOverdue": stock.stocktakesOverdue,
    "fin.waitingC": toCentavos(waitingPesos) ?? 0,
    "fin.waitingCount": waiting.length,
    "fin.toConfirm.it": toConfirmIt,
    "fin.toConfirm.purchasing": toConfirmPurchasing,
    "fin.bookC": book.bookC,
    "admin.activeUsers": admin.users.total - admin.users.disabled,
    "admin.disabled": admin.users.disabled,
    "admin.deadDeliveries": admin.webhooks.dead,
  };
  return Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, big(values[k])])) as Record<SnapshotKey, bigint>;
}

/**
 * Spec §2.3: upsert today's (Manila) row for every key, in one transaction, so a day is written whole or not at all.
 * Idempotent: a second run on the same day (a restart) overwrites the values, never adds rows.
 */
export async function writeSnapshot(now: Date): Promise<void> {
  const values = await collectSnapshot(now);
  const day = dayFromISO(manilaDay(now));
  await prisma.$transaction(
    SNAPSHOT_KEYS.map((key) =>
      prisma.metricSnapshot.upsert({
        where: { day_key: { day, key } },
        create: { day, key, value: values[key] },
        update: { value: values[key] },
      }),
    ),
  );
}
