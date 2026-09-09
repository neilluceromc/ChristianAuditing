import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { STOCK_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { STOCK_LIST_CONFIG } from "@/lib/stock-list";
import { parseListState } from "@/lib/url-state";
import { stockExportRows } from "@/server/modules/stock/queries";

/** Spec §5.4: same shape as the asset/employee exports — refuse over EXPORT_CAP before loading rows. */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, STOCK_LIST_CONFIG);

  const result = await stockExportRows(state);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(STOCK_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("stock-items", new Date()), buffer);
}
