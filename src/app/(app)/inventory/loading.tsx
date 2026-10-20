import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

/** Roughly the default columns: Tag, Serial number, Model (the rest), Category, Assigned, Status. */
const COLUMNS = ["w-24", "w-28", "flex-1", "w-24", "w-36", "w-32"];

/**
 * Phase 45 (spec §2): the Inventory list while it loads - the header, the view pills, the count tiles, the toolbar
 * row and a striped table at the list's own head and row heights (`--list-head-h`, `--list-row-h`), so the swap does
 * not jump. Six tiles, as in the IT view.
 */
export default function InventoryLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-44" />
      </div>
      {/* the view pills (Repairs) */}
      <Skeleton className="h-7 w-20 rounded-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-28 max-w-full" />
          </div>
        ))}
      </div>
      {/* search, Category, More filters and Columns, then the count on the right */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-[300px]" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
        <span className="flex-1" />
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card">
        <div className="flex items-center gap-8 border-b border-border px-5" style={{ height: "var(--list-head-h)" }}>
          {COLUMNS.map((w, i) => (
            <span key={i} className={cn("shrink-0", w)}>
              <Skeleton className="h-2.5 w-12 max-w-full" />
            </span>
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, row) => (
          <div
            key={row}
            className={cn("flex items-center gap-8 px-5", row % 2 === 1 && "bg-zebra")}
            style={{ height: "var(--list-row-h)" }}
          >
            {COLUMNS.map((w, i) => (
              <span key={i} className={cn("shrink-0", w)}>
                <Skeleton className={cn("h-3", i === 2 ? "w-48 max-w-full" : "w-full")} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
