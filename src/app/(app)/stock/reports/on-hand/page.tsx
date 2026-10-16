import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams, parseListState, serializeListState, withFilter } from "@/lib/url-state";
import { STOCK_REPORT_LIST_CONFIG, reportHref } from "@/lib/stock-reports";
import { onHandReport } from "@/server/modules/stock/report-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ReportTabs } from "@/components/stock/report-tabs";
import { ReportCategoryFacet } from "@/components/stock/report-category-facet";
import { ReportSearch } from "@/components/stock/report-search";
import { OnHandTotals } from "@/components/stock/on-hand-totals";
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
  const uncostedOn = state.filters.uncosted?.includes("1") ?? false;
  const href = (values: string[]) => reportHref("/stock/reports/on-hand", withFilter(state, "uncosted", values));
  // The export is the whole report for the Category and Uncosted filters: it never takes the search or the page.
  const exportHref =
    "/stock/reports/on-hand/export" + serializeListState({ ...state, q: "", page: 1 }, STOCK_REPORT_LIST_CONFIG);
  const filtered = state.q !== "" || uncostedOn || (state.filters.category?.length ?? 0) > 0;

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
          <ReportSearch
            basePath="/stock/reports/on-hand"
            state={state}
            label="Search the report"
            placeholder="Search code, name…"
          />
          <ReportCategoryFacet basePath="/stock/reports/on-hand" state={state} options={report.facets.category} />
          <div className="ml-auto flex items-center gap-3">
            <Link
              href={href(uncostedOn ? [] : ["1"])}
              className="font-mono text-[11px] text-fg-muted hover:text-accent"
            >
              {uncostedOn ? "Show all" : "Uncosted only"}
            </Link>
            <ButtonLink href={exportHref} size="sm">
              Export
            </ButtonLink>
          </div>
        </div>

        {report.groups.length > 0 ? (
          <>
            <OnHandTotals grandTotal={report.grandTotal} subtotals={report.subtotals} />
            <OnHandTable groups={report.groups} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] text-fg-muted">
                Showing {report.page.from}–{report.page.to} of {report.page.total} items
              </p>
              <Pagination
                page={report.page.page}
                pageCount={report.page.pageCount}
                hrefFor={(p) => reportHref("/stock/reports/on-hand", { ...state, page: p })}
              />
            </div>
          </>
        ) : (
          <EmptyState title={filtered ? "No item matches." : "No stock items yet."} />
        )}
      </div>
    </>
  );
}
