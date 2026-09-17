import { describe, expect, it } from "vitest";
import { parseRecent, pushRecent, RECENT_MAX, recentKey, recentOptions } from "./recent-picks";

describe("pushRecent", () => {
  it("moves an existing id to the front", () => {
    expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"]);
  });
  it("prepends a new id and drops the oldest past RECENT_MAX", () => {
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
  });
});

describe("recentOptions", () => {
  it("returns options whose value is in recent, in recent order, dropping ids not offered", () => {
    expect(recentOptions([{ value: "a" }, { value: "c" }], ["c", "x", "a"])).toEqual([{ value: "c" }, { value: "a" }]);
  });
});

describe("parseRecent", () => {
  it("null is not an array", () => expect(parseRecent(null)).toEqual([]));
  it("a string is not an array", () => expect(parseRecent("x")).toEqual([]));
  it("filters out non-string entries", () => expect(parseRecent(["a", 1])).toEqual(["a"]));
});

describe("recentKey", () => {
  it("namespaces the preference key", () => expect(recentKey("vendor")).toBe("recent:vendor"));
});

describe("RECENT_MAX", () => {
  it("is 5", () => expect(RECENT_MAX).toBe(5));
});
