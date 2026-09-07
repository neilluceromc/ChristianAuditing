import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { CLASS_LABEL, canEditAsset, canManageClass, isAwaitingItCheck } from "@/lib/asset-class";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { RecordTabs } from "@/components/inventory/record-tabs";
import { RequestStatusChange } from "@/components/inventory/request-status-change";
import { FinanceReview } from "@/components/inventory/finance-review";
import { ItCheck } from "@/components/inventory/it-check";

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

  return (
    <>
      <PageHeader
        title={asset.tag}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: asset.tag }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={asset.status} />
            <Pill>{CLASS_LABEL[asset.cls].toUpperCase()}</Pill>
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
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          canMutate || canEdit || canCheck || canConfirm || canResubmit ? (
            <>
              {canCheck && <ItCheck assetId={asset.id} tag={asset.tag} />}
              {canMutate && <RequestStatusChange assetId={asset.id} currentStatus={asset.status} cls={asset.cls} />}
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
      <p className="-mt-2 pb-3 text-[13px] text-fg-secondary">
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
