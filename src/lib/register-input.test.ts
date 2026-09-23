import { describe, expect, it } from "vitest";
import { normaliseCost, parseSerialPaste } from "./register-input";

describe("parseSerialPaste — a packing list's column into rows (spec §5.4)", () => {
  it("splits on newlines and tabs, trims, drops blanks", () => {
    expect(parseSerialPaste("SN-1\r\n SN-2 \n\nSN-3\tSN-4\n")).toEqual(["SN-1", "SN-2", "SN-3", "SN-4"]);
  });
  it("a single value stays a single value", () => {
    expect(parseSerialPaste("  SN-9  ")).toEqual(["SN-9"]);
  });
});

describe("normaliseCost — the way a receipt prints it (spec §5.4)", () => {
  it("strips peso signs, commas and spaces", () => {
    expect(normaliseCost("₱12,500")).toEqual({ ok: true, value: "12500" });
    expect(normaliseCost(" 12,500.50 ")).toEqual({ ok: true, value: "12500.50" });
    expect(normaliseCost("PHP 1 200")).toEqual({ ok: true, value: "1200" });
  });
  it("blank is a valid empty cost", () => {
    expect(normaliseCost("")).toEqual({ ok: true, value: "" });
  });
  it("anything that is not an amount with at most two decimals is refused", () => {
    expect(normaliseCost("twelve")).toEqual({ ok: false });
    expect(normaliseCost("12.505")).toEqual({ ok: false });
    expect(normaliseCost("-5")).toEqual({ ok: false });
  });
});
