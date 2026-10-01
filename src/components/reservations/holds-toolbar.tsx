"use client";

import { SearchBox } from "@/components/patterns/search-box";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { NavLink, useListNavigation } from "@/components/patterns/list-navigation";
import { HOLDS_LIST_CONFIG, type ReservationTab } from "@/lib/holds";
import { clearFilters, serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { HoldFacets } from "@/server/modules/reservations/queries";

/** The list's URL: the tab travels as `state=` beside the list state (the page builds the same one server-side). */
function holdsHref(s: ListState, tab: ReservationTab): string {
  const qs = serializeListState(s, HOLDS_LIST_CONFIG);
  return "/reservations" + (qs ? `${qs}&state=${tab}` : `?state=${tab}`);
}

/**
 * Phase 26 (spec §5.4): search + Employee/Department facets over the current tab.
 * Phase 33 (spec §5.2): the house list shape — the shared SearchBox (keyed on q,
 * Clear ×, `· Enter`), value-only chips, navigations in the list's shared
 * transition — and a count line naming how many live holds run out within two days.
 */
export function HoldsToolbar({ tab, state, total, soon, facets }: {
  tab: ReservationTab; state: ListState; total: number; soon: number; facets: HoldFacets;
}) {
  const { navigate } = useListNavigation();
  const href = (s: ListState) => holdsHref(s, tab);

  // Value-only chips: the facet a value belongs to is the dropdown it came from.
  const chips: FilterChip[] = [];
  if (state.q) chips.push({ label: `Search: ${state.q}`, removeHref: href(withSearch(state, "")) });
  for (const facet of HOLDS_LIST_CONFIG.facets) {
    const values = state.filters[facet] ?? [];
    const options = facet === "employee" ? facets.employee : facets.department;
    for (const value of values) {
      chips.push({
        label: options.find((o) => o.value === value)?.label ?? value,
        removeHref: href(withFilter(state, facet, values.filter((v) => v !== value))),
      });
    }
  }

  // The expiring-soon link opens the Active tab, soonest first, keeping the search and facets.
  const soonHref = holdsHref({ ...state, sort: [{ key: "expiresAt", dir: "asc" }], page: 1 }, "ACTIVE");

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={state.q}
          ariaLabel="Search holds"
          placeholder="Tag, model or person · Enter"
          onSubmit={(q) => navigate(href(withSearch(state, q)))}
        />
        <FacetDropdown label="Employee" options={facets.employee} selected={state.filters.employee ?? []}
          onApply={(values) => navigate(href(withFilter(state, "employee", values)))} />
        <FacetDropdown label="Department" options={facets.department} selected={state.filters.department ?? []}
          onApply={(values) => navigate(href(withFilter(state, "department", values)))} />
        <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
          {total} {total === 1 ? "hold" : "holds"}
          {soon > 0 && (
            <>
              {" · "}
              <NavLink href={soonHref} className="text-accent underline underline-offset-2 hover:opacity-80">
                {soon} {soon === 1 ? "expires" : "expire"} within 2 days
              </NavLink>
            </>
          )}
        </span>
      </div>
      <ChipFilterRow chips={chips} clearHref={href(clearFilters(state))} />
    </div>
  );
}
