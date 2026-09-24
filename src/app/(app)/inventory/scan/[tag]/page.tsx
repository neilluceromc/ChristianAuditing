import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { activeHoldFor } from "@/server/modules/reservations/queries";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";
import { fmtDate, localDateISO } from "@/lib/format";
import { CLASS_PHRASE, STATUS_LABEL, canSeeClass, isDirectLifecycle } from "@/lib/asset-class";
import { APPROVAL_TYPE_LABEL, EMPLOYMENT_LABEL } from "@/lib/labels";
import { recordPrimary, type RecordState } from "@/lib/record-actions";
import { attentionOf } from "@/lib/inventory-attention";
import { pathAllowedForRole } from "@/lib/workspaces";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { HoldPill } from "@/components/ui/hold-pill";
import { DuePill } from "@/components/ui/due-pill";
import { ScanAction, type ScanActionKind } from "@/components/inventory/scan-action";
import { ScanRetype } from "@/components/inventory/scan-retype";

/**
 * Where a scanned label QR lands. Deliberately NOT the full record: a phone
 * held next to a device should answer "whose is this, and is it healthy?"
 * without scrolling.
 *
 * Keyed on the TAG, never on the id. Cuids change on every reseed — the seed
 * TRUNCATEs and reinserts, and every e2e spec reseeds in its own beforeAll —
 * so a QR encoding an id would die the first time anyone ran the suite, on
 * paper already stuck to hardware. Asset.tag is @unique, so this is a natural
 * findUnique.
 *
 * Gating comes from the general /inventory PATH_RULES entry, which this route
 * matches by living under /inventory/. That is deliberate: PATH_RULES is
 * first-match-wins, three separate comments in that file warn about ordering,
 * and adding nothing to it is the safest possible change. The static `scan`
 * segment wins over the sibling [id] route the same way /inventory/labels
 * already does.
 *
 * Reading Prisma inline rather than via queries.ts follows the accountability
 * form page, which does the same for the same reason: one read, no reuse.
 */
export default async function ScanCardPage({ params }: { params: Promise<{ tag: string }> }) {
  const user = await requireUser();
  const { tag: raw } = await params;
  const tag = decodeURIComponent(raw).trim().toUpperCase();

  const asset = await prisma.asset.findUnique({
    where: { tag },
    select: {
      id: true,
      tag: true,
      model: true,
      serial: true,
      status: true,
      cls: true,
      purchasedAt: true,
      warrantyUntil: true,
      returnedAt: true,
      loanDueAt: true,
      itVerifiedAt: true,
      financeConfirmedAt: true,
      financeReturnedAt: true,
      category: { select: { name: true } },
      // The record layout's `pending`: the newest open approval (getVisibleAsset's filter and order).
      approvals: {
        where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
        select: { id: true, refNo: true, type: true, state: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      assignee: {
        select: {
          id: true,
          name: true,
          employeeNo: true,
          employment: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  // NOT notFound(): a sticker outlives the row it names. Assets get disposed
  // and the label stays on the hardware, so a miss is an expected outcome of
  // scanning, not an error. Name the tag back so the person holding the thing
  // knows the scan worked and the record is what is gone.
  if (!asset) {
    return (
      <>
        <PageHeader title="Unknown tag" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]} />
        <Banner tone="attention" title={`No asset is registered as ${tag}.`}>
          The label may belong to an asset that has been disposed, or the code may have been misread.
        </Banner>
        <ScanRetype tag={tag} />
        <div className="pt-3"><ButtonLink href="/inventory">Back to inventory</ButtonLink></div>
      </>
    );
  }

  // Phase 14 (spec §3.1): the sticker is real, so not "unknown" — but the
  // record is another department's. Name the tag, show nothing else.
  if (!canSeeClass(user.role, asset.cls)) {
    return (
      <>
        <PageHeader title={asset.tag} breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]} />
        <Banner tone="attention" title={`${asset.tag} is not in your register.`}>
          It belongs to {CLASS_PHRASE[asset.cls]} register. Ask that department if you need its details.
        </Banner>
        <div className="pt-3"><ButtonLink href="/inventory">Back to inventory</ButtonLink></div>
      </>
    );
  }

  // Phase 32 (spec §6): the same state the record header reads, so the scan
  // card offers exactly the record's primary — and only the four that make
  // sense next to the device (plan P-14).
  const pending = asset.approvals[0];
  const hold = asset.cls === "IT" ? await activeHoldFor(asset.id) : null;
  const today = localDateISO(new Date());
  const state: RecordState = {
    cls: asset.cls, status: asset.status, hasHolder: !!asset.assignee,
    returnedAt: asset.returnedAt, itVerifiedAt: asset.itVerifiedAt,
    financeConfirmedAt: asset.financeConfirmedAt, financeReturnedAt: asset.financeReturnedAt,
    pending: !!pending, held: !!hold,
  };
  const primary = recordPrimary(state, user.role);
  const SCAN_ACTIONS: readonly ScanActionKind[] = ["triage", "mark-checked", "return", "assign"];
  const action = SCAN_ACTIONS.find((a) => a === primary) ?? null;
  const attention = attentionOf({
    cls: asset.cls, status: asset.status, returnedAt: asset.returnedAt, loanDueAt: asset.loanDueAt,
    pendingRef: pending?.refNo ?? null, itVerifiedAt: asset.itVerifiedAt,
  }, new Date());
  const direct = isDirectLifecycle(user.role, asset.cls);
  const employees = action === "assign" ? await activeEmployeeOptions() : [];
  const holder = asset.assignee ? { id: asset.assignee.id, name: asset.assignee.name } : null;
  const leaver = asset.assignee?.employment === "OFFBOARDING" ? asset.assignee : null;
  // The app's own gate for the profile route: a holder link only where it would open.
  const canOpenPeople = asset.assignee ? pathAllowedForRole(`/employees/${asset.assignee.id}`, user.role) : false;
  const loanDue = asset.status === "TEMPORARY" ? asset.loanDueAt : null;

  const rows: Array<[string, React.ReactNode]> = [
    ["Status", STATUS_LABEL[asset.status]],
    [
      "Held by",
      asset.assignee ? (
        <>
          {canOpenPeople ? (
            <Link href={`/employees/${asset.assignee.id}`} className="text-accent underline hover:text-accent-hover">
              {asset.assignee.name}
            </Link>
          ) : (
            asset.assignee.name
          )}
          {` · ${asset.assignee.employeeNo}`}
        </>
      ) : "Unassigned",
    ],
    ["Department", asset.assignee ? asset.assignee.department.name : "—"],
    ["Employment", asset.assignee ? EMPLOYMENT_LABEL[asset.assignee.employment] : "—"],
    ["Category", asset.category.name],
    ["Purchased", fmtDate(asset.purchasedAt)],
    ["Warranty", fmtDate(asset.warrantyUntil)],
    ["Serial", asset.serial ?? "—"],
  ];

  return (
    <>
      <PageHeader
        title={asset.tag}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]}
        badge={<StatusPill value={asset.status} />}
      />
      <p className="-mt-2 pb-4 text-[13px] text-fg-secondary">{asset.model}</p>

      {/*
        Cost, vendor, repair quote and notes are deliberately absent. This page
        is reachable by anyone physically holding the device who has a login,
        including `viewer` — a wider audience than the full record's, because
        the full record is somewhere you navigate to deliberately and this is
        somewhere a sticker sends you. Acquisition cost behind an adhesive
        label is a disclosure nobody asked for. Anyone who needs it taps
        through.
      */}
      <dl className="flex flex-col gap-0 rounded-(--radius-card) border border-border bg-surface">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
            <dt className="w-28 shrink-0 text-[13px] text-fg-muted">{label}</dt>
            <dd className="text-[13px]">{value}</dd>
          </div>
        ))}
      </dl>

      {leaver && (
        <p className="pt-3 text-[13px]">
          <Link href={`/offboarding/${leaver.id}?step=collect`} className="text-accent underline hover:text-accent-hover">
            {leaver.name} is leaving · collect it in the offboarding wizard →
          </Link>
        </p>
      )}

      {(attention || hold?.expiresAt || loanDue) && (
        <div className="flex flex-wrap items-center gap-2 pt-3 text-[13px]">
          {attention && <span className="font-medium text-fg">{attention.label}</span>}
          {hold?.expiresAt && (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-fg-secondary">Held for {hold.employee.name}</span>
              <HoldPill expiresAt={hold.expiresAt} today={today} />
            </span>
          )}
          {loanDue && <DuePill dueAt={loanDue} today={today} withDate />}
        </div>
      )}

      {pending && (
        <div className="pt-3">
          <Banner
            tone="inflight"
            title={`${pending.refNo} · ${APPROVAL_TYPE_LABEL[pending.type]} is ${pending.state.toLowerCase()}`}
          >
            Queued in the approval pipeline — until it executes, this asset still reads{" "}
            {STATUS_LABEL[asset.status]} everywhere.{" "}
            <Link href={`/approvals/${pending.id}`} className="text-accent underline hover:text-accent-hover">Open request</Link>
          </Banner>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-4">
        {action && (
          <ScanAction
            action={action}
            asset={{ id: asset.id, tag: asset.tag, model: asset.model }}
            holder={holder}
            direct={direct}
            employees={employees}
            heldFor={hold ? { id: hold.employee.id, name: hold.employee.name } : undefined}
          />
        )}
        <ButtonLink href={`/inventory/${asset.id}`} className="min-h-11 w-full">Open full record</ButtonLink>
      </div>
    </>
  );
}
