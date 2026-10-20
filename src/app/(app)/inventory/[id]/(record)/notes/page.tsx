import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/page-title";
import { assetTagFor } from "@/server/page-titles";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { assetNotes } from "@/server/modules/assets/queries";
import { canPostOnAsset } from "@/lib/asset-notes";
import { NotesTab } from "@/components/assets/notes-tab";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Notes", await assetTagFor(id)) };
}

/**
 * Phase 47 (spec §4.2a): the asset's shared Notes on the Inventory record — the same thread set and components as the
 * Finance asset page, with no money in them. Read for anyone who can see the asset's class (`getVisibleAsset`); the
 * compose, reply and resolve controls only where `canPostOnAsset` allows, and the actions refuse otherwise.
 */
export default async function AssetNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();
  const threads = await assetNotes(asset.id);
  return <NotesTab assetId={asset.id} threads={threads} canPost={canPostOnAsset(user.role, asset.cls)} />;
}
