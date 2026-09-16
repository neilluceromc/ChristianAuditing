import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EXPIRY_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { STOCK_REPORT_LIST_CONFIG, parseExpiryWindow } from "@/lib/stock-reports";
import { parseListState } from "@/lib/url-state";
import { expiryExportRows } from "@/server/modules/stock/report-queries";

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, STOCK_REPORT_LIST_CONFIG);
  const windowDays = parseExpiryWindow(url.searchParams);

  const result = await expiryExportRows(windowDays, state);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(EXPIRY_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("stock-expiry", new Date()), buffer);
}
