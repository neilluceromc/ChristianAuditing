import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { EmployeeForm } from "@/components/employees/employee-form";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "it_staff");
  const { id } = await params;
  const [employee, departments] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);
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
        employeeId={id}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
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
