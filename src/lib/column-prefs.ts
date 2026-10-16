/** Column visibility is a per-user preference (UserPreference table), NOT URL state — a shared link shows YOUR columns, not theirs. */
export const COLUMN_PREF_KEYS = {
  "columns:inventory": ["category", "assigned", "registration", "purchased", "warranty"],
} as const;

export type ColumnPrefKey = keyof typeof COLUMN_PREF_KEYS;

/**
 * Phase 40 (spec §2.5): the Columns chooser's checkbox labels, one per hideable column. Typed per key,
 * so a column added to COLUMN_PREF_KEYS without a label fails tsc as well as column-prefs.test.ts.
 */
export const COLUMN_LABELS: { [K in ColumnPrefKey]: Record<(typeof COLUMN_PREF_KEYS)[K][number], string> } = {
  "columns:inventory": {
    category: "Category", assigned: "Assigned", registration: "Registration", purchased: "Purchased", warranty: "Warranty",
  },
};
