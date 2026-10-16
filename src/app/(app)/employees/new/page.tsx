import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { NewEmployeeWizard } from "@/components/employees/new-employee-wizard";
import { groupPickerOptions } from "@/lib/groups";
import { nextEmployeeNo } from "@/lib/employee-no";
import { localDateISO } from "@/lib/format";

/** Phase 37 (spec §5): Add an employee in three steps; only active departments and clients are offered. */
export default async function NewEmployeePage() {
  await requireRole("admin", "it_staff");
  const [departments, numbers] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true, kind: true, archivedAt: true }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ select: { employeeNo: true } }),
  ]);
  const { internal, client } = groupPickerOptions(
    departments.map((d) => ({ id: d.id, name: d.name, kind: d.kind, archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null })),
  );
  return (
    <>
      <PageHeader title="New employee" breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "New" }]} />
      <NewEmployeeWizard
        groups={{ internal, client }}
        nextNo={nextEmployeeNo(numbers.map((n) => n.employeeNo))}
        today={localDateISO(new Date())}
      />
    </>
  );
}
