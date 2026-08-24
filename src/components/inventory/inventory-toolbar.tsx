"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import {
  INVENTORY_LIST_CONFIG, withPurchaseYearQS, type PurchaseYearValue, type YearChip,
} from "@/lib/inventory-list";
import { isRepairStage } from "@/lib/repairs";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

export function InventoryToolbar({
  state,
  total,
  facets,
  yearChips,
  purchaseYear,
  children,
}: {
  state: ListState;
  total: number;
  facets: Record<string, FacetOption[]>;
  /** split-by-year chips (`purchaseYearChips`), sized to their counts */
  yearChips: YearChip[];
  /** the currently active `?purchaseYear=`, or null */
  purchaseYear: PurchaseYearValue | null;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function submitSearch(q: string) {
    router.push(
      pathname + withPurchaseYearQS(serializeListState(withSearch(state, q), INVENTORY_LIST_CONFIG), purchaseYear),
    );
  }

  function applyFacet(facet: string, values: string[]) {
    router.push(
      pathname
        + withPurchaseYearQS(serializeListState(withFilter(state, facet, values), INVENTORY_LIST_CONFIG), purchaseYear),
    );
  }

  /**
   * A chip's own `href` (from `purchaseYearChips`) is a bare nav destination
   * — the pure lib function has no view of the current search/facets/sort.
   * This preserves them, the same way RepairChips and EmployeesToolbar's
   * "Policy gaps only" link both carry the rest of `state` along when they
   * switch a single dimension.
   */
  function yearHref(chip: YearChip): string {
    const value: PurchaseYearValue = chip.year === null ? "none" : chip.year;
    return pathname + withPurchaseYearQS(serializeListState(state, INVENTORY_LIST_CONFIG), value);
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
      {yearChips.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-fg-faint">year</span>
          {yearChips.map((chip) => {
            const active = chip.year === null ? purchaseYear === "none" : chip.year === purchaseYear;
            return (
              <Link
                key={chip.label}
                href={yearHref(chip)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                  active
                    ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                    : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
                )}
              >
                {chip.label}
                <span className="text-fg-faint">{chip.count}</span>
              </Link>
            );
          })}
        </div>
      )}
      {children}
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} asset{total === 1 ? "" : "s"}
      </span>
    </div>
  );
}
