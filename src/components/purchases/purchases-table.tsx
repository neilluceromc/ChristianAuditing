import Link from "next/link";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusDot, StatusPill } from "@/components/ui/status";
import type { PurchaseListRow } from "@/server/modules/purchases/queries";

/**
 * README 4d: the State column carries a second line saying how long it's been
 * there — "back from finance" is the fact the enum can't hold, and it is the
 * difference between a queue you can read and a queue you have to open.
 */
export function PurchasesTable({ rows }: { rows: PurchaseListRow[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th width={26} />
          <Th width={104}>Ref</Th>
          <Th>Request</Th>
          <Th width={78} align="right">Units</Th>
          <Th width={124} align="right">Value</Th>
          <Th width={150}>Requested by</Th>
          <Th width={168}>State</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td><StatusDot value={row.state} /></Td>
            <Td>
              <Link href={`/purchases/${row.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                {row.refNo}
              </Link>
            </Td>
            <Td className="text-fg">
              {row.unitCount === 1 ? "1 line" : `${row.unitCount} lines`} · {row.totalQty} item{row.totalQty === 1 ? "" : "s"}
            </Td>
            <Td align="right" mono>{row.unitCount}</Td>
            <Td align="right" mono>{row.total}</Td>
            <Td>{row.requester}</Td>
            <Td>
              <span className="flex flex-col gap-0.5 py-1.5">
                <StatusPill value={row.state} className="self-start" />
                <span className="font-mono text-[10px] text-fg-muted">{row.dwell}</span>
              </span>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
