"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { PER_PAGE_OPTIONS, rowsRange } from "@/lib/paging";
import type { Density } from "@/lib/density";
import { setDensity, useDensity } from "@/components/ui/density-toggle";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/ui/pagination";
import { NavLink, useListNavigation } from "@/components/patterns/list-navigation";

/*
 * Phase 45 (spec §4.3): the sticky list chrome. The window is the scroller (the app sidebar is sticky top-0
 * h-dvh), so everything here is page-level `position: sticky`, never a nested scroll box. The toolbar and the
 * footer run edge to edge across main's 24 px padding (-mx-6 px-6). Put the toolbar, the table and the footer
 * inside one StickyList: the toolbar and footer then stick only while the list is on screen, and the table's
 * `stickyHeader` head pins under the toolbar through `--list-sticky-top`.
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
          "sticky top-0 z-20 -mx-6 border-b bg-canvas px-6 py-2 transition-colors duration-(--dur-1)",
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
 * "Rows per page": 25, 50 or 100; a change goes through the list's shared transition. Uncontrolled and keyed on
 * `per`, so the picked value stays shown while the next page renders instead of snapping back to the old one.
 */
function PerPageSelect({ per, perHrefFor }: { per: number; perHrefFor: (per: number) => string }) {
  const id = useId();
  const { navigate } = useListNavigation();
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
      <label htmlFor={id}>Rows per page</label>
      <Select
        key={per}
        id={id}
        defaultValue={String(per)}
        onChange={(e) => navigate(perHrefFor(Number(e.target.value)))}
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

/**
 * The pagination row as a bar pinned to the bottom of the window while the list is on screen: "Rows 1–25 of
 * 900", then Row size, Rows per page and the pages. With one page the pages hide; Rows per page shows whenever
 * there are more rows than the smallest size, so a list at 100 per page with 60 rows can still go back to 25.
 */
export function ListFooter({
  page,
  per,
  total,
  pageCount,
  hrefFor,
  perHrefFor,
}: {
  page: number;
  per: number;
  total: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  perHrefFor: (per: number) => string;
}) {
  const { from, to } = rowsRange(page, per, total);
  const paged = pageCount > 1;
  const perChoice = total > PER_PAGE_OPTIONS[0];
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className="sticky bottom-0 z-20 -mx-6 mt-1 flex min-h-12 flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-canvas/95 px-6 py-2 backdrop-blur">
      <span className="text-[12.5px] tabular-nums text-fg-muted" aria-live="polite">
        {total === 0 ? (
          "No rows"
        ) : (
          <>
            Rows <span className="font-medium text-fg-secondary">{fmt(from)}–{fmt(to)}</span> of {fmt(total)}
          </>
        )}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1">
        <RowSizeControl />
        {perChoice && <PerPageSelect per={per} perHrefFor={perHrefFor} />}
        {paged && <Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} linkComponent={NavLink} />}
      </div>
    </div>
  );
}
