"use client";

import { usePathname } from "next/navigation";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { NavLink, useListNavigation } from "@/components/patterns/list-navigation";
import { SearchBox } from "@/components/patterns/search-box";
import { LabelledSelect } from "@/components/patterns/labelled-select";
import { LIST } from "@/components/patterns/list-styles";
import { EMPLOYEE_SORT_OPTIONS, EMPLOYEES_LIST_CONFIG, employeeSortValue, withEmployeeSort } from "@/lib/employees-list";
import { TAB_FACETS } from "@/lib/employee-tabs";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { EmployeeFacets } from "@/server/modules/employees/queries";

/**
 * Phase 45 (spec §3.2): the Employees filter row, meant for a StickyToolbar — Search (flexible, up to 420 px) and
 * Works for and Sort, then on the right Clear filters (only while a search, Works for or tab is set), the people count with
 * the number in bold, and the leavers clause: "· N leavers hidden" (a link that shows them) or "· leavers shown ·
 * Hide". The Staff and Employment facets and the Show leavers / Policy gaps only pills are gone: the tabs and the
 * leavers link replace them, and their URL params (`kind`, `employment`, `leavers`, `gaps`) still filter.
 */
export function EmployeesToolbar({
  state,
  total,
  facets,
  gapsOnly,
  hiddenLeavers,
}: {
  state: ListState;
  total: number;
  facets: EmployeeFacets;
  gapsOnly: boolean;
  hiddenLeavers: number;
}) {
  const { navigate, replace } = useListNavigation();
  const pathname = usePathname();
  // Phase 20 (spec §5): leavers hidden by default — an explicit employment facet always wins over the toggle
  // (buildEmployeeWhere's own rule), but the link only needs to know whether IT itself asked to see them.
  const showingLeavers = (state.filters.leavers ?? []).includes("1");
  // The leavers scope is not a filter: Clear filters keeps it, and does not show for it alone.
  const tabSet = gapsOnly || TAB_FACETS.some((f) => (state.filters[f]?.length ?? 0) > 0);
  const filtered = state.q !== "" || (state.filters.department?.length ?? 0) > 0 || tabSet;
  const cleared: ListState = {
    ...state,
    q: "",
    filters: showingLeavers ? { leavers: ["1"] } : {},
    page: 1,
  };

  const href = (s: ListState, gaps: boolean) => {
    const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
    if (!gaps) return pathname + qs;
    return pathname + (qs ? `${qs}&gaps=1` : "?gaps=1");
  };
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The house search (spec §7.2: as you type, starts-with first). */}
      <SearchBox
        value={state.q}
        ariaLabel="Search employees"
        placeholder="Search name, EMP number, title or client"
        onSubmit={(q) => replace(href(withSearch(state, q), gapsOnly))}
        className="w-full max-w-[420px] flex-1 basis-[280px]"
        inputClassName="h-9 py-0 text-[13px]"
      />
      <div className={LIST.tall}>
        <FacetDropdown
          label="Works for"
          options={facets.department}
          selected={state.filters.department ?? []}
          onApply={(values) => navigate(href(withFilter(state, "department", values), gapsOnly))}
        />
      </div>
      {/* Spec §7.3: the sort options are the list's own URL sorts; a column-header sort the options don't name shows
          "Column order" (disabled: it is a state, not a pick). */}
      <LabelledSelect
        label="Sort"
        value={employeeSortValue(state.sort)}
        onChange={(v) => navigate(href(withEmployeeSort(state, v), gapsOnly))}
      >
        {employeeSortValue(state.sort) === "" && <option value="" disabled>Column order</option>}
        {EMPLOYEE_SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </LabelledSelect>
      <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-[12.5px] tabular-nums text-fg-muted">
        {filtered && (
          <NavLink href={href(cleared, false)} className="font-medium text-accent hover:underline">
            Clear filters
          </NavLink>
        )}
        <p aria-live="polite">
          <span className="font-semibold text-fg">{fmt(total)}</span> {total === 1 ? "person" : "people"}
          {showingLeavers ? (
            <>
              {" · leavers shown · "}
              <NavLink
                href={href(withFilter(state, "leavers", []), gapsOnly)}
                className="text-accent hover:underline"
              >
                Hide
              </NavLink>
            </>
          ) : hiddenLeavers > 0 ? (
            <>
              {" · "}
              <NavLink href={href(withFilter(state, "leavers", ["1"]), gapsOnly)} className="text-accent hover:underline">
                {fmt(hiddenLeavers)} leaver{hiddenLeavers === 1 ? "" : "s"} hidden
              </NavLink>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
