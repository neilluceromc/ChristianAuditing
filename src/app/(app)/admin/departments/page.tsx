import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { GroupsPage } from "@/components/admin/groups-page";
import type { GroupRow } from "@/lib/groups";

export const metadata: Metadata = { title: pageTitle("Departments & clients") };

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireRole("admin", "it_staff");
  const { tab } = await searchParams;
  const [departments, policies] = await Promise.all([
    prisma.department.findMany({
      select: {
        id: true, name: true, kind: true, archivedAt: true, locked: true,
        _count: { select: { employees: { where: { employment: { not: "OFFBOARDED" } } } } },
      },
    }),
    prisma.equipmentPolicy.findMany({
      where: { appliesToTitle: null, appliesToDepartmentId: { not: null } },
      select: { appliesToDepartmentId: true, _count: { select: { slots: true } } },
    }),
  ]);
  const items = new Map(policies.map((p) => [p.appliesToDepartmentId, p._count.slots]));
  const rows: GroupRow[] = departments.map((d) => ({
    id: d.id, name: d.name, kind: d.kind, locked: d.locked,
    archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
    people: d._count.employees,
    policyItems: items.get(d.id) ?? null,
  }));
  return (
    <>
      <PageHeader title="Departments & clients" />
      <p className="-mt-2 pb-4 text-[12.5px] text-fg-muted">
        Everyone either works in an internal department or is client staff on a client account.
      </p>
      <GroupsPage rows={rows} canMutate initialTab={tab === "internal" ? "internal" : "client"} />
    </>
  );
}
