import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { AssetForm } from "@/components/inventory/asset-form";
import { createAsset } from "@/server/modules/inventory/actions";

export default async function NewAssetPage() {
  await requireRole("admin", "it_staff");
  const [categories, types, employees] = await Promise.all([
    prisma.assetCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { employment: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="New asset"
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "New" }]}
      />
      <AssetForm
        mode="new"
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        types={types.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId }))}
        employees={employees.map((e) => ({ value: e.id, label: e.name, sub: e.employeeNo }))}
        action={createAsset}
      />
    </>
  );
}
