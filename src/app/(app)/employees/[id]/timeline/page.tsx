import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TimelineList, type TimelineItem } from "@/components/patterns/timeline-list";

export default async function EmployeeTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  const [entries, approvals, reservations] = await Promise.all([
    prisma.auditEntry.findMany({ where: { entityType: "employee", entityId: id } }),
    prisma.approval.findMany({ where: { employeeId: id }, include: { asset: true } }),
    prisma.reservation.findMany({ where: { employeeId: id }, include: { asset: true } }),
  ]);

  const merged = [
    ...entries.map((e) => ({
      when: e.createdAt,
      item: {
        id: `audit-${e.id}`, at: fmtDate(e.createdAt),
        title: (<><span className="font-medium text-fg">{e.actorLabel}</span> — <span className="font-mono text-xs">{e.action}</span></>),
      } satisfies TimelineItem,
    })),
    ...approvals.map((a) => ({
      when: a.createdAt,
      item: {
        id: `approval-${a.id}`, at: fmtDate(a.createdAt), status: a.state,
        title: (<>
          <span className="font-mono text-xs text-accent">{a.refNo}</span> · {APPROVAL_TYPE_LABEL[a.type]}
          {a.asset ? <> · <span className="font-mono text-xs">{a.asset.tag}</span></> : null} —{" "}
          <span className="font-mono text-xs">{a.state}</span>
        </>),
      } satisfies TimelineItem,
    })),
    ...reservations.map((r) => ({
      when: r.createdAt,
      item: {
        id: `res-${r.id}`, at: fmtDate(r.createdAt), status: r.state,
        title: (<>
          hold on <span className="font-mono text-xs text-accent">{r.asset.tag}</span> —{" "}
          <span className="font-mono text-xs">{r.state}</span>
        </>),
      } satisfies TimelineItem,
    })),
  ]
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .map((x) => x.item);

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
        : <div className="max-w-[640px] pt-2"><TimelineList items={merged} /></div>}
    </>
  );
}
