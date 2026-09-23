import { Skeleton } from "@/components/ui/skeleton";

/** Phase 25 (spec §6.2): the record layout keeps its own header and tabs mounted — only the tab body suspends, so only the body gets a skeleton (final review I-1). */
export default function AssetRecordLoading() {
  return (
    <div className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
    </div>
  );
}
