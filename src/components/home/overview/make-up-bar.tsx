import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import type { MakeUp, MakeUpTone } from "@/lib/overview";
import { fmtValue } from "./chart-math";
import { Panel } from "./panel";

/**
 * Segment fills: the chart series tokens, the status dots for status rows (which always show an icon and their word),
 * and a plain border grey for `neutral` — not a status token, since a neutral row has no icon to go with one.
 */
const FILL: Record<MakeUpTone, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  warn: "bg-[color:var(--st-attention-dot)]",
  bad: "bg-[color:var(--st-fault-dot)]",
  neutral: "bg-border-strong",
};

/** A status row's legend mark: an icon in the status text colour beside its word (never the colour alone). */
const STATUS_ICON: Partial<Record<MakeUpTone, string>> = {
  warn: "text-[color:var(--st-attention-text)]",
  bad: "text-[color:var(--st-fault-text)]",
};

/**
 * Spec §3.1 Row B: the make-up — one stacked bar (segments 2 px apart) and a legend grid with values. A row with an
 * `href` links both its segment and its legend word to its filter; the segment names itself ("Deployed: 12 assets")
 * with visually hidden text, and the legend link's name is the word alone (it-nav.spec.ts: "Deployed" →
 * /inventory?status=DEPLOYED). The bar is not an image when it holds links; its unlinked segments are decorative, the
 * legend says the same in words. One tab stop per row: the legend word is the keyboard's link, and the segment is
 * taken out of the tab order (`tabIndex={-1}`) but keeps its name, so it is still a named link to pointers and to
 * assistive tech's link lists. The wrapper clips, so a segment draws its focus ring inside itself.
 */
export function MakeUpBar({ makeUp, className }: { makeUp: MakeUp; className?: string }) {
  const rows = makeUp.rows.filter((r) => r.value > 0);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const fmt = (n: number) => fmtValue(n, makeUp.money);
  // a count is named unseparated ("Deployed: 1204 assets", as FleetBar named it); money keeps its ₱ format
  const named = (label: string, value: number) =>
    `${label}: ${makeUp.money ? fmt(value) : String(value)}${makeUp.unit && !makeUp.money ? ` ${makeUp.unit}` : ""}`;
  return (
    <Panel
      title={makeUp.title}
      sub={total > 0 ? `${fmt(total)}${makeUp.unit && !makeUp.money ? ` ${makeUp.unit}` : ""} in all` : undefined}
      className={className}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-muted">Nothing to show yet.</p>
      ) : (
        <>
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[5px]" data-make-up-bar="">
            {rows.map((r) => {
              const style = { width: `${(r.value / total) * 100}%` };
              const cls = cn("block h-full min-w-[2px]", FILL[r.tone]);
              return r.href ? (
                <Link
                  key={r.label}
                  href={r.href}
                  title={named(r.label, r.value)}
                  tabIndex={-1}
                  className={cn(cls, "hover:opacity-80 focus-visible:[outline-offset:-2px]")}
                  style={style}
                >
                  <span className="sr-only">{named(r.label, r.value)}</span>
                </Link>
              ) : (
                <span key={r.label} className={cls} style={style} title={named(r.label, r.value)} aria-hidden="true" />
              );
            })}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] min-[560px]:grid-cols-3">
            {rows.map((r) => (
              <li key={r.label} className="flex min-w-0 items-center gap-[7px]">
                {STATUS_ICON[r.tone] ? (
                  <Icon name="alert" size={12} className={STATUS_ICON[r.tone]} />
                ) : (
                  <span className={cn("size-[9px] shrink-0 rounded-[3px]", FILL[r.tone])} aria-hidden="true" />
                )}
                {r.href ? (
                  <Link href={r.href} className="truncate text-fg-secondary hover:underline">{r.label}</Link>
                ) : (
                  <span className="truncate text-fg-secondary">{r.label}</span>
                )}
                <span className="ml-auto font-medium text-fg tabular-nums">{fmt(r.value)}</span>
              </li>
            ))}
          </ul>
          {makeUp.note && <p className="mt-3 text-[12.5px] text-fg-secondary">{makeUp.note}</p>}
        </>
      )}
    </Panel>
  );
}
