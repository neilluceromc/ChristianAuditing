import { describe, expect, it } from "vitest";
import { uncoveredItems } from "./acknowledgement";

const held = [{ assetId: "a", tag: "BR-LT-0001" }, { assetId: "b", tag: "BR-MN-0002" }];
describe("uncoveredItems (Phase 16 §6)", () => {
  it("no record on file: everything held is uncovered", () => {
    expect(uncoveredItems(held, null).map((h) => h.tag)).toEqual(["BR-LT-0001", "BR-MN-0002"]);
  });
  it("a full match covers everything", () => {
    expect(uncoveredItems(held, [{ assetId: "a" }, { assetId: "b" }])).toEqual([]);
  });
  it("items issued since the last signature are named", () => {
    expect(uncoveredItems(held, [{ assetId: "a" }]).map((h) => h.tag)).toEqual(["BR-MN-0002"]);
  });
});
