import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { ON_HAND_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { STOCK_REPORT_LIST_CONFIG } from "@/lib/stock-reports";
import { parseListState } from "@/lib/url-state";
import { onHandExportRows } from "@/server/modules/stock/report-queries";

/** Mirrors `/stock/export/route.ts`: requireUser, parse, cap-refuse, buffer, respond. `uncosted` is a real STOCK_REPORT_LIST_CONFIG facet (Task 5 review), so parseListState alone puts it on state.filters. */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, STOCK_REPORT_LIST_CONFIG);

  const result = await onHandExportRows(state);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(ON_HAND_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("stock-on-hand", new Date()), buffer);
}
