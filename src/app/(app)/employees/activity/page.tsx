import { requireUser } from "@/server/auth/guards";
import { pagedSnapshot } from "@/server/paged";
import { entityLabels } from "@/server/modules/audit/queries";
import { auditSentence } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { LOG_PAGE_SIZE, parsePage } from "@/lib/paging";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed, actionDot, type ActivityItem } from "@/components/patterns/activity-feed";

export default async function EmployeeActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = toSearchParams(await searchParams);

  const where = { entityType: "employee" };
  const { rows: entries, ...pg } = await pagedSnapshot(
    LOG_PAGE_SIZE,
    parsePage(sp),
    (tx) => tx.auditEntry.count({ where }),
    (tx, pg) =>
      tx.auditEntry.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pg.skip,
        take: pg.take,
      }),
  );
  const labels = await entityLabels(entries);

  const items: ActivityItem[] = entries.map((e) => {
    const entity = labels.get(`${e.entityType}:${e.entityId}`)!;
    return {
      id: e.id,
      sentence: auditSentence({ actorLabel: e.actorLabel, action: e.action, diff: e.diff, entityLabel: entity.label }),
      when: fmtDateTime(e.createdAt),
      actor: e.actorLabel,
      dotValue: actionDot(e.action),
      entity,
    };
  });

  return (
    <>
      <PageHeader title="Employee activity" />
      <div className="flex flex-col gap-2">
        {items.length > 0 ? (
          <>
            <ActivityFeed items={items} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {pg.page} of {pg.pageCount}</span>
              <Pagination page={pg.page} pageCount={pg.pageCount} hrefFor={(p) => `?page=${p}`} />
            </div>
          </>
        ) : (
          <EmptyState title="Nothing has happened yet" />
        )}
      </div>
    </>
  );
}
