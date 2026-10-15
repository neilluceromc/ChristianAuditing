import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { policyRows } from "@/server/modules/finance/depreciation-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Banner } from "@/components/ui/banner";
import { Table, TBody, THead, Th, Tr } from "@/components/ui/table";
import { PolicyRow } from "@/components/finance/policy-row";

export default async function DepreciationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "finance_staff");
  const params = toSearchParams(await searchParams);
  const tab = params.get("tab") === "policies" ? "policies" : "schedule";

  const policies = tab === "policies" ? await policyRows() : [];
  const missing = policies.filter((p) => p.lifeMonths === null).length;

  return (
    <>
      <PageHeader title="Depreciation" />
      <div className="flex flex-col gap-3">
        <Tabs
          label="Depreciation views"
          items={[
            { label: "Schedule", href: "/finance/depreciation", active: tab === "schedule" },
            { label: "Policies", href: "/finance/depreciation?tab=policies", active: tab === "policies" },
          ]}
        />
        {tab === "policies" && (
          <>
            {missing > 0 && (
              <Banner tone="attention">
                {missing} categories have no useful life yet — their assets show at full cost.
              </Banner>
            )}
            <Table>
              <THead>
                <Tr>
                  <Th>Category</Th>
                  <Th>Class</Th>
                  <Th align="right">Costed</Th>
                  <Th>Useful life</Th>
                  <Th>Salvage %</Th>
                  <Th>Last changed</Th>
                  <Th aria-label="Row action" />
                </Tr>
              </THead>
              <TBody>
                {policies.map((p) => <PolicyRow key={p.id} row={p} />)}
              </TBody>
            </Table>
          </>
        )}
      </div>
    </>
  );
}
