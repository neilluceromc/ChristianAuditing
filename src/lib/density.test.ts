import { describe, expect, it } from "vitest";
import { parseDensity, topbarNext } from "./density";

describe("parseDensity", () => {
  it("falls back to comfortable for missing or unknown values", () => {
    expect(parseDensity(undefined)).toBe("comfortable");
    expect(parseDensity("")).toBe("comfortable");
    expect(parseDensity("weird")).toBe("comfortable");
  });
  it("passes compact and dense through", () => {
    expect(parseDensity("compact")).toBe("compact");
    expect(parseDensity("dense")).toBe("dense");
    expect(parseDensity("comfortable")).toBe("comfortable");
  });
});

describe("topbarNext", () => {
  it("toggles comfortable and compact", () => {
    expect(topbarNext("comfortable")).toBe("compact");
    expect(topbarNext("compact")).toBe("comfortable");
  });
  it("leaves dense for comfortable", () => {
    expect(topbarNext("dense")).toBe("comfortable");
  });
});
