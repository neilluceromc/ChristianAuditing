import { ASSET_EXPORT_COLUMNS } from "./export-columns";
import { ASSET_IMPORT_HEADERS, normalizeHeader } from "./import-assets";

const IMPORTABLE_LABELS = new Set(
  ASSET_IMPORT_HEADERS.flatMap((h) => h.labels.map(normalizeHeader)),
);

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
 */
export const KNOWN_UNIMPORTED_COLUMNS: readonly string[] = ASSET_EXPORT_COLUMNS
  .map((c) => c.label)
  .filter((label) => !IMPORTABLE_LABELS.has(normalizeHeader(label)));

const KNOWN_UNIMPORTED_SET = new Set(KNOWN_UNIMPORTED_COLUMNS.map(normalizeHeader));

/**
 * The known-vs-unknown split `import-wizard.tsx` renders as two differently-
 * worded lines. Pure over `unknownColumns` (`matchHeaders`'s own `unknown`
 * array, in the sheet's original casing) — extracted so a node-environment
 * vitest can reach it without a browser.
 */
export function splitUnknownColumns(unknownColumns: string[]): { known: string[]; unknown: string[] } {
  return {
    known: unknownColumns.filter((c) => KNOWN_UNIMPORTED_SET.has(normalizeHeader(c))),
    unknown: unknownColumns.filter((c) => !KNOWN_UNIMPORTED_SET.has(normalizeHeader(c))),
  };
}
