import Link from "next/link";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { unitsLabel } from "@/lib/stock-balance";
import { fmtDate } from "@/lib/format";
import type { StockItemRow } from "@/server/modules/stock/queries";

export function StockItemsTable({ rows }: { rows: StockItemRow[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Category</Th>
          <Th>Unit</Th>
          <Th align="right">Balance</Th>
          <Th align="right">Reorder level</Th>
          <Th>Last movement</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td>
              <span className="inline-flex items-center gap-2">
                <Link href={`/stock/items/${r.id}`} className="font-mono text-accent hover:underline">
                  {r.code}
                </Link>
                {r.archived && <Pill>ARCHIVED</Pill>}
              </span>
            </Td>
            <Td>{r.name}</Td>
            <Td>{r.category}</Td>
            <Td>{r.unit}</Td>
            <Td align="right">
              <span className="inline-flex items-center justify-end gap-2">
                <span className="font-mono text-xs text-fg">{unitsLabel(r.balance, r.unit)}</span>
                {r.low && <Pill tone="accent">LOW</Pill>}
              </span>
            </Td>
            <Td align="right" mono>{r.reorderLevel}</Td>
            <Td mono>{fmtDate(r.lastMovementAt)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
