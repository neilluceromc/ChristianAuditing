import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { AssetForm } from "@/components/inventory/asset-form";
import { updateAsset } from "@/server/modules/inventory/actions";
import { canManageClass } from "@/lib/asset-class";
import { ROLE_LANDING } from "@/lib/workspaces";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) notFound();
  if (!canManageClass(user.role, asset.cls)) redirect(ROLE_LANDING[user.role]);

  const [categories, types, vendors] = await Promise.all([
    prisma.assetCategory.findMany({ where: { cls: asset.cls }, orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ where: { category: { cls: asset.cls } }, orderBy: { name: "asc" } }),
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
        categories={categories.map((c) => ({ id: c.id, name: c.name, cls: c.cls }))}
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
