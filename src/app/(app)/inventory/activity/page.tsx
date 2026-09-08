import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { entityLabels } from "@/server/modules/audit/queries";
import { invisibleAssetIds } from "@/server/modules/inventory/queries";
import { auditSentence } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { LOG_PAGE_SIZE, pageOf, parsePage } from "@/lib/paging";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed, actionDot, type ActivityItem } from "@/components/patterns/activity-feed";

export default async function InventoryActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);

  const hidden = await invisibleAssetIds(user.role);
  const where = { entityType: "asset", ...(hidden.length ? { entityId: { notIn: hidden } } : {}) };
  const total = await prisma.auditEntry.count({ where });
  const pg = pageOf(total, parsePage(sp), LOG_PAGE_SIZE);
  const entries = await prisma.auditEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pg.skip,
    take: pg.take,
  });
  const labels = await entityLabels(entries);

  const items: ActivityItem[] = entries.map((e) => {
    const entityLabel = labels.get(`${e.entityType}:${e.entityId}`)!.label;
    return {
      id: e.id,
      sentence: auditSentence({ actorLabel: e.actorLabel, action: e.action, diff: e.diff, entityLabel }),
      when: fmtDateTime(e.createdAt),
      actor: e.actorLabel,
      dotValue: actionDot(e.action),
    };
  });

  return (
    <>
      <PageHeader title="Inventory activity" />
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
