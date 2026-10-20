"use client";

import { useLayoutEffect, useState } from "react";

/**
 * main's content width at 1280 px with the sidebar open and a classic scrollbar: what a list table may assume
 * about its card before it has measured it.
 */
export const CONTENT_W_AT_XL = 970;

/**
 * Phase 45 (spec §4.3): whether a table of `minWidth` fits inside the card around it (`box`, the card's own
 * wrapper; its 1 px borders excluded). A `stickyHeader` table's card stops clipping from 1280 px (so the head can
 * stick to the window), which would let a wider table run past the card; a caller adds `xl:overflow-auto` when
 * this is false, so the card keeps scrolling sideways instead.
 *
 * Before the first measurement it assumes the narrowest `xl` content width (`CONTENT_W_AT_XL`), so a table that
 * might not fit starts out scrolling inside its card rather than spilling past it, and the server and the
 * hydrating client agree. The Inventory and Employees tables both use it.
 */
export function useFitsCard(box: React.RefObject<HTMLElement | null>, minWidth: number): boolean {
  const [fits, setFits] = useState(minWidth <= CONTENT_W_AT_XL);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFits(minWidth <= el.clientWidth - 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, minWidth]);
  return fits;
}
