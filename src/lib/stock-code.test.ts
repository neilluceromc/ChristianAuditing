import { describe, expect, it } from "vitest";
import { formatStockCode, parseStockCode, PREFIX_SHAPE, STOCK_CODE_SHAPE } from "./stock-code";

describe("stock codes (spec §2.1)", () => {
  it("formats with four digits and parses back", () => {
    expect(formatStockCode("OS", 7)).toBe("OS-0007");
    expect(formatStockCode("PN", 12345)).toBe("PN-12345");
    expect(parseStockCode("OS-0007")).toEqual({ prefix: "OS", n: 7 });
    expect(parseStockCode("os-0007")).toBeNull();
    expect(parseStockCode("OS-7")).toBeNull();
  });
  it("prefix shape is two or three capitals", () => {
    for (const ok of ["OS", "PN", "CMX"]) expect(PREFIX_SHAPE.test(ok)).toBe(true);
    for (const bad of ["O", "OSXX", "os", "O1"]) expect(PREFIX_SHAPE.test(bad)).toBe(false);
    expect(STOCK_CODE_SHAPE.test("CM-0001")).toBe(true);
  });
  it("ruling R1: four or more digits parse — the series never stops at 9999", () => {
    expect(STOCK_CODE_SHAPE.test("PN-12345")).toBe(true);
    expect(parseStockCode("PN-12345")).toEqual({ prefix: "PN", n: 12345 });
  });
});
