import type { AssetStatus } from "@prisma/client";

/**
 * README 3e: per item, a 4-way control — Returned / Defective / Buyout /
 * **Missing**. Missing is first-class because "pretending everything comes
 * back is why spreadsheets drift", and a reason is required for anything
 * other than a clean return.
 */
export const OUTCOMES = ["RETURNED", "DEFECTIVE", "BUYOUT", "MISSING"] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  RETURNED: "Returned", DEFECTIVE: "Defective", BUYOUT: "Buyout", MISSING: "Missing",
};

/** What the worker will set the asset to — the payload's `to.status`. */
export const OUTCOME_STATUS: Record<Outcome, AssetStatus> = {
  RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
};

export function reasonRequired(outcome: Outcome): boolean {
  return outcome !== "RETURNED";
}

export const WIZARD_STEPS = [
  { id: "review", label: "Review holdings" },
  { id: "collect", label: "Collect items" },
  { id: "accounts", label: "Accounts & M365" },
  { id: "report", label: "Farewell report" },
] as const;

export type StepId = (typeof WIZARD_STEPS)[number]["id"];

/** `?step=` keeps the operator's place across a refresh (entry criterion #8). */
export function parseStep(raw: string | null | undefined): StepId {
  return (WIZARD_STEPS.some((s) => s.id === raw) ? raw : "review") as StepId;
}

/**
 * Continue is blocked while any item is undecided — undecided is NOT the same
 * as Returned, and defaulting it to one would be the exact drift this screen
 * exists to prevent.
 */
export function canContinue(step: StepId, state: { undecided: number }): boolean {
  return step !== "collect" || state.undecided === 0;
}

export interface ReportItem {
  outcome: Outcome;
  cost: number | null;
}

export interface ReportTotals {
  /** back in the fleet: returned + defective */
  recovered: number;
  /** the employee paid for it */
  boughtOut: number;
  /** custody lost */
  lost: number;
  total: number;
  counts: Record<Outcome, number>;
}

export function reportTotals(items: ReportItem[]): ReportTotals {
  const counts: Record<Outcome, number> = { RETURNED: 0, DEFECTIVE: 0, BUYOUT: 0, MISSING: 0 };
  let recovered = 0;
  let boughtOut = 0;
  let lost = 0;
  for (const item of items) {
    counts[item.outcome] += 1;
    const value = item.cost ?? 0;
    if (item.outcome === "RETURNED" || item.outcome === "DEFECTIVE") recovered += value;
    else if (item.outcome === "BUYOUT") boughtOut += value;
    else lost += value;
  }
  return { recovered, boughtOut, lost, total: items.length, counts };
}
