import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getAsset } from "@/server/modules/inventory/queries";
import { fmtDate } from "@/lib/format";
import { DocumentsPanel, type DocumentRow } from "@/components/inventory/documents-panel";

export default async function AssetDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const docs = await prisma.assetDocument.findMany({
    where: { assetId: id },
    include: { uploadedBy: true },
    orderBy: { createdAt: "desc" },
  });

  const rows: DocumentRow[] = docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    fileName: d.fileName,
    signed: d.signed,
    uploadedBy: d.uploadedBy?.name ?? "system",
    at: fmtDate(d.createdAt),
    downloadHref: `/inventory/${id}/documents/${d.id}/download`,
  }));

  return (
    <DocumentsPanel
      assetId={id}
      docs={rows}
      canMutate={user.role === "admin" || user.role === "it_staff"}
    />
  );
}
