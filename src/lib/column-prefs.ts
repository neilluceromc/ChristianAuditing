/** Column visibility is a per-user preference (UserPreference table), NOT URL state — a shared link shows YOUR columns, not theirs. */
export const COLUMN_PREF_KEYS = {
  "columns:inventory": ["category", "assigned", "purchased", "warranty"],
} as const;

export type ColumnPrefKey = keyof typeof COLUMN_PREF_KEYS;
