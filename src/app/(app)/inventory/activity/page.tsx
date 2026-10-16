import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { ActivityListPage } from "@/components/patterns/activity-list-page";

export const metadata: Metadata = { title: pageTitle("Inventory activity") };

export default async function InventoryActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ActivityListPage feed="inventory" title="Inventory activity" base="/inventory/activity" emptyTitle="Nothing has happened yet" searchParams={searchParams} />;
}
