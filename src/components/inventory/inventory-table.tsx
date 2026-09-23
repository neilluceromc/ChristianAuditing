"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AssetClass, Role } from "@prisma/client";
import { Table, TBody, Td, Th, THead, Tr, rowOpenProps } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { Checkbox } from "@/components/ui/checkbox";
import { Button, IconButton } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { HoldPill } from "@/components/ui/hold-pill";
import { cn } from "@/lib/cn";
import { BULK_MAX } from "@/lib/inventory-list";
import { actionLabel, recordActions, type RecordAction, type RecordState } from "@/lib/record-actions";
import type { ListState } from "@/lib/url-state";
import type { AssetRow } from "@/server/modules/inventory/queries";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { AssignDialog, ReturnDialog } from "./holder-control";
import { ChangeStatusDialog } from "./status-control";
import { BulkDrawer, type BulkMode } from "./bulk-drawer";
import { useListNavigation } from "./list-navigation";

export interface ColumnDef {
  id: string;
  label: string;
  width?: number;
  sortKey?: string; // present ⇒ sortable
}

/**
 * README `1f`: ☐ · tag(104) · model(flex) · category(84) · assigned(168) · status · purchased(104) · warranty(72) · ⋯.
 * Phase 30 (spec §6.3): the status dot sits beside the status word, so the separate dot column is gone.
 */
export const INVENTORY_COLUMNS: ColumnDef[] = [
  { id: "tag", label: "Tag", width: 104, sortKey: "tag" },
  { id: "model", label: "Model", sortKey: "model" },
  { id: "category", label: "Category", width: 84, sortKey: "category" },
  { id: "assigned", label: "Assigned", width: 168 },
  { id: "status", label: "Status", width: 128, sortKey: "status" },
  // repairs saved view only (README 7b)
  { id: "stage", label: "Stage", width: 108 },
  { id: "down", label: "Down", width: 68, sortKey: "defectiveSince" },
  { id: "purchased", label: "Purchased", width: 104, sortKey: "purchasedAt" },
  { id: "warranty", label: "Warranty", width: 72, sortKey: "warrantyUntil" },
];

/** Columns that only exist in repair mode — never offered to the column chooser. */
export const REPAIR_ONLY_COLUMNS = ["stage", "down"] as const;

/** Columns the chooser may hide (Task 10). tag/model/status always render. */
export const HIDEABLE_COLUMNS = COLUMN_PREF_KEYS["columns:inventory"];

/** Phase 30 (spec §6.3, plan P-11): what the row menu may offer, in this order, before Open record. */
const ROW_MENU_ACTIONS: readonly RecordAction[] = ["return", "assign", "change-status", "print-label"];

/** A list row read as the record rule's state. The rule only asks whether a date is set, so a sentinel stands in. */
function rowState(row: AssetRow): RecordState {
  const set = new Date(0);
  return {
    cls: row.cls,
    status: row.statusValue,
    hasHolder: !!row.assigneeId,
    returnedAt: row.returned ? set : null,
    itVerifiedAt: row.awaitingItCheck ? null : set,
    financeConfirmedAt: row.financeConfirmed ? set : null,
    financeReturnedAt: row.financeReturned ? set : null,
    pending: !!row.pendingRef,
    held: !!row.hold,
  };
}

/** The row menu's actions for this row — the record's own rule, narrowed to what a list row offers. */
function rowMenuActions(row: AssetRow, role: Role): RecordAction[] {
  const plan = recordActions(rowState(row), role);
  return ROW_MENU_ACTIONS.filter((a) => a === plan.primary || plan.more.includes(a));
}

export function InventoryTable({
  rows,
  state,
  visible,
  canMutate,
  filtersQS,
  total,
  cls,
  role,
  direct,
  employees,
  recentEmployees,
  repairMode = false,
  sortHrefs,
  today,
}: {
  rows: AssetRow[];
  state: ListState;
  visible: string[]; // hideable-column ids currently shown
  canMutate: boolean;
  filtersQS: string; // serialized current list state, no leading "?"
  total: number;
  cls: AssetClass;
  /** the viewer's role — the row menu asks `recordActions` what each row offers */
  role: Role;
  direct: boolean;
  /** ACTIVE employees for the drawer's assign mode and the row menu's Assign; empty when the caller can't mutate. */
  employees: ComboOption[];
  recentEmployees?: string[];
  /** the repairs saved view: adds Stage + Down (README 7b) */
  repairMode?: boolean;
  /** Phase 26: the Manila day for the HOLD cell's expiry text. */
  today: string;
  /**
   * One `/inventory` URL per sortable key, keyed by that key — the result of
   * clicking that column header, already computed by the page. This is a
   * Client Component (`router.push` below), so it cannot receive the page's
   * `href` builder as a function prop — React Server Components only let a
   * Server Component pass plain, serializable data across that boundary.
   * Precomputing the map keeps this component from ever calling
   * `serializeListState` itself, which is what silently dropped
   * `?purchaseYear=` here before: this component never imports
   * `serializeListState`, `INVENTORY_LIST_CONFIG` or `withPurchaseYearQS` at
   * all, so it cannot reconstruct a URL that forgets the year.
   */
  sortHrefs: Record<string, string>;
}) {
  const router = useRouter();
  // Phase 30 (spec §6.5): a sort runs in the list's shared transition, so the region dims while it loads.
  const { navigate } = useListNavigation();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  // null = the drawer is closed; otherwise the mode the selection bar opened it in (plan P-14)
  const [drawerMode, setDrawerMode] = useState<BulkMode | null>(null);
  // The row menu's open dialog: which action, on which row.
  const [dialog, setDialog] = useState<{ kind: RecordAction; row: AssetRow } | null>(null);

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));

  function toggleAllOnPage() {
    setAllMatching(false);
    setSelected(allOnPage ? new Set() : new Set(pageIds));
  }
  function toggleRow(id: string) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  const columns = INVENTORY_COLUMNS.filter((c) => {
    if ((REPAIR_ONLY_COLUMNS as readonly string[]).includes(c.id)) return repairMode;
    return !(HIDEABLE_COLUMNS as readonly string[]).includes(c.id) || visible.includes(c.id);
  });

  function onSort(sortKey: string) {
    navigate(sortHrefs[sortKey]);
  }

  function sortProps(col: ColumnDef) {
    if (!col.sortKey) return {};
    const idx = state.sort.findIndex((s) => s.key === col.sortKey);
    return {
      onSort: () => onSort(col.sortKey!),
      sort: idx >= 0 ? state.sort[idx].dir : undefined,
      sortIndex: idx >= 0 && state.sort.length > 1 ? idx + 1 : undefined,
    };
  }

  function runRowAction(action: RecordAction, row: AssetRow) {
    if (action === "print-label") { router.push(`/inventory/labels?ids=${row.id}`); return; }
    setDialog({ kind: action, row });
  }

  const selectedIds = [...selected];
  // Page order, so the drawer names the tags the way the operator sees them.
  const selectedTags = rows.filter((r) => selected.has(r.id)).map((r) => r.tag);
  const exportHref = allMatching
    ? `/inventory/export${filtersQS ? `?${filtersQS}` : ""}`
    : `/inventory/export?ids=${selectedIds.join(",")}`;
  // Bulk assign exists only where direct IT assignment does — the drawer's own assign-mode gate.
  const canAssign = direct && cls === "IT";
  const closeDialog = () => setDialog(null);
  const active = dialog?.row ?? null;

  return (
    <div className="flex flex-col gap-2">
      {canMutate && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-accent-soft-border bg-accent-tint px-3 py-2 text-xs text-fg-secondary">
          <span className="font-mono text-[11px]">
            {allMatching ? `all ${total} matching selected` : `${selected.size} selected on this page`}
          </span>
          {/* Never offer a selection the server will refuse: the bulk cap is BULK_MAX. */}
          {!allMatching && total > rows.length && total <= BULK_MAX && (
            <button type="button" className="text-accent hover:underline" onClick={() => setAllMatching(true)}>
              Select all {total} matching
            </button>
          )}
          {!allMatching && total > BULK_MAX && (
            <span className="font-mono text-[10px] text-fg-faint">
              select-all capped at {BULK_MAX} — narrow the filter
            </span>
          )}
          {/* Labels need an explicit id list: "all matching" would make one click a many-sheet print
              job, so Print labels is absent then — and this says why. */}
          {allMatching && <span className="font-mono text-[10px] text-fg-faint">Labels need an explicit selection.</span>}
          {/* Phase 30 (spec §6.4): the bar acts directly; Change status… and Assign… open the drawer in that mode. */}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            {!allMatching && (
              <ButtonLink size="sm" href={`/inventory/labels?ids=${selectedIds.join(",")}`}>Print labels</ButtonLink>
            )}
            {/* a route handler that streams a file: a plain navigation, never prefetched */}
            <ButtonLink size="sm" native href={exportHref}>Export</ButtonLink>
            <Button size="sm" variant={canAssign ? "secondary" : "primary"} onClick={() => setDrawerMode("status")}>
              Change status…
            </Button>
            {canAssign && (
              <Button size="sm" variant="primary" onClick={() => setDrawerMode("assign")}>Assign…</Button>
            )}
          </span>
        </div>
      )}
      <Table>
      <THead>
        <Tr>
          {canMutate && (
            <Th width={30}>
              <Checkbox
                aria-label="Select all on this page"
                checked={allOnPage}
                indeterminate={!allOnPage && someOnPage}
                onChange={toggleAllOnPage}
              />
            </Th>
          )}
          {columns.map((col) => (
            <Th key={col.id} width={col.width} {...sortProps(col)}>
              {col.label}
            </Th>
          ))}
          {canMutate && <Th width={40} aria-label="Row actions" />}
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => {
          const menuActions = canMutate ? rowMenuActions(row, role) : [];
          const menuItems: MenuItem[] = [
            ...menuActions.map((a) => ({
              label: actionLabel(a, { cls: row.cls, direct, inMenu: true }),
              onSelect: () => runRowAction(a, row),
            })),
            { label: "Open record", onSelect: () => router.push(`/inventory/${row.id}`) },
          ];
          return (
            <Tr
              key={row.id}
              className="cursor-pointer"
              selected={selected.has(row.id)}
              {...rowOpenProps(() => router.push(`/inventory/${row.id}`))}
            >
              {canMutate && (
                // The whole cell is the checkbox's target (Fitts): a click on the input toggles through
                // its own onChange, a click on the cell around it toggles here; neither opens the row.
                <Td
                  className="cursor-default pr-0"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (e.target === e.currentTarget) toggleRow(row.id);
                  }}
                >
                  <Checkbox
                    aria-label={`Select ${row.tag}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                  />
                </Td>
              )}
              {columns.map((col) => {
                switch (col.id) {
                  case "tag":
                    return (
                      <Td key={col.id} mono>
                        <Link
                          href={`/inventory/${row.id}`}
                          className="text-accent hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.tag}
                        </Link>
                      </Td>
                    );
                  case "model":
                    return <Td key={col.id}>{row.model}</Td>;
                  case "category":
                    return <Td key={col.id}>{row.category}</Td>;
                  case "assigned":
                    return (
                      <Td key={col.id}>
                        {row.assigneeId !== null && row.assignee !== null ? (
                          // spec §6.3: the holder is a link to their profile, with the employee number
                          <Link
                            href={`/employees/${row.assigneeId}`}
                            className="text-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.assignee}
                            {row.assigneeNo && <span className="font-mono text-[11px] text-fg-muted"> · {row.assigneeNo}</span>}
                          </Link>
                        ) : row.hold ? (
                          // README 5c: a hold never changes the status — the asset
                          // still reads SPARE, and the marker says who wants it.
                          <span className="inline-flex items-center gap-1.5">
                            <Pill tone="accent">HOLD</Pill>
                            <span className="text-[11px] text-fg-muted">
                              for{" "}
                              <Link
                                href={`/employees/${row.hold.id}`}
                                className="text-accent hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {row.hold.name}
                              </Link>
                            </span>
                            {row.hold.expiresAt && <HoldPill expiresAt={row.hold.expiresAt} today={today} />}
                          </span>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </Td>
                    );
                  case "status":
                    return (
                      <Td key={col.id} mono className="py-1 text-[10.5px]">
                        {/* spec §6.3: the dot beside the word, and the row's one attention reason under it */}
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot value={row.status} />
                          {row.status}
                        </span>
                        {row.attention && (
                          <span
                            className={cn(
                              "block font-sans text-[10.5px] leading-tight",
                              row.attention.kind === "overdue" ? "text-[var(--st-attention-text)]" : "text-fg-muted",
                            )}
                          >
                            {row.attention.label}
                          </span>
                        )}
                      </Td>
                    );
                  case "stage":
                    return <Td key={col.id} mono className="text-[10.5px]">{row.stageLabel ?? "—"}</Td>;
                  case "down":
                    return (
                      <Td key={col.id} mono>
                        {row.down === null ? <span className="text-fg-faint">—</span> : `${row.down} d`}
                      </Td>
                    );
                  case "purchased":
                    return <Td key={col.id} mono>{row.purchased}</Td>;
                  case "warranty":
                    return <Td key={col.id} mono>{row.warranty}</Td>;
                  default:
                    return <Td key={col.id} />;
                }
              })}
              {canMutate && (
                // Not part of the row click: the menu, and everything it opens, stays out of the row's handler.
                <Td className="cursor-default px-1 text-right" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                  {/* plan P-11: a menu whose only item is Open record would just repeat the row click */}
                  {menuActions.length > 0 && (
                    <Menu
                      align="end"
                      items={menuItems}
                      trigger={(p) => <IconButton {...p} aria-label={`Actions for ${row.tag}`}>⋯</IconButton>}
                    />
                  )}
                </Td>
              )}
            </Tr>
          );
        })}
      </TBody>
      </Table>
      {/* The row menu's dialogs (plan P-3's shared ones) render outside the table, so no click inside
          one can bubble to a row. Mounted only while open, keyed by the row, so each opens fresh. */}
      {dialog && active && dialog.kind === "assign" && (
        <AssignDialog
          key={active.id}
          open
          onClose={closeDialog}
          asset={active}
          direct={direct}
          employees={employees}
          recentEmployees={recentEmployees}
          heldFor={active.hold ? { id: active.hold.id, name: active.hold.name } : undefined}
        />
      )}
      {dialog && active && dialog.kind === "return" && active.assigneeId !== null && (
        <ReturnDialog
          key={active.id}
          open
          onClose={closeDialog}
          asset={active}
          holder={{ id: active.assigneeId, name: active.assignee ?? "" }}
          direct={direct}
        />
      )}
      {dialog && active && dialog.kind === "change-status" && (
        <ChangeStatusDialog
          key={active.id}
          open
          onClose={closeDialog}
          asset={{
            id: active.id, tag: active.tag, model: active.model,
            cls: active.cls, status: active.statusValue, hasHolder: !!active.assigneeId,
          }}
          direct={direct}
        />
      )}
      {canMutate && (
        <BulkDrawer
          open={drawerMode !== null}
          initialMode={drawerMode ?? "status"}
          onClose={() => setDrawerMode(null)}
          selectedIds={selectedIds}
          selectedTags={selectedTags}
          allMatching={allMatching}
          filtersQS={filtersQS}
          total={total}
          cls={cls}
          direct={direct}
          employees={employees}
          recentEmployees={recentEmployees}
          onDone={clearSelection}
        />
      )}
    </div>
  );
}
