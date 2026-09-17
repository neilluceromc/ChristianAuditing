import { describe, expect, it } from "vitest";
import { headingBefore, type GroupedOption } from "./combo-groups";

const o = (value: string, group?: string): GroupedOption => ({ value, group });
const headings = (shown: GroupedOption[], recent: number) => shown.map((_, i) => headingBefore(shown, i, recent));

describe("headingBefore", () => {
  it("no recent, no groups: never a heading", () => {
    expect(headings([o("a"), o("b")], 0)).toEqual([null, null]);
  });
  it("recent only: Recent at 0, All where the rest begins", () => {
    expect(headings([o("r1"), o("r2"), o("a"), o("b")], 2)).toEqual(["Recent", null, "All", null]);
  });
  it("groups only: a heading at each change", () => {
    const shown = [o("l1", "Same type"), o("l2", "Same type"), o("m1", "Other spares"), o("m2", "Other spares"), o("m3", "Other spares")];
    expect(headings(shown, 0)).toEqual(["Same type", null, "Other spares", null, null]);
  });
  it("a filtered list that keeps only one group shows one heading", () => {
    expect(headings([o("m1", "Other spares"), o("m2", "Other spares")], 0)).toEqual(["Other spares", null]);
  });
  it("recent plus groups: Recent, then the first group's own name, then the change", () => {
    const shown = [o("r1", "Same type"), o("l1", "Same type"), o("m1", "Other spares")];
    expect(headings(shown, 1)).toEqual(["Recent", "Same type", "Other spares"]);
  });
  it("an ungrouped row after grouped rows gets no heading", () => {
    expect(headings([o("l1", "Same type"), o("x")], 0)).toEqual(["Same type", null]);
  });
});
