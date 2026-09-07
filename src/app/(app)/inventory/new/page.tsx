import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { AssetForm } from "@/components/inventory/asset-form";
import { createAsset } from "@/server/modules/inventory/actions";
import { toSearchParams } from "@/lib/url-state";
import { ASSET_CLASSES, REGISTRABLE_CLASSES, canRegisterClass, isDirectLifecycle, parseCls, withClsQS } from "@/lib/asset-class";

export default async function NewAssetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const sp = toSearchParams(await searchParams);
  const cls = parseCls(sp.get("cls"));
  // A single-class role's REGISTRABLE_CLASSES list has one entry either way,
  // so this narrows nothing for it. For admin arriving from the Purchasing
  // view, it does: without this, "New asset" from /inventory?cls=PURCHASING
  // opened a form whose categories were whichever class's names sort first,
  // not Purchasing's (D-14).
  const scopedCls = cls !== null && canRegisterClass(user.role, cls) ? cls : null;
  // The category control can switch class client-side without a reload (an
  // admin registering IT or Purchasing from the same unscoped /inventory/new),
  // so the form needs every class this role is direct-lifecycle for, not a
  // single boolean pinned to scopedCls.
  const directClasses = ASSET_CLASSES.filter((c) => isDirectLifecycle(user.role, c));
  const [categories, types, employees] = await Promise.all([
    prisma.assetCategory.findMany({
      where: scopedCls ? { cls: scopedCls } : { cls: { in: [...REGISTRABLE_CLASSES[user.role]] } },
      orderBy: { name: "asc" },
    }),
    prisma.assetType.findMany({
      where: scopedCls ? { category: { cls: scopedCls } } : { category: { cls: { in: [...REGISTRABLE_CLASSES[user.role]] } } },
      orderBy: { name: "asc" },
    }),
    prisma.employee.findMany({ where: { employment: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="New asset"
        breadcrumb={[{ label: "Inventory", href: "/inventory" + withClsQS("", cls ?? "IT") }, { label: "New" }]}
      />
      <AssetForm
        mode="new"
        categories={categories.map((c) => ({ id: c.id, name: c.name, cls: c.cls }))}
        types={types.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId }))}
        employees={employees.map((e) => ({ value: e.id, label: e.name, sub: e.employeeNo }))}
        action={createAsset}
        directClasses={directClasses}
      />
    </>
  );
}
