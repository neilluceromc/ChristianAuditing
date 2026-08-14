import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded-[4px]", className)}
      style={{
        background:
          "linear-gradient(90deg, var(--border-faint) 25%, var(--surface-subtle) 45%, var(--border-faint) 65%)",
        backgroundSize: "220px 100%",
        animation: "shim 1.2s linear infinite",
      }}
    />
  );
}

/** A table-row skeleton that matches --row-h exactly so the swap is a cross-fade, not a jump. */
export function SkeletonRow({ columns = 4 }: { columns?: number }) {
  return (
    <div
      className="flex items-center gap-4 border-b border-border-faint px-3"
      style={{ height: "var(--row-h)" }}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={i === 1 ? "h-3 flex-1" : "h-3 w-20"} />
      ))}
    </div>
  );
}
