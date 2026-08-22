import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import {
  clearFilters, parseListState, serializeListState, toggleSort, toSearchParams, withFilter,
} from "@/lib/url-state";
import {
  INVENTORY_LIST_CONFIG, parsePurchaseYear, purchaseYearChips, withPurchaseYearQS,
  type PurchaseYearValue,
} from "@/lib/inventory-list";
import {
  exactTagMatch, facetOptions, getInventoryColumns, listAssets, purchaseYearBuckets,
} from "@/server/modules/inventory/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { ColumnChooser } from "@/components/inventory/column-chooser";
import { InventoryToolbar } from "@/components/inventory/inventory-toolbar";
import { REPAIRS_SAVED_VIEW, REPAIR_STAGE_LABEL, isRepairStage, isRepairView } from "@/lib/repairs";
import { RepairChips } from "@/components/inventory/repair-chips";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, INVENTORY_LIST_CONFIG);
  const purchaseYear = parsePurchaseYear(sp.get("purchaseYear"));

  // USB scanner contract: an exact tag match opens the record, not a list.
  if (state.q) {
    const hit = await exactTagMatch(state.q);
    if (hit) redirect(`/inventory/${hit.id}`);
  }

  const [{ rows, total, pageCount }, facets, visibleColumns, yearBuckets] = await Promise.all([
    listAssets(state, purchaseYear),
    facetOptions(state, purchaseYear),
    getInventoryColumns(user.id),
    purchaseYearBuckets(state),
  ]);
  const yearChips = purchaseYearChips(yearBuckets);

  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0 || purchaseYear !== null;
  // purchaseYear defaults to the current one so pagination/facet-remove links
  // don't silently drop it — a caller that means to clear it (Clear filters)
  // passes `null` explicitly. This is also handed down to RepairChips (a
  // Server Component, so a function prop is fine — no RSC serialization
  // boundary between two Server Components) and, as a precomputed map
  // rather than the function itself (InventoryTable is a Client Component
  // and cannot receive a raw function prop from here), to InventoryTable's
  // sort headers via `sortHrefs` below. A sort click and a stage click used
  // to silently drop `?purchaseYear=` because both built their own
  // `/inventory` URL straight from `serializeListState`, without ever
  // knowing the year existed — defeating the one thing these chips exist
  // for: the escape from the export's cap refusal. Neither component
  // imports `serializeListState` or `INVENTORY_LIST_CONFIG` any more, so
  // neither can reconstruct that bug.
  const href = (s: typeof state, py: PurchaseYearValue | null = purchaseYear) =>
    "/inventory" + withPurchaseYearQS(serializeListState(s, INVENTORY_LIST_CONFIG), py);
  const exportQS = withPurchaseYearQS(serializeListState(state, INVENTORY_LIST_CONFIG), purchaseYear);
  // One href per sortable key — the result of clicking that column's header —
  // plain serializable data, unlike `href` above, so it can cross into the
  // InventoryTable Client Component.
  const sortHrefs: Record<string, string> = Object.fromEntries(
    INVENTORY_LIST_CONFIG.sortable.map((key) => [
      key,
      href({ ...state, sort: toggleSort(state.sort, key), page: 1 }),
    ]),
  );
  const repairMode = isRepairView(state);

  const chips: FilterChip[] = [];
  for (const [facet, values] of Object.entries(state.filters)) {
    // In repair mode the RepairChips row above already renders the stage, and
    // renders it with the right semantics. Emitting it here too would show the
    // same filter twice with two different removal outcomes: this generic
    // remove is `withFilter(state, "stage", [])`, which clears the stage
    // WITHOUT restoring the status pin — isRepairView goes false and the user
    // is dumped out of repair mode onto the whole fleet, losing the Stage and
    // Down columns. withRepairStage exists to make that unrepresentable; this
    // loop was the second call site it did not know about.
    if (facet === "stage" && repairMode) continue;
    for (const value of values) {
      const label =
        facet === "stage" && isRepairStage(value)
          ? REPAIR_STAGE_LABEL[value]
          : facets[facet]?.find((o) => o.value === value)?.label ?? value;
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
            <ButtonLink href={"/inventory/export" + exportQS}>
              Export
            </ButtonLink>
            {/* Affordance absent, not disabled, for a role that can't reach the
                page — canMutate is exactly admin/it_staff, matching the
                PATH_RULES entry that gates /inventory/import itself. */}
            {canMutate && <ButtonLink href="/inventory/import">Import</ButtonLink>}
            {canMutate && <ButtonLink variant="primary" href="/inventory/new">New asset</ButtonLink>}
          </>
        }
      />
      <div className="flex flex-col gap-2">
        <InventoryToolbar
          state={state}
          total={total}
          facets={facets}
          yearChips={yearChips}
          purchaseYear={purchaseYear}
        >
          <ColumnChooser visible={visibleColumns} />
          {/* Saved views are named URLs (README): Repairs is one of them. */}
          <ButtonLink size="sm" href={REPAIRS_SAVED_VIEW}>Repairs</ButtonLink>
        </InventoryToolbar>
        {repairMode && <RepairChips state={state} href={href} />}
        {/* Clearing filters resets purchaseYear too — it is the same
            "start over" gesture as clearing every other facet. */}
        <ChipFilterRow chips={chips} clearHref={href(clearFilters(state), null)} />
        {rows.length > 0 ? (
          <>
            {/* key: any URL-state change remounts the island — selection must
                never silently survive a page/filter/sort change (it would act
                on rows the user can no longer see). purchaseYear is part of
                that key via exportQS even though it isn't part of `state`. */}
            <InventoryTable
              key={exportQS}
              rows={rows}
              state={state}
              visible={visibleColumns}
              canMutate={canMutate}
              filtersQS={exportQS.replace(/^\?/, "")}
              total={total}
              repairMode={repairMode}
              sortHrefs={sortHrefs}
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
            actions={<ButtonLink href={href(clearFilters(state), null)}>Clear filters</ButtonLink>}
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
