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
}: {
  state: ListState;
  total: number;
  facets: EmployeeFacets;
  gapsOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

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
          type="search"
          aria-label="Search employees"
          placeholder="Search name, EMP number, title…"
          defaultValue={state.q}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push(href(withSearch(state, e.currentTarget.value), gapsOnly));
          }}
        />
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
        href={href({ ...state, page: 1 }, !gapsOnly)}
        aria-pressed={gapsOnly}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-(--radius-btn) border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-(--dur-1)",
          gapsOnly
            ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
            : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
        )}
      >
        Policy gaps only
      </Link>
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "person" : "people"}
      </span>
    </div>
  );
}
