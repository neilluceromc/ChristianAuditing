import { ActivityListPage } from "@/components/patterns/activity-list-page";

export default async function FinanceActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ActivityListPage
      feed="finance"
      title="Finance activity"
      base="/finance/activity"
      emptyTitle="No money has moved yet"
      emptyDescription="Purchase decisions and changes to an asset's cost both land here."
      searchParams={searchParams}
    />
  );
}
