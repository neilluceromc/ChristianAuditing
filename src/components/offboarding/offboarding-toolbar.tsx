"use client";

import { useRouter } from "next/navigation";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { OFFBOARDING_LIST_CONFIG } from "@/lib/offboarding-list";
import { serializeListState, withFilter, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

/**
 * Scaled-down suppliers-toolbar.tsx: no search box (the queue has none — R2,
 * `listOffboarding` never reads `state.q`), two facets. `progress`'s own
 * facet options come back from the server labelled "Open"/"Complete" (the
 * same short words `progressOf` returns), but the wizard's actual choice is
 * between "nothing left to decide" and "something still is" — this component
 * relabels the two values for the dropdown only, the count and the URL value
 * underneath (`open`/`complete`) are untouched.
 */
const PROGRESS_LABEL: Record<string, string> = {
  open: "Has undecided items",
  complete: "All decided",
};

export function OffboardingToolbar({
  state,
  facets,
}: {
  state: ListState;
  facets: Record<"department" | "progress", FacetOption[]>;
}) {
  const router = useRouter();

  function go(next: ListState) {
    router.push("/offboarding" + serializeListState(next, OFFBOARDING_LIST_CONFIG));
  }

  const progressOptions = facets.progress.map((o) => ({ ...o, label: PROGRESS_LABEL[o.value] ?? o.label }));

  return (
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
    </div>
  );
}
