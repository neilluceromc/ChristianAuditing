import Link from "next/link";
import { Fragment } from "react";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import { unitsLabel } from "@/lib/stock-balance";
import type { ExpiringStatus } from "@/server/modules/stock/queries";
import type { OnHandCategoryGroup } from "@/server/modules/stock/report-queries";

/** Same two states the item page and stock list pill (Task 6) render — EXPIRED outranks EXPIRING, matching `computeOnHandRows`'s own precedence. */
function ExpiringPill({ expiring }: { expiring: ExpiringStatus }) {
  if (expiring === "expired") {
    return (
      <Pill className="border-[var(--danger-bg)] bg-[var(--danger-bg)]/12 text-[var(--danger-bg)]">
        EXPIRED
      </Pill>
    );
  }
  if (expiring === "expiring") return <Pill tone="accent">EXPIRING</Pill>;
  return null;
}

/** Spec §6.1: category groups with a subtotal row each, then one grand total row. 10 columns; subtotal/total rows blank the columns they don't summarize. */
export function OnHandTable({
  groups,
  grandTotal,
}: {
  groups: OnHandCategoryGroup[];
  grandTotal: { units: number; uncostedUnits: number; value: number };
}) {
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
                <Td>{item.name}</Td>
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
                    <ExpiringPill expiring={item.expiring} />
                  </span>
                </Td>
              </Tr>
            ))}
            <Tr className="font-medium">
              <Td colSpan={3} className="text-right font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-muted">
                Subtotal
              </Td>
              <Td align="right" mono>{g.subtotal.units}</Td>
              <Td colSpan={2} />
              <Td align="right" mono>{g.subtotal.uncostedUnits}</Td>
              <Td align="right" mono>{fmtMoneyExact(g.subtotal.value)}</Td>
              <Td colSpan={2} />
            </Tr>
          </Fragment>
        ))}
        <Tr className="bg-surface-subtle font-semibold hover:bg-surface-subtle">
          <Td colSpan={3} className="text-right font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">
            Grand total
          </Td>
          <Td align="right" mono>{grandTotal.units}</Td>
          <Td colSpan={2} />
          <Td align="right" mono>{grandTotal.uncostedUnits}</Td>
          <Td align="right" mono>{fmtMoneyExact(grandTotal.value)}</Td>
          <Td colSpan={2} />
        </Tr>
      </TBody>
    </Table>
  );
}
