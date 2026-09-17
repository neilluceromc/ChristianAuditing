export interface GroupedOption { value: string; group?: string }

/**
 * Phase 24 (spec §4.1). The heading to render BEFORE row `i` of `shown`, or null. The first
 * `recentCount` rows are the Recent block: "Recent" at 0; nothing inside the block; at the block's end
 * the row's own group name if it has one, else "All". Past that, a heading whenever `group` changes.
 * A row without a group after grouped rows gets no heading, so mixed lists degrade gracefully.
 */
export function headingBefore(shown: readonly GroupedOption[], i: number, recentCount: number): string | null {
  const row = shown[i];
  if (!row) return null;
  if (recentCount > 0) {
    if (i === 0) return "Recent";
    if (i < recentCount) return null;
    if (i === recentCount) return row.group ?? "All";
  }
  if (row.group === undefined) return null;
  if (i === 0) return row.group;
  return shown[i - 1].group === row.group ? null : row.group;
}
