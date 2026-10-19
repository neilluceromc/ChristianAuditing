import Link from "next/link";
import { Fragment } from "react";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import { unitsLabel } from "@/lib/stock-balance";
import { ExpiryPill } from "@/components/stock/expiry-pill";
import type { OnHandPageGroup } from "@/server/modules/stock/report-queries";

/**
 * Spec §6.1, Phase 39 §4.2: one page of items (50) with a category heading wherever the category changes on the page.
 * The subtotals and the grand total are not rows any more — they sit in the totals card above (`OnHandTotals`), over
 * everything matching the filters. 10 columns.
 */
export function OnHandTable({ groups }: { groups: OnHandPageGroup[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Unit</Th>
          <Th align="right">Balance</Th>
          <Th align="right">Open lots</Th>
          <Th align="right">Costed units</Th>
          <Th align="right">Uncosted units</Th>
          <Th align="right">Value on hand</Th>
          <Th>Oldest lot</Th>
          <Th>Nearest expiry</Th>
        </Tr>
      </THead>
      <TBody>
        {groups.map((g) => (
          <Fragment key={g.categoryId}>
            <Tr className="bg-surface-subtle hover:bg-surface-subtle">
              <Td colSpan={10} className="py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
                {g.categoryName}
              </Td>
            </Tr>
            {g.items.map((item) => (
              <Tr key={item.id}>
                <Td>
                  <Link href={`/stock/items/${item.id}`} className="font-mono text-accent hover:underline">
                    {item.code}
                  </Link>
                </Td>
                <Td><span className="block max-w-[16rem] truncate" title={item.name}>{item.name}</span></Td>
                <Td>{item.unit}</Td>
                <Td align="right" mono>{unitsLabel(item.balance, item.unit)}</Td>
                <Td align="right" mono>{item.openLots}</Td>
                <Td align="right" mono>{item.costedUnits}</Td>
                <Td align="right" mono>{item.uncostedUnits}</Td>
                <Td align="right" mono>{fmtMoneyExact(item.valueOnHand)}</Td>
                <Td mono>{fmtDate(item.oldestLot)}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-xs text-fg-muted">{fmtDate(item.nearestExpiry)}</span>
                    <ExpiryPill expiring={item.expiring} />
                  </span>
                </Td>
              </Tr>
            ))}
          </Fragment>
        ))}
      </TBody>
    </Table>
  );
}
