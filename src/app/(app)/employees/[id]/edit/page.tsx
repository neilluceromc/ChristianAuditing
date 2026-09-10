import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { EmployeeForm } from "@/components/employees/employee-form";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "it_staff");
  const { id } = await params;
  // Phase 20: no department list — the edit form no longer changes departments
  // (that is Transfer's job), so the query and the prop went with the select.
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${employee.name}`}
        breadcrumb={[
          { label: "Employees", href: "/employees" },
          { label: employee.employeeNo, href: `/employees/${id}` },
          { label: "Edit" },
        ]}
      />
      <EmployeeForm
        mode="edit"
        employeeId={id}
        initial={{
          name: employee.name,
          title: employee.title,
          departmentId: employee.departmentId,
          employment: employee.employment,
          m365Status: employee.m365Status,
        }}
      />
    </>
  );
}
