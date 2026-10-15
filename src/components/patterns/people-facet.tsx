"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";
import { PEOPLE_DEBOUNCE_MS, PEOPLE_NONE } from "@/lib/people-search";
import { UNASSIGNED } from "@/lib/inventory-list";
import type { FacetOptionLike } from "@/components/patterns/facet-dropdown";
import type { ActionResult } from "@/server/action-result";

export interface PersonHit {
  value: string;
  label: string;
  sub: string;
  count: number;
}

/**
 * Phase 36 (spec 4.3): the Assigned filter as a search. Same button, popover, draft state and
 * Apply / Clear as FacetDropdown, but the popover never lists every holder: it shows the chosen
 * people as removable chips, an Unassigned checkbox, and up to ten typed matches.
 * `options` carries the CHOSEN people (names + counts) and the Unassigned row.
 */
export function PeopleFacet({
  label,
  options,
  selected,
  search,
  onApply,
}: {
  label: string;
  options: FacetOptionLike[];
  selected: string[];
  search: (q: string) => Promise<ActionResult<PersonHit[]>>;
  onApply: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [typed, setTyped] = useState("");
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  // names for every person seen while the popover is open, so a chip keeps its name after the search moves on
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const rootRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const focusTrigger = () =>
    rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();

  useOverlayLayer(open, () => {
    setOpen(false);
    focusTrigger();
  });

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selected));
    setTyped("");
    setHits(null);
    setFailed(false);
    setNames(new Map(options.map((o) => [o.value, o.label])));
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // debounced server search; a late response for older text is dropped
  useEffect(() => {
    const q = typed.trim();
    const mine = ++seq.current;
    setFailed(false);
    if (!open || !q) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      void search(q).then((res) => {
        if (mine !== seq.current) return;
        if (!res.ok) {
          setFailed(true);
          setHits(null);
          return;
        }
        setHits(res.data);
        setNames((prev) => {
          const next = new Map(prev);
          for (const h of res.data) next.set(h.value, h.label);
          return next;
        });
      }).catch(() => {
        if (mine !== seq.current) return;
        setFailed(true);
        setHits(null);
      });
    }, PEOPLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, open]);

  const toggle = (value: string, on: boolean) => {
    const next = new Set(draft);
    if (on) next.add(value);
    else next.delete(value);
    setDraft(next);
  };

  const unassigned = options.find((o) => o.value === UNASSIGNED);
  const chosen = [...draft].filter((v) => v !== UNASSIGNED);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-(--radius-btn) border px-2.5 py-1.5 text-[11.5px] font-medium",
          "transition-colors duration-(--dur-1)",
          selected.length
            ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
            : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
        )}
      >
        {selected.length > 0 ? `${label}: ${selected.length}` : label}
        <span aria-hidden className="text-fg-faint">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Filter by ${label}`}
          className="absolute left-0 top-full z-40 mt-1 w-[260px] rounded-(--radius-btn) border border-border bg-surface-raised p-2 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          <Input
            aria-label="Search people"
            placeholder="Type a name or employee no."
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mb-2 px-2 py-1 text-xs"
          />
          {chosen.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {chosen.map((id) => {
                const name = names.get(id) ?? id;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-accent-soft-border bg-accent-soft px-2 py-0.5 text-[11px] text-accent-soft-text"
                  >
                    {name}
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-surface-subtle"
                      onClick={() => toggle(id, false)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
            {unassigned && (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 text-xs hover:bg-surface-subtle",
                  unassigned.count === 0 && !draft.has(UNASSIGNED) && "opacity-45",
                )}
              >
                <Checkbox checked={draft.has(UNASSIGNED)} onChange={(e) => toggle(UNASSIGNED, e.target.checked)} />
                <span className="flex-1 truncate text-fg-secondary">Unassigned</span>
                <span className="font-mono text-[10px] text-fg-faint">{unassigned.count}</span>
              </label>
            )}
            {hits?.map((h) => (
              <label
                key={h.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 text-xs hover:bg-surface-subtle",
                  h.count === 0 && !draft.has(h.value) && "opacity-45",
                )}
              >
                <Checkbox checked={draft.has(h.value)} onChange={(e) => toggle(h.value, e.target.checked)} />
                <span className="flex-1 truncate text-fg-secondary">{h.label} · {h.sub}</span>
                <span className="font-mono text-[10px] text-fg-faint">{h.count}</span>
              </label>
            ))}
            {failed && <p className="px-1.5 py-2 text-[11px] text-fg-muted">Search failed — try again</p>}
            {!failed && hits !== null && hits.length === 0 && (
              <p className="px-1.5 py-2 text-[11px] text-fg-muted">{PEOPLE_NONE}</p>
            )}
          </div>
          <div className="mt-2 flex justify-between gap-2 border-t border-border-faint pt-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setOpen(false);
                focusTrigger();
                onApply([...draft]);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
