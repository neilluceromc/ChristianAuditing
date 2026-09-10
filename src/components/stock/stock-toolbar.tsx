"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button-link";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { STOCK_LIST_CONFIG } from "@/lib/stock-list";
import { serializeListState, withFilter, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

/** Scaled-down suppliers-toolbar.tsx: search, one facet, a low-stock toggle, an archived toggle, and the export link. */
export function StockToolbar({
  state,
  facets,
  lowCount,
}: {
  state: ListState;
  facets: { category: FacetOption[] };
  lowCount: number;
}) {
  const router = useRouter();
  const low = state.filters.low?.includes("1") ?? false;
  const archived = state.filters.archived?.includes("1") ?? false;

  function go(next: ListState) {
    router.push("/stock" + serializeListState(next, STOCK_LIST_CONFIG));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          type="search"
          aria-label="Search stock items"
          placeholder="Search code, name…"
          defaultValue={state.q}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") go({ ...state, q: e.currentTarget.value, page: 1 });
          }}
        />
      </div>
      <FacetDropdown
        label="Category"
        options={facets.category}
        selected={state.filters.category ?? []}
        onApply={(values) => go(withFilter(state, "category", values))}
      />
      <div className="ml-auto flex items-center gap-3">
        {!low && lowCount > 0 && (
          <span className="font-mono text-[10px] text-fg-faint">{lowCount} low</span>
        )}
        <Link
          href={"/stock" + serializeListState(withFilter(state, "low", low ? [] : ["1"]), STOCK_LIST_CONFIG)}
          className="font-mono text-[11px] text-fg-muted hover:text-accent"
        >
          {low ? "Show all" : "Show low stock only"}
        </Link>
        <Link
          href={"/stock" + serializeListState(withFilter(state, "archived", archived ? [] : ["1"]), STOCK_LIST_CONFIG)}
          className="font-mono text-[11px] text-fg-muted hover:text-accent"
        >
          {archived ? "Show active" : "Show archived"}
        </Link>
        <ButtonLink href={"/stock/export" + serializeListState(state, STOCK_LIST_CONFIG)} size="sm">
          Export
        </ButtonLink>
      </div>
    </div>
  );
}
