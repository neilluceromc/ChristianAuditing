/**
 * CSV for Excel: CRLF rows, RFC-4180 quoting, and a formula-injection guard —
 * a cell starting with = + - @ gets an apostrophe prefix so Excel treats it
 * as text (asset notes are user input landing in a spreadsheet).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
