import { requireRole } from "@/server/auth/guards";
import { activeStockCategories, stockUnits } from "@/server/modules/stock/queries";
import { PageHeader } from "@/components/ui/page-header";
import { StockItemForm } from "@/components/stock/stock-item-form";

export default async function NewStockItemPage() {
  await requireRole("admin", "purchasing_staff");
  const [categories, units] = await Promise.all([activeStockCategories(), stockUnits()]);

  return (
    <>
      <PageHeader
        title="New item"
        breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: "New" }]}
      />
      <StockItemForm mode="new" categories={categories} units={units} />
    </>
  );
}
