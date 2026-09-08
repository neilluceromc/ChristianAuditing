import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ImportWizard } from "@/components/import/import-wizard";
import { SUPPLIER_KNOWN_UNIMPORTED_COLUMNS } from "@/lib/import-columns";
import { planSupplierImport, applySupplierImport } from "@/server/modules/import/supplier-actions";

export default async function ImportSuppliersPage() {
  // `requireRole("admin", "purchasing_staff")` — the same set
  // `SUPPLIER_MANAGER_ROLES` (`supplier-access.ts`) names for every other
  // supplier-management page.
  await requireRole("admin", "purchasing_staff");
  return (
    <>
      <PageHeader
        title="Import suppliers"
        breadcrumb={[
          { label: "Purchase requests", href: "/purchases" },
          { label: "Suppliers", href: "/purchases/suppliers" },
          { label: "Import" },
        ]}
      />
      <div className="flex flex-col gap-4">
        <Banner tone="neutral" title="Two things that surprise people">
          A blocked row never blocks the rest of the file — rows that don&apos;t block still import even
          when others in the same upload do. And Validate is a dry run: it reads the whole file and shows
          you exactly what would happen, but writes nothing until you choose Import. Bank details never
          travel in a sheet — add them on each supplier&apos;s page.
        </Banner>
        <ImportWizard
          planAction={planSupplierImport}
          applyAction={applySupplierImport}
          knownUnimportedColumns={SUPPLIER_KNOWN_UNIMPORTED_COLUMNS}
          activityHref="/purchases/suppliers"
        />
      </div>
    </>
  );
}
