"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FacetDropdown, type FacetOptionLike } from "@/components/patterns/facet-dropdown";
import { ACTIVITY_LIST_CONFIG } from "@/lib/activity-list";
import { serializeListState, withFilter, type ListState } from "@/lib/url-state";

/** Phase 27 (spec §5.2): the feeds' one facet, a Clear link while a selection is on, and the entry count. */
export function ActivityToolbar({
  state, total, actionOptions, base,
}: {
  state: ListState; total: number; actionOptions: FacetOptionLike[]; base: string;
}) {
  const router = useRouter();
  const href = (s: ListState) => base + serializeListState(s, ACTIVITY_LIST_CONFIG);
  const selected = state.filters.action ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FacetDropdown
        label="Action"
        options={actionOptions}
        selected={selected}
        onApply={(values) => router.push(href(withFilter(state, "action", values)))}
      />
      {selected.length > 0 && (
        <Link href={base} className="text-[12px] text-accent hover:underline">Clear</Link>
      )}
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "entry" : "entries"}
      </span>
    </div>
  );
}
