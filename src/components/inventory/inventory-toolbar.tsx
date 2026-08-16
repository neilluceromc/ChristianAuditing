"use client";

import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { serializeListState, withSearch, type ListState } from "@/lib/url-state";
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
  void facets; // consumed from Task 8 (facet dropdowns)

  function submitSearch(q: string) {
    router.push(pathname + serializeListState(withSearch(state, q), INVENTORY_LIST_CONFIG));
  }

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
      {children}
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} asset{total === 1 ? "" : "s"}
      </span>
    </div>
  );
}
