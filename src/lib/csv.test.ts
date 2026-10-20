import { describe, expect, it } from "vitest";
import { csvCell, csvText, csvTextCell } from "./csv";

describe("csv cells", () => {
  it("quotes a cell with a quote, comma or line break, doubling its quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("x\r\ny")).toBe('"x\r\ny"');
  });
  it("keeps formulas as text", () => {
    for (const v of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(csvText(v)).toBe(`'${v}`);
    expect(csvText("ok")).toBe("ok");
    expect(csvTextCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });
});
