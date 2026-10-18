import type { AssetClass } from "@prisma/client";
import { PAGE_DEFAULTS, type NavView, type VisibleSection } from "./workspaces";

/** The current link and the current view under it, by label (labels are unique within a workspace). */
export interface NavCurrent {
  item: string | null;
  view: string | null;
}

/** `/` matches only `/`; any other path matches itself or a deeper path at a `/` boundary. */
function pathMatches(base: string, pathname: string): boolean {
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

function parseHref(href: string): { path: string; params: Record<string, string> } {
  const url = new URL(href, "http://nav.local");
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) };
}

interface ViewMatch {
  view: NavView;
  path: string;
  /** the view's match params: its own `match`, else its href's params */
  params: Record<string, string>;
}

/**
 * The current link and view for a URL (Phase 42 spec §4.2).
 *
 * - **Current link:** the link with the longest path matched by its own href (path only, never its params) or by
 *   one of its views. A view's path matches by prefix, except when it equals its link's path: then only exactly.
 *   A view counts only when all its match params equal the URL's. On a tie, more matched view params win.
 * - **Current view:** among that link's matching views, the one with the most match params. A param-less view
 *   wins only when no param-ful one matched, and only while no param *owned* on its path (a key some sibling view
 *   there matches on) is set to anything but the page default — otherwise no view is current.
 * - **Implicit `cls`:** on `/inventory…`, a URL without `cls` is read as carrying `defaultCls`, because the page
 *   drops `cls` from its own links when it is the viewer's default.
 */
export function currentNav(
  sections: VisibleSection[],
  pathname: string,
  search: URLSearchParams,
  defaultCls: AssetClass,
): NavCurrent {
  const implicit: Record<string, string> = pathMatches("/inventory", pathname) ? { cls: defaultCls } : {};
  const defaults = PAGE_DEFAULTS[pathname] ?? {};
  /** A param's effective value: the URL's, else the implicit `cls`, else the page default. */
  const valueOf = (key: string): string | null => search.get(key) ?? implicit[key] ?? defaults[key] ?? null;

  let best: { item: string; pathLength: number; paramCount: number; views: ViewMatch[]; all: ViewMatch[] } | null =
    null;

  for (const item of sections.flatMap((s) => s.items)) {
    const itemPath = parseHref(item.href).path;
    const all: ViewMatch[] = item.views.map((view) => {
      const { path, params } = parseHref(view.href);
      return { view, path, params: view.match ?? params };
    });
    const matched = all.filter(
      ({ path, params }) =>
        (path === itemPath ? pathname === path : pathMatches(path, pathname)) &&
        Object.entries(params).every(([k, v]) => valueOf(k) === v),
    );

    let pathLength = pathMatches(itemPath, pathname) ? itemPath.length : -1;
    let paramCount = 0;
    for (const m of matched) {
      const count = Object.keys(m.params).length;
      if (m.path.length > pathLength || (m.path.length === pathLength && count > paramCount)) {
        pathLength = m.path.length;
        paramCount = count;
      }
    }
    if (pathLength < 0) continue;
    if (!best || pathLength > best.pathLength || (pathLength === best.pathLength && paramCount > best.paramCount)) {
      best = { item: item.label, pathLength, paramCount, views: matched, all };
    }
  }

  if (!best) return { item: null, view: null };

  // Most match params first, then the longer path.
  const [winner] = [...best.views].sort(
    (a, b) =>
      Object.keys(b.params).length - Object.keys(a.params).length || b.path.length - a.path.length,
  );
  if (!winner) return { item: best.item, view: null };

  if (Object.keys(winner.params).length === 0) {
    const owned = new Set(best.all.filter((m) => m.path === winner.path).flatMap((m) => Object.keys(m.params)));
    // An owned param set to a value no sibling covers (and not the page default) leaves no view current.
    const uncovered = [...owned].some((k) => {
      const v = search.get(k) ?? implicit[k];
      return v != null && v !== defaults[k];
    });
    if (uncovered) return { item: best.item, view: null };
  }

  return { item: best.item, view: winner.view.label };
}
