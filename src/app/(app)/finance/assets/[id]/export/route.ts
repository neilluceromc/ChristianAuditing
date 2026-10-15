import { requireRole } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { ASSET_SCHEDULE_EXPORT_COLUMNS } from "@/lib/export-columns";
import { exportFilename, xlsxResponse } from "@/server/export/respond";
import { monthLabel } from "@/lib/depreciation";
import { financeAssetDetail } from "@/server/modules/finance/asset-detail";

type Row = { label: string; opening: number | null; charge: number | null; closing: number | null; projected: string };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "finance_staff");
  const { id } = await params;
  const d = await financeAssetDetail(id);
  if (!d) return new Response("Not found", { status: 404 });

  const summary = (label: string, value: number | null): Row => ({ label, opening: null, charge: null, closing: value, projected: "" });
  const rows: Row[] = [
    summary("Cost", d.costC),
    summary("Depreciation to date", d.result ? d.result.accumulated : null),
    summary("Book value", d.result ? d.result.bookValue : null),
    summary("Monthly amount", d.result?.monthly ?? null),
    summary("Salvage", d.salvageC),
    { label: "", opening: null, charge: null, closing: null, projected: "" },
  ];
  for (const y of d.years) {
    for (const m of y.months) {
      rows.push({ label: monthLabel(m.month), opening: m.opening, charge: m.charge, closing: m.closing, projected: m.projected ? "Yes" : "" });
    }
  }
  const buffer = await toXlsxBuffer(ASSET_SCHEDULE_EXPORT_COLUMNS, rows);
  return xlsxResponse(exportFilename(`asset-${d.tag}`, new Date()), buffer);
}
