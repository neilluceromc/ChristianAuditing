"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import type { SheetState } from "@/lib/stocktake";
import type { FacetOption } from "@/server/modules/inventory/queries";

/**
 * Phase 39 (spec §4.1): the stocktake sheet's search (item code or name, on Enter), the Category filter (only when
 * the stocktake spans more than one category) and the mode's toggle — "Only uncounted" on the count, "Only
 * differences" on the review. Every change lands on page 1. The parent owns navigation: the count sheet waits for
 * its in-flight row saves first.
 *
 * It stays mounted across those navigations (never keyed by the URL), so focus stays on the control just used; the
 * search box is controlled and only takes the URL's `q` when that changes (a link, Back).
 */
export function StocktakeSheetToolbar({
  sheet,
  categories,
  toggleLabel,
  onChange,
  searchRef,
}: {
  sheet: SheetState;
  categories: FacetOption[];
  toggleLabel: string;
  onChange: (next: SheetState) => void;
  /** The count sheet moves focus here when the last row on the page is counted away under Only uncounted. */
  searchRef?: React.Ref<HTMLInputElement>;
}) {
  const [q, setQ] = useState(sheet.q);
  const [urlQ, setUrlQ] = useState(sheet.q);
  if (sheet.q !== urlQ) {
    setUrlQ(sheet.q);
    setQ(sheet.q);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search the stocktake"
          placeholder="Search code, name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange({ ...sheet, q: q.trim(), page: 1 });
          }}
        />
      </div>
      {categories.length > 1 && (
        <FacetDropdown
          label="Category"
          options={categories}
          selected={sheet.cats}
          onApply={(values) => onChange({ ...sheet, cats: values, page: 1 })}
        />
      )}
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-fg-secondary">
        <Checkbox checked={sheet.only} onChange={() => onChange({ ...sheet, only: !sheet.only, page: 1 })} />
        {toggleLabel}
      </label>
    </div>
  );
}
