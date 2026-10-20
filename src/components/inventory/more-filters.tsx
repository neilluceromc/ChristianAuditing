"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";
import { LIST } from "@/components/patterns/list-styles";

/**
 * Phase 45 (spec §2.2): the "More filters" popover — the same shell as FacetDropdown and the Columns chooser
 * (a button, an absolute `role="dialog"` panel, Esc and click-outside close it). It holds the list's less-used
 * facets, passed in as children and rendered unchanged; each still applies on its own Apply and writes its own
 * URL param. The button shows how many of them are set.
 *
 * The panel stays open after a facet applies (the toolbar is not remounted by the navigation), so several can
 * be set in a row. A facet's own popup is a DOM child of this panel, so a click inside it is "inside" here too;
 * a Menu (Purchased) portals its popup to the body, so a click inside any open `role="menu"` counts as inside.
 */
export function MoreFilters({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const focusTrigger = () => rootRef.current?.querySelector<HTMLElement>("[data-more-filters-trigger]")?.focus();
  useOverlayLayer(open, () => {
    setOpen(false);
    focusTrigger();
  });

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Element | null;
      if (rootRef.current?.contains(target)) return;
      if (target?.closest?.('[role="menu"]')) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        size="sm"
        data-more-filters-trigger=""
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          LIST.control,
          count > 0 && "border-accent-soft-border bg-accent-soft text-accent-soft-text hover:bg-accent-soft",
        )}
      >
        <Icon name="filter" size={13} className={count > 0 ? undefined : "text-fg-muted"} />
        More filters
        {count > 0 && (
          <>
            <span
              aria-hidden
              className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10.5px] leading-[18px] text-accent-fg"
            >
              {count}
            </span>
            <span className="sr-only">, {count} set</span>
          </>
        )}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="More filters"
          className="absolute left-0 top-full z-40 mt-1 w-[300px] rounded-(--radius-btn) border border-border bg-surface-raised p-3 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          <p className="pb-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-faint">Filter by</p>
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
      )}
    </div>
  );
}
