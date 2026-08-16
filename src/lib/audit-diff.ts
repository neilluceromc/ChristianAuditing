export type AuditDiff = Record<string, { from: unknown; to: unknown }>;

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber(); // Prisma.Decimal
  }
  return value ?? null;
}

/**
 * Field-level diff for AuditEntry.diff — `{ field: { from, to } }`, changed
 * fields only. Only keys present in `after` are inspected, so partial updates
 * never claim untouched fields changed. The history tab renders one row per
 * field from exactly this shape.
 */
export function diffOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditDiff {
  const diff: AuditDiff = {};
  for (const key of Object.keys(after)) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (!Object.is(from, to)) diff[key] = { from, to };
  }
  return diff;
}
