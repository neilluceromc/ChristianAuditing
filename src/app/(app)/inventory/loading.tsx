import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function InventoryLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-[260px]" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonRow key={i} columns={7} />
        ))}
      </div>
    </div>
  );
}
