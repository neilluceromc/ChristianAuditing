import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("passes plain values through and blanks null/undefined", () => {
    expect(csvCell("BR-LT-0148")).toBe("BR-LT-0148");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("quotes commas/quotes/newlines and doubles inner quotes", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutralizes spreadsheet formula injection", () => {
    expect(csvCell("=HYPERLINK(...)")).toBe("'=HYPERLINK(...)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2")).toBe("'-2");
  });
});

it("toCsv joins with CRLF and ends with a newline", () => {
  expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
});
