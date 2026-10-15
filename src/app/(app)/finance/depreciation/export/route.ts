import { requireRole } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EXPORT_CAP, SCHEDULE_EXPORT_COLUMNS, type ScheduleSheetRow } from "@/lib/export-columns";
import { capRefusal, xlsxResponse } from "@/server/export/respond";
import { parseCls } from "@/lib/asset-class";
import { manilaMonth } from "@/lib/depreciation";
import { scheduleYear } from "@/server/modules/finance/depreciation-queries";

export async function GET(req: Request) {
  await requireRole("admin", "finance_staff");
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const cls = parseCls(sp.get("cls")) ?? "IT";
  const raw = sp.get("year") ?? "";
  const parsed = /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  const year = parsed >= 2000 && parsed <= 2100 ? parsed : Math.floor(manilaMonth(now) / 12);

  const { groups, total } = await scheduleYear(cls, year, now);
  const rows: ScheduleSheetRow[] = [];
  for (const g of groups) {
    for (const r of g.rows) rows.push({ tag: r.tag, model: r.model, category: g.category, costC: r.costC, grid: r.grid });
    rows.push({ tag: "", model: "", category: `Subtotal — ${g.category}`, costC: null, grid: g.subtotal });
  }
  if (total) rows.push({ tag: "", model: "", category: "Total", costC: null, grid: total });

  if (rows.length > EXPORT_CAP) return capRefusal(rows.length);
  const buffer = await toXlsxBuffer(SCHEDULE_EXPORT_COLUMNS, rows);
  return xlsxResponse(`depreciation-${cls.toLowerCase()}-${year}.xlsx`, buffer);
}
