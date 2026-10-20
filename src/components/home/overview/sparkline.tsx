import { sparkGeometry } from "./chart-math";

/**
 * Spec §3.1: the tile's 84×28 sparkline of its 8 weekly points, in the first series colour. Decorative — the value and
 * the delta beside it say the same in words — so it is hidden from assistive tech. A week with no collected point
 * breaks the line; with fewer than 2 collected points it draws nothing (the tile says "collecting history").
 */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const g = sparkGeometry(values);
  if (!g) return null;
  return (
    <svg viewBox="0 0 84 28" width={84} height={28} aria-hidden="true" className="shrink-0 overflow-visible" data-sparkline="">
      {g.areas.map((d, i) => <path key={`a${i}`} d={d} className="fill-chart-1 stroke-none" fillOpacity={0.1} />)}
      {g.lines.map((d, i) => (
        <path key={`l${i}`} d={d} className="fill-none stroke-chart-1" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <circle cx={g.end.x} cy={g.end.y} r={2.6} className="fill-chart-1 stroke-surface" strokeWidth={1.5} />
    </svg>
  );
}
