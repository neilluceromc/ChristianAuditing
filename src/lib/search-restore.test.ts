import { describe, expect, it } from "vitest";
import { SEARCH_RESTORE_KEY, SEARCH_RESTORE_TTL_MS, rememberPageSearch, takePageSearch } from "./search-restore";

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
