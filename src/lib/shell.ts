import type { NavSection } from "./workspaces";

/**
 * The phone top bar's page name (spec §3): the nav item whose path is the
 * longest prefix of the current path, so a record (/inventory/abc/history)
 * reads as its section ("Inventory"). An item's query string is ignored for
 * matching. Home ("/") matches only the root itself. Null when nothing fits —
 * the caller shows the workspace name instead.
 */
export function navLabelFor(pathname: string, sections: NavSection[]): string | null {
  let best: { label: string; length: number } | null = null;
  for (const item of sections.flatMap((s) => s.items)) {
    const path = item.href.split("?")[0];
    const hit = path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/");
    if (hit && (!best || path.length > best.length)) best = { label: item.label, length: path.length };
  }
  return best?.label ?? null;
}

/** Spec §3: the workspace switcher reads "{n} workspaces" (singular for one), never the cookie name. */
export function workspaceCountLabel(n: number): string {
  return `${n} workspace${n === 1 ? "" : "s"}`;
}
