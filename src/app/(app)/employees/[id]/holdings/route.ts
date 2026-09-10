import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EXPORT_CAP, HOLDINGS_EXPORT_COLUMNS } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";
import { holdingsRows } from "@/server/modules/employees/queries";

/**
 * Phase 20 (spec §5, plan P-3): one employee's own holdings + active
 * reservations as a sheet — everyone may export it (no role gate beyond
 * being signed in, same as the printable farewell report's own route). The
 * cap check is real (unlike the farewell report's deliberate no-cap): a
 * holdings sheet is still bounded by what one person can physically hold,
 * but `holdingsRows` is a shared shape and this route follows the same
 * "cap before write" discipline every OTHER export in this app does rather
 * than assume its own caller can never reach it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id }, select: { employeeNo: true } });
  if (!employee) return new Response("Not found", { status: 404 });

  const rows = await holdingsRows(id);
  if (rows.length > EXPORT_CAP) return capRefusal(rows.length);

  const buffer = await toXlsxBuffer(HOLDINGS_EXPORT_COLUMNS, rows);
  return xlsxResponse(exportFilename(`holdings-${employee.employeeNo}`, new Date()), buffer);
}
