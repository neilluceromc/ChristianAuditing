import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { AssetForm } from "@/components/inventory/asset-form";
import { updateAsset } from "@/server/modules/inventory/actions";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "it_staff");
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) notFound();

  const [categories, types, vendors] = await Promise.all([
    prisma.assetCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);

  async function action(payload: Record<string, unknown>) {
    "use server";
    return updateAsset({ ...payload, id });
  }

  const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <>
      <PageHeader
        title={`Edit ${asset.tag}`}
        breadcrumb={[
          { label: "Inventory", href: "/inventory" },
          { label: asset.tag, href: `/inventory/${asset.id}` },
          { label: "Edit" },
        ]}
      />
      <AssetForm
        mode="edit"
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        types={types.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId }))}
        employees={[]}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        initial={{
          tag: asset.tag,
          model: asset.model,
          serial: asset.serial ?? "",
          categoryId: asset.categoryId,
          typeId: asset.typeId ?? "",
          purchasedAt: date(asset.purchasedAt),
          cost: asset.cost === null ? "" : String(asset.cost),
          warrantyUntil: date(asset.warrantyUntil),
          notes: asset.notes ?? "",
          vendorId: asset.vendorId ?? "",
          rmaRef: asset.rmaRef ?? "",
          repairQuote: asset.repairQuote === null ? "" : String(asset.repairQuote),
        }}
        action={action}
      />
    </>
  );
}
