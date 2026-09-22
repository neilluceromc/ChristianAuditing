/** Phase 29 (spec §5.2): the seed's EMP-#### habit, read off the table — nothing enforces it, so it is a suggestion, never a prefill. */
const PATTERN = /^EMP-(\d+)$/i;

export function nextEmployeeNo(existing: readonly string[]): string | null {
  let max = -1;
  for (const no of existing) {
    const m = PATTERN.exec(no.trim());
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  if (max < 0) return null;
  return `EMP-${String(max + 1).padStart(4, "0")}`;
}
