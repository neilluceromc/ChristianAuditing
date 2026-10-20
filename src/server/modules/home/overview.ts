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
  adminNeeds, bookValueMakeUp, countDelta, deliveryMakeUp, financeNeeds, fleetMakeUp, itMove, IT_MOVE_ACTIONS,
  kitGapRanked, liveSpark, needsFromWork, pctDelta, pesosHistory, purchasingNeeds, requestStateMakeUp, roleRanked,
  sumHistories, sumWeekBuckets, weekBuckets, weekLabels, weekOverWeek, weekWindowStart,
  type Delta, type ItMove, type KpiTile, type MoveEntry, type Overview, type TrendSeries,
} from "@/lib/overview";
import { PURCHASE_TABS, type PurchaseTabId } from "@/lib/purchases-list";
import { finWhere } from "@/lib/registration";
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
import { financeListWhere } from "@/server/modules/finance/queries";
import { bookValueByCategory, capitalizedByMonth, capitalizedSince } from "@/server/modules/finance/depreciation-queries";
import { adminHome, deliveriesByStatus, disabledAdmins, failingEndpoints } from "@/server/modules/admin/queries";
import {
  claimedByYou, completedSpend, directChangeRows, directChangesByDay, financeQueue, financeWaitingRows, fleet,
  purchasingTodo, spendByDepartment, spendBySupplier, unitsValue, waitingDays, worklist,
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
/** A money delta to the centavo (the difference of two rounded totals can carry float noise). */
const centsDelta = (d: Delta): Delta => (d.kind === "none" ? d : { ...d, value: cents(d.value) });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

/** The first instant a month-to-date tile reads: this Manila month's start, or the sparkline's first week if earlier. */
function monthToDateSince(now: Date): Date {
  const month = monthStartManila(now);
  const weeks = weekWindowStart(now, HISTORY_POINTS);
  return month < weeks ? month : weeks;
}

/**
 * Builder-check ruling, month-to-date money tiles: the value is the Manila month to date, the sparkline the last 8
 * weekly totals, and the delta this week's total against last week's ("this week vs last week"). `rows` must reach
 * back to monthToDateSince(now).
 */
function monthToDateTile(
  t: Omit<TileSpec, "hint">, rows: { at: Date; amount: number }[], now: Date, hint: (count: number) => string,
): KpiTile {
  const monthStart = monthStartManila(now);
  const inMonth = rows.filter((r) => r.at >= monthStart);
  const value = cents(inMonth.reduce((sum, r) => sum + r.amount, 0));
  const spark = sumWeekBuckets(rows, now, HISTORY_POINTS).map(cents);
  return {
    key: t.key, label: t.label, value, money: true, display: fmtMoney(value), hint: hint(inMonth.length), upIs: t.upIs,
    ...(t.href ? { href: t.href } : {}),
    spark,
    delta: centsDelta(weekOverWeek(spark)),
  };
}

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

  const [tiles, approvals, history, groups, claims, fleetData, trend, gaps] = await Promise.all([
    inventoryTileCounts(parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG), null, "IT", now),
    approvalsOpenCounts(user, now),
    metricHistory<SnapshotKey>([...IT_TILES.map((t) => t.key), ...openKeys], now),
    worklist(user.id, user.role, { limit: 6, excludeOwnClaims: !viewer }, now),
    isApprover(user.role) ? claimedByYou(user.id, user.role, now) : Promise.resolve([]),
    fleet(now),
    itTrend(now),
    kitGapsByGroup(now),
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
    needsYou: needsFromWork(groups, claims, !viewer),
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

/** Spec §3.2 Purchasing trend: requests created and requests completed per Manila week, 12 weeks. */
async function purchaseFlowTrend(now: Date): Promise<TrendSeries> {
  const since = weekWindowStart(now, TREND_WEEKS);
  const [created, completed] = await Promise.all([
    prisma.purchaseRequest.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.purchaseRequest.findMany({ where: { state: "COMPLETED", completedAt: { gte: since } }, select: { completedAt: true } }),
  ]);
  return {
    title: "Requests per week",
    unit: "requests",
    labels: weekLabels(now, TREND_WEEKS),
    series: [
      { name: "Created", values: weekBuckets(created.map((r) => r.createdAt), now, TREND_WEEKS) },
      { name: "Completed", values: weekBuckets(completed.map((r) => r.completedAt!), now, TREND_WEEKS) },
    ],
  };
}

const PURCHASING_KEYS = [
  "pr.submitted", "pr.itReviewed", "stock.low", "stock.expiringLots", "stock.stocktakesOverdue",
] as const satisfies readonly SnapshotKey[];

/**
 * Spec §3.2, the Purchasing row. Linked values are read the way their pages count them:
 * - Awaiting IT / Awaiting finance are stateCounts() — the /purchases tab counts — linked to those tabs;
 * - Below reorder and Lots expiring are stockHomeSignals(), the counts /stock?low=1 and the expiry report's Expiring
 *   tab (30-day window) list;
 * - Spend this month (Manila month, completed requests) and Stocktakes overdue are plain cards: no page lists exactly
 *   that set (/stock/stocktakes has no overdue filter).
 */
export async function purchasingOverview(user: Viewer, now: Date = new Date()): Promise<Overview> {
  const today = localDateISO(now);
  const [states, stock, spend, suppliers, todo, overdue, history, trend] = await Promise.all([
    stateCounts(),
    stockHomeSignals(today),
    completedSpend(monthToDateSince(now)),
    spendBySupplier(now),
    purchasingTodo(user.id, now),
    overdueStocktakes(today),
    metricHistory<SnapshotKey>([...PURCHASING_KEYS], now),
    purchaseFlowTrend(now),
  ]);
  const lowHref = stockLowHref();

  const kpis: KpiTile[] = [
    historyTile(
      { key: "pr.submitted", label: "Awaiting IT", hint: "Submitted, waiting for IT's review", upIs: "bad", href: purchaseTabHref("SUBMITTED") },
      states.SUBMITTED ?? 0, history["pr.submitted"],
    ),
    historyTile(
      { key: "pr.itReviewed", label: "Awaiting finance", hint: "Reviewed by IT, waiting for Finance", upIs: "bad", href: purchaseTabHref("IT_REVIEWED") },
      states.IT_REVIEWED ?? 0, history["pr.itReviewed"],
    ),
    monthToDateTile(
      { key: "spend.month", label: "Spend this month", upIs: "neutral" }, spend, now,
      (n) => `${plural(n, "request", "requests")} completed`,
    ),
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
    needsYou: purchasingNeeds(todo, overdue, stock.low, lowHref, today),
    needsYouHref: "/purchases",
    trend,
    makeUp: requestStateMakeUp(states),
    breakdown: {
      title: "Spend this month by supplier",
      sub: "Completed requests · top 7 suppliers and Other",
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
  return prisma.asset.count({ where: { AND: [financeListWhere({ cls, status: null, q: "" }), finWhere("with-finance")] } });
}

const FINANCE_KEYS = [
  "fin.waitingC", "fin.waitingCount", "fin.toConfirm.it", "fin.toConfirm.purchasing", "fin.bookC",
] as const satisfies readonly SnapshotKey[];

/**
 * Spec §3.2, the Finance row, with the builder-check rulings:
 * - Requests waiting is the /purchases "Awaiting finance" tab's count (financeWaitingRows reads exactly that state);
 * - To confirm sums the two classes' "To review" chips (hint "N IT · N Purchasing") and links to the IT view;
 * - Book value links to /finance/depreciation;
 * - Waiting on you (₱), Approved this month and Capitalized this month are plain cards (no page shows those sums).
 */
export async function financeOverview(user: Viewer, now: Date = new Date()): Promise<Overview> {
  const since = monthToDateSince(now);
  const [waiting, approved, capitalized, book, toConfirmIt, toConfirmPurchasing, history, perMonth, departments] = await Promise.all([
    financeWaitingRows(),
    completedSpend(since),
    capitalizedSince(since),
    bookValueByCategory(now),
    toConfirmCount("IT"),
    toConfirmCount("PURCHASING"),
    metricHistory<SnapshotKey>([...FINANCE_KEYS], now),
    capitalizedByMonth(now, TREND_MONTHS),
    spendByDepartment(now),
  ]);
  const oldest = waiting[0];
  const toConfirm = toConfirmIt + toConfirmPurchasing;
  const waitingHref = purchaseTabHref("IT_REVIEWED");

  const kpis: KpiTile[] = [
    moneyHistoryTile(
      {
        key: "fin.waitingC", label: "Waiting on you", upIs: "bad",
        hint: oldest ? `oldest ${plural(waitingDays(oldest, now), "day", "days")}` : "Nothing waiting",
      },
      waiting.reduce((sum, r) => sum + unitsValue(r.units), 0), history["fin.waitingC"],
    ),
    historyTile(
      { key: "fin.waitingCount", label: "Requests waiting", hint: "Reviewed by IT, waiting for you", upIs: "bad", href: waitingHref },
      waiting.length, history["fin.waitingCount"],
    ),
    monthToDateTile(
      { key: "approved.month", label: "Approved this month", upIs: "neutral" }, approved, now,
      (n) => `${plural(n, "request", "requests")} completed`,
    ),
    monthToDateTile(
      { key: "capitalized.month", label: "Capitalized this month", upIs: "neutral" }, capitalized, now,
      (n) => plural(n, "asset", "assets"),
    ),
    moneyHistoryTile(
      { key: "fin.bookC", label: "Book value", hint: "After depreciation · as of today", upIs: "neutral", href: "/finance/depreciation" },
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
    needsYou: financeNeeds(financeQueue(waiting, now), { it: toConfirmIt, purchasing: toConfirmPurchasing }),
    needsYouHref: waitingHref,
    trend: {
      title: "Capitalized per month",
      unit: "₱",
      labels: perMonth.labels,
      series: [{ name: "Capitalized", values: perMonth.values.map(cents) }],
    },
    makeUp: bookValueMakeUp(book.rows.map((r) => ({ label: r.label, value: r.bookC / 100 }))),
    breakdown: {
      title: "Approved spend by department",
      sub: "Completed requests this quarter · top 7 and Other",
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
  const [admin, approvals, history, direct, perDay, deliveries, failing, lockedOut] = await Promise.all([
    adminHome(),
    approvalsOpenCounts(user, now),
    metricHistory<SnapshotKey>([...ADMIN_KEYS, ...openKeys], now),
    directChangeRows(weekWindowStart(now, HISTORY_POINTS)),
    directChangesByDay(now, DIRECT_DAYS),
    deliveriesByStatus(now, DELIVERY_DAYS),
    failingEndpoints(),
    disabledAdmins(),
  ]);
  // Direct changes has no snapshot key: its weekly points are counted from the dated rows (spec §3.2), the last one
  // being the tile's value (this Manila week), so "vs last week" is this week's count minus last week's.
  const directWeeks = weekBuckets(direct.map((r) => r.at), now, HISTORY_POINTS);
  const directNow = directWeeks[HISTORY_POINTS - 1];
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
      labels: perDay.labels,
      series: [{ name: "IT", values: perDay.it }, { name: "Purchasing", values: perDay.purchasing }],
    },
    makeUp: deliveryMakeUp(deliveries),
    breakdown: roleRanked(admin.users.byRole),
  };
}
