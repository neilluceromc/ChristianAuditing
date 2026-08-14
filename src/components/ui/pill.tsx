import { cn } from "@/lib/cn";

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "accent";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]",
        tone === "accent"
          ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
          : "border-border bg-border-faint text-fg-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}
