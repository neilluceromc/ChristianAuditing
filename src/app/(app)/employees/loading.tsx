import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

/** Roughly the table's own columns: Employee (the rest), Works for, Loadout, Items, Employment, Joined. */
const COLUMNS = ["flex-1", "w-40", "w-20", "w-8", "w-24", "w-20"];
/** The tabs: All, Client staff, Internal staff, Leaving, Missing kit, New this month. */
const TABS = ["w-8", "w-24", "w-24", "w-16", "w-20", "w-28"];

/**
 * Phase 45 (spec §3): the Employees list while it loads - the header, the tabs row, the toolbar row and a striped
 * table at the list's own head and row heights (`--list-head-h`, `--list-row-h`), so the swap does not jump.
 */
export default function EmployeesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between pb-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="flex gap-[22px] overflow-hidden border-b border-border pb-3">
        {TABS.map((w, i) => (
          <Skeleton key={i} className={cn("h-4", w)} />
        ))}
      </div>
      {/* search and Works for, then the count and Row size on the right */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-[260px]" />
        <Skeleton className="h-9 w-28" />
        <span className="flex-1" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-24" />
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
                <Skeleton className={cn("h-3", i === 0 ? "w-48 max-w-full" : "w-full")} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
