import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { fmtMoneyExact } from "@/lib/format";
import type { ConsumptionCell, ConsumptionGrid } from "@/lib/stock-reports";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `monthKey` is already `YYYY-MM` on the Asia/Manila calendar (stock-reports.ts) — split the string rather than reconstruct a Date, which would need its own timezone care. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** Spec §6.2: units on one line, ₱cost beneath; an asterisk when the cell drew from any unpriced lot. */
function CellValue({ cell }: { cell: ConsumptionCell }) {
  if (cell.units === 0) return <span className="text-fg-faint">—</span>;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono text-xs text-fg">
        {cell.units}
        {cell.uncostedUnits > 0 && "*"}
      </span>
      <span className="font-mono text-[10.5px] text-fg-muted">
        {cell.cost === null ? "—" : fmtMoneyExact(cell.cost)}
      </span>
    </span>
  );
}

export function ConsumptionGridTable({ grid }: { grid: ConsumptionGrid }) {
  const hasUncosted = grid.grandTotal.uncostedUnits > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Table>
        <THead>
          <Tr>
            <Th>Department</Th>
            {grid.months.map((m) => (
              <Th key={m} align="right">{monthLabel(m)}</Th>
            ))}
            <Th align="right">Total</Th>
          </Tr>
        </THead>
        <TBody>
          {grid.rows.map((row) => (
            <Tr key={row.department}>
              <Td>{row.department}</Td>
              {grid.months.map((m) => (
                <Td key={m} align="right"><CellValue cell={row.cells[m]} /></Td>
              ))}
              <Td align="right" className="font-medium"><CellValue cell={row.total} /></Td>
            </Tr>
          ))}
          <Tr className="bg-surface-subtle font-semibold hover:bg-surface-subtle">
            <Td className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">Total</Td>
            {grid.months.map((m) => (
              <Td key={m} align="right"><CellValue cell={grid.columnTotals[m]} /></Td>
            ))}
            <Td align="right"><CellValue cell={grid.grandTotal} /></Td>
          </Tr>
        </TBody>
      </Table>
      {hasUncosted && (
        <p className="font-mono text-[10.5px] text-fg-muted">
          * includes {grid.grandTotal.uncostedUnits} uncosted units
        </p>
      )}
    </div>
  );
}
