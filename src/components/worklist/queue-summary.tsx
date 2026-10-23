import { cn } from "@/lib/cn";
import type { WorkStat } from "@/lib/worklist";

/**
 * The open queue's heading, what it is for, and its two to four figures (plan call 13, `sectionStats`). "Over 90
 * days" is bold, never red; only Overdue and Past SLA read red, and only above 0.
 */
export function QueueSummary({ id, title, blurb, stats }: { id: string; title: string; blurb: string; stats: WorkStat[] }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pb-2.5 pt-3">
      <div className="min-w-0 flex-1">
        {/* tabIndex -1: focus's last resort after a decision (fix round 1, I1) */}
        <h2 id={id} tabIndex={-1} className="text-[15px] font-semibold leading-tight text-fg outline-offset-2">{title}</h2>
        <p className="mt-0.5 truncate text-[12.5px] text-fg-muted" title={blurb}>{blurb}</p>
      </div>
      <dl className="flex gap-5 text-right">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[11.5px] text-fg-muted">{s.label}</dt>
            <dd
              className={cn(
                "text-[15px] tabular-nums leading-tight",
                s.tone === "fault" ? "font-semibold text-(--st-fault-text)" : s.tone === "strong" ? "font-bold text-fg" : "font-medium text-fg",
              )}
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
