"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { REPAIR_STAGE_LABEL } from "@/lib/repairs";
import { groupText, type WorkItem, type WorkItemCell, type WorkParty } from "@/lib/worklist";
import {
  NUMERIC_KEYS, OVER_DAYS, dateText, daysText, isRed, moneyText,
  type WorkColumn, type WorkSort,
} from "@/lib/worklist-view";

/**
 * The queue's table (plan calls 2, 9, 10): sortable headers (`Th`, aria-sort), one selected row (`Tr`
 * aria-selected), ticks for the queues that take bulk decisions, and the pager. Row height follows the viewport so
 * ten rows fit one screen from 1280×720; below 640 px the rows stack.
 *
 * Keyboard, scoped to the table body (never the document): ↑/↓ move the selection, Enter opens the panel's first
 * action. The selected row is the one tab stop (a roving tabindex).
 */
export function QueueTable({
  label, columns, rows, sort, onSort, selected, onSelect, onMove, onOpen, ticks, checked, onCheck, onCheckAll, empty,
}: {
  /** the queue's name: the table's accessible name */
  label: string;
  columns: WorkColumn[];
  rows: WorkItem[];
  sort: WorkSort | null;
  onSort: (key: string, numeric: boolean) => void;
  selected: string | null;
  /** a click on a row */
  onSelect: (key: string) => void;
  /** ↑/↓: one row up or down the whole list (the page follows) */
  onMove: (delta: 1 | -1) => void;
  onOpen: () => void;
  /** this queue takes ticks (Triage, IT check) and the person can act */
  ticks: boolean;
  checked: ReadonlySet<string>;
  onCheck: (key: string, on: boolean) => void;
  onCheckAll: (on: boolean) => void;
  /** shown in place of the rows when there are none */
  empty: React.ReactNode | null;
}) {
  const allOn = rows.length > 0 && rows.every((r) => checked.has(r.key));
  const someOn = rows.some((r) => checked.has(r.key));
  const span = columns.length + (ticks ? 1 : 0);
  const tabStop = rows.some((r) => r.key === selected) ? selected : rows[0]?.key;

  function onKeyDown(e: React.KeyboardEvent<HTMLTableSectionElement>) {
    // only the row itself: a key pressed in a checkbox stays the checkbox's
    if (!(e.target instanceof HTMLTableRowElement)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      onMove(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto max-sm:overflow-visible">
      <table aria-label={label} className="w-full table-fixed border-collapse text-[12.5px] max-sm:block">
        <colgroup className="max-sm:hidden">
          {ticks && <col style={{ width: 44 }} />}
          {columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface max-sm:hidden">
          <tr className="h-[34px]">
            {ticks && (
              <th scope="col" className="border-b border-border pl-2">
                <label className="inline-flex size-8 cursor-pointer items-center justify-center">
                  <Checkbox
                    aria-label="Select all on this page" checked={allOn} indeterminate={someOn && !allOn}
                    onChange={(e) => onCheckAll(e.target.checked)}
                  />
                </label>
              </th>
            )}
            {columns.map((c) => (
              <Th
                key={c.key} align={c.align}
                sort={sort?.key === c.key ? sort.dir : undefined}
                onSort={() => onSort(c.key, NUMERIC_KEYS.has(c.key))}
              >
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown} className="max-sm:block">
          {rows.length === 0 && empty ? (
            <tr className="max-sm:block"><td colSpan={span} className="px-4 py-12 text-center text-[13px] text-fg-muted max-sm:block">
              {/* where focus lands when the last row is decided (fix round 1, I1) */}
              <div tabIndex={-1} data-worklist-empty="" className="outline-offset-2">{empty}</div>
            </td></tr>
          ) : rows.map((r) => (
            <Tr
              key={r.key}
              data-row-key={r.key}
              selected={r.key === selected}
              tabIndex={r.key === tabStop ? 0 : -1}
              onClick={() => onSelect(r.key)}
              className={cn(
                "cursor-pointer outline-offset-[-2px] max-sm:flex max-sm:flex-wrap max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-4 max-sm:py-2.5",
                r.key === selected && "shadow-[inset_3px_0_0_var(--accent)]",
              )}
              style={{ height: "var(--wl-row)" }}
            >
              {ticks && (
                <td className="pl-2 max-sm:hidden" onClick={(e) => e.stopPropagation()}>
                  <label className="inline-flex size-8 cursor-pointer items-center justify-center">
                    <Checkbox aria-label={`Select ${r.entity?.label ?? r.title}`} checked={checked.has(r.key)} onChange={(e) => onCheck(r.key, e.target.checked)} />
                  </label>
                </td>
              )}
              <Cells item={r} selected={r.key === selected} columns={columns} />
            </Tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TD = "overflow-hidden px-3 py-1 align-middle text-fg-secondary max-sm:block max-sm:p-0";
const FIRST = "max-sm:w-full";
const one = "block truncate";
const sub = "block truncate text-[11px] leading-tight text-fg-muted";
const MUTED = "text-fg-muted";
const RED = "font-medium text-(--st-fault-text)";

function Two({ top, bottom, strong }: { top: React.ReactNode; bottom?: React.ReactNode; strong?: boolean }) {
  return (
    <>
      <span className={cn(one, "leading-tight", strong ? "font-semibold text-fg" : "font-medium text-fg")}>{top}</span>
      {bottom && <span className={sub}>{bottom}</span>}
    </>
  );
}

const itemCell = (item: WorkItemCell, strong: boolean): CellDef => ({
  first: true,
  node: <Two strong={strong} top={item.model} bottom={<>{item.category ?? "Uncategorised"} · <span className="font-mono">{item.tag}</span></>} />,
});

const partyCell = (party: WorkParty | null, none = "Not recorded"): CellDef => ({
  node: party
    ? <Two top={<span className="font-normal text-fg-secondary">{party.name}</span>} bottom={party.group ? groupText(party.group) : undefined} />
    : <span className={MUTED}>{none}</span>,
});

/** Over 90 days reads bold, never red. */
const daysCell = (n: number): CellDef => ({ node: daysText(n), cls: cn("tabular-nums", n > OVER_DAYS ? "font-semibold text-fg" : MUTED) });

const plain = (node: React.ReactNode, cls?: string): CellDef => ({ node, cls: cn("truncate", cls) });
const muted = (text: string) => <span className={MUTED}>{text}</span>;
const mono = (text: string) => <span className="font-mono">{text}</span>;

interface CellDef { node: React.ReactNode; cls?: string; first?: true }

/** One row's cells, in its queue's column order (COLUMNS). */
function cellsOf(item: WorkItem, selected: boolean): CellDef[] {
  const c = item.columns;
  switch (c.section) {
    case "triage":
      return [itemCell(c.item, selected), partyCell(c.lastHolder), plain(dateText(c.returnedAt)), daysCell(c.waitingDays)];
    case "repairs":
      return [itemCell(c.item, selected), plain(c.vendor ?? muted("Not sent")), plain(REPAIR_STAGE_LABEL[c.stage]), daysCell(c.downDays)];
    case "check":
      return [
        itemCell(c.item, selected), plain(c.registeredBy ?? muted("Not recorded")),
        plain(c.fromPo ? mono(c.fromPo.refNo) : muted("No PO")), daysCell(c.waitingDays),
      ];
    case "purchases":
      return [
        { first: true, node: <Two strong={selected} top={mono(c.po.refNo)} bottom={c.po.summary ?? "No lines"} /> },
        plain(c.vendor ?? muted("Not recorded")), plain(c.siNumber ? mono(c.siNumber) : muted("Not recorded")),
        plain(moneyText(c.total), "text-right tabular-nums"), daysCell(c.waitingDays),
      ];
    case "hires":
      return [
        { first: true, node: <Two strong={selected} top={c.person.name} bottom={mono(c.person.employeeNo)} /> },
        plain(c.group ? groupText(c.group) : muted("Not recorded")), plain(dateText(c.startedAt)),
        plain(String(c.missingSlots), "text-right tabular-nums"),
      ];
    case "loans":
      return [
        itemCell(c.item, selected), partyCell(c.borrower, "Unassigned"), plain(dateText(c.dueAt)),
        plain(c.status, isRed(item) ? RED : c.dueAt ? "" : MUTED),
      ];
    case "missing":
      return [itemCell(c.item, selected), plain(c.problem), partyCell(c.lastHolder), plain(dateText(c.since))];
    case "queue":
      return [
        { first: true, node: <Two strong={selected} top={c.what} /> }, plain(c.who), daysCell(c.waitingDays),
        plain(c.sla?.text ?? "—", isRed(item) ? RED : MUTED),
      ];
  }
}

/**
 * The row's cells. Below 640 px the head is hidden and the rows stack, so each cell carries its column's name
 * (fix round 1, M10): a small visible label, except the first cell's, which only a screen reader needs. From 640 px
 * the labels are gone (`sm:hidden`) and the head names the columns.
 */
function Cells({ item, selected, columns }: { item: WorkItem; selected: boolean; columns: WorkColumn[] }) {
  return (
    <>
      {cellsOf(item, selected).map((cell, i) => (
        <td key={columns[i]?.key ?? i} className={cn(TD, cell.first && FIRST, cell.cls)}>
          <span className={cn("sm:hidden", cell.first ? "sr-only" : "mr-1 text-[11px] text-fg-muted")}>{columns[i]?.label}</span>
          {cell.node}
        </td>
      ))}
    </>
  );
}

/**
 * The pager under the table (plan call 11): "1–10 of 16", the cap note on a capped queue's last page, and
 * Previous / Next (44 px hit areas).
 */
export function QueuePager({ label, note, page, pageCount, onPage, extra }: {
  label: string;
  note: string | null;
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  extra?: React.ReactNode;
}) {
  const btn = "relative inline-flex h-9 items-center rounded-(--radius-btn) border border-border-strong bg-surface px-3 text-[12.5px] text-fg-secondary hover:bg-surface-subtle disabled:pointer-events-none disabled:opacity-45 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";
  return (
    <nav aria-label="Pages" className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border-faint px-4 py-1.5 text-[12.5px] text-fg-secondary">
      <span className="flex min-w-0 flex-wrap items-center gap-x-3">
        <span className="tabular-nums">{label}</span>
        {note && <span className="text-fg-muted">{note}</span>}
        {extra}
      </span>
      <span className="flex gap-1.5">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
        <button type="button" className={btn} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next →</button>
      </span>
    </nav>
  );
}
