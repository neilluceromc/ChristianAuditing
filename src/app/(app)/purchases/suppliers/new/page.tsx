import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { supplierCategories } from "@/server/modules/suppliers/queries";
import { PageHeader } from "@/components/ui/page-header";
import { SupplierForm } from "@/components/suppliers/supplier-form";

export const metadata: Metadata = { title: pageTitle("New vendor") };

export default async function NewSupplierPage() {
  await requireRole("admin", "purchasing_staff");
  const categories = await supplierCategories();

  return (
    <>
      <PageHeader
        title="New vendor"
        breadcrumb={[
          { label: "Purchase orders", href: "/purchases" },
          { label: "Vendors", href: "/purchases/suppliers" },
          { label: "New" },
        ]}
      />
      <SupplierForm mode="new" categories={categories} />
    </>
  );
}
