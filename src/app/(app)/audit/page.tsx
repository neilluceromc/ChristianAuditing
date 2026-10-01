import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import {
  clearFilters, parseListState, serializeListState, toSearchParams, withFilter,
} from "@/lib/url-state";
import { AUDIT_ENTITY_TYPES, AUDIT_LIST_CONFIG, WHEN_LABEL, buildAuditWhere } from "@/lib/audit-list";
import { invisibleAuditRefs, listAudit } from "@/server/modules/audit/queries";
import { resolveEntitySearch } from "@/server/modules/audit/search";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { AuditToolbar } from "@/components/patterns/audit-toolbar";
import { ListNavigationProvider, ListPendingRegion, NavLink } from "@/components/patterns/list-navigation";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { FacetOptionLike } from "@/components/patterns/facet-dropdown";

// Phase 27 (P-10): "vendor" is what the table is called; "Supplier" is what the operator calls it.
const ENTITY_LABEL_OVERRIDE: Record<string, string> = { vendor: "Supplier" };
const humanize = (s: string) => ENTITY_LABEL_OVERRIDE[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replaceAll("-", " ");

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const state = parseListState(toSearchParams(await searchParams), AUDIT_LIST_CONFIG);
  // Spec §6.1: a search also finds what the Entity column shows (tag, person, ref no) — resolved
  // once to ids this role may see, then shared by the list, the Entity counts and the export.
  const [hidden, matchIds] = await Promise.all([
    invisibleAuditRefs(user.role),
    resolveEntitySearch(state.q, user.role),
  ]);

  // Entity facet counts read WITHOUT the entity filter applied (so unchecking
  // never zeroes the other options out) — one groupBy, no filter loop. Search and
  // When still narrow them (spec §10: the facets combine in the list and the counts).
  const withoutEntity = { ...state, filters: { ...state.filters, entity: [] } };
  const [{ rows, total, page, pageCount }, entityGroups] = await Promise.all([
    listAudit(state, hidden, matchIds),
    prisma.auditEntry.groupBy({ by: ["entityType"], where: buildAuditWhere(withoutEntity, hidden, matchIds), _count: true }),
  ]);

  const entityOptions: FacetOptionLike[] = AUDIT_ENTITY_TYPES.map((t) => ({
    value: t,
    label: humanize(t),
    count: entityGroups.find((g) => g.entityType === t)?._count ?? 0,
  }));

  const href = (s: typeof state) => "/audit" + serializeListState(s, AUDIT_LIST_CONFIG);
  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0;

  // Value-only chips (spec §6.3): the facet a value belongs to is the control it came from.
  const chips: FilterChip[] = [
    ...(state.filters.entity ?? []).map((value) => ({
      label: humanize(value),
      removeHref: href(withFilter(state, "entity", (state.filters.entity ?? []).filter((v) => v !== value))),
    })),
    ...(state.filters.when ?? []).map((value) => ({
      label: WHEN_LABEL[value as keyof typeof WHEN_LABEL] ?? value,
      removeHref: href(withFilter(state, "when", [])),
    })),
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        actions={
          <ButtonLink href={"/audit/export" + serializeListState(state, AUDIT_LIST_CONFIG)}>
            Export
          </ButtonLink>
        }
      />
      <ListNavigationProvider>
        <div className="flex flex-col gap-2">
          <AuditToolbar state={state} total={total} entityOptions={entityOptions} />
          <ChipFilterRow chips={chips} clearHref={href(clearFilters(state))} />
          <ListPendingRegion className="flex flex-col gap-2">
            {rows.length > 0 ? (
              <>
                {/* README 3g: the audit log's absence of interaction is the design — no buttons or
                    checkboxes in the table; the only links are the entities. */}
                <Table>
                  <THead>
                    <Tr>
                      <Th width={150}>When</Th>
                      <Th width={260}>Entity</Th>
                      <Th>What happened</Th>
                      <Th width={160}>Action</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {rows.map((row) => (
                      <Tr key={row.id}>
                        <Td mono>{row.when}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-2">
                            {/* Friendly words in the pill (spec §6.2); the pill sets them in capitals. */}
                            <Pill>{humanize(row.entityType).toLowerCase()}</Pill>
                            {row.entityHref ? (
                              <Link href={row.entityHref} className="font-mono text-xs text-accent hover:underline">
                                {row.entityLabel}
                              </Link>
                            ) : (
                              <span className="font-mono text-xs text-fg-muted">{row.entityLabel}</span>
                            )}
                          </span>
                        </Td>
                        <Td>{row.sentence}</Td>
                        {/* P-14: the raw action slug stays beside the sentence, in mono */}
                        <Td mono className="text-fg-muted">{row.action}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <div className="flex items-center justify-between pt-1">
                  <span className="font-mono text-[11px] text-fg-muted">
                    {pageCount > 1 ? `page ${page} of ${pageCount}` : ""}
                  </span>
                  {/* NavLink: a page change runs through the shared transition and marks the list busy */}
                  <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} linkComponent={NavLink} />
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
          </ListPendingRegion>
        </div>
      </ListNavigationProvider>
    </>
  );
}
