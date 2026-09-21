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
  "employee.transfer": ["Promotion", "Reorganisation", "Requested by department"],
  "policy.exception":  ["Role needs it", "Remote work setup", "Uses own device", "Not needed for this role"],
  "approval.reject":   ["Not needed", "Duplicate request", "Wrong item"],
  "purchase.reason":   ["Over budget", "Need specifications", "Duplicate request"],
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
