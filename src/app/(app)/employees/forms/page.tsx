import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { parseIdsParam, toSearchParams } from "@/lib/url-state";
import { BULK_MAX } from "@/lib/inventory-list";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PrintButton } from "@/components/ui/print-button";
import { EquipmentForm } from "@/components/employees/equipment-form";

export const metadata: Metadata = { title: pageTitle("Accountability forms") };

type Params = Record<string, string | string[] | undefined>;

const CRUMB = [{ label: "Employees", href: "/employees" }, { label: "Accountability forms" }];

/**
 * Print the equipment accountability form for several people at once (the Employees bulk bar's "Print IT forms").
 * Same access as the single form (`/employees/[id]/form`): any signed-in user, inside the Employees workspace rule.
 * One form per page, in the order the ids were given; an id that matches nobody is skipped.
 */
export default async function AccountabilityFormsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const requested = parseIdsParam(toSearchParams(await searchParams), BULK_MAX);

  // Refuse, never slice: printing the first 200 of a bigger selection would look finished and not be.
  if (requested === "over") {
    return (
      <>
        <PageHeader title="Accountability forms" breadcrumb={CRUMB} />
        <Banner
          tone="fault"
          title={`Pick no more than ${BULK_MAX} people to print at once`}
          actions={<ButtonLink href="/employees">Back to Employees</ButtonLink>}
        >
          Narrow the selection and try again. Nothing was printed.
        </Banner>
      </>
    );
  }

  const found = requested.length
    ? new Set((await prisma.employee.findMany({ where: { id: { in: requested } }, select: { id: true } })).map((e) => e.id))
    : new Set<string>();
  const ids = requested.filter((id) => found.has(id));
  const skipped = requested.length - ids.length;

  if (ids.length === 0) {
    return (
      <>
        <PageHeader title="Accountability forms" breadcrumb={CRUMB} />
        <EmptyState
          title="No one selected"
          description={skipped > 0 ? "None of the selected people were found." : "Tick people on the Employees list, then choose Print IT forms."}
          actions={<ButtonLink href="/employees">Back to Employees</ButtonLink>}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="flex flex-col gap-2 pb-3 print:hidden">
        {skipped > 0 && (
          <Banner tone="attention" title={`${skipped} selected ${skipped === 1 ? "person" : "people"} could not be found and ${skipped === 1 ? "was" : "were"} skipped.`} />
        )}
        <div className="flex justify-end">
          <PrintButton label={`Print ${ids.length} ${ids.length === 1 ? "form" : "forms"}`} />
        </div>
      </div>
      <div className="flex flex-col gap-6 print:block">
        {ids.map((id) => (
          <section key={id} className="break-after-page last:break-after-auto">
            <EquipmentForm employeeId={id} />
          </section>
        ))}
      </div>
    </div>
  );
}
