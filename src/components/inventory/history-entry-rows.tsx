"use client";

import { useState } from "react";
import { Td, Tr } from "@/components/ui/table";
import { sliceFields } from "@/lib/long-lists";

export interface HistoryFieldRow { key: string; field: string; from: string; to: string }

/**
 * Phase 39 (spec §5): one audit entry's rows — its first three fields, then "+{n} more fields", which opens
 * this entry only. Every row repeats When / Actor / Action (they are not dimmed: axe's contrast rule).
 */
export function HistoryEntryRows({
  when, actor, action, fields,
}: { when: string; actor: string; action: string; fields: HistoryFieldRow[] }) {
  const [open, setOpen] = useState(false);
  const { shown, more } = sliceFields(fields);
  const visible = open ? fields : shown;
  return (
    <>
      {visible.map((row) => (
        <Tr key={row.key}>
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
              type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
              className="rounded-(--radius-ctl) px-1.5 py-1 text-xs font-medium text-accent hover:underline"
            >
              {open ? "Show fewer fields" : `+${more} more fields`}
            </button>
          </Td>
        </Tr>
      )}
    </>
  );
}
