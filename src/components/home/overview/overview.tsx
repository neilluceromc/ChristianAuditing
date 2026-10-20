import type { Overview } from "@/lib/overview";
import { KpiTile } from "./kpi-tile";
import { LineChart } from "./line-chart";
import { MakeUpBar } from "./make-up-bar";
import { NeedsYou } from "./needs-you";
import { RankedBars } from "./ranked-bars";

/**
 * Phase 46 (spec §3.1): every workspace's Home — the KPI row; Row A, "Needs you" beside the trend; Row B, the make-up
 * beside the ranked breakdown. Focus mode (the `br.focus` cookie) keeps only the KPI row and "Needs you".
 * Responsive: the rows stack below 1100 px; the KPI row is 6 columns from 1280 px, 3 from 560 px and 2 below.
 */
export function OverviewHome({ overview, focus }: { overview: Overview; focus: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-overview="">
      <div className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-3 min-[1280px]:grid-cols-6" data-kpis="">
        {overview.kpis.map((t) => <KpiTile key={t.key} tile={t} />)}
      </div>

      {focus ? (
        <>
          <NeedsYou items={overview.needsYou} href={overview.needsYouHref} />
          <p className="font-mono text-[10.5px] text-fg-muted">
            Focus mode — the trend, make-up and breakdown are hidden. Everything else is still there.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" data-row="a">
            <NeedsYou items={overview.needsYou} href={overview.needsYouHref} />
            <LineChart trend={overview.trend} />
          </div>
          <div className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2" data-row="b">
            <MakeUpBar makeUp={overview.makeUp} />
            <RankedBars ranked={overview.breakdown} />
          </div>
        </>
      )}
    </div>
  );
}
