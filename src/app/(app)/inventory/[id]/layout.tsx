import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset, lastLifecycleChange, spareOptions } from "@/server/modules/inventory/queries";
import { activeHoldFor } from "@/server/modules/reservations/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { fmtDate, localDateISO } from "@/lib/format";
import { canManageClass, defaultClassFor, isAwaitingItCheck, isDirectLifecycle, withViewClsQS } from "@/lib/asset-class";
import { recordActions, type RecordAction, type RecordState } from "@/lib/record-actions";
import { defaultHoldExpiry, minHoldExpiry } from "@/lib/holds";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { Banner } from "@/components/ui/banner";
import { HoldPill } from "@/components/ui/hold-pill";
import { RecordTabs } from "@/components/inventory/record-tabs";
import { RecordActions } from "@/components/inventory/record-actions";
import { LoanLine } from "@/components/inventory/loan-due-control";
import { ReleaseHoldButton } from "@/components/inventory/release-hold-button";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";
import { recentPicks } from "@/server/recent-picks";

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
  const returned = asset.financeReturnedAt !== null;
  const pending = asset.approvals[0];
  const direct = isDirectLifecycle(user.role, asset.cls);
  const hold = asset.cls === "IT" ? await activeHoldFor(asset.id) : null;
  const today = localDateISO(new Date());
  const loanDueAt = asset.loanDueAt?.toISOString().slice(0, 10) ?? null;

  // Phase 30 (spec §4.1, plan P-4): one rule decides the primary, the More items and Edit.
  const state: RecordState = {
    cls: asset.cls, status: asset.status, hasHolder: !!asset.assignee,
    returnedAt: asset.returnedAt, itVerifiedAt: asset.itVerifiedAt,
    financeConfirmedAt: asset.financeConfirmedAt, financeReturnedAt: asset.financeReturnedAt,
    pending: !!pending, held: !!hold,
  };
  const plan = recordActions(state, user.role);
  const offers = (a: RecordAction) => plan.primary === a || plan.more.includes(a);
  const needsPeople = offers("assign") || offers("reserve");
  const employees = needsPeople ? await activeEmployeeOptions() : [];
  const recentEmployees = needsPeople ? await recentPicks(user.id, "employee") : [];
  const spares = offers("replace") ? await spareOptions(asset.typeId) : { options: [], hidden: 0 };
  const canReleaseHold = direct && !!hold;

  // Spec §4.1: at most one pill that asks something of this viewer, first match wins.
  const ask =
    asset.returnedAt ? "BACK · NOT CHECKED"
    : awaitingIt && canManageClass(user.role, "IT") ? "AWAITING IT CHECK"
    : (user.role === "admin" || user.role === "finance_staff") && !asset.financeConfirmedAt && !awaitingIt ? "AWAITING FINANCE"
    : returned && canManageClass(user.role, asset.cls) ? "RETURNED BY FINANCE"
    : null;

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
        breadcrumb={[
          {
            label: asset.cls === "IT" ? "Inventory" : "Purchasing assets",
            href: "/inventory" + withViewClsQS("", asset.cls, defaultClassFor(user.role)),
          },
          { label: asset.tag },
        ]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={asset.status} />
            {ask && <Pill tone="accent">{ask}</Pill>}
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          <RecordActions
            plan={plan}
            asset={{
              id: asset.id, tag: asset.tag, model: asset.model, cls: asset.cls, status: asset.status,
              hasHolder: !!asset.assignee, loanDueAt,
            }}
            holder={asset.assignee ? { id: asset.assignee.id, name: asset.assignee.name } : null}
            direct={direct}
            employees={employees}
            recentEmployees={recentEmployees}
            heldFor={hold ? { id: hold.employee.id, name: hold.employee.name } : undefined}
            spares={spares}
            holdExpiry={{ defaultExpiry: defaultHoldExpiry(today), minExpiry: minHoldExpiry(today) }}
          />
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
              <Link href={`/employees/${asset.assignee.id}`} className="text-accent underline hover:text-accent-hover">
                {asset.assignee.name}
              </Link>
            </>
          )}
        </p>
        {last && (
          <p className="font-mono text-[11px] text-fg-muted">
            Last change: {last.phrase} · {fmtDate(last.at)} · {last.actor}
          </p>
        )}
        {asset.status === "TEMPORARY" && <LoanLine loanDueAt={loanDueAt} today={today} />}
      </div>
      {hold && (
        <div className="pb-3">
          <Banner
            tone="inflight"
            title={<>Held for <Link href={`/employees/${hold.employee.id}`} className="underline hover:text-accent-hover">{hold.employee.name}</Link></>}
            actions={canReleaseHold ? <ReleaseHoldButton reservationId={hold.id} tag={asset.tag} size="sm" /> : undefined}
          >
            <span className="inline-flex flex-wrap items-center gap-2">
              {hold.expiresAt && <HoldPill expiresAt={hold.expiresAt} today={today} withDate />}
              {hold.reason && <span className="text-fg-secondary">{hold.reason}</span>}
              <span className="font-mono text-[10.5px] text-fg-muted">{hold.employee.employeeNo}</span>
            </span>
          </Banner>
        </div>
      )}
      {pending && (
        <div className="pb-3">
          <Banner
            tone="inflight"
            title={`${pending.refNo} · ${APPROVAL_TYPE_LABEL[pending.type]} is ${pending.state.toLowerCase()}`}
          >
            Queued in the approval pipeline — until it executes, this asset still reads{" "}
            <span className="font-mono">{asset.status}</span> everywhere.{" "}
            <Link href={`/approvals/${pending.id}`} className="text-accent underline hover:text-accent-hover">Open request</Link>
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
