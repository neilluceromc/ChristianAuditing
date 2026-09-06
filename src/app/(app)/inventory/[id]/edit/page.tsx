import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { AssetForm } from "@/components/inventory/asset-form";
import { updateAsset } from "@/server/modules/inventory/actions";
import { canManageClass } from "@/lib/asset-class";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) notFound();
  // The record is readable by both classes (spec §5: "everything else is
  // shared"); only the form is not. Redirect to the record, not ROLE_LANDING —
  // the same shape as purchases/[id]/edit. `updateAsset` enforces this too;
  // this keeps the dead end off the screen. The Edit button is already hidden
  // for this user (layout.tsx canMutate, same predicate).
  if (!canManageClass(user.role, asset.cls)) redirect(`/inventory/${id}`);

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
