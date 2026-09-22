import { requireUser } from "@/server/auth/guards";
import { invisibleAuditRefs, listActivity } from "@/server/modules/audit/queries";
import { ACTIVITY_LIST_CONFIG, type ActivityFeed as Feed } from "@/lib/activity-list";
import { parseListState, serializeListState, toSearchParams } from "@/lib/url-state";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed } from "@/components/patterns/activity-feed";
import { ActivityToolbar } from "@/components/patterns/activity-toolbar";

/**
 * Phase 27 (spec §5.2, plan P-2): the one body behind the four activity routes — parse the list
 * state, hide what the role cannot see, query once, render toolbar + feed + pagination. The pages
 * themselves are five-line wrappers that name their feed and copy.
 */
export async function ActivityListPage({
  feed, title, base, emptyTitle, emptyDescription, searchParams,
}: {
  feed: Feed;
  title: string;
  /** the route, e.g. "/inventory/activity" — pagination and Clear hrefs are built on it */
  base: string;
  emptyTitle: string;
  emptyDescription?: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const state = parseListState(toSearchParams(await searchParams), ACTIVITY_LIST_CONFIG);
  const hidden = await invisibleAuditRefs(user.role);
  const { items, total, page, pageCount, actionOptions } = await listActivity(feed, state, hidden);
  const filtered = (state.filters.action ?? []).length > 0;
  const href = (p: number) => base + serializeListState({ ...state, page: p }, ACTIVITY_LIST_CONFIG);

  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col gap-2">
        <ActivityToolbar state={state} total={total} actionOptions={actionOptions} base={base} />
        {items.length > 0 ? (
          <>
            <ActivityFeed items={items} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount}</span>
              <Pagination page={page} pageCount={pageCount} hrefFor={href} />
            </div>
          </>
        ) : filtered ? (
          <EmptyState title="No entries match this filter" actions={<ButtonLink href={base}>Clear</ButtonLink>} />
        ) : (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        )}
      </div>
    </>
  );
}
