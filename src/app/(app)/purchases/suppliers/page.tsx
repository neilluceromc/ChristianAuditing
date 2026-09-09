import { requireUser } from "@/server/auth/guards";
import { toSearchParams, parseListState, serializeListState, type ListState } from "@/lib/url-state";
import { SUPPLIER_LIST_CONFIG } from "@/lib/supplier-list";
import { canManageSuppliers } from "@/lib/supplier-access";
import { listSuppliers } from "@/server/modules/suppliers/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SuppliersToolbar } from "@/components/suppliers/suppliers-toolbar";
import { SuppliersTable } from "@/components/suppliers/suppliers-table";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, SUPPLIER_LIST_CONFIG);
  const data = await listSuppliers(state);
  const href = (s: ListState) => "/purchases/suppliers" + serializeListState(s, SUPPLIER_LIST_CONFIG);
  const manage = canManageSuppliers(user.role);
  const filtered = Boolean(state.q) || Object.keys(state.filters).length > 0;

  const actions = manage ? (
    <>
      <ButtonLink href="/purchases/suppliers/new" variant="primary">New supplier</ButtonLink>
      <ButtonLink href="/purchases/suppliers/import">Import suppliers</ButtonLink>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Suppliers"
        breadcrumb={[{ label: "Purchase requests", href: "/purchases" }, { label: "Suppliers" }]}
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={actions}
      />
      <div className="flex flex-col gap-3">
        <SuppliersToolbar state={state} facets={data.facets} />
        {data.rows.length > 0 ? (
          <>
            <SuppliersTable rows={data.rows} />
            <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(p) => href({ ...state, page: p })} />
          </>
        ) : (
          <EmptyState
            title={filtered ? "No suppliers match" : "No suppliers yet"}
            description={
              filtered
                ? "Try a different search, or clear the filters."
                : "Add one, or import a list to get started."
            }
            actions={actions}
          />
        )}
      </div>
    </>
  );
}
