import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getPurchase } from "@/server/modules/purchases/queries";
import { unitEditorMode } from "@/lib/purchase-flow";
import { bounceBack, stepperModel } from "@/lib/purchase-thread";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { BounceBackBanner } from "@/components/purchases/bounce-back-banner";
import { PurchaseStepper } from "@/components/purchases/purchase-stepper";
import { NoteThread } from "@/components/purchases/note-thread";
import { RequestActions } from "@/components/purchases/request-actions";
import { UnitEditor } from "@/components/purchases/unit-editor";

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const request = await getPurchase(id);
  if (!request) notFound();

  const bounce = bounceBack(request.state, request.notes);
  const stepper = stepperModel(request.state, request.notes);
  const editorMode = unitEditorMode(request.state, user.role);
  const canComment = user.role !== "viewer";

  return (
    <>
      <PageHeader
        title={request.refNo}
        breadcrumb={[{ label: "Purchase requests", href: "/purchases" }, { label: request.refNo }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={request.state} />
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          user.role === "viewer" ? undefined : (
            <RequestActions
              id={request.id}
              state={request.state}
              role={user.role}
              isDraftOwner={request.requestedById === user.id || user.role === "admin"}
            />
          )
        }
      />
      <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
        requested by {request.requester} · {fmtDate(request.createdAt)} · {request.units.length} line
        {request.units.length === 1 ? "" : "s"} · {request.total}
        {request.reviewedBy ? ` · IT-reviewed by ${request.reviewedBy}` : ""}
      </p>

      <div className="flex flex-col gap-4">
        {bounce && <BounceBackBanner bounce={bounce} />}

        <Card>
          <CardHeader title="Progress" />
          <CardBody>
            <PurchaseStepper model={stepper} />
            {request.state === "CANCELLED" && request.cancelReason && (
              <p className="mt-3 text-xs text-fg-secondary">
                Cancelled {fmtDate(request.cancelledAt)} — {request.cancelReason}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lines"
            actions={
              editorMode && (
                <Pill tone="accent">
                  {editorMode === "it" ? "IT SLOT EDITOR" : "FINANCE UNIT EDITOR"}
                </Pill>
              )
            }
          />
          <CardBody className="px-0 py-0">
            <div id="units">
              <Table className="rounded-none border-0 shadow-none">
                <THead>
                  <Tr>
                    <Th width={40}>#</Th>
                    <Th>Line</Th>
                    <Th width={60} align="right">Qty</Th>
                    <Th width={120} align="right">Unit price</Th>
                    <Th width={120} align="right">Line total</Th>
                    <Th width={110}>State</Th>
                  </Tr>
                </THead>
                <TBody>
                  {request.units.map((unit) => (
                    <Tr key={unit.id} id={`unit-${unit.index}`}>
                      <Td mono>{String(unit.index).padStart(2, "0")}</Td>
                      <Td>
                        {/* a div, not a span: UnitEditor renders block elements */}
                        <div className="flex flex-col gap-0.5 py-1.5">
                          <span className="text-fg">{unit.description}</span>
                          {unit.specs && <span className="text-[11px] text-fg-muted">{unit.specs}</span>}
                          {unit.itSlotNotes && (
                            <span className="font-mono text-[10px] text-fg-muted">IT: {unit.itSlotNotes}</span>
                          )}
                          {unit.financeNotes && (
                            <span className="font-mono text-[10px] text-fg-muted">Finance: {unit.financeNotes}</span>
                          )}
                          {editorMode && (
                            <div className="mt-2">
                              <UnitEditor unit={unit} mode={editorMode} />
                            </div>
                          )}
                        </div>
                      </Td>
                      <Td align="right" mono>{unit.qty}</Td>
                      <Td align="right" mono>{unit.price}</Td>
                      <Td align="right" mono>{unit.lineTotal}</Td>
                      <Td><StatusPill value={unit.state} /></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardBody>
        </Card>

        <NoteThread requestId={request.id} notes={request.notes} canComment={canComment} />
      </div>
    </>
  );
}
