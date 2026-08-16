"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";

export interface FacetOptionLike {
  value: string;
  label: string;
  count: number;
}

/**
 * Draft-state multi-select: checking boxes edits local state only; the URL
 * updates on Apply (handover: "URL updates only on Apply"). Zero-count
 * options render dimmed but present.
 */
export function FacetDropdown({
  label,
  options,
  selected,
  onApply,
}: {
  label: string;
  options: FacetOptionLike[];
  selected: string[];
  onApply: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const focusTrigger = () =>
    rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();

  useOverlayLayer(open, () => {
    setOpen(false);
    focusTrigger();
  });

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selected));
    setFilter("");
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()));

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
        {label}
        {selected.length > 0 && <span className="font-mono text-[10px]">{selected.length}</span>}
        <span aria-hidden className="text-fg-faint">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Filter by ${label}`}
          className="absolute left-0 top-full z-40 mt-1 w-[230px] rounded-(--radius-btn) border border-border bg-surface-raised p-2 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          <Input
            aria-label={`Search ${label} options`}
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-2 px-2 py-1 text-xs"
          />
          <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
            {shown.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 text-xs hover:bg-surface-subtle",
                  opt.count === 0 && !draft.has(opt.value) && "opacity-45",
                )}
              >
                <Checkbox
                  checked={draft.has(opt.value)}
                  onChange={(e) => {
                    const next = new Set(draft);
                    if (e.target.checked) next.add(opt.value);
                    else next.delete(opt.value);
                    setDraft(next);
                  }}
                />
                <span className="flex-1 truncate text-fg-secondary">{opt.label}</span>
                <span className="font-mono text-[10px] text-fg-faint">{opt.count}</span>
              </label>
            ))}
            {shown.length === 0 && (
              <p className="px-1.5 py-2 text-[11px] text-fg-muted">No options match.</p>
            )}
          </div>
          <div className="mt-2 flex justify-between gap-2 border-t border-border-faint pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDraft(new Set())}
            >
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
