"use client";

import { useRouter } from "next/navigation";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { serializeListState, toggleSort, type ListState } from "@/lib/url-state";
import type { AssetRow } from "@/server/modules/inventory/queries";

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
export const HIDEABLE_COLUMNS = ["category", "assigned", "purchased", "warranty"] as const;

export function InventoryTable({
  rows,
  state,
  visible,
}: {
  rows: AssetRow[];
  state: ListState;
  visible: string[]; // hideable-column ids currently shown
}) {
  const router = useRouter();

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
    <Table>
      <THead>
        <Tr>
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
            onClick={() => router.push(`/inventory/${row.id}`)}
          >
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
  );
}
