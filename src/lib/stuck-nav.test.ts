import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STUCK_NAV_MS,
  cancelStuckNavWatch,
  clickGuardTarget,
  isSamePageQueryNav,
  pushGuarded,
  watchSamePageNav,
  type ClickLike,
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
  const deps: WatchDeps = {
    enabled: true,
    location: loc,
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
  return { deps, assign, replace, go, run, pending: () => timers.size };
}

describe("watchSamePageNav", () => {
  it("loads the target the ordinary way when the URL hasn't moved after STUCK_NAV_MS", () => {
    const h = harness("/inventory");
    watchSamePageNav(to("/inventory?status=SPARE"), h.deps);
    expect(h.assign).not.toHaveBeenCalled();
    h.run();
    expect(h.assign).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/inventory?status=SPARE`);
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
    h.run();
    expect(h.assign).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/inventory?status=REPAIR`);
  });
  it("falls back with location.replace for a replace navigation", () => {
    const h = harness("/equipment-by-client?tab=client");
    watchSamePageNav(to("/equipment-by-client?tab=client&group=g1"), { ...h.deps, history: "replace" });
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

describe("pushGuarded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("pushes, and only watches a same-page query navigation", () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    const setTimeout = vi.fn(() => 1);
    vi.stubGlobal("window", { location: here("/inventory"), setTimeout, clearTimeout: vi.fn() });
    vi.stubEnv("NODE_ENV", "production");
    try {
      pushGuarded(router, "/inventory/abc");
      expect(router.push).toHaveBeenCalledWith("/inventory/abc", undefined);
      expect(setTimeout).not.toHaveBeenCalled();
      pushGuarded(router, "/inventory?status=SPARE", { scroll: false });
      expect(router.push).toHaveBeenLastCalledWith("/inventory?status=SPARE", { scroll: false });
      expect(setTimeout).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllEnvs();
    }
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
  it("ignores clicks that aren't on a link, and SVG links", () => {
    expect(clickGuardTarget(click(null), loc)).toBeNull();
    expect(clickGuardTarget(click({ href: { baseVal: "/inventory?x=1" }, hasAttribute: () => false }), loc)).toBeNull();
    expect(clickGuardTarget({ ...click(null), target: null }, loc)).toBeNull();
  });
});
