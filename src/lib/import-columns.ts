import { ASSET_EXPORT_COLUMNS, EMPLOYEE_EXPORT_COLUMNS } from "./export-columns";
import { ASSET_IMPORT_HEADERS, normalizeHeader } from "./import-assets";
import { EMPLOYEE_IMPORT_HEADERS } from "./import-employees";

/**
 * Task 11 round two, V-7 (one layer over W-7). `ASSET_EXPORT_COLUMNS` writes
 * columns `ASSET_IMPORT_HEADERS` has no field for at all — "RMA ref" today —
 * so a genuine round trip of this app's OWN export always carries at least
 * one "unrecognised" column, and warning about it the same way as a real typo
 * trains the operator to stop reading the one line that exists to catch a
 * real typo.
 *
 * DERIVED, not hand-typed: a hand-typed list (W-7's original fix) silently
 * files a renamed or newly-added export-only column under "check for a typo
 * in the header" the moment the export changes and this list doesn't — the
 * exact defect it exists to prevent, one layer up. Matched with the same
 * `normalizeHeader` `matchHeaders` itself uses, so this is case-insensitive
 * the same way header matching is.
 *
 * Extracted into `deriveKnownUnimported`/`makeSplitter` (Task 12, E-9) so the
 * employee importer's own `EMPLOYEE_KNOWN_UNIMPORTED_COLUMNS` /
 * `splitEmployeeUnknownColumns` share the exact derivation — `KNOWN_
 * UNIMPORTED_COLUMNS` and `splitUnknownColumns` below are otherwise
 * unchanged from before this task, so every existing caller keeps working
 * with no edits.
 */
function deriveKnownUnimported(
  exportColumns: readonly { label: string }[],
  importHeaders: readonly { labels: readonly string[] }[],
): readonly string[] {
  const importableLabels = new Set(importHeaders.flatMap((h) => h.labels.map(normalizeHeader)));
  return exportColumns.map((c) => c.label).filter((label) => !importableLabels.has(normalizeHeader(label)));
}

/**
 * The known-vs-unknown split `import-wizard.tsx` renders as two differently-
 * worded lines. Pure over `unknownColumns` (`matchHeaders`'s own `unknown`
 * array, in the sheet's original casing) — extracted so a node-environment
 * vitest can reach it without a browser.
 *
 * Exported directly (Task 12), unlike `makeSplitter` below: `ImportWizard`
 * is a Client Component, and a Server Component page can only pass PLAIN
 * DATA across that boundary, never a function reference that isn't itself a
 * `"use server"` action (React's own RSC rule — passing `splitUnknownColumns`
 * as a prop failed at runtime with exactly that error). So the wizard
 * imports this pure function directly into its own client bundle — a normal
 * static import, not a boundary crossing — and each page passes only the
 * DATA half (`knownUnimportedColumns`, a plain `string[]`) as a prop.
 */
export function splitColumns(
  knownUnimported: readonly string[],
  unknownColumns: string[],
): { known: string[]; unknown: string[] } {
  const knownSet = new Set(knownUnimported.map(normalizeHeader));
  return {
    known: unknownColumns.filter((c) => knownSet.has(normalizeHeader(c))),
    unknown: unknownColumns.filter((c) => !knownSet.has(normalizeHeader(c))),
  };
}

/** Binds `splitColumns` to one fixed known-list — what every caller before
 * Task 12 already expects `splitUnknownColumns`/`splitEmployeeUnknownColumns`
 * to be: a one-argument function. Both are still plain data + a pure
 * function, so both stay importable (and unit-testable) from anywhere that
 * ISN'T crossing the Server→Client Component boundary — `import-wizard.tsx`
 * is the one caller that cannot use them directly, for the reason above. */
function makeSplitter(knownUnimported: readonly string[]): (unknownColumns: string[]) => { known: string[]; unknown: string[] } {
  return (unknownColumns: string[]) => splitColumns(knownUnimported, unknownColumns);
}

export const KNOWN_UNIMPORTED_COLUMNS: readonly string[] = deriveKnownUnimported(
  ASSET_EXPORT_COLUMNS,
  ASSET_IMPORT_HEADERS,
);

/**
 * V-7's second half, unchanged: `matchHeaders`'s `unknown` array preserves
 * the sheet's original casing, so this matches case-insensitively too.
 */
export const splitUnknownColumns = makeSplitter(KNOWN_UNIMPORTED_COLUMNS);

/**
 * The employee importer's own analogue (Task 12, E-8): `EMPLOYEE_EXPORT_
 * COLUMNS` carries "M365" and "Items held", neither of which has an import
 * field — the former is a synced status this importer deliberately can't
 * set (see `import-employees.ts`'s own header comment), the latter is
 * computed, not stored. `KNOWN_UNIMPORTED_COLUMNS` above is ASSET-specific
 * — derived from the asset export — so the employee wizard needs its OWN
 * answer, not a reuse of that one (E-8 names this explicitly: parameterising
 * `ImportWizard` means finding every asset-shaped piece, not only the two
 * server actions).
 */
export const EMPLOYEE_KNOWN_UNIMPORTED_COLUMNS: readonly string[] = deriveKnownUnimported(
  EMPLOYEE_EXPORT_COLUMNS,
  EMPLOYEE_IMPORT_HEADERS,
);

export const splitEmployeeUnknownColumns = makeSplitter(EMPLOYEE_KNOWN_UNIMPORTED_COLUMNS);
