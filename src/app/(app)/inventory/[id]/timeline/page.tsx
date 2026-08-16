import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getAsset } from "@/server/modules/inventory/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { TimelineList, type TimelineItem } from "@/components/patterns/timeline-list";

export default async function AssetTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();

  const [entries, approvals] = await Promise.all([
    prisma.auditEntry.findMany({ where: { entityType: "asset", entityId: id } }),
    prisma.approval.findMany({ where: { assetId: id } }),
  ]);

  const merged = [
    ...entries.map((e) => ({
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
    })),
    ...approvals.map((a) => ({
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
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .map((x) => x.item);

  if (merged.length === 0) return <EmptyState title="Nothing has happened yet" />;
  return <div className="max-w-[640px] pt-2"><TimelineList items={merged} /></div>;
}
