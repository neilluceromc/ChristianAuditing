import { fmtMoney } from "./format";
import type { ListState } from "./url-state";

/**
 * Repairs is a SAVED VIEW over the inventory list, not a route and not an enum
 * (README 7b): every stage is derived from the vendor/RMA/quote/defectiveSince
 * fields that already exist on Asset. Ids are URL-safe slugs; the uppercase
 * words are display only.
 */
export const REPAIR_STAGES = ["to-assess", "at-vendor", "returned-ok", "beyond-repair"] as const;

export type RepairStage = (typeof REPAIR_STAGES)[number];

export const REPAIR_STAGE_LABEL: Record<RepairStage, string> = {
  "to-assess": "TO ASSESS",
  "at-vendor": "AT VENDOR",
  "returned-ok": "RETURNED OK",
  "beyond-repair": "BEYOND REPAIR",
};

/** The named URL behind the "Repairs" saved view — sorted by the down clock, oldest first. */
export const REPAIRS_SAVED_VIEW = "/inventory?status=DEFECTIVE&sort=defectiveSince";

/**
 * A stated default, not a discovered truth (scope decision #6): a quote at or
 * above this share of what the unit cost is a replace decision, not a repair
 * one. It lives in exactly one place so moving the line is a one-line change.
 */
export const REPAIR_WRITE_OFF_SHARE = 0.6;

export interface RepairLike {
  status: string;
  vendorId: string | null;
  rmaRef: string | null;
  repairQuote: number | null;
  cost: number | null;
  defectiveSince: Date | null;
}

export function isRepairStage(value: string): value is RepairStage {
  return (REPAIR_STAGES as readonly string[]).includes(value);
}

export function beyondRepair(quote: number | null, cost: number | null): boolean {
  if (quote === null || cost === null || cost <= 0) return false;
  return quote >= cost * REPAIR_WRITE_OFF_SHARE;
}

/**
 * RETURNED OK deliberately steps outside `status=DEFECTIVE` — it is the stage
 * for an item that came back — which is why the chips write a URL rather than
 * filtering the current page.
 */
export function repairStage(a: RepairLike): RepairStage | null {
  if (a.status !== "DEFECTIVE") return a.defectiveSince ? "returned-ok" : null;
  if (beyondRepair(a.repairQuote, a.cost)) return "beyond-repair";
  if (a.vendorId || a.rmaRef) return "at-vendor";
  return "to-assess";
}

/**
 * Days out of service — the column that changes behaviour. null once the item
 * no longer reads DEFECTIVE: the clock stopped and we don't record when, so a
 * number here would be a lie.
 */
export function downDays(
  a: Pick<RepairLike, "status" | "defectiveSince">,
  now: Date = new Date(),
): number | null {
  if (a.status !== "DEFECTIVE" || !a.defectiveSince) return null;
  return Math.max(0, Math.floor((now.getTime() - a.defectiveSince.getTime()) / 86_400_000));
}

/** The sentence on the record when repairing costs too much of a new unit. */
export function quoteWarning(quote: number | null, cost: number | null): string | null {
  if (!beyondRepair(quote, cost)) return null;
  const share = Math.round((quote! / cost!) * 100);
  return `The ${fmtMoney(quote)} quote is ${share}% of the ${fmtMoney(cost)} this unit cost — at or above the ${Math.round(REPAIR_WRITE_OFF_SHARE * 100)}% write-off line. Replace rather than repair.`;
}

/** The inventory list switches into repair mode when the URL says so. */
export function isRepairView(state: ListState): boolean {
  if ((state.filters.stage ?? []).some(isRepairStage)) return true;
  const status = state.filters.status ?? [];
  return status.length === 1 && status[0] === "DEFECTIVE";
}
