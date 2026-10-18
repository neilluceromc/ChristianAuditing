import type { AssetClass } from "@prisma/client";
import { PAGE_DEFAULTS, type NavMatch, type NavView, type VisibleSection } from "./workspaces";

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

/** A view of the link being scored: where it lives and what it matches on. */
interface ViewEntry {
  view: NavView;
  path: string;
  /** the view's match params: its own `match` (one set, or several alternatives), else its href's params */
  alternatives: NavMatch[];
}

/** A view whose path and params matched the URL. */
interface ViewMatch {
  view: NavView;
  path: string;
  /** the alternative that matched (the one with the most params, when several did) */
  params: NavMatch;
}

/** A URL value against a match value: exactly, or (a list) any of its comma-separated values in the list. */
function valueMatches(actual: string | null, want: string | readonly string[]): boolean {
  if (actual == null) return false;
  if (typeof want === "string") return actual === want;
  return actual.split(",").some((v) => want.includes(v.trim()));
}

/**
 * The current link and view for a URL (Phase 42 spec §4.2).
 *
 * - **Current link:** the link with the longest path matched by its own href (path only, never its params) or by
 *   one of its views. A view's path matches by prefix, except when it equals its link's path: then only exactly.
 *   A view counts only when all the params of one of its match alternatives match the URL's. On a tie, more
 *   matched view params win.
 * - **Current view:** among that link's matching views, the one with the most match params. A param-less view
 *   wins only when no param-ful one matched, and only while no param *owned* on its path (a key some sibling view
 *   there matches on) is set to anything but the page default — otherwise no view is current.
 * - **Implicit `cls`:** on `/inventory…`, a URL without `cls` is read as carrying `defaultCls`, because the page
 *   drops `cls` from its own links when it is the viewer's default. On the list itself, a `cls` other than the
 *   default leaves no view current unless the winning view matches on `cls`: the views (and their counts) are the
 *   default class's.
 * - **Empty params:** a param set to "" (`?status=`) is absent, as the list pages read it.
 */
export function currentNav(
  sections: VisibleSection[],
  pathname: string,
  search: URLSearchParams,
  defaultCls: AssetClass,
): NavCurrent {
  const implicit: Record<string, string> = pathMatches("/inventory", pathname) ? { cls: defaultCls } : {};
  const defaults = PAGE_DEFAULTS[pathname] ?? {};
  /** The URL's own value for a param; "" counts as absent. */
  const urlValue = (key: string): string | null => search.get(key) || null;
  /** A param's effective value: the URL's, else the implicit `cls`, else the page default. */
  const valueOf = (key: string): string | null => urlValue(key) ?? implicit[key] ?? defaults[key] ?? null;

  let best: { item: string; pathLength: number; paramCount: number; views: ViewMatch[]; all: ViewEntry[] } | null =
    null;

  for (const item of sections.flatMap((s) => s.items)) {
    const itemPath = parseHref(item.href).path;
    const all: ViewEntry[] = item.views.map((view) => {
      const { path, params } = parseHref(view.href);
      const alternatives = view.match ? (Array.isArray(view.match) ? view.match : [view.match]) : [params];
      return { view, path, alternatives };
    });
    const matched = all.flatMap(({ view, path, alternatives }): ViewMatch[] => {
      if (!(path === itemPath ? pathname === path : pathMatches(path, pathname))) return [];
      const hits = alternatives.filter((alt) => Object.entries(alt).every(([k, v]) => valueMatches(valueOf(k), v)));
      if (hits.length === 0) return [];
      const params = hits.reduce((a, b) => (Object.keys(b).length > Object.keys(a).length ? b : a));
      return [{ view, path, params }];
    });

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
    const owned = new Set(
      best.all.filter((m) => m.path === winner.path).flatMap((m) => m.alternatives.flatMap((alt) => Object.keys(alt))),
    );
    // An owned param set to a value no sibling covers (and not the page default) leaves no view current.
    const uncovered = [...owned].some((k) => {
      const v = urlValue(k) ?? implicit[k];
      return v != null && v !== defaults[k];
    });
    if (uncovered) return { item: best.item, view: null };
  }

  // The list showing another class than the views count: none of them is the page, unless it matches on cls.
  const cls = urlValue("cls");
  if (pathname === "/inventory" && cls && cls !== implicit.cls && !("cls" in winner.params)) {
    return { item: best.item, view: null };
  }

  return { item: best.item, view: winner.view.label };
}
