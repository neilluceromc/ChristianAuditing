import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { getApproval, systemChecks } from "@/server/modules/approvals/queries";
import { summarizeApproval } from "@/lib/approval-execution";
import { slaLabel } from "@/lib/approvals-list";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Pill } from "@/components/ui/pill";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { ApprovalActions } from "@/components/approvals/approval-actions";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const approval = await getApproval(id);
  if (!approval) notFound();
  const checks = await systemChecks(approval);
  const canAct = user.role === "admin" || user.role === "it_staff";
  const mine = approval.claimedById === user.id;
  const sla = slaLabel(approval.slaAt);
  const s = summarizeApproval(approval.type, approval.payload, {
    assetTag: approval.asset?.tag,
    employeeName: approval.employee?.name,
  });

  return (
    <>
      <PageHeader
        title={approval.refNo}
        breadcrumb={[{ label: "Approvals", href: "/approvals" }, { label: approval.refNo }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={approval.state} />
            {approval.priority !== "NORMAL" && <Pill tone="accent">{approval.priority}</Pill>}
          </span>
        }
      />
      <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
        {APPROVAL_TYPE_LABEL[approval.type]} · requested by {approval.requestedBy.name} · {fmtDate(approval.createdAt)} · SLA{" "}
        <span className={sla.overdue ? "font-semibold text-[color:var(--st-fault-text)]" : undefined}>{sla.text}</span>
      </p>

      <div className="grid max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What the system checked" />
          <CardBody className="flex flex-col gap-2.5">
            {checks.map((c) => (
              <div key={c.label} className="flex items-baseline gap-2 text-xs">
                <StatusDot value={c.pass ? "DEPLOYED" : "DEFECTIVE"} />
                <span className="font-medium text-fg">{c.label}</span>
                <span className="ml-auto font-mono text-[10.5px] text-fg-muted">{c.detail}</span>
              </div>
            ))}
            <p className="pt-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-muted">
              checked just now — execution re-checks in its own transaction
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Before → after" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Change", value: s.line2 || s.line1 },
                {
                  label: "Asset",
                  value: approval.asset ? (
                    <Link href={`/inventory/${approval.asset.id}`} className="text-accent hover:underline">
                      {approval.asset.tag} · {approval.asset.model}
                    </Link>
                  ) : ("—"),
                },
                {
                  label: "Employee",
                  value: approval.employee ? (
                    <Link href={`/employees/${approval.employee.id}`} className="text-accent hover:underline">
                      {approval.employee.name} · {approval.employee.employeeNo}
                    </Link>
                  ) : ("—"),
                },
                ...(approval.resolutionReason
                  ? [{ label: "Resolution", value: approval.resolutionReason }]
                  : []),
                ...(approval.resolvedAt
                  ? [{ label: "Resolved", value: fmtDate(approval.resolvedAt), mono: true }]
                  : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="max-w-[900px] pt-4">
        <ApprovalActions
          id={approval.id}
          refNo={approval.refNo}
          state={approval.state}
          mine={mine}
          ownerName={approval.claimedBy?.name ?? null}
          canAct={canAct}
          isAdmin={user.role === "admin"}
          workerError={approval.workerError}
        />
      </div>
    </>
  );
}
