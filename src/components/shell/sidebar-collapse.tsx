"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { bracketTogglesSidebar, SHORTCUT_OVERLAY } from "@/lib/shortcuts";
import { nextSidebar, sidebarCookie, type SidebarState } from "@/lib/sidebar-state";

interface SidebarContextValue {
  state: SidebarState;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/** The desktop sidebar's state inside the shell; null outside it. */
export function useSidebar(): SidebarContextValue | null {
  return useContext(SidebarContext);
}

/** The desktop sidebar, found inside the shell (hidden below `lg`, where the drawer takes over). */
const SIDEBAR = 'aside[aria-label="Primary"]';

/**
 * Phase 46 spec §4.1: the app shell. It carries `data-sidebar="rail|full"` (the sidebar's width keys off it with
 * `group-data-[sidebar=rail]/shell:`), starts from the `br.sidebar` cookie the layout read (so the first paint is
 * right), and owns the one toggle: the collapse button and the `[` key both write the cookie and flip the attribute.
 * The nav and the brand row read the same state through `useSidebar`.
 */
export function SidebarShell({ initial, children }: { initial: SidebarState; children: React.ReactNode }) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const shellRef = useRef<HTMLDivElement>(null);
  // A toggle while the focus sat in the sidebar: the focused link may not exist in the other layout.
  const refocus = useRef(false);

  const toggle = useCallback(() => {
    const next = nextSidebar(stateRef.current);
    stateRef.current = next;
    refocus.current = !!shellRef.current?.querySelector(SIDEBAR)?.contains(document.activeElement);
    document.cookie = sidebarCookie(next);
    setState(next);
  }, []);

  // The focused nav link was swapped for its other-layout twin: land on the toggle rather than on <body>.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    shellRef.current?.querySelector<HTMLElement>("[data-sidebar-toggle]")?.focus();
  }, [state]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "[") return; // cheap exit before any DOM query
      const target = e.target instanceof HTMLElement ? e.target : null;
      const handled = bracketTogglesSidebar({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        defaultPrevented: e.defaultPrevented,
        targetTag: target?.tagName ?? null,
        targetType: target instanceof HTMLInputElement ? target.type : null,
        targetEditable: target?.isContentEditable ?? false,
        overlayOpen: document.querySelector(SHORTCUT_OVERLAY) !== null,
        targetInOverlay: target?.closest(SHORTCUT_OVERLAY) != null,
      });
      if (!handled) return;
      // Below lg the sidebar is not shown (the drawer is unchanged): leave the key and the cookie alone.
      const aside = shellRef.current?.querySelector(SIDEBAR);
      if (!aside || aside.getClientRects().length === 0) return;
      e.preventDefault();
      toggle();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const value = useMemo(() => ({ state, toggle }), [state, toggle]);
  return (
    <div ref={shellRef} data-sidebar={state} className="group/shell flex min-h-screen">
      <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
    </div>
  );
}

/** One of two renderings by the sidebar's state: only the one in use is mounted (no hidden twin in the DOM). */
export function SidebarVariant({ full, rail }: { full: React.ReactNode; rail: React.ReactNode }) {
  return useSidebar()?.state === "rail" ? rail : full;
}

/**
 * Spec §4.1: "Collapse sidebar" at the bottom of the sidebar, above the account row, showing its `[` key. In the
 * rail it is the icon alone, named "Expand sidebar".
 */
export function SidebarCollapseButton() {
  const sidebar = useSidebar();
  const rail = sidebar?.state === "rail";
  const label = rail ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      data-sidebar-toggle=""
      onClick={sidebar?.toggle}
      aria-label={label}
      aria-keyshortcuts="["
      title={rail ? `${label} ([)` : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-[8px] text-[12.5px] text-fg-muted",
        "transition-colors duration-(--dur-1) hover:bg-surface-subtle hover:text-fg",
        rail ? "justify-center" : "px-2.5",
      )}
    >
      <Icon name="sidebar" size={16} />
      {!rail && (
        <>
          <span>Collapse sidebar</span>
          <span className="ml-auto flex">
            <Kbd>[</Kbd>
          </span>
        </>
      )}
    </button>
  );
}
