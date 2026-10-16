import Link from "next/link";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { DuePill } from "@/components/ui/due-pill";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";

export interface BandApproval {
  id: string;
  refNo: string;
  createdAt: Date;
}

/**
 * Phase 37 (spec §4.1): the full-width identity band across the top of the profile — who they are, where they
 * sit, what they hold. Server-rendered; the actions slot receives the (client) `ProfileActions`. The name is
 * the page's h1 (the page header above it carries only the breadcrumb and Back).
 */
export function IdentityBand({
  employeeId, name, title, groupName, groupIsClient, employeeNo, joinedAt, m365Status, employment, offboardingDueAt, today,
  isViewer, transfer, actions, held, bookValue, oldest, openApprovals, progress,
}: {
  employeeId: string;
  name: string;
  title: string;
  groupName: string;
  groupIsClient: boolean;
  employeeNo: string;
  joinedAt: Date;
  m365Status: string | null;
  employment: string;
  offboardingDueAt: Date | null;
  today: string;
  isViewer: boolean;
  transfer: { from: string; effectiveAt: Date } | null;
  actions: React.ReactNode;
  held: number;
  bookValue: number;
  oldest: Date | null;
  openApprovals: BandApproval[];
  progress: { filled: number; total: number; policyName: string } | null;
}) {
  const recent = [...openApprovals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5);
  return (
    <section
      aria-label="Identity"
      data-testid="identity-band"
      className="mb-4 flex flex-col gap-4 rounded-(--radius-card) border border-border bg-surface px-4 py-4 shadow-card"
    >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3.5">
            <Avatar name={name} size="xxl" className="shrink-0" />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold leading-tight tracking-[-0.015em] text-fg">{name}</h1>
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot value={employment} ns="employment" />
                  <span className="font-mono text-[10.5px] text-fg-muted">{employment}</span>
                  {employment === "OFFBOARDING" && offboardingDueAt && (
                    <DuePill dueAt={offboardingDueAt} today={today} withDate />
                  )}
                  {isViewer && <Pill>READ-ONLY · VIEWER</Pill>}
                </span>
              </div>
              <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-fg-secondary">
                <span>{title}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {groupName}
                  {groupIsClient && (
                    <span className="rounded-full border border-border-strong bg-surface-subtle px-1.5 py-px text-[10px] font-medium leading-tight text-fg-secondary">
                      Client
                    </span>
                  )}
                </span>
                <span aria-hidden>·</span>
                <span className="font-mono text-[11.5px]">{employeeNo}</span>
              </p>
              <p className="text-[11.5px] text-fg-muted">
                Joined {fmtDate(joinedAt)} · M365 {m365Status ?? "no sync yet"}
              </p>
              {transfer && (
                <p className="text-[11.5px] text-fg-muted">
                  Transferred from {transfer.from} on {fmtDate(transfer.effectiveAt)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>

        {held === 0 ? (
          // Phase 29 (rulings R11/R14): "No items yet" replaces Book value and Oldest item (Items held is
          // implied by the line itself) — never the Open-requests count, which on a day-one hire is the
          // ONLY number the strip has to give.
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-xs text-fg-muted">No items yet</p>
            {openApprovals.length > 0 && <Stat label="Open requests" value={String(openApprovals.length)} />}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Items held" value={String(held)} />
            <Stat label="Book value" value={fmtMoney(bookValue)} />
            <Stat label="Oldest item" value={oldest ? fmtDate(oldest) : "—"} />
            <Stat label="Open requests" value={String(openApprovals.length)} />
          </div>
        )}

        {progress ? (
          <div className="flex flex-col gap-1.5" data-testid="loadout-progress">
            <ProgressBar value={progress.filled} max={progress.total} label="Slots filled" />
            <span className="font-mono text-[10.5px] text-fg-muted">
              {progress.filled} of {progress.total} slots filled · {progress.policyName}
            </span>
          </div>
        ) : (
          <p className="text-xs text-fg-muted" data-testid="loadout-progress">No equipment policy applies</p>
        )}

        {openApprovals.length > 0 && (
          // Phase 25 (spec §4 row 6): the count above, the requests themselves here.
          <ul className="flex flex-wrap gap-x-2 gap-y-1">
            {recent.map((a) => (
              <li key={a.id}>
                <Link href={`/approvals/${a.id}`} className="font-mono text-xs text-accent hover:underline">{a.refNo}</Link>
              </li>
            ))}
            {openApprovals.length > 5 && (
              <li>
                <Link href={`/employees/${employeeId}/timeline`} className="text-xs text-fg-muted hover:underline">
                  +{openApprovals.length - 5} more
                </Link>
              </li>
            )}
          </ul>
        )}
    </section>
  );
}
