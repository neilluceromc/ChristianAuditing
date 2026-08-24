import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ImportWizard } from "@/components/import/import-wizard";
import { EMPLOYEE_KNOWN_UNIMPORTED_COLUMNS } from "@/lib/import-columns";
import { planEmployeeImport, applyEmployeeImport } from "@/server/modules/import/employee-actions";

export default async function ImportEmployeesPage() {
  // `requireRole("admin", "it_staff")` — a SET, not a floor, matching the
  // asset importer's own page and `workspaces.ts`'s E-7 path rule.
  await requireRole("admin", "it_staff");
  return (
    <>
      <PageHeader title="Import employees" breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "Import" }]} />
      <div className="flex flex-col gap-4">
        <Banner tone="neutral" title="Two things that surprise people">
          A blocked row never blocks the rest of the file — rows that don&apos;t block still import even
          when others in the same upload do. And Validate is a dry run: it reads the whole file and shows
          you exactly what would happen, but writes nothing until you choose Import.
        </Banner>
        <ImportWizard
          planAction={planEmployeeImport}
          applyAction={applyEmployeeImport}
          knownUnimportedColumns={EMPLOYEE_KNOWN_UNIMPORTED_COLUMNS}
          activityHref="/employees/activity"
        />
      </div>
    </>
  );
}
