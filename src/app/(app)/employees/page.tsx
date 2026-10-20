import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import {
  clearFilters, parseListState, serializeListState, toggleSort, toSearchParams, withFilter, withPer, withSearch,
} from "@/lib/url-state";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { buildEmployeeTabs } from "@/lib/employee-tabs";
import { employeeFacetOptions, employeeTabCounts, listEmployees } from "@/server/modules/employees/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { ListNavigationProvider, ListPendingRegion } from "@/components/patterns/list-navigation";
import { ListTabs } from "@/components/patterns/list-tabs";
import { StickyList, StickyToolbar } from "@/components/patterns/sticky-list";
import { ListFooter } from "@/components/patterns/list-footer";
import { EmployeesTable } from "@/components/employees/employees-table";
import { EmployeesToolbar } from "@/components/employees/employees-toolbar";
import { EmployeesMoreMenu } from "@/components/employees/employees-more-menu";

export const metadata: Metadata = { title: pageTitle("Employees") };

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  // Matches the PATH_RULES entry that gates /employees/import itself
  // (workspaces.ts, E-7) — the same canMutate the inventory list page uses
  // for its own Import button. Phase 45 (spec §3.4): also who sees the
  // checkboxes and the bulk bar.
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, EMPLOYEES_LIST_CONFIG);
  const gapsOnly = sp.get("gaps") === "1";
  // One clock for the whole render: the list, the facet counts and the tab counts all judge "New this month"
  // at the same instant, so they cannot disagree across the month boundary.
  const now = new Date();

  const [{ rows, total, page, pageCount, hiddenLeavers }, facets, tabCounts, departments] = await Promise.all([
    listEmployees(state, gapsOnly, now),
    employeeFacetOptions(state, now),
    employeeTabCounts(state, now),
    // Transfer… (spec §3.4) offers active departments and clients; only admin and it_staff have the bulk bar.
    canMutate
      ? prisma.department.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, kind: true, archivedAt: true },
        orderBy: { name: "asc" },
      })
      : Promise.resolve([]),
  ]);

  const href = (s: typeof state, gaps = gapsOnly, base = "/employees") => {
    const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
    return base + (gaps ? (qs ? `${qs}&gaps=1` : "?gaps=1") : qs);
  };
  // The leavers scope (`leavers=1`) is not a filter (as in the toolbar): every Clear filters on the page keeps it,
  // and a page with only that scope set and no rows is simply empty, not "filters matched nothing".
  const showingLeavers = (state.filters.leavers ?? []).includes("1");
  const hasFilters =
    state.q !== "" || Object.keys(state.filters).some((f) => f !== "leavers" && (state.filters[f]?.length ?? 0) > 0) || gapsOnly;
  const clearedHref = href({ ...clearFilters(state), filters: showingLeavers ? { leavers: ["1"] } : {} }, false);
  const sortHrefs: Record<string, string> = Object.fromEntries(
    EMPLOYEES_LIST_CONFIG.sortable.map((key) => [key, href({ ...state, sort: toggleSort(state.sort, key), page: 1 })]),
  );
  // Phase 45 (spec §3.1): one tab at a time; each count is what that tab lists within the current search, Works
  // for and leavers scope. Built here, so only strings cross into the client tabs.
  const tabs = buildEmployeeTabs(state, gapsOnly, tabCounts, (s, gaps) => href(s, gaps));
  // Selection resets whenever the URL changes: the table is keyed on the serialized query.
  const listKey = href(state);

  // Filtered-empty only (brief step 3): one chip per active filter, each
  // removing just itself — mirrors inventory/page.tsx's chip-building loop,
  // narrowed to employees' facets plus q and the gaps toggle.
  const chips: FilterChip[] = [];
  if (state.q) {
    chips.push({ label: `search: ${state.q}`, removeHref: href(withSearch(state, ""), gapsOnly) });
  }
  const departmentValues = state.filters.department ?? [];
  for (const value of departmentValues) {
    const label = facets.department.find((o) => o.value === value)?.label ?? value;
    chips.push({
      label,
      removeHref: href(withFilter(state, "department", departmentValues.filter((v) => v !== value)), gapsOnly),
    });
  }
  const kindValues = state.filters.kind ?? [];
  for (const value of kindValues) {
    const label = facets.kind.find((o) => o.value === value)?.label ?? value;
    chips.push({ label, removeHref: href(withFilter(state, "kind", kindValues.filter((v) => v !== value)), gapsOnly) });
  }
  const employmentValues = state.filters.employment ?? [];
  for (const value of employmentValues) {
    const label = facets.employment.find((o) => o.value === value)?.label ?? value;
    chips.push({
      label,
      removeHref: href(withFilter(state, "employment", employmentValues.filter((v) => v !== value)), gapsOnly),
    });
  }
  if ((state.filters.joined ?? []).includes("month")) {
    chips.push({ label: "New this month", removeHref: href(withFilter(state, "joined", []), gapsOnly) });
  }
  if (showingLeavers) {
    chips.push({ label: "Leavers shown", removeHref: href(withFilter(state, "leavers", []), gapsOnly) });
  }
  if (gapsOnly) {
    chips.push({ label: "Missing kit", removeHref: href(state, false) });
  }

  return (
    <>
      <PageHeader
        title="Employees"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={
          <>
            {canMutate && <ButtonLink variant="primary" href="/employees/new">New employee</ButtonLink>}
            {/* Import (canMutate — same PATH_RULES gate as /employees/import
                itself, E-7) and Export (carries the same q/facets/gaps as
                the list, a route-handler download — ruling R5) collapse
                behind this menu so New employee is the one primary action. */}
            <EmployeesMoreMenu exportHref={href(state, gapsOnly, "/employees/export")} canMutate={canMutate} />
          </>
        }
      />
      <ListNavigationProvider>
        <div className="flex flex-col gap-4">
          <ListTabs tabs={tabs} label="Filter employees" />
          {/* Phase 45 (spec §4.3): the filter row sticks to the top of the window, the table's head under it,
              and the footer to the bottom, while the list is on screen. */}
          <StickyList>
            <StickyToolbar>
              <EmployeesToolbar
                state={state}
                total={total}
                facets={facets}
                gapsOnly={gapsOnly}
                hiddenLeavers={hiddenLeavers}
              />
            </StickyToolbar>
            {/* Search, Works for, tab, sort and page navigations share one transition; this region dims
                (data-pending, aria-busy) while the next view renders. */}
            <ListPendingRegion className="mt-2 flex flex-col gap-2">
              {rows.length > 0 ? (
                <>
                  {/* key: any URL-state change remounts the island, so a selection never survives a
                      page/filter/sort change (it would act on rows no longer on screen). */}
                  <EmployeesTable
                    key={listKey}
                    rows={rows}
                    state={state}
                    sortHrefs={sortHrefs}
                    canMutate={canMutate}
                    departments={departments}
                  />
                  <ListFooter
                    page={page}
                    per={state.per}
                    total={total}
                    pageCount={pageCount}
                    hrefFor={(p) => href({ ...state, page: p })}
                    perHrefFor={(n) => href(withPer(state, n))}
                  />
                </>
              ) : hasFilters ? (
                <>
                  {/* all three Clear filters here (the toolbar's, the chip row's, this one) keep the leavers scope */}
                  <ChipFilterRow chips={chips} clearHref={clearedHref} />
                  <EmptyState
                    title="Your filters matched nothing"
                    actions={<ButtonLink href={clearedHref}>Clear filters</ButtonLink>}
                  />
                </>
              ) : (
                <EmptyState
                  title="No employees yet"
                  description="Add one with New employee, or import a sheet."
                  actions={canMutate ? <ButtonLink href="/employees/new">New employee</ButtonLink> : undefined}
                />
              )}
            </ListPendingRegion>
          </StickyList>
        </div>
      </ListNavigationProvider>
    </>
  );
}
