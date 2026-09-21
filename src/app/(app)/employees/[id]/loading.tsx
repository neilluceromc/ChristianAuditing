import { Skeleton } from "@/components/ui/skeleton";

export default function EmployeeRecordLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-6 w-56" />
        </div>
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
      </div>
    </div>
  );
}
