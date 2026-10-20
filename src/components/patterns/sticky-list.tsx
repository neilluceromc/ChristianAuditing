"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { PER_PAGE_OPTIONS } from "@/lib/paging";
import type { Density } from "@/lib/density";
import { setDensity, useDensity } from "@/components/ui/density-toggle";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { useListNavigation } from "@/components/patterns/list-navigation";

/*
 * Phase 45 (spec §4.3): the sticky list chrome. The window is the scroller (the app sidebar is sticky top-0
 * h-dvh), so everything here is page-level `position: sticky`, never a nested scroll box. The toolbar and the
 * footer run edge to edge across main's 24 px padding (-mx-6 px-6). Put the toolbar, the table and the footer
 * (`ListFooter`, in list-footer.tsx so a Server Component can pass it its href builders) inside one
 * StickyList: the toolbar and footer then stick only while the list is on screen, and the table's
 * `stickyHeader` head pins under the toolbar through `--list-sticky-top`.
 *
 * The one z-scale for the list chrome (each sticky bar is its own stacking context, so a popover's z only counts
 * inside its bar; the toolbar therefore sits highest, or the footer and bulk bar would paint over its popovers):
 *   z-10  table head (`THead`) and the sticky footer (`ListFooter`)
 *   z-20  the floating bulk bar (`FloatingBulkBar`)
 *   z-30  the sticky toolbar (`StickyToolbar`), whose facet, column and filter popovers are z-40 inside it;
 *         the Cris dock is also z-30 but renders after #main, so it stays on top
 *   z-40  portalled menus · z-50 dialogs, drawers, tooltips · z-60 toasts
 */

/**
 * The list's wrapper: it carries `data-sticky-list` and, once its StickyToolbar has measured itself, `--list-sticky-top`.
 * Use one StickyToolbar per StickyList, and space the children themselves (no `gap` here: the toolbar's sentinel is a flex item).
 */
export function StickyList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-sticky-list="" className={cn("flex flex-col", className)}>
      {children}
    </div>
  );
}

/**
 * The filter row, pinned to the top of the window. A zero-height sentinel above it tells when it is stuck
 * (`data-stuck`), and only then does its bottom border show. Its height (it wraps on narrow screens) goes into
 * `--list-sticky-top` on the enclosing StickyList, which the table head reads as its own sticky `top`.
 */
export function StickyToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    const sentinel = sentinelRef.current;
    if (!bar || !sentinel) return;
    const list = bar.closest<HTMLElement>("[data-sticky-list]");
    const ro = new ResizeObserver(() => {
      // The head's sticky `top` reads it, and so do the rows' scroll-margin-top (globals.css), so a row reached by
      // Shift+Tab scrolls clear of the toolbar and the pinned head instead of landing under them (WCAG 2.4.11).
      list?.style.setProperty("--list-sticky-top", `${Math.round(bar.getBoundingClientRect().height)}px`);
    });
    ro.observe(bar);
    // stuck = the sentinel has scrolled out above the window's top edge (not merely below the fold)
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(sentinel);
    return () => {
      ro.disconnect();
      io.disconnect();
      list?.style.removeProperty("--list-sticky-top");
    };
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-0" />
      <div
        ref={barRef}
        data-stuck={stuck || undefined}
        className={cn(
          "sticky top-0 z-30 -mx-6 border-b bg-canvas px-6 py-2 transition-colors duration-(--dur-1)",
          stuck ? "border-border" : "border-transparent",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

const ROW_SIZES: Array<{ value: Density; label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
  { value: "dense", label: "Dense" },
];

/**
 * Row size (spec §4.5): Comfortable, Compact or Dense, through the same setter as the top bar's density button
 * (html `data-density` and the `br.density` cookie), so the two always agree.
 */
export function RowSizeControl() {
  const density = useDensity();
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
      <span aria-hidden>Row size</span>
      <SegmentedControl
        aria-label="Row size"
        options={ROW_SIZES}
        value={density}
        onChange={(v) => setDensity(v as Density)}
        className="whitespace-nowrap"
      />
    </div>
  );
}

/**
 * "Rows per page": 25, 50 or 100; a change goes through the list's shared transition. Controlled, and never
 * remounted (a `key={per}` remount dropped keyboard focus once the next page landed): while that navigation is in
 * flight it shows the size just picked, then the URL's `per` again, so it neither snaps back to the old size
 * mid-render nor keeps a pick whose navigation never landed.
 * `hrefs` maps each size to its URL (plain data, so a Server Component can render the footer around it).
 */
export function PerPageSelect({ per, hrefs }: { per: number; hrefs: Record<number, string> }) {
  const id = useId();
  const { navigate, pending } = useListNavigation();
  const [picked, setPicked] = useState<number | null>(null);
  // a pick lives for its own navigation only: forget it once the list stops being busy (state adjusted in render)
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) setPicked(null);
  }
  const shown = pending && picked !== null ? picked : per;
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
      <label htmlFor={id}>Rows per page</label>
      <Select
        id={id}
        value={String(shown)}
        onChange={(e) => {
          const n = Number(e.target.value);
          setPicked(n);
          navigate(hrefs[n]);
        }}
        className="h-8 w-auto py-0 pl-2.5 text-[12.5px]"
      >
        {PER_PAGE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </div>
  );
}
