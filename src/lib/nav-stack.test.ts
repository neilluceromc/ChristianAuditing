import { describe, expect, it } from "vitest";
import { NAV_STACK_MAX, popForBack, pushPath, readStack, writeStack } from "./nav-stack";

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
