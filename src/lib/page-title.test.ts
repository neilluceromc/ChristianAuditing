import { describe, expect, it } from "vitest";
import { APP_NAME, pageTitle } from "./page-title";

describe("pageTitle (spec §5: \"{Page} · Backroom IT\")", () => {
  it("appends the app name", () => {
    expect(pageTitle("Inventory")).toBe("Inventory · Backroom IT");
    expect(pageTitle("BR-LT-0148")).toBe("BR-LT-0148 · Backroom IT");
    expect(pageTitle("Marites Bautista")).toBe("Marites Bautista · Backroom IT");
  });

  it("joins several parts, most specific first", () => {
    expect(pageTitle("History", "BR-LT-0148")).toBe("History · BR-LT-0148 · Backroom IT");
  });

  it("drops empty, blank and missing parts", () => {
    expect(pageTitle("  Inventory  ", "", null, undefined, "   ")).toBe("Inventory · Backroom IT");
  });

  it("falls back to the app name alone when nothing is known", () => {
    expect(pageTitle()).toBe(APP_NAME);
    expect(pageTitle(null)).toBe("Backroom IT");
  });
});
