import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";

export default async function AssetTypesPage() {
  await requireRole("admin", "it_staff");
  const [rows, categories] = await Promise.all([
    prisma.assetType.findMany({
      include: { category: true, _count: { select: { assets: true, policySlots: true } } },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.assetCategory.findMany({ where: { locked: false }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Asset types" />
      <RefTable
        entity="type"
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked, categoryName: r.category.name,
          usage: `${r._count.assets} assets · ${r._count.policySlots} policy slots`,
        }))}
      />
    </>
  );
}
