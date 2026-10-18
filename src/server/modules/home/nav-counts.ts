import type { AssetStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { approvalClassWhere } from "@/lib/approval-access";
import type { ApprovalsBadge } from "@/lib/nav-badges";
import type { CountKey } from "@/lib/workspaces";
import { parseListState } from "@/lib/url-state";
import { buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { buildEmployeeWhere, EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";
import { parsePurchaseState, purchaseWhere } from "@/lib/purchases-list";
import { purchaseReviewCount, worklistCount } from "./queries";

/**
 * The view each list count stands for (spec §4.3: the count equals the page's row count for that URL). Asserted
 * equal to the views' hrefs in WORKSPACE_NAV (nav-counts.test.ts). No `cls`: every role that sees IT's Inventory
 * views opens /inventory on IT, so the page's class for these URLs is IT.
 */
export const NAV_COUNT_HREF = {
  itSpare: "/inventory?status=SPARE",
  itDefective: "/inventory?status=DEFECTIVE&sort=defectiveSince",
  itMissing: "/inventory?status=MISSING",
  leaving: "/employees?employment=OFFBOARDING",
  prDraft: "/purchases?state=DRAFT",
  prSubmitted: "/purchases?state=SUBMITTED",
  prItReviewed: "/purchases?state=IT_REVIEWED",
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

// /employees: parseListState → buildEmployeeWhere(state); pageEmployees counts that where (no gaps, no loadout sort).
const employees = (key: "leaving") => () =>
  prisma.employee.count({ where: buildEmployeeWhere(parseListState(paramsOf(key), EMPLOYEES_LIST_CONFIG)) });

// /purchases: parsePurchaseState(state) → purchaseWhere(state, q = "", no department, no supplier); listPurchases
// counts that where.
const purchases = (key: "prDraft" | "prSubmitted" | "prItReviewed") => () =>
  prisma.purchaseRequest.count({ where: purchaseWhere(parsePurchaseState(paramsOf(key).get("state")), "") });

// Spec §5.3 / Phase 40 §6: the Worklist and Purchase reviews counts are admin's and IT's only, as before.
const reviewer = (user: User) => user.role === "admin" || user.role === "it_staff";

const READERS: Record<Exclude<ReadKey, ItStatusKey>, (user: User) => Promise<number>> = {
  worklist: (user) => (reviewer(user) ? worklistCount(user.id, user.role) : Promise.resolve(0)),
  purchaseReviews: (user) => (reviewer(user) ? purchaseReviewCount() : Promise.resolve(0)),
  leaving: employees("leaving"),
  prDraft: purchases("prDraft"),
  prSubmitted: purchases("prSubmitted"),
  prItReviewed: purchases("prItReviewed"),
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
