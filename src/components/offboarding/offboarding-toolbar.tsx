"use client";

import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { OFFBOARDING_LIST_CONFIG } from "@/lib/offboarding-list";
import { clearFilters, serializeListState, withFilter, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

/**
 * Scaled-down suppliers-toolbar.tsx: no search box (the queue has none — R2,
 * `listOffboarding` never reads `state.q`), three facets. `progress`'s own
 * facet options come back from the server labelled "Open"/"Complete" (the
 * same short words `progressOf` returns), but the wizard's actual choice is
 * between "nothing left to decide" and "something still is" — this component
 * relabels the two values for the dropdown only, the count and the URL value
 * underneath (`open`/`complete`) are untouched.
 *
 * Phase 33 (spec §6.3): the house shape minus the search — each Apply runs in
 * the list's shared transition (the page wraps the queue in ListPendingRegion),
 * and the active facets show as value-only chips with Clear filters.
 */
const PROGRESS_LABEL: Record<string, string> = {
  open: "Has undecided items",
  complete: "All decided",
};

const DUE_LABEL: Record<string, string> = { overdue: "Overdue", "on-track": "On track" };

export function OffboardingToolbar({
  state,
  facets,
}: {
  state: ListState;
  facets: Record<"department" | "progress" | "due", FacetOption[]>;
}) {
  const { navigate } = useListNavigation();
  const href = (next: ListState) => "/offboarding" + serializeListState(next, OFFBOARDING_LIST_CONFIG);
  const go = (next: ListState) => navigate(href(next));

  const progressOptions = facets.progress.map((o) => ({ ...o, label: PROGRESS_LABEL[o.value] ?? o.label }));
  const dueOptions = facets.due.map((o) => ({ ...o, label: DUE_LABEL[o.value] ?? o.label }));

  // Value-only chips: the facet a value belongs to is the control it came from.
  const chipsFor = (facet: "department" | "progress" | "due", options: FacetOption[]): FilterChip[] => {
    const selected = state.filters[facet] ?? [];
    return selected.map((value) => ({
      label: options.find((o) => o.value === value)?.label ?? value,
      removeHref: href(withFilter(state, facet, selected.filter((v) => v !== value))),
    }));
  };
  const chips = [
    ...chipsFor("department", facets.department),
    ...chipsFor("progress", progressOptions),
    ...chipsFor("due", dueOptions),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <FacetDropdown
          label="Department"
          options={facets.department}
          selected={state.filters.department ?? []}
          onApply={(values) => go(withFilter(state, "department", values))}
        />
        <FacetDropdown
          label="Progress"
          options={progressOptions}
          selected={state.filters.progress ?? []}
          onApply={(values) => go(withFilter(state, "progress", values))}
        />
        <FacetDropdown
          label="Due"
          options={dueOptions}
          selected={state.filters.due ?? []}
          onApply={(values) => go(withFilter(state, "due", values))}
        />
      </div>
      <ChipFilterRow chips={chips} clearHref={href(clearFilters(state))} />
    </>
  );
}
