import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { entityLabels } from "@/server/modules/audit/queries";
import { financeActivityWhere } from "@/server/modules/finance/queries";
import { auditSentence } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { LOG_PAGE_SIZE, pageOf, parsePage } from "@/lib/paging";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed, actionDot, type ActivityItem } from "@/components/patterns/activity-feed";

const DOMAIN: Record<string, string> = { "purchase-request": "PURCHASE", asset: "ASSET" };

export default async function FinanceActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = toSearchParams(await searchParams);

  const total = await prisma.auditEntry.count({ where: financeActivityWhere });
  const pg = pageOf(total, parsePage(sp), LOG_PAGE_SIZE);
  const entries = await prisma.auditEntry.findMany({
    where: financeActivityWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pg.skip,
    take: pg.take,
  });
  const labels = await entityLabels(entries);

  const items: ActivityItem[] = entries.map((e) => ({
    id: e.id,
    sentence: auditSentence({
      actorLabel: e.actorLabel,
      action: e.action,
      diff: e.diff,
      entityLabel: labels.get(`${e.entityType}:${e.entityId}`)!.label,
    }),
    when: fmtDateTime(e.createdAt),
    actor: e.actorLabel,
    dotValue: actionDot(e.action),
    // the pill renders ONLY on cross-domain feeds — this is the one
    domain: DOMAIN[e.entityType],
  }));

  return (
    <>
      <PageHeader title="Finance activity" />
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
          <EmptyState
            title="No money has moved yet"
            description="Purchase decisions and changes to an asset's cost both land here."
          />
        )}
      </div>
    </>
  );
}
