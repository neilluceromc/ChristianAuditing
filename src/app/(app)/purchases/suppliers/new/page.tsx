import { requireRole } from "@/server/auth/guards";
import { supplierCategories } from "@/server/modules/suppliers/queries";
import { PageHeader } from "@/components/ui/page-header";
import { SupplierForm } from "@/components/suppliers/supplier-form";

export default async function NewSupplierPage() {
  await requireRole("admin", "purchasing_staff");
  const categories = await supplierCategories();

  return (
    <>
      <PageHeader
        title="New supplier"
        breadcrumb={[
          { label: "Purchase requests", href: "/purchases" },
          { label: "Suppliers", href: "/purchases/suppliers" },
          { label: "New" },
        ]}
      />
      <SupplierForm mode="new" categories={categories} />
    </>
  );
}
