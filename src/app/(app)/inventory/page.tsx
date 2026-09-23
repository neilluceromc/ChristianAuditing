import { redirect } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { requireUser } from "@/server/auth/guards";
import { localDateISO } from "@/lib/format";
import {
  clearFilters, parseListState, serializeListState, toggleSort, toSearchParams, withFilter, withSearch,
} from "@/lib/url-state";
import {
  INVENTORY_LIST_CONFIG, parsePurchaseYear, purchaseYearChips, withPurchaseYearQS,
  type PurchaseYearValue,
} from "@/lib/inventory-list";
import {
  CLASS_LABEL, VISIBLE_CLASSES, canManageClass, canRegisterClass, canSeeClass, defaultClassFor, isDirectLifecycle, isStatusOf,
  parseCls, withViewClsQS,
} from "@/lib/asset-class";
import {
  exactTagMatch, facetOptions, getInventoryColumns, listAssets, purchaseYearBuckets,
} from "@/server/modules/inventory/queries";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";
import { recentPicks } from "@/server/recent-picks";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { ColumnChooser } from "@/components/inventory/column-chooser";
import { InventoryToolbar } from "@/components/inventory/inventory-toolbar";
import { InventoryMoreMenu } from "@/components/inventory/inventory-more-menu";
import { ListNavigationProvider, ListPendingRegion } from "@/components/inventory/list-navigation";
import { REPAIR_STAGE_LABEL, isRepairStage, isRepairView } from "@/lib/repairs";
import { RepairChips } from "@/components/inventory/repair-chips";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  let state = parseListState(sp, INVENTORY_LIST_CONFIG);
  const purchaseYear = parsePurchaseYear(sp.get("purchaseYear"));
  const visible = VISIBLE_CLASSES[user.role];
  const requested = parseCls(sp.get("cls"));
  // Phase 14 (spec §3.1): a class this role cannot see is not a view it can
  // ask for. Redirect to the bare list rather than render an empty table under
  // a heading that names the other department's assets.
  if (requested && !canSeeClass(user.role, requested)) redirect("/inventory");
  // Phase 30 (plan P-7): the list opens on the class the role manages — Purchasing for
  // purchasing_staff — and a URL names its class only when it is not that default.
  const defaultCls = defaultClassFor(user.role);
  const cls: AssetClass = requested ?? defaultCls;
  const canMutate = canManageClass(user.role, cls);
  const canRegister = canRegisterClass(user.role, cls);
  const direct = isDirectLifecycle(user.role, cls);

  // A status from the other class is dropped by buildAssetWhere; drop it from
  // the state too, or the chip row advertises a filter that isn't applied and
  // hasFilters counts it (D-16).
  const statusFilter = state.filters.status?.filter((s) => isStatusOf(cls, s));
  if (statusFilter && statusFilter.length !== state.filters.status?.length) {
    state = withFilter(state, "status", statusFilter);
  }
  // `stage` is the other arm of isRepairView, and repair stages are IT's: a
  // hand-typed ?stage= on the Purchasing view would enter repair mode whose
  // chips write status=DEFECTIVE — an IT status the line above then drops,
  // ejecting the user from the view they clicked in. Same rule, same place.
  if (cls !== "IT" && state.filters.stage) state = withFilter(state, "stage", []);

  // USB scanner contract: an exact tag match opens the record, not a list.
  if (state.q) {
    const hit = await exactTagMatch(state.q);
    if (hit) redirect(`/inventory/${hit.id}`);
  }

  // Task 9: the bulk drawer's assign mode needs a name to assign to. Loaded
  // only for a role that can mutate this class at all — the same condition
  // InventoryTable already uses to decide whether the drawer exists.
  const employees = canMutate ? await activeEmployeeOptions() : [];
  const recentEmployees = canMutate ? await recentPicks(user.id, "employee") : [];
  const today = localDateISO(new Date());

  const [{ rows, total, page, pageCount, attentionCount }, facets, visibleColumns, yearBuckets] = await Promise.all([
    listAssets(state, purchaseYear, cls),
    facetOptions(state, purchaseYear, cls),
    getInventoryColumns(user.id),
    purchaseYearBuckets(state, cls),
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
    "/inventory" + withViewClsQS(withPurchaseYearQS(serializeListState(s, INVENTORY_LIST_CONFIG), py), cls, defaultCls);
  // The export route and the bulk filters default the class to the viewer's own (Task 2's
  // defaultClassFor), so omitting `cls` exactly when it is that default names the same view.
  const exportQS = withViewClsQS(withPurchaseYearQS(serializeListState(state, INVENTORY_LIST_CONFIG), purchaseYear), cls, defaultCls);
  const registerHref = "/inventory/register" + withViewClsQS("", cls, defaultCls);
  const importHref = canMutate && cls === "IT" ? "/inventory/import" : null;
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

  // Phase 30 (spec §6.2): a chip reads as the value alone — the facet it belongs to is the
  // dropdown it came from. The search and the purchase year are chips too, so every narrowing
  // on screen can be removed in the same place (and the filtered-empty count below is honest).
  const chips: FilterChip[] = [];
  if (state.q) chips.push({ label: `Search: ${state.q}`, removeHref: href(withSearch(state, "")) });
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
        label,
        removeHref: href(withFilter(state, facet, values.filter((v) => v !== value))),
      });
    }
  }
  if (purchaseYear !== null) {
    chips.push({
      label: `Purchased: ${purchaseYear === "none" ? "No date" : purchaseYear}`,
      removeHref: href({ ...state, page: 1 }, null),
    });
  }

  return (
    <>
      <PageHeader
        title={cls === "IT" ? "Inventory" : `${CLASS_LABEL[cls]} assets`}
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={
          <>
            {canRegister && <ButtonLink variant="primary" href={registerHref}>Register assets</ButtonLink>}
            {/* Import stays IT-only regardless of the view (there is no Purchasing
                import wizard), and absent — not disabled — for a role that can't
                reach /inventory/import (canMutate is exactly admin/it_staff, the
                PATH_RULES entry that gates it). */}
            <InventoryMoreMenu importHref={importHref} exportHref={"/inventory/export" + exportQS} />
          </>
        }
      />
      <ListNavigationProvider>
        <div className="flex flex-col gap-2">
          <InventoryToolbar
            state={state}
            total={total}
            attentionCount={attentionCount}
            facets={facets}
            yearChips={yearChips}
            purchaseYear={purchaseYear}
            cls={cls}
            defaultCls={defaultCls}
            classes={visible}
          >
            <ColumnChooser visible={visibleColumns} />
          </InventoryToolbar>
          {/* Search, facet, Purchased and sort navigations share one transition; this region
              dims (data-pending, aria-busy) while the next view renders. */}
          <ListPendingRegion className="flex flex-col gap-2">
            {repairMode && <RepairChips state={state} href={href} />}
            {/* Clearing filters resets purchaseYear too — it is the same
                "start over" gesture as clearing every other facet. */}
            <ChipFilterRow chips={chips} clearHref={href(clearFilters(state), null)} />
            {rows.length > 0 ? (
              <>
                {/* key: any URL-state change remounts the island — selection must
                    never silently survive a page/filter/sort change (it would act
                    on rows the user can no longer see). purchaseYear is part of
                    that key via exportQS even though it isn't part of `state`.
                    The class must stay part of this key too — withViewClsQS
                    names it whenever it is not the viewer's default — because
                    the drawer's `to` and the selection Set both belong to one
                    class view. */}
                <InventoryTable
                  key={exportQS}
                  rows={rows}
                  state={state}
                  visible={visibleColumns}
                  canMutate={canMutate}
                  filtersQS={exportQS.replace(/^\?/, "")}
                  total={total}
                  cls={cls}
                  direct={direct}
                  employees={employees}
                  recentEmployees={recentEmployees}
                  repairMode={repairMode}
                  sortHrefs={sortHrefs}
                  today={today}
                />
                <div className="flex items-center justify-between pt-1">
                  {/* spec §6.5: "page 1 of 1" says nothing */}
                  {pageCount > 1 && (
                    <span className="font-mono text-[11px] text-fg-muted">
                      page {page} of {pageCount}
                    </span>
                  )}
                  <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
                </div>
              </>
            ) : hasFilters ? (
              <EmptyState
                title="Your filters matched nothing"
                description={`${chips.length} active filter${chips.length === 1 ? "" : "s"} — loosen or clear them.`}
                actions={<ButtonLink href={href(clearFilters(state), null)}>Clear filters</ButtonLink>}
              />
            ) : (
              <EmptyState
                title="No assets yet"
                description={
                  !canRegister
                    ? "No assets in this view."
                    : importHref
                      ? "Register the first asset, or import a spreadsheet."
                      : "Register the first asset."
                }
                actions={
                  canRegister ? <ButtonLink variant="primary" href={registerHref}>Register assets</ButtonLink> : undefined
                }
              />
            )}
          </ListPendingRegion>
        </div>
      </ListNavigationProvider>
    </>
  );
}
