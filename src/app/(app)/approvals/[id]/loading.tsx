import { Skeleton } from "@/components/ui/skeleton";

/** Phase 40 (spec §9): an approval's own skeleton — the header, then the two-column body (Before → after, checks). */
export default function ApprovalLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 pb-1">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="grid max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
