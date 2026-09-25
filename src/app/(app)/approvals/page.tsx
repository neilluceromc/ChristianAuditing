import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { approvalsHref, parseTab, parseTypes, parseVia, QUEUE_TABS } from "@/lib/approvals-list";
import { listApprovals, tabCounts, closedViaCounts, typeCounts } from "@/server/modules/approvals/queries";
import { isApprover } from "@/lib/approval-access";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Tabs } from "@/components/ui/tabs";
import { ListNavigationProvider, ListPendingRegion, NavLink } from "@/components/patterns/list-navigation";
import { QueueTable } from "@/components/approvals/queue-table";
import { ClosedViaChips } from "@/components/approvals/closed-via-chips";
import { ApprovalsToolbar } from "@/components/approvals/approvals-toolbar";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canAct = isApprover(user.role);
  const sp = toSearchParams(await searchParams);
  const tab = parseTab(sp.get("tab"));
  const via = tab === "closed" ? parseVia(sp.get("via")) : "all";
  // Plan P-5: the search and the Type facet sit beside tab / via / page and narrow every tab and count.
  const q = (sp.get("q") ?? "").trim();
  const types = parseTypes(sp.get("type"));
  const search = { q, types };
  const requestedPage = parsePage(sp);
  const [{ rows, total, page, pageCount }, counts, viaCounts, typeOptions] = await Promise.all([
    listApprovals(tab, via, user.id, user.role, requestedPage, search),
    tabCounts(user.id, user.role, search),
    tab === "closed" ? closedViaCounts(user.id, user.role, search) : Promise.resolve(null),
    typeCounts(tab, via, user.id, user.role, q),
  ]);
  const searching = q !== "" || types.length > 0;

  return (
    <>
      <PageHeader
        title="Approvals"
        badge={!canAct ? <Pill>READ-ONLY · {user.role.replace("_", " ").toUpperCase()}</Pill> : undefined}
      />
      <ListNavigationProvider>
        <div className="flex flex-col gap-3">
          <Tabs
            label="Queue tabs"
            items={QUEUE_TABS.map((t) => ({
              label: <>{t.label}<span className="ml-1.5 font-mono text-[10px] text-fg-faint">{counts[t.id]}</span></>,
              href: approvalsHref({ tab: t.id, q, types }),
              active: t.id === tab,
            }))}
          />
          <ApprovalsToolbar tab={tab} via={via} q={q} types={types} typeOptions={typeOptions} />
          {tab === "closed" && viaCounts && (
            <ClosedViaChips via={via} counts={viaCounts} q={q} types={types} />
          )}
          <ListPendingRegion className="flex flex-col gap-3">
            {rows.length > 0 ? (
              <QueueTable rows={rows} canAct={canAct} isAdmin={user.role === "admin"} />
            ) : searching ? (
              // The house no-match state (inventory, employees): a search or a Type pick found nothing in this tab.
              <EmptyState
                title="Your filters matched nothing"
                description={`${(q ? 1 : 0) + types.length} active filter${(q ? 1 : 0) + types.length === 1 ? "" : "s"} — loosen or clear them.`}
              />
            ) : (
              <EmptyState
                title={
                  tab === "open"
                    ? "The queue is clear"
                    : tab === "closed" && via === "direct"
                      ? "Nothing has been applied directly"
                      : tab === "closed" && via === "queue"
                        ? "Nothing has come through the queue yet"
                        : `Nothing in ${QUEUE_TABS.find((t) => t.id === tab)?.label}`
                }
                description={
                  tab === "open"
                    ? "New lifecycle requests land here the moment they're made."
                    : tab === "closed" && via === "direct"
                      ? "Direct IT changes will appear here as they happen."
                      : undefined
                }
              />
            )}
            {rows.length > 0 && (
              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-[10px] text-fg-muted">
                  {pageCount > 1 ? `page ${page} of ${pageCount} · ` : ""}
                  {total} in this tab{tab !== "closed" ? " — ordered by SLA" : ""}
                </span>
                {/* NavLink: a page change runs through the shared transition and marks the list busy */}
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  hrefFor={(p) => approvalsHref({ tab, page: p, via, q, types })}
                  linkComponent={NavLink}
                />
              </div>
            )}
            {canAct && rows.length > 0 && (
              <p className="font-mono text-[10px] text-fg-muted">
                J/K move · Enter opens · C claim · A approve · R reject · E escalate
              </p>
            )}
          </ListPendingRegion>
        </div>
      </ListNavigationProvider>
    </>
  );
}
