import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RefTable } from "@/components/admin/ref-table";
import { MANAGEABLE_CLASSES } from "@/lib/asset-class";

export default async function AssetCategoriesPage() {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const mine = MANAGEABLE_CLASSES[user.role];
  const rows = await prisma.assetCategory.findMany({
    where: { cls: { in: [...mine] } },
    include: { _count: { select: { types: true, assets: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <PageHeader title="Asset categories" />
      <RefTable
        entity="category"
        fixedCls={mine.length === 1 ? mine[0] : undefined}
        rows={rows.map((r) => ({
          id: r.id, name: r.name, locked: r.locked, cls: r.cls,
          usage: `${r._count.types} types · ${r._count.assets} assets`,
        }))}
      />
    </>
  );
}
