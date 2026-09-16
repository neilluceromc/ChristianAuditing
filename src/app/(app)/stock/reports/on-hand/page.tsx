import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams, parseListState, serializeListState, withFilter } from "@/lib/url-state";
import { STOCK_REPORT_LIST_CONFIG } from "@/lib/stock-reports";
import { onHandReport } from "@/server/modules/stock/report-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportTabs } from "@/components/stock/report-tabs";
import { OnHandTable } from "@/components/stock/on-hand-table";

export default async function StockOnHandReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, STOCK_REPORT_LIST_CONFIG);
  const report = await onHandReport(state);
  const categoryId = state.filters.category?.[0] ?? "";
  const uncostedOn = state.filters.uncosted?.includes("1") ?? false;
  const href = (values: string[]) =>
    "/stock/reports/on-hand" + serializeListState(withFilter(state, "uncosted", values), STOCK_REPORT_LIST_CONFIG);

  return (
    <>
      <PageHeader
        title="On hand and value"
        breadcrumb={[
          { label: "Stock items", href: "/stock" },
          { label: "Reports", href: "/stock/reports" },
          { label: "On hand and value" },
        ]}
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      <div className="flex flex-col gap-4">
        <ReportTabs active="on-hand" />
        <p className="text-xs text-fg-muted">
          Value is FIFO over costed lots; uncosted units are counted, not valued.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            {uncostedOn && <input type="hidden" name="uncosted" value="1" />}
            <Select name="category" aria-label="Category" defaultValue={categoryId} className="max-w-[200px]">
              <option value="">All categories</option>
              {report.facets.category.map((c) => (
                <option key={c.value} value={c.value}>{c.label} ({c.count})</option>
              ))}
            </Select>
            <Button type="submit" size="sm">Apply</Button>
          </form>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href={href(uncostedOn ? [] : ["1"])}
              className="font-mono text-[11px] text-fg-muted hover:text-accent"
            >
              {uncostedOn ? "Show all" : "Uncosted only"}
            </Link>
            <ButtonLink href={"/stock/reports/on-hand/export" + serializeListState(state, STOCK_REPORT_LIST_CONFIG)} size="sm">
              Export
            </ButtonLink>
          </div>
        </div>

        {report.groups.length > 0 ? (
          <OnHandTable groups={report.groups} grandTotal={report.grandTotal} />
        ) : (
          <EmptyState title="No stock items yet." />
        )}
      </div>
    </>
  );
}
