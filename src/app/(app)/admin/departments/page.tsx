import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";

export default async function DepartmentsPage() {
  await requireRole("admin", "it_staff");
  const rows = await prisma.department.findMany({
    include: { _count: { select: { employees: true, policies: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <PageHeader title="Departments" />
      <RefTable
        entity="department"
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked,
          usage: `${r._count.employees} employees · ${r._count.policies} policies`,
        }))}
      />
    </>
  );
}
