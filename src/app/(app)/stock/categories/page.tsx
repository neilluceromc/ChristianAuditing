import { requireRole } from "@/server/auth/guards";
import { listStockCategories } from "@/server/modules/stock/queries";
import { PageHeader } from "@/components/ui/page-header";
import { CategoryTable } from "@/components/stock/category-table";

export default async function StockCategoriesPage() {
  await requireRole("admin", "purchasing_staff");
  const rows = await listStockCategories();

  return (
    <>
      <PageHeader
        title="Stock categories"
        breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: "Categories" }]}
      />
      <CategoryTable rows={rows} />
    </>
  );
}
