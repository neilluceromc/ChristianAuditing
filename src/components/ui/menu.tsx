"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    /** the popup's id while it is open — the popup is portalled away from the trigger, so this ties them */
    "aria-controls": string | undefined;
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
  const menuId = useId();
  // Phase 30 review (round 3): an Enter / Space on the trigger is followed by its click; the click
  // then opens the menu with focus on the first item. A mouse open leaves focus on the trigger.
  const keyboardPress = useRef(false);
  const focusOnOpen = useRef(false);

  const focusTrigger = () => {
    rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  };
  const focusFirstItem = () => {
    listRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled])")?.focus();
  };

  function onTriggerClick() {
    const fromKeyboard = keyboardPress.current;
    keyboardPress.current = false;
    if (open) { setOpen(false); return; }
    focusOnOpen.current = fromKeyboard;
    setOpen(true);
  }

  /**
   * The popup is portalled to the end of its host, so the DOM order no longer carries Tab from the
   * trigger into it: while open, Tab on the trigger moves to the first item and Shift+Tab closes
   * the menu (and continues backwards as usual).
   */
  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" || e.key === " ") {
      keyboardPress.current = true;
      return;
    }
    if (e.key === "Tab" && open) {
      if (e.shiftKey) { setOpen(false); return; }
      e.preventDefault();
      focusFirstItem();
    }
  }

  /**
   * Below the trigger, edge-aligned per `align`; above it only when it would overflow the viewport
   * below and there is more room above. The viewport is the only boundary now.
   */
  const place = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const t = root.getBoundingClientRect();
    const height = listRef.current?.getBoundingClientRect().height ?? 0;
    // clientHeight, not innerHeight: a horizontal scrollbar is not room a fixed popup can use.
    const viewportHeight = document.documentElement.clientHeight;
    const below = viewportHeight - t.bottom;
    const above = t.top;
    const up = height + GAP > below && above > below;
    const horizontal = align === "end" ? { right: document.documentElement.clientWidth - t.right } : { left: t.left };
    setPlacement(up ? { bottom: viewportHeight - t.top + GAP, ...horizontal } : { top: t.bottom + GAP, ...horizontal });
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

  // A keyboard open lands on the first item once the popup is placed (and so visible and focusable).
  useEffect(() => {
    if (open && host && placement && focusOnOpen.current) {
      focusOnOpen.current = false;
      focusFirstItem();
    }
  }, [open, host, placement]);

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
      // closes the menu and continues onwards from the trigger; Shift+Tab closes it and stops on
      // the trigger, the control it came from.
      // e.target, not activeElement: a Tab on the trigger has already moved focus into the list by
      // the time this document listener runs, and must not be read as a Tab from inside it.
      if (e.key === "Tab" && listRef.current?.contains(e.target as Node)) {
        if (e.shiftKey) e.preventDefault();
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
      {trigger({
        onClick: onTriggerClick,
        onKeyDown: onTriggerKeyDown,
        "aria-expanded": open,
        "aria-haspopup": "menu",
        "aria-controls": open ? menuId : undefined,
      })}
      {open && host && createPortal(
        <div
          ref={listRef}
          id={menuId}
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
