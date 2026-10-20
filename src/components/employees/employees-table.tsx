"use client";

/*
 * Phase 45 (spec §3.3, §3.4, §4): the Employees list table — Checkbox, Employee, Works for, Loadout, Items,
 * Employment, Joined, › at the shared list scale (`LIST`), zebra rows (`striped`), a head that sticks under the
 * list's toolbar (`stickyHeader`), row and head heights from `--list-row-h` / `--list-head-h`, and the floating
 * bulk bar.
 *
 * Dense (spec §4.5) is the Inventory table's approach: every visual change is a `dense:` class (`LIST.td` / `th`
 * / `thSort` / `check` carry the Dense padding and 13 px text; Employee and Works for collapse to one line with
 * their own `dense:` classes). Nothing here is Dense-only but invisible, so this table never reads `useDensity()`.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Table, TBody, Td, Th, THead, Tr, rowOpenProps } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { cn } from "@/lib/cn";
import { pushGuarded } from "@/lib/stuck-nav";
import { EMPLOYMENT_LABEL } from "@/lib/labels";
import type { ListState } from "@/lib/url-state";
import type { EmployeeListRow } from "@/server/modules/employees/queries";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { FloatingBulkBar } from "@/components/patterns/floating-bulk-bar";
import { LIST } from "@/components/patterns/list-styles";
import { useFitsCard } from "@/components/patterns/use-fits-card";
import type { PickerGroup } from "@/lib/groups";
import { BulkTransferDialog } from "./bulk-transfer-dialog";

/**
 * The fixed columns' widths (padding included). The table lays out fixed (`table-fixed`): Employee has no width
 * and takes the rest, truncating, down to EMPLOYEE_MIN; below the resulting minimum the card scrolls sideways.
 * With the checkbox column that is 772 + 180 = 952 px, inside main's content width at 1280 px (about 970 px).
 */
const W = { worksFor: 220, loadout: 128, items: 80, employment: 136, joined: 128, open: 44 } as const;
const EMPLOYEE_MIN = 180;
const CHECK_W = 36;

const stop = (e: React.MouseEvent) => e.stopPropagation();

const employmentLabel = (v: string) =>
  Object.hasOwn(EMPLOYMENT_LABEL, v) ? EMPLOYMENT_LABEL[v as keyof typeof EMPLOYMENT_LABEL] : v;

/** Offboarded people (shown through the leavers link) are never selectable for a bulk action. */
const selectable = (row: EmployeeListRow) => row.employment !== "OFFBOARDED";

/**
 * Employee (spec §3.3): the name (13.5 px medium) over the job title (12 px muted); no avatar, and the EMP number
 * only for screen readers (it names the row the way IT says it, and search still matches it). Dense: one line —
 * the name, then the title muted, the title truncating first.
 */
function EmployeeCell({ row }: { row: EmployeeListRow }) {
  return (
    <Link
      href={`/employees/${row.id}`}
      onClick={stop}
      className="group/name flex min-w-0 max-w-full flex-col dense:flex-row dense:items-baseline dense:gap-2"
      title={row.title ? `${row.name} · ${row.title}` : row.name}
    >
      <span className="min-w-0 truncate font-medium text-fg group-hover/name:underline dense:max-w-[70%] dense:shrink-0">
        {row.name}
        <span className="sr-only"> · {row.employeeNo}</span>
      </span>
      {row.title && (
        <span className={cn(LIST.sub, "mt-0.5 min-w-0 truncate dense:mt-0")}>
          <span className="sr-only"> · </span>
          {row.title}
        </span>
      )}
    </Link>
  );
}

/**
 * Works for (spec §3.3): the client or department name over "Client account" / "Internal department" (12 px
 * muted). Dense: the name only; the kind stays in the tooltip.
 */
function WorksForCell({ row }: { row: EmployeeListRow }) {
  const kind = row.departmentKind === "CLIENT" ? "Client account" : "Internal department";
  return (
    <span className="flex min-w-0 flex-col" title={`${row.department} · ${kind}`}>
      <span className="min-w-0 truncate">{row.department}</span>
      <span className={cn(LIST.sub, "mt-0.5 truncate dense:hidden")}>
        <span className="sr-only"> · </span>
        {kind}
      </span>
    </span>
  );
}

/** Loadout (spec §3.3): "complete" (settled), "N missing" (attention, medium) or "no policy" (faint), 13 px. */
function LoadoutCell({ missing }: { missing: number | null }) {
  if (missing === null) return <span className="text-fg-faint">no policy</span>;
  if (missing === 0) return <span className="text-(--st-settled-text)">complete</span>;
  return <span className="font-medium text-(--st-attention-text)">{missing} missing</span>;
}

export function EmployeesTable({
  rows,
  state,
  sortHrefs,
  canMutate,
  departments = [],
}: {
  rows: EmployeeListRow[];
  state: ListState;
  /** One `/employees` URL per sortable key — the result of clicking that header, computed by the page. */
  sortHrefs: Record<string, string>;
  /** admin and it_staff: the checkbox column and the bulk bar exist only for them (spec §3.4). */
  canMutate: boolean;
  /** Departments and clients for Transfer… (spec §3.4); the page loads them only for `canMutate`. */
  departments?: PickerGroup[];
}) {
  const router = useRouter();
  // Phase 30 (spec §6.5): a sort runs in the list's shared transition, so the region dims while it loads.
  const { navigate } = useListNavigation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);

  // Select-all-on-page covers the rows that can be selected; an Offboarded row never can.
  const pageIds = rows.filter(selectable).map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));

  function toggleAllOnPage() {
    setSelected(allOnPage ? new Set() : new Set(pageIds));
  }
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tableMin =
    EMPLOYEE_MIN + W.worksFor + W.loadout + W.items + W.employment + W.joined + W.open + (canMutate ? CHECK_W : 0);
  const boxRef = useRef<HTMLDivElement>(null);
  const fitsCard = useFitsCard(boxRef, tableMin);

  function sortProps(key: string) {
    const idx = state.sort.findIndex((s) => s.key === key);
    return {
      onSort: () => navigate(sortHrefs[key]),
      sort: idx >= 0 ? state.sort[idx].dir : undefined,
      sortIndex: idx >= 0 && state.sort.length > 1 ? idx + 1 : undefined,
    };
  }
  const head = (sortable: boolean, extra?: string) => cn(LIST.head, sortable ? LIST.thSort : LIST.th, "whitespace-nowrap", extra);

  // Page order, so the export and the forms list people the way the operator sees them.
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const ids = selectedIds.join(",");

  return (
    <div ref={boxRef} className="flex flex-col" style={{ "--employees-table-min": `${tableMin}px` } as React.CSSProperties}>
      <Table
        striped
        stickyHeader
        // too wide for the card: keep scrolling inside it from 1280 px too (the head then scrolls with the rows)
        className={cn("[&>table]:table-fixed [&>table]:min-w-(--employees-table-min)", !fitsCard && "xl:overflow-auto")}
      >
        <THead>
          <Tr style={{ height: "var(--list-head-h)" }}>
            {canMutate && (
              <Th className={LIST.check}>
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allOnPage}
                  indeterminate={!allOnPage && someOnPage}
                  disabled={pageIds.length === 0}
                  onChange={toggleAllOnPage}
                />
              </Th>
            )}
            <Th className={head(true)} {...sortProps("name")}>Employee</Th>
            <Th width={W.worksFor} className={head(false)}>Works for</Th>
            <Th width={W.loadout} className={head(true)} {...sortProps("loadout")}>Loadout</Th>
            <Th width={W.items} align="right" className={head(false)}>Items</Th>
            <Th width={W.employment} className={head(false)}>Employment</Th>
            <Th width={W.joined} className={head(true)} {...sortProps("joinedAt")}>Joined</Th>
            <Th width={W.open} className={head(false)} aria-label="Open" />
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => {
            const canSelect = selectable(row);
            return (
              <Tr
                key={row.id}
                className="cursor-pointer"
                style={{ height: "var(--list-row-h)" }}
                selected={selected.has(row.id)}
                {...rowOpenProps(() => pushGuarded(router, `/employees/${row.id}`))}
              >
                {canMutate && (
                  // The whole cell is the checkbox's target (Fitts): a click on the input toggles through its own
                  // onChange, a click on the cell around it toggles here; neither opens the row.
                  <Td
                    className={cn(LIST.check, "cursor-default")}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (canSelect && e.target === e.currentTarget) toggleRow(row.id);
                    }}
                  >
                    <Checkbox
                      aria-label={`Select ${row.name}`}
                      checked={canSelect && selected.has(row.id)}
                      disabled={!canSelect}
                      title={canSelect ? undefined : "Offboarded people can't be selected"}
                      className="disabled:cursor-not-allowed disabled:opacity-40"
                      onChange={() => toggleRow(row.id)}
                    />
                  </Td>
                )}
                <Td className={LIST.td}>
                  <EmployeeCell row={row} />
                </Td>
                <Td className={LIST.td}>
                  <WorksForCell row={row} />
                </Td>
                <Td className={cn(LIST.td, "text-[13px]")}>
                  <LoadoutCell missing={row.missingRequired} />
                </Td>
                <Td className={cn(LIST.td, "tabular-nums")} align="right">{row.items}</Td>
                <Td className={LIST.td}>
                  <span className="inline-flex max-w-full items-center gap-2 whitespace-nowrap text-[13px] font-medium">
                    <StatusDot value={row.employment} ns="employment" />
                    {employmentLabel(row.employment)}
                  </span>
                </Td>
                <Td className={cn(LIST.td, "whitespace-nowrap tabular-nums text-fg-secondary")}>{row.joined}</Td>
                <Td className={cn(LIST.td, "pl-1 text-fg-faint dense:pl-1")} aria-hidden>›</Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      {/* Phase 45 (spec §3.4): the same floating bar as Inventory, while rows are ticked. */}
      {canMutate && (
        <FloatingBulkBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" variant="primary" onClick={() => setTransferOpen(true)}>Transfer…</Button>
          {/* a route handler that streams a file: a plain navigation, never prefetched */}
          <ButtonLink size="sm" native href={`/employees/export?ids=${ids}`}>Export</ButtonLink>
          {/* one printable form per person: not worth prefetching on every tick */}
          <ButtonLink size="sm" prefetch={false} href={`/employees/forms?ids=${ids}`}>Print IT forms</ButtonLink>
        </FloatingBulkBar>
      )}
      {/* mounted only while open, so each opening starts with fresh fields */}
      {canMutate && transferOpen && (
        <BulkTransferDialog
          ids={selectedIds}
          departments={departments}
          onClose={() => setTransferOpen(false)}
          onDone={() => {
            setTransferOpen(false);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
