import type { AssetClass } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { mergeKnownModels, type KnownModel } from "@/lib/known-models";
import { orderCategories, STOCK_STATUS } from "@/lib/register-catalog";

export interface CatalogCategory {
  id: string; name: string; cls: AssetClass; tagPrefix: string | null; inStock: number;
  types: Array<{ id: string; name: string }>; models: KnownModel[];
}

/** Phase 34 (spec §4.1-4.2): the Register tab's cards, each with its stock count, types and known models. */
export async function registerCatalog(classes: AssetClass[]): Promise<CatalogCategory[]> {
  const cats = await prisma.assetCategory.findMany({
    where: { cls: { in: classes } },
    select: { id: true, name: true, cls: true, tagPrefix: true, types: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
  const ids = cats.map((c) => c.id);
  const [stock, assets] = await Promise.all([
    prisma.asset.groupBy({ by: ["categoryId", "status"], where: { categoryId: { in: ids } }, _count: { _all: true } }),
    prisma.asset.findMany({
      where: { categoryId: { in: ids } },
      select: { categoryId: true, model: true, typeId: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" }, take: 5000,
    }),
  ]);
  return orderCategories(cats).map((c) => ({
    id: c.id, name: c.name, cls: c.cls, tagPrefix: c.tagPrefix, types: c.types,
    inStock: stock.filter((s) => s.categoryId === c.id && s.status === STOCK_STATUS[c.cls]).reduce((n, s) => n + s._count._all, 0),
    models: mergeKnownModels(
      assets.filter((a) => a.categoryId === c.id)
        .map((a) => ({ model: a.model, typeId: a.typeId, createdAt: a.createdAt, inStock: a.status === STOCK_STATUS[c.cls] })),
    ).slice(0, 200),
  }));
}

/** Phase 36 (spec §3.1, plan P-4): a category with types needs one picked; no model ever supplies it. */
export async function typeRequired(categoryId: string, typeId: string | undefined): Promise<boolean> {
  if (typeId) return false;
  return (await prisma.assetType.count({ where: { categoryId } })) > 0;
}
