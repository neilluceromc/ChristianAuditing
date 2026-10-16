import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams, parseListState } from "@/lib/url-state";
import { STOCK_REPORT_LIST_CONFIG, parseExpiryTab, parseExpiryWindow, reportHref } from "@/lib/stock-reports";
import { localDateISO } from "@/lib/format";
import { canManageStock } from "@/lib/stock-access";
import { expiryReport } from "@/server/modules/stock/report-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { Pagination } from "@/components/ui/pagination";
import { Tabs } from "@/components/ui/tabs";
import { ReportTabs } from "@/components/stock/report-tabs";
import { ReportCategoryFacet } from "@/components/stock/report-category-facet";
import { ReportSearch } from "@/components/stock/report-search";
import { ExpiryWindowChips } from "@/components/stock/expiry-window-chips";
import { ExpiryTable } from "@/components/stock/expiry-table";

function queryFor(params: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const BASE = "/stock/reports/expiry";

export const metadata: Metadata = { title: pageTitle("Expiring and expired lots") };

export default async function StockExpiryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, STOCK_REPORT_LIST_CONFIG);
  const windowDays = parseExpiryWindow(sp);
  const tab = parseExpiryTab(sp);
  const today = localDateISO();
  const report = await expiryReport(windowDays, state, tab);
  const manage = canManageStock(user.role);
  const categoryParam = state.filters.category?.join(",") ?? "";
  // The report's own params next to the list state (search, Category, page): the window, and the tab when it is not the default.
  const extra = { days: String(windowDays), tab: tab === "expiring" ? "expiring" : "" };
  const tabHref = (t: "expired" | "expiring") =>
    reportHref(BASE, { ...state, page: 1 }, { days: String(windowDays), tab: t === "expiring" ? "expiring" : "" });
  const emptyText = state.q
    ? "No lot matches."
    : tab === "expired"
      ? "Nothing has expired."
      : `Nothing expires within ${windowDays} days.`;

  return (
    <>
      <PageHeader
        title="Expiring and expired lots"
        breadcrumb={[
          { label: "Stock items", href: "/stock" },
          { label: "Reports", href: "/stock/reports" },
          { label: "Expiring and expired lots" },
        ]}
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      <div className="flex flex-col gap-4">
        <ReportTabs active="expiry" />
        <Tabs
          label="Expiry status"
          items={[
            { label: `Expired (${report.counts.expired})`, href: tabHref("expired"), active: tab === "expired" },
            { label: `Expiring (${report.counts.expiring})`, href: tabHref("expiring"), active: tab === "expiring" },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {tab === "expiring" && (
              <ExpiryWindowChips
                active={windowDays}
                hrefFor={(days) => reportHref(BASE, { ...state, page: 1 }, { days: String(days), tab: "expiring" })}
              />
            )}
            <ReportSearch
              basePath={BASE}
              state={state}
              extraParams={extra}
              label="Search the lots"
              placeholder="Search item, reference, supplier…"
            />
            <ReportCategoryFacet basePath={BASE} state={state} options={report.facets.category} extraParams={extra} />
          </div>
          <ButtonLink
            href={"/stock/reports/expiry/export" + queryFor({ category: categoryParam, days: String(windowDays) })}
            size="sm"
          >
            Export
          </ButtonLink>
        </div>

        <ExpiryTable rows={report.rows} today={today} emptyText={emptyText} canManage={manage} />
        {report.page.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-fg-muted">
              Showing {report.page.from}–{report.page.to} of {report.page.total} lots
            </p>
            <Pagination
              page={report.page.page}
              pageCount={report.page.pageCount}
              hrefFor={(p) => reportHref(BASE, { ...state, page: p }, extra)}
            />
          </div>
        )}
      </div>
    </>
  );
}
