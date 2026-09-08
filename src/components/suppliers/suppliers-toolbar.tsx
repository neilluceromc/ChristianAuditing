"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { SUPPLIER_LIST_CONFIG } from "@/lib/supplier-list";
import { serializeListState, withFilter, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

/** Scaled-down inventory-toolbar.tsx: one search box, two facets, an archived toggle. */
export function SuppliersToolbar({
  state,
  facets,
}: {
  state: ListState;
  facets: Record<"category" | "contract", FacetOption[]>;
}) {
  const router = useRouter();
  const archived = state.filters.archived?.includes("1") ?? false;

  function go(next: ListState) {
    router.push("/purchases/suppliers" + serializeListState(next, SUPPLIER_LIST_CONFIG));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          type="search"
          aria-label="Search suppliers"
          placeholder="Search name, contact, email…"
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
      <FacetDropdown
        label="Contract"
        options={facets.contract}
        selected={state.filters.contract ?? []}
        onApply={(values) => go(withFilter(state, "contract", values))}
      />
      <Link
        href={"/purchases/suppliers" + serializeListState(withFilter(state, "archived", archived ? [] : ["1"]), SUPPLIER_LIST_CONFIG)}
        className="ml-auto font-mono text-[11px] text-fg-muted hover:text-accent"
      >
        {archived ? "Show active" : "Show archived"}
      </Link>
    </div>
  );
}
