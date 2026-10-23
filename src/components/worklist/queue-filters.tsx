"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import type { WorkFilters } from "@/lib/worklist-view";

/** A 32 px control with a 44 px hit area (Global Constraints): the ::after reaches 6 px above and below. */
const HIT_44 = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";

export interface BulkButton { id: "SPARE" | "DEFECTIVE" | "CHECK"; label: string }

/**
 * The row under the summary (plan calls 7 and 9): the queue's filters — category chips, Over 90 days, search — or,
 * while rows are ticked, the bulk bar in their place: "{n} selected", the queue's bulk buttons, Clear. A visually
 * hidden live region stays mounted so the first tick is announced too.
 */
export function QueueFilters({
  queue, chips, offers, filters, onFilters, checked, bulk, onBulk, onClearChecks, busy,
}: {
  /** the queue's name, for the search box's label */
  queue: string;
  chips: Array<{ label: string; value: string | null; count: number }>;
  offers: { category: boolean; over90: boolean };
  filters: WorkFilters;
  onFilters: (f: WorkFilters) => void;
  checked: number;
  bulk: readonly BulkButton[];
  onBulk: (id: BulkButton["id"]) => void;
  onClearChecks: () => void;
  busy: boolean;
}) {
  const label = `${checked.toLocaleString("en-US")} selected`;
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-y border-border-faint px-4 py-1.5">
      <span className="sr-only" aria-live="polite">{checked > 0 ? label : ""}</span>
      {checked > 0 ? (
        <div role="region" aria-label="Bulk actions" className="flex flex-1 flex-wrap items-center gap-2">
          <span className="flex-1 text-[13.5px] font-medium text-fg">{label}</span>
          {bulk.map((b, i) => (
            <Button
              key={b.id} size="md" variant={i === 0 ? "primary" : "secondary"} className={cn("h-9", HIT_44)}
              loading={busy && i === 0} disabled={busy} onClick={() => onBulk(b.id)}
            >
              {b.label}
            </Button>
          ))}
          <Button size="md" variant="ghost" className={cn("h-9", HIT_44)} onClick={onClearChecks}>Clear</Button>
        </div>
      ) : (
        <>
          {offers.category && (
            <div role="group" aria-label="Category" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1.5">
              {chips.map((c) => {
                const on = filters.category === c.value;
                return (
                  <button
                    key={c.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onFilters({ ...filters, category: c.value })}
                    className={cn(
                      "h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[12.5px] transition-colors duration-(--dur-1)", HIT_44,
                      on ? "border-accent bg-accent text-accent-fg" : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
                    )}
                  >
                    {c.label} <span className={on ? "opacity-80" : "text-fg-muted"}>{c.count}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!offers.category && <span className="flex-1" />}
          {offers.over90 && (
            <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 px-1 text-[12.5px] text-fg-secondary">
              <Checkbox checked={filters.over90} onChange={(e) => onFilters({ ...filters, over90: e.target.checked })} />
              Over 90 days
            </label>
          )}
          <input
            type="search"
            aria-label={`Search ${queue}`}
            placeholder="Search tag, model, person"
            value={filters.q}
            onChange={(e) => onFilters({ ...filters, q: e.target.value })}
            className="h-9 w-full rounded-(--radius-ctl) border border-border-strong bg-surface px-2.5 text-[12.5px] text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_var(--focus-shadow)] sm:w-[220px]"
          />
        </>
      )}
    </div>
  );
}
