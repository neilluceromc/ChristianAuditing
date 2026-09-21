import { requireUser } from "@/server/auth/guards";
import { clearFilters, parseListState, serializeListState, toggleSort, toSearchParams } from "@/lib/url-state";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { employeeFacetOptions, listEmployees } from "@/server/modules/employees/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { EmployeesTable } from "@/components/employees/employees-table";
import { EmployeesToolbar } from "@/components/employees/employees-toolbar";

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

  const [{ rows, total, page, pageCount }, facets] = await Promise.all([
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

  return (
    <>
      <PageHeader
        title="Employees"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={
          <>
            {/* Carries the same q/facets/gaps as the list — the export
                honours "Policy gaps only" exactly like listEmployees does,
                via the same narrow-candidate-pass cut, so the sheet matches
                what's on screen. */}
            <ButtonLink href={href(state, gapsOnly, "/employees/export")}>Export</ButtonLink>
            {/* Absent, not disabled, for a role that can't reach the page —
                canMutate is exactly admin/it_staff, matching the PATH_RULES
                entry that gates /employees/import itself (E-7). */}
            {canMutate && <ButtonLink href="/employees/import">Import</ButtonLink>}
            {canMutate && <ButtonLink variant="primary" href="/employees/new">New employee</ButtonLink>}
          </>
        }
      />
      <div className="flex flex-col gap-2">
        <EmployeesToolbar state={state} total={total} facets={facets} gapsOnly={gapsOnly} />
        {rows.length > 0 ? (
          <>
            <EmployeesTable rows={rows} state={state} sortHrefs={sortHrefs} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount}</span>
              <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
            </div>
          </>
        ) : hasFilters ? (
          <EmptyState
            title="Your filters matched nothing"
            actions={<ButtonLink href={href(clearFilters(state), false)}>Clear filters</ButtonLink>}
          />
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
