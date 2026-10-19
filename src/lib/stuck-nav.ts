/**
 * The stuck same-page navigation fallback (2026-10-19). In the production build (Next.js 15.5.23 and 15.5.28 alike)
 * a soft navigation that changes ONLY the query string of the current page — a filter chip, a facet Apply, a sort
 * header, a page link, a sidebar view of the list you are on — silently never commits about half the time: the
 * router fetches the payload and finishes its reducer, but React's transition suspends forever on a page-content
 * Flight chunk, so the URL and the screen never change and nothing errors. The dev server never shows it; a
 * navigation to a different pathname always works.
 *
 * The mitigation (24/24 on staging): let Next try; if after `STUCK_NAV_MS` the address bar is still on the page the
 * navigation started from, load the target the ordinary way. A working click stays instant; a stuck one recovers in
 * about a second and a half.
 */

/** How long a same-page query navigation gets to commit before the page is loaded the ordinary way. */
export const STUCK_NAV_MS = 1200;

/** The parts of `window.location` (or a `URL`) this module reads. */
export interface LocationLike {
  origin: string;
  pathname: string;
  search: string;
}

/**
 * True when going from `from` to `to` stays on the same page and changes only the query string: same origin, same
 * pathname, different search. A hash-only change is not one (it never asks the server for anything).
 */
export function isSamePageQueryNav(from: LocationLike, to: URL): boolean {
  return from.origin === to.origin && from.pathname === to.pathname && from.search !== to.search;
}

/** For tests: everything `watchSamePageNav` touches outside itself. */
export interface WatchDeps {
  /** Read live at check time (window.location in the browser). */
  location?: LocationLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  /** The fallback for a push (window.location.assign). */
  assign?: (url: string) => void;
  /** The fallback for a replace (window.location.replace), so a stuck replace doesn't add a history entry. */
  replace?: (url: string) => void;
  /** Defaults to production only: the dev server never shows the bug, and a stray full load there only hurts. */
  enabled?: boolean;
  /** Use `replace` instead of `assign` for the fallback. */
  history?: "push" | "replace";
  /** The path + search the navigation started from, when read before the router call; else read now. */
  from?: string;
}

const pathAndSearch = (l: { pathname: string; search: string }) => l.pathname + l.search;

/** Only the newest watch may fire: a second click before the first commits supersedes it. */
let latestToken = 0;
let latestCancel: (() => void) | null = null;

/**
 * After a same-page query navigation has been started, check back in `STUCK_NAV_MS`: if the address bar is still
 * on the page it started from (not the target, not anywhere else the operator went meanwhile) and no newer watch
 * has started, load `target` the ordinary way. Returns a cancel function.
 */
export function watchSamePageNav(target: URL, deps: WatchDeps = {}): () => void {
  const enabled = deps.enabled ?? process.env.NODE_ENV === "production";
  if (!enabled) return () => {};
  const loc = deps.location ?? window.location;
  const set = deps.setTimeout ?? ((fn: () => void, ms: number) => window.setTimeout(fn, ms));
  const clear = deps.clearTimeout ?? ((id: unknown) => window.clearTimeout(id as number));
  const fallback =
    deps.history === "replace"
      ? (deps.replace ?? ((url: string) => window.location.replace(url)))
      : (deps.assign ?? ((url: string) => window.location.assign(url)));

  const from = deps.from ?? pathAndSearch(loc);
  const to = pathAndSearch(target);
  const token = ++latestToken;
  let done = false;
  const id = set(() => {
    done = true;
    if (token !== latestToken) return;
    const here = pathAndSearch(loc);
    // Committed (here === to), or the operator has gone somewhere else meanwhile (here !== from): leave it alone.
    if (here === to || here !== from) return;
    fallback(target.href);
  }, STUCK_NAV_MS);
  const cancel = () => {
    if (done) return;
    done = true;
    clear(id);
  };
  latestCancel = cancel;
  return cancel;
}

/**
 * Called by a click handler that cancels a link's navigation (`preventDefault()` with no navigation of its own — an
 * "unsaved changes" confirm the operator declined, a wait for row saves that will navigate later through
 * `pushGuarded`), so the click guard's watch, started in the capture phase before that handler ran, never fires.
 */
export function cancelStuckNavWatch(): void {
  latestToken++;
  latestCancel?.();
  latestCancel = null;
}

/** The slice of Next's app router `pushGuarded`/`replaceGuarded` call. */
export interface RouterLike {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
}

function guarded(
  router: RouterLike,
  href: string,
  options: { scroll?: boolean } | undefined,
  history: "push" | "replace",
): void {
  // Read before the router call: the start point is the page the navigation leaves.
  const target = typeof window === "undefined" ? null : new URL(href, window.location.href);
  const watch = target !== null && isSamePageQueryNav(window.location, target);
  const from = watch ? pathAndSearch(window.location) : undefined;
  if (history === "replace") router.replace(href, options);
  else router.push(href, options);
  if (watch && target) watchSamePageNav(target, { history, from });
}

/** `router.push(href)`, plus the stuck-navigation fallback when `href` is this page with a different query. */
export function pushGuarded(router: RouterLike, href: string, options?: { scroll?: boolean }): void {
  guarded(router, href, options, "push");
}

/** `router.replace(href)`, plus the stuck-navigation fallback when `href` is this page with a different query. */
export function replaceGuarded(router: RouterLike, href: string, options?: { scroll?: boolean }): void {
  guarded(router, href, options, "replace");
}

/** The parts of a click event `clickGuardTarget` reads. */
export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
}

interface AnchorLike {
  href: unknown;
  target?: string;
  hasAttribute(name: string): boolean;
}

/**
 * The click guard's filter: the URL to watch when this click is a plain left click (no modifier keys) on an
 * `a[href]` that opens in this tab, isn't a download, and goes to this page with a different query; otherwise null.
 */
export function clickGuardTarget(e: ClickLike, here: LocationLike & { href: string }): URL | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const t = e.target as { closest?: (selector: string) => AnchorLike | null } | null;
  if (!t || typeof t.closest !== "function") return null;
  const a = t.closest("a[href]");
  // An SVG <a> has an SVGAnimatedString href: not one of ours.
  if (!a || typeof a.href !== "string") return null;
  if (a.target && a.target !== "_self") return null;
  if (a.hasAttribute("download")) return null;
  let to: URL;
  try {
    to = new URL(a.href, here.href);
  } catch {
    return null;
  }
  return isSamePageQueryNav(here, to) ? to : null;
}
