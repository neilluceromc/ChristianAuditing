import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { mergeTimeline, parseTimelineCursor, timelineCursorQS, timelineTake, TIMELINE_PAGE_SIZE, type TimelinePoint } from "@/lib/timeline";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { TimelineList, type TimelineItem } from "@/components/patterns/timeline-list";

export default async function EmployeeTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  const cursor = parseTimelineCursor(sp);
  const take = timelineTake(TIMELINE_PAGE_SIZE, cursor);

  const [entries, approvals, reservations, transfers] = await Promise.all([
    prisma.auditEntry.findMany({
      where: { entityType: "employee", entityId: id, ...(cursor ? { createdAt: { lte: cursor.before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
    prisma.approval.findMany({
      where: { employeeId: id, ...(cursor ? { createdAt: { lte: cursor.before } } : {}) },
      include: { asset: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
    prisma.reservation.findMany({
      where: { employeeId: id, ...(cursor ? { createdAt: { lte: cursor.before } } : {}) },
      include: { asset: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
    // Phase 20 (spec §3): transfers join as a fourth source, `when =
    // effectiveAt` — the dated, deliberate moment IT recorded, not the row's
    // createdAt (the two agree for a same-day transfer but not for a
    // backdated one).
    prisma.employeeTransfer.findMany({
      where: { employeeId: id, ...(cursor ? { effectiveAt: { lte: cursor.before } } : {}) },
      include: { fromDepartment: true, toDepartment: true, actor: { select: { name: true } } },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      take,
    }),
  ]);

  const auditPts = entries.map((e) => ({
    id: `audit-${e.id}`,
    when: e.createdAt,
    item: {
      id: `audit-${e.id}`, at: fmtDate(e.createdAt),
      title: (<><span className="font-medium text-fg">{e.actorLabel}</span> — <span className="font-mono text-xs">{e.action}</span></>),
    } satisfies TimelineItem,
  }));
  const approvalPts = approvals.map((a) => ({
    id: `approval-${a.id}`,
    when: a.createdAt,
    item: {
      id: `approval-${a.id}`, at: fmtDate(a.createdAt), status: a.state,
      title: (<>
        <span className="font-mono text-xs text-accent">{a.refNo}</span> · {APPROVAL_TYPE_LABEL[a.type]}
        {a.asset ? <> · <span className="font-mono text-xs">{a.asset.tag}</span></> : null} —{" "}
        <span className="font-mono text-xs">{a.state}</span>
      </>),
    } satisfies TimelineItem,
  }));
  const reservationPts = reservations.map((r) => ({
    id: `res-${r.id}`,
    when: r.createdAt,
    item: {
      id: `res-${r.id}`, at: fmtDate(r.createdAt), status: r.state,
      title: (<>
        hold on <span className="font-mono text-xs text-accent">{r.asset.tag}</span> —{" "}
        <span className="font-mono text-xs">{r.state}</span>
      </>),
    } satisfies TimelineItem,
  }));

  const transferPts = transfers.map((t) => ({
    id: `transfer-${t.id}`,
    when: t.effectiveAt,
    item: {
      id: `transfer-${t.id}`, at: fmtDate(t.effectiveAt),
      title: (<>
        Transferred to <b>{t.toDepartment.name}</b> (from {t.fromDepartment.name})
        {t.reason ? ` · ${t.reason}` : ""} — by {t.actor.name}
      </>),
    } satisfies TimelineItem,
  }));

  const { items, next } = mergeTimeline<TimelinePoint & { item: TimelineItem }>(
    [auditPts, approvalPts, reservationPts, transferPts],
    TIMELINE_PAGE_SIZE,
    cursor,
  );
  const merged = items.map((x) => x.item);

  return (
    <>
      <PageHeader
        title={`${employee.name} — timeline`}
        breadcrumb={[
          { label: "Employees", href: "/employees" },
          { label: employee.employeeNo, href: `/employees/${id}` },
          { label: "Timeline" },
        ]}
      />
      {merged.length === 0
        ? <EmptyState title="Nothing has happened yet" />
        : (
          <div className="max-w-[640px] pt-2">
            <TimelineList items={merged} />
            <div className="flex items-center gap-3 pt-1">
              {next && <ButtonLink href={`?${timelineCursorQS(next)}`}>Older</ButtonLink>}
              {cursor && <ButtonLink href="?">Newest</ButtonLink>}
            </div>
          </div>
        )}
    </>
  );
}
