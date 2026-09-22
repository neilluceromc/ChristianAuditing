"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr, rowOpenProps } from "@/components/ui/table";
import type { ListState } from "@/lib/url-state";
import type { EmployeeListRow } from "@/server/modules/employees/queries";

/**
 * Phase 25 (spec §5.2): the employees table as a Client Component — sortable
 * headers driven by precomputed URLs (the inventory-table.tsx pattern) and a
 * whole-row click with Enter support. The name link stays for middle-click and
 * screen readers; `employeeNo` remains a URL-only sort key (it shares the
 * Employee column). Focus styling comes from the global :focus-visible rule.
 */
export function EmployeesTable({
  rows, state, sortHrefs,
}: {
  rows: EmployeeListRow[]; state: ListState; sortHrefs: Record<string, string>;
}) {
  const router = useRouter();

  function sortProps(key: string) {
    const idx = state.sort.findIndex((s) => s.key === key);
    return {
      onSort: () => router.push(sortHrefs[key]),
      sort: idx >= 0 ? state.sort[idx].dir : undefined,
      sortIndex: idx >= 0 && state.sort.length > 1 ? idx + 1 : undefined,
    };
  }

  function open(id: string) {
    router.push(`/employees/${id}`);
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th {...sortProps("name")}>Employee</Th>
          <Th width={110}>Department</Th>
          <Th width={110}>Employment</Th>
          <Th width={120}>M365</Th>
          <Th width={60} align="right">Items</Th>
          <Th width={100}>Loadout</Th>
          <Th width={110} {...sortProps("joinedAt")}>Joined</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr
            key={row.id}
            className="cursor-pointer"
            {...rowOpenProps(() => open(row.id))}
          >
            <Td>
              <Link
                href={`/employees/${row.id}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2.5 hover:underline"
              >
                <Avatar name={row.name} size="sm" />
                <span className="flex flex-col leading-tight">
                  <span className="text-[12.5px] font-medium text-fg">{row.name}</span>
                  <span className="font-mono text-[10px] text-fg-faint">{row.employeeNo} · {row.title}</span>
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
  );
}
