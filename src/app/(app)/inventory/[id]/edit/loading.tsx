import { Skeleton } from "@/components/ui/skeleton";

/**
 * Phase 30 (plan P-15): Edit sits outside the record's (record) route group, so it no longer
 * inherits the record's loading boundary — this is its own, shaped like the form it replaces:
 * a title, then labelled fields in a card.
 */
export default function EditAssetLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-6 w-48" />
      <div className="flex flex-col gap-4 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div>
  );
}
