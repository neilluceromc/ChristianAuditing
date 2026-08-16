import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getAsset } from "@/server/modules/inventory/queries";
import { fmtDate } from "@/lib/format";
import { SecretsPanel } from "@/components/inventory/secrets-panel";

export default async function AssetSecretsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  // Ciphertext NEVER leaves the server — the panel gets labels only.
  const secrets = await prisma.assetSecret.findMany({
    where: { assetId: id },
    orderBy: { label: "asc" },
    select: { id: true, label: true, createdAt: true },
  });

  return (
    <SecretsPanel
      assetId={id}
      secrets={secrets.map((s) => ({ id: s.id, label: s.label, createdAt: fmtDate(s.createdAt) }))}
      canReveal={user.role === "admin" || user.role === "it_staff"}
    />
  );
}
