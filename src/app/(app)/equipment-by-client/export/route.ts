import { requireRole } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { equipmentExportColumns, equipmentFilePrefix } from "@/lib/export-columns";
import { canSeeMoney } from "@/lib/equipment-report";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { equipmentExportRows } from "@/server/modules/reports/equipment";

/**
 * Phase 38 (spec §3.5): the Equipment by client sheet, one row per item. The page's four roles; Cost and Book value
 * exist (as columns and as values) only for Finance and Admin. `?tab=internal` or the client default, and an optional
 * `?group=<id>` for one group of that tab — an unknown, ended or other-tab id is a 404, not an empty sheet.
 */
export async function GET(req: Request) {
  const user = await requireRole("admin", "it_staff", "finance_staff", "viewer");
  const withMoney = canSeeMoney(user.role);
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("tab") === "internal" ? "INTERNAL" : "CLIENT";
  const groupId = sp.get("group") || undefined;
  const now = new Date();

  const result = await equipmentExportRows({ kind, groupId, withMoney, now });
  if ("notFound" in result) return new Response("Not found", { status: 404 });
  if ("over" in result) return capRefusal(result.over);

  const buffer = await toXlsxBuffer(equipmentExportColumns(withMoney), result.rows);
  return xlsxResponse(exportFilename(equipmentFilePrefix(result.groupName ?? undefined), now), buffer);
}
