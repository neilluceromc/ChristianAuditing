import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EMPLOYEE_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, selectionRefusal, xlsxResponse } from "@/server/export/respond";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { BULK_MAX } from "@/lib/inventory-list";
import { parseIdsParam, parseListState } from "@/lib/url-state";
import { employeeExportRows } from "@/server/modules/employees/queries";

/**
 * Honours exactly what `/employees` shows, including "Policy gaps only" —
 * that filter's cut can't be expressed in SQL (it needs loadout resolution
 * per employee, see `employeeExportRows`), so this calls the same helper the
 * page's `listEmployees` does rather than re-deriving the cut here. Getting
 * this wrong once already shipped a sheet that silently ignored `gaps=1`.
 * A non-empty `ids` (the bulk bar's Export) replaces all of that: exactly those people, overriding the search,
 * facets, `gaps=1` and the leavers-hidden default (an offboarded person who is ticked is exported), in the
 * list's sort; over BULK_MAX distinct ids is refused with `selectionRefusal`.
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
  if (idsParam === "over") return selectionRefusal(BULK_MAX, "people");
  const state = parseListState(url.searchParams, EMPLOYEES_LIST_CONFIG);
  const gapsOnly = url.searchParams.get("gaps") === "1";

  const result = await employeeExportRows(state, gapsOnly, idsParam.length ? idsParam : undefined);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(EMPLOYEE_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("employees", new Date()), buffer);
}
