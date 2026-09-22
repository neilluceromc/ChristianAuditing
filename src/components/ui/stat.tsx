import { cn } from "@/lib/cn";

/** Phase 27 (spec §5.5, plan P-3): `tone="accent"` colours the value like every other overdue surface; neutral is the default. */
export function Stat({ label, value, hint, tone = "neutral" }: { label: string; value: React.ReactNode; hint?: string; tone?: "neutral" | "accent" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-muted">
        {label}
      </span>
      <span className={cn("font-mono text-lg font-semibold leading-tight", tone === "accent" ? "text-accent" : "text-fg")} data-tone={tone}>{value}</span>
      {hint && <span className="text-[10.5px] text-fg-muted">{hint}</span>}
    </div>
  );
}
