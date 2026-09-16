import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { CONSUMPTION_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { STOCK_REPORT_LIST_CONFIG, parseReportRange } from "@/lib/stock-reports";
import { parseListState } from "@/lib/url-state";
import { localDateISO } from "@/lib/format";
import { consumptionExportRows } from "@/server/modules/stock/report-queries";

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, STOCK_REPORT_LIST_CONFIG);
  const range = parseReportRange(url.searchParams, localDateISO());

  const result = await consumptionExportRows(range, state);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(CONSUMPTION_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("stock-consumption", new Date()), buffer);
}
