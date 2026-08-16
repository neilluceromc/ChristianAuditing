import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";

export default async function AssetCategoriesPage() {
  await requireRole("admin", "it_staff");
  const rows = await prisma.assetCategory.findMany({
    include: { _count: { select: { types: true, assets: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <PageHeader title="Asset categories" />
      <RefTable
        entity="category"
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked,
          usage: `${r._count.types} types · ${r._count.assets} assets`,
        }))}
      />
    </>
  );
}
