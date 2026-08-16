import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import {
  clearFilters, parseListState, serializeListState, toSearchParams, withFilter,
} from "@/lib/url-state";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { exactTagMatch, facetOptions, getInventoryColumns, listAssets } from "@/server/modules/inventory/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { ColumnChooser } from "@/components/inventory/column-chooser";
import { InventoryToolbar } from "@/components/inventory/inventory-toolbar";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const state = parseListState(toSearchParams(await searchParams), INVENTORY_LIST_CONFIG);

  // USB scanner contract: an exact tag match opens the record, not a list.
  if (state.q) {
    const hit = await exactTagMatch(state.q);
    if (hit) redirect(`/inventory/${hit.id}`);
  }

  const [{ rows, total, pageCount }, facets, visibleColumns] = await Promise.all([
    listAssets(state),
    facetOptions(state),
    getInventoryColumns(user.id),
  ]);

  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0;
  const href = (s: typeof state) => "/inventory" + serializeListState(s, INVENTORY_LIST_CONFIG);

  const chips: FilterChip[] = [];
  for (const [facet, values] of Object.entries(state.filters)) {
    for (const value of values) {
      const label = facets[facet]?.find((o) => o.value === value)?.label ?? value;
      chips.push({
        label: `${facet}: ${label}`,
        removeHref: href(withFilter(state, facet, values.filter((v) => v !== value))),
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={
          <>
            <ButtonLink href={"/inventory/export" + serializeListState(state, INVENTORY_LIST_CONFIG)}>
              Export
            </ButtonLink>
            {canMutate && <ButtonLink variant="primary" href="/inventory/new">New asset</ButtonLink>}
          </>
        }
      />
      <div className="flex flex-col gap-2">
        <InventoryToolbar state={state} total={total} facets={facets}>
          <ColumnChooser visible={visibleColumns} />
        </InventoryToolbar>
        <ChipFilterRow chips={chips} clearHref={href(clearFilters(state))} />
        {rows.length > 0 ? (
          <>
            <InventoryTable
              rows={rows}
              state={state}
              visible={visibleColumns}
              canMutate={canMutate}
              filtersQS={serializeListState(state, INVENTORY_LIST_CONFIG).replace(/^\?/, "")}
              total={total}
            />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">
                page {state.page} of {pageCount}
              </span>
              <Pagination page={state.page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
            </div>
          </>
        ) : hasFilters ? (
          <EmptyState
            title="Your filters matched nothing"
            description={`${chips.length + (state.q ? 1 : 0)} active filter${chips.length + (state.q ? 1 : 0) === 1 ? "" : "s"} — loosen or clear them.`}
            actions={<ButtonLink href={href(clearFilters(state))}>Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="No assets yet"
            description="Register the first asset; bulk import arrives in Phase 8."
            actions={canMutate ? <ButtonLink variant="primary" href="/inventory/new">New asset</ButtonLink> : undefined}
          />
        )}
      </div>
    </>
  );
}
