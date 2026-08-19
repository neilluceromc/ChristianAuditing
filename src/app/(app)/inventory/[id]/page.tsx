import { notFound } from "next/navigation";
import { getAsset } from "@/server/modules/inventory/queries";
import { warrantyProgress } from "@/lib/asset-rules";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status";
import { Banner } from "@/components/ui/banner";
import { Pill } from "@/components/ui/pill";
import { REPAIR_STAGE_LABEL, downDays, quoteWarning, repairStage } from "@/lib/repairs";

export default async function AssetOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const warranty = warrantyProgress(asset.purchasedAt, asset.warrantyUntil);
  const cost = asset.cost === null ? null : Number(asset.cost);
  const quote = asset.repairQuote === null ? null : Number(asset.repairQuote);
  const stage = repairStage({
    status: asset.status,
    vendorId: asset.vendorId,
    rmaRef: asset.rmaRef,
    repairQuote: quote,
    cost,
    defectiveSince: asset.defectiveSince,
  });
  const warning = quoteWarning(quote, cost);
  const down = downDays(asset);

  return (
    <div className="grid max-w-[860px] grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Tag", value: asset.tag, mono: true },
              { label: "Model", value: asset.model },
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
      {stage !== null && (
        <Card className="lg:col-span-2">
          <CardHeader
            title="Repair"
            actions={<Pill tone={stage === "returned-ok" ? "neutral" : "accent"}>{REPAIR_STAGE_LABEL[stage]}</Pill>}
          />
          <CardBody className="flex flex-col gap-3">
            {warning && <Banner tone="attention" title="Repairing costs too much of a new unit">{warning}</Banner>}
            <DescriptionList
              items={[
                { label: "Down", value: down === null ? "clock stopped" : `${down} d out of service`, mono: true },
                { label: "Defective since", value: fmtDate(asset.defectiveSince), mono: true },
                { label: "Vendor", value: asset.vendor?.name ?? "—" },
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
