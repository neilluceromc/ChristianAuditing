import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { groupDetail, groupUndoBanner, type GroupAsset } from "@/server/modules/finance/groups";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import { fieldLabels } from "@/lib/registration";
import { poControls } from "@/lib/po-controls";
import { previewKind } from "@/lib/finance-asset-page";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { RequestDocumentsCard } from "@/components/purchases/request-documents-card";
import { FixMoneyButton } from "@/components/finance/fix-money-dialog";
import { GroupDocsUpload, GroupReview, SendBackPoButton, type GroupReviewAsset } from "@/components/finance/group-review";
import { PoSendBackUndoBanner } from "@/components/finance/po-undo-banner";
import { poSendBackUndoBanner } from "@/server/modules/purchases/po-undo";

export async function generateMetadata({ params }: { params: Promise<{ recordId: string }> }): Promise<Metadata> {
  const { recordId } = await params;
  const record = await prisma.purchaseRecord.findUnique({
    where: { id: recordId }, select: { purchaseOrder: { select: { refNo: true } } },
  });
  return { title: pageTitle(record?.purchaseOrder?.refNo ?? "Registration", "To review") };
}

const TEAM_LABEL = { IT: "IT", PURCHASING: "Purchasing" } as const;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const text = (v: string | null | undefined) => (v ? v : "Not recorded");

function returnLine(a: GroupAsset): string | null {
  if (!a.returnedTo) return null;
  const items = fieldLabels(a.returnFields).join(", ");
  return `Sent back to ${TEAM_LABEL[a.returnedTo]}${items ? `: ${items}` : ""}${a.returnNote ? ` — “${a.returnNote}”` : ""}`;
}

/**
 * Task 6 (spec §5): one registration group, reviewed in one go — the money (the PO's: it lives there, and a fix flows
 * to every asset from it), its documents with a preview, every asset with its state, the totals, and Approve N with
 * per-asset hold-back and "Not capitalised". `?doc=<id>` opens a document in the preview.
 */
export default async function GroupReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ recordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "finance_staff");
  const { recordId } = await params;
  const sp = toSearchParams(await searchParams);
  const now = new Date();
  const [g, undo] = await Promise.all([groupDetail(recordId), groupUndoBanner(recordId, user.id, now)]);
  if (!g) notFound();
  // Task 6 fix round 1: the PO's send-back, for the person who sent it, for 15 minutes.
  const sendBackUndo = g.po?.state === "SENT_BACK" ? await poSendBackUndoBanner(prisma, g.po.id, user.id, now) : null;

  const vendors = await prisma.vendor.findMany({
    where: { OR: [{ archivedAt: null }, { id: g.money.vendorId ?? "" }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const controls = g.po
    ? poControls({ role: user.role, state: g.po.state, registeredCount: g.po.registeredCount, approvedCount: g.po.approvedCount, lines: [] })
    : null;
  const blocked = g.po?.state === "SENT_BACK"
    ? `${g.refNo} is with Purchasing for corrections.`
    : g.po && !g.money.invoiceRef?.trim()
      ? "No SI number yet. Add it before approving."
      : null;

  const assets: GroupReviewAsset[] = g.assets.map((a) => ({
    id: a.id, tag: a.tag, serial: a.serial, brand: a.brand, model: a.model, cls: a.cls, cost: a.cost, reg: a.reg,
    regLabel: a.regLabel, returnLine: returnLine(a), resubmitNote: a.resubmitNote,
    // A direct group's money is each asset's own (fix round 1): one fixed since registration keeps its new values.
    money: g.po ? null : {
      id: a.id, tag: a.tag, cost: a.cost, vendorId: a.money.vendorId, invoiceRef: a.money.invoiceRef,
      receiptRef: a.money.receiptRef, purchasedAt: day(a.money.purchasedAt),
    },
  }));

  const openDoc = sp.get("doc") ? g.docs.find((d) => d.id === sp.get("doc")) ?? null : null;
  const base = `/finance/review/${recordId}`;
  const title = g.refNo ?? "Direct registration";

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={[{ label: "To review", href: "/finance/review" }, { label: title }]}
      />
      {sendBackUndo && g.po && <PoSendBackUndoBanner poId={g.po.id} state={sendBackUndo} />}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={g.po ? "Money details" : "Money details · as registered"} />
            {g.po && (controls?.fix || controls?.sendBack) && (
              // Spec §5: a PO group's money is the PO's — fixed there (it flows to every asset from it) or sent back.
              <div className="flex flex-wrap gap-2 border-b border-border-faint px-4 py-3">
                {controls.fix && (
                  <FixMoneyButton
                    vendors={vendors}
                    target={{
                      kind: "po",
                      po: {
                        id: g.po.id, refNo: g.refNo!, vendorId: g.money.vendorId, invoiceRef: g.money.invoiceRef,
                        receiptRef: g.money.receiptRef, purchasedAt: day(g.money.purchasedAt), fees: g.money.fees,
                      },
                      lines: g.po.lines.map((l, i) => ({ id: l.id, index: i + 1, description: l.description, unitPrice: l.unitPrice })),
                    }}
                  />
                )}
                {controls.sendBack && <SendBackPoButton id={g.po.id} refNo={g.refNo!} />}
              </div>
            )}
            <CardBody className="flex flex-col gap-2">
              {g.moneyVaries && (
                <p className="text-xs text-fg-muted">
                  {g.po
                    ? `Some assets' money differs from ${g.refNo}'s — fix it on ${g.refNo} to bring them back in line.`
                    : "Some assets were fixed since registration: each row's Fix money shows that asset's own values."}
                </p>
              )}
              <DescriptionList
                items={[
                  {
                    label: "Purchase order",
                    value: g.po ? <Link href={`/purchases/${g.po.id}`} className="text-accent hover:underline">{g.refNo}</Link> : "None — registered directly",
                  },
                  { label: "Supplier", value: text(g.money.supplier) },
                  {
                    label: "SI number",
                    value: g.money.invoiceRef ? g.money.invoiceRef : <span className="text-[var(--st-fault-text)]">Missing</span>,
                    mono: true,
                  },
                  { label: "OR number", value: text(g.money.receiptRef), mono: true },
                  { label: "Purchase date", value: g.money.purchasedAt ? fmtDate(g.money.purchasedAt) : "Not recorded" },
                  { label: "Registered", value: `${fmtDate(g.registeredAt)} by ${g.registeredBy} (${TEAM_LABEL[g.team]})` },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Totals" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Assets", value: `${g.totals.count} · ${g.totals.withFinance} to review · ${g.totals.approved} approved` },
                  { label: "Cost", value: fmtMoneyExact(g.totals.cost), mono: true },
                  { label: g.po ? "Fees (PO)" : "Fees", value: fmtMoneyExact(g.totals.fees), mono: true },
                  { label: "Total", value: fmtMoneyExact(g.totals.total), mono: true },
                ]}
              />
            </CardBody>
          </Card>
          {g.po ? (
            <RequestDocumentsCard
              requestId={g.po.id}
              canUpload={g.po.state !== "CANCELLED"}
              docs={g.docs.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, uploadedBy: d.uploadedBy, at: d.at, downloadHref: d.downloadHref }))}
            />
          ) : (
            <Card>
              <CardHeader title="Documents" />
              <CardBody className="flex flex-col gap-3">
                {g.docs.length === 0 && <p className="py-2 text-center text-xs text-fg-muted">No documents yet.</p>}
                <GroupDocsUpload assetIds={g.assets.map((a) => a.id)} />
              </CardBody>
            </Card>
          )}
          {g.docs.some((d) => d.previewHref) && (
            <Card>
              <CardHeader title="Preview" />
              <CardBody className="flex flex-col gap-1.5">
                {g.docs.filter((d) => d.previewHref).map((d) => (
                  <Link
                    key={d.id} href={`${base}?doc=${encodeURIComponent(d.id)}`} scroll={false}
                    aria-current={openDoc?.id === d.id ? "true" : undefined}
                    className="truncate text-[13px] text-accent hover:underline aria-[current=true]:font-medium"
                    title={d.fileName}
                  >
                    {d.label} · {d.fileName}
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {openDoc?.previewHref && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border-faint px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-fg-muted">{openDoc.label}</p>
                  <p className="truncate text-[13px] font-medium text-fg" title={openDoc.fileName}>{openDoc.fileName}</p>
                </div>
                <ButtonLink native size="sm" href={openDoc.downloadHref}>Download</ButtonLink>
                <ButtonLink size="sm" variant="ghost" href={base}>Close<span className="sr-only"> the preview</span></ButtonLink>
              </div>
              {previewKind(openDoc.fileName) === "pdf" ? (
                <iframe title={`Preview of ${openDoc.fileName}`} src={openDoc.previewHref} className="block h-[520px] w-full bg-surface-subtle" />
              ) : (
                <div className="flex justify-center bg-surface-subtle p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated route's bytes, not a static asset */}
                  <img src={openDoc.previewHref} alt={openDoc.fileName} className="max-h-[520px] max-w-full object-contain" />
                </div>
              )}
            </Card>
          )}

          {!g.po && g.docs.length > 0 && (
            <Table>
              <THead>
                <Tr>
                  <Th>Kind</Th>
                  <Th>File</Th>
                  <Th>Uploaded by</Th>
                  <Th>Date</Th>
                  <Th aria-label="Download" />
                </Tr>
              </THead>
              <TBody>
                {g.docs.map((d) => (
                  <Tr key={d.id}>
                    <Td>{d.label}</Td>
                    <Td><span className="block max-w-[16rem] truncate" title={d.fileName}>{d.fileName}</span></Td>
                    <Td>{d.uploadedBy}</Td>
                    <Td mono>{d.at}</Td>
                    <Td align="right"><a href={d.downloadHref} className="text-accent hover:underline">Download</a></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}

          <GroupReview
            recordId={recordId}
            refNo={g.refNo}
            registeredByRole={g.registeredByRole}
            blocked={blocked}
            assets={assets}
            undo={undo}
            canReopen={user.role === "admin" && g.totals.approved > 0}
            vendors={vendors}
          />
        </div>
      </div>
    </>
  );
}
