import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { activeStockCategories, stockUnits } from "@/server/modules/stock/queries";
import type { ItemInput } from "@/lib/stock-schema";
import { PageHeader } from "@/components/ui/page-header";
import { StockItemForm } from "@/components/stock/stock-item-form";

export default async function EditStockItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "purchasing_staff");
  const { id } = await params;
  const [item, categories, units] = await Promise.all([
    prisma.stockItem.findUnique({
      where: { id },
      select: {
        code: true, name: true, unit: true, packSize: true, reorderLevel: true, notes: true, categoryId: true,
        _count: { select: { movements: true } },
      },
    }),
    activeStockCategories(),
    stockUnits(),
  ]);
  if (!item) notFound();

  const initial: ItemInput = {
    categoryId: item.categoryId,
    name: item.name,
    unit: item.unit,
    packSize: item.packSize,
    reorderLevel: item.reorderLevel,
    notes: item.notes ?? "",
  };

  return (
    <>
      <PageHeader
        title={`Edit ${item.code}`}
        breadcrumb={[
          { label: "Stock items", href: "/stock" },
          { label: item.code, href: `/stock/items/${id}` },
          { label: "Edit" },
        ]}
      />
      <StockItemForm
        mode="edit"
        id={id}
        categories={categories}
        units={units}
        initial={initial}
        hasMovements={item._count.movements > 0}
      />
    </>
  );
}
