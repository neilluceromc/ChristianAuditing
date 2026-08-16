import { notFound } from "next/navigation";
import { getAsset } from "@/server/modules/inventory/queries";
import { warrantyProgress } from "@/lib/asset-rules";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status";

export default async function AssetOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const warranty = warrantyProgress(asset.purchasedAt, asset.warrantyUntil);

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
              ...(asset.vendor || asset.rmaRef || asset.repairQuote
                ? [
                    { label: "Vendor", value: asset.vendor?.name ?? "—" },
                    { label: "RMA", value: asset.rmaRef ?? "—", mono: true },
                    { label: "Quote", value: fmtMoney(asset.repairQuote === null ? null : Number(asset.repairQuote)), mono: true },
                  ]
                : []),
              { label: "Notes", value: asset.notes ?? "—" },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
