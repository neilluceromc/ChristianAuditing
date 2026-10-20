/**
 * Phase 46 (spec §3.1, §3.3): the Overview's pure numbers — value formatting, the delta's words, the sparkline's
 * path, the trend chart's ticks and its de-collided end labels. No React here, so each piece is unit-tested alone.
 */
import { fmtMoney } from "@/lib/format";
import type { Delta } from "@/lib/overview";

const countFmt = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });

/** A count ("1,204") or, for money, whole pesos ("₱1,204"). */
export function fmtValue(n: number, money?: boolean): string {
  return money ? fmtMoney(n) : countFmt.format(n);
}

/** An axis tick: compact so it fits the gutter ("1.2M", "₱1.2M"). */
export function fmtTick(n: number, money?: boolean): string {
  return `${money ? "₱" : ""}${compactFmt.format(n)}`;
}

/** -0 reads "0" (a rounded −0.4% is no change, not "▼ 0%"). */
const norm = (n: number) => (Object.is(n, -0) ? 0 : n);

export interface DeltaWords {
  /** the arrow drawn beside the words; "flat" is the em dash of no change */
  dir: "up" | "down" | "flat";
  text: string;
}

/**
 * Spec §3.1: the delta as an arrow plus words — never colour alone. `none` has no words of its own (the tile decides
 * between "collecting history" and nothing).
 *   count 8        → ▲ "8 vs last week"
 *   pct 12         → ▲ "12% vs last week"
 *   week 12 pct    → ▲ "12% this week vs last week"
 *   week 3 count   → ▲ "3 this week vs last week"
 *   new            → ▲ "new this week"
 *   any 0          → — "no change"
 */
export function deltaWords(d: Delta): DeltaWords | null {
  if (d.kind === "none") return null;
  if (d.kind === "new") return { dir: "up", text: "new this week" };
  const value = norm(d.value);
  if (value === 0) return { dir: "flat", text: "no change" };
  const dir = value > 0 ? "up" : "down";
  const abs = Math.abs(value);
  if (d.kind === "week") return { dir, text: `${d.unit === "pct" ? `${abs}%` : countFmt.format(abs)} this week vs last week` };
  return { dir, text: `${d.kind === "pct" ? `${abs}%` : countFmt.format(abs)} vs last week` };
}

/** Spec §2.4: a sparkline needs at least 2 points that were actually collected. */
export function sparkPoints(values: (number | null)[]): number {
  return values.filter((v) => v !== null).length;
}

export interface SparkGeometry {
  /** one line per run of collected points; a null week breaks the line rather than inventing a value */
  lines: string[];
  /** the matching closed areas under each line */
  areas: string[];
  end: { x: number; y: number };
}

/**
 * The 84×28 sparkline: x spread over every week (collected or not), y over the collected range with 3 px padding.
 * Null when fewer than 2 points were collected.
 */
export function sparkGeometry(values: (number | null)[], w = 84, h = 28): SparkGeometry | null {
  if (sparkPoints(values) < 2) return null;
  const nums = values.filter((v): v is number => v !== null);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const pad = 3;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
  // a flat run sits mid-height rather than on the floor
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad));
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ x: x(i), y: y(v) });
    }
  });
  if (run.length) runs.push(run);
  const f = (n: number) => n.toFixed(1);
  const lines = runs.map((r) => r.map((p, i) => `${i ? "L" : "M"}${f(p.x)},${f(p.y)}`).join(""));
  const areas = runs.map((r, i) => `${lines[i]}L${f(r[r.length - 1].x)},${h}L${f(r[0].x)},${h}Z`);
  const last = runs[runs.length - 1];
  return { lines, areas, end: last[last.length - 1] };
}

/**
 * About four gridlines from 0 to a round top: steps of 1, 2 or 5 × 10ⁿ, never below 1 for whole counts. An all-zero
 * chart still gets an axis (0 to 1).
 */
export function niceTicks(max: number, whole: boolean, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  if (whole) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/**
 * The direct end labels' y positions, kept `gap` apart and inside [min, max]: sorted top to bottom, each pushed down
 * below the one above, then the stack pushed back up if it ran off the bottom. Returned in the input order.
 */
export function declutter(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y: Math.min(max, Math.max(min, y)), i })).sort((a, b) => a.y - b.y || a.i - b.i);
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + gap);
  const over = order.length ? order[order.length - 1].y - max : 0;
  if (over > 0) {
    order[order.length - 1].y = max;
    for (let k = order.length - 2; k >= 0; k--) order[k].y = Math.min(order[k].y, order[k + 1].y - gap);
  }
  const out = Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** Which x labels to print: about six, always the last. */
export function labelIndexes(n: number, most = 6): number[] {
  const step = Math.max(1, Math.ceil(n / most));
  // a stepped label closer than one step to the always-printed last one would crowd it
  return Array.from({ length: n }, (_, i) => i).filter((i) => i === n - 1 || (i % step === 0 && n - 1 - i >= step));
}

/** "week" → the table's first column and the card's "last 12 weeks". */
export const PERIOD_WORDS: Record<"week" | "day" | "month", { column: string; plural: string }> = {
  week: { column: "Week ending", plural: "weeks" },
  day: { column: "Day", plural: "days" },
  month: { column: "Month", plural: "months" },
};
