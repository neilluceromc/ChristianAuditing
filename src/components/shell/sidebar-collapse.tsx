"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { bracketTogglesSidebar, readSingleKey } from "@/lib/shortcuts";
import { nextSidebar, sidebarCookie, sidebarSteps, type SidebarAnim, type SidebarState, type SidebarStep } from "@/lib/sidebar-state";
import { saveUiPref } from "@/server/ui-prefs";

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

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Phase 46 spec §4.1: the app shell. It carries `data-sidebar="rail|full"` (the sidebar's width keys off it with
 * `group-data-[sidebar=rail]/shell:`), starts from the `br.sidebar` cookie the layout read (so the first paint is
 * right), and owns the one toggle: the collapse button and the `[` key both write the cookie and flip the attribute.
 * The nav and the brand row read the same state through `useSidebar`.
 *
 * Phase 47 spec §5.1: the toggle animates (sidebarSteps): the shell carries `data-sidebar-anim` only while it runs,
 * so the first paint and a server render never animate, and under prefers-reduced-motion it is one instant step.
 * `state` is what is drawn; the person's choice (written to the cookie at once) can run ahead of it mid-animation.
 * Spec §5.4: the choice is also saved to the person's prefs, so it follows them to another browser.
 */
export function SidebarShell({ initial, children }: { initial: SidebarState; children: React.ReactNode }) {
  const [state, setState] = useState(initial);
  const [anim, setAnim] = useState<SidebarAnim | null>(null);
  // A server render (router.refresh, say after another tab toggled and rewrote the cookie) brings a new `initial`:
  // adopt it, unanimated (state adjusted in render; the refs follow in the effect below).
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setState(initial);
    setAnim(null);
  }
  const shellRef = useRef<HTMLDivElement>(null);
  // A toggle while the focus sat in the sidebar: the focused link may not exist in the other layout.
  const refocus = useRef(false);
  /** What is drawn now, and what the person last chose: they differ only mid-animation. */
  const shown = useRef(initial);
  const chosen = useRef(initial);
  const timers = useRef<number[]>([]);

  const stopTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => {
    stopTimers();
    shown.current = seenInitial;
    chosen.current = seenInitial;
  }, [seenInitial, stopTimers]);
  useEffect(() => stopTimers, [stopTimers]);

  const toggle = useCallback(() => {
    const next = nextSidebar(chosen.current);
    chosen.current = next;
    refocus.current = !!shellRef.current?.querySelector(SIDEBAR)?.contains(document.activeElement);
    document.cookie = sidebarCookie(next);
    void saveUiPref({ sidebar: next }).catch(() => {}); // a missed save only costs the next browser this choice
    stopTimers();
    const apply = (step: SidebarStep) => {
      shown.current = step.state;
      setState(step.state);
      setAnim(step.anim);
    };
    for (const step of sidebarSteps(shown.current, next, prefersReducedMotion())) {
      if (step.at === 0) apply(step);
      else timers.current.push(window.setTimeout(() => apply(step), step.at));
    }
  }, [stopTimers]);

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
      if (!bracketTogglesSidebar(readSingleKey(e))) return;
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
    <div ref={shellRef} data-sidebar={state} data-sidebar-anim={anim ?? undefined} className="group/shell flex min-h-screen">
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
