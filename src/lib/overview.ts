/**
 * Phase 46 (spec §3): the Overview every workspace's Home renders — six KPI tiles, "Needs you", a trend, the
 * make-up and a ranked breakdown — and the pure helpers that fill it. The per-workspace reads live in
 * src/server/modules/home/overview.ts.
 */
import type { IconName } from "@/components/ui/icon";
import { addDays, dayFromISO } from "./deadlines";
import { fmtDayMonth, localDateISO } from "./format";
import { statusLabel } from "./asset-class";
import { EMPLOYEES_LIST_CONFIG } from "./employees-list";
import { parseListState, serializeListState, withFilter, type ListState } from "./url-state";
import { workActionLabel, workRowHref, type WorkGroup, type WorkRow } from "./worklist";

/** "vs last week": a count's change (live − 7 days ago), a money percent, this week's total vs last week's, or none yet. */
export type Delta = { kind: "count" | "pct" | "week"; value: number } | { kind: "none" };

export interface KpiTile {
  key: string;
  label: string;
  value: number;
  money?: true;
  /** preformatted value (e.g. ₱), when `value` alone would not read right */
  display?: string;
  /** the list page whose count `value` equals; absent = a plain card (spec §3.2 ruling) */
  href?: string;
  hint: string;
  /** 8 weekly points, oldest first; null = no history for that week */
  spark: (number | null)[];
  delta: Delta;
  upIs: "good" | "bad" | "neutral";
}

export interface NeedItem {
  tone: "bad" | "warn" | "info";
  icon: IconName;
  title: string;
  meta: string;
  action: string;
  href: string;
}

export interface TrendSeries {
  title: string;
  unit: string;
  labels: string[];
  /** at most 3 series, each with one value per label */
  series: { name: string; values: number[] }[];
}

export type MakeUpTone = "chart-1" | "chart-2" | "chart-3" | "warn" | "bad" | "neutral";

export interface MakeUp {
  title: string;
  rows: { label: string; value: number; tone: MakeUpTone; href?: string }[];
  money?: true;
}

export interface Ranked {
  title: string;
  sub: string;
  rows: { label: string; value: number; href?: string }[];
  money?: true;
}

export interface Overview {
  kpis: KpiTile[];
  needsYou: NeedItem[];
  needsYouHref: string;
  trend: TrendSeries;
  makeUp: MakeUp;
  breakdown: Ranked;
}

const DAY_MS = 86_400_000;

/** The delta's colour word: up is good, bad or neither for this tile; no change or no comparison is flat. */
export function deltaTone(t: Pick<KpiTile, "delta" | "upIs">): "good" | "bad" | "flat" {
  if (t.delta.kind === "none" || t.delta.value === 0 || t.upIs === "neutral") return "flat";
  return (t.delta.value > 0) === (t.upIs === "good") ? "good" : "bad";
}

/** Spec §2.4: the live value minus the value 7 days ago; none while that value is not collected yet. */
export function countDelta(live: number, weekAgo: number | null): Delta {
  return weekAgo === null ? { kind: "none" } : { kind: "count", value: live - weekAgo };
}

/** Manila calendar days from `at` to today (0 = today, negative = a later day). */
function manilaDaysAgo(at: Date, today: string): number {
  return Math.round((dayFromISO(today).getTime() - dayFromISO(localDateISO(at)).getTime()) / DAY_MS);
}

/**
 * `weeks` Manila weeks ending today, oldest first: the last bucket is today and the six days before it. Each
 * row's amount lands in its Manila day's week; rows before the window or after today are not counted.
 */
export function sumWeekBuckets(rows: { at: Date; amount: number }[], now: Date, weeks: number): number[] {
  const today = localDateISO(now);
  const buckets = Array<number>(weeks).fill(0);
  for (const r of rows) {
    const ago = manilaDaysAgo(r.at, today);
    if (ago < 0 || ago >= 7 * weeks) continue;
    buckets[weeks - 1 - Math.floor(ago / 7)] += r.amount;
  }
  return buckets;
}

/** How many of `dates` fall in each of `weeks` Manila weeks ending today, oldest first. */
export function weekBuckets(dates: Date[], now: Date, weeks: number): number[] {
  return sumWeekBuckets(dates.map((at) => ({ at, amount: 1 })), now, weeks);
}

/** The first instant the buckets count: Manila midnight starting the oldest week. */
export function weekWindowStart(now: Date, weeks: number): Date {
  return new Date(`${addDays(localDateISO(now), -(7 * weeks - 1))}T00:00:00+08:00`);
}

/** Each bucket's label: its last Manila day, "20 Oct". */
export function weekLabels(now: Date, weeks: number): string[] {
  const today = localDateISO(now);
  return Array.from({ length: weeks }, (_, i) => fmtDayMonth(dayFromISO(addDays(today, -7 * (weeks - 1 - i)))));
}

/** This week's total against last week's (spec: "this week vs last week"). */
export function weekOverWeek(buckets: number[]): Delta {
  if (buckets.length < 2) return { kind: "none" };
  return { kind: "week", value: buckets[buckets.length - 1] - buckets[buckets.length - 2] };
}

/** The sparkline ends at what the tile shows: today's point is the live value, not the morning's snapshot. */
export function liveSpark(history: (number | null)[], live: number): (number | null)[] {
  return history.length ? [...history.slice(0, -1), live] : [live];
}

/** Per point, the sum over several histories; a point missing in any one is null, never a partial sum. */
export function sumHistories(histories: (number | null)[][]): (number | null)[] {
  const length = Math.max(0, ...histories.map((h) => h.length));
  return Array.from({ length }, (_, i) => {
    let sum = 0;
    for (const h of histories) {
      const v = h[i];
      if (v === null || v === undefined) return null;
      sum += v;
    }
    return sum;
  });
}

// ── IT: Needs you ─────────────────────────────────────────────────────────

export interface ClaimLike {
  id: string;
  refNo: string;
  line1: string;
  sla: { text: string; overdue: boolean };
}

const TONE_RANK: Record<NeedItem["tone"], number> = { bad: 0, warn: 1, info: 2 };

/** loanRow / leaverRow severities: 500 + days late when overdue, 1000 when no date is set. */
const overdue = (r: WorkRow) => r.severity > 500 && r.severity < 1000;

function rowTone(r: WorkRow): NeedItem["tone"] {
  switch (r.section) {
    case "missing": return "bad";
    case "queue": return (r.rank ?? 0) < 2 || overdue(r) ? "bad" : "warn";
    case "loans": return overdue(r) ? "bad" : "warn";
    case "repairs": case "hires": return "warn";
    case "triage": case "check": case "purchases": return "info";
  }
}

function rowIcon(r: WorkRow): IconName {
  switch (r.section) {
    case "queue": return r.entity?.kind === "employee" ? "offboarding" : "approval";
    case "missing": return "alert";
    case "loans": return "reservations";
    case "repairs": return "setup";
    case "hires": return "employee";
    case "triage": return "inventory";
    case "check": return "scan";
    case "purchases": return "requests";
  }
}

/**
 * IT's "Needs you" (spec §3.2): the worklist's live rows plus the viewer's claims, flattened by urgency — bad, then
 * warn, then info; within a tone, claims first (a forgotten claim is worse than an unclaimed item), then the
 * worklist's section order and its own row order. Each item is a link: a viewer reads Open everywhere.
 */
export function needsFromWork(groups: WorkGroup[], claims: ClaimLike[], canAct: boolean, max = 6): NeedItem[] {
  const items: NeedItem[] = [
    ...claims.map((c): NeedItem => ({
      tone: c.sla.overdue ? "bad" : "warn",
      icon: "sla",
      title: `${c.refNo} · ${c.line1}`,
      meta: `claimed by you · ${c.sla.text}`,
      action: "Open",
      href: `/approvals/${c.id}`,
    })),
    ...groups.flatMap((g) => g.rows.map((r): NeedItem => ({
      tone: rowTone(r),
      icon: rowIcon(r),
      title: r.title,
      meta: r.meta,
      action: canAct ? r.action : workActionLabel(r, false),
      href: workRowHref(r, canAct),
    }))),
  ];
  // Array.prototype.sort is stable, so the source order above breaks ties within a tone.
  return items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]).slice(0, max);
}

// ── IT: make-up and breakdown ─────────────────────────────────────────────

const FLEET_TONE: Record<string, MakeUpTone> = {
  DEPLOYED: "chart-1", TEMPORARY: "chart-2", SPARE: "chart-3", DEFECTIVE: "warn", MISSING: "bad",
};

/** The fleet's stacked bar: one row per status slice, each linking to that status's filtered inventory. */
export function fleetMakeUp(fleet: { slices: { status: string; count: number; href: string }[] }): MakeUp {
  return {
    title: "Fleet by status",
    rows: fleet.slices.map((s) => ({
      label: statusLabel(s.status), value: s.count, tone: FLEET_TONE[s.status] ?? "neutral", href: s.href,
    })),
  };
}

/** /employees' Missing kit tab narrowed by `state` — the page's own href shape (`gaps=1` after the list state). */
function employeesGapsHref(state: ListState): string {
  const qs = serializeListState(state, EMPLOYEES_LIST_CONFIG);
  return "/employees" + (qs ? `${qs}&gaps=1` : "?gaps=1");
}

export interface KitGapGroup {
  id: string;
  name: string;
  kind: "INTERNAL" | "CLIENT";
  /** people in this group on the Missing kit tab */
  count: number;
}

const KIT_GAP_TOP = 7;

/**
 * Spec §3.2: people missing required kit by who they work for — the top 7 clients (count, then name), then one
 * "Internal teams" row summing every internal group. Each row links to the Missing kit tab filtered to it
 * (`department=<id>`, or `kind=INTERNAL`), so its value is that page's count.
 */
export function kitGapRanked(groups: KitGapGroup[]): Ranked {
  const empty = parseListState(new URLSearchParams(), EMPLOYEES_LIST_CONFIG);
  const clients = groups
    .filter((g) => g.kind === "CLIENT" && g.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, KIT_GAP_TOP)
    .map((g) => ({ label: g.name, value: g.count, href: employeesGapsHref(withFilter(empty, "department", [g.id])) }));
  const internal = groups.filter((g) => g.kind === "INTERNAL").reduce((sum, g) => sum + g.count, 0);
  return {
    title: "Missing kit by client",
    sub: "People missing required kit · top 7 clients and internal teams",
    rows: internal > 0
      ? [...clients, { label: "Internal teams", value: internal, href: employeesGapsHref(withFilter(empty, "kind", ["INTERNAL"])) }]
      : clients,
  };
}
