import { Skeleton } from "@/components/ui/skeleton";

/** Phase 40 (spec §9): the shell skeleton for any page without its own — a header bar, then card blocks. */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
