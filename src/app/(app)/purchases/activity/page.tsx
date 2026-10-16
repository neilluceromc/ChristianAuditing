import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { ActivityListPage } from "@/components/patterns/activity-list-page";

export const metadata: Metadata = { title: pageTitle("Purchasing activity") };

export default async function PurchasingActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ActivityListPage
      feed="purchases"
      title="Purchasing activity"
      base="/purchases/activity"
      emptyTitle="Nothing has happened yet"
      emptyDescription="Drafts, submissions and decisions all land here."
      searchParams={searchParams}
    />
  );
}
