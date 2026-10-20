import Link from "next/link";
import type { Ranked } from "@/lib/overview";
import { fmtValue } from "./chart-math";
import { Panel } from "./panel";

/**
 * Spec §3.1 Row B: the ranked breakdown — one horizontal bar per row in a single colour, scaled to the largest, with
 * its value in words beside it. A row links to its filter where one exists. The track is decorative.
 */
export function RankedBars({ ranked, className }: { ranked: Ranked; className?: string }) {
  const max = Math.max(0, ...ranked.rows.map((r) => r.value));
  return (
    <Panel title={ranked.title} sub={ranked.sub} className={className}>
      {ranked.rows.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-muted">Nothing in this period.</p>
      ) : (
        <ol className="flex flex-col gap-2" data-ranked="">
          {ranked.rows.map((r) => (
            <li
              key={r.label}
              className="grid grid-cols-[minmax(90px,40%)_minmax(0,1fr)_auto] items-center gap-2.5 text-[12.5px] min-[560px]:grid-cols-[minmax(110px,38%)_minmax(0,1fr)_auto]"
            >
              {r.href ? (
                <Link href={r.href} className="truncate text-fg-secondary hover:underline">{r.label}</Link>
              ) : (
                <span className="truncate text-fg-secondary">{r.label}</span>
              )}
              <span className="h-2.5 overflow-hidden rounded-[4px] bg-border-faint" aria-hidden="true">
                <span
                  className="block h-full rounded-r-[4px] bg-chart-1"
                  style={{ width: `${max > 0 ? Math.max(0, (r.value / max) * 100) : 0}%` }}
                />
              </span>
              <span className="min-w-[48px] text-right text-fg-secondary tabular-nums">{fmtValue(r.value, ranked.money)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
