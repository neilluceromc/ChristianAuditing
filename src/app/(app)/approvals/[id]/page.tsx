import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { getApproval, nextInQueue, systemChecks } from "@/server/modules/approvals/queries";
import { summarizeApproval } from "@/lib/approval-execution";
import { slaLabel } from "@/lib/approvals-list";
import { APPROVAL_TYPE_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { canActOnApproval, isApprover } from "@/lib/approval-access";
import { approvalHeader } from "@/lib/approval-header";
import { failureCause } from "@/lib/approval-failure";
import { canSeeClass } from "@/lib/asset-class";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Pill } from "@/components/ui/pill";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { ApprovalHeaderActions } from "@/components/approvals/approval-header";
import { NextInQueue } from "@/components/approvals/next-in-queue";
import { TagRef } from "@/components/inventory/tag-ref";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const approval = await getApproval(id);
  if (!approval) notFound();
  const checks = approval.appliedDirectly ? null : await systemChecks(approval);
  const canAct = canActOnApproval(user.role, approval.asset?.cls ?? null);
  const mine = approval.claimedById === user.id;
  const plan = approvalHeader({ state: approval.state, canAct, mine, isAdmin: user.role === "admin" });
  // P-8: once the header has no primary (decided, closed, or someone else's claim), point at the next request.
  const next = isApprover(user.role) && plan.primary === null
    ? { item: await nextInQueue(user.id, user.role, approval.id) }
    : null;
  const sla = slaLabel(approval.slaAt);
  const s = summarizeApproval(approval.type, approval.payload, {
    assetTag: approval.asset?.tag,
    employeeName: approval.employee?.name,
    cls: approval.asset?.cls,
  });
  const cause = approval.state === "EXECUTION_FAILED" ? failureCause(approval.workerError) : null;
  const fromOffboarding =
    approval.type === "lifecycle_return" && approval.employee?.employment === "OFFBOARDING" ? approval.employee : null;

  return (
    <>
      <PageHeader
        title={approval.refNo}
        breadcrumb={[{ label: "Approvals", href: "/approvals" }, { label: approval.refNo }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={approval.state} />
            {approval.priority !== "NORMAL" && <Pill tone="accent">{PRIORITY_LABEL[approval.priority]}</Pill>}
          </span>
        }
        actions={
          <ApprovalHeaderActions
            id={approval.id}
            refNo={approval.refNo}
            plan={plan}
            ownerName={approval.state === "CLAIMED" && !mine ? (approval.claimedBy?.name ?? "someone else") : null}
          />
        }
      />
      {approval.appliedDirectly ? (
        <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
          {APPROVAL_TYPE_LABEL[approval.type]} · applied directly by{" "}
          {approval.claimedBy?.name ?? approval.requestedBy.name} · {fmtDateTime(approval.resolvedAt)}
        </p>
      ) : (
        <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
          {APPROVAL_TYPE_LABEL[approval.type]} · requested by {approval.requestedBy.name} · {fmtDate(approval.createdAt)} · SLA{" "}
          <span className={sla.overdue ? "font-semibold text-[color:var(--st-fault-text)]" : undefined}>{sla.text}</span>
        </p>
      )}
      {next && (
        <div className="-mt-2 pb-4">
          <NextInQueue next={next.item} />
        </div>
      )}

      {approval.state === "EXECUTION_FAILED" && (
        <div className="max-w-[900px] pb-4">
          <Banner tone="fault" title="The change could not be applied.">
            {cause && <p>{cause}</p>}
            {approval.workerError && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-fg-secondary">Worker error</summary>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">{approval.workerError}</pre>
              </details>
            )}
          </Banner>
        </div>
      )}

      <div className="grid max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Before → after" />
          <CardBody className="flex flex-col gap-2.5">
            <DescriptionList
              items={[
                { label: "Change", value: s.line2 || s.line1 },
                {
                  label: "Asset",
                  value: approval.asset ? (
                    <TagRef
                      id={approval.asset.id}
                      tag={`${approval.asset.tag} · ${approval.asset.model}`}
                      visible={canSeeClass(user.role, approval.asset.cls)}
                      className="text-accent hover:underline"
                    />
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
            {fromOffboarding && (
              <Link
                href={`/offboarding/${fromOffboarding.id}?step=collect`}
                className="text-xs text-accent hover:underline"
              >
                Open the offboarding wizard →
              </Link>
            )}
          </CardBody>
        </Card>

        {approval.appliedDirectly ? (
          <Card>
            <CardHeader title="How it was applied" />
            <CardBody className="flex flex-col gap-2.5">
              <p className="text-xs text-fg">
                Applied directly by{" "}
                <strong className="font-semibold text-fg">
                  {approval.claimedBy?.name ?? approval.requestedBy.name}
                </strong>{" "}
                on {fmtDateTime(approval.resolvedAt)}. No request was queued — the change took effect the
                moment {approval.claimedBy?.name ?? approval.requestedBy.name} confirmed it, and it is
                recorded in the audit trail under their name.
              </p>
              {approval.assetId && (
                <Link href={`/inventory/${approval.assetId}/history`} className="text-xs text-accent hover:underline">
                  See the asset&apos;s history →
                </Link>
              )}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="What the system checked" />
            <CardBody className="flex flex-col gap-2.5">
              {checks!.map((c) => (
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
        )}
      </div>

      {approval.state === "APPROVED" && (
        <div className="max-w-[900px] pt-4">
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block size-[7px] rounded-full bg-[var(--st-inflight-dot)] animate-[pulse_1.9s_ease-in-out_infinite]" />
                  Queued for execution
                </span>
              }
            />
            <CardBody>
              <p className="text-xs text-fg-secondary">
                The worker picks this up within seconds. Until it lands, the asset still reads its old status everywhere.
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
