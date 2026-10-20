import { describe, expect, it } from "vitest";
import { nextSidebar, parseSidebar, SIDEBAR_COOKIE, sidebarCookie } from "./sidebar-state";

describe("parseSidebar (spec §4.1: br.sidebar=rail|full)", () => {
  it("reads rail", () => {
    expect(parseSidebar("rail")).toBe("rail");
  });

  it("falls back to full for a missing, empty or unknown value", () => {
    for (const v of [undefined, "", "full", "RAIL", "rail ", "collapsed", "1"]) expect(parseSidebar(v)).toBe("full");
  });
});

describe("nextSidebar", () => {
  it("toggles", () => {
    expect(nextSidebar("full")).toBe("rail");
    expect(nextSidebar("rail")).toBe("full");
  });
});

describe("sidebarCookie", () => {
  it("is a one-year, site-wide, lax cookie (the br.density pattern)", () => {
    expect(SIDEBAR_COOKIE).toBe("br.sidebar");
    expect(sidebarCookie("rail")).toBe("br.sidebar=rail;path=/;max-age=31536000;samesite=lax");
    expect(sidebarCookie("full")).toBe("br.sidebar=full;path=/;max-age=31536000;samesite=lax");
  });
});
