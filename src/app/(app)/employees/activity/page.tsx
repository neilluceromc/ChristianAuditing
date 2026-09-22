import { ActivityListPage } from "@/components/patterns/activity-list-page";

export default async function EmployeeActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ActivityListPage feed="employees" title="Employee activity" base="/employees/activity" emptyTitle="Nothing has happened yet" searchParams={searchParams} />;
}
