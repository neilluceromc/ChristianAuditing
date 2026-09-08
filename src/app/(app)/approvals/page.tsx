import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { parseTab, QUEUE_TABS, type QueueTab } from "@/lib/approvals-list";
import { listApprovals, tabCounts } from "@/server/modules/approvals/queries";
import { isApprover } from "@/lib/approval-access";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { QueueTable } from "@/components/approvals/queue-table";

const hrefFor = (t: QueueTab, p: number) => {
  const qs = new URLSearchParams();
  if (t !== "open") qs.set("tab", t);
  if (p > 1) qs.set("page", String(p));
  const s = qs.toString();
  return s ? `/approvals?${s}` : "/approvals";
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canAct = isApprover(user.role);
  const sp = toSearchParams(await searchParams);
  const tab = parseTab(sp.get("tab"));
  const requestedPage = parsePage(sp);
  const [{ rows, total, page, pageCount }, counts] = await Promise.all([
    listApprovals(tab, user.id, user.role, requestedPage),
    tabCounts(user.id, user.role),
  ]);

  return (
    <>
      <PageHeader
        title="Approvals"
        badge={!canAct ? <Pill>READ-ONLY · {user.role.replace("_", " ").toUpperCase()}</Pill> : undefined}
      />
      <div className="flex flex-col gap-3">
        <nav aria-label="Queue tabs" className="flex gap-1 border-b border-border">
          {QUEUE_TABS.map((t) => (
            <Link
              key={t.id}
              href={t.id === "open" ? "/approvals" : `/approvals?tab=${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className={cn(
                "relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-(--dur-1)",
                t.id === tab ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {t.label}
              <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{counts[t.id]}</span>
              {t.id === tab && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-accent" />}
            </Link>
          ))}
        </nav>
        {rows.length > 0 ? (
          <QueueTable rows={rows} canAct={canAct} />
        ) : (
          <EmptyState
            title={tab === "open" ? "The queue is clear" : `Nothing in ${QUEUE_TABS.find((t) => t.id === tab)?.label}`}
            description={tab === "open" ? "New lifecycle requests land here the moment they're made." : undefined}
          />
        )}
        {rows.length > 0 && (
          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-[10px] text-fg-muted">
              page {page} of {pageCount} · {total} in this tab{tab !== "closed" ? " — ordered by SLA, what breaks first" : ""}
            </span>
            <Pagination page={page} pageCount={pageCount} hrefFor={(p) => hrefFor(tab, p)} />
          </div>
        )}
        {canAct && rows.length > 0 && (
          <p className="font-mono text-[10px] text-fg-muted">
            J/K move · Enter opens · C claim · A approve · R reject · E escalate
          </p>
        )}
      </div>
    </>
  );
}
