import { revalidatePath } from "next/cache";

/**
 * Every page that derives something from the stock ledger, in one place.
 * Phase 22's final review found the same omission three times over — a
 * writer that refreshed the list and the item page but not the reports
 * (movement actions and stocktake posting in R6, the importer's opening
 * stock in the final review) — so the paths live here and every stock writer
 * calls this instead of listing them itself.
 *
 * `itemId` given → that item's page; omitted (a stocktake posting, an import
 * apply — many items at once) → the dynamic-segment form, which revalidates
 * every `/stock/items/[id]` page in one call.
 */
export function revalidateStockReads(itemId?: string) {
  revalidatePath("/stock");
  if (itemId) revalidatePath(`/stock/items/${itemId}`);
  else revalidatePath("/stock/items/[id]", "page");
  revalidatePath("/audit");
  revalidatePath("/stock/reports/on-hand");
  revalidatePath("/stock/reports/consumption");
  revalidatePath("/stock/reports/expiry");
}
