import type { AssetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import { ageBucket } from "@/lib/home";

export const FINANCE_PAGE_SIZE = 25;

export interface FinanceAssetRow {
  id: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  cost: string;
  purchased: string;
  age: string;
  warranty: string;
  assignee: string | null;
}

export function parseAssetStatus(raw: string | null | undefined): AssetStatus | null {
  return (ASSET_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as AssetStatus) : null;
}

/**
 * Capitalized assets: anything with an acquisition cost. Status is shown, not
 * filtered — finance cares that a ₱55,000 laptop currently reads DEFECTIVE.
 * No book-value column: depreciation is a policy nobody has stated, and
 * inventing one would put a number on screen the business never agreed to.
 */
export async function financeAssets(
  status: AssetStatus | null,
  page: number,
  now: Date = new Date(),
): Promise<{ rows: FinanceAssetRow[]; total: number; page: number; pageCount: number; totalCost: string }> {
  const where: Prisma.AssetWhereInput = { cost: { not: null }, ...(status ? { status } : {}) };
  const [total, sum] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.aggregate({ where, _sum: { cost: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / FINANCE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const assets = await prisma.asset.findMany({
    where,
    orderBy: [{ cost: "desc" }, { tag: "asc" }],
    skip: (safePage - 1) * FINANCE_PAGE_SIZE,
    take: FINANCE_PAGE_SIZE,
    include: { category: true, assignee: true },
  });

  return {
    total,
    page: safePage,
    pageCount,
    // Decimal never leaves this module
    totalCost: fmtMoney(sum._sum.cost === null ? 0 : Number(sum._sum.cost)),
    rows: assets.map((a): FinanceAssetRow => ({
      id: a.id,
      tag: a.tag,
      model: a.model,
      category: a.category.name,
      status: a.status,
      cost: fmtMoney(a.cost === null ? 0 : Number(a.cost)),
      purchased: fmtDate(a.purchasedAt),
      age: ageBucket(a.purchasedAt, now) ?? "—",
      warranty: fmtDate(a.warrantyUntil),
      assignee: a.assignee?.name ?? null,
    })),
  };
}
