import { cn } from "@/lib/cn";
import type { LifeStage } from "@/lib/finance-list";

/** The bar's fill per stage: accent while mid-life, amber with 6 months or less left, neutral once fully written off. */
const FILL: Record<LifeStage["key"], string> = {
  mid: "bg-accent",
  soon: "bg-(--st-attention-dot)",
  full: "bg-(--st-neutral-dot)",
  notstarted: "",
};

/**
 * Phase 47 (spec §3 item 6): the table's Life used cell — a bar with "14 / 36 mo · 22 left" under it while the asset
 * depreciates (or once it is fully depreciated), otherwise the text state alone ("Starts when approved", "Expensed,
 * not depreciated", "No cost yet"). The bar is decoration: the words say the same thing. No hooks, so a Server or
 * Client Component can render it.
 */
export function LifeCell({ stage }: { stage: LifeStage }) {
  if (stage.usedPct === null) {
    return (
      <span data-life={stage.key} className="block truncate text-[12.5px] text-fg-muted" title={stage.text}>
        {stage.text}
      </span>
    );
  }
  return (
    <span data-life={stage.key} className="flex min-w-0 flex-col gap-1 dense:flex-row dense:items-center dense:gap-2">
      <span aria-hidden className="block h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-surface-subtle ring-1 ring-inset ring-border-faint dense:w-16">
        <span className={cn("block h-full rounded-full", FILL[stage.key])} style={{ width: `${stage.usedPct}%` }} />
      </span>
      <span className="truncate text-[12px] leading-4 tabular-nums text-fg-secondary">{stage.text}</span>
    </span>
  );
}
