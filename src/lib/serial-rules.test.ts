import { describe, expect, it } from "vitest";
import { serialProblems, serialRequired } from "./serial-rules";
import { parseSerialPaste } from "./register-input";

describe("serialRequired", () => {
  it("IT yes, Purchasing no", () => {
    expect(serialRequired("IT")).toBe(true);
    expect(serialRequired("PURCHASING")).toBe(false);
  });
});

describe("serialProblems", () => {
  it("IT: blanks are required, repeats (case-insensitive) are duplicates", () => {
    expect(serialProblems(["A1", "", "a1", "B2"], "IT")).toEqual([null, "required", "duplicate", null]);
  });
  it("Purchasing: blanks are fine, repeats still flagged", () => {
    expect(serialProblems(["", "X", "x"], "PURCHASING")).toEqual([null, null, "duplicate"]);
  });
  it("a CRLF paste with a trailing blank line fills exactly its values (Review Focus 3)", () => {
    const values = parseSerialPaste("PF1\r\nPF2\r\nPF3\r\n\r\n");
    expect(values).toEqual(["PF1", "PF2", "PF3"]);
    expect(serialProblems(values, "IT")).toEqual([null, null, null]);
  });
});
