import type { TriageOutcome } from "./lifecycle";

/**
 * Phase 23 (spec §4.2). One list, reviewable in one file. Every chip is >= 4
 * characters, above the min-3 rule every chip site enforces (reasonRequired
 * default, the stock schemas' min: 3); returnAssetToIt's min 5 has no chips.
 */
export const REASON_CHIPS = {
  "stock.adjust":      ["Count correction", "Damaged", "Spoiled", "Found extra"],
  "stock.write-off":   ["Expired", "Damaged", "Spoiled", "Lost"],
  "stock.issue":       ["Regular supply", "Replacement", "Event or meeting"],
  "asset.missing":     ["Not returned", "Lost", "Stolen"],
  "asset.defective":   ["Will not power on", "Screen damaged", "Water damage"],
  "asset.buyout":      ["Bought by employee"],
  "asset.status":      ["For repair", "End of life", "Sold or donated", "Back in service"],
  "asset.assign":      ["New hire kit", "Replacement", "On loan"],
  // Phase 40 §8: the triage dialog's Dispose and Donate (min 2, triageReasonValid) — each offers the chips that fit it
  "asset.dispose":     ["Beyond repair", "Obsolete"],
  "asset.donate":      ["Donated to staff/charity", "Obsolete"],
  "employee.transfer": ["Promotion", "Reorganisation", "Requested by department"],
  "policy.exception.add":   ["Role needs it", "Client requirement", "Remote work setup", "Accessibility need"],
  "policy.exception.waive": ["Not needed for this role", "Uses own device", "Client provides it"],
  "approval.reject":   ["Not needed", "Duplicate request", "Wrong item"],
  // Purchase orders (Task 4): cancel, a cross-team money fix, and closing a line short.
  "po.cancel":         ["Ordered by mistake", "Duplicate order", "Supplier cannot deliver"],
  "po.fix":            ["Typo on the invoice", "Wrong supplier", "Price differs from the invoice"],
  "po.close-short":    ["Supplier cancelled the rest", "Out of stock", "Ordered too many"],
  "hold.place":        ["New hire setup", "Replacement pending", "Project loan"],
  "hold.release":      ["No longer needed", "Assigned another unit", "Hire cancelled"],
} as const satisfies Record<string, readonly string[]>;
export type ReasonContext = keyof typeof REASON_CHIPS;

/** Outcome-aware: return/replace/offboarding dialogs pick the context from the chosen outcome. */
export function chipsForOutcome(outcome: "MISSING" | "DEFECTIVE" | "BUYOUT" | "TRIAGE" | "RETURNED"): readonly string[] {
  switch (outcome) {
    case "MISSING": return REASON_CHIPS["asset.missing"];
    case "DEFECTIVE": return REASON_CHIPS["asset.defective"];
    case "BUYOUT": return REASON_CHIPS["asset.buyout"];
    default: return [];
  }
}

/** Phase 40 §8: the triage dialog's chips for a decision — Dispose and Donate have their own; Keep and Repair none. */
export function chipsForTriage(outcome: TriageOutcome | ""): readonly string[] {
  switch (outcome) {
    case "DISPOSE": return REASON_CHIPS["asset.dispose"];
    case "DONATED": return REASON_CHIPS["asset.donate"];
    default: return [];
  }
}

/**
 * What the reason box holds after the decision changes: a value that is exactly a chip the new decision
 * does not offer is cleared (it was a pick, not someone's words); anything typed stays.
 */
export function reasonAfterSwitch(value: string, from: readonly string[], to: readonly string[]): string {
  return from.includes(value) && !to.includes(value) ? "" : value;
}
