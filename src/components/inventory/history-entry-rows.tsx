"use client";

import { useId, useState } from "react";
import { Td, Tr } from "@/components/ui/table";
import { sliceFields } from "@/lib/long-lists";

export interface HistoryFieldRow { key: string; field: string; from: string; to: string }

/**
 * Phase 39 (spec §5): one audit entry's rows — its first three fields, then "+{n} more fields", which opens
 * this entry only. Every row repeats When / Actor / Action (they are not dimmed: axe's contrast rule).
 *
 * The toggle is a disclosure with a stable name ("+{n} more fields"; aria-expanded tells open from closed, the
 * chevron shows it). The extra rows are always rendered, `hidden` while closed, so aria-controls names rows that
 * exist.
 */
export function HistoryEntryRows({
  when, actor, action, fields,
}: { when: string; actor: string; action: string; fields: HistoryFieldRow[] }) {
  const [open, setOpen] = useState(false);
  const { shown, more } = sliceFields(fields);
  const base = useId();
  const extraId = (i: number) => `${base}-more-${i}`;
  const extraIds = fields.slice(shown.length).map((_, i) => extraId(i)).join(" ");
  return (
    <>
      {fields.map((row, i) => (
        <Tr
          key={row.key}
          id={i >= shown.length ? extraId(i - shown.length) : undefined}
          hidden={i >= shown.length && !open}
        >
          <Td mono>{when}</Td>
          <Td>{actor}</Td>
          <Td mono className="text-[10.5px]">{action}</Td>
          <Td mono>{row.field}</Td>
          <Td>
            <span className="font-mono text-xs">
              <span className="text-fg-faint line-through decoration-[1px]">{row.from}</span>
              <span aria-hidden className="px-1.5 text-fg-faint">→</span>
              <span className="text-accent">{row.to}</span>
            </span>
          </Td>
        </Tr>
      ))}
      {more > 0 && (
        <Tr>
          <Td colSpan={5} className="py-1">
            <button
              type="button" aria-expanded={open} aria-controls={extraIds} onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-(--radius-ctl) px-1.5 py-1 text-xs font-medium text-accent hover:underline"
            >
              {`+${more} more fields`}
              <svg
                aria-hidden viewBox="0 0 10 10" width="10" height="10"
                className={open ? "rotate-180 transition-transform" : "transition-transform"}
              >
                <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </Td>
        </Tr>
      )}
    </>
  );
}
