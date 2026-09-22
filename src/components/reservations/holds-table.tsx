"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr, rowOpenProps } from "@/components/ui/table";
import { HoldPill } from "@/components/ui/hold-pill";
import { ReleaseHoldButton } from "@/components/inventory/release-hold-button";
import type { ListState } from "@/lib/url-state";
import type { ReservationRow } from "@/server/modules/reservations/queries";

/**
 * Phase 26 (spec §5.4): the reservations table as a Client Component — the
 * `EmployeesTable` pattern (sortable headers driven by precomputed URLs, a
 * whole-row click with Enter support). A row opens the ASSET record (spec
 * §5.4: "a hold never changes an asset's status" is the whole point of this
 * list, so the row's destination is the asset, not the person).
 */
export function HoldsTable({
  rows, state, sortHrefs, today, canRelease,
}: {
  rows: ReservationRow[]; state: ListState; sortHrefs: Record<string, string>; today: string; canRelease: boolean;
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

  function open(assetId: string) {
    router.push(`/inventory/${assetId}`);
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th width={19} aria-label="Hold state colour" />
          <Th width={104}>State</Th>
          <Th width={112} {...sortProps("tag")}>Asset</Th>
          <Th>Model</Th>
          <Th width={96}>Reads</Th>
          <Th width={186} {...sortProps("employee")}>For</Th>
          <Th>Reason</Th>
          <Th width={104} {...sortProps("expiresAt")}>Expires</Th>
          <Th width={110} {...sortProps("createdAt")}>Created</Th>
          <Th width={160}>Closed</Th>
          {canRelease && <Th width={90} aria-label="Actions" />}
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr
            key={r.id}
            className="cursor-pointer"
            {...rowOpenProps(() => open(r.assetId))}
          >
            <Td className="pr-0"><StatusDot value={r.state} /></Td>
            <Td mono className="text-[10.5px]">{r.state}</Td>
            <Td mono>
              <Link href={`/inventory/${r.assetId}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                {r.tag}
              </Link>
            </Td>
            <Td>{r.model}</Td>
            {/* the point of the column: the hold did not move the status */}
            <Td mono className="text-[10.5px]">{r.assetStatus}</Td>
            <Td>
              <Link href={`/employees/${r.employeeId}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                {r.employeeName}
              </Link>
              <span className="pl-1.5 font-mono text-[10.5px] text-fg-muted">{r.employeeNo}</span>
            </Td>
            <Td>{r.reason ?? "—"}</Td>
            <Td mono>
              {r.state === "ACTIVE" && r.expiresAt ? <HoldPill expiresAt={r.expiresAt} today={today} withDate /> : r.expires}
            </Td>
            <Td mono>{r.created}</Td>
            <Td>
              {r.closedBy === null ? (
                <span className="text-fg-faint">—</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-muted">
                  <Icon name={r.closedBy === "clock" ? "sla" : "employee"} size={13} />
                  {r.closedBy === "clock" ? "expired" : "released"} {r.resolved}
                </span>
              )}
            </Td>
            {canRelease && (
              <Td>{r.state === "ACTIVE" ? <ReleaseHoldButton reservationId={r.id} tag={r.tag} size="sm" /> : null}</Td>
            )}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
