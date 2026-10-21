/**
 * The stuck same-page navigation fallback (2026-10-19). In the production build (Next.js 15.5.23 and 15.5.28 alike)
 * a soft navigation that changes ONLY the query string of the current page — a filter chip, a facet Apply, a sort
 * header, a page link, a sidebar view of the list you are on — silently never commits about half the time: the
 * router fetches the payload and finishes its reducer, but React's transition suspends forever on a page-content
 * Flight chunk, so the URL and the screen never change and nothing errors. The dev server never shows it; a
 * navigation to a different pathname always works.
 *
 * The mitigation (24/24 on staging): let Next try; if after `STUCK_NAV_MS` the address bar is still on the page the
 * navigation started from, and the browser recorded a request for the target after the navigation began (so the
 * router really set off, and the app didn't cancel the click), load the target the ordinary way. A working click
 * stays instant; a stuck one recovers in about a second and a half.
 */

import { rememberPageSearch } from "./search-restore";

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
  /** The clock resource entries are timed on (performance.now()). */
  now?: () => number;
  /** When the navigation started on that clock, when read before the router call; else read now. */
  since?: number;
  /** The browser's recorded requests (performance.getEntriesByType("resource")). */
  getResourceEntries?: () => ReadonlyArray<ResourceEntryLike>;
  /**
   * Runs just before the ordinary load. Defaults to `rememberPageSearch` (spec §7.2): when the page's search box has
   * focus, its text and caret survive the reload.
   */
  beforeFallback?: () => void;
}

/**
 * Query parameters a page consumes and then strips with a redirect: Inventory's `go=1` (spec §7.2), which only direct
 * links and e2e send now — the search box's Enter opens a scanned tag through `findExactTag` instead. A navigation to a
 * URL carrying one has committed once the address bar shows that URL without it, even when that is the page it
 * started from.
 */
export const ONE_SHOT_PARAMS: readonly string[] = ["go"];

/** True when `target` carries a one-shot param and `here` is `target` without it. */
function landedStripped(here: LocationLike, target: URL): boolean {
  const params = new URLSearchParams(target.search);
  if (!ONE_SHOT_PARAMS.some((p) => params.has(p))) return false;
  for (const p of ONE_SHOT_PARAMS) params.delete(p);
  const qs = params.toString();
  return here.pathname === target.pathname && normalisedSearch(here.search) === normalisedSearch(qs ? `?${qs}` : "");
}

/** The parts of a PerformanceResourceTiming entry `requestedSince` reads. */
export interface ResourceEntryLike {
  name: string;
  startTime: number;
}

const pathAndSearch = (l: { pathname: string; search: string }) => l.pathname + l.search;

/**
 * `?b=2&a=1` and `?a=1&b=2&_rsc=x` compare equal: `_rsc` (Next's cache-busting param) dropped, then every key/value
 * pair sorted (by key, then value, so repeated keys in any order match) and re-serialised the URLSearchParams way
 * (`+` and `%20` both read as a space).
 */
function normalisedSearch(search: string): string {
  const pairs = [...new URLSearchParams(search)].filter(([k]) => k !== "_rsc");
  pairs.sort(([ka, va], [kb, vb]) => (ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0));
  return new URLSearchParams(pairs).toString();
}

/**
 * True when the browser recorded a request for `target` (ignoring `_rsc` and param order) that started at or after
 * `since` — i.e. the router actually set off to fetch it. No such request means the app cancelled the click (an
 * "unsaved changes" confirm declined, a save-first gate) or nothing was attempted: not a stuck navigation.
 */
export function requestedSince(target: URL, since: number, entries: ReadonlyArray<ResourceEntryLike>): boolean {
  const want = normalisedSearch(target.search);
  return entries.some((e) => {
    if (e.startTime < since) return false;
    let u: URL;
    try {
      u = new URL(e.name, target.href);
    } catch {
      return false;
    }
    return u.origin === target.origin && u.pathname === target.pathname && normalisedSearch(u.search) === want;
  });
}

/** Only the newest watch may fire: a second click before the first commits supersedes it. */
let latestToken = 0;
let latestCancel: (() => void) | null = null;
/** The newest watch, while its timer is pending: a repeat of the same navigation keeps its start time. */
let latestWatch: { token: number; from: string; to: string; since: number } | null = null;

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

  const now = deps.now ?? (() => window.performance.now());
  const getEntries = deps.getResourceEntries ?? (() => window.performance.getEntriesByType("resource"));
  const beforeFallback = deps.beforeFallback ?? (() => rememberPageSearch());

  const from = deps.from ?? pathAndSearch(loc);
  const to = pathAndSearch(target);
  let since = deps.since ?? now();
  // A repeat of the live watch's navigation (the same stuck link clicked again, or the click guard's watch followed
  // by NavLink's pushGuarded for the same click) keeps the earlier start: the router dedupes the in-flight request,
  // so no new resource entry appears after the repeat.
  const prev = latestWatch;
  if (prev && prev.token === latestToken && prev.from === from && prev.to === to) since = Math.min(since, prev.since);
  const token = ++latestToken;
  latestWatch = { token, from, to, since };
  let done = false;
  const id = set(() => {
    done = true;
    if (latestWatch?.token === token) latestWatch = null;
    if (token !== latestToken) return;
    const here = pathAndSearch(loc);
    // Committed (here === to, or `to` minus a one-shot param the page stripped), or the operator has gone somewhere
    // else meanwhile (here !== from): leave it alone.
    if (here === to || landedStripped(loc, target) || here !== from) return;
    // Self-protection: only a navigation the router actually started can be stuck. A click the app cancelled
    // (without calling cancelStuckNavWatch) never fetched the target, and reloading would throw away its work.
    if (!requestedSince(target, since, getEntries())) return;
    beforeFallback();
    fallback(target.href);
  }, STUCK_NAV_MS);
  const cancel = () => {
    if (done) return;
    done = true;
    if (latestWatch?.token === token) latestWatch = null;
    clear(id);
  };
  latestCancel = cancel;
  return cancel;
}

/**
 * Called by a click handler that cancels a link's navigation (`preventDefault()` with no navigation of its own — an
 * "unsaved changes" confirm the operator declined, a wait for row saves that will navigate later through
 * `pushGuarded`), so the click guard's watch, started in the capture phase before that handler ran, never fires.
 * A second layer: such a click never requests the target, so `requestedSince` already keeps the watch from firing.
 */
export function cancelStuckNavWatch(): void {
  latestToken++;
  latestCancel?.();
  latestCancel = null;
  latestWatch = null;
}

/** True when `to` is a different page (path or query) from `here`: leaving it, as opposed to a hash-only jump. */
function leaves(here: LocationLike, to: URL): boolean {
  return here.origin !== to.origin || pathAndSearch(here) !== pathAndSearch(to);
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
  // Going to another page: a pending watch for an earlier stuck filter must not drag the operator back to it if
  // this navigation hasn't committed by the time that watch fires.
  if (target !== null && !watch && leaves(window.location, target)) cancelStuckNavWatch();
  const from = watch ? pathAndSearch(window.location) : undefined;
  // The router may start its fetch synchronously inside push/replace, so the clock is read first too.
  const since = watch ? window.performance.now() : undefined;
  if (history === "replace") router.replace(href, options);
  else router.push(href, options);
  if (watch && target) watchSamePageNav(target, { history, from, since });
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

/** What the click guard does with a click: watch a same-page query navigation, cancel on leaving, or nothing. */
export type ClickGuardAction = { action: "watch"; to: URL } | { action: "cancel" } | null;

/**
 * The click guard's filter, for a plain left click (no modifier keys) on an `a[href]` that opens in this tab and
 * isn't a download:
 * - this page with a different query → `watch` it;
 * - another page on this origin → `cancel` any pending watch, so an earlier stuck filter can't drag the operator back
 *   from where they are now going;
 * - otherwise (a hash-only jump, another origin, a new tab, a modified click, not a link) → null.
 */
export function classifyClick(e: ClickLike, here: LocationLike & { href: string }): ClickGuardAction {
  const to = plainLinkTarget(e, here);
  if (!to) return null;
  if (isSamePageQueryNav(here, to)) return { action: "watch", to };
  if (to.origin === here.origin && leaves(here, to)) return { action: "cancel" };
  return null;
}

/** The URL to watch for this click (`classifyClick`'s `watch` case), else null. */
export function clickGuardTarget(e: ClickLike, here: LocationLike & { href: string }): URL | null {
  const c = classifyClick(e, here);
  return c?.action === "watch" ? c.to : null;
}

function plainLinkTarget(e: ClickLike, here: { href: string }): URL | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const t = e.target as { closest?: (selector: string) => AnchorLike | null } | null;
  if (!t || typeof t.closest !== "function") return null;
  const a = t.closest("a[href]");
  // An SVG <a> has an SVGAnimatedString href: not one of ours.
  if (!a || typeof a.href !== "string") return null;
  if (a.target && a.target !== "_self") return null;
  if (a.hasAttribute("download")) return null;
  try {
    return new URL(a.href, here.href);
  } catch {
    return null;
  }
}
