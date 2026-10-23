import type { AssetStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { approvalClassWhere } from "@/lib/approval-access";
import type { ApprovalsBadge } from "@/lib/nav-badges";
import type { CountKey } from "@/lib/workspaces";
import { parseListState } from "@/lib/url-state";
import { buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { buildEmployeeWhere, EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { parsePurchaseState, purchaseWhere, TO_REGISTER_HREF } from "@/lib/purchases-list";
import { STOCK_LIST_CONFIG } from "@/lib/stock-list";
import { buildSupplierWhere, SUPPLIER_LIST_CONFIG } from "@/lib/supplier-list";
import { parseCls } from "@/lib/asset-class";
import { parseFin } from "@/lib/registration";
import { FLAG_SPECS } from "@/lib/admin-flags";
import { filterFlags, parseFlagsState, parseUsersDisabled, parseUsersFilter, usersListWhere, usersWhere } from "@/lib/admin-lists";
import { deliveryTabWhere, parseDeliveryTab } from "@/lib/webhooks";
import { localDateISO } from "@/lib/format";
import { stockLowCount, stocktakesOverdueWhere } from "@/server/modules/stock/queries";
import { financeViewWhere } from "@/server/modules/finance/queries";
import { reviewGroupCount } from "@/server/modules/finance/groups";
import { purchasingToRegisterCount } from "@/server/modules/purchases/to-register";
import { worklistCount } from "./queries";
import { SENT_BACK_COUNT_KEY, sentBackChipTeams, type SentBackChip } from "@/lib/sent-back-chip";

/**
 * The view each list count stands for (spec §4.3: the count equals the page's row count for that URL). Asserted
 * equal to the views' hrefs in WORKSPACE_NAV (nav-counts.test.ts). No `cls`: every role that sees IT's Inventory
 * views opens /inventory on IT, so the page's class for these URLs is IT.
 */
export const NAV_COUNT_HREF = {
  itSpare: "/inventory?status=SPARE",
  itDefective: "/inventory?status=DEFECTIVE&sort=defectiveSince",
  itMissing: "/inventory?status=MISSING",
  // Task 7 (spec §7): what Finance sent back to IT / to Purchasing, from state (the asset's return), never from the
  // bell's reads. A Sent back view spans both classes (sentBackToTeamWhere), so the class these URLs open on is moot.
  itSentBack: "/inventory?reg=needs-correction&to=IT",
  assetsSentBackPurchasing: "/inventory?reg=needs-correction&to=PURCHASING",
  leaving: "/employees?employment=OFFBOARDING",
  // Migration 38: the purchase-order tabs (prDraft → poSentBack, prSubmitted → poWithIt, prItReviewed → poReady).
  poSentBack: "/purchases?state=SENT_BACK",
  poWithIt: "/purchases?state=WITH_IT",
  poReady: "/purchases?state=READY",
  // Task 7: Purchasing's To register view; the page lists exactly purchasingToRegisterIds(), which this counts.
  poToRegister: TO_REGISTER_HREF,
  // Phase 46 spec §4.3
  stockLow: "/stock?low=1",
  suppliersRenewing: "/purchases/suppliers?renewing=30",
  finToConfirmIt: "/finance/assets?fin=with-finance",
  finToConfirmPurchasing: "/finance/assets?cls=PURCHASING&fin=with-finance",
  // Task 6 (spec §5): Finance's group queue; the page lists exactly reviewGroups(), which reviewGroupCount counts.
  finGroupsToReview: "/finance/review",
  usersDisabled: "/admin/users?disabled=1",
  // Users & access (spec §4.4): the sign-ups waiting for an admin
  pendingSignups: "/admin/users?status=PENDING",
  deadDeliveries: "/admin/webhooks/deliveries?state=DEAD",
  flagsUnavailable: "/admin/flags?state=unavailable",
} as const satisfies Partial<Record<CountKey, string>>;

/**
 * Counts that sit on a view whose page lists more than the count, because the page has no filter for it (Phase 46
 * spec §4.3: the Stocktakes view shows how many are overdue; /stock/stocktakes lists every stocktake). They are never
 * asserted equal to the page's rows; nav-counts.test.ts asserts each sits on exactly this view.
 */
export const NAV_COUNT_UNFILTERED = {
  stocktakesOverdue: "/stock/stocktakes",
} as const satisfies Partial<Record<CountKey, string>>;

type User = { id: string; role: Role };
type ReadKey = Exclude<CountKey, "approvals">;

const paramsOf = (key: keyof typeof NAV_COUNT_HREF) => new URL(NAV_COUNT_HREF[key], "http://nav.local").searchParams;

/** The IT status views and the one status each filters on (asserted against NAV_COUNT_HREF in nav-counts.test.ts). */
const IT_STATUS = { itSpare: "SPARE", itDefective: "DEFECTIVE", itMissing: "MISSING" } as const satisfies Record<
  "itSpare" | "itDefective" | "itMissing",
  AssetStatus
>;
type ItStatusKey = keyof typeof IT_STATUS;
const isItStatusKey = (key: CountKey): key is ItStatusKey => key in IT_STATUS;

// /inventory: parseListState → buildAssetWhere(state, purchaseYear = null, cls); listAssets counts that where.
const assetViewWhere = (key: ItStatusKey) =>
  buildAssetWhere(parseListState(paramsOf(key), INVENTORY_LIST_CONFIG), null, "IT");

/**
 * Phase 43: the IT status counts as ONE grouped read. The where is a view's where with its status filter swapped for
 * every asked-for status: the three views' wheres differ only in that filter (nav-counts.test.ts proves each equals
 * this where narrowed back to its one status), so each status's group is exactly the old per-view count.
 */
function itStatusWhere(keys: ItStatusKey[]): Prisma.AssetWhereInput {
  const where = { ...assetViewWhere(keys[0]) };
  delete where.status;
  return { ...where, status: { in: keys.map((k) => IT_STATUS[k]) } };
}

/**
 * Read only when at least one of the three is asked for; a status with no group is 0. One query, so one failure:
 * it zeroes every asked-for key and logs once per key, in the message format every other count uses.
 */
async function readItStatusCounts(keys: ItStatusKey[]): Promise<Array<[ItStatusKey, number]>> {
  if (keys.length === 0) return [];
  try {
    const groups = await prisma.asset.groupBy({ by: ["status"], where: itStatusWhere(keys), _count: { _all: true } });
    const byStatus = new Map(groups.map((g) => [g.status, g._count._all]));
    return keys.map((key) => [key, byStatus.get(IT_STATUS[key]) ?? 0]);
  } catch (err: unknown) {
    return keys.map((key) => {
      console.error(`[nav counts] ${key} failed:`, err);
      return [key, 0];
    });
  }
}

// Task 7 (spec §7): /inventory's own where for a Sent back view: the needs-correction state narrowed to what went back
// to the team (sentBackToTeamWhere), both classes. It drops when someone fixes it and sends it on, not when read.
const sentBack = (key: "itSentBack" | "assetsSentBackPurchasing") => () =>
  prisma.asset.count({ where: buildAssetWhere(parseListState(paramsOf(key), INVENTORY_LIST_CONFIG), null, "IT") });

// /employees: parseListState → buildEmployeeWhere(state); pageEmployees counts that where (no gaps, no loadout sort).
const employees = (key: "leaving") => () =>
  prisma.employee.count({ where: buildEmployeeWhere(parseListState(paramsOf(key), EMPLOYEES_LIST_CONFIG)) });

// /purchases: parsePurchaseState(state) → purchaseWhere(state, q = "", no department, no supplier); listPurchases
// counts that where.
const purchases = (key: "poSentBack" | "poWithIt" | "poReady") => () =>
  prisma.purchaseOrder.count({ where: purchaseWhere(parsePurchaseState(paramsOf(key).get("state")), "") });

// Phase 46 spec §4.3: each new count reads its view's URL the way the page does.

// /stock: parseListState → listStockItems' lowCount (stockLowCount); with low=1 the page lists exactly those items.
const stockLow = () => stockLowCount(parseListState(paramsOf("stockLow"), STOCK_LIST_CONFIG));

// The Purchasing overview's Stocktakes overdue (stockHomeSignals), on today's Manila day. Exempt: see above.
const stocktakesOverdue = () => prisma.stocktake.count({ where: stocktakesOverdueWhere(localDateISO()) });

// /purchases/suppliers: parseListState → buildSupplierWhere(state) (today = the Manila day); listSuppliers counts it.
const suppliersRenewing = () =>
  prisma.vendor.count({ where: buildSupplierWhere(parseListState(paramsOf("suppliersRenewing"), SUPPLIER_LIST_CONFIG)) });

// /finance/assets: cls (IT unless PURCHASING) and fin as the page parses them; financeAssets counts financeViewWhere.
const toConfirm = (key: "finToConfirmIt" | "finToConfirmPurchasing") => () => {
  const params = paramsOf(key);
  return prisma.asset.count({ where: financeViewWhere(parseCls(params.get("cls")) ?? "IT", parseFin(params.get("fin"))!) });
};

// /admin/users: parseUsersDisabled → usersWhere; listUsers counts it.
const usersDisabled = () =>
  prisma.user.count({ where: usersWhere(parseUsersDisabled(paramsOf("usersDisabled").get("disabled"))) });

// Users & access (spec §4.4) /admin/users: parseUsersFilter → usersListWhere; listUsers counts it (and its
// pendingCount is the same where).
const pendingSignups = () =>
  prisma.user.count({ where: usersListWhere(parseUsersFilter(paramsOf("pendingSignups"))) });

// /admin/webhooks/deliveries: parseDeliveryTab → deliveryTabWhere; listDeliveries counts it.
const deadDeliveries = () =>
  prisma.webhookDelivery.count({ where: deliveryTabWhere(parseDeliveryTab(paramsOf("deadDeliveries").get("state"))) });

// /admin/flags: listFlags is FLAG_SPECS-driven and `unavailable` is the spec's, so the filter needs no query.
const flagsUnavailable = () =>
  Promise.resolve(filterFlags(FLAG_SPECS, parseFlagsState(paramsOf("flagsUnavailable").get("state"))).length);

// Spec §5.3 / Phase 40 §6: the Worklist count is admin's and IT's only, as before.
const reviewer = (user: User) => user.role === "admin" || user.role === "it_staff";

const READERS: Record<Exclude<ReadKey, ItStatusKey>, (user: User) => Promise<number>> = {
  worklist: (user) => (reviewer(user) ? worklistCount(user.id, user.role) : Promise.resolve(0)),
  leaving: employees("leaving"),
  poSentBack: purchases("poSentBack"),
  poWithIt: purchases("poWithIt"),
  poReady: purchases("poReady"),
  itSentBack: sentBack("itSentBack"),
  assetsSentBackPurchasing: sentBack("assetsSentBackPurchasing"),
  poToRegister: () => purchasingToRegisterCount(),
  stockLow,
  stocktakesOverdue,
  suppliersRenewing,
  finToConfirmIt: toConfirm("finToConfirmIt"),
  finToConfirmPurchasing: toConfirm("finToConfirmPurchasing"),
  finGroupsToReview: () => reviewGroupCount(),
  usersDisabled,
  pendingSignups,
  deadDeliveries,
  flagsUnavailable,
};

/**
 * The `approvals` count: open approvals in the role's classes, and how many of them are past their SLA (the red).
 * Like every nav count it fails to 0 with a console.error (spec §4.3): it sits in the layout's Promise.all, so a
 * throw here would fail every page's shell.
 */
export async function getApprovalsBadge(role: Role): Promise<ApprovalsBadge> {
  try {
    const scope = approvalClassWhere(role);
    const [open, overdue] = await Promise.all([
      prisma.approval.count({ where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] } }, scope] } }),
      prisma.approval.count({
        where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: new Date() } }, scope] },
      }),
    ]);
    return { open, overdue };
  } catch (err: unknown) {
    console.error("[nav counts] approvals failed:", err);
    return { open: 0, overdue: 0 };
  }
}

/**
 * The nav's counts for the keys asked for, read in parallel. `approvals` is not read here (the layout feeds it from
 * getApprovalsBadge). Each read fails to 0 with a console.error, so a failed count hides its badge rather than
 * failing every page's shell; the IT status counts share one read (Phase 43), so they fail together.
 */
export async function readNavCounts(keys: CountKey[], user: User): Promise<Partial<Record<CountKey, number>>> {
  const wanted = [...new Set(keys)].filter((k): k is ReadKey => k !== "approvals");
  const [statusEntries, entries] = await Promise.all([
    readItStatusCounts(wanted.filter(isItStatusKey)),
    Promise.all(
      wanted
        .filter((k): k is Exclude<ReadKey, ItStatusKey> => !isItStatusKey(k))
        .map(async (key): Promise<[ReadKey, number]> => {
          try {
            return [key, await READERS[key](user)];
          } catch (err: unknown) {
            console.error(`[nav counts] ${key} failed:`, err);
            return [key, 0];
          }
        }),
    ),
  ]);
  return Object.fromEntries([...entries, ...statusEntries]);
}

/**
 * 2026-10-23: Inventory's "Sent back · N" chips — the viewer's own team's (an admin: each team's), only the teams with
 * something sent back. The same counts and views as the sidebar's "Sent back" links, so they never disagree; like them,
 * a failed read is 0, which hides the chip.
 */
export async function readSentBackChips(user: User): Promise<SentBackChip[]> {
  const teams = sentBackChipTeams(user.role);
  if (teams.length === 0) return [];
  const counts = await readNavCounts(teams.map((t) => SENT_BACK_COUNT_KEY[t]), user);
  return teams
    .map((team) => ({ team, count: counts[SENT_BACK_COUNT_KEY[team]] ?? 0, href: NAV_COUNT_HREF[SENT_BACK_COUNT_KEY[team]] }))
    .filter((c) => c.count > 0);
}
