import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ImportWizard } from "@/components/import/import-wizard";
import { STOCK_KNOWN_UNIMPORTED_COLUMNS, STOCK_UNIT_COST_NOTICE } from "@/lib/import-columns";
import { planStockImport, applyStockImport } from "@/server/modules/import/stock-actions";

export default async function ImportStockPage() {
  // `requireRole("admin", "purchasing_staff")` — the same set
  // `STOCK_MANAGER_ROLES` (`stock-access.ts`) names for every other
  // stock-management page.
  await requireRole("admin", "purchasing_staff");
  return (
    <>
      <PageHeader
        title="Import stock items"
        breadcrumb={[{ label: "Stock", href: "/stock" }, { label: "Import" }]}
      />
      <div className="flex flex-col gap-4">
        <Banner tone="neutral" title="Two things that surprise people">
          A blocked row never blocks the rest of the file — rows that don&apos;t block still import even
          when others in the same upload do. And Validate is a dry run: it reads the whole file and shows
          you exactly what would happen, but writes nothing until you choose Import. Opening quantities are
          recorded once, on new items only — existing items take receipts and adjustments. {STOCK_UNIT_COST_NOTICE}.
        </Banner>
        <ImportWizard
          planAction={planStockImport}
          applyAction={applyStockImport}
          knownUnimportedColumns={STOCK_KNOWN_UNIMPORTED_COLUMNS}
          activityHref="/stock"
        />
      </div>
    </>
  );
}
