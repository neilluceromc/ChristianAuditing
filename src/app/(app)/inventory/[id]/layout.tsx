import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getAsset } from "@/server/modules/inventory/queries";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { RecordTabs } from "@/components/inventory/record-tabs";
import { RequestStatusChange } from "@/components/inventory/request-status-change";

export default async function AssetRecordLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const pending = asset.approvals[0];

  return (
    <>
      <PageHeader
        title={asset.tag}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: asset.tag }]}
        badge={
          <span className="inline-flex items-center gap-2">
            <StatusPill value={asset.status} />
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          canMutate ? (
            <>
              <RequestStatusChange assetId={asset.id} currentStatus={asset.status} />
              <ButtonLink href={`/inventory/${asset.id}/edit`}>Edit</ButtonLink>
            </>
          ) : undefined
        }
      />
      <p className="-mt-2 pb-3 text-[13px] text-fg-secondary">
        {asset.model}
        {asset.assignee && (
          <>
            {" · held by "}
            <a href={`/employees/${asset.assignee.id}`} className="text-accent hover:underline">
              {asset.assignee.name}
            </a>
          </>
        )}
      </p>
      {pending && (
        <div className="pb-3">
          <Banner
            tone="inflight"
            title={`${pending.refNo} · ${APPROVAL_TYPE_LABEL[pending.type]} is ${pending.state.toLowerCase()}`}
          >
            Queued in the approval pipeline — until it executes, this asset still reads{" "}
            <span className="font-mono">{asset.status}</span> everywhere.
          </Banner>
        </div>
      )}
      <RecordTabs assetId={asset.id} />
      <div className="pt-4">{children}</div>
    </>
  );
}
