/** Column visibility is a per-user preference (UserPreference table), NOT URL state — a shared link shows YOUR columns, not theirs. */
export const COLUMN_PREF_KEYS = {
  "columns:inventory": ["serial", "category", "assigned", "registration", "purchased", "warranty"],
} as const;

export type ColumnPrefKey = keyof typeof COLUMN_PREF_KEYS;

/**
 * Phase 40 (spec §2.5): the Columns chooser's checkbox labels, one per hideable column. Typed per key,
 * so a column added to COLUMN_PREF_KEYS without a label fails tsc as well as column-prefs.test.ts.
 */
export const COLUMN_LABELS: { [K in ColumnPrefKey]: Record<(typeof COLUMN_PREF_KEYS)[K][number], string> } = {
  "columns:inventory": {
    serial: "Serial number", category: "Category", assigned: "Assigned", registration: "Registration", purchased: "Purchased", warranty: "Warranty",
  },
};

/** Phase 45 (spec §2.3): what a user who never chose columns sees; Registration, Purchased and Warranty are off. */
export const DEFAULT_INVENTORY_COLUMNS: readonly string[] = ["serial", "category", "assigned"];

/** The UserPreference key holding the allowed column keys at the time the user last saved their columns. */
export const INVENTORY_COLUMNS_SEEN_KEY = "columns:inventory:seen";

/**
 * Phase 45 (spec §2.3): the visible columns from the saved set and the seen marker. Nothing saved gives the
 * defaults. A saved set that lacks Serial number, from a user who has never been offered it (`serial` is not in
 * `seen`), gets it added once; any other saved set is theirs exactly, filtered to what still exists.
 */
export function resolveInventoryColumns(
  saved: string[] | null, seen: string[] | null, allowed: readonly string[],
): string[] {
  if (saved === null) return [...DEFAULT_INVENTORY_COLUMNS];
  const kept = saved.filter((c) => allowed.includes(c));
  if (!kept.includes("serial") && !(seen ?? []).includes("serial")) return [...kept, "serial"];
  return kept;
}
