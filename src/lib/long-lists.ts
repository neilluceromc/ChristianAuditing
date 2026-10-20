/**
 * Pure rules behind the Phase 39 "no long scrolls" views: month headings, the
 * notes / conversation / reference-table filters, the import-failures CSV and the
 * "+N more fields" slice. No React, no DOM.
 */

import { csvTextCell } from "./csv";

const MANILA_MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" });

/** Groups consecutive items by Asia/Manila month ("October 2026"); the input order is kept. */
export function monthGroups<T>(items: T[], at: (t: T) => Date): Array<{ month: string; items: T[] }> {
  const groups: Array<{ month: string; items: T[] }> = [];
  for (const item of items) {
    const month = MANILA_MONTH.format(at(item));
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

function needle(q: string): string {
  return q.trim().toLowerCase();
}

/** Notes whose text contains `q` (case-insensitive, trimmed) and, when given, were written by `authorId`. */
export function filterNotes<T extends { text: string; authorId: string }>(
  notes: T[],
  q: string,
  authorId: string | null,
): T[] {
  const n = needle(q);
  return notes.filter((x) => (!authorId || x.authorId === authorId) && (!n || x.text.toLowerCase().includes(n)));
}

export type ThreadKind = "all" | "comments" | "status";

/** Purchase-thread messages: "comments" is kind COMMENT, "status" is every other kind. */
export function filterThread<T extends { kind: string; text: string }>(notes: T[], q: string, kind: ThreadKind): T[] {
  const n = needle(q);
  return notes.filter((x) => {
    if (kind === "comments" && x.kind !== "COMMENT") return false;
    if (kind === "status" && x.kind === "COMMENT") return false;
    return !n || x.text.toLowerCase().includes(n);
  });
}

/**
 * The import-failures download: header "Row,Reason", RFC 4180 quoting, CRLF line ends. A reason starting with
 * = + - @ is prefixed with an apostrophe, so opening the file in a spreadsheet never runs it as a formula.
 */
export function failuresCsv(rows: Array<{ row: number; reason: string }>): string {
  return ["Row,Reason", ...rows.map((r) => `${r.row},${csvTextCell(r.reason)}`)].join("\r\n");
}

/** The first `max` fields, and how many were left out ("+{more} more fields"). */
export function sliceFields<T>(fields: T[], max = 3): { shown: T[]; more: number } {
  return { shown: fields.slice(0, max), more: Math.max(0, fields.length - max) };
}

/** Reference-table rows whose name contains `q` (case-insensitive, trimmed). */
export function filterRef<T extends { name: string }>(rows: T[], q: string): T[] {
  const n = needle(q);
  return n ? rows.filter((r) => r.name.toLowerCase().includes(n)) : rows;
}
