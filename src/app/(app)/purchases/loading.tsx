import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

export default function PurchasesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-24" />)}
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} columns={7} />)}
      </div>
    </div>
  );
}
