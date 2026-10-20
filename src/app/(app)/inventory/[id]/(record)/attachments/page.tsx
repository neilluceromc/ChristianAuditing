import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/page-title";
import { assetTagFor } from "@/server/page-titles";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { assetAttachments } from "@/server/modules/assets/queries";
import { canPostOnAsset } from "@/lib/asset-notes";
import { parseRecordAttachmentState, recordAttachmentsHref } from "@/lib/inventory-record";
import { toSearchParams } from "@/lib/url-state";
import { AttachmentsTab } from "@/components/assets/attachments-tab";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Attachments", await assetTagFor(id)) };
}

/**
 * Phase 47 (spec §4.2a): the asset's shared Attachments on the Inventory record — the same list, filters and preview
 * as the Finance asset page, with no money in them. `hrefFor` is built here (this is a Server Component, so only
 * strings reach the client parts); the kind filter and the open file are `?ak=` and `?att=` on this route. Read for
 * anyone who can see the asset's class; the upload area only where `canPostOnAsset` allows.
 */
export default async function AssetAttachmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const state = parseRecordAttachmentState(toSearchParams(await searchParams));
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();
  const attachments = await assetAttachments(asset.id);
  return (
    <AttachmentsTab
      assetId={asset.id}
      attachments={attachments}
      canUpload={canPostOnAsset(user.role, asset.cls)}
      kind={state.ak}
      selectedId={state.att}
      hrefFor={(patch) => recordAttachmentsHref(asset.id, state, patch)}
    />
  );
}
