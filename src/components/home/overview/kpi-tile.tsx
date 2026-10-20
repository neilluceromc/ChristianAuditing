import Link from "next/link";
import { cn } from "@/lib/cn";
import { deltaTone, type KpiTile as Tile } from "@/lib/overview";
import { deltaWords, kpiValue, sparkPoints } from "./chart-math";
import { Sparkline } from "./sparkline";

const TONE_CLASS = {
  good: "text-[color:var(--st-settled-text)]",
  bad: "text-[color:var(--st-fault-text)]",
  flat: "text-fg-muted",
} as const;

const ARROW = { up: "▲", down: "▼", flat: "—" } as const;

/**
 * The delta line. The arrow is drawn but read as a word ("up 8 vs last week"), so neither the glyph nor the colour
 * carries meaning alone. Spec §2.4 (no made-up history): `none`, or a sparkline of fewer than 2 collected points,
 * reads "collecting history" — except a tile that has no history by design (an empty `spark`, e.g. Flags on), which
 * shows no delta line at all.
 */
export function KpiDelta({ tile }: { tile: Tile }) {
  if (tile.spark.length === 0) return null;
  const words = deltaWords(tile.delta);
  if (!words || sparkPoints(tile.spark) < 2) {
    return <span className="min-w-0 text-[12px] text-fg-muted" data-delta="none">collecting history</span>;
  }
  const tone = deltaTone(tile);
  return (
    // a block that wraps: "▲ 12% this week vs last week" is wider than a 6-across tile
    <span className={cn("min-w-0 text-[12px] font-medium leading-snug", TONE_CLASS[tone])} data-delta={tone}>
      <span aria-hidden="true">{ARROW[words.dir]}</span>{" "}
      {words.dir !== "flat" && <span className="sr-only">{words.dir} </span>}
      <span>{words.text}</span>
    </span>
  );
}

/**
 * Spec §3.1: one KPI tile — label, value, sparkline, delta, hint. A tile with an `href` is a link to the page whose
 * count it shows; one without is a plain card (builder-check ruling: never a button that goes nowhere).
 * Nothing overflows a 6-across tile (~121 px inside at 1280 px): the tile is a size container and the value scales
 * from 26 px down to 18 px with its width; money from ₱1M is compact ("₱12.3M"), its exact amount in the value's
 * tooltip and in the text a screen reader reads; every child may shrink (`min-w-0`) and the delta wraps.
 */
export function KpiTile({ tile }: { tile: Tile }) {
  const { shown, exact } = kpiValue(tile);
  const body = (
    <>
      <span className="min-w-0 font-mono text-[11px] font-semibold uppercase leading-tight tracking-[.07em] text-fg-muted">{tile.label}</span>
      <span className="flex min-w-0 flex-wrap items-end justify-between gap-x-2 gap-y-1">
        <span
          className="min-w-0 text-[length:clamp(18px,20cqi,26px)] font-semibold leading-none tracking-[-.01em] whitespace-nowrap text-fg tabular-nums"
          title={exact}
          data-kpi-value=""
        >
          {exact ? (
            <>
              <span aria-hidden="true">{shown}</span>
              <span className="sr-only">{exact}</span>
            </>
          ) : shown}
        </span>
        {tile.spark.length > 0 && <Sparkline values={tile.spark} />}
      </span>
      <KpiDelta tile={tile} />
      <span className="min-w-0 truncate text-[12px] text-fg-muted" title={tile.hint}>{tile.hint}</span>
    </>
  );
  const base = "@container flex min-w-0 flex-col gap-1.5 rounded-(--radius-card) border border-border bg-surface px-4 py-3.5 shadow-card";
  if (tile.href) {
    return (
      <Link
        href={tile.href}
        className={cn(base, "[transition:border-color_var(--dur-1)_linear] hover:border-border-strong")}
        data-kpi={tile.key}
      >
        {body}
      </Link>
    );
  }
  return <div className={base} data-kpi={tile.key}>{body}</div>;
}
