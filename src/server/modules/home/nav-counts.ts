import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
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

// /inventory: parseListState → buildAssetWhere(state, purchaseYear = null, cls); listAssets counts that where.
const assets = (key: "itSpare" | "itDefective" | "itMissing") => () =>
  prisma.asset.count({ where: buildAssetWhere(parseListState(paramsOf(key), INVENTORY_LIST_CONFIG), null, "IT") });

// /employees: parseListState → buildEmployeeWhere(state); pageEmployees counts that where (no gaps, no loadout sort).
const employees = (key: "leaving") => () =>
  prisma.employee.count({ where: buildEmployeeWhere(parseListState(paramsOf(key), EMPLOYEES_LIST_CONFIG)) });

// /purchases: parsePurchaseState(state) → purchaseWhere(state, q = "", no department, no supplier); listPurchases
// counts that where.
const purchases = (key: "prDraft" | "prSubmitted" | "prItReviewed") => () =>
  prisma.purchaseRequest.count({ where: purchaseWhere(parsePurchaseState(paramsOf(key).get("state")), "") });

// Spec §5.3 / Phase 40 §6: the Worklist and Purchase reviews counts are admin's and IT's only, as before.
const reviewer = (user: User) => user.role === "admin" || user.role === "it_staff";

const READERS: Record<ReadKey, (user: User) => Promise<number>> = {
  worklist: (user) => (reviewer(user) ? worklistCount(user.id, user.role) : Promise.resolve(0)),
  purchaseReviews: (user) => (reviewer(user) ? purchaseReviewCount() : Promise.resolve(0)),
  itSpare: assets("itSpare"),
  itDefective: assets("itDefective"),
  itMissing: assets("itMissing"),
  leaving: employees("leaving"),
  prDraft: purchases("prDraft"),
  prSubmitted: purchases("prSubmitted"),
  prItReviewed: purchases("prItReviewed"),
};

/**
 * The nav's counts for the keys asked for, read in parallel. `approvals` is not read here (the layout feeds it from
 * getApprovalsBadge). Each read fails to 0 with a console.error, so a failed count hides its badge rather than
 * failing every page's shell.
 */
export async function readNavCounts(keys: CountKey[], user: User): Promise<Partial<Record<CountKey, number>>> {
  const wanted = [...new Set(keys)].filter((k): k is ReadKey => k !== "approvals");
  const entries = await Promise.all(
    wanted.map(async (key): Promise<[ReadKey, number]> => {
      try {
        return [key, await READERS[key](user)];
      } catch (err: unknown) {
        console.error(`[nav counts] ${key} failed:`, err);
        return [key, 0];
      }
    }),
  );
  return Object.fromEntries(entries);
}
