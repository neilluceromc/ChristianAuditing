import { requireUser } from "@/server/auth/guards";
import { toSearchParams, parseListState } from "@/lib/url-state";
import { STOCK_REPORT_LIST_CONFIG, parseExpiryWindow } from "@/lib/stock-reports";
import { localDateISO } from "@/lib/format";
import { canManageStock } from "@/lib/stock-access";
import { expiryReport } from "@/server/modules/stock/report-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { ReportTabs } from "@/components/stock/report-tabs";
import { ReportCategoryFacet } from "@/components/stock/report-category-facet";
import { ExpiryWindowChips } from "@/components/stock/expiry-window-chips";
import { ExpiryTable } from "@/components/stock/expiry-table";

function queryFor(params: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function StockExpiryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, STOCK_REPORT_LIST_CONFIG);
  const windowDays = parseExpiryWindow(sp);
  const today = localDateISO();
  const report = await expiryReport(windowDays, state);
  const manage = canManageStock(user.role);
  const categoryParam = state.filters.category?.join(",") ?? "";

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ExpiryWindowChips
            active={windowDays}
            hrefFor={(days) => "/stock/reports/expiry" + queryFor({ category: categoryParam, days: String(days) })}
          />
          <div className="flex items-center gap-2">
            <ReportCategoryFacet
              basePath="/stock/reports/expiry"
              state={state}
              options={report.facets.category}
              extraParams={{ days: String(windowDays) }}
            />
            <ButtonLink
              href={"/stock/reports/expiry/export" + queryFor({ category: categoryParam, days: String(windowDays) })}
              size="sm"
            >
              Export
            </ButtonLink>
          </div>
        </div>

        <ExpiryTable
          title="Expired"
          rows={report.expired}
          today={today}
          emptyText="Nothing has expired."
          canManage={manage}
        />
        <ExpiryTable
          title={`Expiring within ${windowDays} days`}
          rows={report.expiring}
          today={today}
          emptyText={`Nothing expires within ${windowDays} days.`}
          canManage={manage}
        />
      </div>
    </>
  );
}
