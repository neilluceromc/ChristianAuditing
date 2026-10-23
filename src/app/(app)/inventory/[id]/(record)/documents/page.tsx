import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { assetTagFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { assetDocumentRow } from "@/lib/inventory-record";
import { toSearchParams } from "@/lib/url-state";
import { canAttachDocuments, canManageClass } from "@/lib/asset-class";
import { Banner } from "@/components/ui/banner";
import { DocumentsPanel, type DocumentRow } from "@/components/inventory/documents-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Documents", await assetTagFor(id)) };
}

export default async function AssetDocumentsPage({
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
  const docs = await prisma.assetDocument.findMany({
    where: { assetId: id },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  // each row also carries uploadedAt (ISO) and uploadedBy (a name or null) for the "Uploaded …" line
  const rows: DocumentRow[] = docs.map((d) => assetDocumentRow(id, d));

  // Task 12: the single-asset form redirects here (instead of the record
  // page) when one or more documents chosen at registration failed to
  // upload — the asset itself is registered either way, so this only warns,
  // it never blocks.
  const failed = sp.get("failed");
  const of = sp.get("of");

  return (
    <div className="flex flex-col gap-4">
      {failed && (
        <Banner tone="attention" title={`Registered. ${failed} of ${of} documents did not upload — add them here.`} />
      )}
      <DocumentsPanel
        assetId={id}
        docs={rows}
        canUpload={canAttachDocuments(user.role, asset)}
        canSign={canManageClass(user.role, asset.cls)}
      />
    </div>
  );
}
