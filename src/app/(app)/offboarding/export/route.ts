import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { OFFBOARDING_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { OFFBOARDING_LIST_CONFIG } from "@/lib/offboarding-list";
import { parseListState } from "@/lib/url-state";
import { offboardingExportRows } from "@/server/modules/offboarding/queries";

/** Phase 25 (spec §6.5): honours exactly what `/offboarding` shows — facets and sort — same shape as the employees export. */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const state = parseListState(url.searchParams, OFFBOARDING_LIST_CONFIG);

  const result = await offboardingExportRows(state);
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(OFFBOARDING_EXPORT_COLUMNS, result.rows);
  return xlsxResponse(exportFilename("offboarding", new Date()), buffer);
}
