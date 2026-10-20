import { describe, expect, it } from "vitest";
import { APP_NAME, pageTitle } from "./page-title";

describe("pageTitle (Phase 47 spec §5.3: \"{Page} · CRIS\")", () => {
  it("appends the app name", () => {
    expect(pageTitle("Inventory")).toBe("Inventory · CRIS");
    expect(pageTitle("BR-LT-0148")).toBe("BR-LT-0148 · CRIS");
    expect(pageTitle("Marites Bautista")).toBe("Marites Bautista · CRIS");
  });

  it("joins several parts, most specific first", () => {
    expect(pageTitle("History", "BR-LT-0148")).toBe("History · BR-LT-0148 · CRIS");
  });

  it("drops empty, blank and missing parts", () => {
    expect(pageTitle("  Inventory  ", "", null, undefined, "   ")).toBe("Inventory · CRIS");
  });

  it("falls back to the app name alone when nothing is known", () => {
    expect(pageTitle()).toBe(APP_NAME);
    expect(pageTitle(null)).toBe("CRIS");
  });
});
