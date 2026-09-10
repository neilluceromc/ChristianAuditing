import { requireRole } from "@/server/auth/guards";
import { activeStockCategories } from "@/server/modules/stock/queries";
import { PageHeader } from "@/components/ui/page-header";
import { StocktakeOpenForm } from "@/components/stock/stocktake-open-form";

export default async function NewStocktakePage() {
  await requireRole("admin", "purchasing_staff");
  const categories = await activeStockCategories();

  return (
    <>
      <PageHeader
        title="New stocktake"
        breadcrumb={[
          { label: "Stock items", href: "/stock" },
          { label: "Stocktakes", href: "/stock/stocktakes" },
          { label: "New" },
        ]}
      />
      <StocktakeOpenForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </>
  );
}
