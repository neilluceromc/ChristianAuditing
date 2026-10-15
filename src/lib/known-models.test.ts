import { describe, expect, it } from "vitest";
import { matchModels, mergeKnownModels } from "./known-models";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("mergeKnownModels", () => {
  it("one row per model ignoring case and spaces; newest spelling wins; counts in-stock units; carries no type", () => {
    const list = mergeKnownModels([
      { model: "ThinkPad T14 Gen 4", createdAt: d("2026-01-01"), inStock: true },
      { model: "thinkpad t14 gen 4 ", createdAt: d("2026-06-01"), inStock: false },
      { model: "Latitude 5440", createdAt: d("2026-02-01"), inStock: true },
    ]);
    expect(list).toEqual([
      { model: "thinkpad t14 gen 4", inStock: 1 },
      { model: "Latitude 5440", inStock: 1 },
    ]);
  });
});

describe("matchModels", () => {
  const list = [{ model: "ThinkPad T14 Gen 4", inStock: 5 }, { model: "Latitude 5440", inStock: 0 }];
  it("empty query lists everything up to the limit", () => {
    expect(matchModels(list, "")).toHaveLength(2);
    expect(matchModels(list, "", 1)).toHaveLength(1);
  });
  it("case-insensitive substring", () => {
    expect(matchModels(list, "t14").map((m) => m.model)).toEqual(["ThinkPad T14 Gen 4"]);
  });
});
