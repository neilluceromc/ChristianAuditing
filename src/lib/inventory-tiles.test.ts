import { describe, expect, it } from "vitest";
import { buildInventoryTiles, tileState, TILE_SPECS } from "./inventory-tiles";
import { INVENTORY_LIST_CONFIG } from "./inventory-list";
import { parseListState, serializeListState, type ListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), INVENTORY_LIST_CONFIG);
const hrefFor = (s: ListState) => `/inventory${serializeListState(s, INVENTORY_LIST_CONFIG)}`;
const spec = (cls: "IT" | "PURCHASING", key: string) => TILE_SPECS[cls].find((t) => t.key === key)!;

describe("TILE_SPECS", () => {
  it("IT has the six spec tiles in order", () => {
    expect(TILE_SPECS.IT.map((t) => [t.key, t.status ?? "attention"])).toEqual([
      ["in-stock", "SPARE"], ["deployed", "DEPLOYED"], ["on-loan", "TEMPORARY"],
      ["in-repair", "DEFECTIVE"], ["missing", "MISSING"], ["attention", "attention"],
    ]);
  });
  it("Purchasing has five", () => {
    expect(TILE_SPECS.PURCHASING.map((t) => [t.key, t.status ?? "attention"])).toEqual([
      ["in-use", "OPERATIONAL"], ["stored", "STORED"], ["repairing", "REPAIRING"],
      ["lost", "LOST"], ["attention", "attention"],
    ]);
  });
});

describe("tileState", () => {
  it("turning a status tile on sets only its status and resets the page", () => {
    const s = tileState({ ...parse("category=c1&page=3&attention=1"), }, spec("IT", "in-stock"), false);
    expect(s.filters).toEqual({ category: ["c1"], status: ["SPARE"] });
    expect(s.page).toBe(1);
  });
  it("turning attention on clears status", () => {
    const s = tileState(parse("status=SPARE"), spec("IT", "attention"), false);
    expect(s.filters).toEqual({ attention: ["1"] });
  });
  it("one at a time: switching tiles replaces the previous filter", () => {
    const s = tileState(parse("status=SPARE"), spec("IT", "deployed"), false);
    expect(s.filters.status).toEqual(["DEPLOYED"]);
    expect(s.filters.attention).toBeUndefined();
  });
  it("turning the pressed tile off clears status and attention only", () => {
    const s = tileState(parse("status=SPARE&category=c1&page=2"), spec("IT", "in-stock"), true);
    expect(s.filters).toEqual({ category: ["c1"] });
    expect(s.page).toBe(1);
  });
});

describe("buildInventoryTiles", () => {
  const counts = { "in-stock": 4, deployed: 9, attention: 2 };
  it("is empty in the Repairs view", () => {
    expect(buildInventoryTiles("IT", parse("stage=to-assess"), counts, hrefFor)).toEqual([]);
  });
  it("gives six IT and five Purchasing tiles", () => {
    expect(buildInventoryTiles("IT", parse(""), counts, hrefFor)).toHaveLength(6);
    expect(buildInventoryTiles("PURCHASING", parse(""), counts, hrefFor)).toHaveLength(5);
  });
  it("carries counts (0 when missing), caption and family", () => {
    const tiles = buildInventoryTiles("IT", parse(""), counts, hrefFor);
    expect(tiles[0]).toMatchObject({ key: "in-stock", label: "In stock", caption: "Spare, ready to assign", family: "neutral", count: 4 });
    expect(tiles[2]).toMatchObject({ label: "Loan", family: "inflight", count: 0 });
  });
  it("marks a tile on for status=SPARE, and its href turns it off", () => {
    const tiles = buildInventoryTiles("IT", parse("status=SPARE"), counts, hrefFor);
    expect(tiles.filter((t) => t.on).map((t) => t.key)).toEqual(["in-stock"]);
    expect(tiles[0].href).toBe("/inventory");
    expect(tiles[1].href).toBe("/inventory?status=DEPLOYED");
  });
  it("marks attention on for attention=1 with no status", () => {
    const tiles = buildInventoryTiles("IT", parse("attention=1"), counts, hrefFor);
    expect(tiles.filter((t) => t.on).map((t) => t.key)).toEqual(["attention"]);
  });
  it("nothing is on for two statuses, or a status with attention", () => {
    expect(buildInventoryTiles("IT", parse("status=SPARE,DEPLOYED"), counts, hrefFor).some((t) => t.on)).toBe(false);
    expect(buildInventoryTiles("IT", parse("status=SPARE&attention=1"), counts, hrefFor).some((t) => t.on)).toBe(false);
  });
});
