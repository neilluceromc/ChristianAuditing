"use client";

import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { isRepairStage } from "@/lib/repairs";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

export function InventoryToolbar({
  state,
  total,
  facets,
  children,
}: {
  state: ListState;
  total: number;
  facets: Record<string, FacetOption[]>;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function submitSearch(q: string) {
    router.push(pathname + serializeListState(withSearch(state, q), INVENTORY_LIST_CONFIG));
  }

  function applyFacet(facet: string, values: string[]) {
    router.push(pathname + serializeListState(withFilter(state, facet, values), INVENTORY_LIST_CONFIG));
  }

  const stageActive = (state.filters.stage ?? []).some(isRepairStage);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          type="search"
          aria-label="Search assets"
          placeholder="Search tag, model, serial…"
          defaultValue={state.q}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch(e.currentTarget.value);
          }}
        />
      </div>
      {/*
        A stage already constrains status — `returned-ok` MEANS "not
        DEFECTIVE" — so offering the Status facet on top of one advertises
        combinations that can never return a row: from ?stage=returned-ok the
        dropdown counted "DEFECTIVE 6" (the candidate set) and applying it gave
        the empty state. The stage chips are the status control in repair mode.
      */}
      {(stageActive
        ? (["category", "type", "assignee"] as const)
        : (["status", "category", "type", "assignee"] as const)
      ).map((facet) => (
        <FacetDropdown
          key={facet}
          label={facet === "assignee" ? "Assigned" : facet[0].toUpperCase() + facet.slice(1)}
          options={facets[facet] ?? []}
          selected={state.filters[facet] ?? []}
          onApply={(values) => applyFacet(facet, values)}
        />
      ))}
      {children}
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} asset{total === 1 ? "" : "s"}
      </span>
    </div>
  );
}
