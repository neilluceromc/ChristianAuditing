import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireUser } from "@/server/auth/guards";
import {
  clearFilters, toSearchParams, parseListState, serializeListState, withFilter, type ListState,
} from "@/lib/url-state";
import { RENEWING_LABEL, SUPPLIER_LIST_CONFIG } from "@/lib/supplier-list";
import { ChipFilterRow } from "@/components/patterns/chip-filter-row";
import { canManageSuppliers } from "@/lib/supplier-access";
import { listSuppliers } from "@/server/modules/suppliers/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SuppliersToolbar } from "@/components/suppliers/suppliers-toolbar";
import { SuppliersTable } from "@/components/suppliers/suppliers-table";

export const metadata: Metadata = { title: pageTitle("Suppliers") };

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
  const renewing = (state.filters.renewing?.length ?? 0) > 0;

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
        {/* Phase 46 (spec §4.3): the sidebar's Renewing soon view; the toolbar has no control for it, so its chip does. */}
        {renewing && (
          <ChipFilterRow
            chips={[{ label: RENEWING_LABEL, removeHref: href(withFilter(state, "renewing", [])) }]}
            clearHref={href(clearFilters(state))}
          />
        )}
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
