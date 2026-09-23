"use client";

import { useRef } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { parseSerialPaste } from "@/lib/register-input";
import {
  badTags, registeredRows, repeatedSerials, repeatedTags, serverRowMarks, type IdentifierHits, type RegisterRow,
} from "@/lib/register-rows";

/** How many already-registered rows are named one by one before the rest are counted. */
const NAMED = 5;

/**
 * Spec §5.5: what the rows say under the table, and which cells are invalid —
 * repeats within the batch, records already registered (the tag linked to its
 * record), a bad tag once a submit has been refused, and the server's own row
 * messages unless a live line already says the same thing.
 */
export function rowFeedback({ rows, hits, errors, attempted, exampleTag }: {
  rows: readonly RegisterRow[];
  hits: IdentifierHits;
  errors: Record<string, string>;
  attempted: boolean;
  exampleTag: string;
}): {
  invalidTags: Set<number>;
  invalidSerials: Set<number>;
  lines: Array<{ text: string; node: React.ReactNode }>;
  /** A repeat or a bad tag — refused here, before the server is asked. */
  blocked: boolean;
} {
  const repeatsT = repeatedTags(rows);
  const repeatsS = repeatedSerials(rows);
  const bad = badTags(rows, exampleTag);
  const live = registeredRows(rows, hits);
  const marks = serverRowMarks(errors, rows);

  const lines: Array<{ text: string; node: React.ReactNode }> = [];
  const say = (text: string | null | undefined, node?: React.ReactNode) => {
    if (text && !lines.some((l) => l.text === text)) lines.push({ text, node: node ?? text });
  };
  if (attempted) say(bad.message);
  say(repeatsT.message);
  for (const t of live.tags.slice(0, NAMED)) {
    say(`Row ${t.row + 1} · ${t.tag} is already registered`, (
      <>Row {t.row + 1} · <Link href={`/inventory/${t.id}`} className="font-mono underline">{t.tag}</Link> is already registered</>
    ));
  }
  if (live.tags.length > NAMED) say(`and ${live.tags.length - NAMED} more tags already registered`);
  if (!(live.tags.length > 0 && errors.tags?.includes("is already registered"))) say(errors.tags);
  say(repeatsS.message);
  for (const s of live.serials.slice(0, NAMED)) {
    say(`Serial ${s.serial} is already on ${s.tag}`, (
      <>Serial {s.serial} is already on <Link href={`/inventory/${s.id}`} className="font-mono underline">{s.tag}</Link></>
    ));
  }
  if (live.serials.length > NAMED) say(`and ${live.serials.length - NAMED} more serials already registered`);
  if (!(live.serials.length > 0 && errors.serials?.includes("is already on"))) say(errors.serials);
  for (const [key, message] of Object.entries(errors)) {
    const [kind, index] = key.split(".");
    if ((kind === "tags" || kind === "serials") && /^[0-9]+$/.test(index ?? "")) say(`Row ${Number(index) + 1} · ${message}`);
  }

  return {
    invalidTags: new Set([...marks.tags, ...repeatsT.rows, ...live.tags.map((t) => t.row), ...(attempted ? bad.rows : [])]),
    invalidSerials: new Set([...marks.serials, ...repeatsS.rows, ...live.serials.map((s) => s.row)]),
    lines,
    blocked: !!(bad.message || repeatsT.message || repeatsS.message),
  };
}

/**
 * Phase 30 (spec §5.2, §5.4, plan P-12): the Register rows — always a table,
 * one row at quantity 1 — numbered, under "Tag" / "Serial" headers, with the
 * `Tag {i}` / `Serial {i}` names every caller and test already uses.
 *
 * Enter never submits from a row (a USB scanner sends one after every scan):
 * it moves to the serial that comes next — the same row's from a tag, the next
 * row's from a serial — and from the last serial to the primary button. A
 * column pasted into a serial cell fills that row and the rows below.
 */
export function RegisterRows({
  rows,
  invalidTags,
  invalidSerials,
  tagPlaceholder,
  onTag,
  onSerial,
  onPasteSerials,
  onBlur,
  onLastEnter,
  children,
}: {
  rows: readonly RegisterRow[];
  invalidTags: ReadonlySet<number>;
  invalidSerials: ReadonlySet<number>;
  tagPlaceholder: string;
  onTag: (row: number, value: string) => void;
  onSerial: (row: number, value: string) => void;
  /** Called only when the clipboard holds more than one serial. */
  onPasteSerials: (row: number, values: string[]) => void;
  onBlur: () => void;
  /** Enter in the last row's serial — the form focuses its primary button. */
  onLastEnter: () => void;
  /** The messages under the rows. */
  children?: React.ReactNode;
}) {
  const serialRefs = useRef<Array<HTMLInputElement | null>>([]);

  function toSerial(row: number) {
    if (row >= rows.length) onLastEnter();
    else serialRefs.current[row]?.focus();
  }

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="max-h-[420px] overflow-y-auto rounded-(--radius-card) border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-[1] bg-surface-subtle">
            <tr className="text-left text-[11px] font-medium text-fg-muted">
              <th scope="col" className="w-10 px-2 py-1.5 text-right font-medium">
                <span className="sr-only">Row</span>
                <span aria-hidden>#</span>
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">Tag</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Serial</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border-faint">
                <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums text-fg-muted">{i + 1}</td>
                <td className="px-2 py-1">
                  <Input
                    aria-label={`Tag ${i + 1}`}
                    invalid={invalidTags.has(i)}
                    placeholder={tagPlaceholder}
                    className="font-mono"
                    value={r.tag}
                    onChange={(e) => onTag(i, e.target.value.toUpperCase())}
                    onBlur={onBlur}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      serialRefs.current[i]?.focus();
                    }}
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    ref={(el) => {
                      serialRefs.current[i] = el;
                    }}
                    aria-label={`Serial ${i + 1}`}
                    invalid={invalidSerials.has(i)}
                    placeholder="Optional"
                    className="font-mono"
                    value={r.serial}
                    onChange={(e) => onSerial(i, e.target.value)}
                    onBlur={onBlur}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      toSerial(i + 1);
                    }}
                    onPaste={(e) => {
                      const values = parseSerialPaste(e.clipboardData.getData("text"));
                      if (values.length < 2) return;
                      e.preventDefault();
                      onPasteSerials(i, values);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}
