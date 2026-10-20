/**
 * Phase 46 (spec §3): the Overview every workspace's Home renders — six KPI tiles, "Needs you", a trend, the
 * make-up and a ranked breakdown — and the pure helpers that fill it. The per-workspace reads live in
 * src/server/modules/home/overview.ts.
 */
import type { Role } from "@prisma/client";
import type { IconName } from "@/components/ui/icon";
import { ROLE_LABELS } from "./admin-users";
import { addDays, dayFromISO } from "./deadlines";
import { fmtDayMonth, localDateISO } from "./format";
import { statusLabel } from "./asset-class";
import { manilaMonth } from "./depreciation";
import { EMPLOYEES_LIST_CONFIG } from "./employees-list";
import { PURCHASE_TABS } from "./purchases-list";
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

function rowTone(r: WorkRow): NeedItem["tone"] {
  switch (r.section) {
    case "missing": return "bad";
    case "queue": return (r.rank ?? 0) < 2 || r.overdue ? "bad" : "warn";
    case "loans": return r.overdue ? "bad" : "warn";
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

// ── IT: the trend's movements ─────────────────────────────────────────────

export type ItMove = "assigned" | "returned" | "toRepair";

/** One IT asset audit entry, as itMovementsSql reads it. */
export interface MoveEntry {
  action: string;
  /** the diff's `status.to`; null when the status did not change */
  statusTo: string | null;
  /** the diff's `assignee.to` is a person (true), nobody (false), or the diff has no assignee (null) */
  toPerson: boolean | null;
}

/** The audit actions the trend reads, in both forms: direct, and `<action> executed` (the worker, APPROVAL_TYPE_LABEL). */
export const IT_MOVE_ACTIONS = ["lifecycle.assign", "lifecycle.return", "lifecycle.replace", "lifecycle.change-status", "lifecycle.triage"]
  .flatMap((a) => [a, `${a} executed`]);

/**
 * Which IT trend series an entry counts in (spec §3.2 plus the Task 2 ruling): assign → Assigned, return → Returned;
 * a replace writes one entry per device, so the old device's (assignee → nobody) is Returned and the new one's
 * (assignee → a person) Assigned; a change-status or triage landing on DEFECTIVE is To repair. Transfers stay out.
 */
export function itMove(e: MoveEntry): ItMove | null {
  switch (e.action.replace(/ executed$/, "")) {
    case "lifecycle.assign": return "assigned";
    case "lifecycle.return": return "returned";
    case "lifecycle.replace": return e.toPerson === null ? null : e.toPerson ? "assigned" : "returned";
    case "lifecycle.change-status":
    case "lifecycle.triage": return e.statusTo === "DEFECTIVE" ? "toRepair" : null;
    default: return null;
  }
}

// ── Purchasing, Finance and Admin (Phase 46 Task 3) ───────────────────────

/** Asia/Manila is UTC+8 all year (no daylight saving). */
const MANILA_OFFSET_MS = 8 * 3_600_000;

/** Manila midnight on the 1st of month index `m` (year·12 + month). */
function manilaMonthStart(m: number): Date {
  return new Date(Date.UTC(Math.floor(m / 12), ((m % 12) + 12) % 12, 1) - MANILA_OFFSET_MS);
}

/** The instant the Manila calendar quarter began (Jan/Apr/Jul/Oct 1, Manila midnight) — the spend-by-department window. */
export function quarterStartManila(now: Date): Date {
  const m = manilaMonth(now);
  return manilaMonthStart(m - (((m % 3) + 3) % 3));
}

/** Per label, the summed amount, in first-seen order; a null label (no supplier, no department) takes `fallback`. */
export function sumByLabel(rows: { label: string | null; amount: number }[], fallback: string): { label: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const label = r.label ?? fallback;
    sums.set(label, (sums.get(label) ?? 0) + r.amount);
  }
  return [...sums].map(([label, value]) => ({ label, value }));
}

/**
 * A ranked breakdown's rows: the top `n` by value (ties by label), then one "Other" row summing the rest, so the rows
 * always add up to the whole. Rows at zero are dropped (a supplier with nothing spent is not a bar).
 */
export function topWithOther(rows: { label: string; value: number }[], n: number, otherLabel = "Other"): { label: string; value: number }[] {
  const sorted = rows.filter((r) => r.value !== 0).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const top = sorted.slice(0, n).map((r) => ({ label: r.label, value: r.value }));
  const rest = sorted.slice(n).reduce((sum, r) => sum + r.value, 0);
  return sorted.length > n ? [...top, { label: otherLabel, value: rest }] : top;
}

/**
 * Spec §3.1: a snapshot-backed money tile's "▲ 12%" — live against the value 7 days ago, as a whole percent. None while
 * that value is not collected; none from a zero base too, since no percent is honest there (zero to zero is flat).
 */
export function pctDelta(live: number, weekAgo: number | null): Delta {
  if (weekAgo === null) return { kind: "none" };
  if (weekAgo === 0) return live === 0 ? { kind: "pct", value: 0 } : { kind: "none" };
  return { kind: "pct", value: Math.round(((live - weekAgo) / Math.abs(weekAgo)) * 100) };
}

/** A centavo snapshot history (`fin.*C`) as pesos, the unit every money tile shows. */
export function pesosHistory(history: (number | null)[]): (number | null)[] {
  return history.map((v) => (v === null ? null : v / 100));
}

/** The first instant of the `days` Manila days ending today (Manila midnight). */
export function dayWindowStart(now: Date, days: number): Date {
  return new Date(`${addDays(localDateISO(now), -(days - 1))}T00:00:00+08:00`);
}

/** How many of `dates` fall on each of the `days` Manila days ending today, oldest first. */
export function dayBuckets(dates: Date[], now: Date, days: number): number[] {
  const today = localDateISO(now);
  const buckets = Array<number>(days).fill(0);
  for (const at of dates) {
    const ago = manilaDaysAgo(at, today);
    if (ago >= 0 && ago < days) buckets[days - 1 - ago] += 1;
  }
  return buckets;
}

/** Each day's label, "20 Oct". */
export function dayLabels(now: Date, days: number): string[] {
  const today = localDateISO(now);
  return Array.from({ length: days }, (_, i) => fmtDayMonth(dayFromISO(addDays(today, -(days - 1 - i)))));
}

/** The first instant of the `months` Manila months ending this one (the oldest month's 1st, Manila midnight). */
export function monthWindowStart(now: Date, months: number): Date {
  return manilaMonthStart(manilaMonth(now) - (months - 1));
}

/** Per Manila month, the summed amounts of the `months` months ending this one, oldest first. */
export function monthBuckets(rows: { at: Date; amount: number }[], now: Date, months: number): number[] {
  const current = manilaMonth(now);
  const buckets = Array<number>(months).fill(0);
  for (const r of rows) {
    const ago = current - manilaMonth(r.at);
    if (ago >= 0 && ago < months) buckets[months - 1 - ago] += r.amount;
  }
  return buckets;
}

const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Each month's label, "Oct 2026". */
export function monthLabels(now: Date, months: number): string[] {
  const current = manilaMonth(now);
  return Array.from({ length: months }, (_, i) => {
    const m = current - (months - 1 - i);
    return `${SHORT_MONTH[((m % 12) + 12) % 12]} ${Math.floor(m / 12)}`;
  });
}

const REQUEST_TONE: Record<string, MakeUpTone> = {
  DRAFT: "neutral", SUBMITTED: "chart-1", IT_REVIEWED: "chart-2", COMPLETED: "chart-3", CANCELLED: "bad",
};

/** Purchasing's make-up: requests by state in tab order, each linking to its /purchases tab (whose count it is). */
export function requestStateMakeUp(counts: Record<string, number>): MakeUp {
  return {
    title: "Requests by state",
    rows: PURCHASE_TABS.filter((t) => t.id !== "ALL" && (counts[t.id] ?? 0) > 0).map((t) => ({
      label: t.label, value: counts[t.id], tone: REQUEST_TONE[t.id] ?? "neutral", href: t.href,
    })),
  };
}

const CHART_TONES = ["chart-1", "chart-2", "chart-3"] as const satisfies readonly MakeUpTone[];

/** Finance's make-up: book value by category — the three largest in the chart colours, the rest as one Other. */
export function bookValueMakeUp(rows: { label: string; value: number }[]): MakeUp {
  return {
    title: "Book value by category",
    money: true,
    rows: topWithOther(rows, CHART_TONES.length).map((r, i) => ({ ...r, tone: CHART_TONES[i] ?? "neutral" })),
  };
}

const DELIVERY_ROWS = [
  { status: "DELIVERED", label: "Delivered", tone: "chart-1" },
  { status: "PENDING", label: "Pending", tone: "chart-2" },
  { status: "RETRYING", label: "Retrying", tone: "warn" },
  { status: "DEAD", label: "Dead", tone: "bad" },
] as const satisfies ReadonlyArray<{ status: string; label: string; tone: MakeUpTone }>;

/**
 * Admin's make-up: the last 7 days' webhook deliveries by status. Not links: the deliveries page has no date window,
 * so a 7-day segment would not equal its tab's count.
 */
export function deliveryMakeUp(counts: Record<string, number>): MakeUp {
  return {
    title: "Webhook deliveries · 7 days",
    rows: DELIVERY_ROWS.filter((d) => (counts[d.status] ?? 0) > 0).map((d) => ({ label: d.label, value: counts[d.status], tone: d.tone })),
  };
}

/** Admin's breakdown: every account by role, largest first (a role nobody holds stays, at 0). Not links: /admin/users has no role filter. */
export function roleRanked(byRole: { role: Role; count: number }[]): Ranked {
  return {
    title: "Accounts by role",
    sub: "Every account, enabled or disabled",
    rows: byRole
      .map((r) => ({ label: ROLE_LABELS[r.role], value: r.count }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
  };
}

/** One of Home's to-do rows (TodoRow in home/queries), as Needs you reads it. */
export interface TodoLike {
  refNo: string;
  what: string;
  meta: string;
  href: string;
  action: string;
  /** the request came back to its author (purchasing only) */
  bounced?: boolean;
}

export interface OverdueStocktake {
  id: string;
  refNo: string;
  scope: string;
  /** the close-by day, stored as that day's UTC midnight */
  dueAt: Date;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Order by tone (bad, warn, info), keeping the source order within a tone, and keep `max`. */
function byTone(items: NeedItem[], max: number): NeedItem[] {
  return items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]).slice(0, max);
}

/**
 * Purchasing's "Needs you" (spec §3.2): stocktakes past their close-by date (bad), stock below reorder and requests
 * that came back (warn), then the rest of the viewer's own requests (drafts, waiting on IT).
 */
export function purchasingNeeds(
  todo: TodoLike[], overdue: OverdueStocktake[], lowStock: number, lowHref: string, today: string, max = 6,
): NeedItem[] {
  const items: NeedItem[] = overdue.map((s) => {
    const due = s.dueAt.toISOString().slice(0, 10);
    const late = Math.round((dayFromISO(today).getTime() - dayFromISO(due).getTime()) / DAY_MS);
    return {
      tone: "bad", icon: "stock", title: `${s.refNo} · ${s.scope}`,
      meta: `close-by ${fmtDayMonth(s.dueAt)} · ${late} d overdue`, action: "Open", href: `/stock/stocktakes/${s.id}`,
    };
  });
  if (lowStock > 0) {
    items.push({
      tone: "warn", icon: "stock", title: `${plural(lowStock, "item", "items")} below reorder level`,
      meta: "Reorder before they run out", action: "Review", href: lowHref,
    });
  }
  for (const r of todo) {
    items.push({ tone: r.bounced ? "warn" : "info", icon: "requests", title: `${r.refNo} · ${r.what}`, meta: r.meta, action: r.action, href: r.href });
  }
  return byTone(items, max);
}

/**
 * Finance's "Needs you" (spec §3.2): registrations to confirm, one item per class linking to that class's view (so
 * its number is the page's count), then the requests waiting on Finance, oldest review first.
 */
export function financeNeeds(queue: TodoLike[], toConfirm: { it: number; purchasing: number }, max = 6): NeedItem[] {
  const items: NeedItem[] = [];
  const reg = (n: number, cls: string, href: string) => {
    if (n > 0) {
      items.push({
        tone: "warn", icon: "inventory", title: `${n} ${cls} ${n === 1 ? "registration" : "registrations"} to confirm`,
        meta: "Registered, waiting for Finance", action: "Review", href,
      });
    }
  };
  reg(toConfirm.it, "IT", "/finance/assets?fin=with-finance");
  reg(toConfirm.purchasing, "Purchasing", "/finance/assets?cls=PURCHASING&fin=with-finance");
  for (const r of queue) {
    items.push({ tone: "warn", icon: "requests", title: `${r.refNo} · ${r.what}`, meta: r.meta, action: r.action, href: r.href });
  }
  return byTone(items, max);
}

export interface AdminNeedsInput {
  dead: number;
  failing: { id: string; url: string; dead: number; active: boolean }[];
  disabledAdmins: { id: string; name: string; email: string }[];
  unavailableFlags: { key: string; label: string }[];
}

/** Admin's "Needs you" (spec §3.2): dead deliveries and the endpoints they died on, disabled admins, unavailable flags. */
export function adminNeeds(d: AdminNeedsInput, max = 6): NeedItem[] {
  const items: NeedItem[] = [];
  if (d.dead > 0) {
    items.push({
      tone: "bad", icon: "webhooks", title: `${plural(d.dead, "dead webhook delivery", "dead webhook deliveries")}`,
      meta: "Dead-lettered · replay them or fix the endpoint", action: "Review", href: "/admin/webhooks/deliveries?state=DEAD",
    });
  }
  for (const e of d.failing) {
    items.push({
      tone: "bad", icon: "webhooks", title: e.url,
      meta: `${plural(e.dead, "dead delivery", "dead deliveries")}${e.active ? "" : " · endpoint switched off"}`,
      action: "Open", href: "/admin/webhooks",
    });
  }
  for (const u of d.disabledAdmins) {
    items.push({ tone: "warn", icon: "users", title: `${u.name} is a disabled admin`, meta: u.email, action: "Review", href: "/admin/users?disabled=1" });
  }
  for (const f of d.unavailableFlags) {
    items.push({ tone: "info", icon: "flags", title: `${f.label} is unavailable`, meta: "Cannot be switched on in this build", action: "Open", href: "/admin/flags" });
  }
  return byTone(items, max);
}
