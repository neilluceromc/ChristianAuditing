import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { redirect } from "next/navigation";
import { toSearchParams } from "@/lib/url-state";
import { parseCls } from "@/lib/asset-class";

export const metadata: Metadata = { title: pageTitle("Register assets") };

/**
 * Phase 30 (spec §5.1): one Register flow. `/inventory/new` is kept as a
 * redirect so bookmarks and older links still land on the form, with the
 * class they named (`?cls=PURCHASING` survives). The Register page does its
 * own role check, so a role that may not register ends where it always did.
 */
export default async function NewAssetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cls = parseCls(toSearchParams(await searchParams).get("cls"));
  redirect("/inventory/register" + (cls ? `?cls=${cls}` : ""));
}
