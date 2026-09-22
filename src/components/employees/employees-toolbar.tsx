"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { EmployeeFacets } from "@/server/modules/employees/queries";

export function EmployeesToolbar({
  state,
  total,
  facets,
  gapsOnly,
  hiddenLeavers,
}: {
  state: ListState;
  total: number;
  facets: EmployeeFacets;
  gapsOnly: boolean;
  hiddenLeavers: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Phase 20 (spec §5): leavers hidden by default — an explicit employment
  // facet always wins over the toggle (buildEmployeeWhere's own rule), but
  // the toggle only ever needs to know whether IT itself asked to see them.
  const showingLeavers = (state.filters.leavers ?? []).includes("1");

  const href = (s: ListState, gaps: boolean) => {
    const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
    if (!gaps) return pathname + qs;
    return pathname + (qs ? `${qs}&gaps=1` : "?gaps=1");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          // Phase 29 (final review I-2): the box is uncontrolled, and a search
          // change is a SOFT navigation — this component keeps its instance, so
          // React only rewrites `defaultValue`, which a dirtied input ignores
          // and "Clear search" left the typed text sitting in an empty search.
          // Keyed on the URL's q, the input remounts and takes the new default.
          key={state.q}
          type="search"
          aria-label="Search employees"
          placeholder="Search name, number, title, department · Enter"
          defaultValue={state.q}
          className="pl-8 pr-7"
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push(href(withSearch(state, e.currentTarget.value), gapsOnly));
          }}
        />
        {state.q && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
            onClick={() => router.push(href(withSearch(state, ""), gapsOnly))}
          >
            ×
          </button>
        )}
      </div>
      <FacetDropdown
        label="Department"
        options={facets.department}
        selected={state.filters.department ?? []}
        onApply={(values) => router.push(href(withFilter(state, "department", values), gapsOnly))}
      />
      <FacetDropdown
        label="Employment"
        options={facets.employment}
        selected={state.filters.employment ?? []}
        onApply={(values) => router.push(href(withFilter(state, "employment", values), gapsOnly))}
      />
      <Link
        href={href(withFilter(state, "leavers", showingLeavers ? [] : ["1"]), gapsOnly)}
        aria-current={showingLeavers ? "true" : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-(--dur-1)",
          showingLeavers
            ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
            : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
        )}
      >
        {showingLeavers && <span aria-hidden>✓</span>}
        {showingLeavers ? "Hide leavers" : "Show leavers"}
      </Link>
      <Link
        href={href({ ...state, page: 1 }, !gapsOnly)}
        aria-current={gapsOnly ? "true" : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-(--dur-1)",
          gapsOnly
            ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
            : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
        )}
      >
        {gapsOnly && <span aria-hidden>✓</span>}
        Policy gaps only
      </Link>
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "person" : "people"}
        {hiddenLeavers > 0 && (
          <>
            {" "}
            ·{" "}
            <Link href={href(withFilter(state, "leavers", ["1"]), gapsOnly)} className="underline">
              {hiddenLeavers} leaver{hiddenLeavers === 1 ? "" : "s"} hidden
            </Link>
          </>
        )}
      </span>
    </div>
  );
}
