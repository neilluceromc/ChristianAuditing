import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { parseListState, serializeListState, toggleSort, toSearchParams, type ListState } from "@/lib/url-state";
import { OFFBOARDING_LIST_CONFIG } from "@/lib/offboarding-list";
import { listOffboarding } from "@/server/modules/offboarding/queries";
import { fmtDate } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { OffboardingToolbar } from "@/components/offboarding/offboarding-toolbar";

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

  return (
    <>
      <PageHeader
        title="Offboarding"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Nobody is offboarding"
          description="Set someone's employment to OFFBOARDING on their employee record and they appear here with whatever they still hold."
          actions={<ButtonLink href="/employees">Open employees</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <OffboardingToolbar state={state} facets={facets} />
          <p className="font-mono text-[11px] text-fg-muted">
            {total} {total === 1 ? "person" : "people"} leaving · every item is collected as its own request
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
                <Th width={84}>Items out</Th>
                <Th width={150} sort={sortDir("undecided")} sortIndex={sortIndex("undecided")}>
                  <Link href={sortHref("undecided")}>Undecided</Link>
                </Th>
                <Th width={104}>M365</Th>
                <Th width={112}>Joined</Th>
                <Th width={124} aria-label="Row actions" />
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="pr-0"><StatusDot value="OFFBOARDING" ns="employment" /></Td>
                  <Td>
                    <Link href={`/offboarding/${r.id}`} className="text-accent hover:underline">{r.name}</Link>
                    <span className="pl-1.5 font-mono text-[10.5px] text-fg-muted">{r.employeeNo} · {r.title}</span>
                  </Td>
                  <Td>{r.department}</Td>
                  <Td mono>{fmtDate(r.started)}</Td>
                  <Td mono>{r.itemsOut}</Td>
                  <Td mono className="text-[10.5px]">
                    {r.total === 0 ? (
                      "nothing to collect"
                    ) : (
                      <>
                        {/* of the WHOLE offboarding, including items whose return
                            already executed — counting only what is still out made
                            this numerator run backwards as work progressed */}
                        {r.decided} of {r.total}
                        {r.undecided > 0 && (
                          <span className="pl-1 font-medium" style={{ color: "var(--st-attention-text)" }}>
                            · {r.undecided} to go
                          </span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td mono className="text-[10.5px]">{r.m365 ?? "no sync yet"}</Td>
                  <Td mono>{r.joined}</Td>
                  <Td>
                    <ButtonLink size="sm" variant={canMutate ? "primary" : "secondary"} href={`/offboarding/${r.id}`}>
                      {canMutate ? "Open wizard" : "View"}
                    </ButtonLink>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
        </div>
      )}
    </>
  );
}
