import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import Link from "next/link";
import { policyRows, scheduleView } from "@/server/modules/finance/depreciation-queries";
import { ASSET_CLASSES, CLASS_LABEL, parseCls } from "@/lib/asset-class";
import { parsePage } from "@/lib/paging";
import { manilaMonth } from "@/lib/depreciation";
import { ButtonLink } from "@/components/ui/button-link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ScheduleCategoryTable, ScheduleSummaryTable } from "@/components/finance/schedule-table";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import { Banner } from "@/components/ui/banner";
import { Table, TBody, THead, Th, Tr } from "@/components/ui/table";
import { PolicyRow } from "@/components/finance/policy-row";

export const metadata: Metadata = { title: pageTitle("Depreciation") };

export default async function DepreciationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "finance_staff");
  const params = toSearchParams(await searchParams);
  const tab = params.get("tab") === "policies" ? "policies" : "schedule";

  const now = new Date();
  const thisYear = Math.floor(manilaMonth(now) / 12);
  const cls = parseCls(params.get("cls")) ?? "IT";
  const rawYear = params.get("year") ?? "";
  const parsedYear = /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : thisYear;
  const catId = params.get("cat") ?? "";
  // Phase 43: one grid pass for the summary and the drill-down (scheduleView).
  const view = tab === "schedule" ? await scheduleView(cls, year, catId, parsePage(params), now) : null;
  const sched = view?.summary ?? null;
  const drill = view?.drill ?? null;
  const schedHref = (extra = "") => `/finance/depreciation?tab=schedule&year=${year}&cls=${cls}${extra}`;
  const years = sched ? (sched.years.includes(year) ? sched.years : [...sched.years, year].sort((a, b) => a - b)) : [];

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
        {sched && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Tabs
                label="Asset class"
                className="border-b-0"
                items={ASSET_CLASSES.map((c) => ({
                  label: CLASS_LABEL[c],
                  href: `/finance/depreciation?cls=${c}&year=${year}`,
                  active: c === cls,
                }))}
              />
              <div className="flex items-center gap-2">
                <form method="get" action="/finance/depreciation" className="flex items-center gap-2">
                  <input type="hidden" name="tab" value="schedule" />
                  <input type="hidden" name="cls" value={cls} />
                  <Select aria-label="Year" name="year" defaultValue={String(year)} className="w-auto">
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </Select>
                  <Button type="submit" variant="secondary" size="sm">Show</Button>
                </form>
                <ButtonLink native size="sm" href={`/finance/depreciation/export?year=${year}&cls=${cls}`}>Export</ButtonLink>
              </div>
            </div>
            <p className="text-xs text-fg-muted">This month is counted; later months are projected.</p>
            {(sched.notStarted > 0 || sched.noPolicy > 0) && (
              <p className="text-xs text-fg-muted">
                {sched.notStarted} assets aren&apos;t depreciating yet · {sched.noPolicy} have no policy{" "}
                <Link href="/finance/depreciation?tab=policies" className="font-medium text-accent hover:underline">Set policies</Link>
              </p>
            )}
            {catId && !drill && (
              <p className="text-xs text-fg-muted">Category not found — showing all categories.</p>
            )}
            {drill ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-fg">{drill.category} — {year}</h2>
                  <Link href={schedHref()} className="text-xs font-medium text-accent hover:underline">← All categories</Link>
                </div>
                {drill.rows.length === 0 ? (
                  <p className="text-[12.5px] text-fg-muted">No asset in {drill.category} depreciates in {year}.</p>
                ) : (
                  <ScheduleCategoryTable year={year} category={drill.category} rows={drill.rows} subtotal={drill.subtotal} subtotalCostC={drill.subtotalCostC} />
                )}
                <Pagination
                  page={drill.page}
                  pageCount={drill.pageCount}
                  hrefFor={(p) => schedHref(`&cat=${encodeURIComponent(catId)}${p > 1 ? `&page=${p}` : ""}`)}
                />
              </>
            ) : sched.categories.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted">No asset depreciates in {year}.</p>
            ) : (
              <ScheduleSummaryTable
                year={year}
                categories={sched.categories}
                total={sched.total}
                totalCostC={sched.totalCostC}
                hrefFor={(id) => schedHref(`&cat=${encodeURIComponent(id)}`)}
              />
            )}
          </>
        )}
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
                {policies.map((p) => <PolicyRow key={`${p.id}:${p.lifeMonths}:${p.salvagePercent}`} row={p} />)}
              </TBody>
            </Table>
          </>
        )}
      </div>
    </>
  );
}
