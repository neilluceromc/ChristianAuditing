import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { EMPLOYEE_EXPORT_COLUMNS, EXPORT_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";

// Unlike /audit/export, this is the whole roster, unfiltered: the brief's use
// case for this sheet is "who do we have and what are they holding", and the
// list page's search/department/employment facets exist to help a human find
// one row, not to define a subset worth exporting on its own. If that
// changes, honour the page's filters the same way the audit route does.
export async function GET() {
  await requireUser();

  const count = await prisma.employee.count();
  if (count > EXPORT_CAP) return capRefusal(count);

  const employees = await prisma.employee.findMany({
    orderBy: { employeeNo: "asc" },
    include: {
      department: true,
      // The count the /employees list shows, from the same relation, so the
      // two cannot disagree.
      _count: { select: { assets: true } },
    },
  });

  const buffer = await toXlsxBuffer(
    EMPLOYEE_EXPORT_COLUMNS,
    employees.map((e) => ({
      employeeNo: e.employeeNo,
      name: e.name,
      // `department` is a required relation, so this is never null.
      department: e.department.name,
      title: e.title,
      employment: e.employment,
      m365Status: e.m365Status,
      joinedAt: e.joinedAt,
      itemsHeld: e._count.assets,
    })),
  );
  return xlsxResponse(exportFilename("employees", new Date()), buffer);
}
