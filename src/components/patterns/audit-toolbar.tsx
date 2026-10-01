"use client";

import { usePathname } from "next/navigation";
import { SearchBox } from "@/components/patterns/search-box";
import { FacetDropdown, type FacetOptionLike } from "@/components/patterns/facet-dropdown";
import { WhenPills } from "@/components/patterns/when-pills";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { AUDIT_LIST_CONFIG } from "@/lib/audit-list";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";

/**
 * Phase 33 (spec §6): the house list shape on /audit — the shared SearchBox (keyed on q, Clear ×,
 * `· Enter`) finding tags, people and ref nos as well as actions and actors; the Entity facet; the
 * When pills; every navigation in the list's shared transition so the table reads busy.
 */
export function AuditToolbar({
  state,
  total,
  entityOptions,
}: {
  state: ListState;
  total: number;
  entityOptions: FacetOptionLike[];
}) {
  const pathname = usePathname();
  const { navigate } = useListNavigation();

  const href = (s: ListState) => pathname + serializeListState(s, AUDIT_LIST_CONFIG);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchBox
        value={state.q}
        // P-14: the accessible name stays "Search audit log" (e2e pins it); only the placeholder changed.
        ariaLabel="Search audit log"
        placeholder="Search tag, person, ref no, action · Enter"
        onSubmit={(q) => navigate(href(withSearch(state, q)))}
      />
      <FacetDropdown
        label="Entity"
        options={entityOptions}
        selected={state.filters.entity ?? []}
        onApply={(values) => navigate(href(withFilter(state, "entity", values)))}
      />
      <WhenPills
        value={state.filters.when?.[0]}
        hrefFor={(when) => href(withFilter(state, "when", when ? [when] : []))}
      />
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "entry" : "entries"}
      </span>
    </div>
  );
}
