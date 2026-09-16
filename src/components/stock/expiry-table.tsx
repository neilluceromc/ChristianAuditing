import Link from "next/link";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import { expiryLabel } from "@/lib/stock-allocation";
import { WriteOffDialog } from "@/components/stock/write-off-dialog";
import type { ExpiryLotRow } from "@/server/modules/stock/report-queries";

/** Spec §6.3: one block (Expired or Expiring within N days) as a table, or the block's own empty copy. */
export function ExpiryTable({
  title,
  rows,
  today,
  emptyText,
  canManage,
}: {
  title: string;
  rows: ExpiryLotRow[];
  today: string;
  emptyText: string;
  canManage: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Code</Th>
              <Th>Item</Th>
              <Th>Lot date</Th>
              <Th>Reference</Th>
              <Th>Supplier</Th>
              <Th>Expires</Th>
              <Th>Days</Th>
              <Th align="right">Remaining</Th>
              <Th align="right">Unit cost</Th>
              <Th align="right">Value at risk</Th>
              {canManage && <Th aria-label="Actions" />}
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const label = expiryLabel(r.expiresAt, today);
              const expired = label.startsWith("expired");
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/stock/items/${r.itemId}`} className="font-mono text-accent hover:underline">
                      {r.code}
                    </Link>
                  </Td>
                  <Td>{r.item}</Td>
                  <Td mono>{fmtDate(r.lotDate)}</Td>
                  <Td mono>{r.reference ?? "—"}</Td>
                  <Td>{r.supplier ?? "—"}</Td>
                  <Td mono>{fmtDate(r.expiresAt)}</Td>
                  <Td
                    mono
                    className={expired ? "text-[10.5px] text-[var(--danger-bg)]" : "text-[10.5px] text-fg-muted"}
                  >
                    {label}
                  </Td>
                  <Td align="right" mono>{r.remaining}</Td>
                  <Td align="right" mono>{fmtMoneyExact(r.unitCost)}</Td>
                  <Td align="right" mono>{fmtMoneyExact(r.valueAtRisk)}</Td>
                  {canManage && (
                    <Td align="right">
                      <WriteOffDialog
                        lot={{ id: r.id, remaining: r.remaining, expired, reference: r.reference }}
                        itemCode={r.code}
                        unit={r.unit}
                      />
                    </Td>
                  )}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </section>
  );
}
