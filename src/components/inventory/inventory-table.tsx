"use client";

/*
 * Phase 45 (spec §2.3, §4): the Inventory list table — six default columns at the shared list scale (`LIST`),
 * zebra rows (`striped`), a head that sticks under the list's toolbar (`stickyHeader`), row and head heights
 * from `--list-row-h` / `--list-head-h`, and the floating bulk bar.
 *
 * Dense (spec §4.5) — the approach the Employees table reuses exactly:
 *  1. Every visual change is a `dense:` class (`@custom-variant dense` in globals.css, `[data-density="dense"] &`).
 *     `LIST.td` / `LIST.th` / `LIST.thSort` / `LIST.check` already carry the Dense padding and 13 px text; a
 *     two-line cell turns into one line with its own `dense:` classes (`flex-col dense:flex-row`, `dense:hidden`).
 *     The server renders `data-density` on <html> from the cookie, so the first paint is already right and a
 *     Row size change restyles without a render.
 *  2. Only what CSS cannot set — an attribute that must exist in Dense alone (here the row `title` and
 *     `aria-describedby` carrying the Status reason) — reads `useDensity()`. It never changes a pixel, so the
 *     server's "comfortable" snapshot during hydration costs nothing.
 */

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AssetClass, Role } from "@prisma/client";
import { Table, TBody, Td, Th, THead, Tr, rowOpenProps } from "@/components/ui/table";
import { pushGuarded } from "@/lib/stuck-nav";
import { StatusDot } from "@/components/ui/status";
import { Checkbox } from "@/components/ui/checkbox";
import { Button, IconButton } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { HoldPill } from "@/components/ui/hold-pill";
import { useDensity } from "@/components/ui/density-toggle";
import { cn } from "@/lib/cn";
import { BULK_MAX } from "@/lib/inventory-list";
import { withClsQS } from "@/lib/asset-class";
import { actionLabel, recordActions, type RecordAction, type RecordState } from "@/lib/record-actions";
import type { ListState } from "@/lib/url-state";
import type { AssetRow } from "@/server/modules/inventory/queries";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";
import { canEditAsset, statusLabel } from "@/lib/asset-class";
import { RegistrationCell } from "./registration-cell";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { AssignDialog, ReturnDialog } from "./holder-control";
import { ChangeStatusDialog } from "./status-control";
import { BulkDrawer, type BulkMode } from "./bulk-drawer";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { FloatingBulkBar } from "@/components/patterns/floating-bulk-bar";
import { LIST } from "@/components/patterns/list-styles";
import { useFitsCard } from "@/components/patterns/use-fits-card";

export interface ColumnDef {
  id: string;
  label: string;
  width?: number;
  sortKey?: string; // present ⇒ sortable
}

/**
 * Phase 45 (spec §2.3): ☐ · Tag · Serial number · Model · Category · Assigned · Status, then the optional columns
 * (Registration, Purchased, Warranty — off by default) and the repair view's Stage and Down, then ⋯.
 *
 * The table lays out fixed (`table-fixed`): every column but Model keeps exactly its width (padding included),
 * and Model takes the rest, truncating. A minimum table width (the shown columns plus MODEL_MIN) keeps Model
 * readable; when the card is narrower than that, the card scrolls sideways instead of squeezing Model away.
 * The default set is 794 px plus Model's 160 = 954 px, which fits main's content width at 1280 px with the
 * sidebar open (about 970 px). Each cell's content is sized (or truncates) to fit its width, since a fixed
 * column never grows.
 *
 * From 1280 px the card is normally `overflow-visible` (so the head can stick to the window), which would let a
 * wider table run past the card. So the card keeps scrolling sideways at every width whenever the table's
 * minimum does not fit it (`fitsCard`): measured after hydration, and assumed from the 1280 px width before
 * that, so a wide view (Repairs, Registration shown) never overflows the card, even on first paint.
 */
export const INVENTORY_COLUMNS: ColumnDef[] = [
  { id: "tag", label: "Tag", width: 116, sortKey: "tag" },
  { id: "serial", label: "Serial number", width: 140 },
  { id: "model", label: "Model", sortKey: "model" },
  { id: "category", label: "Category", width: 120, sortKey: "category" },
  { id: "assigned", label: "Assigned", width: 176 },
  { id: "status", label: "Status", width: 156, sortKey: "status" },
  // Phase 35 (spec §3.1): where Finance's registration review stands, and what to fix when it was sent back
  { id: "registration", label: "Registration", width: 232 },
  { id: "purchased", label: "Purchased", width: 120, sortKey: "purchasedAt" },
  { id: "warranty", label: "Warranty", width: 120, sortKey: "warrantyUntil" },
  // repairs saved view only (README 7b)
  { id: "stage", label: "Stage", width: 128 },
  { id: "down", label: "Down", width: 80, sortKey: "defectiveSince" },
];

/** Model's narrowest width, and the fixed checkbox and row-actions columns (`LIST.check`, the ⋯ header). */
const MODEL_MIN = 160;
const CHECK_W = 36;
const ACTIONS_W = 50;

/** Columns that only exist in repair mode — never offered to the column chooser. */
export const REPAIR_ONLY_COLUMNS = ["stage", "down"] as const;

/** Columns the chooser may hide (Task 10). tag/model/status always render. */
export const HIDEABLE_COLUMNS = COLUMN_PREF_KEYS["columns:inventory"];

/** Phase 30 (spec §6.3, plan P-11): what the row menu may offer, in this order, before Open record. */
const ROW_MENU_ACTIONS: readonly RecordAction[] = ["return", "assign", "change-status", "print-label"];

const stop = (e: React.MouseEvent) => e.stopPropagation();

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

/**
 * Assigned (spec §2.3): the holder's name (13.5 px medium) over the EMP number (12 px mono), no avatar; a hold is
 * the HOLD pill (and its expiry) over "for {name}"; nobody is "—". Dense: one line — the name, then the EMP number
 * muted; a hold is HOLD plus "for {name}".
 */
function AssignedCell({ row, today }: { row: AssetRow; today: string }) {
  if (row.assigneeId !== null && row.assignee !== null) {
    return (
      // The " · " separator is screen-reader only: the link's name and text stay "Name · EMP-…".
      <Link
        href={`/employees/${row.assigneeId}`}
        className="group/name flex min-w-0 max-w-full flex-col dense:flex-row dense:items-baseline dense:gap-2"
        title={row.assigneeNo ? `${row.assignee} · ${row.assigneeNo}` : row.assignee}
        onClick={stop}
      >
        <span className="min-w-0 truncate font-medium text-fg group-hover/name:underline">{row.assignee}</span>
        {row.assigneeNo && (
          <span className={cn(LIST.empNo, "mt-0.5 truncate leading-[1.25] text-fg-muted dense:mt-0 dense:shrink-0")}>
            <span className="sr-only"> · </span>
            {row.assigneeNo}
          </span>
        )}
      </Link>
    );
  }
  if (row.hold) {
    // README 5c: a hold never changes the status — the asset still reads SPARE, and the marker says who wants it.
    return (
      <span className="flex min-w-0 max-w-full flex-col items-start gap-1 dense:flex-row dense:items-center dense:gap-1.5">
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <Pill tone="accent">HOLD</Pill>
          {row.hold.expiresAt && (
            <span className="inline-flex dense:hidden">
              <HoldPill expiresAt={row.hold.expiresAt} today={today} />
            </span>
          )}
        </span>
        <span className={cn(LIST.sub, "max-w-full min-w-0 truncate")} title={`for ${row.hold.name}`}>
          for{" "}
          <Link href={`/employees/${row.hold.id}`} className="text-accent hover:underline" onClick={stop}>
            {row.hold.name}
          </Link>
        </span>
      </span>
    );
  }
  return <span className="text-fg-faint">—</span>;
}

/**
 * Status (spec §2.3): the dot and the sentence-case label (13 px medium), the attention reason on a 12 px line
 * under it — the cell's one `span.block`, which e2e reads. Dense: the reason leaves the cell (display: none; the
 * row's `title` and `aria-describedby` carry it) and a 6 px attention dot follows the label instead.
 */
function StatusCell({ row, reasonId }: { row: AssetRow; reasonId: string }) {
  return (
    <>
      <span className="inline-flex items-center gap-2 text-[13px] font-medium">
        <StatusDot value={row.status} />
        {statusLabel(row.status)}
        {row.attention && (
          <span
            aria-hidden
            className="hidden size-1.5 shrink-0 rounded-full dense:inline-block"
            style={{ background: "var(--st-attention-dot)" }}
          />
        )}
      </span>
      {/* the reason sits on its own line visually; a screen reader hears a pause, not "Deployedoverdue" */}
      {row.attention && <span className="sr-only dense:hidden"> · </span>}
      {row.attention && (
        <span
          id={reasonId}
          className={cn(
            "mt-0.5 block pl-[15px] text-[12px] leading-[1.25] dense:hidden",
            row.attention.kind === "overdue" ? "text-[var(--st-attention-text)]" : "text-fg-muted",
          )}
        >
          {row.attention.label}
        </span>
      )}
    </>
  );
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
  recentPeople,
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
  /** The user's recent holder picks for the drawer's assign mode and the row menu's Assign; empty when the caller can't mutate. */
  recentPeople: ComboOption[];
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
  // Dense only moves the Status reason into row attributes here; every visual change is a `dense:` class.
  const dense = useDensity() === "dense";
  const idBase = useId();
  const reasonId = (row: AssetRow) => `${idBase}-reason-${row.id}`;

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
  const tableMin = columns.reduce((sum, c) => sum + (c.width ?? MODEL_MIN), 0) + (canMutate ? CHECK_W + ACTIONS_W : 0);
  const boxRef = useRef<HTMLDivElement>(null);
  const fitsCard = useFitsCard(boxRef, tableMin);

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
    if (action === "print-label") { pushGuarded(router, "/inventory/labels" + withClsQS(`?ids=${row.id}`, row.cls)); return; }
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
    <div ref={boxRef} className="flex flex-col" style={{ "--inventory-table-min": `${tableMin}px` } as React.CSSProperties}>
      <Table
        striped
        stickyHeader
        // too wide for the card: keep scrolling inside it from 1280 px too (the head then scrolls with the rows)
        className={cn("[&>table]:table-fixed [&>table]:min-w-(--inventory-table-min)", !fitsCard && "xl:overflow-auto")}
      >
      <THead>
        <Tr style={{ height: "var(--list-head-h)" }}>
          {canMutate && (
            <Th className={LIST.check}>
              <Checkbox
                aria-label="Select all on this page"
                checked={allOnPage}
                indeterminate={!allOnPage && someOnPage}
                onChange={toggleAllOnPage}
              />
            </Th>
          )}
          {columns.map((col) => (
            <Th
              key={col.id}
              width={col.width}
              className={cn(LIST.head, col.sortKey ? LIST.thSort : LIST.th, "whitespace-nowrap")}
              {...sortProps(col)}
            >
              {col.label}
            </Th>
          ))}
          {canMutate && <Th className={cn(LIST.head, LIST.th, "w-[50px]")} aria-label="Row actions" />}
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
            { label: "Open record", onSelect: () => pushGuarded(router, `/inventory/${row.id}`) },
          ];
          // Dense: the Status reason leaves its cell; the row's tooltip and description carry it.
          const reason = dense && row.attention ? row.attention.label : undefined;
          return (
            <Tr
              key={row.id}
              className="cursor-pointer"
              style={{ height: "var(--list-row-h)" }}
              selected={selected.has(row.id)}
              title={reason}
              aria-describedby={reason ? reasonId(row) : undefined}
              {...rowOpenProps(() => pushGuarded(router, `/inventory/${row.id}`))}
            >
              {canMutate && (
                // The whole cell is the checkbox's target (Fitts): a click on the input toggles through
                // its own onChange, a click on the cell around it toggles here; neither opens the row.
                <Td
                  className={cn(LIST.check, "cursor-default")}
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
                      <Td key={col.id} className={cn(LIST.td, LIST.code)}>
                        <Link
                          href={`/inventory/${row.id}`}
                          className="block truncate text-accent hover:underline"
                          title={row.tag}
                          onClick={stop}
                        >
                          {row.tag}
                        </Link>
                      </Td>
                    );
                  case "serial":
                    return (
                      <Td key={col.id} className={cn(LIST.td, LIST.code, "text-fg-secondary")}>
                        {row.serial ? (
                          <span className="block truncate" title={row.serial}>{row.serial}</span>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </Td>
                    );
                  case "model":
                    // no width of its own: in the fixed layout it takes the table's slack, and truncates
                    return (
                      <Td key={col.id} className={LIST.td}>
                        <span className="block truncate font-medium" title={row.model}>{row.model}</span>
                      </Td>
                    );
                  case "category":
                    return (
                      <Td key={col.id} className={LIST.td}>
                        <span className="block truncate" title={row.category}>{row.category}</span>
                      </Td>
                    );
                  case "assigned":
                    return (
                      <Td key={col.id} className={LIST.td}>
                        <AssignedCell row={row} today={today} />
                      </Td>
                    );
                  case "status":
                    return (
                      <Td key={col.id} className={LIST.td}>
                        <StatusCell row={row} reasonId={reasonId(row)} />
                      </Td>
                    );
                  case "registration":
                    return (
                      <Td key={col.id} className={cn(LIST.td, "py-1.5")}>
                        <RegistrationCell
                          row={row}
                          canMutate={canMutate}
                          canEdit={canEditAsset(role, { cls: row.cls, itVerifiedAt: row.awaitingItCheck ? null : new Date(0) })}
                        />
                      </Td>
                    );
                  case "stage":
                    return (
                      <Td key={col.id} className={cn(LIST.td, "font-mono text-[11px] text-fg-secondary dense:text-[11px]")}>
                        {row.stageLabel ?? "—"}
                      </Td>
                    );
                  case "down":
                    return (
                      <Td key={col.id} className={cn(LIST.td, "tabular-nums text-fg-secondary")}>
                        {row.down === null ? <span className="text-fg-faint">—</span> : `${row.down} d`}
                      </Td>
                    );
                  case "purchased":
                    return <Td key={col.id} className={cn(LIST.td, "tabular-nums text-fg-secondary")}>{row.purchased}</Td>;
                  case "warranty":
                    return <Td key={col.id} className={cn(LIST.td, "tabular-nums text-fg-secondary")}>{row.warranty}</Td>;
                  default:
                    return <Td key={col.id} className={LIST.td} />;
                }
              })}
              {canMutate && (
                // Not part of the row click: the menu, and everything it opens, stays out of the row's handler.
                <Td
                  className={cn(LIST.td, "cursor-default pl-1 text-right last:pr-3 dense:pl-1 dense:last:pr-3")}
                  onClick={stop}
                >
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
      {/* Phase 45 (spec §2.4): the bulk bar floats at the bottom centre while rows are ticked — every action and
          rule as before. Phase 30 (spec §6.4): it acts directly; Change status… and Assign… open the drawer. */}
      {canMutate && (
        <FloatingBulkBar count={allMatching ? total : selected.size} onClear={clearSelection}>
          {/* with the bar's own "N selected": "… on this page", or the whole filtered view */}
          <span className="text-[12px] text-fg-muted">{allMatching ? `all ${total} matching` : "on this page"}</span>
          {/* Never offer a selection the server will refuse: the bulk cap is BULK_MAX. */}
          {!allMatching && total > rows.length && total <= BULK_MAX && (
            <button type="button" className="px-1 text-[12px] text-accent hover:underline" onClick={() => setAllMatching(true)}>
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
          {canAssign && (
            <Button size="sm" variant="primary" onClick={() => setDrawerMode("assign")}>Assign…</Button>
          )}
          <Button size="sm" variant={canAssign ? "secondary" : "primary"} onClick={() => setDrawerMode("status")}>
            Change status…
          </Button>
          {!allMatching && (
            <ButtonLink size="sm" href={"/inventory/labels" + withClsQS(`?ids=${selectedIds.join(",")}`, cls)}>Print labels</ButtonLink>
          )}
          {/* a route handler that streams a file: a plain navigation, never prefetched */}
          <ButtonLink size="sm" native href={exportHref}>Export</ButtonLink>
        </FloatingBulkBar>
      )}
      {/* The row menu's dialogs (plan P-3's shared ones) render outside the table, so no click inside
          one can bubble to a row. Mounted only while open, keyed by the row, so each opens fresh. */}
      {dialog && active && dialog.kind === "assign" && (
        <AssignDialog
          key={active.id}
          open
          onClose={closeDialog}
          asset={active}
          direct={direct}
          recentPeople={recentPeople}
          heldFor={active.hold ? { id: active.hold.id, name: active.hold.name, active: active.hold.active } : undefined}
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
          recentPeople={recentPeople}
          onDone={clearSelection}
        />
      )}
    </div>
  );
}
