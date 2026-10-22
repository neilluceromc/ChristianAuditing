import type { AssetClass } from "@prisma/client";
import { prisma } from "@/server/db/client";

export interface PoCategoryOption {
  id: string;
  name: string;
  cls: AssetClass;
  /** False for IT gear Purchasing created from a PO that IT hasn't confirmed yet ("New · IT confirms"). */
  confirmed: boolean;
}

/**
 * PO form redesign (spec §5b.6): the PO form's category picker. Unlike direct Register and the asset forms, it lists
 * unconfirmed categories too, so another PO reuses "Network cable" instead of creating a near-duplicate.
 * IT gear first, then office items; by name within each.
 */
export async function poCategories(): Promise<PoCategoryOption[]> {
  const rows = await prisma.assetCategory.findMany({
    select: { id: true, name: true, cls: true, confirmedAt: true },
    orderBy: [{ cls: "asc" }, { name: "asc" }],
  });
  return rows.map((c) => ({ id: c.id, name: c.name, cls: c.cls, confirmed: c.confirmedAt !== null }));
}
