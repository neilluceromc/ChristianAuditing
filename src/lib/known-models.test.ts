import { describe, expect, it } from "vitest";
import { matchModels, mergeKnownModels, resolveModelType } from "./known-models";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("mergeKnownModels", () => {
  it("one row per model ignoring case and spaces; newest type wins; counts in-stock units", () => {
    const list = mergeKnownModels([
      { model: "ThinkPad T14 Gen 4", typeId: "tp", createdAt: d("2026-01-01"), inStock: true },
      { model: "thinkpad t14 gen 4 ", typeId: "dl", createdAt: d("2026-06-01"), inStock: false },
      { model: "Latitude 5440", typeId: "dl", createdAt: d("2026-02-01"), inStock: true },
    ]);
    expect(list).toEqual([
      { model: "thinkpad t14 gen 4", typeId: "dl", inStock: 1 },
      { model: "Latitude 5440", typeId: "dl", inStock: 1 },
    ]);
  });
});

describe("matchModels", () => {
  const list = [{ model: "ThinkPad T14 Gen 4", typeId: "tp", inStock: 5 }, { model: "Latitude 5440", typeId: "dl", inStock: 0 }];
  it("empty query lists everything up to the limit", () => {
    expect(matchModels(list, "")).toHaveLength(2);
    expect(matchModels(list, "", 1)).toHaveLength(1);
  });
  it("case-insensitive substring", () => {
    expect(matchModels(list, "t14").map((m) => m.model)).toEqual(["ThinkPad T14 Gen 4"]);
  });
});

describe("resolveModelType (Review Focus 1)", () => {
  const list = [{ model: "ThinkPad T14 Gen 4", typeId: "tp", inStock: 5 }];
  it("matches a known model typed with other case and stray spaces", () => {
    expect(resolveModelType(list, "  thinkpad  t14 gen 4 ")).toEqual({ known: true, typeId: "tp" });
  });
  it("a new model is not known", () => {
    expect(resolveModelType(list, "ThinkPad X1 Carbon")).toEqual({ known: false });
  });
});
