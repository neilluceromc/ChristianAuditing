import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EMPLOYEE_EXPORT_COLUMNS, EXPORT_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { parseListState } from "@/lib/url-state";
import { employeeExportRows } from "@/server/modules/employees/queries";

/**
 * Honours exactly what `/employees` shows, including "Policy gaps only" —
 * that filter's cut can't be expressed in SQL (it needs loadout resolution
 * per employee, see `employeeExportRows`), so this calls the same helper the
 * page's `listEmployees` does rather than re-deriving the cut here. Getting
 * this wrong once already shipped a sheet that silently ignored `gaps=1`.
 */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, EMPLOYEES_LIST_CONFIG);
  const gapsOnly = url.searchParams.get("gaps") === "1";

  const rows = await employeeExportRows(state, gapsOnly);
  if (rows.length > EXPORT_CAP) return capRefusal(rows.length);

  const buffer = await toXlsxBuffer(EMPLOYEE_EXPORT_COLUMNS, rows);
  return xlsxResponse(exportFilename("employees", new Date()), buffer);
}
