import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { mergeTimeline, parseTimelineCursor, timelineCursorQS, timelineTake, TIMELINE_PAGE_SIZE, type TimelinePoint } from "@/lib/timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { TimelineList, type TimelineItem } from "@/components/patterns/timeline-list";

export default async function AssetTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();

  const cursor = parseTimelineCursor(sp);
  const take = timelineTake(TIMELINE_PAGE_SIZE, cursor);

  const [entries, approvals] = await Promise.all([
    prisma.auditEntry.findMany({
      where: { entityType: "asset", entityId: id, ...(cursor ? { createdAt: { lte: cursor.before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
    prisma.approval.findMany({
      where: { assetId: id, ...(cursor ? { createdAt: { lte: cursor.before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
  ]);

  const auditPts = entries.map((e) => ({
    id: `audit-${e.id}`,
    when: e.createdAt,
    item: {
      id: `audit-${e.id}`,
      at: fmtDate(e.createdAt),
      title: (
        <>
          <span className="font-medium text-fg">{e.actorLabel}</span> — <span className="font-mono text-xs">{e.action}</span>
          {e.diff ? ` · ${Object.keys(e.diff as object).length} field${Object.keys(e.diff as object).length === 1 ? "" : "s"}` : ""}
        </>
      ),
    } satisfies TimelineItem,
  }));
  const approvalPts = approvals.map((a) => ({
    id: `approval-${a.id}`,
    when: a.createdAt,
    item: {
      id: `approval-${a.id}`,
      at: fmtDate(a.createdAt),
      status: a.state,
      title: (
        <>
          <span className="font-mono text-xs text-accent">{a.refNo}</span> · {APPROVAL_TYPE_LABEL[a.type]} —{" "}
          <span className="font-mono text-xs">{a.state}</span>
        </>
      ),
    } satisfies TimelineItem,
  }));

  const { items, next } = mergeTimeline<TimelinePoint & { item: TimelineItem }>([auditPts, approvalPts], TIMELINE_PAGE_SIZE, cursor);
  const merged = items.map((x) => x.item);

  if (merged.length === 0) return <EmptyState title="Nothing has happened yet" />;
  return (
    <div className="max-w-[640px] pt-2">
      <TimelineList items={merged} />
      <div className="flex items-center gap-3 pt-1">
        {next && <ButtonLink href={`?${timelineCursorQS(next)}`}>Older</ButtonLink>}
        {cursor && <ButtonLink href="?">Newest</ButtonLink>}
      </div>
    </div>
  );
}
