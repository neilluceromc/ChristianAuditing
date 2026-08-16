import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import {
  clearFilters, parseListState, serializeListState, toSearchParams, withFilter,
} from "@/lib/url-state";
import { AUDIT_ENTITY_TYPES, AUDIT_LIST_CONFIG, buildAuditWhere } from "@/lib/audit-list";
import { listAudit } from "@/server/modules/audit/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { AuditToolbar } from "@/components/patterns/audit-toolbar";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { FacetOptionLike } from "@/components/patterns/facet-dropdown";

const humanize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replaceAll("-", " ");

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const state = parseListState(toSearchParams(await searchParams), AUDIT_LIST_CONFIG);

  // Entity facet counts read WITHOUT the entity filter applied (so unchecking
  // never zeroes the other options out) — one groupBy, no filter loop.
  const withoutEntity = { ...state, filters: { ...state.filters, entity: [] } };
  const [{ rows, total, pageCount }, entityGroups] = await Promise.all([
    listAudit(state),
    prisma.auditEntry.groupBy({ by: ["entityType"], where: buildAuditWhere(withoutEntity), _count: true }),
  ]);

  const entityOptions: FacetOptionLike[] = AUDIT_ENTITY_TYPES.map((t) => ({
    value: t,
    label: humanize(t),
    count: entityGroups.find((g) => g.entityType === t)?._count ?? 0,
  }));

  const href = (s: typeof state) => "/audit" + serializeListState(s, AUDIT_LIST_CONFIG);
  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0;

  const chips: FilterChip[] = (state.filters.entity ?? []).map((value) => ({
    label: `entity: ${humanize(value)}`,
    removeHref: href(withFilter(state, "entity", (state.filters.entity ?? []).filter((v) => v !== value))),
  }));

  return (
    <>
      <PageHeader title="Audit log" />
      <div className="flex flex-col gap-2">
        <AuditToolbar state={state} total={total} entityOptions={entityOptions} />
        <ChipFilterRow chips={chips} clearHref={href(clearFilters(state))} />
        {rows.length > 0 ? (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th width={150}>When</Th>
                  <Th width={140}>Actor</Th>
                  <Th>Entity</Th>
                  <Th width={140}>Action</Th>
                  <Th>Fields</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td mono>{row.when}</Td>
                    <Td>{row.actor}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <Pill>{row.entityType}</Pill>
                        {row.entityHref ? (
                          <Link href={row.entityHref} className="font-mono text-xs text-accent hover:underline">
                            {row.entityLabel}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-fg-muted">{row.entityLabel}</span>
                        )}
                      </span>
                    </Td>
                    <Td mono>{row.action}</Td>
                    <Td mono className="text-fg-muted">{row.fields}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {state.page} of {pageCount}</span>
              <Pagination page={state.page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
            </div>
          </>
        ) : hasFilters ? (
          <EmptyState
            title="Your filters matched nothing"
            actions={<ButtonLink href={href(clearFilters(state))}>Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="Nothing has happened yet"
            description="Every create, update, and secret reveal lands here, append-only — there is no edit or delete by design."
          />
        )}
      </div>
    </>
  );
}
