"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useOverlayLayer } from "./use-focus-trap";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** The nearest ancestor that clips its overflow (a scrolling table wrapper), or null for the page itself. */
function clippingAncestor(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if ([overflowX, overflowY].some((o) => o !== "visible")) return node;
  }
  return null;
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
  // Phase 30 review (R13): true when the popup would overflow below — the viewport or a clipping
  // ancestor such as the table wrapper — and fits better above the trigger.
  const [up, setUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const focusTrigger = () => {
    rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  };

  // Measured before paint, so a flipped menu never flashes in its default place first.
  useLayoutEffect(() => {
    if (!open) { setUp(false); return; }
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list) return;
    const trigger = root.getBoundingClientRect();
    const height = list.getBoundingClientRect().height;
    const clip = clippingAncestor(root)?.getBoundingClientRect();
    const floor = Math.min(window.innerHeight, clip?.bottom ?? Infinity);
    const ceiling = Math.max(0, clip?.top ?? -Infinity);
    const below = floor - trigger.bottom;
    const above = trigger.top - ceiling;
    // 4px = the mt-1 / mb-1 gap. Default placement wherever it fits; flip only into more room.
    setUp(height + 4 > below && above > below);
  }, [open]);

  // ESC (top overlay layer only) closes the menu and returns focus to the
  // trigger. Click-outside closes WITHOUT refocusing — focus follows the click.
  useOverlayLayer(open, () => {
    setOpen(false);
    focusTrigger();
  });

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
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
      {open && (
        <div
          ref={listRef}
          role="menu"
          className={cn(
            "absolute z-40 min-w-[160px] rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop",
            up ? "bottom-full mb-1" : "top-full mt-1",
            align === "end" ? "right-0" : "left-0",
          )}
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
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
        </div>
      )}
    </div>
  );
}
