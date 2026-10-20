import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EMPLOYEE_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { BULK_MAX } from "@/lib/inventory-list";
import { parseIdsParam, parseListState } from "@/lib/url-state";
import { employeeExportRows } from "@/server/modules/employees/queries";

/**
 * Honours exactly what `/employees` shows (or, with a non-empty `ids`, exactly those people), including "Policy gaps only" —
 * that filter's cut can't be expressed in SQL (it needs loadout resolution
 * per employee, see `employeeExportRows`), so this calls the same helper the
 * page's `listEmployees` does rather than re-deriving the cut here. Getting
 * this wrong once already shipped a sheet that silently ignored `gaps=1`.
 * The cap check now lives in `employeeExportRows` itself (same shape as the
 * assets export): it refuses over the cap BEFORE loading any row, so an
 * over-large sheet never gets read from the database just to be discarded.
 */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  // Phase 45 (spec §3.4): an `ids` selection overrides every list filter - those exact people, however the list
  // is filtered. Capped at BULK_MAX (shared with the bulk bar); over it is refused, never sliced.
  const idsParam = parseIdsParam(url.searchParams, BULK_MAX);
  if (idsParam === "over") return capRefusal(url.searchParams.get("ids")!.split(",").filter((s) => s.trim()).length);
  const state = parseListState(url.searchParams, EMPLOYEES_LIST_CONFIG);
  const gapsOnly = url.searchParams.get("gaps") === "1";

  const result = await employeeExportRows(state, gapsOnly, idsParam.length ? idsParam : undefined);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(EMPLOYEE_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("employees", new Date()), buffer);
}
