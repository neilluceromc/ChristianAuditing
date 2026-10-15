import { requireRole } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EXPORT_CAP, FINANCE_ASSETS_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { parseCls } from "@/lib/asset-class";
import { finWhere, parseFin } from "@/lib/registration";
import { prisma } from "@/server/db/client";
import { financeListWhere, parseAssetStatus } from "@/server/modules/finance/queries";
import { depRows } from "@/server/modules/finance/depreciation-queries";

export async function GET(req: Request) {
  await requireRole("admin", "finance_staff");
  const sp = new URL(req.url).searchParams;
  const cls = parseCls(sp.get("cls")) ?? "IT";
  const status = parseAssetStatus(sp.get("status"), cls);
  const fin = parseFin(sp.get("fin"));
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const where = { AND: [financeListWhere({ cls, status, q }), ...(fin ? [finWhere(fin)] : [])] };

  const count = await prisma.asset.count({ where });
  if (count > EXPORT_CAP) return capRefusal(count);

  const rows = await depRows(where, new Date(), { orderBy: [{ tag: "asc" }, { id: "asc" }] });
  const buffer = await toXlsxBuffer(FINANCE_ASSETS_EXPORT_COLUMNS, rows);
  return xlsxResponse(exportFilename("finance-assets", new Date()), buffer);
}
