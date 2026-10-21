import type { AssetClass, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { lineProgress } from "@/lib/po-flow";

/**
 * Task 7 (carried from Task 5): what Purchasing has to register. A PO in READY or WITH_IT, not completed, with at
 * least one line Purchasing may register (canRegisterLine: a non-IT line, or an old unit with no category, whose class
 * is picked at Register) that still has units left. A mixed PO waiting on IT's check is in it as soon as its chairs
 * can be registered — the READY tab alone hid those. One read for the nav count, the /purchases?register=1 view, the
 * Home tile and its snapshot (pr.itReviewed), so they cannot disagree.
 */

/** The candidates: everything but the units left, which no Prisma filter can compare (qty − registered − closed short). */
export const TO_REGISTER_CANDIDATES: Prisma.PurchaseOrderWhereInput = {
  state: { in: ["READY", "WITH_IT"] },
  completedAt: null,
  lines: { some: { OR: [{ categoryId: null }, { category: { cls: "PURCHASING" } }] } },
};

export interface ToRegisterLine {
  qty: number;
  closedShort: number;
  category: { cls: AssetClass } | null;
  _count: { assets: number };
}

/** A line Purchasing may register (not IT gear) with units left on it. */
export function purchasingCanRegister(line: ToRegisterLine): boolean {
  if (line.category?.cls === "IT") return false;
  return lineProgress({ qty: line.qty, registered: line._count.assets, closedShort: line.closedShort }).remaining > 0;
}

/** The ids of the POs Purchasing has something to register on. */
export async function purchasingToRegisterIds(): Promise<string[]> {
  const pos = await prisma.purchaseOrder.findMany({
    where: TO_REGISTER_CANDIDATES,
    select: {
      id: true,
      lines: { select: { qty: true, closedShort: true, category: { select: { cls: true } }, _count: { select: { assets: true } } } },
    },
  });
  return pos.filter((p) => p.lines.some(purchasingCanRegister)).map((p) => p.id);
}

export async function purchasingToRegisterCount(): Promise<number> {
  return (await purchasingToRegisterIds()).length;
}
