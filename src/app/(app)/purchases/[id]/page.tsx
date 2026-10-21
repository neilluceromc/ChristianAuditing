import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { purchaseRefFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getPurchase } from "@/server/modules/purchases/queries";
import { PO_STATE_LABEL } from "@/lib/po-flow";
import { bounceBack, stepperModel } from "@/lib/purchase-thread";
import { canAttachToRequest } from "@/lib/supplier-access";
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
import { RequestDocumentsCard } from "@/components/purchases/request-documents-card";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle((await purchaseRefFor(id)) ?? "Purchase request") };
}

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const request = await getPurchase(id);
  if (!request) notFound();

  const bounce = bounceBack(request.state, request.notes);
  const stepper = stepperModel(request.state, request.notes);
  const canComment = user.role !== "viewer";

  return (
    <>
      <PageHeader
        title={request.refNo}
        breadcrumb={[{ label: "Purchase requests", href: "/purchases" }, { label: request.refNo }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={request.state} label={PO_STATE_LABEL[request.state]} />
            <Pill>{request.department ? `FOR ${request.department.name.toUpperCase()}` : "NO DEPARTMENT"}</Pill>
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          user.role === "viewer" ? undefined : (
            <RequestActions
              id={request.id}
              state={request.state}
              role={user.role}
              assetCount={request.assetCount}
            />
          )
        }
      />
      <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
        requested by {request.requester} · {fmtDate(request.createdAt)} · {request.units.length} line
        {request.units.length === 1 ? "" : "s"} · {request.total} · for {request.department?.name ?? "no department"}
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
          <CardHeader title="Supplier" />
          <CardBody>
            {/* Migration 38: the supplier is set on the order itself (Task 3's save); read-only here. */}
            {request.supplier ? (
              <span className="inline-flex items-center gap-2 text-[13px] text-fg">
                {request.supplier.name}
                {request.supplier.archived && <Pill>ARCHIVED</Pill>}
              </span>
            ) : (
              <span className="text-xs text-fg-muted">No supplier recorded.</span>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lines" />
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
                      {/* multi-line on purpose: description, specs, and the old flow's IT and Finance notes */}
                      <Td wrap>
                        <div className="flex flex-col gap-0.5 py-1.5">
                          <span className="text-fg">{unit.description}</span>
                          {unit.specs && <span className="text-[11px] text-fg-muted">{unit.specs}</span>}
                          {unit.itSlotNotes && (
                            <span className="font-mono text-[10px] text-fg-muted">IT: {unit.itSlotNotes}</span>
                          )}
                          {unit.financeNotes && (
                            <span className="font-mono text-[10px] text-fg-muted">Finance: {unit.financeNotes}</span>
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

        <RequestDocumentsCard requestId={request.id} docs={request.documents} canUpload={canAttachToRequest(user.role)} />

        <NoteThread requestId={request.id} refNo={request.refNo} notes={request.notes} canComment={canComment} />
      </div>
    </>
  );
}
