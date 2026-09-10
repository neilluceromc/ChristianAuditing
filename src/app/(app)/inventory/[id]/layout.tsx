import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset, lastLifecycleChange, spareOptions } from "@/server/modules/inventory/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { CLASS_LABEL, canEditAsset, canManageClass, isAssignable, isAwaitingItCheck, isDirectLifecycle } from "@/lib/asset-class";
import { PROVENANCE_LABEL, provenanceOf } from "@/lib/provenance";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { RecordTabs } from "@/components/inventory/record-tabs";
import { StatusControl } from "@/components/inventory/status-control";
import { FinanceReview } from "@/components/inventory/finance-review";
import { ItCheck } from "@/components/inventory/it-check";
import { HolderControl } from "@/components/inventory/holder-control";
import { LoanDueControl } from "@/components/inventory/loan-due-control";
import { ReplaceControl } from "@/components/inventory/replace-control";
import { TriageControl } from "@/components/inventory/triage-control";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";

export default async function AssetRecordLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();
  const awaitingIt = isAwaitingItCheck(asset);
  const canMutate = canManageClass(user.role, asset.cls);          // status, holder
  const canEdit = canEditAsset(user.role, asset);                  // spec §5.4
  const canCheck = awaitingIt && canManageClass(user.role, "IT");
  const returned = asset.financeReturnedAt !== null;
  // Finance confirms after IT (spec §5.3) — absent while awaiting, not disabled.
  const canConfirm = (user.role === "admin" || user.role === "finance_staff") && !asset.financeConfirmedAt && !awaitingIt;
  // Purchasing marks its own registrations corrected. The server action
  // already enforces this — b521e14.
  const canResubmit = canManageClass(user.role, asset.cls) && returned;
  const pending = asset.approvals[0];
  const direct = isDirectLifecycle(user.role, asset.cls);
  // Spec §7.1: offered only when the action would be legal; a pending approval
  // freezes both (the server would answer "already has an open request").
  const canAssign = canMutate && !pending && !asset.assignee && isAssignable(asset);
  const canReturn = canMutate && !pending && asset.assignee !== null;
  const canReplace = direct && canReturn;
  const canTriage = direct && !pending && asset.returnedAt !== null;
  const employees = canAssign ? await activeEmployeeOptions() : [];
  const spares = canReplace ? await spareOptions(asset.typeId) : [];
  // Phase 20 (spec §6.5, gap 5): while an approval is queued, the record
  // still reads the pre-approval status everywhere (see the Banner below) —
  // showing "Last change" from before that queued change would read as
  // stale/misleading next to it, so the line is withheld until nothing is
  // pending.
  const last = pending ? null : await lastLifecycleChange(asset.id);

  return (
    <>
      <PageHeader
        title={asset.tag}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: asset.tag }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={asset.status} />
            <Pill>{CLASS_LABEL[asset.cls].toUpperCase()}</Pill>
            {asset.purchaseRequest ? (
              <Link href={`/purchases/${asset.purchaseRequest.id}`}>
                <Pill tone="accent">From {asset.purchaseRequest.refNo}</Pill>
              </Link>
            ) : (
              // Spec §6 badge: the HISTORICAL pill reads "Historical import · no
              // purchase request"; the label map itself stays "Historical
              // import" (used elsewhere — facet, export, finance) and this
              // badge appends the suffix only here.
              <Pill>
                {PROVENANCE_LABEL[provenanceOf(asset)]}
                {provenanceOf(asset) === "HISTORICAL" && " · no purchase request"}
              </Pill>
            )}
            {asset.financeConfirmedAt ? (
              <Pill>FINANCE CONFIRMED · {fmtDate(asset.financeConfirmedAt)}</Pill>
            ) : returned ? (
              <Pill tone="accent">RETURNED BY FINANCE</Pill>
            ) : awaitingIt ? (
              <Pill tone="accent">AWAITING IT CHECK</Pill>
            ) : (
              // Accent, not neutral: the same shape as the repair-stage pill on
              // page.tsx, where settled reads neutral and in-flight reads accent.
              // Rendered neutral, "awaiting" is indistinguishable from "done".
              <Pill tone="accent">AWAITING FINANCE</Pill>
            )}
            {asset.returnedAt && <Pill tone="accent">BACK · NOT CHECKED</Pill>}
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          canMutate || canEdit || canCheck || canConfirm || canResubmit || canAssign || canReturn || canReplace || canTriage ? (
            <>
              {canCheck && <ItCheck assetId={asset.id} tag={asset.tag} />}
              {canTriage && <TriageControl assetId={asset.id} tag={asset.tag} />}
              {canAssign && <HolderControl mode="assign" assetId={asset.id} tag={asset.tag} employees={employees} direct={direct} />}
              {canReturn && asset.assignee && (
                <HolderControl mode="return" assetId={asset.id} tag={asset.tag} holder={{ id: asset.assignee.id, name: asset.assignee.name }} direct={direct} />
              )}
              {canReplace && asset.assignee && (
                <ReplaceControl assetId={asset.id} tag={asset.tag} employeeId={asset.assignee.id} employeeName={asset.assignee.name} spares={spares} />
              )}
              {canMutate && <StatusControl assetId={asset.id} tag={asset.tag} currentStatus={asset.status} cls={asset.cls} direct={direct} />}
              {canEdit && <ButtonLink href={`/inventory/${asset.id}/edit`}>Edit</ButtonLink>}
              {(canConfirm || canResubmit) && (
                <FinanceReview
                  assetId={asset.id}
                  tag={asset.tag}
                  cls={asset.cls}
                  canConfirm={canConfirm}
                  canResubmit={canResubmit}
                />
              )}
            </>
          ) : undefined
        }
      />
      {returned && asset.financeReturnReason && (
        <div className="pb-3">
          <Banner tone="fault" title="Finance sent this back">
            {asset.financeReturnReason}
          </Banner>
        </div>
      )}
      <div className="-mt-2 pb-3">
        <p className="text-[13px] text-fg-secondary">
          {asset.model}
          {asset.assignee && (
            <>
              {" · held by "}
              <a href={`/employees/${asset.assignee.id}`} className="text-accent underline hover:text-accent-hover">
                {asset.assignee.name}
              </a>
            </>
          )}
        </p>
        {last && (
          <p className="font-mono text-[11px] text-fg-muted">
            Last change: {last.sentence} · {fmtDate(last.at)} · by {last.actor}
          </p>
        )}
        {asset.status === "TEMPORARY" && canMutate && direct && (
          <LoanDueControl assetId={asset.id} tag={asset.tag} loanDueAt={asset.loanDueAt?.toISOString().slice(0, 10) ?? null} />
        )}
      </div>
      {pending && (
        <div className="pb-3">
          <Banner
            tone="inflight"
            title={`${pending.refNo} · ${APPROVAL_TYPE_LABEL[pending.type]} is ${pending.state.toLowerCase()}`}
          >
            Queued in the approval pipeline — until it executes, this asset still reads{" "}
            <span className="font-mono">{asset.status}</span> everywhere.
          </Banner>
        </div>
      )}
      {/* The tab route is IT-workspace-only (workspaces.ts PATH_RULES) and the
          Purchasing class has no credentials — viewer keeps the tab because
          secrets/page.tsx shows labels without values for that role. */}
      <RecordTabs
        assetId={asset.id}
        showSecrets={asset.cls === "IT" && (user.role === "admin" || user.role === "it_staff" || user.role === "viewer")}
      />
      <div className="pt-4">{children}</div>
    </>
  );
}
