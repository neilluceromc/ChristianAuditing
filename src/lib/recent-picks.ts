/**
 * Phase 23 (spec §4.3). Pure helpers for the "Recent" group an EntityCombobox
 * shows above its options — the storage and server wiring live in
 * src/server/recent-picks.ts (plan P-1).
 */
export const RECENT_KINDS = ["employee", "stock-item", "vendor"] as const;
export type RecentKind = (typeof RECENT_KINDS)[number];
export const RECENT_MAX = 5;
export const recentKey = (kind: RecentKind) => `recent:${kind}`;

/** Prepend, dedupe, cap. pushRecent(["a","b"], "b") → ["b","a"]. */
export function pushRecent(existing: readonly string[], id: string): string[] {
  return [id, ...existing.filter((x) => x !== id)].slice(0, RECENT_MAX);
}

/** Options whose value is in `recent`, in recent order; ids not offered are dropped. */
export function recentOptions<T extends { value: string }>(options: readonly T[], recent: readonly string[]): T[] {
  return recent.flatMap((id) => {
    const o = options.find((x) => x.value === id);
    return o ? [o] : [];
  });
}

/** Parse a stored preference value defensively: non-array or non-string entries → []. */
export function parseRecent(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}
