"use client";

import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { FacetDropdown, type FacetOptionLike } from "@/components/patterns/facet-dropdown";
import { AUDIT_LIST_CONFIG } from "@/lib/audit-list";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";

export function AuditToolbar({
  state,
  total,
  entityOptions,
}: {
  state: ListState;
  total: number;
  entityOptions: FacetOptionLike[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const href = (s: ListState) => pathname + serializeListState(s, AUDIT_LIST_CONFIG);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-[260px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          type="search"
          aria-label="Search audit log"
          placeholder="Search action, entity id, actor…"
          defaultValue={state.q}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push(href(withSearch(state, e.currentTarget.value)));
          }}
        />
      </div>
      <FacetDropdown
        label="Entity"
        options={entityOptions}
        selected={state.filters.entity ?? []}
        onApply={(values) => router.push(href(withFilter(state, "entity", values)))}
      />
      <span className="ml-auto font-mono text-[11px] text-fg-muted" aria-live="polite">
        {total} {total === 1 ? "entry" : "entries"}
      </span>
    </div>
  );
}
