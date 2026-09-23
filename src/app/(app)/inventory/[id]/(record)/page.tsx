import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset, stageOf } from "@/server/modules/inventory/queries";
import { warrantyProgress } from "@/lib/asset-rules";
import { CLASS_LABEL, canRegisterClass, isAwaitingItCheck } from "@/lib/asset-class";
import { PROVENANCE_LABEL, provenanceOf } from "@/lib/provenance";
import { fmtDate, fmtMoney, localDateISO } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ProgressBar } from "@/components/ui/progress-bar";
import { DuePill } from "@/components/ui/due-pill";
import { Banner } from "@/components/ui/banner";
import { Pill } from "@/components/ui/pill";
import { CreatedNotice } from "@/components/inventory/created-notice";
import { REPAIR_STAGE_LABEL, downDays, quoteWarning } from "@/lib/repairs";
import { statusFamily } from "@/lib/status";

export default async function AssetOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();
  const warranty = warrantyProgress(asset.purchasedAt, asset.warrantyUntil);
  const cost = asset.cost === null ? null : Number(asset.cost);
  const quote = asset.repairQuote === null ? null : Number(asset.repairQuote);
  // the same mapper the list and the bulk/export cut use, so a record can
  // never disagree with the row that led to it
  const stage = stageOf(asset);
  const warning = quoteWarning(quote, cost);
  const down = downDays(asset);
  const provenance = provenanceOf(asset);
  // Spec §4.4: what the header used to say in three pills — the class, where
  // the record came from, and where Finance stands — now one Record row.
  const financeState = asset.financeConfirmedAt
    ? `Finance confirmed · ${fmtDate(asset.financeConfirmedAt)}`
    : asset.financeReturnedAt
      ? "Returned by Finance"
      : isAwaitingItCheck(asset)
        ? "Awaiting IT check"
        : "Awaiting Finance";

  return (
    <div className="grid max-w-[860px] grid-cols-1 gap-4 lg:grid-cols-2">
      {sp.get("created") === "1" && (
        <div className="lg:col-span-2">
          <CreatedNotice tag={asset.tag} id={asset.id} cls={asset.cls} canRegister={canRegisterClass(user.role, asset.cls)} />
        </div>
      )}
      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          {/* Spec §4.4: tag, status, model and holder live in the header only. */}
          <DescriptionList
            items={[
              { label: "Brand", value: asset.brand ?? "—" },
              { label: "Serial", value: asset.serial ?? "—", mono: true },
              { label: "Category", value: asset.category.name },
              { label: "Type", value: asset.type?.name ?? "—" },
              ...(asset.status === "TEMPORARY"
                ? [{
                    label: "Loan until",
                    // the same day the header's loan line reads (LoanLine)
                    value: asset.loanDueAt ? (
                      <DuePill
                        dueAt={new Date(asset.loanDueAt.toISOString().slice(0, 10) + "T00:00:00Z")}
                        today={localDateISO(new Date())}
                        withDate
                      />
                    ) : "No due date",
                  }]
                : []),
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Procurement & warranty" />
        <CardBody>
          <DescriptionList
            items={[
              {
                label: "Record",
                value: (
                  <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span>{CLASS_LABEL[asset.cls]}</span>
                    <span aria-hidden className="text-fg-muted">·</span>
                    {asset.purchaseRequest ? (
                      <Link href={`/purchases/${asset.purchaseRequest.id}`} className="text-accent hover:underline">
                        From {asset.purchaseRequest.refNo}
                      </Link>
                    ) : (
                      // The label map stays "Historical import" (facet, export,
                      // Finance use it); only the record spells out the gap.
                      <span>
                        {PROVENANCE_LABEL[provenance]}
                        {provenance === "HISTORICAL" && " · no purchase request"}
                      </span>
                    )}
                    <span aria-hidden className="text-fg-muted">·</span>
                    <span>{financeState}</span>
                  </span>
                ),
              },
              { label: "Purchased", value: fmtDate(asset.purchasedAt), mono: true },
              { label: "Cost", value: fmtMoney(asset.cost === null ? null : Number(asset.cost)), mono: true },
              { label: "Vendor", value: asset.vendor?.name ?? "—" },
              { label: "Invoice / receipt no.", value: asset.invoiceRef ?? "—", mono: true },
              {
                label: "Warranty",
                value: warranty ? (
                  <span className="flex w-full max-w-[240px] flex-col gap-1">
                    <span className="font-mono text-xs">{fmtDate(asset.warrantyUntil)} · {warranty.label}</span>
                    <ProgressBar value={warranty.pct} label="Warranty elapsed" />
                  </span>
                ) : ("—"),
              },
              { label: "Notes", value: asset.notes ?? "—" },
            ]}
          />
        </CardBody>
      </Card>
      {/*
        Gated on having repair DATA, not on having a stage. Approvals gate the
        status change, so the normal order is to record the vendor's quote first
        and request DEFECTIVE second — and an asset with a quote but no stage
        yet would otherwise hide the quote and the write-off banner from the
        record, precisely while someone is deciding replace-versus-repair. That
        is what this page showed before repair mode existed.
      */}
      {(stage !== null || asset.rmaRef || quote !== null) && (
        <Card className="lg:col-span-2">
          <CardHeader
            title="Repair"
            actions={
              stage && <Pill tone={stage === "returned-ok" ? "neutral" : "accent"}>{REPAIR_STAGE_LABEL[stage]}</Pill>
            }
          />
          <CardBody className="flex flex-col gap-3">
            {warning && <Banner tone="attention" title="Repairing costs too much of a new unit">{warning}</Banner>}
            <DescriptionList
              items={[
                // the clock rows belong to a stage; RMA/quote belong to the data
                // (Vendor lives in Procurement & warranty now — shown once, not here)
                ...(stage !== null
                  ? [
                      {
                        label: "Down",
                        // null means two different things and only one is "stopped"
                        value:
                          down !== null
                            ? asset.status === "DEFECTIVE"
                              ? `${down} d out of service`
                              : statusFamily(asset.status) === "closed"
                                ? `down ${down} d, closed ${fmtDate(asset.repairEndedAt)}`
                                : `down ${down} d, back since ${fmtDate(asset.repairEndedAt)}`
                            : asset.status === "DEFECTIVE"
                              ? "start date unknown"
                              : "clock stopped",
                        mono: true,
                      },
                      { label: "Defective since", value: fmtDate(asset.defectiveSince), mono: true },
                    ]
                  : []),
                { label: "RMA", value: asset.rmaRef ?? "—", mono: true },
                { label: "Quote", value: fmtMoney(quote), mono: true },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
