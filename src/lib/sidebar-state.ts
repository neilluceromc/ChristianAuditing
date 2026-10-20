/**
 * Phase 46 spec §4.1: the desktop sidebar is either the full panel or the 72 px icon rail. The `br.sidebar` cookie
 * holds the choice; `(app)/layout.tsx` reads it so the first paint is already right, and the collapse control
 * (sidebar-collapse.tsx) writes it.
 */
export type SidebarState = "rail" | "full";

export const SIDEBAR_COOKIE = "br.sidebar";

/** Anything but "rail" (missing cookie, a stale or hand-edited value) reads as the full sidebar. */
export function parseSidebar(v: string | undefined): SidebarState {
  return v === "rail" ? "rail" : "full";
}

export function nextSidebar(s: SidebarState): SidebarState {
  return s === "rail" ? "full" : "rail";
}

/** The cookie string, one year, site-wide, lax: the same shape as `br.density`. */
export function sidebarCookie(s: SidebarState): string {
  return `${SIDEBAR_COOKIE}=${s};path=/;max-age=31536000;samesite=lax`;
}

/**
 * Phase 47 spec §5.1: the collapse animation's timings, matching `--dur-4` (the width) and `--dur-2` (the labels'
 * fade) in globals.css.
 */
export const SIDEBAR_WIDTH_MS = 260;
export const SIDEBAR_FADE_MS = 140;

/** The shell's `data-sidebar-anim` while animating: "hide" holds the labels at opacity 0, "show" fades them back in. */
export type SidebarAnim = "hide" | "show";

/** One moment of the animation: from `at` ms after the toggle, the shell shows `state` with `anim` (null: none). */
export interface SidebarStep {
  at: number;
  state: SidebarState;
  anim: SidebarAnim | null;
}

/**
 * The toggle's timeline from what the shell `shown` now to `next`. Collapsing, the labels fade out before the width
 * shrinks; expanding, the width grows with the labels hidden and they fade in after it. A toggle back before the
 * width moved (`shown === next`) only fades the labels back in. Under prefers-reduced-motion: one instant step, no
 * animation attribute. The first paint never animates because the shell starts with no `anim` at all.
 */
export function sidebarSteps(shown: SidebarState, next: SidebarState, reduced: boolean): SidebarStep[] {
  if (reduced) return [{ at: 0, state: next, anim: null }];
  if (shown === next) {
    return [
      { at: 0, state: next, anim: "show" },
      { at: SIDEBAR_FADE_MS, state: next, anim: null },
    ];
  }
  if (next === "rail") {
    const shrunk = SIDEBAR_FADE_MS + SIDEBAR_WIDTH_MS;
    return [
      { at: 0, state: "full", anim: "hide" },
      { at: SIDEBAR_FADE_MS, state: "rail", anim: "hide" },
      { at: shrunk, state: "rail", anim: "show" },
      { at: shrunk + SIDEBAR_FADE_MS, state: "rail", anim: null },
    ];
  }
  return [
    { at: 0, state: "full", anim: "hide" },
    { at: SIDEBAR_WIDTH_MS, state: "full", anim: "show" },
    { at: SIDEBAR_WIDTH_MS + SIDEBAR_FADE_MS, state: "full", anim: null },
  ];
}
