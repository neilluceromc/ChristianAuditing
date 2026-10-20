import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { ASSET_CLASSES, CLASS_LABEL, STATUS_LABEL } from "@/lib/asset-class";
import { FIN_LABEL } from "@/lib/registration";
import {
  LIFE_LABEL, clearFinanceFilters, financeClassHref, financeExportHref, financeListHref, parseFinanceListState, withFinance,
  type FinanceListState,
} from "@/lib/finance-list";
import { financeAssets, financeClassCount } from "@/server/modules/finance/queries";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { ListNavigationProvider, ListPendingRegion } from "@/components/patterns/list-navigation";
import { ListTabs, type TabDef } from "@/components/patterns/list-tabs";
import { StickyList, StickyToolbar } from "@/components/patterns/sticky-list";
import { ListFooter } from "@/components/patterns/list-footer";
import { MoneyTotals } from "@/components/finance/money-totals";
import { CategoryTiles, StatusTiles } from "@/components/finance/category-tiles";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { FinanceToolbar } from "@/components/finance/finance-toolbar";
import { FinanceTable } from "@/components/finance/finance-table";

export const metadata: Metadata = { title: pageTitle("Assets") };

/**
 * Phase 47 (spec §3): Finance → Assets. Top to bottom: the class tabs with counts; the four money cards; the category
 * tiles; the status tiles; then one table card — the finance-state tabs, the (sticky) toolbar, the active-filter
 * chips and the table — and the Phase 45 footer. Every filter is in the URL (`parseFinanceListState`); every href is
 * built on the server, so only strings reach the client parts.
 */
export default async function FinanceAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "finance_staff");
  const parsed = parseFinanceListState(toSearchParams(await searchParams));
  const now = new Date();
  const otherCls = parsed.cls === "IT" ? "PURCHASING" : "IT";
  // the shown class's count is its All categories tile; only the other class needs a query
  const [data, otherCount] = await Promise.all([financeAssets(parsed, now), financeClassCount(otherCls)]);
  // The view as applied: the query drops a category that is not a tile of the class, and clamps the page.
  const state: FinanceListState = { ...parsed, category: data.category, page: data.page, per: data.per };
  const href = (s: FinanceListState) => financeListHref(s);

  // Spec §3 item 1: switching class clears every filter; the current class's tab is this very view.
  const classTabs: TabDef[] = ASSET_CLASSES.map((c) => ({
    key: c,
    label: CLASS_LABEL[c],
    count: c === state.cls ? data.categoryTiles[0].count : otherCount,
    href: c === state.cls ? href(state) : financeClassHref(state, c),
    on: c === state.cls,
  }));

  // Spec §3 item 5: one chip per filter in force (the sort is not a filter), each removing only itself.
  const chips: FilterChip[] = [];
  if (state.q) chips.push({ label: `Search: ${state.q}`, removeHref: href(withFinance(state, { q: "" })) });
  if (state.category) chips.push({ label: data.categoryLabel ?? "Category", removeHref: href(withFinance(state, { category: null })) });
  if (state.status) chips.push({ label: STATUS_LABEL[state.status], removeHref: href(withFinance(state, { status: null })) });
  if (state.fin) chips.push({ label: FIN_LABEL[state.fin], removeHref: href(withFinance(state, { fin: null })) });
  if (state.life) chips.push({ label: LIFE_LABEL[state.life], removeHref: href(withFinance(state, { life: null })) });
  const clearHref = href(clearFinanceFilters(state));

  return (
    <>
      <PageHeader title="Assets" actions={<ButtonLink native href={financeExportHref(state)}>Export</ButtonLink>} />
      <ListNavigationProvider>
        <div className="flex flex-col gap-4">
          <ListTabs tabs={classTabs} label="Asset class" />
          <MoneyTotals kpis={data.kpis} asOfLabel={data.asOfLabel} />
          <CategoryTiles tiles={data.categoryTiles} state={state} />
          <StatusTiles tiles={data.statusTiles} state={state} />
          {/* Phase 45 (spec §4.3): the toolbar sticks to the top of the window, the table's head under it, and the
              footer to the bottom, while the list is on screen. */}
          <StickyList>
            <section aria-label={`${CLASS_LABEL[state.cls]} assets`} className="rounded-(--radius-card) border border-border bg-surface shadow-card">
              <div className="px-4">
                <FinanceTabs state={state} counts={data.finCounts} />
              </div>
              <StickyToolbar className="mx-0 rounded-t-none bg-surface px-4">
                <FinanceToolbar
                  state={state}
                  tiles={data.categoryTiles.filter((t) => t.id !== "all").map((t) => ({ id: t.id, name: t.name }))}
                  categoryLabel={data.categoryLabel}
                  shown={data.shown}
                />
              </StickyToolbar>
              {/* every list navigation shares one transition; this region dims (data-pending, aria-busy) meanwhile */}
              <ListPendingRegion className="flex flex-col">
                {chips.length > 0 && (
                  <div className="px-4">
                    <ChipFilterRow chips={chips} clearHref={clearHref} clearLabel="Clear all" />
                  </div>
                )}
                {data.rows.length > 0 ? (
                  <FinanceTable rows={data.rows} shown={data.shown} />
                ) : chips.length > 0 ? (
                  <div className="border-t border-border">
                    <EmptyState
                      title="No asset matches"
                      description="Try a different search, tile or tab."
                      actions={<ButtonLink href={clearHref}>Clear all</ButtonLink>}
                    />
                  </div>
                ) : (
                  <div className="border-t border-border">
                    <EmptyState title={`No ${CLASS_LABEL[state.cls]} asset is registered yet`} description="Assets appear here as soon as they are added." />
                  </div>
                )}
              </ListPendingRegion>
            </section>
            {data.rows.length > 0 && (
              <ListFooter
                page={data.page}
                per={data.per}
                total={data.total}
                pageCount={data.pageCount}
                hrefFor={(p) => href({ ...state, page: p })}
                perHrefFor={(n) => href({ ...state, per: n, page: 1 })}
              />
            )}
          </StickyList>
        </div>
      </ListNavigationProvider>
    </>
  );
}
