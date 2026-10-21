import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEARCH_RESTORE_KEY, SEARCH_RESTORE_TTL_MS, followPageSearch, pickRestoredSearch, rememberPageSearch,
  rememberPageSearchUntilUnload, stopFollowingPageSearch, takePageSearch,
} from "./search-restore";

/*
 * Task 6 review I2: if the stuck-navigation fallback ever reloads the page under a live search, the reloaded page
 * puts focus, the typed text and the caret back in the search box. A sessionStorage note, written just before the
 * reload, read once on mount and cleared.
 */

function memoryStorage(throws = false) {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => { if (throws) throw new Error("blocked"); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (throws) throw new Error("blocked"); m.set(k, v); },
    removeItem: (k: string) => { if (throws) throw new Error("blocked"); m.delete(k); },
  };
}
const searchBox = (value: string, caret: number | null) => ({
  value, selectionStart: caret, hasAttribute: (a: string) => a === "data-page-search",
});
const otherField = { value: "x", selectionStart: 1, hasAttribute: () => false };

describe("rememberPageSearch / takePageSearch", () => {
  it("round-trips the search box's text and caret for the same page, once", () => {
    const storage = memoryStorage();
    expect(rememberPageSearch({ storage, active: searchBox("Carlo R", 5), path: "/inventory", now: 1000 })).toBe(true);
    expect(takePageSearch({ storage, path: "/inventory", now: 2000 })).toEqual({ text: "Carlo R", caret: 5 });
    expect(takePageSearch({ storage, path: "/inventory", now: 2000 })).toBeNull(); // cleared after use
    expect(storage.map.has(SEARCH_RESTORE_KEY)).toBe(false);
  });
  it("puts the caret at the end when the field reports none", () => {
    const storage = memoryStorage();
    rememberPageSearch({ storage, active: searchBox("Carlo", null), path: "/inventory", now: 0 });
    expect(takePageSearch({ storage, path: "/inventory", now: 1 })).toEqual({ text: "Carlo", caret: 5 });
  });
  it("remembers nothing when focus is not in the page's search box", () => {
    const storage = memoryStorage();
    expect(rememberPageSearch({ storage, active: otherField, path: "/inventory", now: 0 })).toBe(false);
    expect(rememberPageSearch({ storage, active: null, path: "/inventory", now: 0 })).toBe(false);
    expect(storage.map.size).toBe(0);
  });
  it("ignores, and clears, a note for another page or an old one", () => {
    const storage = memoryStorage();
    rememberPageSearch({ storage, active: searchBox("a", 1), path: "/inventory", now: 0 });
    expect(takePageSearch({ storage, path: "/employees", now: 1 })).toBeNull();
    expect(storage.map.size).toBe(0);
    rememberPageSearch({ storage, active: searchBox("a", 1), path: "/inventory", now: 0 });
    expect(takePageSearch({ storage, path: "/inventory", now: SEARCH_RESTORE_TTL_MS + 1 })).toBeNull();
  });
  it("survives blocked or corrupt storage", () => {
    const blocked = memoryStorage(true);
    expect(rememberPageSearch({ storage: blocked, active: searchBox("a", 1), path: "/inventory", now: 0 })).toBe(false);
    expect(takePageSearch({ storage: blocked, path: "/inventory", now: 0 })).toBeNull();
    const storage = memoryStorage();
    storage.map.set(SEARCH_RESTORE_KEY, "{not json");
    expect(takePageSearch({ storage, path: "/inventory", now: 0 })).toBeNull();
    expect(rememberPageSearch({ storage: null, active: searchBox("a", 1), path: "/inventory", now: 0 })).toBe(false);
  });
  it("does nothing outside a browser (no window, no document)", () => {
    expect(rememberPageSearch()).toBe(false);
    expect(takePageSearch()).toBeNull();
  });
});

describe("the note follows the old page until it unloads (final review I2)", () => {
  afterEach(() => {
    stopFollowingPageSearch();
    vi.unstubAllGlobals();
  });

  /** Fake pagehide / beforeunload: `fire(type)` runs what was registered. */
  function events() {
    const handlers = new Map<string, Array<() => void>>();
    return {
      listen: (type: "pagehide" | "beforeunload", fn: () => void) =>
        void handlers.set(type, [...(handlers.get(type) ?? []), fn]),
      fire: (type: string) => (handlers.get(type) ?? []).forEach((fn) => fn()),
      count: (type: string) => handlers.get(type)?.length ?? 0,
    };
  }

  it("writes nothing on a keystroke when no fallback reload is under way", () => {
    const storage = memoryStorage();
    expect(followPageSearch(searchBox("mac", 3))).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it("every keystroke after the fallback's note rewrites it: the reload gets the latest text and caret", () => {
    const storage = memoryStorage();
    const ev = events();
    const clock = { t: 1000 };
    // "mac", pause, the fallback fires and notes it...
    expect(rememberPageSearchUntilUnload({
      storage, active: searchBox("mac", 3), path: "/inventory", listen: ev.listen, clock: () => clock.t,
    })).toBe(true);
    // ...and the person carries on with "book" while the page reloads
    for (const text of ["macb", "macbo", "macboo", "macbook"]) {
      clock.t += 50;
      expect(followPageSearch(searchBox(text, text.length))).toBe(true);
    }
    expect(takePageSearch({ storage, path: "/inventory", now: clock.t })).toEqual({ text: "macbook", caret: 7 });
  });

  it("pagehide and beforeunload write it once more from the focused box (a caret moved without typing)", () => {
    const storage = memoryStorage();
    const ev = events();
    rememberPageSearchUntilUnload({ storage, active: searchBox("mac", 3), path: "/inventory", listen: ev.listen, clock: () => 5 });
    expect(ev.count("pagehide")).toBe(1);
    expect(ev.count("beforeunload")).toBe(1);
    // the handlers read the focused field (no document here: nothing focused), so they leave the last note alone
    ev.fire("beforeunload");
    ev.fire("pagehide");
    expect(takePageSearch({ storage, path: "/inventory", now: 6 })).toEqual({ text: "mac", caret: 3 });
    // with the box focused, the last keystrokes before unload are what the note keeps
    vi.stubGlobal("document", { activeElement: searchBox("macbook", 7) });
    rememberPageSearchUntilUnload({ storage, active: searchBox("mac", 3), path: "/inventory", listen: ev.listen, clock: () => 5 });
    ev.fire("pagehide");
    expect(takePageSearch({ storage, path: "/inventory", now: 6 })).toEqual({ text: "macbook", caret: 7 });
    // a second fallback on the same document does not register them twice
    rememberPageSearchUntilUnload({ storage, active: searchBox("ma", 2), path: "/inventory", listen: ev.listen, clock: () => 7 });
    expect(ev.count("pagehide")).toBe(1);
  });

  it("stops following once the note would be stale, and never starts without a note", () => {
    const storage = memoryStorage();
    const clock = { t: 0 };
    rememberPageSearchUntilUnload({ storage, active: searchBox("mac", 3), path: "/inventory", listen: null, clock: () => clock.t });
    clock.t = SEARCH_RESTORE_TTL_MS + 1;
    expect(followPageSearch(searchBox("macbook", 7))).toBe(false);
    stopFollowingPageSearch();
    expect(rememberPageSearchUntilUnload({ storage, active: otherField, path: "/inventory", listen: null })).toBe(false);
    expect(followPageSearch(searchBox("macbook", 7))).toBe(false);
  });

  it("a keystroke in another field doesn't overwrite the note", () => {
    const storage = memoryStorage();
    rememberPageSearchUntilUnload({ storage, active: searchBox("mac", 3), path: "/inventory", listen: null, clock: () => 1 });
    expect(followPageSearch(otherField)).toBe(false);
    expect(takePageSearch({ storage, path: "/inventory", now: 2 })).toEqual({ text: "mac", caret: 3 });
  });
});

describe("pickRestoredSearch: what the reloaded box shows (final review I2)", () => {
  const note = { text: "macbook", caret: 7 };
  it("the note, when the field still shows what the server rendered", () => {
    expect(pickRestoredSearch(note, { value: "mac", selectionStart: 3 }, "mac")).toEqual(note);
  });
  it("text typed into the server-rendered field before hydration wins over the note", () => {
    expect(pickRestoredSearch(note, { value: "macbook pro", selectionStart: 11 }, "mac")).toEqual({ text: "macbook pro", caret: 11 });
    expect(pickRestoredSearch(note, { value: "macb", selectionStart: null }, "mac")).toEqual({ text: "macb", caret: 4 });
  });
  it("nothing without a note", () => {
    expect(pickRestoredSearch(null, { value: "x", selectionStart: 1 }, "")).toBeNull();
  });
});
