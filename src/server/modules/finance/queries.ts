import { Prisma, type AssetClass, type AssetStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtDate, fmtMoney } from "@/lib/format";
import { isStatusOf } from "@/lib/asset-class";
import { ageBucket } from "@/lib/home";
import { ENTITY_PAGE_SIZE, pageOf } from "@/lib/paging";
import { PROVENANCE_LABEL, provenanceOf } from "@/lib/provenance";

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
  provenance: string;
}

export function parseAssetStatus(raw: string | null | undefined, cls: AssetClass): AssetStatus | null {
  return raw != null && isStatusOf(cls, raw) ? raw : null;
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
  cls: AssetClass,
  now: Date = new Date(),
): Promise<{ rows: FinanceAssetRow[]; total: number; page: number; pageCount: number; totalCost: string }> {
  // Spec §5.3: Finance sees an IT asset only once IT has checked it. Purchasing
  // rows never carry a stamp and are not gated.
  const where: Prisma.AssetWhereInput = {
    cls, cost: { not: null },
    ...(cls === "IT" ? { itVerifiedAt: { not: null } } : {}),
    ...(status ? { status } : {}),
  };
  const [total, sum] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.aggregate({ where, _sum: { cost: true } }),
  ]);
  const pg = pageOf(total, page, ENTITY_PAGE_SIZE);
  const assets = await prisma.asset.findMany({
    where,
    orderBy: [{ cost: "desc" }, { tag: "asc" }, { id: "asc" }],
    skip: pg.skip,
    take: pg.take,
    include: { category: true, assignee: true },
  });

  return {
    total,
    page: pg.page,
    pageCount: pg.pageCount,
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
      provenance: PROVENANCE_LABEL[provenanceOf(a)],
    })),
  };
}

/**
 * The money trail: everything that happened to a purchase request, plus any
 * asset edit that touched `cost`. The JSON path filter is what makes the second
 * half possible without a new column — if it turns out unsupported, fall back
 * to purchase-request-only and SAY SO rather than shipping a feed that claims
 * to show cost changes it can't see.
 */
export const financeActivityWhere: Prisma.AuditEntryWhereInput = {
  OR: [
    { entityType: "purchase-request" },
    { entityType: "asset", diff: { path: ["cost"], not: Prisma.DbNull } },
  ],
};
