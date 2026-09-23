"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useOverlayLayer } from "./use-focus-trap";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** The gap between the trigger and the popup, in px (the old mt-1 / mb-1). */
const GAP = 4;

/** Fixed-position coordinates for the popup: one vertical edge and one horizontal edge. */
type Placement = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * Where the popup is portalled. Normally `document.body`. Inside an open Dialog or Drawer it is that
 * overlay's own portal root (the body child holding the `aria-modal` panel): the overlay stack marks
 * every other body child `inert` while a modal is up, and the overlay root sits at z-50, so a popup
 * under `document.body` would be unclickable and behind the modal.
 */
function portalHost(trigger: HTMLElement): HTMLElement {
  const modal = trigger.closest<HTMLElement>('[aria-modal="true"]');
  if (!modal) return document.body;
  let node: HTMLElement = modal;
  while (node.parentElement && node.parentElement !== document.body) node = node.parentElement;
  return node.parentElement === document.body ? node : document.body;
}

export function Menu({
  trigger,
  items,
  align = "end",
}: {
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
  }) => React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  // Phase 30 review (R14): the popup renders in a portal with position: fixed, placed from the
  // trigger's box, so no scrolling or overflow-clipped ancestor (a table wrapper) can cut it off.
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const focusTrigger = () => {
    rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  };

  /**
   * Below the trigger, edge-aligned per `align`; above it only when it would overflow the viewport
   * below and there is more room above. The viewport is the only boundary now.
   */
  const place = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const t = root.getBoundingClientRect();
    const height = listRef.current?.getBoundingClientRect().height ?? 0;
    const below = window.innerHeight - t.bottom;
    const above = t.top;
    const up = height + GAP > below && above > below;
    const horizontal = align === "end" ? { right: document.documentElement.clientWidth - t.right } : { left: t.left };
    setPlacement(up ? { bottom: window.innerHeight - t.top + GAP, ...horizontal } : { top: t.bottom + GAP, ...horizontal });
  }, [align]);

  // Portal host first (the popup mounts into it), then the placement, both before paint; the second
  // pass re-places with the popup's measured height, so a flipped menu never flashes below first.
  useLayoutEffect(() => {
    if (!open) { setPlacement(null); setHost(null); return; }
    if (rootRef.current) setHost(portalHost(rootRef.current));
    place();
  }, [open, place]);
  useLayoutEffect(() => {
    if (open && host) place();
  }, [open, host, place]);

  // While open, a page or container scroll or a resize moves the trigger: follow it (reposition,
  // not close — a small scroll should not throw away the menu the operator just opened).
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // ESC (top overlay layer only) closes the menu and returns focus to the
  // trigger. Click-outside closes WITHOUT refocusing — focus follows the click.
  useOverlayLayer(open, () => {
    setOpen(false);
    focusTrigger();
  });

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      // The popup is portalled out of the root, so "inside" is either subtree.
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      // The popup sits at the end of its portal host, not after the trigger: Tab from inside it
      // closes the menu and continues from the trigger, as it did before the portal.
      if (e.key === "Tab" && listRef.current?.contains(document.activeElement)) {
        focusTrigger();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const nodes = Array.from(
          listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled])") ?? [],
        );
        if (nodes.length === 0) return;
        const i = nodes.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === "ArrowDown"
            ? nodes[(i + 1) % nodes.length]
            : nodes[i <= 0 ? nodes.length - 1 : i - 1];
        next.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({ onClick: () => setOpen((v) => !v), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && host && createPortal(
        <div
          ref={listRef}
          role="menu"
          className="fixed z-40 min-w-[160px] rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop"
          // hidden until placed, so the first frame never shows it at the page's corner
          style={{ ...placement, visibility: placement ? undefined : "hidden", animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                focusTrigger();
                item.onSelect();
              }}
              className={cn(
                "block w-full rounded-[5px] px-2.5 py-1.5 text-left text-xs",
                "disabled:pointer-events-none disabled:opacity-55",
                item.danger
                  ? "text-[var(--error-text)] hover:bg-[var(--st-fault-bg)]"
                  : "text-fg-secondary hover:bg-surface-subtle",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>,
        host,
      )}
    </div>
  );
}
