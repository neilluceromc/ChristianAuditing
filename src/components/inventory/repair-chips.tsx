import Link from "next/link";
import { cn } from "@/lib/cn";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { REPAIR_STAGES, REPAIR_STAGE_LABEL, isRepairStage, withRepairStage } from "@/lib/repairs";
import { serializeListState, type ListState } from "@/lib/url-state";

/**
 * Stage chips write the URL rather than filtering the page, because one of them
 * (RETURNED OK) describes assets that are NOT DEFECTIVE — so picking a stage
 * clears the status facet instead of narrowing inside it. `withRepairStage`
 * (src/lib/repairs.ts) owns that rule and is tested for it; a chip that wrote
 * `withFilter(state, "stage", …)` directly would keep the saved view's
 * `status=DEFECTIVE` pin and compose to a query matching nothing.
 */
export function RepairChips({ state }: { state: ListState }) {
  const active = (state.filters.stage ?? []).filter(isRepairStage);
  const href = (next: ListState) => "/inventory" + serializeListState(next, INVENTORY_LIST_CONFIG);
  const chipClass = (on: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
      on
        ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
        : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-fg-faint">stage</span>
      <Link
        href={href(withRepairStage(state, null))}
        aria-current={active.length === 0 ? "page" : undefined}
        className={chipClass(active.length === 0)}
      >
        ALL DEFECTIVE
      </Link>
      {REPAIR_STAGES.map((stage) => {
        const on = active.includes(stage);
        return (
          <Link
            key={stage}
            href={href(withRepairStage(state, on ? null : stage))}
            aria-current={on ? "page" : undefined}
            className={chipClass(on)}
          >
            {REPAIR_STAGE_LABEL[stage]}
          </Link>
        );
      })}
    </div>
  );
}
