import { Fragment } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import { uploadedLine } from "@/lib/file-preview";
import { LOT_DOCUMENT_LABEL } from "@/lib/stock-schema";
import { PreviewButton } from "@/components/files/file-preview-dialog";
import type { ItemLots } from "@/server/modules/stock/queries";
import { WriteOffDialog } from "./write-off-dialog";
import { SetCostDialog } from "./set-cost-dialog";
import { LotDocumentDialog } from "./lot-document-dialog";

/**
 * Spec §6.4: open lots in `itemLots`'s own consumption order (expired first),
 * each row's manager actions self-contained client islands; closed lots
 * collapse to a footer count; a lot's documents render as a second row
 * beneath it (each with its kind pill, when and by whom it was uploaded,
 * Preview and Download), never a nested table.
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
                <Th>Vendor</Th>
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
                    <Td><span className="block max-w-[12rem] truncate" title={l.supplier ?? undefined}>{l.supplier ?? "—"}</span></Td>
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
                        <ul aria-label="Lot documents" className="flex flex-col gap-1 py-1">
                          {l.documents.map((d) => {
                            const label = LOT_DOCUMENT_LABEL[d.kind as keyof typeof LOT_DOCUMENT_LABEL] ?? d.kind;
                            return (
                              <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                                <Pill>{label}</Pill>
                                <span className="max-w-[16rem] truncate text-fg" title={d.fileName}>{d.fileName}</span>
                                <span className="font-mono text-[10.5px] text-fg-muted">{uploadedLine(d.uploadedAt, d.uploadedBy)}</span>
                                <PreviewButton
                                  plain className="text-accent hover:underline"
                                  title={label} fileName={d.fileName} href={d.downloadHref} inlineHref={`${d.downloadHref}?inline=1`}
                                  uploadedAt={d.uploadedAt} uploadedBy={d.uploadedBy}
                                />
                                <a href={d.downloadHref} className="text-accent hover:underline">Download</a>
                              </li>
                            );
                          })}
                        </ul>
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
