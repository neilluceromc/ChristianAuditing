import type { AssetClass, Role } from "@prisma/client";
import { canRegisterLine } from "@/lib/po-flow";
import { registerCatalog, type CatalogCategory } from "@/server/modules/inventory/register-queries";
import type { PoRegisterLine } from "@/components/purchases/po-register-form";
import type { PurchaseDetail } from "./queries";

/**
 * The PO register page's model (spec §4 ways 1–2): the lines with units left, each with why this person can't
 * register it (or null), and the category catalog.
 *
 * The catalog holds the confirmed categories of the classes this person may register (what a legacy line's category
 * is picked from) plus every line's own category, confirmed or not. A line whose category is new IT gear from the PO
 * form (spec §5b.5) still gets its types and known models, and the type check matches the server's. The "choose
 * another" options are the confirmed IT entries only (`confirmed` on each entry).
 */
export async function poRegisterModel(po: PurchaseDetail, role: Role): Promise<{ lines: PoRegisterLine[]; catalog: CatalogCategory[] }> {
  const classes = (["IT", "PURCHASING"] as AssetClass[]).filter((c) => canRegisterLine(role, c, po.state).ok);
  const own = [...new Set(po.units.flatMap((u) => (u.categoryId ? [u.categoryId] : [])))];
  const catalog = await registerCatalog(classes, own);

  const lines: PoRegisterLine[] = po.units
    .filter((u) => u.remaining > 0)
    .map((u) => {
      const verdict = u.cls
        ? canRegisterLine(role, u.cls, po.state)
        : classes.length > 0 ? { ok: true as const } : canRegisterLine(role, "IT", po.state);
      return {
        id: u.id, index: u.index, description: u.description, specs: u.specs,
        categoryId: u.categoryId, categoryName: u.categoryName, cls: u.cls,
        categoryConfirmed: u.categoryConfirmed, registered: u.registered,
        price: u.price, remaining: u.remaining, progressLabel: u.progressLabel,
        blocked: verdict.ok ? null : verdict.why,
      };
    });
  return { lines, catalog };
}
