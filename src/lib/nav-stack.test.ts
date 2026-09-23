import { describe, expect, it } from "vitest";
import { NAV_STACK_MAX, leaveFor, popForBack, pushPath, readStack, writeStack } from "./nav-stack";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
};

describe("nav-stack — whether Back has somewhere in-app to go", () => {
  it("pushes a new path and skips a repeat of the top", () => {
    expect(pushPath([], "/inventory")).toEqual(["/inventory"]);
    expect(pushPath(["/inventory"], "/inventory")).toEqual(["/inventory"]);
    expect(pushPath(["/inventory"], "/inventory?status=SPARE")).toEqual(["/inventory", "/inventory?status=SPARE"]);
  });
  it("caps the stack", () => {
    const long = Array.from({ length: NAV_STACK_MAX }, (_, i) => `/p${i}`);
    expect(pushPath(long, "/new")).toHaveLength(NAV_STACK_MAX);
    expect(pushPath(long, "/new").at(-1)).toBe("/new");
  });
  it("can go back only when a previous page remains", () => {
    expect(popForBack([])).toEqual({ stack: [], canGoBack: false });
    expect(popForBack(["/inventory/abc"])).toEqual({ stack: ["/inventory/abc"], canGoBack: false });
    expect(popForBack(["/inventory?status=SPARE", "/inventory/abc"])).toEqual({ stack: ["/inventory?status=SPARE"], canGoBack: true });
  });
  it("leaving an edit form for its record steps back when the record is the previous page (Phase 30, R9)", () => {
    const list = "/inventory?status=SPARE", rec = "/inventory/abc", edit = "/inventory/abc/edit";
    // list → record → edit: back to the record, whose own Back then reaches the list
    expect(leaveFor([list, rec, edit], rec)).toEqual({ stack: [list, rec], back: true });
    expect(popForBack(leaveFor([list, rec, edit], rec).stack)).toEqual({ stack: [list], canGoBack: true });
    // reached from somewhere else (a deep link's history, the list's row menu): replace, never stack
    expect(leaveFor([list, edit], rec)).toEqual({ stack: [list], back: false });
    // the previous page is the record with a query (?created=1): not the same page, so replace
    expect(leaveFor(["/inventory/abc?created=1", edit], rec)).toEqual({ stack: ["/inventory/abc?created=1"], back: false });
    // a deep link straight to the form: replace, and the record's Back falls back to its parent
    expect(leaveFor([edit], rec)).toEqual({ stack: [], back: false });
    expect(leaveFor([], rec)).toEqual({ stack: [], back: false });
  });
  it("reads garbage as empty and swallows a storage that throws", () => {
    const s = mem();
    s.map.set("br.nav-stack", "{not json");
    expect(readStack(s)).toEqual([]);
    s.map.set("br.nav-stack", JSON.stringify(["/a", 3, null]));
    expect(readStack(s)).toEqual(["/a"]);
    writeStack({ setItem: () => { throw new Error("quota"); } }, ["/a"]);
    writeStack(s, ["/a", "/b"]);
    expect(readStack(s)).toEqual(["/a", "/b"]);
  });
});
