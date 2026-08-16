import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { entityLabels } from "@/server/modules/audit/queries";
import { auditSentence } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ActivityFeed, actionDot, type ActivityItem } from "@/components/patterns/activity-feed";

const PAGE_SIZE = 50;

export default async function EmployeeActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const page = Math.max(1, Number.parseInt(toSearchParams(await searchParams).get("page") ?? "1", 10) || 1);

  const [total, entries] = await Promise.all([
    prisma.auditEntry.count({ where: { entityType: "employee" } }),
    prisma.auditEntry.findMany({
      where: { entityType: "employee" },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const labels = await entityLabels(entries);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
      <PageHeader title="Employee activity" />
      <div className="flex flex-col gap-2">
        {items.length > 0 ? (
          <>
            <ActivityFeed items={items} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {page} of {pageCount}</span>
              <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `?page=${p}`} />
            </div>
          </>
        ) : (
          <EmptyState title="Nothing has happened yet" />
        )}
      </div>
    </>
  );
}
