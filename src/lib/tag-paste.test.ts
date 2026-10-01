import { describe, expect, it } from "vitest";
import { parseTagPaste } from "./tag-paste";

describe("parseTagPaste", () => {
  it("splits on lines, tabs and commas, trims, upper-cases and de-duplicates in first-seen order", () => {
    expect(parseTagPaste(" br-lt-0148 , BR-LT-0201\nbr-lt-0148\t BR-VH-0001 \r\n\n,")).toEqual(["BR-LT-0148", "BR-LT-0201", "BR-VH-0001"]);
  });
  it("empty input is an empty list", () => {
    expect(parseTagPaste("  \n , ")).toEqual([]);
  });
});
