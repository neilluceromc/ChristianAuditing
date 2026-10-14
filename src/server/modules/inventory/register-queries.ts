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

export const NEW_MODEL_TYPE = "Pick the type for this new model";

/**
 * Spec §8 and ruling R26: a new model needs a type when its category has types. True when no type was
 * sent, the category has at least one type, and the model is not a known model of the category whose
 * newest asset carries a type (matched like `resolveModelType`: trimmed, spaces collapsed, any case).
 * A known typed model keeps today's behaviour — accepted without a type.
 */
export async function newModelNeedsType(categoryId: string, model: string, typeId: string | undefined): Promise<boolean> {
  if (typeId) return false;
  if ((await prisma.assetType.count({ where: { categoryId } })) === 0) return false;
  const key = model.trim().replace(/\s+/g, " ").toLowerCase();
  const newest = await prisma.$queryRaw<Array<{ typeId: string | null }>>`
    SELECT "typeId" FROM "Asset"
     WHERE "categoryId" = ${categoryId} AND lower(btrim(regexp_replace("model", '[[:space:]]+', ' ', 'g'))) = ${key}
     ORDER BY "createdAt" DESC LIMIT 1`;
  return !newest[0]?.typeId;
}
