import { Prisma, type AssetClass, type Role, type User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { approvalClassKeys, approvalClassWhere, isApprover } from "@/lib/approval-access";
import { tabWhere } from "@/lib/approvals-list";
import { defaultClassFor, withViewClsQS } from "@/lib/asset-class";
import { monthStartManila } from "@/lib/cris-limits";
import { fmtMoney, localDateISO } from "@/lib/format";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { TILE_SPECS, tileState } from "@/lib/inventory-tiles";
import {
  adminNeeds, bookValueMakeUp, countDelta, deliveryMakeUp, directChangesPerDay, financeNeeds, fleetMakeUp, itMove,
  IT_MOVE_ACTIONS, kitGapRanked, liveSpark, monthBuckets, monthLabels, monthWindowStart, needsFromWork, pctDelta,
  pesosHistory, plural, purchasingNeeds, quarterStartManila, rankByLabel, requestStateMakeUp, roleRanked, sumHistories,
  sumWeekBuckets, weekBuckets, weekLabels, weekOverWeek, weekWindowStart, withTeamCards,
  type ItMove, type KpiTile, type MoveEntry, type Overview, type TrendSeries,
} from "@/lib/overview";
import { PURCHASE_TABS, TO_REGISTER_HREF, type PurchaseTabId } from "@/lib/purchases-list";
import type { CountKey } from "@/lib/workspaces";
import { HISTORY_POINTS, type SnapshotKey } from "@/lib/snapshot";
import { DEFAULT_EXPIRY_WINDOW } from "@/lib/stock-allocation";
import { STOCK_LIST_CONFIG } from "@/lib/stock-list";
import { reportHref, STOCK_REPORT_LIST_CONFIG } from "@/lib/stock-reports";
import { parseListState, serializeListState, withFilter } from "@/lib/url-state";
import { metricHistory } from "@/server/modules/metrics/history";
import { inventoryTileCounts } from "@/server/modules/inventory/queries";
import { kitGapsByGroup } from "@/server/modules/employees/queries";
import { stateCounts } from "@/server/modules/purchases/queries";
import { overdueStocktakes, stockHomeSignals } from "@/server/modules/stock/queries";
import { financeViewWhere } from "@/server/modules/finance/queries";
import { bookValueByCategory, capitalizedSince } from "@/server/modules/finance/depreciation-queries";
import { adminHome, deliveriesByStatus, disabledAdmins, failingEndpoints } from "@/server/modules/admin/queries";
import { NAV_COUNT_HREF, readNavCounts } from "./nav-counts";
import {
  claimedByYou, completedSpend, directChangeRows, financeQueue, financeWaitingRows, fleet, purchasingTodo, SPEND_TOP,
  waitingDays, worklist,
} from "./queries";

/** Spec §3.1: the trend chart's 12 points. */
const TREND_WEEKS = 12;
/** The point 7 days before today in an 8-point weekly history. */
const WEEK_AGO = HISTORY_POINTS - 2;

type Viewer = Pick<User, "id" | "role">;

/** What a tile says besides its numbers. */
interface TileSpec {
  key: string;
  label: string;
  hint: string;
  upIs: KpiTile["upIs"];
  /** the page whose count the value is; absent = a plain card */
  href?: string;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * A count tile with a snapshot history: the sparkline is the 8 weekly snapshots with today's point replaced by the
 * live value, and the delta is live minus the value 7 days ago ("collecting history" while that is null).
 */
function historyTile(t: TileSpec, value: number, history: (number | null)[]): KpiTile {
  return {
    key: t.key, label: t.label, value, hint: t.hint, upIs: t.upIs, ...(t.href ? { href: t.href } : {}),
    spark: liveSpark(history, value),
    delta: countDelta(value, history[WEEK_AGO] ?? null),
  };
}

/** A money tile with a centavo snapshot history (`fin.*C`): shown in pesos, its change as a percent (spec §3.1). */
function moneyHistoryTile(t: TileSpec, pesos: number, historyC: (number | null)[]): KpiTile {
  const history = pesosHistory(historyC);
  const value = cents(pesos);
  return {
    key: t.key, label: t.label, value, money: true, display: fmtMoney(value), hint: t.hint, upIs: t.upIs,
    ...(t.href ? { href: t.href } : {}),
    spark: liveSpark(history, value),
    delta: pctDelta(value, history[WEEK_AGO] ?? null),
  };
}

/**
 * The first instant every month-to-date tile reads: the sparkline's first week. This Manila month always starts inside
 * it (a month is at most 31 days, the 8 weekly points span 56), so one read covers the value and the sparkline.
 */
function sparkSince(now: Date): Date {
  return weekWindowStart(now, HISTORY_POINTS);
}

const earliest = (a: Date, b: Date) => (a < b ? a : b);

/**
 * Builder-check ruling, month-to-date tiles: the value is the Manila month to date, the sparkline the last 8 weekly
 * totals, and the delta this week against last week. Review ruling: a money tile's delta is a percent, a count tile's
 * the difference; up from a zero week is "new". `rows` must reach back to sparkSince(now).
 */
function monthToDateTile(
  t: Omit<TileSpec, "hint">, rows: { at: Date; amount: number }[], now: Date,
  opts: { money: boolean; hint: (inMonth: { at: Date; amount: number }[]) => string },
): KpiTile {
  const monthStart = monthStartManila(now);
  const inMonth = rows.filter((r) => r.at >= monthStart);
  const base = { key: t.key, label: t.label, hint: opts.hint(inMonth), upIs: t.upIs, ...(t.href ? { href: t.href } : {}) };
  if (!opts.money) {
    const spark = weekBuckets(rows.map((r) => r.at), now, HISTORY_POINTS);
    return { ...base, value: inMonth.length, spark, delta: weekOverWeek(spark, "count") };
  }
  const value = cents(inMonth.reduce((sum, r) => sum + r.amount, 0));
  const spark = sumWeekBuckets(rows, now, HISTORY_POINTS).map(cents);
  return { ...base, value, money: true, display: fmtMoney(value), spark, delta: weekOverWeek(spark, "pct") };
}

const pesosOf = (rows: { amount: number }[]) => rows.reduce((sum, r) => sum + r.amount, 0);

/** The snapshot keys whose sum is this role's Approvals count (approvalClassKeys mirrors approvalClassWhere). */
function approvalsOpenKeys(role: Role): SnapshotKey[] {
  return approvalClassKeys(role).map((k) => `approvals.open.${k}` as const);
}

/** The Approvals page's Open tab in the role's classes (tabWhere "open" + approvalClassWhere), and how many are past SLA. */
function approvalsOpenCounts(user: Viewer, now: Date): Promise<[number, number]> {
  const scope = approvalClassWhere(user.role);
  const open = tabWhere("open", user.id);
  return Promise.all([
    prisma.approval.count({ where: { AND: [open, scope] } }),
    prisma.approval.count({ where: { AND: [open, { slaAt: { lt: now } }, scope] } }),
  ]);
}

/** Approvals open (IT and Admin): linked to /approvals, its history the sum of exactly the role's per-class keys. */
function approvalsTile([open, pastSla]: [number, number], histories: (number | null)[][]): KpiTile {
  return historyTile(
    { key: "approvals.open", label: "Approvals open", hint: `${pastSla} past SLA`, upIs: "bad", href: "/approvals" },
    open,
    sumHistories(histories),
  );
}

/**
 * Spec §3.2 IT trend (and the Task 2 ruling): IT asset entries for every IT_MOVE_ACTIONS action since `since`, with
 * the two diff fields itMove classifies by — `status.to` (lifecycle/apply.ts writes it on every status change) and
 * whether `assignee.to` is a person. Change-status and triage rows come back only when they land on DEFECTIVE.
 * Prisma stores DateTime as the UTC wall clock in `timestamp(3)`, so the bound is read back AT TIME ZONE 'UTC'
 * (the ageHistogramSql convention).
 */
export function itMovementsSql(since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT e."action", e."createdAt",
      e."diff"->'status'->>'to' AS "statusTo",
      CASE WHEN e."diff"->'assignee' IS NOT NULL THEN (e."diff"->'assignee'->>'to') IS NOT NULL END AS "toPerson"
    FROM "AuditEntry" e JOIN "Asset" a ON a."id" = e."entityId"
    WHERE e."entityType" = 'asset' AND a."cls" = 'IT'::"AssetClass"
      AND e."createdAt" >= (${since}::timestamptz AT TIME ZONE 'UTC')
      AND e."action" IN (${Prisma.join(IT_MOVE_ACTIONS)})
      AND (e."action" NOT LIKE 'lifecycle.change-status%' AND e."action" NOT LIKE 'lifecycle.triage%'
        OR e."diff"->'status'->>'to' = 'DEFECTIVE')
  `;
}

async function itTrend(now: Date): Promise<TrendSeries> {
  const rows = await prisma.$queryRaw<Array<MoveEntry & { createdAt: Date }>>(
    itMovementsSql(weekWindowStart(now, TREND_WEEKS)),
  );
  const dates: Record<ItMove, Date[]> = { assigned: [], returned: [], toRepair: [] };
  for (const r of rows) {
    const move = itMove(r);
    if (move) dates[move].push(r.createdAt);
  }
  return {
    title: "Asset movements per week",
    unit: "assets",
    period: "week",
    labels: weekLabels(now, TREND_WEEKS),
    series: [
      { name: "Assigned", values: weekBuckets(dates.assigned, now, TREND_WEEKS) },
      { name: "Returned", values: weekBuckets(dates.returned, now, TREND_WEEKS) },
      { name: "To repair", values: weekBuckets(dates.toRepair, now, TREND_WEEKS) },
    ],
  };
}

/**
 * The URL an /inventory count tile opens with nothing else filtered (`?status=SPARE`, `?attention=1`), built the way
 * the page builds its own tiles (tileState + serializeListState), with `cls` only when IT is not the role's default.
 */
function inventoryTileHref(key: string, cls: AssetClass, role: Role): string {
  const spec = TILE_SPECS[cls].find((s) => s.key === key);
  if (!spec) throw new Error(`No ${cls} inventory tile "${key}"`);
  const empty = parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG);
  const qs = serializeListState(tileState(empty, spec, false), INVENTORY_LIST_CONFIG);
  return "/inventory" + withViewClsQS(qs, cls, defaultClassFor(role));
}

/** The IT tiles: the inventory tile each one is, its snapshot key, and which way is good. */
const IT_TILES = [
  { tile: "in-stock", key: "it.spare", label: "Spare", hint: "Ready to assign", upIs: "neutral" },
  { tile: "deployed", key: "it.deployed", label: "Deployed", hint: "With staff", upIs: "neutral" },
  { tile: "in-repair", key: "it.defective", label: "In repair", hint: "Defective, out of service", upIs: "bad" },
  { tile: "missing", key: "it.missing", label: "Missing", hint: "Custody lost", upIs: "bad" },
  { tile: "attention", key: "it.attention", label: "Need attention", hint: "Someone owes an action", upIs: "bad" },
] as const satisfies ReadonlyArray<{ tile: string; key: SnapshotKey; label: string; hint: string; upIs: KpiTile["upIs"] }>;

/**
 * Spec §3.2, the IT row. Every linked value is read the way its page counts it:
 * - the five inventory tiles are `inventoryTileCounts` with nothing filtered (what /inventory's own tiles show, and
 *   what the nightly snapshot stores), linked to the tile's URL;
 * - Approvals open is the Approvals page's Open tab in the role's classes (tabWhere "open" + approvalClassWhere),
 *   and its history sums exactly the per-class keys `approvalClassKeys` gives the role.
 * Each sparkline is the 8 weekly snapshots with today's point replaced by the live value; the delta is live minus
 * the value 7 days ago ("collecting history" while that is null).
 */
export async function itOverview(user: Viewer, now: Date = new Date()): Promise<Overview> {
  const viewer = user.role === "viewer";
  const openKeys = approvalsOpenKeys(user.role);

  const [tiles, approvals, history, groups, claims, fleetData, trend, gaps, team] = await Promise.all([
    inventoryTileCounts(parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG), null, "IT", now),
    approvalsOpenCounts(user, now),
    metricHistory<SnapshotKey>([...IT_TILES.map((t) => t.key), ...openKeys], now),
    worklist(user.id, user.role, { limit: 6, excludeOwnClaims: !viewer }, now),
    isApprover(user.role) ? claimedByYou(user.id, user.role, now) : Promise.resolve([]),
    fleet(now),
    itTrend(now),
    kitGapsByGroup(now),
    // Task 7 (spec §7): the team's cards, the nav's own counts (state, never the bell). A viewer can fix nothing.
    viewer ? Promise.resolve<Partial<Record<CountKey, number>>>({}) : readNavCounts(["itSentBack", "poWithIt"], user),
  ]);

  const kpis: KpiTile[] = [
    ...IT_TILES.map((t) => historyTile(
      { key: t.key, label: t.label, hint: t.hint, upIs: t.upIs, href: inventoryTileHref(t.tile, "IT", user.role) },
      tiles[t.tile] ?? 0,
      history[t.key],
    )),
    approvalsTile(approvals, openKeys.map((k) => history[k])),
  ];

  return {
    kpis,
    needsYou: withTeamCards(
      {
        sentBack: [{ n: team.itSentBack ?? 0, href: NAV_COUNT_HREF.itSentBack, meta: "Finance sent these back · fix them and send them on" }],
        toCheck: { n: team.poWithIt ?? 0, href: NAV_COUNT_HREF.poWithIt, meta: "Purchase orders waiting for IT's check" },
      },
      needsFromWork(groups, claims, !viewer),
    ),
    needsYouHref: "/inventory/work",
    trend,
    makeUp: fleetMakeUp(fleetData),
    breakdown: kitGapRanked(gaps),
  };
}

// ── Purchasing ────────────────────────────────────────────────────────────

/** A /purchases state tab's URL — the tab whose count stateCounts() gives. */
function purchaseTabHref(id: PurchaseTabId): string {
  return PURCHASE_TABS.find((t) => t.id === id)!.href;
}

/** /stock filtered to Below reorder level, built the way the page serializes its own state (`?low=1`). */
function stockLowHref(): string {
  const empty = parseListState(new URLSearchParams(), STOCK_LIST_CONFIG);
  return "/stock" + serializeListState(withFilter(empty, "low", ["1"]), STOCK_LIST_CONFIG);
}

/** The expiry report's Expiring tab at the default window, built as the page builds its tab link. */
function expiringLotsHref(): string {
  const empty = parseListState(new URLSearchParams(), STOCK_REPORT_LIST_CONFIG);
  return reportHref("/stock/reports/expiry", empty, { days: String(DEFAULT_EXPIRY_WINDOW), tab: "expiring" });
}

/** Spec §3.2 Purchasing trend: purchase orders created and registered per Manila week, 12 weeks. */
async function purchaseFlowTrend(now: Date): Promise<TrendSeries> {
  const since = weekWindowStart(now, TREND_WEEKS);
  const [created, completed] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    // Migration 38: the old COMPLETED requests are READY orders that keep their completedAt (see completedSpend).
    prisma.purchaseOrder.findMany({ where: { state: "READY", completedAt: { gte: since } }, select: { completedAt: true } }),
  ]);
  return {
    title: "Purchase orders per week",
    unit: "purchase orders",
    period: "week",
    labels: weekLabels(now, TREND_WEEKS),
    series: [
      { name: "Created", values: weekBuckets(created.map((r) => r.createdAt), now, TREND_WEEKS) },
      { name: "Registered", values: weekBuckets(completed.map((r) => r.completedAt!), now, TREND_WEEKS) },
    ],
  };
}

const PURCHASING_KEYS = [
  // Task 7: pr.itReviewed snapshots Purchasing's To register count again (the tile's live value).
  "pr.submitted", "pr.itReviewed", "stock.low", "stock.expiringLots", "stock.stocktakesOverdue",
] as const satisfies readonly SnapshotKey[];

/**
 * Spec §3.2, the Purchasing row. Linked values are read the way their pages count them:
 * - With IT is stateCounts() — the /purchases tab count — linked to that tab (its snapshot key keeps its old name,
 *   pr.submitted, so the history carries on);
 * - To register (Task 7) is the nav's poToRegister — every PO with a line Purchasing can register and units left, a
 *   mixed one still with IT included — linked to /purchases?register=1; pr.itReviewed snapshots the same count;
 * - Below reorder and Lots expiring are stockHomeSignals(), the counts /stock?low=1 and the expiry report's Expiring
 *   tab (30-day window) list;
 * - Spend this month (Manila month, completed requests) and Stocktakes overdue are plain cards: no page lists exactly
 *   that set (/stock/stocktakes has no overdue filter).
 */
export async function purchasingOverview(user: Viewer, now: Date = new Date()): Promise<Overview> {
  const today = localDateISO(now);
  // One completed-spend read: the sparkline's 8 weeks, which hold this Manila month (the value and the supplier breakdown).
  const [states, stock, spend, todo, overdue, history, trend, team] = await Promise.all([
    stateCounts(),
    stockHomeSignals(today),
    completedSpend(sparkSince(now)),
    purchasingTodo(user.id, now),
    overdueStocktakes(today),
    metricHistory<SnapshotKey>([...PURCHASING_KEYS], now),
    purchaseFlowTrend(now),
    // Task 7 (spec §7): the Sent back card and To register, the nav's own counts (state, never the bell)
    readNavCounts(["poSentBack", "assetsSentBackPurchasing", "poToRegister"], user),
  ]);
  const lowHref = stockLowHref();
  const suppliers = rankByLabel(
    spend.map((r) => ({ at: r.at, amount: r.amount, label: r.supplier })), monthStartManila(now), "No supplier", SPEND_TOP,
  );

  const kpis: KpiTile[] = [
    historyTile(
      { key: "pr.submitted", label: "With IT", hint: "Waiting for IT's check", upIs: "bad", href: purchaseTabHref("WITH_IT") },
      states.WITH_IT ?? 0, history["pr.submitted"],
    ),
    historyTile(
      { key: "pr.itReviewed", label: "To register", hint: "Lines Purchasing can register", upIs: "bad", href: TO_REGISTER_HREF },
      team.poToRegister ?? 0, history["pr.itReviewed"],
    ),
    monthToDateTile({ key: "spend.month", label: "Spend this month", upIs: "neutral" }, spend, now, {
      money: true, hint: (m) => `${plural(m.length, "purchase order", "purchase orders")} registered`,
    }),
    historyTile(
      { key: "stock.low", label: "Below reorder", hint: "Stock items at or below reorder level", upIs: "bad", href: lowHref },
      stock.low, history["stock.low"],
    ),
    historyTile(
      { key: "stock.expiringLots", label: "Lots expiring", hint: `Open lots expiring within ${DEFAULT_EXPIRY_WINDOW} days`, upIs: "bad", href: expiringLotsHref() },
      stock.expiringLots, history["stock.expiringLots"],
    ),
    historyTile(
      { key: "stock.stocktakesOverdue", label: "Stocktakes overdue", hint: "Open past their close-by date", upIs: "bad" },
      stock.stocktakesOverdue, history["stock.stocktakesOverdue"],
    ),
  ];

  return {
    kpis,
    needsYou: withTeamCards(
      {
        // Fix round 1: the POs sent back, and the single assets Finance sent back (both classes; not those on a
        // sent-back PO, which come back with it) — two tabs, two cards.
        sentBack: [
          {
            n: team.poSentBack ?? 0, href: NAV_COUNT_HREF.poSentBack, noun: ["purchase order", "purchase orders"],
            meta: "Correct them and save to send them on",
          },
          {
            n: team.assetsSentBackPurchasing ?? 0, href: NAV_COUNT_HREF.assetsSentBackPurchasing, noun: ["asset", "assets"],
            meta: "Finance sent these back · fix them and send them on",
          },
        ],
      },
      purchasingNeeds(todo, overdue, stock.low, lowHref, today),
    ),
    needsYouHref: "/purchases",
    trend,
    makeUp: requestStateMakeUp(states),
    breakdown: {
      title: "Spend this month by supplier",
      sub: "Registered purchase orders · top 7 suppliers and Other",
      rows: suppliers.map((r) => ({ label: r.label, value: cents(r.value) })),
      money: true,
    },
  };
}

// ── Finance ───────────────────────────────────────────────────────────────

/** Spec §3.2 Finance trend: 12 months. */
const TREND_MONTHS = 12;

/** /finance/assets?fin=with-finance (and &cls=PURCHASING): the page's own "To review" chip count. */
function toConfirmCount(cls: AssetClass): Promise<number> {
  return prisma.asset.count({ where: financeViewWhere(cls, "with-finance") });
}

const FINANCE_KEYS = [
  "fin.waitingC", "fin.waitingCount", "fin.toConfirm.it", "fin.toConfirm.purchasing", "fin.bookC",
] as const satisfies readonly SnapshotKey[];

/**
 * Spec §3.2, the Finance row, with the builder-check rulings:
 * - Groups to review is the /finance/review queue's count (financeWaitingRows reads exactly reviewGroups, Task 6);
 * - To confirm sums the two classes' "To review" chips (hint "N IT · N Purchasing") and links to the IT view;
 * - Waiting on you (₱), Approved this month (a count, its ₱ in the hint), Capitalized this month and Book value are
 *   plain cards: no page shows those numbers (review ruling for Book value).
 */
export async function financeOverview(user: Viewer, now: Date = new Date()): Promise<Overview> {
  const quarterStart = quarterStartManila(now);
  // One read per source over the widest window it serves: completed spend for the sparkline's 8 weeks and this Manila
  // quarter (the department breakdown); capitalised assets for the 12-month trend, which holds the 8 weeks.
  const [waiting, approved, capitalized, book, toConfirmIt, toConfirmPurchasing, history] = await Promise.all([
    financeWaitingRows(),
    completedSpend(earliest(sparkSince(now), quarterStart)),
    capitalizedSince(earliest(sparkSince(now), monthWindowStart(now, TREND_MONTHS))),
    bookValueByCategory(now),
    toConfirmCount("IT"),
    toConfirmCount("PURCHASING"),
    metricHistory<SnapshotKey>([...FINANCE_KEYS], now),
  ]);
  const departments = rankByLabel(
    approved.map((r) => ({ at: r.at, amount: r.amount, label: r.department })), quarterStart, "No department", SPEND_TOP,
  );
  const oldest = waiting[0];
  const toConfirm = toConfirmIt + toConfirmPurchasing;
  const waitingHref = "/finance/review";

  const kpis: KpiTile[] = [
    moneyHistoryTile(
      {
        key: "fin.waitingC", label: "Waiting on you", upIs: "bad",
        hint: oldest ? `oldest ${plural(waitingDays(oldest, now), "day", "days")}` : "Nothing waiting",
      },
      waiting.reduce((sum, r) => sum + Number(r.total), 0), history["fin.waitingC"],
    ),
    historyTile(
      { key: "fin.waitingCount", label: "Groups to review", hint: "Registered, waiting for your review", upIs: "bad", href: waitingHref },
      waiting.length, history["fin.waitingCount"],
    ),
    monthToDateTile({ key: "approved.month", label: "Approved this month", upIs: "neutral" }, approved, now, {
      money: false, hint: (m) => `${fmtMoney(cents(pesosOf(m)))} completed`,
    }),
    monthToDateTile({ key: "capitalized.month", label: "Capitalized this month", upIs: "neutral" }, capitalized, now, {
      money: true, hint: (m) => plural(m.length, "asset", "assets"),
    }),
    // Review ruling: a plain card — no page shows the all-class book value total.
    moneyHistoryTile(
      { key: "fin.bookC", label: "Book value", hint: "After depreciation · as of today", upIs: "neutral" },
      book.bookC / 100, history["fin.bookC"],
    ),
    historyTile(
      {
        key: "fin.toConfirm", label: "To confirm", hint: `${toConfirmIt} IT · ${toConfirmPurchasing} Purchasing`, upIs: "bad",
        href: "/finance/assets?fin=with-finance",
      },
      toConfirm, sumHistories([history["fin.toConfirm.it"], history["fin.toConfirm.purchasing"]]),
    ),
  ];

  return {
    kpis,
    // Task 7 (spec §7): "N to check" is the review queue's own count (reviewGroups, as finGroupsToReview counts it).
    needsYou: withTeamCards(
      { toCheck: { n: waiting.length, href: waitingHref, meta: "Registration groups waiting for your review" }, toCheckIcon: "approval" },
      financeNeeds(financeQueue(waiting, now), { it: toConfirmIt, purchasing: toConfirmPurchasing }),
    ),
    needsYouHref: waitingHref,
    trend: {
      title: "Capitalized per month",
      unit: "₱",
      period: "month",
      labels: monthLabels(now, TREND_MONTHS),
      series: [{ name: "Capitalized", values: monthBuckets(capitalized, now, TREND_MONTHS).map(cents) }],
    },
    makeUp: bookValueMakeUp(book.rows),
    breakdown: {
      title: "Approved spend by department",
      sub: "Registered purchase orders this quarter · top 7 and Other",
      rows: departments.map((r) => ({ label: r.label, value: cents(r.value) })),
      money: true,
    },
  };
}

// ── Admin ─────────────────────────────────────────────────────────────────

/** Spec §3.2 Admin trend: direct changes per day, 14 days; make-up: deliveries in the last 7 days. */
const DIRECT_DAYS = 14;
const DELIVERY_DAYS = 7;

const ADMIN_KEYS = ["admin.activeUsers", "admin.deadDeliveries", "admin.disabled"] as const satisfies readonly SnapshotKey[];

/**
 * Spec §3.2, the Admin row, with the builder-check rulings:
 * - Active accounts → /admin/users?disabled=0 and Disabled accounts → ?disabled=1 (the filters arrive in Task 6);
 * - Webhook deliveries failed is the Dead-lettered tab's count (every DEAD delivery);
 * - Approvals open is the Approvals page's Open tab in the role's classes (admin: all), as on IT;
 * - Direct changes (the last 7 Manila days) and Flags on ("x of y", no sparkline) are plain cards.
 */
export async function adminOverview(user: Viewer, now: Date = new Date()): Promise<Overview> {
  const openKeys = approvalsOpenKeys(user.role);
  // One direct-change read: the sparkline's 8 weeks hold the trend's 14 days.
  const [admin, approvals, history, direct, deliveries, failing, lockedOut] = await Promise.all([
    adminHome(),
    approvalsOpenCounts(user, now),
    metricHistory<SnapshotKey>([...ADMIN_KEYS, ...openKeys], now),
    directChangeRows(sparkSince(now)),
    deliveriesByStatus(now, DELIVERY_DAYS),
    failingEndpoints(),
    disabledAdmins(),
  ]);
  // Direct changes has no snapshot key: its weekly points are counted from the dated rows (spec §3.2), the last one
  // being the tile's value (this Manila week), so "vs last week" is this week's count minus last week's.
  const directWeeks = weekBuckets(direct.map((r) => r.at), now, HISTORY_POINTS);
  const directNow = directWeeks[HISTORY_POINTS - 1];
  const perDay = directChangesPerDay(direct, now, DIRECT_DAYS);
  const flagsOn = admin.flags.filter((f) => f.enabled).length;
  const unavailable = admin.flags.filter((f) => f.unavailable);

  const kpis: KpiTile[] = [
    historyTile(
      { key: "admin.activeUsers", label: "Active accounts", hint: "Can sign in", upIs: "neutral", href: "/admin/users?disabled=0" },
      admin.users.total - admin.users.disabled, history["admin.activeUsers"],
    ),
    historyTile(
      {
        key: "admin.deadDeliveries", label: "Webhook deliveries failed", hint: "Dead-lettered, waiting on a replay", upIs: "bad",
        href: "/admin/webhooks/deliveries?state=DEAD",
      },
      admin.webhooks.dead, history["admin.deadDeliveries"],
    ),
    {
      key: "direct.week", label: "Direct changes", value: directNow, hint: "Last 7 days, applied without the queue",
      upIs: "neutral", spark: directWeeks, delta: countDelta(directNow, directWeeks[WEEK_AGO] ?? null),
    },
    {
      key: "flags.on", label: "Flags on", value: flagsOn, display: `${flagsOn} of ${admin.flags.length}`,
      hint: unavailable.length ? `${unavailable.length} unavailable in this build` : "Every flag available",
      upIs: "neutral", spark: [], delta: { kind: "none" },
    },
    approvalsTile(approvals, openKeys.map((k) => history[k])),
    historyTile(
      { key: "admin.disabled", label: "Disabled accounts", hint: "Blocked from signing in", upIs: "neutral", href: "/admin/users?disabled=1" },
      admin.users.disabled, history["admin.disabled"],
    ),
  ];

  return {
    kpis,
    needsYou: adminNeeds({
      dead: admin.webhooks.dead,
      failing,
      disabledAdmins: lockedOut,
      unavailableFlags: unavailable.map((f) => ({ key: f.key, label: f.label })),
    }),
    needsYouHref: "/admin/webhooks",
    trend: {
      title: "Direct changes per day",
      unit: "changes",
      period: "day",
      labels: perDay.labels,
      series: [{ name: "IT", values: perDay.it }, { name: "Purchasing", values: perDay.purchasing }],
    },
    makeUp: deliveryMakeUp(deliveries),
    breakdown: roleRanked(admin.users.byRole),
  };
}
