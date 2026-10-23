import Link from "next/link";
import { cn } from "@/lib/cn";
import type { WorkStat } from "@/lib/worklist";

/**
 * The open queue's heading, what it is for, and its two to four figures (plan call 13, `sectionStats`). "Over 90
 * days" is bold, never red; only Overdue and Past SLA read red, and only above 0.
 */
export function QueueSummary({ id, title, blurb, stats, link }: {
  id: string;
  title: string;
  blurb: string;
  stats: WorkStat[];
  /** a way to the queue's own list beside its title (final review M4: Purchase reviews → Purchase orders) */
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pb-2.5 pt-3">
      <div className="min-w-0 flex-1">
        {/* tabIndex -1: focus's last resort after a decision (fix round 1, I1) */}
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id={id} tabIndex={-1} className="text-[15px] font-semibold leading-tight text-fg outline-offset-2">{title}</h2>
          {link && (
            <Link href={link.href} className="relative after:absolute after:inset-x-0 after:-inset-y-3 after:content-[''] text-[12.5px] font-medium text-accent hover:underline">
              {link.label}
            </Link>
          )}
        </div>
        {/* polish: up to two lines, never cut short on one. Its height follows the summary's width only, never the
            rows below, so the rows-per-page measurement settles once. No room is reserved, and the lines are 16 px:
            two of them cost 11 px more than the old single line, which still leaves six rows fitting at 1280×720 */}
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-4 text-fg-muted" title={blurb}>{blurb}</p>
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
