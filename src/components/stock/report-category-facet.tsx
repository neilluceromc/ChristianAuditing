"use client";

import { useRouter } from "next/navigation";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { STOCK_REPORT_LIST_CONFIG } from "@/lib/stock-reports";
import { serializeListState, withFilter, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

/**
 * Task 7 review (Important): the three report toolbars used a single-select
 * native `<select>` where the Stock list's own Category facet
 * (`stock-toolbar.tsx`) is a multi-select `FacetDropdown` for the identical
 * concept. This is that same widget, reused here.
 *
 * `state`/`STOCK_REPORT_LIST_CONFIG` already round-trip any other list facet
 * a given report carries (`uncosted` on the on-hand report) automatically,
 * since `serializeListState` re-emits every facet in the config. A report's
 * own non-list params — `from`/`to` (consumption), `days` (expiry) — live
 * outside `ListState`, so the page passes them through `extraParams` and
 * they're appended after, keeping the range/window in the URL across a
 * category change in both directions.
 */
export function ReportCategoryFacet({
  basePath,
  state,
  options,
  extraParams,
}: {
  basePath: string;
  state: ListState;
  options: FacetOption[];
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <FacetDropdown
      label="Category"
      options={options}
      selected={state.filters.category ?? []}
      onApply={(values) => {
        const next = withFilter(state, "category", values);
        const qs = serializeListState(next, STOCK_REPORT_LIST_CONFIG);
        const params = new URLSearchParams(qs.slice(1));
        for (const [key, value] of Object.entries(extraParams ?? {})) {
          if (value) params.set(key, value);
        }
        const s = params.toString();
        router.push(basePath + (s ? `?${s}` : ""));
      }}
    />
  );
}
