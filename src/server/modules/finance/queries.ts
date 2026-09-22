import { Prisma, type AssetClass, type AssetStatus } from "@prisma/client";
import { pagedSnapshot } from "@/server/paged";
import { fmtDate, fmtMoney } from "@/lib/format";
import { isStatusOf } from "@/lib/asset-class";
import { ageBucket } from "@/lib/home";
import { ENTITY_PAGE_SIZE } from "@/lib/paging";
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
  // The aggregate must read the same snapshot as the count, so it runs
  // inside pagedSnapshot's transaction alongside the page's own findMany —
  // captured via closure since the helper's `rows` callback returns T[].
  let costSum = 0;
  const { rows: assets, ...pg } = await pagedSnapshot(
    ENTITY_PAGE_SIZE,
    page,
    (tx) => tx.asset.count({ where }),
    async (tx, pg) => {
      const [rows, sum] = await Promise.all([
        tx.asset.findMany({
          where,
          orderBy: [{ cost: "desc" }, { tag: "asc" }, { id: "asc" }],
          skip: pg.skip,
          take: pg.take,
          // provenanceOf() below needs purchaseRequestId + importedAt — an include keeps every scalar; do not narrow to select without adding them.
          include: { category: true, assignee: true },
        }),
        tx.asset.aggregate({ where, _sum: { cost: true } }),
      ]);
      costSum = sum._sum.cost === null ? 0 : Number(sum._sum.cost);
      return rows;
    },
  );

  return {
    total: pg.total,
    page: pg.page,
    pageCount: pg.pageCount,
    // Decimal never leaves this module
    totalCost: fmtMoney(costSum),
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
