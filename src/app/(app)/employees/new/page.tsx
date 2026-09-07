import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { EmployeeForm } from "@/components/employees/employee-form";

export default async function NewEmployeePage() {
  await requireRole("admin", "it_staff");
  const departments = await prisma.department.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="New employee" breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "New" }]} />
      <EmployeeForm mode="new" departments={departments.map((d) => ({ id: d.id, name: d.name }))} />
    </>
  );
}
