import Link from "next/link";
import { cn } from "@/lib/cn";
import { assetPageHref, type AssetPageState } from "@/lib/finance-asset-page";
import { HISTORY_KINDS, HISTORY_KIND_LABELS, type HistoryKind, type HistoryResult, type HistoryRow } from "@/lib/finance-history";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HistoryEntry } from "./history-entry";
import { HistoryPersonSelect } from "./history-person-select";

/** The CSV of the filtered entries (the export route reads the same `hk` / `hw`). */
export function historyExportHref(id: string, state: AssetPageState): string {
  const p = new URLSearchParams();
  if (state.hk !== "all") p.set("hk", state.hk);
  if (state.hw) p.set("hw", state.hw);
  const qs = p.toString();
  return `/finance/assets/${encodeURIComponent(id)}/history/export${qs ? `?${qs}` : ""}`;
}

/** Consecutive rows of the same Manila day, under one header. */
function byDay(rows: HistoryRow[]): Array<{ day: string; label: string; rows: HistoryRow[] }> {
  const out: Array<{ day: string; label: string; rows: HistoryRow[] }> = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.day === r.day) last.rows.push(r);
    else out.push({ day: r.day, label: r.dayLabel, rows: [r] });
  }
  return out;
}

const PAGER = "rounded-(--radius-btn) border px-2.5 py-1 text-[12px] font-medium";

/**
 * Phase 47 (spec §4.5): the Financial history tab — the kind filter (with counts) and the person select, Export log,
 * the lock note, entries grouped by day, and 10 per page with Previous / Next and "x–y of N". Every filter and the
 * page are in the URL; `history` is `buildHistory` run with them.
 */
export function HistoryTab({ id, state, history }: { id: string; state: AssetPageState; history: HistoryResult }) {
  const href = (patch: Partial<AssetPageState>) => assetPageHref(id, state, { tab: "history", ...patch });
  const all = HISTORY_KINDS.reduce((n, k) => n + history.counts[k], 0);
  const kinds: Array<{ key: HistoryKind | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: all },
    ...HISTORY_KINDS.map((k) => ({ key: k, label: HISTORY_KIND_LABELS[k], count: history.counts[k] })),
  ];
  const personValue = state.hw && history.actors.some((a) => a.key === state.hw) ? state.hw : "all";
  const people = [
    { value: "all", label: "Everyone", href: href({ hw: null, hp: 1 }) },
    ...history.actors.map((a) => ({ value: a.key, label: a.label, href: href({ hw: a.key, hp: 1 }) })),
  ];
  const nothingAtAll = history.actors.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Kind" className="flex max-w-full overflow-x-auto rounded-(--radius-btn) border border-border-strong bg-surface-subtle p-0.5">
          {kinds.map((k) => {
            const on = state.hk === k.key;
            return (
              <Link
                key={k.key}
                href={href({ hk: k.key, hp: 1 })}
                scroll={false}
                prefetch={false}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors duration-(--dur-1)",
                  on ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg-secondary",
                )}
              >
                {k.label}
                <span className="tabular-nums text-fg-faint">{k.count}</span>
              </Link>
            );
          })}
        </nav>
        <HistoryPersonSelect value={personValue} options={people} />
        <div className="ml-auto">
          <ButtonLink native size="sm" href={historyExportHref(id, state)}>Export log</ButtonLink>
        </div>
      </div>
      <p className="text-xs text-fg-muted">Entries are written automatically and can&apos;t be edited or deleted.</p>

      <Card>
        {nothingAtAll ? (
          <EmptyState title="Nothing recorded yet" description="Approvals, cost changes, documents, notes and depreciation will show here." />
        ) : history.rows.length === 0 ? (
          <EmptyState
            title="No entries match these filters"
            actions={<ButtonLink size="sm" href={href({ hk: "all", hw: null, hp: 1 })}>Show everything</ButtonLink>}
          />
        ) : (
          <ol aria-label="Financial history">
            {byDay(history.rows).map((g) => (
              <li key={g.day} className="border-b border-border-faint last:border-b-0">
                <h3 className="bg-surface-subtle px-4 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">
                  {g.label}
                </h3>
                <ol className="divide-y divide-border-faint">
                  {g.rows.map((r) => <li key={r.id}><HistoryEntry row={r} /></li>)}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {history.total > 0 && (
        <nav aria-label="History pages" className="flex items-center justify-end gap-2">
          <span className="text-xs tabular-nums text-fg-muted">{`${history.from}–${history.to} of ${history.total}`}</span>
          {history.page > 1 ? (
            <Link href={href({ hp: history.page - 1 })} scroll={false} prefetch={false} className={cn(PAGER, "border-border-strong text-fg-secondary hover:bg-surface-subtle")}>
              Previous
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(PAGER, "border-border text-fg-faint")}>Previous</span>
          )}
          {history.page < history.pages ? (
            <Link href={href({ hp: history.page + 1 })} scroll={false} prefetch={false} className={cn(PAGER, "border-border-strong text-fg-secondary hover:bg-surface-subtle")}>
              Next
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(PAGER, "border-border text-fg-faint")}>Next</span>
          )}
        </nav>
      )}
    </div>
  );
}
