import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { assetTagFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { fmtDate } from "@/lib/format";
import { SecretsPanel } from "@/components/inventory/secrets-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Secrets", await assetTagFor(id)) };
}

export default async function AssetSecretsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();
  // A car has no credentials. 404 rather than 403: the tab is not rendered
  // for this class, so a request here is a typed URL, and "there is nothing
  // here" is the true answer.
  if (asset.cls === "PURCHASING") notFound();
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
