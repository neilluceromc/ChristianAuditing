import { requireRole } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EXPORT_CAP, FINANCE_ASSETS_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { parseFinanceListState } from "@/lib/finance-list";
import { financeExportRows } from "@/server/modules/finance/queries";

/**
 * Phase 47 (Task 3 review): exactly the rows Finance → Assets shows, every page and in its order — the list's own URL
 * state (cls, category incl. "other", status, fin, q, life, sort) through the list's own parser and query.
 */
export async function GET(req: Request) {
  await requireRole("admin", "finance_staff");
  const now = new Date();
  const rows = await financeExportRows(parseFinanceListState(new URL(req.url).searchParams), now);
  if (rows.length > EXPORT_CAP) return capRefusal(rows.length);

  const buffer = await toXlsxBuffer(FINANCE_ASSETS_EXPORT_COLUMNS, rows);
  return xlsxResponse(exportFilename("finance-assets", now), buffer);
}
