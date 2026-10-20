import { describe, expect, it } from "vitest";
import {
  nextSidebar, parseSidebar, SIDEBAR_COOKIE, SIDEBAR_FADE_MS, SIDEBAR_WIDTH_MS, sidebarCookie, sidebarSteps,
} from "./sidebar-state";

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

describe("sidebarSteps (Phase 47 spec §5.1: the collapse animation)", () => {
  it("times the width to --dur-4 (260 ms) and the label fade to --dur-2 (140 ms)", () => {
    expect(SIDEBAR_WIDTH_MS).toBe(260);
    expect(SIDEBAR_FADE_MS).toBe(140);
  });

  it("collapsing: the labels fade out first, then the width shrinks, then the rail's own labels fade in", () => {
    expect(sidebarSteps("full", "rail", false)).toEqual([
      { at: 0, state: "full", anim: "hide" },
      { at: 140, state: "rail", anim: "hide" },
      { at: 400, state: "rail", anim: "show" },
      { at: 540, state: "rail", anim: null },
    ]);
  });

  it("expanding: the width grows with the labels hidden, then they fade in", () => {
    expect(sidebarSteps("rail", "full", false)).toEqual([
      { at: 0, state: "full", anim: "hide" },
      { at: 260, state: "full", anim: "show" },
      { at: 400, state: "full", anim: null },
    ]);
  });

  it("a toggle back before the width moved only fades the labels back in", () => {
    expect(sidebarSteps("full", "full", false)).toEqual([
      { at: 0, state: "full", anim: "show" },
      { at: 140, state: "full", anim: null },
    ]);
  });

  it("is one instant step under prefers-reduced-motion, with no animation attribute", () => {
    expect(sidebarSteps("full", "rail", true)).toEqual([{ at: 0, state: "rail", anim: null }]);
    expect(sidebarSteps("rail", "full", true)).toEqual([{ at: 0, state: "full", anim: null }]);
  });
});
