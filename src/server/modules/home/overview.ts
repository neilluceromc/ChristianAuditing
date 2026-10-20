import { Prisma, type AssetClass, type Role, type User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { approvalClassKeys, approvalClassWhere, isApprover } from "@/lib/approval-access";
import { tabWhere } from "@/lib/approvals-list";
import { defaultClassFor, withViewClsQS } from "@/lib/asset-class";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { TILE_SPECS, tileState } from "@/lib/inventory-tiles";
import {
  countDelta, fleetMakeUp, itMove, IT_MOVE_ACTIONS, kitGapRanked, liveSpark, needsFromWork, sumHistories, weekBuckets,
  weekLabels, weekWindowStart, type ItMove, type KpiTile, type MoveEntry, type Overview, type TrendSeries,
} from "@/lib/overview";
import { HISTORY_POINTS, type SnapshotKey } from "@/lib/snapshot";
import { parseListState, serializeListState } from "@/lib/url-state";
import { metricHistory } from "@/server/modules/metrics/history";
import { inventoryTileCounts } from "@/server/modules/inventory/queries";
import { kitGapsByGroup } from "@/server/modules/employees/queries";
import { claimedByYou, fleet, worklist } from "./queries";

/** Spec §3.1: the trend chart's 12 points. */
const TREND_WEEKS = 12;
/** The point 7 days before today in an 8-point weekly history. */
const WEEK_AGO = HISTORY_POINTS - 2;

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
export async function itOverview(user: Pick<User, "id" | "role">, now: Date = new Date()): Promise<Overview> {
  const viewer = user.role === "viewer";
  const approvalScope = approvalClassWhere(user.role);
  const openWhere = tabWhere("open", user.id);
  const openKeys = approvalClassKeys(user.role).map((k) => `approvals.open.${k}` as const);

  const [tiles, approvalsOpen, approvalsPastSla, history, groups, claims, fleetData, trend, gaps] = await Promise.all([
    inventoryTileCounts(parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG), null, "IT", now),
    prisma.approval.count({ where: { AND: [openWhere, approvalScope] } }),
    prisma.approval.count({ where: { AND: [openWhere, { slaAt: { lt: now } }, approvalScope] } }),
    metricHistory<SnapshotKey>([...IT_TILES.map((t) => t.key), ...openKeys], now),
    worklist(user.id, user.role, { limit: 6, excludeOwnClaims: !viewer }, now),
    isApprover(user.role) ? claimedByYou(user.id, user.role, now) : Promise.resolve([]),
    fleet(now),
    itTrend(now),
    kitGapsByGroup(now),
  ]);

  const kpis: KpiTile[] = IT_TILES.map((t) => {
    const value = tiles[t.tile] ?? 0;
    return {
      key: t.key, label: t.label, value, hint: t.hint, upIs: t.upIs,
      href: inventoryTileHref(t.tile, "IT", user.role),
      spark: liveSpark(history[t.key], value),
      delta: countDelta(value, history[t.key][WEEK_AGO] ?? null),
    };
  });
  const approvalsHistory = sumHistories(openKeys.map((k) => history[k]));
  kpis.push({
    key: "approvals.open", label: "Approvals open", value: approvalsOpen, href: "/approvals",
    hint: `${approvalsPastSla} past SLA`, upIs: "bad",
    spark: liveSpark(approvalsHistory, approvalsOpen),
    delta: countDelta(approvalsOpen, approvalsHistory[WEEK_AGO] ?? null),
  });

  return {
    kpis,
    needsYou: needsFromWork(groups, claims, !viewer),
    needsYouHref: "/inventory/work",
    trend,
    makeUp: fleetMakeUp(fleetData),
    breakdown: kitGapRanked(gaps),
  };
}
