"use client";

import { useId, useState } from "react";
import type { TrendSeries } from "@/lib/overview";
import { declutter, fmtTick, fmtValue, labelIndexes, niceTicks, PERIOD_WORDS } from "./chart-math";
import { Panel } from "./panel";

/** Series classes by index (static strings, so the Tailwind scan finds them): the chart tokens, nothing else. */
const STROKE = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3"] as const;
const FILL = ["fill-chart-1", "fill-chart-2", "fill-chart-3"] as const;
const SWATCH = ["bg-chart-1", "bg-chart-2", "bg-chart-3"] as const;

const W = 640;
const H = 240;
const T = 12;
const B = 26;
/** room on the right for the direct end labels */
const R = 104;
/** the end labels' minimum spacing */
const LABEL_GAP = 14;

/**
 * Spec §3.3: the workspace trend — hand-drawn SVG, up to 3 series in the chart tokens, 2 px lines with a 4 px end dot,
 * receding gridlines, direct labels at the line ends (moved apart when they would collide), a legend, a hover crosshair
 * with a tooltip, and "Show table" for the same numbers as an accessible table. The SVG is one image with a name that
 * states the latest values; the tooltip is a pointer convenience (aria-hidden), the table is the full accessible view.
 * Text is drawn in the text tokens, never a series colour.
 */
export function LineChart({ trend, className }: { trend: TrendSeries; className?: string }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const tableId = `${id}-table`;

  const series = trend.series.slice(0, 3);
  const n = trend.labels.length;
  const money = trend.unit === "₱";
  const period = trend.period ? PERIOD_WORDS[trend.period] : null;
  const sub = period ? `last ${n} ${period.plural}` : undefined;
  const fmt = (v: number) => fmtValue(v, money);

  const toggle = (
    <button
      type="button"
      className="text-[12px] font-medium text-accent hover:underline"
      aria-expanded={table}
      aria-controls={tableId}
      onClick={() => setTable((t) => !t)}
    >
      {table ? "Show chart" : "Show table"}
    </button>
  );

  if (n === 0 || series.length === 0) {
    return (
      <Panel title={trend.title} sub={sub} className={className}>
        <p className="py-10 text-center text-[12.5px] text-fg-muted">Nothing in this period.</p>
      </Panel>
    );
  }

  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max, !money);
  const top = ticks[ticks.length - 1];
  const L = money ? 52 : 36;
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const last = n - 1;
  const endYs = declutter(series.map((s) => y(s.values[last] ?? 0)), LABEL_GAP, T + 4, H - B);
  const empty = max === 0;

  const latest = series.map((s) => `${s.name} ${fmt(s.values[last] ?? 0)}`).join(", ");
  const label = `${trend.title}${sub ? `, ${sub}` : ""}. Latest ${trend.period ?? "point"} (${trend.labels[last]}): ${latest}.`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const frac = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(last, Math.round(frac * last))));
  };

  const tipLeft = hover !== null && hover < n / 2;
  const tipPct = hover !== null ? (x(hover) / W) * 100 : 0;

  return (
    <Panel title={trend.title} sub={empty ? `${sub ? `${sub} · ` : ""}nothing in this period` : sub} action={toggle} className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-fg-secondary" data-legend="">
        {series.map((s, si) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-[3px] w-2.5 rounded-[2px] ${SWATCH[si]}`} aria-hidden="true" />
            {s.name}
          </span>
        ))}
        <span className="ml-auto text-fg-muted">{money ? "pesos" : trend.unit}</span>
      </div>

      <div className="relative w-full" hidden={table} data-chart="">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "stroke-border-strong" : "stroke-border"} strokeWidth={1} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} className="fill-fg-muted">{fmtTick(v, money)}</text>
            </g>
          ))}
          {labelIndexes(n).map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} className="fill-fg-muted">{trend.labels[i]}</text>
          ))}
          {series.map((s, si) => (
            <path
              key={s.name}
              d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}
              className={`fill-none ${STROKE[si]}`}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {series.map((s, si) => (
            <g key={s.name}>
              <circle cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} className={`${FILL[si]} stroke-surface`} strokeWidth={2} />
              <text x={x(last) + 9} y={endYs[si] + 4} fontSize={11.5} fontWeight={500} className="fill-fg-secondary">
                {`${s.name} ${money ? fmtTick(s.values[last] ?? 0, true) : fmt(s.values[last] ?? 0)}`}
              </text>
            </g>
          ))}
          {hover !== null && (
            <g data-crosshair="">
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-fg-faint" strokeDasharray="3 3" />
              {series.map((s, si) => (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={3.5} className={`${FILL[si]} stroke-surface`} strokeWidth={1.5} />
              ))}
            </g>
          )}
          <rect
            x={L}
            y={T}
            width={W - L - R}
            height={H - T - B}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-[5] min-w-[140px] rounded-[8px] border border-border-strong bg-surface-raised px-2.5 py-2 text-[12px] shadow-pop"
            style={tipLeft ? { left: `calc(${tipPct}% + 12px)` } : { right: `calc(${100 - tipPct}% + 12px)` }}
            aria-hidden="true"
            data-tooltip=""
          >
            <b className="mb-1 block font-semibold text-fg">{trend.labels[hover]}</b>
            {series.map((s, si) => (
              <div key={s.name} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                  <span className={`inline-block size-2 rounded-[2px] ${SWATCH[si]}`} />
                  {s.name}
                </span>
                <b className="font-semibold text-fg tabular-nums">{fmt(s.values[hover] ?? 0)}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id={tableId} className="overflow-x-auto" hidden={!table} data-chart-table="">
        <table className="w-full border-collapse text-[12.5px]">
          <caption className="sr-only">{trend.title}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border-faint px-2 py-1.5 text-left font-medium text-fg-muted">
                {period?.column ?? "Period"}
              </th>
              {series.map((s) => (
                <th key={s.name} scope="col" className="border-b border-border-faint px-2 py-1.5 text-right font-medium text-fg-muted">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trend.labels.map((lb, i) => (
              <tr key={`${lb}-${i}`}>
                <th scope="row" className="border-b border-border-faint px-2 py-1.5 text-left font-normal whitespace-nowrap text-fg">{lb}</th>
                {series.map((s) => (
                  <td key={s.name} className="border-b border-border-faint px-2 py-1.5 text-right whitespace-nowrap text-fg tabular-nums">
                    {fmt(s.values[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
