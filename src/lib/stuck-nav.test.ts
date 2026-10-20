import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STUCK_NAV_MS,
  cancelStuckNavWatch,
  classifyClick,
  clickGuardTarget,
  isSamePageQueryNav,
  pushGuarded,
  replaceGuarded,
  requestedSince,
  watchSamePageNav,
  type ClickLike,
  type ResourceEntryLike,
  type WatchDeps,
} from "./stuck-nav";

const ORIGIN = "https://app.example";
const here = (pathAndSearch: string) => {
  const u = new URL(pathAndSearch, ORIGIN);
  return { origin: u.origin, pathname: u.pathname, search: u.search, href: u.href };
};
const to = (pathAndSearch: string) => new URL(pathAndSearch, ORIGIN);

describe("isSamePageQueryNav", () => {
  it("is true for the same page with a different query", () => {
    expect(isSamePageQueryNav(here("/inventory"), to("/inventory?status=SPARE"))).toBe(true);
    expect(isSamePageQueryNav(here("/employees?kind=CLIENT"), to("/employees"))).toBe(true);
    expect(isSamePageQueryNav(here("/purchases?state=SUBMITTED"), to("/purchases?state=SUBMITTED&page=2"))).toBe(true);
  });
  it("is false for the same URL", () => {
    expect(isSamePageQueryNav(here("/inventory?status=SPARE"), to("/inventory?status=SPARE"))).toBe(false);
  });
  it("is false for a different path", () => {
    expect(isSamePageQueryNav(here("/inventory"), to("/inventory/abc?tab=history"))).toBe(false);
    expect(isSamePageQueryNav(here("/inventory"), to("/employees?kind=CLIENT"))).toBe(false);
  });
  it("is false for a hash-only change", () => {
    expect(isSamePageQueryNav(here("/inventory?status=SPARE"), to("/inventory?status=SPARE#main"))).toBe(false);
  });
  it("is false for another origin", () => {
    expect(isSamePageQueryNav(here("/inventory"), new URL("https://elsewhere.example/inventory?status=SPARE"))).toBe(false);
  });
});

/** A fake clock and address bar: `run()` fires every pending timer. */
function harness(start: string) {
  const loc = here(start);
  const timers = new Map<number, () => void>();
  let next = 1;
  const assign = vi.fn<(url: string) => void>();
  const replace = vi.fn<(url: string) => void>();
  const CLICK_AT = 1000;
  const entries: ResourceEntryLike[] = [];
  const deps: WatchDeps = {
    enabled: true,
    location: loc,
    now: () => CLICK_AT,
    getResourceEntries: () => entries,
    setTimeout: (fn, ms) => {
      expect(ms).toBe(STUCK_NAV_MS);
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    assign,
    replace,
  };
  const go = (pathAndSearch: string) => {
    const u = to(pathAndSearch);
    loc.pathname = u.pathname;
    loc.search = u.search;
  };
  const run = () => {
    const fns = [...timers.values()];
    timers.clear();
    for (const fn of fns) fn();
  };
  /** The browser recorded a request for `pathAndSearch` (relative to the click: +5 ms after it by default). */
  const request = (pathAndSearch: string, offset = 5) =>
    void entries.push({ name: new URL(pathAndSearch, ORIGIN).href, startTime: CLICK_AT + offset });
  return { deps, assign, replace, go, run, request, pending: () => timers.size };
}

describe("watchSamePageNav", () => {
  it("loads the target the ordinary way when the URL hasn't moved after STUCK_NAV_MS and the target was requested", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    h.request("/inventory?status=SPARE&_rsc=1x2y3");
    expect(h.assign).not.toHaveBeenCalled();
    h.run();
    expect(h.assign).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/inventory?status=SPARE`);
  });
  it("does nothing when no request for the target was recorded (the app cancelled the click)", () => {
    const h = harness("/admin/equipment-policies?tab=client");
    watchSamePageNav(to("/admin/equipment-policies?tab=internal"), h.deps);
    h.request("/admin/equipment-policies?tab=client&_rsc=abc"); // some other request: not the target
    h.request("/api/whatever?tab=internal");
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("ignores a request for the target that started before the navigation (a prefetch)", () => {
    const h = harness("/inventory");
    h.request("/inventory?status=SPARE&_rsc=abc", -200);
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("matches the request with _rsc anywhere and the params in any order", () => {
    const h = harness("/employees");
    watchSamePageNav(to("/employees?kind=CLIENT&page=2&sort=name"), h.deps);
    h.request("/employees?_rsc=q9&sort=name&kind=CLIENT&page=2");
    h.run();
    expect(h.assign).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/employees?kind=CLIENT&page=2&sort=name`);
  });
  it("uses the start time read before the router call when given one", () => {
    const h = harness("/inventory");
    h.request("/inventory?status=SPARE&_rsc=abc", -3); // fetched synchronously inside router.push
    watchSamePageNav(to("/inventory?status=SPARE"), { ...h.deps, since: 990 });
    h.run();
    expect(h.assign).toHaveBeenCalledOnce();
  });
  it("does nothing when the navigation committed", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    h.go("/inventory?status=SPARE");
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("does nothing when the operator went somewhere else meanwhile", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    h.go("/employees");
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("measures from the URL read before the router call when given one", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), { ...h.deps, from: "/employees" });
    h.run(); // still on /inventory, which is not where it started
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("cancel stops it", () => {
    const h = harness("/inventory");
    const cancel = watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    cancel();
    expect(h.pending()).toBe(0);
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("cancelStuckNavWatch stops the latest watch (a click handler that kept the page)", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    cancelStuckNavWatch();
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("only the latest of several rapid watches fires", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    watchSamePageNav(to("/inventory?status=IN_USE"), h.deps);
    watchSamePageNav(to("/inventory?status=REPAIR"), h.deps);
    h.request("/inventory?status=SPARE&_rsc=a");
    h.request("/inventory?status=IN_USE&_rsc=b");
    h.request("/inventory?status=REPAIR&_rsc=c");
    h.run();
    expect(h.assign).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/inventory?status=REPAIR`);
  });
  it("a repeat of the live watch's navigation keeps the earlier start (the router dedupes the re-request)", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps); // since 1000
    h.request("/inventory?status=SPARE&_rsc=a", 5); // the only request, at 1005
    watchSamePageNav(to("/inventory?status=SPARE"), { ...h.deps, since: 1010 }); // clicked again at 1010
    h.run();
    expect(h.assign).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/inventory?status=SPARE`);
  });
  it("doesn't carry a start time over from a different, cancelled or finished watch", () => {
    const h = harness("/inventory");
    h.request("/inventory?status=SPARE&_rsc=a", 5);
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    watchSamePageNav(to("/inventory?status=REPAIR"), { ...h.deps, since: 1010 });
    watchSamePageNav(to("/inventory?status=SPARE"), { ...h.deps, since: 1010 }); // the live watch was REPAIR's
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    cancelStuckNavWatch();
    watchSamePageNav(to("/inventory?status=SPARE"), { ...h.deps, since: 1010 });
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    h.run(); // fired (and assigned once)
    watchSamePageNav(to("/inventory?status=SPARE"), { ...h.deps, since: 1010 });
    h.run();
    expect(h.assign).toHaveBeenCalledOnce();
  });
  it("a one-shot go=1 the server stripped counts as committed (Enter's scanner miss redirects back to the list)", () => {
    // Task 6 review I1: the search had landed (q=Carlo), Enter sent q=Carlo&go=1, the page found no exact tag and
    // redirected to q=Carlo, which is where the navigation started. That is a finished navigation, not a stuck one.
    const h = harness("/inventory?q=Carlo");
    watchSamePageNav(to("/inventory?q=Carlo&go=1"), { ...h.deps, history: "replace" });
    h.request("/inventory?q=Carlo&go=1&_rsc=a1");
    h.run();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("go=1 stripped elsewhere in the query still counts (params in any order)", () => {
    const h = harness("/inventory?cls=PURCHASING&q=car");
    watchSamePageNav(to("/inventory?q=car&go=1&cls=PURCHASING"), h.deps);
    h.request("/inventory?q=car&go=1&cls=PURCHASING&_rsc=b");
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("without a one-shot param, landing back where it started is still stuck", () => {
    const h = harness("/inventory?q=Carlo");
    watchSamePageNav(to("/inventory?q=Carl"), h.deps);
    h.request("/inventory?q=Carl&_rsc=c");
    h.run();
    expect(h.assign).toHaveBeenCalledOnce();
  });
  it("runs beforeFallback just before the ordinary load (the search box remembers its text and caret)", () => {
    const h = harness("/inventory");
    const order: string[] = [];
    h.replace.mockImplementation(() => void order.push("load"));
    watchSamePageNav(to("/inventory?q=Ca"), { ...h.deps, history: "replace", beforeFallback: () => void order.push("remember") });
    h.request("/inventory?q=Ca&_rsc=d");
    h.run();
    expect(order).toEqual(["remember", "load"]);
  });
  it("does not run beforeFallback when nothing is loaded", () => {
    const h = harness("/inventory");
    const before = vi.fn();
    watchSamePageNav(to("/inventory?q=Ca"), { ...h.deps, beforeFallback: before });
    h.go("/inventory?q=Ca");
    h.run();
    expect(before).not.toHaveBeenCalled();
  });
  it("falls back with location.replace for a replace navigation", () => {
    const h = harness("/equipment-by-client?tab=client");
    watchSamePageNav(to("/equipment-by-client?tab=client&group=g1"), { ...h.deps, history: "replace" });
    h.request("/equipment-by-client?tab=client&group=g1&_rsc=z");
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.replace).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/equipment-by-client?tab=client&group=g1`);
  });
  it("is inactive outside production", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), { ...h.deps, enabled: false });
    expect(h.pending()).toBe(0);
    h.run();
    expect(h.assign).not.toHaveBeenCalled();
    // and the default follows NODE_ENV, which is "test" here
    const { enabled: _enabled, ...rest } = h.deps;
    void _enabled;
    watchSamePageNav(to("/inventory?status=SPARE"), rest);
    expect(h.pending()).toBe(0);
  });
});

/** A fake `window` for pushGuarded/replaceGuarded: a clock, an address bar, resource entries and timers. */
function fakeWindow(start: string) {
  const loc = { ...here(start), assign: vi.fn<(url: string) => void>(), replace: vi.fn<(url: string) => void>() };
  const timers = new Map<number, () => void>();
  let next = 1;
  const clock = { t: 500 };
  const entries: ResourceEntryLike[] = [];
  const win = {
    location: loc,
    setTimeout: vi.fn((fn: () => void) => {
      timers.set(next, fn);
      return next++;
    }),
    clearTimeout: vi.fn((id: number) => void timers.delete(id)),
    performance: { now: () => clock.t, getEntriesByType: () => entries },
  };
  vi.stubGlobal("window", win);
  vi.stubEnv("NODE_ENV", "production");
  const request = (pathAndSearch: string, at = clock.t) =>
    void entries.push({ name: new URL(pathAndSearch, ORIGIN).href, startTime: at });
  const run = () => {
    const fns = [...timers.values()];
    timers.clear();
    for (const fn of fns) fn();
  };
  return { win, loc, clock, request, run, pending: () => timers.size };
}

describe("pushGuarded / replaceGuarded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("pushes, and only watches a same-page query navigation", () => {
    const w = fakeWindow("/inventory");
    const router = { push: vi.fn(), replace: vi.fn() };
    pushGuarded(router, "/inventory/abc");
    expect(router.push).toHaveBeenCalledWith("/inventory/abc", undefined);
    expect(w.pending()).toBe(0);
    pushGuarded(router, "/inventory?status=SPARE", { scroll: false });
    expect(router.push).toHaveBeenLastCalledWith("/inventory?status=SPARE", { scroll: false });
    expect(w.pending()).toBe(1);
  });
  it("reads `from` and `since` before the router call", () => {
    const w = fakeWindow("/inventory");
    const router = {
      // Next may fetch synchronously inside push; the clock and the address bar move during the call.
      push: vi.fn(() => {
        w.request("/inventory?status=SPARE&_rsc=1", w.clock.t + 10);
        w.clock.t += 50;
        w.loc.pathname = "/elsewhere";
      }),
      replace: vi.fn(),
    };
    pushGuarded(router, "/inventory?status=SPARE");
    w.loc.pathname = "/inventory"; // still stuck on the page it started from
    w.run();
    expect(w.loc.assign).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/inventory?status=SPARE`);
  });
  it("replaceGuarded replaces, and a stuck replace falls back with location.replace", () => {
    const w = fakeWindow("/equipment-by-client?tab=client");
    const router = { push: vi.fn(), replace: vi.fn(() => w.request("/equipment-by-client?tab=client&group=g1&_rsc=9")) };
    replaceGuarded(router, "/equipment-by-client?tab=client&group=g1", { scroll: false });
    expect(router.replace).toHaveBeenCalledWith("/equipment-by-client?tab=client&group=g1", { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
    w.run();
    expect(w.loc.assign).not.toHaveBeenCalled();
    expect(w.loc.replace).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/equipment-by-client?tab=client&group=g1`);
  });
  it("a navigation to another page cancels a pending watch, so a stuck filter can't drag the operator back", () => {
    const w = fakeWindow("/employees");
    const router = { push: vi.fn((href: string) => w.request(`${href}${href.includes("?") ? "&" : "?"}_rsc=1`)), replace: vi.fn() };
    pushGuarded(router, "/employees?kind=CLIENT"); // sticks
    pushGuarded(router, "/employees/e1"); // a row click before the fallback fires; not committed yet either
    expect(w.pending()).toBe(0);
    w.run();
    expect(w.loc.assign).not.toHaveBeenCalled();
  });
  it("a hash-only navigation doesn't cancel the pending watch", () => {
    const w = fakeWindow("/employees");
    const router = { push: vi.fn((href: string) => w.request(`${href}&_rsc=1`)), replace: vi.fn() };
    pushGuarded(router, "/employees?kind=CLIENT");
    pushGuarded({ push: vi.fn(), replace: vi.fn() }, "/employees#main");
    w.run();
    expect(w.loc.assign).toHaveBeenCalledOnce();
  });
});

describe("requestedSince", () => {
  const entry = (pathAndSearch: string, startTime = 10) => ({ name: new URL(pathAndSearch, ORIGIN).href, startTime });
  it("reads + and %20 as the same space", () => {
    expect(requestedSince(to("/inventory?q=dell%20latitude"), 0, [entry("/inventory?q=dell+latitude&_rsc=1")])).toBe(true);
    expect(requestedSince(to("/inventory?q=dell+latitude"), 0, [entry("/inventory?_rsc=1&q=dell%20latitude")])).toBe(true);
  });
  it("matches repeated keys in any order, but not a different set of values", () => {
    const target = to("/inventory?status=SPARE&status=IN_USE&page=2");
    expect(requestedSince(target, 0, [entry("/inventory?status=IN_USE&_rsc=x&page=2&status=SPARE")])).toBe(true);
    expect(requestedSince(target, 0, [entry("/inventory?status=SPARE&page=2&_rsc=x")])).toBe(false);
    expect(requestedSince(target, 0, [entry("/inventory?status=SPARE&status=SPARE&status=IN_USE&page=2")])).toBe(false);
  });
  it("needs the same origin and pathname, and a start at or after `since`", () => {
    expect(requestedSince(to("/inventory?a=1"), 0, [{ name: "https://elsewhere.example/inventory?a=1", startTime: 10 }])).toBe(false);
    expect(requestedSince(to("/inventory?a=1"), 0, [entry("/inventory/x?a=1")])).toBe(false);
    expect(requestedSince(to("/inventory?a=1"), 10, [entry("/inventory?a=1", 10)])).toBe(true);
    expect(requestedSince(to("/inventory?a=1"), 11, [entry("/inventory?a=1", 10)])).toBe(false);
  });
});

describe("clickGuardTarget — the click guard's filter", () => {
  const loc = here("/inventory");
  const anchor = (href: string, attrs: { target?: string; download?: boolean } = {}) => ({
    href: new URL(href, ORIGIN).href,
    target: attrs.target ?? "",
    hasAttribute: (name: string) => name === "download" && !!attrs.download,
  });
  const click = (a: unknown, over: Partial<ClickLike> = {}): ClickLike => ({
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    target: { closest: (sel: string) => (sel === "a[href]" ? a : null) },
    ...over,
  });

  it("guards a plain left click on a same-page query link", () => {
    expect(clickGuardTarget(click(anchor("/inventory?status=SPARE")), loc)?.href).toBe(`${ORIGIN}/inventory?status=SPARE`);
    expect(clickGuardTarget(click(anchor("/inventory?status=SPARE"), { target: undefined }), loc)).toBeNull();
  });
  it("ignores other buttons and modifier keys", () => {
    const a = anchor("/inventory?status=SPARE");
    expect(clickGuardTarget(click(a, { button: 1 }), loc)).toBeNull();
    expect(clickGuardTarget(click(a, { metaKey: true }), loc)).toBeNull();
    expect(clickGuardTarget(click(a, { ctrlKey: true }), loc)).toBeNull();
    expect(clickGuardTarget(click(a, { shiftKey: true }), loc)).toBeNull();
    expect(clickGuardTarget(click(a, { altKey: true }), loc)).toBeNull();
  });
  it("ignores new-tab, download, external, other-page and hash-only links", () => {
    expect(clickGuardTarget(click(anchor("/inventory?status=SPARE", { target: "_blank" })), loc)).toBeNull();
    expect(clickGuardTarget(click(anchor("/inventory?status=SPARE", { target: "_self" })), loc)).not.toBeNull();
    expect(clickGuardTarget(click(anchor("/inventory?status=SPARE", { download: true })), loc)).toBeNull();
    expect(clickGuardTarget(click(anchor("https://elsewhere.example/inventory?status=SPARE")), loc)).toBeNull();
    expect(clickGuardTarget(click(anchor("/employees?kind=CLIENT")), loc)).toBeNull();
    expect(clickGuardTarget(click(anchor("/inventory#main")), loc)).toBeNull();
  });
  it("classifies a plain click on a link to another page as cancel", () => {
    expect(classifyClick(click(anchor("/employees?kind=CLIENT")), loc)).toEqual({ action: "cancel" });
    expect(classifyClick(click(anchor("/inventory/abc")), loc)).toEqual({ action: "cancel" });
    expect(classifyClick(click(anchor("/inventory?status=SPARE")), loc)).toMatchObject({ action: "watch" });
    // not leaving this tab's page: nothing
    expect(classifyClick(click(anchor("/inventory#main")), loc)).toBeNull();
    expect(classifyClick(click(anchor("/inventory")), loc)).toBeNull();
    expect(classifyClick(click(anchor("/employees"), { ctrlKey: true }), loc)).toBeNull();
    expect(classifyClick(click(anchor("/employees", { target: "_blank" })), loc)).toBeNull();
    expect(classifyClick(click(anchor("/employees", { download: true })), loc)).toBeNull();
    expect(classifyClick(click(anchor("https://elsewhere.example/employees")), loc)).toBeNull();
    expect(classifyClick(click(null), loc)).toBeNull();
  });
  it("ignores clicks that aren't on a link, and SVG links", () => {
    expect(clickGuardTarget(click(null), loc)).toBeNull();
    expect(clickGuardTarget(click({ href: { baseVal: "/inventory?x=1" }, hasAttribute: () => false }), loc)).toBeNull();
    expect(clickGuardTarget({ ...click(null), target: null }, loc)).toBeNull();
  });
});
