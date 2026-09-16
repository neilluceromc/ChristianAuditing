import { requireUser } from "@/server/auth/guards";
import { toSearchParams, parseListState } from "@/lib/url-state";
import { STOCK_REPORT_LIST_CONFIG, parseReportRange } from "@/lib/stock-reports";
import { localDateISO } from "@/lib/format";
import { consumptionReport } from "@/server/modules/stock/report-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportTabs } from "@/components/stock/report-tabs";
import { ConsumptionGridTable } from "@/components/stock/consumption-grid";

function queryFor(params: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function StockConsumptionReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, STOCK_REPORT_LIST_CONFIG);
  const range = parseReportRange(sp, localDateISO());
  const report = await consumptionReport(range, state);
  const categoryId = state.filters.category?.[0] ?? "";

  return (
    <>
      <PageHeader
        title="Consumption by department"
        breadcrumb={[
          { label: "Stock items", href: "/stock" },
          { label: "Reports", href: "/stock/reports" },
          { label: "Consumption by department" },
        ]}
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      <div className="flex flex-col gap-4">
        <ReportTabs active="consumption" />
        <div className="flex flex-wrap items-center gap-2">
          {/* Plain GET navigation — no client island needed for the range/category filter. */}
          <form method="get" className="flex flex-wrap items-center gap-2">
            <Input type="date" name="from" aria-label="From" defaultValue={range.from} className="max-w-[160px]" />
            <Input type="date" name="to" aria-label="To" defaultValue={range.to} className="max-w-[160px]" />
            <Select name="category" aria-label="Category" defaultValue={categoryId} className="max-w-[200px]">
              <option value="">All categories</option>
              {report.facets.category.map((c) => (
                <option key={c.value} value={c.value}>{c.label} ({c.count})</option>
              ))}
            </Select>
            <Button type="submit" size="sm">Apply</Button>
          </form>
          <ButtonLink
            href={"/stock/reports/consumption/export" + queryFor({ from: range.from, to: range.to, category: categoryId })}
            size="sm"
            className="ml-auto"
          >
            Export
          </ButtonLink>
        </div>

        {report.grid.rows.length > 0 ? (
          <ConsumptionGridTable grid={report.grid} />
        ) : (
          <EmptyState title="No issues in this range." />
        )}
      </div>
    </>
  );
}
