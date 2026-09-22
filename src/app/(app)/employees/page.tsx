import { requireUser } from "@/server/auth/guards";
import {
  clearFilters, parseListState, serializeListState, toggleSort, toSearchParams, withFilter, withSearch,
} from "@/lib/url-state";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { employeeFacetOptions, listEmployees } from "@/server/modules/employees/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { EmployeesTable } from "@/components/employees/employees-table";
import { EmployeesToolbar } from "@/components/employees/employees-toolbar";
import { EmployeesMoreMenu } from "@/components/employees/employees-more-menu";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  // Matches the PATH_RULES entry that gates /employees/import itself
  // (workspaces.ts, E-7) — the same canMutate the inventory list page uses
  // for its own Import button.
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, EMPLOYEES_LIST_CONFIG);
  const gapsOnly = sp.get("gaps") === "1";

  const [{ rows, total, page, pageCount, hiddenLeavers }, facets] = await Promise.all([
    listEmployees(state, gapsOnly),
    employeeFacetOptions(state),
  ]);

  const href = (s: typeof state, gaps = gapsOnly, base = "/employees") => {
    const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
    return base + (gaps ? (qs ? `${qs}&gaps=1` : "?gaps=1") : qs);
  };
  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0 || gapsOnly;
  const sortHrefs: Record<string, string> = Object.fromEntries(
    EMPLOYEES_LIST_CONFIG.sortable.map((key) => [key, href({ ...state, sort: toggleSort(state.sort, key), page: 1 })]),
  );

  // Filtered-empty only (brief step 3): one chip per active filter, each
  // removing just itself — mirrors inventory/page.tsx's chip-building loop,
  // narrowed to employees' three facets plus q and the gaps toggle.
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
  const employmentValues = state.filters.employment ?? [];
  for (const value of employmentValues) {
    const label = facets.employment.find((o) => o.value === value)?.label ?? value;
    chips.push({
      label,
      removeHref: href(withFilter(state, "employment", employmentValues.filter((v) => v !== value)), gapsOnly),
    });
  }
  if ((state.filters.leavers ?? []).includes("1")) {
    chips.push({ label: "Leavers shown", removeHref: href(withFilter(state, "leavers", []), gapsOnly) });
  }
  if (gapsOnly) {
    chips.push({ label: "Policy gaps only", removeHref: href(state, false) });
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
      <div className="flex flex-col gap-2">
        <EmployeesToolbar state={state} total={total} facets={facets} gapsOnly={gapsOnly} hiddenLeavers={hiddenLeavers} />
        {rows.length > 0 ? (
          <>
            <EmployeesTable rows={rows} state={state} sortHrefs={sortHrefs} />
            <div className="flex items-center justify-between pt-1">
              {pageCount > 1 && (
                <span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount}</span>
              )}
              <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
            </div>
          </>
        ) : hasFilters ? (
          <>
            <ChipFilterRow chips={chips} clearHref={href(clearFilters(state), false)} />
            <EmptyState
              title="Your filters matched nothing"
              actions={<ButtonLink href={href(clearFilters(state), false)}>Clear filters</ButtonLink>}
            />
          </>
        ) : (
          <EmptyState
            title="No employees yet"
            description="Add one with New employee, or import a sheet."
            actions={canMutate ? <ButtonLink href="/employees/new">New employee</ButtonLink> : undefined}
          />
        )}
      </div>
    </>
  );
}
