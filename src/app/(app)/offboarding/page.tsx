import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { parseListState, serializeListState, toggleSort, toSearchParams, withFilter, type ListState } from "@/lib/url-state";
import { OFFBOARDING_LIST_CONFIG } from "@/lib/offboarding-list";
import { listOffboarding } from "@/server/modules/offboarding/queries";
import { offboardingNext } from "@/lib/offboarding";
import { fmtDate, localDateISO } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DuePill } from "@/components/ui/due-pill";
import { OffboardingToolbar } from "@/components/offboarding/offboarding-toolbar";
import { OffboardingMoreMenu } from "@/components/offboarding/offboarding-more-menu";

export default async function OffboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const sp = toSearchParams(await searchParams);
  // R2: the toolbar and sortable headers are Task 5's — this call site only
  // needs to switch from a bare page number to the full ListState so
  // listOffboarding's new facets/sort contract has something to read.
  const state = parseListState(sp, OFFBOARDING_LIST_CONFIG);
  const { rows, total, page, pageCount, facets } = await listOffboarding(state);
  const href = (s: ListState) => "/offboarding" + serializeListState(s, OFFBOARDING_LIST_CONFIG);
  // One href per sortable key (inventory/page.tsx's own `sortHrefs` pattern) —
  // this page has no client sub-table to hand them to, so the header itself
  // is a plain link built straight from the toggled sort.
  const sortHref = (key: string) => href({ ...state, sort: toggleSort(state.sort, key), page: 1 });
  const sortDir = (key: string) => state.sort.find((s) => s.key === key)?.dir;
  const sortIndex = (key: string) => {
    const i = state.sort.findIndex((s) => s.key === key);
    return i === -1 ? undefined : i + 1;
  };
  // R2: a facet (or a hand-typed ?q=) narrowing the queue to zero rows is a
  // real, reachable state here — the population is small — and is not the
  // same story as nobody being offboarded at all. Same test suppliers/page.tsx
  // and stock/page.tsx use to pick their empty-state copy.
  const filtered = Boolean(state.q) || Object.keys(state.filters).length > 0;
  const today = localDateISO(new Date());
  const overdueCount = Number(facets.due.find((o) => o.value === "overdue")?.count ?? 0);

  return (
    <>
      <PageHeader
        title="Offboarding"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={<OffboardingMoreMenu exportHref={"/offboarding/export" + serializeListState(state, OFFBOARDING_LIST_CONFIG)} />}
      />
      <div className="flex flex-col gap-2">
        <OffboardingToolbar state={state} facets={facets} />
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No one matches these filters" : "No one is leaving"}
            description={
              filtered
                ? undefined
                : "Start offboarding from a person's profile — More › Start offboarding…"
            }
            actions={
              filtered
                ? <ButtonLink href="/offboarding">Clear filters</ButtonLink>
                : <ButtonLink href="/employees">Open employees</ButtonLink>
            }
          />
        ) : (
          <>
            <p aria-live="polite" className="text-[12px] text-fg-muted">
              {total} {total === 1 ? "person" : "people"} leaving
              {overdueCount > 0 && (
                <> · <Link href={"/offboarding" + serializeListState(withFilter(state, "due", ["overdue"]), OFFBOARDING_LIST_CONFIG)} className="text-accent underline hover:text-accent-hover">{overdueCount} overdue</Link></>
              )}
            </p>
            <Table>
              <THead>
                <Tr>
                  <Th width={19}><span className="sr-only">Employment colour</span></Th>
                  <Th sort={sortDir("name")} sortIndex={sortIndex("name")}>
                    <Link href={sortHref("name")}>Name</Link>
                  </Th>
                  <Th width={132}>Department</Th>
                  <Th width={104} sort={sortDir("started")} sortIndex={sortIndex("started")}>
                    <Link href={sortHref("started")}>Started</Link>
                  </Th>
                  <Th width={168} sort={sortDir("due")} sortIndex={sortIndex("due")}>
                    <Link href={sortHref("due")}>Due</Link>
                  </Th>
                  <Th width={150} sort={sortDir("undecided")} sortIndex={sortIndex("undecided")}>
                    <Link href={sortHref("undecided")}>Progress</Link>
                  </Th>
                  <Th width={124} aria-label="Row actions" />
                </Tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="pr-0"><StatusDot value="OFFBOARDING" ns="employment" /></Td>
                    <Td>
                      <Link href={`/offboarding/${r.id}`} className="flex items-center gap-2.5 hover:underline">
                        <span className="flex flex-col leading-tight">
                          <span className="text-[12.5px] font-medium text-fg">{r.name}</span>
                          <span className="font-mono text-[10px] text-fg-faint">
                            {r.employeeNo} · {r.title}
                          </span>
                          {r.attention?.label && (
                            <span
                              className={
                                "text-[10.5px] " +
                                (r.attention.kind === "failed" || r.attention.kind === "overdue"
                                  ? "font-medium"
                                  : "text-fg-muted")
                              }
                              style={
                                r.attention.kind === "failed" || r.attention.kind === "overdue"
                                  ? { color: "var(--st-attention-text)" }
                                  : undefined
                              }
                            >
                              {r.attention.label}
                            </span>
                          )}
                        </span>
                      </Link>
                    </Td>
                    <Td>{r.department}</Td>
                    <Td mono>{fmtDate(r.started)}</Td>
                    <Td>{r.dueAt ? <DuePill dueAt={r.dueAt} today={today} withDate /> : <span className="text-fg-faint">—</span>}</Td>
                    <Td>
                      <span className="font-mono text-[11px] text-fg">{r.decided} of {r.total} decided</span>
                      <ProgressBar value={r.decided} max={r.total} label={`${r.name}: ${r.decided} of ${r.total} decided`} />
                    </Td>
                    <Td className="text-right">
                      {(() => {
                        const next = canMutate
                          ? offboardingNext({
                              id: r.id, employment: r.employment, dueAt: r.dueAt, undecided: r.undecided,
                              failed: r.failed, m365Status: r.m365,
                            })
                          : null;
                        return next
                          ? <ButtonLink size="sm" variant="secondary" href={next.href}>{next.label}</ButtonLink>
                          : <ButtonLink size="sm" variant="ghost" href={`/offboarding/${r.id}`}>View</ButtonLink>;
                      })()}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
          </>
        )}
      </div>
    </>
  );
}
