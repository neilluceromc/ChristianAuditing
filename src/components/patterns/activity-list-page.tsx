import { requireUser } from "@/server/auth/guards";
import { invisibleAuditRefs, listActivity } from "@/server/modules/audit/queries";
import { resolveEntitySearch } from "@/server/modules/audit/search";
import { ACTIVITY_LIST_CONFIG, type ActivityFeed as Feed } from "@/lib/activity-list";
import { actionLabel } from "@/lib/activity";
import { clearFilters, parseListState, serializeListState, toSearchParams, withFilter } from "@/lib/url-state";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed } from "@/components/patterns/activity-feed";
import { ActivityToolbar } from "@/components/patterns/activity-toolbar";
import { ChipFilterRow, type FilterChip } from "@/components/patterns/chip-filter-row";
import { ListNavigationProvider, ListPendingRegion, NavLink } from "@/components/patterns/list-navigation";

/**
 * Phase 27 (spec §5.2, plan P-2): the one body behind the four activity routes — parse the list
 * state, hide what the role cannot see, query once, render toolbar + feed + pagination. The pages
 * themselves are five-line wrappers that name their feed and copy.
 *
 * Phase 33 (spec §6.1, §6.3): the feeds search what they show — a tag, a person, a ref no —
 * resolved once to ids this role may see and ANDed with the feed's own scoping, so a feed's
 * search never reaches past its own rows; value-only chips, the busy transition, and
 * `page n of m` only when there are pages.
 */
export async function ActivityListPage({
  feed, title, base, emptyTitle, emptyDescription, searchParams,
}: {
  feed: Feed;
  title: string;
  /** the route, e.g. "/inventory/activity" — pagination, chip and Clear hrefs are built on it */
  base: string;
  emptyTitle: string;
  emptyDescription?: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const state = parseListState(toSearchParams(await searchParams), ACTIVITY_LIST_CONFIG);
  const [hidden, matchIds] = await Promise.all([
    invisibleAuditRefs(user.role),
    resolveEntitySearch(state.q, user.role),
  ]);
  const { items, total, page, pageCount, actionOptions } = await listActivity(feed, state, hidden, matchIds);
  const selected = state.filters.action ?? [];
  const filtered = state.q !== "" || selected.length > 0;
  const href = (s: typeof state) => base + serializeListState(s, ACTIVITY_LIST_CONFIG);

  // Value-only chips (spec §6.3): the facet a value belongs to is the control it came from.
  const chips: FilterChip[] = selected.map((value) => ({
    label: actionOptions.find((o) => o.value === value)?.label ?? actionLabel(value),
    removeHref: href(withFilter(state, "action", selected.filter((v) => v !== value))),
  }));

  return (
    <>
      <PageHeader title={title} />
      <ListNavigationProvider>
        <div className="flex flex-col gap-2">
          <ActivityToolbar state={state} total={total} actionOptions={actionOptions} base={base} />
          <ChipFilterRow chips={chips} clearHref={href(clearFilters(state))} />
          <ListPendingRegion className="flex flex-col gap-2">
            {items.length > 0 ? (
              <>
                <ActivityFeed items={items} />
                <div className="flex items-center justify-between pt-1">
                  <span className="font-mono text-[11px] text-fg-muted">
                    {pageCount > 1 ? `page ${page} of ${pageCount}` : ""}
                  </span>
                  {/* NavLink: a page change runs through the shared transition and marks the feed busy */}
                  <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} linkComponent={NavLink} />
                </div>
              </>
            ) : filtered ? (
              <EmptyState
                title="No entries match this filter"
                actions={<ButtonLink href={href(clearFilters(state))}>Clear</ButtonLink>}
              />
            ) : (
              <EmptyState title={emptyTitle} description={emptyDescription} />
            )}
          </ListPendingRegion>
        </div>
      </ListNavigationProvider>
    </>
  );
}
