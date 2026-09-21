"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { HOLDS_LIST_CONFIG, type ReservationTab } from "@/lib/holds";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { HoldFacets } from "@/server/modules/reservations/queries";

/** Phase 26 (spec §5.4): search + Employee/Department facets over the current tab. The tab travels as `state=`. */
export function HoldsToolbar({ tab, state, total, facets }: { tab: ReservationTab; state: ListState; total: number; facets: HoldFacets }) {
  const router = useRouter();
  const href = (s: ListState) => {
    const qs = serializeListState(s, HOLDS_LIST_CONFIG);
    return "/reservations" + (qs ? `${qs}&state=${tab}` : `?state=${tab}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint"><Icon name="search" size={14} /></span>
        <Input type="search" aria-label="Search holds" placeholder="Tag, model or person" defaultValue={state.q} className="pl-8"
          onKeyDown={(e) => { if (e.key === "Enter") router.push(href(withSearch(state, e.currentTarget.value))); }} />
      </div>
      <FacetDropdown label="Employee" options={facets.employee} selected={state.filters.employee ?? []}
        onApply={(values) => router.push(href(withFilter(state, "employee", values)))} />
      <FacetDropdown label="Department" options={facets.department} selected={state.filters.department ?? []}
        onApply={(values) => router.push(href(withFilter(state, "department", values)))} />
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">{total} {total === 1 ? "hold" : "holds"}</span>
    </div>
  );
}
