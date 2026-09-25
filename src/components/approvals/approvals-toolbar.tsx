"use client";

import type { ApprovalType } from "@prisma/client";
import { SearchBox } from "@/components/patterns/search-box";
import { FacetDropdown, type FacetOptionLike } from "@/components/patterns/facet-dropdown";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { APPROVAL_KIND_LABEL } from "@/lib/labels";
import { approvalsHref, parseTypes, type ClosedVia, type QueueTab } from "@/lib/approvals-list";

/**
 * Spec §4.2: the queue's house search and its Type facet, both narrowing every
 * tab and the counts. A search or an Apply starts again at page 1 and runs in the
 * list's shared transition, so the table below is marked busy until it arrives.
 * The chips under it are value-only (the search term, each type's friendly word).
 */
export function ApprovalsToolbar({
  tab,
  via,
  q,
  types,
  typeOptions,
}: {
  tab: QueueTab;
  via: ClosedVia;
  q: string;
  types: ApprovalType[];
  typeOptions: FacetOptionLike[];
}) {
  const { navigate } = useListNavigation();

  const chips: FilterChip[] = [];
  if (q) chips.push({ label: `Search: ${q}`, removeHref: approvalsHref({ tab, via, types }) });
  for (const t of types) {
    chips.push({ label: APPROVAL_KIND_LABEL[t], removeHref: approvalsHref({ tab, via, q, types: types.filter((x) => x !== t) }) });
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={q}
          ariaLabel="Search approvals"
          placeholder="Search ref no, tag, person · Enter"
          onSubmit={(next) => navigate(approvalsHref({ tab, via, q: next, types }))}
        />
        <FacetDropdown
          label="Type"
          options={typeOptions}
          selected={types}
          onApply={(values) => navigate(approvalsHref({ tab, via, q, types: parseTypes(values.join(",")) }))}
        />
      </div>
      <ChipFilterRow chips={chips} clearHref={approvalsHref({ tab, via })} />
    </div>
  );
}
