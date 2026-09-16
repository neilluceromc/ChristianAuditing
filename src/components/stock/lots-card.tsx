import { Fragment } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import type { ItemLots } from "@/server/modules/stock/queries";
import { WriteOffDialog } from "./write-off-dialog";
import { SetCostDialog } from "./set-cost-dialog";
import { LotDocumentDialog, LOT_DOCUMENT_LABEL } from "./lot-document-dialog";

/**
 * Spec §6.4: open lots in `itemLots`'s own consumption order (expired first),
 * each row's manager actions self-contained client islands; closed lots
 * collapse to a footer count; a lot's documents render as a second row
 * beneath it (download links with kind pills), never a nested table.
 */
export function LotsCard({
  itemCode,
  unit,
  lots,
  manage,
}: {
  itemCode: string;
  unit: string;
  lots: ItemLots;
  manage: boolean;
}) {
  const cols = manage ? 8 : 7;

  return (
    <Card>
      <CardHeader title="Lots" />
      <CardBody className="flex flex-col gap-2">
        {lots.open.length === 0 ? (
          <p className="py-6 text-center text-xs text-fg-muted">No open lots.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Lot date</Th>
                <Th>Expires</Th>
                <Th>Reference</Th>
                <Th>Supplier</Th>
                <Th align="right">Remaining</Th>
                <Th align="right">Unit cost</Th>
                <Th align="right">Value</Th>
                {manage && <Th aria-label="Actions" />}
              </Tr>
            </THead>
            <TBody>
              {lots.open.map((l) => (
                <Fragment key={l.id}>
                  <Tr>
                    <Td mono>{fmtDate(l.lotDate)}</Td>
                    <Td mono style={l.expired ? { color: "var(--st-fault-text)" } : undefined}>
                      {l.expiryLabel ?? "—"}
                    </Td>
                    <Td>{l.reference ?? "—"}</Td>
                    <Td>{l.supplier ?? "—"}</Td>
                    <Td align="right" mono>{l.remaining} of {l.quantity}</Td>
                    <Td align="right" mono>{l.unitCost === null ? "—" : fmtMoneyExact(l.unitCost)}</Td>
                    <Td align="right" mono>{l.value === null ? "—" : fmtMoneyExact(l.value)}</Td>
                    {manage && (
                      <Td align="right">
                        <div className="flex justify-end gap-2">
                          <SetCostDialog lot={{ id: l.id, unitCost: l.unitCost }} />
                          <WriteOffDialog
                            lot={{ id: l.id, remaining: l.remaining, expired: l.expired, reference: l.reference }}
                            itemCode={itemCode}
                            unit={unit}
                          />
                          <LotDocumentDialog lotId={l.id} />
                        </div>
                      </Td>
                    )}
                  </Tr>
                  {l.documents.length > 0 && (
                    <Tr>
                      <Td colSpan={cols} className="bg-surface-subtle">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1">
                          {l.documents.map((d) => (
                            <a
                              key={d.id}
                              href={d.downloadHref}
                              className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline"
                            >
                              <Pill>{LOT_DOCUMENT_LABEL[d.kind as keyof typeof LOT_DOCUMENT_LABEL] ?? d.kind}</Pill>
                              {d.fileName}
                            </a>
                          ))}
                        </div>
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
        {lots.closedCount > 0 && (
          <p className="font-mono text-[11px] text-fg-muted">{lots.closedCount} closed lots</p>
        )}
      </CardBody>
    </Card>
  );
}
