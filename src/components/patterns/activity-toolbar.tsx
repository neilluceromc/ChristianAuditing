"use client";

import { SearchBox } from "@/components/patterns/search-box";
import { FacetDropdown, type FacetOptionLike } from "@/components/patterns/facet-dropdown";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { ACTIVITY_LIST_CONFIG } from "@/lib/activity-list";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";

/**
 * Phase 33 (spec §6): the house list shape on the four feeds — the shared SearchBox (keyed on q,
 * Clear ×, `· Enter`) finding tags, people and ref nos as well as actions and actors; the Action
 * facet; the entry count. Every navigation runs in the list's shared transition so the feed reads
 * busy. The value-only chips and Clear filters sit under it (activity-list-page.tsx).
 */
export function ActivityToolbar({
  state, total, actionOptions, base,
}: {
  state: ListState; total: number; actionOptions: FacetOptionLike[]; base: string;
}) {
  const { navigate } = useListNavigation();
  const href = (s: ListState) => base + serializeListState(s, ACTIVITY_LIST_CONFIG);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchBox
        value={state.q}
        // P-14: the feeds' own accessible name; /audit keeps "Search audit log".
        ariaLabel="Search activity"
        placeholder="Search tag, person, ref no · Enter"
        onSubmit={(q) => navigate(href(withSearch(state, q)))}
      />
      <FacetDropdown
        label="Action"
        options={actionOptions}
        selected={state.filters.action ?? []}
        onApply={(values) => navigate(href(withFilter(state, "action", values)))}
      />
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "entry" : "entries"}
      </span>
    </div>
  );
}
