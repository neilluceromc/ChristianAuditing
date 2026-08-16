"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { BULK_MAX, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { serializeListState, toggleSort, type ListState } from "@/lib/url-state";
import type { AssetRow } from "@/server/modules/inventory/queries";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";
import { BulkDrawer } from "./bulk-drawer";

export interface ColumnDef {
  id: string;
  label: string;
  width?: number;
  sortKey?: string; // present ⇒ sortable
}

/** README `1f`: ☐ · dot · tag(104) · model(flex) · category(84) · assigned(168) · status(88) · purchased(104) · warranty(72). */
export const INVENTORY_COLUMNS: ColumnDef[] = [
  { id: "tag", label: "Tag", width: 104, sortKey: "tag" },
  { id: "model", label: "Model", sortKey: "model" },
  { id: "category", label: "Category", width: 84, sortKey: "category" },
  { id: "assigned", label: "Assigned", width: 168 },
  { id: "status", label: "Status", width: 88, sortKey: "status" },
  { id: "purchased", label: "Purchased", width: 104, sortKey: "purchasedAt" },
  { id: "warranty", label: "Warranty", width: 72, sortKey: "warrantyUntil" },
];

/** Columns the chooser may hide (Task 10). tag/model/status always render. */
export const HIDEABLE_COLUMNS = COLUMN_PREF_KEYS["columns:inventory"];

export function InventoryTable({
  rows,
  state,
  visible,
  canMutate,
  filtersQS,
  total,
}: {
  rows: AssetRow[];
  state: ListState;
  visible: string[]; // hideable-column ids currently shown
  canMutate: boolean;
  filtersQS: string; // serialized current list state, no leading "?"
  total: number;
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const columns = INVENTORY_COLUMNS.filter(
    (c) => !(HIDEABLE_COLUMNS as readonly string[]).includes(c.id) || visible.includes(c.id),
  );

  function onSort(sortKey: string) {
    const next = { ...state, sort: toggleSort(state.sort, sortKey), page: 1 };
    router.push("/inventory" + serializeListState(next, INVENTORY_LIST_CONFIG));
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

  return (
    <div className="flex flex-col gap-2">
      {canMutate && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-(--radius-card) border border-accent-soft-border bg-accent-tint px-3 py-2 text-xs text-fg-secondary">
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
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            <Button size="sm" variant="primary" onClick={() => setDrawerOpen(true)}>Bulk actions…</Button>
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
          <Th width={19}>
            <span className="sr-only">Status colour</span>
          </Th>
          {columns.map((col) => (
            <Th key={col.id} width={col.width} {...sortProps(col)}>
              {col.label}
            </Th>
          ))}
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr
            key={row.id}
            className="cursor-pointer"
            selected={selected.has(row.id)}
            onClick={() => router.push(`/inventory/${row.id}`)}
          >
            {canMutate && (
              <Td className="pr-0" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <Checkbox
                  aria-label={`Select ${row.tag}`}
                  checked={selected.has(row.id)}
                  onChange={() => toggleRow(row.id)}
                />
              </Td>
            )}
            <Td className="pr-0">
              <StatusDot value={row.status} />
            </Td>
            {columns.map((col) => {
              switch (col.id) {
                case "tag":
                  return (
                    <Td key={col.id} mono>
                      <a
                        href={`/inventory/${row.id}`}
                        className="text-accent hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.tag}
                      </a>
                    </Td>
                  );
                case "model":
                  return <Td key={col.id}>{row.model}</Td>;
                case "category":
                  return <Td key={col.id}>{row.category}</Td>;
                case "assigned":
                  return <Td key={col.id}>{row.assignee ?? <span className="text-fg-faint">—</span>}</Td>;
                case "status":
                  return <Td key={col.id} mono className="text-[10.5px]">{row.status}</Td>;
                case "purchased":
                  return <Td key={col.id} mono>{row.purchased}</Td>;
                case "warranty":
                  return <Td key={col.id} mono>{row.warranty}</Td>;
                default:
                  return <Td key={col.id} />;
              }
            })}
          </Tr>
        ))}
      </TBody>
      </Table>
      {canMutate && (
        <BulkDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          selectedIds={[...selected]}
          allMatching={allMatching}
          filtersQS={filtersQS}
          total={total}
          onDone={clearSelection}
        />
      )}
    </div>
  );
}
