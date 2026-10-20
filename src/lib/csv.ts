/*
 * The one CSV cell rule for the app's CSV downloads (the import-failures file, the asset Financial history log):
 * RFC 4180 quoting, and a guard so a spreadsheet never runs a cell as a formula.
 */

/** RFC 4180: a cell holding a quote, comma or line break is quoted, its quotes doubled. */
export function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * A cell a spreadsheet would read as a formula (it starts with = + - @, or a tab or carriage return, the OWASP set)
 * gets a leading apostrophe, so it stays text.
 */
export function csvText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Free text into a cell: the formula guard, then the quoting. */
export function csvTextCell(v: string): string {
  return csvCell(csvText(v));
}
