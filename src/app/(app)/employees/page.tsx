import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { clearFilters, parseListState, serializeListState, toSearchParams } from "@/lib/url-state";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { employeeFacetOptions, listEmployees } from "@/server/modules/employees/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmployeesToolbar } from "@/components/employees/employees-toolbar";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  // Matches the PATH_RULES entry that gates /employees/import itself
  // (workspaces.ts, E-7) — the same canMutate the inventory list page uses
  // for its own Import button.
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const sp = toSearchParams(await searchParams);
  const state = parseListState(sp, EMPLOYEES_LIST_CONFIG);
  const gapsOnly = sp.get("gaps") === "1";

  const [{ rows, total, pageCount }, facets] = await Promise.all([
    listEmployees(state, gapsOnly),
    employeeFacetOptions(state),
  ]);

  const href = (s: typeof state, gaps = gapsOnly, base = "/employees") => {
    const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
    return base + (gaps ? (qs ? `${qs}&gaps=1` : "?gaps=1") : qs);
  };
  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0 || gapsOnly;

  return (
    <>
      <PageHeader
        title="Employees"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={
          <>
            {/* Carries the same q/facets/gaps as the list — the export
                honours "Policy gaps only" exactly like listEmployees does,
                via the shared filteredEmployees cut, so the sheet matches
                what's on screen. */}
            <ButtonLink href={href(state, gapsOnly, "/employees/export")}>Export</ButtonLink>
            {/* Absent, not disabled, for a role that can't reach the page —
                canMutate is exactly admin/it_staff, matching the PATH_RULES
                entry that gates /employees/import itself (E-7). */}
            {canMutate && <ButtonLink href="/employees/import">Import</ButtonLink>}
          </>
        }
      />
      <div className="flex flex-col gap-2">
        <EmployeesToolbar state={state} total={total} facets={facets} gapsOnly={gapsOnly} />
        {rows.length > 0 ? (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Employee</Th>
                  <Th width={110}>Department</Th>
                  <Th width={110}>Employment</Th>
                  <Th width={120}>M365</Th>
                  <Th width={60} align="right">Items</Th>
                  <Th width={100}>Loadout</Th>
                  <Th width={110}>Joined</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/employees/${row.id}`} className="flex items-center gap-2.5 hover:underline">
                        <Avatar name={row.name} size="sm" />
                        <span className="flex flex-col leading-tight">
                          <span className="text-[12.5px] font-medium text-fg">{row.name}</span>
                          <span className="font-mono text-[10px] text-fg-faint">
                            {row.employeeNo} · {row.title}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td>{row.department}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot value={row.employment} ns="employment" />
                        <span className="font-mono text-[10.5px]">{row.employment}</span>
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot value={row.m365 ?? ""} />
                        <span className="font-mono text-[10.5px] text-fg-muted">{row.m365 ?? "no sync yet"}</span>
                      </span>
                    </Td>
                    <Td mono align="right">{row.items}</Td>
                    <Td>
                      {row.missingRequired === null ? (
                        <span className="text-fg-faint">—</span>
                      ) : row.missingRequired === 0 ? (
                        <span className="font-mono text-[10.5px]" style={{ color: "var(--st-settled-dot)" }}>complete</span>
                      ) : (
                        <span className="font-mono text-[10.5px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                          {row.missingRequired} missing
                        </span>
                      )}
                    </Td>
                    <Td mono>{row.joined}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {state.page} of {pageCount}</span>
              <Pagination page={state.page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
            </div>
          </>
        ) : hasFilters ? (
          <EmptyState
            title="Your filters matched nothing"
            actions={<ButtonLink href={href(clearFilters(state), false)}>Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="No employees yet"
            description="Employees arrive via import or the seed — there is no create form by design."
            actions={canMutate ? <ButtonLink href="/employees/import">Import</ButtonLink> : undefined}
          />
        )}
      </div>
    </>
  );
}
