import { requireUser } from "@/server/auth/guards";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { FAREWELL_EXPORT_COLUMNS } from "@/lib/export-columns";
import { exportFilename, xlsxResponse } from "@/server/export/respond";
import { OUTCOME_LABEL } from "@/lib/offboarding";
// `getWizard` is the report's own query (the plan's assumed name,
// `getFarewellReport`, does not exist) and `decidedItems` is the exact row
// filter the printable page applies — shared so the sheet and the page can
// never disagree about which rows belong (§6a rule 47). Neither is
// re-derived here.
import { decidedItems, getWizard } from "@/server/modules/offboarding/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  await requireUser();
  const { employeeId } = await params;
  const data = await getWizard(employeeId);
  if (!data) return new Response("Not found", { status: 404 });

  const rows = decidedItems(data.items).map((i) => ({
    tag: i.tag,
    model: i.model,
    outcome: OUTCOME_LABEL[i.decision.outcome],
    reason: i.decision.reason,
    cost: i.cost,
    refNo: i.decision.refNo,
    state: i.decision.state,
  }));

  // No cap check, deliberately: the shared EXPORT_CAP (10,000) guards the
  // LIST exports — a fleet-wide or roster-wide query that could genuinely
  // return more rows than an operator should download in one file. This
  // route returns one employee's own loadout, which is bounded by what one
  // person can physically hold. A cap check here could never fire, and
  // adding one anyway would be a check that reads as a decision nobody made.
  const buffer = await toXlsxBuffer(FAREWELL_EXPORT_COLUMNS, rows);
  // `farewell-${employeeNo}` is DB-derived and employeeNo has no format
  // constraint anywhere (schema or zod) — exportFilename is what makes this
  // safe by stripping the prefix to [A-Za-z0-9_-] itself, so the caller
  // never has to trust the input. Do not build the content-disposition
  // header directly; go through exportFilename/xlsxResponse.
  return xlsxResponse(exportFilename(`farewell-${data.employee.employeeNo}`, new Date()), buffer);
}
