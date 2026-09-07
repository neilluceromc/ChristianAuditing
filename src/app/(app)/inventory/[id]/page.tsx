import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset, stageOf } from "@/server/modules/inventory/queries";
import { warrantyProgress } from "@/lib/asset-rules";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status";
import { Banner } from "@/components/ui/banner";
import { Pill } from "@/components/ui/pill";
import { CreatedNotice } from "@/components/inventory/created-notice";
import { REPAIR_STAGE_LABEL, downDays, quoteWarning } from "@/lib/repairs";

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

  return (
    <div className="grid max-w-[860px] grid-cols-1 gap-4 lg:grid-cols-2">
      {sp.get("created") === "1" && (
        <div className="lg:col-span-2">
          <CreatedNotice tag={asset.tag} id={asset.id} />
        </div>
      )}
      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Tag", value: asset.tag, mono: true },
              { label: "Model", value: asset.model },
              { label: "Brand", value: asset.brand ?? "—" },
              { label: "Serial", value: asset.serial ?? "—", mono: true },
              { label: "Category", value: asset.category.name },
              { label: "Type", value: asset.type?.name ?? "—" },
              { label: "Status", value: <StatusPill value={asset.status} /> },
              {
                label: "Assigned",
                value: asset.assignee ? (
                  <a href={`/employees/${asset.assignee.id}`} className="text-accent hover:underline">
                    {asset.assignee.name} · {asset.assignee.employeeNo}
                  </a>
                ) : ("—"),
              },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Procurement & warranty" />
        <CardBody>
          <DescriptionList
            items={[
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
                            ? `${down} d out of service`
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
