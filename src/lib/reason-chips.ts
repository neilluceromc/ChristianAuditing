/**
 * Phase 23 (spec §4.2). One list, reviewable in one file. Every chip is >= 5
 * characters so no chip can produce a refused reason under any
 * `reasonRequired` minimum in the codebase (3, or 5 for `returnAssetToIt`).
 *
 * Spec §4.2's literal list has three 4-character chips ("Lost" x2, "Loan")
 * that violate its own >= 5 char rule above (and the required unit test) --
 * widened here to "Missing" / "Misplaced" / "On loan", same meaning, no
 * caller elsewhere in the plan matches on the old literal text (checked the
 * design spec and facts docs for hardcoded "Lost"/"Loan" chip assertions;
 * none found).
 */
export const REASON_CHIPS = {
  "stock.adjust":      ["Count correction", "Damaged", "Spoiled", "Found extra"],
  "stock.write-off":   ["Expired", "Damaged", "Spoiled", "Missing"],
  "stock.issue":       ["Regular supply", "Replacement", "Event or meeting"],
  "asset.missing":     ["Not returned", "Misplaced", "Stolen"],
  "asset.defective":   ["Will not power on", "Screen damaged", "Water damage"],
  "asset.buyout":      ["Bought by employee"],
  "asset.status":      ["For repair", "End of life", "Sold or donated", "Back in service"],
  "asset.assign":      ["New hire kit", "Replacement", "On loan"],
  "employee.transfer": ["Promotion", "Reorganisation", "Requested by department"],
  "policy.exception":  ["Role needs it", "Remote work setup", "Uses own device", "Not needed for this role"],
  "approval.reject":   ["Not needed", "Duplicate request", "Wrong item"],
  "purchase.reason":   ["Over budget", "Need specifications", "Duplicate request"],
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
