import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { purchaseRefFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { getPurchase } from "@/server/modules/purchases/queries";
import { PO_STATE_LABEL } from "@/lib/po-flow";
import { poControls } from "@/lib/po-controls";
import { poFieldWords } from "@/lib/po-send-back";
import { bounceBack, stepperModel } from "@/lib/purchase-thread";
import { canAttachToRequest } from "@/lib/supplier-access";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { BounceBackBanner } from "@/components/purchases/bounce-back-banner";
import { PurchaseStepper } from "@/components/purchases/purchase-stepper";
import { NoteThread } from "@/components/purchases/note-thread";
import { PoActionsBar } from "@/components/purchases/po-actions-bar";
import { CloseShortButton } from "@/components/purchases/close-short-dialog";
import { RequestDocumentsCard } from "@/components/purchases/request-documents-card";
import { PoSendBackUndoBanner } from "@/components/finance/po-undo-banner";
import { poSendBackUndoBanner } from "@/server/modules/purchases/po-undo";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle((await purchaseRefFor(id)) ?? "Purchase order") };
}

const TEAM_WORDS: Record<string, string> = { IT: "IT", FINANCE: "Finance", PURCHASING: "Purchasing" };

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const po = await getPurchase(id);
  if (!po) notFound();

  const viewer = user.role === "viewer";
  const controls = poControls({
    role: user.role, state: po.state, registeredCount: po.assetCount, approvedCount: po.approvedCount,
    lines: po.units.map((u) => ({ id: u.id, cls: u.cls, qty: u.qty, registered: u.registered, closedShort: u.closedShort })),
  });
  const stepper = stepperModel(po.state, po.notes, {
    hasItLines: po.hasItLines, progress: po.progress, sentBackBy: po.sentBack?.by ?? null,
  });
  // A legacy bounce (an old Finance request-info or IT reject) still reads off the thread; the PO's own send-back is below.
  const bounce = po.sentBack ? null : bounceBack(po.state, po.notes);
  const missingSi = !po.invoiceRef && po.state !== "CANCELLED";
  // Task 6 fix round 1: for 15 minutes, the person who sent it back can take the send-back back (the server re-checks).
  const sendBackUndo = po.state === "SENT_BACK" && ["it_staff", "finance_staff", "admin"].includes(user.role)
    ? await poSendBackUndoBanner(prisma, po.id, user.id, new Date())
    : null;

  // The Fix dialog's supplier list: live suppliers, plus this order's own even if it has since been archived.
  const vendors = controls.fix
    ? await prisma.vendor.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  const supplierOptions = po.supplier && !vendors.some((v) => v.id === po.supplier!.id)
    ? [...vendors, { id: po.supplier.id, name: po.supplier.name }]
    : vendors;

  return (
    <>
      <PageHeader
        title={po.refNo}
        breadcrumb={[{ label: "Purchase orders", href: "/purchases" }, { label: po.refNo }]}
        badge={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill value={po.state} label={PO_STATE_LABEL[po.state]} />
            {po.progress && <Pill tone="accent">{po.progress}</Pill>}
            <Pill>{po.department ? `FOR ${po.department.name.toUpperCase()}` : "NO DEPARTMENT"}</Pill>
            {viewer && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          viewer ? undefined : (
            <PoActionsBar
              po={{
                id: po.id, refNo: po.refNo, vendorId: po.supplier?.id ?? null, invoiceRef: po.invoiceRef,
                receiptRef: po.receiptRef, purchasedAt: po.purchasedAt, fees: po.fees,
              }}
              controls={controls}
              lines={po.units.map((u) => ({ id: u.id, index: u.index, description: u.description, unitPrice: u.unitPrice }))}
              vendors={supplierOptions}
            />
          )
        }
      />
      <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
        saved by {po.requester} · {fmtDate(po.createdAt)} · {po.units.length} line{po.units.length === 1 ? "" : "s"} · {po.total}
        {" "}· for {po.department?.name ?? "no department"}
        {po.reviewedBy ? ` · IT-reviewed by ${po.reviewedBy}` : ""}
      </p>

      {sendBackUndo && <PoSendBackUndoBanner poId={po.id} state={sendBackUndo} />}

      <div className="flex flex-col gap-4">
        {po.sentBack && po.sentBack.by && (
          <Banner
            tone="fault"
            title={`Sent back by ${TEAM_WORDS[po.sentBack.by] ?? "another team"}${po.sentBack.byName ? ` — ${po.sentBack.byName}` : ""}${po.sentBack.at ? ` · ${fmtDateTime(po.sentBack.at)}` : ""}`}
            actions={
              <>
                {controls.edit && <ButtonLink href={`/purchases/${po.id}/edit`} size="sm">Fix and reply</ButtonLink>}
                <a href="#thread" className="self-center text-xs font-medium text-accent hover:underline">See the thread</a>
              </>
            }
          >
            <p className="text-[13px] text-fg">{po.sentBack.note ?? "No note was left."}</p>
            {po.sentBack.fields.length > 0 && (
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
                Flagged: {poFieldWords(po.sentBack.fields).join(" · ")}
              </p>
            )}
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
              With Purchasing · nothing was cleared
            </p>
          </Banner>
        )}
        {po.sentBack && !po.sentBack.by && (
          <Banner tone="attention" title="Not sent yet">
            This order was a draft before purchase orders. Edit it and save to send it on.
          </Banner>
        )}
        {bounce && <BounceBackBanner bounce={bounce} />}
        {missingSi && (
          <Banner tone="attention" title="No SI number yet. Finance can't approve until it's added." />
        )}

        <Card>
          <CardHeader title="Progress" />
          <CardBody>
            <PurchaseStepper model={stepper} />
            {po.state === "CANCELLED" && po.cancelReason && (
              <p className="mt-3 text-xs text-fg-secondary">
                Cancelled {fmtDate(po.cancelledAt)} — {po.cancelReason}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Purchase" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: "Supplier",
                  value: po.supplier ? (
                    <span className="inline-flex items-center gap-2">
                      {po.supplier.name}
                      {po.supplier.archived && <Pill>ARCHIVED</Pill>}
                    </span>
                  ) : (
                    <span className="text-fg-muted">Not recorded</span>
                  ),
                },
                { label: "SI number", value: po.invoiceRef ?? <span className="text-fg-muted">Not recorded</span>, mono: !!po.invoiceRef },
                { label: "OR number", value: po.receiptRef ?? <span className="text-fg-muted">—</span>, mono: !!po.receiptRef },
                { label: "Purchase date", value: po.purchasedAt ? fmtDate(`${po.purchasedAt}T00:00:00Z`) : <span className="text-fg-muted">Not recorded</span> },
                { label: "Fees", value: po.fees === null ? <span className="text-fg-muted">—</span> : fmtMoney(po.fees), mono: po.fees !== null },
                { label: "Total", value: po.total, mono: true },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lines"
            actions={po.legacy && po.assetCount > 0 ? (
              <span className="font-mono text-[11px] text-fg-muted">
                {po.assetCount} asset{po.assetCount === 1 ? "" : "s"} linked
              </span>
            ) : undefined}
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
                    <Th width={220}>Registered</Th>
                  </Tr>
                </THead>
                <TBody>
                  {po.units.map((unit) => {
                    const canClose = controls.closeShort && unit.remaining > 0;
                    return (
                      <Tr key={unit.id} id={`unit-${unit.index}`}>
                        <Td mono>{String(unit.index).padStart(2, "0")}</Td>
                        {/* multi-line on purpose: description, specs, category, and the old flow's IT and Finance notes */}
                        <Td wrap>
                          <div className="flex flex-col gap-0.5 py-1.5">
                            <span className="text-fg">{unit.description}</span>
                            {unit.specs && <span className="text-[11px] text-fg-muted">{unit.specs}</span>}
                            {unit.categoryName && (
                              <span className="font-mono text-[10px] text-fg-muted">
                                {unit.categoryName} · {unit.cls === "IT" ? "IT" : "non-IT"}
                              </span>
                            )}
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
                        <Td wrap>
                          <div className="flex flex-col items-start gap-0.5 py-1.5">
                            {unit.categoryId === null && unit.registered === 0 && unit.closedShort === 0 ? (
                              // an old unit: no category, and the unit link was never set — the class is picked at Register
                              <span className="text-[11px] text-fg-muted">Class picked at Register</span>
                            ) : (
                              <span className="text-[12px] text-fg-secondary">{unit.progressLabel}</span>
                            )}
                            {unit.closedShortReason && unit.closedShort > 0 && (
                              <span className="text-[11px] text-fg-muted">Closed short: {unit.closedShortReason}</span>
                            )}
                            {canClose && (
                              <CloseShortButton lineId={unit.id} lineLabel={unit.description} remaining={unit.remaining} />
                            )}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </CardBody>
        </Card>

        <RequestDocumentsCard
          requestId={po.id}
          docs={po.documents}
          canUpload={canAttachToRequest(user.role) && po.state !== "CANCELLED"}
        />

        <NoteThread requestId={po.id} refNo={po.refNo} notes={po.notes} canComment={!viewer} />
      </div>
    </>
  );
}
