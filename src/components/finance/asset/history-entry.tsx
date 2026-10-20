"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import type { HistoryRow } from "@/lib/finance-history";
import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";

/**
 * Phase 47 (spec §4.5): one Financial history entry — initials, "Name (Role) verb", the kind pill and the time; a
 * chip per changed field (old struck through → new); the reason in quotes; the source pill; and a Details toggle
 * with the reference, exact time, source, signed-in account and what the entry relates to.
 */
export function HistoryEntry({
  row,
  kindLabel,
  initialOpen = false,
}: {
  row: HistoryRow;
  /** The kind pill's word (`HISTORY_KIND_PILL`), passed in so this client file needs no history logic. */
  kindLabel: string;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const detailsId = useId();
  return (
    <article className="flex gap-3 px-4 py-3" aria-label={`${row.actor} ${row.verb}, ${row.time}`}>
      <Avatar name={row.actor} size="lg" className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="min-w-0 flex-1 text-[13px] text-fg-secondary">
            <span className="font-semibold text-fg">{row.actor}</span>
            {row.role && <span className="text-fg-muted"> ({row.role})</span>} {row.verb}
          </p>
          <Pill>{kindLabel}</Pill>
          <time dateTime={row.at.toISOString()} className="font-mono text-[11px] tabular-nums text-fg-muted">{row.time}</time>
        </div>

        {row.changes.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Changes">
            {row.changes.map((c, i) => (
              <li
                key={`${c.field}-${i}`}
                className="inline-flex max-w-full flex-wrap items-baseline gap-1 rounded-(--radius-ctl) border border-border bg-surface-subtle px-2 py-0.5 text-[11.5px]"
              >
                <span className="text-fg-muted">{c.field}</span>
                <span className="sr-only">was</span>
                <s className="text-fg-muted">{c.from}</s>
                <span aria-hidden className="text-fg-faint">→</span>
                <span className="sr-only">now</span>
                <strong className="font-semibold text-fg">{c.to}</strong>
              </li>
            ))}
          </ul>
        )}

        {row.reason && <p className="text-[12.5px] italic text-fg-secondary">“{row.reason}”</p>}

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-muted">
            {row.sourceLabel}
          </span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
            className="text-[11.5px] font-medium text-accent hover:underline"
          >
            Details
          </button>
        </div>

        <div id={detailsId} hidden={!open}>
          {open && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-(--radius-ctl) border border-border-faint bg-surface-subtle px-3 py-2 text-[12px]">
              {([
                ["Reference", row.ref, true],
                ["Exact time", row.exact, true],
                ["Done through", row.sourceLabel, false],
                ["Signed in as", row.account ?? "—", false],
                ["Related", row.related, false],
              ] as const).map(([label, value, mono]) => (
                <div key={label} className="contents">
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className={cn("min-w-0 break-words text-fg-secondary", mono && "font-mono text-[11.5px]")}>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </article>
  );
}
