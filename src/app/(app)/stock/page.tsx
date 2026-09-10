import { requireUser } from "@/server/auth/guards";
import { toSearchParams, parseListState, serializeListState, type ListState } from "@/lib/url-state";
import { STOCK_LIST_CONFIG } from "@/lib/stock-list";
import { canManageStock } from "@/lib/stock-access";
import { listStockItems } from "@/server/modules/stock/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { StockToolbar } from "@/components/stock/stock-toolbar";
import { StockItemsTable } from "@/components/stock/stock-items-table";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, STOCK_LIST_CONFIG);
  const data = await listStockItems(state);
  const href = (s: ListState) => "/stock" + serializeListState(s, STOCK_LIST_CONFIG);
  const manage = canManageStock(user.role);
  const filtered = Boolean(state.q) || Object.keys(state.filters).length > 0;

  const actions = manage ? (
    <>
      <ButtonLink href="/stock/items/new" variant="primary">New item</ButtonLink>
      <ButtonLink href="/stock/receive">Receive stock</ButtonLink>
      <ButtonLink href="/stock/issue">Issue stock</ButtonLink>
    </>
  ) : undefined;

  const emptyActions = manage ? (
    <>
      <ButtonLink href="/stock/items/new" variant="primary">New item</ButtonLink>
      <ButtonLink href="/stock/import">Import items</ButtonLink>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Stock items"
        breadcrumb={[{ label: "Stock items" }]}
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={actions}
      />
      <div className="flex flex-col gap-3">
        <p className="font-mono text-[11px] text-fg-muted">
          {data.total} items · {data.lowCount} below reorder level
        </p>
        <StockToolbar state={state} facets={data.facets} lowCount={data.lowCount} />
        {data.rows.length > 0 ? (
          <>
            <StockItemsTable rows={data.rows} />
            <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(p) => href({ ...state, page: p })} />
          </>
        ) : (
          <EmptyState
            title={filtered ? "No items match" : "No stock items yet"}
            description={
              filtered
                ? "Try a different search, or clear the filters."
                : "Add one, or import a list to get started."
            }
            actions={emptyActions}
          />
        )}
      </div>
    </>
  );
}
