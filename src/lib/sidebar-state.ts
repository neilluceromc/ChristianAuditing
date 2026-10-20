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
