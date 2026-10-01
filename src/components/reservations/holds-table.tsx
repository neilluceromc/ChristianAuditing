"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr, rowOpenProps } from "@/components/ui/table";
import { HoldPill } from "@/components/ui/hold-pill";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ReleaseHoldDialog } from "@/components/inventory/release-hold-button";
import { AssignDialog } from "@/components/inventory/holder-control";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { useListNavigation } from "@/components/patterns/list-navigation";
import type { ReservationTab } from "@/lib/holds";
import type { ListState } from "@/lib/url-state";
import type { ReservationRow } from "@/server/modules/reservations/queries";

/** The Closed tab's two endings in friendly words (spec §9). */
const CLOSED_STATE_LABEL: Record<string, string> = { RELEASED: "Released", EXPIRED: "Expired" };

/**
 * Phase 26 (spec §5.4): the reservations table as a Client Component — the
 * `EmployeesTable` pattern (sortable headers driven by precomputed URLs, a
 * whole-row click with Enter support). A row opens the ASSET record (spec
 * §5.4: "a hold never changes an asset's status" is the whole point of this
 * list, so the row's destination is the asset, not the person).
 *
 * Phase 32 (spec §7): each row's menu hands the spare to the person it was
 * held for (Assign, preselected) or releases it; viewers get Open items only.
 *
 * Phase 33 (spec §5.2): each tab shows the columns that tell its rows apart —
 * Active the expiry, Fulfilled the day it was handed over, Closed which ending
 * and when. (The asset's own status lives in the hint under the tabs: a held
 * spare still reads SPARE.)
 */
export function HoldsTable({
  tab, rows, state, sortHrefs, today, canAct, direct, employees,
}: {
  tab: ReservationTab; rows: ReservationRow[]; state: ListState; sortHrefs: Record<string, string>; today: string;
  canAct: boolean; direct: boolean; employees: ComboOption[];
}) {
  const router = useRouter();
  // A header sort is a list navigation: it runs in the shared transition so the table reads busy.
  const { navigate } = useListNavigation();
  // The row menu's open dialog: which action, on which hold.
  const [dialog, setDialog] = useState<{ kind: "assign" | "release"; row: ReservationRow } | null>(null);

  function sortProps(key: string) {
    const idx = state.sort.findIndex((s) => s.key === key);
    return {
      onSort: () => navigate(sortHrefs[key]),
      sort: idx >= 0 ? state.sort[idx].dir : undefined,
      sortIndex: idx >= 0 && state.sort.length > 1 ? idx + 1 : undefined,
    };
  }

  function open(assetId: string) {
    router.push(`/inventory/${assetId}`);
  }

  function menuItems(r: ReservationRow): MenuItem[] {
    const items: MenuItem[] = [];
    if (canAct && r.state === "ACTIVE") {
      items.push({ label: `Assign to ${r.employeeName}…`, onSelect: () => setDialog({ kind: "assign", row: r }) });
      items.push({ label: "Release…", onSelect: () => setDialog({ kind: "release", row: r }) });
    }
    items.push({ label: "Open record", onSelect: () => router.push(`/inventory/${r.assetId}`) });
    items.push({ label: `Open ${r.employeeName}'s profile`, onSelect: () => router.push(`/employees/${r.employeeId}`) });
    return items;
  }

  return (
    <>
    <Table>
      <THead>
        <Tr>
          <Th width={112} {...sortProps("tag")}>Asset</Th>
          <Th>Model</Th>
          <Th width={186} {...sortProps("employee")}>For</Th>
          <Th>Reason</Th>
          {tab === "ACTIVE" && <Th width={150} {...sortProps("expiresAt")}>Expires</Th>}
          {tab === "FULFILLED" && <Th width={120}>Fulfilled on</Th>}
          {tab === "CLOSED" && <Th width={112}>State</Th>}
          {tab === "CLOSED" && <Th width={160}>Closed</Th>}
          <Th width={44} aria-label="Row actions" />
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr
            key={r.id}
            className="cursor-pointer"
            {...rowOpenProps(() => open(r.assetId))}
          >
            <Td mono>
              <Link href={`/inventory/${r.assetId}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                {r.tag}
              </Link>
            </Td>
            <Td>{r.model}</Td>
            <Td>
              <Link href={`/employees/${r.employeeId}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                {r.employeeName}
              </Link>
              <span className="pl-1.5 font-mono text-[10.5px] text-fg-muted">{r.employeeNo}</span>
            </Td>
            <Td>{r.reason ?? "—"}</Td>
            {tab === "ACTIVE" && (
              <Td mono>
                {r.state === "ACTIVE" && r.expiresAt ? <HoldPill expiresAt={r.expiresAt} today={today} withDate /> : r.expires}
              </Td>
            )}
            {tab === "FULFILLED" && <Td mono>{r.resolved}</Td>}
            {tab === "CLOSED" && (
              <Td>
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot value={r.state} />
                  {CLOSED_STATE_LABEL[r.state] ?? r.state}
                </span>
              </Td>
            )}
            {tab === "CLOSED" && (
              <Td>
                {/* the clock or a person, and when — the State column says which ending, this says how and when */}
                {r.closedBy === null ? (
                  <span className="text-fg-faint">—</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-muted">
                    <Icon name={r.closedBy === "clock" ? "sla" : "employee"} size={13} />
                    {r.closedBy === "clock" ? "expired" : "released"} {r.resolved}
                  </span>
                )}
              </Td>
            )}
            {/* Not part of the row click: the menu, and everything it opens, stays out of the row's handler. */}
            <Td className="cursor-default px-1 text-right" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <Menu
                align="end"
                items={menuItems(r)}
                trigger={(p) => <IconButton {...p} aria-label={`Actions for ${r.tag}`}>⋯</IconButton>}
              />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
    {/* Dialogs render outside the table, so no click inside one bubbles to a row; mounted only while open. */}
    {dialog?.kind === "assign" && (
      <AssignDialog
        key={dialog.row.id}
        open
        onClose={() => setDialog(null)}
        asset={{ id: dialog.row.assetId, tag: dialog.row.tag, model: dialog.row.model }}
        direct={direct}
        employees={employees}
        heldFor={{ id: dialog.row.employeeId, name: dialog.row.employeeName }}
      />
    )}
    {dialog?.kind === "release" && (
      <ReleaseHoldDialog
        key={dialog.row.id}
        open
        onClose={() => setDialog(null)}
        reservationId={dialog.row.id}
        tag={dialog.row.tag}
        model={dialog.row.model}
        holderName={dialog.row.employeeName}
      />
    )}
    </>
  );
}
