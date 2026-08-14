import { cn } from "@/lib/cn";
import { statusFamily, isSystemFailure } from "@/lib/status";

/**
 * Dot = status as an attribute (dense tables): 7px dot, text elsewhere in the row.
 * Pill = status as the subject (headers, cards, timelines).
 * Closed renders hollow; EXECUTION_FAILED renders a dashed-border diamond.
 */

export function StatusDot({ value, className }: { value: string; className?: string }) {
  const family = statusFamily(value);
  if (isSystemFailure(value)) {
    return (
      <span
        aria-hidden
        className={cn("inline-block size-[7px] rotate-45", className)}
        style={{ background: "var(--st-fault-dot)" }}
      />
    );
  }
  if (family === "closed") {
    return (
      <span
        aria-hidden
        className={cn("inline-block size-[7px] rounded-full", className)}
        style={{ border: "1.5px solid var(--st-closed-ring)", background: "transparent" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-block size-[7px] rounded-full", className)}
      style={{ background: `var(--st-${family}-dot)` }}
    />
  );
}

export function StatusPill({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const family = statusFamily(value);
  const failed = isSystemFailure(value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-(--radius-ctl) px-2 py-0.5",
        "font-mono text-[10px] font-medium uppercase tracking-[0.06em]",
        className,
      )}
      style={{
        background: `var(--st-${family}-bg)`,
        color: `var(--st-${family}-text)`,
        border: failed
          ? "1px dashed var(--st-failed-border)"
          : `1px solid var(--st-${family}-border)`,
      }}
    >
      <StatusDot value={value} className="size-[6px]" />
      {label ?? value}
    </span>
  );
}
