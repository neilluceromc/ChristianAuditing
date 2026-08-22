import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ImportWizard } from "@/components/import/import-wizard";

export default async function ImportAssetsPage() {
  // `requireRole("admin", "it_staff")` — a SET, not a floor. `requireRole("it_staff")`
  // alone would lock out admin, the role that runs this app (the same defect
  // Tasks 9 and 10 shipped and fixed in `actionRole`).
  await requireRole("admin", "it_staff");
  return (
    <>
      <PageHeader title="Import assets" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Import" }]} />
      <div className="flex flex-col gap-4">
        <Banner tone="neutral" title="Two things that surprise people">
          A blocked row never blocks the rest of the file — rows that don&apos;t block still import even
          when others in the same upload do. And Validate is a dry run: it reads the whole file and shows
          you exactly what would happen, but writes nothing until you choose Import.
        </Banner>
        <ImportWizard />
      </div>
    </>
  );
}
